# A taller settings window and a trimmed About banner

## The problem

The About page ends with a Support group — a "Buy me a coffee" button and a QR
expander — and nobody sees it. The preferences window opens too short for the
page, so the group sits below the fold and the user has to scroll to find out it
exists. A support section nobody scrolls to is a support section that isn't
there.

Two things put it there. The window has no default size at all: `src/prefs.ts`
never calls `set_default_size`, and neither does the shell's own
`ExtensionPrefsDialog`, so the window opens at whatever libadwaita's natural
size works out to. And the About page spends about 200px on its banner — a 96px
logo with `margin_top: 24` and `margin_bottom: 12` above the name and version —
before the first identity row is drawn.

## The change

Three edits. No new behaviour, no new user-facing option.

### 1. `src/core/prefsWindow.ts` (new)

```ts
export const PREFS_WINDOW = { width: 600, height: 700 } as const
```

The numbers live in `src/core` rather than at the call site for the reason
`src/core/about.ts` already exists: `src/prefs.ts` imports GJS bindings that no
vitest test in this repo can reach past, so a literal typed into
`fillPreferencesWindow` ships unchecked. A record in core is importable by a
real unit test.

Height is 700 because the About page measures roughly 560–600px once the banner
is trimmed, which leaves headroom for a row or two more without the Support
group sliding back under the fold. Width is 600, the size a libadwaita
preferences window of this shape settles at anyway, pinned so it stops varying
with content.

### 2. `src/prefs.ts`

`fillPreferencesWindow` calls
`window.set_default_size(PREFS_WINDOW.width, PREFS_WINDOW.height)` before adding
any page.

The *default* size, not a size request: a user who resizes the window keeps
their size, and libadwaita's own `width-request`/`height-request` minimums still
apply. On a screen too short for 700px, GTK4's `gtk_window_compute_default_size`
clamps the default against the monitor work area, so the window degrades to "as
tall as fits" rather than running off-screen. That clamp is why this design does
not compute a height from the monitor itself — the platform already does it, and
doing it here would mean guessing which monitor the window will open on before
it is mapped.

### 3. `src/prefs/about.ts`, `_banner`

- `image.pixel_size`: `96` → `64`
- box `margin_top`: `24` → `12`
- box `margin_bottom`: `12` → `6`

About 70px back. The mark still reads as a mark, the name stays `title-1`, and
nothing else on the page moves: the group order remains banner → identity →
support.

## Testing

No GTK exists under vitest, so the widget tree cannot be built and inspected.
That is the same constraint `test/prefs/aboutPage.test.ts` already works
around, and this follows its split: a real unit test for what core exports, and
source-text assertions for what only the GJS side can express.

**`test/core/prefsWindow.test.ts` (new)** imports `PREFS_WINDOW` and asserts:

- `width` and `height` are positive integers.
- `height >= 640`. Below that the Support group returns to living under the
  fold, which is the bug this spec exists to fix.
- `height <= 900`. Above that the number is fiction on any laptop and GTK's
  clamp becomes the real behaviour, which means the constant has stopped
  describing what the user gets.

**`test/prefs/aboutPage.test.ts`** gains two source assertions:

- `src/prefs.ts` calls `set_default_size` with `PREFS_WINDOW`, not with
  literals. A literal typechecks perfectly and is invisible to the core test
  above, so the bound the core test enforces would quietly stop applying.
- `src/prefs/about.ts` sets `pixel_size = 64`. The banner is the page's height
  budget; an edit pushing it back to 96 reintroduces the bug and breaks no other
  test.

Written first, watched fail, then the three edits — `superpowers:test-driven-development`.

## Verification

`npm test` and the TypeScript build are the automated gates. Neither renders a
window, so the last check is human: build and reinstall the extension, then open
preferences (`gnome-extensions prefs dasbo-island@ayubaswad.gmail.com`), land on
About, and confirm the "Buy me a coffee" button is visible without scrolling.
The preferences dialog loads `prefs.js` from disk each time it opens, so no
shell restart is needed for this check — closing and reopening the dialog is
enough.

## Error handling

Nothing to handle. `set_default_size` cannot fail, and `_banner` already guards
the only failure it has — a missing logo asset, which costs the page a
decoration and not its content.

## Out of scope

- Any user-facing setting for the window size.
- Expanding the QR row by default. It would add ~230px and push the page back
  past the fold, undoing the fix.
- Reordering or restyling the identity rows.
