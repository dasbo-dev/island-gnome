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

  // The version a user sees in preferences comes from metadata.json, and the
  // changelog is where they go to find out what that version contains. The
  // two drift apart silently: bumping one is a one-line edit that leaves the
  // other reading as though the new version was never cut.
  it('CHANGELOG.md carries a dated section for the version metadata.json ships', () => {
    const shipped = JSON.parse(readFileSync('metadata.json', 'utf8'))['version-name']
    const text = readFileSync('CHANGELOG.md', 'utf8')
    const escaped = shipped.replace(/\./g, '\\.')
    const heading = new RegExp(`^## \\[${escaped}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm')
    expect(text, `CHANGELOG.md has no dated section for ${shipped}`).toMatch(heading)
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
