# Preferences Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the panel position preferences apply live, and make the Agents page reflect whether each agent's hooks are actually installed.

**Architecture:** A new pure `installState()` in `src/core/install/plan.ts` reports `absent | installed | stale | unreadable` per agent, keyed off the existing uninstall planners so it can never disagree with them. A new `src/shell/panelPlacement.ts` reparents the already-registered panel button between the top bar's boxes, driven by two new `changed::` handlers in `extension.ts`. `src/prefs.ts` consumes both: the Appearance page loses its "restart required" copy, and each agent row derives its subtitle and button sensitivity from `installState()`.

**Tech Stack:** TypeScript, GJS / GNOME Shell 46, libadwaita 1.5 (`Adw.PreferencesWindow`), Gtk 4, vitest, esbuild.

## Global Constraints

- Target is GNOME Shell 46 (`@girs/gnome-shell` 46.0.2). X11 and Wayland.
- `src/core/**` must never import `gi://` or `resource://` — enforced by `test/core/purity.test.ts`. `installState` therefore stays pure and takes `InstallEnv`.
- Never reach for `any` to work around missing GJS types. Widen with a local intersection type, as `src/shell/island.ts` does for `MenuWithOpenSignal`.
- Extension UUID is `dasbo-island@ayubaswad.gmail.com`.
- Test runner: `npm test` (vitest, run mode). Type check: `npm run typecheck` (checks both `tsconfig.json` and `tsconfig.test.json`).
- Commit style is conventional commits scoped by area: `fix(core):`, `fix(prefs):`, `feat(shell):`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/core/install/plan.ts` (modify) | Adds `configPath()` and `installState()` beside the existing planners. Stays pure. |
| `test/core/install/plan.test.ts` (modify) | Adds `installState` coverage for all three agents. |
| `src/shell/panelPlacement.ts` (create) | Single job: move a panel button's container between the top bar's left/center/right boxes. |
| `src/extension.ts` (modify) | Connects `changed::panel-position` and `changed::panel-index` to the placement helper; tracks all settings handler ids in one array. |
| `src/prefs.ts` (modify) | Appearance page copy/labels; agent rows driven by `installState()`. |

---

### Task 1: Install-state detection in the pure core

**Files:**
- Modify: `src/core/install/plan.ts`
- Test: `test/core/install/plan.test.ts`

**Interfaces:**
- Consumes: existing `InstallEnv`, `planInstall`, `planUninstall` from the same file.
- Produces:
  - `export type InstallState = 'absent' | 'installed' | 'stale' | 'unreadable'`
  - `export function configPath(agent: AgentId, env: InstallEnv): string`
  - `export function installState(agent: AgentId, env: InstallEnv): InstallState`

- [ ] **Step 1: Write the failing tests**

Append to `test/core/install/plan.test.ts`. Note the existing `env()` helper at the top of that file already supplies `home` and `hookPath` — reuse it, and pass a second hook path only where a stale install is being simulated.

```ts
describe('configPath', () => {
  it('names the config file each agent stores hooks in', () => {
    expect(configPath('claude', env())).toBe('/home/me/.claude/settings.json')
    expect(configPath('codex', env())).toBe('/home/me/.codex/hooks.json')
    expect(configPath('antigravity', env())).toBe('/home/me/.gemini/config/hooks.json')
  })
})

describe('installState', () => {
  const agents = ['claude', 'codex', 'antigravity'] as const

  function installed(agent: (typeof agents)[number], e = env()): Record<string, string> {
    const edit = planInstall(agent, e)[0]!
    return { [edit.path]: edit.content }
  }

  function movedEnv(files: Record<string, string> = {}): InstallEnv {
    return {
      home: '/home/me',
      hookPath: '/home/me/.local/share/gnome-shell/extensions/moved/hooks/dasbo-hook',
      existing: (p) => files[p] ?? null,
    }
  }

  for (const agent of agents) {
    it(`reports absent for ${agent} when the config file does not exist`, () => {
      expect(installState(agent, env())).toBe('absent')
    })

    it(`reports installed for ${agent} when fed back what planInstall writes`, () => {
      expect(installState(agent, env(installed(agent)))).toBe('installed')
    })

    it(`reports stale for ${agent} when the installed hook path is out of date`, () => {
      // Written by an extension directory that has since moved: every command
      // embeds the absolute hook path, so all of them are now wrong.
      expect(installState(agent, movedEnv(installed(agent)))).toBe('stale')
    })

    it(`reports unreadable for ${agent} when the config file is malformed`, () => {
      const files = { [configPath(agent, env())]: '{not json' }
      expect(installState(agent, env(files))).toBe('unreadable')
    })

    it(`never reports absent for ${agent} when planUninstall has work to do`, () => {
      const e = env(installed(agent))
      expect(planUninstall(agent, e).length).toBeGreaterThan(0)
      expect(installState(agent, e)).not.toBe('absent')
    })
  }

  it('reports absent for claude when only foreign hooks are present', () => {
    const before = JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: '/other/tool' }] }] },
    })
    expect(installState('claude', env({ '/home/me/.claude/settings.json': before }))).toBe('absent')
  })

  it('reports absent for codex when only a foreign entry is present', () => {
    const before = JSON.stringify({
      hooks: { 'vibe-island': { command: 'python3 /x/y.py', events: ['session.start'] } },
    })
    expect(installState('codex', env({ '/home/me/.codex/hooks.json': before }))).toBe('absent')
  })

  it('stays installed for claude when a foreign hook is appended after ours', () => {
    // planInstall would reorder ours to the end, so a text comparison would
    // call this stale. The command set is unchanged, so it is not.
    const doc = JSON.parse(planInstall('claude', env())[0]!.content)
    doc.hooks.Stop.push({ hooks: [{ type: 'command', command: '/other/tool' }] })
    const files = { '/home/me/.claude/settings.json': JSON.stringify(doc) }
    expect(installState('claude', env(files))).toBe('installed')
  })

  it('stays installed for claude across reformatting and key reordering', () => {
    const doc = JSON.parse(planInstall('claude', env())[0]!.content)
    const files = { '/home/me/.claude/settings.json': JSON.stringify({ model: 'opus', ...doc }, null, 4) }
    expect(installState('claude', env(files))).toBe('installed')
  })

  it('reports stale for claude when one of the five events lost its hook', () => {
    const doc = JSON.parse(planInstall('claude', env())[0]!.content)
    delete doc.hooks.Stop
    const files = { '/home/me/.claude/settings.json': JSON.stringify(doc) }
    expect(installState('claude', env(files))).toBe('stale')
  })

  it('reports stale for claude when our hook is duplicated by a hand edit', () => {
    const doc = JSON.parse(planInstall('claude', env())[0]!.content)
    doc.hooks.Stop.push(doc.hooks.Stop[0])
    const files = { '/home/me/.claude/settings.json': JSON.stringify(doc) }
    expect(installState('claude', env(files))).toBe('stale')
  })

  it('reports stale for codex when the events list no longer matches', () => {
    const doc = JSON.parse(planInstall('codex', env())[0]!.content)
    doc.hooks['dasbo-island'].events = ['session.start']
    const files = { '/home/me/.codex/hooks.json': JSON.stringify(doc) }
    expect(installState('codex', env(files))).toBe('stale')
  })

  it('reports installed for codex regardless of the order of the events list', () => {
    const doc = JSON.parse(planInstall('codex', env())[0]!.content)
    doc.hooks['dasbo-island'].events = [...doc.hooks['dasbo-island'].events].reverse()
    const files = { '/home/me/.codex/hooks.json': JSON.stringify(doc) }
    expect(installState('codex', env(files))).toBe('installed')
  })

  it('reports stale for antigravity when our key is present but empty', () => {
    const files = { '/home/me/.gemini/config/hooks.json': JSON.stringify({ 'dasbo-island': {} }) }
    expect(installState('antigravity', env(files))).toBe('stale')
  })
})
```

Update the import at the top of the test file:

```ts
import {
  planInstall,
  planUninstall,
  isLegacyCodexHooks,
  configPath,
  installState,
  type InstallEnv,
} from '../../../src/core/install/plan.js'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/core/install/plan.test.ts`
Expected: FAIL — vitest reports `configPath is not a function` / `installState is not a function` (esbuild-transformed imports resolve to `undefined`, so the first call throws).

- [ ] **Step 3: Add `configPath` and route the existing planners through it**

In `src/core/install/plan.ts`, add after the `InstallEnv` interface:

```ts
/** Config file each agent keeps its hook entries in. */
export function configPath(agent: AgentId, env: InstallEnv): string {
  if (agent === 'claude') return `${env.home}/.claude/settings.json`
  if (agent === 'codex') return `${env.home}/.codex/hooks.json`
  return `${env.home}/.gemini/config/hooks.json`
}
```

Then replace the hard-coded path line at the top of each planner so there is exactly one definition of each path:

- in `claudeEdits`: `const path = configPath('claude', env)`
- in `codexEdits`: `const path = configPath('codex', env)`
- in `antigravityEdits`: `const path = configPath('antigravity', env)`

- [ ] **Step 4: Add the state detector**

Append to `src/core/install/plan.ts`:

```ts
export type InstallState = 'absent' | 'installed' | 'stale' | 'unreadable'

/**
 * Order-insensitive but duplicate-sensitive comparison. Order must not matter
 * because a hand edit or a foreign tool can reorder entries without changing
 * behaviour; duplicates must matter because a duplicated entry fires our hook
 * twice, and rewriting via planInstall is the repair.
 */
function sameStrings(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const x = [...a].sort()
  const y = [...b].sort()
  return x.every((v, i) => v === y[i])
}

function expectedClaudeCommands(env: InstallEnv): string[] {
  return CLAUDE_EVENTS.map((event) =>
    cmd(env, 'claude', event === 'PreToolUse' ? 'permission' : 'notify', event)
  )
}

function expectedAntigravityCommands(env: InstallEnv): string[] {
  return [
    ...ANTIGRAVITY_GROUPED.map((event) =>
      cmd(env, 'antigravity', event === 'PreToolUse' ? 'permission' : 'notify', event)
    ),
    ...ANTIGRAVITY_FLAT.map((event) => cmd(env, 'antigravity', 'notify', event)),
  ]
}

/** Commands the file currently attributes to us, across the events we own. */
function presentClaudeCommands(root: Record<string, any>): string[] {
  const hooks = isRecord(root['hooks']) ? root['hooks'] : {}
  const out: string[] = []
  for (const event of CLAUDE_EVENTS) {
    const groups = Array.isArray(hooks[event]) ? hooks[event] : []
    for (const group of groups) {
      if (!isRecord(group) || !Array.isArray(group['hooks'])) continue
      for (const h of group['hooks']) {
        if (isRecord(h) && isOurs(h['command'])) out.push(h['command'])
      }
    }
  }
  return out
}

function presentAntigravityCommands(root: Record<string, any>): string[] {
  const set = isRecord(root[ANTIGRAVITY_KEY]) ? root[ANTIGRAVITY_KEY] : {}
  const out: string[] = []
  for (const event of ANTIGRAVITY_GROUPED) {
    const groups = Array.isArray(set[event]) ? set[event] : []
    for (const group of groups) {
      if (!isRecord(group) || !Array.isArray(group['hooks'])) continue
      for (const h of group['hooks']) {
        if (isRecord(h) && typeof h['command'] === 'string') out.push(h['command'])
      }
    }
  }
  for (const event of ANTIGRAVITY_FLAT) {
    const entries = Array.isArray(set[event]) ? set[event] : []
    for (const h of entries) {
      if (isRecord(h) && typeof h['command'] === 'string') out.push(h['command'])
    }
  }
  return out
}

/** Our codex entry, wherever the file's shape puts it. */
function codexMatches(env: InstallEnv, root: Record<string, any>): boolean {
  const hooks = isRecord(root['hooks']) ? root['hooks'] : root
  const entry = hooks[CODEX_KEY]
  if (!isRecord(entry)) return false
  if (entry['command'] !== `${env.hookPath} codex notify`) return false
  const events = Array.isArray(entry['events'])
    ? entry['events'].filter((e: unknown): e is string => typeof e === 'string')
    : []
  return sameStrings(events, [...CODEX_EVENTS])
}

/**
 * Whether an agent's hooks are installed, and whether they still point at the
 * current hook path.
 *
 * Presence is delegated to planUninstall rather than re-derived, so
 * `installState() !== 'absent'` and "Remove has work to do" can never
 * disagree — the Remove button is never offered for a no-op.
 *
 * Freshness compares the command strings the file attributes to us against the
 * ones planInstall would write, as sorted lists. Comparing serialized text
 * instead would report a false `stale` for indentation, key order, or a
 * foreign hook appended after ours.
 */
export function installState(agent: AgentId, env: InstallEnv): InstallState {
  const doc = parseOrNull(env.existing(configPath(agent, env)))
  if (doc === undefined) return 'unreadable'
  if (planUninstall(agent, env).length === 0) return 'absent'
  const root = doc ?? {}
  const fresh =
    agent === 'claude'
      ? sameStrings(presentClaudeCommands(root), expectedClaudeCommands(env))
      : agent === 'codex'
        ? codexMatches(env, root)
        : sameStrings(presentAntigravityCommands(root), expectedAntigravityCommands(env))
  return fresh ? 'installed' : 'stale'
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- test/core/install/plan.test.ts`
Expected: PASS, all existing tests plus the new `configPath` and `installState` describes.

- [ ] **Step 6: Run the whole suite and the type check**

Run: `npm test && npm run typecheck`
Expected: PASS, including `src/core purity` (the new code adds no imports at all, so purity holds).

- [ ] **Step 7: Commit**

```bash
git add src/core/install/plan.ts test/core/install/plan.test.ts
git commit -m "feat(core): report per-agent hook install state

Presence delegates to planUninstall so the detector and the Remove
button can never disagree; freshness compares command sets, so
reformatting or a foreign hook appended after ours is not stale."
```

---

### Task 2: Live panel placement

**Files:**
- Create: `src/shell/panelPlacement.ts`
- Modify: `src/extension.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `export function placeInPanelBox(container: Clutter.Actor, box: string, index: number): void`

This task has no unit test — the helper touches Clutter actors on a live shell, and `src/shell` is not covered by vitest. It ends with a scripted manual verification instead.

- [ ] **Step 1: Create the placement helper**

Create `src/shell/panelPlacement.ts`:

```ts
import type Clutter from 'gi://Clutter'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'

/**
 * The panel exposes its three boxes only as private fields. Widen locally
 * rather than reaching for `any`, the same way island.ts widens the menu's
 * signal map.
 */
type PanelWithBoxes = typeof Main.panel & {
  _leftBox: Clutter.Actor
  _centerBox: Clutter.Actor
  _rightBox: Clutter.Actor
}

/**
 * Move an already-registered panel button between the top bar's boxes.
 *
 * `addToStatusArea` is deliberately not reused: besides reparenting, it
 * registers the role in `Main.panel.statusArea` and hands the button's menu to
 * the panel's menuManager. Calling it again on every settings change would
 * register the same menu repeatedly. Reparenting the container alone leaves
 * both registrations intact.
 *
 * An unknown box name falls back to the right box, matching what
 * `addToStatusArea` does with one.
 */
export function placeInPanelBox(container: Clutter.Actor, box: string, index: number): void {
  const panel = Main.panel as PanelWithBoxes
  const target =
    box === 'left' ? panel._leftBox : box === 'center' ? panel._centerBox : panel._rightBox
  const parent = container.get_parent()
  if (parent) parent.remove_child(container)
  target.insert_child_at_index(container, index)
}
```

- [ ] **Step 2: Track every settings handler in one array**

In `src/extension.ts`, replace the field

```ts
  private _settingsChangedId = 0
```

with

```ts
  private _settingsIds: number[] = []
```

and in `enable()` replace

```ts
    this._settingsChangedId = settings.connect('changed::done-linger', () => {
      if (this._store) this._store.doneLingerSeconds = settings.get_int('done-linger')
    })
```

with

```ts
    this._settingsIds.push(
      settings.connect('changed::done-linger', () => {
        if (this._store) this._store.doneLingerSeconds = settings.get_int('done-linger')
      })
    )
```

Then in `disable()` replace the final teardown step

```ts
    safely('settings handler', () => {
      if (this._settingsChangedId && this._settings) {
        this._settings.disconnect(this._settingsChangedId)
        this._settingsChangedId = 0
      }
    })
```

with

```ts
    safely('settings handlers', () => {
      const settings = this._settings
      if (settings) for (const id of this._settingsIds) settings.disconnect(id)
      this._settingsIds = []
    })
```

- [ ] **Step 3: Reposition on every panel setting change**

In `src/extension.ts`, add the import beside the other shell imports:

```ts
import { placeInPanelBox } from './shell/panelPlacement.js'
```

and immediately after the existing `Main.panel.addToStatusArea(...)` call, add:

```ts
    // addToStatusArea above runs once, because it also registers the role and
    // the menu. Later changes only reparent the container.
    const reposition = () => {
      if (!this._island) return
      placeInPanelBox(
        this._island.container,
        settings.get_string('panel-position'),
        settings.get_int('panel-index')
      )
    }
    this._settingsIds.push(settings.connect('changed::panel-position', reposition))
    this._settingsIds.push(settings.connect('changed::panel-index', reposition))
```

- [ ] **Step 4: Type check and build**

Run: `npm run typecheck && npm run build`
Expected: no output from `tsc` (both projects clean), then esbuild writes `dist/`.

- [ ] **Step 5: Verify live on the running shell**

```bash
make install
gnome-extensions disable dasbo-island@ayubaswad.gmail.com
gnome-extensions enable dasbo-island@ayubaswad.gmail.com
SD=~/.local/share/gnome-shell/extensions/dasbo-island@ayubaswad.gmail.com/schemas
for p in left center right center; do
  gsettings --schemadir "$SD" set org.gnome.shell.extensions.dasbo-island panel-position "$p"
  echo "now: $p"; sleep 2
done
```

Expected: the pill moves on each `gsettings set`, with no disable/enable in between. On a system running dash-to-panel the three destinations are wherever that extension's `panel-element-positions` puts `leftBox` / `centerBox` / `rightBox`, which is not necessarily the screen's left, center and right.

Then check the index applies live too:

```bash
gsettings --schemadir "$SD" set org.gnome.shell.extensions.dasbo-island panel-index 1
gsettings --schemadir "$SD" set org.gnome.shell.extensions.dasbo-island panel-index 0
```

Expected: the pill's position among its box's siblings changes and comes back, again with no reload. If the chosen box holds only the pill, both values look identical — that is correct, not a failure; re-run with `panel-position` set to a populated box (`right`) to see it move.

Finally confirm teardown is still clean:

```bash
gnome-extensions disable dasbo-island@ayubaswad.gmail.com
journalctl --user -b -n 40 --no-pager | grep -i dasbo
```

Expected: no `teardown step ... failed` warnings, and no duplicate pill after re-enabling.

- [ ] **Step 6: Commit**

```bash
git add src/shell/panelPlacement.ts src/extension.ts
git commit -m "feat(shell): apply panel box and index changes live

Both keys were read once in enable(), so the preference looked inert
until the extension was re-enabled. Reparent the container on change
rather than re-calling addToStatusArea, which would re-register the
menu each time."
```

---

### Task 3: Appearance page copy and labels

**Files:**
- Modify: `src/prefs.ts:20-54` (`_appearancePage`)

**Interfaces:**
- Consumes: the live placement from Task 2 — this task's copy is only true once Task 2 has landed.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Replace `_appearancePage`**

In `src/prefs.ts`, replace the whole `_appearancePage` method with:

```ts
  private _appearancePage(settings: Gio.Settings): Adw.PreferencesPage {
    const page = new Adw.PreferencesPage({ title: 'Appearance', icon_name: 'preferences-desktop-display-symbolic' })
    const group = new Adw.PreferencesGroup({ title: 'Panel' })

    const position = new Adw.ComboRow({
      title: 'Panel box',
      subtitle: 'Extensions that replace the top bar, such as Dash to Panel, decide where each box lands on screen',
      model: Gtk.StringList.new(['Left', 'Center', 'Right']),
    })
    const order = ['left', 'center', 'right']
    position.selected = Math.max(0, order.indexOf(settings.get_string('panel-position')))
    position.connect('notify::selected', () => {
      settings.set_string('panel-position', order[position.selected] ?? 'center')
    })
    group.add(position)

    const index = new Adw.SpinRow({
      title: 'Position within the box',
      adjustment: new Gtk.Adjustment({ lower: 0, upper: 20, step_increment: 1 }),
    })
    settings.bind('panel-index', index, 'value', 0)
    group.add(index)

    const alwaysShow = new Adw.SwitchRow({
      title: 'Always show the pill',
      subtitle: 'Keep it visible even when no agent session is active',
    })
    settings.bind('always-show', alwaysShow, 'active', 0)
    group.add(alwaysShow)

    page.add(group)
    return page
  }
```

The group's `description` is gone — it promised that changes need a disable and re-enable, which Task 2 made false. The displayed strings are now capitalised while `order` still carries the schema's lowercase values, so the stored setting is unchanged.

- [ ] **Step 2: Type check and build**

Run: `npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 3: Verify in the preferences window**

```bash
make install
gnome-extensions prefs dasbo-island@ayubaswad.gmail.com
```

Expected: Appearance shows `Left` / `Center` / `Right`, no "takes effect after disabling and re-enabling" text, and changing the combo moves the pill immediately while the window stays open.

- [ ] **Step 4: Commit**

```bash
git add src/prefs.ts
git commit -m "fix(prefs): drop the stale restart notice and label the boxes

Position now applies live, so the restart caveat is wrong. Name the
choices Left/Center/Right and say plainly that a panel-replacing
extension decides where each box actually lands."
```

---

### Task 4: Agent rows driven by install state

**Files:**
- Modify: `src/prefs.ts:87-149` (`_agentsPage`, plus a new `_agentRow` method)

**Interfaces:**
- Consumes: `installState`, `configPath`, `type InstallState` from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Extend the prefs imports**

In `src/prefs.ts`, replace the plan import line with:

```ts
import {
  planInstall,
  planUninstall,
  isLegacyCodexHooks,
  installState,
  configPath,
  type InstallEnv,
  type InstallState,
} from './core/install/plan.js'
```

- [ ] **Step 2: Replace `_agentsPage` and add `_agentRow`**

Replace the whole `_agentsPage` method in `src/prefs.ts` with the two methods below.

```ts
  private _agentsPage(settings: Gio.Settings, window: Adw.PreferencesWindow): Adw.PreferencesPage {
    const page = new Adw.PreferencesPage({ title: 'Agents', icon_name: 'utilities-terminal-symbolic' })
    const group = new Adw.PreferencesGroup({
      title: 'Hook installation',
      description: 'Existing entries from other tools are preserved. A .dasbo.bak backup is written before the first change.',
    })

    const env: InstallEnv = {
      home: GLib.get_home_dir(),
      hookPath: `${this.path}/hooks/dasbo-hook`,
      existing: readFileOrNull,
    }

    const refreshers: (() => void)[] = []
    const refreshAll = () => {
      for (const refresh of refreshers) refresh()
    }

    for (const id of ['claude', 'codex', 'antigravity'] as AgentId[]) {
      const { row, refresh } = this._agentRow(id, env, settings, window, refreshAll)
      refreshers.push(refresh)
      group.add(row)
    }

    // The config files can change outside this window — another install, a
    // hand edit, a moved extension directory. Re-read whenever the user
    // arrives on this page rather than trusting what was true at build time.
    window.connect('notify::visible-page', refreshAll)
    refreshAll()

    page.add(group)
    return page
  }

  private _agentRow(
    id: AgentId,
    env: InstallEnv,
    settings: Gio.Settings,
    window: Adw.PreferencesWindow,
    refreshAll: () => void
  ): { row: Adw.ActionRow; refresh: () => void } {
    const row = new Adw.ActionRow({ title: adapters[id].displayName })

    const enabled = new Gtk.Switch({ valign: Gtk.Align.CENTER, tooltip_text: 'Accept events from this agent' })
    enabled.active = settings.get_strv('enabled-agents').includes(id)
    enabled.connect('notify::active', () => {
      const current = settings.get_strv('enabled-agents')
      const has = current.includes(id)
      if (enabled.active && !has) {
        settings.set_strv('enabled-agents', [...current, id])
      } else if (!enabled.active && has) {
        settings.set_strv('enabled-agents', current.filter((a) => a !== id))
      }
    })

    const install = new Gtk.Button({ label: 'Install', valign: Gtk.Align.CENTER })
    const uninstall = new Gtk.Button({ label: 'Remove', valign: Gtk.Align.CENTER })

    const describe = (state: InstallState): string => {
      if (state === 'installed') return 'Hooks installed'
      if (state === 'stale') return 'Needs update — the installed hook path is out of date'
      if (state === 'unreadable') return `${configPath(id, env)} is not valid JSON`
      return 'Not installed'
    }

    const refresh = () => {
      const state = installState(id, env)
      row.subtitle = describe(state)
      install.label = state === 'stale' ? 'Update' : 'Install'
      install.sensitive = state === 'absent' || state === 'stale'
      uninstall.sensitive = state === 'installed' || state === 'stale'
    }

    const run = (edits: ReturnType<typeof planInstall>, verb: string) => {
      if (edits.length === 0) {
        this._toast(window, `${adapters[id].displayName}: nothing to ${verb}`)
        return
      }
      // Must be read before applyEdits rewrites the file — afterwards it's
      // already wrapped and this would always report false.
      const migrating =
        id === 'codex' && verb === 'install' && isLegacyCodexHooks(env.existing(`${env.home}/.codex/hooks.json`))
      try {
        applyEdits(edits)
        const migrationNote = migrating
          ? ' — existing entries in hooks.json were previously inert (Codex rejects the unwrapped format) and are now re-activated'
          : ''
        this._toast(window, `${adapters[id].displayName}: ${verb} complete${migrationNote}`)
      } catch (e) {
        this._toast(window, `${adapters[id].displayName}: ${verb} failed — ${e}`)
      }
      // Refresh every row, not just this one: all three read from disk and a
      // failed write must be reflected as accurately as a successful one.
      refreshAll()
    }

    install.connect('clicked', () => run(planInstall(id, env), 'install'))
    uninstall.connect('clicked', () => run(planUninstall(id, env), 'remove'))

    row.add_suffix(enabled)
    row.add_suffix(install)
    row.add_suffix(uninstall)

    return { row, refresh }
  }
```

- [ ] **Step 3: Type check and build**

Run: `npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 4: Verify each state in the real window**

```bash
make install
cp ~/.claude/settings.json /tmp/settings.json.probe-backup
gnome-extensions prefs dasbo-island@ayubaswad.gmail.com
```

On the Agents page, walk the states:

1. **installed** — click Install on Claude Code. Row reads `Hooks installed`, Install goes insensitive, Remove stays active.
2. **absent** — click Remove. Row reads `Not installed`, Remove goes insensitive, Install becomes active.
3. **stale** — click Install again, then in a terminal run
   `sed -i 's#/hooks/dasbo-hook #/hooks/dasbo-hook-moved #g' ~/.claude/settings.json`
   (the trailing space keeps the substitution on the command word) and switch to
   another tab and back. Row reads `Needs update — the installed hook path is out of date`, the button says `Update`, and clicking it restores `Hooks installed`.
4. **unreadable** — run `printf '{not json' > ~/.claude/settings.json`, switch tabs and back. Row names the path as invalid JSON and both buttons are insensitive.

Restore afterwards:

```bash
cp /tmp/settings.json.probe-backup ~/.claude/settings.json
```

Then reopen the prefs and click Install on Claude Code so the real hooks are back in place; confirm the row reads `Hooks installed`.

- [ ] **Step 5: Commit**

```bash
git add src/prefs.ts
git commit -m "fix(prefs): show real hook install state per agent

Install always claimed success, because planInstall never returns an
empty edit list for an install. Drive the buttons and a new row
subtitle from installState, and re-read on page change so edits made
outside the window are not shown stale."
```

---

### Task 5: Documentation

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: behaviour from Tasks 2–4.
- Produces: nothing.

- [ ] **Step 1: Check what the README currently claims**

Run: `grep -n "prefs\|preferences\|Install\|position" README.md`
Expected: the install instructions around the `gnome-extensions prefs` line, and any statement about applying panel changes.

- [ ] **Step 2: Update the preferences paragraph**

Leave the existing "Then open the preferences…" sentence and its `gnome-extensions prefs` fenced block exactly as they are. Immediately **after** that fenced block, insert this paragraph verbatim:

    Each agent row shows whether its hooks are installed. If the extension
    directory moves, the row offers **Update** — every installed hook command
    embeds an absolute path. Panel box and position changes apply immediately,
    with no reload; note that extensions replacing the top bar, such as Dash to
    Panel, decide where each box ends up on screen.

(Indented above only to keep it out of this plan's code fences — insert it into the README unindented, as an ordinary paragraph.)

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: describe live panel placement and per-agent hook state"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| `installState` type, presence keyed to uninstall, set comparison, four states | Task 1 |
| `configPath` used for the `unreadable` subtitle | Task 1 (added), Task 4 (consumed) |
| `placeInPanelBox`, single `addToStatusArea`, `_settingsIds` array teardown | Task 2 |
| Appearance copy, capitalised labels, Dash to Panel subtitle | Task 3 |
| `_agentRow` returning `{ row, refresh }`, state table, `notify::visible-page` | Task 4 |
| Unit tests: absent / installed / stale / unreadable / invariant | Task 1 Step 1 |
| Manual placement check | Task 2 Step 5, Task 3 Step 3 |
| Out of scope: `Gio.FileMonitor`, enable switch rework, Behaviour page | not planned, correctly |

**Type consistency:** `installState(agent, env)` and `configPath(agent, env)` keep the same argument order as `planInstall` / `planUninstall`. `InstallState` values used in Task 4's `describe`, `install.label`, `install.sensitive` and `uninstall.sensitive` are exactly the four the union declares. `placeInPanelBox(container, box, index)` is called with `this._island.container`, a string and an int, matching its signature.
