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
**not** mirror `/clear`'s — see Risks. It is detectable and deliberately not
counted; see the adapter section.

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
 * Set when this event announces that the user has asked for a conversation
 * distinct from the one before it, in an agent process that keeps running.
 * Only adapters whose dialect can tell set it; absence means "same
 * conversation, or no way to know". It announces rather than begins: the
 * store arms the lineage here and waits for the next prompt.
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

On `SessionStart`, read `source` and set `startsNewConversation` for `clear`.

This is an allowlist, not "anything that isn't `startup` or `resume`". If Claude
Code adds a source we do not know, missing a reset leaves today's behaviour,
whereas a spurious reset would zero a live timer. Codex and Antigravity never
set the field.

`compact` is **not** in the allowlist, though it was in the first version of
this design and does arrive as a `SessionStart` (see Risks for the
measurement). Compaction is the same conversation with its history summarised,
and Claude Code compacts on its own when the context window fills, so counting
it moved a row's number and reset its clock with nobody having asked for
anything — the failure recorded as accepted limitation 7 below. `/clear` is
the only source that means the person at the keyboard wanted a fresh start.

### `src/core/store.ts`

```ts
interface Lineage {
  pid: number
  processStartedAt: number
  count: number
  conversationStartedAt: number
  /** A `/clear` has been seen and no prompt has followed it yet. */
  pendingNewConversation: boolean
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
   `{ count: 1, conversationStartedAt: e.agentStartedAt ?? e.ts,
   pendingNewConversation: false }`.
3. If `e.startsNewConversation`, set `pendingNewConversation` and move nothing
   else. Then, if `pendingNewConversation` is set **and** `e.kind` is
   `prompt-submit`, `count++`, `conversationStartedAt = e.ts`, and clear the
   flag. A conversation begins when the user says something into the emptied
   box, not when the box empties: a clear the user walks away from counts for
   nothing, and clearing twice with nothing said between counts once. Setting a
   flag rather than incrementing is what makes both of those fall out for free.
   `prompt-submit` alone, never any other event — hooks fire throughout a
   conversation on their own and none of the rest mean a human spoke.
4. `ensure()` builds a **new** record from the lineage:
   `startedAt = conversationStartedAt`, `conversationIndex = count`, seeding
   `processStartedAt = e.agentStartedAt` at creation. `apply` then refreshes
   that field from every event carrying one — not only the record's first —
   so a session that outlives its process still reports the live process's
   uptime.
5. If the bump in step 3 fires for a session that **already exists**, rewrite
   that record's `startedAt` and `conversationIndex` from the lineage.

Step 5 is now the ordinary path, not a fallback. The clear presents a new
`session_id`, so step 4 builds that record — unnumbered, since the clear moves
nothing — and the prompt that begins the conversation arrives afterwards, by
which time the record exists. Step 4 still matters for the case where the
prompt is the first event the store sees for a session id, which happens if the
clear's `SessionStart` was missed or its record was reaped in between.

Existing records are never otherwise rewritten, and that is what makes the
`/clear` sequence work. `SessionEnd` lands first, so the outgoing row keeps its
own start and its own index and displays its final duration for the length of
its linger. The incoming row opens on the outgoing conversation's number and
clock, and holds them until the user speaks.

**The cap can refuse the bump.** `ensure()` returns null at `MAX_SESSIONS`,
after step 3 has already landed, so the count, the conversation clock and the
pending flag are all rolled back together. The clear is then owed rather than
lost: the flag goes back to set, and the next prompt that does get a record
collects it.

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
- `clear` with a new session id, and no prompt yet → index and clock unmoved
- the prompt after it → index 2, `startedAt` = the prompt's ts, rewritten in
  place on the record the clear created
- two clears with nothing said between them → one conversation
- a second prompt in the same conversation → nothing moves
- a prompt with no clear before it → nothing moves
- the outgoing record keeps its own `startedAt` and index after a clear
- `pid: 0` → no lineage, index 1, `startedAt` = `agentStartedAt`
- a fresh store whose first event is a plain `tool-start` → index 1, pinning the
  reload case as intended behaviour rather than leaving it to drift
- the lineage survives the outgoing session being reaped: the new row keeps its
  index
- `reap` drops a lineage once unreferenced and `pidAlive` is false, and keeps it
  while the pid lives
- the lineage map is bounded at `MAX_SESSIONS`

`test/core/adapters/` — Claude sets `startsNewConversation` for `clear`, and
leaves it undefined for `compact`, `startup`, `resume`, an unknown source, and
any non-`SessionStart` event.

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
`session_id`.

The measurement stands; the conclusion drawn from it does not. This paragraph
originally argued that step 5's in-place rewrite was load-bearing *for
compaction*, since step 4 never fires for an event that presents no new session
id. Compaction is no longer counted at all (see the adapter section), so that
argument is void — and step 5 turned out to be load-bearing anyway, for the
much more ordinary reason that deferring the bump to the prompt means it always
arrives after the record exists.

What the measurement is still good for: it is the evidence that a compaction is
distinguishable at all. Should the count ever want to reflect compactions
again, `source: "compact"` is how, and the in-place rewrite is the mechanism
that would carry it.

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
   A lid close mid-conversation therefore re-keys the same live process, but
   the live record itself is untouched: `ensure` returns the existing session,
   so `startedAt` and `conversationIndex` do not move, and the only visible
   change at resume is the dim shell-total suffix jumping by the jitter, since
   that reads `processStartedAt`, which is refreshed on every event. The
   damage lands on the *next* conversation instead. The resume silently mints
   a fresh lineage under the post-jitter key, orphaning the one the live
   record was numbered from — count and all. The next `/clear` bumps that
   fresh lineage up from 1, so the record it creates opens on a count that is
   low by however many conversations preceded the suspend, and nothing ever
   restores the difference: every conversation after the suspend is
   undercounted by that same fixed amount for the life of the process. Chosen
   deliberately over re-keying on a boot-relative tick count, which would be
   stable across suspend but would put a second time base into the store for a
   cosmetic gain.
7. ~~Automatic compaction resets the clock without the user typing anything.~~
   **Fixed, not accepted.** Compaction was treated as a new conversation, and
   Claude Code compacts on its own when the context window fills, so a row
   sitting at `2h` could drop to `#2 0s` with nobody having asked for anything.
   The original entry accepted it on the grounds that the dim shell-uptime
   suffix appears at the same moment the number does, so the row never claims
   the terminal is new — true, and beside the point: the row still claimed a
   conversation had begun when none had. `compact` left the allowlist and the
   bump now waits for a prompt, which closes it from both directions.
8. A conversation begun in a process the extension has never seen an event from
   is numbered 1 even if it is the tenth. Unchanged in kind from limitation 1
   and 4 — the lineage is in memory and nothing replays — but the deferred bump
   widens the window very slightly: a shell reload landing between a `/clear`
   and its first prompt now loses the arming as well as the count. It
   self-corrects at the next clear.
9. A `/clear` whose `SessionStart` the store never receives is never counted,
   even once the conversation is well underway. Prompts alone cannot detect
   one: a prompt is ordinary inside a conversation, and the arming is the only
   thing that distinguishes the first one after a clear from the tenth in the
   middle. Accepted for the same reason as the rest of this list — a number in
   a row is one low, and nothing else depends on it.

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
