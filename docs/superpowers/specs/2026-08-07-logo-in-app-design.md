# The logo in the extension UI

## Problem

The project mark exists, but only in the README. The
[README overhaul spec](2026-08-07-readme-overhaul-design.md) drew its scope
line at the repository page and explicitly left out "adding the logo to the
preferences About page or to `src/icons/`". So the two places a user actually
looks at the extension — the popup they open from the panel, and the About
page that carries the project's identity — both name Dasbo Island in text and
show nothing of it.

This change puts the mark in both.

## Scope

**In:** the mark in the popup header, before the "Dasbo Island" label; a
banner at the top of the About page; moving the logo assets to where the build
can ship them; the theme handling both surfaces need.

**Out:** the panel pill icon, `site/index.html`, the notification popup, and
any new GSettings key. No `-symbolic` variant — the mark renders in full
colour by design.

## The mark and its two variants

Two files exist today, unchanged by this work:

| File | Body fill | Meant for |
| --- | --- | --- |
| `logo-light.svg` | `#2E2E33` | **light** backgrounds |
| `logo-dark.svg` | `#E9E9EC` | **dark** backgrounds |

The antenna dot is `#7B92F5` in both. The names describe the *theme they
belong to*, not the ink they are drawn in — which is the sense the README's
`<picture>` already uses, and the sense this spec keeps. Reading them the
other way round selects an invisible mark on both themes, so it is worth
being explicit.

### Where they live

The files move from `docs/assets/` to `src/assets/`, and the README's
`<picture>` element is repointed at the new paths. `hero.svg` stays in
`docs/assets`.

One copy, because two copies drift. `build.mjs` already copies `src/assets`
into `dist/assets` for the support QR, so the move costs no build change and
`test/prefs/aboutAssets.test.ts` already guards that `cp` line.

## `src/core/logo.ts`

The asset names and the light/dark decision, kept out of the GJS files so a
test can reach them — the same reason `src/core/about.ts` exists.

```ts
export const LOGO = {
  light: 'assets/logo-light.svg',
  dark: 'assets/logo-dark.svg',
} as const

export function logoAsset(dark: boolean): string
export function prefersDark(colorScheme: string): boolean
```

`logoAsset` returns the path relative to the installed extension directory,
the way `ABOUT.qrAsset` does; both call sites join it onto their base path.

`prefersDark` maps the raw `org.gnome.desktop.interface color-scheme` string:
`'prefer-light'` is the only value that returns `false`. `'prefer-dark'`,
`'default'`, and any unrecognised value return `true`, because the Shell popup
is dark unless the user has explicitly asked for light, and an unknown value
from a future GNOME should fail toward the common case rather than the rare
one.

`prefersDark` is shell-side only. The preferences window has
`Adw.StyleManager.dark`, which is the correct source there — it also accounts
for a dark style forced by the application — so the About page reads that
boolean and passes it straight to `logoAsset`.

## The popup header

`src/shell/logoIcon.ts` exports `logoIcon(base: string): St.Icon`: a 16px
`St.Icon` whose gicon is `${base}/${logoAsset(prefersDark(scheme))}`, with
`scheme` read from `Gio.Settings` for `org.gnome.desktop.interface`.

16px matches the gear button at the opposite end of the header. The popup's
width is pinned at 30em by `.dasbo-fixed-width`, so the mark and its 12px of
header spacing cost the title nothing.

The icon connects to `changed::color-scheme` and re-resolves its gicon when
the user switches theme, and disconnects that handler on its own `destroy`.
The header is built once when the extension is enabled and lives until it is
disabled, so without the watcher a mid-session theme switch would leave a mark
that is nearly invisible until the extension is reloaded.

A missing file yields a `null` gicon and a header that renders as text alone.
This is the fail-open contract `agentGicon` already documents for the agent
marks: `query_exists` plus a try/catch, because an exception escaping a widget
build takes the whole popup rebuild with it, and a decoration must never cost
the user their session list.

`PopupHeader` gains a `base: string` argument alongside its callbacks. `Island`
already carries that path as `iconBase` (`src/shell/island.ts:111`) and
constructs the header at `src/shell/island.ts:151`, so this is one argument
threaded one level, not new plumbing.

The icon is added as the header's first child, before the title label.

## The About page banner

A new group at the top of the page — before the identity group, which is
before Support:

- a centred `Gtk.Image`, built with `Gtk.Image.new_from_gicon` over a
  `Gio.FileIcon`, `pixel_size` 96
- "Dasbo Island" in a `Gtk.Label` with the `title-1` style class
- the version below it, dimmed

`Gtk.Image` with `pixel_size` rather than `Gtk.Picture`: `pixel_size` *is* the
image's minimum size, so it cannot collapse the way the QR did when it was
wrapped in a clamp — the measured 200×0 allocation documented at
`src/prefs/about.ts:104`.

The group has no title and its row is neither activatable nor selectable, like
the QR row.

Variant selection reads `Adw.StyleManager.get_default().dark`, re-resolves on
`notify::dark`, and disconnects on the image's `destroy` signal.

If the asset is missing the image is left out and the name and version still
render — the same existence check the QR expander already makes before
promising a QR it cannot show.

### What the identity group loses

`_identity` drops its `title: 'Dasbo Island'` and its **Version** row, both of
which the banner now carries; showing either twice on one page reads as an
oversight. It keeps Author, Licence, GitHub, and Report an issue.

## Testing

No GTK or St exists under vitest, so the widget trees cannot be built and
inspected. The tests split the way the rest of the repo's do: real assertions
against `src/core` and the asset files, source-text assertions against the
GJS files.

**New:**

- `test/core/logo.test.ts` — `prefersDark` for `prefer-light`, `prefer-dark`,
  `default`, and an unrecognised string; `logoAsset` in both directions; the
  two paths differ.
- `test/prefs/logoAssets.test.ts` — both files exist at `src/${LOGO.light}`
  and `src/${LOGO.dark}`, parse as SVG, and carry the pinned body fills and
  the shared `#7B92F5` antenna. Then the assertion that earns this file: the
  two variants are identical apart from that body fill. A variant edited on
  one side only is invisible to every other check here, and is exactly the
  silent-death class `test/shell/iconAssets.test.ts` was written to stop.
- `test/shell/popupHeaderLogo.test.ts` — source text: the logo child is added
  before the title child, the path comes from `logoAsset` rather than a
  literal, and the `changed::color-scheme` handler is disconnected on destroy.

**Updated:**

- `test/prefs/aboutPage.test.ts` — the ordering assertion at line 44 anchors
  on `title: 'Dasbo Island'`, which the banner removes; re-anchor it on the
  banner. Add: the banner group precedes the identity group, the page reads
  `LOGO`/`logoAsset` rather than a literal filename, and the `notify::dark`
  handler is disconnected.
- `test/docs/readmeAssets.test.ts` and `test/docs/links.test.ts` — the logo
  paths move to `src/assets/`.

## Verification the tests cannot do

Both theme swaps are only observable by eye. The smoke test has to open the
popup and the preferences window and flip
`org.gnome.desktop.interface color-scheme` between `prefer-light` and
`prefer-dark` with both on screen, confirming each mark re-resolves in place
rather than staying on the variant it was built with.
