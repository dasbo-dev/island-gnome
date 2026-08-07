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

function targets(text: string): string[] {
  const found = [...text.matchAll(MARKDOWN_LINK), ...text.matchAll(HTML_SRC)]
    .map((m) => m[1])
    .filter((t): t is string => t !== undefined)
  return found.filter(
    (t) => !/^(https?:|mailto:|#)/.test(t) && !t.startsWith('<')
  )
}

describe('every relative link', () => {
  for (const file of FILES) {
    const text = readFileSync(file, 'utf8')

    for (const target of targets(text)) {
      // A link may carry an anchor; only the path part is a file.
      const path = normalize(join(dirname(file), target.split('#')[0] ?? target))

      it(`${file} → ${target} resolves`, () => {
        expect(existsSync(path), `${file} links ${target}, which is not in the tree`).toBe(true)
      })
    }
  }
})
