# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing has been tagged yet. Everything below is on `main`.

### Changed

- Hooks are now installed as `gjs -m <path> …` rather than as a bare path to
  `hooks/dasbo-hook`. Nothing in the tree ever set that file's executable bit —
  it survived packaging by luck — and a dropped mode made every hook fail
  silently. If you installed hooks before this change, preferences shows them
  as out of date and **Update hooks** rewrites them.

### Added

- A top-bar island whose 2×2 grid reflects the busiest session: idle,
  thinking, waiting on a permission, errored, or finished.
- A popup listing every live session with its agent chip, project, elapsed
  time, and current activity.
- Inline permission approval, and a click-through that raises the terminal
  running a session.
- Hook install, update, and removal for Claude Code and Codex CLI, preserving
  other tools' entries and writing a `.dasbo.bak` backup before the first
  change.
- An Agents page listing OpenCode, Cursor CLI, and Antigravity CLI as *Coming
  soon*: shown with their controls insensitive, so the roadmap is visible
  without implying the hooks can be installed.
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

### Changed

- Every string the extension shows was reviewed against the DIS-9 copy audit.
  The store description now names the agents and scopes inline permission
  approval to Claude Code, which is the only agent that has it; a Codex row
  says its hooks are notifications only. The top-bar indicator is called the
  island everywhere, and one running session reads *thinking* on both the
  island and the row rather than *working* on one and *thinking* on the other.
  Failure messages say what happened, why, and what to do, with the underlying
  exception going to the journal instead of a toast. The popup's empty state
  points a user with no hooks at Settings, and a one-time notification does the
  same on first enable. Allow, Deny, Always allow, Jump and the row expander
  carry accessible names.
- The landing page declares a canonical URL, a sitemap, a `robots.txt`, a
  favicon, a 1200×630 share card and `SoftwareApplication` structured data,
  all resolving against `https://dasbo-dev.github.io/island-gnome/`.
- `docs/limitations.md` and `docs/agent-dialects.md` are published as pages of
  the site, rendered from the markdown at build time, and the agent table
  links its caveats to them instead of restating them.
- The landing page states what the extension does with session data, how to
  remove it, and that GNOME Shell 46 is a ceiling rather than a floor.

### Fixed

- The landing page no longer promises Codex the inline permission answering
  only Claude Code can do, and its install snippet runs `npm ci` before it
  builds — as published, it failed on its second line from a clean clone.
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

[Unreleased]: https://github.com/dasbo-dev/island-gnome/commits/main
