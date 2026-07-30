#!/usr/bin/gjs -m
// Drives the extension over D-Bus without running a real agent.
// Usage: tools/fake-agent.js session|tool|perm|ask|tasks|notify|sessionend [session-id]
// The session id defaults to fake-1. Pass distinct ids to create distinct
// sessions — the store keys on agent + session id, so reusing one id updates
// the same row instead of adding another.
//
// AGENT=claude|codex|antigravity picks which agent to impersonate; it defaults
// to claude. Only the `session` mode is written in all three dialects, which is
// enough to get one row per agent on screen — what the row's agent chip needs
// eyes on. Every other mode stays Claude-shaped: codex reads the same
// session_id/cwd keys (see KIND_BY_EVENT in src/core/adapters/codex.ts), while
// antigravity shares no key names at all.
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import System from 'system'

const BUS = 'org.dasbo.Island'
const PATH = '/org/dasbo/Island'
const IFACE = 'org.dasbo.Island'

const mode = ARGV[0] ?? 'session'
const sessionId = ARGV[1] ?? 'fake-1'
const FAKE_PID = 4242

const AGENT = GLib.getenv('AGENT') ?? 'claude'

// Session start, per dialect. Antigravity names no event in its payload (argv
// is the only source) and reports its workspace as a list, so it needs both a
// different event and a different shape.
const sessionByAgent = {
  claude: {
    event: 'SessionStart',
    payload: {
      hook_event_name: 'SessionStart', session_id: sessionId, cwd: GLib.get_current_dir(),
    },
  },
  codex: {
    // event stays 'SessionStart' — that's the D-Bus event argument, unrelated
    // to the payload shape. The payload itself uses the dotted `type` form,
    // not `hook_event_name`: CODEX_EVENTS in src/core/install/plan.ts only
    // ever installs 'session.start' and friends, so that's what a real Codex
    // install actually sends. The adapter accepts both spellings, but this
    // tool should be faithful to the real one, not just to what parses.
    event: 'SessionStart',
    payload: {
      type: 'session.start', session_id: sessionId, cwd: GLib.get_current_dir(),
    },
  },
  antigravity: {
    event: 'PreInvocation',
    payload: { conversationId: sessionId, workspacePaths: [GLib.get_current_dir()] },
  },
}

// The D-Bus side already drops an unrecognised agent id silently (see
// isAgentId in src/core/adapters/index.ts) — this check exists for the human
// running the tool, not for safety. Without it, AGENT=codx produces no row,
// no message, no clue, which is indistinguishable from a broken chip on the
// very tool someone reaches for to check the chip by hand.
if (!(AGENT in sessionByAgent)) {
  printerr(`fake-agent: unknown AGENT '${AGENT}'. Valid: ${Object.keys(sessionByAgent).join(', ')}`)
  System.exit(1)
}

const events = {
  session: 'SessionStart',
  tool: 'PreToolUse',
  perm: 'PreToolUse',
  ask: 'PreToolUse',
  tasks: 'PostToolUse',
  notify: 'Notification',
  sessionend: 'SessionEnd',
}

const payloads = {
  session: { hook_event_name: 'SessionStart', session_id: sessionId, cwd: GLib.get_current_dir() },
  tool: {
    hook_event_name: 'PreToolUse', session_id: sessionId, cwd: GLib.get_current_dir(),
    tool_name: 'Edit', tool_input: { file_path: '/tmp/main.js' },
  },
  perm: {
    hook_event_name: 'PreToolUse', session_id: sessionId, cwd: GLib.get_current_dir(),
    tool_name: 'Bash', tool_input: { command: 'rm -rf build' },
  },
  ask: {
    hook_event_name: 'PreToolUse', session_id: sessionId, cwd: GLib.get_current_dir(),
    tool_name: 'AskUserQuestion',
    tool_input: {
      questions: [
        {
          question: 'Which library should we use for date formatting?',
          header: 'Library',
          options: [
            { label: 'date-fns', description: 'tree-shakeable, function per format' },
            { label: 'Luxon', description: 'timezone-aware, heavier' },
          ],
          multiSelect: false,
        },
        {
          question: 'Which stores should the cache write through to?',
          header: 'Stores',
          options: [
            { label: 'Postgres', description: 'durable' },
            { label: 'Redis', description: 'fast' },
            { label: 'Disk', description: 'neither' },
          ],
          multiSelect: true,
        },
      ],
    },
  },
  tasks: {
    hook_event_name: 'PostToolUse', session_id: sessionId, cwd: GLib.get_current_dir(),
    tool_name: 'TaskUpdate', tool_input: { taskId: '1', status: 'completed' },
  },
  notify: {
    hook_event_name: 'Notification', session_id: sessionId, cwd: GLib.get_current_dir(),
    message: 'Claude is waiting for your input',
  },
  sessionend: { hook_event_name: 'SessionEnd', session_id: sessionId, cwd: GLib.get_current_dir() },
}

const dialect = mode === 'session' ? sessionByAgent[AGENT] : null
const EVENT = dialect?.event ?? events[mode] ?? events.session
const payload = JSON.stringify(dialect?.payload ?? payloads[mode] ?? payloads.session)
const blocking = mode === 'perm' || mode === 'ask'
const method = blocking ? 'RequestPermission' : 'Notify'
const args = new GLib.Variant('(sssis)', [AGENT, EVENT, GLib.get_current_dir(), FAKE_PID, payload])
const replyType = blocking ? new GLib.VariantType('(s)') : null

const res = Gio.DBus.session.call_sync(
  BUS, PATH, IFACE, method, args, replyType, Gio.DBusCallFlags.NONE, 2147483647, null
)
print(`${method} returned ${res ? res.print(true) : '()'}`)
