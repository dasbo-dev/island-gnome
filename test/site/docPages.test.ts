import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  slug,
  withAnchors,
  rewriteDocLinks,
  renderDoc,
  renderPage,
  DOC_PAGES,
} from '../../site/docPages.mjs'

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

  // marked escapes the apostrophe while rendering, so the slugifier sees
  // "Claude Code&#39;s" and not "Claude Code's". Slugified naively that
  // becomes claude-code39s-… — an id no hand-written anchor will match, and
  // the only symptom is a link that quietly lands at the top of the page.
  it('decodes entities before slugifying', () => {
    expect(withAnchors('<h3>Claude Code&#39;s SessionEnd</h3>')).toContain(
      'id="claude-codes-sessionend"'
    )
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

  // docs/limitations.md opens with a link to ../README.md. The README is not
  // published as a page of the site, so rewriting it to README.html would
  // publish a 404 on the first line of the first doc page.
  it('sends links to unpublished files to GitHub', () => {
    expect(rewriteDocLinks('<a href="../README.md">x</a>')).toBe(
      '<a href="https://github.com/dasbo-dev/island-gnome/blob/master/README.md">x</a>'
    )
    expect(rewriteDocLinks('<a href="../CONTRIBUTING.md#tests">x</a>')).toBe(
      '<a href="https://github.com/dasbo-dev/island-gnome/blob/master/CONTRIBUTING.md#tests">x</a>'
    )
  })

  // The anchor index.html sends readers to, rendered from the real file.
  it('renders the limitations anchor the agent table links to', () => {
    const html = renderDoc(readFileSync('docs/limitations.md', 'utf8'))
    expect(html).toContain('id="codex-has-no-permission-gate"')
    // Absolute GitHub links to .md files are fine and expected; a relative
    // one is a 404 waiting for a click.
    expect(html).not.toMatch(/href="(?!https?:)[^"]*\.md/)
  })

  it('renders the dialects page with its tables intact', () => {
    const html = renderDoc(readFileSync('docs/agent-dialects.md', 'utf8'))
    expect(html).toContain('<table>')
    expect(html).toContain('id="claude-code-captured-complete"')
  })

  it('fills every placeholder in the template', () => {
    const page = renderPage(readFileSync('site/doc-template.html', 'utf8'), {
      title: 'Known limitations',
      canonical: 'https://dasbo-dev.github.io/island-gnome/limitations.html',
      body: '<p>hello</p>',
    })
    expect(page).not.toContain('{{')
    expect(page).toContain('<p>hello</p>')
    expect(page).toContain(
      '<link rel="canonical" href="https://dasbo-dev.github.io/island-gnome/limitations.html">'
    )
  })

  it('publishes both docs, and build.mjs writes them', () => {
    expect(DOC_PAGES.map((p) => p.out).sort()).toEqual(['agent-dialects.html', 'limitations.html'])
    expect(readFileSync('build.mjs', 'utf8')).toContain('DOC_PAGES')
  })
})
