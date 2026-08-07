import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// These two files exist only for the README header, which switches between
// them on prefers-color-scheme. Nothing else in the repo reads them, and both
// failure modes are silent on GitHub: a missing file renders as nothing, and
// the dark variant on a light page renders as a near-white mark on white,
// which also reads as nothing. This test is the only check either gets.
const VIEWBOX = 'viewBox="-1.25 -1 22.5 22.5"'
const BULB = '#7B92F5'
const BODY: Record<string, string> = {
  'logo-light': '#2E2E33',
  'logo-dark': '#E9E9EC',
}

describe('the project logo', () => {
  for (const [name, body] of Object.entries(BODY)) {
    const path = `docs/assets/${name}.svg`

    it(`${path} draws the recentred mark in its own body colour`, () => {
      // readFileSync throwing on a missing file *is* the existence assertion.
      const svg = readFileSync(path, 'utf8')
      expect(svg, `${path} needs the recentred viewBox`).toContain(VIEWBOX)
      expect(svg, `${path} body should be ${body}`).toContain(`fill="${body}"`)
      expect(svg, `${path} bulb should stay ${BULB}`).toContain(`fill="${BULB}"`)
      // The two eyes are punched out of the body by the mask, not drawn.
      expect(svg.match(/<circle[^>]*fill="#000"/g) ?? [], `${path} lost an eye`).toHaveLength(2)
    })
  }

  // Stronger than checking colours one file at a time: it says the light
  // variant is the dark one recoloured, so geometry can never drift apart.
  it('differ from each other only in the body colour', () => {
    const light = readFileSync('docs/assets/logo-light.svg', 'utf8')
    const dark = readFileSync('docs/assets/logo-dark.svg', 'utf8')
    expect(light.replaceAll('#2E2E33', '#E9E9EC')).toBe(dark)
  })
})
