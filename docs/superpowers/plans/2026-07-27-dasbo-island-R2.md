# dasbo-island Plan Revision R2

**Date:** 2026-07-27
**Supersedes:** parts of `2026-07-27-dasbo-island.md` — Task 6, and the permission-row rendering in Tasks 10 and 11.
**Status:** authoritative. Where this document and the base plan disagree, **this document wins.** R1 remains authoritative for Tasks 4, 5, 7, 8 and 13.

## Why

Task 6's review found a design flaw in the base plan, not in the implementation. `Session` carries a single `pendingPermission` slot, but coding agents issue **parallel tool calls**, so two permission requests can be outstanding for one session at the same time. With one slot:

- the second `setPending` silently overwrites the first,
- whichever request resolves first calls `clearPending`, flipping the session back to `idle` while the other is still genuinely waiting.

`PermissionTable`'s own bookkeeping stayed correct — no agent ever hung — but the state shown in the popup lied, which is precisely the failure this extension exists to prevent.

**Decision: serialize, and show the queue depth.** One request per session is active at a time; the rest queue behind it in arrival order. The active row displays how many are waiting behind it.

The known cost of serializing is that a queued agent call sits blocked with no visible reason. Two things mitigate it: the waiting count is displayed on the active row, so the user can see work is stacked up; and **a queued request's timeout does not start until it becomes active**, so it cannot fall through before the user has ever had a chance to see it.

---

## Type change

`PendingPermission` in `src/core/types.ts` gains one field:

```ts
export interface PendingPermission {
  id: string
  tool: string
  detail?: string
  /** Milliseconds since epoch when this request must fall through. 0 means never. */
  deadline: number
  /** How many further requests for this session are waiting behind this one. */
  queued: number
}
```

`deadline` is now set at **activation** time, not request time.

---

## Task 6 (revised): `src/core/permissions.ts`

`Timers` is unchanged. `PermissionTable`'s public surface is unchanged except that behaviour under concurrency is now defined.

```ts
import type { SessionStore } from './store.js'
import type { Decision } from './types.js'

/** Injected so tests advance time rather than sleeping, and so the shell layer can use GLib. */
export interface Timers {
  now(): number
  setTimeout(fn: () => void, ms: number): number
  clearTimeout(id: number): void
}

interface PendingEntry {
  id: string
  sessionKey: string
  tool: string
  detail?: string
  timeoutSeconds: number
  resolve: (d: Decision) => void
  /** Set only while this entry is the active one for its session. */
  timerId?: number
}

export interface PermissionRequest {
  sessionKey: string
  tool: string
  detail?: string
  timeoutSeconds: number
}

export class PermissionTable {
  /** Every unresolved entry, active or queued, by id. */
  private pending = new Map<string, PendingEntry>()
  /** Per session, ids in arrival order. Index 0 is the active one. */
  private queues = new Map<string, string[]>()
  private always = new Map<string, Set<string>>()
  private counter = 0
  /** Suppresses activation while draining, so shutdown does not start new timers. */
  private draining = false

  constructor(private store: SessionStore, private timers: Timers) {}

  pendingCount(): number {
    return this.pending.size
  }

  /** How many requests are waiting behind the active one for this session. */
  queuedCount(sessionKey: string): number {
    const q = this.queues.get(sessionKey)
    return q ? Math.max(0, q.length - 1) : 0
  }

  isAlwaysAllowed(sessionKey: string, tool: string): boolean {
    return this.always.get(sessionKey)?.has(tool) ?? false
  }

  grantAlways(sessionKey: string, tool: string): void {
    let set = this.always.get(sessionKey)
    if (!set) {
      set = new Set<string>()
      this.always.set(sessionKey, set)
    }
    set.add(tool)
  }

  request(req: PermissionRequest, resolve: (d: Decision) => void): string {
    const id = `perm-${++this.counter}`

    if (!this.store.get(req.sessionKey)) {
      resolve({ kind: 'fallthrough', reason: 'Unknown session' })
      return id
    }

    if (this.isAlwaysAllowed(req.sessionKey, req.tool)) {
      resolve({ kind: 'allow', reason: 'Always allowed for this session' })
      return id
    }

    this.pending.set(id, {
      id,
      sessionKey: req.sessionKey,
      tool: req.tool,
      detail: req.detail,
      timeoutSeconds: req.timeoutSeconds,
      resolve,
    })

    const queue = this.queues.get(req.sessionKey) ?? []
    queue.push(id)
    this.queues.set(req.sessionKey, queue)

    // First in line becomes active immediately; anything else only updates the
    // depth shown on the active row.
    if (queue[0] === id) this.activate(req.sessionKey)
    else this.publishDepth(req.sessionKey)

    return id
  }

  resolve(id: string, d: Decision): void {
    this.finish(id, d)
  }

  resolveAllFallthrough(): void {
    this.draining = true
    try {
      for (const id of [...this.pending.keys()]) {
        this.finish(id, { kind: 'fallthrough', reason: 'Dasbo Island shutting down' })
      }
    } finally {
      this.draining = false
    }
  }

  /** Make the head of this session's queue the active request and start its clock. */
  private activate(sessionKey: string): void {
    if (this.draining) return
    const queue = this.queues.get(sessionKey)
    const headId = queue?.[0]
    if (!headId) return
    const entry = this.pending.get(headId)
    if (!entry) return
    if (entry.timerId !== undefined) return // already active

    const deadline =
      entry.timeoutSeconds > 0 ? this.timers.now() + entry.timeoutSeconds * 1000 : 0

    this.store.setPending(sessionKey, {
      id: entry.id,
      tool: entry.tool,
      detail: entry.detail,
      deadline,
      queued: this.queuedCount(sessionKey),
    })

    // The clock starts here, not at request() time, so a queued request cannot
    // time out before the user has had any chance to see it.
    if (entry.timeoutSeconds > 0) {
      entry.timerId = this.timers.setTimeout(
        () => this.finish(entry.id, { kind: 'fallthrough', reason: 'Timed out' }),
        entry.timeoutSeconds * 1000
      )
    }
  }

  /** Refresh the queued count on the active row without disturbing its clock. */
  private publishDepth(sessionKey: string): void {
    const queue = this.queues.get(sessionKey)
    const headId = queue?.[0]
    if (!headId) return
    const entry = this.pending.get(headId)
    if (!entry) return
    const existing = this.store.get(sessionKey)?.pendingPermission
    this.store.setPending(sessionKey, {
      id: entry.id,
      tool: entry.tool,
      detail: entry.detail,
      deadline: existing?.deadline ?? 0,
      queued: this.queuedCount(sessionKey),
    })
  }

  private finish(id: string, d: Decision): void {
    const entry = this.pending.get(id)
    if (!entry) return

    this.pending.delete(id)
    if (entry.timerId !== undefined) this.timers.clearTimeout(entry.timerId)

    const queue = this.queues.get(entry.sessionKey)
    const wasActive = queue?.[0] === id
    if (queue) {
      const at = queue.indexOf(id)
      if (at !== -1) queue.splice(at, 1)
      if (queue.length === 0) this.queues.delete(entry.sessionKey)
    }

    entry.resolve(d)

    const remaining = this.queues.get(entry.sessionKey)
    if (!remaining || remaining.length === 0) {
      this.store.clearPending(entry.sessionKey)
    } else if (wasActive) {
      this.activate(entry.sessionKey)
    } else {
      this.publishDepth(entry.sessionKey)
    }
  }
}
```

### Behaviour this defines

| Situation | Result |
|---|---|
| Two requests, same session | First active, second queued. Store shows the first with `queued: 1`. |
| Active resolves | Second becomes active, its clock starts then, `queued` drops to 0. |
| Queued entry resolved directly | Active one is untouched; `queued` drops. |
| Requests in different sessions | Independent. Neither queues behind the other. |
| `resolveAllFallthrough` | Every entry, active and queued, resolves exactly once as fall-through. No new timers start. |
| `timeoutSeconds: 0` | No timer at all, at activation or otherwise. |

### Tests to add to `test/core/permissions.test.ts`

Keep every existing test. Add:

```ts
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
```

Existing tests that assert `store.setPending` shape must be updated to expect the new `queued` field.

---

## `fakeTimers` helper fix

The helper in `test/core/permissions.test.ts` snapshots the scheduled map once per `advance()`, then fires every captured entry whose `at` has passed — without rechecking whether that entry is still scheduled. If one callback cancels another timer that is due in the same batch, the cancelled callback still runs.

This now matters directly: `finish()` cancels timers, and promotion can schedule one, both inside a single `advance()`.

```ts
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
```

Also drop the unused `vi` import from that file's `import { describe, it, expect, vi } from 'vitest'`.

---

## Task 10 and 11: rendering the queue depth

`src/shell/sessionRow.ts` — when a session has a pending permission with `queued > 0`, the activity line appends the count:

```
my-api
⏸ waiting for you · Bash · rm -rf build          (+2 waiting)
```

In `update()`, replace the `session.state === 'waiting'` branch with:

```ts
      const pending = session.pendingPermission
      this._activity.text =
        pending
          ? `waiting for you${pending.queued > 0 ? ` · +${pending.queued} more` : ''}`
        : tool && detail ? `${tool} · ${detail}`
        : tool ? tool
        : session.state
```

`src/shell/permissionRow.ts` is unchanged — only one control cluster is ever shown per session, because only one request is ever active.

The pill in `src/shell/island.ts` is unchanged: a session with queued requests is still one `waiting` session, and `worstState()` already reports `waiting`.

---

## Still open

Unchanged from R1: Codex remains unverified pending a successful hook capture.
