import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

describe('src/core purity', () => {
  it('never imports gi:// or resource://', () => {
    const offenders = walk('src/core').filter((f) => {
      const src = readFileSync(f, 'utf8')
      return src.includes("gi://") || src.includes("resource:///")
    })
    expect(offenders).toEqual([])
  })
})
