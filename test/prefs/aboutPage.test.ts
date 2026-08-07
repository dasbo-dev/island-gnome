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

  it('opens the window at the size the core record names', () => {
    // Without a default size the window opens at libadwaita's natural size,
    // which was too short for the About page and put the Support group below
    // the fold. Asserted against the record rather than a literal: a number
    // typed in here typechecks perfectly and is invisible to
    // test/core/prefsWindow.test.ts, so the bound that test enforces would
    // quietly stop applying to the window the user actually sees.
    expect(prefs).toContain('PREFS_WINDOW')
    expect(prefs).toMatch(/set_default_size\(\s*PREFS_WINDOW\.width,\s*PREFS_WINDOW\.height\s*\)/)
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

  it('puts the banner first, then the information, then support', () => {
    // Anchored on the page.add calls rather than on the group titles: the
    // banner has no title (the name is a title-1 label inside it) and the
    // identity group lost the one this assertion used to key on.
    const banner = page.indexOf('page.add(_banner(')
    const identity = page.indexOf('page.add(_identity(')
    const support = page.indexOf('page.add(_support(')
    expect(banner, 'the page never adds a banner').toBeGreaterThan(-1)
    expect(identity).toBeGreaterThan(banner)
    expect(support).toBeGreaterThan(identity)
  })

  it('gives link rows the adw- prefixed icon, not the icon-theme-dependent one', () => {
    // external-link-symbolic isn't a stock Adwaita icon; it shipped once and
    // was caught only by eye, on a machine where Yaru happened to provide a
    // copy. adw-external-link-symbolic ships in libadwaita's own GResource,
    // so it renders everywhere.
    expect(page).toContain('adw-external-link-symbolic')
  })

  it('lays the coffee button out full width', () => {
    const button = /new Gtk\.Button\(\{([\s\S]*?)\}\)/.exec(page)
    expect(button, 'no Gtk.Button construction found').not.toBeNull()
    expect(button?.[1]).toContain('halign: Gtk.Align.FILL')
  })

  it('puts the coffee button before the QR expander in Support', () => {
    // The group's order is a deliberate design decision: the ask leads, the
    // QR sits behind it as progressive disclosure.
    expect(page.indexOf('group.add(buttonRow)')).toBeLessThan(page.indexOf('group.add(expander)'))
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
    // passes — but there are more than two ways to detach the receiver, and
    // the assertion below catches the likeliest one.
    expect(page).not.toMatch(/const launch = launcher\.launch/)
    expect(page).not.toMatch(/^\s*launch\(/m)
    // The narrow function-type cast is the receiver-preserving idiom the
    // comment above `_open` explains; deleting just `.call(launcher, ` from
    // it leaves `(launcher.launch as unknown as Launch)(window, ...)`, which
    // still typechecks and still throws synchronously on every click.
    expect(page).not.toMatch(/as unknown as Launch\)\s*\(/)
  })

  it('survives a missing QR file instead of drawing an empty box', () => {
    expect(page).toContain('query_exists')
  })

  it('falls back to a plain Donate row when there is no QR file', () => {
    // Anchored to the else branch, not just the string's presence: a Donate
    // row added unconditionally — alongside the expander, the misleading
    // double-affordance the comment above this branch rejects — would still
    // leave the bare call in the file and pass a presence-only check.
    const elseBranch = /\}\s*else\s*\{([\s\S]*?)\n  \}/.exec(page)
    expect(elseBranch, 'no else branch found after the QR file check').not.toBeNull()
    expect(elseBranch?.[1]).toMatch(/_linkRow\(window, 'Donate', ABOUT\.supportUrl\)/)
  })

  it('offers the QR behind an expander, as the issue asked', () => {
    expect(page).toContain('Adw.ExpanderRow')
    expect(page).toMatch(/Show QR code/)
  })

  it('gives the QR picture a minimum size request', () => {
    // An earlier attempt wrapped the picture in an Adw.Clamp instead of
    // calling set_size_request: AdwClampLayout reports the child's minimum
    // as its own natural size, so the picture's 0 minimum (can_shrink is
    // true) measured (0, 0) inside one — an invisible QR with a fully green
    // suite, since nothing here built or inspected the actual widget tree.
    // What actually matters is the minimum size request; a bare clamp is
    // what loses it. So the negative half below is narrowed to a clamp
    // *constructed* in the source, not any mention of the class — a comment
    // naming it, or a clamp combined with set_size_request (which does keep
    // the allocation non-zero), must not fail this test.
    expect(page).toContain('set_size_request(200, 200)')
    expect(page).not.toMatch(/new Adw\.Clamp/)
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

describe('the About page banner', () => {
  const page = readFileSync('src/prefs/about.ts', 'utf8')

  it('names no asset of its own', () => {
    expect(page, 'the path belongs in src/core/logo.ts').not.toMatch(/logo-(light|dark)\.svg/)
    expect(page).toContain('logoAsset(')
  })

  it('chooses the variant from the style manager, not the raw setting', () => {
    // Adw.StyleManager.dark is the better answer inside a GTK application: it
    // also accounts for a dark style the application itself forced, which the
    // colour-scheme string alone does not report.
    expect(page).toContain('Adw.StyleManager.get_default()')
    expect(page).not.toContain('org.gnome.desktop.interface')
  })

  it('follows a theme change and drops the handler with the widget', () => {
    expect(page).toContain("connect('notify::dark'")
    expect(page).toContain('disconnect(')
  })

  it('sizes the mark with pixel_size rather than wrapping a Picture', () => {
    // Gtk.Image's pixel_size IS its minimum size, so it cannot collapse the
    // way the QR did when it was wrapped in a clamp — the measured 200x0
    // allocation the comment in _qrRow describes.
    expect(page).toContain('pixel_size = 64')
    expect(page).not.toMatch(/Gtk\.Picture[\s\S]*title-1/)
  })

  it('survives a missing logo instead of drawing an empty box', () => {
    // The guard that decides whether to build the image at all: without it,
    // a missing asset would hand Gtk.Image a path that isn't there.
    expect(page).toContain('if (file.query_exists(null))')
  })

  it('re-checks the file exists when the theme flips', () => {
    // The easiest query_exists of the three to drop — losing it points the
    // image at a path that may not exist and blanks a banner that was fine a
    // moment ago. Anchored inside the handler body, not just anywhere in the
    // file, so a check that moved elsewhere still fails this.
    const handler = /notify::dark'[\s\S]*?\}\)/.exec(page)
    expect(handler, 'no notify::dark handler found').not.toBeNull()
    expect(handler?.[0]).toContain('next.query_exists(null)')
  })

  it('scopes the theme-handler disconnect to the window, not the image', () => {
    // GtkWidget::destroy fires from dispose, and the handler's own closure
    // keeps the image alive through the process-lifetime style manager — so
    // an image-scoped disconnect can never run. The window is explicitly
    // disposed when it closes, so its destroy really fires.
    expect(page).toMatch(/window\.connect\('destroy'/)
    expect(page).not.toMatch(/image\.connect\('destroy'/)
  })

  it('does not invert the variant it asks for', () => {
    // An inverted variant is invisible on both themes rather than merely
    // wrong-looking, so it is the one mistake here that no eye catches.
    expect(page).not.toMatch(/_logoFile\([^,)]+,\s*!/)
    expect(page).not.toMatch(/logoAsset\(\s*!/)
  })

  it('puts the mark in the box, above the name', () => {
    const image = page.indexOf('box.append(image)')
    const name = page.indexOf('box.append(name)')
    expect(image, 'the banner never appends the image').toBeGreaterThan(-1)
    expect(image).toBeLessThan(name)
  })

  it('keeps the banner within its height budget', () => {
    // The banner is what the rest of the page has to fit underneath. At 96px
    // and 24/12 margins it spent ~200px before the first row, and the Support
    // group at the bottom fell below the fold. An edit putting either number
    // back reintroduces that bug and breaks no other test.
    expect(page).toContain('image.pixel_size = 64')
    expect(page).toMatch(/margin_top:\s*12,/)
    expect(page).toMatch(/margin_bottom:\s*6,/)
  })

  it('shows the name and version once each, in the banner', () => {
    // Both moved out of the identity group. Leaving either behind puts the
    // same fact on the page twice, which reads as an oversight.
    expect(page, 'the identity group should no longer title itself').not.toContain(
      "title: 'Dasbo Island'"
    )
    expect(page, 'the Version row moved into the banner').not.toContain("title: 'Version'")
    expect(page).toContain('title-1')
  })
})
