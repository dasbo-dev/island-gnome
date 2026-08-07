/**
 * The demo's script: one 30-second loop of synthetic agent events fed through
 * the extension's real SessionStore. Pure — no clock, no DOM — so the vitest
 * suite can pin the exact pill-state sequence the landing page claims to show.
 */
import { SessionStore } from '../src/core/store.js'
import { sessionKey } from '../src/core/types.js'
import type { AgentEvent, AgentId, EventKind } from '../src/core/types.js'
import type { AgentTask } from '../src/core/tasks.js'

/** One full pass of the demo, in virtual ms. The virtual clock starts at 0. */
export const LOOP_MS = 30_000

export interface TimelineStep {
  /** Virtual ms into the loop at which this step runs. */
  at: number
  apply: (store: SessionStore) => void
}

/**
 * The agents the demo drives. Narrower than `AgentId` on purpose: the page
 * beside this demo lists the agents this build supports, and a session for one
 * it does not would contradict the copy next to it.
 */
type DemoAgent = Extract<AgentId, 'claude' | 'codex'>

const IDS: Record<DemoAgent, string> = {
  claude: 'demo-claude',
  codex: 'demo-codex',
}
const CWDS: Record<DemoAgent, string> = {
  claude: '/home/you/projects/rocket',
  codex: '/home/you/projects/website',
}
const PIDS: Record<DemoAgent, number> = { claude: 4242, codex: 4243 }

export const KEYS: Record<DemoAgent, string> = {
  claude: sessionKey('claude', IDS.claude),
  codex: sessionKey('codex', IDS.codex),
}

function ev(agent: DemoAgent, kind: EventKind, at: number, extra?: Partial<AgentEvent>): TimelineStep {
  const e: AgentEvent = {
    agent,
    kind,
    sessionId: IDS[agent],
    cwd: CWDS[agent],
    pid: PIDS[agent],
    // Deliberately no agentStartedAt: the store's lineage seeds
    // conversationStartedAt from `agentStartedAt ?? ts`, so supplying 0 would
    // pin every session's startedAt to 0 and every row would show the same
    // elapsed time. Omitting it makes each session's clock start at its own
    // first event.
    ts: at,
    ...extra,
  }
  return { at, apply: (store) => store.apply(e) }
}

const SUBJECTS = [
  'Reproduce the flaky launch test',
  'Pin telemetry parser to a fixture',
  'Fix the countdown off-by-one',
  'Run the full test suite',
  'Update the changelog',
  'Tag v1.2.0',
] as const

/** First `completed` subjects done, next `inProgress` in progress, rest pending. */
function plan(completed: number, inProgress: number): AgentTask[] {
  return SUBJECTS.map((subject, i) => ({
    id: String(i + 1),
    subject,
    status: i < completed ? 'completed' : i < completed + inProgress ? 'in_progress' : 'pending',
  }))
}

function tasks(at: number, completed: number, inProgress: number): TimelineStep {
  return { at, apply: (store) => store.setTasks(KEYS.claude, plan(completed, inProgress)) }
}

export const TIMELINE: TimelineStep[] = [
  ev('claude', 'session-start', 0),
  ev('claude', 'prompt-submit', 400),
  ev('claude', 'tool-start', 1_200, { tool: 'Read', detail: 'src/launch/countdown.ts' }),
  tasks(1_600, 0, 1),
  ev('claude', 'tool-end', 2_200),
  ev('codex', 'session-start', 2_600),
  ev('codex', 'prompt-submit', 3_000),
  ev('claude', 'tool-start', 3_400, { tool: 'Bash', detail: 'npm test -- countdown' }),
  tasks(4_200, 1, 1),
  ev('claude', 'tool-end', 6_000),
  ev('codex', 'tool-start', 6_400, { tool: 'Bash', detail: 'vitest run' }),
  tasks(7_000, 2, 1),
  ev('claude', 'tool-start', 7_600, { tool: 'Edit', detail: 'src/launch/countdown.ts' }),
  ev('claude', 'tool-end', 8_600),
  {
    at: 9_000,
    apply: (store) =>
      store.setPending(KEYS.claude, {
        id: 'perm-1',
        tool: 'Bash',
        detail: 'git push origin main',
        deadline: 0,
        queued: 0,
      }),
  },
  { at: 13_000, apply: (store) => store.clearPending(KEYS.claude) },
  tasks(13_400, 4, 1),
  ev('codex', 'tool-end', 15_000),
  // The pill's `error` pose is one of the five the page claims to show, and
  // this is the only event that reaches it. It moved here from a session that
  // no longer exists; the retry two seconds later is what lets the pill leave
  // the state again, since `error` outranks `running` in pillState and would
  // otherwise hold the pill red until the loop ended.
  ev('codex', 'error', 16_000, { detail: 'hook payload rejected' }),
  ev('codex', 'tool-start', 18_000, { tool: 'Bash', detail: 'vitest run --retry 1' }),
  ev('codex', 'tool-end', 20_000),
  ev('codex', 'turn-end', 21_000),
  tasks(22_000, 6, 0),
  ev('claude', 'turn-end', 22_400),
  ev('claude', 'notification', 23_200, { detail: 'Ready to publish — waiting on you' }),
  ev('claude', 'session-end', 25_000),
  ev('codex', 'session-end', 26_500),
]

/** A fresh store with every step at or before `t` applied. */
export function storeAt(t: number): SessionStore {
  const store = new SessionStore()
  for (const step of TIMELINE) if (step.at <= t) step.apply(store)
  return store
}
