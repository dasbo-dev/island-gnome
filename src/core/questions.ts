import { isRecord, str } from './adapters/shared.js'

/** One selectable answer. `preview` is deliberately dropped — see the spec's Out of scope. */
export interface QuestionOption {
  label: string
  /** May be empty: Claude's schema requires it, but a payload that omits it is still answerable. */
  description: string
}

export interface Question {
  question: string
  /** Claude bounds this at 12 characters, so the row can show it without truncating. */
  header: string
  options: QuestionOption[]
  multiSelect: boolean
}

/** Claude's own schema bounds, mirrored so an unexpected payload is rejected rather than rendered. */
const MAX_QUESTIONS = 4
const MIN_OPTIONS = 2
const MAX_OPTIONS = 4

/**
 * Claude's `AskUserQuestion` tool_input, validated into something the popup can
 * render. Returns null for anything that does not match, and null means "not a
 * question, gate it as an ordinary tool" — so a payload shape that changes
 * under us degrades to today's Allow/Deny behaviour rather than to a panel
 * built from undefined.
 */
export function parseQuestions(toolInput: unknown): Question[] | null {
  if (!isRecord(toolInput)) return null
  const raw = toolInput['questions']
  if (!Array.isArray(raw)) return null
  if (raw.length === 0 || raw.length > MAX_QUESTIONS) return null

  const out: Question[] = []
  for (const item of raw) {
    if (!isRecord(item)) return null
    const question = str(item['question'])
    const header = str(item['header'])
    if (!question || !header) return null

    const rawOptions = item['options']
    if (!Array.isArray(rawOptions)) return null
    if (rawOptions.length < MIN_OPTIONS || rawOptions.length > MAX_OPTIONS) return null

    const options: QuestionOption[] = []
    for (const o of rawOptions) {
      if (!isRecord(o)) return null
      const label = str(o['label'])
      if (!label) return null
      options.push({ label, description: str(o['description']) ?? '' })
    }

    out.push({ question, header, options, multiSelect: item['multiSelect'] === true })
  }
  return out
}
