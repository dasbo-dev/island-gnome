# Replacing the README mockup with a real screenshot

**Date:** 2026-08-15
**Issue:** DIS-22
**Depends on:** `.claude/skills/gnome-shell-extension-testing/SKILL.md`
**Amended:** 2026-08-16, after the capture run — see [What the capture run
changed](#what-the-capture-run-changed). The shipped frame is Shell **48**,
nested, not 50.

## The problem

The first thing a README reader sees is `docs/assets/hero.svg`: a drawing of
the top bar pill, a popup with three session rows, and a terminal beside it.
The caption under it says so — *"A mockup, not a screen capture"* — and two
tests exist to keep that admission attached to the asset.

The honesty is not the problem. The problem is that a project whose whole claim
is "this runs in your top bar" leads with a picture of something that has never
run. The extension now loads on Shell 46 through 50 and there is a documented
way to bring up a throwaway session of any of them, so the drawing can be
replaced by a capture of the real thing.

## Decisions taken

Settled with the owner before any of this was written:

| Question | Decision |
|---|---|
| Where the capture comes from | A throwaway session brought up by this repo's testing skill, not the owner's desktop |
| What is in frame | The whole session — wallpaper, top bar, open popup. No terminal window |
| Which Shell version | 50, on `gnome50-dev`, devkit mode |
| What the popup is doing | Holding a permission that is waiting for an answer |
| The old mockup | Deleted, along with its test file |
| Colour scheme | Dark |
| How much tooling | The capture is a one-off; the recipe lives in this document, not in a script |

The rejected alternative worth recording is the capture script
(`tools/capture-hero.sh`). It would make a rerun one command, but it can only
run on a machine that has the `gnome50-dev` distrobox — never in CI — so it is
code with one user and nothing to keep it honest. The recipe below is the
script, in prose, where it cannot rot silently.

## Scope

| File | Change |
|---|---|
| `docs/assets/hero.png` | New. The capture |
| `docs/assets/hero.svg` | Deleted |
| `README.md` | Hero image line and the caption under it |
| `test/docs/readme.test.ts` | The hero test, rewritten for a screenshot |
| `test/docs/readmeAssets.test.ts` | Rewritten for the PNG |

Nothing else references the hero: the landing page runs the live demo instead,
so `site/`, `build.mjs` and the packaged extension are untouched. No source
file, schema or `metadata.json` changes.

## The capture

### Preflight

The testing skill owns this list; what follows is only what this particular run
needs from it.

1. `distrobox list` — **write down the status of `gnome50-dev` before
   anything else.** If it was `Exited`, this run started it and must stop it
   again; if it was already `Up`, leave it running. If the container is
   missing, stop and ask the owner — do not create one.
2. The dconf profile `~/.config/dasbo-devkit-dconf-profile` must exist. It
   points at `~/.config/dconf/devkit`, so nothing here can reach the host's
   `user` database.
3. The extension must be visible to the container at
   `~/.local/share/gnome-shell/extensions/dasbo-island@ayubaswad.gmail.com`.
   Containers share `$HOME`, and so does the host session: that directory is
   the copy the owner's own desktop loads. This branch changes no source, so a
   present, current install is used as it stands. Only if it is missing does
   this run `make install`, and it says so in the result.
4. Schemas compiled inside the container:
   `distrobox-enter -n gnome50-dev -- glib-compile-schemas
   ~/.local/share/gnome-shell/extensions/dasbo-island@ayubaswad.gmail.com/schemas`
5. The three helper scripts, all already installed on this machine:
   `~/.local/bin/devkit-run.sh`, `~/.local/bin/devkit-shims/bwrap`,
   `~/.local/bin/devkit-screenshot.py`.
6. `DISPLAY` and `XAUTHORITY` read off a running host `gnome-shell` process,
   plus `XDG_RUNTIME_DIR=/run/user/$(id -u)`. An agent shell has none of these
   and the session dies at `Failed to setup: Unable to open display` without
   them.
7. `gnome50-dev` has no system bus of its own, so the launch command carries
   `DBUS_SYSTEM_BUS_ADDRESS=unix:path=/run/host/run/dbus/system_bus_socket`.
   Without it the shell aborts at logind connect.

### Session settings

Written with `DCONF_PROFILE` pointed at the devkit profile, never the host's:

```sh
dconf write /org/gnome/shell/enabled-extensions "['dasbo-island@ayubaswad.gmail.com']"
dconf write /org/gnome/shell/disable-user-extensions false
dconf write /org/gnome/shell/disable-extension-version-validation true
dconf write /org/gnome/desktop/interface/color-scheme "'prefer-dark'"
```

Version validation is off because this run is about what the UI looks like, not
about what `metadata.json` declares — DIS-19 already established the load on 50
with validation on.

### Staged state

Three sessions, made with `tools/fake-agent.js` run inside the container from
`~/projects/dasbo-island`, so every row's working directory reads as a real
project rather than `/`:

| Session id | Agent | Made with | Row shows |
|---|---|---|---|
| `hero-claude` | Claude Code | `session`, then `tool` | working, task counter if the staged list is read |
| `hero-codex` | Codex CLI | `AGENT=codex session`, then `AGENT=codex tool` | working, Codex chip |
| `hero-review` | Claude Code | `session`, then `perm` | a permission waiting, Allow and Deny |

The `perm` call invokes `RequestPermission`, which blocks until the popup
answers it. That is what holds the frame still: the extension's own
`auto-open-on-permission` opens the popup (`island.ts`,
`notifyPermissionOpened`), so the popup is up with the buttons on screen and no
pointer input is needed anywhere in this procedure. The call runs in the
background of the capture script and is killed with the session.

The task counter is the one optional part. Claude's list is read from
`~/.claude/tasks/<session-id>/`, one `<id>.json` per task holding `id`,
`subject` and `status` (`pending`, `in_progress` or `completed`) — the shape
`parseTaskFile` in `src/core/tasks.ts` accepts. This run writes a small
`~/.claude/tasks/hero-claude/` directory before the session, and **deletes it
afterwards**; it is inside the owner's real `~/.claude`, so leaving it there
would show up in a future session. If the counter does not appear, the capture
proceeds without it and the result says so.

### The run

One scripted session, output to a log, everything on the session's own bus:

```sh
GDK_BACKEND=x11 DCONF_PROFILE=~/.config/dasbo-devkit-dconf-profile \
distrobox-enter -n gnome50-dev -- /bin/dbus-run-session -- sh -c '
  export DBUS_SYSTEM_BUS_ADDRESS=unix:path=/run/host/run/dbus/system_bus_socket
  ~/.local/bin/devkit-run.sh & p=$!
  sleep 45
  cd ~/projects/dasbo-island
  gjs -m tools/fake-agent.js session hero-claude
  gjs -m tools/fake-agent.js tool    hero-claude
  AGENT=codex gjs -m tools/fake-agent.js session hero-codex
  AGENT=codex gjs -m tools/fake-agent.js tool    hero-codex
  gjs -m tools/fake-agent.js session hero-review
  gjs -m tools/fake-agent.js perm    hero-review &
  sleep 4
  python3 ~/.local/bin/devkit-screenshot.py "$HOME/dis22-hero.png"
  kill $p' > /tmp/dis22-hero.log 2>&1
```

The 45 seconds is the devkit viewer mapping on Shell 50; capturing before the
virtual monitor exists is where the stage has no size. `SCREENSHOT-OK` in the
log is the success line. The PNG lands in the shared `$HOME` and is copied into
the worktree as `docs/assets/hero.png`.

If the shell's own capture path fails, the fallback is the host-side X route in
the skill (`xwininfo` for the viewer's geometry, then `import` and a crop). It
is a fallback, not a preference: it photographs the viewer window rather than
the shell's framebuffer.

### Afterwards

In this order, whatever the outcome: kill the shell
(`pkill -f "gnome-shell --devkit"`), remove `$XDG_RUNTIME_DIR/devkit-pw`,
delete `~/.claude/tasks/hero-claude/`, and stop `gnome50-dev` only if preflight
found it `Exited`. `pgrep -af devkit` first — another agent on this machine
runs its own devkit sessions, and a blind `pkill` would take theirs down too.

### The file

The capture is committed as it comes out, at whatever size the devkit chose.
If it exceeds 500 KB it goes through `oxipng` or `pngquant`, whichever is
installed; if neither is, it is committed uncompressed rather than adding a
dependency for one asset. The test below caps it at 900 KB regardless.

## README

Two lines change. The image:

```markdown
![The Dasbo Island popup open in GNOME Shell 50: the pill in the top bar, three
agent session rows, and a permission waiting on Allow or Deny](docs/assets/hero.png)
```

And the caption under it, which stops apologising for being a drawing and
instead says what the picture is and what it is not:

```markdown
<sub>A screen capture of the extension running in GNOME Shell 50. The sessions
in it were staged with <code>tools/fake-agent.js</code> rather than driven by
live agents. <a href="https://dasbo-dev.github.io/island-gnome/">The live
demo</a> runs the real state machine in your browser.</sub>
```

The staging note is not modesty for its own sake. This repository's habit is to
say what it has not proven — the whole "Status and known limitations" section is
that habit — and these three rows are not real agent traffic. The alt text
carries the important half, because an `<img>`'s alt overrides the SVG title
the old asset used to supply, and a screen-reader user should get the same
description as everyone else.

## Tests

`test/docs/readme.test.ts` — the hero test becomes two:

```ts
it('shows the hero screenshot and says so in its alt text', () => {
  expect(readme).toContain('docs/assets/hero.png')
  expect(readme).toMatch(/!\[[^\]]*(screenshot|screen capture)/i)
})

// The caption outliving the asset is the failure worth catching: a real
// capture described as a drawing is as wrong as the reverse.
it('no longer calls the hero a drawing', () => {
  expect(readme).not.toContain('hero.svg')
  expect(readme).not.toMatch(/mockup/i)
})
```

`test/docs/readmeAssets.test.ts` — rewritten whole. The three SVG tests
(agent rows drawn, `<title>` says mockup, no `src/icons` reference) go with the
SVG; a capture cannot be asked what it drew. What replaces them checks the
things a committed binary asset can actually get wrong:

```ts
describe('the hero screenshot', () => {
  const bytes = readFileSync('docs/assets/hero.png')

  it('is a PNG, not something renamed to look like one', () => {
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  })

  // IHDR is the first chunk: 8-byte signature, 4-byte length, 4-byte type,
  // then width and height as big-endian uint32.
  it('is big enough to read the popup in', () => {
    expect(bytes.readUInt32BE(16)).toBeGreaterThanOrEqual(900)
    expect(bytes.readUInt32BE(20)).toBeGreaterThanOrEqual(500)
  })

  it('stays small enough to clone without regret', () => {
    expect(bytes.byteLength).toBeLessThan(900 * 1024)
  })
})
```

## Verification

- `npm test` green, `npm run typecheck` green.
- The log line `SCREENSHOT-OK` from the capture run.
- The PNG sent to the owner to look at before anything merges. No test can see
  whether the popup is in the frame; a person has to.

## Risks

- **The capture comes out wrong** — popup closed, viewer never mapped, icons
  missing. Each has a known cause in the skill's failure list (timing, portal
  probes, the `bwrap` shim). The run is cheap to repeat; the fix is a longer
  sleep or the fallback route, not a change to this design.
- **The staged rows read as a claim.** Mitigated by the caption naming
  `tools/fake-agent.js`, which is also the thing that makes the picture
  reproducible.
- **The shared extension directory.** The throwaway session loads the same
  installed copy the owner's desktop does. This branch changes no source, so
  nothing about the host session's extension changes; a reinstall would only
  happen if the directory were missing, and the host would not see it until a
  shell reload anyway.

## What the capture run changed

Four things the design did not foresee. All were settled during the run on
2026-08-16; the sections above are left as written, and this section is what
actually happened.

**The shell starts in the overview, and nothing above closes it.** A devkit or
nested session with no windows comes up on the overview — search box, empty
workspace previews, app-grid button — with the pill and popup drawn over it.
That is not a hero. `org.gnome.Shell.Eval` cannot fix it (it answers
`(false, '')`; unsafe mode is off and Shell 50 has no flag for it), and no app
worth putting in frame exists in either container. What works is one Escape
through `org.gnome.Mutter.RemoteDesktop`: `CreateSession`, `Start`,
`NotifyKeyboardKeysym(0xff1b)` down and up. It has to happen on a connection
that stays open — mutter destroys the session the moment the creating
connection goes away, so a `gdbus call` per step loses it between the create
and the keypress. The session is then `Stop`ped, because an open one puts a
screen-sharing indicator in the top bar.

**The frame is Shell 48, nested, not Shell 50.** The devkit's entire display
path *is* a screencast, so Shell 50 wears that orange screen-sharing indicator
in every session, `Stop` or no `Stop` — in a README hero it reads as "this is a
recording". Nested sessions have no such stream and come out clean. 48 is
inside the range the README claims, and the two frames are otherwise identical
pixel for pixel in the popup. The owner picked 50 before the indicator was
known and was asked to choose again with both images in hand; the request timed
out with no answer, so this run took the recommendation it had already given.
Swapping to the 50 frame later is one capture and one commit.

**The background is the old mockup's gradient.** Neither container ships a
wallpaper, and the shell's fallback is a flat saturated blue. The devkit dconf
now sets `picture-uri` empty and a vertical shade from `#2b2440` to `#14131a` —
the exact two stops the deleted `hero.svg` used, so the hero keeps its palette
while becoming real.

**The hero had a second consumer.** "Nothing else references the hero" was
wrong: `tools/og-image.html`, the hand-run source for `site/og-image.png`,
embedded `hero.svg` at 860 px wide. Deleting the SVG would have left a tool
pointing at nothing, discovered by whoever next re-rendered the social card. It
now embeds `hero.png`, cropped in CSS to its top 300 px — the capture's lower
half is empty desktop, and shown whole the popup shrinks past legibility at
thumbnail size. `site/og-image.png` was re-rendered with the command in
`docs/superpowers/plans/2026-08-10-landing-page-copy.md`, so the card shows the
capture rather than a drawing that no longer exists. The committed `hero.png`
itself is uncropped, as the owner chose.

**The staging is one Python script, not a shell sequence.** Because the Escape
needs a persistent connection, the same script sends it, runs the six
`fake-agent` calls, and takes the screenshot. It lived at
`~/dis22-stage-shot.py` for the run and is not committed — the design's decision
to keep capture tooling out of the repository stands, and the whole sequence is
written out in the plan.

## Not in this issue

The landing page's own imagery, an `og-image` refresh, a screenshot of the
preferences window, and any capture on Shell 46-49. If the hero should be
regenerated per release, that is the capture script this design turned down,
and it deserves its own issue.
