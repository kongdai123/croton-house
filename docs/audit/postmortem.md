# Postmortem: the baked-lighting bugs of October 2026

Every bug below was found by walking the site, most of them by the owner, after it had been "fixed and verified".
Each row gives the root cause and the class it belongs to; the classes, not the rows, are what the refactor fixes.

| # | Symptom | Root cause | Class |
|---|---|---|---|
| 1 | Bath B and the hall bath dark; their switches did nothing | No fixture placed; lamp_groups.py folded both baths into neighbouring groups by hand | A: roles decided by hand per object/room, nothing checks every room is lit and switched |
| 2 | Bath mirror bright white in a dim room | Door leaf lit by probe cells across the wall (0.3 m sided lookup blended the sunlit bedroom) | C: probe grid ignores walls |
| 3 | Mirror walls black after a time-of-day switch | hq.js mirror clones kept the old lightmap; slot switch only updated originals | D: state copied into derived objects without one owner |
| 4 | Door bevels glowing after the side offset fix | Bevel normals look along the doorway; fix patched the offset instead of the sampling | C, and E: fix applied at the symptom |
| 5 | Open front door at noon streaked black, red and yellow | Lookups beside an exterior wall blended outdoor cells (100x brighter); the viewer-biased offset from #4 moved lookups further | C, E |
| 6 | Walnut shelf orange; dark wood furniture near black | bake.py joined meshes and dropped the default colour attribute, so vertex-coloured albedo read 0 and baked black; tiers and mips then filled the black texels from neighbouring charts | F: pipeline steps with no output statistics |
| 7 | 88 visible pieces with no baked light | Alpha-blended materials bake alpha = opacity; coverage test `alpha > 0.5` discarded them | F |
| 8 | Static parts of animated objects probe-lit | Whole animated/toggled subtrees excluded from the bake | A |
| 9 | Reflection probe inside a wall; bedroom mirror showing the bath | Probe points from a grid, boxes not clipped to rooms, 25 cm selection margin crossing partitions | B: spatial data hand-made per consumer |
| 10 | Mirrors show lamps that are off; golden hour reflects every lamp at 70% | Probes rendered with every lamp at the slot level; runtime only blends slots | D |
| 11 | One switch dims the whole room | Groups baked per room, switches per fixture, levels summed by weight | A |
| 12 | Stopping the tour mid-flight locks walking | Flight with keepDriven outlived the tour | G: UI state machines without tests |
| 13 | Closed sliders walk-through | Collider only for the fixed half | G |
| 14 | Quality change resets switches | Reload path reused the slot-change path | G |
| 15 | Tour button dead | An edit deleted toggle() | G, and H: edits reported without a smoke test |
| 16 | Stool legs invisible on Apple GPUs | Shader over 16 texture units; patches stacked samplers | I: shader built by stacked string patches |
| 17 | Slot switch failed | Reflection layout differed between slots (26 vs 27 probes) | B |
| 18 | Lantern dark at dusk | Lightmapped copies driven by a startup value, original by onTime | D |
| 19 | Closed front door's inside face dark with reddish vertical bands at noon (the streaks of row 5 before region-aware sampling) | Probe light evaluated as plain L1 SH, max(0, L0 + L1·n) per colour, which goes negative opposite a strong source. The probes just inside the door (baked with it open) are dominated by the sunlit porch: \|L1\| ≈ 1.1 L0, so for the room-facing leaf -0.09 / -0.12 / -0.18, clamped black, blue (sky) first, red left over, banded by probe column. 120 probe-lit objects collapse this way (details below) | J: a light reconstruction that is not positive by construction, with no check against the bake's own data |
| 20 | Site stuck on the loading screen forever (UI smoke run on a GPU node): `window.__ready` never true | The WebGL context was lost and restored during startup. `lighting.syncPet` read `roomFor(dusk).texture` and `sky.target.texture` as if both always existed; `roomFor` is null on the no-HDR path and for anything built on a lost context (`composerConfig` reads no float buffers, so `renderConfig.hdr` stayed false for good), and `loadSky` stored whatever PMREM returned on a lost context. The TypeError left `Pets.relight`, through `applyTime`, through main.js's top-level `await`s, so the start aborted; nothing in the start was allowed to fail (a thrown relight, puddles or contact setup was as fatal as the sky) | K: GPU-built state that is neither valid nor explicitly pending after a context loss, and a start in which every step is fatal |
| 21 | Light probe 668 (plan 7.65, -5.85, h 0.35) baked and shipped valid inside bedroom 3's south wall (bake QA probes-walls) | The indoor grid's first row runs on the outline's south face, 0.3 mm inside the wall; validity was only probe.py's six-ray back-face count, and from inside the merged wall cell the rays saw one back face (the -y ray hit the skin's front face 0.3 mm away, the ±x rays the cell's internal faces). Nothing compared the grid with the plan | B, F: a validity test from the scene alone; fix: probe_grid.py flags every point in a plan wall piece or the exterior skin solid (never rendered), test_probe_grid.py |
| 22 | Reflection probe 4 (kitchen) 81% black in every slot (bake QA refl-black) | The layout cleared the plan's walls only; the grid point (-2.8, 0) stood 9 cm inside the microwave & pantry tower. reflprobe.py checked the scene only outside the plan | B: placement checked against one source only; fix: a plan seed moves it, reflprobe.py stops the layout on any in-plan probe inside or against furniture, invariant reflection-probes-in-free-air |
| 23 | The porch wall switch could not be clicked (UI smoke test switches) | Plates are declared against the plan wall's face; on an exterior wall the visitor's surface is the 0.15 m stucco skin outside it, with its own collider. The porch plate sat 1.2 cm inside the skin: hidden, and every pick ray hit the skin collider first | B: the plan and the built house disagree by the skin; fix: light_switch.js plateOnWall puts every plate in front of the pick-blocking colliders, invariant switch-plates-pickable |
| 24 | 29 baseboards and a lightmap unit baked black beside the porch (bake QA units-black 33178fb767b50d2f) | house.js put a baseboard on both faces of every wall piece; on exterior pieces the outer one lies inside the stucco skin | B; fix: no baseboard on a skinned face, invariant nothing-under-the-skin (the exterior door casings and wall-set iron columns under the skin are recorded debt) |
| 25 | The front-bedroom closet bifold would have baked shut again (found before the rebake) | house.js read bakeOpen from house.json's scan record (no such field) instead of the plan's opening, so its manifest bakePose was 'site' | A, E: a declaration read from the wrong source with no check; fix: both door poses read from the plan, invariant door-bake-poses |
| 26 | First CI run of the test gate failed; the deploy was skipped (the gate worked) | The runner lacked the Python test dependencies (numpy, Pillow) that the Mac has, and its slower CPUs pushed the shader goldens past the 120 s per-test limit. The suite had only ever run locally. | H: verification environments assumed equal. Fix: the workflow installs the Python dependencies and runs `npm test -- --timeout=600`; CI is now the reference run for every push. |

## Classes

- **A. Lighting roles are implicit.** Whether an object is baked, probe-lit, emits, or which switch drives it is decided
  in several files by name patterns, ids and coordinates. New objects fall through. → one lighting manifest.
- **B. Spatial data is duplicated.** Rooms, annex, probe boxes, lamp-group rooms and indoor tests are typed separately
  in JS and Python and drift. → one plan model read by both.
- **C. The probe grid ignores walls.** A 0.5 m trilinear grid blends across walls and exterior walls. → region-aware
  sampling defined once, from the plan model.
- **D. Derived state without an owner.** Clones, copies and baked probes hold state (lightmaps, emission, lamp levels)
  that the source changes later. → one owner per state, derived objects subscribe.
- **E. Fixes at the symptom.** Offsets and special cases added where a bug showed, breaking other places.
- **F. Bake steps without statistics.** No per-unit black/hole/coverage report, so a black bake looked like dark wood.
- **G. UI state machines without tests.** Tour, doors, switches, quality.
- **H. Changes reported without a smoke test.**
- **I. Shaders as stacked string patches.** Order-dependent, sampler-hungry, cache keys easy to get wrong.
- **J. Reconstructions that are not positive by construction.** The probe volume's plain L1 evaluation rings below zero
  opposite any strong source (a doorway, a window, a lamp), per colour, so a face collapses to black or to one hue.
  → a non-negative reconstruction, checked face by face against the bake's own higher-order data.

- **K. Context loss leaves null or dead GPU state, and the start has no non-essential steps.** A lost context makes every
  GPU build return nothing or garbage, and the restore handlers rebuilt only some of it; consumers assumed the state
  exists, and any throw in the start (even pet relighting) aborted the whole load. → every GPU-built resource is valid or
  null = pending (`lighting.js`: `gpu()`, `roomFor`, `restoreEnvironment`; `lightmap.js` / `lightmap_slots.js` build the new
  environment before dropping the old); consumers treat null as "not yet"; the start waits for a live context where it
  needs one and runs non-essential steps through `startup_guard.js` (log once, continue, retry once after the restore).

## Row 19 in detail (2026-10-18)

Measured in node on the shipped bake (`web/tools/harness/baked.mjs`, a JS transcription of the composed shader's
lookup), the leaf closed, 100 points over its inside face (plan y -4.638) seen from 4 cameras in the room:

- **Lookup.** The sided point lands 0.5 m into the room (plan y ~ -4.14); its 4 cells (x -0.5 / 0, y -4.5 / -4.0) are
  all inside the outline, so the region-aware blend is the plain one. Each cell's 4 probes: mostly #1513 / #1533
  (plan (-0.35 / 0.15, -4.35), 0.29 m in front of the door, inside), #1514 / #1534 (y -3.85), and #2122 / #3308 (plan
  (0, -5.0), outdoors, seen through the opening: ~3% of the weight, its own room-facing light positive). Not an outdoor
  cell, not a wall probe, not the offset.
- **Data.** Those probes were baked with the door open (its bake pose is the site's: open), and the sunlit porch through
  the doorway dominates them: #1533 at 0.95 m has L0 0.50 / 0.52 / 0.53 and L1 towards the door 0.53 / 0.57 / 0.63.
  The plain L1 irradiance facing into the room is 0.886 L0 - 1.023 L1 = -0.09 / -0.12 / -0.18; the probes 0.8 m in
  (y -3.85) still read -0.01 / -0.03 / -0.08. Only those beside the opening (x 0.65) see the room alone (L1 ~ 0).
- **Result.** Shader before: 0.010 / 0.005 / 0.001 (luminance 0.006; all channels 0 at 48% of the points, blue 0 at
  95%; red 15x blue where anything is left: the vertical bands follow the probe columns). The same probes' own order-2
  data (in probes.bin, not shipped to the volume): 0.17 / 0.17 / 0.14. The lightmapped wall beside the door (Cycles,
  decoded from the atlas, x 0.5..0.8 and -0.8..-0.6): 0.083 / 0.076 / 0.058, R/B 1.4. Sunrise, golden and dusk do not
  collapse: the kitchen pendant group lights the face from the room side (luminance 0.66-0.90, R/B 8-9, against the
  wall's 0.31-0.47, R/B 7-8; its samples just west of the door read near 0 at every slot, something stands there).
- **Geometry.** The leaf is fine: 0 of its 11400 triangles wound against their normals; the inside face's normals point
  into the room.
- **Fix (runtime, no rebake).** probeEval uses Geomerics' non-linear L1 reconstruction (`web/src/shaders/probe.glsl.js`
  probeEvalL1; the experimental WebGPU path `web/src/webgpu/probes.js` the same): never negative, the same mean and
  direction, one pow per colour, no extra fetch or sampler. The door's face at noon: 0.110 / 0.102 / 0.079 (min 0.057),
  R/B 1.39. House-wide against the lightmaps (3200-3600 lit indoor lightmapped faces per slot, probe looked up 0.5 m
  out): a colour channel collapsed on 1.9-6.1% of faces before, 0.0-0.7% after (order 2: 0.0-0.75%); under 1/8 of the
  lightmap 2.6-7.2% before, 1.0-2.5% after.
- **Affected (the class).** Under the plain evaluation `web/tools/test_probe_plausible.mjs` fails 120 objects at one or
  more slots: 9 of the 12 hinged and bifold doors (front ca2bb42b5a, garage side gside, kitchen -> garage 2e2d4a125a,
  vestibule 40c340903a, linen 029f0013aa, baths 143ab6b9ba / 57fafde9ea, both closet bifolds 0f9916c91a / d8425baf7a;
  not 054ac1818a, 60bf34160a, 498f1f300a) and the probe-lit hardware of the french doors and a slider, the toggles
  (raised garage door, cellular shades, sheers), movables (kitchen stools, wishbone, office and patio chairs), most
  garden plants (leaf undersides), and ~70 unmatched pieces. After the fix: none.
- **Check.** `web/tools/test_probe_plausible.mjs` (in `npm test`): every probe-lit face, both door poses, four slots,
  against the order-2 reference; and no probe-lit face wound against its normal beyond a known list (plant bases and
  dried stems, a sheer: a follow-up).
- **Left.** Doors take the probe volume in every pose, but the probes next to a doorway hold the bake pose's light (the
  front door open). The outdoor probe seen through an opening still weighs a little in the cells just inside. Neither is
  visible after the fix; both need the bake (closed-door probes) to remove.

## Row 20 in detail (2026-10-18)

- **Where.** `web/src/lighting.js` `syncPet` (`roomFor(dusk).texture`, `sky?.target.texture`); the restore handler assumed
  `roomFor` and the PMREM targets always build; `loadSky` cached a rejected download for good; `update()` rendered the
  blend target with null samplers. `web/src/main.js` ran `applyTime`, `pets.relight`, the contact / puddle setup, the idle
  sky preparation (an unhandled rejection) and each frame's updates bare, so one throw ended the start (a throw inside
  `frame` also stopped the 12-frame count that sets `__ready`). `lightmap_slots.js` disposed the old environment before
  building the new one; `lightmap.js` `setEnv` dereferenced a null `envTarget` after a failed rebuild and its restore handler
  could throw out of the event.
- **Fix (the class).** Resources are valid or pending: `gpu()` returns null if the context is lost before, during or after
  a build; consumers skip null; the restore handler re-reads `composerConfig` (a context created lost reports no float
  buffers), rebuilds every sky and room, and never throws. The start waits for a live context before the capability probe,
  the lighting set-up, the shader compile and the first draw, and routes non-essential steps through `startup_guard.js`.
- **Check.** `web/tools/test_context_loss.mjs` (in `npm test`): the real `createLighting` and `Pets` on the real house
  against a fake GPU that can be lost between any two calls; loss at every start step x restored while waiting / late /
  queued, a throwing PMREM, no HDR path, a restore that finds the context lost again. It fails on the old `lighting.js` with the
  exact TypeError. The `context-loss` UI smoke test (`web/tools/smoke/tests.mjs`) does it in a browser with
  `WEBGL_lose_context` during the build, the shader warm-up and inside the house.

## Rules from here

1. A bug is closed only with: a written root cause, a fix for its class, and a check that would have caught it.
2. No behaviour keyed on object names, id strings or coordinates in code; roles and regions come from declared data.
3. One source of truth for the plan and for lighting roles, read by the site, the export and the bake.
4. Nothing is shown to the owner before the gates pass: invariant tests, bake QA, per-room renders vs Cycles and vs the
   last approved baseline, UI smoke tests.
