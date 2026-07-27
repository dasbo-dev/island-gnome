import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import type { FileEdit } from '../core/types.js'

export function readFileOrNull(path: string): string | null {
  try {
    const [ok, bytes] = GLib.file_get_contents(path)
    if (!ok) return null
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

/**
 * Write each planned edit, taking a one-time .dasbo.bak snapshot first.
 * Throws on the first failure so the prefs UI can report it; earlier edits stay applied,
 * which is safe because each edit is a complete file body.
 */
export function applyEdits(edits: FileEdit[]): void {
  for (const edit of edits) {
    const file = Gio.File.new_for_path(edit.path)
    const parent = file.get_parent()
    if (parent && !parent.query_exists(null)) parent.make_directory_with_parents(null)

    if (edit.backup) {
      const backupPath = `${edit.path}.dasbo.bak`
      if (file.query_exists(null) && !Gio.File.new_for_path(backupPath).query_exists(null)) {
        const current = readFileOrNull(edit.path)
        if (current !== null) {
          GLib.file_set_contents(backupPath, new TextEncoder().encode(current))
        }
      }
    }

    GLib.file_set_contents(edit.path, new TextEncoder().encode(edit.content))
  }
}
