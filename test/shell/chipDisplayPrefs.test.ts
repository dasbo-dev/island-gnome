import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// A combo row maps an integer index to a string value by hand, in two places
// that have to agree: the Gtk.StringList of labels and the array of values
// beside it. That pair is exactly what drifts when a value is added, and the
// drift is silent — the user picks "Name only" and gets 'logo-name'.
describe('the agent-chip-display combo', () => {
  const schema = readFileSync(
    'schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml',
    'utf8'
  )
  const prefs = readFileSync('src/prefs.ts', 'utf8')

  const key = /<key name="agent-chip-display"[\s\S]*?<\/key>/.exec(schema)?.[0] ?? ''
  const choices = [...key.matchAll(/<choice value="([^"]+)"\s*\/>/g)].map((m) => m[1])
  const values = [
    ...(/const chipOrder = \[([^\]]*)\]/.exec(prefs)?.[1] ?? '').matchAll(/'([^']+)'/g),
  ].map((m) => m[1])
  const labels = [
    ...(
      /Gtk\.StringList\.new\(\[([^\]]*)\]\)[\s\S]{0,400}?const chipOrder/.exec(prefs)?.[1] ?? ''
    ).matchAll(/'([^']+)'/g),
  ].map((m) => m[1])

  it('declares its values in the schema', () => {
    expect(key, 'no agent-chip-display key in the gschema').not.toBe('')
    expect(choices).toEqual(['logo', 'logo-name', 'name'])
  })

  it('defaults to the appearance the chip has always had', () => {
    expect(key).toMatch(/<default>'logo-name'<\/default>/)
  })

  it('maps every schema choice to the same index in prefs', () => {
    expect(values).toEqual(choices)
  })

  it('offers exactly one label per value', () => {
    expect(labels.length, 'the StringList and chipOrder disagree').toBe(values.length)
  })
})
