import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('AgentChip', () => {
  const src = readFileSync('src/shell/agentChip.ts', 'utf8')

  it('carries the short name, not the display name', () => {
    expect(src).toContain('shortName')
    expect(src).not.toContain('displayName')
  })

  it('omits the icon rather than handing St a null gicon', () => {
    expect(src).toMatch(/if\s*\(gicon\)/)
  })

  it('sets the icon opacity on the actor, not in CSS', () => {
    // Pinned defensively, not as a fix for anything known to dim this icon:
    // St's CSS engine does not reliably honour `opacity`, so the value is
    // never expressed there. It is *not* the row's `:insensitive` state this
    // guards — that is a `color` problem, and `color` cannot tint a
    // full-colour Gio.FileIcon anyway. See agentChip.ts's own comment, and
    // sessionRow.ts's _shellTotal / taskList.ts for the cases that pin a
    // value other than full because they want dimming CSS will not deliver.
    expect(src).toMatch(/\.opacity\s*=\s*255/)
  })

  it('has no update method, because a row never changes agent', () => {
    // sessionKey is `${agent}:${sessionId}` (core/types.ts): a row's agent is
    // fixed for the row's whole life. An update path here would model a
    // transition that cannot happen, and invite a caller to rely on it.
    expect(src).not.toMatch(/\bupdate\s*\(/)
  })
})

describe('the chip on the row', () => {
  const row = readFileSync('src/shell/sessionRow.ts', 'utf8')
  const island = readFileSync('src/shell/island.ts', 'utf8')
  const extension = readFileSync('src/extension.ts', 'utf8')
  const css = readFileSync('stylesheet.css', 'utf8')

  it('leads the title line: arrow, then chip, then project name', () => {
    // Order is the design decision, not an accident — the row is meant to read
    // as one phrase ("Claude, on dasbo-island"), which is also why the project
    // names no longer align down the popup's left edge.
    const order = /titleRow\.add_child\(this\._expander\)\s*\n\s*titleRow\.add_child\(chip\)\s*\n\s*titleRow\.add_child\(this\._project\)/
    expect(row).toMatch(order)
  })

  it('gets the icon directory from the extension, not from a guess', () => {
    expect(extension).toMatch(/new Island\(this\._store,\s*settings,\s*this\.path,\s*this\._sound\)/)
    expect(island).toMatch(/iconBase/)
    expect(row).toMatch(/iconBase/)
  })

  it('styles the chip as a tag, subordinate to the project name', () => {
    expect(css).toMatch(/\.dasbo-agent-chip\s*\{[^}]*border-radius/)
    // 0.85em and normal weight against .dasbo-row-project's bold: the row's
    // title has to keep winning the eye.
    expect(css).toMatch(/\.dasbo-agent-chip-label\s*\{[^}]*font-size:\s*0\.85em/)
  })
})
