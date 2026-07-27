import St from 'gi://St'
import Clutter from 'gi://Clutter'
import GObject from 'gi://GObject'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'
import { formatElapsed } from '../core/format.js'
import type { Session, SessionState } from '../core/types.js'

const STATE_CLASS: Record<SessionState, string> = {
  idle: '',
  running: 'state-running',
  waiting: 'state-waiting',
  error: 'state-error',
  done: 'state-done',
}

export interface SessionRowCallbacks {
  onJump: (session: Session) => void
}

export const SessionRow = GObject.registerClass(
  class SessionRow extends PopupMenu.PopupBaseMenuItem {
    private _session!: Session
    private _cb!: SessionRowCallbacks
    private _dot!: St.Widget
    private _project!: St.Label
    private _activity!: St.Label
    private _elapsed!: St.Label
    private _jump!: St.Button
    private _actionBox!: St.BoxLayout

    constructor(session: Session, cb: SessionRowCallbacks) {
      super({ reactive: false, can_focus: false, style_class: 'dasbo-row' })
      this._session = session
      this._cb = cb

      const outer = new St.BoxLayout({ x_expand: true, style_class: 'dasbo-row-outer' })

      const textCol = new St.BoxLayout({ vertical: true, x_expand: true })
      this._project = new St.Label({ text: session.project, style_class: 'dasbo-row-project' })

      const activityRow = new St.BoxLayout({ style_class: 'dasbo-pill' })
      this._dot = new St.Widget({ style_class: 'dasbo-dot', y_align: Clutter.ActorAlign.CENTER })
      this._activity = new St.Label({ text: '', style_class: 'dasbo-row-activity',
        y_align: Clutter.ActorAlign.CENTER })
      activityRow.add_child(this._dot)
      activityRow.add_child(this._activity)

      textCol.add_child(this._project)
      textCol.add_child(activityRow)

      this._elapsed = new St.Label({ text: '00:00', style_class: 'dasbo-row-elapsed',
        y_align: Clutter.ActorAlign.CENTER })

      this._jump = new St.Button({ label: 'Jump', style_class: 'button dasbo-jump',
        y_align: Clutter.ActorAlign.CENTER })
      this._jump.connect('clicked', () => this._cb.onJump(this._session))

      this._actionBox = new St.BoxLayout({ style_class: 'dasbo-row-actions' })
      this._actionBox.add_child(this._elapsed)
      this._actionBox.add_child(this._jump)

      outer.add_child(textCol)
      outer.add_child(this._actionBox)
      this.add_child(outer)

      this.update(session)
    }

    /** Where Task 11 inserts the Allow / Deny controls. */
    get actionBox(): St.BoxLayout {
      return this._actionBox
    }

    get session(): Session {
      return this._session
    }

    update(session: Session): void {
      this._session = session
      this._project.text = session.project
      this._dot.style_class = `dasbo-dot ${STATE_CLASS[session.state]}`.trim()

      const tool = session.currentTool
      const detail = session.detail
      const pending = session.pendingPermission
      this._activity.text =
        pending
          ? `waiting for you${pending.queued > 0 ? ` · +${pending.queued} more` : ''}`
        : tool && detail ? `${tool} · ${detail}`
        : tool ? tool
        : session.state
    }

    /** Called once per second by the Island while the popup is open. */
    tick(now: number): void {
      this._elapsed.text = formatElapsed(now - this._session.startedAt)
    }

    /** Hide the jump button when no window can own this session. */
    setJumpEnabled(enabled: boolean): void {
      this._jump.reactive = enabled
      this._jump.opacity = enabled ? 255 : 128
    }

    showTransient(text: string): void {
      this._activity.text = text
    }
  }
)
