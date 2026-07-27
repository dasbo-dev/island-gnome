import St from 'gi://St'
import GObject from 'gi://GObject'
import Clutter from 'gi://Clutter'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'

const Island = GObject.registerClass(
  class Island extends PanelMenu.Button {
    constructor() {
      super(0.5, 'Dasbo Island')
      const box = new St.BoxLayout({ style_class: 'dasbo-pill' })
      box.add_child(new St.Widget({ style_class: 'dasbo-dot', y_align: Clutter.ActorAlign.CENTER }))
      box.add_child(new St.Label({ text: 'dasbo', style_class: 'dasbo-pill-label', y_align: Clutter.ActorAlign.CENTER }))
      this.add_child(box)
    }
  }
)

export default class DasboIslandExtension extends Extension {
  private _island: InstanceType<typeof Island> | null = null

  enable() {
    this._island = new Island()
    Main.panel.addToStatusArea(this.uuid, this._island, 0, 'center')
  }

  disable() {
    this._island?.destroy()
    this._island = null
  }
}
