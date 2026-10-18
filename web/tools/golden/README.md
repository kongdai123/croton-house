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
  rows of `[labelIndex, length]`. JS ones from `harness/spatial.mjs`, Python ones (`py:*`, plus the lamp group
  `lamp_groups.py` bakes each switch record into, and its group order) from
  `bake/scripts/capture_spatial.py`. Since the plan model (step 2 of docs/architecture-lighting.md) the old classifiers
  are retired as their consumers move to it: the golden tracks `js:plan.*` (spaceAt, roomName, isInside, insideGLSL
  evaluated, indoorWeight) and `py:plan.*`, the remaining consumers' wrappers (`js:roam.areaOf`, `js:roam.isIndoor`), the
  probe volume's wall boxes and the site-side quotes still in use. (Lamp groups come from the lighting manifest since step 3.)
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

Since the lighting manifest (step 3), almost every lighting decision is a read of the records `web/src/lighting_roles.js`
resolves (`roles.lightingOf` per material, `roles.meshLighting` per mesh), and `classify.json` calls them: foliage,
leafSide, wetEligible, unwrapSkip, the glass and mirror columns, emitsLight, the probe shader flags, weather (also what
photo mode uses), doorPart, pcssPlant, plantRoot, contactExcluded, interior, the switches' exterior flag. Still called from
their modules: photo.js `presentation`, foliage_bake.js `isPlant`, puddles.js `wetMaterial` / `indoors`, light_switch.js
`glowing`, pets/roam.js `areaOf` / `isIndoor`, plan.js (all of it), `lighting.indoorWeight`. Module-private ones are
exposed by appending an export at bundle time (no change to `web/src`). Python: `plan.py` and `reflprobe_layout.py`
imported; `lamp_groups.py` `group_of` / `order_of` lifted by AST.

## Quoted

These decisions are inline in closures or Blender scripts, so the capture re-implements the expression, now over the
manifest records:

| classifier | original | expression |
|---|---|---|
| `glass.unwrap` | web/src/photo.js traceMaterial: what the export turns into KHR_materials_transmission | `!isShaderMaterial && (sheer \|\| glass.export pane \|\| transmission > 0)` |
| `mesh.sided` | web/src/lightmap.js applyLightmaps | the meshes whose record says probeSide face, with a material not lightmapped, transparent or transmissive (shared materials are copied for them) |
| `mesh.puddleTier` | web/src/puddles.js sources tier | `instanced \|\| any material foliage ? 1 : indoors(box) ? 2 : 0` |
| `mesh.lit` | web/src/lightmap.js stats ladder, minus the sidecar branches | `why ('plant/glass' split: plant, cutout, glass) ?? (!lmId ? 'dynamic' : 'lightmap')` |
| `mesh.unwrapGroundFar` | bake/scripts/unwrap.py ground/far | area over `plan.json volumes.lightmap.maxArea` or centroid outside its box |
| `mesh.batchable` | web/src/batch.js lmMesh / mergeable | `isMesh && !instanced && !skinned && position` |

Also quoted in `spatial.mjs`: grass.js `outdoor` (a planting keep-out, not yet from the plan), house.js `garagePts` (the
garage + laundry floor slab), vpaudit.mjs `roomAt` (a manual tool over house.json).
