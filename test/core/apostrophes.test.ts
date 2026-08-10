import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

// Curly is already the majority, and the two forms sat side by side in one
// window. This checks string literals only: a straight apostrophe inside a
// double-quoted or backtick-quoted user-facing string is the case that reaches
// a user.
describe('prose apostrophes are curly', () => {
  it('has no straight apostrophe inside a double-quoted or template string in src', () => {
    const offenders: string[] = []
    // .ts only: src/assets holds a PNG whose bytes match anything.
    for (const file of walk('src').filter((f) => f.endsWith('.ts'))) {
      const src = readFileSync(file, 'utf8')
      for (const [i, line] of src.split('\n').entries()) {
        if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) continue
        if (/(["`])[^"`]*\w'\w[^"`]*\1/.test(line)) offenders.push(`${file}:${i + 1}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
