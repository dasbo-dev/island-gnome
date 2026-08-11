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
/**
 * The hook name every dasbo release before this one wrote into
 * ~/.codex/hooks.json, in the named-hook form `{command, events}`. Codex
 * parses that form and never fires it (see docs/agent-dialects.md), so the key
 * is dead weight: install and uninstall both clear it.
 */
const CODEX_LEGACY_KEY = 'dasbo-island'
const ANTIGRAVITY_KEY = 'dasbo-island'

const CLAUDE_EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd',
  'Notification',
] as const
/**
 * Codex's own vocabulary, all six verified firing on 0.146.0 (fixtures in
 * `test/fixtures/codex/`). Codex has no `Notification` event; it does have
 * `PermissionRequest`, `PreCompact`, `PostCompact`, `SubagentStart` and
 * `SubagentStop`, none of which dasbo listens for yet.
 */
const CODEX_EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd',
] as const
const ANTIGRAVITY_GROUPED = ['PreToolUse', 'PostToolUse'] as const
const ANTIGRAVITY_FLAT = ['PreInvocation', 'PostInvocation', 'Stop'] as const

/**
 * Every event gets its own command carrying the event name, so a hook line
 * is self-describing even for agents whose payload already names the event
 * (Claude, Codex) and load-bearing for the one that has no event field at all
 * (Antigravity).
 *
 * Run through `gjs -m` rather than as a bare path, so the hook's executable
 * bit stops being load-bearing: nothing in this tree ever sets it, and a
 * dropped mode would make every hook fail silently. Bare `gjs`, not
 * /usr/bin/gjs, because not every distribution puts it there — and any machine
 * running GNOME Shell has it on PATH. The `dasbo-hook` substring survives in
 * the new string, so isOurs() still recognises entries written either way and
 * the upgrade rides the existing stale/Update path.
 */
function cmd(env: InstallEnv, agent: AgentId, mode: 'notify' | 'permission', event: string): string {
  return `gjs -m ${env.hookPath} ${agent} ${mode} ${event}`
}

/**
 * Only Claude gates tool calls through us. Codex refuses a PreToolUse hook
 * that answers `permissionDecision: allow` or `: ask` — its approval flow
 * rides a separate `PermissionRequest` event — so asking it for a decision
 * would turn every tool call into a hook error instead of a prompt. Codex
 * events are therefore all notify.
 */
function modeFor(agent: AgentId, event: string): 'notify' | 'permission' {
  return agent === 'claude' && event === 'PreToolUse' ? 'permission' : 'notify'
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

/**
 * Claude's hook shape, which Codex 0.146 also takes at ~/.codex/hooks.json: an
 * event-keyed map under `hooks`, each event holding groups of command
 * handlers. Only the path, the event list and the per-event mode differ
 * between the two agents.
 */
function eventMapEdits(agent: 'claude' | 'codex', events: readonly string[], env: InstallEnv, install: boolean): FileEdit[] {
  const path = configPath(agent, env)
  const doc = parseOrNull(env.existing(path))
  if (doc === undefined) return []
  const root: Record<string, any> = doc === null ? {} : { ...doc }
  const hooks: Record<string, any> = { ...(root['hooks'] ?? {}) }

  let changed = false

  // Whichever way this call goes, an entry in the shape Codex never fires is
  // ours to clear: leaving it behind would keep a dead hook in the file that
  // installState then has to keep reporting as stale.
  if (agent === 'codex' && isOurs((hooks[CODEX_LEGACY_KEY] as any)?.command)) {
    delete hooks[CODEX_LEGACY_KEY]
    changed = true
  }

  for (const event of events) {
    if (install) {
      const group: Record<string, any> = {
        hooks: [{ type: 'command', command: cmd(env, agent, modeFor(agent, event), event) }],
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
  if (agent === 'claude') return eventMapEdits('claude', CLAUDE_EVENTS, env, true)
  if (agent === 'codex') return eventMapEdits('codex', CODEX_EVENTS, env, true)
  return antigravityEdits(env, true)
}

export function planUninstall(agent: AgentId, env: InstallEnv): FileEdit[] {
  if (agent === 'claude') return eventMapEdits('claude', CLAUDE_EVENTS, env, false)
  if (agent === 'codex') return eventMapEdits('codex', CODEX_EVENTS, env, false)
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
function expectedEventMapEntries(agent: 'claude' | 'codex', events: readonly string[], env: InstallEnv): string[] {
  return events.map((event) => `${event} ${cmd(env, agent, modeFor(agent, event), event)}`)
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
function presentEventMapEntries(events: readonly string[], root: Record<string, any>): string[] {
  const hooks = isRecord(root['hooks']) ? root['hooks'] : {}
  const out: string[] = []
  for (const event of events) {
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
 * True when the file still holds our entry in the named-hook shape Codex
 * parses and never fires. A file carrying one is never fresh, however correct
 * the event-keyed entries beside it look: leaving a dead hook of ours in the
 * file is exactly what Update exists to clean up.
 */
function hasLegacyCodexEntry(root: Record<string, any>): boolean {
  const hooks = isRecord(root['hooks']) ? root['hooks'] : {}
  const entry = hooks[CODEX_LEGACY_KEY]
  return isRecord(entry) && isOurs(entry['command'])
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
 * would write, as sorted lists of (event, command) pairs rather than bare
 * command strings: every command we write encodes its own event name (see
 * cmd()), so a command sitting under the wrong event — say ours for PreToolUse
 * hand-moved under PostToolUse — is a broken install even though the multiset
 * of command strings alone looks unchanged. Comparing pairs catches that;
 * rewriting via planInstall repairs it. Codex adds one extra condition: a
 * leftover named-hook entry of ours (the shape releases before this one wrote)
 * makes the install stale even when the event map is otherwise exact.
 * Comparing serialized text instead would report a false `stale` for
 * indentation, key order, or a foreign hook appended after ours.
 */
export function installState(agent: AgentId, env: InstallEnv): InstallState {
  const doc = parseOrNull(env.existing(configPath(agent, env)))
  if (doc === undefined) return 'unreadable'
  if (planUninstall(agent, env).length === 0) return 'absent'
  const root = doc ?? {}
  const fresh =
    agent === 'claude'
      ? sameStrings(presentEventMapEntries(CLAUDE_EVENTS, root), expectedEventMapEntries('claude', CLAUDE_EVENTS, env))
      : agent === 'codex'
        ? !hasLegacyCodexEntry(root) &&
          sameStrings(presentEventMapEntries(CODEX_EVENTS, root), expectedEventMapEntries('codex', CODEX_EVENTS, env))
        : sameStrings(presentAntigravityEntries(root), expectedAntigravityEntries(env))
  return fresh ? 'installed' : 'stale'
}
