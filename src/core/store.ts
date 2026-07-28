import { basename, sessionKey } from './types.js'
import type { AgentEvent, PendingPermission, Session, SessionState } from './types.js'

const STALE_MS = 15 * 60 * 1000
/**
 * A misbehaving or hostile peer on the session bus could otherwise grow this
 * map unbounded for up to 15 minutes (the reaper's abandon window). Bounded to
 * a few hundred, well above any real concurrent-session count.
 */
const MAX_SESSIONS = 300

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
        // The agent process's own start time when the shell layer could read it,
        // so a record recreated after a reap or a shell reload reports the same
        // number rather than restarting the clock at the current task.
        startedAt: e.agentStartedAt ?? e.ts,
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
        s.doneAt = undefined
        s.currentTool = undefined
        s.detail = undefined
        break
      case 'prompt-submit':
        kindState = 'running'
        s.currentTool = undefined
        s.detail = undefined
        s.doneAt = undefined
        break
      case 'tool-start':
        kindState = 'running'
        s.currentTool = e.tool
        s.detail = e.detail
        s.doneAt = undefined
        break
      case 'tool-end':
        // Not idle: the agent keeps thinking and streaming between tool calls,
        // and Claude fires PostToolUse after every one of them. Downgrading here
        // made the pill strobe working/idle once per tool. The absence of
        // currentTool is what the row reads as "thinking".
        kindState = 'running'
        s.currentTool = undefined
        s.detail = undefined
        break
      case 'turn-end':
        // The agent finished talking, not the session. Claude fires Stop at the
        // end of every assistant turn while the terminal stays open, so this is
        // 'waiting on a human', not 'finished' — and it must stamp no doneAt,
        // or the linger sweep would delete a live session.
        kindState = 'idle'
        s.currentTool = undefined
        s.detail = undefined
        break
      case 'session-end':
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
    if (s.pendingPermission) {
      // Remember what this event meant so clearPending can settle to it, rather
      // than reconstructing a state from flags — which loses 'error' entirely
      // and mistakes a stale doneAt for a freshly finished session.
      s.deferredState = kindState
      s.state = 'waiting'
    } else {
      s.deferredState = undefined
      s.state = kindState
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
    // Settle to whatever the last event actually meant while the permission was
    // held — a turn-end settles to 'idle', a session-end to 'done', an error to
    // 'error'. With no event during the hold, the agent simply proceeds with
    // (or without) the tool it asked about, so 'running' is the right settle.
    if (s.state === 'waiting') s.state = s.deferredState ?? 'running'
    s.deferredState = undefined
    this.emit()
  }

  /**
   * Drop finished, dead and abandoned sessions. Returns the keys it dropped, so
   * the caller can release anything (e.g. a held D-Bus permission reply) tied to
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
        // timer will ever fire. Guarded on pid > 0 for the same reason as the
        // liveness check below: resolveAgentPid returns 0 when it cannot read
        // /proc, and pidAlive(0) is false, which would otherwise drop a live
        // session with an unresolved pid on the first sweep.
        const zombie = s.pid > 0 && s.pendingPermission.deadline === 0 && !pidAlive(s.pid)
        if (zombie) {
          this.sessions.delete(key)
          dropped.push(key)
        } else if (
          // Escape hatch for a permission wedged by both unresolved pid and deadline=0:
          // the pid > 0 guard above means such a session can never be collected as a
          // zombie, and no timer will ever fire, so it would sit forever. A session
          // with no events for 15 minutes and a dead or unresolved pid is genuinely
          // stuck, not merely waiting on a slow human — that signal is safer than
          // liveness alone. Guarded on deadline=0 (no timer to eventually resolve it)
          // and !pidAlive so a live agent with deadline=0 can wait indefinitely for
          // the user to respond to the permission.
          s.pendingPermission.deadline === 0 &&
          now - s.lastEventAt > STALE_MS &&
          !pidAlive(s.pid)
        ) {
          this.sessions.delete(key)
          dropped.push(key)
        }
        continue
      }
      // Linger is checked before liveness, and the order is load-bearing: a
      // session ends because its agent exited, so the session-end event and the
      // process's death land inside the same sweep. Testing liveness first would
      // delete the row before its linger elapsed and 'done' would never be seen.
      if (s.state === 'done' && s.doneAt !== undefined) {
        if (now - s.doneAt > this.doneLingerSeconds * 1000) {
          this.sessions.delete(key)
          dropped.push(key)
        }
        continue
      }
      // An errored session deserves the same grace as a finished one: its agent
      // may already be gone by the time the error lands, and the liveness rule
      // below would otherwise reap it on the very next sweep — possibly the
      // instant the error appears. Reuses lastEventAt rather than adding a
      // field or a setting; falls through to liveness once the window elapses.
      if (s.state === 'error' && now - s.lastEventAt <= this.doneLingerSeconds * 1000) {
        continue
      }
      // `pid` is the agent process, not the hook — the D-Bus handlers resolve it
      // through resolveAgentPid while the hook is still blocked in its call — so
      // this is a real liveness test. It is the only thing that clears the pill
      // for an agent with no session-end event, or a Claude install predating the
      // SessionEnd hook. Guarded on pid > 0 because resolveAgentPid returns 0
      // when it cannot read /proc and pidAlive(0) is false, which would otherwise
      // reap a perfectly live session on the very first sweep. Those fall back to
      // the stale window below.
      const agentGone = s.pid > 0 && !pidAlive(s.pid)
      const abandoned = now - s.lastEventAt > STALE_MS && !pidAlive(s.pid)
      if (agentGone || abandoned) {
        this.sessions.delete(key)
        dropped.push(key)
      }
    }
    if (dropped.length > 0) this.emit()
    return dropped
  }
}
