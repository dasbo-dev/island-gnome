import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const readme = readFileSync('README.md', 'utf8')

describe('the README', () => {
  it('switches the logo on the reader theme', () => {
    expect(readme).toContain('prefers-color-scheme: dark')
    expect(readme).toContain('docs/assets/logo-dark.svg')
    expect(readme).toContain('docs/assets/logo-light.svg')
  })

  it('shows the hero and admits it is a mockup', () => {
    expect(readme).toContain('docs/assets/hero.svg')
    expect(readme.toLowerCase()).toContain('mockup')
  })

  it('has the sections a first-time reader scans for', () => {
    for (const heading of [
      '## Features',
      '## Requirements',
      '## Install',
      '## How it works',
      '## Supported agents',
      '## Status and known limitations',
      '## Development',
      '## Contributing',
      '## License',
      '## Credits',
    ]) {
      expect(readme, `README lost ${heading}`).toContain(heading)
    }
  })

  // Two warnings changed what a user does with their hands, so relocating
  // them to docs/limitations.md alone would be a regression: a reader can
  // install Antigravity hooks straight from the Install section without ever
  // opening the linked page.
  it('keeps the two warnings that change what a user does', () => {
    expect(readme, 'the Codex trust step must stay in the README').toContain(
      'approve the hook review'
    )
    expect(readme, 'the Antigravity fail-open warning must stay in the README').toContain(
      'failing open'
    )
  })

  it('links the full limitations page', () => {
    expect(readme).toContain('docs/limitations.md')
  })

  it('still points at the canonical repository', () => {
    expect(readme).toContain('github.com/dasbo-dev/island-gnome')
  })
})
