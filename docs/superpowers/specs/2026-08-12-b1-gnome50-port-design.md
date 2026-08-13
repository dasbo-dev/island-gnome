# B1 tier 3: finishing the GNOME 50 port

**Date:** 2026-08-12
**Issue:** DIS-15 / B1, from the DIS-14 extensions.gnome.org readiness review
**Predecessors:** read both first —
`docs/superpowers/specs/2026-08-11-b1-typings-drift-report.md` (what breaks),
`docs/superpowers/specs/2026-08-12-b1-port-handoff.md` (the VM, and the recipes)
**Status:** design approved by the owner on 2026-08-12

> **Outcome:** The port landed. Runtime validation reached GNOME 46, 47 and
> 50, not all five Shells this design scoped below — 48 and 49 were deferred
> to DIS-19. The actual, checked-per-version outcome is recorded in
> `docs/superpowers/specs/2026-08-12-b1-port-results.md`; treat this design
> document as the dated plan, not the record of what ran.

This document supersedes the handoff doc wherever the two disagree. Three of
its claims turned out to be stale, and they are corrected below.

## What changed since the handoff doc

Four things were measured on 2026-08-12 that reshape the port.

**1. D6 is dead code, not a blocker.** `src/shell/clutter-ease.d.ts` augments
`Clutter.Actor` with `ease()`, and a repo-wide search finds **zero call sites**:
`.ease(` appears only in two superseded plan documents
(`2026-07-27-dasbo-island.md`, `2026-07-28-robot-pill-icon.md`) and in the
augmentation's own doc comment. The file types a method nothing calls.

This matters beyond one deletion. Both predecessor documents name D6 as the
thing that "blocks declaring more than one `shell-version` from a single source
tree", because a `declare module` specifier cannot be conditional. Deleting the
file removes the specifier and the blocker with it. A version *range* is now
cheap.

**2. There is no upstream fix coming for D1.** `@girs/gnome-shell` is still at
`50.0.4` — the version the drift report measured — and `@girs/gobject-2.0` at
its latest `4.1.0` still declares, at `gobject-2.0.d.ts:107`:

```ts
...args: P extends Init ? Parameters<P['_init']> : [void]
```

The drift report's suggestion to "check whether a newer `@girs` release has
improved `RegisteredClass`" has been checked. It has not. D1 must be solved in
this repository.

**3. D1 and D2 are type-level only.** D1's casts emit nothing at all. D2's
`PopupAnimation` values are plain integers, and GNOME 46's boxpointer already
bit-masks its argument (`animate & PopupAnimation.FADE`), which is why `true`
means SLIDE-only there. The same emitted JavaScript therefore behaves
identically on 46 and on 50. Only the `@girs` typings can target one generation
at a time. This is what makes a declared range defensible rather than reckless.

**4. The handoff doc's nested-shell command does not work on Shell 50.**

```
$ gnome-shell --nested --wayland
Failed to configure: Unknown option --nested
```

GNOME 50 removed the flag; nested is now the default, and `--display-server`
opts *out* of it. The working invocation on 50, verified running clean for 20
seconds:

```bash
export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
       XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0
dbus-run-session -- gnome-shell --wayland --wayland-display=wayland-nested
```

GNOME 46 still has `--nested` and still needs it. The harness branches on
version.

Also observed, and worth knowing before it wastes an hour: installing an
extension with `gnome-extensions install` on a live Wayland session does **not**
make the running Shell see it. `gnome-extensions list` omits it and `enable`
answers `Extension "..." does not exist` with exit 2. The Shell scans at
startup. Use a nested Shell, or log the session out and back in.

## Decisions taken

These were the owner's, not the implementer's, and they are settled.

| Decision | Choice |
|---|---|
| Which `shell-version`s to declare | `["46","47","48","49","50"]` — a 46→50 jump reads badly |
| How 47/48/49 are verified | Nested Shells in podman containers, not new VMs |
| D2 animation | `PopupAnimation.SLIDE` — behaviour-neutral. `FULL` shown afterwards, decided separately |
| D1 pattern | Derived-signature cast (below), falling back to the hand-written form if it fails |

## Scope

Retarget the typings to GNOME 50, close the ten remaining errors, delete one
dead file, widen `shell-version`, and runtime-validate on five real Shells.

Explicitly out of scope: any feature work, any refactor the typings do not
force, and the `PopupAnimation.FULL` question.

## Step 0 — retarget the dependencies

The `overrides` block in `package.json` is a **deduplicator, not a version
pin**. Without it npm installs several incompatible `@girs/gobject-2.0` copies,
`GObject.registerClass` resolves against the wrong one and collapses to
`Object`, and you get 59 `Property 'x' does not exist on type 'Object'` errors
that bury the ten real ones. It also cannot be edited in place, because the
package names carry the Mutter API version (`st-14` → `st-18`).

Two passes, from the handoff doc, unchanged:

```bash
# pass 1 — install the target with NO overrides at all
node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json","utf8"));
  p.devDependencies["@girs/gnome-shell"]="50.0.4"; delete p.overrides;
  fs.writeFileSync("package.json", JSON.stringify(p,null,2)+"\n")'
rm -f package-lock.json && npm install

# pass 2 — pin every top-level @girs to what pass 1 resolved
node -e 'const fs=require("fs");const l=JSON.parse(fs.readFileSync("package-lock.json","utf8"));
  const ov={}; for (const [k,v] of Object.entries(l.packages)) {
    const m=k.match(/^node_modules\/(@girs\/[^/]+)$/);
    if (m && m[1]!=="@girs/gnome-shell") ov[m[1]]=v.version; }
  const p=JSON.parse(fs.readFileSync("package.json","utf8"));
  p.overrides=Object.fromEntries(Object.entries(ov).sort());
  fs.writeFileSync("package.json", JSON.stringify(p,null,2)+"\n")'
rm -f package-lock.json && npm install
```

The handoff doc measured 41 entries for `50.0.4`; the current 46 block has 43.
A materially different count is a signal that pass 2 did not read the lock file
it thought it did.

**Baseline gate.** After the two passes, `tsc --noEmit -p tsconfig.json` must
report **exactly 10 errors**: six from D1, four from D2. If the count differs,
stop and re-measure before changing a line of source. A different number means
either the overrides did not regenerate or something else drifted, and both are
worth knowing before they are mistaken for port breakage.

Note the repo's `typecheck` script runs three projects
(`tsconfig.json`, `tsconfig.test.json`, `tsconfig.site.json`) and sums their
exit codes. The ten-error baseline is `tsconfig.json` alone. The other two are
expected to stay at zero throughout; if the retarget breaks
`tsconfig.test.json`, that is a finding to record, not to route around.

## D6 — delete the Clutter augmentation

Delete `src/shell/clutter-ease.d.ts`.

Verify before deleting, so this rests on a measurement rather than on this
document:

```bash
grep -rn "\.ease(\|ease_property" src/    # expect: no matches
```

Verify after: the error count is unchanged at 10, and the test suite is
unchanged. If the count *rises*, some file was leaning on the augmentation
after all and this step reverts.

## D2 — the popup animation

Four sites, all in `src/shell/island.ts`: lines 149, 331, 375 and 394,
`this.menu.close(true)` and `this.menu.open(true)`.

- GNOME 46 types the parameter `open(animate: boolean)`
- GNOME 50 types it `open(animate?: BoxPointer.PopupAnimation)`

Replace `true` with `BoxPointer.PopupAnimation.SLIDE`.

**Why `SLIDE` and not `FULL`.** `PopupAnimation` is a bit field — `NONE = 0`,
`SLIDE = 1 << 0`, `FADE = 1 << 1`, `FULL = ~0` — and the boxpointer masks it.
`true` is `1`, so today's popup slides without fading, almost certainly by
accident rather than by choice. `SLIDE` preserves that exactly, which keeps the
port provably free of user-visible change.

`FULL` is the more likely *right* answer — stock GNOME popups use it — but it
alters what users see, and that should be a decision someone made while looking
at it. Both animations will be captured on the VM during runtime validation and
put in front of the owner. If `FULL` wins, it is a one-line follow-up with its
own before-and-after, not a UX change smuggled in under a typecheck fix.

## D1 — constructor arguments through `registerClass`

Six errors, at `extension.ts:54`, `island.ts:145`, `island.ts:672-674` (two of
them cascading `implicitly has an 'any' type`) and `island.ts:790`.

Newer `@girs/gobject-2.0` derives the registered constructor's parameters from
`_init`, not from the TypeScript `constructor`. Four classes declare a
constructor taking non-GObject parameters and are therefore mistyped:

| Class | File | Arity |
|---|---|---|
| `Island` | `src/shell/island.ts` | 4 |
| `SessionRow` | `src/shell/sessionRow.ts` | 5 |
| `PopupHeader` | `src/shell/popupHeader.ts` | 2 |
| `EmptyRow` | `src/shell/popupHeader.ts` | 1 |

**Do not retry the `declare _init` shim.** It was tried and it fails: the base
classes declare `_init` concretely (`_init(params?: Partial<ConstructorProps>)`
on `PopupBaseMenuItem`, three overloads on `PanelMenu.Button`), so a narrowed
override fails `TS2416` and the total goes *up*, 13 → 14.

### The pattern

Hold the pre-registration class in a `const` so its constructor can be read
back, keeping the class expression's own name:

```ts
const PopupHeaderImpl = class PopupHeader extends PopupMenu.PopupBaseMenuItem {
  constructor(base: string, cb: PopupHeaderCallbacks) { /* body unchanged */ }
}

const _PopupHeader = GObject.registerClass(PopupHeaderImpl)

export const PopupHeader = _PopupHeader as unknown as new (
  ...args: ConstructorParameters<typeof PopupHeaderImpl>
) => InstanceType<typeof _PopupHeader>
```

Three properties matter here. `ConstructorParameters<typeof PopupHeaderImpl>`
means the exported signature follows the constructor automatically — change an
argument and nothing needs hand-editing, which was the drift report's main
objection to this whole approach. `InstanceType<typeof _PopupHeader>` preserves
the subclass's own methods, so call sites keep their typing. And the class
expression **keeps its original name** while the `const` takes the `Impl`
suffix: GJS derives a GType name from the class's name, so renaming the class
outright would quietly rename its GType. A named class expression assigned to a
differently-named const changes nothing at runtime.

The cast is still `as unknown as` and still suppresses checking. What it now
asserts, though, is only "registration preserves the constructor" — a claim
that is true and that does not rot — rather than a restated signature that can
drift from the code beneath it.

### Guarding the cast

The cast removes the compiler's ability to report a mismatch, so restore it.

**Not in the Vitest suite.** `tsconfig.test.json` sets `"types": ["node"]`
precisely so the gnome-shell ambient types stay out of that program — with both
in one Program, Node's `global` declaration wins and every `Shell.Global` member
access fails `TS7017` — and `test/core/purity.test.ts` enforces that tests reach
only `src/core`, which is free of `gi://` and `resource://` entirely. A test
importing `src/shell/popupHeader.ts` would break both arrangements.

The assertions therefore live in `src/`, next to the classes they guard, as
compile-time types checked by `tsc -p tsconfig.json`. Two shared helpers go in
a new `src/shell/typeAssert.ts`:

```ts
export type Equals<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
  ? true
  : false

export type Assert<T extends true> = T
```

Both are type-only and imported with `import type`, so esbuild erases them; the
file never reaches the bundle.

**What to assert.** Deriving the exported signature makes any
`ConstructorParameters` assertion on it tautological — it would restate the
cast, not test it. The substantive claim, and the one that actually travels
through `RegisteredClass`, is that registration preserves the *instance* type:

```ts
type _PopupHeaderKeepsImpl = Assert<
  Equals<InstanceType<typeof PopupHeader> extends InstanceType<typeof PopupHeaderImpl> ? true : false, true>
>
```

If a future `@girs` changes `RegisteredClass` so the registered instance stops
carrying the implementation's members, this fails to compile and someone reads
this section, instead of the cast silently continuing to lie.

### Fallback

The pattern assumes `GObject.registerClass()` accepts a `const`-held named class
expression as cleanly as the inline argument it is given today. This is expected
to hold — `registerClass` takes a class, and which binding it arrived through is
not something it can observe — but it has not yet been compiled against the 50
typings.

If it does not hold, fall back to the hand-written signature already verified
on `popupHeader.ts` (13 → 11 errors):

```ts
export const PopupHeader = _PopupHeader as unknown as new (
  base: string,
  cb: PopupHeaderCallbacks
) => InstanceType<typeof _PopupHeader>
```

and record in the implementation notes that the derived form was tried and why
it failed. Do not invent a third pattern.

## Metadata and documentation

Widening `shell-version` is one line of JSON with a wider reach than it looks.
The version claim is written down in eight places, and one of them is asserted
against `metadata.json` by a test:

- `metadata.json`: `"shell-version": ["46","47","48","49","50"]`
- `README.md:14` (the badge) and `README.md:86` (the **To run** requirement)
- `CONTRIBUTING.md:63` — "you need GNOME Shell 46"
- `site/index.html:13` (`og:description`), `:62` (hero fine print, which
  currently promises "47 and 48 support is planned"), `:149` (install section)
- `site/index.html:29` — the JSON-LD `operatingSystem`. `test/site/head.test.ts:58`
  builds its expectation as ``GNOME Shell ${metadata['shell-version'].join(', ')}``,
  so this string has to be character-exact or that test fails
- `test/site/indexCopy.test.ts:45-47` and `:100` assert the copy says
  "GNOME Shell 46 only". Those assertions are the specification of the old
  claim and have to be rewritten to specify the new one — first, and watched
  failing, before the HTML is touched
- `CHANGELOG.md` gets a **new** entry under `[Unreleased]`

`CHANGELOG.md:71` and `docs/copy-seo-audit-2026-08-10.md` are left alone. Both
are dated records of what was true when they were written; editing them to
match today falsifies the record.

`version-name` stays at `0.1.0`. Nothing here is a user-facing release; the
bump belongs to whatever run actually submits to extensions.gnome.org.

## Runtime validation

A clean typecheck is necessary and not sufficient. `tsc` says nothing about
whether St, Clutter and Meta *behave* the same on 50.

### The harness, per version

| Shell | Where | Method |
|---|---|---|
| 46 | Host (Ubuntu 24.04) | Nested: `dbus-run-session -- gnome-shell --nested --wayland` |
| 47, 48, 49 | Podman containers inside the VM | Fedora 41/42/43 images + `gnome-shell`, nested headless against the guest's `wayland-0` |
| 50 | VM (Fedora 44) | Nested, **and** the real Wayland session |

The host runs GNOME 46 and is the owner's daily driver, so 46 is validated
**nested only** — no logout, no risk to a working session. Podman is present in
the guest (`/usr/bin/podman`, 33 GB free on `/`); the host has only Docker, so
the containers live in the VM.

Every command that talks to a Shell needs
`DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus` exported. An SSH
session is `Type=tty` and has no session bus of its own; without it, failures
read as extension bugs when they are not.

Guest access: `fedora@192.168.122.66`, key `~/.ssh/id_ed25519`, passwordless
sudo. The username is `fedora`, not `fsevenm`.

### Snapshot discipline

Revert whenever a Shell is left wedged:

```bash
sg libvirt -c "virsh -c qemu:///system destroy gnome50"
sg libvirt -c "virsh -c qemu:///system snapshot-revert gnome50 clean"
sg libvirt -c "virsh -c qemu:///system start gnome50"
```

`clean` predates any extension install, so reverting also discards the
containers and anything else installed in the guest. Keep the working tree on
the **host** and copy in.

### What to exercise

Ordered by how likely the breakage is and how invisible it would be. Items 1-3
run on every version. Items 4-8 all rest on rendering or on a real session, so
they run on 50 only — a headless container cannot judge any of them honestly.

1. **The extension loads and `enable()` runs** with a clean journal.
2. **The popup opens and closes.**
3. **`disable()` tears everything down.** Disable, re-enable, confirm nothing
   is duplicated and the journal stays clean. Extension reviewers test exactly
   this, and leaks here are the most common rejection reason.
4. **Animations still run.** Nothing in the source calls `ease()` any
   more, which is why D6 could be deleted, but transitions driven by St and CSS
   still need looking at.
5. **The panel button appears in the configured box**, and changing
   `panel-position` in preferences moves it — this exercises D5 against a real
   panel.
6. **Preferences opens**, every page renders, and the About page's QR image
   loads. That asset comes from `assets/` and fails silently when absent.
7. **The agent chips carry their marks** — same silent-failure class, from
   `icons/`.
8. **The full hook round trip:** run an agent inside the guest, install
   hooks from preferences, confirm a session appears. `windowFinder.ts` reads
   `/proc/<pid>/stat` and `/proc/<pid>/cmdline` to walk from a session to its
   terminal, and PIDs only line up when the agent and the Shell share a
   namespace — so this is the one check a container could never have done.

### Honesty rule for the containers

A nested headless Shell has no seat, no GPU acceleration and a stub portal. It
proves load, enable, disable, D-Bus and widget construction. It does not prove
rendering fidelity.

Where a container cannot judge something, the implementation notes say so
explicitly and mark that version as static-evidence-only for that check. A
version is never recorded as "verified" on the strength of a check that did not
actually run.

## Known costs

**GNOME 46 stops being typechecked.** One `node_modules` holds one `@girs`
generation, so pinning to 50 means 46 is declared and runtime-tested but no
longer type-verified. There is no cheap fix — a second checkout with 46
typings would be the only real one, and it is not worth its maintenance for
this port. The nested 46 harness is the compensating control, and this
paragraph is the record that the trade was made deliberately.

**47, 48 and 49 are verified more weakly than 46 and 50.** Containers, not
sessions. Accepted knowingly; see the honesty rule.

**The D1 casts remain casts.** The derived signature and the type-level
assertions narrow the blast radius, they do not remove it.

## Delivery

Work happens in a worktree on branch `b1-gnome50-port`. Commits are ordered so
each is independently green:

1. `chore(deps)` — retarget `@girs` to 50, regenerate overrides (10 errors, a
   measured and expected red)
2. `chore(types)` — delete the dead Clutter augmentation
3. `fix(types)` — D2, `PopupAnimation.SLIDE`
4. `fix(types)` — D1, four classes plus their type-level assertions (typecheck
   green from here)
5. `feat(metadata)` — widen `shell-version`, update the README

Merge to `main`, delete the branch, remove the worktree.

**`main` is not merged on a green typecheck alone.** The runtime checklist runs
first, on all five Shells, and its results are recorded before the merge.
