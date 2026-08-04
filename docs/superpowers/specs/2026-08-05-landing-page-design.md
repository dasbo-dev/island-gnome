# Landing page for the dasbo-island release

## Goal

A single-page site that releases dasbo-island to the world. Its centrepiece is
the product itself: the pill, running live in the page, driven by the
extension's real `src/core` state machine. A visitor should understand within
seconds what the extension does, see the animation language with their own
eyes, and be one click from installing.

## Decisions made during brainstorming

- **Release path:** both channels. extensions.gnome.org (EGO) listing is the
  primary call-to-action; GitHub `git clone` + `make install` is the
  secondary, for people who want latest.
- **Hosting:** GitHub Pages from this repo, deployed by GitHub Actions. The
  site ships at `fsevenm.github.io/dasbo-island` first; a custom domain is a
  deliberate later step — when one is chosen, adding a `CNAME` file and DNS is
  the only change.
- **Hero:** live CSS/JS recreation of the pill and popup, not a screencast and
  not screenshots. The animation states are the product's signature; static
  media cannot carry them.
- **Visual direction:** dark GNOME desktop. The page looks like a GNOME
  desktop at night — Adwaita-dark palette, a top bar with the pill in it, a
  popup styled like the shell's. No island kitsch.
- **Approach:** the demo bundles the extension's actual `src/core` modules
  rather than a hand-written replica. `src/core/` is GNOME-free by enforced
  policy (no `gi://` imports, a test guards it), so it runs in a browser
  unchanged. The page can honestly say: this demo runs the extension's real
  state logic.

## Page structure

One page, top to bottom:

1. **Hero.** A fake GNOME top bar spans the top of the page with the live pill
   running inside it. Headline and one sub-line (copy drafted during
   implementation). Two CTAs: primary "Install from GNOME Extensions" linking
   to the EGO listing, secondary "GitHub". Below the bar sits the popup, open,
   showing two to three fake sessions with agent chips (Claude Code, Codex,
   Antigravity), one row with task progress (`3/10`) and its expander open —
   `✓` done, `▸` in progress, `○` to do.
2. **Five-states strip.** Five small 2×2 grids side by side, each looping one
   state — rest breathing, working chase, permission blink, error diagonal
   pair, done stagger — with a caption under each. All five are painted from
   the real `gridPose`.
3. **Features.** Inline permission approval, jump back to the terminal running
   the session, task-list progress, waiting-on-you notices, sound cues from
   the desktop's own sound theme.
4. **Supported agents.** The honest table, same substance as the README:
   fixture-verified statuses, Codex is notify-only (no permission gate),
   Antigravity's permission path is unverified.
5. **Fail-open guarantee.** Its own section: the hook helper exits 0 with
   empty stdout on every error path, so a disabled or crashed extension leaves
   agents behaving exactly as they would without it.
6. **Install.** The EGO button again, plus a copy-paste block:
   `git clone` … `make install` … `gnome-extensions enable`.
7. **Footer.** GPL-3.0-or-later, credit to open-vibe-island as the
   inspiration, GitHub link.

## Demo architecture

- `site/demo.ts` imports from `src/core`: `SessionStore`, `pillState`,
  `gridPose`, `tickIntervalMs`, and the activity/format helpers the rows need.
- A deterministic scripted timeline (~30 seconds, then loops) of `AgentEvent`
  objects is fed through `store.apply()` on timers: sessions start, prompts
  submit, tools run, one session raises a permission (the pill blinks, the
  popup shows Allow/Deny), the permission auto-resolves, one session errors,
  all finish with the green stagger, then the loop resets.
- The renderer is a small DOM layer playing the role the shell layer plays in
  the extension: it subscribes to the store, paints the pill's four blocks
  from `gridPose` alphas on a tick driven by `tickIntervalMs`, and rebuilds
  popup rows from `store.list()`.
- `prefers-reduced-motion`: the timeline does not run; the pill and the
  five-states strip render representative static poses (a fixed `phaseMs` per
  state).
- No JavaScript: the hero shows a static, styled pill and the page's content
  sections all read normally. The demo is enhancement, not structure.

## Build and deploy

- New `site/` directory: `index.html`, `site.css`, `demo.ts`.
- `build.mjs` gains a site step: esbuild bundles `site/demo.ts` for the
  browser (same toolchain already in the repo) and copies the static files to
  `dist-site/`, kept separate from the extension's `dist/`.
- A GitHub Actions workflow builds the site and deploys it to GitHub Pages on
  push to the default branch.
- Custom domain later: add `CNAME` + DNS, nothing else changes.

## Testing

- A vitest test runs the demo's scripted timeline through a real
  `SessionStore` and asserts the sequence of `pillState` values it produces —
  the demo cannot silently drift from what the page claims it shows.
- `npm run typecheck` covers `site/`.
- The existing core purity test already guards the property the demo depends
  on (`src/core` imports no `gi://`).

## Non-goals

- No framework, no static-site generator, no analytics, no webfont beyond a
  Cantarell-first system font stack, no video assets.
- No docs site — one landing page. Growth into docs is a separate project.
- No change to extension runtime code. The site consumes `src/core` read-only.
