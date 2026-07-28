import St from 'gi://St'
import Clutter from 'gi://Clutter'
import GObject from 'gi://GObject'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'

export interface PopupHeaderCallbacks {
  onPrefs: () => void
}

/**
 * The popup's title row: the extension name on the left, a gear button on the
 * right. Non-reactive on purpose — an activatable menu item closes the menu on
 * any click along its width, so the title itself would become a close button.
 * The child St.Button still receives clicks, the way SessionRow's Jump does.
 */
export const PopupHeader = GObject.registerClass(
  class PopupHeader extends PopupMenu.PopupBaseMenuItem {
    private _cb!: PopupHeaderCallbacks

    constructor(cb: PopupHeaderCallbacks) {
      super({ reactive: false, can_focus: false, style_class: 'dasbo-header dasbo-fixed-width' })
      this._cb = cb

      const title = new St.Label({
        text: 'Dasbo Island',
        style_class: 'dasbo-header-title',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
      })

      const gear = new St.Button({
        style_class: 'button dasbo-prefs',
        // Without this the button announces itself as an unnamed button to a
        // screen reader: its only child is an icon, so there is no text to read.
        accessible_name: 'Settings',
        y_align: Clutter.ActorAlign.CENTER,
        // St.Button doesn't set this in its own init, and the header item
        // above it is deliberately can_focus: false (see the class comment),
        // so without it there is no focusable actor in the popup at all and
        // a keyboard-only user can never tab/arrow to preferences.
        can_focus: true,
        child: new St.Icon({ icon_name: 'emblem-system-symbolic', icon_size: 16 }),
      })
      gear.connect('clicked', () => this._cb.onPrefs())

      this.add_child(title)
      this.add_child(gear)
    }
  }
)

/** Shown in place of the session rows while the store is empty. */
export const EmptyRow = GObject.registerClass(
  class EmptyRow extends PopupMenu.PopupBaseMenuItem {
    constructor() {
      super({ reactive: false, can_focus: false, style_class: 'dasbo-row' })
      // The label goes in a box carrying the popup's fixed width, the way a
      // SessionRow's .dasbo-row-outer does. Without it this row is narrower
      // than the session rows and the popup visibly shrinks when the last
      // session ends.
      const outer = new St.BoxLayout({ style_class: 'dasbo-empty-outer dasbo-fixed-width' })
      const label = new St.Label({
        text: 'No active sessions',
        style_class: 'dasbo-empty',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
      })
      // St's CSS engine doesn't reliably honour `opacity` (the .dasbo-empty
      // rule is kept for intent, but isn't load-bearing) — set the Clutter
      // actor property directly so the label actually reads as dimmed.
      // 178 == 0.7 * 255.
      label.opacity = 178
      outer.add_child(label)
      this.add_child(outer)
    }
  }
)
