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

## UI smoke tests (gate d)

`npm run smoke` (in `web/`) = `node tools/smoke/run.mjs [--headed] [--url=URL] [--only=a,b] [--list] [--gpu] [--out=DIR] [--timeout=SECONDS]`.
It builds `dist/` if missing, serves `web/` itself on an ephemeral port (`smoke/server.mjs`), opens the house in Chromium at
`?tier=mobile` (quarter atlases, music off, 960x600) and drives it through its own UI. Software WebGL2 (SwiftShader) by default,
as on a CI runner; `--gpu` uses the machine's GPU. `--url` tests an already running server (e.g. `python3 tools/serve.py`).
Tests share one page, in order (`smoke/tests.mjs`): `load` (landing, enter, baked mode, no page errors or patch warnings,
sampler audit), `tour` (button start/stop, stop mid-flight, walking works), `switches` (every wall plate moves its whole
group), `doors` (every door toggles; closed sliders block walking, open ones do not), `quality-and-slots` (manual switches
survive a quality change; each slot switch resets them to the slot's defaults), `resize` (canvas not blank right after the
resize handler), `keyboard` (T J N H ? Enter Escape), `legacy` (`?legacy` loads, toggleDusk). A failure leaves
`<out>/<test>.png` and `<out>/<test>.txt` (default `smoke-artifacts/`, git-ignored); exit code 1 if any test fails.
The browser-free parts (args, console classification, pixel and stance geometry, the server) are unit-tested by
`tools/test_smoke_helpers.mjs` in `npm test`. CI: job `smoke` in `pages.yml` (non-blocking for now).
Do not run it on a laptop you are working on: SwiftShader and real GPUs both load the machine for minutes.

Other tests that need a browser or dev server (`_smoke`, `playtest`, `tourtest`, `pets_*`, ...) are manual tools and are not part of `npm test`.

## The plan model

`data/plan.json` is the one plan model of the house (spaces, walls, openings, wall pieces, outline, volumes); every
"which room", "inside the house" and "which walls" question reads it through `src/plan.js` or `bake/scripts/plan.py`.

- `node tools/build_plan.mjs` rebuilds it from `data/house.json` (the Zillow import, `parse_plan.mjs`) and the
  hand-authored `data/plan_overlay.json` (annex, closets, outdoor zones, labels, door specs, patches, probe seeds), and
  validates it; `--check` fails when plan.json is stale. Edit the overlay, never plan.json.
- `tools/test_plan.mjs`: plan.json is fresh and valid, the validator catches broken plans, and plan.js reproduces
  `golden/plan_vectors.json`, which `bake/scripts/test_plan.py` runs against plan.py
  (`UPDATE_VECTORS=1 node tools/test_plan.mjs` after a deliberate change; review the diff).

## The composed baked shader

Every baked material (lightmapped copy or probe-lit) gets one shader generated from its feature flags
(`src/shaders/`: `features.js` bakedFeatures -> flags, `sampler_plan.js` samplerPlan -> the flags within the GPU's
fragment texture units, `compose.js` compose -> the edits of three's template, `baked_material.js` the one hook and key
per material, `*.glsl.js` the GLSL). Nothing outside `src/shaders` edits a baked material's shader.

- `tools/test_shader_golden.mjs`: the shaders of the real house per material class (`golden/README.md`, shader goldens).
- `tools/test_shader_compose.mjs`: every reachable flag set (`harness/flag_space.mjs`) through compose(): sites, includes,
  declarations, declaration order, sampler plan, keys.
- `tools/test_shader_invariants.mjs`: who may edit shader text (an allow-list with reasons), no wrapper over a baked
  material, the house's flag sets all enumerated, no recompile on a quality change, dispose restores every material.
- `tools/test_probe_regions.mjs`: the region-aware probe lookup on the shipped noon probes (a JS transcription).
- `tools/test_probe_plausible.mjs`: every probe-lit face of the real house (doors shut and open, four slots) lit as the
  shader lights it, against the bake's own order-2 probe data: no colour channel collapses (postmortem row 19); no
  probe-lit face wound against its normal beyond a known list. `REPORT=1` lists the failing objects.
- `node tools/shader_equiv.mjs [class]`: after a shader change, which classes changed text and whether each change is one
  of the documented behaviour-preserving rewrites (`harness/shader_equiv.mjs`). A review tool, not a test.
- `node tools/shader_link_test.mjs [--sample N] [--units N] [--gpu]`: links every flag set in WebGL2 (Playwright; SwiftShader
  unless `--gpu`). Starts a browser: run it on a machine meant for that, not in `npm test`.
