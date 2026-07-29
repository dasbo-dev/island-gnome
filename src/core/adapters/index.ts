import type { AgentEvent, AgentId, Decision, HookContext } from '../types.js'
import type { Question } from '../questions.js'
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
