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
import type { Session, SessionState } from '../src/core/types.js'
import { LOOP_MS, TIMELINE, storeAt } from './timeline.js'

const AGENT_NAME: Record<Session['agent'], string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  antigravity: 'Antigravity',
}

const STATE_WORD: Record<SessionState, string> = {
  idle: 'idle',
  running: 'working',
  waiting: 'needs you',
  error: 'error',
  done: 'done',
}

/** Paint one 2×2 grid element from the real gridPose. */
function paint(grid: HTMLElement, state: SessionState, phase: number): void {
  const pose = gridPose(state, phase)
  grid.className = `grid state-${state}${pose.fill === 'accent' ? ' accent' : ''}`
  const blocks = grid.querySelectorAll<HTMLElement>('.block')
  pose.alpha.forEach((a, i) => {
    blocks[i]!.style.opacity = String(a)
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
  c.append(img, el('span', 'chip-name', AGENT_NAME[agent]))
  return c
}

function row(s: Session, now: number, store: SessionStore): HTMLElement {
  const r = el('div', `row state-${s.state}`)
  const head = el('div', 'row-head')
  head.append(chip(s.agent), el('span', 'project', s.project))
  const meta = el('span', 'meta')
  if (s.tasks && s.tasks.length > 0) {
    const { completed, total } = summarize(s.tasks)
    meta.append(el('span', 'tasks-count', `${completed}/${total}`))
  }
  meta.append(el('span', 'elapsed', formatElapsed(now - s.startedAt)))
  head.append(meta)
  r.append(head)

  const a = activityText(s, now)
  r.append(el('div', `activity${a.hint ? ' hint' : ''}`, a.text))

  if (s.pendingPermission) {
    const controls = el('div', 'controls')
    const allow = el('button', 'allow', 'Allow')
    const deny = el('button', 'deny', 'Deny')
    // Both settle the demo the same way the extension's clearPending does —
    // the point is showing that the controls are the real ones.
    allow.onclick = (): void => store.clearPending(s.key)
    deny.onclick = (): void => store.clearPending(s.key)
    controls.append(allow, deny)
    r.append(controls)
  }

  if (s.agent === 'claude' && s.tasks && s.tasks.length > 0) {
    const list = el('ul', 'tasks')
    for (const t of s.tasks) {
      const mark = t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▸' : '○'
      list.append(el('li', `task ${t.status}`, `${mark} ${t.subject}`))
    }
    r.append(list)
  }
  return r
}

function renderRows(container: HTMLElement, store: SessionStore, now: number): void {
  container.replaceChildren(...store.list().map((s) => row(s, now, store)))
}

/* ---- wiring ---- */

const pillGrid = document.querySelector<HTMLElement>('#pill .grid')
const pillLabel = document.querySelector<HTMLElement>('#pill .pill-label')
const rowsBox = document.querySelector<HTMLElement>('#popup-rows')
const stripGrids = [...document.querySelectorAll<HTMLElement>('#states .grid')]
const STRIP_STATES: SessionState[] = ['idle', 'running', 'waiting', 'error', 'done']

if (pillGrid && pillLabel && rowsBox) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // One representative still: the permission moment, mid-loop.
    const store = storeAt(9_500)
    paint(pillGrid, pillState(store.list()), 0)
    pillLabel.textContent = `${store.list().length} · needs you`
    renderRows(rowsBox, store, 9_500)
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
    // a pause so the entry animation stays visible.
    stripGrids.forEach((g, i) => {
      const state = STRIP_STATES[i]!
      if (state === 'error') {
        paint(g, state, 0)
        return
      }
      const tick = (): void => {
        const elapsed = performance.now() - start
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
      renderRows(rowsBox, store, t)
      window.setTimeout(drive, 100)
    }
    drive()
  }
}
