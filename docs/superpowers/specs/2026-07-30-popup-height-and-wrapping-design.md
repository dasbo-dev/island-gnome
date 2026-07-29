# Full text in the popup, and a popup that scrolls

Date: 2026-07-30
Status: approved, ready for planning

## Problem

Two of the popup's texts are cut off rather than shown. An option's description
is `ellipsize: END` (`questionPanel.ts:163`), and so is a task's subject
(`taskList.ts:120`). Both are the content the reader came for: an option
description is how you choose between options, and a task subject is what the
agent is doing. `Read the reader and fold both counts into the task box's
visibility` renders as `Read the reader and fold b…`, which is not a choice you
can make or a step you can recognise.

The reason they truncate is height. A plain `PopupMenu` does not scroll in GNOME
Shell 46 — only `PopupSubMenu.actor` is an `St.ScrollView` — so unbounded content
grows the popup past the monitor and is clipped, not scrolled. Today's answer is
to bound the content: one line per task, ellipsized, inside a task-local scroll
view capped at `max-height: 200px`.

This design inverts that. Text wraps and is never cut; the popup grows to fit it,
up to 90% of the work area; past that, the popup itself scrolls.

## Decisions

**An option becomes one flowing line.** `Label — description`, label bold, wrapped
as a paragraph, rather than a bold column beside a description column. A wrapped
description in a narrow right-hand column would break every two or three words,
and stacking label over description would spend two lines on every option
including the short ones.

**One scrollbar, at the popup level.** The task list's own scroll view goes away.
Nested scroll views inside a popup fight the mouse wheel: the pointer's position
decides which one moves, and a task list at the bottom of its travel silently
hands the wheel to its parent. A long plan competing for popup height with the
other sessions is the honest trade.

**The header pins.** Header and separator stay direct children of `menu.box`;
only the rows scroll. The preferences gear stays reachable with fifteen sessions
open, and the popup keeps a stable title.

**90% of the work area, not the monitor.** `getWorkAreaForMonitor` already
excludes the top bar, so a cap derived from it cannot place the popup's edge
under the panel the popup hangs from.

## Architecture

```
menu.box  (St.BoxLayout, not scrollable)
├── PopupHeader          ← pinned, direct menu item
├── PopupSeparatorMenuItem ← pinned, direct menu item
└── _scroll  St.ScrollView          style = "max-height: <computed>px"
    └── _body.actor  PopupMenuSection
        ├── SessionRow …            ← .dasbo-fixed-width, 26em
        └── EmptyRow (when zero sessions)
```

`PopupMenuSection` is what keeps this cheap: it is a `PopupMenuBase`, so
`addMenuItem` works exactly as `menu.addMenuItem` does today, and `SessionRow`
and `EmptyRow` stay `PopupBaseMenuItem` subclasses with no changes to either.

The cap is written as an inline style on `_scroll` when the popup opens. Per open
covers monitor swaps, resolution changes and font scaling without a single extra
signal connection: the work area cannot change while a popup is open in a way
that matters, and expanding a row inside an already-capped scroll view needs no
recomputation.

## Components

### `src/core/popupSize.ts` (new, pure)

```ts
export const MIN_BODY = 120

export function bodyMaxHeight(o: {
  workAreaHeight: number
  chromeHeight: number
  scaleFactor: number
  fraction?: number        // default 0.9
}): number

export function scrollIntoView(o: {
  value: number            // vadjustment.value
  pageSize: number         // vadjustment.page_size
  childY: number           // child's y within the scrolled box
  childHeight: number
}): number                 // the new value
```

`bodyMaxHeight` returns CSS pixels: `fraction * workAreaHeight`, less
`chromeHeight`, divided by `scaleFactor`, floored at `MIN_BODY` and rounded down
to an integer. The floor matters because chrome is measured, not assumed — an
oversized font or a future second pinned row could otherwise produce a cap of
zero, which St would honour by drawing nothing. A `scaleFactor` of 0 or `NaN` is
treated as 1: a slightly generous cap beats a division by zero.

The scale division is not cosmetic. The work area — and the measured chrome,
which is read in the same stage coordinate space — is in physical pixels,
while St multiplies CSS lengths, including this `max-height`, by the theme
context's scale factor. Writing an unscaled `max-height` would let the body
grow to twice the intended cap on a 2× monitor — precisely the clipping this
design exists to remove. The two platforms this matters on land on opposite
sides of a no-op: on Wayland, mutter forces the scale factor to 1 and the work
area is already logical, so the division changes nothing; on X11 the work area
is physical and the scale factor is N, so the division is what keeps the cap
honest. The arithmetic is the same expression either way — only which side of
it is a no-op changes.

`scrollIntoView` clamps rather than centres: a child above the viewport scrolls to
its top, a child below scrolls so its bottom is flush, and a child already fully
visible returns `value` unchanged. A child taller than the page aligns to its top.

Pure arithmetic with no `gi://` imports, so it is unit-testable and satisfies
`test/core/purity.test.ts`.

### `src/core/questions.ts`

Gains two pure functions:

```ts
export function escapeMarkup(s: string): string
export function optionMarkup(label: string, description: string): string
```

`escapeMarkup` replaces `&`, `<` and `>` — the three characters Pango's parser
acts on outside attribute values. Hand-rolled rather than
`GLib.markup_escape_text` because `core/` may not import `gi://`, and because
this way the escaping is covered by tests.

`optionMarkup` returns `<b>Label</b> — <span alpha="70%">description</span>`, or
`<b>Label</b>` alone when the description is empty, with both halves escaped.
Option labels and descriptions come from an agent's `AskUserQuestion` payload, so
they are untrusted text: unescaped, a description containing `<b>` would either
be swallowed as markup or make `set_markup` throw.

`alpha` is a Pango span attribute rather than a hex colour, so the dimming
survives a light theme. It replaces the actor-level `opacity = 178` the old
description label carried, which cannot be reused here — one label now holds both
halves, and dimming the actor would dim the bold label with it. If the shell's
Pango ignores `alpha`, the description renders at full strength: a loss of
hierarchy, not of information.

### `src/shell/island.ts`

- New fields `_body: PopupMenu.PopupMenuSection` and `_scroll: St.ScrollView`,
  built in the constructor after the header and separator are added, with
  `hscrollbar_policy: NEVER` (nothing wraps sideways any more, and a horizontal
  bar would only steal height), `vscrollbar_policy: AUTOMATIC`, and
  `clip_to_allocation: true` — the same property GNOME 46's own `PopupSubMenu`
  sets on its `St.ScrollView` (`js/ui/popupMenu.js`), without which rows could
  paint outside the capped viewport during the popup's open animation.
  `_scroll.set_child(_body.actor)`, then `menu.box.add_child(_scroll)`.
- Every `(this.menu as PopupMenu.PopupMenu).addMenuItem(row)` and the `EmptyRow`
  equivalent in `_rebuildRows` becomes `this._body.addMenuItem(…)`. The header and
  separator keep going to `this.menu`.
- New `_applyBodyCap()`, called from the `open-state-changed` handler on open,
  beside `_startTimer()`. It reads the monitor via
  `Main.layoutManager.findIndexForActor(this)` and
  `getWorkAreaForMonitor(idx).height`, falling back to
  `Main.layoutManager.primaryIndex`; the chrome via `get_preferred_height(-1)` on
  the header and the separator (a size request, valid before first allocation,
  where `.height` still reads 0); the scale via
  `St.ThemeContext.get_for_stage(global.get_stage()).scale_factor`. It then writes
  `this._scroll.style = \`max-height: ${bodyMaxHeight(…)}px\``.
- New `key-focus-in` handler on `_scroll`, mapping the focused actor's
  `get_transformed_position` relative to `_body.actor` into
  `scrollIntoView(…)` and assigning `_scroll.vadjustment.value`. Jump,
  Allow/Deny/Always and every option button is focusable, so Tab can reach one
  below the fold; without this it takes focus invisibly. `vadjustment` is a
  property of `St.ScrollView` in GNOME 46 (confirmed against `@girs/st-14`).
  Deliberately not the shell's own `ensureActorVisibleInScrollView`: that lives
  behind a private resource path which has already moved once between releases,
  and the arithmetic it saves is the part worth testing.
- `destroy()` destroys `_body` and `_scroll` alongside `_header` and `_separator`.
- New `Main.sessionMode.disconnectObject(this._body)` in `_releaseExternalRefs`.
  `PopupMenuBase`'s constructor connects `_body` to `Main.sessionMode`, and only
  `PopupMenuBase.destroy()` releases it — but Clutter can tear this button down
  through `clutter_actor_destroy()`, which reaches `_releaseExternalRefs()` (via
  the `'destroy'` signal) and never `destroy()`. `menu.removeAll()` cannot
  substitute: it filters `menu.box`'s children by `_delegate`, and the scroll
  view has none, so it skips both the scroll view and the section inside it.
  Left alone, that path leaves a permanent `Main.sessionMode` handler pointing
  at a section whose actor is gone.

### `src/shell/questionPanel.ts`

`optionButton` collapses from an `St.BoxLayout` holding two labels to a single
`St.Label` fed by `clutter_text.set_markup(optionMarkup(label, description))`,
with `line_wrap = true`, `line_wrap_mode = WORD_CHAR` and `ellipsize = NONE` —
the same triple the question prompt and the row's activity label already carry,
including the reason `ellipsize` must be set to `NONE` explicitly (Pango ignores
`line_wrap` while an ellipsize mode is set). `WORD_CHAR` rather than `WORD`
because a description can contain a path or a flag with no break opportunity in
it, which under `WORD` would overhang the fixed width.

Wrapping needs a bounded width to wrap against; it inherits one from the
`.dasbo-fixed-width` ancestor, as `_activity` does.

`Other…` keeps its literal ellipsis. It marks a button that opens an input, not
text that was cut off.

The panel's `questionBox` comment — "option labels neither wrap nor shrink" —
becomes false with this change and is rewritten. The panel keeps its own full
width line for a different reason: an option paragraph beside the activity text
would starve both.

### `src/shell/taskList.ts`

- The `St.ScrollView` goes. `box` becomes the actor `attachTo`/`detach` add and
  remove, `setExpanded` toggles `box.visible`, and `destroy` destroys `box`.
- `line()` swaps `ellipsize = END` for `line_wrap = true`,
  `line_wrap_mode = WORD_CHAR`, `ellipsize = NONE`. Task subjects routinely
  contain file paths, which is why `WORD_CHAR` again.
- The glyph's `y_align` moves `CENTER` → `START`, so `✓` sits beside a wrapped
  subject's first line rather than floating next to its middle — the reasoning
  already recorded for `_dot` beside the wrapped activity text.
- Two comments change: the class comment explaining why the scroll view is not
  optional, and the `line()` comment about a predictable count of visible
  entries. `update()`'s `sameTasks` guard stays and keeps its value, but its
  stated reason moves from "don't reset this list's scroll position" to "don't
  churn actors under the popup's scroll position".

`sessionRow.ts` needs no change: `_taskBox` holds whatever `TaskList` attaches,
and `_syncTaskBoxVisible` keys on child count and `_expanded`, neither of which
this touches.

### `stylesheet.css`

- `.dasbo-tasks-scroll` is deleted, comment and all.
- `.dasbo-question-label` and `.dasbo-question-desc` are deleted with the labels
  they styled. The bold and the dimming they provided move into the markup.
  `.dasbo-question-option` keeps its padding, `:hover` and `:checked`.
- No rule is added for the scroll view. Its one property is the computed
  `max-height`, which has to be an inline style because it depends on the monitor.

The scrollbar is not an overlay bar. When it appears, the popup widens by the bar
rather than the bar painting over the last glyph of a wrapped line. Content width
stays 26em, and because the header carries `.dasbo-fixed-width` too, the header
and the rows stay aligned with each other; only the bar sits outside them both.

## Failure behaviour

| What breaks | What happens |
|---|---|
| `findIndexForActor` returns a stale or invalid index mid-monitor-change | Falls back to the primary monitor |
| Work area height still reads ≤ 0 | No style written at all — the previous cap stands, rather than clamping the popup to `MIN_BODY` |
| `scale_factor` reads 0 or `NaN` | Treated as 1: the cap is generous rather than a division by zero |
| Chrome measures larger than the whole cap | `MIN_BODY` floor applies, so the body is short but present, never zero-height |
| Pango ignores `alpha="70%"` | Description renders at full strength; layout unaffected |
| An option label or description contains markup characters | Escaped by `optionMarkup`, rendered literally; `set_markup` cannot throw on agent-supplied text |
| A plan longer than the popup can show | It scrolls, which is the point. Other sessions are pushed below the fold and reachable by the same scrollbar |
| A single task subject longer than the whole cap | Wraps to more lines than fit and scrolls; no line is ever cut |

## Testing

- `test/core/popupSize.test.ts` (new) — `bodyMaxHeight` for the fraction, chrome
  subtraction, scale division, the `MIN_BODY` floor, integer output, and a
  `scaleFactor` of 0; `scrollIntoView` for a child above, below, inside, and
  taller than the page.
- `test/core/questions.test.ts` — `escapeMarkup` on `&`, `<`, `>` and a string
  containing all three; `optionMarkup` for the empty description, for markup in
  either half, and for the em dash separator.
- `test/shell/` — a source-lint suite in the style of `insensitiveColor.test.ts`:
  no `EllipsizeMode.END` in `taskList.ts` or `questionPanel.ts`, and no
  `.dasbo-tasks-scroll` left in `stylesheet.css`. This is the only reachable test
  of the intent, since the widgets need a running Shell.
- Untested, as every `src/shell` module is: the scroll view, the section, the cap
  application. `make install` plus a re-login is the check.
- Manual: a session with a long plan — confirm subjects wrap, the glyph aligns to
  the first line, and the popup grows until roughly 90% of the screen and then
  scrolls with a single bar. An `AskUserQuestion` with long descriptions —
  confirm each option reads as one wrapped paragraph, the label is bold, and the
  description is dimmer. Tab through a popup taller than the cap — confirm focus
  scrolls into view. Finally, a second monitor of a different height: open the
  popup on each and confirm the cap follows.

## Out of scope

Per-session height budgeting (capping any one plan's share of the popup).
Collapsing old completed tasks. A scroll-to-top on open, or restoring scroll
position between opens. Overlay scrollbars. Making the popup's 26em width
configurable or responsive. Any change to the pill, the header, or what a row
says.
