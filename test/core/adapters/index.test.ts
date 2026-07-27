import { describe, it, expect } from 'vitest'
import { adapters, isAgentId, normalizeFor } from '../../../src/core/adapters/index.js'
import type { HookContext } from '../../../src/core/types.js'

const ctx: HookContext = { pid: 1, ts: 2, cwd: '/hook/cwd' }

describe('adapter dispatch', () => {
  it('exposes one adapter per agent id, each self-identifying', () => {
    for (const id of ['claude', 'codex', 'antigravity'] as const) {
      expect(adapters[id].id).toBe(id)
    }
  })

  it('isAgentId rejects unknown ids', () => {
    expect(isAgentId('claude')).toBe(true)
    expect(isAgentId('cursor')).toBe(false)
  })

  it('normalizeFor routes to the right adapter', () => {
    const e = normalizeFor('claude', { hook_event_name: 'Stop', session_id: 's', cwd: '/p' }, ctx)
    expect(e?.agent).toBe('claude')
  })
})
