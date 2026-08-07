import type { AgentId } from './types.js'

/**
 * One agent as the preferences page presents it.
 *
 * A `supported` entry carries no display name: the row reads it from
 * `adapters[id].displayName`, so the page and the adapter cannot drift into
 * calling the same agent two different things. A `coming-soon` entry has no
 * adapter to ask, so it carries its own name.
 *
 * The union is discriminated on `status` rather than carrying an `AgentId |
 * string` id, so the branch that builds an interactive row narrows to
 * `AgentId` without a cast — a coming-soon id is by definition an agent this
 * build cannot dispatch to.
 */
export type CatalogEntry =
  | { id: AgentId; status: 'supported' }
  | { id: string; displayName: string; status: 'coming-soon' }

/**
 * Every agent the preferences page shows, in display order: the ones whose
 * hooks this build can install, then the roadmap.
 *
 * This is the only place the roadmap is written down. Antigravity sits in the
 * second group despite having a complete adapter and twelve captured fixtures
 * — its permission decision path has never been exercised against a real
 * payload, so shipping it as supported would overstate what the extension
 * does. The adapter stays in the tree for the release that turns it back on.
 */
export const AGENT_CATALOG: readonly CatalogEntry[] = [
  { id: 'claude', status: 'supported' },
  { id: 'codex', status: 'supported' },
  { id: 'opencode', displayName: 'OpenCode', status: 'coming-soon' },
  { id: 'cursor', displayName: 'Cursor CLI', status: 'coming-soon' },
  { id: 'antigravity', displayName: 'Antigravity CLI', status: 'coming-soon' },
]
