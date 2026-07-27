# dasbo-island Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **REVISION R2 ALSO APPLIES.** Task 6's review found that `Session`'s single `pendingPermission` slot cannot represent the parallel tool calls agents actually make. `2026-07-27-dasbo-island-R2.md` rewrites **Task 6** and the permission-row rendering in **Tasks 10 and 11**. R2 wins over both this document and R1 where they overlap.

> **REVISION R1 APPLIES.** Task 2 captured real agent payloads and disproved three assumptions in this plan. `2026-07-27-dasbo-island-R1.md` rewrites **Tasks 4, 5, 7, 8 and 13** and adds the `HookContext` type. Where R1 and this document disagree, **R1 wins.** Tasks 1, 2, 3, 6, 9, 10, 11, 12, 14 and 15 are unaffected.

**Goal:** A GNOME Shell 46 extension that shows live AI coding-agent sessions as a top-bar pill, gates tool permissions inline, and jumps back to the terminal running a session.

**Architecture:** Two processes. A standalone GJS hook helper (`dasbo-hook`) reads an agent's hook payload from stdin and forwards it over the session bus to the extension, which owns `org.dasbo.Island`. The extension is split into a pure-TypeScript `src/core/` (no GObject imports, unit tested under vitest in plain node) and a thin `src/shell/` St/Clutter layer. Permission timeout policy lives entirely in the extension, so the hook never needs redeploying when settings change.

**Tech Stack:** TypeScript, esbuild (bundle, `--minify=false`), vitest, GJS 1.80, GNOME Shell 46 ESM extension format, `@girs/gnome-shell@46.0.2` types, GSettings, GDBus.

## Global Constraints

- Target GNOME Shell **46** exactly (`"shell-version": ["46"]`). Dev box is GNOME 46.0 on X11; nothing may be X11-specific.
- Extension UUID: `dasbo-island@ayubaswad.gmail.com`. GSettings schema id: `org.gnome.shell.extensions.dasbo-island`.
- D-Bus name `org.dasbo.Island`, object path `/org/dasbo/Island`, interface `org.dasbo.Island`.
- **`src/core/**` must never import from `gi://` or `resource://`.** It is compiled and tested by vitest under plain node. A `gi://` import anywhere under `src/core/` is a build failure, enforced by a test in Task 3.
- **The extension never spawns a subprocess.** Only file IO, D-Bus, and `/proc` reads. Required for extensions.gnome.org review.
- esbuild always runs with `--minify=false` and `--sourcemap`. Reviewers must be able to read `dist/`.
- `disable()` must fully tear down: destroy the panel button, unown the bus name, resolve every pending permission with a fall-through decision, clear every `GLib` source id, disconnect every signal.
- Session mode `user` only. Never `unlock-dialog`.
- Hooks fail open: every error path in `dasbo-hook` exits 0 with empty stdout.
- Permission timeout default 30s, `0` means wait indefinitely. Fall-through never auto-allows and never auto-denies.
- Commit after every task. Conventional Commits prefixes (`feat:`, `fix:`, `test:`, `chore:`, `docs:`).
- **`GObject.registerClass` subclasses use `constructor`, never `_init`.** `@girs` types the parent's constructor signature, and an `_init` override does not reach it, so `new Island()` fails to typecheck. Call `super(...)` directly. GJS routes it to the parent's `_init` at runtime.
- **`package.json` carries an `overrides` block pinning every `@girs/*` package.** Without it npm resolves the tree to two incompatible trains (`4.0.0-beta.15` top-level, `4.0.0-rc.17` nested), producing duplicate `GObject.ParamSpec` types and unusable `registerClass` typings. Never remove it; regenerate it if a `@girs` version is bumped.
- `npm run typecheck` must exit clean. It is a gate for every task, not advisory.

## File Structure

| Path | Responsibility |
|---|---|
| `metadata.json` | Extension manifest |
| `package.json`, `tsconfig.json`, `build.mjs`, `Makefile` | Build + install pipeline |
| `schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml` | GSettings keys |
| `stylesheet.css` | Pill and row styling |
| `src/core/types.ts` | `AgentEvent`, `Session`, `Decision`, `FileEdit` — no logic |
| `src/core/store.ts` | `reduce(state, event)`, subscribers, reaper |
| `src/core/permissions.ts` | Pending permission table, timeout, injected clock |
| `src/core/adapters/{claude,codex,antigravity}.ts` | One dialect each |
| `src/core/adapters/index.ts` | Dispatch by agent id |
| `src/core/install/plan.ts` | `planInstall` per agent, returns `FileEdit[]` |
| `src/dbus/iface.ts` | Interface XML string |
| `src/dbus/service.ts` | Exports the bus object, bridges to core |
| `src/shell/island.ts` | `PanelMenu.Button` — the pill + popup |
| `src/shell/sessionRow.ts` | One popup row per session |
| `src/shell/permissionRow.ts` | Allow / Deny / Always-allow controls |
| `src/shell/windowFinder.ts` | `/proc` ancestry → `Meta.Window` |
| `src/shell/applyEdits.ts` | Applies `FileEdit[]` to disk with backups |
| `src/extension.ts` | `enable()` / `disable()` wiring |
| `src/prefs.ts` | Adw preferences window |
| `hooks/dasbo-hook` | GJS script, shipped verbatim, not compiled |
| `tools/capture-hook` | Fixture capture harness |
| `tools/fake-agent.js` | Synthetic event generator |
| `test/fixtures/{claude,codex,antigravity}/` | Real captured payloads |

---

## Task 1: Scaffold — buildable, installable extension showing a static pill

**Files:**
- Create: `package.json`, `tsconfig.json`, `build.mjs`, `Makefile`, `.gitignore`
- Create: `metadata.json`, `stylesheet.css`
- Create: `schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml`
- Create: `src/extension.ts`
- Create: `vitest.config.ts`, `test/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `make build`, `make install`, `npm test`. The extension UUID `dasbo-island@ayubaswad.gmail.com` installed at `~/.local/share/gnome-shell/extensions/<uuid>/`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "dasbo-island",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node build.mjs",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@girs/gnome-shell": "46.0.2",
    "esbuild": "^0.24.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["@girs/gnome-shell/ambient", "@girs/gnome-shell/extensions/global"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 3: Create `build.mjs`**

esbuild must leave every GNOME import unresolved — `gi://`, `resource://`, and the bare `system`/`cairo`/`gettext` modules are provided by GJS at runtime.

```js
import { build } from 'esbuild'
import { cp, mkdir, rm } from 'node:fs/promises'

const external = ['gi://*', 'resource://*', 'system', 'cairo', 'gettext']
const common = {
  bundle: true,
  format: 'esm',
  target: 'firefox115',
  platform: 'neutral',
  minify: false,
  sourcemap: true,
  external,
}

await rm('dist', { recursive: true, force: true })
await mkdir('dist', { recursive: true })

await build({ ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js' })
await build({ ...common, entryPoints: ['src/prefs.ts'], outfile: 'dist/prefs.js' }).catch(() => {})

for (const f of ['metadata.json', 'stylesheet.css']) await cp(f, `dist/${f}`)
await cp('schemas', 'dist/schemas', { recursive: true })
await cp('hooks', 'dist/hooks', { recursive: true }).catch(() => {})
console.log('built dist/')
```

The `.catch(() => {})` on `prefs.ts` and `hooks/` is deliberate: they do not exist until Tasks 14 and 8. Remove both catches in Task 14.

- [ ] **Step 4: Create `metadata.json`**

```json
{
  "uuid": "dasbo-island@ayubaswad.gmail.com",
  "name": "Dasbo Island",
  "description": "Live AI coding-agent sessions in the top bar: status, inline permission approval, and jump-back to the terminal.",
  "shell-version": ["46"],
  "session-modes": ["user"],
  "settings-schema": "org.gnome.shell.extensions.dasbo-island",
  "gettext-domain": "dasbo-island",
  "url": "https://github.com/ayubaswad/dasbo-island",
  "version-name": "0.1.0"
}
```

- [ ] **Step 5: Create the GSettings schema**

File `schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<schemalist>
  <schema id="org.gnome.shell.extensions.dasbo-island"
          path="/org/gnome/shell/extensions/dasbo-island/">
    <key name="panel-position" type="s">
      <choices>
        <choice value="left"/>
        <choice value="center"/>
        <choice value="right"/>
      </choices>
      <default>'center'</default>
      <summary>Panel box for the island pill</summary>
      <description>Which top bar box the pill is placed in.</description>
    </key>
    <key name="panel-index" type="i">
      <default>0</default>
      <summary>Ordering index within the panel box</summary>
      <description>Position of the pill inside the chosen top bar box.</description>
    </key>
    <key name="always-show" type="b">
      <default>false</default>
      <summary>Show the pill with zero sessions</summary>
      <description>When false the pill is hidden entirely while no agent session is active.</description>
    </key>
    <key name="permission-timeout" type="i">
      <default>30</default>
      <summary>Permission prompt timeout in seconds</summary>
      <description>Seconds to wait for a decision before falling through to the agent's own prompt. Zero waits indefinitely.</description>
    </key>
    <key name="auto-open-on-permission" type="b">
      <default>true</default>
      <summary>Auto-expand the popup on a permission request</summary>
      <description>Suppressed while a fullscreen window is on the primary monitor.</description>
    </key>
    <key name="enabled-agents" type="as">
      <default>['claude','codex','antigravity']</default>
      <summary>Agent adapters that accept events</summary>
      <description>Independent of hook installation. An agent with no hooks installed simply never sends events.</description>
    </key>
    <key name="done-linger" type="i">
      <default>10</default>
      <summary>Seconds a finished session stays visible</summary>
      <description>How long a session in the done state remains in the popup before it is dropped.</description>
    </key>
  </schema>
</schemalist>
```

- [ ] **Step 6: Create `stylesheet.css`**

```css
.dasbo-pill {
  spacing: 6px;
}

.dasbo-dot {
  width: 8px;
  height: 8px;
  border-radius: 4px;
  background-color: #9e9e9e;
}

.dasbo-dot.state-running { background-color: #62a0ea; }
.dasbo-dot.state-waiting { background-color: #f5c211; }
.dasbo-dot.state-error   { background-color: #e01b24; }
.dasbo-dot.state-done    { background-color: #57e389; }

.dasbo-pill-label {
  font-size: 0.9em;
}

.dasbo-row-project {
  font-weight: bold;
}

.dasbo-row-activity {
  font-size: 0.85em;
  color: #cccccc;
}

.dasbo-row-elapsed {
  font-feature-settings: "tnum";
  color: #aaaaaa;
}

.dasbo-perm-command {
  font-family: monospace;
  font-size: 0.85em;
}
```

- [ ] **Step 7: Create `src/extension.ts` with a static pill**

```ts
import St from 'gi://St'
import GObject from 'gi://GObject'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'

const Island = GObject.registerClass(
  class Island extends PanelMenu.Button {
    constructor() {
      super(0.5, 'Dasbo Island')
      const box = new St.BoxLayout({ style_class: 'dasbo-pill' })
      box.add_child(new St.Widget({ style_class: 'dasbo-dot', y_align: 2 }))
      box.add_child(new St.Label({ text: 'dasbo', style_class: 'dasbo-pill-label', y_align: 2 }))
      this.add_child(box)
    }
  }
)

export default class DasboIslandExtension extends Extension {
  private _island: InstanceType<typeof Island> | null = null

  enable() {
    this._island = new Island()
    Main.panel.addToStatusArea(this.uuid, this._island, 0, 'center')
  }

  disable() {
    this._island?.destroy()
    this._island = null
  }
}
```

- [ ] **Step 8: Create the `Makefile`**

```makefile
UUID := dasbo-island@ayubaswad.gmail.com
DEST := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: build install uninstall schemas test typecheck clean

build:
	npm run build
	glib-compile-schemas dist/schemas

install: build
	rm -rf "$(DEST)"
	mkdir -p "$(DEST)"
	cp -r dist/. "$(DEST)/"
	chmod +x "$(DEST)/hooks/dasbo-hook" 2>/dev/null || true
	@echo "Installed. Log out and back in (X11), then: gnome-extensions enable $(UUID)"

uninstall:
	rm -rf "$(DEST)"

test:
	npm test

typecheck:
	npm run typecheck

clean:
	rm -rf dist node_modules
```

- [ ] **Step 9: Create `.gitignore`**

```
node_modules/
dist/
*.log
```

- [ ] **Step 10: Create `vitest.config.ts` and a smoke test**

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})
```

`test/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

describe('toolchain', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 11: Install deps and verify the build**

Run:
```bash
npm install && npm test && npm run typecheck && make install
```
Expected: vitest reports `1 passed`, `tsc` prints nothing, `make install` prints the `Installed.` line and `~/.local/share/gnome-shell/extensions/dasbo-island@ayubaswad.gmail.com/extension.js` exists.

- [ ] **Step 12: Verify the pill loads in a nested shell**

Run:
```bash
dbus-run-session -- gnome-shell --nested --wayland
```
In the nested shell's own terminal, or before launching, ensure the extension is enabled:
```bash
gnome-extensions enable dasbo-island@ayubaswad.gmail.com
```
Expected: a grey dot and the text `dasbo` appear in the centre of the nested shell's top bar. If nothing appears, check `journalctl -f -o cat /usr/bin/gnome-shell` for a stack trace.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat: scaffold GNOME 46 extension with build, schema and static pill"
```

---

## Task 2: Fixture capture harness — record real hook payloads

The three agents' payload dialects are only partly documented, and the installed Codex 0.142.0 uses a `hooks.json` shape (`{name: {command, events}}`, payload key `type`) that does not match the published docs. **The fixtures produced by this task are the specification for every adapter.** No adapter may be written before this task completes.

**Files:**
- Create: `tools/capture-hook`
- Create: `test/fixtures/.gitkeep`
- Modify: `~/.claude/settings.json`, `~/.codex/hooks.json`, `~/.gemini/config/hooks.json` (temporary, reverted in Step 7)

**Interfaces:**
- Consumes: nothing.
- Produces: `test/fixtures/<agent>/<hook_event_or_type>-<n>.json`, each holding one raw stdin payload verbatim. Also `docs/agent-dialects.md` recording what was observed.

- [ ] **Step 1: Write the capture script**

`tools/capture-hook`:

```sh
#!/bin/sh
# Records one agent hook payload verbatim, then exits 0 with empty stdout.
# Usage: capture-hook <agent-id>
AGENT="$1"
DIR="${DASBO_FIXTURE_DIR:-$PWD/test/fixtures}/$AGENT"
mkdir -p "$DIR"
N=$(ls "$DIR" 2>/dev/null | wc -l)
cat > "$DIR/raw-$N.json"
exit 0
```

Make it executable:
```bash
chmod +x tools/capture-hook
```

Note the script writes `raw-N.json`; Step 6 renames each file after its observed event name. It does not use `jq` — no assumption is made about the payload being valid JSON until it has been seen.

- [ ] **Step 2: Back up the three agent configs**

```bash
cp ~/.claude/settings.json ~/.claude/settings.json.precapture
cp ~/.codex/hooks.json ~/.codex/hooks.json.precapture
mkdir -p ~/.gemini/config
cp ~/.gemini/config/hooks.json ~/.gemini/config/hooks.json.precapture 2>/dev/null || true
```
Expected: no errors. The Gemini copy may legitimately fail; the `|| true` covers it.

- [ ] **Step 3: Install capture hooks for Claude Code**

Claude Code reads `hooks` from `~/.claude/settings.json`. Merge this in, replacing the existing empty `"hooks": {}`, with `<REPO>` substituted for the absolute path of this repository:

```json
"hooks": {
  "SessionStart":     [{ "hooks": [{ "type": "command", "command": "<REPO>/tools/capture-hook claude" }] }],
  "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "<REPO>/tools/capture-hook claude" }] }],
  "PreToolUse":       [{ "matcher": "*", "hooks": [{ "type": "command", "command": "<REPO>/tools/capture-hook claude" }] }],
  "PostToolUse":      [{ "matcher": "*", "hooks": [{ "type": "command", "command": "<REPO>/tools/capture-hook claude" }] }],
  "Stop":             [{ "hooks": [{ "type": "command", "command": "<REPO>/tools/capture-hook claude" }] }]
}
```

Set the fixture directory so the hook writes into the repo regardless of the agent's cwd:
```bash
export DASBO_FIXTURE_DIR=<REPO>/test/fixtures
```
Because hooks do not inherit that export from your shell, instead hardcode it — change the `command` values to
`env DASBO_FIXTURE_DIR=<REPO>/test/fixtures <REPO>/tools/capture-hook claude`.

- [ ] **Step 4: Install capture hooks for Codex and Antigravity**

Codex — merge into `~/.codex/hooks.json`, **preserving the existing `vibe-island` entry**:

```json
{
  "vibe-island": {
    "command": "python3 /home/fsevenm/.codex/vibe-island-hook.py",
    "events": ["session.start", "session.end", "tool.start", "tool.end"]
  },
  "dasbo-capture": {
    "command": "env DASBO_FIXTURE_DIR=<REPO>/test/fixtures <REPO>/tools/capture-hook codex",
    "events": ["session.start", "session.end", "tool.start", "tool.end"]
  }
}
```

Antigravity — create `~/.gemini/config/hooks.json`:

```json
{
  "PreToolUse":  [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "env DASBO_FIXTURE_DIR=<REPO>/test/fixtures <REPO>/tools/capture-hook antigravity" }] }],
  "PostToolUse": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "env DASBO_FIXTURE_DIR=<REPO>/test/fixtures <REPO>/tools/capture-hook antigravity" }] }],
  "Stop":        [{ "hooks": [{ "type": "command", "command": "env DASBO_FIXTURE_DIR=<REPO>/test/fixtures <REPO>/tools/capture-hook antigravity" }] }]
}
```

This shape is a guess drawn from the published docs. Step 5 determines empirically whether it is correct.

- [ ] **Step 5: Drive each agent and collect payloads**

In a scratch directory (not this repo), run each agent through a session that touches at least one file and runs at least one shell command, so both a file-edit tool and a bash tool are captured:

```bash
mkdir -p /tmp/dasbo-capture && cd /tmp/dasbo-capture && echo 'hello' > a.txt
claude -p 'read a.txt, then append the word world to it, then run `ls -la`'
codex exec 'read a.txt, then append the word world to it, then run `ls -la`'
agy --print 'read a.txt, then append the word world to it, then run `ls -la`'
```

Then inspect what landed:
```bash
cd <REPO> && for d in test/fixtures/*/; do echo "== $d"; ls "$d"; done
```
Expected: at least one file under `test/fixtures/claude/`. If `test/fixtures/codex/` or `test/fixtures/antigravity/` is empty, that agent's hook config shape is wrong — record that fact in Step 6 rather than guessing further, and mark that adapter blocked.

- [ ] **Step 6: Rename fixtures by event and write down the dialect**

For each captured file, read its content and rename it after the field that identifies the event (`hook_event_name` for Claude, `type` for Codex, whichever key Antigravity uses):

```bash
cd <REPO>/test/fixtures
for f in */raw-*.json; do
  ev=$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(d.hook_event_name||d.type||d.hookEventName||d.event||"unknown")' "$f")
  mv "$f" "$(dirname "$f")/${ev}-$(basename "$f" | sed 's/raw-//')"
done
ls -R .
```

Then write `docs/agent-dialects.md` recording, per agent: the config file path and shape that actually worked, every event name observed, and the exact key names for session id, cwd, tool name, transcript path, and process id. Where a field is absent, write `ABSENT` — that is a real finding the adapters must handle.

- [ ] **Step 7: Restore the agent configs**

```bash
mv ~/.claude/settings.json.precapture ~/.claude/settings.json
mv ~/.codex/hooks.json.precapture ~/.codex/hooks.json
if [ -f ~/.gemini/config/hooks.json.precapture ]; then
  mv ~/.gemini/config/hooks.json.precapture ~/.gemini/config/hooks.json
else
  rm -f ~/.gemini/config/hooks.json
fi
```
Expected: `git status` in the repo shows only new fixture files and `docs/agent-dialects.md`; your agent configs are back to their original state.

- [ ] **Step 8: Commit**

```bash
git add tools/capture-hook test/fixtures docs/agent-dialects.md
git commit -m "test: capture real hook payloads for claude, codex and antigravity"
```

---

## Task 3: Core types and the session reducer

**Files:**
- Create: `src/core/types.ts`, `src/core/store.ts`
- Test: `test/core/store.test.ts`, `test/core/purity.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type AgentId = 'claude' | 'codex' | 'antigravity'`
  - `type SessionState = 'idle' | 'running' | 'waiting' | 'done' | 'error'`
  - `interface AgentEvent`, `interface Session`, `interface Decision`, `interface FileEdit`
  - `class SessionStore` with `apply(event: AgentEvent): void`, `list(): Session[]`, `get(key: string): Session | undefined`, `subscribe(fn: () => void): () => void`, `reap(now: number, pidAlive: (pid: number) => boolean): void`, `setPending(key, pending)`, `clearPending(key)`, `worstState(): SessionState`

- [ ] **Step 1: Write `src/core/types.ts`**

```ts
export type AgentId = 'claude' | 'codex' | 'antigravity'

export type SessionState = 'idle' | 'running' | 'waiting' | 'done' | 'error'

export type EventKind =
  | 'session-start'
  | 'prompt-submit'
  | 'tool-start'
  | 'tool-end'
  | 'stop'
  | 'error'

/** An agent hook payload after dialect normalisation. */
export interface AgentEvent {
  agent: AgentId
  kind: EventKind
  sessionId: string
  cwd: string
  /** Tool name for tool-start / tool-end, otherwise undefined. */
  tool?: string
  /** Human-readable detail, e.g. the bash command being run. */
  detail?: string
  transcriptPath?: string
  /** PID of the hook process, used as the seed for jump-back ancestry. */
  pid: number
  /** Milliseconds since epoch, supplied by the caller, never read from a clock here. */
  ts: number
}

export interface PendingPermission {
  id: string
  tool: string
  detail?: string
  /** Milliseconds since epoch when this request must fall through. 0 means never. */
  deadline: number
}

export interface Session {
  key: string
  agent: AgentId
  sessionId: string
  project: string
  cwd: string
  state: SessionState
  currentTool?: string
  detail?: string
  pid: number
  startedAt: number
  lastEventAt: number
  /** Set when state became 'done'; used for the done-linger sweep. */
  doneAt?: number
  transcriptPath?: string
  pendingPermission?: PendingPermission
}

export type DecisionKind = 'allow' | 'deny' | 'fallthrough'

export interface Decision {
  kind: DecisionKind
  reason?: string
}

export interface FileEdit {
  path: string
  /** Full desired content of the file after the edit. */
  content: string
  /** When true, write `<path>.dasbo.bak` first if the file exists and no backup is present. */
  backup: boolean
}

export function sessionKey(agent: AgentId, sessionId: string): string {
  return `${agent}:${sessionId}`
}

export function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, '')
  const i = trimmed.lastIndexOf('/')
  return i === -1 ? trimmed : trimmed.slice(i + 1)
}
```

- [ ] **Step 2: Write the failing reducer tests**

`test/core/store.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { SessionStore } from '../../src/core/store.js'
import type { AgentEvent } from '../../src/core/types.js'

function ev(over: Partial<AgentEvent> = {}): AgentEvent {
  return {
    agent: 'claude',
    kind: 'session-start',
    sessionId: 's1',
    cwd: '/home/me/projects/dasbo-island',
    pid: 4242,
    ts: 1000,
    ...over,
  }
}

describe('SessionStore', () => {
  it('creates a session on session-start with project from cwd basename', () => {
    const s = new SessionStore()
    s.apply(ev())
    const list = s.list()
    expect(list).toHaveLength(1)
    expect(list[0]!.project).toBe('dasbo-island')
    expect(list[0]!.state).toBe('idle')
    expect(list[0]!.key).toBe('claude:s1')
  })

  it('creates a session implicitly when the first event is not session-start', () => {
    const s = new SessionStore()
    s.apply(ev({ kind: 'tool-start', tool: 'Edit' }))
    expect(s.list()).toHaveLength(1)
    expect(s.list()[0]!.state).toBe('running')
  })

  it('moves to running on tool-start and records the tool', () => {
    const s = new SessionStore()
    s.apply(ev())
    s.apply(ev({ kind: 'tool-start', tool: 'Edit', detail: 'main.js', ts: 2000 }))
    expect(s.list()[0]!.state).toBe('running')
    expect(s.list()[0]!.currentTool).toBe('Edit')
    expect(s.list()[0]!.detail).toBe('main.js')
  })

  it('returns to idle on tool-end and clears the tool', () => {
    const s = new SessionStore()
    s.apply(ev({ kind: 'tool-start', tool: 'Edit' }))
    s.apply(ev({ kind: 'tool-end', tool: 'Edit', ts: 3000 }))
    expect(s.list()[0]!.state).toBe('idle')
    expect(s.list()[0]!.currentTool).toBeUndefined()
  })

  it('marks done on stop and stamps doneAt', () => {
    const s = new SessionStore()
    s.apply(ev())
    s.apply(ev({ kind: 'stop', ts: 5000 }))
    expect(s.list()[0]!.state).toBe('done')
    expect(s.list()[0]!.doneAt).toBe(5000)
  })

  it('keeps sessions from different agents with the same id separate', () => {
    const s = new SessionStore()
    s.apply(ev({ agent: 'claude' }))
    s.apply(ev({ agent: 'codex' }))
    expect(s.list()).toHaveLength(2)
  })

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const s = new SessionStore()
    let n = 0
    const off = s.subscribe(() => { n++ })
    s.apply(ev())
    expect(n).toBe(1)
    off()
    s.apply(ev({ kind: 'stop', ts: 2000 }))
    expect(n).toBe(1)
  })

  it('setPending puts the session into waiting and clearPending restores idle', () => {
    const s = new SessionStore()
    s.apply(ev())
    s.setPending('claude:s1', { id: 'p1', tool: 'Bash', detail: 'rm -rf build', deadline: 31000 })
    expect(s.list()[0]!.state).toBe('waiting')
    expect(s.list()[0]!.pendingPermission?.tool).toBe('Bash')
    s.clearPending('claude:s1')
    expect(s.list()[0]!.state).toBe('idle')
    expect(s.list()[0]!.pendingPermission).toBeUndefined()
  })

  it('worstState ranks waiting above running above idle', () => {
    const s = new SessionStore()
    s.apply(ev({ sessionId: 'a' }))
    s.apply(ev({ sessionId: 'b', kind: 'tool-start', tool: 'Edit' }))
    expect(s.worstState()).toBe('running')
    s.setPending('claude:a', { id: 'p1', tool: 'Bash', deadline: 0 })
    expect(s.worstState()).toBe('waiting')
  })

  it('reap drops a stale session whose pid is dead', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    const fifteenMin = 15 * 60 * 1000
    s.reap(fifteenMin + 1, () => false)
    expect(s.list()).toHaveLength(0)
  })

  it('reap keeps a stale session whose pid is still alive', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.reap(15 * 60 * 1000 + 1, () => true)
    expect(s.list()).toHaveLength(1)
  })

  it('reap drops a done session after the linger window', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.apply(ev({ kind: 'stop', ts: 1000 }))
    s.reap(1000 + 10_000 + 1, () => true)
    expect(s.list()).toHaveLength(0)
  })

  it('reap never drops a session with a pending permission', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 0 }))
    s.setPending('claude:s1', { id: 'p1', tool: 'Bash', deadline: 0 })
    s.reap(99_999_999, () => false)
    expect(s.list()).toHaveLength(1)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/core/store.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/store.js"`.

- [ ] **Step 4: Write `src/core/store.ts`**

```ts
import { basename, sessionKey } from './types.js'
import type { AgentEvent, PendingPermission, Session, SessionState } from './types.js'

const STALE_MS = 15 * 60 * 1000

const RANK: Record<SessionState, number> = {
  done: 0,
  idle: 1,
  running: 2,
  waiting: 3,
  error: 4,
}

export class SessionStore {
  private sessions = new Map<string, Session>()
  private subscribers = new Set<() => void>()
  /** Seconds a done session lingers before reaping. Set from GSettings by the shell layer. */
  doneLingerSeconds = 10

  subscribe(fn: () => void): () => void {
    this.subscribers.add(fn)
    return () => { this.subscribers.delete(fn) }
  }

  private emit(): void {
    for (const fn of this.subscribers) fn()
  }

  list(): Session[] {
    return [...this.sessions.values()].sort((a, b) => a.startedAt - b.startedAt)
  }

  get(key: string): Session | undefined {
    return this.sessions.get(key)
  }

  worstState(): SessionState {
    let worst: SessionState = 'idle'
    for (const s of this.sessions.values()) {
      if (RANK[s.state] > RANK[worst]) worst = s.state
    }
    return worst
  }

  private ensure(e: AgentEvent): Session {
    const key = sessionKey(e.agent, e.sessionId)
    let s = this.sessions.get(key)
    if (!s) {
      s = {
        key,
        agent: e.agent,
        sessionId: e.sessionId,
        project: basename(e.cwd) || e.cwd,
        cwd: e.cwd,
        state: 'idle',
        pid: e.pid,
        startedAt: e.ts,
        lastEventAt: e.ts,
      }
      this.sessions.set(key, s)
    }
    return s
  }

  apply(e: AgentEvent): void {
    const s = this.ensure(e)
    s.lastEventAt = e.ts
    if (e.pid) s.pid = e.pid
    if (e.transcriptPath) s.transcriptPath = e.transcriptPath

    switch (e.kind) {
      case 'session-start':
        s.state = 'idle'
        break
      case 'prompt-submit':
        s.state = 'running'
        s.currentTool = undefined
        s.detail = undefined
        break
      case 'tool-start':
        s.state = 'running'
        s.currentTool = e.tool
        s.detail = e.detail
        break
      case 'tool-end':
        s.state = 'idle'
        s.currentTool = undefined
        s.detail = undefined
        break
      case 'stop':
        s.state = 'done'
        s.doneAt = e.ts
        s.currentTool = undefined
        s.detail = undefined
        break
      case 'error':
        s.state = 'error'
        s.detail = e.detail
        break
    }
    this.emit()
  }

  setPending(key: string, pending: PendingPermission): void {
    const s = this.sessions.get(key)
    if (!s) return
    s.pendingPermission = pending
    s.state = 'waiting'
    this.emit()
  }

  clearPending(key: string): void {
    const s = this.sessions.get(key)
    if (!s?.pendingPermission) return
    s.pendingPermission = undefined
    if (s.state === 'waiting') s.state = 'idle'
    this.emit()
  }

  /**
   * Drop finished and abandoned sessions.
   * `pidAlive` is injected so this stays free of any filesystem dependency.
   */
  reap(now: number, pidAlive: (pid: number) => boolean): void {
    let changed = false
    for (const [key, s] of [...this.sessions]) {
      if (s.pendingPermission) continue
      const lingerExpired =
        s.state === 'done' && s.doneAt !== undefined &&
        now - s.doneAt > this.doneLingerSeconds * 1000
      const abandoned = now - s.lastEventAt > STALE_MS && !pidAlive(s.pid)
      if (lingerExpired || abandoned) {
        this.sessions.delete(key)
        changed = true
      }
    }
    if (changed) this.emit()
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/core/store.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 6: Write the core-purity guard test**

`test/core/purity.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

describe('src/core purity', () => {
  it('never imports gi:// or resource://', () => {
    const offenders = walk('src/core').filter((f) => {
      const src = readFileSync(f, 'utf8')
      return src.includes("gi://") || src.includes("resource:///")
    })
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 7: Run the purity test**

Run: `npx vitest run test/core/purity.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/core/types.ts src/core/store.ts test/core
git commit -m "feat(core): add session types, reducer store and purity guard"
```

---

## Task 4: Claude Code adapter

**Files:**
- Create: `src/core/adapters/claude.ts`
- Test: `test/core/adapters/claude.test.ts`

**Interfaces:**
- Consumes: `AgentEvent`, `Decision`, `AgentId` from `src/core/types.ts`.
- Produces: `interface AgentAdapter { id, displayName, normalize(raw, pid, ts), encodeDecision(d) }` exported from `src/core/adapters/claude.ts` as `claudeAdapter`, and the shared `AgentAdapter` type in the same file for now (moved to `index.ts` in Task 5).

Before writing code, open `docs/agent-dialects.md` and `test/fixtures/claude/` from Task 2. **Where this task's assumed key names disagree with the captured fixtures, the fixtures win** — adjust the mapping and the test data to match what the agent actually sends.

- [ ] **Step 1: Write the failing adapter test**

`test/core/adapters/claude.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { claudeAdapter } from '../../../src/core/adapters/claude.js'

describe('claudeAdapter.normalize', () => {
  it('maps SessionStart to session-start', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'SessionStart', session_id: 's1', cwd: '/p/app', transcript_path: '/t.jsonl' },
      1234, 5000
    )
    expect(e).toEqual({
      agent: 'claude', kind: 'session-start', sessionId: 's1', cwd: '/p/app',
      tool: undefined, detail: undefined, transcriptPath: '/t.jsonl', pid: 1234, ts: 5000,
    })
  })

  it('maps PreToolUse to tool-start and extracts a bash command as detail', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'PreToolUse', session_id: 's1', cwd: '/p/app',
        tool_name: 'Bash', tool_input: { command: 'rm -rf build' } },
      1, 2
    )
    expect(e?.kind).toBe('tool-start')
    expect(e?.tool).toBe('Bash')
    expect(e?.detail).toBe('rm -rf build')
  })

  it('uses file_path as detail for file tools', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'PreToolUse', session_id: 's1', cwd: '/p/app',
        tool_name: 'Edit', tool_input: { file_path: '/p/app/src/main.js' } },
      1, 2
    )
    expect(e?.detail).toBe('/p/app/src/main.js')
  })

  it('maps PostToolUse, UserPromptSubmit and Stop', () => {
    const kinds = ['PostToolUse', 'UserPromptSubmit', 'Stop'].map(
      (n) => claudeAdapter.normalize({ hook_event_name: n, session_id: 's1', cwd: '/p' }, 1, 2)?.kind
    )
    expect(kinds).toEqual(['tool-end', 'prompt-submit', 'stop'])
  })

  it('returns null for an unknown event', () => {
    expect(claudeAdapter.normalize({ hook_event_name: 'Nope', session_id: 's', cwd: '/p' }, 1, 2)).toBeNull()
  })

  it('returns null for a payload with no session id', () => {
    expect(claudeAdapter.normalize({ hook_event_name: 'Stop', cwd: '/p' }, 1, 2)).toBeNull()
  })

  it('returns null for a non-object payload', () => {
    expect(claudeAdapter.normalize('not json', 1, 2)).toBeNull()
    expect(claudeAdapter.normalize(null, 1, 2)).toBeNull()
  })
})

describe('claudeAdapter.encodeDecision', () => {
  it('encodes allow', () => {
    expect(claudeAdapter.encodeDecision({ kind: 'allow' })).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'Allowed from Dasbo Island',
      },
    })
  })

  it('encodes deny with the supplied reason', () => {
    const out = claudeAdapter.encodeDecision({ kind: 'deny', reason: 'nope' }) as any
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(out.hookSpecificOutput.permissionDecisionReason).toBe('nope')
  })

  it('encodes fallthrough as ask so Claude prompts normally', () => {
    const out = claudeAdapter.encodeDecision({ kind: 'fallthrough' }) as any
    expect(out.hookSpecificOutput.permissionDecision).toBe('ask')
  })
})

describe('claudeAdapter against captured fixtures', () => {
  const dir = 'test/fixtures/claude'
  it('normalizes every captured payload without throwing', () => {
    if (!existsSync(dir)) return
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) {
      const raw = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'))
      const e = claudeAdapter.normalize(raw, 1, 2)
      if (e !== null) {
        expect(e.sessionId, `${f} must yield a session id`).toBeTruthy()
        expect(e.cwd, `${f} must yield a cwd`).toBeTruthy()
      }
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/core/adapters/claude.test.ts`
Expected: FAIL — cannot resolve `src/core/adapters/claude.js`.

- [ ] **Step 3: Write `src/core/adapters/claude.ts`**

```ts
import type { AgentEvent, AgentId, Decision, EventKind } from '../types.js'

export interface AgentAdapter {
  id: AgentId
  displayName: string
  /**
   * Convert a raw agent hook payload into an AgentEvent.
   * `pid` and `ts` are supplied by the caller so this stays pure.
   * Returns null when the payload is unusable — the caller drops it.
   */
  normalize(raw: unknown, pid: number, ts: number): AgentEvent | null
  /** Convert an internal Decision into this agent's stdout JSON. */
  encodeDecision(d: Decision): unknown
}

const KIND_BY_EVENT: Record<string, EventKind> = {
  SessionStart: 'session-start',
  UserPromptSubmit: 'prompt-submit',
  PreToolUse: 'tool-start',
  PostToolUse: 'tool-end',
  Stop: 'stop',
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/** Pick the most useful human-readable detail out of a Claude tool_input blob. */
export function detailFromToolInput(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined
  return (
    str(input['command']) ??
    str(input['file_path']) ??
    str(input['path']) ??
    str(input['pattern']) ??
    str(input['url'])
  )
}

export const claudeAdapter: AgentAdapter = {
  id: 'claude',
  displayName: 'Claude Code',

  normalize(raw, pid, ts) {
    if (!isRecord(raw)) return null
    const eventName = str(raw['hook_event_name'])
    if (!eventName) return null
    const kind = KIND_BY_EVENT[eventName]
    if (!kind) return null

    const sessionId = str(raw['session_id'])
    const cwd = str(raw['cwd'])
    if (!sessionId || !cwd) return null

    return {
      agent: 'claude',
      kind,
      sessionId,
      cwd,
      tool: str(raw['tool_name']),
      detail: detailFromToolInput(raw['tool_input']),
      transcriptPath: str(raw['transcript_path']),
      pid,
      ts,
    }
  },

  encodeDecision(d: Decision) {
    const permissionDecision =
      d.kind === 'allow' ? 'allow' : d.kind === 'deny' ? 'deny' : 'ask'
    const defaultReason =
      d.kind === 'allow' ? 'Allowed from Dasbo Island'
      : d.kind === 'deny' ? 'Denied from Dasbo Island'
      : 'Dasbo Island did not decide'
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision,
        permissionDecisionReason: d.reason ?? defaultReason,
      },
    }
  },
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/core/adapters/claude.test.ts`
Expected: PASS. If the fixture block fails, the captured payload disagrees with the mapping above — fix `claude.ts` to match the fixture, never the reverse.

- [ ] **Step 5: Commit**

```bash
git add src/core/adapters/claude.ts test/core/adapters/claude.test.ts
git commit -m "feat(core): add Claude Code hook adapter"
```

---

## Task 5: Codex and Antigravity adapters plus dispatch

**Files:**
- Create: `src/core/adapters/codex.ts`, `src/core/adapters/antigravity.ts`, `src/core/adapters/index.ts`
- Modify: `src/core/adapters/claude.ts` (move the `AgentAdapter` interface out)
- Test: `test/core/adapters/codex.test.ts`, `test/core/adapters/antigravity.test.ts`, `test/core/adapters/index.test.ts`

**Interfaces:**
- Consumes: `AgentAdapter` (currently in `claude.ts`), `AgentEvent`, `Decision`.
- Produces: `src/core/adapters/index.ts` exporting `AgentAdapter`, `adapters: Record<AgentId, AgentAdapter>`, and `normalizeFor(agent: AgentId, raw: unknown, pid: number, ts: number): AgentEvent | null`.

The Codex mapping below is written against the dialect observed on this machine (`~/.codex/hooks.json` entries of shape `{command, events}` and payloads keyed by `type`). Reconcile against `docs/agent-dialects.md` first; fixtures win.

- [ ] **Step 1: Move the shared interface into `index.ts`**

Create `src/core/adapters/index.ts`:

```ts
import type { AgentEvent, AgentId, Decision } from '../types.js'
import { claudeAdapter } from './claude.js'
import { codexAdapter } from './codex.js'
import { antigravityAdapter } from './antigravity.js'

export interface AgentAdapter {
  id: AgentId
  displayName: string
  normalize(raw: unknown, pid: number, ts: number): AgentEvent | null
  encodeDecision(d: Decision): unknown
}

export const adapters: Record<AgentId, AgentAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  antigravity: antigravityAdapter,
}

export function isAgentId(v: string): v is AgentId {
  return v === 'claude' || v === 'codex' || v === 'antigravity'
}

export function normalizeFor(agent: AgentId, raw: unknown, pid: number, ts: number): AgentEvent | null {
  return adapters[agent].normalize(raw, pid, ts)
}
```

In `src/core/adapters/claude.ts`, delete the local `export interface AgentAdapter { ... }` block and replace it with:

```ts
import type { AgentAdapter } from './index.js'
```

Keep `export type { AgentAdapter }` out of `claude.ts` entirely — `index.ts` is now the single source.

- [ ] **Step 2: Write the failing Codex test**

`test/core/adapters/codex.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { codexAdapter } from '../../../src/core/adapters/codex.js'

describe('codexAdapter.normalize', () => {
  it('maps dotted event names from the type field', () => {
    const cases: Array<[string, string]> = [
      ['session.start', 'session-start'],
      ['session.end', 'stop'],
      ['tool.start', 'tool-start'],
      ['tool.end', 'tool-end'],
    ]
    for (const [type, kind] of cases) {
      const e = codexAdapter.normalize({ type, session_id: 's1', cwd: '/p/app' }, 1, 2)
      expect(e?.kind, type).toBe(kind)
    }
  })

  it('also accepts CamelCase hook_event_name payloads', () => {
    const e = codexAdapter.normalize(
      { hook_event_name: 'PreToolUse', session_id: 's1', cwd: '/p/app', tool_name: 'shell' }, 1, 2
    )
    expect(e?.kind).toBe('tool-start')
    expect(e?.tool).toBe('shell')
  })

  it('carries tool_name through as tool', () => {
    const e = codexAdapter.normalize(
      { type: 'tool.start', session_id: 's1', cwd: '/p', tool_name: 'shell' }, 1, 2
    )
    expect(e?.tool).toBe('shell')
    expect(e?.agent).toBe('codex')
  })

  it('returns null on unknown type or missing session id', () => {
    expect(codexAdapter.normalize({ type: 'nope', session_id: 's', cwd: '/p' }, 1, 2)).toBeNull()
    expect(codexAdapter.normalize({ type: 'tool.start', cwd: '/p' }, 1, 2)).toBeNull()
  })
})

describe('codexAdapter.encodeDecision', () => {
  it('encodes allow and deny in the hookSpecificOutput shape', () => {
    const allow = codexAdapter.encodeDecision({ kind: 'allow' }) as any
    expect(allow.hookSpecificOutput.permissionDecision).toBe('allow')
    const deny = codexAdapter.encodeDecision({ kind: 'deny', reason: 'no' }) as any
    expect(deny.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(deny.hookSpecificOutput.permissionDecisionReason).toBe('no')
  })

  it('encodes fallthrough as an empty object so Codex is unaffected', () => {
    expect(codexAdapter.encodeDecision({ kind: 'fallthrough' })).toEqual({})
  })
})

describe('codexAdapter against captured fixtures', () => {
  const dir = 'test/fixtures/codex'
  it('normalizes every captured payload without throwing', () => {
    if (!existsSync(dir)) return
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const raw = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'))
      const e = codexAdapter.normalize(raw, 1, 2)
      if (e !== null) expect(e.sessionId, f).toBeTruthy()
    }
  })
})
```

- [ ] **Step 3: Write the failing Antigravity test**

`test/core/adapters/antigravity.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { antigravityAdapter } from '../../../src/core/adapters/antigravity.js'

describe('antigravityAdapter.normalize', () => {
  it('maps camelCase payloads and takes cwd from workspacePaths[0]', () => {
    const e = antigravityAdapter.normalize(
      { hookEventName: 'PreToolUse', conversationId: 'c1',
        workspacePaths: ['/home/me/app'], transcriptPath: '/t.json', toolName: 'write_file' },
      7, 9
    )
    expect(e).toEqual({
      agent: 'antigravity', kind: 'tool-start', sessionId: 'c1', cwd: '/home/me/app',
      tool: 'write_file', detail: undefined, transcriptPath: '/t.json', pid: 7, ts: 9,
    })
  })

  it('maps PostToolUse, PostInvocation and Stop', () => {
    const kinds = ['PostToolUse', 'PostInvocation', 'Stop'].map(
      (n) => antigravityAdapter.normalize(
        { hookEventName: n, conversationId: 'c1', workspacePaths: ['/p'] }, 1, 2
      )?.kind
    )
    expect(kinds).toEqual(['tool-end', 'tool-end', 'stop'])
  })

  it('reports an error kind when the payload carries an error string', () => {
    const e = antigravityAdapter.normalize(
      { hookEventName: 'PostToolUse', conversationId: 'c1', workspacePaths: ['/p'], error: 'boom' }, 1, 2
    )
    expect(e?.kind).toBe('error')
    expect(e?.detail).toBe('boom')
  })

  it('falls back to the cwd key when workspacePaths is absent', () => {
    const e = antigravityAdapter.normalize(
      { hookEventName: 'Stop', conversationId: 'c1', cwd: '/fallback' }, 1, 2
    )
    expect(e?.cwd).toBe('/fallback')
  })

  it('returns null with no conversation id or no path at all', () => {
    expect(antigravityAdapter.normalize({ hookEventName: 'Stop', workspacePaths: ['/p'] }, 1, 2)).toBeNull()
    expect(antigravityAdapter.normalize({ hookEventName: 'Stop', conversationId: 'c' }, 1, 2)).toBeNull()
  })
})

describe('antigravityAdapter.encodeDecision', () => {
  it('encodes allow, deny and fallthrough', () => {
    expect((antigravityAdapter.encodeDecision({ kind: 'allow' }) as any).permissionDecision).toBe('allow')
    expect((antigravityAdapter.encodeDecision({ kind: 'deny' }) as any).permissionDecision).toBe('deny')
    expect(antigravityAdapter.encodeDecision({ kind: 'fallthrough' })).toEqual({})
  })
})

describe('antigravityAdapter against captured fixtures', () => {
  const dir = 'test/fixtures/antigravity'
  it('normalizes every captured payload without throwing', () => {
    if (!existsSync(dir)) return
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const raw = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'))
      const e = antigravityAdapter.normalize(raw, 1, 2)
      if (e !== null) expect(e.sessionId, f).toBeTruthy()
    }
  })
})
```

- [ ] **Step 4: Write the dispatch test**

`test/core/adapters/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { adapters, isAgentId, normalizeFor } from '../../../src/core/adapters/index.js'

describe('adapter dispatch', () => {
  it('exposes one adapter per agent id, each self-identifying', () => {
    for (const id of ['claude', 'codex', 'antigravity'] as const) {
      expect(adapters[id].id).toBe(id)
    }
  })

  it('isAgentId rejects unknown ids', () => {
    expect(isAgentId('claude')).toBe(true)
    expect(isAgentId('cursor')).toBe(false)
  })

  it('normalizeFor routes to the right adapter', () => {
    const e = normalizeFor('claude', { hook_event_name: 'Stop', session_id: 's', cwd: '/p' }, 1, 2)
    expect(e?.agent).toBe('claude')
  })
})
```

- [ ] **Step 5: Run all three tests to verify they fail**

Run: `npx vitest run test/core/adapters/`
Expected: FAIL — cannot resolve `codex.js` and `antigravity.js`.

- [ ] **Step 6: Write `src/core/adapters/codex.ts`**

```ts
import type { AgentEvent, Decision, EventKind } from '../types.js'
import type { AgentAdapter } from './index.js'
import { detailFromToolInput } from './claude.js'

/** Codex 0.142 emits dotted names in `type`; newer builds use `hook_event_name`. Accept both. */
const KIND_BY_EVENT: Record<string, EventKind> = {
  'session.start': 'session-start',
  'session.end': 'stop',
  'tool.start': 'tool-start',
  'tool.end': 'tool-end',
  SessionStart: 'session-start',
  UserPromptSubmit: 'prompt-submit',
  PreToolUse: 'tool-start',
  PostToolUse: 'tool-end',
  Stop: 'stop',
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

export const codexAdapter: AgentAdapter = {
  id: 'codex',
  displayName: 'Codex CLI',

  normalize(raw, pid, ts) {
    if (!isRecord(raw)) return null
    const eventName = str(raw['type']) ?? str(raw['hook_event_name'])
    if (!eventName) return null
    const kind = KIND_BY_EVENT[eventName]
    if (!kind) return null

    const sessionId = str(raw['session_id'])
    const cwd = str(raw['cwd'])
    if (!sessionId || !cwd) return null

    return {
      agent: 'codex',
      kind,
      sessionId,
      cwd,
      tool: str(raw['tool_name']),
      detail: detailFromToolInput(raw['tool_input']) ?? str(raw['command']),
      transcriptPath: str(raw['transcript_path']),
      pid,
      ts,
    }
  },

  encodeDecision(d: Decision) {
    if (d.kind === 'fallthrough') return {}
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: d.kind,
        permissionDecisionReason:
          d.reason ?? (d.kind === 'allow' ? 'Allowed from Dasbo Island' : 'Denied from Dasbo Island'),
      },
    }
  },
}
```

- [ ] **Step 7: Write `src/core/adapters/antigravity.ts`**

```ts
import type { Decision, EventKind } from '../types.js'
import type { AgentAdapter } from './index.js'

const KIND_BY_EVENT: Record<string, EventKind> = {
  SessionStart: 'session-start',
  UserPromptSubmit: 'prompt-submit',
  PreToolUse: 'tool-start',
  PostToolUse: 'tool-end',
  PostInvocation: 'tool-end',
  Stop: 'stop',
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function firstWorkspacePath(v: unknown): string | undefined {
  return Array.isArray(v) ? str(v[0]) : undefined
}

export const antigravityAdapter: AgentAdapter = {
  id: 'antigravity',
  displayName: 'Antigravity CLI',

  normalize(raw, pid, ts) {
    if (!isRecord(raw)) return null
    const eventName = str(raw['hookEventName']) ?? str(raw['hook_event_name'])
    if (!eventName) return null
    const baseKind = KIND_BY_EVENT[eventName]
    if (!baseKind) return null

    const sessionId = str(raw['conversationId'])
    const cwd = firstWorkspacePath(raw['workspacePaths']) ?? str(raw['cwd'])
    if (!sessionId || !cwd) return null

    const error = str(raw['error'])

    return {
      agent: 'antigravity',
      kind: error ? 'error' : baseKind,
      sessionId,
      cwd,
      tool: str(raw['toolName']),
      detail: error ?? str(raw['command']),
      transcriptPath: str(raw['transcriptPath']),
      pid,
      ts,
    }
  },

  encodeDecision(d: Decision) {
    if (d.kind === 'fallthrough') return {}
    return {
      permissionDecision: d.kind,
      permissionDecisionReason:
        d.reason ?? (d.kind === 'allow' ? 'Allowed from Dasbo Island' : 'Denied from Dasbo Island'),
    }
  },
}
```

- [ ] **Step 8: Run every core test**

Run: `npx vitest run && npm run typecheck`
Expected: all suites PASS, `tsc` silent.

- [ ] **Step 9: Commit**

```bash
git add src/core/adapters test/core/adapters
git commit -m "feat(core): add Codex and Antigravity adapters with dispatch"
```

---

## Task 6: Permission table with injected clock

**Files:**
- Create: `src/core/permissions.ts`
- Test: `test/core/permissions.test.ts`

**Interfaces:**
- Consumes: `Decision`, `PendingPermission`, `SessionStore`.
- Produces: `class PermissionTable` with:
  - `constructor(store: SessionStore, timers: Timers)`
  - `interface Timers { now(): number; setTimeout(fn: () => void, ms: number): number; clearTimeout(id: number): void }`
  - `request(args: {sessionKey: string; tool: string; detail?: string; timeoutSeconds: number}, resolve: (d: Decision) => void): string` returning the permission id
  - `resolve(id: string, d: Decision): void`
  - `resolveAllFallthrough(): void`
  - `isAlwaysAllowed(sessionKey: string, tool: string): boolean`
  - `grantAlways(sessionKey: string, tool: string): void`
  - `pendingCount(): number`

- [ ] **Step 1: Write the failing test**

`test/core/permissions.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { SessionStore } from '../../src/core/store.js'
import { PermissionTable, type Timers } from '../../src/core/permissions.js'
import type { AgentEvent, Decision } from '../../src/core/types.js'

function fakeTimers() {
  let now = 0
  let nextId = 1
  const scheduled = new Map<number, { at: number; fn: () => void }>()
  const timers: Timers = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = nextId++
      scheduled.set(id, { at: now + ms, fn })
      return id
    },
    clearTimeout: (id) => { scheduled.delete(id) },
  }
  const advance = (ms: number) => {
    now += ms
    for (const [id, t] of [...scheduled]) {
      if (t.at <= now) { scheduled.delete(id); t.fn() }
    }
  }
  return { timers, advance, pendingTimers: () => scheduled.size }
}

function seeded(): SessionStore {
  const s = new SessionStore()
  const e: AgentEvent = {
    agent: 'claude', kind: 'session-start', sessionId: 's1',
    cwd: '/p/app', pid: 10, ts: 0,
  }
  s.apply(e)
  return s
}

describe('PermissionTable', () => {
  it('puts the session into waiting while a request is open', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    t.request({ sessionKey: 'claude:s1', tool: 'Bash', detail: 'rm -rf build', timeoutSeconds: 30 }, () => {})
    expect(store.get('claude:s1')!.state).toBe('waiting')
    expect(t.pendingCount()).toBe(1)
  })

  it('resolves with the user decision and clears the pending state', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    const seen: Decision[] = []
    const id = t.request({ sessionKey: 'claude:s1', tool: 'Bash', timeoutSeconds: 30 }, (d) => seen.push(d))
    t.resolve(id, { kind: 'allow' })
    expect(seen).toEqual([{ kind: 'allow' }])
    expect(store.get('claude:s1')!.state).toBe('idle')
    expect(t.pendingCount()).toBe(0)
  })

  it('resolves fallthrough when the timeout elapses', () => {
    const store = seeded()
    const { timers, advance } = fakeTimers()
    const t = new PermissionTable(store, timers)
    const seen: Decision[] = []
    t.request({ sessionKey: 'claude:s1', tool: 'Bash', timeoutSeconds: 30 }, (d) => seen.push(d))
    advance(29_999)
    expect(seen).toHaveLength(0)
    advance(2)
    expect(seen).toEqual([{ kind: 'fallthrough', reason: 'Timed out' }])
    expect(t.pendingCount()).toBe(0)
  })

  it('never times out when timeoutSeconds is zero', () => {
    const store = seeded()
    const { timers, advance, pendingTimers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    const seen: Decision[] = []
    t.request({ sessionKey: 'claude:s1', tool: 'Bash', timeoutSeconds: 0 }, (d) => seen.push(d))
    expect(pendingTimers()).toBe(0)
    advance(24 * 60 * 60 * 1000)
    expect(seen).toHaveLength(0)
    expect(t.pendingCount()).toBe(1)
  })

  it('cancels the timer once a decision arrives', () => {
    const store = seeded()
    const { timers, advance, pendingTimers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    const seen: Decision[] = []
    const id = t.request({ sessionKey: 'claude:s1', tool: 'Bash', timeoutSeconds: 30 }, (d) => seen.push(d))
    t.resolve(id, { kind: 'deny', reason: 'no' })
    expect(pendingTimers()).toBe(0)
    advance(60_000)
    expect(seen).toHaveLength(1)
  })

  it('ignores a second resolve for the same id', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    const seen: Decision[] = []
    const id = t.request({ sessionKey: 'claude:s1', tool: 'Bash', timeoutSeconds: 30 }, (d) => seen.push(d))
    t.resolve(id, { kind: 'allow' })
    t.resolve(id, { kind: 'deny' })
    expect(seen).toHaveLength(1)
  })

  it('resolveAllFallthrough drains everything, for disable()', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    const seen: Decision[] = []
    t.request({ sessionKey: 'claude:s1', tool: 'Bash', timeoutSeconds: 30 }, (d) => seen.push(d))
    t.request({ sessionKey: 'claude:s1', tool: 'Edit', timeoutSeconds: 30 }, (d) => seen.push(d))
    t.resolveAllFallthrough()
    expect(seen).toHaveLength(2)
    expect(seen.every((d) => d.kind === 'fallthrough')).toBe(true)
    expect(t.pendingCount()).toBe(0)
  })

  it('grantAlways is per session and per tool, and is not global', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    expect(t.isAlwaysAllowed('claude:s1', 'Bash')).toBe(false)
    t.grantAlways('claude:s1', 'Bash')
    expect(t.isAlwaysAllowed('claude:s1', 'Bash')).toBe(true)
    expect(t.isAlwaysAllowed('claude:s1', 'Edit')).toBe(false)
    expect(t.isAlwaysAllowed('claude:other', 'Bash')).toBe(false)
  })

  it('resolves immediately without a pending row when the tool is always allowed', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    t.grantAlways('claude:s1', 'Bash')
    const seen: Decision[] = []
    t.request({ sessionKey: 'claude:s1', tool: 'Bash', timeoutSeconds: 30 }, (d) => seen.push(d))
    expect(seen).toEqual([{ kind: 'allow', reason: 'Always allowed for this session' }])
    expect(t.pendingCount()).toBe(0)
    expect(store.get('claude:s1')!.state).not.toBe('waiting')
  })

  it('resolves fallthrough immediately for an unknown session', () => {
    const store = seeded()
    const { timers } = fakeTimers()
    const t = new PermissionTable(store, timers)
    const seen: Decision[] = []
    t.request({ sessionKey: 'claude:ghost', tool: 'Bash', timeoutSeconds: 30 }, (d) => seen.push(d))
    expect(seen).toEqual([{ kind: 'fallthrough', reason: 'Unknown session' }])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/core/permissions.test.ts`
Expected: FAIL — cannot resolve `src/core/permissions.js`.

- [ ] **Step 3: Write `src/core/permissions.ts`**

```ts
import type { SessionStore } from './store.js'
import type { Decision } from './types.js'

/** Injected so tests advance time rather than sleeping, and so the shell layer can use GLib. */
export interface Timers {
  now(): number
  setTimeout(fn: () => void, ms: number): number
  clearTimeout(id: number): void
}

interface PendingEntry {
  id: string
  sessionKey: string
  resolve: (d: Decision) => void
  timerId?: number
}

export interface PermissionRequest {
  sessionKey: string
  tool: string
  detail?: string
  timeoutSeconds: number
}

export class PermissionTable {
  private pending = new Map<string, PendingEntry>()
  private always = new Map<string, Set<string>>()
  private counter = 0

  constructor(private store: SessionStore, private timers: Timers) {}

  pendingCount(): number {
    return this.pending.size
  }

  isAlwaysAllowed(sessionKey: string, tool: string): boolean {
    return this.always.get(sessionKey)?.has(tool) ?? false
  }

  grantAlways(sessionKey: string, tool: string): void {
    let set = this.always.get(sessionKey)
    if (!set) {
      set = new Set<string>()
      this.always.set(sessionKey, set)
    }
    set.add(tool)
  }

  request(req: PermissionRequest, resolve: (d: Decision) => void): string {
    const id = `perm-${++this.counter}`

    if (!this.store.get(req.sessionKey)) {
      resolve({ kind: 'fallthrough', reason: 'Unknown session' })
      return id
    }

    if (this.isAlwaysAllowed(req.sessionKey, req.tool)) {
      resolve({ kind: 'allow', reason: 'Always allowed for this session' })
      return id
    }

    const entry: PendingEntry = { id, sessionKey: req.sessionKey, resolve }
    this.pending.set(id, entry)

    const deadline =
      req.timeoutSeconds > 0 ? this.timers.now() + req.timeoutSeconds * 1000 : 0

    this.store.setPending(req.sessionKey, {
      id,
      tool: req.tool,
      detail: req.detail,
      deadline,
    })

    if (req.timeoutSeconds > 0) {
      entry.timerId = this.timers.setTimeout(
        () => this.finish(id, { kind: 'fallthrough', reason: 'Timed out' }),
        req.timeoutSeconds * 1000
      )
    }

    return id
  }

  resolve(id: string, d: Decision): void {
    this.finish(id, d)
  }

  resolveAllFallthrough(): void {
    for (const id of [...this.pending.keys()]) {
      this.finish(id, { kind: 'fallthrough', reason: 'Dasbo Island shutting down' })
    }
  }

  private finish(id: string, d: Decision): void {
    const entry = this.pending.get(id)
    if (!entry) return
    this.pending.delete(id)
    if (entry.timerId !== undefined) this.timers.clearTimeout(entry.timerId)
    this.store.clearPending(entry.sessionKey)
    entry.resolve(d)
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/core/permissions.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/permissions.ts test/core/permissions.test.ts
git commit -m "feat(core): add permission table with injected clock and fallthrough"
```

---

## Task 7: D-Bus service

**Files:**
- Create: `src/dbus/iface.ts`, `src/dbus/service.ts`, `src/shell/glibTimers.ts`
- Modify: `src/extension.ts`
- Create: `tools/fake-agent.js`

**Interfaces:**
- Consumes: `SessionStore`, `PermissionTable`, `Timers`, `normalizeFor`, `isAgentId`, `adapters`.
- Produces:
  - `IFACE_XML` from `src/dbus/iface.ts`
  - `class IslandService` from `src/dbus/service.ts` with `constructor(store, permissions, opts: {timeoutSeconds: () => number})`, `export(): void`, `unexport(): void`
  - `glibTimers: Timers` from `src/shell/glibTimers.ts`

- [ ] **Step 1: Write `src/dbus/iface.ts`**

```ts
export const BUS_NAME = 'org.dasbo.Island'
export const OBJECT_PATH = '/org/dasbo/Island'

export const IFACE_XML = `
<node>
  <interface name="org.dasbo.Island">
    <method name="Notify">
      <arg type="s" direction="in" name="agent"/>
      <arg type="s" direction="in" name="payloadJson"/>
      <arg type="i" direction="in" name="pid"/>
    </method>
    <method name="RequestPermission">
      <arg type="s" direction="in" name="agent"/>
      <arg type="s" direction="in" name="payloadJson"/>
      <arg type="i" direction="in" name="pid"/>
      <arg type="s" direction="out" name="decisionJson"/>
    </method>
    <method name="Ping">
      <arg type="s" direction="out" name="version"/>
    </method>
  </interface>
</node>
`
```

The hook cannot learn its own PID through D-Bus reliably, so it passes it explicitly as the third argument.

- [ ] **Step 2: Write `src/shell/glibTimers.ts`**

```ts
import GLib from 'gi://GLib'
import type { Timers } from '../core/permissions.js'

/** GLib-backed Timers. Every source id handed out must be released by clearTimeout. */
export const glibTimers: Timers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) =>
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
      fn()
      return GLib.SOURCE_REMOVE
    }),
  clearTimeout: (id) => {
    GLib.Source.remove(id)
  },
}
```

- [ ] **Step 3: Write `src/dbus/service.ts`**

```ts
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import { BUS_NAME, IFACE_XML, OBJECT_PATH } from './iface.js'
import { adapters, isAgentId, normalizeFor } from '../core/adapters/index.js'
import { sessionKey } from '../core/types.js'
import type { SessionStore } from '../core/store.js'
import type { PermissionTable } from '../core/permissions.js'

const VERSION = '0.1.0'

export interface ServiceOptions {
  /** Read live from GSettings on every request, so changes need no restart. */
  timeoutSeconds: () => number
  /** Called after a permission row appears, so the UI can pulse and auto-open. */
  onPermissionOpened: () => void
}

export class IslandService {
  private impl: Gio.DBusExportedObject | null = null
  private nameOwnerId = 0

  constructor(
    private store: SessionStore,
    private permissions: PermissionTable,
    private opts: ServiceOptions
  ) {}

  export(): void {
    this.impl = Gio.DBusExportedObject.wrapJSObject(IFACE_XML, this)
    this.impl.export(Gio.DBus.session, OBJECT_PATH)
    this.nameOwnerId = Gio.bus_own_name(
      Gio.BusType.SESSION,
      BUS_NAME,
      Gio.BusNameOwnerFlags.NONE,
      null,
      null,
      () => {
        console.warn(`dasbo-island: could not own ${BUS_NAME}; another instance may be running`)
      }
    )
  }

  unexport(): void {
    if (this.nameOwnerId) {
      Gio.bus_unown_name(this.nameOwnerId)
      this.nameOwnerId = 0
    }
    this.impl?.unexport()
    this.impl = null
  }

  Ping(): string {
    return VERSION
  }

  Notify(agent: string, payloadJson: string, pid: number): void {
    if (!isAgentId(agent)) return
    let raw: unknown
    try {
      raw = JSON.parse(payloadJson)
    } catch {
      console.warn(`dasbo-island: unparseable payload from ${agent}`)
      return
    }
    const event = normalizeFor(agent, raw, pid, Date.now())
    if (!event) return
    this.store.apply(event)
  }

  /**
   * GJS calls the *Async form with the invocation object, letting us reply later.
   * The reply is held until the user clicks or the permission table times out.
   */
  RequestPermissionAsync(
    params: [string, string, number],
    invocation: Gio.DBusMethodInvocation
  ): void {
    const [agent, payloadJson, pid] = params
    const reply = (json: string) => {
      invocation.return_value(new GLib.Variant('(s)', [json]))
    }

    if (!isAgentId(agent)) return reply('{}')

    let raw: unknown
    try {
      raw = JSON.parse(payloadJson)
    } catch {
      return reply('{}')
    }

    const adapter = adapters[agent]
    const event = normalizeFor(agent, raw, pid, Date.now())
    if (!event) return reply(JSON.stringify(adapter.encodeDecision({ kind: 'fallthrough' })))

    // Register the session first so the permission has a row to attach to.
    this.store.apply(event)
    const key = sessionKey(event.agent, event.sessionId)

    this.permissions.request(
      {
        sessionKey: key,
        tool: event.tool ?? 'unknown',
        detail: event.detail,
        timeoutSeconds: this.opts.timeoutSeconds(),
      },
      (decision) => reply(JSON.stringify(adapter.encodeDecision(decision)))
    )

    if (this.store.get(key)?.pendingPermission) this.opts.onPermissionOpened()
  }
}
```

- [ ] **Step 4: Wire the service into `src/extension.ts`**

Replace the whole file:

```ts
import St from 'gi://St'
import GLib from 'gi://GLib'
import GObject from 'gi://GObject'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'
import { SessionStore } from './core/store.js'
import { PermissionTable } from './core/permissions.js'
import { glibTimers } from './shell/glibTimers.js'
import { IslandService } from './dbus/service.js'

const Island = GObject.registerClass(
  class Island extends PanelMenu.Button {
    _label!: St.Label
    constructor() {
      super(0.5, 'Dasbo Island')
      const box = new St.BoxLayout({ style_class: 'dasbo-pill' })
      box.add_child(new St.Widget({ style_class: 'dasbo-dot', y_align: 2 }))
      this._label = new St.Label({ text: '0', style_class: 'dasbo-pill-label', y_align: 2 })
      box.add_child(this._label)
      this.add_child(box)
    }
    setText(t: string) { this._label.text = t }
  }
)

export default class DasboIslandExtension extends Extension {
  private _island: InstanceType<typeof Island> | null = null
  private _store: SessionStore | null = null
  private _permissions: PermissionTable | null = null
  private _service: IslandService | null = null
  private _unsubscribe: (() => void) | null = null

  enable() {
    const settings = this.getSettings()
    this._store = new SessionStore()
    this._permissions = new PermissionTable(this._store, glibTimers)
    this._island = new Island()
    Main.panel.addToStatusArea(this.uuid, this._island, 0, 'center')

    this._unsubscribe = this._store.subscribe(() => {
      const n = this._store!.list().length
      this._island?.setText(`${n} · ${this._store!.worstState()}`)
    })

    this._service = new IslandService(this._store, this._permissions, {
      timeoutSeconds: () => settings.get_int('permission-timeout'),
      onPermissionOpened: () => {},
    })
    this._service.export()
  }

  disable() {
    this._service?.unexport()
    this._service = null
    this._permissions?.resolveAllFallthrough()
    this._permissions = null
    this._unsubscribe?.()
    this._unsubscribe = null
    this._island?.destroy()
    this._island = null
    this._store = null
  }
}
```

`GLib` is imported here for later tasks; if `tsc` flags it as unused, remove the import and re-add it in Task 10.

- [ ] **Step 5: Write `tools/fake-agent.js`**

```js
#!/usr/bin/gjs -m
// Drives the extension over D-Bus without running a real agent.
// Usage: tools/fake-agent.js session|tool|perm
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

const BUS = 'org.dasbo.Island'
const PATH = '/org/dasbo/Island'
const IFACE = 'org.dasbo.Island'

const mode = ARGV[0] ?? 'session'
const FAKE_PID = 4242

const payloads = {
  session: { hook_event_name: 'SessionStart', session_id: 'fake-1', cwd: GLib.get_current_dir() },
  tool: {
    hook_event_name: 'PreToolUse', session_id: 'fake-1', cwd: GLib.get_current_dir(),
    tool_name: 'Edit', tool_input: { file_path: '/tmp/main.js' },
  },
  perm: {
    hook_event_name: 'PreToolUse', session_id: 'fake-1', cwd: GLib.get_current_dir(),
    tool_name: 'Bash', tool_input: { command: 'rm -rf build' },
  },
}

const payload = JSON.stringify(payloads[mode] ?? payloads.session)
const method = mode === 'perm' ? 'RequestPermission' : 'Notify'
const args = new GLib.Variant('(ssi)', ['claude', payload, FAKE_PID])
const replyType = mode === 'perm' ? new GLib.VariantType('(s)') : null

const res = Gio.DBus.session.call_sync(
  BUS, PATH, IFACE, method, args, replyType, Gio.DBusCallFlags.NONE, 2147483647, null
)
print(`${method} returned ${res.print(true)}`)
```

Make it executable:
```bash
chmod +x tools/fake-agent.js
```

- [ ] **Step 6: Build, install, and verify the service answers**

Run:
```bash
make install
```
Then restart the shell — on X11 press `Alt+F2`, type `r`, press Enter; on Wayland log out and back in. Then:
```bash
gdbus call --session --dest org.dasbo.Island --object-path /org/dasbo/Island --method org.dasbo.Island.Ping
```
Expected: `('0.1.0',)`

- [ ] **Step 7: Verify events reach the store**

Run:
```bash
tools/fake-agent.js session && tools/fake-agent.js tool
```
Expected: the pill text changes to `1 · running`. If it does not, run `journalctl -f -o cat /usr/bin/gnome-shell` in another terminal and repeat.

- [ ] **Step 8: Verify a permission request blocks and then times out**

Run:
```bash
time tools/fake-agent.js perm
```
Expected: the command blocks for roughly 30 seconds, then prints a decision containing `"permissionDecision": "ask"`. This confirms the held invocation, the GLib timer, and the fallthrough encoding all work end to end.

- [ ] **Step 9: Commit**

```bash
git add src/dbus src/shell/glibTimers.ts src/extension.ts tools/fake-agent.js
git commit -m "feat(dbus): export org.dasbo.Island with held permission replies"
```

---

## Task 8: The `dasbo-hook` GJS helper

**Files:**
- Create: `hooks/dasbo-hook`
- Modify: `build.mjs` (remove the `.catch` on the hooks copy)
- Test: manual, driven by `test/fixtures/`

**Interfaces:**
- Consumes: the D-Bus interface from Task 7.
- Produces: an executable at `<extension dir>/hooks/dasbo-hook`, invoked as `dasbo-hook <agent> <notify|permission>`.

- [ ] **Step 1: Write `hooks/dasbo-hook`**

```js
#!/usr/bin/gjs -m
// Dasbo Island hook helper.
// Usage: dasbo-hook <claude|codex|antigravity> <notify|permission>
// Reads one JSON payload on stdin. In permission mode writes the agent's
// decision JSON to stdout. Every failure path exits 0 with empty stdout so the
// calling agent is never affected by this extension being absent or broken.

import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

const BUS_NAME = 'org.dasbo.Island'
const OBJECT_PATH = '/org/dasbo/Island'
const IFACE = 'org.dasbo.Island'
// G_MAXINT means "no timeout" to GDBus. The extension owns timeout policy.
const NO_TIMEOUT = 2147483647

function readStdin() {
  const stream = new Gio.DataInputStream({
    base_stream: new Gio.UnixInputStream({ fd: 0, close_fd: false }),
  })
  let out = ''
  for (;;) {
    const [line] = stream.read_line_utf8(null)
    if (line === null) break
    out += line + '\n'
  }
  return out
}

function main() {
  const agent = ARGV[0]
  const mode = ARGV[1] ?? 'notify'
  if (!agent) return

  let payload
  try {
    payload = readStdin()
    if (!payload.trim()) return
    JSON.parse(payload) // validate before sending; malformed input is dropped here
  } catch {
    return
  }

  const args = new GLib.Variant('(ssi)', [agent, payload, getPid()])

  if (mode === 'permission') {
    const reply = Gio.DBus.session.call_sync(
      BUS_NAME, OBJECT_PATH, IFACE, 'RequestPermission',
      args, new GLib.VariantType('(s)'), Gio.DBusCallFlags.NONE, NO_TIMEOUT, null
    )
    const [decisionJson] = reply.deepUnpack()
    if (decisionJson && decisionJson !== '{}') print(decisionJson)
  } else {
    Gio.DBus.session.call_sync(
      BUS_NAME, OBJECT_PATH, IFACE, 'Notify',
      args, null, Gio.DBusCallFlags.NONE, 5000, null
    )
  }
}

function getPid() {
  // GLib has no getpid binding in GJS; read it from /proc/self.
  try {
    const target = Gio.File.new_for_path('/proc/self').query_info(
      'standard::symlink-target', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null
    ).get_symlink_target()
    const n = parseInt(target ?? '', 10)
    if (Number.isFinite(n)) return n
  } catch { /* fall through */ }
  try {
    const [ok, bytes] = GLib.file_get_contents('/proc/self/stat')
    if (ok) {
      const n = parseInt(new TextDecoder().decode(bytes).split(' ')[0], 10)
      if (Number.isFinite(n)) return n
    }
  } catch { /* fall through */ }
  return 0
}

try {
  main()
} catch {
  // Fail open. No stdout, no stderr, exit 0.
}
```

- [ ] **Step 2: Make it executable and drop the build catch**

```bash
chmod +x hooks/dasbo-hook
```

In `build.mjs`, change:
```js
await cp('hooks', 'dist/hooks', { recursive: true }).catch(() => {})
```
to:
```js
await cp('hooks', 'dist/hooks', { recursive: true })
```

- [ ] **Step 3: Verify the fail-open path with no extension running**

Run:
```bash
gnome-extensions disable dasbo-island@ayubaswad.gmail.com
echo '{"hook_event_name":"SessionStart","session_id":"h1","cwd":"/tmp"}' | ./hooks/dasbo-hook claude notify; echo "exit=$?"
```
Expected: `exit=0`, no output at all. This is the single most important behaviour in the project — an agent must never break because the island is off.

- [ ] **Step 4: Verify notify reaches the running extension**

Run:
```bash
gnome-extensions enable dasbo-island@ayubaswad.gmail.com
echo '{"hook_event_name":"SessionStart","session_id":"h1","cwd":"/home/me/projects/demo"}' | ./hooks/dasbo-hook claude notify
```
Expected: exit 0, no output, and the pill updates to show one session.

- [ ] **Step 5: Verify the permission round trip**

Run:
```bash
echo '{"hook_event_name":"PreToolUse","session_id":"h1","cwd":"/home/me/projects/demo","tool_name":"Bash","tool_input":{"command":"rm -rf build"}}' \
  | ./hooks/dasbo-hook claude permission
```
Expected: blocks about 30 seconds, then prints one line of JSON containing `"permissionDecision": "ask"`. Exit code 0.

- [ ] **Step 6: Verify malformed input is dropped silently**

Run:
```bash
echo 'this is not json' | ./hooks/dasbo-hook claude permission; echo "exit=$?"
printf '' | ./hooks/dasbo-hook claude notify; echo "exit=$?"
```
Expected: `exit=0` twice, no output either time.

- [ ] **Step 7: Replay every captured fixture through the hook**

Run:
```bash
for f in test/fixtures/claude/*.json; do ./hooks/dasbo-hook claude notify < "$f" || echo "FAILED on $f"; done
```
Expected: no `FAILED` lines. Sessions from the fixtures appear in the pill count.

- [ ] **Step 8: Commit**

```bash
git add hooks/dasbo-hook build.mjs
git commit -m "feat(hooks): add fail-open GJS hook helper"
```

---

## Task 9: The pill — states, counts, hiding, settings-driven placement

**Files:**
- Create: `src/shell/island.ts`
- Modify: `src/extension.ts`, `stylesheet.css`
- Test: manual via `tools/fake-agent.js`

**Interfaces:**
- Consumes: `SessionStore`, `Session`, `SessionState`.
- Produces: `class Island extends PanelMenu.Button` from `src/shell/island.ts`, constructed as `new Island(store, settings)`, with methods `refresh(): void`, `destroy(): void`. Task 10 adds `_rebuildRows()` to the same class.

- [ ] **Step 1: Create `src/shell/island.ts`**

```ts
import St from 'gi://St'
import Clutter from 'gi://Clutter'
import GObject from 'gi://GObject'
import type Gio from 'gi://Gio'
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import type { SessionStore } from '../core/store.js'
import type { SessionState } from '../core/types.js'

const STATE_CLASS: Record<SessionState, string> = {
  idle: '',
  running: 'state-running',
  waiting: 'state-waiting',
  error: 'state-error',
  done: 'state-done',
}

const STATE_WORD: Record<SessionState, string> = {
  idle: 'idle',
  running: 'working',
  waiting: 'waiting',
  error: 'error',
  done: 'done',
}

export const Island = GObject.registerClass(
  class Island extends PanelMenu.Button {
    private _store!: SessionStore
    private _settings!: Gio.Settings
    private _dot!: St.Widget
    private _label!: St.Label
    private _unsubscribe: (() => void) | null = null

    constructor(store: SessionStore, settings: Gio.Settings) {
      super(0.5, 'Dasbo Island')
      this._store = store
      this._settings = settings

      const box = new St.BoxLayout({ style_class: 'dasbo-pill' })
      this._dot = new St.Widget({
        style_class: 'dasbo-dot',
        y_align: Clutter.ActorAlign.CENTER,
      })
      this._label = new St.Label({
        text: '',
        style_class: 'dasbo-pill-label',
        y_align: Clutter.ActorAlign.CENTER,
      })
      box.add_child(this._dot)
      box.add_child(this._label)
      this.add_child(box)

      this._unsubscribe = this._store.subscribe(() => this.refresh())
      this._settings.connect('changed::always-show', () => this.refresh())
      this.refresh()
    }

    refresh(): void {
      const sessions = this._store.list()
      const count = sessions.length

      if (count === 0 && !this._settings.get_boolean('always-show')) {
        this.visible = false
        return
      }
      this.visible = true

      const worst = count === 0 ? 'idle' : this._store.worstState()
      this._dot.style_class = `dasbo-dot ${STATE_CLASS[worst]}`.trim()

      if (count === 0) {
        this._label.text = 'idle'
      } else {
        this._label.text = `${count} · ${STATE_WORD[worst]}`
      }
    }

    destroy(): void {
      this._unsubscribe?.()
      this._unsubscribe = null
      super.destroy()
    }
  }
)
```

`this._settings.connect(...)` returns a handler id, but `Gio.Settings` is created fresh per `enable()` by `getSettings()` and released on `disable()`, so the connection dies with it. No explicit disconnect is needed here; the pattern is called out in Task 15's teardown audit.

- [ ] **Step 2: Use the real Island in `src/extension.ts`**

Replace the inline `Island` class and its usage:

```ts
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'
import { SessionStore } from './core/store.js'
import { PermissionTable } from './core/permissions.js'
import { glibTimers } from './shell/glibTimers.js'
import { IslandService } from './dbus/service.js'
import { Island } from './shell/island.js'

export default class DasboIslandExtension extends Extension {
  private _island: InstanceType<typeof Island> | null = null
  private _store: SessionStore | null = null
  private _permissions: PermissionTable | null = null
  private _service: IslandService | null = null

  enable() {
    const settings = this.getSettings()
    this._store = new SessionStore()
    this._store.doneLingerSeconds = settings.get_int('done-linger')
    this._permissions = new PermissionTable(this._store, glibTimers)
    this._island = new Island(this._store, settings)

    Main.panel.addToStatusArea(
      this.uuid,
      this._island,
      settings.get_int('panel-index'),
      settings.get_string('panel-position')
    )

    this._service = new IslandService(this._store, this._permissions, {
      timeoutSeconds: () => settings.get_int('permission-timeout'),
      onPermissionOpened: () => {},
    })
    this._service.export()
  }

  disable() {
    this._service?.unexport()
    this._service = null
    this._permissions?.resolveAllFallthrough()
    this._permissions = null
    this._island?.destroy()
    this._island = null
    this._store = null
  }
}
```

Changing `panel-position` or `panel-index` requires toggling the extension off and on; that is stated in the prefs UI in Task 14.

- [ ] **Step 3: Build, install and restart the shell**

Run:
```bash
make install
```
Then `Alt+F2`, `r`, Enter (X11).
Expected: with no sessions, **no pill is visible at all** in the top bar.

- [ ] **Step 4: Verify each state renders**

Run:
```bash
tools/fake-agent.js session   # expect: grey dot, "1 · idle"
tools/fake-agent.js tool      # expect: blue dot, "1 · working"
```
Then check the amber state:
```bash
tools/fake-agent.js perm &
sleep 1
```
Expected: amber dot, `1 · waiting`. After roughly 30 seconds it returns to `1 · working` or `1 · idle`.

- [ ] **Step 5: Verify always-show and placement settings**

Run:
```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/dasbo-island@ayubaswad.gmail.com/schemas \
  set org.gnome.shell.extensions.dasbo-island always-show true
```
Expected: the pill appears immediately showing `idle`, with no shell restart. Set it back to `false` and confirm it disappears.

- [ ] **Step 6: Commit**

```bash
git add src/shell/island.ts src/extension.ts
git commit -m "feat(ui): add state-aware pill with hide-when-empty and panel placement"
```

---

## Task 10: Session rows and the single popup timer

**Files:**
- Create: `src/shell/sessionRow.ts`
- Modify: `src/shell/island.ts`
- Test: `test/core/format.test.ts` for the pure formatting helper, manual for the rest

**Interfaces:**
- Consumes: `Session` from core, `Island` from Task 9.
- Produces:
  - `formatElapsed(ms: number): string` exported from `src/core/format.ts`
  - `class SessionRow extends PopupMenu.PopupBaseMenuItem` from `src/shell/sessionRow.ts`, constructed as `new SessionRow(session, { onJump: (s: Session) => void })`, with `update(session: Session): void` and `tick(now: number): void`
  - `Island._rebuildRows()` and `Island._startTimer()` / `Island._stopTimer()`

- [ ] **Step 1: Write the failing formatting test**

`test/core/format.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatElapsed } from '../../src/core/format.js'

describe('formatElapsed', () => {
  it('formats under an hour as mm:ss', () => {
    expect(formatElapsed(0)).toBe('00:00')
    expect(formatElapsed(42_000)).toBe('00:42')
    expect(formatElapsed(61_000)).toBe('01:01')
    expect(formatElapsed(59 * 60_000 + 59_000)).toBe('59:59')
  })

  it('formats an hour or more as h:mm:ss', () => {
    expect(formatElapsed(3_600_000)).toBe('1:00:00')
    expect(formatElapsed(3_600_000 + 125_000)).toBe('1:02:05')
  })

  it('clamps negative input to zero', () => {
    expect(formatElapsed(-5000)).toBe('00:00')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/core/format.test.ts`
Expected: FAIL — cannot resolve `src/core/format.js`.

- [ ] **Step 3: Write `src/core/format.ts`**

```ts
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run test/core/format.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write `src/shell/sessionRow.ts`**

```ts
import St from 'gi://St'
import Clutter from 'gi://Clutter'
import GObject from 'gi://GObject'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'
import { formatElapsed } from '../core/format.js'
import type { Session, SessionState } from '../core/types.js'

const STATE_CLASS: Record<SessionState, string> = {
  idle: '',
  running: 'state-running',
  waiting: 'state-waiting',
  error: 'state-error',
  done: 'state-done',
}

export interface SessionRowCallbacks {
  onJump: (session: Session) => void
}

export const SessionRow = GObject.registerClass(
  class SessionRow extends PopupMenu.PopupBaseMenuItem {
    private _session!: Session
    private _cb!: SessionRowCallbacks
    private _dot!: St.Widget
    private _project!: St.Label
    private _activity!: St.Label
    private _elapsed!: St.Label
    private _jump!: St.Button
    private _actionBox!: St.BoxLayout

    constructor(session: Session, cb: SessionRowCallbacks) {
      super({ reactive: false, can_focus: false, style_class: 'dasbo-row' })
      this._session = session
      this._cb = cb

      const outer = new St.BoxLayout({ x_expand: true, style_class: 'dasbo-row-outer' })

      const textCol = new St.BoxLayout({ vertical: true, x_expand: true })
      this._project = new St.Label({ text: session.project, style_class: 'dasbo-row-project' })

      const activityRow = new St.BoxLayout({ style_class: 'dasbo-pill' })
      this._dot = new St.Widget({ style_class: 'dasbo-dot', y_align: Clutter.ActorAlign.CENTER })
      this._activity = new St.Label({ text: '', style_class: 'dasbo-row-activity',
        y_align: Clutter.ActorAlign.CENTER })
      activityRow.add_child(this._dot)
      activityRow.add_child(this._activity)

      textCol.add_child(this._project)
      textCol.add_child(activityRow)

      this._elapsed = new St.Label({ text: '00:00', style_class: 'dasbo-row-elapsed',
        y_align: Clutter.ActorAlign.CENTER })

      this._jump = new St.Button({ label: 'Jump', style_class: 'button dasbo-jump',
        y_align: Clutter.ActorAlign.CENTER })
      this._jump.connect('clicked', () => this._cb.onJump(this._session))

      this._actionBox = new St.BoxLayout({ style_class: 'dasbo-row-actions' })
      this._actionBox.add_child(this._elapsed)
      this._actionBox.add_child(this._jump)

      outer.add_child(textCol)
      outer.add_child(this._actionBox)
      this.add_child(outer)

      this.update(session)
    }

    /** Where Task 11 inserts the Allow / Deny controls. */
    get actionBox(): St.BoxLayout {
      return this._actionBox
    }

    get session(): Session {
      return this._session
    }

    update(session: Session): void {
      this._session = session
      this._project.text = session.project
      this._dot.style_class = `dasbo-dot ${STATE_CLASS[session.state]}`.trim()

      const tool = session.currentTool
      const detail = session.detail
      this._activity.text =
        session.state === 'waiting' ? 'waiting for you'
        : tool && detail ? `${tool} · ${detail}`
        : tool ? tool
        : session.state
    }

    /** Called once per second by the Island while the popup is open. */
    tick(now: number): void {
      this._elapsed.text = formatElapsed(now - this._session.startedAt)
    }

    /** Hide the jump button when no window can own this session. */
    setJumpEnabled(enabled: boolean): void {
      this._jump.reactive = enabled
      this._jump.opacity = enabled ? 255 : 128
    }

    showTransient(text: string): void {
      this._activity.text = text
    }
  }
)
```

- [ ] **Step 6: Add row management to `src/shell/island.ts`**

Add these imports at the top:

```ts
import GLib from 'gi://GLib'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'
import { SessionRow } from './sessionRow.js'
import type { Session } from '../core/types.js'
```

Add these fields to the class:

```ts
    private _rows = new Map<string, InstanceType<typeof SessionRow>>()
    private _timerId = 0
    private _onJump: (s: Session) => void = () => {}
```

Extend the constructor — after `this._unsubscribe = ...` and before `this.refresh()`:

```ts
      this.menu.connect('open-state-changed', (_menu: unknown, open: boolean) => {
        if (open) this._startTimer()
        else this._stopTimer()
      })
```

Add a setter and the row/timer methods to the class:

```ts
    setJumpHandler(fn: (s: Session) => void): void {
      this._onJump = fn
    }

    private _startTimer(): void {
      if (this._timerId) return
      this._tickAll()
      this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
        this._tickAll()
        return GLib.SOURCE_CONTINUE
      })
    }

    private _stopTimer(): void {
      if (!this._timerId) return
      GLib.Source.remove(this._timerId)
      this._timerId = 0
    }

    private _tickAll(): void {
      const now = Date.now()
      for (const row of this._rows.values()) row.tick(now)
    }

    private _rebuildRows(): void {
      const sessions = this._store.list()
      const live = new Set(sessions.map((s) => s.key))

      for (const [key, row] of [...this._rows]) {
        if (!live.has(key)) {
          row.destroy()
          this._rows.delete(key)
        }
      }

      for (const s of sessions) {
        const existing = this._rows.get(s.key)
        if (existing) {
          existing.update(s)
        } else {
          const row = new SessionRow(s, { onJump: (sess) => this._onJump(sess) })
          this._rows.set(s.key, row)
          this.menu.addMenuItem(row)
        }
      }
    }
```

Call `this._rebuildRows()` as the first line of `refresh()`, and extend `destroy()`:

```ts
    destroy(): void {
      this._stopTimer()
      this._unsubscribe?.()
      this._unsubscribe = null
      for (const row of this._rows.values()) row.destroy()
      this._rows.clear()
      super.destroy()
    }
```

- [ ] **Step 7: Add row styling to `stylesheet.css`**

Append:

```css
.dasbo-row-outer { spacing: 12px; }
.dasbo-row-actions { spacing: 8px; }
.dasbo-jump { padding: 2px 10px; }
.dasbo-perm-actions { spacing: 6px; }
```

- [ ] **Step 8: Verify rows and the timer**

Run:
```bash
make install
```
Restart the shell, then:
```bash
tools/fake-agent.js session && tools/fake-agent.js tool
```
Click the pill. Expected: one row showing the project name, `Edit · /tmp/main.js`, a `00:0x` counter incrementing once per second, and a `Jump` button.

Close the popup, wait 30 seconds, reopen it. Expected: the counter jumps forward to the correct total — proving the timer stopped while closed and resumed on open.

- [ ] **Step 9: Verify rows are removed when sessions end**

Run:
```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/dasbo-island@ayubaswad.gmail.com/schemas \
  set org.gnome.shell.extensions.dasbo-island always-show true
```
Then send a stop event:
```bash
echo '{"hook_event_name":"Stop","session_id":"fake-1","cwd":"/tmp"}' | ./hooks/dasbo-hook claude notify
```
Expected: the row shows the done state. It is not yet auto-removed — the reaper arrives in Task 15. Confirm the row's dot turns green.

- [ ] **Step 10: Commit**

```bash
git add src/core/format.ts src/shell/sessionRow.ts src/shell/island.ts stylesheet.css test/core/format.test.ts
git commit -m "feat(ui): add session rows with a single shared popup timer"
```

---

## Task 11: Permission controls, amber pulse, auto-open

**Files:**
- Create: `src/shell/permissionRow.ts`
- Modify: `src/shell/island.ts`, `src/extension.ts`, `stylesheet.css`
- Test: manual via `tools/fake-agent.js perm`

**Interfaces:**
- Consumes: `SessionRow.actionBox`, `PermissionTable.resolve`, `PermissionTable.grantAlways`, `Session.pendingPermission`.
- Produces:
  - `class PermissionControls` from `src/shell/permissionRow.ts`, constructed as `new PermissionControls({ onAllow, onDeny, onAlways })`, with `attachTo(box: St.BoxLayout)`, `detach()`
  - `Island.setPermissionHandlers({ resolve, grantAlways })`, `Island.notifyPermissionOpened()`

- [ ] **Step 1: Write `src/shell/permissionRow.ts`**

```ts
import St from 'gi://St'
import Clutter from 'gi://Clutter'

export interface PermissionCallbacks {
  onAllow: () => void
  onDeny: () => void
  onAlways: () => void
}

/**
 * The Allow / Deny / Always-allow control cluster.
 * Not a GObject class — it is a plain owner of three St.Buttons so it can be
 * attached to and detached from an existing SessionRow action box.
 */
export class PermissionControls {
  private box: St.BoxLayout
  private parent: St.BoxLayout | null = null

  constructor(cb: PermissionCallbacks) {
    this.box = new St.BoxLayout({ style_class: 'dasbo-perm-actions' })

    const mk = (label: string, cls: string, fn: () => void) => {
      const b = new St.Button({
        label,
        style_class: `button ${cls}`,
        y_align: Clutter.ActorAlign.CENTER,
      })
      b.connect('clicked', () => fn())
      return b
    }

    this.box.add_child(mk('Allow', 'dasbo-allow', cb.onAllow))
    this.box.add_child(mk('Deny', 'dasbo-deny', cb.onDeny))
    this.box.add_child(mk('Always', 'dasbo-always', cb.onAlways))
  }

  attachTo(parent: St.BoxLayout): void {
    if (this.parent) return
    this.parent = parent
    parent.add_child(this.box)
  }

  detach(): void {
    if (!this.parent) return
    this.parent.remove_child(this.box)
    this.parent = null
  }

  destroy(): void {
    this.detach()
    this.box.destroy()
  }
}
```

- [ ] **Step 2: Add the pulse and permission wiring to `src/shell/island.ts`**

Add imports:

```ts
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import { PermissionControls } from './permissionRow.js'
```

Add fields:

```ts
    private _controls = new Map<string, PermissionControls>()
    private _pulsing = false
    private _permHandlers: {
      resolve: (id: string, kind: 'allow' | 'deny') => void
      grantAllowAlways: (sessionKey: string, tool: string, id: string) => void
    } | null = null
```

Add methods:

```ts
    setPermissionHandlers(h: {
      resolve: (id: string, kind: 'allow' | 'deny') => void
      grantAllowAlways: (sessionKey: string, tool: string, id: string) => void
    }): void {
      this._permHandlers = h
    }

    /** Called by the D-Bus service after a permission row has been registered. */
    notifyPermissionOpened(): void {
      this._startPulse()
      if (!this._settings.get_boolean('auto-open-on-permission')) return
      if (Main.layoutManager.primaryMonitor?.inFullscreen) return
      this.menu.open(true)
    }

    private _startPulse(): void {
      if (this._pulsing) return
      this._pulsing = true
      this._pulseStep(false)
    }

    private _pulseStep(dim: boolean): void {
      if (!this._pulsing) return
      this._dot.ease({
        opacity: dim ? 255 : 90,
        duration: 600,
        mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
        onComplete: () => this._pulseStep(!dim),
      })
    }

    private _stopPulse(): void {
      if (!this._pulsing) return
      this._pulsing = false
      this._dot.remove_all_transitions()
      this._dot.opacity = 255
    }
```

In `_rebuildRows()`, after the `existing.update(s)` / new-row branch, add per-session permission control management:

```ts
      for (const s of sessions) {
        const row = this._rows.get(s.key)
        if (!row) continue
        const pending = s.pendingPermission
        const existingControls = this._controls.get(s.key)

        if (pending && !existingControls) {
          const controls = new PermissionControls({
            onAllow: () => this._permHandlers?.resolve(pending.id, 'allow'),
            onDeny: () => this._permHandlers?.resolve(pending.id, 'deny'),
            onAlways: () =>
              this._permHandlers?.grantAllowAlways(s.key, pending.tool, pending.id),
          })
          controls.attachTo(row.actionBox)
          this._controls.set(s.key, controls)
        } else if (!pending && existingControls) {
          existingControls.destroy()
          this._controls.delete(s.key)
        }
      }

      if (this._store.worstState() !== 'waiting') this._stopPulse()
```

Extend `destroy()`:

```ts
      this._stopPulse()
      for (const c of this._controls.values()) c.destroy()
      this._controls.clear()
```

- [ ] **Step 3: Wire the handlers in `src/extension.ts`**

Inside `enable()`, after the Island is created and added to the panel:

```ts
    this._island.setPermissionHandlers({
      resolve: (id, kind) => {
        this._permissions?.resolve(id, { kind })
      },
      grantAllowAlways: (sessionKey, tool, id) => {
        this._permissions?.grantAlways(sessionKey, tool)
        this._permissions?.resolve(id, { kind: 'allow', reason: 'Always allowed for this session' })
      },
    })
```

And change the service options:

```ts
      onPermissionOpened: () => this._island?.notifyPermissionOpened(),
```

- [ ] **Step 4: Add permission styling to `stylesheet.css`**

Append:

```css
.dasbo-allow  { padding: 2px 10px; }
.dasbo-deny   { padding: 2px 10px; }
.dasbo-always { padding: 2px 10px; font-size: 0.85em; }
```

- [ ] **Step 5: Verify auto-open, Allow, and Deny**

Run:
```bash
make install
```
Restart the shell, then:
```bash
tools/fake-agent.js session
tools/fake-agent.js perm
```
Expected: the popup opens by itself, the pill dot is amber and visibly pulsing, and the row shows `waiting for you` with `Allow`, `Deny` and `Always` buttons.

Click `Allow`. Expected: `fake-agent.js perm` returns immediately printing a decision containing `"permissionDecision": "allow"`, the pulse stops, and the buttons disappear.

Repeat and click `Deny`. Expected: the printed decision contains `"deny"`.

- [ ] **Step 6: Verify "Always" suppresses the next prompt for the same tool**

Run:
```bash
tools/fake-agent.js perm    # click Always
tools/fake-agent.js perm    # should return instantly, no UI
```
Expected: the second invocation returns immediately with `"allow"` and no row or buttons ever appear.

- [ ] **Step 7: Verify auto-open is suppressed in fullscreen**

Open any window fullscreen on the primary monitor (for example a video player, or press F11 in a browser), then run `tools/fake-agent.js perm`.
Expected: the popup does **not** open. The pill still pulses amber. Clicking the pill shows the buttons.

- [ ] **Step 8: Verify the setting disables auto-open**

Run:
```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/dasbo-island@ayubaswad.gmail.com/schemas \
  set org.gnome.shell.extensions.dasbo-island auto-open-on-permission false
tools/fake-agent.js perm
```
Expected: pulse only, no auto-open. Set it back to `true`.

- [ ] **Step 9: Commit**

```bash
git add src/shell/permissionRow.ts src/shell/island.ts src/extension.ts stylesheet.css
git commit -m "feat(ui): add inline permission controls with amber pulse and auto-open"
```

---

## Task 12: Jump back to the terminal window

**Files:**
- Create: `src/core/procParse.ts`, `src/shell/windowFinder.ts`
- Modify: `src/extension.ts`
- Test: `test/core/procParse.test.ts`, manual for the window activation

**Interfaces:**
- Consumes: `Session.pid`.
- Produces:
  - `parsePpid(statContent: string): number | null` from `src/core/procParse.ts`
  - `ancestorPids(pid: number, readStat: (pid: number) => string | null, maxDepth?: number): number[]` from the same file
  - `findWindowForPid(pid: number): Meta.Window | null` and `activateForPid(pid: number): boolean` from `src/shell/windowFinder.ts`

- [ ] **Step 1: Write the failing `/proc` parsing test**

`test/core/procParse.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ancestorPids, parsePpid } from '../../src/core/procParse.js'

describe('parsePpid', () => {
  it('reads the ppid field from a normal stat line', () => {
    expect(parsePpid('1234 (bash) S 1000 1234 1234 34816 ...')).toBe(1000)
  })

  it('survives a comm containing spaces and parentheses', () => {
    expect(parsePpid('4242 (my weird (proc)) S 99 4242 ...')).toBe(99)
  })

  it('returns null for junk', () => {
    expect(parsePpid('')).toBeNull()
    expect(parsePpid('no parens here')).toBeNull()
    expect(parsePpid('1234 (bash) S notanumber')).toBeNull()
  })
})

describe('ancestorPids', () => {
  const tree: Record<number, number> = { 500: 400, 400: 300, 300: 1, 1: 0 }
  const readStat = (pid: number) =>
    tree[pid] === undefined ? null : `${pid} (proc) S ${tree[pid]} rest`

  it('walks from the leaf up to init, including the leaf', () => {
    expect(ancestorPids(500, readStat)).toEqual([500, 400, 300, 1])
  })

  it('stops at an unreadable pid', () => {
    expect(ancestorPids(999, readStat)).toEqual([999])
  })

  it('respects the depth cap', () => {
    expect(ancestorPids(500, readStat, 2)).toEqual([500, 400])
  })

  it('stops on a cycle rather than looping forever', () => {
    const cyclic = (pid: number) => (pid === 7 ? '7 (a) S 8 x' : '8 (b) S 7 x')
    expect(ancestorPids(7, cyclic)).toEqual([7, 8])
  })

  it('returns an empty array for pid zero', () => {
    expect(ancestorPids(0, readStat)).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/core/procParse.test.ts`
Expected: FAIL — cannot resolve `src/core/procParse.js`.

- [ ] **Step 3: Write `src/core/procParse.ts`**

```ts
/**
 * Extract the parent pid from the contents of /proc/<pid>/stat.
 * The comm field is wrapped in parentheses and may itself contain spaces and
 * parentheses, so everything up to the LAST ')' is skipped.
 */
export function parsePpid(statContent: string): number | null {
  const close = statContent.lastIndexOf(')')
  if (close === -1) return null
  const rest = statContent.slice(close + 1).trim().split(/\s+/)
  // rest[0] is the state character, rest[1] is the ppid.
  const ppid = Number(rest[1])
  return Number.isInteger(ppid) ? ppid : null
}

/**
 * Walk from `pid` up the process tree, returning the chain including `pid` itself.
 * `readStat` is injected so this stays free of any filesystem dependency.
 */
export function ancestorPids(
  pid: number,
  readStat: (pid: number) => string | null,
  maxDepth = 20
): number[] {
  if (pid <= 0) return []
  const chain: number[] = []
  const seen = new Set<number>()
  let current = pid

  while (chain.length < maxDepth && current > 0 && !seen.has(current)) {
    chain.push(current)
    seen.add(current)
    const stat = readStat(current)
    if (stat === null) break
    const ppid = parsePpid(stat)
    if (ppid === null || ppid <= 1) {
      if (ppid === 1 && chain.length < maxDepth && !seen.has(1)) chain.push(1)
      break
    }
    current = ppid
  }

  return chain
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run test/core/procParse.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Write `src/shell/windowFinder.ts`**

```ts
import GLib from 'gi://GLib'
import type Meta from 'gi://Meta'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import { ancestorPids } from '../core/procParse.js'

function readStat(pid: number): string | null {
  try {
    const [ok, bytes] = GLib.file_get_contents(`/proc/${pid}/stat`)
    if (!ok) return null
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

export function pidAlive(pid: number): boolean {
  if (pid <= 0) return false
  return GLib.file_test(`/proc/${pid}`, GLib.FileTest.EXISTS)
}

/**
 * Find the window whose owning process is `pid` or one of its ancestors.
 * Deliberately synchronous: the reads are tiny, bounded at 20, and only happen
 * on an explicit user click.
 */
export function findWindowForPid(pid: number): Meta.Window | null {
  const chain = new Set(ancestorPids(pid, readStat))
  if (chain.size === 0) return null

  for (const actor of global.get_window_actors()) {
    const win = actor.get_meta_window()
    if (!win) continue
    const wpid = win.get_pid()
    if (wpid > 0 && chain.has(wpid)) return win
  }
  return null
}

export function activateForPid(pid: number): boolean {
  const win = findWindowForPid(pid)
  if (!win) return false
  Main.activateWindow(win)
  return true
}
```

- [ ] **Step 6: Wire the jump handler in `src/extension.ts`**

Add the import:

```ts
import { activateForPid } from './shell/windowFinder.js'
```

Inside `enable()`, after the Island is created:

```ts
    this._island.setJumpHandler((session) => {
      const ok = activateForPid(session.pid)
      if (!ok) this._island?.showJumpFailure(session.key)
    })
```

Add `showJumpFailure` to `src/shell/island.ts`:

```ts
    showJumpFailure(key: string): void {
      const row = this._rows.get(key)
      if (!row) return
      row.showTransient('no window')
      const id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
        const s = this._store.get(key)
        if (s) row.update(s)
        this._transientIds.delete(id)
        return GLib.SOURCE_REMOVE
      })
      this._transientIds.add(id)
    }
```

Add the tracking field, and clear it in `destroy()` so no source outlives the extension:

```ts
    private _transientIds = new Set<number>()
```

```ts
      for (const id of this._transientIds) GLib.Source.remove(id)
      this._transientIds.clear()
```

- [ ] **Step 7: Verify jump-back against a real agent**

Run:
```bash
make install
```
Restart the shell. Open a terminal — Ghostty, kitty, GNOME Terminal, whichever — and in it run:

```bash
echo '{"hook_event_name":"SessionStart","session_id":"jump-1","cwd":"'"$PWD"'"}' | \
  <REPO>/hooks/dasbo-hook claude notify
```

Now switch focus to a different window entirely, click the pill, and click `Jump` on the `jump-1` row.
Expected: the terminal window you ran the command in is raised and focused.

Repeat from at least two different terminal applications and from a VS Code integrated terminal, since the ancestry depth differs in each.

- [ ] **Step 8: Verify the no-window path**

Run the same command from a `tmux` session, or pipe it through `setsid`:
```bash
echo '{"hook_event_name":"SessionStart","session_id":"jump-2","cwd":"/tmp"}' | setsid <REPO>/hooks/dasbo-hook claude notify
```
Expected: clicking `Jump` on that row shows `no window` for two seconds, then reverts to the normal activity text. No crash, nothing in the journal.

- [ ] **Step 9: Commit**

```bash
git add src/core/procParse.ts src/shell/windowFinder.ts src/shell/island.ts src/extension.ts test/core/procParse.test.ts
git commit -m "feat(ui): add jump-back via /proc ancestry window matching"
```

---

## Task 13: Hook installer — pure planning plus disk application

**Files:**
- Create: `src/core/install/plan.ts`, `src/shell/applyEdits.ts`
- Test: `test/core/install/plan.test.ts`

**Interfaces:**
- Consumes: `FileEdit` from `src/core/types.ts`, the dialects recorded in `docs/agent-dialects.md`.
- Produces:
  - `interface InstallEnv { home: string; hookPath: string; existing: (path: string) => string | null }`
  - `planInstall(agent: AgentId, env: InstallEnv): FileEdit[]`
  - `planUninstall(agent: AgentId, env: InstallEnv): FileEdit[]`
  - `applyEdits(edits: FileEdit[]): void` from `src/shell/applyEdits.ts`
  - `readFileOrNull(path: string): string | null` from the same file

The `existing` callback is how the pure planner sees current file contents without touching the filesystem.

- [ ] **Step 1: Write the failing planner test**

`test/core/install/plan.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { planInstall, planUninstall, type InstallEnv } from '../../../src/core/install/plan.js'

function env(files: Record<string, string> = {}): InstallEnv {
  return {
    home: '/home/me',
    hookPath: '/home/me/.local/share/gnome-shell/extensions/dasbo-island@ayubaswad.gmail.com/hooks/dasbo-hook',
    existing: (p) => files[p] ?? null,
  }
}

describe('planInstall for claude', () => {
  it('creates settings.json with all five hook events when the file is absent', () => {
    const edits = planInstall('claude', env())
    expect(edits).toHaveLength(1)
    expect(edits[0]!.path).toBe('/home/me/.claude/settings.json')
    expect(edits[0]!.backup).toBe(true)
    const parsed = JSON.parse(edits[0]!.content)
    expect(Object.keys(parsed.hooks).sort()).toEqual(
      ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop', 'UserPromptSubmit']
    )
  })

  it('uses permission mode for PreToolUse and notify mode elsewhere', () => {
    const parsed = JSON.parse(planInstall('claude', env())[0]!.content)
    expect(parsed.hooks.PreToolUse[0].hooks[0].command).toContain('claude permission')
    expect(parsed.hooks.Stop[0].hooks[0].command).toContain('claude notify')
  })

  it('preserves unrelated keys in an existing settings.json', () => {
    const before = JSON.stringify({ model: 'opus', hooks: {} })
    const edits = planInstall('claude', env({ '/home/me/.claude/settings.json': before }))
    const parsed = JSON.parse(edits[0]!.content)
    expect(parsed.model).toBe('opus')
  })

  it('preserves foreign hook entries alongside ours', () => {
    const before = JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: '/other/tool' }] }] },
    })
    const parsed = JSON.parse(
      planInstall('claude', env({ '/home/me/.claude/settings.json': before }))[0]!.content
    )
    const commands = parsed.hooks.Stop.flatMap((g: any) => g.hooks.map((h: any) => h.command))
    expect(commands).toContain('/other/tool')
    expect(commands.some((c: string) => c.includes('dasbo-hook'))).toBe(true)
  })

  it('is idempotent — installing twice yields one dasbo entry', () => {
    const first = planInstall('claude', env())[0]!.content
    const parsed = JSON.parse(
      planInstall('claude', env({ '/home/me/.claude/settings.json': first }))[0]!.content
    )
    const commands = parsed.hooks.Stop.flatMap((g: any) => g.hooks.map((h: any) => h.command))
    expect(commands.filter((c: string) => c.includes('dasbo-hook'))).toHaveLength(1)
  })

  it('leaves malformed existing JSON untouched by returning no edits', () => {
    const edits = planInstall('claude', env({ '/home/me/.claude/settings.json': '{not json' }))
    expect(edits).toEqual([])
  })
})

describe('planInstall for codex', () => {
  it('writes hooks.json preserving a foreign entry', () => {
    const before = JSON.stringify({
      'vibe-island': { command: 'python3 /x/y.py', events: ['session.start'] },
    })
    const edits = planInstall('codex', env({ '/home/me/.codex/hooks.json': before }))
    const parsed = JSON.parse(edits[0]!.content)
    expect(parsed['vibe-island']).toBeDefined()
    expect(parsed['dasbo-island'].command).toContain('codex notify')
    expect(parsed['dasbo-island'].events).toContain('session.start')
  })
})

describe('planInstall for antigravity', () => {
  it('writes hooks.json under .gemini/config', () => {
    const edits = planInstall('antigravity', env())
    expect(edits[0]!.path).toBe('/home/me/.gemini/config/hooks.json')
    const parsed = JSON.parse(edits[0]!.content)
    expect(parsed.PreToolUse[0].hooks[0].command).toContain('antigravity permission')
  })
})

describe('planUninstall', () => {
  it('removes only our claude entries and keeps foreign ones', () => {
    const installed = planInstall('claude', env())[0]!.content
    const withForeign = JSON.parse(installed)
    withForeign.hooks.Stop.push({ hooks: [{ type: 'command', command: '/other/tool' }] })
    const parsed = JSON.parse(
      planUninstall('claude', env({ '/home/me/.claude/settings.json': JSON.stringify(withForeign) }))[0]!.content
    )
    const commands = parsed.hooks.Stop.flatMap((g: any) => g.hooks.map((h: any) => h.command))
    expect(commands).toEqual(['/other/tool'])
  })

  it('returns no edits when nothing is installed', () => {
    expect(planUninstall('claude', env())).toEqual([])
  })

  it('removes only the dasbo-island key from codex hooks.json', () => {
    const before = JSON.stringify({
      'vibe-island': { command: 'python3 /x/y.py', events: ['session.start'] },
      'dasbo-island': { command: '/h/dasbo-hook codex notify', events: ['session.start'] },
    })
    const parsed = JSON.parse(
      planUninstall('codex', env({ '/home/me/.codex/hooks.json': before }))[0]!.content
    )
    expect(parsed['vibe-island']).toBeDefined()
    expect(parsed['dasbo-island']).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/core/install/plan.test.ts`
Expected: FAIL — cannot resolve `src/core/install/plan.js`.

- [ ] **Step 3: Write `src/core/install/plan.ts`**

```ts
import type { AgentId, FileEdit } from '../types.js'

export interface InstallEnv {
  home: string
  /** Absolute path to the installed dasbo-hook executable. */
  hookPath: string
  /** Current contents of a path, or null when the file does not exist. */
  existing: (path: string) => string | null
}

/** Marker used to recognise our own entries on uninstall and to stay idempotent. */
const MARKER = 'dasbo-hook'
const CODEX_KEY = 'dasbo-island'

const CLAUDE_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'] as const
const ANTIGRAVITY_EVENTS = ['PreToolUse', 'PostToolUse', 'Stop'] as const
const CODEX_EVENTS = ['session.start', 'session.end', 'tool.start', 'tool.end'] as const

function cmd(env: InstallEnv, agent: AgentId, mode: 'notify' | 'permission'): string {
  return `${env.hookPath} ${agent} ${mode}`
}

function parseOrNull(text: string | null): Record<string, any> | null | undefined {
  if (text === null) return null // file absent: start from {}
  try {
    const v = JSON.parse(text)
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? v : undefined
  } catch {
    return undefined // malformed: refuse to touch it
  }
}

function isOurs(command: unknown): boolean {
  return typeof command === 'string' && command.includes(MARKER)
}

/** Strip every dasbo group from a Claude-style event array. */
function withoutOurs(groups: unknown): any[] {
  if (!Array.isArray(groups)) return []
  return groups
    .map((g) => {
      if (typeof g !== 'object' || g === null) return null
      const hooks = Array.isArray((g as any).hooks)
        ? (g as any).hooks.filter((h: any) => !isOurs(h?.command))
        : []
      return hooks.length > 0 ? { ...(g as any), hooks } : null
    })
    .filter((g): g is any => g !== null)
}

function claudeEdits(env: InstallEnv, install: boolean): FileEdit[] {
  const path = `${env.home}/.claude/settings.json`
  const doc = parseOrNull(env.existing(path))
  if (doc === undefined) return []
  const root: Record<string, any> = doc === null ? {} : { ...doc }
  const hooks: Record<string, any> = { ...(root['hooks'] ?? {}) }

  let changed = false
  for (const event of CLAUDE_EVENTS) {
    const cleaned = withoutOurs(hooks[event])
    if (install) {
      const mode = event === 'PreToolUse' ? 'permission' : 'notify'
      const group: Record<string, any> = {
        hooks: [{ type: 'command', command: cmd(env, 'claude', mode) }],
      }
      if (event === 'PreToolUse' || event === 'PostToolUse') group['matcher'] = '*'
      hooks[event] = [...cleaned, group]
      changed = true
    } else {
      const had = JSON.stringify(hooks[event] ?? []) !== JSON.stringify(cleaned)
      if (had) changed = true
      if (cleaned.length > 0) hooks[event] = cleaned
      else delete hooks[event]
    }
  }

  if (!changed) return []
  root['hooks'] = hooks
  return [{ path, content: JSON.stringify(root, null, 2) + '\n', backup: true }]
}

function codexEdits(env: InstallEnv, install: boolean): FileEdit[] {
  const path = `${env.home}/.codex/hooks.json`
  const doc = parseOrNull(env.existing(path))
  if (doc === undefined) return []
  const root: Record<string, any> = doc === null ? {} : { ...doc }

  if (install) {
    root[CODEX_KEY] = {
      command: cmd(env, 'codex', 'notify'),
      events: [...CODEX_EVENTS],
    }
  } else {
    if (!(CODEX_KEY in root)) return []
    delete root[CODEX_KEY]
  }

  return [{ path, content: JSON.stringify(root, null, 2) + '\n', backup: true }]
}

function antigravityEdits(env: InstallEnv, install: boolean): FileEdit[] {
  const path = `${env.home}/.gemini/config/hooks.json`
  const doc = parseOrNull(env.existing(path))
  if (doc === undefined) return []
  const root: Record<string, any> = doc === null ? {} : { ...doc }

  let changed = false
  for (const event of ANTIGRAVITY_EVENTS) {
    const cleaned = withoutOurs(root[event])
    if (install) {
      const mode = event === 'PreToolUse' ? 'permission' : 'notify'
      const group: Record<string, any> = {
        hooks: [{ type: 'command', command: cmd(env, 'antigravity', mode) }],
      }
      if (event !== 'Stop') group['matcher'] = '.*'
      root[event] = [...cleaned, group]
      changed = true
    } else {
      const had = JSON.stringify(root[event] ?? []) !== JSON.stringify(cleaned)
      if (had) changed = true
      if (cleaned.length > 0) root[event] = cleaned
      else delete root[event]
    }
  }

  if (!changed) return []
  return [{ path, content: JSON.stringify(root, null, 2) + '\n', backup: true }]
}

export function planInstall(agent: AgentId, env: InstallEnv): FileEdit[] {
  if (agent === 'claude') return claudeEdits(env, true)
  if (agent === 'codex') return codexEdits(env, true)
  return antigravityEdits(env, true)
}

export function planUninstall(agent: AgentId, env: InstallEnv): FileEdit[] {
  if (agent === 'claude') return claudeEdits(env, false)
  if (agent === 'codex') return codexEdits(env, false)
  return antigravityEdits(env, false)
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run test/core/install/plan.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Write `src/shell/applyEdits.ts`**

```ts
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import type { FileEdit } from '../core/types.js'

export function readFileOrNull(path: string): string | null {
  try {
    const [ok, bytes] = GLib.file_get_contents(path)
    if (!ok) return null
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

/**
 * Write each planned edit, taking a one-time .dasbo.bak snapshot first.
 * Throws on the first failure so the prefs UI can report it; earlier edits stay applied,
 * which is safe because each edit is a complete file body.
 */
export function applyEdits(edits: FileEdit[]): void {
  for (const edit of edits) {
    const file = Gio.File.new_for_path(edit.path)
    const parent = file.get_parent()
    if (parent && !parent.query_exists(null)) parent.make_directory_with_parents(null)

    if (edit.backup) {
      const backupPath = `${edit.path}.dasbo.bak`
      if (file.query_exists(null) && !Gio.File.new_for_path(backupPath).query_exists(null)) {
        const current = readFileOrNull(edit.path)
        if (current !== null) {
          GLib.file_set_contents(backupPath, new TextEncoder().encode(current))
        }
      }
    }

    GLib.file_set_contents(edit.path, new TextEncoder().encode(edit.content))
  }
}
```

- [ ] **Step 6: Run every test and the typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS, `tsc` silent.

- [ ] **Step 7: Commit**

```bash
git add src/core/install src/shell/applyEdits.ts test/core/install
git commit -m "feat(install): add pure hook install planner and disk applier"
```

---

## Task 14: Preferences window

**Files:**
- Create: `src/prefs.ts`
- Modify: `build.mjs` (remove the `.catch` on the prefs build)
- Test: manual

**Interfaces:**
- Consumes: `planInstall`, `planUninstall`, `applyEdits`, `readFileOrNull`, the GSettings schema.
- Produces: a working `gnome-extensions prefs dasbo-island@ayubaswad.gmail.com` window.

- [ ] **Step 1: Write `src/prefs.ts`**

```ts
import Adw from 'gi://Adw'
import Gtk from 'gi://Gtk'
import GLib from 'gi://GLib'
import type Gio from 'gi://Gio'
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js'
import { planInstall, planUninstall, type InstallEnv } from './core/install/plan.js'
import { applyEdits, readFileOrNull } from './shell/applyEdits.js'
import { adapters } from './core/adapters/index.js'
import type { AgentId } from './core/types.js'

export default class DasboIslandPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> | void {
    const settings = this.getSettings()

    window.add(this._appearancePage(settings))
    window.add(this._behaviourPage(settings))
    window.add(this._agentsPage(settings, window))
  }

  private _appearancePage(settings: Gio.Settings): Adw.PreferencesPage {
    const page = new Adw.PreferencesPage({ title: 'Appearance', icon_name: 'preferences-desktop-display-symbolic' })
    const group = new Adw.PreferencesGroup({
      title: 'Panel',
      description: 'Position changes take effect after disabling and re-enabling the extension.',
    })

    const position = new Adw.ComboRow({
      title: 'Panel box',
      model: Gtk.StringList.new(['left', 'center', 'right']),
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

  private _behaviourPage(settings: Gio.Settings): Adw.PreferencesPage {
    const page = new Adw.PreferencesPage({ title: 'Behaviour', icon_name: 'preferences-system-symbolic' })
    const group = new Adw.PreferencesGroup({ title: 'Permissions' })

    const timeout = new Adw.SpinRow({
      title: 'Permission timeout',
      subtitle: 'Seconds before falling through to the agent’s own prompt. Zero waits indefinitely.',
      adjustment: new Gtk.Adjustment({ lower: 0, upper: 3600, step_increment: 5 }),
    })
    settings.bind('permission-timeout', timeout, 'value', 0)
    group.add(timeout)

    const autoOpen = new Adw.SwitchRow({
      title: 'Open the popup automatically',
      subtitle: 'Suppressed while a fullscreen window is on the primary monitor',
    })
    settings.bind('auto-open-on-permission', autoOpen, 'active', 0)
    group.add(autoOpen)

    const linger = new Adw.SpinRow({
      title: 'Keep finished sessions visible',
      subtitle: 'Seconds a completed session stays in the list',
      adjustment: new Gtk.Adjustment({ lower: 0, upper: 300, step_increment: 5 }),
    })
    settings.bind('done-linger', linger, 'value', 0)
    group.add(linger)

    page.add(group)
    return page
  }

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

    for (const id of ['claude', 'codex', 'antigravity'] as AgentId[]) {
      const row = new Adw.ActionRow({ title: adapters[id].displayName })

      const install = new Gtk.Button({ label: 'Install', valign: Gtk.Align.CENTER })
      const uninstall = new Gtk.Button({ label: 'Remove', valign: Gtk.Align.CENTER })

      const run = (edits: ReturnType<typeof planInstall>, verb: string) => {
        if (edits.length === 0) {
          this._toast(window, `${adapters[id].displayName}: nothing to ${verb}`)
          return
        }
        try {
          applyEdits(edits)
          this._toast(window, `${adapters[id].displayName}: ${verb} complete`)
        } catch (e) {
          this._toast(window, `${adapters[id].displayName}: ${verb} failed — ${e}`)
        }
      }

      install.connect('clicked', () => run(planInstall(id, env), 'install'))
      uninstall.connect('clicked', () => run(planUninstall(id, env), 'remove'))

      row.add_suffix(install)
      row.add_suffix(uninstall)
      group.add(row)
    }

    page.add(group)
    return page
  }

  private _toast(window: Adw.PreferencesWindow, text: string): void {
    if ('add_toast' in window) {
      ;(window as unknown as Adw.ToastOverlay).add_toast(new Adw.Toast({ title: text }))
    } else {
      console.log(`dasbo-island: ${text}`)
    }
  }
}
```

- [ ] **Step 2: Drop the build catch for prefs**

In `build.mjs`, change:
```js
await build({ ...common, entryPoints: ['src/prefs.ts'], outfile: 'dist/prefs.js' }).catch(() => {})
```
to:
```js
await build({ ...common, entryPoints: ['src/prefs.ts'], outfile: 'dist/prefs.js' })
```

- [ ] **Step 3: Verify the prefs window opens**

Run:
```bash
make install
gnome-extensions prefs dasbo-island@ayubaswad.gmail.com
```
Expected: a window with three pages — Appearance, Behaviour, Agents. Every control reflects the current GSettings value.

- [ ] **Step 4: Verify install writes real hooks and preserves the foreign entry**

Back up first, since this touches live configuration:
```bash
cp ~/.codex/hooks.json /tmp/hooks.json.safety
```
Click `Install` next to Codex CLI, then:
```bash
cat ~/.codex/hooks.json
ls ~/.codex/hooks.json.dasbo.bak
```
Expected: both `vibe-island` and `dasbo-island` keys present; a `.dasbo.bak` file exists holding the original.

- [ ] **Step 5: Verify remove is surgical**

Click `Remove` next to Codex CLI, then:
```bash
cat ~/.codex/hooks.json
```
Expected: `vibe-island` is still there, `dasbo-island` is gone.

- [ ] **Step 6: Verify a real end-to-end Claude Code session**

Click `Install` next to Claude Code, then in a scratch directory:
```bash
cd /tmp/dasbo-capture && claude -p 'run `ls -la` and tell me how many files there are'
```
Expected: the pill appears showing the session, turns blue while tools run, and turns amber with `Allow` / `Deny` if the tool requires permission. Clicking `Allow` lets the agent proceed.

- [ ] **Step 7: Verify the fail-open story once more, with real hooks installed**

Run:
```bash
gnome-extensions disable dasbo-island@ayubaswad.gmail.com
cd /tmp/dasbo-capture && claude -p 'run `ls` and count the files'
```
Expected: Claude Code runs completely normally, prompting in the terminal as it would without the extension. Re-enable afterwards.

- [ ] **Step 8: Commit**

```bash
git add src/prefs.ts build.mjs
git commit -m "feat(prefs): add preferences window with per-agent hook installation"
```

---

## Task 15: Reaper, teardown audit, and packaging

**Files:**
- Modify: `src/extension.ts`, `src/shell/island.ts`, `Makefile`
- Create: `README.md`, `LICENSE`
- Test: `test/core/store.test.ts` already covers `reap`; teardown is verified manually

**Interfaces:**
- Consumes: `SessionStore.reap`, `pidAlive` from `src/shell/windowFinder.ts`.
- Produces: `make pack` producing a reviewable zip; a fully clean `disable()`.

- [ ] **Step 1: Run the reaper on a timer in `src/extension.ts`**

Add the import:

```ts
import GLib from 'gi://GLib'
import { activateForPid, pidAlive } from './shell/windowFinder.js'
```

Add the field:

```ts
  private _reaperId = 0
```

At the end of `enable()`:

```ts
    this._reaperId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 60, () => {
      this._store?.reap(Date.now(), pidAlive)
      return GLib.SOURCE_CONTINUE
    })
```

At the start of `disable()`:

```ts
    if (this._reaperId) {
      GLib.Source.remove(this._reaperId)
      this._reaperId = 0
    }
```

- [ ] **Step 2: Keep `doneLingerSeconds` in sync with settings**

In `enable()`, after `this._store.doneLingerSeconds = settings.get_int('done-linger')`:

```ts
    this._settingsChangedId = settings.connect('changed::done-linger', () => {
      if (this._store) this._store.doneLingerSeconds = settings.get_int('done-linger')
    })
```

Add the field `private _settingsChangedId = 0` and the `_settings` reference `private _settings: Gio.Settings | null = null` (assign `this._settings = settings` in `enable()`), then in `disable()`:

```ts
    if (this._settingsChangedId && this._settings) {
      this._settings.disconnect(this._settingsChangedId)
      this._settingsChangedId = 0
    }
    this._settings = null
```

Add `import type Gio from 'gi://Gio'` at the top.

- [ ] **Step 3: Verify the done-linger reaping works**

Run:
```bash
make install
```
Restart the shell, then:
```bash
tools/fake-agent.js session
echo '{"hook_event_name":"Stop","session_id":"fake-1","cwd":"/tmp"}' | ./hooks/dasbo-hook claude notify
```
Expected: the session shows as done, and within 70 seconds the row and pill disappear on their own.

- [ ] **Step 4: Audit teardown with a disable/enable stress loop**

Run:
```bash
for i in $(seq 1 10); do
  gnome-extensions disable dasbo-island@ayubaswad.gmail.com
  sleep 1
  gnome-extensions enable dasbo-island@ayubaswad.gmail.com
  sleep 1
done
journalctl --since '2 minutes ago' -o cat /usr/bin/gnome-shell | grep -iE 'dasbo|source id|already destroyed|leak' || echo "clean"
```
Expected: `clean`. Any `Source ID ... was not found when attempting to remove it` warning is a real leak — find the `GLib` source it refers to and make sure its id is zeroed after removal.

- [ ] **Step 5: Verify disable resolves a pending permission immediately**

In one terminal:
```bash
tools/fake-agent.js session
gsettings --schemadir ~/.local/share/gnome-shell/extensions/dasbo-island@ayubaswad.gmail.com/schemas \
  set org.gnome.shell.extensions.dasbo-island permission-timeout 0
tools/fake-agent.js perm
```
It blocks with no timeout. In a second terminal:
```bash
gnome-extensions disable dasbo-island@ayubaswad.gmail.com
```
Expected: the first terminal returns **immediately** with a decision containing `"ask"`. It must not hang. Reset `permission-timeout` to 30 afterwards.

- [ ] **Step 6: Add a `pack` target to the `Makefile`**

Append:

```makefile
pack: build
	cd dist && zip -qr ../$(UUID).shell-extension.zip . -x '*.map'
	@echo "Wrote $(UUID).shell-extension.zip"
```

Add `*.shell-extension.zip` to `.gitignore`.

- [ ] **Step 7: Verify the pack is reviewable**

Run:
```bash
make pack
unzip -l dasbo-island@ayubaswad.gmail.com.shell-extension.zip
head -30 dist/extension.js
```
Expected: the zip contains `extension.js`, `prefs.js`, `metadata.json`, `stylesheet.css`, `schemas/`, and `hooks/dasbo-hook`. `head` shows readable, unminified JavaScript with original identifier names. If it is minified, `build.mjs` has drifted from `minify: false`.

- [ ] **Step 8: Write `README.md`**

```markdown
# Dasbo Island

Live AI coding-agent sessions in the GNOME top bar: status at a glance, inline
permission approval, and jump-back to the terminal running the session.

Inspired by [open-vibe-island](https://github.com/Octane0411/open-vibe-island),
rebuilt natively for GNOME Shell.

## Requirements

GNOME Shell 46. X11 or Wayland.

## Install

```bash
make install
gnome-extensions enable dasbo-island@ayubaswad.gmail.com
```

On X11 press `Alt+F2`, type `r`, press Enter. On Wayland, log out and back in.

Then open the preferences and install hooks for each agent you use:

```bash
gnome-extensions prefs dasbo-island@ayubaswad.gmail.com
```

## Supported agents

| Agent | Config touched | Status | Permission gating |
|---|---|---|---|
| Claude Code | `~/.claude/settings.json` | yes | yes |
| Codex CLI | `~/.codex/hooks.json` | yes | see notes |
| Antigravity CLI (`agy`) | `~/.gemini/config/hooks.json` | yes | see notes |

Hook installation preserves entries belonging to other tools and writes a
`.dasbo.bak` backup before its first change.

## Fail-open guarantee

The hook helper exits 0 with empty stdout on every error path. If this extension
is disabled, crashed, or never installed, your agents behave exactly as they
would without it.

## Development

```bash
npm install
npm test          # pure core logic, no GNOME needed
npm run typecheck
make install
tools/fake-agent.js perm   # drive the UI without a real agent
```

`src/core/` must never import `gi://` or `resource://`. A test enforces this.

## License

GPL-3.0-or-later.
```

- [ ] **Step 9: Add the license**

Download the GPL-3.0 text:
```bash
curl -sSL https://www.gnu.org/licenses/gpl-3.0.txt -o LICENSE
head -3 LICENSE
```
Expected: the first lines read `GNU GENERAL PUBLIC LICENSE` / `Version 3, 29 June 2007`.

GPL-3.0 matches upstream open-vibe-island's license, which is the appropriate choice for a work inspired by it.

- [ ] **Step 10: Final full verification**

Run:
```bash
npx vitest run && npm run typecheck && make pack
```
Expected: every test passes, `tsc` is silent, and the zip is written.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: add session reaper, teardown audit, packaging and docs"
```

---

## Deferred, deliberately

- **Usage windows (5h / 7d).** Out of scope per the design. Would need a polling source separate from hooks.
- **`~/.claude/projects/*.jsonl` transcript discovery.** Upstream auto-discovers sessions by scanning transcripts. This build learns about sessions only through hooks, which is simpler and avoids a file monitor. Revisit if sessions started before the extension was enabled turn out to matter.
- **Persisted "always allow" rules.** Deliberately session-scoped. Persisting them would be a security-relevant change and needs its own design.
- **Pruning `PermissionTable.always` when a session is reaped.** The grant map is keyed by session key and is never swept, so it retains a few dozen bytes per session for the lifetime of the shell process. Bounded and harmless, but worth a `forgetSession(key)` call from the reaper if session churn ever becomes high. Note this places the grants in `PermissionTable` rather than on `Session` as the design document sketched — same scope and lifetime, one owner instead of two.
