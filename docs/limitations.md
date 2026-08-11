# Known limitations

Everything on this page is something the project knows it has not proven. It
is kept separate from the [README](../README.md) so the front page stays
readable, not to keep it quiet — the warning that changes what a user should
actually do, the Codex trust step, is stated in the README as well.

For the payload shapes behind all of this, see
[agent-dialects.md](agent-dialects.md).

## Permissions

### Codex has no permission gate

Codex's `PreToolUse` hook rejects an `allow` or `ask` decision outright, and
approvals ride a separate `PermissionRequest` event that dasbo does not wire.
Every Codex hook is therefore installed notify-only. `codexAdapter.encodeDecision`
is exercised by unit tests and is never reached from a real Codex session.

### No permission round-trip has been captured

Claude Code's gate is the one this project treats as working, and
`claudeAdapter.encodeDecision` is exercised by unit tests. What no fixture
shows is a permission answered end to end: nothing in `test/fixtures/` records
a decision travelling back to an agent, for any agent. The encoding has never
been observed against a live prompt.

## Sound

### No cue has been confirmed audible

Whether GNOME's own `event-sounds` setting is honoured by mutter's sound
player has not been verified; this extension checks the key itself before
playing, so the setting is respected either way.

Nor has anyone confirmed that any of the four cues is actually audible on a
live desktop. The test suite can pin the decision logic and the wiring, but
nothing in it can listen.

## Coverage

### Claude Code's SessionEnd and Notification are inferred

Claude Code's dialect is verified against 17 real hook-payload fixtures, but
`SessionEnd` and `Notification` are not among them — their handling is
inferred from the documented shape rather than captured from a live session.

### Codex hooks written before 0.146.0 never fired

Codex 0.146.0 speaks Claude's hook dialect: an event-keyed map under `hooks`,
PascalCase event names, and `hook_event_name` / `session_id` / `cwd` /
`tool_name` payloads. Every dasbo release before the current one wrote the
older named-hook form — `{"dasbo-island": {"command": …, "events":
["session.start", …]}}` — which Codex parses without complaint and never
fires. **Update** in the preferences replaces it. Six events are installed:
`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`,
`SessionEnd`. All six were captured firing; the fixtures are in
`test/fixtures/codex/`.
