import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('AgentChip', () => {
  const src = readFileSync('src/shell/agentChip.ts', 'utf8')

  it('carries the short name, not the display name', () => {
    expect(src).toContain('shortName')
    expect(src).not.toContain('displayName')
  })

  it('omits the icon rather than handing St a null gicon', () => {
    expect(src).toMatch(/if\s*\(gicon\)/)
  })

  it('sets the icon opacity on the actor, not in CSS', () => {
    // St's CSS engine does not reliably honour `opacity`, and the row is built
    // reactive: false, so the theme paints its descendants disabled-grey. The
    // same workaround popupHeader.ts and sessionRow.ts's _shellTotal carry.
    expect(src).toMatch(/\.opacity\s*=\s*255/)
  })

  it('has no update method, because a row never changes agent', () => {
    // sessionKey is `${agent}:${sessionId}` (core/types.ts): a row's agent is
    // fixed for the row's whole life. An update path here would model a
    // transition that cannot happen, and invite a caller to rely on it.
    expect(src).not.toMatch(/\bupdate\s*\(/)
  })
})
