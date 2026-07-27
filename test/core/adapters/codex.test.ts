import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { codexAdapter } from '../../../src/core/adapters/codex.js'
import type { HookContext } from '../../../src/core/types.js'

const ctx: HookContext = { pid: 1, ts: 2, cwd: '/hook/cwd' }

// NOTE: Codex captured zero fixtures in Task 2 (not authenticated, HTTP 401).
// The key names below come from ~/.codex/vibe-island-hook.py, which reads
// `type`, `session_id`, `cwd`, `tool_name`. That is third-party evidence, not
// verbatim capture. These tests pin the adapter's behaviour against that
// assumption so a later real capture produces a clear, loud failure if the
// assumption was wrong.

describe('codexAdapter.normalize (UNVERIFIED — no captured fixtures)', () => {
  it('maps dotted event names from the type field', () => {
    const cases: Array<[string, string]> = [
      ['session.start', 'session-start'],
      ['session.end', 'stop'],
      ['tool.start', 'tool-start'],
      ['tool.end', 'tool-end'],
    ]
    for (const [type, kind] of cases) {
      const e = codexAdapter.normalize({ type, session_id: 's1', cwd: '/p/app' }, ctx)
      expect(e?.kind, type).toBe(kind)
    }
  })

  it('also accepts CamelCase hook_event_name payloads', () => {
    const e = codexAdapter.normalize(
      { hook_event_name: 'PreToolUse', session_id: 's1', cwd: '/p/app', tool_name: 'shell' }, ctx
    )
    expect(e?.kind).toBe('tool-start')
    expect(e?.tool).toBe('shell')
  })

  it('falls back to the argv event and the hook cwd', () => {
    const e = codexAdapter.normalize({ session_id: 's1' }, { ...ctx, event: 'tool.start' })
    expect(e?.kind).toBe('tool-start')
    expect(e?.cwd).toBe('/hook/cwd')
  })

  it('returns null on unknown type or missing session id', () => {
    expect(codexAdapter.normalize({ type: 'nope', session_id: 's', cwd: '/p' }, ctx)).toBeNull()
    expect(codexAdapter.normalize({ type: 'tool.start', cwd: '/p' }, ctx)).toBeNull()
  })

  it('returns null when neither the payload nor the hook supplies a cwd', () => {
    expect(
      codexAdapter.normalize({ type: 'tool.start', session_id: 's1' }, { ...ctx, cwd: '' })
    ).toBeNull()
  })
})

describe('codexAdapter.encodeDecision', () => {
  it('encodes allow and deny in the hookSpecificOutput shape', () => {
    const allow = codexAdapter.encodeDecision({ kind: 'allow' }) as any
    expect(allow.hookSpecificOutput.permissionDecision).toBe('allow')
    const deny = codexAdapter.encodeDecision({ kind: 'deny', reason: 'no' }) as any
    expect(deny.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(deny.hookSpecificOutput.permissionDecisionReason).toBe('no')
  })

  it('encodes fallthrough as an empty object so Codex is unaffected', () => {
    expect(codexAdapter.encodeDecision({ kind: 'fallthrough' })).toEqual({})
  })
})

describe('codex fixture status', () => {
  it('records that no fixtures exist yet, and will fail once they do', () => {
    expect(
      existsSync('test/fixtures/codex'),
      'test/fixtures/codex now exists — delete this test and write real fixture-driven ' +
      'assertions like the claude and antigravity suites have'
    ).toBe(false)
  })
})
