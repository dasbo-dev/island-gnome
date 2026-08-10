import { describe, it, expect } from 'vitest'
import { islandLabel } from '../../src/core/islandLabel.js'

describe('the island label', () => {
  it('says no sessions rather than calling a session idle', () => {
    expect(islandLabel(0, 'idle')).toEqual({ text: 'No sessions', spoken: 'No sessions' })
  })

  it('renders the count and the state word for the visible label', () => {
    expect(islandLabel(3, 'waiting').text).toBe('3 · waiting')
    expect(islandLabel(2, 'running').text).toBe('2 · thinking')
  })

  it('spells the label out for a screen reader, without the separator', () => {
    expect(islandLabel(3, 'waiting').spoken).toBe('3 sessions, waiting for you')
    expect(islandLabel(2, 'running').spoken).toBe('2 sessions, thinking')
    expect(islandLabel(1, 'done').spoken).toBe('1 session, finished')
  })

  it('never leaves the middle dot in the spoken form', () => {
    for (const state of ['idle', 'running', 'waiting', 'done', 'error'] as const) {
      expect(islandLabel(4, state).spoken).not.toContain('·')
    }
  })
})
