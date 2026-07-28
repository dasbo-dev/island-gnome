# 2×2 Grid Pill Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the robot head in the top bar pill with four rounded squares whose silhouette never moves — only per-block alpha and fill colour change.

**Architecture:** `src/core/grid.ts` is a pure lookup table: `gridPose(state, phaseMs)` returns four alphas and a fill role, `tickIntervalMs(state, phaseMs)` returns the repaint interval. `src/shell/gridIcon.ts` snaps the geometry to device pixels and issues four `setSourceRGBA` + rounded-rect `fill` pairs per repaint — no transform, no stroke. `island.ts` swaps the widget and loses the `animate-idle` setting. `pillState.ts` and every gating and teardown mechanism are untouched.

**Tech Stack:** TypeScript, GNOME Shell 46 (GJS), St / Clutter / cairo via `gi://`, esbuild, vitest.

Spec: `docs/superpowers/specs/2026-07-28-grid-pill-icon-design.md`
Supersedes: `docs/superpowers/plans/2026-07-28-robot-pill-icon.md`

## Global Constraints

- GNOME Shell 46 only. `metadata.json` declares `"shell-version": ["46"]`.
- `src/core/**` must never import `gi://` or `resource://`. `test/core/purity.test.ts` walks the directory and fails the build otherwise.
- `src/shell/**` has no unit tests — GJS widgets are not constructible under vitest. Shell changes are verified by `npm run typecheck`, `npm run build`, and the manual pass in Task 4.
- Verification gates: `npm test`, `npm run typecheck`, `npm run build`. **All three must be green before any commit** — no task may leave the tree broken for a later one to fix.
- Colours are declared in `stylesheet.css`, never as literals in drawing code. Accent hexes are the same ones `.dasbo-dot` uses: waiting `#f5c211`, error `#e01b24`, done `#57e389`. Idle and running use the panel foreground and need no accent.
- `src/shell/sessionRow.ts` and the `.dasbo-dot` CSS rules are **out of scope** and must not change.
- `src/core/pillState.ts`'s **logic** is out of scope. Its doc comment names "the pill's robot head" and must be reworded in Task 3 so no stale reference survives — a comment-only edit, with the `RANK` table and every branch untouched.
- Every `GLib` timer and signal handler id must be released — timers via `GLib.Source.remove`, handlers via `disconnect`, and anything connected to an object that outlives the widget must additionally be released from the widget's own `destroy` **signal**.
- **Every animation assertion must walk the phases the widget actually visits** — step `p += tickIntervalMs(...)` rather than picking arbitrary millisecond values. The robot's shake test asserted amplitude at `phaseMs = 60`, a phase the renderer never reached, and so passed against a feature that did not exist.
- Do not change any gsettings/dconf values on this machine.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/core/grid.ts` | create | Pure pose + timing model. `GridPose`, `gridPose()`, `tickIntervalMs()`. |
| `test/core/grid.test.ts` | create | Unit tests, walking real phase sequences. |
| `src/shell/gridIcon.ts` | create | `St.DrawingArea`. Device-pixel snapping, four fills, one timer. |
| `stylesheet.css` | modify | `.dasbo-robot` block replaced by `.dasbo-grid`. `.dasbo-dot` untouched. |
| `src/shell/island.ts` | modify | Swap widget, drop the `animate-idle` plumbing. |
| `schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml` | modify | Remove the `animate-idle` key. |
| `src/prefs.ts` | modify | Remove the "Animate while idle" row. |
| `src/core/robot.ts` | **delete** | Superseded by `grid.ts`. |
| `test/core/robot.test.ts` | **delete** | Superseded by `grid.test.ts`. |
| `src/shell/robotHead.ts` | **delete** | Superseded by `gridIcon.ts`. |
| `README.md` | modify | Describe the grid; drop the `animate-idle` paragraph. |

Test count moves 237 → 249 (Task 1 adds 12) → 236 (Task 3 deletes robot's 13).

---

### Task 1: Pure grid model

Four alphas and a fill role per state. Every value is a table lookup or a
comparison — no sine, no easing curve, no interpolation.

**Files:**
- Create: `src/core/grid.ts`
- Create: `test/core/grid.test.ts`

**Interfaces:**
- Consumes: `SessionState` from `src/core/types.ts`.
- Produces: `GridPose` (interface), `gridPose(state: SessionState, phaseMs: number): GridPose`, `tickIntervalMs(state: SessionState, phaseMs: number): number`. Task 2's widget imports all three.

`src/core/robot.ts` stays in place for now — `island.ts` still imports it. Task 3
deletes it in the same commit that stops importing it.

- [ ] **Step 1: Write the failing tests**

Create `test/core/grid.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { gridPose, tickIntervalMs, type GridPose } from '../../src/core/grid.js'
import type { SessionState } from '../../src/core/types.js'

const STATES: SessionState[] = ['idle', 'running', 'waiting', 'error', 'done']

/**
 * The phases the widget actually visits. It advances by exactly the tick, so
 * asserting at arbitrary millisecond values would test frames that are never
 * rendered.
 */
function walk(state: SessionState, frames: number): GridPose[] {
  const out: GridPose[] = []
  let p = 0
  for (let i = 0; i < frames; i++) {
    const iv = tickIntervalMs(state, p)
    out.push(gridPose(state, p))
    if (iv === 0) break
    p += iv
  }
  return out
}

const key = (pose: GridPose): string => pose.alpha.join(',')

describe('tickIntervalMs', () => {
  it('divides each animated state period exactly, so the phase cannot drift', () => {
    expect(3200 % tickIntervalMs('idle', 0)).toBe(0)
    expect(800 % tickIntervalMs('running', 0)).toBe(0)
    expect(1300 % tickIntervalMs('waiting', 0)).toBe(0)
    expect(300 % tickIntervalMs('done', 0)).toBe(0)
  })

  it('never schedules a timer for the static error state', () => {
    for (const p of [0, 100, 5_000, 1_000_000]) {
      expect(tickIntervalMs('error', p)).toBe(0)
    }
  })

  it('stops the done one-shot once its window has elapsed', () => {
    expect(tickIntervalMs('done', 0)).toBe(100)
    expect(tickIntervalMs('done', 299)).toBe(100)
    expect(tickIntervalMs('done', 300)).toBe(0)
    expect(tickIntervalMs('done', 9_000)).toBe(0)
  })

  it('clamps a negative phase to the start of the state', () => {
    expect(tickIntervalMs('done', -1_000)).toBe(100)
  })
})

describe('gridPose', () => {
  it('travels one bright block clockwise, with a one-step trail', () => {
    const lap = walk('running', 4)
    expect(lap).toHaveLength(4)
    lap.forEach((pose, step) => {
      expect(pose.alpha[step]).toBe(1)
      expect(pose.alpha[(step + 3) % 4]).toBe(0.45)
      expect(pose.fill).toBe('base')
    })
    expect(new Set(lap.map(key)).size).toBe(4)
  })

  it('returns to its first frame after exactly one running lap', () => {
    expect(key(gridPose('running', 800))).toBe(key(gridPose('running', 0)))
  })

  it('never repaints two consecutive identical idle frames', () => {
    const cycle = walk('idle', 8)
    expect(cycle).toHaveLength(8)
    for (let i = 1; i < cycle.length; i++) {
      expect(key(cycle[i]!)).not.toBe(key(cycle[i - 1]!))
    }
    for (const pose of cycle) {
      expect(pose.alpha.slice(0, 3)).toEqual([0.14, 0.14, 0.14])
      expect(pose.alpha[3]).toBeGreaterThanOrEqual(0.45)
      expect(pose.alpha[3]).toBeLessThanOrEqual(1)
    }
    expect(cycle[4]!.alpha[3]).toBe(1)
  })

  it('blinks all four waiting blocks together and wastes no frame', () => {
    const cycle = walk('waiting', 2)
    expect(new Set(cycle.map(key)).size).toBe(2)
    for (const pose of cycle) {
      expect(new Set(pose.alpha).size).toBe(1)
      expect(pose.fill).toBe('accent')
    }
    expect(cycle[0]!.alpha[0]).toBe(1)
    expect(cycle[1]!.alpha[0]).toBe(0.16)
  })

  it('holds a static diagonal pair for error', () => {
    const a = gridPose('error', 0)
    expect(a.alpha).toEqual([1, 0.16, 1, 0.16])
    expect(a.fill).toBe('accent')
    expect(gridPose('error', 60_000).alpha).toEqual(a.alpha)
  })

  it('lights one more done block per frame, then holds all four', () => {
    const frames = walk('done', 8)
    expect(frames.map((f) => f.alpha.filter((a) => a === 1).length)).toEqual([1, 2, 3, 4])
    expect(gridPose('done', 5_000).alpha).toEqual([1, 1, 1, 1])
    expect(frames[0]!.fill).toBe('accent')
  })

  it('keeps every alpha within 0..1 for every state and phase', () => {
    for (const s of STATES) {
      for (let p = 0; p <= 4_000; p += 37) {
        for (const a of gridPose(s, p).alpha) {
          expect(a).toBeGreaterThanOrEqual(0)
          expect(a).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('treats a negative phase as the start of the state', () => {
    for (const s of STATES) {
      expect(gridPose(s, -500)).toEqual(gridPose(s, 0))
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/core/grid.test.ts`
Expected: FAIL — the module `../../src/core/grid.js` does not resolve.

- [ ] **Step 3: Write the implementation**

Create `src/core/grid.ts`:

```ts
import type { SessionState } from './types.js'

/**
 * One frame of the 2×2 grid. The silhouette never moves — alpha and fill are
 * the entire animation, which is why nothing here is a transform or a curve.
 */
export interface GridPose {
  /** Alpha per block in chase order: top-left, top-right, bottom-right, bottom-left. */
  alpha: [number, number, number, number]
  /** 'base' is the panel's foreground colour; 'accent' is the state colour from CSS. */
  fill: 'base' | 'accent'
}

const IDLE_PERIOD_MS = 3200
const IDLE_TICK_MS = 400
const RUN_PERIOD_MS = 800
const RUN_TICK_MS = 200
const WAIT_PERIOD_MS = 1300
const WAIT_TICK_MS = 650
const DONE_WINDOW_MS = 300
const DONE_TICK_MS = 100

const IDLE_STEPS = IDLE_PERIOD_MS / IDLE_TICK_MS
const RUN_STEPS = RUN_PERIOD_MS / RUN_TICK_MS

const IDLE_DIM = 0.14
const IDLE_LOW = 0.45
const RUN_TRAIL = 0.45
const RUN_DIM = 0.2
const WAIT_DIM = 0.16
const ERROR_DIM = 0.16
const DONE_DELAYS_MS = [0, 100, 200, 300] as const

/**
 * Milliseconds until the next repaint. Zero means stop the timer entirely.
 *
 * Every tick divides its period exactly — 3200/400, 800/200, 1300/650,
 * 300/100 — and the widget advances phase by exactly the tick. The sampled
 * sequence is therefore the definition of each animation rather than an
 * approximation of a continuous curve, which is what makes the aliasing that
 * erased the previous icon's shake unrepresentable here.
 *
 * The switch has no `default`. It is exhaustive over `SessionState`, and
 * `strictNullChecks` turns a future sixth state into a compile error (TS2366)
 * rather than a silent `undefined`.
 */
export function tickIntervalMs(state: SessionState, phaseMs: number): number {
  const p = Math.max(0, phaseMs)
  switch (state) {
    case 'idle':
      return IDLE_TICK_MS
    case 'running':
      return RUN_TICK_MS
    case 'waiting':
      return WAIT_TICK_MS
    case 'error':
      // The static diagonal pair is the whole signal; it needs no motion.
      return 0
    case 'done':
      return p < DONE_WINDOW_MS ? DONE_TICK_MS : 0
  }
}

/**
 * The grid's appearance at `phaseMs` into `state`. Pure: no clock, no random,
 * no I/O, so the shell can call it every repaint and the tests can call it at
 * any instant.
 */
export function gridPose(state: SessionState, phaseMs: number): GridPose {
  const p = Math.max(0, phaseMs)
  switch (state) {
    case 'idle': {
      // A triangle rather than a sine: the block passes through the same
      // brightness rising and falling, and no two consecutive frames repeat.
      const step = Math.floor(p / IDLE_TICK_MS) % IDLE_STEPS
      const t = step / IDLE_STEPS
      const tri = t < 0.5 ? 2 * t : 2 * (1 - t)
      const lit = IDLE_LOW + (1 - IDLE_LOW) * tri
      return { alpha: [IDLE_DIM, IDLE_DIM, IDLE_DIM, lit], fill: 'base' }
    }
    case 'running': {
      // One bright block travelling clockwise, the block behind it half-lit as
      // a trail. Four steps per lap, one per block.
      const step = Math.floor(p / RUN_TICK_MS) % RUN_STEPS
      const at = (i: number): number =>
        i === step ? 1 : i === (step + RUN_STEPS - 1) % RUN_STEPS ? RUN_TRAIL : RUN_DIM
      return { alpha: [at(0), at(1), at(2), at(3)], fill: 'base' }
    }
    case 'waiting': {
      // A hard cut, not a fade: all four blocks change together, so waiting
      // separates from running by rhythm even in a monochrome tray.
      const a = p % WAIT_PERIOD_MS < WAIT_PERIOD_MS / 2 ? 1 : WAIT_DIM
      return { alpha: [a, a, a, a], fill: 'accent' }
    }
    case 'error':
      return { alpha: [1, ERROR_DIM, 1, ERROR_DIM], fill: 'accent' }
    case 'done': {
      const at = (i: number): number => (p >= DONE_DELAYS_MS[i]! ? 1 : 0)
      return { alpha: [at(0), at(1), at(2), at(3)], fill: 'accent' }
    }
  }
}
```

The tuples are built by four explicit calls rather than `.map()` because
`.map()` returns `number[]`, which does not satisfy the fixed-length tuple type
without a cast.

**Why `DONE_WINDOW_MS` is 300 and not 400.** The widget advances the phase,
repaints, *then* asks whether to continue. A 400ms window would therefore render
a final frame at `p = 400` that is pixel-identical to the one at `p = 300`,
where the fourth block already lit — one wasted wakeup and repaint. Ending the
window at 300 stops the timer immediately after the last block appears.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/core/grid.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Verify the exhaustiveness guarantee is real**

Temporarily delete the `case 'done':` branch and its `return` from
`tickIntervalMs`, then run `npx tsc --noEmit -p tsconfig.json`.

Expected: `error TS2366: Function lacks ending return statement and return type does not include 'undefined'.`

Restore the branch and re-run. Expected: no output, exit 0. This step produces
no committed change — it confirms the comment in Step 3 is telling the truth.

- [ ] **Step 6: Run all three gates**

Run: `npm test && npm run typecheck && npm run build`
Expected: 249 tests (237 + 12), typecheck silent, `built dist/`.
`test/core/purity.test.ts` must still pass — `grid.ts` imports only `./types.js`.

- [ ] **Step 7: Commit**

```bash
git add src/core/grid.ts test/core/grid.test.ts
git commit -m "feat(core): add the grid's pose and timing model"
```

---

### Task 2: The grid widget

The only file that touches cairo. Four fills per repaint, no transform, no
stroke.

**Files:**
- Create: `src/shell/gridIcon.ts`
- Modify: `stylesheet.css` (replace the `.dasbo-robot` block)

**Interfaces:**
- Consumes: `gridPose`, `tickIntervalMs`, `GridPose` from `src/core/grid.js`; `SessionState` from `src/core/types.js`.
- Produces: `GridIcon`, a `GObject.registerClass`'d `St.DrawingArea` with `setState(state: SessionState): void` and `setPaused(paused: boolean): void`. Task 3 constructs it as `new GridIcon()` and types the field as `InstanceType<typeof GridIcon>`.

`src/shell/robotHead.ts` stays in place for now — `island.ts` still imports it.
Task 3 deletes it in the same commit that stops importing it. The two widgets
coexist for one commit; `GridIcon` is simply tree-shaken out of the bundle
until then.

- [ ] **Step 1: Replace the stylesheet block**

In `stylesheet.css`, replace the entire `.dasbo-robot` block — its comment, the
base rule, and all four `state-*` rules — with:

```css
/* The pill's 2×2 grid. Its silhouette never moves; only per-block alpha and
   the fill colour change, which is what keeps it legible at panel size.

   `-dasbo-accent` is a custom St theme property read by gridIcon.ts via
   lookup_color(). It is declared only for the three states that use it: idle
   and running are drawn in the panel's own foreground colour and separate by
   rhythm, not hue. The hexes match .dasbo-dot, so retuning a state's colour
   stays one edit for the pill and the popup rows alike.

   em, not px, so the icon tracks shell font scaling, and square because the
   grid uses its whole box. */
.dasbo-grid {
  width: 1.4em;
  height: 1.4em;
}

.dasbo-grid.state-waiting { -dasbo-accent: #f5c211; }
.dasbo-grid.state-error   { -dasbo-accent: #e01b24; }
.dasbo-grid.state-done    { -dasbo-accent: #57e389; }
```

Leave every other rule in the file alone, `.dasbo-dot` above all.

- [ ] **Step 2: Write the widget**

Create `src/shell/gridIcon.ts`:

```ts
import St from 'gi://St'
import Clutter from 'gi://Clutter'
import GObject from 'gi://GObject'
import GLib from 'gi://GLib'
import type cairo from 'cairo'
import type { SessionState } from '../core/types.js'
import { gridPose, tickIntervalMs, type GridPose } from '../core/grid.js'

/**
 * Deliberately a local copy of the same table in sessionRow.ts rather than a
 * shared import: the two carry different CSS properties (-dasbo-accent here,
 * background-color there) and are free to diverge.
 */
const STATE_CLASS: Record<SessionState, string> = {
  idle: '',
  running: 'state-running',
  waiting: 'state-waiting',
  error: 'state-error',
  done: 'state-done',
}

/** The design space from the spec: 2.4 + 9.4 + 0.8 + 9.4 + 2.4 = 24. */
const UNITS = 24
const BLOCK_U = 9.4
const GAP_U = 0.8
const RADIUS_U = 2.2

type Rgba = [number, number, number, number]

interface Metrics {
  block: number
  gap: number
  radius: number
}

/**
 * Snap the design space to device pixels.
 *
 * The gap is 0.53px at S=16 and 0.73px at S=22 — under a device pixel at every
 * realistic size. It is the only thing that makes four blocks read as four
 * rather than as one square, so it is floored at 1px even where that costs a
 * block a pixel of width.
 */
function metrics(s: number): Metrics {
  const u = s / UNITS
  return {
    block: Math.max(1, Math.round(BLOCK_U * u)),
    gap: Math.max(1, Math.round(GAP_U * u)),
    radius: Math.round(RADIUS_U * u),
  }
}

function rgba(c: Clutter.Color): Rgba {
  return [c.red / 255, c.green / 255, c.blue / 255, c.alpha / 255]
}

function roundedRect(
  cr: cairo.Context,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rr = Math.min(r, w / 2, h / 2)
  // At the smallest sizes the snapped radius rounds to zero; cairo's arc would
  // then degenerate, so fall back to a plain rectangle.
  if (rr <= 0) {
    cr.rectangle(x, y, w, h)
    return
  }
  cr.newSubPath()
  cr.arc(x + w - rr, y + rr, rr, -Math.PI / 2, 0)
  cr.arc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2)
  cr.arc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI)
  cr.arc(x + rr, y + rr, rr, Math.PI, 1.5 * Math.PI)
  cr.closePath()
}

export const GridIcon = GObject.registerClass(
  class GridIcon extends St.DrawingArea {
    private _state: SessionState = 'idle'
    private _phaseMs = 0
    private _paused = false
    private _broken = false
    private _timerId = 0

    constructor() {
      super({ style_class: 'dasbo-grid', y_align: Clutter.ActorAlign.CENTER })
      this.connect('repaint', () => this._onRepaint())
      // The 'destroy' signal, not a destroy() override: Clutter tears children
      // down through clutter_actor_destroy, which emits this signal and does
      // not necessarily route through a JS method override. Without it the
      // timer outlives the actor and fires against a disposed object.
      this.connect('destroy', () => this._stopTimer())
      this._schedule()
    }

    setState(state: SessionState): void {
      // Guarded because refresh() runs on every store notification. Resetting
      // the phase unconditionally would retrigger the done stagger on every
      // unrelated update.
      if (state === this._state) return
      this._state = state
      this._phaseMs = 0
      this.style_class = `dasbo-grid ${STATE_CLASS[state]}`.trim()
      this.queue_repaint()
      this._schedule()
    }

    setPaused(paused: boolean): void {
      if (paused === this._paused) return
      this._paused = paused
      if (paused) this._stopTimer()
      else this._schedule()
    }

    private _stopTimer(): void {
      if (!this._timerId) return
      GLib.Source.remove(this._timerId)
      this._timerId = 0
    }

    private _schedule(): void {
      this._stopTimer()
      if (this._paused || this._broken) return
      const interval = tickIntervalMs(this._state, this._phaseMs)
      if (interval === 0) return
      this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => {
        this._phaseMs += interval
        this.queue_repaint()
        // Zeroed before returning REMOVE so a later release cannot remove a
        // source GLib has already dropped.
        if (tickIntervalMs(this._state, this._phaseMs) === 0) {
          this._timerId = 0
          return GLib.SOURCE_REMOVE
        }
        return GLib.SOURCE_CONTINUE
      })
    }

    private _colors(): { base: Rgba; accent: Rgba } {
      const node = this.get_theme_node()
      const base = rgba(node.get_foreground_color())
      // lookup_color reports whether the property was found. A shell theme that
      // strips custom properties yields a monochrome icon rather than an
      // invisible one.
      const [found, accent] = node.lookup_color('-dasbo-accent', false)
      return { base, accent: found ? rgba(accent) : base }
    }

    private _onRepaint(): void {
      if (this._broken) return
      // Declared outside the try so the finally can see it, but assigned
      // inside: get_context() itself can throw, and the latch has to catch
      // that too or the journal floods at tick rate.
      let cr: cairo.Context | null = null
      try {
        cr = this.get_context()
        this._draw(cr)
      } catch (e) {
        this._broken = true
        this._stopTimer()
        console.warn(`dasbo-island: grid repaint failed, disabled: ${e}`)
      } finally {
        // Mandatory in GJS — the context leaks without it. Optional-chained
        // because get_context() returns null rather than throwing when the
        // surface is unset.
        cr?.$dispose()
      }
    }

    private _draw(cr: cairo.Context): void {
      const [w, h] = this.get_surface_size()
      if (w <= 0 || h <= 0) return
      const { block, gap, radius } = metrics(Math.min(w, h))
      const pose: GridPose = gridPose(this._state, this._phaseMs)
      const { base, accent } = this._colors()
      const [r, g, b, a] = pose.fill === 'accent' ? accent : base

      // Centred against width and height independently, so a surface that is
      // not square still puts the grid in the middle of it.
      const span = 2 * block + gap
      const left = Math.floor((w - span) / 2)
      const top = Math.floor((h - span) / 2)

      // Chase order: top-left, top-right, bottom-right, bottom-left. Every
      // staggered animation in grid.ts indexes blocks in this order.
      const near = block + gap
      const cells: [number, number][] = [
        [0, 0],
        [near, 0],
        [near, near],
        [0, near],
      ]

      for (let i = 0; i < cells.length; i++) {
        const [dx, dy] = cells[i]!
        cr.setSourceRGBA(r, g, b, a * pose.alpha[i]!)
        roundedRect(cr, left + dx, top + dy, block, block, radius)
        cr.fill()
      }
    }
  }
)
```

There is no `save`/`restore` pair because nothing modifies the transform matrix,
and no `setLineWidth` or `stroke` because every block is filled.

- [ ] **Step 3: Run all three gates**

Run: `npm test && npm run typecheck && npm run build`
Expected: 249 tests unchanged, typecheck silent, `built dist/`.

Run: `grep -c "dasbo-robot" stylesheet.css`
Expected: `0`.

`GridIcon` is not imported by anything yet, so esbuild tree-shakes it. That is
expected here; Task 3 pulls it in.

- [ ] **Step 4: Commit**

```bash
git add src/shell/gridIcon.ts stylesheet.css
git commit -m "feat(shell): draw the 2x2 grid"
```

---

### Task 3: Swap the widget and remove the setting

Points `island.ts` at `GridIcon`, deletes the `animate-idle` setting, and
removes the three superseded robot files — all in one commit, so the tree is
green before and after.

**Files:**
- Modify: `src/shell/island.ts`
- Modify: `schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml`
- Modify: `src/prefs.ts`
- Modify: `src/core/pillState.ts` (**doc comment only** — one phrase)
- Delete: `src/core/robot.ts`, `test/core/robot.test.ts`, `src/shell/robotHead.ts`

**Interfaces:**
- Consumes: `GridIcon` from `./gridIcon.js` (Task 2).
- Produces: nothing further; this is the last code task.

- [ ] **Step 1: Point the island at the grid**

In `src/shell/island.ts`:

- Change the import from `import { RobotHead } from './robotHead.js'` to
  `import { GridIcon } from './gridIcon.js'`.
- Change the field declaration to
  `private _icon!: InstanceType<typeof GridIcon>`.
- Change the construction to `this._icon = new GridIcon()` and the
  `box.add_child(this._robot)` call to `box.add_child(this._icon)`.
- Rename the two remaining `this._robot` uses — `this._robot.setState(state)` in
  `refresh()` and `this._robot.setPaused(...)` in `_applyPause()` — to
  `this._icon`.

- [ ] **Step 2: Delete the animate-idle plumbing from the island**

Still in `src/shell/island.ts`, remove all four sites (line numbers from HEAD;
locate each by its surrounding code rather than trusting the number):

- The field `private _animateIdleId = 0` (line 49).
- The connect and the initial call (lines 112-115):

```ts
      this._animateIdleId = this._settings.connect('changed::animate-idle', () => {
        this._robot.setAnimateIdle(this._settings.get_boolean('animate-idle'))
      })
      this._robot.setAnimateIdle(this._settings.get_boolean('animate-idle'))
```

- The disconnect inside `_releaseExternalRefs()` (lines 213-216):

```ts
      if (this._animateIdleId) {
        this._settings.disconnect(this._animateIdleId)
        this._animateIdleId = 0
      }
```

Leave `_settingsChangedId`, `_fullscreenId`, `_menuStateId`, the store
unsubscribe, the transient-id sweep and the `_stopTimer()` call in
`_releaseExternalRefs()` exactly as they are. Leave the method's comment, the
`destroy` signal connection, `_applyPause()`, `pillState()` and `STATE_WORD`
untouched.

- [ ] **Step 3: Remove the schema key**

In `schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml`, delete the
whole `animate-idle` key element:

```xml
    <key name="animate-idle" type="b">
      <default>false</default>
      <summary>Animate the robot while idle</summary>
      <description>Play the sleep animation while no agent is running. Costs a small amount of battery.</description>
    </key>
```

Leave every other key alone.

Removing a key while a value for it sits in the user's dconf leaves that value
orphaned. That is harmless — nothing reads it — and there is no migration to
write.

- [ ] **Step 4: Remove the preferences row**

In `src/prefs.ts`, delete the block added for the setting (lines 58-63):

```ts
    const animateIdle = new Adw.SwitchRow({
      title: 'Animate while idle',
      subtitle: 'Play the sleep animation while no agent is running. Costs a little battery.',
    })
    settings.bind('animate-idle', animateIdle, 'active', 0)
    group.add(animateIdle)
```

Leave the `alwaysShow` row above it and everything below it alone.

- [ ] **Step 5: Reword the three stale robot references in comments**

Deleting `robotHead.ts` strands three comments that name it or the robot. All
three are comment-only edits; no logic changes.

In `src/shell/island.ts`, inside `_releaseExternalRefs()`'s comment, the
cross-reference `(see robotHead.ts:79-83)` becomes `(see gridIcon.ts)` — drop
the line numbers, which will drift.

Also in `src/shell/island.ts`, `_applyPause()`'s comment opens "The robot
animates only when it can actually be seen." Change "The robot" to "The icon".

In `src/core/pillState.ts`, the `pillState` doc comment opens "Which state the
pill's robot head shows for the whole session set." Change "robot head" to
"icon". **Nothing else in that file may change** — not the `RANK` table, not a
branch, not the permission-outranks-error reasoning below it.

- [ ] **Step 6: Delete the superseded files**

```bash
git rm src/core/robot.ts test/core/robot.test.ts src/shell/robotHead.ts
```

- [ ] **Step 7: Verify nothing still references the robot**

Run: `grep -rn "robot\|Robot" src/ test/ stylesheet.css schemas/`
Expected: no matches.

Run: `grep -rn "animate-idle\|animateIdle" src/ schemas/`
Expected: no matches.

Run: `npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 8: Run all three gates and confirm the wiring took**

Run: `npm test && npm run build`
Expected: **236** tests (249 minus the 13 in `robot.test.ts`), `built dist/`.

Run: `glib-compile-schemas --dry-run schemas`
Expected: no output, exit 0.

Run: `grep -c "gi://cairo" dist/extension.js`
Expected: `1` — `GridIcon` is now reachable and no longer tree-shaken.

- [ ] **Step 9: Commit**

```bash
git add -A src/ test/ schemas/
git commit -m "feat(shell): put the 2x2 grid in the pill

The animate-idle setting goes with the robot: the grid's idle state
animates unconditionally. Removing the schema key leaves any existing
dconf value orphaned, which nothing reads."
```

---

### Task 4: Verify on a real shell

Everything above is verified by the compiler and the unit tests. Nothing has yet
confirmed the grid is *legible* — specifically, that it reads as four blocks
rather than one square, and that the four rhythms are distinguishable.

Per the standing arrangement on this project, the subagent does the machine-side
work and the user walks the visual checklist.

**Machine side (subagent):**

- [ ] **Step 1: Update the README**

The README currently describes the robot head and the `animate-idle` setting.
Replace that paragraph with one describing the grid. Keep it to the same
register as the surrounding prose — what the user sees, not how it is drawn:

```markdown
The pill shows a 2×2 grid that reflects the busiest session: a light travelling
clockwise while an agent works, all four blocks blinking together when a
permission needs your answer, a static diagonal pair on error, and a green
stagger when a session finishes.
```

Delete any remaining mention of **Animate while idle**.

- [ ] **Step 2: Install**

Run: `make install`

Do **not** reload the shell, do not run `gnome-extensions enable/disable`, and
do not disturb the running desktop session.

- [ ] **Step 3: Confirm the installed copy is current**

```bash
D=~/.local/share/gnome-shell/extensions/dasbo-island@ayubaswad.gmail.com
diff -q dist/extension.js "$D/extension.js"
diff -q stylesheet.css "$D/stylesheet.css"
grep -c "dasbo-grid" "$D/stylesheet.css"
gsettings --schemadir "$D/schemas" list-keys org.gnome.shell.extensions.dasbo-island
```
Expected: both `diff`s silent, the grep ≥ 1, and `animate-idle` **absent** from
the key list.

- [ ] **Step 4: Commit the README**

```bash
git add README.md
git commit -m "docs: describe the 2x2 grid"
```

**Visual side (user).** Reload the shell — `Alt+F2`, `r`, Enter on X11; log out
and back in on Wayland — then check:

- [ ] The icon reads as **four blocks, not one square**, at real panel size. This is what the 1px gap floor exists for and is the single most important check.
- [ ] `running` reads as one light travelling **clockwise from top-left**, with a visible trail.
- [ ] `waiting` reads as an all-together blink, clearly different in rhythm from the chase.
- [ ] `error` is a static diagonal pair, and the pill is genuinely still — confirm with `top -p "$(pgrep -f 'gnome-shell$' | head -1)"` that there is no ongoing contribution.
- [ ] `done` staggers in, holds, and does **not** replay when an unrelated session updates.
- [ ] `idle` breathes on the bottom-left block only; the other three stay dim.
- [ ] Legible on both light and dark shell themes.
- [ ] After `gnome-extensions disable`, `journalctl --user -b -o cat /usr/bin/gnome-shell | grep -i "dasbo\|Source ID"` shows no `Source ID … was not found` and no repaint warnings.

Report back what reads and what does not. `BLOCK_U`, `GAP_U` and `RADIUS_U` in
`gridIcon.ts` and the alpha constants in `grid.ts` are the tuning knobs; the
alpha values are the cheaper thing to change and should be tried first.

---

## Verification Summary

| Concern | How it is verified | Where |
|---|---|---|
| Tick divides period; no phase drift | Unit test | Task 1 |
| Frames the widget actually renders are distinct | Unit tests walking real phase sequences | Task 1 |
| `error` never schedules a timer | Unit test | Task 1 |
| `done` stops after its last block lights | Unit test | Task 1 |
| A sixth session state cannot ship unhandled | `tsc` TS2366 | Task 1 Step 5 |
| `src/core` stays free of `gi://` | `test/core/purity.test.ts` | Task 1 |
| Widget compiles, bundles, and is reachable | `typecheck`, `build`, `grep gi://cairo` | Tasks 2, 3 |
| No robot or `animate-idle` reference survives | `grep` | Task 3 Step 7 |
| Schema still valid without the key | `glib-compile-schemas --dry-run` | Task 3 Step 8 |
| Reads as four blocks; rhythms distinguishable | Manual | Task 4 |
| Timer genuinely stops on `error` | `top` against `gnome-shell` | Task 4 |
| No leaked timers or handlers | `journalctl` after disable | Task 4 |
