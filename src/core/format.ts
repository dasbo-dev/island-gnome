/**
 * The largest whole unit, floored: `5s`, `1m`, `52h`. Floored rather than
 * rounded because a label reading `1m` beside a terminal the user started 54
 * seconds ago reads as a bug. Hours never roll over to days — a session
 * outliving a day is rare, and `52h` says more than `2d`, which would discard
 * the remaining hours.
 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  if (total < 60) return `${total}s`
  if (total < 3600) return `${Math.floor(total / 60)}m`
  return `${Math.floor(total / 3600)}h`
}

/**
 * Collapse whitespace and cap length. The popup's width is fixed in CSS and the
 * activity label wraps, so this bounds the label's *height*, not its width —
 * to a few wrapped lines, though the exact count depends on the column width,
 * which differs between a plain row and one showing the permission cluster.
 *
 * The cut lands on a word boundary. A task subject one line below this is never
 * truncated at all (`taskList.ts`), so an activity line ending mid-word made
 * two pieces of the same kind of content follow two different rules. When there
 * is no space to break at — a path, a URL, one long token — the hard cut stands,
 * because breaking at the first character would leave an ellipsis and nothing
 * else.
 */
export function truncateDetail(s: string, max = 120): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const window = flat.slice(0, max - 1)
  const lastSpace = window.lastIndexOf(' ')
  return lastSpace > 0 ? `${window.slice(0, lastSpace + 1)}…` : `${window}…`
}
