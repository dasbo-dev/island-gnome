import St from 'gi://St'
import Clutter from 'gi://Clutter'

export interface PermissionCallbacks {
  onAllow: () => void
  onDeny: () => void
  onAlways: () => void
}

/**
 * The Allow / Deny / Always-allow control cluster.
 * Not a GObject class — it is a plain owner of three St.Buttons so it can be
 * attached to and detached from a SessionRow's permission box — its own line
 * beneath the row, because this cluster cannot shrink and would otherwise
 * starve the wrapping activity label of width.
 */
export class PermissionControls {
  private box: St.BoxLayout
  private parent: St.BoxLayout | null = null

  constructor(cb: PermissionCallbacks) {
    this.box = new St.BoxLayout({ style_class: 'dasbo-perm-actions' })

    const mk = (label: string, name: string, cls: string, fn: () => void) => {
      const b = new St.Button({
        label,
        style_class: `button ${cls}`,
        y_align: Clutter.ActorAlign.CENTER,
        // Allow and Deny are verbs with objects; Always was an adverb standing
        // alone, and it is the one button here that outlives the prompt. A
        // screen reader heard "Always" and nothing else.
        //
        // No tooltip to go with it: St widgets carry none in GNOME 46, unlike
        // the Gtk.Button in preferences. The label plus the accessible name is
        // what this surface has, which is why the label itself had to grow the
        // verb.
        accessible_name: name,
        // St.Button doesn't set this in its own init, and the SessionRow these
        // land in is deliberately can_focus: false, so without it a
        // keyboard-only user cannot reach Allow, Deny or Always allow at all —
        // the one place in this extension where that is a security control,
        // not a convenience. Jump and the header gear carry it for the same
        // reason.
        can_focus: true,
      })
      b.connect('clicked', () => fn())
      return b
    }

    this.box.add_child(mk('Allow', 'Allow this tool once', 'dasbo-allow', cb.onAllow))
    this.box.add_child(mk('Deny', 'Deny this tool', 'dasbo-deny', cb.onDeny))
    this.box.add_child(
      mk('Always allow', 'Always allow this tool for this session', 'dasbo-always', cb.onAlways)
    )
  }

  attachTo(parent: St.BoxLayout): void {
    if (this.parent) return
    this.parent = parent
    parent.add_child(this.box)
  }

  detach(): void {
    if (!this.parent) return
    this.parent.remove_child(this.box)
    this.parent = null
  }

  destroy(): void {
    this.detach()
    this.box.destroy()
  }
}
