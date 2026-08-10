import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { renderDoc, DOC_PAGES } from '../../site/docPages.mjs'

// A same-origin href on this page resolves against dist-site/, not against
// the repository, so a typo here is invisible to every other test in the
// suite and 404s only for the reader who clicks it. The audit's C13 fix is
// exactly such a link, pointing at an anchor in a file the build generates.
const html = readFileSync('site/index.html', 'utf8')
const hrefs = [...html.matchAll(/href="([^"]+)"/g)]
  .map((m) => m[1]!)
  .filter((h) => !/^(https?:|mailto:|#)/.test(h))

// What `node build.mjs` puts in dist-site/. Files copied straight from
// site/ are checked on disk; the two doc pages are generated, so they are
// listed here and their existence is guarded by docPages.test.ts.
const GENERATED = new Set(['demo.js', ...DOC_PAGES.map((p) => p.out)])

const rendered = new Map(DOC_PAGES.map((p) => [p.out, renderDoc(readFileSync(p.source, 'utf8'))]))

describe('the landing page links', () => {
  it('finds same-origin links to check', () => {
    expect(hrefs.length).toBeGreaterThan(0)
  })

  for (const href of hrefs) {
    const [path, hash] = href.split('#')

    it(`${href} points at a file the build emits`, () => {
      if (path === '' || path === undefined) return
      if (GENERATED.has(path)) return
      expect(existsSync(`site/${path}`) || existsSync(`src/icons/${path.replace(/^icons\//, '')}`)).toBe(
        true
      )
    })

    if (hash && path && rendered.has(path)) {
      it(`${href} points at an anchor that exists in ${path}`, () => {
        expect(rendered.get(path)).toContain(`id="${hash}"`)
      })
    }
  }
})
