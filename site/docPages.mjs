// Publishes docs/*.md as pages of the landing site. The markdown stays the
// single source of truth: the site restating what docs/limitations.md says,
// in its own words, is what produced findings C1 and C13 of the 2026-08-10
// audit. A page rendered from the file cannot drift from it.
import { marked } from 'marked'

export const DOC_PAGES = [
  { source: 'docs/limitations.md', out: 'limitations.html', title: 'Known limitations' },
  { source: 'docs/agent-dialects.md', out: 'agent-dialects.html', title: 'Agent hook dialects' },
]

// Entities are decoded before slugifying, not after. marked escapes the
// apostrophe in "Claude Code's SessionEnd" to &#39; while rendering, and a
// slugifier that only strips non-word characters turns that into
// claude-code39s-sessionend — an id no hand-written anchor will ever match.
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" }
const decode = (text) => text.replace(/&(?:amp|lt|gt|quot|#39|#x27);/g, (entity) => ENTITIES[entity])

// GitHub's own heading-anchor rule, the same one test/docs/links.test.ts
// implements: strip markup, lowercase, drop everything that is not a word
// character, space or hyphen, then join words with hyphens. Periods vanish
// rather than becoming separators — "0.146.0" becomes "01460".
export const slug = (text) =>
  decode(text.replace(/<[^>]+>/g, ''))
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

const REPO_BLOB = 'https://github.com/dasbo-dev/island-gnome/blob/main/'
const PUBLISHED = new Set(DOC_PAGES.map((page) => page.source.replace(/^docs\//, '')))

// The docs link to each other, and to files outside docs/, by relative path.
// Published as HTML those paths mean nothing: a link to a sibling doc has to
// become its published form, and a link to something not published — the
// README, the contributing guide — has to become an absolute GitHub URL. The
// alternative is a page full of links that 404 for every reader who clicks
// one, which is the failure mode nothing else in the suite would catch.
export const rewriteDocLinks = (html) =>
  html.replace(/href="((?!https?:|mailto:)[^"]*?\.md)(#[\w-]*)?"/g, (_match, path, hash) => {
    const name = path.replace(/^(?:\.\.?\/)+/, '').replace(/^docs\//, '')
    const anchor = hash ?? ''
    if (PUBLISHED.has(name)) return `href="${name.replace(/\.md$/, '.html')}${anchor}"`
    // A leading ../ from docs/ means the repository root; anything else is a
    // sibling inside docs/.
    return `href="${REPO_BLOB}${path.startsWith('../') ? name : `docs/${name}`}${anchor}"`
  })

export const renderDoc = (markdown) =>
  rewriteDocLinks(withAnchors(marked.parse(markdown, { async: false })))

export const renderPage = (template, { title, canonical, body }) =>
  template.replaceAll('{{title}}', title).replaceAll('{{canonical}}', canonical).replaceAll('{{body}}', body)
