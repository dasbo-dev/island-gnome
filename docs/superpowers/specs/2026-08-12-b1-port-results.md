# B1 port results: what each declared GNOME version's support actually rests on

**Date:** 2026-08-12
**Issue:** DIS-15 / B1, from the DIS-14 extensions.gnome.org readiness review
**Design:** `docs/superpowers/specs/2026-08-12-b1-gnome50-port-design.md`
**Plan:** `docs/superpowers/plans/2026-08-12-b1-gnome50-port.md`
**Status:** superseded in part on 2026-08-14

> **Outcome:** The two deferred rows are closed. DIS-19 ran a six-case
> functional suite on 47, 48, 49 and 50 and every case passed on every one of
> them, so the 48 and 49 rows below are no longer current. That run is
> recorded in
> `docs/superpowers/specs/2026-08-14-dis19-gnome-47-50-results.md`; treat this
> document as what was known on 2026-08-12.

`metadata.json` now declares `shell-version: ["46","47","48","49","50"]`. This
document records what each of those five declarations is actually backed by, so
that nobody has to infer it from a green typecheck.

Read the table's "not run" cells as seriously as its passes. They are the point
of the exercise.

## The table

Checks 1-8 are the plan's runtime checklist. **pass** means observed. **n/r**
means not run, and every one is explained below the table.

| Version | Evidence grade | 1 load + `enable()` | 2 popup opens/closes | 3 `disable()` teardown | 4 animations | 5 panel box | 6 preferences | 7 chips | 8 hook round trip |
|---|---|---|---|---|---|---|---|---|---|
| **46** | real Shell, nested (host) | pass | pass | pass | n/r | pass | n/r | pass | n/r |
| **47** | container, headless | pass | pass | pass | n/r | n/r | n/r | n/r | n/r |
| **48** | **none — deferred** | n/r | n/r | n/r | n/r | n/r | n/r | n/r | n/r |
| **49** | **none — deferred** | n/r | n/r | n/r | n/r | n/r | n/r | n/r | n/r |
| **50** | real Shell, live session (VM) | pass | pass | pass | n/r | pass | pass | pass | n/r |

**Zero checks failed anywhere.** Nothing on this branch was retried until it
passed; the failures column is empty because there were none, not because none
were looked for.

## What each version got

### GNOME 46 — the host, nested

The version that matters most, because the `@girs` typings no longer cover it:
46 is declared and shipped but not type-checked, so this run is the only direct
evidence the port did not break it.

Nested Shell self-reported `46.0` on `mutter 46.2`. `GetExtensionInfo` returned
state `1` (ENABLED) with an empty `error`, **with version validation left on** —
so the load itself proves the widened `metadata.json` is what permits it.
`org.dasbo.Island.Ping` answered `0.1.0`. The popup opened and closed through
the changed `BoxPointer.PopupAnimation.SLIDE` path. Four enable cycles left
exactly one bus-name owner and one panel pill; three back-to-back cycles emitted
zero log lines. Zero `JS ERROR`, zero `JS WARNING`.

Not run on 46: the Allow / Deny / Always-allow buttons were never physically
clicked — there is no input-injection tool on the host and `Eval` is locked, and
injecting XTEST would have stolen focus from the owner's live session. The
decision channel was verified through the timeout branch instead. Preferences
was not opened. A single 210 ms burst of 24 `Clutter-WARNING` lines is recorded
**unattributed**: the evidence points at the owner's pointer crossing the nested
window, but the controlled comparison was interrupted, so it is not written down
as explained.

### GNOME 47 — a container

Image built on Fedora 41, which reported `GNOME Shell 47.10`.

State `1` and `Ping` → `0.1.0`. Both `Notify` calls returned cleanly.
`RequestPermission` *blocked* for the full client timeout rather than erroring,
which is the blocking-popup path behaving correctly — the popup was built and
the call is being held open for a click a headless container can never deliver.
Two full disable/enable cycles: state `2` and `Ping` → `ServiceUnknown` after
each disable, state `1` and `Ping` → `0.1.0` after each enable. Zero `JS ERROR`
across the whole run, and the extension logged nothing at all.

Why check 3 is load-bearing here: `enable()` calls
`Main.panel.addToStatusArea(this.uuid, ...)` (`src/extension.ts:57`), which
throws on a duplicate role. A leaked indicator would make the *second* `enable`
raise an extension-point conflict and report state `3`. It reported `1` every
time.

Not run on 47: the direct panel-duplication probe. `Shell.Eval` is locked on 47
— `org.gnome.Shell.UnsafeMode` does not exist there and `Eval` returns
`(false, '')` — so "exactly one indicator in `Main.panel.statusArea`" was never
directly observed on any version. The duplication evidence is the indirect
`addToStatusArea`-would-throw argument, which is strong but inferential.

### GNOME 48 and 49 — deferred to DIS-19

**These two are declared on static evidence alone.** The typings drift report
found 48 and 49 produce a byte-identical error set to each other, which is real
evidence that the port applies to them, but nobody has run either.

The groundwork is done and waiting, so DIS-19 is not starting from zero:

- Container images are built in the `gnome50` guest: `localhost/dasbo-test:f42`
  (reports `GNOME Shell 48.8`) and `localhost/dasbo-test:f43` (`49.9`).
- A working harness is on the guest at `/tmp/dasbo/outer.sh` and
  `/tmp/dasbo/inner.sh`, already proven end to end on 47.
- Three container-infrastructure fixes are already found, and none is an
  extension defect: SELinux needs `--security-opt label=disable`; headless needs
  `--no-x11` plus a writable `/tmp/.X11-unix`, or mutter dies on
  `Failed to start X Wayland`; and the Fedora image's empty `/run/systemd/seats`
  makes Shell take the logind path in a container with no logind, segfaulting in
  `loginManager.js` — remove `/run/systemd/{seats,sessions,users}` to select
  `LoginManagerDummy` and fork a container-local `dbus-daemon --system`.

Reverting the guest's `clean` snapshot destroys those images. Prefer removing a
container.

### GNOME 50 — the VM, live session

State `1` with version validation on, and a **control**: narrowing the installed
`metadata.json` back to `["46"]` produced state `4` (OUT_OF_DATE) and no island.
So the widened declaration is demonstrably what makes the extension loadable on
50, rather than something else masking a bad declaration.

Six disable/enable cycles released and reacquired `org.dasbo.Island` cleanly,
left one island and one row, and produced no journal output at all. Across the
entire run: zero `JS ERROR`, zero `JS WARNING`, zero `dasbo` lines.

Preferences opened with every page rendering and the About page's QR image
loading — that asset comes from `assets/` and fails silently when absent, so it
needed eyes. The chips carried their marks. The panel button appeared in the
configured box and moved when `panel-position` changed, exercising the
already-landed D5 narrow against a real panel.

## The two checks nobody ran on any version

### Check 4 — animations

Not run anywhere, for two different reasons, neither of which is the extension's
fault.

On the **50 guest**, animations are disabled system-wide: virtio-gpu is built
`-virgl`, so mutter renders in software and GNOME Shell turns transitions off.
This was controlled for rather than assumed — GNOME's *own* Overview transition
showed zero intermediate frames across 40 samples on the same guest. The
extension's own timer-driven grid-icon animation *was* separately observed
running, through four distinct chase poses, so the animation machinery is alive
even though compositor transitions are not.

On **46**, the nested Shell was not driven through a transition capture.

**This is the check most worth a human's eyes**, and it is the one below.

### Check 8 — the hook round trip

Not run on any version: no `claude` or `codex` binary exists in the guest, and
installing one was out of scope.

A substantial partial was recorded on 50 instead. The real `hooks/dasbo-hook`
was driven under gjs 1.88, handled both notify and permission, and returned
`permissionDecision: allow` on stdout. Hook install and removal through
preferences were verified. The `/proc` ancestry walk in `windowFinder.ts`
resolved a real `claude`-named process and its start time. What remains unproven
is only the end-to-end path with a live agent — which is precisely the thing no
container could ever test, since PIDs only line up when the agent and the Shell
share a namespace.

## SLIDE versus FULL — still open, and yours

Task 3 pinned `BoxPointer.PopupAnimation.SLIDE`, which preserves today's
animation exactly. The port therefore changes nothing a user can see.

`PopupAnimation` is a bit field — `NONE = 0`, `SLIDE = 1 << 0`, `FADE = 1 << 1`,
`FULL = ~0` — that the boxpointer masks, so the `true` the code passed before
was the SLIDE bit and nothing else. The popup has always slid without fading,
almost certainly by accident. Stock GNOME popups use `FULL`.

The comparison was **not captured**. It is a judgement about motion, a still
frame cannot answer it, and the guest's software rendering disables exactly the
transitions that would need judging. If `FULL` is wanted it is a one-line change
with its own before-and-after, made deliberately rather than smuggled in under a
typecheck fix.

## Findings worth keeping

**`--nested` was removed in GNOME 49, not 50.** Measured, not assumed, with
`gnome-shell --help` inside each image: present on 46, 47.10 and 48.8; **absent
on 49.9 and 50**. Any tooling in this project that branches on "46 has it, 50
does not" must treat 49 as the cut line. `--headless --virtual-monitor WxH` is
present on all five and is the portable replacement.

**`gnome-extensions install` does not make a running Shell see an extension.**
The files land correctly, but `gnome-extensions list` omits it and `enable`
answers `Extension "..." does not exist` with exit 2. The Shell scans at startup.

**`GetExtensionInfo` state 4 is OUT_OF_DATE**, not 6. The handoff document had
this wrong.

**A crashed Shell can leave `/run/user/1000/gnome-shell-disable-extensions`**,
which silently disables every extension until removed.

**GDM autologin stops firing after roughly two in-boot restarts** on the guest;
budget a reboot.

## An incident, recorded because it should not recur

During the GNOME 46 run a `gsettings` write escaped its sandbox and reached the
host owner's real dconf, replacing `org.gnome.shell enabled-extensions` with
`['dasbo-island@ayubaswad.gmail.com']`. The cause: a `dbus-daemon` was forked
*before* `XDG_CONFIG_HOME` was exported, so `dconf-service` inherited the host
environment and wrote to the real database.

Nothing broke visibly, because the running Shell had already read the true list
at login and kept it in memory. But the next login would have started with none
of the owner's extensions.

Repaired by reading the live list back out of the running Shell, dropping
`dasbo-island`, and writing the remaining 15 entries back; dconf and the live
session now agree. Unrecoverable in principle: any extension that was listed in
dconf but had failed to load at login would not appear in the live list and so
would not have been restored.

The run also left an inert copy of the extension at
`~/.local/share/gnome-shell/extensions/dasbo-island@ayubaswad.gmail.com`. It is
not in `enabled-extensions` and does not load.

**The lesson for any future validation run:** export every `XDG_*` redirect
before anything forks a bus. The container harness built for 47 does this
correctly and mounts no host runtime directory at all — its session bus was a
private `unix:path=/tmp/dbus-XXXXXX` on every run.

## Verdict on the declared range

46, 47 and 50 are tested. 48 and 49 are asserted from a byte-identical typing
diff and inherit confidence from their neighbours on either side, which is
weaker and is why DIS-19 exists.

Declaring all five is defensible on that basis — the port is type-level, the
emitted JavaScript is identical across the range, and the two untested versions
sit between three tested ones. It is a judgement, not a measurement, and this
document exists so it stays visible as one.
