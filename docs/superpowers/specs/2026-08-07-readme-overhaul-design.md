# README overhaul and project logo — design

Date: 2026-08-07
Issue: DIS-3 "Improve readme file"

## Problem

The README is 169 lines of unbroken prose. It opens with two sentences of
description and then runs eleven paragraphs deep into pill animation states,
sound-theme behaviour, and unverified permission paths before a reader has
seen a single image, badge, or heading they can scan. The project has no
logo in the repository, no CI badge, no contribution guide, no issue
templates, and no security policy — the files GitHub surfaces on the repo
landing page and in its community-standards check.

The writing itself is good and unusually honest. The problem is ordering and
packaging, not content.

## Goals

1. A README shaped like the ones on well-known open-source projects: logo
   header, badges, a visual, scannable sections, deep material linked rather
   than inlined.
2. The attached mark (`dasbo-logo-mark.svg`) rendered in that header, legible
   on both GitHub themes.
3. The community-health files GitHub looks for.
4. Continuous integration that runs on pull requests, so the build badge
   reports something real.
5. Every existing caveat preserved somewhere in the repository. Nothing is
   deleted to make the front page prettier.

## Non-goals

- Redesigning the landing page in `site/`.
- Adding the logo to the preferences About page or to `src/icons/`.
- Publishing to extensions.gnome.org, or tagging a release.
- Rewriting `docs/agent-dialects.md`.

## Decisions taken with the operator

| Question | Answer |
|---|---|
| Scope | README + logo + community files + CHANGELOG + SECURITY |
| Hero visual | Hand-authored mockup SVG now; real screenshots swapped in later |
| Logo | Two theme variants switched by `<picture>` |
| Caveats | Short "Status & known limitations" in README, full text in `docs/limitations.md` |
| Canonical repo | `github.com/dasbo-dev/island-gnome` |
| Badges | Add `ci.yml`, badge it |
| Structure | Canonical OSS layout, keeping the existing prose voice in "How it works" |

## Constraint discovered during exploration

`test/repoUrls.test.ts` sweeps `metadata.json`, `README.md`, and
`site/index.html`. It asserts each file **contains**
`github.com/dasbo-dev/island-gnome` and **does not contain**
`github.com/fsevenm/dasbo-island` or `github.com/ayubaswad/dasbo-island`.
The rewritten README must satisfy both. The Pages URL
`https://fsevenm.github.io/dasbo-island/` is deliberately exempt — that test's
own comment records that the site is still served from there while the
repository moved — so the demo link stays as it is.

## Components

### 1. Logo assets

Two files under `docs/assets/`:

- `logo-dark.svg` — for GitHub's dark theme. The attached mark's colours
  unchanged: body `#E9E9EC`, bulb `#7B92F5`.
- `logo-light.svg` — for GitHub's light theme. Body recoloured to `#2E2E33`;
  bulb stays `#7B92F5`, which reads on both backgrounds.

Both keep the source geometry exactly: the same mask with its two eye
circles, the same rounded-rect body (`rx="4.6"`), the same neck and bulb.

The source `viewBox` is `0 0 24 24`, but the drawing occupies x 2.5–17.5 and
y 0.5–20. The mark therefore sits up and to the left of centre, which is
invisible at 24px and obvious at 120px. Both variants use a recentred square
`viewBox` of `-1.25 -1 22.5 22.5`: the content's own centre is (10, 10.25)
and its largest dimension is 19.5 units, so a 22.5-unit square centred there
gives 1.5 units of even padding. The masking rect (`-6 -6 36 36`) already
covers this region, so the mask is unaffected. No path data changes.

Rendered in the README at `width="120"`.

### 2. Hero mockup

`docs/assets/hero.svg`, hand-authored. It draws what a user would photograph:
a GNOME top bar strip — Activities, clock, and the pill mid-`working` with
its 2×2 grid — above the popup showing three session rows that mirror the
content `site/index.html` already renders:

| Row | State | Detail |
|---|---|---|
| Claude | working | project `rocket`, `2/6` tasks, `4m`, activity `Bash · npm test` |
| Codex | working | project `website`, `2m`, activity `Bash · vitest run` |
| Antigravity | idle | project `blog`, `1m` |

Drawn on dark GNOME chrome, so one file reads against either GitHub theme
without a `<picture>` switch. Agent chips are drawn as simple coloured marks
rather than embedding `src/icons/*.svg`, keeping the file self-contained.

The image's alt text and the caption line beneath it both say the word
"mockup". When real captures arrive they replace this file at the same path
and the caption line comes out.

### 3. README structure

In order:

1. **Header** (centred HTML block): logo `<picture>`, project name, one-line
   tagline, badge row, and a link line — Live demo · Documentation ·
   Contributing · Changelog.
2. **Hero** image plus mockup caption.
3. **What it is** — one short paragraph, then the live-demo pointer that
   currently sits at the top of the file.
4. **Table of contents** — short, one level deep.
5. **Features** — six bullets with bold lead-ins: top-bar status, inline
   permission approval, jump back to the terminal, multi-agent, task-list
   progress, desktop sound cues.
6. **Requirements** — GNOME Shell 46, X11 or Wayland.
7. **Install** — the existing `make install` / enable / reload sequence and
   the hook-installation step, with the Codex trust approval raised into a
   `> [!IMPORTANT]` callout. That step is the highest-cost thing for a Codex
   user to miss: without it the hooks sit in the file and never fire.
8. **How it works** — the existing prose, kept in its own voice, covering the
   pill grid states, the agent chip, hook freshness and **Update**, task
   lists, waiting messages, sounds, and panel position.
9. **Supported agents** — the existing table, plus the fail-open guarantee.
10. **Status & known limitations** — one line per limitation, each linking
    into `docs/limitations.md`.
11. **Development** — the existing commands, the `src/core` purity rule, and
    the site preview instructions.
12. **Contributing** — short paragraph linking `CONTRIBUTING.md` and
    `CODE_OF_CONDUCT.md`.
13. **License** — GPL-3.0-or-later, linking `LICENSE`.
14. **Credits** — inspired by open-vibe-island; author and support links taken
    from the values already in `src/core/about.ts`.

Badge row: CI status from `ci.yml`, licence GPL-3.0, GNOME Shell 46. All
badge and link URLs use `dasbo-dev/island-gnome`.

### 4. `docs/limitations.md`

A relocation, not a rewrite. Moved out of the README, text preserved:

- GNOME's `event-sounds` handling by mutter's sound player is unverified; the
  extension checks the key itself.
- No one has confirmed any of the four cues is audible on a live desktop.
- Codex has no permission gate through dasbo; `codexAdapter.encodeDecision`
  is unit-tested and never reached from a real session.
- Antigravity's permission decision path is unverified and may fail open —
  Deny reporting a denial while the tool executes anyway.
- Antigravity's `complete` and `message-new-instant` cues are structurally
  dead, not merely unverified.
- Claude Code's `SessionEnd` and `Notification` handling is inferred rather
  than captured.

Each README bullet in section 10 states the limitation in one line and links
here for the full account. The Antigravity fail-open warning appears in full
in both places — a user can install those hooks straight from the README's
install section, so that warning has to survive the trip.

### 5. Community-health files

- **`CONTRIBUTING.md`** — clone and setup, the `npm test` and
  `npm run typecheck` gates, `node build.mjs`, the rule that `src/core/` must
  never import `gi://` or `resource://` (and that `test/core/purity.test.ts`
  enforces it), the conventional-commit style already visible in the log
  (`feat(prefs):`, `fix:`, `docs:`, `test:`, `build:`), and a pointer to
  `docs/agent-dialects.md` for anyone adding an agent adapter.
- **`CODE_OF_CONDUCT.md`** — Contributor Covenant 2.1, contact
  `ayubaswad@gmail.com`.
- **`SECURITY.md`** — report privately by email rather than through a public
  issue; states the fail-open guarantee as the project's security posture and
  lists the unverified Antigravity permission gate as a known open issue with
  a link to `docs/limitations.md`.
- **`CHANGELOG.md`** — Keep a Changelog format. The repository has no git
  tags, so there is no released version to date: everything shipped so far
  goes under `[Unreleased]`, grouped as Added / Fixed. No release date is
  invented.
- **`.github/ISSUE_TEMPLATE/bug_report.yml`** — GNOME Shell version, X11 or
  Wayland, which agent and its version, extension version, steps, and a log
  field prompting `journalctl -f -o cat /usr/bin/gnome-shell`.
- **`.github/ISSUE_TEMPLATE/feature_request.yml`** — problem, proposal,
  alternatives.
- **`.github/ISSUE_TEMPLATE/config.yml`** — `blank_issues_enabled: false`.
- **`.github/PULL_REQUEST_TEMPLATE.md`** — what changed, why, and a checklist:
  tests pass, typecheck passes, no `gi://` added under `src/core/`, docs
  updated if behaviour changed.

### 6. CI workflow

`.github/workflows/ci.yml`:

- Triggers: `push` to `master`/`main`, `pull_request`, `workflow_dispatch`.
- Ubuntu, Node 22, `npm ci`, then `npm test`, `npm run typecheck`,
  `node build.mjs`.
- `permissions: contents: read`.
- Concurrency group keyed on the ref, cancelling in-flight runs. This is safe
  here in a way it is not in `site.yml`, which deploys and therefore sets
  `cancel-in-progress: false`.

`site.yml` already runs the same four commands on pushes to master, so master
pushes will run them twice. That duplication is deliberate: `site.yml` exists
to deploy and has no pull-request trigger, so without `ci.yml` no pull request
is ever checked. Splitting the two also keeps the badge honest — a red badge
means the code is broken, not that a Pages deploy failed.

## Verification

Before merge:

- `npm test` — 618 tests passing (the current baseline), with
  `test/repoUrls.test.ts` still green against the rewritten README.
- `npm run typecheck` — clean.
- `node build.mjs` — succeeds.
- Every relative link in `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, and
  `docs/limitations.md` resolves to a file that exists in the tree.
- `logo-light.svg`, `logo-dark.svg`, and `hero.svg` parse as well-formed XML.
- The workflow and issue-template YAML files parse.

The final check is the operator's: GitHub's `<picture>` theme switching and
the rendered SVGs can only be confirmed on github.com after the branch is
pushed.

## Risks

- **The mockup is a drawing.** A hand-authored SVG can drift from what the
  extension actually looks like. Mitigated by labelling it a mockup in the
  alt text and the caption, and by treating it as a placeholder for real
  captures.
- **Badge URLs point at a repository this checkout has no remote for.**
  `git remote -v` is empty here. The badges follow `test/repoUrls.test.ts`
  and the operator's answer, so they are as correct as anything else in the
  tree, but they cannot be resolved before push.
- **Moving caveats out of the README lowers their visibility.** Mitigated by
  keeping the two that change what a user should do — the Codex trust step
  and the Antigravity fail-open gate — in the README body, not just in the
  linked file.
