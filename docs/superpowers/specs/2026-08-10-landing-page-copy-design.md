# Landing page: fix the copy and the SEO foundations

**Date:** 2026-08-10
**Issue:** DIS-10 ("Fix landing page copy"), findings from DIS-8
**Source audit:** `docs/copy-seo-audit-2026-08-10.md`
**Scope:** every finding in that audit — all 22 copy findings (C1–C23) and all
ten SEO findings (S1–S10). The owner chose the full scope over a copy-only run.

## Why this work

The audit found three clusters of problems. Two of them are accuracy defects
that mislead a real user: the hero promises Codex permission answering the
product cannot do, and the install snippet fails from a clean clone. Both sit
on a page that stakes its credibility on the line *"Statuses are honest, not
aspirational."* The third cluster is absence: no canonical, no sitemap, no OG
image, no favicon, no structured data, and an H1 that names neither the desktop
nor the agents, so the page is invisible to search and renders as a bare text
card when shared.

Underneath both clusters is one structural cause. The site restates what
`docs/limitations.md` and `README.md` already say, in its own words, with no
link back — so the two copies drift, and the site's copy is the one that drifts
into optimism. C1 and C13 are both instances of that. Publishing the docs as
pages of the site (S6) and linking the table cells to them removes the reason
to restate anything.

## Decisions taken before design

Four questions could not be answered from the repository. The owner answered
them:

1. **Scope:** the whole audit, not copy alone.
2. **Canonical host:** `https://dasbo-dev.github.io/island-gnome/`. The current
   `og:url` (`fsevenm.github.io/dasbo-island`) is wrong and the README's demo
   link is wrong with it; both change.
3. **Privacy claim (C5):** approved for the page. Verified independently
   against the source — there is no `fetch`, no libsoup, no curl or wget, and
   no network call of any kind in `src/` or `hooks/dasbo-hook`. The hook helper
   talks to the extension over the session bus (`org.dasbo.Island`) and nowhere
   else.
4. **GNOME 47/48 support (C12):** the owner asked whether it works on newer
   shells. It does not, and the page will say support is *planned*. Static
   analysis found two blockers: `src/shell/gridIcon.ts:57` types theme colours
   as `Clutter.Color`, which GNOME 47 replaced with `Cogl.Color`; and eight
   `St.BoxLayout({ vertical: true })` sites (`sessionRow.ts:69,75,230,255`,
   `taskList.ts:51`, `questionPanel.ts:52,70`) use a property GNOME 48 dropped
   in favour of `orientation`. `metadata.json` declares `["46"]`, so 47+
   refuses to load the extension regardless. The port is code work and belongs
   in its own issue.

Two findings resolve to no action. **C19** (promote the mid-page H2 into the
hero) was declined: the owner chose to keep the existing metaphor H1 and add
the keyword to it instead. **C21** (Antigravity listed coming-soon while twelve
fixtures exist) was already a deliberate decision in commits `c533b1d` and
`a39e3d8`; the audit flagged it only so it stays conscious.

## Architecture

The page is a single static HTML file copied into `dist-site/` by `build.mjs`
and deployed to GitHub Pages by `.github/workflows/site.yml`. Nothing about
that changes. Three things are added to it:

**Committed binary assets.** The OG image, favicon, and apple-touch-icon are
rendered once on a developer machine and committed to `site/`. `build.mjs` only
copies them. The alternative — rendering them in CI — means installing an SVG
rasteriser into the deploy job for files that change once a year, and the CI
runner has neither a rasteriser nor a browser.

**Static crawl files.** `robots.txt`, `sitemap.xml`, and `404.html` live in
`site/` as plain files and are copied like `index.html` already is.

**A markdown-to-HTML step.** `marked` joins devDependencies. `build.mjs`
renders `docs/agent-dialects.md` and `docs/limitations.md` into
`dist-site/agent-dialects.html` and `dist-site/limitations.html` through a
shared template. Markdown stays the single source of truth, which is the point:
hand-authored copies of 23 KB of prose would drift, and drift is what produced
C1 and C13 in the first place.

Two renderer details are load-bearing, not incidental:

- `marked` v12+ does not emit heading IDs. The renderer slugifies headings so
  `limitations.html#codex-has-no-permission-gate` resolves — that anchor is the
  destination of the C13 link, and without IDs the link lands at the top of the
  page and the fix is silently useless.
- Links inside the markdown that point at sibling docs (`docs/limitations.md`)
  are rewritten to their published equivalents (`limitations.html`). Otherwise
  the hosted pages link back out to raw files on GitHub and S6's internal
  cluster does not exist.

## Content changes

### Correctness

**C1 — hero over-promises Codex permission answering.** The subhead attributes
the permission claim to the agent that can keep it:

> Dasbo Island is a GNOME Shell extension that keeps every live Claude Code and
> Codex session in the top bar: status at a glance, Claude Code permission
> prompts answered inline, and one click back to the terminal that's running
> the work.

The `Answer permissions from the bar` card gains the same qualification, naming
Codex as notify-only.

**C2 — install snippet fails from a clean clone.** `make install` runs
`npm run build`, which needs `node_modules` a fresh clone does not have. The
snippet becomes:

```
git clone https://github.com/dasbo-dev/island-gnome.git
cd island-gnome
npm ci
make install
# X11: log out and back in before the next line
gnome-extensions enable dasbo-island@ayubaswad.gmail.com
```

The requirements line names Node 22 and `glib-compile-schemas`
(`libglib2.0-bin` on Debian/Ubuntu, `glib2-devel` on Fedora). The log-out step
comes from the Makefile's own success message, which the page had dropped.

**C13, C14 — table honesty.** The Codex permission cell becomes
`No — notify-only`, matching the README rather than reading as a mode the user
chose, and links to `limitations.html#codex-has-no-permission-gate`. Both
fixture-count cells link to the limitations page, which carries the caveat that
`SessionEnd` and `Notification` are inferred rather than fixture-backed.

### Head, crawl, and search

- **S1, S1b:** self-referencing canonical, and `og:url` corrected, both to
  `https://dasbo-dev.github.io/island-gnome/`. README's demo link follows.
- **S2:** `robots.txt` referencing the sitemap; `sitemap.xml` listing all three
  published pages.
- **S3:** `og-image.png` at 1200×630 rendered from `docs/assets/hero.svg`,
  referenced absolutely, with `og:image:alt`; `twitter:card` becomes
  `summary_large_image`.
- **S4:** `favicon.svg` from `src/assets/logo-dark.svg`, plus
  `apple-touch-icon.png`.
- **S5:** `SoftwareApplication` JSON-LD — DeveloperApplication,
  `Linux, GNOME Shell 46`, GPL-3.0-or-later, `price: "0"`, `softwareVersion`
  `0.1.0` from `metadata.json`, `downloadUrl`. No `aggregateRating`; there are
  no ratings.
- **S9:** `og:site_name`, `og:locale`, `theme-color: #1c1f26` (matching `--bg`).
- **S10:** `404.html` linking back to `/`.
- **S7, C4:** the H1 becomes *"Your coding agents, on the GNOME top bar."* —
  the metaphor kept, the keyword added. Primary query
  "gnome extension claude code", secondary "claude code status bar linux";
  title, H1, and first 100 words align on them.
- **C3:** meta description trimmed under 160 characters with the value first;
  the OG description is rewritten to say something the title does not (that the
  demo is the extension's real state machine).

### Trust and conversion

- **C5:** in the fail-open section — *"Nothing leaves your machine. Hook
  payloads travel from the agent to the extension over your session's D-Bus;
  the extension makes no network calls and collects no telemetry."*
- **C6:** the install section gains a removal path — remove the hooks from the
  preferences page, then `make uninstall`. Both halves are real:
  `planUninstall` (`src/core/install/plan.ts:211`) backs the prefs Remove
  button, and the Makefile target deletes the extension directory.
- **C8:** the primary CTA becomes **Install from source**, so the caveat it
  jumps to is not a surprise.
- **C7:** the install CTA repeats after the fail-open section, where the
  objection handling peaks.
- **C9, C12:** a fine-print line under the hero CTAs carries the strongest
  proof the project owns and the hardest constraint it has: verified against 17
  real Claude Code hook payloads and 6 from Codex; free and GPL-3.0-or-later;
  GNOME Shell 46 only, with 47 and 48 support planned. CI and licence badges go
  in the footer. No invented star counts, download numbers, or testimonials.

### Message and line level

- **C20:** two sentences above the features grid naming the pain the product
  exists for — an agent blocked in a terminal behind other windows, noticed
  twenty minutes late.
- **C10:** a "which means" clause on the three cards that stop at the mechanic
  (`Jump back to the session`, `Watch the plan tick over`,
  `Know when it's waiting`).
- **C11:** the state captions keep one visual cue and spend the rest of the
  clause on meaning — *"Error — a diagonal pair holds; the session stopped and
  the row says why."*
- **C17:** "a few seconds later" becomes the real, configurable value: five
  seconds by default (`notification-seconds`, schema default 5, 0 disables).
- **C18:** the demo note drops the `src/core` path and keeps the claim.
- **C22:** the mock top bar's hardcoded `Wed Aug 5 14:32` renders live from
  `demo.js`, keeping the static string as the no-JS fallback.
- **C15:** 28 em dashes reduced to the ones doing structural work — the state
  captions and table cells. The rest become full stops or colons.
- **C16:** contractions applied consistently ("that's running", "doesn't",
  "it's"), matching the register the page already mostly uses.
- **C23:** the footer gains links to `LICENSE`, `CHANGELOG.md`, `SECURITY.md`,
  and the issue tracker.

## Testing

The repository already guards every asset `build.mjs` copies, because a missing
copied file is invisible at runtime — `test/shell/iconAssets.test.ts`,
`test/prefs/aboutAssets.test.ts`, and `test/docs/readmeAssets.test.ts` all exist
for that reason. The new outputs get the same treatment:

1. **A `dist-site` manifest test.** Every expected output — `index.html`,
   `site.css`, `demo.js`, `icons/`, `og-image.png`, `favicon.svg`,
   `apple-touch-icon.png`, `robots.txt`, `sitemap.xml`, `404.html`,
   `agent-dialects.html`, `limitations.html` — must exist after a build.
2. **A link-integrity test.** Every same-origin `href` in `site/index.html`
   must resolve to a file the build emits, and every `#anchor` into the doc
   pages must exist in the rendered HTML. This is the test that would have
   caught a silently broken C13 link, and the one that keeps the S6 cluster
   honest as the docs change.

Manual verification before the branch is called done: `npm ci`, `npm test`,
`npm run typecheck`, `node build.mjs`, and the C2 snippet executed for real in a
throwaway clone using `make install DEST=/tmp/...` so the developer's installed
extension is untouched. The audit is explicit that this is the kind of copy
that gets written from memory, so it gets run rather than reasoned about.

## Work order

Five commits on one branch, each independently sensible:

1. **Correctness** — C1, C2, C13, C14. Ships first, smallest diff, removes the
   two findings that actively mislead.
2. **Head and crawl** — S1, S1b, S2, S3, S4, S5, S9, S10, C3, plus the
   committed image assets and their `build.mjs` copies.
3. **Trust and conversion** — C5, C6, C7, C8, C9, C12.
4. **Message and line level** — S7/C4, then C10, C11, C15, C16, C17, C18, C20,
   C22, C23.
5. **Docs pages** — S6: the `marked` dependency, the render step, the shared
   template, the internal links, and both new tests.

`CHANGELOG.md` gets an entry, matching how the repository has handled
documentation changes.

## Out of scope

- The GNOME 47/48 port (`Cogl.Color` migration and `St.BoxLayout` orientation).
  Established above as real code work; filed as a follow-up.
- The other two DIS-8 audits — `docs/copy-audit-extension-2026-08-10.md` and
  `docs/copy-audit-readme-community-2026-08-10.md`. This issue is the landing
  page.
- Any claim the repository does not already support: no star counts, no
  download numbers, no testimonials, no ratings in the structured data.
