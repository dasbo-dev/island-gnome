# Fix the GitHub Pages deployment failure

Date: 2026-08-11
Status: approved

## The problem

Every run of the `site` workflow fails at the final step:

```
Error: Failed to create deployment (status: 404) with build version 8121dde5...
Ensure GitHub Pages has been enabled: https://github.com/dasbo-dev/island-gnome/settings/pages
```

The build half of the workflow works. It installs, tests, typechecks, runs
`build.mjs`, and uploads a `github-pages` artifact — the log confirms the
artifact exists (`Found 1 artifact(s)`). Only the deploy half fails.

## Root cause

GitHub Pages was never enabled on the repository. Querying the Pages API
directly confirms it:

```
$ gh api repos/dasbo-dev/island-gnome/pages
{"message":"Not Found","status":"404"}
```

`actions/deploy-pages` asks GitHub to create a deployment against a Pages site.
No site exists, so the API answers 404 and the action surfaces that as a failed
deployment. Nothing in `site.yml` is wrong: permissions (`pages: write`,
`id-token: write`), the `github-pages` environment, the `pages` concurrency
group, and the artifact path are all correct.

The `Node 20 is being deprecated` line in the same log is unrelated. It is a
runner-level warning about the Node version bundled with `actions/checkout@v4`
and `actions/setup-node@v4`. It does not fail anything today.

## The fix

Two parts. The first unblocks the deploy; the second stops it from happening
again.

### 1. Enable Pages on the repository (operator action)

In **Settings → Pages → Build and deployment**, set **Source** to
**GitHub Actions**. This is a repository setting, not something a commit can
change. Until it is done, the workflow keeps failing the same way.

### 2. Add a `configure-pages` step to the workflow

Add to the `build` job of `.github/workflows/site.yml`, before the artifact
upload:

```yaml
      - uses: actions/configure-pages@v5
        with:
          enablement: true
```

This is the ordering GitHub's own Pages starter workflow uses. The step needs
`pages: write` and `id-token: write`, both already declared at the workflow
level and inherited by every job.

With `enablement: true` the step asks GitHub to create the Pages site if it is
missing. Once the setting from part 1 is in place the step is a no-op, so the
two parts do not conflict. Its real value is durability: a fork or a fresh
clone of this repository gets a working deploy without anyone remembering the
Settings page, and the requirement is now recorded in the workflow rather than
in tribal knowledge.

The step also exports `base_url` and `origin` outputs. Nothing consumes them
today and this design does not add a consumer.

If the organisation forbids `GITHUB_TOKEN` from administering Pages, this step
fails with a 403 naming that restriction, instead of the current 404 at deploy
time that points at the wrong thing. Louder and earlier is the better failure.

### 3. Bump the runner actions to v5

`actions/checkout` and `actions/setup-node` move from `@v4` to `@v5` in both
`.github/workflows/site.yml` and `.github/workflows/ci.yml`. v5 runs on Node
24, which clears the deprecation warning quoted above.

This is unrelated to the deploy failure and is included deliberately, at the
operator's request, because both files were already being touched. The
`node-version: 22` input is unchanged — that is the Node the project builds
with, and it is independent of the Node the action itself runs on.

## What is not changing

- `build.mjs`, `dist-site`, and the artifact path. The build was never broken.
- The `pages` concurrency group and `cancel-in-progress: false`. Both are
  correct and their comments explain why.
- The `github-pages` environment block on the `deploy` job.

## Verification

No test suite covers workflow YAML, and none is added here — a test that
asserts the file contains a string it was just written to contain proves
nothing.

Verification is instead:

1. The workflow file parses as YAML.
2. `npm test`, `npm run typecheck`, and `node build.mjs` still pass, confirming
   the commit did not disturb the build the workflow depends on.
3. The real proof: after the operator enables Pages, the next `site` run
   reaches `deploy` and publishes. This cannot be verified locally — it needs
   GitHub's API and a live runner.
