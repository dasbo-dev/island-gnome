import { describe, it, expect } from 'vitest'
import { formatElapsed } from '../../src/core/format.js'

describe('formatElapsed', () => {
  it('formats under an hour as mm:ss', () => {
    expect(formatElapsed(0)).toBe('00:00')
    expect(formatElapsed(42_000)).toBe('00:42')
    expect(formatElapsed(61_000)).toBe('01:01')
    expect(formatElapsed(59 * 60_000 + 59_000)).toBe('59:59')
  })

  it('formats an hour or more as h:mm:ss', () => {
    expect(formatElapsed(3_600_000)).toBe('1:00:00')
    expect(formatElapsed(3_600_000 + 125_000)).toBe('1:02:05')
  })

  it('clamps negative input to zero', () => {
    expect(formatElapsed(-5000)).toBe('00:00')
  })
})
