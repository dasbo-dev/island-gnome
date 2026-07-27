import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import { BUS_NAME, IFACE_XML, OBJECT_PATH } from './iface.js'
import { adapters, isAgentId, normalizeFor } from '../core/adapters/index.js'
import { sessionKey } from '../core/types.js'
import type { SessionStore } from '../core/store.js'
import type { PermissionTable } from '../core/permissions.js'

const VERSION = '0.1.0'

export interface ServiceOptions {
  /** Read live from GSettings on every request, so changes need no restart. */
  timeoutSeconds: () => number
  /** Called after a permission row appears, so the UI can pulse and auto-open. */
  onPermissionOpened: () => void
}

export class IslandService {
  private impl: Gio.DBusExportedObject | null = null
  private nameOwnerId = 0
  private nameAcquired = false

  constructor(
    private store: SessionStore,
    private permissions: PermissionTable,
    private opts: ServiceOptions
  ) {}

  export(): void {
    this.impl = Gio.DBusExportedObject.wrapJSObject(IFACE_XML, this)
    this.impl.export(Gio.DBus.session, OBJECT_PATH)
    // GDBus calls the name-lost handler both when the name cannot be acquired
    // and later when it goes away — including the ordinary case of the session
    // bus closing at shutdown. Track acquisition so only a genuine failure warns.
    this.nameAcquired = false
    this.nameOwnerId = Gio.bus_own_name(
      Gio.BusType.SESSION,
      BUS_NAME,
      Gio.BusNameOwnerFlags.NONE,
      null,
      () => {
        this.nameAcquired = true
      },
      () => {
        if (this.nameAcquired) return
        console.warn(`dasbo-island: could not own ${BUS_NAME}; another instance may be running`)
      }
    )
  }

  unexport(): void {
    if (this.nameOwnerId) {
      Gio.bus_unown_name(this.nameOwnerId)
      this.nameOwnerId = 0
    }
    this.impl?.unexport()
    this.impl = null
  }

  Ping(): string {
    return VERSION
  }

  Notify(agent: string, event: string, cwd: string, pid: number, payloadJson: string): void {
    if (!isAgentId(agent)) return
    let raw: unknown
    try {
      raw = JSON.parse(payloadJson)
    } catch {
      console.warn(`dasbo-island: unparseable payload from ${agent}`)
      return
    }
    const e = normalizeFor(agent, raw, { pid, ts: Date.now(), cwd, event })
    if (!e) return
    this.store.apply(e)
  }

  /**
   * GJS calls the *Async form with the invocation object, letting us reply later.
   * The reply is held until the user clicks or the permission table times out.
   */
  RequestPermissionAsync(
    params: [string, string, string, number, string],
    invocation: Gio.DBusMethodInvocation
  ): void {
    const [agent, event, cwd, pid, payloadJson] = params
    const reply = (json: string) => {
      invocation.return_value(new GLib.Variant('(s)', [json]))
    }

    if (!isAgentId(agent)) return reply('{}')

    let raw: unknown
    try {
      raw = JSON.parse(payloadJson)
    } catch {
      return reply('{}')
    }

    const adapter = adapters[agent]
    const e = normalizeFor(agent, raw, { pid, ts: Date.now(), cwd, event })
    if (!e) return reply(JSON.stringify(adapter.encodeDecision({ kind: 'fallthrough' })))

    // Register the session first so the permission has a row to attach to.
    this.store.apply(e)
    const key = sessionKey(e.agent, e.sessionId)

    this.permissions.request(
      {
        sessionKey: key,
        tool: e.tool ?? 'unknown',
        detail: e.detail,
        timeoutSeconds: this.opts.timeoutSeconds(),
      },
      (decision) => reply(JSON.stringify(adapter.encodeDecision(decision)))
    )

    if (this.store.get(key)?.pendingPermission) this.opts.onPermissionOpened()
  }
}
