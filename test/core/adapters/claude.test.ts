import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { claudeAdapter } from '../../../src/core/adapters/claude.js'
import type { HookContext } from '../../../src/core/types.js'

const ctx: HookContext = { pid: 1234, ts: 5000, cwd: '/hook/cwd' }

describe('claudeAdapter.normalize', () => {
  it('maps SessionStart to session-start', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'SessionStart', session_id: 's1', cwd: '/p/app', transcript_path: '/t.jsonl' },
      ctx
    )
    expect(e).toEqual({
      agent: 'claude', kind: 'session-start', sessionId: 's1', cwd: '/p/app',
      tool: undefined, detail: undefined, transcriptPath: '/t.jsonl', pid: 1234, ts: 5000,
    })
  })

  it('prefers the payload cwd over the hook cwd', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'Stop', session_id: 's1', cwd: '/p/app' }, ctx
    )
    expect(e?.cwd).toBe('/p/app')
  })

  it('falls back to the hook cwd when the payload has none', () => {
    const e = claudeAdapter.normalize({ hook_event_name: 'Stop', session_id: 's1' }, ctx)
    expect(e?.cwd).toBe('/hook/cwd')
  })

  it('falls back to the argv event when the payload has no hook_event_name', () => {
    const e = claudeAdapter.normalize(
      { session_id: 's1', cwd: '/p' }, { ...ctx, event: 'Stop' }
    )
    expect(e?.kind).toBe('stop')
  })

  it('prefers the payload event over the argv event', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'SessionStart', session_id: 's1', cwd: '/p' }, { ...ctx, event: 'Stop' }
    )
    expect(e?.kind).toBe('session-start')
  })

  it('maps PreToolUse to tool-start and extracts a bash command as detail', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'PreToolUse', session_id: 's1', cwd: '/p/app',
        tool_name: 'Bash', tool_input: { command: 'rm -rf build' } },
      ctx
    )
    expect(e?.kind).toBe('tool-start')
    expect(e?.tool).toBe('Bash')
    expect(e?.detail).toBe('rm -rf build')
  })

  it('uses file_path as detail for file tools', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'PreToolUse', session_id: 's1', cwd: '/p/app',
        tool_name: 'Edit', tool_input: { file_path: '/p/app/src/main.js' } },
      ctx
    )
    expect(e?.detail).toBe('/p/app/src/main.js')
  })

  it('maps PostToolUse, UserPromptSubmit and Stop', () => {
    const kinds = ['PostToolUse', 'UserPromptSubmit', 'Stop'].map(
      (n) => claudeAdapter.normalize({ hook_event_name: n, session_id: 's1', cwd: '/p' }, ctx)?.kind
    )
    expect(kinds).toEqual(['tool-end', 'prompt-submit', 'stop'])
  })

  it('returns null for an unknown event', () => {
    expect(claudeAdapter.normalize({ hook_event_name: 'Nope', session_id: 's', cwd: '/p' }, ctx)).toBeNull()
  })

  it('returns null when neither payload nor argv names an event', () => {
    expect(claudeAdapter.normalize({ session_id: 's', cwd: '/p' }, ctx)).toBeNull()
  })

  it('returns null for a payload with no session id', () => {
    expect(claudeAdapter.normalize({ hook_event_name: 'Stop', cwd: '/p' }, ctx)).toBeNull()
  })

  it('returns null for a non-object payload', () => {
    expect(claudeAdapter.normalize('not json', ctx)).toBeNull()
    expect(claudeAdapter.normalize(null, ctx)).toBeNull()
  })
})

describe('claudeAdapter.encodeDecision', () => {
  it('encodes allow', () => {
    expect(claudeAdapter.encodeDecision({ kind: 'allow' })).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'Allowed from Dasbo Island',
      },
    })
  })

  it('encodes deny with the supplied reason', () => {
    const out = claudeAdapter.encodeDecision({ kind: 'deny', reason: 'nope' }) as any
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(out.hookSpecificOutput.permissionDecisionReason).toBe('nope')
  })

  it('encodes fallthrough as ask so Claude prompts normally', () => {
    const out = claudeAdapter.encodeDecision({ kind: 'fallthrough' }) as any
    expect(out.hookSpecificOutput.permissionDecision).toBe('ask')
  })
})

describe('claudeAdapter against captured fixtures', () => {
  const dir = 'test/fixtures/claude'

  it('has fixtures to test against', () => {
    expect(existsSync(dir), `${dir} must exist — fixtures are the adapter spec`).toBe(true)
    expect(readdirSync(dir).filter((f) => f.endsWith('.json')).length).toBeGreaterThan(0)
  })

  it('normalizes every captured payload into a usable event', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
    for (const f of files) {
      const raw = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'))
      const e = claudeAdapter.normalize(raw, ctx)
      expect(e, `${f} must normalize, not drop`).not.toBeNull()
      expect(e!.sessionId, `${f} must yield a session id`).toBeTruthy()
      expect(e!.cwd, `${f} must yield a cwd`).toBeTruthy()
    }
  })

  it('covers every event kind the fixtures contain', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
    const kinds = new Set(
      files.map((f) => claudeAdapter.normalize(
        JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')), ctx
      )?.kind)
    )
    expect(kinds).toContain('session-start')
    expect(kinds).toContain('prompt-submit')
    expect(kinds).toContain('tool-start')
    expect(kinds).toContain('tool-end')
    expect(kinds).toContain('stop')
  })
})
