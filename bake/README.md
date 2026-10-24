# Baked lighting pipeline

Offline Blender Cycles bakes for the walkthrough's baked mode (`?lightmap=sunrise`, `web/src/lightmap.js`). The sun's
direct light and shadows stay live; everything else (sky light, every bounce, the lamps) is baked.

| Step | Script | Runs on | Output |
|---|---|---|---|
| Export the static scene | `export/export.mjs` (bundle `export/export_entry.js`) | headless Chrome against the site | `croton.glb` |
| Switch records and Blender scene | `export/switch_groups.mjs`, `export/setup.py` (lamps: `scripts/fixture_lights.py`) | Chrome, Blender | `switches.json`, `scene.blend` |
| Lightmap UVs | `scripts/unwrap.py` (xatlas, density by class: furniture 2.5, architecture 1.25, outdoor 0.75; `--reuse` keeps an earlier layout when only materials changed) | Python | `croton_lm.glb`, `lightmap_uv.bin` |
| Bake tasks | `scripts/make_tasks.py <slot> <groups> <samples> v2` | Python | one task per layer x group |
| The whole rebake | `REBAKE.md` | cluster | every step, folders, toggle states, cost |
| Bake | `scripts/bake.py` + `scripts/layer_lights.py` | Blender, one GPU per task | `<layer>_gNN.exr` |
| Light probes | `scripts/probe.py` (tasks: `make_tasks.py ... <version> probes`), packed by `scripts/probe_pack.py` | Blender, Python | L2 SH per grid point, `probes.bin` |
| Reflection probes | `scripts/reflprobe.py` (points and boxes: `scripts/reflprobe_layout.py`, from the plan model `web/data/plan.json` via `scripts/plan.py`), sky `scripts/skypano.py` | Blender | per slot daylight-only equirect HDRs; once, the lamp groups' layers (`--lamps`, packed by `lamp_groups_pack.py refl`) |
| Merge | `scripts/composite_v2.py` | Blender's Python | `slot.exr`, `lamps.exr`, tone-curved arrays, `encoding.json` |
| Encode | `scripts/encode_webp.py`, `scripts/compact_uv.py` | Python | `slot.webp`, `lamps.webp`, `lightmap_uv2.bin.gz` |
| Validate | `validate/shoot.mjs <out> '<query>'` | headless Chrome on a GPU | the site through the reference cameras |
| Switchable lamps | `export/switch_groups.mjs` (the site's switches), `scripts/lamp_groups.py` (groups, one physical light per switch, bake scene), `scripts/lamp_groups_tasks.py` (bake + probe tasks per group), `scripts/lamp_groups_pack.py` (merge, pack), `scripts/lamp_groups_render.py` (Cycles references with chosen groups on), `validate/shoot_lamps.mjs` | Chrome, Blender, Python | `v2/lampgroups/`: `encoding.json`, `lampgroups_<t>_0/1.webp`, `half/`, `quarter/`, `probes.bin` |

Layers: **slot** = sky light and its bounces plus the sun's bounces; **lamps** = the house's lamps at their physical
output (the fallback without lamp groups, scaled live by the slot's lamp level). Values are Cycles' DIFFUSE bake without colour (E/pi), so the site multiplies by pi.
Emission: only real light sources glow in the export (lamp surfaces of switched fixtures, materials marked
`userData.emits`: web/src/materials.js `emitsLight`); setup.py drops every other emissive (the walkthrough's daytime
glow on shades and sheers is a raster stand-in for light through cloth).
Encoding: 8-bit RGB, stored y = sqrt(x / (x + K)), decoded x = K y^2 / (1 - y^2), lossless WebP; K per layer.

Environment: `BLENDER` (Blender 4.5 LTS), `CROTON_SITE_PACKAGES` (numpy for Blender's Python), `CROTON_SITE` (site
folder that `shoot.mjs` serves). Cluster job wrappers are kept outside the repo in `bake/cluster/`.

Physical lamps (`scripts/fixture_lights.py`, since bake v4): every light switch of the site is one light of its
fixture's declared output (web/src/lighting_roles.js FIXTURE_OUTPUT: lumens, beam, emitter; 3000 K), in every Blender
scene alike (lightmaps, probes, reflections, Cycles references). One constant turns lumens into Blender watts:
`LM_PER_W` = 6400, chosen so the open-plan rooms' lamps at dusk give their desks ~0.2x their noon daylight (a house: lamps
~100-300 lux, noon daylight indoors ~500-2000); the bake's values then read as lux / 6400. Recessed cans are downlights
(soft-edged spots, half intensity at the declared beam's edge: the ceiling stays dim), track heads spots, lamps and
pendants points, LED bars and the linear pendant rectangles facing down; their lamp surfaces glow at the luminance the
fixture's lumens give them through their area, for camera and glossy rays only (the light carries the lumens).
`scripts/fixture_calibrate.py` measures every emitter model in Cycles; `web/tools/test_lamp_levels.mjs` checks the
shipped bake per plan space.

Lamp groups (web/src/lamp_groups.js): the house's light switches grouped by the lighting manifest (web/src/lighting_roles.js:
the plan space of a switch's lamp surfaces plus the fixture's circuit; every exterior fixture on the porch switch), every
group baked alone at its physical output (lamps layer, 3000 K) and stored as luminance in one channel of an RGB atlas
(three groups per WebP, K per group; the group's mean baked chromaticity, lumens and plan spaces in encoding.json, its
members' lamp-surface luminance), with its luminance SH at the light probes. A switch that is on is at full output at
every time of day (no hand gains); a slot only picks which switches are on by default: the fixtures' declared `defaultOn`
slots, else the manifest's rule (lighting_roles.js defaultSlots: every interior switch at sunrise, golden hour and dusk,
at noon only in spaces no window or door opens to the outside; the porch at dusk), written into encoding.json per group.
The hq tier loads the groups at full resolution, laptops half, mobile quarter. Without `v2/lampgroups/` the site falls
back to the shared lamps layer at the slot's level.

Lighting manifest: every exported node and material carries its record as glTF extras `lighting` (a JSON string,
export.mjs); `scripts/lighting.py` reads it for unwrap.py (which units get a lightmap), setup.py (after-rain classes,
glass, sheer cloth, emitters, the lights' bake flag), foliage_bake.py, reflprobe.py and layer_lights.py. Exports without
records are refused.

