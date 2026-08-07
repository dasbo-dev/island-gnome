import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Everything here was on the README's front page before it was restructured.
// Moving a warning is fine; losing one in the move is not, and a deleted
// paragraph leaves no trace anyone would notice. These are the five claims
// that have to survive.
const MUST_STATE = [
  'failing open',
  'notify-only',
  'structurally dead',
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
    expect(text).toContain('antigravityAdapter.encodeDecision')
  })
})
