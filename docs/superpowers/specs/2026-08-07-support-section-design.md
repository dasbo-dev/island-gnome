# Support section in the README and on the landing page

## Problem

The extension's About tab makes a clear ask: a "Support" group, a
suggested-action "Buy me a coffee" button, and a QR code for a phone camera.
Nobody reaches that tab without having already installed the extension.

The two surfaces a prospective user actually reads first say almost nothing.
The README mentions the donation link once, in the last sentence of Credits,
where it reads as a footnote to an attribution paragraph. The landing page at
`site/index.html` does not mention it at all.

## Scope

**In:** a `## Support` section in `README.md`; a support section in
`site/index.html`; a test that guards both against `ABOUT.supportUrl`.

**Out:** QR-code images on either surface, badge images, sponsor buttons,
`.github/FUNDING.yml`, changes to `build.mjs`, changes to the About tab, and
any new CSS in `site/site.css`.

The support URL itself does not change: `https://buymeacoffee.com/fsevenm`,
already defined as `ABOUT.supportUrl` in `src/core/about.ts`.

## Tone and weight

Modest, deliberately. The section is a plain heading and a short paragraph on
both surfaces — no button, no badge, no image, nothing above the fold. The
project is GPL-licensed and free, the ask is an ask, and the visual weight
matches that. The About tab keeps the loud version because a user who opened
it has already installed the thing.

## README

### The section

Placed between `## Contributing` and `## License`, so the two "ways to help"
asks sit together: contribute code, or buy a coffee.

```markdown
## Support

Dasbo Island is free and GPL-licensed, and stays that way. If it saves you a
window switch or two, you can [buy me a coffee](https://buymeacoffee.com/fsevenm).
The extension's About tab carries the same link, with a QR code.
```

### The Contents list

Gains `- [Support](#support)` between the Contributing and License entries, in
the same order as the sections themselves.

### Credits

Loses its donation sentence, ending at the attribution:

```markdown
Built by [fsevenm](https://github.com/fsevenm).
```

One ask, in one place. Credits reads as credits.

## Landing page

A new `<section id="support">` in `site/index.html`, after `#install` and
before `<footer>` — the last thing on the page before the licence line.

```html
<section id="support">
  <h2>Support</h2>
  <p>Dasbo Island is free and GPL-3.0-or-later, and stays that way. If it saves you a window switch or two, you can <a href="https://buymeacoffee.com/fsevenm">buy me a coffee</a>.</p>
</section>
```

Plain `h2` and `p`, so it inherits the page's existing section rules. No new
selectors in `site.css`, no `.button`, no `.cta`. The footer is left alone —
a second copy of the same link two lines below the first is noise.

## Test

New file `test/docs/support.test.ts`, alongside the other documentation
guards. It imports `ABOUT` from `src/core/about.js` and reads `README.md` and
`site/index.html` from disk, so a URL edited in `about.ts` alone fails the
suite rather than shipping two stale copies.

| Assertion | What it prevents |
| --- | --- |
| README contains `## Support` | The section being renamed or dropped |
| README contains `ABOUT.supportUrl` | The link drifting from the About tab's |
| README contains `- [Support](#support)` | A Contents list that skips the section |
| README contains `ABOUT.supportUrl` exactly once | The Credits sentence returning, restoring the duplicate ask |
| `site/index.html` contains `id="support"` | The section being dropped from the landing page |
| `site/index.html` contains `ABOUT.supportUrl` | The same drift, on the site |

The single-occurrence assertion is the one worth explaining in a comment in
the test: it is not fussiness about repetition, it is the specific regression
this change undoes, and without it a future edit re-adds the Credits line and
nothing complains.

## Verification

`npm test` (the new file plus `test/docs/links.test.ts`, which already walks
every relative link in the documentation set), `npm run typecheck`, and
`npm run build`. No runtime behaviour changes, so there is nothing to smoke
test in the shell; the landing page can be eyeballed by opening
`dist-site/index.html` after a build.
