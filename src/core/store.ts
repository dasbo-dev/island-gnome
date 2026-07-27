import { basename, sessionKey } from './types.js'
import type { AgentEvent, PendingPermission, Session, SessionState } from './types.js'

const STALE_MS = 15 * 60 * 1000
/**
 * A misbehaving or hostile peer on the session bus could otherwise grow this
 * map unbounded for up to 15 minutes (the reaper's abandon window). Bounded to
 * a few hundred, well above any real concurrent-session count.
 */
const MAX_SESSIONS = 300

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

  private ensure(e: AgentEvent): Session | null {
    const key = sessionKey(e.agent, e.sessionId)
    let s = this.sessions.get(key)
    if (!s) {
      if (this.sessions.size >= MAX_SESSIONS) return null
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
    if (!s) return
    s.lastEventAt = e.ts
    if (e.pid) s.pid = e.pid
    if (e.transcriptPath) s.transcriptPath = e.transcriptPath

    let kindState: SessionState
    switch (e.kind) {
      case 'session-start':
        kindState = 'idle'
        break
      case 'prompt-submit':
        kindState = 'running'
        s.currentTool = undefined
        s.detail = undefined
        break
      case 'tool-start':
        kindState = 'running'
        s.currentTool = e.tool
        s.detail = e.detail
        break
      case 'tool-end':
        kindState = 'idle'
        s.currentTool = undefined
        s.detail = undefined
        break
      case 'stop':
        kindState = 'done'
        s.doneAt = e.ts
        s.currentTool = undefined
        s.detail = undefined
        break
      case 'error':
        kindState = 'error'
        s.detail = e.detail
        break
    }
    // Never leave 'waiting' while a permission is pending: PermissionTable owns
    // that state through setPending/clearPending, and a parallel tool batch
    // (which Claude Code issues routinely) can deliver a tool-end or stop for
    // one tool while another tool's permission on the same session is still
    // held open. Losing 'waiting' here would make the pill lie about a session
    // that is actually blocked on the user.
    s.state = s.pendingPermission ? 'waiting' : kindState
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
    // A 'stop' received while the permission was pending stamps doneAt but
    // (per apply()) keeps state 'waiting' until the permission clears. Once it
    // does, settle to the state that stop actually meant, not to 'idle'.
    if (s.state === 'waiting') s.state = s.doneAt !== undefined ? 'done' : 'idle'
    this.emit()
  }

  /**
   * Drop finished and abandoned sessions. Returns the keys it dropped, so the
   * caller can release anything (e.g. a held D-Bus permission reply) tied to
   * them — this store must not depend on PermissionTable to do that itself.
   * `pidAlive` is injected so this stays free of any filesystem dependency.
   */
  reap(now: number, pidAlive: (pid: number) => boolean): string[] {
    const dropped: string[] = []
    for (const [key, s] of [...this.sessions]) {
      if (s.pendingPermission) {
        // Normally a pending permission is untouchable — its own timer (if any)
        // will resolve it. But with permission-timeout = 0 no timer ever starts,
        // so a killed agent mid-permission would otherwise wedge this session
        // forever. Only collect it once the process is confirmed gone AND no
        // timer will ever fire.
        const zombie = s.pendingPermission.deadline === 0 && !pidAlive(s.pid)
        if (zombie) {
          this.sessions.delete(key)
          dropped.push(key)
        }
        continue
      }
      const lingerExpired =
        s.state === 'done' && s.doneAt !== undefined &&
        now - s.doneAt > this.doneLingerSeconds * 1000
      const abandoned = now - s.lastEventAt > STALE_MS && !pidAlive(s.pid)
      if (lingerExpired || abandoned) {
        this.sessions.delete(key)
        dropped.push(key)
      }
    }
    if (dropped.length > 0) this.emit()
    return dropped
  }
}
