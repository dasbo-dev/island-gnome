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
