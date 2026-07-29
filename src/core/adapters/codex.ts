import type { Decision, EventKind, HookContext } from '../types.js'
import type { AgentAdapter } from './index.js'
import { toTaskStatus } from '../tasks.js'
import type { AgentTask } from '../tasks.js'
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
  procNames: ['codex'],

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
      agentStartedAt: ctx.agentStartedAt,
      ts: ctx.ts,
    }
  },

  /**
   * UNVERIFIED, like everything else in this file. Codex's `update_plan` is
   * documented to carry `{ plan: [{ step, status }] }`, and no fixture has ever
   * been captured — `docs/agent-dialects.md` records that Codex hooks parse but
   * have never fired. A shape that turns out to differ returns null here, which
   * leaves Codex rows exactly as they are today.
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
