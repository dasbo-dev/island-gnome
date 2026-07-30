import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Jump used to match a window on the agent's process ancestry alone. That is
// ambiguous on every terminal that serves all its windows from one process —
// gnome-terminal, kgx, ptyxis, konsole, kitty in single-instance mode — where
// the chain ends at a pid every window reports, so the first window listed
// won rather than the agent's.
//
// The tie-break is the window focused when the session started. These are
// source assertions, because the pieces they guard can only run inside the
// compositor: `global.display.focus_window`, `Meta.Window.get_pid` and the
// D-Bus method that feeds them. The decision itself is pure and tested for
// real in test/core/windowPick.test.ts.
describe('Jump raises the window its session started in', () => {
  const finder = readFileSync('src/shell/windowFinder.ts', 'utf8')
  const service = readFileSync('src/dbus/service.ts', 'utf8')
  const extension = readFileSync('src/extension.ts', 'utf8')

  it('picks the window through chooseWindow, not a first-match loop', () => {
    expect(finder).toMatch(/return chooseWindow\(/)
    // The old loop returned from inside the actor walk; anything of that shape
    // would silently take precedence over the remembered window again.
    expect(finder).not.toMatch(/for \(const actor of global\.get_window_actors\(\)\)[\s\S]{0,400}?return win\b/)
  })

  it('offers the remembered window to that decision', () => {
    expect(finder).toMatch(/chooseWindow\([\s\S]{0,200}?sessionWindows\.recall\(pid\)/)
  })

  it('records only the focused window that belongs to the agent', () => {
    // Without the ancestry test, a session started from a launcher or another
    // workspace would pin Jump to whatever window the user happened to be in.
    expect(finder).toMatch(/global\.display\.focus_window/)
    expect(finder).toMatch(/if \(!ancestorPids\(pid, readStat\)\.includes\(wpid\)\) return/)
  })

  it('remembers on session-start and on no other event', () => {
    // Any later event's focus is wherever the user has since wandered, and for
    // a terminal hosting several agents that window is in every chain — so a
    // broader trigger would record the wrong window for the wrong session.
    expect(service).toMatch(/if \(e\.kind === 'session-start'\) rememberSessionWindow\(e\.pid\)/)
    expect(service.match(/rememberSessionWindow\(/g)).toHaveLength(1)
  })

  it('lets the reaper drop windows whose agent has gone', () => {
    expect(extension).toMatch(/pruneSessionWindows\(\)/)
  })

  it('holds no window references once the extension is disabled', () => {
    expect(extension).toMatch(/forgetSessionWindows\(\)/)
  })
})
