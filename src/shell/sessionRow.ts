import St from 'gi://St'
import Clutter from 'gi://Clutter'
import Pango from 'gi://Pango'
import GObject from 'gi://GObject'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'
import { formatElapsed, truncateDetail } from '../core/format.js'
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

      // x_expand on both so the label is allocated the row's full remaining
      // width: wrapping needs a bounded width to wrap against, and that bound
      // comes from .dasbo-row-outer's fixed width in the stylesheet.
      const activityRow = new St.BoxLayout({ style_class: 'dasbo-pill', x_expand: true })
      // START, not CENTER: over three wrapped lines a centred dot floats beside
      // the middle line instead of beside the status it belongs to.
      this._dot = new St.Widget({ style_class: 'dasbo-dot', y_align: Clutter.ActorAlign.START })
      this._activity = new St.Label({ text: '', style_class: 'dasbo-row-activity',
        x_expand: true })
      // WORD_CHAR, not WORD: a long path, URL or flag string has no word
      // boundary to break at, and WORD alone lets such a token overhang the
      // fixed width — reintroducing the jumping this exists to remove.
      // ellipsize must be NONE explicitly: Pango ignores line_wrap while an
      // ellipsize mode is set, which would silently yield one truncated line.
      this._activity.clutter_text.line_wrap = true
      this._activity.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR
      this._activity.clutter_text.ellipsize = Pango.EllipsizeMode.NONE
      activityRow.add_child(this._dot)
      activityRow.add_child(this._activity)

      textCol.add_child(this._project)
      textCol.add_child(activityRow)

      this._elapsed = new St.Label({ text: '0s', style_class: 'dasbo-row-elapsed',
        y_align: Clutter.ActorAlign.CENTER })

      this._jump = new St.Button({ label: 'Jump', style_class: 'button dasbo-jump',
        y_align: Clutter.ActorAlign.CENTER,
        // St.Button doesn't set this in its own init, and this row is
        // deliberately can_focus: false, so without it Jump is unreachable
        // by keyboard — see PopupHeader's gear for the same fix.
        can_focus: true })
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
      if (pending) {
        // The tool name comes from the payload too, so it needs bounding for the
        // same reason detail does — an unbounded label pushes Allow and Deny off
        // screen, which is exactly what this row exists to prevent.
        const tool = truncateDetail(pending.tool, 40)
        const what = pending.detail ? `${tool} · ${truncateDetail(pending.detail)}` : tool
        const more = pending.queued > 0 ? ` · +${pending.queued} more` : ''
        this._activity.text = `waiting for you · ${what}${more}`
      } else if (tool && detail) {
        this._activity.text = `${tool} · ${truncateDetail(detail)}`
      } else {
        this._activity.text = tool ?? session.state
      }
    }

    /** Called once per second by the Island while the popup is open. */
    tick(now: number): void {
      this._elapsed.text = formatElapsed(now - this._session.startedAt)
    }

    showTransient(text: string): void {
      this._activity.text = text
    }
  }
)
