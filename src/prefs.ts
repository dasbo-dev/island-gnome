import Adw from 'gi://Adw'
import Gtk from 'gi://Gtk'
import GLib from 'gi://GLib'
import type Gio from 'gi://Gio'
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js'
import {
  planInstall,
  planUninstall,
  installState,
  configPath,
  type InstallEnv,
} from './core/install/plan.js'
import { applyEdits, readFileOrNull } from './shell/applyEdits.js'
import { adapters } from './core/adapters/index.js'
import { AGENT_CATALOG, type CatalogEntry } from './core/agentCatalog.js'
import { installRowText, installToast } from './core/install/messages.js'
import { aboutPage } from './prefs/about.js'
import { PREFS_WINDOW } from './core/prefsWindow.js'
import { PREFS_LABEL } from './core/vocabulary.js'

export default class DasboIslandPreferences extends ExtensionPreferences {
  // GNOME 46 types the base method as returning void, GNOME 50 as returning
  // Promise<void>, and the `Promise<void> | void` this used to declare
  // satisfies the second no better than the first. A Promise is assignable to
  // a void-returning base, so declaring Promise<void> holds on both.
  //
  // Deliberately not `async`. The shell calls this without awaiting it
  // (extensionPrefsDialog.js: `prefsObj.fillPreferencesWindow(this)`), so under
  // `async` a throw in here would become an unhandled rejection and leave a
  // blank window instead of the shell's error page. Staying synchronous keeps
  // exceptions propagating to the caller the way they do today.
  fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
    const settings = this.getSettings()

    // The default size, not a size request: it only sets the size the window
    // opens at for this one showing, and libadwaita's own minimums still
    // apply. Nothing persists it — the shell builds a fresh
    // ExtensionPrefsDialog on every open and drops it on close, so a resize
    // lasts only as long as this window stays open. Neither the shell nor
    // libadwaita sets a default size itself, so without this the window
    // opened at its natural size — too short for the About page, whose
    // Support group ended up below the fold.
    window.set_default_size(PREFS_WINDOW.width, PREFS_WINDOW.height)

    window.add(this._appearancePage(settings))
    window.add(this._behaviorPage(settings))
    window.add(this._agentsPage(settings, window))
    window.add(aboutPage(window, this.path, this._version()))

    return Promise.resolve()
  }

  // Read from the extension's own metadata rather than a constant, so a
  // release bump cannot leave the About page telling the user the wrong
  // version. version-name is the human string ("0.1.0"); version is the
  // integer e.g.o. uses, and is the fallback if version-name is ever dropped.
  private _version(): string {
    return String(this.metadata['version-name'] ?? this.metadata.version ?? 'unknown')
  }

  private _appearancePage(settings: Gio.Settings): Adw.PreferencesPage {
    const page = new Adw.PreferencesPage({ title: 'Appearance', icon_name: 'preferences-desktop-display-symbolic' })
    const group = new Adw.PreferencesGroup({
      title: 'Panel',
      description: 'Extensions that replace the top bar, such as Dash to Panel, decide where each box lands on screen.',
    })

    const position = new Adw.ComboRow({
      title: PREFS_LABEL['panel-position']!,
      subtitle: 'Where the island sits in the top bar',
      model: Gtk.StringList.new(['Left', 'Center', 'Right']),
    })
    const order = ['left', 'center', 'right']
    position.selected = Math.max(0, order.indexOf(settings.get_string('panel-position')))
    position.connect('notify::selected', () => {
      settings.set_string('panel-position', order[position.selected] ?? 'center')
    })
    group.add(position)

    const index = new Adw.SpinRow({
      title: PREFS_LABEL['panel-index']!,
      adjustment: new Gtk.Adjustment({ lower: 0, upper: 20, step_increment: 1 }),
    })
    settings.bind('panel-index', index, 'value', 0)
    group.add(index)

    const alwaysShow = new Adw.SwitchRow({
      title: PREFS_LABEL['always-show']!,
      subtitle: 'Keep the island visible even when no agent session is active',
    })
    settings.bind('always-show', alwaysShow, 'active', 0)
    group.add(alwaysShow)

    page.add(group)

    // Its own group rather than an addition to "Panel": that group is entirely
    // about where the island sits in the top bar, and the chip is inside the
    // popup. Filing it there would make the group's title a lie.
    const rows = new Adw.PreferencesGroup({
      title: 'Session rows',
      description: 'A row whose mark is missing shows the name whatever this says.',
    })

    const chipDisplay = new Adw.ComboRow({
      title: PREFS_LABEL['agent-chip-display']!,
      subtitle: 'What the tag at the head of each row shows',
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
  }

  private _behaviorPage(settings: Gio.Settings): Adw.PreferencesPage {
    const page = new Adw.PreferencesPage({ title: 'Behavior', icon_name: 'preferences-system-symbolic' })
    const group = new Adw.PreferencesGroup({ title: 'Permissions' })

    const timeout = new Adw.SpinRow({
      title: PREFS_LABEL['permission-timeout']!,
      subtitle: 'Seconds before falling through to the agent’s own prompt. Zero waits indefinitely.',
      adjustment: new Gtk.Adjustment({ lower: 0, upper: 3600, step_increment: 5 }),
    })
    settings.bind('permission-timeout', timeout, 'value', 0)
    group.add(timeout)

    const autoOpen = new Adw.SwitchRow({
      title: PREFS_LABEL['auto-open-on-permission']!,
      subtitle: 'Suppressed while a fullscreen window is on the primary monitor',
    })
    settings.bind('auto-open-on-permission', autoOpen, 'active', 0)
    group.add(autoOpen)

    page.add(group)

    // Not under Permissions: a question is not a permission, and the linger
    // timer is about a session that has already finished. A user looking for
    // either of them does not look under Permissions.
    const sessions = new Adw.PreferencesGroup({ title: 'Sessions' })

    const questionTimeout = new Adw.SpinRow({
      title: PREFS_LABEL['question-timeout']!,
      subtitle: 'Seconds before an agent’s question falls through to its own picker. Zero waits indefinitely.',
      adjustment: new Gtk.Adjustment({ lower: 0, upper: 3600, step_increment: 15 }),
    })
    settings.bind('question-timeout', questionTimeout, 'value', 0)
    sessions.add(questionTimeout)

    const linger = new Adw.SpinRow({
      title: PREFS_LABEL['done-linger']!,
      subtitle: 'Seconds a completed session stays in the list',
      adjustment: new Gtk.Adjustment({ lower: 0, upper: 300, step_increment: 5 }),
    })
    settings.bind('done-linger', linger, 'value', 0)
    sessions.add(linger)

    page.add(sessions)

    const notifications = new Adw.PreferencesGroup({
      title: 'Notifications',
      description: 'Sounds come from your desktop’s sound theme, and stay silent when system sounds are off.',
    })

    const notificationPopup = new Adw.SwitchRow({
      title: PREFS_LABEL['notification-popup']!,
      subtitle: 'Suppressed while a fullscreen window is on the primary monitor',
    })
    settings.bind('notification-popup', notificationPopup, 'active', 0)
    notifications.add(notificationPopup)

    const notificationSeconds = new Adw.SpinRow({
      title: PREFS_LABEL['notification-seconds']!,
      subtitle: 'Seconds the message stays on the row. Zero keeps it until the agent does something else.',
      adjustment: new Gtk.Adjustment({ lower: 0, upper: 300, step_increment: 1 }),
    })
    settings.bind('notification-seconds', notificationSeconds, 'value', 0)
    notifications.add(notificationSeconds)

    const notificationSounds = new Adw.SwitchRow({
      title: PREFS_LABEL['notification-sounds']!,
      subtitle: 'When an agent needs you, or finishes',
    })
    settings.bind('notification-sounds', notificationSounds, 'active', 0)
    notifications.add(notificationSounds)

    page.add(notifications)

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

    const refreshers: (() => void)[] = []
    const refreshAll = () => {
      for (const refresh of refreshers) refresh()
    }

    // Both kinds of row live in this one group. A coming-soon agent's state
    // belongs in its subtitle, beside "Hooks installed" and "Not installed",
    // which is where a reader already looks to find out where a row stands —
    // a group heading of its own would say the same thing further away.
    for (const entry of AGENT_CATALOG) {
      if (entry.status === 'coming-soon') {
        group.add(this._comingSoonRow(entry.displayName))
        continue
      }
      const { row, refresh } = this._agentRow(entry, env, settings, window, refreshAll)
      // Only a real row registers a refresher: a coming-soon row reads no
      // file, so there is nothing for refreshAll to re-read.
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
    entry: Extract<CatalogEntry, { status: 'supported' }>,
    env: InstallEnv,
    settings: Gio.Settings,
    window: Adw.PreferencesWindow,
    refreshAll: () => void
  ): { row: Adw.ActionRow; refresh: () => void } {
    const id = entry.id
    const row = new Adw.ActionRow({ title: adapters[id].displayName })

    const enabled = new Gtk.Switch({
      valign: Gtk.Align.CENTER,
      tooltip_text: 'Show this agent’s sessions in the top bar',
    })
    enabled.connect('notify::active', () => {
      const current = settings.get_strv('enabled-agents')
      const has = current.includes(id)
      if (enabled.active && !has) {
        settings.set_strv('enabled-agents', [...current, id])
      } else if (!enabled.active && has) {
        settings.set_strv('enabled-agents', current.filter((a) => a !== id))
      }
    })

    const install = new Gtk.Button({ label: 'Install hooks', valign: Gtk.Align.CENTER })
    const uninstall = new Gtk.Button({ label: 'Remove hooks', valign: Gtk.Align.CENTER })

    const refresh = () => {
      // The switch is re-read here, not just at construction: enabled-agents
      // changes under this window — another prefs instance, gsettings, the
      // extension itself — and refresh() exists for exactly that. Assign only
      // on a real difference, so the notify::active handler is not woken to
      // write back the value we have just read.
      const isEnabled = settings.get_strv('enabled-agents').includes(id)
      if (enabled.active !== isEnabled) enabled.active = isEnabled

      const state = installState(id, env)
      const text = installRowText(state, entry.permissions, configPath(id, env))
      row.subtitle = text.subtitle
      // Cleared, not left behind: a row that recovers from `unreadable` would
      // otherwise keep a tooltip pointing at a problem that no longer exists.
      row.tooltip_text = text.tooltip ?? ''
      install.label = state === 'stale' ? 'Update hooks' : 'Install hooks'
      install.sensitive = state === 'absent' || state === 'stale'
      uninstall.sensitive = state === 'installed' || state === 'stale'
    }

    const run = (edits: ReturnType<typeof planInstall>, verb: 'install' | 'remove') => {
      const toast = (outcome: 'noop' | 'done' | 'failed') =>
        this._toast(
          window,
          installToast({
            displayName: adapters[id].displayName,
            agent: id,
            verb,
            outcome,
            configPath: configPath(id, env),
            home: env.home,
          })
        )
      try {
        if (edits.length === 0) {
          toast('noop')
          return
        }
        try {
          applyEdits(edits)
          toast('done')
        } catch (e) {
          // The toast says what the user can act on; the real error goes where
          // a bug report can find it. A GLib error string in a one-line toast
          // is a path, an errno and no advice, clipped.
          console.warn(`dasbo-island: ${verb} of ${id} hooks failed: ${e}`)
          toast('failed')
        }
      } finally {
        // Refresh every row, not just this one: all three read from disk, and
        // a row's state is derived entirely from those files. That's true
        // whether the write succeeded, failed, or turned out to be a no-op —
        // a no-op click usually means what's on disk no longer matches what
        // the row was showing, which is exactly when it needs re-reading.
        refreshAll()
      }
    }

    install.connect('clicked', () => run(planInstall(id, env), 'install'))
    uninstall.connect('clicked', () => run(planUninstall(id, env), 'remove'))

    row.add_suffix(enabled)
    row.add_suffix(install)
    row.add_suffix(uninstall)

    return { row, refresh }
  }

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
      tooltip_text: 'Not available in this release',
    })
    const install = new Gtk.Button({ label: 'Install hooks', valign: Gtk.Align.CENTER, sensitive: false })
    const uninstall = new Gtk.Button({ label: 'Remove hooks', valign: Gtk.Align.CENTER, sensitive: false })

    row.add_suffix(enabled)
    row.add_suffix(install)
    row.add_suffix(uninstall)

    return row
  }

  private _toast(window: Adw.PreferencesWindow, text: string): void {
    window.add_toast(new Adw.Toast({ title: text }))
  }
}
