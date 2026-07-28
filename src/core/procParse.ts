import { basename } from './types.js'

/**
 * Extract the fields after the LAST ')' in a /proc stat line.
 * The comm field may itself contain spaces and parentheses, and after the
 * slice, field 3 sits at index 0. Returns null if no closing paren is found.
 */
function statFields(statContent: string): string[] | null {
  const close = statContent.lastIndexOf(')')
  if (close === -1) return null
  return statContent.slice(close + 1).trim().split(/\s+/)
}

/**
 * Extract the parent pid from the contents of /proc/<pid>/stat.
 * The comm field is wrapped in parentheses and may itself contain spaces and
 * parentheses, so everything up to the LAST ')' is skipped.
 */
export function parsePpid(statContent: string): number | null {
  const rest = statFields(statContent)
  if (rest === null) return null
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
 * /proc/<pid>/stat. Same `statFields` last-')' slice as `parsePpid`: after it,
 * field 3 sits at index 0, so field 22 sits at index 19.
 */
export function parseStartTicks(statContent: string): number | null {
  const rest = statFields(statContent)
  if (rest === null) return null
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

/**
 * Shells an agent spawns its hooks through. `comm` values, so already
 * basenames. Skipped outright: the walk keeps going past a shell, since the
 * agent is expected further up (a login shell wrapping the wrapper shell, for
 * instance).
 */
const SHELLS = new Set(['sh', 'dash', 'bash', 'zsh', 'fish', 'env'])

/**
 * Interpreters a hook (or the agent itself) may run under. `comm` values, so
 * already basenames. Unlike a shell, the walk STOPS here rather than
 * continuing past it — see `selectAgentPid` for why. Deliberately just these
 * two: every name in this set is a process the walk stops at, so speculative
 * additions (`python3`, `pwsh`, ...) would silently start truncating chains
 * for agents that never come through them. Add one only when a real agent
 * shim needs it.
 */
const INTERPRETERS = new Set(['node', 'gjs'])

/**
 * Split the NUL-separated contents of /proc/<pid>/cmdline into its argv
 * entries, dropping the empty string a trailing NUL otherwise produces.
 */
export function parseCmdlineArgs(cmdlineContent: string): string[] {
  return cmdlineContent.split('\0').filter((arg) => arg.length > 0)
}

/**
 * The agent process that owns a hook, or 0 when it cannot be identified.
 *
 * The hook's parent is NOT the agent: agents spawn hooks through a wrapper
 * shell running a compound command (`zsh -c 'source <snapshot> && eval <hook>'`),
 * which never execs and dies the moment the hook exits. Walking the chain and
 * identifying the process by name is what survives that, and it also handles a
 * login shell in between, or no wrapper at all.
 *
 * Shells and interpreters are told apart on the way up. A shell (`SHELLS`) is
 * skipped: the walk keeps going, since a login shell wrapping the wrapper
 * shell is a real shape. An interpreter (`INTERPRETERS`) STOPS the walk,
 * because an npm-installed agent runs behind a `#!/usr/bin/env node` shim, so
 * its own `comm` is `node` — walking past it the way a shell is skipped would
 * land the fallback on whatever sits above it, typically a terminal emulator
 * that outlives every session. Before stopping, the interpreter's own
 * `/proc/<pid>/cmdline` is checked: if any argument's basename is in
 * `procNames` (e.g. `node /home/u/.npm-global/bin/claude` matching `claude`),
 * that process IS the agent and its pid is returned outright. Otherwise the
 * walk stops there and returns whatever fallback was already found — never
 * the terminal emulator above it. cmdline is only trusted for interpreters:
 * the wrapper shell's own cmdline contains the hook command itself (`...
 * dasbo-hook claude notify SessionStart`), so testing it the same way would
 * match the wrong process.
 *
 * 0 rather than a best guess when nothing matches: every caller guards on
 * `pid > 0`, so an unknown pid merely disables liveness reaping and jump-back
 * for that session, whereas a wrong pid makes the reaper drop a live one.
 *
 * Must be called while the hook is still blocked in its D-Bus call, i.e. from
 * inside the method handler, since the whole chain has to be readable.
 */
export function selectAgentPid(
  hookPid: number,
  procNames: string[],
  readStat: (pid: number) => string | null,
  readCmdline: (pid: number) => string | null
): number {
  const chain = ancestorPids(hookPid, readStat)
  let fallback = 0

  // From 1: index 0 is the hook process itself.
  for (let i = 1; i < chain.length; i++) {
    const pid = chain[i]!
    // init owns every process on the system and identifies nothing.
    if (pid <= 1) continue
    const stat = readStat(pid)
    if (stat === null) continue
    const comm = parseComm(stat)
    if (comm === null) continue
    if (procNames.includes(comm)) return pid
    if (SHELLS.has(comm)) continue
    if (INTERPRETERS.has(comm)) {
      const cmdline = readCmdline(pid)
      if (cmdline !== null) {
        const args = parseCmdlineArgs(cmdline)
        if (args.some((arg) => procNames.includes(basename(arg)))) return pid
      }
      break
    }
    // Nearest first: a terminal emulator further up must not win over the
    // agent sitting just above the wrapper shell.
    if (fallback === 0) fallback = pid
  }

  return fallback
}

/** Fixed at 100 for the /proc ABI regardless of the kernel's CONFIG_HZ. */
const USER_HZ = 100
/** btime jitters by around a second across suspend; tolerate a little skew. */
const FUTURE_SLACK_MS = 5000
/** A session older than this is a garbled read, not a long-running agent. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/**
 * When the process described by `statContent` started, in ms since the epoch,
 * or null when the inputs cannot be trusted. Derived rather than observed, so
 * it is recoverable at any moment — after a reap, after a shell reload, or for
 * a session that was already running when the extension was enabled.
 */
export function agentStartMs(
  statContent: string,
  procStatContent: string,
  now: number
): number | null {
  const ticks = parseStartTicks(statContent)
  const btime = parseBtime(procStatContent)
  if (ticks === null || btime === null) return null

  const ms = Math.round((btime + ticks / USER_HZ) * 1000)
  if (ms > now + FUTURE_SLACK_MS) return null
  if (ms < now - MAX_AGE_MS) return null
  return ms
}
