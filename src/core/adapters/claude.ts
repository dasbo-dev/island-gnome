import type { AgentEvent, AgentId, Decision, EventKind, HookContext } from '../types.js'

export interface AgentAdapter {
  id: AgentId
  displayName: string
  /**
   * Convert a raw agent hook payload into an AgentEvent.
   * Everything not in the payload comes from `ctx`, so this stays pure.
   * Returns null when the payload is unusable — the caller drops it.
   */
  normalize(raw: unknown, ctx: HookContext): AgentEvent | null
  /** Convert an internal Decision into this agent's stdout JSON. */
  encodeDecision(d: Decision): unknown
}

const KIND_BY_EVENT: Record<string, EventKind> = {
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

/** Pick the most useful human-readable detail out of a Claude tool_input blob. */
export function detailFromToolInput(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined
  return (
    str(input['command']) ??
    str(input['file_path']) ??
    str(input['path']) ??
    str(input['pattern']) ??
    str(input['url'])
  )
}

export const claudeAdapter: AgentAdapter = {
  id: 'claude',
  displayName: 'Claude Code',

  normalize(raw, ctx) {
    if (!isRecord(raw)) return null

    const eventName = str(raw['hook_event_name']) ?? ctx.event
    if (!eventName) return null
    const kind = KIND_BY_EVENT[eventName]
    if (!kind) return null

    const sessionId = str(raw['session_id'])
    if (!sessionId) return null

    const cwd = str(raw['cwd']) ?? ctx.cwd
    if (!cwd) return null

    return {
      agent: 'claude',
      kind,
      sessionId,
      cwd,
      tool: str(raw['tool_name']),
      detail: detailFromToolInput(raw['tool_input']),
      transcriptPath: str(raw['transcript_path']),
      pid: ctx.pid,
      ts: ctx.ts,
    }
  },

  encodeDecision(d: Decision) {
    const permissionDecision =
      d.kind === 'allow' ? 'allow' : d.kind === 'deny' ? 'deny' : 'ask'
    const defaultReason =
      d.kind === 'allow' ? 'Allowed from Dasbo Island'
      : d.kind === 'deny' ? 'Denied from Dasbo Island'
      : 'Dasbo Island did not decide'
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision,
        permissionDecisionReason: d.reason ?? defaultReason,
      },
    }
  },
}
