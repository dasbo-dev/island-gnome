import type { SessionState } from './types.js'

/**
 * Every user-facing string with more than one consumer, and nothing else.
 *
 * A string shown in exactly one place stays at its widget, where it can be
 * read beside the code that shows it. What lives here is the copy that used to
 * be written down twice and drifted: the island named a running session one
 * way while the row beneath it named the same session another, in a single
 * screenshot.
 *
 * Pure by construction — `src/core` may not import gi:// or resource://
 * (see test/core/purity.test.ts), which is what lets the shell, the
 * preferences process and the tests all read the same table.
 */

/** The word the island's label carries for each state. */
export const STATE_WORD: Record<SessionState, string> = {
  idle: 'idle',
  running: 'thinking',
  waiting: 'waiting',
  error: 'error',
  done: 'done',
}

/**
 * The same states spoken aloud, for the island's accessible_name. Separate from
 * STATE_WORD because a screen reader gets the sentence a sighted user infers
 * from the layout: "waiting" on its own does not say who is being waited on.
 */
export const STATE_PHRASE: Record<SessionState, string> = {
  idle: 'idle',
  running: 'thinking',
  waiting: 'waiting for you',
  error: 'errored',
  done: 'finished',
}

/** The island's label and accessible name when there are no sessions at all. */
export const NO_SESSIONS = 'No sessions'

/**
 * The session row's activity text when nothing more specific is known.
 *
 * `running` takes an ellipsis because the row dims it as a placeholder
 * (`Activity.hint`) and the ellipsis is what marks it as one; the island's
 * label carries no ellipsis because it is not standing in for anything.
 */
export function activityPlaceholder(state: SessionState): string {
  return state === 'running' ? `${STATE_WORD.running}…` : STATE_WORD[state]
}
