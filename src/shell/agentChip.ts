import St from 'gi://St'
import Clutter from 'gi://Clutter'
import GObject from 'gi://GObject'
import { adapters } from '../core/adapters/index.js'
import { agentGicon } from './agentIcon.js'
import type { AgentId } from '../core/types.js'

/**
 * The agent's mark and short name, as one tag at the head of a session row.
 *
 * Deliberately has no update method: `sessionKey` is `${agent}:${sessionId}`
 * (see core/types.ts), so a row's agent is fixed for the row's entire life. A
 * chip that could change its agent would model a transition that cannot occur,
 * and would invite the Island to call it on every refresh for no reason.
 */
export const AgentChip = GObject.registerClass(
  class AgentChip extends St.BoxLayout {
    constructor(agent: AgentId, iconBase: string) {
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
        const icon = new St.Icon({
          gicon,
          icon_size: 14,
          y_align: Clutter.ActorAlign.CENTER,
        })
        // On the actor, not in CSS: St's CSS engine does not reliably honour
        // `opacity` (the finding recorded on popupHeader.ts's empty label and
        // sessionRow.ts's _shellTotal), and this sits inside a row built
        // reactive: false, which the shell theme paints as disabled.
        icon.opacity = 255
        this.add_child(icon)
      }

      // Added whether or not the icon was: a chip whose mark failed to ship
      // still has to say which agent the row belongs to.
      this.add_child(
        new St.Label({
          text: adapters[agent].shortName,
          style_class: 'dasbo-agent-chip-label',
          y_align: Clutter.ActorAlign.CENTER,
        })
      )
    }
  }
)
