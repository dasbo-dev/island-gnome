import St from 'gi://St'
import Clutter from 'gi://Clutter'
import GObject from 'gi://GObject'
import GLib from 'gi://GLib'
import Pango from 'gi://Pango'
import type Gio from 'gi://Gio'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'
// PopupAnimation is a bit field (NONE 0, SLIDE 1, FADE 2, FULL ~0) and the
// boxpointer masks it, so the `true` these calls used to pass was SLIDE and
// only SLIDE. Naming SLIDE explicitly keeps the animation exactly what it has
// always been; it is not an endorsement of SLIDE over FULL, which is a
// separate question with a separate answer.
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js'
import type { SessionStore } from '../core/store.js'
import type { Session, SessionState } from '../core/types.js'
import { islandLabel } from '../core/islandLabel.js'
import { SessionRow } from './sessionRow.js'
import { PermissionControls } from './permissionRow.js'
import { QuestionPanel } from './questionPanel.js'
import { TaskList } from './taskList.js'
import { taskDir, readTasks } from './taskReader.js'
import { PopupHeader, EmptyRow } from './popupHeader.js'
import { GridIcon } from './gridIcon.js'
import { pillState } from '../core/pillState.js'
import { newlyDone, snapshotStates } from '../core/sound.js'
import { noticeVisible } from '../core/activity.js'
import { bodyMaxHeight, scrollIntoView } from '../core/popupSize.js'
import type { SoundPlayer } from './soundPlayer.js'

/**
 * `PanelMenu.Button#menu` is typed as `PopupMenu | PopupDummyMenu` because a
 * caller can pass `dontCreateMenu`. We never do, so this is always a real
 * `PopupMenu` — and its `SignalMap` (from @girs) doesn't declare
 * `open-state-changed`, so we widen it locally rather than reaching for `any`.
 */
type MenuWithOpenSignal = PopupMenu.PopupMenu & {
  connect(sigName: 'open-state-changed', callback: (menu: unknown, open: boolean) => void): number
}

export const Island = GObject.registerClass(
  class Island extends PanelMenu.Button {
    private _store!: SessionStore
    private _settings!: Gio.Settings
    private _iconBase!: string
    private _sound!: SoundPlayer
    private _icon!: InstanceType<typeof GridIcon>
    private _label!: St.Label
    private _unsubscribe: (() => void) | null = null
    private _rows = new Map<string, InstanceType<typeof SessionRow>>()
    /**
     * Session states as of the last refresh, so a move into 'done' can be
     * spotted. Only this diff reads it; the rows rebuild from the store.
     */
    private _lastStates = new Map<string, SessionState>()
    private _header!: InstanceType<typeof PopupHeader>
    private _separator!: PopupMenu.PopupSeparatorMenuItem
    private _body!: PopupMenu.PopupMenuSection
    private _scroll!: St.ScrollView
    /** Stage focus watch, live only while the popup is open. */
    private _keyFocusId = 0
    private _emptyRow: InstanceType<typeof EmptyRow> | null = null
    private _timerId = 0
    private _settingsChangedIds: number[] = []
    /** Last read of `agent-chip-display`, handed to every row that is built. */
    private _chipMode = 'logo-name'
    private _fullscreenId = 0
    private _menuStateId = 0
    private _onJump: (s: Session) => void = () => {}
    private _onPrefs: () => void = () => {}
    private _hooksProbe: (() => boolean) | null = null
    private _controls = new Map<string, { id: string; controls: PermissionControls }>()
    private _questions = new Map<string, { id: string; panel: QuestionPanel }>()
    private _taskLists = new Map<string, { list: TaskList }>()
    /**
     * Session keys whose task directory may have moved since it was last read.
     * The Island owns this rather than the service, because it is the only
     * thing that knows whether the popup is open — and a read whose result
     * nobody can see is pure waste.
     */
    private _dirtyTasks = new Set<string>()
    /** Keys with a read in flight, so a burst of TaskUpdates cannot stack reads. */
    private _readingTasks = new Set<string>()
    private _transientIds = new Set<number>()
    /** GLib source that closes a popup this widget opened for a notice. */
    private _noticeCloseId = 0
    /**
     * True once a notice has opened the popup, until something closes it or
     * decides it must not. This is not an instant-by-instant "a close timer
     * is armed right now" flag — changing notification-seconds to 0 between
     * two notices with no intervening close leaves it true with no timer
     * ever armed for the second one — but the property that actually matters
     * holds regardless: it is set only in the branch of notifyNotification
     * that itself opened the popup for a notice — the popup already being
     * open is one of the cases where it is never set at all, not one that
     * clears it — and every path that could make closing wrong afterward (the
     * user closing it, a permission or question arriving) clears it before
     * anything could act on stale information. See notifyNotification.
     */
    private _noticeOpened = false
    private _permHandlers: {
      resolve: (id: string, kind: 'allow' | 'deny') => void
      grantAllowAlways: (sessionKey: string, tool: string, id: string) => void
    } | null = null
    private _questionHandlers: {
      answer: (id: string, text: string) => void
      handOff: (id: string) => void
    } | null = null

    constructor(store: SessionStore, settings: Gio.Settings, iconBase: string, sound: SoundPlayer) {
      super(0.5, 'Dasbo Island')
      this._store = store
      this._settings = settings
      // Guarded the same way soundPlayer.ts guards 'notification-sounds':
      // Gio.Settings.get_string on a key absent from the *compiled* schema is
      // a g_error, which aborts the whole shell process. 'agent-chip-display'
      // is new in this release, read here at enable() time, and a stale
      // gschemas.compiled from a hand-copied upgrade would abort the session
      // at login rather than merely leave the chip on its default. Silence
      // (falling back to the key's own default) is a survivable degradation;
      // aborting the compositor is not.
      this._chipMode = settings.settings_schema.has_key('agent-chip-display')
        ? settings.get_string('agent-chip-display')
        : 'logo-name'
      // Owned by extension.ts, which also destroys it. Passed in for the same
      // reason iconBase is: a widget that reaches for its own dependencies is
      // a widget that reaches for the wrong one after a reload.
      this._sound = sound
      // The extension's own directory, where the agent chips' SVGs live. Passed
      // in rather than looked up here: a module that resolves its own install
      // path is a module that silently resolves the wrong one after a reload.
      this._iconBase = iconBase

      const box = new St.BoxLayout({ style_class: 'dasbo-pill' })
      this._icon = new GridIcon()
      this._label = new St.Label({
        text: '',
        style_class: 'dasbo-pill-label',
        y_align: Clutter.ActorAlign.CENTER,
      })
      // The label's width is pinned in the stylesheet so the island cannot resize
      // the top bar. St's CSS engine has no `text-overflow`, so the ellipsis has
      // to be set on the ClutterText — the same lesson as the opacity note in
      // popupHeader.ts. Without it, overlong content is clipped mid-glyph.
      this._label.clutter_text.ellipsize = Pango.EllipsizeMode.END
      box.add_child(this._icon)
      box.add_child(this._label)
      this.add_child(box)

      this._header = new PopupHeader(this._iconBase, {
        onPrefs: () => {
          // Close first: the preferences window takes focus, and a popup left
          // open behind it lingers until the next click somewhere else.
          this.menu.close(BoxPointer.PopupAnimation.SLIDE)
          try {
            this._onPrefs()
          } catch (e) {
            // This only guards a synchronous throw (e.g. from the UUID lookup
            // in Extension.openPreferences()). The actual prefs-window launch
            // goes through Main.extensionManager.openExtensionPrefs(), which
            // dispatches an async D-Bus call with a null callback — a failure
            // there never reaches this frame, it lands in the journal from
            // the gnome-extensions side instead. Still worth catching: an
            // exception escaping a Clutter signal handler is otherwise logged
            // without this context, and the menu is already closed by then.
            console.warn(`dasbo-island: opening preferences failed: ${e}`)
          }
        },
      })
      this._separator = new PopupMenu.PopupSeparatorMenuItem()
      ;(this.menu as PopupMenu.PopupMenu).addMenuItem(this._header)
      ;(this.menu as PopupMenu.PopupMenu).addMenuItem(this._separator)

      // The rows live in one scroll view so the popup can be bounded without
      // bounding what any row is allowed to say. menu.box is a plain
      // St.BoxLayout and a plain PopupMenu does not scroll in GNOME Shell 46 —
      // only PopupSubMenu.actor is an St.ScrollView — so the scrolling has to be
      // added here. A PopupMenuSection inside it keeps addMenuItem working like
      // menu.addMenuItem for SessionRow and EmptyRow, which is all it needs to
      // do here — but because it is parented with box.add_child rather than
      // menu.addMenuItem, its _setParent is never called, so _getTopMenu()
      // returns the section itself and itemActivated() cannot close the popup;
      // harmless for today's non-activatable rows, but an ordinary activatable
      // PopupMenuItem added here later would silently fail to close the menu.
      // The wrapping has one more consequence worth knowing: popupMenu.js hides
      // a separator beside an *empty* PopupMenuSection, but it recognises one
      // only by a child's _delegate, and the scroll view has none — so the
      // separator above never hides itself and menu.isEmpty() is always false.
      // The header and separator stay direct menu items above it, so the
      // preferences gear is still reachable with a long list of sessions.
      this._body = new PopupMenu.PopupMenuSection()
      this._scroll = new St.ScrollView({
        x_expand: true,
        // NEVER: nothing in the popup wraps sideways, so there is nothing to
        // scroll to, and a horizontal bar would only steal height from the
        // vertical budget this whole arrangement exists to spend.
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.AUTOMATIC,
        // GNOME 46's own PopupSubMenu sets this on its St.ScrollView too: without
        // it, rows can paint outside the capped viewport during the popup's open
        // animation.
        clip_to_allocation: true,
      })
      this._scroll.set_child(this._body.actor)
      ;(this.menu as PopupMenu.PopupMenu).box.add_child(this._scroll)

      this._unsubscribe = this._store.subscribe(() => this.refresh())

      this._settingsChangedIds.push(
        this._settings.connect('changed::always-show', () => this.refresh())
      )

      // Pushed into the live rows rather than rebuilt into new ones. Rows are
      // reused across rebuilds precisely so that permission controls, question
      // panels and task lists survive a refresh; tearing one down here would
      // destroy the PermissionControls whose closures are the only path to
      // resolving a request the user is in the middle of. Toggling `visible`
      // relayouts on its own, and the popup's width is fixed, so nothing but
      // the project label's share of the title row moves.
      this._settingsChangedIds.push(
        this._settings.connect('changed::agent-chip-display', () => {
          this._chipMode = this._settings.get_string('agent-chip-display')
          for (const row of this._rows.values()) row.setChipMode(this._chipMode)
        })
      )

      // Fullscreen is not a store event, so refresh() never runs for it. The
      // island is invisible under a fullscreen window; animating it there is
      // pure waste.
      this._fullscreenId = global.display.connect('in-fullscreen-changed', () =>
        this._applyPause()
      )

      // Anything held by, or connected to, an object that outlives this
      // widget must be released here, not only from destroy() below. Clutter
      // tears children down through clutter_actor_destroy(), which emits the
      // 'destroy' signal and does not necessarily route through a JS method
      // override (see gridIcon.ts); a panel rebuild by an extension
      // like Dash to Panel can destroy this button that way without disable()
      // ever running. this._settings, global.display, and this._store all
      // stay alive in that case, so a subsequent settings change, a pending
      // GLib source, or a store event would otherwise reach a disposed
      // widget with nothing to catch it.
      this.connect('destroy', () => this._releaseExternalRefs())

      this._menuStateId = (this.menu as MenuWithOpenSignal).connect(
        'open-state-changed',
        (_menu, open) => {
          if (open) {
            this._applyBodyCap()
            this._watchKeyFocus()
            this._startTimer()
          } else {
            this._unwatchKeyFocus()
            this._stopTimer()
            // The user closed it. There is nothing left to close, and a timer
            // left armed would fire into whatever the *next* open is.
            this._noticeOpened = false
            this._cancelNoticeClose()
          }
        }
      )

      this.refresh()
    }

    setJumpHandler(fn: (s: Session) => void): void {
      this._onJump = fn
    }

    setPrefsHandler(fn: () => void): void {
      this._onPrefs = fn
    }

    /**
     * How the empty state finds out whether any agent has hooks installed.
     * Injected rather than read here: it needs the extension's own path and the
     * file reader, and the island is a widget.
     */
    setHooksProbe(probe: () => boolean): void {
      this._hooksProbe = probe
    }

    showJumpFailure(key: string): void {
      const row = this._rows.get(key)
      if (!row) return
      const until = Date.now() + 2000
      row.showTransient('couldn’t find its terminal window', until)
      const id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
        // Explicit rather than relying on the deadline having passed:
        // g_timeout_add_seconds rounds to a perturbed second boundary and can
        // fire early, in which case now < until still holds and
        // _syncActivity's guard would otherwise no-op this very update. Ending
        // the transient here makes the timer authoritative regardless of when
        // it actually fires, and also covers a backwards clock jump, which
        // would otherwise freeze this row's activity label until `until` had
        // passed for real.
        row.clearTransient()
        const s = this._store.get(key)
        if (s) row.update(s, Date.now())
        this._transientIds.delete(id)
        return GLib.SOURCE_REMOVE
      })
      this._transientIds.add(id)
    }

    setPermissionHandlers(h: {
      resolve: (id: string, kind: 'allow' | 'deny') => void
      grantAllowAlways: (sessionKey: string, tool: string, id: string) => void
    }): void {
      this._permHandlers = h
    }

    setQuestionHandlers(h: {
      answer: (id: string, text: string) => void
      handOff: (id: string) => void
    }): void {
      this._questionHandlers = h
    }

    /** Called by the D-Bus service after a permission row has been registered. */
    notifyPermissionOpened(kind: 'permission' | 'question'): void {
      // First, above even the notice-timer reset: sound is deliberately
      // independent of every popup rule below it. In fullscreen the island is
      // invisible and the popup is suppressed, which is exactly when the sound
      // is the only signal left — and unlike the popup, it covers nothing.
      this._sound.play(kind)
      // Unconditionally, and before the guards below: the popup is now up for
      // something that needs an answer. Shutting it under the user's cursor
      // mid-click is the worst thing the notice timer could do — and that is
      // true whether or not this call goes on to open anything itself.
      this._noticeOpened = false
      this._cancelNoticeClose()
      if (!this._settings.get_boolean('auto-open-on-permission')) return
      if (Main.layoutManager.primaryMonitor?.inFullscreen) return
      this.menu.open(BoxPointer.PopupAnimation.SLIDE)
    }

    /**
     * Called by the D-Bus service when an agent raised a notification. The
     * store already holds the text; this decides whether to show the popup for
     * it, and arranges to undo that.
     */
    notifyNotification(key: string): void {
      // No text, no notice, or a pending permission/question is holding the
      // row instead of it — either way there is nothing new to show. The
      // second case matters in practice: a notification can arrive while a
      // permission this popup already answered (or the user already glanced
      // at) is still pending, and opening for it would show nothing new and
      // arm a close timer that could shut the popup out from under the
      // permission's own buttons — the worst thing this feature could do.
      // noticeVisible is the single place that decides which case this is,
      // shared with activityText's own notice branch, so the two agree about
      // what the session state says a notice should be doing — though a
      // widget-local transient (showJumpFailure's "no window") can briefly sit
      // on top of that on the row itself; see noticeVisible's own comment.
      // Claude's Notification payload is also inferred rather than captured
      // (see the design doc), so a differently spelled message field must
      // leave this feature silent rather than opening an empty popup on its
      // own — noticeVisible covers that too, since no message means no
      // notice at all.
      //
      // Now the first test in this method rather than the third, because it is
      // the only one of the three that answers "is there anything here at
      // all". The two policy guards below decide whether to *show* it; sound
      // must not sit behind them, but must sit behind this — beeping for a
      // message the row will not display is the audible form of the empty
      // popup this check exists to prevent.
      const session = this._store.get(key)
      if (!session || !noticeVisible(session, Date.now())) return

      this._sound.play('notification')

      if (!this._settings.get_boolean('notification-popup')) return
      if (Main.layoutManager.primaryMonitor?.inFullscreen) return

      this._cancelNoticeClose()
      const seconds = this._settings.get_int('notification-seconds')
      const wasClosed = !(this.menu as PopupMenu.PopupMenu).isOpen
      if (wasClosed) this.menu.open(BoxPointer.PopupAnimation.SLIDE)

      // The flag is set only when a timer is actually armed. With seconds = 0
      // nothing would ever read it, and leaving it true would hand the *next*
      // notification's timer permission to close a popup it did not open.
      //
      // Or-ed rather than assigned: a second notice arriving while the first
      // one's popup is still up finds the menu already open, and clobbering
      // the flag to false there would strand that popup with nothing left to
      // close it.
      if (seconds > 0) {
        this._noticeOpened = this._noticeOpened || wasClosed
        this._noticeCloseId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
          this._noticeCloseId = 0
          if (this._noticeOpened) {
            this._noticeOpened = false
            // Re-entrant: this fires open-state-changed, whose closed branch
            // clears the flag and cancels the timer. Both are already done, so
            // that pass is a no-op rather than a loop.
            this.menu.close(BoxPointer.PopupAnimation.SLIDE)
          }
          return GLib.SOURCE_REMOVE
        })
      }
    }

    /**
     * Called by the D-Bus service when a task tool finished for this session.
     * Marks and returns: the read itself happens on the next tick, and only
     * while the popup is open. A session whose plan moved while nobody was
     * looking is read once, when the popup next opens.
     */
    notifyTasksChanged(key: string): void {
      this._dirtyTasks.add(key)
    }

    private _startTimer(): void {
      if (this._timerId) return
      // Every session, not only the dirty ones. This is the safety net under
      // the dirty flag: the flag is keyed on tool names, those names have been
      // renamed once already (TodoWrite -> TaskCreate), and a rename that stops
      // the marking would otherwise stop the feature dead. Marking everything
      // on open degrades that failure to "refreshes when you look at it".
      for (const s of this._store.list()) this._dirtyTasks.add(s.key)
      this._tickAll()
      this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
        this._tickAll()
        return GLib.SOURCE_CONTINUE
      })
    }

    private _stopTimer(): void {
      if (!this._timerId) return
      GLib.Source.remove(this._timerId)
      this._timerId = 0
    }

    private _cancelNoticeClose(): void {
      if (!this._noticeCloseId) return
      GLib.Source.remove(this._noticeCloseId)
      this._noticeCloseId = 0
    }

    /**
     * The icon animates only when it can actually be seen. Both inputs are
     * checked together because they change independently: `visible` follows
     * the session count and the always-show setting, fullscreen follows the
     * window manager.
     */
    private _applyPause(): void {
      const fullscreen = Main.layoutManager.primaryMonitor?.inFullscreen ?? false
      this._icon.setPaused(!this.visible || fullscreen)
    }

    /**
     * Bound the body to a share of the monitor it is opening on.
     *
     * Recomputed per open rather than watched: that covers a monitor swap, a
     * resolution change and a font-scale change with no extra signal
     * connections, and the work area cannot change under an already-open popup
     * in a way the reader would notice. Expanding a row inside an
     * already-capped scroll view needs no recomputation at all.
     */
    private _applyBodyCap(): void {
      const found = Main.layoutManager.findIndexForActor(this)
      // findIndexForActor can hand back a stale or invalid index mid
      // monitors-changed; the primary monitor is a better guess than none.
      const index = found >= 0 ? found : Main.layoutManager.primaryIndex
      const workAreaHeight = Main.layoutManager.getWorkAreaForMonitor(index)?.height ?? 0
      // Nothing to measure against. The previous cap is a better guess than any
      // number invented here, so write no style at all rather than clamping the
      // popup to MIN_BODY.
      if (workAreaHeight <= 0) return
      // get_preferred_height, not .height: this runs on the first open too,
      // before either item has been allocated, where .height still reads 0.
      const [, headerHeight] = this._header.get_preferred_height(-1)
      const [, separatorHeight] = this._separator.get_preferred_height(-1)
      const scaleFactor = St.ThemeContext.get_for_stage(global.get_stage()).scale_factor
      const px = bodyMaxHeight({
        workAreaHeight,
        chromeHeight: headerHeight + separatorHeight,
        scaleFactor,
      })
      // Inline rather than in the stylesheet: the number depends on the monitor.
      this._scroll.style = `max-height: ${px}px`
    }

    /**
     * Scroll a keyboard-focused control into view.
     *
     * Jump, Allow/Deny/Always and every option button is focusable, so Tab can
     * reach one below the fold; without this the focus ring lands somewhere the
     * reader cannot see. Watched on the stage rather than connected to the
     * scroll view: Clutter emits key-focus-in on the actor that gains focus, not
     * on its ancestors, so a handler on the scroll view would never fire.
     *
     * Deliberately not the Shell's own ensureActorVisibleInScrollView: it lives
     * behind a private resource path that has already moved once between
     * releases, and the arithmetic it would save is the part worth testing.
     */
    private _revealFocus(): void {
      const focus = global.get_stage().get_key_focus()
      if (!focus) return
      // An actor not yet allocated reports {0,0,0,0} for both position and
      // height, which would compute a meaningless offset. questionPanel.ts's
      // openEntry hits this: it swaps the Other… button for an St.Entry and
      // calls set_key_focus on it in the same frame it is created, before
      // layout has run. A wrong scroll is worse than no scroll, and that entry
      // is created where the user just clicked, which is already in view.
      if (!focus.has_allocation()) return
      const body = this._body.actor
      if (!body.contains(focus)) return
      const [, bodyY] = body.get_transformed_position()
      const [, focusY] = focus.get_transformed_position()
      const adjustment = this._scroll.vadjustment
      // The body's own transformed position already carries the current scroll
      // offset, so the difference is the child's y within the box.
      adjustment.value = scrollIntoView({
        value: adjustment.value,
        pageSize: adjustment.page_size,
        childY: focusY - bodyY,
        childHeight: focus.height,
      })
    }

    private _watchKeyFocus(): void {
      if (this._keyFocusId) return
      this._keyFocusId = global
        .get_stage()
        .connect('notify::key-focus', () => this._revealFocus())
    }

    private _unwatchKeyFocus(): void {
      if (!this._keyFocusId) return
      global.get_stage().disconnect(this._keyFocusId)
      this._keyFocusId = 0
    }

    private _releaseExternalRefs(): void {
      // Each disconnect isolated in its own try/catch, unlike extension.ts's
      // _settingsIds teardown (which wraps the whole loop and accepts that a
      // throw skips whatever ids follow it): here a bad id must not strand
      // the remaining connections, since one of them is the chip-display
      // handler that keeps live rows in sync with the setting.
      for (const id of this._settingsChangedIds) {
        try {
          this._settings.disconnect(id)
        } catch (e) {
          console.warn(`dasbo-island: disconnecting a settings handler failed: ${e}`)
        }
      }
      this._settingsChangedIds = []
      if (this._fullscreenId) {
        global.display.disconnect(this._fullscreenId)
        this._fullscreenId = 0
      }
      this._unsubscribe?.()
      this._unsubscribe = null
      for (const id of this._transientIds) GLib.Source.remove(id)
      this._transientIds.clear()
      this._cancelNoticeClose()
      this._unwatchKeyFocus()
      this._stopTimer()
      // PopupMenuBase's constructor connects this._body to Main.sessionMode,
      // and only PopupMenuBase.destroy() releases it — but a Clutter-side
      // destroy reaches _releaseExternalRefs(), not destroy(), and this._body
      // is never destroyed there either (menu.removeAll() filters menu.box's
      // children by _delegate, which skips the scroll view and the section
      // inside it). Left alone, that's a permanent Main.sessionMode handler
      // pointing at a section whose actor is gone. Dropping only the external
      // reference here, and leaving this._body's own teardown in destroy(),
      // keeps this a no-op cleanup rather than reaching into destroy()'s
      // ordering: destroy() calls this before destroying the SessionRows, so
      // destroying this._body from here would pull the row actors out from
      // under the later row.destroy() calls. A second disconnectObject for
      // the same object during PopupMenuBase.destroy() is a harmless no-op.
      Main.sessionMode.disconnectObject(this._body)
    }

    private _tickAll(): void {
      const now = Date.now()
      for (const row of this._rows.values()) row.tick(now)
      this._readDirtyTasks()
    }

    /**
     * Kick off a task-directory read for one session, unless one is already in
     * flight for it. The mark is consumed here, before the read starts, rather
     * than in the completion callback — so a notifyTasksChanged() landing while
     * the read is in flight re-dirties the key instead of being swallowed by
     * it, and the next tick re-reads. Clearing it on completion instead would
     * let a mid-read mark be added and then deleted underneath the read that
     * never saw it, losing the update until the popup is closed and reopened.
     */
    private _readTasksFor(session: Session): void {
      const key = session.key
      if (this._readingTasks.has(key)) return
      const dir = taskDir(session.agent, session.sessionId)
      if (!dir) {
        // No directory for this agent — Codex publishes its plan through the
        // adapter instead. Clearing the flag stops this session re-checking on
        // every tick forever.
        this._dirtyTasks.delete(key)
        return
      }
      this._dirtyTasks.delete(key)
      this._readingTasks.add(key)
      readTasks(dir, (tasks) => {
        this._readingTasks.delete(key)
        // null means the directory could not be read at all, which is the
        // ordinary state of a session that has never made a plan. Setting an
        // empty list here would also blank a good list on a transient failure,
        // so a failed read changes nothing — the same rule processStartedAt
        // follows in the store.
        if (tasks === null) return
        this._store.setTasks(key, tasks)
      })
    }

    /**
     * Every dirty session, read. Called from the tick, so it only runs while
     * the popup is open — _timerId is the "is open" signal, as _rebuildRows
     * records.
     */
    private _readDirtyTasks(): void {
      if (this._dirtyTasks.size === 0) return
      for (const key of [...this._dirtyTasks]) {
        const session = this._store.get(key)
        // The session was reaped between the mark and the read.
        if (!session) {
          this._dirtyTasks.delete(key)
          continue
        }
        this._readTasksFor(session)
      }
    }

    private _rebuildRows(): void {
      const sessions = this._store.list()
      const live = new Set(sessions.map((s) => s.key))
      // One clock for the whole rebuild, so every row in a single pass agrees
      // about whether a notice has expired.
      const now = Date.now()

      for (const [key, row] of [...this._rows]) {
        if (!live.has(key)) {
          // Controls first: they are parented to the row, and destroying the
          // row destroys them with it — so releasing them afterwards makes
          // PermissionControls.detach() call remove_child on a dead parent,
          // which Clutter reports as a "not a child" warning in the journal.
          const stale = this._controls.get(key)
          if (stale) {
            stale.controls.destroy()
            this._controls.delete(key)
          }
          const staleQuestion = this._questions.get(key)
          if (staleQuestion) {
            staleQuestion.panel.destroy()
            this._questions.delete(key)
          }
          const staleTasks = this._taskLists.get(key)
          if (staleTasks) {
            staleTasks.list.destroy()
            this._taskLists.delete(key)
          }
          row.destroy()
          this._rows.delete(key)
          this._dirtyTasks.delete(key)
          this._readingTasks.delete(key)
        }
      }

      for (const s of sessions) {
        const existing = this._rows.get(s.key)
        if (existing) {
          existing.update(s, now)
        } else {
          const row = new SessionRow(s, {
            onJump: (sess) => this._onJump(sess),
            onToggleExpanded: (expanded) => {
              this._questions.get(s.key)?.panel.setExpanded(expanded)
              this._taskLists.get(s.key)?.list.setExpanded(expanded)
            },
          }, now, this._iconBase, this._chipMode)
          this._rows.set(s.key, row)
          this._body.addMenuItem(row)
        }
      }

      for (const s of sessions) {
        const row = this._rows.get(s.key)
        if (!row) continue
        const pending = s.pendingPermission
        const existing = this._controls.get(s.key)

        // Promotion (see PermissionTable.activate) swaps `pendingPermission` to a
        // new id/tool without ever clearing it, so `existing` can be truthy even
        // though it is bound to a request that already resolved. Rebuild whenever
        // the id has moved on, not merely on the pending/absent transition, or the
        // stale cluster's closures keep resolving the wrong (already-finished) id.
        if (pending && existing?.id !== pending.id) {
          existing?.controls.destroy()
          const controls = new PermissionControls({
            onAllow: () => this._permHandlers?.resolve(pending.id, 'allow'),
            onDeny: () => this._permHandlers?.resolve(pending.id, 'deny'),
            onAlways: () =>
              this._permHandlers?.grantAllowAlways(s.key, pending.tool, pending.id),
          })
          controls.attachTo(row.permissionBox)
          this._controls.set(s.key, { id: pending.id, controls })
        } else if (!pending && existing) {
          existing.controls.destroy()
          this._controls.delete(s.key)
        }
      }

      for (const s of sessions) {
        const row = this._rows.get(s.key)
        if (!row) continue
        const pending = s.pendingQuestion
        const existing = this._questions.get(s.key)

        // Keyed on the id for the same reason the permission cluster is: the
        // table promotes a queued entry by publishing a new hold without ever
        // clearing the old one, so a truthy `existing` can still be bound to a
        // request that already resolved.
        if (pending && existing?.id !== pending.id) {
          existing?.panel.destroy()
          const panel = new QuestionPanel(pending.questions, {
            onAnswer: (text) => this._questionHandlers?.answer(pending.id, text),
            onHandOff: () => this._questionHandlers?.handOff(pending.id),
          })
          panel.attachTo(row.questionBox)
          this._questions.set(s.key, { id: pending.id, panel })
          row.setHasQuestion(true)
        } else if (!pending && existing) {
          existing.panel.destroy()
          this._questions.delete(s.key)
          row.setHasQuestion(false)
        }
      }

      for (const s of sessions) {
        const row = this._rows.get(s.key)
        if (!row) continue
        const tasks = s.tasks ?? []
        const existing = this._taskLists.get(s.key)

        if (tasks.length === 0) {
          // Keyed on emptiness, not on absence: a plan whose every task was
          // deleted leaves an empty array behind, and the list widget for it
          // must go with it.
          if (existing) {
            existing.list.destroy()
            this._taskLists.delete(s.key)
          }
          continue
        }
        if (existing) {
          // update() no-ops when the drawing would not differ, so this is safe
          // to call on every rebuild — and doing so is what keeps the list in
          // step without a second subscription.
          existing.list.update(tasks)
          continue
        }
        const list = new TaskList(tasks)
        list.attachTo(row.taskBox)
        this._taskLists.set(s.key, { list })
      }

      // One arrow, two regions, so both must agree with it — and neither can
      // work that out for itself. A list attached to a collapsed row has never
      // been folded and would otherwise show through; and a question arriving
      // on a collapsed row forces the arrow open (see setHasQuestion) without
      // the task list beside it ever hearing, leaving an open arrow above a
      // hidden list. Syncing every attached region here, on every rebuild,
      // rather than only at attach time, covers both directions at once.
      for (const s of sessions) {
        const row = this._rows.get(s.key)
        if (!row) continue
        this._questions.get(s.key)?.panel.setExpanded(row.expanded)
        this._taskLists.get(s.key)?.list.setExpanded(row.expanded)
      }

      // Ordering needs no care here: by the time this method returns, the empty
      // row exists only while there are zero session rows. During a 0->N
      // transition it's briefly still parented above the newly-appended rows,
      // but it's destroyed later in this same synchronous call, before
      // anything is painted — so it never ends up observably wedged between
      // two session rows.
      if (sessions.length === 0 && !this._emptyRow) {
        // Called here rather than cached, so a user who installs hooks and
        // reopens the popup gets the other variant without a reload. The
        // fallback is the less alarming of the two: claiming no agents are
        // connected when we do not know is worse than the reverse.
        this._emptyRow = new EmptyRow(this._hooksProbe?.() ?? true)
        this._body.addMenuItem(this._emptyRow)
      } else if (sessions.length > 0 && this._emptyRow) {
        this._emptyRow.destroy()
        this._emptyRow = null
      }

      // A row built above opens on its constructor's placeholder ('0s', no
      // conversation number) and would keep it until the next timer beat —
      // up to a full second of a visibly wrong clock on precisely the row
      // /clear just created, which is the one the user is looking at. The
      // same beat also lands /compact's in-place renumber, which update()
      // cannot write because it never knows the current time.
      //
      // _timerId is the popup's "is open" signal: it is set by _startTimer on
      // open and cleared by _stopTimer on close. Guarding on it keeps this
      // from ticking rows nobody can see, on a store that emits whether or
      // not the menu is up — and _startTimer already ticks once itself, so
      // rows built while the popup is closed are covered when it opens.
      if (this._timerId) this._tickAll()
    }

    refresh(): void {
      this._rebuildRows()
      const sessions = this._store.list()

      // Above the early return below, deliberately: with the island hidden and no
      // sessions, that return would leave the snapshot stale and the next
      // visible refresh would replay finishes already sounded. Silent when
      // nothing moved, which is what makes the always-show handler and the
      // fullscreen handler free, and the 1s tick too — though the tick never
      // calls refresh() itself. Its GLib source runs _tickAll(), which reaches
      // refresh() only indirectly, through setTasks() -> emit(), when a dirty
      // task read actually changes something.
      if (newlyDone(this._lastStates, sessions).length > 0) this._sound.play('done')
      this._lastStates = snapshotStates(sessions)

      const count = sessions.length

      if (count === 0 && !this._settings.get_boolean('always-show')) {
        this.visible = false
        this._applyPause()
        return
      }
      this.visible = true

      // One call decides both the icon's state and the label's word, so they
      // can never disagree — a pending permission reads "waiting" in both.
      const state = pillState(sessions)
      this._icon.setState(state)

      // One call decides both, so the label a sighted user reads and the name a
      // screen reader hears can never drift apart — and the accessible name is
      // no longer the fixed string set in the constructor, which said nothing
      // about the state the island exists to report.
      const label = islandLabel(count, state)
      this._label.text = label.text
      this.accessible_name = label.spoken
      this._applyPause()
    }

    destroy(): void {
      for (const c of this._controls.values()) c.controls.destroy()
      this._controls.clear()
      for (const q of this._questions.values()) q.panel.destroy()
      this._questions.clear()
      this._releaseExternalRefs()
      if (this._menuStateId) {
        ;(this.menu as MenuWithOpenSignal).disconnect(this._menuStateId)
        this._menuStateId = 0
      }
      for (const row of this._rows.values()) row.destroy()
      this._rows.clear()
      this._emptyRow?.destroy()
      this._emptyRow = null
      this._header.destroy()
      this._separator.destroy()
      this._body.destroy()
      this._scroll.destroy()
      super.destroy()
    }
  }
)
