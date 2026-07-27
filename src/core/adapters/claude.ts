import type { Decision, EventKind, HookContext } from '../types.js'
import type { AgentAdapter } from './index.js'
import { isRecord, str } from './shared.js'

const KIND_BY_EVENT: Record<string, EventKind> = {
  SessionStart: 'session-start',
  UserPromptSubmit: 'prompt-submit',
  PreToolUse: 'tool-start',
  PostToolUse: 'tool-end',
  Stop: 'stop',
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
      // `bypassPermissions` is the only mode that asks about nothing at all.
      // `acceptEdits` still prompts for everything but file edits, and `plan`
      // still prompts, so both stay gated.
      permissionsBypassed:
        str(raw['permission_mode']) === 'bypassPermissions' ? true : undefined,
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
