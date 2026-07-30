import St from 'gi://St'
import Clutter from 'gi://Clutter'
import GObject from 'gi://GObject'
import { adapters } from '../core/adapters/index.js'
import { chipParts } from '../core/chipDisplay.js'
import { agentGicon } from './agentIcon.js'
import type { AgentId } from '../core/types.js'

/**
 * The agent's mark and short name, as one tag at the head of a session row.
 *
 * Which of the two it shows is the user's choice (`agent-chip-display`), and
 * can change while the chip is on screen — so both children are built once and
 * `setMode` toggles their visibility. What cannot change is *which* agent the
 * chip names: `sessionKey` is `${agent}:${sessionId}` (see core/types.ts), so a
 * row's agent is fixed for the row's entire life, and this class deliberately
 * offers no way to re-point it at another. Presentation is mutable here;
 * identity is not.
 *
 * The mode arrives as an argument rather than being read from GSettings
 * directly: Island owns settings in src/shell/, and a chip that connected to
 * them itself would owe a disconnect for every row that ever existed.
 */
export const AgentChip = GObject.registerClass(
  class AgentChip extends St.BoxLayout {
    private _icon: St.Icon | null = null
    private _label!: St.Label
    private _hasIcon = false

    constructor(agent: AgentId, iconBase: string, mode: string) {
      super({
        style_class: 'dasbo-agent-chip',
        // Never absorbs the row's slack, and never shrinks: the project label
        // beside it is the one thing that yields width (it ellipsizes — see
        // sessionRow.ts). A chip that could grow would eat that label's room.
        x_expand: false,
        y_align: Clutter.ActorAlign.CENTER,
      })

      const gicon = agentGicon(iconBase, agent)
      if (gicon) {
        this._icon = new St.Icon({
          gicon,
          // All three marks are 1.5-1.6-unit strokes in a 16-unit viewBox, so
          // at 14px they render at roughly 1.3 unhinted device pixels — just
          // above the 0.85em label's cap height, without making the chip the
          // tallest thing on the title line. If the marks ever read as
          // smudges rather than marks, try 16 (or heavier strokes) first.
          icon_size: 14,
          y_align: Clutter.ActorAlign.CENTER,
        })
        // Pinned defensively, not because anything currently dims this icon:
        // St's CSS engine does not reliably honour `opacity`, so it is never
        // expressed in the stylesheet, only ever set here. Genuine precedents
        // for this pattern — sessionRow.ts's _shellTotal, taskList.ts — pin a
        // value other than 255 because they need a dimming CSS won't deliver.
        // This icon needs no such thing: it's a Gio.FileIcon over a
        // non-symbolic file with baked-in stroke colours, so StTextureCache
        // loads it full-colour and never tints it — `color`, which is what
        // the row's `:insensitive` state actually changes, cannot touch it
        // either way. 255 is simply the correct full-opacity value, held here
        // in case anything ever does need to dim it.
        this._icon.opacity = 255
        this._hasIcon = true
        this.add_child(this._icon)
      }

      // Added whether or not the icon was: a chip whose mark failed to ship
      // still has to say which agent the row belongs to. chipParts is what
      // makes that true even in logo-only mode.
      this._label = new St.Label({
        text: adapters[agent].shortName,
        style_class: 'dasbo-agent-chip-label',
        y_align: Clutter.ActorAlign.CENTER,
      })
      this.add_child(this._label)

      // Applied here rather than left to the caller, so the chip's first paint
      // is already the right shape instead of flashing the default.
      this.setMode(mode)
    }

    setMode(mode: string): void {
      const parts = chipParts(mode, this._hasIcon)
      if (this._icon) this._icon.visible = parts.icon
      this._label.visible = parts.label
    }
  }
)
