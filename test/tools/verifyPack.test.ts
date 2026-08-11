import { describe, it, expect } from 'vitest'
import { checkEntries } from '../../tools/verify-pack.mjs'

// The stale archive that prompted this file held nine entries and neither
// icons/ nor assets/. Both are loaded by absolute path at runtime and both
// fail silently when missing — a mark-less agent chip and a blank About QR,
// with nothing logged. build.mjs was correct the whole time, so a test that
// greps build.mjs would have passed on the broken artefact. This checks the
// archive listing itself.
const GOOD = [
  'metadata.json',
  'extension.js',
  'prefs.js',
  'stylesheet.css',
  'schemas/',
  'schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml',
  'hooks/',
  'hooks/dasbo-hook',
  'icons/',
  'icons/claude.svg',
  'icons/codex.svg',
  'icons/antigravity.svg',
  'assets/',
  'assets/qr-code.png',
]

describe('checkEntries', () => {
  it('passes an archive holding everything and nothing extra', () => {
    expect(checkEntries(GOOD)).toEqual([])
  })

  it('rejects the archive that actually shipped: no icons, no assets', () => {
    const stale = GOOD.filter((e) => !e.startsWith('icons/') && !e.startsWith('assets/'))
    const problems = checkEntries(stale)
    expect(problems.join('\n')).toContain('icons/')
    expect(problems.join('\n')).toContain('assets/')
  })

  it('reports every violation at once, not just the first', () => {
    // A guard against a silent failure is only as good as its message: a
    // one-at-a-time check turns one broken pack into four rebuild cycles.
    const bad = GOOD.filter((e) => !e.startsWith('icons/') && !e.startsWith('assets/')).concat([
      'extension.js.map',
      'schemas/gschemas.compiled',
    ])
    expect(checkEntries(bad).length).toBeGreaterThanOrEqual(4)
  })

  it('rejects an archive missing the agent icons', () => {
    expect(checkEntries(GOOD.filter((e) => !e.startsWith('icons/')))).toHaveLength(1)
  })

  it('rejects an archive missing the About assets', () => {
    expect(checkEntries(GOOD.filter((e) => !e.startsWith('assets/')))).toHaveLength(1)
  })

  it('rejects a sourcemap, which make pack excludes and the bundles still name', () => {
    expect(checkEntries([...GOOD, 'extension.js.map'])).toHaveLength(1)
  })

  // EGO compiles schemas itself; the requirement is the XML. The compiled
  // blob is generated data under the "no unnecessary files" rule.
  it('rejects the compiled schema blob while keeping the XML required', () => {
    expect(checkEntries([...GOOD, 'schemas/gschemas.compiled'])).toHaveLength(1)
    expect(checkEntries(GOOD.filter((e) => !e.endsWith('.gschema.xml')))).toHaveLength(1)
  })

  it('rejects an archive missing the hook the whole extension depends on', () => {
    expect(checkEntries(GOOD.filter((e) => e !== 'hooks/dasbo-hook'))).toHaveLength(1)
  })

  it('rejects an archive missing metadata.json, extension.js, prefs.js or the stylesheet', () => {
    for (const required of ['metadata.json', 'extension.js', 'prefs.js', 'stylesheet.css']) {
      expect(checkEntries(GOOD.filter((e) => e !== required)), `${required} was not required`).toHaveLength(1)
    }
  })

  it('names the offending entry in the message, not just the rule', () => {
    expect(checkEntries([...GOOD, 'extension.js.map'])[0]).toContain('extension.js.map')
  })
})
