# Showing an agent's notification on its row

Date: 2026-07-30
Status: approved, ready for planning

## Problem

Claude Code raises a notification when it has been waiting on the person at the
keyboard for a while. The island never hears it. A session that has been sitting
on `idle` for four minutes because Claude asked a question in the terminal looks
exactly like one that finished its turn and is genuinely done — both read `idle`,
both have a still pill.

The row already knows how to say what is happening. It just is not being told
this one thing.

This design installs Claude's `Notification` hook, carries the message it sends
onto the session's activity line, opens the popup to show it, and puts both back
the way they were a few seconds later.

## What Claude actually sends

**This is inferred, not captured.** `test/fixtures/claude/` holds seventeen real
payloads across `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`
and `Stop`. There is no `Notification` among them, and `docs/agent-dialects.md`
does not cover the event. It sits in the same position `SessionEnd` does in that
document: wired into the install plan on the strength of the shape every other
Claude hook shares, not on the strength of a payload anyone here has seen.

The expected shape:

```json
{ "session_id": "...",
  "transcript_path": "...",
  "cwd": "...",
  "hook_event_name": "Notification",
  "message": "Claude is waiting for your input" }
```

`session_id` and `cwd` are the two fields the adapter actually requires, and both
are common to every captured Claude payload, so the event normalises even if
`message` turns out to be spelled differently. In that case the notice text is
absent, and — by the guard in `Island.notifyNotification` below — nothing opens
and nothing is shown. The feature degrades to "installed but silent" rather than
to an empty popup appearing on its own.

Capturing a real payload is cheap (`tools/capture-hook claude` registered under
`Notification`) and should be done before this ships; the fixture and a
`docs/agent-dialects.md` section for it are part of the work.

### The other two agents

Out of scope. Neither `docs/agent-dialects.md` nor either adapter records a
notification concept, and the README's Codex note is a standing warning against
writing adapter code from anything but an observed payload.

### What this event is worth, given the island already gates permissions

Claude raises `Notification` both when it needs permission for a tool and when
its prompt has been idle. The island answers `PreToolUse` itself, so in the
ordinary case no permission prompt is ever presented and no notification is
raised for one. What is left is the idle nudge — and the permission prompts the
island *declined* to answer, which is to say the ones that fell through on
`permission-timeout`. Both are precisely the cases where the row currently says
`idle` and means something else.

## Data flow

```
Claude Notification ──dasbo-hook claude notify Notification──▶ IslandService.Notify
                                                                  │ store.apply(e)
                                                                  │   e.kind === 'notification'
                                                                  │   → s.notice = { text, until }
                                                                  │   → state UNCHANGED
                                                                  ▼
                                                        opts.onNotification(key)
                                                                  │
                                                                  ▼
                                              Island.notifyNotification(key)
                                                 opens the popup, arms a close timer

any later event ──▶ store.apply ──▶ s.notice = undefined   (the notice is over)
the 1s tick      ──▶ now >= until  ──▶ activityText stops returning it
```

The notice lives on the `Session`, not on the widget. That is the whole
architectural decision here, and the reason is mechanical: `Island._rebuildRows`
calls `row.update(s)` on **every** store emit, and `update()` rewrites
`_activity.text` from `activityText(session)`. A string written straight onto the
label — which is what `showTransient` does today — is wiped by the next event
from any session in the popup. `showJumpFailure` survives only because nothing
usually emits during its two seconds.

Putting the notice on the record means it renders through the one path everything
else renders through, so no rebuild can clobber it, and it means the branch is a
pure function in `src/core/` that a test can prove.

## Components

### `src/core/install/plan.ts`

`CLAUDE_EVENTS` gains `'Notification'`, in `notify` mode. That is the only edit:
`expectedClaudeEntries` derives from the same list, so every existing install
immediately compares unequal and reports `stale`, and its row in the preferences
offers **Update**. The README already documents this exact case — "a release adds
a hook event the installed set is missing".

`CODEX_EVENTS`, `ANTIGRAVITY_GROUPED` and `ANTIGRAVITY_FLAT` are untouched.

### `hooks/dasbo-hook`

No change. `notify` mode already passes whatever event name it is given.

### `src/core/types.ts`

`EventKind` gains `'notification'`.

`Session` gains:

```ts
/**
 * Something the agent said while nothing was happening — Claude's Notification
 * hook. `until` is a deadline in ms since the epoch; 0 means no clock, in which
 * case only the next event ends it.
 */
notice?: { text: string; until: number }
```

### `src/core/adapters/claude.ts`

`KIND_BY_EVENT` gains `Notification: 'notification'`.

`normalize` routes the message through the existing `detail` field rather than
adding one to `AgentEvent`:

```ts
detail: kind === 'notification'
  ? str(raw['message'])
  : detailFromToolInput(raw['tool_input']),
```

A `Notification` payload carries no `tool_input` and a tool payload carries no
`message`, so the two can never contend for the field.

### `src/core/store.ts`

A new field, set from GSettings by the shell layer exactly as `doneLingerSeconds`
already is:

```ts
/** Seconds a notice stays on a row. 0 means until the next event replaces it. */
notificationSeconds = 5
```

In `apply`, after the common refresh (`lastEventAt`, `pid`, `processStartedAt`,
`lineageKey`, `transcriptPath`) and before the state switch:

```ts
if (e.kind === 'notification') {
  s.notice = e.detail
    ? {
        text: e.detail,
        until: this.notificationSeconds ? e.ts + this.notificationSeconds * 1000 : 0,
      }
    : undefined
  this.emit()
  return
}
s.notice = undefined
```

Two properties this fixes in place:

**A notification never changes state.** `state`, `currentTool`, `detail` and
`doneAt` are all left as the previous event set them, so `pillState` and the grid
icon are untouched. A notification is not activity; it is the absence of it.

**Any other event ends the notice**, whether or not its clock has run out. A
notice describes a silence, and the next event is proof the silence is over. A
tool starting one second after a notification must show the tool.

The early return also keeps the switch below exhaustive without a case for the
new kind: TypeScript narrows `e.kind` past `'notification'` at that `return`, so
`kindState`'s definite assignment still holds and no `default` branch has to be
invented to satisfy it.

`setPending` and `setPendingQuestion` clear `s.notice` too, for the same reason
they clear each other: a permission is the louder thing, and it arrives with
buttons the user has to reach.

`clearPending` does not restore it. A notice that was interrupted is spent.

### `src/core/activity.ts`

`activityText(session, now)` takes the clock. New branch, after the question and
permission branches and before the tool/detail ones, sharing its rule with a
new exported function rather than inlining it:

```ts
export function noticeVisible(session: Session, now: number): boolean {
  const notice = session.notice
  if (!notice) return false
  if (notice.until !== 0 && now >= notice.until) return false
  if (session.pendingPermission || session.pendingQuestion) return false
  return true
}
```

```ts
if (noticeVisible(session, now)) {
  return { text: truncateDetail(session.notice!.text), hint: false }
}
```

`truncateDetail` because `message` is agent-supplied and unbounded — the same
reasoning the `pending.tool` line above it already records.

`hint: false` because a notice is something the agent said, not a placeholder
standing in for absent content.

Below the pending branches so a permission's buttons are never described by
something other than the permission. This is not a defensive ordering against
something that cannot happen: `store.apply`'s notification branch sets
`s.notice` without touching `pendingPermission` or `pendingQuestion`, so the
ordinary sequence "a permission is requested, then Claude raises
`Notification` because the same prompt has also sat idle" leaves a session
holding both at once. `noticeVisible` is where that is decided once, and it is
exported specifically so `Island.notifyNotification` can ask the same
question before opening the popup — see that section below, and Fix 2 of the
review that made this change.

### `src/dbus/service.ts`

`ServiceOptions` gains:

```ts
/** Called when an agent raised a notification, so the UI can show it. */
onNotification: (key: string) => void
```

In `Notify`, after `store.apply(e)` and before the task-tool branch (which a
notification can never satisfy):

```ts
if (e.kind === 'notification') {
  this.opts.onNotification(key)
  return
}
```

`RequestPermissionAsync` is untouched: `Notification` is installed in `notify`
mode and never reaches it.

### `src/shell/island.ts`

`_rebuildRows` computes `const now = Date.now()` once and passes it to every
`row.update(s, now)`.

The open-and-close half:

```ts
notifyNotification(key: string): void {
  if (!this._settings.get_boolean('notification-popup')) return
  if (Main.layoutManager.primaryMonitor?.inFullscreen) return
  // No text, no notice, or a pending permission/question is holding the row
  // instead of it — nothing to show either way. noticeVisible is the single
  // place that decides which case this is, shared with activityText's own
  // notice branch (see src/core/activity.ts above), so the row and the
  // popup-open decision can never disagree about what the notice is doing.
  // This also covers the inferred-payload case above: no message means no
  // notice at all, which noticeVisible already treats as not visible.
  const session = this._store.get(key)
  if (!session || !noticeVisible(session, Date.now())) return

  this._cancelNoticeClose()
  const seconds = this._settings.get_int('notification-seconds')
  const wasClosed = !this.menu.isOpen
  if (wasClosed) this.menu.open(true)
  // The flag is set only when a timer is actually armed. With seconds = 0
  // nothing will ever read it, and leaving it true would hand the *next*
  // notification's timer permission to close a popup it did not open.
  if (seconds > 0) {
    this._noticeOpened = this._noticeOpened || wasClosed
    this._noticeCloseId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
      this._noticeCloseId = 0
      if (this._noticeOpened) {
        this._noticeOpened = false
        this.menu.close(true)
      }
      return GLib.SOURCE_REMOVE
    })
  }
}
```

`_noticeOpened` is the whole safety story. Three things clear it, and each is a
case where closing the popup would be wrong:

| What happens | Why the popup must not close |
|---|---|
| The user closed it themselves | `open-state-changed` to false clears the flag and cancels the timer. Nothing to close, and no timer left to fire into the next open |
| A permission or question arrived | `notifyPermissionOpened` clears the flag. The popup is now up for something that needs an answer; shutting it mid-click is the worst thing this feature could do |
| The popup was already open | The flag is never set, so a popup the user opened by hand to read a task list is never stolen from them |

A second notification during the window restarts the timer rather than stacking a
second source.

`_noticeCloseId` is released in **both** `destroy()` and `_releaseExternalRefs()`,
beside `_transientIds`. A Clutter-side destroy — a panel rebuild by Dash to Panel
— reaches only the latter, and a GLib source left pointing at a disposed widget
is exactly the failure that method's comment was written about.

### `src/shell/sessionRow.ts`

`update(session, now)` takes the clock. This reverses the standing comment that
"update() never knows the current time"; that comment is rewritten as part of the
change rather than left to contradict the code beneath it.

`tick(now)` additionally recomputes the activity line and writes only on a
difference:

```ts
const { text, hint } = activityText(this._session, now)
if (text !== this._activity.text) {
  this._activity.text = text
  this._activity.opacity = hint ? 178 : 255
}
```

The write-if-changed guard is what makes a once-per-second recompute acceptable,
and it is the discipline `_shellTotal` already follows in the same method.

This tick is the only thing that retires an expired notice. The store holds no
timer: expiry is a rendering fact, decided by comparing two numbers, not a store
event that has to be scheduled. Because the tick runs only while the popup is
open, a notice that expires behind a closed popup is simply never seen —
`_startTimer` ticks once immediately on open, so a stale one cannot be shown
either.

`showTransient` and `showJumpFailure` are left alone. They now sit beside a
mechanism that does the same job properly, and folding "no window" into
`Session.notice` is worth doing — but it puts a UI failure into the session model,
which is a different decision than this one and not one this feature needs. Noted
as follow-up, not done here.

### `schemas/…gschema.xml`

```xml
<key name="notification-popup" type="b">
  <default>true</default>
  <summary>Open the popup when an agent raises a notification</summary>
  <description>Suppressed while a fullscreen window is on the primary monitor.</description>
</key>
<key name="notification-seconds" type="i">
  <default>5</default>
  <summary>Seconds a notification stays on the row</summary>
  <description>How long the message replaces the row's activity line, and how long a popup opened for it stays open. Zero keeps it until the next event from that session, and never closes the popup.</description>
</key>
```

`0` reads the same way `permission-timeout: 0` already does: no clock.

### `src/prefs.ts`

A new `Adw.PreferencesGroup` titled **Notifications** on the Behaviour page,
after **Permissions**:

- `Adw.SwitchRow` — "Open the popup on a notification", subtitle "Suppressed
  while a fullscreen window is on the primary monitor", bound to
  `notification-popup`.
- `Adw.SpinRow` — "Keep a notification visible", subtitle "Seconds the message
  stays on the row. Zero keeps it until the agent does something else.",
  adjustment `lower: 0, upper: 300, step_increment: 1`, bound to
  `notification-seconds`.

### `src/extension.ts`

`notificationSeconds` is pushed into the store on `enable()` and on
`changed::notification-seconds`, in the same block that already does this for
`done-linger`. `ServiceOptions` gains
`onNotification: (key) => this._island?.notifyNotification(key)`.

### `tools/fake-agent.js`

Gains a `notify` mode that sends a `Notification` payload, so the open/close
behaviour can be driven without waiting sixty seconds on a real Claude session.

### `README.md`

A paragraph beside the task-list one: what a notification looks like on a row,
that the popup opens and closes itself, and that the Claude table row now covers
seven events. The Claude row's "verified against 17 real hook-payload fixtures"
claim stays honest only if a `Notification` fixture is captured; if it is, the
count goes to 18, and if it is not, the claim needs the same
`SessionEnd`-style caveat `docs/agent-dialects.md` carries.

## Failure behaviour

| What breaks | What happens |
|---|---|
| Hooks not updated after this release | No `Notification` entry, no events, rows exactly as today. The preferences row reports `stale` and offers **Update** |
| `message` is spelled differently, or absent | `detail` is undefined, no notice is set, `notifyNotification` returns early. Installed but silent — no empty popup ever appears |
| The whole payload is unrecognisable | `normalize` returns null on a missing `session_id` or `cwd`, as it does for every other event. Nothing reaches the store |
| A notification for a session the store has never seen | `ensure` creates the record, as every other event does. It opens on `idle` with the notice on it, which is true |
| The session is reaped mid-notice | The notice dies with the record; `notifyNotification`'s store lookup already guards the open |
| `notification-seconds` is 0 | The popup still opens, the notice stays until the next event from that session, and nothing ever closes the popup. `_noticeOpened` is deliberately not set, so a later notification's timer cannot inherit permission to close this popup |
| The user closes the popup during the window | Flag cleared, timer cancelled. The notice itself stays on the row until it expires or is replaced |
| A permission lands during the window | `notifyPermissionOpened` clears the flag, `setPending` clears the notice. The row shows the permission and its buttons, and the popup stays open |
| A notification arrives while a permission (or question) is already pending | `store.apply`'s notification branch sets `s.notice` without touching `pendingPermission`/`pendingQuestion`, so the session ends up holding both. `noticeVisible` returns false while either pending field is set, so `notifyNotification` opens nothing and arms no close timer, and `activityText` keeps rendering the permission or question. The notice is still recorded — if the pending hold resolves before the notice's own deadline, it is what the row shows next |
| Fullscreen window on the primary monitor | No open, matching `auto-open-on-permission`. The notice is still set, so it is on the row if the popup is opened by hand within the window |

Every path degrades either to today's behaviour or to "the notice is on the row
but the popup did not open itself". Neither loses information the row would
otherwise have had.

## Testing

- `test/core/activity.test.ts` — the notice branch; a notice suppressed by a
  pending permission and by a pending question; expiry exactly at `now === until`
  and one millisecond either side; `until: 0` never expiring; a notice longer
  than `truncateDetail`'s bound.
- `test/core/store.test.ts` — a `notification` event sets the notice and leaves
  `state`, `currentTool` and `detail` untouched; every other kind clears it;
  `setPending` and `setPendingQuestion` clear it; `notificationSeconds = 0`
  yields `until: 0`; a notification with no `detail` sets no notice at all.
- `test/core/adapters/claude.test.ts` — `Notification` maps to
  `kind: 'notification'`; `message` reaches `detail`; a `Notification` with no
  `session_id` normalises to null. Against a captured fixture if one exists by
  then, otherwise against a synthetic payload labelled inferred, the way
  `codex.test.ts` labels its own.
- `test/core/install/plan.test.ts` — `planInstall` writes the `Notification`
  entry in `notify` mode; an install missing it reports `stale`; `planUninstall`
  removes it; the Codex and Antigravity plans are unchanged.
- `island.ts`, `sessionRow.ts` and `prefs.ts` go untested, like every other
  module that needs a running Shell.
- Manual: `make install`, **Update** the Claude hooks, then
  `tools/fake-agent.js notify` — confirm the popup opens, the row shows the
  message, and both revert after five seconds; confirm a popup opened by hand
  first is not closed; confirm a permission arriving during the window keeps the
  popup open.

## Out of scope

A GNOME Shell message-tray notification. A notification history or log. Any
change to the pill icon or its animation — the 2×2 grid keeps meaning session
state, and a notification is not a state. Codex and Antigravity support.
Folding `showTransient` / `showJumpFailure` into `Session.notice`.
