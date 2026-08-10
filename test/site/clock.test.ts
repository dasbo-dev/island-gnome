import { describe, it, expect } from 'vitest'
import { clockText } from '../../site/clock.js'

// C22. The mock top bar shipped "Wed Aug 5 14:32" as a literal, on a page
// whose whole pitch is that the demo is real and not a mock. A visibly
// stale date undercuts that for free.
describe('the mock top bar clock', () => {
  it('formats a date the way GNOME does', () => {
    expect(clockText(new Date(2026, 7, 5, 14, 32))).toBe('Wed Aug 5 14:32')
  })

  it('pads the minutes, not the day', () => {
    expect(clockText(new Date(2026, 0, 9, 9, 5))).toBe('Fri Jan 9 09:05')
  })
})
