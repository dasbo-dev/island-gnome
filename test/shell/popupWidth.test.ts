import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// The popup's width is one number, declared once in .dasbo-fixed-width, and
// reasoned about in prose in three other places: two comments explaining why a
// question's option is a single Pango-marked-up label rather than two columns,
// and one explaining what an unwrapped line overhangs. Those comments are the
// argument for the code around them, and an argument citing a width the
// stylesheet no longer uses is worse than no comment at all.
//
// Widening the popup for the agent chip is precisely the change that creates
// that drift, so this guard ships with it.
const SITES = [
  'src/core/questions.ts',
  'src/shell/questionPanel.ts',
  'test/shell/noEllipsis.test.ts',
  'src/core/adapters/index.ts',
]

describe('the popup width the code talks about', () => {
  const css = readFileSync('stylesheet.css', 'utf8')
  const declared = /\.dasbo-fixed-width\s*\{[^}]*width:\s*(\d+)em/.exec(css)

  it('is declared in the stylesheet, in em', () => {
    expect(declared, '.dasbo-fixed-width needs a width in em').not.toBeNull()
  })

  for (const site of SITES) {
    it(`${site} quotes that same number`, () => {
      const src = readFileSync(site, 'utf8')
      // Negative lookbehind so this doesn't match the "85" tail of a fractional
      // em like agentChip's 0.85em label — a real popup width is never
      // fractional, but the bare (\d+)em pattern can't tell the difference.
      const quoted = [...src.matchAll(/(?<![\d.])(\d+)em/g)].map((m) => m[1])
      expect(
        quoted.length,
        `${site} no longer mentions a width — drop it from SITES`
      ).toBeGreaterThan(0)
      for (const n of quoted) expect(n).toBe(declared?.[1])
    })
  }
})
