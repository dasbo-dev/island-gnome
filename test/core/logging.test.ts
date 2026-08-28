import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

// build.mjs bundles all of src/ into a single extension.js, so every console
// call in the tree counts against the same file's total — and EGO's "no
// excessive logging" rule (shexli EGO-A-004) fails a file with more than five.
// Routing them through src/core/log.ts holds the count at one no matter how
// many error paths get added later. This is the regression guard for that;
// modelled on test/core/purity.test.ts.
describe('logging goes through one seam', () => {
  it('names console nowhere under src/ but core/log.ts', () => {
    const seam = join('src', 'core', 'log.ts')
    const offenders = walk('src')
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => f !== seam)
      .filter((f) => readFileSync(f, 'utf8').includes('console.'))
    expect(offenders).toEqual([])
  })
})
