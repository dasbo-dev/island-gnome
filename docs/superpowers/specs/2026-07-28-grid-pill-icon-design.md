# A 2×2 grid in the pill

Date: 2026-07-28
Status: approved, ready for planning

Supersedes `2026-07-28-robot-pill-icon-design.md`, which shipped on branch
`feat/robot-pill` and is not merged.

## Problem

The robot head does not survive its own size. The whole-branch review measured
each of its animation channels at the shipped 1.4em box (~20px) and found three
of four dead:

- The error shake ran three cycles over 500ms — 6.00Hz — against a 166ms tick,
  6.024Hz. The renderer sampled the sine at its own zero crossings and got 1.8%
  of the intended amplitude: 0.017px of travel. Five pixel-identical frames,
  four timer wakeups, no visible motion.
- The sleep glyphs were drawn on top of the head. At `ZZZ_X = 0.3` a glyph's
  centre sat 0.025 S inside the head's right wall, and the glyphs painted
  before the head, so its outline stroked through them. They were at full
  opacity where most occluded and faded out exactly as they emerged.
- The `done` smile's sagitta was 1.02px against a 1.58px stroke. Curvature at
  65% of stroke width rasterises to the same horizontal dash as `mouth: 'flat'`,
  so `done` and `running` had visually identical mouths.

All three were fixed, and the fixes were verified effective. But they share a
cause: the design spends its pixel budget on fine detail — a 4px glyph, a 1px
sagitta, a sub-pixel translation — inside a box that has no pixels to spare. A
fourth instance of the same class is likely, and each one is invisible until
someone measures it.

The robot is also expensive to draw: a rounded rect, an antenna stem, a tip
circle, four eye branches, two mouth branches, three glyph paths, and a
save/scale/rotate/restore transform, every frame.

## Design

Four rounded squares in a 2×2 grid. **The silhouette never moves.** Only per-block
alpha and the fill colour change. No transform, no stroke, no rotation, no
sub-pixel geometry.

States are distinguished by *rhythm*, not by detail: a travelling light, an
all-together blink, a static diagonal, a stagger. Rhythm reads at any size,
which is what the robot's poses did not.

### 1. Geometry

A 24-unit coordinate space. Blocks are indexed in **chase order** — clockwise
from top-left — and that index is the order every staggered animation uses.

| i | position | x, y | w, h | r |
|---|---|---|---|---|
| 1 | top-left | 2.4, 2.4 | 9.4 | 2.2 |
| 2 | top-right | 12.2, 2.4 | 9.4 | 2.2 |
| 3 | bottom-right | 12.2, 12.2 | 9.4 | 2.2 |
| 4 | bottom-left | 2.4, 12.2 | 9.4 | 2.2 |

Gap 0.8, outer margin 2.4: `2.4 + 9.4 + 0.8 + 9.4 + 2.4 = 24`.

At S = 16 the gap is 0.53 units of device pixel, and at S = 22 it is 0.73 — under
one pixel at every realistic size. **The gap is what makes it read as four
blocks rather than one square**, so it is snapped to device pixels and floored
at 1px, even where that costs a block a pixel of width:

```
S      = min(width, height)
u      = S / 24
block  = max(1, round(9.4 * u))
gap    = max(1, round(0.8 * u))
radius = round(2.2 * u)
span   = 2 * block + gap
left   = floor((width  - span) / 2)
top    = floor((height - span) / 2)
```

`left` and `top` are derived from width and height independently rather than
from `S`, so a surface that is not square still centres the grid inside it.

Verified across the realistic range (`x positions` assume a square surface):

| S | block | gap | radius | x positions |
|---|---|---|---|---|
| 16 | 6 | 1 | 1 | 1, 8 |
| 20 | 8 | 1 | 2 | 1, 10 |
| 22 | 9 | 1 | 2 | 1, 11 |
| 24 | 9 | 1 | 2 | 2, 12 |
| 32 | 13 | 1 | 3 | 2, 16 |
| 44 | 17 | 1 | 4 | 4, 22 |

Nothing is ever thinner than 6px. Compare the robot, whose thinnest meaningful
feature was a 1.02px arc sagitta.

### 2. Pose model — `src/core/grid.ts` (new)

```ts
export interface GridPose {
  /** Alpha per block in chase order: TL, TR, BR, BL. */
  alpha: [number, number, number, number]
  /** 'base' is the panel's foreground colour; 'accent' is the state colour. */
  fill: 'base' | 'accent'
}

export function gridPose(state: SessionState, phaseMs: number): GridPose

/** Milliseconds until the next repaint. 0 means stop the timer entirely. */
export function tickIntervalMs(state: SessionState, phaseMs: number): number
```

Both are pure and exhaustive over `SessionState`, so a sixth state is a compile
error (TS2366) rather than a silent `undefined`. Neither takes an `animateIdle`
parameter — see section 5.

Every value is a table lookup or a comparison. There is no sine, no easing
curve, and no interpolation anywhere in this file.

### 3. States

| State | Blocks (TL, TR, BR, BL) | Fill | Period | Tick | Wakeups/s |
|---|---|---|---|---|---|
| idle | 1–3 static at 0.14; block 4 breathes 0.45 ↔ 1.00 as an 8-step triangle | base | 3200ms | 400ms | 2.5 |
| running | current 1.00, previous 0.45, other two 0.20; step advances clockwise | base | 800ms | 200ms | 5 |
| waiting | all four together, 1.00 / 0.16 square wave | accent | 1300ms | 650ms | 1.54 |
| error | 1 and 3 at 1.00, 2 and 4 at 0.16 — **static** | accent | — | **0** | 0 |
| done | block *i* snaps to 1.00 at 0 / 100 / 200 / 300ms, then holds | accent | once, 300ms | 100ms → 0 | 3, once |

**Every tick divides its period exactly** — 3200/400 = 8, 800/200 = 4,
1300/650 = 2, 300/100 = 3. Phase advances by exactly the tick, so the sampled
sequence is the definition of the animation rather than an approximation of a
continuous curve. The aliasing that erased the robot's error shake is
structurally impossible here.

The frames were computed and checked for redundancy:

- **running** — 4 frames, 4 distinct. `(1.0, .2, .2, .45)`, `(.45, 1.0, .2, .2)`,
  `(.2, .45, 1.0, .2)`, `(.2, .2, .45, 1.0)`. A single bright block travelling
  clockwise with a one-step trail.
- **idle** — 8 frames, no two *consecutive* frames equal. The triangle repeats
  brightness values on the way down, which is correct: the block passes through
  the same alpha rising and falling.
- **waiting** — 2 frames, both distinct. An earlier 325ms tick was rejected: it
  produced 4 frames of which only 2 were distinct, so half its wakeups redrew an
  identical frame — the same waste the robot's error shake was guilty of.
- **done** — 4 frames, 4 distinct, then the timer stops with all four lit. The
  window ends at 300ms rather than 400ms because the widget advances the phase,
  repaints, *then* asks whether to continue: a 400ms window would render a final
  frame identical to the one at 300ms, where the fourth block already lit.

`error` is the only state that never schedules a timer. The static diagonal
pair is its whole signal, and it needs no motion to read.

### 4. Colour

`base` is `get_theme_node().get_foreground_color()` — the panel's own text
colour, so it tracks light and dark themes with no rule. Both `idle` and
`running` use it; they separate by motion, not hue.

`accent` is the custom St property `-dasbo-accent`, declared only for the three
states that use it:

```css
.dasbo-grid {
  width: 1.4em;
  height: 1.4em;
}
.dasbo-grid.state-waiting { -dasbo-accent: #f5c211; }
.dasbo-grid.state-error   { -dasbo-accent: #e01b24; }
.dasbo-grid.state-done    { -dasbo-accent: #57e389; }
```

Same hexes as `.dasbo-dot`, which the popup's per-session dots still use and
which this branch does not touch. `lookup_color` returns `[found, colour]`; on
`found === false` the drawing falls back to the foreground colour.

The box returns to square. The robot's 2em width existed only to give the sleep
glyphs somewhere to sit.

### 5. The `animate-idle` setting is removed

The robot shipped `animate-idle` (boolean, default `false`) so that idle — the
common state — cost zero compositor wakeups. The grid's idle state animates
unconditionally, so the key, its preferences row, and the island's
`changed::animate-idle` handler are all deleted.

This is a deliberate reversal, and the honest trade is worse than a first pass
made it look: the robot's `tickIntervalMs('idle', p, false)` returned **0**,
and `animate-idle` defaulted to `false`, so the robot's idle cost was **zero**
wakeups, not a smaller number to compare against — the "6 while running"
figure earlier drafts compared against was the robot's *running* rate, not its
idle one. The real change is idle going from zero wakeups to the grid's steady
**2.5 per second**, and there is no opt-out left to claw it back down to zero:
the setting that used to buy that is gone. It applies only while the pill is
*visible* with a session present, and with `always-show` off the pill is
hidden entirely at zero sessions — but `store.reap()` only drops a session on
a dead PID, so a terminal left open all day, whether or not the agent inside
it is doing anything, keeps a session present and the shell repainting for as
long as it sits there. The owner reaffirmed this decision after seeing the
corrected figure; idle keeps breathing unconditionally.

Removing a key from the schema leaves any value already in the user's dconf
orphaned. That is harmless: nothing reads it.

### 6. Drawing — `src/shell/gridIcon.ts` (new)

A `GObject.registerClass`'d `St.DrawingArea`, replacing `robotHead.ts`.

Per repaint: read the two colours, compute the snapped geometry once, then for
each of four blocks issue one `setSourceRGBA` and one rounded-rect `fill`. No
`save`/`restore`, no `translate`, no `scale`, no `rotate`, no `stroke`.

Everything the robot's widget got right is kept verbatim, because the review
traced each and found it correct:

- `setState` resets `phaseMs` only on a real state change, so `refresh()` firing
  on every store notification cannot retrigger the `done` stagger.
- `_schedule()` calls `_stopTimer()` first, so two timers cannot coexist; the
  self-removing branch zeroes `_timerId` *before* returning `SOURCE_REMOVE`, so
  a later release cannot double-remove a dropped source.
- `get_context()` is inside the `try`; `cr?.$dispose()` is in the `finally`; the
  `_broken` latch stops repainting after a failure so the journal cannot flood
  at tick rate.
- The timer is released from the widget's own `destroy` **signal**, not a
  `destroy()` method override, because `clutter_actor_destroy()` emits the
  signal and does not route through a JS override.

`setAnimateIdle()` is dropped from the public surface. `setState()` and
`setPaused()` are unchanged.

### 7. Island changes — `src/shell/island.ts`

Import and field rename only, plus the setting's removal:

- `RobotHead` → `GridIcon`, `_robot` → `_icon`.
- Delete `_animateIdleId`, its `changed::animate-idle` connect, its disconnect
  inside `_releaseExternalRefs()`, and the initial `setAnimateIdle(...)` call.

`pillState()`, `_applyPause()`, the `in-fullscreen-changed` gate, the
visibility gate, `_releaseExternalRefs()` and the `destroy`-signal release are
all untouched — the review verified each and none depends on what is drawn.

## Data flow

Unchanged from the robot branch except for the deleted setting:

```
store change -> Island.refresh()
                  -> pillState(sessions)   // unchanged
                  -> GridIcon.setState()   // resets phase on a real transition
                  -> tickIntervalMs()      // schedules or stops the timer
                  -> repaint -> gridPose() -> four cairo fills
```

plus the two pause gates, from `this.visible` and `in-fullscreen-changed`.

## Error handling

Unchanged in mechanism from the robot's widget, and simpler in surface: the
drawing has no branch that can leave a path unconsumed, no transform that can
be left unbalanced, and no arithmetic that can produce a degenerate radius —
`radius` is floored by `Math.min(r, block / 2)` as the rounded-rect helper
already does.

A missing `-dasbo-accent` falls back to the foreground colour. `gridPose` and
`tickIntervalMs` are total: `phaseMs` clamps at zero and every `SessionState`
has a branch.

## Testing

`src/shell` has no unit tests — GJS widgets are not constructible under vitest —
so the widget and stylesheet are verified by the compiler, the build, and a
manual pass. The pose model is unit-tested.

1. `test/core/grid.test.ts`, replacing `test/core/robot.test.ts`:
   - Each state's tick divides its period exactly, asserted as
     `period % tickIntervalMs(state, 0) === 0`. This is the guard that makes the
     robot's aliasing bug unrepresentable.
   - **Frame-sequence tests that walk the phases the widget actually visits**,
     stepping `p += tickIntervalMs(...)` rather than choosing arbitrary
     millisecond values. The robot's shake test asserted amplitude at
     `phaseMs = 60`, a phase the renderer never reached, and so passed against a
     feature that did not exist. Every animation assertion here walks the real
     sequence.
   - `running` yields 4 distinct frames per lap and the bright block advances
     clockwise: block index `k` is at 1.00 on frame `k`.
   - `idle` never yields two consecutive identical frames, and blocks 1–3 hold
     0.14 throughout.
   - `waiting` yields exactly 2 distinct frames and all four blocks always share
     one alpha.
   - `error` returns tick `0` at every phase, and its alphas are invariant.
   - `done` lights one more block per frame and holds all four after 300ms;
     `tickIntervalMs` returns `0` at 300ms and beyond.
   - Every alpha is within 0..1 for every state and phase.
   - Negative `phaseMs` yields the state's first frame.
2. `test/core/purity.test.ts` covers `grid.ts` for free — it walks `src/core`.
3. `npm test`, `npm run typecheck`, `npm run build` green.
4. `make install`, reload the shell, then with `tools/fake-agent.js`:
   - Confirm the grid reads as **four** blocks and not one square, at the real
     panel size — this is what the 1px gap floor exists for.
   - Confirm the running chase reads as a single travelling light, and that its
     direction is clockwise from top-left.
   - Confirm `waiting` reads as an all-together blink, distinct in rhythm from
     the chase.
   - Confirm `error` is a static diagonal and that the pill is genuinely still —
     `top` against `gnome-shell` must show no ongoing contribution.
   - Confirm `done` staggers in and holds, and does not replay on unrelated
     store updates.
   - Confirm both light and dark themes.
   - Confirm teardown is clean: no `Source ID … was not found` in the journal
     after disabling.

## Out of scope

- `src/shell/sessionRow.ts` and `.dasbo-dot`. The popup's per-session dots keep
  their current appearance and their colours, which is why the grid's accents
  reuse the same hexes.
- `src/core/pillState.ts`. The rule that a pending permission outranks an error
  is independent of what the pill draws.
- Reintroducing scale or translation for any state. Both were considered and
  dropped: alpha alone carries every state, and a transform is exactly the class
  of thing that measured badly on the robot.
- A counter-clockwise chase. The index order is fixed clockwise from top-left;
  reversing it is a one-line change if it ever reads better beside another
  spinner, but shipping one direction beats shipping a preference.
