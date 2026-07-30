# Agent chip display mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the agent chip on each session row show the mark alone, the mark with a short name, or the name alone, chosen in preferences and applied to open rows immediately.

**Architecture:** A new pure module `src/core/chipDisplay.ts` decides which of the chip's two children are visible for a given mode; `AgentChip` builds both children once and toggles their `visible` from that decision; `Island` reads the new GSettings key, passes it into each `SessionRow`, and on `changed::agent-chip-display` pushes the new mode into the live rows without rebuilding them.

**Tech Stack:** TypeScript, GJS / GNOME Shell 46 (St, Clutter, GObject, Adw, Gtk), GSettings, esbuild (`npm run build`), vitest (`npm test`).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-30-agent-chip-display-design.md`. Every decision below comes from it.
- **`src/core/` must never import `gi://` or `resource://`** — enforced by `test/core/purity.test.ts`.
- **Settings key name:** `agent-chip-display`. **Values:** `logo`, `logo-name`, `name`. **Default:** `logo-name`.
- **Shell widgets cannot be instantiated under vitest** (no GJS). Tests for `src/shell/` are source-text guards read with `readFileSync`, matching the existing style of `test/shell/agentChip.test.ts`.
- **The popup width is fixed** (`.dasbo-fixed-width` in `stylesheet.css`). No task changes it.
- **The chip keeps its grey pill chrome in all three modes.** No task changes `.dasbo-agent-chip` styling.
- **Run tests with** `npx vitest run <path>` for one file, `npm test` for all. Typecheck with `npm run typecheck` (checks `tsconfig.json` and `tsconfig.test.json`, exits non-zero if either fails).
- **Commit after every task.** Message style follows the repo: `type(scope): lowercase sentence`.

## File Structure

| File | Responsibility |
|---|---|
| `src/core/chipDisplay.ts` (create) | The pure decision: mode + whether a mark exists → which parts show |
| `test/core/chipDisplay.test.ts` (create) | Real unit tests for that decision |
| `schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml` (modify) | The `agent-chip-display` key |
| `src/prefs.ts` (modify) | The combo row that writes it |
| `test/shell/chipDisplayPrefs.test.ts` (create) | Guards the schema choices against the prefs index mapping |
| `src/shell/agentChip.ts` (modify) | Holds both children, applies a mode |
| `src/shell/sessionRow.ts` (modify) | Passes the mode in, exposes `setChipMode` |
| `src/shell/island.ts` (modify) | Owns the setting, watches it, pushes it into live rows |
| `test/shell/agentChip.test.ts` (modify) | Guards the chip, the row and the island wiring |
| `README.md` (modify) | Documents the setting |

---

### Task 1: The display decision, in core

**Files:**
- Create: `src/core/chipDisplay.ts`
- Test: `test/core/chipDisplay.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export type ChipDisplay = 'logo' | 'logo-name' | 'name'`, `export interface ChipParts { icon: boolean; label: boolean }`, and `export function chipParts(mode: string, hasIcon: boolean): ChipParts`. Task 3 imports `chipParts` from `../core/chipDisplay.js`.

Note the parameter is `mode: string`, not `mode: ChipDisplay`: the caller's value comes from `Gio.Settings.get_string`, which is typed `string`, and the whole point of the unrecognised-mode row is to accept one.

- [ ] **Step 1: Write the failing test**

Create `test/core/chipDisplay.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { chipParts } from '../../src/core/chipDisplay.js'

describe('chipParts', () => {
  it('shows the mark alone in logo mode', () => {
    expect(chipParts('logo', true)).toEqual({ icon: true, label: false })
  })

  it('falls back to the name when logo mode has no mark to draw', () => {
    // The same fail-open rule agentIcon.ts applies by returning null rather
    // than throwing: a missing decoration must not cost the user the ability
    // to tell one row from another.
    expect(chipParts('logo', false)).toEqual({ icon: false, label: true })
  })

  it('shows both in logo-name mode', () => {
    expect(chipParts('logo-name', true)).toEqual({ icon: true, label: true })
  })

  it('drops to the name alone when logo-name has no mark', () => {
    expect(chipParts('logo-name', false)).toEqual({ icon: false, label: true })
  })

  it('shows the name alone in name mode, mark or no mark', () => {
    expect(chipParts('name', true)).toEqual({ icon: false, label: true })
    expect(chipParts('name', false)).toEqual({ icon: false, label: true })
  })

  it('reads an unrecognised mode as logo-name', () => {
    // A newer release could add a fourth value to the schema; an older
    // installed copy reading it must not throw inside a row build, because an
    // exception there takes the whole popup rebuild with it.
    expect(chipParts('mark-and-sigil', true)).toEqual(chipParts('logo-name', true))
    expect(chipParts('', false)).toEqual(chipParts('logo-name', false))
  })

  it('never leaves the chip blank', () => {
    for (const mode of ['logo', 'logo-name', 'name', 'nonsense']) {
      for (const hasIcon of [true, false]) {
        const parts = chipParts(mode, hasIcon)
        expect(parts.icon || parts.label, `${mode}/${hasIcon}`).toBe(true)
      }
    }
  })

  it('never asks for an icon there is no file for', () => {
    for (const mode of ['logo', 'logo-name', 'name', 'nonsense']) {
      expect(chipParts(mode, false).icon, mode).toBe(false)
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/core/chipDisplay.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/chipDisplay.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/core/chipDisplay.ts`:

```ts
/**
 * What the agent chip on a session row shows, kept pure so it can be tested
 * without a Shell.
 *
 * The chip has exactly two children — the agent's mark and its short name —
 * and this module is the single place that decides which of them are visible.
 * Keeping the decision here rather than in the widget is what lets the
 * fallback rule below be asserted directly instead of inferred from St state.
 */

/** The values `agent-chip-display` is declared with in the gschema. */
export type ChipDisplay = 'logo' | 'logo-name' | 'name'

export interface ChipParts {
  /** Show the agent's mark. Never true when the caller has no mark to draw. */
  icon: boolean
  /** Show the agent's short name. */
  label: boolean
}

const MODES = new Set<string>(['logo', 'logo-name', 'name'])

/**
 * Which parts of the chip to show.
 *
 * `mode` is a `string` rather than a `ChipDisplay` because it arrives from
 * `Gio.Settings.get_string`, and an unrecognised value is read as `logo-name`
 * rather than thrown on. Today the key's `<choices>` make that unreachable,
 * but a value added by a newer release and read by an older installed copy
 * would otherwise raise inside a row build — and an exception there takes the
 * whole popup rebuild with it.
 *
 * `hasIcon` is a boolean rather than a `Gio.Icon | null` so that this module
 * stays free of `gi://` — see test/core/purity.
 *
 * Two properties hold for every input, junk included: the chip is never blank
 * (`icon || label`), and `icon` is never true when `hasIcon` is false. The
 * first is why `logo` degrades to the name when the mark is missing: a chip
 * that honoured the mode literally there would leave the row unable to say
 * which agent it belongs to, over a decoration that failed to ship.
 */
export function chipParts(mode: string, hasIcon: boolean): ChipParts {
  const m = MODES.has(mode) ? mode : 'logo-name'
  return {
    icon: hasIcon && m !== 'name',
    label: m !== 'logo' || !hasIcon,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/core/chipDisplay.test.ts test/core/purity.test.ts`
Expected: PASS — 8 tests in `chipDisplay`, 1 in `purity`.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/core/chipDisplay.ts test/core/chipDisplay.test.ts
git commit -m "feat(core): decide what the agent chip shows"
```

---

### Task 2: The setting and its combo row

**Files:**
- Modify: `schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml` (add a key before `</schema>`)
- Modify: `src/prefs.ts:28-60` (`_appearancePage`)
- Test: `test/shell/chipDisplayPrefs.test.ts` (create)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: the GSettings key `agent-chip-display` (string, default `'logo-name'`), which Task 3's `Island` reads. Also the prefs-local `const chipOrder = ['logo', 'logo-name', 'name']`, whose name the test in this task matches on.

- [ ] **Step 1: Write the failing test**

Create `test/shell/chipDisplayPrefs.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// A combo row maps an integer index to a string value by hand, in two places
// that have to agree: the Gtk.StringList of labels and the array of values
// beside it. That pair is exactly what drifts when a value is added, and the
// drift is silent — the user picks "Name only" and gets 'logo-name'.
describe('the agent-chip-display combo', () => {
  const schema = readFileSync(
    'schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml',
    'utf8'
  )
  const prefs = readFileSync('src/prefs.ts', 'utf8')

  const key = /<key name="agent-chip-display"[\s\S]*?<\/key>/.exec(schema)?.[0] ?? ''
  const choices = [...key.matchAll(/<choice value="([^"]+)"\s*\/>/g)].map((m) => m[1])
  const values = [
    ...(/const chipOrder = \[([^\]]*)\]/.exec(prefs)?.[1] ?? '').matchAll(/'([^']+)'/g),
  ].map((m) => m[1])
  const labels = [
    ...(
      /Gtk\.StringList\.new\(\[([^\]]*)\]\)[\s\S]{0,400}?const chipOrder/.exec(prefs)?.[1] ?? ''
    ).matchAll(/'([^']+)'/g),
  ].map((m) => m[1])

  it('declares its values in the schema', () => {
    expect(key, 'no agent-chip-display key in the gschema').not.toBe('')
    expect(choices).toEqual(['logo', 'logo-name', 'name'])
  })

  it('defaults to the appearance the chip has always had', () => {
    expect(key).toMatch(/<default>'logo-name'<\/default>/)
  })

  it('maps every schema choice to the same index in prefs', () => {
    expect(values).toEqual(choices)
  })

  it('offers exactly one label per value', () => {
    expect(labels.length, 'the StringList and chipOrder disagree').toBe(values.length)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/shell/chipDisplayPrefs.test.ts`
Expected: FAIL — first assertion, `no agent-chip-display key in the gschema`.

- [ ] **Step 3: Add the schema key**

In `schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml`, insert immediately after the `notification-sounds` key's `</key>` and before `</schema>`:

```xml
    <key name="agent-chip-display" type="s">
      <choices>
        <choice value="logo"/>
        <choice value="logo-name"/>
        <choice value="name"/>
      </choices>
      <default>'logo-name'</default>
      <summary>What the agent chip on a session row shows</summary>
      <description>The mark alone, the mark with a short name, or the name alone. A row whose mark is missing shows the name whatever this says.</description>
    </key>
```

An enum string with `<choices>`, following `panel-position`, rather than an int: `gsettings get` reads plainly and GSettings rejects an unlisted value at the source.

- [ ] **Step 4: Add the combo row**

In `src/prefs.ts`, inside `_appearancePage`, replace the tail of the method — the two lines

```ts
    page.add(group)
    return page
```

— with:

```ts
    page.add(group)

    // Its own group rather than an addition to "Panel": that group is entirely
    // about where the pill sits in the top bar, and the chip is inside the
    // popup. Filing it there would make the group's title a lie.
    const rows = new Adw.PreferencesGroup({ title: 'Session rows' })

    const chipDisplay = new Adw.ComboRow({
      title: 'Agent chip',
      subtitle: 'What the tag at the head of each row shows. A row whose mark is missing shows the name whatever this says.',
      model: Gtk.StringList.new(['Logo only', 'Logo and name', 'Name only']),
    })
    // Written out both ways rather than bound: settings.bind has no
    // string-to-index binding, so the mapping is code — the same shape
    // panel-position above already uses.
    const chipOrder = ['logo', 'logo-name', 'name']
    chipDisplay.selected = Math.max(0, chipOrder.indexOf(settings.get_string('agent-chip-display')))
    chipDisplay.connect('notify::selected', () => {
      settings.set_string('agent-chip-display', chipOrder[chipDisplay.selected] ?? 'logo-name')
    })
    rows.add(chipDisplay)

    page.add(rows)
    return page
```

No new imports: `Adw` and `Gtk` are already imported at the top of the file.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/shell/chipDisplayPrefs.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 6: Verify the schema still compiles**

Run: `npm run build && glib-compile-schemas --dry-run dist/schemas`
Expected: exit 0, no output from `glib-compile-schemas`. (`npm run build` copies `schemas/` into `dist/`; a malformed key fails here, not at install time.)

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck`
Expected: no output, exit 0.

```bash
git add schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml src/prefs.ts test/shell/chipDisplayPrefs.test.ts
git commit -m "feat(prefs): let the chip be a mark, a name, or both"
```

---

### Task 3: Apply the mode, live

**Files:**
- Modify: `src/shell/agentChip.ts` (whole file)
- Modify: `src/shell/sessionRow.ts:62` (constructor signature), `:160-162` (chip construction), plus a new field and method
- Modify: `src/shell/island.ts:66` (`_settingsChangedId`), `:112` (constructor), `:197-199` (settings connect), `:504-507` (release), `:633-639` (row construction)
- Test: `test/shell/agentChip.test.ts` (modify)

**Interfaces:**
- Consumes: `chipParts(mode: string, hasIcon: boolean): ChipParts` from Task 1; the `agent-chip-display` key from Task 2.
- Produces: `AgentChip`'s constructor becomes `(agent: AgentId, iconBase: string, mode: string)` and gains `setMode(mode: string): void`; `SessionRow`'s constructor becomes `(session: Session, cb: SessionRowCallbacks, now: number, iconBase: string, chipMode: string)` and gains `setChipMode(mode: string): void`.

All three files change together because the constructor arity changes: splitting them leaves the tree failing `npm run typecheck` between commits.

- [ ] **Step 1: Write the failing tests**

In `test/shell/agentChip.test.ts`, replace the test named `'has no update method, because a row never changes agent'` with the two tests below, and add the three that follow to the same `describe('AgentChip')` block:

```ts
  it('never re-agents itself: presentation changes, identity does not', () => {
    // sessionKey is `${agent}:${sessionId}` (core/types.ts), so a row's agent
    // is fixed for the row's whole life, and setMode is not a hole in that:
    // it changes what the chip shows, never which agent it names. No method
    // may take an AgentId or a Session — the constructor, which does take an
    // AgentId, has no return-type annotation and so does not match.
    expect(src).not.toMatch(/\b(update|setAgent)\s*\(/)
    expect(src).not.toMatch(/^\s*\w+\s*\([^)]*\b(AgentId|Session)\b[^)]*\)\s*:/m)
  })

  it('asks core which parts to show, rather than reading the mode itself', () => {
    // One decision site, testable under Node. A branch on the mode string
    // here would be a second one, untestable and free to disagree.
    expect(src).toContain('chipParts')
    expect(src).not.toMatch(/'logo'|'logo-name'|'name'/)
  })

  it('is handed its mode and never reaches for settings', () => {
    // Island owns settings in src/shell/; nothing below it reads them. A chip
    // that connected to Gio.Settings would also owe a disconnect per row.
    expect(src).not.toContain('get_string')
    expect(src).not.toContain('Gio.Settings')
  })

  it('keeps both children so a mode change is a visibility toggle', () => {
    expect(src).toMatch(/setMode\s*\(/)
    expect(src).toMatch(/\.visible\s*=\s*parts\.icon/)
    expect(src).toMatch(/\.visible\s*=\s*parts\.label/)
  })
```

Then, in the `describe('the chip on the row')` block, update the title-order regex — the chip moves onto a field — and add two wiring guards:

```ts
  it('leads the title line: arrow, then chip, then project name', () => {
    // Order is the design decision, not an accident — the row is meant to read
    // as one phrase ("Claude, on dasbo-island"), which is also why the project
    // names no longer align down the popup's left edge.
    const order = /titleRow\.add_child\(this\._expander\)\s*\n\s*titleRow\.add_child\(this\._chip\)\s*\n\s*titleRow\.add_child\(this\._project\)/
    expect(row).toMatch(order)
  })

  it('takes a new display mode straight to the live rows', () => {
    expect(row).toMatch(/setChipMode\s*\(/)
    expect(island).toMatch(/changed::agent-chip-display/)
    expect(island).toMatch(/row\.setChipMode\(/)
  })

  it('does not rebuild the rows to change the chip', () => {
    // Rows are reused across rebuilds so that permission controls, question
    // panels and task lists survive a refresh. Tearing one down mid-decision
    // would destroy the PermissionControls whose closures are the only path to
    // resolving a pending request.
    const handler = /connect\('changed::agent-chip-display'[\s\S]*?\}\)/.exec(island)?.[0] ?? ''
    expect(handler, 'no changed::agent-chip-display handler in island.ts').not.toBe('')
    expect(handler).not.toContain('_rebuildRows')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/shell/agentChip.test.ts`
Expected: FAIL — `chipParts` missing, `setMode` missing, `this._chip` not in the title order, no `changed::agent-chip-display` handler.

- [ ] **Step 3: Rewrite the chip**

Replace `src/shell/agentChip.ts` in full:

```ts
import St from 'gi://St'
import Clutter from 'gi://Clutter'
import GObject from 'gi://GObject'
import { adapters } from '../core/adapters/index.js'
import { chipParts } from '../core/chipDisplay.js'
import { agentGicon } from './agentIcon.js'
import type { AgentId } from '../core/types.js'

/**
 * The agent's mark and short name, as one tag at the head of a session row.
 *
 * Which of the two it shows is the user's choice (`agent-chip-display`), and
 * can change while the chip is on screen — so both children are built once and
 * `setMode` toggles their visibility. What cannot change is *which* agent the
 * chip names: `sessionKey` is `${agent}:${sessionId}` (see core/types.ts), so a
 * row's agent is fixed for the row's entire life, and this class deliberately
 * offers no way to re-point it at another. Presentation is mutable here;
 * identity is not.
 *
 * The mode arrives as an argument rather than being read from Gio.Settings:
 * Island owns settings in src/shell/, and a chip that connected to them itself
 * would owe a disconnect for every row that ever existed.
 */
export const AgentChip = GObject.registerClass(
  class AgentChip extends St.BoxLayout {
    private _icon: St.Icon | null = null
    private _label!: St.Label
    private _hasIcon = false

    constructor(agent: AgentId, iconBase: string, mode: string) {
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
        this._icon = new St.Icon({
          gicon,
          // All three marks are 1.5-1.6-unit strokes in a 16-unit viewBox, so
          // at 14px they render at roughly 1.3 unhinted device pixels — just
          // above the 0.85em label's cap height, without making the chip the
          // tallest thing on the title line. If the marks ever read as
          // smudges rather than marks, try 16 (or heavier strokes) first.
          icon_size: 14,
          y_align: Clutter.ActorAlign.CENTER,
        })
        // Pinned defensively, not because anything currently dims this icon:
        // St's CSS engine does not reliably honour `opacity`, so it is never
        // expressed in the stylesheet, only ever set here. Genuine precedents
        // for this pattern — sessionRow.ts's _shellTotal, taskList.ts — pin a
        // value other than 255 because they need a dimming CSS won't deliver.
        // This icon needs no such thing: it's a Gio.FileIcon over a
        // non-symbolic file with baked-in stroke colours, so StTextureCache
        // loads it full-colour and never tints it — `color`, which is what
        // the row's `:insensitive` state actually changes, cannot touch it
        // either way. 255 is simply the correct full-opacity value, held here
        // in case anything ever does need to dim it.
        this._icon.opacity = 255
        this._hasIcon = true
        this.add_child(this._icon)
      }

      // Added whether or not the icon was: a chip whose mark failed to ship
      // still has to say which agent the row belongs to. chipParts is what
      // makes that true even in logo-only mode.
      this._label = new St.Label({
        text: adapters[agent].shortName,
        style_class: 'dasbo-agent-chip-label',
        y_align: Clutter.ActorAlign.CENTER,
      })
      this.add_child(this._label)

      // Applied here rather than left to the caller, so the chip's first paint
      // is already the right shape instead of flashing the default.
      this.setMode(mode)
    }

    setMode(mode: string): void {
      const parts = chipParts(mode, this._hasIcon)
      if (this._icon) this._icon.visible = parts.icon
      this._label.visible = parts.label
    }
  }
)
```

- [ ] **Step 4: Thread the mode through the row**

In `src/shell/sessionRow.ts`, add a field beside the other widget fields (after `private _expander!: St.Button`):

```ts
    private _chip!: InstanceType<typeof AgentChip>
```

Change the constructor signature at line 62:

```ts
    constructor(session: Session, cb: SessionRowCallbacks, now: number, iconBase: string, chipMode: string) {
```

Replace the chip construction and its comment (currently lines 156-162):

```ts
      // Held on a field, unlike the row's other one-shot children: the display
      // mode is a setting, and Island pushes a change into every live row
      // rather than rebuilding them. The chip's *agent* still cannot change —
      // sessionKey is `${agent}:${sessionId}` — so there is still no update().
      this._chip = new AgentChip(session.agent, iconBase, chipMode)
      titleRow.add_child(this._expander)
      titleRow.add_child(this._chip)
      titleRow.add_child(this._project)
```

Add the delegating method next to the row's other public setters (any position inside the class body is fine; put it after the constructor):

```ts
    setChipMode(mode: string): void {
      this._chip.setMode(mode)
    }
```

- [ ] **Step 5: Own and watch the setting in the island**

In `src/shell/island.ts`, replace the field at line 66:

```ts
    private _settingsChangedIds: number[] = []
```

Add a field beside it:

```ts
    /** Last read of `agent-chip-display`, handed to every row that is built. */
    private _chipMode = 'logo-name'
```

In the constructor, immediately after `this._settings = settings` (line 112), add:

```ts
      this._chipMode = settings.get_string('agent-chip-display')
```

Replace the connect block at lines 197-199:

```ts
      this._settingsChangedIds.push(
        this._settings.connect('changed::always-show', () => this.refresh())
      )

      // Pushed into the live rows rather than rebuilt into new ones. Rows are
      // reused across rebuilds precisely so that permission controls, question
      // panels and task lists survive a refresh; tearing one down here would
      // destroy the PermissionControls whose closures are the only path to
      // resolving a request the user is in the middle of. Toggling `visible`
      // relayouts on its own, and the popup's width is fixed, so nothing but
      // the project label's share of the title row moves.
      this._settingsChangedIds.push(
        this._settings.connect('changed::agent-chip-display', () => {
          this._chipMode = this._settings.get_string('agent-chip-display')
          for (const row of this._rows.values()) row.setChipMode(this._chipMode)
        })
      )
```

Replace the disconnect in `_releaseExternalRefs` (lines 504-507):

```ts
      for (const id of this._settingsChangedIds) this._settings.disconnect(id)
      this._settingsChangedIds = []
```

And pass the mode when a row is built (line 633-639):

```ts
          const row = new SessionRow(s, {
            onJump: (sess) => this._onJump(sess),
            onToggleExpanded: (expanded) => {
              this._questions.get(s.key)?.panel.setExpanded(expanded)
              this._taskLists.get(s.key)?.list.setExpanded(expanded)
            },
          }, now, this._iconBase, this._chipMode)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/shell/agentChip.test.ts`
Expected: PASS — 7 tests in `AgentChip`, 5 in `the chip on the row`.

- [ ] **Step 7: Typecheck and run the whole suite**

Run: `npm run typecheck && npm test`
Expected: exit 0; every test file passes. A failure in `test/shell/popupWidth.test.ts` or `test/shell/iconAssets.test.ts` here means an unintended edit — neither file's subject changed in this task.

- [ ] **Step 8: Commit**

```bash
git add src/shell/agentChip.ts src/shell/sessionRow.ts src/shell/island.ts test/shell/agentChip.test.ts
git commit -m "feat(shell): apply the chip display mode to live rows"
```

---

### Task 4: Document it, and verify it in the shell

**Files:**
- Modify: `README.md:37-41`

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces: nothing code depends on.

- [ ] **Step 1: Update the README paragraph**

Replace lines 37-41 of `README.md`:

```markdown
Each session row is led by a chip naming the agent doing the work — its mark
and a short name — so a popup holding a Claude Code session beside a Codex one
says which is which at a glance. The marks are drawn for this extension rather
than taken from each vendor, and they do not recolour with a light or dark
theme.
```

with:

```markdown
Each session row is led by a chip naming the agent doing the work, so a popup
holding a Claude Code session beside a Codex one says which is which at a
glance. **Agent chip** in the preferences chooses what it shows: the mark
alone, the mark and a short name, or the name alone. A row whose mark is
missing shows the name whatever that says. The marks are drawn for this
extension rather than taken from each vendor, and they do not recolour with a
light or dark theme.
```

- [ ] **Step 2: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: exit 0, all tests pass.

- [ ] **Step 3: Build and install**

Run: `make install`
Expected: ends with `Installed. Log out and back in (X11), then: gnome-extensions enable dasbo-island@ayubaswad.gmail.com`.

- [ ] **Step 4: Reload the shell and confirm the key is live**

On X11: `Alt+F2`, `r`, Enter. On Wayland: log out and back in.

Run: `gsettings --schemadir ~/.local/share/gnome-shell/extensions/dasbo-island@ayubaswad.gmail.com/schemas get org.gnome.shell.extensions.dasbo-island agent-chip-display`
Expected: `'logo-name'`.

- [ ] **Step 5: Verify the live change by hand**

This is the one thing the test suite cannot assert — vitest cannot instantiate a St widget, so every shell guard above is source text, not behaviour.

1. Start an agent session so the pill appears, and open the popup.
2. Open preferences (click the pill, then the gear) and go to **Appearance → Session rows**.
3. With the popup still open, switch **Agent chip** through all three values.

Expected: the chip changes on every visible row immediately — mark only, mark and name, name only — the popup does not close or resize, and the project name reflows into the width the chip gives up. If a permission request is pending on a row, its Allow/Deny buttons stay put and still work.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: say the chip can be a mark, a name, or both"
```
