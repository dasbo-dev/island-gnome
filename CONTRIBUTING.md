# Contributing to Dasbo Island

The most useful thing you can send this project is a captured hook payload.
The second most useful is a bug report with a shell log. This is a GNOME Shell
extension written in TypeScript and bundled with esbuild; everything that can
be tested without a running GNOME session is tested with Vitest.

It is a one-person project, so replies come when they come.

## What is most useful

**Captured hook payloads.** Several gaps in
[docs/limitations.md](docs/limitations.md) close the moment someone produces a
real payload — a Claude Code `SessionEnd` or `Notification` above all, and a
permission round-trip from any agent, which nobody has captured yet. A fixture
is worth more here than a patch.

**Bug reports with a shell log.** See the issue template; the log is usually
the whole story.

**Patches.** Small and focused, please.

## How to capture a payload

`tools/capture-hook` records one payload verbatim, then exits 0 with empty
stdout — it is safe to leave wired into a session you are actually working in.

```bash
/path/to/island-gnome/tools/capture-hook claude
```

Point the agent's hook command at it, in the same config file dasbo installs
into. Use the absolute path to `tools/capture-hook`: a hook runs with the
agent's session directory as its working directory, not this repository, so a
relative command either is not found or writes into whatever directory the
agent happened to be in.

Every event the hook fires lands in `test/fixtures/claude/` as `raw-N.json`,
where `N` is however many files are already in that directory when the hook
runs — not a count you can predict from outside it. Set `DASBO_FIXTURE_DIR` to
an absolute path to collect them somewhere else first.

Rename each file after the event it captured, matching what is already in
`test/fixtures/`: `PreToolUse-4.json` for Claude Code and Antigravity,
`PreToolUse.json` for Codex. Say in the pull request which agent and which
version produced them.

**Scrub before you open the pull request.** A payload carries `cwd`,
`session_id`, transcript paths and your prompt text. Replace anything you would
not post in public — paths, project names, prompts — and leave the structure
alone. The structure is the part an adapter is tested against; the contents are
yours.

## Setup

```bash
git clone https://github.com/dasbo-dev/island-gnome.git
cd island-gnome
npm install
```

Also run this once, in the same clone:

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

`.git-blame-ignore-revs` does nothing until a developer opts in with that
command — Git does not read it on its own. Without it, `git blame` attributes
every line of the whitespace-only reindent commit listed there to the
reindent itself, burying ~1300 lines of real history underneath a reformat.

No GNOME session is needed to run the tests. To try the extension itself you
need GNOME Shell 46 to 50:

```bash
make install
gnome-extensions enable dasbo-island@ayubaswad.gmail.com
```

Reload the shell after installing: `Alt`+`F2`, `r`, `Enter` on X11; log out and
back in on Wayland.

```bash
tools/fake-agent.js perm   # drive the UI without a real agent
```

## The gates

Three, and CI runs all of them on every pull request and on pushes to `main`:

```bash
npm test          # the core logic, no GNOME session needed
npm run typecheck
node build.mjs    # builds dist/ and the landing page in dist-site/
```

[The pull-request template](.github/PULL_REQUEST_TEMPLATE.md) lists what else
is worth checking before you open one.

## Before submitting to extensions.gnome.org

extensions.gnome.org asks submitters to run the Shexli static analyzer over
the package first. One target does it:

```bash
make analyze
```

That packs the archive, extracts it with file modes intact, runs the analyzer
over the result, and exits non-zero if anything is reported at error severity.

Two warnings are expected in a clean run. Neither is a bug:

- **`EGO-X-004`, synchronous file IO.** `src/shell/windowFinder.ts` reads
  `/proc` through `GLib.file_get_contents()`. `/proc` is served from kernel
  memory and cannot block on a disk or a network filesystem, the reads are
  bounded at 20, and they happen on an explicit Jump click or once at session
  start.
- **`EGO-L-003`, signals without disconnects.** Every site connects to a child
  actor the widget itself creates and destroys, so the handlers die with the
  object they are attached to.

[The design document](docs/superpowers/specs/2026-08-28-shexli-static-analysis-design.md)
records the finding-by-finding disposition, including the three that were
fixed.

`tools/shexli.sh` builds its own virtualenv in `.shexli-venv/` on first run,
and pins `tree-sitter==0.25.2` because the version pip resolves by default
segfaults inside shexli. Delete the directory to rebuild it.

## Rules worth knowing before you start

**`src/core/` must never import `gi://` or `resource://`.** That directory is
the part of the extension the test suite can reach; the moment it pulls in a
GJS binding, it stops being testable outside a live shell.
`test/core/purity.test.ts` enforces this and will fail your build.

**Assets are loaded by absolute path at runtime, and a missing one is
silent.** A chip with no mark just renders a bare name; a `Gtk.Picture` given
a missing file draws nothing and reports nothing. `test/shell/iconAssets.test.ts`
and `test/prefs/aboutAssets.test.ts` guard the `build.mjs` copy lines that
ship them. If you add an asset, add its guard.

**Documentation is tested too.** `test/repoUrls.test.ts` sweeps for stale
repository slugs, and `test/docs/` guards the README's structure, the logo
files, and the limitations page. A restructure that drops a warning fails the
suite.

**Log through `warn()` from `src/core/log.ts`, never `console` directly.**
`build.mjs` bundles all of `src/` into one `extension.js`, so every scattered
`console.warn` counts against the same file's total — which is exactly what
EGO's "no excessive logging" rule measures. One seam holds that count at one.
`test/core/logging.test.ts` enforces it and will fail your build.

## Adding an agent

Adapters live in `src/core/adapters/`. Each one translates its agent's hook
dialect into the extension's own events.
[docs/agent-dialects.md](docs/agent-dialects.md) documents the three that
exist; the fixtures behind them are in `test/fixtures/`.

An adapter written without captured fixtures is a guess, and this project
labels guesses as such — see
[Claude Code's SessionEnd and Notification are inferred](docs/limitations.md#claude-codes-sessionend-and-notification-are-inferred)
for what that looks like in practice.

## Commits and pull requests

Conventional commits, matching the existing log:

```
feat(prefs): add the About tab with author, links, and support QR
fix: point every repository URL at dasbo-dev/island-gnome
docs: state only the measured fact about the clamp
test(prefs): guard the detached-receiver and QR-sizing regressions
build: ship src/assets alongside the extension
```

Say what changed and why in the pull-request description, and note anything
you could not verify. Unverified is fine here. Unlabelled is not.

## License and conduct

Contributions are accepted under GPL-3.0-or-later, the same license as the
project.

Participation is covered by the [Code of Conduct](CODE_OF_CONDUCT.md).
