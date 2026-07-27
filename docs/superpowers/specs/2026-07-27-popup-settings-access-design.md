# Popup settings access: header row with a gear button

Date: 2026-07-27
Status: approved, ready for planning

## Problem

There is no way to reach the preferences window from the panel. The only
documented route is the shell command `gnome-extensions prefs
dasbo-island@ayubaswad.gmail.com`, which a user has to know about and type.

Clicking the pill already opens the popup — `Island` extends
`PanelMenu.Button` (`src/shell/island.ts:41`), which binds click to
`menu.toggle()` for free. The gap is the popup's contents: it holds one
`SessionRow` per live session and nothing else. No title, no footer, no
settings entry point.

A second, smaller defect follows from the same emptiness. With `always-show`
enabled and no sessions running, the pill stays visible but its popup has zero
children, so clicking it appears to do nothing.

## Design

### 1. Header and empty-state widgets — `src/shell/popupHeader.ts`

New file, following the existing widget files (`sessionRow.ts`,
`permissionRow.ts`): small, single-purpose, owning only its own actors.

```ts
export const PopupHeader = GObject.registerClass(
  class PopupHeader extends PopupMenu.PopupBaseMenuItem { ... }
)
export const EmptyRow = GObject.registerClass(
  class EmptyRow extends PopupMenu.PopupBaseMenuItem { ... }
)
```

`PopupHeader` is constructed with `{ reactive: false, can_focus: false,
style_class: 'dasbo-header' }` and one callback, `onPrefs: () => void`. It
holds an `St.Label` reading `Dasbo Island` with `x_expand: true`, then an
`St.Button` containing an `St.Icon` with `icon_name:
'emblem-system-symbolic'`. The button carries `accessible_name: 'Settings'`
so screen readers announce something other than an unnamed button, and its
`clicked` signal invokes `onPrefs`.

A non-reactive menu item with a reactive child button is the arrangement the
Jump button already uses (`sessionRow.ts:32` and `sessionRow.ts:54`): the item
itself ignores pointer events, the child still receives them. Keeping the
header non-reactive matters because an activatable menu item closes the whole
popup when clicked anywhere along its width.

`EmptyRow` is the same kind of non-reactive item holding one dimmed label,
`No active sessions`.

The divider under the header is `PopupMenu.PopupSeparatorMenuItem`. A
`border-bottom` in the stylesheet would need a hardcoded colour, which cannot
be right in both the light and dark shell themes; the separator inherits the
theme's own rule.

### 2. Island wiring — `src/shell/island.ts`

Four changes, all local:

**Constructor.** Build the header and the separator and add both with
`menu.addMenuItem()` before the constructor's existing `this.refresh()` call.
They therefore occupy menu positions 0 and 1, and every session row appended
later by `_rebuildRows` lands beneath them. Keep both in fields
(`_header`, `_separator`) for teardown.

**New setter.** `setPrefsHandler(fn: () => void)`, beside `setJumpHandler`,
storing into `_onPrefs: () => void = () => {}`. The default no-op means a
click before the extension wires the handler is inert rather than a null
dereference — the same guard `_onJump` already uses.

The header's callback runs `this.menu.close(true)` first, then `_onPrefs()`
inside `try` / `catch` with a `console.warn`. `openPreferences()` can throw
if the extension object cannot be resolved, and an exception escaping a
Clutter signal handler is noisy and hides the cause; the codebase already
takes this posture in `extension.ts`'s `safely` helper and in the reaper
callback.

**Empty state.** At the end of `_rebuildRows()`, after the session-row sync:
create an `EmptyRow` and add it when `this._store.list()` is empty and no
empty row exists; destroy it and clear the field when sessions are present.
Insertion order needs no special handling, because the empty row exists only
when there are zero session rows.

**Teardown.** `destroy()` destroys `_header`, `_separator` and any live
`EmptyRow` alongside the existing per-row loop, before `super.destroy()`.

### 3. Extension wiring — `src/extension.ts`

One statement, next to the existing `setJumpHandler` call:

```ts
this._island.setPrefsHandler(() => this.openPreferences())
```

The callback is the only thing that knows about `Extension`. `Island` keeps
its `(store, settings)` constructor and its existing handler-setter shape;
the alternatives — passing the `Extension` into the
constructor, or calling `Extension.lookupByUUID` inside `island.ts` — both
push extension plumbing into the panel widget, and the second hardcodes the
UUID in a second place.

### 4. Stylesheet — `stylesheet.css`

Four rules beside the existing `.dasbo-*` block:

- `.dasbo-header` — horizontal spacing between title and gear.
- `.dasbo-header-title` — bold, matching `.dasbo-row-project`.
- `.dasbo-prefs` — padding for the icon button.
- `.dasbo-empty` — `opacity: 0.7`, matching `.dasbo-row-activity`.

## Data flow

Gear click → `PopupHeader`'s `onPrefs` → `Island._onPrefs` → the closure
installed by `extension.ts` → `Extension.openPreferences()`. The popup closes
on the way.

No new GSettings keys, no store mutation, no D-Bus traffic. The header is
static: nothing in `refresh()` or `_rebuildRows()` touches it after
construction.

## Error handling

- `openPreferences()` throwing is caught in `island.ts` and logged with
  `console.warn`; the popup is already closed, so the user sees no window and
  the journal carries the reason.
- The default no-op `_onPrefs` covers a click landing before `enable()`
  finishes wiring.
- The empty row is destroyed on the transition to a non-empty store, so it
  cannot survive as a stale sibling above the session rows.

## Testing

`test/core/purity.test.ts` keeps `src/core` free of gi imports, and there are
no unit tests over `src/shell` — GJS widgets are not constructible under
vitest. This change adds shell code only, so it adds no tests, and the
existing suite must stay green.

Verification is therefore:

1. `npm test` — unchanged, green.
2. `make build` — TypeScript compiles, including the new file.
3. Manual on GNOME Shell 46: reload the shell, click the pill, confirm the
   header renders above the session rows; click the gear and confirm the
   preferences window opens and the popup closes; enable `always-show` with no
   sessions running and confirm the popup shows the header and
   `No active sessions`; disable the extension and confirm no warnings in
   `journalctl -f -o cat /usr/bin/gnome-shell`.

## Out of scope

- Inline quick-settings toggles inside the popup. The preferences window
  already owns every key; duplicating the widgets doubles the surface that
  can drift.
- A gear inside the pill itself. It would take panel width and split the
  pill's click target between two actions.
