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

  // extensions.gnome.org truncates the description in its list view at roughly
  // 150 characters. A claim qualified after the cut is an unqualified claim.
  it('fits inside the list-view truncation', () => {
    expect(description.length).toBeLessThanOrEqual(150)
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
