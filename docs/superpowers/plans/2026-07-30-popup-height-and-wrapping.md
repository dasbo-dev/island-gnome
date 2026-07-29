# Full text in the popup, and a popup that scrolls — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Option descriptions and task subjects wrap instead of truncating, and the popup grows to fit them up to 90% of the monitor's work area, scrolling past that.

**Architecture:** The session rows move into a `PopupMenu.PopupMenuSection` inside one `St.ScrollView` added to `menu.box`, with the header and separator left pinned above it. The scroll view's `max-height` is computed per popup-open from the monitor work area by a new pure module, `src/core/popupSize.ts`. The two ellipsized labels get the wrapping triple already used elsewhere in the popup, and the task list's own scroll view is deleted so there is exactly one scrollbar.

**Tech Stack:** TypeScript, GNOME Shell 46 extension (St / Clutter / Pango via `gi://`), esbuild, vitest.

**Spec:** `docs/superpowers/specs/2026-07-30-popup-height-and-wrapping-design.md`

## Global Constraints

- Target is GNOME Shell 46 only (`metadata.json` → `"shell-version": ["46"]`). GNOME 46 St API: `St.ScrollView.set_child(child)`, `St.ScrollView.vadjustment`.
- `src/core/**` must never import `gi://` or `resource://` — enforced by `test/core/purity.test.ts`. Anything needing St or GLib lives in `src/shell/**`.
- St's CSS engine does not reliably honour `opacity`; where dimming is needed it is set on the actor or, as here, expressed in Pango markup.
- Pango ignores `line_wrap` while an ellipsize mode is set, so every wrapping label must set `ellipsize = Pango.EllipsizeMode.NONE` explicitly.
- Wrap mode is `Pango.WrapMode.WORD_CHAR`, never `WORD`: popup text carries file paths and flags with no break opportunity in them.
- The popup's content width is fixed at 26em by `.dasbo-fixed-width` in `stylesheet.css`. Wrapping labels depend on that ancestor for their bound; do not change it.
- The monitor work area and the measured chrome (header + separator preferred height) are both read in physical pixels — the same stage coordinate space — while St multiplies CSS lengths such as `max-height` by the theme context's scale factor. `bodyMaxHeight` divides by the scale factor to convert back before writing the style. On Wayland, mutter forces the scale factor to 1 and the work area is already logical, so the division is a no-op; on X11 the work area is physical and the scale factor is N, so the division is what keeps the cap honest. The arithmetic is the same on both — only which side of it happens to be a no-op changes.
- Comments in this codebase record *why*, at the density of the surrounding file. A change that invalidates a neighbouring comment must rewrite that comment in the same commit.
- Commands: `npm test` (vitest), `npm run typecheck` (two tsconfigs), `npm run build` (esbuild → `dist/`).
- Commit style: conventional prefix with a scope, imperative and specific (`fix(shell): …`, `feat(core): …`).

---

### Task 1: `popupSize.ts` — the cap and the focus arithmetic

**Files:**
- Create: `src/core/popupSize.ts`
- Test: `test/core/popupSize.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `MIN_BODY: 120`
  - `bodyMaxHeight(o: { workAreaHeight: number; chromeHeight: number; scaleFactor: number; fraction?: number }): number`
  - `scrollIntoView(o: { value: number; pageSize: number; childY: number; childHeight: number }): number`

- [ ] **Step 1: Write the failing test**

Create `test/core/popupSize.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { bodyMaxHeight, scrollIntoView, MIN_BODY } from '../../src/core/popupSize.js'

describe('bodyMaxHeight', () => {
  it('takes 90% of the work area less the chrome', () => {
    expect(bodyMaxHeight({ workAreaHeight: 1000, chromeHeight: 100, scaleFactor: 1 })).toBe(800)
  })

  it('honours an explicit fraction', () => {
    expect(
      bodyMaxHeight({ workAreaHeight: 1000, chromeHeight: 0, scaleFactor: 1, fraction: 0.5 })
    ).toBe(500)
  })

  // The work area is in physical pixels while St multiplies CSS lengths — such
  // as max-height — by the scale factor, so an unscaled max-height would let
  // the body grow to twice the cap on a 2x monitor.
  it('divides by the scale factor', () => {
    expect(bodyMaxHeight({ workAreaHeight: 1000, chromeHeight: 100, scaleFactor: 2 })).toBe(400)
  })

  it('returns whole pixels', () => {
    expect(bodyMaxHeight({ workAreaHeight: 1001, chromeHeight: 0, scaleFactor: 1 })).toBe(900)
  })

  it('floors at MIN_BODY when the chrome eats the whole cap', () => {
    expect(bodyMaxHeight({ workAreaHeight: 200, chromeHeight: 1000, scaleFactor: 1 })).toBe(MIN_BODY)
  })

  it('treats an unusable scale factor as 1 rather than dividing by zero', () => {
    expect(bodyMaxHeight({ workAreaHeight: 1000, chromeHeight: 100, scaleFactor: 0 })).toBe(800)
    expect(bodyMaxHeight({ workAreaHeight: 1000, chromeHeight: 100, scaleFactor: NaN })).toBe(800)
  })
})

describe('scrollIntoView', () => {
  it('leaves a fully visible child alone', () => {
    expect(scrollIntoView({ value: 0, pageSize: 200, childY: 10, childHeight: 20 })).toBe(0)
  })

  it('scrolls up to a child above the viewport', () => {
    expect(scrollIntoView({ value: 100, pageSize: 200, childY: 40, childHeight: 20 })).toBe(40)
  })

  it('scrolls down until a child below the viewport is flush with the bottom', () => {
    expect(scrollIntoView({ value: 0, pageSize: 200, childY: 300, childHeight: 50 })).toBe(150)
  })

  it('aligns a child taller than the page to its top', () => {
    expect(scrollIntoView({ value: 0, pageSize: 100, childY: 300, childHeight: 400 })).toBe(300)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/core/popupSize.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/popupSize.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/core/popupSize.ts`:

```ts
/**
 * The popup's own height budget, kept pure so it can be tested without a Shell.
 *
 * A plain `PopupMenu` does not scroll in GNOME Shell 46, so `island.ts` puts the
 * session rows in an `St.ScrollView` and caps it. What to cap it at is arithmetic
 * over three numbers the Shell reports, which is this module.
 */

/**
 * Never let a computed cap collapse the body to nothing. The chrome is measured
 * rather than assumed, so an oversized font — or a second pinned row added later
 * — could otherwise produce a cap of zero, which St would honour by drawing
 * nothing at all.
 */
export const MIN_BODY = 120

const DEFAULT_FRACTION = 0.9

export interface BodyMaxHeightInput {
  /** Monitor work area height in physical pixels, excluding the top bar. */
  workAreaHeight: number
  /** Height of everything pinned outside the scroll view: header + separator. */
  chromeHeight: number
  /** St.ThemeContext's scale factor. */
  scaleFactor: number
  /** Share of the work area the whole popup may occupy. */
  fraction?: number
}

/**
 * The scroll view's `max-height`, in CSS pixels.
 *
 * The division by the scale factor is not cosmetic: the work area (and the
 * measured chrome, which is in the same stage coordinate space) is in physical
 * pixels, while St multiplies CSS lengths — such as this max-height — by the
 * theme context's scale factor. An unscaled value would let the body grow to
 * twice the intended cap on a 2x monitor — precisely the clipping the cap
 * exists to prevent. A scale factor of 0 or NaN is read as 1: a slightly
 * generous cap beats a division by zero.
 */
export function bodyMaxHeight(o: BodyMaxHeightInput): number {
  const fraction = o.fraction ?? DEFAULT_FRACTION
  const scale = Number.isFinite(o.scaleFactor) && o.scaleFactor > 0 ? o.scaleFactor : 1
  const physical = o.workAreaHeight * fraction - o.chromeHeight
  return Math.max(MIN_BODY, Math.floor(physical / scale))
}

export interface ScrollIntoViewInput {
  /** Current `vadjustment.value`. */
  value: number
  /** Current `vadjustment.page_size` — the visible height. */
  pageSize: number
  /** The child's y within the scrolled box, not on screen. */
  childY: number
  childHeight: number
}

/**
 * The `vadjustment.value` that brings a child into view, or the current value if
 * it is already fully visible.
 *
 * Clamps rather than centres: a child above the viewport scrolls to its top, one
 * below scrolls until its bottom is flush, and one taller than the page aligns to
 * its top — scrolling to such a child's bottom would push its head off the other
 * edge, which for a focused button is worse than showing its first line.
 */
export function scrollIntoView(o: ScrollIntoViewInput): number {
  const top = o.childY
  const bottom = o.childY + o.childHeight
  if (top < o.value) return top
  if (bottom > o.value + o.pageSize) {
    if (o.childHeight >= o.pageSize) return top
    return bottom - o.pageSize
  }
  return o.value
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/core/popupSize.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/core/popupSize.ts test/core/popupSize.test.ts
git commit -F - <<'EOF'
feat(core): work out how tall the popup's body may be

A plain PopupMenu does not scroll in GNOME Shell 46, so the rows are about
to move into a capped St.ScrollView. bodyMaxHeight turns the monitor work
area, the pinned chrome and the scale factor into that cap; scrollIntoView
turns a focused child's position into a vadjustment value. Both pure, so
the arithmetic — including the scale division St would otherwise apply
twice — is covered by tests rather than by a re-login.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: `optionMarkup` — one flowing line per option

**Files:**
- Modify: `src/core/questions.ts` (append; existing exports untouched)
- Test: `test/core/questions.test.ts` (append a describe block)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `escapeMarkup(s: string): string`
  - `optionMarkup(label: string, description: string): string` — returns `<b>Label</b> — <span alpha="70%">desc</span>`, or `<b>Label</b>` when the description is empty.

- [ ] **Step 1: Write the failing test**

Append to `test/core/questions.test.ts`:

```ts
describe('escapeMarkup', () => {
  it('escapes the three characters Pango parses', () => {
    expect(escapeMarkup('a & b <c> d')).toBe('a &amp; b &lt;c&gt; d')
  })

  // Ampersand first, or the entity introduced for < would itself be escaped.
  it('does not double-escape an existing entity', () => {
    expect(escapeMarkup('&lt;')).toBe('&amp;lt;')
  })

  it('leaves ordinary text alone', () => {
    expect(escapeMarkup('Keep both scrolls')).toBe('Keep both scrolls')
  })
})

describe('optionMarkup', () => {
  it('renders the label bold and the description dimmed behind an em dash', () => {
    expect(optionMarkup('One scroll', 'the popup scrolls once')).toBe(
      '<b>One scroll</b> — <span alpha="70%">the popup scrolls once</span>'
    )
  })

  it('drops the dash and the span when there is no description', () => {
    expect(optionMarkup('One scroll', '')).toBe('<b>One scroll</b>')
  })

  // Both halves are agent-supplied. Unescaped, this would be swallowed as
  // markup or make ClutterText.set_markup throw.
  it('escapes markup in either half', () => {
    expect(optionMarkup('a <b>x</b>', 'r & d')).toBe(
      '<b>a &lt;b&gt;x&lt;/b&gt;</b> — <span alpha="70%">r &amp; d</span>'
    )
  })
})
```

Extend that file's existing import to pull the two new functions in:

```ts
import {
  parseQuestions,
  formatAnswer,
  escapeMarkup,
  optionMarkup,
  type Question,
} from '../../src/core/questions.js'
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/core/questions.test.ts`
Expected: FAIL — `escapeMarkup is not a function` (or a TypeScript-level unresolved export).

- [ ] **Step 3: Write the implementation**

Append to `src/core/questions.ts`:

```ts
/**
 * The three characters Pango's markup parser acts on outside attribute values.
 *
 * Hand-rolled rather than `GLib.markup_escape_text` because `src/core` may not
 * import `gi://` (see test/core/purity.test.ts), and because escaping this way is
 * covered by tests. The ampersand is replaced first, or the entities introduced
 * for `<` and `>` would themselves be escaped.
 */
export function escapeMarkup(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * One option as a single line of Pango markup: the label bold, the description
 * dimmed behind an em dash.
 *
 * One label rather than a bold one beside a dim one, because the popup's width is
 * fixed at 26em and a description wrapped inside its own right-hand column would
 * break every two or three words.
 *
 * `alpha` is a Pango span attribute rather than a hex colour, so the dimming
 * survives a light theme. It replaces the actor-level `opacity = 178` the old
 * description label carried, which cannot be reused now that one label holds both
 * halves — dimming the actor would dim the bold label with it. A Pango that
 * ignores `alpha` renders the description at full strength, which costs
 * hierarchy, not information.
 *
 * Both halves come from an agent's `AskUserQuestion` payload, so both are
 * escaped: a description containing `<b>` would otherwise be swallowed as markup
 * or make `set_markup` throw.
 */
export function optionMarkup(label: string, description: string): string {
  const bold = `<b>${escapeMarkup(label)}</b>`
  if (description.length === 0) return bold
  return `${bold} — <span alpha="70%">${escapeMarkup(description)}</span>`
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/core/questions.test.ts`
Expected: PASS, including the 6 new cases.

- [ ] **Step 5: Verify purity and types still hold**

Run: `npx vitest run test/core/purity.test.ts && npm run typecheck`
Expected: PASS, then no output and exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/core/questions.ts test/core/questions.test.ts
git commit -F - <<'EOF'
feat(core): render an option as one line of markup

An option's description is ellipsized today because it sits in its own
narrow column beside the label. optionMarkup makes the pair a single
wrapped sentence instead — label bold, description dimmed with Pango's
alpha attribute so a light theme still reads. Both halves are agent
supplied, so both are escaped: unescaped, a description containing <b>
would be swallowed as markup or make set_markup throw.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: One capped, scrollable body in `island.ts`

Do this before removing the task list's own scroll view (Task 5), so the popup is never briefly unbounded.

**Files:**
- Modify: `src/shell/island.ts`

**Interfaces:**
- Consumes: `bodyMaxHeight`, `scrollIntoView` from `src/core/popupSize.js` (Task 1).
- Produces: rows are parented to `this._body` (a `PopupMenu.PopupMenuSection`), not to `this.menu`. Later tasks add nothing here.

- [ ] **Step 1: Import the new module**

In `src/shell/island.ts`, beside the other `../core/` imports:

```ts
import { bodyMaxHeight, scrollIntoView } from '../core/popupSize.js'
```

- [ ] **Step 2: Add the fields**

Beside `private _separator!: PopupMenu.PopupSeparatorMenuItem`:

```ts
    private _body!: PopupMenu.PopupMenuSection
    private _scroll!: St.ScrollView
    /** Stage focus watch, live only while the popup is open. */
    private _keyFocusId = 0
```

- [ ] **Step 3: Build the scroll view in the constructor**

Directly after the two existing `addMenuItem` calls for the header and separator:

```ts
      // The rows live in one scroll view so the popup can be bounded without
      // bounding what any row is allowed to say. menu.box is a plain
      // St.BoxLayout and a plain PopupMenu does not scroll in GNOME Shell 46 —
      // only PopupSubMenu.actor is an St.ScrollView — so the scrolling has to be
      // added here. A PopupMenuSection inside it keeps addMenuItem working
      // exactly as menu.addMenuItem does, so SessionRow and EmptyRow are
      // unchanged; the header and separator stay direct menu items above it, so
      // the preferences gear is still reachable with a long list of sessions.
      this._body = new PopupMenu.PopupMenuSection()
      this._scroll = new St.ScrollView({
        x_expand: true,
        // NEVER: nothing in the popup wraps sideways, so there is nothing to
        // scroll to, and a horizontal bar would only steal height from the
        // vertical budget this whole arrangement exists to spend.
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.AUTOMATIC,
        // GNOME 46's own PopupSubMenu sets this on its St.ScrollView too: without
        // it, rows can paint outside the capped viewport during the popup's open
        // animation.
        clip_to_allocation: true,
      })
      this._scroll.set_child(this._body.actor)
      ;(this.menu as PopupMenu.PopupMenu).box.add_child(this._scroll)
```

- [ ] **Step 4: Move the rows into the section**

Three call sites in `_rebuildRows` change. The session row:

```ts
          this._rows.set(s.key, row)
          this._body.addMenuItem(row)
```

The empty row:

```ts
      if (sessions.length === 0 && !this._emptyRow) {
        this._emptyRow = new EmptyRow()
        this._body.addMenuItem(this._emptyRow)
      } else if (sessions.length > 0 && this._emptyRow) {
```

Leave the header and separator `addMenuItem` calls in the constructor pointing at `this.menu`.

- [ ] **Step 5: Compute and apply the cap**

Add these two methods beside `_applyPause`:

```ts
    /**
     * Bound the body to a share of the monitor it is opening on.
     *
     * Recomputed per open rather than watched: that covers a monitor swap, a
     * resolution change and a font-scale change with no extra signal
     * connections, and the work area cannot change under an already-open popup
     * in a way the reader would notice. Expanding a row inside an
     * already-capped scroll view needs no recomputation at all.
     */
    private _applyBodyCap(): void {
      const found = Main.layoutManager.findIndexForActor(this)
      // findIndexForActor can hand back a stale or invalid index mid
      // monitors-changed; the primary monitor is a better guess than none.
      const index = found >= 0 ? found : Main.layoutManager.primaryIndex
      const workAreaHeight = Main.layoutManager.getWorkAreaForMonitor(index)?.height ?? 0
      // Nothing to measure against. The previous cap is a better guess than any
      // number invented here, so write no style at all rather than clamping the
      // popup to MIN_BODY.
      if (workAreaHeight <= 0) return
      // get_preferred_height, not .height: this runs on the first open too,
      // before either item has been allocated, where .height still reads 0.
      const [, headerHeight] = this._header.get_preferred_height(-1)
      const [, separatorHeight] = this._separator.get_preferred_height(-1)
      const scaleFactor = St.ThemeContext.get_for_stage(global.get_stage()).scale_factor
      const px = bodyMaxHeight({
        workAreaHeight,
        chromeHeight: headerHeight + separatorHeight,
        scaleFactor,
      })
      // Inline rather than in the stylesheet: the number depends on the monitor.
      this._scroll.style = `max-height: ${px}px`
    }

    /**
     * Scroll a keyboard-focused control into view.
     *
     * Jump, Allow/Deny/Always and every option button is focusable, so Tab can
     * reach one below the fold; without this the focus ring lands somewhere the
     * reader cannot see. Watched on the stage rather than connected to the
     * scroll view: Clutter emits key-focus-in on the actor that gains focus, not
     * on its ancestors, so a handler on the scroll view would never fire.
     *
     * Deliberately not the Shell's own ensureActorVisibleInScrollView: it lives
     * behind a private resource path that has already moved once between
     * releases, and the arithmetic it would save is the part worth testing.
     */
    private _revealFocus(): void {
      const focus = global.get_stage().get_key_focus()
      if (!focus) return
      const body = this._body.actor
      if (!body.contains(focus)) return
      const [, bodyY] = body.get_transformed_position()
      const [, focusY] = focus.get_transformed_position()
      const adjustment = this._scroll.vadjustment
      // The body's own transformed position already carries the current scroll
      // offset, so the difference is the child's y within the box.
      adjustment.value = scrollIntoView({
        value: adjustment.value,
        pageSize: adjustment.page_size,
        childY: focusY - bodyY,
        childHeight: focus.height,
      })
    }

    private _watchKeyFocus(): void {
      if (this._keyFocusId) return
      this._keyFocusId = global
        .get_stage()
        .connect('notify::key-focus', () => this._revealFocus())
    }

    private _unwatchKeyFocus(): void {
      if (!this._keyFocusId) return
      global.get_stage().disconnect(this._keyFocusId)
      this._keyFocusId = 0
    }
```

- [ ] **Step 6: Hook both to the popup's open state**

Replace the body of the existing `open-state-changed` handler:

```ts
        (_menu, open) => {
          if (open) {
            this._applyBodyCap()
            this._watchKeyFocus()
            this._startTimer()
          } else {
            this._unwatchKeyFocus()
            this._stopTimer()
          }
        }
```

- [ ] **Step 7: Release the stage handler, the session-mode handler, and destroy the new actors**

In `_releaseExternalRefs`, beside `this._stopTimer()` — `global.get_stage()` outlives this widget, so a Clutter-side destroy must drop this too:

```ts
      this._unwatchKeyFocus()
      this._stopTimer()
```

Immediately after those two lines, release `_body`'s own external connection:

```ts
      // PopupMenuBase's constructor connects this._body to Main.sessionMode,
      // and only PopupMenuBase.destroy() releases it — but a Clutter-side
      // destroy reaches _releaseExternalRefs(), not destroy(), and this._body
      // is never destroyed there either (menu.removeAll() filters menu.box's
      // children by _delegate, which skips the scroll view and the section
      // inside it). Left alone, that's a permanent Main.sessionMode handler
      // pointing at a section whose actor is gone. Dropping only the external
      // reference here, and leaving this._body's own teardown in destroy(),
      // keeps this a no-op cleanup rather than reaching into destroy()'s
      // ordering: destroy() calls this before destroying the SessionRows, so
      // destroying this._body from here would pull the row actors out from
      // under the later row.destroy() calls. A second disconnectObject for
      // the same object during PopupMenuBase.destroy() is a harmless no-op.
      Main.sessionMode.disconnectObject(this._body)
```

`this._body` is a `PopupMenu.PopupMenuSection`, a `PopupMenuBase`, so it inherits
this connection the moment its constructor runs — nothing in this plan makes it,
and nothing but `PopupMenuBase.destroy()` would otherwise release it.

In `destroy()`, beside the header and separator:

```ts
      this._header.destroy()
      this._separator.destroy()
      this._body.destroy()
      this._scroll.destroy()
```

- [ ] **Step 8: Typecheck, test and build**

Run: `npm run typecheck && npm test && npm run build`
Expected: exit 0, all existing suites pass, `dist/extension.js` written.

- [ ] **Step 9: Verify in a live Shell**

Run: `make install`, then log out and back in (Wayland gives no in-session reload).
Expected: the popup looks as it does today with a few sessions. With enough sessions to exceed the screen, a scrollbar appears at the right of the rows while "Dasbo Island" and the gear stay put. Tab from the gear downwards scrolls hidden buttons into view.

- [ ] **Step 10: Commit**

```bash
git add src/shell/island.ts
git commit -F - <<'EOF'
feat(shell): give the popup one scrollbar and a height budget

menu.box is a plain BoxLayout and a plain PopupMenu does not scroll in
GNOME Shell 46, so the popup could only be bounded by bounding its
content. The rows move into a PopupMenuSection inside one St.ScrollView,
capped per open at 90% of the work area the popup is opening on, with the
header and separator left pinned above it. A stage focus watch scrolls a
tabbed-to button back into view, since Clutter emits key-focus-in on the
focused actor rather than on its ancestors.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 4: An option reads as one wrapped sentence

**Files:**
- Modify: `src/shell/questionPanel.ts`
- Modify: `stylesheet.css`

**Interfaces:**
- Consumes: `optionMarkup` from `src/core/questions.js` (Task 2).
- Produces: nothing new. `optionButton`'s signature is unchanged.

- [ ] **Step 1: Import `optionMarkup`**

Extend the existing import at the top of `src/shell/questionPanel.ts`:

```ts
import { formatAnswer, optionMarkup } from '../core/questions.js'
```

- [ ] **Step 2: Replace the two-label option with one wrapped label**

`optionButton`'s first half becomes:

```ts
  private optionButton(q: Question, label: string, description: string): St.Button {
    const text = new St.Label({ x_expand: true })
    // One label, not a bold one beside a dim one: the popup's width is fixed at
    // 26em, and a description wrapped inside its own right-hand column would
    // break every two or three words. The bold and the dimming come from Pango
    // markup instead — see optionMarkup, which also escapes both halves.
    text.clutter_text.set_markup(optionMarkup(label, description))
    // The same wrapping triple the question prompt and the row's activity label
    // carry. ellipsize must be NONE explicitly: Pango ignores line_wrap while an
    // ellipsize mode is set, which would silently yield one truncated line.
    // WORD_CHAR, not WORD: a description can hold a path or a flag with no break
    // opportunity in it, which under WORD would overhang the fixed width.
    text.clutter_text.line_wrap = true
    text.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR
    text.clutter_text.ellipsize = Pango.EllipsizeMode.NONE

    const button = new St.Button({ style_class: 'dasbo-question-option', can_focus: true,
      x_expand: true, child: text })
```

The `clicked` handler below it is unchanged. Nothing else in the file references the removed `inner`, `name` or `desc` locals.

- [ ] **Step 3: Correct the class comment this invalidates**

The class comment on `QuestionPanel` says option labels "neither wrap nor shrink". Replace that clause so the panel's full-width line keeps a true reason:

```ts
 * plain owner of St actors so it can be attached to and detached from a
 * SessionRow's question box — its own full-width line beneath the row, because
 * an option is a wrapped sentence and beside the activity label the two would
 * starve each other.
```

This step named only `questionPanel.ts`'s own class comment. That was incomplete:
`sessionRow.ts`'s `_questionBox` carries a near-duplicate of the same claim —
"option labels neither wrap nor shrink" — as the reason `_questionBox` gets its
own full-width line, and this step left it standing. A post-review fix caught
it and rewrote it to the same reason this step gives `questionPanel.ts`, while
keeping the rest of that comment (the `ClutterBoxLayout` spacing note) intact.

- [ ] **Step 4: Drop the two dead rules**

In `stylesheet.css`, delete these two lines — the bold and the 0.9em they carried now live in the markup, and the labels they targeted no longer exist:

```css
.dasbo-question-label { font-weight: bold; padding-right: 8px; }
.dasbo-question-desc { font-size: 0.9em; }
```

`.dasbo-question-option` keeps its padding, `:hover` and `:checked` rules.

- [ ] **Step 5: Typecheck, test and build**

Run: `npm run typecheck && npm test && npm run build`
Expected: exit 0. `test/shell/insensitiveColor.test.ts` still passes — no non-reactive menu item changed.

- [ ] **Step 6: Verify in a live Shell**

Run: `make install`, log out and back in, then trigger an `AskUserQuestion` with long descriptions (this plan's own brainstorm is a good source).
Expected: each option reads as one paragraph wrapped inside the popup, label bold, description dimmer, nothing cut off. Clicking still answers; multi-select still highlights; `Other…` still opens an entry.

- [ ] **Step 7: Commit**

```bash
git add src/shell/questionPanel.ts stylesheet.css
git commit -F - <<'EOF'
fix(shell): stop cutting an option's description in half

The description sat in its own column beside the label with
ellipsize: END, so the text you choose between was the text being
truncated. One label now holds both halves as a wrapped sentence, styled
by optionMarkup, and the two stylesheet rules that dressed the old pair
go with them.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 5: Task subjects wrap, and the inner scrollbar goes

**Files:**
- Modify: `src/shell/taskList.ts`
- Modify: `stylesheet.css`
- Test: `test/shell/noEllipsis.test.ts` (create)

**Interfaces:**
- Consumes: the popup-level scroll view from Task 3 — the only remaining bound on a long plan.
- Produces: `TaskList` keeps its public shape (`attachTo`, `detach`, `setExpanded`, `update`, `destroy`), so `island.ts` and `sessionRow.ts` need no change.

That last claim was wrong for `sessionRow.ts`: no *code* there changes, but two of
its *comments* describe facts this task removes. `_taskBox`'s comment says a
collapsed `TaskList`'s "own fold (setExpanded) hides its ScrollView while
leaving it parented here" — true before this task, false after, since
`TaskList` no longer owns a `ScrollView` at all (Step 3 below). And
`src/core/tasks.ts`'s `sameTasks` doc comment says `TaskList` skips its
rebuild "which would otherwise throw the reader's scroll position back to the
top" — the same now-deleted scroll view. Both were missed at the time and
caught in a later review pass:
- `sessionRow.ts`'s `_taskBox` comment now names the widget this task leaves
  behind — "hides its own St.BoxLayout while leaving it parented here" — and
  is otherwise unchanged; it is load-bearing for two other bug fixes, so
  nothing about its length or its conclusion changes.
- `tasks.ts`'s `sameTasks` comment now gives the same reason `taskList.ts`'s
  own `update()` comment gives (Step 4 below): an unconditional rebuild churns
  actors under the *popup's* scroll position and can change the body's
  height, not the list's own (now nonexistent) one.

- [ ] **Step 1: Write the failing test**

Create `test/shell/noEllipsis.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// St has no `text-overflow`, so truncation is a per-label decision made in code.
// Two labels are deliberately never truncated — an option's description and a
// task's subject are the content the reader opened the popup for — and both are
// one careless edit away from being ellipsized again. The popup is bounded at the
// popup level instead (see island.ts), which is also why the task list must not
// carry a scroll view or a max-height of its own: nested scroll views inside a
// popup fight over the mouse wheel.
describe('the popup never truncates an option or a task', () => {
  for (const file of ['src/shell/questionPanel.ts', 'src/shell/taskList.ts']) {
    it(`${file} sets no ellipsize mode other than NONE`, () => {
      const src = readFileSync(file, 'utf8')
      expect(src).not.toContain('EllipsizeMode.END')
      expect(src).not.toContain('EllipsizeMode.START')
      expect(src).not.toContain('EllipsizeMode.MIDDLE')
    })
  }

  it('taskList.ts owns no scroll view', () => {
    expect(readFileSync('src/shell/taskList.ts', 'utf8')).not.toContain('ScrollView')
  })

  it('the stylesheet caps no list inside a row', () => {
    expect(readFileSync('stylesheet.css', 'utf8')).not.toContain('dasbo-tasks-scroll')
  })
})
```

This suite guards only half its invariant as written: every assertion above is
negative (no `EllipsizeMode.END/START/MIDDLE`, no `ScrollView`, no
`dasbo-tasks-scroll`), so deleting `line_wrap = true` or the `line_wrap_mode`
line from either file leaves every one of them green while producing one
unwrapped line that overhangs the popup's fixed 26em width — a different
failure from an ellipsis, and just as bad. A post-review fix strengthened this
suite:
- Added, in the same loop over both files, the positive half of the
  invariant: `expect(src).toContain('line_wrap = true')`,
  `expect(src).toContain('Pango.WrapMode.WORD_CHAR')`, and
  `expect(src).toContain('Pango.EllipsizeMode.NONE')`.
- Strengthened the stylesheet assertion. `not.toContain('dasbo-tasks-scroll')`
  passes if a cap is reintroduced under any other class name, so it gained a
  second assertion matching the shape of the problem rather than its old name:
  `expect(css).not.toMatch(/\.dasbo-task[^{]*\{[^}]*max-height/)`, kept
  alongside the original class-name check since both catch something the
  other does not.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/shell/noEllipsis.test.ts`
Expected: FAIL on three of the four cases — `src/shell/taskList.ts` still contains `EllipsizeMode.END` and `ScrollView`, and the stylesheet still has `dasbo-tasks-scroll`. The `questionPanel.ts` case passes already (Task 4).

- [ ] **Step 3: Drop the scroll view from `TaskList`**

In `src/shell/taskList.ts`, the class head becomes:

```ts
/**
 * The agent's plan, one line per task.
 *
 * Not a GObject class, for the same reason PermissionControls and QuestionPanel
 * are not: it is a plain owner of St actors, attached to and detached from a
 * SessionRow's task box.
 *
 * No scroll view of its own. The popup as a whole scrolls (see island.ts), and a
 * second scroll view nested inside it would fight for the mouse wheel — the
 * pointer's position would decide which one moved, and a list at the bottom of
 * its travel would silently hand the wheel to its parent. A long plan competing
 * for popup height with the other sessions is the honest trade.
 */
export class TaskList {
  private box: St.BoxLayout
  private parent: St.BoxLayout | null = null
  private tasks: AgentTask[] = []

  constructor(tasks: AgentTask[]) {
    this.box = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'dasbo-tasks' })
    this.render(tasks)
  }

  attachTo(parent: St.BoxLayout): void {
    if (this.parent) return
    this.parent = parent
    parent.add_child(this.box)
  }

  detach(): void {
    if (!this.parent) return
    this.parent.remove_child(this.box)
    this.parent = null
  }

  /** Collapsed hides the whole list; the row keeps its counter. */
  setExpanded(expanded: boolean): void {
    this.box.visible = expanded
  }
```

and `destroy` becomes:

```ts
  destroy(): void {
    this.detach()
    this.box.destroy()
  }
```

- [ ] **Step 4: Restate why `update` still diffs**

The `update` comment's reason changes — there is no inner scroll position left to lose, but there is a popup-level one:

```ts
  /**
   * Redraw only when the drawing would differ. Every store emit reaches here,
   * and most of them are about something else entirely — a tool starting, a
   * permission resolving — so an unconditional rebuild would destroy and
   * recreate every line. That churns actors under the popup's own scroll
   * position, and can change the body's height, throwing a reader part-way down
   * a long plan somewhere else entirely.
   */
```

- [ ] **Step 5: Let a subject wrap**

In `line()`:

```ts
    const glyph = new St.Label({
      text: GLYPH[task.status],
      style_class: 'dasbo-task-glyph',
      // START, not CENTER: beside a subject wrapped over three lines a centred
      // glyph floats next to the middle one instead of the task it marks — the
      // same reasoning already recorded for _dot beside the activity text.
      y_align: Clutter.ActorAlign.START,
    })
    const subject = new St.Label({
      text: task.subject,
      style_class: 'dasbo-task-subject',
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    })
    // A task subject is what the agent is doing, so it is never cut. Wrapping
    // needs a bounded width to wrap against, which comes from the row's
    // .dasbo-fixed-width ancestor. ellipsize must be NONE explicitly: Pango
    // ignores line_wrap while an ellipsize mode is set. WORD_CHAR, not WORD:
    // subjects routinely carry file paths with no break opportunity in them.
    subject.clutter_text.line_wrap = true
    subject.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR
    subject.clutter_text.ellipsize = Pango.EllipsizeMode.NONE
```

- [ ] **Step 6: Delete the list's own cap**

In `stylesheet.css`, delete the comment and rule:

```css
/* The list has to be bounded: a plain PopupMenu does not scroll in GNOME Shell
   46, so without a max-height a long plan grows the popup past the monitor and
   is clipped. ~9 lines at this font size. */
.dasbo-tasks-scroll { max-height: 200px; }
```

`.dasbo-tasks`, `.dasbo-task`, `.dasbo-task-glyph` and `.dasbo-task-subject` stay.

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run test/shell/noEllipsis.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 8: Typecheck, full test run and build**

Run: `npm run typecheck && npm test && npm run build`
Expected: exit 0 throughout. Watch for an unused-import error on `St.PolicyType` — `taskList.ts` still needs `St`, `Clutter` and `Pango`, and nothing else was imported for the scroll view.

- [ ] **Step 9: Verify in a live Shell**

Run: `make install`, log out and back in, then open a session whose plan has long subjects and expand it.
Expected: every subject reads in full, wrapped; `✓`/`▸`/`○` sit beside each subject's first line; there is exactly one scrollbar in the popup; expanding a long plan grows the popup until roughly 90% of the screen and then scrolls. Collapsing the row still hides the list and leaves no gap above the row below. On a second monitor of a different height, the cap follows the monitor the popup opens on.

- [ ] **Step 10: Commit**

```bash
git add src/shell/taskList.ts stylesheet.css test/shell/noEllipsis.test.ts
git commit -F - <<'EOF'
fix(shell): show a task's subject whole, in the popup's own scroll

A subject was ellipsized to one line so the list's height stayed a
function of the task count, which is what made a 200px cap on its own
scroll view predictable. The popup now carries that bound itself, so the
inner scroll view and its cap go, subjects wrap, and the status glyph
moves to the first line of one. A source-lint test keeps both this and
the option description from being ellipsized again.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Verification sweep

After Task 5, with the extension installed and a fresh login:

- [ ] `npm run typecheck && npm test && npm run build` — exit 0.
- [ ] A popup with one session and no plan looks exactly as it did before this work: no scrollbar, no height change.
- [ ] A plan with twenty long subjects: all text readable, one scrollbar, popup roughly 90% of screen height at most.
- [ ] An `AskUserQuestion` with four long descriptions: four wrapped paragraphs, bold labels, dimmer descriptions, `Other…` intact and still opening an entry.
- [ ] Tab from the gear through every focusable control in a popup taller than the cap: focus is always visible.
- [ ] `journalctl --user -b -o cat /usr/bin/gnome-shell | grep -i dasbo` — no Clutter warnings about children, allocation, or markup parsing.

## Spec sections and where they land

| Spec section | Task |
|---|---|
| One flowing line per option | 2, 4 |
| One scrollbar at the popup level | 3, 5 |
| Header pins | 3 |
| 90% of the work area | 1, 3 |
| `src/core/popupSize.ts` | 1 |
| `escapeMarkup` / `optionMarkup` | 2 |
| `island.ts` section, scroll view, cap, focus reveal | 3 |
| `questionPanel.ts` single label | 4 |
| `taskList.ts` wrap and de-scroll | 5 |
| Stylesheet deletions | 4 (`.dasbo-question-label`, `.dasbo-question-desc`), 5 (`.dasbo-tasks-scroll`) |
| Failure behaviour table | 1 (`MIN_BODY`, scale factor), 2 (escaping), 3 (monitor fallbacks) |
| Testing section | 1, 2, 5, plus the verification sweep |
