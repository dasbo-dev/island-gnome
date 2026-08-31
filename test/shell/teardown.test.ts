import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// The suite cannot execute any of this: src/extension.ts imports gi://GLib and
// resource:///org/gnome/shell/..., neither of which vitest can resolve. So the
// shape of disable() is asserted against the source as text, the same way
// test/shell/sound.test.ts already reads it.
const extension = readFileSync('src/extension.ts', 'utf8')
const disable = extension.slice(extension.indexOf('disable() {'))

describe('disable()', () => {
  it('wraps nothing in try/catch, because none of its steps throw', () => {
    // GNOME best practices #3. GLib.Source.remove, unexport(), destroy() and
    // forgetSessionWindows() do not throw, and resolveAllFallthrough() already
    // catches per consumer callback in core/permissions.ts. The wrapper this
    // replaces only hid the teardown order it was written to protect.
    expect(disable).not.toContain('try {')
    expect(extension).not.toContain('const safely =')
  })

  it('destroys the island before it drains held permissions', () => {
    // Draining settles held requests, a settled request can produce a 'done'
    // diff, and Island.refresh() answers that with play('done') — so an island
    // still listening at that point makes the extension chime on its way out.
    // Destroying it first drops the store subscription and the tick timer,
    // which makes that path unreachable instead of suppressed by a flag.
    expect(disable.indexOf('this._island?.destroy()')).toBeLessThan(
      disable.indexOf('this._permissions?.resolveAllFallthrough()')
    )
  })

  it('tears down in the order the rest of the file assumes', () => {
    const at = (needle: string) => {
      const i = disable.indexOf(needle)
      expect(i, `disable() lost ${needle}`).toBeGreaterThan(-1)
      return i
    }
    const order = [
      'GLib.Source.remove(this._reaperId)',
      'this._service?.unexport()',
      'this._transcripts?.destroy()',
      'forgetSessionWindows()',
      'this._island?.destroy()',
      'this._permissions?.resolveAllFallthrough()',
      'this._sound?.destroy()',
      'this._settingsIds',
    ]
    for (let i = 1; i < order.length; i++) {
      const previous = order[i - 1] as string
      const next = order[i] as string
      expect(at(previous), `${previous} must come before ${next}`).toBeLessThan(at(next))
    }
  })

  it('releases every field enable() sets', () => {
    // The count is the point: a step deleted during a refactor is invisible
    // until the next enable() adds a second panel button.
    for (const field of [
      '_island',
      '_store',
      '_permissions',
      '_service',
      '_settings',
      '_sound',
      '_transcripts',
      '_unwatchStore',
    ]) {
      expect(disable, `disable() never nulls ${field}`).toContain(`this.${field} = null`)
    }
    expect(disable).toContain('this._reaperId = 0')
    expect(disable).toContain('this._settingsIds = []')
  })
})
