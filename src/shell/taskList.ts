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
 * The agent's plan, one line per task, inside its own scroll view.
 *
 * Not a GObject class, for the same reason PermissionControls and QuestionPanel
 * are not: it is a plain owner of St actors, attached to and detached from a
 * SessionRow's task box.
 *
 * The scroll view is not optional. A plain `PopupMenu` is not scrollable in
 * GNOME Shell 46 — only `PopupSubMenu.actor` is an `St.ScrollView` — so a
 * forty-task list rendered into the menu directly grows the popup past the
 * monitor and is clipped rather than scrolled.
 */
export class TaskList {
  private scroll: St.ScrollView
  private box: St.BoxLayout
  private parent: St.BoxLayout | null = null
  private tasks: AgentTask[] = []

  constructor(tasks: AgentTask[]) {
    this.box = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'dasbo-tasks' })
    this.scroll = new St.ScrollView({
      style_class: 'dasbo-tasks-scroll',
      x_expand: true,
      // NEVER horizontally: every line ellipsizes, so there is nothing to
      // scroll to sideways, and a horizontal bar would only steal height.
      hscrollbar_policy: St.PolicyType.NEVER,
      vscrollbar_policy: St.PolicyType.AUTOMATIC,
    })
    this.scroll.set_child(this.box)
    this.render(tasks)
  }

  attachTo(parent: St.BoxLayout): void {
    if (this.parent) return
    this.parent = parent
    parent.add_child(this.scroll)
  }

  detach(): void {
    if (!this.parent) return
    this.parent.remove_child(this.scroll)
    this.parent = null
  }

  /** Collapsed hides the whole list; the row keeps its counter. */
  setExpanded(expanded: boolean): void {
    this.scroll.visible = expanded
  }

  /**
   * Redraw only when the drawing would differ. Every store emit reaches here,
   * and most of them are about something else entirely — a tool starting, a
   * permission resolving — so an unconditional rebuild would destroy and
   * recreate every line, throwing the reader's scroll position back to the top
   * while they were part-way down it.
   */
  update(tasks: AgentTask[]): void {
    if (sameTasks(this.tasks, tasks)) return
    this.render(tasks)
  }

  destroy(): void {
    this.detach()
    this.scroll.destroy()
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
      y_align: Clutter.ActorAlign.CENTER,
    })
    const subject = new St.Label({
      text: task.subject,
      style_class: 'dasbo-task-subject',
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    })
    // One line per task, ellipsized rather than wrapped, so the height of the
    // list is a function of the task count alone — which is what makes the
    // scroll view's max-height a predictable number of visible entries.
    subject.clutter_text.ellipsize = Pango.EllipsizeMode.END
    row.opacity = OPACITY[task.status]
    row.add_child(glyph)
    row.add_child(subject)
    return row
  }
}
