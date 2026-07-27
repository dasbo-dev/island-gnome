export type AgentId = 'claude' | 'codex' | 'antigravity'

export type SessionState = 'idle' | 'running' | 'waiting' | 'done' | 'error'

export type EventKind =
  | 'session-start'
  | 'prompt-submit'
  | 'tool-start'
  | 'tool-end'
  | 'stop'
  | 'error'

/** An agent hook payload after dialect normalisation. */
export interface AgentEvent {
  agent: AgentId
  kind: EventKind
  sessionId: string
  cwd: string
  /** Tool name for tool-start / tool-end, otherwise undefined. */
  tool?: string
  /** Human-readable detail, e.g. the bash command being run. */
  detail?: string
  transcriptPath?: string
  /** PID of the hook process, used as the seed for jump-back ancestry. */
  pid: number
  /** Milliseconds since epoch, supplied by the caller, never read from a clock here. */
  ts: number
}

export interface PendingPermission {
  id: string
  tool: string
  detail?: string
  /** Milliseconds since epoch when this request must fall through. 0 means never. */
  deadline: number
}

export interface Session {
  key: string
  agent: AgentId
  sessionId: string
  project: string
  cwd: string
  state: SessionState
  currentTool?: string
  detail?: string
  pid: number
  startedAt: number
  lastEventAt: number
  /** Set when state became 'done'; used for the done-linger sweep. */
  doneAt?: number
  transcriptPath?: string
  pendingPermission?: PendingPermission
}

export type DecisionKind = 'allow' | 'deny' | 'fallthrough'

export interface Decision {
  kind: DecisionKind
  reason?: string
}

export interface FileEdit {
  path: string
  /** Full desired content of the file after the edit. */
  content: string
  /** When true, write `<path>.dasbo.bak` first if the file exists and no backup is present. */
  backup: boolean
}

export function sessionKey(agent: AgentId, sessionId: string): string {
  return `${agent}:${sessionId}`
}

export function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, '')
  const i = trimmed.lastIndexOf('/')
  return i === -1 ? trimmed : trimmed.slice(i + 1)
}
