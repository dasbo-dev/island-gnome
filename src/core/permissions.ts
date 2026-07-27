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
  resolve: (d: Decision) => void
  timerId?: number
}

export interface PermissionRequest {
  sessionKey: string
  tool: string
  detail?: string
  timeoutSeconds: number
}

export class PermissionTable {
  private pending = new Map<string, PendingEntry>()
  private always = new Map<string, Set<string>>()
  private counter = 0

  constructor(private store: SessionStore, private timers: Timers) {}

  pendingCount(): number {
    return this.pending.size
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

    const entry: PendingEntry = { id, sessionKey: req.sessionKey, resolve }
    this.pending.set(id, entry)

    const deadline =
      req.timeoutSeconds > 0 ? this.timers.now() + req.timeoutSeconds * 1000 : 0

    this.store.setPending(req.sessionKey, {
      id,
      tool: req.tool,
      detail: req.detail,
      deadline,
    })

    if (req.timeoutSeconds > 0) {
      entry.timerId = this.timers.setTimeout(
        () => this.finish(id, { kind: 'fallthrough', reason: 'Timed out' }),
        req.timeoutSeconds * 1000
      )
    }

    return id
  }

  resolve(id: string, d: Decision): void {
    this.finish(id, d)
  }

  resolveAllFallthrough(): void {
    for (const id of [...this.pending.keys()]) {
      this.finish(id, { kind: 'fallthrough', reason: 'Dasbo Island shutting down' })
    }
  }

  private finish(id: string, d: Decision): void {
    const entry = this.pending.get(id)
    if (!entry) return
    this.pending.delete(id)
    if (entry.timerId !== undefined) this.timers.clearTimeout(entry.timerId)
    this.store.clearPending(entry.sessionKey)
    entry.resolve(d)
  }
}
