# Agent pid resolution and true session start — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store the real agent pid on each session and derive `startedAt` from that process's own start time, so the row survives a turn ending and its clock measures the whole session.

**Architecture:** The pid currently stored is the hook's parent — the wrapper shell the agent spawns hooks through, dead milliseconds later. Replace `resolveAgentPid` with a walk over the ancestor chain that picks the first process whose `/proc` `comm` matches a per-adapter signature, and read that process's start time from `/proc/<pid>/stat` field 22 plus `/proc/stat`'s `btime`. All parsing is pure and lives in `src/core/procParse.ts` with injected readers; only `src/shell/windowFinder.ts` touches the filesystem.

**Tech Stack:** TypeScript, GJS / GNOME Shell 46, esbuild, vitest.

## Global Constraints

- `src/core/**` must never import `gi://` or `resource://`. Enforced by `test/core/purity.test.ts`. All filesystem access is injected as a reader function.
- No change to the D-Bus interface (`src/dbus/iface.ts`) or the hook command line. Existing installs must keep reporting `installed`; no user should be asked to click Update.
- USER_HZ is fixed at 100 for the `/proc` ABI regardless of the kernel's `CONFIG_HZ`. Do not try to detect it.
- Every failure path degrades to today's behaviour: unknown pid is `0`, unknown start time is omitted and the store falls back to `e.ts`.
- Test commands: `npm test` (vitest), `npm run typecheck` (both tsconfigs). Both must pass before each commit.
- Spec: `docs/superpowers/specs/2026-07-29-agent-pid-and-session-start-design.md`.

---

## File Structure

**Created:** none.

**Modified:**

| File | Responsibility after this plan |
|---|---|
| `src/core/procParse.ts` | All `/proc` text parsing and pid selection, pure, injected readers |
| `test/core/procParse.test.ts` | Covers every parser and the selection walk |
| `src/core/adapters/index.ts` | `AgentAdapter` gains `procNames` |
| `src/core/adapters/claude.ts`, `codex.ts`, `antigravity.ts` | Carry `procNames`; copy `agentStartedAt` from context to event |
| `src/core/types.ts` | `HookContext` and `AgentEvent` gain `agentStartedAt?: number` |
| `src/core/store.ts` | `ensure` prefers `e.agentStartedAt` over `e.ts` |
| `src/shell/windowFinder.ts` | `resolveAgentPid` → `resolveAgent`, the only filesystem site |
| `src/dbus/service.ts` | Both handlers call `resolveAgent` and pass both fields |
| `docs/agent-dialects.md` | Records how agents spawn hooks and why ppid is not the agent |

Tasks 1–3 are pure core with no consumers yet; Task 4 wires the types through the adapters; Task 5 makes the store use them; Task 6 connects the shell layer and is the first task where behaviour changes at runtime.

---

### Task 1: `/proc` text parsers

**Files:**
- Modify: `src/core/procParse.ts` (append after `parsePpid`, before `ancestorPids`)
- Test: `test/core/procParse.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseComm(statContent: string): string | null`, `parseStartTicks(statContent: string): number | null`, `parseBtime(procStatContent: string): number | null`.

Background the implementer needs: `/proc/<pid>/stat` is one line, whitespace separated. Field 1 is the pid, field 2 is `comm` wrapped in parentheses, field 3 is the state character, field 4 is the ppid, field 22 is `starttime` in clock ticks since boot. `comm` is the executable name truncated to 15 characters by the kernel and it may itself contain spaces and parentheses, which is why every field parser slices from the **last** `)` rather than splitting the whole line. `/proc/stat` is a different file — system-wide — and carries a `btime <seconds-since-epoch>` line giving the moment the machine booted.

- [ ] **Step 1: Write the failing tests**

Append to `test/core/procParse.test.ts`:

```ts
describe('parseComm', () => {
  it('reads comm from a normal stat line', () => {
    expect(parseComm('1234 (claude) S 1000 1234 ...')).toBe('claude')
  })

  it('survives a comm containing spaces and parentheses', () => {
    expect(parseComm('4242 (my weird (proc)) S 99 4242 ...')).toBe('my weird (proc)')
  })

  it('returns null for junk', () => {
    expect(parseComm('')).toBeNull()
    expect(parseComm('no parens here')).toBeNull()
    expect(parseComm('1234 )backwards( S 1')).toBeNull()
  })
})

describe('parseStartTicks', () => {
  // Fields 3..22 after the closing paren: state, ppid, pgrp, session, tty_nr,
  // tpgid, flags, minflt, cminflt, majflt, cmajflt, utime, stime, cutime,
  // cstime, priority, nice, num_threads, itrealvalue, starttime.
  const stat = (starttime: number) =>
    `1234 (claude) S 1000 1234 1234 34816 1234 4194304 900 0 0 0 12 3 0 0 20 0 14 0 ${starttime} 123456 ...`

  it('reads starttime, field 22', () => {
    expect(parseStartTicks(stat(987654))).toBe(987654)
  })

  it('survives a comm containing spaces and parentheses', () => {
    expect(parseStartTicks(stat(11).replace('(claude)', '(my weird (proc))'))).toBe(11)
  })

  it('returns null when the line is too short or unparseable', () => {
    expect(parseStartTicks('1234 (claude) S 1000 1234')).toBeNull()
    expect(parseStartTicks('')).toBeNull()
    expect(
      parseStartTicks(
        '1234 (claude) S 1000 1234 1234 34816 1234 4194304 900 0 0 0 12 3 0 0 20 0 14 0 nope 999'
      )
    ).toBeNull()
  })
})

describe('parseBtime', () => {
  const procStat = 'cpu  1 2 3\ncpu0 1 2 3\nintr 99\nctxt 12345\nbtime 1753000000\nprocesses 700\n'

  it('reads the btime line', () => {
    expect(parseBtime(procStat)).toBe(1753000000)
  })

  it('returns null when there is no btime line', () => {
    expect(parseBtime('cpu  1 2 3\nctxt 12345\n')).toBeNull()
  })

  it('returns null for a non-numeric or zero btime', () => {
    expect(parseBtime('btime later\n')).toBeNull()
    expect(parseBtime('btime 0\n')).toBeNull()
  })
})
```

Extend the existing import at the top of the file:

```ts
import {
  ancestorPids,
  parseBtime,
  parseComm,
  parsePpid,
  parseStartTicks,
} from '../../src/core/procParse.js'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/core/procParse.test.ts`
Expected: FAIL — `parseComm is not a function` (and the same for the other two).

- [ ] **Step 3: Write the implementation**

In `src/core/procParse.ts`, after `parsePpid`:

```ts
/**
 * Extract `comm` (field 2) from the contents of /proc/<pid>/stat. The kernel
 * truncates it to 15 characters and it may contain spaces and parentheses, so
 * it is bounded by the FIRST '(' and the LAST ')'.
 */
export function parseComm(statContent: string): string | null {
  const open = statContent.indexOf('(')
  const close = statContent.lastIndexOf(')')
  if (open === -1 || close <= open) return null
  return statContent.slice(open + 1, close)
}

/**
 * Extract `starttime` (field 22, clock ticks since boot) from the contents of
 * /proc/<pid>/stat. Same last-')' slice as parsePpid: after it, field 3 sits at
 * index 0, so field 22 sits at index 19.
 */
export function parseStartTicks(statContent: string): number | null {
  const close = statContent.lastIndexOf(')')
  if (close === -1) return null
  const rest = statContent.slice(close + 1).trim().split(/\s+/)
  const raw = rest[19]
  if (raw === undefined) return null
  const ticks = Number(raw)
  return Number.isFinite(ticks) && ticks >= 0 ? ticks : null
}

/**
 * Boot time in seconds since the epoch, from the `btime` line of /proc/stat —
 * the system-wide file, not a per-process one.
 */
export function parseBtime(procStatContent: string): number | null {
  for (const line of procStatContent.split('\n')) {
    if (!line.startsWith('btime ')) continue
    const secs = Number(line.slice('btime '.length).trim())
    return Number.isFinite(secs) && secs > 0 ? secs : null
  }
  return null
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/core/procParse.test.ts`
Expected: PASS, all describes green.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/core/procParse.ts test/core/procParse.test.ts
git commit -m "feat(core): parse comm, starttime and btime out of /proc"
```

---

### Task 2: Agent pid selection

**Files:**
- Modify: `src/core/procParse.ts` (append after `ancestorPids`)
- Test: `test/core/procParse.test.ts`

**Interfaces:**
- Consumes: `ancestorPids`, `parseComm` from Task 1.
- Produces: `selectAgentPid(hookPid: number, procNames: string[], readStat: (pid: number) => string | null): number`.

Background: the chain from a hook process looks like `hook → zsh (wrapper, dies immediately) → claude → terminal emulator → systemd`. Index 0 is the hook itself and is never the answer. Returning `0` means "unknown", which every caller already guards on (`src/core/store.ts:170`, `src/core/store.ts:219`); returning a wrong pid is worse than returning none, because a wrong-and-dead pid is what makes the reaper drop live sessions today.

- [ ] **Step 1: Write the failing tests**

Append to `test/core/procParse.test.ts`:

```ts
describe('selectAgentPid', () => {
  /** Build a readStat over a { pid: [ppid, comm] } tree. */
  const reader = (tree: Record<number, [number, string]>) => (pid: number) => {
    const entry = tree[pid]
    return entry === undefined ? null : `${pid} (${entry[1]}) S ${entry[0]} rest`
  }

  it('picks the ancestor whose comm matches the agent signature', () => {
    // hook -> wrapper shell -> claude -> terminal -> init
    const readStat = reader({
      900: [800, 'gjs'], 800: [700, 'zsh'], 700: [600, 'claude'],
      600: [500, 'kitty'], 500: [1, 'systemd'], 1: [0, 'systemd'],
    })
    expect(selectAgentPid(900, ['claude'], readStat)).toBe(700)
  })

  it('sees through a wrapper shell plus a login shell', () => {
    const readStat = reader({
      900: [800, 'gjs'], 800: [750, 'zsh'], 750: [700, 'bash'], 700: [1, 'claude'], 1: [0, 'systemd'],
    })
    expect(selectAgentPid(900, ['claude'], readStat)).toBe(700)
  })

  it('never returns the hook process itself', () => {
    const readStat = reader({ 900: [1, 'claude'], 1: [0, 'systemd'] })
    expect(selectAgentPid(900, ['claude'], readStat)).toBe(0)
  })

  it('falls back to the nearest non-shell ancestor for an unknown agent', () => {
    const readStat = reader({
      900: [800, 'gjs'], 800: [700, 'zsh'], 700: [600, 'someagent'], 600: [1, 'kitty'], 1: [0, 'systemd'],
    })
    expect(selectAgentPid(900, ['claude'], readStat)).toBe(700)
  })

  it('prefers a signature match over a nearer non-shell ancestor', () => {
    const readStat = reader({
      900: [800, 'gjs'], 800: [700, 'tmux'], 700: [1, 'claude'], 1: [0, 'systemd'],
    })
    expect(selectAgentPid(900, ['claude'], readStat)).toBe(700)
  })

  it('returns 0 when every ancestor is a shell or init', () => {
    const readStat = reader({ 900: [800, 'gjs'], 800: [1, 'zsh'], 1: [0, 'systemd'] })
    expect(selectAgentPid(900, ['claude'], readStat)).toBe(0)
  })

  it('matches the kernel-truncated 15-character comm', () => {
    const readStat = reader({ 900: [800, 'gjs'], 800: [1, 'antigravity-cli'], 1: [0, 'systemd'] })
    expect(selectAgentPid(900, ['antigravity-cli'], readStat)).toBe(800)
  })

  it('stops at an unreadable link without throwing', () => {
    const readStat = reader({ 900: [800, 'gjs'] })
    expect(selectAgentPid(900, ['claude'], readStat)).toBe(0)
  })

  it('returns 0 for a non-positive hook pid', () => {
    const readStat = reader({ 900: [1, 'claude'], 1: [0, 'systemd'] })
    expect(selectAgentPid(0, ['claude'], readStat)).toBe(0)
  })
})
```

Extend the import to add `selectAgentPid`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/core/procParse.test.ts -t selectAgentPid`
Expected: FAIL — `selectAgentPid is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/core/procParse.ts`, after `ancestorPids`:

```ts
/**
 * Processes that are never the agent: the shells an agent spawns its hooks
 * through, and the interpreters a hook itself runs under. `comm` values, so
 * already basenames.
 */
const NEVER_THE_AGENT = new Set(['sh', 'dash', 'bash', 'zsh', 'fish', 'gjs', 'node', 'env'])

/**
 * The agent process that owns a hook, or 0 when it cannot be identified.
 *
 * The hook's parent is NOT the agent: agents spawn hooks through a wrapper
 * shell running a compound command (`zsh -c 'source <snapshot> && eval <hook>'`),
 * which never execs and dies the moment the hook exits. Walking the chain and
 * identifying the process by name is what survives that, and it also handles a
 * login shell in between, or no wrapper at all.
 *
 * 0 rather than a best guess when nothing matches: every caller guards on
 * `pid > 0`, so an unknown pid merely disables liveness reaping and jump-back
 * for that session, whereas a wrong pid makes the reaper drop a live one.
 *
 * Must be called while the hook is still blocked in its D-Bus call, i.e. from
 * inside the method handler, since the whole chain has to be readable.
 */
export function selectAgentPid(
  hookPid: number,
  procNames: string[],
  readStat: (pid: number) => string | null
): number {
  const chain = ancestorPids(hookPid, readStat)
  let fallback = 0

  // From 1: index 0 is the hook process itself.
  for (let i = 1; i < chain.length; i++) {
    const pid = chain[i]!
    // init owns every process on the system and identifies nothing.
    if (pid <= 1) continue
    const stat = readStat(pid)
    if (stat === null) continue
    const comm = parseComm(stat)
    if (comm === null) continue
    if (procNames.includes(comm)) return pid
    // Nearest first: a terminal emulator further up must not win over the
    // agent sitting just above the wrapper shell.
    if (fallback === 0 && !NEVER_THE_AGENT.has(comm)) fallback = pid
  }

  return fallback
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/core/procParse.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/core/procParse.ts test/core/procParse.test.ts
git commit -m "feat(core): identify the agent process by walking the hook's ancestors"
```

---

### Task 3: Process start time in milliseconds

**Files:**
- Modify: `src/core/procParse.ts` (append at end of file)
- Test: `test/core/procParse.test.ts`

**Interfaces:**
- Consumes: `parseStartTicks`, `parseBtime` from Task 1.
- Produces: `agentStartMs(statContent: string, procStatContent: string, now: number): number | null`.

`now` is a parameter, never a clock read, for the same reason `AgentEvent.ts` is supplied by the caller: `src/core` stays pure and testable.

- [ ] **Step 1: Write the failing tests**

Append to `test/core/procParse.test.ts`:

```ts
describe('agentStartMs', () => {
  const BTIME = 1753000000 // seconds since epoch
  const procStat = `cpu  1 2 3\nbtime ${BTIME}\nprocesses 700\n`
  /** starttime in ticks; USER_HZ is 100, so 100 ticks = 1 second after boot. */
  const stat = (ticks: number) =>
    `1234 (claude) S 1 1 1 0 1 0 0 0 0 0 0 0 0 0 20 0 1 0 ${ticks} 999 ...`
  const bootedMs = BTIME * 1000

  it('adds starttime to boot time and returns milliseconds', () => {
    expect(agentStartMs(stat(360000), procStat, bootedMs + 4_000_000)).toBe(bootedMs + 3_600_000)
  })

  it('returns null when starttime cannot be read', () => {
    expect(agentStartMs('1234 (claude) S 1', procStat, bootedMs + 4_000_000)).toBeNull()
  })

  it('returns null when btime cannot be read', () => {
    expect(agentStartMs(stat(100), 'cpu 1 2 3\n', bootedMs + 4_000_000)).toBeNull()
  })

  it('rejects a start time in the future beyond the slack window', () => {
    expect(agentStartMs(stat(100_000), procStat, bootedMs)).toBeNull()
  })

  it('accepts a start time a few seconds ahead of now', () => {
    // 100 ticks = 1s after boot, evaluated 1s before boot: inside the 5s slack.
    expect(agentStartMs(stat(100), procStat, bootedMs - 1000)).toBe(bootedMs + 1000)
  })

  it('rejects a start time older than thirty days', () => {
    const now = bootedMs + 31 * 24 * 60 * 60 * 1000
    expect(agentStartMs(stat(100), procStat, now)).toBeNull()
  })
})
```

Extend the import to add `agentStartMs`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/core/procParse.test.ts -t agentStartMs`
Expected: FAIL — `agentStartMs is not a function`.

- [ ] **Step 3: Write the implementation**

At the end of `src/core/procParse.ts`:

```ts
/** Fixed at 100 for the /proc ABI regardless of the kernel's CONFIG_HZ. */
const USER_HZ = 100
/** btime jitters by around a second across suspend; tolerate a little skew. */
const FUTURE_SLACK_MS = 5000
/** A session older than this is a garbled read, not a long-running agent. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/**
 * When the process described by `statContent` started, in ms since the epoch,
 * or null when the inputs cannot be trusted. Derived rather than observed, so
 * it is recoverable at any moment — after a reap, after a shell reload, or for
 * a session that was already running when the extension was enabled.
 */
export function agentStartMs(
  statContent: string,
  procStatContent: string,
  now: number
): number | null {
  const ticks = parseStartTicks(statContent)
  const btime = parseBtime(procStatContent)
  if (ticks === null || btime === null) return null

  const ms = Math.round((btime + ticks / USER_HZ) * 1000)
  if (ms > now + FUTURE_SLACK_MS) return null
  if (ms < now - MAX_AGE_MS) return null
  return ms
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/core/procParse.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/core/procParse.ts test/core/procParse.test.ts
git commit -m "feat(core): derive a process's start time from /proc"
```

---

### Task 4: Carry the agent's start time through the adapters

**Files:**
- Modify: `src/core/types.ts:7-16` (`HookContext`), `src/core/types.ts:30-51` (`AgentEvent`)
- Modify: `src/core/adapters/index.ts:6-11` (`AgentAdapter`)
- Modify: `src/core/adapters/claude.ts`, `src/core/adapters/codex.ts`, `src/core/adapters/antigravity.ts`
- Test: `test/core/adapters/claude.test.ts`, `test/core/adapters/index.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `HookContext.agentStartedAt?: number`, `AgentEvent.agentStartedAt?: number`, `AgentAdapter.procNames: string[]`.

`procNames` values: `claude` → `['claude']`, `codex` → `['codex']`, `antigravity` → `['agy']`. Each must be at most 15 characters, because that is where the kernel truncates `comm`.

- [ ] **Step 1: Write the failing tests**

Append to `test/core/adapters/index.test.ts`:

```ts
describe('adapter process signatures', () => {
  it('gives every adapter at least one comm to match', () => {
    for (const id of ['claude', 'codex', 'antigravity'] as const) {
      expect(adapters[id].procNames.length).toBeGreaterThan(0)
    }
  })

  it('keeps every signature within the kernel comm truncation of 15 chars', () => {
    for (const id of ['claude', 'codex', 'antigravity'] as const) {
      for (const name of adapters[id].procNames) {
        expect(name.length, `${id}: ${name}`).toBeLessThanOrEqual(15)
      }
    }
  })

  it('every adapter copies agentStartedAt from the hook context', () => {
    const withStart: HookContext = { ...ctx, event: 'Stop', agentStartedAt: 4242 }
    const payloads = {
      claude: { hook_event_name: 'Stop', session_id: 's', cwd: '/p' },
      codex: { type: 'session.start', session_id: 's', cwd: '/p' },
      antigravity: { conversationId: 's', workspacePaths: ['/p'] },
    } as const
    for (const id of ['claude', 'codex', 'antigravity'] as const) {
      expect(normalizeFor(id, payloads[id], withStart)?.agentStartedAt, id).toBe(4242)
    }
  })
})
```

Append to `test/core/adapters/claude.test.ts`:

```ts
describe('claudeAdapter agentStartedAt', () => {
  it('copies the hook context agentStartedAt onto the event', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'Stop', session_id: 's1', cwd: '/p' },
      { ...ctx, agentStartedAt: 4242 }
    )
    expect(e?.agentStartedAt).toBe(4242)
  })

  it('leaves agentStartedAt undefined when the context has none', () => {
    const e = claudeAdapter.normalize({ hook_event_name: 'Stop', session_id: 's1', cwd: '/p' }, ctx)
    expect(e?.agentStartedAt).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/core/adapters`
Expected: FAIL — `Cannot read properties of undefined (reading 'length')` for `procNames`, and `expected undefined to be 4242`.

- [ ] **Step 3: Write the implementation**

In `src/core/types.ts`, inside `HookContext` after the `pid` field:

```ts
  /**
   * When the agent process started, in ms since the epoch, resolved from /proc
   * by the shell layer. Undefined when /proc could not supply it; the store
   * then falls back to the event timestamp.
   */
  agentStartedAt?: number
```

In the same file, inside `AgentEvent` after the `pid` field, add the identical field with the same comment.

In `src/core/adapters/index.ts`, inside `AgentAdapter`:

```ts
  /**
   * `comm` values (/proc field 2) identifying this agent's own process, used to
   * pick it out of a hook's ancestor chain. Max 15 characters: the kernel
   * truncates `comm` there.
   */
  procNames: string[]
```

In each adapter, beside `displayName`:

```ts
// src/core/adapters/claude.ts
  procNames: ['claude'],
// src/core/adapters/codex.ts
  procNames: ['codex'],
// src/core/adapters/antigravity.ts
  procNames: ['agy'],
```

In each adapter's `normalize` return object, beside `pid: ctx.pid`:

```ts
      agentStartedAt: ctx.agentStartedAt,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS. The existing `toEqual` assertions in `claude.test.ts` still pass — vitest's `toEqual` ignores properties whose value is `undefined`.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/core/types.ts src/core/adapters test/core/adapters
git commit -m "feat(core): give adapters a process signature and an agent start time"
```

---

### Task 5: Stamp the session from the agent's start time

**Files:**
- Modify: `src/core/store.ts:35-54` (`ensure`)
- Test: `test/core/store.test.ts`

**Interfaces:**
- Consumes: `AgentEvent.agentStartedAt` from Task 4.
- Produces: `Session.startedAt` sourced from the agent process rather than the first event seen. No signature change.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('SessionStore', ...)` in `test/core/store.test.ts`:

```ts
  it('stamps startedAt from the agent process when the event carries it', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 9000, agentStartedAt: 1500 }))
    expect(s.list()[0]!.startedAt).toBe(1500)
  })

  it('falls back to the event timestamp when /proc supplied nothing', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 9000 }))
    expect(s.list()[0]!.startedAt).toBe(9000)
  })

  it('keeps lastEventAt on the event timestamp, not the process start', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 9000, agentStartedAt: 1500 }))
    expect(s.list()[0]!.lastEventAt).toBe(9000)
  })

  it('reports the same startedAt after a reap recreates the session', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 9000, agentStartedAt: 1500 }))
    s.reap(9000, () => false)
    expect(s.list()).toHaveLength(0)
    s.apply(ev({ kind: 'tool-start', tool: 'Edit', ts: 20000, agentStartedAt: 1500 }))
    expect(s.list()[0]!.startedAt, 'the clock must not restart with the record').toBe(1500)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/core/store.test.ts`
Expected: FAIL — `expected 9000 to be 1500`.

- [ ] **Step 3: Write the implementation**

In `src/core/store.ts`, in `ensure`, replace the `startedAt: e.ts,` line with:

```ts
        // The agent process's own start time when the shell layer could read it,
        // so a record recreated after a reap or a shell reload reports the same
        // number rather than restarting the clock at the current task.
        startedAt: e.agentStartedAt ?? e.ts,
```

`lastEventAt: e.ts` stays as it is: it answers "when did we last hear from this session", a different question.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/core/store.ts test/core/store.test.ts
git commit -m "feat(core): stamp startedAt from the agent process"
```

---

### Task 6: Resolve the agent in the shell layer

**Files:**
- Modify: `src/shell/windowFinder.ts:1-28` (imports, `resolveAgentPid` → `resolveAgent`)
- Modify: `src/dbus/service.ts:6` (import), `src/dbus/service.ts:79`, `src/dbus/service.ts:123`
- Modify: `docs/agent-dialects.md`
- Test: none automated — `src/shell` and `src/dbus` import `gi://` and are not unit tested in this repo (see `test/smoke.test.ts` for the existing boundary). Verified by typecheck, build, and the manual check below.

**Interfaces:**
- Consumes: `selectAgentPid` (Task 2), `agentStartMs` (Task 3), `adapters[...].procNames` (Task 4), `HookContext.agentStartedAt` (Task 4).
- Produces: `resolveAgent(agent: AgentId, hookPid: number): { pid: number; startedAt?: number }`. Removes `resolveAgentPid`.

- [ ] **Step 1: Replace the resolver**

In `src/shell/windowFinder.ts`, change the imports:

```ts
import GLib from 'gi://GLib'
import type Meta from 'gi://Meta'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import { adapters } from '../core/adapters/index.js'
import { agentStartMs, ancestorPids, selectAgentPid } from '../core/procParse.js'
import type { AgentId } from '../core/types.js'
```

`parsePpid` is no longer imported here — `selectAgentPid` and `ancestorPids` own the walking now.

Add a reader beside the existing `readStat`:

```ts
function readFile(path: string): string | null {
  try {
    const [ok, bytes] = GLib.file_get_contents(path)
    if (!ok) return null
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}
```

Then rewrite `readStat` in terms of it, so there is one read path:

```ts
function readStat(pid: number): string | null {
  return readFile(`/proc/${pid}/stat`)
}
```

Replace `resolveAgentPid` entirely with:

```ts
/**
 * The agent process behind a hook call, and when it started.
 *
 * The hook's parent is not the agent. Agents spawn hooks through a wrapper
 * shell running a compound command, which never execs and dies the instant the
 * hook exits — storing that pid made the reaper drop live sessions, reset the
 * elapsed clock on every recreation, and left jump-back with a dead ancestry
 * seed. `selectAgentPid` walks past it to the real process.
 *
 * `startedAt` is derived from that process rather than from this event, so it
 * is the same number every time it is computed: after a reap, after a shell
 * reload, or for a session that predates the extension being enabled. Omitted
 * whenever /proc cannot supply a value the store should trust.
 *
 * Must be called while the hook is still blocked in its D-Bus call, i.e. from
 * inside the method handler — a moment later the chain is gone.
 */
export function resolveAgent(
  agent: AgentId,
  hookPid: number
): { pid: number; startedAt?: number } {
  if (hookPid <= 0) return { pid: 0 }

  const pid = selectAgentPid(hookPid, adapters[agent].procNames, readStat)
  if (pid <= 0) return { pid: 0 }

  const stat = readStat(pid)
  // Read fresh, never cached: the kernel recomputes btime, and it jitters by
  // about a second across suspend. One small read per hook event.
  const procStat = readFile('/proc/stat')
  if (stat === null || procStat === null) return { pid }

  return { pid, startedAt: agentStartMs(stat, procStat, Date.now()) ?? undefined }
}
```

- [ ] **Step 2: Wire both D-Bus handlers**

In `src/dbus/service.ts`, change the import on line 6:

```ts
import { resolveAgent } from '../shell/windowFinder.js'
```

In `Notify`, replace the `normalizeFor` call:

```ts
    // Resolved now, while the hook is still alive to have a readable /proc
    // entry — its own pid is dead within milliseconds of this call returning.
    const agentProc = resolveAgent(agent, pid)
    const e = normalizeFor(agent, raw, {
      pid: agentProc.pid,
      agentStartedAt: agentProc.startedAt,
      ts: Date.now(),
      cwd,
      event,
    })
```

In `RequestPermissionAsync`, replace its `normalizeFor` call with the identical five-line context, keeping the surrounding `if (!e) return reply(fallthroughJson())`.

- [ ] **Step 3: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: no output from `tsc` and a successful esbuild run. A `resolveAgentPid is not exported` error here means a call site was missed — `grep -rn resolveAgentPid src` must come back empty.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS, including `test/core/purity.test.ts` — the new core code takes injected readers and imports no `gi://`.

- [ ] **Step 5: Document the spawn shape**

Append to `docs/agent-dialects.md`:

```markdown
## How agents spawn hooks

Claude runs a hook the way it runs any shell command: through a wrapper shell
executing a compound command, roughly

```
zsh -c 'source <shell-snapshot>.sh ... && eval <hook command>'
```

Because the command is compound, the shell never `exec`s the hook. It stays
alive as the hook's parent and exits the moment the hook does. So the hook's
ppid is a process that is dead milliseconds later, and it is not the agent.

`resolveAgent` therefore walks the ancestor chain and identifies the agent by
`comm` (`AgentAdapter.procNames`), falling back to the nearest non-shell
ancestor, and to `0` — meaning unknown — when neither matches. The session's
`startedAt` comes from that process's own start time in `/proc`, which makes it
recoverable at any point rather than observable only when `SessionStart` fires.
```

- [ ] **Step 6: Commit**

```bash
git add src/shell/windowFinder.ts src/dbus/service.ts docs/agent-dialects.md
git commit -m "fix(shell): resolve the real agent process behind a hook call"
```

- [ ] **Step 7: Verify against a real session**

No fixture can prove the spawn shape, so this is the check that closes the task.

```bash
make install
```

Then restart GNOME Shell (X11: `Alt+F2`, `r`, Enter; Wayland: log out and back in), open a terminal, and start a Claude session in any project.

Confirm all four:

1. The pill appears while Claude works.
2. Let a turn finish and wait at least 90 seconds — longer than one reaper sweep (`src/extension.ts:79`). The row must still be there.
3. Send a second prompt. The row's elapsed must keep climbing across both tasks, not restart.
4. Click **Jump**. The terminal window running that session must be raised, not "no window".

If step 2 fails, the resolved pid is still wrong: check what `comm` the agent actually reports with `ps -o pid,ppid,comm -p $(pgrep -n claude)` and whether that value is in `procNames`.

---

## Notes for the implementer

- `selectAgentPid` reads each pid's `stat` twice — once inside `ancestorPids`, once in its own loop. Deliberate: it keeps `ancestorPids` unchanged for its other caller, `findWindowForPid`. The reads are small, bounded at 20, and happen once per hook event.
- Task 6 is the only task that changes runtime behaviour. Tasks 1–5 are additive and safe to land independently.
