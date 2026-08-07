# Coming-Soon Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show OpenCode, Cursor CLI and Antigravity CLI as inert "Coming soon" rows on the preferences Agents page, and stop presenting Antigravity as a supported agent anywhere in the docs or on the site.

**Architecture:** A new pure-data module, `src/core/agentCatalog.ts`, becomes the single ordered list of agents the preferences page renders, each tagged `supported` or `coming-soon`. `src/prefs.ts` iterates that list instead of a hardcoded array, building the existing interactive row for a supported entry and a new fully-insensitive row for a coming-soon one. Antigravity's adapter, icon, fixtures and tests stay in the tree untouched; only its user-facing surface — the gschema default, the preferences row, the README, the limitations page and the site — is withdrawn.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), GJS / GTK4 / libadwaita via `@girs/gnome-shell`, vitest, esbuild.

## Global Constraints

- Every import specifier ends in `.js`, even when the source file is `.ts`. This is the existing convention across `src/` — see `src/prefs.ts`.
- The spec is `docs/superpowers/specs/2026-08-07-coming-soon-agents-design.md`. Read it before starting.
- Do not delete or edit `src/core/adapters/antigravity.ts`, `src/icons/antigravity.svg`, `test/core/adapters/antigravity.test.ts`, or anything under `test/fixtures/antigravity/`. Antigravity stays in the `AgentId` union, in the `adapters` record, in `isAgentId`, and in `src/core/install/plan.ts`.
- The coming-soon ids are exactly `opencode`, `cursor`, `antigravity`. Their display names are exactly `OpenCode`, `Cursor CLI`, `Antigravity CLI`.
- The coming-soon subtitle string is exactly `Coming soon`.
- Do not add icons for OpenCode or Cursor CLI.
- British spelling in user-facing copy where the file already uses it (`behaviour`, `normalise`).
- Verification commands: `npm test`, `npm run typecheck`, `npm run build`. All three must pass before the final commit.

---

### Task 1: The agent catalog

**Files:**
- Create: `src/core/agentCatalog.ts`
- Test: `test/core/agentCatalog.test.ts`

**Interfaces:**
- Consumes: `AgentId` from `src/core/types.js`; `adapters` from `src/core/adapters/index.js`.
- Produces: `export type CatalogEntry`, `export const AGENT_CATALOG: readonly CatalogEntry[]`. Task 2 iterates `AGENT_CATALOG` and narrows on `entry.status`.

- [ ] **Step 1: Write the failing test**

Create `test/core/agentCatalog.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { AGENT_CATALOG } from '../../src/core/agentCatalog.js'
import { adapters } from '../../src/core/adapters/index.js'

describe('the agent catalog', () => {
  it('lists no agent twice', () => {
    const ids = AGENT_CATALOG.map((e) => e.id)
    expect(new Set(ids).size, `duplicate id in ${ids.join(', ')}`).toBe(ids.length)
  })

  it('gives every supported entry an adapter to read its name from', () => {
    for (const entry of AGENT_CATALOG) {
      if (entry.status !== 'supported') continue
      expect(adapters[entry.id], `${entry.id} is marked supported with no adapter`).toBeDefined()
    }
  })

  // A new adapter that never reaches the catalog is invisible in preferences:
  // the page renders this list and nothing else. Failing here is cheaper than
  // shipping an agent nobody can enable.
  it('files every adapter under some status', () => {
    const listed = new Set<string>(AGENT_CATALOG.map((e) => e.id))
    for (const id of Object.keys(adapters)) {
      expect(listed.has(id), `${id} has an adapter but no catalog entry`).toBe(true)
    }
  })

  it('names every coming-soon entry, since it has no adapter to ask', () => {
    for (const entry of AGENT_CATALOG) {
      if (entry.status !== 'coming-soon') continue
      expect(entry.displayName.trim(), entry.id).not.toBe('')
    }
  })

  it('keeps the working agents at the top of the list', () => {
    const firstComingSoon = AGENT_CATALOG.findIndex((e) => e.status === 'coming-soon')
    const lastSupported = AGENT_CATALOG.map((e) => e.status).lastIndexOf('supported')
    expect(lastSupported).toBeLessThan(firstComingSoon)
  })

  it('holds the agents this release ships and the three it does not', () => {
    expect(AGENT_CATALOG.filter((e) => e.status === 'supported').map((e) => e.id))
      .toEqual(['claude', 'codex'])
    expect(AGENT_CATALOG.filter((e) => e.status === 'coming-soon').map((e) => e.id))
      .toEqual(['opencode', 'cursor', 'antigravity'])
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run test/core/agentCatalog.test.ts`

Expected: FAIL — `Failed to resolve import "../../src/core/agentCatalog.js"`.

- [ ] **Step 3: Write the module**

Create `src/core/agentCatalog.ts`:

```ts
import type { AgentId } from './types.js'

/**
 * One agent as the preferences page presents it.
 *
 * A `supported` entry carries no display name: the row reads it from
 * `adapters[id].displayName`, so the page and the adapter cannot drift into
 * calling the same agent two different things. A `coming-soon` entry has no
 * adapter to ask, so it carries its own name.
 *
 * The union is discriminated on `status` rather than carrying an `AgentId |
 * string` id, so the branch that builds an interactive row narrows to
 * `AgentId` without a cast — a coming-soon id is by definition an agent this
 * build cannot dispatch to.
 */
export type CatalogEntry =
  | { id: AgentId; status: 'supported' }
  | { id: string; displayName: string; status: 'coming-soon' }

/**
 * Every agent the preferences page shows, in display order: the ones whose
 * hooks this build can install, then the roadmap.
 *
 * This is the only place the roadmap is written down. Antigravity sits in the
 * second group despite having a complete adapter and twelve captured fixtures
 * — its permission decision path has never been exercised against a real
 * payload, so shipping it as supported would overstate what the extension
 * does. The adapter stays in the tree for the release that turns it back on.
 */
export const AGENT_CATALOG: readonly CatalogEntry[] = [
  { id: 'claude', status: 'supported' },
  { id: 'codex', status: 'supported' },
  { id: 'opencode', displayName: 'OpenCode', status: 'coming-soon' },
  { id: 'cursor', displayName: 'Cursor CLI', status: 'coming-soon' },
  { id: 'antigravity', displayName: 'Antigravity CLI', status: 'coming-soon' },
]
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run test/core/agentCatalog.test.ts`

Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`

Expected: exit 0, no output.

- [ ] **Step 6: Commit**

```bash
git add src/core/agentCatalog.ts test/core/agentCatalog.test.ts
git commit -m "feat(core): catalog every agent the preferences page shows"
```

---

### Task 2: Coming-soon rows in preferences

**Files:**
- Modify: `src/prefs.ts` (the `_agentsPage` loop around line 188; a new `_comingSoonRow` method after `_agentRow`)
- Modify: `schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml:52`

**Interfaces:**
- Consumes: `AGENT_CATALOG` and `CatalogEntry` from `src/core/agentCatalog.js` (Task 1).
- Produces: nothing later tasks depend on.

There is no unit test for this task. Building an `Adw.ActionRow` needs a live GTK, which the vitest suite does not have, and `src/prefs.ts` has no existing test file. The behaviour worth protecting — which agents appear under which status — is covered by Task 1. Verification here is `npm run typecheck`, `npm run build`, and the operator's smoke test.

- [ ] **Step 1: Import the catalog**

In `src/prefs.ts`, alongside the existing `import { adapters } from './core/adapters/index.js'`, add:

```ts
import { AGENT_CATALOG } from './core/agentCatalog.js'
```

The existing `import type { AgentId } from './core/types.js'` stays — `_agentRow` still takes one.

- [ ] **Step 2: Iterate the catalog instead of a literal list**

In `_agentsPage`, replace this loop:

```ts
    for (const id of ['claude', 'codex', 'antigravity'] as AgentId[]) {
      const { row, refresh } = this._agentRow(id, env, settings, window, refreshAll)
      refreshers.push(refresh)
      group.add(row)
    }
```

with:

```ts
    // Both kinds of row live in this one group. A coming-soon agent's state
    // belongs in its subtitle, beside "Hooks installed" and "Not installed",
    // which is where a reader already looks to find out where a row stands —
    // a group heading of its own would say the same thing further away.
    for (const entry of AGENT_CATALOG) {
      if (entry.status === 'coming-soon') {
        group.add(this._comingSoonRow(entry.displayName))
        continue
      }
      const { row, refresh } = this._agentRow(entry.id, env, settings, window, refreshAll)
      // Only a real row registers a refresher: a coming-soon row reads no
      // file, so there is nothing for refreshAll to re-read.
      refreshers.push(refresh)
      group.add(row)
    }
```

- [ ] **Step 3: Add the row builder**

In `src/prefs.ts`, directly after the `_agentRow` method (it ends with `return { row, refresh }` followed by a closing brace), add:

```ts
  /**
   * An agent dasbo does not support yet: the same row, drawn inert.
   *
   * Every control is built and left insensitive rather than omitted, so the
   * switch and the two buttons stay in their columns down the whole group —
   * a row missing its suffixes would break the alignment and read as a
   * different kind of thing entirely. The switch is deliberately wired to
   * nothing: it is a picture of a control, not a control, and connecting it
   * to `enabled-agents` would let a stray programmatic toggle write an id no
   * adapter answers to.
   */
  private _comingSoonRow(displayName: string): Adw.ActionRow {
    const row = new Adw.ActionRow({ title: displayName, subtitle: 'Coming soon' })

    const enabled = new Gtk.Switch({
      valign: Gtk.Align.CENTER,
      active: false,
      sensitive: false,
      tooltip_text: 'Not supported yet',
    })
    const install = new Gtk.Button({ label: 'Install', valign: Gtk.Align.CENTER, sensitive: false })
    const uninstall = new Gtk.Button({ label: 'Remove', valign: Gtk.Align.CENTER, sensitive: false })

    row.add_suffix(enabled)
    row.add_suffix(install)
    row.add_suffix(uninstall)

    return row
  }
```

- [ ] **Step 4: Drop Antigravity from the enabled-agents default**

In `schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml`, line 52, change:

```xml
      <default>['claude','codex','antigravity']</default>
```

to:

```xml
      <default>['claude','codex']</default>
```

- [ ] **Step 5: Typecheck and build**

Run: `npm run typecheck && npm run build`

Expected: typecheck exits 0 with no output; build prints `built dist/ and dist-site/`.

- [ ] **Step 6: Confirm the schema compiles**

Run: `glib-compile-schemas --strict --dry-run schemas/`

Expected: exit 0, no output. (If `glib-compile-schemas` is not on PATH, skip this step — `npm run build` already copied the file.)

- [ ] **Step 7: Run the whole suite**

Run: `npm test`

Expected: PASS. `test/core/install/plan.test.ts` and the Antigravity adapter tests are untouched by this task and must still pass — if either fails, something was deleted that the constraints said to leave alone.

- [ ] **Step 8: Commit**

```bash
git add src/prefs.ts schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml
git commit -m "feat(prefs): show coming-soon agents and withdraw Antigravity's row"
```

---

### Task 3: README and the limitations page

**Files:**
- Modify: `README.md` (features list ~line 62; "Supported agents" table ~line 155-165; "Status and known limitations" bullets ~line 177-186)
- Modify: `docs/limitations.md` (intro ~line 6; two Antigravity sections)
- Modify: `test/docs/readme.test.ts` (the "keeps the two warnings" test)
- Modify: `test/docs/limitations.test.ts` (`MUST_STATE`, and the named-code-paths test)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Update the failing tests first**

In `test/docs/readme.test.ts`, replace this test:

```ts
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
```

with:

```ts
  // The Codex trust step changes what a user does with their hands, so
  // relocating it to docs/limitations.md alone would be a regression: a
  // reader can install Codex hooks straight from the Install section without
  // ever opening the linked page.
  it('keeps the warning that changes what a user does', () => {
    expect(readme, 'the Codex trust step must stay in the README').toContain(
      'approve the hook review'
    )
  })

  // Antigravity's permission gate has never been exercised against a real
  // payload, so this build does not offer to install its hooks. A support
  // table that still lists it would send a reader looking for a button that
  // is not there.
  it('does not present Antigravity as a supported agent', () => {
    const supported = readme.slice(
      readme.indexOf('## Supported agents'),
      readme.indexOf('## Fail-open guarantee')
    )
    expect(supported, 'the supported-agents table must not list Antigravity')
      .not.toContain('| Antigravity')
  })

  it('says which agents are planned', () => {
    expect(readme).toMatch(/Planned/)
    for (const agent of ['OpenCode', 'Cursor CLI', 'Antigravity CLI']) {
      expect(readme, `the planned list is missing ${agent}`).toContain(agent)
    }
  })
```

In `test/docs/limitations.test.ts`, replace the `MUST_STATE` array and the named-code-paths test:

```ts
// Everything here was on the README's front page before it was restructured.
// Moving a warning is fine; losing one in the move is not, and a deleted
// paragraph leaves no trace anyone would notice. These are the claims that
// have to survive.
//
// "failing open" and "structurally dead" left this list with the two
// Antigravity sections that stated them: this build does not install
// Antigravity hooks, so a caution about reaching its permission gate
// describes something no reader can reach. The README's "Fail-open
// guarantee" heading is a claim about dasbo's own design and is unrelated.
const MUST_STATE = [
  'notify-only',
  'has not been verified',
  'inferred',
]
```

```ts
  it('names the code paths a reader would go looking for', () => {
    expect(text).toContain('codexAdapter.encodeDecision')
  })
```

- [ ] **Step 2: Run the doc tests and watch them fail**

Run: `npx vitest run test/docs/readme.test.ts test/docs/limitations.test.ts`

Expected: FAIL — `the supported-agents table must not list Antigravity`, the planned-list assertion, and (from limitations) nothing yet, since removing entries from `MUST_STATE` cannot fail. The README failures are the ones that matter.

- [ ] **Step 3: Update the README features line**

Change:

```markdown
- **Every agent in one place.** Claude Code, Codex CLI, and Antigravity CLI
  sessions share the pill, each row led by a chip naming the agent.
```

to:

```markdown
- **Every agent in one place.** Claude Code and Codex CLI sessions share the
  pill, each row led by a chip naming the agent.
```

- [ ] **Step 4: Update the supported-agents table**

Delete the Antigravity row and add a planned line. The section becomes:

```markdown
## Supported agents

| Agent | Config touched | Status reporting | Permission gating |
|---|---|---|---|
| Claude Code | `~/.claude/settings.json` | 17 real hook-payload fixtures | yes |
| Codex CLI | `~/.codex/hooks.json` | 6 real fixtures (0.146.0) | no — [notify-only](docs/limitations.md#codex-has-no-permission-gate) |

Payload shapes for both are documented in
[docs/agent-dialects.md](docs/agent-dialects.md).

**Planned:** OpenCode, Cursor CLI, and Antigravity CLI appear on the Agents
page as *Coming soon* — listed, not installable. Antigravity has a complete
adapter and 12 captured fixtures, but its permission decision path has never
been exercised against a real payload, so it is not offered until it has been.
```

Note the sentence after the table changed from "all three" to "both".

- [ ] **Step 5: Delete the two Antigravity bullets from the limitations list**

Remove these two bullets from "Status and known limitations", leaving the other four exactly as they are:

```markdown
- **Antigravity's permission gate is unverified and may fail open.** No
  fixture exercises a real permission round-trip, so the response shape is a
  guess. If `agy` ignores it, **Deny** reports the tool as denied while it
  executes anyway — a security control failing open, silently.
  [Details](docs/limitations.md#the-antigravity-permission-gate-may-fail-open)
```

```markdown
- **Two of the four sound cues are structurally dead for Antigravity.**
  [Details](docs/limitations.md#two-sound-cues-are-dead-for-antigravity)
```

- [ ] **Step 6: Update the limitations page intro**

In `docs/limitations.md`, change:

```markdown
readable, not to keep it quiet — the two warnings that change what a user
should actually do, the Codex trust step and the Antigravity permission gate,
are stated in the README as well.
```

to:

```markdown
readable, not to keep it quiet — the warning that changes what a user should
actually do, the Codex trust step, is stated in the README as well.
```

- [ ] **Step 7: Delete the two Antigravity sections**

Delete `### The Antigravity permission gate may fail open` and its two paragraphs, and `### Two sound cues are dead for Antigravity` and its paragraph. The `## Permissions` heading now leads straight into `### Codex has no permission gate`, and `## Sound` leads straight into `### No cue has been confirmed audible`.

- [ ] **Step 8: Check no dead anchors remain**

Run: `grep -rn "antigravity-permission-gate\|sound-cues-are-dead\|#the-antigravity" README.md docs/ site/ || echo "no dead anchors"`

Expected: `no dead anchors`. Any hit is a link pointing at a heading that no longer exists — fix it before continuing.

- [ ] **Step 9: Run the doc tests and watch them pass**

Run: `npx vitest run test/docs/`

Expected: `readme.test.ts` and `limitations.test.ts` PASS. `readmeAssets.test.ts` still FAILS on the Antigravity hero row — that is Task 4's job.

- [ ] **Step 10: Commit**

```bash
git add README.md docs/limitations.md test/docs/readme.test.ts test/docs/limitations.test.ts
git commit -m "docs: stop presenting Antigravity as a supported agent"
```

---

### Task 4: The site, the demo timeline, and the hero mockup

**Files:**
- Modify: `site/index.html` (meta descriptions ~lines 7 and 9; lead paragraph ~line 32; demo row 3 ~lines 56-63; comparison table ~lines 103-110)
- Modify: `site/timeline.ts` (constants at lines 20-36; `TIMELINE` at lines 78-117)
- Modify: `test/site/timeline.test.ts` (the three-agents test)
- Modify: `docs/assets/hero.svg` (row 3, lines 68-74)
- Modify: `test/docs/readmeAssets.test.ts` (the agent-row list)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Update the failing tests first**

In `test/site/timeline.test.ts`, replace:

```ts
  it('shows all three agents at once mid-loop', () => {
    expect(storeAt(6_000).list().map((s) => s.agent).sort())
      .toEqual(['antigravity', 'claude', 'codex'])
  })
```

with:

```ts
  it('shows both agents at once mid-loop', () => {
    expect(storeAt(6_000).list().map((s) => s.agent).sort())
      .toEqual(['claude', 'codex'])
  })
```

In `test/docs/readmeAssets.test.ts`, replace:

```ts
    for (const agent of ['Claude', 'Codex', 'Antigravity']) {
```

with:

```ts
    for (const agent of ['Claude', 'Codex']) {
```

- [ ] **Step 2: Run the site and asset tests and watch them fail**

Run: `npx vitest run test/site/timeline.test.ts test/docs/readmeAssets.test.ts`

Expected: `timeline.test.ts` FAILS on `shows both agents at once mid-loop` — the store still holds an `antigravity` session at 6s. `readmeAssets.test.ts` PASSES already (asking for fewer rows than the file has).

- [ ] **Step 3: Narrow the timeline's per-session constants**

In `site/timeline.ts`, replace lines 20-36:

```ts
const IDS: Record<AgentId, string> = {
  claude: 'demo-claude',
  codex: 'demo-codex',
  antigravity: 'demo-agy',
}
const CWDS: Record<AgentId, string> = {
  claude: '/home/you/projects/rocket',
  codex: '/home/you/projects/website',
  antigravity: '/home/you/projects/blog',
}
const PIDS: Record<AgentId, number> = { claude: 4242, codex: 4243, antigravity: 4244 }

export const KEYS: Record<AgentId, string> = {
  claude: sessionKey('claude', IDS.claude),
  codex: sessionKey('codex', IDS.codex),
  antigravity: sessionKey('antigravity', IDS.antigravity),
}
```

with:

```ts
/**
 * The agents the demo drives. Narrower than `AgentId` on purpose: the page
 * beside this demo lists the agents this build supports, and a session for one
 * it does not would contradict the copy next to it.
 */
type DemoAgent = Extract<AgentId, 'claude' | 'codex'>

const IDS: Record<DemoAgent, string> = {
  claude: 'demo-claude',
  codex: 'demo-codex',
}
const CWDS: Record<DemoAgent, string> = {
  claude: '/home/you/projects/rocket',
  codex: '/home/you/projects/website',
}
const PIDS: Record<DemoAgent, number> = { claude: 4242, codex: 4243 }

export const KEYS: Record<DemoAgent, string> = {
  claude: sessionKey('claude', IDS.claude),
  codex: sessionKey('codex', IDS.codex),
}
```

Then change the `ev` signature on line 38 from `agent: AgentId` to `agent: DemoAgent`:

```ts
function ev(agent: DemoAgent, kind: EventKind, at: number, extra?: Partial<AgentEvent>): TimelineStep {
```

`AgentId` is still imported — `DemoAgent` derives from it.

- [ ] **Step 4: Move the error onto the Codex session**

In `TIMELINE`, delete these three steps:

```ts
  ev('antigravity', 'session-start', 5_000),
  ev('antigravity', 'prompt-submit', 5_400),
```

```ts
  ev('antigravity', 'error', 16_000, { detail: 'hook payload rejected' }),
  ev('antigravity', 'session-end', 19_000),
```

and in their place, between `ev('codex', 'tool-end', 15_000)` and `ev('codex', 'turn-end', 21_000)`, put:

```ts
  // The pill's `error` pose is one of the five the page claims to show, and
  // this is the only event that reaches it. It moved here from a session that
  // no longer exists; the retry two seconds later is what lets the pill leave
  // the state again, since `error` outranks `running` in pillState and would
  // otherwise hold the pill red until the loop ended.
  ev('codex', 'error', 16_000, { detail: 'hook payload rejected' }),
  ev('codex', 'tool-start', 18_000, { tool: 'Bash', detail: 'vitest run --retry 1' }),
  ev('codex', 'tool-end', 20_000),
```

The array must stay sorted by `at` — `15_000, 16_000, 18_000, 20_000, 21_000` is.

- [ ] **Step 5: Run the timeline test and watch it pass**

Run: `npx vitest run test/site/timeline.test.ts`

Expected: PASS, 5 tests. The pill-state walk matters most: `at(16_500)` must still be `error` and `at(19_500)` must still be `running`. If `at(19_500)` reports `error`, the retry step at 18s was not added or is misplaced.

- [ ] **Step 6: Update the site copy**

In `site/index.html`, in both the `<meta name="description">` and `<meta property="og:description">` tags, change `every live Claude Code, Codex, and Antigravity session` to `every live Claude Code and Codex session`. In the lead paragraph, change `every live Claude&nbsp;Code, Codex, and Antigravity session` to `every live Claude&nbsp;Code and Codex session`.

- [ ] **Step 7: Drop the Antigravity row from the demo markup**

Delete this block from `site/index.html`:

```html
      <div class="row state-idle">
        <div class="row-head">
          <span class="chip"><img src="icons/antigravity.svg" alt=""><span class="chip-name">Antigravity</span></span>
          <span class="project">blog</span>
          <span class="meta"><span class="elapsed">1m</span></span>
        </div>
        <div class="activity hint">idle</div>
      </div>
```

This is the pre-JavaScript markup the live demo replaces; leaving it would flash a session the timeline no longer creates.

- [ ] **Step 8: Update the site's agent table**

Delete the Antigravity row:

```html
      <tr><td>Antigravity CLI</td><td>Verified against 12 real hook-payload fixtures</td><td>Unverified — treat as best-effort</td></tr>
```

and add a planned line after the existing `<p class="fine">…</p>` in the `#agents` section:

```html
  <p class="fine">Planned: OpenCode, Cursor CLI, and Antigravity CLI are listed on the extension's Agents page as <em>Coming soon</em> — visible, not installable.</p>
```

- [ ] **Step 9: Redraw hero row 3 as a second Claude session**

In `docs/assets/hero.svg`, replace lines 68-74:

```svg
  <!-- row 3: Antigravity, idle -->
  <rect x="532" y="198" width="416" height="56" rx="8" fill="#ffffff" fill-opacity="0.05"/>
  <circle cx="552" cy="216" r="7" fill="none" stroke="#4285f4" stroke-width="2"/>
  <text class="ui bright" x="568" y="220" font-size="13">Antigravity</text>
  <text class="ui dim" x="648" y="220" font-size="13">blog</text>
  <text class="ui dim" x="936" y="220" font-size="12" text-anchor="end">1m</text>
  <text class="ui dim" x="552" y="240" font-size="12">idle</text>
```

with:

```svg
  <!-- row 3: a second Claude session, idle. Two sessions of one agent is the
       ordinary case, and this row is what shows the idle state. -->
  <rect x="532" y="198" width="416" height="56" rx="8" fill="#ffffff" fill-opacity="0.05"/>
  <circle cx="552" cy="216" r="7" fill="none" stroke="#d97757" stroke-width="2"/>
  <text class="ui bright" x="568" y="220" font-size="13">Claude</text>
  <text class="ui dim" x="624" y="220" font-size="13">blog</text>
  <text class="ui dim" x="936" y="220" font-size="12" text-anchor="end">1m</text>
  <text class="ui dim" x="552" y="240" font-size="12">idle</text>
```

`#d97757` is Claude's mark colour, taken from row 1 of the same file. The project label moves from `x="648"` to `x="624"` because "Claude" is narrower than "Antigravity" — row 1 already uses 624 after the same word.

- [ ] **Step 10: Verify the mockup still renders**

Run: `python3 -c "import xml.dom.minidom,sys; xml.dom.minidom.parse('docs/assets/hero.svg'); print('well-formed')"`

Expected: `well-formed`. If Python is unavailable, open the file in a browser instead and confirm three rows draw.

- [ ] **Step 11: Run the whole suite and build**

Run: `npm test && npm run typecheck && npm run build`

Expected: all tests PASS, typecheck exits 0, build prints `built dist/ and dist-site/`.

- [ ] **Step 12: Commit**

```bash
git add site/index.html site/timeline.ts docs/assets/hero.svg test/site/timeline.test.ts test/docs/readmeAssets.test.ts
git commit -m "docs(site): drop Antigravity from the demo, the table, and the mockup"
```

---

### Task 5: Changelog

**Files:**
- Modify: `CHANGELOG.md` (the `### Added` bullet at line 21-23)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Correct the hook-installation bullet**

In the `## [Unreleased]` / `### Added` list, change:

```markdown
- Hook install, update, and removal for Claude Code, Codex CLI, and
  Antigravity CLI, preserving other tools' entries and writing a `.dasbo.bak`
  backup before the first change.
```

to:

```markdown
- Hook install, update, and removal for Claude Code and Codex CLI, preserving
  other tools' entries and writing a `.dasbo.bak` backup before the first
  change.
- An Agents page listing OpenCode, Cursor CLI, and Antigravity CLI as *Coming
  soon*: shown with their controls insensitive, so the roadmap is visible
  without implying the hooks can be installed. Antigravity's adapter and its
  12 captured fixtures remain in the tree; its permission decision path has
  never been exercised against a real payload, so this release does not offer
  to install it.
```

Nothing has been released, so this is a correction to the unreleased entry rather than a new `### Changed` or `### Removed` section — there is no published behaviour to have changed.

- [ ] **Step 2: Final verification**

Run: `npm test && npm run typecheck && npm run build`

Expected: all tests PASS, typecheck exits 0 with no output, build prints `built dist/ and dist-site/`.

- [ ] **Step 3: Confirm nothing protected was touched**

Run:

```bash
git diff --stat master -- src/core/adapters/antigravity.ts src/icons/antigravity.svg test/core/adapters/antigravity.test.ts test/fixtures/antigravity/ src/core/install/plan.ts src/core/types.ts src/core/adapters/index.ts
```

Expected: empty output. Any file listed here means a constraint was broken — revert that file before committing.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: record the coming-soon agents in the changelog"
```
