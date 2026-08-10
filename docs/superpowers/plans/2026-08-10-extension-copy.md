# Extension Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 31 findings of the DIS-9 extension copy audit — every string the extension puts in front of a user — and add source-scanning tests that stop the same drift reopening.

**Architecture:** Three structural changes carry the findings that exist in two places at once: a pure `src/core/vocabulary.ts` for strings with more than one consumer, a `permissions` field on `CatalogEntry`, and a `welcome-shown` setting for the first-run notification. Pure message-building moves into `src/core/` so it can be unit-tested — `src/shell/*` and `src/prefs*` need a running GNOME Shell and cannot be. Everything else is an edit at the site the audit names.

**Tech Stack:** TypeScript, GJS / GNOME Shell 46, libadwaita (`Adw`), GTK 4, GSettings/GSchema XML, esbuild, Vitest.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-10-extension-copy-design.md`. **Audit:** `docs/copy-audit-extension-2026-08-10.md`.
- **`src/core/` must not import `gi://` or `resource://`.** `test/core/purity.test.ts` enforces this. New pure modules go in `src/core/`; anything touching GTK/St/Adw goes in `src/shell/` or `src/prefs/`.
- **Spelling is en-US.** `Behavior`, `License`. Never `Behaviour`, `Licence`.
- **Apostrophes in prose are curly:** `’`, not `'`. Applies to TypeScript string literals and to gschema `<description>` text.
- **The word `pill` never appears in a user-facing string.** The top-bar indicator is **the island**; the per-row tag is **the agent chip**. Internal identifiers (`dasbo-pill-label`, `pillState`, `test/core/pillState.test.ts`) are deliberately left alone.
- **The session-state word for `running` is `thinking`.** The island shows `thinking`, the row placeholder shows `thinking…`.
- **Run from the worktree root:** `/home/fsevenm/projects/dasbo-island/.claude/worktrees/extension-copy`, branch `feat/extension-copy`.
- **Test command:** `npx vitest run <path>` for one file, `npm test` for all. **Typecheck:** `npm run typecheck`.
- Every task ends with a commit. Commit messages are written in normal English, not caveman.

---

### Task 1: The shared vocabulary module and the state words (E3, E4-state)

The island says `working` and the row beneath it says `thinking…` for the same session in the same state. One table now feeds both. The island label is pinned at 8em for `100 · waiting` (13 chars); `100 · thinking` is 14, so the rule widens.

**Files:**
- Create: `src/core/vocabulary.ts`
- Create: `test/core/vocabulary.test.ts`
- Modify: `src/shell/island.ts:35-41` (delete local `STATE_WORD`, import it)
- Modify: `src/core/activity.ts:53-58` (comment), `src/core/activity.ts:117-120`
- Modify: `stylesheet.css:30-35`
- Modify: `test/shell/noEllipsis.test.ts` (add the width guard)

**Interfaces:**
- Consumes: `SessionState` from `src/core/types.js`.
- Produces:
  - `STATE_WORD: Record<SessionState, string>` — the island's word per state.
  - `STATE_PHRASE: Record<SessionState, string>` — the spoken form, used by Task 2.
  - `NO_SESSIONS: string` — `'No sessions'`, used by Task 2.
  - `activityPlaceholder(state: SessionState): string` — the row's fallback text.

- [ ] **Step 1: Write the failing test**

Create `test/core/vocabulary.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { STATE_WORD, STATE_PHRASE, NO_SESSIONS, activityPlaceholder } from '../../src/core/vocabulary.js'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

describe('the shared vocabulary', () => {
  it('gives every session state one word and one spoken phrase', () => {
    for (const state of ['idle', 'running', 'waiting', 'done', 'error'] as const) {
      expect(STATE_WORD[state], state).toBeTruthy()
      expect(STATE_PHRASE[state], state).toBeTruthy()
    }
  })

  it('says thinking for a running session, on the island and on the row', () => {
    expect(STATE_WORD.running).toBe('thinking')
    expect(activityPlaceholder('running')).toBe('thinking…')
  })

  it('marks the no-session case as no sessions, not as an idle session', () => {
    expect(NO_SESSIONS).toBe('No sessions')
    expect(NO_SESSIONS).not.toBe(STATE_WORD.idle)
  })

  it('falls back to the bare state word for every state but running', () => {
    expect(activityPlaceholder('idle')).toBe('idle')
    expect(activityPlaceholder('done')).toBe('done')
    expect(activityPlaceholder('error')).toBe('error')
  })
})

// The defect this file exists to prevent: two files each naming the states, and
// drifting. A quoted 'working' anywhere in src is that drift coming back.
describe('no source file names a session state on its own', () => {
  it('has no quoted "working" left in src', () => {
    const offenders = walk('src').filter((f) => /['"]working['"]/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })

  // Only the absence of a second table is asserted, not the presence of the
  // import: Task 2 replaces island.ts's use of STATE_WORD with islandLabel(),
  // after which the file legitimately imports neither.
  it('leaves the state table as the only place the words are written', () => {
    const island = readFileSync('src/shell/island.ts', 'utf8')
    expect(island).not.toContain('const STATE_WORD')
    expect(island).not.toMatch(/running:\s*['"]/)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/core/vocabulary.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/vocabulary.js"`.

- [ ] **Step 3: Write the module**

Create `src/core/vocabulary.ts`:

```ts
import type { SessionState } from './types.js'

/**
 * Every user-facing string with more than one consumer, and nothing else.
 *
 * A string shown in exactly one place stays at its widget, where it can be
 * read beside the code that shows it. What lives here is the copy that used to
 * be written down twice and drifted: the island said "working" while the row
 * beneath it said "thinking…" for one session in one state.
 *
 * Pure by construction — `src/core` may not import gi:// or resource://
 * (see test/core/purity.test.ts), which is what lets the shell, the
 * preferences process and the tests all read the same table.
 */

/** The word the island's label carries for each state. */
export const STATE_WORD: Record<SessionState, string> = {
  idle: 'idle',
  running: 'thinking',
  waiting: 'waiting',
  error: 'error',
  done: 'done',
}

/**
 * The same states spoken aloud, for the island's accessible_name. Separate from
 * STATE_WORD because a screen reader gets the sentence a sighted user infers
 * from the layout: "waiting" on its own does not say who is being waited on.
 */
export const STATE_PHRASE: Record<SessionState, string> = {
  idle: 'idle',
  running: 'thinking',
  waiting: 'waiting for you',
  error: 'errored',
  done: 'finished',
}

/** The island's label and accessible name when there are no sessions at all. */
export const NO_SESSIONS = 'No sessions'

/**
 * The session row's activity text when nothing more specific is known.
 *
 * `running` takes an ellipsis because the row dims it as a placeholder
 * (`Activity.hint`) and the ellipsis is what marks it as one; the island's
 * label carries no ellipsis because it is not standing in for anything.
 */
export function activityPlaceholder(state: SessionState): string {
  return state === 'running' ? `${STATE_WORD.running}…` : STATE_WORD[state]
}
```

- [ ] **Step 4: Run the test again**

Run: `npx vitest run test/core/vocabulary.test.ts`
Expected: the first four assertions PASS; the last two still FAIL — `island.ts` still declares `const STATE_WORD` and still holds a quoted `'working'`.

- [ ] **Step 5: Rewire `island.ts`**

In `src/shell/island.ts`, delete lines 35-41 (the local `const STATE_WORD` block) and add the import beside the other `../core/` imports at the top of the file:

```ts
import { STATE_WORD } from '../core/vocabulary.js'
```

- [ ] **Step 6: Rewire `activity.ts`**

In `src/core/activity.ts`, add to the imports at the top:

```ts
import { activityPlaceholder } from './vocabulary.js'
```

Replace lines 117-120:

```ts
  if (session.state === 'running') return { text: activityPlaceholder('running'), hint: true }
  if (session.state === 'idle') return { text: activityPlaceholder('idle'), hint: true }
  if (session.state === 'done') return { text: activityPlaceholder('done'), hint: false }
  return { text: activityPlaceholder('error'), hint: false }
```

The last line stays a catch-all returning the error placeholder for any state that is not `running`/`idle`/`done` — `waiting` included. That behaviour is deliberate and documented in the function's own comment; do not add a `waiting` branch.

Then fix the stale comment at lines 56-58, which still names the old word and the old home. Replace those three lines with:

```
 * There is deliberately no branch that prints `session.state`. The island and
 * this function read one table (`core/vocabulary.ts`), so a row falling back to
 * the raw word can no longer make the same session read two ways at once.
```

- [ ] **Step 7: Widen the island label**

In `stylesheet.css`, replace lines 30-35 with:

```css
/* Fixed so the island never resizes the top bar. 8.5em fits the widest realistic
   content, "100 · thinking"; anything longer ellipsizes (see island.ts). */
.dasbo-pill-label {
  font-size: 0.9em;
  width: 8.5em;
}
```

The selector keeps its name: `dasbo-pill-label` is an internal identifier, and renaming it would churn the stylesheet, the shell code and three tests without changing a character the user reads.

- [ ] **Step 8: Guard the width**

Append to the `describe` block in `test/shell/noEllipsis.test.ts`, before its closing `})`:

```ts
  // The island's state word is the longest thing on the label, and the label is
  // a fixed width — so a stylesheet edit is one careless line away from
  // clipping "thinking" at three-digit session counts. 8.5em is sized on
  // "100 · thinking"; a narrower rule is a regression, a wider one is fine.
  it('keeps the island label wide enough for its longest state word', () => {
    const css = readFileSync('stylesheet.css', 'utf8')
    const rule = css.match(/\.dasbo-pill-label\s*\{[^}]*\}/)?.[0] ?? ''
    const width = Number(rule.match(/width:\s*([\d.]+)em/)?.[1] ?? 0)
    expect(width).toBeGreaterThanOrEqual(8.5)
  })
```

- [ ] **Step 9: Run the tests and the typecheck**

Run: `npx vitest run test/core/vocabulary.test.ts test/shell/noEllipsis.test.ts test/core/activity.test.ts test/core/pillState.test.ts`
Expected: PASS. If `test/core/activity.test.ts` fails on the literal `'thinking…'`, it is asserting the same string this task keeps — read the failure before changing the test.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/core/vocabulary.ts src/core/activity.ts src/shell/island.ts stylesheet.css test/core/vocabulary.test.ts test/shell/noEllipsis.test.ts
git commit -m "fix(copy): say thinking in one place, and read it from one table

The island said working while the row beneath it said thinking… for one
session in one state. Both now read core/vocabulary.ts, and a test fails on
a quoted 'working' coming back. The label widens to 8.5em because
100 · thinking is one character longer than the 100 · waiting it was sized
for."
```

---

### Task 2: The island's label and its accessible name (E24, E25)

The island's accessible name is the fixed string `Dasbo Island`; the live state — `3 · waiting` — is never announced, and the `·` reads aloud as "middle dot". Separately, the zero-session label says `idle`, which is a *session* state, claimed for a case where no session exists.

**Files:**
- Create: `src/core/islandLabel.ts`
- Create: `test/core/islandLabel.test.ts`
- Modify: `src/shell/island.ts:832-840` (the label branch in `refresh`)

**Interfaces:**
- Consumes: `STATE_WORD`, `STATE_PHRASE`, `NO_SESSIONS` from Task 1; `SessionState` from `src/core/types.js`.
- Produces: `islandLabel(count: number, state: SessionState): { text: string; spoken: string }`.

- [ ] **Step 1: Write the failing test**

Create `test/core/islandLabel.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { islandLabel } from '../../src/core/islandLabel.js'

describe('the island label', () => {
  it('says no sessions rather than calling a session idle', () => {
    expect(islandLabel(0, 'idle')).toEqual({ text: 'No sessions', spoken: 'No sessions' })
  })

  it('renders the count and the state word for the visible label', () => {
    expect(islandLabel(3, 'waiting').text).toBe('3 · waiting')
    expect(islandLabel(2, 'running').text).toBe('2 · thinking')
  })

  it('spells the label out for a screen reader, without the separator', () => {
    expect(islandLabel(3, 'waiting').spoken).toBe('3 sessions, waiting for you')
    expect(islandLabel(2, 'running').spoken).toBe('2 sessions, thinking')
    expect(islandLabel(1, 'done').spoken).toBe('1 session, finished')
  })

  it('never leaves the middle dot in the spoken form', () => {
    for (const state of ['idle', 'running', 'waiting', 'done', 'error'] as const) {
      expect(islandLabel(4, state).spoken).not.toContain('·')
    }
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/core/islandLabel.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/islandLabel.js"`.

- [ ] **Step 3: Write the module**

Create `src/core/islandLabel.ts`:

```ts
import type { SessionState } from './types.js'
import { NO_SESSIONS, STATE_PHRASE, STATE_WORD } from './vocabulary.js'

/** What the island's label shows, and what a screen reader hears instead. */
export interface IslandLabel {
  text: string
  spoken: string
}

/**
 * Both forms from one call, so they cannot disagree. The visible label is
 * compact because it sits in the top bar; the spoken form is the same fact as
 * a sentence, because "3 · waiting" is read aloud as "three middle dot
 * waiting", and because an accessible name that never changes tells a screen
 * reader user nothing the extension exists to tell them.
 */
export function islandLabel(count: number, state: SessionState): IslandLabel {
  if (count === 0) return { text: NO_SESSIONS, spoken: NO_SESSIONS }
  const noun = count === 1 ? 'session' : 'sessions'
  return {
    text: `${count} · ${STATE_WORD[state]}`,
    spoken: `${count} ${noun}, ${STATE_PHRASE[state]}`,
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/core/islandLabel.test.ts`
Expected: PASS.

- [ ] **Step 5: Use it in the island**

In `src/shell/island.ts`, add to the vocabulary import added in Task 1's Step 5 — it becomes two imports:

```ts
import { STATE_WORD } from '../core/vocabulary.js'
import { islandLabel } from '../core/islandLabel.js'
```

If `STATE_WORD` has no remaining use in the file after this edit, drop that import rather than leaving it unused — `npm run typecheck` will say so.

Replace the label branch (currently `island.ts:832-840`, the `if (count === 0) { this._label.text = 'idle' } else { … }` block) with:

```ts
      // One call decides both, so the label a sighted user reads and the name a
      // screen reader hears can never drift apart — and the accessible name is
      // no longer the fixed string set in the constructor, which said nothing
      // about the state the island exists to report.
      const label = islandLabel(count, state)
      this._label.text = label.text
      this.accessible_name = label.spoken
```

Leave `super(0.5, 'Dasbo Island')` at line 112 as it is: it is the menu role's name and the correct value before the first `refresh()`.

- [ ] **Step 6: Run the tests and the typecheck**

Run: `npm test`
Expected: PASS. `npm run typecheck` — no errors.

- [ ] **Step 7: Commit**

```bash
git add src/core/islandLabel.ts test/core/islandLabel.test.ts src/shell/island.ts
git commit -m "fix(a11y): announce the island's live state, and stop calling nothing idle

The island's accessible name was the fixed string Dasbo Island, so the
state it exists to report was never spoken, and the visible separator read
aloud as middle dot. Both forms now come from one call. The zero-session
label says No sessions rather than borrowing a session state for a case
where no session exists."
```

---

### Task 3: The store description, and the gettext domain (E1, E31)

`metadata.json`'s description promises inline permission approval without naming an agent, and Codex cannot do it — this is the pre-install pitch on extensions.gnome.org. The same file declares a gettext domain for translations that do not exist and strings that are not wrapped for extraction.

**Files:**
- Modify: `metadata.json`
- Create: `test/core/metadata.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. This task is self-contained.

- [ ] **Step 1: Write the failing test**

Create `test/core/metadata.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const metadata = JSON.parse(readFileSync('metadata.json', 'utf8')) as Record<string, unknown>

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

describe('the store description', () => {
  const description = String(metadata.description)

  // extensions.gnome.org truncates the description in its list view at roughly
  // 150 characters. A claim qualified after the cut is an unqualified claim.
  it('fits inside the list-view truncation', () => {
    expect(description.length).toBeLessThanOrEqual(150)
  })

  it('names the agents rather than promising everything for all of them', () => {
    expect(description).toContain('Claude Code')
    expect(description).toContain('Codex')
  })

  // docs/limitations.md § "Codex has no permission gate": every Codex hook is
  // installed notify-only, so an unscoped promise of inline approval is false.
  it('scopes inline permission approval to the agent that has it', () => {
    const inline = description.indexOf('inline')
    if (inline === -1) return
    expect(description.slice(0, inline)).toContain('Claude Code permission')
  })
})

describe('the gettext domain', () => {
  it('is absent while no string is wrapped for extraction', () => {
    const wrapped = walk('src').some((f) => /\bgettext\b|\b_\(/.test(readFileSync(f, 'utf8')))
    if (wrapped) return
    expect(metadata).not.toHaveProperty('gettext-domain')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/core/metadata.test.ts`
Expected: FAIL — the description does not contain `Claude Code`, and `gettext-domain` is present.

- [ ] **Step 3: Edit `metadata.json`**

Set the description to exactly this (146 characters) and delete the `"gettext-domain"` line:

```json
  "description": "Live Claude Code and Codex sessions in the top bar: status at a glance, one click back to the terminal, and Claude Code permission prompts answered inline.",
```

Removing the field is safe: `grep -rn gettext src/` finds no call, and `build.mjs:6` lists `gettext` only as an esbuild external, which is a no-op when nothing imports it. Leave `build.mjs` alone.

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/core/metadata.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the JSON still parses and the build still runs**

Run: `node -e "JSON.parse(require('fs').readFileSync('metadata.json','utf8')); console.log('ok')"`
Expected: `ok`

Run: `npm run build`
Expected: completes with no error.

- [ ] **Step 6: Commit**

```bash
git add metadata.json test/core/metadata.test.ts
git commit -m "fix(copy): name the agents in the store description, drop the empty gettext domain

The description promised inline permission approval with no agent named,
which reads as covering Codex — whose hooks are installed notify-only. It
now names both agents and scopes the claim, inside the ~150 characters
e.g.o. shows in list view. The gettext-domain field declared translations
that do not exist; it returns with po/."
```

---

### Task 4: Agent capability on the catalog (E2)

Nothing in the UI tells a Codex user their hooks are notify-only. A user installs them, waits for an Allow/Deny that never arrives, and concludes the extension is broken. The capability becomes data on the catalog so the preferences row can say it.

**Files:**
- Modify: `src/core/agentCatalog.ts`
- Modify: `test/core/agentCatalog.test.ts`

**Interfaces:**
- Consumes: `AgentId` from `src/core/types.js`.
- Produces:
  - `type AgentPermissions = 'inline' | 'notify-only'`
  - `CatalogEntry`'s supported variant: `{ id: AgentId; status: 'supported'; permissions: AgentPermissions }`
  - Task 5 reads `permissions` off the entry; Task 6 passes the entry into the row builder.

- [ ] **Step 1: Write the failing test**

Append to `test/core/agentCatalog.test.ts`, inside the existing `describe('the agent catalog', …)` block:

```ts
  // docs/limitations.md § "Codex has no permission gate": Codex's PreToolUse
  // hook rejects an allow/ask decision outright, so every Codex hook is
  // installed notify-only. That is a fact about the agent, so it lives on the
  // catalog rather than being restated wherever a row happens to be built.
  it('records what each supported agent can actually do', () => {
    for (const entry of AGENT_CATALOG) {
      if (entry.status !== 'supported') continue
      expect(['inline', 'notify-only'], entry.id).toContain(entry.permissions)
    }
  })

  it('marks Claude Code inline and Codex notify-only', () => {
    const byId = Object.fromEntries(
      AGENT_CATALOG.filter((e) => e.status === 'supported').map((e) => [e.id, e.permissions])
    )
    expect(byId).toEqual({ claude: 'inline', codex: 'notify-only' })
  })
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/core/agentCatalog.test.ts`
Expected: FAIL — TypeScript reports `Property 'permissions' does not exist`, or the assertion sees `undefined`.

- [ ] **Step 3: Add the field**

In `src/core/agentCatalog.ts`, add the type above `CatalogEntry`:

```ts
/**
 * What the agent's hooks can do once installed.
 *
 * `inline` means the agent will wait for a decision from the island and honour
 * it. `notify-only` means it will not: Codex's PreToolUse hook rejects an
 * allow/ask decision outright (docs/limitations.md § "Codex has no permission
 * gate"), so its hooks are installed for notifications alone. This is on the
 * catalog because the preferences page is where a user decides to install, and
 * it is the last moment the difference can be told to them.
 */
export type AgentPermissions = 'inline' | 'notify-only'
```

Change the supported variant of `CatalogEntry`:

```ts
export type CatalogEntry =
  | { id: AgentId; status: 'supported'; permissions: AgentPermissions }
  | { id: string; displayName: string; status: 'coming-soon' }
```

And the two supported rows of `AGENT_CATALOG`:

```ts
  { id: 'claude', status: 'supported', permissions: 'inline' },
  { id: 'codex', status: 'supported', permissions: 'notify-only' },
```

Extend the doc comment above `CatalogEntry` with a sentence explaining the new field, after the paragraph about display names:

```
 * A `supported` entry also records whether the agent honours an inline
 * permission decision. A `coming-soon` entry does not: this build installs no
 * hooks for it, so there is no capability to report yet.
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run test/core/agentCatalog.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: no errors. If `src/prefs.ts` fails to compile, it is because the catalog loop now narrows differently — leave that to Task 6 only if the error is in code Task 6 rewrites; otherwise fix it here by keeping the existing `entry.id` usage.

- [ ] **Step 5: Commit**

```bash
git add src/core/agentCatalog.ts test/core/agentCatalog.test.ts
git commit -m "feat(agents): record on the catalog what each agent's hooks can do

Codex hooks are installed notify-only and nothing in the UI said so, so a
Codex user waits for an Allow that never arrives. The capability is now
data on the catalog; the preferences row reads it next."
```

---

### Task 5: Pure text for the agent rows and their toasts (E2-text, E8-text, E9, E10, E11)

Five findings are one problem: the preferences page builds its subtitles and toasts inline, in a file that needs a running GTK and cannot be unit-tested. The text moves to a pure module and gets tests; Task 6 wires it in.

**Files:**
- Create: `src/core/install/messages.ts`
- Create: `test/core/install/messages.test.ts`

**Interfaces:**
- Consumes: `InstallState` from `src/core/install/plan.js`; `AgentPermissions` from Task 4.
- Produces:
  - `installRowText(state, permissions, configPath): { subtitle: string; tooltip: string | null }`
  - `installToast(opts: ToastOpts): string` where
    `ToastOpts = { displayName: string; agent: string; verb: 'install' | 'remove'; outcome: 'noop' | 'done' | 'failed'; configPath: string; home: string }`
  - `shortenHome(path: string, home: string): string`

- [ ] **Step 1: Write the failing test**

Create `test/core/install/messages.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { installRowText, installToast, shortenHome } from '../../../src/core/install/messages.js'

const CLAUDE_PATH = '/home/ada/.claude/settings.json'
const CODEX_PATH = '/home/ada/.codex/hooks.json'
const HOME = '/home/ada'

describe('shortenHome', () => {
  it('replaces the home directory with a tilde', () => {
    expect(shortenHome(CLAUDE_PATH, HOME)).toBe('~/.claude/settings.json')
  })

  it('leaves a path outside home alone', () => {
    expect(shortenHome('/etc/dasbo.json', HOME)).toBe('/etc/dasbo.json')
  })

  it('leaves the path alone when home is empty', () => {
    expect(shortenHome(CLAUDE_PATH, '')).toBe(CLAUDE_PATH)
  })
})

describe('the agent row subtitle', () => {
  it('says hooks are installed, and nothing more for an agent that can answer', () => {
    expect(installRowText('installed', 'inline', CLAUDE_PATH)).toEqual({
      subtitle: 'Hooks installed',
      tooltip: null,
    })
  })

  it('warns that a notify-only agent will never show a permission prompt', () => {
    expect(installRowText('installed', 'notify-only', CODEX_PATH).subtitle).toBe(
      'Hooks installed · notifications only, no permission prompts'
    )
  })

  it('carries the same warning on a stale row, which is still an installed row', () => {
    const { subtitle } = installRowText('stale', 'notify-only', CODEX_PATH)
    expect(subtitle).toContain('Hooks need updating')
    expect(subtitle).toContain('notifications only, no permission prompts')
  })

  // absent and unreadable are about a file that is missing or broken. The
  // capability note would compete with the thing the user has to fix first.
  it('leaves the capability note off a row with no working file', () => {
    expect(installRowText('absent', 'notify-only', CODEX_PATH).subtitle).toBe('Not installed')
    expect(installRowText('unreadable', 'notify-only', CODEX_PATH).subtitle)
      .not.toContain('notifications only')
  })

  it('says what is wrong, why it matters and what to do when the file will not parse', () => {
    expect(installRowText('unreadable', 'inline', CLAUDE_PATH).subtitle).toBe(
      'Can’t read settings.json — it isn’t valid JSON. Fix the file, then reopen this page.'
    )
  })

  // An Adw.ActionRow subtitle ellipsizes in the middle, which is exactly where
  // the filename is. The tooltip has no such limit.
  it('puts the full path in the tooltip, and only there', () => {
    expect(installRowText('unreadable', 'inline', CLAUDE_PATH).tooltip).toBe(CLAUDE_PATH)
    expect(installRowText('installed', 'inline', CLAUDE_PATH).tooltip).toBeNull()
  })

  it('names the file the agent actually keeps its hooks in', () => {
    expect(installRowText('unreadable', 'notify-only', CODEX_PATH).subtitle).toContain('hooks.json')
  })
})

describe('the install toasts', () => {
  const base = { displayName: 'Claude Code', agent: 'claude', configPath: CLAUDE_PATH, home: HOME }

  it('reports a no-op as a state, not as a bug', () => {
    expect(installToast({ ...base, verb: 'install', outcome: 'noop' }))
      .toBe('Claude Code hooks are already up to date.')
    expect(installToast({ ...base, verb: 'remove', outcome: 'noop' }))
      .toBe('No Claude Code hooks to remove.')
  })

  it('confirms a completed install and a completed removal', () => {
    expect(installToast({ ...base, verb: 'install', outcome: 'done' }))
      .toBe('Claude Code hooks installed')
    expect(installToast({ ...base, verb: 'remove', outcome: 'done' }))
      .toBe('Claude Code hooks removed')
  })

  it('says what to check when the write fails, and never shows the exception', () => {
    expect(installToast({ ...base, verb: 'install', outcome: 'failed' }))
      .toBe('Couldn’t install Claude Code hooks — check that ~/.claude/settings.json is writable.')
  })

  // Codex will not run a newly written hook until it has been trusted, and that
  // review only happens in its own TUI. Without this the install silently
  // never fires.
  it('tells a Codex installer about the trust review, on one line, with no markup', () => {
    const toast = installToast({
      displayName: 'Codex CLI', agent: 'codex', configPath: CODEX_PATH, home: HOME,
      verb: 'install', outcome: 'done',
    })
    expect(toast).toBe('Codex CLI hooks installed — run codex once to approve them')
    expect(toast).not.toContain('`')
    expect(toast.length).toBeLessThanOrEqual(80)
  })

  it('leaves the trust note off a Codex removal and off every other agent', () => {
    expect(installToast({
      displayName: 'Codex CLI', agent: 'codex', configPath: CODEX_PATH, home: HOME,
      verb: 'remove', outcome: 'done',
    })).toBe('Codex CLI hooks removed')
    expect(installToast({ ...base, verb: 'install', outcome: 'done' })).not.toContain('approve')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/core/install/messages.test.ts`
Expected: FAIL — `Failed to resolve import ".../src/core/install/messages.js"`.

- [ ] **Step 3: Write the module**

Create `src/core/install/messages.ts`:

```ts
import type { AgentPermissions } from '../agentCatalog.js'
import type { InstallState } from './plan.js'

/**
 * Every string the Agents page shows about an agent's hooks.
 *
 * Pure, and here rather than in prefs.ts, because prefs.ts needs a running GTK
 * and cannot be unit-tested — which is how a raw exception, a bare file path
 * and a "nothing to install" reached users in the first place.
 *
 * All of these follow the same shape on a failure path: what happened, why it
 * matters, and what to do next.
 */

const NOTIFY_ONLY_NOTE = ' · notifications only, no permission prompts'

/** What a row says, and what its tooltip holds when the subtitle cannot fit it. */
export interface RowText {
  subtitle: string
  /** Null when the subtitle is complete on its own. */
  tooltip: string | null
}

/** `/home/ada/.claude/settings.json` → `~/.claude/settings.json`. */
export function shortenHome(path: string, home: string): string {
  if (!home || !path.startsWith(`${home}/`)) return path
  return `~${path.slice(home.length)}`
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function installRowText(
  state: InstallState,
  permissions: AgentPermissions,
  configPath: string
): RowText {
  // Appended only to the two states that mean hooks are on disk. On `absent`
  // there is nothing to be notify-only about, and on `unreadable` the note
  // would compete with the broken file the user has to fix first.
  const note = permissions === 'notify-only' ? NOTIFY_ONLY_NOTE : ''
  switch (state) {
    case 'installed':
      return { subtitle: `Hooks installed${note}`, tooltip: null }
    // Deliberately vague about the cause: stale covers an out-of-date hook
    // path, a duplicated entry, a missing event, a command under the wrong
    // event, and a codex file still holding the old named-hook entry.
    case 'stale':
      return {
        subtitle: `Hooks need updating — they don’t match what this version installs${note}`,
        tooltip: null,
      }
    case 'unreadable':
      // The full path goes to the tooltip: an Adw.ActionRow subtitle
      // ellipsizes in the middle, which is where the filename is.
      return {
        subtitle: `Can’t read ${basename(configPath)} — it isn’t valid JSON. Fix the file, then reopen this page.`,
        tooltip: configPath,
      }
    case 'absent':
      return { subtitle: 'Not installed', tooltip: null }
    default: {
      // A new InstallState member must be given text here rather than
      // silently rendering as "Not installed".
      const unhandled: never = state
      return unhandled
    }
  }
}

export interface ToastOpts {
  displayName: string
  agent: string
  verb: 'install' | 'remove'
  outcome: 'noop' | 'done' | 'failed'
  configPath: string
  home: string
}

export function installToast(o: ToastOpts): string {
  if (o.outcome === 'noop') {
    return o.verb === 'install'
      ? `${o.displayName} hooks are already up to date.`
      : `No ${o.displayName} hooks to remove.`
  }
  if (o.outcome === 'failed') {
    // The exception itself goes to the journal, not here: an Adw.Toast is one
    // line and clips, and a GLib error string carries a path, an errno and no
    // advice. This says the one thing the user can act on.
    return `Couldn’t ${o.verb} ${o.displayName} hooks — check that ${shortenHome(o.configPath, o.home)} is writable.`
  }
  if (o.verb === 'remove') return `${o.displayName} hooks removed`
  // Codex parses a newly written hook but will not run it until it has been
  // trusted, and that review only happens in its own TUI — so an install that
  // succeeded here is still one step short of firing.
  const trust = o.agent === 'codex' ? ' — run codex once to approve them' : ''
  return `${o.displayName} hooks installed${trust}`
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/core/install/messages.test.ts`
Expected: PASS, all 15 assertions.

- [ ] **Step 5: Commit**

```bash
git add src/core/install/messages.ts test/core/install/messages.test.ts
git commit -m "feat(prefs): move the agent row and toast text somewhere testable

prefs.ts needs a running GTK, so none of its strings had a test — which is
how a raw exception, a bare file path and a 'nothing to install' shipped.
The text is now pure and covered: every failure path says what happened,
why it matters and what to do, the full config path moves to a tooltip
where it is not middle-ellipsized, and the Codex trust note fits one line
with no backticks."
```

---

### Task 6: Wire the new text into the preferences rows (E8, E9, E10, E11)

The pure text from Task 5 replaces the inline strings, the raw exception goes to the journal instead of the toast, and the row learns to carry a tooltip.

**Files:**
- Modify: `src/prefs.ts:193-203` (the catalog loop), `:215-313` (`_agentRow` and `run`)

**Interfaces:**
- Consumes: `installRowText`, `installToast` (Task 5); `CatalogEntry.permissions` (Task 4).
- Produces: `_agentRow(entry, env, settings, window, refreshAll)` — the first parameter is now the whole catalog entry, not the bare `id`. Task 7 edits the same method's labels.

- [ ] **Step 1: Pass the entry into the row builder**

In `src/prefs.ts`, add to the imports:

```ts
import { installRowText, installToast } from './core/install/messages.js'
```

In `_agentsPage`, change the loop body's supported branch from `this._agentRow(entry.id, …)` to:

```ts
      const { row, refresh } = this._agentRow(entry, env, settings, window, refreshAll)
```

Change `_agentRow`'s signature and its first line:

```ts
  private _agentRow(
    entry: Extract<CatalogEntry, { status: 'supported' }>,
    env: InstallEnv,
    settings: Gio.Settings,
    window: Adw.PreferencesWindow,
    refreshAll: () => void
  ): { row: Adw.ActionRow; refresh: () => void } {
    const id = entry.id
    const row = new Adw.ActionRow({ title: adapters[id].displayName })
```

Add `CatalogEntry` to the existing catalog import:

```ts
import { AGENT_CATALOG, type CatalogEntry } from './core/agentCatalog.js'
```

- [ ] **Step 2: Replace `describe` with the pure call**

Delete the whole local `describe` function (currently `prefs.ts:238-258`) and change `refresh` to set both the subtitle and the tooltip:

```ts
    const refresh = () => {
      // The switch is re-read here, not just at construction: enabled-agents
      // changes under this window — another prefs instance, gsettings, the
      // extension itself — and refresh() exists for exactly that. Assign only
      // on a real difference, so the notify::active handler is not woken to
      // write back the value we have just read.
      const isEnabled = settings.get_strv('enabled-agents').includes(id)
      if (enabled.active !== isEnabled) enabled.active = isEnabled

      const state = installState(id, env)
      const text = installRowText(state, entry.permissions, configPath(id, env))
      row.subtitle = text.subtitle
      // Cleared, not left behind: a row that recovers from `unreadable` would
      // otherwise keep a tooltip pointing at a problem that no longer exists.
      row.tooltip_text = text.tooltip ?? ''
      install.label = state === 'stale' ? 'Update hooks' : 'Install hooks'
      install.sensitive = state === 'absent' || state === 'stale'
      uninstall.sensitive = state === 'installed' || state === 'stale'
    }
```

- [ ] **Step 3: Replace the three toasts and send the exception to the journal**

Replace the whole body of `run` (currently `prefs.ts:276-303`) with:

```ts
    const run = (edits: ReturnType<typeof planInstall>, verb: 'install' | 'remove') => {
      const toast = (outcome: 'noop' | 'done' | 'failed') =>
        this._toast(
          window,
          installToast({
            displayName: adapters[id].displayName,
            agent: id,
            verb,
            outcome,
            configPath: configPath(id, env),
            home: env.home,
          })
        )
      try {
        if (edits.length === 0) {
          toast('noop')
          return
        }
        try {
          applyEdits(edits)
          toast('done')
        } catch (e) {
          // The toast says what the user can act on; the real error goes where
          // a bug report can find it. A GLib error string in a one-line toast
          // is a path, an errno and no advice, clipped.
          console.warn(`dasbo-island: ${verb} of ${id} hooks failed: ${e}`)
          toast('failed')
        }
      } finally {
        // Refresh every row, not just this one: all three read from disk, and
        // a row's state is derived entirely from those files. That's true
        // whether the write succeeded, failed, or turned out to be a no-op —
        // a no-op click usually means what's on disk no longer matches what
        // the row was showing, which is exactly when it needs re-reading.
        refreshAll()
      }
    }
```

The two `connect('clicked', …)` calls below it keep their `'install'` / `'remove'` arguments unchanged; they now typecheck against the narrowed `verb` parameter.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors. A complaint that `entry` is not assignable to the supported variant means the loop's `continue` for `coming-soon` was removed — restore it.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/prefs.ts
git commit -m "fix(prefs): stop showing users a raw exception and a bare file path

The row and toast text now comes from core/install/messages.ts, the
exception goes to the journal via console.warn, and the config path moves
to the row tooltip where it is readable in full. Install and Remove say
what they act on."
```

---

### Task 7: Preferences labels, groups and spelling (E4, E5, E6, E7, E26, E27, E28)

The window calls the top-bar object a "pill" and never defines it, mixes British and American spelling, files two non-permissions under `Permissions`, and carries three subtitles two to three times GNOME's usual length.

**Files:**
- Modify: `src/prefs.ts:49-103` (`_appearancePage`), `:105-169` (`_behaviourPage`), `:224` (switch tooltip), `:333` (coming-soon tooltip)

**Interfaces:**
- Consumes: nothing new.
- Produces: the final label strings Task 12 mirrors into the gschema. **Task 12 depends on these being exact.**

- [ ] **Step 1: Rewrite the Appearance page's strings**

In `_appearancePage`, apply all of these:

- The `Panel` group gains the caveat the `Panel box` subtitle was carrying:

```ts
    const group = new Adw.PreferencesGroup({
      title: 'Panel',
      description: 'Extensions that replace the top bar, such as Dash to Panel, decide where each box lands on screen.',
    })
```

- The `Panel box` row's subtitle shortens to one line:

```ts
    const position = new Adw.ComboRow({
      title: 'Panel box',
      subtitle: 'Where the island sits in the top bar',
      model: Gtk.StringList.new(['Left', 'Center', 'Right']),
    })
```

- The always-show row loses the word "pill":

```ts
    const alwaysShow = new Adw.SwitchRow({
      title: 'Always show the island',
      subtitle: 'Keep the island visible even when no agent session is active',
    })
```

- The `Session rows` group takes the chip caveat, and the chip row shortens:

```ts
    const rows = new Adw.PreferencesGroup({
      title: 'Session rows',
      description: 'A row whose mark is missing shows the name whatever this says.',
    })

    const chipDisplay = new Adw.ComboRow({
      title: 'Agent chip',
      subtitle: 'What the tag at the head of each row shows',
      model: Gtk.StringList.new(['Logo only', 'Logo and name', 'Name only']),
    })
```

- The comment above the `Session rows` group (currently `prefs.ts:81-83`) says "pill". Replace those three lines with:

```ts
    // Its own group rather than an addition to "Panel": that group is entirely
    // about where the island sits in the top bar, and the chip is inside the
    // popup. Filing it there would make the group's title a lie.
```

`Position within the box` is unchanged.

- [ ] **Step 2: Split the Behavior page's first group**

Rename the method and the page, and split `Permissions` in two. Replace the opening of `_behaviourPage` and its first group with:

```ts
  private _behaviorPage(settings: Gio.Settings): Adw.PreferencesPage {
    const page = new Adw.PreferencesPage({ title: 'Behavior', icon_name: 'preferences-system-symbolic' })
    const group = new Adw.PreferencesGroup({ title: 'Permissions' })
```

Keep `Permission timeout` and `Open the popup automatically` in that group, in that order, and delete `Question timeout` and `Keep finished sessions visible` from it. After `page.add(group)`, and before the `Notifications` group, insert:

```ts
    // Not under Permissions: a question is not a permission, and the linger
    // timer is about a session that has already finished. A user looking for
    // either of them does not look under Permissions.
    const sessions = new Adw.PreferencesGroup({ title: 'Sessions' })

    const questionTimeout = new Adw.SpinRow({
      title: 'Question timeout',
      subtitle: 'Seconds before an agent’s question falls through to its own picker. Zero waits indefinitely.',
      adjustment: new Gtk.Adjustment({ lower: 0, upper: 3600, step_increment: 15 }),
    })
    settings.bind('question-timeout', questionTimeout, 'value', 0)
    sessions.add(questionTimeout)

    const linger = new Adw.SpinRow({
      title: 'Keep finished sessions visible',
      subtitle: 'Seconds a completed session stays in the list',
      adjustment: new Gtk.Adjustment({ lower: 0, upper: 300, step_increment: 5 }),
    })
    settings.bind('done-linger', linger, 'value', 0)
    sessions.add(linger)

    page.add(sessions)
```

Update the call site at `prefs.ts:36`: `window.add(this._behaviorPage(settings))`.

- [ ] **Step 3: Shorten the sound subtitle**

The `Notifications` group takes the caveat:

```ts
    const notifications = new Adw.PreferencesGroup({
      title: 'Notifications',
      description: 'Sounds come from your desktop’s sound theme, and stay silent when system sounds are off.',
    })
```

and the row shortens to one line:

```ts
    const notificationSounds = new Adw.SwitchRow({
      title: 'Play a sound',
      subtitle: 'When an agent needs you, or finishes',
    })
```

- [ ] **Step 4: The two tooltips**

`prefs.ts:224` — the per-agent enable switch stops speaking in implementation terms:

```ts
    const enabled = new Gtk.Switch({
      valign: Gtk.Align.CENTER,
      tooltip_text: 'Show this agent’s sessions in the top bar',
    })
```

`prefs.ts:333` — the coming-soon switch's tooltip stops restating its own subtitle in a more negative register:

```ts
      tooltip_text: 'Not available in this release',
```

- [ ] **Step 5: The buttons**

In `_agentRow`, the two button constructions become:

```ts
    const install = new Gtk.Button({ label: 'Install hooks', valign: Gtk.Align.CENTER })
    const uninstall = new Gtk.Button({ label: 'Remove hooks', valign: Gtk.Align.CENTER })
```

In `_comingSoonRow`, the same two labels:

```ts
    const install = new Gtk.Button({ label: 'Install hooks', valign: Gtk.Align.CENTER, sensitive: false })
    const uninstall = new Gtk.Button({ label: 'Remove hooks', valign: Gtk.Align.CENTER, sensitive: false })
```

(Task 6 already set the `stale` label to `Update hooks` in `refresh`.)

- [ ] **Step 6: Check no "pill" survives and typecheck**

Run: `grep -n "pill" src/prefs.ts`
Expected: no output.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Run the suite**

Run: `npm test`
Expected: PASS. `test/core/prefsWindow.test.ts` sizes the window and does not assert on these strings; if it fails, read it before editing.

- [ ] **Step 8: Commit**

```bash
git add src/prefs.ts
git commit -m "fix(prefs): name the island, spell it en-US, and file the rows honestly

'Pill' appeared in preferences with no definition anywhere in the UI; the
top-bar object is the island and the per-row tag is the agent chip.
Behaviour becomes Behavior. The Permissions group no longer holds a
question timeout and a linger timer — those move to a Sessions group. Three
subtitles that wrapped to three lines are cut to one, with the caveats
moved up to their group descriptions where they belong."
```

---

### Task 8: The About page (E6-License, E12)

`Licence` is the last British spelling. When the browser fails to launch, the user gets a floating address with no sentence around it and no way to copy it — toast titles are not selectable.

**Files:**
- Modify: `src/prefs/about.ts:102` and `:225-233`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Fix the spelling**

`src/prefs/about.ts:102`:

```ts
  group.add(new Adw.ActionRow({ title: 'License', subtitle: ABOUT.license }))
```

- [ ] **Step 2: Copy the address and say so**

Add to the imports at the top of `src/prefs/about.ts`:

```ts
import Gdk from 'gi://Gdk'
```

Replace the `catch` block at `about.ts:225-233` with:

```ts
    } catch {
      // No browser, or a session that won't let us reach one. A toast title is
      // not selectable, so a bare address is something the user can read and
      // not use — put it on the clipboard and say that is where it went.
      const clipboard = Gdk.Display.get_default()?.get_clipboard()
      if (clipboard) {
        clipboard.set_text(uri)
        window.add_toast(new Adw.Toast({ title: 'Couldn’t open your browser. Copied the address to the clipboard.' }))
      } else {
        // No display to copy through, so the address itself is still the most
        // useful thing we have.
        window.add_toast(new Adw.Toast({ title: `Couldn’t open your browser — visit ${uri}` }))
      }
    }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors. `Gdk.Clipboard.set_text` is the string-typed setter and is present in GTK 4; if `@girs` does not expose it, the generic form is `clipboard.set_content(Gdk.ContentProvider.new_for_value(uri))`.

- [ ] **Step 4: Run the About tests**

Run: `npx vitest run test/prefs/aboutPage.test.ts test/prefs/aboutAssets.test.ts test/core/about.test.ts`
Expected: PASS. If `aboutPage.test.ts` asserts the string `Licence`, update the assertion to `License` — the test is mirroring the label, and en-US is the project constraint.

- [ ] **Step 5: Commit**

```bash
git add src/prefs/about.ts test/prefs/aboutPage.test.ts
git commit -m "fix(about): spell License en-US, and hand over an address the user can use

A failed browser launch showed a bare URL as a toast title, which is not
selectable — so the one thing the user needed was the one thing they could
not take. It now goes to the clipboard, with a sentence saying so, and
falls back to showing the address when no display is reachable."
```

---

### Task 9: The strings that leave the extension (E13, E14, E15)

Four fall-through reasons are printed into the user's terminal by the agent, and two of them are implementation vocabulary. Two more land in the model's context, where vagueness produces vague behaviour. And a jump failure reports itself as the fragment `no window`.

**Files:**
- Modify: `src/shell/island.ts:280`
- Modify: `src/core/permissions.ts:79, 121, 140, 180`
- Modify: `src/core/adapters/claude.ts:144, 153`
- Modify: `test/core/permissions.test.ts`, `test/core/adapters/` (whichever file asserts the reasons)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Find the tests that assert the current strings**

Run: `grep -rn "Unknown session\|Session reaped\|Timed out\|did not decide\|gave no answer\|no window" test/`
Expected: a list of assertions. Note them — each one is updated in the same step as its string, not left to fail.

- [ ] **Step 2: The jump failure**

`src/shell/island.ts:280` — the transient sits in the activity line where every other string is a fragment *about the agent*, so it says what was being looked for, in the same register as the neighbouring `waiting for you`:

```ts
      row.showTransient('couldn’t find its terminal window', until)
```

- [ ] **Step 3: The terminal-facing reasons**

In `src/core/permissions.ts`, these four literals. "Reaped" is implementation vocabulary and "Unknown session" reads as an accusation; all four now name the extension, because they appear in the agent's output with no other context saying where they came from.

| Line | New value |
| --- | --- |
| 79 | `'Dasbo Island didn’t recognise this session'` |
| 121 | `'Dasbo Island shutting down'` — unchanged |
| 140 | `'Dasbo Island lost track of this session'` |
| 180 | `'Dasbo Island timed out waiting for an answer'` |

- [ ] **Step 4: The reasons the model reads**

`src/core/adapters/claude.ts:144`:

```ts
          permissionDecisionReason: d.answer ?? 'The user closed Dasbo Island without answering — ask again here.',
```

`src/core/adapters/claude.ts:150-153` — the `ask` fall-through tells the model what to do next instead of only what did not happen:

```ts
    const defaultReason =
      d.kind === 'allow' ? 'Allowed from Dasbo Island'
      : d.kind === 'deny' ? 'Denied from Dasbo Island'
      : 'Dasbo Island timed out — ask the user here instead.'
```

`Allowed from Dasbo Island` and `Denied from Dasbo Island` are unchanged.

- [ ] **Step 5: Update the assertions found in Step 1**

Change each to the new string. Do not delete a test to make it pass.

- [ ] **Step 6: Run the suite and the typecheck**

Run: `npm test`
Expected: PASS.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/shell/island.ts src/core/permissions.ts src/core/adapters/claude.ts test/
git commit -m "fix(copy): stop printing implementation vocabulary into the user's terminal

Session reaped and Unknown session are fall-through reasons the agent
surfaces to the user, and neither is a sentence a user should have to
decode. The two reasons Claude reads back into its own context now say what
to do next rather than only what did not happen, and a failed jump names
what was being looked for."
```

---

### Task 10: A real empty state (E16)

`No active sessions` is a label, not an empty state: it gives what this is and neither why it is empty nor how to start. A user who has enabled the extension but installed no hooks sees exactly that string forever and is never told hooks exist.

**Files:**
- Create: `src/core/emptyState.ts`
- Create: `test/core/emptyState.test.ts`
- Modify: `src/shell/popupHeader.ts:60-85` (`EmptyRow`)
- Modify: `src/shell/island.ts` (a `setHooksProbe` handler, and the `new EmptyRow()` call at `:783`)
- Modify: `src/extension.ts` (inject the probe)
- Modify: `stylesheet.css` (a rule for the second line)

**Interfaces:**
- Consumes: `installState`, `configPath`, `InstallEnv` from `src/core/install/plan.js`; `AGENT_CATALOG` from Task 4; `readFileOrNull` from `src/shell/applyEdits.js`.
- Produces:
  - `emptyState(hooksInstalled: boolean): { title: string; detail: string }`
  - `Island.setHooksProbe(probe: () => boolean): void`
  - `new EmptyRow(hooksInstalled: boolean)`

- [ ] **Step 1: Write the failing test**

Create `test/core/emptyState.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { emptyState } from '../../src/core/emptyState.js'

describe('the popup empty state', () => {
  // The ux-copy empty-state shape: what this is, why it is empty, how to start.
  it('tells a user with hooks how a session gets here', () => {
    expect(emptyState(true)).toEqual({
      title: 'No active sessions',
      detail: 'Start Claude Code or Codex in a terminal and it’ll appear here.',
    })
  })

  // The whole point of the finding: a user who has never installed hooks was
  // shown "No active sessions" forever and never told hooks existed.
  it('tells a user with no hooks that hooks are the missing piece', () => {
    expect(emptyState(false)).toEqual({
      title: 'No agents connected',
      detail: 'Install hooks in Settings to get started.',
    })
  })

  it('always gives both lines', () => {
    for (const installed of [true, false]) {
      const state = emptyState(installed)
      expect(state.title.length).toBeGreaterThan(0)
      expect(state.detail.length).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/core/emptyState.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/emptyState.js"`.

- [ ] **Step 3: Write the module**

Create `src/core/emptyState.ts`:

```ts
/** The two lines the popup shows in place of session rows. */
export interface EmptyState {
  title: string
  /** Why the list is empty and what to do about it — dimmed beneath the title. */
  detail: string
}

/**
 * An empty state, not a label.
 *
 * The variant matters more than the wording: a user who has enabled the
 * extension but installed no hooks will never see a session no matter how long
 * they wait, and the old single line told them nothing about that. Splitting on
 * whether any agent has hooks is what turns this from a status into an
 * instruction.
 */
export function emptyState(hooksInstalled: boolean): EmptyState {
  return hooksInstalled
    ? {
        title: 'No active sessions',
        detail: 'Start Claude Code or Codex in a terminal and it’ll appear here.',
      }
    : {
        title: 'No agents connected',
        detail: 'Install hooks in Settings to get started.',
      }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/core/emptyState.test.ts`
Expected: PASS.

- [ ] **Step 5: Give `EmptyRow` two lines**

Replace `EmptyRow` in `src/shell/popupHeader.ts` (lines 60-85) with:

```ts
/**
 * Shown in place of the session rows while the store is empty.
 *
 * Takes the answer rather than working it out: reading the install state means
 * reading files, and a widget that reaches for its own dependencies is the
 * thing this file's neighbours are arranged to avoid.
 */
export const EmptyRow = GObject.registerClass(
  class EmptyRow extends PopupMenu.PopupBaseMenuItem {
    constructor(hooksInstalled: boolean) {
      super({ reactive: false, can_focus: false, style_class: 'dasbo-row' })
      const { title, detail } = emptyState(hooksInstalled)

      // The labels go in a box carrying the popup's fixed width, the way a
      // SessionRow's .dasbo-row-outer does. Without it this row is narrower
      // than the session rows and the popup visibly shrinks when the last
      // session ends.
      const outer = new St.BoxLayout({
        vertical: true,
        style_class: 'dasbo-empty-outer dasbo-fixed-width',
      })

      const titleLabel = new St.Label({
        text: title,
        style_class: 'dasbo-empty',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
      })
      // St's CSS engine doesn't reliably honour `opacity` (the .dasbo-empty
      // rule is kept for intent, but isn't load-bearing) — set the Clutter
      // actor property directly so the label actually reads as dimmed.
      // 178 == 0.7 * 255.
      titleLabel.opacity = 178

      const detailLabel = new St.Label({
        text: detail,
        style_class: 'dasbo-empty-detail',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
      })
      detailLabel.opacity = 140
      // The popup is a fixed 30em and this sentence is longer than the title,
      // so it wraps rather than ellipsizing — the same rule the task list and
      // the question panel follow.
      detailLabel.clutter_text.line_wrap = true
      detailLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR
      detailLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE

      outer.add_child(titleLabel)
      outer.add_child(detailLabel)
      this.add_child(outer)
    }
  }
)
```

Add the two imports this needs at the top of `src/shell/popupHeader.ts`:

```ts
import Pango from 'gi://Pango'
import { emptyState } from '../core/emptyState.js'
```

- [ ] **Step 6: Style the second line**

Append to `stylesheet.css`, beside the existing `.dasbo-empty` rule:

```css
/* The empty state's second line: smaller than the title it sits under, and
   the reason .dasbo-empty-outer is a vertical box. */
.dasbo-empty-detail {
  font-size: 0.9em;
  padding-top: 2px;
}
```

- [ ] **Step 7: Give the island a probe**

In `src/shell/island.ts`, add a field beside the other handler fields:

```ts
    private _hooksProbe: (() => boolean) | null = null
```

Add a setter beside `setPrefsHandler`:

```ts
    /**
     * How the empty state finds out whether any agent has hooks installed.
     * Injected rather than read here: it needs the extension's own path and the
     * file reader, and the island is a widget.
     */
    setHooksProbe(probe: () => boolean): void {
      this._hooksProbe = probe
    }
```

Change the construction at `island.ts:783`. Calling the probe here, rather than caching it, is what lets a user install hooks and reopen the popup to the other variant:

```ts
        this._emptyRow = new EmptyRow(this._hooksProbe?.() ?? true)
```

The `?? true` fallback keeps the old wording if no probe was ever set — the less alarming of the two, since claiming no agents are connected when we do not know is worse than the reverse.

- [ ] **Step 8: Inject it from the extension**

In `src/extension.ts`, add the imports:

```ts
import { installState, type InstallEnv } from './core/install/plan.js'
import { readFileOrNull } from './shell/applyEdits.js'
import { AGENT_CATALOG } from './core/agentCatalog.js'
```

and, beside `setPrefsHandler` at `extension.ts:77`:

```ts
    this._island.setHooksProbe(() => {
      const env: InstallEnv = {
        home: GLib.get_home_dir(),
        hookPath: `${this.path}/hooks/dasbo-hook`,
        existing: readFileOrNull,
      }
      // `stale` counts as connected: the hooks are on disk and firing, they
      // just don't match this version. Telling that user no agents are
      // connected would send them to install hooks they already have.
      return AGENT_CATALOG.some((entry) => {
        if (entry.status !== 'supported') return false
        const state = installState(entry.id, env)
        return state === 'installed' || state === 'stale'
      })
    })
```

- [ ] **Step 9: Typecheck and run the suite**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/core/emptyState.ts test/core/emptyState.test.ts src/shell/popupHeader.ts src/shell/island.ts src/extension.ts stylesheet.css
git commit -m "feat(popup): make the empty state say why it is empty

No active sessions gave a user with no hooks installed no way to learn that
hooks exist — they would have waited forever. The row now has two lines and
two variants, chosen by a probe the extension injects, so a user who has
never installed anything is pointed at Settings instead."
```

---

### Task 11: The first-run notification (E17)

Enable the extension with no session running and nothing appears in the top bar at all. Every string this audit covers sits behind a UI the user has no reason to know is there.

**Files:**
- Modify: `schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml` (add `welcome-shown`)
- Create: `src/shell/welcome.ts`
- Modify: `src/extension.ts` (call it from `enable()`)

**Interfaces:**
- Consumes: `Gio.Settings`, `Main` from the shell.
- Produces: `maybeShowWelcome(settings: Gio.Settings, onOpenSettings: () => void): void`. Task 12 gives the new key its summary and description.

- [ ] **Step 1: Add the setting**

In `schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml`, before `</schema>`:

```xml
    <key name="welcome-shown" type="b">
      <default>false</default>
      <summary>First-run notification shown</summary>
      <description>Set once the one-time welcome notification has been posted. Reset it to see the notification again.</description>
    </key>
```

- [ ] **Step 2: Recompile the schema and check it took**

Run: `glib-compile-schemas --strict --dry-run schemas/`
Expected: no output, exit 0.

- [ ] **Step 3: Write the notification**

Create `src/shell/welcome.ts`:

```ts
import type Gio from 'gi://Gio'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js'

/**
 * The one thing the extension says on its own initiative.
 *
 * With `always-show` false and no session running, enabling the extension puts
 * nothing in the top bar at all — so there is no island to click, no popup to
 * open, and nothing anywhere that says hooks have to be installed before a
 * session can ever appear. A notification is the only surface left.
 *
 * Posted from the extension rather than the island for that same reason: the
 * island may not exist on screen at the moment this matters.
 *
 * `welcome-shown` is the record that it fired. Setting it before the user
 * interacts is deliberate — a user who dismisses this should not meet it again
 * on the next login.
 */
export function maybeShowWelcome(settings: Gio.Settings, onOpenSettings: () => void): void {
  if (settings.get_boolean('welcome-shown')) return
  settings.set_boolean('welcome-shown', true)

  const source = new MessageTray.Source({
    title: 'Dasbo Island',
    iconName: 'dialog-information-symbolic',
  })
  Main.messageTray.add(source)

  const notification = new MessageTray.Notification({
    source,
    title: 'Dasbo Island is ready',
    body: 'Install hooks for Claude Code or Codex to see sessions here.',
  })
  notification.addAction('Open settings', () => onOpenSettings())
  source.addNotification(notification)
}
```

- [ ] **Step 4: Call it**

In `src/extension.ts`, add the import:

```ts
import { maybeShowWelcome } from './shell/welcome.js'
```

and call it at the end of `enable()`, after `setHooksProbe` and every other handler is wired — the action button opens preferences, so nothing should be half-built when the user can press it:

```ts
    maybeShowWelcome(settings, () => this.openPreferences())
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors. GNOME 46 is the only shell version in `metadata.json`, and this is its `MessageTray` API — `Source({title, iconName})`, `Notification({source, title, body})`, `source.addNotification(n)`. If `@girs` disagrees, check `metadata.json`'s `shell-version` before changing the call shape.

- [ ] **Step 6: Run the suite and build**

Run: `npm test && npm run build`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml src/shell/welcome.ts src/extension.ts
git commit -m "feat(onboarding): say something once, on first enable

With always-show off and no session running, enabling the extension put
nothing on screen at all and never mentioned that hooks have to be
installed first. One notification, once, with a button to the page that
installs them. welcome-shown records that it fired."
```

---

### Task 12: The GSettings schema (E18, E19, E20)

The schema is a second, unsynchronised copy of the preferences labels: `Show the pill with zero sessions` against `Always show the pill`, `Panel box for the island pill` against `Panel box`. Two descriptions state only an exception and never the rule. One begins mid-thought. XML and TypeScript cannot share a constant, so a test holds them together instead.

**Files:**
- Modify: `src/core/vocabulary.ts` (add `PREFS_LABEL`)
- Modify: `schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml` (every `<summary>`, three `<description>`s)
- Modify: `src/prefs.ts` (read the row titles from `PREFS_LABEL`)
- Create: `test/core/schemaLabels.test.ts`

**Interfaces:**
- Consumes: the exact label strings Task 7 settled.
- Produces: `PREFS_LABEL: Record<string, string>` — every schema key mapped to its label.

- [ ] **Step 1: Write the failing test**

Create `test/core/schemaLabels.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { PREFS_LABEL } from '../../src/core/vocabulary.js'

const SCHEMA = 'schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml'
const xml = readFileSync(SCHEMA, 'utf8')

interface Key { name: string; summary: string; description: string }

const keys: Key[] = [...xml.matchAll(/<key name="([^"]+)"[^>]*>([\s\S]*?)<\/key>/g)].map((m) => ({
  name: m[1]!,
  summary: m[2]!.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim() ?? '',
  description: m[2]!.match(/<description>([\s\S]*?)<\/description>/)?.[1]?.trim() ?? '',
}))

describe('the schema and the preferences window say the same thing', () => {
  it('parses every key out of the schema', () => {
    expect(keys.length).toBeGreaterThan(0)
  })

  // The whole class of drift this file exists to close: the schema's summaries
  // are what dconf-editor and `gsettings describe` show, and they were written
  // separately from the labels the preferences window shows for the same keys.
  it('gives every key a summary that is its preferences label, verbatim', () => {
    for (const key of keys) {
      expect(PREFS_LABEL[key.name], `${key.name} has no entry in PREFS_LABEL`).toBeDefined()
      expect(key.summary, key.name).toBe(PREFS_LABEL[key.name])
    }
  })

  it('has no label for a key the schema does not define', () => {
    const names = new Set(keys.map((k) => k.name))
    for (const name of Object.keys(PREFS_LABEL)) {
      expect(names.has(name), `${name} is labelled but not in the schema`).toBe(true)
    }
  })

  it('never lets a summary call the island a pill', () => {
    for (const key of keys) expect(key.summary.toLowerCase(), key.name).not.toContain('pill')
  })

  // Read alone in dconf-editor, a description that opens with the exception
  // never says what the key does.
  it('states the rule before the exception in every description', () => {
    for (const key of keys) {
      expect(key.description, key.name).not.toBe('')
      expect(key.description.startsWith('Suppressed'), key.name).toBe(false)
      expect(key.description.startsWith('Independent'), key.name).toBe(false)
    }
  })

  it('writes prose apostrophes curly, the way the rest of the copy does', () => {
    for (const key of keys) {
      expect(/\w'\w/.test(key.description), `${key.name}: ${key.description}`).toBe(false)
    }
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/core/schemaLabels.test.ts`
Expected: FAIL — `PREFS_LABEL` is not exported.

- [ ] **Step 3: Add `PREFS_LABEL`**

Append to `src/core/vocabulary.ts`:

```ts
/**
 * The label each setting carries in the preferences window, keyed by its
 * GSettings key.
 *
 * The gschema restates these as `<summary>`, and the two copies had drifted:
 * "Show the pill with zero sessions" against "Always show the pill". XML and
 * TypeScript cannot share a constant, so this table is the single source and
 * `test/core/schemaLabels.test.ts` is what holds the schema to it.
 *
 * Every key in the schema appears here, including the two with no row of their
 * own: `enabled-agents` is written by the per-agent switches, and
 * `welcome-shown` is internal state. Their labels are authored here rather than
 * mirrored from a row, and the completeness is what lets the test fail on a new
 * key that was added without one.
 */
export const PREFS_LABEL: Record<string, string> = {
  'panel-position': 'Panel box',
  'panel-index': 'Position within the box',
  'always-show': 'Always show the island',
  'permission-timeout': 'Permission timeout',
  'question-timeout': 'Question timeout',
  'auto-open-on-permission': 'Open the popup automatically',
  'notification-popup': 'Open the popup on a notification',
  'notification-seconds': 'Keep a notification visible',
  'notification-sounds': 'Play a sound',
  'enabled-agents': 'Agents Dasbo Island accepts events from',
  'done-linger': 'Keep finished sessions visible',
  'agent-chip-display': 'Agent chip',
  'welcome-shown': 'First-run notification shown',
}
```

- [ ] **Step 4: Rewrite the schema**

Replace the whole of `schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml` with this. Every `<summary>` is now its `PREFS_LABEL` entry verbatim, every explanation a summary used to carry has moved into `<description>`, the three descriptions the audit named state the rule before the exception, and every prose apostrophe is curly. `welcome-shown` keeps the entry Task 11 added.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<schemalist>
  <schema id="org.gnome.shell.extensions.dasbo-island"
          path="/org/gnome/shell/extensions/dasbo-island/">
    <key name="panel-position" type="s">
      <choices>
        <choice value="left"/>
        <choice value="center"/>
        <choice value="right"/>
      </choices>
      <default>'center'</default>
      <summary>Panel box</summary>
      <description>Which top bar box the island is placed in. Extensions that replace the top bar, such as Dash to Panel, decide where each box lands on screen.</description>
    </key>
    <key name="panel-index" type="i">
      <default>0</default>
      <summary>Position within the box</summary>
      <description>Position of the island inside the chosen top bar box.</description>
    </key>
    <key name="always-show" type="b">
      <default>false</default>
      <summary>Always show the island</summary>
      <description>Keeps the island in the top bar even when no agent session is active. When false it is hidden entirely.</description>
    </key>
    <key name="permission-timeout" type="i">
      <default>30</default>
      <summary>Permission timeout</summary>
      <description>Seconds to wait for a decision before falling through to the agent’s own prompt. Zero waits indefinitely.</description>
    </key>
    <key name="question-timeout" type="i">
      <default>120</default>
      <summary>Question timeout</summary>
      <description>Seconds to wait for an answer before falling through to the agent’s own picker. Longer than the permission timeout because a question has to be read. Zero waits indefinitely.</description>
    </key>
    <key name="auto-open-on-permission" type="b">
      <default>true</default>
      <summary>Open the popup automatically</summary>
      <description>Expands the popup when an agent asks for permission. Suppressed while a fullscreen window is on the primary monitor.</description>
    </key>
    <key name="notification-popup" type="b">
      <default>true</default>
      <summary>Open the popup on a notification</summary>
      <description>Opens the popup when an agent raises a notification. Suppressed while a fullscreen window is on the primary monitor.</description>
    </key>
    <key name="notification-seconds" type="i">
      <range min="0" max="300"/>
      <default>5</default>
      <summary>Keep a notification visible</summary>
      <description>How long the message replaces the row’s activity line, and how long a popup opened for it stays open. Zero keeps the message until the next event from that session, and never closes the popup.</description>
    </key>
    <key name="enabled-agents" type="as">
      <default>['claude','codex']</default>
      <summary>Agents Dasbo Island accepts events from</summary>
      <description>Which agents Dasbo Island accepts events from. Independent of hook installation — an agent with no hooks installed never sends events.</description>
    </key>
    <key name="done-linger" type="i">
      <default>10</default>
      <summary>Keep finished sessions visible</summary>
      <description>How long a session in the done state remains in the popup before it is dropped.</description>
    </key>
    <key name="notification-sounds" type="b">
      <default>true</default>
      <summary>Play a sound</summary>
      <description>Plays a sound for a permission request, an agent’s question, a notification, and a session finishing. Sounds come from the desktop’s sound theme, and stay silent when the system’s own event sounds are off.</description>
    </key>
    <key name="agent-chip-display" type="s">
      <choices>
        <choice value="logo"/>
        <choice value="logo-name"/>
        <choice value="name"/>
      </choices>
      <default>'logo-name'</default>
      <summary>Agent chip</summary>
      <description>What the tag at the head of each session row shows: the mark alone, the mark with a short name, or the name alone. A row whose mark is missing shows the name whatever this says.</description>
    </key>
    <key name="welcome-shown" type="b">
      <default>false</default>
      <summary>First-run notification shown</summary>
      <description>Set once the one-time welcome notification has been posted. Reset it to see the notification again.</description>
    </key>
  </schema>
</schemalist>
```

- [ ] **Step 5: Read the row titles from the table**

In `src/prefs.ts`, add to the imports:

```ts
import { PREFS_LABEL } from './core/vocabulary.js'
```

and replace each row's hard-coded `title:` with its lookup, so a future edit to a label lands in both places at once. For example:

```ts
    const position = new Adw.ComboRow({
      title: PREFS_LABEL['panel-position']!,
      subtitle: 'Where the island sits in the top bar',
      model: Gtk.StringList.new(['Left', 'Center', 'Right']),
    })
```

Do this for all eleven rows that bind a setting: `panel-position`, `panel-index`, `always-show`, `agent-chip-display`, `permission-timeout`, `question-timeout`, `auto-open-on-permission`, `done-linger`, `notification-popup`, `notification-seconds`, `notification-sounds`. Page titles, group titles, and the Agents page are not settings rows and stay as literals.

- [ ] **Step 6: Compile the schema and run the tests**

Run: `glib-compile-schemas --strict --dry-run schemas/`
Expected: no output, exit 0.

Run: `npx vitest run test/core/schemaLabels.test.ts`
Expected: PASS.

Run: `npm test && npm run typecheck`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/vocabulary.ts schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml src/prefs.ts test/core/schemaLabels.test.ts
git commit -m "fix(schema): make every summary the label it describes, and test that it stays one

The schema was a second, unsynchronised copy of the preferences labels, and
it had drifted — it still called the island a pill. Summaries are now the
labels verbatim, from one table, with the explanation in description where
it belongs. Two descriptions stated only their exception and never the
rule; one began mid-thought. A test parses the XML and fails on the next
drift, since XML and TypeScript cannot share a constant."
```

---

### Task 13: Accessibility names on the popup's controls (E21, E22, E23)

`Always` is the least reversible button in the extension and the vaguest label on it — an adverb standing alone, granting a tool for the rest of the session, announced to a screen reader as one word with no object. `Jump` is not a GNOME verb and does not say where to. The row expander is a geometric shape in the tab order with no name at all.

**Files:**
- Modify: `src/shell/permissionRow.ts:24-42`
- Modify: `src/shell/sessionRow.ts:142-155` (the expander), `:185` (Jump)
- Create: `test/shell/accessibleNames.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

Create `test/shell/accessibleNames.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// These widgets are all can_focus: true, so they are in the tab order, and
// their only text is a word with no object or a geometric shape. A source scan
// is the available check — src/shell needs a running GNOME Shell.
describe('every focusable control in the popup has a name', () => {
  it('says what Always actually does, in the label and to a screen reader', () => {
    const src = readFileSync('src/shell/permissionRow.ts', 'utf8')
    expect(src).toContain("'Always allow'")
    expect(src).toContain('Always allow this tool for this session')
    expect(src).not.toMatch(/mk\(\s*'Always'/)
  })

  it('names all three permission buttons distinctly', () => {
    const src = readFileSync('src/shell/permissionRow.ts', 'utf8')
    for (const name of ['Allow this tool once', 'Deny this tool', 'Always allow this tool for this session']) {
      expect(src, name).toContain(name)
    }
  })

  it('says where Jump goes', () => {
    const src = readFileSync('src/shell/sessionRow.ts', 'utf8')
    expect(src).toContain("Focus this session")
    expect(src).toContain('accessible_name')
  })

  it('names the expander in both of its states', () => {
    const src = readFileSync('src/shell/sessionRow.ts', 'utf8')
    expect(src).toContain("'Show details'")
    expect(src).toContain("'Hide details'")
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/shell/accessibleNames.test.ts`
Expected: FAIL on all four.

- [ ] **Step 3: Name the permission buttons**

In `src/shell/permissionRow.ts`, give `mk` an accessible name parameter and use it as the tooltip too:

```ts
    const mk = (label: string, name: string, cls: string, fn: () => void) => {
      const b = new St.Button({
        label,
        style_class: `button ${cls}`,
        y_align: Clutter.ActorAlign.CENTER,
        // Allow and Deny are verbs with objects; Always was an adverb standing
        // alone, and it is the one button here that outlives the prompt. A
        // screen reader heard "Always" and nothing else.
        accessible_name: name,
        // No tooltip: St widgets carry none in GNOME 46, unlike the Gtk.Button
        // in preferences. The label plus the accessible name is what this
        // surface has, which is why the label itself had to grow the verb.
        // St.Button doesn't set this in its own init, and the SessionRow these
        // land in is deliberately can_focus: false, so without it a
        // keyboard-only user cannot reach Allow, Deny or Always allow at all —
        // the one place in this extension where that is a security control,
        // not a convenience. Jump and the header gear carry it for the same
        // reason.
        can_focus: true,
      })
      b.connect('clicked', () => fn())
      return b
    }

    this.box.add_child(mk('Allow', 'Allow this tool once', 'dasbo-allow', cb.onAllow))
    this.box.add_child(mk('Deny', 'Deny this tool', 'dasbo-deny', cb.onDeny))
    this.box.add_child(
      mk('Always allow', 'Always allow this tool for this session', 'dasbo-always', cb.onAlways)
    )
```

The label `Always` becoming `Always allow` is the load-bearing half of this finding: with no tooltip available on an `St` widget, a sighted user's only clue that the grant outlives the prompt is the label itself. The popup is 30em and the other two buttons are one short word each, so the row takes it.

- [ ] **Step 4: Name Jump and the expander**

`src/shell/sessionRow.ts:185` — the label stays for width, the name says where it goes:

```ts
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
```

The expander at `:142-155` gains a name at construction and keeps it in step with the glyph:

```ts
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
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run test/shell/accessibleNames.test.ts`
Expected: PASS.

Run: `npm test && npm run typecheck`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add src/shell/permissionRow.ts src/shell/sessionRow.ts test/shell/accessibleNames.test.ts
git commit -m "fix(a11y): name the three controls a screen reader could not read

Always is the one button here that outlives the prompt, and it announced
itself as a single adverb — it is now Always allow, with a name saying it
lasts the session. Jump says where it goes, and the expander, which is a
geometric shape in the tab order, is Show details / Hide details."
```

---

### Task 14: Break the activity line at a word (E30)

In one row the activity line can end mid-word while the task line below it wraps in full. `taskList.ts:112` states the rule — a task subject is what the agent is doing, so it is never cut — and the activity line is the same kind of content, cut.

**Files:**
- Modify: `src/core/format.ts:21-24`
- Modify: `test/core/format.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `truncateDetail` keeps its signature `(s: string, max = 120) => string`.

- [ ] **Step 1: Write the failing test**

Append to the `describe('truncateDetail', …)` block in `test/core/format.test.ts`:

```ts
  it('breaks at the last space before the limit rather than mid-word', () => {
    const s = `${'word '.repeat(30)}finalword`
    const out = truncateDetail(s, 40)
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBeLessThanOrEqual(40)
    // The ellipsis follows a whole word, so the character before it is never a
    // letter cut out of the middle of one.
    expect(out.slice(0, -1).trimEnd()).toBe(out.slice(0, -1).trimEnd().replace(/\S$/, (c) => c))
    expect(out).toBe('word word word word word word word …')
  })

  // A path or a URL has no space to break at, and an ellipsis alone tells the
  // reader nothing. The hard cut is still the right answer there.
  it('falls back to a hard cut when there is no space to break at', () => {
    const s = 'a'.repeat(200)
    const out = truncateDetail(s, 40)
    expect(out.length).toBe(40)
    expect(out).toBe(`${'a'.repeat(39)}…`)
  })

  it('does not break at a space that is past the limit', () => {
    const s = `${'a'.repeat(100)} tail`
    expect(truncateDetail(s, 40)).toBe(`${'a'.repeat(39)}…`)
  })
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/core/format.test.ts`
Expected: FAIL on the first of the three — the output ends mid-word.

- [ ] **Step 3: Implement the word break**

Replace `truncateDetail` in `src/core/format.ts`:

```ts
/**
 * Collapse whitespace and cap length. The popup's width is fixed in CSS and the
 * activity label wraps, so this bounds the label's *height*, not its width —
 * to a few wrapped lines, though the exact count depends on the column width,
 * which differs between a plain row and one showing the permission cluster.
 *
 * The cut lands on a word boundary. A task subject one line below this is never
 * truncated at all (`taskList.ts`), so an activity line ending mid-word made
 * two pieces of the same kind of content follow two different rules. When there
 * is no space to break at — a path, a URL, one long token — the hard cut stands,
 * because breaking at the first character would leave an ellipsis and nothing
 * else.
 */
export function truncateDetail(s: string, max = 120): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const window = flat.slice(0, max - 1)
  const lastSpace = window.lastIndexOf(' ')
  return lastSpace > 0 ? `${window.slice(0, lastSpace + 1)}…` : `${window}…`
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/core/format.test.ts`
Expected: PASS, including the pre-existing case that a 200-`a` string cuts to exactly 120 characters.

Run: `npm test`
Expected: PASS. `test/core/activity.test.ts` asserts truncated output in places — if one fails, check whether the new expected value is a word break; if so, update the assertion.

- [ ] **Step 5: Commit**

```bash
git add src/core/format.ts test/core/format.test.ts
git commit -m "fix(popup): stop cutting the activity line mid-word

A task subject one line below is never truncated at all, so the activity
line ending mid-word had two pieces of the same content following two
different rules. The 120-character cap and its layout reason stand; the cut
now lands on the last space before it, falling back to a hard cut for a
token with no space in it."
```

---

### Task 15: The apostrophe sweep, the changelog, and full verification (E29)

Straight and curly apostrophes are mixed across surfaces. The changelog describes the extension in the vocabulary this run just replaced. And the whole audit needs one pass confirming nothing was missed.

**Files:**
- Modify: any `src/` file still holding a straight apostrophe in prose
- Modify: `CHANGELOG.md`
- Create: `test/core/apostrophes.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Sweep "pill" out of the comments too**

The user-facing strings lost the word in Tasks 7 and 12, but internal prose still calls the top-bar object a pill, which is the drift this run exists to close coming straight back. Update the comments at these sites to say "island":

- `src/shell/panelPlacement.ts:28` (comment) and `:40` — the `console.warn` string becomes `` `dasbo-island: panel box "${box}" is missing; leaving the island where it is` ``
- `src/core/store.ts:292, 332, 473` (comments)
- `src/shell/island.ts:142, 229, 316, 809` (comments)

Leave these alone — they are identifiers, not prose: the `dasbo-pill` and `dasbo-pill-label` style classes (`island.ts:135`, `sessionRow.ts:118`, `stylesheet.css`), `pillState`, and `about.ts:137`'s `add_css_class('pill')`, which is libadwaita's own class name for a rounded button and has nothing to do with this extension's vocabulary.

- [ ] **Step 2: Find the remaining straight apostrophes**

Run: `grep -rn "[A-Za-z]'[a-z]" src/ --include=*.ts | grep -v "^\s*//" `
Expected: a short list. Ignore any hit that is TypeScript syntax rather than prose (a quoted identifier, a possessive inside a `//` comment is fine to fix too but is not user-facing).

- [ ] **Step 3: Write the guard**

Create `test/core/apostrophes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

// Curly is already the majority, and the two forms sat side by side in one
// window. This checks string literals only: a straight apostrophe inside a
// double-quoted or backtick-quoted user-facing string is the case that reaches
// a user.
describe('prose apostrophes are curly', () => {
  it('has no straight apostrophe inside a double-quoted or template string in src', () => {
    const offenders: string[] = []
    for (const file of walk('src')) {
      const src = readFileSync(file, 'utf8')
      for (const [i, line] of src.split('\n').entries()) {
        if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) continue
        if (/(["`])[^"`]*\w'\w[^"`]*\1/.test(line)) offenders.push(`${file}:${i + 1}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 4: Run it, fix what it names**

Run: `npx vitest run test/core/apostrophes.test.ts`
Expected: FAIL listing files, or PASS if the earlier tasks caught them all. Replace each `'` it names with `’`.

- [ ] **Step 5: Update the changelog**

In `CHANGELOG.md`'s `## [Unreleased]` → `### Added` list, the first two bullets describe the extension in the vocabulary this run replaced. Change them to:

```markdown
- A top-bar island whose 2×2 grid reflects the busiest session: idle, thinking,
  waiting on a permission, errored, or finished.
```

and leave the second bullet's wording alone except that it already says "agent chip", which is correct. Then add a `### Changed` section immediately after `### Added`:

```markdown
### Changed

- Every string the extension shows was reviewed against the DIS-9 copy audit.
  The store description now names the agents and scopes inline permission
  approval to Claude Code, which is the only agent that has it; a Codex row
  says its hooks are notifications only. The top-bar indicator is called the
  island everywhere, and one running session reads *thinking* on both the
  island and the row rather than *working* on one and *thinking* on the other.
  Failure messages say what happened, why, and what to do, with the underlying
  exception going to the journal instead of a toast. The popup's empty state
  points a user with no hooks at Settings, and a one-time notification does the
  same on first enable. Allow, Deny, Always allow, Jump and the row expander
  carry accessible names.
```

- [ ] **Step 6: Walk the audit and confirm every finding landed**

Open `docs/copy-audit-extension-2026-08-10.md` and check off each of E1–E31 against the working tree. Findings and where they were done:

| Findings | Task |
| --- | --- |
| E3, E4 (state words) | 1 |
| E24, E25 | 2 |
| E1, E31 | 3 |
| E2 (data) | 4 |
| E2, E8, E9, E10, E11 (text) | 5 |
| E8, E9, E10, E11 (wiring) | 6 |
| E4, E5, E6, E7, E26, E27, E28 | 7 |
| E6, E12 | 8 |
| E13, E14, E15 | 9 |
| E16 | 10 |
| E17 | 11 |
| E18, E19, E20 | 12 |
| E21, E22, E23 | 13 |
| E30 | 14 |
| E29 | 15 |

Anything unaccounted for is fixed now, in this task, before the final commit.

- [ ] **Step 7: Full verification**

Run each and confirm the expected result before claiming the work is done:

```bash
npm test
npm run typecheck
npm run build
glib-compile-schemas --strict --dry-run schemas/
grep -rnw "pill" src/ | grep -v "dasbo-pill\|pillState\|add_css_class"
```

Expected: tests pass, typecheck clean, build completes, schema compiles, and the final `grep` produces no output.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "fix(copy): curly apostrophes throughout, and a changelog that matches

The last straight apostrophes in prose, with a test that fails on the next
one inside a user-facing string. The changelog described the extension in
the vocabulary this run replaced."
```

---

## Done

All 31 findings implemented, `npm test` green, `npm run typecheck` clean, `npm run build` producing the extension. Merge `feat/extension-copy` into `master`, then remove the worktree and delete the branch.
