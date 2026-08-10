import type { AgentId } from './types.js'

/**
 * What the agent's hooks can do once installed.
 *
 * `inline` means the agent will wait for a decision from the island and honour
 * it. `notify-only` means it will not: Codex's PreToolUse hook rejects an
 * allow/ask decision outright (docs/limitations.md § "Codex has no permission
 * gate"), so its hooks are installed for notifications alone. This is on the
 * catalog because the preferences page is where a user decides to install, and
 * it is the last moment the difference can be told to them.
 */
export type AgentPermissions = 'inline' | 'notify-only'

/**
 * One agent as the preferences page presents it.
 *
 * A `supported` entry carries no display name: the row reads it from
 * `adapters[id].displayName`, so the page and the adapter cannot drift into
 * calling the same agent two different things. A `coming-soon` entry has no
 * adapter to ask, so it carries its own name.
 *
 * A `supported` entry also records whether the agent honours an inline
 * permission decision. A `coming-soon` entry does not: this build installs no
 * hooks for it, so there is no capability to report yet.
 *
 * The union is discriminated on `status` rather than carrying an `AgentId |
 * string` id, so the branch that builds an interactive row narrows to
 * `AgentId` without a cast — a coming-soon id is by definition an agent this
 * build cannot dispatch to.
 */
export type CatalogEntry =
  | { id: AgentId; status: 'supported'; permissions: AgentPermissions }
  | { id: string; displayName: string; status: 'coming-soon' }

/**
 * Every agent the preferences page shows, in display order: the ones whose
 * hooks this build can install, then the roadmap.
 *
 * This is the only place the roadmap is written down. Antigravity sits in the
 * second group despite having an adapter in the tree: this build does not
 * offer its hooks, and the adapter stays for the release that turns it on.
 */
export const AGENT_CATALOG: readonly CatalogEntry[] = [
  { id: 'claude', status: 'supported', permissions: 'inline' },
  { id: 'codex', status: 'supported', permissions: 'notify-only' },
  { id: 'opencode', displayName: 'OpenCode', status: 'coming-soon' },
  { id: 'cursor', displayName: 'Cursor CLI', status: 'coming-soon' },
  { id: 'antigravity', displayName: 'Antigravity CLI', status: 'coming-soon' },
]
