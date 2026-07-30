import { isRecord, str } from './adapters/shared.js'

/**
 * The three states an agent's task can be in. `deleted` is deliberately absent:
 * Claude removes the file rather than writing that status, so a task in this
 * vocabulary is always one the agent still intends to do.
 */
export type TaskStatus = 'pending' | 'in_progress' | 'completed'

/**
 * One entry of an agent's plan, reduced to what the row draws. `description`,
 * `activeForm`, `blocks` and `blockedBy` are parsed away here rather than
 * carried and ignored: the row shows one line per task, and a field the UI
 * never reads is a field that can go stale without anyone noticing.
 */
export interface AgentTask {
  id: string
  subject: string
  status: TaskStatus
}

const STATUSES = new Set<string>(['pending', 'in_progress', 'completed'])

/** Narrow an untrusted value to the status vocabulary, or null. */
export function toTaskStatus(v: unknown): TaskStatus | null {
  const s = str(v)
  return s !== undefined && STATUSES.has(s) ? (s as TaskStatus) : null
}

/**
 * One `<id>.json` from an agent's task directory, validated into something the
 * row can render. Returns null for anything that does not match — the same
 * contract `parseQuestions` keeps, so an on-disk format that changes under us
 * degrades to "no counter" rather than to a list built from undefined.
 */
export function parseTaskFile(raw: unknown): AgentTask | null {
  if (!isRecord(raw)) return null
  const id = str(raw['id'])
  const subject = str(raw['subject'])
  const status = toTaskStatus(raw['status'])
  if (!id || !subject || status === null) return null
  return { id, subject, status }
}

/**
 * Ascending by id, numerically. Lexical order would file `10` before `9`, and
 * the id is the only ordering the files carry — the directory hands them back
 * in whatever order the filesystem chose. A non-numeric id sorts after every
 * numeric one, by string, so an unexpected id cannot silently jump the queue.
 */
export function sortTasks(tasks: AgentTask[]): AgentTask[] {
  return [...tasks].sort((a, b) => {
    const na = Number(a.id)
    const nb = Number(b.id)
    const aNum = Number.isFinite(na)
    const bNum = Number.isFinite(nb)
    if (aNum && bNum) return na - nb
    if (aNum) return -1
    if (bNum) return 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/** What the row's `completed/total` counter reads. */
export function summarize(tasks: AgentTask[]): { completed: number; total: number } {
  let completed = 0
  for (const t of tasks) if (t.status === 'completed') completed += 1
  return { completed, total: tasks.length }
}

/**
 * Whether two lists would draw identically. Used twice, and load-bearing both
 * times: the store skips its emit when nothing moved, and TaskList skips its
 * rebuild — an unconditional one would churn actors under the popup's own
 * scroll position and can change the body's height, throwing a reader
 * part-way down a long plan somewhere else entirely.
 */
export function sameTasks(a: AgentTask[] | undefined, b: AgentTask[] | undefined): boolean {
  const x = a ?? []
  const y = b ?? []
  if (x.length !== y.length) return false
  for (let i = 0; i < x.length; i++) {
    const p = x[i]!
    const q = y[i]!
    if (p.id !== q.id || p.status !== q.status || p.subject !== q.subject) return false
  }
  return true
}
