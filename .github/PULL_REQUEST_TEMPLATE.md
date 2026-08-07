## What changed

<!-- One or two sentences. -->

## Why

<!-- The problem this solves. Link an issue if there is one. -->

## What you could not verify

<!-- Unverified is fine in this project. Unlabelled is not. If you changed a
     path no test can reach — a permission round-trip, a sound, anything that
     needs a live desktop — say so here. -->

## Checklist

- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
- [ ] `node build.mjs` succeeds
- [ ] No new `gi://` or `resource://` import under `src/core/`
- [ ] Any new runtime asset is copied in `build.mjs` and guarded by a test
- [ ] Documentation updated if behaviour changed
