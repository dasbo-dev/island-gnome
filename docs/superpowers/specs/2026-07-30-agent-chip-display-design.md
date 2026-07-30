# Agent chip display mode

The chip added by [the agent chip design](2026-07-30-agent-chip-design.md)
shows a mark and a short name on every session row, always both. That was the
right default and the wrong fixed choice: someone who runs one agent knows the
mark on sight and is paying for `Claude` in a title line where the project name
is the thing that ellipsizes, while someone else finds the marks
indistinguishable at 14px and wants words.

This adds one setting with three values — mark only, mark and name, name only —
applied live to every visible row.

## Decisions

| Question | Decision |
|---|---|
| What is configurable? | The row chip only. Nothing else in the UI names an agent |
| Values | `logo`, `logo-name`, `name` |
| Default | `logo-name` — today's appearance |
| When does a change land? | Live: open popup updates without waiting for a rebuild |
| Mark file missing in `logo` mode? | Show the name instead |
| Chip chrome | The grey pill stays in all three modes; only its contents change |
| Popup width | Unchanged. `.dasbo-fixed-width` is fixed, so only the project label's share of the title row moves |

## The setting

A new key in `schemas/org.gnome.shell.extensions.dasbo-island.gschema.xml`:

```xml
<key name="agent-chip-display" type="s">
  <choices>
    <choice value="logo"/>
    <choice value="logo-name"/>
    <choice value="name"/>
  </choices>
  <default>'logo-name'</default>
  <summary>What the agent chip on a session row shows</summary>
  <description>The mark alone, the mark with a short name, or the name alone. A row whose mark is missing shows the name whatever this says.</description>
</key>
```

An enum string with `<choices>`, following `panel-position`, rather than an
int: `gsettings get` reads plainly, and GSettings rejects an unlisted value at
the source instead of leaving the shell to interpret a stray number.

In `src/prefs.ts` it is an `Adw.ComboRow` with the model
`['Logo only', 'Logo and name', 'Name only']`, its index mapped to the value
through an `order` array exactly as `panel-position` is — `settings.bind` has
no string-to-index binding, so the mapping is written out both ways.

It goes in a **new group on the Appearance page**, titled for the popup rows,
not into the existing **Panel** group. That group is entirely about where the
pill sits in the top bar; the chip is inside the popup, and filing it there
would make the group's title a lie.

## The decision, in core

`src/core/chipDisplay.ts`, pure, importing nothing from `gi://`:

```ts
export type ChipDisplay = 'logo' | 'logo-name' | 'name'

export function chipParts(mode: string, hasIcon: boolean): { icon: boolean; label: boolean }
```

| mode | hasIcon | icon | label |
|---|---|---|---|
| `logo` | true | ✓ | — |
| `logo` | false | — | ✓ |
| `logo-name` | true | ✓ | ✓ |
| `logo-name` | false | — | ✓ |
| `name` | either | — | ✓ |
| unrecognised | either | as `logo-name` | ✓ |

Three properties this shape buys:

- **A chip is never blank.** `icon || label` holds for every input, junk
  included. `logo` with no mark degrades to the name, which is the same
  fail-open rule `agentIcon.ts` already applies when it returns `null` rather
  than throwing or substituting a stock icon: a missing decoration must not
  cost the user the ability to tell one row from another.
- **`icon` is never true without a mark to draw.** The caller cannot be handed
  an instruction it has no actor for.
- **An unknown mode is a value, not an exception.** Today `get_string` on a
  key with `<choices>` can only return one of the three. A future release that
  adds a fourth, read by an older installed copy, would otherwise throw inside
  a row build — and an exception there takes the whole popup rebuild with it.

The parameter is `hasIcon: boolean` rather than a `Gio.Icon | null`, which is
what keeps the module runnable under Node and inside `test/core/purity.test.ts`.

## Wiring

**`src/shell/agentChip.ts`.** The constructor takes the mode as a third
argument. It builds the same children it builds today — the `St.Icon` only when
`agentGicon` returns non-null — and now keeps `_icon: St.Icon | null`,
`_label: St.Label` and `_hasIcon: boolean` on fields. A new
`setMode(mode: string)` calls `chipParts(mode, this._hasIcon)` and assigns
`visible` on each child. The constructor calls `setMode` itself, so the first
paint is already in the right shape rather than flashing the default.

The class comment saying the chip deliberately has no update method is
rewritten rather than deleted. What it was protecting is still true and still
worth stating — `sessionKey` is `${agent}:${sessionId}`, so a row's *agent*
cannot change under it — but it currently reads as a blanket ban on mutation,
which the display mode now breaks. The distinction is the point: identity is
fixed for the row's life, presentation is not.

**`src/shell/sessionRow.ts`.** Takes the mode and passes it to the chip, and
holds the chip on a field — the current comment explains it is a local because
nothing ever needs to reach it again, which stops being true here. A
`setChipMode(mode: string)` delegates to the chip.

**`src/shell/island.ts`.** Reads `agent-chip-display` into `_chipMode` when it
builds, passes it to every `new SessionRow(...)`, and connects
`changed::agent-chip-display` to a handler that updates `_chipMode` and loops
`this._rows` calling `setChipMode`.

The handler deliberately does **not** call `_rebuildRows()`. Toggling `visible`
relayouts on its own, and a rebuild is not free of consequence. Rows are reused
across rebuilds precisely so that permission controls, question panels and task
lists survive; tearing one down mid-decision would destroy a
`PermissionControls` whose closures are the only path to resolving a pending
request.

`_settingsChangedId` becomes `_settingsChangedIds: number[]`, disconnected in a
loop on destroy, matching `_settingsIds` in `extension.ts`. A second bespoke
field for a second handler is the shape that invites a third to be forgotten.

Three ways to get the mode to the chip were considered:

- **Build both children once and toggle `visible`** — no actor churn, and the
  chip keeps a single construction path.
- **Rebuild the chip's children on every change** — destroys and re-adds
  actors to express something `visible` already expresses.
- **Let each chip read `Gio.Settings` itself** — no plumbing through `Island`
  and `SessionRow`, but it puts a signal to disconnect on every row and moves
  settings access into a leaf widget. `Island` owns settings in `src/shell/`
  today; nothing below it reads them.

**Toggling visibility is chosen**, and the third option is turned into a test
rather than left as a convention.

## Testing

`test/core/chipDisplay.test.ts` — real unit tests, no source-text matching:

- Every row of the table above, asserted directly.
- `icon || label` holds across all `(mode, hasIcon)` pairs plus a junk mode.
- `hasIcon: false` never yields `icon: true`.
- An unrecognised mode behaves exactly as `logo-name`.

`test/shell/agentChip.test.ts` — source-text guards, this file's existing style
since GJS widgets do not load under vitest:

- The chip calls `chipParts` rather than branching on the mode string itself,
  keeping one decision site.
- The chip contains no `get_string` and no `Gio.Settings` — the rejected
  self-reading design, made enforceable.
- `sessionRow.ts` exposes `setChipMode`, and `island.ts` calls it from a
  `changed::agent-chip-display` handler.
- That handler does not call `_rebuildRows`.

Two guards in that file change with the code rather than merely surviving it:

- `'has no update method, because a row never changes agent'` matches
  `/\bupdate\s*\(/`, which `setMode` slips past — the test would stay green
  while the claim in its name went stale. It is rewritten to assert what is
  still true: no method takes an `AgentId` or a session, and the agent captured
  in the constructor is never reassigned.
- The title-order guard matches `titleRow.add_child(chip)` literally and must
  follow the chip onto `this._chip`.

A new small guard pairs the schema with the prefs UI: every `<choice value>`
for `agent-chip-display` appears in the prefs `order` array, and that array is
the same length as the `Gtk.StringList` model. Index-to-string combo mapping is
hand-written in two places, which is exactly the pair that drifts, and
`panel-position` is already exposed to the same risk.

Not automatable here, so stated as manual verification: install, open the popup
with a live session, switch each of the three modes, and confirm the chip
changes while the popup stays open and the project label reflows into the room
it gains.
