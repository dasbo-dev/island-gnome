import St from 'gi://St'
import Clutter from 'gi://Clutter'
import Pango from 'gi://Pango'
import GObject from 'gi://GObject'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'
import { formatElapsed } from '../core/format.js'
import { activityText } from '../core/activity.js'
import { summarize } from '../core/tasks.js'
import { AgentChip } from './agentChip.js'
import type { Session, SessionState } from '../core/types.js'

const STATE_CLASS: Record<SessionState, string> = {
  idle: '',
  running: 'state-running',
  waiting: 'state-waiting',
  error: 'state-error',
  done: 'state-done',
}

export interface SessionRowCallbacks {
  onJump: (session: Session) => void
  /**
   * Fired by the expander arrow. The Island owns both the question panel and
   * the task list this shows and hides — one arrow, both regions, because a row
   * with two independent folds is two controls competing for the same corner.
   */
  onToggleExpanded: (expanded: boolean) => void
}

export const SessionRow = GObject.registerClass(
  class SessionRow extends PopupMenu.PopupBaseMenuItem {
    private _session!: Session
    private _cb!: SessionRowCallbacks
    private _dot!: St.Widget
    private _project!: St.Label
    private _shellTotal!: St.Label
    private _activity!: St.Label
    private _elapsed!: St.Label
    private _taskCount!: St.Label
    private _taskBox!: St.BoxLayout
    private _hasQuestion = false
    private _hasTasks = false
    private _jump!: St.Button
    private _actionBox!: St.BoxLayout
    private _permissionBox!: St.BoxLayout
    private _expander!: St.Button
    private _chip!: InstanceType<typeof AgentChip>
    // Collapsed is the resting state: a plan is reference material, not a
    // demand, and a row that opened itself for one would push every other
    // session down the popup. setHasQuestion(true) overrides this, because a
    // question *is* a demand.
    private _expanded = false
    private _questionBox!: St.BoxLayout
    /**
     * The deadline showTransient()'s caller passed, in ms since the epoch. 0
     * means no transient is showing. `_syncActivity` checks this before
     * touching the label at all, so a tick landing mid-transient does not
     * recompute over it — see the two methods below for why that guard has
     * to exist.
     */
    private _transientUntil = 0

    constructor(session: Session, cb: SessionRowCallbacks, now: number, iconBase: string, chipMode: string) {
      super({ reactive: false, can_focus: false, style_class: 'dasbo-row' })
      this._session = session
      this._cb = cb

      const outer = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        style_class: 'dasbo-row-outer dasbo-fixed-width',
      })
      const topRow = new St.BoxLayout({ x_expand: true, style_class: 'dasbo-row-top' })

      const textCol = new St.BoxLayout({ vertical: true, x_expand: true })
      // The project name and the shell's uptime share a line. x_expand and the
      // START alignment sit on the *total*, not the name: that makes the total
      // absorb the row's slack while still drawing hard against the name, so
      // the two read as one phrase instead of the total drifting to the right
      // margin. The ellipsize stays on the name alone, so a long project
      // shrinks and the total is never the thing that gets clipped.
      const titleRow = new St.BoxLayout({ style_class: 'dasbo-row-title', x_expand: true })
      this._project = new St.Label({
        text: session.project,
        style_class: 'dasbo-row-project',
        y_align: Clutter.ActorAlign.CENTER,
      })
      this._shellTotal = new St.Label({
        text: '',
        style_class: 'dasbo-row-shell-total',
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.CENTER,
        // Starts hidden, matching its empty text. Actors default to visible,
        // and update() (called at the end of this constructor) is no longer
        // the thing that turns this on — only tick() is, once it has written
        // a real number here — so without this the very first render of a
        // qualifying row would show the gap with nothing in it, before the
        // popup's first tick ever runs.
        visible: false,
      })
      // St's CSS engine does not honour `opacity` — the same finding that made
      // the empty row set it on the actor. 140 (~0.55) rather than the 178 used
      // for the activity line: the shell's uptime is the least important number
      // in the row and should sit below it, not level with it.
      this._shellTotal.opacity = 140
      // St's `width` sets an actor's minimum as well as its natural width, so
      // the row's fixed width bounds the menu but cannot clamp a child whose
      // own minimum exceeds it — the content spills past the popup's
      // background instead. _activity's minimum collapses because it wraps;
      // this label needs the ellipsis to become shrinkable at all. The project
      // name is basename(cwd), a string the user controls.
      this._project.clutter_text.ellipsize = Pango.EllipsizeMode.END

      // x_expand on both so the label is allocated the row's full remaining
      // width: wrapping needs a bounded width to wrap against, and that bound
      // comes from .dasbo-row-outer's fixed width in the stylesheet.
      const activityRow = new St.BoxLayout({ style_class: 'dasbo-pill', x_expand: true })
      // START, not CENTER: over three wrapped lines a centred dot floats beside
      // the middle line instead of beside the status it belongs to. START alone
      // is not enough, though — it aligns the dot to the top of the whole
      // label, about a line's ascent above the first line's ink — so it is paired
      // with a margin-top on .dasbo-dot that drops it onto that first line.
      // Neither half means anything without the other; test/shell/dotAlignment
      // fails if one is removed.
      this._dot = new St.Widget({ style_class: 'dasbo-dot', y_align: Clutter.ActorAlign.START })
      this._activity = new St.Label({ text: '', style_class: 'dasbo-row-activity',
        x_expand: true })
      // WORD_CHAR, not WORD: a long path, URL or flag string has no word
      // boundary to break at, and WORD alone lets such a token overhang the
      // fixed width — reintroducing the jumping this exists to remove.
      // ellipsize must be NONE explicitly: Pango ignores line_wrap while an
      // ellipsize mode is set, which would silently yield one truncated line.
      this._activity.clutter_text.line_wrap = true
      this._activity.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR
      this._activity.clutter_text.ellipsize = Pango.EllipsizeMode.NONE
      activityRow.add_child(this._dot)
      activityRow.add_child(this._activity)

      // Leads the title row so its arrow lines up down the popup's left edge
      // rather than floating after a project name of unpredictable width.
      this._expander = new St.Button({
        label: '▸',
        style_class: 'dasbo-expander',
        y_align: Clutter.ActorAlign.CENTER,
        // Its only text is a geometric shape, and it is in the tab order — a
        // screen reader announces the character or nothing at all.
        accessible_name: 'Show details',
        // The row is can_focus: false, so without this the only way to fold a
        // question away is the mouse — see Jump and the header gear.
        can_focus: true,
        visible: false,
      })
      this._expander.connect('clicked', () => {
        this._expanded = !this._expanded
        this._expander.label = this._expanded ? '▾' : '▸'
        this._expander.accessible_name = this._expanded ? 'Hide details' : 'Show details'
        this._syncTaskBoxVisible()
        this._cb.onToggleExpanded(this._expanded)
      })
      // Held on a field, unlike the row's other one-shot children: the display
      // mode is a setting, and Island pushes a change into every live row
      // rather than rebuilding them. The chip's *agent* still cannot change —
      // sessionKey is `${agent}:${sessionId}` — so there is still no update().
      this._chip = new AgentChip(session.agent, iconBase, chipMode)
      titleRow.add_child(this._expander)
      titleRow.add_child(this._chip)
      titleRow.add_child(this._project)
      titleRow.add_child(this._shellTotal)
      textCol.add_child(titleRow)
      textCol.add_child(activityRow)

      this._elapsed = new St.Label({ text: '0s', style_class: 'dasbo-row-elapsed',
        y_align: Clutter.ActorAlign.CENTER })

      // Its own label rather than text appended to _elapsed: the clock is
      // rewritten every tick while this changes only when the store emits, and
      // merging them would reformat an unchanged number once a second — the
      // waste the _shellTotal comment records. tnum in the stylesheet keeps
      // 9/10 and 10/10 the same width, so the row does not twitch.
      this._taskCount = new St.Label({
        text: '',
        style_class: 'dasbo-row-taskcount',
        y_align: Clutter.ActorAlign.CENTER,
        visible: false,
      })
      this._taskCount.opacity = 178

      this._jump = new St.Button({ label: 'Jump', style_class: 'button dasbo-jump',
        y_align: Clutter.ActorAlign.CENTER,
        // "Jump" is not a GNOME verb and does not say where to. The label is
        // kept because the row's right-hand cluster is unshrinkable and
        // "Open" is no clearer; the name carries the meaning instead.
        accessible_name: 'Focus this session’s terminal window',
        // St.Button doesn't set this in its own init, and this row is
        // deliberately can_focus: false, so without it Jump is unreachable
        // by keyboard — see PopupHeader's gear for the same fix.
        can_focus: true })
      this._jump.connect('clicked', () => this._cb.onJump(this._session))

      this._actionBox = new St.BoxLayout({ style_class: 'dasbo-row-actions' })
      this._actionBox.add_child(this._elapsed)
      this._actionBox.add_child(this._taskCount)
      this._actionBox.add_child(this._jump)

      topRow.add_child(textCol)
      topRow.add_child(this._actionBox)

      // Attached here (not to _actionBox) because the cluster is
      // unshrinkable — button labels neither wrap nor ellipsize — so beside
      // elapsed + Jump it would leave almost no width for the activity text,
      // which can run to 190 characters. A full-width line beneath the top
      // row gives it room without shrinking anything else.
      this._permissionBox = new St.BoxLayout({
        x_expand: true,
        x_align: Clutter.ActorAlign.END,
        style_class: 'dasbo-row-perm',
      })
      // ClutterBoxLayout only spaces between *visible* children, so an
      // always-visible empty box would cost every row the vertical gap. The
      // signals keep this local: neither PermissionControls nor the Island has
      // to know the row hides it.
      this._permissionBox.visible = false
      this._permissionBox.connect('child-added', () => {
        this._permissionBox.visible = true
      })
      this._permissionBox.connect('child-removed', () => {
        this._permissionBox.visible = this._permissionBox.get_n_children() > 0
      })

      // Its own line, but not for the same reason the permission cluster has
      // one: an option is a wrapped paragraph, and beside the activity label
      // the two would starve each other for width (see questionPanel.ts's
      // class comment). Same visibility handling too — ClutterBoxLayout
      // spaces only between visible children, so an always-present empty box
      // would cost every row a gap.
      this._questionBox = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        style_class: 'dasbo-row-question',
      })
      this._questionBox.visible = false
      this._questionBox.connect('child-added', () => {
        this._questionBox.visible = true
      })
      this._questionBox.connect('child-removed', () => {
        this._questionBox.visible = this._questionBox.get_n_children() > 0
      })

      // Same visibility handling as the two boxes above, for the same reason:
      // ClutterBoxLayout spaces only between visible children, so an
      // always-present empty box would cost every row a gap it never uses.
      //
      // But the child-count rule alone is not enough for this box specifically:
      // unlike the permission and question boxes, this one holds a TaskList
      // whose own fold (setExpanded) hides its own St.BoxLayout while leaving
      // it parented here — so a *collapsed* list, which is the default, still
      // counts as a child and would keep this box visible, costing the row a
      // 6px .dasbo-row-outer gap above nothing. _syncTaskBoxVisible folds the
      // expanded state into the same visible flag so a non-empty box is only
      // ever shown while the row is open.
      this._taskBox = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        style_class: 'dasbo-row-tasks',
      })
      this._taskBox.visible = false
      this._taskBox.connect('child-added', () => {
        this._syncTaskBoxVisible()
      })
      this._taskBox.connect('child-removed', () => {
        this._syncTaskBoxVisible()
      })

      outer.add_child(topRow)
      outer.add_child(this._permissionBox)
      outer.add_child(this._questionBox)
      outer.add_child(this._taskBox)
      this.add_child(outer)

      this.update(session, now)
    }

    setChipMode(mode: string): void {
      this._chip.setMode(mode)
    }

    /** Where the Island attaches the Allow / Deny / Always controls. */
    get permissionBox(): St.BoxLayout {
      return this._permissionBox
    }

    /** Where the Island attaches the QuestionPanel. */
    get questionBox(): St.BoxLayout {
      return this._questionBox
    }

    /** Where the Island attaches the TaskList. */
    get taskBox(): St.BoxLayout {
      return this._taskBox
    }

    /** So the Island can bring a freshly attached panel into line with the fold. */
    get expanded(): boolean {
      return this._expanded
    }

    /**
     * Show or hide the expander arrow for a question, and always open the row.
     * A question arrives already open (the popup opens itself for it), and a
     * row that kept a fold left over from browsing a task list would hide the
     * answer behind an arrow the user never chose to close.
     */
    setHasQuestion(has: boolean): void {
      this._hasQuestion = has
      if (has) {
        this._expanded = true
        this._expander.label = '▾'
      } else if (!this._hasTasks) {
        // Restore the collapsed default only when there is no task list left
        // to fold: if there is, the row's fold is the user's own choice (they
        // opened it to read the plan, or closed it on purpose) and a question
        // resolving must not overwrite that. Without this guard, a question
        // that resolves on a row with no tasks leaves _expanded stuck at true
        // with no arrow to undo it — until a later plan reveals an arrow that
        // already reads open and shoves the rest of the popup down on its own.
        this._expanded = false
        this._expander.label = '▸'
      }
      this._syncTaskBoxVisible()
      this._syncExpander()
    }

    /**
     * Show or hide the expander arrow for a task list. Unlike a question this
     * never forces the row open: a plan appearing mid-session must not shove
     * the rest of the popup down under the user's cursor.
     */
    setHasTasks(has: boolean): void {
      this._hasTasks = has
      this._syncTaskBoxVisible()
      this._syncExpander()
    }

    private _syncExpander(): void {
      this._expander.visible = this._hasQuestion || this._hasTasks
    }

    /**
     * _taskBox's own child-added/child-removed handlers only know whether it
     * has a child, not whether the row is folded — and a TaskList that is
     * attached but collapsed (the default) is a non-empty box with nothing
     * visible inside it. Left keyed on child count alone, that box would stay
     * visible and cost the row .dasbo-row-outer's 6px inter-child spacing for
     * a gap above zero height, on every row with a plan, in the common
     * (collapsed) case. Folding _expanded into the same flag makes a
     * non-empty box visible only while the row is open.
     */
    private _syncTaskBoxVisible(): void {
      this._taskBox.visible = this._taskBox.get_n_children() > 0 && this._expanded
    }

    get session(): Session {
      return this._session
    }

    /**
     * Write the activity line for a given moment.
     *
     * Called from both update() and tick(), because both can be the first to
     * learn the text has changed: update() runs on a store emit, tick() runs
     * once a second and is the only thing that ever notices a notice has
     * expired — the store schedules no timer for that, it is just two numbers
     * compared here.
     *
     * Returns before touching the label at all while a transient is showing.
     * tick() now calls this every second, and showTransient()'s "no window"
     * has no representation in Session for activityText to recompute — a tick
     * landing before its own GLib timer fires would otherwise overwrite it
     * with whatever the session actually says, turning a message meant to
     * last two seconds into one that lasts until the next arbitrary tick.
     * showJumpFailure's timer calls clearTransient() before it calls
     * update(), so it is still what restores the real text afterward; this
     * guard only keeps this method from racing it in the meantime — including
     * the case where the GLib timer itself fires early (`g_timeout_add_seconds`
     * rounds to a perturbed second boundary and can land before its nominal
     * delay), which would otherwise hit this guard and no-op, leaving "no
     * window" on the row until whatever tick comes next.
     *
     * Once past that guard, the text write is checked against the current
     * value and the opacity write is not: assigning a ClutterText's contents
     * relayouts the row, and this now runs every second, so the difference
     * check earns its keep; assigning an actor's opacity is a cheap property
     * set that costs nothing to repeat.
     */
    private _syncActivity(now: number): void {
      if (now < this._transientUntil) return
      const { text, hint } = activityText(this._session, now)
      if (text !== this._activity.text) this._activity.text = text
      // St's CSS engine does not reliably honour `opacity` — the same finding
      // that made PopupHeader's empty label set it on the actor — so the
      // .dasbo-row-activity rule cannot carry this.
      this._activity.opacity = hint ? 178 : 255
    }

    update(session: Session, now: number): void {
      this._session = session
      this._project.text = session.project
      this._dot.style_class = `dasbo-dot ${STATE_CLASS[session.state]}`.trim()

      // On a first conversation the number is always #1 and the shell's uptime
      // is the conversation's own age, so both are noise, and a session that
      // stops qualifying (conversationIndex back to 1, or no processStartedAt)
      // must lose the label at once rather than lingering with a stale
      // number. But update() never knows the current time, so it cannot write
      // a fresh number itself — only hide. Showing the label is tick()'s job
      // alone: text and visibility are set together there, so the label can
      // never be visible while empty. Hidden rather than blanked: ClutterBox-
      // Layout only spaces between visible children, so an empty label would
      // still cost the row its gap.
      if (session.conversationIndex <= 1 || session.processStartedAt === undefined) {
        this._shellTotal.visible = false
      }

      this._syncActivity(now)

      // Derived here rather than pushed in by the Island, so the row stays a
      // pure function of its Session — update(s) is already called on every
      // rebuild, and nothing else has to remember to keep the counter honest.
      const tasks = session.tasks ?? []
      if (tasks.length > 0) {
        const { completed, total } = summarize(tasks)
        this._taskCount.text = `${completed}/${total}`
        this._taskCount.visible = true
      } else {
        this._taskCount.visible = false
      }
      // The arrow follows the tasks, but the counter does not follow the fold:
      // a collapsed row showing 3/10 is the whole point of the collapsed state.
      this.setHasTasks(tasks.length > 0)
    }

    /** Called once per second by the Island while the popup is open. */
    tick(now: number): void {
      // The only thing that ever retires an expired notice. Nothing else runs
      // on a clock, and the store deliberately schedules no timer for it.
      this._syncActivity(now)
      const elapsed = formatElapsed(now - this._session.startedAt)
      // The number rides on the clock rather than getting a label of its own:
      // one string means tnum covers both halves, and the pair reads as "third
      // conversation, eight minutes in".
      this._elapsed.text = this._session.conversationIndex > 1
        ? `#${this._session.conversationIndex} ${elapsed}`
        : elapsed
      const processStartedAt = this._session.processStartedAt
      // One condition decides both halves, and it is the same condition on
      // both branches, so the label can never be visible with empty or stale
      // text: the write and the reveal happen together, in that order, and
      // every path that does not write also hides. This is the only place
      // that knows both the current time and what the text will say, so it is
      // the only place that can turn the label on at all.
      //
      // The text write used to be guarded on processStartedAt alone, which is
      // true of nearly every row — so the common case, a first conversation
      // that never shows this label, reformatted and reassigned a string
      // nobody could see once a second. The else branch keeps the other half
      // of the old behaviour: a row that stops qualifying is hidden right
      // here, on the next tick, rather than waiting for update() to notice.
      if (processStartedAt !== undefined && this._session.conversationIndex > 1) {
        this._shellTotal.text = formatElapsed(now - processStartedAt)
        this._shellTotal.visible = true
      } else {
        this._shellTotal.visible = false
      }
    }

    /**
     * Write text straight onto the label, bypassing activityText entirely,
     * and hold it there until `until` (ms since the epoch). The caller owns
     * restoring the real text afterward — see Island.showJumpFailure's GLib
     * timer — this only stops _syncActivity from undoing the write early.
     */
    showTransient(text: string, until: number): void {
      this._transientUntil = until
      this._activity.opacity = 255
      this._activity.text = text
    }

    /**
     * End a transient early, before its own deadline. showJumpFailure's timer
     * calls this immediately before update(), so _syncActivity's guard above
     * cannot no-op the very update meant to end the transient — which it
     * otherwise would whenever the GLib timer fires early (see the guard's
     * comment), since `now < this._transientUntil` would still hold.
     */
    clearTransient(): void {
      this._transientUntil = 0
    }
  }
)
