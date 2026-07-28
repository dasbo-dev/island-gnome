# Honest Session States Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the top-bar pill tell the truth — a thinking agent reads as working, and a live session stops vanishing after every turn.

**Architecture:** `EventKind` currently has one terminal kind, `stop`, which cannot distinguish "the agent stopped talking" from "the session is over". Split it into `turn-end` (settles to `idle`) and `session-end` (settles to `done`), stop letting `tool-end` downgrade to `idle`, wire Claude's real `SessionEnd` hook, and reap on agent-process death so agents without a session-end event still clear the pill promptly.

**Tech Stack:** TypeScript, GJS / GNOME Shell 46, vitest, esbuild.

Spec: `docs/superpowers/specs/2026-07-28-honest-session-states-design.md`

## Global Constraints

- `src/core/**` must never import `gi://` or `resource://` — enforced by `test/core/purity.test.ts`. All new pure logic goes in `src/core/`.
- No new `SessionState` value. The set stays `idle | running | waiting | done | error`.
- No new `Session` field. No new GSettings key. No new stylesheet rule or style class.
- Every task ends green on both `npm test` and `npm run typecheck`.
- `test/fixtures/claude/` and `test/fixtures/antigravity/` hold verbatim captured payloads only. Hand-written payloads are inline in test files, never added to those directories.
- Commit messages follow the repo's conventional-commit style (`fix(shell):`, `feat:`, `refactor:`, `docs:`), lowercase subject, no trailing period.

## File Structure

| File | Change | Responsibility after the change |
|---|---|---|
| `src/core/types.ts` | Modify | `EventKind` gains `turn-end` and `session-end` in place of `stop` |
| `src/core/store.ts` | Modify | State machine and reaper |
| `src/core/adapters/claude.ts` | Modify | `Stop` → `turn-end`, `SessionEnd` → `session-end` |
| `src/core/adapters/codex.ts` | Modify | `session.end` → `session-end`, `Stop` → `turn-end` |
| `src/core/adapters/antigravity.ts` | Modify | `PostInvocation`/`Stop` → `turn-end`; error guard dropped |
| `src/core/activity.ts` | **Create** | Pure: a `Session` → the row's activity text and whether it is a dim hint |
| `src/shell/sessionRow.ts` | Modify | Renders what `activity.ts` decides; owns only the widget |
| `src/core/install/plan.ts` | Modify | `CLAUDE_EVENTS` gains `SessionEnd` |
| `README.md` | Modify | Widen what **Update** covers |
| `test/core/store.test.ts` | Modify | State-machine and reaper tests |
| `test/core/activity.test.ts` | **Create** | Activity-text table |
| `test/core/adapters/{claude,codex,antigravity}.test.ts` | Modify | Event-mapping tests |
| `test/core/install/plan.test.ts` | Modify | Six-event Claude expectation, stale-install test |

`src/core/activity.ts` is a new file rather than an addition to `format.ts` because `format.ts` holds generic string helpers that know nothing about the domain, while this maps a `Session` to display text. It exists mainly so the row's branching becomes unit-testable — `src/shell/**` cannot be tested here, since St widgets need a running GNOME Shell.

`tools/fake-agent.js` needs no change: it emits only `SessionStart` and `PreToolUse`.

---

### Task 1: Rename `stop` to `turn-end`

Pure mechanical rename across five source files and four test files. No behaviour changes — `turn-end` still produces `done` at the end of this task. This exists as its own commit so the behaviour changes in Tasks 2 and 3 are readable as diffs instead of being buried in a rename.

**Files:**
- Modify: `src/core/types.ts:25`
- Modify: `src/core/store.ts:102`
- Modify: `src/core/adapters/claude.ts:10`
- Modify: `src/core/adapters/codex.ts:15,22`
- Modify: `src/core/adapters/antigravity.ts:10,52`
- Test: `test/core/store.test.ts`, `test/core/adapters/claude.test.ts`, `test/core/adapters/codex.test.ts`, `test/core/adapters/antigravity.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `EventKind` includes `'turn-end'` and no longer includes `'stop'`.

- [ ] **Step 1: Confirm the suite is green before touching anything**

Run: `npm test`
Expected: PASS, all files. If anything fails here, stop — the baseline is broken and nothing below is trustworthy.

- [ ] **Step 2: Rename the kind in `src/core/types.ts`**

In the `EventKind` union (line 20-26), replace `| 'stop'` with `| 'turn-end'`:

```ts
export type EventKind =
  | 'session-start'
  | 'prompt-submit'
  | 'tool-start'
  | 'tool-end'
  | 'turn-end'
  | 'error'
```

- [ ] **Step 3: Rename the case in `src/core/store.ts`**

Line 102, `case 'stop':` becomes `case 'turn-end':`. The body is unchanged:

```ts
      case 'turn-end':
        kindState = 'done'
        s.doneAt = e.ts
        s.currentTool = undefined
        s.detail = undefined
        break
```

- [ ] **Step 4: Rename in all three adapters**

`src/core/adapters/claude.ts` line 10:

```ts
  Stop: 'turn-end',
```

`src/core/adapters/codex.ts` lines 15 and 22:

```ts
  'session.end': 'turn-end',
```

```ts
  Stop: 'turn-end',
```

`src/core/adapters/antigravity.ts` line 10:

```ts
  Stop: 'turn-end',
```

`src/core/adapters/antigravity.ts` line 52 — the guard's own text refers to the kind:

```ts
    const kind = baseKind === 'turn-end' ? 'turn-end' : error ? 'error' : baseKind
```

- [ ] **Step 5: Run typecheck to find every remaining reference**

Run: `npm run typecheck`
Expected: PASS. If it reports `Type '"stop"' is not assignable to type 'EventKind'` anywhere, that file was missed — fix it and re-run.

- [ ] **Step 6: Rename in the tests**

`test/core/store.test.ts` — five occurrences of `kind: 'stop'` become `kind: 'turn-end'`, at lines 55, 74, 116, 176 and 190. Two test titles mention it and are renamed:

```ts
  it('marks done on turn-end and stamps doneAt', () => {
```

```ts
  it('applying turn-end while a permission is pending leaves state waiting, and resolving settles to done', () => {
```

`test/core/adapters/claude.test.ts` line 43:

```ts
    expect(e?.kind).toBe('turn-end')
```

line 77:

```ts
    expect(kinds).toEqual(['tool-end', 'prompt-submit', 'turn-end'])
```

line 179:

```ts
    expect(kinds).toContain('turn-end')
```

`test/core/adapters/codex.test.ts` line 19:

```ts
      ['session.end', 'turn-end'],
```

`test/core/adapters/antigravity.test.ts` line 53:

```ts
      ['Stop', 'turn-end'],
```

line 80:

```ts
    expect(e?.kind).toBe('turn-end')
```

- [ ] **Step 7: Run the full suite**

Run: `npm test && npm run typecheck`
Expected: PASS, with the same number of passing tests as Step 1. A rename that changes the count means a test was lost.

- [ ] **Step 8: Commit**

```bash
git add src/core/types.ts src/core/store.ts src/core/adapters test/core
git commit -m "refactor: rename the stop event kind to turn-end"
```

---

### Task 2: Add `session-end`, and settle `turn-end` to idle

This is the fix for the vanishing session. `turn-end` stops meaning "the session is over" and starts meaning "the agent finished talking"; a new `session-end` kind takes over `done`.

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/store.ts`
- Modify: `src/core/adapters/claude.ts`
- Modify: `src/core/adapters/codex.ts`
- Test: `test/core/store.test.ts`, `test/core/adapters/claude.test.ts`, `test/core/adapters/codex.test.ts`

**Interfaces:**
- Consumes: `EventKind` from Task 1.
- Produces: `EventKind` includes `'session-end'`. `SessionStore.apply` maps `turn-end` → `idle` (no `doneAt`) and `session-end` → `done` (stamps `doneAt`).

- [ ] **Step 1: Write the failing tests**

In `test/core/store.test.ts`, replace the single test at line 52 (`'marks done on turn-end and stamps doneAt'`) with these two:

```ts
  it('settles to idle on turn-end and stamps no doneAt', () => {
    const s = new SessionStore()
    s.apply(ev())
    s.apply(ev({ kind: 'turn-end', ts: 5000 }))
    expect(s.list()[0]!.state, 'a finished turn is not a finished session').toBe('idle')
    expect(s.list()[0]!.doneAt).toBeUndefined()
  })

  it('marks done on session-end and stamps doneAt', () => {
    const s = new SessionStore()
    s.apply(ev())
    s.apply(ev({ kind: 'session-end', ts: 5000 }))
    expect(s.list()[0]!.state).toBe('done')
    expect(s.list()[0]!.doneAt).toBe(5000)
  })
```

Change the reap-linger test (line 113) to use `session-end`, since that is now the only kind that produces `done`:

```ts
  it('reap drops a done session after the linger window', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.apply(ev({ kind: 'session-end', ts: 1000 }))
    s.reap(1000 + 10_000 + 1, () => true)
    expect(s.list()).toHaveLength(0)
  })
```

Replace the deferred-permission test at line 170 with these two — one per terminal kind:

```ts
  it('applying turn-end while a permission is pending leaves state waiting, and resolving settles to idle', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.setPending('claude:s1', { id: 'p1', tool: 'Bash', detail: 'rm -rf build', deadline: 30_000, queued: 0 })
    expect(s.list()[0]!.state).toBe('waiting')

    s.apply(ev({ kind: 'turn-end', ts: 2000 }))
    expect(s.list()[0]!.state, 'must still say waiting until the permission resolves').toBe('waiting')
    expect(s.list()[0]!.doneAt).toBeUndefined()

    s.clearPending('claude:s1')
    expect(s.list()[0]!.state).toBe('idle')
  })

  it('applying session-end while a permission is pending leaves state waiting, and resolving settles to done', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.setPending('claude:s1', { id: 'p1', tool: 'Bash', detail: 'rm -rf build', deadline: 30_000, queued: 0 })
    expect(s.list()[0]!.state).toBe('waiting')

    s.apply(ev({ kind: 'session-end', ts: 2000 }))
    expect(s.list()[0]!.state, 'must still say waiting until the permission resolves').toBe('waiting')
    expect(s.list()[0]!.doneAt).toBe(2000)

    s.clearPending('claude:s1')
    expect(s.list()[0]!.state).toBe('done')
  })
```

Rewrite the stale-`doneAt` regression test at line 184. Its premise — that finishing a *turn* left a stale `doneAt` — no longer exists, but the `doneAt`-clearing it protects still matters for a session-end followed by more events:

```ts
  it('does not settle a resumed session to done from a stale doneAt', () => {
    // A session that had finished and was resumed still carried its old doneAt,
    // so resolving a later permission marked the live session done and the next
    // reaper sweep deleted its row. Reaching 'done' now takes a session-end,
    // but the stale stamp must still be cleared when the session comes back.
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.apply(ev({ kind: 'session-end', ts: 1000 }))
    expect(s.list()[0]!.state).toBe('done')

    s.apply(ev({ kind: 'prompt-submit', ts: 2000 }))
    expect(s.list()[0]!.state).toBe('running')
    expect(s.list()[0]!.doneAt, 'resuming clears the finish stamp').toBeUndefined()

    // No event arrives during the hold, so there is nothing deferred and idle
    // is the correct settle — but it must not be 'done', and the session must
    // not be reapable as finished.
    s.setPending('claude:s1', { id: 'p1', tool: 'Bash', deadline: 30_000, queued: 0 })
    s.clearPending('claude:s1')
    expect(s.list()[0]!.state, 'a live session must not settle to done').toBe('idle')

    expect(s.reap(20_000, () => true), 'and must not be reaped as finished').toEqual([])
    expect(s.list()).toHaveLength(1)
  })
```

In `test/core/adapters/claude.test.ts`, replace the test at line 73:

```ts
  it('maps PostToolUse, UserPromptSubmit, Stop and SessionEnd', () => {
    const kinds = ['PostToolUse', 'UserPromptSubmit', 'Stop', 'SessionEnd'].map(
      (n) => claudeAdapter.normalize({ hook_event_name: n, session_id: 's1', cwd: '/p' }, ctx)?.kind
    )
    expect(kinds).toEqual(['tool-end', 'prompt-submit', 'turn-end', 'session-end'])
  })
```

In `test/core/adapters/codex.test.ts`, change the dotted-name case at line 19 and add a CamelCase pair. The `cases` array at lines 17-22 becomes:

```ts
    const cases: Array<[string, string]> = [
      ['session.start', 'session-start'],
      ['session.end', 'session-end'],
      ['tool.start', 'tool-start'],
      ['tool.end', 'tool-end'],
    ]
```

and add this test directly after the existing `'also accepts CamelCase hook_event_name payloads'` test:

```ts
  it('maps the CamelCase terminal events apart, as Claude does', () => {
    const kinds = ['Stop', 'SessionEnd'].map(
      (n) => codexAdapter.normalize({ hook_event_name: n, session_id: 's1', cwd: '/p' }, ctx)?.kind
    )
    expect(kinds).toEqual(['turn-end', 'session-end'])
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL. `store.test.ts` reports `expected 'done' to be 'idle'` for the turn-end test and `expected undefined to be 5000` for the session-end test; the adapter tests report `expected undefined to be 'session-end'`, because `SessionEnd` is not yet in any `KIND_BY_EVENT` and `normalize` returns `null` for an unknown event.

- [ ] **Step 3: Add the kind to `src/core/types.ts`**

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

Also update the doc comment on `Session.doneAt` (line 74) so it names the event that stamps it:

```ts
  /** Set when a session-end arrives; used for the done-linger sweep. */
  doneAt?: number
```

- [ ] **Step 4: Split the case in `src/core/store.ts`**

Replace the single `case 'turn-end':` block with two:

```ts
      case 'turn-end':
        // The agent finished talking, not the session. Claude fires Stop at the
        // end of every assistant turn while the terminal stays open, so this is
        // 'waiting on a human', not 'finished' — and it must stamp no doneAt,
        // or the linger sweep would delete a live session.
        kindState = 'idle'
        s.currentTool = undefined
        s.detail = undefined
        break
      case 'session-end':
        kindState = 'done'
        s.doneAt = e.ts
        s.currentTool = undefined
        s.detail = undefined
        break
```

- [ ] **Step 5: Map the new event in the adapters**

`src/core/adapters/claude.ts`, `KIND_BY_EVENT`:

```ts
const KIND_BY_EVENT: Record<string, EventKind> = {
  SessionStart: 'session-start',
  UserPromptSubmit: 'prompt-submit',
  PreToolUse: 'tool-start',
  PostToolUse: 'tool-end',
  Stop: 'turn-end',
  SessionEnd: 'session-end',
}
```

`src/core/adapters/codex.ts`, `KIND_BY_EVENT` — `session.end` is a genuine session end and was only mapped to the terminal kind because there was one; the CamelCase half gains `SessionEnd`:

```ts
const KIND_BY_EVENT: Record<string, EventKind> = {
  'session.start': 'session-start',
  'session.end': 'session-end',
  'tool.start': 'tool-start',
  'tool.end': 'tool-end',
  SessionStart: 'session-start',
  SessionEnd: 'session-end',
  UserPromptSubmit: 'prompt-submit',
  PreToolUse: 'tool-start',
  PostToolUse: 'tool-end',
  Stop: 'turn-end',
}
```

Antigravity is deliberately untouched: its vocabulary has no session-end event, so it never reaches `done`. Task 4's reaper is what clears its sessions.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/types.ts src/core/store.ts src/core/adapters test/core
git commit -m "fix(store): stop treating the end of a turn as the end of a session"
```

---

### Task 3: Keep a session running between tool calls

This is the fix for the strobing pill. `tool-end` stops downgrading to `idle`; the agent is thinking, not waiting.

**Files:**
- Modify: `src/core/store.ts`
- Modify: `src/core/adapters/antigravity.ts`
- Test: `test/core/store.test.ts`, `test/core/adapters/antigravity.test.ts`

**Interfaces:**
- Consumes: `EventKind` including `turn-end` and `session-end` from Task 2.
- Produces: `apply` maps `tool-end` → `running` with `currentTool` and `detail` cleared. `idle` now means only "alive, waiting on a human".

- [ ] **Step 1: Write the failing tests**

In `test/core/store.test.ts`, replace the test at line 44:

```ts
  it('stays running on tool-end and clears the tool', () => {
    const s = new SessionStore()
    s.apply(ev({ kind: 'tool-start', tool: 'Edit' }))
    s.apply(ev({ kind: 'tool-end', tool: 'Edit', ts: 3000 }))
    expect(s.list()[0]!.state, 'the agent is thinking, not waiting').toBe('running')
    expect(s.list()[0]!.currentTool).toBeUndefined()
    expect(s.list()[0]!.detail).toBeUndefined()
  })
```

Replace the deferred tool-end test at line 154 — a tool-end under a held permission now defers to `running`:

```ts
  it('applying tool-end while a permission is pending leaves state waiting, and resolving settles to running', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.setPending('claude:s1', { id: 'p1', tool: 'Bash', detail: 'rm -rf build', deadline: 30_000, queued: 0 })
    expect(s.list()[0]!.state).toBe('waiting')

    // A parallel tool batch: another tool's tool-end arrives while Bash's
    // permission is still held open.
    s.apply(ev({ kind: 'tool-end', tool: 'Edit', ts: 1000 }))
    expect(s.list()[0]!.state, 'must still say waiting — the agent is still blocked').toBe('waiting')
    expect(s.list()[0]!.pendingPermission?.id).toBe('p1')

    s.clearPending('claude:s1')
    expect(s.list()[0]!.state, 'the batch is still running').toBe('running')
  })
```

In `test/core/adapters/antigravity.test.ts`, change the `PostInvocation` pair at line 47 — an invocation ending is a turn ending, which is now a kind of its own:

```ts
    const pairs: Array<[string, string]> = [
      ['PreInvocation', 'prompt-submit'],
      ['PostInvocation', 'turn-end'],
      ['PreToolUse', 'tool-start'],
      ['PostToolUse', 'tool-end'],
      ['Stop', 'turn-end'],
    ]
```

and replace the test at line 76 with its inverse — the guard that suppressed it is going away:

```ts
  it('reports an errored Stop as an error, since a turn end is no longer terminal', () => {
    const e = antigravityAdapter.normalize(
      { conversationId: 'c1', error: 'boom' }, ctx('Stop')
    )
    expect(e?.kind).toBe('error')
    expect(e?.detail, 'the error text is still surfaced as detail').toBe('boom')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `expected 'idle' to be 'running'` in `store.test.ts`, and `expected 'turn-end' to be 'error'` plus `expected 'tool-end' to be 'turn-end'` in `antigravity.test.ts`.

- [ ] **Step 3: Stop the downgrade in `src/core/store.ts`**

Replace the `tool-end` case:

```ts
      case 'tool-end':
        // Not idle: the agent keeps thinking and streaming between tool calls,
        // and Claude fires PostToolUse after every one of them. Downgrading here
        // made the pill strobe working/idle once per tool. The absence of
        // currentTool is what the row reads as "thinking".
        kindState = 'running'
        s.currentTool = undefined
        s.detail = undefined
        break
```

- [ ] **Step 4: Remap and simplify `src/core/adapters/antigravity.ts`**

`KIND_BY_EVENT` — `PostInvocation` was mapped to `tool-end` only because `tool-end` was the kind that produced `idle`, which `turn-end` now names directly:

```ts
const KIND_BY_EVENT: Record<string, EventKind> = {
  PreInvocation: 'prompt-submit',
  PostInvocation: 'turn-end',
  PreToolUse: 'tool-start',
  PostToolUse: 'tool-end',
  Stop: 'turn-end',
}
```

Replace lines 44-52 in their entirety — the four-line comment at 48-51 and the guard at 52 both go:

```ts
    // `error` is present but empty on success; only a non-empty value is a failure.
    const error = str(raw['error'])
    const toolCall = raw['toolCall']
    const kind = error ? 'error' : baseKind
```

The guard existed only because reclassifying an errored `Stop` as `error` would have stopped the session ever reaching `done`, so it would never get a `doneAt` and would sit out the full 15-minute stale window rather than the done-linger. `turn-end` is not terminal and stamps no `doneAt`, so the reason is gone, and the comment describing it must go with it rather than be left describing behaviour the code no longer has.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/store.ts src/core/adapters/antigravity.ts test/core
git commit -m "fix(store): keep a session running while the agent thinks between tools"
```

---

### Task 4: Reap a session when its agent process dies

Without this, an agent with no session-end event — Antigravity, or a Claude install predating Task 6's hook — leaves a dead session on the pill for fifteen minutes.

**Files:**
- Modify: `src/core/store.ts:158-185`
- Test: `test/core/store.test.ts`

**Interfaces:**
- Consumes: `SessionStore.reap(now, pidAlive)`, unchanged signature.
- Produces: `reap` drops any session with no pending permission whose `pid > 0` and whose `pidAlive(pid)` is false, unless it is a `done` session still inside its linger window.

- [ ] **Step 1: Write the failing tests**

Add these four tests to `test/core/store.test.ts`, directly after the existing `'reap keeps a stale session whose pid is still alive'` test:

```ts
  it('reap drops a session whose agent process is gone, without waiting for the stale window', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    const dropped = s.reap(1000, () => false)
    expect(s.list()).toHaveLength(0)
    expect(dropped).toEqual(['claude:s1'])
  })

  it('reap keeps a fresh session whose agent process is alive', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.reap(1000, () => true)
    expect(s.list()).toHaveLength(1)
  })

  it('reap never uses liveness on an unresolved pid, which would delete a live session', () => {
    // resolveAgentPid returns 0 when it cannot read /proc, and pidAlive(0) is
    // false. Without the pid > 0 guard this session would go on the first sweep.
    const s = new SessionStore()
    s.apply(ev({ ts: 0, pid: 0 }))
    s.reap(1000, () => false)
    expect(s.list(), 'an unresolved pid falls back to the stale window').toHaveLength(1)
    s.reap(15 * 60 * 1000 + 1, () => false)
    expect(s.list()).toHaveLength(0)
  })

  it('reap lets a done session finish its linger even though the agent has exited', () => {
    // A session ends because the agent exited, so session-end and process death
    // land in the same sweep. Liveness must not pre-empt the linger, or 'done'
    // would never be visible.
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.apply(ev({ kind: 'session-end', ts: 1000 }))
    s.reap(2000, () => false)
    expect(s.list(), 'still lingering').toHaveLength(1)
    expect(s.list()[0]!.state).toBe('done')
    s.reap(1000 + 10_000 + 1, () => false)
    expect(s.list()).toHaveLength(0)
  })
```

Rename the existing test at line 98 to say what it now proves — the dead pid, not the fifteen minutes, is what drops it:

```ts
  it('reap drops a session whose pid is dead even once it is also stale', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    const fifteenMin = 15 * 60 * 1000
    s.reap(fifteenMin + 1, () => false)
    expect(s.list()).toHaveLength(0)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `'reap drops a session whose agent process is gone…'` reports `expected [ {…} ] to have a length of 0`, and `'reap lets a done session finish its linger…'` passes already but must stay passing after Step 3.

- [ ] **Step 3: Rewrite `reap` in `src/core/store.ts`**

Replace the loop body (lines 160-182) with:

```ts
    for (const [key, s] of [...this.sessions]) {
      if (s.pendingPermission) {
        // Normally a pending permission is untouchable — its own timer (if any)
        // will resolve it. But with permission-timeout = 0 no timer ever starts,
        // so a killed agent mid-permission would otherwise wedge this session
        // forever. Only collect it once the process is confirmed gone AND no
        // timer will ever fire.
        const zombie = s.pendingPermission.deadline === 0 && !pidAlive(s.pid)
        if (zombie) {
          this.sessions.delete(key)
          dropped.push(key)
        }
        continue
      }
      // Linger is checked before liveness, and the order is load-bearing: a
      // session ends because its agent exited, so the session-end event and the
      // process's death land inside the same sweep. Testing liveness first would
      // delete the row before its linger elapsed and 'done' would never be seen.
      if (s.state === 'done' && s.doneAt !== undefined) {
        if (now - s.doneAt > this.doneLingerSeconds * 1000) {
          this.sessions.delete(key)
          dropped.push(key)
        }
        continue
      }
      // `pid` is the agent process, not the hook — the D-Bus handlers resolve it
      // through resolveAgentPid while the hook is still blocked in its call — so
      // this is a real liveness test. It is the only thing that clears the pill
      // for an agent with no session-end event, or a Claude install predating the
      // SessionEnd hook. Guarded on pid > 0 because resolveAgentPid returns 0
      // when it cannot read /proc and pidAlive(0) is false, which would otherwise
      // reap a perfectly live session on the very first sweep. Those fall back to
      // the stale window below.
      const agentGone = s.pid > 0 && !pidAlive(s.pid)
      const abandoned = now - s.lastEventAt > STALE_MS && !pidAlive(s.pid)
      if (agentGone || abandoned) {
        this.sessions.delete(key)
        dropped.push(key)
      }
    }
```

Also update the `reap` doc comment above it (lines 152-157) so the sentence about what it drops matches:

```ts
  /**
   * Drop finished, dead and abandoned sessions. Returns the keys it dropped, so
   * the caller can release anything (e.g. a held D-Bus permission reply) tied to
   * them — this store must not depend on PermissionTable to do that itself.
   * `pidAlive` is injected so this stays free of any filesystem dependency.
   */
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/store.ts test/core/store.test.ts
git commit -m "fix(store): reap a session as soon as its agent process is gone"
```

---

### Task 5: Render "thinking…" in the session row

The row currently prints the raw `session.state`, so it reads `running` while the pill above it reads `working` for the same session. Replace that fallback with an explicit table, extracted into `src/core/` so it can be tested — `src/shell/**` needs a running GNOME Shell and has no tests here.

**Files:**
- Create: `src/core/activity.ts`
- Create: `test/core/activity.test.ts`
- Modify: `src/shell/sessionRow.ts:134-164`

**Interfaces:**
- Consumes: `Session` from `src/core/types.ts`; `truncateDetail` from `src/core/format.ts`.
- Produces: `activityText(session: Session): { text: string; hint: boolean }` exported from `src/core/activity.ts`. `hint: true` means the text is a placeholder and should be dimmed.

- [ ] **Step 1: Write the failing test**

Create `test/core/activity.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { activityText } from '../../src/core/activity.js'
import type { Session } from '../../src/core/types.js'

function session(over: Partial<Session> = {}): Session {
  return {
    key: 'claude:s1',
    agent: 'claude',
    sessionId: 's1',
    project: 'dasbo-island',
    cwd: '/home/me/projects/dasbo-island',
    state: 'idle',
    pid: 4242,
    startedAt: 0,
    lastEventAt: 0,
    ...over,
  }
}

describe('activityText', () => {
  it('names the pending tool and its detail, with the queue depth', () => {
    const r = activityText(session({
      state: 'waiting',
      pendingPermission: { id: 'p1', tool: 'Bash', detail: 'rm -rf build', deadline: 0, queued: 2 },
    }))
    expect(r.text).toBe('waiting for you · Bash · rm -rf build · +2 more')
    expect(r.hint).toBe(false)
  })

  it('omits the queue suffix when nothing is behind the request', () => {
    const r = activityText(session({
      state: 'waiting',
      pendingPermission: { id: 'p1', tool: 'Bash', deadline: 0, queued: 0 },
    }))
    expect(r.text).toBe('waiting for you · Bash')
  })

  it('bounds a hostile tool name in a pending request', () => {
    const r = activityText(session({
      state: 'waiting',
      pendingPermission: { id: 'p1', tool: 'T'.repeat(200), deadline: 0, queued: 0 },
    }))
    expect(r.text, 'an unbounded tool name pushes Allow and Deny off screen').toContain('…')
    expect(r.text).toBe(`waiting for you · ${'T'.repeat(39)}…`)
  })

  it('shows the running tool and its detail', () => {
    const r = activityText(session({ state: 'running', currentTool: 'Edit', detail: 'src/main.js' }))
    expect(r.text).toBe('Edit · src/main.js')
    expect(r.hint).toBe(false)
  })

  it('shows the running tool alone when there is no detail', () => {
    const r = activityText(session({ state: 'running', currentTool: 'Read' }))
    expect(r.text).toBe('Read')
  })

  it('shows a detail with no tool, which is how an error without a tool reads', () => {
    const r = activityText(session({ state: 'error', detail: 'boom' }))
    expect(r.text).toBe('boom')
    expect(r.hint).toBe(false)
  })

  it('calls a running session with no tool thinking, as a dim hint', () => {
    const r = activityText(session({ state: 'running' }))
    expect(r.text).toBe('thinking…')
    expect(r.hint).toBe(true)
  })

  it('calls an idle session idle, as a dim hint', () => {
    const r = activityText(session({ state: 'idle' }))
    expect(r.text).toBe('idle')
    expect(r.hint).toBe(true)
  })

  it('says done for a finished session, at full weight', () => {
    const r = activityText(session({ state: 'done' }))
    expect(r.text).toBe('done')
    expect(r.hint).toBe(false)
  })

  it('says error for an error carrying no detail', () => {
    const r = activityText(session({ state: 'error' }))
    expect(r.text).toBe('error')
    expect(r.hint).toBe(false)
  })

  it('never returns the raw state word for a running session, which the pill calls working', () => {
    const r = activityText(session({ state: 'running' }))
    expect(r.text).not.toBe('running')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/core/activity.test.ts`
Expected: FAIL with `Failed to resolve import "../../src/core/activity.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/core/activity.ts`:

```ts
import { truncateDetail } from './format.js'
import type { Session } from './types.js'

/** What the session row's activity label says, and whether it is a placeholder. */
export interface Activity {
  text: string
  /**
   * True when the text stands in for absent content ("thinking…", "idle")
   * rather than reporting something the agent is doing. The row dims these so
   * a placeholder does not read as a tool name.
   */
  hint: boolean
}

/**
 * The row's activity text, decided in one place so the branches are testable —
 * `src/shell` needs a running GNOME Shell and cannot be unit-tested here.
 *
 * Order matters: the branches run top to bottom, so an error carrying a detail
 * but no tool falls into the detail-only branch. `apply` sets `detail` and
 * leaves `currentTool` alone for an error, so an errored tool event still
 * renders as `<tool> · <error text>`.
 *
 * There is deliberately no branch that prints `session.state`. The pill renders
 * `running` as "working" (STATE_WORD in island.ts), so a row falling back to the
 * raw word made the same session read two ways at once.
 */
export function activityText(session: Session): Activity {
  const pending = session.pendingPermission
  if (pending) {
    // The tool name comes from the payload, so it needs bounding for the same
    // reason detail does — an unbounded label pushes Allow and Deny off screen.
    const tool = truncateDetail(pending.tool, 40)
    const what = pending.detail ? `${tool} · ${truncateDetail(pending.detail)}` : tool
    const more = pending.queued > 0 ? ` · +${pending.queued} more` : ''
    return { text: `waiting for you · ${what}${more}`, hint: false }
  }

  const tool = session.currentTool
  const detail = session.detail
  if (tool && detail) return { text: `${tool} · ${truncateDetail(detail)}`, hint: false }
  if (tool) return { text: tool, hint: false }
  if (detail) return { text: truncateDetail(detail), hint: false }

  if (session.state === 'running') return { text: 'thinking…', hint: true }
  if (session.state === 'idle') return { text: 'idle', hint: true }
  if (session.state === 'done') return { text: 'done', hint: false }
  return { text: 'error', hint: false }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/core/activity.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Use it from the row**

In `src/shell/sessionRow.ts`, add the import beside the existing `format.js` one at line 6:

```ts
import { formatElapsed } from '../core/format.js'
import { activityText } from '../core/activity.js'
```

Note that `truncateDetail` moves out of this file's imports — it is now only used inside `activity.ts`.

Replace the whole `update` method body below the dot line (lines 139-154) so the method reads:

```ts
    update(session: Session): void {
      this._session = session
      this._project.text = session.project
      this._dot.style_class = `dasbo-dot ${STATE_CLASS[session.state]}`.trim()

      const { text, hint } = activityText(session)
      this._activity.text = text
      // St's CSS engine does not reliably honour `opacity` — the same finding
      // that made PopupHeader's empty label set it on the actor — so the
      // .dasbo-row-activity rule cannot carry this. Set on every call, not just
      // the hint branches: one label is reused across every state.
      this._activity.opacity = hint ? 178 : 255
    }
```

And restore full weight in `showTransient` (line 162), which writes straight past `update`:

```ts
    showTransient(text: string): void {
      this._activity.opacity = 255
      this._activity.text = text
    }
```

- [ ] **Step 6: Verify the whole suite and the build**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS on all three. The build must be run here — it is the only check that `src/shell/sessionRow.ts` still compiles, since nothing tests it.

- [ ] **Step 7: Check it by hand in the shell**

Run: `make install && gnome-extensions enable dasbo-island@ayubaswad.gmail.com`, then reload the shell (X11: `Alt+F2`, `r`, Enter; Wayland: log out and back in).

Run: `tools/fake-agent.js session` then `tools/fake-agent.js tool`
Expected: the row reads `idle` dimmed after the first, then `Edit · /tmp/main.js` at full weight after the second. Open the popup to see it.

- [ ] **Step 8: Commit**

```bash
git add src/core/activity.ts test/core/activity.test.ts src/shell/sessionRow.ts
git commit -m "feat(shell): say thinking while the agent works between tools"
```

---

### Task 6: Install Claude's SessionEnd hook

The last piece: without this, Claude sessions reach `done` never, and clear the pill only via Task 4's process sweep.

**Files:**
- Modify: `src/core/install/plan.ts:23`
- Modify: `README.md:32-34`
- Test: `test/core/install/plan.test.ts`

**Interfaces:**
- Consumes: `planInstall`, `installState`, `CLAUDE_EVENTS` — all existing.
- Produces: `planInstall('claude', env)` writes six hook events. `installState('claude', env)` returns `'stale'` for a five-event install.

- [ ] **Step 1: Write the failing tests**

In `test/core/install/plan.test.ts`, update the first test (line 19) — both its title and its expectation:

```ts
  it('creates settings.json with all six hook events when the file is absent', () => {
    const edits = planInstall('claude', env())
    expect(edits).toHaveLength(1)
    expect(edits[0]!.path).toBe('/home/me/.claude/settings.json')
    expect(edits[0]!.backup).toBe(true)
    const parsed = JSON.parse(edits[0]!.content)
    expect(Object.keys(parsed.hooks).sort()).toEqual(
      ['PostToolUse', 'PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'UserPromptSubmit']
    )
  })
```

Add this test directly after it — this is what makes the preferences row offer **Update** to everyone who installed before this release:

```ts
  it('reports an install predating SessionEnd as stale, so the row offers Update', () => {
    const full = JSON.parse(planInstall('claude', env())[0]!.content)
    delete full.hooks.SessionEnd
    const fs = { '/home/me/.claude/settings.json': JSON.stringify(full) }
    expect(installState('claude', env(fs))).toBe('stale')
  })
```

`installState` and the `env` helper are both already in scope — `installState` is imported at line 7 and `env` is defined at line 11. No import changes are needed.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/core/install/plan.test.ts`
Expected: FAIL — the first reports the six-element array does not match the five keys actually written; the second reports `expected 'installed' to be 'stale'`.

- [ ] **Step 3: Add the event**

`src/core/install/plan.ts` line 23:

```ts
const CLAUDE_EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd',
] as const
```

Nothing else in `claudeEdits` changes: `SessionEnd` takes `notify` mode, which is the default for everything but `PreToolUse`, and takes no matcher, which is the default for everything but the two tool events.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Widen the README's claim about Update**

Replace lines 32-34 of `README.md`:

```markdown
Each agent row shows whether its hooks are installed. If the extension
directory moves, or a release adds a hook event the installed set is missing,
the row offers **Update** — every installed hook command embeds an absolute
path, and an install written before a new event existed is out of date.
```

Leave the rest of that paragraph, from `Panel box and position changes apply`, untouched.

- [ ] **Step 6: Reinstall and confirm end to end**

Run: `npm test && npm run build && make install`, reload the shell, then open the preferences:

Run: `gnome-extensions prefs dasbo-island@ayubaswad.gmail.com`
Expected: the Claude Code row offers **Update**, because the settings.json on disk still holds five events. Press it.

Run: `python3 -c "import json;print(sorted(json.load(open('$HOME/.claude/settings.json'))['hooks']))"`
Expected: the list contains `SessionEnd`.

Then run a real agent session in a terminal and watch the pill: it must read `working` continuously across several tool calls, drop to `idle` when the turn ends without the row disappearing, and clear about ten seconds after the terminal is closed.

- [ ] **Step 7: Commit**

```bash
git add src/core/install/plan.ts test/core/install/plan.test.ts README.md
git commit -m "feat(install): wire Claude's SessionEnd hook"
```

---

## Verification

After Task 6, the whole change is in. Confirm before considering it done:

- [ ] `npm test` — PASS
- [ ] `npm run typecheck` — PASS
- [ ] `npm run build` — PASS
- [ ] `grep -rn "'stop'" src/` returns nothing
- [ ] A live agent session holds `working` across consecutive tool calls
- [ ] Ending a turn shows `idle` and keeps the row
- [ ] Closing the terminal clears the row within the linger window
