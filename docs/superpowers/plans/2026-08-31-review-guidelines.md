# Review-Guideline Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three GNOME best-practice deviations that are worth closing, and state in the README which three the extension keeps and why it will therefore not be on extensions.gnome.org.

**Architecture:** Five independent commits. Tasks 1–3 change shell-side code and the tests that pin it; Task 4 changes the README and its tests; Task 5 records all of it in the changelog. Nothing changes at runtime except the order of steps inside `disable()`, and that reorder is the whole point of Task 2: it makes a teardown chime unreachable rather than suppressed by a flag.

**Tech Stack:** TypeScript bundled by esbuild through `build.mjs`, vitest for tests, GNU Make for packaging. Tests are source-text assertions — this suite cannot execute GJS, because `src/extension.ts` imports `gi://GLib` and `resource:///org/gnome/shell/...` and vitest cannot resolve either.

**Spec:** `docs/superpowers/specs/2026-08-31-review-guidelines-design.md`

## Global Constraints

- Working directory is the worktree `/home/fsevenm/projects/dasbo-island-dis-31`, branch `dis-31-review-guidelines`. **The shell's startup profile errors on `cd` in this environment (`ERROR: GVM_ROOT not set`).** Run commands as `sh -c 'cd /home/fsevenm/projects/dasbo-island-dis-31 && <command>'`, and use `git -C /home/fsevenm/projects/dasbo-island-dis-31` for git.
- Baseline that must stay green throughout: **951 tests across 68 files** (`npm test`), and `npm run typecheck` clean across all three tsconfigs. Tasks 2 and 4 change the test count; each says by how much.
- `src/core/` must never import `gi://` or `resource://`. `test/core/purity.test.ts` enforces this. None of these tasks touch `src/core/`.
- `console.` may appear nowhere under `src/` but `src/core/log.ts`. `test/core/logging.test.ts` enforces this. Every file these tasks touch keeps at least one `warn()` caller, so no import becomes unused: `src/shell/island.ts:173`, `src/shell/transcriptWatcher.ts:124`, `src/extension.ts:161`.
- Commit messages are lowercase, conventional-commit prefixed, and end with the `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` trailer. No em dashes in prose the project ships (`test/core/apostrophes.test.ts` and the CONTRIBUTING guide cover the house style).
- Do not touch `build.mjs`, `Makefile`, `site/`, or `metadata.json`. Unbundling `dist/`, replacing the hook script, and moving the `/proc` reads behind D-Bus are explicitly out of scope — they are the three reasons Task 4 documents.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/shell/island.ts` | Drop the dead catch around `Gio.Settings.disconnect()`; tighten the `destroy` signal comment. | 1, 3 |
| `src/shell/transcriptWatcher.ts` | Drop the dead catch around `monitor.disconnect()` / `monitor.cancel()`. | 1 |
| `src/extension.ts` | Straight-line `disable()`: no `safely()` wrapper, island destroyed before the permission drain. | 2 |
| `src/shell/soundPlayer.ts` | Lose `_destroyed`, `markDestroyed()` and the `play()` guard. | 2 |
| `src/shell/gridIcon.ts` | Gain a `destroy()` override beside the existing `destroy` signal. | 3 |
| `test/shell/teardown.test.ts` | **New.** Pins the shape of `disable()` and the two dual-path widget teardowns. | 2, 3 |
| `test/shell/sound.test.ts` | Five assertions retargeted off the removed flag. | 2 |
| `README.md` | New "Why it is not on extensions.gnome.org" section; Install gains the release-zip route. | 4 |
| `test/docs/readme.test.ts` | Pins the new section, the Contents entry, and both install routes. | 4 |
| `CHANGELOG.md` | Records the lot under Unreleased. | 5 |

---

## Task 1: Drop the two dead catches

Best practices #3: do not wrap calls that cannot throw. `Gio.Settings.disconnect()`, `GObject.disconnect()` and `Gio.FileMonitor.cancel()` all report failure through GLib warnings and a return, not through a JavaScript exception.

**Files:**
- Modify: `src/shell/island.ts:545-559`
- Modify: `src/shell/transcriptWatcher.ts:71-82`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. `_releaseExternalRefs()` and `_stop(key)` keep their signatures (`(): void` and `(key: string): void`).

- [ ] **Step 1: Replace the `island.ts` disconnect loop**

Find this in `src/shell/island.ts` (it opens `_releaseExternalRefs`):

```ts
  private _releaseExternalRefs(): void {
    // Each disconnect isolated in its own try/catch, unlike extension.ts's
    // _settingsIds teardown (which wraps the whole loop and accepts that a
    // throw skips whatever ids follow it): here a bad id must not strand
    // the remaining connections, since one of them is the chip-display
    // handler that keeps live rows in sync with the setting.
    for (const id of this._settingsChangedIds) {
      try {
        this._settings.disconnect(id)
      } catch (e) {
        warn(`disconnecting a settings handler failed: ${e}`)
      }
    }
    this._settingsChangedIds = []
```

Replace with:

```ts
  private _releaseExternalRefs(): void {
    // No try/catch: Gio.Settings.disconnect() does not throw. An id that is
    // already gone raises a GLib warning and returns, so the wrapper this
    // replaces was guarding against nothing — GNOME best practices #3.
    for (const id of this._settingsChangedIds) this._settings.disconnect(id)
    this._settingsChangedIds = []
```

Leave the rest of the method exactly as it is. The `warn` import stays: `island.ts:173` still calls it.

- [ ] **Step 2: Replace the `transcriptWatcher.ts` stop body**

Find this in `src/shell/transcriptWatcher.ts`:

```ts
    watch.cancellable.cancel()
    try {
      watch.monitor.disconnect(watch.changedId)
      watch.monitor.cancel()
    } catch (e) {
      warn(`releasing a transcript monitor failed: ${e}`)
    }
  }
```

Replace with:

```ts
    watch.cancellable.cancel()
    // No try/catch: neither GObject.disconnect() nor Gio.FileMonitor.cancel()
    // throws, and cancel() on a monitor already cancelled is a no-op — GNOME
    // best practices #3.
    watch.monitor.disconnect(watch.changedId)
    watch.monitor.cancel()
  }
```

The `warn` import stays: `transcriptWatcher.ts:124` still calls it.

- [ ] **Step 3: Run the suite and the typechecker**

```bash
sh -c 'cd /home/fsevenm/projects/dasbo-island-dis-31 && npm test && npm run typecheck'
```

Expected: `Test Files 68 passed (68)`, `Tests 951 passed (951)`, and typecheck exiting 0 with no output after the three `tsc` lines. No test asserted on either catch, so the count is unchanged.

- [ ] **Step 4: Commit**

```bash
git -C /home/fsevenm/projects/dasbo-island-dis-31 add src/shell/island.ts src/shell/transcriptWatcher.ts
git -C /home/fsevenm/projects/dasbo-island-dis-31 commit -m "refactor: stop wrapping disconnects that cannot throw

Gio.Settings.disconnect, GObject.disconnect and Gio.FileMonitor.cancel report
failure through GLib warnings, not exceptions, so both catches were dead code.
GNOME extension best practices #3.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Straight-line `disable()`, and delete the sound player's destroyed flag

Best practices #3 and #5. `disable()` wraps nine steps in a `safely()` try/catch that guards nothing, and `SoundPlayer` carries a `_destroyed` flag whose only job is to silence a chime that the teardown order makes reachable. Reordering removes the need for both.

**Files:**
- Modify: `src/extension.ts:171-254` (the whole `disable()` body)
- Modify: `src/shell/soundPlayer.ts` (remove `_destroyed`, `markDestroyed()`, the `play()` guard)
- Create: `test/shell/teardown.test.ts`
- Modify: `test/shell/sound.test.ts` (five assertions)

**Interfaces:**
- Consumes: `PermissionTable.resolveAllFallthrough(): void`, `Island.destroy(): void`, `SoundPlayer.destroy(): void`, `IslandService.unexport(): void`, `TranscriptWatcher.destroy(): void`, `forgetSessionWindows(): void` — all unchanged.
- Produces: `SoundPlayer` loses `markDestroyed(): void` from its public surface. `src/extension.ts` is its only caller, and this task removes that call. Task 3 relies on nothing here.

- [ ] **Step 1: Write the failing test file**

Create `test/shell/teardown.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// The suite cannot execute any of this: src/extension.ts imports gi://GLib and
// resource:///org/gnome/shell/..., neither of which vitest can resolve. So the
// shape of disable() is asserted against the source as text, the same way
// test/shell/sound.test.ts already reads it.
const extension = readFileSync('src/extension.ts', 'utf8')
const disable = extension.slice(extension.indexOf('disable() {'))

describe('disable()', () => {
  it('wraps nothing in try/catch, because none of its steps throw', () => {
    // GNOME best practices #3. GLib.Source.remove, unexport(), destroy() and
    // forgetSessionWindows() do not throw, and resolveAllFallthrough() already
    // catches per consumer callback in core/permissions.ts. The wrapper this
    // replaces only hid the teardown order it was written to protect.
    expect(disable).not.toContain('try {')
    expect(extension).not.toContain('const safely =')
  })

  it('destroys the island before it drains held permissions', () => {
    // Draining settles held requests, a settled request can produce a 'done'
    // diff, and Island.refresh() answers that with play('done') — so an island
    // still listening at that point makes the extension chime on its way out.
    // Destroying it first drops the store subscription and the tick timer,
    // which makes that path unreachable instead of suppressed by a flag.
    expect(disable.indexOf('this._island?.destroy()')).toBeLessThan(
      disable.indexOf('this._permissions?.resolveAllFallthrough()')
    )
  })

  it('tears down in the order the rest of the file assumes', () => {
    const at = (needle: string) => {
      const i = disable.indexOf(needle)
      expect(i, `disable() lost ${needle}`).toBeGreaterThan(-1)
      return i
    }
    const order = [
      'GLib.Source.remove(this._reaperId)',
      'this._service?.unexport()',
      'this._transcripts?.destroy()',
      'forgetSessionWindows()',
      'this._island?.destroy()',
      'this._permissions?.resolveAllFallthrough()',
      'this._sound?.destroy()',
      'this._settingsIds',
    ]
    for (let i = 1; i < order.length; i++) {
      const previous = order[i - 1] as string
      const next = order[i] as string
      expect(at(previous), `${previous} must come before ${next}`).toBeLessThan(at(next))
    }
  })

  it('releases every field enable() sets', () => {
    // The count is the point: a step deleted during a refactor is invisible
    // until the next enable() adds a second panel button.
    for (const field of [
      '_island',
      '_store',
      '_permissions',
      '_service',
      '_settings',
      '_sound',
      '_transcripts',
      '_unwatchStore',
    ]) {
      expect(disable, `disable() never nulls ${field}`).toContain(`this.${field} = null`)
    }
    expect(disable).toContain('this._reaperId = 0')
    expect(disable).toContain('this._settingsIds = []')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
sh -c 'cd /home/fsevenm/projects/dasbo-island-dis-31 && npx vitest run test/shell/teardown.test.ts'
```

Expected: FAIL. The first test fails on `expect(disable).not.toContain('try {')` because `safely()` is still there; the second fails because `this._island?.destroy()` currently sits inside a `safely('island', …)` call and after the drain.

- [ ] **Step 3: Rewrite `disable()`**

In `src/extension.ts`, replace the entire body of `disable()` — everything from `disable() {` to the closing brace before the final `}` of the class — with:

```ts
  disable() {
    if (this._reaperId) {
      GLib.Source.remove(this._reaperId)
      this._reaperId = 0
    }

    this._service?.unexport()
    this._service = null

    this._unwatchStore?.()
    this._unwatchStore = null
    this._transcripts?.destroy()
    this._transcripts = null

    // Module state, not the extension object's: it would otherwise survive a
    // disable() holding Meta.Window references for a shell that has since torn
    // them down.
    forgetSessionWindows()

    // Ahead of the permission drain below, not after it. Draining settles held
    // requests, a settled request can produce a 'done' diff, and
    // Island.refresh() answers that with play('done') — so an island still
    // subscribed at that moment chimes on the way out. Destroying it first
    // drops the store subscription and the tick timer, which makes that path
    // unreachable. Agents still get their fall-through answers; they arrive one
    // step later.
    this._island?.destroy()
    this._island = null

    this._permissions?.resolveAllFallthrough()
    this._permissions = null

    // After the island, which is the only thing that calls play().
    this._sound?.destroy()
    this._sound = null

    this._store = null

    for (const id of this._settingsIds) this._settings?.disconnect(id)
    this._settingsIds = []
    this._settings = null
  }
```

The `safely` helper and its comment go with it. `enable()` is untouched, including its reaper `try`/`catch` — that one guards a callback that builds St widgets, and an exception escaping a GLib source callback removes the source permanently.

- [ ] **Step 4: Strip the destroyed flag out of `SoundPlayer`**

In `src/shell/soundPlayer.ts`, delete the `_destroyed` field together with its doc comment:

```ts
  /**
   * Set by destroy(), checked first in play(). disable() resolves any pending
   * permissions before it destroys the island (see extension.ts's teardown
   * comment for why that order is not to be changed), and settling a held
   * permission through clearPending can reach a 'done' diff and therefore
   * play('done') — this flag is what keeps that reachable-during-teardown
   * path from chiming on the way out, without reordering anything.
   */
  private _destroyed = false
```

Delete `markDestroyed()` entirely, comment and all:

```ts
  /**
   * Sets the destroyed flag without releasing `_last`/`_desktop`. Exists so
   * `disable()` can silence the player before `resolveAllFallthrough()` runs
   * — that call can settle a held permission into 'done' and reach
   * `play('done')` through `Island.refresh()` while the island itself is
   * still alive, and the teardown order that makes that reachable is not to
   * be changed (see extension.ts). `destroy()` still runs later, in its
   * usual place, to release the rest; this only pulls the "go silent" bit of
   * it forward.
   */
  markDestroyed(): void {
    this._destroyed = true
  }
```

Delete the first line of `play()` so it opens on the schema check:

```ts
  play(cue: SoundCue): void {
    if (!this._hasNotificationSoundsKey) return
```

And reduce `destroy()` to its real work:

```ts
  destroy(): void {
    this._last.clear()
    this._desktop = null
  }
```

- [ ] **Step 5: Retarget the five assertions in `test/shell/sound.test.ts`**

Delete this test outright — the flag it names is gone:

```ts
  it('checks destroyed as the very first thing play() does', () => {
    const play = src.slice(src.indexOf('play(cue: SoundCue): void {'))
    const firstStatement = play.slice(play.indexOf('{') + 1).trimStart()
    expect(firstStatement.startsWith('if (this._destroyed) return')).toBe(true)
  })
```

Delete this one too. It guarded a `play()` reached after `destroy()`, which best practices #5 says should not be reachable at all rather than guarded:

```ts
  it('destroy() cannot un-skip a post-destroy play() by nulling the desktop settings', () => {
    // Minor finding from the review: destroy() sets _desktop = null, which
    // used to make a post-destroy play() *skip* the event-sounds check and
    // still try to play. The _destroyed early return closes that regardless
    // of what destroy() does to _desktop afterwards.
    const destroy = src.slice(src.indexOf('destroy(): void'))
    expect(destroy.indexOf('_destroyed = true')).toBeLessThan(destroy.indexOf('_desktop = null'))
  })
```

In its place, inside the same `describe('SoundPlayer')` block, add:

```ts
  it('carries no destroyed flag, because the teardown order removed the need', () => {
    // GNOME best practices #5: after destroy(), an instance should be
    // unreachable rather than flagged. extension.ts destroys the island before
    // it drains permissions, which is what closed the reachable path — pinned
    // in test/shell/teardown.test.ts.
    expect(src).not.toContain('_destroyed')
    const offenders = walk('src').filter((f) => readFileSync(f, 'utf8').includes('markDestroyed'))
    expect(offenders).toEqual([])
  })
```

Fix the slice boundary in the constructor test, which currently ends at the deleted method:

```ts
    const ctor = src.slice(src.indexOf('constructor('), src.indexOf('play(cue'))
```

Replace this test, which names the deleted wrapper:

```ts
  it('destroys the player during teardown, inside the safely wrapper', () => {
    // Every other teardown step is wrapped so one throw cannot skip the rest.
    expect(extension).toMatch(/safely\('sound player',[\s\S]*?_sound\?\.destroy\(\)/)
    expect(extension).toMatch(/this\._sound = null/)
  })
```

with:

```ts
  it('destroys the player during teardown, after the island that plays through it', () => {
    expect(extension).toContain('this._sound?.destroy()')
    expect(extension).toContain('this._sound = null')
    expect(extension.indexOf('this._island?.destroy()')).toBeLessThan(
      extension.indexOf('this._sound?.destroy()')
    )
  })
```

And replace this one:

```ts
  it('marks the player destroyed before resolveAllFallthrough can settle a held permission to done', () => {
    // resolveAllFallthrough() can reach Island.refresh() -> play('done')
    // through clearPending while the island is still alive — its own
    // teardown step has not run yet — so disable() must silence the player
    // before that call, not only destroy it afterward alongside the island.
    expect(extension.indexOf('_sound?.markDestroyed()')).toBeLessThan(
      extension.indexOf('resolveAllFallthrough()')
    )
  })
```

with:

```ts
  it('destroys the island before resolveAllFallthrough can settle a held permission to done', () => {
    // resolveAllFallthrough() can reach Island.refresh() -> play('done')
    // through clearPending. Silencing the player with a flag was one way to
    // stop that; destroying the island first is the other, and it leaves
    // nothing to flag.
    expect(extension.indexOf('this._island?.destroy()')).toBeLessThan(
      extension.indexOf('resolveAllFallthrough()')
    )
  })
```

- [ ] **Step 6: Run the whole suite and the typechecker**

```bash
sh -c 'cd /home/fsevenm/projects/dasbo-island-dis-31 && npm test && npm run typecheck'
```

Expected: `Test Files 69 passed (69)` and `Tests 954 passed (954)`. The arithmetic from the 951 baseline: `teardown.test.ts` adds 4, `sound.test.ts` deletes 2 and adds 1, and the two rewritten assertions are replacements rather than additions — `951 - 2 + 1 + 4 = 954`.

Typecheck must be clean. If the count differs from 954, stop and account for the difference before committing; a silently dropped test is the failure this arithmetic exists to catch.

- [ ] **Step 7: Commit**

```bash
git -C /home/fsevenm/projects/dasbo-island-dis-31 add src/extension.ts src/shell/soundPlayer.ts test/shell/teardown.test.ts test/shell/sound.test.ts
git -C /home/fsevenm/projects/dasbo-island-dis-31 commit -m "refactor: tear down in a straight line, island before the permission drain

disable() wrapped nine steps in a safely() try/catch that guarded nothing:
GLib.Source.remove, unexport, destroy and forgetSessionWindows do not throw,
and resolveAllFallthrough already catches per consumer callback. The wrapper
only hid the teardown order it existed to protect.

Draining permissions before destroying the island could settle a session to
done, reach Island.refresh, and chime on the way out; SoundPlayer._destroyed
suppressed that. Destroying the island first makes the path unreachable, so
the flag and markDestroyed go with it.

GNOME extension best practices #3 and #5.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Give `GridIcon` a `destroy()` override

Best practices #6 asks for a `destroy()` override rather than a `destroy` signal connection. Both are needed here, and `Island` already has both: `clutter_actor_destroy()` on a parent emits the signal on its children without routing through a JavaScript subclass method, so an override alone would strand `GridIcon`'s animation timer when another extension rebuilds the panel. This task adds the missing override and rewrites both comments to say plainly that the guideline is not followed, and why.

**Files:**
- Modify: `src/shell/gridIcon.ts:96-106` (constructor) and add a `destroy()` override
- Modify: `src/shell/island.ts:241-251` (comment only)
- Modify: `test/shell/teardown.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `GridIcon._stopTimer(): void` and `Island._releaseExternalRefs(): void`, both existing and both idempotent.
- Produces: `GridIcon.destroy(): void`, an override of `Clutter.Actor.destroy`. Nothing calls it explicitly; the shell does.

- [ ] **Step 1: Add the failing assertions**

Append to `test/shell/teardown.test.ts`:

```ts
describe('widgets that outlive a plain destroy() call', () => {
  const gridIcon = readFileSync('src/shell/gridIcon.ts', 'utf8')
  const island = readFileSync('src/shell/island.ts', 'utf8')

  // GNOME best practices #6 asks for a destroy() override instead of the
  // 'destroy' signal. Both are kept here on purpose: clutter_actor_destroy()
  // on a parent emits the signal on its children without routing through a JS
  // subclass method, so a panel rebuild by another extension would strand the
  // timer and the settings handlers. The override covers the direct
  // widget.destroy() the guideline is written for. Both cleanups are
  // idempotent, so being reached twice costs nothing.
  it('GridIcon stops its timer from both destroy paths', () => {
    expect(gridIcon).toMatch(/destroy\(\): void \{\s*this\._stopTimer\(\)\s*super\.destroy\(\)/)
    expect(gridIcon).toContain("this.connect('destroy', () => this._stopTimer())")
  })

  it('Island releases its external refs from both destroy paths', () => {
    expect(island).toContain("this.connect('destroy', () => this._releaseExternalRefs())")
    const destroy = island.slice(island.indexOf('destroy(): void {'))
    expect(destroy).toContain('this._releaseExternalRefs()')
  })
})
```

- [ ] **Step 2: Run it and watch the GridIcon assertion fail**

```bash
sh -c 'cd /home/fsevenm/projects/dasbo-island-dis-31 && npx vitest run test/shell/teardown.test.ts'
```

Expected: FAIL on `GridIcon stops its timer from both destroy paths` — there is no `destroy()` override in the class yet. The `Island` test passes already.

- [ ] **Step 3: Add the override and rewrite the comment in `gridIcon.ts`**

Replace this block in the constructor:

```ts
      this.connect('repaint', () => this._onRepaint())
      // The 'destroy' signal, not a destroy() override: Clutter tears children
      // down through clutter_actor_destroy, which emits this signal and does
      // not necessarily route through a JS method override. Without it the
      // timer outlives the actor and fires against a disposed object.
      this.connect('destroy', () => this._stopTimer())
      this._schedule()
    }
```

with:

```ts
      this.connect('repaint', () => this._onRepaint())
      // Both this signal and the destroy() override below, deliberately.
      // GNOME best practices #6 asks for the override alone, and that covers a
      // direct widget.destroy() — but Clutter tears children down through
      // clutter_actor_destroy(), which emits this signal without routing
      // through a JS method override. A panel rebuild by another extension
      // destroys this actor that way, and the timer would then outlive it and
      // fire against a disposed object. _stopTimer() is idempotent, so being
      // reached twice costs nothing. Island keeps the same pair.
      this.connect('destroy', () => this._stopTimer())
      this._schedule()
    }

    destroy(): void {
      this._stopTimer()
      super.destroy()
    }
```

- [ ] **Step 4: Rewrite the matching comment in `island.ts`**

Replace this comment, immediately above `this.connect('destroy', () => this._releaseExternalRefs())`:

```ts
    // Anything held by, or connected to, an object that outlives this
    // widget must be released here, not only from destroy() below. Clutter
    // tears children down through clutter_actor_destroy(), which emits the
    // 'destroy' signal and does not necessarily route through a JS method
    // override (see gridIcon.ts); a panel rebuild by an extension
    // like Dash to Panel can destroy this button that way without disable()
    // ever running. this._settings, global.display, and this._store all
    // stay alive in that case, so a subsequent settings change, a pending
    // GLib source, or a store event would otherwise reach a disposed
    // widget with nothing to catch it.
```

with:

```ts
    // Both this signal and the destroy() override below, deliberately. GNOME
    // best practices #6 asks for the override alone, and that covers a direct
    // widget.destroy() — but Clutter tears children down through
    // clutter_actor_destroy(), which emits this signal without routing through
    // a JS method override, and a panel rebuild by an extension like Dash to
    // Panel destroys this button that way without disable() ever running.
    // this._settings, global.display and this._store all stay alive in that
    // case, so a later settings change, a pending GLib source or a store event
    // would otherwise reach a disposed widget. _releaseExternalRefs() is
    // idempotent, so being reached from both paths costs nothing. GridIcon
    // keeps the same pair.
```

- [ ] **Step 5: Run the suite and the typechecker**

```bash
sh -c 'cd /home/fsevenm/projects/dasbo-island-dis-31 && npm test && npm run typecheck'
```

Expected: `Test Files 69 passed (69)` and `Tests 956 passed (956)` — Task 2's 954 plus the 2 assertions added here. Typecheck must stay clean — `super.destroy()` resolves through `St.DrawingArea` to `Clutter.Actor.destroy`, which `@girs/st-18` types as `(): void`. If `tsc` objects to the override signature, do not widen it: report the exact error rather than casting.

- [ ] **Step 6: Commit**

```bash
git -C /home/fsevenm/projects/dasbo-island-dis-31 add src/shell/gridIcon.ts src/shell/island.ts test/shell/teardown.test.ts
git -C /home/fsevenm/projects/dasbo-island-dis-31 commit -m "refactor: give GridIcon the destroy() override the guideline asks for

Best practices #6 wants an override rather than a 'destroy' signal handler.
Island already has both; GridIcon had only the signal. Keeping both is
deliberate: clutter_actor_destroy on a parent emits the signal on its children
without routing through a JS override, so an override alone would strand the
animation timer when another extension rebuilds the panel. Both comments now
say so instead of leaving it to be inferred.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Say why it is not on extensions.gnome.org, and document the release install

**Files:**
- Modify: `README.md` — Contents list, Requirements, a new section, and Install
- Modify: `test/docs/readme.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the heading `## Why it is not on extensions.gnome.org`, whose GitHub anchor is `#why-it-is-not-on-extensionsgnomeorg` (periods vanish, they do not become separators — `test/docs/links.test.ts` documents that rule).

- [ ] **Step 1: Write the failing README assertions**

In `test/docs/readme.test.ts`, add the new heading to the existing `has the sections a first-time reader scans for` array, between `'## Requirements'` and `'## Install'`:

```ts
      '## Requirements',
      '## Why it is not on extensions.gnome.org',
      '## Install',
```

Then add these tests inside the same `describe('the README')` block, after `keeps the warning that changes what a user does`:

```ts
  // "Not on extensions.gnome.org" without a reason reads as an oversight or a
  // submission still in the queue. It is neither: all three are load-bearing
  // and none of them is going to change, so the reader should be told which.
  it('says why it is not on extensions.gnome.org, not merely that it is not', () => {
    const section = readme.slice(
      readme.indexOf('## Why it is not on extensions.gnome.org'),
      readme.indexOf('## Install')
    )
    expect(section, 'the bundled-file reason is missing').toMatch(/bundle/i)
    expect(section, 'the agent-config reason is missing').toContain('~/.claude/settings.json')
    expect(section, 'the /proc reason is missing').toContain('/proc')
  })

  it('names the channel that replaces it', () => {
    expect(readme).toContain('github.com/dasbo-dev/island-gnome/releases')
  })

  // Contents is hand-maintained, and GitHub's slug rule drops the periods in
  // "extensions.gnome.org" rather than turning them into separators. A
  // hand-typed anchor gets that wrong, and a wrong anchor scrolls nowhere.
  it('lists the new section in Contents, with the anchor GitHub actually generates', () => {
    expect(readme).toContain(
      '- [Why it is not on extensions.gnome.org](#why-it-is-not-on-extensionsgnomeorg)'
    )
  })

  // A reader landing on Install should not have to clone a repository to get a
  // build now that releases carry the zip.
  it('documents both install routes, release zip first', () => {
    const install = readme.slice(readme.indexOf('## Install'), readme.indexOf('## Uninstall'))
    expect(install).toContain('gnome-extensions install')
    expect(install).toContain('.shell-extension.zip')
    expect(install).toContain('make install')
    expect(install.indexOf('gnome-extensions install')).toBeLessThan(
      install.indexOf('make install')
    )
  })

  it('no longer claims building from source is the only way in', () => {
    expect(readme).not.toContain('so building from source is how it is installed')
  })
```

- [ ] **Step 2: Run them and watch them fail**

```bash
sh -c 'cd /home/fsevenm/projects/dasbo-island-dis-31 && npx vitest run test/docs/readme.test.ts'
```

Expected: FAIL — 6 failures, one per new assertion plus the extended heading list.

- [ ] **Step 3: Add the Contents entry**

In `README.md`, in the `## Contents` list, insert one line after `- [Requirements](#requirements)`:

```markdown
- [Why it is not on extensions.gnome.org](#why-it-is-not-on-extensionsgnomeorg)
```

- [ ] **Step 4: Correct the Requirements sentence**

Replace:

```markdown
**To build.** The extension is not on extensions.gnome.org, so building from
source is how it is installed.
```

with:

```markdown
**To build.** Only for the build-from-source route. Installing the release
zip needs none of this.
```

- [ ] **Step 5: Add the new section**

Insert this between the end of `## Requirements` and `## Install`:

```markdown
## Why it is not on extensions.gnome.org

The extension follows the GNOME
[review guidelines](https://gitlab.gnome.org/World/javascript/gjs-guide/-/blob/main/docs/extensions/review-guidelines/review-guidelines.md)
and
[best practices](https://gitlab.gnome.org/World/javascript/gjs-guide/-/blob/main/docs/extensions/review-guidelines/best-practices.md)
everywhere it can, and breaks three of them on purpose. Each one is
load-bearing, so none of them is going to be fixed:

- **It ships as one bundled file.** `dist/extension.js` is a single esbuild
  bundle of the TypeScript source. The guidelines ask for many small modules,
  because the bundle is what a reviewer has to read. The source is modular —
  around fifty files under `src/` — but that is not what the archive contains.
- **It writes to other tools' config files.** The preferences window adds hook
  entries to `~/.claude/settings.json` and `~/.codex/hooks.json`, and the
  archive ships `hooks/dasbo-hook` for the agent to run. External scripts are
  discouraged. Without one, an agent has no way to tell the shell anything.
- **It reads `/proc` from the shell process.** Matching a session to the
  terminal window running it needs the process tree, and no D-Bus service
  answers that question.

Releases are published on
[GitHub Releases](https://github.com/dasbo-dev/island-gnome/releases)
instead, and building from source stays supported. Both routes are below.
```

- [ ] **Step 6: Restructure Install**

Replace the current opening of `## Install` — the single fenced block from `git clone` through `gnome-extensions enable`, and the `Then reload the shell.` paragraph that follows it — with:

````markdown
## Install

### From a release

Download `dasbo-island@ayubaswad.gmail.com.shell-extension.zip` from the
[latest release](https://github.com/dasbo-dev/island-gnome/releases/latest),
then:

```bash
gnome-extensions install --force dasbo-island@ayubaswad.gmail.com.shell-extension.zip
gnome-extensions enable dasbo-island@ayubaswad.gmail.com
```

`gnome-extensions install` compiles the settings schema itself, so there is
nothing else to run.

### From source

```bash
git clone https://github.com/dasbo-dev/island-gnome.git
cd island-gnome
npm ci
make install
gnome-extensions enable dasbo-island@ayubaswad.gmail.com
```

Either way, reload the shell afterwards. On X11 press `Alt`+`F2`, type `r`,
press `Enter`. On Wayland, log out and back in.
````

Everything after that — `Open the preferences and install the hooks for each agent you use:`, the Codex trust callout, the hook-installation paragraph, and `## Uninstall` — stays exactly as it is. It applies to both routes.

- [ ] **Step 7: Run the whole suite**

```bash
sh -c 'cd /home/fsevenm/projects/dasbo-island-dis-31 && npm test'
```

Expected: `Test Files 69 passed (69)` and `Tests 961 passed (961)` — Task 3's 956 plus the 5 assertions added here. `test/docs/links.test.ts` filters `https:` targets, so the three new external links are not fetched; the in-page `#why-it-is-not-on-extensionsgnomeorg` anchor is covered by the Contents assertion above. If `test/site/indexCopy.test.ts` fails, the landing page duplicates a README string that just moved — report which string rather than editing `site/`, which is out of scope.

- [ ] **Step 8: Commit**

```bash
git -C /home/fsevenm/projects/dasbo-island-dis-31 add README.md test/docs/readme.test.ts
git -C /home/fsevenm/projects/dasbo-island-dis-31 commit -m "docs: say why the extension is not on extensions.gnome.org

Three deliberate guideline breaks: the single bundled extension.js, the hook
entries written into agent config files, and the /proc reads the window
matcher needs. All load-bearing, none of them changing, so the README names
them rather than leaving the absence to read as an oversight.

Install now documents the release zip alongside building from source, since
releases are published on GitHub.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Changelog

**Files:**
- Modify: `CHANGELOG.md:9-11`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Replace the empty Unreleased section**

Replace:

```markdown
## [Unreleased]

Nothing since 0.1.0.
```

with:

```markdown
## [Unreleased]

### Changed

- `disable()` tears down in a straight line now. It used to wrap all nine of
  its steps in a try/catch that guarded nothing — `GLib.Source.remove`,
  `unexport()`, `destroy()` and `forgetSessionWindows()` do not throw, and the
  one step that runs consumer callbacks already catches per callback — and the
  wrapper hid the teardown order it existed to protect.
- The extension no longer chimes on its way out. `disable()` destroys the
  island before it drains pending permissions, rather than after: draining can
  settle a session to **done**, which reached the finish cue while the island
  was still listening. A flag on the sound player used to suppress that; the
  order makes the path unreachable, so the flag is gone.
- `GridIcon` stops its animation timer from a `destroy()` override as well as
  from the `destroy` signal, matching `Island`. The signal stays: Clutter tears
  children down without routing through a JavaScript override, so an override
  alone would strand the timer when another extension rebuilds the panel.

Together these follow the GNOME extension
[best practices](https://gitlab.gnome.org/World/javascript/gjs-guide/-/blob/main/docs/extensions/review-guidelines/best-practices.md)
on unnecessary try/catch, lifecycle flags, and widget destruction.

### Documentation

- The README says why the extension is not on extensions.gnome.org: the single
  bundled `extension.js`, the hook entries written into agent config files, and
  the `/proc` reads the window matcher needs. All three are deliberate.
- Install documents the release zip and `gnome-extensions install` alongside
  building from source.
```

- [ ] **Step 2: Run the full suite and the typechecker one last time**

```bash
sh -c 'cd /home/fsevenm/projects/dasbo-island-dis-31 && npm test && npm run typecheck'
```

Expected: `Test Files 69 passed (69)`, `Tests 961 passed (961)`, typecheck clean.

- [ ] **Step 3: Verify the build and the pack still work**

```bash
sh -c 'cd /home/fsevenm/projects/dasbo-island-dis-31 && node build.mjs'
```

Expected: `built dist/ and dist-site/`. This is the real check that the reordered `disable()` and the new `destroy()` override survive bundling — nothing else in the repo compiles the shell code.

- [ ] **Step 4: Commit**

```bash
git -C /home/fsevenm/projects/dasbo-island-dis-31 add CHANGELOG.md
git -C /home/fsevenm/projects/dasbo-island-dis-31 commit -m "docs: changelog the review-guideline fixes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Verification

Before reporting done, confirm all four by running them, not by reasoning about them:

1. `npm test` — 69 files, 961 tests.
2. `npm run typecheck` — exit 0.
3. `node build.mjs` — prints `built dist/ and dist-site/`.
4. `git -C /home/fsevenm/projects/dasbo-island-dis-31 log --oneline main..dis-31-review-guidelines` — six commits, the spec plus one per task.

The operator must reinstall and reload the shell before smoke-testing: the change lives in `disable()`, and a shell running the old bundle will not show it.
