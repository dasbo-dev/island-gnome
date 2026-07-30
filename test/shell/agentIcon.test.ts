import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Source assertions, not behaviour: this module imports gi://Gio, which cannot
// load under vitest. Same constraint, and the same house style, as
// dotAlignment.test.ts and insensitiveColor.test.ts.
describe('agentIcon', () => {
  const src = readFileSync('src/shell/agentIcon.ts', 'utf8')

  it('builds the path from the AgentId, with no name table to drift', () => {
    expect(src).toMatch(/\$\{base\}\/icons\/\$\{agent\}\.svg/)
  })

  it('checks the file exists rather than handing St a path that is not there', () => {
    expect(src).toContain('query_exists')
  })

  it('caches a miss as well as a hit', () => {
    // A cache that only stores successes re-stats a missing file on every
    // lookup, which is the exact case the cache exists for: an agent whose
    // mark failed to ship. `undefined` has to mean "never looked" so that a
    // cached `null` can mean "looked, not there".
    expect(src).toMatch(/!==\s*undefined/)
  })

  it('never lets a resolution failure escape into a row build', () => {
    expect(src).toContain('catch')
  })
})
