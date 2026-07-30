# Notification Sounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play a short themed sound when an agent asks a permission, asks a question, raises a notification, or finishes a session — silenceable with one switch in the preferences.

**Architecture:** A pure `src/core/sound.ts` holds the cue names and the `done`-transition diff; a single shell file `src/shell/soundPlayer.ts` is the only place that touches audio, via `global.display.get_sound_player().play_from_theme(...)`. Cues are raised from the three existing event paths in `Island` plus a state diff in `Island.refresh()`, all placed so sound is independent of the popup's own opening rules.

**Tech Stack:** TypeScript, GNOME Shell 46 (GJS), `Meta.SoundPlayer` via `global.display`, GSettings, Adw for preferences, vitest.

**Spec:** `docs/superpowers/specs/2026-07-30-notification-sounds-design.md`

## Global Constraints

- `src/core/` must never import `gi://` or `resource://`. `test/core/purity.test.ts` enforces this and will fail the whole suite if broken.
- Cue-to-theme-name map is exactly: `permission` → `dialog-warning`, `question` → `window-question`, `notification` → `message-new-instant`, `done` → `complete`.
- One GSettings key only: `notification-sounds`, type `b`, default `true`. No volume key, no per-event keys, no custom-file keys.
- Sound must fire even while a fullscreen window is on the primary monitor, and even when `auto-open-on-permission` / `notification-popup` are false.
- Sound must be silent when `org.gnome.desktop.sound event-sounds` is false.
- Per-cue throttle: 500 ms.
- No exception may escape into a GLib or Clutter callback from the sound path. Every audio call is wrapped, and a failure warns at most once per player instance.
- Test style in this repo: behaviour in `test/core/` with real imports; wiring in `test/shell/` by reading the source file as text and asserting on it (`readFileSync('src/shell/x.ts', 'utf8')`) — `gi://` imports cannot be loaded under vitest.
- Commands: `npm test` (vitest), `npm run typecheck` (both tsconfigs). Both must pass before each commit.

---

### Task 1: Cue names and the done-transition diff (pure core)

**Files:**
- Create: `src/core/sound.ts`
- Test: `test/core/sound.test.ts`

**Interfaces:**
- Consumes: `Session` and `SessionState` from `src/core/types.js`. `SessionState` is `'idle' | 'running' | 'waiting' | 'done' | 'error'`; `Session` has `key: string` and `state: SessionState`.
- Produces:
  - `type SoundCue = 'permission' | 'question' | 'notification' | 'done'`
  - `CUE_SOUNDS: Record<SoundCue, string>`
  - `CUE_DESCRIPTIONS: Record<SoundCue, string>`
  - `snapshotStates(sessions: Session[]): Map<string, SessionState>`
  - `newlyDone(prev: Map<string, SessionState>, next: Session[]): string[]`

- [x] **Step 1: Write the failing test**

Create `test/core/sound.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  CUE_SOUNDS,
  CUE_DESCRIPTIONS,
  newlyDone,
  snapshotStates,
  type SoundCue,
} from '../../src/core/sound.js'
import type { Session, SessionState } from '../../src/core/types.js'

function sess(key: string, state: SessionState): Session {
  return {
    key,
    agent: 'claude',
    sessionId: key,
    project: 'dasbo-island',
    cwd: '/home/me/projects/dasbo-island',
    state,
    pid: 4242,
    startedAt: 0,
    conversationIndex: 1,
    lastEventAt: 0,
  }
}

const CUES: SoundCue[] = ['permission', 'question', 'notification', 'done']

describe('cue sounds', () => {
  it('names a theme sound and a description for every cue', () => {
    for (const cue of CUES) {
      expect(CUE_SOUNDS[cue]).toBeTruthy()
      expect(CUE_DESCRIPTIONS[cue]).toBeTruthy()
    }
  })

  it('gives each cue a distinct sound, so two events never sound the same', () => {
    const names = CUES.map((c) => CUE_SOUNDS[c])
    expect(new Set(names).size).toBe(names.length)
  })

  it('uses the freedesktop names the spec settled on', () => {
    // Pinned by name: these exist in /usr/share/sounds/freedesktop/stereo, and
    // libcanberra falls back through the user's theme parents to find them. A
    // rename here is a behaviour change, not a refactor.
    expect(CUE_SOUNDS).toEqual({
      permission: 'dialog-warning',
      question: 'window-question',
      notification: 'message-new-instant',
      done: 'complete',
    })
  })

  it('describes each cue for the sound server, not with the theme name', () => {
    // The description reaches the sound server and can surface in a
    // per-application volume list, so it names the app and the event.
    for (const cue of CUES) {
      expect(CUE_DESCRIPTIONS[cue]).toMatch(/Dasbo Island/)
      expect(CUE_DESCRIPTIONS[cue]).not.toBe(CUE_SOUNDS[cue])
    }
  })
})

describe('snapshotStates', () => {
  it('maps every session key to its state', () => {
    const snap = snapshotStates([sess('a', 'running'), sess('b', 'done')])
    expect(snap.get('a')).toBe('running')
    expect(snap.get('b')).toBe('done')
  })

  it('drops keys absent from the new list, so a reaped session leaves no trace', () => {
    const snap = snapshotStates([sess('b', 'done')])
    expect(snap.has('a')).toBe(false)
    expect(snap.size).toBe(1)
  })
})

describe('newlyDone', () => {
  it('reports a session that just finished', () => {
    const prev = new Map<string, SessionState>([['a', 'running']])
    expect(newlyDone(prev, [sess('a', 'done')])).toEqual(['a'])
  })

  it('stays silent for a session that was already done', () => {
    const prev = new Map<string, SessionState>([['a', 'done']])
    expect(newlyDone(prev, [sess('a', 'done')])).toEqual([])
  })

  it('stays silent for a key it has never seen, even if it arrives done', () => {
    // Costs the rare session whose first event is its last, and buys silence at
    // enable(), where every session in a freshly built store would otherwise
    // look newly finished.
    expect(newlyDone(new Map(), [sess('a', 'done')])).toEqual([])
  })

  it('re-arms after done → running, so the next finish sounds again', () => {
    let prev = snapshotStates([sess('a', 'running')])
    expect(newlyDone(prev, [sess('a', 'done')])).toEqual(['a'])
    prev = snapshotStates([sess('a', 'done')])
    expect(newlyDone(prev, [sess('a', 'running')])).toEqual([])
    prev = snapshotStates([sess('a', 'running')])
    expect(newlyDone(prev, [sess('a', 'done')])).toEqual(['a'])
  })

  it('ignores every state that is not done', () => {
    const prev = new Map<string, SessionState>([['a', 'running']])
    for (const state of ['idle', 'running', 'waiting', 'error'] as SessionState[]) {
      expect(newlyDone(prev, [sess('a', state)])).toEqual([])
    }
  })

  it('reports several finishes in one pass', () => {
    const prev = new Map<string, SessionState>([
      ['a', 'running'],
      ['b', 'waiting'],
    ])
    expect(newlyDone(prev, [sess('a', 'done'), sess('b', 'done')])).toEqual(['a', 'b'])
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/core/sound.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/sound.js"`.

- [x] **Step 3: Write minimal implementation**

Create `src/core/sound.ts`:

```ts
import type { Session, SessionState } from './types.js'

/** The four things worth interrupting a user for. */
export type SoundCue = 'permission' | 'question' | 'notification' | 'done'

/**
 * XDG sound-theme names, not files. libcanberra resolves each through the
 * user's chosen theme and its parents down to `freedesktop`, so the extension
 * ships no audio and follows whatever the desktop already sounds like. The
 * cost, accepted in the design doc: on a sparse theme two cues can resolve to
 * the same fallback.
 */
export const CUE_SOUNDS: Record<SoundCue, string> = {
  permission: 'dialog-warning',
  question: 'window-question',
  notification: 'message-new-instant',
  done: 'complete',
}

/**
 * Human-readable event names, passed to the sound server rather than used to
 * pick the sound — they can surface in a per-application volume list, so they
 * name the extension and the event instead of repeating the theme name.
 */
export const CUE_DESCRIPTIONS: Record<SoundCue, string> = {
  permission: 'Dasbo Island: permission request',
  question: 'Dasbo Island: agent question',
  notification: 'Dasbo Island: notification',
  done: 'Dasbo Island: session finished',
}

/** The states of every live session, keyed for the next diff. */
export function snapshotStates(sessions: Session[]): Map<string, SessionState> {
  return new Map(sessions.map((s) => [s.key, s.state]))
}

/**
 * Keys whose state moved into 'done' since `prev` was taken.
 *
 * A key absent from `prev` never counts, even when it arrives already done: the
 * store is built fresh on every enable(), and treating unknown-as-new would
 * sound a cue for every session alive at that moment.
 */
export function newlyDone(prev: Map<string, SessionState>, next: Session[]): string[] {
  const keys: string[] = []
  for (const s of next) {
    if (s.state !== 'done') continue
    const was = prev.get(s.key)
    if (was === undefined || was === 'done') continue
    keys.push(s.key)
  }
  return keys
}
```

- [x] **Step 4: Run tests and typecheck**

Run: `npx vitest run test/core/sound.test.ts`
Expected: PASS, 11 tests.

Run: `npm test`
Expected: PASS — the whole suite, including `purity.test.ts`, which now also walks `src/core/sound.ts`.

Run: `npm run typecheck`
Expected: no output, exit 0.

- [x] **Step 5: Commit**

```bash
git add src/core/sound.ts test/core/sound.test.ts
git commit -m "feat(core): name a sound for each event, and spot a session finishing"
```

---

### Task 2: The setting and its preferences row

**Files:**
- Modify: `schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml` (add a key before `</schema>`)
- Modify: `src/prefs.ts:99-116` (the `Notifications` group in `_behaviourPage`)
- Test: `test/shell/sound.test.ts` (create — later tasks add to this file)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: the GSettings key `notification-sounds` (`b`, default `true`), which Task 3's `SoundPlayer` reads.

This task comes before the player because `Gio.Settings.get_boolean` on a key the compiled schema does not carry aborts the caller.

- [x] **Step 1: Write the failing test**

Create `test/shell/sound.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('the notification-sounds setting', () => {
  const schema = readFileSync(
    'schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml',
    'utf8'
  )
  const prefs = readFileSync('src/prefs.ts', 'utf8')

  it('is a boolean defaulting to on', () => {
    expect(schema).toMatch(/<key name="notification-sounds" type="b">/)
    const key = schema.slice(schema.indexOf('notification-sounds'))
    expect(key.slice(0, key.indexOf('</key>'))).toMatch(/<default>true<\/default>/)
  })

  it('ships exactly one sound key — no volume, no per-event switches', () => {
    // The design settled on one switch. A second sound key means the spec was
    // widened without the doc being updated.
    const soundKeys = schema.match(/<key name="[^"]*sound[^"]*"/g) ?? []
    expect(soundKeys).toEqual(['<key name="notification-sounds"'])
  })

  it('has a switch bound to it in the preferences', () => {
    expect(prefs).toMatch(/settings\.bind\('notification-sounds'/)
  })

  it('sits in the Notifications group, beside the other notification rows', () => {
    const group = prefs.indexOf("new Adw.PreferencesGroup({ title: 'Notifications' })")
    const row = prefs.indexOf("settings.bind('notification-sounds'")
    // 'private _agentsPage', not '_agentsPage': the call in
    // fillPreferencesWindow comes first in the file and would put this bound
    // before the group it is meant to follow.
    const nextPage = prefs.indexOf('private _agentsPage')
    expect(group).toBeGreaterThan(-1)
    expect(row).toBeGreaterThan(group)
    expect(row).toBeLessThan(nextPage)
  })

  it('tells the user the sound follows the desktop, and can be off system-wide', () => {
    const row = prefs.slice(prefs.indexOf('notificationSounds'))
    const subtitle = row.slice(0, row.indexOf('})'))
    expect(subtitle).toMatch(/sound theme/)
    expect(subtitle).toMatch(/system sounds/)
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/shell/sound.test.ts`
Expected: FAIL, 5 failures — the schema has no such key and `prefs.ts` binds nothing.

- [x] **Step 3: Add the schema key**

In `schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml`, insert immediately after the `done-linger` key's closing `</key>` and before `</schema>`:

```xml
    <key name="notification-sounds" type="b">
      <default>true</default>
      <summary>Play a sound for events that need you</summary>
      <description>A permission request, an agent's question, a notification, and a session finishing. Sounds come from the desktop's sound theme, and stay silent when the system's own event sounds are off.</description>
    </key>
```

- [x] **Step 4: Add the preferences row**

In `src/prefs.ts`, in `_behaviourPage`, after the `notificationSeconds` block and before `page.add(notifications)`:

```ts
    const notificationSounds = new Adw.SwitchRow({
      title: 'Play a sound',
      subtitle:
        'When an agent needs an answer, raises a notification, or finishes. Uses your desktop’s sound theme, and stays silent when system sounds are off.',
    })
    settings.bind('notification-sounds', notificationSounds, 'active', 0)
    notifications.add(notificationSounds)
```

- [x] **Step 5: Run tests and typecheck**

Run: `npx vitest run test/shell/sound.test.ts`
Expected: PASS, 5 tests.

Run: `npm test && npm run typecheck`
Expected: both pass.

- [x] **Step 6: Commit**

```bash
git add schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml src/prefs.ts test/shell/sound.test.ts
git commit -m "feat(prefs): add one switch for notification sounds"
```

---

### Task 3: The player — the only file that touches audio

> **Superseded during review.** The code snippet in Step 3 below is left
> exactly as originally planned — this is a record of what was planned, not a
> plan retro-fitted to its outcome — but it is no longer what ships. Treat
> `src/shell/soundPlayer.ts` and the spec's Architecture section
> (`docs/superpowers/specs/2026-07-30-notification-sounds-design.md`) as
> authoritative. Four ways the snippet below is now out of date:
>
> 1. It declares a local `const THROTTLE_MS = 500` inside the player. The
>    constant, and the whole play/mute decision (`shouldPlay`), moved to
>    `src/core/sound.ts` so the rules are unit-testable rather than only
>    greppable out of this file's source — see `4205354`.
> 2. It reads the clock with `Date.now()`. The real file reads
>    `GLib.get_monotonic_time() / 1000`: the wall clock is not monotonic, and a
>    backwards NTP step would leave every cue's stamp in the future and
>    silence it for the whole of the step.
> 3. It has no `markDestroyed()` method or `_destroyed` flag. The real file
>    needs both so `disable()` can silence the player before
>    `resolveAllFallthrough()` runs — that call can settle a held permission to
>    `done` and reach `play('done')` while the island is still alive, ahead of
>    the player's own teardown step.
> 4. Its constructor has no `settings_schema.has_key('notification-sounds')`
>    guard before the first `get_boolean` call. Without it, a skipped schema
>    recompile means `get_boolean` on a key absent from the *compiled* schema
>    is `g_error`, which aborts the whole shell process on the user's first
>    permission request — not merely a missing beep.
>
> The test snippet in Step 1 is stale the same way: it names `island.ts` and
> `extension.ts` by hand to check they contain no second `play_from_theme`
> call, where the real `test/shell/sound.test.ts` walks all of `src/` instead,
> so a third file added later is caught too. Anyone executing this task fresh
> from the snippet below would rebuild the compositor-abort hazard item 4
> removed; don't.

**Files:**
- Create: `src/shell/soundPlayer.ts`
- Test: `test/shell/sound.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `CUE_SOUNDS`, `CUE_DESCRIPTIONS`, `SoundCue` from `src/core/sound.js` (Task 1); the `notification-sounds` key (Task 2).
- Produces:
  - `class SoundPlayer`
  - `new SoundPlayer(settings: Gio.Settings)` — the extension's own settings object
  - `play(cue: SoundCue): void`
  - `markDestroyed(): void`
  - `destroy(): void`

`SoundPlayer` cannot be imported under vitest — it imports `gi://Gio` and reads the GJS global `global`. Its guarantees are pinned as source assertions, which is how `test/shell/` already covers `agentChip.ts` and `agentIcon.ts`.

- [x] **Step 1: Write the failing test**

Append to `test/shell/sound.test.ts`:

```ts
describe('SoundPlayer', () => {
  const src = readFileSync('src/shell/soundPlayer.ts', 'utf8')

  it('is the only file in the tree that plays audio', () => {
    // Grepped rather than imported: a second play site would mean a second
    // place to forget the mute checks and the try/catch below.
    const shell = readFileSync('src/shell/island.ts', 'utf8')
    const extension = readFileSync('src/extension.ts', 'utf8')
    expect(src).toContain('play_from_theme')
    expect(shell).not.toContain('play_from_theme')
    expect(extension).not.toContain('play_from_theme')
  })

  it('checks the extension’s own switch before playing anything', () => {
    expect(src.indexOf("get_boolean('notification-sounds')")).toBeLessThan(
      src.indexOf('play_from_theme')
    )
  })

  it('checks the desktop’s event-sounds key before playing anything', () => {
    // Ours, not inherited: mutter's player calls libcanberra directly and is
    // not known to consult this key, and a beep on a desktop the user
    // silenced is the worst thing this feature can do.
    expect(src).toContain('org.gnome.desktop.sound')
    expect(src.indexOf("get_boolean('event-sounds')")).toBeLessThan(
      src.indexOf('play_from_theme')
    )
  })

  it('looks the desktop schema up instead of constructing it blind', () => {
    // new Gio.Settings on a missing schema_id aborts the process — it would
    // take the whole shell down, not just the sound.
    expect(src).toContain('SettingsSchemaSource')
    expect(src).not.toMatch(/schema_id:\s*'org\.gnome\.desktop\.sound'/)
  })

  it('throttles per cue rather than globally', () => {
    // Two sessions can reach one cue in a single tick; a permission and a
    // notification arriving together must still both be heard.
    expect(src).toMatch(/THROTTLE_MS\s*=\s*500/)
    expect(src).toMatch(/_last\.get\(cue\)/)
    expect(src).toMatch(/_last\.set\(cue/)
  })

  it('wraps the play call, because an exception here removes a GLib source', () => {
    const play = src.slice(src.indexOf('play_from_theme'))
    expect(src.slice(0, src.indexOf('play_from_theme'))).toMatch(/try\s*{/)
    expect(play).toMatch(/catch/)
  })

  it('warns at most once, because this path runs from a 1s refresh', () => {
    expect(src).toMatch(/_warned/)
    expect(src).toMatch(/if\s*\(!this\._warned\)/)
  })

  it('has nothing timer-shaped to leak', () => {
    // The throttle is a timestamp comparison. A timeout_add here would need
    // removing in destroy(), and destroy() is reached from teardown paths that
    // already swallow throws.
    expect(src).not.toContain('timeout_add')
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/shell/sound.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, open 'src/shell/soundPlayer.ts'`.

- [x] **Step 3: Write the implementation**

Create `src/shell/soundPlayer.ts`:

```ts
import Gio from 'gi://Gio'
import { CUE_DESCRIPTIONS, CUE_SOUNDS, type SoundCue } from '../core/sound.js'

/**
 * Minimum gap between two plays of the same cue. Two sessions can reach one
 * cue inside a single store emit, and two overlapping copies of the same
 * theme sound read as a glitch rather than as two events. Per cue, not
 * global: a permission and a notification arriving together are both heard.
 */
const THROTTLE_MS = 500

/**
 * The desktop's own "event sounds" switch, or null when the schema is not
 * installed. Looked up rather than constructed by id: `new Gio.Settings` on an
 * unknown schema_id calls g_error, which aborts the whole shell process — a
 * price far past anything a missing beep is worth.
 */
function desktopSoundSettings(): Gio.Settings | null {
  const schema = Gio.SettingsSchemaSource.get_default()?.lookup(
    'org.gnome.desktop.sound',
    true
  )
  return schema ? new Gio.Settings({ settings_schema: schema }) : null
}

/**
 * Plays the XDG theme sound for a cue. The only place in the extension that
 * makes a noise, so it is also the only place the mute checks, the throttle
 * and the catch have to be right.
 */
export class SoundPlayer {
  private _settings: Gio.Settings
  private _desktop: Gio.Settings | null
  private _last = new Map<SoundCue, number>()
  private _warned = false

  constructor(settings: Gio.Settings) {
    this._settings = settings
    this._desktop = desktopSoundSettings()
  }

  play(cue: SoundCue): void {
    if (!this._settings.get_boolean('notification-sounds')) return
    // A desktop with no gnome-desktop schemas cannot say it wants silence, so
    // it is not read as saying so — the extension's own switch above still
    // governs. Only an explicit false silences this.
    if (this._desktop && !this._desktop.get_boolean('event-sounds')) return

    const now = Date.now()
    if (now - (this._last.get(cue) ?? 0) < THROTTLE_MS) return
    // Stamped before the attempt, not after: a failing play should still hold
    // the gap open rather than let every caller in the next tick retry it.
    this._last.set(cue, now)

    try {
      global.display
        .get_sound_player()
        .play_from_theme(CUE_SOUNDS[cue], CUE_DESCRIPTIONS[cue], null)
    } catch (e) {
      // Once. This is reached from Island.refresh(), which runs on a 1s timer
      // while the popup is open, and a warn per tick would bury the journal.
      if (!this._warned) {
        this._warned = true
        console.warn(`dasbo-island: playing a sound failed, staying silent: ${e}`)
      }
    }
  }

  destroy(): void {
    this._last.clear()
    this._desktop = null
  }
}
```

- [x] **Step 4: Run tests and typecheck**

Run: `npx vitest run test/shell/sound.test.ts`
Expected: PASS, 13 tests. (True at this task's own commit, `379913f`. The
supersession note above the task explains why: review reshaped the player and
added more source assertions, so `test/shell/sound.test.ts` as it exists in
the repo today — the same file this step names — has 31, not 13. Running this
exact command against the current tree will not reproduce 13.)

Run: `npm test && npm run typecheck`
Expected: both pass. If `typecheck` objects to `get_sound_player()`'s return type, do not cast to `any` — report it; `Meta-14.typelib` declares the method and `@girs/gnome-shell` 46.0.2 should carry it.

- [x] **Step 5: Commit**

```bash
git add src/shell/soundPlayer.ts test/shell/sound.test.ts
git commit -m "feat(shell): play a themed sound, unless something asked for silence"
```

---

### Task 4: Sound the permission and the question

**Files:**
- Modify: `src/dbus/service.ts:19-20` (the `onPermissionOpened` option) and its two call sites (~line 208 and ~line 237)
- Modify: `src/shell/island.ts:101` (constructor), the private-field block (~line 48), and `notifyPermissionOpened` (~line 275)
- Modify: `src/extension.ts` (construct the player, pass it, destroy it, forward the cue kind)
- Test: `test/shell/sound.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `SoundPlayer` and `play(cue)` from Task 3; `SoundCue` from Task 1.
- Produces:
  - `ServiceOptions.onPermissionOpened: (kind: 'permission' | 'question') => void`
  - `Island` constructor becomes `(store, settings, iconBase, sound)`
  - `Island.notifyPermissionOpened(kind: 'permission' | 'question'): void`

`'permission'` and `'question'` are deliberately the cue names themselves, so the kind can be passed straight to `play` with no second map to keep in step.

- [x] **Step 1: Write the failing test**

Append to `test/shell/sound.test.ts`:

```ts
describe('sounding a permission and a question', () => {
  const service = readFileSync('src/dbus/service.ts', 'utf8')
  const island = readFileSync('src/shell/island.ts', 'utf8')
  const extension = readFileSync('src/extension.ts', 'utf8')

  it('tells the island which of the two arrived', () => {
    // One handler, two call sites that already exist separately in service.ts —
    // they only ever discarded which one they were.
    expect(service).toContain("onPermissionOpened('question')")
    expect(service).toContain("onPermissionOpened('permission')")
    expect(service).toMatch(/onPermissionOpened:\s*\(kind:\s*'permission'\s*\|\s*'question'\)/)
  })

  it('never calls the handler without a kind', () => {
    expect(service).not.toMatch(/onPermissionOpened\(\)/)
    expect(extension).not.toMatch(/notifyPermissionOpened\(\)/)
  })

  it('plays before the auto-open switch is even read', () => {
    // "Independent of the popup's rules" by construction rather than by
    // comment: in fullscreen the pill is invisible, so sound is the only
    // channel left, and it covers nothing on screen.
    const body = island.slice(island.indexOf('notifyPermissionOpened('))
    const play = body.indexOf('_sound.play(kind)')
    expect(play).toBeGreaterThan(-1)
    expect(play).toBeLessThan(body.indexOf("get_boolean('auto-open-on-permission')"))
    expect(play).toBeLessThan(body.indexOf('inFullscreen'))
  })

  it('plays before the notice timer is even touched', () => {
    const body = island.slice(island.indexOf('notifyPermissionOpened('))
    expect(body.indexOf('_sound.play(kind)')).toBeLessThan(body.indexOf('_noticeOpened = false'))
  })

  it('is handed a player it does not own', () => {
    expect(island).toMatch(/private _sound!: SoundPlayer/)
    expect(island).not.toMatch(/new SoundPlayer/)
    expect(extension).toMatch(/new SoundPlayer\(settings\)/)
  })

  it('destroys the player during teardown, inside the safely wrapper', () => {
    // Every other teardown step is wrapped so one throw cannot skip the rest.
    expect(extension).toMatch(/safely\('sound player',[\s\S]*?_sound\?\.destroy\(\)/)
    expect(extension).toMatch(/this\._sound = null/)
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/shell/sound.test.ts`
Expected: FAIL, 6 failures in the new block.

- [x] **Step 3: Give the service option a kind**

In `src/dbus/service.ts`, replace the option declaration:

```ts
  /** Called after a permission row appears, so the UI can pulse and auto-open. */
  onPermissionOpened: () => void
```

with:

```ts
  /**
   * Called after a permission row appears, so the UI can pulse, auto-open and
   * sound. The kind is the two callers' only difference, and it doubles as the
   * sound cue's name, so no second map has to stay in step with it.
   */
  onPermissionOpened: (kind: 'permission' | 'question') => void
```

Then the question call site:

```ts
        if (this.store.get(key)?.pendingQuestion?.id === qid) this.opts.onPermissionOpened('question')
```

and the permission call site:

```ts
      if (this.store.get(key)?.pendingPermission?.id === id) this.opts.onPermissionOpened('permission')
```

- [x] **Step 4: Take the player into the island**

In `src/shell/island.ts`, add the import beside the other shell imports:

```ts
import type { SoundPlayer } from './soundPlayer.js'
```

Add the field next to `private _iconBase!: string`:

```ts
    private _sound!: SoundPlayer
```

Widen the constructor:

```ts
    constructor(store: SessionStore, settings: Gio.Settings, iconBase: string, sound: SoundPlayer) {
      super(0.5, 'Dasbo Island')
      this._store = store
      this._settings = settings
      // Owned by extension.ts, which also destroys it. Passed in for the same
      // reason iconBase is: a widget that reaches for its own dependencies is
      // a widget that reaches for the wrong one after a reload.
      this._sound = sound
```

(leave the existing `iconBase` assignment and its comment in place, below this)

Replace the head of `notifyPermissionOpened`:

```ts
    notifyPermissionOpened(kind: 'permission' | 'question'): void {
      // First, above even the notice-timer reset: sound is deliberately
      // independent of every popup rule below it. In fullscreen the pill is
      // invisible and the popup is suppressed, which is exactly when the sound
      // is the only signal left — and unlike the popup, it covers nothing.
      this._sound.play(kind)
      // Unconditionally, and before the guards below: the popup is now up for
```

(the rest of the method is unchanged)

- [x] **Step 5: Wire it in the extension**

In `src/extension.ts`, add the import:

```ts
import { SoundPlayer } from './shell/soundPlayer.js'
```

Add the field beside `_settings`:

```ts
  private _sound: SoundPlayer | null = null
```

In `enable()`, replace the island construction:

```ts
    this._permissions = new PermissionTable(this._store, glibTimers)
    this._sound = new SoundPlayer(settings)
    this._island = new Island(this._store, settings, this.path, this._sound)
```

Forward the kind in the service options:

```ts
      onPermissionOpened: (kind) => this._island?.notifyPermissionOpened(kind),
```

In `disable()`, after the `safely('island', ...)` step:

```ts
    safely('sound player', () => {
      // After the island, which is the only thing that calls play().
      this._sound?.destroy()
      this._sound = null
    })
```

- [x] **Step 6: Run tests and typecheck**

Run: `npx vitest run test/shell/sound.test.ts`
Expected: PASS, 19 tests.

Run: `npm test && npm run typecheck`
Expected: both pass. A typecheck error naming `Island`'s constructor arity means a call site was missed — `src/extension.ts` is the only one.

- [x] **Step 7: Commit**

```bash
git add src/dbus/service.ts src/shell/island.ts src/extension.ts test/shell/sound.test.ts
git commit -m "feat(shell): sound a permission and a question, whatever the popup does"
```

---

### Task 5: Sound the notification and the finish

**Files:**
- Modify: `src/shell/island.ts` — `notifyNotification` (~line 289) and `refresh` (~line 742), plus one new private field
- Test: `test/shell/sound.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `Island._sound` (Task 4); `newlyDone`, `snapshotStates` from `src/core/sound.js` (Task 1); `noticeVisible` from `src/core/activity.js`, already imported by `island.ts`.
- Produces: nothing consumed by later tasks.

Two changes with different shapes. The notification cue **reorders** existing guards: `noticeVisible` moves above the two popup-policy reads, because it is the only one of the three that answers "is there anything here at all". The finish cue is a state diff in `refresh()`, because no event carries "finished" — `clearPending` also settles a session to `done`, and a service-level hook would miss that path.

- [x] **Step 1: Write the failing test**

Append to `test/shell/sound.test.ts`:

```ts
describe('sounding a notification', () => {
  const island = readFileSync('src/shell/island.ts', 'utf8')
  const body = island.slice(
    island.indexOf('notifyNotification('),
    island.indexOf('notifyTasksChanged(')
  )

  it('asks whether there is anything to hear before it plays', () => {
    // A notification arriving while a permission still holds the row shows
    // nothing new, so it must sound nothing either — and Claude's
    // notification payload is inferred rather than captured, so an
    // unrecognised message field has to stay silent rather than beep at an
    // empty popup.
    // Corrected in 3508ba4: the bare identifier 'noticeVisible' also matches
    // this describe block's own prose comment above, which mentions it before
    // the executable guard does — so the assertion passed even with the guard
    // moved anywhere before play(). Anchored on the if-check itself instead.
    expect(body.indexOf('if (!session || !noticeVisible(')).toBeLessThan(body.indexOf("_sound.play('notification')"))
  })

  it('plays before the popup policy is read, not after', () => {
    const play = body.indexOf("_sound.play('notification')")
    expect(play).toBeGreaterThan(-1)
    expect(play).toBeLessThan(body.indexOf("get_boolean('notification-popup')"))
    expect(play).toBeLessThan(body.indexOf('inFullscreen'))
  })

  it('keeps noticeVisible ahead of the policy guards it was moved past', () => {
    // Pinned so a later edit cannot quietly put policy back in front: with
    // notification-popup off, an early return there would skip the sound too.
    // Corrected in 3508ba4, same reason as above: anchor on the if-check, not
    // the bare identifier that the prose comment also contains.
    expect(body.indexOf('if (!session || !noticeVisible(')).toBeLessThan(
      body.indexOf("get_boolean('notification-popup')")
    )
  })
})

describe('sounding a finish', () => {
  const island = readFileSync('src/shell/island.ts', 'utf8')
  const refresh = island.slice(island.indexOf('refresh(): void'), island.indexOf('destroy(): void'))

  it('diffs states rather than listening for an event', () => {
    // No event carries "finished": store.apply reaches done through its state
    // switch, and so does clearPending when a session ends while a permission
    // is held. A diff catches both.
    expect(refresh).toContain('newlyDone(')
    expect(refresh).toContain('snapshotStates(')
    expect(island).toMatch(/private _lastStates = new Map<string, SessionState>\(\)/)
  })

  it('cues and re-snapshots above the zero-session early return', () => {
    // refresh() returns early when the pill is hidden. Below that return, the
    // snapshot would go stale and the next visible refresh would replay old
    // finishes.
    const cue = refresh.indexOf("_sound.play('done')")
    const snapshot = refresh.indexOf('_lastStates = snapshotStates(')
    const earlyReturn = refresh.indexOf("get_boolean('always-show')")
    expect(cue).toBeGreaterThan(-1)
    expect(cue).toBeLessThan(earlyReturn)
    expect(snapshot).toBeGreaterThan(cue)
    expect(snapshot).toBeLessThan(earlyReturn)
  })

  it('imports the diff from core, where it is unit-tested', () => {
    expect(island).toMatch(/from '\.\.\/core\/sound\.js'/)
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/shell/sound.test.ts`
Expected: FAIL, 6 failures in the two new blocks.

- [x] **Step 3: Reorder and sound the notification**

In `src/shell/island.ts`, in `notifyNotification`, the current head is:

```ts
    notifyNotification(key: string): void {
      if (!this._settings.get_boolean('notification-popup')) return
      if (Main.layoutManager.primaryMonitor?.inFullscreen) return
```

followed by the long comment ending in `// notice at all.` and then:

```ts
      const session = this._store.get(key)
      if (!session || !noticeVisible(session, Date.now())) return
```

Rewrite that span so the store read comes first, the cue follows, and the two policy guards come last. Keep the existing long comment verbatim — it explains the `noticeVisible` test, which is now the first thing here — and add the sentence marked below:

```ts
    notifyNotification(key: string): void {
      // ... existing comment block, unchanged, plus:
      // Now the first test in this method rather than the third, because it is
      // the only one of the three that answers "is there anything here at
      // all". The two policy guards below decide whether to *show* it; sound
      // must not sit behind them, but must sit behind this — beeping for a
      // message the row will not display is the audible form of the empty
      // popup this check exists to prevent.
      const session = this._store.get(key)
      if (!session || !noticeVisible(session, Date.now())) return

      this._sound.play('notification')

      if (!this._settings.get_boolean('notification-popup')) return
      if (Main.layoutManager.primaryMonitor?.inFullscreen) return
```

The rest of the method — `_cancelNoticeClose()`, the `seconds` read, `wasClosed`, the open and the close timer — is unchanged and stays below.

- [x] **Step 4: Diff for finishes in refresh**

In `src/shell/island.ts`, extend the core-sound import (or add it beside the `pillState` import):

```ts
import { newlyDone, snapshotStates } from '../core/sound.js'
```

Add the field beside `private _rows`:

```ts
    /**
     * Session states as of the last refresh, so a move into 'done' can be
     * spotted. Only this diff reads it; the rows rebuild from the store.
     */
    private _lastStates = new Map<string, SessionState>()
```

Then in `refresh()`, insert between `const sessions = this._store.list()` and `const count = sessions.length`:

```ts
      // Above the early return below, deliberately: with the pill hidden and no
      // sessions, that return would leave the snapshot stale and the next
      // visible refresh would replay finishes already sounded. Silent when
      // nothing moved, which is what makes the 1s tick, the always-show handler
      // and the fullscreen handler all free.
      if (newlyDone(this._lastStates, sessions).length > 0) this._sound.play('done')
      this._lastStates = snapshotStates(sessions)
```

Tested for emptiness rather than looped over: every finish plays the same cue, and the player's per-cue throttle would collapse a batch of simultaneous finishes into one sound anyway. A loop whose body ignores its key would only claim to do something the throttle undoes.

- [x] **Step 5: Run tests and typecheck**

Run: `npx vitest run test/shell/sound.test.ts`
Expected: PASS, 25 tests. (True at this task's own commit, `d4681e2`. As with
Task 3's step 4, `test/shell/sound.test.ts` in the repo today has 31 — six
more, added by the review commits described in Task 3's supersession note,
none of which is its own Task in this plan.)

Run: `npm test && npm run typecheck`
Expected: both pass.

- [x] **Step 6: Commit**

```bash
git add src/shell/island.ts test/shell/sound.test.ts
git commit -m "feat(shell): sound a notification and a finished session"
```

---

### Task 6: Verify on a live shell, then document

**Files:**
- Modify: `README.md` (a paragraph after the notification paragraph, and a line in the unverified-claims material)
- No test changes.

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Install and reload**

Run:
```bash
make install
```
Expected: `Installed. Log out and back in (X11), then: gnome-extensions enable dasbo-island@ayubaswad.gmail.com`

Then reload the shell — on X11, `Alt+F2`, `r`, Enter; on Wayland, log out and back in.

- [ ] **Step 2: Hear all four cues**

`tools/fake-agent.js` takes `session|tool|perm|ask|tasks|notify|sessionend [session-id]` and has no help flag; its usage line is the comment at the top of the file. Run each of the four and listen:

```bash
tools/fake-agent.js session          # a row to attach the rest to
tools/fake-agent.js perm             # dialog-warning
tools/fake-agent.js ask              # window-question
tools/fake-agent.js notify           # message-new-instant
tools/fake-agent.js sessionend       # complete
```

Expected: a different sound for each of the last four, one sound per event.

Then check the throttle with two sessions finishing together:

```bash
tools/fake-agent.js session s1 && tools/fake-agent.js session s2
tools/fake-agent.js sessionend s1 && tools/fake-agent.js sessionend s2
```

Expected: **one** `complete`, not two — the two finishes land inside the same 500 ms window.

- [ ] **Step 3: Check every mute path**

- Turn **Play a sound** off in the preferences (`gnome-extensions prefs dasbo-island@ayubaswad.gmail.com`), re-run `tools/fake-agent.js perm`. Expected: popup opens, silence.
- Turn it back on, then `gsettings set org.gnome.desktop.sound event-sounds false`, re-run. Expected: silence. Restore with `gsettings set org.gnome.desktop.sound event-sounds true`.
- With a fullscreen window on the primary monitor, re-run. Expected: **sound plays**, popup does not open.
- Check the journal for anything from this extension: `journalctl --user -b -g dasbo-island | tail -20`. Expected: no sound-related warning.

**Added after review — these three were missing from the original checklist, and each checks a fix or a decision the review made:**

- **`/clear` in a live Claude session** (not `tools/fake-agent.js sessionend` — the actual `/clear` slash command, so the real `SessionEnd` hook fires with its real `reason`). Expected: **no** `complete` cue. This is the check that proves `70ea012` actually works end to end; the unit tests only prove `newlyDone` skips a session carrying `endedByClear`, not that a real `/clear` sets it.
- **The deferred-settle path** — the entire justification for catching `done` with a state diff in `refresh()` rather than hooking `session-end` directly: run `tools/fake-agent.js perm`, then `tools/fake-agent.js sessionend` for the *same* session id while that permission is still pending, then answer the permission. Expected: **no** `complete` when `sessionend` arrives, and `complete` only once the permission resolves and `clearPending` settles the session to `done`.
- **A notification with "Open the popup on a notification" switched off**: turn `notification-popup` off in the preferences, then `tools/fake-agent.js notify`. Expected: the sound still plays, and the popup stays shut — sound is not gated by that switch.

If any of these disagrees with the plan, stop and report it rather than adjusting the test to match — the fullscreen case in particular is a design decision, not an accident.

- [x] **Step 4: Write the README paragraphs**

In `README.md`, after the paragraph describing what happens when an agent says it is waiting on you, add:

```markdown
Each of those moments also makes a sound: a permission request, an agent's
question, a notification, and a session finishing, each with its own cue. The
sounds come from your desktop's sound theme rather than from this extension, so
they match everything else on the system, and they stay silent when GNOME's own
event sounds are off. Unlike the popup, sound is not suppressed by a fullscreen
window — that is when the pill is least visible and the sound is most useful.
One switch in the preferences turns all four off.
```

In the same file, alongside the existing notes about unverified behaviour, add:

```markdown
Whether GNOME's own `event-sounds` setting is honoured by mutter's sound player
has not been verified; this extension checks the key itself before playing, so
the setting is respected either way.
```

- [x] **Step 5: Verify the docs match the code**

Run: `npm test && npm run typecheck`
Expected: both pass.

Run: `grep -n "sound" README.md`
Expected: the two new passages, and no claim that the extension ships audio files.

- [x] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: say what the island sounds like, and what stays unverified"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Cue-to-theme-name map | 1 |
| `description` argument content | 1 (`CUE_DESCRIPTIONS`) |
| `newlyDone` / `snapshotStates` | 1 |
| Schema key, default on | 2 |
| Preferences switch, copy, placement | 2 |
| Three mute checks in order | 3 as planned; moved to `shouldPlay` in `src/core/sound.ts` during review (`4205354`) — see Task 3's supersession note |
| 500 ms per-cue throttle | 3 as planned; `THROTTLE_MS` moved to `src/core/sound.ts` alongside `shouldPlay` in the same review commit — see Task 3's supersession note |
| `try`/`catch`, warn once, null cancellable | 3 |
| `destroy()` clears throttle, no timers | 3 |
| Permission and question cues, kind argument | 4 |
| Cue above every popup guard | 4 |
| Player owned and destroyed by `extension.ts` | 4 |
| Notification cue, `noticeVisible` reorder | 5 |
| Done cue by diff in `refresh()` | 5 |
| Edge cases: unknown key, reaped, `done`→`running` | 1 (tested), 5 (wired) |
| README note on what stays unverified | 6 |

No spec section is unclaimed. One addition the spec implies but does not spell out: the `Gio.SettingsSchemaSource` lookup in Task 3, because `new Gio.Settings({schema_id})` on a missing schema aborts the process rather than throwing — a hazard worth naming, not a scope change.

**Placeholder scan:** No TBD, no "add error handling", no "similar to Task N". Every code step carries the code. Task 6's steps 2 and 3 are manual verification with expected outcomes rather than code, which is the only honest form for "does it make a sound".

**Type consistency:** `SoundCue`'s four members are the cue names used verbatim in `CUE_SOUNDS`, `CUE_DESCRIPTIONS`, `play(cue)`, `onPermissionOpened(kind)` and `play(kind)` — one vocabulary, no second map. `newlyDone(prev: Map<string, SessionState>, next: Session[]): string[]` and `snapshotStates(sessions: Session[]): Map<string, SessionState>` compose in `refresh()` exactly as declared in Task 1. `Island`'s constructor gains its fourth parameter in Task 4 and `src/extension.ts` is the only call site.
