import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'

// A file build.mjs forgets to copy is invisible: the page renders, the
// crawler gets a 404, and nobody notices for a quarter. The same reasoning
// as test/shell/iconAssets.test.ts and test/prefs/aboutAssets.test.ts.
const build = readFileSync('build.mjs', 'utf8')

const COPIED = ['robots.txt', 'sitemap.xml', '404.html', 'og-image.png', 'favicon.svg', 'apple-touch-icon.png']

describe('the site build outputs', () => {
  for (const file of COPIED) {
    it(`site/${file} exists`, () => {
      expect(existsSync(`site/${file}`)).toBe(true)
    })

    it(`build.mjs copies ${file} into dist-site`, () => {
      expect(build).toContain(`'${file}'`)
    })
  }

  // A share card at the wrong size is cropped by every platform that
  // renders it, and nothing in the build would say so.
  it('renders the share card at 1200x630', () => {
    const png = readFileSync('site/og-image.png')
    expect(png.readUInt32BE(16)).toBe(1200)
    expect(png.readUInt32BE(20)).toBe(630)
  })

  it('renders the touch icon at 180x180', () => {
    const png = readFileSync('site/apple-touch-icon.png')
    expect(png.readUInt32BE(16)).toBe(180)
    expect(png.readUInt32BE(20)).toBe(180)
  })

  it('lists every published page in the sitemap', () => {
    const sitemap = readFileSync('site/sitemap.xml', 'utf8')
    for (const loc of ['island-gnome/', 'island-gnome/limitations.html', 'island-gnome/agent-dialects.html']) {
      expect(sitemap).toContain(`<loc>https://dasbo-dev.github.io/${loc}</loc>`)
    }
  })

  it('points robots.txt at the sitemap', () => {
    expect(readFileSync('site/robots.txt', 'utf8')).toContain(
      'Sitemap: https://dasbo-dev.github.io/island-gnome/sitemap.xml'
    )
  })
})
