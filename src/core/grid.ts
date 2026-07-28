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

/** Exported so the tests can assert the tick divides the period, rather than
 *  restating the numbers and passing against a drifting one. */
export const PERIOD_MS: Partial<Record<SessionState, number>> = {
  idle: IDLE_PERIOD_MS,
  running: RUN_PERIOD_MS,
  waiting: WAIT_PERIOD_MS,
  done: DONE_WINDOW_MS,
}

const IDLE_DIM = 0.3
const IDLE_LOW = 0.45
const RUN_TRAIL = 0.6
const RUN_DIM = 0.3
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
