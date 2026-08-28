/**
 * The extension's only console call site.
 *
 * Every message this extension logs is an error path — a teardown step that
 * threw, an asset that would not resolve, a payload that would not parse — so
 * nothing here is gated behind a debug flag; there is no chatter to gate.
 * What the single seam buys is the count. `build.mjs` bundles all of `src/`
 * into one `extension.js`, and EGO's "no excessive logging" rule (shexli
 * EGO-A-004) counts ungated console calls per file against a threshold of
 * five. Seventeen scattered calls read as an extension that talks constantly;
 * one function that seventeen callers share reads as what it is.
 *
 * The `dasbo-island: ` prefix lives here rather than at each call site, so a
 * `journalctl` filter keeps working no matter which module raised the line.
 *
 * See docs/superpowers/specs/2026-08-28-shexli-static-analysis-design.md.
 */
export function warn(message: string): void {
  console.warn(`dasbo-island: ${message}`)
}
