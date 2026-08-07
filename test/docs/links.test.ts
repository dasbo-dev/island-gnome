import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

// A relative link that rots is invisible: it renders as ordinary blue text
// and only 404s for the reader who clicks it. Now that the README delegates
// five limitations, a contributing guide, and a security policy to other
// files, that is a lot of surface nobody would notice going stale.
const FILES = [
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  'CHANGELOG.md',
  'docs/limitations.md',
]

const MARKDOWN_LINK = /\]\(([^)\s]+)\)/g
const HTML_SRC = /(?:src|srcset|href)="([^"]+)"/g
const ATX_HEADING = /^#{1,6}[ \t]+(.+?)[ \t]*$/gm

function targets(text: string): string[] {
  const found = [...text.matchAll(MARKDOWN_LINK), ...text.matchAll(HTML_SRC)]
    .map((m) => m[1])
    .filter((t): t is string => t !== undefined)
  return found.filter((t) => !/^(https?:|mailto:|#)/.test(t))
}

// GitHub's own heading-anchor rule: lowercase, drop everything that is not a
// word character, space, or hyphen, then join words with hyphens. "Codex
// hooks written before 0.146.0 never fired" becomes
// codex-hooks-written-before-01460-never-fired — the periods vanish rather
// than becoming separators, which is exactly the kind of detail a hand-typed
// anchor gets wrong.
function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
}

function anchors(path: string): Set<string> {
  const text = readFileSync(path, 'utf8')
  return new Set([...text.matchAll(ATX_HEADING)].map((m) => slug(m[1] ?? '')))
}

describe('every relative link', () => {
  for (const file of FILES) {
    const text = readFileSync(file, 'utf8')

    for (const target of targets(text)) {
      const [rawPath = target, fragment] = target.split('#')
      const path = normalize(join(dirname(file), rawPath))

      it(`${file} → ${target} resolves`, () => {
        expect(existsSync(path), `${file} links ${target}, which is not in the tree`).toBe(true)
      })

      // The restructure moved five limitations out of the README and left
      // eight links pointing at their headings. Renaming one heading breaks
      // up to three of them at once, and GitHub does not 404 on a dead
      // fragment — it silently drops the reader at the top of the page. The
      // path assertion above cannot see any of that.
      if (fragment && rawPath.endsWith('.md') && existsSync(path)) {
        it(`${file} → ${target} points at a heading that exists`, () => {
          expect(
            [...anchors(path)],
            `${file} links #${fragment}, which is not a heading in ${rawPath}`
          ).toContain(fragment)
        })
      }
    }
  }
})
