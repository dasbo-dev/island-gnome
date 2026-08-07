import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ABOUT } from '../../src/core/about.js'

// Every one of these strings is a second copy of a fact that already lives
// somewhere else — metadata.json, LICENSE, a QR image encoded months ago. A
// wrong copy renders as a perfectly ordinary-looking row that sends the user
// to a 404, or worse, to someone else's donation page. None of it is
// reachable from a GTK-free test once it sits in src/prefs, which is the
// whole reason this record is in src/core.
describe('the About facts', () => {
  it('links out over https only', () => {
    for (const [key, value] of Object.entries(ABOUT)) {
      if (!key.endsWith('Url')) continue
      expect(value, `${key} must be https`).toMatch(/^https:\/\//)
    }
  })

  it('names the repository metadata.json already points at', () => {
    const metadata = JSON.parse(readFileSync('metadata.json', 'utf8'))
    expect(ABOUT.repoUrl).toBe(metadata.url)
  })

  it('files issues against that same repository', () => {
    expect(ABOUT.issuesUrl).toBe(`${ABOUT.repoUrl}/issues`)
  })

  it('points at the donation page the shipped QR encodes', () => {
    // Pinned literally. The QR image is a binary blob no test can decode, so
    // this line is the only thing tying the button to the picture beside it.
    expect(ABOUT.supportUrl).toBe('https://buymeacoffee.com/fsevenm')
  })

  it('claims the licence the repo actually ships', () => {
    expect(ABOUT.license).toBe('GPL-3.0-or-later')
    expect(readFileSync('LICENSE', 'utf8')).toContain('GNU GENERAL PUBLIC LICENSE')
    expect(readFileSync('LICENSE', 'utf8')).toContain('Version 3, 29 June 2007')
  })

  it('resolves the QR under the extension directory, not from outside it', () => {
    expect(ABOUT.qrAsset).toBe('assets/qr-code.png')
    expect(ABOUT.qrAsset.startsWith('/')).toBe(false)
  })
})
