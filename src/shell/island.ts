import St from 'gi://St'
import Clutter from 'gi://Clutter'
import GObject from 'gi://GObject'
import type Gio from 'gi://Gio'
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import type { SessionStore } from '../core/store.js'
import type { SessionState } from '../core/types.js'

const STATE_CLASS: Record<SessionState, string> = {
  idle: '',
  running: 'state-running',
  waiting: 'state-waiting',
  error: 'state-error',
  done: 'state-done',
}

const STATE_WORD: Record<SessionState, string> = {
  idle: 'idle',
  running: 'working',
  waiting: 'waiting',
  error: 'error',
  done: 'done',
}

export const Island = GObject.registerClass(
  class Island extends PanelMenu.Button {
    private _store!: SessionStore
    private _settings!: Gio.Settings
    private _dot!: St.Widget
    private _label!: St.Label
    private _unsubscribe: (() => void) | null = null

    constructor(store: SessionStore, settings: Gio.Settings) {
      super(0.5, 'Dasbo Island')
      this._store = store
      this._settings = settings

      const box = new St.BoxLayout({ style_class: 'dasbo-pill' })
      this._dot = new St.Widget({
        style_class: 'dasbo-dot',
        y_align: Clutter.ActorAlign.CENTER,
      })
      this._label = new St.Label({
        text: '',
        style_class: 'dasbo-pill-label',
        y_align: Clutter.ActorAlign.CENTER,
      })
      box.add_child(this._dot)
      box.add_child(this._label)
      this.add_child(box)

      this._unsubscribe = this._store.subscribe(() => this.refresh())
      this._settings.connect('changed::always-show', () => this.refresh())
      this.refresh()
    }

    refresh(): void {
      const sessions = this._store.list()
      const count = sessions.length

      if (count === 0 && !this._settings.get_boolean('always-show')) {
        this.visible = false
        return
      }
      this.visible = true

      const worst = count === 0 ? 'idle' : this._store.worstState()
      this._dot.style_class = `dasbo-dot ${STATE_CLASS[worst]}`.trim()

      if (count === 0) {
        this._label.text = 'idle'
      } else {
        this._label.text = `${count} · ${STATE_WORD[worst]}`
      }
    }

    destroy(): void {
      this._unsubscribe?.()
      this._unsubscribe = null
      super.destroy()
    }
  }
)
