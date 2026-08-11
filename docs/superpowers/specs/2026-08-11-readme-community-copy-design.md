# README and community files: fix the copy the audit found

**Date:** 2026-08-11
**Issue:** DIS-12 ("Fix readme and community files copy"), findings from DIS-7
**Source audit:** `copy-audit-readme-community-2026-08-10.md`, attached to DIS-7
**Scope:** all 24 findings (R1–R11, K1–K13), plus one defect the audit could not
have seen. The owner chose the full scope over the two narrower ones.

## Why this work

The audit's own summary is the right frame: the prose is strong at the sentence
level, and the defects are factual drift and missing answers rather than weak
writing. Four clusters:

1. **Three stale cross-references survived the Antigravity withdrawal.**
   Commits `c533b1d` and `a39e3d8` reduced Antigravity to a bare `coming soon`
   and swept the README. `CONTRIBUTING.md` still names the Antigravity
   permission round-trip as the most valuable contribution and links a
   `docs/limitations.md` entry that no longer exists (K1); `SECURITY.md` still
   lists Antigravity's config path among the files the extension writes, then
   contradicts itself four paragraphs later (K2); the bug-report dropdown still
   offers Antigravity as a bug target (K5).
2. **The install block does not work from a clean clone** (R1). No `git clone`,
   no `npm install`, and `glib-compile-schemas` undeclared — while
   **Requirements** lists only what is needed to *run* the extension, not to
   build it, which is the only way to install it (R10).
3. **Two first-read questions are answered nowhere:** how do I remove this
   (R5), and does any of this leave my machine (R6). Both matter more here than
   for a typical extension, because this one writes into
   `~/.claude/settings.json` and sits in an agent's permission path.
4. **The top-priority contribution has no instructions** (K4). `CONTRIBUTING.md`
   asks for captured payloads and explains nothing, while `tools/capture-hook`
   sits in the repo unmentioned — and the ask invites strangers to paste `cwd`,
   session ids and prompt text into a public pull request with no word about
   redaction.

Underneath cluster 1 is one structural cause: **a decision was applied to one
file and not to its neighbours.** The same cause produced the new defect below.

## Decisions taken before design

Seven questions could not be answered from the repository. The owner answered
them:

1. **Scope:** all four audit batches.
2. **K8 and K10, response-time numbers:** omit both. No pull-request turnaround
   and no security acknowledgement window. Nothing promised that could be
   missed.
3. **K12, blank-issue destinations:** GitHub Discussions is enabled — verified
   live, `has_discussions: true` — so `config.yml` links it, alongside a
   limitations link.
4. **K1, the Antigravity ask:** align with the README's withdrawal. Do not
   restore the Antigravity limitation entry; `test/docs/limitations.test.ts`
   carries a comment explaining why those sections were removed.
5. **R11, the duplicated fail-open guarantee:** keep both copies and add a test
   pinning them together. No copy change, and the README does not take
   `SECURITY.md`'s permissive line.
6. **K7, contribution licensing:** a plain GPL-3.0-or-later line. No DCO, no
   CLA.
7. **R6, the privacy claim:** publish in both README and `SECURITY.md`. The
   claim was verified rather than assumed — see "Evidence for the privacy
   claim" below.

One further shape question, on commit structure: four commits, one per audit
batch, on one worktree branch, merged to `main` as a single merge commit. The
batch boundaries are where the coupling is — K3 spans three files, R4 spans the
README and its test.

## The defect the audit could not have seen

The audit was written on 2026-08-10. The repository was pushed to GitHub after
it. The remote's only branch is `main`; the copy names `master` in eight places
across seven files:

| File | Line | What it says |
|---|---|---|
| `SECURITY.md` | 5-6 | "Fixes land on `master`" |
| `CONTRIBUTING.md` | 45 | "on pushes to `master`" |
| `README.md` | 212 | "Pushes to `master` deploy it" |
| `CHANGELOG.md` | 11 | "Everything below is on `master`" |
| `CHANGELOG.md` | 80 | `[Unreleased]` link to `/commits/master` |
| `.github/ISSUE_TEMPLATE/config.yml` | 4 | `/blob/master/SECURITY.md` |
| `site/docPages.mjs` | 41 | `REPO_BLOB = …/blob/master/` |
| `site/index.html` | 168-169 | four footer links |

GitHub 302-redirects every one of those URLs to `main`, so nothing 404s today.
The prose still names a branch that does not exist. Filed here as **N1**; the
owner approved folding it into the correctness batch, site files included.

## Evidence for the privacy claim

R6 publishes "nothing leaves your machine", and a false privacy claim is worse
than none, so the claim was checked before it was written:

- `grep -rnE "Soup|fetch\(|XMLHttpRequest|https?://" src/ hooks/` returns no
  HTTP client. The only matches are the `xmlns` attribute on five SVG assets
  and three static URLs in `src/core/about.ts` — repo, issues,
  buy-me-a-coffee — opened with `Gtk.UriLauncher` when the user clicks them.
- `hooks/dasbo-hook` contains no `curl`, `wget`, or URL of any kind.

The published sentence claims exactly that and no more.

## Batch 1 — correctness

Commit: `fix(docs): repair the install block, the stale Antigravity references, and the branch name`

**R1 + R10 · `README.md`.** Requirements splits into two lists:

- **To run** — GNOME Shell 46; X11 or Wayland.
- **To build** — Node 22 (the version CI pins, `.github/workflows/ci.yml:25`);
  npm; `glib-compile-schemas`, from `libglib2.0-bin` on Debian and Ubuntu or
  `glib2-devel` on Fedora.

Install becomes self-contained:

```bash
git clone https://github.com/dasbo-dev/island-gnome.git
cd island-gnome
npm ci
make install
gnome-extensions enable dasbo-island@ayubaswad.gmail.com
```

R10 rides in this batch rather than in Batch 3, because the install block is
still wrong without it. No test asserts on the install commands.

**R1b · `Makefile:15`.** The echo currently prints "Log out and back in (X11)",
which inverts the README's mapping. Rewritten to match the README: X11 is
`Alt+F2`, `r`, `Enter`; Wayland is log out and back in. Plain ASCII, no em
dash, no curly quotes — this string prints to a terminal.

**K1 · `CONTRIBUTING.md`.** The Antigravity ask at lines 9-13 is replaced with
the fixture gaps the project still owns: a Claude Code `SessionEnd` or
`Notification` payload, and a permission round-trip for any agent. The example
at lines 81-83 is repointed at
`docs/limitations.md#claude-codes-sessionend-and-notification-are-inferred`,
which is a live instance of the labels-guesses-as-such behaviour that sentence
illustrates. The literal `docs/agent-dialects.md` stays —
`test/docs/communityFiles.test.ts:8` requires it.

**K2 · `SECURITY.md:17-22`.** `~/.gemini/config/hooks.json` is dropped from the
list of files the extension writes. It is not replaced with a future-tense
sentence: this build cannot write it, and the section is titled "What this
extension does to your system". The contradiction at lines 46-47 then resolves
without touching that paragraph.

**K5 · `.github/ISSUE_TEMPLATE/bug_report.yml`.** The agent dropdown becomes
Claude Code, Codex CLI, Not agent-specific. A line under it routes coming-soon
agents to the feature-request template. The literals `GNOME Shell`, `Wayland`
and `journalctl` stay — `communityFiles.test.ts:12` requires them.

**N1 · branch name.** `master` → `main` in all eight places tabled above, plus
the three test strings that assert on the site generator's output:
`test/site/docPages.test.ts` (three occurrences) and
`test/site/indexCopy.test.ts:158`. The test edits ride in this commit because
`site/docPages.mjs:41` cannot change without them.

## Batch 2 — honesty and the contributor path

Commit: `docs: answer the three questions the README does not`

**K3 · the uncaptured permission round-trip.** `SECURITY.md:42-44` is the only
place this is disclosed, which inverts the project's own policy —
`docs/limitations.md:3-6` says that page holds everything the project knows it
has not proven. Three edits:

1. A fifth entry in `docs/limitations.md` under **Permissions**: *No permission
   round-trip has been captured*. It states that `claudeAdapter`'s decision
   encoding is exercised by unit tests and has never been observed answering a
   live prompt.
2. A matching one-line bullet in the README's Status list with a `[Details]`
   link, in the shape of the four beside it.
3. `SECURITY.md` links that entry instead of carrying the fact alone.

`test/docs/limitations.test.ts` asserts on three claim strings and
`codexAdapter.encodeDecision`. Adding a section does not disturb them.

**K4 · `CONTRIBUTING.md`, how to capture a payload.** A new section under the
captured-payloads ask, built from what the script actually does
(`tools/capture-hook`):

- The invocation: `tools/capture-hook <agent-id>`, wired as the hook command.
- Where it writes: `test/fixtures/<agent>/raw-<n>.json`, `<n>` being the current
  file count, overridable with `DASBO_FIXTURE_DIR`.
- The naming convention used by the existing
  `test/fixtures/{claude,codex,antigravity}/` sets, and which events are still
  wanted (the two named in K1).
- One paragraph on scrubbing before opening the pull request: payloads carry
  `cwd`, `session_id`, transcript paths and prompt text
  (`docs/agent-dialects.md:337-346`).

**R5 · `README.md`, a new `## Uninstall` section after Install.** Hooks first,
then the extension:

- **Remove hooks** for each agent in the preferences. The label is verified
  against `src/prefs.ts:256`.
- Then `gnome-extensions disable …` and `make uninstall`.

One sentence states that removal restores the agent's config rather than
leaving dead entries, and `.dasbo.bak` is explained here — the backup only
reads as reassurance once the reader knows a removal path exists.
`test/docs/readme.test.ts` asserts a fixed set of `##` headings by
`toContain`, so adding one is safe.

**R6 · the privacy line.** One sentence in the README's **What it is**, and the
same claim in `SECURITY.md`: the extension makes no network requests; the only
URLs it knows are the three links on the About page, and those open in the
user's browser when clicked. Wording identical on both surfaces.

## Batch 3 — README structure

Commit: `docs(readme): break up How it works and say what the table means`

**R2 · "How it works".** 525 words, seven subjects, one heading. Split into
`###` subheadings on the existing paragraph boundaries — *The pill*, *Agent
chips*, *Hook status and Update*, *Task lists*, *Waiting on you*, *Sound cues*,
*Panel placement* — and added to the Contents list. The paragraphs already map
one-to-one, so no rewriting is needed. `readme.test.ts` guards the `## How it
works` heading itself; `###` children are unguarded.

**R3 · `README.md:135-138`.** The 52-word sentence hanging two behaviours off
one imperative splits into three sentences, one per fact.

**R4 · the agents table.** Column header **In this build** takes the values
`yes` and `coming soon`, which answer two different questions. Header becomes
**Availability**; values become `Shipped` and `Coming soon`.

⚠️ **This breaks the suite unless `test/docs/readme.test.ts` changes in the same
commit.** Two assertions:

- Line 63's row regex `/\| (yes|coming soon) \|/` becomes
  `/\| (Shipped|Coming soon) \|/`.
- The Antigravity row assertion `toContain('| coming soon |')` becomes
  `'| Coming soon |'`.

A third test matches `/coming soon.+ agent has a row/s` against the prose
sentence below the table. That sentence keeps its lowercase "coming soon" and
must not be capitalised.

**R7 · Contents.** Gains **What it is** (which precedes the list today and is
not in it) and **Uninstall** (added in Batch 2).

**R8 · `README.md:62-63`.** "Every agent in one place" promises five agents and
delivers two, in a file whose credibility rests on not doing that. Becomes
"Two agents, one pill."

**R9 · em dashes.** 22 in 1,510 words, seven of them in "How it works". Three
or four in that section convert to full stops or colons, chosen from sentences
already over 40 words — which overlaps R3. This is a rhythm fix, not a
search-and-replace; the goal is varied sentence length, not zero dashes.

## Batch 4 — community-file polish

Commit: `docs: finish the community files`

**K6 · `CONTRIBUTING.md:42-54`.** "Both must pass" introduces three gates,
across a comma splice and two `and`s. Rewritten to name three gates, list them
together (`npm test`, `npm run typecheck`, `node build.mjs`), state that CI runs
all three on every pull request and on pushes to `main`, and point at the pull
request template for the rest. The literals `npm test` and `npm run typecheck`
survive, as `communityFiles.test.ts:8` requires.

**K7 · the licensing line.** One sentence near the Code of Conduct section:
contributions are accepted under GPL-3.0-or-later, the same license as the
project. Spelled *license*, en-US, per the spelling decision recorded in
`docs/superpowers/specs/2026-08-10-extension-copy-design.md`.

**K8 · the opener.** "Thanks for looking." is replaced with the ask: the most
useful thing to send is a captured hook payload, the second most useful is a
bug report with a shell log. One honest line notes this is a one-person
project. **No turnaround figure**, per the owner's decision.

**K9 · `CODE_OF_CONDUCT.md`.** A two-sentence preamble above the Covenant text,
in the project's own voice, naming who actually receives a report — one person,
`ayubaswad@gmail.com`, the same address `SECURITY.md` routes to. No response
time is stated. The Covenant text is untouched, and the `Contributor Covenant`
literal that `communityFiles.test.ts:9` requires stays.

**K10 · `SECURITY.md:12-13`.** No change. The owner declined to name an
acknowledgement window.

**K11 · `feature_request.yml`.** Gains a `markdown` intro block, matching
`bug_report.yml:5-8`, pointing at `docs/limitations.md` and naming Codex
permission gating as the gap most likely to arrive as a feature request. The
literal `extension` survives.

**K12 · `config.yml`.** Two contact links added beside the security one: GitHub
Discussions, and the limitations page. `blank_issues_enabled: false` stays —
`communityFiles.test.ts:14` requires it, and the point of the links is to give
those readers a destination rather than to re-enable blank issues.

**K13 · `bug_report.yml:55-60`.** No version has ever been tagged
(`SECURITY.md:5`), so the `0.1.0` placeholder trains reporters to give an
answer that identifies nothing. The description leads with the commit —
`git rev-parse --short HEAD` — and the placeholder becomes `a39e3d8`. The field
stays optional.

**R11 · the drift test.** `test/docs/communityFiles.test.ts` gains a test
asserting that the fail-open sentences appear word-for-word in both `README.md`
and `SECURITY.md`, compared with whitespace normalised so a reflow does not
fail it. No copy changes; this is the whole of R11 under the owner's decision.

## Not doing

- **Restoring the Antigravity limitation entry** (K1's second option). It
  reverses `c533b1d`, and this build cannot install Antigravity hooks.
- **A pull-request turnaround or a security acknowledgement window** (K8, K10).
- **Moving the permissive-failure line to the README** (R11's second option).
- **Re-enabling blank issues** (K12). Links are added instead.
- **The `fsevenm.github.io` Pages URL.** The audit flagged it as deliberately
  exempt from the repo-URL sweep. It is now moot: the README already uses
  `dasbo-dev.github.io/island-gnome`. Nothing to fix.
- **`.github/PULL_REQUEST_TEMPLATE.md` and `CHANGELOG.md`'s content.** Both were
  verified clean by the audit. CHANGELOG is touched only for the branch name.

## Testing

Every batch ends with all three gates green before the next begins:

```bash
npm test
npm run typecheck
node build.mjs
```

Test files change in exactly three places, each because copy it asserts on
moved:

| Test | Change | Batch |
|---|---|---|
| `test/site/docPages.test.ts` | three `/blob/master/` strings → `/blob/main/` | 1 |
| `test/site/indexCopy.test.ts:158` | `/blob/master/LICENSE` → `/blob/main/LICENSE` | 1 |
| `test/docs/readme.test.ts` | row regex and the Antigravity assertion, for R4 | 3 |

One test is added: the R11 fail-open pairing, in
`test/docs/communityFiles.test.ts`, Batch 4.

## What this pass cannot verify

- **`make install` into a live GNOME session.** R1's block is checked as far as
  this environment allows: `npm ci` succeeds, `node build.mjs` succeeds, and
  `glib-compile-schemas` resolves. The end-to-end run from a fresh clone on a
  real GNOME 46 desktop is the owner's smoke test, and it is the check that
  matters most in this batch — R1 is exactly the copy that gets written from
  memory.
- **Whether the four sound cues are audible.** Unchanged by this work, and
  already recorded in `docs/limitations.md`.

## Delivery

Worktree at `.worktrees/dis-12-copy`, branch
`docs/dis-12-readme-community-copy`, four commits in batch order. Merged to
`main` as a single merge commit, matching `8121dde`'s shape for the DIS-9 work.
The worktree is removed and the branch deleted after the merge.
