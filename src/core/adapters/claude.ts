import type { Decision, EventKind, HookContext } from '../types.js'
import type { AgentAdapter } from './index.js'
import { isRecord, str } from './shared.js'
import { parseQuestions } from '../questions.js'

const KIND_BY_EVENT: Record<string, EventKind> = {
  SessionStart: 'session-start',
  UserPromptSubmit: 'prompt-submit',
  PreToolUse: 'tool-start',
  PostToolUse: 'tool-end',
  Stop: 'turn-end',
  SessionEnd: 'session-end',
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

/**
 * SessionStart `source` values that mean the user deliberately began a new
 * conversation in a process that kept running. An allowlist rather than
 * "anything but startup and resume": a source we have never seen should leave
 * the clock alone, because failing to reset it is today's behaviour while
 * resetting it wrongly would zero a live session's timer.
 *
 * `compact` is deliberately not here, though it does arrive as a SessionStart.
 * Compaction is the same conversation with its history summarised, and Claude
 * Code compacts on its own when the context window fills — counting it moved a
 * row's number and reset its clock with no user action at all. `/clear` is the
 * only source that means the person at the keyboard asked for a fresh start.
 *
 * The flag only *arms* the count; `SessionStore.apply` waits for the prompt
 * that follows before moving anything. See the comment on `Lineage`.
 */
const NEW_CONVERSATION_SOURCES = new Set(['clear'])

/**
 * The tools that move the task directory. `TodoWrite` is the old spelling —
 * Claude replaced it with the incremental `TaskCreate` / `TaskUpdate` pair —
 * and is kept because an install still emitting it writes the same directory,
 * so recognising it costs one string and buys those installs the feature.
 *
 * `TaskList` is here despite being a read: it is cheap to include, and an
 * agent that lists its tasks is an agent whose row is worth refreshing.
 */
const TASK_TOOLS: ReadonlySet<string> = new Set([
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TodoWrite',
])

export const claudeAdapter: AgentAdapter = {
  id: 'claude',
  displayName: 'Claude Code',
  procNames: ['claude'],
  taskTools: TASK_TOOLS,

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
      agentStartedAt: ctx.agentStartedAt,
      ts: ctx.ts,
      // `bypassPermissions` is the only mode that asks about nothing at all.
      // `acceptEdits` still prompts for everything but file edits, and `plan`
      // still prompts, so both stay gated.
      permissionsBypassed:
        str(raw['permission_mode']) === 'bypassPermissions' ? true : undefined,
      startsNewConversation:
        eventName === 'SessionStart' && NEW_CONVERSATION_SOURCES.has(str(raw['source']) ?? '')
          ? true
          : undefined,
    }
  },

  parseQuestions(raw) {
    if (!isRecord(raw)) return null
    if (str(raw['tool_name']) !== 'AskUserQuestion') return null
    return parseQuestions(raw['tool_input'])
  },

  encodeDecision(d: Decision) {
    // An answer is not a verdict, but `deny` is the only decision whose reason
    // the model is shown — there is no result channel on PreToolUse. The
    // wording that keeps this from reading as a refusal lives in
    // `formatAnswer`, which built `d.answer`.
    if (d.kind === 'answer') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: d.answer ?? 'The user gave no answer in Dasbo Island.',
        },
      }
    }
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
