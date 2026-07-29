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

/**
 * The complete `permissionDecisionReason` for an answered question set.
 *
 * The prefix is not decoration. A `PreToolUse` hook has no result channel, so
 * the answer can only reach the model as a *denial's* reason (see the spec);
 * without a sentence saying what actually happened the model reads a refusal
 * and asks again. Built here rather than in the adapter so the wording is
 * testable without a running Shell.
 *
 * `answers[i]` holds the labels selected for `questions[i]`, or a single entry
 * of typed free text. Newlines are collapsed because the reason travels as one
 * JSON string into a transcript that renders it as a line.
 */
export function formatAnswer(questions: Question[], answers: string[][]): string {
  const prefix = 'The user answered in Dasbo Island rather than the terminal — do not re-ask.'
  const parts: string[] = []
  for (let i = 0; i < questions.length; i++) {
    const picked = (answers[i] ?? []).map((a) => a.replace(/\s+/g, ' ').trim()).filter((a) => a.length > 0)
    if (picked.length === 0) continue
    parts.push(`${questions[i]?.header}: ${picked.join(', ')}`)
  }
  // Reachable only if every question was skipped. Saying so beats sending a
  // bare prefix, which reads as a truncated message.
  if (parts.length === 0) return `${prefix} The user selected nothing.`
  return `${prefix} ${parts.join('; ')}`
}
