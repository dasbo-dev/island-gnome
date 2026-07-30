# A sound for the events that need you

Every signal this extension raises is visual. The pill blinks, the popup opens,
a message lands on a row — and all of it is invisible the moment your eyes are
somewhere else, which is exactly when an agent blocked on a permission is
costing you the most. A session can sit waiting for a full minute in a
workspace you are not looking at.

This plays a short sound for the four things that want your attention: a
permission request, an agent's question, a notification, and a session
finishing. One switch in the preferences turns all of it off.

## Decisions

| Question | Decision |
|---|---|
| Which events? | Permission, question, notification, done |
| Where do the sounds come from? | The desktop's sound theme, via mutter's player |
| How many settings? | One switch, `notification-sounds`, default on |
| Coupled to the popup's rules? | No — sound fires even in fullscreen, and with the auto-open switches off |
| Per-event volume or custom files? | Neither |
| Does `/clear` count as a finished session? | No — decided during review. Claude's `SessionEnd` hook fires on `/clear` too, a keystroke pressed several times an hour; an `endedByClear` flag skips the cue for it. See the Done section. |
| Honour Do Not Disturb (`org.gnome.desktop.notifications show-banners`)? | No — decided during review. The island is not a notification service, and a blocked agent is waiting on you regardless of DND. See Architecture. |

Cue to theme name:

| Cue | Theme name |
|---|---|
| Permission request | `dialog-warning` |
| Agent question | `window-question` |
| Notification / waiting on you | `message-new-instant` |
| Session finished | `complete` |

Two consequences accepted rather than solved:

- **The timbre is the theme's choice, not ours.** A user on a sparse sound
  theme may hear the same fallback for two different cues. Following the
  desktop the extension lives in was preferred to shipping four opinions about
  what a permission ought to sound like.
- **No volume control.** `play_from_theme` takes no volume, so a level would
  force bundled audio files and a hand-rolled player. The system volume is the
  control.

## Why themed sounds

Three ways to make a noise were considered.

- **Bundle four `.oga` files** and call `play_from_file`. Full control of
  character, identical on every distro, and volume becomes possible later.
  Costs four licence-clean assets, extension size, and — the deciding flaw —
  sounds that ignore a sound theme the user chose deliberately.
- **Themed names plus a custom-file override per cue.** Most flexible. Costs
  four string keys, four file-chooser rows, path validation and a fallback
  path, against a feature whose entire settings surface is one switch. YAGNI.
- **Themed names only**, `play_from_theme`. No assets, no licensing, no
  fallback logic of our own — libcanberra already walks the theme's parents
  down to `freedesktop`.

**Themed names only is chosen.** It is the smallest thing that respects the
desktop around it, and it lets the extension say "we ask your sound theme"
instead of "we guessed four sounds".

Verified on this machine rather than assumed: `Meta-14.typelib` exports
`get_sound_player`, `play_from_theme` and `play_from_file`, and
`/usr/share/sounds/freedesktop/stereo` carries all four names above.

## Architecture

Two new files, and the split is the one `src/core` purity already forces —
sharpened during review, when the play *decision itself* moved fully into the
pure side too, rather than living only as source the wiring tests could grep.

`src/core/sound.ts` — pure, no `gi://`:

```ts
export type SoundCue = 'permission' | 'question' | 'notification' | 'done'
export const CUE_SOUNDS: Record<SoundCue, string>
export const THROTTLE_MS: number
/** Keys whose state moved into 'done' since the previous snapshot. */
export function newlyDone(prev: Map<string, SessionState>, next: Session[]): string[]
export function snapshotStates(sessions: Session[]): Map<string, SessionState>
/** The one place that decides whether a cue actually sounds. */
export function shouldPlay(input: {
  enabled: boolean
  eventSounds: boolean | null
  last: number
  now: number
}): boolean
```

`src/shell/soundPlayer.ts` — the only file in the tree that touches audio, and
now a thin adapter that gathers `shouldPlay`'s three inputs, calls it, stamps
the per-cue clock and plays — it does not re-decide anything itself:

```ts
export class SoundPlayer {
  constructor(settings: Gio.Settings)   // the extension's own settings
  play(cue: SoundCue): void
  markDestroyed(): void
  destroy(): void
}
```

`play` gathers `enabled`, `eventSounds` and the cue's `last`/`now` and hands
them to `shouldPlay`, which returns `false` when any of three things is true,
checked in this order:

1. `notification-sounds` is false.
2. `org.gnome.desktop.sound event-sounds` is **explicitly** false — `null`
   (the schema not installed at all) is read as permissive, not as silence,
   because a desktop with no way to say it wants quiet must not be read as
   saying so; rule 1 alone keeps governing in that case. This check is
   **ours**, not inherited: mutter's player calls libcanberra directly and it
   is not known whether it consults the key. A beep from this extension on a
   desktop the user silenced is the worst failure this feature can produce,
   so it is checked here regardless, and harmlessly twice if mutter checks
   too. **Contrast, deliberately:** Do Not Disturb
   (`org.gnome.desktop.notifications show-banners`) is a different key
   entirely and is *not* checked anywhere in this feature — decided during
   review, not an oversight; see Decisions.
3. The same cue played less than `THROTTLE_MS` (500 ms) ago. Two sessions can
   reach one cue in a single tick, and two overlapping `dialog-warning`s read
   as a glitch rather than as two events. The throttle is per cue, so a
   permission and a notification arriving together are both heard.

Two more guards exist only in `soundPlayer.ts`, ahead of `shouldPlay`, because
they need GObject/GLib and have no meaning in a pure function:

- **The clock.** `now`, and each cue's stamp in `_last`, come from
  `GLib.get_monotonic_time() / 1000`, not `Date.now()`. The wall clock is not
  monotonic; a backwards NTP step of N milliseconds would otherwise leave
  every cue's stamp N milliseconds in the future and silence it for the whole
  of N — the same lesson `island.ts` already applies elsewhere for backwards
  clock handling.
- **Two checks before `shouldPlay` is even called:** a `_destroyed` flag, set
  by `markDestroyed()`, so a permission settled to `done` mid-teardown cannot
  chime on the way out (see Error handling); and whether the *compiled*
  schema actually carries the `notification-sounds` key at all, checked once
  in the constructor with `settings_schema.has_key(...)` rather than on every
  `play()`.

Otherwise: `global.display.get_sound_player().play_from_theme(name, description,
null)`, wrapped in `try`/`catch`. The `description` argument is the
human-readable event name libcanberra passes on to the sound server, where it
can surface in a per-application volume list — so it is `Dasbo Island:
permission request` and the like, not the theme name repeated.

The decision and the name map live in core so they are unit-tested with real
imports rather than only greppable out of the player's source. The player
lives in shell because `global.display` cannot be imported in a test, and
because the clock and the two guards above genuinely need GLib. Nothing else
in the tree learns that sound exists beyond calling `play`.

`extension.ts` constructs the player in `enable()`, passes it to `Island`, and
calls `destroy()` from a `safely(...)` step in `disable()` alongside the other
teardown — and, ahead of that, an earlier teardown step calls
`markDestroyed()` so a fallthrough resolution reached mid-teardown cannot
chime on the way out (see Error handling).

## Data flow

Four cue sites. Three are existing event paths; the fourth is a diff.

### Permission and question

`service.ts` already tests whether a new request actually *became* the active
hold before calling `onPermissionOpened()` — a request that merely queued
behind another calls nothing. Sound inherits that test for free: a parallel
tool batch of five permissions makes one sound. The two call sites are already
separate, so they gain an argument saying which they are:
`onPermissionOpened('permission')` and `onPermissionOpened('question')`.

The same silence reaches one case further than a simultaneous batch, though:
`PermissionTable.activate()` can promote a queued request to active minutes
later — after the one ahead of it resolves or times out — and it does that by
calling the store directly, never through `onPermissionOpened`. A permission
promoted that way makes no sound. This is consistent rather than a gap:
promotion is silent visually too (no pulse, no auto-open), so sound simply
follows the same rule the popup already does. Noted here so the next reader
does not mistake it for an oversight.

In `Island.notifyPermissionOpened(kind)` the cue plays above every existing
line, including the notice-timer reset:

```
notifyPermissionOpened(kind):
  this._sound.play(kind)                 // new, first
  this._noticeOpened = false             // existing
  this._cancelNoticeClose()              // existing
  if (!auto-open-on-permission) return
  if (fullscreen) return
  this.menu.open(true)
```

First, rather than after the guards, is what makes "independent of the popup's
rules" true by construction instead of by comment.

### Notification

Here the existing order changes. Two of the three guards are popup policy; one
asks whether there is anything at all.

```
notifyNotification(key):
  session = store.get(key)
  if (!session || !noticeVisible(session, now)) return    // moved up
  this._sound.play('notification')                        // new
  if (!notification-popup) return                         // was first
  if (fullscreen) return                                  // was second
  ... existing open and close-timer logic, unchanged
```

The `noticeVisible` move is the substantive edit, and it is required rather
than tidy. A notification arriving while a permission still holds the row means
there is nothing new to show *and* nothing new to hear; and Claude's
notification payload is inferred rather than captured, so a differently spelled
message field must leave this silent. Beeping for a message the row will not
display is the audible form of the empty-popup failure that check exists to
prevent. The reorder is safe because `noticeVisible` is a pure read of store
state, moved past two boolean setting reads.

### Done

No event carries "finished". `store.apply` reaches `done` through its state
switch, but so does `clearPending`, when a session ends while a permission is
held — a service-level hook would miss that path entirely. So the cue comes
from a state diff in `Island.refresh()`, which already runs on every store
emit:

```
refresh():
  next = this._store.list()
  for (key of newlyDone(this._lastStates, next)) this._sound.play('done')
  this._lastStates = snapshotStates(next)
  ... existing render
```

The throttle collapses a batch of simultaneous finishes into one sound.

`refresh()` also runs on the 1 s tick, on `changed::always-show`, and on
fullscreen changes. A state diff is silent for all three, because none of them
moves a state.

Edge cases this settles:

- **A key with no previous entry never cues**, even if it first appears already
  `done`. This costs the rare session whose first-ever event is its last, and
  buys silence at `enable()`, where every session in a freshly built store
  would otherwise look newly finished.
- **Reaped sessions** leave `_lastStates` with the next snapshot, so a `done`
  session that lingers, is reaped, then reappears under the same key is a fresh
  entry — and silent, by the rule above.
- **`done` → `running`** re-arms the cue. An agent that keeps working after a
  session-end event sounds again when it next finishes. Intended.
- **A session ended by `/clear` never cues**, regardless of the diff above.
  See the decision immediately below.

**A decision made during review, which this spec did not ask for at the
time:** `/clear` must not sound like a finished session. The only route to
`done` is a session-end event, and for Claude that is the `SessionEnd` hook,
whose `reason` values are `clear`, `logout`, `prompt_input_exit` and `other`
— so before this fix, **every `/clear` played `complete`**, on a keystroke
pressed several times an hour, while the moment a user would actually call
"the agent finished" (`turn-end` → `idle`) cued nothing at all. The fix
threads the reason through `claudeAdapter.normalize` and `SessionStore.apply`
as an `endedByClear` flag on the event and the session, and `newlyDone` skips
a session carrying it.

The honest caveat, kept rather than smoothed over: Claude's `SessionEnd`
payload is inferred rather than captured from a real hook (see
`docs/agent-dialects.md`), so if a real hook spells its `reason` differently
than assumed, `endedByClear` simply stays `undefined` and the cue plays —
the failure direction is today's pre-fix behaviour, not a new and unexpected
silence.

## Settings

One key, appended to the existing schema:

```xml
<key name="notification-sounds" type="b">
  <default>true</default>
  <summary>Play a sound for events that need you</summary>
  <description>Sounds come from the desktop's sound theme. Also silent when the system's own event sounds are off.</description>
</key>
```

Default on: all four cues mark something waiting on you or finished for you,
which is the bar the popup-opening defaults already clear. A user who dislikes
it finds one switch.

One `Adw.SwitchRow` in the existing **Notifications** group on the Behaviour
page, bound with `settings.bind` like every other switch there:

> **Play a sound** — When an agent needs an answer, raises a notification, or
> finishes. Uses your desktop's sound theme, and stays silent when system
> sounds are off.

No volume row, no per-event rows, no test-sound button.

## Error handling

Three failure modes in the play call itself, all silent and all non-fatal:

- `get_sound_player()` throws or returns null → caught, `console.warn` **once**
  per player instance, which is once per `enable()`, and never again. A
  repeated warn on a path reached from a 1 s refresh would flood the journal.
- `play_from_theme` throws, or the theme lacks the name → libcanberra falls
  back through the theme's parents to `freedesktop`; if that misses too,
  nothing plays and the caller sees no error.
- The cancellable is `null` deliberately. These are one-shots a few hundred
  milliseconds long, with nothing to cancel, and a stored `Gio.Cancellable`
  would be one more thing for `destroy()` to get wrong.

No cue is worth an exception escaping a GLib callback — that removes the
source, and one of these sources is the refresh path.

Two more hazards surfaced during review, both about *aborting the compositor*
rather than merely failing to beep — a different order of severity, so they
are guarded ahead of the play call rather than caught:

- **A skipped schema recompile.** `Gio.Settings.get_boolean` on a key absent
  from the *compiled* schema is `g_error`, which aborts the whole shell
  process, not just this extension. `SoundPlayer`'s constructor checks
  `settings.settings_schema.has_key('notification-sounds')` once and remembers
  the answer; `play()` returns immediately if it was false. Silence is a
  survivable degradation for a stale install; aborting the compositor on the
  user's first permission request is not.
- **A chime during teardown.** `disable()`'s teardown can resolve a held
  permission straight through to `done` (via `PermissionTable.resolveAllFallthrough`
  → `clearPending`), which reaches `Island.refresh()` → `play('done')` while
  the island is still alive — its own teardown step has not run yet. A
  `markDestroyed()` call, made before that resolution step (not reordering it —
  only adding an earlier "go silent" flag), makes `play()` a no-op for the
  rest of teardown. `destroy()` still runs later in its usual place to release
  the rest of the player's state.

`destroy()` clears the throttle map and drops the player reference. There are
no timers to remove: the throttle is a timestamp comparison, not a
`timeout_add`.

One more failure mode addressed, not in the play call but in the clock behind
the throttle: `Date.now()` is not monotonic, so a backwards NTP step of N
milliseconds would leave every cue's stamp N milliseconds in the future and
silence every cue for the whole of N. The throttle now reads
`GLib.get_monotonic_time() / 1000` instead, which cannot step backwards.

## Testing

Behaviour in `test/core/`, wiring pinned by source assertions in
`test/shell/`, as the rest of the suite already does.

`test/core/sound.test.ts`

- every `SoundCue` has an entry in `CUE_SOUNDS`, and the four names are
  distinct
- `newlyDone`: `running` → `done` cues; `done` → `done` does not; absent →
  `done` does not; `done` → `running` → `done` cues twice; a session carrying
  `endedByClear` never cues, one carrying no such flag still does
- `snapshotStates` drops keys absent from the new list
- `shouldPlay`, with real imports rather than source assertions: each of the
  four rules in isolation (extension switch off, desktop switch explicitly
  off, `eventSounds: null` read as permissive, the throttle boundary at
  exactly `THROTTLE_MS` — `<`, not `<=`), and several reasons to stay silent
  at once still returning `false`

`test/shell/sound.test.ts`

- `soundPlayer.ts` is the only file in the tree containing `play_from_theme`
  (walked across `src/`, not named file by file)
- it delegates to `shouldPlay` rather than re-implementing the mute checks or
  `THROTTLE_MS` itself
- it reads `GLib.get_monotonic_time()` for the throttle clock, never
  `Date.now()`
- `play_from_theme` sits inside a `try`
- `_destroyed` is checked as the very first statement in `play()`
- the constructor checks `settings_schema.has_key('notification-sounds')`
  once, and `play()` returns immediately if that was false
- `destroy()` sets `_destroyed` before it nulls `_desktop`, so a post-destroy
  `play()` cannot be un-skipped by the null check that used to gate the
  `event-sounds` read
- `island.ts` calls `_sound.play(` before it reads `auto-open-on-permission`
- `island.ts` calls `noticeVisible` before it reads `notification-popup` — the
  reorder above, pinned so a later edit cannot quietly put policy back in front
  of it
- `extension.ts` constructs the player, calls `markDestroyed()` ahead of
  `resolveAllFallthrough()`, and destroys it in `disable()`

`purity.test.ts` covers `src/core/sound.ts` automatically.

**Not covered, and the README will say so:** that any sound is actually
audible. Nothing in this suite can hear. The `event-sounds` assertion is about
*our* check, not about mutter's behaviour, which remains unverified — see the
note in the architecture section.
