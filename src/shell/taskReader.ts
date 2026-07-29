import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import { parseTaskFile } from '../core/tasks.js'
import type { AgentTask } from '../core/tasks.js'
import type { AgentId } from '../core/types.js'

/**
 * A bound on work, not a display cap: the user asked to see every entry, and no
 * real plan approaches this. It exists so a directory that has somehow filled
 * with files cannot turn one popup open into thousands of reads.
 */
const MAX_FILES = 200

/**
 * Where an agent keeps its task list, or null if it keeps none on disk.
 *
 * Only Claude does. The path is keyed on the session id straight out of the
 * hook payload, which is exactly the id the store keys its records on — a
 * `/clear` mints a new one, so a new conversation reads a new (empty)
 * directory with no cleanup anywhere.
 *
 * The id arrives over D-Bus from an unprivileged peer and is interpolated into
 * a path, so it must be exactly one ordinary path component — a separator is
 * rejected, and so is a leading dot, which covers `.` and `..`. `GLib.build_filenamev`
 * does not normalise segments, so without the second half of that rule an id of
 * `..` would resolve one directory up and point this reader at the whole of `~/.claude`.
 */
export function taskDir(agent: AgentId, sessionId: string): string | null {
  if (agent !== 'claude') return null
  if (!sessionId || sessionId.includes('/') || sessionId.startsWith('.')) return null
  return GLib.build_filenamev([GLib.get_home_dir(), '.claude', 'tasks', sessionId])
}

/**
 * Every `<id>.json` in `dir`, parsed. Calls back with null — never an empty
 * array — when the directory could not be read at all, so the caller can tell
 * "the agent has no tasks" from "we could not look" and decline to blank a good
 * list on a transient failure.
 *
 * Asynchronous throughout. This runs on the compositor thread, where a
 * synchronous read of a directory on a busy or networked filesystem is a
 * visible stutter in every animation on screen.
 *
 * A file that fails to load or parse is skipped rather than failing the batch:
 * Claude writes these without an atomic rename, so catching one mid-write is
 * expected, and the next read a second later picks it up.
 */
export function readTasks(dir: string, done: (tasks: AgentTask[] | null) => void): void {
  const folder = Gio.File.new_for_path(dir)
  folder.enumerate_children_async(
    'standard::name',
    Gio.FileQueryInfoFlags.NONE,
    GLib.PRIORITY_LOW,
    null,
    (src, res) => {
      let enumerator: Gio.FileEnumerator
      try {
        enumerator = (src as Gio.File).enumerate_children_finish(res)
      } catch {
        // The ordinary case, not an error worth logging: an agent that has
        // never made a plan has no directory.
        done(null)
        return
      }
      enumerator.next_files_async(MAX_FILES, GLib.PRIORITY_LOW, null, (esrc, eres) => {
        let names: string[]
        try {
          names = (esrc as Gio.FileEnumerator)
            .next_files_finish(eres)
            .map((info) => info.get_name())
            .filter((name) => name.endsWith('.json'))
        } catch {
          done(null)
          return
        } finally {
          enumerator.close_async(GLib.PRIORITY_LOW, null, null)
        }

        if (names.length === 0) {
          done([])
          return
        }

        const tasks: AgentTask[] = []
        let outstanding = names.length
        const decoder = new TextDecoder()
        // One shared completion counter rather than a chain: the reads are
        // independent, and serialising them would make a ten-task list ten
        // round trips deep.
        const finishOne = () => {
          outstanding -= 1
          if (outstanding === 0) done(tasks)
        }

        for (const name of names) {
          const file = folder.get_child(name)
          file.load_contents_async(null, (fsrc, fres) => {
            try {
              const [ok, contents] = (fsrc as Gio.File).load_contents_finish(fres)
              if (ok) {
                const task = parseTaskFile(JSON.parse(decoder.decode(contents)))
                if (task) tasks.push(task)
              }
            } catch {
              // Half-written or malformed. Skipped; the rest still render.
            }
            finishOne()
          })
        }
      })
    }
  )
}
