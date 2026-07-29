# Showing an agent's task list on its row

Date: 2026-07-29
Status: approved, ready for planning

## Problem

A row says what the agent is doing this second — `Edit · src/shell/sessionRow.ts`
— and nothing about where that sits in the work. A session eight minutes into a
twelve-step plan looks exactly like one that started thirty seconds ago on a
one-line fix. The only way to tell them apart is to find the terminal, which is
the thing the island exists to avoid.

Agents already keep a plan. This design puts two things on the row: a
`completed / total` counter beside the clock, and, behind the expander the
question panel already introduced, the list itself with a status per entry.

## What the agents actually keep

### Claude

The tool is **not** `TodoWrite`. Across every transcript on this machine:

```
  580 "name":"TaskCreate"
 1170 "name":"TaskUpdate"
    7 "name":"TaskList"
    0 "name":"TodoWrite"
```

Those are incremental — one task per call — and `TaskCreate`'s assigned id comes
back only in the human-readable result string (`Task #7 created successfully:
…`), never in `tool_input`. Reconstructing a list from the payload stream would
mean scraping prose, and would show nothing at all for a session already
underway when the extension started.

It is unnecessary, because Claude writes the list to disk:

```
~/.claude/tasks/<session_id>/<id>.json

{ "id": "24",
  "subject": "T16: Full verification sweep",
  "description": "Plan Task 16",
  "activeForm": "Verifying",          // optional, absent in older files
  "status": "pending" | "in_progress" | "completed",
  "blocks": [], "blockedBy": [] }
```

`<session_id>` is exactly the `session_id` the hook payload carries and the store
already keys on. Verified by matching the live transcript
(`3ca72a0b-….jsonl`, this conversation) against `~/.claude/tasks/3ca72a0b-…/`,
which held precisely this conversation's eight tasks and no others. A neighbouring
directory under an older id held that conversation's tasks, untouched.

That mapping settles the lifecycle for free: `/clear` mints a new session id, so
a new conversation gets an empty directory with no cleanup code anywhere.

A `status` of `deleted` is not a state on disk — the file is removed.

### Codex

`update_plan` carries the whole plan in `tool_input` as `{ plan: [{ step,
status }] }`. There is no directory to read. This is **UNVERIFIED**, in the same
sense as everything else in `codex.ts`: `docs/agent-dialects.md` records that
Codex hooks parse but have never fired, and no fixture exists.

### Antigravity

Out of scope. The dialect doc records no plan or task tool at all, and finding
one would need a capture session first.

## Two verified constraints

**The popup does not scroll.** In GNOME Shell 46 only `PopupSubMenu.actor` is an
`St.ScrollView`; a plain `PopupMenu` is not. A forty-task list rendered
unbounded grows the popup past the monitor and is clipped, not scrolled. The
task list therefore carries its own `St.ScrollView` with a max-height.

**The tool names have already churned once.** `TodoWrite` → `TaskCreate` happened
between releases. Anything keyed on a tool name has to fail soft.

## Data flow

```
Claude PostToolUse(TaskUpdate)  ──Notify──▶ IslandService
                                              │ adapter.taskTools.has(e.tool)
                                              ▼
                                        opts.onTasksChanged(key)   [dirty set]
                                              │
Island: on popup open, or on tick while dirty ▼
                          taskReader.read(agent, sessionId)  ── async Gio ──▶
                                    ~/.claude/tasks/<session_id>/*.json
                                              │
                                              ▼
                                    store.setTasks(key, tasks)  ──emit──▶ rows rebuild

Codex update_plan ──Notify──▶ adapter.parseTasks(raw) ──▶ store.setTasks(key, tasks)
```

Two producers, one store method. The row never learns which agent it is showing.

### Why a dirty flag and not a poll or a monitor

A poll on the existing one-second tick would be immune to tool renames and about
fifteen lines, but costs a `readdir` plus N file reads every second for every
visible session, most of them returning identical bytes. A `Gio.FileMonitor` per
session is push-based and current even while the popup is shut, but needs a
monitor per live session, parent-directory watching until the task directory
exists, and teardown on reap — for data nobody can see while the popup is closed.

The dirty flag is precise and nearly free when idle. Its one weakness is the
rename risk above, which the popup-open read covers: a renamed tool degrades the
feature to "refreshes whenever you open the popup" rather than "silently stops".

## Components

### `src/core/tasks.ts` (new, pure)

```ts
export type TaskStatus = 'pending' | 'in_progress' | 'completed'
export interface AgentTask { id: string; subject: string; status: TaskStatus }

export function parseTaskFile(raw: unknown): AgentTask | null
export function sortTasks(tasks: AgentTask[]): AgentTask[]
export function summarize(tasks: AgentTask[]): { completed: number; total: number }
```

`parseTaskFile` rejects anything that is not the shape above — including an
unrecognised `status` — the way `parseQuestions` does, so a changed on-disk
format degrades to "no counter" rather than to a list built from `undefined`.

`sortTasks` orders by **numeric** id ascending. Lexical order would file `10`
before `9`, and ids are the only ordering the files carry.

`description`, `activeForm`, `blocks` and `blockedBy` are parsed away. Only
`id`, `subject` and `status` reach the store.

### `src/core/store.ts`

Gains `Session.tasks?: AgentTask[]` and:

```ts
setTasks(key: string, tasks: AgentTask[]): void   // sets, emits
```

Nothing else clears the field. Tasks die with the session record, and a new
conversation gets a new record and a new directory. A finished plan therefore
keeps reading `10/10` for the rest of the conversation, which is true rather
than stale.

Undefined and empty are distinct at the boundary but identical on screen: both
mean no counter and no arrow.

### `src/core/adapters/*.ts`

Two optional seams on `AgentAdapter`:

```ts
/** Tool names whose completion means the on-disk task list may have moved. */
taskTools?: ReadonlySet<string>
/** For agents that ship the whole plan in the payload instead. */
parseTasks?(raw: unknown): AgentTask[] | null
```

Claude sets `taskTools` to `TaskCreate`, `TaskUpdate`, `TaskList`, `TodoWrite`
— the last kept because older installs still emit it, and an install that emits
it also writes the same directory.

Codex implements `parseTasks` against `update_plan`, carrying the same
`UNVERIFIED` warning the rest of that file carries. Antigravity implements
neither.

### `src/dbus/service.ts`

`Notify` gains one branch after `store.apply(e)`: on `kind === 'tool-end'`, if
`adapter.taskTools?.has(e.tool ?? '')`, call a new
`ServiceOptions.onTasksChanged(key)`. Otherwise, if `adapter.parseTasks` returns
a list, `store.setTasks(key, …)` directly.

`RequestPermissionAsync` is left alone. The pre-tool event fires before the write
lands, so reading there would show the list as it was a moment ago.

### `src/shell/island.ts`

Owns the dirty set — a `Set<string>` of session keys — because it is the only
thing that knows whether the popup is open. `onTasksChanged(key)` adds to it.
A read is kicked off when the popup opens (`_startTimer`, already the "is open"
signal, as `_rebuildRows` records) for every session, and on the one-second tick
for any session in the set. A completed read clears that key.

Panel lifecycle mirrors the question panel's: a `TaskList` is built when a
session first has tasks, `update`d in place afterwards, and destroyed with the
row.

### `src/shell/taskReader.ts` (new, impure)

```ts
export function taskDir(agent: AgentId, sessionId: string): string | null
export function readTasks(dir: string, done: (tasks: AgentTask[] | null) => void): void
```

`Gio.File.enumerate_children_async` plus `load_contents_async` per entry —
asynchronous throughout, because this runs on the compositor thread. Claude
returns `~/.claude/tasks/<sessionId>` via `GLib.get_home_dir()`; every other
agent returns null.

One read in flight per session. A dirty mark arriving mid-read re-runs it once
on completion rather than queueing.

Lives in `src/shell` so `test/core/purity.test.ts` stays satisfied.

### `src/shell/sessionRow.ts`

**Counter.** A new `_taskCount` label in `_actionBox`, between `_elapsed` and
`_jump`, reading `3/10`. Its own label rather than text appended to the elapsed
string: elapsed is rewritten every tick while the counter changes only when the
store emits, and merging them would reformat an unchanged number once a second
— the waste the `_shellTotal` comment already records. Same `tnum` styling as
the clock, so `9/10` and `10/10` do not shift the row's width. Hidden when there
are no tasks, leaving a plan-less row exactly as it is today. The fold does not
affect it: the counter is the whole point of a collapsed row.

**Expander.** `setHasQuestion(has)` stays; a sibling `setHasTasks(has)` joins it,
and the row remembers both. The arrow shows when either is true, and folds both
regions together. Two setters rather than one replacement, so the existing
question call site is untouched. Fold state:

- tasks only → **collapsed** by default; a plan is reference material, not a demand
- a question arrives → **force-expanded**, keeping today's rule that an answer
  can never hide behind a fold left over from something else
- the question resolves → the row keeps whatever fold the user last chose,
  rather than snapping shut on a list they had opened

**Region.** `_questionBox` is unchanged. A new `_taskBox` below it: an
`St.ScrollView` (`vscrollbar_policy: AUTOMATIC`) around a vertical
`St.BoxLayout`, max-height in the stylesheet. Same `child-added` /
`child-removed` visibility handling the other two boxes use, because
`ClutterBoxLayout` spaces only between visible children and an always-present
empty box would cost every row a gap.

### `src/shell/taskList.ts` (new)

A plain owner of St actors, like `QuestionPanel` and `PermissionControls`, so it
can be attached to and detached from a row's task box.

One line per task: glyph, then subject with `ellipsize: END` and no wrapping, so
the line count is a function of the task count alone and the scroll height is
predictable.

- `✓` completed, actor opacity 140
- `▸` in_progress, full strength
- `○` pending, opacity 178

Opacity on the actor, not in the stylesheet — St's CSS engine does not reliably
honour it, as `popupHeader.ts` records.

`subject`, never `activeForm`: `activeForm` is worded for a spinner and changes
mid-run, which would make a settled list appear to churn.

`update(tasks)` diffs first — identical ids, statuses and subjects is a no-op.
Without that, every store emit would destroy and rebuild the children and throw
the reader's scroll position back to the top.

### `stylesheet.css`

`.dasbo-row-tasks` (max-height, padding), `.dasbo-task` (line), `.dasbo-task-glyph`
(fixed width so subjects align), `.dasbo-row-taskcount` (`tnum`, matching
`.dasbo-row-elapsed`).

## Failure behaviour

| What breaks | What happens |
|---|---|
| No task directory yet, or a session predating the feature | `tasks` stays undefined: no counter, no arrow, row identical to today |
| Directory unreadable, enumerate fails | Previous list retained, never blanked — the same rule `processStartedAt` follows: a transient failure may fail to update a good value, never destroy one |
| One `<id>.json` malformed or half-written | That file skipped, the rest render. Claude writes these without an atomic rename, so a partial read is expected, not exceptional |
| Implausible number of files | Read bounded at 200 entries — a bound on work, not a display cap; no real plan approaches it |
| Codex `update_plan` shape differs from the guess | `parseTasks` returns null, nothing is set, Codex rows look as they do today |
| A tool renamed again | Dirty-marking stops firing; the popup-open read keeps the list current whenever it is on screen |

Every path degrades to the row as it exists today. None produces a wrong number.

## Testing

- `test/core/tasks.test.ts` — `parseTaskFile` against real files captured into
  `test/fixtures/claude/tasks/`, plus junk, a missing `status`, an unrecognised
  `status`, and a non-object. `sortTasks` proving `9` before `10`. `summarize`
  counts across mixed statuses and over an empty list.
- `test/core/store.test.ts` — `setTasks` emits to subscribers; tasks vanish with
  the reaped session.
- `test/core/adapters/codex.test.ts` — `parseTasks` on a synthetic `update_plan`
  payload, labelled unverified; and null for an unrelated tool.
- `test/core/adapters/claude.test.ts` — `taskTools` membership, so a rename in
  the set is caught by a test rather than by silence.
- `taskReader.ts` and `taskList.ts` go untested, like `windowFinder.ts` and every
  other `src/shell` module: they need a running Shell.
- Manual: `make install`, run a Claude session that creates a plan, confirm the
  counter moves as tasks complete, the arrow appears, the list scrolls past the
  max-height, and a row without a plan is unchanged.

## Out of scope

Clicking a task to jump to it. Editing status from the popup. Showing
`description`, `blocks` or `blockedBy`. Antigravity support. Any change to the
pill icon — the 2×2 grid keeps meaning session state, not plan progress.
