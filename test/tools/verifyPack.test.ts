import { describe, it, expect } from 'vitest'
import { checkEntries, checkBundleText } from '../../tools/verify-pack.mjs'

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

  // The old predicate matched `.gschema.xml` anywhere in the path, so a
  // gschema at the archive root — not under schemas/ — would silently pass
  // a rule whose label promises "under schemas/". A build that dropped the
  // file into the wrong directory would ship undetected.
  it('rejects an archive whose only gschema XML sits at the root, not under schemas/', () => {
    const misplaced = GOOD.filter((e) => !e.endsWith('.gschema.xml')).concat([
      'org.gnome.shell.extensions.dasbo-island.gschema.xml',
    ])
    const problems = checkEntries(misplaced)
    expect(problems.join('\n')).toContain('schemas/')
  })

  // The old predicate matched any icons/**/*.svg, so an icon nested in a
  // subdirectory — icons/*.svg is meant to be flat — would silently pass a
  // rule meant to require a flat layout. A build that nested icons one level
  // deeper would ship undetected.
  it('rejects an archive whose only SVG sits at icons/sub/foo.svg, not flat under icons/', () => {
    const nested = GOOD.filter((e) => !e.startsWith('icons/') || e === 'icons/').concat([
      'icons/sub/foo.svg',
    ])
    const problems = checkEntries(nested)
    expect(problems.join('\n')).toContain('icons/')
  })

  // DIS-15 final review, finding 3: "at least one icons/*.svg" and "at least
  // one file under assets/" both pass an archive holding only
  // icons/claude.svg and only assets/logo-light.svg — the B3 symptom of
  // mark-less chips for the other agents and a blank About QR. Naming every
  // file the source tree actually has is what closes that gap; the bare
  // "at least one" rules stay in effect underneath (see the tests above) so
  // a wholly missing directory is still caught even when expected is empty.
  const EXPECTED = { icons: ['claude.svg', 'codex.svg', 'antigravity.svg'], assets: ['qr-code.png'] }

  it('passes when every expected icon and asset is present', () => {
    expect(checkEntries(GOOD, EXPECTED)).toEqual([])
  })

  it('rejects an archive missing one named icon and names it in the message', () => {
    const missingCodex = GOOD.filter((e) => e !== 'icons/codex.svg')
    const problems = checkEntries(missingCodex, EXPECTED)
    expect(problems.join('\n')).toContain('icons/codex.svg')
  })

  it('rejects an archive missing one named asset and names it in the message', () => {
    const missingQr = GOOD.filter((e) => e !== 'assets/qr-code.png')
    const problems = checkEntries(missingQr, EXPECTED)
    expect(problems.join('\n')).toContain('assets/qr-code.png')
  })
})

// The defect this guards: make pack strips the `.map` file from the archive,
// but esbuild only omits the `//# sourceMappingURL=` comment it writes into
// the bundle when told `sourcemap: false`, gated on DASBO_PACK in build.mjs.
// If that env var ever fails to reach the build, the archive holds no `.map`
// entries — checkEntries sees nothing wrong — while the bundle still points
// at a file that shipped nowhere. checkEntries alone cannot catch this: it
// only ever sees the entry list, never bundle contents.
describe('checkBundleText', () => {
  it('passes a bundle with no sourcemap comment', () => {
    expect(checkBundleText('extension.js', 'var x = 1;\n')).toEqual([])
  })

  it('rejects a bundle carrying a dangling sourceMappingURL comment', () => {
    const text = 'var x = 1;\n//# sourceMappingURL=extension.js.map\n'
    const problems = checkBundleText('extension.js', text)
    expect(problems).toHaveLength(1)
  })

  it('names the offending bundle in the message', () => {
    const text = '//# sourceMappingURL=prefs.js.map\n'
    expect(checkBundleText('prefs.js', text)[0]).toContain('prefs.js')
  })
})
