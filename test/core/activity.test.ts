import { describe, it, expect } from 'vitest'
import { activityText, noticeVisible } from '../../src/core/activity.js'
import type { Session } from '../../src/core/types.js'

function session(over: Partial<Session> = {}): Session {
  return {
    key: 'claude:s1',
    agent: 'claude',
    sessionId: 's1',
    project: 'dasbo-island',
    cwd: '/home/me/projects/dasbo-island',
    state: 'idle',
    pid: 4242,
    startedAt: 0,
    conversationIndex: 1,
    lastEventAt: 0,
    ...over,
  }
}

/**
 * Any fixed clock. Every session built above has no notice, so for all but the
 * notice tests this value is inert — it exists so the call sites read the same.
 */
const NOW = 10_000

describe('activityText', () => {
  it('names the pending tool and its detail, with the queue depth', () => {
    const r = activityText(session({
      state: 'waiting',
      pendingPermission: { id: 'p1', tool: 'Bash', detail: 'rm -rf build', deadline: 0, queued: 2 },
    }), NOW)
    expect(r.text).toBe('waiting for you · Bash · rm -rf build · +2 more')
    expect(r.hint).toBe(false)
  })

  it('omits the queue suffix when nothing is behind the request', () => {
    const r = activityText(session({
      state: 'waiting',
      pendingPermission: { id: 'p1', tool: 'Bash', deadline: 0, queued: 0 },
    }), NOW)
    expect(r.text).toBe('waiting for you · Bash')
  })

  it('bounds a hostile tool name in a pending request', () => {
    const r = activityText(session({
      state: 'waiting',
      pendingPermission: { id: 'p1', tool: 'T'.repeat(200), deadline: 0, queued: 0 },
    }), NOW)
    expect(r.text, 'an unbounded tool name pushes Allow and Deny off screen').toContain('…')
    expect(r.text).toBe(`waiting for you · ${'T'.repeat(39)}…`)
  })

  it('shows the running tool and its detail', () => {
    const r = activityText(session({ state: 'running', currentTool: 'Edit', detail: 'src/main.js' }), NOW)
    expect(r.text).toBe('Edit · src/main.js')
    expect(r.hint).toBe(false)
  })

  it('shows the running tool alone when there is no detail', () => {
    const r = activityText(session({ state: 'running', currentTool: 'Read' }), NOW)
    expect(r.text).toBe('Read')
  })

  it('shows a detail with no tool, which is how an error without a tool reads', () => {
    const r = activityText(session({ state: 'error', detail: 'boom' }), NOW)
    expect(r.text).toBe('boom')
    expect(r.hint).toBe(false)
  })

  it('calls a running session with no tool thinking, as a dim hint', () => {
    const r = activityText(session({ state: 'running' }), NOW)
    expect(r.text).toBe('thinking…')
    expect(r.hint).toBe(true)
  })

  it('calls an idle session idle, as a dim hint', () => {
    const r = activityText(session({ state: 'idle' }), NOW)
    expect(r.text).toBe('idle')
    expect(r.hint).toBe(true)
  })

  it('says done for a finished session, at full weight', () => {
    const r = activityText(session({ state: 'done' }), NOW)
    expect(r.text).toBe('done')
    expect(r.hint).toBe(false)
  })

  it('says error for an error carrying no detail', () => {
    const r = activityText(session({ state: 'error' }), NOW)
    expect(r.text).toBe('error')
    expect(r.hint).toBe(false)
  })
})

describe('activityText for a pending question', () => {
  const pendingQuestion = {
    id: 'perm-1',
    deadline: 0,
    questions: [
      {
        question: 'Which library?',
        header: 'Library',
        options: [
          { label: 'date-fns', description: '' },
          { label: 'Luxon', description: '' },
        ],
        multiSelect: false,
      },
    ],
  }

  it('names the question by its header', () => {
    const s = session({ state: 'waiting', pendingQuestion })
    expect(activityText(s, NOW)).toEqual({ text: 'question · Library', hint: false })
  })

  it('takes precedence over the tool that is still recorded on the row', () => {
    const s = session({ state: 'waiting', currentTool: 'AskUserQuestion', pendingQuestion })
    expect(activityText(s, NOW).text).toBe('question · Library')
  })
})

describe('activityText for a notice', () => {
  const notice = { text: 'Claude is waiting for your input', until: 20_000 }

  it('says what the agent said, at full weight', () => {
    const r = activityText(session({ state: 'idle', notice }), NOW)
    expect(r.text).toBe('Claude is waiting for your input')
    expect(r.hint, 'a notice is something said, not a placeholder').toBe(false)
  })

  it('outranks the idle hint it exists to correct', () => {
    expect(activityText(session({ state: 'idle', notice }), NOW).text).not.toBe('idle')
  })

  it('outranks a tool still recorded on the row', () => {
    const s = session({ state: 'running', currentTool: 'Bash', detail: 'npm test', notice })
    expect(activityText(s, NOW).text).toBe('Claude is waiting for your input')
  })

  it('yields to a pending permission, which has buttons the user must reach', () => {
    const s = session({
      state: 'waiting',
      notice,
      pendingPermission: { id: 'p1', tool: 'Bash', deadline: 0, queued: 0 },
    })
    expect(activityText(s, NOW).text).toBe('waiting for you · Bash')
  })

  it('yields to a pending question for the same reason', () => {
    const s = session({
      state: 'waiting',
      notice,
      pendingQuestion: {
        id: 'q1',
        deadline: 0,
        questions: [
          { question: 'Which?', header: 'Pick', options: [{ label: 'a', description: '' }], multiSelect: false },
        ],
      },
    })
    expect(activityText(s, NOW).text).toBe('question · Pick')
  })

  it('is gone once its deadline has passed', () => {
    const r = activityText(session({ state: 'idle', notice }), 20_001)
    expect(r.text).toBe('idle')
    expect(r.hint).toBe(true)
  })

  it('is gone exactly at the deadline, not one tick after it', () => {
    expect(activityText(session({ state: 'idle', notice }), 20_000).text).toBe('idle')
  })

  it('is still there one millisecond before the deadline', () => {
    expect(activityText(session({ state: 'idle', notice }), 19_999).text).toBe(notice.text)
  })

  it('never expires when the deadline is zero', () => {
    const forever = { text: 'waiting', until: 0 }
    expect(activityText(session({ state: 'idle', notice: forever }), 9_999_999).text).toBe('waiting')
  })

  it('bounds a hostile message, so the row cannot grow without limit', () => {
    const long = { text: 'M'.repeat(300), until: 0 }
    const r = activityText(session({ state: 'idle', notice: long }), NOW)
    expect(r.text).toBe(`${'M'.repeat(119)}…`)
  })

  it('flattens a multi-line message onto the one label', () => {
    const multi = { text: 'line one\n\n  line two', until: 0 }
    expect(activityText(session({ state: 'idle', notice: multi }), NOW).text).toBe('line one line two')
  })
})

describe('noticeVisible', () => {
  const notice = { text: 'Claude is waiting for your input', until: 20_000 }

  it('is false with no notice at all', () => {
    expect(noticeVisible(session({}), NOW)).toBe(false)
  })

  it('is true for a live notice with nothing else holding the row', () => {
    expect(noticeVisible(session({ state: 'idle', notice }), NOW)).toBe(true)
  })

  it('is false once the deadline has passed', () => {
    expect(noticeVisible(session({ state: 'idle', notice }), 20_001)).toBe(false)
  })

  it('is false exactly at the deadline, not one tick after it', () => {
    expect(noticeVisible(session({ state: 'idle', notice }), 20_000)).toBe(false)
  })

  it('is true one millisecond before the deadline', () => {
    expect(noticeVisible(session({ state: 'idle', notice }), 19_999)).toBe(true)
  })

  it('never expires when the deadline is zero', () => {
    const forever = { text: 'waiting', until: 0 }
    expect(noticeVisible(session({ state: 'idle', notice: forever }), 9_999_999)).toBe(true)
  })

  it('is false while a permission is pending, even with a live notice', () => {
    const s = session({
      state: 'waiting',
      notice,
      pendingPermission: { id: 'p1', tool: 'Bash', deadline: 0, queued: 0 },
    })
    expect(
      noticeVisible(s, NOW),
      'a permission holds the row, so the notice is not what is showing'
    ).toBe(false)
  })

  it('is false while a question is pending, even with a live notice', () => {
    const s = session({
      state: 'waiting',
      notice,
      pendingQuestion: {
        id: 'q1',
        deadline: 0,
        questions: [
          { question: 'Which?', header: 'Pick', options: [{ label: 'a', description: '' }], multiSelect: false },
        ],
      },
    })
    expect(noticeVisible(s, NOW)).toBe(false)
  })
})
