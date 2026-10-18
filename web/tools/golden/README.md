# Scene goldens and invariants

Headless snapshots of today's lighting behaviour on the real house (no browser, no GPU), so the lighting refactor can prove
it changes nothing unintended.

- `../harness/scene.mjs` builds the scene as `main.js` does: `buildHouse(house.json)`, the garden, `Layout` with every
  placement, `lighting.collectMaterials` (interior/exterior material split, light switches, wall plates), `batchStatic`
  (lmId, lmSkip, still parts). Canvas/DOM/fetch are shimmed; textures never load. About 6 s.
- `objects.json`: materials table (`name#hash` with the properties lighting decisions read), every placed root, every mesh
  (key `lm:<lmId>` when it has one, else `path:<placement id>/<names>`; bbox in mm, motion static/still/moving/movable,
  flags, materials), switches (label, exterior, lights, glows, wall plates), `bakeSwitches` (the records
  `bake/export/switch_groups.mjs` writes), lights, doors.
- `classify.json`: today's answer of each classifier per material, mesh and placed root.
- `spatial.json`: every room / inside classifier sampled on a 5 cm lattice, x -16..16, y -15..20 (plan frame), as run-length
  rows of `[labelIndex, length]`. JS ones from `harness/spatial.mjs`, Python ones (`py:*`, plus lamp group per switch) from
  `bake/scripts/capture_spatial.py`. Since the plan model (step 2 of docs/architecture-lighting.md) the old classifiers
  are retired as their consumers move to it: the golden tracks `js:plan.*` (spaceAt, roomName, isInside, insideGLSL
  evaluated, indoorWeight) and `py:plan.*`, the remaining consumers' wrappers (`js:roam.areaOf`, `js:roam.isIndoor`,
  `py:lamp_groups.room`), the probe volume's wall boxes and the site-side quotes still in use.
- `manifest.json`: the lighting manifest (`web/src/lighting_roles.js`, step 3 of docs/architecture-lighting.md): every
  material's resolved record and every mesh's (fields at their default left out), keyed like `objects.json`, plus the
  validator's errors. `../test_lighting_manifest.mjs` checks that every decision a consumer reads from it gives today's
  answer (`classify.json`), listing the ones changed on purpose with their counts.
- `plan_vectors.json`: the shared test vectors of the two plan readers (`../test_plan.mjs`, `bake/scripts/test_plan.py`).
- `known_failures.json`: recorded violations of `../test_scene_invariants.mjs`.

Commands (run from the repo root):

    node web/tools/test_scene_golden.mjs                   # diff against the goldens, fails on any difference
    UPDATE_GOLDEN=1 node web/tools/test_scene_golden.mjs   # rewrite them; review the git diff
    node web/tools/test_scene_invariants.mjs               # new violations fail; fixed entries are listed
    UPDATE_KNOWN=1 node web/tools/test_scene_invariants.mjs

## Classifiers called from the real source

`emitsLight`, lightmap.js `isMirror` / `weatherClass` / `probeWalls`, photo.js `presentation` / `weatherClass`,
foliage_bake.js `isPlant`, puddles.js `wetMaterial` / `indoors`, light_switch.js `glowing`, pets/roam.js `areaOf` /
`isIndoor`, plan.js (all of it), `lighting.indoorWeight`. Module-private ones are exposed by appending an export at bundle
time (no change to `web/src`). Python: `plan.py` and `reflprobe_layout.py` imported; `lamp_groups.py` functions lifted by
AST (with its `import plan` and `PLAN`).

## Quoted, to be replaced

These decisions are inline in closures or Blender scripts, so the capture re-implements the expression (the golden documents
today's behaviour; a replacement must reproduce it).

| classifier | original | expression |
|---|---|---|
| `plant.foliage` | web/src/lightmap.js:1287 (also :201 PCSS e.plant, :777 stats, contact.js:173, puddles.js:193) | `m.alphaTest > 0 \|\| /^(garden-\|plant)/.test(m.name \|\| '')` |
| `plant.leafSide` | web/src/lightmap.js:1286 | `/^garden-/.test(m.name \|\| '')` |
| `plant.wetEligible` | web/src/lightmap.js:1289 (volume.wet > 0 assumed) | `!/^garden-/.test(m.name \|\| '') && !(m.alphaTest > 0)` |
| `plant.unwrapSkip` | bake/scripts/unwrap.py:73-78 material_skip (alphaMode MASK = alphaTest > 0; glTF transmission = glass.unwrap) | `alphaTest > 0 \|\| name.startswith('garden-') \|\| name.startswith('plant') \|\| glass.unwrap` |
| `glass.shadow` | web/src/lightmap.js:733 (duplicated web/src/webgpu/materials.js:62), first material only | `m.transmission > 0 \|\| m.userData?.daylightOpacity !== undefined \|\| (m.transparent && m.opacity < 0.6)` |
| `glass.windowOverlay` | web/src/lightmap.js:1350 addWindowReflections, any material | `m.userData?.daylightOpacity !== undefined \|\| m.transmission > 0` |
| `glass.stats` | web/src/lightmap.js:777 "why unlit", first material only | `m.transmission > 0 \|\| m.transparent` |
| `glass.unwrap` | web/src/photo.js:141-149 traceMaterial + bake/scripts/unwrap.py:77 (KHR_materials_transmission) | `!isShaderMaterial && (userData.sheer \|\| userData.daylightOpacity !== undefined \|\| transmission > 0)` |
| `glass.cycles` | bake/export/setup.py:42 (Transmission Weight > 0.5 and no sheer key; glass exported by photo.js:149 has transmission 1) | `(daylightOpacity !== undefined \|\| transmission > 0.5) && !sheer` |
| `mirror.layout` | web/src/layout.js:466 addMirrors (same test as lightmap.js:1143 isMirror, which is called for mirror.lightmap) | `mat?.name === 'mirror'` |
| `probe.sheer` | web/src/lightmap.js:1290 | `!!material.userData.sheer` |
| `probe.occl` | web/src/lightmap.js:1288 (foliageBake absent in the headless scene) | `foliage && !material.foliageBake` |
| `mesh.sided` | web/src/lightmap.js:743 (material of a mesh under a door root or an animated root with a toggle) | `!m.lightMap && !m.transparent && !(m.transmission > 0), per MATERIAL over every mesh under dynamic roots` |
| `mesh.doorPart` | web/src/lightmap.js:660-664 | `root.userData.door && kind not in {french, slider}: every mesh whose parent is not the door root` |
| `mesh.interior` | web/src/lighting.js collectMaterials region | `plan.isInside(cx, -cz) && cy < ceiling + 0.05 && bboxX < 17 && bboxZ < 13 (exteriorFinish materials forced exterior)` |
| `mesh.isPlantRoot` | web/src/lightmap.js:193 | `any ancestor userData.id matches /^(plants\|garden\|flowers)-/` |
| `mesh.pcssPlant` | web/src/lightmap.js:201 | `any material foliage \|\| isPlantRoot` |
| `mesh.contactExcluded` | web/src/contact.js:171-173 depthOf | `m.transparent \|\| m.transmission > 0 \|\| m.isShaderMaterial \|\| m.alphaTest > 0 \|\| /^(garden-\|plant)/.test(m.name) (first of the mesh materials that triggers)` |
| `mesh.puddleTier` | web/src/puddles.js:193 (indoors() is called from the real module) | `instanced \|\| any material foliage ? 1 : indoors(box) ? 2 : 0` |
| `mesh.lit` | web/src/lightmap.js:773-778 stats ladder, minus the sidecar-dependent branches (sharedUV, skipped[id], unmatched) | `transmission > 0 \|\| transparent ? 'glass' : foliage ? 'plant' : doorPart ? 'door' : lmSkip ?? (!lmId ? 'dynamic' : 'lightmap')` |
| `mesh.unwrapGroundFar` | bake/scripts/unwrap.py:118 | `area > 300 \|\| abs(cx) > 14 \|\| -cz > 18 \|\| -cz < -14, centroid = mean of world vertices, glTF frame (x, y, z) = scene frame` |
| `mesh.unwrapSkip` | bake/scripts/unwrap.py:73-78 over all materials | `every material plant.unwrapSkip` |
| `mesh.batchable` | web/src/batch.js:49 lmMesh / :68 mergeable | `isMesh && !instanced && !skinned && position` |
| `placed.exterior` | web/src/furniture/light_switch.js:138 (duplicated bake/export/switch_groups.mjs:40) | `/porch\|wall-light-black\|outdoor-front-lamp/.test(fixture.userData.id)` |
| `placed.isPlantRoot` | web/src/lightmap.js:193 | `/^(plants\|garden\|flowers)-/ on the id of the root or an ancestor` |

Also quoted in `spatial.mjs`: grass.js `outdoor` (a planting keep-out, not yet from the plan), house.js `garagePts` (the
garage + laundry floor slab), vpaudit.mjs `roomAt` (a manual tool over house.json).
