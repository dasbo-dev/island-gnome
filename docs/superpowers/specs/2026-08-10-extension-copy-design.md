# Extension copy: fix every string the extension puts on screen

**Date:** 2026-08-10
**Issue:** DIS-11 ("Fix extension copy"), findings from DIS-9
**Source audit:** `docs/copy-audit-extension-2026-08-10.md`
**Scope:** every finding in that audit — all 31 (E1–E31), including the ones
with code tails. The owner chose the full scope over the three narrower ones.

## Why this work

The audit's own summary is the right frame: the strings are careful at the
sentence level and broken at the system level. Four clusters:

1. **One accuracy defect ships to the store.** `metadata.json` promises inline
   permission approval without naming an agent, and Codex cannot do it. This is
   the same claim the landing-page audit filed as C1 and DIS-10 fixed on the
   site — in a second place, and the one string a user reads *before*
   installing.
2. **The same state has two names on screen at once.** The island says
   `working`, the row beneath it says `thinking…`, for one session in one
   state. The object the product is named after is called "pill", "island" and
   "chip" across three surfaces and defined nowhere.
3. **Failure paths are developer-facing.** A raw exception in a toast, a bare
   file path as an error, a bare URL as a toast, and `Session reaped` printed
   into the user's terminal.
4. **There is no onboarding and no real empty state.** `No active sessions` is
   a label, and it is the entire first-run experience for a user who has not
   installed hooks — a user who, with `always-show` off, cannot even see the
   island that would show it to them.

Underneath clusters 1 and 2 is one structural cause, the same one DIS-10 found
on the site: **the same fact is written down twice and the two copies drift.**
The gschema restates the prefs labels. `island.ts` and `activity.ts` each name
the session states. `metadata.json` restates a capability `docs/limitations.md`
already records. Fixing the wording without removing the second copy fixes
today's drift and schedules tomorrow's.

## Decisions taken before design

Six questions could not be answered from the repository. The owner answered
them:

1. **Scope:** all 31 findings, code tails included.
2. **E3, `working` vs `thinking…`:** `thinking…` wins. `STATE_WORD.running`
   changes; `activity.ts` keeps its word. See "the pill is 8em" below — this
   choice has a layout consequence, and the owner took the fix for it.
3. **E6, spelling:** en-US throughout. `Behaviour` → `Behavior`, `Licence` →
   `License`.
4. **E17, first run:** a one-time notification on enable. Not the
   "island visible until hooks exist" alternative, and not both.
5. **E30, truncation:** break at the last space before the 120-char limit. The
   cap stays; `activity.ts:93`'s layout reason for it still holds.
6. **E31, gettext:** drop the `gettext-domain` field. Wrapping 100+ strings for
   translations that do not exist would double this run's diff and force
   layout decisions (30em popup, 8em island label, 30–40% German expansion)
   that belong to a real localisation effort. The field returns with `po/`.

One further shape question, on **E5**: the owner chose splitting the
`Permissions` group into two groups over retitling the single group.

## Architecture

Almost all of this is an edit at the site the audit names. Three things are
structural, and only those three.

### `src/core/vocabulary.ts` — the strings that exist twice

A new pure module (no `gi://`, no `resource://`, so `test/core/purity.test.ts`
keeps passing). It holds **only** copy with more than one consumer:

- `STATE_WORD: Record<SessionState, string>` — moves out of `island.ts:35`.
- `ACTIVITY_PLACEHOLDER` — the hint words `activity.ts:117-119` falls back to.
  `running` reads from `STATE_WORD` plus the ellipsis, so the island and the
  row cannot disagree again.
- `PREFS_LABEL: Record<SettingKey, string>` — a label for **every** key in the
  schema, including the two with no preferences row of their own
  (`enabled-agents`, written by the per-agent switches, and `welcome-shown`,
  which is internal state). Those two are authored here rather than mirrored
  from a row, and the completeness is what lets the schema test assert that a
  new key cannot be added without a label.

Nothing else moves. A string with one consumer stays at its widget, where it
can be read beside the code that shows it. The alternative — a strings module
holding all 100+ user-facing strings — was considered and rejected: it spends
indirection on strings that have no second copy to drift from, and its other
argument (gettext extraction) died with decision 6.

`PREFS_LABEL` cannot be shared with the gschema at runtime: one is TypeScript,
the other is XML compiled by `glib-compile-schemas`. A test closes that gap
instead — see "Verification".

### `CatalogEntry` gains a capability field

`src/core/agentCatalog.ts`'s `supported` variant becomes:

```ts
| { id: AgentId; status: 'supported'; permissions: 'inline' | 'notify-only' }
```

Claude is `inline`, Codex `notify-only`. This is what E2 needs: the preferences
row can then say what the agent can actually do, at the moment the user is
deciding to install its hooks. The field lives on the catalog rather than the
adapter because the catalog is what the preferences page reads, and because a
`coming-soon` entry has no adapter to ask.

`prefs.ts`'s `_agentRow` takes the entry rather than the bare `id`, so
`describe()` can reach the field.

### `welcome-shown` — one new setting, for E17

A boolean key, default `false`. `enable()` reads it; if false, it posts a
single notification through `MessageTray` and sets the key true. The action
button calls the prefs handler `extension.ts:77` already wires up. Never fires
again, including across upgrades — the key is the record that it fired, so a
user who dismisses it does not meet it a second time.

The notification is posted from `enable()` rather than from the island, because
the island may be invisible (`always-show` false, no sessions) at exactly the
moment this matters, which is the whole reason E17 exists.

### The island label is 8em, and `thinking` is one char longer than `waiting`

`stylesheet.css:30-35` pins `.dasbo-pill-label` at 8em, sized for the widest
realistic content, `100 · waiting` — 13 characters. Decision 2 makes the widest
content `100 · thinking`, at 14. The rule widens to **8.5em** and its comment
is updated to name the new widest string. Without this, three-digit session
counts ellipsize the state word.

## The copy

Batch by batch, in the audit's suggested order. Where the audit gave a fix
verbatim and the owner did not override it, that fix is what ships.

### Batch 1 — accuracy (E1, E2)

**E1 · `metadata.json:4`**

> Live Claude Code and Codex sessions in the top bar: status, one click back to
> the terminal, and Claude Code permission prompts answered inline.

143 characters, so the qualifier survives extensions.gnome.org's list-view
truncation at ~150. ("status at a glance" was the first draft and came to 155.)

**E2 · `src/prefs.ts` `describe()`** — for an entry whose `permissions` is
`notify-only`, append ` · notifications only, no permission prompts` to the
`installed` and `stale` subtitles. Not to `absent` or `unreadable`: those rows
are about a file that isn't there or isn't readable, and the capability note
would compete with the thing the user has to fix first.

### Batch 2 — one vocabulary (E3–E7)

| Where | Was | Becomes |
| --- | --- | --- |
| `island.ts:37` via `vocabulary.ts` | `working` | `thinking` |
| `activity.ts:117` | `thinking…` | unchanged, now sourced from the table |
| `prefs.ts:73` | `Always show the pill` | `Always show the island` |
| `prefs.ts:74` | `Keep it visible even when no agent session is active` | `Keep the island visible even when no agent session is active` |
| `prefs.ts:106` | `Behaviour` | `Behavior` |
| `prefs/about.ts:102` | `Licence` | `License` |
| `prefs.ts:333` | `Not supported yet` | `Not available in this release` |

The island label carries no ellipsis (`3 · thinking`); the row's placeholder
keeps its `…` because it is a hint standing in for absent content, which is
what `Activity.hint` already marks.

**E4 · "pill" leaves every user-facing string.** Two objects have names and only these
names: **the island** (the top-bar indicator) and **the agent chip** (the
per-row tag). Internal identifiers — `dasbo-pill-label`, `pillState`,
`test/core/pillState.test.ts` — are untouched: this finding is about what the
user reads, and renaming the CSS class would churn the stylesheet, the shell
code and three tests for no reader-visible gain.

**E5 · the Behavior page splits.** `Permissions` keeps `Permission timeout` and
`Open the popup automatically`. A new `Sessions` group, placed between
`Permissions` and `Notifications`, takes `Question timeout` and `Keep finished
sessions visible`. Row order within each group is unchanged.

### Batch 3 — failure and feedback text (E8–E15)

Every one rebuilt as **what happened + why + what next**.

**E8 · `prefs.ts:293`** — the raw exception leaves the toast:

```
Couldn't install Claude Code hooks — check that ~/.claude/settings.json is writable.
```

with `console.warn` carrying the real error to the journal. The verb and the
path both vary by agent and action, so this is built from the agent's display
name, the verb, and `configPath(id, env)` — the path shortened to `~/…` for the
sentence, in full in the journal line.

**E9 · `prefs.ts:248`** — `unreadable` becomes:

```
Can't read settings.json — it isn't valid JSON. Fix the file, then reopen this page.
```

with the absolute path moved to `row.tooltip_text`, where it is readable in
full rather than middle-ellipsized at the filename.

**E10 · `prefs.ts:279`** — two strings, not one interpolation:
install → `Claude Code hooks are already up to date.`
remove → `No Claude Code hooks to remove.`

**E11 · `prefs.ts:287-291`** — the Codex trust note shortens to a toast that
fits on one line, loses its backticks, and names its antecedent:

```
Codex hooks installed — run codex once to approve them
```

The explanation stays in the toast and goes nowhere else. The audit offered the
row subtitle as an alternative home, but that subtitle already reads `Hooks
installed · notifications only, no permission prompts` after E2, and E28 in
this same run is about subtitles being too long for their rows. A third clause
there would undo E28 to satisfy E11.

**E12 · `prefs/about.ts:231`** — the address is copied and the toast says so:

```
Couldn't open your browser. Copied the address to the clipboard.
```

Copy via `Gdk.Display.get_default()?.get_clipboard()`. If no display is
reachable, fall back to `Couldn't open your browser — visit <uri>` so the user
still has the address.

**E13 · `island.ts:280`** — `no window` → `couldn't find its terminal window`.
Same register as the neighbouring `waiting for you`, and it names what was
being looked for. The 2-second transient window is unchanged; the longer string
still fits the 30em row.

**E14 · `core/permissions.ts`** — the fall-through reasons the agent prints
into the user's terminal:

| Line | Was | Becomes |
| --- | --- | --- |
| 79 | `Unknown session` | `Dasbo Island didn't recognise this session` |
| 121 | `Dasbo Island shutting down` | unchanged |
| 140 | `Session reaped` | `Dasbo Island lost track of this session` |
| 180 | `Timed out` | `Dasbo Island timed out waiting for an answer` |

**E15 · `core/adapters/claude.ts`** — these land in the model's context, so
they say what the model should do next:

- `:144` `The user gave no answer in Dasbo Island.` → `The user closed Dasbo
  Island without answering — ask again here.`
- `:153` `Dasbo Island did not decide` → `Dasbo Island timed out — ask the user
  here instead.`

`Allowed from Dasbo Island` and `Denied from Dasbo Island` are unchanged.

### Batch 4 — first run (E16, E17)

**E16 · `shell/popupHeader.ts` `EmptyRow`** grows a second line and a second
variant. Two lines in a vertical box inside the existing
`.dasbo-fixed-width` outer, the second dimmed the way the current single label
is:

- no agent has hooks installed → `No agents connected` /
  `Install hooks in Settings to get started.`
- otherwise → `No active sessions` /
  `Start Claude Code or Codex in a terminal and it'll appear here.`

The variant is chosen from a `hooksInstalled: () => boolean` callback that
`extension.ts` injects into `Island` alongside `iconBase` and `sound`, and
passed to `EmptyRow` as a constructor argument. `extension.ts` owns it because
it already holds `this.path` and the `InstallEnv` pieces `installState()`
needs, and because `island.ts:127` states the rule this follows — a widget that
reaches for its own dependencies is the thing that comment exists to prevent.
`EmptyRow` stays a dumb widget with no file access. The callback is called when
the row is built, so a user who installs hooks and reopens the popup sees the
other variant without a reload.

**E17 · the one-time notification**, per Architecture:

- title `Dasbo Island is ready`
- body `Install hooks for Claude Code or Codex to see sessions here.`
- action `Open settings`

### Batch 5 — GSettings schema (E18–E20)

**E18** — every `<summary>` becomes its `PREFS_LABEL` entry verbatim; the
explanation it used to carry moves into `<description>`, which is what that
field is for.

| Key | Summary becomes |
| --- | --- |
| `panel-position` | `Panel box` |
| `panel-index` | `Position within the box` |
| `always-show` | `Always show the island` |
| `permission-timeout` | `Permission timeout` |
| `question-timeout` | `Question timeout` |
| `auto-open-on-permission` | `Open the popup automatically` |
| `notification-popup` | `Open the popup on a notification` |
| `notification-seconds` | `Keep a notification visible` |
| `notification-sounds` | `Play a sound` |
| `enabled-agents` | `Agents Dasbo Island accepts events from` |
| `done-linger` | `Keep finished sessions visible` |
| `agent-chip-display` | `Agent chip` |

`enabled-agents` has no prefs row of its own — the per-agent switches write it
— so it is the one key whose summary is authored here rather than mirrored.

**E19** — `auto-open-on-permission` and `notification-popup` state the rule
before the exception:

- `Expands the popup when an agent asks for permission. Suppressed while a
  fullscreen window is on the primary monitor.`
- `Opens the popup when an agent raises a notification. Suppressed while a
  fullscreen window is on the primary monitor.`

**E20** — `enabled-agents`: `Which agents Dasbo Island accepts events from.
Independent of hook installation — an agent with no hooks installed never sends
events.`

**New** — `welcome-shown`: summary `First-run notification shown`, description
`Set once the one-time welcome notification has been posted. Reset it to see
the notification again.`

### Batch 6 — labels, tooltips and accessibility text (E21–E27)

| ID | Where | Change |
| --- | --- | --- |
| E21 | `shell/permissionRow.ts:42` | Label `Always` → `Always allow`; `accessible_name: 'Always allow this tool for this session'`; same text as tooltip. Allow and Deny gain `accessible_name` too — `Allow this tool once` / `Deny this tool` — since they sit in the same cluster and a screen reader hearing three buttons should hear three distinct outcomes. |
| E22 | `shell/sessionRow.ts:185` | `Jump` keeps its label for width; gains `accessible_name: "Focus this session's terminal window"`. |
| E23 | `shell/sessionRow.ts:142-155` | The `▸`/`▾` expander gains `accessible_name`, set at construction and updated in the same handler that swaps the glyph: `Show details` / `Hide details`. |
| E24 | `shell/island.ts:112, 837` | `accessible_name` is updated alongside the label, in the same branch: `3 sessions, waiting for you` / `2 sessions, thinking` / `No sessions`. Singular for one session. This also removes the `·` being read aloud as "middle dot". |
| E25 | `shell/island.ts:834` | Zero-session label `idle` → `No sessions`. |
| E26 | `prefs.ts:224` | Switch tooltip `Accept events from this agent` → `Show this agent's sessions in the top bar`. |
| E27 | `prefs.ts:235-236` | Buttons `Install` / `Remove` → `Install hooks` / `Remove hooks`. The `stale` label follows: `Update` → `Update hooks`. |

E24's phrasing is derived from the same `pillState` call that sets the label,
so the two cannot disagree — the accessible name is the label spelled out, not
a second computation of the state.

### Batch 7 — line level (E28–E31)

**E28** — three subtitles cut to one line; the caveats they carried move to
their group's `description`, which is where a caveat about a whole group
belongs:

| Where | Subtitle becomes | Caveat moves to |
| --- | --- | --- |
| `prefs.ts:55` `Panel box` | `Where the island sits in the top bar` | `Panel` group description: `Extensions that replace the top bar, such as Dash to Panel, decide where each box lands on screen.` |
| `prefs.ts:88` `Agent chip` | `What the tag at the head of each row shows` | `Session rows` group description: `A row whose mark is missing shows the name whatever this says.` |
| `prefs.ts:161` `Play a sound` | `When an agent needs you, or finishes` | `Notifications` group description: `Sounds come from your desktop's sound theme, and stay silent when system sounds are off.` |

**E29** — curly apostrophes (`’`) in all prose, including the gschema
descriptions, which currently use straight ones.

**E30** — `core/format.ts` `truncateDetail` breaks at the last space at or
before the limit rather than mid-word. If there is no space in the window
(a single long token — a URL, a path), it falls back to the hard cut, because
breaking a 200-character path at character zero produces an ellipsis and
nothing else. The 120-char cap and its layout reason are unchanged.

**E31** — `"gettext-domain"` is removed from `metadata.json`.

## Verification

Four source-scanning tests, in the shape `test/core/purity.test.ts` already
uses. These are the part that keeps the audit from being re-runnable next
release:

1. **`test/core/schemaLabels.test.ts`** — parses the gschema XML and asserts
   every key's `<summary>` equals its `PREFS_LABEL` entry verbatim, and that
   every key in the schema has an entry (so a new key cannot be added without
   a label). This is the only thing that can hold E18 closed, since XML and
   TypeScript cannot share a constant.
2. **`test/core/vocabulary.test.ts`** — asserts no user-facing string in `src/`
   contains the word `pill` (matching quoted string literals, so the CSS class
   and the internal identifiers are not false positives), and that no literal
   `'working'` survives in `src/shell` or `src/core`.
3. **`test/core/schemaDescriptions.test.ts`** — every key has a
   `<description>`, and none of them begins with `Suppressed` — the shape E19
   was: an exception stated as if it were the rule.
4. **`test/core/metadata.test.ts`** — `metadata.json` has no `gettext-domain`
   while `src/` contains no `gettext` call, and the description names both
   supported agents and is ≤ 150 characters.

Unit tests for the behaviour changes:

- `truncateDetail` breaks at a space; falls back to a hard cut for a spaceless
  token; leaves a short string alone (extends `test/core/format.test.ts`).
- `describe()` appends the capability note for a `notify-only` agent in the
  `installed` and `stale` states, and not in `absent` or `unreadable`
  (extends the install tests under `test/core/install/`).
- The empty-state variant: no agent with hooks → `No agents connected`;
  at least one → `No active sessions`. The selection is a pure function taking
  the install states, tested directly.
- `test/shell/noEllipsis.test.ts` gains a check that
  `.dasbo-pill-label`'s width is at least 8.5em, so the E3 word cannot be
  clipped by a later stylesheet edit.

`npm test` and `npm run typecheck` both pass before merge. `npm run build`
produces the extension zip; the schema must recompile cleanly, which the build
already does.

## Out of scope

- `site/index.html` — audited separately, fixed in DIS-10.
- `README.md`, `CHANGELOG.md` and `docs/` prose — a third audit,
  `docs/copy-audit-readme-community-2026-08-10.md`, covers those. The one
  exception is any doc statement this work makes false, which is fixed here.
- Localisation. Decision 6 drops the domain; `po/` and string wrapping are a
  future issue.
- Renaming internal identifiers that contain "pill".
- GNOME 47/48 support, which DIS-10's spec records as its own issue.
