import type { AgentTask } from './tasks.js'
import type { Question } from './questions.js'

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
  | 'notification'
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
   * Set when this event announces that the user has asked for a conversation
   * distinct from the one before it, inside an agent process that keeps
   * running — Claude's `/clear`. Only adapters whose dialect can tell set it,
   * so absence means "same conversation, or no way to know". Never `false`: a
   * single truthiness test is all any consumer should need.
   *
   * It announces, it does not begin: an emptied prompt box is not a
   * conversation until something is said into it, so `SessionStore.apply`
   * arms the lineage here and waits for the next `prompt-submit` to move the
   * count and the clock.
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

/**
 * A question the agent asked and the island is holding open. Deliberately
 * separate from PendingPermission rather than a union of the two: both
 * `activityText` and the row's control attachment branch on these, and a union
 * would make every consumer re-narrow before it could read a field.
 *
 * There is no queued count and no tool name, because neither means anything
 * here — a question is not a tool call, and a second question queued behind
 * this one is simply invisible until this one resolves.
 *
 * Which question the panel is showing, and what has been picked so far, are
 * *not* here. They belong to the widget and live only as long as it does; the
 * store records what the agent reported, and routing every option click through
 * a store mutation would fire a subscriber notification — and so a full row
 * rebuild — under the user's cursor.
 */
export interface PendingQuestion {
  id: string
  questions: Question[]
  /** Milliseconds since epoch when this request must fall through. 0 means never. */
  deadline: number
}

/**
 * Something an agent said while nothing was happening — Claude's Notification
 * hook. Not a state: `apply` sets this and returns without touching `state`,
 * `currentTool` or `detail`, because a notification is the absence of activity
 * rather than a kind of it.
 *
 * `until` is a deadline in ms since the epoch. Zero means no clock at all, in
 * which case only the next event ends it — the same reading `permission-timeout`
 * gives to zero.
 */
export interface SessionNotice {
  text: string
  until: number
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
   * When the current conversation began — the first prompt of it, not the
   * `/clear` that made room for it. Equal to the agent process's start time
   * until the user clears and then says something, which begins a new
   * conversation inside a process that keeps running — see SessionStore's
   * lineage map.
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
  /** Mutually exclusive with pendingPermission: the store clears each when setting the other. */
  pendingQuestion?: PendingQuestion
  /**
   * Cleared by any event other than a notification, and by setPending /
   * setPendingQuestion — a notice describes a silence, and all of those are
   * proof the silence is over. Never restored by clearPending: an interrupted
   * notice is spent.
   */
  notice?: SessionNotice
  /**
   * The agent's plan, as of the last time it was read. Undefined means "never
   * seen one", an empty array means "looked and found none"; the row draws both
   * the same way, so nothing downstream has to tell them apart.
   *
   * Nothing clears this but the death of the record. A `/clear` mints a new
   * session id and therefore a new record, so a finished plan keeps reading
   * 10/10 for the rest of its conversation — which is true, not stale.
   */
  tasks?: AgentTask[]
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
   * minted, and stale whenever the lineage map was at its cap on the last
   * event and this process's lineage was not already in it — no lineage
   * resolves there, so the pid moves on without this, and the record goes on
   * naming a lineage it has left. Read back rather than rebuilt, because
   * rebuilding the key from this record's own pid and processStartedAt would
   * use two fields that can come from different events and no longer form the
   * pair a lineage was keyed on. Can name a different lineage than the one
   * conversationIndex was numbered from — a resume under a new pid moves this
   * forward without renumbering the record — which is intended: pruneLineages
   * wants to know what is referenced *now*, not what a past conversation was
   * counted by.
   */
  lineageKey?: string
}

/**
 * `answer` is not a permission verdict. It carries the user's reply to an
 * agent's question, and every adapter that has no question concept must map it
 * to the same silence it uses for `fallthrough` — never onto a permission
 * field, where the string `"answer"` would be an invalid decision value.
 */
export type DecisionKind = 'allow' | 'deny' | 'fallthrough' | 'answer'

export interface Decision {
  kind: DecisionKind
  reason?: string
  /** Set only for `kind: 'answer'`. The complete text built by `formatAnswer`. */
  answer?: string
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
