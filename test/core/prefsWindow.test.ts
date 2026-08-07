import { describe, it, expect } from 'vitest'
import { PREFS_WINDOW } from '../../src/core/prefsWindow.js'

// The window this describes is built in src/prefs.ts, which imports gi:// and
// so cannot be reached from here — the same wall test/core/about.test.ts
// exists on the other side of. What is checkable is the number itself, and
// the number is the whole fix: too small and the About page's Support group
// goes back under the fold, which is the bug.
describe('the preferences window size', () => {
  it('is a whole number of pixels in both dimensions', () => {
    // A fractional or negative size is not a size GTK can honour, and
    // set_default_size would silently take the truncated value.
    for (const [key, value] of Object.entries(PREFS_WINDOW)) {
      expect(Number.isInteger(value), `${key} must be a whole number`).toBe(true)
      expect(value, `${key} must be positive`).toBeGreaterThan(0)
    }
  })

  it('is tall enough for the About page, Support group included', () => {
    // The About page measures roughly 560-600px once the banner is trimmed.
    // Below 640 the Support group returns to living below the fold, which is
    // precisely what this constant exists to prevent.
    expect(PREFS_WINDOW.height).toBeGreaterThanOrEqual(640)
  })

  it('stays a height a laptop can actually give it', () => {
    // Above this, GTK's clamp against the monitor work area decides the real
    // height and the constant stops describing what the user gets.
    expect(PREFS_WINDOW.height).toBeLessThanOrEqual(900)
  })

  it("is wider than libadwaita's own minimum for a preferences window", () => {
    // AdwPreferencesWindow requests 360px; a default narrower than that would
    // be ignored, which is a constant that lies.
    expect(PREFS_WINDOW.width).toBeGreaterThanOrEqual(360)
  })
})
