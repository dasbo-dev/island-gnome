import Gio from 'gi://Gio'
import { CUE_DESCRIPTIONS, CUE_SOUNDS, type SoundCue } from '../core/sound.js'

/**
 * Minimum gap between two plays of the same cue. Two sessions can reach one
 * cue inside a single store emit, and two overlapping copies of the same
 * theme sound read as a glitch rather than as two events. Per cue, not
 * global: a permission and a notification arriving together are both heard.
 */
const THROTTLE_MS = 500

/**
 * The desktop's own "event sounds" switch, or null when the schema is not
 * installed. Looked up rather than constructed by id: `new Gio.Settings` on an
 * unknown schema_id calls g_error, which aborts the whole shell process — a
 * price far past anything a missing beep is worth.
 */
function desktopSoundSettings(): Gio.Settings | null {
  const schema = Gio.SettingsSchemaSource.get_default()?.lookup(
    'org.gnome.desktop.sound',
    true
  )
  return schema ? new Gio.Settings({ settings_schema: schema }) : null
}

/**
 * Plays the XDG theme sound for a cue. The only place in the extension that
 * makes a noise, so it is also the only place the mute checks, the throttle
 * and the catch have to be right.
 */
export class SoundPlayer {
  private _settings: Gio.Settings
  private _desktop: Gio.Settings | null
  private _last = new Map<SoundCue, number>()
  private _warned = false

  constructor(settings: Gio.Settings) {
    this._settings = settings
    this._desktop = desktopSoundSettings()
  }

  play(cue: SoundCue): void {
    if (!this._settings.get_boolean('notification-sounds')) return
    // A desktop with no gnome-desktop schemas cannot say it wants silence, so
    // it is not read as saying so — the extension's own switch above still
    // governs. Only an explicit false silences this.
    if (this._desktop && !this._desktop.get_boolean('event-sounds')) return

    const now = Date.now()
    if (now - (this._last.get(cue) ?? 0) < THROTTLE_MS) return
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
    this._last.clear()
    this._desktop = null
  }
}
