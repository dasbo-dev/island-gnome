export type AgentId = 'claude' | 'codex' | 'antigravity'

/**
 * What the hook process knows about an event, independent of the payload.
 * Adapters prefer payload values where they exist and fall back to these.
 */
export interface HookContext {
  /**
   * PID of the agent process, resolved from the hook's ancestry by
   * `resolveAgent`. 0 when the agent could not be identified.
   */
  pid: number
  /**
   * When the agent process started, in ms since the epoch, resolved from /proc
   * by the shell layer. Undefined when /proc could not supply it; the store
   * then falls back to the event timestamp.
   */
  agentStartedAt?: number
  /** Milliseconds since epoch, supplied by the caller so adapters stay pure. */
  ts: number
  /** Working directory of the hook process. Used when the payload carries no cwd. */
  cwd: string
  /** Event name from argv. Used when the payload carries no event field. */
  event?: string
}

export type SessionState = 'idle' | 'running' | 'waiting' | 'done' | 'error'

export type EventKind =
  | 'session-start'
  | 'prompt-submit'
  | 'tool-start'
  | 'tool-end'
  | 'turn-end'
  | 'session-end'
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
  /**
   * PID of the agent process, resolved from the hook's ancestry by
   * `resolveAgent`. 0 when the agent could not be identified.
   */
  pid: number
  /**
   * When the agent process started, in ms since the epoch, resolved from /proc
   * by the shell layer. Undefined when /proc could not supply it; the store
   * then falls back to the event timestamp.
   */
  agentStartedAt?: number
  /** Milliseconds since epoch, supplied by the caller, never read from a clock here. */
  ts: number
  /**
   * Set when the agent is in a mode that never asks the user about tools. Agents
   * still run their pre-tool hook in such a mode, so without this the island
   * would gate a call the agent had already decided to allow. Left undefined
   * whenever the agent would ask, so absence always means "gate normally".
   */
  permissionsBypassed?: boolean
  /**
   * Set when this event begins a conversation distinct from the one before it,
   * inside an agent process that keeps running — Claude's `/clear` and
   * `/compact`. Only adapters whose dialect can tell set it, so absence means
   * "same conversation, or no way to know". Never `false`: a single truthiness
   * test is all any consumer should need.
   */
  startsNewConversation?: boolean
}

export interface PendingPermission {
  id: string
  tool: string
  detail?: string
  /** Milliseconds since epoch when this request must fall through. 0 means never. */
  deadline: number
  /** How many further requests for this session are waiting behind this one. */
  queued: number
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
  /**
   * When the current conversation began. Equal to the agent process's start
   * time until the user clears or compacts, which begins a new conversation
   * inside a process that keeps running — see SessionStore's lineage map.
   */
  startedAt: number
  /** 1-based. Which conversation this is within its agent process. */
  conversationIndex: number
  /**
   * When the agent process started, in ms since the epoch, resolved from /proc
   * by the shell layer. Undefined when /proc could not supply it. Distinct from
   * startedAt, which moves with the conversation while this does not.
   */
  processStartedAt?: number
  lastEventAt: number
  /** Set when a session-end arrives; used for the done-linger sweep. */
  doneAt?: number
  transcriptPath?: string
  pendingPermission?: PendingPermission
  /**
   * What the most recent event would have set the state to, recorded while a
   * permission is pending so clearPending can settle to it. Undefined when no
   * event arrived during the hold.
   */
  deferredState?: SessionState
  /**
   * The key of the lineage the most recent event resolved to, written
   * whenever pid is refreshed rather than once at creation — a session id can
   * outlive its process (`claude --resume` reuses the id under a new pid), so
   * every event has to re-pin the record to whatever process it now belongs
   * to. Undefined when the agent could not be identified and no lineage was
   * minted. Read back rather than rebuilt, because rebuilding the key from
   * this record's own pid and processStartedAt would use two fields that can
   * come from different events and no longer form the pair a lineage was
   * keyed on. Can name a different lineage than the one conversationIndex was
   * numbered from — a resume under a new pid moves this forward without
   * renumbering the record — which is intended: pruneLineages wants to know
   * what is referenced *now*, not what a past conversation was counted by.
   */
  lineageKey?: string
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
