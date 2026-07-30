import { describe, it, expect } from 'vitest'
import { SessionWindows, chooseWindow } from '../../src/core/windowPick.js'

/**
 * A terminal window as far as this module is concerned: something with an
 * owning pid. The real one is a Meta.Window; the pid is read through an
 * injected accessor so nothing here has to know that.
 */
interface FakeWindow {
  name: string
  pid: number
}

const pidOf = (w: FakeWindow) => w.pid

// The shape that made Jump wrong: gnome-terminal (and kgx, ptyxis, konsole,
// kitty in single-instance mode) serves every window from ONE process, so the
// agent's ancestry ends at a pid that owns all of them.
const SERVER = 8208
const chain = [1428104, 294756, SERVER]
const other = { name: 'other', pid: SERVER }
const agents = { name: 'agent', pid: SERVER }

describe('chooseWindow', () => {
  it('prefers the remembered window over another window of the same process', () => {
    expect(chooseWindow(chain, [other, agents], pidOf, agents)).toBe(agents)
  })

  it('falls back to the first window in the chain when nothing was remembered', () => {
    expect(chooseWindow(chain, [other, agents], pidOf, null)).toBe(other)
  })

  it('ignores a remembered window that has since closed', () => {
    expect(chooseWindow(chain, [other], pidOf, agents)).toBe(other)
  })

  it('ignores a remembered window whose process is no longer in the chain', () => {
    // The pid was recycled, or the session was resumed under a terminal that
    // has nothing to do with the one this window belongs to.
    const stale = { name: 'stale', pid: 4242 }
    expect(chooseWindow(chain, [stale, other], pidOf, stale)).toBe(other)
  })

  it('matches a window owned by the agent process itself', () => {
    // Terminals that fork per window, and agents with a window of their own.
    const own = { name: 'own', pid: 1428104 }
    expect(chooseWindow(chain, [own], pidOf, null)).toBe(own)
  })

  it('returns null when no window belongs to the chain', () => {
    expect(chooseWindow(chain, [{ name: 'browser', pid: 999 }], pidOf, null)).toBeNull()
  })

  it('returns null for an empty chain, even with a remembered window', () => {
    // An unresolved pid: ancestorPids gives nothing, so nothing can be trusted.
    expect(chooseWindow([], [agents], pidOf, agents)).toBeNull()
  })

  it('never matches a window with no owning pid', () => {
    // Meta.Window.get_pid returns 0 for a window whose pid the shell cannot
    // read, and 0 must not be treated as "belongs to everything".
    expect(chooseWindow([0, SERVER], [{ name: 'pidless', pid: 0 }], pidOf, null)).toBeNull()
  })
})

describe('SessionWindows', () => {
  it('recalls the window remembered for a pid', () => {
    const mem = new SessionWindows<FakeWindow>()
    mem.remember(1428104, agents)
    expect(mem.recall(1428104)).toBe(agents)
  })

  it('has nothing to recall for a pid it never saw', () => {
    const mem = new SessionWindows<FakeWindow>()
    expect(mem.recall(1428104)).toBeNull()
  })

  it('replaces the window when a pid is remembered again', () => {
    // `claude --resume` reuses a session id under a new process, and a new
    // session start in the same process is a new window's worth of truth.
    const mem = new SessionWindows<FakeWindow>()
    mem.remember(1428104, other)
    mem.remember(1428104, agents)
    expect(mem.recall(1428104)).toBe(agents)
  })

  it('refuses an unresolved pid, which identifies no process', () => {
    const mem = new SessionWindows<FakeWindow>()
    mem.remember(0, agents)
    expect(mem.recall(0)).toBeNull()
    expect(mem.size).toBe(0)
  })

  it('drops entries whose process has died', () => {
    const mem = new SessionWindows<FakeWindow>()
    mem.remember(1, other)
    mem.remember(2, agents)
    mem.prune((pid) => pid === 2)
    expect(mem.recall(1)).toBeNull()
    expect(mem.recall(2)).toBe(agents)
  })

  it('forgets everything on demand, so a disabled extension holds no windows', () => {
    const mem = new SessionWindows<FakeWindow>()
    mem.remember(1, other)
    mem.clear()
    expect(mem.size).toBe(0)
  })

  it('is bounded, evicting the oldest entry first', () => {
    const mem = new SessionWindows<FakeWindow>()
    for (let pid = 1; pid <= mem.limit + 5; pid++) mem.remember(pid, { name: `w${pid}`, pid })
    expect(mem.size).toBe(mem.limit)
    expect(mem.recall(1)).toBeNull()
    expect(mem.recall(mem.limit + 5)?.name).toBe(`w${mem.limit + 5}`)
  })
})
