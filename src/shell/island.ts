import St from 'gi://St'
import Clutter from 'gi://Clutter'
import GObject from 'gi://GObject'
import GLib from 'gi://GLib'
import type Gio from 'gi://Gio'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'
import type { SessionStore } from '../core/store.js'
import type { Session, SessionState } from '../core/types.js'
import { SessionRow } from './sessionRow.js'
import { PermissionControls } from './permissionRow.js'

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
    private _settingsChangedId = 0
    private _menuStateId = 0
    private _onJump: (s: Session) => void = () => {}
    private _controls = new Map<string, PermissionControls>()
    private _pulsing = false
    private _permHandlers: {
      resolve: (id: string, kind: 'allow' | 'deny') => void
      grantAllowAlways: (sessionKey: string, tool: string, id: string) => void
    } | null = null

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

      // Both ids are captured and released in destroy(). Relying on the objects
      // becoming unreachable is not enough: the settings object and this widget
      // reference each other through the closure, and if the handler fires after
      // destroy() then refresh() touches an already-disposed actor.
      this._settingsChangedId = this._settings.connect('changed::always-show', () =>
        this.refresh()
      )

      this._menuStateId = (this.menu as MenuWithOpenSignal).connect(
        'open-state-changed',
        (_menu, open) => {
          if (open) this._startTimer()
          else this._stopTimer()
        }
      )

      this.refresh()
    }

    setJumpHandler(fn: (s: Session) => void): void {
      this._onJump = fn
    }

    setPermissionHandlers(h: {
      resolve: (id: string, kind: 'allow' | 'deny') => void
      grantAllowAlways: (sessionKey: string, tool: string, id: string) => void
    }): void {
      this._permHandlers = h
    }

    /** Called by the D-Bus service after a permission row has been registered. */
    notifyPermissionOpened(): void {
      this._startPulse()
      if (!this._settings.get_boolean('auto-open-on-permission')) return
      if (Main.layoutManager.primaryMonitor?.inFullscreen) return
      this.menu.open(true)
    }

    private _startPulse(): void {
      if (this._pulsing) return
      this._pulsing = true
      this._pulseStep(false)
    }

    private _pulseStep(dim: boolean): void {
      if (!this._pulsing) return
      this._dot.ease({
        opacity: dim ? 255 : 90,
        duration: 600,
        mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
        onComplete: () => this._pulseStep(!dim),
      })
    }

    private _stopPulse(): void {
      if (!this._pulsing) return
      this._pulsing = false
      this._dot.remove_all_transitions()
      this._dot.opacity = 255
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

      for (const s of sessions) {
        const row = this._rows.get(s.key)
        if (!row) continue
        const pending = s.pendingPermission
        const existingControls = this._controls.get(s.key)

        if (pending && !existingControls) {
          const controls = new PermissionControls({
            onAllow: () => this._permHandlers?.resolve(pending.id, 'allow'),
            onDeny: () => this._permHandlers?.resolve(pending.id, 'deny'),
            onAlways: () =>
              this._permHandlers?.grantAllowAlways(s.key, pending.tool, pending.id),
          })
          controls.attachTo(row.actionBox)
          this._controls.set(s.key, controls)
        } else if (!pending && existingControls) {
          existingControls.destroy()
          this._controls.delete(s.key)
        }
      }

      if (this._store.worstState() !== 'waiting') this._stopPulse()
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
      this._stopPulse()
      for (const c of this._controls.values()) c.destroy()
      this._controls.clear()
      this._stopTimer()
      this._unsubscribe?.()
      this._unsubscribe = null
      if (this._settingsChangedId) {
        this._settings.disconnect(this._settingsChangedId)
        this._settingsChangedId = 0
      }
      if (this._menuStateId) {
        ;(this.menu as MenuWithOpenSignal).disconnect(this._menuStateId)
        this._menuStateId = 0
      }
      for (const row of this._rows.values()) row.destroy()
      this._rows.clear()
      super.destroy()
    }
  }
)
