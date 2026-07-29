/**
 * The popup's own height budget, kept pure so it can be tested without a Shell.
 *
 * A plain `PopupMenu` does not scroll in GNOME Shell 46, so `island.ts` puts the
 * session rows in an `St.ScrollView` and caps it. What to cap it at is arithmetic
 * over three numbers the Shell reports, which is this module.
 */

/**
 * Never let a computed cap collapse the body to nothing. The chrome is measured
 * rather than assumed, so an oversized font — or a second pinned row added later
 * — could otherwise produce a cap of zero, which St would honour by drawing
 * nothing at all.
 */
export const MIN_BODY = 120

const DEFAULT_FRACTION = 0.9

export interface BodyMaxHeightInput {
  /** Monitor work area height in logical pixels, excluding the top bar. */
  workAreaHeight: number
  /** Height of everything pinned outside the scroll view: header + separator. */
  chromeHeight: number
  /** St.ThemeContext's scale factor. */
  scaleFactor: number
  /** Share of the work area the whole popup may occupy. */
  fraction?: number
}

/**
 * The scroll view's `max-height`, in CSS pixels.
 *
 * The division by the scale factor is not cosmetic: the work area (and the
 * measured chrome, which is in the same stage coordinate space) is in physical
 * pixels, while St multiplies CSS lengths — such as this max-height — by the
 * theme context's scale factor. An unscaled value would let the body grow to
 * twice the intended cap on a 2x monitor — precisely the clipping the cap
 * exists to prevent. A scale factor of 0 or NaN is read as 1: a slightly
 * generous cap beats a division by zero.
 */
export function bodyMaxHeight(o: BodyMaxHeightInput): number {
  const fraction = o.fraction ?? DEFAULT_FRACTION
  const scale = Number.isFinite(o.scaleFactor) && o.scaleFactor > 0 ? o.scaleFactor : 1
  const logical = o.workAreaHeight * fraction - o.chromeHeight
  return Math.max(MIN_BODY, Math.floor(logical / scale))
}

export interface ScrollIntoViewInput {
  /** Current `vadjustment.value`. */
  value: number
  /** Current `vadjustment.page_size` — the visible height. */
  pageSize: number
  /** The child's y within the scrolled box, not on screen. */
  childY: number
  childHeight: number
}

/**
 * The `vadjustment.value` that brings a child into view, or the current value if
 * it is already fully visible.
 *
 * Clamps rather than centres: a child above the viewport scrolls to its top, one
 * below scrolls until its bottom is flush, and one taller than the page aligns to
 * its top — scrolling to such a child's bottom would push its head off the other
 * edge, which for a focused button is worse than showing its first line.
 */
export function scrollIntoView(o: ScrollIntoViewInput): number {
  const top = o.childY
  const bottom = o.childY + o.childHeight
  if (top < o.value) return top
  if (bottom > o.value + o.pageSize) {
    if (o.childHeight >= o.pageSize) return top
    return bottom - o.pageSize
  }
  return o.value
}
