import GLib from 'gi://GLib'
import type Gio from 'gi://Gio'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'
import { SessionStore } from './core/store.js'
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
import { SoundPlayer } from './shell/soundPlayer.js'

export default class DasboIslandExtension extends Extension {
  private _island: InstanceType<typeof Island> | null = null
  private _store: SessionStore | null = null
  private _permissions: PermissionTable | null = null
  private _service: IslandService | null = null
  private _reaperId = 0
  private _settingsIds: number[] = []
  private _settings: Gio.Settings | null = null
  private _sound: SoundPlayer | null = null

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
    this._sound = new SoundPlayer(settings)
    this._island = new Island(this._store, settings, this.path, this._sound)

    Main.panel.addToStatusArea(
      this.uuid,
      this._island,
      settings.get_int('panel-index'),
      settings.get_string('panel-position')
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
        console.warn(`dasbo-island: reaper sweep failed: ${e}`)
      }
      return GLib.SOURCE_CONTINUE
    })
  }

  disable() {
    // A throw in one teardown step must not skip the rest: it would leave the
    // remaining agents wedged and, worse, could skip _island.destroy() itself
    // — leaking the panel button, the store subscription, the settings
    // handler and the 1s timer, so the next enable() adds a second button.
    const safely = (label: string, fn: () => void) => {
      try {
        fn()
      } catch (e) {
        console.warn(`dasbo-island: teardown step "${label}" failed: ${e}`)
      }
    }

    safely('reaper timer', () => {
      if (this._reaperId) {
        GLib.Source.remove(this._reaperId)
        this._reaperId = 0
      }
    })

    safely('dbus service', () => {
      this._service?.unexport()
      this._service = null
    })

    safely('remembered jump windows', () => {
      // Module state, not the extension object's: it would otherwise survive
      // a disable() holding Meta.Window references for a shell that has since
      // torn them down.
      forgetSessionWindows()
    })

    safely('mute sound player', () => {
      // Ahead of 'pending permissions', deliberately: the fallthrough resolve
      // just below can settle a session held on a permission straight through
      // to 'done' (via clearPending), which reaches Island.refresh() ->
      // play('done') while the island is still alive — its own teardown step
      // has not run yet. Left alone, a disable() or a shell reload can chime
      // on the way out. Marking the player destroyed here closes that off
      // without touching the release order itself, which stays exactly as it
      // was: reordering it would need verification this change does not do.
      this._sound?.markDestroyed()
    })

    safely('pending permissions', () => {
      this._permissions?.resolveAllFallthrough()
      this._permissions = null
    })

    safely('island', () => {
      this._island?.destroy()
      this._island = null
    })

    safely('sound player', () => {
      // After the island, which is the only thing that calls play().
      this._sound?.destroy()
      this._sound = null
    })

    this._store = null

    safely('settings handlers', () => {
      const settings = this._settings
      try {
        if (settings) for (const id of this._settingsIds) settings.disconnect(id)
      } finally {
        // A throw part-way through the loop must not carry the remaining ids
        // into the next enable(): they would be stale, the following disable()
        // would throw on them again, and the extension would never tear its
        // handlers down cleanly again.
        this._settingsIds = []
      }
    })

    this._settings = null
  }
}
