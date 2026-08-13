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
  StopFailure: 'error',
  SessionEnd: 'session-end',
  Notification: 'notification',
}

/**
 * The `error` value Claude emits when it has no kind to report — its own
 * emitter defaults the field to this literal. It is a placeholder, not a
 * description, so it never becomes a row's detail: with no detail the row falls
 * back to the island's own word for the state, which says exactly as much and
 * says it in the extension's vocabulary.
 */
const UNKNOWN_ERROR = 'unknown'

/**
 * What a `StopFailure` should put on the row.
 *
 * Three fields can carry it, in descending order of specificity.
 * `error_details` is the API's own text and is the narrowest thing available —
 * it is what the prompt-too-long path fills in. `last_assistant_message` is
 * what the user actually saw in their terminal ("API Error: 400 …" in the
 * captured fixture), which is right whenever there is nothing narrower but is
 * a paragraph of prose on the paths that also set `error_details`. `error` is
 * a slug (`rate_limit`, `server_error`, `authentication_failed`, …) and is the
 * last resort, minus the one value that is not a slug at all.
 */
function detailFromFailure(raw: Record<string, unknown>): string | undefined {
  const kind = str(raw['error'])
  return (
    str(raw['error_details']) ??
    str(raw['last_assistant_message']) ??
    (kind === UNKNOWN_ERROR ? undefined : kind)
  )
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
 * `SessionEnd` `reason` value Claude uses for `/clear`. Like `SessionEnd`
 * itself, this is inferred rather than captured — there is no fixture for it
 * in test/fixtures/claude/, and docs/agent-dialects.md, while it does discuss
 * the hook, records it as uncaptured and documents no `reason` field (or any
 * other key name) for it. So this is written from the published shape (reason
 * values `clear`, `logout`, `prompt_input_exit`, `other`), the way
 * NEW_CONVERSATION_SOURCES was before SessionStart fixtures existed to check
 * it against.
 */
const CLEAR_END_REASON = 'clear'

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
  shortName: 'Claude',
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
      // A Notification carries its text in `message` and has no tool_input; a
      // tool event has tool_input and no message; a StopFailure carries neither
      // and reports the failure across three fields of its own. None of the
      // three can contend for this field, so each needs no field of its own on
      // AgentEvent.
      detail:
        kind === 'notification'
          ? str(raw['message'])
          : kind === 'error'
            ? detailFromFailure(raw)
            : detailFromToolInput(raw['tool_input']),
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
      endedByClear:
        eventName === 'SessionEnd' && str(raw['reason']) === CLEAR_END_REASON
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
          permissionDecisionReason: d.answer ?? 'The user closed Dasbo Island without answering — ask again here.',
        },
      }
    }
    const permissionDecision =
      d.kind === 'allow' ? 'allow' : d.kind === 'deny' ? 'deny' : 'ask'
    const defaultReason =
      d.kind === 'allow' ? 'Allowed from Dasbo Island'
      : d.kind === 'deny' ? 'Denied from Dasbo Island'
      : 'Dasbo Island timed out — ask the user here instead.'
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision,
        permissionDecisionReason: d.reason ?? defaultReason,
      },
    }
  },
}
