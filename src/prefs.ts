import Adw from 'gi://Adw'
import Gtk from 'gi://Gtk'
import GLib from 'gi://GLib'
import type Gio from 'gi://Gio'
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js'
import {
  planInstall,
  planUninstall,
  isLegacyCodexHooks,
  installState,
  configPath,
  type InstallEnv,
  type InstallState,
} from './core/install/plan.js'
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

  private _toast(window: Adw.PreferencesWindow, text: string): void {
    window.add_toast(new Adw.Toast({ title: text }))
  }
}
