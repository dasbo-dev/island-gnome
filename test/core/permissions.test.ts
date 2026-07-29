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
    // A permission request always follows a tool-start in production
    // (service.ts applies tool-start, then calls permissions.request) — a
    // bare session-start into request() is not a reachable sequence.
    store.apply({
      agent: 'claude', kind: 'tool-start', sessionId: 's1',
      cwd: '/p/app', pid: 10, ts: 1, tool: 'Bash',
    })
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    const seen: Decision[] = []
    const id = t.request({ sessionKey: 'claude:s1', tool: 'Bash', timeoutSeconds: 30 }, (d) => seen.push(d))
    t.resolve(id, { kind: 'allow' })
    expect(seen).toEqual([{ kind: 'allow' }])
    expect(
      store.get('claude:s1')!.state,
      'nothing was deferred during the hold, so the agent proceeds with the tool it asked about'
    ).toBe('running')
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

    // Record what a subscriber actually observes. Asserting only the final state
    // would pass even if pendingPermission briefly cleared and was re-set within
    // the same synchronous call — which a subscriber's refresh() would still see.
    const observed: Array<string | undefined> = []
    const off = store.subscribe(() => {
      observed.push(store.get('claude:s1')?.pendingPermission?.id)
    })

    t.resolve(first, { kind: 'allow' })
    off()

    expect(observed.length, 'promotion must notify subscribers').toBeGreaterThan(0)
    expect(observed, 'no subscriber may observe a cleared permission').not.toContain(undefined)
    expect(observed, 'no subscriber may observe the resolved id still active').not.toContain(first)

    const pending = store.get('claude:s1')!.pendingPermission!
    expect(pending.id).not.toBe(first)
    expect(pending.tool).toBe('Edit')
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

  it('a resolve callback that throws does not prevent removal or block the queue', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    const seen: Decision[] = []
    const first = t.request({ sessionKey: 'claude:s1', tool: 'Bash', timeoutSeconds: 30 }, () => {
      throw new Error('dead peer')
    })
    const second = t.request({ sessionKey: 'claude:s1', tool: 'Edit', timeoutSeconds: 30 }, (d) => seen.push(d))

    // Must not throw out of resolve() itself.
    expect(() => t.resolve(first, { kind: 'allow' })).not.toThrow()

    // The throwing entry is gone and the queue advanced to the next one.
    expect(t.pendingCount()).toBe(1)
    expect(store.get('claude:s1')!.pendingPermission!.id).toBe(second)
    expect(store.get('claude:s1')!.pendingPermission!.tool).toBe('Edit')

    t.resolve(second, { kind: 'deny' })
    expect(seen).toEqual([{ kind: 'deny' }])
    expect(t.pendingCount()).toBe(0)
  })

  it('resolveAllFallthrough continues past a throwing callback and drains everything', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    const seen: Decision[] = []
    t.request({ sessionKey: 'claude:s1', tool: 'Bash', timeoutSeconds: 30 }, () => {
      throw new Error('dead peer')
    })
    t.request({ sessionKey: 'claude:s1', tool: 'Edit', timeoutSeconds: 30 }, (d) => seen.push(d))

    expect(() => t.resolveAllFallthrough()).not.toThrow()
    expect(seen).toEqual([{ kind: 'fallthrough', reason: 'Dasbo Island shutting down' }])
    expect(t.pendingCount()).toBe(0)
  })

  it('releaseSession resolves the active and every queued entry for one session with fall-through', () => {
    const store = seeded()
    const { timers, pendingTimers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    const seen: Decision[] = []
    t.request({ sessionKey: 'claude:s1', tool: 'Bash', timeoutSeconds: 30 }, (d) => seen.push(d))
    t.request({ sessionKey: 'claude:s1', tool: 'Edit', timeoutSeconds: 30 }, (d) => seen.push(d))

    t.releaseSession('claude:s1')

    expect(seen).toHaveLength(2)
    expect(seen.every((d) => d.kind === 'fallthrough')).toBe(true)
    expect(t.pendingCount()).toBe(0)
    expect(pendingTimers()).toBe(0)
  })

  it('releaseSession does not disturb an unrelated session', () => {
    const store = seeded()
    store.apply({ agent: 'claude', kind: 'session-start', sessionId: 's2', cwd: '/p/other', pid: 11, ts: 0 })
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    const seen1: Decision[] = []
    const seen2: Decision[] = []
    t.request({ sessionKey: 'claude:s1', tool: 'Bash', timeoutSeconds: 30 }, (d) => seen1.push(d))
    t.request({ sessionKey: 'claude:s2', tool: 'Bash', timeoutSeconds: 30 }, (d) => seen2.push(d))

    t.releaseSession('claude:s1')

    expect(seen1).toEqual([{ kind: 'fallthrough', reason: 'Session reaped' }])
    expect(seen2).toHaveLength(0)
    expect(t.pendingCount()).toBe(1)
  })

  it('releaseSession on a session with nothing pending is a no-op', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    expect(() => t.releaseSession('claude:s1')).not.toThrow()
    expect(t.pendingCount()).toBe(0)
  })

  it('drains active and queued entries exactly once on shutdown', () => {
    const store = seeded()
    // See the comment in the previous test: a permission request always
    // follows a tool-start, never a bare session-start.
    store.apply({
      agent: 'claude', kind: 'tool-start', sessionId: 's1',
      cwd: '/p/app', pid: 10, ts: 1, tool: 'Bash',
    })
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
    expect(
      store.get('claude:s1')!.state,
      'nothing was deferred during the hold, so the agent proceeds with the tool it asked about'
    ).toBe('running')
  })
})

const qs = [
  {
    question: 'Which library?',
    header: 'Library',
    options: [
      { label: 'date-fns', description: '' },
      { label: 'Luxon', description: '' },
    ],
    multiSelect: false,
  },
]

describe('PermissionTable question entries', () => {
  it('publishes a pending question rather than a pending permission', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    t.request({ sessionKey: 'claude:s1', tool: 'AskUserQuestion', questions: qs, timeoutSeconds: 120 }, () => {})
    const s = store.get('claude:s1')!
    expect(s.state).toBe('waiting')
    expect(s.pendingQuestion?.questions).toEqual(qs)
    expect(s.pendingPermission).toBeUndefined()
  })

  it('resolves with an answer and clears the hold', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    // TS narrows `let got: Decision | null = null; (d) => { got = d }` to
    // `never` on later member access under this project's TS 5.9 — a compiler
    // quirk in closure-narrowing, not a real type conflict. The push-into-array
    // form the rest of this file already uses sidesteps it.
    const got: Decision[] = []
    const id = t.request(
      { sessionKey: 'claude:s1', tool: 'AskUserQuestion', questions: qs, timeoutSeconds: 120 },
      (d) => { got.push(d) }
    )
    t.resolve(id, { kind: 'answer', answer: 'Library: Luxon' })
    expect(got).toEqual([{ kind: 'answer', answer: 'Library: Luxon' }])
    expect(store.get('claude:s1')!.pendingQuestion).toBeUndefined()
  })

  it('falls through when the question times out', () => {
    const store = seeded()
    const { timers, advance } = fakeTimers()
    const t = new PermissionTable(store, timers)
    const got: Decision[] = []
    t.request(
      { sessionKey: 'claude:s1', tool: 'AskUserQuestion', questions: qs, timeoutSeconds: 120 },
      (d) => { got.push(d) }
    )
    advance(120_000)
    expect(got[0]?.kind).toBe('fallthrough')
    expect(store.get('claude:s1')!.pendingQuestion).toBeUndefined()
  })

  it('is never short-circuited by an always-allow grant', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    t.grantAlways('claude:s1', 'AskUserQuestion')
    const got: Decision[] = []
    t.request(
      { sessionKey: 'claude:s1', tool: 'AskUserQuestion', questions: qs, timeoutSeconds: 120 },
      (d) => { got.push(d) }
    )
    expect(got).toHaveLength(0)
    expect(store.get('claude:s1')!.pendingQuestion).toBeDefined()
  })

  it('promotes a question queued behind a permission, swapping what the row shows', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    const first = t.request({ sessionKey: 'claude:s1', tool: 'Bash', timeoutSeconds: 30 }, () => {})
    t.request({ sessionKey: 'claude:s1', tool: 'AskUserQuestion', questions: qs, timeoutSeconds: 120 }, () => {})
    expect(store.get('claude:s1')!.pendingPermission?.tool).toBe('Bash')
    t.resolve(first, { kind: 'allow' })
    const s = store.get('claude:s1')!
    expect(s.pendingQuestion?.questions).toEqual(qs)
    expect(s.pendingPermission).toBeUndefined()
  })

  it('drains a held question on shutdown', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    const got: Decision[] = []
    t.request(
      { sessionKey: 'claude:s1', tool: 'AskUserQuestion', questions: qs, timeoutSeconds: 0 },
      (d) => { got.push(d) }
    )
    t.resolveAllFallthrough()
    expect(got[0]?.kind).toBe('fallthrough')
  })

  it('releases a held question when its session is reaped', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    const got: Decision[] = []
    t.request(
      { sessionKey: 'claude:s1', tool: 'AskUserQuestion', questions: qs, timeoutSeconds: 0 },
      (d) => { got.push(d) }
    )
    t.releaseSession('claude:s1')
    expect(got[0]?.kind).toBe('fallthrough')
  })
})
