import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// An interrupted Claude turn fires no hook, so the only way the island learns
// about it is the line Claude writes into the session transcript. The decision
// ("is this line an interrupt", "is this session worth tailing") is pure and
// tested for real in test/core/transcript.test.ts; what can only be asserted
// against the source is the machinery around it, which needs Gio, a compositor
// and a live agent to run.
describe('the transcript watcher', () => {
  const watcher = readFileSync('src/shell/transcriptWatcher.ts', 'utf8')
  const extension = readFileSync('src/extension.ts', 'utf8')

  it('starts at the end of the file, not at byte zero', () => {
    // The transcript holds the whole conversation. Scanning from the start
    // would find an interrupt from an earlier turn and settle the row that is
    // running now.
    expect(watcher).toMatch(/offset: info\.get_size\(\)/)
  })

  it('opens nothing that is not a regular file', () => {
    // The path arrives over D-Bus from an unprivileged peer, and a read on a
    // fifo never returns — on the compositor thread, that is the session
    // frozen.
    expect(watcher).toMatch(/if \(info\.get_file_type\(\) !== Gio\.FileType\.REGULAR\) return/)
  })

  it('reads asynchronously and bounds one pass', () => {
    expect(watcher).toMatch(/read_bytes_async\(count,/)
    expect(watcher).toMatch(/Math\.min\(size - watch\.offset, MAX_READ\)/)
    // A synchronous whole-file read of a transcript that runs to megabytes is
    // a visible stutter in every animation on screen.
    expect(watcher).not.toMatch(/load_contents\b/)
  })

  it('keeps reading while the file is ahead of the offset', () => {
    // Change notifications arrive in bursts and stop the moment the turn goes
    // quiet — which, after an interrupt, is immediately. A pass that stopped
    // at one chunk could leave the marker unread with nothing left to wake it.
    expect(watcher).toMatch(/this\._read\(key\)\s*\n\s*\}\)\s*\n\s*\}\)/)
  })

  it('derives its watch set from the store rather than accumulating one', () => {
    expect(watcher).toMatch(/watchesTranscript\(s\)/)
    expect(watcher).toMatch(/if \(wanted\.get\(key\) !== watch\.path\) this\._stop\(key\)/)
  })

  it('is driven by the store, with no timer of its own', () => {
    expect(extension).toMatch(/new TranscriptWatcher\(this\._store\)/)
    expect(extension).toMatch(/this\._store\.subscribe\(\(\) => this\._transcripts\?\.sync\(\)\)/)
    expect(watcher).not.toMatch(/timeout_add/)
  })

  it('releases the subscription and the monitors on disable', () => {
    // Module-free state, but shell-lifetime state: a monitor left connected
    // outlives the store it reports to, and the next enable() adds another.
    // disable() used to wrap this step in a safely() helper and the assertion
    // keyed on that wrapper's label. The wrapper is gone (it guarded calls
    // that cannot throw), so the release is pinned by its position instead:
    // inside disable(), subscription dropped before the watcher it feeds.
    const disable = extension.slice(extension.indexOf('disable() {'))
    expect(disable).toContain('this._unwatchStore?.()')
    expect(disable).toContain('this._transcripts?.destroy()')
    expect(disable.indexOf('this._unwatchStore?.()')).toBeLessThan(
      disable.indexOf('this._transcripts?.destroy()')
    )
    expect(watcher).toMatch(/watch\.cancellable\.cancel\(\)/)
    expect(watcher).toMatch(/watch\.monitor\.disconnect\(watch\.changedId\)/)
  })
})
