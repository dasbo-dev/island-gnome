import St from 'gi://St'
import Cairo from 'gi://cairo'
import Clutter from 'gi://Clutter'
import GObject from 'gi://GObject'
import GLib from 'gi://GLib'
import type cairo from 'cairo'
import type { SessionState } from '../core/types.js'
import { robotPose, tickIntervalMs, type RobotPose } from '../core/robot.js'

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

// Fractions of S = min(width, height). See the plan's geometry note for the
// two invariants these satisfy; both are tight, so tune in pairs.
const HEAD_W = 0.578
const HEAD_H = 0.493
const HEAD_R = 0.11
const HEAD_CY = 0.06
const STROKE = 0.072
const ANTENNA_LEN = 0.128
const ANTENNA_TIP_R = 0.06
const EYE_DX = 0.115
const EYE_R = 0.064
const EYE_CY = -0.026
const EYE_TRAVEL = 0.034
const MOUTH_W = 0.17
const MOUTH_CY = 0.136
const SHAKE = 0.045
const ZZZ_X = 0.3
const ZZZ_Y0 = -0.16
const ZZZ_RISE = 0.26
const ZZZ_SIZE = 0.095

type Rgba = [number, number, number, number]

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
  cr.newSubPath()
  cr.arc(x + w - rr, y + rr, rr, -Math.PI / 2, 0)
  cr.arc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2)
  cr.arc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI)
  cr.arc(x + rr, y + rr, rr, Math.PI, 1.5 * Math.PI)
  cr.closePath()
}

export const RobotHead = GObject.registerClass(
  class RobotHead extends St.DrawingArea {
    private _state: SessionState = 'idle'
    private _phaseMs = 0
    private _animateIdle = false
    private _paused = false
    private _broken = false
    private _timerId = 0

    constructor() {
      super({ style_class: 'dasbo-robot', y_align: Clutter.ActorAlign.CENTER })
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
      // the phase unconditionally would retrigger the error shake and the done
      // pop on every unrelated update.
      if (state === this._state) return
      this._state = state
      this._phaseMs = 0
      this.style_class = `dasbo-robot ${STATE_CLASS[state]}`.trim()
      this.queue_repaint()
      this._schedule()
    }

    setAnimateIdle(value: boolean): void {
      if (value === this._animateIdle) return
      this._animateIdle = value
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
      const interval = tickIntervalMs(this._state, this._phaseMs, this._animateIdle)
      if (interval === 0) return
      this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => {
        this._phaseMs += interval
        this.queue_repaint()
        // Zeroed before returning REMOVE so _stopTimer cannot later remove a
        // source GLib has already dropped.
        if (tickIntervalMs(this._state, this._phaseMs, this._animateIdle) === 0) {
          this._timerId = 0
          return GLib.SOURCE_REMOVE
        }
        return GLib.SOURCE_CONTINUE
      })
    }

    private _colors(): { fg: Rgba; accent: Rgba } {
      const node = this.get_theme_node()
      const fg = rgba(node.get_foreground_color())
      // lookup_color reports whether the property was found. A shell theme
      // that strips custom properties yields a monochrome head rather than an
      // invisible one.
      const [found, accent] = node.lookup_color('-dasbo-accent', false)
      return { fg, accent: found ? rgba(accent) : fg }
    }

    private _onRepaint(): void {
      if (this._broken) return
      const cr = this.get_context()
      try {
        this._draw(cr)
      } catch (e) {
        // Latched, not merely logged: an exception escaping a repaint handler
        // would otherwise reprint at tick rate, several lines a second, and
        // flood the journal.
        this._broken = true
        this._stopTimer()
        console.warn(`dasbo-island: robot repaint failed, disabled: ${e}`)
      } finally {
        // Mandatory in GJS — the context leaks without it, and this runs
        // several times a second.
        cr.$dispose()
      }
    }

    private _draw(cr: cairo.Context): void {
      const [w, h] = this.get_surface_size()
      if (w <= 0 || h <= 0) return
      const s = Math.min(w, h)
      const u = (v: number): number => v * s
      const cx = w / 2
      const cy = h / 2
      const pose: RobotPose = robotPose(this._state, this._phaseMs, this._animateIdle)
      const { fg, accent } = this._colors()

      cr.setLineCap(Cairo.LineCap.ROUND)
      cr.setLineJoin(Cairo.LineJoin.ROUND)

      // Sleep glyphs are drawn in widget space, outside the head's transform,
      // so a tilt or a pop cannot drag them around.
      for (const t of pose.zzz) {
        const size = u(ZZZ_SIZE) * (0.6 + 0.4 * t)
        const x = cx + u(ZZZ_X)
        const y = cy + u(HEAD_CY) + u(ZZZ_Y0) - u(ZZZ_RISE) * t
        cr.setSourceRGBA(fg[0], fg[1], fg[2], fg[3] * (1 - t) * 0.9)
        cr.setLineWidth(Math.max(1, u(STROKE) * 0.6))
        cr.moveTo(x - size / 2, y - size / 2)
        cr.lineTo(x + size / 2, y - size / 2)
        cr.lineTo(x - size / 2, y + size / 2)
        cr.lineTo(x + size / 2, y + size / 2)
        cr.stroke()
      }

      cr.save()
      cr.translate(cx + pose.headShakeX * u(SHAKE), cy + u(HEAD_CY))
      cr.scale(pose.scale, pose.scale)
      cr.rotate(pose.headTilt)
      cr.setLineWidth(u(STROKE))

      const topY = -u(HEAD_H) / 2
      const tipY = topY - u(ANTENNA_LEN)
      cr.setSourceRGBA(fg[0], fg[1], fg[2], fg[3])
      cr.moveTo(0, topY)
      cr.lineTo(0, tipY)
      cr.stroke()
      cr.setSourceRGBA(accent[0], accent[1], accent[2], accent[3] * pose.antennaLit)
      cr.arc(0, tipY, u(ANTENNA_TIP_R), 0, 2 * Math.PI)
      cr.fill()

      cr.setSourceRGBA(fg[0], fg[1], fg[2], fg[3])
      roundedRect(cr, -u(HEAD_W) / 2, topY, u(HEAD_W), u(HEAD_H), u(HEAD_R))
      cr.stroke()

      // At this size the eye dot is the pupil: a sclera with a pupil inside it
      // would be sub-pixel, so the whole dot travels instead.
      const ey = u(EYE_CY) + pose.eyeY * u(EYE_TRAVEL)
      cr.setSourceRGBA(accent[0], accent[1], accent[2], accent[3])
      for (const sign of [-1, 1]) {
        const ex = sign * u(EYE_DX) + pose.eyeX * u(EYE_TRAVEL)
        const r = u(EYE_R)
        if (pose.eyeShape === 'cross') {
          cr.moveTo(ex - r, ey - r)
          cr.lineTo(ex + r, ey + r)
          cr.moveTo(ex + r, ey - r)
          cr.lineTo(ex - r, ey + r)
          cr.stroke()
        } else if (pose.eyeShape === 'arc') {
          cr.arc(ex, ey + r * 0.5, r, Math.PI, 2 * Math.PI)
          cr.stroke()
        } else if (pose.eyeOpen <= 0) {
          cr.moveTo(ex - r, ey)
          cr.lineTo(ex + r, ey)
          cr.stroke()
        } else {
          cr.arc(ex, ey, r * pose.eyeOpen, 0, 2 * Math.PI)
          cr.fill()
        }
      }

      if (pose.mouth !== 'none') {
        const my = u(MOUTH_CY)
        const mw = u(MOUTH_W)
        cr.setSourceRGBA(fg[0], fg[1], fg[2], fg[3])
        if (pose.mouth === 'smile') {
          cr.arc(0, my - mw / 4, mw / 2, 0.15 * Math.PI, 0.85 * Math.PI)
        } else {
          cr.moveTo(-mw / 2, my)
          cr.lineTo(mw / 2, my)
        }
        cr.stroke()
      }

      cr.restore()
    }
  }
)
