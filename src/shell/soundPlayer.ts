import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import { CUE_DESCRIPTIONS, CUE_SOUNDS, shouldPlay, type SoundCue } from '../core/sound.js'

/**
 * The desktop's own "event sounds" switch, or null when the schema is not
 * installed. Looked up rather than constructed by id: `new Gio.Settings` on an
 * unknown schema_id calls g_error, which aborts the whole shell process — a
 * price far past anything a missing beep is worth.
 *
 * The same hazard applies one level down: `get_boolean` on a key absent from
 * a *compiled* schema is also `g_error`, which is exactly why the constructor
 * below checks `has_key('notification-sounds')` before ever reading it. That
 * guard is for our own schema; this one is for a schema we do not own, so the
 * check belongs here instead. `event-sounds` has shipped on
 * org.gnome.desktop.sound since GNOME 3.0, so this is unlikely to ever trip —
 * but there is no new behaviour to reason about either way: a missing key
 * lands on the same permissive `null` path as a missing schema entirely.
 */
function desktopSoundSettings(): Gio.Settings | null {
  const schema = Gio.SettingsSchemaSource.get_default()?.lookup(
    'org.gnome.desktop.sound',
    true
  )
  if (!schema) return null
  const settings = new Gio.Settings({ settings_schema: schema })
  return settings.settings_schema.has_key('event-sounds') ? settings : null
}

/**
 * Plays the XDG theme sound for a cue. The only place in the extension that
 * makes a noise, so it is also the only place the mute checks, the throttle
 * and the catch have to be right. The decision itself — whether a given call
 * should actually make noise — lives in `shouldPlay` in core/sound.ts, where
 * it is unit-tested directly; this class only gathers the inputs, calls it,
 * and does the GObject/GLib work the pure core cannot do.
 */
export class SoundPlayer {
  private _settings: Gio.Settings
  private _desktop: Gio.Settings | null
  private _last = new Map<SoundCue, number>()
  private _warned = false
  /**
   * Set by destroy(), checked first in play(). disable() resolves any pending
   * permissions before it destroys the island (see extension.ts's teardown
   * comment for why that order is not to be changed), and settling a held
   * permission through clearPending can reach a 'done' diff and therefore
   * play('done') — this flag is what keeps that reachable-during-teardown
   * path from chiming on the way out, without reordering anything.
   */
  private _destroyed = false
  /**
   * Whether the compiled schema actually has the notification-sounds key,
   * checked once here rather than on every play(). get_boolean on a key
   * absent from the *compiled* schema is g_error, which aborts the whole
   * shell process — a price a skipped schema recompile must not be able to
   * charge on the user's first permission request. Silence is a survivable
   * degradation; aborting the compositor is not.
   */
  private _hasNotificationSoundsKey: boolean

  constructor(settings: Gio.Settings) {
    this._settings = settings
    this._desktop = desktopSoundSettings()
    this._hasNotificationSoundsKey = settings.settings_schema.has_key('notification-sounds')
  }

  /**
   * Sets the destroyed flag without releasing `_last`/`_desktop`. Exists so
   * `disable()` can silence the player before `resolveAllFallthrough()` runs
   * — that call can settle a held permission into 'done' and reach
   * `play('done')` through `Island.refresh()` while the island itself is
   * still alive, and the teardown order that makes that reachable is not to
   * be changed (see extension.ts). `destroy()` still runs later, in its
   * usual place, to release the rest; this only pulls the "go silent" bit of
   * it forward.
   */
  markDestroyed(): void {
    this._destroyed = true
  }

  play(cue: SoundCue): void {
    if (this._destroyed) return
    if (!this._hasNotificationSoundsKey) return

    const enabled = this._settings.get_boolean('notification-sounds')
    // A desktop with no gnome-desktop schemas cannot say it wants silence, so
    // it is not read as saying so — the extension's own switch above still
    // governs. Only an explicit false silences this. (See shouldPlay's rule 2.)
    const eventSounds = this._desktop ? this._desktop.get_boolean('event-sounds') : null

    // GLib's monotonic clock rather than the JS wall clock: the wall clock is
    // not monotonic, and an NTP step backwards by N would leave every cue's
    // stamp N in the future and silence it for the whole of N. island.ts's own
    // comment on backwards-clock handling is the same lesson.
    const now = GLib.get_monotonic_time() / 1000
    const last = this._last.get(cue) ?? 0
    if (!shouldPlay({ enabled, eventSounds, last, now })) return
    // Stamped before the attempt, not after: a failing play should still hold
    // the gap open rather than let every caller in the next tick retry it.
    this._last.set(cue, now)

    try {
      global.display
        .get_sound_player()
        .play_from_theme(CUE_SOUNDS[cue], CUE_DESCRIPTIONS[cue], null)
    } catch (e) {
      // Once. This is reached from Island.refresh(), which runs on a 1s timer
      // while the popup is open, and a warn per tick would bury the journal.
      if (!this._warned) {
        this._warned = true
        console.warn(`dasbo-island: playing a sound failed, staying silent: ${e}`)
      }
    }
  }

  destroy(): void {
    this._destroyed = true
    this._last.clear()
    this._desktop = null
  }
}
