import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Everything here was on the README's front page before it was restructured.
// Moving a warning is fine; losing one in the move is not, and a deleted
// paragraph leaves no trace anyone would notice. These are the claims that
// have to survive.
//
// "failing open" and "structurally dead" left this list with the two
// Antigravity sections that stated them: this build does not install
// Antigravity hooks, so a caution about reaching its permission gate
// describes something no reader can reach. The README's "Fail-open
// guarantee" heading is a claim about dasbo's own design and is unrelated.
const MUST_STATE = [
  'notify-only',
  'has not been verified',
  'inferred',
]

describe('docs/limitations.md', () => {
  const text = readFileSync('docs/limitations.md', 'utf8')

  for (const claim of MUST_STATE) {
    it(`still states "${claim}"`, () => {
      expect(text).toContain(claim)
    })
  }

  it('names the code paths a reader would go looking for', () => {
    expect(text).toContain('codexAdapter.encodeDecision')
  })
})
