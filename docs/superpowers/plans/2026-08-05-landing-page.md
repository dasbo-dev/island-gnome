# Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-page site on GitHub Pages whose hero runs the extension's real `src/core` state machine in the browser.

**Architecture:** A pure, testable demo timeline (`site/timeline.ts`) feeds synthetic `AgentEvent`s through a real `SessionStore`; a small DOM renderer (`site/demo.ts`) plays the role the shell layer plays in the extension, painting the pill from `gridPose` and rows from `store.list()`. Static HTML/CSS carries all content with no JS required; the demo is enhancement.

**Tech Stack:** Plain HTML/CSS/TypeScript, esbuild (already in repo), vitest (already in repo), GitHub Actions → GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-08-05-landing-page-design.md`

## Global Constraints

- `src/core` is consumed **read-only**. No task modifies anything under `src/`.
- No framework, no static-site generator, no analytics, no webfonts, no video. Font stack: `"Cantarell", "Adwaita Sans", system-ui, sans-serif`.
- State colours must match `stylesheet.css` exactly: waiting `#f5c211`, error `#e01b24`, done `#57e389`. Base (idle/running) fill is the panel foreground `#f6f5f4`.
- Site output goes to `dist-site/`, never into the extension's `dist/`.
- Demo loop length: 30 000 virtual ms, virtual clock starts at 0. No `Date.now()` in `site/timeline.ts` — timestamps are the step's `at` value, so the module stays pure and testable.
- GitHub repo URL used in the page and README: `https://github.com/fsevenm/dasbo-island`. Site URL: `https://fsevenm.github.io/dasbo-island/`.
- The extension's tests and typecheck must keep passing: `npm test`, `npm run typecheck`.
- The spec names the extensions.gnome.org listing as the primary call-to-action. No listing exists yet, so the primary button points at the page's own `#install` section and the copy says the listing is under review. Swapping in the EGO URL is a one-line change, tracked in "Manual follow-ups" at the end of this plan.

---

### Task 1: Demo timeline (pure) + test

**Files:**
- Create: `site/timeline.ts`
- Test: `test/site/timeline.test.ts`

**Interfaces:**
- Consumes (from `src/core`, all existing):
  - `class SessionStore { apply(e: AgentEvent): void; setPending(key, p: PendingPermission): void; clearPending(key): void; setTasks(key, tasks: AgentTask[]): void; list(): Session[]; get(key): Session | undefined; subscribe(fn): () => void }` — `src/core/store.ts`
  - `pillState(sessions: Session[]): SessionState` — `src/core/pillState.ts`
  - `sessionKey(agent: AgentId, sessionId: string): string`, types `AgentEvent`, `AgentId`, `EventKind` — `src/core/types.ts`
  - `AgentTask` — `src/core/tasks.ts`
- Produces (Task 3 relies on these exact names):
  - `export const LOOP_MS = 30_000`
  - `export interface TimelineStep { at: number; apply: (store: SessionStore) => void }`
  - `export const TIMELINE: TimelineStep[]` — sorted ascending by `at`, all `at < LOOP_MS`
  - `export const KEYS: Record<AgentId, string>` — session keys for the three demo sessions
  - `export function storeAt(t: number): SessionStore` — fresh store with every step `at <= t` applied

- [ ] **Step 1: Write the failing test**

Create `test/site/timeline.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { KEYS, LOOP_MS, TIMELINE, storeAt } from '../../site/timeline.js'
import { pillState } from '../../src/core/pillState.js'
import { activityText } from '../../src/core/activity.js'
import { summarize } from '../../src/core/tasks.js'

describe('demo timeline', () => {
  it('is sorted and fits inside the loop', () => {
    for (let i = 1; i < TIMELINE.length; i++) {
      expect(TIMELINE[i]!.at).toBeGreaterThanOrEqual(TIMELINE[i - 1]!.at)
    }
    expect(TIMELINE.at(-1)!.at).toBeLessThan(LOOP_MS)
  })

  it('walks the pill through every state the page claims to show', () => {
    const at = (t: number) => pillState(storeAt(t).list())
    expect(at(100)).toBe('idle')
    expect(at(500)).toBe('running')
    expect(at(9_500)).toBe('waiting')
    expect(at(13_100)).toBe('running')
    expect(at(16_500)).toBe('error')
    expect(at(19_500)).toBe('running')
    expect(at(27_000)).toBe('done')
  })

  it('shows all three agents at once mid-loop', () => {
    expect(storeAt(6_000).list().map((s) => s.agent).sort())
      .toEqual(['antigravity', 'claude', 'codex'])
  })

  it('holds a permission the row can describe', () => {
    const s = storeAt(10_000).get(KEYS.claude)!
    expect(s.pendingPermission?.tool).toBe('Bash')
    expect(activityText(s, 10_000).text).toContain('waiting for you · Bash')
  })

  it('finishes the plan it shows', () => {
    const s = storeAt(23_000).get(KEYS.claude)!
    expect(summarize(s.tasks!)).toEqual({ completed: 6, total: 6 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/site/timeline.test.ts`
Expected: FAIL — cannot resolve `../../site/timeline.js` (module does not exist).

- [ ] **Step 3: Write the implementation**

Create `site/timeline.ts`:

```ts
/**
 * The demo's script: one 30-second loop of synthetic agent events fed through
 * the extension's real SessionStore. Pure — no clock, no DOM — so the vitest
 * suite can pin the exact pill-state sequence the landing page claims to show.
 */
import { SessionStore } from '../src/core/store.js'
import { sessionKey } from '../src/core/types.js'
import type { AgentEvent, AgentId, EventKind } from '../src/core/types.js'
import type { AgentTask } from '../src/core/tasks.js'

/** One full pass of the demo, in virtual ms. The virtual clock starts at 0. */
export const LOOP_MS = 30_000

export interface TimelineStep {
  /** Virtual ms into the loop at which this step runs. */
  at: number
  apply: (store: SessionStore) => void
}

const IDS: Record<AgentId, string> = {
  claude: 'demo-claude',
  codex: 'demo-codex',
  antigravity: 'demo-agy',
}
const CWDS: Record<AgentId, string> = {
  claude: '/home/you/projects/rocket',
  codex: '/home/you/projects/website',
  antigravity: '/home/you/projects/blog',
}
const PIDS: Record<AgentId, number> = { claude: 4242, codex: 4243, antigravity: 4244 }

export const KEYS: Record<AgentId, string> = {
  claude: sessionKey('claude', IDS.claude),
  codex: sessionKey('codex', IDS.codex),
  antigravity: sessionKey('antigravity', IDS.antigravity),
}

function ev(agent: AgentId, kind: EventKind, at: number, extra?: Partial<AgentEvent>): TimelineStep {
  const e: AgentEvent = {
    agent,
    kind,
    sessionId: IDS[agent],
    cwd: CWDS[agent],
    pid: PIDS[agent],
    // Deliberately no agentStartedAt: the store's lineage seeds
    // conversationStartedAt from `agentStartedAt ?? ts`, so supplying 0 would
    // pin every session's startedAt to 0 and every row would show the same
    // elapsed time. Omitting it makes each session's clock start at its own
    // first event.
    ts: at,
    ...extra,
  }
  return { at, apply: (store) => store.apply(e) }
}

const SUBJECTS = [
  'Reproduce the flaky launch test',
  'Pin telemetry parser to a fixture',
  'Fix the countdown off-by-one',
  'Run the full test suite',
  'Update the changelog',
  'Tag v1.2.0',
] as const

/** First `completed` subjects done, next `inProgress` in progress, rest pending. */
function plan(completed: number, inProgress: number): AgentTask[] {
  return SUBJECTS.map((subject, i) => ({
    id: String(i + 1),
    subject,
    status: i < completed ? 'completed' : i < completed + inProgress ? 'in_progress' : 'pending',
  }))
}

function tasks(at: number, completed: number, inProgress: number): TimelineStep {
  return { at, apply: (store) => store.setTasks(KEYS.claude, plan(completed, inProgress)) }
}

export const TIMELINE: TimelineStep[] = [
  ev('claude', 'session-start', 0),
  ev('claude', 'prompt-submit', 400),
  ev('claude', 'tool-start', 1_200, { tool: 'Read', detail: 'src/launch/countdown.ts' }),
  tasks(1_600, 0, 1),
  ev('claude', 'tool-end', 2_200),
  ev('codex', 'session-start', 2_600),
  ev('codex', 'prompt-submit', 3_000),
  ev('claude', 'tool-start', 3_400, { tool: 'Bash', detail: 'npm test -- countdown' }),
  tasks(4_200, 1, 1),
  ev('antigravity', 'session-start', 5_000),
  ev('antigravity', 'prompt-submit', 5_400),
  ev('claude', 'tool-end', 6_000),
  ev('codex', 'tool-start', 6_400, { tool: 'Bash', detail: 'vitest run' }),
  tasks(7_000, 2, 1),
  ev('claude', 'tool-start', 7_600, { tool: 'Edit', detail: 'src/launch/countdown.ts' }),
  ev('claude', 'tool-end', 8_600),
  {
    at: 9_000,
    apply: (store) =>
      store.setPending(KEYS.claude, {
        id: 'perm-1',
        tool: 'Bash',
        detail: 'git push origin main',
        deadline: 0,
        queued: 0,
      }),
  },
  { at: 13_000, apply: (store) => store.clearPending(KEYS.claude) },
  tasks(13_400, 4, 1),
  ev('codex', 'tool-end', 15_000),
  ev('antigravity', 'error', 16_000, { detail: 'hook payload rejected' }),
  ev('antigravity', 'session-end', 19_000),
  ev('codex', 'turn-end', 21_000),
  tasks(22_000, 6, 0),
  ev('claude', 'turn-end', 22_400),
  ev('claude', 'notification', 23_200, { detail: 'Ready to publish — waiting on you' }),
  ev('claude', 'session-end', 25_000),
  ev('codex', 'session-end', 26_500),
]

/** A fresh store with every step at or before `t` applied. */
export function storeAt(t: number): SessionStore {
  const store = new SessionStore()
  for (const step of TIMELINE) if (step.at <= t) step.apply(store)
  return store
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/site/timeline.test.ts`
Expected: PASS, 5 tests.

Why each waypoint holds, if a failure needs debugging: at 100 only `session-start` has run → `idle`. 400 `prompt-submit` → `running`. 9 000 `setPending` → `waiting` (pending permission wins outright in `pillState`). 13 000 `clearPending` settles to `running` (no event arrived during the hold, so `deferredState` is undefined). 16 000 antigravity `error` outranks running. 19 000 antigravity `session-end` → that session `done`, worst of the rest is `running`. 26 500 all three done → `done`.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all existing tests still pass; typecheck clean (the test program pulls `site/timeline.ts` in through the import — it is pure TS with no DOM usage, so Node types suffice).

- [ ] **Step 6: Commit**

```bash
git add site/timeline.ts test/site/timeline.test.ts
git commit -m "feat(site): demo timeline driven through the real SessionStore"
```

---

### Task 2: Static page — `site/index.html`, `site/site.css`, build step

**Files:**
- Create: `site/index.html`
- Create: `site/site.css`
- Modify: `build.mjs` (append site step at end)

**Interfaces:**
- Produces (Task 3's renderer queries these exact hooks):
  - `#pill .grid` and `#pill .pill-label` — the top-bar pill
  - `#popup-rows` — container whose children the demo replaces
  - `#states .grid` — exactly five, in order idle/running/waiting/error/done
  - Every `.grid` contains exactly four `.block` children in chase order: top-left, top-right, bottom-right, bottom-left
- Consumes: `src/icons/{claude,codex,antigravity}.svg`, copied to `dist-site/icons/`

- [ ] **Step 1: Write `site/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dasbo Island — your coding agents, on the GNOME top bar</title>
<meta name="description" content="A GNOME Shell extension that keeps every live Claude Code, Codex, and Antigravity session in the top bar — status at a glance, permissions answered inline, one click back to the terminal.">
<link rel="stylesheet" href="site.css">
</head>
<body>

<header class="topbar">
  <span class="activities">Activities</span>
  <span class="clock">Tue Aug 5 14:32</span>
  <span id="pill" class="pill">
    <span class="grid state-running">
      <span class="block" style="opacity:.6"></span><span class="block" style="opacity:1"></span><span class="block" style="opacity:.3"></span><span class="block" style="opacity:.3"></span>
    </span>
    <span class="pill-label">3 · working</span>
  </span>
</header>

<main>

<section class="hero">
  <h1>Your coding agents, on the top&nbsp;bar.</h1>
  <p class="sub">Dasbo Island is a GNOME Shell extension that keeps every live Claude&nbsp;Code, Codex, and Antigravity session in the top bar — status at a glance, permission prompts answered inline, and one click back to the terminal that is running the work.</p>
  <p class="cta">
    <a class="button primary" href="#install">Install</a>
    <a class="button" href="https://github.com/fsevenm/dasbo-island">GitHub</a>
  </p>

  <div class="popup">
    <div id="popup-rows">
      <div class="row state-running">
        <div class="row-head">
          <span class="chip"><img src="icons/claude.svg" alt=""><span class="chip-name">Claude Code</span></span>
          <span class="project">rocket</span>
          <span class="meta"><span class="tasks-count">2/6</span><span class="elapsed">4m</span></span>
        </div>
        <div class="activity">Bash · npm test -- countdown</div>
      </div>
      <div class="row state-running">
        <div class="row-head">
          <span class="chip"><img src="icons/codex.svg" alt=""><span class="chip-name">Codex</span></span>
          <span class="project">website</span>
          <span class="meta"><span class="elapsed">2m</span></span>
        </div>
        <div class="activity">Bash · vitest run</div>
      </div>
      <div class="row state-idle">
        <div class="row-head">
          <span class="chip"><img src="icons/antigravity.svg" alt=""><span class="chip-name">Antigravity</span></span>
          <span class="project">blog</span>
          <span class="meta"><span class="elapsed">1m</span></span>
        </div>
        <div class="activity hint">idle</div>
      </div>
    </div>
  </div>
  <p class="demo-note">The pill and popup above are driven by the extension's real state machine — <code>src/core</code> bundled for the browser, not a mock.</p>
</section>

<section id="states">
  <h2>One glance says what every session needs.</h2>
  <div class="strip">
    <figure><span class="grid state-idle"><span class="block"></span><span class="block"></span><span class="block"></span><span class="block"></span></span><figcaption><strong>Resting</strong> — one block breathes</figcaption></figure>
    <figure><span class="grid state-running"><span class="block"></span><span class="block"></span><span class="block"></span><span class="block"></span></span><figcaption><strong>Working</strong> — a light runs clockwise</figcaption></figure>
    <figure><span class="grid state-waiting accent"><span class="block"></span><span class="block"></span><span class="block"></span><span class="block"></span></span><figcaption><strong>Needs you</strong> — all four blink</figcaption></figure>
    <figure><span class="grid state-error accent"><span class="block"></span><span class="block" style="opacity:.16"></span><span class="block"></span><span class="block" style="opacity:.16"></span></span><figcaption><strong>Error</strong> — a diagonal pair holds</figcaption></figure>
    <figure><span class="grid state-done accent"><span class="block"></span><span class="block"></span><span class="block"></span><span class="block"></span></span><figcaption><strong>Done</strong> — a green stagger</figcaption></figure>
  </div>
</section>

<section id="features">
  <h2>Built for the moment an agent needs a human.</h2>
  <div class="cards">
    <div class="card"><h3>Answer permissions from the bar</h3><p>An agent asking to run a command blinks the pill. Allow or deny from the popup — no hunting through terminal windows for the one that is stuck.</p></div>
    <div class="card"><h3>Jump back to the session</h3><p>Click a session row and land in the window the session started in.</p></div>
    <div class="card"><h3>Watch the plan tick over</h3><p>Agents that keep a task list show progress — 3/10 beside the clock — and the expander opens the list itself, one line per task.</p></div>
    <div class="card"><h3>Hear when you're needed</h3><p>Permission requests, questions, notifications, and finishes each have a cue from your desktop's own sound theme. A fullscreen window doesn't mute them — that is when the pill is least visible and the sound most useful.</p></div>
    <div class="card"><h3>Know when it's waiting</h3><p>When an agent sits idle on your input, its row says so and the popup opens on its own — and closes again a few seconds later.</p></div>
  </div>
</section>

<section id="agents">
  <h2>Supported agents</h2>
  <table>
    <thead><tr><th>Agent</th><th>Status</th><th>Permission gating</th></tr></thead>
    <tbody>
      <tr><td>Claude Code</td><td>Verified against 17 real hook-payload fixtures</td><td>Yes</td></tr>
      <tr><td>Antigravity CLI</td><td>Verified against 12 real hook-payload fixtures</td><td>Unverified — treat as best-effort</td></tr>
      <tr><td>Codex CLI</td><td>Verified against 6 real hook-payload fixtures; needs a one-time trust approval in Codex's own TUI</td><td>Notify-only</td></tr>
    </tbody>
  </table>
  <p class="fine">Statuses are honest, not aspirational — the details live in the <a href="https://github.com/fsevenm/dasbo-island#supported-agents">README</a>.</p>
</section>

<section id="failopen">
  <h2>Fail-open, guaranteed.</h2>
  <p>The hook helper exits 0 with empty stdout on every error path. If the island is disabled, crashed, or never installed, your agents behave exactly as they would without it — a session can never hang on this extension.</p>
</section>

<section id="install">
  <h2>Install</h2>
  <p>Requires GNOME Shell 46, X11 or Wayland. The extensions.gnome.org listing is under review — until it lands, install from source:</p>
  <pre><code>git clone https://github.com/fsevenm/dasbo-island.git
cd dasbo-island &amp;&amp; make install
gnome-extensions enable dasbo-island@ayubaswad.gmail.com</code></pre>
  <p class="fine">Then open the preferences and install hooks for each agent you use:<br><code>gnome-extensions prefs dasbo-island@ayubaswad.gmail.com</code></p>
</section>

</main>

<footer>
  <p>GPL-3.0-or-later · Inspired by <a href="https://github.com/Octane0411/open-vibe-island">open-vibe-island</a> · <a href="https://github.com/fsevenm/dasbo-island">GitHub</a></p>
</footer>

<script type="module" src="demo.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `site/site.css`**

```css
/* Dasbo Island landing page — a GNOME desktop at night.
   State colours mirror stylesheet.css exactly:
   waiting #f5c211, error #e01b24, done #57e389, base fill #f6f5f4. */

* { box-sizing: border-box; margin: 0; }

:root {
  --fg: #f6f5f4;
  --fg-dim: #b8b4b0;
  --bg: #1c1f26;
  --surface: #2e3138;
  --line: rgba(255, 255, 255, 0.08);
  --blue: #3584e4;
}

body {
  font-family: "Cantarell", "Adwaita Sans", system-ui, sans-serif;
  color: var(--fg);
  background: radial-gradient(ellipse at 50% -20%, #2c3a4f 0%, var(--bg) 60%);
  min-height: 100vh;
}

a { color: #62a0ea; }

/* ---- fake top bar ---- */
.topbar {
  position: sticky; top: 0; z-index: 10;
  display: flex; align-items: center; justify-content: space-between;
  height: 34px; padding: 0 12px;
  background: rgba(0, 0, 0, 0.85);
  font-size: 0.85rem; font-weight: 700;
}
.pill {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 3px 11px; border-radius: 99px;
  background: rgba(255, 255, 255, 0.1);
}
.pill-label { font-size: 0.8rem; font-weight: 700; }

/* ---- the 2×2 grid ---- */
.grid {
  display: inline-grid;
  grid-template-columns: repeat(2, 1fr);
  grid-template-areas: "tl tr" "bl br";
  gap: 2px; width: 14px; height: 14px;
  color: var(--fg);
}
/* Chase order in markup is tl, tr, br, bl — matches GridPose.alpha. */
.grid .block:nth-child(1) { grid-area: tl; }
.grid .block:nth-child(2) { grid-area: tr; }
.grid .block:nth-child(3) { grid-area: br; }
.grid .block:nth-child(4) { grid-area: bl; }
.block { background: currentColor; border-radius: 1.5px; }
.grid.accent.state-waiting { color: #f5c211; }
.grid.accent.state-error   { color: #e01b24; }
.grid.accent.state-done    { color: #57e389; }

/* ---- hero ---- */
main { max-width: 780px; margin: 0 auto; padding: 0 20px; }
.hero { padding: 64px 0 24px; text-align: center; }
.hero h1 { font-size: clamp(2rem, 6vw, 3.2rem); line-height: 1.1; }
.hero .sub { max-width: 620px; margin: 20px auto 0; color: var(--fg-dim); font-size: 1.1rem; line-height: 1.5; }
.cta { margin: 28px 0; display: flex; gap: 12px; justify-content: center; }
.button {
  display: inline-block; padding: 10px 22px; border-radius: 8px;
  background: rgba(255, 255, 255, 0.1); color: var(--fg);
  text-decoration: none; font-weight: 700;
}
.button.primary { background: var(--blue); }
.demo-note { margin-top: 14px; color: var(--fg-dim); font-size: 0.85rem; }
.demo-note code { color: var(--fg); }

/* ---- popup ---- */
.popup {
  width: min(440px, 100%); margin: 8px auto 0; padding: 8px;
  background: var(--surface); border: 1px solid var(--line); border-radius: 16px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55);
  text-align: left; font-size: 0.9rem;
}
.row { padding: 8px 10px; border-radius: 10px; }
.row + .row { margin-top: 2px; }
.row-head { display: flex; align-items: center; gap: 8px; }
.chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 8px; border-radius: 99px;
  background: rgba(127, 127, 127, 0.18); font-size: 0.78rem;
}
.chip img { width: 13px; height: 13px; }
.project { font-weight: 700; }
.meta { margin-left: auto; display: inline-flex; gap: 10px; color: var(--fg-dim); font-size: 0.8rem; }
.activity { margin: 4px 0 0 2px; color: var(--fg-dim); }
.activity.hint { opacity: 0.6; font-style: italic; }
.row.state-error .activity { color: #e01b24; }
.controls { display: flex; gap: 8px; margin-top: 8px; }
.controls button {
  flex: 1; padding: 6px 0; border: 0; border-radius: 8px;
  font: inherit; font-weight: 700; color: var(--fg); cursor: pointer;
}
.controls .allow { background: var(--blue); }
.controls .deny { background: rgba(255, 255, 255, 0.08); }
.tasks { list-style: none; margin: 8px 0 0; padding: 0 0 0 4px; font-size: 0.82rem; }
.tasks .task { padding: 1px 0; color: var(--fg-dim); }
.tasks .task.completed { opacity: 0.55; }
.tasks .task.in_progress { color: var(--fg); }

/* ---- content sections ---- */
section { padding: 48px 0; border-top: 1px solid var(--line); }
.hero + #states, .hero { border-top: 0; }
h2 { font-size: 1.6rem; margin-bottom: 24px; text-align: center; }
.strip { display: flex; flex-wrap: wrap; gap: 20px; justify-content: center; }
.strip figure { text-align: center; width: 128px; }
.strip .grid { width: 40px; height: 40px; gap: 5px; }
.strip .block { border-radius: 4px; }
.strip figcaption { margin-top: 10px; font-size: 0.82rem; color: var(--fg-dim); }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
.card { background: rgba(255, 255, 255, 0.04); border: 1px solid var(--line); border-radius: 12px; padding: 18px; }
.card h3 { font-size: 1rem; margin-bottom: 8px; }
.card p { color: var(--fg-dim); font-size: 0.9rem; line-height: 1.5; }
#agents table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
#agents th, #agents td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); }
#agents th { color: var(--fg-dim); font-weight: 700; }
.fine { margin-top: 12px; color: var(--fg-dim); font-size: 0.85rem; text-align: center; }
#failopen p { max-width: 560px; margin: 0 auto; text-align: center; color: var(--fg-dim); line-height: 1.6; }
#install pre {
  background: #14161b; border: 1px solid var(--line); border-radius: 10px;
  padding: 16px; overflow-x: auto; font-size: 0.88rem;
}
footer { padding: 32px 20px 48px; text-align: center; color: var(--fg-dim); font-size: 0.85rem; }
```

- [ ] **Step 3: Extend `build.mjs`**

Append at the end of `build.mjs` (after the hooks copy, before the final `console.log`):

```js
// ---- landing page (dist-site/, deployed to GitHub Pages; see site/) ----
await rm('dist-site', { recursive: true, force: true })
await mkdir('dist-site', { recursive: true })
await cp('site/index.html', 'dist-site/index.html')
await cp('site/site.css', 'dist-site/site.css')
await cp('src/icons', 'dist-site/icons', { recursive: true })
```

- [ ] **Step 4: Build and verify**

Run: `node build.mjs && ls dist-site dist-site/icons`
Expected: `index.html  site.css  icons` and `antigravity.svg  claude.svg  codex.svg`. `dist/` unchanged.

Optional visual check: `python3 -m http.server -d dist-site 8080` and open `http://localhost:8080` — full page renders with static pill and popup; a 404 for `demo.js` in the console is expected until Task 3.

- [ ] **Step 5: Run the suite**

Run: `npm test && npm run typecheck`
Expected: PASS (nothing TypeScript-visible changed).

- [ ] **Step 6: Commit**

```bash
git add site/index.html site/site.css build.mjs
git commit -m "feat(site): static landing page and dist-site build step"
```

---

### Task 3: Live demo renderer — `site/demo.ts` + site typecheck + bundle

**Files:**
- Create: `site/demo.ts`
- Create: `tsconfig.site.json`
- Modify: `package.json` (typecheck script)
- Modify: `build.mjs` (bundle demo.js into the site step)

**Interfaces:**
- Consumes: everything Task 1 produces (`LOOP_MS`, `TIMELINE`, `KEYS`, `storeAt`), plus from `src/core`: `SessionStore`, `pillState`, `gridPose(state, phaseMs): GridPose`, `tickIntervalMs(state, phaseMs): number`, `activityText(session, now): { text, hint }`, `formatElapsed(ms)`, `summarize(tasks)`, types `Session`, `SessionState`.
- Consumes DOM hooks from Task 2: `#pill .grid`, `#pill .pill-label`, `#popup-rows`, `#states .grid` (five, in order idle/running/waiting/error/done), four `.block` per grid.
- Produces: `dist-site/demo.js` (browser ESM bundle).

- [ ] **Step 1: Create `tsconfig.site.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    // Browser, not GNOME: the ambient gnome-shell types declare `global` in a
    // way that has nothing to do with a web page, and the DOM lib is needed
    // here and nowhere else in the repo.
    "types": [],
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["site/**/*.ts"]
}
```

- [ ] **Step 2: Update the typecheck script in `package.json`**

Replace the `typecheck` line with:

```json
"typecheck": "tsc --noEmit -p tsconfig.json; s1=$?; tsc --noEmit -p tsconfig.test.json; s2=$?; tsc --noEmit -p tsconfig.site.json; s3=$?; exit $((s1 + s2 + s3))"
```

- [ ] **Step 3: Write `site/demo.ts`**

```ts
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
```

- [ ] **Step 4: Add the bundle to `build.mjs`**

In the site step added by Task 2, insert between `mkdir` and the first `cp`:

```js
await build({
  ...common,
  platform: 'browser',
  external: [],
  minify: true,
  sourcemap: false,
  entryPoints: ['site/demo.ts'],
  outfile: 'dist-site/demo.js',
})
```

- [ ] **Step 5: Typecheck and build**

Run: `npm run typecheck && node build.mjs && ls dist-site`
Expected: typecheck clean across all three programs; `demo.js  icons  index.html  site.css`.

- [ ] **Step 6: Verify in a browser**

Run: `python3 -m http.server -d dist-site 8080`
Open `http://localhost:8080`. Expected, over one 30 s loop: pill breathes (idle) → chase runs while rows show tools → at ~9 s pill blinks yellow, Claude row shows "waiting for you · Bash · git push origin main" with Allow/Deny (clicking either resumes early) → at ~16 s red diagonal, Antigravity row reads the error → at ~26.5 s green stagger, all rows done → loop restarts. Claude row shows `n/6` climbing and the open task list. No console errors.

- [ ] **Step 7: Run the full suite**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add site/demo.ts tsconfig.site.json package.json build.mjs
git commit -m "feat(site): live demo renderer on the real core state machine"
```

---

### Task 4: Pages workflow + README

**Files:**
- Create: `.github/workflows/site.yml`
- Modify: `README.md` (site link near top; dev note in Development)

**Interfaces:**
- Consumes: `node build.mjs` emitting `dist-site/` (Tasks 2–3).
- Produces: automatic deploy of `dist-site/` to GitHub Pages on every push to master/main.

- [ ] **Step 1: Write `.github/workflows/site.yml`**

```yaml
name: site

on:
  push:
    branches: [master, main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
      - run: node build.mjs
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist-site

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Update `README.md`**

After the opening paragraph (line 4) and before the "Inspired by" paragraph, add:

```markdown
**[See the pill run live →](https://fsevenm.github.io/dasbo-island/)** — the
demo on that page is the extension's real `src/core` state machine, bundled
for the browser.
```

In the Development section, after the `tools/fake-agent.js perm` line, add:

```markdown
`node build.mjs` also writes the landing page to `dist-site/`; preview it with
`python3 -m http.server -d dist-site 8080`. Pushes to master deploy it to
GitHub Pages via `.github/workflows/site.yml`.
```

- [ ] **Step 3: Validate the workflow file parses**

Run: `node -e "const y=require('fs').readFileSync('.github/workflows/site.yml','utf8'); console.log(y.includes('deploy-pages') ? 'ok' : 'missing deploy step')"`
Expected: `ok`. (Real validation happens on the first push; the workflow is the standard actions/deploy-pages pattern.)

- [ ] **Step 4: Full suite one last time**

Run: `npm test && npm run typecheck && node build.mjs`
Expected: PASS, `dist-site/` complete.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/site.yml README.md
git commit -m "feat(site): deploy dist-site to GitHub Pages on push"
```

---

## Manual follow-ups (outside this plan, for the human)

1. Create the GitHub repo `fsevenm/dasbo-island` and push (no `origin` remote exists locally yet).
2. Repo Settings → Pages → Source: **GitHub Actions**. First push then deploys the site.
3. Submit the extension to extensions.gnome.org. When the listing is live, change the hero's primary button `href="#install"` to the EGO URL and add an EGO link in `#install`.
4. Custom domain, when chosen: add a `CNAME` file to `dist-site` output (one `cp` line in build.mjs) and point DNS at GitHub Pages.
