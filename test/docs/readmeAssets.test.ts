import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

/**
 * The pixels of an 8-bit RGBA, non-interlaced PNG — which is what the shell's
 * Screenshot API writes. Enough of the format to read a colour out of the
 * capture, and no more: anything else throws rather than guessing.
 */
function decode(png: Buffer): { width: number; height: number; pixels: Buffer } {
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  if (png[24] !== 8 || png[25] !== 6 || png[28] !== 0) {
    throw new Error(`expected 8-bit RGBA, non-interlaced; got depth ${png[24]}, ` +
      `colour type ${png[25]}, interlace ${png[28]}`)
  }

  const parts: Buffer[] = []
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at)
    if (png.toString('ascii', at + 4, at + 8) === 'IDAT') {
      parts.push(png.subarray(at + 8, at + 8 + length))
    }
    at += 12 + length
  }

  // Each row arrives prefixed with the filter it was encoded with, and every
  // filter but None refers to the pixel left, above, or above-left — so rows
  // have to be undone in order, into the buffer being built.
  const raw = inflateSync(Buffer.concat(parts))
  const stride = width * 4
  const pixels = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? pixels[y * stride + x - 4]! : 0
      const up = y > 0 ? pixels[(y - 1) * stride + x]! : 0
      const upLeft = x >= 4 && y > 0 ? pixels[(y - 1) * stride + x - 4]! : 0
      const value = row[x]!
      let out: number
      switch (filter) {
        case 0: out = value; break
        case 1: out = value + left; break
        case 2: out = value + up; break
        case 3: out = value + ((left + up) >> 1); break
        case 4: {
          const guess = left + up - upLeft
          const dl = Math.abs(guess - left)
          const du = Math.abs(guess - up)
          const dul = Math.abs(guess - upLeft)
          out = value + (dl <= du && dl <= dul ? left : du <= dul ? up : upLeft)
          break
        }
        default: throw new Error(`unknown row filter ${filter}`)
      }
      pixels[y * stride + x] = out & 0xff
    }
  }
  return { width, height, pixels }
}

// The SVG this file used to describe could be asked what it drew; a capture
// cannot. What is left are the things a committed binary can still get wrong:
// being the wrong format, being too small to read, being large enough that
// everyone who clones the repository pays for it — and being taken on the
// wrong animation frame.
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

  // The waiting pill is a square wave — 650ms lit, 650ms at alpha 0.16 (see
  // WAIT_PERIOD_MS in src/core/grid.ts) — so half of all captures catch the
  // dim half, where #f5c211 renders as a dull olive and the hero shows the
  // feature it is there to show in its least legible state. The first capture
  // taken for this asset was one of those; this is how that stops shipping.
  it('catches the waiting pill lit, not on the dim half of its blink', () => {
    const { pixels, width } = decode(bytes)
    const box = { x0: 470, y0: 4, x1: 515, y1: 28 }
    let lit = 0
    for (let y = box.y0; y < box.y1; y++) {
      for (let x = box.x0; x < box.x1; x++) {
        const at = (y * width + x) * 4
        const [r, g, b] = [pixels[at]!, pixels[at + 1]!, pixels[at + 2]!]
        if (r > 200 && g > 150 && b < 90) lit++
      }
    }
    // 240 in the shipped capture, 0 on the dim half — the threshold is not
    // near either edge, so a re-render that shifts the grid a pixel or two
    // still passes and only a genuinely unlit pill fails.
    expect(lit, 'no accent-yellow pixels where the pill grid should be').toBeGreaterThan(120)
  })
})
