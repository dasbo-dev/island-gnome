# Generic Store Description Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the `metadata.json` store description and the two landing-page head tags so they lead with what the extension does for any coding agent and name Claude Code and Codex once, at the end.

**Architecture:** Copy-only change in three files, each guarded by an existing vitest suite. `test/core/metadata.test.ts` is rewritten first so the new copy has something to satisfy; `metadata.json` and `site/index.html` then change to pass it. No source file under `src/` is touched and no runtime behaviour changes.

**Tech Stack:** vitest, plain JSON and HTML. Run tests with `npx vitest run`.

**Spec:** `docs/superpowers/specs/2026-08-28-generic-store-description-design.md`

## Global Constraints

- The first paragraph of `metadata.json`'s `description` must be 150 characters or fewer. Paragraphs are separated by `\n\n` inside the JSON string.
- `site/index.html`'s `<meta name="description">` must be 160 characters or fewer and must not equal the `og:description`.
- The description's final paragraph stays exactly `Not affiliated with or endorsed by Anthropic, OpenAI or Google.`
- The disclosure paragraph must keep these literal tokens: `~/.claude/settings.json`, `~/.codex/hooks.json`, `Install hooks`, `.dasbo.bak`, `Remove hooks`, `GJS script`.
- The strings `Antigravity` and `.gemini` must not appear anywhere in the description.
- Do not edit `dist/metadata.json`; `build.mjs` regenerates it.
- Do not edit `README.md`, `src/`, or the landing page body copy.
- Every commit message ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

- `test/core/metadata.test.ts` — the pinning suite for the store description. Rewritten in Task 1: three tests added, one deleted, one changed, one path removed from a loop.
- `metadata.json` — the store description itself. Rewritten in Task 2.
- `site/index.html` — head tags only, lines 7 and 35. Rewritten in Task 3.
- `CHANGELOG.md` — one `Changed` entry under `[Unreleased]`. Task 4.

---

### Task 1: Move the pins onto the new copy

The tests describe copy that does not exist yet, so they fail on the current `metadata.json`. That is the point: they are the executable half of the spec, and Task 2 writes the copy that satisfies them.

**Files:**
- Modify: `test/core/metadata.test.ts:27-38` (the agents and scoping tests) and `test/core/metadata.test.ts:46-68` (the disclosure loop and the gemini test)
- Test: `test/core/metadata.test.ts` is itself the test

**Interfaces:**
- Consumes: `metadata` and `paragraphs`, already defined at `test/core/metadata.test.ts:15-16`. `paragraphs` is `description.split('\n\n')`.
- Produces: the contract Task 2 writes against — a four-paragraph description whose first paragraph is agent-free, whose third paragraph is the only one naming `Claude Code` and `Codex CLI`, and which mentions neither `Antigravity` nor `.gemini`.

- [ ] **Step 1: Replace the agents and scoping tests**

In `test/core/metadata.test.ts`, replace this block (currently lines 27-38):

```typescript
  it('names the agents rather than promising everything for all of them', () => {
    expect(description).toContain('Claude Code')
    expect(description).toContain('Codex')
  })

  // docs/limitations.md § "Codex has no permission gate": every Codex hook is
  // installed notify-only, so an unscoped promise of inline approval is false.
  it('scopes inline permission approval to the agent that has it', () => {
    const inline = description.indexOf('inline')
    if (inline === -1) return
    expect(description.slice(0, inline)).toContain('Claude Code permission')
  })
```

with this:

```typescript
  it('names the agents rather than promising everything for all of them', () => {
    expect(description).toContain('Claude Code')
    expect(description).toContain('Codex')
  })

  // DIS-28. The landing page hero says "coding agents" and names the two in a
  // table at the foot; test/site/indexCopy.test.ts pins its subhead free of
  // both names for the same reason. The list view cuts the description to its
  // first paragraph, so a vendor named there is a vendor in the store's
  // one-line summary — and every agent added later would force that sentence
  // open again.
  it('keeps the first paragraph free of agent and vendor names', () => {
    for (const name of ['Claude', 'Codex', 'Antigravity', 'Gemini', 'Anthropic', 'OpenAI']) {
      expect(paragraphs[0], `the first paragraph names ${name}`).not.toContain(name)
    }
  })

  // The names belong in one place. Scattering them back through the copy is
  // how the first paragraph got them in the first place.
  it('gathers the agent names into a single paragraph', () => {
    const naming = paragraphs.filter((p) => /Claude Code|Codex CLI/.test(p))
    expect(naming).toHaveLength(1)
  })

  // docs/limitations.md § "Codex has no permission gate": every Codex hook is
  // installed notify-only, so an unscoped promise that prompts get answered is
  // false for half the agents this build supports. The old form of this test
  // keyed on the word "inline" and demanded "Claude Code permission" before it;
  // the copy no longer uses either, so it passed while checking nothing. The
  // qualifier is what carries the truth now.
  it('qualifies the permission claim it makes before naming any agent', () => {
    const named = paragraphs.findIndex((p) => /Claude Code|Codex CLI/.test(p))
    expect(named, 'no paragraph names the agents').toBeGreaterThan(-1)
    for (const paragraph of paragraphs.slice(0, named)) {
      if (!/permission prompts/.test(paragraph)) continue
      expect(paragraph, 'an unqualified permission claim precedes the agent list').toContain(
        'where supported',
      )
    }
  })
```

- [ ] **Step 2: Drop the gemini path from the disclosure loop**

In the same file, in the test `discloses the files it writes and the terms it writes them on`, change the loop's array from three paths to two:

```typescript
    for (const path of ['~/.claude/settings.json', '~/.codex/hooks.json']) {
```

- [ ] **Step 3: Delete the gemini qualification test and pin its absence**

Delete this whole test, comment included (currently lines 56-68):

```typescript
  // DIS-15 final review, finding 1: agentCatalog.ts marks antigravity
  // 'coming-soon' and prefs.ts gives coming-soon rows no Install button, so no
  // reachable path in this build writes ~/.gemini/config/hooks.json. Naming
  // the file without qualifying it would claim a write this build cannot
  // perform. This asserts the qualification survives, not just the path, so a
  // copy edit cannot quietly turn the reserved file back into a claimed one.
  it('qualifies the gemini path as reserved, not written, in this build', () => {
    const gemini = description.indexOf('~/.gemini/config/hooks.json')
    expect(gemini, 'the gemini path is gone').not.toBe(-1)
    const sentence = description.slice(gemini)
    expect(sentence, 'the gemini path is no longer scoped to Antigravity').toContain('Antigravity')
    expect(sentence, 'the gemini path no longer says this build leaves it unused').toContain('not enabled in this build')
  })
```

and put this in its place:

```typescript
  // DIS-28 inverts DIS-15's finding. The qualification was accurate but
  // self-inflicted: the path was named, so it needed explaining. This build
  // never writes it — agentCatalog.ts marks antigravity 'coming-soon' and
  // prefs.ts gives a coming-soon row no Install button — so the description
  // drops it rather than explaining it. src/core/install/plan.ts still builds
  // the path, which is why this stays pinned: the copy must not drift back to
  // describing a write no reachable UI performs.
  it('claims no write to the file this build never touches', () => {
    expect(description).not.toContain('.gemini')
    expect(description).not.toContain('Antigravity')
  })
```

- [ ] **Step 4: Run the suite to verify the new tests fail**

Run: `npx vitest run test/core/metadata.test.ts`

Expected: FAIL, exactly two failures against the current copy:
- `keeps the first paragraph free of agent and vendor names` — the first paragraph names `Claude`
- `claims no write to the file this build never touches` — `.gemini` and `Antigravity` are both present

The other two new tests pass already, for reasons the copy change will not disturb:
- `gathers the agent names into a single paragraph` — the current copy does name them in one paragraph. That paragraph is the first one, which is exactly what the test above rejects. This test guards the names against scattering once they move to the end.
- `qualifies the permission claim it makes before naming any agent` — vacuous today, because the naming paragraph is the first one, so no paragraph precedes it. It starts doing work in Task 2, when a generic permission claim lands ahead of the agent list.

If either of the two expected failures does not appear, stop and re-read `metadata.json` — the copy has changed since this plan was written.

- [ ] **Step 5: Commit**

```bash
git add test/core/metadata.test.ts
git commit -m "$(cat <<'EOF'
test: pin the store description on the shape DIS-28 asks for

The names belong in one paragraph at the end, the first paragraph
belongs to no vendor, and the reserved gemini path leaves the copy
because no reachable UI in this build writes it. These fail until the
copy moves.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Rewrite the store description

**Files:**
- Modify: `metadata.json:4` (the `description` value)
- Test: `test/core/metadata.test.ts`

**Interfaces:**
- Consumes: the contract from Task 1.
- Produces: a description whose third paragraph reads `This build supports Claude Code, with status and permission prompts, and Codex CLI, with status only.` Task 3 mirrors this wording in the landing page head.

- [ ] **Step 1: Replace the description value**

`metadata.json` is a single-line-per-key JSON file; `description` is one long string with `\n\n` between paragraphs. Replace the whole value on line 4 with:

```json
  "description": "Live coding agent sessions in the top bar: status at a glance, one click back to the terminal, and permission prompts answered where supported.\n\nPreferences can add hook entries to an agent's own config file, ~/.claude/settings.json or ~/.codex/hooks.json; this happens only when you press Install hooks. A .dasbo.bak copy is written before the first change, and Remove hooks takes the entries back out again. The hook itself is hooks/dasbo-hook, a readable GJS script that the agent runs, not the extension.\n\nThis build supports Claude Code, with status and permission prompts, and Codex CLI, with status only.\n\nNot affiliated with or endorsed by Anthropic, OpenAI or Google.",
```

Leave every other key untouched: `uuid`, `name`, `shell-version`, `settings-schema`, `settings-schema`'s value, `url`, `version-name`.

- [ ] **Step 2: Run the metadata suite**

Run: `npx vitest run test/core/metadata.test.ts`

Expected: PASS, all tests in the file.

- [ ] **Step 3: Check the first paragraph against the truncation limit directly**

Run:

```bash
node -e "const d=require('./metadata.json').description.split('\n\n'); console.log(d.length, d[0].length)"
```

Expected output: `4 143`

Four paragraphs, and a first paragraph of 143 characters. If the length is above 150 the test in Step 2 would already have failed; this prints the actual number so the margin is visible rather than assumed.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`

Expected: PASS, 949 tests. `test/site/head.test.ts` reads `metadata.json` for `softwareVersion` and `shell-version`, neither of which changed, so it should be unaffected — if it fails, a key other than `description` was edited.

- [ ] **Step 5: Commit**

```bash
git add metadata.json
git commit -m "$(cat <<'EOF'
docs: lead the store description with what the extension does

The first paragraph is what extensions.gnome.org shows in its list view,
and it opened with two vendors' product names. It now describes the work
for any coding agent; Claude Code and Codex CLI are named once, near the
end, with what each one actually gets. The permission claim keeps its
qualifier, because Codex hooks are notify-only.

The reserved ~/.gemini/config/hooks.json path goes with them. No
reachable path in this build writes it, so the description no longer has
a file to explain.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Match the landing page head to its own copy

The visible landing page already reads generically. Two tags in the head did not move with it.

**Files:**
- Modify: `site/index.html:7` (the meta description) and `site/index.html:35` (the JSON-LD `description`)
- Test: `test/site/head.test.ts`, `test/site/indexCopy.test.ts`

**Interfaces:**
- Consumes: the third-paragraph wording from Task 2, reused as `where supported`.
- Produces: nothing later tasks read.

- [ ] **Step 1: Rewrite the meta description**

Replace line 7 of `site/index.html`:

```html
<meta name="description" content="GNOME Shell extension for coding agents: every live session in the top bar, permission prompts answered where supported, one click back to the terminal.">
```

- [ ] **Step 2: Rewrite the JSON-LD description**

Replace the `description` line inside the `application/ld+json` block (line 35):

```json
  "description": "A GNOME Shell extension that keeps every live coding agent session in the top bar.",
```

Change nothing else in that block. `softwareVersion`, `operatingSystem` and `offers.price` are pinned against `metadata.json` by `test/site/head.test.ts`.

- [ ] **Step 3: Check the meta description length directly**

Run:

```bash
node -e "const h=require('fs').readFileSync('site/index.html','utf8'); console.log(h.match(/<meta name=\"description\" content=\"([^\"]+)\"/)[1].length)"
```

Expected output: `152`

Inside the 160 the test allows.

- [ ] **Step 4: Run the site suite**

Run: `npx vitest run test/site/`

Expected: PASS. `keeps the meta description under 160 characters and off the OG copy` checks both the length and that it still differs from the og:description, which is untouched and describes the demo rather than the product.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`

Expected: PASS, 949 tests.

- [ ] **Step 6: Commit**

```bash
git add site/index.html
git commit -m "$(cat <<'EOF'
docs(site): move the head tags to the copy the page already uses

The hero says "coding agents" and the Supported agents table names the
two at the foot, but the meta description and the JSON-LD description
still opened with both vendors. The search snippet loses those two
keywords; the page still carries them in the table and the copy around
it, so it stays indexable for them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Record the change and rebuild

**Files:**
- Modify: `CHANGELOG.md`, under `## [Unreleased]` → `### Changed`
- Test: `test/docs/communityFiles.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Add the changelog entry**

In `CHANGELOG.md`, under the existing `### Changed` heading inside `## [Unreleased]`, add this as the first bullet:

```markdown
- The extensions.gnome.org description now leads with what the extension does
  rather than which agents it does it for. Claude Code and Codex CLI are named
  once, at the end, with what each one gets: status and permission prompts for
  Claude Code, status alone for Codex. The reserved
  `~/.gemini/config/hooks.json` path is no longer mentioned, because no
  reachable path in this build writes it.
```

- [ ] **Step 2: Rebuild so dist picks up the new metadata**

Run: `npm run build`

Expected: the build completes without error. `build.mjs` copies `metadata.json` into `dist/`.

- [ ] **Step 3: Confirm the built copy matches the source**

Run:

```bash
diff <(node -e "process.stdout.write(require('./metadata.json').description)") <(node -e "process.stdout.write(require('./dist/metadata.json').description)") && echo same
```

Expected output: `same`

- [ ] **Step 4: Run the full suite and the typechecker**

Run: `npx vitest run && npm run typecheck`

Expected: 949 tests pass; typecheck exits 0.

- [ ] **Step 5: Commit**

`dist/` is a build artifact — check `git status --short` before staging, and if `dist/` shows up as modified and is not ignored in this repo, leave it out of the commit.

```bash
git add CHANGELOG.md
git commit -m "$(cat <<'EOF'
docs: changelog the generic store description

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Done when

- `npx vitest run` passes with no failures.
- `metadata.json`'s description has four paragraphs, a 143-character first paragraph, and names `Claude Code` and `Codex CLI` only in the third.
- `Antigravity` and `.gemini` appear nowhere in the description.
- `site/index.html`'s meta description and JSON-LD description name no agent.
- Four commits sit on `worktree-dis-28-generic-description` above the spec commit.

## No smoke test needed

The description is store metadata and head markup. No runtime code path reads either, so nothing needs a GNOME session to verify. Reinstalling the extension or restarting the shell would show nothing new.
