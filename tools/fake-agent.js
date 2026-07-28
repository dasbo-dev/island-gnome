#!/usr/bin/gjs -m
// Drives the extension over D-Bus without running a real agent.
// Usage: tools/fake-agent.js session|tool|perm [session-id]
// The session id defaults to fake-1. Pass distinct ids to create distinct
// sessions — the store keys on agent + session id, so reusing one id updates
// the same row instead of adding another.
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

const BUS = 'org.dasbo.Island'
const PATH = '/org/dasbo/Island'
const IFACE = 'org.dasbo.Island'

const mode = ARGV[0] ?? 'session'
const sessionId = ARGV[1] ?? 'fake-1'
const FAKE_PID = 4242

const events = {
  session: 'SessionStart',
  tool: 'PreToolUse',
  perm: 'PreToolUse',
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
}

const EVENT = events[mode] ?? events.session
const payload = JSON.stringify(payloads[mode] ?? payloads.session)
const method = mode === 'perm' ? 'RequestPermission' : 'Notify'
const args = new GLib.Variant('(sssis)', ['claude', EVENT, GLib.get_current_dir(), FAKE_PID, payload])
const replyType = mode === 'perm' ? new GLib.VariantType('(s)') : null

const res = Gio.DBus.session.call_sync(
  BUS, PATH, IFACE, method, args, replyType, Gio.DBusCallFlags.NONE, 2147483647, null
)
print(`${method} returned ${res ? res.print(true) : '()'}`)
