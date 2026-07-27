import { describe, it, expect, vi } from 'vitest'
import { SessionStore } from '../../src/core/store.js'
import { PermissionTable, type Timers } from '../../src/core/permissions.js'
import type { AgentEvent, Decision } from '../../src/core/types.js'

function fakeTimers() {
  let now = 0
  let nextId = 1
  const scheduled = new Map<number, { at: number; fn: () => void }>()
  const timers: Timers = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = nextId++
      scheduled.set(id, { at: now + ms, fn })
      return id
    },
    clearTimeout: (id) => { scheduled.delete(id) },
  }
  const advance = (ms: number) => {
    now += ms
    for (const [id, t] of [...scheduled]) {
      if (t.at <= now) { scheduled.delete(id); t.fn() }
    }
  }
  return { timers, advance, pendingTimers: () => scheduled.size }
}

function seeded(): SessionStore {
  const s = new SessionStore()
  const e: AgentEvent = {
    agent: 'claude', kind: 'session-start', sessionId: 's1',
    cwd: '/p/app', pid: 10, ts: 0,
  }
  s.apply(e)
  return s
}

describe('PermissionTable', () => {
  it('puts the session into waiting while a request is open', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    t.request({ sessionKey: 'claude:s1', tool: 'Bash', detail: 'rm -rf build', timeoutSeconds: 30 }, () => {})
    expect(store.get('claude:s1')!.state).toBe('waiting')
    expect(t.pendingCount()).toBe(1)
  })

  it('resolves with the user decision and clears the pending state', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    const seen: Decision[] = []
    const id = t.request({ sessionKey: 'claude:s1', tool: 'Bash', timeoutSeconds: 30 }, (d) => seen.push(d))
    t.resolve(id, { kind: 'allow' })
    expect(seen).toEqual([{ kind: 'allow' }])
    expect(store.get('claude:s1')!.state).toBe('idle')
    expect(t.pendingCount()).toBe(0)
  })

  it('resolves fallthrough when the timeout elapses', () => {
    const store = seeded()
    const { timers, advance } = fakeTimers()
    const t = new PermissionTable(store, timers)
    const seen: Decision[] = []
    t.request({ sessionKey: 'claude:s1', tool: 'Bash', timeoutSeconds: 30 }, (d) => seen.push(d))
    advance(29_999)
    expect(seen).toHaveLength(0)
    advance(2)
    expect(seen).toEqual([{ kind: 'fallthrough', reason: 'Timed out' }])
    expect(t.pendingCount()).toBe(0)
  })

  it('never times out when timeoutSeconds is zero', () => {
    const store = seeded()
    const { timers, advance, pendingTimers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    const seen: Decision[] = []
    t.request({ sessionKey: 'claude:s1', tool: 'Bash', timeoutSeconds: 0 }, (d) => seen.push(d))
    expect(pendingTimers()).toBe(0)
    advance(24 * 60 * 60 * 1000)
    expect(seen).toHaveLength(0)
    expect(t.pendingCount()).toBe(1)
  })

  it('cancels the timer once a decision arrives', () => {
    const store = seeded()
    const { timers, advance, pendingTimers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    const seen: Decision[] = []
    const id = t.request({ sessionKey: 'claude:s1', tool: 'Bash', timeoutSeconds: 30 }, (d) => seen.push(d))
    t.resolve(id, { kind: 'deny', reason: 'no' })
    expect(pendingTimers()).toBe(0)
    advance(60_000)
    expect(seen).toHaveLength(1)
  })

  it('ignores a second resolve for the same id', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    const seen: Decision[] = []
    const id = t.request({ sessionKey: 'claude:s1', tool: 'Bash', timeoutSeconds: 30 }, (d) => seen.push(d))
    t.resolve(id, { kind: 'allow' })
    t.resolve(id, { kind: 'deny' })
    expect(seen).toHaveLength(1)
  })

  it('resolveAllFallthrough drains everything, for disable()', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    const seen: Decision[] = []
    t.request({ sessionKey: 'claude:s1', tool: 'Bash', timeoutSeconds: 30 }, (d) => seen.push(d))
    t.request({ sessionKey: 'claude:s1', tool: 'Edit', timeoutSeconds: 30 }, (d) => seen.push(d))
    t.resolveAllFallthrough()
    expect(seen).toHaveLength(2)
    expect(seen.every((d) => d.kind === 'fallthrough')).toBe(true)
    expect(t.pendingCount()).toBe(0)
  })

  it('grantAlways is per session and per tool, and is not global', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    expect(t.isAlwaysAllowed('claude:s1', 'Bash')).toBe(false)
    t.grantAlways('claude:s1', 'Bash')
    expect(t.isAlwaysAllowed('claude:s1', 'Bash')).toBe(true)
    expect(t.isAlwaysAllowed('claude:s1', 'Edit')).toBe(false)
    expect(t.isAlwaysAllowed('claude:other', 'Bash')).toBe(false)
  })

  it('resolves immediately without a pending row when the tool is always allowed', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    t.grantAlways('claude:s1', 'Bash')
    const seen: Decision[] = []
    t.request({ sessionKey: 'claude:s1', tool: 'Bash', timeoutSeconds: 30 }, (d) => seen.push(d))
    expect(seen).toEqual([{ kind: 'allow', reason: 'Always allowed for this session' }])
    expect(t.pendingCount()).toBe(0)
    expect(store.get('claude:s1')!.state).not.toBe('waiting')
  })

  it('resolves fallthrough immediately for an unknown session', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    const seen: Decision[] = []
    t.request({ sessionKey: 'claude:ghost', tool: 'Bash', timeoutSeconds: 30 }, (d) => seen.push(d))
    expect(seen).toEqual([{ kind: 'fallthrough', reason: 'Unknown session' }])
  })
})
