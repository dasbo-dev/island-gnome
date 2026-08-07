# Support Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the README and the landing page a modest Support section pointing at the same donation link the extension's About tab already carries.

**Architecture:** Two static-content edits (`README.md`, `site/index.html`) guarded by one new Vitest file that imports `ABOUT` from `src/core/about.ts`, so the URL has exactly one source of truth. No runtime code changes, no build changes, no new CSS.

**Tech Stack:** Markdown, plain HTML, TypeScript, Vitest.

## Global Constraints

- The support URL is `https://buymeacoffee.com/fsevenm`, and it comes from `ABOUT.supportUrl` in `src/core/about.ts`. Never introduce a second literal in code — tests must reference `ABOUT.supportUrl`, not the string.
- Modest weight only: plain heading plus one paragraph on both surfaces. No buttons, badges, QR images, or `.github/FUNDING.yml`.
- No new selectors in `site/site.css`. The landing-page section reuses the existing `section` / `h2` / `p` rules.
- The README must mention the support URL exactly once, after this change.
- Spec: `docs/superpowers/specs/2026-08-07-support-section-design.md`.

---

### Task 1: Support section in the README and on the landing page

**Files:**
- Create: `test/docs/support.test.ts`
- Modify: `README.md` (Contents list at line 49; new section between `## Contributing` at 216 and `## License` at 224; Credits paragraph ending at line 235)
- Modify: `site/index.html` (new section between the `#install` section's closing `</section>` and `</main>`)

**Interfaces:**
- Consumes: `ABOUT` from `src/core/about.ts` — specifically `ABOUT.supportUrl`, typed `'https://buymeacoffee.com/fsevenm'` (the object is `as const`). Test files under `test/` import it as `'../../src/core/about.js'`; see `test/core/about.test.ts:3` for the existing precedent.
- Produces: nothing importable. The deliverable is the two documents plus their guard test.

- [ ] **Step 1: Write the failing test**

Create `test/docs/support.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ABOUT } from '../../src/core/about.js'

const readme = readFileSync('README.md', 'utf8')
const landing = readFileSync('site/index.html', 'utf8')

// The About tab asks for support behind a suggested-action button and a QR
// code, but a user only reaches that tab after installing. These two files
// are what a prospective user reads instead, so the same address has to be
// on both — and it has to be the same address, which is why every assertion
// below goes through ABOUT.supportUrl rather than a second literal.
describe('the support section', () => {
  it('gives the README a section of its own, listed in the contents', () => {
    expect(readme).toContain('## Support')
    expect(readme).toContain('- [Support](#support)')
  })

  it('points the README at the address the About tab uses', () => {
    expect(readme).toContain(ABOUT.supportUrl)
  })

  // Not fussiness about repetition. The donation link used to live in the
  // last sentence of Credits, and moving it into its own section is the
  // whole point of that section: two asks eight lines apart read as a
  // pitch. Without this assertion, an edit that restores the Credits
  // sentence passes every other check here.
  it('asks exactly once', () => {
    const hits = readme.split(ABOUT.supportUrl).length - 1
    expect(hits, 'the README should carry the support URL once').toBe(1)
  })

  it('gives the landing page a support section pointing at the same address', () => {
    expect(landing).toContain('id="support"')
    expect(landing).toContain(ABOUT.supportUrl)
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run test/docs/support.test.ts`

Expected: FAIL. Four of the five assertions fail — the README has no `## Support` heading, no contents entry, and the landing page has neither `id="support"` nor the URL. The `asks exactly once` test passes already (the Credits sentence is the one occurrence); it starts guarding real behaviour once Step 3 moves that sentence.

- [ ] **Step 3: Add the README section, list it, and strip the Credits sentence**

Three edits to `README.md`.

First, the contents list — insert one line so it reads:

```markdown
- [Contributing](#contributing)
- [Support](#support)
- [License](#license)
- [Credits](#credits)
```

Second, insert a new section between the end of `## Contributing` and the `## License` heading. The result:

```markdown
## Support

Dasbo Island is free and GPL-licensed, and stays that way. If it saves you a
window switch or two, you can [buy me a coffee](https://buymeacoffee.com/fsevenm).
The extension's About tab carries the same link, with a QR code.

## License

[GPL-3.0-or-later](LICENSE).
```

Third, cut the donation sentence from `## Credits`, so the section ends:

```markdown
Built by [fsevenm](https://github.com/fsevenm).
```

The whole Credits section afterwards:

```markdown
## Credits

Inspired by [open-vibe-island](https://github.com/Octane0411/open-vibe-island),
rebuilt natively for GNOME Shell.

Built by [fsevenm](https://github.com/fsevenm).
```

- [ ] **Step 4: Add the landing-page section**

In `site/index.html`, insert this between the closing `</section>` of `<section id="install">` and the `</main>` that follows it:

```html
<section id="support">
  <h2>Support</h2>
  <p>Dasbo Island is free and GPL-3.0-or-later, and stays that way. If it saves you a window switch or two, you can <a href="https://buymeacoffee.com/fsevenm">buy me a coffee</a>.</p>
</section>
```

Do not add a matching link to `<footer>` and do not touch `site/site.css` — the plain `h2`/`p` inherit the page's existing section rules, which is why this needs no new selectors.

- [ ] **Step 5: Run the new test and watch it pass**

Run: `npx vitest run test/docs/support.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 6: Run the whole suite, the typechecker, and the build**

Run: `npm test && npm run typecheck && npm run build`

Expected: all Vitest files pass (`test/docs/links.test.ts` walks every relative link in the documentation set and `test/repoUrls.test.ts` covers `README.md` and `site/index.html`, so both are re-checked here), `typecheck` exits 0, and the build prints `built dist/ and dist-site/`.

If `npm test` reports a failure in `test/docs/readme.test.ts`, re-read its `has the sections a first-time reader scans for` case — it lists required headings, and none of them were removed by this change, so a failure there means an edit in Step 3 deleted more than the donation sentence.

- [ ] **Step 7: Commit**

```bash
git add README.md site/index.html test/docs/support.test.ts
git commit -m "docs: ask for support where people actually read

The About tab has a Support group with a button and a QR code, but a user
only sees it after installing. The README buried the same link in the last
sentence of Credits and the landing page never mentioned it.

Both now carry a plain Support section, Credits goes back to being credits,
and test/docs/support.test.ts pins every copy to ABOUT.supportUrl so the
address cannot drift from the one the extension itself opens."
```

---

## Verification

The plan is done when `npm test`, `npm run typecheck`, and `npm run build` all pass on the branch, `README.md` shows `## Support` between Contributing and License, and `dist-site/index.html` opened in a browser shows the Support section above the footer.
