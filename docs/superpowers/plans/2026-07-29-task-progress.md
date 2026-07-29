# Task List and Progress Counter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put an agent's plan on its session row — `3/10` beside the clock, and the task list itself with a status glyph per entry behind the existing expander arrow.

**Architecture:** Claude writes its task list to `~/.claude/tasks/<session_id>/<id>.json`, keyed on the same session id the store already holds. A `PostToolUse` for a task tool marks the session dirty; the Island reads the directory asynchronously when the popup is open, and hands the parsed list to `SessionStore.setTasks`. Codex has no such directory, so its adapter parses `update_plan` straight out of the payload into the same store method. The row derives the counter from `session.tasks` in `update()`, and a new `TaskList` widget renders the entries inside an `St.ScrollView`.

**Tech Stack:** TypeScript, GJS / GNOME Shell 46 (St, Clutter, GObject, Gio, GLib), esbuild, vitest.

Spec: `docs/superpowers/specs/2026-07-29-task-progress-design.md`

## Global Constraints

- `src/core/` must never import `gi://` or `resource://`. `test/core/purity.test.ts` enforces it. Everything touching the filesystem lives in `src/shell/`.
- `src/shell/`, `src/dbus/` and `src/prefs.ts` have no unit tests and cannot get them — they need a running GNOME Shell. Their verification is `npm run typecheck` plus the manual `tools/fake-agent.js` drive described in each task.
- No blocking filesystem calls on the compositor thread. Every read in `taskReader.ts` uses the `_async` / `_finish` pair.
- `session_id` arrives from an untrusted D-Bus payload and is interpolated into a path. It must be exactly one ordinary path component — rejected if it contains `/` or starts with `.`.
- Target: GNOME Shell 46, TypeScript 5.6, vitest 2.1.
- Full test command: `npm test`. Typecheck: `npm run typecheck` (runs both tsconfigs and sums exit codes). Build: `npm run build`.
- Commit style follows the existing log: `feat(core):`, `feat(shell):`, `fix(shell):`, `test(core):`, `docs:`.
- Status vocabulary is exactly `pending` | `in_progress` | `completed`. A `deleted` task has its file removed and never appears.

---

### Task 1: Parse a task file

**Files:**
- Create: `src/core/tasks.ts`
- Test: `test/core/tasks.test.ts`

**Interfaces:**
- Consumes: `isRecord`, `str` from `src/core/adapters/shared.js`.
- Produces:
  - `type TaskStatus = 'pending' | 'in_progress' | 'completed'`
  - `interface AgentTask { id: string; subject: string; status: TaskStatus }`
  - `function toTaskStatus(v: unknown): TaskStatus | null`
  - `function parseTaskFile(raw: unknown): AgentTask | null`
  - `function sortTasks(tasks: AgentTask[]): AgentTask[]`
  - `function summarize(tasks: AgentTask[]): { completed: number; total: number }`
  - `function sameTasks(a: AgentTask[] | undefined, b: AgentTask[] | undefined): boolean`

- [ ] **Step 1: Write the failing test**

Create `test/core/tasks.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  parseTaskFile,
  sortTasks,
  summarize,
  sameTasks,
  toTaskStatus,
  type AgentTask,
} from '../../src/core/tasks.js'

/** Copied verbatim from ~/.claude/tasks/<session>/9.json on a real session. */
const realFile = {
  id: '9',
  subject: 'Task 9: QuestionPanel widget',
  description: 'src/shell/questionPanel.ts plus stylesheet rules',
  activeForm: 'Building the question panel',
  status: 'completed',
  blocks: [],
  blockedBy: [],
}

function task(over: Partial<AgentTask> = {}): AgentTask {
  return { id: '1', subject: 'Explore project context', status: 'pending', ...over }
}

describe('parseTaskFile', () => {
  it('keeps the three fields the row renders and drops the rest', () => {
    expect(parseTaskFile(realFile)).toEqual({
      id: '9',
      subject: 'Task 9: QuestionPanel widget',
      status: 'completed',
    })
  })

  it('accepts a file with no activeForm', () => {
    const { activeForm, ...rest } = realFile
    expect(parseTaskFile(rest)).toEqual({
      id: '9',
      subject: 'Task 9: QuestionPanel widget',
      status: 'completed',
    })
  })

  it('accepts every status in the vocabulary', () => {
    for (const status of ['pending', 'in_progress', 'completed']) {
      expect(parseTaskFile({ ...realFile, status })?.status).toBe(status)
    }
  })

  it('rejects an unrecognised status rather than rendering it', () => {
    expect(parseTaskFile({ ...realFile, status: 'deleted' })).toBeNull()
  })

  it('rejects a file missing id, subject or status', () => {
    expect(parseTaskFile({ ...realFile, id: undefined })).toBeNull()
    expect(parseTaskFile({ ...realFile, subject: '' })).toBeNull()
    expect(parseTaskFile({ ...realFile, status: undefined })).toBeNull()
  })

  it('rejects anything that is not an object', () => {
    expect(parseTaskFile(null)).toBeNull()
    expect(parseTaskFile('9')).toBeNull()
    expect(parseTaskFile([realFile])).toBeNull()
  })
})

describe('toTaskStatus', () => {
  it('passes the vocabulary through and rejects everything else', () => {
    expect(toTaskStatus('in_progress')).toBe('in_progress')
    expect(toTaskStatus('blocked')).toBeNull()
    expect(toTaskStatus(3)).toBeNull()
  })
})

describe('sortTasks', () => {
  it('orders numerically, not lexically', () => {
    const out = sortTasks([task({ id: '10' }), task({ id: '9' }), task({ id: '2' })])
    expect(out.map((t) => t.id)).toEqual(['2', '9', '10'])
  })

  it('does not mutate its input', () => {
    const input = [task({ id: '10' }), task({ id: '9' })]
    sortTasks(input)
    expect(input.map((t) => t.id)).toEqual(['10', '9'])
  })

  it('files a non-numeric id after every numeric one, stably by string', () => {
    const out = sortTasks([task({ id: 'b' }), task({ id: '2' }), task({ id: 'a' })])
    expect(out.map((t) => t.id)).toEqual(['2', 'a', 'b'])
  })
})

describe('summarize', () => {
  it('counts completed against the total', () => {
    expect(
      summarize([
        task({ status: 'completed' }),
        task({ status: 'completed' }),
        task({ status: 'in_progress' }),
        task({ status: 'pending' }),
      ])
    ).toEqual({ completed: 2, total: 4 })
  })

  it('reports zero of zero for an empty list', () => {
    expect(summarize([])).toEqual({ completed: 0, total: 0 })
  })
})

describe('sameTasks', () => {
  it('is true for identical lists', () => {
    expect(sameTasks([task()], [task()])).toBe(true)
  })

  it('notices a status change', () => {
    expect(sameTasks([task()], [task({ status: 'completed' })])).toBe(false)
  })

  it('notices a subject change, so a renamed task redraws', () => {
    expect(sameTasks([task()], [task({ subject: 'Something else' })])).toBe(false)
  })

  it('notices a length change', () => {
    expect(sameTasks([task()], [task(), task({ id: '2' })])).toBe(false)
  })

  it('treats undefined and an empty list as the same nothing', () => {
    expect(sameTasks(undefined, [])).toBe(true)
    expect(sameTasks(undefined, undefined)).toBe(true)
    expect(sameTasks(undefined, [task()])).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/core/tasks.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/tasks.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/core/tasks.ts`:

```ts
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
 * rebuild — which would otherwise throw the reader's scroll position back to
 * the top while they were reading it.
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/core/tasks.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Run the whole suite and the typecheck**

Run: `npm test && npm run typecheck`
Expected: all suites pass, including `src/core purity` — `tasks.ts` imports nothing from `gi://`.

- [ ] **Step 6: Commit**

```bash
git add src/core/tasks.ts test/core/tasks.test.ts
git commit -m "feat(core): read an agent's task file into something a row can draw"
```

---

### Task 2: Hold tasks on the session

**Files:**
- Modify: `src/core/types.ts` (the `Session` interface)
- Modify: `src/core/store.ts` (new `setTasks` method)
- Test: `test/core/store.test.ts` (append)

**Interfaces:**
- Consumes: `AgentTask`, `sameTasks` from Task 1.
- Produces:
  - `Session.tasks?: AgentTask[]`
  - `SessionStore.setTasks(key: string, tasks: AgentTask[]): void`

- [ ] **Step 1: Write the failing test**

Append to `test/core/store.test.ts`. The file already has an `ev()` helper at the top; reuse it.

```ts
describe('setTasks', () => {
  it('stores a list on the session and notifies subscribers', () => {
    const s = new SessionStore()
    s.apply(ev())
    let emits = 0
    s.subscribe(() => { emits += 1 })

    s.setTasks('claude:s1', [{ id: '1', subject: 'Explore', status: 'completed' }])

    expect(s.get('claude:s1')?.tasks).toEqual([
      { id: '1', subject: 'Explore', status: 'completed' },
    ])
    expect(emits).toBe(1)
  })

  it('does not emit when the list has not moved', () => {
    const s = new SessionStore()
    s.apply(ev())
    const list = [{ id: '1', subject: 'Explore', status: 'completed' as const }]
    s.setTasks('claude:s1', list)

    let emits = 0
    s.subscribe(() => { emits += 1 })
    s.setTasks('claude:s1', [{ id: '1', subject: 'Explore', status: 'completed' }])

    expect(emits).toBe(0)
  })

  it('emits when a status moves', () => {
    const s = new SessionStore()
    s.apply(ev())
    s.setTasks('claude:s1', [{ id: '1', subject: 'Explore', status: 'pending' }])

    let emits = 0
    s.subscribe(() => { emits += 1 })
    s.setTasks('claude:s1', [{ id: '1', subject: 'Explore', status: 'completed' }])

    expect(emits).toBe(1)
    expect(s.get('claude:s1')?.tasks?.[0]?.status).toBe('completed')
  })

  it('ignores a key it has never seen', () => {
    const s = new SessionStore()
    let emits = 0
    s.subscribe(() => { emits += 1 })
    s.setTasks('claude:nope', [{ id: '1', subject: 'Explore', status: 'pending' }])
    expect(emits).toBe(0)
  })

  it('sorts what it is given, so the reader need not', () => {
    const s = new SessionStore()
    s.apply(ev())
    s.setTasks('claude:s1', [
      { id: '10', subject: 'Ten', status: 'pending' },
      { id: '9', subject: 'Nine', status: 'pending' },
    ])
    expect(s.get('claude:s1')?.tasks?.map((t) => t.id)).toEqual(['9', '10'])
  })

  it('lets the tasks go when the session is reaped', () => {
    const s = new SessionStore()
    s.apply(ev())
    s.setTasks('claude:s1', [{ id: '1', subject: 'Explore', status: 'pending' }])
    s.reap(1000 + 16 * 60 * 1000, () => false)
    expect(s.get('claude:s1')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/core/store.test.ts`
Expected: FAIL — `s.setTasks is not a function`.

- [ ] **Step 3: Add the field**

In `src/core/types.ts`, add the import at the top beside the existing `Question` import:

```ts
import type { AgentTask } from './tasks.js'
```

and add this field to `Session`, directly after `pendingQuestion`:

```ts
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
```

- [ ] **Step 4: Add the store method**

In `src/core/store.ts`, add to the imports at the top:

```ts
import { sameTasks, sortTasks } from './tasks.js'
import type { AgentTask } from './tasks.js'
```

and add this method directly after `setPendingQuestion`:

```ts
  /**
   * Publish the agent's plan for a session. Sorted here rather than by the
   * caller, because there are two callers — the shell's directory reader and
   * Codex's payload parser — and only one right order.
   *
   * Silent when nothing moved. The shell re-reads the task directory on every
   * popup open and on every tick while a session is dirty, and most of those
   * reads return the same bytes; emitting for them would rebuild every row in
   * the popup once a second for no visible change.
   */
  setTasks(key: string, tasks: AgentTask[]): void {
    const s = this.sessions.get(key)
    if (!s) return
    const sorted = sortTasks(tasks)
    if (sameTasks(s.tasks, sorted)) return
    s.tasks = sorted
    this.emit()
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test && npm run typecheck`
Expected: PASS. The purity test still passes — `tasks.ts` is pure.

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/store.ts test/core/store.test.ts
git commit -m "feat(core): hold an agent's plan on the session it belongs to"
```

---

### Task 3: Adapter seams for both shapes of plan

**Files:**
- Modify: `src/core/adapters/index.ts` (two optional members on `AgentAdapter`)
- Modify: `src/core/adapters/claude.ts` (add `taskTools`)
- Modify: `src/core/adapters/codex.ts` (add `parseTasks`)
- Test: `test/core/adapters/claude.test.ts` (append), `test/core/adapters/codex.test.ts` (append)

**Interfaces:**
- Consumes: `AgentTask`, `toTaskStatus` from Task 1.
- Produces:
  - `AgentAdapter.taskTools?: ReadonlySet<string>`
  - `AgentAdapter.parseTasks?(raw: unknown): AgentTask[] | null`
  - `claudeAdapter.taskTools` containing `TaskCreate`, `TaskUpdate`, `TaskList`, `TodoWrite`
  - `codexAdapter.parseTasks`

- [ ] **Step 1: Write the failing tests**

Append to `test/core/adapters/claude.test.ts`:

```ts
describe('claude taskTools', () => {
  it('names every tool whose completion can move the task directory', () => {
    expect([...(claudeAdapter.taskTools ?? [])].sort()).toEqual([
      'TaskCreate',
      'TaskList',
      'TaskUpdate',
      'TodoWrite',
    ])
  })

  it('does not name an ordinary tool', () => {
    expect(claudeAdapter.taskTools?.has('Edit')).toBe(false)
  })
})
```

Append to `test/core/adapters/codex.test.ts`:

```ts
describe('codex parseTasks (UNVERIFIED shape)', () => {
  const updatePlan = {
    tool_name: 'update_plan',
    tool_input: {
      plan: [
        { step: 'Read the spec', status: 'completed' },
        { step: 'Write the parser', status: 'in_progress' },
        { step: 'Wire the row', status: 'pending' },
      ],
    },
  }

  it('turns a plan snapshot into tasks numbered by position', () => {
    expect(codexAdapter.parseTasks?.(updatePlan)).toEqual([
      { id: '1', subject: 'Read the spec', status: 'completed' },
      { id: '2', subject: 'Write the parser', status: 'in_progress' },
      { id: '3', subject: 'Wire the row', status: 'pending' },
    ])
  })

  it('returns null for any other tool', () => {
    expect(codexAdapter.parseTasks?.({ ...updatePlan, tool_name: 'shell' })).toBeNull()
  })

  it('returns null when the plan is not an array of steps', () => {
    expect(codexAdapter.parseTasks?.({ tool_name: 'update_plan', tool_input: {} })).toBeNull()
    expect(
      codexAdapter.parseTasks?.({ tool_name: 'update_plan', tool_input: { plan: 'soon' } })
    ).toBeNull()
  })

  it('rejects the whole snapshot when one step is unusable', () => {
    const bad = {
      tool_name: 'update_plan',
      tool_input: { plan: [{ step: 'Fine', status: 'pending' }, { step: 'Broken' }] },
    }
    expect(codexAdapter.parseTasks?.(bad)).toBeNull()
  })

  it('accepts an empty plan as an empty list, not a failure', () => {
    expect(codexAdapter.parseTasks?.({ tool_name: 'update_plan', tool_input: { plan: [] } }))
      .toEqual([])
  })
})
```

If either test file does not already import its adapter, add `import { claudeAdapter } from '../../../src/core/adapters/claude.js'` / `import { codexAdapter } from '../../../src/core/adapters/codex.js'` at the top.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/core/adapters`
Expected: FAIL — `claudeAdapter.taskTools` is undefined, `codexAdapter.parseTasks` is undefined.

- [ ] **Step 3: Add the seams to the interface**

In `src/core/adapters/index.ts`, add the import:

```ts
import type { AgentTask } from '../tasks.js'
```

and these two members to `AgentAdapter`, after `parseQuestions`:

```ts
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
```

- [ ] **Step 4: Add `taskTools` to Claude**

In `src/core/adapters/claude.ts`, add above `export const claudeAdapter`:

```ts
/**
 * The tools that move the task directory. `TodoWrite` is the old spelling —
 * Claude replaced it with the incremental `TaskCreate` / `TaskUpdate` pair —
 * and is kept because an install still emitting it writes the same directory,
 * so recognising it costs one string and buys those installs the feature.
 *
 * `TaskList` is here despite being a read: it is cheap to include, and an
 * agent that lists its tasks is an agent whose row is worth refreshing.
 */
const TASK_TOOLS: ReadonlySet<string> = new Set([
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TodoWrite',
])
```

and add `taskTools: TASK_TOOLS,` to the adapter object, directly after `procNames`.

- [ ] **Step 5: Add `parseTasks` to Codex**

In `src/core/adapters/codex.ts`, add the imports:

```ts
import { toTaskStatus } from '../tasks.js'
import type { AgentTask } from '../tasks.js'
```

and add this method to the adapter object, after `normalize`:

```ts
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
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/adapters test/core/adapters
git commit -m "feat(core): let an adapter name its task tools or hand over a plan"
```

---

### Task 4: Read the task directory without blocking the compositor

**Files:**
- Create: `src/shell/taskReader.ts`

**Interfaces:**
- Consumes: `parseTaskFile`, `AgentTask` from Task 1; `AgentId` from `src/core/types.js`.
- Produces:
  - `function taskDir(agent: AgentId, sessionId: string): string | null`
  - `function readTasks(dir: string, done: (tasks: AgentTask[] | null) => void): void`

There is no unit test: this module needs a running GNOME Shell. Its verification is the typecheck plus the manual drive in Task 8.

- [ ] **Step 1: Write the module**

Create `src/shell/taskReader.ts`:

```ts
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import { parseTaskFile } from '../core/tasks.js'
import type { AgentTask } from '../core/tasks.js'
import type { AgentId } from '../core/types.js'

/**
 * A bound on work, not a display cap: the user asked to see every entry, and no
 * real plan approaches this. It exists so a directory that has somehow filled
 * with files cannot turn one popup open into thousands of reads.
 */
const MAX_FILES = 200

/**
 * Where an agent keeps its task list, or null if it keeps none on disk.
 *
 * Only Claude does. The path is keyed on the session id straight out of the
 * hook payload, which is exactly the id the store keys its records on — a
 * `/clear` mints a new one, so a new conversation reads a new (empty)
 * directory with no cleanup anywhere.
 *
 * The id arrives over D-Bus from an unprivileged peer and is interpolated into
 * a path, so it must be exactly one ordinary path component — a separator is
 * rejected, and so is a leading dot, which covers `.` and `..`. `GLib.build_filenamev`
 * does not normalise segments, so without the second half of that rule an id of
 * `..` would resolve one directory up and point this reader at the whole of `~/.claude`.
 */
export function taskDir(agent: AgentId, sessionId: string): string | null {
  if (agent !== 'claude') return null
  if (!sessionId || sessionId.includes('/') || sessionId.startsWith('.')) return null
  return GLib.build_filenamev([GLib.get_home_dir(), '.claude', 'tasks', sessionId])
}

/**
 * Every `<id>.json` in `dir`, parsed. Calls back with null — never an empty
 * array — when the directory could not be read at all, so the caller can tell
 * "the agent has no tasks" from "we could not look" and decline to blank a good
 * list on a transient failure.
 *
 * Asynchronous throughout. This runs on the compositor thread, where a
 * synchronous read of a directory on a busy or networked filesystem is a
 * visible stutter in every animation on screen.
 *
 * A file that fails to load or parse is skipped rather than failing the batch:
 * Claude writes these without an atomic rename, so catching one mid-write is
 * expected, and the next read a second later picks it up.
 */
export function readTasks(dir: string, done: (tasks: AgentTask[] | null) => void): void {
  const folder = Gio.File.new_for_path(dir)
  folder.enumerate_children_async(
    'standard::name',
    Gio.FileQueryInfoFlags.NONE,
    GLib.PRIORITY_LOW,
    null,
    (src, res) => {
      let enumerator: Gio.FileEnumerator
      try {
        enumerator = (src as Gio.File).enumerate_children_finish(res)
      } catch {
        // The ordinary case, not an error worth logging: an agent that has
        // never made a plan has no directory.
        done(null)
        return
      }
      enumerator.next_files_async(MAX_FILES, GLib.PRIORITY_LOW, null, (esrc, eres) => {
        let names: string[]
        try {
          names = (esrc as Gio.FileEnumerator)
            .next_files_finish(eres)
            .map((info) => info.get_name())
            .filter((name) => name.endsWith('.json'))
        } catch {
          done(null)
          return
        } finally {
          enumerator.close_async(GLib.PRIORITY_LOW, null, null)
        }

        if (names.length === 0) {
          done([])
          return
        }

        const tasks: AgentTask[] = []
        let outstanding = names.length
        const decoder = new TextDecoder()
        // One shared completion counter rather than a chain: the reads are
        // independent, and serialising them would make a ten-task list ten
        // round trips deep.
        const finishOne = () => {
          outstanding -= 1
          if (outstanding === 0) done(tasks)
        }

        for (const name of names) {
          const file = folder.get_child(name)
          file.load_contents_async(null, (fsrc, fres) => {
            try {
              const [ok, contents] = (fsrc as Gio.File).load_contents_finish(fres)
              if (ok) {
                const task = parseTaskFile(JSON.parse(decoder.decode(contents)))
                if (task) tasks.push(task)
              }
            } catch {
              // Half-written or malformed. Skipped; the rest still render.
            }
            finishOne()
          })
        }
      })
    }
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0, no diagnostics.

- [ ] **Step 3: Build, to prove the bundle still forms**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/shell/taskReader.ts
git commit -m "feat(shell): read an agent's task directory off the compositor thread"
```

---

### Task 5: The task list widget

**Files:**
- Create: `src/shell/taskList.ts`
- Modify: `stylesheet.css`

**Interfaces:**
- Consumes: `AgentTask`, `sameTasks` from Task 1.
- Produces:
  - `class TaskList` with `constructor(tasks: AgentTask[])`, `attachTo(parent: St.BoxLayout): void`, `update(tasks: AgentTask[]): void`, `setExpanded(expanded: boolean): void`, `detach(): void`, `destroy(): void`

No unit test — needs a running Shell. Verified by typecheck here and by eye in Task 8.

- [ ] **Step 1: Write the widget**

Create `src/shell/taskList.ts`:

```ts
import St from 'gi://St'
import Clutter from 'gi://Clutter'
import Pango from 'gi://Pango'
import { sameTasks } from '../core/tasks.js'
import type { AgentTask, TaskStatus } from '../core/tasks.js'

/**
 * One glyph per status. Text rather than icons: these sit at the head of a
 * text line, and an icon would need its own baseline alignment for no gain.
 */
const GLYPH: Record<TaskStatus, string> = {
  completed: '✓',
  in_progress: '▸',
  pending: '○',
}

/**
 * How strongly each status draws. A completed task is history and should
 * recede; the one in progress is the answer to "what is it doing"; pending
 * sits between them.
 *
 * Applied to the actor rather than through the stylesheet because St's CSS
 * engine does not reliably honour `opacity` — the finding recorded in
 * popupHeader.ts and reused on the row's activity label.
 */
const OPACITY: Record<TaskStatus, number> = {
  completed: 140,
  in_progress: 255,
  pending: 178,
}

/**
 * The agent's plan, one line per task, inside its own scroll view.
 *
 * Not a GObject class, for the same reason PermissionControls and QuestionPanel
 * are not: it is a plain owner of St actors, attached to and detached from a
 * SessionRow's task box.
 *
 * The scroll view is not optional. A plain `PopupMenu` is not scrollable in
 * GNOME Shell 46 — only `PopupSubMenu.actor` is an `St.ScrollView` — so a
 * forty-task list rendered into the menu directly grows the popup past the
 * monitor and is clipped rather than scrolled.
 */
export class TaskList {
  private scroll: St.ScrollView
  private box: St.BoxLayout
  private parent: St.BoxLayout | null = null
  private tasks: AgentTask[] = []

  constructor(tasks: AgentTask[]) {
    this.box = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'dasbo-tasks' })
    this.scroll = new St.ScrollView({
      style_class: 'dasbo-tasks-scroll',
      x_expand: true,
      // NEVER horizontally: every line ellipsizes, so there is nothing to
      // scroll to sideways, and a horizontal bar would only steal height.
      hscrollbar_policy: St.PolicyType.NEVER,
      vscrollbar_policy: St.PolicyType.AUTOMATIC,
    })
    this.scroll.set_child(this.box)
    this.render(tasks)
  }

  attachTo(parent: St.BoxLayout): void {
    if (this.parent) return
    this.parent = parent
    parent.add_child(this.scroll)
  }

  detach(): void {
    if (!this.parent) return
    this.parent.remove_child(this.scroll)
    this.parent = null
  }

  /** Collapsed hides the whole list; the row keeps its counter. */
  setExpanded(expanded: boolean): void {
    this.scroll.visible = expanded
  }

  /**
   * Redraw only when the drawing would differ. Every store emit reaches here,
   * and most of them are about something else entirely — a tool starting, a
   * permission resolving — so an unconditional rebuild would destroy and
   * recreate every line, throwing the reader's scroll position back to the top
   * while they were part-way down it.
   */
  update(tasks: AgentTask[]): void {
    if (sameTasks(this.tasks, tasks)) return
    this.render(tasks)
  }

  destroy(): void {
    this.detach()
    this.scroll.destroy()
  }

  private render(tasks: AgentTask[]): void {
    this.tasks = [...tasks]
    this.box.destroy_all_children()
    for (const t of tasks) this.box.add_child(this.line(t))
  }

  private line(task: AgentTask): St.BoxLayout {
    const row = new St.BoxLayout({ x_expand: true, style_class: 'dasbo-task' })
    const glyph = new St.Label({
      text: GLYPH[task.status],
      style_class: 'dasbo-task-glyph',
      y_align: Clutter.ActorAlign.CENTER,
    })
    const subject = new St.Label({
      text: task.subject,
      style_class: 'dasbo-task-subject',
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    })
    // One line per task, ellipsized rather than wrapped, so the height of the
    // list is a function of the task count alone — which is what makes the
    // scroll view's max-height a predictable number of visible entries.
    subject.clutter_text.ellipsize = Pango.EllipsizeMode.END
    row.opacity = OPACITY[task.status]
    row.add_child(glyph)
    row.add_child(subject)
    return row
  }
}
```

- [ ] **Step 2: Add the stylesheet rules**

Append to `stylesheet.css`, beside the `.dasbo-question-*` block:

```css
/* The list has to be bounded: a plain PopupMenu does not scroll in GNOME Shell
   46, so without a max-height a long plan grows the popup past the monitor and
   is clipped. ~9 lines at this font size. */
.dasbo-tasks-scroll { max-height: 200px; }
.dasbo-tasks { spacing: 2px; }
.dasbo-task { spacing: 6px; }
.dasbo-task-glyph { width: 14px; font-size: 0.85em; }
.dasbo-task-subject { font-size: 0.85em; }
.dasbo-row-tasks { spacing: 4px; }
```

- [ ] **Step 3: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: exit 0 for both.

- [ ] **Step 4: Commit**

```bash
git add src/shell/taskList.ts stylesheet.css
git commit -m "feat(shell): draw an agent's plan as one scrollable line per task"
```

---

### Task 6: Counter on the row, and an expander that serves both

**Files:**
- Modify: `src/shell/sessionRow.ts`
- Modify: `src/shell/island.ts` (the `onToggleQuestion` callback rename, one line at `island.ts:268` plus the callback name in the row's interface)

**Interfaces:**
- Consumes: `summarize` from Task 1; `Session.tasks` from Task 2.
- Produces:
  - `SessionRowCallbacks.onToggleExpanded: (expanded: boolean) => void` (renamed from `onToggleQuestion`)
  - `SessionRow.taskBox: St.BoxLayout`
  - `SessionRow.expanded: boolean`
  - `SessionRow.setHasTasks(has: boolean): void`
  - `SessionRow.setHasQuestion(has: boolean): void` (unchanged signature, new internal bookkeeping)

- [ ] **Step 1: Add the counter label**

In `src/shell/sessionRow.ts`, add to the field declarations beside `_elapsed`:

```ts
    private _taskCount!: St.Label
    private _taskBox!: St.BoxLayout
    private _hasQuestion = false
    private _hasTasks = false
```

Change the initialiser `private _expanded = true` to:

```ts
    // Collapsed is the resting state: a plan is reference material, not a
    // demand, and a row that opened itself for one would push every other
    // session down the popup. setHasQuestion(true) overrides this, because a
    // question *is* a demand.
    private _expanded = false
```

Add the import beside the existing `activityText` import:

```ts
import { summarize } from '../core/tasks.js'
```

- [ ] **Step 2: Build the counter and the task box**

In the constructor, directly after `this._elapsed` is created, add:

```ts
      // Its own label rather than text appended to _elapsed: the clock is
      // rewritten every tick while this changes only when the store emits, and
      // merging them would reformat an unchanged number once a second — the
      // waste the _shellTotal comment records. tnum in the stylesheet keeps
      // 9/10 and 10/10 the same width, so the row does not twitch.
      this._taskCount = new St.Label({
        text: '',
        style_class: 'dasbo-row-taskcount',
        y_align: Clutter.ActorAlign.CENTER,
        visible: false,
      })
      this._taskCount.opacity = 178
```

Change the `_actionBox` assembly from:

```ts
      this._actionBox.add_child(this._elapsed)
      this._actionBox.add_child(this._jump)
```

to:

```ts
      this._actionBox.add_child(this._elapsed)
      this._actionBox.add_child(this._taskCount)
      this._actionBox.add_child(this._jump)
```

Directly after the `_questionBox` block (the one with the `child-added` / `child-removed` connections), add:

```ts
      // Same visibility handling as the two boxes above, for the same reason:
      // ClutterBoxLayout spaces only between visible children, so an
      // always-present empty box would cost every row a gap it never uses.
      this._taskBox = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        style_class: 'dasbo-row-tasks',
      })
      this._taskBox.visible = false
      this._taskBox.connect('child-added', () => {
        this._taskBox.visible = true
      })
      this._taskBox.connect('child-removed', () => {
        this._taskBox.visible = this._taskBox.get_n_children() > 0
      })
```

and add it to the outer column, after `_questionBox`:

```ts
      outer.add_child(this._taskBox)
```

Change the expander's initial label to match the new collapsed default:

```ts
      this._expander = new St.Button({
        label: '▸',
```

and rename the callback it fires:

```ts
      this._expander.connect('clicked', () => {
        this._expanded = !this._expanded
        this._expander.label = this._expanded ? '▾' : '▸'
        this._cb.onToggleExpanded(this._expanded)
      })
```

- [ ] **Step 3: Rename the callback and add the new accessors**

In `SessionRowCallbacks`, replace the `onToggleQuestion` member with:

```ts
  /**
   * Fired by the expander arrow. The Island owns both the question panel and
   * the task list this shows and hides — one arrow, both regions, because a row
   * with two independent folds is two controls competing for the same corner.
   */
  onToggleExpanded: (expanded: boolean) => void
```

Add these accessors beside the existing `permissionBox` and `questionBox` getters:

```ts
    /** Where the Island attaches the TaskList. */
    get taskBox(): St.BoxLayout {
      return this._taskBox
    }

    /** So the Island can bring a freshly attached panel into line with the fold. */
    get expanded(): boolean {
      return this._expanded
    }
```

Replace `setHasQuestion` with the pair below:

```ts
    /**
     * Show or hide the expander arrow for a question, and always open the row.
     * A question arrives already open (the popup opens itself for it), and a
     * row that kept a fold left over from browsing a task list would hide the
     * answer behind an arrow the user never chose to close.
     */
    setHasQuestion(has: boolean): void {
      this._hasQuestion = has
      if (has) {
        this._expanded = true
        this._expander.label = '▾'
      }
      this._syncExpander()
    }

    /**
     * Show or hide the expander arrow for a task list. Unlike a question this
     * never forces the row open: a plan appearing mid-session must not shove
     * the rest of the popup down under the user's cursor.
     */
    setHasTasks(has: boolean): void {
      this._hasTasks = has
      this._syncExpander()
    }

    private _syncExpander(): void {
      this._expander.visible = this._hasQuestion || this._hasTasks
    }
```

- [ ] **Step 4: Drive the counter from `update()`**

In `update()`, directly after the `activityText` block, add:

```ts
      // Derived here rather than pushed in by the Island, so the row stays a
      // pure function of its Session — update(s) is already called on every
      // rebuild, and nothing else has to remember to keep the counter honest.
      const tasks = session.tasks ?? []
      if (tasks.length > 0) {
        const { completed, total } = summarize(tasks)
        this._taskCount.text = `${completed}/${total}`
        this._taskCount.visible = true
      } else {
        this._taskCount.visible = false
      }
      // The arrow follows the tasks, but the counter does not follow the fold:
      // a collapsed row showing 3/10 is the whole point of the collapsed state.
      this.setHasTasks(tasks.length > 0)
```

- [ ] **Step 5: Update the one Island call site**

In `src/shell/island.ts`, change line ~268 from:

```ts
            onToggleQuestion: (expanded) => this._questions.get(s.key)?.panel.setExpanded(expanded),
```

to:

```ts
            onToggleExpanded: (expanded) => {
              this._questions.get(s.key)?.panel.setExpanded(expanded)
              this._taskLists.get(s.key)?.list.setExpanded(expanded)
            },
```

and add the map it reads, beside `_questions` in the field declarations:

```ts
    private _taskLists = new Map<string, { list: TaskList }>()
```

with the import beside the `QuestionPanel` one:

```ts
import { TaskList } from './taskList.js'
```

- [ ] **Step 6: Add the counter's stylesheet rule**

Append to `stylesheet.css`, beside `.dasbo-row-elapsed`:

```css
.dasbo-row-taskcount {
  font-feature-settings: "tnum";
  font-size: 0.85em;
  padding-right: 6px;
}
```

- [ ] **Step 7: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: exit 0. `_taskLists` is declared and read but not yet written — that is Task 7, and TypeScript is content with an empty map.

- [ ] **Step 8: Manual check that nothing regressed**

```bash
make install
# X11: Alt+F2, r, Enter.  Wayland: log out and back in.
tools/fake-agent.js session
tools/fake-agent.js ask
```

Expected: the question panel still appears expanded with its arrow reading `▾`, clicking the arrow still folds it, and a plain session row (`tools/fake-agent.js session` with a fresh id) shows no arrow and no counter.

- [ ] **Step 9: Commit**

```bash
git add src/shell/sessionRow.ts src/shell/island.ts stylesheet.css
git commit -m "feat(shell): count an agent's plan beside the clock, behind one arrow"
```

---

### Task 7: Read on open, read while dirty

**Files:**
- Modify: `src/shell/island.ts`

**Interfaces:**
- Consumes: `taskDir`, `readTasks` from Task 4; `TaskList` from Task 5; `SessionRow.taskBox`, `SessionRow.expanded` from Task 6; `SessionStore.setTasks` from Task 2.
- Produces: `Island.notifyTasksChanged(key: string): void`

- [ ] **Step 1: Add the imports and the state**

In `src/shell/island.ts`, add beside the `taskList` import from Task 6:

```ts
import { taskDir, readTasks } from './taskReader.js'
```

and add these fields beside `_taskLists`:

```ts
    /**
     * Session keys whose task directory may have moved since it was last read.
     * The Island owns this rather than the service, because it is the only
     * thing that knows whether the popup is open — and a read whose result
     * nobody can see is pure waste.
     */
    private _dirtyTasks = new Set<string>()
    /** Keys with a read in flight, so a burst of TaskUpdates cannot stack reads. */
    private _readingTasks = new Set<string>()
```

- [ ] **Step 2: Add the entry point the service will call**

Add this method beside `notifyPermissionOpened`:

```ts
    /**
     * Called by the D-Bus service when a task tool finished for this session.
     * Marks and returns: the read itself happens on the next tick, and only
     * while the popup is open. A session whose plan moved while nobody was
     * looking is read once, when the popup next opens.
     */
    notifyTasksChanged(key: string): void {
      this._dirtyTasks.add(key)
    }
```

- [ ] **Step 3: Add the reader**

Add these two methods beside `_tickAll`:

```ts
    /**
     * Kick off a task-directory read for one session, unless one is already in
     * flight for it. The key stays dirty until the read comes back, so a change
     * landing mid-read is picked up by the next tick rather than lost.
     */
    private _readTasksFor(session: Session): void {
      const key = session.key
      if (this._readingTasks.has(key)) return
      const dir = taskDir(session.agent, session.sessionId)
      if (!dir) {
        // No directory for this agent — Codex publishes its plan through the
        // adapter instead. Clearing the flag stops this session re-checking on
        // every tick forever.
        this._dirtyTasks.delete(key)
        return
      }
      this._readingTasks.add(key)
      readTasks(dir, (tasks) => {
        this._readingTasks.delete(key)
        this._dirtyTasks.delete(key)
        // null means the directory could not be read at all, which is the
        // ordinary state of a session that has never made a plan. Setting an
        // empty list here would also blank a good list on a transient failure,
        // so a failed read changes nothing — the same rule processStartedAt
        // follows in the store.
        if (tasks === null) return
        this._store.setTasks(key, tasks)
      })
    }

    /**
     * Every dirty session, read. Called from the tick, so it only runs while
     * the popup is open — _timerId is the "is open" signal, as _rebuildRows
     * records.
     */
    private _readDirtyTasks(): void {
      if (this._dirtyTasks.size === 0) return
      for (const key of [...this._dirtyTasks]) {
        const session = this._store.get(key)
        // The session was reaped between the mark and the read.
        if (!session) {
          this._dirtyTasks.delete(key)
          continue
        }
        this._readTasksFor(session)
      }
    }
```

- [ ] **Step 4: Read on every tick, and on every open**

Change `_tickAll` from:

```ts
    private _tickAll(): void {
      const now = Date.now()
      for (const row of this._rows.values()) row.tick(now)
    }
```

to:

```ts
    private _tickAll(): void {
      const now = Date.now()
      for (const row of this._rows.values()) row.tick(now)
      this._readDirtyTasks()
    }
```

and change `_startTimer` from:

```ts
    private _startTimer(): void {
      if (this._timerId) return
      this._tickAll()
```

to:

```ts
    private _startTimer(): void {
      if (this._timerId) return
      // Every session, not only the dirty ones. This is the safety net under
      // the dirty flag: the flag is keyed on tool names, those names have been
      // renamed once already (TodoWrite -> TaskCreate), and a rename that stops
      // the marking would otherwise stop the feature dead. Marking everything
      // on open degrades that failure to "refreshes when you look at it".
      for (const s of this._store.list()) this._dirtyTasks.add(s.key)
      this._tickAll()
```

- [ ] **Step 5: Attach, update and destroy the lists**

In `_rebuildRows`, inside the stale-row cleanup block, directly after the `staleQuestion` block, add:

```ts
          const staleTasks = this._taskLists.get(key)
          if (staleTasks) {
            staleTasks.list.destroy()
            this._taskLists.delete(key)
          }
```

and in the same block, beside the other `delete` calls, add:

```ts
          this._dirtyTasks.delete(key)
          this._readingTasks.delete(key)
```

Then add this loop directly after the `pendingQuestion` loop (the one ending with `row.setHasQuestion(false)`):

```ts
      for (const s of sessions) {
        const row = this._rows.get(s.key)
        if (!row) continue
        const tasks = s.tasks ?? []
        const existing = this._taskLists.get(s.key)

        if (tasks.length === 0) {
          // Keyed on emptiness, not on absence: a plan whose every task was
          // deleted leaves an empty array behind, and the list widget for it
          // must go with it.
          if (existing) {
            existing.list.destroy()
            this._taskLists.delete(s.key)
          }
          continue
        }
        if (existing) {
          // update() no-ops when the drawing would not differ, so this is safe
          // to call on every rebuild — and doing so is what keeps the list in
          // step without a second subscription.
          existing.list.update(tasks)
          continue
        }
        const list = new TaskList(tasks)
        list.attachTo(row.taskBox)
        this._taskLists.set(s.key, { list })
      }

      // One arrow, two regions, so both must agree with it — and neither can
      // work that out for itself. A list attached to a collapsed row has never
      // been folded and would otherwise show through; and a question arriving
      // on a collapsed row forces the arrow open (see setHasQuestion) without
      // the task list beside it ever hearing, leaving an open arrow above a
      // hidden list. Syncing every attached region here, on every rebuild,
      // rather than only at attach time, covers both directions at once.
      for (const s of sessions) {
        const row = this._rows.get(s.key)
        if (!row) continue
        this._questions.get(s.key)?.panel.setExpanded(row.expanded)
        this._taskLists.get(s.key)?.list.setExpanded(row.expanded)
      }
```

- [ ] **Step 6: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/shell/island.ts
git commit -m "feat(shell): read a session's task directory when it moves, and when you look"
```

---

### Task 8: Wire the events, and prove it end to end

**Files:**
- Modify: `src/dbus/service.ts`
- Modify: `src/extension.ts`
- Modify: `tools/fake-agent.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: `Island.notifyTasksChanged` from Task 7; `adapter.taskTools` / `adapter.parseTasks` from Task 3; `SessionStore.setTasks` from Task 2.
- Produces: `ServiceOptions.onTasksChanged: (key: string) => void`

- [ ] **Step 1: Add the service option**

In `src/dbus/service.ts`, add to `ServiceOptions`, after `onPermissionOpened`:

```ts
  /**
   * Called when a tool that maintains this agent's task list has finished, so
   * the UI can re-read it. Only a hint that something moved — the service does
   * no filesystem work itself, and never learns whether anyone was looking.
   */
  onTasksChanged: (key: string) => void
```

- [ ] **Step 2: Branch in `Notify`**

Change the tail of `Notify` from:

```ts
    if (!e) return
    this.store.apply(e)
  }
```

to:

```ts
    if (!e) return
    this.store.apply(e)

    const key = sessionKey(e.agent, e.sessionId)
    // Two shapes of plan, one store method. Codex ships the whole thing in the
    // payload, so it is published here directly; Claude keeps it on disk, so
    // all this can do is say that it moved.
    const adapter = adapters[agent]
    const tasks = adapter.parseTasks?.(raw) ?? null
    if (tasks) {
      this.store.setTasks(key, tasks)
      return
    }
    // On tool-end, not tool-start: the pre-tool event fires before the write
    // lands, so reading there would show the list as it was a moment ago.
    if (e.kind === 'tool-end' && adapter.taskTools?.has(e.tool ?? '')) {
      this.opts.onTasksChanged(key)
    }
  }
```

`adapters` and `sessionKey` are already imported at the top of this file.

- [ ] **Step 3: Wire it in the extension**

In `src/extension.ts`, add to the `IslandService` options object, after `onPermissionOpened`:

```ts
      onTasksChanged: (key) => this._island?.notifyTasksChanged(key),
```

- [ ] **Step 4: Give the fake agent a task mode**

In `tools/fake-agent.js`, change the usage comment on line 3 to:

```js
// Usage: tools/fake-agent.js session|tool|perm|ask|tasks|sessionend [session-id]
```

add to the `events` object:

```js
  tasks: 'PostToolUse',
```

and add to the `payloads` object:

```js
  tasks: {
    hook_event_name: 'PostToolUse', session_id: sessionId, cwd: GLib.get_current_dir(),
    tool_name: 'TaskUpdate', tool_input: { taskId: '1', status: 'completed' },
  },
```

This drives the *marking* path only. Because the reader is keyed on the real
`~/.claude/tasks/<session-id>/` directory, the manual check below creates that
directory by hand.

- [ ] **Step 5: Verify end to end**

```bash
npm test && npm run typecheck && npm run build && make install
# X11: Alt+F2, r, Enter.  Wayland: log out and back in.

mkdir -p ~/.claude/tasks/fake-tasks-1
cat > ~/.claude/tasks/fake-tasks-1/1.json <<'JSON'
{"id":"1","subject":"Explore project context","status":"completed","blocks":[],"blockedBy":[]}
JSON
cat > ~/.claude/tasks/fake-tasks-1/2.json <<'JSON'
{"id":"2","subject":"Ask clarifying questions one at a time","status":"in_progress","blocks":[],"blockedBy":[]}
JSON
cat > ~/.claude/tasks/fake-tasks-1/10.json <<'JSON'
{"id":"10","subject":"A subject long enough to prove the line ellipsizes rather than wrapping the row","status":"pending","blocks":[],"blockedBy":[]}
JSON

tools/fake-agent.js session fake-tasks-1
tools/fake-agent.js tasks fake-tasks-1
```

Open the popup. Expected:

1. The row reads `1/3` between the clock and Jump.
2. The arrow reads `▸` — collapsed, list hidden.
3. Clicking the arrow reveals three lines, in the order `1`, `2`, `10` — numeric, not lexical.
4. `✓ Explore project context` is visibly dimmer than `▸ Ask clarifying questions…`.
5. The long subject ends in an ellipsis and the row's width has not changed.

Then, with the popup still open:

```bash
sed -i 's/"in_progress"/"completed"/' ~/.claude/tasks/fake-tasks-1/2.json
tools/fake-agent.js tasks fake-tasks-1
```

Expected: within a second the counter reads `2/3`, the second line's glyph becomes `✓`, and the list does not jump — the scroll position and the fold are unchanged.

Then check the scroll bound:

```bash
for i in $(seq 3 30); do
  printf '{"id":"%s","subject":"Filler task %s","status":"pending","blocks":[],"blockedBy":[]}' "$i" "$i" \
    > ~/.claude/tasks/fake-tasks-1/$i.json
done
tools/fake-agent.js tasks fake-tasks-1
```

Expected: the counter reads `2/31`, the expanded list stops at roughly nine visible lines with a scrollbar, and the popup still fits on screen with the other rows reachable.

Then check the fall-through:

```bash
tools/fake-agent.js session fake-plain-1
```

Expected: that row has no counter and no arrow, and looks exactly as rows did before this feature.

Finally, clean up:

```bash
rm -rf ~/.claude/tasks/fake-tasks-1
```

- [ ] **Step 6: Document it**

In `README.md`, add after the paragraph describing what each agent row shows:

```markdown
When an agent keeps a task list, its row shows how far through it is — `3/10`
beside the clock — and the expander arrow opens the list itself, one line per
task: `✓` done, `▸` in progress, `○` still to do. Claude Code's list is read
from `~/.claude/tasks/<session-id>/`, so it appears without any extra hook.
`/clear` starts a fresh list, because it starts a fresh session id.
```

- [ ] **Step 7: Commit**

```bash
git add src/dbus/service.ts src/extension.ts tools/fake-agent.js README.md
git commit -m "feat(dbus): tell the popup when an agent's plan has moved"
```

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: `src/core/tasks.ts` → T1; store field and method → T2; adapter seams → T3; `taskReader.ts` → T4; `taskList.ts` and its stylesheet rules → T5; row counter, expander and `_taskBox` → T6; Island dirty set, read scheduling and list lifecycle → T7; service branch, extension wiring, README → T8. The spec's failure table is covered by: `parseTaskFile` returning null (T1), `readTasks` calling back with null and the Island declining to blank on it (T4, T7), the per-file skip (T4), `MAX_FILES` (T4), Codex's null return (T3), and the read-on-open safety net (T7).

**Placeholders.** None. Every code step carries the code, every command its expected output.

**Type consistency.** `AgentTask` is `{ id, subject, status }` in T1 and is consumed with those names in T2, T3, T5, T6 and T7. `sameTasks` is defined once in T1 and used by both the store (T2) and the widget (T5). `toTaskStatus` is defined in T1 and used by `parseTaskFile` (T1) and Codex (T3). `onToggleExpanded` is renamed in T6 and its only call site is changed in the same task. `_taskLists` is declared in T6 and populated in T7 — deliberate, so T6 typechecks alone.

**API verified, not guessed.** The two shell modules were compiled against the real `@girs` typings before this plan was written: `Gio.File.enumerate_children_async` / `next_files_async` / `load_contents_async` with these exact signatures, `TextDecoder` (available under the `@girs/gnome-shell` ambient types), and `St.ScrollView.set_child(box)` with an `St.BoxLayout` (which implements `St.Scrollable`). Both probes exited 0 under `tsconfig.json`. `sortTasks`'s comparator was run against the two ordering assertions in T1 and produces `2,9,10` and `2,a,b`.

**Known ordering constraint.** T6 declares `_taskLists` and imports `TaskList`, so T5 must land before it. T7 calls `Island.notifyTasksChanged`, which T8's extension wiring depends on, so T7 must land before T8. Otherwise the tasks are in dependency order as written.
