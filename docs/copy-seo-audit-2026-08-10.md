# Landing page audit — copy + SEO

**Date:** 2026-08-10
**Scope:** `site/index.html` (deployed to GitHub Pages from `dist-site/` via
`.github/workflows/site.yml`), plus `site/site.css` and `build.mjs` where they
affect what ships.
**Method:** `copy-editing` seven sweeps (clarity, voice/tone, so-what,
prove-it, specificity, emotion, zero-risk) + `seo-audit` framework
(crawlability, indexation, on-page, content quality).
**Status:** findings only. No files were changed by this audit.

Every finding carries an ID, the evidence that produced it, and a concrete
fix. IDs prefixed `C` are copy, `S` are SEO. Nothing here invents a statistic,
a testimonial, or a claim the repo does not already support — items that need
a decision from the owner are marked **needs owner input**.

---

## Executive summary

The page is unusually honest and well written at the sentence level. Its
problems are structural, and they cluster in three places:

1. **Two accuracy defects that will burn a real user.** The hero promises
   inline permission answering for Codex, which Codex cannot do (C1). The
   install snippet does not work from a clean clone (C2). Both are worse than
   ordinary copy weaknesses because the page explicitly stakes its credibility
   on being accurate: *"Statuses are honest, not aspirational."*
2. **The page is invisible to search and to social.** No canonical, no
   `robots.txt`, no sitemap, no favicon, no OG image, no structured data, and
   ~503 visible words with zero targeted keywords (S1–S7). It ranks for its
   own product name and nothing else.
3. **The single biggest objection is never answered.** A shell extension that
   watches your coding sessions raises a privacy question on first read, and
   the page never says what does or does not leave the machine (C5).

Suggested order of work: **C1, C2, S1, S1b** (correctness and crawl basics) →
**S3, S4, S5, C5** (social/structured-data/objection) → everything else.

---

## Priority 1 — accuracy defects

### C1 · Hero promises Codex permission answering that does not exist

- **Impact:** High (credibility, and a broken promise to every Codex user)
- **Where:** `site/index.html:32`, and the feature card at `site/index.html:85`
- **Evidence:** The hero subhead reads *"keeps every live Claude Code and
  Codex session in the top bar — status at a glance, permission prompts
  answered inline."* The page's own table two screens down says Codex
  permission gating is `Notify-only` (`site/index.html:103`).
  `docs/limitations.md` § "Codex has no permission gate" states Codex's
  `PreToolUse` hook rejects an `allow`/`ask` decision outright and every Codex
  hook is installed notify-only. `README.md` states it as
  `no — notify-only`. The feature card *"Answer permissions from the bar"* has
  the same problem: it is unqualified and reads as applying to both agents.
- **Fix:** Scope the promise to the agent that can keep it. Either qualify in
  the hero (*"…status at a glance, Claude Code permission prompts answered
  inline, and one click back to the terminal…"*) or split the claim so the
  shared benefit (status, jump-back) stays universal and the permission
  benefit is attributed. Do the same in the card at line 85 — one clause
  naming Claude Code is enough.

### C2 · The install snippet fails from a clean clone

- **Impact:** High (the primary CTA's destination does not work)
- **Where:** `site/index.html:120-124`
- **Evidence:** The page instructs:
  ```
  git clone https://github.com/dasbo-dev/island-gnome.git
  cd island-gnome && make install
  gnome-extensions enable dasbo-island@ayubaswad.gmail.com
  ```
  `Makefile` defines `install: build`, and `build:` runs `npm run build`
  followed by `glib-compile-schemas dist/schemas`. A fresh clone has no
  `node_modules`, so `npm run build` fails before anything is installed. Two
  further gaps: `glib-compile-schemas` is an undeclared system dependency, and
  the Makefile's own success message is *"Installed. Log out and back in
  (X11), then: gnome-extensions enable …"* — the page drops the log-out step,
  without which `gnome-extensions enable` will not take effect on X11.
- **Fix:** Add `npm ci` before `make install`; name the `glib-compile-schemas`
  requirement (`libglib2.0-bin` / `glib2-devel`) alongside the GNOME Shell 46
  requirement; add the X11 log-out step before the enable line. Verify the
  corrected block end-to-end in a container or fresh checkout before shipping
  — this is exactly the kind of copy that gets written from memory.

---

## Priority 2 — SEO foundations

### S1 · No canonical URL

- **Impact:** High
- **Where:** `site/index.html:3-14` (`<head>`)
- **Evidence:** There is no `<link rel="canonical">`. GitHub Pages serves the
  same content at `/` and `/index.html`, and over the `github.io` host.
- **Fix:** Add a self-referencing absolute canonical to the deployed URL.

### S1b · `og:url` may point at a host the page is not served from — **needs owner input**

- **Impact:** High if wrong (breaks OG previews and any canonical derived from it)
- **Where:** `site/index.html:11`
- **Evidence:** `og:url` is `https://fsevenm.github.io/dasbo-island/`, and
  `README.md` links the live demo to the same URL. But every source link on
  the page and in `metadata.json` points to `github.com/dasbo-dev/island-gnome`,
  whose Pages deploy would live at `https://dasbo-dev.github.io/island-gnome/`.
  The local checkout has no configured git remote, so this could not be
  resolved from the repo.
- **Fix:** Confirm which host actually serves the page, then make `og:url`,
  the new canonical (S1), the sitemap (S2), and the README demo links all
  agree on that one absolute URL.

### S2 · No `robots.txt` and no `sitemap.xml`

- **Impact:** Medium
- **Where:** `build.mjs` (landing-page section) — `dist-site/` receives only
  `index.html`, `site.css`, `demo.js`, and `icons/`
- **Evidence:** Neither file exists in `site/` or is emitted by the build.
- **Fix:** Add both to `site/` and copy them in `build.mjs` next to the
  existing `index.html`/`site.css` copies. `robots.txt` should reference the
  sitemap. A one-page sitemap is still worth having — it is the cheapest way
  to hand Search Console a canonical URL and a `lastmod`.

### S3 · No OG/Twitter image, and `twitter:card` is `summary`

- **Impact:** Medium–High (every share of this link renders as a bare text card)
- **Where:** `site/index.html:8-12`
- **Evidence:** `og:title`, `og:description`, `og:type`, `og:url` and
  `twitter:card` are set; no `og:image`, `og:image:alt`, or `twitter:image`.
  `twitter:card` is `summary`, the small variant. The repo already has an
  illustration — `docs/assets/hero.svg`, used in the README — and `build.mjs`
  does not copy it to `dist-site/`.
- **Fix:** Produce a 1200×630 raster (PNG or JPG — most crawlers do not render
  SVG for OG images) from the existing hero mockup, ship it via `build.mjs`,
  reference it with an absolute URL, add `og:image:alt`, and switch
  `twitter:card` to `summary_large_image`.

### S4 · No favicon

- **Impact:** Low–Medium (tab and bookmark identity; a small trust signal)
- **Evidence:** No `<link rel="icon">`; nothing icon-shaped in `dist-site/`
  except the agent chips under `icons/`.
- **Fix:** `src/assets/logo-light.svg` / `logo-dark.svg` already exist. Ship an
  `.ico` or SVG favicon plus an `apple-touch-icon`.

### S5 · No structured data

- **Impact:** Medium
- **Evidence:** No JSON-LD anywhere in `site/index.html`.
- **Fix:** Add a `SoftwareApplication` JSON-LD block. This page is an unusually
  good fit for it: `applicationCategory` (DeveloperApplication),
  `operatingSystem` (`Linux, GNOME Shell 46`), `license`
  (GPL-3.0-or-later), `offers` with `price: "0"`, `softwareVersion` from
  `metadata.json` (`0.1.0`), and `downloadUrl`. Only assert fields the repo
  already supports — no `aggregateRating`, since there are no ratings.

### S6 · Thin content, no internal linking

- **Impact:** Medium
- **Evidence:** ~503 visible words on the only page of the site. Every link
  in `<main>` and the footer goes off-domain to GitHub or Buy Me a Coffee. The
  repo has genuinely useful long-form content — `docs/agent-dialects.md`,
  `docs/limitations.md` — that the site neither hosts nor links.
- **Fix:** Publish `agent-dialects` and `limitations` as pages of the site (the
  build already runs esbuild; a two-file markdown-to-HTML step is cheap) and
  link them from the relevant sections — the `Notify-only` cell (C13), the
  fixture-count cells (C14), and the fail-open section. This creates the only
  internally-linked cluster the domain has, and both pages target real
  long-tail queries.

### S7 · No keyword targeting

- **Impact:** Medium
- **Evidence:** Title, H1 and all five H2s are brand- or metaphor-led. The
  phrases a prospective user actually types — "gnome extension claude code",
  "claude code status bar linux", "gnome shell extension ai agent", "codex cli
  gnome" — appear nowhere in a heading. The H1 (`site/index.html:31`) does not
  contain "GNOME", "Claude Code", "Codex", or the product name.
- **Fix:** Choose one primary query and one secondary, then align the title,
  H1, and first 100 words. The subhead already contains the right nouns; the
  H1 is the piece giving away free ranking. Keep the metaphor if it earns its
  place, but get "GNOME" into the H1.

### S9 · Missing secondary meta

- **Impact:** Low
- **Evidence:** No `og:site_name`, no `og:locale`, no `theme-color`.
- **Fix:** Add all three. `theme-color` should match `--bg` (`#1c1f26`) from
  `site/site.css:10`.

### S10 · No 404 page

- **Impact:** Low
- **Fix:** Ship a `404.html` in `dist-site/` that links back to `/`.

### S8, S12 · Verified OK — no action

- **JS-dependent content:** `#popup-rows` (`site/index.html:39`) is replaced at
  runtime by `demo.js`, but the markup ships with a complete static fallback
  of two session rows. Crawlers see real content. No change needed.
- **Image alt text:** the agent chip images (`site/index.html:42,50`) use
  `alt=""`, which is correct — each is decorative next to a `.chip-name`
  span carrying the same information as text.

---

## Priority 3 — copy: persuasion and trust

### C5 · The privacy objection is never addressed

- **Impact:** High (this is the first question a cautious reader asks)
- **Evidence:** The page describes an extension that installs hooks into
  `~/.claude/settings.json` and `~/.codex/hooks.json` and watches every live
  session, and never states what happens to that data. There is no privacy
  statement, no "nothing leaves your machine", no telemetry disclosure.
- **Fix:** One sentence, in or beside the fail-open section, stating plainly
  what the extension reads and where it sends it. **Needs owner input** on the
  exact claim — do not write "no telemetry" until it is confirmed against the
  source. This is likely the highest-conversion sentence available on the page.

### C6 · No uninstall or reversibility statement

- **Impact:** Medium
- **Evidence:** `Makefile` provides `make uninstall`; the page never mentions
  it. The fail-open section covers "what if it crashes" but not "what if I
  don't like it".
- **Fix:** Add the uninstall line to the install section. For an unsigned
  extension installed from source, "here is how to remove it" lowers the bar
  to trying it.

### C8 · CTA label and destination disagree

- **Impact:** Medium
- **Where:** `site/index.html:34` → `site/index.html:118-120`
- **Evidence:** The primary button says **Install**. The section it jumps to
  opens with *"Requires GNOME Shell 46, X11 or Wayland. Not yet on
  extensions.gnome.org — for now, install from source."* The reader clicks
  expecting a download and lands on a caveat plus a `git clone`.
- **Fix:** Either relabel the button ("Install from source", "Get it") or
  reorder the section so the command block leads and the caveat follows.
  Setting the expectation before the click costs one word.

### C7 · Single CTA, top of page only

- **Impact:** Medium
- **Evidence:** The only CTA pair is in the hero (`site/index.html:33-36`). A
  reader who scrolls through states, features, the agent table and the
  fail-open guarantee — i.e. the most convinced reader on the page — is handed
  a Buy Me a Coffee link and a footer.
- **Fix:** Repeat the install CTA after the fail-open section, where the
  objection-handling peaks.

### C9 · No proof surfaced above the fold

- **Impact:** Medium
- **Evidence:** The page carries no social proof of any kind: no star count,
  no user numbers, no testimonials, no CI or license badge, no screenshot. The
  README has the CI badge, the license badge, the GNOME Shell badge, and the
  `docs/assets/hero.svg` mockup. The strongest proof the project owns —
  *"Verified against 17 real hook-payload fixtures"* — is buried in a table
  cell in the fourth section.
- **Fix:** Promote the fixture-verification fact near the hero, in the
  project's own dry voice. Add the CI and license badges to the footer or
  hero. Do **not** invent counts or testimonials; if star/download numbers are
  wanted, wire them to a real source or leave them out.

### C10 · "So what" gaps in three feature cards

- **Impact:** Medium
- **Evidence:**
  - `site/index.html:86` — *"Jump back to the session — Click a session row
    and land in the window the session started in."* Pure mechanic. The
    benefit (no hunting through fifteen terminal tabs) is left to the reader,
    even though the card above it states exactly that pain.
  - `site/index.html:87` — *"Watch the plan tick over"* describes what the UI
    displays, not why progress-at-a-glance changes the reader's day.
  - `site/index.html:89` — *"Know when it's waiting"* describes the row and
    the auto-opening popup, and stops before the payoff.
- **Fix:** Append a "which means…" clause to each. One sentence per card,
  matching the existing terse voice.

### C11 · The states section teaches choreography, not meaning

- **Impact:** Medium
- **Where:** `site/index.html:73-79`
- **Evidence:** The H2 promises *"One glance says what every session needs"*,
  then four of the five captions describe the animation rather than the
  meaning: *"one block breathes"*, *"a light runs clockwise"*, *"a diagonal
  pair holds"*, *"a green stagger"*. The bold state name carries the meaning;
  the clause after the dash spends the space on visual description.
- **Fix:** Keep one visual descriptor for recognisability, but make the clause
  earn its place — what the reader should do, or how the state arose. *"Error
  — the session stopped; the row says why."*

### C13 · `Notify-only` is unexplained and unlinked

- **Impact:** Medium
- **Where:** `site/index.html:103`
- **Evidence:** The table cell reads `Notify-only` with no gloss. `README.md`
  renders the same cell as `no — notify-only` with a link to
  `docs/limitations.md#codex-has-no-permission-gate`. The site strips both the
  `no` and the link, which is the difference between a caveat and a feature
  name — a reader could plausibly read "Notify-only" as a mode they chose.
- **Fix:** Match the README's phrasing and link the explanation. Pairs with C1
  and S6.

### C14 · The 17-fixture claim omits its own caveat

- **Impact:** Low–Medium
- **Where:** `site/index.html:98`
- **Evidence:** *"Verified against 17 real hook-payload fixtures."*
  `docs/limitations.md` § "Claude Code's SessionEnd and Notification are
  inferred" notes those two events are **not** among the 17 and are inferred
  from documented shapes. Fixture counts check out —
  `test/fixtures/claude/` holds 17 files and `test/fixtures/codex/` holds 6.
- **Fix:** The number is right; the framing over-reaches slightly on a page
  that advertises honest statuses. Link the cell to the limitations page
  (same fix as C13) rather than lengthening the cell.

### C12 · GNOME Shell 46-only support is stated too quietly

- **Impact:** Medium (bounce, not accuracy)
- **Where:** `site/index.html:120`
- **Evidence:** `metadata.json` declares `"shell-version": ["46"]` — 46 only,
  not 46+. The page says *"Requires GNOME Shell 46"*, which is accurate but
  reads as a minimum. A visitor on 47 or 48 discovers the exclusion only after
  cloning.
- **Fix:** State it unambiguously ("GNOME Shell 46 only — 47+ not yet
  supported") and move it above the fold or into the agent/requirements area,
  not one line above the command block. If broader support is planned, say so
  — that turns a dead end into a reason to star the repo.

---

## Priority 4 — copy: line-level

### C15 · 28 em dashes in ~503 words

- **Where:** throughout
- **Evidence:** Counted 28 `—` characters in the source. Nearly every
  paragraph and most captions use one, several use two.
- **Fix:** Keep the ones doing structural work; convert the rest to full
  stops, colons, or parentheses. Beyond rhythm, dense em-dash use is a listed
  AI-writing tell and reads as machine-generated to exactly the audience this
  page targets.

### C16 · Inconsistent contractions

- **Evidence:** *"you're needed"* (`:88`), *"it's waiting"* (`:89`),
  *"doesn't mute them"* (`:88`) sit alongside *"the one that is stuck"*
  (`:85`), *"the terminal that is running the work"* (`:32`), *"If the island
  is disabled"* (`:115`).
- **Fix:** Pick one register — the page's voice suits contractions — and apply
  it consistently. This is a voice-sweep issue, not grammar.

### C17 · "a few seconds later" is vague and understates the feature

- **Where:** `site/index.html:89`
- **Evidence:** The auto-close delay is the configurable `notification-seconds`
  setting, read at `src/shell/island.ts:370` and armed at `:384`, with `0`
  disabling auto-close entirely.
- **Fix:** Give the default value or say it is configurable. "Configurable"
  converts a vague detail into a feature.

### C18 · `src/core` means nothing to a first-time visitor

- **Where:** `site/index.html:58`
- **Evidence:** *"driven by the extension's real state machine — `src/core`
  bundled for the browser, not a mock."* The path is only meaningful to
  someone who has already opened the repo.
- **Fix:** Keep the claim, drop or gloss the path. *"…the extension's own
  state machine, compiled for the browser — not a mock."* The claim is a
  genuine differentiator and deserves a version everyone can parse.

### C19 · The strongest line on the page is a mid-page H2

- **Where:** `site/index.html:83`
- **Evidence:** *"Built for the moment an agent needs a human."* — the only
  sentence with any emotional charge. Meanwhile the hero opens with a
  definition: *"Dasbo Island is a GNOME Shell extension that…"*
- **Fix:** Consider promoting it, or a variant, into the hero, and demoting
  the definition to the subhead where it already partly lives. **Needs owner
  input** — this is a positioning call, not an edit.

### C20 · The pain is never painted

- **Evidence:** Emotion sweep finds nothing in the "before" state. The page
  never describes an agent sitting blocked on a permission prompt in a
  terminal the reader cannot see, or the twenty minutes lost to noticing late
  — which is the entire reason the product exists.
- **Fix:** One or two sentences in the hero or above the features grid. The
  page's dry register can carry this without becoming salesy; C19's line
  proves it.

### C3 · Title, meta description, OG description and subhead are the same text

- **Where:** `site/index.html:6-9`, `:32`
- **Evidence:** `og:title` duplicates `<title>` verbatim; `og:description`
  duplicates `<meta name="description">` verbatim; both descriptions are the
  hero subhead with light trimming. The meta description is 173 characters —
  above the ~160 where Google truncates. Title is 55 characters, which is fine.
- **Fix:** Not a defect, but four surfaces spending one message. Trim the meta
  description under 160 with the value up front, and let the OG description
  say something the title does not (the demo being real, say). Every one of
  these is a distinct impression in a distinct context.

### C4 · H1 carries no keyword and no product name

- **Where:** `site/index.html:31`
- **Evidence:** *"Your coding agents, on the top bar."* Good line. It does not
  say GNOME, does not say Claude Code or Codex, and does not name the product.
  Someone landing from search has to read the subhead to learn which desktop
  this is for.
- **Fix:** See S7 — this is the same finding from the copy side, and one edit
  closes both.

### C22 · Hardcoded date in the mock top bar will age

- **Where:** `site/index.html:19`
- **Evidence:** `<span class="clock">Wed Aug 5 14:32</span>` — a fixed date
  in a decorative GNOME top bar.
- **Fix:** Either render the current date from `demo.js` (with the static
  string as fallback) or drop the date and keep the time. Low stakes, but a
  visibly stale date on a page whose whole pitch is "this is live, not a
  mock" is an unfortunate contradiction.

### C23 · Footer trust signals are thin

- **Where:** `site/index.html:134-136`
- **Evidence:** License text, an attribution link, and a GitHub link. No link
  to the license file, the docs, the changelog, or any contact route.
- **Fix:** Add links to `LICENSE`, `CHANGELOG.md`, `SECURITY.md`, and the
  issue tracker. Cheap E-E-A-T signal and genuinely useful.

### C21 · Antigravity CLI is listed "Coming soon" while 12 fixtures exist — **needs owner input**

- **Where:** `site/index.html:106`
- **Evidence:** `test/fixtures/antigravity/` holds 12 captured payloads, and
  `src/core/adapters/antigravity.ts` exists. Recent commits
  (`c533b1d`, `a39e3d8`) show presenting Antigravity as coming soon *with no
  caveats attached* was a deliberate decision.
- **Fix:** No action proposed — flagged only so the position stays a conscious
  one, given the page's *"Statuses are honest, not aspirational"* claim sits
  four lines below the row. If Antigravity ships, this row and that claim
  should move together.

---

## Suggested implementation batches

**Batch 1 — correctness (ship first, small diff):** C1, C2, C13, C14.
Blocks nothing else and removes the two findings that can actively mislead a
user.

**Batch 2 — head and crawl basics:** S1, S1b, S3, S4, S5, S9, S2, S10.
Mostly `<head>` edits plus a few files copied in `build.mjs`. S1b must be
resolved before S1, S2 and S3, since all three need the real absolute URL.

**Batch 3 — trust and conversion:** C5, C6, C7, C8, C9, C12.
C5 and C19 need owner decisions; the rest are straightforward.

**Batch 4 — message and line-level:** S7/C4 together, then C10, C11, C3, C15,
C16, C17, C18, C20, C22, C23.

**Batch 5 — content depth:** S6. The largest piece of work, and the only one
that changes the site's structure rather than its wording.

---

## Not found / verified clean

- `lang="en"` present on `<html>` (`site/index.html:2`).
- Viewport meta present and correct (`:5`).
- Heading hierarchy is valid: one H1, five H2s, H3s only inside cards. No
  skipped levels.
- Static fallback content exists for the JS-driven demo (S8).
- Decorative image alt text is correct (S12).
- HTTPS is guaranteed by GitHub Pages; no mixed content on the page.
- No external fonts, no render-blocking third-party scripts; `demo.js` is a
  single minified 17 KB module with sourcemaps disabled for the site build
  (`build.mjs`). Speed is unlikely to be a ranking factor here.
- No internationalisation, so no hreflang findings apply.
