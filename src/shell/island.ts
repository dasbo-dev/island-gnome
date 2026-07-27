import St from 'gi://St'
import Clutter from 'gi://Clutter'
import GObject from 'gi://GObject'
import GLib from 'gi://GLib'
import type Gio from 'gi://Gio'
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'
import type { SessionStore } from '../core/store.js'
import type { Session, SessionState } from '../core/types.js'
import { SessionRow } from './sessionRow.js'

/**
 * `PanelMenu.Button#menu` is typed as `PopupMenu | PopupDummyMenu` because a
 * caller can pass `dontCreateMenu`. We never do, so this is always a real
 * `PopupMenu` — and its `SignalMap` (from @girs) doesn't declare
 * `open-state-changed`, so we widen it locally rather than reaching for `any`.
 */
type MenuWithOpenSignal = PopupMenu.PopupMenu & {
  connect(sigName: 'open-state-changed', callback: (menu: unknown, open: boolean) => void): number
}

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
    private _rows = new Map<string, InstanceType<typeof SessionRow>>()
    private _timerId = 0
    private _onJump: (s: Session) => void = () => {}

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

      ;(this.menu as MenuWithOpenSignal).connect('open-state-changed', (_menu, open) => {
        if (open) this._startTimer()
        else this._stopTimer()
      })

      this.refresh()
    }

    setJumpHandler(fn: (s: Session) => void): void {
      this._onJump = fn
    }

    private _startTimer(): void {
      if (this._timerId) return
      this._tickAll()
      this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
        this._tickAll()
        return GLib.SOURCE_CONTINUE
      })
    }

    private _stopTimer(): void {
      if (!this._timerId) return
      GLib.Source.remove(this._timerId)
      this._timerId = 0
    }

    private _tickAll(): void {
      const now = Date.now()
      for (const row of this._rows.values()) row.tick(now)
    }

    private _rebuildRows(): void {
      const sessions = this._store.list()
      const live = new Set(sessions.map((s) => s.key))

      for (const [key, row] of [...this._rows]) {
        if (!live.has(key)) {
          row.destroy()
          this._rows.delete(key)
        }
      }

      for (const s of sessions) {
        const existing = this._rows.get(s.key)
        if (existing) {
          existing.update(s)
        } else {
          const row = new SessionRow(s, { onJump: (sess) => this._onJump(sess) })
          this._rows.set(s.key, row)
          ;(this.menu as PopupMenu.PopupMenu).addMenuItem(row)
        }
      }
    }

    refresh(): void {
      this._rebuildRows()
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
      this._stopTimer()
      this._unsubscribe?.()
      this._unsubscribe = null
      for (const row of this._rows.values()) row.destroy()
      this._rows.clear()
      super.destroy()
    }
  }
)
