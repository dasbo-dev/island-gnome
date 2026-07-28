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
 * activity label wraps, so this bounds the label's *height* — roughly three
 * wrapped lines at the popup width — not its width.
 */
export function truncateDetail(s: string, max = 120): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : flat.slice(0, max - 1) + '…'
}
