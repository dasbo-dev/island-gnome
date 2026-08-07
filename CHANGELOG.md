# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing has been tagged yet. Everything below is on `master`.

### Added

- A top-bar pill whose 2×2 grid reflects the busiest session: idle, working,
  waiting on a permission, errored, or finished.
- A popup listing every live session with its agent chip, project, elapsed
  time, and current activity.
- Inline permission approval, and a click-through that raises the terminal
  running a session.
- Hook install, update, and removal for Claude Code, Codex CLI, and
  Antigravity CLI, preserving other tools' entries and writing a `.dasbo.bak`
  backup before the first change.
- Task-list progress on each session row, with an expander showing the list
  itself. Claude Code's list is read from `~/.claude/tasks/<session-id>/`.
- Waiting-on-you messages surfaced on the row, with a configurable delay and
  an optional automatic popup.
- Four sound cues — permission, question, notification, session finished —
  played from the desktop's sound theme and honouring GNOME's `event-sounds`.
- An agent chip with three display modes: mark, mark and name, or name.
- A preferences About page with author, links, and support QR.
- A landing page in `site/`, deployed to GitHub Pages, running the real
  `src/core` state machine in the browser.
- Contribution, security, and code-of-conduct documentation, issue and
  pull-request templates, and a CI workflow.
- The project mark in the popup header and at the top of the preferences
  About page, in the variant matching the current light or dark theme.

### Fixed

- Every repository URL now points at `dasbo-dev/island-gnome`; three files
  named it and all three were stale at once.
- Codex hooks written in the older named-hook form parsed without complaint
  and never fired. **Update** replaces them.
- The About page's QR picture is pinned with a minimum size rather than a
  clamp, and its `UriLauncher` receiver is bound so it cannot be collected
  mid-launch.
- The preferences window opens tall enough to show the About page's support
  section without scrolling, and that page's banner is trimmed to earn back the
  room it needs.

[Unreleased]: https://github.com/dasbo-dev/island-gnome/commits/master
