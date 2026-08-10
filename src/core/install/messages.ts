import type { AgentPermissions } from '../agentCatalog.js'
import type { InstallState } from './plan.js'

/**
 * Every string the Agents page shows about an agent's hooks.
 *
 * Pure, and here rather than in prefs.ts, because prefs.ts needs a running GTK
 * and cannot be unit-tested — which is how a raw exception, a bare file path
 * and a "nothing to install" reached users in the first place.
 *
 * All of these follow the same shape on a failure path: what happened, why it
 * matters, and what to do next.
 */

const NOTIFY_ONLY_NOTE = ' · notifications only, no permission prompts'

/** What a row says, and what its tooltip holds when the subtitle cannot fit it. */
export interface RowText {
  subtitle: string
  /** Null when the subtitle is complete on its own. */
  tooltip: string | null
}

/** `/home/ada/.claude/settings.json` → `~/.claude/settings.json`. */
export function shortenHome(path: string, home: string): string {
  if (!home || !path.startsWith(`${home}/`)) return path
  return `~${path.slice(home.length)}`
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function installRowText(
  state: InstallState,
  permissions: AgentPermissions,
  configPath: string
): RowText {
  // Appended only to the two states that mean hooks are on disk. On `absent`
  // there is nothing to be notify-only about, and on `unreadable` the note
  // would compete with the broken file the user has to fix first.
  const note = permissions === 'notify-only' ? NOTIFY_ONLY_NOTE : ''
  switch (state) {
    case 'installed':
      return { subtitle: `Hooks installed${note}`, tooltip: null }
    // Deliberately vague about the cause: stale covers an out-of-date hook
    // path, a duplicated entry, a missing event, a command under the wrong
    // event, and a codex file still holding the old named-hook entry.
    case 'stale':
      return {
        subtitle: `Hooks need updating — they don’t match what this version installs${note}`,
        tooltip: null,
      }
    case 'unreadable':
      // The full path goes to the tooltip: an Adw.ActionRow subtitle
      // ellipsizes in the middle, which is where the filename is.
      return {
        subtitle: `Can’t read ${basename(configPath)} — it isn’t valid JSON. Fix the file, then reopen this page.`,
        tooltip: configPath,
      }
    case 'absent':
      return { subtitle: 'Not installed', tooltip: null }
    default: {
      // A new InstallState member must be given text here rather than
      // silently rendering as "Not installed".
      const unhandled: never = state
      return unhandled
    }
  }
}

export interface ToastOpts {
  displayName: string
  agent: string
  verb: 'install' | 'remove'
  outcome: 'noop' | 'done' | 'failed'
  configPath: string
  home: string
}

export function installToast(o: ToastOpts): string {
  if (o.outcome === 'noop') {
    return o.verb === 'install'
      ? `${o.displayName} hooks are already up to date.`
      : `No ${o.displayName} hooks to remove.`
  }
  if (o.outcome === 'failed') {
    // The exception itself goes to the journal, not here: an Adw.Toast is one
    // line and clips, and a GLib error string carries a path, an errno and no
    // advice. This says the one thing the user can act on.
    return `Couldn’t ${o.verb} ${o.displayName} hooks — check that ${shortenHome(o.configPath, o.home)} is writable.`
  }
  if (o.verb === 'remove') return `${o.displayName} hooks removed`
  // Codex parses a newly written hook but will not run it until it has been
  // trusted, and that review only happens in its own TUI — so an install that
  // succeeded here is still one step short of firing.
  const trust = o.agent === 'codex' ? ' — run codex once to approve them' : ''
  return `${o.displayName} hooks installed${trust}`
}
