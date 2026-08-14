# DIS-19 results: GNOME Shell 47 through 50, six cases, all passing

**Date:** 2026-08-14
**Issue:** DIS-19, the deferred half of DIS-15 / B1
**Predecessor:** `docs/superpowers/specs/2026-08-12-b1-port-results.md` — what
each declared version rested on when the port merged
**Design for the documentation update this produced:**
`docs/superpowers/specs/2026-08-14-gnome-50-support-docs-design.md`

The port merged with 48 and 49 declared on static evidence alone: a typings
diff showed they produce a byte-identical error set, and nobody had run
either. This document records the run that closed that gap, and it records
what the run still did not touch.

## What ran

Three sessions of work, all against the installed build in
`~/.local/share/gnome-shell/extensions/dasbo-island@ayubaswad.gmail.com`,
byte-identical to `dist/`. Extension version validation was left **on**
throughout, so every successful load is also direct evidence that the widened
`metadata.json` is what permits it.

| Case | 47.10 | 48.8 | 49.9 | 50.4 |
|---|---|---|---|---|
| TC-01 load and `enable()`, no `JS ERROR` | pass | pass | pass | pass |
| TC-02 owns `org.dasbo.Island`, `Ping` | pass | pass | pass | pass |
| TC-03 session chip visible in the panel | pass | pass | pass | pass |
| TC-04 permission popup renders, timeout reply | pass | pass | pass | pass |
| TC-05 disable and re-enable | pass | pass | pass | pass |
| TC-06 preferences window renders | pass | pass | pass | pass |

**No case failed on any Shell.** 47 and 48 ran nested; 49 and 50 ran under
`gnome-shell --devkit`, which is what `--nested`'s removal in 49 leaves.

47 and 48 passed all six on the first pass. 49 and 50 needed three: the first
proved their D-Bus behaviour but produced no pixels, the second closed 49's
visual half by dropping `--virtual-monitor`, and the third closed 50's after
the testing skill gained a `bwrap` shim and a screenshot helper that owns
`org.gnome.SettingsDaemon.MediaKeys`. Every retry was a change to the harness.
Nothing in `src/` was touched between them.

## Evidence, one decisive line per case

- **TC-01** — no `JS ERROR` and no `dasbo-island:` warning in any session log:
  `gnome47-session.log`, `gnome48-session.log`, `gnome49-session.log`,
  `gnome50-session.log`.
- **TC-02** — `('0.1.0',)` on all four.
- **TC-03** — the top bar reads `1 · thinking` with the Claude glyph:
  `47-tc03.png`, `48-tc03.png`, `49-tc03.png`, `50-tc03.png`.
- **TC-04** — the popup carries the row `Claude dasbo-island / waiting for you
  · Bash · ls -la` with `Allow / Deny / Always allow / Jump`, and the held call
  returns
  `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"Dasbo Island timed out waiting for an answer"}}`
  — the fall-through, so the agent is never left blocked.
- **TC-05** — `name owner after disable: (false,)` → `after re-enable:
  (true,)` on all four, with `*-tc05-off.png` showing no chip and
  `*-tc05-on.png` exactly one, reading `1 · idle`. On 47 and 48 the extension
  state also went `INACTIVE` → `ACTIVE`.
- **TC-06** — the preferences window rendered with its Appearance, Behavior,
  Agents and About pages on 47 and 48 (`47-tc06.png`, `48-tc06.png`); on 49 it
  rendered inside the session showing the Panel and Session rows
  (`49-tc06.png`); on 50 the same window came up in the adaptive narrow layout
  with the view switcher at the bottom (`50-tc06.png`).

Screenshots and logs live in the tester's `~/dasbo-qa-shots/`, outside this
repository. They are not checked in, and this document is the only record of
them here.

## What is still unexercised

Unchanged by this run, on every version:

- **The popup's buttons were never physically clicked.** Allow, Deny, Always
  allow and Jump are proven to render and nothing more — a headless run can
  inject no input, so the decision channel was exercised through the timeout
  fall-through instead.
- **No hook round trip with a live agent.** No `claude` or `codex` binary was
  installed in any of the containers.
- **No sound.** Nothing in the harness can listen.
- **No Codex session.** Claude only, by the tester's own resolved question.
- **GNOME 46 was not in scope here.** Its evidence remains the port's nested
  run on the host, recorded in
  `docs/superpowers/specs/2026-08-12-b1-port-results.md`.

## Environment findings worth keeping

None of these is an extension defect. All of them cost the run real time.

- **Icons render as blank rounded boxes in a distrobox devkit** until glycin's
  `bwrap` is shimmed. Without the shim the Claude mark and the popup's gear
  are empty boxes — and so are GNOME's own app-grid button and quick-settings
  pill, which is what identifies it as an environment gap rather than ours.
- **The GTK 4.20 preferences helper blocks on the portal on 50:** `Cannot get
  portal org.freedesktop.portal.Settings version: Timeout was reached`, with
  `OpenExtensionPrefs` answering `Error: Timeout was reached`.
  `GDK_DEBUG=no-portals` clears it.
- **`GDK_BACKEND=x11` must be scoped to `devkit-run.sh` alone.** Exported
  session-wide, it is inherited by the D-Bus-activated preferences helper,
  whose window then opens on the host display instead of inside the session,
  where no capture can see it.
- **The shell's screenshot API answers only privileged senders** — those
  owning `org.gnome.SettingsDaemon.MediaKeys` or the desktop portal name. A
  plain `gdbus` call gets `AccessDenied: Screenshot is not allowed`.
- **Writing `enabled-extensions` on a live session does nothing.** The running
  Shell rewrites the key from its own state. `disable-user-extensions` is the
  lever that works.
- **A dconf write may never reach a running devkit shell.** The permission
  countdown showed 36s and 46s against the 8s written to the devkit database,
  while read-back showed the written value — the running shell never got the
  change notification. It did not affect TC-04, whose expected result was the
  timeout fall-through either way.
- **`gnome50-dev` has no `/run/dbus/system_bus_socket`**; the host bus is
  mounted in, per the testing skill.
- **`--nested` is absent from 49 and 50 and present through 48.** Any tooling
  that branches on "46 has it, 50 does not" must treat 49 as the cut line.

## Verdict

47, 48, 49 and 50 are validated against all six acceptance criteria, UI
included. 46 is unchanged by this run and rests on what the 2026-08-12
document records. The declared `shell-version` range stands as it is, now on
measurement across four of its five versions rather than on a typing diff
across two of them.
