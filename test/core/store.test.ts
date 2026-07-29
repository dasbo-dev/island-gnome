import { describe, it, expect } from 'vitest'
import { SessionStore } from '../../src/core/store.js'
import type { AgentEvent } from '../../src/core/types.js'

function ev(over: Partial<AgentEvent> = {}): AgentEvent {
  return {
    agent: 'claude',
    kind: 'session-start',
    sessionId: 's1',
    cwd: '/home/me/projects/dasbo-island',
    pid: 4242,
    ts: 1000,
    ...over,
  }
}

describe('SessionStore', () => {
  it('creates a session on session-start with project from cwd basename', () => {
    const s = new SessionStore()
    s.apply(ev())
    const list = s.list()
    expect(list).toHaveLength(1)
    expect(list[0]!.project).toBe('dasbo-island')
    expect(list[0]!.state).toBe('idle')
    expect(list[0]!.key).toBe('claude:s1')
  })

  it('creates a session implicitly when the first event is not session-start', () => {
    const s = new SessionStore()
    s.apply(ev({ kind: 'tool-start', tool: 'Edit' }))
    expect(s.list()).toHaveLength(1)
    expect(s.list()[0]!.state).toBe('running')
  })

  it('moves to running on tool-start and records the tool', () => {
    const s = new SessionStore()
    s.apply(ev())
    s.apply(ev({ kind: 'tool-start', tool: 'Edit', detail: 'main.js', ts: 2000 }))
    expect(s.list()[0]!.state).toBe('running')
    expect(s.list()[0]!.currentTool).toBe('Edit')
    expect(s.list()[0]!.detail).toBe('main.js')
  })

  it('stays running on tool-end and clears the tool', () => {
    const s = new SessionStore()
    s.apply(ev({ kind: 'tool-start', tool: 'Edit' }))
    s.apply(ev({ kind: 'tool-end', tool: 'Edit', ts: 3000 }))
    expect(s.list()[0]!.state, 'the agent is thinking, not waiting').toBe('running')
    expect(s.list()[0]!.currentTool).toBeUndefined()
    expect(s.list()[0]!.detail).toBeUndefined()
  })

  it('settles to idle on turn-end and stamps no doneAt', () => {
    const s = new SessionStore()
    s.apply(ev())
    s.apply(ev({ kind: 'turn-end', ts: 5000 }))
    expect(s.list()[0]!.state, 'a finished turn is not a finished session').toBe('idle')
    expect(s.list()[0]!.doneAt).toBeUndefined()
  })

  it('marks done on session-end and stamps doneAt', () => {
    const s = new SessionStore()
    s.apply(ev())
    s.apply(ev({ kind: 'session-end', ts: 5000 }))
    expect(s.list()[0]!.state).toBe('done')
    expect(s.list()[0]!.doneAt).toBe(5000)
  })

  it('keeps sessions from different agents with the same id separate', () => {
    const s = new SessionStore()
    s.apply(ev({ agent: 'claude' }))
    s.apply(ev({ agent: 'codex' }))
    expect(s.list()).toHaveLength(2)
  })

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const s = new SessionStore()
    let n = 0
    const off = s.subscribe(() => { n++ })
    s.apply(ev())
    expect(n).toBe(1)
    off()
    s.apply(ev({ kind: 'turn-end', ts: 2000 }))
    expect(n).toBe(1)
  })

  it('setPending puts the session into waiting and clearPending restores running', () => {
    // A permission request always follows a tool-start (service.ts applies
    // tool-start, then calls permissions.request) — session-start into
    // setPending is not a reachable sequence.
    const s = new SessionStore()
    s.apply(ev({ kind: 'tool-start', tool: 'Bash' }))
    s.setPending('claude:s1', { id: 'p1', tool: 'Bash', detail: 'rm -rf build', deadline: 31000, queued: 0 })
    expect(s.list()[0]!.state).toBe('waiting')
    expect(s.list()[0]!.pendingPermission?.tool).toBe('Bash')
    s.clearPending('claude:s1')
    expect(s.list()[0]!.state).toBe('running')
    expect(s.list()[0]!.pendingPermission).toBeUndefined()
  })

  it('reap drops a session whose pid is dead even once it is also stale', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    const fifteenMin = 15 * 60 * 1000
    s.reap(fifteenMin + 1, () => false)
    expect(s.list()).toHaveLength(0)
  })

  it('reap keeps a stale session whose pid is still alive', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.reap(15 * 60 * 1000 + 1, () => true)
    expect(s.list()).toHaveLength(1)
  })

  it('reap drops a session whose agent process is gone, without waiting for the stale window', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    const dropped = s.reap(1000, () => false)
    expect(s.list()).toHaveLength(0)
    expect(dropped).toEqual(['claude:s1'])
  })

  it('reap keeps a fresh session whose agent process is alive', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.reap(1000, () => true)
    expect(s.list()).toHaveLength(1)
  })

  it('reap never uses liveness on an unresolved pid, which would delete a live session', () => {
    // resolveAgent returns 0 when it cannot read /proc, and pidAlive(0) is
    // false. Without the pid > 0 guard this session would go on the first sweep.
    const s = new SessionStore()
    s.apply(ev({ ts: 0, pid: 0 }))
    s.reap(1000, () => false)
    expect(s.list(), 'an unresolved pid falls back to the stale window').toHaveLength(1)
    s.reap(15 * 60 * 1000 + 1, () => false)
    expect(s.list()).toHaveLength(0)
  })

  it('reap lets a done session finish its linger even though the agent has exited', () => {
    // A session ends because the agent exited, so session-end and process death
    // land in the same sweep. Liveness must not pre-empt the linger, or 'done'
    // would never be visible.
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.apply(ev({ kind: 'session-end', ts: 1000 }))
    s.reap(2000, () => false)
    expect(s.list(), 'still lingering').toHaveLength(1)
    expect(s.list()[0]!.state).toBe('done')
    s.reap(1000 + 10_000 + 1, () => false)
    expect(s.list()).toHaveLength(0)
  })

  it('reap drops a done session after the linger window', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.apply(ev({ kind: 'session-end', ts: 1000 }))
    s.reap(1000 + 10_000 + 1, () => true)
    expect(s.list()).toHaveLength(0)
  })

  it('reap keeps a pending permission with a live deadline even if the pid is dead', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.setPending('claude:s1', { id: 'p1', tool: 'Bash', deadline: 30_000, queued: 0 })
    s.reap(99_999_999, () => false)
    expect(s.list()).toHaveLength(1)
  })

  it('reap keeps a pending permission with deadline 0 while the pid is alive', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.setPending('claude:s1', { id: 'p1', tool: 'Bash', deadline: 0, queued: 0 })
    s.reap(99_999_999, () => true)
    expect(s.list()).toHaveLength(1)
  })

  it('reap drops a zombie pending permission: dead pid and deadline 0, and reports its key', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.setPending('claude:s1', { id: 'p1', tool: 'Bash', deadline: 0, queued: 0 })
    const dropped = s.reap(99_999_999, () => false)
    expect(s.list()).toHaveLength(0)
    expect(dropped).toEqual(['claude:s1'])
  })

  it('reap does not treat a pending permission with an unresolved pid as a zombie', () => {
    // resolveAgent returns 0 when it cannot read /proc, and pidAlive(0) is
    // false. Without the pid > 0 guard, a live session with an unresolved pid
    // and permission-timeout=0 would be dropped on the first sweep, silently
    // resolving the held D-Bus reply as fallthrough. The zombie rule checks
    // pid > 0, so an unresolved pid can never match it — it's only caught by
    // the stale escape hatch if no events arrive for 15 minutes.
    const s = new SessionStore()
    s.apply(ev({ ts: 0, pid: 0 }))
    s.setPending('claude:s1', { id: 'p1', tool: 'Bash', deadline: 0, queued: 0 })
    s.reap(1000, () => false)
    expect(s.list(), 'not treated as a zombie on first sweep').toHaveLength(1)
    const fifteenMin = 15 * 60 * 1000
    s.reap(fifteenMin + 1, () => false)
    expect(s.list(), 'but dropped by stale escape hatch after 15 minutes').toHaveLength(0)
  })

  it('reap collects a pending permission with unresolved pid once the stale window expires, and reports its key', () => {
    // With permission-timeout=0 and an unresolved pid, a zombie can never fire
    // (pid > 0 guard), and no timer will ever resolve it. Without a stale escape
    // hatch this session would sit forever. The 15-minute stale window is safe:
    // a pending permission that blocked on a slow human should not be collected
    // merely because /proc was unreadable, but fifteen minutes with no events is
    // genuinely wedged.
    const s = new SessionStore()
    s.apply(ev({ ts: 0, pid: 0 }))
    s.setPending('claude:s1', { id: 'p1', tool: 'Bash', deadline: 0, queued: 0 })
    const fifteenMin = 15 * 60 * 1000
    // Within the stale window, it survives
    s.reap(fifteenMin - 1, () => false)
    expect(s.list()).toHaveLength(1)
    // Past the stale window, it is dropped and its key is reported
    const dropped = s.reap(fifteenMin + 1, () => false)
    expect(s.list()).toHaveLength(0)
    expect(dropped).toEqual(['claude:s1'])
  })

  it('reap drops an abandoned session with an unresolved pid after the stale window, and reports its key', () => {
    // pid: 0 so agentGone can never fire (it requires pid > 0) — only the
    // 15-minute stale rule can drop this one. (Previously this test used
    // pid: 4242 with a fake pidAlive that always returns false, so agentGone
    // fired at any `now` and the 15-minute wait was decorative — it could
    // never actually fail.)
    const s = new SessionStore()
    s.apply(ev({ ts: 0, pid: 0 }))
    const fifteenMin = 15 * 60 * 1000
    const dropped = s.reap(fifteenMin + 1, () => false)
    expect(dropped).toEqual(['claude:s1'])
  })

  it('reap drops a done session after its linger window and reports its key', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.apply(ev({ kind: 'session-end', ts: 1000 }))
    const dropped = s.reap(1000 + 10_000 + 1, () => true)
    expect(dropped).toEqual(['claude:s1'])
  })

  it('reap lets an error session linger past pid death, then drops it after the grace window', () => {
    // An errored session whose agent has already exited deserves the same
    // grace as a finished one — otherwise it can vanish on the very next
    // sweep, possibly the instant the error appears. Reuses lastEventAt
    // rather than adding a field or a setting.
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.apply(ev({ kind: 'error', detail: 'boom', ts: 1000 }))
    s.reap(1000 + 10_000 - 1, () => false)
    expect(s.list(), 'still within the grace window').toHaveLength(1)
    expect(s.list()[0]!.state).toBe('error')
    s.reap(1000 + 10_000 + 1, () => false)
    expect(s.list(), 'dropped once the grace window elapses and the pid is dead').toHaveLength(0)
  })

  it('applying tool-end while a permission is pending leaves state waiting, and resolving settles to running', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.setPending('claude:s1', { id: 'p1', tool: 'Bash', detail: 'rm -rf build', deadline: 30_000, queued: 0 })
    expect(s.list()[0]!.state).toBe('waiting')

    // A parallel tool batch: another tool's tool-end arrives while Bash's
    // permission is still held open.
    s.apply(ev({ kind: 'tool-end', tool: 'Edit', ts: 1000 }))
    expect(s.list()[0]!.state, 'must still say waiting — the agent is still blocked').toBe('waiting')
    expect(s.list()[0]!.pendingPermission?.id).toBe('p1')

    s.clearPending('claude:s1')
    expect(s.list()[0]!.state, 'the batch is still running').toBe('running')
  })

  it('applying turn-end while a permission is pending leaves state waiting, and resolving settles to idle', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.setPending('claude:s1', { id: 'p1', tool: 'Bash', detail: 'rm -rf build', deadline: 30_000, queued: 0 })
    expect(s.list()[0]!.state).toBe('waiting')

    s.apply(ev({ kind: 'turn-end', ts: 2000 }))
    expect(s.list()[0]!.state, 'must still say waiting until the permission resolves').toBe('waiting')
    expect(s.list()[0]!.doneAt).toBeUndefined()

    s.clearPending('claude:s1')
    expect(s.list()[0]!.state).toBe('idle')
  })

  it('applying session-end while a permission is pending leaves state waiting, and resolving settles to done', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.setPending('claude:s1', { id: 'p1', tool: 'Bash', detail: 'rm -rf build', deadline: 30_000, queued: 0 })
    expect(s.list()[0]!.state).toBe('waiting')

    s.apply(ev({ kind: 'session-end', ts: 2000 }))
    expect(s.list()[0]!.state, 'must still say waiting until the permission resolves').toBe('waiting')
    expect(s.list()[0]!.doneAt).toBe(2000)

    s.clearPending('claude:s1')
    expect(s.list()[0]!.state).toBe('done')
  })

  it('does not settle a resumed session to done from a stale doneAt', () => {
    // A session that had finished and was resumed still carried its old doneAt,
    // so resolving a later permission marked the live session done and the next
    // reaper sweep deleted its row. Reaching 'done' now takes a session-end,
    // but the stale stamp must still be cleared when the session comes back.
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.apply(ev({ kind: 'session-end', ts: 1000 }))
    expect(s.list()[0]!.state).toBe('done')

    s.apply(ev({ kind: 'prompt-submit', ts: 2000 }))
    expect(s.list()[0]!.state).toBe('running')
    expect(s.list()[0]!.doneAt, 'resuming clears the finish stamp').toBeUndefined()

    // No event arrives during the hold, so there is nothing deferred: the
    // agent simply proceeds with the tool it asked about, so 'running' is the
    // correct settle — but it must not be 'done', and the session must not be
    // reapable as finished.
    s.setPending('claude:s1', { id: 'p1', tool: 'Bash', deadline: 30_000, queued: 0 })
    s.clearPending('claude:s1')
    expect(s.list()[0]!.state, 'a live session must not settle to done').toBe('running')

    expect(s.reap(20_000, () => true), 'and must not be reaped as finished').toEqual([])
    expect(s.list()).toHaveLength(1)
  })

  it('preserves an error that arrived while a permission was pending', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.setPending('claude:s1', { id: 'p1', tool: 'Bash', deadline: 30_000, queued: 0 })

    s.apply(ev({ kind: 'error', detail: 'boom', ts: 2000 }))
    expect(s.list()[0]!.state, 'waiting still wins while held').toBe('waiting')

    s.clearPending('claude:s1')
    expect(s.list()[0]!.state, 'the error must survive the resolve').toBe('error')
  })

  it('clears a stale detail and tool when a new session starts', () => {
    // Before activity.ts existed, the row rendered `tool ?? session.state`, so
    // a stale detail was invisible. Now activity.ts has a detail-only branch
    // that prints it, so an error's leftover detail must not survive into the
    // next session-start.
    const s = new SessionStore()
    s.apply(ev({ kind: 'error', detail: 'boom: exit 1', ts: 0 }))
    expect(s.list()[0]!.detail).toBe('boom: exit 1')
    s.apply(ev({ kind: 'session-start', ts: 1000 }))
    expect(s.list()[0]!.state).toBe('idle')
    expect(s.list()[0]!.detail, 'a session-start must not leave a stale detail visible').toBeUndefined()
    expect(s.list()[0]!.currentTool).toBeUndefined()
  })

  it('caps the session count so a hostile peer cannot grow the map unbounded', () => {
    const s = new SessionStore()
    for (let i = 0; i < 305; i++) {
      s.apply(ev({ sessionId: `s${i}`, ts: i }))
    }
    expect(s.list().length).toBe(300)
  })

  it('stamps startedAt from the agent process when the event carries it', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 9000, agentStartedAt: 1500 }))
    expect(s.list()[0]!.startedAt).toBe(1500)
  })

  it('falls back to the event timestamp when /proc supplied nothing', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 9000 }))
    expect(s.list()[0]!.startedAt).toBe(9000)
  })

  it('keeps lastEventAt on the event timestamp, not the process start', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 9000, agentStartedAt: 1500 }))
    expect(s.list()[0]!.lastEventAt).toBe(9000)
  })

  it('reports the same startedAt after a reap recreates the session', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 9000, agentStartedAt: 1500 }))
    s.reap(9000, () => false)
    expect(s.list()).toHaveLength(0)
    s.apply(ev({ kind: 'tool-start', tool: 'Edit', ts: 20000, agentStartedAt: 1500 }))
    expect(s.list()[0]!.startedAt, 'the clock must not restart with the record').toBe(1500)
  })

  it('numbers the first conversation 1 and starts its clock at the process', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 9000, agentStartedAt: 1500 }))
    expect(s.list()[0]!.conversationIndex).toBe(1)
    expect(s.list()[0]!.startedAt).toBe(1500)
    expect(s.list()[0]!.processStartedAt).toBe(1500)
  })

  it('restarts the clock and bumps the number when a clear begins a new conversation', () => {
    const s = new SessionStore()
    s.apply(ev({ sessionId: 'old', ts: 9000, agentStartedAt: 1500 }))
    s.apply(ev({ sessionId: 'new', ts: 20000, agentStartedAt: 1500, startsNewConversation: true }))
    const fresh = s.list().find((x) => x.sessionId === 'new')!
    expect(fresh.conversationIndex).toBe(2)
    expect(fresh.startedAt, 'the clock measures the conversation, not the shell').toBe(20000)
    expect(fresh.processStartedAt, 'the shell total still comes from /proc').toBe(1500)
  })

  it('leaves the outgoing record alone so it shows its own final duration', () => {
    const s = new SessionStore()
    s.apply(ev({ sessionId: 'old', ts: 9000, agentStartedAt: 1500 }))
    s.apply(ev({ sessionId: 'old', kind: 'session-end', ts: 19000, agentStartedAt: 1500 }))
    s.apply(ev({ sessionId: 'new', ts: 20000, agentStartedAt: 1500, startsNewConversation: true }))
    const old = s.list().find((x) => x.sessionId === 'old')!
    expect(old.startedAt).toBe(1500)
    expect(old.conversationIndex).toBe(1)
  })

  it('counts a third conversation, so compaction after a clear keeps climbing', () => {
    const s = new SessionStore()
    s.apply(ev({ sessionId: 'a', ts: 1000, agentStartedAt: 1000 }))
    s.apply(ev({ sessionId: 'b', ts: 2000, agentStartedAt: 1000, startsNewConversation: true }))
    s.apply(ev({ sessionId: 'c', ts: 3000, agentStartedAt: 1000, startsNewConversation: true }))
    expect(s.list().find((x) => x.sessionId === 'c')!.conversationIndex).toBe(3)
  })

  it('keeps conversations in separate agent processes separate', () => {
    const s = new SessionStore()
    s.apply(ev({ sessionId: 'a', pid: 10, ts: 1000, agentStartedAt: 1000 }))
    s.apply(ev({ sessionId: 'b', pid: 10, ts: 2000, agentStartedAt: 1000, startsNewConversation: true }))
    s.apply(ev({ sessionId: 'c', pid: 20, ts: 3000, agentStartedAt: 3000 }))
    expect(s.list().find((x) => x.sessionId === 'c')!.conversationIndex).toBe(1)
  })

  it('treats a reused pid with a different start time as a different process', () => {
    const s = new SessionStore()
    s.apply(ev({ sessionId: 'a', pid: 10, ts: 1000, agentStartedAt: 1000 }))
    s.apply(ev({ sessionId: 'b', pid: 10, ts: 2000, agentStartedAt: 1000, startsNewConversation: true }))
    s.apply(ev({ sessionId: 'c', pid: 10, ts: 9000, agentStartedAt: 8000, startsNewConversation: true }))
    expect(
      s.list().find((x) => x.sessionId === 'c')!.conversationIndex,
      'a recycled pid must not inherit the dead process`s count'
    ).toBe(2)
  })

  it('keeps a live conversation numbered across the events inside it', () => {
    const s = new SessionStore()
    s.apply(ev({ sessionId: 'b', ts: 2000, agentStartedAt: 1000, startsNewConversation: true }))
    s.apply(ev({ sessionId: 'b', kind: 'tool-start', tool: 'Edit', ts: 3000, agentStartedAt: 1000 }))
    expect(s.list()[0]!.conversationIndex).toBe(2)
    expect(s.list()[0]!.startedAt, 'an ordinary event must not move the clock').toBe(2000)
  })

  it('numbers a conversation 1 when the agent process could not be identified', () => {
    const s = new SessionStore()
    s.apply(ev({ pid: 0, ts: 9000, agentStartedAt: 1500, startsNewConversation: true }))
    expect(
      s.list()[0]!.conversationIndex,
      'pid 0 is every unidentified agent at once; it can carry no lineage'
    ).toBe(1)
    expect(s.list()[0]!.startedAt).toBe(1500)
  })

  it('numbers a conversation 1 when the extension started mid-shell', () => {
    const s = new SessionStore()
    s.apply(ev({ kind: 'tool-start', tool: 'Edit', ts: 9000, agentStartedAt: 1500 }))
    expect(
      s.list()[0]!.conversationIndex,
      'no SessionStart replays on reload, so this undercounts by design'
    ).toBe(1)
    expect(s.list()[0]!.startedAt).toBe(1500)
  })

  it('lands on 2 when the first event it ever sees is a clear', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 9000, agentStartedAt: 1500, startsNewConversation: true }))
    expect(
      s.list()[0]!.conversationIndex,
      'at least two conversations have happened; 2 is the honest lower bound'
    ).toBe(2)
  })

  it('keeps the conversation clock when a reap recreates the record', () => {
    const s = new SessionStore()
    s.apply(ev({ sessionId: 'b', ts: 2000, agentStartedAt: 1000, startsNewConversation: true }))
    s.reap(3000, () => false)
    expect(s.list()).toHaveLength(0)
    s.apply(ev({ sessionId: 'b', kind: 'tool-start', tool: 'Edit', ts: 30000, agentStartedAt: 1000 }))
    expect(s.list()[0]!.startedAt, 'the lineage outlives the record it numbered').toBe(2000)
    expect(s.list()[0]!.conversationIndex).toBe(2)
  })

  it('renumbers and restarts a session that keeps its id across a new conversation', () => {
    const s = new SessionStore()
    s.apply(ev({ sessionId: 'same', ts: 1000, agentStartedAt: 1000 }))
    s.apply(ev({ sessionId: 'same', ts: 20000, agentStartedAt: 1000, startsNewConversation: true }))
    expect(s.list()).toHaveLength(1)
    expect(s.list()[0]!.conversationIndex).toBe(2)
    expect(s.list()[0]!.startedAt, 'reusing the id must not preserve the old clock').toBe(20000)
  })

  it('does not renumber an existing session on an ordinary event', () => {
    const s = new SessionStore()
    s.apply(ev({ sessionId: 'same', ts: 1000, agentStartedAt: 1000 }))
    s.apply(ev({ sessionId: 'same', kind: 'tool-start', tool: 'Edit', ts: 5000, agentStartedAt: 1000 }))
    expect(s.list()[0]!.conversationIndex).toBe(1)
    expect(s.list()[0]!.startedAt).toBe(1000)
  })

  it('leaves an unidentified agent unrenumbered, having no lineage to renumber from', () => {
    const s = new SessionStore()
    s.apply(ev({ sessionId: 'same', pid: 0, ts: 1000, agentStartedAt: 1000 }))
    s.apply(ev({ sessionId: 'same', pid: 0, ts: 20000, agentStartedAt: 1000, startsNewConversation: true }))
    expect(s.list()[0]!.conversationIndex).toBe(1)
    expect(s.list()[0]!.startedAt).toBe(1000)
  })
})
