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

    const mk = (label: string, cls: string, fn: () => void) => {
      const b = new St.Button({
        label,
        style_class: `button ${cls}`,
        y_align: Clutter.ActorAlign.CENTER,
      })
      b.connect('clicked', () => fn())
      return b
    }

    this.box.add_child(mk('Allow', 'dasbo-allow', cb.onAllow))
    this.box.add_child(mk('Deny', 'dasbo-deny', cb.onDeny))
    this.box.add_child(mk('Always', 'dasbo-always', cb.onAlways))
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
