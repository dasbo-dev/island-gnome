import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Source assertions, not behaviour: this module imports gi://Gio, which cannot
// load under vitest. Same constraint, and the same house style, as
// dotAlignment.test.ts and insensitiveColor.test.ts.
describe('agentIcon', () => {
  const src = readFileSync('src/shell/agentIcon.ts', 'utf8')
  // Comments and prose can say anything; stripping them before asserting
  // means these checks fail if the words move out of comments alone and stop
  // being true of the code, rather than passing forever because the phrase
  // survives in a docblock.
  //
  // Not comment-aware, and it does not need to be for the assertions below —
  // but know what it costs: a `//` inside a string is treated as a comment
  // start, so line 1's `'gi://Gio'` is truncated to `'gi:` in `code`. `.` does
  // not cross newlines, so the damage stops at that line. An assertion added
  // against a line holding a URL or any other `//` in a string would be
  // checking corrupted text, with nothing to flag it.
  const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')

  it('builds the path from the AgentId, with no name table to drift', () => {
    expect(code).toMatch(/\$\{base\}\/icons\/\$\{agent\}\.svg/)
  })

  it('checks the file exists rather than handing St a path that is not there', () => {
    expect(code).toContain('query_exists')
  })

  it('caches a miss as well as a hit', () => {
    // A cache that only stores successes re-stats a missing file on every
    // lookup, which is the exact case the cache exists for: an agent whose
    // mark failed to ship. `undefined` has to mean "never looked" so that a
    // cached `null` can mean "looked, not there".
    expect(code).toMatch(/!==\s*undefined/)
  })

  it('never lets a resolution failure escape into a row build', () => {
    // Not just "the word catch appears somewhere" — that also passes for
    // `catch (e) { throw e }`, which would defeat the one guarantee this
    // module's docstring makes. Isolate the catch body by brace-counting
    // (a plain [^}]* stops at the first `}` inside the template literal the
    // real body logs through) and assert there's no throw in it.
    const catchAt = code.indexOf('catch')
    expect(catchAt, 'expected a catch block in agentIcon.ts').toBeGreaterThan(-1)
    const openBrace = code.indexOf('{', catchAt)
    let depth = 0
    let closeBrace = openBrace
    for (let i = openBrace; i < code.length; i++) {
      if (code[i] === '{') depth++
      else if (code[i] === '}' && --depth === 0) {
        closeBrace = i
        break
      }
    }
    const catchBody = code.slice(openBrace + 1, closeBrace)
    expect(catchBody).not.toMatch(/\bthrow\b/)
  })
})
