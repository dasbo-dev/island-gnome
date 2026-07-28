import type { Decision, EventKind, HookContext } from '../types.js'
import type { AgentAdapter } from './index.js'
import { isRecord, str } from './shared.js'

const KIND_BY_EVENT: Record<string, EventKind> = {
  PreInvocation: 'prompt-submit',
  PostInvocation: 'tool-end',
  PreToolUse: 'tool-start',
  PostToolUse: 'tool-end',
  Stop: 'turn-end',
}

/**
 * Antigravity nests the tool under `toolCall`, which is null on non-tool steps
 * even for tool events. Args are per-tool; these are the keys observed in the
 * captured fixtures. Unknown tools simply yield no detail.
 */
function detailFromToolCall(toolCall: unknown): string | undefined {
  if (!isRecord(toolCall)) return undefined
  const args = toolCall['args']
  if (!isRecord(args)) return undefined
  return str(args['CommandLine']) ?? str(args['TargetFile']) ?? str(args['Path'])
}

export const antigravityAdapter: AgentAdapter = {
  id: 'antigravity',
  displayName: 'Antigravity CLI',

  normalize(raw, ctx) {
    if (!isRecord(raw)) return null

    // No Antigravity payload names its own event; argv is the only source.
    if (!ctx.event) return null
    const baseKind = KIND_BY_EVENT[ctx.event]
    if (!baseKind) return null

    const sessionId = str(raw['conversationId'])
    if (!sessionId) return null

    const paths = raw['workspacePaths']
    const cwd = (Array.isArray(paths) ? str(paths[0]) : undefined) ?? ctx.cwd
    if (!cwd) return null

    // `error` is present but empty on success; only a non-empty value is a failure.
    const error = str(raw['error'])
    const toolCall = raw['toolCall']

    // A Stop carrying a non-empty error must still be terminal: reclassifying it
    // as 'error' would mean the session never reaches 'done', never gets a
    // doneAt, and lingers for the full 15-minute stale window instead of
    // done-linger. The error text is still surfaced via `detail` below.
    const kind = baseKind === 'turn-end' ? 'turn-end' : error ? 'error' : baseKind

    return {
      agent: 'antigravity',
      kind,
      sessionId,
      cwd,
      tool: isRecord(toolCall) ? str(toolCall['name']) : undefined,
      detail: error ?? detailFromToolCall(toolCall),
      transcriptPath: str(raw['transcriptPath']),
      pid: ctx.pid,
      ts: ctx.ts,
    }
  },

  // UNVERIFIED. Status reporting (normalize, above) is checked against 12 real
  // captured fixtures; this response shape is not. No fixture exercises the
  // permission-decision path, and docs/agent-dialects.md documents payload
  // shapes but never a response schema. If `agy` ignores this shape, clicking
  // Deny reports the tool as denied while it executes anyway — a security
  // control failing open, silently. Treat as best-effort until confirmed
  // against a real Antigravity permission round-trip.
  encodeDecision(d: Decision) {
    if (d.kind === 'fallthrough') return {}
    return {
      permissionDecision: d.kind,
      permissionDecisionReason:
        d.reason ?? (d.kind === 'allow' ? 'Allowed from Dasbo Island' : 'Denied from Dasbo Island'),
    }
  },
}
