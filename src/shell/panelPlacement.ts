import type Clutter from 'gi://Clutter'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'

/**
 * The panel exposes its three boxes only as private fields. Widen locally
 * rather than reaching for `any`, the same way island.ts widens the menu's
 * signal map.
 */
type PanelWithBoxes = typeof Main.panel & {
  _leftBox: Clutter.Actor
  _centerBox: Clutter.Actor
  _rightBox: Clutter.Actor
}

/**
 * Move an already-registered panel button between the top bar's boxes.
 *
 * `addToStatusArea` is deliberately not reused: besides reparenting, it
 * registers the role in `Main.panel.statusArea` and hands the button's menu to
 * the panel's menuManager. Calling it again on every settings change would
 * register the same menu repeatedly. Reparenting the container alone leaves
 * both registrations intact.
 *
 * An unknown box name falls back to the right box, matching what
 * `addToStatusArea` does with one.
 */
export function placeInPanelBox(container: Clutter.Actor, box: string, index: number): void {
  const panel = Main.panel as PanelWithBoxes
  const target =
    box === 'left' ? panel._leftBox : box === 'center' ? panel._centerBox : panel._rightBox
  const parent = container.get_parent()
  if (parent) parent.remove_child(container)
  target.insert_child_at_index(container, index)
}
