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
  type InstallState,
} from './core/install/plan.js'
import { applyEdits, readFileOrNull } from './shell/applyEdits.js'
import { adapters } from './core/adapters/index.js'
import type { AgentId } from './core/types.js'
import { aboutPage } from './prefs/about.js'
import { PREFS_WINDOW } from './core/prefsWindow.js'

export default class DasboIslandPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> | void {
    const settings = this.getSettings()

    // The default size, not a size request: a user who resizes the window
    // keeps their size, and libadwaita's own minimums still apply. Neither the
    // shell's ExtensionPrefsDialog nor libadwaita sets one, so without this
    // the window opened at its natural size — too short for the About page,
    // whose Support group ended up below the fold.
    window.set_default_size(PREFS_WINDOW.width, PREFS_WINDOW.height)

    window.add(this._appearancePage(settings))
    window.add(this._behaviourPage(settings))
    window.add(this._agentsPage(settings, window))
    window.add(aboutPage(window, this.path, this._version()))
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

    const questionTimeout = new Adw.SpinRow({
      title: 'Question timeout',
      subtitle: 'Seconds before an agent’s question falls through to its own picker. Zero waits indefinitely.',
      adjustment: new Gtk.Adjustment({ lower: 0, upper: 3600, step_increment: 15 }),
    })
    settings.bind('question-timeout', questionTimeout, 'value', 0)
    group.add(questionTimeout)

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

    const notifications = new Adw.PreferencesGroup({ title: 'Notifications' })

    const notificationPopup = new Adw.SwitchRow({
      title: 'Open the popup on a notification',
      subtitle: 'Suppressed while a fullscreen window is on the primary monitor',
    })
    settings.bind('notification-popup', notificationPopup, 'active', 0)
    notifications.add(notificationPopup)

    const notificationSeconds = new Adw.SpinRow({
      title: 'Keep a notification visible',
      subtitle: 'Seconds the message stays on the row. Zero keeps it until the agent does something else.',
      adjustment: new Gtk.Adjustment({ lower: 0, upper: 300, step_increment: 1 }),
    })
    settings.bind('notification-seconds', notificationSeconds, 'value', 0)
    notifications.add(notificationSeconds)

    const notificationSounds = new Adw.SwitchRow({
      title: 'Play a sound',
      subtitle: 'When an agent needs an answer, raises a notification, or finishes. Uses your desktop’s sound theme, and stays silent when system sounds are off.',
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
      switch (state) {
        case 'installed':
          return 'Hooks installed'
        // Deliberately vague about the cause: stale covers an out-of-date hook
        // path, a duplicated entry, a missing event, a command under the wrong
        // event, and a codex file still holding the old named-hook entry.
        case 'stale':
          return 'Hooks need updating — they don’t match what this version installs'
        case 'unreadable':
          return `${configPath(id, env)} is not valid JSON`
        case 'absent':
          return 'Not installed'
        default: {
          // A new InstallState member must be given a subtitle here rather
          // than silently rendering as "Not installed".
          const unhandled: never = state
          return unhandled
        }
      }
    }

    const refresh = () => {
      // The switch is re-read here, not just at construction: enabled-agents
      // changes under this window — another prefs instance, gsettings, the
      // extension itself — and refresh() exists for exactly that. Assign only
      // on a real difference, so the notify::active handler is not woken to
      // write back the value we have just read.
      const isEnabled = settings.get_strv('enabled-agents').includes(id)
      if (enabled.active !== isEnabled) enabled.active = isEnabled

      const state = installState(id, env)
      row.subtitle = describe(state)
      install.label = state === 'stale' ? 'Update' : 'Install'
      install.sensitive = state === 'absent' || state === 'stale'
      uninstall.sensitive = state === 'installed' || state === 'stale'
    }

    const run = (edits: ReturnType<typeof planInstall>, verb: string) => {
      try {
        if (edits.length === 0) {
          this._toast(window, `${adapters[id].displayName}: nothing to ${verb}`)
          return
        }
        try {
          applyEdits(edits)
          // Codex will not run a newly written hook until it has been trusted,
          // and that review only happens in its own TUI — so an install that
          // succeeded here is still one step short of firing.
          const trustNote =
            id === 'codex' && verb === 'install'
              ? ' — start `codex` once and approve the hook review, or Codex will not run them'
              : ''
          this._toast(window, `${adapters[id].displayName}: ${verb} complete${trustNote}`)
        } catch (e) {
          this._toast(window, `${adapters[id].displayName}: ${verb} failed — ${e}`)
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

  private _toast(window: Adw.PreferencesWindow, text: string): void {
    window.add_toast(new Adw.Toast({ title: text }))
  }
}
