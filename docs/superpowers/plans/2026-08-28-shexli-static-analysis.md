# Shexli Static Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear every error-severity finding the shexli static analyzer reports against the packed extension, and make running it a repeatable `make analyze` step before submission to extensions.gnome.org.

**Architecture:** Three small source changes — one logging seam, one lazy allocation, one file mode — each guarded by a test that keeps it from regressing. Then a shell script that builds its own pinned virtualenv, extracts the packed archive with modes intact, runs the analyzer and gates on error severity, wired to a `make analyze` target.

**Tech Stack:** TypeScript compiled by esbuild (`build.mjs`), vitest for tests, GNU make for the pack and install targets, plain `bash` + `python3 -m venv` for the analyzer wrapper.

**Spec:** `docs/superpowers/specs/2026-08-28-shexli-static-analysis-design.md`

## Global Constraints

- **`src/core/` must never import `gi://` or `resource://`.** `test/core/purity.test.ts` enforces it. `console` is a global in both GJS and Node, not an import, so `src/core/log.ts` is allowed.
- **Conventional commits**, matching the existing log: `feat(scope): …`, `fix: …`, `docs: …`, `test(scope): …`, `build: …`, `chore: …`.
- **The three existing gates must stay green:** `npm test`, `npm run typecheck`, `node build.mjs`.
- **The repo copy of `hooks/dasbo-hook` keeps mode `755`.** `test/hook/harness.mjs` spawns it directly. Only the copy under `dist/` changes.
- **Warnings are not errors.** `EGO-X-004` and `EGO-L-003` are accepted findings and must still appear in the analyzer output at the end. Do not "fix" them.
- **Two documented shexli facts** the wrapper depends on: it needs `tree-sitter==0.25.2` (the default resolution, 0.26.0, segfaults), and it needs an **absolute** path (a relative one raises `ValueError` out of `pathlib`).
- Work happens on branch `worktree-shexli-static-analysis` in the worktree at `.claude/worktrees/shexli-static-analysis`. All paths below are relative to that directory.

---

### Task 1: The logging seam

**Files:**
- Create: `src/core/log.ts`
- Test: `test/core/log.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `warn(message: string): void` from `src/core/log.ts`. Prefixes `dasbo-island: ` and delegates to `console.warn`. Task 2 replaces all 17 `console.warn` call sites with it.

- [ ] **Step 1: Write the failing test**

Create `test/core/log.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { warn } from '../../src/core/log.js'

afterEach(() => {
  vi.restoreAllMocks()
})

// The prefix lives in one place so a journalctl filter keeps working no
// matter which module raised the line, and so the count of raw console call
// sites in the bundle stays at one — see
// docs/superpowers/specs/2026-08-28-shexli-static-analysis-design.md.
describe('warn', () => {
  it('prefixes the message with the extension name', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warn('the sky fell')
    expect(spy).toHaveBeenCalledWith('dasbo-island: the sky fell')
  })

  it('writes one line per call and swallows nothing', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warn('one')
    warn('two')
    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy).toHaveBeenLastCalledWith('dasbo-island: two')
  })

  it('leaves an already-interpolated message intact', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const e = new Error('boom')
    warn(`teardown step "reaper timer" failed: ${e}`)
    expect(spy).toHaveBeenCalledWith('dasbo-island: teardown step "reaper timer" failed: Error: boom')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/core/log.test.ts`
Expected: FAIL — the suite cannot resolve `../../src/core/log.js`.

- [ ] **Step 3: Write the implementation**

Create `src/core/log.ts`:

```ts
/**
 * The extension's only console call site.
 *
 * Every message this extension logs is an error path — a teardown step that
 * threw, an asset that would not resolve, a payload that would not parse — so
 * nothing here is gated behind a debug flag; there is no chatter to gate.
 * What the single seam buys is the count. `build.mjs` bundles all of `src/`
 * into one `extension.js`, and EGO's "no excessive logging" rule (shexli
 * EGO-A-004) counts ungated console calls per file against a threshold of
 * five. Seventeen scattered calls read as an extension that talks constantly;
 * one function that seventeen callers share reads as what it is.
 *
 * The `dasbo-island: ` prefix lives here rather than at each call site, so a
 * `journalctl` filter keeps working no matter which module raised the line.
 *
 * See docs/superpowers/specs/2026-08-28-shexli-static-analysis-design.md.
 */
export function warn(message: string): void {
  console.warn(`dasbo-island: ${message}`)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/core/log.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Run the purity guard**

Run: `npx vitest run test/core/purity.test.ts`
Expected: PASS — `src/core/log.ts` imports nothing.

- [ ] **Step 6: Commit**

```bash
git add src/core/log.ts test/core/log.test.ts
git commit -m "feat(core): add the single warn() logging seam"
```

---

### Task 2: Route every call site through the seam

**Files:**
- Modify: `src/core/permissions.ts:231`
- Modify: `src/dbus/service.ts:67,92,127,248`
- Modify: `src/extension.ts:160,179`
- Modify: `src/prefs.ts:315`
- Modify: `src/shell/agentIcon.ts:40`
- Modify: `src/shell/gridIcon.ts:171`
- Modify: `src/shell/island.ts:172,554`
- Modify: `src/shell/logoIcon.ts:56`
- Modify: `src/shell/panelPlacement.ts:40`
- Modify: `src/shell/soundPlayer.ts:112`
- Modify: `src/shell/transcriptWatcher.ts:79,123`
- Modify: `CONTRIBUTING.md` — one rule under "Rules worth knowing before you start"
- Test: `test/core/logging.test.ts`

**Interfaces:**
- Consumes: `warn(message: string): void` from `src/core/log.ts` (Task 1).
- Produces: nothing new. After this task no file under `src/` except `src/core/log.ts` contains the string `console.`.

- [ ] **Step 1: Write the failing guard test**

Create `test/core/logging.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

// build.mjs bundles all of src/ into a single extension.js, so every console
// call in the tree counts against the same file's total — and EGO's "no
// excessive logging" rule (shexli EGO-A-004) fails a file with more than five.
// Routing them through src/core/log.ts holds the count at one no matter how
// many error paths get added later. This is the regression guard for that;
// modelled on test/core/purity.test.ts.
describe('logging goes through one seam', () => {
  it('names console nowhere under src/ but core/log.ts', () => {
    const seam = join('src', 'core', 'log.ts')
    const offenders = walk('src')
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => f !== seam)
      .filter((f) => readFileSync(f, 'utf8').includes('console.'))
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/core/logging.test.ts`
Expected: FAIL, listing 11 offender files.

- [ ] **Step 3: Add the import to each of the 11 files**

Append each line below to the end of that file's existing `import` block (after the last line starting with `import`):

| File | Line to add |
|---|---|
| `src/core/permissions.ts` | `import { warn } from './log.js'` |
| `src/dbus/service.ts` | `import { warn } from '../core/log.js'` |
| `src/extension.ts` | `import { warn } from './core/log.js'` |
| `src/prefs.ts` | `import { warn } from './core/log.js'` |
| `src/shell/agentIcon.ts` | `import { warn } from '../core/log.js'` |
| `src/shell/gridIcon.ts` | `import { warn } from '../core/log.js'` |
| `src/shell/island.ts` | `import { warn } from '../core/log.js'` |
| `src/shell/logoIcon.ts` | `import { warn } from '../core/log.js'` |
| `src/shell/panelPlacement.ts` | `import { warn } from '../core/log.js'` |
| `src/shell/soundPlayer.ts` | `import { warn } from '../core/log.js'` |
| `src/shell/transcriptWatcher.ts` | `import { warn } from '../core/log.js'` |

- [ ] **Step 4: Replace all 17 call sites**

Each replacement drops `console.` and the hand-written `dasbo-island: ` prefix. Nothing else about the message changes, so existing journal output is byte-identical.

| File | Old | New |
|---|---|---|
| `src/core/permissions.ts` | ``console.warn(`dasbo-island: permission resolve callback for ${id} threw: ${e}`)`` | ``warn(`permission resolve callback for ${id} threw: ${e}`)`` |
| `src/dbus/service.ts` | ``console.warn(`dasbo-island: could not own ${BUS_NAME}; another instance may be running`)`` | ``warn(`could not own ${BUS_NAME}; another instance may be running`)`` |
| `src/dbus/service.ts` | ``console.warn(`dasbo-island: unparseable payload from ${agent}`)`` | ``warn(`unparseable payload from ${agent}`)`` |
| `src/dbus/service.ts` | ``console.warn(`dasbo-island: onNotification failed: ${err}`)`` | ``warn(`onNotification failed: ${err}`)`` |
| `src/dbus/service.ts` | ``console.warn(`dasbo-island: RequestPermissionAsync failed: ${e}`)`` | ``warn(`RequestPermissionAsync failed: ${e}`)`` |
| `src/extension.ts` | ``console.warn(`dasbo-island: reaper sweep failed: ${e}`)`` | ``warn(`reaper sweep failed: ${e}`)`` |
| `src/extension.ts` | ``console.warn(`dasbo-island: teardown step "${label}" failed: ${e}`)`` | ``warn(`teardown step "${label}" failed: ${e}`)`` |
| `src/prefs.ts` | ``console.warn(`dasbo-island: ${verb} of ${id} hooks failed: ${e}`)`` | ``warn(`${verb} of ${id} hooks failed: ${e}`)`` |
| `src/shell/agentIcon.ts` | ``console.warn(`dasbo-island: resolving the ${agent} mark failed: ${e}`)`` | ``warn(`resolving the ${agent} mark failed: ${e}`)`` |
| `src/shell/gridIcon.ts` | ``console.warn(`dasbo-island: grid repaint failed, disabled: ${e}`)`` | ``warn(`grid repaint failed, disabled: ${e}`)`` |
| `src/shell/island.ts` | ``console.warn(`dasbo-island: opening preferences failed: ${e}`)`` | ``warn(`opening preferences failed: ${e}`)`` |
| `src/shell/island.ts` | ``console.warn(`dasbo-island: disconnecting a settings handler failed: ${e}`)`` | ``warn(`disconnecting a settings handler failed: ${e}`)`` |
| `src/shell/logoIcon.ts` | ``console.warn(`dasbo-island: resolving the logo failed: ${e}`)`` | ``warn(`resolving the logo failed: ${e}`)`` |
| `src/shell/panelPlacement.ts` | ``console.warn(`dasbo-island: panel box "${box}" is missing; leaving the island where it is`)`` | ``warn(`panel box "${box}" is missing; leaving the island where it is`)`` |
| `src/shell/soundPlayer.ts` | ``console.warn(`dasbo-island: playing a sound failed, staying silent: ${e}`)`` | ``warn(`playing a sound failed, staying silent: ${e}`)`` |
| `src/shell/transcriptWatcher.ts` | ``console.warn(`dasbo-island: releasing a transcript monitor failed: ${e}`)`` | ``warn(`releasing a transcript monitor failed: ${e}`)`` |
| `src/shell/transcriptWatcher.ts` | ``console.warn(`dasbo-island: cannot watch ${path}: ${e}`)`` | ``warn(`cannot watch ${path}: ${e}`)`` |

- [ ] **Step 5: Run the guard and the whole suite**

Run: `npx vitest run test/core/logging.test.ts`
Expected: PASS.

Run: `npm test`
Expected: PASS, no regressions.

Run: `npm run typecheck`
Expected: exit 0, no output from any of the three projects.

- [ ] **Step 6: Verify the bundle actually holds one call site**

```bash
node build.mjs
grep -c 'console\.' dist/extension.js
grep -c 'console\.' dist/prefs.js
```

Expected: `1` and `1`. If either prints more, esbuild inlined the helper — check that `minify` is still `false` in `build.mjs`'s `common` object before changing anything else.

- [ ] **Step 7: Document the rule in CONTRIBUTING.md**

In `CONTRIBUTING.md`, under `## Rules worth knowing before you start`, add this paragraph immediately after the `**Documentation is tested too.**` paragraph (the last one in that section, ending `A restructure that drops a warning fails the suite.`):

```markdown
**Log through `warn()` from `src/core/log.ts`, never `console` directly.**
`build.mjs` bundles all of `src/` into one `extension.js`, so every scattered
`console.warn` counts against the same file's total — which is exactly what
EGO's "no excessive logging" rule measures. One seam holds that count at one.
`test/core/logging.test.ts` enforces it and will fail your build.
```

- [ ] **Step 8: Run the docs tests**

Run: `npx vitest run test/docs/`
Expected: PASS — `communityFiles.test.ts` still finds every needle it requires in `CONTRIBUTING.md`, and `links.test.ts` finds no broken relative link.

- [ ] **Step 9: Commit**

```bash
git add src test/core/logging.test.ts CONTRIBUTING.md
git commit -m "refactor: route every log line through core/log.ts"
```

---

### Task 3: Lazy `sessionWindows` and the sharpened sync-IO comment

**Files:**
- Modify: `src/shell/windowFinder.ts:9-17` (comment), `:67` (allocation), `:102-108` (prune and forget), and the two call sites at `:97` and `:128`

**Interfaces:**
- Consumes: `chooseWindow<W>(chainPids, windows, pidOf, remembered: W | null): W | null` and `class SessionWindows<W>` from `src/core/windowPick.ts`. Neither changes.
- Produces: no signature changes. `rememberSessionWindow(pid: number): void`, `pruneSessionWindows(): void`, `forgetSessionWindows(): void` and `findWindowForPid(pid: number): Meta.Window | null` all keep their exported shapes, so `src/extension.ts` and `src/dbus/service.ts` are untouched. New module-private `recorded(): SessionWindows<Meta.Window>`.

There is no unit test in this task. `src/shell/windowFinder.ts` imports `gi://GLib`, `gi://Meta` and `resource:///org/gnome/shell/ui/main.js`, so vitest cannot load it — that is the whole reason `src/core/windowPick.ts` exists and is tested separately in `test/core/windowPick.test.ts`. The behaviour here is unchanged; the verification is the typecheck, the existing suite, and the analyzer run in Task 6.

- [ ] **Step 1: Sharpen the `readFile` comment**

In `src/shell/windowFinder.ts`, replace lines 9-17:

```ts
function readFile(path: string): string | null {
  try {
    const [ok, bytes] = GLib.file_get_contents(path)
    if (!ok) return null
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}
```

with:

```ts
/**
 * Read one file synchronously. Every caller in this module passes a path
 * under `/proc`.
 *
 * That is what makes the synchronous call safe, and it is the argument to
 * make when a static analyzer or a reviewer flags it — shexli reports it as
 * EGO-X-004, "avoid synchronous file IO in shell code". The rule exists to
 * stop the compositor blocking on a disk or a network filesystem. `/proc` is
 * neither: it is served from kernel memory, so the read completes without a
 * device in the path. The volume is bounded too — one read per ancestor
 * process, capped at 20 by `ancestorPids` — and it happens on an explicit
 * Jump click or once at session start, never on a timer.
 *
 * Converting this to `load_contents_async` would make `findWindowForPid`
 * asynchronous and take the whole click path with it, to remove reads that
 * cannot block. See
 * docs/superpowers/specs/2026-08-28-shexli-static-analysis-design.md.
 */
function readFile(path: string): string | null {
  try {
    const [ok, bytes] = GLib.file_get_contents(path)
    if (!ok) return null
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Make the allocation lazy**

In the same file, replace line 67:

```ts
const sessionWindows = new SessionWindows<Meta.Window>()
```

with:

```ts
/**
 * Created on first use rather than at module scope, and dropped again at
 * teardown. An allocation that runs when the module is imported happens
 * before `enable()` — shexli reports the module-scope form as EGO-L-001,
 * "extension must not create GObject instances or modify shell before
 * enable()". `SessionWindows` is a plain class from `../core/windowPick.js`
 * and touches nothing in the shell, so nothing was leaking; the shape is
 * still worth avoiding, because it is the shape a reviewer greps for.
 */
let sessionWindows: SessionWindows<Meta.Window> | null = null

/**
 * Not named `windows()`: `findWindowForPid` below has a local
 * `const windows: Meta.Window[]` that would shadow it.
 */
function recorded(): SessionWindows<Meta.Window> {
  sessionWindows ??= new SessionWindows<Meta.Window>()
  return sessionWindows
}
```

- [ ] **Step 3: Route the four uses through the accessor**

Four replacements in the same file. The two inside `rememberSessionWindow`:

```ts
  sessionWindows.prune(pidAlive)
  sessionWindows.remember(pid, win)
```

becomes:

```ts
  recorded().prune(pidAlive)
  recorded().remember(pid, win)
```

`pruneSessionWindows`:

```ts
export function pruneSessionWindows(): void {
  sessionWindows.prune(pidAlive)
}
```

becomes:

```ts
export function pruneSessionWindows(): void {
  // Nothing to prune before the first session is recorded, and the reaper
  // runs on a 1s timer from the moment enable() returns.
  sessionWindows?.prune(pidAlive)
}
```

`forgetSessionWindows`:

```ts
export function forgetSessionWindows(): void {
  sessionWindows.clear()
}
```

becomes:

```ts
export function forgetSessionWindows(): void {
  // Dropping the map rather than clearing it also releases the Meta.Window
  // references it held, which is the point of calling this at teardown.
  // SessionWindows.clear() stays where it is: it belongs to the generic
  // container in ../core/windowPick.js, and test/core/windowPick.test.ts
  // covers it there.
  sessionWindows = null
}
```

And the one inside `findWindowForPid`:

```ts
  return chooseWindow(chain, windows, (w) => w.get_pid(), sessionWindows.recall(pid))
```

becomes:

```ts
  // Read directly rather than through recorded(): a Jump click on a session
  // nothing was ever recorded for should not mint a map to find it empty.
  return chooseWindow(chain, windows, (w) => w.get_pid(), sessionWindows?.recall(pid) ?? null)
```

> `chooseWindow` types that fourth parameter `remembered: W | null` (`src/core/windowPick.ts:33`), so the `?? null` is required — `sessionWindows?.recall(pid)` alone widens to `Meta.Window | null | undefined` and fails the typecheck.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exit 0 with no output. A complaint about the fourth argument of `chooseWindow` means the `?? null` was dropped from the `findWindowForPid` line.

- [ ] **Step 5: Run the suite and the build**

Run: `npm test`
Expected: PASS.

Run: `node build.mjs`
Expected: `built dist/ and dist-site/`.

- [ ] **Step 6: Commit**

```bash
git add src/shell/windowFinder.ts
git commit -m "refactor(shell): create sessionWindows on first use, not at import"
```

---

### Task 4: The packaged hook ships non-executable

**Files:**
- Modify: `build.mjs` — the `node:fs/promises` import and the `hooks` copy block
- Modify: `tools/verify-pack.mjs` — new `checkModes()`, new `longListingOf()`, one line in the CLI block
- Test: `test/tools/verifyPack.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `checkModes(listing: string): string[]` exported from `tools/verify-pack.mjs`, taking `unzip -Z` long-format output and returning one message per file entry shipping an executable bit. Directory entries are exempt.

- [ ] **Step 1: Write the failing test**

Append to `test/tools/verifyPack.test.ts`, and add `checkModes` to the import on line 2 so it reads:

```ts
import { checkEntries, checkBundleText, checkModes } from '../../tools/verify-pack.mjs'
```

Then append this block at the end of the file:

```ts
// EGO-P-005 reads any packaged file that is executable and has neither a .js
// nor a .sh suffix as a bundled binary — an error-severity finding, the only
// one this archive can carry. hooks/dasbo-hook is an extensionless GJS
// script, so it trips that rule the moment it ships 755. Nothing execs the
// packaged copy: preferences writes every hook command as `gjs -m <path>`
// (src/core/install/plan.ts), and make install chmods the installed copy.
// build.mjs drops the bit; this is what stops an edit there from putting it
// back unnoticed.
const LISTING = [
  'Archive:  dasbo-island@ayubaswad.gmail.com.shell-extension.zip',
  'Zip file size: 159135 bytes, number of entries: 16',
  '-rw-rw-r--  3.0 unx      934 tx defN 26-Aug-28 09:28 metadata.json',
  '-rw-rw-r--  3.0 unx   134571 tx defN 26-Aug-28 09:28 extension.js',
  'drwxrwxr-x  3.0 unx        0 bx stor 26-Aug-28 09:28 hooks/',
  '-rw-rw-r--  3.0 unx     3443 tx defN 26-Aug-28 09:28 hooks/dasbo-hook',
  '16 files, 296481 bytes uncompressed, 156545 bytes compressed:  47.2%',
].join('\n')

describe('checkModes', () => {
  it('passes a listing where nothing but the directories is executable', () => {
    expect(checkModes(LISTING)).toEqual([])
  })

  it('rejects the archive that ships an executable hook', () => {
    const executable = LISTING.replace(
      '-rw-rw-r--  3.0 unx     3443 tx defN 26-Aug-28 09:28 hooks/dasbo-hook',
      '-rwxrwxr-x  3.0 unx     3443 tx defN 26-Aug-28 09:28 hooks/dasbo-hook'
    )
    expect(checkModes(executable)).toHaveLength(1)
  })

  it('names the offending entry in the message, not just the rule', () => {
    const executable = LISTING.replace('-rw-rw-r--  3.0 unx     3443', '-rwxrwxr-x  3.0 unx     3443')
    expect(checkModes(executable)[0]).toContain('hooks/dasbo-hook')
  })

  // A directory with no execute bit cannot be entered, so every archive has
  // them and a rule that flagged them would fire on every pack forever.
  it('exempts directory entries, which must be executable to be traversable', () => {
    const dirsOnly = [
      'drwxrwxr-x  3.0 unx        0 bx stor 26-Aug-28 09:28 hooks/',
      'drwxrwxr-x  3.0 unx        0 bx stor 26-Aug-28 09:28 icons/',
    ].join('\n')
    expect(checkModes(dirsOnly)).toEqual([])
  })

  // The header and the summary line are not entries. Parsing them as one
  // would either crash or invent a finding with a nonsense filename.
  it('ignores the header and summary lines unzip -Z wraps the listing in', () => {
    const noEntries = [
      'Archive:  dasbo-island@ayubaswad.gmail.com.shell-extension.zip',
      'Zip file size: 159135 bytes, number of entries: 16',
      '16 files, 296481 bytes uncompressed, 156545 bytes compressed:  47.2%',
    ].join('\n')
    expect(checkModes(noEntries)).toEqual([])
  })

  it('reports every executable entry at once, not just the first', () => {
    const two = [
      '-rwxrwxr-x  3.0 unx     3443 tx defN 26-Aug-28 09:28 hooks/dasbo-hook',
      '-rwxr-xr-x  3.0 unx      120 tx defN 26-Aug-28 09:28 tools/something',
    ].join('\n')
    expect(checkModes(two)).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/tools/verifyPack.test.ts`
Expected: FAIL — `checkModes is not a function`.

- [ ] **Step 3: Implement `checkModes` in `tools/verify-pack.mjs`**

Add this after the `FORBIDDEN` array and before the `checkEntries` JSDoc block:

```js
/**
 * `unzip -Z` long-format entry line. Nine fields: the ten-character mode, the
 * zip version, the source OS, the uncompressed size, the text/binary flag,
 * the compression method, the date, the time, and the name. Everything that
 * does not match — the `Archive:` header, the `Zip file size:` line, the
 * trailing summary — is not an entry and is skipped.
 */
const LONG_LISTING_ENTRY = /^([d-])([rwxsSt-]{9})\s+\S+\s+\S+\s+\d+\s+\S+\s+\S+\s+\S+\s+\S+\s+(.+)$/

/**
 * Refuses an archive that ships an executable file.
 *
 * Nothing in this package is ever run by path: preferences writes every hook
 * command as `gjs -m <path>` (see src/core/install/plan.ts, which says so at
 * length), and the Makefile's install target chmods the installed copy for
 * anyone who wants to run it by hand. Meanwhile an executable file whose
 * suffix is neither `.js` nor `.sh` reads to the extensions.gnome.org static
 * analyzer as a bundled binary — shexli EGO-P-005, error severity, and
 * hooks/dasbo-hook is exactly that shape. build.mjs drops the bit; this
 * catches a build that stops doing so.
 *
 * Directories are exempt: one that is not executable cannot be entered.
 *
 * @param {string} listing `unzip -Z` output for the archive.
 * @returns {string[]} One message per file entry shipping an executable bit.
 */
export function checkModes(listing) {
  const problems = []
  for (const line of listing.split('\n')) {
    const match = LONG_LISTING_ENTRY.exec(line.trimEnd())
    if (match === null) continue
    const [, kind, permissions, name] = match
    if (kind === 'd') continue
    if (permissions.includes('x')) {
      problems.push(
        `must not ship executable: ${name} — an executable file with no .js or .sh suffix reads as a bundled binary to the EGO analyzer, and nothing runs the packaged copy by path`
      )
    }
  }
  return problems
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/tools/verifyPack.test.ts`
Expected: PASS — the existing `checkEntries` and `checkBundleText` suites plus the six new cases.

- [ ] **Step 5: Wire `checkModes` into the CLI**

In `tools/verify-pack.mjs`, add this reader next to the existing `entriesOf`:

```js
/** @param {string} zipPath */
function longListingOf(zipPath) {
  return execFileSync('unzip', ['-Z', zipPath], { encoding: 'utf8' })
}
```

and add one line to the `problems` array in the CLI block, after the `checkEntries(...)` line:

```js
    ...checkModes(longListingOf(zipPath)),
```

- [ ] **Step 6: Write the failing end-to-end check**

Run:

```bash
make pack
```

Expected: FAIL. `verify-pack.mjs` now refuses the archive with
`must not ship executable: hooks/dasbo-hook — …`, because `build.mjs` still
copies the repo's `755` mode straight through. This is the failing state the
next step fixes.

- [ ] **Step 7: Drop the bit in `build.mjs`**

Change the `node:fs/promises` import on line 3 to add `chmod`:

```js
import { chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
```

and replace the hooks copy block:

```js
if (existsSync('hooks')) {
  await cp('hooks', 'dist/hooks', { recursive: true })
}
```

with:

```js
if (existsSync('hooks')) {
  await cp('hooks', 'dist/hooks', { recursive: true })
  // The repo copy stays 755 — test/hook/harness.mjs spawns it directly — but
  // the packaged one must not be. An executable file with no .js or .sh
  // suffix reads to the extensions.gnome.org static analyzer as a bundled
  // binary (shexli EGO-P-005, error severity). Nothing execs the packaged
  // copy: preferences writes every hook command as `gjs -m <path>` (see
  // src/core/install/plan.ts) and the Makefile's install target chmods the
  // installed copy. tools/verify-pack.mjs refuses an archive that ships
  // this bit, so a change here fails the pack rather than the submission.
  await chmod('dist/hooks/dasbo-hook', 0o644)
}
```

- [ ] **Step 8: Run the pack to verify it passes**

```bash
make pack
unzip -Z dasbo-island@ayubaswad.gmail.com.shell-extension.zip | grep dasbo-hook
```

Expected: `dasbo-island@ayubaswad.gmail.com.shell-extension.zip: verified`, and
the listing line starts `-rw-` for `hooks/dasbo-hook` (the `hooks/` directory
line still starts `drwx`).

- [ ] **Step 9: Confirm the repo copy is untouched**

```bash
ls -l hooks/dasbo-hook
npx vitest run test/hook/
```

Expected: mode `-rwxrwxr-x` on the repo file, and the hook suite passes or
skips exactly as it did before (it is `describe.skipIf`-gated on whether the
machine can run it).

- [ ] **Step 10: Commit**

```bash
git add build.mjs tools/verify-pack.mjs test/tools/verifyPack.test.ts
git commit -m "build: ship hooks/dasbo-hook without its executable bit"
```

---

### Task 5: `make analyze`

**Files:**
- Create: `tools/shexli.sh`
- Modify: `Makefile` — `.PHONY` line and a new `analyze` target
- Modify: `.gitignore` — one line

**Interfaces:**
- Consumes: the archive `make pack` produces at `$(UUID).shell-extension.zip`.
- Produces: `make analyze`, exit 0 when the analyzer reports no error-severity finding, exit 1 when it reports one or more.

This task has no vitest coverage by design: the script needs network access and a Python toolchain, so it cannot run in CI, and a test that never runs is a test that rots. Its verification is running it — Step 5.

- [ ] **Step 1: Write the script**

Create `tools/shexli.sh`:

```bash
#!/usr/bin/env bash
# Runs the Shexli static analyzer over a packed extension archive, the way
# extensions.gnome.org asks submitters to before uploading.
#
# The instructions published on the site are `pip install -U shexli` followed
# by `shexli path_to_zip_or_folder`. Three things they leave out, each of
# which turns the run into a crash or a wrong answer:
#
#   1. shexli 0.2.1 declares tree-sitter>=0.25.0, so a fresh install today
#      resolves to 0.26.0 and every run segfaults inside shexli's own AST
#      walk (shexli/ast.py:34, node_text). Pinning 0.25.2 is what makes the
#      tool run at all; it still satisfies shexli's own constraint. Drop the
#      pin once shexli supports 0.26.
#   2. The path must be absolute. A relative one dies with a pathlib
#      ValueError traceback rather than a diagnostic.
#   3. Pointing it at the zip misses EGO-P-005, the only error-severity rule
#      in play. Python's zipfile drops file modes on extraction, so an
#      executable file inside the archive looks unexecutable to the analyzer.
#      Extracting with unzip first, which restores modes, is what a reviewer
#      effectively does.
#
# shexli exits 0 whether or not it found errors, so the gate at the bottom is
# ours. Errors fail; warnings do not. Two warnings are carried knowingly --
# see docs/superpowers/specs/2026-08-28-shexli-static-analysis-design.md.
set -euo pipefail

ARCHIVE=${1:-}
if [ -z "$ARCHIVE" ]; then
  echo "usage: tools/shexli.sh <archive.zip>" >&2
  exit 2
fi
if [ ! -f "$ARCHIVE" ]; then
  echo "tools/shexli.sh: no such archive: $ARCHIVE" >&2
  exit 2
fi
ARCHIVE=$(readlink -f "$ARCHIVE")

VENV=.shexli-venv
if [ ! -x "$VENV/bin/shexli" ]; then
  echo "building $VENV (first run only)"
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q -U pip
  "$VENV/bin/pip" install -q -U shexli
  "$VENV/bin/pip" install -q 'tree-sitter==0.25.2'
fi

WORK=$(mktemp -d)
REPORT=$(mktemp)
trap 'rm -rf "$WORK" "$REPORT"' EXIT
unzip -q "$ARCHIVE" -d "$WORK"

"$VENV/bin/shexli" "$WORK"
"$VENV/bin/shexli" --format json "$WORK" >"$REPORT"

"$VENV/bin/python" - "$REPORT" <<'PY'
import json, sys

with open(sys.argv[1]) as handle:
    result = json.load(handle)

counts = result.get("summary", {}).get("severity_counts", {})
errors = counts.get("error", 0)
warnings = counts.get("warning", 0)

if errors:
    print(f"\nshexli: {errors} error-severity finding(s) — not fit to upload", file=sys.stderr)
    sys.exit(1)

print(f"\nshexli: no errors, {warnings} warning(s) — see the spec for which are accepted")
PY
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x tools/shexli.sh
```

- [ ] **Step 3: Add the make target**

In `Makefile`, change the `.PHONY` line from:

```make
.PHONY: build install uninstall schemas test typecheck clean pack
```

to:

```make
.PHONY: build install uninstall schemas test typecheck clean pack analyze
```

and append this target at the end of the file:

```make
analyze: pack
	tools/shexli.sh $(UUID).shell-extension.zip
```

- [ ] **Step 4: Ignore the virtualenv**

Add one line to `.gitignore`, after `node_modules/`:

```
.shexli-venv/
```

- [ ] **Step 5: Run it**

```bash
make analyze
```

Expected on the first run: a `building .shexli-venv (first run only)` line,
then the text report, then
`shexli: no errors, 2 warning(s) — see the spec for which are accepted`,
and exit 0. The two warnings must be `EGO-X-004` and `EGO-L-003`.

If `EGO-A-004`, `EGO-L-001` or `EGO-P-005` still appears, the corresponding
task above did not take effect — go back to it rather than adjusting the
script.

- [ ] **Step 6: Verify the gate actually gates**

A gate nobody has seen fail is not known to work. Put the mode back by hand on
an extracted copy and confirm the analyzer calls it an error:

```bash
WORK=$(mktemp -d)
unzip -q dasbo-island@ayubaswad.gmail.com.shell-extension.zip -d "$WORK"
chmod +x "$WORK/hooks/dasbo-hook"
.shexli-venv/bin/shexli "$WORK" | head -3
rm -rf "$WORK"
```

Expected first line: `shexli: issues_found (5 findings, 1 errors, 4 warnings)`
— proof both that the mode is what the error hangs on, and that an extracted
tree is the only input that can see it.

Do not try to test the gate by reverting `build.mjs`: `tools/verify-pack.mjs`
would refuse the archive first, so `make analyze` would never reach the
analyzer.

- [ ] **Step 7: Commit**

```bash
git add tools/shexli.sh Makefile .gitignore
git commit -m "build: add make analyze, the pre-submission shexli run"
```

---

### Task 6: Documentation and the final verification run

**Files:**
- Modify: `CONTRIBUTING.md` — a new section after `## The gates`
- Modify: `CHANGELOG.md` — one bullet under `[Unreleased]` → `### Changed` (line 33)

**Interfaces:**
- Consumes: `make analyze` (Task 5), and the accepted-finding reasoning from Tasks 3 and 4.
- Produces: nothing code depends on.

- [ ] **Step 1: Add the submission section to CONTRIBUTING.md**

Insert this between the end of `## The gates` (the paragraph ending
`lists what else is worth checking before you open one.`) and the
`## Rules worth knowing before you start` heading:

````markdown
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
````

- [ ] **Step 2: Add the changelog entry**

In `CHANGELOG.md`, under the first `### Changed` heading (line 33, inside
`## [Unreleased]`), add this as the **first** bullet, above the
`- Supported GNOME Shell versions widen…` entry:

```markdown
- The packaged `hooks/dasbo-hook` now ships without its executable bit.
  Nothing changes for a hook entry preferences wrote: those invoke the file
  as `gjs -m <path>`, and `make install` still marks the installed copy
  executable. An executable file with no `.js` or `.sh` suffix reads to the
  extensions.gnome.org static analyzer as a bundled binary.
```

- [ ] **Step 3: Run the docs tests**

Run: `npx vitest run test/docs/`
Expected: PASS. `links.test.ts` resolves the new relative link to the spec
document; `communityFiles.test.ts` still finds `npm test`,
`npm run typecheck`, `gi://` and `docs/agent-dialects.md` in `CONTRIBUTING.md`,
and still finds `Keep a Changelog` and `[Unreleased]` in `CHANGELOG.md`.

- [ ] **Step 4: Run every gate**

```bash
npm test
npm run typecheck
node build.mjs
```

Expected: all three pass, in that order, with no failures.

- [ ] **Step 5: Run the analyzer one final time**

```bash
make analyze
```

Expected: the text report, then
`shexli: no errors, 2 warning(s) — see the spec for which are accepted`,
exit 0. Copy the summary line and the two rule IDs into the final report —
they are the evidence the task is done.

- [ ] **Step 6: Commit**

```bash
git add CONTRIBUTING.md CHANGELOG.md
git commit -m "docs: record the pre-submission analyzer run and its accepted warnings"
```

---

## Done when

- `make analyze` reports **0 errors and 2 warnings** — `EGO-X-004` and `EGO-L-003` — and exits 0.
- `npm test`, `npm run typecheck` and `node build.mjs` all pass.
- `make pack` passes `tools/verify-pack.mjs` including the new mode check.
- `unzip -Z` on the archive shows `hooks/dasbo-hook` with no execute bit, and `ls -l hooks/dasbo-hook` in the repo still shows `755`.
- `grep -c 'console\.' dist/extension.js` prints `1`.
