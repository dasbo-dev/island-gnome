import type { Session } from './types.js'

/**
 * Reading Claude's session transcript for the one thing its hooks never say.
 *
 * A turn the user interrupts — Esc, or Ctrl+C — fires **no hook at all**.
 * Captured against Claude Code 2.1.220 by driving a real session in a pty and
 * interrupting it twice, once mid-`Bash` and once mid-thought: `SessionStart`,
 * `UserPromptSubmit` and (for the tool run) `PreToolUse` arrive, and then
 * nothing. No `Stop`, no `StopFailure`, no `PostToolUse`. The binary's own
 * hook list has no interrupt or cancel event in it, and the `idle_prompt`
 * `Notification` that might have stood in for one is gated on the user having
 * been idle *since the last message* — pressing Esc is activity, so it is
 * suppressed exactly when it would be useful. See docs/agent-dialects.md.
 *
 * What Claude does write, immediately, is a line in the session transcript:
 * a `user` entry whose text is `[Request interrupted by user…]`, stamped with
 * the id of the API message Esc cancelled. That line is the only evidence the
 * interrupt ever happened, so the shell tails the transcript of a running
 * Claude session and settles the row when it appears.
 *
 * This module is the pure half: which sessions are worth tailing, and what a
 * chunk of appended transcript means. The Gio machinery is in
 * src/shell/transcriptWatcher.ts.
 */

/**
 * The text Claude puts on the marker line. Matched as a prefix, exactly as
 * Claude's own reader matches it (`/^…\[Request interrupted by user[^\]]*\]/`),
 * because the tail varies: `[Request interrupted by user]` for a turn stopped
 * mid-thought, `[Request interrupted by user for tool use]` for one stopped
 * during a tool call.
 */
const MARKER = '[Request interrupted by user'

/**
 * Longest incomplete line kept between two reads. A transcript line is one
 * JSON object and an assistant turn can be a long one, so this is generous;
 * it exists only so a file that never delivers another newline — a truncation,
 * a fifo, a peer feeding us something that is not a transcript — cannot grow
 * the buffer without bound. Dropping an over-long remainder costs at most the
 * line it was part of: the marker line is a couple of hundred bytes, and the
 * next newline resynchronises the scan.
 */
export const MAX_PARTIAL_LINE = 1024 * 1024

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Whether one transcript line is Claude's interrupt marker.
 *
 * Two independent tells, either of which is enough:
 *
 * - `interruptedMessageId`, which Claude's own schema documents as being for
 *   "[Request interrupted by user] markers only". It is the narrower signal and
 *   the one that survives a rewording of the text.
 * - a `text` block whose text starts with the marker, for a marker line that
 *   carries no id.
 *
 * The text tell is deliberately not applied to a plain-string `content`, which
 * is the shape a *typed prompt* takes: asking Claude about the words
 * "[Request interrupted by user]" would otherwise settle the row that is busy
 * answering. A pasted multi-block prompt beginning with those exact words would
 * still fool it, as it fools Claude's own reader; the cost is one row reading
 * idle while it thinks, which the next event corrects.
 */
function isInterruptLine(line: string): boolean {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    // Half-written, or not a transcript at all. Either way, not our marker.
    return false
  }
  if (!isRecord(raw)) return false
  if (raw['type'] !== 'user') return false
  if (typeof raw['interruptedMessageId'] === 'string' && raw['interruptedMessageId']) return true

  const message = raw['message']
  if (!isRecord(message)) return false
  const content = message['content']
  if (!Array.isArray(content)) return false
  return content.some(
    (block) =>
      isRecord(block) &&
      block['type'] === 'text' &&
      typeof block['text'] === 'string' &&
      block['text'].startsWith(MARKER)
  )
}

/**
 * Scan appended transcript text for an interrupt.
 *
 * `rest` is whatever followed the last newline — the caller prepends it to the
 * next chunk rather than advancing past it, so a marker line split across two
 * reads is still recognised. It comes back empty when the chunk ends on a
 * newline, and empty again once it has outgrown MAX_PARTIAL_LINE.
 */
export function scanTranscript(chunk: string): { interrupted: boolean; rest: string } {
  const lines = chunk.split('\n')
  const rest = lines.pop() ?? ''
  const interrupted = lines.some((line) => line !== '' && isInterruptLine(line))
  return { interrupted, rest: rest.length > MAX_PARTIAL_LINE ? '' : rest }
}

/**
 * Whether this session's transcript is worth tailing.
 *
 * Only Claude: the marker line is Claude's own shape, and no other agent's
 * transcript has been read for one. Only while running, because that is the
 * only state an interrupt can rescue — and because it bounds the watching to
 * turns that are actually in flight rather than every row on screen.
 *
 * The path arrives over D-Bus from an unprivileged peer, so it is checked
 * before anything opens it: absolute, and named like the transcript it claims
 * to be. That rules out a relative path resolved against the compositor's cwd
 * and the obvious device nodes; the watcher additionally refuses anything that
 * is not a regular file, which is what actually stops a fifo from blocking the
 * compositor on a read that never returns.
 */
export function watchesTranscript(s: Session): boolean {
  if (s.agent !== 'claude') return false
  if (s.state !== 'running') return false
  const path = s.transcriptPath
  if (!path) return false
  return path.startsWith('/') && path.endsWith('.jsonl')
}
