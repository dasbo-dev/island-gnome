import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// These widgets are all can_focus: true, so they are in the tab order, and
// their only text is a word with no object or a geometric shape. A source scan
// is the available check — src/shell needs a running GNOME Shell.
describe('every focusable control in the popup has a name', () => {
  it('says what Always actually does, in the label and to a screen reader', () => {
    const src = readFileSync('src/shell/permissionRow.ts', 'utf8')
    expect(src).toContain("'Always allow'")
    expect(src).toContain('Always allow this tool for this session')
    expect(src).not.toMatch(/mk\(\s*'Always'/)
  })

  it('names all three permission buttons distinctly', () => {
    const src = readFileSync('src/shell/permissionRow.ts', 'utf8')
    for (const name of ['Allow this tool once', 'Deny this tool', 'Always allow this tool for this session']) {
      expect(src, name).toContain(name)
    }
  })

  it('says where Jump goes', () => {
    const src = readFileSync('src/shell/sessionRow.ts', 'utf8')
    expect(src).toContain('Focus this session')
    expect(src).toContain('accessible_name')
  })

  it('names the expander in both of its states', () => {
    const src = readFileSync('src/shell/sessionRow.ts', 'utf8')
    expect(src).toContain("'Show details'")
    expect(src).toContain("'Hide details'")
  })
})
