import { describe, it, expect } from 'vitest'
import { formatElapsed, truncateDetail } from '../../src/core/format.js'

describe('formatElapsed', () => {
  it('formats under a minute as whole seconds', () => {
    expect(formatElapsed(0)).toBe('0s')
    expect(formatElapsed(400)).toBe('0s')
    expect(formatElapsed(5_000)).toBe('5s')
    expect(formatElapsed(59_999)).toBe('59s')
  })

  it('formats under an hour as whole minutes, flooring the seconds away', () => {
    expect(formatElapsed(60_000)).toBe('1m')
    expect(formatElapsed(90_000)).toBe('1m')
    expect(formatElapsed(3_599_000)).toBe('59m')
  })

  it('formats an hour or more as whole hours, flooring the minutes away', () => {
    expect(formatElapsed(3_600_000)).toBe('1h')
    expect(formatElapsed(3_600_000 + 3_500_000)).toBe('1h')
    expect(formatElapsed(52 * 3_600_000)).toBe('52h')
  })

  it('keeps counting in hours past a day rather than rolling over', () => {
    expect(formatElapsed(25 * 3_600_000)).toBe('25h')
  })

  it('clamps negative input to zero', () => {
    expect(formatElapsed(-5000)).toBe('0s')
  })
})

describe('truncateDetail', () => {
  it('collapses a multi-line string to a single line', () => {
    expect(truncateDetail('line one\nline two\n  line three')).toBe('line one line two line three')
  })

  it('truncates over-length input with a trailing ellipsis, at the requested max', () => {
    const s = 'a'.repeat(200)
    const out = truncateDetail(s, 120)
    expect(out.length).toBe(120)
    expect(out.endsWith('…')).toBe(true)
    expect(out.slice(0, 119)).toBe('a'.repeat(119))
  })

  it('leaves a string exactly at the limit untouched', () => {
    const s = 'a'.repeat(120)
    expect(truncateDetail(s, 120)).toBe(s)
  })

  it('leaves an empty string empty', () => {
    expect(truncateDetail('')).toBe('')
  })

  it('collapses internal runs of whitespace and trims the ends', () => {
    expect(truncateDetail('  rm   -rf    build  ')).toBe('rm -rf build')
  })
})
