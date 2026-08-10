import { describe, it, expect } from 'vitest'
import { installRowText, installToast, shortenHome } from '../../../src/core/install/messages.js'

const CLAUDE_PATH = '/home/ada/.claude/settings.json'
const CODEX_PATH = '/home/ada/.codex/hooks.json'
const HOME = '/home/ada'

describe('shortenHome', () => {
  it('replaces the home directory with a tilde', () => {
    expect(shortenHome(CLAUDE_PATH, HOME)).toBe('~/.claude/settings.json')
  })

  it('leaves a path outside home alone', () => {
    expect(shortenHome('/etc/dasbo.json', HOME)).toBe('/etc/dasbo.json')
  })

  it('leaves the path alone when home is empty', () => {
    expect(shortenHome(CLAUDE_PATH, '')).toBe(CLAUDE_PATH)
  })
})

describe('the agent row subtitle', () => {
  it('says hooks are installed, and nothing more for an agent that can answer', () => {
    expect(installRowText('installed', 'inline', CLAUDE_PATH)).toEqual({
      subtitle: 'Hooks installed',
      tooltip: null,
    })
  })

  it('warns that a notify-only agent will never show a permission prompt', () => {
    expect(installRowText('installed', 'notify-only', CODEX_PATH).subtitle).toBe(
      'Hooks installed · notifications only, no permission prompts'
    )
  })

  it('carries the same warning on a stale row, which is still an installed row', () => {
    const { subtitle } = installRowText('stale', 'notify-only', CODEX_PATH)
    expect(subtitle).toContain('Hooks need updating')
    expect(subtitle).toContain('notifications only, no permission prompts')
  })

  // absent and unreadable are about a file that is missing or broken. The
  // capability note would compete with the thing the user has to fix first.
  it('leaves the capability note off a row with no working file', () => {
    expect(installRowText('absent', 'notify-only', CODEX_PATH).subtitle).toBe('Not installed')
    expect(installRowText('unreadable', 'notify-only', CODEX_PATH).subtitle)
      .not.toContain('notifications only')
  })

  it('says what is wrong, why it matters and what to do when the file will not parse', () => {
    expect(installRowText('unreadable', 'inline', CLAUDE_PATH).subtitle).toBe(
      'Can’t read settings.json — it isn’t valid JSON. Fix the file, then reopen this page.'
    )
  })

  // An Adw.ActionRow subtitle ellipsizes in the middle, which is exactly where
  // the filename is. The tooltip has no such limit.
  it('puts the full path in the tooltip, and only there', () => {
    expect(installRowText('unreadable', 'inline', CLAUDE_PATH).tooltip).toBe(CLAUDE_PATH)
    expect(installRowText('installed', 'inline', CLAUDE_PATH).tooltip).toBeNull()
  })

  it('names the file the agent actually keeps its hooks in', () => {
    expect(installRowText('unreadable', 'notify-only', CODEX_PATH).subtitle).toContain('hooks.json')
  })
})

describe('the install toasts', () => {
  const base = { displayName: 'Claude Code', agent: 'claude', configPath: CLAUDE_PATH, home: HOME }

  it('reports a no-op as a state, not as a bug', () => {
    expect(installToast({ ...base, verb: 'install', outcome: 'noop' }))
      .toBe('Claude Code hooks are already up to date.')
    expect(installToast({ ...base, verb: 'remove', outcome: 'noop' }))
      .toBe('No Claude Code hooks to remove.')
  })

  it('confirms a completed install and a completed removal', () => {
    expect(installToast({ ...base, verb: 'install', outcome: 'done' }))
      .toBe('Claude Code hooks installed')
    expect(installToast({ ...base, verb: 'remove', outcome: 'done' }))
      .toBe('Claude Code hooks removed')
  })

  it('says what to check when the write fails, and never shows the exception', () => {
    expect(installToast({ ...base, verb: 'install', outcome: 'failed' }))
      .toBe('Couldn’t install Claude Code hooks — check that ~/.claude/settings.json is writable.')
  })

  // Codex will not run a newly written hook until it has been trusted, and that
  // review only happens in its own TUI. Without this the install silently
  // never fires.
  it('tells a Codex installer about the trust review, on one line, with no markup', () => {
    const toast = installToast({
      displayName: 'Codex CLI', agent: 'codex', configPath: CODEX_PATH, home: HOME,
      verb: 'install', outcome: 'done',
    })
    expect(toast).toBe('Codex CLI hooks installed — run codex once to approve them')
    expect(toast).not.toContain('`')
    expect(toast.length).toBeLessThanOrEqual(80)
  })

  it('leaves the trust note off a Codex removal and off every other agent', () => {
    expect(installToast({
      displayName: 'Codex CLI', agent: 'codex', configPath: CODEX_PATH, home: HOME,
      verb: 'remove', outcome: 'done',
    })).toBe('Codex CLI hooks removed')
    expect(installToast({ ...base, verb: 'install', outcome: 'done' })).not.toContain('approve')
  })
})
