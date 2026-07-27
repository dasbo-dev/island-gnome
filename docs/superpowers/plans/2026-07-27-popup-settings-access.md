# Popup Settings Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a title row with a gear button at the top of the panel popup so a user can open the preferences window without typing a shell command, and show `No active sessions` when the popup would otherwise be empty.

**Architecture:** A new widget file `src/shell/popupHeader.ts` exports two non-reactive `PopupMenu.PopupBaseMenuItem` subclasses — `PopupHeader` (title label plus a gear `St.Button`) and `EmptyRow` (one dimmed label). `Island` adds the header and a `PopupSeparatorMenuItem` in its constructor so they hold the top of the menu, gains a `setPrefsHandler()` setter alongside the existing `setJumpHandler()`, and manages the `EmptyRow` from `_rebuildRows()`. `extension.ts` supplies the handler as `() => this.openPreferences()`, so the widget never learns about the `Extension` object.

**Tech Stack:** TypeScript compiled by esbuild (`build.mjs`), GNOME Shell 46 ESM extension, `@girs/gnome-shell` 46.0.2 typings, vitest for the pure-core tests, `glib-compile-schemas` for the settings schema.

Spec: `docs/superpowers/specs/2026-07-27-popup-settings-access-design.md`

## Global Constraints

- Target is GNOME Shell 46 only. Import shell modules from `resource:///org/gnome/shell/...` and GI modules from `gi://...`, matching the existing files.
- `src/core` must never import `gi://` or `resource://` — `test/core/purity.test.ts` fails the build if it does. Every file in this plan lives in `src/shell` or is `src/extension.ts`, so no core file is touched.
- There are no unit tests over `src/shell`; GJS widgets are not constructible under vitest. Automated verification for this plan is `npm test` (must stay green, 0 new tests) and `npm run typecheck` (must report no errors). Behavioural verification is manual on a live shell, scripted in Task 4.
- Widget style classes use the `dasbo-` prefix, matching `stylesheet.css`.
- Every actor a class creates must be released in that class's `destroy()`, matching the discipline in `src/shell/island.ts:257-277`.
- User-visible copy, verbatim: the header title is `Dasbo Island`, the gear's accessible name is `Settings`, and the empty-state label is `No active sessions`.
- The gear icon name is `emblem-system-symbolic`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/shell/popupHeader.ts` (create) | The two presentation widgets: `PopupHeader` and `EmptyRow`. Owns actors and style classes only; holds no session state and never reads `Gio.Settings`. |
| `src/shell/island.ts` (modify) | Places the header, separator and empty row in the menu; stores and invokes the prefs callback; tears all three down. |
| `src/extension.ts` (modify) | Supplies the one closure that knows about `Extension.openPreferences()`. |
| `stylesheet.css` (modify) | Four `dasbo-` rules for the new actors. |
| `README.md` (modify) | Documents the gear as the way to reach preferences. |

---

### Task 1: The header and empty-state widgets

Self-contained: the new file compiles and typechecks on its own, before anything imports it.

**Files:**
- Create: `src/shell/popupHeader.ts`
- Modify: `stylesheet.css` (append after line 42)
- Test: none — see Global Constraints. Verified by `npm run typecheck`.

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `PopupHeader`, a `GObject.registerClass` result. Construct as `new PopupHeader({ onPrefs: () => void })`. Instances are `PopupMenu.PopupBaseMenuItem`, so `menu.addMenuItem(header)` and `header.destroy()` both apply.
  - `EmptyRow`, a `GObject.registerClass` result. Construct as `new EmptyRow()` with no arguments.
  - `export interface PopupHeaderCallbacks { onPrefs: () => void }`

- [ ] **Step 1: Create `src/shell/popupHeader.ts`**

The `reactive: false, can_focus: false` options are load-bearing. An activatable `PopupBaseMenuItem` closes the whole menu when clicked anywhere along its width, which would make the title text a hidden close button. A reactive child `St.Button` inside a non-reactive item still receives clicks — this is exactly what the Jump button does at `src/shell/sessionRow.ts:32` and `src/shell/sessionRow.ts:54`.

```typescript
import St from 'gi://St'
import Clutter from 'gi://Clutter'
import GObject from 'gi://GObject'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'

export interface PopupHeaderCallbacks {
  onPrefs: () => void
}

/**
 * The popup's title row: the extension name on the left, a gear button on the
 * right. Non-reactive on purpose — an activatable menu item closes the menu on
 * any click along its width, so the title itself would become a close button.
 * The child St.Button still receives clicks, the way SessionRow's Jump does.
 */
export const PopupHeader = GObject.registerClass(
  class PopupHeader extends PopupMenu.PopupBaseMenuItem {
    private _cb!: PopupHeaderCallbacks

    constructor(cb: PopupHeaderCallbacks) {
      super({ reactive: false, can_focus: false, style_class: 'dasbo-header' })
      this._cb = cb

      const title = new St.Label({
        text: 'Dasbo Island',
        style_class: 'dasbo-header-title',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
      })

      const gear = new St.Button({
        style_class: 'button dasbo-prefs',
        // Without this the button announces itself as an unnamed button to a
        // screen reader: its only child is an icon, so there is no text to read.
        accessible_name: 'Settings',
        y_align: Clutter.ActorAlign.CENTER,
        child: new St.Icon({ icon_name: 'emblem-system-symbolic', icon_size: 16 }),
      })
      gear.connect('clicked', () => this._cb.onPrefs())

      this.add_child(title)
      this.add_child(gear)
    }
  }
)

/** Shown in place of the session rows while the store is empty. */
export const EmptyRow = GObject.registerClass(
  class EmptyRow extends PopupMenu.PopupBaseMenuItem {
    constructor() {
      super({ reactive: false, can_focus: false, style_class: 'dasbo-row' })
      this.add_child(
        new St.Label({
          text: 'No active sessions',
          style_class: 'dasbo-empty',
          x_expand: true,
          y_align: Clutter.ActorAlign.CENTER,
        })
      )
    }
  }
)
```

- [ ] **Step 2: Append the four style rules to `stylesheet.css`**

Add after the existing last line (`.dasbo-always { padding: 2px 10px; font-size: 0.85em; }`):

```css
.dasbo-header { spacing: 12px; }

.dasbo-header-title {
  font-weight: bold;
}

.dasbo-prefs { padding: 2px 6px; }

.dasbo-empty {
  font-size: 0.85em;
  opacity: 0.7;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no output from either `tsc` invocation, exit status 0. If `St.Button`'s `child` property is rejected by the `@girs` typings, replace the `child:` option with a `gear.set_child(new St.Icon({ icon_name: 'emblem-system-symbolic', icon_size: 16 }))` call after construction — do not reach for `any`.

- [ ] **Step 4: Confirm the core purity test still passes**

Run: `npm test`
Expected: all suites pass, including `src/core purity`. No test count change.

- [ ] **Step 5: Commit**

```bash
git add src/shell/popupHeader.ts stylesheet.css
git commit -m "feat(shell): add the popup header and empty-state widgets"
```

---

### Task 2: Mount the header, separator and empty row in the Island

**Files:**
- Modify: `src/shell/island.ts` (imports at line 12; fields near line 47; constructor near line 77; new setter after `setJumpHandler` at line 100; `_rebuildRows` end near line 233; `destroy` near line 274)
- Test: none — verified by `npm run typecheck` and by Task 4's manual run.

**Interfaces:**
- Consumes: `PopupHeader`, `EmptyRow`, `PopupHeaderCallbacks` from Task 1.
- Produces: `Island.prototype.setPrefsHandler(fn: () => void): void`, consumed by Task 3. Semantics: stores the callback; the header's gear closes the menu and then calls it. Calling it more than once replaces the stored callback. Never calling it leaves a no-op in place.

- [ ] **Step 1: Add the import**

Below the existing `import { PermissionControls } from './permissionRow.js'` (line 12):

```typescript
import { PopupHeader, EmptyRow } from './popupHeader.js'
```

- [ ] **Step 2: Add the three fields**

Beside the existing private fields (after `private _rows = new Map<string, InstanceType<typeof SessionRow>>()` on line 47):

```typescript
    private _header!: InstanceType<typeof PopupHeader>
    private _separator!: PopupMenu.PopupSeparatorMenuItem
    private _emptyRow: InstanceType<typeof EmptyRow> | null = null
```

And beside `private _onJump: (s: Session) => void = () => {}` (line 51):

```typescript
    private _onPrefs: () => void = () => {}
```

The no-op default matters: the gear is clickable the moment the panel button is added, which is before `extension.ts` wires the handler. Without the default, an early click would throw inside a Clutter signal handler.

- [ ] **Step 3: Build the header in the constructor**

Insert immediately after `this.add_child(box)` (line 77) and before the `this._unsubscribe = ...` line, so both items are added before the constructor's closing `this.refresh()` call and therefore hold menu positions 0 and 1. Every session row that `_rebuildRows` appends later lands beneath them.

```typescript
      this._header = new PopupHeader({
        onPrefs: () => {
          // Close first: the preferences window takes focus, and a popup left
          // open behind it lingers until the next click somewhere else.
          this.menu.close(true)
          try {
            this._onPrefs()
          } catch (e) {
            // An exception escaping a Clutter signal handler is logged without
            // context. The menu is already closed, so the user just sees no
            // window — put the reason in the journal.
            console.warn(`dasbo-island: opening preferences failed: ${e}`)
          }
        },
      })
      this._separator = new PopupMenu.PopupSeparatorMenuItem()
      ;(this.menu as PopupMenu.PopupMenu).addMenuItem(this._header)
      ;(this.menu as PopupMenu.PopupMenu).addMenuItem(this._separator)
```

The `this.menu as PopupMenu.PopupMenu` cast is the same one `_rebuildRows` already uses at line 198, for the reason given in the file's top comment: `PanelMenu.Button#menu` is typed as a union because a caller can pass `dontCreateMenu`.

- [ ] **Step 4: Add the setter**

Immediately after the existing `setJumpHandler` method (which ends at line 102):

```typescript
    setPrefsHandler(fn: () => void): void {
      this._onPrefs = fn
    }
```

- [ ] **Step 5: Drive the empty row from `_rebuildRows`**

Replace the final block of `_rebuildRows()` — the comment and `if (this._controls.size === 0) this._stopPulse()` at lines 229-233 — with that block followed by the new empty-state sync:

```typescript
      // Base this on whether a permission control is actually on screen, not on
      // worstState(): RANK puts 'error' above 'waiting', so another session sitting
      // in 'error' would otherwise silence the pulse while this one still has live
      // Allow/Deny/Always buttons.
      if (this._controls.size === 0) this._stopPulse()

      // Ordering needs no care here: the empty row exists only while there are
      // zero session rows, so it can never end up wedged between two of them.
      if (sessions.length === 0 && !this._emptyRow) {
        this._emptyRow = new EmptyRow()
        ;(this.menu as PopupMenu.PopupMenu).addMenuItem(this._emptyRow)
      } else if (sessions.length > 0 && this._emptyRow) {
        this._emptyRow.destroy()
        this._emptyRow = null
      }
```

`sessions` is already in scope — it is bound at the top of `_rebuildRows()` (line 176).

- [ ] **Step 6: Tear the three down in `destroy()`**

In `destroy()`, immediately after the existing row loop (`for (const row of this._rows.values()) row.destroy()` and `this._rows.clear()`, lines 274-275) and before `super.destroy()`:

```typescript
      this._emptyRow?.destroy()
      this._emptyRow = null
      this._header.destroy()
      this._separator.destroy()
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no output, exit status 0.

- [ ] **Step 8: Build**

Run: `make build`
Expected: esbuild writes `dist/extension.js` and `glib-compile-schemas` prints nothing. Exit status 0.

- [ ] **Step 9: Commit**

```bash
git add src/shell/island.ts
git commit -m "feat(shell): show a header, separator and empty row in the popup"
```

---

### Task 3: Wire the preferences handler

**Files:**
- Modify: `src/extension.ts` (after the `setJumpHandler` block at lines 55-58)
- Test: none — verified by `npm run typecheck` and by Task 4's manual run.

**Interfaces:**
- Consumes: `Island.prototype.setPrefsHandler(fn: () => void)` from Task 2, and `Extension.prototype.openPreferences()` from `resource:///org/gnome/shell/extensions/extension.js`, already imported at line 4.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Install the callback**

Insert immediately after the closing `})` of the `this._island.setJumpHandler(...)` call (line 58) and before `this._island.setPermissionHandlers({`:

```typescript
    this._island.setPrefsHandler(() => this.openPreferences())
```

This closure is the only thing in the codebase that connects the panel widget to the `Extension` object. Keeping it here means `Island` still takes `(store, settings)` and holds no reference to the extension.

No teardown is needed. The callback is dropped when `_island.destroy()` runs and `this._island = null` in `disable()` (lines 122-125); it is a plain closure, not a signal connection, so there is no id to release.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no output, exit status 0.

- [ ] **Step 3: Run the test suite**

Run: `npm test`
Expected: all suites pass. No test count change.

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts
git commit -m "feat: open preferences from the popup's gear button"
```

---

### Task 4: Verify on a live shell and document it

The behavioural gate for the whole feature. Nothing before this point proves a single actor rendered.

**Files:**
- Modify: `README.md` (the paragraph after the `gnome-extensions prefs` code block, which currently begins "Each agent row shows whether its hooks are installed.")
- Test: manual, scripted below.

**Interfaces:**
- Consumes: the built extension from Tasks 1-3.
- Produces: nothing.

- [ ] **Step 1: Install the build**

Run: `make install`
Expected: `Installed. Log out and back in (X11), then: gnome-extensions enable dasbo-island@ayubaswad.gmail.com`

- [ ] **Step 2: Reload the shell**

On X11: press `Alt+F2`, type `r`, press Enter. On Wayland: log out and back in.

If the extension was disabled by the reload, run:
`gnome-extensions enable dasbo-island@ayubaswad.gmail.com`

- [ ] **Step 3: Check the empty state**

Run: `gsettings --schemadir ~/.local/share/gnome-shell/extensions/dasbo-island@ayubaswad.gmail.com/schemas set org.gnome.shell.extensions.dasbo-island always-show true`

Then, with no agent session running, click the pill.
Expected: the popup shows `Dasbo Island` with a gear on the right, a separator, and one dimmed `No active sessions` row. Clicking the title text does **not** close the popup.

- [ ] **Step 4: Check the gear**

Click the gear.
Expected: the preferences window opens and the popup closes.

- [ ] **Step 5: Check the header with live sessions**

Start an agent session in a terminal (any agent whose hooks are installed), then click the pill.
Expected: the header and separator sit above the session rows, `No active sessions` is gone, and the Jump button still works.

- [ ] **Step 6: Check teardown**

Run, in one terminal:
`journalctl -f -o cat /usr/bin/gnome-shell`

In another:
```bash
gnome-extensions disable dasbo-island@ayubaswad.gmail.com
gnome-extensions enable dasbo-island@ayubaswad.gmail.com
```

Expected: no `dasbo-island:` warnings, and exactly one pill in the panel after re-enabling. A second pill means an actor survived `destroy()`.

- [ ] **Step 7: Restore the setting**

Run: `gsettings --schemadir ~/.local/share/gnome-shell/extensions/dasbo-island@ayubaswad.gmail.com/schemas reset org.gnome.shell.extensions.dasbo-island always-show`

- [ ] **Step 8: Update the README**

Replace the paragraph beginning "Each agent row shows whether its hooks are installed." with:

```markdown
The preferences window is also one click away at any time: click the pill and
then the gear in the popup's header.

Each agent row shows whether its hooks are installed. If the extension
directory moves, the row offers **Update** — every installed hook command
embeds an absolute path. Panel box and position changes apply immediately,
with no reload; note that extensions replacing the top bar, such as Dash to
Panel, decide where each box ends up on screen.
```

- [ ] **Step 9: Commit**

```bash
git add README.md
git commit -m "docs: point at the popup gear as the route to preferences"
```

---

## Definition of Done

- `npm test` green, `npm run typecheck` clean, `make build` succeeds.
- Clicking the pill shows a `Dasbo Island` header with a working gear, above any session rows.
- The gear opens preferences and closes the popup.
- The popup shows `No active sessions` instead of nothing when the store is empty.
- Disable/enable leaves no warnings in the journal and exactly one pill in the panel.
