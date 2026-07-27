import GLib from 'gi://GLib'
import type Meta from 'gi://Meta'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import { ancestorPids, parsePpid } from '../core/procParse.js'

function readStat(pid: number): string | null {
  try {
    const [ok, bytes] = GLib.file_get_contents(`/proc/${pid}/stat`)
    if (!ok) return null
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

/**
 * The hook process exits as soon as its D-Bus call returns, so its own pid is
 * useless a moment later. Its parent is the agent process, which lives for the
 * whole session — that is the correct seed for both jump-back ancestry and
 * liveness. Must be called while the hook is still blocked in its call, i.e.
 * from inside the D-Bus method handler.
 */
export function resolveAgentPid(hookPid: number): number {
  if (hookPid <= 0) return 0
  const stat = readStat(hookPid)
  if (stat === null) return 0
  return parsePpid(stat) ?? 0
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
