# Animated Robot Head in the Pill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the pill's colour-coded dot with a cairo-drawn robot head that expresses all five session states through its eyes, mouth and antenna.

**Architecture:** Two pure modules in `src/core` hold everything testable — `robot.ts` maps `(state, phaseMs, animateIdle)` to a pose and a repaint interval, and `pillState.ts` decides which session state the pill shows. One new `St.DrawingArea` subclass in `src/shell/robotHead.ts` draws that pose with cairo and owns a single `GLib` timer that genuinely stops for static states. `island.ts` swaps its dot for the head and loses its bespoke pulse animation.

**Tech Stack:** TypeScript, GNOME Shell 46 (GJS), St / Clutter / cairo via `gi://`, esbuild, vitest.

Spec: `docs/superpowers/specs/2026-07-28-robot-pill-icon-design.md`

## Global Constraints

- GNOME Shell 46 only. `metadata.json` declares `"shell-version": ["46"]`.
- `src/core/**` must never import `gi://` or `resource://`. `test/core/purity.test.ts` walks the directory and fails the build otherwise.
- `src/shell/**` has no unit tests — GJS widgets are not constructible under vitest. Shell changes are verified by `npm run typecheck`, `npm run build`, and the manual pass in Task 7.
- Colours are declared in `stylesheet.css`, never as literals in drawing code. State colours are the same hexes `.dasbo-dot` already uses: idle `#9e9e9e`, running `#62a0ea`, waiting `#f5c211`, error `#e01b24`, done `#57e389`.
- `src/shell/sessionRow.ts` and the `.dasbo-dot` CSS rules are **out of scope** and must not change. Per-session dots in the popup keep their current appearance.
- Every `GLib` timer and every signal handler id must be released — timers via `GLib.Source.remove`, handlers via `disconnect`. This codebase already does this everywhere; a leak here fires against a disposed actor.
- Verification commands: `npm test`, `npm run typecheck`, `npm run build`. All three must be green before any commit.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/core/robot.ts` | create | Pure pose + timing model. `RobotPose`, `robotPose()`, `tickIntervalMs()`. |
| `test/core/robot.test.ts` | create | Unit tests for the above. |
| `src/core/pillState.ts` | create | Pure rule for which state the pill shows across all sessions. |
| `test/core/pillState.test.ts` | create | Unit tests for the above. |
| `src/core/store.ts` | modify (Task 6) | Delete `RANK` and `worstState()` once `island.ts` stops calling them. |
| `test/core/store.test.ts` | modify (Task 6) | Delete the `worstState` test, now covered by `pillState.test.ts`. |
| `src/shell/robotHead.ts` | create | `St.DrawingArea` subclass. Cairo drawing, one timer, theme colours. |
| `stylesheet.css` | modify | Add `.dasbo-robot` sizing and `-dasbo-accent` per state. `.dasbo-dot` untouched. |
| `schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml` | modify | Add the `animate-idle` key. |
| `src/prefs.ts` | modify | Add the "Animate while idle" switch row. |
| `src/shell/island.ts` | modify | Swap dot for head, delete the pulse, use `pillState`, gate the tick. |

---

### Task 1: Pure timing model

The repaint schedule, isolated from any geometry. `tickIntervalMs` returning `0`
is what makes a static state cost nothing: the widget releases its timer rather
than repainting an unchanging pose forever.

**Files:**
- Create: `src/core/robot.ts`
- Create: `test/core/robot.test.ts`

**Interfaces:**
- Consumes: `SessionState` from `src/core/types.ts`.
- Produces: `RobotPose` (interface), `tickIntervalMs(state: SessionState, phaseMs: number, animateIdle: boolean): number`. Task 2 adds `robotPose` to the same file; Task 4 imports all three.

- [ ] **Step 1: Write the failing test**

Create `test/core/robot.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { tickIntervalMs } from '../../src/core/robot.js'

describe('tickIntervalMs', () => {
  it('never starts a timer for an idle robot unless idle animation is on', () => {
    expect(tickIntervalMs('idle', 0, false)).toBe(0)
    expect(tickIntervalMs('idle', 10_000, false)).toBe(0)
    expect(tickIntervalMs('idle', 0, true)).toBe(333)
  })

  it('runs continuously while an agent works or waits', () => {
    expect(tickIntervalMs('running', 0, false)).toBe(166)
    expect(tickIntervalMs('running', 99_999, false)).toBe(166)
    expect(tickIntervalMs('waiting', 0, false)).toBe(500)
    expect(tickIntervalMs('waiting', 99_999, false)).toBe(500)
  })

  it('stops the one-shots once their window has elapsed', () => {
    expect(tickIntervalMs('error', 0, false)).toBe(166)
    expect(tickIntervalMs('error', 499, false)).toBe(166)
    expect(tickIntervalMs('error', 500, false)).toBe(0)
    expect(tickIntervalMs('done', 299, false)).toBe(166)
    expect(tickIntervalMs('done', 300, false)).toBe(0)
  })

  it('clamps a negative phase to the start of the state', () => {
    expect(tickIntervalMs('error', -1000, false)).toBe(166)
    expect(tickIntervalMs('done', -1, false)).toBe(166)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/core/robot.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/robot.js"`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/core/robot.ts`:

```ts
import type { SessionState } from './types.js'

/**
 * Everything the drawing code needs for one frame, in unit terms: fractions,
 * ratios and radians, never pixels. `src/shell/robotHead.ts` scales these by
 * the widget's size, so this file stays free of any rendering assumption.
 */
export interface RobotPose {
  /** Lid aperture, 0..1. Zero draws a closed stroke instead of a filled eye. */
  eyeOpen: number
  /** Gaze offset, -1..1, scaled by the widget's eye travel. */
  eyeX: number
  eyeY: number
  eyeShape: 'round' | 'cross' | 'arc'
  mouth: 'none' | 'flat' | 'smile'
  /** Accent alpha on the antenna tip, 0..1. */
  antennaLit: number
  headTilt: number
  /** -1..1 of the shake's full amplitude, which the drawing code scales. */
  headShakeX: number
  /** Rise progress 0..1 per sleep glyph. Empty unless the robot is asleep. */
  zzz: number[]
  /** 1.0 at rest; the done one-shot pops above it. */
  scale: number
}

const IDLE_CYCLE_MS = 3000
const RUN_CYCLE_MS = 1400
const WAIT_BLINK_MS = 1000
const ERROR_SHAKE_MS = 500
const DONE_POP_MS = 300

const TICK_RUNNING = 166
const TICK_WAITING = 500
const TICK_IDLE = 333
const TICK_ONESHOT = 166

/**
 * Milliseconds until the next repaint. Zero means stop the timer entirely —
 * the pose is static and repainting it again would burn a compositor wakeup
 * for an identical frame. That is the whole battery argument for this design,
 * so the zero cases are load-bearing, not an optimisation.
 *
 * `phaseMs` is a parameter because the one-shots genuinely finish: past its
 * window each returns zero and the caller releases its source.
 *
 * The switch has no `default`. It is exhaustive over `SessionState`, and
 * `strictNullChecks` turns a future sixth state into a compile error (TS2366,
 * "function lacks ending return statement") rather than a silent `undefined`.
 */
export function tickIntervalMs(
  state: SessionState,
  phaseMs: number,
  animateIdle: boolean
): number {
  const p = Math.max(0, phaseMs)
  switch (state) {
    case 'idle':
      return animateIdle ? TICK_IDLE : 0
    case 'running':
      return TICK_RUNNING
    case 'waiting':
      return TICK_WAITING
    case 'error':
      return p < ERROR_SHAKE_MS ? TICK_ONESHOT : 0
    case 'done':
      return p < DONE_POP_MS ? TICK_ONESHOT : 0
  }
}
```

The cycle constants are unused until Task 2. Leave them in place; that task
consumes every one of them.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/core/robot.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Verify the exhaustiveness guarantee is real**

Temporarily delete the `case 'done':` branch and its `return`, then run:

`npx tsc --noEmit -p tsconfig.json`

Expected: `src/core/robot.ts(…): error TS2366: Function lacks ending return statement and return type does not include 'undefined'.`

Restore the branch and re-run the same command. Expected: no output, exit 0.
This step produces no committed change — it confirms the comment in Step 3 is
telling the truth.

- [ ] **Step 6: Run the full suite**

Run: `npm test && npm run typecheck`
Expected: all test files pass, typecheck silent. `test/core/purity.test.ts` must
still pass — `robot.ts` imports only `./types.js`, no `gi://`.

- [ ] **Step 7: Commit**

```bash
git add src/core/robot.ts test/core/robot.test.ts
git commit -m "feat(core): add the robot's repaint schedule"
```

---

### Task 2: Pure pose model

Geometry as a function of state and elapsed phase. No clock is read here — the
caller passes `phaseMs`, the same discipline `AgentEvent` applies to `ts`.

**Files:**
- Modify: `src/core/robot.ts` (append to the file from Task 1)
- Modify: `test/core/robot.test.ts` (append a second `describe` block)

**Interfaces:**
- Consumes: `RobotPose` and the cycle constants from Task 1.
- Produces: `robotPose(state: SessionState, phaseMs: number, animateIdle: boolean): RobotPose`. Task 4 calls this once per repaint.

- [ ] **Step 1: Write the failing test**

Append to `test/core/robot.test.ts`, and extend the existing import line to
`import { robotPose, tickIntervalMs } from '../../src/core/robot.js'`, adding
`import type { SessionState } from '../../src/core/types.js'`:

```ts
const STATES: SessionState[] = ['idle', 'running', 'waiting', 'error', 'done']

describe('robotPose', () => {
  it('holds the idle pose still when idle animation is off', () => {
    const a = robotPose('idle', 0, false)
    const b = robotPose('idle', 7_777, false)
    expect(b).toEqual(a)
    expect(a.zzz).toEqual([0, 1 / 3, 2 / 3])
    expect(a.eyeOpen).toBe(0)
    expect(a.mouth).toBe('none')
  })

  it('drifts the sleep glyphs when idle animation is on', () => {
    expect(robotPose('idle', 1_000, true).zzz).not.toEqual(
      robotPose('idle', 0, true).zzz
    )
  })

  it('keeps the running gaze inside its travel range and continuous at the wrap', () => {
    for (let ms = 0; ms <= 2_800; ms += 50) {
      const { eyeX } = robotPose('running', ms, false)
      expect(eyeX).toBeGreaterThanOrEqual(-1)
      expect(eyeX).toBeLessThanOrEqual(1)
    }
    expect(robotPose('running', 1_400, false).eyeX).toBeCloseTo(
      robotPose('running', 0, false).eyeX,
      6
    )
  })

  it('blinks the waiting antenna and tilts the head', () => {
    expect(robotPose('waiting', 0, false).antennaLit).toBe(1)
    expect(robotPose('waiting', 600, false).antennaLit).toBeLessThan(0.5)
    expect(robotPose('waiting', 0, false).headTilt).toBeGreaterThan(0)
  })

  it('damps the error shake to nothing by the end of its window', () => {
    expect(Math.abs(robotPose('error', 60, false).headShakeX)).toBeGreaterThan(0.3)
    expect(robotPose('error', 500, false).headShakeX).toBeCloseTo(0, 6)
    expect(robotPose('error', 9_000, false).headShakeX).toBeCloseTo(0, 6)
    expect(robotPose('error', 0, false).eyeShape).toBe('cross')
  })

  it('pops the done head once and settles back to its rest scale', () => {
    expect(robotPose('done', 0, false).scale).toBeCloseTo(1, 6)
    expect(robotPose('done', 150, false).scale).toBeCloseTo(1.18, 6)
    expect(robotPose('done', 300, false).scale).toBeCloseTo(1, 6)
    expect(robotPose('done', 5_000, false).scale).toBeCloseTo(1, 6)
    expect(robotPose('done', 0, false).mouth).toBe('smile')
  })

  it('gives every session state a pose within range', () => {
    for (const s of STATES) {
      const pose = robotPose(s, 123, false)
      expect(pose.scale).toBeGreaterThan(0)
      expect(pose.antennaLit).toBeGreaterThanOrEqual(0)
      expect(pose.antennaLit).toBeLessThanOrEqual(1)
      expect(pose.eyeOpen).toBeGreaterThanOrEqual(0)
      expect(pose.eyeOpen).toBeLessThanOrEqual(1)
    }
  })

  it('treats a negative phase as the start of the state', () => {
    for (const s of STATES) {
      expect(robotPose(s, -500, true)).toEqual(robotPose(s, 0, true))
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/core/robot.test.ts`
Expected: FAIL — `robotPose is not a function` (the module has no such export).

- [ ] **Step 3: Write the minimal implementation**

Append to `src/core/robot.ts`:

```ts
const WAIT_TILT_RAD = 0.14

/** The neutral pose. Every state spreads this and overrides what it changes. */
const REST: RobotPose = {
  eyeOpen: 1,
  eyeX: 0,
  eyeY: 0,
  eyeShape: 'round',
  mouth: 'flat',
  antennaLit: 0.35,
  headTilt: 0,
  headShakeX: 0,
  zzz: [],
  scale: 1,
}

/** 0..1 sawtooth over one cycle. */
function cyclePhase(phaseMs: number, cycleMs: number): number {
  return (Math.max(0, phaseMs) % cycleMs) / cycleMs
}

/**
 * -1..1, and continuous across the cycle wrap. A sine rather than a triangle
 * because the ease at each extreme is what makes the gaze read as looking
 * rather than sliding.
 */
function oscillate(t: number): number {
  return Math.sin(t * 2 * Math.PI)
}

/**
 * The robot's appearance at `phaseMs` into `state`. Pure: no clock, no random,
 * no I/O — so the shell can call it every repaint and the tests can call it at
 * any instant they like.
 *
 * Exhaustive over `SessionState` for the same reason `tickIntervalMs` is.
 */
export function robotPose(
  state: SessionState,
  phaseMs: number,
  animateIdle: boolean
): RobotPose {
  const p = Math.max(0, phaseMs)
  switch (state) {
    case 'idle': {
      // With animation off the phase is pinned at zero, which still yields
      // three glyphs at fixed heights — a static sleep pose, not a bare head.
      const t = animateIdle ? cyclePhase(p, IDLE_CYCLE_MS) : 0
      return {
        ...REST,
        eyeOpen: 0,
        mouth: 'none',
        zzz: [0, 1, 2].map((i) => (t + i / 3) % 1),
      }
    }
    case 'running': {
      const t = cyclePhase(p, RUN_CYCLE_MS)
      return {
        ...REST,
        eyeX: oscillate(t),
        antennaLit: 0.6 + 0.4 * (0.5 + 0.5 * oscillate(t)),
      }
    }
    case 'waiting': {
      const t = cyclePhase(p, WAIT_BLINK_MS)
      return {
        ...REST,
        headTilt: WAIT_TILT_RAD,
        antennaLit: t < 0.5 ? 1 : 0.15,
      }
    }
    case 'error': {
      // Three oscillations damped linearly to zero, so the head settles rather
      // than stopping mid-swing when the timer is released.
      const t = p >= ERROR_SHAKE_MS ? 1 : p / ERROR_SHAKE_MS
      return {
        ...REST,
        eyeShape: 'cross',
        headShakeX: Math.sin(t * 3 * 2 * Math.PI) * (1 - t),
      }
    }
    case 'done': {
      // One half-sine hump: 1.0 at both ends, 1.18 at the middle.
      const t = p >= DONE_POP_MS ? 1 : p / DONE_POP_MS
      return {
        ...REST,
        eyeShape: 'arc',
        mouth: 'smile',
        antennaLit: 1,
        scale: 1 + 0.18 * Math.sin(t * Math.PI),
      }
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/core/robot.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test && npm run typecheck`
Expected: all green, purity test still passing.

- [ ] **Step 6: Commit**

```bash
git add src/core/robot.ts test/core/robot.test.ts
git commit -m "feat(core): add the robot's pose model"
```

---

### Task 3: The pill's state rule

The head has one pose slot where the dot had a colour *and* a separate pulse
channel. That forces the rule the spec calls out: a pending permission wins the
pill outright. Extracting it into `src/core/pillState.ts` makes it testable,
and absorbs the `allDone` special case currently inlined in `island.ts`.

`store.worstState()` has exactly one production caller (`island.ts:310`), which
this eventually replaces. `pillState` gets its own copy of the ranking now;
Task 6 deletes the store's once nothing calls it, so no commit in between is
left broken or carrying dead code.

**Files:**
- Create: `src/core/pillState.ts`
- Create: `test/core/pillState.test.ts`

`store.worstState()` is **not** touched here. `island.ts` still calls it until
Task 6, and deleting it now would leave the tree failing typecheck between two
commits. Task 6 removes it in the same commit that stops calling it.

**Interfaces:**
- Consumes: `Session`, `SessionState` from `src/core/types.ts`.
- Produces: `pillState(sessions: Session[]): SessionState`. Task 6 calls it from `Island.refresh()`.

- [ ] **Step 1: Write the failing test**

Create `test/core/pillState.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { pillState } from '../../src/core/pillState.js'
import type { Session, SessionState } from '../../src/core/types.js'

function sess(state: SessionState, over: Partial<Session> = {}): Session {
  return {
    key: `claude:${state}`,
    agent: 'claude',
    sessionId: state,
    project: 'dasbo-island',
    cwd: '/home/me/projects/dasbo-island',
    state,
    pid: 4242,
    startedAt: 0,
    lastEventAt: 0,
    ...over,
  }
}

const pending = { id: 'p1', tool: 'Bash', deadline: 0, queued: 0 }

describe('pillState', () => {
  it('is idle with no sessions', () => {
    expect(pillState([])).toBe('idle')
  })

  it('ranks error above running above idle', () => {
    expect(pillState([sess('idle'), sess('running')])).toBe('running')
    expect(pillState([sess('running'), sess('error')])).toBe('error')
    expect(pillState([sess('idle')])).toBe('idle')
  })

  it('reports done only when every session is done', () => {
    expect(pillState([sess('done'), sess('done')])).toBe('done')
    expect(pillState([sess('done'), sess('running')])).toBe('running')
  })

  it('lets a pending permission outrank an errored session', () => {
    const waiting = sess('waiting', {
      key: 'claude:w',
      sessionId: 'w',
      pendingPermission: pending,
    })
    expect(pillState([sess('error'), waiting])).toBe('waiting')
  })

  it('lets a pending permission outrank an all-done set', () => {
    const waiting = sess('done', {
      key: 'claude:w',
      sessionId: 'w',
      pendingPermission: pending,
    })
    expect(pillState([sess('done'), waiting])).toBe('waiting')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/core/pillState.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/pillState.js"`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/core/pillState.ts`:

```ts
import type { Session, SessionState } from './types.js'

/**
 * Ranked so a finished session can never mask a live one when both are
 * present. Duplicates `store.ts`'s table for one task only — Task 6 deletes
 * that one along with `worstState()`, its sole consumer.
 */
const RANK: Record<SessionState, number> = {
  done: 0,
  idle: 1,
  running: 2,
  waiting: 3,
  error: 4,
}

/**
 * Which state the pill's robot head shows for the whole session set.
 *
 * A pending permission wins outright, ahead of `error`. The head has one pose
 * slot, and a permission is the only state that blocks an agent on the user —
 * an error is informational, and the popup still reports it per session. This
 * replaces the workaround in `Island._rebuildRows`, which drove the old pulse
 * off the live-controls count precisely because `RANK` puts `error` above
 * `waiting`.
 *
 * `allDone` is special-cased for the opposite reason: `RANK` deliberately
 * ranks `done` lowest, which would otherwise report `idle` for a set where
 * every session finished — directly contradicting the rows, which read `done`.
 */
export function pillState(sessions: Session[]): SessionState {
  if (sessions.length === 0) return 'idle'
  if (sessions.some((s) => s.pendingPermission)) return 'waiting'
  if (sessions.every((s) => s.state === 'done')) return 'done'

  let worst: SessionState = 'idle'
  for (const s of sessions) {
    if (RANK[s.state] > RANK[worst]) worst = s.state
  }
  return worst
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/core/pillState.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test && npm run typecheck && npm run build`
Expected: all green, no output from typecheck, `built dist/`. Nothing outside
`src/core` changed, so the shell still compiles.

- [ ] **Step 6: Commit**

```bash
git add src/core/pillState.ts test/core/pillState.test.ts
git commit -m "feat(core): add the pill's state rule

A pending permission outranks an errored session. Not yet wired into
island.ts, which still uses store.worstState()."
```

---

### Task 4: The robot head widget

The only file that touches cairo. It draws one pose per repaint and owns one
timer.

**Files:**
- Create: `src/shell/robotHead.ts`
- Modify: `stylesheet.css` (append; `.dasbo-dot` rules unchanged)

**Interfaces:**
- Consumes: `robotPose`, `tickIntervalMs`, `RobotPose` from `src/core/robot.js`; `SessionState` from `src/core/types.js`.
- Produces: `RobotHead`, a `GObject.registerClass`'d `St.DrawingArea` with `setState(state: SessionState): void`, `setAnimateIdle(value: boolean): void`, `setPaused(paused: boolean): void`. Task 6 constructs it as `new RobotHead()` and types the field as `InstanceType<typeof RobotHead>`.

**Geometry note.** All drawing constants are fractions of `S = min(width,
height)`. Two invariants hold at the values below and must hold after any
tuning in Task 7:

- Eyes stay inside the head outline: `EYE_DX + EYE_TRAVEL + EYE_R <= HEAD_W/2 - STROKE` → `0.213 <= 0.217`.
- The `done` pop stays inside the widget: `(HEAD_H/2 + ANTENNA_LEN + ANTENNA_TIP_R + STROKE/2) * 1.18 - HEAD_CY <= 0.5` → `0.495 <= 0.5`.

At the `1.4em` box (~20px on a default shell) that yields an 11.6 × 9.9px head,
a 1.4px stroke, 1.3px eye dots and 0.7px of gaze travel.

- [ ] **Step 1: Add the stylesheet rules**

Append to `stylesheet.css`:

```css
/* The pill's robot head. `-dasbo-accent` is a custom St theme property read by
   robotHead.ts via lookup_color(); the head's shell is drawn in the panel's
   own foreground colour, so it follows light and dark themes without a rule
   here. The hexes are the same ones .dasbo-dot uses, so retuning a state's
   colour stays one edit for the pill and the popup rows alike.

   em, not px, so the head tracks shell font scaling — the same reasoning as
   .dasbo-pill-label's width. */
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

- [ ] **Step 2: Write the widget**

Create `src/shell/robotHead.ts`:

```ts
import St from 'gi://St'
import Cairo from 'gi://cairo'
import Clutter from 'gi://Clutter'
import GObject from 'gi://GObject'
import GLib from 'gi://GLib'
import type cairo from 'cairo'
import type { SessionState } from '../core/types.js'
import { robotPose, tickIntervalMs, type RobotPose } from '../core/robot.js'

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

// Fractions of S = min(width, height). See the plan's geometry note for the
// two invariants these satisfy; both are tight, so tune in pairs.
const HEAD_W = 0.578
const HEAD_H = 0.493
const HEAD_R = 0.11
const HEAD_CY = 0.06
const STROKE = 0.072
const ANTENNA_LEN = 0.128
const ANTENNA_TIP_R = 0.06
const EYE_DX = 0.115
const EYE_R = 0.064
const EYE_CY = -0.026
const EYE_TRAVEL = 0.034
const MOUTH_W = 0.17
const MOUTH_CY = 0.136
const SHAKE = 0.045
const ZZZ_X = 0.3
const ZZZ_Y0 = -0.16
const ZZZ_RISE = 0.26
const ZZZ_SIZE = 0.095

type Rgba = [number, number, number, number]

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
  cr.newSubPath()
  cr.arc(x + w - rr, y + rr, rr, -Math.PI / 2, 0)
  cr.arc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2)
  cr.arc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI)
  cr.arc(x + rr, y + rr, rr, Math.PI, 1.5 * Math.PI)
  cr.closePath()
}

export const RobotHead = GObject.registerClass(
  class RobotHead extends St.DrawingArea {
    private _state: SessionState = 'idle'
    private _phaseMs = 0
    private _animateIdle = false
    private _paused = false
    private _broken = false
    private _timerId = 0

    constructor() {
      super({ style_class: 'dasbo-robot', y_align: Clutter.ActorAlign.CENTER })
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
      // the phase unconditionally would retrigger the error shake and the done
      // pop on every unrelated update.
      if (state === this._state) return
      this._state = state
      this._phaseMs = 0
      this.style_class = `dasbo-robot ${STATE_CLASS[state]}`.trim()
      this.queue_repaint()
      this._schedule()
    }

    setAnimateIdle(value: boolean): void {
      if (value === this._animateIdle) return
      this._animateIdle = value
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
      const interval = tickIntervalMs(this._state, this._phaseMs, this._animateIdle)
      if (interval === 0) return
      this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => {
        this._phaseMs += interval
        this.queue_repaint()
        // Zeroed before returning REMOVE so _stopTimer cannot later remove a
        // source GLib has already dropped.
        if (tickIntervalMs(this._state, this._phaseMs, this._animateIdle) === 0) {
          this._timerId = 0
          return GLib.SOURCE_REMOVE
        }
        return GLib.SOURCE_CONTINUE
      })
    }

    private _colors(): { fg: Rgba; accent: Rgba } {
      const node = this.get_theme_node()
      const fg = rgba(node.get_foreground_color())
      // lookup_color reports whether the property was found. A shell theme
      // that strips custom properties yields a monochrome head rather than an
      // invisible one.
      const [found, accent] = node.lookup_color('-dasbo-accent', false)
      return { fg, accent: found ? rgba(accent) : fg }
    }

    private _onRepaint(): void {
      if (this._broken) return
      const cr = this.get_context()
      try {
        this._draw(cr)
      } catch (e) {
        // Latched, not merely logged: an exception escaping a repaint handler
        // would otherwise reprint at tick rate, several lines a second, and
        // flood the journal.
        this._broken = true
        this._stopTimer()
        console.warn(`dasbo-island: robot repaint failed, disabled: ${e}`)
      } finally {
        // Mandatory in GJS — the context leaks without it, and this runs
        // several times a second.
        cr.$dispose()
      }
    }

    private _draw(cr: cairo.Context): void {
      const [w, h] = this.get_surface_size()
      if (w <= 0 || h <= 0) return
      const s = Math.min(w, h)
      const u = (v: number): number => v * s
      const cx = w / 2
      const cy = h / 2
      const pose: RobotPose = robotPose(this._state, this._phaseMs, this._animateIdle)
      const { fg, accent } = this._colors()

      cr.setLineCap(Cairo.LineCap.ROUND)
      cr.setLineJoin(Cairo.LineJoin.ROUND)

      // Sleep glyphs are drawn in widget space, outside the head's transform,
      // so a tilt or a pop cannot drag them around.
      for (const t of pose.zzz) {
        const size = u(ZZZ_SIZE) * (0.6 + 0.4 * t)
        const x = cx + u(ZZZ_X)
        const y = cy + u(HEAD_CY) + u(ZZZ_Y0) - u(ZZZ_RISE) * t
        cr.setSourceRGBA(fg[0], fg[1], fg[2], fg[3] * (1 - t) * 0.9)
        cr.setLineWidth(Math.max(1, u(STROKE) * 0.6))
        cr.moveTo(x - size / 2, y - size / 2)
        cr.lineTo(x + size / 2, y - size / 2)
        cr.lineTo(x - size / 2, y + size / 2)
        cr.lineTo(x + size / 2, y + size / 2)
        cr.stroke()
      }

      cr.save()
      cr.translate(cx + pose.headShakeX * u(SHAKE), cy + u(HEAD_CY))
      cr.scale(pose.scale, pose.scale)
      cr.rotate(pose.headTilt)
      cr.setLineWidth(u(STROKE))

      const topY = -u(HEAD_H) / 2
      const tipY = topY - u(ANTENNA_LEN)
      cr.setSourceRGBA(fg[0], fg[1], fg[2], fg[3])
      cr.moveTo(0, topY)
      cr.lineTo(0, tipY)
      cr.stroke()
      cr.setSourceRGBA(accent[0], accent[1], accent[2], accent[3] * pose.antennaLit)
      cr.arc(0, tipY, u(ANTENNA_TIP_R), 0, 2 * Math.PI)
      cr.fill()

      cr.setSourceRGBA(fg[0], fg[1], fg[2], fg[3])
      roundedRect(cr, -u(HEAD_W) / 2, topY, u(HEAD_W), u(HEAD_H), u(HEAD_R))
      cr.stroke()

      // At this size the eye dot is the pupil: a sclera with a pupil inside it
      // would be sub-pixel, so the whole dot travels instead.
      const ey = u(EYE_CY) + pose.eyeY * u(EYE_TRAVEL)
      cr.setSourceRGBA(accent[0], accent[1], accent[2], accent[3])
      for (const sign of [-1, 1]) {
        const ex = sign * u(EYE_DX) + pose.eyeX * u(EYE_TRAVEL)
        const r = u(EYE_R)
        if (pose.eyeShape === 'cross') {
          cr.moveTo(ex - r, ey - r)
          cr.lineTo(ex + r, ey + r)
          cr.moveTo(ex + r, ey - r)
          cr.lineTo(ex - r, ey + r)
          cr.stroke()
        } else if (pose.eyeShape === 'arc') {
          cr.arc(ex, ey + r * 0.5, r, Math.PI, 2 * Math.PI)
          cr.stroke()
        } else if (pose.eyeOpen <= 0) {
          cr.moveTo(ex - r, ey)
          cr.lineTo(ex + r, ey)
          cr.stroke()
        } else {
          cr.arc(ex, ey, r * pose.eyeOpen, 0, 2 * Math.PI)
          cr.fill()
        }
      }

      if (pose.mouth !== 'none') {
        const my = u(MOUTH_CY)
        const mw = u(MOUTH_W)
        cr.setSourceRGBA(fg[0], fg[1], fg[2], fg[3])
        if (pose.mouth === 'smile') {
          cr.arc(0, my - mw / 4, mw / 2, 0.15 * Math.PI, 0.85 * Math.PI)
        } else {
          cr.moveTo(-mw / 2, my)
          cr.lineTo(mw / 2, my)
        }
        cr.stroke()
      }

      cr.restore()
    }
  }
)
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`

Expected: no output, exit 0.

The `import type cairo from 'cairo'` line is type-only and erased at build
time; there is no runtime module by that name. `import Cairo from 'gi://cairo'`
is the runtime one, and `build.mjs` already externalises `gi://*`.

- [ ] **Step 4: Verify it bundles**

Run: `npm run build`
Expected: `built dist/`, and `grep -c "gi://cairo" dist/extension.js` is `0` —
the widget is not yet imported by anything, so esbuild tree-shakes it. That is
expected at this point; Task 6 pulls it in.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all green. No new tests — `src/shell` is not unit-testable.

- [ ] **Step 6: Commit**

```bash
git add src/shell/robotHead.ts stylesheet.css
git commit -m "feat(shell): draw the robot head"
```

---

### Task 5: The animate-idle setting

Idle is the common state, and continuous animation is what costs battery — not
the drawing technique. So idle motion is opt-in.

**Files:**
- Modify: `schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml`
- Modify: `src/prefs.ts:56` (after the `alwaysShow` row)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the `animate-idle` boolean GSettings key, read by Task 6 via `this._settings.get_boolean('animate-idle')`.

- [ ] **Step 1: Add the schema key**

In `schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml`, add after the
`always-show` key:

```xml
    <key name="animate-idle" type="b">
      <default>false</default>
      <summary>Animate the robot while idle</summary>
      <description>Play the sleep animation while no agent is running. Costs a small amount of battery.</description>
    </key>
```

- [ ] **Step 2: Verify the schema compiles**

Run: `glib-compile-schemas --dry-run schemas`
Expected: no output, exit 0. Any XML error prints a line and a non-zero status.

- [ ] **Step 3: Add the preferences row**

In `src/prefs.ts`, insert after `group.add(alwaysShow)` (line 56):

```ts
    const animateIdle = new Adw.SwitchRow({
      title: 'Animate while idle',
      subtitle: 'Play the sleep animation while no agent is running. Costs a little battery.',
    })
    settings.bind('animate-idle', animateIdle, 'active', 0)
    group.add(animateIdle)
```

- [ ] **Step 4: Typecheck and build**

Run: `npm run typecheck`
Expected: no output, exit 0.

Run: `npm run build`
Expected: `built dist/`.

- [ ] **Step 5: Commit**

```bash
git add schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml src/prefs.ts
git commit -m "feat(prefs): add the animate-idle setting"
```

---

### Task 6: Wire the head into the island

Swaps the dot for the head, deletes the bespoke pulse, adopts `pillState`, and
gates the tick so a hidden or obscured pill costs nothing. Once `island.ts` no
longer calls `store.worstState()`, this task deletes it — in the same commit,
so the tree is green before and after.

**Files:**
- Modify: `src/shell/island.ts`
- Modify: `src/core/store.ts` (delete `RANK` at lines 12-18 and `worstState()` at lines 43-49)
- Modify: `test/core/store.test.ts` (delete the `worstState` test at lines 101-108)

**Interfaces:**
- Consumes: `RobotHead` from `./robotHead.js` (Task 4), `pillState` from `../core/pillState.js` (Task 3), the `animate-idle` key (Task 5).
- Produces: nothing further; this is the last code task.

- [ ] **Step 1: Update the imports and drop the local STATE_CLASS**

At the top of `src/shell/island.ts`, add:

```ts
import { RobotHead } from './robotHead.js'
import { pillState } from '../core/pillState.js'
```

Delete the `STATE_CLASS` constant (lines 26-32) — `robotHead.ts` owns its own
copy now. **Keep `STATE_WORD`**; the pill's text label still uses it.

- [ ] **Step 2: Replace the dot field and its construction**

Change the field declaration (line 46):

```ts
    private _robot!: InstanceType<typeof RobotHead>
```

Replace the dot's construction in the constructor (lines 72-75 and 86):

```ts
      const box = new St.BoxLayout({ style_class: 'dasbo-pill' })
      this._robot = new RobotHead()
```

and, further down, `box.add_child(this._dot)` becomes:

```ts
      box.add_child(this._robot)
```

`RobotHead` sets its own `y_align`, so the `Clutter.ActorAlign.CENTER` that the
dot carried is not repeated here. `Clutter` stays imported — `_label` still
uses it.

- [ ] **Step 3: Delete the pulse machinery**

Delete these four members outright (lines 59 and 171-192):

```ts
    private _pulsing = false
```

```ts
    private _startPulse(): void {
      if (this._pulsing) return
      this._pulsing = true
      this._pulseStep(false)
    }

    private _pulseStep(dim: boolean): void {
      if (!this._pulsing) return
      this._dot.ease({
        opacity: dim ? 255 : 90,
        duration: 600,
        mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
        onComplete: () => this._pulseStep(!dim),
      })
    }

    private _stopPulse(): void {
      if (!this._pulsing) return
      this._pulsing = false
      this._dot.remove_all_transitions()
      this._dot.opacity = 255
    }
```

In `notifyPermissionOpened()`, delete the `this._startPulse()` call so the body
begins with the auto-open guard:

```ts
    /** Called by the D-Bus service after a permission row has been registered. */
    notifyPermissionOpened(): void {
      if (!this._settings.get_boolean('auto-open-on-permission')) return
      if (Main.layoutManager.primaryMonitor?.inFullscreen) return
      this.menu.open(true)
    }
```

In `_rebuildRows()`, delete the comment block and its statement (lines 272-276):

```ts
      // Base this on whether a permission control is actually on screen, not on
      // worstState(): RANK puts 'error' above 'waiting', so another session sitting
      // in 'error' would otherwise silence the pulse while this one still has live
      // Allow/Deny/Always buttons.
      if (this._controls.size === 0) this._stopPulse()
```

That reasoning now lives in `pillState`'s doc comment, where the rule itself
lives.

In `destroy()`, delete the leading `this._stopPulse()` call.

- [ ] **Step 4: Add the new signal handler ids**

Beside `_settingsChangedId` (line 54), add:

```ts
    private _animateIdleId = 0
    private _fullscreenId = 0
```

In the constructor, after the existing `changed::always-show` connect:

```ts
      this._animateIdleId = this._settings.connect('changed::animate-idle', () => {
        this._robot.setAnimateIdle(this._settings.get_boolean('animate-idle'))
      })
      this._robot.setAnimateIdle(this._settings.get_boolean('animate-idle'))

      // Fullscreen is not a store event, so refresh() never runs for it. The
      // pill is invisible under a fullscreen window; animating it there is
      // pure waste.
      this._fullscreenId = global.display.connect('in-fullscreen-changed', () =>
        this._applyPause()
      )
```

- [ ] **Step 5: Add the pause helper**

Add this method beside `_startTimer` / `_stopTimer`:

```ts
    /**
     * The robot animates only when it can actually be seen. Both inputs are
     * checked together because they change independently: `visible` follows
     * the session count and the always-show setting, fullscreen follows the
     * window manager.
     */
    private _applyPause(): void {
      const fullscreen = Main.layoutManager.primaryMonitor?.inFullscreen ?? false
      this._robot.setPaused(!this.visible || fullscreen)
    }
```

- [ ] **Step 6: Rewrite refresh()**

Replace the whole body of `refresh()` (lines 293-318) with:

```ts
    refresh(): void {
      this._rebuildRows()
      const sessions = this._store.list()
      const count = sessions.length

      if (count === 0 && !this._settings.get_boolean('always-show')) {
        this.visible = false
        this._applyPause()
        return
      }
      this.visible = true

      // One call decides both the head's pose and the label's word, so they
      // can never disagree — a pending permission reads "waiting" in both.
      const state = pillState(sessions)
      this._robot.setState(state)

      if (count === 0) {
        this._label.text = 'idle'
      } else {
        this._label.text = `${count} · ${STATE_WORD[state]}`
      }
      this._applyPause()
    }
```

The `allDone` special case and the `worstState()` call are both gone — they
moved into `pillState`.

- [ ] **Step 7: Release the new handler ids in destroy()**

In `destroy()`, beside the existing `_settingsChangedId` block:

```ts
      if (this._animateIdleId) {
        this._settings.disconnect(this._animateIdleId)
        this._animateIdleId = 0
      }
      if (this._fullscreenId) {
        global.display.disconnect(this._fullscreenId)
        this._fullscreenId = 0
      }
```

The robot itself needs no explicit `destroy()` here — it is a child of the
pill's box, and it releases its timer from its own `destroy` signal handler.

- [ ] **Step 8: Delete the now-unused store code**

`island.ts` was `worstState()`'s only production caller. With Step 6 done it
has none, so remove it rather than leave a tested-but-dead method behind.

In `src/core/store.ts`, delete the `RANK` constant (lines 12-18) and the
`worstState()` method (lines 43-49):

```ts
  worstState(): SessionState {
    let worst: SessionState = 'idle'
    for (const s of this.sessions.values()) {
      if (RANK[s.state] > RANK[worst]) worst = s.state
    }
    return worst
  }
```

`SessionState` may become an unused import in `store.ts` after this. Check the
remaining uses before removing it from the import list — leave it if anything
else still references the type.

In `test/core/store.test.ts`, delete this test entirely:

```ts
  it('worstState ranks waiting above running above idle', () => {
    const s = new SessionStore()
    s.apply(ev({ sessionId: 'a' }))
    s.apply(ev({ sessionId: 'b', kind: 'tool-start', tool: 'Edit' }))
    expect(s.worstState()).toBe('running')
    s.setPending('claude:a', { id: 'p1', tool: 'Bash', deadline: 0, queued: 0 })
    expect(s.worstState()).toBe('waiting')
  })
```

The ranking it covered is now covered by `pillState.test.ts`.

- [ ] **Step 9: Verify nothing still references the old machinery**

Run: `npm run typecheck`
Expected: no output, exit 0.

Run: `grep -rn "_dot\|_pulsing\|worstState" src/shell/island.ts src/core/store.ts`
Expected: no matches. Any hit is a leftover reference.

Run: `grep -rn "worstState" src/ test/`
Expected: no matches anywhere in the project.

- [ ] **Step 10: Build and run the suite**

Run: `npm run build && npm test`
Expected: `built dist/`, all tests pass.

Run: `grep -c "gi://cairo" dist/extension.js`
Expected: `1` — the widget is now reachable and no longer tree-shaken.

- [ ] **Step 11: Commit**

```bash
git add src/shell/island.ts src/core/store.ts test/core/store.test.ts
git commit -m "feat(shell): put the robot head in the pill

island.ts was store.worstState()'s only caller; both it and RANK go with
the switch to pillState."
```

---

### Task 7: Verify on a real shell and tune

Everything above is verified by the compiler and by unit tests. Nothing has yet
confirmed the head is *legible*. The spec flags two glyphs as at risk; this task
is where that gets settled.

**Files:**
- Modify (only if the checks below demand it): `src/shell/robotHead.ts` geometry constants, `stylesheet.css` `.dasbo-robot` size.

- [ ] **Step 1: Install and reload**

```bash
make install
gnome-extensions enable dasbo-island@ayubaswad.gmail.com
```

On X11: `Alt+F2`, `r`, Enter. On Wayland: log out and back in.

Enable **Always show the pill** in the preferences so the idle pose is visible
with no sessions running.

- [ ] **Step 2: Check every pose at real size**

Drive states with `tools/fake-agent.js`. For each of idle, running, waiting,
error and done, confirm the pose is distinguishable at panel size without
leaning in. Take a screenshot of each.

Specifically confirm the two flagged glyphs:
- **Sleep glyphs.** At `1.4em` the largest Z stroke is roughly 1.9px. If it
  reads as noise rather than a Z, fall back in this order: (a) rising dots —
  replace the four-point Z path with a filled `cr.arc`; (b) drop `zzz` to an
  empty array in `robotPose`'s idle branch and let the closed eyes carry sleep
  alone.
- **Smile arc.** Roughly 3.4px wide. If it does not read as a smile, change the
  `done` branch's `mouth` to `'flat'` and let the lit green antenna and the arc
  eyes carry the state.

Either fallback is a constant change, not a redesign.

- [ ] **Step 3: Check both themes**

Switch between the light and dark shell themes. The head's shell must remain
visible in both — it is drawn in the panel's foreground colour, so this should
hold automatically. Confirm the accent colour is still distinguishable against
each panel background.

- [ ] **Step 4: Confirm waiting outranks error**

Start two sessions. Drive one into `error` and trigger a permission prompt on
the other. The pill must show the waiting pose and read `2 · waiting` while the
Allow / Deny / Always buttons are on screen. Resolve the permission; the pill
must fall back to `error`.

- [ ] **Step 5: Confirm the timer really stops**

With `animate-idle` off and one idle session, the head must be visibly static.
Then:

```bash
top -p "$(pgrep -f 'gnome-shell$' | head -1)" -b -n 5 -d 2 | grep gnome-shell
```

Expected: `gnome-shell` sits at its baseline CPU with no ongoing contribution
from the pill. Repeat with `animate-idle` on and confirm the difference is
small but present — that is the setting doing its job.

- [ ] **Step 6: Confirm the one-shots fire once**

Drive a session to `done`. The head must pop once and settle. Then trigger an
unrelated store update (start another session) and confirm the finished head
does **not** pop again. Repeat for the `error` shake.

- [ ] **Step 7: Confirm the fullscreen gate**

With a session running, open a fullscreen window on the primary monitor. Leave
it for a minute, then check the journal for warnings:

```bash
journalctl --user -b -o cat /usr/bin/gnome-shell | grep -i dasbo | tail -20
```

Expected: no `robot repaint failed` lines. Leave fullscreen; the head must
resume animating.

- [ ] **Step 8: Confirm clean teardown**

```bash
gnome-extensions disable dasbo-island@ayubaswad.gmail.com
journalctl --user -b -o cat /usr/bin/gnome-shell | grep -i "dasbo\|Source ID\|already disposed" | tail -20
```

Expected: no `Source ID … was not found` warnings and no disposed-object
errors. Those are the signature of a leaked timer or handler.

- [ ] **Step 9: Commit any tuning**

Only if Steps 2-3 changed constants:

```bash
git add src/shell/robotHead.ts stylesheet.css
git commit -m "fix(shell): tune the robot head for panel size"
```

If the fallbacks in Step 2 were taken, also update the pose table in
`docs/superpowers/specs/2026-07-28-robot-pill-icon-design.md` so the spec
matches what shipped, and include it in the same commit.

- [ ] **Step 10: Update the README if it enumerates settings**

Run: `grep -n "Always show the pill" README.md`

If that matches, the README does name individual settings — add a sentence for
"Animate while idle" beside it and commit:

```bash
git add README.md
git commit -m "docs: mention the animate-idle setting"
```

If it does not match, the README describes preferences only in general terms.
Change nothing and skip the commit.

---

## Verification Summary

| Concern | How it is verified | Where |
|---|---|---|
| Repaint schedule, one-shot decay | Unit tests | Task 1 |
| Pose geometry, ranges, continuity | Unit tests | Task 2 |
| Waiting outranks error; all-done set | Unit tests | Task 3 |
| `src/core` stays free of `gi://` | `test/core/purity.test.ts` | Tasks 1-3 |
| A sixth session state cannot ship unhandled | `tsc` TS2366 | Task 1 Step 5 |
| Widget compiles and bundles | `npm run typecheck`, `npm run build` | Tasks 4, 6 |
| Schema is valid | `glib-compile-schemas --dry-run` | Task 5 |
| Legibility at panel size, both themes | Manual, screenshots | Task 7 |
| Timer actually stops | `top` against `gnome-shell` | Task 7 |
| No leaked timers or handlers | `journalctl` after disable | Task 7 |
