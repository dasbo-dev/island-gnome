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
 *
 * A session carrying `endedByClear` is skipped too: today the only route to
 * 'done' is a session-end event, and for Claude that includes `/clear`, which
 * the user presses several times an hour. `endedByClear` is set only when the
 * adapter could actually tell — Claude's SessionEnd payload is inferred
 * rather than captured (see docs/agent-dialects.md), so if a real hook spells
 * its `reason` differently than assumed, the flag simply stays unset and this
 * cues exactly as it did before the fix: the failure direction is today's
 * behaviour, not a new and unexpected silence.
 */
export function newlyDone(prev: Map<string, SessionState>, next: Session[]): string[] {
  const keys: string[] = []
  for (const s of next) {
    if (s.state !== 'done') continue
    if (s.endedByClear) continue
    const was = prev.get(s.key)
    if (was === undefined || was === 'done') continue
    keys.push(s.key)
  }
  return keys
}

/** Minimum gap between two plays of the same cue — see `shouldPlay`. */
export const THROTTLE_MS = 500

/**
 * Whether a cue should actually sound, decided in one pure place so the rules
 * are unit-testable rather than only greppable out of soundPlayer.ts's source.
 * `soundPlayer.ts` gathers the inputs (its own switch, the desktop's, the
 * per-cue clock) and calls this; it must not re-implement any of the order
 * below itself.
 *
 * The order below is behaviour, not narrative:
 *
 * 1. The extension's own `notification-sounds` switch is the final authority.
 *    Off means off, regardless of anything else.
 * 2. The desktop's `event-sounds` key silences a cue only when it is
 *    *explicitly* false. `null` means the schema is not installed at all — a
 *    desktop with no way to say it wants silence must not be read as saying
 *    so, so rule 1 alone keeps governing.
 * 3. Two sessions can reach one cue inside a single store emit, and two
 *    overlapping copies of the same theme sound read as a glitch rather than
 *    two events — so a cue played inside the last `THROTTLE_MS` stays silent.
 * 4. Otherwise, play.
 */
export function shouldPlay(input: {
  /** The extension's own notification-sounds key. */
  enabled: boolean
  /** org.gnome.desktop.sound event-sounds; null when that schema is not installed. */
  eventSounds: boolean | null
  /** When this cue last played, in the same clock as `now`. 0 if never. */
  last: number
  /** The current time, in the same clock as `last`. Never read from a clock in here. */
  now: number
}): boolean {
  if (!input.enabled) return false
  if (input.eventSounds === false) return false
  if (input.now - input.last < THROTTLE_MS) return false
  return true
}
