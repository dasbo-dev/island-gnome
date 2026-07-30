# Notification Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install Claude's `Notification` hook, show the message it carries on the session's activity line, open the popup for it, and put both back a few seconds later.

**Architecture:** The notice lives on the `Session` record, not on the widget — `Island._rebuildRows` rewrites the activity label from `activityText()` on every store emit, so a string written straight onto the label is wiped by the next event from any session. Putting it on the record means it renders through the one path everything else renders through, and the branch becomes a pure function in `src/core/` that a unit test can prove. Expiry is a rendering fact (compare two numbers on the existing one-second tick), not a scheduled store event.

**Tech Stack:** TypeScript, GJS / GNOME Shell 46 (St, Clutter, GLib, Gio), GSettings + GTK4/Adwaita for preferences, vitest for the pure core, esbuild via `node build.mjs`.

**Spec:** `docs/superpowers/specs/2026-07-30-notification-popup-design.md`

> **Note:** This plan has been reconciled with two post-review fix rounds since
> it was first executed. Where a step below quotes a comment or a guard that
> the review rounds went on to correct or replace, the step has been updated
> to match what actually shipped. Treat this document as a record of what was
> built, not a forecast of what will be.

## Global Constraints

- `src/core/` must never import `gi://` or `resource://`. `test/core/purity.test.ts` enforces this — anything touching GNOME APIs goes in `src/shell/`, `src/dbus/`, `src/prefs.ts` or `src/extension.ts`.
- Target is GNOME Shell 46 only.
- `src/shell/*` and `src/prefs.ts` cannot be unit-tested — they need a running Shell. Every decidable branch belongs in `src/core/`.
- Adapters must be pure: they receive `ts` in `HookContext` and never read a clock.
- The hook helper's fail-open guarantee is untouched by this work: `hooks/dasbo-hook` is not modified at all.
- Claude's `Notification` payload shape is **inferred, not captured**. There is no fixture. A missing or differently-spelled `message` must degrade to "installed but silent", never to an empty popup opening on its own.
- Commit style is conventional with an optional scope, lowercase subject: `feat(shell):`, `fix(core):`, `docs:`. Existing history is the reference.
- Verification commands: `npm test` (vitest, whole suite) and `npm run typecheck` (runs `tsc` over both `tsconfig.json` and `tsconfig.test.json`). Both must pass before every commit.

---

### Task 1: The store learns what a notice is

**Files:**
- Modify: `src/core/types.ts` (the `EventKind` union, ~line 32; the `Session` interface, ~line 120)
- Modify: `src/core/store.ts` (`SessionStore` fields ~line 89; `apply` ~line 241; `setPending` ~line 311; `setPendingQuestion` ~line 324)
- Test: `test/core/store.test.ts`

**Interfaces:**
- Consumes: nothing — this is the first task.
- Produces:
  - `EventKind` gains the member `'notification'`.
  - `export interface SessionNotice { text: string; until: number }` in `src/core/types.ts`.
  - `Session.notice?: SessionNotice`.
  - `SessionStore.notificationSeconds: number` (public field, default `5`), set from GSettings by the shell layer in Task 5.

**Why this task can stand alone:** the store tests build an `AgentEvent` by hand, so nothing here depends on the Claude adapter emitting the new kind (Task 2).

**One typecheck subtlety to expect:** adding `'notification'` to `EventKind` without the early return below breaks `apply`'s `switch` — `let kindState: SessionState` would no longer be definitely assigned. The early return fixes it, because TypeScript narrows `e.kind` past `'notification'` at that `return`. Do not add a `default:` case to work around it.

- [ ] **Step 1: Write the failing tests**

Append to `test/core/store.test.ts`, inside the file but after the existing top-level `describe('SessionStore', …)` block:

```ts
describe('SessionStore notices', () => {
  it('records a notification as a notice with a deadline', () => {
    const s = new SessionStore()
    s.apply(ev())
    s.apply(ev({ kind: 'notification', detail: 'Claude is waiting for your input', ts: 2000 }))
    expect(s.list()[0]!.notice).toEqual({
      text: 'Claude is waiting for your input',
      until: 7000,
    })
  })

  it('leaves state, tool and detail exactly as the previous event set them', () => {
    const s = new SessionStore()
    s.apply(ev({ kind: 'tool-start', tool: 'Bash', detail: 'npm test', ts: 1000 }))
    s.apply(ev({ kind: 'notification', detail: 'Claude needs your permission', ts: 2000 }))
    const session = s.list()[0]!
    expect(session.state, 'a notification is not activity').toBe('running')
    expect(session.currentTool).toBe('Bash')
    expect(session.detail).toBe('npm test')
  })

  it('still refreshes lastEventAt, so the reaper does not treat the agent as gone', () => {
    const s = new SessionStore()
    s.apply(ev())
    s.apply(ev({ kind: 'notification', detail: 'waiting', ts: 9000 }))
    expect(s.list()[0]!.lastEventAt).toBe(9000)
  })

  it('takes no deadline at all when notificationSeconds is zero', () => {
    const s = new SessionStore()
    s.notificationSeconds = 0
    s.apply(ev())
    s.apply(ev({ kind: 'notification', detail: 'waiting', ts: 2000 }))
    expect(s.list()[0]!.notice).toEqual({ text: 'waiting', until: 0 })
  })

  it('sets no notice when the payload carried no message', () => {
    const s = new SessionStore()
    s.apply(ev())
    s.apply(ev({ kind: 'notification', ts: 2000 }))
    expect(s.list()[0]!.notice, 'silent beats an empty popup').toBeUndefined()
  })

  it('clears a standing notice when a later notification carries no message', () => {
    const s = new SessionStore()
    s.apply(ev({ kind: 'notification', detail: 'waiting', ts: 2000 }))
    s.apply(ev({ kind: 'notification', ts: 3000 }))
    expect(s.list()[0]!.notice).toBeUndefined()
  })

  it('ends the notice on any other event, whatever its clock said', () => {
    const s = new SessionStore()
    s.apply(ev({ kind: 'notification', detail: 'waiting', ts: 2000 }))
    s.apply(ev({ kind: 'tool-start', tool: 'Read', ts: 2100 }))
    expect(s.list()[0]!.notice, 'the next event is proof the silence is over').toBeUndefined()
  })

  it('ends the notice when a permission takes the row', () => {
    const s = new SessionStore()
    s.apply(ev({ kind: 'notification', detail: 'waiting', ts: 2000 }))
    s.setPending('claude:s1', { id: 'p1', tool: 'Bash', deadline: 0, queued: 0 })
    expect(s.list()[0]!.notice).toBeUndefined()
  })

  it('ends the notice when a question takes the row', () => {
    const s = new SessionStore()
    s.apply(ev({ kind: 'notification', detail: 'waiting', ts: 2000 }))
    const pending: PendingQuestion = {
      id: 'q1',
      deadline: 0,
      questions: [
        { question: 'Which?', header: 'Pick', options: [{ label: 'a', description: '' }], multiSelect: false },
      ],
    }
    s.setPendingQuestion('claude:s1', pending)
    expect(s.list()[0]!.notice).toBeUndefined()
  })

  it('does not bring the notice back when the permission resolves', () => {
    const s = new SessionStore()
    s.apply(ev({ kind: 'notification', detail: 'waiting', ts: 2000 }))
    s.setPending('claude:s1', { id: 'p1', tool: 'Bash', deadline: 0, queued: 0 })
    s.clearPending('claude:s1')
    expect(s.list()[0]!.notice, 'an interrupted notice is spent').toBeUndefined()
  })

  it('creates the session when a notification is the first thing it ever hears', () => {
    const s = new SessionStore()
    s.apply(ev({ kind: 'notification', detail: 'waiting', ts: 2000 }))
    expect(s.list()).toHaveLength(1)
    expect(s.list()[0]!.state).toBe('idle')
    expect(s.list()[0]!.notice?.text).toBe('waiting')
  })

  it('notifies subscribers, so the row redraws', () => {
    const s = new SessionStore()
    s.apply(ev())
    let calls = 0
    s.subscribe(() => { calls += 1 })
    s.apply(ev({ kind: 'notification', detail: 'waiting', ts: 2000 }))
    expect(calls).toBe(1)
  })
})
```

`PendingQuestion` is already imported at the top of that file. No import changes are needed.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/core/store.test.ts -t 'SessionStore notices'`

Expected: FAIL. TypeScript rejects `kind: 'notification'` — `Type '"notification"' is not assignable to type 'EventKind'` — and `s.notificationSeconds` / `.notice` do not exist.

- [ ] **Step 3: Add the type members**

In `src/core/types.ts`, add `'notification'` to the union, between `'session-end'` and `'error'`:

```ts
export type EventKind =
  | 'session-start'
  | 'prompt-submit'
  | 'tool-start'
  | 'tool-end'
  | 'turn-end'
  | 'session-end'
  | 'notification'
  | 'error'
```

Above the `Session` interface, add:

```ts
/**
 * Something an agent said while nothing was happening — Claude's Notification
 * hook. Not a state: `apply` sets this and returns without touching `state`,
 * `currentTool` or `detail`, because a notification is the absence of activity
 * rather than a kind of it.
 *
 * `until` is a deadline in ms since the epoch. Zero means no clock at all, in
 * which case only the next event ends it — the same reading `permission-timeout`
 * gives to zero.
 */
export interface SessionNotice {
  text: string
  until: number
}
```

Inside `Session`, immediately after the `pendingQuestion` field:

```ts
  /**
   * Cleared by any event other than a notification, and by setPending /
   * setPendingQuestion — a notice describes a silence, and all of those are
   * proof the silence is over. Never restored by clearPending: an interrupted
   * notice is spent.
   */
  notice?: SessionNotice
```

- [ ] **Step 4: Add the store behaviour**

In `src/core/store.ts`, add the import of the new type to the existing type-only import from `./types.js`:

```ts
import type { AgentEvent, AgentId, PendingPermission, PendingQuestion, Session, SessionNotice, SessionState } from './types.js'
```

Beside `doneLingerSeconds` in the class body:

```ts
  /**
   * Seconds a notice stays on a row before `activityText` stops returning it.
   * Zero means it stays until the next event from that session replaces it.
   * Set from GSettings by the shell layer, like doneLingerSeconds.
   */
  notificationSeconds = 5
```

In `apply`, immediately after the `if (e.transcriptPath) s.transcriptPath = e.transcriptPath` line and before `let kindState: SessionState`:

```ts
    // A notification changes nothing but this. It carries no state, so the
    // switch below must not run for it — and returning here is also what keeps
    // that switch exhaustive: TypeScript narrows `e.kind` past 'notification'
    // at this return, so `kindState`'s definite assignment still holds without
    // a `default` case being invented to satisfy it.
    if (e.kind === 'notification') {
      const notice: SessionNotice | undefined = e.detail
        ? {
            text: e.detail,
            until: this.notificationSeconds ? e.ts + this.notificationSeconds * 1000 : 0,
          }
        : undefined
      s.notice = notice
      this.emit()
      return
    }
    // Any other event is proof the silence the notice described is over, so it
    // ends here regardless of what its own clock said.
    s.notice = undefined
```

In `setPending`, beside the existing `s.pendingQuestion = undefined`:

```ts
    // A permission is the louder thing, and it arrives with buttons the user
    // has to reach. Whatever the agent was merely saying is over.
    s.notice = undefined
```

Add the identical line to `setPendingQuestion`, beside its `s.pendingPermission = undefined`.

`clearPending` is deliberately left alone.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/core/store.test.ts`

Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 6: Run the whole suite and the typechecker**

Run: `npm test && npm run typecheck`

Expected: PASS both. If `tsc` reports `Variable 'kindState' is used before being assigned` in `store.ts`, the early return in Step 4 is in the wrong place — it must sit above the `let kindState` declaration.

- [ ] **Step 7: Commit**

```bash
git add src/core/types.ts src/core/store.ts test/core/store.test.ts
git commit -m "feat(core): let a session carry something the agent merely said

A notification is not activity, so it sets no state: apply records the
text and returns before the switch, leaving state, currentTool and detail
as the previous event left them.

Any other event ends the notice, whatever its own clock said. A notice
describes a silence and the next event is proof the silence is over."
```

---

### Task 2: The Claude adapter recognises the event

**Files:**
- Modify: `src/core/adapters/claude.ts` (`KIND_BY_EVENT` ~line 6; the returned object's `detail` field ~line 87)
- Test: `test/core/adapters/claude.test.ts`

**Interfaces:**
- Consumes: `EventKind`'s `'notification'` member from Task 1.
- Produces: `claudeAdapter.normalize` maps a payload with `hook_event_name: 'Notification'` to `{ kind: 'notification', detail: <the payload's message> }`.

- [ ] **Step 1: Write the failing tests**

Append to `test/core/adapters/claude.test.ts`:

```ts
/**
 * INFERRED, NOT CAPTURED. There is no Notification fixture in
 * test/fixtures/claude/ and docs/agent-dialects.md does not cover the event —
 * it sits where SessionEnd sits in that document. These payloads are written
 * from the published shape, the way codex.test.ts writes its own.
 */
describe('claudeAdapter.normalize for a Notification', () => {
  it('maps Notification to the notification kind', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'Notification', session_id: 's1', cwd: '/p/app',
        message: 'Claude is waiting for your input' },
      ctx
    )
    expect(e?.kind).toBe('notification')
  })

  it('carries the message through as the detail', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'Notification', session_id: 's1', cwd: '/p/app',
        message: 'Claude needs your permission to use Bash' },
      ctx
    )
    expect(e?.detail).toBe('Claude needs your permission to use Bash')
  })

  it('leaves the detail undefined when the message is missing or not a string', () => {
    const missing = claudeAdapter.normalize(
      { hook_event_name: 'Notification', session_id: 's1', cwd: '/p/app' }, ctx
    )
    expect(missing?.detail, 'no text means no notice, which means silence').toBeUndefined()

    const wrongType = claudeAdapter.normalize(
      { hook_event_name: 'Notification', session_id: 's1', cwd: '/p/app', message: { a: 1 } }, ctx
    )
    expect(wrongType?.detail).toBeUndefined()
  })

  it('returns null without a session id, like every other event', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'Notification', cwd: '/p/app', message: 'waiting' }, ctx
    )
    expect(e).toBeNull()
  })

  it('falls back to the argv event name, so the install plan carries the meaning', () => {
    const e = claudeAdapter.normalize(
      { session_id: 's1', cwd: '/p', message: 'waiting' },
      { ...ctx, event: 'Notification' }
    )
    expect(e?.kind).toBe('notification')
    expect(e?.detail).toBe('waiting')
  })

  it('does not let a stray message field hijack a tool event', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'PreToolUse', session_id: 's1', cwd: '/p/app',
        tool_name: 'Bash', tool_input: { command: 'ls' }, message: 'ignore me' },
      ctx
    )
    expect(e?.detail).toBe('ls')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/core/adapters/claude.test.ts -t 'Notification'`

Expected: FAIL — `normalize` returns `null` because `KIND_BY_EVENT['Notification']` is undefined, so `e?.kind` is `undefined` rather than `'notification'`.

- [ ] **Step 3: Add the mapping**

In `src/core/adapters/claude.ts`, add the entry to `KIND_BY_EVENT`:

```ts
const KIND_BY_EVENT: Record<string, EventKind> = {
  SessionStart: 'session-start',
  UserPromptSubmit: 'prompt-submit',
  PreToolUse: 'tool-start',
  PostToolUse: 'tool-end',
  Stop: 'turn-end',
  SessionEnd: 'session-end',
  Notification: 'notification',
}
```

Replace the `detail` line in the returned object:

```ts
      // A Notification carries its text in `message` and has no tool_input; a
      // tool event has tool_input and no message. The two can never contend
      // for this field, so the notice needs no field of its own on AgentEvent.
      detail:
        kind === 'notification'
          ? str(raw['message'])
          : detailFromToolInput(raw['tool_input']),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/core/adapters/claude.test.ts`

Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Run the whole suite and the typechecker**

Run: `npm test && npm run typecheck`

Expected: PASS both.

- [ ] **Step 6: Commit**

```bash
git add src/core/adapters/claude.ts test/core/adapters/claude.test.ts
git commit -m "feat(core): read Claude's Notification into the event stream

The message rides in the existing detail field rather than a new one on
AgentEvent: a Notification has no tool_input and a tool event has no
message, so the two can never contend for it.

Marked inferred in the tests, not captured — there is no fixture, and a
missing message leaves detail undefined, which downstream reads as
silence rather than as an empty notice."
```

---

### Task 3: The row shows the notice, and stops showing it

**Files:**
- Modify: `src/core/activity.ts` (the `activityText` signature and body)
- Modify: `src/shell/sessionRow.ts` (constructor ~line 53 and ~line 252; `update` ~line 334; `tick` ~line 378)
- Modify: `src/shell/island.ts` (`_rebuildRows` ~line 460)
- Test: `test/core/activity.test.ts`

**Interfaces:**
- Consumes: `Session.notice` and `SessionNotice` from Task 1.
- Produces:
  - `activityText(session: Session, now: number): Activity` — the second parameter is new and required.
  - `new SessionRow(session, cb, now)` — a third constructor parameter.
  - `SessionRow.update(session: Session, now: number): void` — the second parameter is new and required.

- [ ] **Step 1: Write the failing tests**

In `test/core/activity.test.ts`, add a constant just below the `session()` helper:

```ts
/**
 * Any fixed clock. Every session built above has no notice, so for all but the
 * notice tests this value is inert — it exists so the call sites read the same.
 */
const NOW = 10_000
```

Then append `, NOW` to **every** existing `activityText(...)` call in the file — there are twelve, at roughly lines 23, 32, 40, 49, 55, 60, 66, 72, 78, 84, 109 and 114. Two of them are nested inside assertions and are easy to miss:

```ts
    expect(activityText(s, NOW)).toEqual({ text: 'question · Library', hint: false })
```

```ts
    expect(activityText(s, NOW).text).toBe('question · Library')
```

Then append the new block:

```ts
describe('activityText for a notice', () => {
  const notice = { text: 'Claude is waiting for your input', until: 20_000 }

  it('says what the agent said, at full weight', () => {
    const r = activityText(session({ state: 'idle', notice }), NOW)
    expect(r.text).toBe('Claude is waiting for your input')
    expect(r.hint, 'a notice is something said, not a placeholder').toBe(false)
  })

  it('outranks the idle hint it exists to correct', () => {
    expect(activityText(session({ state: 'idle', notice }), NOW).text).not.toBe('idle')
  })

  it('outranks a tool still recorded on the row', () => {
    const s = session({ state: 'running', currentTool: 'Bash', detail: 'npm test', notice })
    expect(activityText(s, NOW).text).toBe('Claude is waiting for your input')
  })

  it('yields to a pending permission, which has buttons the user must reach', () => {
    const s = session({
      state: 'waiting',
      notice,
      pendingPermission: { id: 'p1', tool: 'Bash', deadline: 0, queued: 0 },
    })
    expect(activityText(s, NOW).text).toBe('waiting for you · Bash')
  })

  it('yields to a pending question for the same reason', () => {
    const s = session({
      state: 'waiting',
      notice,
      pendingQuestion: {
        id: 'q1',
        deadline: 0,
        questions: [
          { question: 'Which?', header: 'Pick', options: [{ label: 'a', description: '' }], multiSelect: false },
        ],
      },
    })
    expect(activityText(s, NOW).text).toBe('question · Pick')
  })

  it('is gone once its deadline has passed', () => {
    const r = activityText(session({ state: 'idle', notice }), 20_001)
    expect(r.text).toBe('idle')
    expect(r.hint).toBe(true)
  })

  it('is gone exactly at the deadline, not one tick after it', () => {
    expect(activityText(session({ state: 'idle', notice }), 20_000).text).toBe('idle')
  })

  it('is still there one millisecond before the deadline', () => {
    expect(activityText(session({ state: 'idle', notice }), 19_999).text).toBe(notice.text)
  })

  it('never expires when the deadline is zero', () => {
    const forever = { text: 'waiting', until: 0 }
    expect(activityText(session({ state: 'idle', notice: forever }), 9_999_999).text).toBe('waiting')
  })

  it('bounds a hostile message, so the row cannot grow without limit', () => {
    const long = { text: 'M'.repeat(300), until: 0 }
    const r = activityText(session({ state: 'idle', notice: long }), NOW)
    expect(r.text).toBe(`${'M'.repeat(119)}…`)
  })

  it('flattens a multi-line message onto the one label', () => {
    const multi = { text: 'line one\n\n  line two', until: 0 }
    expect(activityText(session({ state: 'idle', notice: multi }), NOW).text).toBe('line one line two')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/core/activity.test.ts`

Expected: FAIL. `tsc` via vitest reports `Expected 1 arguments, but got 2` on every call, and the notice tests return `'idle'` where they expect the message.

- [ ] **Step 3: Add the notice branch to activityText**

In `src/core/activity.ts`, change the signature and add the branch after the `pendingPermission` block, before `const tool = session.currentTool`:

```ts
export function activityText(session: Session, now: number): Activity {
```

```ts
  // Below the two pending branches, because each of those puts controls on the
  // row and the label has to describe what those controls are for. Above
  // tool/detail because a notification arrives when nothing is running, so in
  // practice those are already clear — and where they are not, the notice is
  // the fresher fact.
  const notice = session.notice
  if (notice && (notice.until === 0 || now < notice.until)) {
    // Bounded for the same reason the tool name above is: `message` comes
    // straight off the payload and nothing else caps it.
    return { text: truncateDetail(notice.text), hint: false }
  }
```

Extend the function's doc comment with a sentence recording the new ordering:

```
 * The notice branch sits between the pending pair and the tool pair, and the
 * pending branches winning is not a defensive ordering against something
 * that cannot happen — the two fields coexist on a real, reachable session.
 * `store.apply`'s notification branch sets `s.notice` without touching
 * `pendingPermission` or `pendingQuestion`; only `setPending` and
 * `setPendingQuestion` clear the notice, and neither runs when a notification
 * arrives. So the ordinary sequence — a permission is requested, then Claude
 * raises `Notification` because the same prompt has also sat idle — leaves a
 * session holding both at once (`test/core/activity.test.ts`'s "yields to a
 * pending permission" test constructs exactly that state). `noticeVisible`
 * below is where the winner is decided, once, so this function and
 * `Island.notifyNotification`'s decision to open the popup at all agree about
 * which of the two the row is showing.
```

(A review round after this step first landed found the sentence originally
written here claimed the opposite of the above — that the notice "cannot
co-exist with either pending field in practice" — which is false, for the
reason spelled out above. Corrected here rather than left contradicting
`src/core/activity.ts`.)

- [ ] **Step 4: Run the core test to verify it passes**

Run: `npx vitest run test/core/activity.test.ts`

Expected: PASS.

- [ ] **Step 5: Thread the clock through the row**

`npm run typecheck` now fails at `src/shell/sessionRow.ts:353` with `Expected 2 arguments, but got 1`. Fix the shell layer.

In `src/shell/sessionRow.ts`, take the clock in the constructor:

```ts
    constructor(session: Session, cb: SessionRowCallbacks, now: number) {
```

and change its final line from `this.update(session)` to:

```ts
      this.update(session, now)
```

Add this private method just above `update`:

```ts
    /**
     * Write the activity line for a given moment.
     *
     * Called from both update() and tick(), because both can be the first to
     * learn the text has changed: update() runs on a store emit, tick() runs
     * once a second and is the only thing that ever notices a notice has
     * expired — the store schedules no timer for that, it is just two numbers
     * compared here.
     *
     * The text write is guarded and the opacity is not. Assigning a
     * ClutterText's contents relayouts the row, and this now runs every
     * second, so the difference check earns its keep; assigning an actor's
     * opacity is a cheap property set that costs nothing to repeat.
     */
    private _syncActivity(now: number): void {
      const { text, hint } = activityText(this._session, now)
      if (text !== this._activity.text) this._activity.text = text
      // St's CSS engine does not reliably honour `opacity` — the same finding
      // that made PopupHeader's empty label set it on the actor — so the
      // .dasbo-row-activity rule cannot carry this.
      this._activity.opacity = hint ? 178 : 255
    }
```

(A review round after this step first landed corrected the paragraph above:
it originally justified the unguarded opacity write by claiming a guard "would
strand the label at whatever weight showTransient() last left it." That
reasoning does not survive `showTransient`'s later guard — see the transient
early-return added to this same method by a subsequent fix round — and the
opacity write needs no such justification: it is unguarded simply because it
is cheap to repeat, not because guarding it would break something.)

Change `update`'s signature and replace its activity block:

```ts
    update(session: Session, now: number): void {
```

Delete these four lines from `update`:

```ts
      const { text, hint } = activityText(session)
      this._activity.text = text
      // St's CSS engine does not reliably honour `opacity` — the same finding
      // that made PopupHeader's empty label set it on the actor — so the
      // .dasbo-row-activity rule cannot carry this. Set on every call, not just
      // the hint branches: one label is reused across every state.
      this._activity.opacity = hint ? 178 : 255
```

and put this in their place:

```ts
      this._syncActivity(now)
```

Note that `_syncActivity` reads `this._session`, which `update` assigns on its first line — so the call must stay below `this._session = session`.

In `tick`, add the call as the first statement of the method, above the `formatElapsed` line:

```ts
      // The only thing that ever retires an expired notice. Nothing else runs
      // on a clock, and the store deliberately schedules no timer for it.
      this._syncActivity(now)
```

- [ ] **Step 6: Pass the clock in from the Island**

In `src/shell/island.ts`, `_rebuildRows`, add a clock at the top of the method beside the existing two lines:

```ts
    private _rebuildRows(): void {
      const sessions = this._store.list()
      const live = new Set(sessions.map((s) => s.key))
      // One clock for the whole rebuild, so every row in a single pass agrees
      // about whether a notice has expired.
      const now = Date.now()
```

In the same method's build loop, pass it to both calls:

```ts
      for (const s of sessions) {
        const existing = this._rows.get(s.key)
        if (existing) {
          existing.update(s, now)
        } else {
          const row = new SessionRow(s, {
            onJump: (sess) => this._onJump(sess),
            onToggleExpanded: (expanded) => {
              this._questions.get(s.key)?.panel.setExpanded(expanded)
              this._taskLists.get(s.key)?.list.setExpanded(expanded)
            },
          }, now)
          this._rows.set(s.key, row)
          this._body.addMenuItem(row)
        }
      }
```

`showJumpFailure` also calls `row.update(s)` — give it a clock too:

```ts
      const id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
        const s = this._store.get(key)
        if (s) row.update(s, Date.now())
        this._transientIds.delete(id)
        return GLib.SOURCE_REMOVE
      })
```

- [ ] **Step 7: Run the whole suite and the typechecker**

Run: `npm test && npm run typecheck`

Expected: PASS both. `tsc` finding another `Expected 2 arguments, but got 1` means an `update()` or `activityText()` call site was missed — fix it the same way.

- [ ] **Step 8: Commit**

```bash
git add src/core/activity.ts src/shell/sessionRow.ts src/shell/island.ts test/core/activity.test.ts
git commit -m "feat(shell): put an agent's notice on the row, and take it away again

activityText now takes the current time, because a notice is the first
thing the row draws that expires on a clock rather than on an event. The
row's tick is what retires it: the store schedules no timer, expiry is
two numbers compared at draw time.

The notice sits below the pending pair, which arrive with controls the
label has to describe, and above tool and detail, which a notification
implies are already over."
```

---

### Task 4: Install the hook

**Files:**
- Modify: `src/core/install/plan.ts` (`CLAUDE_EVENTS` ~line 23)
- Test: `test/core/install/plan.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks — this one is independent of them.
- Produces: `planInstall('claude', env)` writes a seventh event, `Notification`, in `notify` mode. Every install written before this release therefore reports `installState('claude', env) === 'stale'`.

- [ ] **Step 1: Write the failing tests**

In `test/core/install/plan.test.ts`, update the existing first test to expect seven events — change its name and its assertion:

```ts
  it('creates settings.json with all seven hook events when the file is absent', () => {
    const edits = planInstall('claude', env())
    expect(edits).toHaveLength(1)
    expect(edits[0]!.path).toBe('/home/me/.claude/settings.json')
    expect(edits[0]!.backup).toBe(true)
    const parsed = JSON.parse(edits[0]!.content)
    expect(Object.keys(parsed.hooks).sort()).toEqual(
      ['Notification', 'PostToolUse', 'PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'UserPromptSubmit']
    )
  })
```

Then add these beside it, inside the same `describe('planInstall for claude', …)` block:

```ts
  it('reports an install predating Notification as stale, so the row offers Update', () => {
    const full = JSON.parse(planInstall('claude', env())[0]!.content)
    delete full.hooks.Notification
    const fs = { '/home/me/.claude/settings.json': JSON.stringify(full) }
    expect(installState('claude', env(fs))).toBe('stale')
  })

  it('installs Notification in notify mode, never permission', () => {
    const parsed = JSON.parse(planInstall('claude', env())[0]!.content)
    const command = parsed.hooks.Notification[0].hooks[0].command
    expect(command).toContain('claude notify Notification')
    expect(command, 'a notification is not a gate').not.toContain('permission')
  })

  it('gives Notification no matcher, which only the tool events take', () => {
    const parsed = JSON.parse(planInstall('claude', env())[0]!.content)
    expect(parsed.hooks.Notification[0].matcher).toBeUndefined()
  })

  it('removes the Notification entry on uninstall', () => {
    const installed = planInstall('claude', env())[0]!.content
    const edits = planUninstall('claude', env({ '/home/me/.claude/settings.json': installed }))
    const parsed = JSON.parse(edits[0]!.content)
    expect(parsed.hooks.Notification).toBeUndefined()
  })

  it('leaves the plans for the other two agents alone', () => {
    const codex = JSON.parse(planInstall('codex', env())[0]!.content)
    expect(codex.hooks['dasbo-island'].events).toEqual(
      ['session.start', 'session.end', 'tool.start', 'tool.end']
    )
    const antigravity = JSON.parse(planInstall('antigravity', env())[0]!.content)
    expect(Object.keys(antigravity['dasbo-island']).sort()).toEqual(
      ['PostInvocation', 'PostToolUse', 'PreInvocation', 'PreToolUse', 'Stop']
    )
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/core/install/plan.test.ts`

Expected: FAIL — the key list comes back with six entries and no `Notification`, and `parsed.hooks.Notification` is `undefined`.

- [ ] **Step 3: Add the event**

In `src/core/install/plan.ts`:

```ts
const CLAUDE_EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd',
  'Notification',
] as const
```

Nothing else in the file changes. `expectedClaudeEntries` and `presentClaudeEntries` both iterate `CLAUDE_EVENTS`, so freshness, staleness and uninstall all follow from this one line, and `claudeEdits` already picks `notify` mode for everything but `PreToolUse` and adds a `matcher` only for the two tool events.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/core/install/plan.test.ts`

Expected: PASS, including every pre-existing test in the file. If the "is idempotent" test fails, the change went somewhere other than `CLAUDE_EVENTS`.

- [ ] **Step 5: Run the whole suite and the typechecker**

Run: `npm test && npm run typecheck`

Expected: PASS both.

- [ ] **Step 6: Commit**

```bash
git add src/core/install/plan.ts test/core/install/plan.test.ts
git commit -m "feat(core): ask Claude for its Notification hook

One line in CLAUDE_EVENTS. Freshness, staleness and uninstall all iterate
that list, so every install written before this release now compares
unequal and its row offers Update — the case the README already documents.

Notify mode, no matcher: a notification is not a gate."
```

---

### Task 5: Settings, preferences and the wiring that feeds the store

**Files:**
- Modify: `schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml`
- Modify: `src/prefs.ts` (`_behaviourPage` ~lines 62-99)
- Modify: `src/extension.ts` (`enable` ~lines 25-31)
- Test: none automatable — GSettings schemas, Adwaita widgets and the extension entry point all need a running Shell. Verified by the manual step below.

**Interfaces:**
- Consumes: `SessionStore.notificationSeconds` from Task 1.
- Produces:
  - GSettings key `notification-popup` (boolean, default `true`).
  - GSettings key `notification-seconds` (integer, default `5`).
  - `SessionStore.notificationSeconds` is kept in step with the second key, at `enable()` and on every change.

- [ ] **Step 1: Add the schema keys**

In `schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml`, add both keys after `auto-open-on-permission` and before `enabled-agents`:

```xml
    <key name="notification-popup" type="b">
      <default>true</default>
      <summary>Open the popup when an agent raises a notification</summary>
      <description>Suppressed while a fullscreen window is on the primary monitor.</description>
    </key>
    <key name="notification-seconds" type="i">
      <default>5</default>
      <summary>Seconds a notification stays on the row</summary>
      <description>How long the message replaces the row's activity line, and how long a popup opened for it stays open. Zero keeps the message until the next event from that session, and never closes the popup.</description>
    </key>
```

- [ ] **Step 2: Add the preference rows**

In `src/prefs.ts`, in `_behaviourPage`, add a second group between `page.add(group)` and `return page`:

```ts
    const notifications = new Adw.PreferencesGroup({ title: 'Notifications' })

    const notificationPopup = new Adw.SwitchRow({
      title: 'Open the popup on a notification',
      subtitle: 'Suppressed while a fullscreen window is on the primary monitor',
    })
    settings.bind('notification-popup', notificationPopup, 'active', 0)
    notifications.add(notificationPopup)

    const notificationSeconds = new Adw.SpinRow({
      title: 'Keep a notification visible',
      subtitle: 'Seconds the message stays on the row. Zero keeps it until the agent does something else.',
      adjustment: new Gtk.Adjustment({ lower: 0, upper: 300, step_increment: 1 }),
    })
    settings.bind('notification-seconds', notificationSeconds, 'value', 0)
    notifications.add(notificationSeconds)

    page.add(notifications)
```

so the tail of the method reads:

```ts
    page.add(group)

    const notifications = new Adw.PreferencesGroup({ title: 'Notifications' })
    // …the four statements above…
    page.add(notifications)

    return page
```

`Adw` and `Gtk` are already imported at the top of the file.

- [ ] **Step 3: Feed the store**

In `src/extension.ts`, `enable()`, extend the block that already does this for `done-linger`:

```ts
    this._store = new SessionStore()
    this._store.doneLingerSeconds = settings.get_int('done-linger')
    this._store.notificationSeconds = settings.get_int('notification-seconds')
    this._settingsIds.push(
      settings.connect('changed::done-linger', () => {
        if (this._store) this._store.doneLingerSeconds = settings.get_int('done-linger')
      })
    )
    this._settingsIds.push(
      // Read into the store rather than looked up per event: the store is pure
      // and must not know GSettings exists, which is the same arrangement
      // doneLingerSeconds already has.
      settings.connect('changed::notification-seconds', () => {
        if (this._store) this._store.notificationSeconds = settings.get_int('notification-seconds')
      })
    )
```

`notification-popup` is deliberately **not** read here. It is read live inside `Island.notifyNotification` in Task 6, the way `auto-open-on-permission` already is, so toggling it needs no restart.

- [ ] **Step 4: Verify the schema compiles and the suite still passes**

Run: `glib-compile-schemas --strict --dry-run schemas/ && npm test && npm run typecheck`

Expected: no output from `glib-compile-schemas`, then PASS on both npm commands. A schema error is reported with a line number and must be fixed before continuing.

- [ ] **Step 5: Verify the preferences render**

Run:

```bash
make install && gnome-extensions prefs dasbo-island@ayubaswad.gmail.com
```

Expected: the Behaviour page shows a **Notifications** group below **Permissions**, holding a switch that is on and a spinner reading 5. Change the spinner to 9, close the window, reopen it, and confirm it still reads 9.

On Wayland the extension itself needs a re-login to reload, but the preferences window is a separate process and picks up the new schema immediately.

- [ ] **Step 6: Commit**

```bash
git add schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml src/prefs.ts src/extension.ts
git commit -m "feat: let the user say whether a notification opens the popup, and for how long

Two keys, mirroring the permission pair. Zero seconds reads the way
permission-timeout's zero already does: no clock, so the message stays
until the next event and the popup is never closed for it.

notification-seconds is read into the store, because the store is pure
and must not know GSettings exists. notification-popup is read live at
the point of use, so toggling it needs no restart."
```

---

### Task 6: Open the popup, then get out of the way

**Files:**
- Modify: `src/dbus/service.ts` (`ServiceOptions` ~line 12; `Notify` ~line 96)
- Modify: `src/extension.ts` (the `new IslandService(...)` options object ~line 86)
- Modify: `src/shell/island.ts` (fields ~line 54; `open-state-changed` ~line 186; `notifyPermissionOpened` ~line 239; `_releaseExternalRefs` ~line 371)
- Test: none automatable — every branch here needs a running Shell. Verified by the manual steps below and by Task 7's `fake-agent` mode.

**Interfaces:**
- Consumes: `Session.notice` (Task 1), `'notification'` events reaching the store (Tasks 1-2), the `notification-popup` and `notification-seconds` keys (Task 5).
- Produces:
  - `ServiceOptions.onNotification: (key: string) => void`.
  - `Island.notifyNotification(key: string): void`.

- [ ] **Step 1: Add the service seam**

In `src/dbus/service.ts`, add to `ServiceOptions`, after `onPermissionOpened`:

```ts
  /**
   * Called when an agent raised a notification, so the UI can show it. The
   * store already holds the text by the time this fires; this only says that
   * it is worth looking at.
   */
  onNotification: (key: string) => void
```

In `Notify`, insert the branch after `const adapter = adapters[agent]` is *not* yet needed — put it immediately after the `const key = sessionKey(e.agent, e.sessionId)` line and before the `const adapter` line:

```ts
    // Before the task branches, which a notification can never satisfy: it
    // carries no tool name and is not a tool-end.
    if (e.kind === 'notification') {
      this.opts.onNotification(key)
      return
    }
```

`RequestPermissionAsync` is untouched — `Notification` is installed in `notify` mode and never reaches it.

- [ ] **Step 2: Wire the seam in the extension**

In `src/extension.ts`, add to the `IslandService` options object:

```ts
      onNotification: (key) => this._island?.notifyNotification(key),
```

placed after `onPermissionOpened` and before `onTasksChanged`.

- [ ] **Step 3: Add the Island's fields and teardown**

In `src/shell/island.ts`, add both fields beside `_transientIds`:

```ts
    /** GLib source that closes a popup this widget opened for a notice. */
    private _noticeCloseId = 0
    /**
     * True only while a notice-close timer is armed *and* the popup it will
     * close is one this widget opened for that notice. Everything that could
     * make closing wrong clears it — see notifyNotification.
     */
    private _noticeOpened = false
```

Add the private helper, next to `_stopTimer`:

```ts
    private _cancelNoticeClose(): void {
      if (!this._noticeCloseId) return
      GLib.Source.remove(this._noticeCloseId)
      this._noticeCloseId = 0
    }
```

In `_releaseExternalRefs`, beside the `_transientIds` loop:

```ts
      this._cancelNoticeClose()
```

`destroy()` already calls `_releaseExternalRefs()`, so one line covers both teardown paths — including the Clutter-side destroy that a panel rebuild by Dash to Panel triggers, which never reaches `destroy()`.

- [ ] **Step 4: Clear the flag everywhere closing would be wrong**

In the `open-state-changed` handler, extend the closed branch:

```ts
          } else {
            this._unwatchKeyFocus()
            this._stopTimer()
            // The user closed it. There is nothing left to close, and a timer
            // left armed would fire into whatever the *next* open is.
            this._noticeOpened = false
            this._cancelNoticeClose()
          }
```

At the very top of `notifyPermissionOpened`, above its two existing guards:

```ts
    notifyPermissionOpened(): void {
      // Unconditionally, and before the guards below: the popup is now up for
      // something that needs an answer. Shutting it under the user's cursor
      // mid-click is the worst thing the notice timer could do — and that is
      // true whether or not this call goes on to open anything itself.
      this._noticeOpened = false
      this._cancelNoticeClose()
      if (!this._settings.get_boolean('auto-open-on-permission')) return
```

- [ ] **Step 5: Add notifyNotification**

Add the method directly below `notifyPermissionOpened`:

```ts
    /**
     * Called by the D-Bus service when an agent raised a notification. The
     * store already holds the text; this decides whether to show the popup for
     * it, and arranges to undo that.
     */
    notifyNotification(key: string): void {
      if (!this._settings.get_boolean('notification-popup')) return
      if (Main.layoutManager.primaryMonitor?.inFullscreen) return
      // No text, no notice, or a pending permission/question is holding the
      // row instead of it — either way there is nothing new to show. The
      // second case matters in practice: a notification can arrive while a
      // permission this popup already answered (or the user already glanced
      // at) is still pending, and opening for it would show nothing new and
      // arm a close timer that could shut the popup out from under the
      // permission's own buttons — the worst thing this feature could do.
      // noticeVisible is the single place that decides which case this is,
      // shared with activityText's own notice branch, so the two agree about
      // what the session state says a notice should be doing. Claude's
      // Notification payload is also inferred rather than captured (see the
      // design doc), so a differently spelled message field must leave this
      // feature silent rather than opening an empty popup on its own —
      // noticeVisible covers that too, since no message means no notice at all.
      const session = this._store.get(key)
      if (!session || !noticeVisible(session, Date.now())) return

      this._cancelNoticeClose()
      const seconds = this._settings.get_int('notification-seconds')
      const wasClosed = !this.menu.isOpen
      if (wasClosed) this.menu.open(true)

      // The flag is set only when a timer is actually armed. With seconds = 0
      // nothing would ever read it, and leaving it true would hand the *next*
      // notification's timer permission to close a popup it did not open.
      //
      // Or-ed rather than assigned: a second notice arriving while the first
      // one's popup is still up finds the menu already open, and clobbering
      // the flag to false there would strand that popup with nothing left to
      // close it.
      if (seconds > 0) {
        this._noticeOpened = this._noticeOpened || wasClosed
        this._noticeCloseId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
          this._noticeCloseId = 0
          if (this._noticeOpened) {
            this._noticeOpened = false
            // Re-entrant: this fires open-state-changed, whose closed branch
            // clears the flag and cancels the timer. Both are already done, so
            // that pass is a no-op rather than a loop.
            this.menu.close(true)
          }
          return GLib.SOURCE_REMOVE
        })
      }
    }
```

Import `noticeVisible` from `../core/activity.js` alongside the other core
imports at the top of the file.

(A review round after this step first landed found the guard here — a plain
`if (!this._store.get(key)?.notice) return` — opened the popup for a notice a
pending permission or question was already holding, showing nothing new and
arming a close timer that could shut the popup out from under the pending
control's own buttons. Corrected to the `noticeVisible` guard above, matching
the same rule `activityText`'s notice branch uses (see the `docs:` fix to
`src/core/activity.ts` and this file's own Task 3), so the row and the
popup-open decision agree about what the session state says.)

- [ ] **Step 5a: Run the suite and the typechecker**

Run: `npm test && npm run typecheck`

Expected: PASS both. The core tests are unaffected; this step is here to catch a typo in the shell code before installing it.

- [ ] **Step 6: Verify by hand**

Task 7 adds the `fake-agent` mode that makes this quick. If you are executing tasks in order, do this verification at the end of Task 7 instead and tick this box then. If you are running Task 6 alone, drive it with a literal D-Bus call:

```bash
make install
# X11: Alt+F2, r, Enter. Wayland: log out and back in.
gdbus call --session --dest org.dasbo.Island --object-path /org/dasbo/Island \
  --method org.dasbo.Island.Notify claude Notification "$PWD" 4242 \
  '{"hook_event_name":"Notification","session_id":"fake-1","cwd":"'"$PWD"'","message":"Claude is waiting for your input"}'
```

Confirm all five:

1. The popup opens on its own, the row reads "Claude is waiting for your input", and both the popup and the text revert after five seconds.
2. Open the popup by hand first, then fire the call: the text appears and expires, and the popup **stays open**.
3. Fire the call, and while the popup is up run `tools/fake-agent.js perm`: the permission row appears and the popup **stays open** past the five seconds.
4. Set `notification-seconds` to 0 in the preferences, fire the call: the popup opens and stays, and the text stays until you run `tools/fake-agent.js tool`.
5. Turn `notification-popup` off, fire the call: nothing opens. Open the popup by hand within five seconds and the text is on the row anyway — the store was still told.

- [ ] **Step 7: Commit**

```bash
git add src/dbus/service.ts src/extension.ts src/shell/island.ts
git commit -m "feat(shell): open the popup for a notice, and only close what it opened

_noticeOpened is the whole safety story. Three things clear it and each
is a case where closing would be wrong: the user closed the popup
themselves, a permission arrived and needs its buttons reachable, or the
popup was already open and is not this feature's to take.

Zero seconds arms no timer and so sets no flag, or the next notice's
timer would inherit permission to close a popup it never opened.

The close source is released from _releaseExternalRefs, not destroy(): a
panel rebuild by Dash to Panel reaches only the former."
```

---

### Task 7: Drive it without an agent, and write down what is known

**Files:**
- Modify: `tools/fake-agent.js` (usage comment ~line 3; `events` ~line 18; `payloads` ~line 27)
- Modify: `docs/agent-dialects.md` (the Claude section — add a `Notification` note beside the existing `SessionEnd` one)
- Modify: `README.md` (a paragraph beside the task-list one; the Supported agents table row for Claude)
- Test: none — tooling and prose.

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: `tools/fake-agent.js notify [session-id]`.

- [ ] **Step 1: Add the fake-agent mode**

In `tools/fake-agent.js`, update the usage comment:

```js
// Usage: tools/fake-agent.js session|tool|perm|ask|tasks|notify|sessionend [session-id]
```

Add to `events`, after `tasks`:

```js
  notify: 'Notification',
```

Add to `payloads`, after the `tasks` entry:

```js
  notify: {
    hook_event_name: 'Notification', session_id: sessionId, cwd: GLib.get_current_dir(),
    message: 'Claude is waiting for your input',
  },
```

`blocking` is `mode === 'perm' || mode === 'ask'`, so `notify` correctly goes down the `Notify` path with no reply expected. No other change to the file.

- [ ] **Step 2: Record what is known and what is not**

In `docs/agent-dialects.md`, in the Claude Code section, immediately after the paragraph beginning "A sixth hook, `SessionEnd`, was wired into the extension's install plan later", add:

```markdown
A seventh hook, `Notification`, was wired in later still (again see
`CLAUDE_EVENTS` in `src/core/install/plan.ts`) and is **uncaptured** for the
same reason: no fixture exists in `test/fixtures/claude/`, and the field the
adapter reads — `message`, carrying the text shown to the user — was taken from
the published shape rather than off a verbatim payload. `session_id` and `cwd`
are the only fields `normalize` requires, and both are common to every captured
Claude payload, so the event normalises even if `message` is spelled
differently; the adapter then leaves `detail` undefined and the feature is
silent rather than wrong. Capturing one is a matter of registering
`tools/capture-hook claude` under `Notification` and leaving a session idle for
a minute.
```

- [ ] **Step 3: Update the README**

In `README.md`, add a paragraph after the one about task lists (the one ending "`/clear` starts a fresh list, because it starts a fresh session id."):

```markdown
When an agent says it is waiting on you — Claude raises this after its prompt
has sat idle, and for any permission the island did not answer itself — the
message appears on that session's row and the popup opens to show it. Both
revert a few seconds later, and a popup you opened yourself is never closed
for you. The delay, and whether the popup opens at all, are in the
preferences; set the delay to zero to keep the message until the agent does
something else.
```

In the Supported agents table, leave the Claude row's fixture count at 17 unless Step 4 captured one, in which case change it to 18. Either way the count stays truthful — `docs/agent-dialects.md` now records exactly which events are behind it.

- [ ] **Step 4 (optional but preferred): Capture a real payload**

Register the capture hook for the one uncaptured event and leave a session idle:

```bash
mkdir -p /tmp/dasbo-notif/.claude
cat > /tmp/dasbo-notif/.claude/settings.json <<EOF
{ "hooks": { "Notification": [ { "hooks": [ { "type": "command",
  "command": "env DASBO_FIXTURE_DIR=$PWD/test/fixtures $PWD/tools/capture-hook claude" } ] } ] } }
EOF
cd /tmp/dasbo-notif && claude
```

Ask it something that needs permission, or leave the prompt untouched for a minute or two. Then:

```bash
ls test/fixtures/claude/raw-*.json
```

If a file appeared, rename it `Notification-<n>.json` following the existing convention, check whether the text field really is `message`, and if it is not, correct `src/core/adapters/claude.ts`, the Task 2 tests, and the `docs/agent-dialects.md` paragraph above to match what was actually sent. Then bump the README's fixture count to 18 and drop the word "uncaptured" from the dialects paragraph.

If nothing appeared, leave everything as written — "inferred" is the honest label, and this project's Codex note exists precisely because someone once wrote adapter code from something other than an observed payload.

- [ ] **Step 5: Run the full verification, end to end**

```bash
npm test && npm run typecheck && make install
```

Then reload the Shell (X11: `Alt+F2`, `r`, Enter — Wayland: log out and back in), open the preferences, and press **Update** on the Claude row. It must be offering Update, because Task 4 added a seventh event to a set the installed file does not have; if it says Installed instead, `make install` did not pick up the rebuild.

Then run the five checks from Task 6 Step 6, using `tools/fake-agent.js notify` in place of the `gdbus call`. Tick Task 6's Step 6 box once they pass.

- [ ] **Step 6: Commit**

```bash
git add tools/fake-agent.js docs/agent-dialects.md README.md test/fixtures/claude
git commit -m "docs: say what a notification does, and admit what is not captured

fake-agent grows a notify mode so the open-and-close behaviour can be
driven without waiting a minute on a real session.

The dialects doc gets a Notification paragraph in the same shape as the
SessionEnd one: the event is wired in on the strength of the shape every
other Claude hook shares, not on a payload anyone here has seen."
```

---

## Self-Review

**Spec coverage.** Every section of the design maps to a task: install plan → 4; `hooks/dasbo-hook` unchanged → stated in Global Constraints; `types.ts` → 1; `adapters/claude.ts` → 2; `store.ts` → 1; `activity.ts` → 3; `dbus/service.ts` → 6; `island.ts` → 3 (clock threading) and 6 (open/close); `sessionRow.ts` → 3; gschema → 5; `prefs.ts` → 5; `extension.ts` → 5 (store wiring) and 6 (service seam); `fake-agent.js` → 7; `README.md` → 7; the capture-a-fixture recommendation → 7 Step 4. Every row of the spec's failure table has a test or a manual check: the six decidable ones are covered by Task 1's and Task 3's tests, and the five popup-behaviour ones by Task 6 Step 6's numbered list.

**Type consistency.** `SessionNotice` is introduced in Task 1 and used by name in Tasks 1 and 3. `notificationSeconds` is spelled the same in Tasks 1 and 5. `notifyNotification` and `onNotification` are spelled the same in Task 6's three files. `activityText(session, now)` and `update(session, now)` are introduced in Task 3 and every call site in the repo is updated there — `sessionRow.ts` constructor, `sessionRow.ts` tick, `island.ts` `_rebuildRows`, `island.ts` `showJumpFailure`, and twelve calls in `test/core/activity.test.ts`.

**Ordering.** Tasks 1→2→3 are a chain; 4 is independent and could run any time; 5 must precede 6, because `notifyNotification` reads both keys. Task 7's verification depends on all of them, which is why Task 6's manual step is written to be either deferred to Task 7 or run standalone with `gdbus call`.
