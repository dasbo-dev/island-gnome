# Answering an agent's question from the island

Date: 2026-07-29
Status: approved, ready for planning

## Problem

The island gates tools. It does not carry questions.

When Claude Code calls `AskUserQuestion`, it renders a picker in the terminal
and blocks there. Nothing about that reaches the island: the row shows
`AskUserQuestion` as a tool name and then sits at `waiting for you` with an
Allow / Deny cluster that answers the wrong question — allowing the tool merely
lets the terminal ask, which is what would have happened anyway.

So a session that needs one word from the user is indistinguishable, from the
top bar, from a session that needs a permission, and answering it always means
finding the terminal window first.

This design puts the question itself in the popup: its options, a free-text
box, and a reply channel back to the agent.

## What Claude actually sends and accepts

Read out of the installed build (`2.1.220`), because no `AskUserQuestion`
payload has ever been captured into `test/fixtures/`.

`tool_input` for the tool:

```
{ questions: [ { question: string,
                 header: string,          // <= 12 chars, a chip label
                 options: [ { label, description, preview? } ],   // 2..4
                 multiSelect: boolean } ] }                       // 1..4 questions
```

`PreToolUse` hook output accepts exactly these fields:

```
{ hookEventName: "PreToolUse",
  permissionDecision: "allow" | "deny" | "ask" | "defer",
  permissionDecisionReason: string,
  updatedInput: object,
  additionalContext: string }
```

Three findings constrain everything below.

**There is no result channel.** No hook output carries a tool *result*. The
only string a `PreToolUse` hook can put in front of the model is
`permissionDecisionReason`, and the model only reads it when the decision is
`deny`. An answer must therefore travel as a denial's reason.

**`defer` is unavailable.** The binary logs `defer is print-mode only;
ignoring` for interactive sessions.

**Async hooks do not help.** A hook may print `{"async": true}` and reply
later, but that backgrounds the hook and lets the tool proceed — the terminal
picker renders and the late reply cannot answer it.

Together these rule out the shape a user would ask for first: question live in
both the terminal and the island at once, first click winning. The hook has one
moment to speak, and while it holds that moment the tool has not run, so no
terminal picker exists. Once it speaks, the extension is mute.

## Approach

The island owns the picker; the terminal is the fallback.

The hook holds its reply. The popup shows the question, its options and a
free-text box. A submitted answer returns as `deny` with the answer in the
reason. If the user never answers — timeout, or the row's **Answer in
terminal** button — the hold is released with the existing fall-through
encoding (`ask`), and Claude renders its own picker then. Both surfaces can
answer, sequentially, and neither can race the other.

## Interception

`RequestPermissionAsync` (`src/dbus/service.ts:99`) already receives every
`PreToolUse`. It gains one branch: if the agent's adapter can parse the payload
as a question set, the request becomes a question hold rather than a permission
hold.

That branch sits **before** the `permissionsBypassed` short-circuit
(`src/dbus/service.ts:151`). `bypassPermissions` suppresses permission prompts;
it does not suppress `AskUserQuestion`, which still asks the user in that mode.
Checking bypass first would silently swallow every question asked in the mode
where the island is most useful.

The dialect stays in the adapter. `AgentAdapter` gains an optional

```ts
parseQuestions?(raw: unknown): Question[] | null
```

implemented only by `claudeAdapter`, keyed on `tool_name === 'AskUserQuestion'`.
Codex and Antigravity have no equivalent concept, never implement it, and are
unaffected.

## One hold engine

Question holds go through `PermissionTable`, not a new table.

That class already owns the per-session queue, the timeout clock that starts on
activation rather than arrival, `releaseSession` for the reaper, and
`resolveAllFallthrough` for `disable()`. That drain *is* the README's
fail-open guarantee. A second table would be a second place to get it wrong,
and the failure mode of getting it wrong is an agent blocked forever.

`PendingEntry` therefore gains a kind and an optional question set.
`timeoutSeconds` is already per-entry, so the longer question timeout needs no
new mechanism — the service simply passes a different number.

## Answer encoding

`DecisionKind` gains `'answer'`; `Decision` gains `answer?: string`.

`claudeAdapter.encodeDecision` maps it onto the only channel that exists:

```json
{"hookSpecificOutput": {
  "hookEventName": "PreToolUse",
  "permissionDecision": "deny",
  "permissionDecisionReason": "The user answered in Dasbo Island rather than the terminal — do not re-ask. Auth method: OAuth device flow"}}
```

Adapters with no question support map `'answer'` onto their own fall-through
encoding, so the switch stays total and an `'answer'` that somehow reaches them
degrades to "no opinion" rather than to a thrown error inside a D-Bus reply.

**This is the design's weakest joint.** The answer arrives wrapped in a
refusal, and how the model reacts to a denied `AskUserQuestion` is not known
here — no payload has been captured, and the wording above is the mitigation,
not a proof. Before this ships, a real round-trip must be captured with
`tools/capture-hook` and committed as a fixture, and the README's per-agent
honesty table gains a row saying what is verified and what is not. If the model
re-asks after a denied answer, the feature is worse than nothing and this
approach has to be abandoned rather than papered over.

## Core module

`src/core/questions.ts`, pure — `src/core/` may not import `gi://` and
`test/core/purity.test.ts` enforces it.

- `parseQuestions(toolInput): Question[] | null` — validates the shape above:
  1–4 questions, 2–4 options each, `label` and `description` strings,
  `multiSelect` defaulting to `false`. Returns `null` for anything unexpected,
  and `null` means "not a question, gate it as an ordinary tool". A payload
  shape that changes under us degrades to today's behaviour instead of to a
  broken panel.
- `formatAnswer(questions, answers): string` — builds the reason text. One
  place, so the wording that has to defuse `deny` is testable without a running
  Shell. Multiple selections join with `, `; multiple questions join with `; `,
  each prefixed by its `header`.

## Session state

`Session` gains `pendingQuestion?: PendingQuestion`:

```ts
interface PendingQuestion {
  id: string
  questions: Question[]
  /** Milliseconds since epoch when this must fall through. 0 means never. */
  deadline: number
}
```

Selections in progress and which question is showing are **not** here. They
belong to `QuestionPanel` and live only as long as it does. The store records
what the agent reported; a half-made choice is not that, and routing every
option click through a store mutation would emit a subscriber notification —
and so a full `_rebuildRows` — per click, on the row the user is mid-way
through using. The panel hands over one completed answer string when the last
question is submitted.

Separate from `pendingPermission` rather than a union: `activityText` and the
row's control attachment both branch on these, and a union would force every
consumer to re-narrow before it could read a field.

`store.ts` keeps the invariant it already enforces for permissions — `waiting`
implies one of the two is set, and both halves are written in the same
statement so no state can exist where the row says `waiting` with nothing to
wait for.

## UI

### Where it attaches

`src/shell/questionPanel.ts`, a plain owner of `St` actors attached to and
detached from a row — the same pattern and the same reason as
`PermissionControls` (`src/shell/permissionRow.ts:17`): the cluster cannot
shrink, so beside the activity label it would starve the text that can run to
190 characters.

`SessionRow` gains a `questionBox` alongside `permissionBox`, with the same
`child-added` / `child-removed` visibility handling, because
`ClutterBoxLayout` spaces only between visible children and an always-present
empty box would cost every row a gap.

### Collapsed

The row keeps its current shape. Its activity line reads `question · <header>`
— `header` is mandatory in Claude's schema and bounded at 12 characters, so it
needs no truncation — and a disclosure arrow appears. Rows with no pending
question have no arrow. The arrow exists so a question the user wants to defer
can be folded away without answering it.

### Expanded

Auto-expands the moment the question arrives, on the same trigger that already
auto-opens the popup for a permission, and collapses itself once submitted.

One question at a time:

```
Which library for date formatting?           1/3
  ( ) date-fns          tree-shakeable
  ( ) Luxon             timezone-aware
  ( ) Other…
                          [Answer in terminal]
```

Single-select: clicking an option records it and advances immediately.
Multi-select: options toggle and a `Next` button appears, because a click can
no longer mean "done". The last question's button reads `Submit`.

There is no way back to an earlier question. The escape hatch for a mis-click
is **Answer in terminal**, which discards the island's partial answers and lets
Claude ask all of them properly.

### Free text

`Other…` swaps into an `St.Entry` in place. Key focus must be set on its
`clutter_text` explicitly — a panel popup does not hand focus to an entry on
its own. `clutter_text::activate` accepts the text and advances.

Escape restores the option list rather than closing the popup, which means the
panel must consume Escape while the entry is live: GNOME's menu grab otherwise
closes the whole popup and the held answer is lost.

### Pill

A pending question sets the session to `waiting`, exactly as a pending
permission does, so `pillState` and the grid animation are untouched — all four
blocks blink and the pill reads `waiting`.

## Failure paths

The hook calls with `NO_TIMEOUT`, so every path must produce a reply; an
invocation that escapes without one blocks the agent forever.

| Path | Reply |
|---|---|
| Question timeout | fall-through; terminal picker renders |
| Extension disabled mid-question | `resolveAllFallthrough`, already covers question entries once they share the table |
| Session reaped while a question is open | `releaseSession`, likewise |
| Panel throws while building | the existing `try/catch` in `RequestPermissionAsync` replies `{}` |
| Answer submitted after the entry resolved | `PermissionTable.finish` already no-ops on an unknown id |
| `parseQuestions` returns `null` | gated as an ordinary tool, today's behaviour |

## Settings

One new key, `question-timeout-seconds`, default `120`. A question needs
reading, unlike a `Bash` command, so it does not share the permission timeout.
Exposed in prefs beside the existing one.

## Testing

- `test/core/questions.test.ts` — `parseQuestions` accepts the real shape and
  rejects malformed variants; `formatAnswer` across single, multi-select and
  multi-question cases.
- `test/core/permissions.test.ts` — question entries queue, time out, and drain
  alongside permission entries on the same session.
- `test/core/store.test.ts` — the `waiting` invariant with a question, and a
  question and a permission arriving on the same session.
- `test/core/adapters/claude.test.ts` — the `'answer'` encoding, and
  `parseQuestions` against a captured fixture.
- `src/shell` remains untested, as it is today: it needs a running GNOME Shell.

## Out of scope

- Codex and Antigravity question support. Neither dialect has the concept.
- Revising an answer to an earlier question in the same call.
- The `preview` field on options. Claude's schema allows it; rendering markdown
  previews in a panel popup is a separate problem.
- Simultaneous terminal and island pickers. Not reachable through hooks — see
  "What Claude actually sends and accepts".
