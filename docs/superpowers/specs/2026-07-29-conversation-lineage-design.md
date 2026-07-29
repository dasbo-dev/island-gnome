# Conversation lineage: reset the row timer on `/clear`, and show which conversation it is

Date: 2026-07-29

## Problem

A session row's elapsed clock does not reset when the user runs `/clear`. The
clock is seeded from `startedAt`, which `SessionStore.ensure` sets to
`e.agentStartedAt ?? e.ts` — the agent process's own start time, read from
`/proc`. `/clear` does not restart the process, so the number keeps climbing
across a conversation boundary and reports the age of the shell rather than the
age of the work.

That seeding is not a mistake. It was added so a record rebuilt after a reap or
an extension reload reports the same elapsed rather than restarting at the
current task. It is right for `startup` and `resume`, and wrong for `/clear`.

## What `/clear` actually emits

Measured against Claude Code by driving an interactive session in a pty with
`SessionStart` and `SessionEnd` hooks logging their payloads:

```
SessionEnd    session_id=aeb2a694…   reason: "clear"
SessionStart  session_id=fd659c05…   source: "clear"
```

Three facts follow, and the design rests on them:

- `/clear` ends the old session and starts a new one. The two are distinct
  `session_id`s, so they are distinct records in the store.
- `SessionEnd` arrives **before** `SessionStart`. The outgoing row is already
  `done` by the time the incoming one is created.
- The payloads carry `source` and `reason`, which the Claude adapter currently
  discards.

`/compact` also reports a `source` of `"compact"`, but its event shape does
**not** mirror `/clear`'s — see Risks.

## Goals

- The clock measures the current conversation, not the agent process.
- The row says which conversation it is, and how long the shell has been up.
- The existing `/clear` behaviour is otherwise unchanged: the outgoing row goes
  `done`, shows green, and lingers for `doneLingerSeconds` before the reaper
  drops it.

## Non-goals

- Persisting anything to disk. See Accepted limitations.
- Recording a finished conversation's duration as a separate stored value. The
  outgoing row displays its own final duration for the length of its linger,
  which is where that information already lives.
- Freezing a `done` row's clock. Pre-existing behaviour, separate change.

## Display

```
dasbo-island  1h                  #3 8m  [Jump]
● Running Bash: npm test
```

- The right-hand clock carries the conversation number and the current
  conversation's age: `#3 8m`, no separator between them.
- A dim suffix after the project name carries the agent process's total uptime:
  `1h`.

Both durations render through the existing `formatElapsed`, which reports the
largest whole unit and nothing finer — `1h`, never `1h 20m`. The mockups drawn
during design showed `1h 20m`; that was illustrative. Matching the clock the row
already has is worth more than the extra precision, and a second format would be
a second thing to keep consistent.
- Both extras are hidden until the first `/clear`. On a first conversation the
  number is always `#1` and the shell total equals the conversation age, so both
  are noise.

## Data model

### `src/core/types.ts`

`AgentEvent` gains one field:

```ts
/**
 * Set when this event begins a conversation distinct from the one before it,
 * in an agent process that keeps running. Only adapters whose dialect can tell
 * set it; absence means "same conversation, or no way to know".
 */
startsNewConversation?: boolean
```

`Session` gains two, and one existing field changes meaning:

```ts
/** 1-based. Which conversation this is within its agent process. */
conversationIndex: number
/** When the agent process started, for the shell-total suffix. Undefined when /proc was unreadable. */
processStartedAt?: number
/** CHANGED: when the current conversation began — no longer the process start. */
startedAt: number
```

`startedAt`'s doc comment must change with it. The old comment explains the
`/proc` seeding, and that rationale now belongs on `processStartedAt`.

### `src/core/adapters/claude.ts`

On `SessionStart`, read `source` and set `startsNewConversation` for `clear` and
`compact`.

This is an allowlist, not "anything that isn't `startup` or `resume`". If Claude
Code adds a source we do not know, missing a reset leaves today's behaviour,
whereas a spurious reset would zero a live timer. Codex and Antigravity never
set the field.

### `src/core/store.ts`

```ts
interface Lineage {
  pid: number
  processStartedAt: number
  count: number
  conversationStartedAt: number
}
private lineages = new Map<string, Lineage>()   // `${agent}:${pid}:${processStartedAt}`
```

The key needs `processStartedAt` as well as the pid because the kernel reuses
pids; the pair identifies one process for as long as it lives. `agentStartedAt`
is optional on the event, so the key uses `e.agentStartedAt ?? 0` and `Lineage`
stores the same resolved number — a process whose `/proc` start time could not
be read still gets a lineage, keyed on its pid alone, and simply shows no shell
total.

`apply(e)`, in order:

1. If `e.pid === 0`, skip the lineage entirely. `resolveAgent` returns 0 when it
   cannot read `/proc` or cannot identify the agent, so there is no stable
   identity to key on. The record falls through to exactly today's behaviour:
   index 1, `startedAt = agentStartedAt ?? ts`.
2. Otherwise look up the lineage, creating it lazily as
   `{ count: 1, conversationStartedAt: e.agentStartedAt ?? e.ts }`.
3. If `e.startsNewConversation`, then `count++` and
   `conversationStartedAt = e.ts`.
4. `ensure()` builds a **new** record from the lineage:
   `startedAt = conversationStartedAt`, `conversationIndex = count`,
   `processStartedAt = e.agentStartedAt`.
5. If `e.startsNewConversation` arrives for a session that **already exists**,
   rewrite that record's `startedAt` and `conversationIndex` from the lineage.

Step 5 exists so the design is correct whether or not `/compact` mints a new
`session_id`. Step 4 alone is sufficient for `clear`, which mints one. It is
not sufficient for `compact`, which does not — see Risks. Step 5 is what
makes compaction move the count at all.

Existing records are never otherwise rewritten, and that is what makes the
`/clear` sequence work. `SessionEnd` lands first, so the outgoing row keeps its
own start and its own index and displays its final duration for the length of
its linger. The incoming row is built fresh from the bumped lineage.

**Pruning.** `reap()` drops a lineage once no session references it and
`pidAlive(pid)` is false. Insertion is capped at `MAX_SESSIONS`, for the same
reason the session map is: a misbehaving or hostile peer on the session bus must
not be able to grow it unbounded. At the cap, no new lineage is created and the
record falls through to the same path as `pid === 0` — index 1 and the `/proc`
start time.

The lineage cap is genuinely independent of the session cap, not a consequence
of it. Lineages are keyed on the process and sessions on the session id, so the
two counts move for different reasons: a peer replaying one session id from
three hundred different pids mints three hundred lineages and exactly one
session. The lineage map therefore needs its own bound rather than inheriting
the session map's, and `store.ts` says so on `lineageFor`. (An earlier draft of
this section claimed the lineage cap could not be reached before the session
cap. That was wrong; a test now demonstrates the case.)

## Rendering

### `src/shell/sessionRow.ts`

The project line becomes a box rather than a bare label, since it now holds two
things:

```
[ project (x_expand, ellipsizes) ][ shell total (dim, fixed) ]
```

The ellipsize stays on the project label alone, so a long project name still
shrinks and the shell total is never clipped — the same reasoning as the
existing note that St's `width` sets a minimum it cannot clamp a child against.

Two labels update on every `tick(now)`:

- `_elapsed` → `#3 8m` when `conversationIndex > 1`, plain `8m` otherwise. One
  label and one string, so `tnum` covers both halves.
- `_shellTotal` → `formatElapsed(now - processStartedAt)`, hidden when
  `conversationIndex <= 1` or `processStartedAt` is undefined. Hidden rather
  than blanked: `ClutterBoxLayout` only spaces between *visible* children, so an
  empty label would still cost the row its 6px gap.

### `stylesheet.css`

```css
.dasbo-row-title { spacing: 6px; }
.dasbo-row-shell-total { font-size: 0.85em; }
```

`.dasbo-row-elapsed`'s `min-width` goes from `3em` to `6em`. The old value fitted
`100h`; the new worst realistic case is `#99 100h`. Those 3em come out of the
activity text's share of the fixed 26em row, so it wraps slightly earlier —
acceptable, since that label already wraps by design.

Dimming is set on the actor, not in CSS: `_shellTotal.opacity = 140`. That
follows the existing finding in this file that St's CSS engine does not honour
`opacity`, which is why `_activity` and the empty-row label already set it
directly. 140 (≈0.55) rather than the 178 used elsewhere, because the shell
total is the least important number in the row and should sit below the activity
text rather than level with it.

Nothing new is needed for text colour: the `:insensitive` override added in
`23c9009` targets `.dasbo-row` itself, so the new labels inherit from it.

## Testing

All the logic worth testing is pure and lives in `src/core`.

`test/core/store.test.ts`

- `startup` → index 1, `startedAt` = `agentStartedAt`
- `clear` with a new session id → index 2, `startedAt` = event ts
- `compact` → index 3, same session id rewritten in place (measured in Risks)
- the outgoing record keeps its own `startedAt` and index after a clear
- `pid: 0` → no lineage, index 1, `startedAt` = `agentStartedAt`
- a fresh store whose first event is a plain `tool-start` → index 1, pinning the
  reload case as intended behaviour rather than leaving it to drift
- the lineage survives the outgoing session being reaped: the new row keeps its
  index
- `reap` drops a lineage once unreferenced and `pidAlive` is false, and keeps it
  while the pid lives
- the lineage map is bounded at `MAX_SESSIONS`

`test/core/adapters/` — Claude sets `startsNewConversation` for `clear` and
`compact`, and leaves it undefined for `startup`, `resume`, an unknown source,
and any non-`SessionStart` event.

The row itself gets no unit test; it needs a live shell. Verify it the way the
popup colour fix was verified — a throwaway probe extension in a nested
`gnome-shell`, reading the rendered label text back.

## Risks

**`/compact` does not mirror `/clear`.** Measured with the same pty probe,
against a real conversation with two prior prompts (compaction reported
"Not enough messages to compact." on a single-turn conversation, so this took
a second, longer-conversation run to observe honestly):

```
SessionStart  session_id=926d57bf…   source: "startup"
SessionStart  session_id=926d57bf…   source: "compact"
SessionEnd    session_id=926d57bf…   reason: "prompt_input_exit"
```

Both `SessionStart` lines carry the **same** `session_id`. `/compact` does not
end the old session and start a new one the way `/clear` does — it reuses the
session in place. No `SessionEnd` with `reason: "compact"` was observed at any
point; the single `SessionEnd` above comes from the later `/exit`, not from
compaction.

This is the second of the brief's three possible outcomes: `/compact` mints a
`SessionStart` (so it can be detected via `source`), but does not mint a new
`session_id`. That makes step 5 of `apply` — "if `startsNewConversation`
arrives for a session that already exists, rewrite that record's `startedAt`
and `conversationIndex` from the lineage" — **load-bearing for compaction, not
belt-and-braces**. Step 4 alone (build a new record for a new `session_id`) is
sufficient for `/clear`; it never fires for `/compact`, because `/compact`
never presents a new `session_id`. Task 4's in-place rewrite is the only
mechanism that makes the conversation count move when compaction occurs, and a
reviewer should weigh it accordingly: without it, `'compact'` in Task 2's
allowlist would set `startsNewConversation` on an event `store.apply` has no
way to act on, and the count would silently fail to advance.

## Accepted limitations

1. A shell or extension reload mid-conversation resets the count to 1 and the
   timer to process start, because the lineage is in memory and no
   `SessionStart` replays. It self-corrects at the next `/clear`. Not documented
   in the README: the loss is cosmetic and nothing depends on it.
2. Claude-only. `source` has no Codex or Antigravity equivalent, so their rows
   keep the count at 1 and show no shell total. No code path special-cases them;
   they simply never signal a new conversation.
3. An unresolved pid (0) means no lineage, so the row behaves exactly as it does
   today.
4. An extension enabled mid-shell undercounts until the next clear. If the first
   event it ever sees is a clear, the count lands on 2 — an honest lower bound.
5. A `done` row's clock keeps ticking during its linger. Pre-existing.
6. A suspend/resume can split a live agent's lineage. The key is
   `${agent}:${pid}:${agentStartedAt}`, and `windowFinder.ts` already documents
   `agentStartedAt` as jittering by about a second across a suspend — the boot
   time the `/proc` figure is derived from is re-derived after the clock jumps.
   A lid close mid-conversation therefore re-keys the same live process: the
   count restarts at 1, the conversation clock restarts, and the old entry
   survives until the map fills, because its pid is still alive and so
   `pruneLineages` will not collect it. Chosen deliberately over re-keying on a
   boot-relative tick count, which would be stable across suspend but would put
   a second time base into the store for a cosmetic gain. It self-corrects at
   the next `/clear`, which mints a fresh lineage from the post-resume key and
   counts forward from there.
7. Automatic compaction resets the clock without the user typing anything.
   Compaction is treated as a new conversation, and Claude Code compacts on its
   own when the context window fills, so a row sitting at `2h` can drop to
   `#2 0s` with no user action. Be clear about what is measured here: manual
   `/compact` was measured to emit `SessionStart` with `source: "compact"` (see
   Risks). That *automatic* compaction emits the same event was **not**
   measured — it is inferred, and if it turns out to emit something else, this
   limitation simply does not arise. Accepted either way, because the dim
   shell-uptime suffix appears at the very same moment the number does: it is
   hidden while `conversationIndex <= 1`, so the instant the clock resets the
   row also starts showing the terminal's true age beside the project name. The
   row never claims the terminal is new; it claims this conversation is.

## Migration

None. For a session that has never been cleared, the conversation start equals
the process start, so existing rows show the same number after the upgrade as
before.

## Files touched

- `src/core/types.ts`
- `src/core/adapters/claude.ts`
- `src/core/store.ts`
- `src/shell/sessionRow.ts`
- `stylesheet.css`
- `test/core/store.test.ts`
- `test/core/adapters/`
