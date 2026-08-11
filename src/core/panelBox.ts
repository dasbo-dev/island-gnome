/**
 * The three top bar boxes, as both a type and a runtime list.
 *
 * GNOME 50 narrowed `Main.panel.addToStatusArea`'s `box` parameter from a bare
 * string to `'left' | 'center' | 'right'`, while `Gio.Settings.get_string`
 * still returns a string. Casting across that gap would compile and then hand
 * the panel whatever the key happened to hold; `panelBox` checks instead.
 *
 * The gschema's `<choices>` already constrains the key, so the fallback is
 * unreachable through the preferences UI. It exists for a hand-edited dconf
 * value, and `test/core/panelBox.test.ts` pins this list against the schema so
 * the two cannot drift apart.
 */
export const PANEL_BOXES = ['left', 'center', 'right'] as const

export type PanelBox = (typeof PANEL_BOXES)[number]

/** Narrow a settings string to a panel box, falling back to the schema default. */
export function panelBox(value: string): PanelBox {
  return (PANEL_BOXES as readonly string[]).includes(value) ? (value as PanelBox) : 'center'
}
