import St from 'gi://St'
import Clutter from 'gi://Clutter'
import Pango from 'gi://Pango'
import { sameTasks } from '../core/tasks.js'
import type { AgentTask, TaskStatus } from '../core/tasks.js'

/**
 * One glyph per status. Text rather than icons: these sit at the head of a
 * text line, and an icon would need its own baseline alignment for no gain.
 */
const GLYPH: Record<TaskStatus, string> = {
  completed: '✓',
  in_progress: '▸',
  pending: '○',
}

/**
 * How strongly each status draws. A completed task is history and should
 * recede; the one in progress is the answer to "what is it doing"; pending
 * sits between them.
 *
 * Applied to the actor rather than through the stylesheet because St's CSS
 * engine does not reliably honour `opacity` — the finding recorded in
 * popupHeader.ts and reused on the row's activity label.
 */
const OPACITY: Record<TaskStatus, number> = {
  completed: 140,
  in_progress: 255,
  pending: 178,
}

/**
 * The agent's plan, one line per task.
 *
 * Not a GObject class, for the same reason PermissionControls and QuestionPanel
 * are not: it is a plain owner of St actors, attached to and detached from a
 * SessionRow's task box.
 *
 * No scroll view of its own. The popup as a whole scrolls (see island.ts), and a
 * second scroll view nested inside it would fight for the mouse wheel — the
 * pointer's position would decide which one moved, and a list at the bottom of
 * its travel would silently hand the wheel to its parent. A long plan competing
 * for popup height with the other sessions is the honest trade.
 */
export class TaskList {
  private box: St.BoxLayout
  private parent: St.BoxLayout | null = null
  private tasks: AgentTask[] = []

  constructor(tasks: AgentTask[]) {
    this.box = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'dasbo-tasks' })
    this.render(tasks)
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

  /** Collapsed hides the whole list; the row keeps its counter. */
  setExpanded(expanded: boolean): void {
    this.box.visible = expanded
  }

  /**
   * Redraw only when the drawing would differ. Every store emit reaches here,
   * and most of them are about something else entirely — a tool starting, a
   * permission resolving — so an unconditional rebuild would destroy and
   * recreate every line. That churns actors under the popup's own scroll
   * position, and can change the body's height, throwing a reader part-way down
   * a long plan somewhere else entirely.
   */
  update(tasks: AgentTask[]): void {
    if (sameTasks(this.tasks, tasks)) return
    this.render(tasks)
  }

  destroy(): void {
    this.detach()
    this.box.destroy()
  }

  private render(tasks: AgentTask[]): void {
    this.tasks = [...tasks]
    this.box.destroy_all_children()
    for (const t of tasks) this.box.add_child(this.line(t))
  }

  private line(task: AgentTask): St.BoxLayout {
    const row = new St.BoxLayout({ x_expand: true, style_class: 'dasbo-task' })
    const glyph = new St.Label({
      text: GLYPH[task.status],
      style_class: 'dasbo-task-glyph',
      // START, not CENTER: beside a subject wrapped over three lines a centred
      // glyph floats next to the middle one instead of the task it marks — the
      // same reasoning already recorded for _dot beside the activity text.
      y_align: Clutter.ActorAlign.START,
    })
    const subject = new St.Label({
      text: task.subject,
      style_class: 'dasbo-task-subject',
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    })
    // A task subject is what the agent is doing, so it is never cut. Wrapping
    // needs a bounded width to wrap against, which comes from the row's
    // .dasbo-fixed-width ancestor. ellipsize must be NONE explicitly: Pango
    // ignores line_wrap while an ellipsize mode is set. WORD_CHAR, not WORD:
    // subjects routinely carry file paths with no break opportunity in them.
    subject.clutter_text.line_wrap = true
    subject.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR
    subject.clutter_text.ellipsize = Pango.EllipsizeMode.NONE
    row.opacity = OPACITY[task.status]
    row.add_child(glyph)
    row.add_child(subject)
    return row
  }
}
