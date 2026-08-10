/** The two lines the popup shows in place of session rows. */
export interface EmptyState {
  title: string
  /** Why the list is empty and what to do about it — dimmed beneath the title. */
  detail: string
}

/**
 * An empty state, not a label.
 *
 * The variant matters more than the wording: a user who has enabled the
 * extension but installed no hooks will never see a session no matter how long
 * they wait, and the old single line told them nothing about that. Splitting on
 * whether any agent has hooks is what turns this from a status into an
 * instruction.
 */
export function emptyState(hooksInstalled: boolean): EmptyState {
  return hooksInstalled
    ? {
        title: 'No active sessions',
        detail: 'Start Claude Code or Codex in a terminal and it’ll appear here.',
      }
    : {
        title: 'No agents connected',
        detail: 'Install hooks in Settings to get started.',
      }
}
