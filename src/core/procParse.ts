/**
 * Extract the parent pid from the contents of /proc/<pid>/stat.
 * The comm field is wrapped in parentheses and may itself contain spaces and
 * parentheses, so everything up to the LAST ')' is skipped.
 */
export function parsePpid(statContent: string): number | null {
  const close = statContent.lastIndexOf(')')
  if (close === -1) return null
  const rest = statContent.slice(close + 1).trim().split(/\s+/)
  // rest[0] is the state character, rest[1] is the ppid.
  const ppid = Number(rest[1])
  return Number.isInteger(ppid) ? ppid : null
}

/**
 * Extract `comm` (field 2) from the contents of /proc/<pid>/stat. The kernel
 * truncates it to 15 characters and it may contain spaces and parentheses, so
 * it is bounded by the FIRST '(' and the LAST ')'.
 */
export function parseComm(statContent: string): string | null {
  const open = statContent.indexOf('(')
  const close = statContent.lastIndexOf(')')
  if (open === -1 || close <= open) return null
  return statContent.slice(open + 1, close)
}

/**
 * Extract `starttime` (field 22, clock ticks since boot) from the contents of
 * /proc/<pid>/stat. Same last-')' slice as parsePpid: after it, field 3 sits at
 * index 0, so field 22 sits at index 19.
 */
export function parseStartTicks(statContent: string): number | null {
  const close = statContent.lastIndexOf(')')
  if (close === -1) return null
  const rest = statContent.slice(close + 1).trim().split(/\s+/)
  const raw = rest[19]
  if (raw === undefined) return null
  const ticks = Number(raw)
  return Number.isFinite(ticks) && ticks >= 0 ? ticks : null
}

/**
 * Boot time in seconds since the epoch, from the `btime` line of /proc/stat —
 * the system-wide file, not a per-process one.
 */
export function parseBtime(procStatContent: string): number | null {
  for (const line of procStatContent.split('\n')) {
    if (!line.startsWith('btime ')) continue
    const secs = Number(line.slice('btime '.length).trim())
    return Number.isFinite(secs) && secs > 0 ? secs : null
  }
  return null
}

/**
 * Walk from `pid` up the process tree, returning the chain including `pid` itself.
 * `readStat` is injected so this stays free of any filesystem dependency.
 */
export function ancestorPids(
  pid: number,
  readStat: (pid: number) => string | null,
  maxDepth = 20
): number[] {
  if (pid <= 0) return []
  const chain: number[] = []
  const seen = new Set<number>()
  let current = pid

  while (chain.length < maxDepth && current > 0 && !seen.has(current)) {
    chain.push(current)
    seen.add(current)
    const stat = readStat(current)
    if (stat === null) break
    const ppid = parsePpid(stat)
    if (ppid === null || ppid <= 1) {
      if (ppid === 1 && chain.length < maxDepth && !seen.has(1)) chain.push(1)
      break
    }
    current = ppid
  }

  return chain
}
