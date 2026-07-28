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
attempts), Antigravity CLI (`agy`) 1.1.7.

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

**Tools observed:** `Read`, `Edit` (file-edit tool), `Bash` (shell tool) —
`Edit` has both a denied-`PreToolUse`-only fixture and a successful
Pre+Post pair.

### Exact key names

Covers the five captured hooks only — `SessionStart`, `UserPromptSubmit`,
`PreToolUse`, `PostToolUse`, `Stop`. `SessionEnd` is not represented here;
see above.

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

## Codex CLI 0.142.0 → 0.145.0 — BLOCKED (auth fixed; hooks parse but never fire), zero fixtures

Auth was fixed for this attempt (`codex login status` → `Logged in using
ChatGPT`), and the installed binary self-updated mid-environment from
0.142.0 to **0.145.0** (`codex doctor` shows `startup update check: true`,
`cached latest version 0.145.0`) — so this round's findings are against
0.145.0, a newer build than the one the first attempt characterized. The
auth blocker is gone. A **different** blocker replaced it: the hooks
config is demonstrably read and validated by the binary, but no hook of
ours ever executed, under any of three attempted event-name spellings, and
no available diagnostic (trace logging, session rollout log, subprocess
evidence) explains why. This is reported as **BLOCKED** per the task's
explicit instruction to keep this status when zero fixtures are captured,
even though the blocker itself is new information.

**Config file:** `~/.codex/hooks.json` — confirmed still the right path.
Proof it is actually parsed on 0.145.0, not just silently ignored: feeding
it deliberately invalid JSON (`{ this is not valid json`) reproduced a
parse warning at the exact path (`warning: failed to parse hooks config
/home/fsevenm/.codex/hooks.json: key must be a string at line 1 column 3`),
confirming the config-discovery/parse code path in
`hooks/src/engine/discovery.rs` (path recovered from strings embedded in
the Codex binary) is live in 0.145.0 exactly as documented for 0.142.0.

**Shape used (per this task's brief, activating both entries):**
```json
{
  "hooks": {
    "vibe-island":   { "command": "python3 /home/fsevenm/.codex/vibe-island-hook.py", "events": [...] },
    "dasbo-capture": { "command": "env DASBO_FIXTURE_DIR=.../test/fixtures /path/to/tools/capture-hook codex", "events": [...] }
  }
}
```
This shape — a `hooks` map keyed by an **arbitrary hook name** (not an
event name), each value holding one `command` plus a list of `events` it
subscribes to — parses with **no warning** on 0.145.0 for all three `events`
value spellings tried below, confirming the wrapper shape itself
(established by the first attempt against 0.142.0) is still correct. The
open question was only ever what strings belong inside `events`.

**Backing up / restoring, as required:** `~/.codex/hooks.json` was copied to
`~/.codex/hooks.json.precapture` before any edits. After all attempts, it
was restored with `cp -p` and verified two ways: `cmp` reported no
differences, and `md5sum` of both files matched exactly
(`b76c3a02ea88dae082149909f296362e`). The backup file was then deleted.
Restoring **activated** the previously-dormant `vibe-island` entry for the
duration of the capture window (it was foreign, unwrapped, and thus
rejected by the parser before this task touched it) — per the task's own
note, its script only attempts a Unix socket connection and gives up
quietly, so this was harmless, and it is gone now that the original
unwrapped (and therefore parser-rejected, therefore inert) file is back.

**Driving command** (from `/tmp/dasbo-capture`, `a.txt` seeded with
`hello`):
```
codex exec --skip-git-repo-check --dangerously-bypass-hook-trust --dangerously-bypass-approvals-and-sandbox 'read a.txt, append the word world to it, then run `ls -la`'
```
This **worked** as an agent session in all three attempts below — Codex
read the file, appended `world`, and ran `ls -la`, i.e. the tool-use path
that should trigger `PreToolUse`/`PostToolUse`-equivalent hooks definitely
executed. No hook fixture was ever written despite that.

**What was tried (3 alternatives, the task's cap, then stopped):**

1. **The task brief's literal `events` values** — lowercase, dot-separated,
   matching the pre-existing `vibe-island` entry's own convention:
   `["session.start","session.end","tool.start","tool.end"]`. Parsed
   cleanly. Zero fixtures.
2. **PascalCase**, matching a cluster of hook-event-name strings found
   embedded in the Codex 0.145.0 binary itself
   (`strings <codex-binary> | grep -E 'PreToolUse|SessionStart|...'`,
   specifically adjacent to a `ManagedHooksRequirements.ts` type listing:
   `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`,
   `PostCompact`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`,
   `SubagentStart`, `SubagentStop` — i.e. Claude Code's own vocabulary,
   found verbatim inside the Codex binary):
   `["SessionStart","SessionEnd","PreToolUse","PostToolUse"]`. Parsed
   cleanly. Zero fixtures.
3. **camelCase**, matching a *different* contiguous string cluster in the
   same binary (`preToolUse`, `permissionRequest`, `postToolUse`,
   `preCompact`, `postCompact`, `sessionStart`, `sessionEnd`,
   `subagentStart`, `subagentStop` — found immediately adjacent to
   `HookTrustStatus` `trusted`/`untrusted` strings, and to a
   `HookRunSummary.eventName` TypeScript binding, suggesting a
   `#[serde(rename_all = "camelCase")]` JS-facing wire encoding distinct
   from the enterprise-policy PascalCase names above):
   `["sessionStart","sessionEnd","preToolUse","postToolUse"]`. Parsed
   cleanly. Zero fixtures.

All three produced **identical negative evidence**, checked three ways:
- `test/fixtures/codex/` was never created (`capture-hook` never ran).
- A full `RUST_LOG=trace codex exec ...` run (2,269 log lines) contained
  **zero** lines matching `hook` case-insensitively — not even a "loaded N
  hooks" info-level line, despite `codex features list` showing `hooks
  stable true` (the feature is on) and despite the parser being
  demonstrably live (see the malformed-JSON control test above).
- Every session rollout JSONL written this session
  (`~/.codex/sessions/2026/07/27/*.jsonl`, 9 files across all attempts) was
  grepped for `hook`; none contains a `HookCompletedEvent` or any other
  hook-tagged item, even though the binary's own strings show
  `HookCompletedEvent`/`ItemCompletedEvent` exist as a rollout item type.

**A control that rules out one theory:** `--dangerously-bypass-hook-trust`
prints `warning: \`--dangerously-bypass-hook-trust\` is enabled. Enabled
hooks may run without review for this invocation.` **unconditionally**
whenever the flag is passed — verified by pointing `hooks.json` at
`{"hooks": {}}` (zero entries) and getting the identical warning, twice.
So the warning's presence is **not** evidence any hook was recognized,
trusted, or enabled; it says nothing about `dasbo-capture` specifically.

**Root cause: undetermined, but well bounded.** Two live hypotheses, neither
confirmed nor ruled out within the task's 3-attempt budget:
- A fourth, untried `events` spelling is the real one (the binary's strings
  contain at least two plausible-but-different casings for the same
  concept, which is itself notable — Codex's own internal vocabulary is not
  self-consistent across its embedded string tables).
- The flat `hooks: {name: {command, events}}` map is a **legacy** shape
  (the binary also contains `hooks/src/legacy_notify.rs` and a `removed`,
  disabled `plugin_hooks` feature flag) that is still parsed for
  backward-compatible error messages but is no longer wired to actual
  execution in 0.145.0, having been superseded by a plugin/marketplace hook
  mechanism with its own `requirements.toml` manifest under an
  `enterprise-managed:` directory — a materially different mechanism, not
  a shape variant of what was tried.
- A persisted, per-config-hash hook-trust gate
  (`tui/src/startup_hooks_review.rs`, `HookTrustStatus: trusted/untrusted`)
  that `--dangerously-bypass-hook-trust` does not actually clear outside
  interactive TUI review is also possible — the flag's own help text scopes
  it to "for this invocation," and `codex doctor` has no hooks section at
  all to check trust state against.

No fourth attempt was made, per the task's explicit 3-alternative cap.

**Exact key names:** unknown — **ABSENT** for every field (no payload was
ever captured, so there is nothing to read key names off of).

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
| Claude Code | ready to implement | 17 | none |
| Codex 0.142.0 / 0.145.0 | **BLOCKED** | 0 | auth is fixed and no longer the issue; `hooks.json` wrapper shape (`{"hooks": {name: {command, events}}}`) parses cleanly (proven via a malformed-JSON control test), but no hook fired under any of 3 tried `events` spellings (lowercase-dot, PascalCase, camelCase) — zero hook-related trace log lines, zero `HookCompletedEvent` in session rollouts, zero fixtures. Root cause undetermined between: wrong spelling, a legacy/superseded config mechanism, or an unbypassable persisted hook-trust gate — see Codex section above |
| Antigravity 1.1.7 | ready to implement, with a caveat | 12 | none for capture, but the adapter must not rely on any in-payload event-name field — see "Critical dialect gap" above |
