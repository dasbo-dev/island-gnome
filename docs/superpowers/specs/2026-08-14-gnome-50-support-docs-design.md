# Bringing the documents up to date with GNOME 47-50 validation

**Date:** 2026-08-14
**Issue:** DIS-21, following DIS-19
**Predecessor records:** `docs/superpowers/specs/2026-08-12-b1-port-results.md`,
`docs/superpowers/plans/2026-08-12-b1-gnome50-port.md`

## The problem

The declared range is not what is stale. `metadata.json` already declares
`shell-version: ["46","47","48","49","50"]`, and every place a reader meets that
range — the README badge and Requirements list, the landing page hero and
install section, the JSON-LD `operatingSystem`, CONTRIBUTING — already says
46 to 50. Those landed with the port merge.

What is stale is the account of **what that declaration rests on**. The port
shipped with 48 and 49 unrun, said so honestly, and pointed at DIS-19 as the
work that would close the gap. DIS-19 is now Done: 47, 48, 49 and 50 each ran a
six-case functional suite on a real Shell, and every case passed. Two documents
still describe the world as it was before that:

- `CHANGELOG.md` tells a user reading release notes that 48 and 49 have had
  *no runtime validation*, and names DIS-19 in the future tense as where that
  work is tracked. That sentence is now false.
- `docs/superpowers/specs/2026-08-12-b1-port-results.md` carries a per-version
  table whose 48 and 49 rows read `none — deferred`, and a verdict that ends
  "which is weaker and is why DIS-19 exists".

Nothing records DIS-19's own results inside the repository at all. They exist
only as issue comments.

## Scope

Three files. Documentation only: no source, no schemas, no tests, no
`metadata.json`.

| File | Change |
|---|---|
| `CHANGELOG.md` | Rewrite the evidence sentences of the GNOME-range bullet under Unreleased → Changed |
| `docs/superpowers/specs/2026-08-14-dis19-gnome-47-50-results.md` | New. The DIS-19 record |
| `docs/superpowers/specs/2026-08-12-b1-port-results.md` | Status block at the top; body untouched |

**Deliberately unchanged:** `README.md`, `site/index.html`, `metadata.json`,
`CONTRIBUTING.md`, `docs/limitations.md`, and every test. The user-facing copy
states the supported range and no verification claim; the owner's call is that
it keeps doing exactly that. Widening it into a "tested on" claim is a separate
decision and not this issue's.

`.github/ISSUE_TEMPLATE/bug_report.yml` was checked and is fine: its GNOME
Shell field is free text and `GNOME Shell 46.0` is a placeholder example, not a
supported-version list.

## What DIS-19 actually established

Two runs, both by the GSE Tester agent against the installed build, with
extension version validation left **on** — so each load also proves the widened
`metadata.json` is what permits it.

| Case | 47.10 | 48.8 | 49.9 | 50.4 |
|---|---|---|---|---|
| TC-01 load + enable, no `JS ERROR` | pass | pass | pass | pass |
| TC-02 owns `org.dasbo.Island`, `Ping` → `0.1.0` | pass | pass | pass | pass |
| TC-03 session chip visible in the panel | pass | pass | pass | pass |
| TC-04 permission popup renders, timeout reply | pass | pass | pass | pass |
| TC-05 disable/re-enable, bus name and chip | pass | pass | pass | pass |
| TC-06 preferences window renders | pass | pass | pass | pass |

47 and 48 ran nested; 49 and 50 ran under `gnome-shell --devkit`, which is what
`--nested`'s removal in 49 leaves. Zero cases failed on any Shell.

The first run left 49 and 50's visual half unobserved — devkit produced no
pixels — and the second closed it after the testing skill gained a `bwrap` shim
and a screenshot helper that owns `org.gnome.SettingsDaemon.MediaKeys`.

Still unexercised on every version, and it stays that way: the Allow / Deny /
Always-allow / Jump buttons were never physically clicked (headless runs inject
no input, so the decision channel was proven through the timeout fall-through),
no hook round trip with a live agent, no sound, and no Codex session — Claude
only, by the tester's resolved question.

GNOME 46 was not part of DIS-19; its evidence is the port's own nested run,
recorded in the 2026-08-12 document.

## The changes

### 1. CHANGELOG.md

The bullet under Unreleased → Changed currently reads:

> Supported GNOME Shell versions widen from 46 alone to **46 through 50**.
> The typings target 50; 46, 47 and 50 are covered by runtime validation,
> since one dependency tree can hold only one `@girs` generation. 48 and 49
> rest on that same typing diff alone — no runtime validation has been done
> on either yet, and that work is tracked as DIS-19. Nothing a user can see
> changes on 46 — the port is type-level, and the popup animation is pinned
> to the value the old code already produced.

It becomes, keeping the first sentence and the last:

> Supported GNOME Shell versions widen from 46 alone to **46 through 50**.
> The typings target 50, since one dependency tree can hold only one `@girs`
> generation, and the range is backed by runtime validation rather than by that
> typing target: every declared version loads and enables on a real Shell, and
> live 47, 48, 49 and 50 sessions were driven through the chip, the permission
> popup, disable and re-enable, and the preferences window. Nothing a user can
> see changes on 46 — the port is type-level, and the popup animation is pinned
> to the value the old code already produced.

Every clause is a thing someone observed. It names no version as weaker than
another and adds no per-version scoreboard to release notes.

### 2. The DIS-19 results document

`docs/superpowers/specs/2026-08-14-dis19-gnome-47-50-results.md`, modelled on
its 2026-08-12 predecessor: a dated record, not a living page. Sections:

1. **What ran** — the table above, plus how each Shell was brought up (nested
   for 47/48, devkit for 49/50) and the fact that version validation stayed on.
2. **Evidence, one decisive line per case** — the `('0.1.0',)` from `Ping`, the
   `1 · thinking` chip, the permission row and its
   `"permissionDecision":"ask"` fall-through reply, the
   `(false,)` → `(true,)` bus-name transition, and which screenshot shows the
   preferences window on each Shell.
3. **What is still unexercised** — the list above, stated as plainly as the
   predecessor states its own gaps.
4. **Environment findings worth keeping** — these cost the run real time and
   none is an extension defect:
   - Icons render as blank boxes in a distrobox devkit until glycin's `bwrap`
     is shimmed; without it the Claude mark and the gear are empty rounded
     rectangles, and so is GNOME's own chrome.
   - On 50, the GTK 4.20 preferences helper blocks on
     `Cannot get portal org.freedesktop.portal.Settings version: Timeout was
     reached` and `OpenExtensionPrefs` answers `Error: Timeout was reached`;
     `GDK_DEBUG=no-portals` clears it.
   - `GDK_BACKEND=x11` must be scoped to `devkit-run.sh` alone. Exported
     session-wide it is inherited by the D-Bus-activated preferences helper,
     whose window then opens on the host display instead of the session.
   - The shell's screenshot API answers only senders owning
     `org.gnome.SettingsDaemon.MediaKeys` or the desktop portal name.
   - Writing `enabled-extensions` on a live session does nothing — the running
     Shell rewrites the key from its own state. `disable-user-extensions` is
     the lever that works.
   - A dconf write to a running devkit shell may not reach it: the observed
     permission countdown stayed at the built-in value while read-back showed
     the written one.
   - `--nested` is absent from 49 and 50, present through 48. Any tooling that
     branches on "46 has it, 50 does not" must treat 49 as the cut line.
5. **Verdict** — 47 through 50 are validated against the six criteria; 46's
   evidence remains what the 2026-08-12 document records; the declared range
   stands, now on measurement rather than on a typing diff.

Artifacts live in the tester's `~/dasbo-qa-shots/`, outside the repository, and
the document says so rather than pretending they are checked in.

### 3. Status block on the port-results document

Six lines at the top of `docs/superpowers/specs/2026-08-12-b1-port-results.md`,
above the existing title block, saying: this is the dated record of the port as
it stood on 2026-08-12; its 48 and 49 rows were closed by DIS-19 on 2026-08-14;
the table below is not current and the newer document is. Nothing else in the
file changes — same treatment commit `94b9d16` gave the port design document,
and for the same reason: a dated record that gets edited to match today stops
being a record.

## Verification

- `npm test` — 66 files, 937 tests, all passing before any change. No test
  asserts on `CHANGELOG.md` or on anything under `docs/superpowers/`, so the
  count and result must be identical afterwards.
- `npm run typecheck` — unchanged sources, must stay clean.
- `node build.mjs` — must still emit `dist/` and `dist-site/`. Only
  `docs/limitations.md` and `docs/agent-dialects.md` are published as site
  pages (`site/docPages.mjs`), and neither is touched, so `dist-site/` should be
  byte-identical.
- `test/docs/links.test.ts` covers cross-document links; the new document links
  only to files that exist.

## Risks

Low, and all of one kind: a document that overstates what was measured. The
mitigation is that every sentence added here traces to a line in the DIS-19
comments, and the two things that were *not* measured — button clicks and the
live hook round trip — are written down rather than left to inference.
