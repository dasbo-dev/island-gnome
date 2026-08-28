import { describe, it, expect, vi, afterEach } from 'vitest'
import { warn } from '../../src/core/log.js'

afterEach(() => {
  vi.restoreAllMocks()
})

// The prefix lives in one place so a journalctl filter keeps working no
// matter which module raised the line, and so the count of raw console call
// sites in the bundle stays at one — see
// docs/superpowers/specs/2026-08-28-shexli-static-analysis-design.md.
describe('warn', () => {
  it('prefixes the message with the extension name', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warn('the sky fell')
    expect(spy).toHaveBeenCalledWith('dasbo-island: the sky fell')
  })

  it('writes one line per call and swallows nothing', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warn('one')
    warn('two')
    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy).toHaveBeenLastCalledWith('dasbo-island: two')
  })
})
