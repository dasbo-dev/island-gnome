# B1 port handoff: finishing the GNOME 50 port on a real Shell

**Date:** 2026-08-12
**Issue:** B1, from the DIS-14 extensions.gnome.org readiness review
**Predecessor:** `docs/superpowers/specs/2026-08-11-b1-typings-drift-report.md` — read it first
**Audience:** a fresh session with SSH access to the VM described below

Tiers 1 and 2 are done. This is tier 3: the part that needs a real GNOME Shell
above 46, which now exists.

## The environment, verified

Every line below was checked on 2026-08-12, not assumed.

| | |
|---|---|
| Host | Ubuntu 24.04.4, GNOME Shell 46.0, libvirt + KVM |
| Guest | **Fedora Linux 44 (Workstation Edition)** |
| Guest GNOME | **GNOME Shell 50.0** — the current stable target |
| gjs | 1.88.0 (host is 1.80.2) |
| node / npm | v22.23.1 / 10.9.8 |
| Domain | `gnome50`, running |
| Address | `192.168.122.66` |
| SSH | `fedora@192.168.122.66`, host key `~/.ssh/id_ed25519` already authorised |
| sudo | passwordless — confirmed |
| Session | Wayland, **active**, autologin working |
| Snapshot | **`clean`** exists, taken in `shutoff` state |
| Toolchain | `git node npm make zip unzip glib-compile-schemas gnome-extensions dbus-run-session` all present |
| Network | GitHub reachable from the guest |

Note the username is **`fedora`**, not `fsevenm`.

`Xvfb` is absent. It is not needed — there is a real Wayland session — but a
headless approach would have to install it first.

### The live session is drivable over SSH

This was tested and works, and it is the thing that makes the whole exercise
possible:

```bash
ssh fedora@192.168.122.66 \
  'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
   gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
   --method org.freedesktop.DBus.Properties.Get org.gnome.Shell ShellVersion'
# => (<'50.0'>,)
```

**Every command that talks to the Shell needs
`DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus` exported.** An SSH
session is `Type=tty` and has no session bus of its own; without this you get
confusing "cannot connect" errors that look like the extension's fault.

### Snapshot discipline

Revert whenever the Shell is left wedged:

```bash
sg libvirt -c "virsh -c qemu:///system destroy gnome50"
sg libvirt -c "virsh -c qemu:///system snapshot-revert gnome50 clean"
sg libvirt -c "virsh -c qemu:///system start gnome50"
```

`clean` predates any extension install. Reverting also discards anything you
installed in the guest, so keep the working tree on the **host** and copy in.

## What is already done, and must not be redone

Landed on `main`, `main` is green at GNOME 46 (typecheck exit 0, 892 tests
across 64 files):

- **D3** — `rgba()` takes `ReturnType<St.ThemeNode['get_foreground_color']>`
  instead of naming `Clutter.Color`.
- **D4** — `fillPreferencesWindow` declares `Promise<void>`, deliberately
  **not** `async`. Do not "tidy" this into an `async` method: the Shell calls
  it without awaiting, so `async` converts a throw into an unhandled rejection
  and a blank window instead of the error page. The reasoning is in the code
  comment; leave it.
- **D5** — `panelBox()` in `src/core/panelBox.ts`, a checked narrow tested
  against the gschema's own `<choices>`.

Also already answered, so do not spend time re-investigating: **the host still
hands `fillPreferencesWindow` an `Adw.PreferencesWindow` on GNOME 50.** There
is no `Adw.PreferencesDialog` migration in this port.

## What remains: 10 typecheck errors

Reproduce them first, before changing anything, so you are working from a
measured baseline rather than this document.

### Step 0 — regenerate the overrides block

This is the part that goes wrong if skipped. The `overrides` block in
`package.json` is a **deduplicator**, not a version pin: without it npm installs
several incompatible `@girs/gobject-2.0` copies and `registerClass` collapses to
`Object`, giving 59 junk errors that hide the real ones. It also cannot be
bumped in place, because the package names carry the Mutter API version
(`st-14` → `st-18`, and so on).

Two-pass procedure, verified:

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

That generated 41 entries for 50.0.4. Expect **10 errors** in
`tsc --noEmit -p tsconfig.json` afterwards, plus D6 below.

### D6 — retarget the Clutter augmentation (blocking, 0 errors of its own)

`src/shell/clutter-ease.d.ts:8` reads `declare module
'@girs/clutter-14/clutter-14'`. The specifier hardcodes GNOME 46's package
name; on 50 it must be `clutter-18` or the augmentation silently stops applying
and every `.ease()` call loses its type without producing an error.

**This is also what blocks declaring more than one `shell-version` from one
source tree**, since a `declare module` specifier cannot be conditional. If the
decision is to support a range, this needs a different approach — dropping the
augmentation and typing `ease()` at its call sites is the obvious candidate.
That is a design decision, not a mechanical edit.

### D1 — `registerClass` derives constructor args from `_init` (6 errors)

`extension.ts:54`, `island.ts:145`, `island.ts:672-674`, `island.ts:790`.

Newer `@girs/gobject-2.0` types the registered constructor as:

```ts
new (...args: P extends Init ? Parameters<P['_init']> : [void])
```

Arguments come from `_init`, not from the TypeScript `constructor`. Four
classes declare a `constructor` taking non-GObject parameters:
`Island` (4 args), `SessionRow` (5), `PopupHeader` (2), `EmptyRow` (1).

**A `declare _init` shim does not work — this was tried.** The base classes
declare `_init` concretely, so a narrowed override fails `TS2416` and the total
went *up*, 13 → 14. Do not retry it.

**The recipe that does work,** verified on `popupHeader.ts` alone (13 → 11):

```ts
const _PopupHeader = GObject.registerClass(
  class PopupHeader extends PopupMenu.PopupBaseMenuItem { /* body unchanged */ }
)

export const PopupHeader = _PopupHeader as unknown as new (
  base: string,
  cb: PopupHeaderCallbacks
) => InstanceType<typeof _PopupHeader>
```

`InstanceType<typeof _PopupHeader>` preserves the subclass's own methods, so
call sites keep their typing.

**Before applying this four times, check whether a newer `@girs` release has
improved `RegisteredClass`.** The cast is `as unknown as`, which by
construction removes the compiler's ability to tell you the signature is wrong,
and it has to be kept in step with each constructor by hand. Ten minutes on the
changelog is worth it against that ongoing cost.

### D2 — `PopupAnimation` (4 errors)

`island.ts:149, 331, 375, 394` — `this.menu.close(true)` and `.open(true)`.

- GNOME 46: `open(animate: boolean)`
- GNOME 50: `open(animate?: BoxPointer.PopupAnimation)`

No single expression satisfies both, which is why this was left for the bump
rather than landed early.

**This one is not cosmetic, and it is the single most important thing to
actually look at on screen.** `PopupAnimation` is a bit field — `NONE = 0`,
`SLIDE = 1 << 0`, `FADE = 1 << 1`, `FULL = ~0`. The current `true` sets only
the `SLIDE` bit, so today's animation is slide-without-fade, probably by
accident. Moving to `PopupAnimation.FULL` changes what the user sees. Open the
popup on the VM and judge it; do not just make the type error go away.

## Runtime validation — the actual point of this tier

A clean typecheck is necessary and not sufficient. `tsc` says nothing about
whether St, Clutter and Meta *behave* the same on 50, and nothing at all about
`ease()`, which is patched onto `Clutter.Actor` at runtime and is not in the
GIR.

Install and enable:

```bash
# on the host, from a clean checkout
make pack
scp dasbo-island@ayubaswad.gmail.com.shell-extension.zip fedora@192.168.122.66:/tmp/

# in the guest
ssh fedora@192.168.122.66
export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus
gnome-extensions install --force /tmp/dasbo-island@ayubaswad.gmail.com.shell-extension.zip
gnome-extensions enable dasbo-island@ayubaswad.gmail.com
journalctl --user -f -o cat /usr/bin/gnome-shell   # watch this while testing
```

On Wayland the Shell cannot be restarted in place, so after installing either
log the session out and back in, or use a nested shell:

```bash
dbus-run-session -- gnome-shell --nested --wayland
```

The nested shell is strongly preferred while iterating — it restarts on crash
without taking the session with it.

### What to actually exercise

Ordered by how likely it is to be broken and how invisible the breakage would be:

1. **The extension loads and `enable()` runs** with nothing in the journal.
2. **The popup opens and closes**, and the animation looks right — this is D2.
3. **`ease()` animations still run.** The grid icon and the island's transitions
   depend on a runtime-patched method with no GIR entry. If `ease()` were
   missing, the fallback is silence, not an error.
4. **The panel button appears in the configured box**, and changing
   `panel-position` in preferences moves it — this exercises D5 against a real
   panel.
5. **Preferences opens**, every page renders, and the About page's QR image
   loads — that last one comes from `assets/`, which the packaging work now
   guards, and it fails silently when absent.
6. **The agent chips carry their marks** — same silent-failure class, from
   `icons/`.
7. **`disable()` tears everything down.** Disable, re-enable, and confirm the
   journal is clean and nothing is duplicated. Extension reviewers test exactly
   this, and leaks here are the most common rejection reason.
8. **The full hook round trip**, if you can face it: run an agent inside the
   guest, install hooks from preferences, and confirm a session appears. This
   is the one thing a container could never have tested — `windowFinder.ts`
   reads `/proc/<pid>/stat` and `/proc/<pid>/cmdline` to walk from a session to
   its terminal, and PIDs only line up when the agent and the Shell share a
   namespace.

## Decisions that need the owner, not the implementer

1. **Which `shell-version`s to declare.** 48 and 49 produced a byte-identical
   error set to each other, so they are one port; 50 costs one extra line. But
   the guideline is to declare only what you have actually run, and only 50 is
   available on this VM. Declaring `["50"]` alone is defensible and cheapest.
   Anything wider needs more VMs, and needs D6 solved.
2. **Whether to drop GNOME 46.** The host runs 46 and it is the only machine
   the owner uses daily. Landing D1 and D2 means `main` no longer typechecks on
   46. That is a real loss of a test surface, and it should be a deliberate
   choice rather than a side effect of finishing the port.
3. **The D1 cast pattern**, if `@girs` has not improved in the meantime.

## Suggested order

1. Confirm the VM answers, and confirm the `clean` snapshot exists.
2. Install the **current** `main` build on the guest unmodified, and see what a
   GNOME-46-targeted extension actually does on Shell 50. This is free
   information and nobody has collected it yet — it may turn out to load fine,
   which would reframe the whole port.
3. Regenerate overrides for 50, reproduce the 10 errors.
4. Apply D6, then D2, then D1.
5. Runtime-validate the list above.
6. Bring the `shell-version` and README badge decisions back to the owner
   before changing `metadata.json`.

Do not merge a port to `main` on a green typecheck alone.
