# B1 tier 1: what actually breaks between GNOME 46 and 48/49/50

**Date:** 2026-08-11
**Issue:** B1, from the DIS-14 extensions.gnome.org readiness review
**Method:** static only — `@girs` typings bumped per target, `tsc --noEmit -p tsconfig.json`.
No GNOME Shell above 46 was run. Every claim here is a typecheck result, not a runtime result.

## Headline

The port is **much smaller than the review implies**, and one of the review's
two named concerns turns out not to be a concern at all.

| Target | Errors in `src/` |
|---|---|
| 48.0.4 | **12** |
| 49.1.0 | **12** — byte-identical set to 48 |
| 50.0.4 | **13** — the 48/49 set plus one |

48 and 49 are the same port. 50 costs exactly one extra line.

## The review's two B1 claims, tested

**Claim 1 — "`src/prefs.ts` builds an `Adw.PreferencesWindow`, deprecated in
libadwaita 1.6 in favour of `Adw.PreferencesDialog`. Confirm what
`fillPreferencesWindow` is actually handed on 48/49/50."**

Confirmed, and the answer is **it is still handed an `Adw.PreferencesWindow`,
through GNOME 50**. From `@girs/gnome-shell@50.0.4`:

```ts
fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void>;
```

The extension never constructs the window — the host does. Shell 46's own
`ExtensionPrefsDialog` is itself an `Adw.PreferencesWindow` and passes `this`:

```js
}, class ExtensionPrefsDialog extends Adw.PreferencesWindow {
    prefsObj.fillPreferencesWindow(this);   // extensionPrefsDialog.js:41
```

So the libadwaita deprecation does not reach this extension. There is no
`Adw.PreferencesDialog` migration to do. The single `prefs.ts` error is
unrelated and trivial — see D4.

Worth noting for later: `Adw.PreferencesDialog`, `Adw.ToastOverlay` and
`Adw.AlertDialog` are all **already present on this machine's libadwaita
1.5.0**, so if a future host ever does hand over a dialog, the replacement
types are available on GNOME 46 too.

**Claim 2 — "`package.json` pins `@girs/gnome-shell` to `46.0.2` and every
`@girs/*` override to 46-era typings, so the typechecker cannot see any 46→50
API drift."** Correct, and that is what this report removes.

## The overrides block is not a version pin — it is a deduplicator

This has to be understood before any bump, because it is the trap.

Dropping the `overrides` block while staying on 46 produces **59 errors**, all
of the form `Property 'x' does not exist on type 'Object'`. Cause: npm installs
several incompatible copies of `@girs/gobject-2.0` in nested `node_modules`, so
`GObject.registerClass` resolves against the wrong one and collapses to
`Object`. The overrides exist to force one copy of each package.

They also cannot be bumped in place, because **the package names change**. The
`-14` suffix is GNOME 46's Mutter/Clutter API version:

| | 46 | 48 | 49 | 50 |
|---|---|---|---|---|
| Clutter | `clutter-14` | `clutter-16` | `clutter-17` | `clutter-18` |
| St | `st-14` | `st-16` | `st-17` | `st-18` |
| Meta / Mtk / Shell | `-14` | `-16` | `-17` | `-18` |

GNOME 50's `@girs` also moves to a unified `^4.1.0` version line, unlike the
`-4.0.0-beta.N` scheme on 48/49.

**Procedure that works,** and the one used to produce the numbers above:
install the target with no `overrides` at all, read the resolved top-level
`@girs/*` versions out of `package-lock.json`, write those back as a fresh
`overrides` block, reinstall. That generated 41 entries for 48, 42 for 49, 41
for 50. Without this the error count is dominated by duplicate-package noise
and tells you nothing about real drift.

## The 12–13 errors, by root cause

### D1 — `registerClass` derives constructor arguments from `_init` (6 errors)

The largest cluster, and the only one that is not mechanical.

Newer `@girs/gobject-2.0` types the registered constructor as:

```ts
new (...args: P extends Init ? Parameters<P['_init']> : [void])
```

Arguments come from **`_init`**, not from the TypeScript `constructor`. Four
classes declare a `constructor` with non-GObject parameters and are therefore
mistyped:

| Class | File | Constructor arity |
|---|---|---|
| `Island` | `src/shell/island.ts:105` | 4 |
| `SessionRow` | `src/shell/sessionRow.ts:63` | 5 |
| `PopupHeader` | `src/shell/popupHeader.ts:23` | 2 |
| `EmptyRow` | `src/shell/popupHeader.ts:71` | 1 |

Producing errors at `extension.ts:54`, `island.ts:145`, `island.ts:672-674`
(two of them cascading `implicitly has an 'any' type`), and `island.ts:790`.

**A `declare _init` shim does not work.** It was tried: the base classes
declare `_init` concretely (`_init(params?: Partial<ConstructorProps>): void`
on `PopupBaseMenuItem`, three overloads on `PanelMenu.Button`), so any narrowed
override fails `TS2416`, and the error count went *up*, 13 → 14.

**What does work,** verified by applying it to `popupHeader.ts` alone and
watching the count fall 13 → 11:

```ts
const _PopupHeader = GObject.registerClass(
  class PopupHeader extends PopupMenu.PopupBaseMenuItem { /* unchanged */ }
)

export const PopupHeader = _PopupHeader as unknown as new (
  base: string,
  cb: PopupHeaderCallbacks
) => InstanceType<typeof _PopupHeader>
```

`InstanceType<typeof _PopupHeader>` keeps the subclass's own methods, so call
sites do not lose typing. The cost is one cast per class — four of them — and
the casts must be kept in step with their constructors by hand. That is a real
maintenance tax and the one part of this port worth a design decision rather
than a patch.

### D2 — `menu.open(true)` / `menu.close(true)` (4 errors)

`island.ts:149, 331, 375, 394`. The parameter is now
`BoxPointer.PopupAnimation | undefined`, not a boolean:

```ts
abstract open(animate?: BoxPointer.PopupAnimation): void;
abstract close(animate?: BoxPointer.PopupAnimation): void;
```

Mechanical: `true` becomes `BoxPointer.PopupAnimation.FULL`.

### D3 — `Clutter.Color` no longer exists (1 error)

`src/shell/gridIcon.ts:57`, `function rgba(c: Clutter.Color)`. There are zero
occurrences of `Clutter.Color` in `clutter-18.d.ts`; the type moved to
`Cogl.Color` (`cogl-18.d.ts:6651`). One signature, one import.

### D4 — `fillPreferencesWindow` return type (1 error)

`src/prefs.ts:22`. Nothing to do with libadwaita. Ours is declared
`Promise<void> | void`; the base declares `Promise<void>`, and
`void` is not assignable to `Promise<void>`. One-word fix.

### D5 — panel box position is now a string union (1 error, **GNOME 50 only**)

`src/extension.ts:60`. `Main.panel.addToStatusArea` on 50:

```ts
addToStatusArea<T extends Button>(role: string, indicator: T, position?: number, box?: 'left' | 'center' | 'right'): T;
```

`settings.get_string('panel-position')` is a bare `string`. Needs a cast or a
validating narrow. A validating narrow is better here — the value comes from
gschema and nothing currently stops it being anything.

Note the arity is fine: the four-argument call is still valid. The apparent
"Expected 2-3 arguments, but got 4" at `extension.ts:54` is `new Island(...)`
on the line above, i.e. D1, not the panel API.

### D6 — the Clutter augmentation is pinned to one GNOME version (0 errors, but blocking)

`src/shell/clutter-ease.d.ts:8`:

```ts
declare module '@girs/clutter-14/clutter-14' {
```

The module specifier hardcodes GNOME 46's package name. On any other target the
augmentation silently stops applying and every `.ease()` call loses its type.
It produced no errors above only because the probe rewrote it per target.

This is the one item that **blocks declaring more than one `shell-version` from
a single source tree**, since a `declare module` specifier cannot be
conditional. Options: retarget it per release, or drop the augmentation and
type `ease()` at the call sites instead.

## What this does not tell you

Everything above is `tsc`. It says nothing about:

- whether St / Clutter / Meta **behave** the same at runtime on 48+;
- whether the popup, the panel button, or the permission dialog actually render;
- whether `gjs` on those releases accepts the emitted bundle;
- anything the GIR does not describe, which is exactly where `ease()` lives.

A clean typecheck on 50 is necessary, not sufficient. Runtime validation still
needs a real GNOME 48+ machine — tier 3.

## Recommendation

1. **Target 48, 49 and 50 together, or 50 alone.** 48 and 49 are the same port,
   and 50 costs one extra line. There is no version here that is meaningfully
   cheaper than another, so the choice should be driven by who you want to
   reach, not by porting cost. Note the multi-version blocker in D6.
2. **Do D2–D5 first.** Seven of the thirteen errors, all mechanical, no design
   decisions.
3. **Decide D1 deliberately.** Four casts, hand-maintained. It is the only part
   with an ongoing cost, and it is worth checking whether a newer `@girs` release
   has since improved `RegisteredClass` before committing to the pattern.
4. **Do not ship any of it on a typecheck alone.** D1's casts in particular use
   `as unknown as`, which by construction removes the compiler's ability to tell
   you that you got it wrong.
