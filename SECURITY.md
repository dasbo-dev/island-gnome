# Security Policy

## Supported versions

No version has been tagged yet. Fixes land on `master`; if you are running the
extension, run what `make install` gives you from `master`.

## Reporting a vulnerability

Email <ayubaswad@gmail.com> rather than opening a public issue. Include what
you did, what happened, and which GNOME Shell version and session type you
were on. You will get an acknowledgement; if the report is valid, the fix and
its disclosure will be discussed with you before either lands.

## What this extension does to your system

It writes hook entries into your agents' own configuration files —
`~/.claude/settings.json`, `~/.codex/hooks.json`,
`~/.gemini/config/hooks.json`. Installation preserves entries belonging to
other tools and writes a `.dasbo.bak` backup before its first change to a
file. Every installed hook command embeds an absolute path to the helper
inside the extension directory.

Those hooks make the extension part of your agents' tool-permission path,
which is why the guarantee below exists.

## The fail-open guarantee

The hook helper exits 0 with empty stdout on every error path. If this
extension is disabled, crashed, or never installed, your agents behave exactly
as they would without it. Nothing the extension does can block or wedge an
agent.

The cost of that design is stated plainly rather than hidden: a permission
control that fails open fails **permissive**.

## Known open issue

Codex CLI has no permission gate through this extension at all; its hooks are
installed
[notify-only](docs/limitations.md#codex-has-no-permission-gate).
Claude Code's gate is the one this project treats as working; its
dialect is verified against 17 captured payloads, though no permission
round-trip has been captured for any agent.

No other agent's hooks can be installed from this build, so no other agent's
decision path is reachable.

---

Repository: <https://github.com/dasbo-dev/island-gnome>
