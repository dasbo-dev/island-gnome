# Agent Chip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a chip carrying each agent's mark and short name at the head of every session row's title line, so a popup holding sessions from two agents says which is which.

**Architecture:** Three bundled SVGs live at `<extension.path>/icons/<AgentId>.svg`. A thin shell module resolves one into a `Gio.FileIcon` (memoised, `null` when absent); a small `St.BoxLayout` widget pairs that icon with a new `shortName` from the agent adapter; `SessionRow` inserts one such chip between its expander arrow and its project label. The extension's own directory is threaded from `extension.ts` through `Island` into each row — no module-scope mutable state.

**Tech Stack:** TypeScript, esbuild, GNOME Shell 46 (`St`, `Clutter`, `GObject`, `Gio` via `gi://`), vitest, plain CSS (`stylesheet.css`).

**Spec:** `docs/superpowers/specs/2026-07-30-agent-chip-design.md`

## Global Constraints

- `src/core/` must never import `gi://` or `resource://` — `test/core/purity.test.ts` enforces it. The `shortName` field is a plain string, which is why it may live in core.
- Shell code (`src/shell/`) is tested by assertion over source and CSS **text**. vitest runs without GNOME, so no shell widget can be instantiated in a test. This is the established house style — see `test/shell/dotAlignment.test.ts`, `insensitiveColor.test.ts`, `noEllipsis.test.ts`.
- `opacity` goes on the actor, never in CSS, for anything that must survive the row's `:insensitive` state. St's CSS engine does not reliably honour it.
- Icon files are named by `AgentId` (`claude`, `codex`, `antigravity`) — never by display name. The resolver is a string join with no lookup table.
- Every fixed-width consumer shares one constant: `.dasbo-fixed-width` in `stylesheet.css`. Its value after this work is `30em` (was `26em`).
- Chip short names, exact: `Claude`, `Codex`, `Antigravity`.
- Brand fills, exact: claude `#d97757`, antigravity `#4285f4`, codex `#9e9e9e` (see Task 2 — the spec's original `#0d0d0d` is corrected there).
- Commit after every task. Test commands: `npx vitest run <file>` for one file, `npm test` for all, `npm run typecheck` for types.

---

### Task 1: `shortName` on every adapter

The chip cannot say "Antigravity CLI" — at 30em the suffix is width the project name loses, and it distinguishes nothing. This adds the shorter name beside the existing `displayName`, in core, as a plain string.

**Files:**
- Modify: `src/core/adapters/index.ts` (the `AgentAdapter` interface, after `displayName: string`)
- Modify: `src/core/adapters/claude.ts:64`
- Modify: `src/core/adapters/codex.ts:41`
- Modify: `src/core/adapters/antigravity.ts:27`
- Test: `test/core/adapters/index.test.ts` (append a new `describe`)

**Interfaces:**
- Consumes: nothing.
- Produces: `AgentAdapter.shortName: string`, read by Task 4 as `adapters[agent].shortName`.

- [ ] **Step 1: Write the failing test**

Append to the end of `test/core/adapters/index.test.ts`:

```ts
describe('adapter chip names', () => {
  it('gives every adapter a non-empty short name for the row chip', () => {
    for (const id of ['claude', 'codex', 'antigravity'] as const) {
      expect(adapters[id].shortName.trim(), id).not.toBe('')
    }
  })

  // The chip exists because the row is width-starved. A shortName longer than
  // the displayName it replaces would mean someone forgot what it is for.
  it('keeps each short name no longer than the display name it stands in for', () => {
    for (const id of ['claude', 'codex', 'antigravity'] as const) {
      expect(adapters[id].shortName.length, id)
        .toBeLessThanOrEqual(adapters[id].displayName.length)
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/core/adapters/index.test.ts`

Expected: FAIL — `TypeError: Cannot read properties of undefined (reading 'trim')`, because `shortName` does not exist yet.

- [ ] **Step 3: Add the field to the interface**

In `src/core/adapters/index.ts`, inside `export interface AgentAdapter`, directly after `displayName: string`:

```ts
  displayName: string
  /**
   * The name the session row's chip carries. Deliberately shorter than
   * displayName: the chip leads a 30em row, where "Code" and "CLI"
   * distinguish nothing and every character is width the project name loses.
   */
  shortName: string
```

- [ ] **Step 4: Add the value to each adapter**

`src/core/adapters/claude.ts`, after `displayName: 'Claude Code',`:

```ts
  shortName: 'Claude',
```

`src/core/adapters/codex.ts`, after `displayName: 'Codex CLI',`:

```ts
  shortName: 'Codex',
```

`src/core/adapters/antigravity.ts`, after `displayName: 'Antigravity CLI',`:

```ts
  shortName: 'Antigravity',
```

- [ ] **Step 5: Run the tests and the typechecker**

Run: `npx vitest run test/core/adapters/index.test.ts && npm run typecheck`

Expected: PASS, and typecheck exits 0. (If a fourth adapter exists by then, `tsc` fails on the missing field — that is the interface doing its job.)

- [ ] **Step 6: Commit**

```bash
git add src/core/adapters/ test/core/adapters/index.test.ts
git commit -m "feat(core): give every agent a name short enough for a row chip"
```

---

### Task 2: The three marks, and their trip into `dist`

Hand-authored 16×16 SVGs, one per `AgentId`. The test is the point: a renamed file or a dropped copy step loses the mark silently, and nothing else in the suite would notice.

**Files:**
- Create: `src/icons/claude.svg`
- Create: `src/icons/codex.svg`
- Create: `src/icons/antigravity.svg`
- Modify: `build.mjs` (after the `schemas` copy)
- Modify: `docs/superpowers/specs/2026-07-30-agent-chip-design.md` (the codex colour)
- Test: `test/shell/iconAssets.test.ts`

**Interfaces:**
- Consumes: `AgentId` keys of `adapters` (already exported from `src/core/adapters/index.ts`).
- Produces: files at `src/icons/<AgentId>.svg`, copied to `dist/icons/<AgentId>.svg`. Task 3 resolves them as `<base>/icons/<agent>.svg`.

**Spec correction made here:** the spec's `codex.svg` fill is `#0d0d0d`, matching Codex's black brand mark. Near-black is invisible against GNOME's dark popup background, so this uses `#9e9e9e` — the same grey `.dasbo-dot` already uses in `stylesheet.css`, a value known to read in this popup under both themes. Step 5 amends the spec so the document does not lie.

- [ ] **Step 1: Write the failing test**

Create `test/shell/iconAssets.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { adapters } from '../../src/core/adapters/index.js'

// The chip's mark is a file on disk, found by a path built from the AgentId.
// Nothing at runtime fails when that file is missing — agentIcon returns null
// and the chip quietly renders a bare name — so a rename, or a build.mjs that
// forgets to copy the directory, is a silent feature death. This test is the
// only thing standing between that and a shipped release.
describe('the agent chip marks', () => {
  for (const id of Object.keys(adapters)) {
    const path = `src/icons/${id}.svg`

    it(`${path} exists and draws something`, () => {
      // readFileSync throwing on a missing file *is* the existence assertion.
      const svg = readFileSync(path, 'utf8')
      expect(svg, `${path} needs a 16x16 viewBox`).toMatch(/<svg[^>]*viewBox="0 0 16 16"/)
      expect(svg, `${path} has no path to draw`).toMatch(/<path[^>]*\sd="/)
    })
  }

  it('ships with the extension — build.mjs copies the directory into dist', () => {
    const build = readFileSync('build.mjs', 'utf8')
    expect(build).toMatch(/cp\('src\/icons',\s*'dist\/icons'/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/shell/iconAssets.test.ts`

Expected: FAIL — `ENOENT: no such file or directory, open 'src/icons/claude.svg'`, and the `build.mjs` case fails too.

- [ ] **Step 3: Create the three SVGs**

`src/icons/claude.svg` — eight-spoke burst, terracotta:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <g fill="none" stroke="#d97757" stroke-width="1.6" stroke-linecap="round">
    <path d="M8 1.8V14.2"/>
    <path d="M1.8 8h12.4"/>
    <path d="M3.6 3.6l8.8 8.8"/>
    <path d="M12.4 3.6l-8.8 8.8"/>
  </g>
</svg>
```

`src/icons/codex.svg` — rounded hex outline, mid-grey (see the correction note above):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <path d="M8 1.4l5.7 3.3v6.6L8 14.6 2.3 11.3V4.7z"
        fill="none" stroke="#9e9e9e" stroke-width="1.5" stroke-linejoin="round"/>
</svg>
```

`src/icons/antigravity.svg` — arrow rising inside an orbit arc, blue:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <g fill="none" stroke="#4285f4" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2.6 11.4a6.2 6.2 0 1 1 10.8 0"/>
    <path d="M8 13.6V5.4"/>
    <path d="M5.5 7.9L8 5.4l2.5 2.5"/>
  </g>
</svg>
```

- [ ] **Step 4: Teach the build to copy them**

In `build.mjs`, directly after the existing `await cp('schemas', 'dist/schemas', { recursive: true })`:

```js
// The session row's agent chip loads these by absolute path at
// <extension.path>/icons/<agent>.svg. A missing file is invisible at runtime —
// the chip just drops its mark — so test/shell/iconAssets.test.ts guards this
// line.
await cp('src/icons', 'dist/icons', { recursive: true })
```

- [ ] **Step 5: Amend the spec's codex colour**

In `docs/superpowers/specs/2026-07-30-agent-chip-design.md`, replace the codex row of the assets table:

```markdown
| `codex.svg` | Near-black (`#0d0d0d`) rounded hex outline |
```

with:

```markdown
| `codex.svg` | Mid-grey (`#9e9e9e`) rounded hex outline. Codex's own mark is black, which is invisible against GNOME's dark popup; this is the grey `.dasbo-dot` already uses, known to read under both themes |
```

- [ ] **Step 6: Run the test and the build**

Run: `npx vitest run test/shell/iconAssets.test.ts && npm run build && ls dist/icons`

Expected: PASS, then `antigravity.svg  claude.svg  codex.svg`.

- [ ] **Step 7: Commit**

```bash
git add src/icons build.mjs test/shell/iconAssets.test.ts docs/superpowers/specs/2026-07-30-agent-chip-design.md
git commit -m "feat: draw a mark for each agent, and ship it with the extension"
```

---

### Task 3: `agentIcon.ts` — where a mark lives

One function, one cache. The cache is not about speed: it stops a *missing* file from becoming a `stat` on every row, and holds the sync existence check to at most three calls per shell session.

**Files:**
- Create: `src/shell/agentIcon.ts`
- Test: `test/shell/agentIcon.test.ts`

**Interfaces:**
- Consumes: `AgentId` from `src/core/types.js`; the files from Task 2.
- Produces: `agentGicon(base: string, agent: AgentId): Gio.Icon | null` — Task 4 calls it and must handle `null`.

- [ ] **Step 1: Write the failing test**

Create `test/shell/agentIcon.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Source assertions, not behaviour: this module imports gi://Gio, which cannot
// load under vitest. Same constraint, and the same house style, as
// dotAlignment.test.ts and insensitiveColor.test.ts.
describe('agentIcon', () => {
  const src = readFileSync('src/shell/agentIcon.ts', 'utf8')

  it('builds the path from the AgentId, with no name table to drift', () => {
    expect(src).toMatch(/\$\{base\}\/icons\/\$\{agent\}\.svg/)
  })

  it('checks the file exists rather than handing St a path that is not there', () => {
    expect(src).toContain('query_exists')
  })

  it('caches a miss as well as a hit', () => {
    // A cache that only stores successes re-stats a missing file on every
    // lookup, which is the exact case the cache exists for: an agent whose
    // mark failed to ship. `undefined` has to mean "never looked" so that a
    // cached `null` can mean "looked, not there".
    expect(src).toMatch(/!==\s*undefined/)
  })

  it('never lets a resolution failure escape into a row build', () => {
    expect(src).toContain('catch')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/shell/agentIcon.test.ts`

Expected: FAIL — `ENOENT: no such file or directory, open 'src/shell/agentIcon.ts'`.

- [ ] **Step 3: Write the module**

Create `src/shell/agentIcon.ts`:

```ts
import Gio from 'gi://Gio'
import type { AgentId } from '../core/types.js'

/**
 * Resolved marks, keyed `${base}:${agent}`.
 *
 * `undefined` from this map means "never looked"; a stored `null` means
 * "looked, not there". The distinction is the whole point: without it a
 * missing SVG — the case the cache is for — would be re-stat'd on every
 * lookup, while the case that never fails would be the only one cached.
 *
 * The base path is part of the key rather than assumed constant because it is
 * the extension's install directory, which changes between a system install
 * and a user one, and this module has no way to know a reload happened.
 */
const cache = new Map<string, Gio.Icon | null>()

/**
 * The agent's mark as a gicon, or `null` when the file is not there.
 *
 * Returning `null` rather than throwing or substituting a stock icon is what
 * lets the chip degrade to a bare name: a missing mark costs the row its icon
 * and nothing else. See the fail-open note in the README — the same principle,
 * applied to a decoration instead of a hook.
 */
export function agentGicon(base: string, agent: AgentId): Gio.Icon | null {
  const key = `${base}:${agent}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  let icon: Gio.Icon | null = null
  try {
    const file = Gio.File.new_for_path(`${base}/icons/${agent}.svg`)
    icon = file.query_exists(null) ? Gio.FileIcon.new(file) : null
  } catch (e) {
    // query_exists does not throw for an absent file, but it can for a path
    // that is not readable at all. This runs inside a row build, and an
    // exception escaping there takes the whole popup rebuild with it — a
    // missing decoration must never cost the user their session list.
    console.warn(`dasbo-island: resolving the ${agent} mark failed: ${e}`)
    icon = null
  }

  cache.set(key, icon)
  return icon
}
```

- [ ] **Step 4: Run the test and the typechecker**

Run: `npx vitest run test/shell/agentIcon.test.ts && npm run typecheck`

Expected: PASS, typecheck exits 0.

- [ ] **Step 5: Verify core purity is intact**

Run: `npx vitest run test/core/purity.test.ts`

Expected: PASS — the new `gi://Gio` import is in `src/shell/`, which purity does not police. (If this fails, the file was created in the wrong directory.)

- [ ] **Step 6: Commit**

```bash
git add src/shell/agentIcon.ts test/shell/agentIcon.test.ts
git commit -m "feat(shell): find an agent's mark on disk, or say there is none"
```

---

### Task 4: The `AgentChip` widget

A box, an icon, a label. No `update()` — and the absence is deliberate enough to test for.

**Files:**
- Create: `src/shell/agentChip.ts`
- Test: `test/shell/agentChip.test.ts`

**Interfaces:**
- Consumes: `agentGicon(base, agent)` from Task 3; `adapters[agent].shortName` from Task 1.
- Produces: `AgentChip`, constructed as `new AgentChip(agent: AgentId, iconBase: string)`. Task 5 adds one to `SessionRow`'s title row.

- [ ] **Step 1: Write the failing test**

Create `test/shell/agentChip.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('AgentChip', () => {
  const src = readFileSync('src/shell/agentChip.ts', 'utf8')

  it('carries the short name, not the display name', () => {
    expect(src).toContain('shortName')
    expect(src).not.toContain('displayName')
  })

  it('omits the icon rather than handing St a null gicon', () => {
    expect(src).toMatch(/if\s*\(gicon\)/)
  })

  it('sets the icon opacity on the actor, not in CSS', () => {
    // St's CSS engine does not reliably honour `opacity`, and the row is built
    // reactive: false, so the theme paints its descendants disabled-grey. The
    // same workaround popupHeader.ts and sessionRow.ts's _shellTotal carry.
    expect(src).toMatch(/\.opacity\s*=\s*255/)
  })

  it('has no update method, because a row never changes agent', () => {
    // sessionKey is `${agent}:${sessionId}` (core/types.ts): a row's agent is
    // fixed for the row's whole life. An update path here would model a
    // transition that cannot happen, and invite a caller to rely on it.
    expect(src).not.toMatch(/\bupdate\s*\(/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/shell/agentChip.test.ts`

Expected: FAIL — `ENOENT: no such file or directory, open 'src/shell/agentChip.ts'`.

- [ ] **Step 3: Write the widget**

Create `src/shell/agentChip.ts`:

```ts
import St from 'gi://St'
import Clutter from 'gi://Clutter'
import GObject from 'gi://GObject'
import { adapters } from '../core/adapters/index.js'
import { agentGicon } from './agentIcon.js'
import type { AgentId } from '../core/types.js'

/**
 * The agent's mark and short name, as one tag at the head of a session row.
 *
 * Deliberately has no update() method: `sessionKey` is `${agent}:${sessionId}`
 * (see core/types.ts), so a row's agent is fixed for the row's entire life. A
 * chip that could change its agent would model a transition that cannot occur,
 * and would invite the Island to call it on every refresh for no reason.
 */
export const AgentChip = GObject.registerClass(
  class AgentChip extends St.BoxLayout {
    constructor(agent: AgentId, iconBase: string) {
      super({
        style_class: 'dasbo-agent-chip',
        // Never absorbs the row's slack, and never shrinks: the project label
        // beside it is the one thing that yields width (it ellipsizes — see
        // sessionRow.ts). A chip that could grow would eat that label's room.
        x_expand: false,
        y_align: Clutter.ActorAlign.CENTER,
      })

      const gicon = agentGicon(iconBase, agent)
      if (gicon) {
        const icon = new St.Icon({
          gicon,
          icon_size: 14,
          y_align: Clutter.ActorAlign.CENTER,
        })
        // On the actor, not in CSS: St's CSS engine does not reliably honour
        // `opacity` (the finding recorded on popupHeader.ts's empty label and
        // sessionRow.ts's _shellTotal), and this sits inside a row built
        // reactive: false, which the shell theme paints as disabled.
        icon.opacity = 255
        this.add_child(icon)
      }

      // Added whether or not the icon was: a chip whose mark failed to ship
      // still has to say which agent the row belongs to.
      this.add_child(
        new St.Label({
          text: adapters[agent].shortName,
          style_class: 'dasbo-agent-chip-label',
          y_align: Clutter.ActorAlign.CENTER,
        })
      )
    }
  }
)
```

- [ ] **Step 4: Run the test and the typechecker**

Run: `npx vitest run test/shell/agentChip.test.ts && npm run typecheck`

Expected: PASS, typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/shell/agentChip.ts test/shell/agentChip.test.ts
git commit -m "feat(shell): build the chip that names an agent"
```

---

### Task 5: Put the chip on the row

Threads the extension's directory from `enable()` down to the row, inserts the chip, and styles it. After this task the feature is visible.

**Files:**
- Modify: `src/extension.ts:42` (the `new Island(...)` call)
- Modify: `src/shell/island.ts:100` (constructor signature), plus a private field, plus `src/shell/island.ts:601` (the `new SessionRow(...)` call)
- Modify: `src/shell/sessionRow.ts:61` (constructor signature) and `src/shell/sessionRow.ts:155-157` (the `titleRow.add_child` sequence)
- Modify: `stylesheet.css` (two new rules)
- Test: `test/shell/agentChip.test.ts` (append a second `describe`)

**Interfaces:**
- Consumes: `AgentChip` from Task 4.
- Produces: `Island(store, settings, iconBase: string)` and `SessionRow(session, cb, now, iconBase: string)` — both signatures gain one trailing required `string`.

- [ ] **Step 1: Write the failing test**

Append to `test/shell/agentChip.test.ts`:

```ts
describe('the chip on the row', () => {
  const row = readFileSync('src/shell/sessionRow.ts', 'utf8')
  const island = readFileSync('src/shell/island.ts', 'utf8')
  const extension = readFileSync('src/extension.ts', 'utf8')
  const css = readFileSync('stylesheet.css', 'utf8')

  it('leads the title line: arrow, then chip, then project name', () => {
    // Order is the design decision, not an accident — the row is meant to read
    // as one phrase ("Claude, on dasbo-island"), which is also why the project
    // names no longer align down the popup's left edge.
    const order = /titleRow\.add_child\(this\._expander\)\s*\n\s*titleRow\.add_child\(chip\)\s*\n\s*titleRow\.add_child\(this\._project\)/
    expect(row).toMatch(order)
  })

  it('gets the icon directory from the extension, not from a guess', () => {
    expect(extension).toMatch(/new Island\(this\._store,\s*settings,\s*this\.path\)/)
    expect(island).toMatch(/iconBase/)
    expect(row).toMatch(/iconBase/)
  })

  it('styles the chip as a tag, subordinate to the project name', () => {
    expect(css).toMatch(/\.dasbo-agent-chip\s*\{[^}]*border-radius/)
    // 0.85em and normal weight against .dasbo-row-project's bold: the row's
    // title has to keep winning the eye.
    expect(css).toMatch(/\.dasbo-agent-chip-label\s*\{[^}]*font-size:\s*0\.85em/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/shell/agentChip.test.ts`

Expected: FAIL on all three cases in the new `describe` — the first reports the `titleRow` order regex not matching.

- [ ] **Step 3: Take the path in `SessionRow` and build the chip**

In `src/shell/sessionRow.ts`, add the import beside the existing ones:

```ts
import { AgentChip } from './agentChip.js'
```

Change the constructor signature (line 61) from:

```ts
    constructor(session: Session, cb: SessionRowCallbacks, now: number) {
```

to:

```ts
    constructor(session: Session, cb: SessionRowCallbacks, now: number, iconBase: string) {
```

Then replace the three `titleRow.add_child(...)` calls (lines 155-157):

```ts
      titleRow.add_child(this._expander)
      titleRow.add_child(this._project)
      titleRow.add_child(this._shellTotal)
```

with:

```ts
      // The chip is built once and never updated: sessionKey is
      // `${agent}:${sessionId}`, so this row's agent cannot change under it.
      // It is not held on a field for the same reason — nothing ever needs to
      // reach it again.
      const chip = new AgentChip(session.agent, iconBase)
      titleRow.add_child(this._expander)
      titleRow.add_child(chip)
      titleRow.add_child(this._project)
      titleRow.add_child(this._shellTotal)
```

- [ ] **Step 4: Thread the path through `Island`**

In `src/shell/island.ts`, add a field beside `_settings` (near line 45):

```ts
    private _iconBase!: string
```

Change the constructor signature (line 100) from:

```ts
    constructor(store: SessionStore, settings: Gio.Settings) {
```

to:

```ts
    constructor(store: SessionStore, settings: Gio.Settings, iconBase: string) {
```

and add the assignment beside the other two, directly after `this._settings = settings`:

```ts
      // The extension's own directory, where the agent chips' SVGs live. Passed
      // in rather than looked up here: a module that resolves its own install
      // path is a module that silently resolves the wrong one after a reload.
      this._iconBase = iconBase
```

Then in the row construction (line 601), change:

```ts
          }, now)
```

to:

```ts
          }, now, this._iconBase)
```

- [ ] **Step 5: Hand it the path from `enable()`**

In `src/extension.ts:42`, change:

```ts
    this._island = new Island(this._store, settings)
```

to:

```ts
    this._island = new Island(this._store, settings, this.path)
```

- [ ] **Step 6: Style the chip**

Append to `stylesheet.css`:

```css
/* The agent chip at the head of a session row's title line: mark plus short
   name. Mid-grey at low alpha rather than a white or black wash, so it lifts
   off the popup background under both the light and the dark theme.

   No colour rule: `.dasbo-row:insensitive` already resolves to
   `color: inherit` and colour inherits, so the label picks up the colour the
   row has already reclaimed from the theme's disabled grey. */
.dasbo-agent-chip {
  background-color: rgba(127, 127, 127, 0.18);
  border-radius: 99px;
  padding: 1px 6px;
  spacing: 4px;
}

/* Smaller and unbolded against .dasbo-row-project's bold: the chip is a tag on
   the row, not the row's title. */
.dasbo-agent-chip-label {
  font-size: 0.85em;
  font-weight: normal;
}
```

- [ ] **Step 7: Run the whole suite and the typechecker**

Run: `npm test && npm run typecheck`

Expected: PASS throughout, typecheck exits 0. `insensitiveColor.test.ts` stays green untouched — it scans for `reactive: false` menu items, and the chip is a plain `St.BoxLayout`.

- [ ] **Step 8: See it on screen**

Run: `make install`, then reload the shell (X11: `Alt+F2`, `r`, Enter — Wayland: log out and back in), then:

```bash
tools/fake-agent.js session
```

Expected: the pill appears; clicking it shows a row reading `[◆ Claude] <your cwd basename>` with the terracotta burst as the mark. The name may be tightly ellipsized — Task 6 buys back the width.

- [ ] **Step 9: Commit**

```bash
git add src/extension.ts src/shell/island.ts src/shell/sessionRow.ts stylesheet.css test/shell/agentChip.test.ts
git commit -m "feat(shell): lead each row with the agent doing the work"
```

---

### Task 6: Buy the chip its width

The chip is now competing with the project name inside a 26em row. This widens the popup to 30em and adds the test that stops the constant and the prose about it from drifting apart again — which is exactly what this change would otherwise cause.

**Files:**
- Modify: `stylesheet.css:148` (`.dasbo-fixed-width`)
- Modify: `src/core/questions.ts:104` (prose)
- Modify: `src/shell/questionPanel.ts:157` (prose)
- Modify: `test/shell/noEllipsis.test.ts:23` (prose)
- Test: `test/shell/popupWidth.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing new. `.dasbo-fixed-width` remains the single source of the popup's width, now `30em`.

- [ ] **Step 1: Write the failing test**

Create `test/shell/popupWidth.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// The popup's width is one number, declared once in .dasbo-fixed-width, and
// reasoned about in prose in three other places: two comments explaining why a
// question's option is a single Pango-marked-up label rather than two columns,
// and one explaining what an unwrapped line overhangs. Those comments are the
// argument for the code around them, and an argument citing a width the
// stylesheet no longer uses is worse than no comment at all.
//
// Widening the popup for the agent chip is precisely the change that creates
// that drift, so this guard ships with it.
const SITES = [
  'src/core/questions.ts',
  'src/shell/questionPanel.ts',
  'test/shell/noEllipsis.test.ts',
]

describe('the popup width the code talks about', () => {
  const css = readFileSync('stylesheet.css', 'utf8')
  const declared = /\.dasbo-fixed-width\s*\{[^}]*width:\s*(\d+)em/.exec(css)

  it('is declared in the stylesheet, in em', () => {
    expect(declared, '.dasbo-fixed-width needs a width in em').not.toBeNull()
  })

  for (const site of SITES) {
    it(`${site} quotes that same number`, () => {
      const src = readFileSync(site, 'utf8')
      const quoted = [...src.matchAll(/(\d+)em/g)].map((m) => m[1])
      expect(
        quoted.length,
        `${site} no longer mentions a width — drop it from SITES`
      ).toBeGreaterThan(0)
      for (const n of quoted) expect(n).toBe(declared?.[1])
    })
  }
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/shell/popupWidth.test.ts`

Expected: the three per-site cases PASS (everything still says 26em, including the stylesheet) and nothing fails yet. That is correct and expected — this test guards the *next* step, so run it again after Step 3 to see it catch the drift.

- [ ] **Step 3: Widen the popup and watch the test fail**

In `stylesheet.css:148`, change:

```css
.dasbo-fixed-width { width: 26em; }
```

to:

```css
/* Every consumer grows together: the header, the empty-state row, each session
   row, and the question panel that wraps against it. Widened from 26em to make
   room for the agent chip at the head of each row's title line, so the project
   name did not pay for the chip out of its own width. */
.dasbo-fixed-width { width: 30em; }
```

Run: `npx vitest run test/shell/popupWidth.test.ts`

Expected: FAIL — all three site cases now report `expected "26" to be "30"`. This is the drift the test exists to catch.

- [ ] **Step 4: Correct the three prose sites**

`src/core/questions.ts:104` — change `fixed at 26em` to `fixed at 30em`.

`src/shell/questionPanel.ts:157` — change `26em, and a description` to `30em, and a description`.

`test/shell/noEllipsis.test.ts:23` — change `fixed 26em width` to `fixed 30em width`.

- [ ] **Step 5: Run the whole suite and the typechecker**

Run: `npm test && npm run typecheck`

Expected: PASS throughout, typecheck exits 0.

- [ ] **Step 6: See the wider popup**

Run: `make install`, reload the shell, then:

```bash
tools/fake-agent.js session
tools/fake-agent.js ask ask-1
```

Expected: the popup is visibly wider; the chip and a full project name sit side by side; the question panel's options still wrap at the new width without overhanging the popup background.

- [ ] **Step 7: Commit**

```bash
git add stylesheet.css src/core/questions.ts src/shell/questionPanel.ts test/shell/noEllipsis.test.ts test/shell/popupWidth.test.ts
git commit -m "feat(shell): widen the popup so the chip does not cost the project its name"
```

---

### Task 7: See all three chips at once

The mixed-agent popup is the entire reason the chip exists, and right now it cannot be looked at: `tools/fake-agent.js` hardcodes `'claude'`. This makes the impersonated agent selectable and documents the row's new contents.

**Files:**
- Modify: `tools/fake-agent.js:80` and its usage comment at the top
- Modify: `README.md` (the paragraph describing what a row shows)

**Interfaces:**
- Consumes: nothing.
- Produces: an `AGENT` environment override for the fake agent. Not imported by anything.

- [ ] **Step 1: Make the impersonated agent selectable**

In `tools/fake-agent.js`, extend the usage comment at the top:

```js
// Drives the extension over D-Bus without running a real agent.
// Usage: tools/fake-agent.js session|tool|perm|ask|tasks|notify|sessionend [session-id]
// The session id defaults to fake-1. Pass distinct ids to create distinct
// sessions — the store keys on agent + session id, so reusing one id updates
// the same row instead of adding another.
//
// AGENT=claude|codex|antigravity picks which agent to impersonate; it defaults
// to claude. Only the `session` mode is written in all three dialects, which is
// enough to get one row per agent on screen — what the row's agent chip needs
// eyes on. Every other mode stays Claude-shaped: codex reads the same
// session_id/cwd keys (see KIND_BY_EVENT in src/core/adapters/codex.ts), while
// antigravity shares no key names at all.
```

Directly after the existing `const FAKE_PID = 4242`, add:

```js
const AGENT = GLib.getenv('AGENT') ?? 'claude'

// Session start, per dialect. Antigravity names no event in its payload (argv
// is the only source) and reports its workspace as a list, so it needs both a
// different event and a different shape.
const sessionByAgent = {
  claude: {
    event: 'SessionStart',
    payload: {
      hook_event_name: 'SessionStart', session_id: sessionId, cwd: GLib.get_current_dir(),
    },
  },
  codex: {
    event: 'SessionStart',
    payload: {
      hook_event_name: 'SessionStart', session_id: sessionId, cwd: GLib.get_current_dir(),
    },
  },
  antigravity: {
    event: 'PreInvocation',
    payload: { conversationId: sessionId, workspacePaths: [GLib.get_current_dir()] },
  },
}
```

Then replace the three lines starting at the old line 76:

```js
const EVENT = events[mode] ?? events.session
const payload = JSON.stringify(payloads[mode] ?? payloads.session)
```

with:

```js
const dialect = mode === 'session' ? sessionByAgent[AGENT] : null
const EVENT = dialect?.event ?? events[mode] ?? events.session
const payload = JSON.stringify(dialect?.payload ?? payloads[mode] ?? payloads.session)
```

and change the D-Bus argument tuple (the old line 80) from:

```js
const args = new GLib.Variant('(sssis)', ['claude', EVENT, GLib.get_current_dir(), FAKE_PID, payload])
```

to:

```js
const args = new GLib.Variant('(sssis)', [AGENT, EVENT, GLib.get_current_dir(), FAKE_PID, payload])
```

- [ ] **Step 2: Verify all three chips render**

Run: `make install`, reload the shell, then:

```bash
tools/fake-agent.js session c-1
AGENT=codex tools/fake-agent.js session x-1
AGENT=antigravity tools/fake-agent.js session g-1
```

Expected: three rows in the popup, each led by its own chip — `[burst Claude]`, `[hex Codex]`, `[arrow Antigravity]` — each followed by the project name. If a row is missing, check `enabled-agents` in the preferences (all three are enabled by default per the gschema).

- [ ] **Step 3: Confirm the fail-soft path**

Run:

```bash
mv ~/.local/share/gnome-shell/extensions/dasbo-island@ayubaswad.gmail.com/icons/codex.svg /tmp/
```

Reload the shell and re-run the three commands from Step 2.

Expected: the Codex row shows `[Codex]` — the name with no mark, no gap where an icon would be, no error in `journalctl -f -o cat /usr/bin/gnome-shell`. Then restore it:

```bash
mv /tmp/codex.svg ~/.local/share/gnome-shell/extensions/dasbo-island@ayubaswad.gmail.com/icons/
```

- [ ] **Step 4: Say what the row shows now**

In `README.md`, directly after the paragraph beginning "The pill shows a 2×2 grid", add:

```markdown
Each session row is led by a chip naming the agent doing the work — its mark
and a short name — so a popup holding a Claude Code session beside a Codex one
says which is which at a glance. The marks are drawn for this extension rather
than taken from each vendor, and they do not recolour with a light or dark
theme.
```

- [ ] **Step 5: Run the whole suite one last time**

Run: `npm test && npm run typecheck`

Expected: PASS throughout, typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add tools/fake-agent.js README.md
git commit -m "feat(tools): let the fake agent impersonate any of the three"
```

---

## Self-Review

**Spec coverage.** `shortName` → Task 1. Assets, colours, `build.mjs` → Task 2. `agentIcon.ts` with the keyed cache and null return → Task 3. `AgentChip`, the null-gicon guard, actor opacity, no `update()` → Task 4. Placement between expander and project, `Island`/`SessionRow`/`extension.ts` threading, both chip CSS rules, the no-colour-rule note → Task 5. 30em plus the three prose corrections plus `popupWidth.test.ts` → Task 6. `iconAssets.test.ts` → Task 2; `agentChip.test.ts` → Tasks 4 and 5; adapters test → Task 1. The `AGENT` override for manual verification → Task 7. The spec's error-handling table: missing SVG and bad `iconBase` are Task 3's `null` return, exercised for real in Task 7 Step 3; malformed SVG and unknown agent need no code, as the spec states.

**One deliberate deviation.** The spec's `codex.svg` fill of `#0d0d0d` is invisible on a dark popup. Task 2 uses `#9e9e9e` and amends the spec in the same commit, so the two documents agree.

**Type consistency.** `agentGicon(base: string, agent: AgentId): Gio.Icon | null` — defined Task 3, called Task 4. `new AgentChip(agent, iconBase)` — defined Task 4, called Task 5. `Island(store, settings, iconBase)` and `SessionRow(session, cb, now, iconBase)` — both gain one trailing `string`, and both call sites are updated in the same task. `shortName` is spelled identically in Tasks 1 and 4. `iconBase` is the parameter name at every level; `base` only inside `agentIcon.ts`, where it is the local name in the signature the test asserts.
