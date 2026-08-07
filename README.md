# Dasbo Island

Live AI coding-agent sessions in the GNOME top bar: status at a glance, inline
permission approval, and jump-back to the terminal running the session.

**[See the pill run live →](https://fsevenm.github.io/dasbo-island/)** — the
demo on that page is the extension's real `src/core` state machine, bundled
for the browser.

Source: [github.com/dasbo-dev/island-gnome](https://github.com/dasbo-dev/island-gnome)

Inspired by [open-vibe-island](https://github.com/Octane0411/open-vibe-island),
rebuilt natively for GNOME Shell.

## Requirements

GNOME Shell 46. X11 or Wayland.

## Install

```bash
make install
gnome-extensions enable dasbo-island@ayubaswad.gmail.com
```

On X11 press `Alt+F2`, type `r`, press Enter. On Wayland, log out and back in.

Then open the preferences and install hooks for each agent you use:

```bash
gnome-extensions prefs dasbo-island@ayubaswad.gmail.com
```

Whenever the pill is visible, the preferences window is one click away: click
the pill, then the gear in the popup's header. (The pill stays hidden while no
session is running unless you enable **Always show the pill**.)

The pill shows a 2×2 grid that reflects the busiest session: three blocks dim
with one slowly breathing at rest, a light travelling clockwise while an agent
works, all four blocks blinking together when a permission needs your answer,
a static diagonal pair on error, and a green stagger when a session finishes.

Each session row is led by a chip naming the agent doing the work, so a popup
holding a Claude Code session beside a Codex one says which is which at a
glance. **Agent chip** in the preferences chooses what it shows: the mark
alone, the mark and a short name, or the name alone. A row whose mark is
missing shows the name whatever that says. The marks are drawn for this
extension rather than taken from each vendor, and they do not recolour with a
light or dark theme.

Each agent row shows whether its hooks are installed. If the extension
directory moves, or a release adds a hook event the installed set is missing,
the row offers **Update** — every installed hook command embeds an absolute
path, and an install written before a new event existed is out of date.

When an agent keeps a task list, its row shows how far through it is — `3/10`
beside the clock — and the expander arrow opens the list itself, one line per
task: `✓` done, `▸` in progress, `○` still to do. Claude Code's list is read
from `~/.claude/tasks/<session-id>/`, so it appears without any extra hook.
`/clear` starts a fresh list, because it starts a fresh session id.

When an agent says it is waiting on you — Claude raises this after its prompt
has sat idle, and for any permission the island did not answer itself — the
message appears on that session's row and the popup opens to show it. Both
revert a few seconds later, and a popup you opened yourself is never closed
for you. The delay, and whether the popup opens at all, are in the
preferences; set the delay to zero to keep the message on the row until the
agent does something else, and to keep a popup it opened staying open until
you close it yourself.

Each of those moments also makes a sound: a permission request, an agent's
question, a notification, and a session finishing, each with its own cue. The
sounds come from your desktop's sound theme rather than from this extension, so
they match everything else on the system, and they stay silent when GNOME's own
event sounds are off. Unlike the popup, sound is not suppressed by a fullscreen
window — that is when the pill is least visible and the sound is most useful.
One switch in the preferences turns all four off. GNOME's Do Not Disturb
silences GNOME's own notification sounds, not these cues — the island is not a
notification service, and a blocked agent is waiting on you either way.

Whether GNOME's own `event-sounds` setting is honoured by mutter's sound player
has not been verified; this extension checks the key itself before playing, so
the setting is respected either way. Nor has anyone confirmed that any of the
four cues is actually audible on a live desktop — the test suite can pin the
decision logic and the wiring, but nothing in it can listen.

Panel box and position changes apply immediately,
with no reload; note that extensions replacing the top bar, such as Dash to
Panel, decide where each box ends up on screen.

## Supported agents

| Agent | Config touched | Status | Permission gating |
|---|---|---|---|
| Claude Code | `~/.claude/settings.json` | verified against 17 real hook-payload fixtures; SessionEnd and Notification are inferred — see docs/agent-dialects.md | yes |
| Antigravity CLI (`agy`) | `~/.gemini/config/hooks.json` | verified against 12 real hook-payload fixtures | unverified — see notes |
| Codex CLI | `~/.codex/hooks.json` | verified against 6 real hook-payload fixtures (0.146.0); needs a one-time trust approval — see below | no — see notes |

Hook installation preserves entries belonging to other tools and writes a
`.dasbo.bak` backup before its first change.

### A note on Codex CLI

**Installing the hooks is not enough on its own.** Codex will not run a hook it
has not been told to trust: it stores that decision per hook config, and the
review that grants it only happens in Codex's own interactive TUI. After
Install (or Update), start `codex` once and approve the hook review. Until you
do, the hooks sit in the file and never fire, and no Codex session reaches the
island.

Codex 0.146.0 speaks Claude's hook dialect — an event-keyed map under `hooks`,
PascalCase event names, `hook_event_name`/`session_id`/`cwd`/`tool_name`
payloads. Every dasbo release before this one wrote the older named-hook form
(`{"dasbo-island": {"command": …, "events": ["session.start", …]}}`), which
Codex parses without complaint and never fires; Update replaces it. Six events
are installed — `SessionStart`, `UserPromptSubmit`, `PreToolUse`,
`PostToolUse`, `Stop`, `SessionEnd` — all captured firing, fixtures in
`test/fixtures/codex/`.

Codex has **no permission gate through dasbo**: its `PreToolUse` hook rejects
an `allow` or `ask` decision outright, and approvals ride a separate
`PermissionRequest` event that dasbo does not wire, so every Codex hook is
installed notify-only. `codexAdapter.encodeDecision` is exercised by unit tests
and never reached from a real Codex session.

### A note on Antigravity CLI

Status reporting (session start, tool start/end, stop) is verified against 12
real captured hook-payload fixtures. The **permission decision path is
unverified**: no fixture exercises a real Antigravity permission round-trip,
and `docs/agent-dialects.md` documents payload shapes but never a response
schema, so `antigravityAdapter.encodeDecision`'s `{permissionDecision,
permissionDecisionReason}` shape is a guess. If `agy` ignores an unrecognised
stdout shape, clicking Deny reports the tool as denied while it executes
anyway — a security control failing open, silently. Treat the Antigravity
permission gate as best-effort and unverified until someone confirms it
against a real payload.

Two of the four sounds above can never play for Antigravity. Its adapter maps
no `session-end` and no `notification` event, so an `agy` session can never
reach the `done` state through an event and never carries a notice — the
`complete` and `message-new-instant` cues are structurally dead for this
agent, not merely unverified.

## Fail-open guarantee

The hook helper exits 0 with empty stdout on every error path. If this extension
is disabled, crashed, or never installed, your agents behave exactly as they
would without it.

## Development

```bash
npm install
npm test          # pure core logic, no GNOME needed
npm run typecheck
make install
tools/fake-agent.js perm   # drive the UI without a real agent
```

`src/core/` must never import `gi://` or `resource://`. A test enforces this.

`node build.mjs` also writes the landing page to `dist-site/`; preview it with
`python3 -m http.server -d dist-site 8080`. Pushes to master deploy it to
GitHub Pages via `.github/workflows/site.yml`.

## License

GPL-3.0-or-later.
