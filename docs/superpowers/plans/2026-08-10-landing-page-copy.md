# Landing Page Copy and SEO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every finding in the DIS-8 landing page audit — the two accuracy defects, the missing SEO foundations, and the copy weaknesses — without inventing a single claim the repository does not already support.

**Architecture:** `site/index.html` stays a hand-written static page copied into `dist-site/` by `build.mjs`. Three things are added: committed image assets that the build only copies, three static crawl files, and a markdown-to-HTML step that publishes `docs/limitations.md` and `docs/agent-dialects.md` as pages of the site so the page can link to explanations on its own domain instead of restating them.

**Tech Stack:** Static HTML/CSS, TypeScript compiled by esbuild for `site/demo.ts`, `marked` for markdown rendering at build time, vitest for tests.

## Global Constraints

- **Deployed URL is `https://dasbo-dev.github.io/island-gnome/`.** Confirmed by the owner against the repo's earlier, now-stale, records. Every absolute URL — canonical, `og:url`, `og:image`, `twitter:image`, sitemap, JSON-LD — uses exactly this origin, with the trailing slash on the root.
- **Repository URL is `https://github.com/dasbo-dev/island-gnome`.** `test/repoUrls.test.ts` enforces this in `site/index.html`; do not introduce any other slug.
- **Never widen a claim past what the source supports.** Codex permission gating is notify-only (`docs/limitations.md` § "Codex has no permission gate"). Fixture counts are 17 Claude and 6 Codex. `metadata.json` declares `"shell-version": ["46"]` and `"version": "0.1.0"`. No star counts, download numbers, testimonials, or `aggregateRating`.
- **GNOME Shell support wording:** "GNOME Shell 46 only" everywhere; the hero adds "47 and 48 support is planned". Never "46+".
- **Privacy sentence is fixed text**, approved by the owner and verified against the source: "Nothing leaves your machine. Hook payloads travel from the agent to the extension over your session's D-Bus; the extension makes no network calls and collects no telemetry."
- **Em dashes are rationed.** Keep them only in the state captions and where they separate a term from its gloss. Elsewhere use full stops or colons.
- **Contractions throughout:** "that's", "doesn't", "it's", "can't".
- **Run `npx vitest run` after every task.** Baseline before this plan: 48 files, 731 tests, 0 failures.

---

### Task 1: Hero and install correctness (C1, C2)

The hero promises Codex permission answering the product cannot do, and the install snippet fails from a clean clone because `make install` runs `npm run build` against a `node_modules` that does not exist yet.

**Files:**
- Modify: `site/index.html:32` (hero subhead), `site/index.html:85` (permissions card), `site/index.html:120-123` (install section)
- Test: `test/site/indexCopy.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `test/site/indexCopy.test.ts`, a describe block named `the landing page copy` that later tasks add cases to.

- [ ] **Step 1: Write the failing test**

Create `test/site/indexCopy.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// The page's own fine print says "Statuses are honest, not aspirational".
// These cases are that claim, enforced. Each one failed against the page as
// audited on 2026-08-10 (docs/copy-seo-audit-2026-08-10.md).
const html = readFileSync('site/index.html', 'utf8')

describe('the landing page copy', () => {
  // C1. Codex's PreToolUse hook rejects an allow/ask decision outright, so
  // every Codex hook is installed notify-only. An unqualified "permission
  // prompts answered inline" in the hero is a promise to Codex users that
  // the table two screens down contradicts.
  it('attributes inline permission answering to Claude Code alone', () => {
    expect(html).toContain('Claude&nbsp;Code permission prompts answered inline')
    expect(html).not.toMatch(/top bar[^<]*status at a glance, permission prompts answered inline/)
  })

  it('says on the permissions card that Codex cannot be answered from the bar', () => {
    expect(html).toMatch(/Codex sessions notify but can't be answered from the bar/)
  })

  // C2. `make install` depends on `build`, which runs `npm run build`. A
  // fresh clone has no node_modules, so the snippet as published fails on
  // its second line.
  it('installs dependencies before it builds', () => {
    const snippet = html.match(/<pre><code>([\s\S]*?)<\/code><\/pre>/)?.[1] ?? ''
    expect(snippet).toContain('npm ci')
    expect(snippet.indexOf('npm ci')).toBeLessThan(snippet.indexOf('make install'))
  })

  // The Makefile's own success message says to log out first on X11. The
  // page had dropped it, so `gnome-extensions enable` silently does nothing.
  it('keeps the X11 log-out step the Makefile prints', () => {
    expect(html).toMatch(/log out and back in/)
  })

  it('names glib-compile-schemas as a build requirement', () => {
    expect(html).toContain('glib-compile-schemas')
    expect(html).toContain('libglib2.0-bin')
  })

  it('states the GNOME Shell 46 limit as a limit, not a floor', () => {
    expect(html).toContain('GNOME Shell 46 only')
    expect(html).not.toMatch(/Requires GNOME Shell 46,/)
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run test/site/indexCopy.test.ts`
Expected: FAIL — six failing cases, the first reporting that the string `Claude&nbsp;Code permission prompts answered inline` is absent.

- [ ] **Step 3: Fix the hero subhead**

In `site/index.html`, replace line 32:

```html
  <p class="sub">Dasbo Island is a GNOME Shell extension that keeps every live Claude&nbsp;Code and Codex session in the top bar — status at a glance, permission prompts answered inline, and one click back to the terminal that is running the work.</p>
```

with:

```html
  <p class="sub">Dasbo Island is a GNOME Shell extension that keeps every live Claude&nbsp;Code and Codex session in the top bar: status at a glance, Claude&nbsp;Code permission prompts answered inline, and one click back to the terminal that's running the work.</p>
```

- [ ] **Step 4: Fix the permissions card**

Replace line 85:

```html
    <div class="card"><h3>Answer permissions from the bar</h3><p>An agent asking to run a command blinks the pill. Allow or deny from the popup — no hunting through terminal windows for the one that is stuck.</p></div>
```

with:

```html
    <div class="card"><h3>Answer permissions from the bar</h3><p>A Claude&nbsp;Code agent asking to run a command blinks the pill. Allow or deny from the popup, with no hunting through terminal windows for the one that's stuck. Codex sessions notify but can't be answered from the bar.</p></div>
```

- [ ] **Step 5: Fix the install section**

Replace lines 120-123:

```html
  <p>Requires GNOME Shell 46, X11 or Wayland. Not yet on extensions.gnome.org — for now, install from source:</p>
  <pre><code>git clone https://github.com/dasbo-dev/island-gnome.git
cd island-gnome &amp;&amp; make install
gnome-extensions enable dasbo-island@ayubaswad.gmail.com</code></pre>
```

with:

```html
  <p>GNOME Shell 46 only, X11 or Wayland. Building needs Node 22 and <code>glib-compile-schemas</code> (<code>libglib2.0-bin</code> on Debian and Ubuntu, <code>glib2-devel</code> on Fedora). It isn't on extensions.gnome.org yet, so for now install from source:</p>
  <pre><code>git clone https://github.com/dasbo-dev/island-gnome.git
cd island-gnome
npm ci
make install
# X11: log out and back in before the next line
gnome-extensions enable dasbo-island@ayubaswad.gmail.com</code></pre>
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx vitest run`
Expected: PASS — 49 files, 737 tests, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add site/index.html test/site/indexCopy.test.ts
git commit -m "fix(site): stop promising Codex permissions and ship an install snippet that works

The hero sold inline permission answering to every Codex user; Codex's
PreToolUse hook rejects an allow decision outright, which the table two
screens down already said. And make install runs npm run build, so the
published snippet failed on its second line from a clean clone."
```

---

### Task 2: Publish the docs as pages of the site (S6, infrastructure)

The site restates what `docs/limitations.md` says instead of linking to it, because there was nowhere to link. This task builds the somewhere. Rendering happens at build time from the markdown, so the pages cannot drift from the docs — which is the failure mode that produced C1 and C13.

**Files:**
- Create: `site/docPages.mjs`, `site/doc-template.html`
- Modify: `build.mjs:40-55` (landing-page section), `site/site.css` (append), `package.json` (devDependencies)
- Test: `test/site/docPages.test.ts` (create)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `site/docPages.mjs` exporting `slug(text: string): string`, `withAnchors(html: string): string`, `rewriteDocLinks(html: string): string`, `renderDoc(markdown: string): string`, `renderPage(template: string, fields: {title: string, canonical: string, body: string}): string`, and `DOC_PAGES: Array<{source: string, out: string, title: string}>`. Task 3 links to `limitations.html#<anchor>`; Task 4 lists the outputs in the sitemap and the manifest test.

- [ ] **Step 1: Add the dependency**

Run: `npm install --save-dev marked`
Expected: `marked` appears under `devDependencies` in `package.json` and `package-lock.json` updates.

- [ ] **Step 2: Write the failing test**

Create `test/site/docPages.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { slug, withAnchors, rewriteDocLinks, renderDoc, renderPage, DOC_PAGES } from '../../site/docPages.mjs'

describe('the published doc pages', () => {
  // GitHub's anchor rule, matched character for character by
  // test/docs/links.test.ts. The markdown files link to each other with
  // GitHub anchors, so a different rule here publishes pages whose own
  // cross-links land at the top of the page and look like they worked.
  it('slugifies headings the way GitHub does', () => {
    expect(slug('Codex has no permission gate')).toBe('codex-has-no-permission-gate')
    expect(slug('Codex hooks written before 0.146.0 never fired')).toBe(
      'codex-hooks-written-before-01460-never-fired'
    )
    expect(slug("Claude Code's SessionEnd and Notification are inferred")).toBe(
      'claude-codes-sessionend-and-notification-are-inferred'
    )
  })

  it('gives every heading an id', () => {
    expect(withAnchors('<h3>Codex has no permission gate</h3>')).toBe(
      '<h3 id="codex-has-no-permission-gate">Codex has no permission gate</h3>'
    )
  })

  // A heading containing inline markup still needs a clean id.
  it('ignores inline markup when building an id', () => {
    expect(withAnchors('<h2>The <code>agy</code> dialect</h2>')).toContain('id="the-agy-dialect"')
  })

  it('rewrites markdown cross-links to their published form', () => {
    expect(rewriteDocLinks('<a href="docs/limitations.md#codex-has-no-permission-gate">x</a>')).toBe(
      '<a href="limitations.html#codex-has-no-permission-gate">x</a>'
    )
    expect(rewriteDocLinks('<a href="agent-dialects.md">x</a>')).toBe('<a href="agent-dialects.html">x</a>')
  })

  it('leaves absolute links alone', () => {
    const link = '<a href="https://github.com/dasbo-dev/island-gnome/blob/master/README.md">x</a>'
    expect(rewriteDocLinks(link)).toBe(link)
  })

  // The anchor index.html sends readers to, rendered from the real file.
  it('renders the limitations anchor the agent table links to', () => {
    const html = renderDoc(readFileSync('docs/limitations.md', 'utf8'))
    expect(html).toContain('id="codex-has-no-permission-gate"')
    expect(html).not.toMatch(/href="[^"]*\.md["#]/)
  })

  it('renders the dialects page with its tables intact', () => {
    const html = renderDoc(readFileSync('docs/agent-dialects.md', 'utf8'))
    expect(html).toContain('<table>')
    expect(html).toContain('id="claude-code--captured-complete"')
  })

  it('fills every placeholder in the template', () => {
    const page = renderPage(readFileSync('site/doc-template.html', 'utf8'), {
      title: 'Known limitations',
      canonical: 'https://dasbo-dev.github.io/island-gnome/limitations.html',
      body: '<p>hello</p>',
    })
    expect(page).not.toContain('{{')
    expect(page).toContain('<p>hello</p>')
    expect(page).toContain('<link rel="canonical" href="https://dasbo-dev.github.io/island-gnome/limitations.html">')
  })

  it('publishes both docs, and build.mjs writes them', () => {
    expect(DOC_PAGES.map((p) => p.out).sort()).toEqual(['agent-dialects.html', 'limitations.html'])
    expect(readFileSync('build.mjs', 'utf8')).toContain('DOC_PAGES')
  })
})
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `npx vitest run test/site/docPages.test.ts`
Expected: FAIL — the suite cannot resolve `../../site/docPages.mjs`.

- [ ] **Step 4: Write the renderer**

Create `site/docPages.mjs`:

```js
// Publishes docs/*.md as pages of the landing site. The markdown stays the
// single source of truth: the site restating what docs/limitations.md says,
// in its own words, is what produced findings C1 and C13 of the 2026-08-10
// audit. A page rendered from the file cannot drift from it.
import { marked } from 'marked'

export const DOC_PAGES = [
  { source: 'docs/limitations.md', out: 'limitations.html', title: 'Known limitations' },
  { source: 'docs/agent-dialects.md', out: 'agent-dialects.html', title: 'Agent hook dialects' },
]

// GitHub's own heading-anchor rule, the same one test/docs/links.test.ts
// implements: strip markup, lowercase, drop everything that is not a word
// character, space or hyphen, then join words with hyphens. Periods vanish
// rather than becoming separators — "0.146.0" becomes "01460".
export const slug = (text) =>
  text
    .replace(/<[^>]+>/g, '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')

// marked has moved its renderer API more than once; a pass over the rendered
// HTML outlives that. The ids are not decoration: index.html links straight
// to limitations.html#codex-has-no-permission-gate, and a missing anchor
// fails silently — the reader lands at the top of the page and never sees
// the caveat they were sent to read.
export const withAnchors = (html) =>
  html.replace(
    /<h([1-6])>([\s\S]*?)<\/h\1>/g,
    (_match, level, inner) => `<h${level} id="${slug(inner)}">${inner}</h${level}>`
  )

// The two docs link to each other by filename. Published as HTML they have to
// link to each other's published form, or the site's only internal link
// cluster leaks straight back out to GitHub.
export const rewriteDocLinks = (html) =>
  html.replace(/href="(?:\.\/)?(?:docs\/)?([\w.-]+)\.md(#[\w-]*)?"/g, (match, name, hash) =>
    match.startsWith('href="http') ? match : `href="${name}.html${hash ?? ''}"`
  )

export const renderDoc = (markdown) =>
  rewriteDocLinks(withAnchors(marked.parse(markdown, { async: false })))

export const renderPage = (template, { title, canonical, body }) =>
  template.replaceAll('{{title}}', title).replaceAll('{{canonical}}', canonical).replaceAll('{{body}}', body)
```

- [ ] **Step 5: Write the page template**

Create `site/doc-template.html`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{title}} — Dasbo Island</title>
<meta name="description" content="{{title}} for Dasbo Island, the GNOME Shell extension that keeps live Claude Code and Codex sessions in the top bar.">
<link rel="canonical" href="{{canonical}}">
<meta name="theme-color" content="#1c1f26">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="site.css">
</head>
<body>

<header class="topbar">
  <span class="activities"><a href="./">Dasbo Island</a></span>
</header>

<main class="doc">
{{body}}
<p class="fine"><a href="./">Back to the landing page</a></p>
</main>

<footer>
  <p>GPL-3.0-or-later · <a href="https://github.com/dasbo-dev/island-gnome">GitHub</a></p>
</footer>

</body>
</html>
```

- [ ] **Step 6: Render the pages in the build**

In `build.mjs`, change the import on line 2 from:

```js
import { cp, mkdir, rm } from 'node:fs/promises'
```

to:

```js
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
```

Then, immediately after line 54 (`await cp('src/icons', 'dist-site/icons', { recursive: true })`), add:

```js

// docs/*.md published as pages of the site, so the agent table can link its
// caveats to an explanation on this domain instead of restating them. See
// site/docPages.mjs for why the anchors and link rewriting matter.
const docTemplate = await readFile('site/doc-template.html', 'utf8')
for (const page of DOC_PAGES) {
  const body = renderDoc(await readFile(page.source, 'utf8'))
  await writeFile(
    `dist-site/${page.out}`,
    renderPage(docTemplate, { title: page.title, canonical: `${SITE_URL}${page.out}`, body })
  )
}
```

Add the import at the top of `build.mjs`, after the `esbuild` import on line 1:

```js
import { DOC_PAGES, renderDoc, renderPage } from './site/docPages.mjs'
```

And define the origin once, immediately above the `// ---- landing page` comment on line 40:

```js
// Every absolute URL the site emits — canonical, og:*, sitemap, JSON-LD —
// resolves against this one origin. GitHub Pages serves the same bytes at
// more than one path, so disagreement here is a live indexing bug.
const SITE_URL = 'https://dasbo-dev.github.io/island-gnome/'
```

- [ ] **Step 7: Style the published pages**

Append to `site/site.css`:

```css
/* ---- published docs (limitations.html, agent-dialects.html) ---- */
.topbar a { color: var(--fg); text-decoration: none; }
.doc { padding: 40px 0 64px; line-height: 1.65; }
.doc h1 { font-size: 2rem; margin-bottom: 20px; }
.doc h2 { font-size: 1.4rem; margin: 36px 0 12px; text-align: left; }
.doc h3 { font-size: 1.1rem; margin: 26px 0 8px; }
.doc p, .doc li { color: var(--fg-dim); }
.doc p { margin: 12px 0; }
.doc ul, .doc ol { margin: 12px 0 12px 22px; }
.doc code { background: rgba(255, 255, 255, 0.08); border-radius: 4px; padding: 1px 5px; font-size: 0.9em; }
.doc pre { background: #14161b; border: 1px solid var(--line); border-radius: 10px; padding: 16px; overflow-x: auto; font-size: 0.85rem; }
.doc pre code { background: none; padding: 0; }
.doc table { width: 100%; border-collapse: collapse; font-size: 0.9rem; margin: 16px 0; }
.doc th, .doc td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); }
.doc th { color: var(--fg); }
.doc blockquote { margin: 16px 0; padding-left: 14px; border-left: 3px solid var(--line); }
.doc hr { border: 0; border-top: 1px solid var(--line); margin: 32px 0; }
```

- [ ] **Step 8: Run the build and the tests**

Run: `node build.mjs && ls dist-site && npx vitest run`
Expected: `dist-site` lists `agent-dialects.html` and `limitations.html` alongside the existing files; vitest reports 50 files, 746 tests, 0 failures.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json build.mjs site/docPages.mjs site/doc-template.html site/site.css test/site/docPages.test.ts
git commit -m "feat(site): publish the limitations and dialects docs as pages

The site had nowhere on its own domain to send a reader who wanted the
detail behind a caveat, so it restated the caveat instead and the two
copies drifted. Rendering the markdown at build time makes drift
impossible; the heading ids and the .md link rewriting are what make the
anchors index.html is about to use actually resolve."
```

---

### Task 3: Agent table honesty and internal links (C13, C14)

The site strips both the `no` and the link from the README's `no — notify-only`, which is the difference between a caveat and a feature name.

**Files:**
- Modify: `site/index.html:98`, `site/index.html:103`, `site/index.html:109` (fine print), `site/index.html:115` (fail-open)
- Test: `test/site/links.test.ts` (create), `test/site/indexCopy.test.ts` (append)

**Interfaces:**
- Consumes: `renderDoc` and `DOC_PAGES` from `site/docPages.mjs` (Task 2), `test/site/indexCopy.test.ts` (Task 1).
- Produces: `test/site/links.test.ts`, which Task 4 extends with the new head assets.

- [ ] **Step 1: Write the failing link test**

Create `test/site/links.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { renderDoc, DOC_PAGES } from '../../site/docPages.mjs'

// A same-origin href on this page resolves against dist-site/, not against
// the repository, so a typo here is invisible to every other test in the
// suite and 404s only for the reader who clicks it. The audit's C13 fix is
// exactly such a link, pointing at an anchor in a file the build generates.
const html = readFileSync('site/index.html', 'utf8')
const hrefs = [...html.matchAll(/href="([^"]+)"/g)]
  .map((m) => m[1]!)
  .filter((h) => !/^(https?:|mailto:|#)/.test(h))

// What `node build.mjs` puts in dist-site/. Files copied straight from
// site/ are checked on disk; the two doc pages are generated, so they are
// listed here and their existence is guarded by docPages.test.ts.
const GENERATED = new Set(['demo.js', ...DOC_PAGES.map((p) => p.out)])

const rendered = new Map(DOC_PAGES.map((p) => [p.out, renderDoc(readFileSync(p.source, 'utf8'))]))

describe('the landing page links', () => {
  it('finds same-origin links to check', () => {
    expect(hrefs.length).toBeGreaterThan(0)
  })

  for (const href of hrefs) {
    const [path, hash] = href.split('#')

    it(`${href} points at a file the build emits`, () => {
      if (path === '' || path === undefined) return
      if (GENERATED.has(path)) return
      expect(existsSync(`site/${path}`) || existsSync(`src/icons/${path.replace(/^icons\//, '')}`)).toBe(true)
    })

    if (hash && path && rendered.has(path)) {
      it(`${href} points at an anchor that exists in ${path}`, () => {
        expect(rendered.get(path)).toContain(`id="${hash}"`)
      })
    }
  }
})
```

- [ ] **Step 2: Append the table cases to the copy test**

Add to `test/site/indexCopy.test.ts`, inside the existing `describe('the landing page copy', ...)` block:

```ts
  // C13. The README renders this cell as "no — notify-only" with a link to
  // the explanation. The site kept the phrase and dropped both the "no" and
  // the link, so it reads as a mode the user picked.
  it('matches the README on Codex permission gating, and links the reason', () => {
    expect(html).toContain('limitations.html#codex-has-no-permission-gate')
    expect(html).toMatch(/No — notify-only/)
  })

  // C14. Two of the events the page counts as verified are inferred rather
  // than fixture-backed, and the limitations page is where that is written
  // down. The number stays; the framing gets its footnote.
  it('links the fixture counts to the page that qualifies them', () => {
    expect(html).toContain('limitations.html#claude-codes-sessionend-and-notification-are-inferred')
    expect(html).toContain('limitations.html#codex-hooks-written-before-01460-never-fired')
  })
```

- [ ] **Step 3: Run both tests and watch them fail**

Run: `npx vitest run test/site/links.test.ts test/site/indexCopy.test.ts`
Expected: FAIL — the two new copy cases report the missing `limitations.html#…` strings. The link suite passes (there is nothing broken yet); it starts guarding once Step 4 adds the links.

- [ ] **Step 4: Link the table cells**

In `site/index.html`, replace line 98:

```html
      <tr><td>Claude Code</td><td>Yes</td><td>Verified against 17 real hook-payload fixtures</td><td>Yes</td></tr>
```

with:

```html
      <tr><td>Claude Code</td><td>Yes</td><td><a href="limitations.html#claude-codes-sessionend-and-notification-are-inferred">Verified against 17 real hook-payload fixtures</a></td><td>Yes</td></tr>
```

Replace line 103:

```html
      <tr><td>Codex CLI</td><td>Yes</td><td>Verified against 6 real hook-payload fixtures (0.146.0)</td><td>Notify-only</td></tr>
```

with:

```html
      <tr><td>Codex CLI</td><td>Yes</td><td><a href="limitations.html#codex-hooks-written-before-01460-never-fired">Verified against 6 real hook-payload fixtures (0.146.0)</a></td><td><a href="limitations.html#codex-has-no-permission-gate">No — notify-only</a></td></tr>
```

- [ ] **Step 5: Point the fine print at the new page**

Replace line 109:

```html
  <p class="fine">Statuses are honest, not aspirational — the details live in the <a href="https://github.com/dasbo-dev/island-gnome#supported-agents">README</a>.</p>
```

with:

```html
  <p class="fine">Statuses are honest, not aspirational. The details live in <a href="limitations.html">Known limitations</a> and the <a href="https://github.com/dasbo-dev/island-gnome#supported-agents">README</a>.</p>
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx vitest run`
Expected: PASS — the link suite now checks four same-origin links and three anchors; 0 failures.

- [ ] **Step 7: Commit**

```bash
git add site/index.html test/site/links.test.ts test/site/indexCopy.test.ts
git commit -m "fix(site): say no to Codex permission gating, and link the caveats

Notify-only with no gloss and no link reads as a mode you chose rather
than a limitation you inherit. The README has said no — notify-only all
along; now the site agrees with it and points at the explanation, and a
test fails if that anchor ever stops existing."
```

---

### Task 4: Head tags, crawl files, and image assets (S1, S1b, S2, S3, S4, S5, S9, S10, C3)

The page has no canonical, no sitemap, no favicon, no OG image, and no structured data, and its `og:url` points at a host that no longer serves it.

**Files:**
- Create: `site/robots.txt`, `site/sitemap.xml`, `site/404.html`, `site/favicon.svg`, `site/og-image.png`, `site/apple-touch-icon.png`, `tools/og-image.html`, `tools/touch-icon.html`
- Modify: `site/index.html:3-14` (head), `build.mjs` (copies), `README.md:16,26` (demo links), `test/repoUrls.test.ts:9` (stale comment)
- Test: `test/site/head.test.ts` (create), `test/site/buildOutputs.test.ts` (create)

**Interfaces:**
- Consumes: `SITE_URL` from `build.mjs` (Task 2), `DOC_PAGES` from `site/docPages.mjs` (Task 2).
- Produces: `site/favicon.svg` and `site/og-image.png`, referenced by `site/doc-template.html` (already) and `site/index.html`.

- [ ] **Step 1: Write the failing head test**

Create `test/site/head.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const html = readFileSync('site/index.html', 'utf8')
const ORIGIN = 'https://dasbo-dev.github.io/island-gnome/'

describe('the landing page head', () => {
  it('declares a self-referencing canonical', () => {
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}">`)
  })

  // og:url pointed at fsevenm.github.io/dasbo-island long after Pages moved.
  // Every absolute URL on the page has to agree, or the canonical, the
  // sitemap and the share card each claim a different home.
  it('agrees with itself on the origin', () => {
    const absolute = [...html.matchAll(/content="(https:\/\/[^"]+github\.io[^"]*)"/g)].map((m) => m[1]!)
    expect(absolute.length).toBeGreaterThan(0)
    for (const url of absolute) expect(url.startsWith(ORIGIN)).toBe(true)
  })

  // C3. 173 characters is past where Google truncates, and the description
  // was the subhead again anyway — four surfaces spending one message.
  it('keeps the meta description under 160 characters and off the OG copy', () => {
    const description = html.match(/<meta name="description" content="([^"]+)"/)?.[1] ?? ''
    const og = html.match(/<meta property="og:description" content="([^"]+)"/)?.[1] ?? ''
    expect(description.length).toBeLessThanOrEqual(160)
    expect(description.length).toBeGreaterThan(0)
    expect(og).not.toBe(description)
  })

  it('ships a large share card with alt text', () => {
    expect(html).toContain(`<meta property="og:image" content="${ORIGIN}og-image.png">`)
    expect(html).toContain('og:image:alt')
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">')
  })

  it('ships a favicon and a touch icon', () => {
    expect(html).toContain('rel="icon"')
    expect(html).toContain('rel="apple-touch-icon"')
  })

  it('carries the secondary meta the audit asked for', () => {
    expect(html).toContain('og:site_name')
    expect(html).toContain('og:locale')
    expect(html).toContain('<meta name="theme-color" content="#1c1f26">')
  })

  // S5. Only fields the repo can back. No aggregateRating — there are no
  // ratings, and inventing them is the one thing this page must not do.
  it('describes itself with valid SoftwareApplication JSON-LD', () => {
    const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? ''
    const data = JSON.parse(block)
    const version = JSON.parse(readFileSync('metadata.json', 'utf8')).version
    expect(data['@type']).toBe('SoftwareApplication')
    expect(data.softwareVersion).toBe(String(version))
    expect(data.operatingSystem).toContain('GNOME Shell 46')
    expect(data.offers.price).toBe('0')
    expect(data).not.toHaveProperty('aggregateRating')
  })

  // S7/C4. The H1 was the piece giving away free ranking: no desktop, no
  // agent, no product name.
  it('names the desktop in the H1', () => {
    const h1 = html.match(/<h1>([\s\S]*?)<\/h1>/)?.[1] ?? ''
    expect(h1).toContain('GNOME')
  })
})
```

- [ ] **Step 2: Write the failing build-output test**

Create `test/site/buildOutputs.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'

// A file build.mjs forgets to copy is invisible: the page renders, the
// crawler gets a 404, and nobody notices for a quarter. The same reasoning
// as test/shell/iconAssets.test.ts and test/prefs/aboutAssets.test.ts.
const build = readFileSync('build.mjs', 'utf8')

const COPIED = ['robots.txt', 'sitemap.xml', '404.html', 'og-image.png', 'favicon.svg', 'apple-touch-icon.png']

describe('the site build outputs', () => {
  for (const file of COPIED) {
    it(`site/${file} exists`, () => {
      expect(existsSync(`site/${file}`)).toBe(true)
    })

    it(`build.mjs copies ${file} into dist-site`, () => {
      expect(build).toContain(`'site/${file}'`)
    })
  }

  // A share card at the wrong size is cropped by every platform that
  // renders it, and nothing in the build would say so.
  it('renders the share card at 1200x630', () => {
    const png = readFileSync('site/og-image.png')
    expect(png.readUInt32BE(16)).toBe(1200)
    expect(png.readUInt32BE(20)).toBe(630)
  })

  it('renders the touch icon at 180x180', () => {
    const png = readFileSync('site/apple-touch-icon.png')
    expect(png.readUInt32BE(16)).toBe(180)
    expect(png.readUInt32BE(20)).toBe(180)
  })

  it('lists every published page in the sitemap', () => {
    const sitemap = readFileSync('site/sitemap.xml', 'utf8')
    for (const loc of ['island-gnome/', 'island-gnome/limitations.html', 'island-gnome/agent-dialects.html']) {
      expect(sitemap).toContain(`<loc>https://dasbo-dev.github.io/${loc}</loc>`)
    }
  })

  it('points robots.txt at the sitemap', () => {
    expect(readFileSync('site/robots.txt', 'utf8')).toContain(
      'Sitemap: https://dasbo-dev.github.io/island-gnome/sitemap.xml'
    )
  })
})
```

- [ ] **Step 3: Run both tests and watch them fail**

Run: `npx vitest run test/site/head.test.ts test/site/buildOutputs.test.ts`
Expected: FAIL — every case, starting with the missing canonical and the missing `site/robots.txt`.

- [ ] **Step 4: Render the image assets**

The CI runner has no SVG rasteriser and no browser, so these are rendered once here and committed. `tools/og-image.html` and `tools/touch-icon.html` are committed too, so the next person can re-render them.

Create `tools/og-image.html`:

```html
<!doctype html>
<!-- Source for site/og-image.png. Rendered once by hand, not in CI:
     the deploy runner has no rasteriser, and this file changes once a year.
     Re-render with the command in docs/superpowers/plans/2026-08-10-landing-page-copy.md. -->
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 28px; padding: 48px;
    background: radial-gradient(ellipse at 50% -20%, #2c3a4f 0%, #1c1f26 60%);
    font-family: "Cantarell", system-ui, sans-serif; color: #f6f5f4;
  }
  h1 { font-size: 54px; letter-spacing: -0.5px; }
  p { font-size: 26px; color: #b8b4b0; }
  img { width: 880px; }
</style>
</head>
<body>
  <h1>Your coding agents, on the GNOME top bar.</h1>
  <p>Claude Code and Codex sessions, live in the panel.</p>
  <img src="../docs/assets/hero.svg" alt="">
</body>
</html>
```

Create `tools/touch-icon.html`:

```html
<!doctype html>
<!-- Source for site/apple-touch-icon.png. See tools/og-image.html. -->
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; box-sizing: border-box; }
  body {
    width: 180px; height: 180px; display: flex; align-items: center; justify-content: center;
    background: #1c1f26;
  }
  img { width: 132px; height: 132px; }
</style>
</head>
<body>
  <img src="../src/assets/logo-dark.svg" alt="">
</body>
</html>
```

Then run, from the repository root:

```bash
cp src/assets/logo-dark.svg site/favicon.svg
google-chrome --headless --disable-gpu --hide-scrollbars --window-size=1200,630 \
  --screenshot="$PWD/site/og-image.png" "file://$PWD/tools/og-image.html"
google-chrome --headless --disable-gpu --hide-scrollbars --window-size=180,180 \
  --screenshot="$PWD/site/apple-touch-icon.png" "file://$PWD/tools/touch-icon.html"
```

Expected: three files in `site/`. Open `site/og-image.png` and confirm the mockup is legible and nothing is cut off; a cropped card is worse than none.

- [ ] **Step 5: Write the crawl files**

Create `site/robots.txt`:

```
User-agent: *
Allow: /

Sitemap: https://dasbo-dev.github.io/island-gnome/sitemap.xml
```

Create `site/sitemap.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://dasbo-dev.github.io/island-gnome/</loc>
    <lastmod>2026-08-10</lastmod>
  </url>
  <url>
    <loc>https://dasbo-dev.github.io/island-gnome/limitations.html</loc>
    <lastmod>2026-08-10</lastmod>
  </url>
  <url>
    <loc>https://dasbo-dev.github.io/island-gnome/agent-dialects.html</loc>
    <lastmod>2026-08-10</lastmod>
  </url>
</urlset>
```

Create `site/404.html`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Not found — Dasbo Island</title>
<meta name="robots" content="noindex">
<meta name="theme-color" content="#1c1f26">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="site.css">
</head>
<body>

<header class="topbar">
  <span class="activities"><a href="./">Dasbo Island</a></span>
</header>

<main>
<section class="hero">
  <h1>That page isn't here.</h1>
  <p class="sub">The link may be old, or the page may have moved.</p>
  <p class="cta">
    <a class="button primary" href="./">Landing page</a>
    <a class="button" href="limitations.html">Known limitations</a>
  </p>
</section>
</main>

<footer>
  <p>GPL-3.0-or-later · <a href="https://github.com/dasbo-dev/island-gnome">GitHub</a></p>
</footer>

</body>
</html>
```

- [ ] **Step 6: Copy the new files in the build**

In `build.mjs`, immediately after `await cp('site/site.css', 'dist-site/site.css')`, add:

```js
for (const file of ['robots.txt', 'sitemap.xml', '404.html', 'og-image.png', 'favicon.svg', 'apple-touch-icon.png']) {
  await cp(`site/${file}`, `dist-site/${file}`)
}
```

- [ ] **Step 7: Replace the head**

In `site/index.html`, replace lines 3-14 (the whole `<head>` element) with:

```html
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dasbo Island — your coding agents, on the GNOME top bar</title>
<meta name="description" content="GNOME Shell extension for Claude Code and Codex: every live session in the top bar, Claude Code permissions answered inline, one click back to the terminal.">
<link rel="canonical" href="https://dasbo-dev.github.io/island-gnome/">
<meta name="theme-color" content="#1c1f26">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<meta property="og:title" content="Dasbo Island — your coding agents, on the GNOME top bar">
<meta property="og:description" content="The pill and popup on the page are the extension's own state machine, compiled for the browser. Free, GPL-3.0-or-later, GNOME Shell 46.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://dasbo-dev.github.io/island-gnome/">
<meta property="og:site_name" content="Dasbo Island">
<meta property="og:locale" content="en_US">
<meta property="og:image" content="https://dasbo-dev.github.io/island-gnome/og-image.png">
<meta property="og:image:alt" content="The Dasbo Island pill in a GNOME top bar, above a popup listing two live coding sessions.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://dasbo-dev.github.io/island-gnome/og-image.png">
<link rel="stylesheet" href="site.css">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Dasbo Island",
  "applicationCategory": "DeveloperApplication",
  "operatingSystem": "Linux, GNOME Shell 46",
  "softwareVersion": "0.1.0",
  "license": "https://www.gnu.org/licenses/gpl-3.0.html",
  "url": "https://dasbo-dev.github.io/island-gnome/",
  "downloadUrl": "https://github.com/dasbo-dev/island-gnome",
  "image": "https://dasbo-dev.github.io/island-gnome/og-image.png",
  "description": "A GNOME Shell extension that keeps every live Claude Code and Codex session in the top bar.",
  "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" }
}
</script>
</head>
```

- [ ] **Step 8: Put GNOME in the H1**

Replace line 31 (numbering has shifted; match on the text):

```html
  <h1>Your coding agents, on the top&nbsp;bar.</h1>
```

with:

```html
  <h1>Your coding agents, on the GNOME top&nbsp;bar.</h1>
```

- [ ] **Step 9: Correct the README's demo links and the stale test comment**

In `README.md`, replace both occurrences of `https://fsevenm.github.io/dasbo-island/` (lines 16 and 26) with `https://dasbo-dev.github.io/island-gnome/`.

In `test/repoUrls.test.ts`, replace the comment on lines 9-11:

```ts
// The Pages URL fsevenm.github.io/dasbo-island is deliberately NOT swept —
// the site is still served from there. Only the repository moved.
```

with:

```ts
// Pages has since followed the repository: the site is served from
// dasbo-dev.github.io/island-gnome, and the old fsevenm.github.io/dasbo-island
// URL is gone from the tree. The case below is what keeps it gone.
```

and add this case inside the existing `describe('the repository URL', ...)` block:

```ts
  it('has no reference left to the old Pages host', () => {
    for (const file of [...FILES, 'site/doc-template.html']) {
      expect(readFileSync(file, 'utf8'), `${file} still points at the old Pages host`).not.toContain(
        'fsevenm.github.io'
      )
    }
  })
```

- [ ] **Step 10: Run the tests and the build**

Run: `npx vitest run && node build.mjs && ls dist-site`
Expected: PASS with 0 failures, and `dist-site` containing `404.html`, `agent-dialects.html`, `apple-touch-icon.png`, `demo.js`, `favicon.svg`, `icons`, `index.html`, `limitations.html`, `og-image.png`, `robots.txt`, `site.css`, `sitemap.xml`.

- [ ] **Step 11: Commit**

```bash
git add site/index.html site/robots.txt site/sitemap.xml site/404.html site/favicon.svg site/og-image.png site/apple-touch-icon.png tools/og-image.html tools/touch-icon.html build.mjs README.md test/repoUrls.test.ts test/site/head.test.ts test/site/buildOutputs.test.ts
git commit -m "feat(site): give the page a canonical, a share card, and an identity

The page had no canonical, no sitemap, no favicon, no share image and no
structured data, and its og:url still named the host Pages left. Every
absolute URL now resolves against one origin, and a test fails if they
ever disagree again. The H1 finally says GNOME."
```

---

### Task 5: Trust and conversion (C5, C6, C7, C8, C9, C12)

The page never answers the privacy question, never says how to remove the thing, labels its CTA `Install` and lands the reader on a caveat, and buries its only real proof in a table cell four sections down.

**Files:**
- Modify: `site/index.html` — hero CTA block, `#failopen` section, `#install` section
- Test: `test/site/indexCopy.test.ts` (append)

**Interfaces:**
- Consumes: `test/site/indexCopy.test.ts` (Tasks 1 and 3).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing tests**

Add to `test/site/indexCopy.test.ts`, inside `describe('the landing page copy', ...)`:

```ts
  // C5. The extension installs hooks into ~/.claude/settings.json and
  // watches every live session. The page never said where that data goes.
  // Verified against the source before it was written: no fetch, no
  // libsoup, no curl — the hook helper speaks session D-Bus and nothing else.
  it('answers the privacy question it raises', () => {
    expect(html).toContain('Nothing leaves your machine.')
    expect(html).toContain('makes no network calls and collects no telemetry')
  })

  // C6. For an unsigned extension installed from source, "here is how to
  // remove it" lowers the bar to trying it.
  it('says how to remove it', () => {
    expect(html).toContain('make uninstall')
  })

  // C8. The button said Install and landed the reader on "not yet on
  // extensions.gnome.org" plus a git clone.
  it('labels the CTA with what actually happens', () => {
    expect(html).toContain('>Install from source<')
  })

  // C7. The most convinced reader on the page — the one who got through the
  // fail-open guarantee — was handed a footer.
  it('repeats the CTA after the objection handling', () => {
    const failopen = html.match(/<section id="failopen">([\s\S]*?)<\/section>/)?.[1] ?? ''
    expect(failopen).toContain('href="#install"')
  })

  // C9 and C12. The strongest proof the project owns was a table cell in the
  // fourth section, and the hardest constraint it has was one line above a
  // command block.
  it('puts the proof and the version limit above the fold', () => {
    const hero = html.match(/<section class="hero">([\s\S]*?)<div class="popup">/)?.[1] ?? ''
    expect(hero).toContain('17 real Claude&nbsp;Code hook payloads')
    expect(hero).toContain('GNOME Shell 46 only')
    expect(hero).toContain('47 and 48 support is planned')
  })
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run test/site/indexCopy.test.ts`
Expected: FAIL — five new cases, starting with the missing "Nothing leaves your machine."

- [ ] **Step 3: Rework the hero CTA block**

Replace the `<p class="cta">` block in the hero:

```html
  <p class="cta">
    <a class="button primary" href="#install">Install</a>
    <a class="button" href="https://github.com/dasbo-dev/island-gnome">GitHub</a>
  </p>
```

with:

```html
  <p class="cta">
    <a class="button primary" href="#install">Install from source</a>
    <a class="button" href="https://github.com/dasbo-dev/island-gnome">GitHub</a>
  </p>
  <p class="fine">Verified against 17 real Claude&nbsp;Code hook payloads and 6 from Codex. Free and GPL-3.0-or-later. GNOME Shell 46 only; 47 and 48 support is planned.</p>
```

- [ ] **Step 4: Add the privacy sentence and the second CTA**

Replace the `#failopen` section:

```html
<section id="failopen">
  <h2>Fail-open, guaranteed.</h2>
  <p>The hook helper exits 0 with empty stdout on every error path. If the island is disabled, crashed, or never installed, your agents behave exactly as they would without it — a session can never hang on this extension.</p>
</section>
```

with:

```html
<section id="failopen">
  <h2>Fail-open, guaranteed.</h2>
  <p>The hook helper exits 0 with empty stdout on every error path. If the island is disabled, crashed, or never installed, your agents behave exactly as they would without it. A session can never hang on this extension.</p>
  <p>Nothing leaves your machine. Hook payloads travel from the agent to the extension over your session's D-Bus; the extension makes no network calls and collects no telemetry.</p>
  <p class="cta"><a class="button primary" href="#install">Install from source</a></p>
</section>
```

- [ ] **Step 5: Add the removal path**

In the `#install` section, after the existing `<p class="fine">` about preferences, add:

```html
  <p class="fine">Changed your mind? Remove the hooks from that same preferences page, then <code>make uninstall</code>.</p>
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx vitest run`
Expected: PASS, 0 failures.

- [ ] **Step 7: Check it in a browser**

Run: `node build.mjs && python3 -m http.server 8000 --directory dist-site`
Open `http://localhost:8000/` and confirm the hero fine print does not crowd the popup mockup, and the second CTA sits centred under the fail-open text. Stop the server with Ctrl-C.

- [ ] **Step 8: Commit**

```bash
git add site/index.html test/site/indexCopy.test.ts
git commit -m "feat(site): answer the privacy question, and stop hiding the proof

A shell extension that watches your sessions raises one question on
first read, and the page never answered it. It also buried the only hard
evidence it owns in a table cell, labelled its button for a download it
does not offer, and never mentioned that 46 is a ceiling, not a floor."
```

---

### Task 6: Message and line level (C10, C11, C15, C16, C17, C18, C20, C22, C23)

Three feature cards stop at the mechanic, the state captions describe animation instead of meaning, 28 em dashes in 503 words read as machine-written, and the mock top bar has been showing the same date since August.

**Files:**
- Create: `site/clock.ts`
- Modify: `site/index.html` (features, states, demo note, footer, top bar), `site/demo.ts` (clock wiring)
- Test: `test/site/clock.test.ts` (create), `test/site/indexCopy.test.ts` (append)

**Interfaces:**
- Consumes: `test/site/indexCopy.test.ts` (Tasks 1, 3, 5).
- Produces: `site/clock.ts` exporting `clockText(date: Date): string`, imported by `site/demo.ts`.

- [ ] **Step 1: Write the failing clock test**

Create `test/site/clock.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { clockText } from '../../site/clock.js'

// C22. The mock top bar shipped "Wed Aug 5 14:32" as a literal, on a page
// whose whole pitch is that the demo is real and not a mock. A visibly
// stale date undercuts that for free.
describe('the mock top bar clock', () => {
  it('formats a date the way GNOME does', () => {
    expect(clockText(new Date(2026, 7, 5, 14, 32))).toBe('Wed Aug 5 14:32')
  })

  it('pads the minutes, not the day', () => {
    expect(clockText(new Date(2026, 0, 9, 9, 5))).toBe('Fri Jan 9 09:05')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/site/clock.test.ts`
Expected: FAIL — cannot resolve `../../site/clock.js`.

- [ ] **Step 3: Write the clock**

Create `site/clock.ts`:

```ts
// GNOME's own top-bar format: short weekday, short month, unpadded day,
// 24-hour time. Kept out of demo.ts so it can be tested without a DOM.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function clockText(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${DAYS[date.getDay()]} ${MONTHS[date.getMonth()]} ${date.getDate()} ${hours}:${minutes}`
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run test/site/clock.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Wire the clock into the demo**

In `site/demo.ts`, add to the imports at the top of the file:

```ts
import { clockText } from './clock.js'
```

and add to the `/* ---- wiring ---- */` section, immediately after the `stripGrids` and `STRIP_STATES` declarations:

```ts
// The markup ships a static date as the no-JS fallback; this replaces it
// with today's whenever the script runs. A minute is finer than the reader
// will ever notice, so the timer ticks at 30 seconds and stops mattering.
const clock = document.querySelector<HTMLElement>('.topbar .clock')
if (clock) {
  const paintClock = (): void => {
    clock.textContent = clockText(new Date())
  }
  paintClock()
  window.setInterval(paintClock, 30_000)
}
```

- [ ] **Step 6: Write the failing copy tests**

Add to `test/site/indexCopy.test.ts`, inside `describe('the landing page copy', ...)`:

```ts
  // C15. 28 em dashes in ~503 words. Dense em-dash use is a listed
  // AI-writing tell, to exactly the audience this page targets. The state
  // captions keep theirs; they are doing structural work.
  it('rations its em dashes', () => {
    expect((html.match(/—/g) ?? []).length).toBeLessThanOrEqual(12)
  })

  // C16. "you're needed" and "it's waiting" sat beside "the one that is
  // stuck" and "the terminal that is running the work".
  it('uses contractions consistently', () => {
    expect(html).not.toMatch(/that is (stuck|running|waiting)/)
  })

  // C10. Three cards described the mechanic and left the benefit to the
  // reader.
  it('says what each feature is for, not only what it does', () => {
    expect(html).toContain('instead of a search')
    expect(html).toContain('a long job from a stuck one')
    expect(html).toContain("doesn't sit there all afternoon")
  })

  // C11. Four of five captions spent the clause after the dash on the
  // animation while the bold word carried the whole meaning.
  it('makes the state captions say what the state means', () => {
    expect(html).toContain('the session stopped and the row says why')
  })

  // C17. The delay is the notification-seconds setting, default 5, 0
  // disables. "A few seconds later" understated a configurable feature.
  it('gives the auto-close delay a number', () => {
    expect(html).toContain('after five seconds, or however long you set')
    expect(html).not.toContain('a few seconds later')
  })

  // C18. src/core means nothing to someone who has not opened the repo,
  // and the claim it qualifies is a genuine differentiator.
  it('states the real-state-machine claim without the file path', () => {
    expect(html).toContain("the extension's own state machine, compiled for the browser")
    expect(html).not.toContain('<code>src/core</code>')
  })

  // C20. The emotion sweep found nothing in the "before" state — the page
  // never described the problem it exists to solve.
  it('names the problem before it sells the fix', () => {
    expect(html).toContain('You notice twenty minutes later.')
  })

  // C23. License text, an attribution link and a GitHub link. No route to
  // the license, the docs, the changelog, or a way to report anything.
  it('gives the footer somewhere to go', () => {
    const footer = html.match(/<footer>([\s\S]*?)<\/footer>/)?.[1] ?? ''
    expect(footer).toContain('/blob/master/LICENSE')
    expect(footer).toContain('CHANGELOG.md')
    expect(footer).toContain('SECURITY.md')
    expect(footer).toContain('/issues')
    expect(footer).toContain('limitations.html')
  })
```

- [ ] **Step 7: Run them and watch them fail**

Run: `npx vitest run test/site/indexCopy.test.ts`
Expected: FAIL — nine new cases.

- [ ] **Step 8: Rewrite the state captions**

Replace the five `<figure>` elements in `#states` (their `<span class="grid">` markup is unchanged — only each `<figcaption>` differs):

```html
    <figure><span class="grid state-idle"><span class="block" style="opacity:.3"></span><span class="block" style="opacity:.3"></span><span class="block" style="opacity:.3"></span><span class="block" style="opacity:.45"></span></span><figcaption><strong>Resting</strong> — one block breathes; the agent is up and has nothing to do</figcaption></figure>
    <figure><span class="grid state-running"><span class="block" style="opacity:.6"></span><span class="block" style="opacity:1"></span><span class="block" style="opacity:.3"></span><span class="block" style="opacity:.3"></span></span><figcaption><strong>Working</strong> — a light runs clockwise for as long as the agent needs nothing</figcaption></figure>
    <figure><span class="grid state-waiting accent"><span class="block"></span><span class="block"></span><span class="block"></span><span class="block"></span></span><figcaption><strong>Needs you</strong> — all four blink; nothing moves until you answer</figcaption></figure>
    <figure><span class="grid state-error accent"><span class="block"></span><span class="block" style="opacity:.16"></span><span class="block"></span><span class="block" style="opacity:.16"></span></span><figcaption><strong>Error</strong> — a diagonal pair holds; the session stopped and the row says why</figcaption></figure>
    <figure><span class="grid state-done accent"><span class="block"></span><span class="block"></span><span class="block" style="opacity:0"></span><span class="block" style="opacity:0"></span></span><figcaption><strong>Done</strong> — a green stagger; the work finished and the terminal is free</figcaption></figure>
```

- [ ] **Step 9: Paint the pain and finish the cards**

Replace the opening of `#features`:

```html
<section id="features">
  <h2>Built for the moment an agent needs a human.</h2>
  <div class="cards">
```

with:

```html
<section id="features">
  <h2>Built for the moment an agent needs a human.</h2>
  <p class="fine">An agent stops to ask permission in a terminal behind three other windows. You notice twenty minutes later. That gap is the whole reason this exists.</p>
  <div class="cards">
```

Replace the three cards that stop at the mechanic:

```html
    <div class="card"><h3>Jump back to the session</h3><p>Click a session row and land in the window the session started in.</p></div>
    <div class="card"><h3>Watch the plan tick over</h3><p>Agents that keep a task list show progress — 3/10 beside the clock — and the expander opens the list itself, one line per task.</p></div>
```

with:

```html
    <div class="card"><h3>Jump back to the session</h3><p>Click a session row and land in the window the session started in, so getting back to an agent costs one click instead of a search.</p></div>
    <div class="card"><h3>Watch the plan tick over</h3><p>Agents that keep a task list show progress (3/10 beside the clock) and the expander opens the list itself, one line per task. It's how you tell a long job from a stuck one without reading the terminal.</p></div>
```

and replace the waiting card:

```html
    <div class="card"><h3>Know when it's waiting</h3><p>When an agent sits idle on your input, its row says so and the popup opens on its own — and closes again a few seconds later.</p></div>
```

with:

```html
    <div class="card"><h3>Know when it's waiting</h3><p>When an agent sits idle on your input, its row says so and the popup opens on its own, closing again after five seconds, or however long you set. A session waiting on a word from you doesn't sit there all afternoon.</p></div>
```

- [ ] **Step 10: Fix the sound card's dashes and the demo note**

Replace the sound card:

```html
    <div class="card"><h3>Hear when you're needed</h3><p>Permission requests, questions, notifications, and finishes each have a cue from your desktop's own sound theme. A fullscreen window doesn't mute them — that is when the pill is least visible and the sound most useful.</p></div>
```

with:

```html
    <div class="card"><h3>Hear when you're needed</h3><p>Permission requests, questions, notifications, and finishes each have a cue from your desktop's own sound theme. A fullscreen window doesn't mute them: that's when the pill is least visible and the sound most useful.</p></div>
```

Replace the demo note:

```html
  <p class="demo-note">The pill and popup above are driven by the extension's real state machine — <code>src/core</code> bundled for the browser, not a mock.</p>
```

with:

```html
  <p class="demo-note">The pill and popup above are driven by the extension's own state machine, compiled for the browser. Not a mock.</p>
```

- [ ] **Step 11: Rebuild the footer**

Replace the footer:

```html
<footer>
  <p>GPL-3.0-or-later · Inspired by <a href="https://github.com/Octane0411/open-vibe-island">open-vibe-island</a> · <a href="https://github.com/dasbo-dev/island-gnome">GitHub</a></p>
</footer>
```

with:

```html
<footer>
  <p><a href="limitations.html">Known limitations</a> · <a href="agent-dialects.html">Agent hook dialects</a> · <a href="https://github.com/dasbo-dev/island-gnome/blob/master/CHANGELOG.md">Changelog</a> · <a href="https://github.com/dasbo-dev/island-gnome/blob/master/SECURITY.md">Security</a> · <a href="https://github.com/dasbo-dev/island-gnome/issues">Report an issue</a></p>
  <p><a href="https://github.com/dasbo-dev/island-gnome/blob/master/LICENSE">GPL-3.0-or-later</a> · Inspired by <a href="https://github.com/Octane0411/open-vibe-island">open-vibe-island</a> · <a href="https://github.com/dasbo-dev/island-gnome">GitHub</a></p>
</footer>
```

- [ ] **Step 12: Sweep the remaining em dashes**

Run: `grep -c '—' site/index.html`
Expected: 12 or fewer. If higher, convert the remaining ones outside `#states` captions to full stops or colons, re-reading each sentence to check it still scans.

- [ ] **Step 13: Run everything**

Run: `npx vitest run && npm run typecheck && node build.mjs`
Expected: PASS with 0 failures; typecheck exits 0; the build writes `dist/` and `dist-site/`.

- [ ] **Step 14: Check the live clock in a browser**

Run: `python3 -m http.server 8000 --directory dist-site`
Open `http://localhost:8000/` and confirm the top bar shows today's date rather than `Wed Aug 5`. Stop the server with Ctrl-C.

- [ ] **Step 15: Commit**

```bash
git add site/index.html site/clock.ts site/demo.ts test/site/clock.test.ts test/site/indexCopy.test.ts
git commit -m "feat(site): say what the features are for, and stop the clock ageing

Three cards described the mechanic and left the benefit to the reader,
four of five state captions spent their clause on the animation while
the bold word carried the meaning, and the mock top bar had been showing
5 August since 5 August. The em dashes are down from 28 to a dozen."
```

---

### Task 7: Changelog and end-to-end verification

The audit is explicit that the install snippet is the kind of copy that gets written from memory. This task runs it.

**Files:**
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: everything.
- Produces: nothing.

- [ ] **Step 1: Verify the install snippet from a clean clone**

Run, from the repository root:

```bash
rm -rf /tmp/dasbo-install-check
git clone --quiet . /tmp/dasbo-install-check
cd /tmp/dasbo-install-check
npm ci
make install DEST=/tmp/dasbo-install-check-dest
ls /tmp/dasbo-install-check-dest
```

Expected: `npm ci` succeeds, `make install` prints `Installed. Log out and back in (X11), then: gnome-extensions enable dasbo-island@ayubaswad.gmail.com`, and the destination lists `extension.js`, `metadata.json`, `schemas`, `hooks`, `icons`, `assets`, `stylesheet.css`.

`DEST` is overridden deliberately: the real target is the developer's live extension directory, and a verification run must not overwrite it.

If any step fails, the published snippet is still wrong — fix `site/index.html` and re-run before continuing.

- [ ] **Step 2: Clean up the check**

```bash
cd -
rm -rf /tmp/dasbo-install-check /tmp/dasbo-install-check-dest
```

- [ ] **Step 3: Record the work in the changelog**

In `CHANGELOG.md`, under `## [Unreleased]`, add a `### Changed` section if one does not already exist, and add:

```markdown
- The landing page: the hero no longer promises Codex the inline permission
  answering only Claude Code can do, the install snippet runs `npm ci` before
  it builds, and the agent table links its caveats to the limitations page
  rather than restating them.
- `docs/limitations.md` and `docs/agent-dialects.md` are published as pages of
  the site, rendered from the markdown at build time.
- The site declares a canonical URL, a sitemap, a `robots.txt`, a favicon, a
  1200×630 share card and `SoftwareApplication` structured data, all resolving
  against `https://dasbo-dev.github.io/island-gnome/`.
```

- [ ] **Step 4: Full verification**

Run: `npm ci && npx vitest run && npm run typecheck && node build.mjs`
Expected: every command exits 0; vitest reports 0 failures.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: record the landing page copy and SEO sweep"
```

---

## Self-review notes

- **Spec coverage.** C1, C2 → Task 1. C13, C14 → Task 3. C3, C4, S1, S1b, S2, S3, S4, S5, S7, S9, S10 → Task 4. C5, C6, C7, C8, C9, C12 → Task 5. C10, C11, C15, C16, C17, C18, C20, C22, C23 → Task 6. S6 → Tasks 2 and 3. C19 and C21 are recorded in the spec as no-action. S8 and S12 were verified clean by the audit.
- **Ordering change from the spec.** The spec listed the docs pages last. They are Task 2 here, because Task 3's C13 fix links to `limitations.html#codex-has-no-permission-gate` — a link that would be broken at the moment it was written if the page did not exist yet.
- **Naming.** `slug`, `withAnchors`, `rewriteDocLinks`, `renderDoc`, `renderPage`, `DOC_PAGES`, `SITE_URL` and `clockText` are used with the same names in every task that references them.
