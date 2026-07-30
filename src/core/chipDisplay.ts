/**
 * What the agent chip on a session row shows, kept pure so it can be tested
 * without a Shell.
 *
 * The chip has exactly two children — the agent's mark and its short name —
 * and this module is the single place that decides which of them are visible.
 * Keeping the decision here rather than in the widget is what lets the
 * fallback rule below be asserted directly instead of inferred from St state.
 */

/** The values `agent-chip-display` is declared with in the gschema. */
const MODES = ['logo', 'logo-name', 'name'] as const
export type ChipDisplay = (typeof MODES)[number]

export interface ChipParts {
  /** Show the agent's mark. Never true when the caller has no mark to draw. */
  icon: boolean
  /** Show the agent's short name. */
  label: boolean
}

const MODE_SET: ReadonlySet<string> = new Set(MODES)

/**
 * Which parts of the chip to show.
 *
 * `mode` is a `string` rather than a `ChipDisplay` because it arrives from
 * `Gio.Settings.get_string`, and an unrecognised value is read as `logo-name`
 * rather than thrown on. Today the key's `<choices>` make that unreachable,
 * but a value added by a newer release and read by an older installed copy
 * would otherwise raise inside a row build — and an exception there takes the
 * whole popup rebuild with it.
 *
 * `hasIcon` is a boolean rather than a `Gio.Icon | null` so that this module
 * stays free of GObject introspection — see test/core/purity.
 *
 * Two properties hold for every input, junk included: the chip is never blank
 * (`icon || label`), and `icon` is never true when `hasIcon` is false. The
 * first is why `logo` degrades to the name when the mark is missing: a chip
 * that honoured the mode literally there would leave the row unable to say
 * which agent it belongs to, over a decoration that failed to ship.
 */
export function chipParts(mode: string, hasIcon: boolean): ChipParts {
  const m = MODE_SET.has(mode) ? mode : 'logo-name'
  return {
    icon: hasIcon && m !== 'name',
    label: m !== 'logo' || !hasIcon,
  }
}
