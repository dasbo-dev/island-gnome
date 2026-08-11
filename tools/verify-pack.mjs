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

/** Entries that must be present, as a label and the predicate that finds them. */
const REQUIRED = [
  ['metadata.json', (e) => e === 'metadata.json'],
  ['extension.js', (e) => e === 'extension.js'],
  ['prefs.js', (e) => e === 'prefs.js'],
  ['stylesheet.css', (e) => e === 'stylesheet.css'],
  ['the gschema XML under schemas/', (e) => e.endsWith('.gschema.xml')],
  ['hooks/dasbo-hook', (e) => e === 'hooks/dasbo-hook'],
  ['at least one icons/*.svg — the agent chip marks', (e) => /^icons\/.+\.svg$/.test(e)],
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
 * @returns {string[]} One message per violation, empty when the archive is good.
 *   Every rule is evaluated, because a one-at-a-time check turns one broken
 *   pack into as many rebuild cycles as there are problems.
 */
export function checkEntries(entries) {
  const problems = []

  for (const [label, matches] of REQUIRED) {
    if (!entries.some(matches)) problems.push(`missing: ${label}`)
  }

  for (const [label, matches] of FORBIDDEN) {
    for (const entry of entries.filter(matches)) {
      problems.push(`must not ship: ${entry} — ${label}`)
    }
  }

  return problems
}

/** @param {string} zipPath */
function entriesOf(zipPath) {
  return execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

// Run as a CLI only, so importing this from a test does not shell out.
if (process.argv[1] && process.argv[1].endsWith('verify-pack.mjs')) {
  const zipPath = process.argv[2]
  if (!zipPath) {
    console.error('usage: node tools/verify-pack.mjs <archive.zip>')
    process.exit(2)
  }
  const problems = checkEntries(entriesOf(zipPath))
  if (problems.length > 0) {
    console.error(`${zipPath} is not fit to upload:`)
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log(`${zipPath}: verified`)
}
