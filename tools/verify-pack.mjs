#!/usr/bin/env node
// Reads the entry listing of a packed extension archive and refuses the ones
// that would ship broken.
//
// This exists because the artefact and the build script can disagree. The zip
// that prompted it held nine entries and neither icons/ nor assets/, while
// build.mjs had been copying both correctly the whole time. Both directories
// are loaded by absolute path at runtime and both fail silently when missing,
// so the failure reaches a user as a mark-less agent chip and a blank About QR
// with nothing in the log. A source-text assertion could not have caught it.
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'

/** Entries that must be present, as a label and the predicate that finds them. */
const REQUIRED = [
  ['metadata.json', (e) => e === 'metadata.json'],
  ['extension.js', (e) => e === 'extension.js'],
  ['prefs.js', (e) => e === 'prefs.js'],
  ['stylesheet.css', (e) => e === 'stylesheet.css'],
  ['the gschema XML under schemas/', (e) => /^schemas\/.+\.gschema\.xml$/.test(e)],
  ['hooks/dasbo-hook', (e) => e === 'hooks/dasbo-hook'],
  ['at least one icons/*.svg — the agent chip marks', (e) => /^icons\/[^/]+\.svg$/.test(e)],
  ['at least one file under assets/ — the About QR', (e) => /^assets\/.+/.test(e)],
]

/** Entries that must be absent, as a label and the predicate that finds them. */
const FORBIDDEN = [
  ['a sourcemap, which make pack excludes and nothing can resolve', (e) => e.endsWith('.map')],
  ['schemas/gschemas.compiled, which EGO regenerates itself', (e) => e === 'schemas/gschemas.compiled'],
]

/**
 * @param {string[]} entries Archive entry names as `unzip -Z1` prints them:
 *   no leading `./`, directories with a trailing slash.
 * @param {{ icons?: string[], assets?: string[] }} [expected] Plain filenames
 *   (`'claude.svg'`, `'qr-code.png'`) each of which must appear in the
 *   archive as `icons/<name>` / `assets/<name>`. Passing the actual source
 *   listing here is what turns "at least one" into "all of them": an archive
 *   holding only icons/claude.svg still satisfies the REQUIRED floor below
 *   while shipping mark-less chips for every other agent, which is the
 *   defect this parameter exists to catch. An empty list (the default)
 *   leaves the floor as the only check, so a call site with nothing to
 *   compare against — or a test exercising the floor itself — still catches
 *   a wholly missing directory.
 * @returns {string[]} One message per violation, empty when the archive is good.
 *   Every rule is evaluated, because a one-at-a-time check turns one broken
 *   pack into as many rebuild cycles as there are problems.
 */
export function checkEntries(entries, expected = { icons: [], assets: [] }) {
  const problems = []

  for (const [label, matches] of REQUIRED) {
    if (!entries.some(matches)) problems.push(`missing: ${label}`)
  }

  for (const [label, matches] of FORBIDDEN) {
    for (const entry of entries.filter(matches)) {
      problems.push(`must not ship: ${entry} — ${label}`)
    }
  }

  for (const name of expected.icons ?? []) {
    if (!entries.includes(`icons/${name}`)) problems.push(`missing: icons/${name}`)
  }
  for (const name of expected.assets ?? []) {
    if (!entries.includes(`assets/${name}`)) problems.push(`missing: assets/${name}`)
  }

  return problems
}

/**
 * Catches the defect `*.map`-entry filtering cannot: `make pack` strips the
 * `.map` file from the archive, but esbuild only omits the
 * `//# sourceMappingURL=` comment it writes into the bundle when it is told
 * `sourcemap: false` (see build.mjs, gated on `DASBO_PACK`). If that env var
 * ever fails to reach the build — a Makefile edit that drops it, a build
 * runner that clears the environment — the archive holds no `.map` entries
 * and passes `checkEntries`, while the bundle still points at a file that
 * shipped nowhere. Only reading the bundle text catches that.
 *
 * @param {string} name Bundle file name, for the violation message.
 * @param {string} text Bundle file contents.
 * @returns {string[]} One message per violation, empty when the bundle is clean.
 */
export function checkBundleText(name, text) {
  return text.includes('sourceMappingURL')
    ? [`must not ship: ${name} — carries a sourceMappingURL comment pointing at a .map file make pack excludes`]
    : []
}

/** @param {string} zipPath */
function entriesOf(zipPath) {
  return execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/** @param {string} zipPath @param {string} entry */
function readEntry(zipPath, entry) {
  return execFileSync('unzip', ['-p', zipPath, entry], { encoding: 'utf8' })
}

// Run as a CLI only, so importing this from a test does not shell out.
if (process.argv[1] && process.argv[1].endsWith('verify-pack.mjs')) {
  const zipPath = process.argv[2]
  if (!zipPath) {
    console.error('usage: node tools/verify-pack.mjs <archive.zip>')
    process.exit(2)
  }
  // Read straight from the source tree so this stays correct automatically
  // when an icon or asset is added or renamed — no second list to fall out
  // of sync with build.mjs's own `cp('src/icons', ...)` / `cp('src/assets', ...)`.
  const expected = {
    icons: readdirSync('src/icons'),
    assets: readdirSync('src/assets'),
  }
  const problems = [
    ...checkEntries(entriesOf(zipPath), expected),
    ...checkBundleText('extension.js', readEntry(zipPath, 'extension.js')),
    ...checkBundleText('prefs.js', readEntry(zipPath, 'prefs.js')),
  ]
  if (problems.length > 0) {
    console.error(`${zipPath} is not fit to upload:`)
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log(`${zipPath}: verified`)
}
