import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const readme = readFileSync('README.md', 'utf8')

describe('the README', () => {
  // Checking only that both filenames appear would pass with the variants
  // swapped, which is the failure this pair exists to prevent: the dark mark
  // is near-white, so on a light page it renders as nothing at all.
  it('switches the logo on the reader theme, dark variant on the dark source', () => {
    expect(readme).toMatch(
      /<source\s+media="\(prefers-color-scheme: dark\)"\s+srcset="src\/assets\/logo-dark\.svg"/
    )
    expect(readme).toMatch(/<img\s+src="src\/assets\/logo-light\.svg"/)
  })

  // The word has to be in the alt text, not merely somewhere on the page: an
  // <img>'s alt overrides the SVG's own <title>, so a caption alone leaves a
  // screen-reader user told this is a photograph of the running extension.
  it('shows the hero and admits in its alt text that it is a mockup', () => {
    expect(readme).toContain('docs/assets/hero.svg')
    expect(readme).toMatch(/!\[[^\]]*mockup/i)
  })

  it('has the sections a first-time reader scans for', () => {
    for (const heading of [
      '## Features',
      '## Requirements',
      '## Install',
      '## How it works',
      '## Supported agents',
      '## Fail-open guarantee',
      '## Status and known limitations',
      '## Development',
      '## Contributing',
      '## License',
      '## Credits',
    ]) {
      expect(readme, `README lost ${heading}`).toContain(heading)
    }
  })

  // The Codex trust step changes what a user does with their hands, so
  // relocating it to docs/limitations.md alone would be a regression: a
  // reader can install Codex hooks straight from the Install section without
  // ever opening the linked page.
  it('keeps the warning that changes what a user does', () => {
    expect(readme, 'the Codex trust step must stay in the README').toContain(
      'approve the hook review'
    )
  })

  // The table lists agents dasbo cannot install yet, so every row has to say
  // which it is. A row with no marker reads as available, and a reader would
  // go to the preferences page looking for a button that is disabled.
  it('marks every agent in the table as shipped or coming soon', () => {
    const table = readme
      .slice(readme.indexOf('## Supported agents'), readme.indexOf('## Fail-open guarantee'))
      .split('\n')
      .filter((line) => line.startsWith('| ') && !line.startsWith('| Agent |'))
    expect(table.length, 'the supported-agents table lost its rows').toBeGreaterThan(4)
    for (const row of table) {
      expect(row, `no availability marker in: ${row}`).toMatch(/\| (Shipped|Coming soon) \|/)
    }
  })

  // This build does not offer Antigravity's hooks. Presenting it as available
  // would send a reader looking for a button that is disabled.
  it('does not offer Antigravity as an agent you can install today', () => {
    const row = readme.split('\n').find((line) => line.startsWith('| Antigravity'))
    expect(row, 'the table lost its Antigravity row').toBeDefined()
    expect(row, 'Antigravity must be marked coming soon').toContain('| Coming soon |')
  })

  it('says which agents are planned', () => {
    for (const agent of ['OpenCode', 'Cursor CLI', 'Antigravity CLI']) {
      expect(readme, `the table is missing ${agent}`).toContain(agent)
    }
    expect(readme, 'the table needs a note explaining what coming soon means')
      .toMatch(/coming soon.+ agent has a row/s)
  })

  it('links the full limitations page', () => {
    expect(readme).toContain('docs/limitations.md')
  })

  it('still points at the canonical repository', () => {
    expect(readme).toContain('github.com/dasbo-dev/island-gnome')
  })
})
