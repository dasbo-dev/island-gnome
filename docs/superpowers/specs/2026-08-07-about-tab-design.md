# About tab

## Problem

The preferences window has three pages — Appearance, Behaviour, Agents — and
none of them says who wrote the extension, where its source lives, or how to
support it. A user who wants to file a bug has to find the repository through
`gnome-extensions info`; a user who wants to donate has no path at all.

Two things follow from that. The window gains a fourth page carrying the
project's identity and a donation route, and the repository URLs scattered
across `metadata.json`, `README.md`, and `site/index.html` — all pointing at
addresses that are no longer canonical — are corrected in the same change,
since the About page would otherwise ship a fourth wrong copy.

## Scope

**In:** a new About page in preferences; a QR code asset shipped with the
extension; correcting GitHub repository URLs repo-wide.

**Out:** the GitHub Pages workflow, translations, anything in the shell-side
UI, and the extension UUID `dasbo-island@ayubaswad.gmail.com` — changing that
orphans every existing install.

The GitHub Pages demo URL `https://fsevenm.github.io/dasbo-island/` stays as
it is. The site is still hosted there; only the repository moved.

## The page

An `Adw.PreferencesPage` titled "About", icon `help-about-symbolic`, added
fourth — after Agents.

### Group 1 — "Dasbo Island"

Information first, the ask last.

| Row | Type | Content |
| --- | --- | --- |
| Author | `Adw.ActionRow` | `fsevenm` |
| Version | `Adw.ActionRow` | `metadata['version-name']` — `0.1.0` today |
| License | `Adw.ActionRow` | `GPL-3.0-or-later` |
| GitHub | activatable `Adw.ActionRow` | `github.com/dasbo-dev/island-gnome` |
| Report an issue | activatable `Adw.ActionRow` | `github.com/dasbo-dev/island-gnome/issues` |

The two link rows are `activatable: true` and carry an
`external-link-symbolic` suffix, so the whole row is the target rather than a
small button at its end. Version reads `version-name` from the extension's own
metadata rather than a constant, so a release bump cannot leave the page
lying. If `version-name` is absent, the row falls back to `String(version)`.

### Group 2 — "Support"

Placed last. Its group description reads as one line: the extension is free
and GPL-licensed, and a coffee keeps it going.

- **Buy me a coffee** — a `Gtk.Button` with the `suggested-action` and `pill`
  CSS classes, full width, opening `https://buymeacoffee.com/fsevenm`. This is
  the page's visual weight; everything above it is a plain row.
- **Show QR code** — an `Adw.ExpanderRow`, subtitle "Scan with your phone to
  donate". It unfolds to a centred `Gtk.Picture` of the shipped QR pinned to
  200×200 logical pixels — square, as the source image is — with
  `buymeacoffee.com/fsevenm` as selectable text beneath it.

The expander header is the "Open QR code" affordance. An expander rather than
a dialog: the QR is a thing you hold a phone up to, and a modal you must
dismiss with one hand while aiming a camera with the other is worse than a
panel that stays open.

### Opening links

`Gtk.UriLauncher`, present in GTK 4.14 on Shell 46. Its `launch` callback
carries any failure — no browser, a sandboxed session — and on failure the
page raises an `Adw.Toast` containing the raw URL, so the address is still
reachable by copy.

## Modules

### `src/core/about.ts`

One frozen record. No `gi://` or `resource://` imports, so it stays inside
what `test/core/purity.test.ts` allows and a vitest can read it directly:

```ts
export const ABOUT = {
  author: 'fsevenm',
  repoUrl: 'https://github.com/dasbo-dev/island-gnome',
  issuesUrl: 'https://github.com/dasbo-dev/island-gnome/issues',
  supportUrl: 'https://buymeacoffee.com/fsevenm',
  license: 'GPL-3.0-or-later',
  qrAsset: 'assets/qr-code.png',
} as const
```

The point of the split is testability: a typo in a donation link inside a
GTK-importing module ships silently, because no test in this repo can import
that module.

### `src/prefs/about.ts`

```ts
export function aboutPage(
  window: Adw.PreferencesWindow,
  extensionPath: string,
  version: string
): Adw.PreferencesPage
```

Construction only. Every string it renders comes from `ABOUT` or its
arguments. It needs `window` for the failure toast, `extensionPath` to resolve
the QR file, and `version` because `ExtensionPreferences.metadata` is not its
to read.

### `src/prefs.ts`

Gains an import and one line in `fillPreferencesWindow`:

```ts
window.add(aboutPage(window, this.path, this._versionLabel()))
```

The three existing page builders are untouched. `_versionLabel()` is a small
private method holding the `version-name` fallback described above.

## Asset

The QR PNG is committed at `src/assets/qr-code.png` (104 KB) and `build.mjs`
gains `await cp('src/assets', 'dist/assets', { recursive: true })` beside the
existing `src/icons` copy. At runtime the expander resolves
`${extensionPath}/${ABOUT.qrAsset}`.

## Failure modes

A missing QR file is the interesting one: `Gtk.Picture` given a path that does
not exist renders an empty widget and reports nothing, which is exactly the
silent-death trap the agent chip marks already have. Two defences:

1. The expander stats the file before building the `Gtk.Picture`. If it is
   absent, the expander's child is the URL as selectable text and nothing
   else — a degraded panel rather than a blank one.
2. A build test pins the `cp('src/assets', 'dist/assets')` line, so deleting
   it fails CI rather than shipping.

A failed `Gtk.UriLauncher` raises a toast carrying the URL, as above. No other
path in the page can fail: the rest is static text.

## Tests

All vitest, none requiring GTK.

**`test/core/about.test.ts`**

- Every URL in `ABOUT` starts with `https://`.
- `ABOUT.repoUrl` equals the `url` field in `metadata.json` — the two are
  independent copies of the same fact, and this is what catches drift.
- `ABOUT.supportUrl` is exactly `https://buymeacoffee.com/fsevenm`.
- `ABOUT.license` is `GPL-3.0-or-later` and `LICENSE` contains the GPL v3
  header, so the row cannot claim a licence the repo does not ship.

**`test/prefs/aboutAssets.test.ts`** — imports `src/core/about.ts` only, never
`src/prefs/about.ts`, because `tsconfig.test.json` deliberately excludes the
gnome-shell ambient types.

- `src/assets/qr-code.png` exists and opens with the PNG magic bytes
  `89 50 4E 47`.
- `ABOUT.qrAsset` names that file.
- `build.mjs` still contains the `cp('src/assets', 'dist/assets')` line.

**`test/repoUrls.test.ts`**

- Neither `fsevenm/dasbo-island` nor `ayubaswad/dasbo-island` appears in
  `metadata.json`, `README.md`, or `site/index.html`.
- Each of those three files contains `dasbo-dev/island-gnome`, so the sweep
  cannot be satisfied by deleting the links rather than correcting them.

## URL sweep

| File | Change |
| --- | --- |
| `metadata.json` | `url` → `https://github.com/dasbo-dev/island-gnome` |
| `README.md` | holds no repository URL at all today — one is added under the title; demo link unchanged |
| `site/index.html` | repository and clone links → `dasbo-dev/island-gnome`; Pages URL unchanged |

## Verification

`npm test` and `npm run typecheck` pass. `make install`, then a shell restart,
then `gnome-extensions prefs dasbo-island@ayubaswad.gmail.com`: the About tab
is present and fourth, the two link rows open a browser, the coffee button is
accent-coloured and opens the donation page, and the expander reveals a QR
that a phone camera resolves to `buymeacoffee.com/fsevenm`.
