<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="src/assets/logo-dark.svg">
  <img src="src/assets/logo-light.svg" alt="" width="120">
</picture>

# Dasbo Island

**Your AI coding agents, live on the GNOME top bar.**

[![CI](https://github.com/dasbo-dev/island-gnome/actions/workflows/ci.yml/badge.svg)](https://github.com/dasbo-dev/island-gnome/actions/workflows/ci.yml)
[![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg)](LICENSE)
[![GNOME Shell 46](https://img.shields.io/badge/GNOME%20Shell-46-4a86cf.svg)](https://release.gnome.org/46/)

[Live demo](https://dasbo-dev.github.io/island-gnome/) ·
[Agent dialects](docs/agent-dialects.md) ·
[Limitations](docs/limitations.md) ·
[Contributing](CONTRIBUTING.md) ·
[Changelog](CHANGELOG.md)

</div>

![A mockup of the Dasbo Island pill in the GNOME top bar, its popup listing three live agent sessions, and the terminal running one of them](docs/assets/hero.svg)

<sub>A mockup, not a screen capture — the extension drawn as it appears. <a href="https://dasbo-dev.github.io/island-gnome/">The live demo</a> runs the real state machine in your browser.</sub>

## What it is

Dasbo Island is a GNOME Shell extension that keeps every live AI coding-agent
session in the top bar: status at a glance, permission prompts answered
inline, and one click back to the terminal running the work.

Nothing leaves your machine. The extension makes no network requests; the only
URLs it knows are the three links on its About page, and those open in your
browser when you click them.

The demo linked above is not a video. It is the extension's own `src/core`
state machine, bundled for the browser.

Source: [github.com/dasbo-dev/island-gnome](https://github.com/dasbo-dev/island-gnome)

## Contents

- [What it is](#what-it-is)
- [Features](#features)
- [Requirements](#requirements)
- [Install](#install)
- [Uninstall](#uninstall)
- [How it works](#how-it-works)
  - [The pill](#the-pill)
  - [Agent chips](#agent-chips)
  - [Hook status and Update](#hook-status-and-update)
  - [Task lists](#task-lists)
  - [Waiting on you](#waiting-on-you)
  - [Sound cues](#sound-cues)
  - [Panel placement](#panel-placement)
- [Supported agents](#supported-agents)
- [Fail-open guarantee](#fail-open-guarantee)
- [Status and known limitations](#status-and-known-limitations)
- [Development](#development)
- [Contributing](#contributing)
- [Support](#support)
- [License](#license)
- [Credits](#credits)

## Features

- **Status at a glance.** A pill in the top bar reflects the busiest session —
  working, waiting on you, errored, or finished — without opening anything.
- **Answer permissions where you are.** A tool waiting for approval can be
  allowed or denied from the popup, without switching to the terminal.
- **One click back to the terminal.** Every session row knows the terminal
  running it and raises that window.
- **Two agents, one pill.** Claude Code and Codex CLI sessions share the
  pill, each row led by a chip naming the agent.
- **Task-list progress.** When an agent keeps a task list, its row shows how
  far through it is and expands to the list itself.
- **Cues you can hear.** A permission request, a question, a notification, and
  a finished session each get their own sound from your desktop's sound theme.

## Requirements

**To run**

- GNOME Shell 46
- X11 or Wayland

**To build.** No version has been tagged, so building from source is the only
way to install it.

- Node 22, the version CI runs
- npm
- `glib-compile-schemas`, from `libglib2.0-bin` on Debian and Ubuntu. On other
  distributions it ships with GLib itself.

## Install

```bash
git clone https://github.com/dasbo-dev/island-gnome.git
cd island-gnome
npm ci
make install
gnome-extensions enable dasbo-island@ayubaswad.gmail.com
```

Then reload the shell. On X11 press `Alt`+`F2`, type `r`, press `Enter`. On
Wayland, log out and back in.

Open the preferences and install the hooks for each agent you use:

```bash
gnome-extensions prefs dasbo-island@ayubaswad.gmail.com
```

Whenever the pill is visible, the preferences window is one click away: click
the pill, then the gear in the popup's header. The pill stays hidden while no
session is running unless you enable **Always show the island**.

> [!IMPORTANT]
> **Codex CLI needs one more step.** Installing the hooks is not enough on its
> own. Codex will not run a hook it has not been told to trust: it stores that
> decision per hook config, and the review that grants it happens only in
> Codex's own interactive TUI. After Install (or Update), start `codex` once
> and approve the hook review. Until you do, the hooks sit in the file and
> never fire, and no Codex session reaches the island.

Hook installation preserves entries belonging to other tools and writes a
`.dasbo.bak` backup before its first change.

## Uninstall

Remove the hooks first, while the extension is still there to do it. In the
preferences, each agent row has **Remove hooks**: dasbo takes out its own
entries and leaves every other tool's alone, so the agent goes back to
behaving as it did before. The `.dasbo.bak` written before the first change
stays where it is.

Then remove the extension itself:

```bash
gnome-extensions disable dasbo-island@ayubaswad.gmail.com
make uninstall
```

## How it works

### The pill

The pill shows a 2×2 grid that reflects the busiest session: three blocks dim
with one slowly breathing at rest, a light travelling clockwise while an agent
works, all four blocks blinking together when a permission needs your answer,
a static diagonal pair on error, and a green stagger when a session finishes.

### Agent chips

Each session row is led by a chip naming the agent doing the work, so a popup
holding a Claude Code session beside a Codex one says which is which at a
glance. **Agent chip** in the preferences chooses what it shows: the mark
alone, the mark and a short name, or the name alone. A row whose mark is
missing shows the name whatever that says. The marks are drawn for this
extension rather than taken from each vendor, and they do not recolour with a
light or dark theme.

### Hook status and Update

Each agent row shows whether its hooks are installed. If the extension
directory moves, or a release adds a hook event the installed set is missing,
the row offers **Update** — every installed hook command embeds an absolute
path, and an install written before a new event existed is out of date.

### Task lists

When an agent keeps a task list, its row shows how far through it is:
`3/10` beside the clock, and the expander arrow opens the list itself, one
line per task: `✓` done, `▸` in progress, `○` still to do. Claude Code's list
is read from `~/.claude/tasks/<session-id>/`, so it appears without any extra
hook. `/clear` starts a fresh list, because it starts a fresh session id.

### Waiting on you

When an agent says it is waiting on you — Claude raises this after its prompt
has sat idle, and for any permission the island did not answer itself — the
message appears on that session's row and the popup opens to show it. Both
revert a few seconds later, and a popup you opened yourself is never closed
for you. Both the delay and whether the popup opens at all are in the
preferences. Set the delay to zero and the message stays on the row until the
agent does something else. A popup opened that way then stays open until you
close it.

### Sound cues

Four moments each make a sound: a permission request, an agent's question, a
notification, and a session finishing, each with its own cue. The
sounds come from your desktop's sound theme rather than from this extension,
so they match everything else on the system, and they stay silent when GNOME's
own event sounds are off. Unlike the popup, sound is not suppressed by a
fullscreen window: that is when the pill is least visible and the sound is
most useful. One switch in the preferences turns all four off. GNOME's Do Not
Disturb silences GNOME's own notification sounds, not these cues. The island
is not a notification service, and a blocked agent is waiting on you either
way.

### Panel placement

Panel box and position changes apply immediately, with no reload. Extensions
that replace the top bar, such as Dash to Panel, decide where each box ends up
on screen.

## Supported agents

| Agent | Availability | Config touched | Status reporting | Permission gating |
|---|---|---|---|---|
| Claude Code | Shipped | `~/.claude/settings.json` | 17 real hook-payload fixtures | yes |
| Codex CLI | Shipped | `~/.codex/hooks.json` | 6 real fixtures (0.146.0) | no — [notify-only](docs/limitations.md#codex-has-no-permission-gate) |
| OpenCode | Coming soon | — | — | — |
| Cursor CLI | Coming soon | — | — | — |
| Antigravity CLI | Coming soon | — | — | — |

A **coming soon** agent has a row on the preferences Agents page with its
toggle and both buttons disabled: listed, not installable.

Payload shapes for the agents dasbo already speaks are documented in
[docs/agent-dialects.md](docs/agent-dialects.md).

## Fail-open guarantee

The hook helper exits 0 with empty stdout on every error path. If this
extension is disabled, crashed, or never installed, your agents behave exactly
as they would without it.

## Status and known limitations

This project says what it has not proven. The full account is in
[docs/limitations.md](docs/limitations.md); in short:

- **Codex sessions cannot be gated through dasbo.** Its hooks are installed
  notify-only.
  [Details](docs/limitations.md#codex-has-no-permission-gate)
- **No permission round-trip has been captured, for any agent.** The decision
  encoding is exercised by unit tests, never against a live prompt.
  [Details](docs/limitations.md#no-permission-round-trip-has-been-captured)
- **No cue has been confirmed audible on a live desktop.** The suite can pin
  the decision logic; nothing in it can listen.
  [Details](docs/limitations.md#no-cue-has-been-confirmed-audible)
- **Claude Code's `SessionEnd` and `Notification` handling is inferred**
  rather than captured.
  [Details](docs/limitations.md#claude-codes-sessionend-and-notification-are-inferred)
- **Codex hooks written by any earlier dasbo release never fired.** They used a
  form Codex parses without complaint and ignores. **Update** in the
  preferences replaces them — this is a format change, not a missing event, so
  the row offers Update even when nothing about your install has moved.
  [Details](docs/limitations.md#codex-hooks-written-before-01460-never-fired)

## Development

```bash
npm install
npm test          # pure core logic, no GNOME needed
npm run typecheck
make install
tools/fake-agent.js perm   # drive the UI without a real agent
```

`src/core/` must never import `gi://` or `resource://`.
`test/core/purity.test.ts` enforces this.

`node build.mjs` writes both the extension into `dist/` and the landing page
into `dist-site/`; preview the latter with
`python3 -m http.server -d dist-site 8080`. Pushes to `main` deploy it to
GitHub Pages via [`.github/workflows/site.yml`](.github/workflows/site.yml).

## Contributing

Bug reports, fixtures from real agent sessions, and pull requests are all
welcome — captured payloads especially, since several of the gaps on this page
close the moment someone produces one. Start with
[CONTRIBUTING.md](CONTRIBUTING.md); participation is covered by the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Support

Dasbo Island is free and GPL-licensed, and stays that way. If it saves you a
window switch or two, you can [buy me a coffee](https://buymeacoffee.com/fsevenm).
The extension's About tab carries the same link, with a QR code.

## License

[GPL-3.0-or-later](LICENSE).

## Credits

Inspired by [open-vibe-island](https://github.com/Octane0411/open-vibe-island),
rebuilt natively for GNOME Shell.

Built by [fsevenm](https://github.com/fsevenm).
