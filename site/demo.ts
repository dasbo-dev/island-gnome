/**
 * The landing page's live demo: the extension's real core (SessionStore,
 * pillState, gridPose) driven by the scripted timeline, rendered into plain
 * DOM. This module plays the role src/shell plays in the extension.
 */
import { SessionStore } from '../src/core/store.js'
import { pillState } from '../src/core/pillState.js'
import { gridPose, tickIntervalMs } from '../src/core/grid.js'
import { activityText } from '../src/core/activity.js'
import { formatElapsed } from '../src/core/format.js'
import { summarize } from '../src/core/tasks.js'
import { adapters } from '../src/core/adapters/index.js'
import { clockText } from './clock.js'
import type { Session, SessionState } from '../src/core/types.js'
import { LOOP_MS, TIMELINE, storeAt } from './timeline.js'

// Mirrors src/shell/island.ts's own STATE_WORD exactly — the pill's word for
// a pending permission must read the same on this page as it does in the
// real extension.
const STATE_WORD: Record<SessionState, string> = {
  idle: 'idle',
  running: 'working',
  waiting: 'waiting',
  error: 'error',
  done: 'done',
}

/** Paint one 2×2 grid element from the real gridPose. */
function paint(grid: HTMLElement, state: SessionState, phase: number): void {
  const pose = gridPose(state, phase)
  grid.className = `grid state-${state}${pose.fill === 'accent' ? ' accent' : ''}`
  const blocks = grid.querySelectorAll<HTMLElement>('.block')
  pose.alpha.forEach((a, i) => {
    // Defensive, not merely a compile-time `!`: a `.grid` with fewer than
    // four `.block` children would otherwise throw inside a setTimeout
    // callback and permanently kill that grid's animation loop. The markup
    // always supplies four, so this is a no-op today.
    const block = blocks[i]
    if (block) block.style.opacity = String(a)
  })
}

/**
 * Animate one grid on the extension's own tick schedule. A state change resets
 * the phase so entry animations (the done stagger) play from their start.
 * tickIntervalMs returns 0 for static poses, which stops the timer; poke()
 * restarts it after a state change.
 */
function animate(grid: HTMLElement, getState: () => SessionState): { poke: () => void } {
  let timer = 0
  let state = getState()
  let entered = performance.now()
  const frame = (): void => {
    const now = performance.now()
    const next = getState()
    if (next !== state) {
      state = next
      entered = now
    }
    const phase = now - entered
    paint(grid, state, phase)
    const wait = tickIntervalMs(state, phase)
    timer = wait > 0 ? window.setTimeout(frame, wait) : 0
  }
  frame()
  return {
    poke: (): void => {
      if (timer === 0) frame()
    },
  }
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const e = document.createElement(tag)
  e.className = className
  if (text !== undefined) e.textContent = text
  return e
}

function chip(agent: Session['agent']): HTMLElement {
  const c = el('span', 'chip')
  const img = document.createElement('img')
  img.src = `icons/${agent}.svg`
  img.alt = ''
  c.append(img, el('span', 'chip-name', adapters[agent].shortName))
  return c
}

/**
 * One popup row's live DOM, kept around across updates. `controls` — the
 * Allow/Deny buttons — is the one subtree a real human can be mid-interaction
 * with (a mousedown not yet followed by mouseup, or Tab focus not yet
 * followed by Enter), so it is the one part of a row this module refuses to
 * tear down and recreate just because a tick fired. Everything else is cheap
 * to rewrite outright: nothing else is ever the target of a click or holds
 * keyboard focus.
 */
interface RowEntry {
  el: HTMLElement
  meta: HTMLElement
  activity: HTMLElement
  tasksList: HTMLElement | null
  controls: HTMLElement | null
  /** The pendingPermission id `controls` was built for, so a *different*
   *  permission arriving on the same session still gets fresh buttons. */
  controlsId: string | undefined
}

function buildRow(s: Session): RowEntry {
  const r = el('div', `row state-${s.state}`)
  const head = el('div', 'row-head')
  const meta = el('span', 'meta')
  head.append(chip(s.agent), el('span', 'project', s.project), meta)
  r.append(head)
  const activity = el('div', 'activity')
  r.append(activity)
  return { el: r, meta, activity, tasksList: null, controls: null, controlsId: undefined }
}

/**
 * Rewrite one row's content in place for the current session snapshot.
 * Everything but `.controls` is rebuilt unconditionally — that mirrors what
 * store.ts already does for setTasks (see the comment above it): most of
 * these calls produce byte-identical text, and the store already declines to
 * emit for the identical-tasks case for the same reason a wholesale rebuild
 * of the *whole* popup ten times a second would be wasteful. `.controls` gets
 * the stronger guarantee — it is only touched when the permission it
 * represents actually changes — because unlike everything else in a row, a
 * human's mousedown or keyboard focus can be resting on it between calls.
 */
function updateRow(entry: RowEntry, s: Session, now: number, getStore: () => SessionStore): void {
  entry.el.className = `row state-${s.state}`

  entry.meta.replaceChildren()
  if (s.tasks && s.tasks.length > 0) {
    const { completed, total } = summarize(s.tasks)
    entry.meta.append(el('span', 'tasks-count', `${completed}/${total}`))
  }
  entry.meta.append(el('span', 'elapsed', formatElapsed(now - s.startedAt)))

  const a = activityText(s, now)
  entry.activity.className = `activity${a.hint ? ' hint' : ''}`
  entry.activity.textContent = a.text

  if (s.pendingPermission) {
    if (!entry.controls || entry.controlsId !== s.pendingPermission.id) {
      entry.controls?.remove()
      const controls = el('div', 'controls')
      const allow = el('button', 'allow', 'Allow')
      const deny = el('button', 'deny', 'Deny')
      // Both settle the demo the same way the extension's clearPending does —
      // the point is showing that the controls are the real ones. Read the
      // store through `getStore()` rather than closing over the `store`
      // in scope when the buttons were built: this subtree deliberately
      // outlives the tick that created it (see the RowEntry doc comment),
      // and the 30s loop restart reassigns the outer `store` variable to a
      // fresh SessionStore. A stale capture would call clearPending on a
      // discarded store and silently do nothing.
      allow.onclick = (): void => getStore().clearPending(s.key)
      deny.onclick = (): void => getStore().clearPending(s.key)
      controls.append(allow, deny)
      // Anchored right after `.activity` — not appended at the end — so
      // child order is `head, activity, controls, tasks` regardless of
      // whether the task list already exists when the permission arrives
      // or arrives afterward. The Allow/Deny buttons must sit directly
      // under the "waiting for you" line they answer, not below a task
      // list that can run to several lines.
      entry.activity.after(controls)
      entry.controls = controls
      entry.controlsId = s.pendingPermission.id
    }
    // else: same permission as last time — leave the existing <div> and its
    // <button>s completely untouched.
  } else if (entry.controls) {
    entry.controls.remove()
    entry.controls = null
    entry.controlsId = undefined
  }

  if (s.agent === 'claude' && s.tasks && s.tasks.length > 0) {
    const list = el('ul', 'tasks')
    for (const t of s.tasks) {
      const mark = t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▸' : '○'
      list.append(el('li', `task ${t.status}`, `${mark} ${t.subject}`))
    }
    if (entry.tasksList) entry.tasksList.replaceWith(list)
    else entry.el.append(list)
    entry.tasksList = list
  } else if (entry.tasksList) {
    entry.tasksList.remove()
    entry.tasksList = null
  }
}

const rowEntries = new Map<string, RowEntry>()

/**
 * Keep `container`'s rows in step with `store` without ever destroying a node
 * a human might be mid-click or mid-Tab on — the replacement for a wholesale
 * `container.replaceChildren(...row())` rebuild, which (see Finding 1 in the
 * review this fixes) tore out and rebuilt every `<button>` on every call,
 * including the ten-per-second calls this module makes while a permission
 * sits open. Sessions no longer in `store.list()` drop their row; every
 * session present gets `updateRow`; DOM order is reconciled to match
 * `store.list()`'s order by moving existing nodes rather than recreating
 * them, which is also safe for focus — repositioning a node that stays
 * connected to the document does not blur it.
 *
 * `getStore` is a *getter*, not the store itself, so the Allow/Deny closures
 * `updateRow` builds keep reading whichever store is current at click time —
 * see the comment in `updateRow` on why capturing a single store reference
 * would go stale across the demo's 30s loop restart.
 */
function syncRows(container: HTMLElement, getStore: () => SessionStore, now: number): void {
  const store = getStore()
  const sessions = store.list()
  const live = new Set(sessions.map((s) => s.key))

  for (const [key, entry] of [...rowEntries]) {
    if (!live.has(key)) {
      entry.el.remove()
      rowEntries.delete(key)
    }
  }

  // Any container child not owned by a surviving RowEntry is stale: on the
  // very first call it is the three hand-written no-JS fallback rows
  // index.html ships (for when this script never runs at all — see the
  // `<noscript>`-equivalent role of #popup-rows' static markup); later it
  // can never happen, since every live row is tracked above. Sweeping them
  // here, rather than once before the loop starts, keeps the clear tied to
  // "JS has actually taken over and produced a real render pass" instead of
  // an unconditional wipe that would also fire before pillGrid/pillLabel
  // are known to exist.
  const known: Set<Element> = new Set([...rowEntries.values()].map((entry) => entry.el))
  for (const child of [...container.children]) {
    if (!known.has(child)) child.remove()
  }

  let ref: ChildNode | null = container.firstChild
  for (const s of sessions) {
    let entry = rowEntries.get(s.key)
    if (!entry) {
      entry = buildRow(s)
      rowEntries.set(s.key, entry)
    }
    updateRow(entry, s, now, getStore)
    if (ref !== entry.el) container.insertBefore(entry.el, ref)
    else ref = ref.nextSibling
  }
}

/* ---- wiring ---- */

const pillGrid = document.querySelector<HTMLElement>('#pill .grid')
const pillLabel = document.querySelector<HTMLElement>('#pill .pill-label')
const rowsBox = document.querySelector<HTMLElement>('#popup-rows')
const stripGrids = [...document.querySelectorAll<HTMLElement>('#states .grid')]
const STRIP_STATES: SessionState[] = ['idle', 'running', 'waiting', 'error', 'done']

// The markup ships a static date as the no-JS fallback; this replaces it
// with today's whenever the script runs. A page whose whole pitch is "this
// is live, not a mock" should not be showing last quarter's date in its own
// top bar. Half a minute is finer than any reader will notice.
const clock = document.querySelector<HTMLElement>('.topbar .clock')
if (clock) {
  const paintClock = (): void => {
    clock.textContent = clockText(new Date())
  }
  paintClock()
  window.setInterval(paintClock, 30_000)
}

if (pillGrid && pillLabel && rowsBox) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // One representative still: the permission moment, mid-loop. The virtual
    // clock stays pinned at 9_500 forever — nothing here runs a timer — but
    // the Allow/Deny buttons `syncRows` wires are real, so clicking one must
    // still repaint. `render` is the only thing that does that, and it is
    // called solely from `store.subscribe`, never from a timer: reduced
    // motion means no animation, not no interactivity, and a click has to
    // produce exactly one synchronous repaint, not a ticking one.
    const store = storeAt(9_500)
    const render = (): void => {
      const sessions = store.list()
      const state = pillState(sessions)
      paint(pillGrid, state, 0)
      // Derived from pillState, like the animated branch below, rather than a
      // literal 'waiting': the timeline's permission window or pillState's
      // own precedence could move, and this is the one path a reduced-motion
      // viewer has no animation to cross-check against — it must not be able to
      // show one state's grid beside another state's word.
      pillLabel.textContent = `${sessions.length} · ${STATE_WORD[state]}`
      syncRows(rowsBox, () => store, 9_500)
    }
    store.subscribe(render)
    render()
    stripGrids.forEach((g, i) => {
      const state = STRIP_STATES[i]!
      paint(g, state, state === 'done' ? 300 : 0)
    })
  } else {
    let store = new SessionStore()
    let start = performance.now()
    let applied = 0

    const pill = animate(pillGrid, () => pillState(store.list()))
    store.subscribe(pill.poke)

    // The strip runs each state's loop forever; done replays its stagger with
    // a pause so the entry animation stays visible. It gets its own clock
    // origin, independent of `start`: the strip is conceptually unrelated to
    // the timeline demo above it, but `start` is reassigned every 30s when
    // the timeline loop restarts (see `drive` below) — sharing it would jump
    // all four strip animations' phase at every loop boundary and restart the
    // `done` stagger mid-flight. A fixed 100ms tick (rather than each state's
    // own tickIntervalMs) is kept deliberately: the strip is a decorative,
    // perpetual loop rather than a state machine reacting to real transitions,
    // and one shared timer driving four grids is simpler than juggling four
    // independently-scheduled ones for a visual effect tickIntervalMs was not
    // designed to drive standalone.
    const stripStart = performance.now()
    stripGrids.forEach((g, i) => {
      const state = STRIP_STATES[i]!
      if (state === 'error') {
        paint(g, state, 0)
        return
      }
      const tick = (): void => {
        const elapsed = performance.now() - stripStart
        paint(g, state, state === 'done' ? elapsed % 1_200 : elapsed)
        window.setTimeout(tick, 100)
      }
      tick()
    })

    const drive = (): void => {
      const t = performance.now() - start
      if (t >= LOOP_MS) {
        store = new SessionStore()
        store.subscribe(pill.poke)
        start = performance.now()
        applied = 0
        window.setTimeout(drive, 0)
        return
      }
      while (applied < TIMELINE.length && TIMELINE[applied]!.at <= t) {
        TIMELINE[applied]!.apply(store)
        applied += 1
      }
      const sessions = store.list()
      pillLabel.textContent = `${sessions.length} · ${STATE_WORD[pillState(sessions)]}`
      syncRows(rowsBox, () => store, t)
      window.setTimeout(drive, 100)
    }
    drive()
  }
}
