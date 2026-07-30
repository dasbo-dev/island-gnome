import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { adapters } from '../../src/core/adapters/index.js'

// The chip's mark is a file on disk, found by a path built from the AgentId.
// Nothing at runtime fails when that file is missing — agentIcon returns null
// and the chip quietly renders a bare name — so a rename, or a build.mjs that
// forgets to copy the directory, is a silent feature death. This test is the
// only thing standing between that and a shipped release.
describe('the agent chip marks', () => {
  for (const id of Object.keys(adapters)) {
    const path = `src/icons/${id}.svg`

    it(`${path} exists and draws something`, () => {
      // readFileSync throwing on a missing file *is* the existence assertion.
      const svg = readFileSync(path, 'utf8')
      expect(svg, `${path} needs a 16x16 viewBox`).toMatch(/<svg[^>]*viewBox="0 0 16 16"/)
      expect(svg, `${path} has no path to draw`).toMatch(/<path[^>]*\sd="/)
    })
  }

  it('ships with the extension — build.mjs copies the directory into dist', () => {
    const build = readFileSync('build.mjs', 'utf8')
    expect(build).toMatch(/cp\('src\/icons',\s*'dist\/icons'/)
  })
})
