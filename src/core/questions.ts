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

/**
 * The three characters Pango's markup parser acts on outside attribute values.
 *
 * Hand-rolled rather than `GLib.markup_escape_text` because `src/core` is pure
 * (see test/core/purity.test.ts), and because escaping this way is covered by
 * tests. The ampersand is replaced first, or the entities introduced for `<` and
 * `>` would themselves be escaped.
 */
export function escapeMarkup(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * One option as a single line of Pango markup: the label bold, the description
 * dimmed behind an em dash.
 *
 * One label rather than a bold one beside a dim one, because the popup's width is
 * fixed at 26em and a description wrapped inside its own right-hand column would
 * break every two or three words.
 *
 * `alpha` is a Pango span attribute rather than a hex colour, so the dimming
 * survives a light theme. It replaces the actor-level `opacity = 178` the old
 * description label carried, which cannot be reused now that one label holds both
 * halves — dimming the actor would dim the bold label with it. A Pango that
 * ignores `alpha` renders the description at full strength, which costs
 * hierarchy, not information.
 *
 * Both halves come from an agent's `AskUserQuestion` payload, so both are
 * escaped: a description containing `<b>` would otherwise be swallowed as markup
 * or make `set_markup` throw.
 */
export function optionMarkup(label: string, description: string): string {
  const bold = `<b>${escapeMarkup(label)}</b>`
  if (description.length === 0) return bold
  return `${bold} — <span alpha="70%">${escapeMarkup(description)}</span>`
}
