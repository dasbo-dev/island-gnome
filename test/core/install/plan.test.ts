import { describe, it, expect } from 'vitest'
import {
  planInstall,
  planUninstall,
  configPath,
  installState,
  type InstallEnv,
} from '../../../src/core/install/plan.js'

function env(files: Record<string, string> = {}): InstallEnv {
  return {
    home: '/home/me',
    hookPath: '/home/me/.local/share/gnome-shell/extensions/dasbo-island@ayubaswad.gmail.com/hooks/dasbo-hook',
    existing: (p) => files[p] ?? null,
  }
}

describe('planInstall for claude', () => {
  it('creates settings.json with all seven hook events when the file is absent', () => {
    const edits = planInstall('claude', env())
    expect(edits).toHaveLength(1)
    expect(edits[0]!.path).toBe('/home/me/.claude/settings.json')
    expect(edits[0]!.backup).toBe(true)
    const parsed = JSON.parse(edits[0]!.content)
    expect(Object.keys(parsed.hooks).sort()).toEqual(
      ['Notification', 'PostToolUse', 'PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'UserPromptSubmit']
    )
  })

  it('reports an install predating Notification as stale, so the row offers Update', () => {
    const full = JSON.parse(planInstall('claude', env())[0]!.content)
    delete full.hooks.Notification
    const fs = { '/home/me/.claude/settings.json': JSON.stringify(full) }
    expect(installState('claude', env(fs))).toBe('stale')
  })

  it('installs Notification in notify mode, never permission', () => {
    const parsed = JSON.parse(planInstall('claude', env())[0]!.content)
    const command = parsed.hooks.Notification[0].hooks[0].command
    expect(command).toContain('claude notify Notification')
    expect(command, 'a notification is not a gate').not.toContain('permission')
  })

  it('gives Notification no matcher, which only the tool events take', () => {
    const parsed = JSON.parse(planInstall('claude', env())[0]!.content)
    expect(parsed.hooks.Notification[0].matcher).toBeUndefined()
  })

  it('removes the Notification entry on uninstall', () => {
    const installed = planInstall('claude', env())[0]!.content
    const edits = planUninstall('claude', env({ '/home/me/.claude/settings.json': installed }))
    const parsed = JSON.parse(edits[0]!.content)
    expect(parsed.hooks.Notification).toBeUndefined()
  })

  it('leaves the plans for the other two agents alone', () => {
    const codex = JSON.parse(planInstall('codex', env())[0]!.content)
    expect(Object.keys(codex.hooks).sort()).toEqual(
      ['PostToolUse', 'PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'UserPromptSubmit']
    )
    const antigravity = JSON.parse(planInstall('antigravity', env())[0]!.content)
    expect(Object.keys(antigravity['dasbo-island']).sort()).toEqual(
      ['PostInvocation', 'PostToolUse', 'PreInvocation', 'PreToolUse', 'Stop']
    )
  })

  it('reports an install predating SessionEnd as stale, so the row offers Update', () => {
    const full = JSON.parse(planInstall('claude', env())[0]!.content)
    delete full.hooks.SessionEnd
    const fs = { '/home/me/.claude/settings.json': JSON.stringify(full) }
    expect(installState('claude', env(fs))).toBe('stale')
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
  // Codex 0.146 takes Claude's shape at ~/.codex/hooks.json: an event-keyed
  // map under `hooks`, each event holding groups of command handlers. The
  // named-hook form dasbo used to write (`{"dasbo-island": {command, events}}`)
  // parses without a warning and never fires — see docs/agent-dialects.md.
  it('writes the six events dasbo listens for, keyed by event name under hooks', () => {
    const edits = planInstall('codex', env())
    expect(edits[0]!.path).toBe('/home/me/.codex/hooks.json')
    const parsed = JSON.parse(edits[0]!.content)
    expect(Object.keys(parsed.hooks).sort()).toEqual(
      ['PostToolUse', 'PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'UserPromptSubmit']
    )
    expect(parsed.hooks.SessionStart[0].hooks[0].type).toBe('command')
  })

  it('installs every codex event in notify mode, never permission', () => {
    // Codex rejects `permissionDecision: allow` and `: ask` from a PreToolUse
    // hook outright, so the permission path Claude uses would error rather than
    // gate anything. Approvals ride Codex's own PermissionRequest event, which
    // dasbo does not wire yet.
    const parsed = JSON.parse(planInstall('codex', env())[0]!.content)
    const commands = Object.values<any>(parsed.hooks).flatMap((groups: any) =>
      groups.flatMap((g: any) => g.hooks.map((h: any) => h.command))
    )
    expect(commands.every((c: string) => c.includes('codex notify'))).toBe(true)
    expect(commands.some((c: string) => c.includes('permission'))).toBe(false)
  })

  it('carries the event name in every command, so each hook line is self-describing', () => {
    const parsed = JSON.parse(planInstall('codex', env())[0]!.content)
    expect(parsed.hooks.PreToolUse[0].hooks[0].command).toContain('codex notify PreToolUse')
    expect(parsed.hooks.Stop[0].hooks[0].command).toContain('codex notify Stop')
  })

  it('gives the tool events a matcher and the rest none, as Claude does', () => {
    const parsed = JSON.parse(planInstall('codex', env())[0]!.content)
    expect(parsed.hooks.PreToolUse[0].matcher).toBe('*')
    expect(parsed.hooks.PostToolUse[0].matcher).toBe('*')
    expect(parsed.hooks.SessionStart[0].matcher).toBeUndefined()
  })

  it('preserves foreign hook entries alongside ours', () => {
    const before = JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: '/other/tool' }] }] },
    })
    const parsed = JSON.parse(
      planInstall('codex', env({ '/home/me/.codex/hooks.json': before }))[0]!.content
    )
    const commands = parsed.hooks.Stop.flatMap((g: any) => g.hooks.map((h: any) => h.command))
    expect(commands).toContain('/other/tool')
    expect(commands.some((c: string) => c.includes('dasbo-hook'))).toBe(true)
  })

  it('clears the old named-hook entry, which Codex parses but never fires', () => {
    const before = JSON.stringify({
      hooks: {
        'vibe-island': { command: 'python3 /x/y.py', events: ['session.start'] },
        'dasbo-island': { command: '/h/dasbo-hook codex notify', events: ['session.start'] },
      },
    })
    const parsed = JSON.parse(
      planInstall('codex', env({ '/home/me/.codex/hooks.json': before }))[0]!.content
    )
    expect(parsed.hooks['dasbo-island'], 'our dead entry goes').toBeUndefined()
    expect(parsed.hooks['vibe-island'], 'a foreign entry is not ours to remove').toBeDefined()
    expect(parsed.hooks.SessionStart).toBeDefined()
  })

  it('is idempotent — installing twice yields one dasbo entry per event', () => {
    const first = planInstall('codex', env())[0]!.content
    const parsed = JSON.parse(
      planInstall('codex', env({ '/home/me/.codex/hooks.json': first }))[0]!.content
    )
    const commands = parsed.hooks.Stop.flatMap((g: any) => g.hooks.map((h: any) => h.command))
    expect(commands.filter((c: string) => c.includes('dasbo-hook'))).toHaveLength(1)
  })

  it('preserves unrelated top-level keys in an existing hooks.json', () => {
    const before = JSON.stringify({ version: 2, hooks: {} })
    const parsed = JSON.parse(
      planInstall('codex', env({ '/home/me/.codex/hooks.json': before }))[0]!.content
    )
    expect(parsed.version).toBe(2)
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

  // Removing our hooks must not double as a normaliser for the rest of the
  // file: each of these holds nothing of ours, so there is nothing to remove.
  // Reporting an edit here also made the row claim `stale`, offering Remove
  // for hooks the user never installed.
  const foreignOnlyClaude: Record<string, unknown> = {
    'a foreign group with an empty hooks array': { hooks: { Stop: [{ matcher: '*', hooks: [] }] } },
    'a foreign group that is not a record': { hooks: { Stop: ['nonsense'] } },
    'a foreign group whose hooks is not an array': { hooks: { Stop: [{ matcher: '*', hooks: 'oops' }] } },
    'an event whose value is not an array': { hooks: { Stop: { matcher: '*' } } },
  }

  for (const [label, doc] of Object.entries(foreignOnlyClaude)) {
    it(`returns no edits for claude given ${label}`, () => {
      const files = { '/home/me/.claude/settings.json': JSON.stringify(doc) }
      expect(planUninstall('claude', env(files))).toEqual([])
    })
  }

  it('leaves foreign junk under an event we hold nothing under alone', () => {
    // Ours under Stop, but PreToolUse now holds only a malformed foreign
    // group (a hand edit having dropped ours). Removing must clear Stop and
    // leave PreToolUse byte-identical.
    const doc = JSON.parse(planInstall('claude', env())[0]!.content)
    doc.hooks.PreToolUse = [{ matcher: '*', hooks: [] }]
    const parsed = JSON.parse(
      planUninstall('claude', env({ '/home/me/.claude/settings.json': JSON.stringify(doc) }))[0]!.content
    )
    expect(parsed.hooks.Stop, 'our own entry is cleared').toBeUndefined()
    expect(parsed.hooks.PreToolUse, 'the foreign group survives, untouched').toEqual([
      { matcher: '*', hooks: [] },
    ])
  })

  it('removes only our codex entries and keeps foreign ones', () => {
    const installed = JSON.parse(planInstall('codex', env())[0]!.content)
    installed.hooks.Stop.push({ hooks: [{ type: 'command', command: '/other/tool' }] })
    const parsed = JSON.parse(
      planUninstall('codex', env({ '/home/me/.codex/hooks.json': JSON.stringify(installed) }))[0]!.content
    )
    const commands = parsed.hooks.Stop.flatMap((g: any) => g.hooks.map((h: any) => h.command))
    expect(commands).toEqual(['/other/tool'])
  })

  it('removes the old named-hook entry too, so a removal leaves nothing of ours', () => {
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

  it('returns no edits for claude when the existing settings.json is malformed', () => {
    expect(planUninstall('claude', env({ '/home/me/.claude/settings.json': '{not json' }))).toEqual([])
  })

  it('returns no edits for codex when nothing of ours is installed', () => {
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

describe('configPath', () => {
  it('names the config file each agent stores hooks in', () => {
    expect(configPath('claude', env())).toBe('/home/me/.claude/settings.json')
    expect(configPath('codex', env())).toBe('/home/me/.codex/hooks.json')
    expect(configPath('antigravity', env())).toBe('/home/me/.gemini/config/hooks.json')
  })
})

describe('installState', () => {
  const agents = ['claude', 'codex', 'antigravity'] as const

  function installed(agent: (typeof agents)[number], e = env()): Record<string, string> {
    const edit = planInstall(agent, e)[0]!
    return { [edit.path]: edit.content }
  }

  function movedEnv(files: Record<string, string> = {}): InstallEnv {
    return {
      home: '/home/me',
      hookPath: '/home/me/.local/share/gnome-shell/extensions/moved/hooks/dasbo-hook',
      existing: (p) => files[p] ?? null,
    }
  }

  for (const agent of agents) {
    it(`reports absent for ${agent} when the config file does not exist`, () => {
      expect(installState(agent, env())).toBe('absent')
    })

    it(`reports installed for ${agent} when fed back what planInstall writes`, () => {
      expect(installState(agent, env(installed(agent)))).toBe('installed')
    })

    it(`reports stale for ${agent} when the installed hook path is out of date`, () => {
      // Written by an extension directory that has since moved: every command
      // embeds the absolute hook path, so all of them are now wrong.
      expect(installState(agent, movedEnv(installed(agent)))).toBe('stale')
    })

    it(`reports unreadable for ${agent} when the config file is malformed`, () => {
      const files = { [configPath(agent, env())]: '{not json' }
      expect(installState(agent, env(files))).toBe('unreadable')
    })

    it(`never reports absent for ${agent} when planUninstall has work to do`, () => {
      const e = env(installed(agent))
      expect(planUninstall(agent, e).length).toBeGreaterThan(0)
      expect(installState(agent, e)).not.toBe('absent')
    })

    it(`reports unreadable, not absent, for ${agent} when the file is malformed and planUninstall is empty`, () => {
      // The exempt corner of the presence invariant: a malformed file has no
      // uninstall work either, but reporting it as absent would offer an
      // Install that planInstall silently refuses to perform.
      const files = { [configPath(agent, env())]: '{not json' }
      const e = env(files)
      expect(planUninstall(agent, e)).toEqual([])
      expect(installState(agent, e)).toBe('unreadable')
    })
  }

  it('reports absent for claude when only foreign hooks are present', () => {
    const before = JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: '/other/tool' }] }] },
    })
    expect(installState('claude', env({ '/home/me/.claude/settings.json': before }))).toBe('absent')
  })

  // Presence must key on our marker, not on "the cleaning pass would change
  // something": each of these holds nothing of ours, so Remove has no work and
  // the row must not offer one.
  const foreignOnlyClaude: Record<string, unknown> = {
    'a foreign group with an empty hooks array': { hooks: { Stop: [{ matcher: '*', hooks: [] }] } },
    'a foreign group that is not a record': { hooks: { Stop: ['nonsense'] } },
    'a foreign group whose hooks is not an array': { hooks: { Stop: [{ matcher: '*', hooks: 'oops' }] } },
    'an event whose value is not an array': { hooks: { Stop: { matcher: '*' } } },
  }

  for (const [label, doc] of Object.entries(foreignOnlyClaude)) {
    it(`reports absent for claude given ${label}, with no uninstall work`, () => {
      const e = env({ '/home/me/.claude/settings.json': JSON.stringify(doc) })
      expect(planUninstall('claude', e)).toEqual([])
      expect(installState('claude', e)).toBe('absent')
    })
  }

  it('reports stale for a codex install left in the old named-hook shape', () => {
    // The shape every dasbo release before this one wrote. Codex parses it and
    // never fires it, so calling it installed would grey out Update — the one
    // action that replaces it with the event-keyed shape that does fire.
    const before = JSON.stringify({
      hooks: { 'dasbo-island': { command: '/h/dasbo-hook codex notify', events: ['session.start'] } },
    })
    expect(installState('codex', env({ '/home/me/.codex/hooks.json': before }))).toBe('stale')
  })

  it('reports absent for codex when only a foreign entry is present', () => {
    const before = JSON.stringify({
      hooks: { 'vibe-island': { command: 'python3 /x/y.py', events: ['session.start'] } },
    })
    expect(installState('codex', env({ '/home/me/.codex/hooks.json': before }))).toBe('absent')
  })

  it('stays installed for claude when a foreign hook is appended after ours', () => {
    // planInstall would reorder ours to the end, so a text comparison would
    // call this stale. The command set is unchanged, so it is not.
    const doc = JSON.parse(planInstall('claude', env())[0]!.content)
    doc.hooks.Stop.push({ hooks: [{ type: 'command', command: '/other/tool' }] })
    const files = { '/home/me/.claude/settings.json': JSON.stringify(doc) }
    expect(installState('claude', env(files))).toBe('installed')
  })

  it('stays installed for claude across reformatting and key reordering', () => {
    const doc = JSON.parse(planInstall('claude', env())[0]!.content)
    const files = { '/home/me/.claude/settings.json': JSON.stringify({ model: 'opus', ...doc }, null, 4) }
    expect(installState('claude', env(files))).toBe('installed')
  })

  it('reports stale for claude when one of the seven events lost its hook', () => {
    const doc = JSON.parse(planInstall('claude', env())[0]!.content)
    delete doc.hooks.Stop
    const files = { '/home/me/.claude/settings.json': JSON.stringify(doc) }
    expect(installState('claude', env(files))).toBe('stale')
  })

  it('reports stale for claude when our hook is duplicated by a hand edit', () => {
    const doc = JSON.parse(planInstall('claude', env())[0]!.content)
    doc.hooks.Stop.push(doc.hooks.Stop[0])
    const files = { '/home/me/.claude/settings.json': JSON.stringify(doc) }
    expect(installState('claude', env(files))).toBe('stale')
  })

  it('reports stale for codex when one of the six events lost its hook', () => {
    const doc = JSON.parse(planInstall('codex', env())[0]!.content)
    delete doc.hooks.Stop
    const files = { '/home/me/.codex/hooks.json': JSON.stringify(doc) }
    expect(installState('codex', env(files))).toBe('stale')
  })

  it('reports stale for codex when the old named entry survives beside the new ones', () => {
    const doc = JSON.parse(planInstall('codex', env())[0]!.content)
    doc.hooks['dasbo-island'] = { command: '/h/dasbo-hook codex notify', events: ['session.start'] }
    const files = { '/home/me/.codex/hooks.json': JSON.stringify(doc) }
    expect(installState('codex', env(files))).toBe('stale')
  })

  it('stays installed for codex when a foreign hook is appended after ours', () => {
    const doc = JSON.parse(planInstall('codex', env())[0]!.content)
    doc.hooks.Stop.push({ hooks: [{ type: 'command', command: '/other/tool' }] })
    const files = { '/home/me/.codex/hooks.json': JSON.stringify(doc) }
    expect(installState('codex', env(files))).toBe('installed')
  })

  it('reports stale for antigravity when our key is present but empty', () => {
    const files = { '/home/me/.gemini/config/hooks.json': JSON.stringify({ 'dasbo-island': {} }) }
    expect(installState('antigravity', env(files))).toBe('stale')
  })

  it('stays installed for antigravity when the keys of our key are reordered', () => {
    const doc = JSON.parse(planInstall('antigravity', env())[0]!.content)
    doc['dasbo-island'] = Object.fromEntries(Object.entries(doc['dasbo-island']).reverse())
    const files = { '/home/me/.gemini/config/hooks.json': JSON.stringify(doc) }
    expect(installState('antigravity', env(files))).toBe('installed')
  })

  it('reports stale for antigravity when our commands sit under the wrong events', () => {
    // Same two commands, same multiset — but swapped onto each other's event,
    // so PreToolUse now fires the PostToolUse-labelled command and vice versa.
    // Every command encodes its own event name, so this is a broken install
    // that a bare command-set comparison would miss.
    const doc = JSON.parse(planInstall('antigravity', env())[0]!.content)
    const set = doc['dasbo-island']
    const preCommand = set.PreToolUse[0].hooks[0].command
    set.PreToolUse[0].hooks[0].command = set.PostToolUse[0].hooks[0].command
    set.PostToolUse[0].hooks[0].command = preCommand
    const files = { '/home/me/.gemini/config/hooks.json': JSON.stringify(doc) }
    expect(installState('antigravity', env(files))).toBe('stale')
  })

  it('reports stale for claude when our commands sit under the wrong events', () => {
    // Same swap as antigravity, between two of the seven Claude events.
    const doc = JSON.parse(planInstall('claude', env())[0]!.content)
    const preCommand = doc.hooks.PreToolUse[0].hooks[0].command
    doc.hooks.PreToolUse[0].hooks[0].command = doc.hooks.PostToolUse[0].hooks[0].command
    doc.hooks.PostToolUse[0].hooks[0].command = preCommand
    const files = { '/home/me/.claude/settings.json': JSON.stringify(doc) }
    expect(installState('claude', env(files))).toBe('stale')
  })

  it('reports stale for antigravity when one of our command entries is duplicated', () => {
    const doc = JSON.parse(planInstall('antigravity', env())[0]!.content)
    doc['dasbo-island'].Stop.push(doc['dasbo-island'].Stop[0])
    const files = { '/home/me/.gemini/config/hooks.json': JSON.stringify(doc) }
    expect(installState('antigravity', env(files))).toBe('stale')
  })
})
