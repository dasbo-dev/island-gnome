import St from 'gi://St'
import Clutter from 'gi://Clutter'
import GObject from 'gi://GObject'
import GLib from 'gi://GLib'
import type cairo from 'cairo'
import type { SessionState } from '../core/types.js'
import { gridPose, tickIntervalMs, type GridPose } from '../core/grid.js'

/**
 * Deliberately a local copy of the same table in sessionRow.ts rather than a
 * shared import: the two carry different CSS properties (-dasbo-accent here,
 * background-color there) and are free to diverge.
 */
const STATE_CLASS: Record<SessionState, string> = {
  idle: '',
  running: 'state-running',
  waiting: 'state-waiting',
  error: 'state-error',
  done: 'state-done',
}

/** The design space from the spec: 2.4 + 9.4 + 0.8 + 9.4 + 2.4 = 24. */
const UNITS = 24
const BLOCK_U = 9.4
const GAP_U = 0.8
const RADIUS_U = 2.2

type Rgba = [number, number, number, number]

interface Metrics {
  block: number
  gap: number
  radius: number
}

/**
 * Snap the design space to device pixels.
 *
 * The gap is 0.53px at S=16 and 0.73px at S=22 — under a device pixel at every
 * realistic size. It is the only thing that makes four blocks read as four
 * rather than as one square, so it is floored at 1px even where that widens
 * the grid past its design proportion.
 */
function metrics(s: number): Metrics {
  const u = s / UNITS
  return {
    block: Math.max(1, Math.round(BLOCK_U * u)),
    gap: Math.max(1, Math.round(GAP_U * u)),
    radius: Math.round(RADIUS_U * u),
  }
}

function rgba(c: Clutter.Color): Rgba {
  return [c.red / 255, c.green / 255, c.blue / 255, c.alpha / 255]
}

function roundedRect(
  cr: cairo.Context,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rr = Math.min(r, w / 2, h / 2)
  // Unreachable in practice: rr is zero only when the snapped radius rounds to
  // zero, which needs S <= 5. Kept because cairo's arc degenerates at r = 0.
  if (rr <= 0) {
    cr.rectangle(x, y, w, h)
    return
  }
  cr.newSubPath()
  cr.arc(x + w - rr, y + rr, rr, -Math.PI / 2, 0)
  cr.arc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2)
  cr.arc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI)
  cr.arc(x + rr, y + rr, rr, Math.PI, 1.5 * Math.PI)
  cr.closePath()
}

export const GridIcon = GObject.registerClass(
  class GridIcon extends St.DrawingArea {
    private _state: SessionState = 'idle'
    private _phaseMs = 0
    private _paused = false
    private _broken = false
    private _timerId = 0

    constructor() {
      super({ style_class: 'dasbo-grid', y_align: Clutter.ActorAlign.CENTER })
      this.connect('repaint', () => this._onRepaint())
      // The 'destroy' signal, not a destroy() override: Clutter tears children
      // down through clutter_actor_destroy, which emits this signal and does
      // not necessarily route through a JS method override. Without it the
      // timer outlives the actor and fires against a disposed object.
      this.connect('destroy', () => this._stopTimer())
      this._schedule()
    }

    setState(state: SessionState): void {
      // Guarded because refresh() runs on every store notification. Resetting
      // the phase unconditionally would retrigger the done stagger on every
      // unrelated update.
      if (state === this._state) return
      this._state = state
      this._phaseMs = 0
      this.style_class = `dasbo-grid ${STATE_CLASS[state]}`.trim()
      this.queue_repaint()
      this._schedule()
    }

    setPaused(paused: boolean): void {
      if (paused === this._paused) return
      this._paused = paused
      if (paused) this._stopTimer()
      else this._schedule()
    }

    private _stopTimer(): void {
      if (!this._timerId) return
      GLib.Source.remove(this._timerId)
      this._timerId = 0
    }

    private _schedule(): void {
      this._stopTimer()
      if (this._paused || this._broken) return
      const interval = tickIntervalMs(this._state, this._phaseMs)
      if (interval === 0) return
      this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => {
        this._phaseMs += interval
        this.queue_repaint()
        // Zeroed before returning REMOVE so a later release cannot remove a
        // source GLib has already dropped.
        if (tickIntervalMs(this._state, this._phaseMs) === 0) {
          this._timerId = 0
          return GLib.SOURCE_REMOVE
        }
        return GLib.SOURCE_CONTINUE
      })
    }

    private _colors(): { base: Rgba; accent: Rgba } {
      const node = this.get_theme_node()
      const base = rgba(node.get_foreground_color())
      // lookup_color reports whether the property was found. A shell theme that
      // strips custom properties yields a monochrome icon rather than an
      // invisible one.
      const [found, accent] = node.lookup_color('-dasbo-accent', false)
      return { base, accent: found ? rgba(accent) : base }
    }

    private _onRepaint(): void {
      if (this._broken) return
      // Declared outside the try so the finally can see it, but assigned
      // inside: get_context() itself can throw, and the latch has to catch
      // that too or the journal floods at tick rate.
      let cr: cairo.Context | null = null
      try {
        cr = this.get_context()
        this._draw(cr)
      } catch (e) {
        this._broken = true
        this._stopTimer()
        console.warn(`dasbo-island: grid repaint failed, disabled: ${e}`)
      } finally {
        // Mandatory in GJS — the context leaks without it. Optional-chained
        // because get_context() returns null rather than throwing when the
        // surface is unset.
        cr?.$dispose()
      }
    }

    private _draw(cr: cairo.Context): void {
      const [w, h] = this.get_surface_size()
      if (w <= 0 || h <= 0) return
      const { block, gap, radius } = metrics(Math.min(w, h))
      const pose: GridPose = gridPose(this._state, this._phaseMs)
      const { base, accent } = this._colors()
      const [r, g, b, a] = pose.fill === 'accent' ? accent : base

      // Centred against width and height independently, so a surface that is
      // not square still puts the grid in the middle of it.
      const span = 2 * block + gap
      const left = Math.floor((w - span) / 2)
      const top = Math.floor((h - span) / 2)

      // Chase order: top-left, top-right, bottom-right, bottom-left. Every
      // staggered animation in grid.ts indexes blocks in this order.
      const near = block + gap
      const cells: [number, number][] = [
        [0, 0],
        [near, 0],
        [near, near],
        [0, near],
      ]

      for (let i = 0; i < cells.length; i++) {
        const [dx, dy] = cells[i]!
        cr.setSourceRGBA(r, g, b, a * pose.alpha[i]!)
        roundedRect(cr, left + dx, top + dy, block, block, radius)
        cr.fill()
      }
    }
  }
)
