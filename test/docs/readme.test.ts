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
