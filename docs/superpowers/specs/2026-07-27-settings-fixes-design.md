# Preferences fixes: live panel placement and hook install state

Date: 2026-07-27
Status: approved, ready for planning

## Problem

Two complaints about the preferences window, both confirmed by direct
experiment on a live GNOME Shell 46 / X11 session.

### Panel box appears to do nothing

`extension.ts` reads `panel-position` and `panel-index` once, inside
`enable()`, and passes them to `Main.panel.addToStatusArea`. Nothing watches
either key afterwards, so changing the combo has no visible effect until the
extension is disabled and re-enabled.

Both halves of the path work in isolation. Writing `panel-position` from the
preferences combo lands in dconf (verified: the value read back as `'left'`
immediately after the user changed the combo), and the extension honours the
stored value at startup (verified: setting `'left'` then `'right'` with
`gsettings` and reloading the extension moved the pill each time). The defect
is purely the missing live apply.

The confusion was amplified by dash-to-panel v73, which is active on this
system. When it takes over the primary panel it keeps GNOME's
`_leftBox` / `_centerBox` / `_rightBox` actors but re-allocates them as three
independent elements positioned by its own `panel-element-positions` setting.
On the reporter's monitor that maps `leftBox` to `stackedTL`, `centerBox` to
`centerMonitor` and `rightBox` to `stackedBR`, so "left" renders next to a
centred taskbar rather than at the screen edge. The setting was working; it
just did not look like it.

### Install button never reflects reality

The Agents page offers Install and Remove unconditionally. The
`edits.length === 0` guard in `run()` was intended to catch a no-op, but it is
dead for install: `claudeEdits` sets `changed = true` on every install pass,
and both `codexEdits` and `antigravityEdits` overwrite their key
unconditionally. Install therefore always reports success, whether or not the
hooks were already there, and Remove is offered for agents that were never
installed.

## Design

### 1. Install-state detection — `src/core/install/plan.ts`

New pure export beside the existing planners:

```ts
export type InstallState = 'absent' | 'installed' | 'stale' | 'unreadable'
export function installState(agent: AgentId, env: InstallEnv): InstallState
```

Presence is keyed exactly the way each agent's uninstall keys it: Claude on
the `dasbo-hook` MARKER, Codex on `hooks[CODEX_KEY]`, Antigravity on
`root[ANTIGRAVITY_KEY]`. That gives the invariant, for a config file that
parses,

> `installState(...) !== 'absent'` if and only if `planUninstall(...)` returns
> a non-empty edit list

by construction, so the Remove button is never enabled on a no-op. For Claude
both sides read the file through one shared traversal (`ourCommandsIn`), so
"Remove has work to do" cannot drift from "installState sees us": in
particular, foreign malformed groups an uninstall pass would once have
normalised away — an empty `hooks` array, a group that is not a record — no
longer count as presence, and are no longer rewritten. A file that
does not parse is exempt: it reports `unreadable` rather than `absent`, and
`planUninstall` is empty for it too (there is nothing to remove), so the two
can disagree there without contradiction — `unreadable` disables both
buttons, and `planInstall` refuses to touch such a file either.

Freshness is decided semantically, not by comparing serialized text, but what
gets compared differs by agent. For Claude and Antigravity, collect
**(event, command) pairs** the file currently attributes to us — not bare
command strings — and compare them as a set against the pairs `planInstall`
would write for the current `hookPath`. Pairs matter because every command we
write encodes its own event name (see `cmd()`), so a command sitting under the
wrong event is a broken install even though the *set of command strings alone*
is unchanged — e.g. a hand edit that swaps the `PreToolUse` and `PostToolUse`
commands between their groups. Comparing bare commands as a set would miss
that and call the file `installed`; comparing pairs calls it `stale`, and
rewriting via `planInstall` repairs it. For Codex there is only one command
shared across every event (see `codexCommand`), so there is no per-command
event to pair it with — the `events` array is compared as a set on its own.
Set comparison (of pairs, or of the Codex `events` array) avoids two false
"stale" reports that a text or array diff would produce — a foreign hook
appended after ours (which `planInstall` would reorder), and indentation or
key-order drift from a hand edit.

| condition | state |
|---|---|
| file exists but does not parse as a JSON object | `unreadable` |
| no entries attributed to us | `absent` |
| our (event, command) pairs equal the expected pairs (Codex: `events` set) | `installed` |
| our entries exist but the pairs differ — including ours under the wrong event | `stale` |
| Codex only: our key is present but the file is unwrapped | `stale` |

`stale` is a real case, not a theoretical one: it is what an extension
directory move produces, since every installed command embeds the absolute
`hookPath`. Rewriting via `planInstall` repairs it, because Claude and
Antigravity strip all of our prior entries before appending fresh ones and
Codex replaces its whole key. Because it covers several causes at once — a
moved hook path, a duplicated entry, a missing event, a command under the
wrong event, an unwrapped Codex file — the subtitle names none of them.

The Codex row of that table is a freshness judgement about the *file*, not
about our entry. `codexEdits` tolerates the legacy unwrapped shape when
writing, but Codex 0.142 rejects such a file wholesale, so a perfectly formed
entry inside one never fires. Reporting `installed` there would strand the
user: the row would say so with Install insensitive, and Install — which
wraps the file — is the only action that repairs it. `codexMatches`
therefore returns false for any file whose top-level `hooks` is not an
object.

**What freshness deliberately does not see.** The pair comparison reads only
event names and command strings. A hand edit that narrows a Claude
`matcher` from `*` to `Bash`, or deletes `type: 'command'` from a handler,
leaves both unchanged and so still reports `installed`, even though the hook
now fires for fewer tools or not at all; repairing it takes a Remove followed
by an Install. That is the accepted cost of the pair ruling, not an oversight
— widening the comparison to whole entry objects would reintroduce the false
`stale` reports (key order, extra fields a future agent version adds) that
the ruling exists to avoid.

A malformed config stays `unreadable` rather than being reported as `absent`,
because `planInstall` also refuses to touch such a file — offering Install
there would produce a silent no-op.

### 2. Live panel placement — `src/shell/panelPlacement.ts` (new) and `extension.ts`

New module exporting a single function:

```ts
export function placeInPanelBox(container: Clutter.Actor, box: string, index: number): void
```

It resolves `left` / `center` / `right` against
`Main.panel._leftBox` / `_centerBox` / `_rightBox`, falling back to the right
box for any other value, removes the container from its current parent, and
inserts it at `index`. Access to those private fields is widened through a
local intersection type, the same idiom `island.ts` already uses for
`MenuWithOpenSignal`, rather than reaching for `any`.

`enable()` keeps its single `addToStatusArea` call. That call is what
registers `Main.panel.statusArea[uuid]` and hands the button's menu to the
panel's `menuManager`, and it must happen exactly once — repeating it on every
settings change would register the menu again. Subsequent moves only reparent
`island.container`, touching neither registration.

Two new handlers, `changed::panel-position` and `changed::panel-index`, call
the helper. The single `_settingsChangedId` field becomes `_settingsIds:
number[]`; the existing `safely('settings handler', …)` teardown step
disconnects every id in the array, preserving the current guarantee that one
failing teardown step cannot skip the rest.

### 3. Preferences — `src/prefs.ts`

**Appearance page.** The group description promising that "position changes
take effect after disabling and re-enabling the extension" is removed, since
it stops being true. Combo entries are capitalised to `Left` / `Center` /
`Right` while the `order` array driving the setting value is unchanged. The
Panel box row gains a subtitle noting that extensions replacing the top bar
(Dash to Panel) decide where each box lands on screen — the exact thing that
made this look broken.

**Agents page.** The per-agent row construction moves into a
`_agentRow(id, env, window)` helper returning `{ row, refresh }`. `refresh()`
reads `installState` and drives the row:

| state | subtitle | Install button | Remove button |
|---|---|---|---|
| `absent` | Not installed | label `Install`, sensitive | insensitive |
| `installed` | Hooks installed | label `Install`, insensitive | sensitive |
| `stale` | Hooks need updating — they don’t match what this version installs | label `Update`, sensitive | sensitive |
| `unreadable` | `<path>` is not valid JSON | insensitive | insensitive |

Every row's `refresh()` runs after any install or remove action, and on the
window's `notify::visible-page`, so switching to the Agents tab picks up edits
made to the config files outside the preferences window. The existing
"nothing to install/remove" toast stays as a backstop.

The per-agent enable switch is unrelated to hook installation — it gates
whether the D-Bus service accepts events — and keeps its current independent
behaviour.

## Testing

Unit tests extend `test/core/install/plan.test.ts` with an `installState`
group, run for all three agents:

- `absent` when the config file does not exist, and when it exists with only
  foreign entries
- `installed` when fed back the exact output of `planInstall`
- `stale` when fed that output with a different `hookPath` in `env`
- `unreadable` for malformed JSON
- the `absent` / `planUninstall`-empty invariant

Live placement depends on Clutter and is not unit-testable here. Manual check:
with the preferences window open, change Panel box and Position within the
box; the pill moves immediately, with no reload, and survives a subsequent
disable/enable at the same spot.

## Out of scope

Watching the agent config files with `Gio.FileMonitor` for continuous refresh;
`notify::visible-page` covers the realistic case. Reworking the enable switch
or the Behaviour page. Any change to hook payload handling.
