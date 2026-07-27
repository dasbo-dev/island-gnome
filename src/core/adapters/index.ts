import type { AgentEvent, AgentId, Decision, HookContext } from '../types.js'
import { claudeAdapter } from './claude.js'
import { codexAdapter } from './codex.js'
import { antigravityAdapter } from './antigravity.js'

export interface AgentAdapter {
  id: AgentId
  displayName: string
  normalize(raw: unknown, ctx: HookContext): AgentEvent | null
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
