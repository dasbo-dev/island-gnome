# dasbo-island Plan Revision R3

**Date:** 2026-07-27
**Status:** authoritative. Supersedes R2's permission-row snippet and the base plan's pid contract.

Findings from the whole-branch review. Two Critical, six Important. Every one sits in a seam between tasks — no task-scoped review could see them, because no single task owned the outcome.

---

## C1 — The permission row hides what is being approved

`src/shell/sessionRow.ts` renders a pending permission as bare `waiting for you`, discarding `pending.tool` and `pending.detail`. A user is asked to approve `Bash` running `rm -rf …` while seeing only a project name and the words "waiting for you".

R2 is self-contradictory here: its prose specifies

```
my-api
⏸ waiting for you · Bash · rm -rf build          (+2 waiting)
```

and its code snippet two paragraphs later drops the tool and detail. The snippet was implemented. `stylesheet.css`'s `.dasbo-perm-command` rule is referenced nowhere — the orphaned styling for the display that was lost.

**Fix.** In `SessionRow.update()`, when `session.pendingPermission` is set, render the tool and detail:

```ts
const pending = session.pendingPermission
if (pending) {
  const what = pending.detail
    ? `${pending.tool} · ${truncateDetail(pending.detail)}`
    : pending.tool
  const more = pending.queued > 0 ? ` · +${pending.queued} more` : ''
  this._activity.text = `waiting for you · ${what}${more}`
} else if (tool && detail) {
  this._activity.text = `${tool} · ${truncateDetail(detail)}`
} else {
  this._activity.text = tool ?? session.state
}
```

Apply `.dasbo-perm-command` to the command portion, or delete the rule if a single label is used.

## C2 — `Session.pid` is the hook process, which is dead by the time anyone clicks

`dasbo-hook` exits within milliseconds of its D-Bus call returning. `store.apply` overwrites `s.pid` with that pid on every event. Jump-back resolves ancestry at **click** time, by which point `/proc/<pid>` is gone: `ancestorPids` returns a one-element chain of a dead pid and no window ever matches. Jump fails 100% of the time except while a permission is held open — the one state where the hook is still blocked in `call_sync`.

Same root, two more consequences:
- `reap()`'s `!pidAlive(s.pid)` guard is vacuously true, so "no event for 15 minutes **and** the process is gone" degrades to a bare 15-minute timeout. A live but idle agent loses its row.
- A recycled dead pid can match an unrelated window, so Jump raises the wrong application.

**Fix.** Resolve at event-receipt time, while the hook process is still alive and blocked in its call.

The hook's **parent** is the agent process (`claude`, `codex`, `agy`), which is long-lived. Store that instead.

Add to `src/shell/windowFinder.ts`:

```ts
/**
 * The hook process exits as soon as its D-Bus call returns, so its own pid is
 * useless a moment later. Its parent is the agent process, which lives for the
 * whole session — that is the correct seed for both jump-back ancestry and
 * liveness. Must be called while the hook is still blocked in its call, i.e.
 * from inside the D-Bus method handler.
 */
export function resolveAgentPid(hookPid: number): number {
  if (hookPid <= 0) return 0
  const stat = readStat(hookPid)
  if (stat === null) return 0
  return parsePpid(stat) ?? 0
}
```

`readStat` is currently module-private in `windowFinder.ts`; reuse it.

In `src/dbus/service.ts`, both `Notify` and `RequestPermissionAsync` build their `HookContext` with the resolved pid:

```ts
const ctx = { pid: resolveAgentPid(pid), ts: Date.now(), cwd, event }
```

A `resolveAgentPid` of 0 must degrade to "no window found" and to `pidAlive === false`, exactly as a hook-supplied 0 already does.

`tools/fake-agent.js` passes a synthetic pid whose parent is the script's own shell; that is fine and needs no change, but note in the report that fake-agent's jump behaviour is not meaningful.

## I3 — `enabled-agents` is an inert switch

The prefs page renders a per-agent switch tooltipped "Accept events from this agent" and writes `enabled-agents`. Nothing reads it. `Notify` and `RequestPermissionAsync` gate only on `isAgentId`.

**Fix.** Enforce it in `IslandService`. Read the array through a new option, alongside the existing `timeoutSeconds` accessor, so it stays live without a restart:

```ts
export interface ServiceOptions {
  timeoutSeconds: () => number
  enabledAgents: () => string[]
  onPermissionOpened: () => void
}
```

`Notify` returns early for a disabled agent. `RequestPermissionAsync` replies immediately with the adapter's fall-through encoding — never allow, never deny — so a disabled agent falls back to its own prompt rather than hanging.

## I4 — A `Notify` while a permission is pending clears the `waiting` state

`SessionStore.apply()` writes `s.state` unconditionally and never consults `s.pendingPermission`, but `PermissionTable` owns `waiting` through `setPending`/`clearPending`.

Reachable on any parallel tool batch, which Claude Code issues routinely: `PostToolUse(A)` arrives while B's permission is still pending, `apply` sets `idle`, and the pill reads `1 · idle` while the agent is blocked waiting for a click. The row still says "waiting for you". The pill — the whole glanceable premise — lies. A `stop` in the same window is worse: it stamps `doneAt`, so the moment the permission resolves the session becomes instantly reapable and the row vanishes.

**Fix.** In `apply()`, never leave `waiting` while a permission is pending. Record the event's effects — `currentTool`, `detail`, `lastEventAt`, `doneAt` — but keep `state = 'waiting'`:

```ts
const kindState = /* existing switch result */
s.state = s.pendingPermission ? 'waiting' : kindState
```

`doneAt` must still be stamped on `stop`, so that when the permission resolves and `clearPending` runs, the session settles to its correct state. `clearPending` currently restores `idle` unconditionally — make it restore `done` when `doneAt` is set.

Add tests: applying `tool-end` and applying `stop` while a permission is pending both leave `state === 'waiting'`; resolving afterwards yields `idle` and `done` respectively.

## I5 — Antigravity's decision encoding is unverified, and the README does not say so

The 12 captured fixtures verify `normalize` only. `encodeDecision`'s `{permissionDecision, permissionDecisionReason}` shape is a guess — `docs/agent-dialects.md` documents payload shapes and never a response schema, and the design's open item on this was never closed.

If `agy` ignores an unrecognised stdout shape, clicking **Deny** reports the tool as denied while it executes anyway: a security control failing open, silently.

The README also links to "notes" for Antigravity that do not exist — the only note is for Codex.

**Fix.** Add a "A note on Antigravity CLI" section stating plainly that status reporting is verified against 12 real fixtures but the **permission decision path is unverified**, in the same words used for Codex. Change the table's Antigravity permission cell to say `unverified — see notes`. Add the same warning as a comment above `antigravityAdapter.encodeDecision`.

## I6 — Payload-derived `detail` is unbounded and un-normalised

`detailFromToolInput` returns `tool_input.command` verbatim into an `St.Label`. A routine multi-line heredoc becomes a 30-line block in the popup; a long single-line command widens the boxpointer past the screen edge and pushes Allow and Deny out of reach.

C1 puts `detail` on the permission row, so this must land with it.

**Fix.** Add to `src/core/format.ts` (pure, testable):

```ts
/** Collapse whitespace and cap length, so one label cannot resize the popup. */
export function truncateDetail(s: string, max = 120): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : flat.slice(0, max - 1) + '…'
}
```

Apply at every `St.Label` that renders `detail`. Test: multi-line collapses, over-length truncates with an ellipsis, exactly-at-limit is untouched, empty stays empty.

## I7 — `permission-timeout = 0` plus a killed agent leaves a permanent zombie

`reap()` begins `if (s.pendingPermission) continue`, and with `timeoutSeconds === 0` no timer is ever started. Kill an agent mid-permission and the entry stays in `pending` forever, the session stays `waiting` forever, the reaper is forbidden from touching it, and a row with live Allow/Deny buttons persists until `disable()`. One accumulates per killed agent.

**Fix.** Let the reaper collect a pending session whose process is gone. `SessionStore.reap` cannot resolve the permission itself — it must not depend on `PermissionTable` — so have it report:

```ts
/** Returns the session keys it dropped, so the caller can release anything held for them. */
reap(now: number, pidAlive: (pid: number) => boolean): string[]
```

Drop a session with a pending permission only when its pid is dead **and** its `deadline` is `0` (no timer will ever fire). Sessions with a live deadline keep their existing protection — their timer will resolve them.

Add `PermissionTable.releaseSession(sessionKey)`, resolving every entry for that session — active and queued — with fall-through, exactly like `resolveAllFallthrough` does globally. The reaper timer in `extension.ts` passes the returned keys to it.

Test: a pending session with a dead pid and `deadline === 0` is dropped and its request resolved fall-through; one with a live deadline is kept.

## I8 — An exception during `disable()`'s drain aborts teardown

`resolveAllFallthrough` calls `invocation.return_value(...)` for every held request, against peers that may be dead. There is no per-entry `try`, and `disable()` has no `try/finally`. One throw aborts the loop, leaves the remaining agents wedged, and skips `_island.destroy()` — so the panel button, the store subscription, the settings handler and the 1s timer all survive, and the next `enable()` adds a second button.

The 10× stress loop cannot reproduce this: it never had a held invocation with a dead peer.

**Fix.** Two changes.

1. `PermissionTable.finish()` wraps `entry.resolve(d)` in `try/catch`. A caller that throws must not prevent the entry being removed or the queue advancing.
2. `disable()` wraps each teardown step so a throw in one cannot skip the rest. Prefer a small helper over eight nested try blocks:

```ts
const safely = (label: string, fn: () => void) => {
  try { fn() } catch (e) { console.warn(`dasbo-island: teardown step "${label}" failed: ${e}`) }
}
```

Same root, one more place: `RequestPermissionAsync` has no guaranteed-reply guard, while the hook calls with `NO_TIMEOUT`. Any throw between entry and `permissions.request()` — `store.apply` → `emit()` → `island.refresh()` builds St widgets — leaves the invocation both unanswered and unregistered, so even `disable()`'s drain cannot reach it. The agent blocks forever, contradicting the README's fail-open guarantee. Wrap the whole method body in `try/catch` and reply with the fall-through encoding on any escape.

---

## Minor, fix while in the area

- Delete `SessionRow.setJumpEnabled` (dead) and `.dasbo-perm-command` if C1's implementation does not use it.
- Replace hardcoded `#cccccc` / `#aaaaaa` in `stylesheet.css` with theme colours — both are illegible in GNOME 46's light popup.
- An Antigravity `Stop` carrying a non-empty `error` becomes `kind: 'error'`, so the session never reaches `done`, never gets a `doneAt`, and lingers for the full 15-minute stale window instead of `done-linger`. Treat `Stop` as terminal regardless of `error`.
- Move `isRecord` and `str` into `src/core/adapters/shared.ts`. The "keep adapters independent" rationale is already void — `codex.ts` imports `detailFromToolInput` from `claude.ts`.
- Add a hard cap on session count in `SessionStore` (a few hundred) so a misbehaving or hostile peer on the session bus cannot grow the map unbounded for 15 minutes.
- Say in the README's Codex note that Codex has **no permission gate at all** — its installed hook is notify-only, so `codexAdapter.encodeDecision` is unreachable.

## Deliberately not fixed

- `PermissionTable.always` grants are never pruned. Bounded by sessions × tools, and because the key is `agent:sessionId` a surviving grant re-applies to the same conversation — which matches the "dies with the session" contract rather than violating it.
- `finish()` resolving before store cleanup. `resolve` is a D-Bus reply and cannot synchronously re-enter the table, so the ordering is unobservable.
- `src/shell/**` has no automated coverage. Architectural: it needs a live compositor. Both Critical findings lived there, which is the argument for the manual pass below, not for a test harness.

## Must be exercised by hand before publishing

Nobody has ever clicked a button in this extension. Before merge:

1. Click **Allow**, **Deny** and **Always** on a real Claude Code `PreToolUse`; confirm the agent actually proceeds or blocks.
2. Click **Jump** on a `running` session, not a `waiting` one — the C2 reproducer.
3. Run two parallel tool calls and watch the pill colour after allowing the first — the I4 reproducer.
4. Drive `agy` through one real permission and confirm **Deny** actually blocks the tool — the I5 reproducer.
5. Set `permission-timeout` to 0, start a permission, `kill -9` the agent, watch the row — the I7 reproducer.
