import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// The row's state dot is pinned to the *top* of the activity row rather than
// centred in it, because the activity text wraps: over three lines a centred
// dot floats beside the middle line instead of beside the status it names.
//
// But START alone aligns the dot's box to the top of the whole label, and what
// the eye wants is the dot centred on the *first line* — an alignment St and
// Clutter have no name for. Measured against a rendered row, an 8px dot at
// START sits 5px above the first line's ink: the dot spans the row's y 23..30
// while `idle` runs ascender-top 28 to baseline 35. So the offset has to be
// declared, and it only stays declared if something fails when it is dropped.
//
// The pairing is the invariant: START without an offset is the bug this test
// exists for, and CENTER with an offset would be doubly wrong. Neither half is
// meaningful alone, so both are asserted together.
describe('the row dot sits beside the first line of activity text', () => {
  const src = readFileSync('src/shell/sessionRow.ts', 'utf8')
  const css = readFileSync('stylesheet.css', 'utf8')

  const rule = /\.dasbo-dot\s*\{([^}]*)\}/.exec(css)

  it('has a .dasbo-dot rule to check', () => {
    expect(rule).not.toBeNull()
  })

  it('pins the dot to the top of the wrapping activity row', () => {
    // Anchored on the dot's own construction line, not the file: several other
    // actors in this row use ActorAlign.START for unrelated reasons.
    expect(src).toMatch(/_dot = new St\.Widget\(\{[^}]*ActorAlign\.START/)
  })

  it('offsets the dot down onto that first line', () => {
    const body = rule?.[1] ?? ''
    const margin = /margin-top:\s*([\d.]+)px/.exec(body)
    expect(margin, '.dasbo-dot needs a margin-top to pair with ActorAlign.START').not.toBeNull()

    // Bounded rather than pinned to one number: the exact offset depends on the
    // shell's font, and a future retune of .dasbo-row-activity's size may move
    // it. But it can only ever be a fraction of a line — an offset at or past
    // the dot's own 8px height has pushed the dot clear of the line it is meant
    // to sit on, which is the original bug mirrored downward.
    const px = Number(margin?.[1])
    expect(px).toBeGreaterThan(0)
    expect(px).toBeLessThan(8)
  })

  it('keeps the dot 8px square, which the offset is measured against', () => {
    const body = rule?.[1] ?? ''
    expect(body).toMatch(/width:\s*8px/)
    expect(body).toMatch(/height:\s*8px/)
  })
})
