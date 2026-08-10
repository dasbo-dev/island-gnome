import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const html = readFileSync('site/index.html', 'utf8')
const ORIGIN = 'https://dasbo-dev.github.io/island-gnome/'

describe('the landing page head', () => {
  it('declares a self-referencing canonical', () => {
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}">`)
  })

  // og:url pointed at fsevenm.github.io/dasbo-island long after Pages moved.
  // Every absolute URL on the page has to agree, or the canonical, the
  // sitemap and the share card each claim a different home.
  it('agrees with itself on the origin', () => {
    const absolute = [...html.matchAll(/content="(https:\/\/[^"]+github\.io[^"]*)"/g)].map((m) => m[1]!)
    expect(absolute.length).toBeGreaterThan(0)
    for (const url of absolute) expect(url.startsWith(ORIGIN)).toBe(true)
  })

  // C3. 173 characters is past where Google truncates, and the description
  // was the subhead again anyway — four surfaces spending one message.
  it('keeps the meta description under 160 characters and off the OG copy', () => {
    const description = html.match(/<meta name="description" content="([^"]+)"/)?.[1] ?? ''
    const og = html.match(/<meta property="og:description" content="([^"]+)"/)?.[1] ?? ''
    expect(description.length).toBeLessThanOrEqual(160)
    expect(description.length).toBeGreaterThan(0)
    expect(og).not.toBe(description)
  })

  it('ships a large share card with alt text', () => {
    expect(html).toContain(`<meta property="og:image" content="${ORIGIN}og-image.png">`)
    expect(html).toContain('og:image:alt')
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">')
  })

  it('ships a favicon and a touch icon', () => {
    expect(html).toContain('rel="icon"')
    expect(html).toContain('rel="apple-touch-icon"')
  })

  it('carries the secondary meta the audit asked for', () => {
    expect(html).toContain('og:site_name')
    expect(html).toContain('og:locale')
    expect(html).toContain('<meta name="theme-color" content="#1c1f26">')
  })

  // S5. Only fields the repo can back. No aggregateRating — there are no
  // ratings, and inventing them is the one thing this page must not do.
  it('describes itself with valid SoftwareApplication JSON-LD', () => {
    const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? ''
    const data = JSON.parse(block)
    // metadata.json calls it version-name; the numeric "version" GNOME uses
    // for extensions.gnome.org is not in this file at all.
    const metadata = JSON.parse(readFileSync('metadata.json', 'utf8'))
    expect(data['@type']).toBe('SoftwareApplication')
    expect(data.softwareVersion).toBe(metadata['version-name'])
    expect(data.operatingSystem).toContain(`GNOME Shell ${metadata['shell-version'].join(', ')}`)
    expect(data.offers.price).toBe('0')
    expect(data).not.toHaveProperty('aggregateRating')
  })

  // S7/C4. The H1 was the piece giving away free ranking: no desktop, no
  // agent, no product name.
  it('names the desktop in the H1', () => {
    const h1 = html.match(/<h1>([\s\S]*?)<\/h1>/)?.[1] ?? ''
    expect(h1).toContain('GNOME')
  })
})
