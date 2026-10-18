# Baked lighting pipeline

Offline Blender Cycles bakes for the walkthrough's baked mode (`?lightmap=sunrise`, `web/src/lightmap.js`). The sun's
direct light and shadows stay live; everything else (sky light, every bounce, the lamps) is baked.

| Step | Script | Runs on | Output |
|---|---|---|---|
| Export the static scene | `export/export.mjs` (bundle `export/export_entry.js`) | headless Chrome against the site | `croton.glb` |
| Lights and Blender scene | `export/lights.mjs`, `export/setup.py` | Blender | `scene.blend`, `lights.json` |
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

Layers: **slot** = sky light and its bounces plus the sun's bounces; **lamps** = the house's lamps at unit level,
scaled live. Values are Cycles' DIFFUSE bake without colour (E/pi), so the site multiplies by pi.
Emission: only real light sources glow in the export (lamp surfaces of switched fixtures, materials marked
`userData.emits`: web/src/materials.js `emitsLight`); setup.py drops every other emissive (the walkthrough's daytime
glow on shades and sheers is a raster stand-in for light through cloth).
Encoding: 8-bit RGB, stored y = sqrt(x / (x + K)), decoded x = K y^2 / (1 - y^2), lossless WebP; K per layer.

Environment: `BLENDER` (Blender 4.5 LTS), `CROTON_SITE_PACKAGES` (numpy for Blender's Python), `CROTON_SITE` (site
folder that `shoot.mjs` serves). Cluster job wrappers are kept outside the repo in `bake/cluster/`.

Lamp groups (web/src/lamp_groups.js): the house's light switches grouped by the lighting manifest (web/src/lighting_roles.js:
the plan space of a switch's lamp surfaces plus the fixture's circuit; every exterior fixture on the porch switch), every
group baked alone at its physical level (lamps layer, 3000 K) and stored as luminance in one channel of an RGB atlas (three
groups per WebP, K per group; the group's mean baked chromaticity in encoding.json), with its luminance SH at the light
probes. A switch that is on is at full level at every time of day; a slot only picks which switches are on by default
(the fixtures' declared `defaultOn` slots, written into encoding.json per group). Without `v2/lampgroups/` the site falls
back to the shared lamps layer at the slot's level.

Lighting manifest: every exported node and material carries its record as glTF extras `lighting` (a JSON string,
export.mjs); `scripts/lighting.py` reads it for unwrap.py (which units get a lightmap), setup.py (after-rain classes,
glass, sheer cloth, emitters, the lights' bake flag), foliage_bake.py, reflprobe.py and layer_lights.py. Exports without
records are refused.

