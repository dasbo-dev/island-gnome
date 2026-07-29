# Conversation Lineage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a session row's clock measure the current conversation rather than the agent process, and show which conversation it is plus how long the shell has been up.

**Architecture:** `/clear` ends a Claude Code session and starts a new one inside the same process, so neither a conversation counter nor a conversation start time can live on a `Session` record — a new record is built for each. `SessionStore` gains a second map, keyed on the agent process, that outlives the records it numbers. The Claude adapter is the only thing that knows a `SessionStart`'s `source` means "new conversation"; the store stays agent-agnostic.

**Tech Stack:** TypeScript, esbuild (`npm run build`), vitest (`npm test`), GJS / GNOME Shell 46, St / Clutter, GLib GDBus.

## Global Constraints

- `src/core` must never import `gi://` or `resource://`. Pinned by `test/core/purity.test.ts`.
- `src/core` takes no clock readings. Timestamps arrive on the event as `ts`; `/proc` values arrive as `agentStartedAt`. Both are supplied by the shell layer.
- Durations render through `formatElapsed` in `src/core/format.ts`, which reports the largest whole unit only: `1h`, never `1h 20m`.
- St's CSS engine does not honour the `opacity` property. Dimming is set on the Clutter actor (`label.opacity = 178`), not in `stylesheet.css`.
- `ClutterBoxLayout` only spaces between *visible* children. Hide a label rather than blanking it, or the row keeps paying for its gap.
- `resolveAgent` returns pid `0` when it cannot read `/proc` or cannot identify the agent. Every pid-keyed code path must guard on `pid > 0`.
- Run `npm run typecheck` as well as `npm test` before every commit — vitest transpiles without type-checking, so a type error passes the suite.
- Commit messages follow the repo's existing form: `type(scope): lowercase summary`, body explaining why, ending with:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  ```

**Spec:** `docs/superpowers/specs/2026-07-29-conversation-lineage-design.md`

---

### Task 1: Measure what `/compact` emits

The spec's design is built on a measured `/clear` sequence and an *assumed* `/compact` one. This task turns the assumption into a fact before any code depends on it. Its deliverable is the spec's Risks section, rewritten to say what was observed.

**Files:**
- Create: `/tmp/compactprobe/probe.py` (throwaway, not committed)
- Modify: `docs/superpowers/specs/2026-07-29-conversation-lineage-design.md` (the `## Risks` section)

**Interfaces:**
- Consumes: nothing.
- Produces: a decision for Task 2 — whether `'compact'` belongs in the adapter's allowlist, and whether `/compact` mints a new `session_id` (which decides whether Task 4 is load-bearing or belt-and-braces).

- [ ] **Step 1: Write the probe**

It drives a real interactive Claude Code session in a pty, because `/compact` is a slash command with no headless equivalent. `SessionStart` and `SessionEnd` hooks append their raw stdin to files. A conversation must have content before `/compact` will do anything, so the probe sends a real prompt first.

```python
# /tmp/compactprobe/probe.py
import os, pty, time, json

os.makedirs('/tmp/compactprobe', exist_ok=True)
for f in ('/tmp/compactprobe/start.jsonl', '/tmp/compactprobe/end.jsonl'):
    open(f, 'w').close()

settings = {
    "hooks": {
        "SessionStart": [{"hooks": [{"type": "command",
            "command": "cat >> /tmp/compactprobe/start.jsonl"}]}],
        "SessionEnd": [{"hooks": [{"type": "command",
            "command": "cat >> /tmp/compactprobe/end.jsonl"}]}],
    }
}
open('/tmp/compactprobe/settings.json', 'w').write(json.dumps(settings))

pid, fd = pty.fork()
if pid == 0:
    os.chdir('/tmp/compactprobe')
    os.execvp('claude', ['claude', '--settings', '/tmp/compactprobe/settings.json'])

os.set_blocking(fd, False)
def drain():
    try:
        os.read(fd, 65536)
    except OSError:
        pass

time.sleep(15)                      # TUI startup, fires SessionStart source=startup
drain()
os.write(fd, b'say ok\r')           # /compact needs something to compact
time.sleep(25)
drain()
os.write(fd, b'/compact\r')
time.sleep(45)                      # compaction calls the model; it is not instant
drain()
os.write(fd, b'/exit\r')
time.sleep(5)
drain()
try:
    os.kill(pid, 15)
except ProcessLookupError:
    pass
time.sleep(2)

for name in ('start', 'end'):
    print(f'--- {name} ---')
    for line in open(f'/tmp/compactprobe/{name}.jsonl'):
        line = line.strip()
        if line:
            print(json.dumps(json.loads(line)))
```

- [ ] **Step 2: Run it**

Run: `timeout 150 python3 /tmp/compactprobe/probe.py`

Expected: at least the `startup` `SessionStart` and a `prompt_input_exit` `SessionEnd`. What matters is whether a `SessionStart` with `"source": "compact"` appears, whether its `session_id` differs from the startup one, and whether a `SessionEnd` with `"reason": "compact"` precedes it.

For reference, the same probe run against `/clear` produced exactly this, and the design assumes `/compact` mirrors it:

```
SessionEnd    session_id=aeb2a694…   reason: "clear"
SessionStart  session_id=fd659c05…   source: "clear"
```

- [ ] **Step 3: Record the finding in the spec**

Replace the `## Risks` section of `docs/superpowers/specs/2026-07-29-conversation-lineage-design.md` with what you observed. Write the actual event lines, not a summary. Three outcomes and what each means:

- **`/compact` mirrors `/clear`** (new `session_id`, `SessionEnd` first): the design is correct as written. Say so, and note that Task 4's in-place rewrite is now belt-and-braces rather than load-bearing.
- **`/compact` reuses the `session_id`**: Task 4's in-place rewrite is the only thing that makes the count move for compaction. Say so — it changes how a reviewer should weigh that task.
- **`/compact` emits no `SessionStart` at all**: it cannot be detected, so drop `'compact'` from Task 2's allowlist and from Task 3's and Task 4's tests. Record that, and move the "compaction counts as a new conversation" decision into Accepted limitations as something that could not be implemented.

- [ ] **Step 4: Clean up the probe**

Run: `rm -rf /tmp/compactprobe /home/fsevenm/.claude/projects/-tmp-compactprobe`

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-07-29-conversation-lineage-design.md
git commit -m "docs: measure what /compact emits, not just /clear

The spec's compaction behaviour was assumed from /clear's measured event
pair. Drove an interactive session in a pty with SessionStart and SessionEnd
hooks logging their payloads, and recorded what actually arrives.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Teach the Claude adapter to flag a new conversation

**Files:**
- Modify: `src/core/types.ts` (the `AgentEvent` interface)
- Modify: `src/core/adapters/claude.ts`
- Test: `test/core/adapters/claude.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `AgentEvent.startsNewConversation?: boolean`. Task 3 and Task 4 read it. It is `true` or absent — never `false`, so that `if (e.startsNewConversation)` is the only test anyone needs to write.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('claudeAdapter.normalize', ...)` block in `test/core/adapters/claude.test.ts`:

```ts
  it('flags a cleared session as the start of a new conversation', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'SessionStart', session_id: 's2', cwd: '/p', source: 'clear' }, ctx
    )
    expect(e?.startsNewConversation).toBe(true)
  })

  it('flags a compacted session as the start of a new conversation', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'SessionStart', session_id: 's2', cwd: '/p', source: 'compact' }, ctx
    )
    expect(e?.startsNewConversation).toBe(true)
  })

  it('leaves startup and resume unflagged: the process clock is still right there', () => {
    for (const source of ['startup', 'resume']) {
      const e = claudeAdapter.normalize(
        { hook_event_name: 'SessionStart', session_id: 's1', cwd: '/p', source }, ctx
      )
      expect(e?.startsNewConversation, source).toBeUndefined()
    }
  })

  it('leaves an unknown source unflagged rather than guessing', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'SessionStart', session_id: 's1', cwd: '/p', source: 'teleport' }, ctx
    )
    expect(e?.startsNewConversation).toBeUndefined()
  })

  it('ignores a source that arrives on any event other than SessionStart', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'Stop', session_id: 's1', cwd: '/p', source: 'clear' }, ctx
    )
    expect(e?.startsNewConversation).toBeUndefined()
  })
```

If Task 1 found that `/compact` emits no `SessionStart`, delete the `compact` test and drop `'compact'` from Step 3's allowlist.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run test/core/adapters/claude.test.ts`

Expected: FAIL — the two flagging tests report `undefined` where `true` was expected. The three negative tests pass already, which is fine; they exist to pin behaviour that must survive Step 3.

- [ ] **Step 3: Add the field and the adapter logic**

In `src/core/types.ts`, add to the `AgentEvent` interface, after `permissionsBypassed`:

```ts
  /**
   * Set when this event begins a conversation distinct from the one before it,
   * inside an agent process that keeps running — Claude's `/clear` and
   * `/compact`. Only adapters whose dialect can tell set it, so absence means
   * "same conversation, or no way to know". Never `false`: a single truthiness
   * test is all any consumer should need.
   */
  startsNewConversation?: boolean
```

In `src/core/adapters/claude.ts`, add above `claudeAdapter`:

```ts
/**
 * SessionStart `source` values that mean the agent process kept running while
 * the conversation inside it restarted. An allowlist rather than "anything but
 * startup and resume": a source we have never seen should leave the clock
 * alone, because failing to reset it is today's behaviour while resetting it
 * wrongly would zero a live session's timer.
 */
const NEW_CONVERSATION_SOURCES = new Set(['clear', 'compact'])
```

and add to the object `normalize` returns, after `permissionsBypassed`:

```ts
      startsNewConversation:
        eventName === 'SessionStart' && NEW_CONVERSATION_SOURCES.has(str(raw['source']) ?? '')
          ? true
          : undefined,
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run test/core/adapters/claude.test.ts && npm run typecheck`

Expected: all tests PASS, typecheck silent. The pre-existing `maps SessionStart to session-start` test uses `toEqual` against a literal that does not mention the new field; `toEqual` ignores `undefined` properties, so it stays green.

- [ ] **Step 5: Run the full suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/adapters/claude.ts test/core/adapters/claude.test.ts
git commit -m "feat(core): let an adapter say an event begins a new conversation

Claude's SessionStart carries a source, and clear and compact both mean the
conversation restarted while the agent process kept running. The adapter
discarded it. Flagging it here keeps the dialect knowledge in the adapter and
leaves the store agent-agnostic.

The allowlist is deliberate. An unrecognised source leaves the flag unset,
which is today's behaviour; the opposite default would zero a live clock the
first time Claude Code adds a value we have not seen.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Give the store a per-process lineage

**Files:**
- Modify: `src/core/types.ts` (the `Session` interface)
- Modify: `src/core/store.ts`
- Test: `test/core/store.test.ts`

**Interfaces:**
- Consumes: `AgentEvent.startsNewConversation` from Task 2.
- Produces: `Session.conversationIndex: number` (1-based, always present) and `Session.processStartedAt?: number`. `Session.startedAt` keeps its type and changes meaning to "when the current conversation began". Task 4 extends the same code path; Task 6 renders all three.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('SessionStore', ...)` block in `test/core/store.test.ts`:

```ts
  it('numbers the first conversation 1 and starts its clock at the process', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 9000, agentStartedAt: 1500, source: undefined }))
    expect(s.list()[0]!.conversationIndex).toBe(1)
    expect(s.list()[0]!.startedAt).toBe(1500)
    expect(s.list()[0]!.processStartedAt).toBe(1500)
  })

  it('restarts the clock and bumps the number when a clear begins a new conversation', () => {
    const s = new SessionStore()
    s.apply(ev({ sessionId: 'old', ts: 9000, agentStartedAt: 1500 }))
    s.apply(ev({ sessionId: 'new', ts: 20000, agentStartedAt: 1500, startsNewConversation: true }))
    const fresh = s.list().find((x) => x.sessionId === 'new')!
    expect(fresh.conversationIndex).toBe(2)
    expect(fresh.startedAt, 'the clock measures the conversation, not the shell').toBe(20000)
    expect(fresh.processStartedAt, 'the shell total still comes from /proc').toBe(1500)
  })

  it('leaves the outgoing record alone so it shows its own final duration', () => {
    const s = new SessionStore()
    s.apply(ev({ sessionId: 'old', ts: 9000, agentStartedAt: 1500 }))
    s.apply(ev({ sessionId: 'old', kind: 'session-end', ts: 19000, agentStartedAt: 1500 }))
    s.apply(ev({ sessionId: 'new', ts: 20000, agentStartedAt: 1500, startsNewConversation: true }))
    const old = s.list().find((x) => x.sessionId === 'old')!
    expect(old.startedAt).toBe(1500)
    expect(old.conversationIndex).toBe(1)
  })

  it('counts a third conversation, so compaction after a clear keeps climbing', () => {
    const s = new SessionStore()
    s.apply(ev({ sessionId: 'a', ts: 1000, agentStartedAt: 1000 }))
    s.apply(ev({ sessionId: 'b', ts: 2000, agentStartedAt: 1000, startsNewConversation: true }))
    s.apply(ev({ sessionId: 'c', ts: 3000, agentStartedAt: 1000, startsNewConversation: true }))
    expect(s.list().find((x) => x.sessionId === 'c')!.conversationIndex).toBe(3)
  })

  it('keeps conversations in separate agent processes separate', () => {
    const s = new SessionStore()
    s.apply(ev({ sessionId: 'a', pid: 10, ts: 1000, agentStartedAt: 1000 }))
    s.apply(ev({ sessionId: 'b', pid: 10, ts: 2000, agentStartedAt: 1000, startsNewConversation: true }))
    s.apply(ev({ sessionId: 'c', pid: 20, ts: 3000, agentStartedAt: 3000 }))
    expect(s.list().find((x) => x.sessionId === 'c')!.conversationIndex).toBe(1)
  })

  it('treats a reused pid with a different start time as a different process', () => {
    const s = new SessionStore()
    s.apply(ev({ sessionId: 'a', pid: 10, ts: 1000, agentStartedAt: 1000 }))
    s.apply(ev({ sessionId: 'b', pid: 10, ts: 2000, agentStartedAt: 1000, startsNewConversation: true }))
    s.apply(ev({ sessionId: 'c', pid: 10, ts: 9000, agentStartedAt: 8000, startsNewConversation: true }))
    expect(
      s.list().find((x) => x.sessionId === 'c')!.conversationIndex,
      'a recycled pid must not inherit the dead process`s count'
    ).toBe(2)
  })

  it('keeps a live conversation numbered across the events inside it', () => {
    const s = new SessionStore()
    s.apply(ev({ sessionId: 'b', ts: 2000, agentStartedAt: 1000, startsNewConversation: true }))
    s.apply(ev({ sessionId: 'b', kind: 'tool-start', tool: 'Edit', ts: 3000, agentStartedAt: 1000 }))
    expect(s.list()[0]!.conversationIndex).toBe(2)
    expect(s.list()[0]!.startedAt, 'an ordinary event must not move the clock').toBe(2000)
  })

  it('numbers a conversation 1 when the agent process could not be identified', () => {
    const s = new SessionStore()
    s.apply(ev({ pid: 0, ts: 9000, agentStartedAt: 1500, startsNewConversation: true }))
    expect(
      s.list()[0]!.conversationIndex,
      'pid 0 is every unidentified agent at once; it can carry no lineage'
    ).toBe(1)
    expect(s.list()[0]!.startedAt).toBe(1500)
  })

  it('numbers a conversation 1 when the extension started mid-shell', () => {
    const s = new SessionStore()
    s.apply(ev({ kind: 'tool-start', tool: 'Edit', ts: 9000, agentStartedAt: 1500 }))
    expect(
      s.list()[0]!.conversationIndex,
      'no SessionStart replays on reload, so this undercounts by design'
    ).toBe(1)
    expect(s.list()[0]!.startedAt).toBe(1500)
  })

  it('lands on 2 when the first event it ever sees is a clear', () => {
    const s = new SessionStore()
    s.apply(ev({ ts: 9000, agentStartedAt: 1500, startsNewConversation: true }))
    expect(
      s.list()[0]!.conversationIndex,
      'at least two conversations have happened; 2 is the honest lower bound'
    ).toBe(2)
  })

  it('keeps the conversation clock when a reap recreates the record', () => {
    const s = new SessionStore()
    s.apply(ev({ sessionId: 'b', ts: 2000, agentStartedAt: 1000, startsNewConversation: true }))
    s.reap(3000, () => true)
    s.apply(ev({ sessionId: 'b', kind: 'tool-start', tool: 'Edit', ts: 30000, agentStartedAt: 1000 }))
    expect(s.list()[0]!.startedAt, 'the lineage outlives the record it numbered').toBe(2000)
    expect(s.list()[0]!.conversationIndex).toBe(2)
  })
```

The `source: undefined` in the first test is a no-op that documents intent; `ev()` has no `source` field. Drop it if it reads as clutter.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run test/core/store.test.ts`

Expected: FAIL. Every assertion on `conversationIndex` reports `undefined`, and the clear/compact tests report `1500` where a fresh timestamp was expected.

- [ ] **Step 3: Add the `Session` fields**

In `src/core/types.ts`, inside `interface Session`, replace the existing `startedAt: number` line and its comment with:

```ts
  /**
   * When the current conversation began. Equal to the agent process's start
   * time until the user clears or compacts, which begins a new conversation
   * inside a process that keeps running — see SessionStore's lineage map.
   */
  startedAt: number
  /** 1-based. Which conversation this is within its agent process. */
  conversationIndex: number
  /**
   * When the agent process started, in ms since the epoch, resolved from /proc
   * by the shell layer. Undefined when /proc could not supply it. Distinct from
   * startedAt, which moves with the conversation while this does not.
   */
  processStartedAt?: number
```

- [ ] **Step 4: Add the lineage to the store**

In `src/core/store.ts`, extend the type import on line 2 to bring in `AgentId`:

```ts
import type { AgentEvent, AgentId, PendingPermission, Session, SessionState } from './types.js'
```

Add below the `MAX_SESSIONS` declaration:

```ts
/**
 * What the store remembers about one agent process across the conversations it
 * hosts. `/clear` and `/compact` end a session and start a new one without
 * restarting the process, so a new Session record is built for each — which is
 * why neither the counter nor the conversation's start time can live on one.
 */
interface Lineage {
  pid: number
  processStartedAt: number
  count: number
  conversationStartedAt: number
}

/**
 * Keyed on the pid *and* the process start time, never the pid alone: the
 * kernel recycles pids, and the start time is what makes one of them mean one
 * process. Callers pass 0 for an unknown start time so the key stays total.
 */
function lineageKey(agent: AgentId, pid: number, processStartedAt: number): string {
  return `${agent}:${pid}:${processStartedAt}`
}
```

Add the field beside `sessions` in the class:

```ts
  private lineages = new Map<string, Lineage>()
```

Add this method just above `ensure`:

```ts
  /**
   * The lineage for the process this event came from, created on first sight.
   * Null when there is nothing to key on: resolveAgent returns pid 0 whenever
   * it cannot read /proc or cannot identify the agent, and a lineage keyed on 0
   * would merge every unidentified agent on the machine into one count.
   *
   * Also null at the cap. Unlike the session map this one can be grown by a
   * peer that never gets a session created — a lineage is minted before ensure
   * runs — so it needs its own bound rather than inheriting that one.
   */
  private lineageFor(e: AgentEvent): Lineage | null {
    if (!e.pid) return null
    const processStartedAt = e.agentStartedAt ?? 0
    const key = lineageKey(e.agent, e.pid, processStartedAt)
    let l = this.lineages.get(key)
    if (!l) {
      if (this.lineages.size >= MAX_SESSIONS) return null
      l = {
        pid: e.pid,
        processStartedAt,
        count: 1,
        conversationStartedAt: e.agentStartedAt ?? e.ts,
      }
      this.lineages.set(key, l)
    }
    return l
  }
```

Change `ensure` to take the lineage and stamp the three fields from it:

```ts
  private ensure(e: AgentEvent, lineage: Lineage | null): Session | null {
    const key = sessionKey(e.agent, e.sessionId)
    let s = this.sessions.get(key)
    if (!s) {
      if (this.sessions.size >= MAX_SESSIONS) return null
      s = {
        key,
        agent: e.agent,
        sessionId: e.sessionId,
        project: basename(e.cwd) || e.cwd,
        cwd: e.cwd,
        state: 'idle',
        pid: e.pid,
        // The conversation's start, which the lineage carries across the record
        // boundary that /clear creates. Falling back to the process start keeps
        // a record recreated after a reap or a shell reload reporting the same
        // number rather than restarting the clock at the current task.
        startedAt: lineage?.conversationStartedAt ?? e.agentStartedAt ?? e.ts,
        conversationIndex: lineage?.count ?? 1,
        processStartedAt: e.agentStartedAt,
        lastEventAt: e.ts,
      }
      this.sessions.set(key, s)
    }
    return s
  }
```

Change the top of `apply` to bump the lineage before the record is built:

```ts
  apply(e: AgentEvent): void {
    const lineage = this.lineageFor(e)
    // Bumped before ensure, so the record ensure creates for the incoming
    // session id is already numbered. /clear delivers its SessionEnd first, so
    // the outgoing record is untouched and keeps showing its own duration for
    // the length of its linger.
    if (lineage && e.startsNewConversation) {
      lineage.count += 1
      lineage.conversationStartedAt = e.ts
    }
    const s = this.ensure(e, lineage)
    if (!s) return
    s.lastEventAt = e.ts
```

The rest of `apply` is unchanged.

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run test/core/store.test.ts && npm run typecheck`

Expected: all tests PASS, typecheck silent.

The pre-existing test `reports the same startedAt after a reap recreates the session` reaps with `() => false` and then replays an event. Nothing prunes lineages yet, so the lineage survives and still reports `1500`. It stays green here and again after Task 5.

- [ ] **Step 6: Run the full suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/types.ts src/core/store.ts test/core/store.test.ts
git commit -m "feat(core): count conversations per agent process, not per record

/clear ends a session and starts a new one inside a process that keeps
running, so the clock seeded from /proc kept reporting the age of the shell
rather than the age of the work. A record cannot carry the fix, because /clear
mints a new session id and therefore a new record.

The store now keeps a lineage per agent process, keyed on pid and process
start time so a recycled pid cannot inherit a dead process's count. It holds
the conversation counter and the conversation's start, and new records are
stamped from it.

An unidentified agent (pid 0) carries no lineage and behaves exactly as
before, and an extension enabled mid-shell still starts from 1 — no
SessionStart replays, so there is nothing better to infer.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Renumber in place when an agent reuses the session id

Task 3 stamps the lineage onto records only as `ensure` creates them, which assumes every new conversation arrives under a new session id. That is measured for `/clear`. This task removes the assumption.

**Files:**
- Modify: `src/core/store.ts` (`apply`)
- Test: `test/core/store.test.ts`

**Interfaces:**
- Consumes: `Lineage` and `lineageFor` from Task 3.
- Produces: nothing new. It widens `apply`'s contract to "a flagged event renumbers its session whether or not the record already existed".

- [ ] **Step 1: Write the failing tests**

Append inside `describe('SessionStore', ...)` in `test/core/store.test.ts`:

```ts
  it('renumbers and restarts a session that keeps its id across a new conversation', () => {
    const s = new SessionStore()
    s.apply(ev({ sessionId: 'same', ts: 1000, agentStartedAt: 1000 }))
    s.apply(ev({ sessionId: 'same', ts: 20000, agentStartedAt: 1000, startsNewConversation: true }))
    expect(s.list()).toHaveLength(1)
    expect(s.list()[0]!.conversationIndex).toBe(2)
    expect(s.list()[0]!.startedAt, 'reusing the id must not preserve the old clock').toBe(20000)
  })

  it('does not renumber an existing session on an ordinary event', () => {
    const s = new SessionStore()
    s.apply(ev({ sessionId: 'same', ts: 1000, agentStartedAt: 1000 }))
    s.apply(ev({ sessionId: 'same', kind: 'tool-start', tool: 'Edit', ts: 5000, agentStartedAt: 1000 }))
    expect(s.list()[0]!.conversationIndex).toBe(1)
    expect(s.list()[0]!.startedAt).toBe(1000)
  })

  it('leaves an unidentified agent unrenumbered, having no lineage to renumber from', () => {
    const s = new SessionStore()
    s.apply(ev({ sessionId: 'same', pid: 0, ts: 1000, agentStartedAt: 1000 }))
    s.apply(ev({ sessionId: 'same', pid: 0, ts: 20000, agentStartedAt: 1000, startsNewConversation: true }))
    expect(s.list()[0]!.conversationIndex).toBe(1)
    expect(s.list()[0]!.startedAt).toBe(1000)
  })
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run test/core/store.test.ts`

Expected: FAIL on the first test — `conversationIndex` is `1` and `startedAt` is `1000`, because `ensure` found the existing record and stamped nothing. The other two pass already; they pin what must not change.

- [ ] **Step 3: Rewrite the existing record**

In `src/core/store.ts`, in `apply`, immediately after the `if (!s) return` guard:

```ts
    // ensure stamps the lineage only onto a record it creates, which covers
    // /clear: it mints a new session id. An agent that restarts a conversation
    // under the *same* id would otherwise keep the previous conversation's
    // clock and number forever, so bring the record forward here too.
    if (lineage && e.startsNewConversation) {
      s.startedAt = lineage.conversationStartedAt
      s.conversationIndex = lineage.count
    }
```

This is a no-op for the `/clear` path: `ensure` has just built that record from the same lineage, so both assignments write the values already there.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run test/core/store.test.ts && npm run typecheck`

Expected: all tests PASS, typecheck silent.

- [ ] **Step 5: Run the full suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/store.ts test/core/store.test.ts
git commit -m "feat(core): renumber a session that restarts under its own id

/clear was measured to mint a new session id, and stamping the lineage as the
record is created relies on that. Nothing guarantees every agent does the
same, and a conversation that restarts under an id we already hold would keep
the previous one's clock and number for as long as it lived.

A no-op on the measured path, since the record was built from this same
lineage a moment earlier.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Collect lineages, and bound them

**Files:**
- Modify: `src/core/store.ts` (`reap`)
- Test: `test/core/store.test.ts`

**Interfaces:**
- Consumes: `Lineage`, `lineageFor`, `lineageKey` from Task 3.
- Produces: nothing new. `reap`'s signature and return value are unchanged — it still returns only dropped *session* keys, because only those own external state the caller must release.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('SessionStore', ...)` in `test/core/store.test.ts`:

```ts
  it('collects a lineage once nothing references it and its process is gone', () => {
    const s = new SessionStore()
    s.apply(ev({ sessionId: 'a', pid: 7, ts: 1000, agentStartedAt: 1000 }))
    s.apply(ev({ sessionId: 'b', pid: 7, ts: 2000, agentStartedAt: 1000, startsNewConversation: true }))
    s.apply(ev({ sessionId: 'c', pid: 7, ts: 3000, agentStartedAt: 1000, startsNewConversation: true }))
    s.reap(4000, () => false)
    expect(s.list()).toHaveLength(0)

    s.apply(ev({ sessionId: 'd', pid: 7, ts: 5000, agentStartedAt: 1000, startsNewConversation: true }))
    expect(
      s.list()[0]!.conversationIndex,
      'a collected lineage starts over at 1, then this clear takes it to 2'
    ).toBe(2)
  })

  it('keeps a lineage whose process is still alive after its sessions are gone', () => {
    const s = new SessionStore()
    s.apply(ev({ sessionId: 'a', pid: 7, ts: 1000, agentStartedAt: 1000 }))
    s.apply(ev({ sessionId: 'b', pid: 7, ts: 2000, agentStartedAt: 1000, startsNewConversation: true }))
    s.apply(ev({ sessionId: 'b', kind: 'session-end', ts: 3000, agentStartedAt: 1000 }))
    s.apply(ev({ sessionId: 'a', kind: 'session-end', ts: 3000, agentStartedAt: 1000 }))
    s.reap(3000 + 11_000, () => true)
    expect(s.list()).toHaveLength(0)

    s.apply(ev({ sessionId: 'c', pid: 7, ts: 40000, agentStartedAt: 1000, startsNewConversation: true }))
    expect(
      s.list()[0]!.conversationIndex,
      'the process never died, so its count must survive its records'
    ).toBe(3)
  })

  it('keeps a lineage its live session still references', () => {
    const s = new SessionStore()
    s.apply(ev({ sessionId: 'a', pid: 7, ts: 1000, agentStartedAt: 1000 }))
    s.apply(ev({ sessionId: 'b', pid: 7, ts: 2000, agentStartedAt: 1000, startsNewConversation: true }))
    s.apply(ev({ sessionId: 'a', kind: 'session-end', ts: 2000, agentStartedAt: 1000 }))
    s.reap(2000 + 11_000, () => true)
    expect(s.list().map((x) => x.sessionId), 'only the ended one goes').toEqual(['b'])
    expect(s.list()[0]!.conversationIndex).toBe(2)
  })

  it('caps the lineage map so a hostile peer cannot grow it unbounded', () => {
    const s = new SessionStore()
    // One session id throughout, so the session cap is never the thing that
    // stops this: each event mints a lineage for a pid the store has not seen.
    for (let i = 1; i <= 300; i++) {
      s.apply(ev({ sessionId: 'only', pid: i, ts: i, agentStartedAt: i }))
    }
    s.apply(ev({ sessionId: 'only', pid: 9999, ts: 400000, agentStartedAt: 400000,
      startsNewConversation: true }))
    expect(
      s.list()[0]!.conversationIndex,
      'at the cap there is no lineage to bump, so the record is left as it was'
    ).toBe(1)
  })
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run test/core/store.test.ts`

Expected: FAIL on `collects a lineage once nothing references it and its process is gone` — it reports `4`, because the lineage from the dead process is still there and kept counting.

The cap test passes already: `lineageFor` grew its own guard in Task 3. It is here because this is the task that makes the bound meaningful, and a bound with no test rots.

- [ ] **Step 3: Prune in `reap`**

In `src/core/store.ts`, add this method after `reap`:

```ts
  /**
   * A lineage outlives the records it numbers — that is the whole point of it —
   * so it cannot be collected with them. It goes once nothing references it and
   * its process is confirmed gone.
   *
   * Runs on every sweep rather than only when a session was dropped: an agent
   * can die long after its last record was collected, and that sweep drops
   * nothing, so a dropped-only guard would leak the lineage for good.
   */
  private pruneLineages(pidAlive: (pid: number) => boolean): void {
    const referenced = new Set<string>()
    for (const s of this.sessions.values()) {
      referenced.add(lineageKey(s.agent, s.pid, s.processStartedAt ?? 0))
    }
    for (const [key, l] of [...this.lineages]) {
      if (!referenced.has(key) && !pidAlive(l.pid)) this.lineages.delete(key)
    }
  }
```

and call it at the end of `reap`, replacing the final two lines:

```ts
    this.pruneLineages(pidAlive)
    if (dropped.length > 0) this.emit()
    return dropped
```

`pidAlive(0)` is false everywhere in this codebase, which is safe here: a lineage never holds pid 0, because `lineageFor` refuses to build one.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run test/core/store.test.ts && npm run typecheck`

Expected: all tests PASS, typecheck silent.

Watch the pre-existing `reports the same startedAt after a reap recreates the session`: it reaps with `() => false`, so the lineage is now collected. The replayed event mints a fresh one seeded from `agentStartedAt`, which is `1500` — the same answer, by a different route. It must still be green.

- [ ] **Step 5: Run the full suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/store.ts test/core/store.test.ts
git commit -m "fix(core): collect a lineage once its process is gone

A lineage outlives the records it numbers, so the session sweep cannot take it
along. Left alone it would hold a dead process's count for the life of the
shell, and hand it back to whatever recycled its pid at the same start time.

Pruned on every sweep, not only on one that dropped something: an agent can
die well after its last record was collected, and that sweep drops nothing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Show the number and the two clocks in the row

**Files:**
- Modify: `src/shell/sessionRow.ts`
- Modify: `stylesheet.css`
- Verify: a throwaway probe extension in a nested `gnome-shell` (not committed)

**Interfaces:**
- Consumes: `Session.conversationIndex`, `Session.processStartedAt`, `Session.startedAt` from Task 3.
- Produces: the rendered row. Nothing else reads it.

There is no unit test here. `src/shell` needs a live GNOME Shell, which is why every testable decision was pushed into `src/core` by the previous tasks. Steps 5–8 are the verification that replaces one.

- [ ] **Step 1: Split the project line into a box**

In `src/shell/sessionRow.ts`, add the field beside the others:

```ts
    private _shellTotal!: St.Label
```

Replace these two lines in the constructor:

```ts
      this._project = new St.Label({ text: session.project, style_class: 'dasbo-row-project' })
```

with:

```ts
      // The project name and the shell's uptime share a line. x_expand and the
      // START alignment sit on the *total*, not the name: that makes the total
      // absorb the row's slack while still drawing hard against the name, so
      // the two read as one phrase instead of the total drifting to the right
      // margin. The ellipsize stays on the name alone, so a long project
      // shrinks and the total is never the thing that gets clipped.
      const titleRow = new St.BoxLayout({ style_class: 'dasbo-row-title', x_expand: true })
      this._project = new St.Label({
        text: session.project,
        style_class: 'dasbo-row-project',
        y_align: Clutter.ActorAlign.CENTER,
      })
      this._shellTotal = new St.Label({
        text: '',
        style_class: 'dasbo-row-shell-total',
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.CENTER,
      })
      // St's CSS engine does not honour `opacity` — the same finding that made
      // the empty row set it on the actor. 140 (~0.55) rather than the 178 used
      // for the activity line: the shell's uptime is the least important number
      // in the row and should sit below it, not level with it.
      this._shellTotal.opacity = 140
```

Then, where the project label is added to `textCol`, replace:

```ts
      textCol.add_child(this._project)
```

with:

```ts
      titleRow.add_child(this._project)
      titleRow.add_child(this._shellTotal)
      textCol.add_child(titleRow)
```

Leave the `this._project.clutter_text.ellipsize = Pango.EllipsizeMode.END` line and its comment exactly where they are.

- [ ] **Step 2: Drive both labels from the tick**

Replace the whole `tick` method:

```ts
    /** Called once per second by the Island while the popup is open. */
    tick(now: number): void {
      const elapsed = formatElapsed(now - this._session.startedAt)
      // The number rides on the clock rather than getting a label of its own:
      // one string means tnum covers both halves, and the pair reads as "third
      // conversation, eight minutes in".
      this._elapsed.text = this._session.conversationIndex > 1
        ? `#${this._session.conversationIndex} ${elapsed}`
        : elapsed
      const processStartedAt = this._session.processStartedAt
      if (processStartedAt !== undefined) {
        this._shellTotal.text = formatElapsed(now - processStartedAt)
      }
    }
```

- [ ] **Step 3: Hide the extras on a first conversation**

In `update`, after the `this._dot.style_class = ...` line:

```ts
      // On a first conversation the number is always #1 and the shell's uptime
      // is the conversation's own age, so both are noise. Hidden rather than
      // blanked: ClutterBoxLayout only spaces between visible children, so an
      // empty label would still cost the row its gap.
      this._shellTotal.visible =
        session.conversationIndex > 1 && session.processStartedAt !== undefined
```

- [ ] **Step 4: Widen the clock and style the total**

In `stylesheet.css`, replace the `.dasbo-row-elapsed` rule and its comment with:

```css
/* min-width because the row's total width is now fixed and the action box is
   right-hand: "5s" growing to "12m" would otherwise slide Jump sideways.
   tnum handles jitter within a digit count, min-width handles the change in
   digit count. 6em covers the widest output, "#99 100h" — it was 3em before
   the conversation number joined the clock. Those 3em come out of the activity
   text's share of the fixed row width, so it wraps a little earlier. */
.dasbo-row-elapsed {
  font-feature-settings: "tnum";
  opacity: 0.7;
  min-width: 6em;
}
```

Add beside `.dasbo-row-project`:

```css
/* The gap between the project name and the shell's uptime. */
.dasbo-row-title { spacing: 6px; }

/* The agent process's total uptime, shown only once the conversation clock
   beside it has stopped agreeing with it. Dimming lives on the actor, not
   here — see sessionRow.ts. */
.dasbo-row-shell-total {
  font-size: 0.85em;
}
```

- [ ] **Step 5: Typecheck, test, build and install**

Run: `npm run typecheck && npm test && make install`

Expected: typecheck silent, all tests pass, `make install` ends with the "Installed." line.

`test/shell/insensitiveColor.test.ts` scans `src/shell` for non-reactive menu items and demands a colour override for each. No new menu item is added here, so it stays green — if it fails, a new `super({ reactive: false … })` crept in and needs its own `:insensitive` rule.

- [ ] **Step 6: Write the probe extension that reads the row back**

Create `/tmp/rowprobe/data/gnome-shell/extensions/dasbo-rowprobe@local/metadata.json`:

```json
{
  "uuid": "dasbo-rowprobe@local",
  "name": "Dasbo Row Probe",
  "description": "Opens the island popup and dumps every label it contains.",
  "shell-version": ["46"]
}
```

Create `/tmp/rowprobe/data/gnome-shell/extensions/dasbo-rowprobe@local/extension.js`:

```js
import GLib from 'gi://GLib'
import St from 'gi://St'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js'

function labels(actor, out) {
    if (actor instanceof St.Label && actor.visible && actor.text)
        out.push(actor.text)
    for (const child of actor.get_children())
        labels(child, out)
}

export default class RowProbe extends Extension {
    enable() {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 12000, () => {
            let out
            try {
                const indicator = Object.entries(Main.panel.statusArea)
                    .find(([name]) => name.includes('dasbo'))?.[1]
                if (!indicator)
                    throw new Error(`no dasbo indicator: ${Object.keys(Main.panel.statusArea)}`)
                indicator.menu.open()
                const found = []
                labels(indicator.menu.box, found)
                out = {labels: found}
            } catch (e) {
                out = {error: `${e}`}
            }
            GLib.file_set_contents('/tmp/rowprobe/out.json', JSON.stringify(out, null, 2))
            return GLib.SOURCE_REMOVE
        })
    }

    disable() {}
}
```

- [ ] **Step 7: Drive the real extension in a nested shell**

The extension resolves an agent by walking from the pid it is handed until it finds a process whose `comm` matches an adapter's `procNames` — `claude` for this one. A copy of `sleep` named `claude` satisfies that and gives a stable pid with a real `/proc` start time.

Run this as one script (`bash /tmp/rowprobe/run.sh`):

```bash
#!/usr/bin/env bash
set -u
export XDG_DATA_HOME=/tmp/rowprobe/data
export XDG_CONFIG_HOME=/tmp/rowprobe/config
export XDG_CACHE_HOME=/tmp/rowprobe/cache
mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME"
rm -f /tmp/rowprobe/out.json

# The real extension, installed by `make install` into the user's data dir.
mkdir -p "$XDG_DATA_HOME/gnome-shell/extensions"
cp -r "$HOME/.local/share/gnome-shell/extensions/dasbo-island@ayubaswad.gmail.com" \
      "$XDG_DATA_HOME/gnome-shell/extensions/"

cp /bin/sleep /tmp/rowprobe/claude
/tmp/rowprobe/claude 300 &
FAKE_AGENT=$!

dbus-run-session -- bash -c '
  gsettings set org.gnome.shell disable-user-extensions false
  gsettings set org.gnome.shell enabled-extensions \
    "['"'"'dasbo-island@ayubaswad.gmail.com'"'"', '"'"'dasbo-rowprobe@local'"'"']"
  gnome-shell --nested --wayland &
  SHELL_PID=$!
  sleep 8
  notify() {
    gdbus call --session --dest org.dasbo.Island --object-path /org/dasbo/Island \
      --method org.dasbo.Island.Notify claude "$1" /home/'"$USER"'/projects/dasbo-island \
      '"$FAKE_AGENT"' "$2"
  }
  notify SessionStart "{\"hook_event_name\":\"SessionStart\",\"session_id\":\"one\",\"source\":\"startup\"}"
  sleep 3
  notify SessionStart "{\"hook_event_name\":\"SessionStart\",\"session_id\":\"two\",\"source\":\"clear\"}"
  sleep 3
  notify PreToolUse "{\"hook_event_name\":\"PreToolUse\",\"session_id\":\"two\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"npm test\"}}"
  wait $SHELL_PID
' &
DRIVER=$!

sleep 45
kill "$DRIVER" "$FAKE_AGENT" 2>/dev/null
pkill -f 'gnome-shell --nested' 2>/dev/null
sleep 2
cat /tmp/rowprobe/out.json
```

- [ ] **Step 8: Check what came back**

Expected in `/tmp/rowprobe/out.json`: the popup's labels, including `Dasbo Island`, the project name `dasbo-island`, the activity text, and — the point of the exercise — a clock reading `#2 0s` and a separate shell total reading the age of the fake agent process (`0s`, then seconds).

Confirm three things and do not accept the task until all three hold:

1. A label matching `/^#2 /` exists. If the clock reads a bare duration, `conversationIndex` never reached the row.
2. A second, shorter duration label exists beside the project name. If it is missing, either `visible` was left false or `processStartedAt` never arrived.
3. The first `Notify` alone (comment out the `clear` one and re-run) produces **neither** — a first conversation shows a bare clock and no total.

If the probe reports `no dasbo indicator`, the extension failed to load: check `journalctl` is not available in the nested session and instead re-run with `gnome-shell --nested --wayland` output going to a log file, then grep it for `dasbo`.

- [ ] **Step 9: Clean up**

Run: `rm -rf /tmp/rowprobe`

- [ ] **Step 10: Commit**

```bash
git add src/shell/sessionRow.ts stylesheet.css
git commit -m "feat(shell): show which conversation a row is, and how old its shell is

The clock now measures the conversation, so on its own it no longer answers
'how long has this terminal been going'. The row says both: the conversation
number rides on the clock as '#3 8m', and the process's uptime sits dim beside
the project name.

Both are hidden until the first clear, where the number is always #1 and the
two durations are the same number twice.

The clock's min-width goes 3em to 6em to keep Jump from sliding once a count
joins it; that comes out of the activity text, which wraps.

Verified in a nested gnome-shell by driving the real D-Bus interface with a
process named claude standing in for the agent, then reading the rendered
labels back out of the open popup.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: Display → Task 6; `AgentEvent.startsNewConversation` and the adapter allowlist → Task 2; `Session` fields, the lineage map, `lineageFor`, and `apply` steps 1–4 → Task 3; `apply` step 5, the in-place rewrite → Task 4; pruning and the cap → Task 5; the Risks section's unmeasured `/compact` → Task 1. Every bullet of the spec's Testing section appears as a named test in Task 3, 4 or 5, except the row itself, which the spec also excludes and which Task 6 covers with the nested-shell probe.

**Accepted limitations** are pinned as tests rather than left implicit: limitation 1 (reload) is `numbers a conversation 1 when the extension started mid-shell`, limitation 3 (pid 0) is `numbers a conversation 1 when the agent process could not be identified`, limitation 4 (mid-shell enable) is `lands on 2 when the first event it ever sees is a clear`. Limitation 2 (Claude-only) needs no test: no other adapter sets the flag, and Task 2's tests pin that the flag comes only from `source`. Limitation 5 is pre-existing and untouched.

**Type consistency.** `lineageFor` and `pruneLineages` both key through `lineageKey(agent, pid, processStartedAt)`, and both resolve a missing start time to `0` — `lineageFor` via `e.agentStartedAt ?? 0`, `pruneLineages` via `s.processStartedAt ?? 0`, which is the same value because `ensure` stamps `processStartedAt: e.agentStartedAt`. `conversationIndex` is non-optional on `Session` and is written in exactly two places, both from `lineage.count`. `startsNewConversation` is `true | undefined` in Task 2 and only ever read as a truthiness test in Tasks 3 and 4.

**One ordering note for the executor.** Task 3 makes `conversationIndex` a required field on `Session`. Any code constructing a `Session` literal outside `ensure` would stop compiling; there is none today, which Step 5's `npm run typecheck` confirms.
