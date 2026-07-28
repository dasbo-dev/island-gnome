import type { Decision, EventKind, HookContext } from '../types.js'
import type { AgentAdapter } from './index.js'
import { detailFromToolInput } from './claude.js'
import { isRecord, str } from './shared.js'

/**
 * UNVERIFIED. Codex captured no fixtures in Task 2 — the environment was not
 * authenticated. Key names are taken from the installed vibe-island hook
 * script, which reads `type`, `session_id`, `cwd` and `tool_name`. Both the
 * dotted `type` names and the CamelCase `hook_event_name` names are accepted,
 * since the installed build and the published docs disagree about which is used.
 *
 * Latent dead end: `CODEX_EVENTS` in `../install/plan.ts` only installs the
 * dotted lowercase spelling (`session.start`, `session.end`, `tool.start`,
 * `tool.end`) — there is no turn-level event in that spelling. The only
 * mapping to `turn-end` here is the CamelCase `Stop`, which Codex's installer
 * never writes. So an installed Codex session has no route back to `idle`
 * between tool calls; it would sit at `running` from its first tool call
 * until `session.end`. Impact today is zero — `docs/agent-dialects.md`
 * records that Codex hooks parse but never fire — but whoever revives Codex
 * support needs to either add a dotted turn event to `CODEX_EVENTS` (if one
 * exists) or install the CamelCase spelling instead.
 */
const KIND_BY_EVENT: Record<string, EventKind> = {
  'session.start': 'session-start',
  'session.end': 'session-end',
  'tool.start': 'tool-start',
  'tool.end': 'tool-end',
  SessionStart: 'session-start',
  SessionEnd: 'session-end',
  UserPromptSubmit: 'prompt-submit',
  PreToolUse: 'tool-start',
  PostToolUse: 'tool-end',
  Stop: 'turn-end',
}

export const codexAdapter: AgentAdapter = {
  id: 'codex',
  displayName: 'Codex CLI',

  normalize(raw, ctx) {
    if (!isRecord(raw)) return null

    const eventName = str(raw['type']) ?? str(raw['hook_event_name']) ?? ctx.event
    if (!eventName) return null
    const kind = KIND_BY_EVENT[eventName]
    if (!kind) return null

    const sessionId = str(raw['session_id'])
    if (!sessionId) return null

    const cwd = str(raw['cwd']) ?? ctx.cwd
    if (!cwd) return null

    return {
      agent: 'codex',
      kind,
      sessionId,
      cwd,
      tool: str(raw['tool_name']),
      detail: detailFromToolInput(raw['tool_input']) ?? str(raw['command']),
      transcriptPath: str(raw['transcript_path']),
      pid: ctx.pid,
      ts: ctx.ts,
    }
  },

  encodeDecision(d: Decision) {
    if (d.kind === 'fallthrough') return {}
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: d.kind,
        permissionDecisionReason:
          d.reason ?? (d.kind === 'allow' ? 'Allowed from Dasbo Island' : 'Denied from Dasbo Island'),
      },
    }
  },
}
