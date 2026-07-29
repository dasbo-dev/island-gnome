import { basename, sessionKey } from './types.js'
import type { AgentEvent, AgentId, PendingPermission, Session, SessionState } from './types.js'

const STALE_MS = 15 * 60 * 1000
/**
 * Bounds *both* maps this store holds: sessions and lineages. A misbehaving or
 * hostile peer on the session bus could otherwise grow either unbounded for up
 * to 15 minutes (the reaper's abandon window). A few hundred sits well above
 * any real concurrent-session count, and above any real count of live agent
 * processes, so one number serves both.
 *
 * The lineage map needs a bound of its own rather than inheriting the session
 * cap: a lineage is minted before `ensure` runs, and lineages are keyed on the
 * process while sessions are keyed on the session id, so a peer replaying one
 * session id from an ever-changing pid mints a lineage per event while creating
 * exactly one session. One shared constant rather than two, because it is one
 * policy — "a few hundred of anything a peer can mint" — and two numbers would
 * only invite them to drift apart for no reason anyone could later reconstruct.
 */
const MAX_SESSIONS = 300

/**
 * What the store remembers about one agent process across the conversations it
 * hosts. `/clear` and `/compact` end a session and start a new one without
 * restarting the process, so a new Session record is built for each — which is
 * why neither the counter nor the conversation's start time can live on one.
 */
interface Lineage {
  pid: number
  processStartedAt: number
  count: number
  conversationStartedAt: number
}

/**
 * Keyed on the pid *and* the process start time, never the pid alone: the
 * kernel recycles pids, and the start time is what makes one of them mean one
 * process. Callers pass 0 for an unknown start time so the key stays total.
 *
 * A transient /proc read failure can therefore split one process into two
 * lineages: an event whose pid resolved but whose start time did not keys to
 * `<agent>:<pid>:0` while its neighbours key to the real start time.
 *
 * On an ordinary event that costs nothing lasting — the split lineage carries
 * its own count and clock for as long as the failures continue, and the next
 * event that reads /proc successfully lands back on the real one. But when the
 * split falls on the single event carrying `startsNewConversation`, the loss is
 * permanent. That flag is the only thing that ever moves a count, and `apply`
 * only acts on it while it is being applied: the bump goes to the throwaway
 * lineage, the real lineage is never told, and no later event replays it. The
 * conversation count stays one short for the life of that process — it does not
 * restart, and it does not catch up.
 *
 * There are two ways to land in it, not one. The start time can fail to resolve
 * while the pid does, which is the split above; or `resolveAgent` can return
 * pid 0 for that one event, in which case `lineageFor` returns null and no bump
 * happens anywhere at all.
 *
 * Left as is regardless: both need /proc to fail on exactly the event that
 * begins a conversation, and the cost is a number in a row being one low.
 */
function makeLineageKey(agent: AgentId, pid: number, processStartedAt: number): string {
  return `${agent}:${pid}:${processStartedAt}`
}

export class SessionStore {
  private sessions = new Map<string, Session>()
  private lineages = new Map<string, Lineage>()
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
    // startedAt now marks when the current conversation began, not when the
    // agent process did, so rows order by conversation age rather than
    // process age — a record recreated by /clear sorts to the end while the
    // outgoing record it replaced keeps its old position. Intended.
    return [...this.sessions.values()].sort((a, b) => a.startedAt - b.startedAt)
  }

  get(key: string): Session | undefined {
    return this.sessions.get(key)
  }

  /**
   * The lineage for the process this event came from, created on first sight.
   * Null when there is nothing to key on: resolveAgent returns pid 0 whenever
   * it cannot read /proc or cannot identify the agent, and a lineage keyed on 0
   * would merge every unidentified agent on the machine into one count.
   *
   * Also null at the cap. Unlike the session map this one can be grown by a
   * peer that never gets a session created — a lineage is minted before ensure
   * runs — so it needs its own bound rather than inheriting that one.
   */
  private lineageFor(e: AgentEvent): Lineage | null {
    if (!e.pid) return null
    const processStartedAt = e.agentStartedAt ?? 0
    const key = makeLineageKey(e.agent, e.pid, processStartedAt)
    let l = this.lineages.get(key)
    if (!l) {
      if (this.lineages.size >= MAX_SESSIONS) return null
      l = {
        pid: e.pid,
        processStartedAt,
        count: 1,
        conversationStartedAt: e.agentStartedAt ?? e.ts,
      }
      this.lineages.set(key, l)
    }
    return l
  }

  private ensure(e: AgentEvent, lineage: Lineage | null): Session | null {
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
        // The conversation's start, which the lineage carries across the record
        // boundary that /clear creates. Falling back to the process start keeps
        // a record recreated after a reap or a shell reload reporting the same
        // number rather than restarting the clock at the current task.
        startedAt: lineage?.conversationStartedAt ?? e.agentStartedAt ?? e.ts,
        conversationIndex: lineage?.count ?? 1,
        processStartedAt: e.agentStartedAt,
        lastEventAt: e.ts,
      }
      this.sessions.set(key, s)
    }
    return s
  }

  apply(e: AgentEvent): void {
    const lineage = this.lineageFor(e)
    // Bumped before ensure, so the record ensure creates for the incoming
    // session id is already numbered. /clear delivers its SessionEnd first, so
    // the outgoing record is untouched and keeps showing its own duration for
    // the length of its linger.
    if (lineage && e.startsNewConversation) {
      lineage.count += 1
      lineage.conversationStartedAt = e.ts
    }
    const s = this.ensure(e, lineage)
    if (!s) return
    // Renumbers a record ensure did not just create too: an agent that
    // restarts a conversation under the *same* id would otherwise keep the
    // previous conversation's clock and number forever.
    if (lineage && e.startsNewConversation) {
      s.startedAt = lineage.conversationStartedAt
      s.conversationIndex = lineage.count
    }
    s.lastEventAt = e.ts
    if (e.pid) s.pid = e.pid
    // Refreshed here rather than left at what ensure stamped, for exactly the
    // reason the pid above is: a session id can outlive its process, because
    // `claude --resume <id>` reuses the id under a brand new one. A record that
    // survives that (it need only be within the reaper's window) would
    // otherwise name the live process by pid while reporting the *dead*
    // process's uptime as its shell total — a number too large by however long
    // the old shell ran, and one that never resets for the life of the record.
    // Guarded on undefined rather than assigned outright so a transient /proc
    // failure can only fail to update a good value, never blank one.
    if (e.agentStartedAt !== undefined) s.processStartedAt = e.agentStartedAt
    // Written here, alongside the pid it must agree with, rather than once at
    // creation: a session id can outlive its process (`claude --resume` reuses
    // the id under a new pid), and this is the only place pid is refreshed.
    // Leaving an old stamp in place would pin the record to the dead
    // process's lineage forever. Taken from the Lineage this event resolved
    // to, never rebuilt from the record's own fields, so it stays exact.
    if (lineage) s.lineageKey = makeLineageKey(e.agent, lineage.pid, lineage.processStartedAt)
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
        // liveness check below: resolveAgent returns pid 0 when it cannot read
        // /proc or cannot identify the agent, and pidAlive(0) is false, which
        // would otherwise drop a live session with an unresolved pid on the
        // first sweep.
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
      // through resolveAgent while the hook is still blocked in its call — so
      // this is a real liveness test. It is the only thing that clears the pill
      // for an agent with no session-end event, or a Claude install predating the
      // SessionEnd hook. Guarded on pid > 0 because resolveAgent returns pid 0
      // when it cannot read /proc or cannot identify the agent, and pidAlive(0)
      // is false, which would otherwise reap a perfectly live session on the
      // very first sweep. Those fall back to the stale window below.
      const agentGone = s.pid > 0 && !pidAlive(s.pid)
      const abandoned = now - s.lastEventAt > STALE_MS && !pidAlive(s.pid)
      if (agentGone || abandoned) {
        this.sessions.delete(key)
        dropped.push(key)
      }
    }
    this.pruneLineages(pidAlive)
    if (dropped.length > 0) this.emit()
    return dropped
  }

  /**
   * A lineage outlives the records it numbers — that is the whole point of it —
   * so it cannot be collected with them. It goes once nothing references it and
   * its process is confirmed gone.
   *
   * Runs on every sweep rather than only when a session was dropped: an agent
   * can die long after its last record was collected, and that sweep drops
   * nothing, so a dropped-only guard would leak the lineage for good.
   *
   * The referenced set is read from each Session's own lineageKey stamp rather
   * than rebuilt from its current pid and processStartedAt. Both of those are
   * refreshed on every event now, so staleness is no longer the reason — the
   * reason is that they are the *event's* values, under two independent guards
   * (a pid of 0 is not written, an undefined start time is not written), while
   * a lineage stays filed under whatever the key was when it was minted. A
   * lineage first seen on an event with no readable start time is filed under
   * `<agent>:<pid>:0` for the rest of its life; once a later event supplies a
   * real start time, the record's own two fields no longer rebuild that key at
   * all, and the real lineage would leak until the map hit its cap. The stamp
   * is written from the Lineage object itself, in apply, so it names the map
   * entry exactly and cannot be reconstructed wrong.
   *
   * It can still be *stale*, in one case: at the lineage cap lineageFor returns
   * null, so apply refreshes s.pid without refreshing the stamp beside it. The
   * record then keeps naming the lineage it has left, which holds that entry
   * referenced — and therefore unprunable — even once its process is gone. It
   * frees itself when the referencing record is reaped, and reaching it at all
   * takes a peer minting three hundred processes, so it is left as is.
   */
  private pruneLineages(pidAlive: (pid: number) => boolean): void {
    const referenced = new Set<string>()
    for (const s of this.sessions.values()) {
      if (s.lineageKey !== undefined) referenced.add(s.lineageKey)
    }
    for (const [key, l] of [...this.lineages]) {
      if (!referenced.has(key) && !pidAlive(l.pid)) this.lineages.delete(key)
    }
  }
}
