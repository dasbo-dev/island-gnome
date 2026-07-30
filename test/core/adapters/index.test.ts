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

describe('adapter process signatures', () => {
  it('gives every adapter at least one comm to match', () => {
    for (const id of ['claude', 'codex', 'antigravity'] as const) {
      expect(adapters[id].procNames.length).toBeGreaterThan(0)
    }
  })

  it('keeps every signature within the kernel comm truncation of 15 chars', () => {
    for (const id of ['claude', 'codex', 'antigravity'] as const) {
      for (const name of adapters[id].procNames) {
        expect(name.length, `${id}: ${name}`).toBeLessThanOrEqual(15)
      }
    }
  })

  it('every adapter copies agentStartedAt from the hook context', () => {
    const withStart: HookContext = { ...ctx, event: 'Stop', agentStartedAt: 4242 }
    const payloads = {
      claude: { hook_event_name: 'Stop', session_id: 's', cwd: '/p' },
      codex: { type: 'session.start', session_id: 's', cwd: '/p' },
      antigravity: { conversationId: 's', workspacePaths: ['/p'] },
    } as const
    for (const id of ['claude', 'codex', 'antigravity'] as const) {
      expect(normalizeFor(id, payloads[id], withStart)?.agentStartedAt, id).toBe(4242)
    }
  })
})

describe('adapter chip names', () => {
  it('gives every adapter a non-empty short name for the row chip', () => {
    for (const id of ['claude', 'codex', 'antigravity'] as const) {
      expect(adapters[id].shortName.trim(), id).not.toBe('')
    }
  })

  // The chip exists because the row is width-starved. A shortName longer than
  // the displayName it replaces would mean someone forgot what it is for.
  it('keeps each short name no longer than the display name it stands in for', () => {
    for (const id of ['claude', 'codex', 'antigravity'] as const) {
      expect(adapters[id].shortName.length, id)
        .toBeLessThanOrEqual(adapters[id].displayName.length)
    }
  })
})
