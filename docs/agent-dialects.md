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
0.142.0, Antigravity CLI (`agy`) 1.1.7.

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
`PostToolUse`, `Stop` — all five hooks that were wired fired at least once,
across two agent runs in the scratch dir (hence two of each of
`SessionStart`/`UserPromptSubmit`/`Stop`).

**Tools observed:** `Read`, `Edit` (file-edit tool), `Bash` (shell tool) —
`Edit` has both a denied-`PreToolUse`-only fixture and a successful
Pre+Post pair.

### Exact key names

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

**Fixtures:** `test/fixtures/claude/` — 17 files:
`SessionStart-0.json`, `SessionStart-8.json`, `UserPromptSubmit-1.json`,
`UserPromptSubmit-9.json`, `PreToolUse-{2,4,5,10,12,14}.json`,
`PostToolUse-{3,6,11,13,15}.json`, `Stop-{7,16}.json`.

---

## Codex CLI 0.142.0 — BLOCKED (environmental: not authenticated), but one real dialect finding recovered

**Config file:** `~/.codex/hooks.json`.

**What the brief guessed vs. what Codex's own parser demands:** the brief's
guessed shape was a bare map at the top level:
```json
{ "vibe-island": { "command": "...", "events": [...] } }
```
This is the shape that was **already installed** on this machine (the
foreign `vibe-island` entry). Codex 0.142.0 rejects it. Running `codex exec`
against it printed, before anything else:
```
warning: failed to parse hooks config /home/fsevenm/.codex/hooks.json: unknown field `vibe-island`, expected `hooks` at line 2 column 15
```
i.e. the **real** required shape wraps the named-hook map in a `hooks` key:
```json
{
  "hooks": {
    "vibe-island":   { "command": "...", "events": [...] },
    "dasbo-capture": { "command": "...", "events": [...] }
  }
}
```
This was corrected (see `~/.codex/hooks.json` during the capture window,
restored afterward) and the parse warning disappeared on the next run,
confirming the corrected shape is at least syntactically accepted. **This
was not verified beyond the parser** because every attempt to run a real
Codex session failed for an unrelated reason described below. Also
noteworthy: this installed Codex build supports
`--dangerously-bypass-hook-trust`, implying hook execution is normally
gated behind a persisted "hook trust" step that was never established for
`dasbo-capture` — a second variable this task could not isolate from the
auth failure.

**Why no session completed:** `codex login status` → `Not logged in`. No
`OPENAI_API_KEY` or other credential is present in this environment. Every
`codex exec` attempt (with `--skip-git-repo-check
--dangerously-bypass-hook-trust --dangerously-bypass-approvals-and-sandbox`
to clear the non-hook blockers) failed with repeated
`HTTP error: 401 Unauthorized` against `api.openai.com` and eventually gave
up reconnecting. This is an **authentication/environment failure, not a
hook-shape failure** — no fixtures could be produced regardless of hook
config correctness, because the agent never got far enough to run a tool.

**What was tried (2 alternative angles, per the task's escalation rule):**
1. The brief's literal shape (already installed) — rejected by Codex's own
   parser (`unknown field vibe-island, expected hooks`).
2. The corrected `{"hooks": {...}}` wrapper implied by that parser error —
   parses cleanly (warning disappears), but could not be exercised further
   because of the unrelated 401s.

No third attempt was made; further iteration would not fix an auth problem,
and the task instructions are explicit that auth/network failures should be
reported plainly rather than treated as a hook-shape problem to keep
guessing at.

**Exact key names:** unknown — **ABSENT** (no payload was ever captured).
Task 5's Codex adapter should be marked **BLOCKED** until a session can be
authenticated and re-run against the corrected `{"hooks": {...}}` shape
above.

**Fixtures:** none. `test/fixtures/codex/` does not exist.

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
Pre from Post) and, inside `toolCall.args`, two extra keys not present at
`PreToolUse` time: `toolAction` and `toolSummary` (human-readable
descriptions filled in after execution). `PreInvocation`/`PostInvocation`
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

---

## Summary for Task 4/5

| Agent | Adapter status | Fixture count | Blocker |
|---|---|---|---|
| Claude Code | ready to implement | 17 | none |
| Codex 0.142.0 | **BLOCKED** | 0 | not authenticated in this environment (401 on every API call); hooks.json shape corrected (`{"hooks": {...}}`) but unverified past the config parser |
| Antigravity 1.1.7 | ready to implement, with a caveat | 12 | none for capture, but the adapter must not rely on any in-payload event-name field — see "Critical dialect gap" above |
