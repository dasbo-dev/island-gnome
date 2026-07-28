# Honest session states

Date: 2026-07-28
Status: approved, ready for planning

## Problem

The pill lies about what an agent is doing, in two directions.

**A working agent reads as idle.** `SessionStore.apply` maps `tool-end` to
`idle` (`src/core/store.ts:97`). Claude fires `PostToolUse` after every tool,
but the agent then keeps thinking and streaming text until it either calls
another tool or finishes its turn. The extension calls that gap `idle`, so the
pill strobes `working` → `idle` → `working` → `idle` once per tool call. The
same mapping makes the window between `UserPromptSubmit` and the first
`PreToolUse` read as idle too.

**A live session disappears.** `apply` maps `stop` to `done` and stamps
`doneAt` (`src/core/store.ts:102`), and `reap` drops a `done` session once
`doneLingerSeconds` has passed (`src/core/store.ts:174`). But Claude's `Stop`
fires at the end of *every assistant turn*, not at the end of the session. So
after each turn the session goes `done`, lingers ten seconds, and vanishes from
the popup — while the terminal is still open, waiting for the next prompt.
Claude Code has a real `SessionEnd` hook, which the extension does not install
(`CLAUDE_EVENTS`, `src/core/install/plan.ts:23`).

The root cause is one word doing two jobs: `EventKind` has a single terminal
kind, `stop`, so "the agent stopped talking" and "the session is over" are
indistinguishable — and `idle` has to cover both "between tools" and "waiting
for a human."

Two smaller defects fall out of the same code:

- `SessionRow.update` falls back to rendering the raw `session.state`
  (`src/shell/sessionRow.ts:153`), so a row reads `running` while the pill
  above it reads `working` for the same session.
- `done` is currently the only state that removes a session promptly. Agents
  with no session-end event, and Claude installs predating this change, have
  only the 15-minute stale sweep (`STALE_MS`, `src/core/store.ts:4`).

## Design

### 1. Split the terminal event — `src/core/types.ts`

`EventKind` renames `stop` to `turn-end` and gains `session-end`:

```ts
export type EventKind =
  | 'session-start'
  | 'prompt-submit'
  | 'tool-start'
  | 'tool-end'
  | 'turn-end'
  | 'session-end'
  | 'error'
```

`SessionState` is unchanged. No new state, no new field on `Session`.

### 2. The state machine — `src/core/store.ts`

`apply`'s switch becomes:

| kind | state | side effects |
|---|---|---|
| `session-start` | `idle` | clears `doneAt` |
| `prompt-submit` | `running` | clears `currentTool`, `detail`, `doneAt` |
| `tool-start` | `running` | sets `currentTool`, `detail`; clears `doneAt` |
| `tool-end` | `running` | clears `currentTool`, `detail` |
| `turn-end` | `idle` | clears `currentTool`, `detail` |
| `session-end` | `done` | sets `doneAt`; clears `currentTool`, `detail` |
| `error` | `error` | sets `detail` |

Two changes from today: `tool-end` no longer downgrades to `idle`, and the
terminal row splits so that only `session-end` reaches `done`.

Each state word now means exactly one thing. `running` is "the agent is busy",
whether inside a tool or thinking between them. `idle` is "the session is
alive and waiting on a human". `done` is "this session is over". None of the
three overlaps another.

The `pendingPermission` guard below the switch (`src/core/store.ts:119`) is
unchanged: it still records `deferredState` and forces `waiting`, and
`clearPending` still settles to the deferred value. Both keep working across
the rename because they never inspect the kind, only the state it produced.

`RANK` is unchanged. `done` still ranks below `idle`, which is still correct: a
finished session must not outrank a live one in `worstState()`.

### 3. Adapter remapping — `src/core/adapters/`

**Claude** (`claude.ts:5`). `Stop` maps to `turn-end`. A new `SessionEnd` entry
maps to `session-end`. Nothing else in `normalize` changes — it reads
`hook_event_name`, `session_id` and `cwd`, all of which `SessionEnd` carries.

**Codex** (`codex.ts:13`). `session.end` maps to `session-end` — it already
means that, and was only mapped to `stop` because `stop` was the sole terminal
kind. In the CamelCase half of the table, `Stop` maps to `turn-end` and a new
`SessionEnd` maps to `session-end`. `CODEX_EVENTS` is unchanged, so no Codex
config rewrite is needed.

**Antigravity** (`antigravity.ts:5`). `PostInvocation` maps to `turn-end`; it
was mapped to `tool-end` only because `tool-end` was the kind that produced
`idle`, which is the behaviour `turn-end` now names directly. `Stop` maps to
`turn-end`. Antigravity's vocabulary has no session-end event, so its sessions
never reach `done` — section 5 covers how they leave the pill.

The error guard at `antigravity.ts:52` is dropped:

```ts
const kind = baseKind === 'stop' ? 'stop' : error ? 'error' : baseKind
```

becomes a plain `const kind = error ? 'error' : baseKind`. That guard existed
solely because reclassifying an errored `Stop` as `error` would have stopped
the session ever reaching `done`, so it would never get a `doneAt` and would
sit for the full 15-minute stale window instead of the done-linger. `turn-end`
is not terminal and stamps no `doneAt`, so the reason is gone, and an errored
turn end should report `error`. The `error` state is not sticky in practice:
the next `PreInvocation` moves the session back to `running`. The comment above
the guard is deleted with it rather than left describing behaviour that no
longer exists.

### 4. What the row shows — `src/shell/sessionRow.ts`

The activity-text branch (`sessionRow.ts:142-154`) is replaced by an explicit
table. The first three rows are today's behaviour, unchanged:

| condition | text | hint styling |
|---|---|---|
| `pendingPermission` | `waiting for you · <tool> · <detail>` | no |
| `currentTool` and `detail` | `<tool> · <detail>` | no |
| `currentTool`, no `detail` | `<tool>` | no |
| `detail`, no `currentTool` | `<detail>` | no |
| `running`, no tool, no detail | `thinking…` | yes |
| `idle` | `idle` | yes |
| `done` | `done` | no |
| anything else | `error` | no |

Rows are evaluated top to bottom, so the `detail`-only row is what carries an
`error`. `apply`'s `error` case sets `detail` and leaves `currentTool` alone,
so an errored tool event keeps its tool name and renders through the
`currentTool` + `detail` row as `<tool> · <error text>`, while an error with no
tool in flight renders the error text alone. The final row is reached only by
`error` with no detail at all.

The `session.state` fallback disappears with this table, which is what removes
the `running` / `working` split between the row and the pill.

"Hint styling" means the label is dimmed so the placeholder reads as absence of
content rather than as content. Following `92efc1e`, which dimmed the
empty-state label via Clutter `opacity` after a CSS approach failed, this sets
`opacity` on `_activity` — restoring it to full opacity on every non-hint
branch, since `update()` is called repeatedly on the same widget. No new
stylesheet rule and no new style class: opacity alone carries the distinction,
exactly as it does for the empty-state label.

### 5. The reaper — `src/core/store.ts`

`reap` gains one rule, and the order of its checks becomes load-bearing:

1. `pendingPermission` — untouchable, except the existing zombie case
   (`deadline === 0` and the process is gone).
2. `state === 'done'` and `doneAt` set and `now - doneAt > doneLingerSeconds *
   1000` — drop.
3. `s.pid > 0 && !pidAlive(s.pid)` — drop.
4. `now - lastEventAt > STALE_MS && !pidAlive(s.pid)` — drop.

Rule 2 must sit above rule 3. A session ends because the agent process exited,
so `SessionEnd` and process death land inside the same 60-second sweep window.
Checking liveness first would reap the session before its done-linger elapsed,
and the `done` state would never be visible. Linger wins.

Rule 3 must be guarded on `s.pid > 0`. `resolveAgentPid` returns `0` when it
cannot read `/proc/<hookpid>/stat` (`src/shell/windowFinder.ts:23`), and
`pidAlive(0)` is `false` — without the guard, a session whose PID resolution
failed would be reaped on the first sweep while perfectly alive. Rule 4 stays
as the fallback for exactly those sessions: unresolved PID, no events for 15
minutes.

`s.pid` is the agent process, not the hook process — `Notify` and
`RequestPermission` resolve it through `resolveAgentPid` while the hook is
still blocked in its D-Bus call — so rule 3 is a genuine "is the agent still
running" test.

Rule 3 is what makes Antigravity work without a session-end event, and what
protects Claude users who never press **Update** in preferences: a closed
terminal clears the pill within one sweep, worst case 60 seconds. The
`SessionEnd` hook upgrades that to immediate removal, with a visible `done`
state first.

### 6. Installing the new hook — `src/core/install/plan.ts`

`CLAUDE_EVENTS` gains `'SessionEnd'`. It takes `notify` mode and needs no
matcher, so `claudeEdits` needs no change beyond the constant.

Migration needs no new machinery. `expectedClaudeEntries` becomes a six-element
list while an existing install presents five, `sameStrings` returns false,
`installState` returns `stale`, and the preferences row already renders
**Update** for `stale`. The README's line about **Update** appearing when the
extension directory moves is widened to cover an out-of-date event set.

No new GSettings keys. `done-linger` keeps its meaning and now applies to the
end of a session rather than the end of every turn.

## Testing

`test/core/store.test.ts` carries the old semantics as assertions, so several
tests change rather than get added:

- `'returns to idle on tool-end and clears the tool'` (line 44) asserts
  `running` with a cleared tool, and is renamed accordingly.
- `'marks done on stop and stamps doneAt'` (line 52) splits: `turn-end`
  settles to `idle` and stamps no `doneAt`; `session-end` marks `done` and
  stamps it.
- The deferred-permission tests at lines 154 and 170: `tool-end` under a
  pending permission settles to `running`, not `idle`; the `stop` case becomes
  a `session-end` case settling to `done`, and a new case covers `turn-end`
  settling to `idle`.
- Line 74 (`'notifies subscribers on change and stops after unsubscribe'`) uses
  `stop` only as an arbitrary second event; `turn-end` preserves its intent.
- Line 116 (`'reap drops a done session after the linger window'`) needs
  `session-end`, since that is now the only kind that produces `done`.
- Line 190 (the resumed-session regression test) loses its premise. It asserts
  that a session which "finished a turn" was left `done` with a stale `doneAt`
  that a later `clearPending` could resurrect. A turn end no longer produces
  `done` or stamps `doneAt`, so that path cannot occur. Rewrite it as
  `session-end` → `done` → `prompt-submit`, which still exercises the
  `doneAt`-clearing the test was written to protect, and keep the comment
  explaining the original bug.

New reaper tests: a live-PID session is not reaped; a dead-PID session is
reaped without waiting for `STALE_MS`; a `pid === 0` session survives until the
stale window; a `done` session with a dead PID survives until its linger
expires.

The existing `'reap drops a stale session whose pid is dead'` (line 101) still
passes — `ev()` supplies `pid: 4242` and the fake `pidAlive` returns false, so
rule 3 drops it — but it now passes for a different reason than its name
claims, since the 15-minute wait is no longer what triggers it. It is renamed
to say what it now proves, or folded into the new dead-PID test.

Adapter tests gain a `Stop` → `turn-end` case and a `SessionEnd` →
`session-end` case per agent, and `antigravity.test.ts` gains a case asserting
that a `Stop` with a non-empty `error` now yields `error`.

Claude has real `Stop` fixtures (`Stop-{7,16}.json`) but **no `SessionEnd`
fixture** — nothing was captured for an event that was never wired. The
adapter reads only `hook_event_name`, `session_id` and `cwd` from it, all
documented for `SessionEnd`, so a hand-written payload is a defensible test.
It must be marked synthetic and kept out of `test/fixtures/claude/`, which
holds verbatim captures; `docs/agent-dialects.md` already draws that line
between captured and inferred and must keep drawing it.

`test/core/install/plan.test.ts` needs the six-event Claude expectation
throughout, plus a test asserting that a five-event install reports `stale`.

`tools/fake-agent.js` is checked for event names it emits and updated if it
emits `Stop` expecting a `done` state.

## Risks

**Claude's `Stop` and subagents.** `SubagentStop` is a separate event and is
not wired, so a subagent finishing cannot flip the parent session to `idle`.

**A blocking `Stop` hook.** Claude's `Stop` can be blocked and the turn
resumed, producing `Stop` followed by more tool events. Harmless: `idle` moves
back to `running` on the next event.

**Antigravity loses `done` entirely.** Its sessions go from `idle` straight to
gone when the process exits, with no linger. Accepted: Antigravity's permission
path is already documented as unverified, and the alternative is inventing a
session-end signal the agent does not emit. Its `Stop` payload carries a
`fullyIdle` boolean, which is a turn-level flag, not a session-level one, and
is deliberately not used as a session-end proxy.

**The `SessionEnd` payload is uncaptured.** If Claude names the event
differently than documented, the hook installs and fires but normalizes to
`null`, and the session's removal degrades to the PID sweep — the same
behaviour as not having the hook at all. Fails safe.

## Out of scope

No new `SessionState` value. No `Notification` or `SubagentStop` wiring. No
idle-timeout setting. No change to permission handling, `deferredState`,
jump-back, the elapsed timer, or the pill and popup width work from `c7503d3`.
