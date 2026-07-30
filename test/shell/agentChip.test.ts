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

  it('never re-agents itself: presentation changes, identity does not', () => {
    // sessionKey is `${agent}:${sessionId}` (core/types.ts), so a row's agent
    // is fixed for the row's whole life, and setMode is not a hole in that:
    // it changes what the chip shows, never which agent it names. No method
    // may take an AgentId or a Session — the constructor, which does take an
    // AgentId, is excluded explicitly rather than by the absence of a
    // return-type annotation, which a method could simply omit and still
    // slip past.
    expect(src).not.toMatch(/\b(update|setAgent)\s*\(/)
    expect(src).not.toMatch(/^\s*(?!constructor)\w+\s*\([^)]*\b(AgentId|Session)\b/m)
  })

  it('asks core which parts to show, rather than reading the mode itself', () => {
    // One decision site, testable under Node. A branch on the mode string
    // here would be a second one, untestable and free to disagree.
    expect(src).toContain('chipParts')
    expect(src).not.toMatch(/'logo'|'logo-name'|'name'/)
  })

  it('is handed its mode and never reaches for settings', () => {
    // Island is the only widget in src/shell/ that reads settings. A chip
    // that connected to Gio.Settings would also owe a disconnect per row.
    expect(src).not.toContain('get_string')
    expect(src).not.toContain('Gio.Settings')
  })

  it('keeps both children so a mode change is a visibility toggle', () => {
    // Anchored to setMode's own body, and to each field by name, so that
    // swapping the two assignments (or moving them into the constructor,
    // where a mode change could never reach them again) fails here instead
    // of passing on a looser "these substrings appear somewhere" check.
    const setModeBody = /setMode\s*\([^)]*\)\s*:\s*void\s*\{([\s\S]*?)\n {4}\}/.exec(src)?.[1] ?? ''
    expect(setModeBody, 'no setMode body found in agentChip.ts').not.toBe('')
    expect(setModeBody).toMatch(/_icon\.visible\s*=\s*parts\.icon/)
    expect(setModeBody).toMatch(/_label\.visible\s*=\s*parts\.label/)
  })
})

describe('the chip on the row', () => {
  const row = readFileSync('src/shell/sessionRow.ts', 'utf8')
  const island = readFileSync('src/shell/island.ts', 'utf8')
  const extension = readFileSync('src/extension.ts', 'utf8')
  const css = readFileSync('stylesheet.css', 'utf8')
  // Hoisted rather than re-extracted per test: every test below that needs
  // the handler's own body (as opposed to island.ts as a whole) shares this
  // one extraction, so there is exactly one place that defines what "the
  // handler" means.
  const handler = /connect\('changed::agent-chip-display'[\s\S]*?\}\)/.exec(island)?.[0] ?? ''

  it('leads the title line: arrow, then chip, then project name', () => {
    // Order is the design decision, not an accident — the row is meant to read
    // as one phrase ("Claude, on dasbo-island"), which is also why the project
    // names no longer align down the popup's left edge.
    const order = /titleRow\.add_child\(this\._expander\)\s*\n\s*titleRow\.add_child\(this\._chip\)\s*\n\s*titleRow\.add_child\(this\._project\)/
    expect(row).toMatch(order)
  })

  it('takes a new display mode straight to the live rows', () => {
    // Checks the handler's own body, not merely that the two strings appear
    // somewhere in island.ts — a rebuild that dropped both key reads (the
    // constructor's and the handler's) but kept the surrounding scaffolding
    // would otherwise still satisfy a looser version of this test while
    // leaving _chipMode pinned at its initialiser forever.
    expect(row).toMatch(/setChipMode\s*\(/)
    expect(handler, 'no changed::agent-chip-display handler in island.ts').not.toBe('')
    expect(handler).toContain("get_string('agent-chip-display')")
    expect(handler).toMatch(/for \(const row of this\._rows\.values\(\)\) row\.setChipMode\(/)
    expect(island).toMatch(/_chipMode = settings\.settings_schema\.has_key\('agent-chip-display'\)/)
  })

  it('does not rebuild the rows to change the chip', () => {
    // Rows are reused across rebuilds so that permission controls, question
    // panels and task lists survive a refresh. Tearing one down mid-decision
    // would destroy the PermissionControls whose closures are the only path to
    // resolving a pending request.
    expect(handler, 'no changed::agent-chip-display handler in island.ts').not.toBe('')
    expect(handler).not.toContain('_rebuildRows')
    // refresh() calls _rebuildRows() on its first line, so a handler that
    // called refresh() instead would rebuild just as destructively while
    // still passing the check above.
    expect(handler).not.toMatch(/\brefresh\(/)
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
