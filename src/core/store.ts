import { basename, sessionKey } from './types.js'
import type { AgentEvent, PendingPermission, Session, SessionState } from './types.js'

const STALE_MS = 15 * 60 * 1000

const RANK: Record<SessionState, number> = {
  done: 0,
  idle: 1,
  running: 2,
  waiting: 3,
  error: 4,
}

export class SessionStore {
  private sessions = new Map<string, Session>()
  private subscribers = new Set<() => void>()
  /** Seconds a done session lingers before reaping. Set from GSettings by the shell layer. */
  doneLingerSeconds = 10

  subscribe(fn: () => void): () => void {
    this.subscribers.add(fn)
    return () => { this.subscribers.delete(fn) }
  }

  private emit(): void {
    for (const fn of this.subscribers) fn()
  }

  list(): Session[] {
    return [...this.sessions.values()].sort((a, b) => a.startedAt - b.startedAt)
  }

  get(key: string): Session | undefined {
    return this.sessions.get(key)
  }

  worstState(): SessionState {
    let worst: SessionState = 'idle'
    for (const s of this.sessions.values()) {
      if (RANK[s.state] > RANK[worst]) worst = s.state
    }
    return worst
  }

  private ensure(e: AgentEvent): Session {
    const key = sessionKey(e.agent, e.sessionId)
    let s = this.sessions.get(key)
    if (!s) {
      s = {
        key,
        agent: e.agent,
        sessionId: e.sessionId,
        project: basename(e.cwd) || e.cwd,
        cwd: e.cwd,
        state: 'idle',
        pid: e.pid,
        startedAt: e.ts,
        lastEventAt: e.ts,
      }
      this.sessions.set(key, s)
    }
    return s
  }

  apply(e: AgentEvent): void {
    const s = this.ensure(e)
    s.lastEventAt = e.ts
    if (e.pid) s.pid = e.pid
    if (e.transcriptPath) s.transcriptPath = e.transcriptPath

    switch (e.kind) {
      case 'session-start':
        s.state = 'idle'
        break
      case 'prompt-submit':
        s.state = 'running'
        s.currentTool = undefined
        s.detail = undefined
        break
      case 'tool-start':
        s.state = 'running'
        s.currentTool = e.tool
        s.detail = e.detail
        break
      case 'tool-end':
        s.state = 'idle'
        s.currentTool = undefined
        s.detail = undefined
        break
      case 'stop':
        s.state = 'done'
        s.doneAt = e.ts
        s.currentTool = undefined
        s.detail = undefined
        break
      case 'error':
        s.state = 'error'
        s.detail = e.detail
        break
    }
    this.emit()
  }

  setPending(key: string, pending: PendingPermission): void {
    const s = this.sessions.get(key)
    if (!s) return
    s.pendingPermission = pending
    s.state = 'waiting'
    this.emit()
  }

  clearPending(key: string): void {
    const s = this.sessions.get(key)
    if (!s?.pendingPermission) return
    s.pendingPermission = undefined
    if (s.state === 'waiting') s.state = 'idle'
    this.emit()
  }

  /**
   * Drop finished and abandoned sessions.
   * `pidAlive` is injected so this stays free of any filesystem dependency.
   */
  reap(now: number, pidAlive: (pid: number) => boolean): void {
    let changed = false
    for (const [key, s] of [...this.sessions]) {
      if (s.pendingPermission) continue
      const lingerExpired =
        s.state === 'done' && s.doneAt !== undefined &&
        now - s.doneAt > this.doneLingerSeconds * 1000
      const abandoned = now - s.lastEventAt > STALE_MS && !pidAlive(s.pid)
      if (lingerExpired || abandoned) {
        this.sessions.delete(key)
        changed = true
      }
    }
    if (changed) this.emit()
  }
}
