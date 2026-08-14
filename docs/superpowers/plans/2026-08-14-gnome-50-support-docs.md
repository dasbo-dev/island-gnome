# GNOME 47-50 Documentation Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the repository's account of GNOME support in line with DIS-19, which ran a six-case functional suite on GNOME Shell 47, 48, 49 and 50 and passed every case.

**Architecture:** Documentation only, three files. One paragraph of `CHANGELOG.md` is rewritten because it states something now false; one new dated document records what DIS-19 measured; one status block marks the 2026-08-12 port-results document as superseded in part. No source file, schema, test or `metadata.json` is touched, so the emitted `dist/` and `dist-site/` must be byte-identical afterwards.

**Tech Stack:** Markdown. Verification through the project's existing gates: vitest (`npm test`), `tsc` (`npm run typecheck`), and esbuild (`node build.mjs`).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-14-gnome-50-support-docs-design.md`. Read it before Task 1.
- **Declared range stays `["46","47","48","49","50"]`.** Do not edit `metadata.json`.
- **Do not touch** `README.md`, `site/index.html`, `CONTRIBUTING.md`, `docs/limitations.md`, `.github/`, or anything under `src/`, `test/`, `schemas/`. The user-facing copy states the supported range and no verification claim, and that is the owner's decision, not an oversight.
- **Never write a claim DIS-19 did not measure.** GNOME 46 was not part of DIS-19. Its evidence is the port's own nested run, recorded in `docs/superpowers/specs/2026-08-12-b1-port-results.md`. In user-facing files (the CHANGELOG), do not rank 46 against the others; in the new engineering record, state plainly that 46 was not in scope.
- **Line width:** wrap Markdown prose at roughly 76 characters, matching the surrounding files. Do not reflow paragraphs you are not changing.
- **Character set:** these files use real typographic characters — `—` (em dash), `→` (arrow), `·` (middle dot). Copy them verbatim from this plan.
- **Working directory:** the worktree `.worktrees/dis-21-docs` on branch `docs/dis-21-gnome-50-support`. `node_modules` there is a symlink to the main checkout's; leave it alone and never `git add` it.
- **Shell note:** this machine's shell profile prints `ERROR: GVM_ROOT not set` and returns a non-zero status after `cd`. Chain commands with `;` rather than `&&`, or the rest of the line silently will not run.
- **Baseline:** `npm test` reports `Test Files 66 passed (66)` / `Tests 937 passed (937)`. Every task must still report exactly that.

---

## File Structure

| File | Responsibility after this plan |
|---|---|
| `CHANGELOG.md` | Release notes. Its GNOME bullet says what the range rests on, in a form a user can read, with no per-version scoreboard |
| `docs/superpowers/specs/2026-08-14-dis19-gnome-47-50-results.md` | New. The dated record of the DIS-19 run: what passed, on what, with what evidence, and what is still unexercised |
| `docs/superpowers/specs/2026-08-12-b1-port-results.md` | Unchanged body. A status block at the top says its 48 and 49 rows are closed and where the current record lives |

Task order matters only for the third task: its status block links to the file Task 2 creates.

---

### Task 1: Correct the CHANGELOG's evidence claim

**Files:**
- Modify: `CHANGELOG.md:35-41`
- Test: none exists for this text. `test/docs/communityFiles.test.ts:11` requires the file to contain `Keep a Changelog` and `[Unreleased]`, and line 30 forbids a released-version heading; `test/docs/links.test.ts` resolves its relative links. The replacement text adds no link and removes neither marker, so all three keep passing.

**Interfaces:**
- Consumes: nothing.
- Produces: nothing later tasks read.

- [ ] **Step 1: Confirm the exact text you are replacing**

Run:

```bash
cd .worktrees/dis-21-docs; sed -n '33,41p' CHANGELOG.md
```

Expected, exactly:

```
### Changed

- Supported GNOME Shell versions widen from 46 alone to **46 through 50**.
  The typings target 50; 46, 47 and 50 are covered by runtime validation,
  since one dependency tree can hold only one `@girs` generation. 48 and 49
  rest on that same typing diff alone — no runtime validation has been done
  on either yet, and that work is tracked as DIS-19. Nothing a user can see
  changes on 46 — the port is type-level, and the popup animation is pinned
  to the value the old code already produced.
```

If it differs, stop and re-read the spec — someone has edited the file since the plan was written.

- [ ] **Step 2: Replace the bullet**

In `CHANGELOG.md`, replace exactly these six lines:

```
  The typings target 50; 46, 47 and 50 are covered by runtime validation,
  since one dependency tree can hold only one `@girs` generation. 48 and 49
  rest on that same typing diff alone — no runtime validation has been done
  on either yet, and that work is tracked as DIS-19. Nothing a user can see
  changes on 46 — the port is type-level, and the popup animation is pinned
  to the value the old code already produced.
```

with:

```
  The typings target 50, since one dependency tree can hold only one `@girs`
  generation, and the range is backed by runtime validation rather than by
  that typing target: every declared version loads and enables on a real
  Shell, and live 47, 48, 49 and 50 sessions were driven through the chip,
  the permission popup, disable and re-enable, and the preferences window.
  Nothing a user can see changes on 46 — the port is type-level, and the
  popup animation is pinned to the value the old code already produced.
```

The first line of the bullet (`- Supported GNOME Shell versions widen from 46 alone to **46 through 50**.`) does not change.

- [ ] **Step 3: Read the result back**

Run:

```bash
cd .worktrees/dis-21-docs; sed -n '35,42p' CHANGELOG.md
```

Expected: the new seven-line bullet, with no stray blank line before `- Hooks are now installed as`.

- [ ] **Step 4: Run the gates**

Run:

```bash
cd .worktrees/dis-21-docs; npm test 2>&1 | tail -5
```

Expected: `Test Files  66 passed (66)` and `Tests  937 passed (937)`.

- [ ] **Step 5: Commit**

```bash
cd .worktrees/dis-21-docs
git add CHANGELOG.md
git commit -m "docs(changelog): state what the 46-50 range now rests on

DIS-19 ran a six-case functional suite on 47, 48, 49 and 50 -- load and
enable, the D-Bus service, the session chip, the permission popup and its
timeout reply, disable and re-enable, and the preferences window -- and
every case passed on every one of them.

The bullet still told a reader that 48 and 49 had had no runtime
validation and that the work was tracked as DIS-19, in the future tense.
It now says what was actually driven, without ranking the declared
versions against each other.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Record the DIS-19 results

**Files:**
- Create: `docs/superpowers/specs/2026-08-14-dis19-gnome-47-50-results.md`
- Test: none. Nothing under `docs/superpowers/` is asserted on by the suite; `test/docs/links.test.ts` reads only `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md` and `docs/limitations.md`.

**Interfaces:**
- Consumes: nothing.
- Produces: the path `docs/superpowers/specs/2026-08-14-dis19-gnome-47-50-results.md`, which Task 3's status block links to. If you rename the file, Task 3's text must change with it.

- [ ] **Step 1: Create the file with exactly this content**

````markdown
# DIS-19 results: GNOME Shell 47 through 50, six cases, all passing

**Date:** 2026-08-14
**Issue:** DIS-19, the deferred half of DIS-15 / B1
**Predecessor:** `docs/superpowers/specs/2026-08-12-b1-port-results.md` — what
each declared version rested on when the port merged
**Design for the documentation update this produced:**
`docs/superpowers/specs/2026-08-14-gnome-50-support-docs-design.md`

The port merged with 48 and 49 declared on static evidence alone: a typings
diff showed they produce a byte-identical error set, and nobody had run
either. This document records the run that closed that gap, and it records
what the run still did not touch.

## What ran

Three sessions of work, all against the installed build in
`~/.local/share/gnome-shell/extensions/dasbo-island@ayubaswad.gmail.com`,
byte-identical to `dist/`. Extension version validation was left **on**
throughout, so every successful load is also direct evidence that the widened
`metadata.json` is what permits it.

| Case | 47.10 | 48.8 | 49.9 | 50.4 |
|---|---|---|---|---|
| TC-01 load and `enable()`, no `JS ERROR` | pass | pass | pass | pass |
| TC-02 owns `org.dasbo.Island`, `Ping` | pass | pass | pass | pass |
| TC-03 session chip visible in the panel | pass | pass | pass | pass |
| TC-04 permission popup renders, timeout reply | pass | pass | pass | pass |
| TC-05 disable and re-enable | pass | pass | pass | pass |
| TC-06 preferences window renders | pass | pass | pass | pass |

**No case failed on any Shell.** 47 and 48 ran nested; 49 and 50 ran under
`gnome-shell --devkit`, which is what `--nested`'s removal in 49 leaves.

47 and 48 passed all six on the first pass. 49 and 50 needed three: the first
proved their D-Bus behaviour but produced no pixels, the second closed 49's
visual half by dropping `--virtual-monitor`, and the third closed 50's after
the testing skill gained a `bwrap` shim and a screenshot helper that owns
`org.gnome.SettingsDaemon.MediaKeys`. Every retry was a change to the harness.
Nothing in `src/` was touched between them.

## Evidence, one decisive line per case

- **TC-01** — no `JS ERROR` and no `dasbo-island:` warning in any session log:
  `gnome47-session.log`, `gnome48-session.log`, `gnome49-session.log`,
  `gnome50-session.log`.
- **TC-02** — `('0.1.0',)` on all four.
- **TC-03** — the top bar reads `1 · thinking` with the Claude glyph:
  `47-tc03.png`, `48-tc03.png`, `49-tc03.png`, `50-tc03.png`.
- **TC-04** — the popup carries the row `Claude dasbo-island / waiting for you
  · Bash · ls -la` with `Allow / Deny / Always allow / Jump`, and the held call
  returns
  `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"Dasbo Island timed out waiting for an answer"}}`
  — the fall-through, so the agent is never left blocked.
- **TC-05** — `name owner after disable: (false,)` → `after re-enable:
  (true,)` on all four, with `*-tc05-off.png` showing no chip and
  `*-tc05-on.png` exactly one, reading `1 · idle`. On 47 and 48 the extension
  state also went `INACTIVE` → `ACTIVE`.
- **TC-06** — the preferences window rendered with its Appearance, Behavior,
  Agents and About pages on 47 and 48 (`47-tc06.png`, `48-tc06.png`); on 49 it
  rendered inside the session showing the Panel and Session rows
  (`49-tc06.png`); on 50 the same window came up in the adaptive narrow layout
  with the view switcher at the bottom (`50-tc06.png`).

Screenshots and logs live in the tester's `~/dasbo-qa-shots/`, outside this
repository. They are not checked in, and this document is the only record of
them here.

## What is still unexercised

Unchanged by this run, on every version:

- **The popup's buttons were never physically clicked.** Allow, Deny, Always
  allow and Jump are proven to render and nothing more — a headless run can
  inject no input, so the decision channel was exercised through the timeout
  fall-through instead.
- **No hook round trip with a live agent.** No `claude` or `codex` binary was
  installed in any of the containers.
- **No sound.** Nothing in the harness can listen.
- **No Codex session.** Claude only, by the tester's own resolved question.
- **GNOME 46 was not in scope here.** Its evidence remains the port's nested
  run on the host, recorded in
  `docs/superpowers/specs/2026-08-12-b1-port-results.md`.

## Environment findings worth keeping

None of these is an extension defect. All of them cost the run real time.

- **Icons render as blank rounded boxes in a distrobox devkit** until glycin's
  `bwrap` is shimmed. Without the shim the Claude mark and the popup's gear
  are empty boxes — and so are GNOME's own app-grid button and quick-settings
  pill, which is what identifies it as an environment gap rather than ours.
- **The GTK 4.20 preferences helper blocks on the portal on 50:** `Cannot get
  portal org.freedesktop.portal.Settings version: Timeout was reached`, with
  `OpenExtensionPrefs` answering `Error: Timeout was reached`.
  `GDK_DEBUG=no-portals` clears it.
- **`GDK_BACKEND=x11` must be scoped to `devkit-run.sh` alone.** Exported
  session-wide, it is inherited by the D-Bus-activated preferences helper,
  whose window then opens on the host display instead of inside the session,
  where no capture can see it.
- **The shell's screenshot API answers only privileged senders** — those
  owning `org.gnome.SettingsDaemon.MediaKeys` or the desktop portal name. A
  plain `gdbus` call gets `AccessDenied: Screenshot is not allowed`.
- **Writing `enabled-extensions` on a live session does nothing.** The running
  Shell rewrites the key from its own state. `disable-user-extensions` is the
  lever that works.
- **A dconf write may never reach a running devkit shell.** The permission
  countdown showed 36s and 46s against the 8s written to the devkit database,
  while read-back showed the written value — the running shell never got the
  change notification. It did not affect TC-04, whose expected result was the
  timeout fall-through either way.
- **`gnome50-dev` has no `/run/dbus/system_bus_socket`**; the host bus is
  mounted in, per the testing skill.
- **`--nested` is absent from 49 and 50 and present through 48.** Any tooling
  that branches on "46 has it, 50 does not" must treat 49 as the cut line.

## Verdict

47, 48, 49 and 50 are validated against all six acceptance criteria, UI
included. 46 is unchanged by this run and rests on what the 2026-08-12
document records. The declared `shell-version` range stands as it is, now on
measurement across four of its five versions rather than on a typing diff
across two of them.
````

- [ ] **Step 2: Check the file renders and its links resolve**

Run:

```bash
cd .worktrees/dis-21-docs; ls -l docs/superpowers/specs/2026-08-14-dis19-gnome-47-50-results.md; grep -c '^' docs/superpowers/specs/2026-08-14-dis19-gnome-47-50-results.md; ls docs/superpowers/specs/2026-08-12-b1-port-results.md docs/superpowers/specs/2026-08-14-gnome-50-support-docs-design.md
```

Expected: the file exists and is non-empty, and both referenced paths list without error.

- [ ] **Step 3: Run the gates**

Run:

```bash
cd .worktrees/dis-21-docs; npm test 2>&1 | tail -5
```

Expected: `Test Files  66 passed (66)` and `Tests  937 passed (937)`.

- [ ] **Step 4: Commit**

```bash
cd .worktrees/dis-21-docs
git add docs/superpowers/specs/2026-08-14-dis19-gnome-47-50-results.md
git commit -m "docs(spec): record the DIS-19 run on GNOME 47 through 50

Six cases on each of 47.10, 48.8, 49.9 and 50.4 -- load and enable, the
D-Bus service, the session chip, the permission popup and its timeout
fall-through, disable and re-enable, and the preferences window. Nothing
failed anywhere, and version validation was left on throughout, so each
load is also evidence that the widened metadata.json is what permits it.

The gaps are written down beside the passes: no button was ever clicked,
no live agent completed a hook round trip, no cue was heard, no Codex
session ran, and GNOME 46 was not in scope.

The environment findings are here because each one cost the run time and
none was an extension defect -- the bwrap shim that restores icons, the
portal timeout in the GTK 4.20 prefs helper, the GDK_BACKEND scoping that
keeps that helper inside the session, and 49 rather than 50 being where
--nested disappears.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Mark the port-results document superseded in part

**Files:**
- Modify: `docs/superpowers/specs/2026-08-12-b1-port-results.md:1-7`
- Test: none.

**Interfaces:**
- Consumes: the path created in Task 2. Do this task after Task 2, or the block will point at a file that does not exist.
- Produces: nothing.

- [ ] **Step 1: Confirm the header you are inserting into**

Run:

```bash
cd .worktrees/dis-21-docs; sed -n '1,8p' docs/superpowers/specs/2026-08-12-b1-port-results.md
```

Expected:

```
# B1 port results: what each declared GNOME version's support actually rests on

**Date:** 2026-08-12
**Issue:** DIS-15 / B1, from the DIS-14 extensions.gnome.org readiness review
**Design:** `docs/superpowers/specs/2026-08-12-b1-gnome50-port-design.md`
**Plan:** `docs/superpowers/plans/2026-08-12-b1-gnome50-port.md`

`metadata.json` now declares `shell-version: ["46","47","48","49","50"]`. This
```

- [ ] **Step 2: Insert the status block**

Replace this line:

```
**Plan:** `docs/superpowers/plans/2026-08-12-b1-gnome50-port.md`
```

with:

```
**Plan:** `docs/superpowers/plans/2026-08-12-b1-gnome50-port.md`
**Status:** superseded in part on 2026-08-14

> **Outcome:** The two deferred rows are closed. DIS-19 ran a six-case
> functional suite on 47, 48, 49 and 50 and every case passed on every one of
> them, so the 48 and 49 rows below are no longer current. That run is
> recorded in
> `docs/superpowers/specs/2026-08-14-dis19-gnome-47-50-results.md`; treat this
> document as what was known on 2026-08-12.
```

Change nothing else in the file. The table, the per-version prose, the
incident and the verdict all stay exactly as they are — this is a dated
record, and a dated record edited to match today stops being one. The same
treatment was given to the port design document in commit `94b9d16`.

- [ ] **Step 3: Verify only the header moved**

Run:

```bash
cd .worktrees/dis-21-docs; git diff --stat docs/superpowers/specs/2026-08-12-b1-port-results.md
```

Expected: `1 file changed, 8 insertions(+)` — insertions only, no deletions. The
eight are the `**Status:**` line, one blank line, and the six lines of the
blockquote.

- [ ] **Step 4: Run every gate**

Run:

```bash
cd .worktrees/dis-21-docs; npm test 2>&1 | tail -5; npm run typecheck 2>&1 | tail -3; node build.mjs 2>&1 | tail -3
```

Expected: `Test Files  66 passed (66)` / `Tests  937 passed (937)`; typecheck exits clean with no error lines; `build.mjs` completes and writes `dist/` and `dist-site/`.

- [ ] **Step 5: Confirm the build output did not change**

Run:

```bash
cd .worktrees/dis-21-docs; git status --porcelain
```

Expected: only the staged or unstaged Markdown files appear. `dist/` and `dist-site/` are gitignored, and no source changed, so nothing else may show up. If a source file appears, something in an earlier task went outside its scope — revert it.

- [ ] **Step 6: Commit**

```bash
cd .worktrees/dis-21-docs
git add docs/superpowers/specs/2026-08-12-b1-port-results.md
git commit -m "docs(spec): mark the port results superseded for 48 and 49

Its table reads 'none -- deferred' for both, and its verdict ends by
saying that is why DIS-19 exists. DIS-19 has since run and passed six
cases on each of them.

A status block says so and points at the newer record. The table and the
prose stay as they were: this is the dated account of 2026-08-12, and one
edited to match today would no longer be that.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Finishing

After Task 3, the branch holds four commits: the design spec, and one per
task. Merge to `main` with `--no-ff`, matching the repository's existing
`Merge:` commits, then remove the worktree and delete the branch:

```bash
cd /home/fsevenm/projects/dasbo-island
git merge --no-ff docs/dis-21-gnome-50-support -m "Merge: bring the documents up to date with GNOME 47-50 validation

DIS-19 passed six functional cases on each of 47, 48, 49 and 50. The
CHANGELOG said 48 and 49 had had no runtime validation, and the port
results table still read 'deferred' for both. Both now match what ran,
and the run itself has a record in the repository rather than only in
issue comments.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
rm -f .worktrees/dis-21-docs/node_modules
git worktree remove .worktrees/dis-21-docs
git branch -d docs/dis-21-gnome-50-support
```

Then run `npm test` once on `main` and confirm 937 passing.

No smoke test is needed: nothing a user runs changes. `dist/` and `dist-site/`
are byte-identical, so the installed extension and the deployed landing page
behave exactly as before.
