import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// The SVG this file used to describe could be asked what it drew; a capture
// cannot. What is left are the things a committed binary can still get wrong:
// being the wrong format, being too small to read, or being large enough that
// everyone who clones the repository pays for it.
describe('the hero screenshot', () => {
  const bytes = readFileSync('docs/assets/hero.png')

  it('is a PNG, not something renamed to look like one', () => {
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  })

  // IHDR is the first chunk: an 8-byte signature, a 4-byte length and a 4-byte
  // type, then width and height as big-endian uint32.
  it('is big enough to read the popup in', () => {
    expect(bytes.readUInt32BE(16)).toBeGreaterThanOrEqual(900)
    expect(bytes.readUInt32BE(20)).toBeGreaterThanOrEqual(500)
  })

  it('stays small enough to clone without regret', () => {
    expect(bytes.byteLength).toBeLessThan(900 * 1024)
  })
})
