import type { Decision, EventKind, HookContext } from '../types.js'
import type { AgentAdapter } from './index.js'
import { detailFromToolInput } from './claude.js'

/**
 * UNVERIFIED. Codex captured no fixtures in Task 2 — the environment was not
 * authenticated. Key names are taken from the installed vibe-island hook
 * script, which reads `type`, `session_id`, `cwd` and `tool_name`. Both the
 * dotted `type` names and the CamelCase `hook_event_name` names are accepted,
 * since the installed build and the published docs disagree about which is used.
 */
const KIND_BY_EVENT: Record<string, EventKind> = {
  'session.start': 'session-start',
  'session.end': 'stop',
  'tool.start': 'tool-start',
  'tool.end': 'tool-end',
  SessionStart: 'session-start',
  UserPromptSubmit: 'prompt-submit',
  PreToolUse: 'tool-start',
  PostToolUse: 'tool-end',
  Stop: 'stop',
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
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
