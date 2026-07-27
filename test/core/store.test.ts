import { describe, it, expect } from 'vitest'
import { SessionStore } from '../../src/core/store.js'
import type { AgentEvent } from '../../src/core/types.js'

function ev(over: Partial<AgentEvent> = {}): AgentEvent {
  return {
    agent: 'claude',
    kind: 'session-start',
    sessionId: 's1',
    cwd: '/home/me/projects/dasbo-island',
    pid: 4242,
    ts: 1000,
    ...over,
  }
}

describe('SessionStore', () => {
  it('creates a session on session-start with project from cwd basename', () => {
    const s = new SessionStore()
    s.apply(ev())
    const list = s.list()
    expect(list).toHaveLength(1)
    expect(list[0]!.project).toBe('dasbo-island')
    expect(list[0]!.state).toBe('idle')
    expect(list[0]!.key).toBe('claude:s1')
  })

  it('creates a session implicitly when the first event is not session-start', () => {
    const s = new SessionStore()
    s.apply(ev({ kind: 'tool-start', tool: 'Edit' }))
    expect(s.list()).toHaveLength(1)
    expect(s.list()[0]!.state).toBe('running')
  })

  it('moves to running on tool-start and records the tool', () => {
    const s = new SessionStore()
    s.apply(ev())
    s.apply(ev({ kind: 'tool-start', tool: 'Edit', detail: 'main.js', ts: 2000 }))
    expect(s.list()[0]!.state).toBe('running')
    expect(s.list()[0]!.currentTool).toBe('Edit')
    expect(s.list()[0]!.detail).toBe('main.js')
  })

  it('returns to idle on tool-end and clears the tool', () => {
    const s = new SessionStore()
    s.apply(ev({ kind: 'tool-start', tool: 'Edit' }))
    s.apply(ev({ kind: 'tool-end', tool: 'Edit', ts: 3000 }))
    expect(s.list()[0]!.state).toBe('idle')
    expect(s.list()[0]!.currentTool).toBeUndefined()
  })

  it('marks done on stop and stamps doneAt', () => {
    const s = new SessionStore()
    s.apply(ev())
    s.apply(ev({ kind: 'stop', ts: 5000 }))
    expect(s.list()[0]!.state).toBe('done')
    expect(s.list()[0]!.doneAt).toBe(5000)
  })

  it('keeps sessions from different agents with the same id separate', () => {
    const s = new SessionStore()
    s.apply(ev({ agent: 'claude' }))
    s.apply(ev({ agent: 'codex' }))
    expect(s.list()).toHaveLength(2)
  })

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const s = new SessionStore()
    let n = 0
    const off = s.subscribe(() => { n++ })
    s.apply(ev())
    expect(n).toBe(1)
    off()
    s.apply(ev({ kind: 'stop', ts: 2000 }))
    expect(n).toBe(1)
  })

  it('setPending puts the session into waiting and clearPending restores idle', () => {
    const s = new SessionStore()
    s.apply(ev())
    s.setPending('claude:s1', { id: 'p1', tool: 'Bash', detail: 'rm -rf build', deadline: 31000, queued: 0 })
    expect(s.list()[0]!.state).toBe('waiting')
    expect(s.list()[0]!.pendingPermission?.tool).toBe('Bash')
    s.clearPending('claude:s1')
    expect(s.list()[0]!.state).toBe('idle')
    expect(s.list()[0]!.pendingPermission).toBeUndefined()
  })

  it('worstState ranks waiting above running above idle', () => {
    const s = new SessionStore()
    s.apply(ev({ sessionId: 'a' }))
    s.apply(ev({ sessionId: 'b', kind: 'tool-start', tool: 'Edit' }))
    expect(s.worstState()).toBe('running')
    s.setPending('claude:a', { id: 'p1', tool: 'Bash', deadline: 0, queued: 0 })
    expect(s.worstState()).toBe('waiting')
  })

  it('reap drops a stale session whose pid is dead', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    const fifteenMin = 15 * 60 * 1000
    s.reap(fifteenMin + 1, () => false)
    expect(s.list()).toHaveLength(0)
  })

  it('reap keeps a stale session whose pid is still alive', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.reap(15 * 60 * 1000 + 1, () => true)
    expect(s.list()).toHaveLength(1)
  })

  it('reap drops a done session after the linger window', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.apply(ev({ kind: 'stop', ts: 1000 }))
    s.reap(1000 + 10_000 + 1, () => true)
    expect(s.list()).toHaveLength(0)
  })

  it('reap keeps a pending permission with a live deadline even if the pid is dead', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.setPending('claude:s1', { id: 'p1', tool: 'Bash', deadline: 30_000, queued: 0 })
    s.reap(99_999_999, () => false)
    expect(s.list()).toHaveLength(1)
  })

  it('reap keeps a pending permission with deadline 0 while the pid is alive', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.setPending('claude:s1', { id: 'p1', tool: 'Bash', deadline: 0, queued: 0 })
    s.reap(99_999_999, () => true)
    expect(s.list()).toHaveLength(1)
  })

  it('reap drops a zombie pending permission: dead pid and deadline 0, and reports its key', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.setPending('claude:s1', { id: 'p1', tool: 'Bash', deadline: 0, queued: 0 })
    const dropped = s.reap(99_999_999, () => false)
    expect(s.list()).toHaveLength(0)
    expect(dropped).toEqual(['claude:s1'])
  })

  it('reap returns the keys it dropped for ordinary abandonment and linger too', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    const fifteenMin = 15 * 60 * 1000
    const dropped = s.reap(fifteenMin + 1, () => false)
    expect(dropped).toEqual(['claude:s1'])
  })

  it('applying tool-end while a permission is pending leaves state waiting, and resolving settles to idle', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.setPending('claude:s1', { id: 'p1', tool: 'Bash', detail: 'rm -rf build', deadline: 30_000, queued: 0 })
    expect(s.list()[0]!.state).toBe('waiting')

    // A parallel tool batch: another tool's tool-end arrives while Bash's
    // permission is still held open.
    s.apply(ev({ kind: 'tool-end', tool: 'Edit', ts: 1000 }))
    expect(s.list()[0]!.state, 'must still say waiting — the agent is still blocked').toBe('waiting')
    expect(s.list()[0]!.pendingPermission?.id).toBe('p1')

    s.clearPending('claude:s1')
    expect(s.list()[0]!.state).toBe('idle')
  })

  it('applying stop while a permission is pending leaves state waiting, and resolving settles to done', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.setPending('claude:s1', { id: 'p1', tool: 'Bash', detail: 'rm -rf build', deadline: 30_000, queued: 0 })
    expect(s.list()[0]!.state).toBe('waiting')

    s.apply(ev({ kind: 'stop', ts: 2000 }))
    expect(s.list()[0]!.state, 'must still say waiting until the permission resolves').toBe('waiting')
    expect(s.list()[0]!.doneAt).toBe(2000)

    s.clearPending('claude:s1')
    expect(s.list()[0]!.state).toBe('done')
  })

  it('caps the session count so a hostile peer cannot grow the map unbounded', () => {
    const s = new SessionStore()
    for (let i = 0; i < 305; i++) {
      s.apply(ev({ sessionId: `s${i}`, ts: i }))
    }
    expect(s.list().length).toBe(300)
  })
})
