import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const metadata = JSON.parse(readFileSync('metadata.json', 'utf8')) as Record<string, unknown>

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

describe('the store description', () => {
  const description = String(metadata.description)
  const paragraphs = description.split('\n\n')

  // extensions.gnome.org truncates the description in its list view at roughly
  // 150 characters, and shows the whole thing on the extension page. So the
  // limit belongs on the first paragraph, not the whole string: whatever the
  // list view cuts to must still be a complete claim, while the disclosure
  // below the fold is free to be as long as it needs to be.
  it('fits its first paragraph inside the list-view truncation', () => {
    expect(paragraphs[0]!.length).toBeLessThanOrEqual(150)
  })

  it('names the agents rather than promising everything for all of them', () => {
    expect(description).toContain('Claude Code')
    expect(description).toContain('Codex')
  })

  // docs/limitations.md § "Codex has no permission gate": every Codex hook is
  // installed notify-only, so an unscoped promise of inline approval is false.
  it('scopes inline permission approval to the agent that has it', () => {
    const inline = description.indexOf('inline')
    if (inline === -1) return
    expect(description.slice(0, inline)).toContain('Claude Code permission')
  })

  // H1 of the DIS-14 review: the extension writes into three other
  // applications' config files and the store description said nothing about
  // it. A reviewer who greps before reading finds writes to $HOME and has to
  // guess at the intent. Every clause below is a disclosure the reviewer would
  // otherwise have to discover; a copy edit that drops one puts the submission
  // back where it started.
  it('discloses the files it writes and the terms it writes them on', () => {
    for (const path of ['~/.claude/settings.json', '~/.codex/hooks.json', '~/.gemini/config/hooks.json']) {
      expect(description, `the description no longer names ${path}`).toContain(path)
    }
    expect(description, 'the button-press precondition is gone').toContain('Install hooks')
    expect(description, 'the backup is no longer mentioned').toContain('.dasbo.bak')
    expect(description, 'removal is no longer mentioned').toContain('Remove hooks')
    expect(description, 'the hook still reads as a shipped binary').toContain('GJS script')
  })

  // M1 of the DIS-14 review: the copy uses three vendors' product names
  // nominatively and the icons carry their brand colours, so the description
  // must not be readable as a claim of endorsement.
  it('disclaims affiliation with the three vendors it names', () => {
    expect(description).toContain('Not affiliated with or endorsed by Anthropic, OpenAI or Google.')
  })
})

describe('the gettext domain', () => {
  // The field declares that translations exist. None do: no string is wrapped
  // for extraction and there is no po/. Drop the claim or make it true — this
  // test fails either way round, so the two cannot drift apart again.
  it('is absent while no string is wrapped for extraction', () => {
    const wrapped = walk('src').some((f) => /gettext/.test(readFileSync(f, 'utf8')))
    expect(wrapped, 'src wraps strings for gettext').toBe(false)
    expect(metadata).not.toHaveProperty('gettext-domain')
  })
})

describe('session-modes', () => {
  // Review guideline, verbatim: "This MUST be dropped if you are only using
  // `user` mode." Nothing in the tree references unlock-dialog, so the key was
  // a straight rule violation rather than a claim that needed narrowing.
  // Re-adding it fails a submission, and nothing else would catch it.
  it('is absent, because the extension is user-mode only', () => {
    expect(metadata).not.toHaveProperty('session-modes')
  })
})
