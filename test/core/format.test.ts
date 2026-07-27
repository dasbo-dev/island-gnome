import { describe, it, expect } from 'vitest'
import { formatElapsed, truncateDetail } from '../../src/core/format.js'

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
