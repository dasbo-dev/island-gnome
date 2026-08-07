import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ABOUT } from '../../src/core/about.js'

// Source-text assertions, like test/shell/chipDisplayPrefs.test.ts: no GTK
// exists under vitest, so the widget tree cannot be built and inspected. What
// these catch is the class of mistake that survives a typecheck — a URL typed
// in as a literal instead of read from ABOUT, a page that never reaches the
// window, an emphasis class quietly dropped.
describe('the About page', () => {
  const page = readFileSync('src/prefs/about.ts', 'utf8')
  const prefs = readFileSync('src/prefs.ts', 'utf8')

  it('is added to the preferences window, after the other three', () => {
    expect(prefs).toContain('aboutPage(')
    const order = ['_appearancePage', '_behaviourPage', '_agentsPage', 'aboutPage']
    const positions = order.map((name) => prefs.indexOf(`window.add(${name === 'aboutPage' ? '' : 'this.'}${name}`))
    expect(positions.every((p) => p >= 0), 'a page is missing from fillPreferencesWindow').toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('hard-codes no URL of its own', () => {
    // Every address on the page has to come from the record the other tests
    // can check. A literal here is invisible to test/core/about.test.ts.
    const literals = page.match(/https?:\/\/[^'"`\s]+/g) ?? []
    expect(literals, 'URLs belong in src/core/about.ts').toEqual([])
  })

  it('renders each fact from the record', () => {
    for (const field of ['author', 'repoUrl', 'issuesUrl', 'supportUrl', 'license', 'qrAsset']) {
      expect(page, `ABOUT.${field} is never read`).toContain(`ABOUT.${field}`)
    }
  })

  it('emphasises the support button', () => {
    // The one thing the issue asked for by name. Losing suggested-action
    // turns it into a row like any other and typechecks perfectly.
    expect(page).toContain('suggested-action')
    expect(page).toContain('pill')
  })

  it('puts support last, after the information', () => {
    expect(page.indexOf("title: 'Support'")).toBeGreaterThan(page.indexOf("title: 'Dasbo Island'"))
  })

  it('opens links through Gtk.UriLauncher, not the deprecated show_uri', () => {
    expect(page).toContain('Gtk.UriLauncher')
    expect(page).not.toContain('show_uri')
  })

  it('resolves the launch through launch_finish', () => {
    // Anchored to the actual call rather than the bare identifier: the name
    // launch_finish also appears in an explanatory comment above it, so a
    // deleted callback body would still leave the bare string in the file.
    expect(page).toContain('launcher.launch_finish(result)')
  })

  it('does not detach launch from its receiver', () => {
    // launcher.launch is a GJS prototype method: pulled off its instance and
    // invoked bare (`const launch = launcher.launch; launch(...)`), it throws
    // synchronously outside any try/catch, and every click on a link row
    // silently does nothing. These are negative assertions rather than a
    // regex for one exact idiom, so an equivalent bound invocation (e.g.
    // `(launcher as unknown as { launch: Launch }).launch(...)`) still
    // passes — only the two ways of actually detaching the receiver fail.
    expect(page).not.toMatch(/const launch = launcher\.launch/)
    expect(page).not.toMatch(/^\s*launch\(/m)
  })

  it('survives a missing QR file instead of drawing an empty box', () => {
    expect(page).toContain('query_exists')
  })

  it('falls back to a plain Donate row when there is no QR file', () => {
    expect(page).toMatch(/_linkRow\(window, 'Donate', ABOUT\.supportUrl\)/)
  })

  it('offers the QR behind an expander, as the issue asked', () => {
    expect(page).toContain('Adw.ExpanderRow')
    expect(page).toMatch(/Show QR code/)
  })
})

describe('the About page version', () => {
  const prefs = readFileSync('src/prefs.ts', 'utf8')

  it('reads the version from the extension metadata, not a literal', () => {
    // A regression to a hard-coded '0.1.0' would still pass every other test
    // in this suite; this is the only thing that would catch it.
    expect(prefs).toContain("metadata['version-name']")
  })
})

describe('the About page path', () => {
  const prefs = readFileSync('src/prefs.ts', 'utf8')

  it('passes this.path to aboutPage, so the QR asset can be found', () => {
    expect(prefs).toMatch(/aboutPage\([^)]*this\.path/)
  })
})

describe('the About facts reach the page', () => {
  it('exports what prefs.ts imports', () => {
    expect(ABOUT.author).toBe('fsevenm')
  })
})
