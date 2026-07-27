# dasbo-island — Design

**Date:** 2026-07-27
**Status:** Approved, ready for implementation planning

A GNOME Shell extension that surfaces AI coding-agent activity in the top bar, inspired by
[open-vibe-island](https://github.com/Octane0411/open-vibe-island) (macOS/Swift). This is a
re-implementation for native GNOME Shell, not a port — no notch, no SwiftUI, no Unix socket.

## Goals

Show live agent session state in the GNOME top bar, gate tool permissions inline, and jump back to
the terminal running a session. Three agents at launch: Claude Code, Codex CLI, Antigravity CLI
(`agy`).

## Non-goals

- Usage / rate-limit windows (5h, 7d). Deferred.
- macOS parity in visual form. The island is a top-bar pill, not a notch overlay.
- Sandboxed or remote agents. Local processes only.

## Target environment

- GNOME Shell 46 (dev box: GNOME 46.0, X11). Wayland must work equally — nothing X11-specific.
- Extension format: GNOME 45+ ESM.
- Language: TypeScript compiled with esbuild against `@girs` type definitions.
- Distribution: extensions.gnome.org compliance from day one; local `make install` during development.

---

## Architecture

Two processes, one wire.

### Hook helper — `dasbo-hook`

A standalone GJS script (`#!/usr/bin/gjs -m`). GJS ships with GNOME, so there is no new runtime
dependency and no JSON parsing in shell.

```
dasbo-hook <agent> <notify|permission>
```

Reads the agent's hook payload from stdin, forwards it over D-Bus, and for `permission` mode writes
the agent-native decision JSON to stdout.

**Fails open unconditionally.** Extension disabled, bus name unowned, session bus missing, malformed
reply — every error path exits 0 with empty stdout. The agent then behaves exactly as if the
extension did not exist.

### Extension — D-Bus service

Owns `org.dasbo.Island` at `/org/dasbo/Island`.

| Method | Signature | Used by |
|---|---|---|
| `Notify` | `(s agent, s payloadJson) → ()` | SessionStart, PostToolUse, UserPromptSubmit, Stop |
| `RequestPermission` | `(s agent, s payloadJson) → (s decisionJson)` | PreToolUse gate |
| `Ping` | `() → (s version)` | hook fast-bail |

**Timeout policy lives in the extension, not the hook.** The hook calls with an infinite D-Bus
timeout. The extension holds the `Gio.DBusMethodInvocation` and returns when the user clicks or when
its own GSettings-driven timer fires. Consequence: setting the timeout to "wait indefinitely" is
just `timeout = 0` in settings — no hook redeployment, no reinstall.

---

## Layering

Hard rule: **`src/core/` imports zero GObject.** It is pure TypeScript, runs under node, and is unit
tested without a compositor. `src/shell/` is thin St/Clutter glue over it.

```
dasbo-island/
  src/
    core/                       # pure TS — vitest, no GNOME needed
      types.ts                  # Session, AgentEvent, Decision
      store.ts                  # reduce(state, event) -> state, subscribers
      permissions.ts            # pending table + timeout, injected clock
      adapters/
        claude.ts
        codex.ts
        antigravity.ts
        index.ts                # dispatch by agent id
    shell/                      # GObject layer, deliberately thin
      island.ts                 # PanelMenu.Button — pill + popup
      sessionRow.ts
      permissionRow.ts
      windowFinder.ts           # /proc PID ancestry -> Meta.Window
    dbus/
      service.ts
      iface.xml
    installer/
      hookInstaller.ts          # applies FileEdit[] produced by adapters
    extension.ts                # enable/disable wiring
    prefs.ts                    # preferences window
  hooks/
    dasbo-hook                  # GJS, shipped verbatim, not compiled
  schemas/
    org.gnome.shell.extensions.dasbo-island.gschema.xml
  test/
    fixtures/{claude,codex,antigravity}/*.json
  tools/
    fake-agent.js               # synthetic event generator for UI testing
  metadata.json
  Makefile
```

---

## Agent adapters

Three agents, three dialects, one contract:

```ts
interface AgentAdapter {
  id: 'claude' | 'codex' | 'antigravity'
  displayName: string
  normalize(raw: unknown): AgentEvent | null   // dialect -> internal, null = drop
  encodeDecision(d: Decision): unknown         // internal -> agent-native stdout JSON
  planInstall(env: Paths): FileEdit[]          // returns data; does NOT touch disk
}
```

### Dialect notes

**Claude Code** — hooks configured in `~/.claude/settings.json`. Payload base: `session_id`,
`transcript_path`, `cwd`, `hook_event_name`. PreToolUse decision is returned as
`hookSpecificOutput.permissionDecision` ∈ `allow | deny | ask`.

**Codex CLI** — hooks in `~/.codex/hooks.json` or an inline `[hooks]` table. Requires
`[features] hooks = true` in `~/.codex/config.toml`; the installer must set this and say so. Payload
base matches Claude's snake_case shape (`session_id`, `transcript_path`, `cwd`, `hook_event_name`,
`model`), turn-scoped events add `turn_id`. Note: `notify` and similar machine-local keys are ignored
in project-local config, so all writes go to the user-level config.

**Antigravity CLI (`agy`)** — hooks in `~/.gemini/config/hooks.json` (global) or `.agents/`
(workspace, takes precedence). camelCase payload: `conversationId`, `workspacePaths`,
`transcriptPath`, `stepIdx`, `error`. Events include `PreToolUse`, `PostInvocation`, `Stop`. Matchers
are regexes against the tool name.

`planInstall` returning `FileEdit[]` as data — rather than writing files itself — keeps install logic
unit-testable and gives EGO reviewers a pure function to audit.

---

## Domain model

```ts
type SessionState = 'idle' | 'running' | 'waiting' | 'done' | 'error'

interface Session {
  key: string            // `${agent}:${sessionId}`
  agent: AgentId
  sessionId: string
  project: string        // basename(cwd)
  cwd: string
  state: SessionState
  currentTool?: string
  pid: number
  startedAt: number
  lastEventAt: number
  transcriptPath?: string
  pendingPermission?: PendingPermission
}
```

`store.ts` exposes `reduce(state, event) → state` plus subscription. The clock is injected so tests
advance time rather than sleeping.

---

## UI behavior

### Pill

Lives in the top bar. Position (left / center / right) is a GSettings key, default center.

- 0 sessions → hidden entirely. GSettings `always-show` overrides.
- N sessions → `● 2 · thinking`. Dot color reflects the worst state across sessions.
- Colors: `idle` grey, `running` blue, `waiting` amber, `error` red. `done` fades and the session
  drops after 10s.

### Permission arriving while the popup is closed

Dot turns amber and pulses (repeating opacity `ease()`), and the popup auto-opens.

Auto-open is suppressed when `Main.layoutManager.primaryMonitor.inFullscreen` — pulse only, so the
island never covers a fullscreen window mid-presentation.

### Popup rows

One `PopupBaseMenuItem` subclass per session:

```
dasbo-island
● running · Edit main.js          00:42   [Jump]
```

A row with a pending permission swaps the tail for `[Allow] [Deny] [Always allow this tool]`.

"Always allow" writes a per-session, per-tool rule into the store — **not** to disk. It dies with the
session. No silent permanent grant is ever persisted.

Elapsed timers use exactly **one** 1-second `GLib.timeout` for the whole popup, started on open and
removed on close. Not one per row, and never running while collapsed.

---

## Jump-back

On `[Jump]`:

1. Read `/proc/<pid>/stat`, take field 4 (ppid), walk upward. Depth capped at 20.
2. Collect the ancestor PID set.
3. Scan `global.get_window_actors()` for a `meta_window.get_pid()` in that set.
4. `Main.activateWindow(win)`.

Terminal-agnostic by construction — Ghostty, kitty, GNOME Terminal, VS Code, JetBrains all work with
no per-application list to maintain.

Trade-off, stated explicitly for reviewers: these are synchronous file reads inside a click handler.
They are ~200-byte `/proc` reads, bounded at 20, and happen only on explicit user click.

No window found (tmux, ssh, detached session) → the row shows `no window` for 2 seconds. No crash, no
fallback spawn.

---

## Data flow

```
agent fires hook
  -> dasbo-hook  (stdin JSON; argv: <agent> <notify|permission>)
  -> D-Bus
  -> adapters/index.normalize()   -> AgentEvent | null
  -> store.reduce()               -> new session map
  -> island rerenders subscribed rows

permission branch:
  RequestPermission -> held in permissions.ts pending table
  -> permissionRow renders Allow / Deny / Always allow
  -> user clicks OR timeout fires
  -> adapter.encodeDecision()
  -> invocation.return_value()
  -> hook stdout
  -> agent proceeds
```

---

## Failure modes

| Case | Behavior |
|---|---|
| Extension disabled or crashed | Hook's D-Bus call errors; hook exits 0 with empty stdout. Agent prompts in the terminal as normal. |
| Malformed payload | `normalize` returns `null`, event dropped, logged once per agent per session. |
| Permission timeout hit | Fall-through decision (`ask` for Claude, per-adapter equivalent). Never auto-allow, never auto-deny. Timeout in seconds via GSettings; `0` = wait forever. |
| Agent crashes without `Stop` | Reaper sweep every 60s: no event within 15 minutes **and** `/proc/<pid>` gone → session dropped. |
| `disable()` with permissions pending | Every held invocation resolved fall-through immediately. No hung agents. |
| Bus name already owned | Log, skip export, UI shows nothing. No crash loop. |
| No window for jump-back | Row shows `no window` for 2s. |

---

## Hook installation

A prefs page with a per-agent Install / Uninstall pair.

- Every target file is backed up to `<file>.dasbo.bak` before the first edit.
- Uninstall removes only the entries the installer added, then restores from backup if the file
  would otherwise be left malformed.
- Codex install additionally sets `[features] hooks = true` and surfaces a note that this is an
  experimental, opt-in Codex feature.
- The extension itself never spawns a process to do this. It writes files.

---

## extensions.gnome.org compliance

Compliance is structural, not a later cleanup pass:

- **No subprocess spawning, ever.** The only capabilities used are file IO, D-Bus, and `/proc` reads.
  The installer writes files; it does not shell out.
- **Build output is reviewable.** esbuild with `--minify=false` and sourcemaps. Full TypeScript source
  in the repository.
- **`disable()` fully tears down**: destroys the panel button, unowns the bus name, resolves every
  pending permission with a fall-through decision, clears all timers, disconnects all signals.
- **Session mode `user` only.** No `unlock-dialog` — nothing runs on the lock screen.
- **Settings via GSettings** with a proper compiled schema.

---

## Testing

- **vitest over `src/core/**`** — reducer transitions, permission timeout against a fake clock,
  `planInstall` output diffing. No GNOME required.
- **Fixture-driven adapter tests** — real captured payloads per agent under `test/fixtures/`, one test
  per event kind per dialect. This is where upstream dialect drift gets caught.
- **`tools/fake-agent.js`** — fires synthetic events and permission requests over D-Bus. Exercises
  every UI state, including the amber pulse and the timeout path, without running a real agent.
- **Manual smoke** — `dbus-run-session -- gnome-shell --nested --wayland` on GNOME 46. Catches the
  St/Clutter mistakes that vitest structurally cannot.

---

## Settings (GSettings keys)

| Key | Type | Default | Meaning |
|---|---|---|---|
| `panel-position` | enum `left`/`center`/`right` | `center` | Where the pill sits |
| `panel-index` | int | `0` | Ordering within that box |
| `always-show` | bool | `false` | Show the pill with zero sessions |
| `permission-timeout` | int (seconds) | `30` | `0` = wait indefinitely |
| `auto-open-on-permission` | bool | `true` | Auto-expand the popup |
| `enabled-agents` | string array | `['claude', 'codex', 'antigravity']` | Adapters that accept events. Independent of hook installation — an agent with no hooks installed simply never sends any. |
| `done-linger` | int (seconds) | `10` | How long a finished session stays visible |

---

## Open items for the implementation plan

1. Capture real hook payloads for all three agents into `test/fixtures/` before writing adapters —
   the fixtures are the specification for `normalize`.
2. Verify Antigravity CLI's PreToolUse response schema against `antigravity.google/docs/hooks`; the
   allow/deny encoding is the least-documented of the three.
3. Confirm `meta_window.get_pid()` reliability under X11 for each terminal in use (it depends on
   `_NET_WM_PID`).
