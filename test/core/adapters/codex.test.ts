import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { codexAdapter } from '../../../src/core/adapters/codex.js'
import type { HookContext } from '../../../src/core/types.js'

const ctx: HookContext = { pid: 1, ts: 2, cwd: '/hook/cwd' }

// Codex CLI 0.146.0, captured verbatim — see docs/agent-dialects.md. Codex
// speaks Claude's dialect: PascalCase `hook_event_name`, `session_id`, `cwd`,
// `tool_name`, `tool_input`, `transcript_path`. The dotted `session.start`
// spelling earlier releases installed names no event Codex has ever emitted.

describe('codexAdapter.normalize', () => {
  it('maps every event Codex fires to a kind', () => {
    const cases: Array<[string, string]> = [
      ['SessionStart', 'session-start'],
      ['UserPromptSubmit', 'prompt-submit'],
      ['PreToolUse', 'tool-start'],
      ['PostToolUse', 'tool-end'],
      ['Stop', 'turn-end'],
      ['SessionEnd', 'session-end'],
    ]
    for (const [name, kind] of cases) {
      const e = codexAdapter.normalize({ hook_event_name: name, session_id: 's1', cwd: '/p/app' }, ctx)
      expect(e?.kind, name).toBe(kind)
    }
  })

  it('reads the tool name and its input off a captured tool call', () => {
    const e = codexAdapter.normalize(
      { hook_event_name: 'PreToolUse', session_id: 's1', cwd: '/p/app', tool_name: 'Bash', tool_input: { command: 'echo hi' } },
      ctx
    )
    expect(e?.tool).toBe('Bash')
    expect(e?.detail).toBe('echo hi')
  })

  it('falls back to the argv event and the hook cwd', () => {
    const e = codexAdapter.normalize({ session_id: 's1' }, { ...ctx, event: 'PreToolUse' })
    expect(e?.kind).toBe('tool-start')
    expect(e?.cwd).toBe('/hook/cwd')
  })

  it('returns null on unknown event or missing session id', () => {
    expect(codexAdapter.normalize({ hook_event_name: 'nope', session_id: 's', cwd: '/p' }, ctx)).toBeNull()
    expect(codexAdapter.normalize({ hook_event_name: 'PreToolUse', cwd: '/p' }, ctx)).toBeNull()
  })

  it('drops the events Codex has but dasbo does not install', () => {
    // PermissionRequest, PreCompact, PostCompact, SubagentStart and
    // SubagentStop exist in Codex 0.146 and are not wired: they must fall
    // through as unrecognised rather than land on the wrong kind.
    for (const name of ['PermissionRequest', 'PreCompact', 'PostCompact', 'SubagentStart', 'SubagentStop']) {
      expect(codexAdapter.normalize({ hook_event_name: name, session_id: 's1', cwd: '/p' }, ctx), name).toBeNull()
    }
  })

  it('returns null for a non-object payload', () => {
    expect(codexAdapter.normalize('not json', ctx)).toBeNull()
    expect(codexAdapter.normalize(null, ctx)).toBeNull()
  })

  it('returns null when neither payload nor argv names an event', () => {
    expect(codexAdapter.normalize({ session_id: 's1', cwd: '/p' }, ctx)).toBeNull()
  })

  it('returns null when neither the payload nor the hook supplies a cwd', () => {
    expect(
      codexAdapter.normalize({ hook_event_name: 'PreToolUse', session_id: 's1' }, { ...ctx, cwd: '' })
    ).toBeNull()
  })
})

describe('codexAdapter against captured fixtures', () => {
  const dir = 'test/fixtures/codex'
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  const read = (f: string) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'))

  it('normalizes every captured payload into a usable event', () => {
    for (const f of files) {
      const e = codexAdapter.normalize(read(f), ctx)
      expect(e, `${f} must normalize, not drop`).not.toBeNull()
      expect(e!.sessionId, `${f} must yield a session id`).toBeTruthy()
      expect(e!.cwd, `${f} must yield a cwd`).toBeTruthy()
    }
  })

  it('covers the whole session arc across the captures', () => {
    const kinds = new Set(files.map((f) => codexAdapter.normalize(read(f), ctx)?.kind))
    expect(kinds).toEqual(
      new Set(['session-start', 'prompt-submit', 'tool-start', 'tool-end', 'turn-end', 'session-end'])
    )
  })

  it('carries one session id and one transcript path through the whole arc', () => {
    // Every event of a session must land on the same row: the island keys rows
    // by session id, so a capture disagreeing here would split one session in two.
    const live = files.filter((f) => f !== 'SessionEnd.json').map((f) => codexAdapter.normalize(read(f), ctx)!)
    expect(new Set(live.map((e) => e.sessionId)).size).toBe(1)
    expect(new Set(live.map((e) => e.transcriptPath)).size).toBe(1)
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

describe('codexAdapter.encodeDecision for an answer', () => {
  it('says nothing at all, since Codex has no question concept', () => {
    expect(codexAdapter.encodeDecision({ kind: 'answer', answer: 'x' })).toEqual({})
  })
})

describe('codex parseTasks (UNVERIFIED shape)', () => {
  const updatePlan = {
    tool_name: 'update_plan',
    tool_input: {
      plan: [
        { step: 'Read the spec', status: 'completed' },
        { step: 'Write the parser', status: 'in_progress' },
        { step: 'Wire the row', status: 'pending' },
      ],
    },
  }

  it('turns a plan snapshot into tasks numbered by position', () => {
    expect(codexAdapter.parseTasks?.(updatePlan)).toEqual([
      { id: '1', subject: 'Read the spec', status: 'completed' },
      { id: '2', subject: 'Write the parser', status: 'in_progress' },
      { id: '3', subject: 'Wire the row', status: 'pending' },
    ])
  })

  it('returns null for any other tool', () => {
    expect(codexAdapter.parseTasks?.({ ...updatePlan, tool_name: 'shell' })).toBeNull()
  })

  it('returns null when the plan is not an array of steps', () => {
    expect(codexAdapter.parseTasks?.({ tool_name: 'update_plan', tool_input: {} })).toBeNull()
    expect(
      codexAdapter.parseTasks?.({ tool_name: 'update_plan', tool_input: { plan: 'soon' } })
    ).toBeNull()
  })

  it('rejects the whole snapshot when one step is unusable', () => {
    const bad = {
      tool_name: 'update_plan',
      tool_input: { plan: [{ step: 'Fine', status: 'pending' }, { step: 'Broken' }] },
    }
    expect(codexAdapter.parseTasks?.(bad)).toBeNull()
  })

  it('accepts an empty plan as an empty list, not a failure', () => {
    expect(codexAdapter.parseTasks?.({ tool_name: 'update_plan', tool_input: { plan: [] } }))
      .toEqual([])
  })
})
