import type { SessionState } from './types.js'
import { NO_SESSIONS, STATE_PHRASE, STATE_WORD } from './vocabulary.js'

/** What the island's label shows, and what a screen reader hears instead. */
export interface IslandLabel {
  text: string
  spoken: string
}

/**
 * Both forms from one call, so they cannot disagree. The visible label is
 * compact because it sits in the top bar; the spoken form is the same fact as
 * a sentence, because "3 · waiting" is read aloud as "three middle dot
 * waiting", and because an accessible name that never changes tells a screen
 * reader user nothing the extension exists to tell them.
 */
export function islandLabel(count: number, state: SessionState): IslandLabel {
  if (count === 0) return { text: NO_SESSIONS, spoken: NO_SESSIONS }
  const noun = count === 1 ? 'session' : 'sessions'
  return {
    text: `${count} · ${STATE_WORD[state]}`,
    spoken: `${count} ${noun}, ${STATE_PHRASE[state]}`,
  }
}
