import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// A PopupBaseMenuItem built with `reactive: false` gets hit from two sides at
// once: St adds the `:insensitive` pseudo class to any non-reactive actor, and
// popupMenu.js adds the `popup-inactive-menu-item` style class to any
// non-activatable item. The shell theme then has
// `.popup-inactive-menu-item:insensitive { color: #9a9a9a }`, and `color`
// inherits, so every label under such a row is painted the disabled grey.
//
// Our rows are non-reactive for layout reasons, not because they are disabled,
// so each one must claw the colour back. This test fails the moment a new
// non-reactive row is added without an override.
const ITEM_RE = /super\(\{\s*reactive:\s*false[^}]*style_class:\s*'([^']+)'/g

function shellSources(): string[] {
  return readdirSync('src/shell')
    .filter((n) => n.endsWith('.ts'))
    .map((n) => join('src/shell', n))
}

describe('non-reactive popup rows', () => {
  const css = readFileSync('stylesheet.css', 'utf8')

  const classes = shellSources().flatMap((f) => {
    const src = readFileSync(f, 'utf8')
    // The rows carry several classes; only the first is the one that names the
    // row, and it is the one the stylesheet has to target.
    return [...src.matchAll(ITEM_RE)].map((m) => ({
      file: f,
      first: (m[1] ?? '').split(/\s+/)[0] ?? '',
    }))
  })

  it('finds the rows to check', () => {
    expect(classes.length).toBeGreaterThan(0)
  })

  it('each overrides the theme’s insensitive grey', () => {
    const missing = classes
      .filter(({ first }) => !new RegExp(`\\.${first}:insensitive\\b`).test(css))
      .map(({ file, first }) => `${file}: .${first}`)
    expect(missing).toEqual([])
  })

  it('the overrides inherit rather than hardcode a colour', () => {
    // Hardcoding #ffffff would be correct under the dark theme and unreadable
    // under the light one; `inherit` walks up to `.popup-menu`, which each
    // theme sets for itself.
    for (const { first } of classes) {
      const rule = new RegExp(`\\.${first}:insensitive[^{]*\\{[^}]*color:\\s*inherit`)
      expect(rule.test(css), `.${first}:insensitive should use color: inherit`).toBe(true)
    }
  })
})
