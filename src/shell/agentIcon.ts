import Gio from 'gi://Gio'
import type { AgentId } from '../core/types.js'
import { warn } from '../core/log.js'

/**
 * Resolved marks, keyed `${base}:${agent}`.
 *
 * `undefined` from this map means "never looked"; a stored `null` means
 * "looked, not there". The distinction is the whole point: without it a
 * missing SVG — the case the cache is for — would be re-stat'd on every
 * lookup, while the case that never fails would be the only one cached.
 *
 * The base path is part of the key rather than assumed constant because it is
 * the extension's install directory, which changes between a system install
 * and a user one, and this module has no way to know a reload happened.
 */
const cache = new Map<string, Gio.Icon | null>()

/**
 * The agent's mark as a gicon, or `null` when the file is not there.
 *
 * Returning `null` rather than throwing or substituting a stock icon is what
 * lets the chip degrade to a bare name: a missing mark costs the row its icon
 * and nothing else. See the fail-open note in the README — the same principle,
 * applied to a decoration instead of a hook.
 */
export function agentGicon(base: string, agent: AgentId): Gio.Icon | null {
  const key = `${base}:${agent}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  let icon: Gio.Icon | null = null
  try {
    const file = Gio.File.new_for_path(`${base}/icons/${agent}.svg`)
    icon = file.query_exists(null) ? Gio.FileIcon.new(file) : null
  } catch (e) {
    // query_exists does not throw for an absent file, but it can for a path
    // that is not readable at all. This runs inside a row build, and an
    // exception escaping there takes the whole popup rebuild with it — a
    // missing decoration must never cost the user their session list.
    warn(`resolving the ${agent} mark failed: ${e}`)
    icon = null
  }

  cache.set(key, icon)
  return icon
}
