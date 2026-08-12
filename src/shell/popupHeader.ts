import St from 'gi://St'
import Clutter from 'gi://Clutter'
import GObject from 'gi://GObject'
import Pango from 'gi://Pango'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'
import { logoIcon } from './logoIcon.js'
import { emptyState } from '../core/emptyState.js'
import type { Assert, Equals } from './typeAssert.js'

export interface PopupHeaderCallbacks {
  onPrefs: () => void
}

/**
 * The popup's title row: the extension name on the left, a gear button on the
 * right. Non-reactive on purpose — an activatable menu item closes the menu on
 * any click along its width, so the title itself would become a close button.
 * The child St.Button still receives clicks, the way SessionRow's Jump does.
 */
const PopupHeaderImpl = class PopupHeader extends PopupMenu.PopupBaseMenuItem {
  private _cb!: PopupHeaderCallbacks

  constructor(base: string, cb: PopupHeaderCallbacks) {
    super({ reactive: false, can_focus: false, style_class: 'dasbo-header dasbo-fixed-width' })
    this._cb = cb

    // Null when the asset is missing, in which case the header is the text
    // it has always been. .dasbo-header's 12px spacing separates it from
    // the title; the popup's width is pinned at 30em, so the mark costs the
    // title nothing.
    const logo = logoIcon(base)

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

    if (logo) this.add_child(logo)
    this.add_child(title)
    this.add_child(gear)
  }
}

const _PopupHeader = GObject.registerClass(PopupHeaderImpl)

/**
 * @girs derives a registered class's constructor parameters from `_init`, not
 * from the TypeScript `constructor`, so the registered form of a class taking
 * plain arguments is untypable without help. The signature is derived from the
 * implementation rather than restated, so it cannot drift from it.
 */
export const PopupHeader = _PopupHeader as unknown as new (
  ...args: ConstructorParameters<typeof PopupHeaderImpl>
) => InstanceType<typeof _PopupHeader>

/** Fails to compile if registration ever stops preserving the instance type. */
type _PopupHeaderKeepsImpl = Assert<
  Equals<InstanceType<typeof PopupHeader> extends InstanceType<typeof PopupHeaderImpl> ? true : false, true>
>

/**
 * Shown in place of the session rows while the store is empty.
 *
 * Takes the answer rather than working it out: reading the install state means
 * reading files, and a widget that reaches for its own dependencies is the
 * thing this file's neighbours are arranged to avoid.
 */
const EmptyRowImpl = class EmptyRow extends PopupMenu.PopupBaseMenuItem {
  constructor(hooksInstalled: boolean) {
    super({ reactive: false, can_focus: false, style_class: 'dasbo-row' })
    const { title, detail } = emptyState(hooksInstalled)

    // The labels go in a box carrying the popup's fixed width, the way a
    // SessionRow's .dasbo-row-outer does. Without it this row is narrower
    // than the session rows and the popup visibly shrinks when the last
    // session ends.
    const outer = new St.BoxLayout({
      vertical: true,
      style_class: 'dasbo-empty-outer dasbo-fixed-width',
    })

    const titleLabel = new St.Label({
      text: title,
      style_class: 'dasbo-empty',
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    })
    // St's CSS engine doesn't reliably honour `opacity` (the .dasbo-empty
    // rule is kept for intent, but isn't load-bearing) — set the Clutter
    // actor property directly so the label actually reads as dimmed.
    // 178 == 0.7 * 255.
    titleLabel.opacity = 178

    const detailLabel = new St.Label({
      text: detail,
      style_class: 'dasbo-empty-detail',
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    })
    detailLabel.opacity = 140
    // The popup is a fixed 30em and this sentence is longer than the title,
    // so it wraps rather than ellipsizing — the same rule the task list and
    // the question panel follow.
    detailLabel.clutter_text.line_wrap = true
    detailLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR
    detailLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE

    outer.add_child(titleLabel)
    outer.add_child(detailLabel)
    this.add_child(outer)
  }
}

const _EmptyRow = GObject.registerClass(EmptyRowImpl)

export const EmptyRow = _EmptyRow as unknown as new (
  ...args: ConstructorParameters<typeof EmptyRowImpl>
) => InstanceType<typeof _EmptyRow>

type _EmptyRowKeepsImpl = Assert<
  Equals<InstanceType<typeof EmptyRow> extends InstanceType<typeof EmptyRowImpl> ? true : false, true>
>
