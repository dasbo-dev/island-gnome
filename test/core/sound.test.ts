import { describe, it, expect } from 'vitest'
import {
  CUE_SOUNDS,
  CUE_DESCRIPTIONS,
  THROTTLE_MS,
  newlyDone,
  shouldPlay,
  snapshotStates,
  type SoundCue,
} from '../../src/core/sound.js'
import type { Session, SessionState } from '../../src/core/types.js'

function sess(key: string, state: SessionState, over: Partial<Session> = {}): Session {
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

describe('shouldPlay', () => {
  it('rule 1: the extension switch off silences everything, whatever else is true', () => {
    expect(
      shouldPlay({ enabled: false, eventSounds: true, last: 0, now: 100_000 })
    ).toBe(false)
  })

  it('rule 2: the desktop switch explicitly off silences it', () => {
    expect(
      shouldPlay({ enabled: true, eventSounds: false, last: 0, now: 100_000 })
    ).toBe(false)
  })

  it('rule 2: eventSounds null is permissive, not read as silence', () => {
    // No gnome-desktop schema installed has no way to ask for silence, so the
    // extension's own switch (rule 1) stays the only authority.
    expect(
      shouldPlay({ enabled: true, eventSounds: null, last: 0, now: 100_000 })
    ).toBe(true)
  })

  it('rule 3: throttled just under the window stays silent', () => {
    expect(
      shouldPlay({ enabled: true, eventSounds: true, last: 1000, now: 1000 + THROTTLE_MS - 1 })
    ).toBe(false)
  })

  it('rule 3: the boundary at exactly THROTTLE_MS must play — the rule is <, not <=', () => {
    expect(
      shouldPlay({ enabled: true, eventSounds: true, last: 1000, now: 1000 + THROTTLE_MS })
    ).toBe(true)
  })

  it('rule 3: a cue never played before (last: 0) plays once enough time has passed since the clock started', () => {
    expect(
      shouldPlay({ enabled: true, eventSounds: true, last: 0, now: THROTTLE_MS })
    ).toBe(true)
  })

  it('rule 4: plays when nothing says otherwise', () => {
    expect(
      shouldPlay({ enabled: true, eventSounds: true, last: 0, now: 100_000 })
    ).toBe(true)
  })

  it('rule 4: plays when the desktop schema is absent and the throttle has elapsed', () => {
    expect(
      shouldPlay({ enabled: true, eventSounds: null, last: 0, now: THROTTLE_MS })
    ).toBe(true)
  })

  it('precedence: several reasons to stay silent at once still returns false', () => {
    expect(
      shouldPlay({ enabled: false, eventSounds: false, last: 999_000, now: 999_000 })
    ).toBe(false)
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
