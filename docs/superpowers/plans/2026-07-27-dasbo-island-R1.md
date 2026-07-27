# dasbo-island Plan Revision R1

**Date:** 2026-07-27
**Supersedes:** parts of `2026-07-27-dasbo-island.md` — Tasks 4, 5, 7, 8, 13.
**Status:** authoritative. Where this document and the base plan disagree, **this document wins.**

Task 2 captured real hook payloads from Claude Code 2.1.220, Codex CLI 0.142.0 and Antigravity CLI 1.1.7, and recorded the findings in `docs/agent-dialects.md`. Three of those findings invalidate assumptions baked into the base plan. This revision rewrites the affected pieces.

## What changed and why

### 1. Antigravity payloads carry no event name

No Antigravity hook payload contains any field naming which lifecycle event fired it. `PreInvocation` and `PostInvocation` payloads are byte-identical. The base plan's `antigravityAdapter.normalize` read a `hookEventName` key that does not exist.

**Fix:** the event name travels in argv. `dasbo-hook` takes it as a third argument, Antigravity's `hooks.json` wires a distinct command per event, and the D-Bus methods carry it as an explicit parameter. Claude and Codex still carry the event in their payload; their adapters prefer the payload value and fall back to argv, so a misconfigured hook line degrades rather than breaks.

### 2. Antigravity payloads carry no cwd and no pid

`workspacePaths` was `[]` in every captured payload, and there is no `pid` field anywhere. The base plan derived the row's project name from `basename(cwd)`.

**Fix:** `dasbo-hook` reports its own working directory and its own pid. Both already travel from the hook for pid; cwd joins them. Adapters prefer a payload cwd when present and fall back to the hook's cwd.

### 3. Both non-Claude hook config shapes were wrong

- **Codex 0.142.0** rejects a bare top-level map with `unknown field 'vibe-island', expected 'hooks'`. The real shape wraps the named-hook map in a `hooks` key. (This also means the `vibe-island` entry currently installed on this machine is malformed and being ignored by Codex.)
- **Antigravity** nests every event set under an arbitrary hook name, and mixes two structures: `PreToolUse`/`PostToolUse` are grouped (`matcher` + `hooks` array, like Claude), while `PreInvocation`/`PostInvocation`/`Stop` are flat lists of handler objects with no `matcher` and no `hooks` wrapper.

**Fix:** `planInstall` emits the corrected shapes.

### Codex status

Codex captured zero fixtures — `codex login status` reports `Not logged in` and every call returned HTTP 401. The corrected `{"hooks": {...}}` wrapper parses cleanly but was never exercised past the config parser. **Task 5's Codex adapter stays BLOCKED until a session is captured.** Its payload key names below are taken from the installed `~/.codex/vibe-island-hook.py`, which reads `type`, `session_id`, `cwd`, `tool_name` — third-party evidence, not verbatim capture. Do not treat them as verified.

---

## New shared type: `HookContext`

Everything the hook knows that the payload may not. Add to `src/core/types.ts`:

```ts
/**
 * What the hook process knows about an event, independent of the payload.
 * Adapters prefer payload values where they exist and fall back to these.
 */
export interface HookContext {
  /** PID of the hook process, the seed for jump-back ancestry. */
  pid: number
  /** Milliseconds since epoch, supplied by the caller so adapters stay pure. */
  ts: number
  /** Working directory of the hook process. Used when the payload carries no cwd. */
  cwd: string
  /** Event name from argv. Used when the payload carries no event field. */
  event?: string
}
```

This replaces the base plan's `normalize(raw, pid, ts)` positional signature everywhere.

---

## Task 4 (revised): Claude Code adapter

**Files:** create `src/core/adapters/claude.ts`; test `test/core/adapters/claude.test.ts`.

**Interfaces produced:**
- `AgentAdapter` (defined in `src/core/adapters/index.ts` in Task 5; until then declare it locally in `claude.ts` and move it in Task 5)
- `claudeAdapter: AgentAdapter`
- `detailFromToolInput(input: unknown): string | undefined` — exported, reused by the Codex adapter

Claude's own fixtures confirm `hook_event_name`, `session_id`, `cwd`, `transcript_path`, `tool_name`, `tool_input` all exist and are populated. The only change from the base plan is the signature.

- [ ] **Step 1: Write the failing test**

`test/core/adapters/claude.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { claudeAdapter } from '../../../src/core/adapters/claude.js'
import type { HookContext } from '../../../src/core/types.js'

const ctx: HookContext = { pid: 1234, ts: 5000, cwd: '/hook/cwd' }

describe('claudeAdapter.normalize', () => {
  it('maps SessionStart to session-start', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'SessionStart', session_id: 's1', cwd: '/p/app', transcript_path: '/t.jsonl' },
      ctx
    )
    expect(e).toEqual({
      agent: 'claude', kind: 'session-start', sessionId: 's1', cwd: '/p/app',
      tool: undefined, detail: undefined, transcriptPath: '/t.jsonl', pid: 1234, ts: 5000,
    })
  })

  it('prefers the payload cwd over the hook cwd', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'Stop', session_id: 's1', cwd: '/p/app' }, ctx
    )
    expect(e?.cwd).toBe('/p/app')
  })

  it('falls back to the hook cwd when the payload has none', () => {
    const e = claudeAdapter.normalize({ hook_event_name: 'Stop', session_id: 's1' }, ctx)
    expect(e?.cwd).toBe('/hook/cwd')
  })

  it('falls back to the argv event when the payload has no hook_event_name', () => {
    const e = claudeAdapter.normalize(
      { session_id: 's1', cwd: '/p' }, { ...ctx, event: 'Stop' }
    )
    expect(e?.kind).toBe('stop')
  })

  it('prefers the payload event over the argv event', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'SessionStart', session_id: 's1', cwd: '/p' }, { ...ctx, event: 'Stop' }
    )
    expect(e?.kind).toBe('session-start')
  })

  it('maps PreToolUse to tool-start and extracts a bash command as detail', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'PreToolUse', session_id: 's1', cwd: '/p/app',
        tool_name: 'Bash', tool_input: { command: 'rm -rf build' } },
      ctx
    )
    expect(e?.kind).toBe('tool-start')
    expect(e?.tool).toBe('Bash')
    expect(e?.detail).toBe('rm -rf build')
  })

  it('uses file_path as detail for file tools', () => {
    const e = claudeAdapter.normalize(
      { hook_event_name: 'PreToolUse', session_id: 's1', cwd: '/p/app',
        tool_name: 'Edit', tool_input: { file_path: '/p/app/src/main.js' } },
      ctx
    )
    expect(e?.detail).toBe('/p/app/src/main.js')
  })

  it('maps PostToolUse, UserPromptSubmit and Stop', () => {
    const kinds = ['PostToolUse', 'UserPromptSubmit', 'Stop'].map(
      (n) => claudeAdapter.normalize({ hook_event_name: n, session_id: 's1', cwd: '/p' }, ctx)?.kind
    )
    expect(kinds).toEqual(['tool-end', 'prompt-submit', 'stop'])
  })

  it('returns null for an unknown event', () => {
    expect(claudeAdapter.normalize({ hook_event_name: 'Nope', session_id: 's', cwd: '/p' }, ctx)).toBeNull()
  })

  it('returns null when neither payload nor argv names an event', () => {
    expect(claudeAdapter.normalize({ session_id: 's', cwd: '/p' }, ctx)).toBeNull()
  })

  it('returns null for a payload with no session id', () => {
    expect(claudeAdapter.normalize({ hook_event_name: 'Stop', cwd: '/p' }, ctx)).toBeNull()
  })

  it('returns null for a non-object payload', () => {
    expect(claudeAdapter.normalize('not json', ctx)).toBeNull()
    expect(claudeAdapter.normalize(null, ctx)).toBeNull()
  })
})

describe('claudeAdapter.encodeDecision', () => {
  it('encodes allow', () => {
    expect(claudeAdapter.encodeDecision({ kind: 'allow' })).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'Allowed from Dasbo Island',
      },
    })
  })

  it('encodes deny with the supplied reason', () => {
    const out = claudeAdapter.encodeDecision({ kind: 'deny', reason: 'nope' }) as any
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(out.hookSpecificOutput.permissionDecisionReason).toBe('nope')
  })

  it('encodes fallthrough as ask so Claude prompts normally', () => {
    const out = claudeAdapter.encodeDecision({ kind: 'fallthrough' }) as any
    expect(out.hookSpecificOutput.permissionDecision).toBe('ask')
  })
})

describe('claudeAdapter against captured fixtures', () => {
  const dir = 'test/fixtures/claude'

  it('has fixtures to test against', () => {
    expect(existsSync(dir), `${dir} must exist — fixtures are the adapter spec`).toBe(true)
    expect(readdirSync(dir).filter((f) => f.endsWith('.json')).length).toBeGreaterThan(0)
  })

  it('normalizes every captured payload into a usable event', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
    for (const f of files) {
      const raw = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'))
      const e = claudeAdapter.normalize(raw, ctx)
      expect(e, `${f} must normalize, not drop`).not.toBeNull()
      expect(e!.sessionId, `${f} must yield a session id`).toBeTruthy()
      expect(e!.cwd, `${f} must yield a cwd`).toBeTruthy()
    }
  })

  it('covers every event kind the fixtures contain', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
    const kinds = new Set(
      files.map((f) => claudeAdapter.normalize(
        JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')), ctx
      )?.kind)
    )
    expect(kinds).toContain('session-start')
    expect(kinds).toContain('prompt-submit')
    expect(kinds).toContain('tool-start')
    expect(kinds).toContain('tool-end')
    expect(kinds).toContain('stop')
  })
})
```

Note the fixture block asserts the directory exists rather than skipping when it does not — a test that silently passes with zero coverage is worse than no test.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/core/adapters/claude.test.ts`
Expected: FAIL — cannot resolve `src/core/adapters/claude.js`.

- [ ] **Step 3: Write `src/core/adapters/claude.ts`**

```ts
import type { AgentEvent, AgentId, Decision, EventKind, HookContext } from '../types.js'

export interface AgentAdapter {
  id: AgentId
  displayName: string
  /**
   * Convert a raw agent hook payload into an AgentEvent.
   * Everything not in the payload comes from `ctx`, so this stays pure.
   * Returns null when the payload is unusable — the caller drops it.
   */
  normalize(raw: unknown, ctx: HookContext): AgentEvent | null
  /** Convert an internal Decision into this agent's stdout JSON. */
  encodeDecision(d: Decision): unknown
}

const KIND_BY_EVENT: Record<string, EventKind> = {
  SessionStart: 'session-start',
  UserPromptSubmit: 'prompt-submit',
  PreToolUse: 'tool-start',
  PostToolUse: 'tool-end',
  Stop: 'stop',
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/** Pick the most useful human-readable detail out of a Claude tool_input blob. */
export function detailFromToolInput(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined
  return (
    str(input['command']) ??
    str(input['file_path']) ??
    str(input['path']) ??
    str(input['pattern']) ??
    str(input['url'])
  )
}

export const claudeAdapter: AgentAdapter = {
  id: 'claude',
  displayName: 'Claude Code',

  normalize(raw, ctx) {
    if (!isRecord(raw)) return null

    const eventName = str(raw['hook_event_name']) ?? ctx.event
    if (!eventName) return null
    const kind = KIND_BY_EVENT[eventName]
    if (!kind) return null

    const sessionId = str(raw['session_id'])
    if (!sessionId) return null

    const cwd = str(raw['cwd']) ?? ctx.cwd
    if (!cwd) return null

    return {
      agent: 'claude',
      kind,
      sessionId,
      cwd,
      tool: str(raw['tool_name']),
      detail: detailFromToolInput(raw['tool_input']),
      transcriptPath: str(raw['transcript_path']),
      pid: ctx.pid,
      ts: ctx.ts,
    }
  },

  encodeDecision(d: Decision) {
    const permissionDecision =
      d.kind === 'allow' ? 'allow' : d.kind === 'deny' ? 'deny' : 'ask'
    const defaultReason =
      d.kind === 'allow' ? 'Allowed from Dasbo Island'
      : d.kind === 'deny' ? 'Denied from Dasbo Island'
      : 'Dasbo Island did not decide'
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision,
        permissionDecisionReason: d.reason ?? defaultReason,
      },
    }
  },
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/core/adapters/claude.test.ts`
Expected: PASS. If a fixture assertion fails, the captured payload disagrees with the mapping — fix `claude.ts` to match the fixture, never the reverse.

- [ ] **Step 5: Commit**

```bash
git add src/core/adapters/claude.ts test/core/adapters/claude.test.ts
git commit -m "feat(core): add Claude Code hook adapter"
```

---

## Task 5 (revised): Antigravity adapter, Codex adapter, and dispatch

**Files:** create `src/core/adapters/antigravity.ts`, `src/core/adapters/codex.ts`, `src/core/adapters/index.ts`; modify `src/core/adapters/claude.ts`; tests for each.

**Interfaces produced:** `src/core/adapters/index.ts` exporting `AgentAdapter`, `adapters: Record<AgentId, AgentAdapter>`, `isAgentId(v: string): v is AgentId`, and `normalizeFor(agent: AgentId, raw: unknown, ctx: HookContext): AgentEvent | null`.

### Antigravity mapping, from the fixtures

| Concept | Source | Notes |
|---|---|---|
| Event name | `ctx.event` only | **No payload field exists.** Absent argv event → return null |
| Session id | `conversationId` | UUID, stable across a conversation |
| cwd | `workspacePaths[0]` if non-empty, else `ctx.cwd` | observed `[]` in every capture |
| Tool name | `toolCall.name` | nested; `toolCall` can legitimately be `null` even on a tool event |
| Transcript | `transcriptPath` | always present |
| pid | `ctx.pid` only | no payload field exists |
| Error | `error` | present on `PostToolUse` and `Stop`; `""` means success |

Event kinds: `PreInvocation` → `prompt-submit`, `PostInvocation` → `tool-end`, `PreToolUse` → `tool-start`, `PostToolUse` → `tool-end`, `Stop` → `stop`. A non-empty `error` overrides the mapped kind with `error`.

- [ ] **Step 1: Move the shared interface into `index.ts`**

Create `src/core/adapters/index.ts`:

```ts
import type { AgentEvent, AgentId, Decision, HookContext } from '../types.js'
import { claudeAdapter } from './claude.js'
import { codexAdapter } from './codex.js'
import { antigravityAdapter } from './antigravity.js'

export interface AgentAdapter {
  id: AgentId
  displayName: string
  normalize(raw: unknown, ctx: HookContext): AgentEvent | null
  encodeDecision(d: Decision): unknown
}

export const adapters: Record<AgentId, AgentAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  antigravity: antigravityAdapter,
}

export function isAgentId(v: string): v is AgentId {
  return v === 'claude' || v === 'codex' || v === 'antigravity'
}

export function normalizeFor(agent: AgentId, raw: unknown, ctx: HookContext): AgentEvent | null {
  return adapters[agent].normalize(raw, ctx)
}
```

In `src/core/adapters/claude.ts`, delete the local `export interface AgentAdapter { ... }` block and replace it with `import type { AgentAdapter } from './index.js'`. `index.ts` becomes the single source.

- [ ] **Step 2: Write the failing Antigravity test**

`test/core/adapters/antigravity.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { antigravityAdapter } from '../../../src/core/adapters/antigravity.js'
import type { HookContext } from '../../../src/core/types.js'

const ctx = (event?: string): HookContext => ({ pid: 7, ts: 9, cwd: '/hook/cwd', event })

describe('antigravityAdapter.normalize', () => {
  it('takes the event name from argv, since no payload field exists', () => {
    const e = antigravityAdapter.normalize(
      { conversationId: 'c1', workspacePaths: [], transcriptPath: '/t.json',
        toolCall: { name: 'write_to_file' } },
      ctx('PreToolUse')
    )
    expect(e).toEqual({
      agent: 'antigravity', kind: 'tool-start', sessionId: 'c1', cwd: '/hook/cwd',
      tool: 'write_to_file', detail: undefined, transcriptPath: '/t.json', pid: 7, ts: 9,
    })
  })

  it('returns null when argv carries no event, since the payload cannot supply one', () => {
    expect(antigravityAdapter.normalize({ conversationId: 'c1' }, ctx())).toBeNull()
  })

  it('uses workspacePaths[0] when it is non-empty', () => {
    const e = antigravityAdapter.normalize(
      { conversationId: 'c1', workspacePaths: ['/home/me/app'] }, ctx('Stop')
    )
    expect(e?.cwd).toBe('/home/me/app')
  })

  it('falls back to the hook cwd when workspacePaths is the observed empty array', () => {
    const e = antigravityAdapter.normalize(
      { conversationId: 'c1', workspacePaths: [] }, ctx('Stop')
    )
    expect(e?.cwd).toBe('/hook/cwd')
  })

  it('maps every wired event kind', () => {
    const pairs: Array<[string, string]> = [
      ['PreInvocation', 'prompt-submit'],
      ['PostInvocation', 'tool-end'],
      ['PreToolUse', 'tool-start'],
      ['PostToolUse', 'tool-end'],
      ['Stop', 'stop'],
    ]
    for (const [event, kind] of pairs) {
      const e = antigravityAdapter.normalize({ conversationId: 'c1' }, ctx(event))
      expect(e?.kind, event).toBe(kind)
    }
  })

  it('treats an empty error string as success, not failure', () => {
    const e = antigravityAdapter.normalize(
      { conversationId: 'c1', error: '' }, ctx('PostToolUse')
    )
    expect(e?.kind).toBe('tool-end')
  })

  it('reports an error kind when error is non-empty', () => {
    const e = antigravityAdapter.normalize(
      { conversationId: 'c1', error: 'boom' }, ctx('PostToolUse')
    )
    expect(e?.kind).toBe('error')
    expect(e?.detail).toBe('boom')
  })

  it('tolerates toolCall being null on a tool event', () => {
    const e = antigravityAdapter.normalize(
      { conversationId: 'c1', toolCall: null }, ctx('PostToolUse')
    )
    expect(e?.kind).toBe('tool-end')
    expect(e?.tool).toBeUndefined()
  })

  it('extracts a run_command CommandLine as detail', () => {
    const e = antigravityAdapter.normalize(
      { conversationId: 'c1', toolCall: { name: 'run_command', args: { CommandLine: 'ls -la' } } },
      ctx('PreToolUse')
    )
    expect(e?.detail).toBe('ls -la')
  })

  it('extracts a write_to_file TargetFile as detail', () => {
    const e = antigravityAdapter.normalize(
      { conversationId: 'c1', toolCall: { name: 'write_to_file', args: { TargetFile: '/p/a.txt' } } },
      ctx('PreToolUse')
    )
    expect(e?.detail).toBe('/p/a.txt')
  })

  it('returns null with no conversation id', () => {
    expect(antigravityAdapter.normalize({ workspacePaths: ['/p'] }, ctx('Stop'))).toBeNull()
  })

  it('returns null for an unknown event and a non-object payload', () => {
    expect(antigravityAdapter.normalize({ conversationId: 'c1' }, ctx('Nope'))).toBeNull()
    expect(antigravityAdapter.normalize(null, ctx('Stop'))).toBeNull()
  })
})

describe('antigravityAdapter.encodeDecision', () => {
  it('encodes allow, deny and fallthrough', () => {
    expect((antigravityAdapter.encodeDecision({ kind: 'allow' }) as any).permissionDecision).toBe('allow')
    expect((antigravityAdapter.encodeDecision({ kind: 'deny' }) as any).permissionDecision).toBe('deny')
    expect(antigravityAdapter.encodeDecision({ kind: 'fallthrough' })).toEqual({})
  })
})

describe('antigravityAdapter against captured fixtures', () => {
  const dir = 'test/fixtures/antigravity'

  it('has fixtures to test against', () => {
    expect(existsSync(dir), `${dir} must exist — fixtures are the adapter spec`).toBe(true)
    expect(readdirSync(dir).filter((f) => f.endsWith('.json')).length).toBeGreaterThan(0)
  })

  it('normalizes every captured payload, taking the event from the filename', () => {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const event = f.split('-')[0]!
      const raw = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'))
      const e = antigravityAdapter.normalize(raw, ctx(event))
      expect(e, `${f} must normalize, not drop`).not.toBeNull()
      expect(e!.sessionId, `${f} must yield a session id`).toBeTruthy()
      expect(e!.cwd, `${f} must yield a cwd`).toBeTruthy()
    }
  })

  it('confirms the fixtures really do lack an event-name field', () => {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const raw = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'))
      for (const key of ['hookEventName', 'hook_event_name', 'type', 'event']) {
        expect(raw[key], `${f} unexpectedly has ${key} — revisit the argv design`).toBeUndefined()
      }
    }
  })
})
```

The last test is a regression guard: if a future Antigravity release starts emitting an event-name field, it fails and tells us the argv workaround can be simplified.

- [ ] **Step 3: Write `src/core/adapters/antigravity.ts`**

```ts
import type { Decision, EventKind, HookContext } from '../types.js'
import type { AgentAdapter } from './index.js'

const KIND_BY_EVENT: Record<string, EventKind> = {
  PreInvocation: 'prompt-submit',
  PostInvocation: 'tool-end',
  PreToolUse: 'tool-start',
  PostToolUse: 'tool-end',
  Stop: 'stop',
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/**
 * Antigravity nests the tool under `toolCall`, which is null on non-tool steps
 * even for tool events. Args are per-tool; these are the keys observed in the
 * captured fixtures. Unknown tools simply yield no detail.
 */
function detailFromToolCall(toolCall: unknown): string | undefined {
  if (!isRecord(toolCall)) return undefined
  const args = toolCall['args']
  if (!isRecord(args)) return undefined
  return str(args['CommandLine']) ?? str(args['TargetFile']) ?? str(args['Path'])
}

export const antigravityAdapter: AgentAdapter = {
  id: 'antigravity',
  displayName: 'Antigravity CLI',

  normalize(raw, ctx) {
    if (!isRecord(raw)) return null

    // No Antigravity payload names its own event; argv is the only source.
    if (!ctx.event) return null
    const baseKind = KIND_BY_EVENT[ctx.event]
    if (!baseKind) return null

    const sessionId = str(raw['conversationId'])
    if (!sessionId) return null

    const paths = raw['workspacePaths']
    const cwd = (Array.isArray(paths) ? str(paths[0]) : undefined) ?? ctx.cwd
    if (!cwd) return null

    // `error` is present but empty on success; only a non-empty value is a failure.
    const error = str(raw['error'])
    const toolCall = raw['toolCall']

    return {
      agent: 'antigravity',
      kind: error ? 'error' : baseKind,
      sessionId,
      cwd,
      tool: isRecord(toolCall) ? str(toolCall['name']) : undefined,
      detail: error ?? detailFromToolCall(toolCall),
      transcriptPath: str(raw['transcriptPath']),
      pid: ctx.pid,
      ts: ctx.ts,
    }
  },

  encodeDecision(d: Decision) {
    if (d.kind === 'fallthrough') return {}
    return {
      permissionDecision: d.kind,
      permissionDecisionReason:
        d.reason ?? (d.kind === 'allow' ? 'Allowed from Dasbo Island' : 'Denied from Dasbo Island'),
    }
  },
}
```

- [ ] **Step 4: Write the Codex test — unverified adapter, explicitly marked**

`test/core/adapters/codex.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { codexAdapter } from '../../../src/core/adapters/codex.js'
import type { HookContext } from '../../../src/core/types.js'

const ctx: HookContext = { pid: 1, ts: 2, cwd: '/hook/cwd' }

// NOTE: Codex captured zero fixtures in Task 2 (not authenticated, HTTP 401).
// The key names below come from ~/.codex/vibe-island-hook.py, which reads
// `type`, `session_id`, `cwd`, `tool_name`. That is third-party evidence, not
// verbatim capture. These tests pin the adapter's behaviour against that
// assumption so a later real capture produces a clear, loud failure if the
// assumption was wrong.

describe('codexAdapter.normalize (UNVERIFIED — no captured fixtures)', () => {
  it('maps dotted event names from the type field', () => {
    const cases: Array<[string, string]> = [
      ['session.start', 'session-start'],
      ['session.end', 'stop'],
      ['tool.start', 'tool-start'],
      ['tool.end', 'tool-end'],
    ]
    for (const [type, kind] of cases) {
      const e = codexAdapter.normalize({ type, session_id: 's1', cwd: '/p/app' }, ctx)
      expect(e?.kind, type).toBe(kind)
    }
  })

  it('also accepts CamelCase hook_event_name payloads', () => {
    const e = codexAdapter.normalize(
      { hook_event_name: 'PreToolUse', session_id: 's1', cwd: '/p/app', tool_name: 'shell' }, ctx
    )
    expect(e?.kind).toBe('tool-start')
    expect(e?.tool).toBe('shell')
  })

  it('falls back to the argv event and the hook cwd', () => {
    const e = codexAdapter.normalize({ session_id: 's1' }, { ...ctx, event: 'tool.start' })
    expect(e?.kind).toBe('tool-start')
    expect(e?.cwd).toBe('/hook/cwd')
  })

  it('returns null on unknown type or missing session id', () => {
    expect(codexAdapter.normalize({ type: 'nope', session_id: 's', cwd: '/p' }, ctx)).toBeNull()
    expect(codexAdapter.normalize({ type: 'tool.start', cwd: '/p' }, ctx)).toBeNull()
  })
})

describe('codexAdapter.encodeDecision', () => {
  it('encodes allow and deny in the hookSpecificOutput shape', () => {
    const allow = codexAdapter.encodeDecision({ kind: 'allow' }) as any
    expect(allow.hookSpecificOutput.permissionDecision).toBe('allow')
    const deny = codexAdapter.encodeDecision({ kind: 'deny', reason: 'no' }) as any
    expect(deny.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(deny.hookSpecificOutput.permissionDecisionReason).toBe('no')
  })

  it('encodes fallthrough as an empty object so Codex is unaffected', () => {
    expect(codexAdapter.encodeDecision({ kind: 'fallthrough' })).toEqual({})
  })
})

describe('codex fixture status', () => {
  it('records that no fixtures exist yet, and will fail once they do', () => {
    expect(
      existsSync('test/fixtures/codex'),
      'test/fixtures/codex now exists — delete this test and write real fixture-driven ' +
      'assertions like the claude and antigravity suites have'
    ).toBe(false)
  })
})
```

That final test is deliberately inverted: it passes while Codex is unverified and fails the moment fixtures land, forcing the real assertions to be written rather than forgotten.

- [ ] **Step 5: Write `src/core/adapters/codex.ts`**

```ts
import type { Decision, EventKind, HookContext } from '../types.js'
import type { AgentAdapter } from './index.js'
import { detailFromToolInput } from './claude.js'

/**
 * UNVERIFIED. Codex captured no fixtures in Task 2 — the environment was not
 * authenticated. Key names are taken from the installed vibe-island hook
 * script, which reads `type`, `session_id`, `cwd` and `tool_name`. Both the
 * dotted `type` names and the CamelCase `hook_event_name` names are accepted,
 * since the installed build and the published docs disagree about which is used.
 */
const KIND_BY_EVENT: Record<string, EventKind> = {
  'session.start': 'session-start',
  'session.end': 'stop',
  'tool.start': 'tool-start',
  'tool.end': 'tool-end',
  SessionStart: 'session-start',
  UserPromptSubmit: 'prompt-submit',
  PreToolUse: 'tool-start',
  PostToolUse: 'tool-end',
  Stop: 'stop',
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

export const codexAdapter: AgentAdapter = {
  id: 'codex',
  displayName: 'Codex CLI',

  normalize(raw, ctx) {
    if (!isRecord(raw)) return null

    const eventName = str(raw['type']) ?? str(raw['hook_event_name']) ?? ctx.event
    if (!eventName) return null
    const kind = KIND_BY_EVENT[eventName]
    if (!kind) return null

    const sessionId = str(raw['session_id'])
    if (!sessionId) return null

    const cwd = str(raw['cwd']) ?? ctx.cwd
    if (!cwd) return null

    return {
      agent: 'codex',
      kind,
      sessionId,
      cwd,
      tool: str(raw['tool_name']),
      detail: detailFromToolInput(raw['tool_input']) ?? str(raw['command']),
      transcriptPath: str(raw['transcript_path']),
      pid: ctx.pid,
      ts: ctx.ts,
    }
  },

  encodeDecision(d: Decision) {
    if (d.kind === 'fallthrough') return {}
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: d.kind,
        permissionDecisionReason:
          d.reason ?? (d.kind === 'allow' ? 'Allowed from Dasbo Island' : 'Denied from Dasbo Island'),
      },
    }
  },
}
```

- [ ] **Step 6: Write the dispatch test**

`test/core/adapters/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { adapters, isAgentId, normalizeFor } from '../../../src/core/adapters/index.js'
import type { HookContext } from '../../../src/core/types.js'

const ctx: HookContext = { pid: 1, ts: 2, cwd: '/hook/cwd' }

describe('adapter dispatch', () => {
  it('exposes one adapter per agent id, each self-identifying', () => {
    for (const id of ['claude', 'codex', 'antigravity'] as const) {
      expect(adapters[id].id).toBe(id)
    }
  })

  it('isAgentId rejects unknown ids', () => {
    expect(isAgentId('claude')).toBe(true)
    expect(isAgentId('cursor')).toBe(false)
  })

  it('normalizeFor routes to the right adapter', () => {
    const e = normalizeFor('claude', { hook_event_name: 'Stop', session_id: 's', cwd: '/p' }, ctx)
    expect(e?.agent).toBe('claude')
  })
})
```

- [ ] **Step 7: Run every test and the typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all suites PASS, `tsc` silent.

- [ ] **Step 8: Commit**

```bash
git add src/core/adapters test/core/adapters
git commit -m "feat(core): add Antigravity and Codex adapters with dispatch"
```

---

## Task 7 (revised): D-Bus interface signature

Only the interface XML and the two method bodies change. Everything else in base-plan Task 7 stands.

`src/dbus/iface.ts`:

```ts
export const BUS_NAME = 'org.dasbo.Island'
export const OBJECT_PATH = '/org/dasbo/Island'

export const IFACE_XML = `
<node>
  <interface name="org.dasbo.Island">
    <method name="Notify">
      <arg type="s" direction="in" name="agent"/>
      <arg type="s" direction="in" name="event"/>
      <arg type="s" direction="in" name="cwd"/>
      <arg type="i" direction="in" name="pid"/>
      <arg type="s" direction="in" name="payloadJson"/>
    </method>
    <method name="RequestPermission">
      <arg type="s" direction="in" name="agent"/>
      <arg type="s" direction="in" name="event"/>
      <arg type="s" direction="in" name="cwd"/>
      <arg type="i" direction="in" name="pid"/>
      <arg type="s" direction="in" name="payloadJson"/>
      <arg type="s" direction="out" name="decisionJson"/>
    </method>
    <method name="Ping">
      <arg type="s" direction="out" name="version"/>
    </method>
  </interface>
</node>
`
```

The hook cannot learn its own pid or cwd through D-Bus, and Antigravity payloads carry neither, so both travel as explicit arguments alongside the event name.

In `src/dbus/service.ts`, the two methods become:

```ts
  Notify(agent: string, event: string, cwd: string, pid: number, payloadJson: string): void {
    if (!isAgentId(agent)) return
    let raw: unknown
    try {
      raw = JSON.parse(payloadJson)
    } catch {
      console.warn(`dasbo-island: unparseable payload from ${agent}`)
      return
    }
    const e = normalizeFor(agent, raw, { pid, ts: Date.now(), cwd, event })
    if (!e) return
    this.store.apply(e)
  }

  RequestPermissionAsync(
    params: [string, string, string, number, string],
    invocation: Gio.DBusMethodInvocation
  ): void {
    const [agent, event, cwd, pid, payloadJson] = params
    const reply = (json: string) => {
      invocation.return_value(new GLib.Variant('(s)', [json]))
    }

    if (!isAgentId(agent)) return reply('{}')

    let raw: unknown
    try {
      raw = JSON.parse(payloadJson)
    } catch {
      return reply('{}')
    }

    const adapter = adapters[agent]
    const e = normalizeFor(agent, raw, { pid, ts: Date.now(), cwd, event })
    if (!e) return reply(JSON.stringify(adapter.encodeDecision({ kind: 'fallthrough' })))

    this.store.apply(e)
    const key = sessionKey(e.agent, e.sessionId)

    this.permissions.request(
      {
        sessionKey: key,
        tool: e.tool ?? 'unknown',
        detail: e.detail,
        timeoutSeconds: this.opts.timeoutSeconds(),
      },
      (decision) => reply(JSON.stringify(adapter.encodeDecision(decision)))
    )

    if (this.store.get(key)?.pendingPermission) this.opts.onPermissionOpened()
  }
```

`tools/fake-agent.js` changes its variant accordingly:

```js
const args = new GLib.Variant('(sssis)', ['claude', EVENT, GLib.get_current_dir(), FAKE_PID, payload])
```

where `EVENT` is `'SessionStart'`, `'PreToolUse'` or `'PreToolUse'` for the `session`, `tool` and `perm` modes respectively.

---

## Task 8 (revised): `dasbo-hook` signature

```
dasbo-hook <claude|codex|antigravity> <notify|permission> [EventName]
```

The third argument is required for Antigravity and optional for the others. The hook reports its own pid and its own working directory.

Replace the `main()` and add the cwd lookup:

```js
function main() {
  const agent = ARGV[0]
  const mode = ARGV[1] ?? 'notify'
  const event = ARGV[2] ?? ''
  if (!agent) return

  let payload
  try {
    payload = readStdin()
    if (!payload.trim()) return
    JSON.parse(payload) // validate before sending; malformed input is dropped here
  } catch {
    return
  }

  const args = new GLib.Variant('(sssis)', [
    agent, event, GLib.get_current_dir(), getPid(), payload,
  ])

  if (mode === 'permission') {
    const reply = Gio.DBus.session.call_sync(
      BUS_NAME, OBJECT_PATH, IFACE, 'RequestPermission',
      args, new GLib.VariantType('(s)'), Gio.DBusCallFlags.NONE, NO_TIMEOUT, null
    )
    const [decisionJson] = reply.deepUnpack()
    if (decisionJson && decisionJson !== '{}') print(decisionJson)
  } else {
    Gio.DBus.session.call_sync(
      BUS_NAME, OBJECT_PATH, IFACE, 'Notify',
      args, null, Gio.DBusCallFlags.NONE, 5000, null
    )
  }
}
```

Everything else in base-plan Task 8 stands, including the fail-open contract and every verification step. Add one verification:

- [ ] **Extra step: Verify the event argument reaches the store**

Run:
```bash
echo '{"conversationId":"agy-1","workspacePaths":[]}' | ./hooks/dasbo-hook antigravity notify PreToolUse
```
Expected: a session appears whose project name is the basename of the directory you ran the command from — proving both the argv event and the hook's own cwd made it through. Running the same command with the trailing `PreToolUse` omitted must produce no session at all.

---

## Task 13 (revised): install planner shapes

`CLAUDE_EVENTS`, `ANTIGRAVITY_EVENTS` and the command builder change so each event gets its own command carrying the event name.

```ts
function cmd(env: InstallEnv, agent: AgentId, mode: 'notify' | 'permission', event: string): string {
  return `${env.hookPath} ${agent} ${mode} ${event}`
}
```

### Claude — `~/.claude/settings.json`

Shape unchanged from the base plan. Only the command string gains the event name, so a hook line remains self-describing even though Claude's payload already names its event.

### Codex — `~/.codex/hooks.json`

The bare top-level map the base plan emitted is **rejected** by Codex 0.142.0 with `unknown field 'vibe-island', expected 'hooks'`. The named-hook map must be nested under a `hooks` key:

```ts
function codexEdits(env: InstallEnv, install: boolean): FileEdit[] {
  const path = `${env.home}/.codex/hooks.json`
  const doc = parseOrNull(env.existing(path))
  if (doc === undefined) return []
  const root: Record<string, any> = doc === null ? {} : { ...doc }

  // Codex 0.142 requires the named-hook map nested under "hooks". A bare
  // top-level map is rejected outright, which silently disables every hook
  // in the file — including any foreign entries already present.
  const hooks: Record<string, any> = { ...(root['hooks'] ?? {}) }

  if (install) {
    hooks[CODEX_KEY] = {
      command: `${env.hookPath} codex notify`,
      events: [...CODEX_EVENTS],
    }
  } else {
    if (!(CODEX_KEY in hooks)) return []
    delete hooks[CODEX_KEY]
  }

  root['hooks'] = hooks
  return [{ path, content: JSON.stringify(root, null, 2) + '\n', backup: true }]
}
```

Codex takes one command for a list of events, so it cannot carry a per-event argv. It does not need to — its payload names the event in `type`.

A migration note worth surfacing in the prefs UI: any pre-existing unwrapped `~/.codex/hooks.json` is currently being ignored by Codex entirely. Wrapping it re-activates those foreign entries, which is a behaviour change the user should know about. The install step must therefore preserve unwrapped foreign keys by moving them under `hooks` rather than dropping them, and say so in the toast.

### Antigravity — `~/.gemini/config/hooks.json`

Two structural corrections. Event sets nest under an arbitrary hook name, and the five events use two different handler structures:

```ts
const ANTIGRAVITY_KEY = 'dasbo-island'
const ANTIGRAVITY_GROUPED = ['PreToolUse', 'PostToolUse'] as const
const ANTIGRAVITY_FLAT = ['PreInvocation', 'PostInvocation', 'Stop'] as const

function antigravityEdits(env: InstallEnv, install: boolean): FileEdit[] {
  const path = `${env.home}/.gemini/config/hooks.json`
  const doc = parseOrNull(env.existing(path))
  if (doc === undefined) return []
  const root: Record<string, any> = doc === null ? {} : { ...doc }

  if (!install) {
    if (!(ANTIGRAVITY_KEY in root)) return []
    delete root[ANTIGRAVITY_KEY]
    return [{ path, content: JSON.stringify(root, null, 2) + '\n', backup: true }]
  }

  const set: Record<string, any> = {}

  // PreToolUse / PostToolUse are grouped: matcher + hooks array, like Claude.
  for (const event of ANTIGRAVITY_GROUPED) {
    const mode = event === 'PreToolUse' ? 'permission' : 'notify'
    set[event] = [
      { matcher: '.*', hooks: [{ type: 'command', command: cmd(env, 'antigravity', mode, event) }] },
    ]
  }

  // PreInvocation / PostInvocation / Stop are flat: handler objects directly,
  // with no matcher and no hooks wrapper.
  for (const event of ANTIGRAVITY_FLAT) {
    set[event] = [{ type: 'command', command: cmd(env, 'antigravity', 'notify', event) }]
  }

  root[ANTIGRAVITY_KEY] = set
  return [{ path, content: JSON.stringify(root, null, 2) + '\n', backup: true }]
}
```

Because uninstall now keys off `ANTIGRAVITY_KEY` rather than scanning for our marker inside event arrays, foreign hook names in the same file survive untouched.

### Tests to add in Task 13

Beyond the base plan's cases, add:

```ts
it('nests codex entries under a hooks key, as Codex 0.142 requires', () => {
  const parsed = JSON.parse(planInstall('codex', env())[0]!.content)
  expect(parsed.hooks['dasbo-island']).toBeDefined()
  expect(parsed['dasbo-island'], 'must not sit at the top level').toBeUndefined()
})

it('rescues foreign entries from a legacy unwrapped codex hooks.json', () => {
  const legacy = JSON.stringify({ 'vibe-island': { command: 'python3 /x/y.py', events: ['session.start'] } })
  const parsed = JSON.parse(
    planInstall('codex', env({ '/home/me/.codex/hooks.json': legacy }))[0]!.content
  )
  expect(parsed.hooks['vibe-island'], 'legacy entry must be migrated under hooks, not dropped').toBeDefined()
  expect(parsed.hooks['dasbo-island']).toBeDefined()
})

it('gives antigravity grouped tool events and flat invocation events', () => {
  const set = JSON.parse(planInstall('antigravity', env())[0]!.content)['dasbo-island']
  expect(set.PreToolUse[0].matcher).toBe('.*')
  expect(set.PreToolUse[0].hooks[0].command).toContain('antigravity permission PreToolUse')
  expect(set.Stop[0].type).toBe('command')
  expect(set.Stop[0].matcher, 'flat events take no matcher').toBeUndefined()
  expect(set.Stop[0].hooks, 'flat events take no hooks wrapper').toBeUndefined()
})

it('encodes a distinct event name in every antigravity command', () => {
  const set = JSON.parse(planInstall('antigravity', env())[0]!.content)['dasbo-island']
  const commands = ['PreToolUse', 'PostToolUse', 'PreInvocation', 'PostInvocation', 'Stop'].map(
    (e) => JSON.stringify(set[e])
  )
  for (const [i, e] of ['PreToolUse', 'PostToolUse', 'PreInvocation', 'PostInvocation', 'Stop'].entries()) {
    expect(commands[i]).toContain(`antigravity `)
    expect(commands[i]).toContain(e)
  }
})

it('removes only our antigravity hook name, leaving foreign ones', () => {
  const installed = JSON.parse(planInstall('antigravity', env())[0]!.content)
  installed['someone-else'] = { Stop: [{ type: 'command', command: '/other' }] }
  const parsed = JSON.parse(
    planUninstall('antigravity', env({
      '/home/me/.gemini/config/hooks.json': JSON.stringify(installed),
    }))[0]!.content
  )
  expect(parsed['someone-else']).toBeDefined()
  expect(parsed['dasbo-island']).toBeUndefined()
})
```

---

## Still open

- **Codex fixtures.** Blocked on authentication. Once `codex login` succeeds, re-run Task 2's capture for Codex alone against the corrected `{"hooks": {...}}` shape, then replace the inverted placeholder test in Task 5 Step 4 with real fixture-driven assertions and re-verify `codexAdapter`.
