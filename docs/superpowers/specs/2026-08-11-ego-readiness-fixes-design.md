# extensions.gnome.org readiness: fix the review findings

**Date:** 2026-08-11
**Issue:** DIS-15 ("Fix readiness review feedback"), findings from DIS-14
**Source review:** `ego-readiness-review-2026-08-11-rev2.md`, attached to DIS-14
**Scope:** B2, B3, H1, H2, M1, M2, M3. B1 deferred to its own issue; M6 already
landed; M4 and M5 need no action. The owner chose this split.

## Why this work

The review's verdict is that the code is in good shape and the problems sit
around it: in `metadata.json`, in the zip artefact, and in what the upload
description does not say. Three clusters:

1. **Two straight rule violations in `metadata.json`.** `session-modes:
   ["user"]` is forbidden verbatim by the guidelines when user mode is all you
   use (B2), and the `description` says nothing about the fact that the
   extension writes into three other applications' config files (H1).
2. **A silent-failure trap in the artefact.** The zip in the worktree was built
   2026-07-27 and contains neither `icons/` nor `assets/` (B3). Both are loaded
   by absolute path at runtime and both fail silently when missing, so
   uploading it would ship mark-less agent chips and a blank About QR with
   nothing reporting an error. `build.mjs` was correct the whole time — the
   artefact was still wrong.
3. **A dependency on a file mode nothing sets.** `hooks/dasbo-hook` is
   installed into agent configs as a bare command path, so it needs `+x`, and
   no `chmod` exists in `src/`, `hooks/` or `build.mjs` (H2). The bit survives
   only because `make pack` zips a file that already has it. If EGO's
   repackaging or the Shell's extraction drops the mode, every hook fails
   silently and the extension does nothing at all.

Underneath clusters 2 and 3 is one shared cause: **a correctness property that
holds today only by accident of the local filesystem, with no check that would
notice if it stopped holding.** Both fixes below replace an accident with
either a verification or a removed dependency.

## Decisions taken before design

Five questions could not be answered from the repository. The owner answered
them:

1. **B1, the GNOME version port:** out of scope here, handled as its own issue.
   This machine runs GNOME Shell 46.0, so 48/49/50 support could only be
   claimed compile-only — which is the exact thing B1 warns against. Everything
   else in scope is fully verifiable on this machine.
2. **H2, the executable bit:** write the command as `gjs -m <path> …` rather
   than chmod at install time. Removes the dependency instead of repairing it,
   and doubles as the fix for H2's presentation point — the command line now
   states that the hook is a GJS script.
3. **H1 and M1, the disclosure:** all six points go in `metadata.json`'s
   `description`, not in the README. The reviewer reads the EGO page, and the
   point of H1 is that they find the `$HOME` writes by grepping before anyone
   tells them.
4. **The `<=150` description test:** re-scope it to the first paragraph rather
   than delete it. Its stated intent is that the EGO list view must not cut a
   claim mid-sentence; that intent survives a longer full description
   untouched.
5. **B3, where verification lives:** a `tools/verify-pack.mjs` run by the
   `pack` target, reading the real archive. Not a `build.mjs` source-text
   assertion like the existing icon and asset guards, because B3's failure mode
   is precisely a correct source and a wrong artefact.

## What is not in scope, and why

| Finding | Disposition |
|---|---|
| B1 — `shell-version: ["46"]` | Deferred to its own issue. Needs a GNOME 48+ environment to do honestly. The README badge stays at 46 with it, so the two cannot disagree. |
| M6 — `master` links 404 | **Already fixed.** The DIS-7 merge `45e39e1` landed it. Verified: no `blob/master`, `tree/master` or `commits/master` survives in `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `.github/` or `site/`. The only remaining `master` is `branches: [master, main]` in the two CI workflow triggers, which is a branch-trigger list and not a link. |
| M4 — single bundled file | The review rates it acceptable: non-minified, and `metadata.json`'s `url` matches the real remote, which is what makes a generated bundle reviewable. No action. |
| M5 — no translations | Not required. Adding gettext would interact with the tests asserting gschema summaries equal prefs labels verbatim, which is its own piece of work. |

## Design

Four change groups, one commit each.

### 1. `metadata.json` — B2, H1, M1

**Delete** the `session-modes` line. The guideline is verbatim: *"This MUST be
dropped if you are only using `user` mode."* Nothing in the tree references
`unlock-dialog`.

**Rewrite** `description` as three paragraphs separated by blank lines:

- **¶1** is today's 143-character sentence, byte-identical. This is the only
  part the EGO list view shows, so it must stand alone as a complete and
  unqualified-nothing claim. Leaving it untouched is what guarantees that.
- **¶2** discloses, in plain prose: that preferences can write hook entries
  into `~/.claude/settings.json`, `~/.codex/hooks.json` and
  `~/.gemini/config/hooks.json`; that this happens only on an explicit button
  press; that a `.dasbo.bak` backup is written before the first change; that
  removal is a button too; and that the hook itself is a GJS script, not a
  binary.
- **¶3** is one line stating no affiliation with or endorsement by Anthropic,
  OpenAI or Google. This is M1's requirement, and it belongs next to the
  nominative uses of their product names rather than buried in the README.

The paragraph split is load-bearing, not cosmetic: it is what lets the list
view and the extension page carry different amounts of text from one field.

### 2. `src/core/install/plan.ts` — H2

`cmd()` changes from:

```
`${env.hookPath} ${agent} ${mode} ${event}`
```

to:

```
`gjs -m ${env.hookPath} ${agent} ${mode} ${event}`
```

Bare `gjs`, not `/usr/bin/gjs`, so it resolves on distributions that do not put
it there. `gjs` is present on any machine running GNOME Shell.

Verified empirically before adopting this, both claims on the machine in
question:

- `ARGV` is `["a","b","c"]` under `./hook a b c` and under `gjs -m ./hook a b c`
  alike, so `hooks/dasbo-hook`'s `ARGV[0..2]` reads need no change.
- The `#!/usr/bin/gjs -m` hashbang parses without error when `gjs -m` is
  explicit, so the shebang line stays. It costs nothing and keeps the file
  directly runnable, which `test/hook/harness.mjs` relies on.

**Migration needs no new code, and this is worth stating explicitly because it
looks like it should.** `isOurs()` matches on the `dasbo-hook` substring, which
is still present in the new command, so an entry written by an older install is
still recognised as ours — uninstall keeps working on it, and `withoutOurs()`
replaces rather than duplicates it. `installState` compares against
`expectedEventMapEntries`, which the old bare-path form no longer matches, so
the state becomes `stale`; `src/prefs.ts:273-275` already renders `stale` as an
enabled button labelled **Update hooks**. The upgrade path is therefore the
existing repair path, and the user is already told about it.

### 3. Packaging — B3, M2, M3

Three edits and one new file:

- **`build.mjs`** reads `DASBO_PACK`, set to `1` by the `pack` target, and
  builds the two extension bundles with `sourcemap: false` when it is set.
  This removes M3's dangling `//# sourceMappingURL=` comment, which currently
  points at `.map` files that `make pack` deliberately excludes. The default
  build keeps sourcemaps, because they are useful for local development and
  `make install` is not what ships.
- **`Makefile`'s `pack` target** additionally excludes
  `schemas/gschemas.compiled` from the archive (M2), by the same `-x`
  mechanism already used for `*.map`. It stays in `dist/`, so `make install`
  and local runs are unaffected — EGO compiles schemas itself and the
  requirement is the XML, which is present and correctly named.
- **`tools/verify-pack.mjs`**, new, run by `pack` after zipping. It reads the
  entry listing of the archive that was just written and asserts:
  - **required present:** at least one `icons/*.svg`, at least one entry under
    `assets/`, plus `metadata.json`, `extension.js`, `prefs.js`,
    `stylesheet.css`, the gschema XML and `hooks/dasbo-hook`;
  - **required absent:** any `*.map`, and `schemas/gschemas.compiled`.

  On failure it exits nonzero and names every rule that was violated, rather
  than the first. A guard against a silent failure is only as good as its
  message.
- The stale 2026-07-27 zip in the worktree is deleted. It is gitignored, so
  this affects only the local checkout, and `make pack` regenerates it.

The point of this group is that after it, `make pack` cannot succeed on an
archive that would ship broken. B3 stops being something to remember.

### 4. Housekeeping

Remove the untracked `ego-readiness-review-2026-08-11.md` left in the repo root
by an earlier run. It is rev1, superseded by the rev2 attached to DIS-14.

## Testing

Test-first for each group, following the repository's existing convention that
a guard test carries a comment naming the silent failure it exists to catch.

| Change | Test | Failure it catches |
|---|---|---|
| B2 | New in `test/core/metadata.test.ts`: `session-modes` is absent | The key is re-added and the submission violates a MUST |
| H1, M1 | New in `test/core/metadata.test.ts`: the description names all three config paths, says a backup is written, says the hook is a GJS script, states the button-press condition, and carries the non-affiliation line | The disclosure is trimmed away in a later copy edit and the reviewer finds the `$HOME` writes unannounced |
| H1 | Re-scoped in `test/core/metadata.test.ts`: `description.split('\n\n')[0].length <= 150` | The EGO list view cuts a claim mid-sentence — the original intent, preserved |
| H2 | Updated in `test/core/install/plan.test.ts`: expected commands carry the `gjs -m` prefix | — |
| H2 | New in `test/core/install/plan.test.ts`: a config holding an old bare-path entry reports `stale`, and `planInstall` against it yields exactly one entry per event, not two | The migration silently duplicates hooks, firing every event twice |
| B3, M2, M3 | New unit tests for `tools/verify-pack.mjs` against synthetic entry lists: a good listing passes; a listing missing `icons/` fails; one missing `assets/` fails; one containing a `.map` fails; one containing `gschemas.compiled` fails | The verifier passes an archive it should reject, which is worse than no verifier |

The existing 859 tests across 62 files must stay green, and
`npm run typecheck` must stay clean across all three tsconfigs. (The review
cites 852; it was written at `8121dde`, and the DIS-7 merge has since added
seven. 859 is the measured baseline on `main` at `45e39e1`.)

**Manual verification, not automatable here:** run `make pack` and read the
`unzip -l` listing directly. The whole lesson of B3 is that "the build script
is correct" and "the artefact is correct" are different claims, and the second
one is the one that ships.

## Rollout

Worktree on branch `dis-15-ego-readiness`, four commits in the order above,
merged to `main`, worktree removed and branch deleted.

**One real behaviour change goes in `CHANGELOG.md` under Unreleased:** the hook
command string changes, so an existing installation reads as stale until the
user opens preferences and presses **Update hooks**. At 0.1.0, unreleased, that
population is the author alone — but it is a behaviour change and it is
recorded as one rather than left for someone to rediscover.

## What this does not achieve

After this work the extension is still not uploadable, because B1 is still
open: `shell-version` remains `["46"]` and a reviewer on current GNOME cannot
install it. This spec closes every finding that can be closed and verified on a
GNOME 46 machine. The port is the remaining gate, and it needs a GNOME 48+
environment before anyone can honestly declare support for one.
