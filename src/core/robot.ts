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
// The error shake is three sine cycles over ERROR_SHAKE_MS (500ms), i.e. 6Hz.
// TICK_ONESHOT (166ms, 6.024Hz) samples almost exactly at that frequency's
// own zero crossings, so the widget would repaint five pixel-identical
// frames instead of a shake. 83ms is a second harmonic that aliases just as
// badly; 50ms is the first rate that neither aliases nor beats.
const TICK_SHAKE = 50

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
      return p < ERROR_SHAKE_MS ? TICK_SHAKE : 0
    case 'done':
      return p < DONE_POP_MS ? TICK_ONESHOT : 0
  }
}

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
