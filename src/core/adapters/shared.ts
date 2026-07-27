/**
 * Small guards shared by every adapter. The "keep adapters independent"
 * rationale for duplicating these was already void before this file existed —
 * codex.ts imports detailFromToolInput from claude.ts — so there is no reason
 * to keep three copies in sync by hand.
 */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}
