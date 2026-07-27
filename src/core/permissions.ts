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
