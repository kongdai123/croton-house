# Verification audit: what the tests cover and what they miss

Read-only audit. All 16 node tests and 3 python test files were run locally and pass in a few seconds in total
(`cd web && node tools/build.mjs`, then each `node tools/test_*.mjs`; `python3 web/tools/test_package.py`,
`python3 bake/scripts/test_*.py`). There is no package.json test script, no git hook, and the only CI
(`.github/workflows/pages.yml`) runs `npm ci` + `node tools/build.mjs --min` and deploys on push to master. Nothing runs the tests.

## 1. How the tests are built (common pattern)

Almost every `test_*.mjs` bundles the real `web/src` modules with esbuild into a temp file and imports them under node. That is real
production code, not regex copies. What is faked is the platform: `document`, `localStorage`, `window.__app`, canvas 2D
contexts (a Proxy that swallows everything), `fetch`, `HDRLoader`, `WebGLRenderTarget`, and the renderer (hand-written stub objects
that record draws). Shaders are never compiled: tests check the GLSL strings with `includes`/regex. Three files extract source text
instead of importing: `test_device_robustness.mjs` (regex-slices the `outputPass.material.fragmentShader = ...` line and the
`webglcontextrestored` handler body out of `lighting.js` and `new Function`s them), `test_probe_walls.mjs` and `test_baked_shaders.mjs`/`test_refl_lamps.mjs`
(an esbuild plugin string-patches `lightmap.js` to export private functions, `.replace('return { fill, uniforms };', ...)`), and
`test_scene_rebake.mjs` (regex-reads `ORDER = [...]` out of `bake/scripts/lamp_groups.py`). These are brittle: a refactor that renames
a line breaks them silently or loudly, and they test a copy of the logic's text rather than the wired-up behaviour.

Important structural fact: no test builds the actual house. `buildHouse(house)` and `Layout.build()` are never called under node.
Tests construct individual furniture items (`decor.recessedLight()`, `cellularShade`, `outdoor.frontLamp()`) or fabricated fixtures
(6 boxes called "lamp0..5", one fake wall), and then check them against `web/data/house.json` or committed bake JSON. The two
data files the tests do read from the real repo are `web/data/house.json` and the committed `web/assets/lightmaps/**/meta.json|encoding.json`.

## 2. Per-test inventory

| Test | Real code? | Mocked | Covers | Would NOT catch |
|---|---|---|---|---|
| test_auto_exposure.mjs | real auto_exposure*, lightmap, agx via esbuild | renderer, targets, DOM | metering weights, glide, fps invariance, slot blend, capture toggles | whether the picture is actually well exposed; any real GPU readback |
| test_baked_default.mjs | real `applyLightmaps`, ui.js | fetch, HDRLoader, canvases | capability errors, tier policy, 10 atomic asset failures, disposal, bilingual UI strings | texel content; that assets exist/decode; that the UI buttons are clickable |
| test_baked_shaders.mjs | real lightmap.js shader patchers (+ private-export plugin) | GL, fixtures | 16 shader cache variants, GLSL transforms, PCSS, atomic failure | shader compilation (a syntax or uniform-count error in the GLSL passes); the 16-texture-unit limit on real hardware |
| test_device_robustness.mjs | real photo/warmup/render_targets; regex-extracted lighting.js snippets | renderer | fallbacks, budgets, bounded warmup, context-restore body | real context loss; the extracted snippets drifting from lighting.js |
| test_lighting_slots.mjs | real slot policy + `createSlotRuntime`; runs `bake/scripts/slots.py` for parity | renderer, fetch | slot discovery, sunrise-only policy, python/JS slot parity, latest-request, fade, two-slot ownership | probe-count mismatch against real baked probes (uses fixtures); only pyJS parity of config |
| test_lightmap_assets.mjs | real | fetch/bitmap | manifest, fallback, odd rows, dimensions | any actual bytes |
| test_lightmap_tiers.mjs | real `applyLightmaps` | fetch (synthetic gz), render targets | tier swaps, rapid toggles, failed-load recovery, multi-slot uniforms, context restore | quality change resetting switch state (not asserted); real texture upload |
| test_local_adapt.mjs | real | renderer | local adaptation pass ordering/uniforms | looks |
| test_probe_walls.mjs | real `probeBlocked`/`buildProbeVolume` (private-export hack) | one hand-made wall + fabricated probes | slab maths, face margin, doorway openings, 1-4 visible probes, fallback | the real house's walls: it never feeds `house.json` pieces or real probes through `buildProbeVolume`; nothing about outdoor cells or the door-leaf case |
| test_refl_lamps.mjs | real reflGLSL / attachLampReflections | GL | GLSL variants, probe selection, mismatch fallback | real probe boxes vs the plan |
| test_render_fixes.mjs | real TAA/contact | composer stub | shader bias, hooks, WebGPU fallback, AO proxy count | rendering |
| test_runtime_fixes.mjs | real Tour, Viewpoints, Interact, colliders, collectLightSwitches, createLampGroups, probeLit (stubbed player/ui/DOM) | player, ui, DOM | tour stop/restart/complete (bug 7), slot captions per slot/lang (7), sliding door collider (7), grouped switch pool/glow, mirror box margins, committed refl meta lookups | tour button wiring in the real DOM (bug 8), walking after stop with the real Player/key handler, lantern, quality-change switch reset |
| test_sampler_budget.mjs | real sampler_budget/contact/puddles | material fixtures | fragment-sampler counting, drop order, failed-link cut | the actual unit count of the production materials (see bug 9) |
| test_scene_rebake.mjs | real furniture builders, `collectLightSwitches`, `createLampGroups`, house.json | canvas ctx | 22 group names == WALL_SWITCHES, `defaultOn` per slot x group, plate on wall and clear of openings, lantern switching, sheer shading, pillow geometry | the committed bake having those 22 groups (it has 15); that each switch's target fixture exists and emits light inside the *real* built house (it builds one can per switch, not the room) |
| test_slot_progress.mjs | real slot runtime | fetch, HDR | progress and signals | |
| test_still_parts.mjs | real `stillParts`/`batchStatic` on 5 items | canvas Proxy | still parts do not move through a toggle cycle | other movable items; baked result |
| test_package.py | real `package.py` on synthetic files | none | manifest, hashes, 15 MB cap, exact copy | whether the real committed assets are complete/consistent |
| test_lamp_groups.py | real `group_of`/`room` extracted via `ast` (no Blender) | none | every member of the committed `lampgroups/encoding.json` still routes to the same group; new bath/closet/porch cans route | the committed encoding has only 15 groups, so this test sees only old members for 7 groups; it passes while the bake is stale |
| test_reflprobe_layout.py | real `reflprobe_layout` on `house.json` | none | 27 points clear of walls (fix 6), probe 9 position, boxes stop at partitions, bath boxes | the committed `refl/meta.json` is NOT checked against this layout |

Other scripts are manual tools, not tests: `web/tools/_smoke.mjs`, `tourtest.mjs`, `playtest.mjs`, `perf.mjs`, `vpaudit.mjs`, `overlap.mjs`, `pets_*`
(playwright, Mac Chrome, need a dev server on :8780, print/screenshot, no pass/fail assertions or only loose ones);
`bake/validate/{shoot,shoot_*,check.sh,metrics.py,movables.mjs,deployment.*}` (GPU node: render through Blender's two reference cameras
(garden, living), print luminance percentiles/regional stop differences, build a side-by-side sheet; no thresholds, a human reads it).
`deployment.py`/`.mjs` do assert (byte identity, texture upload round trip, size budgets) and are the only real post-bake gate.
`bake/scripts` has no QA stage at all: `bake.py` prints timing only.

### Two stale-asset findings the audit surfaced (action needed)

1. `web/assets/lightmaps/v2/lampgroups/encoding.json` holds 15 groups (no `bathB`, `hallBath`, `closet`, `livingNiche`, `kitchenCabinet`,
   `bedroomBLamps`, `bedroom3Lamps`) while `lamp_groups.py ORDER` and `WALL_SWITCHES` have 22. `test_scene_rebake` passes because it
   compares source against source.
2. `web/assets/lightmaps/sunrise/refl/meta.json` still has the pre-fix probe boxes (probe 9 at x=4.0 in the partition, probe 0 box
   running to z=33.6); the layout fix in `reflprobe_layout.py` is correct but not baked. `test_runtime_fixes` selects probes from this stale meta and passes.

Both mean "tests green, committed bake stale" is a state nothing detects. A source-vs-asset contract test fixes this class.

## 3. Last week's bugs mapped to coverage

| # | Bug | Existing test that would have caught it | Gap, and the check that would |
|---|---|---|---|
| 1 | Bath B and hall bath had no fixture; switches did nothing | Partially now: `test_scene_rebake` (WALL_SWITCHES have a backed plate, every `ORDER` name has a switch) and `test_lamp_groups.py`. They were added after the fact and check one can per switch in isolation. Nothing at the time. | Invariant on the *built* scene: per room in `house.json`, at least one emitting fixture; every plate's `lightSwitch` has >=1 target in the same room; every lamp group in the shipped encoding has >=1 matched member (`lamps.matched === members`). Needs a headless `buildHouse`+`Layout.build`. Also a bake QA check: per-group lamp layer is non-zero in its room. |
| 2 | Mirror reflection kept old lightmap after slot switch (hq.js clones) | None. `test_lightmap_tiers`/`test_lighting_slots` cover the main materials' swap, not `mirror.userData.reflection.materials`. | Invariant: after `setSlot`/tier swap, every material reachable from every mirror's reflection scene shares the same lightmap texture uuid as the live scene (walk `userData.reflection.materials`). Node-testable if `prepareMirrors` can run against a stub renderer; else a GPU smoke. Pixel check: mirror ROI vs adjacent room, per slot (render regression). |
| 3 | Door leaves lit from the room behind; open front door at noon got bands | `test_probe_walls` covers the blocking maths (and doorway openings) on a fabricated wall, so the algorithm is checked but the wiring/data is not. The outdoor-cell blending case: nothing. | Data-level invariant with the real `house.json` pieces and real `probes.bin`: for a sample of cells/points on each door leaf (both faces), none of the 4 chosen probes is on the other side of a wall, and an indoor cell never picks an outdoor probe (classify probes/cells with the room polygons). Fast, node, no WebGL (`buildProbeVolume` is pure). Render check: door-region luminance on both faces, open/closed. |
| 4 | Vertex-coloured furniture baked black; half/quarter tiers filled from neighbour charts | None (bake.py has zero QA; `deployment.py` checks bytes, not content). | Bake QA statistics per object: mean/min luminance of an object's texels vs the albedo-lit expectation; flag any object with covered texels where p99 < epsilon (pure black) or mean << sibling objects with the same room. For tiers: per-chart texel stat of half/quarter vs full (ratio inside a tolerance) and a Dilate-bleed detector (texel colour hue differs from the chart's full-res hue). All numpy on the atlases; no GPU. |
| 5 | 88 visible units had no texels (alpha>0.5 coverage test) | None. | Bake QA coverage: for every visible mesh with a lightmap UV, fraction of its UV area with alpha>0; list units with coverage < 90% (88 would be a list of names). Also a runtime invariant: every visible mesh with `lmId` has a `lightmap_uv2` entry. |
| 6 | Probe 9 inside a wall; boxes crossing partitions | Now `test_reflprobe_layout.py` (probe clearance, partition boxes). Caught nothing at the time, and does not check the committed meta (stale, see above). | Contract test: committed `refl/meta.json` equals `reflprobe_layout.points/boxes` (within eps) and passes the same invariants. Bake QA: probe HDR not mostly black/uniform. Render regression: mirror/glass rooms. |
| 7a | Stopping tour mid-flight locked walking | `test_runtime_fixes` (stop/restart/keys) — fixed with real Tour+Viewpoints, stubbed Player. | OK for logic; add a UI smoke (click Tour, click again, press W, position changes). |
| 7b | Closed sliding doors walk-through | `test_runtime_fixes` (collider add/remove in both orientations). | Real doors: iterate `getDoors()` from the built house, close each, assert the nav grid blocks the door centre. Needs headless buildHouse. |
| 7c | Quality change reset switches | None. | Node test: set 3 switches, call `setQuality`/tier swap on the lamp-group runtime, assert switch state unchanged; UI smoke does the same via clicks. |
| 7d | Tour caption wrong per slot | `test_runtime_fixes` (per slot x lang). | Covered. Extend to all STOPS, not just the backyard. |
| 7e | Lantern dark at dusk | `test_scene_rebake` (porch lantern switching, defaultOn dusk true) — after the fact. | Invariant: for each slot, every group with `defaultOn` true has non-zero lamp-layer energy in the bake and `levels[g] > 0` at reset (partly there); render check: porch region at dusk is brighter than at noon. |
| 8 | Tour button died when an edit deleted `toggle()` | None. `test_runtime_fixes` drives `Tour` directly, never the button/handler. | UI smoke: load page, click `#tour` (or equivalent), assert `tourCtl.active`; cheap, and a static check that every `onclick`/`bind` in ui.js resolves to a defined function (e.g. `eslint no-undef`, free in pre-commit). |
| 9a | Shader stools invisible on Apple GPUs (>16 texture units) | `test_sampler_budget` covers the budgeting algorithm on fixtures. | Per-material check using the real built materials: for every distinct material in the built scene, `fragmentSamplers(material) <= 16 - reserve` after all patches (lightmap, probes, reflections, contact, puddle, PCSS) under baked mode. Node, needs scene build + `onBeforeCompile` run on the real ShaderLib text (the tests already do this for single materials). GPU smoke with `MAX_TEXTURE_IMAGE_UNITS` forced to 16 via ANGLE flags: check `renderer.info.programs` have no link errors. |
| 9b | Slot switch failed on probe-count mismatch | `test_lighting_slots` (atomic failure; fixtures) | Contract: for each slot dir the committed `probes.bin` count equals the `refl/meta.json` length and `encoding.json` K/rows and matches the other slots; `refl` count == 27 == `reflprobe_layout` count == `#define REFL_COUNT`. Pure data, ms. |

Summary: of the 9 bug classes, the existing automated tests would have caught only 7a/7b-style pure-logic regressions (and several of those
tests were written after the bug). Everything that is *data* (bake output, committed assets), *wiring* (UI button, mirror clones), or *looks*
was uncovered. The recurring root causes are: (i) nothing builds the real scene headless, (ii) no consistency tests between source tables and the
committed bake, (iii) no content QA of the bake, (iv) no render regression gate, (v) nothing runs tests automatically.

## 4. Proposed verification architecture

### Tier 0. Plumbing (one day, no cost per run)
* `web/package.json` scripts: `test` (runs all `test_*.mjs` + python), `test:fast`, `test:invariants`. One runner file `web/tools/run_tests.mjs`
  that spawns each test and prints a table with times.
* Replace the private-export/regex hacks over time with explicit named exports (`probeWalls`, `buildProbeVolume`, `lightingRestore`)
  so a refactor does not silently break tests; keep `// @test-export` comments.
* Add `eslint` with `no-undef`/`no-unused-vars` for `web/src` only (catches bug 8, a deleted `toggle()` called from elsewhere). ~1 s.
* CI: run the fast tier in the existing Pages workflow before deploy, so a push to master (which deploys the public site) cannot ship a red build.

### (a) Headless scene invariants (new; node, no WebGL)
Make a `web/tools/headless.mjs` that bundles main-less modules and stubs `document`, canvas 2D (the Proxy already used in `test_still_parts`),
`navigator`, `window`, and runs `buildHouse(house.json)` + `new Layout(...).build()` + `collectLightSwitches` + `createLampGroups` with the committed
`encoding.json` and `probes.bin` (decode the real files; three runs under node). Feasibility: furniture builders and houses are plain three.js
geometry; the unknowns are `RectAreaLightUniformsLib.init()` and texture loaders (stub the loaders, canvases are already stubbed). Expected 1-3 s build.
Invariants (each a named test, all asserting against `house.json` rooms in plan space):
1. Every room has >=1 emitting fixture with a switch, and each switch plate maps to a group whose members are in that room (bug 1).
2. The shipped `encoding.json` group list equals `ORDER`; every member id exists in the built scene; `lamps.matched === total members` (bug 1, stale bake).
3. `refl/meta.json` == `reflprobe_layout` output; probe count == `probes` count == REFL_COUNT across all slots; probes outside walls; box overlap with partitions (bugs 6, 9b).
4. Real probe/wall integration: for door leaves (`getDoors()`), sample both faces and ring around each doorway; the 4 chosen probes for any indoor cell
   are in the same room polygon (or through a door opening); outdoor cells never pick indoor probes and vice versa (bug 3).
5. Sampler budget: every distinct material in the built scene, after the full patch chain, has <= 16 - reserve fragment samplers (bug 9a).
6. Interaction wiring: every door in `getDoors()` toggled closed adds a collider and blocks the nav grid; every interactive root's toggle works from a stubbed Interact; state survives a quality/tier swap and a slot swap (7b, 7c).
7. Mirrors: after slot swap every mirror's reflection materials hold the same lightmap/uniform objects as the main scene (bug 2).
8. Every STOPS entry has captions for all 4 slots x 2 languages (7d); every UI handler named in index.html/ui.js resolves (8).
Cost: author ~2-3 days (scene stubbing is the long pole); run ~5-10 s. Runs pre-commit (changed-file filter optional) and in CI.

### (b) Bake QA statistics (new `bake/validate/qa.py`; numpy/PIL, CPU, no GPU)
*Implemented (gates/qa): `bake/validate/qa.py`, limits in `qa_thresholds.json`, approved expected failures and metrics in `qa_baseline.json`, checker tested by `bake/scripts/test_qa.py`; runs in ~20 s on the shipped assets. The bullets below are the original proposal.*

Run on the cluster login/CPU node or locally on the finished `bakes/v2/<slot>` arrays + tiers, after composite and before packaging. Outputs a JSON
report and a nonzero exit on failure with named objects:
* Per object (from the UV tables): covered texel fraction (alpha>0) with a minimum; list zero-coverage visible units (bug 5).
* Per object: luminance mean/p99 vs a per-room floor; flag pure-black objects with material albedo > 0.1 (bug 4); flag NaN/inf and saturation at RGBM range.
* Tier consistency: half and quarter luminance per chart vs full (mean ratio within 10%, hue within a small delta) to catch cross-chart bleed (bug 4 orange patches).
* Lamp-layer sanity: each group's layer is non-zero only inside its room's UVs and its total energy is within a band of the previous approved bake.
* Probes: finite, non-negative, no wall-embedded probe, slot-to-slot ratio in bounds; reflection HDR mean in bounds and not black.
* Diff against the last approved QA report (store `qa_baseline.json` in the repo, a few KB): per-room mean luminance may not move more than N% without an explicit `--approve`.
Cost: authoring 2 days; run ~1-3 min per slot for 4 slots (atlases are tens of MB, CPU numpy). Run post-bake, before `deployment.py` and before commit.

### (c) Per-room render regression (GPU node)
Implemented (2026-10-18): `bake/validate/RENDER_GATE.md` (cameras from the plan, 57 frames per slot and tier, baseline
and Cycles comparisons, contact sheets, approve). The paragraphs below are the original proposal.

Reuse `bake/validate/shoot.mjs` (already refuses software rasterisers and serves the site). Add `cameras.json`: 1-2 cameras per room (about 20 rooms) x 4 slots
= ~120 frames at 960x600, plus special cameras for the previously broken spots (bath mirrors, open front door at noon, stool, porch lantern at dusk, bedroom mirror).
Three comparisons per frame:
1. Against Cycles (Blender renders from the same cameras, produced once per scene change by the cluster Blender job; cache by scene hash). Metric: per-region linear-luminance ratio in stops, a hard fail at e.g. |delta| > 0.5 stop on room regions and a black/saturated pixel fraction limit (catches black furniture, red/yellow bands as local outliers).
2. Against the last approved baseline PNGs (stored on the cluster, hashes in repo): SSIM / per-tile delta with a mask for TAA noise; fail on tiles over threshold, write a diff contact sheet.
3. Absolute sanity: no pageerror, `renderer.info.programs` no link failures, frame is not mostly black.
Scenarios per slot also toggle switches (all on / all off) in the lamp-group rooms and open/close the front door and sliders.
Cost: ~25 min to build the camera set and thresholds; run ~120 frames x 4-8 s (warm page, scene load once per slot) = 10-15 min on one GPU node, scavenger job like the bakes; Cycles references 1-2 h GPU but only when scene geometry/lights change. Never run on the Mac (memory: GPU runs lag UI; ask first). Run post-bake and before pushing a bake/lighting change; not on every commit.

### (d) UI smoke tests (Playwright; Mac Chrome or the cluster node)
Promote `_smoke.mjs`/`playtest.mjs`/`tourtest.mjs` into asserting scripts with `fast=1`: page loads with no `pageerror`/`console.error`; click tour start/stop, then press W and
assert the position changes (7a, 8); toggle every switch plate and assert the glow changes; change quality and assert switch state is preserved (7c); slot switch for
each slot and assert the loading overlay clears and `__app.baked.slotName` changes (9b); open/close each slider door and walk into it (7b); take 4 screenshots and require non-black.
Cost: ~1-2 days to harden; run 1-2 min on the Mac headless (no GPU-heavy work, `fast=1`). Memory note: click-test UI edits before reporting is already a rule; make it a command (`npm run smoke`).

### Cadence

| Gate | What runs | Time |
|---|---|---|
| pre-commit | eslint (no-undef) + changed-file fast tests; build (`tools/build.mjs`) | < 15 s |
| pre-push | all node/python tests + (a) headless invariants + asset-vs-source contracts | ~30 s |
| CI on push to master (before Pages deploy) | same as pre-push, plus `build --min` | ~1-2 min |
| post-bake (cluster) | (b) bake QA, then `deployment.py/.mjs`, then (c) render regression, then review contact sheet and `--approve` baselines | 5 min + 15 min GPU |
| lighting/shader change | (c) and (d) on a GPU node; (d) on the Mac | 15-20 min |
| manual/before release to uncle | full (c) + (d), human review of the diff sheets | as above |

### Suggested order of work
1. Plumbing and CI (cheapest, largest risk reduction: nothing runs the tests today, and master deploys the public site).
2. Source-vs-asset contract tests (stale `encoding.json` and `refl/meta.json` found; pure data; hours).
3. Headless scene build and invariants 1-8 (the main structural gap).
4. Bake QA statistics (catches bugs 4, 5 class at the source).
5. Render regression harness and baselines.
6. UI smoke hardening.
