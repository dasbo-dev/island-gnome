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
