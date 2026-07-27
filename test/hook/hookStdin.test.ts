import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * End-to-end hook tests. They run the real hooks/dasbo-hook against a stub
 * service on a private bus, so they need gjs and dbus-run-session; where those
 * are missing (a bare CI container) the suite skips rather than fails.
 */
const have = (bin: string) => spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0
const canRun = have('gjs') && have('dbus-run-session')

const PAYLOAD = readFileSync(
  join(import.meta.dirname, '..', 'fixtures', 'claude', 'SessionStart-0.json'),
  'utf8'
)

interface HarnessResult {
  code?: number
  stdout?: string
  stderr?: string
  error?: string
  received?: { agent: string; event: string; cwd: string; pid: number; payloadJson: string } | null
}

function runHook(mode: 'notify' | 'permission', event: string, payload: string): HarnessResult {
  const out = join(tmpdir(), `dasbo-stub-${process.pid}-${mode}.json`)
  const r = spawnSync(
    'dbus-run-session',
    ['--', 'node', join(import.meta.dirname, 'harness.mjs'), mode, event],
    { input: payload, encoding: 'utf8', env: { ...process.env, DASBO_STUB_OUT: out } }
  )
  const last = r.stdout.trim().split('\n').at(-1) ?? ''
  return JSON.parse(last) as HarnessResult
}

describe.skipIf(!canRun)('dasbo-hook over an agent-style stdin pipe', () => {
  it('forwards a notify payload the agent wrote to a socketpair stdin', () => {
    const r = runHook('notify', 'SessionStart', PAYLOAD)
    expect(r.error).toBeUndefined()
    expect(r.received).not.toBeNull()
    expect(r.received?.agent).toBe('claude')
    expect(r.received?.event).toBe('SessionStart')
    expect(r.received?.payloadJson).toBe(PAYLOAD)
    expect(r.received?.pid).toBeGreaterThan(0)
  }, 40_000)

  it('returns the decision the service replied with, on stdout', () => {
    const r = runHook('permission', 'PreToolUse', PAYLOAD)
    expect(r.received?.event).toBe('PreToolUse')
    expect(r.stdout?.trim()).toBe(JSON.stringify({ stub: 'decision' }))
  }, 40_000)

  it('stays silent and exits 0 on empty stdin', () => {
    const r = runHook('notify', 'SessionStart', '')
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('')
    expect(r.stderr).toBe('')
    expect(r.received ?? null).toBeNull()
  }, 40_000)

  it('drops malformed input without calling the service', () => {
    const r = runHook('notify', 'SessionStart', 'not json at all')
    expect(r.code).toBe(0)
    expect(r.received ?? null).toBeNull()
  }, 40_000)
})
