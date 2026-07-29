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
 */
export function activityText(session: Session): Activity {
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
