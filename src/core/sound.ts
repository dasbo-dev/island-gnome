import type { Session, SessionState } from './types.js'

/** The four things worth interrupting a user for. */
export type SoundCue = 'permission' | 'question' | 'notification' | 'done'

/**
 * XDG sound-theme names, not files. libcanberra resolves each through the
 * user's chosen theme and its parents down to `freedesktop`, so the extension
 * ships no audio and follows whatever the desktop already sounds like. The
 * cost, accepted in the design doc: on a sparse theme two cues can resolve to
 * the same fallback.
 */
export const CUE_SOUNDS: Record<SoundCue, string> = {
  permission: 'dialog-warning',
  question: 'window-question',
  notification: 'message-new-instant',
  done: 'complete',
}

/**
 * Human-readable event names, passed to the sound server rather than used to
 * pick the sound — they can surface in a per-application volume list, so they
 * name the extension and the event instead of repeating the theme name.
 */
export const CUE_DESCRIPTIONS: Record<SoundCue, string> = {
  permission: 'Dasbo Island: permission request',
  question: 'Dasbo Island: agent question',
  notification: 'Dasbo Island: notification',
  done: 'Dasbo Island: session finished',
}

/** The states of every live session, keyed for the next diff. */
export function snapshotStates(sessions: Session[]): Map<string, SessionState> {
  return new Map(sessions.map((s) => [s.key, s.state]))
}

/**
 * Keys whose state moved into 'done' since `prev` was taken.
 *
 * A key absent from `prev` never counts, even when it arrives already done: the
 * store is built fresh on every enable(), and treating unknown-as-new would
 * sound a cue for every session alive at that moment.
 */
export function newlyDone(prev: Map<string, SessionState>, next: Session[]): string[] {
  const keys: string[] = []
  for (const s of next) {
    if (s.state !== 'done') continue
    const was = prev.get(s.key)
    if (was === undefined || was === 'done') continue
    keys.push(s.key)
  }
  return keys
}
