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
