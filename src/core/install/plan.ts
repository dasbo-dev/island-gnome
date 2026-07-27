import type { AgentId, FileEdit } from '../types.js'

export interface InstallEnv {
  home: string
  /** Absolute path to the installed dasbo-hook executable. */
  hookPath: string
  /** Current contents of a path, or null when the file does not exist. */
  existing: (path: string) => string | null
}

/** Marker used to recognise our own entries on uninstall and to stay idempotent. */
const MARKER = 'dasbo-hook'
const CODEX_KEY = 'dasbo-island'
const ANTIGRAVITY_KEY = 'dasbo-island'

const CLAUDE_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'] as const
const CODEX_EVENTS = ['session.start', 'session.end', 'tool.start', 'tool.end'] as const
const ANTIGRAVITY_GROUPED = ['PreToolUse', 'PostToolUse'] as const
const ANTIGRAVITY_FLAT = ['PreInvocation', 'PostInvocation', 'Stop'] as const

/**
 * Every event gets its own command carrying the event name, so a hook line
 * is self-describing even for agents whose payload already names the event
 * (Claude) and load-bearing for the one that has no event field at all
 * (Antigravity) and the one that takes a single command for many events
 * (Codex, which cannot use this per-event form — see codexEdits).
 */
function cmd(env: InstallEnv, agent: AgentId, mode: 'notify' | 'permission', event: string): string {
  return `${env.hookPath} ${agent} ${mode} ${event}`
}

function isRecord(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseOrNull(text: string | null): Record<string, any> | null | undefined {
  if (text === null) return null // file absent: start from {}
  try {
    const v = JSON.parse(text)
    return isRecord(v) ? v : undefined
  } catch {
    return undefined // malformed: refuse to touch it
  }
}

/**
 * True when ~/.codex/hooks.json exists, parses, and holds at least one entry
 * in the legacy unwrapped shape — no top-level `hooks` key, or a `hooks` key
 * whose value is not an object (`null`, a string, an array — a plausible
 * result of a partial or malformed hand edit). That shape is the one Codex
 * 0.142 rejects outright, silently disabling every entry in the file until
 * install() wraps it. Shares the same `isRecord` test codexEdits uses to
 * decide `wrapped`, so the two can never disagree about what "legacy" means.
 * An absent file or an empty `{}` has nothing to reactivate, so both are
 * excluded.
 */
export function isLegacyCodexHooks(content: string | null): boolean {
  if (content === null) return false
  let doc: unknown
  try {
    doc = JSON.parse(content)
  } catch {
    return false
  }
  if (!isRecord(doc)) return false
  return !isRecord(doc['hooks']) && Object.keys(doc).length > 0
}

function isOurs(command: unknown): boolean {
  return typeof command === 'string' && command.includes(MARKER)
}

/** Strip every dasbo group from a Claude-style event array. */
function withoutOurs(groups: unknown): any[] {
  if (!Array.isArray(groups)) return []
  return groups
    .map((g) => {
      if (!isRecord(g)) return null
      const hooks = Array.isArray(g['hooks']) ? g['hooks'].filter((h: any) => !isOurs(h?.command)) : []
      return hooks.length > 0 ? { ...g, hooks } : null
    })
    .filter((g): g is any => g !== null)
}

function claudeEdits(env: InstallEnv, install: boolean): FileEdit[] {
  const path = `${env.home}/.claude/settings.json`
  const doc = parseOrNull(env.existing(path))
  if (doc === undefined) return []
  const root: Record<string, any> = doc === null ? {} : { ...doc }
  const hooks: Record<string, any> = { ...(root['hooks'] ?? {}) }

  let changed = false
  for (const event of CLAUDE_EVENTS) {
    const cleaned = withoutOurs(hooks[event])
    if (install) {
      const mode = event === 'PreToolUse' ? 'permission' : 'notify'
      const group: Record<string, any> = {
        hooks: [{ type: 'command', command: cmd(env, 'claude', mode, event) }],
      }
      if (event === 'PreToolUse' || event === 'PostToolUse') group['matcher'] = '*'
      hooks[event] = [...cleaned, group]
      changed = true
    } else {
      const had = JSON.stringify(hooks[event] ?? []) !== JSON.stringify(cleaned)
      if (had) changed = true
      if (cleaned.length > 0) hooks[event] = cleaned
      else delete hooks[event]
    }
  }

  if (!changed) return []
  root['hooks'] = hooks
  return [{ path, content: JSON.stringify(root, null, 2) + '\n', backup: true }]
}

/**
 * Codex 0.142 rejects a bare top-level named-hook map outright
 * (`unknown field 'vibe-island', expected 'hooks'`), which silently disables
 * every hook in the file — including foreign entries already present. The
 * map must therefore live under a `hooks` key.
 *
 * A pre-existing unwrapped file (no top-level `hooks` key: every top-level
 * key IS a hook name, per the legacy shape Codex currently rejects and thus
 * ignores) has its entries migrated into the wrapper rather than dropped —
 * that's the whole point of "rescue", since the file is otherwise inert.
 */
function codexEdits(env: InstallEnv, install: boolean): FileEdit[] {
  const path = `${env.home}/.codex/hooks.json`
  const doc = parseOrNull(env.existing(path))
  if (doc === undefined) return []
  const source: Record<string, any> = doc === null ? {} : doc

  const wrapped = isRecord(source['hooks'])
  const hooks: Record<string, any> = wrapped ? { ...source['hooks'] } : { ...source }

  if (install) {
    hooks[CODEX_KEY] = {
      command: `${env.hookPath} codex notify`,
      events: [...CODEX_EVENTS],
    }
  } else {
    if (!(CODEX_KEY in hooks)) return []
    delete hooks[CODEX_KEY]

    // Removing must never activate anything. If the file was in the legacy
    // unwrapped shape, Codex is currently ignoring it entirely — wrapping it
    // here would silently switch every dormant foreign hook on, as a side
    // effect of an uninstall. Write the legacy shape back untouched apart
    // from our own key.
    if (!wrapped) {
      const legacy = { ...source }
      delete legacy[CODEX_KEY]
      return [{ path, content: JSON.stringify(legacy, null, 2) + '\n', backup: true }]
    }
  }

  // Only reached when writing the wrapped shape (a fresh install, or an
  // uninstall that was already wrapped — the legacy-unwrapped uninstall path
  // above returns early). `rest` is whatever else sat beside `hooks` at the
  // top level; in the legacy unwrapped case every top-level key moved into
  // `hooks` above, so nothing legitimately survives in `rest`.
  const rest: Record<string, any> = { ...source }
  delete rest['hooks']
  const outerRest = wrapped ? rest : {}

  const root = { ...outerRest, hooks }
  return [{ path, content: JSON.stringify(root, null, 2) + '\n', backup: true }]
}

/**
 * Event sets nest under an arbitrary hook name. PreToolUse/PostToolUse are
 * grouped (matcher + hooks array, like Claude); PreInvocation/PostInvocation/
 * Stop are flat handler objects with no matcher and no hooks wrapper. Every
 * event gets a distinct command carrying its own event name, since
 * Antigravity payloads contain no event-name field at all.
 */
function antigravityEdits(env: InstallEnv, install: boolean): FileEdit[] {
  const path = `${env.home}/.gemini/config/hooks.json`
  const doc = parseOrNull(env.existing(path))
  if (doc === undefined) return []
  const root: Record<string, any> = doc === null ? {} : { ...doc }

  if (!install) {
    if (!(ANTIGRAVITY_KEY in root)) return []
    delete root[ANTIGRAVITY_KEY]
    return [{ path, content: JSON.stringify(root, null, 2) + '\n', backup: true }]
  }

  const set: Record<string, any> = {}

  for (const event of ANTIGRAVITY_GROUPED) {
    const mode = event === 'PreToolUse' ? 'permission' : 'notify'
    set[event] = [
      { matcher: '.*', hooks: [{ type: 'command', command: cmd(env, 'antigravity', mode, event) }] },
    ]
  }

  for (const event of ANTIGRAVITY_FLAT) {
    set[event] = [{ type: 'command', command: cmd(env, 'antigravity', 'notify', event) }]
  }

  root[ANTIGRAVITY_KEY] = set
  return [{ path, content: JSON.stringify(root, null, 2) + '\n', backup: true }]
}

export function planInstall(agent: AgentId, env: InstallEnv): FileEdit[] {
  if (agent === 'claude') return claudeEdits(env, true)
  if (agent === 'codex') return codexEdits(env, true)
  return antigravityEdits(env, true)
}

export function planUninstall(agent: AgentId, env: InstallEnv): FileEdit[] {
  if (agent === 'claude') return claudeEdits(env, false)
  if (agent === 'codex') return codexEdits(env, false)
  return antigravityEdits(env, false)
}
