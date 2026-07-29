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

  it('returns null when neither the payload nor the hook supplies a cwd', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'Stop', session_id: 's1' }, { ...ctx, cwd: '' }
    )
    expect(e).toBeNull()
  })

  it('falls back to the argv event when the payload has no hook_event_name', () => {
    const e = claudeAdapter.normalize(
      { session_id: 's1', cwd: '/p' }, { ...ctx, event: 'Stop' }
    )
    expect(e?.kind).toBe('turn-end')
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

  it('maps PostToolUse, UserPromptSubmit, Stop and SessionEnd', () => {
    const kinds = ['PostToolUse', 'UserPromptSubmit', 'Stop', 'SessionEnd'].map(
      (n) => claudeAdapter.normalize({ hook_event_name: n, session_id: 's1', cwd: '/p' }, ctx)?.kind
    )
    expect(kinds).toEqual(['tool-end', 'prompt-submit', 'turn-end', 'session-end'])
  })

  it('flags a bypassPermissions payload so the island does not gate it', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'PreToolUse', session_id: 's1', cwd: '/p', tool_name: 'Bash',
        permission_mode: 'bypassPermissions' },
      ctx
    )
    expect(e?.permissionsBypassed).toBe(true)
  })

  it('leaves permissionsBypassed unset in every asking mode', () => {
    for (const mode of ['default', 'acceptEdits', 'plan', undefined]) {
      const e = claudeAdapter.normalize(
        { hook_event_name: 'PreToolUse', session_id: 's1', cwd: '/p', tool_name: 'Bash',
          permission_mode: mode },
        ctx
      )
      expect(e?.permissionsBypassed, `mode ${mode} must still be gated`).toBeUndefined()
    }
  })

  it('flags a cleared session as the start of a new conversation', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'SessionStart', session_id: 's2', cwd: '/p', source: 'clear' }, ctx
    )
    expect(e?.startsNewConversation).toBe(true)
  })

  it('leaves a compaction unflagged: the user did not begin a conversation', () => {
    // Compaction is not a new conversation, it is the same one with its
    // history summarised — and Claude Code compacts on its own when the
    // context window fills, so counting it moved a row's number and reset its
    // clock with no user action at all. Only `/clear` is deliberate.
    const e = claudeAdapter.normalize(
      { hook_event_name: 'SessionStart', session_id: 's2', cwd: '/p', source: 'compact' }, ctx
    )
    expect(e?.startsNewConversation).toBeUndefined()
  })

  it('leaves startup and resume unflagged: the process clock is still right there', () => {
    for (const source of ['startup', 'resume']) {
      const e = claudeAdapter.normalize(
        { hook_event_name: 'SessionStart', session_id: 's1', cwd: '/p', source }, ctx
      )
      expect(e?.startsNewConversation, source).toBeUndefined()
    }
  })

  it('leaves an unknown source unflagged rather than guessing', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'SessionStart', session_id: 's1', cwd: '/p', source: 'teleport' }, ctx
    )
    expect(e?.startsNewConversation).toBeUndefined()
  })

  it('ignores a source that arrives on any event other than SessionStart', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'Stop', session_id: 's1', cwd: '/p', source: 'clear' }, ctx
    )
    expect(e?.startsNewConversation).toBeUndefined()
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

describe('claudeAdapter agentStartedAt', () => {
  it('copies the hook context agentStartedAt onto the event', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'Stop', session_id: 's1', cwd: '/p' },
      { ...ctx, agentStartedAt: 4242 }
    )
    expect(e?.agentStartedAt).toBe(4242)
  })

  it('leaves agentStartedAt undefined when the context has none', () => {
    const e = claudeAdapter.normalize({ hook_event_name: 'Stop', session_id: 's1', cwd: '/p' }, ctx)
    expect(e?.agentStartedAt).toBeUndefined()
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

  it('flags the captured bypassPermissions tool call and not the default-mode one', () => {
    const read = (f: string) => claudeAdapter.normalize(
      JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')), ctx
    )
    expect(read('PreToolUse-14.json')?.permissionsBypassed).toBe(true)
    expect(read('PreToolUse-5.json')?.permissionsBypassed).toBeUndefined()
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
    expect(kinds).toContain('turn-end')
  })
})
