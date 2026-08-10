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
})
