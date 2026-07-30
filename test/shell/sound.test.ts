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
    expect(body.indexOf('noticeVisible')).toBeLessThan(body.indexOf("_sound.play('notification')"))
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
    expect(body.indexOf('noticeVisible')).toBeLessThan(
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
