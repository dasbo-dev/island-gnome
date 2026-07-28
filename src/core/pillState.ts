import type { Session, SessionState } from './types.js'

/**
 * Ranked so a finished session can never mask a live one when both are
 * present. `store.ts` used to keep its own copy of this table for a ranking
 * method that has since been removed; this is the only copy left.
 */
const RANK: Record<SessionState, number> = {
  done: 0,
  idle: 1,
  running: 2,
  waiting: 3,
  error: 4,
}

/**
 * Which state the pill's icon shows for the whole session set.
 *
 * A pending permission wins outright, ahead of `error`. The icon has one pose
 * slot, and a permission is the only state that blocks an agent on the user —
 * an error is informational, and the popup still reports it per session. This
 * replaces the workaround in `Island._rebuildRows`, which drove the old pulse
 * off the live-controls count precisely because `RANK` puts `error` above
 * `waiting`.
 *
 * `allDone` is special-cased for the opposite reason: `RANK` deliberately
 * ranks `done` lowest, which would otherwise report `idle` for a set where
 * every session finished — directly contradicting the rows, which read `done`.
 */
export function pillState(sessions: Session[]): SessionState {
  if (sessions.length === 0) return 'idle'
  if (sessions.some((s) => s.pendingPermission)) return 'waiting'
  if (sessions.every((s) => s.state === 'done')) return 'done'

  let worst: SessionState = 'idle'
  for (const s of sessions) {
    if (RANK[s.state] > RANK[worst]) worst = s.state
  }
  return worst
}
