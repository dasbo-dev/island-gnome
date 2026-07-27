import type Clutter from 'gi://Clutter'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'

/**
 * The panel exposes its three boxes only as private fields. Widen locally
 * rather than reaching for `any`, the same way island.ts widens the menu's
 * signal map. Optional, because private fields carry no compatibility
 * promise — typing them as always-present would hide the one case worth
 * handling.
 */
type PanelWithBoxes = typeof Main.panel & {
  _leftBox?: Clutter.Actor
  _centerBox?: Clutter.Actor
  _rightBox?: Clutter.Actor
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
 * An unknown box NAME falls back to the right box, matching what
 * `addToStatusArea` does with one. A missing box ACTOR is a different
 * condition — a future Shell renaming these private fields — and the pill
 * stays where it is rather than being orphaned: unparenting it first and only
 * then discovering there is nowhere to put it would leave it invisible until
 * the extension was re-enabled.
 */
export function placeInPanelBox(container: Clutter.Actor, box: string, index: number): void {
  const panel = Main.panel as PanelWithBoxes
  const target =
    box === 'left' ? panel._leftBox : box === 'center' ? panel._centerBox : panel._rightBox
  if (!target) {
    // Silence here would make every position change an invisible no-op with
    // nothing to go on.
    console.warn(`dasbo-island: panel box "${box}" is missing; leaving the pill where it is`)
    return
  }
  const parent = container.get_parent()
  if (parent) parent.remove_child(container)
  target.insert_child_at_index(container, index)
}
