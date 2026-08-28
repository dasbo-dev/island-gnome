import { describe, it, expect } from 'vitest'
import { checkEntries, checkBundleText, checkModes } from '../../tools/verify-pack.mjs'

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

// EGO-P-005 reads any packaged file that is executable and has neither a .js
// nor a .sh suffix as a bundled binary — an error-severity finding, the only
// one this archive can carry. hooks/dasbo-hook is an extensionless GJS
// script, so it trips that rule the moment it ships 755. Nothing execs the
// packaged copy: preferences writes every hook command as `gjs -m <path>`
// (src/core/install/plan.ts), and make install chmods the installed copy.
// build.mjs drops the bit; this is what stops an edit there from putting it
// back unnoticed.
const LISTING = [
  'Archive:  dasbo-island@ayubaswad.gmail.com.shell-extension.zip',
  'Zip file size: 159135 bytes, number of entries: 16',
  '-rw-rw-r--  3.0 unx      934 tx defN 26-Aug-28 09:28 metadata.json',
  '-rw-rw-r--  3.0 unx   134571 tx defN 26-Aug-28 09:28 extension.js',
  'drwxrwxr-x  3.0 unx        0 bx stor 26-Aug-28 09:28 hooks/',
  '-rw-rw-r--  3.0 unx     3443 tx defN 26-Aug-28 09:28 hooks/dasbo-hook',
  '16 files, 296481 bytes uncompressed, 156545 bytes compressed:  47.2%',
].join('\n')

describe('checkModes', () => {
  it('passes a listing where nothing but the directories is executable', () => {
    expect(checkModes(LISTING)).toEqual([])
  })

  it('rejects the archive that ships an executable hook', () => {
    const executable = LISTING.replace(
      '-rw-rw-r--  3.0 unx     3443 tx defN 26-Aug-28 09:28 hooks/dasbo-hook',
      '-rwxrwxr-x  3.0 unx     3443 tx defN 26-Aug-28 09:28 hooks/dasbo-hook'
    )
    expect(checkModes(executable)).toHaveLength(1)
  })

  it('names the offending entry in the message, not just the rule', () => {
    const executable = LISTING.replace('-rw-rw-r--  3.0 unx     3443', '-rwxrwxr-x  3.0 unx     3443')
    expect(checkModes(executable)[0]).toContain('hooks/dasbo-hook')
  })

  // A directory with no execute bit cannot be entered, so every archive has
  // them and a rule that flagged them would fire on every pack forever.
  it('exempts directory entries, which must be executable to be traversable', () => {
    const dirsOnly = [
      'drwxrwxr-x  3.0 unx        0 bx stor 26-Aug-28 09:28 hooks/',
      'drwxrwxr-x  3.0 unx        0 bx stor 26-Aug-28 09:28 icons/',
    ].join('\n')
    expect(checkModes(dirsOnly)).toEqual([])
  })

  // The header and the summary line are not entries. Parsing them as one
  // would either crash or invent a finding with a nonsense filename.
  it('ignores the header and summary lines unzip -Z wraps the listing in', () => {
    const noEntries = [
      'Archive:  dasbo-island@ayubaswad.gmail.com.shell-extension.zip',
      'Zip file size: 159135 bytes, number of entries: 16',
      '16 files, 296481 bytes uncompressed, 156545 bytes compressed:  47.2%',
    ].join('\n')
    expect(checkModes(noEntries)).toEqual([])
  })

  it('reports every executable entry at once, not just the first', () => {
    const two = [
      '-rwxrwxr-x  3.0 unx     3443 tx defN 26-Aug-28 09:28 hooks/dasbo-hook',
      '-rwxr-xr-x  3.0 unx      120 tx defN 26-Aug-28 09:28 tools/something',
    ].join('\n')
    expect(checkModes(two)).toHaveLength(2)
  })
})
