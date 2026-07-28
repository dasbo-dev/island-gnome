import { describe, it, expect } from 'vitest'
import { robotPose, tickIntervalMs } from '../../src/core/robot.js'
import type { SessionState } from '../../src/core/types.js'

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
