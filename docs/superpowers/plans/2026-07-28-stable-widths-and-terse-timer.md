# Stable Widths and Terse Timer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the top bar and the popup from resizing as session content changes, and shorten the elapsed timer to a single unit.

**Architecture:** Three independent changes to an existing GNOME Shell 46 extension. The elapsed-time format is pure logic in `src/core/` and gets real unit tests. The two width fixes are St widget properties plus CSS width declarations in `stylesheet.css`; `src/shell/` has no unit tests because GJS widgets are not constructible under vitest, so those are verified by running the shell.

**Tech Stack:** TypeScript compiled by esbuild (`build.mjs`), GJS / GNOME Shell 46 (`St`, `Clutter`, `Pango` via `gi://`), vitest for `src/core/` tests, `@girs/*` type packages.

## Global Constraints

- `src/core/` must never import `gi://` or `resource://`. `test/core/purity.test.ts` enforces this — the timer change in Task 1 stays free of GI imports.
- Target GNOME Shell 46 only.
- All widths are expressed in `em`, not `px`, so they track the shell's font scaling.
- The two width constants are `8em` (pill label) and `26em` (popup rows). They are estimates that can only be validated by rendering; each appears in exactly one place in `stylesheet.css`.
- `src/shell/` gets no unit tests. Every shell change is verified by `npm run typecheck`, `make install`, a shell reload, and `tools/fake-agent.js`.
- Existing comment style: comments explain *why*, and record St/Clutter gotchas (see `src/shell/popupHeader.ts:63`). Match it.

---

### Task 1: Terse elapsed timer

**Files:**
- Modify: `src/core/format.ts:1-8` (`formatElapsed`), `src/core/format.ts:10-14` (`truncateDetail` doc comment)
- Modify: `src/shell/sessionRow.ts:51` (initial label text)
- Test: `test/core/format.test.ts:4-20` (the `formatElapsed` describe block)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `formatElapsed(ms: number): string` — signature unchanged, contract changed. Returns the largest whole unit, floored: `"0s"`, `"5s"`, `"59s"`, `"1m"`, `"59m"`, `"1h"`, `"52h"`. No day unit. Negative input clamps to `"0s"`. Task 3 relies on the string being at most 4 characters wide when it sizes `.dasbo-row-elapsed` at `min-width: 3em`.

- [ ] **Step 1: Replace the failing tests**

Replace the whole `describe('formatElapsed', ...)` block at `test/core/format.test.ts:4-20` with the block below. Leave the `import` line and the `describe('truncateDetail', ...)` block exactly as they are.

```ts
describe('formatElapsed', () => {
  it('formats under a minute as whole seconds', () => {
    expect(formatElapsed(0)).toBe('0s')
    expect(formatElapsed(400)).toBe('0s')
    expect(formatElapsed(5_000)).toBe('5s')
    expect(formatElapsed(59_999)).toBe('59s')
  })

  it('formats under an hour as whole minutes, flooring the seconds away', () => {
    expect(formatElapsed(60_000)).toBe('1m')
    expect(formatElapsed(90_000)).toBe('1m')
    expect(formatElapsed(3_599_000)).toBe('59m')
  })

  it('formats an hour or more as whole hours, flooring the minutes away', () => {
    expect(formatElapsed(3_600_000)).toBe('1h')
    expect(formatElapsed(3_600_000 + 3_500_000)).toBe('1h')
    expect(formatElapsed(52 * 3_600_000)).toBe('52h')
  })

  it('keeps counting in hours past a day rather than rolling over', () => {
    expect(formatElapsed(25 * 3_600_000)).toBe('25h')
  })

  it('clamps negative input to zero', () => {
    expect(formatElapsed(-5000)).toBe('0s')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- format
```

Expected: FAIL. The first failure reads `expected '00:00' to be '0s'`.

- [ ] **Step 3: Rewrite `formatElapsed`**

Replace `src/core/format.ts:1-8` with:

```ts
/**
 * The largest whole unit, floored: `5s`, `1m`, `52h`. Floored rather than
 * rounded because a label reading `1m` beside a terminal the user started 54
 * seconds ago reads as a bug. Hours never roll over to days — a session
 * outliving a day is rare, and `52h` says more than `2d`, which would discard
 * the remaining hours.
 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  if (total < 60) return `${total}s`
  if (total < 3600) return `${Math.floor(total / 60)}m`
  return `${Math.floor(total / 3600)}h`
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- format
```

Expected: PASS, 10 tests — 5 in the `formatElapsed` block, 5 in the untouched `truncateDetail` block.

- [ ] **Step 5: Fix the initial label text**

`src/shell/sessionRow.ts:51` seeds the label with the old format, which is what shows for the fraction of a second before the first `tick()`. Change:

```ts
      this._elapsed = new St.Label({ text: '00:00', style_class: 'dasbo-row-elapsed',
        y_align: Clutter.ActorAlign.CENTER })
```

to:

```ts
      this._elapsed = new St.Label({ text: '0s', style_class: 'dasbo-row-elapsed',
        y_align: Clutter.ActorAlign.CENTER })
```

- [ ] **Step 6: Correct the `truncateDetail` doc comment**

The existing comment at `src/core/format.ts:10` claims this function stops a label resizing the popup. After Task 3 the CSS does that, and this cap bounds height instead. Replace:

```ts
/** Collapse whitespace and cap length, so one label cannot resize the popup. */
```

with:

```ts
/**
 * Collapse whitespace and cap length. The popup's width is fixed in CSS and the
 * activity label wraps, so this bounds the label's *height* — roughly three
 * wrapped lines at the popup width — not its width.
 */
```

- [ ] **Step 7: Verify the whole suite and the types**

```bash
npm test && npm run typecheck
```

Expected: vitest reports all files passing; `tsc` prints nothing and exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/core/format.ts src/shell/sessionRow.ts test/core/format.test.ts
git commit -m "feat(ui): show elapsed time as a single unit"
```

---

### Task 2: Fixed pill width

**Files:**
- Modify: `src/shell/island.ts:1-13` (imports), `src/shell/island.ts:75-79` (the pill label)
- Modify: `stylesheet.css:17-19` (`.dasbo-pill-label`)
- Modify: `tools/fake-agent.js:2-3` (usage comment), `tools/fake-agent.js:11` (argument parsing), `tools/fake-agent.js:20-30` (payloads)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `.dasbo-pill-label` is width-locked at `8em`. Task 3 does not touch it. `tools/fake-agent.js <mode> [session-id]` — the optional second argument becomes `session_id` in the payload, so repeated invocations create distinct sessions instead of updating one.

- [ ] **Step 1: Make `fake-agent.js` able to create more than one session**

`SessionStore` keys sessions on agent plus session id (`src/core/store.ts:52`), and the tool hardcodes `fake-1`, so today it can only ever produce a single row and a pill reading `1 · …`. The pill's width cannot be checked without a varying count. Add a second argument.

Change `tools/fake-agent.js:2-3` from:

```js
// Drives the extension over D-Bus without running a real agent.
// Usage: tools/fake-agent.js session|tool|perm
```

to:

```js
// Drives the extension over D-Bus without running a real agent.
// Usage: tools/fake-agent.js session|tool|perm [session-id]
// The session id defaults to fake-1. Pass distinct ids to create distinct
// sessions — the store keys on agent + session id, so reusing one id updates
// the same row instead of adding another.
```

Change `tools/fake-agent.js:11` from:

```js
const mode = ARGV[0] ?? 'session'
```

to:

```js
const mode = ARGV[0] ?? 'session'
const sessionId = ARGV[1] ?? 'fake-1'
```

Then in the `payloads` object (`tools/fake-agent.js:20-30`) replace all three occurrences of `session_id: 'fake-1'` with `session_id: sessionId`.

- [ ] **Step 2: Import Pango and ellipsize the pill label**

Add to the import block at the top of `src/shell/island.ts` (after the `GLib` import on line 4):

```ts
import Pango from 'gi://Pango'
```

Then, immediately after the `this._label = new St.Label({...})` statement at `src/shell/island.ts:75-79` and before `box.add_child(this._dot)`, insert:

```ts
      // The label's width is pinned in the stylesheet so the pill cannot resize
      // the top bar. St's CSS engine has no `text-overflow`, so the ellipsis has
      // to be set on the ClutterText — the same lesson as the opacity note in
      // popupHeader.ts. Without it, overlong content is clipped mid-glyph.
      this._label.clutter_text.ellipsize = Pango.EllipsizeMode.END
```

- [ ] **Step 3: Pin the width in the stylesheet**

Replace `stylesheet.css:17-19`:

```css
.dasbo-pill-label {
  font-size: 0.9em;
}
```

with:

```css
/* Fixed so the pill never resizes the top bar. 8em fits the widest realistic
   content, "100 · waiting"; anything longer ellipsizes (see island.ts). */
.dasbo-pill-label {
  font-size: 0.9em;
  width: 8em;
}
```

- [ ] **Step 4: Verify the types and the build**

```bash
npm run typecheck && npm run build
```

Expected: `tsc` prints nothing and exits 0; `node build.mjs` writes `dist/` without errors.

- [ ] **Step 5: Verify in the shell**

```bash
make install
```

Then reload: on X11 press `Alt+F2`, type `r`, Enter. On Wayland, log out and back in.

```bash
for i in $(seq 1 12); do tools/fake-agent.js session "s$i"; done
```

Expected: the pill reads `12 · idle` and its right edge — plus every indicator to its right in the top bar — sits at the same pixel it did with one session. Then:

```bash
tools/fake-agent.js tool s1     # worst state -> working
tools/fake-agent.js perm s2     # worst state -> waiting
```

Expected: the pill text changes, its width does not. Nothing in the top bar moves. Confirm the text is not clipped at 12 sessions; if it is, raise `8em` in `stylesheet.css` and re-run `make install`.

- [ ] **Step 6: Check the journal is clean**

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

Expected: no `dasbo-island` warnings or JS exceptions while the pill updates. Stop with Ctrl-C.

- [ ] **Step 7: Commit**

```bash
git add src/shell/island.ts stylesheet.css tools/fake-agent.js
git commit -m "fix(shell): pin the pill's width so the top bar stops jumping"
```

---

### Task 3: Fixed popup width and wrapping command

**Files:**
- Modify: `src/shell/sessionRow.ts:1-6` (imports), `src/shell/sessionRow.ts:41-47` (activity row)
- Modify: `src/shell/popupHeader.ts:53-71` (`EmptyRow`)
- Modify: `stylesheet.css:30-33` (`.dasbo-row-elapsed`), `stylesheet.css:35` (`.dasbo-row-outer`), `stylesheet.css:44` (`.dasbo-header`), and one new rule
- Test: none — `src/shell/` is not unit-testable under vitest. Verified in Step 5.

**Interfaces:**
- Consumes: `formatElapsed` from Task 1, whose output is at most 4 characters — this is what makes `min-width: 3em` on `.dasbo-row-elapsed` sufficient. `truncateDetail(s, max = 120)` from `src/core/format.ts`, unchanged, which bounds the wrapped label to roughly three lines.
- Produces: nothing later tasks consume. This is the last task.

- [ ] **Step 1: Wrap the activity label**

Add to the import block at the top of `src/shell/sessionRow.ts` (after the `Clutter` import on line 2):

```ts
import Pango from 'gi://Pango'
```

Then replace `src/shell/sessionRow.ts:41-47`:

```ts
      const activityRow = new St.BoxLayout({ style_class: 'dasbo-pill' })
      this._dot = new St.Widget({ style_class: 'dasbo-dot', y_align: Clutter.ActorAlign.CENTER })
      this._activity = new St.Label({ text: '', style_class: 'dasbo-row-activity',
        y_align: Clutter.ActorAlign.CENTER })
      activityRow.add_child(this._dot)
      activityRow.add_child(this._activity)
```

with:

```ts
      // x_expand on both so the label is allocated the row's full remaining
      // width: wrapping needs a bounded width to wrap against, and that bound
      // comes from .dasbo-row-outer's fixed width in the stylesheet.
      const activityRow = new St.BoxLayout({ style_class: 'dasbo-pill', x_expand: true })
      // START, not CENTER: over three wrapped lines a centred dot floats beside
      // the middle line instead of beside the status it belongs to.
      this._dot = new St.Widget({ style_class: 'dasbo-dot', y_align: Clutter.ActorAlign.START })
      this._activity = new St.Label({ text: '', style_class: 'dasbo-row-activity',
        x_expand: true })
      // WORD_CHAR, not WORD: a long path, URL or flag string has no word
      // boundary to break at, and WORD alone lets such a token overhang the
      // fixed width — reintroducing the jumping this exists to remove.
      // ellipsize must be NONE explicitly: Pango ignores line_wrap while an
      // ellipsize mode is set, which would silently yield one truncated line.
      this._activity.clutter_text.line_wrap = true
      this._activity.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR
      this._activity.clutter_text.ellipsize = Pango.EllipsizeMode.NONE
      activityRow.add_child(this._dot)
      activityRow.add_child(this._activity)
```

- [ ] **Step 2: Give `EmptyRow` a width-carrying container**

`EmptyRow` adds its label straight to the menu item, so it has nothing to hang a width on and the popup would narrow whenever the session list empties. Replace the body of the `EmptyRow` constructor at `src/shell/popupHeader.ts:55-69`:

```ts
      super({ reactive: false, can_focus: false, style_class: 'dasbo-row' })
      const label = new St.Label({
        text: 'No active sessions',
        style_class: 'dasbo-empty',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
      })
      // St's CSS engine doesn't reliably honour `opacity` (the .dasbo-empty
      // rule is kept for intent, but isn't load-bearing) — set the Clutter
      // actor property directly so the label actually reads as dimmed.
      // 178 == 0.7 * 255.
      label.opacity = 178
      this.add_child(label)
```

with:

```ts
      super({ reactive: false, can_focus: false, style_class: 'dasbo-row' })
      // The label goes in a box carrying the popup's fixed width, the way a
      // SessionRow's .dasbo-row-outer does. Without it this row is narrower
      // than the session rows and the popup visibly shrinks when the last
      // session ends.
      const outer = new St.BoxLayout({ style_class: 'dasbo-empty-outer' })
      const label = new St.Label({
        text: 'No active sessions',
        style_class: 'dasbo-empty',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
      })
      // St's CSS engine doesn't reliably honour `opacity` (the .dasbo-empty
      // rule is kept for intent, but isn't load-bearing) — set the Clutter
      // actor property directly so the label actually reads as dimmed.
      // 178 == 0.7 * 255.
      label.opacity = 178
      outer.add_child(label)
      this.add_child(outer)
```

- [ ] **Step 3: Pin the popup width and the elapsed column**

A `PopupMenu` sizes to its widest child, so every top-level row container needs the same width — pinning only one of them leaves the others free to exceed it.

Replace `stylesheet.css:30-33`:

```css
.dasbo-row-elapsed {
  font-feature-settings: "tnum";
  opacity: 0.7;
}
```

with:

```css
/* min-width because the row's total width is now fixed and the action box is
   right-hand: "5s" growing to "12m" would otherwise slide Jump sideways.
   tnum handles jitter within a digit count, min-width handles the change in
   digit count. 3em covers the widest output, e.g. "100h". */
.dasbo-row-elapsed {
  font-feature-settings: "tnum";
  opacity: 0.7;
  min-width: 3em;
}
```

Replace `stylesheet.css:35`:

```css
.dasbo-row-outer { spacing: 12px; }
```

with:

```css
/* The popup's width. A PopupMenu sizes to its widest child, so .dasbo-header
   and .dasbo-empty-outer carry the same value — pinning one alone leaves the
   others free to exceed it. Fixed here, the command wraps instead of widening
   the popup (see sessionRow.ts). */
.dasbo-row-outer { spacing: 12px; width: 26em; }
```

Replace `stylesheet.css:44`:

```css
.dasbo-header { spacing: 12px; }
```

with:

```css
.dasbo-header { spacing: 12px; width: 26em; }
```

And add, beside the existing `.dasbo-empty` rule:

```css
.dasbo-empty-outer { width: 26em; }
```

- [ ] **Step 4: Verify the types and the build**

```bash
npm run typecheck && npm run build
```

Expected: `tsc` prints nothing and exits 0; `node build.mjs` writes `dist/` without errors.

- [ ] **Step 5: Verify in the shell**

```bash
make install
```

Then reload: on X11 press `Alt+F2`, type `r`, Enter. On Wayland, log out and back in.

```bash
tools/fake-agent.js session s1
tools/fake-agent.js tool s1
```

Open the popup and leave it open for every check below. Expected: the popup's width never changes across any of them.

1. **Short then long command.** `tools/fake-agent.js tool s1` shows `Edit · /tmp/main.js` on one line. Now edit `tools/fake-agent.js`'s `tool` payload `tool_input` to `{ file_path: '/home/fsevenm/projects/dasbo-island/src/shell/a-deliberately-long-path-that-will-not-fit-on-one-line.ts' }`, save, and re-run it. Expected: the text wraps to two or three lines, the popup grows downward, its width holds. Revert the edit afterwards.
2. **No word boundary.** Change that same `file_path` to a 130-character string with no spaces or slashes (`'x'.repeat(130)` written out), re-run. Expected: it breaks mid-token across lines rather than overhanging the popup's right edge, and stops at three lines — `truncateDetail`'s 120-character cap. Revert.
3. **Empty state.** Enable **Always show the pill** in preferences (the gear in the popup's header), then reload the shell without re-running `fake-agent.js` — the store is in-memory, so a reload empties it. Waiting for a reap instead does not work here: an `idle` session is only collected after 15 minutes of silence *and* a dead pid (`src/core/store.ts:177`), and `fake-agent.js` sends a hardcoded pid. Expected: `No active sessions` renders and the popup keeps the same width it had with rows.
4. **Permission cluster.** `tools/fake-agent.js perm s1`. Expected: Allow / Deny / Always all render fully inside the fixed width; the text column is squeezed, so the command should wrap further rather than the buttons clipping. If a button is cut off, raise `26em` in `stylesheet.css` and re-run `make install`.
5. **Elapsed column.** Watch a row cross the one-minute mark. Expected: `59s` becomes `1m` and the **Jump** button does not shift.
6. **Dot alignment.** On a row whose command wraps to three lines, the dot should sit beside the first line. If it reads as sitting slightly too high, add `margin-top` to `.dasbo-dot` — but only inside `.dasbo-row-activity`'s row, not to the pill's dot.

- [ ] **Step 6: Check the journal is clean**

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

Expected: no `dasbo-island` warnings or JS exceptions while opening the popup, driving tool events, and destroying rows. Stop with Ctrl-C.

- [ ] **Step 7: Run the full suite one last time**

```bash
npm test && npm run typecheck
```

Expected: all tests pass — including `test/core/purity.test.ts`, which would fail if a `gi://` import had leaked into `src/core/`. `tsc` exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/shell/sessionRow.ts src/shell/popupHeader.ts stylesheet.css
git commit -m "fix(shell): pin the popup's width and wrap long commands"
```

---

## Notes for the reviewer

- `8em` and `26em` are the only tunable numbers, and Steps 5 of Tasks 2 and 3 are where they get validated. If either was raised during verification, the committed value should be the one that was actually seen working, not the one written here.
- `tools/fake-agent.js` gaining a session-id argument (Task 2, Step 1) is beyond the spec. It is included because the spec's own verification — driving the session count up and watching the pill hold its width — is impossible with the tool as it stands.
- The spec's verification calls for driving the count to 100. Task 2 Step 5 uses 12, which already exercises the one-to-two digit transition and the widest state word. Going to 100 is a matter of changing `seq 1 12`; nothing in the code path differs, and 100 rows make the popup taller than most screens.
