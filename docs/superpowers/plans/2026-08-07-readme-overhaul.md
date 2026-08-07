# README Overhaul and Project Logo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `README.md` into the canonical open-source layout, add the project mark as two theme-aware SVG variants plus a hero mockup, relocate the deep caveats into `docs/limitations.md`, and add the community-health files and a pull-request CI workflow.

**Architecture:** Everything here is documentation and static assets. The repository already treats documentation as testable — `test/repoUrls.test.ts` sweeps three files for a stale repository slug — so each task in this plan follows the same pattern: a guard test in `test/docs/` that fails first, then the file that satisfies it. No runtime code changes, no new dependencies.

**Tech Stack:** Markdown, hand-authored SVG, GitHub Actions YAML, Vitest (already present), Node 22.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-07-readme-overhaul-design.md`.
- Canonical repository slug is `dasbo-dev/island-gnome`. `test/repoUrls.test.ts` asserts `README.md`, `metadata.json`, and `site/index.html` each **contain** `github.com/dasbo-dev/island-gnome` and contain **neither** `github.com/fsevenm/dasbo-island` nor `github.com/ayubaswad/dasbo-island`.
- The Pages URL `https://fsevenm.github.io/dasbo-island/` is exempt from that sweep on purpose and stays as it is.
- Tests read files by path relative to the repository root (Vitest's cwd). Follow the existing style in `test/shell/iconAssets.test.ts`.
- Baseline before any change: `npm test` → 36 files, 618 tests, 0 failures.
- Never delete a caveat. Text moved out of `README.md` lands in `docs/limitations.md` intact.
- Contact address for community files: `ayubaswad@gmail.com`. Author handle: `fsevenm`. Support URL: `https://buymeacoffee.com/fsevenm`. These match `src/core/about.ts`.
- Commit style is conventional commits, as in the existing log: `feat(prefs):`, `fix:`, `docs:`, `test:`, `build:`.
- Work happens on the branch `worktree-readme-overhaul` in the worktree at `.claude/worktrees/readme-overhaul`.

---

### Task 1: Logo assets

**Files:**
- Create: `docs/assets/logo-light.svg`
- Create: `docs/assets/logo-dark.svg`
- Test: `test/docs/readmeAssets.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: two SVG files at fixed paths. Task 4's README header references both through `<picture>`. Both share the `viewBox` string `-1.25 -1 22.5 22.5` and differ from each other only by the body colour (`#2E2E33` light, `#E9E9EC` dark).

**Background for the implementer:** the source mark is 24×24 with its drawing occupying x 2.5–17.5 and y 0.5–20 — off-centre up and to the left, unnoticeable at 24px and obvious at 120px. The content centre is (10, 10.25) and its largest dimension is 19.5 units, so a 22.5-unit square centred there gives even padding of 1.5 units: `viewBox="-1.25 -1 22.5 22.5"`. The masking rect already spans `-6 -6 36 36`, so it still covers the enlarged region. No path data changes.

- [ ] **Step 1: Write the failing test**

Create `test/docs/readmeAssets.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// These two files exist only for the README header, which switches between
// them on prefers-color-scheme. Nothing else in the repo reads them, and both
// failure modes are silent on GitHub: a missing file renders as nothing, and
// the dark variant on a light page renders as a near-white mark on white,
// which also reads as nothing. This test is the only check either gets.
const VIEWBOX = 'viewBox="-1.25 -1 22.5 22.5"'
const BULB = '#7B92F5'
const BODY: Record<string, string> = {
  'logo-light': '#2E2E33',
  'logo-dark': '#E9E9EC',
}

describe('the project logo', () => {
  for (const [name, body] of Object.entries(BODY)) {
    const path = `docs/assets/${name}.svg`

    it(`${path} draws the recentred mark in its own body colour`, () => {
      // readFileSync throwing on a missing file *is* the existence assertion.
      const svg = readFileSync(path, 'utf8')
      expect(svg, `${path} needs the recentred viewBox`).toContain(VIEWBOX)
      expect(svg, `${path} body should be ${body}`).toContain(`fill="${body}"`)
      expect(svg, `${path} bulb should stay ${BULB}`).toContain(`fill="${BULB}"`)
      // The two eyes are punched out of the body by the mask, not drawn.
      expect(svg.match(/<circle[^>]*fill="#000"/g) ?? [], `${path} lost an eye`).toHaveLength(2)
    })
  }

  // Stronger than checking colours one file at a time: it says the light
  // variant is the dark one recoloured, so geometry can never drift apart.
  it('differ from each other only in the body colour', () => {
    const light = readFileSync('docs/assets/logo-light.svg', 'utf8')
    const dark = readFileSync('docs/assets/logo-dark.svg', 'utf8')
    expect(light.replaceAll('#2E2E33', '#E9E9EC')).toBe(dark)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/docs/readmeAssets.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, open 'docs/assets/logo-light.svg'`

- [ ] **Step 3: Create the light variant**

Create `docs/assets/logo-light.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1.25 -1 22.5 22.5" width="120" height="120" role="img" aria-label="Dasbo Island">
  <defs>
    <mask id="eyes">
      <rect x="-6" y="-6" width="36" height="36" fill="#fff"/>
      <circle cx="6.7" cy="13.4" r="1.75" fill="#000"/>
      <circle cx="13.3" cy="13.4" r="1.75" fill="#000"/>
    </mask>
  </defs>
  <g mask="url(#eyes)">
    <rect x="2.5" y="7" width="15" height="13" rx="4.6" fill="#2E2E33"/>
    <rect x="9.15" y="3.2" width="1.7" height="4.2" rx="0.85" fill="#2E2E33"/>
    <circle cx="10" cy="2.5" r="2" fill="#7B92F5"/>
  </g>
</svg>
```

- [ ] **Step 4: Create the dark variant**

Create `docs/assets/logo-dark.svg` — byte-for-byte the file above with `#2E2E33` replaced by `#E9E9EC` in both places:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1.25 -1 22.5 22.5" width="120" height="120" role="img" aria-label="Dasbo Island">
  <defs>
    <mask id="eyes">
      <rect x="-6" y="-6" width="36" height="36" fill="#fff"/>
      <circle cx="6.7" cy="13.4" r="1.75" fill="#000"/>
      <circle cx="13.3" cy="13.4" r="1.75" fill="#000"/>
    </mask>
  </defs>
  <g mask="url(#eyes)">
    <rect x="2.5" y="7" width="15" height="13" rx="4.6" fill="#E9E9EC"/>
    <rect x="9.15" y="3.2" width="1.7" height="4.2" rx="0.85" fill="#E9E9EC"/>
    <circle cx="10" cy="2.5" r="2" fill="#7B92F5"/>
  </g>
</svg>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/docs/readmeAssets.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 6: Verify both files are well-formed XML**

Run: `python3 -c "import xml.dom.minidom as m; [m.parse(p) for p in ['docs/assets/logo-light.svg','docs/assets/logo-dark.svg']]; print('ok')"`
Expected: `ok`

- [ ] **Step 7: Commit**

```bash
git add docs/assets/logo-light.svg docs/assets/logo-dark.svg test/docs/readmeAssets.test.ts
git commit -m "feat(docs): add the project mark as two theme variants"
```

---

### Task 2: Hero mockup

**Files:**
- Create: `docs/assets/hero.svg`
- Modify: `test/docs/readmeAssets.test.ts` (append a second `describe` block)

**Interfaces:**
- Consumes: nothing from Task 1 — the hero draws its own agent marks rather than referencing `src/icons/*.svg`, so the file stands alone when GitHub serves it through its image proxy.
- Produces: `docs/assets/hero.svg`, referenced by Task 4's README. Contains a `<title>` element whose text includes the word `Mockup`.

- [ ] **Step 1: Write the failing test**

Append to `test/docs/readmeAssets.test.ts`:

```ts
describe('the hero mockup', () => {
  const path = 'docs/assets/hero.svg'

  it('draws a row for every supported agent', () => {
    const svg = readFileSync(path, 'utf8')
    for (const agent of ['Claude', 'Codex', 'Antigravity']) {
      expect(svg, `${path} is missing the ${agent} row`).toContain(agent)
    }
  })

  // A drawing of the UI can drift from the UI. Saying so inside the file
  // keeps the disclaimer attached to the asset rather than only to the
  // README paragraph that happens to embed it today.
  it('calls itself a mockup, so nobody mistakes it for a capture', () => {
    const svg = readFileSync(path, 'utf8')
    expect(svg).toMatch(/<title>[^<]*[Mm]ockup/)
  })

  it('is self-contained — no reference to src/icons', () => {
    const svg = readFileSync(path, 'utf8')
    expect(svg).not.toContain('src/icons')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/docs/readmeAssets.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, open 'docs/assets/hero.svg'`

- [ ] **Step 3: Create the hero mockup**

Create `docs/assets/hero.svg`. The scene: GNOME top bar with the pill mid-`working`, the popup below it listing three sessions, and the terminal running one of them on the left. Colours are taken from the repo — agent marks use the strokes pinned in `test/shell/iconAssets.test.ts` (`claude #d97757`, `codex #9e9e9e`, `antigravity #4285f4`).

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 400" width="1000" height="400" role="img" aria-labelledby="t">
  <title id="t">Mockup: the Dasbo Island pill in the GNOME top bar, its popup listing three live agent sessions, and the terminal running one of them</title>

  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2b2440"/>
      <stop offset="1" stop-color="#14131a"/>
    </linearGradient>
    <style>
      .ui { font-family: Cantarell, "DejaVu Sans", "Segoe UI", sans-serif; }
      .mono { font-family: ui-monospace, "DejaVu Sans Mono", "Courier New", monospace; }
      .dim { fill: #b6b6bd; }
      .bright { fill: #f2f2f5; }
    </style>
  </defs>

  <rect width="1000" height="400" rx="12" fill="url(#wall)"/>

  <!-- top bar -->
  <path d="M0 12a12 12 0 0 1 12-12h976a12 12 0 0 1 12 12v24H0z" fill="#0b0b0d"/>
  <text class="ui bright" x="20" y="24" font-size="13">Activities</text>
  <text class="ui bright" x="452" y="24" font-size="13">Tue Aug 5  14:32</text>

  <!-- pill, mid-working: one block lit, one trailing, two dim -->
  <rect x="600" y="6" width="122" height="24" rx="12" fill="#ffffff" fill-opacity="0.13"/>
  <rect x="611" y="12" width="5" height="5" rx="1.2" fill="#e9e9ec" fill-opacity="0.55"/>
  <rect x="618" y="12" width="5" height="5" rx="1.2" fill="#e9e9ec"/>
  <rect x="611" y="19" width="5" height="5" rx="1.2" fill="#e9e9ec" fill-opacity="0.3"/>
  <rect x="618" y="19" width="5" height="5" rx="1.2" fill="#e9e9ec" fill-opacity="0.3"/>
  <text class="ui bright" x="632" y="22" font-size="12">3 · working</text>

  <!-- terminal the pill jumps back to -->
  <rect x="40" y="96" width="440" height="256" rx="10" fill="#0f0f13" stroke="#2c2c33"/>
  <path d="M40 106a10 10 0 0 1 10-10h420a10 10 0 0 1 10 10v18H40z" fill="#1d1d22"/>
  <circle cx="58" cy="110" r="4" fill="#3a3a41"/>
  <circle cx="72" cy="110" r="4" fill="#3a3a41"/>
  <text class="ui dim" x="90" y="114" font-size="11">rocket — claude</text>
  <text class="mono dim" x="60" y="152" font-size="12">$ claude</text>
  <text class="mono" x="60" y="176" font-size="12" fill="#d97757">●</text>
  <text class="mono bright" x="76" y="176" font-size="12">Bash(npm test -- countdown)</text>
  <text class="mono dim" x="76" y="196" font-size="12">⎿  618 passed</text>
  <text class="mono" x="60" y="222" font-size="12" fill="#d97757">●</text>
  <text class="mono bright" x="76" y="222" font-size="12">Edit(src/core/pill.ts)</text>
  <text class="mono dim" x="76" y="242" font-size="12">⎿  2 additions, 1 removal</text>
  <text class="mono" x="60" y="268" font-size="12" fill="#d97757">●</text>
  <text class="mono bright" x="76" y="268" font-size="12">Bash(npm test)</text>
  <text class="mono dim" x="60" y="296" font-size="12">  running…</text>

  <!-- popup -->
  <rect x="520" y="48" width="440" height="220" rx="14" fill="#2b2b30" stroke="#3a3a41"/>

  <!-- row 1: Claude, working -->
  <rect x="532" y="62" width="416" height="56" rx="8" fill="#ffffff" fill-opacity="0.05"/>
  <circle cx="552" cy="80" r="7" fill="none" stroke="#d97757" stroke-width="2"/>
  <text class="ui bright" x="568" y="84" font-size="13">Claude</text>
  <text class="ui dim" x="624" y="84" font-size="13">rocket</text>
  <text class="ui dim" x="936" y="84" font-size="12" text-anchor="end">2/6   4m</text>
  <text class="ui dim" x="552" y="104" font-size="12">Bash · npm test -- countdown</text>

  <!-- row 2: Codex, working -->
  <rect x="532" y="130" width="416" height="56" rx="8" fill="#ffffff" fill-opacity="0.05"/>
  <circle cx="552" cy="148" r="7" fill="none" stroke="#9e9e9e" stroke-width="2"/>
  <text class="ui bright" x="568" y="152" font-size="13">Codex</text>
  <text class="ui dim" x="620" y="152" font-size="13">website</text>
  <text class="ui dim" x="936" y="152" font-size="12" text-anchor="end">2m</text>
  <text class="ui dim" x="552" y="172" font-size="12">Bash · vitest run</text>

  <!-- row 3: Antigravity, idle -->
  <rect x="532" y="198" width="416" height="56" rx="8" fill="#ffffff" fill-opacity="0.05"/>
  <circle cx="552" cy="216" r="7" fill="none" stroke="#4285f4" stroke-width="2"/>
  <text class="ui bright" x="568" y="220" font-size="13">Antigravity</text>
  <text class="ui dim" x="648" y="220" font-size="13">blog</text>
  <text class="ui dim" x="936" y="220" font-size="12" text-anchor="end">1m</text>
  <text class="ui dim" x="552" y="240" font-size="12">idle</text>
</svg>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/docs/readmeAssets.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Verify the file is well-formed XML**

Run: `python3 -c "import xml.dom.minidom as m; m.parse('docs/assets/hero.svg'); print('ok')"`
Expected: `ok`

- [ ] **Step 6: Commit**

```bash
git add docs/assets/hero.svg test/docs/readmeAssets.test.ts
git commit -m "feat(docs): add a hero mockup of the pill, popup, and terminal"
```

---

### Task 3: `docs/limitations.md`

**Files:**
- Create: `docs/limitations.md`
- Test: `test/docs/limitations.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `docs/limitations.md` with the anchor headings `#### The Antigravity permission gate may fail open`, `#### Codex has no permission gate`, `#### Two sound cues are dead for Antigravity`, `#### No cue has been confirmed audible`, `#### Claude Code's SessionEnd and Notification are inferred`. Task 4's README links to this file.

**Note for the implementer:** this is a relocation. The prose below is lifted from the current `README.md` with only the connective tissue changed. Do not paraphrase it into something milder.

- [ ] **Step 1: Write the failing test**

Create `test/docs/limitations.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Everything here was on the README's front page before it was restructured.
// Moving a warning is fine; losing one in the move is not, and a deleted
// paragraph leaves no trace anyone would notice. These are the five claims
// that have to survive.
const MUST_STATE = [
  'failing open',
  'notify-only',
  'structurally dead',
  'has not been verified',
  'inferred',
]

describe('docs/limitations.md', () => {
  const text = readFileSync('docs/limitations.md', 'utf8')

  for (const claim of MUST_STATE) {
    it(`still states "${claim}"`, () => {
      expect(text).toContain(claim)
    })
  }

  it('names the code paths a reader would go looking for', () => {
    expect(text).toContain('codexAdapter.encodeDecision')
    expect(text).toContain('antigravityAdapter.encodeDecision')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/docs/limitations.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, open 'docs/limitations.md'`

- [ ] **Step 3: Write the document**

Create `docs/limitations.md`:

```markdown
# Known limitations

Everything on this page is something the project knows it has not proven. It
is kept separate from the [README](../README.md) so the front page stays
readable, not to keep it quiet — the two warnings that change what a user
should actually do, the Codex trust step and the Antigravity permission gate,
are stated in the README as well.

For the payload shapes behind all of this, see
[agent-dialects.md](agent-dialects.md).

## Permissions

#### The Antigravity permission gate may fail open

Status reporting for Antigravity CLI — session start, tool start and end,
stop — is verified against 12 real captured hook-payload fixtures. The
**permission decision path is not**. No fixture exercises a real Antigravity
permission round-trip, and `docs/agent-dialects.md` documents payload shapes
but never a response schema, so the `{permissionDecision,
permissionDecisionReason}` shape that `antigravityAdapter.encodeDecision`
emits is a guess.

If `agy` ignores an unrecognised stdout shape, clicking **Deny** reports the
tool as denied while it executes anyway — a security control failing open,
silently. Treat the Antigravity permission gate as best-effort and unverified
until someone confirms it against a real payload.

#### Codex has no permission gate

Codex's `PreToolUse` hook rejects an `allow` or `ask` decision outright, and
approvals ride a separate `PermissionRequest` event that dasbo does not wire.
Every Codex hook is therefore installed notify-only. `codexAdapter.encodeDecision`
is exercised by unit tests and is never reached from a real Codex session.

## Sound

#### Two sound cues are dead for Antigravity

Antigravity's adapter maps no `session-end` and no `notification` event, so an
`agy` session can never reach the `done` state through an event and never
carries a notice. The `complete` and `message-new-instant` cues are
structurally dead for this agent, not merely unverified.

#### No cue has been confirmed audible

Whether GNOME's own `event-sounds` setting is honoured by mutter's sound
player has not been verified; this extension checks the key itself before
playing, so the setting is respected either way.

Nor has anyone confirmed that any of the four cues is actually audible on a
live desktop. The test suite can pin the decision logic and the wiring, but
nothing in it can listen.

## Coverage

#### Claude Code's SessionEnd and Notification are inferred

Claude Code's dialect is verified against 17 real hook-payload fixtures, but
`SessionEnd` and `Notification` are not among them — their handling is
inferred from the documented shape rather than captured from a live session.

#### Codex hooks written before 0.146.0 never fired

Codex 0.146.0 speaks Claude's hook dialect: an event-keyed map under `hooks`,
PascalCase event names, and `hook_event_name` / `session_id` / `cwd` /
`tool_name` payloads. Every dasbo release before the current one wrote the
older named-hook form — `{"dasbo-island": {"command": …, "events":
["session.start", …]}}` — which Codex parses without complaint and never
fires. **Update** in the preferences replaces it. Six events are installed:
`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`,
`SessionEnd`. All six were captured firing; the fixtures are in
`test/fixtures/codex/`.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/docs/limitations.test.ts`
Expected: PASS — 6 tests (five claims plus the code-path check).

- [ ] **Step 5: Commit**

```bash
git add docs/limitations.md test/docs/limitations.test.ts
git commit -m "docs: move the unverified-behaviour caveats into their own page"
```

---

### Task 4: The README rewrite

**Files:**
- Modify: `README.md` (full rewrite)
- Test: `test/docs/readme.test.ts`

**Interfaces:**
- Consumes: `docs/assets/logo-light.svg`, `docs/assets/logo-dark.svg`, `docs/assets/hero.svg` (Tasks 1–2); `docs/limitations.md` (Task 3).
- Produces: a `README.md` containing the headings `## Features`, `## Requirements`, `## Install`, `## How it works`, `## Supported agents`, `## Status and known limitations`, `## Development`, `## Contributing`, `## License`, `## Credits`. Task 5 creates `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `CHANGELOG.md`, which this README already links; Task 7's link test is what proves those links resolve. Task 6 adds the CI badge.

- [ ] **Step 1: Write the failing test**

Create `test/docs/readme.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const readme = readFileSync('README.md', 'utf8')

describe('the README', () => {
  it('switches the logo on the reader theme', () => {
    expect(readme).toContain('prefers-color-scheme: dark')
    expect(readme).toContain('docs/assets/logo-dark.svg')
    expect(readme).toContain('docs/assets/logo-light.svg')
  })

  it('shows the hero and admits it is a mockup', () => {
    expect(readme).toContain('docs/assets/hero.svg')
    expect(readme.toLowerCase()).toContain('mockup')
  })

  it('has the sections a first-time reader scans for', () => {
    for (const heading of [
      '## Features',
      '## Requirements',
      '## Install',
      '## How it works',
      '## Supported agents',
      '## Status and known limitations',
      '## Development',
      '## Contributing',
      '## License',
      '## Credits',
    ]) {
      expect(readme, `README lost ${heading}`).toContain(heading)
    }
  })

  // Two warnings changed what a user does with their hands, so relocating
  // them to docs/limitations.md alone would be a regression: a reader can
  // install Antigravity hooks straight from the Install section without ever
  // opening the linked page.
  it('keeps the two warnings that change what a user does', () => {
    expect(readme, 'the Codex trust step must stay in the README').toContain(
      'approve the hook review'
    )
    expect(readme, 'the Antigravity fail-open warning must stay in the README').toContain(
      'failing open'
    )
  })

  it('links the full limitations page', () => {
    expect(readme).toContain('docs/limitations.md')
  })

  it('still points at the canonical repository', () => {
    expect(readme).toContain('github.com/dasbo-dev/island-gnome')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/docs/readme.test.ts`
Expected: FAIL — several assertions, starting with `expected '# Dasbo Island…' to contain 'prefers-color-scheme: dark'`.

- [ ] **Step 3: Rewrite the README**

Replace the whole of `README.md` with:

````markdown
<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
  <img src="docs/assets/logo-light.svg" alt="" width="120">
</picture>

# Dasbo Island

**Your AI coding agents, live on the GNOME top bar.**

[![CI](https://github.com/dasbo-dev/island-gnome/actions/workflows/ci.yml/badge.svg)](https://github.com/dasbo-dev/island-gnome/actions/workflows/ci.yml)
[![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg)](LICENSE)
[![GNOME Shell 46](https://img.shields.io/badge/GNOME%20Shell-46-4a86cf.svg)](https://release.gnome.org/46/)

[Live demo](https://fsevenm.github.io/dasbo-island/) ·
[Documentation](docs/) ·
[Contributing](CONTRIBUTING.md) ·
[Changelog](CHANGELOG.md)

</div>

![The Dasbo Island pill in the GNOME top bar, its popup listing three live agent sessions, and the terminal running one of them](docs/assets/hero.svg)

<sub>A mockup, not a screen capture — the extension drawn as it appears. <a href="https://fsevenm.github.io/dasbo-island/">The live demo</a> runs the real state machine in your browser.</sub>

## What it is

Dasbo Island is a GNOME Shell extension that keeps every live AI coding-agent
session in the top bar: status at a glance, permission prompts answered
inline, and one click back to the terminal running the work.

The demo linked above is not a video. It is the extension's own `src/core`
state machine, bundled for the browser.

Source: [github.com/dasbo-dev/island-gnome](https://github.com/dasbo-dev/island-gnome)

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Install](#install)
- [How it works](#how-it-works)
- [Supported agents](#supported-agents)
- [Status and known limitations](#status-and-known-limitations)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)
- [Credits](#credits)

## Features

- **Status at a glance.** A pill in the top bar reflects the busiest session —
  working, waiting on you, errored, or finished — without opening anything.
- **Answer permissions where you are.** A tool waiting for approval can be
  allowed or denied from the popup, without switching to the terminal.
- **One click back to the terminal.** Every session row knows the terminal
  running it and raises that window.
- **Every agent in one place.** Claude Code, Codex CLI, and Antigravity CLI
  sessions share the pill, each row led by a chip naming the agent.
- **Task-list progress.** When an agent keeps a task list, its row shows how
  far through it is and expands to the list itself.
- **Cues you can hear.** A permission request, a question, a notification, and
  a finished session each get their own sound from your desktop's sound theme.

## Requirements

- GNOME Shell 46
- X11 or Wayland

## Install

```bash
make install
gnome-extensions enable dasbo-island@ayubaswad.gmail.com
```

Then reload the shell. On X11 press `Alt`+`F2`, type `r`, press `Enter`. On
Wayland, log out and back in.

Open the preferences and install the hooks for each agent you use:

```bash
gnome-extensions prefs dasbo-island@ayubaswad.gmail.com
```

Whenever the pill is visible, the preferences window is one click away: click
the pill, then the gear in the popup's header. The pill stays hidden while no
session is running unless you enable **Always show the pill**.

> [!IMPORTANT]
> **Codex CLI needs one more step.** Installing the hooks is not enough on its
> own. Codex will not run a hook it has not been told to trust: it stores that
> decision per hook config, and the review that grants it happens only in
> Codex's own interactive TUI. After Install (or Update), start `codex` once
> and approve the hook review. Until you do, the hooks sit in the file and
> never fire, and no Codex session reaches the island.

Hook installation preserves entries belonging to other tools and writes a
`.dasbo.bak` backup before its first change.

## How it works

The pill shows a 2×2 grid that reflects the busiest session: three blocks dim
with one slowly breathing at rest, a light travelling clockwise while an agent
works, all four blocks blinking together when a permission needs your answer,
a static diagonal pair on error, and a green stagger when a session finishes.

Each session row is led by a chip naming the agent doing the work, so a popup
holding a Claude Code session beside a Codex one says which is which at a
glance. **Agent chip** in the preferences chooses what it shows: the mark
alone, the mark and a short name, or the name alone. A row whose mark is
missing shows the name whatever that says. The marks are drawn for this
extension rather than taken from each vendor, and they do not recolour with a
light or dark theme.

Each agent row shows whether its hooks are installed. If the extension
directory moves, or a release adds a hook event the installed set is missing,
the row offers **Update** — every installed hook command embeds an absolute
path, and an install written before a new event existed is out of date.

When an agent keeps a task list, its row shows how far through it is — `3/10`
beside the clock — and the expander arrow opens the list itself, one line per
task: `✓` done, `▸` in progress, `○` still to do. Claude Code's list is read
from `~/.claude/tasks/<session-id>/`, so it appears without any extra hook.
`/clear` starts a fresh list, because it starts a fresh session id.

When an agent says it is waiting on you — Claude raises this after its prompt
has sat idle, and for any permission the island did not answer itself — the
message appears on that session's row and the popup opens to show it. Both
revert a few seconds later, and a popup you opened yourself is never closed
for you. The delay, and whether the popup opens at all, are in the
preferences; set the delay to zero to keep the message on the row until the
agent does something else, and to keep a popup it opened staying open until
you close it yourself.

Each of those moments also makes a sound: a permission request, an agent's
question, a notification, and a session finishing, each with its own cue. The
sounds come from your desktop's sound theme rather than from this extension,
so they match everything else on the system, and they stay silent when GNOME's
own event sounds are off. Unlike the popup, sound is not suppressed by a
fullscreen window — that is when the pill is least visible and the sound is
most useful. One switch in the preferences turns all four off. GNOME's Do Not
Disturb silences GNOME's own notification sounds, not these cues — the island
is not a notification service, and a blocked agent is waiting on you either
way.

Panel box and position changes apply immediately, with no reload. Extensions
that replace the top bar, such as Dash to Panel, decide where each box ends up
on screen.

## Supported agents

| Agent | Config touched | Status reporting | Permission gating |
|---|---|---|---|
| Claude Code | `~/.claude/settings.json` | 17 real hook-payload fixtures | yes |
| Codex CLI | `~/.codex/hooks.json` | 6 real fixtures (0.146.0) | no — [notify-only](docs/limitations.md#codex-has-no-permission-gate) |
| Antigravity CLI (`agy`) | `~/.gemini/config/hooks.json` | 12 real fixtures | [unverified](docs/limitations.md#the-antigravity-permission-gate-may-fail-open) |

Payload shapes for all three are documented in
[docs/agent-dialects.md](docs/agent-dialects.md).

### Fail-open guarantee

The hook helper exits 0 with empty stdout on every error path. If this
extension is disabled, crashed, or never installed, your agents behave exactly
as they would without it.

## Status and known limitations

This project says what it has not proven. The full account is in
[docs/limitations.md](docs/limitations.md); in short:

- **Antigravity's permission gate is unverified and may fail open.** No
  fixture exercises a real permission round-trip, so the response shape is a
  guess. If `agy` ignores it, **Deny** reports the tool as denied while it
  executes anyway — a security control failing open, silently.
  [Details](docs/limitations.md#the-antigravity-permission-gate-may-fail-open)
- **Codex sessions cannot be gated through dasbo.** Its hooks are installed
  notify-only.
  [Details](docs/limitations.md#codex-has-no-permission-gate)
- **Two of the four sound cues are structurally dead for Antigravity.**
  [Details](docs/limitations.md#two-sound-cues-are-dead-for-antigravity)
- **No cue has been confirmed audible on a live desktop.** The suite can pin
  the decision logic; nothing in it can listen.
  [Details](docs/limitations.md#no-cue-has-been-confirmed-audible)
- **Claude Code's `SessionEnd` and `Notification` handling is inferred**
  rather than captured.
  [Details](docs/limitations.md#claude-codes-sessionend-and-notification-are-inferred)

## Development

```bash
npm install
npm test          # pure core logic, no GNOME needed
npm run typecheck
make install
tools/fake-agent.js perm   # drive the UI without a real agent
```

`src/core/` must never import `gi://` or `resource://`.
`test/core/purity.test.ts` enforces this.

`node build.mjs` writes both the extension into `dist/` and the landing page
into `dist-site/`; preview the latter with
`python3 -m http.server -d dist-site 8080`. Pushes to `master` deploy it to
GitHub Pages via [`.github/workflows/site.yml`](.github/workflows/site.yml).

## Contributing

Bug reports, fixtures from real agent sessions, and pull requests are all
welcome — captured payloads especially, since several of the gaps on this page
close the moment someone produces one. Start with
[CONTRIBUTING.md](CONTRIBUTING.md); participation is covered by the
[Code of Conduct](CODE_OF_CONDUCT.md).

## License

[GPL-3.0-or-later](LICENSE).

## Credits

Inspired by [open-vibe-island](https://github.com/Octane0411/open-vibe-island),
rebuilt natively for GNOME Shell.

Built by [fsevenm](https://github.com/fsevenm). If it saves you a window
switch or two, you can
[buy me a coffee](https://buymeacoffee.com/fsevenm).
````

- [ ] **Step 4: Run the README tests to verify they pass**

Run: `npx vitest run test/docs/readme.test.ts test/repoUrls.test.ts`
Expected: PASS — 6 README tests and 7 repository-URL tests.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, 0 failures. The count will have grown from the 618 baseline by the tests added in Tasks 1–4.

- [ ] **Step 6: Commit**

```bash
git add README.md test/docs/readme.test.ts
git commit -m "docs: restructure the README around a header, hero, and scannable sections"
```

---

### Task 5: Community-health files

**Files:**
- Create: `CONTRIBUTING.md`
- Create: `CODE_OF_CONDUCT.md`
- Create: `SECURITY.md`
- Create: `CHANGELOG.md`
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Create: `.github/PULL_REQUEST_TEMPLATE.md`
- Test: `test/docs/communityFiles.test.ts`
- Modify: `test/repoUrls.test.ts:11` — extend the swept file list

**Interfaces:**
- Consumes: `docs/limitations.md` (Task 3) and `docs/agent-dialects.md` (existing), both linked from these files.
- Produces: the eight files above. Task 4's README already links `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `CHANGELOG.md`; Task 7's link test proves those links resolve.

- [ ] **Step 1: Write the failing test**

Create `test/docs/communityFiles.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// GitHub's community-standards check only asks whether these files exist. It
// cannot tell a contributing guide that names this project's actual gates
// from one that says "please write tests", so that part is checked here.
const REQUIRED: Record<string, string[]> = {
  'CONTRIBUTING.md': ['npm test', 'npm run typecheck', 'gi://', 'docs/agent-dialects.md'],
  'CODE_OF_CONDUCT.md': ['Contributor Covenant', 'ayubaswad@gmail.com'],
  'SECURITY.md': ['ayubaswad@gmail.com', 'docs/limitations.md'],
  'CHANGELOG.md': ['Keep a Changelog', '[Unreleased]'],
  '.github/ISSUE_TEMPLATE/bug_report.yml': ['GNOME Shell', 'Wayland', 'journalctl'],
  '.github/ISSUE_TEMPLATE/feature_request.yml': ['name:', 'description:'],
  '.github/ISSUE_TEMPLATE/config.yml': ['blank_issues_enabled: false'],
  '.github/PULL_REQUEST_TEMPLATE.md': ['npm test', 'npm run typecheck'],
}

describe('the community-health files', () => {
  for (const [path, needles] of Object.entries(REQUIRED)) {
    it(`${path} exists and says what it has to`, () => {
      const text = readFileSync(path, 'utf8')
      for (const needle of needles) {
        expect(text, `${path} never mentions ${needle}`).toContain(needle)
      }
    })
  }

  // No tag has ever been cut in this repository. A changelog that invents a
  // release date is worse than one that admits nothing has shipped.
  it('CHANGELOG.md claims no released version', () => {
    const text = readFileSync('CHANGELOG.md', 'utf8')
    expect(text).not.toMatch(/^## \[\d+\.\d+\.\d+\]/m)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/docs/communityFiles.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, open 'CONTRIBUTING.md'`

- [ ] **Step 3: Write `CONTRIBUTING.md`**

````markdown
# Contributing to Dasbo Island

Thanks for looking. This is a GNOME Shell extension written in TypeScript and
bundled with esbuild; everything that can be tested without a running GNOME
session is tested with Vitest.

## What is most useful

**Captured hook payloads.** Several gaps in
[docs/limitations.md](docs/limitations.md) close the moment someone produces a
real payload — the Antigravity permission round-trip above all. A fixture is
worth more here than a patch.

**Bug reports with a shell log.** See the issue template; the log is usually
the whole story.

**Patches.** Small and focused, please.

## Setup

```bash
git clone https://github.com/dasbo-dev/island-gnome.git
cd island-gnome
npm install
```

No GNOME session is needed to run the tests. To try the extension itself you
need GNOME Shell 46:

```bash
make install
gnome-extensions enable dasbo-island@ayubaswad.gmail.com
```

Reload the shell after installing: `Alt`+`F2`, `r`, `Enter` on X11; log out and
back in on Wayland.

```bash
tools/fake-agent.js perm   # drive the UI without a real agent
```

## The gates

Both must pass before a pull request can be merged, and CI runs them on every
push and pull request:

```bash
npm test
npm run typecheck
```

`node build.mjs` must also succeed — it builds `dist/` and the landing page in
`dist-site/`.

## Rules worth knowing before you start

**`src/core/` must never import `gi://` or `resource://`.** That directory is
the part of the extension the test suite can reach; the moment it pulls in a
GJS binding, it stops being testable outside a live shell.
`test/core/purity.test.ts` enforces this and will fail your build.

**Assets are loaded by absolute path at runtime, and a missing one is
silent.** A chip with no mark just renders a bare name; a `Gtk.Picture` given
a missing file draws nothing and reports nothing. `test/shell/iconAssets.test.ts`
and `test/prefs/aboutAssets.test.ts` guard the `build.mjs` copy lines that
ship them. If you add an asset, add its guard.

**Documentation is tested too.** `test/repoUrls.test.ts` sweeps for stale
repository slugs, and `test/docs/` guards the README's structure, the logo
files, and the limitations page. A restructure that drops a warning fails the
suite.

## Adding an agent

Adapters live in `src/core/adapters/`. Each one translates its agent's hook
dialect into the extension's own events.
[docs/agent-dialects.md](docs/agent-dialects.md) documents the three that
exist; the fixtures behind them are in `test/fixtures/`.

An adapter written without captured fixtures is a guess, and this project
labels guesses as such — see the Antigravity entry in
[docs/limitations.md](docs/limitations.md) for what that looks like in
practice.

## Commits and pull requests

Conventional commits, matching the existing log:

```
feat(prefs): add the About tab with author, links, and support QR
fix: point every repository URL at dasbo-dev/island-gnome
docs: state only the measured fact about the clamp
test(prefs): guard the detached-receiver and QR-sizing regressions
build: ship src/assets alongside the extension
```

Say what changed and why in the pull-request description, and note anything
you could not verify. Unverified is fine here. Unlabelled is not.

## Code of Conduct

Participation is covered by the [Code of Conduct](CODE_OF_CONDUCT.md).
````

- [ ] **Step 4: Write `CODE_OF_CONDUCT.md`**

Contributor Covenant 2.1, verbatim, with the contact filled in:

```markdown
# Contributor Covenant Code of Conduct

## Our Pledge

We as members, contributors, and leaders pledge to make participation in our
community a harassment-free experience for everyone, regardless of age, body
size, visible or invisible disability, ethnicity, sex characteristics, gender
identity and expression, level of experience, education, socio-economic status,
nationality, personal appearance, race, caste, color, religion, or sexual
identity and orientation.

We pledge to act and interact in ways that contribute to an open, welcoming,
diverse, inclusive, and healthy community.

## Our Standards

Examples of behavior that contributes to a positive environment for our
community include:

* Demonstrating empathy and kindness toward other people
* Being respectful of differing opinions, viewpoints, and experiences
* Giving and gracefully accepting constructive feedback
* Accepting responsibility and apologizing to those affected by our mistakes,
  and learning from the experience
* Focusing on what is best not just for us as individuals, but for the overall
  community

Examples of unacceptable behavior include:

* The use of sexualized language or imagery, and sexual attention or advances of
  any kind
* Trolling, insulting or derogatory comments, and personal or political attacks
* Public or private harassment
* Publishing others' private information, such as a physical or email address,
  without their explicit permission
* Other conduct which could reasonably be considered inappropriate in a
  professional setting

## Enforcement Responsibilities

Community leaders are responsible for clarifying and enforcing our standards of
acceptable behavior and will take appropriate and fair corrective action in
response to any behavior that they deem inappropriate, threatening, offensive,
or harmful.

Community leaders have the right and responsibility to remove, edit, or reject
comments, commits, code, wiki edits, issues, and other contributions that are
not aligned to this Code of Conduct, and will communicate reasons for moderation
decisions when appropriate.

## Scope

This Code of Conduct applies within all community spaces, and also applies when
an individual is officially representing the community in public spaces.
Examples of representing our community include using an official email address,
posting via an official social media account, or acting as an appointed
representative at an online or offline event.

## Enforcement

Instances of abusive, harassing, or otherwise unacceptable behavior may be
reported to the community leaders responsible for enforcement at
ayubaswad@gmail.com.
All complaints will be reviewed and investigated promptly and fairly.

All community leaders are obligated to respect the privacy and security of the
reporter of any incident.

## Enforcement Guidelines

Community leaders will follow these Community Impact Guidelines in determining
the consequences for any action they deem in violation of this Code of Conduct:

### 1. Correction

**Community Impact**: Use of inappropriate language or other behavior deemed
unprofessional or unwelcome in the community.

**Consequence**: A private, written warning from community leaders, providing
clarity around the nature of the violation and an explanation of why the
behavior was inappropriate. A public apology may be requested.

### 2. Warning

**Community Impact**: A violation through a single incident or series of
actions.

**Consequence**: A warning with consequences for continued behavior. No
interaction with the people involved, including unsolicited interaction with
those enforcing the Code of Conduct, for a specified period of time. This
includes avoiding interactions in community spaces as well as external channels
like social media. Violating these terms may lead to a temporary or permanent
ban.

### 3. Temporary Ban

**Community Impact**: A serious violation of community standards, including
sustained inappropriate behavior.

**Consequence**: A temporary ban from any sort of interaction or public
communication with the community for a specified period of time. No public or
private interaction with the people involved, including unsolicited interaction
with those enforcing the Code of Conduct, is allowed during this period.
Violating these terms may lead to a permanent ban.

### 4. Permanent Ban

**Community Impact**: Demonstrating a pattern of violation of community
standards, including sustained inappropriate behavior, harassment of an
individual, or aggression toward or disparagement of classes of individuals.

**Consequence**: A permanent ban from any sort of public interaction within the
community.

## Attribution

This Code of Conduct is adapted from the [Contributor Covenant][homepage],
version 2.1, available at
[https://www.contributor-covenant.org/version/2/1/code_of_conduct.html][v2.1].

Community Impact Guidelines were inspired by
[Mozilla's code of conduct enforcement ladder][Mozilla CoC].

For answers to common questions about this code of conduct, see the FAQ at
[https://www.contributor-covenant.org/faq][FAQ]. Translations are available at
[https://www.contributor-covenant.org/translations][translations].

[homepage]: https://www.contributor-covenant.org
[v2.1]: https://www.contributor-covenant.org/version/2/1/code_of_conduct.html
[Mozilla CoC]: https://github.com/mozilla/diversity
[FAQ]: https://www.contributor-covenant.org/faq
[translations]: https://www.contributor-covenant.org/translations
```

- [ ] **Step 5: Write `SECURITY.md`**

```markdown
# Security Policy

## Supported versions

No version has been tagged yet. Fixes land on `master`; if you are running the
extension, run what `make install` gives you from `master`.

## Reporting a vulnerability

Email <ayubaswad@gmail.com> rather than opening a public issue. Include what
you did, what happened, and which GNOME Shell version and session type you
were on. You will get an acknowledgement; if the report is valid, the fix and
its disclosure will be discussed with you before either lands.

## What this extension does to your system

It writes hook entries into your agents' own configuration files —
`~/.claude/settings.json`, `~/.codex/hooks.json`,
`~/.gemini/config/hooks.json`. Installation preserves entries belonging to
other tools and writes a `.dasbo.bak` backup before its first change to a
file. Every installed hook command embeds an absolute path to the helper
inside the extension directory.

Those hooks make the extension part of your agents' tool-permission path,
which is why the guarantee below exists.

## The fail-open guarantee

The hook helper exits 0 with empty stdout on every error path. If this
extension is disabled, crashed, or never installed, your agents behave exactly
as they would without it. Nothing the extension does can block or wedge an
agent.

The cost of that design is stated plainly rather than hidden: a permission
control that fails open fails **permissive**.

## Known open issue

**The Antigravity CLI permission gate is unverified and may fail open.**
Clicking Deny may report the tool as denied while it executes anyway. Do not
rely on it as a security control. Full account:
[docs/limitations.md](docs/limitations.md#the-antigravity-permission-gate-may-fail-open).

Codex CLI has no permission gate through this extension at all; its hooks are
notify-only. Claude Code's gate is the only one verified against real
payloads.
```

- [ ] **Step 6: Write `CHANGELOG.md`**

```markdown
# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing has been tagged yet. Everything below is on `master`.

### Added

- A top-bar pill whose 2×2 grid reflects the busiest session: idle, working,
  waiting on a permission, errored, or finished.
- A popup listing every live session with its agent chip, project, elapsed
  time, and current activity.
- Inline permission approval, and a click-through that raises the terminal
  running a session.
- Hook install, update, and removal for Claude Code, Codex CLI, and
  Antigravity CLI, preserving other tools' entries and writing a `.dasbo.bak`
  backup before the first change.
- Task-list progress on each session row, with an expander showing the list
  itself. Claude Code's list is read from `~/.claude/tasks/<session-id>/`.
- Waiting-on-you messages surfaced on the row, with a configurable delay and
  an optional automatic popup.
- Four sound cues — permission, question, notification, session finished —
  played from the desktop's sound theme and honouring GNOME's `event-sounds`.
- An agent chip with three display modes: mark, mark and name, or name.
- A preferences About page with author, links, and support QR.
- A landing page in `site/`, deployed to GitHub Pages, running the real
  `src/core` state machine in the browser.
- Contribution, security, and code-of-conduct documentation, issue and
  pull-request templates, and a CI workflow.

### Fixed

- Every repository URL now points at `dasbo-dev/island-gnome`; three files
  named it and all three were stale at once.
- Codex hooks written in the older named-hook form parsed without complaint
  and never fired. **Update** replaces them.
- The About page's QR picture is pinned with a minimum size rather than a
  clamp, and its `UriLauncher` receiver is bound so it cannot be collected
  mid-launch.
```

- [ ] **Step 7: Write the issue templates**

`.github/ISSUE_TEMPLATE/bug_report.yml`:

```yaml
name: Bug report
description: Something in the extension behaves wrongly
labels: [bug]
body:
  - type: markdown
    attributes:
      value: |
        The shell log is usually the whole story. Please include it.

  - type: textarea
    id: what
    attributes:
      label: What happened
      description: What you did, what you expected, and what you got instead.
    validations:
      required: true

  - type: input
    id: shell
    attributes:
      label: GNOME Shell version
      description: "Output of: gnome-shell --version"
      placeholder: GNOME Shell 46.0
    validations:
      required: true

  - type: dropdown
    id: session
    attributes:
      label: Session type
      options:
        - Wayland
        - X11
    validations:
      required: true

  - type: dropdown
    id: agent
    attributes:
      label: Which agent
      options:
        - Claude Code
        - Codex CLI
        - Antigravity CLI (agy)
        - Not agent-specific
    validations:
      required: true

  - type: input
    id: agent-version
    attributes:
      label: Agent version
      placeholder: codex 0.146.0

  - type: input
    id: extension-version
    attributes:
      label: Extension version
      description: "The version-name in metadata.json, or the commit you built."
      placeholder: 0.1.0

  - type: textarea
    id: log
    attributes:
      label: Shell log
      description: |
        Run this, reproduce the problem, then paste what appears:
        journalctl -f -o cat /usr/bin/gnome-shell
      render: shell
    validations:
      required: true
```

`.github/ISSUE_TEMPLATE/feature_request.yml`:

```yaml
name: Feature request
description: Suggest something the extension should do
labels: [enhancement]
body:
  - type: textarea
    id: problem
    attributes:
      label: The problem
      description: What are you trying to do that the extension makes hard today?
    validations:
      required: true

  - type: textarea
    id: proposal
    attributes:
      label: What you would like it to do
    validations:
      required: true

  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives you considered
      description: Including doing nothing, and why that is not enough.
```

`.github/ISSUE_TEMPLATE/config.yml`:

```yaml
blank_issues_enabled: false
contact_links:
  - name: Security report
    url: https://github.com/dasbo-dev/island-gnome/blob/master/SECURITY.md
    about: Please report vulnerabilities by email, not in a public issue.
```

- [ ] **Step 8: Write `.github/PULL_REQUEST_TEMPLATE.md`**

```markdown
## What changed

<!-- One or two sentences. -->

## Why

<!-- The problem this solves. Link an issue if there is one. -->

## What you could not verify

<!-- Unverified is fine in this project. Unlabelled is not. If you changed a
     path no test can reach — a permission round-trip, a sound, anything that
     needs a live desktop — say so here. -->

## Checklist

- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
- [ ] `node build.mjs` succeeds
- [ ] No new `gi://` or `resource://` import under `src/core/`
- [ ] Any new runtime asset is copied in `build.mjs` and guarded by a test
- [ ] Documentation updated if behaviour changed
```

- [ ] **Step 9: Extend the repository-URL sweep**

Two new files name the repository. Modify `test/repoUrls.test.ts:11`:

```ts
const FILES = ['metadata.json', 'README.md', 'site/index.html', 'CONTRIBUTING.md', 'SECURITY.md']
```

`CONTRIBUTING.md` already contains the canonical clone URL and `SECURITY.md`
does not — add this line to the end of `SECURITY.md` so the positive assertion
holds:

```markdown
---

Repository: <https://github.com/dasbo-dev/island-gnome>
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npx vitest run test/docs/communityFiles.test.ts test/repoUrls.test.ts`
Expected: PASS — 9 community-file tests and 11 repository-URL tests.

- [ ] **Step 11: Verify the YAML parses**

Run:
```bash
python3 - <<'PY'
import glob, sys
try:
    import yaml
except ModuleNotFoundError:
    sys.exit("PyYAML missing — check the templates on GitHub after pushing instead")
for p in glob.glob('.github/**/*.yml', recursive=True):
    yaml.safe_load(open(p))
    print('ok', p)
PY
```
Expected: `ok` for each of `ci.yml` (once Task 6 lands), `site.yml`, and the three issue-template files. If PyYAML is not installed, note it and rely on GitHub's own template validation after push — do not install a dependency for this.

- [ ] **Step 12: Commit**

```bash
git add CONTRIBUTING.md CODE_OF_CONDUCT.md SECURITY.md CHANGELOG.md .github/ISSUE_TEMPLATE .github/PULL_REQUEST_TEMPLATE.md test/docs/communityFiles.test.ts test/repoUrls.test.ts
git commit -m "docs: add contributing, security, conduct, changelog, and issue templates"
```

---

### Task 6: CI workflow and its badge

**Files:**
- Create: `.github/workflows/ci.yml`
- Test: `test/docs/ciWorkflow.test.ts`

**Interfaces:**
- Consumes: the README badge added in Task 4, which already points at `actions/workflows/ci.yml/badge.svg`.
- Produces: `.github/workflows/ci.yml` with a `pull_request` trigger.

**Why a second workflow:** `site.yml` already runs `npm ci`, `npm test`, `npm run typecheck`, and `node build.mjs` — but only on pushes to `master`, because its job is to deploy. No pull request is checked today. Keeping them separate also keeps the badge honest: a red CI badge means the code is broken, not that a Pages deploy failed. `ci.yml` may cancel in-flight runs; `site.yml` must not, and its comment explains why.

- [ ] **Step 1: Write the failing test**

Create `test/docs/ciWorkflow.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// The README carries a build badge. A badge pointing at a workflow that does
// not run the gates is worse than no badge — it is a green light nobody
// checked.
describe('the CI workflow', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8')

  it('runs on pull requests, which is what site.yml does not do', () => {
    expect(ci).toContain('pull_request')
  })

  it('runs every gate', () => {
    for (const cmd of ['npm ci', 'npm test', 'npm run typecheck', 'node build.mjs']) {
      expect(ci, `ci.yml never runs ${cmd}`).toContain(cmd)
    }
  })

  it('is the workflow the README badge points at', () => {
    const readme = readFileSync('README.md', 'utf8')
    expect(readme).toContain('actions/workflows/ci.yml/badge.svg')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/docs/ciWorkflow.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, open '.github/workflows/ci.yml'`

- [ ] **Step 3: Write the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: ci

on:
  push:
    branches: [master, main]
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  # Unlike site.yml, this workflow deploys nothing, so superseding an
  # in-flight run costs only a stale result.
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run typecheck
      - run: node build.mjs
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/docs/ciWorkflow.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml test/docs/ciWorkflow.test.ts
git commit -m "ci: run the test, typecheck, and build gates on pull requests"
```

---

### Task 7: Link-resolution guard and full verification

**Files:**
- Create: `test/docs/links.test.ts`

**Interfaces:**
- Consumes: every file created in Tasks 1–6.
- Produces: nothing consumed downstream. This is the last gate.

**Why this comes last:** it is a cross-cutting invariant — it can only be written once every file it checks exists. Because of that it may pass on first run, so Step 3 deliberately breaks a link to prove the test can fail.

- [ ] **Step 1: Write the test**

Create `test/docs/links.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

// A relative link that rots is invisible: it renders as ordinary blue text
// and only 404s for the reader who clicks it. Now that the README delegates
// five limitations, a contributing guide, and a security policy to other
// files, that is a lot of surface nobody would notice going stale.
const FILES = [
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  'CHANGELOG.md',
  'docs/limitations.md',
]

const MARKDOWN_LINK = /\]\(([^)\s]+)\)/g
const HTML_SRC = /(?:src|srcset|href)="([^"]+)"/g

function targets(text: string): string[] {
  const found = [...text.matchAll(MARKDOWN_LINK), ...text.matchAll(HTML_SRC)].map((m) => m[1])
  return found.filter(
    (t) => !/^(https?:|mailto:|#)/.test(t) && !t.startsWith('<')
  )
}

describe('every relative link', () => {
  for (const file of FILES) {
    const text = readFileSync(file, 'utf8')

    for (const target of targets(text)) {
      // A link may carry an anchor; only the path part is a file.
      const path = normalize(join(dirname(file), target.split('#')[0]))

      it(`${file} → ${target} resolves`, () => {
        expect(existsSync(path), `${file} links ${target}, which is not in the tree`).toBe(true)
      })
    }
  }
})
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run test/docs/links.test.ts`
Expected: PASS. If anything fails, the link is genuinely wrong — fix the link, not the test.

- [ ] **Step 3: Prove the test can fail**

Temporarily append a broken link to the end of `CHANGELOG.md`:

```markdown
[broken](docs/this-file-does-not-exist.md)
```

Run: `npx vitest run test/docs/links.test.ts`
Expected: FAIL — `CHANGELOG.md links docs/this-file-does-not-exist.md, which is not in the tree`

Then remove that line and re-run. Expected: PASS.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: 0 failures. Test-file count grows from the 36-file baseline by the six files added across Tasks 1–7 (`test/docs/readmeAssets.test.ts`, `limitations.test.ts`, `readme.test.ts`, `communityFiles.test.ts`, `ciWorkflow.test.ts`, `links.test.ts`) — 42 files.

- [ ] **Step 5: Run the remaining gates**

Run: `npm run typecheck`
Expected: no output, exit 0.

Run: `node build.mjs`
Expected: `built dist/ and dist-site/`

- [ ] **Step 6: Confirm no stale caveat was lost**

Run:
```bash
git show master:README.md > /tmp/readme-before.md
for phrase in "failing open" "structurally dead" "has not been verified" "notify-only" "approve the hook review" ".dasbo.bak"; do
  grep -rqF "$phrase" README.md docs/limitations.md \
    && echo "kept: $phrase" \
    || echo "LOST: $phrase"
done
```
Expected: `kept:` for all six.

- [ ] **Step 7: Commit**

```bash
git add test/docs/links.test.ts
git commit -m "test(docs): guard every relative link in the documentation set"
```

---

### Task 8: Merge and clean up

**Files:** none — repository operations only.

**Interfaces:**
- Consumes: the seven commits from Tasks 1–7 on `worktree-readme-overhaul`.
- Produces: those commits on `master`; the worktree and branch removed.

- [ ] **Step 1: Confirm the branch is clean and green**

Run: `git status --short`
Expected: no output.

Run: `npm test && npm run typecheck && node build.mjs`
Expected: all three succeed.

- [ ] **Step 2: Review the diff against master**

Run: `git diff master --stat`
Expected: the files listed in Tasks 1–7 and nothing else. In particular no
change under `src/`, and no `node_modules` symlink staged — `.gitignore`
already covers `node_modules/`.

- [ ] **Step 3: Merge into master**

From the main checkout at `/home/fsevenm/projects/dasbo-island`:

```bash
git -C /home/fsevenm/projects/dasbo-island merge --no-ff worktree-readme-overhaul -m "docs: overhaul the README, add the project logo, and add community files"
```

- [ ] **Step 4: Verify master is green**

```bash
cd /home/fsevenm/projects/dasbo-island
npm test
npm run typecheck
node build.mjs
```
Expected: all succeed.

- [ ] **Step 5: Remove the worktree and delete the branch**

Use `ExitWorktree` with `action: "remove"` to leave and delete the worktree,
then confirm the branch is gone:

```bash
git -C /home/fsevenm/projects/dasbo-island branch -d worktree-readme-overhaul
git -C /home/fsevenm/projects/dasbo-island worktree list
```
Expected: the branch deletes cleanly (its commits are on `master`), and
`worktree list` shows only the main checkout.

---

## Notes for the reviewer

- Nothing here changes runtime behaviour. `src/`, `schemas/`, `hooks/`,
  `Makefile`, and `build.mjs` are untouched.
- The one place this plan modifies an existing test is
  `test/repoUrls.test.ts:11`, which gains two files to sweep.
- `<picture>` theme switching and SVG rendering can only be confirmed on
  github.com after the branch is pushed. That check belongs to the operator.
