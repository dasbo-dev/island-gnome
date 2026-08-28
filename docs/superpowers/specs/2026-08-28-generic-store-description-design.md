# A generic store description (DIS-28)

## Problem

`metadata.json` opens by naming two agents:

> Live Claude Code and Codex sessions in the top bar: status, one click back to
> the terminal, and Claude Code permission prompts answered inline.

The landing page no longer reads that way. Its hero says "your coding agents"
and names Claude Code and Codex once, in a Supported agents table at the foot of
the page. The store description should follow the same order: say what the
extension does for any coding agent, then name the agents it supports today.

Naming the agents up front also dates the copy. Every agent added after this
build forces an edit to the first sentence, which is the sentence
extensions.gnome.org truncates into its list view.

## What changes

### `metadata.json` description

Four paragraphs:

```
Live coding agent sessions in the top bar: status at a glance, one click back to the terminal, and permission prompts answered where supported.

Preferences can add hook entries to an agent's own config file, ~/.claude/settings.json or ~/.codex/hooks.json; this happens only when you press Install hooks. A .dasbo.bak copy is written before the first change, and Remove hooks takes the entries back out again. The hook itself is hooks/dasbo-hook, a readable GJS script that the agent runs, not the extension.

This build supports Claude Code, with status and permission prompts, and Codex CLI, with status only.

Not affiliated with or endorsed by Anthropic, OpenAI or Google.
```

Paragraph 1 is 143 characters, inside the 150 that the list view keeps.
`Claude Code` and `Codex CLI` appear in one paragraph, the third.

Three things this wording protects:

- **The permission claim stays honest.** Codex hooks are installed notify-only
  (`docs/limitations.md`, "Codex has no permission gate"), so an unqualified
  "permission prompts answered" is false for half the agents this build
  supports. `where supported` carries the qualification without a brand name,
  and the third paragraph says which agent has it.
- **The disclosure survives.** The DIS-14 review added the second paragraph
  because the extension writes into other applications' config files and the
  description said nothing about it. The prose around the paths becomes generic;
  the paths, the Install hooks precondition, the `.dasbo.bak` backup, the
  Remove hooks reversal and the "readable GJS script" framing all stay.
- **The disclaimer stays.** Three vendors' marks still ship: `prefs.ts` lists an
  `Antigravity CLI` row and `dist/icons/antigravity.svg` carries Google's brand
  colours, so the description must still refuse the endorsement reading.

### `~/.gemini/config/hooks.json` and Antigravity leave the description

The current description names the gemini path and qualifies it as "reserved for
Antigravity support, not enabled in this build". Both go.

The qualification was accurate but self-inflicted: the path was named, so it
needed explaining. Nothing in this build writes it. `agentCatalog.ts` marks
`antigravity` as `coming-soon`, and `prefs.ts` gives a coming-soon row no
Install button, so no reachable path in the shipped UI produces that write.
A description of what the extension does should not carry a file it never
touches.

**Accepted risk.** `src/core/install/plan.ts` still builds the gemini path and
its hook entries, so a store reviewer who greps the source finds write code the
description does not mention. The mitigation is the catalog gate above, not the
copy. If a reviewer asks, the answer is that the code is unreachable in this
build; if Antigravity ships, the path returns to the description along with it.

### `site/index.html` head

Two tags still name the agents while the visible copy no longer does:

- `<meta name="description">` becomes
  `GNOME Shell extension for coding agents: every live session in the top bar, permission prompts answered where supported, one click back to the terminal.`
  (152 characters, inside the 160 the test allows, and still unequal to the
  og:description.)
- The JSON-LD `description` becomes
  `A GNOME Shell extension that keeps every live coding agent session in the top bar.`

**Accepted cost.** The search snippet stops carrying "Claude Code" and "Codex".
The page still names both in its Supported agents table and in the copy around
it, so it remains indexable for those terms; only the snippet loses them.

Nothing else on the landing page changes. The hero, the cards and the Supported
agents table are already generic-then-specific.

### `test/core/metadata.test.ts`

The tests are where these decisions are actually pinned, so they move with the
copy.

Removed:

- `~/.gemini/config/hooks.json` from the disclosed-paths loop.
- The whole `qualifies the gemini path as reserved, not written, in this build`
  test. It guards a sentence that no longer exists.

Added, mirroring `test/site/indexCopy.test.ts`, which already pins the landing
page's subhead free of `Claude` and `Codex` for the same reason:

- The first paragraph names no agent and no vendor: none of `Claude`, `Codex`,
  `Antigravity`, `Gemini`, `Anthropic`, `OpenAI` appear in it.
- `Claude Code` and `Codex CLI` appear in exactly one paragraph between them, so
  a later edit cannot scatter the names back through the copy.
- `Antigravity` and `.gemini` are absent from the description, so the path
  cannot quietly return while the install code stays unreachable.

Changed:

- The scoping test. It currently keys on the word `inline` and demands
  `Claude Code permission` before it. The new copy does not use `inline`, so
  that test would pass while checking nothing. It becomes: any paragraph before
  the agents paragraph that claims permission prompts are answered must also
  carry the `where supported` qualifier.

Unchanged: the 150-character truncation test, the agents-are-named test, the
disclosure test for the two remaining paths and the four other tokens, the
affiliation disclaimer, the gettext-domain test, the session-modes test.

### `CHANGELOG.md`

One entry under `[Unreleased]` → `Changed`, recording that the store
description now leads with what the extension does rather than which agents it
does it for, and that the reserved gemini path left the copy because this build
never writes it.

### Out of scope

- `dist/metadata.json` is a build artifact. `build.mjs` copies the source file
  into `dist/`; nobody edits it by hand.
- `README.md` and its Supported agents table. The README is a developer
  document that leads with what it supports, and the issue is about the store
  description.
- The extension's own strings, the prefs UI and the agent catalog. No behaviour
  changes here, only copy.

## Verification

- `npx vitest run` — the full suite, including the rewritten
  `test/core/metadata.test.ts` and the untouched `test/site/head.test.ts`
  length and JSON-LD checks.
- `node -e` length check on the two rewritten strings, against 150 for the
  store paragraph and 160 for the meta description, so the numbers in this spec
  are measured rather than counted by eye.
- `npm run build` to confirm `metadata.json` still parses and
  `dist/metadata.json` picks up the new text.

## What this does not need

No smoke test on a live GNOME session. The description is store metadata and
head markup; no runtime code path reads either.
