# Baked lighting pipeline

Offline Blender Cycles bakes for the walkthrough's baked mode (`?lightmap=sunrise`, `web/src/lightmap.js`). The sun's
direct light and shadows stay live; everything else (sky light, every bounce, the lamps) is baked.

| Step | Script | Runs on | Output |
|---|---|---|---|
| Export the static scene | `export/export.mjs` (bundle `export/export_entry.js`) | headless Chrome against the site | `croton.glb` |
| Lights and Blender scene | `export/lights.mjs`, `export/setup.py` | Blender | `scene.blend`, `lights.json` |
| Lightmap UVs | `scripts/unwrap.py` (xatlas, density by class: furniture 2.5, architecture 1.25, outdoor 0.75; `--reuse` keeps an earlier layout when only materials changed) | Python | `croton_lm.glb`, `lightmap_uv.bin` |
| Bake tasks | `scripts/make_tasks.py <slot> <groups> <samples> v2` | Python | one task per layer x group |
| Bake | `scripts/bake.py` + `scripts/layer_lights.py` | Blender, one GPU per task | `<layer>_gNN.exr` |
| Light probes | `scripts/probe.py` (tasks: `make_tasks.py ... <version> probes`), packed by `scripts/probe_pack.py` | Blender, Python | L2 SH per grid point, `probes.bin` |
| Reflection probes | `scripts/reflprobe.py`, sky `scripts/skypano.py` | Blender | equirect HDRs |
| Merge | `scripts/composite_v2.py` | Blender's Python | `slot.exr`, `lamps.exr`, tone-curved arrays, `encoding.json` |
| Encode | `scripts/encode_webp.py`, `scripts/compact_uv.py` | Python | `slot.webp`, `lamps.webp`, `lightmap_uv2.bin.gz` |
| Validate | `validate/shoot.mjs <out> '<query>'` | headless Chrome on a GPU | the site through the reference cameras |

Layers: **slot** = sky light and its bounces plus the sun's bounces; **lamps** = the house's lamps at unit level,
scaled live. Values are Cycles' DIFFUSE bake without colour (E/pi), so the site multiplies by pi.
Emission: only real light sources glow in the export (lamp surfaces of switched fixtures, materials marked
`userData.emits`: web/src/materials.js `emitsLight`); setup.py drops every other emissive (the walkthrough's daytime
glow on shades and sheers is a raster stand-in for light through cloth).
Encoding: 8-bit RGB, stored y = sqrt(x / (x + K)), decoded x = K y^2 / (1 - y^2), lossless WebP; K per layer.

Environment: `BLENDER` (Blender 4.5 LTS), `CROTON_SITE_PACKAGES` (numpy for Blender's Python), `CROTON_SITE` (site
folder that `shoot.mjs` serves). Cluster job wrappers are kept outside the repo in `bake/cluster/`.
