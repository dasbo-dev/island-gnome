import { describe, it, expect } from 'vitest'
import { activityText } from '../../src/core/activity.js'
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
    lastEventAt: 0,
    ...over,
  }
}

describe('activityText', () => {
  it('names the pending tool and its detail, with the queue depth', () => {
    const r = activityText(session({
      state: 'waiting',
      pendingPermission: { id: 'p1', tool: 'Bash', detail: 'rm -rf build', deadline: 0, queued: 2 },
    }))
    expect(r.text).toBe('waiting for you · Bash · rm -rf build · +2 more')
    expect(r.hint).toBe(false)
  })

  it('omits the queue suffix when nothing is behind the request', () => {
    const r = activityText(session({
      state: 'waiting',
      pendingPermission: { id: 'p1', tool: 'Bash', deadline: 0, queued: 0 },
    }))
    expect(r.text).toBe('waiting for you · Bash')
  })

  it('bounds a hostile tool name in a pending request', () => {
    const r = activityText(session({
      state: 'waiting',
      pendingPermission: { id: 'p1', tool: 'T'.repeat(200), deadline: 0, queued: 0 },
    }))
    expect(r.text, 'an unbounded tool name pushes Allow and Deny off screen').toContain('…')
    expect(r.text).toBe(`waiting for you · ${'T'.repeat(39)}…`)
  })

  it('shows the running tool and its detail', () => {
    const r = activityText(session({ state: 'running', currentTool: 'Edit', detail: 'src/main.js' }))
    expect(r.text).toBe('Edit · src/main.js')
    expect(r.hint).toBe(false)
  })

  it('shows the running tool alone when there is no detail', () => {
    const r = activityText(session({ state: 'running', currentTool: 'Read' }))
    expect(r.text).toBe('Read')
  })

  it('shows a detail with no tool, which is how an error without a tool reads', () => {
    const r = activityText(session({ state: 'error', detail: 'boom' }))
    expect(r.text).toBe('boom')
    expect(r.hint).toBe(false)
  })

  it('calls a running session with no tool thinking, as a dim hint', () => {
    const r = activityText(session({ state: 'running' }))
    expect(r.text).toBe('thinking…')
    expect(r.hint).toBe(true)
  })

  it('calls an idle session idle, as a dim hint', () => {
    const r = activityText(session({ state: 'idle' }))
    expect(r.text).toBe('idle')
    expect(r.hint).toBe(true)
  })

  it('says done for a finished session, at full weight', () => {
    const r = activityText(session({ state: 'done' }))
    expect(r.text).toBe('done')
    expect(r.hint).toBe(false)
  })

  it('says error for an error carrying no detail', () => {
    const r = activityText(session({ state: 'error' }))
    expect(r.text).toBe('error')
    expect(r.hint).toBe(false)
  })
})
