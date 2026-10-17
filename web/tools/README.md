# web/tools

## Tests, lint and the pre-push hook

- `npm test` (in `web/`) builds the site, runs every `tools/test_*.mjs` (one node process each, in parallel), `tools/test_package.py`
  and every `bake/scripts/test_*.py`, and exits non-zero on any failure. `node tools/run_tests.mjs [--serial] [--timeout=SECONDS] [name-filter]`
  for a subset.
- `npm run lint` runs eslint (`eslint.config.mjs`) over `src` and `tools`. Errors fail; unused-variable findings are warnings.
- CI (`.github/workflows/pages.yml`) runs lint and tests on every push and pull request; the Pages deploy waits for them on master.
- `tools/pre-push.sh` runs the same lint and tests locally. It is not installed automatically; to enable it from the repository root:

      ln -sf ../../web/tools/pre-push.sh .git/hooks/pre-push

  (In a linked git worktree `.git` is a file; use `ln -sf "$(git rev-parse --show-toplevel)/web/tools/pre-push.sh" "$(git rev-parse --git-common-dir)/hooks/pre-push"`.)

Tests that need a browser or dev server (`_smoke`, `playtest`, `tourtest`, `pets_*`, ...) are manual tools and are not part of `npm test`.

## The plan model

`data/plan.json` is the one plan model of the house (spaces, walls, openings, wall pieces, outline, volumes); every
"which room", "inside the house" and "which walls" question reads it through `src/plan.js` or `bake/scripts/plan.py`.

- `node tools/build_plan.mjs` rebuilds it from `data/house.json` (the Zillow import, `parse_plan.mjs`) and the
  hand-authored `data/plan_overlay.json` (annex, closets, outdoor zones, labels, door specs, patches, probe seeds), and
  validates it; `--check` fails when plan.json is stale. Edit the overlay, never plan.json.
- `tools/test_plan.mjs`: plan.json is fresh and valid, the validator catches broken plans, and plan.js reproduces
  `golden/plan_vectors.json`, which `bake/scripts/test_plan.py` runs against plan.py
  (`UPDATE_VECTORS=1 node tools/test_plan.mjs` after a deliberate change; review the diff).
