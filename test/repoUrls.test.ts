import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ABOUT } from '../src/core/about.js'

// Three files name the repository, and none of them can see the other two.
// They were all wrong at once before this sweep, which is exactly how that
// failure mode works: nobody notices a link they never click.
//
// The Pages URL fsevenm.github.io/dasbo-island is deliberately NOT swept —
// the site is still served from there. Only the repository moved.
const FILES = ['metadata.json', 'README.md', 'site/index.html', 'CONTRIBUTING.md', 'SECURITY.md']
const STALE = ['fsevenm/dasbo-island', 'ayubaswad/dasbo-island']

describe('the repository URL', () => {
  for (const file of FILES) {
    const text = readFileSync(file, 'utf8')

    it(`${file} holds no stale repository slug`, () => {
      for (const slug of STALE) {
        expect(text, `${file} still points at ${slug}`).not.toContain(`github.com/${slug}`)
      }
    })

    // The negative assertion above is satisfiable by deleting the link
    // instead of fixing it. This one says the link has to exist.
    it(`${file} names the canonical repository`, () => {
      expect(text).toContain('github.com/dasbo-dev/island-gnome')
    })
  }

  it('agrees with the record the About page renders', () => {
    expect(ABOUT.repoUrl).toBe('https://github.com/dasbo-dev/island-gnome')
  })
})
