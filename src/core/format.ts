export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** Collapse whitespace and cap length, so one label cannot resize the popup. */
export function truncateDetail(s: string, max = 120): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : flat.slice(0, max - 1) + '…'
}
