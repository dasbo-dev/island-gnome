# Agent chip on the session row

Every session row names its project. None of them name the agent running it.
With Claude Code, Codex CLI and Antigravity CLI all able to hold live sessions
at once, the popup shows a stack of rows whose most basic distinction — which
agent is doing the work — is invisible. The pill's 2×2 grid reflects the
busiest session's *state*, never its identity.

This adds a chip to each row's title line: the agent's mark, then its short
name, then the project. `[◆ Claude] dasbo-island`.

## Decisions

| Question | Decision |
|---|---|
| Where does the mark come from? | Bundled per-agent SVG in the extension |
| Symbolic or full colour? | Full colour, hand-authored, brand fills baked in |
| When does the chip show? | Always, on every row |
| Where on the line? | After the expander arrow, before the project name |
| What text? | A new `shortName` field: `Claude`, `Codex`, `Antigravity` |
| Who pays for the width? | The popup: `.dasbo-fixed-width` 26em → 30em |

Two consequences accepted rather than solved:

- **Full-colour marks do not follow the shell theme.** A symbolic
  (`currentColor`) mark would recolour with light/dark; these will not.
  Recognisability was preferred to adaptation.
- **Project names no longer align down the popup's left edge.** Chip widths
  differ per agent, so the name starts at a ragged x offset. Leading the line
  was preferred so the row reads as one phrase: *Claude, on dasbo-island*.

## Architecture

The chip's only non-obvious dependency is the extension's own directory on
disk, which is where the SVGs live. Three ways to give a leaf widget that path
were considered:

- **Thread it from `extension.ts`** through `Island` into each `SessionRow`.
  Explicit, matches the injection already used for `glibTimers` into
  `PermissionTable` and `settings` into `Island`. Costs two constructors a
  passenger.
- **A module-scope base path**, set once by an `initIconBase()` call from
  `enable()`. Nothing threads. But a future entry point that forgets the call
  loses every icon *silently* — the failure mode this codebase writes comments
  to prevent.
- **Register `icons/` with the shell's icon theme** and address the marks by
  `icon_name`. Least code, but leans on theme-search behaviour that varies
  across shell versions and puts three names into a global namespace.

**Threading is chosen.** No mutable module state; the path's provenance is
readable from any call site.

### Units

```
extension.ts ──this.path──► island.ts ──iconBase──► sessionRow.ts ──► agentChip.ts
                                                                          │
                                                              agentIcon.ts│ (gicon or null)
                                                                          │
                                                            src/icons/<agent>.svg
```

**`src/core/adapters/*.ts` — `shortName`**

`AgentAdapter` gains `shortName: string` beside `displayName`: `'Claude'`,
`'Codex'`, `'Antigravity'`. The chip must not say "Claude Code" or
"Antigravity CLI" — the suffix is width spent on a word that distinguishes
nothing at 30em. Pure strings, no `gi://`, so `test/core/purity.test.ts` stays
green.

**`src/shell/agentIcon.ts` — where a mark lives**

```ts
agentGicon(base: string, agent: AgentId): Gio.Icon | null
```

Builds `<base>/icons/<agent>.svg`, checks `query_exists` once, wraps it in a
`Gio.FileIcon`. The result — including `null` — is memoised in a module `Map`
keyed `` `${base}:${agent}` ``. Rows are long-lived (`island.ts` keeps a
`Map` and calls `update()` rather than rebuilding), so this is not a hot path;
the cache exists so a *missing* file cannot become a per-row `stat`, and so the
sync existence check runs at most three times per shell session.

Files are named by `AgentId`, not by display name, so the resolver is a string
join with no lookup table to drift out of step.

**`src/shell/agentChip.ts` — the widget**

A `GObject.registerClass`'d `St.BoxLayout` (`.dasbo-agent-chip`) built from
`(agent, iconBase)`, holding an `St.Icon` (`icon_size: 14`, `gicon`) and an
`St.Label` carrying `shortName`.

It has no `update()` method, deliberately: `sessionKey` is
`` `${agent}:${sessionId}` `` (`core/types.ts`), so a row's agent is fixed for
the row's entire life. A chip that could change its agent would model a
transition that cannot occur.

The icon is omitted from the box entirely when `agentGicon` returns `null`. The
chip degrades to a bare name — never an empty gap, never a broken-image glyph.

`opacity` is pinned on the icon actor rather than set in CSS. St's CSS engine
does not reliably honour `opacity` (the finding already recorded on
`PopupHeader`'s empty label and `sessionRow`'s `_shellTotal`), and the row is
built `reactive: false`, so St stamps `:insensitive` on it and the shell theme
paints its descendants disabled-grey.

**`src/shell/sessionRow.ts` — placement**

The chip is inserted into `titleRow` between `_expander` and `_project`, and is
`x_expand: false` with no ellipsize. The project label keeps its
`EllipsizeMode.END`. Width policy is unchanged in kind — the unshrinkable items
stay unshrinkable and the name remains the one thing that yields — there is
simply one more fixed item ahead of it.

**`src/shell/island.ts`**

`Island(store, settings, iconBase)`. Stored, and passed to each
`new SessionRow(...)`.

### Assets

`src/icons/`, three hand-authored 16×16-`viewBox` SVGs with fills baked in:

| File | Mark |
|---|---|
| `claude.svg` | Terracotta (`#d97757`) radial burst |
| `codex.svg` | Mid-grey (`#9e9e9e`) rounded hex outline. Codex's own mark is black, which is invisible against GNOME's dark popup; this is the grey `.dasbo-dot` already uses, known to read under both themes |
| `antigravity.svg` | Blue (`#4285f4`) arrow inside an orbit arc |

These are marks drawn for this extension — recognisable in silhouette, not
pixel-faithful to any official brand file. Replacing them later with real ones
is a file swap, no code change.

`build.mjs` gains `src/icons` to its copy step, beside the existing `schemas`
and `hooks` copies, landing them at `dist/icons/`. `make install` already
copies all of `dist/.` and `make pack` already zips all of `dist`, so neither
target changes. The extension resolves them absolutely, at
`<extension.path>/icons/<agent>.svg`, the same discipline the hook installer
uses.

### Stylesheet

- `.dasbo-fixed-width` — `26em` → `30em`
- `.dasbo-agent-chip` — `border-radius: 99px`, `padding: 1px 6px`,
  `spacing: 4px`, `background-color: rgba(127, 127, 127, 0.18)`. Mid-grey at low
  alpha rather than a white or black wash: it lifts the chip off the popup
  background under both the light and the dark theme, which a fixed
  `rgba(255,255,255,…)` would not.
- `.dasbo-agent-chip-label` — `font-size: 0.85em`, normal weight, so
  `.dasbo-row-project`'s bold still wins the eye and the chip reads as a tag
  rather than as the row's title

The chip needs no colour rule of its own. `.dasbo-row:insensitive` already
resolves to `color: inherit`, and `color` inherits, so the label picks up the
colour the row has already reclaimed from the theme's disabled grey. The chip is
also a plain `St.BoxLayout`, not a non-reactive `PopupBaseMenuItem`, so
`insensitiveColor.test.ts` — which scans for `reactive: false` menu items — does
not apply to it and needs no change.

Every `.dasbo-fixed-width` consumer grows together: the header, the empty-state
row, the session rows, and the question panel that wraps against it. Three
prose references to the old `26em` (`core/questions.ts`,
`shell/questionPanel.ts`, `test/shell/noEllipsis.test.ts`) are corrected in the
same change — a stale number in a comment is how the next reader is misled.
`core/popupSize.ts` governs height only and is untouched.

## Error handling

Every path fails soft, consistent with the README's fail-open guarantee.

| Path | Behaviour |
|---|---|
| SVG missing | `agentGicon` returns `null`; chip renders the name alone |
| SVG malformed | St logs a load failure, the icon draws blank, the row is otherwise intact — nothing to guard, no throw to catch |
| `iconBase` empty or wrong | `query_exists` is false; name-only chip, cached once |
| Unknown agent | Cannot occur: `Session.agent` is `AgentId` and `adapters` is a total `Record` |

## Testing

Shell code is tested by assertion over source and CSS text — vitest runs
without GNOME, the house style established by `dotAlignment`,
`insensitiveColor` and `noEllipsis`.

**`test/shell/iconAssets.test.ts`** (new) — the load-bearing test. For every
`AgentId`: `src/icons/<id>.svg` exists, contains an `<svg>` with a `viewBox`,
and holds at least one shape element. Plus: `build.mjs` copies `src/icons`. A
rename or a dropped copy step is otherwise a silent feature death — the chip
quietly loses its mark and nothing fails.

**`test/shell/agentChip.test.ts`** (new) —

- `titleRow` adds the expander, then the chip, then the project, in that order
- the chip guards on a null gicon rather than handing it to `St.Icon` blind
- the icon's `opacity` is set on the actor, not in CSS

**`test/shell/popupWidth.test.ts`** (new) — reads `.dasbo-fixed-width`'s value
from the stylesheet and asserts that every prose site quoting a popup width
quotes the same number. The 26em→30em change is precisely the drift this
prevents, so the test ships with the change that would have caused it.

**`test/core/adapters/index.test.ts`** — every `AgentId` has a non-empty
`shortName`, so a fourth agent cannot ship a blank chip.

**Manual verification** — `make install`, reload the shell, then
`tools/fake-agent.js session` once per agent. That tool hardcodes `'claude'` in
its D-Bus call, so it gains an `AGENT` environment override; without it the
mixed-agent popup, which is the entire reason the chip exists, cannot be seen
at all.
