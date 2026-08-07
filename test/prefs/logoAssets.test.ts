import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { LOGO } from '../../src/core/logo.js'

// The mark now has three consumers — the README header, the popup header, and
// the About banner — and every failure mode is silent. A missing file renders
// as nothing in all three; the wrong variant renders as a near-white mark on
// white, which also reads as nothing. Nothing here builds a widget, so this
// file and the source-text tests beside it are the only checks the assets get.
const VIEWBOX = 'viewBox="-1.25 -1 22.5 22.5"'
const BULB = '#7B92F5'
const BODY: Record<string, string> = {
  [LOGO.light]: '#2E2E33',
  [LOGO.dark]: '#E9E9EC',
}

describe('the project logo', () => {
  for (const [asset, body] of Object.entries(BODY)) {
    // The paths in LOGO are relative to the installed extension directory,
    // which is dist/. In the source tree that same layout lives under src/.
    const path = `src/${asset}`

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
    const light = readFileSync(`src/${LOGO.light}`, 'utf8')
    const dark = readFileSync(`src/${LOGO.dark}`, 'utf8')
    expect(light.replaceAll('#2E2E33', '#E9E9EC')).toBe(dark)
  })

  it('ships with the extension — build.mjs copies the directory into dist', () => {
    // Without this cp, both consumers inside the extension fail open and draw
    // nothing, with no error anywhere.
    const build = readFileSync('build.mjs', 'utf8')
    expect(build).toMatch(/cp\('src\/assets',\s*'dist\/assets'/)
  })

  it('is what the README header points at', () => {
    // The assets moved out of docs/ so the build could reach them. A README
    // still pointing at the old path renders a broken image on the project
    // page — the most visible surface the mark has.
    const readme = readFileSync('README.md', 'utf8')
    expect(readme).toContain(`src/${LOGO.dark}`)
    expect(readme).toContain(`src/${LOGO.light}`)
    expect(readme, 'the logo no longer lives in docs/assets').not.toContain('docs/assets/logo')
  })
})
