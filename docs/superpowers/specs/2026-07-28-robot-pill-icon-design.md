# An animated robot head in the pill

Date: 2026-07-28
Status: approved, ready for planning

## Problem

The pill's state indicator is an 8px coloured dot (`.dasbo-dot` in
`stylesheet.css`, constructed at `src/shell/island.ts:72`). Five session states
map onto five background colours, and the whole vocabulary is hue: blue is
running, yellow is waiting, red is error, green is done, grey is idle.

That is fine as a per-session marker in the popup, where a dot sits beside text
that names the state. In the top bar it is the only glyph the extension owns,
and it carries no meaning to anyone who has not learned the colour code, is
red/green colour-blind, or is looking at the panel peripherally. A pill that
says an agent is *alive* wants a face, not a swatch.

The one piece of motion the pill has today is a pulse on pending permissions
(`_startPulse` / `_pulseStep` / `_stopPulse`, `island.ts:171-192`), easing the
dot's opacity between 90 and 255. It works, but it is bolted onto a widget with
no other expressive range.

## Design

A robot **head** — not a full body — replaces the pill's dot. The head alone is
the right unit at top bar size: a body's limbs are illegible below ~24px, while
eyes, mouth and antenna stay readable and carry the whole state vocabulary.

The head expresses all five states. No dot remains in the pill. **Per-session
dots in the popup are unchanged** — `.dasbo-dot` and `src/shell/sessionRow.ts`
are untouched, and the head's accent colours are the same hexes those dots use,
so the colour language stays consistent across pill and popup.

### 1. Pure pose model — `src/core/robot.ts` (new)

All motion is a pure function of state and elapsed phase. No clock is read
here; the caller passes `phaseMs`, the same discipline `AgentEvent.ts` applies
to `ts`. `test/core/purity.test.ts` walks `src/core`, so this file is covered
by the no-`gi://` rule automatically.

```ts
export interface RobotPose {
  eyeOpen: number        // 0..1 lid aperture; 0 is a closed stroke
  eyeX: number           // -1..1 gaze offset; at this size the eye dot *is*
  eyeY: number           // the pupil, so the whole dot travels
  eyeShape: 'round' | 'cross' | 'arc'
  mouth: 'none' | 'flat' | 'smile'
  antennaLit: number     // 0..1 accent alpha
  headTilt: number       // radians
  headShakeX: number     // -1..1 of the shake's full amplitude, which the
                         // drawing code scales (see the error row below)
  zzz: number[]          // 0..1 rise progress per glyph; empty unless asleep
  scale: number          // 1.0 baseline; the done one-shot pops above it
}

export function robotPose(
  state: SessionState,
  phaseMs: number,
  animateIdle: boolean
): RobotPose

/** Milliseconds until the next repaint. 0 means stop the timer entirely. */
export function tickIntervalMs(
  state: SessionState,
  phaseMs: number,
  animateIdle: boolean
): number
```

`tickIntervalMs` takes `phaseMs` because the one-shots genuinely stop: past its
window it returns `0` and the widget releases its timer, rather than repainting
an unchanging pose forever.

Both functions switch over an exhaustive `Record<SessionState, …>`, so adding a
sixth session state fails the build rather than silently rendering nothing.

### 2. Poses

Geometry is expressed in unit coordinates (0..1 of the surface) so it scales
with the widget box and with HiDPI.

| State | Eyes | Mouth | Antenna | Motion | Tick |
|---|---|---|---|---|---|
| idle | closed — a horizontal stroke each | none | dim accent | Zzz drift up and right, 3s loop | 3 Hz, or **0** when `animate-idle` is off |
| running | open dots | flat | accent, slow brightness breathe | eyes scan left↔right, 1.4s ease-in-out cycle | 6 Hz |
| waiting | open dots, centred | flat | accent, hard blink | static head tilt ~8°, antenna blinks at 1 Hz | 2 Hz |
| error | crossed strokes (`x x`) | flat | dim | one-shot head shake, ±4.5% of width, 3 oscillations damped over 500ms | 6 Hz then 0 |
| done | upward arcs (`^ ^`) | smile arc | accent lit | one-shot scale pop 1.0 → 1.18 → 1.0 over 300ms | 6 Hz then 0 |

With `animate-idle` off (the default), the idle pose is still drawn as asleep —
closed eyes and static Zzz glyphs — it simply does not move, and the timer never
starts.

`setState` resets `phaseMs` only when the state actually changes. `refresh()`
runs on every store notification, and restarting the phase on each call would
retrigger the error shake and the done pop repeatedly.

### 3. The widget — `src/shell/robotHead.ts` (new)

A `GObject.registerClass`'d `St.DrawingArea` subclass.

- `setState(state: SessionState)` — recompute the tick, restart or stop the
  timer, reset `phaseMs` on a real transition.
- `setAnimateIdle(value: boolean)` — follow the GSettings key from section 6.
- `setPaused(paused: boolean)` — stop the tick regardless of state.
- `repaint` handler — `get_surface_size()`, read theme colours, call
  `robotPose`, draw with cairo, then `cr.$dispose()`. The dispose is mandatory:
  GJS leaks the Cairo context without it, and this handler runs several times a
  second.
- One `GLib.timeout_add`, released from a handler on the widget's own
  `destroy` **signal** rather than a `destroy()` method override. Clutter tears
  children down through `clutter_actor_destroy`, which emits that signal and
  does not necessarily route through a JS override — so the override would let
  the timer outlive the actor and fire against a disposed object.

Colours come from CSS, never from literals in the drawing code. The head shell
uses `get_theme_node().get_foreground_color()`, which tracks light and dark
themes for free. The accent uses the custom St property `-dasbo-accent`:

```css
.dasbo-robot {
  width: 1.4em;
  height: 1.4em;
  -dasbo-accent: #9e9e9e;
}
.dasbo-robot.state-running { -dasbo-accent: #62a0ea; }
.dasbo-robot.state-waiting { -dasbo-accent: #f5c211; }
.dasbo-robot.state-error   { -dasbo-accent: #e01b24; }
.dasbo-robot.state-done    { -dasbo-accent: #57e389; }
```

Same hexes as `.dasbo-dot`, so retuning a state's colour stays one edit for
pill and popup alike. `em` rather than `px` so the head tracks shell font
scaling, matching the reasoning already recorded for `.dasbo-pill-label`.

`St.ThemeNode.lookup_color(name, inherit)` returns `[found, colour]`; on
`found === false` the drawing falls back to the foreground colour rather than
painting nothing.

### 4. Island changes — `src/shell/island.ts`

- `_dot: St.Widget` becomes `_robot: RobotHead`. `STATE_CLASS` moves out of
  `island.ts` into `robotHead.ts`, which now owns the style class carrying
  `-dasbo-accent`. `STATE_WORD` stays — the pill's text label still uses it.
- `refresh()` (island.ts:311) calls `this._robot.setState(pillState(sessions))`
  in place of the `style_class` assignment, and the same value feeds
  `STATE_WORD` so the head and the label can never disagree.
- `_pulsing`, `_startPulse`, `_pulseStep` and `_stopPulse` are **deleted**
  (island.ts:171-192, plus the calls at 276 and 321). The waiting pose owns the
  pulse now.
- `notifyPermissionOpened()` keeps only its auto-open behaviour; its
  `_startPulse()` call goes.
- Tick gating: `refresh()` already computes `this.visible`, so it passes
  `this._robot.setPaused(!this.visible)`. Additionally the island connects
  `global.display`'s `in-fullscreen-changed` and pauses while the primary
  monitor is fullscreen, disconnecting the handler in `destroy()` under the
  same discipline as `_settingsChangedId` and `_menuStateId`.

The pill's label keeps its format: it still reads `3 · working`, still pinned
at 8em. The head is redundant with the word, deliberately — the word stays
readable without decoding a 20px pose.

### 5. Waiting outranks error in the pill

Today the pulse keys off `this._controls.size !== 0` rather than
`worstState()`, and the comment at `island.ts:273-276` records exactly why:
`RANK` places `error` above `waiting`, so a session sitting in `error` would
otherwise silence the pulse for another session with live Allow / Deny / Always
buttons on screen.

The head has one pose slot, so that workaround cannot survive as-is. The rule
becomes explicit: **when any session has a pending permission, the pill shows
the waiting pose, whatever `worstState()` returns.** A pending permission is
the only state that blocks an agent on the user; an error is informational and
the popup still reports it per session. Concretely, `refresh()` computes the
pill state as `waiting` if any listed session has a `pendingPermission`, and
otherwise falls through to the existing `allDone` / `worstState()` logic.

Per-session rows are unaffected — each row already shows its own state.

### 6. The `animate-idle` setting

Idle is the common case, and a shell that never stops animating is the real
battery cost — far more than the choice of drawing technique. So idle motion is
opt-in.

New key in `schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml`:

```xml
<key name="animate-idle" type="b">
  <default>false</default>
  <summary>Animate the robot while idle</summary>
  <description>Play the sleep animation while no agent is running. Costs a small amount of battery.</description>
</key>
```

Prefs gains an `Adw.SwitchRow` — "Animate while idle", subtitle "Play the sleep
animation while no agent is running. Costs a little battery." — in
`_appearancePage`'s Panel group, beside "Always show the pill" (prefs.ts:51).

`Island` connects `changed::animate-idle` alongside the existing
`changed::always-show` (island.ts:120) and disconnects it in `destroy()`, for
the reason already documented there: the settings object and the widget
reference each other through the closure, so a handler surviving `destroy()`
would touch a disposed actor.

### 7. Build

No new asset files and no build change. The head is drawn in code;
`build.mjs` already lists `cairo` as external.

## Data flow

Unchanged upstream. Hooks, D-Bus, adapters and `SessionStore` are untouched.

The only new flow is inside the pill:

```
store change -> Island.refresh()
                  -> pillState(sessions)      // waiting wins if any permission pends
                  -> RobotHead.setState()     // resets phase on a real transition
                  -> tickIntervalMs()         // schedules or stops the timer
                  -> repaint -> robotPose() -> cairo
```

plus two gates that can stop the timer without a store change: `setPaused` from
`this.visible`, and `setPaused` from `in-fullscreen-changed`.

## Error handling

The repaint body is wrapped in a try/catch that logs once and then disables
further repaints. An exception escaping a `repaint` handler would otherwise
reprint to the journal at tick rate, which is several lines per second — the
failure mode is a flooded journal, not a broken pill.

A missing `-dasbo-accent` falls back to the foreground colour, so a third-party
shell theme that strips custom properties yields a monochrome head rather than
an invisible one.

`robotPose` and `tickIntervalMs` are total over their inputs: `phaseMs` is
clamped at zero, cycles wrap by modulo, and every `SessionState` has a branch.

## Testing

`src/shell` has no unit tests — GJS widgets are not constructible under vitest
— so the widget, the stylesheet and the prefs row are verified manually. The
pose model lives in `src/core` and is unit-tested.

1. `test/core/robot.test.ts`, new:
   - `animateIdle: false` — the idle pose is identical at every `phaseMs`, and
     `tickIntervalMs` returns `0`.
   - `animateIdle: true` — the idle pose varies with `phaseMs`, and
     `tickIntervalMs` returns `333`.
   - One-shot decay — `tickIntervalMs('error', 100, …)` is non-zero,
     `tickIntervalMs('error', 600, …)` is `0`; likewise `done` either side of
     300ms.
   - `eyeX` stays within `-1..1` across a full running cycle and is
     continuous across the wrap.
   - Every `SessionState` returns a pose, asserted by iterating the state list
     rather than naming five cases.
   - `phaseMs` of `0` and of a negative value both yield the state's rest pose.
2. `test/core/purity.test.ts` covers `robot.ts` with no change — it walks the
   directory.
3. `npm test` and `npm run typecheck` green.
4. `make install`, reload the shell, then with `tools/fake-agent.js`:
   - Drive a session through running, waiting, error and done; confirm each
     pose is distinguishable at real panel size without squinting.
   - Confirm the head reads correctly on both a light and a dark shell theme.
   - Confirm a pending permission shows the waiting pose even while another
     session sits in `error` (section 5).
   - Confirm the timer actually stops: with `animate-idle` off and one idle
     session, the pill must be static, and `top` must show no ongoing
     `gnome-shell` CPU attributable to the pill.
   - Confirm the error shake and done pop each fire once and settle, and do not
     retrigger on unrelated store updates.
   - Confirm animation stops under a fullscreen window and resumes after.

**Known visual risk, to be resolved in step 4.** At `1.4em` the surface is
roughly 20×20px, giving an 11.6×9.9px head with a 1.4px stroke and 1.3px eye
dots — all safe. The two small glyphs are not: the largest Z stroke is about
1.9px and the smile arc about 3.4px wide. Either may read as noise. If they do
not read, the fallbacks in order are rising dots instead of Z strokes, then
closed eyes alone with no sleep glyph; the smile falls back to a flat mouth
with the accent lit. These are constants in `robot.ts` and `robotHead.ts`, so
each fallback is a small edit, not a redesign.

Two geometry invariants constrain any such tuning, and both are tight at the
shipped values: eyes must stay inside the head outline
(`EYE_DX + EYE_TRAVEL + EYE_R <= HEAD_W/2 - STROKE`), and the `done` pop must
stay inside the widget
(`(HEAD_H/2 + ANTENNA_LEN + ANTENNA_TIP_R + STROKE/2) * 1.18 - HEAD_CY <= 0.5`).

## Out of scope

- `src/shell/sessionRow.ts`, `.dasbo-dot`, and the popup's per-session colours.
  They stay exactly as they are; the popup's colour code is the reason the
  head's accents reuse the same hexes.
- A user-selectable robot design, or any theming beyond the two theme colours.
  One head that looks right beats a preference nobody opens.
- Replacing the pill's text label. The head is deliberately redundant with the
  word, so the pill stays legible without decoding a 16px pose.
- Per-session robot heads in the popup rows. Five animated widgets in an open
  menu is a different performance question, and the rows already name their
  state in text.
