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

## Rules from here

1. A bug is closed only with: a written root cause, a fix for its class, and a check that would have caught it.
2. No behaviour keyed on object names, id strings or coordinates in code; roles and regions come from declared data.
3. One source of truth for the plan and for lighting roles, read by the site, the export and the bake.
4. Nothing is shown to the owner before the gates pass: invariant tests, bake QA, per-room renders vs Cycles and vs the
   last approved baseline, UI smoke tests.
