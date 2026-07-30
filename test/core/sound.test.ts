import { describe, it, expect } from 'vitest'
import {
  CUE_SOUNDS,
  CUE_DESCRIPTIONS,
  newlyDone,
  snapshotStates,
  type SoundCue,
} from '../../src/core/sound.js'
import type { Session, SessionState } from '../../src/core/types.js'

function sess(key: string, state: SessionState): Session {
  return {
    key,
    agent: 'claude',
    sessionId: key,
    project: 'dasbo-island',
    cwd: '/home/me/projects/dasbo-island',
    state,
    pid: 4242,
    startedAt: 0,
    conversationIndex: 1,
    lastEventAt: 0,
  }
}

const CUES: SoundCue[] = ['permission', 'question', 'notification', 'done']

describe('cue sounds', () => {
  it('names a theme sound and a description for every cue', () => {
    for (const cue of CUES) {
      expect(CUE_SOUNDS[cue]).toBeTruthy()
      expect(CUE_DESCRIPTIONS[cue]).toBeTruthy()
    }
  })

  it('gives each cue a distinct sound, so two events never sound the same', () => {
    const names = CUES.map((c) => CUE_SOUNDS[c])
    expect(new Set(names).size).toBe(names.length)
  })

  it('uses the freedesktop names the spec settled on', () => {
    // Pinned by name: these exist in /usr/share/sounds/freedesktop/stereo, and
    // libcanberra falls back through the user's theme parents to find them. A
    // rename here is a behaviour change, not a refactor.
    expect(CUE_SOUNDS).toEqual({
      permission: 'dialog-warning',
      question: 'window-question',
      notification: 'message-new-instant',
      done: 'complete',
    })
  })

  it('describes each cue for the sound server, not with the theme name', () => {
    // The description reaches the sound server and can surface in a
    // per-application volume list, so it names the app and the event.
    for (const cue of CUES) {
      expect(CUE_DESCRIPTIONS[cue]).toMatch(/Dasbo Island/)
      expect(CUE_DESCRIPTIONS[cue]).not.toBe(CUE_SOUNDS[cue])
    }
  })
})

describe('snapshotStates', () => {
  it('maps every session key to its state', () => {
    const snap = snapshotStates([sess('a', 'running'), sess('b', 'done')])
    expect(snap.get('a')).toBe('running')
    expect(snap.get('b')).toBe('done')
  })

  it('drops keys absent from the new list, so a reaped session leaves no trace', () => {
    const snap = snapshotStates([sess('b', 'done')])
    expect(snap.has('a')).toBe(false)
    expect(snap.size).toBe(1)
  })
})

describe('newlyDone', () => {
  it('reports a session that just finished', () => {
    const prev = new Map<string, SessionState>([['a', 'running']])
    expect(newlyDone(prev, [sess('a', 'done')])).toEqual(['a'])
  })

  it('stays silent for a session that was already done', () => {
    const prev = new Map<string, SessionState>([['a', 'done']])
    expect(newlyDone(prev, [sess('a', 'done')])).toEqual([])
  })

  it('stays silent for a key it has never seen, even if it arrives done', () => {
    // Costs the rare session whose first event is its last, and buys silence at
    // enable(), where every session in a freshly built store would otherwise
    // look newly finished.
    expect(newlyDone(new Map(), [sess('a', 'done')])).toEqual([])
  })

  it('re-arms after done → running, so the next finish sounds again', () => {
    let prev = snapshotStates([sess('a', 'running')])
    expect(newlyDone(prev, [sess('a', 'done')])).toEqual(['a'])
    prev = snapshotStates([sess('a', 'done')])
    expect(newlyDone(prev, [sess('a', 'running')])).toEqual([])
    prev = snapshotStates([sess('a', 'running')])
    expect(newlyDone(prev, [sess('a', 'done')])).toEqual(['a'])
  })

  it('ignores every state that is not done', () => {
    const prev = new Map<string, SessionState>([['a', 'running']])
    for (const state of ['idle', 'running', 'waiting', 'error'] as SessionState[]) {
      expect(newlyDone(prev, [sess('a', state)])).toEqual([])
    }
  })

  it('reports several finishes in one pass', () => {
    const prev = new Map<string, SessionState>([
      ['a', 'running'],
      ['b', 'waiting'],
    ])
    expect(newlyDone(prev, [sess('a', 'done'), sess('b', 'done')])).toEqual(['a', 'b'])
  })
})
