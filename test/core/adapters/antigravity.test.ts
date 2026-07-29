import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { antigravityAdapter } from '../../../src/core/adapters/antigravity.js'
import type { HookContext } from '../../../src/core/types.js'

const ctx = (event?: string): HookContext => ({ pid: 7, ts: 9, cwd: '/hook/cwd', event })

describe('antigravityAdapter.normalize', () => {
  it('takes the event name from argv, since no payload field exists', () => {
    const e = antigravityAdapter.normalize(
      { conversationId: 'c1', workspacePaths: [], transcriptPath: '/t.json',
        toolCall: { name: 'write_to_file' } },
      ctx('PreToolUse')
    )
    expect(e).toEqual({
      agent: 'antigravity', kind: 'tool-start', sessionId: 'c1', cwd: '/hook/cwd',
      tool: 'write_to_file', detail: undefined, transcriptPath: '/t.json', pid: 7, ts: 9,
    })
  })

  it('returns null when argv carries no event, since the payload cannot supply one', () => {
    expect(antigravityAdapter.normalize({ conversationId: 'c1' }, ctx())).toBeNull()
  })

  it('uses workspacePaths[0] when it is non-empty', () => {
    const e = antigravityAdapter.normalize(
      { conversationId: 'c1', workspacePaths: ['/home/me/app'] }, ctx('Stop')
    )
    expect(e?.cwd).toBe('/home/me/app')
  })

  it('falls back to the hook cwd when workspacePaths is the observed empty array', () => {
    const e = antigravityAdapter.normalize(
      { conversationId: 'c1', workspacePaths: [] }, ctx('Stop')
    )
    expect(e?.cwd).toBe('/hook/cwd')
  })

  it('returns null when neither workspacePaths nor the hook supplies a cwd', () => {
    const e = antigravityAdapter.normalize(
      { conversationId: 'c1', workspacePaths: [] },
      { pid: 7, ts: 9, cwd: '', event: 'Stop' }
    )
    expect(e).toBeNull()
  })

  it('maps every wired event kind', () => {
    const pairs: Array<[string, string]> = [
      ['PreInvocation', 'prompt-submit'],
      ['PostInvocation', 'turn-end'],
      ['PreToolUse', 'tool-start'],
      ['PostToolUse', 'tool-end'],
      ['Stop', 'turn-end'],
    ]
    for (const [event, kind] of pairs) {
      const e = antigravityAdapter.normalize({ conversationId: 'c1' }, ctx(event))
      expect(e?.kind, event).toBe(kind)
    }
  })

  it('treats an empty error string as success, not failure', () => {
    const e = antigravityAdapter.normalize(
      { conversationId: 'c1', error: '' }, ctx('PostToolUse')
    )
    expect(e?.kind).toBe('tool-end')
  })

  it('reports an error kind when error is non-empty', () => {
    const e = antigravityAdapter.normalize(
      { conversationId: 'c1', error: 'boom' }, ctx('PostToolUse')
    )
    expect(e?.kind).toBe('error')
    expect(e?.detail).toBe('boom')
  })

  it('reports an errored Stop as an error, since a turn end is no longer terminal', () => {
    const e = antigravityAdapter.normalize(
      { conversationId: 'c1', error: 'boom' }, ctx('Stop')
    )
    expect(e?.kind).toBe('error')
    expect(e?.detail, 'the error text is still surfaced as detail').toBe('boom')
  })

  it('tolerates toolCall being null on a tool event', () => {
    const e = antigravityAdapter.normalize(
      { conversationId: 'c1', toolCall: null }, ctx('PostToolUse')
    )
    expect(e?.kind).toBe('tool-end')
    expect(e?.tool).toBeUndefined()
  })

  it('extracts a run_command CommandLine as detail', () => {
    const e = antigravityAdapter.normalize(
      { conversationId: 'c1', toolCall: { name: 'run_command', args: { CommandLine: 'ls -la' } } },
      ctx('PreToolUse')
    )
    expect(e?.detail).toBe('ls -la')
  })

  it('extracts a write_to_file TargetFile as detail', () => {
    const e = antigravityAdapter.normalize(
      { conversationId: 'c1', toolCall: { name: 'write_to_file', args: { TargetFile: '/p/a.txt' } } },
      ctx('PreToolUse')
    )
    expect(e?.detail).toBe('/p/a.txt')
  })

  it('returns null with no conversation id', () => {
    expect(antigravityAdapter.normalize({ workspacePaths: ['/p'] }, ctx('Stop'))).toBeNull()
  })

  it('returns null for an unknown event and a non-object payload', () => {
    expect(antigravityAdapter.normalize({ conversationId: 'c1' }, ctx('Nope'))).toBeNull()
    expect(antigravityAdapter.normalize(null, ctx('Stop'))).toBeNull()
  })
})

describe('antigravityAdapter.encodeDecision', () => {
  it('encodes allow, deny and fallthrough', () => {
    expect((antigravityAdapter.encodeDecision({ kind: 'allow' }) as any).permissionDecision).toBe('allow')
    expect((antigravityAdapter.encodeDecision({ kind: 'deny' }) as any).permissionDecision).toBe('deny')
    expect(antigravityAdapter.encodeDecision({ kind: 'fallthrough' })).toEqual({})
  })
})

describe('antigravityAdapter against captured fixtures', () => {
  const dir = 'test/fixtures/antigravity'

  it('has fixtures to test against', () => {
    expect(existsSync(dir), `${dir} must exist — fixtures are the adapter spec`).toBe(true)
    expect(readdirSync(dir).filter((f) => f.endsWith('.json')).length).toBeGreaterThan(0)
  })

  it('normalizes every captured payload, taking the event from the filename', () => {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const event = f.split('-')[0]!
      const raw = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'))
      const e = antigravityAdapter.normalize(raw, ctx(event))
      expect(e, `${f} must normalize, not drop`).not.toBeNull()
      expect(e!.sessionId, `${f} must yield a session id`).toBeTruthy()
      expect(e!.cwd, `${f} must yield a cwd`).toBeTruthy()
    }
  })

  it('confirms the fixtures really do lack an event-name field', () => {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const raw = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'))
      for (const key of ['hookEventName', 'hook_event_name', 'type', 'event']) {
        expect(raw[key], `${f} unexpectedly has ${key} — revisit the argv design`).toBeUndefined()
      }
    }
  })
})

describe('antigravityAdapter.encodeDecision for an answer', () => {
  it('says nothing at all, since Antigravity has no question concept', () => {
    expect(antigravityAdapter.encodeDecision({ kind: 'answer', answer: 'x' })).toEqual({})
  })
})
