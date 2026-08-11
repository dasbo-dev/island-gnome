import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// GitHub's community-standards check only asks whether these files exist. It
// cannot tell a contributing guide that names this project's actual gates
// from one that says "please write tests", so that part is checked here.
const REQUIRED: Record<string, string[]> = {
  'CONTRIBUTING.md': ['npm test', 'npm run typecheck', 'gi://', 'docs/agent-dialects.md'],
  'CODE_OF_CONDUCT.md': ['Contributor Covenant', 'ayubaswad@gmail.com'],
  'SECURITY.md': ['ayubaswad@gmail.com', 'docs/limitations.md'],
  'CHANGELOG.md': ['Keep a Changelog', '[Unreleased]'],
  '.github/ISSUE_TEMPLATE/bug_report.yml': ['GNOME Shell', 'Wayland', 'journalctl'],
  '.github/ISSUE_TEMPLATE/feature_request.yml': ['extension'],
  '.github/ISSUE_TEMPLATE/config.yml': ['blank_issues_enabled: false'],
  '.github/PULL_REQUEST_TEMPLATE.md': ['npm test', 'npm run typecheck'],
}

describe('the community-health files', () => {
  for (const [path, needles] of Object.entries(REQUIRED)) {
    it(`${path} exists and says what it has to`, () => {
      const text = readFileSync(path, 'utf8')
      for (const needle of needles) {
        expect(text, `${path} never mentions ${needle}`).toContain(needle)
      }
    })
  }

  // No tag has ever been cut in this repository. A changelog that invents a
  // release date is worse than one that admits nothing has shipped.
  it('CHANGELOG.md claims no released version', () => {
    const text = readFileSync('CHANGELOG.md', 'utf8')
    expect(text).not.toMatch(/^## \[\d+\.\d+\.\d+\]/m)
  })

  // The fail-open guarantee is written out in full in two files, and nothing
  // stops one from being reworded on its own. The pair is the whole promise:
  // the README makes it, SECURITY.md explains what it costs.
  it('states the fail-open guarantee identically in the README and SECURITY.md', () => {
    const guarantee =
      'The hook helper exits 0 with empty stdout on every error path. ' +
      'If this extension is disabled, crashed, or never installed, your agents ' +
      'behave exactly as they would without it.'
    const normalise = (path: string) => readFileSync(path, 'utf8').replace(/\s+/g, ' ')
    expect(normalise('README.md'), 'the README lost the fail-open guarantee').toContain(guarantee)
    expect(normalise('SECURITY.md'), 'SECURITY.md lost the fail-open guarantee').toContain(
      guarantee
    )
  })
})
