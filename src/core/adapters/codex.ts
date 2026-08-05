import type { Decision, EventKind, HookContext } from '../types.js'
import type { AgentAdapter } from './index.js'
import { toTaskStatus } from '../tasks.js'
import type { AgentTask } from '../tasks.js'
import { detailFromToolInput } from './claude.js'
import { isRecord, str } from './shared.js'

/**
 * Captured from Codex CLI 0.146.0 — fixtures in `test/fixtures/codex/`, key
 * names recorded in `docs/agent-dialects.md`. Codex speaks Claude's dialect:
 * the same PascalCase `hook_event_name` values over the same `session_id` /
 * `cwd` / `tool_name` / `tool_input` / `transcript_path` fields.
 *
 * The dotted lowercase spelling earlier releases installed (`session.start`,
 * `tool.start`, ...) names no event Codex emits, and is gone from here as
 * well as from `CODEX_EVENTS` in `../install/plan.ts`.
 *
 * Codex also fires `PermissionRequest`, `PreCompact`, `PostCompact`,
 * `SubagentStart` and `SubagentStop`, none of which dasbo installs; it has no
 * `Notification` event, so Claude's idle-notification path has no counterpart.
 */
const KIND_BY_EVENT: Record<string, EventKind> = {
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
  shortName: 'Codex',
  procNames: ['codex'],

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
      agent: 'codex',
      kind,
      sessionId,
      cwd,
      tool: str(raw['tool_name']),
      detail: detailFromToolInput(raw['tool_input']) ?? str(raw['command']),
      transcriptPath: str(raw['transcript_path']),
      pid: ctx.pid,
      agentStartedAt: ctx.agentStartedAt,
      ts: ctx.ts,
    }
  },

  /**
   * UNVERIFIED, unlike the rest of this file. Codex's `update_plan` is
   * documented to carry `{ plan: [{ step, status }] }`, and the 0.146.0
   * capture session never drove the model into calling it, so no fixture
   * pins the shape. A shape that turns out to differ returns null here, which
   * leaves Codex rows without tasks rather than with wrong ones.
   *
   * The whole snapshot is rejected when one step is unusable, rather than that
   * step being skipped: the plan is a numbered sequence, and dropping an entry
   * from the middle would renumber everything after it.
   */
  parseTasks(raw: unknown): AgentTask[] | null {
    if (!isRecord(raw)) return null
    if (str(raw['tool_name']) !== 'update_plan') return null
    const input = raw['tool_input']
    if (!isRecord(input)) return null
    const plan = input['plan']
    if (!Array.isArray(plan)) return null

    const out: AgentTask[] = []
    for (let i = 0; i < plan.length; i++) {
      const item = plan[i]
      if (!isRecord(item)) return null
      const subject = str(item['step'])
      const status = toTaskStatus(item['status'])
      if (!subject || status === null) return null
      // Positional, because `update_plan` carries no ids of its own. The whole
      // plan arrives at once, so position is the only identity a step has.
      out.push({ id: String(i + 1), subject, status })
    }
    return out
  },

  /**
   * Unreachable while the installer wires Codex in notify mode only (see
   * `modeFor` in `../install/plan.ts`): Codex rejects `allow` and `ask` from a
   * PreToolUse hook and routes approvals through its own `PermissionRequest`
   * event instead. Kept, and kept honest, for whoever wires that event up.
   */
  encodeDecision(d: Decision) {
    // 'answer' joins 'fallthrough' here: Codex has no question concept, so it
    // can never receive one — and if it somehow did, emitting `d.kind` below
    // would put the string "answer" in a field that accepts only
    // allow/deny/ask.
    if (d.kind === 'fallthrough' || d.kind === 'answer') return {}
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
