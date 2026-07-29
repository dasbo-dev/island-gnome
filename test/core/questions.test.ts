import { describe, it, expect } from 'vitest'
import { parseQuestions, type Question } from '../../src/core/questions.js'

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
