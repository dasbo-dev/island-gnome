import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ABOUT } from '../../src/core/about.js'

// Imports src/core only — never src/prefs/about.ts. tsconfig.test.json sets
// types: ["node"] on purpose, and pulling the gnome-shell ambient types into
// the same Program breaks every Shell.Global access with TS7017.
//
// A Gtk.Picture handed a path that doesn't exist renders an empty widget and
// reports nothing at all. That is the same silent death test/shell/
// iconAssets.test.ts exists to prevent for the agent marks, and the QR is one
// forgotten cp() away from it.
describe('the support QR asset', () => {
  const path = `src/${ABOUT.qrAsset}`

  it('exists and really is a PNG', () => {
    // readFileSync throwing on a missing file IS the existence assertion.
    const bytes = readFileSync(path)
    expect([...bytes.subarray(0, 4)], `${path} is not a PNG`).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('is big enough to scan from a phone', () => {
    // A truncated or placeholder file would still start with the magic bytes.
    expect(readFileSync(path).length).toBeGreaterThan(10_000)
  })

  it('ships with the extension — build.mjs copies the directory into dist', () => {
    const build = readFileSync('build.mjs', 'utf8')
    expect(build).toMatch(/cp\('src\/assets',\s*'dist\/assets'/)
  })
})
