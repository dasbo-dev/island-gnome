# README and Community Files Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply all 24 findings from the DIS-7 copy audit, plus the stale `master` branch name the audit predates, to the README and the community-health files.

**Architecture:** Four commits on one worktree branch, one per audit batch — correctness, honesty and the contributor path, README structure, community-file polish. Every batch ends with all three gates green. Three existing test files change, each because copy they assert on moved; one test is added.

**Tech Stack:** Markdown, GitHub issue-template YAML, GNU Make, Vitest (`test/docs/`, `test/site/`), esbuild via `node build.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-11-readme-community-copy-design.md`

## Global Constraints

- **Spelling is en-US.** `license`, not `licence`; `behavior`, not `behaviour`. Decided in `docs/superpowers/specs/2026-08-10-extension-copy-design.md`.
- **Never invent a number.** No pull-request turnaround, no security acknowledgement window, no release date, no statistic the repository does not already support.
- **The default branch is `main`.** The remote has no `master`.
- **Terminal output stays plain ASCII.** No em dashes and no curly quotes in `Makefile` echo lines — they print to a terminal.
- **Prose uses curly apostrophes**, per commit `407e0b4`. Match the surrounding file.
- **These literals must survive** (`test/docs/communityFiles.test.ts`): `npm test`, `npm run typecheck`, `gi://`, `docs/agent-dialects.md` in `CONTRIBUTING.md`; `Contributor Covenant` and `ayubaswad@gmail.com` in `CODE_OF_CONDUCT.md`; `ayubaswad@gmail.com` and `docs/limitations.md` in `SECURITY.md`; `Keep a Changelog` and `[Unreleased]` in `CHANGELOG.md`; `GNOME Shell`, `Wayland`, `journalctl` in `bug_report.yml`; `extension` in `feature_request.yml`; `blank_issues_enabled: false` in `config.yml`.
- **The three gates**, run from the worktree root: `npm test`, `npm run typecheck`, `node build.mjs`.
- **`test/docs/links.test.ts` resolves every relative link and every heading anchor** in `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md` and `docs/limitations.md`. A link to a heading that does not exist fails the suite, so heading text and the anchors pointing at it move together.
- **`test/docs/support.test.ts` requires the literal `- [Support](#support)`** in the README's Contents list, and requires the support URL to appear exactly once in the file.
- **Antigravity, OpenCode and Cursor are coming soon.** No copy may present them as installable.

---

### Task 0: Create the worktree

**Files:**
- Create: `.worktrees/dis-12-copy/` (a git worktree, not tracked content)

- [ ] **Step 1: Create the worktree and branch**

```bash
cd /home/fsevenm/projects/dasbo-island
git worktree add -b docs/dis-12-readme-community-copy .worktrees/dis-12-copy main
```

- [ ] **Step 2: Install dependencies in the worktree**

```bash
cd /home/fsevenm/projects/dasbo-island/.worktrees/dis-12-copy
npm ci
```

Expected: exits 0. `node_modules/` is not shared between worktrees.

- [ ] **Step 3: Confirm the gates are green before any edit**

```bash
npm test && npm run typecheck && node build.mjs
```

Expected: all three exit 0. If anything fails here, stop — it is not this plan's doing.

**Every later task runs from `/home/fsevenm/projects/dasbo-island/.worktrees/dis-12-copy`.**

---

### Task 1: Batch 1 — correctness

**Files:**
- Modify: `README.md:69-79` (Requirements and Install), `README.md:212`
- Modify: `Makefile:15`
- Modify: `CONTRIBUTING.md:9-12`, `CONTRIBUTING.md:45`, `CONTRIBUTING.md:80-83`
- Modify: `SECURITY.md:5-6`, `SECURITY.md:17-19`
- Modify: `CHANGELOG.md:11`, `CHANGELOG.md:80`
- Modify: `.github/ISSUE_TEMPLATE/bug_report.yml:37-47`, `.github/ISSUE_TEMPLATE/config.yml:4`
- Modify: `site/docPages.mjs:41`, `site/index.html:168-169`
- Test: `test/site/docPages.test.ts` (3 occurrences), `test/site/indexCopy.test.ts:158`

**Interfaces:**
- Consumes: nothing.
- Produces: the branch name `main` everywhere; a Requirements section split into **To run** and **To build**, which Task 3's Contents list does not need to know about (the `## Requirements` heading is unchanged).

- [ ] **Step 1: Fix the branch name in the two site tests first, and watch them fail**

`test/site/docPages.test.ts` asserts on the generator's output, so the test changes and the generator changes together. Replace all three occurrences of `/blob/master/` with `/blob/main/`:

- the `const link` at line 56
- both URLs in the `sends links to unpublished files to GitHub` test (lines 65 and 68)

In `test/site/indexCopy.test.ts:158`:

```typescript
    expect(footer).toContain('/blob/main/LICENSE')
```

- [ ] **Step 2: Run the two site suites to verify they fail**

```bash
npx vitest run test/site/docPages.test.ts test/site/indexCopy.test.ts
```

Expected: FAIL. `docPages.test.ts` reports the received string still containing `blob/master`, and `indexCopy.test.ts` reports the footer not containing `/blob/main/LICENSE`.

- [ ] **Step 3: Point the site generator and the landing page at `main`**

`site/docPages.mjs:41`:

```javascript
const REPO_BLOB = 'https://github.com/dasbo-dev/island-gnome/blob/main/'
```

`site/index.html:168-169` — four links, all of the form `/blob/master/…`, become `/blob/main/…`: `CHANGELOG.md`, `SECURITY.md` on line 168 and `LICENSE` on line 169. (`/issues` and the bare repository link have no branch in them; leave them.)

- [ ] **Step 4: Run the two site suites to verify they pass**

```bash
npx vitest run test/site/docPages.test.ts test/site/indexCopy.test.ts
```

Expected: PASS.

- [ ] **Step 5: Fix the branch name in the prose**

No test asserts on these; they are wrong because the remote has no `master`.

`SECURITY.md:5-6`:

```markdown
No version has been tagged yet. Fixes land on `main`; if you are running the
extension, run what `make install` gives you from `main`.
```

`CONTRIBUTING.md:45`: `on pushes to `master`:` → `on pushes to `main`:`

`README.md:212`: `Pushes to `master` deploy it to` → `Pushes to `main` deploy it to`

`CHANGELOG.md:11`:

```markdown
Nothing has been tagged yet. Everything below is on `main`.
```

`CHANGELOG.md:80`:

```markdown
[Unreleased]: https://github.com/dasbo-dev/island-gnome/commits/main
```

`.github/ISSUE_TEMPLATE/config.yml:4`:

```yaml
    url: https://github.com/dasbo-dev/island-gnome/blob/main/SECURITY.md
```

- [ ] **Step 6: Split Requirements and make Install self-contained (R1, R10)**

Replace `README.md:69-79` — everything from `## Requirements` through the closing fence of the Install code block — with:

````markdown
## Requirements

**To run**

- GNOME Shell 46
- X11 or Wayland

**To build.** No version has been tagged, so building from source is the only
way to install it.

- Node 22, the version CI runs
- npm
- `glib-compile-schemas`, from `libglib2.0-bin` on Debian and Ubuntu, or
  `glib2-devel` on Fedora

## Install

```bash
git clone https://github.com/dasbo-dev/island-gnome.git
cd island-gnome
npm ci
make install
gnome-extensions enable dasbo-island@ayubaswad.gmail.com
```
````

Leave the reload paragraph and everything after it alone.

- [ ] **Step 7: Make the Makefile agree with the README (R1b)**

`Makefile:15` currently reads:

```make
	@echo "Installed. Log out and back in (X11), then: gnome-extensions enable $(UUID)"
```

Replace it with two lines. Plain ASCII, no em dash, no curly quotes:

```make
	@echo "Installed. Reload the shell: on X11 press Alt+F2, type r, press Enter; on Wayland, log out and back in."
	@echo "Then run: gnome-extensions enable $(UUID)"
```

Both lines are inside the `install:` recipe and must keep their leading tab.

- [ ] **Step 8: Sweep the Antigravity references out of CONTRIBUTING (K1)**

`CONTRIBUTING.md:9-12` becomes:

```markdown
**Captured hook payloads.** Several gaps in
[docs/limitations.md](docs/limitations.md) close the moment someone produces a
real payload — a Claude Code `SessionEnd` or `Notification` above all, and a
permission round-trip from any agent, which nobody has captured yet. A fixture
is worth more here than a patch.
```

`CONTRIBUTING.md:80-83` becomes:

```markdown
An adapter written without captured fixtures is a guess, and this project
labels guesses as such — see
[Claude Code's SessionEnd and Notification are inferred](docs/limitations.md#claude-codes-sessionend-and-notification-are-inferred)
for what that looks like in practice.
```

The `docs/agent-dialects.md` link three lines above it stays; a test requires that literal.

- [ ] **Step 9: Drop the config file this build cannot write (K2)**

`SECURITY.md:17-19` — the sentence currently names three paths. It becomes:

```markdown
It writes hook entries into your agents' own configuration files —
`~/.claude/settings.json` and `~/.codex/hooks.json`. Installation preserves
```

Do not add a future-tense sentence about `~/.gemini/config/hooks.json`. The section is titled "What this extension does to your system", and this build does not write it. The rest of the paragraph, from `entries belonging to`, is unchanged.

- [ ] **Step 10: Fix the bug-report agent dropdown (K5)**

`.github/ISSUE_TEMPLATE/bug_report.yml:37-47` becomes:

```yaml
  - type: dropdown
    id: agent
    attributes:
      label: Which agent
      description: >-
        Only the agents this build can install are listed. For OpenCode,
        Cursor CLI or Antigravity CLI, please open a feature request instead.
      options:
        - Claude Code
        - Codex CLI
        - Not agent-specific
    validations:
      required: true
```

- [ ] **Step 11: Run all three gates**

```bash
npm test && npm run typecheck && node build.mjs
```

Expected: all three exit 0, `npm test` reporting every suite passed.

- [ ] **Step 12: Verify no `master` survives outside history**

```bash
grep -rn "blob/master\|commits/master\|\`master\`" README.md CONTRIBUTING.md SECURITY.md CHANGELOG.md CODE_OF_CONDUCT.md .github/ site/ test/ docs/superpowers/specs/2026-08-11-readme-community-copy-design.md
```

Expected: the only hits are inside `docs/superpowers/specs/2026-08-11-readme-community-copy-design.md`, which documents the defect. No hit in any shipped file.

- [ ] **Step 13: Commit**

```bash
git add README.md Makefile CONTRIBUTING.md SECURITY.md CHANGELOG.md .github site test
git commit -m "fix(docs): repair the install block, the stale Antigravity references, and the branch name

The install block never worked from a clean clone: no clone step, no npm
install, and glib-compile-schemas undeclared. Requirements now says what is
needed to run the extension and what is needed to build it, which is the
only way to install it.

make install printed the opposite reload instruction to the README's. The
README was right.

Three files kept the Antigravity references the withdrawal in c533b1d swept
out of the README: a contributing ask pointing at a limitations entry that
does not exist, a security document listing a config path this build cannot
write, and a bug-report dropdown offering an agent nobody can install.

The repository was pushed after the audit was written, and the remote has no
master branch.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Batch 2 — honesty and the contributor path

**Files:**
- Modify: `docs/limitations.md` (new section under `## Permissions`)
- Modify: `README.md` (Status list, `## What it is`, new `## Uninstall`)
- Modify: `SECURITY.md` (Known open issue, What this extension does)
- Modify: `CONTRIBUTING.md` (new `## How to capture a payload`)

**Interfaces:**
- Consumes: Task 1's `main` branch name; nothing else.
- Produces: the anchor `docs/limitations.md#no-permission-round-trip-has-been-captured`, linked from both `README.md` and `SECURITY.md`. The heading text must stay exactly **No permission round-trip has been captured** or both links break. Also produces the `## Uninstall` heading that Task 3 adds to the Contents list.

- [ ] **Step 1: Add the fifth limitation (K3)**

In `docs/limitations.md`, under `## Permissions`, after the `### Codex has no permission gate` section and before `## Sound`:

```markdown
### No permission round-trip has been captured

Claude Code's gate is the one this project treats as working, and
`claudeAdapter.encodeDecision` is exercised by unit tests. What no fixture
shows is a permission answered end to end: nothing in `test/fixtures/` records
a decision travelling back to an agent, for any agent. The encoding has never
been observed against a live prompt.
```

- [ ] **Step 2: Add the matching README bullet (K3)**

In `README.md`, in the `## Status and known limitations` list, after the Codex notify-only bullet:

```markdown
- **No permission round-trip has been captured, for any agent.** The decision
  encoding is exercised by unit tests, never against a live prompt.
  [Details](docs/limitations.md#no-permission-round-trip-has-been-captured)
```

- [ ] **Step 3: Let SECURITY.md link the fact instead of carrying it alone (K3)**

`SECURITY.md`, the `## Known open issue` section, last sentence of the first paragraph:

```markdown
Claude Code's gate is the one this project treats as working; its
dialect is verified against 17 captured payloads, though
[no permission round-trip has been captured for any agent](docs/limitations.md#no-permission-round-trip-has-been-captured).
```

Leave the `notify-only` link and the second paragraph unchanged.

- [ ] **Step 4: Verify both anchors resolve**

```bash
node build.mjs && grep -c 'id="no-permission-round-trip-has-been-captured"' dist-site/limitations.html
```

Expected: `1`. The site generator slugifies headings the same way GitHub does, so this is the check that the two `[Details]` links land somewhere.

- [ ] **Step 5: Tell contributors how to capture a payload (K4)**

In `CONTRIBUTING.md`, add a new section immediately after `## What is most useful` and its three bullets, before `## Setup`:

````markdown
## How to capture a payload

`tools/capture-hook` records one payload verbatim, then exits 0 with empty
stdout — it is safe to leave wired into a session you are actually working in.

```bash
tools/capture-hook claude
```

Point the agent's hook command at it, in the same config file dasbo installs
into, and every event it fires lands in `test/fixtures/claude/` as
`raw-0.json`, `raw-1.json`, and so on, numbered from what is already there. Set
`DASBO_FIXTURE_DIR` to collect them somewhere else first.

Rename each file after the event it captured, matching what is already in
`test/fixtures/`: `PreToolUse-4.json` for Claude Code and Antigravity,
`PreToolUse.json` for Codex. Say in the pull request which agent and which
version produced them.

**Scrub before you open the pull request.** A payload carries `cwd`,
`session_id`, transcript paths and your prompt text. Replace anything you would
not post in public — paths, project names, prompts — and leave the structure
alone. The structure is the part an adapter is tested against; the contents are
yours.
````

- [ ] **Step 6: Add the Uninstall section (R5)**

In `README.md`, after the Install section — that is, after the `.dasbo.bak` paragraph and before `## How it works`:

````markdown
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
````

**Remove hooks** is the button's real label, at `src/prefs.ts:256`. Do not
paraphrase it.

- [ ] **Step 7: Answer the privacy question (R6)**

In `README.md`, in `## What it is`, after the paragraph ending "one click back to the terminal running the work.":

```markdown
Nothing leaves your machine. The extension makes no network requests; the only
URLs it knows are the three links on its About page, and those open in your
browser when you click them.
```

In `SECURITY.md`, in `## What this extension does to your system`, as its own paragraph after the one ending "which is why the guarantee below exists.":

```markdown
Nothing leaves your machine. The extension makes no network requests; the only
URLs it knows are the three links on its About page, and those open in your
browser when you click them.
```

Identical wording in both places, on purpose.

- [ ] **Step 8: Re-verify the claim you just published**

```bash
grep -rnE "Soup|fetch\(|XMLHttpRequest|curl|wget" src/ hooks/
```

Expected: no output. If anything matches, **stop and remove the privacy sentence** — a false privacy claim is worse than none.

- [ ] **Step 9: Run all three gates**

```bash
npm test && npm run typecheck && node build.mjs
```

Expected: all three exit 0.

- [ ] **Step 10: Commit**

```bash
git add README.md SECURITY.md CONTRIBUTING.md docs/limitations.md
git commit -m "docs: answer the three questions these files left open

The uncaptured permission round-trip was disclosed only in SECURITY.md,
which inverts this project's own policy: limitations.md is where everything
unproven is meant to live, and the README is what people actually read. It
is now in all three, stated once and linked twice.

CONTRIBUTING asked for captured payloads and explained nothing, while
tools/capture-hook sat in the repository unmentioned — and the ask invited
strangers to paste cwd, session ids and prompt text into a public pull
request with no word about redaction.

Uninstall was documented nowhere, though make uninstall and the Remove hooks
button both exist. For an extension that writes into an agent's config, how
to get out of it is a first-read question.

The privacy claim is verified, not assumed: no HTTP client is imported in
src/ or hooks/, and the only URLs in the source are the three static links
on the About page.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Batch 3 — README structure

**Files:**
- Modify: `README.md` — Contents, Features, How it works, Supported agents
- Test: `test/docs/readme.test.ts:63` and the Antigravity assertion

**Interfaces:**
- Consumes: the `## Uninstall` heading added in Task 2.
- Produces: seven `###` headings under `## How it works`, and a Contents list that matches every `##` in the file.

- [ ] **Step 1: Update the two table assertions first, and watch them fail (R4)**

In `test/docs/readme.test.ts`, in `marks every agent in the table as shipped or coming soon`:

```typescript
      expect(row, `no availability marker in: ${row}`).toMatch(/\| (Shipped|Coming soon) \|/)
```

In `does not offer Antigravity as an agent you can install today`:

```typescript
    expect(row, 'Antigravity must be marked coming soon').toContain('| Coming soon |')
```

Do **not** touch the third test, `says which agents are planned` — it matches `/coming soon.+ agent has a row/s` against the prose sentence below the table, which keeps its lowercase wording.

- [ ] **Step 2: Run the README suite to verify it fails**

```bash
npx vitest run test/docs/readme.test.ts
```

Expected: FAIL, two tests — the row regex finding `| yes |`, and the Antigravity row not containing `| Coming soon |`.

- [ ] **Step 3: Rename the column and its values (R4)**

Replace the table at `README.md:157-163`:

```markdown
| Agent | Availability | Config touched | Status reporting | Permission gating |
|---|---|---|---|---|
| Claude Code | Shipped | `~/.claude/settings.json` | 17 real hook-payload fixtures | yes |
| Codex CLI | Shipped | `~/.codex/hooks.json` | 6 real fixtures (0.146.0) | no — [notify-only](docs/limitations.md#codex-has-no-permission-gate) |
| OpenCode | Coming soon | — | — | — |
| Cursor CLI | Coming soon | — | — | — |
| Antigravity CLI | Coming soon | — | — | — |
```

The sentence below it keeps its lowercase **coming soon**; a test matches that literal.

- [ ] **Step 4: Run the README suite to verify it passes**

```bash
npx vitest run test/docs/readme.test.ts
```

Expected: PASS, all tests.

- [ ] **Step 5: Break up "How it works" (R2)**

`README.md:105-153` is five paragraphs covering seven subjects under one heading. Add a `###` heading above each, without rewriting the paragraphs — they already map one-to-one, except the second paragraph, which carries both the pill's chips and the preferences setting for them, and the fifth, which carries sound and panel placement:

| Heading | The paragraph it introduces |
|---|---|
| `### The pill` | "The pill shows a 2×2 grid…" |
| `### Agent chips` | "Each session row is led by a chip…" |
| `### Hook status and Update` | "Each agent row shows whether its hooks are installed…" |
| `### Task lists` | "When an agent keeps a task list…" |
| `### Waiting on you` | "When an agent says it is waiting on you…" |
| `### Sound cues` | "Each of those moments also makes a sound…" |
| `### Panel placement` | "Panel box and position changes apply immediately…" |

Leave `## How it works` itself in place — a test asserts on it.

- [ ] **Step 6: Split the 52-word sentence (R3)**

In the `### Waiting on you` paragraph, the sentence beginning "The delay, and whether the popup opens at all," becomes three:

```markdown
Both the delay and whether the popup opens at all are in the preferences. Set
the delay to zero and the message stays on the row until the agent does
something else. A popup opened that way then stays open until you close it.
```

- [ ] **Step 7: Thin the em dashes in that section (R9)**

Inside `## How it works` only, convert three or four em dashes to full stops or colons. Choose them from sentences already over 40 words — the task-list sentence ("shows how far through it is — `3/10` beside the clock —"), the sound-cue sentence ("not suppressed by a fullscreen window — that is when…"), and the Do Not Disturb sentence are the candidates. This is a rhythm fix: the aim is varied sentence length, not zero dashes. Do not touch dashes outside this section, and do not turn a dash into a comma splice.

- [ ] **Step 8: Fix the overstated feature headline (R8)**

`README.md:62-63`:

```markdown
- **Two agents, one pill.** Claude Code and Codex CLI sessions share the
  pill, each row led by a chip naming the agent.
```

- [ ] **Step 9: Complete the Contents list (R7)**

The list at `README.md:41-52` starts at Features and omits `## What it is`, which precedes it, and `## Uninstall`, added in Task 2. It must list every `##` heading in file order:

```markdown
- [What it is](#what-it-is)
- [Features](#features)
- [Requirements](#requirements)
- [Install](#install)
- [Uninstall](#uninstall)
- [How it works](#how-it-works)
- [Supported agents](#supported-agents)
- [Fail-open guarantee](#fail-open-guarantee)
- [Status and known limitations](#status-and-known-limitations)
- [Development](#development)
- [Contributing](#contributing)
- [Support](#support)
- [License](#license)
- [Credits](#credits)
```

Add the seven `### How it works` children as an indented sub-list under `How it works`, so the section is reachable by subject:

```markdown
- [How it works](#how-it-works)
  - [The pill](#the-pill)
  - [Agent chips](#agent-chips)
  - [Hook status and Update](#hook-status-and-update)
  - [Task lists](#task-lists)
  - [Waiting on you](#waiting-on-you)
  - [Sound cues](#sound-cues)
  - [Panel placement](#panel-placement)
```

- [ ] **Step 10: Check every Contents anchor against a real heading**

```bash
grep -n '^#\{2,3\} ' README.md
```

Expected: every `##` in that output appears in the Contents list, in the same order, and every `###` appears in the sub-list. Compare by hand — no test covers anchor validity in the README.

- [ ] **Step 11: Run all three gates**

```bash
npm test && npm run typecheck && node build.mjs
```

Expected: all three exit 0.

- [ ] **Step 12: Commit**

```bash
git add README.md test/docs/readme.test.ts
git commit -m "docs(readme): break up How it works and say what the table means

How it works was 525 words and seven subjects under one heading, with a
single anchor into all of it. The paragraphs already mapped one-to-one onto
subjects; they now have headings and Contents entries.

In this build took the values yes and coming soon, which answer two
different questions. The column is Availability now, and readme.test.ts
moves with it — the row regex and the Antigravity assertion both matched
the old values.

Every agent in one place promised five agents and delivered two, in a file
whose credibility rests on not doing that.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Batch 4 — community-file polish

**Files:**
- Modify: `CONTRIBUTING.md` (opener, gates, license line)
- Modify: `CODE_OF_CONDUCT.md` (preamble above the Covenant)
- Modify: `.github/ISSUE_TEMPLATE/feature_request.yml`, `.github/ISSUE_TEMPLATE/config.yml`, `.github/ISSUE_TEMPLATE/bug_report.yml`
- Test: `test/docs/communityFiles.test.ts` (one test added)

**Interfaces:**
- Consumes: Task 1's `main` branch name in `CONTRIBUTING.md`'s gates paragraph and `config.yml`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing drift test (R11)**

Add to `test/docs/communityFiles.test.ts`, inside the `describe`, after the changelog test:

```typescript
  // The fail-open guarantee is written out in full in two files, and nothing
  // stops one from being reworded on its own. The pair is the whole promise:
  // the README makes it, SECURITY.md explains what it costs.
  it('states the fail-open guarantee identically in the README and SECURITY.md', () => {
    const guarantee =
      'The hook helper exits 0 with empty stdout on every error path. ' +
      'If this extension is disabled, crashed, or never installed, your agents ' +
      'behave exactly as they would without it.'
    const normalise = (path: string) => readFileSync(path, 'utf8').replace(/\s+/g, ' ')
    expect(normalise('README.md'), 'the README lost the fail-open guarantee').toContain(guarantee)
    expect(normalise('SECURITY.md'), 'SECURITY.md lost the fail-open guarantee').toContain(
      guarantee
    )
  })
```

- [ ] **Step 2: Run it and confirm it passes for the right reason**

```bash
npx vitest run test/docs/communityFiles.test.ts
```

Expected: PASS — the two copies are identical today, which is what this test is here to keep true. Now prove it can fail: change one word in `SECURITY.md`'s copy of the sentence, re-run, see it FAIL naming `SECURITY.md`, then undo the change and re-run to PASS. A test that cannot fail is not a test.

- [ ] **Step 3: Say three gates and list three (K6)**

`CONTRIBUTING.md:42-53`, the whole `## The gates` section, becomes:

````markdown
## The gates

Three, and CI runs all of them on every pull request and on pushes to `main`:

```bash
npm test          # the core logic, no GNOME session needed
npm run typecheck
node build.mjs    # builds dist/ and the landing page in dist-site/
```

[The pull-request template](.github/PULL_REQUEST_TEMPLATE.md) lists what else
is worth checking before you open one.
````

`npm test` and `npm run typecheck` must both survive as literals; a test requires them.

- [ ] **Step 4: Replace the opener (K8)**

`CONTRIBUTING.md:3-5` becomes:

```markdown
The most useful thing you can send this project is a captured hook payload.
The second most useful is a bug report with a shell log. This is a GNOME Shell
extension written in TypeScript and bundled with esbuild; everything that can
be tested without a running GNOME session is tested with Vitest.

It is a one-person project, so replies come when they come.
```

No turnaround figure. Do not invent one.

- [ ] **Step 5: State the license contributions fall under (K7)**

In `CONTRIBUTING.md`, in the `## Code of Conduct` section at the end, above the existing sentence:

```markdown
## License and conduct

Contributions are accepted under GPL-3.0-or-later, the same license as the
project.

Participation is covered by the [Code of Conduct](CODE_OF_CONDUCT.md).
```

Spelled *license*, en-US, per the global constraints. Rename the heading as shown so it describes both sentences.

- [ ] **Step 6: Say who actually receives a Code of Conduct report (K9)**

In `CODE_OF_CONDUCT.md`, between the `# Contributor Covenant Code of Conduct` title and `## Our Pledge`:

```markdown
This is a one-person project. Reports go to <ayubaswad@gmail.com> and are read
by that one person, who is also the maintainer named in the Covenant text below
as "community leaders".
```

State no response time. Change nothing else in the file: the Covenant text stays verbatim, and the `Contributor Covenant` and `ayubaswad@gmail.com` literals both stay.

- [ ] **Step 7: Send feature requests past the limitations page first (K11)**

At the top of `.github/ISSUE_TEMPLATE/feature_request.yml`'s `body`, matching the shape of `bug_report.yml:5-8`:

```yaml
  - type: markdown
    attributes:
      value: |
        Please check [known limitations](https://github.com/dasbo-dev/island-gnome/blob/main/docs/limitations.md)
        first. Some gaps are known and documented, Codex permission gating
        above all.
```

The literal `extension` must still appear somewhere in the file; it does, in the `description` at the top. Leave the three existing fields alone.

- [ ] **Step 8: Give a plain question somewhere to go (K12)**

`.github/ISSUE_TEMPLATE/config.yml` becomes:

```yaml
blank_issues_enabled: false
contact_links:
  - name: Security report
    url: https://github.com/dasbo-dev/island-gnome/blob/main/SECURITY.md
    about: Please report vulnerabilities by email, not in a public issue.
  - name: Questions and ideas
    url: https://github.com/dasbo-dev/island-gnome/discussions
    about: Anything that is not a bug or a feature request.
  - name: Known limitations
    url: https://github.com/dasbo-dev/island-gnome/blob/main/docs/limitations.md
    about: What this project knows it has not proven. Check here first.
```

`blank_issues_enabled: false` stays; a test requires it, and the point of the links is to give those readers a destination.

- [ ] **Step 9: Ask for the commit, not a version that identifies nothing (K13)**

`.github/ISSUE_TEMPLATE/bug_report.yml`, the `extension-version` field:

```yaml
  - type: input
    id: extension-version
    attributes:
      label: Extension version
      description: "The commit you built: git rev-parse --short HEAD"
      placeholder: a39e3d8
```

The field stays optional — no `validations` block.

- [ ] **Step 10: Verify the YAML still parses**

```bash
node -e "const {readFileSync}=require('fs');for(const f of ['bug_report','feature_request','config'])console.log(f, readFileSync('.github/ISSUE_TEMPLATE/'+f+'.yml','utf8').length)"
npx vitest run test/docs/communityFiles.test.ts
```

Expected: three byte counts, then PASS. GitHub validates these templates on push; a broken one silently disappears from the issue chooser, so also eyeball the indentation of each block you added.

- [ ] **Step 11: Run all three gates**

```bash
npm test && npm run typecheck && node build.mjs
```

Expected: all three exit 0.

- [ ] **Step 12: Commit**

```bash
git add CONTRIBUTING.md CODE_OF_CONDUCT.md .github test/docs/communityFiles.test.ts
git commit -m "docs: finish the community files

The gates section said both and listed three. The contributing guide never
said what license a patch is offered under, and opened with Thanks for
looking rather than with the ask.

The Code of Conduct was unmodified boilerplate addressed to community
leaders, plural, in a project where reports reach one person.

Feature requests had nothing pointing them at the limitations page, blank
issues are disabled with only a security link to fall back on, and the
bug-report form asked for a version number that identifies nothing because
no version has been tagged.

The fail-open guarantee is written out in full in two files with nothing
holding them together. Now a test does.

No response times are stated anywhere: none has been committed to.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Merge and clean up

**Files:**
- Modify: none. This task moves branches.

**Interfaces:**
- Consumes: the four commits from Tasks 1-4.
- Produces: `main` carrying the work, no branch and no worktree left behind.

- [ ] **Step 1: Confirm the branch is clean and the gates are green one last time**

```bash
cd /home/fsevenm/projects/dasbo-island/.worktrees/dis-12-copy
git status --short
npm test && npm run typecheck && node build.mjs
```

Expected: `git status --short` prints nothing but ignored build output, and all three gates exit 0.

- [ ] **Step 2: Review the whole diff before it lands**

```bash
git diff main...HEAD --stat
git diff main...HEAD
```

Expected: changes only in `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, `Makefile`, `docs/limitations.md`, `.github/ISSUE_TEMPLATE/*`, `site/docPages.mjs`, `site/index.html`, `test/docs/readme.test.ts`, `test/docs/communityFiles.test.ts`, `test/site/docPages.test.ts`, `test/site/indexCopy.test.ts`. Anything else is a mistake.

- [ ] **Step 3: Merge to `main` with a merge commit**

```bash
cd /home/fsevenm/projects/dasbo-island
git merge --no-ff docs/dis-12-readme-community-copy -m "Merge: readme and community-file copy fixes from the DIS-7 audit

Twenty-four findings across four batches, plus the branch name the audit
predates: the repository was pushed to GitHub after it was written, and the
copy still said master.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Run the gates on `main`**

```bash
npm test && npm run typecheck && node build.mjs
```

Expected: all three exit 0 on the merged result, not just on the branch.

- [ ] **Step 5: Remove the worktree and delete the branch**

```bash
git worktree remove .worktrees/dis-12-copy
git branch -d docs/dis-12-readme-community-copy
git worktree list
git branch
```

Expected: `git worktree list` shows only the main checkout; `git branch` shows only `main`. If `git worktree remove` refuses because of untracked build output, re-run it with `--force` after confirming with `git status` in the worktree that nothing tracked is uncommitted.

---

## What this plan cannot verify

Report both in the final summary rather than claiming them:

- **`make install` on a live GNOME 46 desktop.** The gates prove `npm ci`, `node build.mjs` and `glib-compile-schemas` work; they cannot prove the install block works end to end from a fresh clone. R1 is exactly the copy that gets written from memory, so this is the smoke test that matters.
- **That the GitHub issue templates render.** GitHub parses them server-side on push. A malformed template drops out of the issue chooser silently.
