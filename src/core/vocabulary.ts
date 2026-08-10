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
 * Pure by construction — nothing under `src/core` may import a GNOME namespace
 * (see test/core/purity.test.ts, which scans for the import prefixes as raw
 * substrings, so do not name them here). That purity is what lets the shell,
 * the preferences process and the tests all read the same table.
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

/**
 * The label each setting carries in the preferences window, keyed by its
 * GSettings key.
 *
 * The gschema restates these as `<summary>`, and the two copies had drifted:
 * one called the top-bar object a pill while the window that showed it had
 * been renamed. XML and TypeScript cannot share a constant, so this table is
 * the single source and `test/core/schemaLabels.test.ts` is what holds the
 * schema to it.
 *
 * Every key in the schema appears here, including the two with no row of their
 * own: `enabled-agents` is written by the per-agent switches, and
 * `welcome-shown` is internal state. Their labels are authored here rather than
 * mirrored from a row, and the completeness is what lets the test fail on a new
 * key that was added without one.
 */
export const PREFS_LABEL: Record<string, string> = {
  'panel-position': 'Panel box',
  'panel-index': 'Position within the box',
  'always-show': 'Always show the island',
  'permission-timeout': 'Permission timeout',
  'question-timeout': 'Question timeout',
  'auto-open-on-permission': 'Open the popup automatically',
  'notification-popup': 'Open the popup on a notification',
  'notification-seconds': 'Keep a notification visible',
  'notification-sounds': 'Play a sound',
  'enabled-agents': 'Agents Dasbo Island accepts events from',
  'done-linger': 'Keep finished sessions visible',
  'agent-chip-display': 'Agent chip',
  'welcome-shown': 'First-run notification shown',
}
