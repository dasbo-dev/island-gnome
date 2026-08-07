import Gio from 'gi://Gio'
import St from 'gi://St'
import { logoAsset, prefersDark } from '../core/logo.js'

/**
 * The project mark as a header icon, or `null` when the asset is not there.
 *
 * Returning `null` rather than an empty St.Icon is deliberate: an icon with no
 * gicon still occupies its icon_size, so a missing file would cost the header
 * a 16px hole. The header just leaves the mark out instead — the same
 * fail-open contract agentIcon.ts documents for the chip marks.
 *
 * The Shell has no style manager, so the variant comes from the desktop's own
 * colour-scheme setting. It is re-read on change because this icon is built
 * once at enable() and lives until disable(): without the watcher, a user who
 * switches theme mid-session keeps a near-invisible mark until the extension
 * is reloaded.
 */
export function logoIcon(base: string, size = 16): St.Icon | null {
  const settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' })

  const current = (): Gio.Icon | null =>
    _gicon(base, prefersDark(settings.get_string('color-scheme')))

  const first = current()
  if (!first) return null

  const icon = new St.Icon({
    style_class: 'dasbo-header-logo',
    icon_size: size,
    gicon: first,
  })

  const handler = settings.connect('changed::color-scheme', () => {
    // A null here means the other variant is missing while this one is not.
    // Keeping the mark already on screen beats blanking the header.
    const next = current()
    if (next) icon.gicon = next
  })
  // The popup tree is destroyed on disable(); the settings object outlives
  // this frame only through that handler, so dropping it here is what keeps a
  // disable/enable cycle from stacking up live handlers on a dead actor.
  icon.connect('destroy', () => settings.disconnect(handler))

  return icon
}

function _gicon(base: string, dark: boolean): Gio.Icon | null {
  try {
    const file = Gio.File.new_for_path(`${base}/${logoAsset(dark)}`)
    return file.query_exists(null) ? Gio.FileIcon.new(file) : null
  } catch (e) {
    // query_exists does not throw for an absent file, but it can for a path
    // that is not readable at all. This runs inside a widget build, and an
    // exception escaping there takes the popup with it.
    console.warn(`dasbo-island: resolving the logo failed: ${e}`)
    return null
  }
}
