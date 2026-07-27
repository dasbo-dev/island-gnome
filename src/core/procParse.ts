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
