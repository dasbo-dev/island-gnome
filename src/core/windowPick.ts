/**
 * Which window Jump should raise.
 *
 * A pid alone cannot answer that. gnome-terminal — like kgx, ptyxis, konsole
 * and kitty in single-instance mode — serves every window and every tab from
 * ONE process, so an agent's ancestry ends at a pid that owns all of them and
 * every one of those windows reports it. Matching on the pid alone therefore
 * raised whichever window the compositor happened to list first, which is the
 * agent's window only by luck.
 *
 * The tie is broken by memory instead: the window the user was in when the
 * session started is recorded (see `rememberSessionWindow` in the shell layer)
 * and preferred here. The pid scan stays as the fallback, because a remembered
 * window can close, and a session can predate the extension being enabled.
 *
 * Kept pure and generic over the window type — the shell layer supplies
 * Meta.Windows and a pid accessor — so all of it is testable without a
 * compositor.
 */

/**
 * The window to raise for an agent whose ancestry is `chainPids`, or null when
 * none of the given windows belongs to it.
 *
 * `remembered` wins only if it is still open (still present in `windows`) and
 * still owned by a process in the chain — a pid the kernel has since recycled,
 * or a session resumed under a different terminal, must not keep raising the
 * window it used to mean.
 */
export function chooseWindow<W>(
  chainPids: readonly number[],
  windows: readonly W[],
  pidOf: (w: W) => number,
  remembered: W | null
): W | null {
  const chain = new Set(chainPids)
  if (chain.size === 0) return null

  // 0 is what the shell reports for a window whose owner it cannot read, and
  // an unresolved agent pid is 0 too — so the two must never meet as a match.
  const owned = (w: W) => {
    const pid = pidOf(w)
    return pid > 0 && chain.has(pid)
  }

  if (remembered !== null && windows.includes(remembered) && owned(remembered)) return remembered

  for (const w of windows) {
    if (owned(w)) return w
  }
  return null
}

/**
 * The window each agent process was started in, keyed by that pid.
 *
 * Bounded for the same reason SessionStore's maps are: entries are minted from
 * events a peer on the session bus can send. A few hundred sits far above any
 * real count of live agent processes, and the oldest goes first, so the map
 * cannot grow without limit between prunes.
 */
const MAX_REMEMBERED = 300

export class SessionWindows<W> {
  private windows = new Map<number, W>()

  /** The cap, exposed so a test can pin the eviction behaviour to it. */
  get limit(): number {
    return MAX_REMEMBERED
  }

  get size(): number {
    return this.windows.size
  }

  /**
   * Record `win` as the window of the process `pid`. Re-remembering a pid
   * replaces the entry *and* makes it the newest, so eviction drops the
   * process nobody has started a session in for longest.
   */
  remember(pid: number, win: W): void {
    // 0 means "the agent could not be identified", which is not a process.
    if (pid <= 0) return
    this.windows.delete(pid)
    this.windows.set(pid, win)
    while (this.windows.size > MAX_REMEMBERED) {
      // Map iteration is insertion order, so this is the oldest entry.
      const oldest = this.windows.keys().next()
      if (oldest.done) break
      this.windows.delete(oldest.value)
    }
  }

  recall(pid: number): W | null {
    if (pid <= 0) return null
    return this.windows.get(pid) ?? null
  }

  /**
   * Drop every entry whose process is gone. `alive` is injected so this stays
   * free of any filesystem dependency, the way `SessionStore.reap` is.
   */
  prune(alive: (pid: number) => boolean): void {
    for (const pid of [...this.windows.keys()]) {
      if (!alive(pid)) this.windows.delete(pid)
    }
  }

  /** Used at teardown: a disabled extension must hold no window references. */
  clear(): void {
    this.windows.clear()
  }
}
