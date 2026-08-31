# Applying the GNOME extension review guidelines

**Issue:** DIS-31
**Date:** 2026-08-31

## Goal

Bring the extension into line with the two gjs-guide review pages wherever
following them improves the code, and state plainly in the README which rules
the extension knowingly breaks and why it will therefore not appear on
extensions.gnome.org.

Sources:

- [best-practices.md](https://gitlab.gnome.org/World/javascript/gjs-guide/-/blob/main/docs/extensions/review-guidelines/best-practices.md)
- [review-guidelines.md](https://gitlab.gnome.org/World/javascript/gjs-guide/-/blob/main/docs/extensions/review-guidelines/review-guidelines.md)

## What the audit found

The formal review rules are already met. This is not new work; the
`2026-08-11-ego-readiness-fixes` and `2026-08-28-shexli-static-analysis`
rounds closed most of it. Confirmed clean on this pass:

| Rule | State |
| --- | --- |
| Process isolation (`Gtk`/`Adw`/`Gdk` in prefs only, `St`/`Clutter`/`Meta` in the shell only) | Clean. `src/prefs*.ts` import the first set, `src/shell/*.ts` the second, `src/core/*.ts` neither. |
| Schema id and path based on `org.gnome.shell.extensions` | Clean. |
| `settings-schema` in `metadata.json`, `getSettings()` called with no argument | Clean. |
| No `ByteArray`, `Lang`, `Mainloop` | Clean. |
| No `GObject.Object.run_dispose()` | Clean. |
| No excessive logging | Clean. One `warn()` seam in `src/core/log.ts`. |
| Lines under 200 characters | Clean. |
| Icons rather than emojis | Clean. `St.Icon` and `Gio.FileIcon` throughout. |
| No trademarked artwork | Clean. The three agent marks are original geometry. |
| Not minified or obfuscated | Clean. `build.mjs` sets `minify: false` for the extension. |

Three best-practice deviations remain, and they are what this change fixes.
Three structural deviations also remain, and they are what the README will
document rather than fix.

## Design

### 1. Straight-line `disable()`

Best practices #3 forbids wrapping calls that do not throw. `extension.ts`
wraps all nine teardown steps in a `safely()` helper:

```ts
const safely = (label: string, fn: () => void) => {
  try { fn() } catch (e) { warn(`teardown step "${label}" failed: ${e}`) }
}
```

Nothing it wraps throws. `GLib.Source.remove`, `IslandService.unexport`,
`Island.destroy`, `SoundPlayer.destroy` and `forgetSessionWindows` are all
either GObject methods that report failure by other means or our own
straight-line code. The one step that runs a caller-supplied callback,
`PermissionTable.resolveAllFallthrough()`, already catches per entry at
`src/core/permissions.ts:229`, so a throwing consumer cannot escape it.

`safely()` is therefore dead weight that obscures the very thing its comment
says it protects: the teardown order. Delete it. `disable()` becomes nine
plain statements read top to bottom.

Three further catches go with it, for the same reason:

- `src/shell/island.ts:552` — around `Gio.Settings.disconnect(id)`.
- `src/extension.ts:242` — a `try`/`finally` around the same loop. The
  `finally` that clears `_settingsIds` becomes the next statement.
- `src/shell/transcriptWatcher.ts:76` — around `monitor.disconnect(id)` and
  `Gio.FileMonitor.cancel()`.

Every catch that guards a call which genuinely throws stays untouched:

| Site | Why it stays |
| --- | --- |
| `src/shell/gridIcon.ts:166` | `get_context()` and cairo drawing throw; the catch latches `_broken` so the journal does not flood at tick rate. |
| `src/shell/soundPlayer.ts:104` | `play_from_theme` throws on a broken sound backend. |
| `src/dbus/service.ts`, `src/core/transcript.ts` | `JSON.parse` on agent-supplied payloads. |
| `src/shell/applyEdits.ts`, `windowFinder.ts`, `logoIcon.ts`, `agentIcon.ts`, `prefs/about.ts`, `core/install/plan.ts` | `GLib.file_get_contents` and `Gio.File.query_exists` throw on an unreadable path. |
| `src/shell/island.ts:162` | `openPreferences()` throws when the UUID lookup fails. |
| `src/prefs.ts:304` | `applyEdits` writes to disk. |
| `src/core/permissions.ts:120,139,229` | `finish()` invokes consumer callbacks. |

### 2. Remove `SoundPlayer._destroyed` by reordering `disable()`

Best practices #5 names `this._destroyed` as the pattern to avoid: after
`destroy()`, an instance should be unreachable, not flagged.

The flag exists for one concrete reason. `disable()` currently drains pending
permissions *before* it destroys the island. Draining settles held requests,
a settled request can produce a `done` diff, and `Island.refresh()` reacts to
that at `src/shell/island.ts:836` with `this._sound.play('done')` — so the
extension chimes on its way out. `markDestroyed()` was added to silence that
without disturbing the order.

Fix the order instead. Destroying the island first makes the chime path
unreachable by construction: `Island.destroy()` drops the store subscription,
stops the tick timer and destroys the permission controls, so `refresh()`
cannot run afterwards. Draining still happens, one step later, so every agent
still receives its fall-through answer.

New `disable()` order:

1. Reaper timer (`GLib.Source.remove`)
2. D-Bus service (`unexport`)
3. Transcript watcher (store unsubscribe, then `destroy`)
4. Remembered jump windows (`forgetSessionWindows`)
5. Island (`destroy`) — moved ahead of permissions
6. Pending permissions (`resolveAllFallthrough`)
7. Sound player (`destroy`)
8. Store reference
9. Settings handlers, then the settings reference

`markDestroyed()`, the `_destroyed` field and the `if (this._destroyed) return`
guard in `play()` are all deleted. `SoundPlayer.destroy()` keeps its real work:
clearing `_last` and dropping `_desktop`.

`test/shell/sound.test.ts` already pins the old arrangement by reading
`src/extension.ts` as text, which is how this suite asserts on GJS code it
cannot execute. Those assertions move to the new invariant: the island is
destroyed before `resolveAllFallthrough()`, and `markDestroyed` appears
nowhere in `src/`.

### 3. Keep the `destroy` signal connections; give `GridIcon` a `destroy()` override

Best practices #6 says to override `destroy()` rather than connect to the
`destroy` signal. The two sites that do connect —
`src/shell/gridIcon.ts:103` and `src/shell/island.ts:251` — have comments
arguing that `clutter_actor_destroy()` on a parent emits the signal on its
children without routing through a JS subclass method, so an override alone
would miss a panel rebuild by another extension. That argument holds, and
`Island` already carries both an override and the signal.

`GridIcon` carries only the signal. Give it a `destroy()` override that stops
the timer and calls `super.destroy()`, matching `Island`, so the class reads
correctly from either entry point. `_stopTimer()` is idempotent, so being
reached twice costs nothing.

Both comments are rewritten to state plainly that the guideline is not
followed and why, rather than leaving a reader to infer it.

### Not changing

- **Optional calls (`?.()`).** Best practices #4 targets optional chaining on
  *guaranteed* methods. All seven sites are either genuinely nullable fields
  (`_unwatchStore`, `_unsubscribe`, `_hooksProbe`) or optional members of the
  adapter interface (`parseTasks`, `parseQuestions`), which the rule permits.
- **Comment volume.** Best practices #9 bans comments that restate code. These
  explain why a decision was made, which is the kind the rule is protecting.

## The README section

A new `## Why it is not on extensions.gnome.org` between **Requirements** and
**Install**, listed in **Contents**. Three bullets, each naming a rule the
extension breaks and why breaking it is the product rather than a defect:

1. **It ships as one bundled file.** `dist/extension.js` is a 3880-line
   esbuild bundle. Best practices #13 and #15 ask for small modules, because
   the bundle is what a reviewer reads. The source is modular — around fifty
   files under `src/` — but that is not what the archive contains.
2. **It writes to other tools' config files.** Preferences adds hook entries
   to `~/.claude/settings.json` and `~/.codex/hooks.json`, and the archive
   ships `hooks/dasbo-hook` for the agent to run. External scripts are
   discouraged; without one, an agent has no way to tell the shell anything.
3. **It reads `/proc` from the shell process.** Matching a session to the
   terminal window running it needs the process tree, and no D-Bus service
   answers that question.

Then one line stating that releases are published on GitHub Releases, with
building from source still supported.

The existing sentence under **Requirements** — "The extension is not on
extensions.gnome.org, so building from source is how it is installed" — is
corrected: it is no longer true that source is the only route, and the reason
now lives in its own section.

### Install section

**Install** gains the Releases route as its primary path: download
`dasbo-island@ayubaswad.gmail.com.shell-extension.zip` from the latest
release, install it with `gnome-extensions install`, enable it, reload the
shell. The existing clone-and-`make install` sequence stays below it, framed
as the route for building from source.

Everything after the install step — the Codex trust note, the hook-installation
paragraph, **Uninstall** — is unchanged and applies to both routes.

## Testing

This suite cannot execute GJS: `src/extension.ts` imports `gi://GLib` and
`resource:///org/gnome/shell/...`, which vitest has no way to resolve. Every
assertion about shell-side code is therefore made against the source as text,
and that is the convention these changes follow.

`test/shell/sound.test.ts` changes, because five of its assertions pin the
arrangement being removed:

| Assertion | Change |
| --- | --- |
| "checks destroyed as the very first thing play() does" | Deleted with the flag. |
| "checks the compiled schema for notification-sounds once" | Its slice ends at `markDestroyed`; the boundary moves to `play(cue`. |
| "destroy() cannot un-skip a post-destroy play()" | Deleted. It guarded a post-destroy `play()`, which best practices #5 says must not be reachable at all. |
| "destroys the player during teardown, inside the safely wrapper" | Rewritten without `safely`. |
| "marks the player destroyed before resolveAllFallthrough" | Rewritten: the island is destroyed before `resolveAllFallthrough()`. |

New assertions, in the same file:

- `markDestroyed` appears nowhere under `src/`.
- `safely(` appears nowhere in `src/extension.ts`.
- `disable()` holds no `try` at all.

`test/docs/readme.test.ts` gains assertions that the new section exists, is in
the **Contents** list, that **Install** documents the Releases route, and that
the Requirements sentence no longer claims source-building is the only route.

`npm test` and `npm run typecheck` stay green. Baseline before the change is
recorded in the plan so a lost test is visible as a lost test.

## Out of scope

Unbundling `dist/` into per-module JavaScript, replacing the hook script with
something else, and moving the `/proc` reads behind a D-Bus service. All three
are the structural reasons the extension is not on extensions.gnome.org, and
the README now says so rather than working around them.
