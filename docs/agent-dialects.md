# Agent hook dialects — captured ground truth

This document records what was **empirically observed** when driving Claude
Code, Codex CLI, and Antigravity CLI (`agy`) through real sessions with
capture hooks installed. It is the source of truth for the Task 4/5 adapters
— every field name below was read off a verbatim payload in
`test/fixtures/`, never inferred from published docs. Where published docs
disagreed with what the installed binary actually did, that disagreement is
called out explicitly.

Capture method: `tools/capture-hook <agent-id>` was registered as the
command for every lifecycle hook event each agent's hook system supports. It
writes each stdin payload verbatim to
`test/fixtures/<agent-id>/raw-<n>.json`, then exits 0 with empty stdout (so
it never blocks or alters agent behavior). Files were renamed after capture
per event kind (see below) and, for Antigravity, curated down from 75
verbatim captures to 12 representative ones (tool/event-kind diversity) —
every kept file is still an unedited verbatim payload, just not every
duplicate step was retained.

Versions actually installed and driven: Claude Code 2.1.220, Codex CLI
0.142.0 (first attempt) / 0.145.0 (second attempt — self-updated between
attempts) / 0.146.0 (third attempt, the one that captured), Antigravity CLI
(`agy`) 1.1.7.

---

## Claude Code — CAPTURED, complete

**Config file used:** project-scoped `<project>/.claude/settings.json`
(here `/tmp/dasbo-capture/.claude/settings.json`), **not**
`~/.claude/settings.json` — see the task's controller-resolution override.
Claude Code reads project-level `hooks` from this path exactly like the
user-global file; the shape is identical to what the brief specified for
`~/.claude/settings.json`, and it worked unmodified on the first attempt.

```json
"hooks": {
  "SessionStart":     [{ "hooks": [{ "type": "command", "command": "env DASBO_FIXTURE_DIR=<repo>/test/fixtures <repo>/tools/capture-hook claude" }] }],
  "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "env DASBO_FIXTURE_DIR=<repo>/test/fixtures <repo>/tools/capture-hook claude" }] }],
  "PreToolUse":       [{ "matcher": "*", "hooks": [{ "type": "command", "command": "env DASBO_FIXTURE_DIR=<repo>/test/fixtures <repo>/tools/capture-hook claude" }] }],
  "PostToolUse":      [{ "matcher": "*", "hooks": [{ "type": "command", "command": "env DASBO_FIXTURE_DIR=<repo>/test/fixtures <repo>/tools/capture-hook claude" }] }],
  "Stop":             [{ "hooks": [{ "type": "command", "command": "env DASBO_FIXTURE_DIR=<repo>/test/fixtures <repo>/tools/capture-hook claude" }] }]
}
```

Driven with (from `/tmp/dasbo-capture`):
```
claude -p 'read a.txt, then append the word world to it, then run `ls -la`' --dangerously-skip-permissions
```
(The first attempt without `--dangerously-skip-permissions` was also
captured — see `PreToolUse-4.json`, an `Edit` call that was denied for lack
of permission and therefore has no matching `PostToolUse`. This is itself a
useful fixture: it shows what a **blocked** tool call's `PreToolUse` payload
looks like, with no `tool_response` because the tool never ran.)

**Events observed:** `SessionStart`, `UserPromptSubmit`, `PreToolUse`,
`PostToolUse`, `Stop` — all five hooks wired at capture time fired at least
once, across two agent runs in the scratch dir (hence two of each of
`SessionStart`/`UserPromptSubmit`/`Stop`).

A sixth hook, `SessionEnd`, was wired into the extension's install plan later
(see `CLAUDE_EVENTS` in `src/core/install/plan.ts`) and is **uncaptured**: no
fixture exists for it in `test/fixtures/claude/`, and nothing below about its
exact key names was read off a verbatim payload the way it was for the other
five. It is reasonable to expect it shares the `hook_event_name`/`session_id`/
`cwd` shape common to every other Claude hook, but that is an inference, not
an observation — the captured-vs-inferred distinction this document otherwise
draws throughout applies to `SessionEnd` too.

A seventh hook, `Notification`, was wired in later still (again see
`CLAUDE_EVENTS` in `src/core/install/plan.ts`) and is **uncaptured** for the
same reason: no fixture exists in `test/fixtures/claude/`, and the field the
adapter reads — `message`, carrying the text shown to the user — was taken from
the published shape rather than off a verbatim payload. `session_id` and `cwd`
are the only fields `normalize` requires, and both are common to every captured
Claude payload, so the event normalises even if `message` is spelled
differently; the adapter then leaves `detail` undefined and the feature is
silent rather than wrong. Capturing one is a matter of registering
`tools/capture-hook claude` under `Notification` and leaving a session idle for
a minute.

An eighth hook, `StopFailure`, was wired in after that and **is captured** —
in a second session, against Claude Code 2.1.220, by a method of its own; see
"StopFailure — the other way a turn ends" below.

**Tools observed:** `Read`, `Edit` (file-edit tool), `Bash` (shell tool) —
`Edit` has both a denied-`PreToolUse`-only fixture and a successful
Pre+Post pair.

### Exact key names

Covers the five hooks captured in the first session — `SessionStart`,
`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`. Neither `SessionEnd`
nor `Notification` is represented here; see above for both. `StopFailure` has
its own key table below.

| Field | Key | Notes |
|---|---|---|
| Event name | `hook_event_name` | e.g. `"PreToolUse"`, `"Stop"` |
| Session id | `session_id` | UUID, stable across all hooks in one Claude session |
| Cwd | `cwd` | absolute path, e.g. `/tmp/dasbo-capture` |
| Tool name | `tool_name` | only present on `PreToolUse`/`PostToolUse`; e.g. `"Bash"`, `"Edit"`, `"Read"` |
| Transcript path | `transcript_path` | e.g. `/home/<user>/.claude/projects/-tmp-dasbo-capture/<session_id>.jsonl` |
| Process id | **ABSENT** | no `pid` field anywhere in any Claude hook payload |

Other fields present on every payload: `prompt_id` (present from
`UserPromptSubmit` onward, absent on `SessionStart`), `permission_mode`
(e.g. `"bypassPermissions"`), `effort.level`. Tool payloads add `tool_input`
(the tool's arguments, exact per-tool shape) and, on `PostToolUse`,
`tool_response` (per-tool shape — for `Bash`: `stdout`/`stderr`/
`interrupted`/`isImage`/`noOutputExpected`; for `Edit`:
`filePath`/`oldString`/`newString`/`originalFile`/`structuredPatch`/
`userModified`/`replaceAll`) and `duration_ms`. `SessionStart` additionally
has `source` (e.g. `"startup"`). `Stop` additionally has
`stop_hook_active`, `last_assistant_message`, `background_tasks`,
`session_crons`.

**Fixtures:** `test/fixtures/claude/` — 18 files:
`SessionStart-0.json`, `SessionStart-8.json`, `UserPromptSubmit-1.json`,
`UserPromptSubmit-9.json`, `PreToolUse-{2,4,5,10,12,14}.json`,
`PostToolUse-{3,6,11,13,15}.json`, `Stop-{7,16}.json`,
`StopFailure-17.json`.

### StopFailure — the other way a turn ends

**A turn that fails fires `StopFailure` and does not fire `Stop`.** The two are
alternatives, not a sequence. This is the whole reason the event is installed:
before it was, a session whose API call errored sat on "thinking" forever,
because the island's only turn-ending event never arrived and the reaper only
drops a session whose *process* is gone — and the Claude REPL is still sitting
there at its prompt.

**Capture method** (different from the one at the top of this document,
because an API error cannot be driven by prompting): a local HTTP server
answering every request with `400` and an `invalid_request_error` body, with
`ANTHROPIC_BASE_URL` pointed at it. From `/tmp/dasbo-stopfail`, hooks wired
project-scoped as above for `SessionStart`, `UserPromptSubmit`, `Stop`,
`StopFailure` and `SessionEnd`:

```
ANTHROPIC_BASE_URL=http://127.0.0.1:8787 ANTHROPIC_API_KEY=<any> \
  claude -p 'say hi' --dangerously-skip-permissions
```

Claude printed `API Error: 400 …` and exited 1.

**Events observed, in order:** `SessionStart`, `UserPromptSubmit`,
`StopFailure`, `SessionEnd`. `Stop` was wired for that run and **did not
fire**. (`SessionEnd` arrives here only because `-p` exits when it is done;
an interactive session stays open and sends nothing further, which is exactly
the case the extension was stuck in.)

The same split is visible in the shipped binary: the query loop's
`isApiErrorMessage` branch fires the `StopFailure` hook and returns
`{reason:"api_error"}` before reaching the code that runs the `Stop` hooks.
Two neighbouring branches — a prompt that cannot be compacted small enough,
and a tool call the model malformed twice — return the same way, so those end
a turn through this event too.

### StopFailure key names

| Field | Key | Notes |
|---|---|---|
| Event name | `hook_event_name` | `"StopFailure"` |
| Session id | `session_id` | as everywhere else |
| Cwd | `cwd` | as everywhere else |
| Error kind | `error` | a slug — `rate_limit`, `server_error`, `authentication_failed`, `invalid_request`, `max_output_tokens`, … — and the literal `"unknown"` when Claude has no kind to report, which is what the captured payload carries |
| Error detail | `error_details` | the API's own text. **Absent** on the captured payload; the binary fills it on the prompt-too-long path |
| Last message | `last_assistant_message` | what the user saw in the terminal — `"API Error: 400 dasbo capture: deliberate API failure"` in the fixture |

`transcript_path`, `prompt_id` and `effort` are present as they are elsewhere.
`permission_mode` is **absent**, unlike on `UserPromptSubmit` and the tool
events.

`claudeAdapter` maps the event to the `error` kind and takes its detail from
`error_details`, then `last_assistant_message`, then `error` — skipping the
`"unknown"` placeholder, which would put a word on the row that says less than
the row's own fallback.

---

## Codex CLI 0.146.0 — CAPTURED, complete (0.142.0/0.145.0 were BLOCKED; see history below)

**Config file:** `~/.codex/hooks.json` — unchanged since the earlier attempts.

**Shape — this is what the two earlier attempts got wrong.** Codex 0.146.0
takes *Claude's* shape: an **event-keyed** map under `hooks`, each event
holding groups of command handlers.

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "<hook> codex notify SessionStart" }] }],
    "PreToolUse":   [{ "matcher": "*", "hooks": [{ "type": "command", "command": "<hook> codex notify PreToolUse" }] }]
  }
}
```

The **named-hook** form both earlier attempts used — `{"hooks": {"<hook-name>":
{"command": …, "events": [...]}}}` — parses with no warning and fires nothing,
whatever spelling goes in `events`. That is why lowercase-dot, PascalCase and
camelCase all produced identical negative results: the `events` key was never
the variable. dasbo shipped that form from its first release until this
capture, which is why no Codex session ever reached the island.

**Second gate: hook trust.** With the correct shape in place, hooks still fire
only when Codex has been told to trust the config. Verified by control: the
same file that fired all six events under
`--dangerously-bypass-hook-trust` fired **zero** without it. Trust is persisted
per config (`HookStateToml { enabled, trusted_hash }`, reachable in the binary
as `hooks.state`) and granted through the TUI's startup hook review — there is
no CLI subcommand for it, and `--dangerously-bypass-hook-trust` is scoped to a
single invocation. So an install is not live until the user starts `codex` once
and approves.

**Events observed:** all six dasbo installs fired, in this order, in one
`codex exec` run: `SessionStart`, `UserPromptSubmit`, `PreToolUse`,
`PostToolUse`, `Stop`, `SessionEnd`. `PermissionRequest` was configured in the
same run and did not fire, because approvals were bypassed — its payload shape
is still uncaptured.

Codex's full event set, read off `hooks/src/events/*.rs` paths embedded in the
binary: `pre_tool_use`, `permission_request`, `post_tool_use`, `compact`
(Pre/Post), `session_start`, `session_end`, `stop`, `user_prompt_submit`, plus
`SubagentStart`/`SubagentStop`. There is **no `Notification` event** — Claude's
idle-notification path has no Codex counterpart.

**Driving command** (from `/tmp/dasbo-codex-probe`):
```
codex exec --skip-git-repo-check --dangerously-bypass-hook-trust \
  --dangerously-bypass-approvals-and-sandbox 'run echo hi'
```

### Exact key names

| Field | Key | Notes |
|---|---|---|
| Event name | `hook_event_name` | PascalCase, e.g. `"PreToolUse"`, `"Stop"` — identical to Claude |
| Session id | `session_id` | UUIDv7, stable across every hook in one session |
| Cwd | `cwd` | absolute path |
| Tool name | `tool_name` | on `PreToolUse`/`PostToolUse`; observed value `"Bash"` |
| Tool input | `tool_input` | e.g. `{"command": "echo hi"}` |
| Transcript path | `transcript_path` | `~/.codex/sessions/<y>/<m>/<d>/rollout-<ts>-<session_id>.jsonl` |
| Process id | **ABSENT** | no `pid` field, same as Claude |

Other fields: `model`, `permission_mode` on every event except `SessionEnd`;
`turn_id` from `UserPromptSubmit` onward; `source` on `SessionStart`; `prompt`
on `UserPromptSubmit`; `tool_response` and `tool_use_id` on `PostToolUse`;
`stop_hook_active` and `last_assistant_message` on `Stop`; `reason` on
`SessionEnd`.

**Permission decisions are not available to us.** The binary carries explicit
rejections for a PreToolUse hook that answers `permissionDecision: allow` or
`: ask` ("PreToolUse hook returned unsupported permissionDecision:allow"),
leaving `deny` as the only decision that event accepts; approve/deny properly
belongs to `PermissionRequest`. dasbo therefore installs every Codex event in
notify mode, and `codexAdapter.encodeDecision` is unreachable from a real
session.

**Fixtures:** `test/fixtures/codex/` — 6 files, one per event:
`SessionStart.json`, `UserPromptSubmit.json`, `PreToolUse.json`,
`PostToolUse.json`, `Stop.json`, `SessionEnd.json`.

### History: why 0.142.0 and 0.145.0 were recorded as BLOCKED

The first attempt was blocked on auth. The second had working auth and tried
three `events` spellings inside the named-hook form (lowercase-dot, PascalCase,
camelCase), all parsing cleanly and firing nothing, with zero hook lines under
`RUST_LOG=trace` and no `HookCompletedEvent` in any session rollout. It
recorded three hypotheses: a fourth spelling, a superseded config mechanism, or
an unbypassable trust gate. The middle one was right, and the trust gate is
real as well — just bypassable with the flag. The spelling hypothesis was a
dead end: a fourth spelling (snake_case, matching the `hooks/src/events/*.rs`
module names) was tried during this capture and also fired nothing, because the
enclosing shape was still wrong.

---

## Antigravity CLI (`agy`) 1.1.7 — CAPTURED, with an important dialect gap

**Config file:** `~/.gemini/config/hooks.json` — this path guess from the
brief was correct (confirmed by the CLI's own bundled documentation at
`~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/hooks.md`,
which states the global hooks root is `~/.gemini/config/`).

**What the brief guessed vs. the real shape:** the brief's guess put event
names directly at the top level (`{"PreToolUse": [...], ...}`), matching
Claude's shape. The real shape, per the CLI's own shipped docs, nests every
event-set under an arbitrary **hook name** first:
```json
{
  "<hook-name>": {
    "PreToolUse":  [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "..." }] }],
    "PostToolUse": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "..." }] }],
    "PreInvocation":  [{ "type": "command", "command": "..." }],
    "PostInvocation": [{ "type": "command", "command": "..." }],
    "Stop":           [{ "type": "command", "command": "..." }]
  }
}
```
Also: `PreToolUse`/`PostToolUse` are "grouped" (`matcher` + `hooks` array,
like Claude), but `PreInvocation`/`PostInvocation`/`Stop` are **flat** lists
of handler objects directly — no `matcher`, no `hooks` wrapper. Using
Claude's flat-vs-grouped assumption uniformly (as the brief did) is wrong
for 3 of the 5 events. There is no `SessionStart`-equivalent event;
`PreInvocation` (before each model call) is the nearest analog.

The brief's guessed config was corrected to match the CLI's own docs before
a capture attempt was made, and this corrected shape is what actually
captured payloads (see below) — so it is confirmed correct, not just
theoretically so.

**Driving the agent — two behavioral obstacles beyond hook shape:**
1. `agy --print --dangerously-skip-permissions '<prompt>'` — flag order
   matters. With `--print` immediately before `--dangerously-skip-permissions`,
   `agy` did not run the prompt at all; it answered a generic question about
   what the `--dangerously-skip-permissions` flag does. Putting
   `--dangerously-skip-permissions` before `--print` avoided this.
2. Even then, `agy` invoked the (globally installed) `superpowers`
   plugin's `writing-plans` skill, produced an implementation plan artifact,
   and stopped to wait for approval rather than executing — because
   `--print` alone does not imply "skip planning". Adding an explicit
   instruction to the prompt ("Do not write a plan file or ask for
   approval. Immediately: ...") together with `--mode accept-edits` got a
   real execution.

Neither obstacle is a hook-shape problem; both are recorded here because
Task 5's fixture-regeneration instructions (if any) will hit the same
walls.

**Workspace note:** the executing session operated in
`~/.gemini/antigravity-cli/scratch`, not `/tmp/dasbo-capture` — `agy` in
print mode did not adopt the shell's cwd as its workspace, and no
`--project`/`--add-dir` flag was used to force it. The task's actual file
(`/tmp/dasbo-capture/a.txt`) was consequently never touched by Antigravity;
the append+`ls -la` was performed against a different `a.txt` inside agy's
own scratch project. This does not affect the validity of the captured
hook payload *shapes* (which are what this task needs), but it does mean
`workspacePaths` in every captured payload is an **empty array**, not the
scratch directory path — see below.

**Events observed:** `PreInvocation`, `PostInvocation`, `PreToolUse`,
`PostToolUse`, `Stop`. All 5 wired events fired.

**Tools observed:** `view_file` (read), `list_dir`, `list_permissions`,
`run_command` (the shell/bash-equivalent tool — args
`{CommandLine, Cwd, WaitMsBeforeAsync}`), `write_to_file` (the file-edit
tool — args include `TargetFile`, `CodeContent`, `Overwrite`,
`ArtifactMetadata`). `run_command` and `write_to_file` fixtures were kept
specifically to satisfy "both a file-edit tool and a bash tool captured".

Two caveats on that tool list. `list_dir` is named as observed but **no
`list_dir` fixture was kept**, so this document carries no shape reference
for it — an adapter author has nothing to check against for that tool. And
the kept `write_to_file` pair (`PreToolUse-40.json` / `PostToolUse-41.json`)
comes from a different conversation (`51537811-…`, the aborted
plan-writing run) than the other ten fixtures (`74bcbcf3-…`, the real
execution run): it captures a `plan.md` write, not the `a.txt` append the
driving prompt asked for. The payload is verbatim and its *shape* is
valid — which is what the adapters need — but it is semantically unrelated
to the prompt, so do not read it as evidence of how a requested edit flows.

### Critical dialect gap: no event-name field in the payload at all

Unlike Claude (`hook_event_name`) and Codex (`type`), **no Antigravity hook
payload contains any field that names which lifecycle event fired it.**
`PreInvocation` and `PostInvocation` payloads are byte-for-byte
structurally identical (same key set: `conversationId`, `initialNumSteps`,
`invocationNum`, `modelName`, `transcriptPath`, `workspacePaths`,
`artifactDirectoryPath`) — there is no way to tell them apart from content
alone. The brief anticipated this risk generically ("whichever key
Antigravity uses") but the real answer is: **there is no such key.**

The classification used to name the fixtures below was done by hand,
using: (a) which position in the session's step sequence the file was
captured at (Pre fires once per invocation before any of that invocation's
tool steps; Post fires once after), and (b) for tool events, the presence
of an `error` key (present, even if `""`, only on `PostToolUse`; absent on
`PreToolUse`) as a reliable proxy. This heuristic worked here because we
know the wiring, but it is **not something a real adapter can do from a
single isolated payload** — it requires either:
- wiring a different `command` string per event array in `hooks.json` (so
  the argv the adapter's own hook script receives encodes the event name),
  which is what Task 5's Antigravity hook config **must** do — reusing one
  `capture-hook antigravity` command for all five events (as this task did,
  matching the brief's original design) throws away the only information
  needed to label events; or
- an adapter that only ever distinguishes `PreToolUse` vs `PostToolUse` (via
  the `error`-key heuristic) and treats Pre/PostInvocation as
  indistinguishable / does not attempt to render them separately.

**Recommendation for Task 5:** configure Antigravity's `hooks.json` with a
distinct `command` per event (e.g.
`capture-hook antigravity PreToolUse`, `... PostToolUse`, `...
PreInvocation`, etc.) rather than one shared command, so the event name is
known from argv rather than inferred from payload shape.

### Exact key names (all camelCase — protojson encoding, per the CLI's own docs)

| Field | Key | Notes |
|---|---|---|
| Event name | **ABSENT** | see above — must come from hook wiring (argv), not payload content |
| Session id | `conversationId` | UUID; stable across all hooks in one `agy` conversation; there is no separate "session id" field |
| Cwd | `workspacePaths` | array, not a scalar; **observed as `[]` (empty)** in this session because `agy --print` did not treat `/tmp/dasbo-capture` as its workspace — do not assume it is non-empty |
| Tool name | `toolCall.name` | nested; only present on `PreToolUse`/`PostToolUse`; `null` was also observed on one `PostToolUse` for a non-tool "step" (`stepIdx: 1`, thinking-only step — `toolCall` can legitimately be `null` even on a tool-event hook) |
| Transcript path | `transcriptPath` | e.g. `.../antigravity-cli/brain/<conversationId>/.system_generated/logs/transcript_full.jsonl` |
| Process id | **ABSENT** | no `pid` field anywhere in any Antigravity hook payload |

Other fields present on every payload: `artifactDirectoryPath`,
`modelName`. Tool-event payloads add `stepIdx` and `toolCall.args` (shape
is per-tool). `PostToolUse` adds `error` (empty string `""` when the tool
succeeded — presence of this key, not its value, is what distinguishes
Pre from Post) and, inside `toolCall.args`, **an open set** of extra keys
not present at `PreToolUse` time. At least `toolAction` and `toolSummary`
(human-readable descriptions filled in after execution) appear on every
observed pair, but per-tool fields are added too — `PostToolUse-41.json`
(`write_to_file`) also carries a `Description` key absent from its
`PreToolUse-40.json` counterpart. Treat this as a lower bound, never as a
closed set: an adapter that enumerates the post-only keys will drop
tool-specific fields. `PreInvocation`/`PostInvocation`
add `invocationNum` and `initialNumSteps`. `Stop` adds `executionNum`,
`terminationReason` (observed value: `"NO_TOOL_CALL"` — not one of the
three example values, `model_stop`/`max_steps_exceeded`/`error`, given in
the CLI's own docs, so treat that enum as open-ended, not closed), `error`,
and `fullyIdle` (boolean).

**Fixtures:** `test/fixtures/antigravity/` — 12 curated files (of 75
verbatim captures; the rest were duplicate skill-loading/exploration steps
from the same sessions and were discarded, not fabricated):
`PreInvocation-46.json`, `PostInvocation-50.json`,
`PreToolUse-{40,48,53,57}.json` (`write_to_file`, `view_file`,
`list_permissions`, `run_command` respectively),
`PostToolUse-{41,47,49,54,58}.json` (same tools, plus the `toolCall: null`
edge case at `-47`), `Stop-74.json`.

The 63 discarded payloads are unrecoverable. Every kept fixture carries
`error: ""`, so **no genuine tool-failure payload was preserved** — if one
occurred among the discarded set, its shape is unknown. An adapter must
therefore treat a non-empty `error` string as possible but unexemplified,
and must not assume the failure payload is structurally identical to the
success payload beyond the keys documented above.

---

## Summary for Task 4/5

| Agent | Adapter status | Fixture count | Blocker |
|---|---|---|---|
| Claude Code | ready to implement | 18 | none |
| Codex 0.146.0 | ready to implement | 6 | none for capture; hooks do not fire until the user approves Codex's TUI hook review, which no CLI flag makes permanent — see Codex section above |
| Antigravity 1.1.7 | ready to implement, with a caveat | 12 | none for capture, but the adapter must not rely on any in-payload event-name field — see "Critical dialect gap" above |

---

## How agents spawn hooks

Claude runs a hook the way it runs any shell command: through a wrapper shell
executing a compound command, roughly

```
zsh -c 'source <shell-snapshot>.sh ... && eval <hook command>'
```

Because the command is compound, the shell never `exec`s the hook. It stays
alive as the hook's parent and exits the moment the hook does. So the hook's
ppid is a process that is dead milliseconds later, and it is not the agent.

`resolveAgent` therefore walks the ancestor chain and identifies the agent by
`comm` (`AgentAdapter.procNames`). Shells (`sh`, `dash`, `bash`, `zsh`, `fish`,
`env`) are skipped, since a login shell wrapping the wrapper shell is a real
shape. An interpreter (`node`, `gjs`) instead stops the walk — an npm-installed
agent runs behind a `#!/usr/bin/env node` shim, so its own `comm` is `node`,
and walking past it the way a shell is skipped would land on the terminal
emulator above it. Before stopping, the interpreter's `/proc/<pid>/cmdline` is
checked for an argument whose basename is in `procNames`; if one matches, that
process IS the agent. Otherwise the walk stops there and falls back to the
nearest non-shell, non-interpreter ancestor found so far, and to `0` — meaning
unknown — when nothing matches. The session's `startedAt` comes from that
process's own start time in `/proc`, which makes it recoverable at any point
rather than observable only when `SessionStart` fires.

The hook process itself changed `comm` when `plan.ts` moved from a bare-path
invocation to `gjs -m <hookPath>` (see the comment on `cmd()` in
`src/core/install/plan.ts`): the kernel used to set `comm` to `dasbo-hook`,
read off the shebang'd executable itself; under `gjs -m` it is `gjs`. Nothing
downstream breaks — `selectAgentPid` starts its ancestor walk at index 1, past
the hook process itself, and no `procNames` list contains `gjs` — but it means
`pgrep dasbo-hook` no longer finds a live hook process. Anyone troubleshooting
by process name should `pgrep gjs` instead, or grep `/proc/<pid>/cmdline` for
`dasbo-hook`.
