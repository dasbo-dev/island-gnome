import { describe, it, expect } from 'vitest'
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
    // Re-check live membership: a callback in this batch may cancel or replace a
    // timer that was also due, and a cancelled timer must not fire.
    for (const [id, t] of [...scheduled]) {
      if (!scheduled.has(id)) continue
      if (t.at <= now) {
        scheduled.delete(id)
        t.fn()
      }
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

  it('queues a second request for the same session instead of overwriting it', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    const seen: Decision[] = []
    const first = t.request({ sessionKey: 'claude:s1', tool: 'Bash', timeoutSeconds: 30 }, (d) => seen.push(d))
    t.request({ sessionKey: 'claude:s1', tool: 'Edit', timeoutSeconds: 30 }, (d) => seen.push(d))

    const pending = store.get('claude:s1')!.pendingPermission!
    expect(pending.id).toBe(first)
    expect(pending.tool, 'the first request stays active').toBe('Bash')
    expect(pending.queued).toBe(1)
    expect(t.pendingCount()).toBe(2)
    expect(seen, 'neither has resolved yet').toHaveLength(0)
  })

  it('promotes the queued request when the active one resolves', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    const seen: Decision[] = []
    const first = t.request({ sessionKey: 'claude:s1', tool: 'Bash', timeoutSeconds: 30 }, (d) => seen.push(d))
    t.request({ sessionKey: 'claude:s1', tool: 'Edit', timeoutSeconds: 30 }, (d) => seen.push(d))

    t.resolve(first, { kind: 'allow' })

    const pending = store.get('claude:s1')!.pendingPermission!
    expect(pending.tool).toBe('Edit')
    expect(pending.queued).toBe(0)
    expect(store.get('claude:s1')!.state).toBe('waiting')
    expect(seen).toEqual([{ kind: 'allow' }])
  })

  it('promotion swaps the pending id without ever passing through undefined', () => {
    // Pins the invariant the island.ts control-cluster fix relies on: activate()
    // promotes the queue by calling store.setPending() with a new id/tool, so
    // pendingPermission never clears to undefined between the two requests. A
    // consumer that keys off "pending truthy" rather than "pending.id changed"
    // would keep a stale reference to the resolved id.
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    const first = t.request({ sessionKey: 'claude:s1', tool: 'Bash', timeoutSeconds: 30 }, () => {})
    t.request({ sessionKey: 'claude:s1', tool: 'Edit', timeoutSeconds: 30 }, () => {})

    t.resolve(first, { kind: 'allow' })

    const pending = store.get('claude:s1')!.pendingPermission!
    expect(pending.id).not.toBe(first)
    expect(pending.id).toBeDefined()
    expect(store.get('claude:s1')!.state).toBe('waiting')
  })

  it('does not start a queued request clock until it becomes active', () => {
    const store = seeded()
    const { timers, advance, pendingTimers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    const seen: Decision[] = []
    const first = t.request({ sessionKey: 'claude:s1', tool: 'Bash', timeoutSeconds: 30 }, (d) => seen.push(d))
    t.request({ sessionKey: 'claude:s1', tool: 'Edit', timeoutSeconds: 30 }, (d) => seen.push(d))

    expect(pendingTimers(), 'only the active request has a timer').toBe(1)

    advance(29_000)
    t.resolve(first, { kind: 'allow' })

    // The queued request has now been waiting 29s, but its own 30s clock starts here.
    advance(29_000)
    expect(seen, 'the promoted request must not have timed out yet').toHaveLength(1)
    advance(2_000)
    expect(seen[1]).toEqual({ kind: 'fallthrough', reason: 'Timed out' })
  })

  it('resolving a queued request directly leaves the active one alone', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    const seen: Decision[] = []
    const first = t.request({ sessionKey: 'claude:s1', tool: 'Bash', timeoutSeconds: 30 }, (d) => seen.push(d))
    const second = t.request({ sessionKey: 'claude:s1', tool: 'Edit', timeoutSeconds: 30 }, (d) => seen.push(d))

    t.resolve(second, { kind: 'deny' })

    const pending = store.get('claude:s1')!.pendingPermission!
    expect(pending.id).toBe(first)
    expect(pending.tool).toBe('Bash')
    expect(pending.queued).toBe(0)
    expect(t.pendingCount()).toBe(1)
  })

  it('does not queue requests from different sessions behind each other', () => {
    const store = seeded()
    store.apply({ agent: 'claude', kind: 'session-start', sessionId: 's2', cwd: '/p/other', pid: 11, ts: 0 })
    const { timers, pendingTimers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    t.request({ sessionKey: 'claude:s1', tool: 'Bash', timeoutSeconds: 30 }, () => {})
    t.request({ sessionKey: 'claude:s2', tool: 'Bash', timeoutSeconds: 30 }, () => {})

    expect(store.get('claude:s1')!.pendingPermission!.queued).toBe(0)
    expect(store.get('claude:s2')!.pendingPermission!.queued).toBe(0)
    expect(pendingTimers(), 'both are active, so both have clocks').toBe(2)
  })

  it('drains active and queued entries exactly once on shutdown', () => {
    const store = seeded()
    const { timers, pendingTimers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    const seen: Decision[] = []
    t.request({ sessionKey: 'claude:s1', tool: 'Bash', timeoutSeconds: 30 }, (d) => seen.push(d))
    t.request({ sessionKey: 'claude:s1', tool: 'Edit', timeoutSeconds: 30 }, (d) => seen.push(d))
    t.request({ sessionKey: 'claude:s1', tool: 'Read', timeoutSeconds: 30 }, (d) => seen.push(d))

    t.resolveAllFallthrough()

    expect(seen).toHaveLength(3)
    expect(seen.every((d) => d.kind === 'fallthrough')).toBe(true)
    expect(t.pendingCount()).toBe(0)
    expect(pendingTimers(), 'draining must not leave or start a timer').toBe(0)
    expect(store.get('claude:s1')!.state).toBe('idle')
  })
})
