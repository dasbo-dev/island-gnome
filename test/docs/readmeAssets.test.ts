import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('the hero mockup', () => {
  const path = 'docs/assets/hero.svg'

  it('draws a row for every supported agent', () => {
    const svg = readFileSync(path, 'utf8')
    for (const agent of ['Claude', 'Codex']) {
      expect(svg, `${path} is missing the ${agent} row`).toContain(agent)
    }
  })

  // A drawing of the UI can drift from the UI. Saying so inside the file
  // keeps the disclaimer attached to the asset rather than only to the
  // README paragraph that happens to embed it today.
  it('calls itself a mockup, so nobody mistakes it for a capture', () => {
    const svg = readFileSync(path, 'utf8')
    expect(svg).toMatch(/<title>[^<]*[Mm]ockup/)
  })

  it('is self-contained — no reference to src/icons', () => {
    const svg = readFileSync(path, 'utf8')
    expect(svg).not.toContain('src/icons')
  })
})
