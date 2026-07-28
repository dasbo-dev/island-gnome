import St from 'gi://St'
import Clutter from 'gi://Clutter'
import GObject from 'gi://GObject'
import GLib from 'gi://GLib'
import Pango from 'gi://Pango'
import type Gio from 'gi://Gio'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'
import type { SessionStore } from '../core/store.js'
import type { Session, SessionState } from '../core/types.js'
import { SessionRow } from './sessionRow.js'
import { PermissionControls } from './permissionRow.js'
import { PopupHeader, EmptyRow } from './popupHeader.js'
import { RobotHead } from './robotHead.js'
import { pillState } from '../core/pillState.js'

/**
 * `PanelMenu.Button#menu` is typed as `PopupMenu | PopupDummyMenu` because a
 * caller can pass `dontCreateMenu`. We never do, so this is always a real
 * `PopupMenu` — and its `SignalMap` (from @girs) doesn't declare
 * `open-state-changed`, so we widen it locally rather than reaching for `any`.
 */
type MenuWithOpenSignal = PopupMenu.PopupMenu & {
  connect(sigName: 'open-state-changed', callback: (menu: unknown, open: boolean) => void): number
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
    private _robot!: InstanceType<typeof RobotHead>
    private _label!: St.Label
    private _unsubscribe: (() => void) | null = null
    private _rows = new Map<string, InstanceType<typeof SessionRow>>()
    private _header!: InstanceType<typeof PopupHeader>
    private _separator!: PopupMenu.PopupSeparatorMenuItem
    private _emptyRow: InstanceType<typeof EmptyRow> | null = null
    private _timerId = 0
    private _settingsChangedId = 0
    private _animateIdleId = 0
    private _fullscreenId = 0
    private _menuStateId = 0
    private _onJump: (s: Session) => void = () => {}
    private _onPrefs: () => void = () => {}
    private _controls = new Map<string, { id: string; controls: PermissionControls }>()
    private _transientIds = new Set<number>()
    private _permHandlers: {
      resolve: (id: string, kind: 'allow' | 'deny') => void
      grantAllowAlways: (sessionKey: string, tool: string, id: string) => void
    } | null = null

    constructor(store: SessionStore, settings: Gio.Settings) {
      super(0.5, 'Dasbo Island')
      this._store = store
      this._settings = settings

      const box = new St.BoxLayout({ style_class: 'dasbo-pill' })
      this._robot = new RobotHead()
      this._label = new St.Label({
        text: '',
        style_class: 'dasbo-pill-label',
        y_align: Clutter.ActorAlign.CENTER,
      })
      // The label's width is pinned in the stylesheet so the pill cannot resize
      // the top bar. St's CSS engine has no `text-overflow`, so the ellipsis has
      // to be set on the ClutterText — the same lesson as the opacity note in
      // popupHeader.ts. Without it, overlong content is clipped mid-glyph.
      this._label.clutter_text.ellipsize = Pango.EllipsizeMode.END
      box.add_child(this._robot)
      box.add_child(this._label)
      this.add_child(box)

      this._header = new PopupHeader({
        onPrefs: () => {
          // Close first: the preferences window takes focus, and a popup left
          // open behind it lingers until the next click somewhere else.
          this.menu.close(true)
          try {
            this._onPrefs()
          } catch (e) {
            // This only guards a synchronous throw (e.g. from the UUID lookup
            // in Extension.openPreferences()). The actual prefs-window launch
            // goes through Main.extensionManager.openExtensionPrefs(), which
            // dispatches an async D-Bus call with a null callback — a failure
            // there never reaches this frame, it lands in the journal from
            // the gnome-extensions side instead. Still worth catching: an
            // exception escaping a Clutter signal handler is otherwise logged
            // without this context, and the menu is already closed by then.
            console.warn(`dasbo-island: opening preferences failed: ${e}`)
          }
        },
      })
      this._separator = new PopupMenu.PopupSeparatorMenuItem()
      ;(this.menu as PopupMenu.PopupMenu).addMenuItem(this._header)
      ;(this.menu as PopupMenu.PopupMenu).addMenuItem(this._separator)

      this._unsubscribe = this._store.subscribe(() => this.refresh())

      // Both ids are captured and released in destroy(). Relying on the objects
      // becoming unreachable is not enough: the settings object and this widget
      // reference each other through the closure, and if the handler fires after
      // destroy() then refresh() touches an already-disposed actor.
      this._settingsChangedId = this._settings.connect('changed::always-show', () =>
        this.refresh()
      )

      this._animateIdleId = this._settings.connect('changed::animate-idle', () => {
        this._robot.setAnimateIdle(this._settings.get_boolean('animate-idle'))
      })
      this._robot.setAnimateIdle(this._settings.get_boolean('animate-idle'))

      // Fullscreen is not a store event, so refresh() never runs for it. The
      // pill is invisible under a fullscreen window; animating it there is
      // pure waste.
      this._fullscreenId = global.display.connect('in-fullscreen-changed', () =>
        this._applyPause()
      )
      // global.display outlives the extension, so Clutter-driven teardowns that
      // skip the JS destroy() override need the destroy signal to release this
      // handler. See robotHead.ts:79-83.
      this.connect('destroy', () => {
        if (this._fullscreenId) {
          global.display.disconnect(this._fullscreenId)
          this._fullscreenId = 0
        }
      })

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

    setPrefsHandler(fn: () => void): void {
      this._onPrefs = fn
    }

    showJumpFailure(key: string): void {
      const row = this._rows.get(key)
      if (!row) return
      row.showTransient('no window')
      const id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
        const s = this._store.get(key)
        if (s) row.update(s)
        this._transientIds.delete(id)
        return GLib.SOURCE_REMOVE
      })
      this._transientIds.add(id)
    }

    setPermissionHandlers(h: {
      resolve: (id: string, kind: 'allow' | 'deny') => void
      grantAllowAlways: (sessionKey: string, tool: string, id: string) => void
    }): void {
      this._permHandlers = h
    }

    /** Called by the D-Bus service after a permission row has been registered. */
    notifyPermissionOpened(): void {
      if (!this._settings.get_boolean('auto-open-on-permission')) return
      if (Main.layoutManager.primaryMonitor?.inFullscreen) return
      this.menu.open(true)
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

    /**
     * The robot animates only when it can actually be seen. Both inputs are
     * checked together because they change independently: `visible` follows
     * the session count and the always-show setting, fullscreen follows the
     * window manager.
     */
    private _applyPause(): void {
      const fullscreen = Main.layoutManager.primaryMonitor?.inFullscreen ?? false
      this._robot.setPaused(!this.visible || fullscreen)
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
          // Controls first: they are parented to the row, and destroying the
          // row destroys them with it — so releasing them afterwards makes
          // PermissionControls.detach() call remove_child on a dead parent,
          // which Clutter reports as a "not a child" warning in the journal.
          const stale = this._controls.get(key)
          if (stale) {
            stale.controls.destroy()
            this._controls.delete(key)
          }
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
        const existing = this._controls.get(s.key)

        // Promotion (see PermissionTable.activate) swaps `pendingPermission` to a
        // new id/tool without ever clearing it, so `existing` can be truthy even
        // though it is bound to a request that already resolved. Rebuild whenever
        // the id has moved on, not merely on the pending/absent transition, or the
        // stale cluster's closures keep resolving the wrong (already-finished) id.
        if (pending && existing?.id !== pending.id) {
          existing?.controls.destroy()
          const controls = new PermissionControls({
            onAllow: () => this._permHandlers?.resolve(pending.id, 'allow'),
            onDeny: () => this._permHandlers?.resolve(pending.id, 'deny'),
            onAlways: () =>
              this._permHandlers?.grantAllowAlways(s.key, pending.tool, pending.id),
          })
          controls.attachTo(row.permissionBox)
          this._controls.set(s.key, { id: pending.id, controls })
        } else if (!pending && existing) {
          existing.controls.destroy()
          this._controls.delete(s.key)
        }
      }

      // Ordering needs no care here: by the time this method returns, the empty
      // row exists only while there are zero session rows. During a 0->N
      // transition it's briefly still parented above the newly-appended rows,
      // but it's destroyed later in this same synchronous call, before
      // anything is painted — so it never ends up observably wedged between
      // two session rows.
      if (sessions.length === 0 && !this._emptyRow) {
        this._emptyRow = new EmptyRow()
        ;(this.menu as PopupMenu.PopupMenu).addMenuItem(this._emptyRow)
      } else if (sessions.length > 0 && this._emptyRow) {
        this._emptyRow.destroy()
        this._emptyRow = null
      }
    }

    refresh(): void {
      this._rebuildRows()
      const sessions = this._store.list()
      const count = sessions.length

      if (count === 0 && !this._settings.get_boolean('always-show')) {
        this.visible = false
        this._applyPause()
        return
      }
      this.visible = true

      // One call decides both the head's pose and the label's word, so they
      // can never disagree — a pending permission reads "waiting" in both.
      const state = pillState(sessions)
      this._robot.setState(state)

      if (count === 0) {
        this._label.text = 'idle'
      } else {
        this._label.text = `${count} · ${STATE_WORD[state]}`
      }
      this._applyPause()
    }

    destroy(): void {
      for (const c of this._controls.values()) c.controls.destroy()
      this._controls.clear()
      this._stopTimer()
      for (const id of this._transientIds) GLib.Source.remove(id)
      this._transientIds.clear()
      this._unsubscribe?.()
      this._unsubscribe = null
      if (this._settingsChangedId) {
        this._settings.disconnect(this._settingsChangedId)
        this._settingsChangedId = 0
      }
      if (this._animateIdleId) {
        this._settings.disconnect(this._animateIdleId)
        this._animateIdleId = 0
      }
      if (this._fullscreenId) {
        global.display.disconnect(this._fullscreenId)
        this._fullscreenId = 0
      }
      if (this._menuStateId) {
        ;(this.menu as MenuWithOpenSignal).disconnect(this._menuStateId)
        this._menuStateId = 0
      }
      for (const row of this._rows.values()) row.destroy()
      this._rows.clear()
      this._emptyRow?.destroy()
      this._emptyRow = null
      this._header.destroy()
      this._separator.destroy()
      super.destroy()
    }
  }
)
