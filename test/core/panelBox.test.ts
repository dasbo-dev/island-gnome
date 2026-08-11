import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { panelBox, PANEL_BOXES } from '../../src/core/panelBox.js'

// GNOME 50 narrowed Main.panel.addToStatusArea's box parameter from a bare
// string to 'left' | 'center' | 'right'. get_string() hands back a string, so
// something has to bridge the two. Doing it with a cast would compile and then
// pass whatever the settings key happened to hold; this narrows by checking.
describe('panelBox', () => {
  for (const box of ['left', 'center', 'right'] as const) {
    it(`passes ${box} through unchanged`, () => {
      expect(panelBox(box)).toBe(box)
    })
  }

  // 'center' rather than an arbitrary pick: it is the gschema default, so an
  // unreadable value lands where a fresh install would.
  it('falls back to the schema default on a value outside the choices', () => {
    expect(panelBox('nonsense')).toBe('center')
    expect(panelBox('')).toBe('center')
    expect(panelBox('LEFT')).toBe('center')
  })

  // The schema's <choices> and this list are the same claim written twice, and
  // nothing else would notice them drifting apart — a choice added to the
  // schema would silently become 'center' here instead of reaching the panel.
  it('accepts exactly the values the gschema allows', () => {
    const xml = readFileSync('schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml', 'utf8')
    const key = xml.slice(xml.indexOf('name="panel-position"'))
    const choices = [...key.slice(0, key.indexOf('</key>')).matchAll(/<choice value="([^"]+)"/g)].map(
      (m) => m[1]
    )
    expect(choices.length).toBeGreaterThan(0)
    expect([...PANEL_BOXES].sort()).toEqual([...choices].sort())
  })
})
