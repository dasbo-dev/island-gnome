import { describe, it, expect } from 'vitest'
import { emptyState } from '../../src/core/emptyState.js'

describe('the popup empty state', () => {
  // The ux-copy empty-state shape: what this is, why it is empty, how to start.
  it('tells a user with hooks how a session gets here', () => {
    expect(emptyState(true)).toEqual({
      title: 'No active sessions',
      detail: 'Start Claude Code or Codex in a terminal and it’ll appear here.',
    })
  })

  // The whole point of the finding: a user who has never installed hooks was
  // shown "No active sessions" forever and never told hooks existed.
  it('tells a user with no hooks that hooks are the missing piece', () => {
    expect(emptyState(false)).toEqual({
      title: 'No agents connected',
      detail: 'Install hooks in Settings to get started.',
    })
  })

  it('always gives both lines', () => {
    for (const installed of [true, false]) {
      const state = emptyState(installed)
      expect(state.title.length).toBeGreaterThan(0)
      expect(state.detail.length).toBeGreaterThan(0)
    }
  })
})
