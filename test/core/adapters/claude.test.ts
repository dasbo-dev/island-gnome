import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { claudeAdapter } from '../../../src/core/adapters/claude.js'
import type { HookContext } from '../../../src/core/types.js'
import { parseQuestions } from '../../../src/core/questions.js'
import { SessionStore } from '../../../src/core/store.js'
import { activityText } from '../../../src/core/activity.js'

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

  it('flags a SessionEnd with reason clear, so /clear does not sound the done cue', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'SessionEnd', session_id: 's1', cwd: '/p', reason: 'clear' }, ctx
    )
    expect(e?.endedByClear).toBe(true)
  })

  it('leaves a real exit unflagged, so the done cue still plays for it', () => {
    for (const reason of ['logout', 'prompt_input_exit', 'other']) {
      const e = claudeAdapter.normalize(
        { hook_event_name: 'SessionEnd', session_id: 's1', cwd: '/p', reason }, ctx
      )
      expect(e?.endedByClear, reason).toBeUndefined()
    }
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
    expect(kinds).toContain('error')
  })
})

/**
 * CAPTURED, like the five events above it. `StopFailure-17.json` is a verbatim
 * payload from Claude Code 2.1.220 driven against a local server that answered
 * every request with HTTP 400 — see docs/agent-dialects.md for the exact
 * method. That run fired `SessionStart`, `UserPromptSubmit`, `StopFailure`,
 * `SessionEnd`, and **no `Stop` at all**: an API error leaves the turn through
 * a different hook than a normal one, which is why the island used to sit on
 * "thinking" until the user typed again.
 */
describe('claudeAdapter.normalize for a StopFailure', () => {
  const raw = JSON.parse(readFileSync('test/fixtures/claude/StopFailure-17.json', 'utf8'))

  it('maps the captured payload to the error kind', () => {
    expect(claudeAdapter.normalize(raw, ctx)?.kind).toBe('error')
  })

  it('carries the message the user was shown as the detail', () => {
    expect(claudeAdapter.normalize(raw, ctx)?.detail).toBe(
      'API Error: 400 dasbo capture: deliberate API failure'
    )
  })

  it('prefers error_details when the payload carries one', () => {
    // Present on the prompt-too-long path, absent on the captured one.
    const e = claudeAdapter.normalize(
      { ...raw, error_details: 'input length exceeds the context window' }, ctx
    )
    expect(e?.detail).toBe('input length exceeds the context window')
  })

  it('falls back to the error kind when there is no text at all', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'StopFailure', session_id: 's1', cwd: '/p', error: 'rate_limit' }, ctx
    )
    expect(e?.detail).toBe('rate_limit')
  })

  it('leaves the detail undefined rather than printing a placeholder', () => {
    // `error` defaults to the literal "unknown" in Claude's own emitter, which
    // says nothing; a row with no detail reads as "error", which says the same
    // thing in the island's own vocabulary.
    const e = claudeAdapter.normalize(
      { hook_event_name: 'StopFailure', session_id: 's1', cwd: '/p', error: 'unknown' }, ctx
    )
    expect(e?.detail).toBeUndefined()
  })

  it('falls back to the argv event name, so the install plan carries the meaning', () => {
    const e = claudeAdapter.normalize(
      { session_id: 's1', cwd: '/p', error: 'server_error' }, { ...ctx, event: 'StopFailure' }
    )
    expect(e?.kind).toBe('error')
  })
})

describe('an API-errored turn stops the island saying "thinking"', () => {
  it('settles the session out of running when StopFailure arrives', () => {
    // The reported bug, end to end: Claude answers a prompt with an API error
    // and the row is stuck on the running placeholder forever, because nothing
    // else ever clears it — the reaper only drops a session whose *process* is
    // gone, and the REPL is still sitting there.
    const store = new SessionStore()
    const read = (f: string) => claudeAdapter.normalize(
      JSON.parse(readFileSync(`test/fixtures/claude/${f}`, 'utf8')),
      { pid: 1234, ts: 5000, cwd: '/hook/cwd' }
    )!

    store.apply({ ...read('UserPromptSubmit-1.json'), sessionId: 's1', ts: 1000 })
    expect(store.list()[0]!.state, 'a submitted prompt is a running session').toBe('running')
    expect(activityText(store.list()[0]!, 1000).text).toBe('thinking…')

    store.apply({ ...read('StopFailure-17.json'), sessionId: 's1', ts: 2000 })
    const session = store.list()[0]!
    expect(session.state).toBe('error')
    expect(activityText(session, 2000).text).toBe(
      'API Error: 400 dasbo capture: deliberate API failure'
    )
  })
})

const askPayload = {
  hook_event_name: 'PreToolUse',
  session_id: 's1',
  cwd: '/p/app',
  tool_name: 'AskUserQuestion',
  tool_input: {
    questions: [
      {
        question: 'Which library?',
        header: 'Library',
        options: [
          { label: 'date-fns', description: 'tree-shakeable' },
          { label: 'Luxon', description: 'timezone-aware' },
        ],
        multiSelect: false,
      },
    ],
  },
}

describe('claudeAdapter.parseQuestions', () => {
  it('parses an AskUserQuestion payload', () => {
    expect(claudeAdapter.parseQuestions!(askPayload)).toEqual(
      parseQuestions(askPayload.tool_input)
    )
  })

  it('ignores any other tool', () => {
    expect(
      claudeAdapter.parseQuestions!({ ...askPayload, tool_name: 'Bash' })
    ).toBeNull()
  })

  it('ignores an AskUserQuestion whose input does not parse', () => {
    expect(
      claudeAdapter.parseQuestions!({ ...askPayload, tool_input: { questions: [] } })
    ).toBeNull()
  })

  it('ignores a non-record payload', () => {
    expect(claudeAdapter.parseQuestions!('nope')).toBeNull()
  })
})

describe('claudeAdapter.encodeDecision for an answer', () => {
  it('carries the answer as a denial reason, the only channel PreToolUse has', () => {
    expect(claudeAdapter.encodeDecision({ kind: 'answer', answer: 'Library: Luxon' })).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Library: Luxon',
      },
    })
  })

  it('never emits an empty reason', () => {
    const out = claudeAdapter.encodeDecision({ kind: 'answer' }) as {
      hookSpecificOutput: { permissionDecisionReason: string }
    }
    expect(out.hookSpecificOutput.permissionDecisionReason.length).toBeGreaterThan(0)
  })
})

/**
 * INFERRED, NOT CAPTURED. There is no Notification fixture in
 * test/fixtures/claude/ and docs/agent-dialects.md does not cover the event —
 * it sits where SessionEnd sits in that document. These payloads are written
 * from the published shape, the way codex.test.ts writes its own.
 */
describe('claudeAdapter.normalize for a Notification', () => {
  it('maps Notification to the notification kind', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'Notification', session_id: 's1', cwd: '/p/app',
        message: 'Claude is waiting for your input' },
      ctx
    )
    expect(e?.kind).toBe('notification')
  })

  it('carries the message through as the detail', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'Notification', session_id: 's1', cwd: '/p/app',
        message: 'Claude needs your permission to use Bash' },
      ctx
    )
    expect(e?.detail).toBe('Claude needs your permission to use Bash')
  })

  it('leaves the detail undefined when the message is missing or not a string', () => {
    const missing = claudeAdapter.normalize(
      { hook_event_name: 'Notification', session_id: 's1', cwd: '/p/app' }, ctx
    )
    expect(missing?.detail, 'no text means no notice, which means silence').toBeUndefined()

    const wrongType = claudeAdapter.normalize(
      { hook_event_name: 'Notification', session_id: 's1', cwd: '/p/app', message: { a: 1 } }, ctx
    )
    expect(wrongType?.detail).toBeUndefined()
  })

  it('returns null without a session id, like every other event', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'Notification', cwd: '/p/app', message: 'waiting' }, ctx
    )
    expect(e).toBeNull()
  })

  it('falls back to the argv event name, so the install plan carries the meaning', () => {
    const e = claudeAdapter.normalize(
      { session_id: 's1', cwd: '/p', message: 'waiting' },
      { ...ctx, event: 'Notification' }
    )
    expect(e?.kind).toBe('notification')
    expect(e?.detail).toBe('waiting')
  })

  it('does not let a stray message field hijack a tool event', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'PreToolUse', session_id: 's1', cwd: '/p/app',
        tool_name: 'Bash', tool_input: { command: 'ls' }, message: 'ignore me' },
      ctx
    )
    expect(e?.detail).toBe('ls')
  })
})

describe('claude taskTools', () => {
  it('names every tool whose completion can move the task directory', () => {
    expect([...(claudeAdapter.taskTools ?? [])].sort()).toEqual([
      'TaskCreate',
      'TaskList',
      'TaskUpdate',
      'TodoWrite',
    ])
  })

  it('does not name an ordinary tool', () => {
    expect(claudeAdapter.taskTools?.has('Edit')).toBe(false)
  })
})
