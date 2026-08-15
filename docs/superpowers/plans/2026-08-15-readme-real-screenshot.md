# README Real Screenshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the drawn hero mockup in the README with a real screen capture of the extension running in a throwaway GNOME Shell 50 session.

**Architecture:** One scripted devkit session (per `.claude/skills/gnome-shell-extension-testing/SKILL.md`) stages three agent sessions with `tools/fake-agent.js`, the third of which blocks on a permission so the popup opens itself; the shell's own Screenshot API captures its framebuffer. The PNG is committed as `docs/assets/hero.png`, the SVG mockup and its test file are deleted, and the README's image line, alt text and caption are rewritten to describe a capture.

**Tech Stack:** distrobox (`gnome50-dev`), `gnome-shell --devkit`, gjs, D-Bus, vitest, Node 22.

**Spec:** `docs/superpowers/specs/2026-08-15-readme-real-screenshot-design.md`

> **What the run changed (2026-08-16).** The shipped frame is Shell **48**,
> nested, not Shell 50: the devkit's display path is a screencast, so every
> Shell 50 session wears a screen-sharing indicator in the top bar. The shell
> also starts in the overview, which is closed with one Escape through
> `org.gnome.Mutter.RemoteDesktop` on a connection that stays open. Both are
> written up in the spec's "What the capture run changed"; the README strings
> below already say 48.

## Global Constraints

- Work happens in the worktree `.worktrees/dis-22` on branch `dis-22-real-screenshot`. All paths below are relative to that worktree unless absolute.
- Never write dconf with the host profile. Every `dconf`/session command carries `DCONF_PROFILE=~/.config/dasbo-devkit-dconf-profile`.
- Never create a distrobox container. If `gnome50-dev` is missing, stop and ask the owner.
- Stop `gnome50-dev` at the end **only if** preflight found it `Exited`.
- Never touch host extensions or the host `user` dconf database.
- `pgrep -af devkit` before any `pkill` — another agent on this machine runs its own devkit sessions.
- Asset path is exactly `docs/assets/hero.png`. Committed PNG must be under 900 KB and at least 900×500.
- No source, schema, `metadata.json`, `site/` or `build.mjs` change. Documentation, tests and the asset only.
- The README caption must name `tools/fake-agent.js` — the rows are staged, not live agent traffic.

---

### Task 1: Capture the screenshot

**Files:**
- Create: `docs/assets/hero.png` (binary, produced by the session — not hand-written)
- Test: none. A capture has no unit test; its gate is the `SCREENSHOT-OK` log line, the size/dimension check in Step 8, and the owner's eyes in Task 4.

**Interfaces:**
- Consumes: nothing.
- Produces: `docs/assets/hero.png`, at least 900 px wide and 500 px tall, under 900 KB. Tasks 2 and 3 assert on that exact path.

- [ ] **Step 1: Preflight — record the container's state**

```bash
distrobox list
```

Write down the STATUS of `gnome50-dev` in your task notes. `Exited` means this run starts it and must stop it in Step 9. `Up` means leave it running. Missing means stop and ask the owner — do not create one.

- [ ] **Step 2: Preflight — profile, extension, schemas, helpers**

```bash
UUID=dasbo-island@ayubaswad.gmail.com
test -f ~/.config/dasbo-devkit-dconf-profile || printf 'user-db:devkit\n' > ~/.config/dasbo-devkit-dconf-profile
ls -d ~/.local/share/gnome-shell/extensions/$UUID
ls -l ~/.local/bin/devkit-run.sh ~/.local/bin/devkit-shims/bwrap ~/.local/bin/devkit-screenshot.py
distrobox-enter -n gnome50-dev -- glib-compile-schemas ~/.local/share/gnome-shell/extensions/$UUID/schemas
```

Expected: the extension directory exists and all three helpers are present and executable. If — and only if — the extension directory is missing, run `make install` from the worktree and say so in the result; that directory is shared with the owner's own desktop session.

The first `distrobox-enter` after a stopped container prints `Installing basic packages... / Firing up init system...` and can take a minute. That is startup, not a hang: give it a generous timeout.

- [ ] **Step 3: Preflight — display and bus variables**

```bash
tr '\0' '\n' < /proc/$(pgrep -u "$(id -u)" gnome-shell | head -1)/environ | grep -E '^(DISPLAY|XAUTHORITY|WAYLAND_DISPLAY)='
```

Export what that prints, plus `XDG_RUNTIME_DIR=/run/user/$(id -u)`, in the shell you launch the session from. Without `DISPLAY`/`XAUTHORITY` the session dies at `Failed to setup: Unable to open display`.

- [ ] **Step 4: Write the session's dconf**

```bash
export DCONF_PROFILE=~/.config/dasbo-devkit-dconf-profile
dconf write /org/gnome/shell/enabled-extensions "['dasbo-island@ayubaswad.gmail.com']"
dconf write /org/gnome/shell/disable-user-extensions false
dconf write /org/gnome/shell/disable-extension-version-validation true
dconf write /org/gnome/desktop/interface/color-scheme "'prefer-dark'"
```

Verify it landed in the devkit database and not the host's:

```bash
DCONF_PROFILE=~/.config/dasbo-devkit-dconf-profile dconf read /org/gnome/shell/enabled-extensions
```

Expected: `['dasbo-island@ayubaswad.gmail.com']`

- [ ] **Step 5: Stage the task list Claude's row reads**

```bash
mkdir -p ~/.claude/tasks/hero-claude
cd ~/.claude/tasks/hero-claude
printf '%s' '{"id":"1","subject":"Read the hook payload fixtures","status":"completed"}'   > 1.json
printf '%s' '{"id":"2","subject":"Port the pill to Shell 50","status":"completed"}'        > 2.json
printf '%s' '{"id":"3","subject":"Widen the version range","status":"completed"}'          > 3.json
printf '%s' '{"id":"4","subject":"Run the suite on every version","status":"in_progress"}' > 4.json
printf '%s' '{"id":"5","subject":"Update the changelog","status":"pending"}'               > 5.json
```

That is the shape `parseTaskFile` accepts (`src/core/tasks.ts`): `id`, `subject`, and a `status` of `pending`, `in_progress` or `completed`. Five files means the row should read `3/5`. This directory lives inside the owner's real `~/.claude` and **must be deleted in Step 9**.

- [ ] **Step 6: Run the session and capture**

```bash
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

Notes for whoever runs this: `cd ~/projects/dasbo-island` is deliberate — the row shows the agent's working directory, and it should read as a real project. The `perm` call runs in the background because `RequestPermission` blocks until answered; that block is what holds the popup open (`auto-open-on-permission` in `src/shell/island.ts`). The command runs for about a minute; give it a 180s timeout.

- [ ] **Step 7: Verify the capture happened**

```bash
grep -E 'SCREENSHOT-OK|Added virtual monitor' /tmp/dis22-hero.log
ls -l ~/dis22-hero.png
```

Expected: a `SCREENSHOT-OK (true, '/home/fsevenm/dis22-hero.png')` line and a file of non-trivial size.

Startup noise that is **not** failure: `org.gnome.SessionManager does not exist`, `portal is not running`, `Error registering session with GDM`, colord/rtkit/bluez warnings.

Real failures and their fixes:
- `Unable to open display` → Step 3 was skipped.
- `LoginManagerSystemd` abort → the `DBUS_SYSTEM_BUS_ADDRESS` export in Step 6 was dropped.
- No icons anywhere in the image → `~/.local/bin/devkit-shims/bwrap` missing or not executable.
- No `SCREENSHOT-OK` and no viewer → raise the `sleep 45` to 60 and rerun Step 6.

If the shell's capture path fails outright, use the host-side fallback from the skill: `xwininfo -root -tree | grep 'Mutter Development Kit'` for geometry, `import -window root /tmp/full.png`, then `convert /tmp/full.png -crop <WxH+X+Y> +repage ~/dis22-hero.png`.

- [ ] **Step 8: Place the asset and check it**

```bash
cd /home/fsevenm/projects/dasbo-island/.worktrees/dis-22
cp ~/dis22-hero.png docs/assets/hero.png
python3 -c "
import struct
b = open('docs/assets/hero.png','rb').read()
print('bytes', len(b), 'size', struct.unpack('>II', b[16:24]))
"
```

Expected: width ≥ 900, height ≥ 500, bytes < 921600. If it is over 500 KB, shrink it with whichever of these exists, then re-run the check:

```bash
command -v oxipng && oxipng -o 4 --strip safe docs/assets/hero.png
command -v pngquant && pngquant --force --skip-if-larger --output docs/assets/hero.png -- docs/assets/hero.png
```

If neither is installed, leave the file as it is — do not add a dependency for one asset.

**Open the PNG and look at it before continuing.** It must show the top bar with the pill, the popup open, three session rows, and Allow/Deny on the `hero-review` row. If the popup is closed or a row is missing, rerun Step 6 — do not proceed with a wrong picture.

- [ ] **Step 9: Tear the session down**

```bash
pgrep -af devkit
pkill -f "gnome-shell --devkit"
rm -rf "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/devkit-pw"
rm -rf ~/.claude/tasks/hero-claude
distrobox list
```

Read `pgrep -af devkit` before killing: if a devkit process belongs to another agent's run, kill only this run's shell by PID. Then, **only if Step 1 recorded `Exited`**, stop the container:

```bash
distrobox stop -Y gnome50-dev
```

Confirm the end state with `distrobox list` and note in your result which containers you started and stopped.

- [ ] **Step 10: Commit the asset**

```bash
git add docs/assets/hero.png
git commit -m "docs(assets): capture the hero in a GNOME 50 session

A throwaway devkit session with only dasbo loaded, three sessions
staged by tools/fake-agent.js, caught while a permission waits for
an answer. Replaces nothing yet; the README swap follows.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Point the README at the capture

**Files:**
- Modify: `README.md:24-26`
- Test: `test/docs/readme.test.ts:20-23` (replace the one hero test with two)

**Interfaces:**
- Consumes: `docs/assets/hero.png` from Task 1.
- Produces: a README whose only hero reference is `docs/assets/hero.png`, whose alt text contains the word "screenshot", and which contains the string `mockup` nowhere. Task 3 relies on `hero.svg` being unreferenced before it deletes the file.

- [ ] **Step 1: Write the failing tests**

In `test/docs/readme.test.ts`, replace this test:

```ts
  // The word has to be in the alt text, not merely somewhere on the page: an
  // <img>'s alt overrides the SVG's own <title>, so a caption alone leaves a
  // screen-reader user told this is a photograph of the running extension.
  it('shows the hero and admits in its alt text that it is a mockup', () => {
    expect(readme).toContain('docs/assets/hero.svg')
    expect(readme).toMatch(/!\[[^\]]*mockup/i)
  })
```

with these two:

```ts
  // The word has to be in the alt text, not merely somewhere on the page: a
  // caption is not read in place of an alt, so a screen-reader user should be
  // told this is a capture of the running extension by the same string
  // everyone else's browser falls back to.
  it('shows the hero screenshot and says so in its alt text', () => {
    expect(readme).toContain('docs/assets/hero.png')
    expect(readme).toMatch(/!\[[^\]]*(screenshot|screen capture)/i)
  })

  // The caption outliving the asset is the failure worth catching: a real
  // capture described as a drawing is as wrong as the reverse was.
  it('no longer calls the hero a drawing', () => {
    expect(readme).not.toContain('hero.svg')
    expect(readme).not.toMatch(/mockup/i)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/docs/readme.test.ts`

Expected: FAIL — `shows the hero screenshot` fails on the missing `docs/assets/hero.png` string, `no longer calls the hero a drawing` fails on `hero.svg`.

- [ ] **Step 3: Rewrite the two README lines**

In `README.md`, replace lines 24 and 26 — the image and the `<sub>` caption:

```markdown
![The Dasbo Island popup open in GNOME Shell 48: the pill in the top bar, three agent session rows, and a permission waiting on Allow or Deny](docs/assets/hero.png)

<sub>A screen capture of the extension running in GNOME Shell 48. The sessions in it were staged with <code>tools/fake-agent.js</code> rather than driven by live agents. <a href="https://dasbo-dev.github.io/island-gnome/">The live demo</a> runs the real state machine in your browser.</sub>
```

Keep the blank line between them, and leave every other line of the README alone.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/docs/readme.test.ts`

Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add README.md test/docs/readme.test.ts
git commit -m "docs(readme): lead with the screenshot, not the drawing

The alt text and caption now describe a capture of GNOME Shell 50 and
name the tool that staged its sessions. The tests swap with them: the
pair that guarded the word mockup now forbids it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Retire the mockup and guard the PNG

**Files:**
- Delete: `docs/assets/hero.svg`
- Rewrite: `test/docs/readmeAssets.test.ts`

**Interfaces:**
- Consumes: `docs/assets/hero.png` from Task 1; the README no longer referencing `hero.svg`, from Task 2.
- Produces: nothing later tasks read.

- [ ] **Step 1: Write the failing tests**

Replace the whole contents of `test/docs/readmeAssets.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// The SVG this file used to describe could be asked what it drew; a capture
// cannot. What is left are the things a committed binary can still get wrong:
// being the wrong format, being too small to read, or being large enough that
// everyone who clones the repository pays for it.
describe('the hero screenshot', () => {
  const bytes = readFileSync('docs/assets/hero.png')

  it('is a PNG, not something renamed to look like one', () => {
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  })

  // IHDR is the first chunk: an 8-byte signature, a 4-byte length and a
  // 4-byte type, then width and height as big-endian uint32.
  it('is big enough to read the popup in', () => {
    expect(bytes.readUInt32BE(16)).toBeGreaterThanOrEqual(900)
    expect(bytes.readUInt32BE(20)).toBeGreaterThanOrEqual(500)
  })

  it('stays small enough to clone without regret', () => {
    expect(bytes.byteLength).toBeLessThan(900 * 1024)
  })
})
```

- [ ] **Step 2: Run the tests to verify they pass on the new asset**

Run: `npx vitest run test/docs/readmeAssets.test.ts`

Expected: PASS — the PNG from Task 1 satisfies all three. (These tests fail loudly if Task 1 was skipped: `ENOENT` on `docs/assets/hero.png`.)

- [ ] **Step 3: Delete the mockup**

```bash
git rm docs/assets/hero.svg
grep -rn "hero.svg" --include="*.md" --include="*.ts" --include="*.html" --include="*.mjs" . --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=dist-site --exclude-dir=.git --exclude-dir=superpowers
```

Expected from the grep: no hits. `--exclude-dir=superpowers` drops `docs/superpowers/`, where old plans and audits mention the SVG as history — those are records and stay as written.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`

Expected: PASS, every file. Nothing else in the suite reads `hero.svg` — Task 2 removed the README's only reference.

- [ ] **Step 5: Commit**

```bash
git add test/docs/readmeAssets.test.ts   # the SVG's deletion is already staged by git rm
git commit -m "test(docs): guard the screenshot, drop the drawing

A capture cannot be asked which rows it drew, so the three SVG tests
go with the SVG. What replaces them is what a binary asset can still
get wrong: format, size on screen, size on disk.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Verify, show the owner, merge, clean up

**Files:**
- Modify: none. This task runs commands and merges.

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces: `main` carrying the change; no worktree, no branch.

- [ ] **Step 1: Full verification**

```bash
cd /home/fsevenm/projects/dasbo-island/.worktrees/dis-22
npm test
npm run typecheck
git status --short
```

Expected: both green, and a clean working tree. Paste the real tail of the output into your result — do not summarise it as "tests pass" without it.

- [ ] **Step 2: Show the owner the picture**

Send `docs/assets/hero.png` to the owner with `mcp__dasbo__request_user_input`, attachments `["docs/assets/hero.png"]`, asking whether the frame is right before it merges. No test can see whether the popup is in the shot.

If the owner rejects the frame, go back to Task 1 Step 6 with whatever they asked changed, and amend the asset commit rather than stacking a second one.

- [ ] **Step 3: Merge to main**

```bash
cd /home/fsevenm/projects/dasbo-island
git merge --no-ff dis-22-real-screenshot -m "Merge: replace the README mockup with a real screenshot

DIS-22. The hero is now a capture of the extension in a throwaway
GNOME Shell 50 session, popup open on a permission. The drawn SVG and
its tests are gone; the README says what the picture is and that its
sessions were staged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

- [ ] **Step 4: Confirm main is green**

```bash
npm test
```

Expected: PASS on `main`, with `docs/assets/hero.png` present and `docs/assets/hero.svg` gone.

- [ ] **Step 5: Remove the worktree and branch**

```bash
git worktree remove .worktrees/dis-22
git branch -d dis-22-real-screenshot
git worktree list
git branch
```

Expected: `git worktree list` shows only the main checkout; `git branch` no longer lists `dis-22-real-screenshot`. `git branch -d` refuses if anything is unmerged — if it does, stop and find out what, rather than reaching for `-D`.

---

## Notes for the implementer

- **The extension directory is shared with the owner's live desktop.** `~/.local/share/gnome-shell/extensions/dasbo-island@ayubaswad.gmail.com` is what their own GNOME 46 session loads. This branch changes no source, so read it, do not reinstall over it unless it is missing.
- **The devkit session is slow and that is normal.** The viewer maps at roughly 30 seconds on Shell 50; the plan sleeps 45 before touching D-Bus.
- **`fake-agent.js` keys on agent plus session id.** Reusing an id updates that row instead of adding one, which is why the three sessions have three distinct ids.
- **Nothing in this plan needs a pointer.** Every state on screen is produced over D-Bus, and the popup opens itself for the pending permission.
