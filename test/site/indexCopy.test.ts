import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// These cases hold the page to what the extension actually does. Each one
// failed against the page as audited on 2026-08-10
// (docs/copy-seo-audit-2026-08-10.md), except where marked as revised in
// the 2026-08-24 review.
const html = readFileSync('site/index.html', 'utf8')

describe('the landing page copy', () => {
  // C1, revised in the 2026-08-24 review. The hero now pitches the category
  // ("coding agent"), not a vendor list; the per-agent truth — Claude Code
  // gates, Codex is notify-only — lives on the permissions card and the
  // agents table, which the next case and C13 still enforce.
  it('keeps the hero subhead generic about agents', () => {
    const sub = html.match(/<p class="sub">([\s\S]*?)<\/p>/)?.[1] ?? ''
    expect(sub).toContain('coding agent')
    expect(sub).not.toContain('Claude')
    expect(sub).not.toContain('Codex')
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

  // The site, the README and the Makefile all give the same reload
  // instruction, and the site is the one a reader hits first: get it wrong
  // here and a Wayland reader — the one who actually needs to log out — is
  // never told to.
  it('keeps the Wayland log-out step the Makefile prints', () => {
    expect(html).toMatch(/log out and back in/)
  })

  it('names glib-compile-schemas as a build requirement', () => {
    expect(html).toContain('glib-compile-schemas')
    expect(html).toContain('libglib2.0-bin')
  })

  it('states the supported GNOME Shell range as a range, not a floor', () => {
    expect(html).toContain('GNOME Shell 46 to 50')
    // "46+" would promise every future release. The range is closed on both
    // ends deliberately: 51 is not supported until someone has run it.
    expect(html).not.toMatch(/GNOME Shell 46\+/)
  })

  it('does not promise future GNOME Shell versions as planned', () => {
    // The page used to read "GNOME Shell 46 only; 47 and 48 support is
    // planned". Widening the declared range to 46-50 keeps the promise;
    // this guards against re-introducing the "support is planned" clause.
    // Scoped to hero: the agent roadmap legitimately lists planned agents.
    const hero = html.match(/<section class="hero">([\s\S]*?)<div class="popup">/)?.[1] ?? ''
    expect(hero).not.toContain('planned')
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
    expect(hero).toContain('18 real Claude&nbsp;Code hook payloads')
    expect(hero).toContain('GNOME Shell 46 to 50')
  })

  // C15. 28 em dashes in ~503 words. Dense em-dash use is a listed
  // AI-writing tell, to exactly the audience this page targets. The state
  // captions keep theirs; they are doing structural work.
  //
  // Counted over prose only. A <td>—</td> standing for "not applicable" and
  // a dash inside an HTML comment are not rhythm, and counting them would
  // push the page toward deleting table cells to satisfy a test.
  it('rations its em dashes', () => {
    const prose = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<td>—<\/td>/g, '')
    expect((prose.match(/—/g) ?? []).length).toBeLessThanOrEqual(10)
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
    expect(footer).toContain('/blob/main/LICENSE')
    expect(footer).toContain('CHANGELOG.md')
    expect(footer).toContain('SECURITY.md')
    expect(footer).toContain('/issues')
    expect(footer).toContain('limitations.html')
  })
})
