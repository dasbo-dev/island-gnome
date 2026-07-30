# Dasbo Island

Live AI coding-agent sessions in the GNOME top bar: status at a glance, inline
permission approval, and jump-back to the terminal running the session.

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

Each session row is led by a chip naming the agent doing the work — its mark
and a short name — so a popup holding a Claude Code session beside a Codex one
says which is which at a glance. The marks are drawn for this extension rather
than taken from each vendor, and they do not recolour with a light or dark
theme.

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

Panel box and position changes apply immediately,
with no reload; note that extensions replacing the top bar, such as Dash to
Panel, decide where each box ends up on screen.

## Supported agents

| Agent | Config touched | Status | Permission gating |
|---|---|---|---|
| Claude Code | `~/.claude/settings.json` | verified against 17 real hook-payload fixtures; SessionEnd and Notification are inferred — see docs/agent-dialects.md | yes |
| Antigravity CLI (`agy`) | `~/.gemini/config/hooks.json` | verified against 12 real hook-payload fixtures | unverified — see notes |
| Codex CLI | `~/.codex/hooks.json` | **unverified** — see below | see notes |

Hook installation preserves entries belonging to other tools and writes a
`.dasbo.bak` backup before its first change.

### A note on Codex CLI

Codex support has never been exercised against a real Codex session. Zero hook
payloads have ever been captured from it: on the installed build (0.145.0),
Codex's hooks parse but never fire — confirmed with trace logging that showed
zero hook lines emitted, no `HookCompletedEvent` in any session rollout, and a
malformed-JSON control test proving the hook parser itself is live and would
have reported a failure if one had occurred. The Codex adapter is written
against key names read out of a third-party hook script, not from anything
Codex itself has actually sent. Treat the Codex integration as best-effort and
unverified until someone confirms it against a real payload.

Separately, Codex has **no permission gate at all**: the installed hook is
notify-only, so `codexAdapter.encodeDecision` is never reached from a real
Codex session. Its permission-encoding logic is exercised only by unit tests,
not by anything Codex itself calls.

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

Whether GNOME's own `event-sounds` setting is honoured by mutter's sound player
has not been verified; this extension checks the key itself before playing, so
the setting is respected either way.

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

## License

GPL-3.0-or-later.
