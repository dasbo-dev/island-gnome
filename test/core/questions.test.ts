import { describe, it, expect } from 'vitest'
import { parseQuestions, formatAnswer, type Question } from '../../src/core/questions.js'

const oneQuestion = {
  questions: [
    {
      question: 'Which library for date formatting?',
      header: 'Library',
      options: [
        { label: 'date-fns', description: 'tree-shakeable' },
        { label: 'Luxon', description: 'timezone-aware' },
      ],
      multiSelect: false,
    },
  ],
}

describe('parseQuestions', () => {
  it('accepts the shape Claude sends', () => {
    expect(parseQuestions(oneQuestion)).toEqual([
      {
        question: 'Which library for date formatting?',
        header: 'Library',
        options: [
          { label: 'date-fns', description: 'tree-shakeable' },
          { label: 'Luxon', description: 'timezone-aware' },
        ],
        multiSelect: false,
      },
    ])
  })

  it('defaults multiSelect to false when absent', () => {
    const raw = { questions: [{ ...oneQuestion.questions[0], multiSelect: undefined }] }
    const result = parseQuestions(raw) as Question[]
    expect(result[0]!.multiSelect).toBe(false)
  })

  it('keeps a multiSelect question', () => {
    const raw = { questions: [{ ...oneQuestion.questions[0], multiSelect: true }] }
    const result = parseQuestions(raw) as Question[]
    expect(result[0]!.multiSelect).toBe(true)
  })

  it('drops the preview field it does not render', () => {
    const raw = {
      questions: [
        {
          ...oneQuestion.questions[0],
          options: [
            { label: 'a', description: 'first', preview: '# mockup' },
            { label: 'b', description: 'second' },
          ],
        },
      ],
    }
    const result = parseQuestions(raw) as Question[]
    expect(result[0]!.options[0]!).toEqual({ label: 'a', description: 'first' })
  })

  it('returns null for a non-record input', () => {
    expect(parseQuestions('nope')).toBeNull()
    expect(parseQuestions(null)).toBeNull()
    expect(parseQuestions([oneQuestion])).toBeNull()
  })

  it('returns null when questions is missing or empty', () => {
    expect(parseQuestions({})).toBeNull()
    expect(parseQuestions({ questions: [] })).toBeNull()
  })

  it('returns null beyond four questions', () => {
    const q = oneQuestion.questions[0]
    expect(parseQuestions({ questions: [q, q, q, q] })).not.toBeNull()
    expect(parseQuestions({ questions: [q, q, q, q, q] })).toBeNull()
  })

  it('returns null when a question has fewer than two or more than four options', () => {
    const opt = { label: 'a', description: 'b' }
    const mk = (n: number) => ({
      questions: [{ ...oneQuestion.questions[0], options: Array.from({ length: n }, () => opt) }],
    })
    expect(parseQuestions(mk(1))).toBeNull()
    expect(parseQuestions(mk(2))).not.toBeNull()
    expect(parseQuestions(mk(4))).not.toBeNull()
    expect(parseQuestions(mk(5))).toBeNull()
  })

  it('returns null when question, header or an option label is missing', () => {
    const q = oneQuestion.questions[0]
    expect(parseQuestions({ questions: [{ ...q, question: '' }] })).toBeNull()
    expect(parseQuestions({ questions: [{ ...q, header: undefined }] })).toBeNull()
    expect(
      parseQuestions({ questions: [{ ...q, options: [{ description: 'x' }, { label: 'y', description: 'z' }] }] })
    ).toBeNull()
  })

  it('substitutes an empty string for a missing option description', () => {
    const raw = {
      questions: [
        { ...oneQuestion.questions[0], options: [{ label: 'a' }, { label: 'b', description: 'z' }] },
      ],
    }
    const result = parseQuestions(raw) as Question[]
    expect(result[0]!.options[0]!).toEqual({ label: 'a', description: '' })
  })
})

const PREFIX = 'The user answered in Dasbo Island rather than the terminal — do not re-ask.'

function q(header: string, multiSelect = false): Question {
  return {
    question: `${header}?`,
    header,
    options: [
      { label: 'one', description: '' },
      { label: 'two', description: '' },
    ],
    multiSelect,
  }
}

describe('formatAnswer', () => {
  it('prefixes the answer so a denial reads as a reply', () => {
    expect(formatAnswer([q('Library')], [['date-fns']])).toBe(`${PREFIX} Library: date-fns`)
  })

  it('joins several selections for one question with commas', () => {
    expect(formatAnswer([q('Features', true)], [['Postgres', 'Redis']])).toBe(
      `${PREFIX} Features: Postgres, Redis`
    )
  })

  it('joins several questions with semicolons, in order', () => {
    expect(
      formatAnswer([q('Library'), q('Store', true)], [['Luxon'], ['Postgres', 'Redis']])
    ).toBe(`${PREFIX} Library: Luxon; Store: Postgres, Redis`)
  })

  it('carries free text through verbatim', () => {
    expect(formatAnswer([q('Library')], [['whatever you think is best']])).toBe(
      `${PREFIX} Library: whatever you think is best`
    )
  })

  it('skips a question with no selections', () => {
    expect(formatAnswer([q('Library'), q('Store')], [[], ['Postgres']])).toBe(
      `${PREFIX} Store: Postgres`
    )
  })

  it('says so when nothing at all was answered', () => {
    expect(formatAnswer([q('Library')], [[]])).toBe(`${PREFIX} The user selected nothing.`)
  })

  it('ignores answers beyond the questions asked', () => {
    expect(formatAnswer([q('Library')], [['Luxon'], ['ignored']])).toBe(`${PREFIX} Library: Luxon`)
  })

  it('collapses newlines in free text so the reason stays one line', () => {
    expect(formatAnswer([q('Notes')], [['first\nsecond']])).toBe(`${PREFIX} Notes: first second`)
  })
})
