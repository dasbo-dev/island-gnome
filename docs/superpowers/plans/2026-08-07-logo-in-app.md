# Logo in the extension UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the project mark in the popup header before the "Dasbo Island" label and as a banner at the top of the preferences About page, in the variant that matches the current light/dark theme.

**Architecture:** The light/dark decision and the two asset paths live in a pure `src/core/logo.ts` that vitest can import; the GJS files are thin adapters. The shell reads `org.gnome.desktop.interface color-scheme` (it has no style manager); the preferences window reads `Adw.StyleManager.dark`. Both re-resolve their icon when the theme changes and disconnect the handler when their widget is destroyed.

**Tech Stack:** TypeScript, esbuild, GJS (GNOME Shell 46), St, GTK 4 / libadwaita 1, vitest.

**Spec:** [`docs/superpowers/specs/2026-08-07-logo-in-app-design.md`](../specs/2026-08-07-logo-in-app-design.md)

## Global Constraints

- Target GNOME Shell 46 (`metadata.json` `shell-version: ["46"]`). No API newer than that.
- No new npm dependency, no new GSettings key, no change to `metadata.json`.
- No test in this repo may import anything from `src/shell/` or `src/prefs/`: `tsconfig.test.json` sets `types: ["node"]`, and pulling the gnome-shell ambient types into the same Program breaks every `Shell.global` access with TS7017. Tests assert against `src/core/**` and against **source text** read with `readFileSync`, as `test/prefs/aboutPage.test.ts` and `test/shell/chipDisplayPrefs.test.ts` already do.
- The variant names describe **the theme they belong to, not the ink they are drawn in**: `logo-light.svg` has a `#2E2E33` body and is for **light** backgrounds; `logo-dark.svg` has an `#E9E9EC` body and is for **dark** backgrounds. Reading these backwards yields an invisible mark on both themes.
- The antenna dot is `#7B92F5` in both variants. The two SVGs are otherwise byte-identical.
- Asset paths returned from `src/core/logo.ts` are **relative to the installed extension directory**, exactly like `ABOUT.qrAsset`. Each call site joins it onto its own base path.
- A missing asset must never throw. It degrades to no mark and nothing else — the fail-open contract `src/shell/agentIcon.ts` documents.
- Out of scope: the panel pill icon, `site/index.html`, the notification popup, `-symbolic` variants.
- Work happens on branch `feat/logo-in-app` in the worktree `../dasbo-island-logo`.

### Running the gates

The worktree has no `node_modules` of its own. Run the toolchain from the main checkout, pointed at the worktree:

```bash
/home/fsevenm/projects/dasbo-island/node_modules/.bin/vitest run --root /home/fsevenm/projects/dasbo-island-logo <path>
```

If a `node_modules` symlink exists in the worktree, **delete it before the final merge** — `.gitignore` matches the directory, not a symlink, so it shows up as untracked.

---

### Task 1: The pure logo module

The light/dark decision, kept where a test can reach it. Nothing consumes it yet.

**Files:**
- Create: `src/core/logo.ts`
- Test: `test/core/logo.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `LOGO: { readonly light: 'assets/logo-light.svg'; readonly dark: 'assets/logo-dark.svg' }`
  - `logoAsset(dark: boolean): string` — returns `LOGO.dark` when `dark` is true, `LOGO.light` otherwise.
  - `prefersDark(colorScheme: string): boolean` — `false` only for `'prefer-light'`.

- [ ] **Step 1: Write the failing test**

Create `test/core/logo.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { LOGO, logoAsset, prefersDark } from '../../src/core/logo.js'

describe('logoAsset', () => {
  it('picks the light-bodied mark for a dark background', () => {
    // logo-dark.svg is the one with the #E9E9EC body. The names describe the
    // theme, not the ink — getting this backwards is invisible on the machine
    // of whoever writes it and invisible on the other theme too.
    expect(logoAsset(true)).toBe(LOGO.dark)
  })

  it('picks the dark-bodied mark for a light background', () => {
    expect(logoAsset(false)).toBe(LOGO.light)
  })

  it('names two different files', () => {
    expect(LOGO.light).not.toBe(LOGO.dark)
  })

  it('returns a path relative to the extension directory', () => {
    // The call sites join this onto extension.path, the way ABOUT.qrAsset is
    // joined. A leading slash would silently resolve to the filesystem root.
    for (const path of [LOGO.light, LOGO.dark]) {
      expect(path.startsWith('/'), `${path} must not be absolute`).toBe(false)
      // build.mjs only copies src/assets into dist; a path outside it ships
      // nothing.
      expect(path).toMatch(/^assets\//)
    }
  })
})

describe('prefersDark', () => {
  it('is false only when the user asked for light', () => {
    expect(prefersDark('prefer-light')).toBe(false)
  })

  it('is true when the user asked for dark', () => {
    expect(prefersDark('prefer-dark')).toBe(true)
  })

  it('treats the unset default as dark', () => {
    // The Shell popup is dark unless the user explicitly asks for light, so
    // 'default' has to select the light-bodied mark.
    expect(prefersDark('default')).toBe(true)
  })

  it('treats an unrecognised value as dark', () => {
    // A future GNOME adding a value should fail toward the common case, not
    // the rare one.
    expect(prefersDark('prefer-sepia')).toBe(true)
    expect(prefersDark('')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
/home/fsevenm/projects/dasbo-island/node_modules/.bin/vitest run --root /home/fsevenm/projects/dasbo-island-logo test/core/logo.test.ts
```

Expected: FAIL — `Failed to resolve import "../../src/core/logo.js"`.

- [ ] **Step 3: Write the module**

Create `src/core/logo.ts`:

```ts
/**
 * Which variant of the project mark to draw, and where it lives.
 *
 * Kept out of the two GJS files that render it for the reason src/core/
 * about.ts exists: no test in this repo can import src/shell or src/prefs, so
 * a light/dark mapping written inline there would be unreachable — and a mark
 * drawn in the wrong variant is invisible rather than wrong-looking.
 *
 * The names describe the theme each file belongs to, not the ink it is drawn
 * in: logo-light.svg has a dark (#2E2E33) body for light backgrounds,
 * logo-dark.svg a light (#E9E9EC) body for dark ones. That is the sense the
 * README's <picture> element already uses.
 *
 * Both paths are relative to the installed extension directory; the call
 * sites join them onto their own base path, as ABOUT.qrAsset is joined.
 */
export const LOGO = {
  light: 'assets/logo-light.svg',
  dark: 'assets/logo-dark.svg',
} as const

/** The mark to draw against a background of the given darkness. */
export function logoAsset(dark: boolean): string {
  return dark ? LOGO.dark : LOGO.light
}

/**
 * Whether a raw `org.gnome.desktop.interface color-scheme` string means a dark
 * background.
 *
 * Shell-side only. The preferences window has Adw.StyleManager.dark, which is
 * a better answer there — it also accounts for a dark style the application
 * itself forced — so the About page passes that boolean straight to logoAsset
 * and never calls this.
 *
 * Everything that is not an explicit 'prefer-light' counts as dark, including
 * 'default': the Shell's popup is dark unless the user has asked otherwise,
 * and an unrecognised value from a later GNOME should fail toward the common
 * case rather than the rare one.
 */
export function prefersDark(colorScheme: string): boolean {
  return colorScheme !== 'prefer-light'
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
/home/fsevenm/projects/dasbo-island/node_modules/.bin/vitest run --root /home/fsevenm/projects/dasbo-island-logo test/core/logo.test.ts
```

Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/fsevenm/projects/dasbo-island-logo
git add src/core/logo.ts test/core/logo.test.ts
git commit -m "feat(core): decide the logo variant from the colour scheme"
```

---

### Task 2: Move the assets so the build ships them

`build.mjs` copies `src/assets` into `dist/assets` and nothing copies `docs/`. The files move; the README follows them; the test that guards them moves too and is rewritten to read its paths from `LOGO`, so a rename can never leave the test pointing at the old location.

**Files:**
- Move: `docs/assets/logo-light.svg` → `src/assets/logo-light.svg`
- Move: `docs/assets/logo-dark.svg` → `src/assets/logo-dark.svg`
- Modify: `README.md:3-6` (the `<picture>` element)
- Create: `test/prefs/logoAssets.test.ts`
- Modify: `test/docs/readmeAssets.test.ts` — its `describe('the project logo')` block moves into the new file; the hero blocks stay.

**Interfaces:**
- Consumes: `LOGO` from Task 1.
- Produces: `src/assets/logo-{light,dark}.svg` present in the built `dist/assets/`.

- [ ] **Step 1: Move the files with git**

```bash
cd /home/fsevenm/projects/dasbo-island-logo
git mv docs/assets/logo-light.svg src/assets/logo-light.svg
git mv docs/assets/logo-dark.svg src/assets/logo-dark.svg
ls docs/assets src/assets
```

Expected: `docs/assets` now holds `hero.svg` alone; `src/assets` holds `logo-dark.svg`, `logo-light.svg`, `qr-code.png`. **Do not edit the SVGs** — their contents are unchanged by this whole plan.

- [ ] **Step 2: Write the failing test**

Create `test/prefs/logoAssets.test.ts`. The three logo assertions are moved verbatim from `test/docs/readmeAssets.test.ts`, with the paths now derived from `LOGO` instead of typed as literals:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { LOGO } from '../../src/core/logo.js'

// The mark now has three consumers — the README header, the popup header, and
// the About banner — and every failure mode is silent. A missing file renders
// as nothing in all three; the wrong variant renders as a near-white mark on
// white, which also reads as nothing. Nothing here builds a widget, so this
// file and the source-text tests beside it are the only checks the assets get.
const VIEWBOX = 'viewBox="-1.25 -1 22.5 22.5"'
const BULB = '#7B92F5'
const BODY: Record<string, string> = {
  [LOGO.light]: '#2E2E33',
  [LOGO.dark]: '#E9E9EC',
}

describe('the project logo', () => {
  for (const [asset, body] of Object.entries(BODY)) {
    // The paths in LOGO are relative to the installed extension directory,
    // which is dist/. In the source tree that same layout lives under src/.
    const path = `src/${asset}`

    it(`${path} draws the recentred mark in its own body colour`, () => {
      // readFileSync throwing on a missing file *is* the existence assertion.
      const svg = readFileSync(path, 'utf8')
      expect(svg, `${path} needs the recentred viewBox`).toContain(VIEWBOX)
      expect(svg, `${path} body should be ${body}`).toContain(`fill="${body}"`)
      expect(svg, `${path} bulb should stay ${BULB}`).toContain(`fill="${BULB}"`)
      // The two eyes are punched out of the body by the mask, not drawn.
      expect(svg.match(/<circle[^>]*fill="#000"/g) ?? [], `${path} lost an eye`).toHaveLength(2)
    })
  }

  // Stronger than checking colours one file at a time: it says the light
  // variant is the dark one recoloured, so geometry can never drift apart.
  it('differ from each other only in the body colour', () => {
    const light = readFileSync(`src/${LOGO.light}`, 'utf8')
    const dark = readFileSync(`src/${LOGO.dark}`, 'utf8')
    expect(light.replaceAll('#2E2E33', '#E9E9EC')).toBe(dark)
  })

  it('ships with the extension — build.mjs copies the directory into dist', () => {
    // Without this cp, both consumers inside the extension fail open and draw
    // nothing, with no error anywhere.
    const build = readFileSync('build.mjs', 'utf8')
    expect(build).toMatch(/cp\('src\/assets',\s*'dist\/assets'/)
  })

  it('is what the README header points at', () => {
    // The assets moved out of docs/ so the build could reach them. A README
    // still pointing at the old path renders a broken image on the project
    // page — the most visible surface the mark has.
    const readme = readFileSync('README.md', 'utf8')
    expect(readme).toContain(`src/${LOGO.dark}`)
    expect(readme).toContain(`src/${LOGO.light}`)
    expect(readme, 'the logo no longer lives in docs/assets').not.toContain('docs/assets/logo')
  })
})
```

- [ ] **Step 3: Delete the moved block from the README asset test**

In `test/docs/readmeAssets.test.ts`, delete the entire leading `describe('the project logo', ...)` block **and** the four constants above it (`VIEWBOX`, `BULB`, `BODY`) and the comment paragraph that introduces them. Keep the imports and the whole `describe('the hero mockup', ...)` block. The file afterwards begins:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('the hero mockup', () => {
  const path = 'docs/assets/hero.svg'
```

- [ ] **Step 4: Run the tests and watch the README assertion fail**

```bash
/home/fsevenm/projects/dasbo-island/node_modules/.bin/vitest run --root /home/fsevenm/projects/dasbo-island-logo test/prefs/logoAssets.test.ts test/docs/readmeAssets.test.ts
```

Expected: the four file-content tests PASS (the files really did move), and `is what the README header points at` FAILS — the README still says `docs/assets/logo-dark.svg`.

- [ ] **Step 5: Repoint the README**

In `README.md`, replace lines 3-6:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="src/assets/logo-dark.svg">
  <img src="src/assets/logo-light.svg" alt="" width="120">
</picture>
```

- [ ] **Step 6: Run the full suite**

```bash
/home/fsevenm/projects/dasbo-island/node_modules/.bin/vitest run --root /home/fsevenm/projects/dasbo-island-logo
```

Expected: PASS. `test/docs/links.test.ts` resolves the README's new relative paths against the real files, so it covers the move too — if it fails, the path in the `<picture>` is wrong.

- [ ] **Step 7: Commit**

```bash
cd /home/fsevenm/projects/dasbo-island-logo
git add src/assets README.md test/prefs/logoAssets.test.ts test/docs/readmeAssets.test.ts docs/assets
git commit -m "refactor: move the logo into src/assets so the build ships it"
```

---

### Task 3: The mark in the popup header

**Files:**
- Create: `src/shell/logoIcon.ts`
- Modify: `src/shell/popupHeader.ts:6-48` (the `PopupHeader` constructor)
- Modify: `src/shell/island.ts:151` (the `new PopupHeader(...)` call)
- Test: `test/shell/popupHeaderLogo.test.ts`

**Interfaces:**
- Consumes: `logoAsset`, `prefersDark` from Task 1; the assets from Task 2.
- Produces: `logoIcon(base: string, size?: number): St.Icon | null`; `PopupHeader`'s constructor signature becomes `(base: string, cb: PopupHeaderCallbacks)`.

- [ ] **Step 1: Write the failing test**

Create `test/shell/popupHeaderLogo.test.ts`:

```ts
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

  it('gets the extension path from Island rather than reaching for it', () => {
    // A widget that resolves its own dependencies is the thing the comment
    // above _iconBase in island.ts rejects.
    expect(header).toMatch(/constructor\(base: string/)
    expect(island).toContain('new PopupHeader(this._iconBase')
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
/home/fsevenm/projects/dasbo-island/node_modules/.bin/vitest run --root /home/fsevenm/projects/dasbo-island-logo test/shell/popupHeaderLogo.test.ts
```

Expected: FAIL — `ENOENT: no such file or directory, open 'src/shell/logoIcon.ts'`.

- [ ] **Step 3: Write the icon module**

Create `src/shell/logoIcon.ts`:

```ts
import Gio from 'gi://Gio'
import St from 'gi://St'
import { logoAsset, prefersDark } from '../core/logo.js'

/**
 * The project mark as a header icon, or `null` when the asset is not there.
 *
 * Returning `null` rather than an empty St.Icon is deliberate: an icon with no
 * gicon still occupies its icon_size, so a missing file would cost the header
 * a 16px hole. The header just leaves the mark out instead — the same
 * fail-open contract agentIcon.ts documents for the chip marks.
 *
 * The Shell has no style manager, so the variant comes from the desktop's own
 * colour-scheme setting. It is re-read on change because this icon is built
 * once at enable() and lives until disable(): without the watcher, a user who
 * switches theme mid-session keeps a near-invisible mark until the extension
 * is reloaded.
 */
export function logoIcon(base: string, size = 16): St.Icon | null {
  const settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' })

  const current = (): Gio.Icon | null =>
    _gicon(base, prefersDark(settings.get_string('color-scheme')))

  const first = current()
  if (!first) return null

  const icon = new St.Icon({
    style_class: 'dasbo-header-logo',
    icon_size: size,
    gicon: first,
  })

  const handler = settings.connect('changed::color-scheme', () => {
    // A null here means the other variant is missing while this one is not.
    // Keeping the mark already on screen beats blanking the header.
    const next = current()
    if (next) icon.gicon = next
  })
  // The popup tree is destroyed on disable(); the settings object outlives
  // this frame only through that handler, so dropping it here is what keeps a
  // disable/enable cycle from stacking up live handlers on a dead actor.
  icon.connect('destroy', () => settings.disconnect(handler))

  return icon
}

function _gicon(base: string, dark: boolean): Gio.Icon | null {
  try {
    const file = Gio.File.new_for_path(`${base}/${logoAsset(dark)}`)
    return file.query_exists(null) ? Gio.FileIcon.new(file) : null
  } catch (e) {
    // query_exists does not throw for an absent file, but it can for a path
    // that is not readable at all. This runs inside a widget build, and an
    // exception escaping there takes the popup with it.
    console.warn(`dasbo-island: resolving the logo failed: ${e}`)
    return null
  }
}
```

- [ ] **Step 4: Add the mark to the header**

In `src/shell/popupHeader.ts`, add the import below the existing ones:

```ts
import { logoIcon } from './logoIcon.js'
```

Change the constructor signature and add the child. The constructor becomes:

```ts
    constructor(base: string, cb: PopupHeaderCallbacks) {
      super({ reactive: false, can_focus: false, style_class: 'dasbo-header dasbo-fixed-width' })
      this._cb = cb

      // Null when the asset is missing, in which case the header is the text
      // it has always been. .dasbo-header's 12px spacing separates it from
      // the title; the popup's width is pinned at 30em, so the mark costs the
      // title nothing.
      const logo = logoIcon(base)

      const title = new St.Label({
```

and, at the end of the constructor, replace the two `add_child` calls with:

```ts
      if (logo) this.add_child(logo)
      this.add_child(title)
      this.add_child(gear)
```

- [ ] **Step 5: Pass the path in from Island**

In `src/shell/island.ts:151`, change:

```ts
      this._header = new PopupHeader({
```

to:

```ts
      this._header = new PopupHeader(this._iconBase, {
```

`this._iconBase` is assigned at `src/shell/island.ts:133`, before this line, so it is already set.

- [ ] **Step 6: Run the tests and the typecheck**

```bash
/home/fsevenm/projects/dasbo-island/node_modules/.bin/vitest run --root /home/fsevenm/projects/dasbo-island-logo
cd /home/fsevenm/projects/dasbo-island-logo && /home/fsevenm/projects/dasbo-island/node_modules/.bin/tsc --noEmit -p tsconfig.json
```

Expected: all tests PASS; `tsc` prints nothing and exits 0. A TS2345 on the `PopupHeader` call means step 5 was skipped.

- [ ] **Step 7: Commit**

```bash
cd /home/fsevenm/projects/dasbo-island-logo
git add src/shell/logoIcon.ts src/shell/popupHeader.ts src/shell/island.ts test/shell/popupHeaderLogo.test.ts
git commit -m "feat(shell): put the mark in the popup header before the title"
```

---

### Task 4: The About page banner

**Files:**
- Modify: `src/prefs/about.ts` — new `_banner`, `_identity` loses its title and its Version row
- Modify: `test/prefs/aboutPage.test.ts:44` (the Support-ordering assertion) plus new assertions

**Interfaces:**
- Consumes: `logoAsset` from Task 1; the assets from Task 2.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the failing tests**

In `test/prefs/aboutPage.test.ts`, **replace** this test:

```ts
  it('puts support last, after the information', () => {
    expect(page.indexOf("title: 'Support'")).toBeGreaterThan(page.indexOf("title: 'Dasbo Island'"))
  })
```

with:

```ts
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
```

Then add this whole block at the end of the file:

```ts
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
    expect(page).toContain('pixel_size = 96')
    expect(page).not.toMatch(/Gtk\.Picture[\s\S]*title-1/)
  })

  it('survives a missing logo instead of drawing an empty box', () => {
    // Three query_exists calls now: the logo when the banner is built, the
    // logo again when the theme flips, and the QR down in _support. The
    // middle one is the easiest to drop — losing it points the image at a
    // path that may not exist and blanks a banner that was fine a moment ago.
    expect(page.match(/query_exists/g) ?? []).toHaveLength(3)
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
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
/home/fsevenm/projects/dasbo-island/node_modules/.bin/vitest run --root /home/fsevenm/projects/dasbo-island-logo test/prefs/aboutPage.test.ts
```

Expected: FAIL — 7 failures, starting with `the page never adds a banner`.

- [ ] **Step 3: Add the banner**

In `src/prefs/about.ts`, add the import beside the existing `ABOUT` one:

```ts
import { logoAsset } from '../core/logo.js'
```

Change the page body so the banner comes first, and stop handing `version` to `_identity`:

```ts
  page.add(_banner(extensionPath, version))
  page.add(_identity(window))
  page.add(_support(window, extensionPath))
```

Add `_banner` immediately above `_identity`:

```ts
// The page's identity, shown the way GNOME's own about windows show it: the
// mark, the name, the version. Everything below it is a row.
function _banner(extensionPath: string, version: string): Adw.PreferencesGroup {
  const group = new Adw.PreferencesGroup()

  const box = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 6,
    margin_top: 24,
    margin_bottom: 12,
    halign: Gtk.Align.CENTER,
  })

  const manager = Adw.StyleManager.get_default()
  const file = _logoFile(extensionPath, manager.dark)
  // The same check the QR makes below, for the same reason: a Gtk.Image handed
  // a path that isn't there draws nothing and reports nothing. Without the
  // image the name and version still render, so a missing asset costs the page
  // a decoration rather than its content.
  if (file.query_exists(null)) {
    // Gtk.Image with pixel_size, not Gtk.Picture: pixel_size *is* the image's
    // minimum size, so it cannot collapse the way the QR did inside a clamp
    // (see the note in _qrRow).
    const image = Gtk.Image.new_from_gicon(Gio.FileIcon.new(file))
    image.pixel_size = 96

    // The preferences window outlives a theme switch, so the variant is
    // re-resolved rather than fixed at build time.
    const handler = manager.connect('notify::dark', () => {
      const next = _logoFile(extensionPath, manager.dark)
      // Keep the mark already on screen if the other variant is missing.
      if (next.query_exists(null)) image.gicon = Gio.FileIcon.new(next)
    })
    image.connect('destroy', () => manager.disconnect(handler))

    box.append(image)
  }

  const name = new Gtk.Label({ label: 'Dasbo Island' })
  name.add_css_class('title-1')
  box.append(name)

  const versionLabel = new Gtk.Label({ label: version })
  versionLabel.add_css_class('dim-label')
  box.append(versionLabel)

  const row = new Adw.PreferencesRow({ activatable: false, selectable: false })
  row.set_child(box)
  group.add(row)

  return group
}

function _logoFile(extensionPath: string, dark: boolean): Gio.File {
  return Gio.File.new_for_path(`${extensionPath}/${logoAsset(dark)}`)
}
```

- [ ] **Step 4: Strip what the banner now carries out of `_identity`**

Replace the whole `_identity` function with:

```ts
// The name and version live in the banner above, so this group carries only
// the facts that have nowhere else to go — and no title, which would repeat
// the name a second time on the same page.
function _identity(window: Adw.PreferencesWindow): Adw.PreferencesGroup {
  const group = new Adw.PreferencesGroup()

  group.add(new Adw.ActionRow({ title: 'Author', subtitle: ABOUT.author }))
  group.add(new Adw.ActionRow({ title: 'Licence', subtitle: ABOUT.license }))
  group.add(_linkRow(window, 'GitHub', ABOUT.repoUrl))
  group.add(_linkRow(window, 'Report an issue', ABOUT.issuesUrl))

  return group
}
```

- [ ] **Step 5: Run the tests and the typecheck**

```bash
/home/fsevenm/projects/dasbo-island/node_modules/.bin/vitest run --root /home/fsevenm/projects/dasbo-island-logo
cd /home/fsevenm/projects/dasbo-island-logo && /home/fsevenm/projects/dasbo-island/node_modules/.bin/tsc --noEmit -p tsconfig.json
```

Expected: all tests PASS; `tsc` exits 0. `test/prefs/aboutPage.test.ts`'s existing `renders each fact from the record` test still passes — `_identity` keeps reading `ABOUT.author`, `ABOUT.license`, `ABOUT.repoUrl`, and `ABOUT.issuesUrl`, and the other two fields are read by `_support`.

- [ ] **Step 6: Commit**

```bash
cd /home/fsevenm/projects/dasbo-island-logo
git add src/prefs/about.ts test/prefs/aboutPage.test.ts
git commit -m "feat(prefs): head the About page with the mark, name, and version"
```

---

### Task 5: Gates, changelog, and the built bundle

**Files:**
- Modify: `CHANGELOG.md` (the `### Added` list under `## [Unreleased]`)

**Interfaces:**
- Consumes: everything above.
- Produces: a `dist/` proving the assets ship.

- [ ] **Step 1: Run every gate the CI runs**

```bash
cd /home/fsevenm/projects/dasbo-island-logo
/home/fsevenm/projects/dasbo-island/node_modules/.bin/vitest run --root /home/fsevenm/projects/dasbo-island-logo
/home/fsevenm/projects/dasbo-island/node_modules/.bin/tsc --noEmit -p tsconfig.json
/home/fsevenm/projects/dasbo-island/node_modules/.bin/tsc --noEmit -p tsconfig.test.json
/home/fsevenm/projects/dasbo-island/node_modules/.bin/tsc --noEmit -p tsconfig.site.json
node build.mjs
```

Expected: tests green, three silent typechecks, and `built dist/ and dist-site/`.

- [ ] **Step 2: Confirm the assets actually landed in the bundle**

```bash
ls /home/fsevenm/projects/dasbo-island-logo/dist/assets
```

Expected: `logo-dark.svg  logo-light.svg  qr-code.png`. If the logos are missing, `build.mjs`'s `cp('src/assets', 'dist/assets')` did not run — nothing at runtime would report this, which is the whole reason for the check.

- [ ] **Step 3: Add the changelog entry**

In `CHANGELOG.md`, append to the `### Added` list under `## [Unreleased]`:

```markdown
- The project mark in the popup header and at the top of the preferences
  About page, in the variant matching the current light or dark theme.
```

- [ ] **Step 4: Commit**

```bash
cd /home/fsevenm/projects/dasbo-island-logo
git add CHANGELOG.md
git commit -m "docs: note the logo in the changelog"
```

- [ ] **Step 5: Remove the toolchain symlink before the merge**

```bash
rm -f /home/fsevenm/projects/dasbo-island-logo/node_modules
git -C /home/fsevenm/projects/dasbo-island-logo status --short
```

Expected: empty output. `dist/` and `dist-site/` are gitignored; anything else showing here belongs in a commit or should not exist.

---

## Smoke test (operator, on a real session)

Nothing above builds a widget, so both theme swaps are unverified until a human looks at them.

1. Install and reload: `make install` (or copy `dist/` to `~/.local/share/gnome-shell/extensions/dasbo-island@ayubaswad.gmail.com/`), then log out and back in — GNOME Shell 46 on Wayland cannot restart in place.
2. Open the panel popup: the mark sits left of "Dasbo Island", the same visual weight as the gear at the other end.
3. Open Preferences → About: the mark heads the page at 96px, with the name and version under it, and neither appears twice further down.
4. With both on screen, run `gsettings set org.gnome.desktop.interface color-scheme 'prefer-light'` and then `'prefer-dark'`. Both marks must re-resolve in place — a mark that fades to near-invisible means its watcher is not connected.
