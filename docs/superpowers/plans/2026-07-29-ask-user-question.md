# AskUserQuestion in the Island Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer Claude Code's `AskUserQuestion` from the GNOME popup — options, multi-select and free text — instead of having to find the terminal.

**Architecture:** The D-Bus `RequestPermission` handler already holds a hook's reply open while the user decides. A question reuses that hold: the payload is parsed by the Claude adapter, held by the existing `PermissionTable`, rendered by a new `QuestionPanel` attached to the session row, and answered back through `permissionDecision: "deny"` with the answer as the reason — the only text channel a `PreToolUse` hook has. No answer within the timeout releases the hold as `ask`, and Claude renders its own terminal picker then.

**Tech Stack:** TypeScript, GJS / GNOME Shell 46 (St, Clutter, GObject), esbuild, vitest.

Spec: `docs/superpowers/specs/2026-07-29-ask-user-question-design.md`

## Global Constraints

- `src/core/` must never import `gi://` or `resource://`. `test/core/purity.test.ts` enforces it.
- `src/shell/`, `src/dbus/` and `src/prefs.ts` have no unit tests and cannot get them — they need a running GNOME Shell. Their verification is `npm run typecheck` plus the manual `tools/fake-agent.js` drive described in each task.
- Every path out of `RequestPermissionAsync` must produce exactly one D-Bus reply. The hook calls with `NO_TIMEOUT`; an invocation that escapes without a reply blocks the agent forever and breaks the README's fail-open guarantee.
- Target: GNOME Shell 46, TypeScript 5.6, vitest 2.1.
- Full test command: `npm test`. Typecheck: `npm run typecheck` (runs both tsconfigs and sums exit codes).
- Commit style follows the existing log: `feat(core):`, `fix(shell):`, `test(core):`, `docs:`.

---

### Task 1: Parse a Claude question payload

**Files:**
- Create: `src/core/questions.ts`
- Test: `test/core/questions.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface QuestionOption { label: string; description: string }`
  - `interface Question { question: string; header: string; options: QuestionOption[]; multiSelect: boolean }`
  - `function parseQuestions(toolInput: unknown): Question[] | null`

- [ ] **Step 1: Write the failing test**

Create `test/core/questions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseQuestions } from '../../src/core/questions.js'

const oneQuestion = {
  questions: [
    {
      question: 'Which library for date formatting?',
      header: 'Library',
      options: [
        { label: 'date-fns', description: 'tree-shakeable' },
        { label: 'Luxon', description: 'timezone-aware' },
      ],
      multiSelect: false,
    },
  ],
}

describe('parseQuestions', () => {
  it('accepts the shape Claude sends', () => {
    expect(parseQuestions(oneQuestion)).toEqual([
      {
        question: 'Which library for date formatting?',
        header: 'Library',
        options: [
          { label: 'date-fns', description: 'tree-shakeable' },
          { label: 'Luxon', description: 'timezone-aware' },
        ],
        multiSelect: false,
      },
    ])
  })

  it('defaults multiSelect to false when absent', () => {
    const raw = { questions: [{ ...oneQuestion.questions[0], multiSelect: undefined }] }
    expect(parseQuestions(raw)?.[0].multiSelect).toBe(false)
  })

  it('keeps a multiSelect question', () => {
    const raw = { questions: [{ ...oneQuestion.questions[0], multiSelect: true }] }
    expect(parseQuestions(raw)?.[0].multiSelect).toBe(true)
  })

  it('drops the preview field it does not render', () => {
    const raw = {
      questions: [
        {
          ...oneQuestion.questions[0],
          options: [
            { label: 'a', description: 'first', preview: '# mockup' },
            { label: 'b', description: 'second' },
          ],
        },
      ],
    }
    expect(parseQuestions(raw)?.[0].options[0]).toEqual({ label: 'a', description: 'first' })
  })

  it('returns null for a non-record input', () => {
    expect(parseQuestions('nope')).toBeNull()
    expect(parseQuestions(null)).toBeNull()
    expect(parseQuestions([oneQuestion])).toBeNull()
  })

  it('returns null when questions is missing or empty', () => {
    expect(parseQuestions({})).toBeNull()
    expect(parseQuestions({ questions: [] })).toBeNull()
  })

  it('returns null beyond four questions', () => {
    const q = oneQuestion.questions[0]
    expect(parseQuestions({ questions: [q, q, q, q] })).not.toBeNull()
    expect(parseQuestions({ questions: [q, q, q, q, q] })).toBeNull()
  })

  it('returns null when a question has fewer than two or more than four options', () => {
    const opt = { label: 'a', description: 'b' }
    const mk = (n: number) => ({
      questions: [{ ...oneQuestion.questions[0], options: Array.from({ length: n }, () => opt) }],
    })
    expect(parseQuestions(mk(1))).toBeNull()
    expect(parseQuestions(mk(2))).not.toBeNull()
    expect(parseQuestions(mk(4))).not.toBeNull()
    expect(parseQuestions(mk(5))).toBeNull()
  })

  it('returns null when question, header or an option label is missing', () => {
    const q = oneQuestion.questions[0]
    expect(parseQuestions({ questions: [{ ...q, question: '' }] })).toBeNull()
    expect(parseQuestions({ questions: [{ ...q, header: undefined }] })).toBeNull()
    expect(
      parseQuestions({ questions: [{ ...q, options: [{ description: 'x' }, { label: 'y', description: 'z' }] }] })
    ).toBeNull()
  })

  it('substitutes an empty string for a missing option description', () => {
    const raw = {
      questions: [
        { ...oneQuestion.questions[0], options: [{ label: 'a' }, { label: 'b', description: 'z' }] },
      ],
    }
    expect(parseQuestions(raw)?.[0].options[0]).toEqual({ label: 'a', description: '' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/core/questions.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/questions.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/core/questions.ts`:

```ts
import { isRecord, str } from './adapters/shared.js'

/** One selectable answer. `preview` is deliberately dropped — see the spec's Out of scope. */
export interface QuestionOption {
  label: string
  /** May be empty: Claude's schema requires it, but a payload that omits it is still answerable. */
  description: string
}

export interface Question {
  question: string
  /** Claude bounds this at 12 characters, so the row can show it without truncating. */
  header: string
  options: QuestionOption[]
  multiSelect: boolean
}

/** Claude's own schema bounds, mirrored so an unexpected payload is rejected rather than rendered. */
const MAX_QUESTIONS = 4
const MIN_OPTIONS = 2
const MAX_OPTIONS = 4

/**
 * Claude's `AskUserQuestion` tool_input, validated into something the popup can
 * render. Returns null for anything that does not match, and null means "not a
 * question, gate it as an ordinary tool" — so a payload shape that changes
 * under us degrades to today's Allow/Deny behaviour rather than to a panel
 * built from undefined.
 */
export function parseQuestions(toolInput: unknown): Question[] | null {
  if (!isRecord(toolInput)) return null
  const raw = toolInput['questions']
  if (!Array.isArray(raw)) return null
  if (raw.length === 0 || raw.length > MAX_QUESTIONS) return null

  const out: Question[] = []
  for (const item of raw) {
    if (!isRecord(item)) return null
    const question = str(item['question'])
    const header = str(item['header'])
    if (!question || !header) return null

    const rawOptions = item['options']
    if (!Array.isArray(rawOptions)) return null
    if (rawOptions.length < MIN_OPTIONS || rawOptions.length > MAX_OPTIONS) return null

    const options: QuestionOption[] = []
    for (const o of rawOptions) {
      if (!isRecord(o)) return null
      const label = str(o['label'])
      if (!label) return null
      options.push({ label, description: str(o['description']) ?? '' })
    }

    out.push({ question, header, options, multiSelect: item['multiSelect'] === true })
  }
  return out
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/core/questions.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Confirm core purity still holds**

Run: `npx vitest run test/core/purity.test.ts`
Expected: PASS — the new file imports only `./adapters/shared.js`.

- [ ] **Step 6: Commit**

```bash
git add src/core/questions.ts test/core/questions.test.ts
git commit -m "feat(core): parse Claude's AskUserQuestion payload"
```

---

### Task 2: Format the answer that goes back to the model

**Files:**
- Modify: `src/core/questions.ts`
- Test: `test/core/questions.test.ts`

**Interfaces:**
- Consumes: `Question` from Task 1.
- Produces: `function formatAnswer(questions: Question[], answers: string[][]): string`

`answers[i]` holds the selected labels (or the typed free text as a single entry) for `questions[i]`. The returned string is the complete `permissionDecisionReason` — prefix included — because that prefix is the only thing defusing the `deny` this rides on, and it has to be testable without a running Shell.

- [ ] **Step 1: Write the failing test**

First replace the existing import line at the top of `test/core/questions.test.ts` with:

```ts
import { parseQuestions, formatAnswer, type Question } from '../../src/core/questions.js'
```

Then append:

```ts
const PREFIX = 'The user answered in Dasbo Island rather than the terminal — do not re-ask.'

function q(header: string, multiSelect = false): Question {
  return {
    question: `${header}?`,
    header,
    options: [
      { label: 'one', description: '' },
      { label: 'two', description: '' },
    ],
    multiSelect,
  }
}

describe('formatAnswer', () => {
  it('prefixes the answer so a denial reads as a reply', () => {
    expect(formatAnswer([q('Library')], [['date-fns']])).toBe(`${PREFIX} Library: date-fns`)
  })

  it('joins several selections for one question with commas', () => {
    expect(formatAnswer([q('Features', true)], [['Postgres', 'Redis']])).toBe(
      `${PREFIX} Features: Postgres, Redis`
    )
  })

  it('joins several questions with semicolons, in order', () => {
    expect(
      formatAnswer([q('Library'), q('Store', true)], [['Luxon'], ['Postgres', 'Redis']])
    ).toBe(`${PREFIX} Library: Luxon; Store: Postgres, Redis`)
  })

  it('carries free text through verbatim', () => {
    expect(formatAnswer([q('Library')], [['whatever you think is best']])).toBe(
      `${PREFIX} Library: whatever you think is best`
    )
  })

  it('skips a question with no selections', () => {
    expect(formatAnswer([q('Library'), q('Store')], [[], ['Postgres']])).toBe(
      `${PREFIX} Store: Postgres`
    )
  })

  it('says so when nothing at all was answered', () => {
    expect(formatAnswer([q('Library')], [[]])).toBe(`${PREFIX} The user selected nothing.`)
  })

  it('ignores answers beyond the questions asked', () => {
    expect(formatAnswer([q('Library')], [['Luxon'], ['ignored']])).toBe(`${PREFIX} Library: Luxon`)
  })

  it('collapses newlines in free text so the reason stays one line', () => {
    expect(formatAnswer([q('Notes')], [['first\nsecond']])).toBe(`${PREFIX} Notes: first second`)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/core/questions.test.ts`
Expected: FAIL — `formatAnswer is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/core/questions.ts`:

```ts
/**
 * The complete `permissionDecisionReason` for an answered question set.
 *
 * The prefix is not decoration. A `PreToolUse` hook has no result channel, so
 * the answer can only reach the model as a *denial's* reason (see the spec);
 * without a sentence saying what actually happened the model reads a refusal
 * and asks again. Built here rather than in the adapter so the wording is
 * testable without a running Shell.
 *
 * `answers[i]` holds the labels selected for `questions[i]`, or a single entry
 * of typed free text. Newlines are collapsed because the reason travels as one
 * JSON string into a transcript that renders it as a line.
 */
export function formatAnswer(questions: Question[], answers: string[][]): string {
  const prefix = 'The user answered in Dasbo Island rather than the terminal — do not re-ask.'
  const parts: string[] = []
  for (let i = 0; i < questions.length; i++) {
    const picked = (answers[i] ?? []).map((a) => a.replace(/\s+/g, ' ').trim()).filter((a) => a.length > 0)
    if (picked.length === 0) continue
    parts.push(`${questions[i].header}: ${picked.join(', ')}`)
  }
  // Reachable only if every question was skipped. Saying so beats sending a
  // bare prefix, which reads as a truncated message.
  if (parts.length === 0) return `${prefix} The user selected nothing.`
  return `${prefix} ${parts.join('; ')}`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/core/questions.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/questions.ts test/core/questions.test.ts
git commit -m "feat(core): word an answer so a denial does not read as a refusal"
```

---

### Task 3: The `answer` decision and the adapter hook

**Files:**
- Modify: `src/core/types.ts:152-157`
- Modify: `src/core/adapters/index.ts:6-17`
- Modify: `src/core/adapters/claude.ts`
- Modify: `src/core/adapters/codex.ts:70-80`
- Modify: `src/core/adapters/antigravity.ts:71-78`
- Test: `test/core/adapters/claude.test.ts`, `test/core/adapters/codex.test.ts`, `test/core/adapters/antigravity.test.ts`

**Interfaces:**
- Consumes: `Question`, `parseQuestions` (Task 1).
- Produces:
  - `DecisionKind` gains `'answer'`; `Decision` gains `answer?: string`.
  - `AgentAdapter` gains `parseQuestions?(raw: unknown): Question[] | null`.
  - `claudeAdapter.parseQuestions` implemented; the other two leave it undefined.

- [ ] **Step 1: Write the failing tests**

Append to `test/core/adapters/claude.test.ts`:

```ts
import { parseQuestions } from '../../../src/core/questions.js'

const askPayload = {
  hook_event_name: 'PreToolUse',
  session_id: 's1',
  cwd: '/p/app',
  tool_name: 'AskUserQuestion',
  tool_input: {
    questions: [
      {
        question: 'Which library?',
        header: 'Library',
        options: [
          { label: 'date-fns', description: 'tree-shakeable' },
          { label: 'Luxon', description: 'timezone-aware' },
        ],
        multiSelect: false,
      },
    ],
  },
}

describe('claudeAdapter.parseQuestions', () => {
  it('parses an AskUserQuestion payload', () => {
    expect(claudeAdapter.parseQuestions!(askPayload)).toEqual(
      parseQuestions(askPayload.tool_input)
    )
  })

  it('ignores any other tool', () => {
    expect(
      claudeAdapter.parseQuestions!({ ...askPayload, tool_name: 'Bash' })
    ).toBeNull()
  })

  it('ignores an AskUserQuestion whose input does not parse', () => {
    expect(
      claudeAdapter.parseQuestions!({ ...askPayload, tool_input: { questions: [] } })
    ).toBeNull()
  })

  it('ignores a non-record payload', () => {
    expect(claudeAdapter.parseQuestions!('nope')).toBeNull()
  })
})

describe('claudeAdapter.encodeDecision for an answer', () => {
  it('carries the answer as a denial reason, the only channel PreToolUse has', () => {
    expect(claudeAdapter.encodeDecision({ kind: 'answer', answer: 'Library: Luxon' })).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Library: Luxon',
      },
    })
  })

  it('never emits an empty reason', () => {
    const out = claudeAdapter.encodeDecision({ kind: 'answer' }) as {
      hookSpecificOutput: { permissionDecisionReason: string }
    }
    expect(out.hookSpecificOutput.permissionDecisionReason.length).toBeGreaterThan(0)
  })
})
```

Append to `test/core/adapters/codex.test.ts`:

```ts
describe('codexAdapter.encodeDecision for an answer', () => {
  it('says nothing at all, since Codex has no question concept', () => {
    expect(codexAdapter.encodeDecision({ kind: 'answer', answer: 'x' })).toEqual({})
  })
})
```

Append to `test/core/adapters/antigravity.test.ts`:

```ts
describe('antigravityAdapter.encodeDecision for an answer', () => {
  it('says nothing at all, since Antigravity has no question concept', () => {
    expect(antigravityAdapter.encodeDecision({ kind: 'answer', answer: 'x' })).toEqual({})
  })
})
```

If either file's existing imports do not already bring in its adapter under that name, use the name already imported at the top of that file rather than adding a second import.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/core/adapters/`
Expected: FAIL — `claudeAdapter.parseQuestions is not a function`, and the codex/antigravity cases return `{permissionDecision: "answer", ...}` instead of `{}`.

- [ ] **Step 3: Widen the decision type**

In `src/core/types.ts`, replace lines 152-157:

```ts
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
```

- [ ] **Step 4: Add the adapter capability**

In `src/core/adapters/index.ts`, add the import and the optional member:

```ts
import type { Question } from '../questions.js'
```

and inside `interface AgentAdapter`, after `normalize`:

```ts
  /**
   * The questions this payload asks the user, or null if it asks none.
   *
   * Optional because only Claude Code has the concept: Codex and Antigravity
   * have no equivalent tool, so they leave this undefined and the service's
   * `?.()` call falls straight through to ordinary permission gating.
   */
  parseQuestions?(raw: unknown): Question[] | null
```

- [ ] **Step 5: Implement it for Claude**

In `src/core/adapters/claude.ts`, add to the imports:

```ts
import { parseQuestions } from '../questions.js'
```

and add to the `claudeAdapter` object, after `normalize`:

```ts
  parseQuestions(raw) {
    if (!isRecord(raw)) return null
    if (str(raw['tool_name']) !== 'AskUserQuestion') return null
    return parseQuestions(raw['tool_input'])
  },
```

Then extend `encodeDecision`, replacing its body:

```ts
  encodeDecision(d: Decision) {
    // An answer is not a verdict, but `deny` is the only decision whose reason
    // the model is shown — there is no result channel on PreToolUse. The
    // wording that keeps this from reading as a refusal lives in
    // `formatAnswer`, which built `d.answer`.
    if (d.kind === 'answer') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: d.answer ?? 'The user gave no answer in Dasbo Island.',
        },
      }
    }
    const permissionDecision =
      d.kind === 'allow' ? 'allow' : d.kind === 'deny' ? 'deny' : 'ask'
    const defaultReason =
      d.kind === 'allow' ? 'Allowed from Dasbo Island'
      : d.kind === 'deny' ? 'Denied from Dasbo Island'
      : 'Dasbo Island did not decide'
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision,
        permissionDecisionReason: d.reason ?? defaultReason,
      },
    }
  },
```

- [ ] **Step 6: Keep the other two adapters total**

In `src/core/adapters/codex.ts:71`, replace:

```ts
    if (d.kind === 'fallthrough') return {}
```

with:

```ts
    // 'answer' joins 'fallthrough' here: Codex has no question concept, so it
    // can never receive one — and if it somehow did, emitting `d.kind` below
    // would put the string "answer" in a field that accepts only
    // allow/deny/ask.
    if (d.kind === 'fallthrough' || d.kind === 'answer') return {}
```

Make the identical change at `src/core/adapters/antigravity.ts:72`, with `Antigravity` in place of `Codex`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run test/core/adapters/ && npm run typecheck`
Expected: PASS, and typecheck exits 0. A non-zero typecheck here most likely means a `switch (d.kind)` somewhere is no longer exhaustive — fix it rather than casting.

- [ ] **Step 8: Commit**

```bash
git add src/core/types.ts src/core/adapters test/core/adapters
git commit -m "feat(core): give a decision a way to be an answer"
```

---

### Task 4: A held question on the session record

**Files:**
- Modify: `src/core/types.ts` (add `PendingQuestion`, extend `Session`)
- Modify: `src/core/store.ts:296-328`, `src/core/store.ts:339-369`
- Test: `test/core/store.test.ts`

**Interfaces:**
- Consumes: `Question` (Task 1).
- Produces:
  - `interface PendingQuestion { id: string; questions: Question[]; deadline: number }`
  - `Session.pendingQuestion?: PendingQuestion`
  - `SessionStore.setPendingQuestion(key: string, pending: PendingQuestion): void`
  - `SessionStore.clearPending(key)` now clears whichever hold is set.

- [ ] **Step 1: Write the failing test**

Append to `test/core/store.test.ts` (reuse whatever session-seeding helper the file already defines; the code below assumes a store with a `claude:s1` session applied from a `session-start` event, which is how the existing tests in that file start):

```ts
import type { PendingQuestion } from '../../src/core/types.js'

const question: PendingQuestion = {
  id: 'perm-1',
  deadline: 0,
  questions: [
    {
      question: 'Which library?',
      header: 'Library',
      options: [
        { label: 'date-fns', description: '' },
        { label: 'Luxon', description: '' },
      ],
      multiSelect: false,
    },
  ],
}

describe('SessionStore question holds', () => {
  it('puts the session into waiting', () => {
    const s = new SessionStore()
    s.apply({ agent: 'claude', kind: 'session-start', sessionId: 's1', cwd: '/p/app', pid: 10, ts: 0 })
    s.setPendingQuestion('claude:s1', question)
    expect(s.get('claude:s1')!.state).toBe('waiting')
    expect(s.get('claude:s1')!.pendingQuestion).toEqual(question)
  })

  it('holds waiting across an event that would have changed the state', () => {
    const s = new SessionStore()
    s.apply({ agent: 'claude', kind: 'session-start', sessionId: 's1', cwd: '/p/app', pid: 10, ts: 0 })
    s.setPendingQuestion('claude:s1', question)
    s.apply({ agent: 'claude', kind: 'turn-end', sessionId: 's1', cwd: '/p/app', pid: 10, ts: 1000 })
    expect(s.get('claude:s1')!.state).toBe('waiting')
  })

  it('settles to what the deferred event meant when the question clears', () => {
    const s = new SessionStore()
    s.apply({ agent: 'claude', kind: 'session-start', sessionId: 's1', cwd: '/p/app', pid: 10, ts: 0 })
    s.setPendingQuestion('claude:s1', question)
    s.apply({ agent: 'claude', kind: 'turn-end', sessionId: 's1', cwd: '/p/app', pid: 10, ts: 1000 })
    s.clearPending('claude:s1')
    expect(s.get('claude:s1')!.state).toBe('idle')
    expect(s.get('claude:s1')!.pendingQuestion).toBeUndefined()
  })

  it('never holds a question and a permission at once', () => {
    const s = new SessionStore()
    s.apply({ agent: 'claude', kind: 'session-start', sessionId: 's1', cwd: '/p/app', pid: 10, ts: 0 })
    s.setPending('claude:s1', { id: 'perm-1', tool: 'Bash', deadline: 0, queued: 0 })
    s.setPendingQuestion('claude:s1', { ...question, id: 'perm-2' })
    expect(s.get('claude:s1')!.pendingPermission).toBeUndefined()

    s.setPending('claude:s1', { id: 'perm-3', tool: 'Bash', deadline: 0, queued: 0 })
    expect(s.get('claude:s1')!.pendingQuestion).toBeUndefined()
  })

  it('does not reap a session holding a question with a live agent', () => {
    const s = new SessionStore()
    s.apply({ agent: 'claude', kind: 'session-start', sessionId: 's1', cwd: '/p/app', pid: 10, ts: 0 })
    s.setPendingQuestion('claude:s1', question)
    expect(s.reap(1000, () => true)).toEqual([])
    expect(s.get('claude:s1')).toBeDefined()
  })

  it('collects a question held by an agent that is gone with no timer to fire', () => {
    const s = new SessionStore()
    s.apply({ agent: 'claude', kind: 'session-start', sessionId: 's1', cwd: '/p/app', pid: 10, ts: 0 })
    s.setPendingQuestion('claude:s1', question) // deadline 0 — no timer will ever resolve it
    expect(s.reap(1000, () => false)).toEqual(['claude:s1'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/core/store.test.ts`
Expected: FAIL — `s.setPendingQuestion is not a function`.

- [ ] **Step 3: Add the type**

In `src/core/types.ts`, add above `interface Session` (and add `import type { Question } from './questions.js'` at the top):

```ts
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
```

and add to `interface Session`, beside `pendingPermission`:

```ts
  /** Mutually exclusive with pendingPermission: the store clears each when setting the other. */
  pendingQuestion?: PendingQuestion
```

- [ ] **Step 4: Teach the store about it**

In `src/core/store.ts`, add `PendingQuestion` to the type import on line 2.

Replace the `if (s.pendingPermission)` guard at line 296 with:

```ts
    if (s.pendingPermission || s.pendingQuestion) {
```

(the comment above it already explains why; extend its first sentence to read "while a permission or a question is pending").

Replace `setPending` and `clearPending` (lines 309-328) with:

```ts
  setPending(key: string, pending: PendingPermission): void {
    const s = this.sessions.get(key)
    if (!s) return
    s.pendingPermission = pending
    // One hold at a time. PermissionTable activates the head of a session's
    // queue without clearing the previous head's published state, so a question
    // promoted after a permission (or the reverse) would otherwise leave both
    // fields set and the row would render two things at once.
    s.pendingQuestion = undefined
    s.state = 'waiting'
    this.emit()
  }

  setPendingQuestion(key: string, pending: PendingQuestion): void {
    const s = this.sessions.get(key)
    if (!s) return
    s.pendingQuestion = pending
    s.pendingPermission = undefined
    s.state = 'waiting'
    this.emit()
  }

  clearPending(key: string): void {
    const s = this.sessions.get(key)
    if (!s?.pendingPermission && !s?.pendingQuestion) return
    s.pendingPermission = undefined
    s.pendingQuestion = undefined
    // Settle to whatever the last event actually meant while the hold was in
    // place — a turn-end settles to 'idle', a session-end to 'done', an error to
    // 'error'. With no event during the hold, the agent simply proceeds with
    // (or without) whatever it asked about, so 'running' is the right settle.
    if (s.state === 'waiting') s.state = s.deferredState ?? 'running'
    s.deferredState = undefined
    this.emit()
  }
```

In `reap`, replace the opening of the loop body (line 339) with:

```ts
      // A question is held on exactly the same terms as a permission: its own
      // timer resolves it if it has one, and only a confirmed-dead agent with
      // no timer at all may be collected underneath it.
      const held = s.pendingPermission ?? s.pendingQuestion
      if (held) {
```

and inside that block replace both `s.pendingPermission.deadline` reads with `held.deadline`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/core/store.test.ts && npm run typecheck`
Expected: PASS, typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/store.ts test/core/store.test.ts
git commit -m "feat(core): hold a question on the session the way a permission is held"
```

---

### Task 5: Questions through the existing hold engine

**Files:**
- Modify: `src/core/permissions.ts`
- Test: `test/core/permissions.test.ts`

**Interfaces:**
- Consumes: `Question` (Task 1), `SessionStore.setPendingQuestion` (Task 4).
- Produces: `PermissionRequest` gains `questions?: Question[]`. Everything else — `request`, `resolve`, `releaseSession`, `resolveAllFallthrough` — keeps its signature and now covers question entries too.

- [ ] **Step 1: Write the failing test**

Append to `test/core/permissions.test.ts`:

```ts
const qs = [
  {
    question: 'Which library?',
    header: 'Library',
    options: [
      { label: 'date-fns', description: '' },
      { label: 'Luxon', description: '' },
    ],
    multiSelect: false,
  },
]

describe('PermissionTable question entries', () => {
  it('publishes a pending question rather than a pending permission', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    t.request({ sessionKey: 'claude:s1', tool: 'AskUserQuestion', questions: qs, timeoutSeconds: 120 }, () => {})
    const s = store.get('claude:s1')!
    expect(s.state).toBe('waiting')
    expect(s.pendingQuestion?.questions).toEqual(qs)
    expect(s.pendingPermission).toBeUndefined()
  })

  it('resolves with an answer and clears the hold', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    let got: Decision | null = null
    const id = t.request(
      { sessionKey: 'claude:s1', tool: 'AskUserQuestion', questions: qs, timeoutSeconds: 120 },
      (d) => { got = d }
    )
    t.resolve(id, { kind: 'answer', answer: 'Library: Luxon' })
    expect(got).toEqual({ kind: 'answer', answer: 'Library: Luxon' })
    expect(store.get('claude:s1')!.pendingQuestion).toBeUndefined()
  })

  it('falls through when the question times out', () => {
    const store = seeded()
    const { timers, advance } = fakeTimers()
    const t = new PermissionTable(store, timers)
    let got: Decision | null = null
    t.request(
      { sessionKey: 'claude:s1', tool: 'AskUserQuestion', questions: qs, timeoutSeconds: 120 },
      (d) => { got = d }
    )
    advance(120_000)
    expect(got?.kind).toBe('fallthrough')
    expect(store.get('claude:s1')!.pendingQuestion).toBeUndefined()
  })

  it('is never short-circuited by an always-allow grant', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    t.grantAlways('claude:s1', 'AskUserQuestion')
    let got: Decision | null = null
    t.request(
      { sessionKey: 'claude:s1', tool: 'AskUserQuestion', questions: qs, timeoutSeconds: 120 },
      (d) => { got = d }
    )
    expect(got).toBeNull()
    expect(store.get('claude:s1')!.pendingQuestion).toBeDefined()
  })

  it('promotes a question queued behind a permission, swapping what the row shows', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    const first = t.request({ sessionKey: 'claude:s1', tool: 'Bash', timeoutSeconds: 30 }, () => {})
    t.request({ sessionKey: 'claude:s1', tool: 'AskUserQuestion', questions: qs, timeoutSeconds: 120 }, () => {})
    expect(store.get('claude:s1')!.pendingPermission?.tool).toBe('Bash')
    t.resolve(first, { kind: 'allow' })
    const s = store.get('claude:s1')!
    expect(s.pendingQuestion?.questions).toEqual(qs)
    expect(s.pendingPermission).toBeUndefined()
  })

  it('drains a held question on shutdown', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    let got: Decision | null = null
    t.request(
      { sessionKey: 'claude:s1', tool: 'AskUserQuestion', questions: qs, timeoutSeconds: 0 },
      (d) => { got = d }
    )
    t.resolveAllFallthrough()
    expect(got?.kind).toBe('fallthrough')
  })

  it('releases a held question when its session is reaped', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    let got: Decision | null = null
    t.request(
      { sessionKey: 'claude:s1', tool: 'AskUserQuestion', questions: qs, timeoutSeconds: 0 },
      (d) => { got = d }
    )
    t.releaseSession('claude:s1')
    expect(got?.kind).toBe('fallthrough')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/core/permissions.test.ts`
Expected: FAIL — the first case gets `pendingPermission` set and `pendingQuestion` undefined.

- [ ] **Step 3: Write the implementation**

In `src/core/permissions.ts`, add the import:

```ts
import type { Question } from './questions.js'
```

Add to `interface PendingEntry`, after `detail`:

```ts
  /** Set only on a question entry. Its presence is what makes this a question. */
  questions?: Question[]
```

Add the same field to `interface PermissionRequest`, with the doc comment:

```ts
  /**
   * When set, this is an agent's question rather than a tool permission. It
   * rides the same table because that table owns the timeout clock, the
   * per-session queue, `releaseSession` and `resolveAllFallthrough` — and that
   * drain is the fail-open guarantee. A second table would be a second place to
   * get it wrong.
   */
  questions?: Question[]
```

In `request()`, guard the always-allow short circuit (line 72) so a question can never be auto-answered:

```ts
    // Never for a question: "always allow this tool" is a statement about a
    // tool call, and answering a question on the user's behalf from it would
    // put words in their mouth.
    if (!req.questions && this.isAlwaysAllowed(req.sessionKey, req.tool)) {
      resolve({ kind: 'allow', reason: 'Always allowed for this session' })
      return id
    }
```

and carry the field into the entry:

```ts
    this.pending.set(id, {
      id,
      sessionKey: req.sessionKey,
      tool: req.tool,
      detail: req.detail,
      questions: req.questions,
      timeoutSeconds: req.timeoutSeconds,
      resolve,
    })
```

In `activate()`, replace the `this.store.setPending(...)` call with:

```ts
    if (entry.questions) {
      this.store.setPendingQuestion(sessionKey, {
        id: entry.id,
        questions: entry.questions,
        deadline,
      })
    } else {
      this.store.setPending(sessionKey, {
        id: entry.id,
        tool: entry.tool,
        detail: entry.detail,
        deadline,
        queued: this.queuedCount(sessionKey),
      })
    }
```

In `publishDepth()`, return early for a question head:

```ts
    // A question shows no queued depth — PendingQuestion has no such field —
    // and rewriting it here would only replace the object the panel is keyed
    // on, forcing a rebuild under the user's cursor for no visible change.
    if (entry.questions) return
```

placed immediately after the `if (!entry) return` line.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/core/permissions.test.ts && npm test`
Expected: PASS, whole suite green.

- [ ] **Step 5: Commit**

```bash
git add src/core/permissions.ts test/core/permissions.test.ts
git commit -m "feat(core): hold a question on the table that already guarantees a reply"
```

---

### Task 6: What the collapsed row says

**Files:**
- Modify: `src/core/activity.ts:35-56`
- Test: `test/core/activity.test.ts`

**Interfaces:**
- Consumes: `Session.pendingQuestion` (Task 4).
- Produces: no new exports; `activityText` gains a branch.

- [ ] **Step 1: Write the failing test**

Append to `test/core/activity.test.ts`, which already defines the `session(over: Partial<Session>)` helper used below:

```ts
describe('activityText for a pending question', () => {
  const pendingQuestion = {
    id: 'perm-1',
    deadline: 0,
    questions: [
      {
        question: 'Which library?',
        header: 'Library',
        options: [
          { label: 'date-fns', description: '' },
          { label: 'Luxon', description: '' },
        ],
        multiSelect: false,
      },
    ],
  }

  it('names the question by its header', () => {
    const s = session({ state: 'waiting', pendingQuestion })
    expect(activityText(s)).toEqual({ text: 'question · Library', hint: false })
  })

  it('takes precedence over the tool that is still recorded on the row', () => {
    const s = session({ state: 'waiting', currentTool: 'AskUserQuestion', pendingQuestion })
    expect(activityText(s).text).toBe('question · Library')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/core/activity.test.ts`
Expected: FAIL — got `AskUserQuestion`, expected `question · Library`.

- [ ] **Step 3: Write the implementation**

In `src/core/activity.ts`, insert at the top of `activityText`, before the `pending` branch:

```ts
  const question = session.pendingQuestion
  if (question) {
    // The header, not the question text: Claude bounds it at 12 characters, so
    // it needs no truncation and cannot push the expander off the row. The
    // question itself is one click away in the panel.
    return { text: `question · ${question.questions[0]?.header ?? ''}`, hint: false }
  }
```

Extend the function's doc comment: the catch-all's safety note already names `setPending`/`clearPending` as the pair that keeps `waiting` honest — add `setPendingQuestion` to that list.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/core/activity.test.ts && npm test`
Expected: PASS, whole suite green.

- [ ] **Step 5: Commit**

```bash
git add src/core/activity.ts test/core/activity.test.ts
git commit -m "feat(core): name a held question on the row"
```

---

### Task 7: The question timeout setting

**Files:**
- Modify: `schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml:29`
- Modify: `src/prefs.ts:72`

**Interfaces:**
- Consumes: nothing.
- Produces: GSettings key `question-timeout`, type `i`, default `120`, read by Task 8 as `settings.get_int('question-timeout')`.

- [ ] **Step 1: Add the key**

In `schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml`, after the `permission-timeout` key (closing `</key>` on line 29):

```xml
    <key name="question-timeout" type="i">
      <default>120</default>
      <summary>Agent question timeout in seconds</summary>
      <description>Seconds to wait for an answer before falling through to the agent's own picker. Longer than the permission timeout because a question has to be read. Zero waits indefinitely.</description>
    </key>
```

- [ ] **Step 2: Add the prefs row**

In `src/prefs.ts`, immediately after `group.add(timeout)` (line 72):

```ts
    const questionTimeout = new Adw.SpinRow({
      title: 'Question timeout',
      subtitle: 'Seconds before an agent’s question falls through to its own picker. Zero waits indefinitely.',
      adjustment: new Gtk.Adjustment({ lower: 0, upper: 3600, step_increment: 15 }),
    })
    settings.bind('question-timeout', questionTimeout, 'value', 0)
    group.add(questionTimeout)
```

- [ ] **Step 3: Verify the schema compiles and the key exists**

```bash
make install
gsettings --schemadir ~/.local/share/gnome-shell/extensions/dasbo-island@ayubaswad.gmail.com/schemas \
  get org.gnome.shell.extensions.dasbo-island question-timeout
```

Expected: `120`. A schema error surfaces here as a `glib-compile-schemas` failure during `make install`.

- [ ] **Step 4: Commit**

```bash
git add schemas src/prefs.ts
git commit -m "feat(prefs): give a question its own, longer timeout"
```

---

### Task 8: Intercept the question on the bus

**Files:**
- Modify: `src/dbus/service.ts:12-19`, `src/dbus/service.ts:139-168`
- Modify: `src/extension.ts:72-76`
- Modify: `tools/fake-agent.js`

**Interfaces:**
- Consumes: `adapter.parseQuestions` (Task 3), `PermissionTable.request({questions})` (Task 5), `Session.pendingQuestion` (Task 4), the `question-timeout` key (Task 7).
- Produces: `ServiceOptions` gains `questionTimeoutSeconds: () => number`. `tools/fake-agent.js` gains an `ask` mode.

- [ ] **Step 1: Add the option**

In `src/dbus/service.ts`, add to `interface ServiceOptions` after `timeoutSeconds`:

```ts
  /** Read live from GSettings on every request, so changes need no restart. */
  questionTimeoutSeconds: () => number
```

- [ ] **Step 2: Add the interception branch**

In `RequestPermissionAsync`, insert between the `this.store.apply(e)` / `const key = ...` pair and the `if (e.permissionsBypassed)` check:

```ts
      // Before the bypass check, deliberately. `bypassPermissions` suppresses
      // permission *prompts*; it does not suppress AskUserQuestion, which still
      // asks the user in that mode. Checking bypass first would swallow every
      // question asked in the mode where this feature is most useful.
      const questions = adapter.parseQuestions?.(raw) ?? null
      if (questions) {
        const qid = this.permissions.request(
          {
            sessionKey: key,
            tool: e.tool ?? 'AskUserQuestion',
            questions,
            timeoutSeconds: this.opts.questionTimeoutSeconds(),
          },
          (decision) => reply(JSON.stringify(adapter.encodeDecision(decision)))
        )
        // Same test as the permission path below: a request that merely queued
        // behind an active one leaves the published hold unchanged, and only the
        // one that actually became active should pull the popup open.
        if (this.store.get(key)?.pendingQuestion?.id === qid) this.opts.onPermissionOpened()
        return
      }
```

- [ ] **Step 3: Wire the setting**

In `src/extension.ts`, add to the `IslandService` options object (after `timeoutSeconds`):

```ts
      questionTimeoutSeconds: () => settings.get_int('question-timeout'),
```

- [ ] **Step 4: Give the fake agent a question mode**

In `tools/fake-agent.js`, add `ask: 'PreToolUse',` to `events`, add to `payloads`:

```js
  ask: {
    hook_event_name: 'PreToolUse', session_id: sessionId, cwd: GLib.get_current_dir(),
    tool_name: 'AskUserQuestion',
    tool_input: {
      questions: [
        {
          question: 'Which library should we use for date formatting?',
          header: 'Library',
          options: [
            { label: 'date-fns', description: 'tree-shakeable, function per format' },
            { label: 'Luxon', description: 'timezone-aware, heavier' },
          ],
          multiSelect: false,
        },
        {
          question: 'Which stores should the cache write through to?',
          header: 'Stores',
          options: [
            { label: 'Postgres', description: 'durable' },
            { label: 'Redis', description: 'fast' },
            { label: 'Disk', description: 'neither' },
          ],
          multiSelect: true,
        },
      ],
    },
  },
```

and change the two `mode === 'perm'` tests to cover both blocking modes:

```js
const blocking = mode === 'perm' || mode === 'ask'
const method = blocking ? 'RequestPermission' : 'Notify'
const replyType = blocking ? new GLib.VariantType('(s)') : null
```

Update the usage comment on line 3 to `session|tool|perm|ask|sessionend [session-id]`.

- [ ] **Step 5: Typecheck and drive it**

```bash
npm run typecheck && npm test && make install
```

Then reload the Shell (X11: `Alt+F2`, `r`, Enter — Wayland: log out and back in) and run:

```bash
tools/fake-agent.js ask
```

Expected: the command **blocks**. The pill turns to `waiting`, the popup opens itself, and the row reads `question · Library`. After 120 seconds it returns `RequestPermission returned ('{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask",...}}',)`.

There is no UI to answer with yet — that is Tasks 9-11. Do not skip this step: it proves the hold and the fall-through before any widget exists, so a later failure is unambiguously a widget failure.

- [ ] **Step 6: Commit**

```bash
git add src/dbus/service.ts src/extension.ts tools/fake-agent.js
git commit -m "feat(dbus): hold an agent's question instead of gating it as a tool"
```

---

### Task 9: The question panel widget

**Files:**
- Create: `src/shell/questionPanel.ts`
- Modify: `stylesheet.css`

**Interfaces:**
- Consumes: `Question`, `formatAnswer` (Tasks 1-2).
- Produces:
  ```ts
  export interface QuestionCallbacks {
    /** The complete reason string from formatAnswer. */
    onAnswer: (text: string) => void
    onHandOff: () => void
  }
  export class QuestionPanel {
    constructor(questions: Question[], cb: QuestionCallbacks)
    attachTo(parent: St.BoxLayout): void
    detach(): void
    setExpanded(expanded: boolean): void
    destroy(): void
  }
  ```

This task has no unit test — `src/shell` needs a running GNOME Shell. It is verified by typecheck plus the manual drive in Task 11.

- [ ] **Step 1: Write the widget**

Create `src/shell/questionPanel.ts`:

```ts
import St from 'gi://St'
import Clutter from 'gi://Clutter'
import Pango from 'gi://Pango'
import { formatAnswer } from '../core/questions.js'
import type { Question } from '../core/questions.js'

export interface QuestionCallbacks {
  /** The complete reason string, already built by formatAnswer. */
  onAnswer: (text: string) => void
  /** Release the hold so the agent renders its own picker instead. */
  onHandOff: () => void
}

/**
 * The panel that answers an agent's question, one question at a time.
 *
 * Not a GObject class, for the same reason PermissionControls is not: it is a
 * plain owner of St actors so it can be attached to and detached from a
 * SessionRow's question box — its own full-width line beneath the row, because
 * option labels neither wrap nor shrink and beside the activity label they
 * would starve it.
 *
 * It owns the in-progress selections. They are not in the store: a half-made
 * choice is not something the agent reported, and routing every click through
 * the store would emit a subscriber notification, and so a full row rebuild,
 * under the user's cursor.
 */
export class QuestionPanel {
  private box: St.BoxLayout
  private parent: St.BoxLayout | null = null
  private questions: Question[]
  private cb: QuestionCallbacks
  /** One entry per question, filled as the user advances. */
  private answers: string[][]
  private index = 0
  /** Selections for the question on screen, kept apart from `answers` until it is committed. */
  private picked = new Set<string>()
  private entry: St.Entry | null = null
  private entryKeyId = 0
  private optionsBox: St.BoxLayout
  private prompt: St.Label
  private counter: St.Label
  private nav: St.BoxLayout
  private next: St.Button
  private done = false

  constructor(questions: Question[], cb: QuestionCallbacks) {
    this.questions = questions
    this.cb = cb
    this.answers = questions.map(() => [])

    this.box = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'dasbo-question' })

    const head = new St.BoxLayout({ x_expand: true, style_class: 'dasbo-question-head' })
    this.prompt = new St.Label({ text: '', style_class: 'dasbo-question-prompt', x_expand: true })
    // Same wrapping rules as the activity label: a question can be a full
    // sentence, the popup's width is fixed, and an ellipsize mode would make
    // Pango ignore line_wrap and silently yield one truncated line.
    this.prompt.clutter_text.line_wrap = true
    this.prompt.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR
    this.prompt.clutter_text.ellipsize = Pango.EllipsizeMode.NONE
    this.counter = new St.Label({
      text: '',
      style_class: 'dasbo-question-counter',
      y_align: Clutter.ActorAlign.START,
    })
    head.add_child(this.prompt)
    head.add_child(this.counter)

    this.optionsBox = new St.BoxLayout({ vertical: true, x_expand: true })

    this.nav = new St.BoxLayout({
      x_expand: true,
      x_align: Clutter.ActorAlign.END,
      style_class: 'dasbo-question-nav',
    })
    this.next = new St.Button({ label: 'Next', style_class: 'button dasbo-question-next',
      can_focus: true })
    this.next.connect('clicked', () => this.commit())
    const handOff = new St.Button({
      label: 'Answer in terminal',
      style_class: 'button dasbo-question-handoff',
      // This row is built can_focus: false, and St.Button does not set this
      // itself, so without it a keyboard-only user cannot reach the escape
      // hatch at all — the same fix as Jump and the header gear.
      can_focus: true,
    })
    handOff.connect('clicked', () => {
      if (this.done) return
      this.done = true
      this.cb.onHandOff()
    })
    this.nav.add_child(this.next)
    this.nav.add_child(handOff)

    this.box.add_child(head)
    this.box.add_child(this.optionsBox)
    this.box.add_child(this.nav)

    this.render()
  }

  attachTo(parent: St.BoxLayout): void {
    if (this.parent) return
    this.parent = parent
    parent.add_child(this.box)
  }

  detach(): void {
    if (!this.parent) return
    this.parent.remove_child(this.box)
    this.parent = null
  }

  /** Collapsed hides the whole panel; the row keeps its one-line summary. */
  setExpanded(expanded: boolean): void {
    this.box.visible = expanded
  }

  destroy(): void {
    this.closeEntry()
    this.detach()
    this.box.destroy()
  }

  /** Rebuild the option list for the question at `index`. */
  private render(): void {
    const q = this.questions[this.index]
    if (!q) return
    this.closeEntry()
    this.picked.clear()
    this.prompt.text = q.question
    this.counter.text = this.questions.length > 1
      ? `${this.index + 1}/${this.questions.length}`
      : ''
    this.counter.visible = this.questions.length > 1
    // A single-select question commits on the click itself, so a Next button
    // beside it would be a second way to do the same thing — and, before any
    // click, a way to submit nothing.
    this.next.visible = q.multiSelect
    this.next.label = this.index === this.questions.length - 1 ? 'Submit' : 'Next'

    this.optionsBox.destroy_all_children()
    for (const opt of q.options) {
      this.optionsBox.add_child(this.optionButton(q, opt.label, opt.description))
    }
    this.optionsBox.add_child(this.otherButton())
  }

  private optionButton(q: Question, label: string, description: string): St.Button {
    const inner = new St.BoxLayout({ x_expand: true })
    const name = new St.Label({ text: label, style_class: 'dasbo-question-label' })
    const desc = new St.Label({ text: description, style_class: 'dasbo-question-desc',
      x_expand: true })
    // St's CSS engine does not reliably honour `opacity` — the finding recorded
    // in popupHeader.ts and reused on the row's activity label — so this is set
    // on the actor rather than in the stylesheet.
    desc.opacity = 178
    desc.clutter_text.ellipsize = Pango.EllipsizeMode.END
    inner.add_child(name)
    inner.add_child(desc)

    const button = new St.Button({ style_class: 'dasbo-question-option', can_focus: true,
      x_expand: true, child: inner })
    button.connect('clicked', () => {
      if (this.done) return
      if (q.multiSelect) {
        if (this.picked.has(label)) {
          this.picked.delete(label)
          button.remove_style_pseudo_class('checked')
        } else {
          this.picked.add(label)
          button.add_style_pseudo_class('checked')
        }
        return
      }
      this.picked.clear()
      this.picked.add(label)
      this.commit()
    })
    return button
  }

  private otherButton(): St.Button {
    const button = new St.Button({
      label: 'Other…',
      style_class: 'dasbo-question-option dasbo-question-other',
      can_focus: true,
      x_expand: true,
    })
    button.connect('clicked', () => {
      if (this.done) return
      this.openEntry(button)
    })
    return button
  }

  /** Swap the Other… button for a live entry, in place. */
  private openEntry(after: St.Button): void {
    if (this.entry) return
    const entry = new St.Entry({ style_class: 'dasbo-question-entry', x_expand: true,
      can_focus: true, hint_text: 'Type an answer' })
    this.entry = entry
    this.optionsBox.replace_child(after, entry)
    after.destroy()

    // A panel popup does not hand key focus to an entry on its own, so the
    // caret never appears and every keystroke goes to the menu instead.
    global.stage.set_key_focus(entry.clutter_text)

    entry.clutter_text.connect('activate', () => {
      const text = entry.get_text().trim()
      if (text.length === 0) return
      this.picked.clear()
      this.picked.add(text)
      this.commit()
    })

    this.entryKeyId = entry.clutter_text.connect('key-press-event', (_actor, event) => {
      if (event.get_key_symbol() !== Clutter.KEY_Escape) return Clutter.EVENT_PROPAGATE
      // Consumed, or GNOME's menu grab takes it and closes the whole popup —
      // discarding a question the user was part-way through answering.
      this.closeEntry()
      this.render()
      return Clutter.EVENT_STOP
    })
  }

  private closeEntry(): void {
    if (!this.entry) return
    if (this.entryKeyId) {
      this.entry.clutter_text.disconnect(this.entryKeyId)
      this.entryKeyId = 0
    }
    this.entry = null
  }

  /** Record the current question's answer and advance, or submit. */
  private commit(): void {
    if (this.done) return
    this.answers[this.index] = [...this.picked]
    if (this.index < this.questions.length - 1) {
      this.index += 1
      this.render()
      return
    }
    this.done = true
    this.cb.onAnswer(formatAnswer(this.questions, this.answers))
  }
}
```

- [ ] **Step 2: Add the styles**

Append to `stylesheet.css`, after the `.dasbo-always` rule (line 70):

```css
.dasbo-question { spacing: 4px; padding: 4px 0 0 0; }
.dasbo-question-head { spacing: 8px; }
.dasbo-question-prompt { font-weight: bold; }
.dasbo-question-counter { font-feature-settings: "tnum"; font-size: 0.85em; }
.dasbo-question-option { padding: 3px 8px; border-radius: 6px; }
.dasbo-question-option:hover { background-color: rgba(255, 255, 255, 0.08); }
.dasbo-question-option:checked { background-color: rgba(255, 255, 255, 0.16); }
.dasbo-question-label { font-weight: bold; padding-right: 8px; }
.dasbo-question-desc { font-size: 0.9em; }
.dasbo-question-entry { margin: 2px 0; }
.dasbo-question-nav { spacing: 6px; padding-top: 2px; }
.dasbo-question-next { padding: 2px 10px; }
.dasbo-question-handoff { padding: 2px 10px; font-size: 0.85em; }
.dasbo-row-question { spacing: 6px; }
.dasbo-expander { width: 16px; }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/shell/questionPanel.ts stylesheet.css
git commit -m "feat(shell): a panel that walks an agent's questions"
```

---

### Task 10: The row's question box and expander

**Files:**
- Modify: `src/shell/sessionRow.ts:18-20`, `:54-56`, `:135-157`, `:159-166`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `SessionRowCallbacks` gains `onToggleQuestion: (expanded: boolean) => void`.
  - `SessionRow.questionBox: St.BoxLayout` (getter).
  - `SessionRow.setHasQuestion(has: boolean): void` — shows or hides the expander and resets it to expanded.

- [ ] **Step 1: Extend the callbacks**

In `src/shell/sessionRow.ts`, replace `interface SessionRowCallbacks`:

```ts
export interface SessionRowCallbacks {
  onJump: (session: Session) => void
  /** Fired by the expander arrow. The Island owns the panel this shows and hides. */
  onToggleQuestion: (expanded: boolean) => void
}
```

- [ ] **Step 2: Add the expander to the title row**

Add the fields beside the existing ones:

```ts
    private _expander!: St.Button
    private _expanded = true
    private _questionBox!: St.BoxLayout
```

and in the constructor, immediately before `titleRow.add_child(this._project)`:

```ts
      // Leads the title row so its arrow lines up down the popup's left edge
      // rather than floating after a project name of unpredictable width.
      this._expander = new St.Button({
        label: '▾',
        style_class: 'dasbo-expander',
        y_align: Clutter.ActorAlign.CENTER,
        // The row is can_focus: false, so without this the only way to fold a
        // question away is the mouse — see Jump and the header gear.
        can_focus: true,
        visible: false,
      })
      this._expander.connect('clicked', () => {
        this._expanded = !this._expanded
        this._expander.label = this._expanded ? '▾' : '▸'
        this._cb.onToggleQuestion(this._expanded)
      })
      titleRow.add_child(this._expander)
```

- [ ] **Step 3: Add the question box**

After the `this._permissionBox` block (the one ending with the `child-removed` handler), add:

```ts
      // Its own line for the same reason the permission cluster has one: option
      // labels neither wrap nor shrink. Same visibility handling too —
      // ClutterBoxLayout spaces only between visible children, so an
      // always-present empty box would cost every row a gap.
      this._questionBox = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        style_class: 'dasbo-row-question',
      })
      this._questionBox.visible = false
      this._questionBox.connect('child-added', () => {
        this._questionBox.visible = true
      })
      this._questionBox.connect('child-removed', () => {
        this._questionBox.visible = this._questionBox.get_n_children() > 0
      })
```

and add it to the outer column, after `outer.add_child(this._permissionBox)`:

```ts
      outer.add_child(this._questionBox)
```

- [ ] **Step 4: Expose the box and the expander state**

After the `permissionBox` getter:

```ts
    /** Where the Island attaches the QuestionPanel. */
    get questionBox(): St.BoxLayout {
      return this._questionBox
    }

    /**
     * Show or hide the expander arrow. Always resets to expanded: a question
     * arrives already open (the popup opens itself for it), and a row that kept
     * a fold left over from the *previous* question would hide the new one
     * behind an arrow the user never chose to close.
     */
    setHasQuestion(has: boolean): void {
      this._expander.visible = has
      this._expanded = true
      this._expander.label = '▾'
    }
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: FAIL in `src/shell/island.ts` — `onToggleQuestion` is missing from the callbacks object it passes. That is Task 11; leave it failing and commit the row on its own only after Task 11 typechecks. (If you prefer a green commit here, do Steps 1-4 of Task 11 first and commit the two together.)

- [ ] **Step 6: Commit together with Task 11**

Do not commit yet — the tree does not typecheck until Task 11 wires the callback. Task 11 Step 6 commits both files.

---

### Task 11: Wire the panel into the popup

**Files:**
- Modify: `src/shell/island.ts:53-58`, `:162-174`, `:223-279`, `:335-350`
- Modify: `src/extension.ts:62-70`

**Interfaces:**
- Consumes: `QuestionPanel` (Task 9), `SessionRow.questionBox` / `setHasQuestion` (Task 10), `Session.pendingQuestion` (Task 4).
- Produces: `Island.setQuestionHandlers({answer, handOff})`, called from `extension.ts`.

- [ ] **Step 1: Hold the panels**

In `src/shell/island.ts`, add the import:

```ts
import { QuestionPanel } from './questionPanel.js'
```

and the fields beside `_controls`:

```ts
    private _questions = new Map<string, { id: string; panel: QuestionPanel }>()
    private _questionHandlers: {
      answer: (id: string, text: string) => void
      handOff: (id: string) => void
    } | null = null
```

- [ ] **Step 2: Accept the handlers**

After `setPermissionHandlers`:

```ts
    setQuestionHandlers(h: {
      answer: (id: string, text: string) => void
      handOff: (id: string) => void
    }): void {
      this._questionHandlers = h
    }
```

- [ ] **Step 3: Build and tear down panels in `_rebuildRows`**

In the stale-row loop, beside the `_controls` cleanup, add:

```ts
          const staleQuestion = this._questions.get(key)
          if (staleQuestion) {
            staleQuestion.panel.destroy()
            this._questions.delete(key)
          }
```

In the row-construction loop, pass the new callback:

```ts
          const row = new SessionRow(s, {
            onJump: (sess) => this._onJump(sess),
            onToggleQuestion: (expanded) => this._questions.get(s.key)?.panel.setExpanded(expanded),
          })
```

Then, after the permission-controls loop, add a second loop:

```ts
      for (const s of sessions) {
        const row = this._rows.get(s.key)
        if (!row) continue
        const pending = s.pendingQuestion
        const existing = this._questions.get(s.key)

        // Keyed on the id for the same reason the permission cluster is: the
        // table promotes a queued entry by publishing a new hold without ever
        // clearing the old one, so a truthy `existing` can still be bound to a
        // request that already resolved.
        if (pending && existing?.id !== pending.id) {
          existing?.panel.destroy()
          const panel = new QuestionPanel(pending.questions, {
            onAnswer: (text) => this._questionHandlers?.answer(pending.id, text),
            onHandOff: () => this._questionHandlers?.handOff(pending.id),
          })
          panel.attachTo(row.questionBox)
          this._questions.set(s.key, { id: pending.id, panel })
          row.setHasQuestion(true)
        } else if (!pending && existing) {
          existing.panel.destroy()
          this._questions.delete(s.key)
          row.setHasQuestion(false)
        }
      }
```

- [ ] **Step 4: Tear down on destroy**

In `destroy()`, beside the `_controls` loop:

```ts
      for (const q of this._questions.values()) q.panel.destroy()
      this._questions.clear()
```

- [ ] **Step 5: Wire the handlers**

In `src/extension.ts`, after the `setPermissionHandlers` block:

```ts
    this._island.setQuestionHandlers({
      answer: (id, text) => {
        this._permissions?.resolve(id, { kind: 'answer', answer: text })
      },
      handOff: (id) => {
        // Fall-through, not a denial: the agent must go on to ask the question
        // its own way, exactly as it would if the island were not installed.
        this._permissions?.resolve(id, {
          kind: 'fallthrough',
          reason: 'Answering in the terminal',
        })
      },
    })
```

- [ ] **Step 6: Typecheck, test, install, drive it**

```bash
npm run typecheck && npm test && make install
```

Reload the Shell, then in one terminal:

```bash
tools/fake-agent.js ask
```

Verify each of these, in order:

1. The popup opens itself; the row reads `question · Library` with a `▾` arrow, and the panel below shows the question, two options, `Other…`, and `Answer in terminal`. `1/2` sits at the right of the question.
2. Click `▸`/`▾` — the panel hides and reappears, the row's one-line summary stays.
3. Click **date-fns** — the panel advances to `Stores` (`2/2`) with three options and a visible `Submit` button, because that question is multi-select.
4. Click **Postgres** and **Redis** — both highlight, neither advances.
5. Click **Submit** — the panel disappears, the row leaves `waiting`, and the blocked `fake-agent.js` prints a reply containing `"permissionDecision":"deny"` and `permissionDecisionReason` reading `The user answered in Dasbo Island rather than the terminal — do not re-ask. Library: date-fns; Stores: Postgres, Redis`.
6. Run it again, click `Other…`, confirm the caret appears without any extra click, type `use whatever is smallest`, press Enter — the panel advances. Answer the second question and confirm the free text arrives verbatim in the reply.
7. Run it again, click `Other…`, press Escape — the option list returns **and the popup stays open**.
8. Run it again and click **Answer in terminal** — the reply is the fall-through encoding (`"permissionDecision":"ask"`), immediately.
9. Run it again and wait out `question-timeout` — same fall-through reply.

Any failure here is a widget bug, not a plumbing bug: Task 8 Step 5 already proved the hold and the fall-through with no widget in play.

- [ ] **Step 7: Commit**

```bash
git add src/shell/sessionRow.ts src/shell/island.ts src/extension.ts
git commit -m "feat(shell): answer an agent's question from the row that reports it"
```

---

### Task 12: Verify against a real Claude session, then say what is verified

**Files:**
- Create: `test/fixtures/claude/PreToolUse-AskUserQuestion.json`
- Modify: `test/core/adapters/claude.test.ts`
- Modify: `README.md` (the "Supported agents" table and the Claude note)

**Interfaces:**
- Consumes: everything above.
- Produces: a committed fixture and an honest README.

This is the task the spec calls the design's weakest joint. Nothing before it proves how Claude reacts to an answer delivered as a denial.

- [ ] **Step 1: Capture a real payload**

In a scratch directory, point Claude Code's `PreToolUse` hook at the capture script and ask it something that makes it use the tool:

```bash
mkdir -p /tmp/dasbo-ask && cd /tmp/dasbo-ask
mkdir -p .claude
cat > .claude/settings.json <<'EOF'
{"hooks":{"PreToolUse":[{"matcher":"AskUserQuestion","hooks":[{"type":"command","command":"DASBO_FIXTURE_DIR=/tmp/dasbo-ask/fixtures <ABSOLUTE-PATH-TO-REPO>/tools/capture-hook claude"}]}]}}
EOF
claude
```

Then ask it something that forces the tool, e.g. `Ask me which of two date libraries to use, using AskUserQuestion.`

Copy the captured file into the repo and give it a name matching the existing fixtures:

```bash
cp /tmp/dasbo-ask/fixtures/claude/raw-0.json \
   <REPO>/test/fixtures/claude/PreToolUse-AskUserQuestion.json
```

- [ ] **Step 2: Pin the parser to it**

Append to `test/core/adapters/claude.test.ts`:

```ts
it('parses the real captured AskUserQuestion payload', () => {
  const raw = JSON.parse(
    readFileSync(
      new URL('../../fixtures/claude/PreToolUse-AskUserQuestion.json', import.meta.url),
      'utf8'
    )
  )
  const parsed = claudeAdapter.parseQuestions!(raw)
  expect(parsed).not.toBeNull()
  expect(parsed!.length).toBeGreaterThan(0)
  for (const q of parsed!) {
    expect(q.question.length).toBeGreaterThan(0)
    expect(q.header.length).toBeGreaterThan(0)
    expect(q.options.length).toBeGreaterThanOrEqual(2)
  }
})
```

(`readFileSync` is already imported at the top of that file.)

Run: `npx vitest run test/core/adapters/claude.test.ts`
Expected: PASS. A failure here means the real payload differs from the schema read out of the binary — fix `parseQuestions` to match the real payload, and re-run Task 1's tests.

- [ ] **Step 3: Verify the round-trip end to end**

Install the extension's real hooks (prefs → install for Claude Code), start `claude` in a scratch directory, and ask it a question the same way. Then:

1. Answer it from the island.
2. Read what Claude does next in the terminal.

Record the answer to the one question that decides this feature's fate: **does Claude treat the reason as the user's answer and move on, or does it treat the denial as a refusal and ask again?**

- [ ] **Step 4: If Claude re-asks, stop**

Do not soften the wording and re-try more than twice. If two wordings both produce a re-ask, the approach has failed on its own terms — say so, revert Tasks 8-11 (`git revert`, keeping the core work), and take the finding back to the spec. The spec commits to abandoning rather than papering over this.

- [ ] **Step 5: Write down what is now true**

In `README.md`, extend the Claude row of the "Supported agents" table with a new final column entry, and add a paragraph under the Claude heading area:

```markdown
### Answering questions from the popup

When Claude calls `AskUserQuestion`, the island holds the tool and shows the
question in the popup — options, multi-select and a free-text box — instead of
letting the terminal picker render. The answer travels back as
`permissionDecision: "deny"` with the answer as the reason, because a
`PreToolUse` hook has no result channel: that is the only text a hook can put in
front of the model. Not answering within **Question timeout** (default 120s), or
pressing **Answer in terminal**, releases the hold and Claude renders its own
picker as usual.

Verified against <N> captured `AskUserQuestion` payloads and a real
answer round-trip on Claude Code <version>. Codex and Antigravity have no
equivalent tool and are unaffected.
```

Replace `<N>` and `<version>` with what you actually captured and ran against. If the round-trip was not run, say that instead — this file's whole value is that it does not claim more than was checked.

- [ ] **Step 6: Full verification**

```bash
npm test && npm run typecheck
```

Expected: whole suite green, typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add test/fixtures/claude/PreToolUse-AskUserQuestion.json test/core/adapters/claude.test.ts README.md
git commit -m "test(core): pin the question parser to a real captured payload"
```

---

## Verification summary

| What | How |
|---|---|
| Parsing and wording | `npx vitest run test/core/questions.test.ts` |
| Adapter behaviour | `npx vitest run test/core/adapters/` |
| Hold, timeout, drain, reap | `npx vitest run test/core/permissions.test.ts test/core/store.test.ts` |
| Row text | `npx vitest run test/core/activity.test.ts` |
| Core purity | `npx vitest run test/core/purity.test.ts` |
| Types across shell and dbus | `npm run typecheck` |
| The plumbing, before any widget | Task 8 Step 5 (`tools/fake-agent.js ask`) |
| The widget | Task 11 Step 6, nine numbered checks |
| The claim the whole feature rests on | Task 12 Step 3 |
