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

## Supported agents

| Agent | Config touched | Status | Permission gating |
|---|---|---|---|
| Claude Code | `~/.claude/settings.json` | verified against 17 real hook-payload fixtures | yes |
| Antigravity CLI (`agy`) | `~/.gemini/config/hooks.json` | verified against 12 real hook-payload fixtures | see notes |
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
