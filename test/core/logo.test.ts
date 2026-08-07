import { describe, it, expect } from 'vitest'
import { LOGO, logoAsset, prefersDark } from '../../src/core/logo.js'

describe('logoAsset', () => {
  it('picks the light-bodied mark for a dark background', () => {
    // logo-dark.svg is the one with the #E9E9EC body. The names describe the
    // theme, not the ink — getting this backwards is invisible on the machine
    // of whoever writes it and invisible on the other theme too.
    expect(logoAsset(true)).toBe(LOGO.dark)
  })

  it('picks the dark-bodied mark for a light background', () => {
    expect(logoAsset(false)).toBe(LOGO.light)
  })

  it('names two different files', () => {
    expect(LOGO.light).not.toBe(LOGO.dark)
  })

  it('returns a path relative to the extension directory', () => {
    // The call sites join this onto extension.path, the way ABOUT.qrAsset is
    // joined. A leading slash would silently resolve to the filesystem root.
    for (const path of [LOGO.light, LOGO.dark]) {
      expect(path.startsWith('/'), `${path} must not be absolute`).toBe(false)
      // build.mjs only copies src/assets into dist; a path outside it ships
      // nothing.
      expect(path).toMatch(/^assets\//)
    }
  })
})

describe('prefersDark', () => {
  it('is false only when the user asked for light', () => {
    expect(prefersDark('prefer-light')).toBe(false)
  })

  it('is true when the user asked for dark', () => {
    expect(prefersDark('prefer-dark')).toBe(true)
  })

  it('treats the unset default as dark', () => {
    // The Shell popup is dark unless the user explicitly asks for light, so
    // 'default' has to select the light-bodied mark.
    expect(prefersDark('default')).toBe(true)
  })

  it('treats an unrecognised value as dark', () => {
    // A future GNOME adding a value should fail toward the common case, not
    // the rare one.
    expect(prefersDark('prefer-sepia')).toBe(true)
    expect(prefersDark('')).toBe(true)
  })
})
