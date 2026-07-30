import type { AgentId, FileEdit } from '../types.js'

export interface InstallEnv {
  home: string
  /** Absolute path to the installed dasbo-hook executable. */
  hookPath: string
  /** Current contents of a path, or null when the file does not exist. */
  existing: (path: string) => string | null
}

/** Config file each agent keeps its hook entries in. */
export function configPath(agent: AgentId, env: InstallEnv): string {
  if (agent === 'claude') return `${env.home}/.claude/settings.json`
  if (agent === 'codex') return `${env.home}/.codex/hooks.json`
  return `${env.home}/.gemini/config/hooks.json`
}

/** Marker used to recognise our own entries on uninstall and to stay idempotent. */
const MARKER = 'dasbo-hook'
const CODEX_KEY = 'dasbo-island'
const ANTIGRAVITY_KEY = 'dasbo-island'

const CLAUDE_EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd',
  'Notification',
] as const
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

/** Codex's single command, shared across all its events — see codexEdits. */
function codexCommand(env: InstallEnv): string {
  return `${env.hookPath} codex notify`
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

function isOurs(command: unknown): command is string {
  return typeof command === 'string' && command.includes(MARKER)
}

/**
 * The commands one Claude-style event array attributes to us.
 *
 * Presence on uninstall and presence in installState both read the file
 * through this single traversal, so the two can never drift into disagreeing
 * about whether anything of ours is in the file — which is exactly what a
 * round-trip diff of the *cleaned* array got wrong: it also fired for foreign
 * groups that the cleaning pass happened to normalise away.
 */
function ourCommandsIn(groups: unknown): string[] {
  if (!Array.isArray(groups)) return []
  const out: string[] = []
  for (const group of groups) {
    if (!isRecord(group) || !Array.isArray(group['hooks'])) continue
    for (const h of group['hooks']) {
      if (!isRecord(h)) continue
      const command = h['command']
      if (isOurs(command)) out.push(command)
    }
  }
  return out
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
  const path = configPath('claude', env)
  const doc = parseOrNull(env.existing(path))
  if (doc === undefined) return []
  const root: Record<string, any> = doc === null ? {} : { ...doc }
  const hooks: Record<string, any> = { ...(root['hooks'] ?? {}) }

  let changed = false
  for (const event of CLAUDE_EVENTS) {
    if (install) {
      const mode = event === 'PreToolUse' ? 'permission' : 'notify'
      const group: Record<string, any> = {
        hooks: [{ type: 'command', command: cmd(env, 'claude', mode, event) }],
      }
      if (event === 'PreToolUse' || event === 'PostToolUse') group['matcher'] = '*'
      hooks[event] = [...withoutOurs(hooks[event]), group]
      changed = true
    } else {
      // Only rewrite an event we actually have an entry under. Comparing the
      // cleaned array against the original instead would also fire for events
      // holding nothing but foreign junk — an empty `hooks` array, a group
      // that is not a record — and a Remove is not a licence to normalise
      // parts of the user's file that were never ours.
      if (ourCommandsIn(hooks[event]).length === 0) continue
      changed = true
      const cleaned = withoutOurs(hooks[event])
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
  const path = configPath('codex', env)
  const doc = parseOrNull(env.existing(path))
  if (doc === undefined) return []
  const source: Record<string, any> = doc === null ? {} : doc

  const wrapped = isRecord(source['hooks'])
  const hooks: Record<string, any> = wrapped ? { ...source['hooks'] } : { ...source }

  if (install) {
    hooks[CODEX_KEY] = {
      command: codexCommand(env),
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
  const path = configPath('antigravity', env)
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

export type InstallState = 'absent' | 'installed' | 'stale' | 'unreadable'

/**
 * Order-insensitive but duplicate-sensitive comparison. Order must not matter
 * because a hand edit or a foreign tool can reorder entries without changing
 * behaviour; duplicates must matter because a duplicated entry fires our hook
 * twice, and rewriting via planInstall is the repair.
 */
function sameStrings(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const x = [...a].sort()
  const y = [...b].sort()
  return x.every((v, i) => v === y[i])
}

/**
 * (event, command) pairs planInstall would write, encoded as a single string
 * per pair (`${event} ${command}`) so the existing sameStrings helper can
 * compare them. A space is a safe separator: none of our event names
 * (`PreToolUse`, `PostInvocation`, ...) contain one.
 */
function expectedClaudeEntries(env: InstallEnv): string[] {
  return CLAUDE_EVENTS.map(
    (event) => `${event} ${cmd(env, 'claude', event === 'PreToolUse' ? 'permission' : 'notify', event)}`
  )
}

function expectedAntigravityEntries(env: InstallEnv): string[] {
  return [
    ...ANTIGRAVITY_GROUPED.map(
      (event) => `${event} ${cmd(env, 'antigravity', event === 'PreToolUse' ? 'permission' : 'notify', event)}`
    ),
    ...ANTIGRAVITY_FLAT.map((event) => `${event} ${cmd(env, 'antigravity', 'notify', event)}`),
  ]
}

/** (event, command) pairs the file currently attributes to us, across the events we own. */
function presentClaudeEntries(root: Record<string, any>): string[] {
  const hooks = isRecord(root['hooks']) ? root['hooks'] : {}
  const out: string[] = []
  for (const event of CLAUDE_EVENTS) {
    for (const command of ourCommandsIn(hooks[event])) out.push(`${event} ${command}`)
  }
  return out
}

function presentAntigravityEntries(root: Record<string, any>): string[] {
  const set = isRecord(root[ANTIGRAVITY_KEY]) ? root[ANTIGRAVITY_KEY] : {}
  const out: string[] = []
  for (const event of ANTIGRAVITY_GROUPED) {
    const groups = Array.isArray(set[event]) ? set[event] : []
    for (const group of groups) {
      if (!isRecord(group) || !Array.isArray(group['hooks'])) continue
      for (const h of group['hooks']) {
        if (isRecord(h) && typeof h['command'] === 'string') out.push(`${event} ${h['command']}`)
      }
    }
  }
  for (const event of ANTIGRAVITY_FLAT) {
    const entries = Array.isArray(set[event]) ? set[event] : []
    for (const h of entries) {
      if (isRecord(h) && typeof h['command'] === 'string') out.push(`${event} ${h['command']}`)
    }
  }
  return out
}

/**
 * Our codex entry, and whether Codex would actually run it.
 *
 * An unwrapped file is never fresh, however well-formed our key looks inside
 * it: Codex 0.142 rejects such a file wholesale (`unknown field …, expected
 * 'hooks'`), so nothing fires. Reporting `installed` there would strand the
 * user — the row would say so with Install greyed out, and Install, which
 * wraps the file, is the one action that repairs it. Returning false makes
 * the state `stale`, the button `Update`, and the fix reachable.
 */
function codexMatches(env: InstallEnv, root: Record<string, any>): boolean {
  if (!isRecord(root['hooks'])) return false
  const hooks = root['hooks']
  const entry = hooks[CODEX_KEY]
  if (!isRecord(entry)) return false
  if (entry['command'] !== codexCommand(env)) return false
  const events = Array.isArray(entry['events'])
    ? entry['events'].filter((e: unknown): e is string => typeof e === 'string')
    : []
  return sameStrings(events, [...CODEX_EVENTS])
}

/**
 * Whether an agent's hooks are installed, and whether they still point at the
 * current hook path.
 *
 * Presence is delegated to planUninstall rather than re-derived, so for a
 * config file that parses, `installState() !== 'absent'` and "Remove has work
 * to do" can never disagree — the Remove button is never offered for a no-op.
 * A file that does not parse reports `unreadable`, which disables both
 * buttons: planInstall refuses to touch it either.
 *
 * Freshness compares what the file attributes to us against what planInstall
 * would write, as sorted lists, but *what* gets compared differs by agent.
 * For Claude and Antigravity it is (event, command) pairs, not bare command
 * strings: every command we write encodes its own event name (see cmd()), so
 * a command sitting under the wrong event — say ours for PreToolUse hand-moved
 * under PostToolUse — is a broken install even though the multiset of command
 * strings alone looks unchanged. Comparing pairs catches that; rewriting via
 * planInstall repairs it. For Codex there is only one command shared across
 * many events (see codexCommand), so the array of event names is what varies
 * and carries no per-command association — that stays a plain sorted-array
 * comparison. Comparing serialized text instead of either of these would
 * report a false `stale` for indentation, key order, or a foreign hook
 * appended after ours.
 */
export function installState(agent: AgentId, env: InstallEnv): InstallState {
  const doc = parseOrNull(env.existing(configPath(agent, env)))
  if (doc === undefined) return 'unreadable'
  if (planUninstall(agent, env).length === 0) return 'absent'
  const root = doc ?? {}
  const fresh =
    agent === 'claude'
      ? sameStrings(presentClaudeEntries(root), expectedClaudeEntries(env))
      : agent === 'codex'
        ? codexMatches(env, root)
        : sameStrings(presentAntigravityEntries(root), expectedAntigravityEntries(env))
  return fresh ? 'installed' : 'stale'
}
