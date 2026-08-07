# Taller Settings Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the About page's Support section visible without scrolling, by giving the preferences window a default size and trimming the About banner.

**Architecture:** The window's default size becomes a constant record in `src/core/prefsWindow.ts` — `src/core` is the GJS-free half of this codebase, the only half a vitest test can import, which is why `src/core/about.ts` already exists for the same reason. `src/prefs.ts` reads that record and calls `set_default_size` before adding any page. `src/prefs/about.ts` shrinks its banner logo and margins so the page needs less of that height in the first place.

**Tech Stack:** TypeScript compiled by esbuild (`npm run build`), GNOME Shell 46 / GJS with libadwaita (Adw) and GTK 4 bindings, vitest for tests.

## Global Constraints

- Target platform is GNOME Shell 46 (`metadata.json` `shell-version: ["46"]`), GTK 4, libadwaita 1.
- No GTK exists under vitest. `src/prefs.ts` and `src/prefs/*.ts` import `gi://` modules and **cannot be imported by a test**. Tests for those files read them as text with `readFileSync` — see `test/prefs/aboutPage.test.ts`.
- `src/core/*` must stay free of `gi://` imports so it remains importable by tests.
- Values the About page renders live in `src/core`, never as literals at the GJS call site.
- British spelling in user-facing copy and comments (`colour`, `behaviour`, `licence`) — matches existing source.
- Prettier-ish house style in this repo: no semicolons, single quotes, 2-space indent, 110-ish column width.
- Commit messages use Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`) with a lowercase subject.

---

### Task 1: The window-size record and its test

**Files:**
- Create: `src/core/prefsWindow.ts`
- Create: `test/core/prefsWindow.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `PREFS_WINDOW: { readonly width: 600; readonly height: 700 }`, exported from `src/core/prefsWindow.ts`. Task 2 imports it as `import { PREFS_WINDOW } from './core/prefsWindow.js'`.

- [ ] **Step 1: Write the failing test**

Create `test/core/prefsWindow.test.ts` with exactly this content:

```ts
import { describe, it, expect } from 'vitest'
import { PREFS_WINDOW } from '../../src/core/prefsWindow.js'

// The window this describes is built in src/prefs.ts, which imports gi:// and
// so cannot be reached from here — the same wall test/core/about.test.ts
// exists on the other side of. What is checkable is the number itself, and
// the number is the whole fix: too small and the About page's Support group
// goes back under the fold, which is the bug.
describe('the preferences window size', () => {
  it('is a whole number of pixels in both dimensions', () => {
    // A fractional or negative size is not a size GTK can honour, and
    // set_default_size would silently take the truncated value.
    for (const [key, value] of Object.entries(PREFS_WINDOW)) {
      expect(Number.isInteger(value), `${key} must be a whole number`).toBe(true)
      expect(value, `${key} must be positive`).toBeGreaterThan(0)
    }
  })

  it('is tall enough for the About page, Support group included', () => {
    // The About page measures roughly 560-600px once the banner is trimmed.
    // Below 640 the Support group returns to living below the fold, which is
    // precisely what this constant exists to prevent.
    expect(PREFS_WINDOW.height).toBeGreaterThanOrEqual(640)
  })

  it('stays a height a laptop can actually give it', () => {
    // Above this, GTK's clamp against the monitor work area decides the real
    // height and the constant stops describing what the user gets.
    expect(PREFS_WINDOW.height).toBeLessThanOrEqual(900)
  })

  it("is wider than libadwaita's own minimum for a preferences window", () => {
    // AdwPreferencesWindow requests 360px; a default narrower than that would
    // be ignored, which is a constant that lies.
    expect(PREFS_WINDOW.width).toBeGreaterThanOrEqual(360)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run test/core/prefsWindow.test.ts`

Expected: FAIL — `Failed to resolve import "../../src/core/prefsWindow.js"`, because the module does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Create `src/core/prefsWindow.ts` with exactly this content:

```ts
/**
 * The preferences window's opening size.
 *
 * Here rather than at the call site for the same reason src/core/about.ts is:
 * src/prefs.ts imports gi:// bindings no test in this repo can reach past, so
 * a number typed into fillPreferencesWindow ships unchecked. This record is
 * importable, and test/core/prefsWindow.test.ts holds it to a range.
 *
 * 700 because the About page runs to roughly 560-600px — banner, four identity
 * rows, and the Support group — and the whole point of setting a size at all is
 * that the Support group opens above the fold, with room for a row or two more
 * before that stops being true. Neither the shell's ExtensionPrefsDialog nor
 * libadwaita sets one, so without this the window opens at whatever natural
 * size the content works out to, which was too short.
 *
 * On a screen with less than 700px of work area, GTK4's
 * gtk_window_compute_default_size clamps this against the monitor, so a short
 * screen gets "as tall as fits" rather than a window running off the bottom.
 * That clamp is why this is a constant and not a calculation: the platform
 * already does the arithmetic, and doing it here would mean guessing which
 * monitor the window opens on before it is mapped.
 */
export const PREFS_WINDOW = { width: 600, height: 700 } as const
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run test/core/prefsWindow.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/prefsWindow.ts test/core/prefsWindow.test.ts
git commit -m "feat(core): pin the preferences window's opening size"
```

---

### Task 2: The window uses that size

**Files:**
- Modify: `src/prefs.ts` (import block at lines 1-17, and `fillPreferencesWindow` at lines 20-27)
- Test: `test/prefs/aboutPage.test.ts` (append a new `it` inside the existing `describe`)

**Interfaces:**
- Consumes: `PREFS_WINDOW` from Task 1.
- Produces: nothing further tasks depend on.

- [ ] **Step 1: Write the failing test**

In `test/prefs/aboutPage.test.ts`, add this test immediately after the existing `it('is added to the preferences window, after the other three', ...)` block. The file already defines `const prefs = readFileSync('src/prefs.ts', 'utf8')` at the top of the `describe` — reuse it, do not re-read the file.

```ts
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
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run test/prefs/aboutPage.test.ts`

Expected: FAIL on `opens the window at the size the core record names` — `expected '...' to contain 'PREFS_WINDOW'`.

- [ ] **Step 3: Write the minimal implementation**

In `src/prefs.ts`, add the import after the existing `aboutPage` import (currently line 17):

```ts
import { aboutPage } from './prefs/about.js'
import { PREFS_WINDOW } from './core/prefsWindow.js'
```

Then replace the body of `fillPreferencesWindow` (currently lines 20-27) with:

```ts
  fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> | void {
    const settings = this.getSettings()

    // The default size, not a size request: a user who resizes the window
    // keeps their size, and libadwaita's own minimums still apply. Neither the
    // shell's ExtensionPrefsDialog nor libadwaita sets one, so without this
    // the window opened at its natural size — too short for the About page,
    // whose Support group ended up below the fold.
    window.set_default_size(PREFS_WINDOW.width, PREFS_WINDOW.height)

    window.add(this._appearancePage(settings))
    window.add(this._behaviourPage(settings))
    window.add(this._agentsPage(settings, window))
    window.add(aboutPage(window, this.path, this._version()))
  }
```

- [ ] **Step 4: Run the tests and the typecheck, and verify they pass**

Run: `npx vitest run test/prefs/aboutPage.test.ts && npm run typecheck`

Expected: vitest PASS (the existing tests plus the new one); typecheck exits 0 with no output.

- [ ] **Step 5: Commit**

```bash
git add src/prefs.ts test/prefs/aboutPage.test.ts
git commit -m "fix(prefs): open the settings window tall enough for the About page"
```

---

### Task 3: The trimmed banner

**Files:**
- Modify: `src/prefs/about.ts` (`_banner`, lines 27-85 — the `Gtk.Box` at lines 30-36 and `image.pixel_size` at line 49)
- Test: `test/prefs/aboutPage.test.ts` (append a new `it` inside the existing `describe`)

**Interfaces:**
- Consumes: nothing from earlier tasks. Independent of Tasks 1 and 2 in code; together they are the fix.
- Produces: nothing further tasks depend on.

- [ ] **Step 1: Write the failing test**

In `test/prefs/aboutPage.test.ts`, add this test immediately after the existing `it('puts the mark in the box, above the name', ...)` block. Reuse the `page` constant already defined at the top of the `describe`.

```ts
  it('keeps the banner within its height budget', () => {
    // The banner is what the rest of the page has to fit underneath. At 96px
    // and 24/12 margins it spent ~200px before the first row, and the Support
    // group at the bottom fell below the fold. An edit putting either number
    // back reintroduces that bug and breaks no other test.
    expect(page).toContain('image.pixel_size = 64')
    expect(page).toMatch(/margin_top:\s*12,/)
    expect(page).toMatch(/margin_bottom:\s*6,/)
  })
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run test/prefs/aboutPage.test.ts`

Expected: FAIL on `keeps the banner within its height budget` — `expected '...' to contain 'image.pixel_size = 64'`.

- [ ] **Step 3: Write the minimal implementation**

In `src/prefs/about.ts`, in `_banner`, change the box's margins (currently lines 30-36) from:

```ts
  const box = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 6,
    margin_top: 24,
    margin_bottom: 12,
    halign: Gtk.Align.CENTER,
  })
```

to:

```ts
  // Tight margins and a 64px mark below, not the 96/24/12 this started at:
  // the banner is the page's height budget, and everything under it — four
  // identity rows and the Support group — has to fit in what is left. See
  // docs/superpowers/specs/2026-08-07-taller-settings-window-design.md.
  const box = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 6,
    margin_top: 12,
    margin_bottom: 6,
    halign: Gtk.Align.CENTER,
  })
```

Then change the image size (currently line 49) from:

```ts
    image.pixel_size = 96
```

to:

```ts
    image.pixel_size = 64
```

Leave the comment above `Gtk.Image.new_from_gicon` untouched — it explains why this is a `Gtk.Image` with `pixel_size` rather than a `Gtk.Picture`, and that reasoning is unchanged.

- [ ] **Step 4: Run the full suite and the typecheck, and verify they pass**

Run: `npm test && npm run typecheck`

Expected: vitest PASS across every file; typecheck exits 0 with no output.

- [ ] **Step 5: Commit**

```bash
git add src/prefs/about.ts test/prefs/aboutPage.test.ts
git commit -m "fix(prefs): trim the About banner so the Support group fits"
```

---

### Task 4: Changelog and build check

**Files:**
- Modify: `CHANGELOG.md` (the `### Fixed` list under `## [Unreleased]`, which currently starts at line 39)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Add the changelog entry**

In `CHANGELOG.md`, append this bullet to the end of the `### Fixed` list under `## [Unreleased]` — after the existing entry that begins "The About page's QR picture is pinned…" and before the `[Unreleased]:` link definition at the bottom:

```markdown
- The preferences window opens tall enough to show the About page's support
  section without scrolling, and that page's banner is trimmed to earn back the
  room it needs.
```

- [ ] **Step 2: Verify the extension still builds**

Run: `npm run build`

Expected: exits 0. `dist/prefs.js` is rewritten — confirm the new constant made it through the bundler:

Run: `grep -c "700" dist/prefs.js`

Expected: at least `1`. (esbuild inlines nothing here; the record is bundled into `dist/prefs.js` because `src/prefs.ts` is an entry point.)

- [ ] **Step 3: Run the full suite one last time**

Run: `npm test && npm run typecheck`

Expected: vitest PASS across every file; typecheck exits 0.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: note the taller settings window in the changelog"
```

---

## Manual verification (after all tasks)

Nothing above renders a window, so the fix itself is confirmed by eye:

```bash
make install
gnome-extensions prefs dasbo-island@ayubaswad.gmail.com
```

Click to the **About** tab. The "Buy me a coffee" button must be visible without scrolling.

The preferences dialog imports `prefs.js` from disk every time it opens, so no GNOME Shell restart is needed for this check — closing and reopening the dialog picks up a rebuild. (A shell restart *is* needed for changes to `extension.js`, but this plan touches none.)
