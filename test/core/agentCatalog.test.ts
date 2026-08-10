import { describe, it, expect } from 'vitest'
import { AGENT_CATALOG } from '../../src/core/agentCatalog.js'
import { adapters } from '../../src/core/adapters/index.js'

describe('the agent catalog', () => {
  it('lists no agent twice', () => {
    const ids = AGENT_CATALOG.map((e) => e.id)
    expect(new Set(ids).size, `duplicate id in ${ids.join(', ')}`).toBe(ids.length)
  })

  it('gives every supported entry an adapter to read its name from', () => {
    for (const entry of AGENT_CATALOG) {
      if (entry.status !== 'supported') continue
      expect(adapters[entry.id], `${entry.id} is marked supported with no adapter`).toBeDefined()
    }
  })

  // A new adapter that never reaches the catalog is invisible in preferences:
  // the page renders this list and nothing else. Failing here is cheaper than
  // shipping an agent nobody can enable.
  it('files every adapter under some status', () => {
    const listed = new Set<string>(AGENT_CATALOG.map((e) => e.id))
    for (const id of Object.keys(adapters)) {
      expect(listed.has(id), `${id} has an adapter but no catalog entry`).toBe(true)
    }
  })

  it('names every coming-soon entry, since it has no adapter to ask', () => {
    for (const entry of AGENT_CATALOG) {
      if (entry.status !== 'coming-soon') continue
      expect(entry.displayName.trim(), entry.id).not.toBe('')
    }
  })

  it('keeps the working agents at the top of the list', () => {
    const firstComingSoon = AGENT_CATALOG.findIndex((e) => e.status === 'coming-soon')
    const lastSupported = AGENT_CATALOG.map((e) => e.status).lastIndexOf('supported')
    expect(lastSupported).toBeLessThan(firstComingSoon)
  })

  // docs/limitations.md § "Codex has no permission gate": Codex's PreToolUse
  // hook rejects an allow/ask decision outright, so every Codex hook is
  // installed notify-only. That is a fact about the agent, so it lives on the
  // catalog rather than being restated wherever a row happens to be built.
  it('records what each supported agent can actually do', () => {
    for (const entry of AGENT_CATALOG) {
      if (entry.status !== 'supported') continue
      expect(['inline', 'notify-only'], entry.id).toContain(entry.permissions)
    }
  })

  it('marks Claude Code inline and Codex notify-only', () => {
    const byId = Object.fromEntries(
      AGENT_CATALOG.filter((e) => e.status === 'supported').map((e) => [e.id, e.permissions])
    )
    expect(byId).toEqual({ claude: 'inline', codex: 'notify-only' })
  })

  it('holds the agents this release ships and the three it does not', () => {
    expect(AGENT_CATALOG.filter((e) => e.status === 'supported').map((e) => e.id))
      .toEqual(['claude', 'codex'])
    expect(AGENT_CATALOG.filter((e) => e.status === 'coming-soon').map((e) => e.id))
      .toEqual(['opencode', 'cursor', 'antigravity'])
  })
})
