# Agent pid resolution and true session start

Date: 2026-07-29
Status: approved, ready for planning

## Problem

The row's elapsed clock measures the current task, not the session, and the row
disappears from the popup after every turn. Both symptoms come from one defect.

`resolveAgentPid` takes the pid of the hook process and returns its parent
(`src/shell/windowFinder.ts:23`). That parent is not the agent. Claude spawns a
hook the same way it spawns any shell command — through a wrapper shell:

```
zsh -c 'source <snapshot>.sh ... && eval <hook command>'
```

The command is compound, so the shell never `exec`s the hook. It stays alive as
the hook's parent and dies the moment the hook exits. The pid stored on the
session is therefore a process that has been dead for milliseconds by the time
anything reads it.

Three consequences follow:

- **The row vanishes after a turn ends.** The reaper runs every 60 seconds
  (`src/extension.ts:79`) and drops any session whose pid is gone
  (`agentGone`, `src/core/store.ts:219`). With no further events to recreate
  it, the session stays dropped while the terminal is still open.
- **The clock resets constantly.** `startedAt` is stamped once, at record
  creation (`src/core/store.ts:48`). Mid-work the reaper drops the record and
  the next hook event recreates it with a fresh `startedAt`, so elapsed only
  ever measures since the last sweep — which reads as "the current task".
- **Jump is unreliable.** `findWindowForPid` walks ancestors from the stored
  pid (`src/shell/windowFinder.ts:40`); a dead pid has no `/proc` entry, so the
  chain is a dead end and no window matches.

Installing or reading the `SessionStart` hook does not fix this. That hook is
already installed and already normalised (`src/core/adapters/claude.ts:6`), and
its timestamp is the true session start — but it fires exactly once, at launch.
Once the record has been reaped, only later events remain to recreate it, and
they carry later timestamps. The same holds for three cases `SessionStart` can
never cover: hooks installed mid-session, a GNOME Shell reload emptying the
in-memory store, and a session that was already running when the extension was
enabled.

## Decision

The clock measures **wall-clock since the agent process launched**. A
`claude --resume` of an older conversation starts at zero: it is a new process.

Session start is derived from the process itself, not from event history, so it
is recoverable at any moment rather than observable only once.

## Design

### 1. Signature per agent — `src/core/adapters/index.ts`

`AgentAdapter` gains one field:

```ts
/** `comm` values (/proc field 2) that identify this agent's own process. */
procNames: string[]
```

Values: `claude` → `['claude']`, `codex` → `['codex']`, `antigravity` →
`['agy']`. The kernel truncates `comm` to 15 characters, so signatures are
compared against the truncated form and must themselves be at most 15
characters.

`comm`, not `cmdline`: the wrapper shell's cmdline contains the hook command
`... dasbo-hook claude notify SessionStart`, so a substring test over cmdline
matches the shell — precisely the wrong process.

### 2. Pid selection — `src/core/procParse.ts`

A pure function beside `ancestorPids`, taking the same injected `readStat`, so
core stays free of any filesystem dependency (enforced by
`test/core/purity.test.ts`):

```ts
/** `comm` is field 2 of /proc/<pid>/stat, wrapped in parentheses. */
export function parseComm(statContent: string): string | null

export function selectAgentPid(
  hookPid: number,
  procNames: string[],
  readStat: (pid: number) => string | null
): number
```

`comm` comes out of the same `stat` content the walk already reads, so no
second reader and no second file per process. `parseComm` slices between the
first `(` and the last `)`, the same boundary `parsePpid` uses — a `comm` may
contain both spaces and parentheses.

Walking the chain `ancestorPids` already builds, bounded at its existing depth
of 20, skipping index 0 (the hook itself):

1. First ancestor whose `comm` is in `procNames`.
2. Otherwise, first ancestor whose `comm` is not a shell or interpreter —
   `sh`, `dash`, `bash`, `zsh`, `fish`, `gjs`, `node`, `env`. Covers an agent
   binary whose name we do not know.
3. Otherwise `0`.

Returning `0` rather than the bare ppid is deliberate. An unknown pid is safer
than a wrong one: the store guards every use on `pid > 0`
(`src/core/store.ts:170`, `src/core/store.ts:219`), so at `0` liveness reaping
is skipped and the session falls back to the 15-minute stale sweep. The bare
ppid is the transient shell, and trusting it is the defect this spec removes.

The depth is walked rather than a fixed parent-of-parent because depth varies:
direct spawn, wrapper shell, wrapper plus login shell are all real shapes.

### 3. Process start time — `src/core/procParse.ts`

Two more pure parsers:

```ts
export function parseStartTicks(statContent: string): number | null
export function parseBtime(procStatContent: string): number | null
```

`parseStartTicks` reuses the `lastIndexOf(')')` trick `parsePpid` already
relies on — `comm` may contain spaces and parentheses. After the slice, field 3
sits at index 0, so `starttime` (field 22) sits at index 19.

`parseBtime` reads the `btime <seconds>` line of `/proc/stat`.

USER_HZ is fixed at 100 for the `/proc` ABI regardless of the kernel's
`CONFIG_HZ`, so:

```
startedAt = Math.round((btime + starttime / 100) * 1000)
```

`/proc/stat` is read fresh on every resolve, never cached: the kernel
recomputes `btime`, and it jitters by about a second across suspend. The cost
is one small read per hook event.

### 4. Resolution site — `src/shell/windowFinder.ts`

`resolveAgentPid` is replaced by:

```ts
export function resolveAgent(
  agent: AgentId,
  hookPid: number
): { pid: number; startedAt?: number }
```

One chain walk yields both answers. It runs where `resolveAgentPid` runs today
— inside the D-Bus handlers, while the hook process is still blocked in its
call and every process in the chain still has a readable `/proc` entry.

`startedAt` is omitted when the pid is `0`, when either parse fails, or when
the computed value fails its bounds check: more than 5 seconds in the future,
or more than 30 days in the past. Those bounds guard against a garbled read
producing a row that claims 900h.

### 5. Wiring — `src/core/types.ts`, `src/dbus/service.ts`, `src/core/store.ts`

`HookContext` and `AgentEvent` each gain:

```ts
/** Agent process start time in ms since epoch, when /proc could supply it. */
agentStartedAt?: number
```

Adapters copy it through from context to event, exactly as they already do for
`pid` and `ts`. Both call sites in `src/dbus/service.ts` (`Notify`,
`RequestPermissionAsync`) call `resolveAgent` in place of `resolveAgentPid` and
pass both fields.

`SessionStore.ensure` stamps:

```ts
startedAt: e.agentStartedAt ?? e.ts
```

`lastEventAt` continues to use `e.ts`; it means "when we last heard from this
session", which is a different question.

Stamped at record creation only, never updated afterwards. A recreated record
recomputes the same number from the same process, so no upgrade path is needed;
a session whose `/proc` read failed keeps its fallback for its lifetime rather
than carrying provenance around on `Session`.

## Failure modes

Every path degrades to today's behaviour. Nothing introduced here can throw
into the D-Bus handlers, which already wrap their bodies in `try`/`catch`.

| Case | Result |
|---|---|
| `/proc/<pid>/stat` unreadable mid-walk | Chain stops there; selection uses what it has, else `0` |
| No signature match, a non-shell ancestor exists | That pid; liveness and Jump both work |
| Every ancestor is a shell | pid `0`; stale-window reaping only, Jump reports "no window" |
| `/proc/stat` has no `btime`, or either parse fails | `startedAt` omitted; store falls back to `e.ts` |
| Computed time outside bounds | `startedAt` omitted; store falls back to `e.ts` |

## Testing

- `test/core/procParse.test.ts` — `parseComm` and `parseStartTicks` against a
  `comm` containing spaces and parentheses; `parseBtime` against a `/proc/stat`
  sample and one missing the line; `selectAgentPid` over fabricated chains:
  direct spawn, `zsh -c` wrapper, wrapper plus login shell, all-shells (`0`),
  15-character truncated `comm`, unreadable link mid-chain, cycle, depth cap.
- `test/core/store.test.ts` — creation prefers `agentStartedAt`; falls back to
  `e.ts` when absent; a record reaped and then recreated reports the same
  `startedAt`.
- `test/core/adapters/*.test.ts` — each adapter carries its `procNames`, and
  `normalize` copies `agentStartedAt` through.
- `test/core/purity.test.ts` — unchanged and still passing: the new selection
  and parse functions take injected readers.

No fixture can prove the spawn shape, so one manual check on a real session
closes it out: the pill survives a turn ending, elapsed keeps counting across
two consecutive tasks, and Jump raises the terminal window.

## Out of scope

- Pid reuse. `starttime` would disambiguate a recycled pid, but the window is
  narrow and the current code does not attempt it either.
- Persisting sessions across a GNOME Shell reload. Deriving `startedAt` from
  `/proc` already restores the correct clock after a reload; restoring the rows
  themselves is a separate question.
- Any change to the hook protocol or the D-Bus signature. Resolution stays
  extension-side, so existing installs stay `installed` and no user has to
  click Update.
