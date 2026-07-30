import { describe, it, expect } from 'vitest'
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
})
