# Running the shexli static analyzer before submission

**Date:** 2026-08-28
**Issue:** DIS-26
**Analyzer:** shexli 0.2.1, the tool extensions.gnome.org points submitters at

## The problem

extensions.gnome.org asks submitters to run the shexli static analyzer over the
package before uploading, to catch packaging and review issues early. This repo
has never run it. The submission artefact — `make pack`'s
`dasbo-island@ayubaswad.gmail.com.shell-extension.zip` — has therefore never
been checked against the rules a reviewer applies.

Two things came out of running it. The extension has a handful of findings, most
of them cheap to clear. And the commands the site publishes do not work: shexli
0.2.1 segfaults on any input when installed fresh today, so anyone following the
instructions verbatim gets a crash and no report.

## What the analyzer actually reports

Run against a freshly packed archive, extracted with file modes preserved:

| Rule | Severity | What it points at | Disposition |
|---|---|---|---|
| `EGO-P-005` | error | `hooks/dasbo-hook` ships mode `755` with no file suffix | Fixed |
| `EGO-A-004` | warning | 16 ungated `console.*` calls in `extension.js` (threshold 5) | Fixed |
| `EGO-L-001` | warning | `new SessionWindows()` at module scope in `windowFinder.ts` | Fixed |
| `EGO-X-004` | warning | `GLib.file_get_contents()` in shell code | Accepted, documented |
| `EGO-L-003` | warning | 13 `connect()` calls with no matching `disconnect()` | Accepted, documented |

`EGO-P-006` (a shipped `schemas/gschemas.compiled`) fires only against a
development `dist/`. `make pack` already excludes that file and
`tools/verify-pack.mjs` already forbids it, so the packaged artefact is clean.
The analyzer must be pointed at the packed archive, not at `dist/`, or it
reports a file that never ships.

## Decisions taken

Settled with the owner before any of this was written:

| Question | Decision |
|---|---|
| How much to fix | Clear the error and the two cheap warnings; accept the other two with written reasoning |
| `EGO-X-004`, the synchronous `/proc` reads | Keep synchronous. Sharpen the comment rather than rewrite the Jump path |
| `EGO-P-005`, the executable hook | Strip the exec bit from the packaged copy. Do not rename the file |
| How the analyzer lives in the repo | `make analyze` plus `tools/shexli.sh` and a `CONTRIBUTING.md` section. No CI job |

Rejected alternatives worth recording:

- **Converting the `/proc` reads to `load_contents_async`.** It would silence
  `EGO-X-004`, but it makes `findWindowForPid` asynchronous and drags the Jump
  click path and its tests with it, to remove reads that are already documented
  as bounded and non-blocking. The warning is cheaper to explain than the
  rewrite is to carry.
- **Renaming `hooks/dasbo-hook` to `hooks/dasbo-hook.js`.** The rule exempts a
  `.js` suffix, so this would also clear `EGO-P-005`. It churns every reference
  in `src/`, `test/`, `tools/verify-pack.mjs`, the `Makefile` and
  `metadata.json`'s description, and leaves any existing install with hook
  entries pointing at a path that no longer exists. Dropping a mode bit costs
  one line.
- **A CI job running the analyzer on every pull request.** It would catch
  regressions automatically, but it pins the repo to a shexli version and pays
  a `pip install` per run for a tool that only matters at submission time. The
  two source-scanning tests below cover the regressions that actually recur.

## Scope

| File | Change |
|---|---|
| `src/core/log.ts` | New. The single `warn()` seam |
| 11 files under `src/` | 17 `console.warn` calls become `warn()` |
| `src/shell/windowFinder.ts` | Lazy `sessionWindows`; sharpened `readFile` comment |
| `build.mjs` | Chmod the packaged hook to `644` |
| `tools/verify-pack.mjs` | New `checkModes()`; assert the packaged hook is not executable |
| `tools/shexli.sh` | New. Venv, extract, run, gate |
| `Makefile` | New `analyze` target |
| `.gitignore` | Ignore `.shexli-venv/` |
| `CONTRIBUTING.md` | A "Before submitting to extensions.gnome.org" section |
| `CHANGELOG.md` | One line under `[Unreleased]` → `Changed` for the packaged hook's mode |
| `test/core/log.test.ts` | New. The helper's behaviour |
| `test/core/logging.test.ts` | New. `src/core/log.ts` is the only file naming `console` |
| `test/tools/verifyPack.test.ts` | Cases for `checkModes()` |

`metadata.json`, the schemas, the stylesheet and the site are untouched. No
runtime behaviour changes: the log lines keep their existing text and prefix
while gaining a single point of origin, and the mode change is invisible to a
hook that already runs through `gjs -m`.

## The code changes

### One logging seam — `EGO-A-004`

`src/core/log.ts` exports one function:

```ts
export function warn(message: string): void {
  console.warn(`dasbo-island: ${message}`)
}
```

The 17 existing call sites — 16 reachable from `extension.js`, one in
`prefs.ts` — drop their hand-written `dasbo-island: ` prefix and call it. Every
one of them is an error path; none is debug chatter, so nothing is being
silenced, only routed.

`src/core` must not import `gi://` or `resource://`
(`test/core/purity.test.ts`). `console` is a GJS and Node global, not an import,
so the new file belongs in `core` and stays testable under vitest.

`build.mjs` runs esbuild with `minify: false` for both the extension and the
prefs bundles, so the helper survives as a real function rather than being
inlined at each call site. `extension.js` ends up with one raw `console.*` call.
That count is honest rather than cosmetic: after this change there is exactly
one place in the extension that writes to the log.

### Lazy `sessionWindows` — `EGO-L-001`

`src/shell/windowFinder.ts` currently does its allocation at module scope:

```ts
const sessionWindows = new SessionWindows<Meta.Window>()
```

`SessionWindows` is a plain class from `src/core/windowPick.ts` — not a GObject,
and it touches nothing in the shell — so the rule is firing on the shape of the
line rather than on a real pre-`enable()` side effect. It is still worth
changing, because the rule is the one a reviewer's eye applies too.

It becomes a nullable module variable behind an accessor that creates on first
use. `forgetSessionWindows()` sets it back to `null` instead of calling
`.clear()`, which also releases the object at disable; `pruneSessionWindows()`
does nothing when nothing was ever created. `rememberSessionWindow()` and
`findWindowForPid()` go through the accessor.

### The packaged hook loses its exec bit — `EGO-P-005`

The rule flags any packaged file that is executable and whose suffix is neither
`.js` nor `.sh`. `hooks/dasbo-hook` is a readable GJS script with a `#!` line,
but it has no suffix and ships mode `755`, so it trips the heuristic and is
reported as a bundled binary.

This finding is invisible if the analyzer is pointed at the zip: Python's
`zipfile` drops the exec bit when it extracts. `unzip -Z` confirms the bit is in
the archive, and `unzip` restores it, so a reviewer working from an extracted
tree sees what shexli sees when the tree is extracted properly.

Nothing executes the packaged file by path. `src/core/install/plan.ts` writes
every hook command as `gjs -m <path> …`, and its comment says in as many words
that the executable bit is deliberately not load-bearing. So `build.mjs` chmods
`dist/hooks/dasbo-hook` to `644` after copying it. The repo copy keeps `755`,
which is what `test/hook/harness.mjs` spawns; the `Makefile`'s `install` target
still chmods `+x` at the destination for local installs.

### The accepted findings

**`EGO-X-004` — synchronous file IO.** `src/shell/windowFinder.ts` reads
`/proc/<pid>/stat`, `/proc/<pid>/cmdline` and `/proc/stat` through
`GLib.file_get_contents()`. Every path is under `/proc`, which is served from
kernel memory and cannot block on disk or on a network filesystem — the
condition the rule exists to prevent. The reads happen on an explicit Jump
click and on session start, one per ancestor, bounded at 20. The existing
comment says "deliberately synchronous"; it will be extended to name `/proc` as
the reason and to state the bound, so the next reader — reviewer or maintainer —
gets the argument without having to reconstruct it.

The warning will appear in every report. That is expected, and this document is
where it is recorded as accepted rather than missed.

**`EGO-L-003` — signals without disconnects.** All 13 sites connect to child
actors the widget itself constructs and destroys: `this._expander`, `this._jump`,
`this._permissionBox`, `this._questionBox`, `this._taskBox`, and buttons and
entries inside the prefs pages. A handler on an object that is destroyed dies
with it; GNOME Shell's own code connects this way. The rule has a suppression
for parent-owned descendants and simply fails to see the ownership through this
codebase's construction order. Adding handler-id bookkeeping for handlers that
already cannot leak would be noise, so it is not being added.

## The tooling

### `tools/shexli.sh`

One script, invoked by `make analyze`, which depends on `pack`. It takes the
path to a packed archive.

**Building the venv.** On first run it creates `.shexli-venv/`, installs
`shexli` with `-U` as the site instructs, and then pins `tree-sitter==0.25.2`.

The pin is the reason the script exists at all. shexli 0.2.1 declares
`tree-sitter>=0.25.0`, so a fresh install today resolves to 0.26.0, and every
run segfaults inside the analyzer's own AST walk:

```
Fatal Python error: Segmentation fault
  File ".../shexli/ast.py", line 34 in node_text
  File ".../shexli/ast.py", line 169 in imports_in_program
  File ".../shexli/analyzer/reachability.py", line 391 in reachable_js_contexts
```

The commands published on extensions.gnome.org therefore produce a crash and no
report. `tree-sitter==0.25.2` still satisfies shexli's own constraint. A comment
in the script records why the pin is there and says to drop it once shexli
supports 0.26.

**What it analyzes.** It extracts the archive into a temp directory with
`unzip`, which preserves file modes, and runs shexli against that directory.
Pointing shexli at the zip directly would work, but Python's `zipfile` drops the
exec bit on extraction and `EGO-P-005` — the only error-severity rule in play —
would silently never fire. Analyzing `dist/` instead would report
`EGO-P-006` for a `gschemas.compiled` that the archive does not contain. The
extracted archive is the only input that matches what ships.

The path passed to shexli must be absolute. A relative path makes it die with a
`ValueError` traceback out of `pathlib`, not a diagnostic.

**The gate.** shexli exits 0 whether or not it found errors, so it cannot gate a
build on its own. The script prints the human-readable text report, then re-runs
with `--format json` and exits 1 if any finding has severity `error`. Warnings
do not fail the run: `EGO-X-004` and `EGO-L-003` are carried knowingly, and a
gate that fails on them would be turned off within a week.

That is two runs of a roughly three-second analysis. Not worth optimising.

### `tools/verify-pack.mjs`

The file already exists to catch disagreements between the build script and the
artefact, and already refuses archives missing `hooks/dasbo-hook` or carrying
`schemas/gschemas.compiled`. It gains a `checkModes()` pure function that reads
`unzip -Z` long-format output and returns a violation when
`hooks/dasbo-hook` is executable. The CLI section calls it alongside
`checkEntries()` and `checkBundleText()`.

This is what stops the `EGO-P-005` fix from silently regressing: a `build.mjs`
edit that drops the chmod would otherwise ship an executable hook again and
nothing would say so until the next submission.

## Testing

| Test | What it holds |
|---|---|
| `test/core/log.test.ts` | `warn()` prefixes with `dasbo-island: ` and delegates to `console.warn` |
| `test/core/logging.test.ts` | `src/core/log.ts` is the only file under `src/` whose text contains `console.` |
| `test/tools/verifyPack.test.ts` | `checkModes()` accepts a `644` hook entry, rejects a `755` one, and ignores unrelated entries |

`test/core/logging.test.ts` is modelled on `test/core/purity.test.ts`: it walks
`src/`, reads each file, and asserts the offender list is empty. It is the
regression guard for `EGO-A-004` — the finding most likely to come back, because
every new error path is one `console.warn` away from re-crossing the threshold.

The existing suite covers the rest. `test/hook/hookStdin.test.ts` and
`test/hook/harness.mjs` run the repo's own `hooks/dasbo-hook`, whose mode is
unchanged. `test/core/purity.test.ts` covers the new `core` file.
`test/docs/links.test.ts` already walks `CONTRIBUTING.md` and resolves every
relative link and heading anchor in it, so the new section's pointer to this
document is checked without adding a test. `test/docs/communityFiles.test.ts`
requires `CONTRIBUTING.md` to keep naming `npm test`, `npm run typecheck`,
`gi://` and `docs/agent-dialects.md`; the new section is an addition, so those
stay. `windowFinder.ts` cannot be loaded by vitest at all, so what guards it is
`test/shell/jumpTarget.test.ts`, which asserts against its source text; one of
those assertions matches the exact call the lazy accessor changes and is
widened to accept the optional chain. The other five must keep passing
unmodified — they are what says the behaviour is identical.

`tools/shexli.sh` gets no test. It needs network access and a Python
toolchain, so it can only run on a developer machine, and a test that cannot run
in CI is a test that rots. `make analyze` is run by hand before a submission and
its failure mode is loud.

## Docs

`CONTRIBUTING.md` gains a "Before submitting to extensions.gnome.org" section:
run `make analyze`, what a clean run looks like, and the two warnings that are
expected in the output with a pointer to this document for why. Naming them
matters — a submitter who does not know they are accepted will either try to fix
them or assume the whole report is noise.

`CHANGELOG.md` gets one line under `[Unreleased]` → `Changed`, recording that
the packaged `hooks/dasbo-hook` now ships non-executable and that this changes
nothing for a hook entry written by preferences, which invokes it through
`gjs -m`. The logging and `sessionWindows` changes are invisible from outside
and get no entry.

## Done when

- `make analyze` on a fresh pack reports **0 errors and 2 warnings**:
  `EGO-X-004` and `EGO-L-003`, both listed above as accepted.
- `npm test` and `npm run typecheck` pass.
- `make pack` passes `tools/verify-pack.mjs`, including the new mode check.
- `unzip -Z` on the archive shows `hooks/dasbo-hook` without an exec bit.
