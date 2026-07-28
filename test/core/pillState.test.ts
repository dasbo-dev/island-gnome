import { describe, it, expect } from 'vitest'
import { pillState } from '../../src/core/pillState.js'
import type { Session, SessionState } from '../../src/core/types.js'

function sess(state: SessionState, over: Partial<Session> = {}): Session {
  return {
    key: `claude:${state}`,
    agent: 'claude',
    sessionId: state,
    project: 'dasbo-island',
    cwd: '/home/me/projects/dasbo-island',
    state,
    pid: 4242,
    startedAt: 0,
    lastEventAt: 0,
    ...over,
  }
}

const pending = { id: 'p1', tool: 'Bash', deadline: 0, queued: 0 }

describe('pillState', () => {
  it('is idle with no sessions', () => {
    expect(pillState([])).toBe('idle')
  })

  it('ranks error above running above idle', () => {
    expect(pillState([sess('idle'), sess('running')])).toBe('running')
    expect(pillState([sess('running'), sess('error')])).toBe('error')
    expect(pillState([sess('idle')])).toBe('idle')
  })

  it('reports done only when every session is done', () => {
    expect(pillState([sess('done'), sess('done')])).toBe('done')
    expect(pillState([sess('done'), sess('running')])).toBe('running')
  })

  it('lets a pending permission outrank an errored session', () => {
    const waiting = sess('waiting', {
      key: 'claude:w',
      sessionId: 'w',
      pendingPermission: pending,
    })
    expect(pillState([sess('error'), waiting])).toBe('waiting')
  })

  it('lets a pending permission outrank an all-done set', () => {
    const waiting = sess('done', {
      key: 'claude:w',
      sessionId: 'w',
      pendingPermission: pending,
    })
    expect(pillState([sess('done'), waiting])).toBe('waiting')
  })
})
