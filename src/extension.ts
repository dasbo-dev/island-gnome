import GLib from 'gi://GLib'
import type Gio from 'gi://Gio'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'
import { SessionStore } from './core/store.js'
import { installState, type InstallEnv } from './core/install/plan.js'
import { readFileOrNull } from './shell/applyEdits.js'
import { AGENT_CATALOG } from './core/agentCatalog.js'
import { PermissionTable } from './core/permissions.js'
import { glibTimers } from './shell/glibTimers.js'
import { IslandService } from './dbus/service.js'
import { Island } from './shell/island.js'
import {
  activateForPid,
  forgetSessionWindows,
  pidAlive,
  pruneSessionWindows,
} from './shell/windowFinder.js'
import { placeInPanelBox } from './shell/panelPlacement.js'
import { panelBox } from './core/panelBox.js'
import { SoundPlayer } from './shell/soundPlayer.js'
import { TranscriptWatcher } from './shell/transcriptWatcher.js'
import { maybeShowWelcome } from './shell/welcome.js'
import { warn } from './core/log.js'

export default class DasboIslandExtension extends Extension {
  private _island: InstanceType<typeof Island> | null = null
  private _store: SessionStore | null = null
  private _permissions: PermissionTable | null = null
  private _service: IslandService | null = null
  private _reaperId = 0
  private _settingsIds: number[] = []
  private _settings: Gio.Settings | null = null
  private _sound: SoundPlayer | null = null
  private _transcripts: TranscriptWatcher | null = null
  private _unwatchStore: (() => void) | null = null

  enable() {
    const settings = this.getSettings()
    this._settings = settings
    this._store = new SessionStore()
    this._store.doneLingerSeconds = settings.get_int('done-linger')
    this._store.notificationSeconds = settings.get_int('notification-seconds')
    this._settingsIds.push(
      settings.connect('changed::done-linger', () => {
        if (this._store) this._store.doneLingerSeconds = settings.get_int('done-linger')
      })
    )
    this._settingsIds.push(
      // Read into the store rather than looked up per event: the store is pure
      // and must not know GSettings exists, which is the same arrangement
      // doneLingerSeconds already has.
      settings.connect('changed::notification-seconds', () => {
        if (this._store) this._store.notificationSeconds = settings.get_int('notification-seconds')
      })
    )
    this._permissions = new PermissionTable(this._store, glibTimers)
    // Claude fires no hook when the user interrupts a turn, so the only
    // evidence is the line it writes into the session transcript — see
    // src/core/transcript.ts. Driven off the store's own notifications rather
    // than a timer of its own: every change to which sessions are running
    // arrives there already, and nothing else has to know this exists.
    this._transcripts = new TranscriptWatcher(this._store)
    this._unwatchStore = this._store.subscribe(() => this._transcripts?.sync())
    this._sound = new SoundPlayer(settings)
    this._island = new Island(this._store, settings, this.path, this._sound)

    Main.panel.addToStatusArea(
      this.uuid,
      this._island,
      settings.get_int('panel-index'),
      panelBox(settings.get_string('panel-position'))
    )

    // addToStatusArea above runs once, because it also registers the role and
    // the menu. Later changes only reparent the container.
    const reposition = () => {
      if (!this._island) return
      placeInPanelBox(
        this._island.container,
        settings.get_string('panel-position'),
        settings.get_int('panel-index')
      )
    }
    this._settingsIds.push(settings.connect('changed::panel-position', reposition))
    this._settingsIds.push(settings.connect('changed::panel-index', reposition))

    this._island.setJumpHandler((session) => {
      const ok = activateForPid(session.pid)
      if (!ok) this._island?.showJumpFailure(session.key)
    })

    this._island.setPrefsHandler(() => this.openPreferences())

    this._island.setHooksProbe(() => {
      const env: InstallEnv = {
        home: GLib.get_home_dir(),
        hookPath: `${this.path}/hooks/dasbo-hook`,
        existing: readFileOrNull,
      }
      // `stale` counts as connected: most stale hooks are on disk and firing,
      // they just don't match this version. That is not universally true
      // since the gjs -m change (src/core/install/plan.ts): a pre-gjs
      // bare-path entry on an install whose executable bit got dropped is
      // stale and not firing. Telling the common case's user no agents are
      // connected would send them to install hooks they already have, so
      // this still errs toward counting stale as connected.
      return AGENT_CATALOG.some((entry) => {
        if (entry.status !== 'supported') return false
        const state = installState(entry.id, env)
        return state === 'installed' || state === 'stale'
      })
    })

    this._island.setPermissionHandlers({
      resolve: (id, kind) => {
        this._permissions?.resolve(id, { kind })
      },
      grantAllowAlways: (sessionKey, tool, id) => {
        this._permissions?.grantAlways(sessionKey, tool)
        this._permissions?.resolve(id, { kind: 'allow', reason: 'Always allowed for this session' })
      },
    })

    this._island.setQuestionHandlers({
      answer: (id, text) => {
        this._permissions?.resolve(id, { kind: 'answer', answer: text })
      },
      handOff: (id) => {
        // Fall-through, not a denial: the agent must go on to ask the question
        // its own way, exactly as it would if the island were not installed.
        this._permissions?.resolve(id, {
          kind: 'fallthrough',
          reason: 'Answering in the terminal',
        })
      },
    })

    this._service = new IslandService(this._store, this._permissions, {
      timeoutSeconds: () => settings.get_int('permission-timeout'),
      questionTimeoutSeconds: () => settings.get_int('question-timeout'),
      enabledAgents: () => settings.get_strv('enabled-agents'),
      onPermissionOpened: (kind) => this._island?.notifyPermissionOpened(kind),
      onNotification: (key) => this._island?.notifyNotification(key),
      onTasksChanged: (key) => this._island?.notifyTasksChanged(key),
    })
    this._service.export()

    this._reaperId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 60, () => {
      // releaseSession reaches Island.refresh through the store's subscribers,
      // so this callback builds St widgets. An exception escaping a GLib source
      // callback removes the source, which would stop the reaper permanently and
      // strand every remaining key — so swallow and keep sweeping.
      try {
        const dropped = this._store?.reap(Date.now(), pidAlive) ?? []
        for (const key of dropped) this._permissions?.releaseSession(key)
        // The jump targets outlive their sessions otherwise: a session that
        // ends holds its window here until some later session start prunes.
        pruneSessionWindows()
      } catch (e) {
        warn(`reaper sweep failed: ${e}`)
      }
      return GLib.SOURCE_CONTINUE
    })

    // Last, after every handler is wired: its action button opens preferences,
    // so nothing should be half-built at the moment the user can press it.
    maybeShowWelcome(settings, () => this.openPreferences())
  }

  disable() {
    if (this._reaperId) {
      GLib.Source.remove(this._reaperId)
      this._reaperId = 0
    }

    this._service?.unexport()
    this._service = null

    this._unwatchStore?.()
    this._unwatchStore = null
    this._transcripts?.destroy()
    this._transcripts = null

    // Module state, not the extension object's: it would otherwise survive a
    // disable() holding Meta.Window references for a shell that has since torn
    // them down.
    forgetSessionWindows()

    // Ahead of the permission drain below, not after it. Draining settles held
    // requests, a settled request can produce a 'done' diff, and
    // Island.refresh() answers that with play('done') — so an island still
    // subscribed at that moment chimes on the way out. Destroying it first
    // drops the store subscription and the tick timer, which makes that path
    // unreachable. Agents still get their fall-through answers; they arrive one
    // step later.
    this._island?.destroy()
    this._island = null

    this._permissions?.resolveAllFallthrough()
    this._permissions = null

    // After the island, which is the only thing that calls play().
    this._sound?.destroy()
    this._sound = null

    this._store = null

    for (const id of this._settingsIds) this._settings?.disconnect(id)
    this._settingsIds = []
    this._settings = null
  }
}
