import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// The README carries a build badge. A badge pointing at a workflow that does
// not run the gates is worse than no badge — it is a green light nobody
// checked.
describe('the CI workflow', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8')

  it('runs on pull requests, which is what site.yml does not do', () => {
    expect(ci).toContain('pull_request')
  })

  it('runs every gate', () => {
    for (const cmd of ['npm ci', 'npm test', 'npm run typecheck', 'node build.mjs']) {
      expect(ci, `ci.yml never runs ${cmd}`).toContain(cmd)
    }
  })

  it('is the workflow the README badge points at', () => {
    const readme = readFileSync('README.md', 'utf8')
    expect(readme).toContain('actions/workflows/ci.yml/badge.svg')
  })
})
