import St from 'gi://St'
import Clutter from 'gi://Clutter'
import Pango from 'gi://Pango'
import { formatAnswer, optionMarkup } from '../core/questions.js'
import type { Question } from '../core/questions.js'

export interface QuestionCallbacks {
  /** The complete reason string, already built by formatAnswer. */
  onAnswer: (text: string) => void
  /** Release the hold so the agent renders its own picker instead. */
  onHandOff: () => void
}

/**
 * The panel that answers an agent's question, one question at a time.
 *
 * Not a GObject class, for the same reason PermissionControls is not: it is a
 * plain owner of St actors so it can be attached to and detached from a
 * SessionRow's question box — its own full-width line beneath the row, because
 * an option is a wrapped sentence and beside the activity label the two would
 * starve each other.
 *
 * It owns the in-progress selections. They are not in the store: a half-made
 * choice is not something the agent reported, and routing every click through
 * the store would emit a subscriber notification, and so a full row rebuild,
 * under the user's cursor.
 */
export class QuestionPanel {
  private box: St.BoxLayout
  private parent: St.BoxLayout | null = null
  private questions: Question[]
  private cb: QuestionCallbacks
  /** One entry per question, filled as the user advances. */
  private answers: string[][]
  private index = 0
  /** Selections for the question on screen, kept apart from `answers` until it is committed. */
  private picked = new Set<string>()
  private entry: St.Entry | null = null
  private entryKeyId = 0
  private optionsBox: St.BoxLayout
  private prompt: St.Label
  private counter: St.Label
  private nav: St.BoxLayout
  private next: St.Button
  private done = false

  constructor(questions: Question[], cb: QuestionCallbacks) {
    this.questions = questions
    this.cb = cb
    this.answers = questions.map(() => [])

    this.box = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'dasbo-question' })

    const head = new St.BoxLayout({ x_expand: true, style_class: 'dasbo-question-head' })
    this.prompt = new St.Label({ text: '', style_class: 'dasbo-question-prompt', x_expand: true })
    // Same wrapping rules as the activity label: a question can be a full
    // sentence, the popup's width is fixed, and an ellipsize mode would make
    // Pango ignore line_wrap and silently yield one truncated line.
    this.prompt.clutter_text.line_wrap = true
    this.prompt.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR
    this.prompt.clutter_text.ellipsize = Pango.EllipsizeMode.NONE
    this.counter = new St.Label({
      text: '',
      style_class: 'dasbo-question-counter',
      y_align: Clutter.ActorAlign.START,
    })
    head.add_child(this.prompt)
    head.add_child(this.counter)

    this.optionsBox = new St.BoxLayout({ vertical: true, x_expand: true })

    this.nav = new St.BoxLayout({
      x_expand: true,
      x_align: Clutter.ActorAlign.END,
      style_class: 'dasbo-question-nav',
    })
    this.next = new St.Button({ label: 'Next', style_class: 'button dasbo-question-next',
      can_focus: true })
    this.next.connect('clicked', () => this.commit())
    const handOff = new St.Button({
      label: 'Answer in terminal',
      style_class: 'button dasbo-question-handoff',
      // This row is built can_focus: false, and St.Button does not set this
      // itself, so without it a keyboard-only user cannot reach the escape
      // hatch at all — the same fix as Jump and the header gear.
      can_focus: true,
    })
    handOff.connect('clicked', () => {
      if (this.done) return
      this.done = true
      this.closeEntry()
      this.cb.onHandOff()
    })
    this.nav.add_child(this.next)
    this.nav.add_child(handOff)

    this.box.add_child(head)
    this.box.add_child(this.optionsBox)
    this.box.add_child(this.nav)

    this.render()
  }

  attachTo(parent: St.BoxLayout): void {
    if (this.parent) return
    this.parent = parent
    parent.add_child(this.box)
  }

  detach(): void {
    if (!this.parent) return
    this.parent.remove_child(this.box)
    this.parent = null
  }

  /** Collapsed hides the whole panel; the row keeps its one-line summary. */
  setExpanded(expanded: boolean): void {
    this.box.visible = expanded
  }

  destroy(): void {
    this.closeEntry()
    this.detach()
    this.box.destroy()
  }

  /** Rebuild the option list for the question at `index`. */
  private render(): void {
    // Once the panel is resolved, the hold is gone and the server no longer
    // expects any more answers. The entry must not rebuild a picker.
    if (this.done) return
    const q = this.questions[this.index]
    if (!q) return
    this.closeEntry()
    this.picked.clear()
    this.prompt.text = q.question
    this.counter.text = this.questions.length > 1
      ? `${this.index + 1}/${this.questions.length}`
      : ''
    this.counter.visible = this.questions.length > 1
    // A single-select question commits on the click itself, so a Next button
    // beside it would be a second way to do the same thing — and, before any
    // click, a way to submit nothing.
    this.next.visible = q.multiSelect
    this.next.label = this.index === this.questions.length - 1 ? 'Submit' : 'Next'

    this.optionsBox.destroy_all_children()
    for (const opt of q.options) {
      this.optionsBox.add_child(this.optionButton(q, opt.label, opt.description))
    }
    this.optionsBox.add_child(this.otherButton())
  }

  private optionButton(q: Question, label: string, description: string): St.Button {
    const text = new St.Label({ x_expand: true })
    // One label, not a bold one beside a dim one: the popup's width is fixed at
    // 30em, and a description wrapped inside its own right-hand column would
    // break every two or three words. The bold and the dimming come from Pango
    // markup instead — see optionMarkup, which also escapes both halves.
    text.clutter_text.set_markup(optionMarkup(label, description))
    // The same wrapping triple the question prompt and the row's activity label
    // carry. ellipsize must be NONE explicitly: Pango ignores line_wrap while an
    // ellipsize mode is set, which would silently yield one truncated line.
    // WORD_CHAR, not WORD: a description can hold a path or a flag with no break
    // opportunity in it, which under WORD would overhang the fixed width.
    text.clutter_text.line_wrap = true
    text.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR
    text.clutter_text.ellipsize = Pango.EllipsizeMode.NONE

    const button = new St.Button({ style_class: 'dasbo-question-option', can_focus: true,
      x_expand: true, child: text })
    button.connect('clicked', () => {
      if (this.done) return
      if (q.multiSelect) {
        if (this.picked.has(label)) {
          this.picked.delete(label)
          button.remove_style_pseudo_class('checked')
        } else {
          this.picked.add(label)
          button.add_style_pseudo_class('checked')
        }
        return
      }
      this.picked.clear()
      this.picked.add(label)
      this.commit()
    })
    return button
  }

  private otherButton(): St.Button {
    const button = new St.Button({
      label: 'Other…',
      style_class: 'dasbo-question-option dasbo-question-other',
      can_focus: true,
      x_expand: true,
    })
    button.connect('clicked', () => {
      if (this.done) return
      this.openEntry(button)
    })
    return button
  }

  /** Swap the Other… button for a live entry, in place. */
  private openEntry(after: St.Button): void {
    if (this.entry) return
    const entry = new St.Entry({ style_class: 'dasbo-question-entry', x_expand: true,
      can_focus: true, hint_text: 'Type an answer' })
    this.entry = entry
    this.optionsBox.replace_child(after, entry)
    after.destroy()

    // A panel popup does not hand key focus to an entry on its own, so the
    // caret never appears and every keystroke goes to the menu instead.
    // global.stage is typed as the generic Clutter.Actor by @girs, which
    // lacks set_key_focus; get_stage() returns the same singleton correctly
    // typed as Clutter.Stage.
    global.get_stage().set_key_focus(entry.clutter_text)

    entry.clutter_text.connect('activate', () => {
      const text = entry.get_text().trim()
      if (text.length === 0) return
      this.picked.clear()
      this.picked.add(text)
      this.commit()
    })

    this.entryKeyId = entry.clutter_text.connect('key-press-event',
      (_actor: Clutter.Actor, event: Clutter.Event) => {
      if (event.get_key_symbol() !== Clutter.KEY_Escape) return Clutter.EVENT_PROPAGATE
      // Consumed, or GNOME's menu grab takes it and closes the whole popup —
      // discarding a question the user was part-way through answering.
      this.closeEntry()
      this.render()
      return Clutter.EVENT_STOP
    })
  }

  private closeEntry(): void {
    if (!this.entry) return
    if (this.entryKeyId) {
      this.entry.clutter_text.disconnect(this.entryKeyId)
      this.entryKeyId = 0
    }
    this.entry = null
  }

  /** Record the current question's answer and advance, or submit. */
  private commit(): void {
    if (this.done) return
    this.answers[this.index] = [...this.picked]
    if (this.index < this.questions.length - 1) {
      this.index += 1
      this.render()
      return
    }
    this.done = true
    this.closeEntry()
    this.cb.onAnswer(formatAnswer(this.questions, this.answers))
  }
}
