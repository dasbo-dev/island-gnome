# extensions.gnome.org Readiness Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every extensions.gnome.org review finding that can be verified on a GNOME Shell 46 machine — the two `metadata.json` rule violations, the silent-failure zip, and the hook's dependency on an executable bit nothing sets.

**Architecture:** Four independent change groups, one commit each, in the order below. Nothing here touches the extension's runtime behaviour except the hook command string, whose migration rides the existing `stale` → **Update hooks** path with no new code. The packaging group replaces an accident (the `+x` bit and the archive contents happening to be right) with a check that fails loudly when it stops being right.

**Tech Stack:** TypeScript compiled by esbuild via `build.mjs`, vitest for tests, GNU Make for packaging, plain `.mjs` for build-side tooling (node cannot run TypeScript, which is why `site/docPages.mjs` is already plain JS).

**Spec:** `docs/superpowers/specs/2026-08-11-ego-readiness-fixes-design.md`

## Global Constraints

- Working directory is the worktree `/home/fsevenm/projects/dasbo-island-dis-15`, branch `dis-15-ego-readiness`. The shell's startup profile errors on `cd` in this environment (`ERROR: GVM_ROOT not set`); use `git -C <path>` and absolute paths rather than `cd`.
- Baseline that must stay green throughout: **859 tests across 62 files** (`npm test`), and `npm run typecheck` clean across all three tsconfigs.
- `metadata.json`'s first description paragraph must stay **≤150 characters** — this is what the EGO list view shows.
- `metadata.json` must keep containing the literal `github.com/dasbo-dev/island-gnome`; `test/repoUrls.test.ts` asserts it.
- Vitest only collects `test/**/*.test.ts`. A `.mjs` module under test must be added to `tsconfig.test.json`'s `include`, exactly as `site/docPages.mjs` already is.
- Every guard test carries a comment naming the silent failure it exists to catch. This is an established repository convention — see `test/shell/iconAssets.test.ts`.
- Do not touch anything under `docs/superpowers/plans/` other than this file. Those are historical records of past work.
- B1 (`shell-version: ["46"]`) is deliberately out of scope. Do not change `shell-version`, and do not change the `GNOME Shell 46` badge at `README.md:14`. They must continue to agree with each other.

---

### Task 1: `metadata.json` — drop `session-modes`, disclose what the extension writes

Closes B2, H1 and M1.

**Files:**
- Modify: `metadata.json`
- Modify: `test/core/metadata.test.ts:17-34`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks rely on.

- [ ] **Step 1: Write the failing tests**

In `test/core/metadata.test.ts`, replace the existing `it('fits inside the list-view truncation', …)` block (lines 21-23) with the re-scoped version below, and add the two new blocks. The final `describe('the store description', …)` body should read:

```typescript
describe('the store description', () => {
  const description = String(metadata.description)
  const paragraphs = description.split('\n\n')

  // extensions.gnome.org truncates the description in its list view at roughly
  // 150 characters, and shows the whole thing on the extension page. So the
  // limit belongs on the first paragraph, not the whole string: whatever the
  // list view cuts to must still be a complete claim, while the disclosure
  // below the fold is free to be as long as it needs to be.
  it('fits its first paragraph inside the list-view truncation', () => {
    expect(paragraphs[0]!.length).toBeLessThanOrEqual(150)
  })

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

  // H1 of the DIS-14 review: the extension writes into three other
  // applications' config files and the store description said nothing about
  // it. A reviewer who greps before reading finds writes to $HOME and has to
  // guess at the intent. Every clause below is a disclosure the reviewer would
  // otherwise have to discover; a copy edit that drops one puts the submission
  // back where it started.
  it('discloses the files it writes and the terms it writes them on', () => {
    for (const path of ['~/.claude/settings.json', '~/.codex/hooks.json', '~/.gemini/config/hooks.json']) {
      expect(description, `the description no longer names ${path}`).toContain(path)
    }
    expect(description, 'the button-press precondition is gone').toContain('Install hooks')
    expect(description, 'the backup is no longer mentioned').toContain('.dasbo.bak')
    expect(description, 'removal is no longer mentioned').toContain('Remove hooks')
    expect(description, 'the hook still reads as a shipped binary').toContain('GJS script')
  })

  // M1 of the DIS-14 review: the copy uses three vendors' product names
  // nominatively and the icons carry their brand colours, so the description
  // must not be readable as a claim of endorsement.
  it('disclaims affiliation with the three vendors it names', () => {
    expect(description).toContain('Not affiliated with or endorsed by Anthropic, OpenAI or Google.')
  })
})
```

Add a new `describe` block at the end of the file:

```typescript
describe('session-modes', () => {
  // Review guideline, verbatim: "This MUST be dropped if you are only using
  // `user` mode." Nothing in the tree references unlock-dialog, so the key was
  // a straight rule violation rather than a claim that needed narrowing.
  // Re-adding it fails a submission, and nothing else would catch it.
  it('is absent, because the extension is user-mode only', () => {
    expect(metadata).not.toHaveProperty('session-modes')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/core/metadata.test.ts`

Expected: FAIL. Three failures — `discloses the files it writes and the terms it writes them on` (description does not contain `~/.claude/settings.json`), `disclaims affiliation with the three vendors it names`, and `is absent, because the extension is user-mode only` (the property is still there). The re-scoped length test passes already, because the current 143-character description is a single paragraph.

- [ ] **Step 3: Edit `metadata.json`**

Delete the `"session-modes": ["user"],` line entirely, and replace the `description` value. The whole file becomes:

```json
{
  "uuid": "dasbo-island@ayubaswad.gmail.com",
  "name": "Dasbo Island",
  "description": "Live Claude Code and Codex sessions in the top bar: status, one click back to the terminal, and Claude Code permission prompts answered inline.\n\nPreferences can add hook entries to ~/.claude/settings.json, ~/.codex/hooks.json and ~/.gemini/config/hooks.json. This happens only when you press Install hooks; a .dasbo.bak copy is written before the first change, and Remove hooks takes the entries back out again. The hook itself is hooks/dasbo-hook, a readable GJS script that the agent runs, not the extension.\n\nNot affiliated with or endorsed by Anthropic, OpenAI or Google.",
  "shell-version": ["46"],
  "settings-schema": "org.gnome.shell.extensions.dasbo-island",
  "url": "https://github.com/dasbo-dev/island-gnome",
  "version-name": "0.1.0"
}
```

The first paragraph is byte-identical to the previous description (143 characters). `Install hooks` and `Remove hooks` are the verbatim button labels from `src/prefs.ts:255-256`, so the description describes the UI that exists.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/core/metadata.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS. Test count rises from 859 to 862 (three new tests).

- [ ] **Step 6: Commit**

```bash
git -C /home/fsevenm/projects/dasbo-island-dis-15 add metadata.json test/core/metadata.test.ts
git -C /home/fsevenm/projects/dasbo-island-dis-15 commit -m "fix(metadata): drop session-modes and disclose what preferences writes

session-modes: [\"user\"] is dropped because the guideline says it MUST be
when user mode is all you use, and nothing here references unlock-dialog.

The description now says which three config files the Install hooks button
edits, that a .dasbo.bak copy comes first, that Remove hooks reverses it,
and that the hook is a GJS script rather than the binary its extensionless
executable name suggests. A reviewer who greps for file writes should not
be the first to learn any of that.

The <=150 character limit moves from the whole description to its first
paragraph: that is the part the store list view truncates, and the rest is
only ever read on the extension page.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Invoke the hook through `gjs -m`, so no executable bit is load-bearing

Closes H2.

`hooks/dasbo-hook` is written into agent configs as a bare command path, so the agent execs it directly and it needs `+x`. No `chmod` exists in `src/`, `hooks/` or `build.mjs`; the bit survives only because `make pack` zips a file that already has it. If EGO's repackaging or the Shell's extraction drops the mode, every hook fails silently and the extension does nothing at all.

**Files:**
- Modify: `src/core/install/plan.ts:51-53`
- Modify: `test/core/install/plan.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `cmd(env, agent, mode, event)` now returns `` `gjs -m ${env.hookPath} ${agent} ${mode} ${event}` ``. Nothing outside `plan.ts` calls `cmd` — it is module-private — so no other task depends on this signature.

Two facts verified on the target machine before this task was written, so do not re-litigate them:

- `ARGV` is `["a","b","c"]` under both `./hook a b c` and `gjs -m ./hook a b c`. `hooks/dasbo-hook:61-63` reads `ARGV[0..2]` and needs no change.
- The `#!/usr/bin/gjs -m` hashbang parses without error when `gjs -m` is explicit. Leave the shebang in place: `test/hook/harness.mjs:44` spawns the file directly and relies on it.

Note also that **no existing test asserts an exact command string** — every assertion in `plan.test.ts` uses `toContain`. So this change breaks nothing, which is exactly why the new test below is needed: without it the prefix could be silently dropped again.

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to `test/core/install/plan.test.ts`, after the `describe('planInstall for claude', …)` block:

```typescript
describe('the hook invocation', () => {
  // hooks/dasbo-hook has no extension and needs +x to be exec'd directly, and
  // nothing in src/, hooks/ or build.mjs ever sets that bit — it survives only
  // because make pack zips a file that already has it. If EGO's repackaging or
  // the Shell's extraction drops the mode, every hook fails silently and the
  // extension does nothing at all. Going through `gjs -m` makes the bit
  // irrelevant, and this test is the only thing keeping it that way.
  it('runs the hook through gjs, so the executable bit cannot matter', () => {
    const parsed = JSON.parse(planInstall('claude', env())[0]!.content)
    const command = parsed.hooks.Stop[0].hooks[0].command
    expect(command).toBe(
      'gjs -m /home/me/.local/share/gnome-shell/extensions/dasbo-island@ayubaswad.gmail.com/hooks/dasbo-hook claude notify Stop'
    )
  })

  it('uses bare gjs, which resolves on distributions that do not use /usr/bin', () => {
    const parsed = JSON.parse(planInstall('claude', env())[0]!.content)
    const command = parsed.hooks.Stop[0].hooks[0].command
    expect(command.startsWith('gjs -m '), `command was: ${command}`).toBe(true)
  })

  it('runs every agent through gjs, not just the one that gates permissions', () => {
    const codex = JSON.parse(planInstall('codex', env())[0]!.content)
    expect(codex.hooks.Stop[0].hooks[0].command.startsWith('gjs -m ')).toBe(true)

    const antigravity = JSON.parse(planInstall('antigravity', env())[0]!.content)
    expect(antigravity['dasbo-island'].Stop[0].command.startsWith('gjs -m ')).toBe(true)
    expect(antigravity['dasbo-island'].PreToolUse[0].hooks[0].command.startsWith('gjs -m ')).toBe(true)
  })

  // The upgrade path for anyone who installed hooks before this change. It
  // needs no new code — isOurs() matches the dasbo-hook substring, which the
  // new command still contains — but it is the kind of thing that breaks
  // silently and leaves a user with hooks firing twice, or not at all.
  it('reads a pre-gjs install as stale, so the row offers Update hooks', () => {
    const legacy = JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: 'command',
                command:
                  '/home/me/.local/share/gnome-shell/extensions/dasbo-island@ayubaswad.gmail.com/hooks/dasbo-hook claude notify Stop',
              },
            ],
          },
        ],
      },
    })
    expect(installState('claude', env({ '/home/me/.claude/settings.json': legacy }))).toBe('stale')
  })

  it('replaces a pre-gjs entry rather than doubling it, so the hook fires once', () => {
    const legacy = JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: 'command',
                command:
                  '/home/me/.local/share/gnome-shell/extensions/dasbo-island@ayubaswad.gmail.com/hooks/dasbo-hook claude notify Stop',
              },
            ],
          },
        ],
      },
    })
    const parsed = JSON.parse(
      planInstall('claude', env({ '/home/me/.claude/settings.json': legacy }))[0]!.content
    )
    const commands = parsed.hooks.Stop.flatMap((g: any) => g.hooks.map((h: any) => h.command))
    expect(commands.filter((c: string) => c.includes('dasbo-hook'))).toHaveLength(1)
    expect(commands[0]).toContain('gjs -m ')
  })

  it('removes a pre-gjs entry on uninstall, so the old form is not orphaned', () => {
    const legacy = JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: 'command',
                command:
                  '/home/me/.local/share/gnome-shell/extensions/dasbo-island@ayubaswad.gmail.com/hooks/dasbo-hook claude notify Stop',
              },
            ],
          },
        ],
      },
    })
    const edits = planUninstall('claude', env({ '/home/me/.claude/settings.json': legacy }))
    expect(edits).toHaveLength(1)
    expect(JSON.parse(edits[0]!.content).hooks.Stop).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/core/install/plan.test.ts -t "hook invocation"`

Expected: FAIL. Four failures — the two exact/prefix assertions and the all-agents one report a command with no `gjs -m ` prefix; `replaces a pre-gjs entry rather than doubling it` fails on the `toContain('gjs -m ')`. The two tests that only exercise `isOurs` matching (`reads a pre-gjs install as stale`, `removes a pre-gjs entry on uninstall`) pass already — the legacy string is what the current code writes — and that is the point: they are there to keep passing after the change.

- [ ] **Step 3: Change `cmd()`**

In `src/core/install/plan.ts`, replace the function at lines 51-53. The existing doc comment above it stays; append the second paragraph:

```typescript
/**
 * Every event gets its own command carrying the event name, so a hook line
 * is self-describing even for agents whose payload already names the event
 * (Claude, Codex) and load-bearing for the one that has no event field at all
 * (Antigravity).
 *
 * Run through `gjs -m` rather than as a bare path, so the hook's executable
 * bit stops being load-bearing: nothing in this tree ever sets it, and a
 * dropped mode would make every hook fail silently. Bare `gjs`, not
 * /usr/bin/gjs, because not every distribution puts it there — and any machine
 * running GNOME Shell has it on PATH. The `dasbo-hook` substring survives in
 * the new string, so isOurs() still recognises entries written either way and
 * the upgrade rides the existing stale/Update path.
 */
function cmd(env: InstallEnv, agent: AgentId, mode: 'notify' | 'permission', event: string): string {
  return `gjs -m ${env.hookPath} ${agent} ${mode} ${event}`
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/core/install/plan.test.ts`
Expected: PASS, every test in the file including the pre-existing ones.

- [ ] **Step 5: Run the full suite and the typechecker**

Run: `npm test && npm run typecheck`
Expected: PASS. Test count rises from 862 to 868 (six new tests). Typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git -C /home/fsevenm/projects/dasbo-island-dis-15 add src/core/install/plan.ts test/core/install/plan.test.ts
git -C /home/fsevenm/projects/dasbo-island-dis-15 commit -m "fix(install): run the hook through gjs so no executable bit is load-bearing

hooks/dasbo-hook went into agent configs as a bare path, so the agent
exec'd it and it needed +x. Nothing in src/, hooks/ or build.mjs ever set
that bit: it survived only because make pack zips a file that already had
it. A repackaging step that drops the mode would make every hook fail
silently, which is the whole extension doing nothing with no error anywhere.

gjs -m makes the bit irrelevant. Bare gjs rather than /usr/bin/gjs, since
not every distribution puts it there and any machine running the Shell has
it on PATH. ARGV is identical under both invocations, so the hook itself is
unchanged, and the shebang stays because the test harness spawns the file
directly.

Anyone who installed hooks before this reads as stale and gets the existing
Update hooks button; isOurs() still matches on the dasbo-hook substring, so
uninstall keeps working on the old form too.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Make `make pack` refuse to produce a broken archive

Closes B3, M2 and M3.

The zip in the worktree was built 2026-07-27 and holds nine entries — `metadata.json`, `extension.js`, `stylesheet.css`, `prefs.js`, `schemas/`, `hooks/` — with **no `icons/` and no `assets/`**. `build.mjs:31` and `build.mjs:36` copy both, and both are loaded by absolute path at runtime, so both fail silently when absent: mark-less agent chips and a blank About QR, with nothing reported. `build.mjs` was correct the whole time and the artefact was still wrong, which is why the check has to read the archive rather than the source.

**Files:**
- Create: `tools/verify-pack.mjs`
- Create: `test/tools/verifyPack.test.ts`
- Modify: `build.mjs:8-16` (the `common` build options)
- Modify: `Makefile` (the `pack` target)
- Modify: `tsconfig.test.json` (the `include` array)
- Delete: `dasbo-island@ayubaswad.gmail.com.shell-extension.zip` (gitignored; local only)

**Interfaces:**
- Consumes: nothing from Tasks 1 and 2.
- Produces: `tools/verify-pack.mjs` exports `checkEntries(entries: string[]): string[]` — takes archive entry names as `unzip -Z1` prints them (no leading `./`, directories with a trailing `/`) and returns an array of human-readable violation messages, empty when the archive is good. It also runs as a CLI: `node tools/verify-pack.mjs <path-to-zip>`.

- [ ] **Step 1: Write the failing test**

Create `test/tools/verifyPack.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { checkEntries } from '../../tools/verify-pack.mjs'

// The stale archive that prompted this file held nine entries and neither
// icons/ nor assets/. Both are loaded by absolute path at runtime and both
// fail silently when missing — a mark-less agent chip and a blank About QR,
// with nothing logged. build.mjs was correct the whole time, so a test that
// greps build.mjs would have passed on the broken artefact. This checks the
// archive listing itself.
const GOOD = [
  'metadata.json',
  'extension.js',
  'prefs.js',
  'stylesheet.css',
  'schemas/',
  'schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml',
  'hooks/',
  'hooks/dasbo-hook',
  'icons/',
  'icons/claude.svg',
  'icons/codex.svg',
  'icons/antigravity.svg',
  'assets/',
  'assets/qr-code.png',
]

describe('checkEntries', () => {
  it('passes an archive holding everything and nothing extra', () => {
    expect(checkEntries(GOOD)).toEqual([])
  })

  it('rejects the archive that actually shipped: no icons, no assets', () => {
    const stale = GOOD.filter((e) => !e.startsWith('icons/') && !e.startsWith('assets/'))
    const problems = checkEntries(stale)
    expect(problems.join('\n')).toContain('icons/')
    expect(problems.join('\n')).toContain('assets/')
  })

  it('reports every violation at once, not just the first', () => {
    // A guard against a silent failure is only as good as its message: a
    // one-at-a-time check turns one broken pack into four rebuild cycles.
    const bad = GOOD.filter((e) => !e.startsWith('icons/') && !e.startsWith('assets/')).concat([
      'extension.js.map',
      'schemas/gschemas.compiled',
    ])
    expect(checkEntries(bad).length).toBeGreaterThanOrEqual(4)
  })

  it('rejects an archive missing the agent icons', () => {
    expect(checkEntries(GOOD.filter((e) => !e.startsWith('icons/')))).toHaveLength(1)
  })

  it('rejects an archive missing the About assets', () => {
    expect(checkEntries(GOOD.filter((e) => !e.startsWith('assets/')))).toHaveLength(1)
  })

  it('rejects a sourcemap, which make pack excludes and the bundles still name', () => {
    expect(checkEntries([...GOOD, 'extension.js.map'])).toHaveLength(1)
  })

  // EGO compiles schemas itself; the requirement is the XML. The compiled
  // blob is generated data under the "no unnecessary files" rule.
  it('rejects the compiled schema blob while keeping the XML required', () => {
    expect(checkEntries([...GOOD, 'schemas/gschemas.compiled'])).toHaveLength(1)
    expect(checkEntries(GOOD.filter((e) => !e.endsWith('.gschema.xml')))).toHaveLength(1)
  })

  it('rejects an archive missing the hook the whole extension depends on', () => {
    expect(checkEntries(GOOD.filter((e) => e !== 'hooks/dasbo-hook'))).toHaveLength(1)
  })

  it('rejects an archive missing metadata.json, extension.js, prefs.js or the stylesheet', () => {
    for (const required of ['metadata.json', 'extension.js', 'prefs.js', 'stylesheet.css']) {
      expect(checkEntries(GOOD.filter((e) => e !== required)), `${required} was not required`).toHaveLength(1)
    }
  })

  it('names the offending entry in the message, not just the rule', () => {
    expect(checkEntries([...GOOD, 'extension.js.map'])[0]).toContain('extension.js.map')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/tools/verifyPack.test.ts`
Expected: FAIL — `Failed to resolve import "../../tools/verify-pack.mjs"`, because the module does not exist yet.

- [ ] **Step 3: Write `tools/verify-pack.mjs`**

```javascript
#!/usr/bin/env node
// Reads the entry listing of a packed extension archive and refuses the ones
// that would ship broken.
//
// This exists because the artefact and the build script can disagree. The zip
// that prompted it held nine entries and neither icons/ nor assets/, while
// build.mjs had been copying both correctly the whole time. Both directories
// are loaded by absolute path at runtime and both fail silently when missing,
// so the failure reaches a user as a mark-less agent chip and a blank About QR
// with nothing in the log. A source-text assertion could not have caught it.
import { execFileSync } from 'node:child_process'

/** Entries that must be present, as a label and the predicate that finds them. */
const REQUIRED = [
  ['metadata.json', (e) => e === 'metadata.json'],
  ['extension.js', (e) => e === 'extension.js'],
  ['prefs.js', (e) => e === 'prefs.js'],
  ['stylesheet.css', (e) => e === 'stylesheet.css'],
  ['the gschema XML under schemas/', (e) => e.endsWith('.gschema.xml')],
  ['hooks/dasbo-hook', (e) => e === 'hooks/dasbo-hook'],
  ['at least one icons/*.svg — the agent chip marks', (e) => /^icons\/.+\.svg$/.test(e)],
  ['at least one file under assets/ — the About QR', (e) => /^assets\/.+/.test(e)],
]

/** Entries that must be absent, as a label and the predicate that finds them. */
const FORBIDDEN = [
  ['a sourcemap, which make pack excludes and nothing can resolve', (e) => e.endsWith('.map')],
  ['schemas/gschemas.compiled, which EGO regenerates itself', (e) => e === 'schemas/gschemas.compiled'],
]

/**
 * @param {string[]} entries Archive entry names as `unzip -Z1` prints them:
 *   no leading `./`, directories with a trailing slash.
 * @returns {string[]} One message per violation, empty when the archive is good.
 *   Every rule is evaluated, because a one-at-a-time check turns one broken
 *   pack into as many rebuild cycles as there are problems.
 */
export function checkEntries(entries) {
  const problems = []

  for (const [label, matches] of REQUIRED) {
    if (!entries.some(matches)) problems.push(`missing: ${label}`)
  }

  for (const [label, matches] of FORBIDDEN) {
    for (const entry of entries.filter(matches)) {
      problems.push(`must not ship: ${entry} — ${label}`)
    }
  }

  return problems
}

/** @param {string} zipPath */
function entriesOf(zipPath) {
  return execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

// Run as a CLI only, so importing this from a test does not shell out.
if (process.argv[1] && process.argv[1].endsWith('verify-pack.mjs')) {
  const zipPath = process.argv[2]
  if (!zipPath) {
    console.error('usage: node tools/verify-pack.mjs <archive.zip>')
    process.exit(2)
  }
  const problems = checkEntries(entriesOf(zipPath))
  if (problems.length > 0) {
    console.error(`${zipPath} is not fit to upload:`)
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log(`${zipPath}: verified`)
}
```

- [ ] **Step 4: Add the module to the test tsconfig**

In `tsconfig.test.json`, extend the `include` array so the last line reads:

```json
  "include": ["test/**/*.ts", "site/docPages.mjs", "tools/verify-pack.mjs"]
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/tools/verifyPack.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Turn sourcemaps off for the packed build**

In `build.mjs`, replace the `common` object at lines 8-16 with:

```javascript
// make pack excludes *.map from the archive, so a packed build that emitted
// the //# sourceMappingURL= comment would ship a pointer to a file that is not
// there. Development builds keep sourcemaps, because make install is not what
// ships.
const packing = process.env['DASBO_PACK'] === '1'
const common = {
  bundle: true,
  format: 'esm',
  target: 'firefox115',
  platform: 'neutral',
  minify: false,
  sourcemap: !packing,
  external,
}
```

The site build below already overrides `sourcemap: false` explicitly, so it is unaffected either way.

- [ ] **Step 7: Wire the `pack` target**

In the `Makefile`, replace the `pack` target with:

```make
pack:
	DASBO_PACK=1 npm run build
	glib-compile-schemas dist/schemas
	cd dist && zip -qr ../$(UUID).shell-extension.zip . -x '*.map' -x 'schemas/gschemas.compiled'
	node tools/verify-pack.mjs $(UUID).shell-extension.zip
```

Three things changed. `pack` no longer depends on the `build` target — it runs the build itself with `DASBO_PACK=1` set, because a prerequisite would run it without the variable. `glib-compile-schemas` still runs so `dist/` stays usable for a local `make install`, and the compiled blob is excluded at zip time rather than never generated. And `verify-pack.mjs` runs last, so a bad archive fails the target.

- [ ] **Step 8: Delete the stale archive and pack for real**

```bash
rm -f "/home/fsevenm/projects/dasbo-island/dasbo-island@ayubaswad.gmail.com.shell-extension.zip"
make -C /home/fsevenm/projects/dasbo-island-dis-15 pack
```

Expected: the build prints `built dist/ and dist-site/`, then
`dasbo-island@ayubaswad.gmail.com.shell-extension.zip: verified`.

- [ ] **Step 9: Read the archive listing with your own eyes**

```bash
unzip -l "/home/fsevenm/projects/dasbo-island-dis-15/dasbo-island@ayubaswad.gmail.com.shell-extension.zip"
```

Expected: `icons/claude.svg`, `icons/codex.svg`, `icons/antigravity.svg` and `assets/qr-code.png` are all listed; no `.map` entry; no `schemas/gschemas.compiled`; `schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml` and `hooks/dasbo-hook` are present.

This step is not redundant with Step 8. The whole lesson of B3 is that "the tool says it is fine" and "the artefact is fine" are different claims, and the verifier is new code that has never been run against a real archive before now.

- [ ] **Step 10: Confirm the sourcemap comment is gone**

```bash
tail -c 200 /home/fsevenm/projects/dasbo-island-dis-15/dist/extension.js
```

Expected: no `//# sourceMappingURL=` line.

- [ ] **Step 11: Run the full suite and the typechecker**

Run: `npm test && npm run typecheck`
Expected: PASS. Test count rises from 868 to 878 (ten new tests). Typecheck exits 0.

- [ ] **Step 12: Commit**

```bash
git -C /home/fsevenm/projects/dasbo-island-dis-15 add tools/verify-pack.mjs test/tools/verifyPack.test.ts build.mjs Makefile tsconfig.test.json
git -C /home/fsevenm/projects/dasbo-island-dis-15 commit -m "build: make pack refuse to produce an archive that would ship broken

The zip in the worktree was built in July with nine entries and neither
icons/ nor assets/. Both are loaded by absolute path at runtime and both
fail silently when missing, so uploading it would have shipped mark-less
agent chips and a blank About QR with nothing in the log to say why.

build.mjs had been copying both correctly the whole time, which is the
point: a test that greps build.mjs would have passed on the broken
artefact. tools/verify-pack.mjs reads the archive that was just written
and reports every violation at once.

Also drops gschemas.compiled from the archive, since EGO compiles schemas
itself and the requirement is the XML, and turns sourcemaps off when
packing so the bundles stop naming .map files that make pack excludes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Record the behaviour change and clear the superseded report

The hook command string changed in Task 2, so an existing installation reads as stale until the user presses **Update hooks**. At 0.1.0, unreleased, that population is the author alone — but it is a behaviour change, and recording it beats leaving it to be rediscovered.

**Files:**
- Modify: `CHANGELOG.md` (the `[Unreleased]` section)
- Delete: `ego-readiness-review-2026-08-11.md` (untracked, repo root of the main checkout)

**Interfaces:**
- Consumes: the `gjs -m` change from Task 2.
- Produces: nothing.

- [ ] **Step 1: Add the Changed entry**

`CHANGELOG.md` has `## [Unreleased]` at line 9, followed by a note and an `### Added` section at line 13. Insert a `### Changed` section immediately before `### Added`:

```markdown
### Changed

- Hooks are now installed as `gjs -m <path> …` rather than as a bare path to
  `hooks/dasbo-hook`. Nothing in the tree ever set that file's executable bit —
  it survived packaging by luck — and a dropped mode made every hook fail
  silently. If you installed hooks before this change, preferences shows them
  as out of date and **Update hooks** rewrites them.
```

- [ ] **Step 2: Verify the section renders in the right place**

Run: `sed -n '1,30p' /home/fsevenm/projects/dasbo-island-dis-15/CHANGELOG.md`
Expected: `### Changed` appears under `## [Unreleased]` and above `### Added`, with the existing `Nothing has been tagged yet` note still directly under the `[Unreleased]` heading.

- [ ] **Step 3: Run the docs tests that read the changelog**

Run: `npx vitest run test/docs/`

Expected: PASS. Two tests read `CHANGELOG.md` and neither conflicts with a new
`### Changed` section — `communityFiles.test.ts:11` only requires the strings
`Keep a Changelog` and `[Unreleased]` to be present, and
`communityFiles.test.ts:30` asserts no `## [x.y.z]` release heading exists. The
entry above adds no heading of that form and no links, so `links.test.ts` is
unaffected too.

- [ ] **Step 4: Delete the superseded review file**

```bash
rm -f /home/fsevenm/projects/dasbo-island/ego-readiness-review-2026-08-11.md
```

This is rev1, left untracked in the main checkout by an earlier run and superseded by the rev2 attached to DIS-14. It was never committed, so this removes nothing from history.

- [ ] **Step 5: Run the full suite**

Run: `npm test && npm run typecheck`
Expected: PASS, 878 tests, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git -C /home/fsevenm/projects/dasbo-island-dis-15 add CHANGELOG.md
git -C /home/fsevenm/projects/dasbo-island-dis-15 commit -m "docs(changelog): record the hook command change

Installing through gjs -m changes the command string, so an existing
install reads as stale until Update hooks rewrites it. One user at 0.1.0,
but a behaviour change is a behaviour change.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Merge and clean up

**Files:** none — git operations only.

**Interfaces:**
- Consumes: all four commits from Tasks 1-4, plus the spec commit `b2faf6c`.
- Produces: the work on `main`, no worktree, no branch.

- [ ] **Step 1: Confirm the branch is green and complete**

```bash
git -C /home/fsevenm/projects/dasbo-island-dis-15 log --oneline main..dis-15-ego-readiness
git -C /home/fsevenm/projects/dasbo-island-dis-15 status --short
```

Expected: five commits (spec, metadata, install, build, changelog). A clean status apart from the gitignored zip.

- [ ] **Step 2: Run the full verification one last time**

Run: `npm test && npm run typecheck`
Expected: PASS, 878 tests across 63 files, typecheck exits 0.

Do not proceed on a failure, and do not report success without having seen this output.

- [ ] **Step 3: Merge to `main`**

```bash
git -C /home/fsevenm/projects/dasbo-island merge --no-ff dis-15-ego-readiness -m "Merge: extensions.gnome.org readiness fixes from the DIS-14 review

Closes B2, B3, H1, H2, M1, M2 and M3. B1 (shell-version 46) stays open and
needs a GNOME 48+ machine; M6 landed with the DIS-7 merge; M4 and M5 need
no action.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Remove the worktree and delete the branch**

```bash
git -C /home/fsevenm/projects/dasbo-island worktree remove /home/fsevenm/projects/dasbo-island-dis-15
git -C /home/fsevenm/projects/dasbo-island branch -d dis-15-ego-readiness
git -C /home/fsevenm/projects/dasbo-island worktree list
```

Expected: `worktree list` shows only the main checkout, and `branch -d` succeeds without a `-D` force (which would mean the merge did not take).

- [ ] **Step 5: Re-pack in the main checkout**

The archive lived in the worktree and went with it. Rebuild the one you would actually upload:

```bash
make -C /home/fsevenm/projects/dasbo-island pack
unzip -l "/home/fsevenm/projects/dasbo-island/dasbo-island@ayubaswad.gmail.com.shell-extension.zip"
```

Expected: `verified`, and a listing containing `icons/*.svg` and `assets/qr-code.png`.

---

## Verification Summary

| Finding | Task | Evidence it is closed |
|---|---|---|
| B2 `session-modes` | 1 | `metadata` has no `session-modes` property, test-enforced |
| H1 config-file disclosure | 1 | Description names all three paths, the button, the backup and the GJS script, test-enforced |
| M1 vendor affiliation | 1 | Disclaimer line present, test-enforced |
| H2 executable bit | 2 | Command is `gjs -m …` for all three agents; migration reads as `stale` and does not duplicate |
| B3 stale/incomplete zip | 3 | `make pack` fails unless `icons/` and `assets/` are in the archive; listing read by eye |
| M2 `gschemas.compiled` | 3 | Excluded at zip time, absence test-enforced |
| M3 dangling sourcemap | 3 | `DASBO_PACK=1` builds with `sourcemap: false`; `.map` in the archive is a hard failure |
| B1 `shell-version` | — | **Still open.** Needs a GNOME 48+ environment. Own issue. |
