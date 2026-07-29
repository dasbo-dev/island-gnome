import type { AgentEvent, AgentId, Decision, HookContext } from '../types.js'
import type { Question } from '../questions.js'
import type { AgentTask } from '../tasks.js'
import { claudeAdapter } from './claude.js'
import { codexAdapter } from './codex.js'
import { antigravityAdapter } from './antigravity.js'

export interface AgentAdapter {
  id: AgentId
  displayName: string
  /**
   * `comm` values (/proc field 2) identifying this agent's own process, used to
   * pick it out of a hook's ancestor chain. Max 15 characters: the kernel
   * truncates `comm` there.
   */
  procNames: string[]
  normalize(raw: unknown, ctx: HookContext): AgentEvent | null
  /**
   * The questions this payload asks the user, or null if it asks none.
   *
   * Optional because only Claude Code has the concept: Codex and Antigravity
   * have no equivalent tool, so they leave this undefined and the service's
   * `?.()` call falls straight through to ordinary permission gating.
   */
  parseQuestions?(raw: unknown): Question[] | null
  /**
   * Tool names whose completion means this agent's on-disk task list may have
   * moved. Optional because it only means anything for an agent that keeps one
   * — Claude does, and its directory is read by `src/shell/taskReader.ts`.
   *
   * A rename in this set is a silent feature death, which is why the popup
   * re-reads on every open regardless: the worst a stale name can do is delay
   * the refresh until the user looks.
   */
  taskTools?: ReadonlySet<string>
  /**
   * The agent's whole plan, when it ships one inside the payload rather than
   * writing it to disk. Optional for the same reason `parseQuestions` is: only
   * some dialects have the concept, and `?.()` at the call site falls straight
   * through for the rest.
   */
  parseTasks?(raw: unknown): AgentTask[] | null
  encodeDecision(d: Decision): unknown
}

export const adapters: Record<AgentId, AgentAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  antigravity: antigravityAdapter,
}

export function isAgentId(v: string): v is AgentId {
  return v === 'claude' || v === 'codex' || v === 'antigravity'
}

export function normalizeFor(agent: AgentId, raw: unknown, ctx: HookContext): AgentEvent | null {
  return adapters[agent].normalize(raw, ctx)
}
