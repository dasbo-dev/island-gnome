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
