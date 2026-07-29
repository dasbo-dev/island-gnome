import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import { BUS_NAME, IFACE_XML, OBJECT_PATH } from './iface.js'
import { adapters, isAgentId, normalizeFor } from '../core/adapters/index.js'
import { sessionKey } from '../core/types.js'
import { resolveAgent } from '../shell/windowFinder.js'
import type { SessionStore } from '../core/store.js'
import type { PermissionTable } from '../core/permissions.js'

const VERSION = '0.1.0'

export interface ServiceOptions {
  /** Read live from GSettings on every request, so changes need no restart. */
  timeoutSeconds: () => number
  /** Read live from GSettings on every request, so changes need no restart. */
  enabledAgents: () => string[]
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
    if (!this.opts.enabledAgents().includes(agent)) return
    let raw: unknown
    try {
      raw = JSON.parse(payloadJson)
    } catch {
      console.warn(`dasbo-island: unparseable payload from ${agent}`)
      return
    }
    // Resolved now, while the hook is still alive to have a readable /proc
    // entry — its own pid is dead within milliseconds of this call returning.
    const agentProc = resolveAgent(agent, pid)
    const e = normalizeFor(agent, raw, {
      pid: agentProc.pid,
      agentStartedAt: agentProc.startedAt,
      ts: Date.now(),
      cwd,
      event,
    })
    if (!e) return
    this.store.apply(e)
  }

  /**
   * GJS calls the *Async form with the invocation object, letting us reply later.
   * The reply is held until the user clicks or the permission table times out.
   * The hook calls with NO_TIMEOUT, so a reply is not optional: anything that
   * escapes without one blocks the agent forever, contradicting the README's
   * fail-open guarantee. The whole body is therefore wrapped so any throw
   * still produces a fall-through reply rather than an unanswered invocation.
   */
  RequestPermissionAsync(
    params: [string, string, string, number, string],
    invocation: Gio.DBusMethodInvocation
  ): void {
    const [agent, event, cwd, pid, payloadJson] = params
    let replied = false
    const reply = (json: string) => {
      if (replied) return
      replied = true
      invocation.return_value(new GLib.Variant('(s)', [json]))
    }

    try {
      if (!isAgentId(agent)) return reply('{}')

      let raw: unknown
      try {
        raw = JSON.parse(payloadJson)
      } catch {
        return reply('{}')
      }

      const adapter = adapters[agent]
      const fallthroughJson = () => JSON.stringify(adapter.encodeDecision({ kind: 'fallthrough' }))

      // A disabled agent gets the same "never allow, never deny" encoding as a
      // timeout, so it falls back to its own prompt instead of hanging.
      if (!this.opts.enabledAgents().includes(agent)) return reply(fallthroughJson())

      // Resolved now, while the hook is still alive to have a readable /proc
      // entry — its own pid is dead within milliseconds of this call returning.
      const agentProc = resolveAgent(agent, pid)
      const e = normalizeFor(agent, raw, {
        pid: agentProc.pid,
        agentStartedAt: agentProc.startedAt,
        ts: Date.now(),
        cwd,
        event,
      })
      if (!e) return reply(fallthroughJson())

      // Register the session first so the permission has a row to attach to.
      this.store.apply(e)
      const key = sessionKey(e.agent, e.sessionId)

      // The agent is in a mode that asks about nothing, yet still runs its
      // pre-tool hook. Gating here would put the island in front of a decision
      // the agent already made — the very prompting the mode exists to remove.
      // Reply with no opinion at all rather than the fall-through encoding: an
      // empty object makes the hook print nothing, whereas Claude's
      // fall-through is an explicit "ask" that could re-introduce a prompt.
      // The session row is already updated above, so activity still shows.
      if (e.permissionsBypassed) return reply('{}')

      const id = this.permissions.request(
        {
          sessionKey: key,
          tool: e.tool ?? 'unknown',
          detail: e.detail,
          timeoutSeconds: this.opts.timeoutSeconds(),
        },
        (decision) => reply(JSON.stringify(adapter.encodeDecision(decision)))
      )

      // A request that merely queues behind an active one leaves the session's
      // pendingPermission id unchanged (see PermissionTable.publishDepth), so this
      // only fires when the new request actually became — or immediately became —
      // the active one. Short-circuited requests (unknown session, always-allowed)
      // never set a pendingPermission with this id, so they stay silent too.
      if (this.store.get(key)?.pendingPermission?.id === id) this.opts.onPermissionOpened()
    } catch (e) {
      console.warn(`dasbo-island: RequestPermissionAsync failed: ${e}`)
      reply('{}')
    }
  }
}
