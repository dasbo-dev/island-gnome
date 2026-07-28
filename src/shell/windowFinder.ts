import GLib from 'gi://GLib'
import type Meta from 'gi://Meta'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import { adapters } from '../core/adapters/index.js'
import { agentStartMs, ancestorPids, selectAgentPid } from '../core/procParse.js'
import type { AgentId } from '../core/types.js'

function readFile(path: string): string | null {
  try {
    const [ok, bytes] = GLib.file_get_contents(path)
    if (!ok) return null
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

function readStat(pid: number): string | null {
  return readFile(`/proc/${pid}/stat`)
}

/**
 * The agent process behind a hook call, and when it started.
 *
 * The hook's parent is not the agent. Agents spawn hooks through a wrapper
 * shell running a compound command, which never execs and dies the instant the
 * hook exits — storing that pid made the reaper drop live sessions, reset the
 * elapsed clock on every recreation, and left jump-back with a dead ancestry
 * seed. `selectAgentPid` walks past it to the real process.
 *
 * `startedAt` is derived from that process rather than from this event, so it
 * is the same number every time it is computed: after a reap, after a shell
 * reload, or for a session that predates the extension being enabled. Omitted
 * whenever /proc cannot supply a value the store should trust.
 *
 * Must be called while the hook is still blocked in its D-Bus call, i.e. from
 * inside the method handler — a moment later the chain is gone.
 */
export function resolveAgent(
  agent: AgentId,
  hookPid: number
): { pid: number; startedAt?: number } {
  if (hookPid <= 0) return { pid: 0 }

  const pid = selectAgentPid(hookPid, adapters[agent].procNames, readStat)
  if (pid <= 0) return { pid: 0 }

  const stat = readStat(pid)
  // Read fresh, never cached: the kernel recomputes btime, and it jitters by
  // about a second across suspend. One small read per hook event.
  const procStat = readFile('/proc/stat')
  if (stat === null || procStat === null) return { pid }

  return { pid, startedAt: agentStartMs(stat, procStat, Date.now()) ?? undefined }
}

export function pidAlive(pid: number): boolean {
  if (pid <= 0) return false
  return GLib.file_test(`/proc/${pid}`, GLib.FileTest.EXISTS)
}

/**
 * Find the window whose owning process is `pid` or one of its ancestors.
 * Deliberately synchronous: the reads are tiny, bounded at 20, and only happen
 * on an explicit user click.
 */
export function findWindowForPid(pid: number): Meta.Window | null {
  const chain = new Set(ancestorPids(pid, readStat))
  if (chain.size === 0) return null

  for (const actor of global.get_window_actors()) {
    const win = actor.get_meta_window()
    if (!win) continue
    const wpid = win.get_pid()
    if (wpid > 0 && chain.has(wpid)) return win
  }
  return null
}

export function activateForPid(pid: number): boolean {
  const win = findWindowForPid(pid)
  if (!win) return false
  Main.activateWindow(win)
  return true
}
