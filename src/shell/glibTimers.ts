import GLib from 'gi://GLib'
import type { Timers } from '../core/permissions.js'

/** GLib-backed Timers. Every source id handed out must be released by clearTimeout. */
export const glibTimers: Timers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) =>
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
      fn()
      return GLib.SOURCE_REMOVE
    }),
  clearTimeout: (id) => {
    GLib.Source.remove(id)
  },
}
