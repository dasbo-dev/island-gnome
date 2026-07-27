import GLib from 'gi://GLib'
import type Meta from 'gi://Meta'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import { ancestorPids } from '../core/procParse.js'

function readStat(pid: number): string | null {
  try {
    const [ok, bytes] = GLib.file_get_contents(`/proc/${pid}/stat`)
    if (!ok) return null
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
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
