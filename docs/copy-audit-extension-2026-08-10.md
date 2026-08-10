# Extension copy audit — UI strings

**Date:** 2026-08-10
**Scope:** every string the extension itself puts in front of a user — the
panel pill, the popup, the preferences window, `metadata.json`, the GSettings
schema, and the decision text the agent prints back into the terminal.
**Out of scope:** `site/index.html`, which was audited separately in
`docs/copy-seo-audit-2026-08-10.md`. `README.md`, `CHANGELOG.md` and `docs/`
were read only as evidence, not audited.
**Method:** `ux-copy` — clear / concise / consistent / useful / human, plus its
patterns for CTAs, error messages, empty states, tooltips and onboarding.
**Status:** findings only. No files were changed.

Every finding carries an ID, evidence with `file:line`, and a concrete fix.
Nothing here invents a claim the repo does not already support. Items needing
a decision from the owner are marked **needs owner input**.

---

## Executive summary

The strings are unusually careful at the sentence level — the timeout
subtitles, the stale-hooks subtitle and the Support description are all good
copy. The problems are systemic rather than local, and they cluster in four
places:

1. **One accuracy defect ships to the store.** `metadata.json`'s description
   promises inline permission approval without qualification, and Codex cannot
   do it (E1). This is the same defect the landing-page audit filed as C1, in a
   second place, and it is the one string a user reads *before* installing.
2. **The same state has two names on screen at once.** The pill says
   `working`, the row beneath it says `thinking…`, for one session in one
   state (E3). The object the whole product is named after is called "pill",
   "island" and "chip" across three surfaces and defined nowhere (E5).
3. **Failure paths are developer-facing.** A raw exception in a toast (E14), a
   bare file path as an error (E13), a bare URL as a toast (E15), and
   `Session reaped` printed into the user's terminal (E18).
4. **There is no onboarding and no real empty state.** `No active sessions`
   is a label, not an empty state, and it is the entire first-run experience
   for a user who has not installed hooks yet (E20, E21).

Suggested order: **E1, E3, E5** (accuracy and vocabulary) → **E13–E19**
(failure text) → **E20, E21** (first run) → **E22–E24** (schema) → the rest.

---

## Priority 1 — accuracy

### E1 · The store description promises Codex permission approval

- **Impact:** High — this is the pre-install pitch on extensions.gnome.org and
  in the GNOME Extensions app.
- **Where:** `metadata.json:4`
- **Evidence:** *"Live AI coding-agent sessions in the top bar: status, inline
  permission approval, and jump-back to the terminal."* No agent is named, so
  the promise reads as covering everything the extension supports.
  `docs/limitations.md` § "Codex has no permission gate" states Codex's
  `PreToolUse` hook rejects an `allow`/`ask` decision outright and that every
  Codex hook is installed notify-only. `README.md` records it as
  `no — notify-only`. This is landing-page finding C1 in a second location.
- **Fix:** Name the agents and scope the claim:
  *"Live Claude Code and Codex sessions in the top bar: status at a glance,
  one click back to the terminal, and Claude Code permission prompts answered
  inline."* (146 chars — e.g.o. truncates long descriptions in list view, so
  keep the qualified claim inside the first ~150.)

### E2 · Nothing in the UI tells a Codex user their hooks are notify-only

- **Impact:** High — a user installs Codex hooks, waits for Allow/Deny that
  never arrives, and concludes the extension is broken.
- **Where:** `src/prefs.ts:238-258` (`describe`), `src/core/agentCatalog.ts:30`
- **Evidence:** The Codex row's only states are `Hooks installed`,
  `Hooks need updating…`, `Not installed`, `<path> is not valid JSON`. None
  mentions capability. The limitation is documented in `docs/limitations.md`
  and on the site's table, neither of which a user is looking at while they
  click Install.
- **Fix:** Carry capability in the catalog and show it on the row. Subtitle for
  an installed Codex row: `Hooks installed · notifications only, no permission
  prompts`. This needs a data change (a `permissions: 'inline' | 'notify-only'`
  field on `CatalogEntry`), so it is a copy finding with an implementation tail.

---

## Priority 2 — one vocabulary

### E3 · `working` and `thinking…` are the same state, on screen together

- **Impact:** High — visible in a single screenshot.
- **Where:** `src/shell/island.ts:37` (`STATE_WORD.running = 'working'`) vs
  `src/core/activity.ts:117` (`{ text: 'thinking…' }`)
- **Evidence:** The pill renders `2 · working` while the row below it renders
  `thinking…` for the same session with no tool in flight. `activity.ts:56`
  already records the rule — *"The pill renders `running` as 'working' … so a
  row falling back to the raw word made the same session read two ways at
  once"* — and then breaks it with a third word.
- **Fix:** One word for one state. `working` is the honest one: agents run
  tools, not only think. Change `activity.ts:117` to `{ text: 'working…',
  hint: true }`. If the softer word is wanted, change `STATE_WORD.running`
  instead — but pick one. **needs owner input** on which.

### E4 · Four names for the object the product is named after

- **Impact:** Medium — every preferences label depends on the reader knowing
  which thing is meant.
- **Where:** `src/prefs.ts:73` (*"Always show the pill"*), `src/prefs.ts:87`
  (*"Agent chip"*), `schemas/…gschema.xml` (*"Panel box for the island pill"*),
  `src/shell/popupHeader.ts:32` (*"Dasbo Island"*)
- **Evidence:** "pill" appears in prefs with no definition anywhere in the UI;
  "island" appears only in the schema summary, which the prefs window never
  shows; "chip" is a different object (the per-row agent tag) one page away
  from "pill"; the popup header is the product name. A first-run user reading
  *"Always show the pill"* has no way to know what a pill is.
- **Fix:** Name two objects and use those names everywhere:
  - the top-bar indicator → **the island** (matches the product name)
  - the per-row agent tag → **the agent chip** (already used, keep)

  Then: `Always show the island` / `Keep the island visible even when no agent
  session is active`; schema summary `Show the island with no sessions`. Drop
  "pill" from every user-facing string. (Internal identifiers can stay as they
  are — this is about what the user reads.)

### E5 · `Permissions` group holds two settings that are not permissions

- **Impact:** Medium — a user looking for the finished-session timer will not
  look under Permissions.
- **Where:** `src/prefs.ts:107` — the group holds `Permission timeout`,
  `Question timeout`, `Open the popup automatically`, `Keep finished sessions
  visible`
- **Fix:** Split into `Permissions` (permission timeout, auto-open) and
  `Sessions` (question timeout, keep-finished-visible) — or retitle the single
  group `When an agent needs you`, which covers permissions and questions but
  still not the linger timer.

### E6 · British and American spelling in one window

- **Impact:** Low
- **Where:** `src/prefs.ts:106` (`Behaviour`), `src/prefs/about.ts:102`
  (`Licence`) — against `LICENSE` in the repo root and `GPL-3.0-or-later`, and
  against GNOME's own en-US default UI.
- **Fix:** Pick one and apply throughout. GNOME HIG and every neighbouring
  extension are en-US: `Behavior`, `License`. **needs owner input** if en-GB is
  deliberate — in which case the About row is the one to leave alone and the
  rest of the docs should follow it.

### E7 · `Coming soon` and `Not supported yet` say one thing two ways

- **Impact:** Low
- **Where:** `src/prefs.ts:327` (subtitle `Coming soon`) and `src/prefs.ts:333`
  (switch tooltip `Not supported yet`), on the same row
- **Fix:** Make the tooltip add information rather than restate the subtitle in
  a more negative register: `Not available in this release`. Or drop the
  tooltip — an insensitive switch beside a `Coming soon` subtitle already says
  it.

---

## Priority 3 — failure and feedback text

Each of these breaks the `ux-copy` error structure: **what happened + why +
how to fix**.

### E8 · A raw exception in a toast

- **Impact:** High
- **Where:** `src/prefs.ts:293` — `` `${adapters[id].displayName}: ${verb} failed — ${e}` ``
- **Evidence:** `e` is whatever `applyEdits` threw — a GLib error string with a
  path, an errno, and no advice. Toasts are one line and clip.
- **Fix:** Human message, actionable step, exception to the journal:
  `Couldn't install Claude Code hooks — check that ~/.claude/settings.json is
  writable.` plus `console.warn` with the real error.

### E9 · A file path as an error message

- **Impact:** Medium
- **Where:** `src/prefs.ts:248` — `` `${configPath(id, env)} is not valid JSON` ``
- **Evidence:** States what is wrong, not why it matters or what to do. The
  absolute path also runs past the width of an `Adw.ActionRow` subtitle and
  gets ellipsized in the middle, which is where the filename is.
- **Fix:** `Can't read settings.json — it isn't valid JSON. Fix the file, then
  reopen this page.` Put the full path in the row's tooltip, where it can be
  read in full.

### E10 · `nothing to install` reads as a bug report

- **Impact:** Medium
- **Where:** `src/prefs.ts:279` — `` `${displayName}: nothing to ${verb}` ``
- **Fix:** Two strings instead of one interpolation:
  install → `Claude Code hooks are already up to date.`
  remove → `No Claude Code hooks to remove.`

### E11 · The Codex trust note is too long for its toast, and uses markup a toast can't render

- **Impact:** Medium — this is the one instruction without which a fresh Codex
  install never fires.
- **Where:** `src/prefs.ts:287-291` — `` ' — start `codex` once and approve the
  hook review, or Codex will not run them' `` appended to
  `` `${displayName}: ${verb} complete` ``
- **Evidence:** The combined string is ~120 characters in an `Adw.Toast`, which
  is single-line and ellipsizes. The backticks render literally. `them` has no
  antecedent — the nearest plural noun is "the hook review".
- **Fix:** Shorten and give it a target: title
  `Codex hooks installed — run codex once to approve them`, and move the
  explanation to the row subtitle or an `Adw.Toast` button labelled
  `What's this?`. At minimum: drop the backticks, replace `them` with `the
  hooks`.

### E12 · A bare URL as a toast

- **Impact:** Medium
- **Where:** `src/prefs/about.ts:231` — `new Adw.Toast({ title: uri })`
- **Evidence:** The browser failed to launch and the user gets a floating
  address with no sentence around it and no way to copy it — toast titles are
  not selectable.
- **Fix:** `Couldn't open your browser. Copied the address to the clipboard.`
  and actually copy it (`Gdk.Display.get_clipboard`). If copying is out of
  scope, then: `Couldn't open your browser — visit buymeacoffee.com/fsevenm`.

### E13 · `no window` is a fragment, not a message

- **Impact:** Medium
- **Where:** `src/shell/island.ts:280` — `row.showTransient('no window', until)`
- **Evidence:** Sits in the activity line where every other string is a
  sentence fragment *about the agent*. It reports the extension's own failure
  in the same slot, in lowercase, with no next step.
- **Fix:** `couldn't find its terminal window` — same register as the
  neighbouring `waiting for you`, and it names what was being looked for.

### E14 · `Session reaped` is printed into the user's terminal

- **Impact:** Medium — these strings leave the extension entirely.
- **Where:** `src/core/permissions.ts:79, 121, 140, 180`
- **Evidence:** `Unknown session`, `Dasbo Island shutting down`, `Session
  reaped`, `Timed out` are fall-through reasons the agent surfaces. "Reaped" is
  implementation vocabulary; "Unknown session" reads as an accusation.
- **Fix:**
  - `Unknown session` → `Dasbo Island didn't recognise this session`
  - `Session reaped` → `Dasbo Island lost track of this session`
  - `Timed out` → `Dasbo Island timed out waiting for an answer`
  - `Dasbo Island shutting down` — fine as is.

### E15 · `Dasbo Island did not decide` lands in the model's context

- **Impact:** Low-Medium — this text is read by the agent, not only the user,
  and vague input produces vague behaviour.
- **Where:** `src/core/adapters/claude.ts:150-153`
- **Evidence:** The `ask` fall-through reason is `Dasbo Island did not decide`,
  which tells the model nothing about what to do next. `Allowed from Dasbo
  Island` / `Denied from Dasbo Island` are fine.
- **Fix:** `Dasbo Island timed out — ask the user here instead.` Same for
  `claude.ts:144`: `The user gave no answer in Dasbo Island.` →
  `The user closed Dasbo Island without answering — ask again here.`

---

## Priority 4 — first run

### E16 · `No active sessions` is a label, not an empty state

- **Impact:** High for a new user, invisible to an existing one.
- **Where:** `src/shell/popupHeader.ts:71`
- **Evidence:** The `ux-copy` empty-state structure is *what this is + why it's
  empty + how to start*. This gives only the first. A user who has enabled the
  extension but installed no hooks sees exactly this string forever and is
  never told hooks exist.
- **Fix:** Two lines. Always: `No active sessions` / `Start Claude Code or
  Codex in a terminal and it'll appear here.` When no agent has hooks
  installed (the state `installState()` already computes): `No agents
  connected` / `Install hooks in Settings to get started.` — with the existing
  gear as the path there.

### E17 · The extension is silent on first enable

- **Impact:** High — no copy exists for the moment the user has just installed.
- **Where:** `src/shell/island.ts:822-826`, `schemas/…gschema.xml`
  (`always-show` default `false`)
- **Evidence:** Enable the extension with no session running and nothing
  appears in the top bar at all. Nothing tells the user hooks must be
  installed before anything will ever appear. Every string this audit covers is
  behind a UI the user has no reason to know is there.
- **Fix (copy side):** a one-time notification on first enable —
  title `Dasbo Island is ready`, body `Install hooks for Claude Code or Codex
  to see sessions here.`, action `Open settings`. **needs owner input**:
  alternatively, default `always-show` to `true` for the first session only, so
  the island is visible and clickable. Either is a product decision, not a
  wording one.

---

## Priority 5 — GSettings schema

These strings show in dconf-editor, in `gsettings describe`, and in any tool
that reads the schema. They are a second, unsynchronised copy of the prefs
labels.

### E18 · Schema summaries don't match the prefs labels they describe

- **Impact:** Low
- **Where:** `schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml`
- **Evidence:** `Show the pill with zero sessions` vs prefs `Always show the
  pill`; `Panel box for the island pill` vs prefs `Panel box`; `Seconds a
  finished session stays visible` vs prefs `Keep finished sessions visible`;
  `What the agent chip on a session row shows` vs prefs `Agent chip`.
- **Fix:** Make `summary` the prefs label verbatim and keep the explanation in
  `description`. That is what the two fields are for, and it removes a whole
  class of drift.

### E19 · Two descriptions state only the exception, never the rule

- **Impact:** Low
- **Where:** `auto-open-on-permission` and `notification-popup`, both
  `Suppressed while a fullscreen window is on the primary monitor.`
- **Evidence:** Read alone in dconf-editor, neither says what the key does.
- **Fix:** Rule then exception: `Expands the popup when an agent asks for
  permission. Suppressed while a fullscreen window is on the primary monitor.`

### E20 · `enabled-agents` description starts mid-thought

- **Impact:** Low
- **Where:** `enabled-agents` — `Independent of hook installation. An agent
  with no hooks installed simply never sends events.`
- **Fix:** `Which agents Dasbo Island accepts events from. Independent of hook
  installation — an agent with no hooks installed never sends events.`

---

## Priority 6 — labels, tooltips and accessibility text

### E21 · `Always` is the least reversible button with the vaguest label

- **Impact:** Medium — it is a security control.
- **Where:** `src/shell/permissionRow.ts:42`
- **Evidence:** `Allow` and `Deny` are verbs with objects; `Always` is an
  adverb standing alone. It grants the tool for the rest of the session
  (`src/extension.ts:85`, reason `Always allowed for this session`), which the
  label does not say. The three buttons carry `can_focus: true` but no
  `accessible_name`, so a screen-reader user hears "Always" and nothing else.
- **Fix:** Label `Always allow` if the 30em row takes it; otherwise keep
  `Always` and add `accessible_name: 'Always allow this tool for this
  session'` plus the same text as a tooltip.

### E22 · `Jump` is jargon, and unlabelled to a screen reader

- **Impact:** Medium
- **Where:** `src/shell/sessionRow.ts:185`
- **Evidence:** "Jump" is not a GNOME verb and does not say where to. The
  failure path already has to explain itself (`no window`, E13).
- **Fix:** `Open` — or keep `Jump` for width and add `accessible_name: 'Focus
  this session's terminal window'`.

### E23 · The row expander is a bare glyph with no name

- **Impact:** Medium (accessibility)
- **Where:** `src/shell/sessionRow.ts:142-155` — `label: '▸'`, toggled to `'▾'`
- **Evidence:** `can_focus: true`, so it is in the tab order, and its only text
  is a geometric shape. Screen readers announce the character or nothing.
- **Fix:** `accessible_name`, updated with the state: `Show details` /
  `Hide details`.

### E24 · The pill's live state is not exposed to assistive tech

- **Impact:** Medium (accessibility)
- **Where:** `src/shell/island.ts:112` (`super(0.5, 'Dasbo Island')`),
  `island.ts:837`
- **Evidence:** The button's accessible name is the fixed string `Dasbo
  Island`. The visible label carries the live state — `3 · waiting` — and is
  never announced. The `·` separator also reads aloud as "middle dot".
- **Fix:** Update `accessible_name` alongside the label:
  `3 sessions, waiting for you` / `2 sessions, working` / `No sessions`.

### E25 · The pill says `idle` when there are no sessions at all

- **Impact:** Low
- **Where:** `src/shell/island.ts:834-835`
- **Evidence:** `idle` is a *session* state (`STATE_WORD.idle`, and the row's
  own `idle` placeholder at `activity.ts:118`). Reused here for "there are no
  sessions", it says a session is idle when none exists.
- **Fix:** `No sessions` — or show the mark alone with no word.

### E26 · The enable switch's tooltip is written in the codebase's vocabulary

- **Impact:** Low
- **Where:** `src/prefs.ts:224` — `Accept events from this agent`
- **Evidence:** "Events" is an implementation term; nothing else in the
  preferences window uses it. A user thinks in sessions.
- **Fix:** `Show this agent's sessions in the top bar`.

### E27 · `Install` / `Remove` read against an agent's name, not against hooks

- **Impact:** Low
- **Where:** `src/prefs.ts:235-236`
- **Evidence:** The row title is `Claude Code`, so the buttons parse as
  install/remove *Claude Code*. The group title `Hook installation` is above
  the first row and off screen once the list scrolls.
- **Fix:** `Install hooks` / `Remove hooks`. Both fit an `Adw.ActionRow`
  suffix.

---

## Priority 7 — line level

### E28 · Preferences subtitles are two to three times GNOME's usual length

- **Impact:** Low
- **Where:** `src/prefs.ts:55` (107 chars, and names a third-party extension —
  *"Extensions that replace the top bar, such as Dash to Panel, decide where
  each box lands on screen"*), `src/prefs.ts:88` (114 chars),
  `src/prefs.ts:161` (137 chars)
- **Evidence:** An `Adw.ActionRow` subtitle wraps to two or three lines at
  these lengths, making one row twice the height of its neighbours down an
  otherwise even list.
- **Fix:** Cut to one line each and move the caveat to the group description:
  - `Panel box` → `Where the island sits in the top bar`
  - `Agent chip` → `What the tag at the head of each row shows`
  - `Play a sound` → `When an agent needs you, or finishes`

### E29 · Mixed straight and curly apostrophes across surfaces

- **Impact:** Low
- **Where:** `src/prefs.ts:111, 119, 161` use `’`; the schema's
  `permission-timeout` and `question-timeout` descriptions use `'` in *"the
  agent's own prompt"*; `src/prefs.ts:246` uses `’` in `don’t`.
- **Fix:** Curly (`’`) everywhere in prose. It is already the majority.

### E30 · Truncation policy differs between two labels in the same row

- **Impact:** Low
- **Where:** `src/core/format.ts:21` (`truncateDetail`, hard cut at 120 chars
  plus `…`) vs `src/shell/taskList.ts:112-119` (task subjects wrap, never cut)
- **Evidence:** In one row, the activity line can end mid-word while the task
  line below it wraps in full. `taskList.ts:112` states the rule — *"A task
  subject is what the agent is doing, so it is never cut"* — which applies
  equally to the activity line, and it is cut.
- **Fix:** Break `truncateDetail` at the last space before the limit rather
  than mid-word. **needs owner input** on whether the activity line should stop
  truncating entirely, since `activity.ts:93` records a layout reason for the
  cap.

---

## Cross-cutting

### E31 · Every string is English-only, but the extension declares a gettext domain

- **Impact:** Medium — it decides whether any of the fixes above need
  localisation notes.
- **Where:** `metadata.json:8` (`"gettext-domain": "dasbo-island"`); no
  `gettext` call anywhere in `src/`; no `po/` directory
- **Evidence:** The declared domain implies translations exist. None do, and no
  string is wrapped for extraction.
- **Fix:** Either wrap the user-facing strings and add `po/`, or drop the
  field. **needs owner input.** If translation is planned, note the constraint
  now: the popup is pinned at 30em (`stylesheet.css:157`,
  `.dasbo-fixed-width`) and the pill's label is pinned at 8em
  (`stylesheet.css:34`), so German and French expansion of 30–40%
  will break `Always allow` (E21), `Answer in terminal`
  (`questionPanel.ts:81`), and the pill's state words before anything else.

---

## Suggested implementation batches

1. **Accuracy** — E1, E2. Ships the store description and the Codex capability
   note together, since both are the same claim.
2. **Vocabulary** — E3, E4, E5, E6, E7. One pass, one decision each, no logic
   changes beyond string swaps.
3. **Failure text** — E8–E15. Same shape everywhere: what + why + what next.
   E8 and E12 need small code changes (journal logging, clipboard).
4. **First run** — E16, E17. The largest product decision in this list.
5. **Schema** — E18, E19, E20. Mechanical.
6. **Labels and a11y** — E21–E27. Every one is an added `accessible_name` or a
   one-word swap; E21 and E23 are the ones that matter.
7. **Line level** — E28, E29, E30, E31.

## Verified clean — no action

- `Support` group description (`src/prefs/about.ts:125`) — states the licence,
  makes the ask once, no guilt. Leave it.
- `Hooks need updating — they don't match what this version installs`
  (`src/prefs.ts:246`) — vague about the cause on purpose, and says what to do.
- Question panel navigation: `Next` / `Submit` / `Answer in terminal` /
  `Other…` (`src/shell/questionPanel.ts:77, 81, 145, 193`) — verbs, correct
  outcomes, an honest escape hatch.
- `Type an answer` entry hint (`src/shell/questionPanel.ts:209`).
- `Settings` accessible name on the header gear
  (`src/shell/popupHeader.ts:42`).
- The prefs page and group titles: `Appearance`, `Behaviour`, `Agents`,
  `About`, `Panel`, `Session rows`, `Notifications`, `Hook installation` —
  sentence case throughout, GNOME-idiomatic (except the spelling, E6).
- `Show QR code` / `Scan with your phone to donate`
  (`src/prefs/about.ts:154-156`).
- The hook-installation group description
  (`src/prefs.ts:175`) — states what is preserved and that a backup is written,
  which is exactly the objection a user has at that moment.
