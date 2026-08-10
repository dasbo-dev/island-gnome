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
})
