import { describe, it, expect } from 'vitest'
import { planInstall, planUninstall, type InstallEnv } from '../../../src/core/install/plan.js'

function env(files: Record<string, string> = {}): InstallEnv {
  return {
    home: '/home/me',
    hookPath: '/home/me/.local/share/gnome-shell/extensions/dasbo-island@ayubaswad.gmail.com/hooks/dasbo-hook',
    existing: (p) => files[p] ?? null,
  }
}

describe('planInstall for claude', () => {
  it('creates settings.json with all five hook events when the file is absent', () => {
    const edits = planInstall('claude', env())
    expect(edits).toHaveLength(1)
    expect(edits[0]!.path).toBe('/home/me/.claude/settings.json')
    expect(edits[0]!.backup).toBe(true)
    const parsed = JSON.parse(edits[0]!.content)
    expect(Object.keys(parsed.hooks).sort()).toEqual(
      ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop', 'UserPromptSubmit']
    )
  })

  it('uses permission mode for PreToolUse and notify mode elsewhere', () => {
    const parsed = JSON.parse(planInstall('claude', env())[0]!.content)
    expect(parsed.hooks.PreToolUse[0].hooks[0].command).toContain('claude permission')
    expect(parsed.hooks.Stop[0].hooks[0].command).toContain('claude notify')
  })

  it('carries the event name in every command, so each hook line is self-describing', () => {
    const parsed = JSON.parse(planInstall('claude', env())[0]!.content)
    expect(parsed.hooks.PreToolUse[0].hooks[0].command).toContain('PreToolUse')
    expect(parsed.hooks.Stop[0].hooks[0].command).toContain('Stop')
  })

  it('preserves unrelated keys in an existing settings.json', () => {
    const before = JSON.stringify({ model: 'opus', hooks: {} })
    const edits = planInstall('claude', env({ '/home/me/.claude/settings.json': before }))
    const parsed = JSON.parse(edits[0]!.content)
    expect(parsed.model).toBe('opus')
  })

  it('preserves foreign hook entries alongside ours', () => {
    const before = JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: '/other/tool' }] }] },
    })
    const parsed = JSON.parse(
      planInstall('claude', env({ '/home/me/.claude/settings.json': before }))[0]!.content
    )
    const commands = parsed.hooks.Stop.flatMap((g: any) => g.hooks.map((h: any) => h.command))
    expect(commands).toContain('/other/tool')
    expect(commands.some((c: string) => c.includes('dasbo-hook'))).toBe(true)
  })

  it('is idempotent — installing twice yields one dasbo entry', () => {
    const first = planInstall('claude', env())[0]!.content
    const parsed = JSON.parse(
      planInstall('claude', env({ '/home/me/.claude/settings.json': first }))[0]!.content
    )
    const commands = parsed.hooks.Stop.flatMap((g: any) => g.hooks.map((h: any) => h.command))
    expect(commands.filter((c: string) => c.includes('dasbo-hook'))).toHaveLength(1)
  })

  it('leaves malformed existing JSON untouched by returning no edits', () => {
    const edits = planInstall('claude', env({ '/home/me/.claude/settings.json': '{not json' }))
    expect(edits).toEqual([])
  })
})

describe('planInstall for codex', () => {
  it('writes hooks.json preserving a foreign entry, nested under hooks', () => {
    const before = JSON.stringify({
      hooks: { 'vibe-island': { command: 'python3 /x/y.py', events: ['session.start'] } },
    })
    const edits = planInstall('codex', env({ '/home/me/.codex/hooks.json': before }))
    const parsed = JSON.parse(edits[0]!.content)
    expect(parsed.hooks['vibe-island']).toBeDefined()
    expect(parsed.hooks['dasbo-island'].command).toContain('codex notify')
    expect(parsed.hooks['dasbo-island'].events).toContain('session.start')
  })

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

  it('is idempotent — installing twice yields one dasbo-island entry under hooks', () => {
    const first = planInstall('codex', env())[0]!.content
    const parsed = JSON.parse(
      planInstall('codex', env({ '/home/me/.codex/hooks.json': first }))[0]!.content
    )
    expect(Object.keys(parsed.hooks).filter((k) => k === 'dasbo-island')).toHaveLength(1)
  })

  it('leaves malformed existing JSON untouched by returning no edits', () => {
    const edits = planInstall('codex', env({ '/home/me/.codex/hooks.json': '{not json' }))
    expect(edits).toEqual([])
  })
})

describe('planInstall for antigravity', () => {
  it('writes hooks.json under .gemini/config, nested under an arbitrary hook name', () => {
    const edits = planInstall('antigravity', env())
    expect(edits[0]!.path).toBe('/home/me/.gemini/config/hooks.json')
    const parsed = JSON.parse(edits[0]!.content)
    expect(parsed['dasbo-island'].PreToolUse[0].hooks[0].command).toContain('antigravity permission')
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
    const events = ['PreToolUse', 'PostToolUse', 'PreInvocation', 'PostInvocation', 'Stop']
    const commands = events.map((e) => JSON.stringify(set[e]))
    for (const [i, e] of events.entries()) {
      expect(commands[i]).toContain('antigravity ')
      expect(commands[i]).toContain(e)
    }
  })

  it('preserves a foreign hook name already present in the file', () => {
    const before = JSON.stringify({ 'someone-else': { Stop: [{ type: 'command', command: '/other' }] } })
    const parsed = JSON.parse(
      planInstall('antigravity', env({ '/home/me/.gemini/config/hooks.json': before }))[0]!.content
    )
    expect(parsed['someone-else']).toBeDefined()
    expect(parsed['dasbo-island']).toBeDefined()
  })

  it('is idempotent — installing twice yields one dasbo-island key', () => {
    const first = planInstall('antigravity', env())[0]!.content
    const parsed = JSON.parse(
      planInstall('antigravity', env({ '/home/me/.gemini/config/hooks.json': first }))[0]!.content
    )
    expect(Object.keys(parsed).filter((k) => k === 'dasbo-island')).toHaveLength(1)
  })

  it('leaves malformed existing JSON untouched by returning no edits', () => {
    const edits = planInstall('antigravity', env({ '/home/me/.gemini/config/hooks.json': '{not json' }))
    expect(edits).toEqual([])
  })
})

describe('planUninstall', () => {
  it('removes only our claude entries and keeps foreign ones', () => {
    const installed = planInstall('claude', env())[0]!.content
    const withForeign = JSON.parse(installed)
    withForeign.hooks.Stop.push({ hooks: [{ type: 'command', command: '/other/tool' }] })
    const parsed = JSON.parse(
      planUninstall('claude', env({ '/home/me/.claude/settings.json': JSON.stringify(withForeign) }))[0]!.content
    )
    const commands = parsed.hooks.Stop.flatMap((g: any) => g.hooks.map((h: any) => h.command))
    expect(commands).toEqual(['/other/tool'])
  })

  it('returns no edits when nothing is installed', () => {
    expect(planUninstall('claude', env())).toEqual([])
  })

  it('removes only the dasbo-island key from codex hooks.json', () => {
    const before = JSON.stringify({
      hooks: {
        'vibe-island': { command: 'python3 /x/y.py', events: ['session.start'] },
        'dasbo-island': { command: '/h/dasbo-hook codex notify', events: ['session.start'] },
      },
    })
    const parsed = JSON.parse(
      planUninstall('codex', env({ '/home/me/.codex/hooks.json': before }))[0]!.content
    )
    expect(parsed.hooks['vibe-island']).toBeDefined()
    expect(parsed.hooks['dasbo-island']).toBeUndefined()
  })

  it('returns no edits for codex when dasbo-island is not installed', () => {
    const before = JSON.stringify({ hooks: { 'vibe-island': { command: 'x', events: ['session.start'] } } })
    expect(planUninstall('codex', env({ '/home/me/.codex/hooks.json': before }))).toEqual([])
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

  it('leaves malformed existing codex JSON untouched by returning no edits', () => {
    const edits = planUninstall('codex', env({ '/home/me/.codex/hooks.json': '{not json' }))
    expect(edits).toEqual([])
  })

  it('leaves malformed existing antigravity JSON untouched by returning no edits', () => {
    const edits = planUninstall('antigravity', env({ '/home/me/.gemini/config/hooks.json': '{not json' }))
    expect(edits).toEqual([])
  })
})
