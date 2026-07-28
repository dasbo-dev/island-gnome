# Stable widths and a terse elapsed timer

Date: 2026-07-28
Status: approved, ready for planning

## Problem

Three layout defects, all caused by widgets sized from their content.

**The pill resizes the top bar.** `Island.refresh()` writes
`` `${count} · ${STATE_WORD[worst]}` `` into `_label`
(`src/shell/island.ts:300`), and nothing bounds that label's width. The count
grows by a digit, the state word swings between `done` (4 chars) and `working`
(7), and each change re-lays-out the panel. Every neighbouring indicator in the
top bar slides sideways with it.

**The popup resizes as commands change.** A `PopupMenu`'s width follows its
widest child. `SessionRow._activity` is a single-line label carrying the tool
and its detail (`src/shell/sessionRow.ts:98`), so an agent moving from
`Read · src/a.ts` to a long `Bash` command widens the whole popup mid-session.
`truncateDetail`'s 120-character cap (`src/core/format.ts:11`) only bounds how
bad it gets — its doc comment claims it stops a label from resizing the popup,
which is not what it achieves.

**The timer reads as a stopwatch.** `formatElapsed` returns `mm:ss`, or
`h:mm:ss` past an hour (`src/core/format.ts:7`). Second-level precision is
noise for a session that has been running for twenty minutes, and the width
changes at the hour boundary, which shifts the **Jump** button.

## Design

### 1. Terse elapsed timer — `src/core/format.ts`

`formatElapsed` returns the largest whole unit, floored, with no day rollover:

```ts
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  if (total < 60) return `${total}s`
  if (total < 3600) return `${Math.floor(total / 60)}m`
  return `${Math.floor(total / 3600)}h`
}
```

`0s`, `5s`, `59s`, `1m`, `59m`, `3h`, `52h`. Sub-second input reads `0s`;
negative input still clamps to zero.

Flooring is deliberate: a label that rounds up shows `1m` while the session is
54 seconds old, which reads as wrong next to a terminal the user can see.

Hours never roll over to days. A session outliving a day is rare, and `52h` is
unambiguous where `2d` discards the remaining hours.

The one caller is `sessionRow.ts:107`; its initial label text
(`sessionRow.ts:51`) changes from `'00:00'` to `'0s'`.

### 2. Fixed pill width — `src/shell/island.ts`, `stylesheet.css`

```css
.dasbo-pill-label {
  font-size: 0.9em;
  width: 8em;
}
```

`em` rather than `px` so the width tracks the shell's font scaling. 8em at
`0.9em` accommodates `100 · waiting`, the widest realistic content: a
three-digit session count with the longest state word.

Overflow past that clips with an ellipsis, set on the ClutterText in the
`Island` constructor rather than in CSS:

```ts
this._label.clutter_text.ellipsize = Pango.EllipsizeMode.END
```

St's CSS engine does not honour `text-overflow`, and the same lesson is already
recorded for `opacity` in `popupHeader.ts:63` — the actor property is the
load-bearing one, the CSS rule is not. This needs a new `import Pango from
'gi://Pango'` in `island.ts`.

The label text itself is unchanged. The dot and the `.dasbo-pill` spacing are
already constant, so with the label bounded the pill's width no longer depends
on its content and the top bar stops re-laying-out.

### 3. Fixed popup width — `stylesheet.css`

The width is declared once per top-level row container, so the menu's widest
child is the same width in every state:

```css
.dasbo-header      { spacing: 12px; width: 26em; }
.dasbo-row-outer   { spacing: 12px; width: 26em; }
.dasbo-empty-outer { width: 26em; }
```

`.dasbo-empty-outer` is new. `EmptyRow` currently adds its label directly to
the menu item (`src/shell/popupHeader.ts:68`); the label is wrapped in an
`St.BoxLayout` carrying that class, otherwise the popup narrows to the header's
width whenever the session list empties.

All three carry the same value because a `PopupMenu` sizes to its widest child:
setting the width on only one of them leaves the others free to exceed it.

### 4. Wrapping activity label — `src/shell/sessionRow.ts`

```ts
this._activity.clutter_text.line_wrap = true
this._activity.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR
this._activity.clutter_text.ellipsize = Pango.EllipsizeMode.NONE
```

`WORD_CHAR`, not `WORD`: a long path, URL or flag string has no word boundary
to break at, and `WORD` alone would let such a token overhang the fixed width —
reintroducing the defect this change exists to remove.

`ellipsize` is set to `NONE` explicitly because Pango ignores `line_wrap` when
an ellipsize mode is active; leaving it to the default would silently produce a
single truncated line.

Two knock-on adjustments in the same row:

- The activity dot's `y_align` moves from `CENTER` to `START`
  (`sessionRow.ts:42`), so it sits beside the first line rather than floating
  at the vertical middle of a three-line block.
- `.dasbo-row-elapsed` gains `min-width: 3em`. The row's total width is now
  fixed and the action box is right-hand, so a bare `5s` growing to `12m` would
  otherwise slide **Jump** sideways. The existing `font-feature-settings:
  "tnum"` handles jitter within a digit count; `min-width` handles the change
  in digit count.

`truncateDetail` keeps its 120-character cap and its call sites. Its role
changes: it no longer bounds the popup's width — the CSS does that — it now
bounds the label's *height*, to roughly three wrapped lines. Its doc comment is
corrected to say so.

## Data flow

Unchanged. No new GSettings keys, no store mutation, no D-Bus traffic, no new
files. `formatElapsed` keeps its `(ms: number) => string` signature, so
`SessionRow.tick` is untouched beyond the initial label text.

## Error handling

Nothing here can fail at runtime: CSS width declarations and ClutterText
properties have no failure path, and `formatElapsed` is total over its input
(negatives clamp, sub-second floors to `0s`, arbitrarily large values return
an hour count).

The one behavioural risk is visual, not exceptional: content wider than its
container. That is contained in both places — the pill ellipsizes at 8em, and
the activity label wraps at the popup width with `WORD_CHAR` so an unbreakable
token cannot overhang.

## Testing

`src/shell` has no unit tests — GJS widgets are not constructible under vitest
— so the widget and stylesheet changes are verified manually. `formatElapsed`
lives in `src/core` and is unit-tested.

1. `test/core/format.test.ts`: the `formatElapsed` describe block is rewritten
   against the new contract — seconds below a minute, minutes below an hour,
   hours above, no day rollover, flooring at each boundary (`59s`, `1m`, `59m`,
   `1h`), sub-second input as `0s`, negative input as `0s`. The
   `truncateDetail` block is untouched.
2. `npm test` and `npm run typecheck` green.
3. `make install`, reload the shell, then with `tools/fake-agent.js`:
   - Drive the session count from 1 to 100 and through every state, confirming
     the pill's width — and its neighbours' positions — never move.
   - Drive an agent through short and long commands, confirming the popup's
     width never moves and long commands wrap to two or three lines.
   - Confirm the popup keeps its width when the last session ends and
     `No active sessions` appears (requires `always-show`).
   - Confirm a pending permission's Allow / Deny / Always cluster fits: at
     26em the text column is squeezed, and the command should wrap further
     rather than the buttons clipping.
   - Watch a session past `59s`, confirming `59s` -> `1m` and that **Jump**
     does not shift.

`8em` and `26em` are estimates that cannot be validated without rendering.
Both are single constants in `stylesheet.css`; step 3 is where they get tuned.

## Out of scope

- Restructuring `SessionRow` to give the command its own full-width line below
  the status line. It reads better for long commands but is a larger change to
  a row that also has to host the permission cluster.
- A user-configurable popup width. One constant that looks right beats a
  preference nobody opens.
- Making the popup width adapt to the panel or monitor width. A fixed value is
  the point; adapting reintroduces a moving target.
