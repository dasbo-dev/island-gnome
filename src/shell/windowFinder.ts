import GLib from 'gi://GLib'
import type Meta from 'gi://Meta'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import { adapters } from '../core/adapters/index.js'
import { agentStartMs, ancestorPids, selectAgentPid } from '../core/procParse.js'
import { SessionWindows, chooseWindow } from '../core/windowPick.js'
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

function readCmdline(pid: number): string | null {
  return readFile(`/proc/${pid}/cmdline`)
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

  const pid = selectAgentPid(hookPid, adapters[agent].procNames, readStat, readCmdline)
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

const sessionWindows = new SessionWindows<Meta.Window>()

/**
 * Record the window a session was started in, so Jump can return to that one
 * rather than to whichever window happens to share the terminal's process.
 *
 * gnome-terminal serves every window and tab from one process, so the pid the
 * ancestry ends at owns all of them and the pid scan below cannot tell them
 * apart. The focused window at the moment a session starts can: the user has
 * just typed the agent's name into it.
 *
 * Only ever called for `session-start`, never for later events. On any other
 * event the focused window is wherever the user has since wandered — and for a
 * terminal that hosts several agents, that window's pid is in *every* one of
 * their chains, so the check below would happily record the wrong one.
 *
 * That check is still worth making here: a session started from a launcher, a
 * script or another workspace leaves the focus somewhere unrelated, and
 * remembering that is worse than remembering nothing. Nothing recorded simply
 * leaves the old pid scan in charge.
 */
export function rememberSessionWindow(pid: number): void {
  if (pid <= 0) return
  const win = global.display.focus_window
  if (!win) return
  const wpid = win.get_pid()
  if (wpid <= 0) return
  if (!ancestorPids(pid, readStat).includes(wpid)) return
  // Cheap here and nowhere else: sessions start rarely, and this is the one
  // moment the map is known to be about to grow.
  sessionWindows.prune(pidAlive)
  sessionWindows.remember(pid, win)
}

/** Drop every remembered window. Called from the reaper and at teardown. */
export function pruneSessionWindows(): void {
  sessionWindows.prune(pidAlive)
}

export function forgetSessionWindows(): void {
  sessionWindows.clear()
}

/**
 * Find the window to raise for `pid`: the one its session started in if that
 * is still open, otherwise the first whose owning process is `pid` or one of
 * its ancestors.
 * Deliberately synchronous: the reads are tiny, bounded at 20, and only happen
 * on an explicit user click.
 */
export function findWindowForPid(pid: number): Meta.Window | null {
  const chain = ancestorPids(pid, readStat)
  if (chain.length === 0) return null

  const windows: Meta.Window[] = []
  for (const actor of global.get_window_actors()) {
    const win = actor.get_meta_window()
    if (win) windows.push(win)
  }

  // A closed window is gone from that list, which is exactly the test
  // chooseWindow makes before trusting what was remembered.
  return chooseWindow(chain, windows, (w) => w.get_pid(), sessionWindows.recall(pid))
}

export function activateForPid(pid: number): boolean {
  const win = findWindowForPid(pid)
  if (!win) return false
  Main.activateWindow(win)
  return true
}
