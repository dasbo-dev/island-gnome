import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ABOUT } from '../src/core/about.js'

// Three files name the repository, and none of them can see the other two.
// They were all wrong at once before this sweep, which is exactly how that
// failure mode works: nobody notices a link they never click.
//
// Pages has since followed the repository: the site is served from
// dasbo-dev.github.io/island-gnome, and the old fsevenm.github.io/dasbo-island
// URL is gone from the tree. The last case in this file is what keeps it gone.
const FILES = [
  'metadata.json',
  'README.md',
  'site/index.html',
  'CONTRIBUTING.md',
  'SECURITY.md',
  '.github/ISSUE_TEMPLATE/config.yml',
]
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

  // Pages moved after the repository did, and a page that names two hosts
  // sends crawlers one canonical and readers another.
  it('has no reference left to the old Pages host', () => {
    for (const file of [...FILES, 'site/doc-template.html', 'site/sitemap.xml', 'site/robots.txt']) {
      expect(readFileSync(file, 'utf8'), `${file} still points at the old Pages host`).not.toContain(
        'fsevenm.github.io'
      )
    }
  })
})
