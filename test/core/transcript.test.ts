import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { scanTranscript, watchesTranscript, MAX_PARTIAL_LINE } from '../../src/core/transcript.js'
import { SessionStore } from '../../src/core/store.js'
import { pillState } from '../../src/core/pillState.js'
import { islandLabel } from '../../src/core/islandLabel.js'
import type { Session } from '../../src/core/types.js'

const FIXTURE = 'test/fixtures/claude/transcript-interrupted.jsonl'

function session(over: Partial<Session> = {}): Session {
  return {
    key: 'claude:s1',
    agent: 'claude',
    sessionId: 's1',
    project: 'app',
    cwd: '/p/app',
    state: 'running',
    pid: 42,
    startedAt: 1000,
    conversationIndex: 1,
    lastEventAt: 1000,
    transcriptPath: '/home/me/.claude/projects/-p-app/s1.jsonl',
    ...over,
  }
}

describe('scanTranscript', () => {
  it('finds the interrupt Claude wrote into a real transcript', () => {
    const text = readFileSync(FIXTURE, 'utf8')
    expect(scanTranscript(text).interrupted).toBe(true)
  })

  it('does not fire on the prompt and the assistant turn alone', () => {
    const lines = readFileSync(FIXTURE, 'utf8').split('\n').filter(Boolean)
    const beforeInterrupt = lines.slice(0, -1).join('\n') + '\n'
    expect(scanTranscript(beforeInterrupt).interrupted).toBe(false)
  })

  it('does not fire on a typed prompt that quotes the marker', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: '[Request interrupted by user for tool use] — why did you stop?' },
    })
    expect(scanTranscript(line + '\n').interrupted).toBe(false)
  })

  it('does not fire on the tool_result of a denied permission', () => {
    const line = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', content: "The user doesn't want to proceed with this tool use.", is_error: true }],
      },
      toolDenialKind: 'user-rejected',
    })
    expect(scanTranscript(line + '\n').interrupted).toBe(false)
  })

  it('accepts a marker line that carries no interruptedMessageId', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] },
    })
    expect(scanTranscript(line + '\n').interrupted).toBe(true)
  })

  it('accepts interruptedMessageId even if the marker is worded differently', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: '[Cancelled]' }] },
      interruptedMessageId: 'msg_01',
    })
    expect(scanTranscript(line + '\n').interrupted).toBe(true)
  })

  it('ignores an assistant line that quotes the marker back', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: '[Request interrupted by user]' }] },
    })
    expect(scanTranscript(line + '\n').interrupted).toBe(false)
  })

  it('survives a half-written line and hands it back for the next read', () => {
    const partial = '{"type":"user","mess'
    const result = scanTranscript(partial)
    expect(result.interrupted).toBe(false)
    expect(result.rest).toBe(partial)
  })

  it('joins a line split across two reads', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] },
    })
    const first = scanTranscript(line.slice(0, 20))
    expect(first.interrupted).toBe(false)
    expect(scanTranscript(first.rest + line.slice(20) + '\n').interrupted).toBe(true)
  })

  it('keeps no remainder when the chunk ends on a newline', () => {
    expect(scanTranscript('{"type":"user"}\n').rest).toBe('')
  })

  it('drops a partial line that has outgrown the cap', () => {
    const huge = 'x'.repeat(MAX_PARTIAL_LINE + 10)
    expect(scanTranscript(huge).rest).toBe('')
  })

  it('skips lines that are not JSON at all', () => {
    expect(scanTranscript('not json\n\n{"type":"user"}\n').interrupted).toBe(false)
  })
})

describe('watchesTranscript', () => {
  it('watches a running Claude session that has a transcript', () => {
    expect(watchesTranscript(session())).toBe(true)
  })

  it('ignores a session that is not running', () => {
    expect(watchesTranscript(session({ state: 'idle' }))).toBe(false)
    expect(watchesTranscript(session({ state: 'waiting' }))).toBe(false)
    expect(watchesTranscript(session({ state: 'done' }))).toBe(false)
  })

  it('ignores agents whose transcripts are not Claude JSONL', () => {
    expect(watchesTranscript(session({ agent: 'codex' }))).toBe(false)
    expect(watchesTranscript(session({ agent: 'antigravity' }))).toBe(false)
  })

  it('ignores a session with no transcript path', () => {
    expect(watchesTranscript(session({ transcriptPath: undefined }))).toBe(false)
  })

  it('ignores a transcript path that is not an absolute .jsonl file', () => {
    expect(watchesTranscript(session({ transcriptPath: 's1.jsonl' }))).toBe(false)
    expect(watchesTranscript(session({ transcriptPath: '/dev/zero' }))).toBe(false)
  })
})

// The bug, end to end: the island said "thinking" from the moment the tool
// started until the user typed again, because the Esc that stopped the turn
// fired no hook. The events below are the shapes Claude really sent (see
// test/fixtures/claude/), and the transcript lines are the ones it really
// wrote when the turn was interrupted.
describe('an interrupted turn', () => {
  const lines = readFileSync(FIXTURE, 'utf8').split('\n').filter(Boolean)
  const appendedAfterTheToolStarted = lines.slice(2).join('\n') + '\n'

  function runningSession(): SessionStore {
    const s = new SessionStore()
    s.apply({
      agent: 'claude', kind: 'prompt-submit', sessionId: 's1', cwd: '/tmp/dasbo-interrupt',
      pid: 4242, ts: 1000, transcriptPath: '/home/me/.claude/projects/-tmp/s1.jsonl',
    })
    s.apply({
      agent: 'claude', kind: 'tool-start', tool: 'Bash', detail: 'sleep 120', sessionId: 's1',
      cwd: '/tmp/dasbo-interrupt', pid: 4242, ts: 2000,
    })
    return s
  }

  it('reads "thinking" until something settles it', () => {
    const s = runningSession()
    expect(islandLabel(s.list().length, pillState(s.list())).text).toBe('1 · thinking')
  })

  it('reads "idle" once the transcript shows the interrupt', () => {
    const s = runningSession()
    const session = s.list()[0]!
    expect(watchesTranscript(session)).toBe(true)
    const { interrupted } = scanTranscript(appendedAfterTheToolStarted)
    expect(interrupted).toBe(true)
    s.markInterrupted(session.key, 3000)
    expect(islandLabel(s.list().length, pillState(s.list())).text).toBe('1 · idle')
    expect(s.get('claude:s1')?.currentTool).toBeUndefined()
  })
})
