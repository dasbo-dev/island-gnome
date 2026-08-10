import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { STATE_WORD, STATE_PHRASE, NO_SESSIONS, activityPlaceholder } from '../../src/core/vocabulary.js'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

describe('the shared vocabulary', () => {
  it('gives every session state one word and one spoken phrase', () => {
    for (const state of ['idle', 'running', 'waiting', 'done', 'error'] as const) {
      expect(STATE_WORD[state], state).toBeTruthy()
      expect(STATE_PHRASE[state], state).toBeTruthy()
    }
  })

  it('says thinking for a running session, on the island and on the row', () => {
    expect(STATE_WORD.running).toBe('thinking')
    expect(activityPlaceholder('running')).toBe('thinking…')
  })

  it('marks the no-session case as no sessions, not as an idle session', () => {
    expect(NO_SESSIONS).toBe('No sessions')
    expect(NO_SESSIONS).not.toBe(STATE_WORD.idle)
  })

  it('falls back to the bare state word for every state but running', () => {
    expect(activityPlaceholder('idle')).toBe('idle')
    expect(activityPlaceholder('done')).toBe('done')
    expect(activityPlaceholder('error')).toBe('error')
  })
})

// The defect this file exists to prevent: two files each naming the states, and
// drifting. A quoted 'working' anywhere in src is that drift coming back.
describe('no source file names a session state on its own', () => {
  it('has no quoted "working" left in src', () => {
    const offenders = walk('src').filter((f) => /['"]working['"]/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })

  // Only the absence of a second table is asserted, not the presence of the
  // import: the island's label comes from islandLabel() rather than the table
  // directly, after which the file legitimately imports neither.
  it('leaves the state table as the only place the words are written', () => {
    const island = readFileSync('src/shell/island.ts', 'utf8')
    expect(island).not.toContain('const STATE_WORD')
    expect(island).not.toMatch(/running:\s*['"]/)
  })
})
