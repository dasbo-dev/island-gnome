import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { chipParts } from '../../src/core/chipDisplay.js'

describe('chipParts', () => {
  it('shows the mark alone in logo mode', () => {
    expect(chipParts('logo', true)).toEqual({ icon: true, label: false })
  })

  it('falls back to the name when logo mode has no mark to draw', () => {
    // The same fail-open rule agentIcon.ts applies by returning null rather
    // than throwing: a missing decoration must not cost the user the ability
    // to tell one row from another.
    expect(chipParts('logo', false)).toEqual({ icon: false, label: true })
  })

  it('shows both in logo-name mode', () => {
    expect(chipParts('logo-name', true)).toEqual({ icon: true, label: true })
  })

  it('drops to the name alone when logo-name has no mark', () => {
    expect(chipParts('logo-name', false)).toEqual({ icon: false, label: true })
  })

  it('shows the name alone in name mode, mark or no mark', () => {
    expect(chipParts('name', true)).toEqual({ icon: false, label: true })
    expect(chipParts('name', false)).toEqual({ icon: false, label: true })
  })

  it('reads an unrecognised mode as logo-name', () => {
    // A newer release could add a fourth value to the schema; an older
    // installed copy reading it must not throw inside a row build, because an
    // exception there takes the whole popup rebuild with it.
    expect(chipParts('mark-and-sigil', true)).toEqual(chipParts('logo-name', true))
    expect(chipParts('', false)).toEqual(chipParts('logo-name', false))
  })

  it('never leaves the chip blank', () => {
    for (const mode of ['logo', 'logo-name', 'name', 'nonsense']) {
      for (const hasIcon of [true, false]) {
        const parts = chipParts(mode, hasIcon)
        expect(parts.icon || parts.label, `${mode}/${hasIcon}`).toBe(true)
      }
    }
  })

  it('never asks for an icon there is no file for', () => {
    for (const mode of ['logo', 'logo-name', 'name', 'nonsense']) {
      expect(chipParts(mode, false).icon, mode).toBe(false)
    }
  })

  it('recognises every choice the gschema declares', () => {
    // Nothing but this test ties core's mode list to the gschema's. A fourth
    // <choice> added there (and to prefs' chipOrder) would pass every other
    // test in this file while chipParts silently mapped it to 'logo-name' —
    // this is the one place that would notice.
    const gschema = readFileSync(
      'schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml',
      'utf8'
    )
    const keyBlock = /<key name="agent-chip-display"[^>]*>([\s\S]*?)<\/key>/.exec(gschema)?.[1] ?? ''
    expect(keyBlock, 'agent-chip-display key not found in the gschema').not.toBe('')
    const choices = [...keyBlock.matchAll(/<choice value="([^"]+)"\s*\/>/g)].map((m) => m[1] ?? '')
    expect(choices.length, 'no <choice> values found for agent-chip-display').toBeGreaterThan(0)

    // A mode chipParts has certainly never heard of. Any gschema choice whose
    // result is identical to this one, for both icon-present and icon-absent,
    // is being silently folded into the 'logo-name' fallback rather than
    // genuinely recognised.
    const JUNK_MODE = 'a-mode-chipparts-does-not-recognise'
    for (const choice of choices) {
      if (choice === 'logo-name') continue
      const recognised = [true, false].some(
        (hasIcon) =>
          JSON.stringify(chipParts(choice, hasIcon)) !== JSON.stringify(chipParts(JUNK_MODE, hasIcon))
      )
      expect(recognised, `chipParts does not distinguish gschema choice "${choice}" from junk`).toBe(
        true
      )
    }
  })
})
