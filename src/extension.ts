import St from 'gi://St'
import GObject from 'gi://GObject'
import Clutter from 'gi://Clutter'
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
      box.add_child(new St.Widget({ style_class: 'dasbo-dot', y_align: Clutter.ActorAlign.CENTER }))
      this._label = new St.Label({ text: '0', style_class: 'dasbo-pill-label', y_align: Clutter.ActorAlign.CENTER })
      box.add_child(this._label)
      this.add_child(box)
    }
    setText(t: string) {
      this._label.text = t
    }
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
