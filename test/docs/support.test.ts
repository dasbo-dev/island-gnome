import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ABOUT } from '../../src/core/about.js'

const readme = readFileSync('README.md', 'utf8')
const landing = readFileSync('site/index.html', 'utf8')

// The About tab asks for support behind a suggested-action button and a QR
// code, but a user only reaches that tab after installing. These two files
// are what a prospective user reads instead, so the same address has to be
// on both — and it has to be the same address, which is why every assertion
// below goes through ABOUT.supportUrl rather than a second literal.
describe('the support section', () => {
  it('gives the README a section of its own, listed in the contents', () => {
    expect(readme).toContain('## Support')
    expect(readme).toContain('- [Support](#support)')
  })

  it('points the README at the address the About tab uses', () => {
    expect(readme).toContain(ABOUT.supportUrl)
  })

  // Not fussiness about repetition. The donation link used to live in the
  // last sentence of Credits, and moving it into its own section is the
  // whole point of that section: two asks eight lines apart read as a
  // pitch. Without this assertion, an edit that restores the Credits
  // sentence passes every other check here.
  it('asks exactly once', () => {
    const hits = readme.split(ABOUT.supportUrl).length - 1
    expect(hits, 'the README should carry the support URL once').toBe(1)
  })

  it('gives the landing page a support section pointing at the same address', () => {
    expect(landing).toContain('id="support"')
    expect(landing).toContain(ABOUT.supportUrl)
  })
})
