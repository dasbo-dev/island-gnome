import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Source-text assertions, like test/shell/chipDisplayPrefs.test.ts: St does
// not exist under vitest, so the actor tree cannot be built and inspected.
// What these catch is the class of mistake that survives a typecheck — a
// filename typed in as a literal, a signal handler never disconnected, a mark
// added after the label it is supposed to precede.
describe('the popup header logo', () => {
  const icon = readFileSync('src/shell/logoIcon.ts', 'utf8')
  const header = readFileSync('src/shell/popupHeader.ts', 'utf8')
  const island = readFileSync('src/shell/island.ts', 'utf8')

  it('names no asset of its own', () => {
    // A literal here is invisible to test/prefs/logoAssets.test.ts, which is
    // the only thing checking those files exist.
    expect(icon, 'the path belongs in src/core/logo.ts').not.toMatch(/logo-(light|dark)\.svg/)
    expect(icon).toContain('logoAsset(')
  })

  it('chooses the variant from the desktop colour scheme', () => {
    expect(icon).toContain('org.gnome.desktop.interface')
    expect(icon).toContain('prefersDark(')
  })

  it('follows a theme change instead of keeping the variant it was built with', () => {
    // The header is built once at enable() and lives until disable(), so
    // without this the mark stays near-invisible for the rest of the session.
    expect(icon).toContain("connect('changed::color-scheme'")
  })

  it('disconnects that handler when the icon is destroyed', () => {
    expect(icon).toContain("connect('destroy'")
    expect(icon).toContain('disconnect(')
  })

  it('survives a missing asset instead of throwing inside a widget build', () => {
    // An exception escaping here takes the whole popup rebuild with it. Same
    // fail-open contract as agentIcon.ts.
    expect(icon).toContain('query_exists')
    expect(icon).toMatch(/catch/)
  })

  it('is added to the header before the title', () => {
    const logo = header.indexOf('add_child(logo)')
    const title = header.indexOf('add_child(title)')
    expect(logo, 'the header never adds the logo').toBeGreaterThan(-1)
    expect(title, 'the header never adds the title').toBeGreaterThan(-1)
    expect(logo, 'the issue asked for the mark before the label').toBeLessThan(title)
  })

  it('does not invert the variant it asks for', () => {
    // The variant is chosen at _gicon(base, prefersDark(...)).
    // Catch inversions: direct negation of prefersDark, ! in _gicon's
    // second argument, or negation inside logoAsset() within _gicon.
    expect(icon).not.toMatch(/!prefersDark\(/)
    expect(icon).not.toMatch(/_gicon\([^,)]+,\s*!/)
    expect(icon).not.toMatch(/logoAsset\(\s*!/)
  })

  it('gets the extension path from Island rather than reaching for it', () => {
    // A widget that resolves its own dependencies is the thing the comment
    // above _iconBase in island.ts rejects.
    expect(header).toMatch(/constructor\(base: string/)
    expect(island).toContain('new PopupHeader(this._iconBase')
  })
})
