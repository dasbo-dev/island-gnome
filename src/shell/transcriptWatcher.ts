import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import { scanTranscript, watchesTranscript } from '../core/transcript.js'
import type { SessionStore } from '../core/store.js'
import { warn } from '../core/log.js'

/**
 * Most bytes read in one pass. An interrupt marker is a couple of hundred
 * bytes and arrives within a line or two of the append that woke us, so this
 * is a bound on damage rather than a working size: a transcript that grows by
 * megabytes between two change notifications is read a megabyte at a time,
 * across several passes, instead of in one allocation the compositor has to
 * wait for.
 */
const MAX_READ = 1024 * 1024

interface Watch {
  path: string
  monitor: Gio.FileMonitor
  changedId: number
  cancellable: Gio.Cancellable
  /** Bytes of the file already scanned. Starts at the size when watching began. */
  offset: number
  /** Trailing bytes of an incomplete last line, waiting for the rest of it. */
  pending: string
  reading: boolean
}

/**
 * Tails the transcript of every running Claude session and settles the row
 * when Claude records that the user interrupted the turn.
 *
 * This exists because no hook fires on an interrupt — see the header of
 * src/core/transcript.ts, which is also where the decisions this class only
 * carries out are written down.
 *
 * The watch set is derived, never accumulated: `sync()` compares the sessions
 * the store holds now against the files being watched now, so a session that
 * stops running, changes transcript or is reaped drops its monitor on the next
 * store emit without anything having to remember to say so.
 */
export class TranscriptWatcher {
  private watches = new Map<string, Watch>()

  constructor(
    private store: SessionStore,
    /** Injected so this class reads no clock of its own, like the store. */
    private now: () => number = Date.now
  ) {}

  /** Start watching what should be watched, stop watching what should not. */
  sync(): void {
    const wanted = new Map<string, string>()
    for (const s of this.store.list()) {
      if (watchesTranscript(s) && s.transcriptPath) wanted.set(s.key, s.transcriptPath)
    }
    for (const [key, watch] of [...this.watches]) {
      // A different path under the same key is a different file to scan from a
      // different offset, so it is a stop and a start rather than an update.
      if (wanted.get(key) !== watch.path) this._stop(key)
    }
    for (const [key, path] of wanted) {
      if (!this.watches.has(key)) this._start(key, path)
    }
  }

  destroy(): void {
    for (const key of [...this.watches.keys()]) this._stop(key)
  }

  private _stop(key: string): void {
    const watch = this.watches.get(key)
    if (!watch) return
    this.watches.delete(key)
    watch.cancellable.cancel()
    // No try/catch: neither GObject.disconnect() nor Gio.FileMonitor.cancel()
    // throws, and cancel() on a monitor already cancelled is a no-op — GNOME
    // best practices #3.
    watch.monitor.disconnect(watch.changedId)
    watch.monitor.cancel()
  }

  /**
   * Begin watching one transcript, from its current end.
   *
   * Starting at the end and not at byte zero is what keeps an interrupt from
   * an *earlier* turn — the same file holds the whole conversation — from
   * settling the turn that is running now. The cost is the other direction: an
   * interrupt in the moment between the state going running and this size
   * landing is not seen, and the row stays as it was until the next event. A
   * missed settle is the behaviour this whole file is fixing; a false one
   * would be a new lie, so the race is left pointing this way.
   */
  private _start(key: string, path: string): void {
    const file = Gio.File.new_for_path(path)
    const cancellable = new Gio.Cancellable()
    file.query_info_async(
      'standard::size,standard::type',
      Gio.FileQueryInfoFlags.NONE,
      GLib.PRIORITY_LOW,
      cancellable,
      (src, res) => {
        let info: Gio.FileInfo
        try {
          info = (src as Gio.File).query_info_finish(res)
        } catch {
          // No transcript there yet, or not readable. Nothing to watch: the
          // next store emit calls sync() again and this retries.
          return
        }
        // The path came from an unprivileged peer. A fifo would block the
        // compositor forever on a read that never returns, so only a regular
        // file is opened — the check core/transcript.ts's path rules cannot
        // make from the string alone.
        if (info.get_file_type() !== Gio.FileType.REGULAR) return
        // sync() ran again while this was in flight and no longer wants it.
        if (cancellable.is_cancelled()) return

        let monitor: Gio.FileMonitor
        try {
          monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, cancellable)
        } catch (e) {
          warn(`cannot watch ${path}: ${e}`)
          return
        }
        const watch: Watch = {
          path,
          monitor,
          changedId: 0,
          cancellable,
          offset: info.get_size(),
          pending: '',
          reading: false,
        }
        watch.changedId = monitor.connect('changed', () => this._read(key))
        this.watches.set(key, watch)
      }
    )
  }

  /**
   * Read whatever has been appended since the last pass and scan it.
   *
   * One pass at a time per file (`reading`): change notifications arrive in
   * bursts while a turn runs, and a second pass starting under the first would
   * read the same bytes twice from the same offset. Whatever the burst
   * delivered is picked up by the tail of this pass, which re-runs itself
   * while the file is still longer than the offset.
   */
  private _read(key: string): void {
    const watch = this.watches.get(key)
    if (!watch || watch.reading || watch.cancellable.is_cancelled()) return
    watch.reading = true

    const file = Gio.File.new_for_path(watch.path)
    file.query_info_async(
      'standard::size',
      Gio.FileQueryInfoFlags.NONE,
      GLib.PRIORITY_LOW,
      watch.cancellable,
      (src, res) => {
        let size: number
        try {
          size = (src as Gio.File).query_info_finish(res).get_size()
        } catch {
          watch.reading = false
          return
        }
        if (size < watch.offset) {
          // Truncated or replaced under us — a resumed session rewriting its
          // own transcript does this. Re-anchor at the new end rather than
          // scanning a file whose earlier bytes we have already judged.
          watch.offset = size
          watch.pending = ''
          watch.reading = false
          return
        }
        if (size === watch.offset) {
          watch.reading = false
          return
        }
        this._readRange(key, watch, Math.min(size - watch.offset, MAX_READ))
      }
    )
  }

  private _readRange(key: string, watch: Watch, count: number): void {
    const file = Gio.File.new_for_path(watch.path)
    file.read_async(GLib.PRIORITY_LOW, watch.cancellable, (src, res) => {
      let stream: Gio.FileInputStream
      try {
        stream = (src as Gio.File).read_finish(res)
        // Synchronous, and deliberately: seeking an open descriptor is one
        // lseek with nothing to wait for. The read that follows is the part
        // that can block, and that one is async.
        stream.seek(watch.offset, GLib.SeekType.SET, watch.cancellable)
      } catch {
        watch.reading = false
        return
      }
      stream.read_bytes_async(count, GLib.PRIORITY_LOW, watch.cancellable, (s, r) => {
        let chunk: Uint8Array
        try {
          chunk = (s as Gio.FileInputStream).read_bytes_finish(r).toArray()
        } catch {
          watch.reading = false
          stream.close_async(GLib.PRIORITY_LOW, null, null)
          return
        }
        stream.close_async(GLib.PRIORITY_LOW, null, null)
        watch.reading = false
        if (chunk.length === 0) return

        watch.offset += chunk.length
        // `fatal: false`: a chunk can end mid-codepoint as easily as
        // mid-line, and the replacement character it decodes to sits in the
        // remainder until the rest of the line arrives — where it would fail
        // JSON.parse of a line we would have skipped anyway.
        const text = watch.pending + new TextDecoder('utf-8', { fatal: false }).decode(chunk)
        const { interrupted, rest } = scanTranscript(text)
        watch.pending = rest

        if (interrupted) {
          // Last thing this pass touches on `watch`: the store emit reaches
          // sync(), which stops this watch and cancels what it holds.
          this.store.markInterrupted(key, this.now())
          return
        }
        // The burst that woke us may have appended more than one pass could
        // take, and there is no promise of another notification if the turn
        // has gone quiet — so keep going while the file is ahead of us.
        this._read(key)
      })
    })
  }
}
