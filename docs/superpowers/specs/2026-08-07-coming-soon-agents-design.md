# Coming-soon agents, and Antigravity withdrawn

Date: 2026-08-07

## Problem

The Agents page in preferences lists exactly the three agents dasbo has
adapters for. A reader learns nothing about where the project is going, and
the page reads as a finished set rather than a growing one.

Antigravity should not be in that set at all. Its permission gate has never
been exercised against a real payload, so it may fail open silently, and two
of the four sound cues are structurally dead for it. Shipping it as a
supported agent overstates what the extension does.

Nothing has been released yet, so no user has Antigravity hooks on disk and
no migration path is needed.

## Goal

The Agents page shows the two agents that work, plus a short roadmap of
agents that do not work yet, each visibly inert. Antigravity moves from the
first list to the second, and the README, the limitations page and the site
stop claiming it is supported.

## What ships

### The agent catalog

A new module, `src/core/agentCatalog.ts`, holds one ordered list of every
agent the preferences page shows:

```ts
export type CatalogEntry =
  | { id: AgentId; status: 'supported' }
  | { id: string; displayName: string; status: 'coming-soon' }

export const AGENT_CATALOG: readonly CatalogEntry[] = [
  { id: 'claude', status: 'supported' },
  { id: 'codex', status: 'supported' },
  { id: 'opencode', displayName: 'OpenCode', status: 'coming-soon' },
  { id: 'cursor', displayName: 'Cursor CLI', status: 'coming-soon' },
  { id: 'antigravity', displayName: 'Antigravity CLI', status: 'coming-soon' },
]
```

A supported entry carries no display name: the row reads it from
`adapters[id].displayName`, so the two can never drift. A coming-soon entry
has no adapter to read from, so it carries its own name. The union is
discriminated on `status`, which lets the preferences page narrow `id` to
`AgentId` in the branch that needs it without a cast.

The catalog is plain data. It is the only place the roadmap is written down,
and it is testable without GTK.

### The preferences rows

`_agentsPage` iterates `AGENT_CATALOG` instead of a literal
`['claude', 'codex', 'antigravity']`. A `supported` entry builds the existing
`_agentRow` and registers its refresher. A `coming-soon` entry builds a new
`_comingSoonRow(displayName)` and registers nothing — there is no file to
re-read.

`_comingSoonRow` returns an `Adw.ActionRow` whose:

- title is the display name,
- subtitle is `Coming soon`, occupying the place where an install state would
  otherwise be written,
- suffixes are a `Gtk.Switch` (`active: false`, `sensitive: false`, tooltip
  "Not supported yet") followed by Install and Remove buttons, both
  `sensitive: false`.

The suffixes are built in the same order and with the same `valign` as the
working rows, so the switch and the two buttons line up in columns down the
whole group.

Coming-soon rows live in the existing "Hook installation" group, after the
working rows. They get no group of their own: the state belongs in the row's
subtitle, next to "Hooks installed" and "Not installed", which is where a
reader already looks to find out what a row's situation is.

The disabled switch is never wired to `enabled-agents`. It has no handler at
all — it is a static picture of a control, not a control.

### Antigravity's withdrawal

Only its user-facing surface is withdrawn. `src/core/adapters/antigravity.ts`,
`src/icons/antigravity.svg`, the twelve fixtures under
`test/fixtures/antigravity/` and `test/core/adapters/antigravity.test.ts` all
stay exactly as they are, along with `antigravity` in the `AgentId` union, in
the `adapters` record, in `isAgentId`, and in the install-plan branch. That
work is verified against real payloads and is what a future release will turn
back on; deleting it would mean redoing it.

What changes:

- `schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml`: the
  `enabled-agents` default becomes `['claude','codex']`.
- The preferences row becomes the coming-soon row described above, so there is
  no way to install Antigravity hooks from the UI.

The hook binary still accepts `dasbo-hook antigravity ...` and the extension
would still normalise an Antigravity event if one arrived. Neither can happen
in practice, because nothing writes the hook entries any more and the agent is
not in the default enabled set — a dormant path, not a live one.

### README

- The features line naming "Claude Code, Codex CLI, and Antigravity CLI"
  becomes "Claude Code and Codex CLI".
- The Antigravity row leaves the "Supported agents" table.
- The two limitation bullets about Antigravity — the fail-open permission gate
  and the two dead sound cues — are deleted along with their links.
- A "Planned" line is added under the supported-agents table naming OpenCode,
  Cursor CLI and Antigravity CLI as not yet supported.

### docs/limitations.md

The two Antigravity sections — "The Antigravity permission gate may fail open"
and "Two sound cues are dead for Antigravity" — are deleted, and the intro
sentence that promises "the Codex trust step and the Antigravity permission
gate" is rewritten to name only the Codex trust step. A documented limitation
of an unshipped feature is noise: it tells a reader to be careful of something
they cannot reach.

### The site

- `site/index.html`: the Antigravity chip leaves the chip row, its row leaves
  the comparison table, and both meta descriptions plus the lead paragraph
  drop it from the list of sessions dasbo tracks. The same "Planned" line the
  README gets is added below the comparison table.
- `site/timeline.ts`: the demo drops to two sessions. Its per-agent constants
  are keyed by `AgentId`, so removing the Antigravity entries from `IDS`,
  `CWDS`, `PIDS`, the session-key map and the event list is the whole change.
  The demo showing a session for an agent the page says is unsupported would
  contradict the copy beside it.

### The hero mockup

`docs/assets/hero.svg` keeps its three rows. Row 3 stops being Antigravity and
becomes a second Claude session on a different project, still idle. Deleting
the row instead would cost the mockup its only illustration of the idle state,
and a user genuinely can have two sessions of one agent open at once, so the
drawing stays truthful.

## Tests

New: `test/core/agentCatalog.test.ts`, asserting that

- every catalog id is unique,
- every `supported` id has an entry in `adapters`,
- every member of the `AgentId` union appears in the catalog under some
  status — so adding an adapter without filing it in the catalog, which would
  leave it invisible in preferences, fails the build,
- every `coming-soon` entry has a non-empty display name.

Updated:

- `test/docs/readme.test.ts` — the assertion that the README must contain the
  Antigravity fail-open warning inverts: the README must not present
  Antigravity as supported. The Codex trust-step assertion is untouched.
- `test/docs/readmeAssets.test.ts` — the hero's required agent rows become
  Claude and Codex. The mockup-disclaimer and no-`src/icons` assertions are
  untouched.
- `test/docs/limitations.test.ts` — `failing open` and `structurally dead`
  leave `MUST_STATE`, and `antigravityAdapter.encodeDecision` leaves the
  named-code-paths assertion, because the two sections that stated them are
  gone. Both phrases occur only inside those sections; the README's
  "Fail-open guarantee" heading is a claim about dasbo's own design, not a
  duplicate of Antigravity's. The remaining three claims — `notify-only`,
  `has not been verified`, `inferred` — and `codexAdapter.encodeDecision`
  stay.
- `test/site/timeline.test.ts` — the expected agent set becomes
  `['claude', 'codex']`.

Unchanged and expected to keep passing: every adapter test including
Antigravity's, `test/core/install/plan.test.ts`, and
`test/shell/iconAssets.test.ts` — the Antigravity mark stays in the tree, so
its brand-colour assertion still holds.

The preferences rows themselves are not unit-tested. Building an
`Adw.ActionRow` needs a live GTK, which the vitest suite does not have, and
the file has no existing test. The logic worth protecting — which agents
appear and under which status — is in the catalog module, which is tested.

## Out of scope

- Writing adapters for OpenCode or Cursor CLI. This change lists them; it does
  not implement them.
- Any icon for OpenCode or Cursor CLI. Their rows are text, and nothing
  renders a chip for an agent that cannot produce a session.
- Re-verifying Antigravity's permission gate. Turning it back on is a separate
  piece of work with its own spec.
