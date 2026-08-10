import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { PREFS_LABEL } from '../../src/core/vocabulary.js'

const SCHEMA = 'schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml'
const xml = readFileSync(SCHEMA, 'utf8')

interface Key { name: string; summary: string; description: string }

const keys: Key[] = [...xml.matchAll(/<key name="([^"]+)"[^>]*>([\s\S]*?)<\/key>/g)].map((m) => ({
  name: m[1]!,
  summary: m[2]!.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim() ?? '',
  description: m[2]!.match(/<description>([\s\S]*?)<\/description>/)?.[1]?.trim() ?? '',
}))

describe('the schema and the preferences window say the same thing', () => {
  it('parses every key out of the schema', () => {
    expect(keys.length).toBeGreaterThan(0)
  })

  // The whole class of drift this file exists to close: the schema's summaries
  // are what dconf-editor and `gsettings describe` show, and they were written
  // separately from the labels the preferences window shows for the same keys.
  it('gives every key a summary that is its preferences label, verbatim', () => {
    for (const key of keys) {
      expect(PREFS_LABEL[key.name], `${key.name} has no entry in PREFS_LABEL`).toBeDefined()
      expect(key.summary, key.name).toBe(PREFS_LABEL[key.name])
    }
  })

  it('has no label for a key the schema does not define', () => {
    const names = new Set(keys.map((k) => k.name))
    for (const name of Object.keys(PREFS_LABEL)) {
      expect(names.has(name), `${name} is labelled but not in the schema`).toBe(true)
    }
  })

  it('never lets a summary call the island a pill', () => {
    for (const key of keys) expect(key.summary.toLowerCase(), key.name).not.toContain('pill')
  })

  // Read alone in dconf-editor, a description that opens with the exception
  // never says what the key does.
  it('states the rule before the exception in every description', () => {
    for (const key of keys) {
      expect(key.description, key.name).not.toBe('')
      expect(key.description.startsWith('Suppressed'), key.name).toBe(false)
      expect(key.description.startsWith('Independent'), key.name).toBe(false)
    }
  })

  it('writes prose apostrophes curly, the way the rest of the copy does', () => {
    for (const key of keys) {
      expect(/\w'\w/.test(key.description), `${key.name}: ${key.description}`).toBe(false)
    }
  })
})
