import GLib from 'gi://GLib'
import type Gio from 'gi://Gio'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'
import { SessionStore } from './core/store.js'
import { PermissionTable } from './core/permissions.js'
import { glibTimers } from './shell/glibTimers.js'
import { IslandService } from './dbus/service.js'
import { Island } from './shell/island.js'
import { activateForPid, pidAlive } from './shell/windowFinder.js'

export default class DasboIslandExtension extends Extension {
  private _island: InstanceType<typeof Island> | null = null
  private _store: SessionStore | null = null
  private _permissions: PermissionTable | null = null
  private _service: IslandService | null = null
  private _reaperId = 0
  private _settingsChangedId = 0
  private _settings: Gio.Settings | null = null

  enable() {
    const settings = this.getSettings()
    this._settings = settings
    this._store = new SessionStore()
    this._store.doneLingerSeconds = settings.get_int('done-linger')
    this._settingsChangedId = settings.connect('changed::done-linger', () => {
      if (this._store) this._store.doneLingerSeconds = settings.get_int('done-linger')
    })
    this._permissions = new PermissionTable(this._store, glibTimers)
    this._island = new Island(this._store, settings)

    Main.panel.addToStatusArea(
      this.uuid,
      this._island,
      settings.get_int('panel-index'),
      settings.get_string('panel-position')
    )

    this._island.setJumpHandler((session) => {
      const ok = activateForPid(session.pid)
      if (!ok) this._island?.showJumpFailure(session.key)
    })

    this._island.setPermissionHandlers({
      resolve: (id, kind) => {
        this._permissions?.resolve(id, { kind })
      },
      grantAllowAlways: (sessionKey, tool, id) => {
        this._permissions?.grantAlways(sessionKey, tool)
        this._permissions?.resolve(id, { kind: 'allow', reason: 'Always allowed for this session' })
      },
    })

    this._service = new IslandService(this._store, this._permissions, {
      timeoutSeconds: () => settings.get_int('permission-timeout'),
      onPermissionOpened: () => this._island?.notifyPermissionOpened(),
    })
    this._service.export()

    this._reaperId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 60, () => {
      this._store?.reap(Date.now(), pidAlive)
      return GLib.SOURCE_CONTINUE
    })
  }

  disable() {
    if (this._reaperId) {
      GLib.Source.remove(this._reaperId)
      this._reaperId = 0
    }
    this._service?.unexport()
    this._service = null
    this._permissions?.resolveAllFallthrough()
    this._permissions = null
    this._island?.destroy()
    this._island = null
    this._store = null
    if (this._settingsChangedId && this._settings) {
      this._settings.disconnect(this._settingsChangedId)
      this._settingsChangedId = 0
    }
    this._settings = null
  }
}
