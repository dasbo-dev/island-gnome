import { truncateDetail } from './format.js'
import type { Session } from './types.js'

/** What the session row's activity label says, and whether it is a placeholder. */
export interface Activity {
  text: string
  /**
   * True when the text stands in for absent content ("thinking…", "idle")
   * rather than reporting something the agent is doing. The row dims these so
   * a placeholder does not read as a tool name.
   */
  hint: boolean
}

/**
 * Whether `session.notice` is the thing actually on the row right now — the
 * single answer to "is the notice what is showing", shared by this file's own
 * notice branch below and by `Island.notifyNotification`'s decision to open
 * the popup for a notice at all. Without a shared answer, the two could
 * disagree: `notifyNotification` used to guard only on `notice` being set, so
 * it would open the popup for a notice a pending permission was already
 * hiding, showing nothing new and arming a close timer that could shut the
 * popup a permission needed answered.
 *
 * False in three cases: no notice at all; a notice whose deadline has passed
 * (`until !== 0 && now >= until` — `until === 0` means no clock, so it never
 * expires this way); and a notice held by a pending permission or question.
 * That third case is reachable in the ordinary run of events, not merely a
 * defensive check — see the comment above `activityText` for how.
 */
export function noticeVisible(session: Session, now: number): boolean {
  const notice = session.notice
  if (!notice) return false
  if (notice.until !== 0 && now >= notice.until) return false
  if (session.pendingPermission || session.pendingQuestion) return false
  return true
}

/**
 * The row's activity text, decided in one place so the branches are testable —
 * `src/shell` needs a running GNOME Shell and cannot be unit-tested here.
 *
 * Order matters: the branches run top to bottom, so an error carrying a detail
 * but no tool falls into the detail-only branch. `apply` sets `detail` and
 * leaves `currentTool` alone for an error, so an errored tool event still
 * renders as `<tool> · <error text>`.
 *
 * There is deliberately no branch that prints `session.state`. The pill renders
 * `running` as "working" (STATE_WORD in island.ts), so a row falling back to the
 * raw word made the same session read two ways at once.
 *
 * The catch-all at the end returns 'error' for any state that isn't
 * `running`/`idle`/`done` — safe only because `store.ts` enforces that
 * `waiting` always implies a pending permission or question (`setPending` sets
 * both in one statement, `apply`'s guard is inside `if (s.pendingPermission)`,
 * `clearPending` clears both together, and `setPendingQuestion` is the pair
 * that keeps `waiting` honest for questions). This function is pure and does
 * not re-check that invariant itself.
 *
 * The notice branch sits between the pending pair and the tool pair, and the
 * pending branches winning is not a defensive ordering against something
 * that cannot happen — the two fields coexist on a real, reachable session.
 * `store.apply`'s notification branch sets `s.notice` without touching
 * `pendingPermission` or `pendingQuestion`; only `setPending` and
 * `setPendingQuestion` clear the notice, and neither runs when a notification
 * arrives. So the ordinary sequence — a permission is requested, then Claude
 * raises `Notification` because the same prompt has also sat idle — leaves a
 * session holding both at once (`test/core/activity.test.ts`'s "yields to a
 * pending permission" test constructs exactly that state). `noticeVisible`
 * below is where the winner is decided, once, so this function and
 * `Island.notifyNotification`'s decision to open the popup at all agree about
 * which of the two the row is showing.
 */
export function activityText(session: Session, now: number): Activity {
  const question = session.pendingQuestion
  if (question) {
    // The header, not the question text: Claude bounds it at 12 characters, so
    // it needs no truncation and cannot push the expander off the row. The
    // question itself is one click away in the panel.
    return { text: `question · ${question.questions[0]?.header ?? ''}`, hint: false }
  }

  const pending = session.pendingPermission
  if (pending) {
    // The tool name comes from the payload, so it needs bounding for the same
    // reason detail does — an unbounded label pushes Allow and Deny off screen.
    const tool = truncateDetail(pending.tool, 40)
    const what = pending.detail ? `${tool} · ${truncateDetail(pending.detail)}` : tool
    const more = pending.queued > 0 ? ` · +${pending.queued} more` : ''
    return { text: `waiting for you · ${what}${more}`, hint: false }
  }

  // Below the two pending branches, because each of those puts controls on the
  // row and the label has to describe what those controls are for. Above
  // tool/detail because a notification arrives when nothing is running, so in
  // practice those are already clear — and where they are not, the notice is
  // the fresher fact.
  if (noticeVisible(session, now)) {
    // Bounded for the same reason the tool name above is: `message` comes
    // straight off the payload and nothing else caps it.
    return { text: truncateDetail(session.notice!.text), hint: false }
  }

  const tool = session.currentTool
  const detail = session.detail
  if (tool && detail) return { text: `${tool} · ${truncateDetail(detail)}`, hint: false }
  if (tool) return { text: tool, hint: false }
  if (detail) return { text: truncateDetail(detail), hint: false }

  if (session.state === 'running') return { text: 'thinking…', hint: true }
  if (session.state === 'idle') return { text: 'idle', hint: true }
  if (session.state === 'done') return { text: 'done', hint: false }
  return { text: 'error', hint: false }
}
