# Architecture of the walkthrough

Status: written against `integrate/gfx` at c692295 (2026-10-24). This is for a developer or an agent who wants to
extend the site without breaking it. It links to the detailed docs rather than repeating them; the project rules are in
[postmortem.md](audit/postmortem.md#rules-from-here): every fix needs a root cause, a fix for its class and a check that
would have caught it.

The site runs in one of two modes:

- **Baked** (the default): the indirect light, the lamps, the light probes and the reflection probes come from Blender
  Cycles bakes in `web/assets/lightmaps/`; the sun's direct light and its soft shadow stay live. Blender AgX, auto
  exposure, white balance, TAA and volumetric light run on top.
- **Legacy** (`?legacy` or `?lightmap=0`, and the fallback when the bake cannot load): the older raster lighting with
  window fill lights, a precomputed daylight volume and a hand-tuned grade. The bake export also runs the site in this
  mode (`bake/export/export.mjs`), so the scene it exports keeps its original vertex layout.

Coordinates: plan metres with +x east and +y north; world X = plan x, Y up, Z = -plan y (`plan.js` `toScene`). The
ceiling is 2.44 m (`plan.levels.ceiling`). A furniture piece's local +Z is its front; a placement's `ry` of 0 faces south.

## 1. Module map

Paths in this section are relative to `web/src/`.

### Boot and app

- `main.js`: the entry point: tier, renderer, data, scene build, bake, systems, shader warm-up, the frame loop, and the
  handles `window.__app`, `window.renderAt` and `window.__ready`. Sections 2 and 3 walk through it.
- `baked_mode.js`: whether baked mode is wanted (`bakedRequested`), the atlas resolution per tier (`bakedResolution`)
  and why a device cannot run it (`bakedCapabilityError`).
- `startup_guard.js`: the start under WebGL context loss: `soft()` runs a step that is not essential (logged once,
  retried after a restore), `waitForContext()` holds steps that need a live context.
- `render_targets.js`: `composerConfig`, the colour, depth and MSAA combination the composer can use on this device.
- `shader_warmup.js`: `warmPrograms`, which links every program before the first draw (KHR_parallel_shader_compile)
  and yields to the page.
- `stats.js`: the hidden "stats for nerds" overlay (the backtick key, the right-click menu, `?stats=1`).
- `showcase.js`: `web/showcase.html`, a stage that shows one furniture module or item under studio light.

### Plan and scene construction

- `plan.js`: the reader of `web/data/plan.json` (spaces, walls, wall pieces, openings, outline, volumes) with `spaceAt`,
  `isInside`, `insideGLSL`, `indoorWeight`, `neighbors` and `toScene`. `bake/scripts/plan.py` has the same API.
- `plan_geom.js`: rectilinear polygon helpers in integer 0.1 mm maths, shared by `plan.js` and
  `web/tools/build_plan.mjs` and mirrored in `plan.py`.
- `house.js`: `buildHouse`: floors, ceilings, walls from `web/data/house.json`'s pieces, windows, doors, baseboards,
  the stucco skin and the garage annex (`buildAnnex`); the colliders (`addAABB`, `getColliders`), the doors
  (`getDoors`), site constants and `LOW_WALLS`.
- `layout.js`: `PLACEMENTS` (every furniture row in plan metres), the seeded planting (`generatePlanting`), the
  closet-light rule (`CLOSET_LIGHTS`) and `Layout`, which builds every row and collects the interactive, movable and
  animated roots, the fixed colliders, the live lights and the mirrors.
- `styling_living.js`, `styling_kitchen.js`, `styling_rooms.js`, `styling_garden.js`, `styling_flowers.js`: placement
  tables for props and flowers, in the `PLACEMENTS` row format.
- `grass.js`: `buildGarden`: instanced turf, ground cover and grass tufts in tiles, density per quality.
- `materials.js`: the shared material library `M` (Poly Haven scans in `web/assets/tex/` and procedural textures), and
  the texture set and caps per tier (`setTextureSet`, `setTextureCap`).
- `proc.js`: seeded procedural canvas textures.

### Furniture kit

- `kit.js`: the modelling kit every furniture module imports: geometry (`box`, `cyl`, `sphere`, `torus`, `lathe`,
  `extrude`, `tube`, `plane`, `group`, `at`, `repeat`, `legs`, `cushion`, `pillow`), metadata (`addSeat`, `setMovable`,
  `setCollider`, `autoCollider`, `describe`, `sizeOf`) and re-exports of `THREE`, `M` and `declare`. The module contract
  is [BRIEF.md](../BRIEF.md).
- `furniture/index.js`: `MODULES`, the registry of furniture modules; each exports `items` (name -> builder).
- `furniture/living.js`, `furniture/living_parts.js`: the living room (leather sofa, round oak table, the hand-built
  window seat, jute rug, pine bench) and its wood, cushion and book helpers.
- `furniture/kitchen.js`, `furniture/kitchen_parts.js`: the 2025 kitchen (shaker cabinets, quartz, tile, black
  appliances, island, linear pendant) and its fronts, tiles and appliance builders.
- `furniture/dining.js`, `furniture/dining_parts.js`: the dining room (ash table, Wishbone chairs, paper pendant,
  bookcase and bench) and the office beyond it; local textures.
- `furniture/bedrooms.js`, `furniture/bedrooms_parts.js`: the three bedrooms' beds, louvered closet bifolds, walnut
  cabinet, rugs and side tables; boards, pillows and throws.
- `furniture/closet.js`: the front-bedroom closet's interior.
- `furniture/bath.js`, `furniture/bath_parts.js`: the three bathrooms; shared bath materials and the laundry pieces
  (washer-dryer tower, water heater, shelving, wine console, electrical panel).
- `furniture/garage.js`, `furniture/garage_parts.js`: the garage and laundry nook (sink, shelving, shutter, ping-pong
  table, wall rail, opener lamp, LED shop lights) and their sub-assemblies.
- `furniture/outdoor.js`, `furniture/outdoor_parts.js`: the fire-pit group, patio, fence, umbrella and front-yard pieces;
  the wicker generator and `animatedToggle`, the toggle helper other modules use too.
- `furniture/plants.js`, `furniture/plants_parts.js`: garden and indoor plants as alpha-tested leaf cards on real stems
  with wind sway; leaf textures, the per-material merge and the sway animator.
- `furniture/flowers.js`: the flowering layer (crane flowers, bromeliads, shrub flowers).
- `furniture/decor.js`, `furniture/decor_plus.js`: fixtures and soft furnishings in every room (track and recessed lights,
  sheers, cellular shades, thermostat, porch columns and sconce, accessories); the second adds a few extras and is
  the `decor` module in `MODULES`.
- `furniture/niche.js`: the pine-lined niche shelf and the sliding block chair.
- `furniture/props_living.js`, `furniture/props_living_parts.js`, `furniture/props_kitchen.js`,
  `furniture/props_rooms.js`, `furniture/props_rooms_parts.js`, `furniture/props_garden.js`: small styling props for
  the living areas, the counters, the bedrooms and baths, and the garden.
- `furniture/light_switch.js`: turns every declared fixture into a light switch (`collectLightSwitches`) and stands the
  wall plates on the visitor's side of their wall (`plateOnWall`).

### Lighting manifest and baked lighting

- `lighting_roles.js`: the lighting manifest. `declare` where an object or material is made, `classifyLighting` resolves
  every record, `lightingOf` and `meshLighting` read them, `validateLighting` lists what is undeclared or contradictory.
  Fixtures: `fixtureOf`, `FIXTURE_OUTPUT` (lumens, beam, emitter per kind), `lampGroupAt`, `lampGroupOrder`,
  `defaultSlots`. `gltfLightingPlugin` writes the records into the bake's GLB.
- `lightmap.js`: `applyLightmaps`, the baked walkthrough: matches meshes to lightmap units, makes the lightmapped copies
  and probe-lit materials, the probe volume (`buildProbeVolume`), the reflection probes, the PCSS sun-shadow cache
  (`createSunPCSS`), slots, lamp groups, auto exposure, white balance, volumetric light and puddles. Its handle has
  `setQuality`, `setFeatures`, `register`, `updateMovables` and `dispose`.
- `lightmap_slots.js`: slot changes on the GPU (`createSlotRuntime`): fetch and validate the next slot, then crossfade;
  the shared reflection array (`reflArray`).
- `lighting_slots.js`: pure slot policy: `SLOTS` (sun, sky colour, display EV, auto-exposure key and range (the key: the listing photos' brightness by day), wetness, lamp share),
  `discoverSlots`, `nextSlot`, `blendSlot`, `slotRequests`.
- `lightmap_assets.js`: resolves bake file names through `web/assets/lightmaps/manifest.json` in a packaged build.
- `slot_progress.js`: counts completed slot requests for the loading bar.
- `lamp_groups.js`: switchable baked lamps (`createLampGroups`): one atlas channel and one probe SH per group, the
  switches' levels, the lamp surfaces' glow colour and luminance.
- `foliage_bake.js`: the per-vertex Cycles light of the plants (`loadFoliage`, `bakeFoliage`).
- `contact.js`: contact shadows and AO from moving casters (movables, pets, the visitor) (`createContact`).
- `puddles.js`: the planar puddle reflection of the wet ground (`createPuddles`).
- `sampler_budget.js`: counts the fragment samplers of linked programs (`auditPrograms`).
- `lighting.js`: `createLighting`: sun, skies and PMREM environments, the composer chain, the interior / exterior material
  split (`collectMaterials`), light-switch ticking, legacy fill lights, exposure and grade, context-restore rebuilds.
- `daylight.js`: legacy mode's window-light and bounce volume (`bakeDaylight`; shipped as `web/data/daylight.bin`).
- `hq.js`: soft shadow taps and anisotropy per tier (`createHQ`) and the mirrors (`createMirror`, `prepareMirrors`,
  `updateMirrors`).
- `reflections.js`: screen-space reflections on the surfaces `markReflective` tags (oak floor, quartz).
- `shaders/features.js`: `bakedFeatures`, a material's shader flags from its manifest record and the loaded bake; `flagsKey`.
- `shaders/sampler_plan.js`: `samplerPlan`, which leaves out optional features so a shader fits the GPU's fragment texture
  units, before it is generated.
- `shaders/compose.js`: `compose`, the pure, memoised edits of three's template for one flag set.
- `shaders/baked_material.js`: the one `onBeforeCompile` hook and cache key per baked material.
- `shaders/patch.js`: exact-count, transactional text replacement and the startup patch gate.
- GLSL chunks (text only): `shaders/world.glsl.js` (one world position), `shaders/lightmap.glsl.js` (atlas decode and
  filter), `shaders/probe.glsl.js` (region-aware probe fetch, non-negative L1 evaluation), `shaders/reflection.glsl.js`
  (box-projected reflection probes), `shaders/pcss.glsl.js` (soft sun shadow), `shaders/contact.glsl.js`,
  `shaders/foliage.glsl.js`, `shaders/sheer.glsl.js`, `shaders/wet.glsl.js` (wet-ground mask), `shaders/puddle.glsl.js`,
  `shaders/house.glsl.js` (the outline's inside test) and `shaders/taa.glsl.js` (texture LOD bias).

### Post-processing and colour

- `agx.js`: Blender 4.5's AgX view with the Medium High Contrast look, from its LUTs in `web/assets/agx/`, patched into
  three's OutputPass (`blenderAgX`, `loadAgXLuts`).
- `auto_exposure.js`, `auto_exposure_policy.js`: the GPU meter before output and the EV glide; the pure equations and
  `autoExposureEnabled`.
- `local_adapt.js`: low-resolution bilateral local adaptation, fused into the output shader: pulls down only what is far brighter than the room (windows, sun patches), as a real-estate exposure blend; the room and its shadows stay as lit.
- `white_balance.js`, `white_balance_policy.js`: the camera's white balance from the probe volume
  ([white-balance.md](white-balance.md)).
- `taa.js`: `createTAA`: the jittered linear chain and its temporal resolve; it takes over every pass before the OutputPass.
- `volumetric.js`, `volumetric_slots.js`: sunbeams, mist and haze through the PCSS sun depth; the media per slot and
  `featureWanted`.

### Performance

- `tier.js`: the `TIERS` presets (`hq`, `laptop`, `mobile`), `detectTier`, `classifyGpu`, `detectTexSet`, `qualityPair`.
- `start_quality.js`: the adaptive start: times the first frames on a desktop and steps the tier once (a step up is timed
  again and may be handed back).
- `frame_rate.js`: frame pacing (`createFrameRate`): the display's rate, or an even fraction of it.
- `batch.js`: `batchStatic` (merges per material and 8 m cell, the lightmap ids from `meshId`, `stillParts`), the sway LOD
  (`updateSwayLod`) and the enclosed fit-outs (`updateRoomVisibility`).
- `batch_baked.js`: `batchBaked`, the runtime merges once the bake is applied; `stowSources`; `rigidParts`.
- `plant_clusters.js`: far plants merged per material and 16 m cell, drawn by the walkthrough camera only.
- `rest_clusters.js`: doors, toggles and carried pieces at rest, merged the same way.
- `visibility.js`: room culling from the plan's spaces and openings (`createRoomCulling`).
- `pick_bvh.js`: a BVH for the aim ray on heavy meshes.

### Interaction, UI, tour and photo mode

- `player.js`: `Player`: pointer-lock look, WASD, capsule-against-box collision, sitting, `teleport`.
- `interact.js`: `Interact`: the aim ray, hover labels, sitting, dragging movables, toggles, switches, doors, put-back.
- `human.js`: `Human`, the seated body seen when looking down.
- `nav.js`: the walkable grid from the colliders and A* paths (`buildGrid`, `navPath`) for flights, the tour and the pets.
- `view.js`: picks the most open view from a point (`scenicView`) for automatic cameras.
- `viewpoints.js`: `Viewpoints`: flights to the listing photos and panoramas, the compare wipe, the panorama sphere;
  `OVERLAY_LAYER`.
- `tour.js`: `Tour`, the guided tour over `STOPS`.
- `demo.js`: `Demo`, the scripted demonstration (X).
- `markers.js`: `Markers`: photo, panorama and RedNote pins and their floating cards.
- `minimap.js`: `Minimap`: the radar and the full plan (M).
- `rednote.js`: `RedNote`: the RedNote posts, pinned where they were shot.
- `ui.js`: `UI`: HUD, panels, i18n (`DICT`, zh first), the help sheet (`HELP`), music and its credit, landing and loading
  screens, touch controls.
- `photo.js`: `PhotoMode`: path-traced stills (three-gpu-pathtracer). Its scene copy (`buildScene`) is also what the bake
  exports.
- `photo_ui.js`: `PhotoUI`, the photo mode panel.
- `photo_budget.js`: `photoSize`, a still's size within a memory budget.
- `sky.js`: photo mode's physical sky and mood words (`makeSky`, `parseMood`).

### Pets

- `pets/cat.js`: the tabby cat; its header is the pet module contract (`createPet`) both pets follow.
- `pets/dog.js`: the Shih Tzu puppy (skinned mesh, fur shells, hair cards).
- `pets/roam.js`: `Pets`: roaming on the nav grid with the real door states, calling (G, K), petting, `relight`.

### WebGPU experiment

Not shipped by default; see [webgpu-port.md](webgpu-port.md).

- `webgpu/entry.js`: the entry of the `app` bundle (`web/tools/build.mjs`): with `?webgpu` it loads `dist/webgpu.js`,
  otherwise `main.js`.
- `webgpu/start.js`: the spike's boot (sunrise bake only, diagnostics in `window.__webgpu`).
- `webgpu/scene.js`: the CPU part of main.js's preparation before the lightmap ids (`prepareBatchMaterials`).
- `webgpu/assets.js`: bake loading and unit matching (`loadBake`, `matchUnits`).
- `webgpu/materials.js`: node materials that decode the lightmaps (`bakedMaterials`).
- `webgpu/probes.js`: probe parsing and the probe volume (`parseProbes`, `buildProbeVolume`).
- `webgpu/post.js`: tone mapping and AO (`createPost`).
- `webgpu/agx.js`: AgX in TSL (`blenderAgX`, `unpackLuts`).
- `webgpu/check.mjs`: CPU-only checks, run from `web/` with `node src/webgpu/check.mjs` (not part of `npm test`).

## 2. Data flow

```
source/zillow/floor_shape.svg
  |  web/tools/parse_plan.mjs
  v
web/data/house.json  +  web/data/plan_overlay.json (hand-authored: annex, closets, outdoor zones, door specs, seeds)
  |  web/tools/build_plan.mjs (validates; test_plan.mjs fails when plan.json is stale)
  v
web/data/plan.json  (read by web/src/plan.js and bake/scripts/plan.py)
  |
  v
house.js buildHouse  +  layout.js Layout (PLACEMENTS, styling_*.js, furniture/*)  ->  the scene graph
  |
  v
lighting_roles.js classifyLighting  ->  lighting.js collectMaterials  ->  batch.js batchStatic: an lmId per still mesh
  |
  |  offline, bake/REBAKE.md: bake/export/export.mjs exports photo.js buildScene from a ?legacy page as a GLB with the
  |  lmIds and manifest records  ->  unwrap.py  ->  Blender Cycles  ->  composite, encode  ->  web/assets/lightmaps/
  v
lightmap.js applyLightmaps: lightmaps by lmId, probe volume, reflection probes, lamp_groups.js (switch -> group)
  |
  v
batch_baked.js, plant_clusters.js, rest_clusters.js, visibility.js  ->  the frame loop (section 3)
```

One fact has one source. Rooms, walls, openings, the outline and the probe and lightmap volumes come from `plan.json`;
how a mesh or material is lit comes from its manifest record; a switch's lamp group comes from the plan space at its
lamp surfaces and its circuit. The site, the bake export and the Blender scripts all read the same data
(`bake/scripts/lighting.py` reads the records from the GLB's extras).

### Boot order (`web/src/main.js`)

1. Device tier first (`detectTier`, `TIERS`, `detectTexSet`): it sets MSAA, pixel ratio, shadow map size, post passes
   and texture limits before any of them exist. The renderer, the startup guard (`createGuard`) and the baked-mode
   capability check follow.
2. Data: `web/data/house.json`, `floorplan_points.json`, `tour.json`, `rednote_posts.json`, `photo_spots.json`, and
   `daylight.bin` (legacy only).
3. `createLighting` builds the composer chain; `createTAA` takes it over when the tier or `?taa` asks.
4. The sky, `buildHouse`, `buildGarden`, `Layout.build` (every module in `MODULES`, every placement).
5. `classifyLighting`, `collectMaterials`, `batchStatic`, `classifyLighting` again. The order matters: the material split
   changes the merge groups, and the merges fix the lightmap ids (section 5).
6. Baked mode: `applyLightmaps` (slot from `?lightmap`, default sunrise), then `batchBaked`, `createPlantClusters`,
   `createRestClusters` and `stowSources`, each with its own off switch. A failure sets `state.bakedFallback` and the
   walkthrough stays in legacy mode.
7. Systems: `Player`, `Human`, `Interact`, `Pets`, contact shadows and tier features (`applyFeatures`), `Minimap`,
   `Viewpoints`, `RedNote`, `Tour`, `Markers`, `ui.bind`.
8. Textures decode, `applyTime`, then `state.ready`: the landing's Enter button works from here.
9. `warmPrograms` links every program (legacy mode runs the daylight bake meanwhile), the first `composer.render`, then
   `createRoomCulling`.
10. `PhotoMode`, `PhotoUI`, `Demo`, `Stats`, `window.renderAt`, `window.__app`, `createFrameRate`, `createStartQuality`,
    and the loop. `window.__ready` turns true after 12 frames; every headless tool waits for it.

### Data and asset files

| Path | What |
|---|---|
| `web/data/house.json` | the Zillow floor plan import (walls, pieces, openings, rooms), from `web/tools/parse_plan.mjs` |
| `web/data/plan_overlay.json` | the hand-authored additions to the plan; edit this, never `plan.json` |
| `web/data/plan.json` | the plan model, generated and validated by `web/tools/build_plan.mjs` (`--check`: fails when stale) |
| `web/data/daylight.bin` | legacy mode's window-light grid, regenerated by `web/tools/bake_daylight.mjs` |
| `web/data/tour.json`, `photo_spots.json`, `rednote_posts.json`, `floorplan_points.json`, `floor_shape.svg` | the Zillow viewpoints and tour, photo spots, RedNote posts, plan points and the minimap's drawing |
| `web/assets/lightmaps/v2/lightmap_uv2.bin.gz` | the lightmap units: id, vertex count, bounds and second UV set per unit (`compact_uv.py`) |
| `web/assets/lightmaps/v2/<slot>/` | `encoding.json` (curve, `K` per layer, split rows), `slot_0.webp` + `slot_1.webp` (the atlas in two lossless halves), `foliage.bin.gz`, `half/` and `quarter/` tiers |
| `web/assets/lightmaps/v2/sunrise/lamps_0.webp`, `lamps_1.webp` | the shared lamps layer, the fallback without lamp groups (`?lmgroups=0`) |
| `web/assets/lightmaps/v2/lampgroups/` | `encoding.json` (per group: name, members, `defaultOn`, spaces, lumens, texture channel, `K`, colour; `lmPerW`), `lampgroups_<t>_0.webp` and `lampgroups_<t>_1.webp` (three groups per texture `<t>`, in two halves), `half/`, `quarter/`, `probes.bin`, `refl/` lamp layers |
| `web/assets/lightmaps/<slot>/` | `probes.bin` (light probes), `sky_bg.hdr`, `refl/meta.json` and `refl/probe_NN.hdr` (reflection probes) |
| `web/assets/lightmaps/manifest.json` | `{}` in the repository (plain names); `web/tools/package.py` writes hashed names into a packaged build, which `lightmap_assets.js` reads ([DEPLOYMENT.md](../bake/validate/DEPLOYMENT.md)) |
| `web/assets/agx/`, `hdr/`, `tex/`, `fonts/`, `audio/`, `pets/`, `rednote/`, `pano_thumbs/`, `landing/` | AgX LUTs, the HDR skies `lighting.js` and the showcase load, texture sets (`1k/`, `512/`, 2k JPEG at the top), fonts, music, pet models, RedNote media, panorama thumbnails, the landing photo |
| `web/assets/photos`, `web/assets/panos` | symlinks to `source/zillow/gallery` and `source/zillow/panos`; the Pages workflow copies the real files |

The lightmap encoding (8-bit lossless WebP, `y = sqrt(x / (x + K))`) and the meaning of the values are in
[bake/README.md](../bake/README.md).

## 3. Frame loop

`loop(now)` in `web/src/main.js` runs on every animation frame:

1. Under `?capture` it stops drawing on its own after 12 frames (a recorder steps it with `window.renderAt`).
2. Frame pacing: `pacing.tick(now)` skips refreshes that do not fit (lifted inside an opaque panorama).
3. The adaptive start (`startQuality`) may time this frame; it pauses while the tab is hidden, a panorama is open or
   photo mode is active.
4. `dt` is `?simdt` when set, else the clock's delta capped at 0.1 s; `frame(dt)` runs through `soft`, so a throw is
   logged once and the loop goes on.
5. A timed frame calls `gl0.finish()` and reports its cost; `pacing.drawn` records it; the 12th frame sets `window.__ready`.

`frame(dt)`, in order:

1. Returns at once while photo mode shows a still (`photo.active`: photo mode owns the canvas).
2. `stats.begin()`; the simulation clock `simT` advances.
3. Camera drivers: `tourCtl.update`, `demo.update`, `viewpoints.update`, then `player.update` and `human.update`.
4. `pets.update` (soft), `interact.update`, `markers.update`.
5. Batching state for this camera position: `updateSwayLod`, `updateRoomVisibility`, then `plantClusters.update`.
6. `layout.animate(simT)` (every animated root), the mirrors (`layout.updateMirrors`, unless a panorama hides the house),
   `garden.update`, `minimap.draw`.
7. `lighting.update(dt, false, moving)`: switch fades; in legacy mode also the exposure, the grade and the sun-shadow
   refresh while doors, toggles or a carried piece move.
8. `baked.updateMovables(dt)`: the slot crossfade, the auto-exposure clock, the PCSS sun-shadow cache, fixture glow, lamp
   group levels, white balance, and the sampler audit once a second. A throw with a live context falls back to legacy.
9. `restClusters.update()` (after the shadow cache brought the tracked roots' matrices up to date), then
   `culling.update` (after everything that moves the camera or a door).
10. Draw: `composer.render()` (or a plain `renderer.render` if the composer failed), skipped when an opaque panorama
    covers the view; then the overlay pass draws `OVERLAY_LAYER` (panorama sphere, photo cards) over the finished frame,
    untouched by AO and tone mapping.
11. `stats.end()`.

The composer chain (`lighting.js`, extended by `taa.js`, `contact.js`, `volumetric.js` and the baked lighting): the
contact pass (the moving casters' depth) and the volumetric depth tap ahead of the RenderPass, then `ReflectionPass`
(SSR, hq), GTAO and the volumetric pass in linear HDR, then the OutputPass (in baked mode Blender AgX, with the auto
exposure, local adaptation and white balance folded in), the grade pass and SMAA. With TAA every pass before the
OutputPass runs inside the TAA pass at the jittered projection, and SMAA is off.

`window.renderAt(t)` draws exactly time `t`; `window.simTime()` reads the clock. Use them for deterministic shots
(`?capture` stops the page's own frames).

## 4. Extension recipes

Each recipe ends with the checks to run. `npm test` and `npm run lint` (zero warnings) run in `web/` before every commit;
CI runs both on every push and pull request.

### Add a piece of furniture or decor

1. Write the builder in an existing module, or a new `web/src/furniture/<area>.js` that exports `items` and is
   registered in `MODULES` (`web/src/furniture/index.js`). Use the `web/src/kit.js` helpers; follow
   [BRIEF.md](../BRIEF.md): metres, origin on the floor at the footprint centre, +Z the front, standing on y = 0, budget
   about 40k triangles an item. Build geometry once and `clone()` repeats.
2. Metadata on the returned root: `describe(root, { id, name, zh })`; `addSeat` for every seat; `setMovable` for
   pieces the visitor carries; `autoCollider(root)` or `setCollider(root, { w, d, x, z, h })` for anything a person
   cannot walk through. `Layout.addFixedCollider` turns the footprint into a box collider for the player and the nav
   grid; colliders lower than 0.25 m (rugs, shades) are skipped, and movables get circle colliders instead.
3. Lighting declarations: a placed root is `furniture` unless it declares a role (`declare(root, { role: 'plant' })`).
   A see-through material must declare `surface: 'glass'`, `'sheer'` or `'presentation'` or `validateLighting` fails;
   a light-emitting material is only allowed under a switched fixture, or as `emits` kind `screen`, `indicator` or
   `fire`. Never decide lighting by a name, an id or a coordinate (invariant `no-name-based-lighting`).
4. Idle motion only through `root.userData.animate = t => ...`, a pure function of t.
5. Place it: a row in `PLACEMENTS` (`layout.js`) or in a `styling_*.js` table: `{ m, i, x, y, h, ry, n, zh }`, plus
   `seed`, `scale`, `light: false`, `noBatch` when needed.
6. Look at it: `showcase.html?module=<m>&item=<i>&az=35&el=15&dist=3` (`&collider=1` draws colliders), with
   `node tools/shot.mjs "<url>" out.png` from `web/`, and in the house.
7. Checks. The scene goldens change: `UPDATE_GOLDEN=1 node web/tools/test_scene_golden.mjs`, then review the diff (and
   the shader goldens if a new material class appears). `test_scene_invariants.mjs` may flag the piece (a reflection
   probe inside it, an emitter without a switch). In baked mode a new static mesh has no lightmap unit until the next
   rebake: it falls back to the probe volume (`baked.stats.unlit.unmatched` counts these). After changing fixed furniture,
   run `node tools/bake_daylight.mjs` for legacy mode (dev server running).

### Add an interactive toggle or a carried object

- **Toggle** (blinds, the garage door, the umbrella): build it with
  `animatedToggle(root, { label, labelOn, duration, apply })` from `web/src/furniture/outdoor_parts.js`. It sets
  `root.userData.toggle` (`on`, `value`, `moving`, `set(on, instant)`) and `root.userData.animate`; `Layout` then lists
  the root as interactive and animated, `Interact` flips it on click, and `main.js` passes it to the sun-shadow cache as
  a dynamic caster. A toggle without `userData.animate` is neither animated nor tracked by the sun-shadow cache.
  `apply(value, t)` poses the parts. A state that follows the time of day goes in
  `root.userData.onTime = (dusk, instant) => ...`.
- **Carried object**: `setMovable(root, { mass, radius })`. It becomes role `movable`: no lightmap (`lmSkip`), probe-lit,
  contact shadows, a rigid sun-shadow caster. `Interact` moves it by `root.position` and `root.rotation.y`; with seats as
  well, a click sits and a drag carries.
- **The rule (perf round 2, [realtime-plan.md](realtime-plan.md#frame-cost-with-the-bake-measured-2026-10-24))**: parts of
  doors, toggles and carried pieces move only through their own transforms and `visible`. `stillParts` (lightmap ids)
  and `rigidParts` (runtime merges) find what moves by posing the toggle at load; `rest_clusters.js` then watches world
  matrices, materials and visibility every frame. A part changed any other way (edited vertices, a swapped geometry) is
  not seen to move, and its merged copy keeps drawing the old shape.
- The bake records every toggle's startup state (`<glb>.state.json`); a toggle that starts in another state needs a
  rebake. See "Door and toggle states" in [REBAKE.md](../bake/REBAKE.md#door-and-toggle-states-of-the-bake-exportmjs).
- Checks: `test_still_parts.mjs` and `test_batch_baked.mjs` cover the pattern on the real toggles; for a new kind of
  motion add it to them. On a GPU node: `tools/ab_check.mjs` with `?restmerge=0` against the default.

### Add a light fixture or a lamp group

1. Declare the fixture where it is made: `declare(root, { fixture: { kind } })`, with `kind` one of the keys of
   `FIXTURE_OUTPUT` (`ceiling`, `track`, `pendant`, `wall`, `lantern`, `opener`, `strip`, `lamp`, `cabinet`, `niche`).
   Optional: `circuit`, `heads`, `label`, `defaultOn`, `plate`, `lights`, `output` (documented in the fixtures section
   of `lighting_roles.js`). Whatever glows inside it becomes its lamp surfaces.
2. The live light for legacy mode is `root.userData.light` (`type` point, spot or rect, position, intensity, colour).
   `Layout.addLight` makes it; at most 16 live lights exist (invariant `fixtures-have-live-lights`). Baked mode hides
   every live fixture light: its light comes from the bake.
3. Place it with a `lamp: { plate: [x, y, ry], circuit, defaultOn, output }` in its `PLACEMENTS` row. The switch's lamp
   group is `lampGroupAt`: the plan space at its lamp surfaces (`lampGroup` or id) plus the circuit suffix, or `porch`
   outdoors. Every group except `always` needs one wall plate (`validateSwitches`).
4. The lumen model: the fixture's lumens (`FIXTURE_OUTPUT[kind].lm`, overridden by the declaration's and the row's
   `output`), 3000 K (`LAMP_CCT`), become one physical Blender light per switch in `bake/scripts/fixture_lights.py`,
   converted by one constant, `LM_PER_W` = 6400. No hand gains. `bake/scripts/fixture_calibrate.py` measures every
   emitter model; `web/tools/test_lamp_levels.mjs` checks the shipped bake's lux per space.
5. Default switches per slot: `defaultSlots` (every interior switch at sunrise, golden hour and dusk; at noon only in
   spaces without daylight; the porch at dusk), unless the fixture declares `defaultOn`. The shipped
   `v2/lampgroups/encoding.json` carries each group's `defaultOn`, and `lamp_groups.js` prefers it.
6. **Rebake** whenever the light changes: a new, moved or removed fixture, other lumens or beam, or a changed grouping.
   Switches find their baked group by fixture id and position (within 5 cm, `createLampGroups`), so until the rebake a
   new or moved switch drives no baked light. A new group fails `npm test` (`encoding-matches-lamp-groups-order`) until
   a rebake publishes it, so a new group and its rebake land together.
7. Never add, remove or hide lights after load (every shader recompiles); change their intensity.
8. Checks: `test_lighting_manifest.mjs`, `test_scene_invariants.mjs` (`rooms-have-switched-light`,
   `switch-plates-pickable`, `default-switches`), `bake/scripts/test_fixture_lights.py`, and the smoke test `switches`
   on a GPU.

### Add a room or space to the plan

1. Edit `web/data/plan_overlay.json` (`spaces`: `id`, `kind`, `zone`, `label`, a `polygon`, `rect` or `from`, optional
   `lampGroup`, `reflProbe` seeds; `walls`; `openings`), then `node tools/build_plan.mjs` from `web/`. It validates;
   `test_plan.mjs` fails while `plan.json` is stale. When the shared test vectors move,
   `UPDATE_VECTORS=1 node tools/test_plan.mjs` and review the diff (`bake/scripts/test_plan.py` runs the same vectors
   against `plan.py`).
2. A space that is only a label or a zone needs nothing else. A built room also needs its walls built: `house.js` builds
   the main house from `house.json`'s pieces and the annex from the plan's walls (`buildAnnex`).
3. Room culling (`visibility.js`) trusts the plan: each interior space is a cell and every opening a portal. A wall
   built lower than the plan says goes into `LOW_WALLS` in `house.js`. Checks: `test_visibility.mjs`, and
   `tools/cull_check.mjs` on a GPU node ([RENDER_GATE.md](../bake/validate/RENDER_GATE.md)).
4. Light: every interior space needs a switched fixture (`rooms-have-switched-light`); closets and the laundry get one
   from the closet rule (`CLOSET_LIGHTS`). Its lamp group is new, so this is a rebake.
5. Light probes: the grid is `volumes.probe` in the plan (0.5 m, three heights), and `bake/scripts/probe_grid.py` marks
   points inside wall pieces and the skin solid. Probe lookups never blend across the outline (`insideGLSL`). A space
   outside the grid's box needs the box grown and a rebake.
6. Reflection probes: `bake/scripts/reflprobe_layout.py` lays them out from the plan (a 3.4 m grid plus each space's
   `reflProbe` seeds; print it with `python3 bake/scripts/reflprobe_layout.py web/data/plan.json`). The invariants
   `reflection-probes-match-layout` (the committed `refl/meta.json` of every slot) and `reflection-probes-in-free-air`
   fail until the probes are rebaked. The REBAKE.md task ranges are written for 30 probes: adjust them.
7. Gate c cameras: `node bake/validate/make_cameras.mjs`, commit `bake/validate/cameras.json`.
8. Legacy mode: `node tools/bake_daylight.mjs` after walls or windows change.

### Add a time slot, or change a slot's look

- **A new slot**: `SLOTS` in `web/src/lighting_slots.js` and in `bake/scripts/slots.py` (`test_lighting_slots.mjs`
  checks they agree); `SLOTS` in `web/src/lighting_roles.js` (default switches); `MEDIA` in
  `web/src/volumetric_slots.js` (otherwise `mediumOf` falls back to sunrise); `slot_<name>` in both languages of `DICT`
  (`ui.js`); the slot list of `reflection-probes-match-layout` in `test_scene_invariants.mjs`. Bake its lightmaps,
  probes, reflections, sky and foliage (REBAKE.md steps 4 to 6); `discoverSlots` finds it by
  `v2/<slot>/encoding.json`, and N cycles through `SLOT_ORDER`. Add it to gate c's state list.
- **Display only, no rebake**: a slot's `ev` (display exposure) and `autoExposure` (`minEV`, `maxEV`) in `SLOTS`, its
  volumetric media in `MEDIA`, and the camera's white balance settings (`white_balance_policy.js`). Gate c's fixed set
  uses the slot's EV, so expect a baseline change.
- **Sun and sky** (`az`, `el`, `strength`, `color`): the live sun moves at once, but its bounce, the probes and the
  reflections were baked with `slots.py`'s values; change both and rebake the slot. The sunrise values are pinned in
  `test_lighting_slots.mjs`.

### Add a quality tier flag

1. Add the key to all three presets in `TIERS` (`web/src/tier.js`).
2. Read it where the quality is applied, so it follows every switch (J, the adaptive start): `setQuality(name)` and
   `applyFeatures(p)` in `main.js`, `lighting.setQuality` in `lighting.js`, `setQuality` and `setFeatures` in
   `lightmap.js`. A pass is built once and enabled or disabled (`setShafts` is the pattern), never rebuilt per switch;
   a quality change must not recompile shaders (`test_shader_invariants.mjs`).
3. For a query override, use `featureWanted(location.search, key, preset)` as `taa` and `shafts` do.
4. TAA wraps `lighting.setQuality` and forces `msaa: 0` and `smaa: false`: a flag that brings MSAA back is overridden.
5. Checks: `test_tier.mjs` for detection; the smoke test `quality-and-slots` (manual switches survive a quality change).

### Add a query flag

There is no central list or allow-list. Each module reads its own flag from `location.search`; `main.js` holds its own
in `Q`. Prefer a pure function that takes the search string (`detectTier(search)`, `bakedRequested(search)`,
`lampGroupsWanted(search)`, `featureWanted(search, key, preset)`, `autoExposureEnabled(query)`) so a node test can pass
one. The node harness sets `globalThis.location = { search: '' }`, so a flag read at module load is fixed for a test
run. Convention: `?<feature>=0` turns a default-on feature off, so `tools/ab_check.mjs` can compare the two variants.

Flags in use:

| Purpose | Flags |
|---|---|
| Position and start | `?x`, `?y` (plan metres), `?h` (heading, degrees), `?p` (pitch, radians), `?eye`, `?auto`, `?dusk` (legacy) |
| Mode and quality | `?legacy`, `?lightmap=<slot>` or `0`, `?tier=hq`/`laptop`/`mobile`, `?fast`, `?adapt=0`, `?tex`, `?lmres`, `?lmgroups` |
| Performance switches | `?cull=0`, `?batch=0`, `?batch2=0`, `?plantmerge=0`, `?restmerge=0`, `?stow=0`, `?taascan=1`, `?pcssregion=0`, `?fps` |
| Look | `?taa` (`0`, or the internal scale), `?shafts`, `?wb=0`, `?wbd`, `?localadapt=0`, `?autoexp=0`, `?fixedexposure`, `?rawtone`, `?agx=three`, `?sunoff`, `?refllamps`, `?foliagebake=0` |
| Tools | `?capture`, `?simdt`, `?stats`, `?pets=0`, `?petseed`, `?pins=0`, `?daylight=live`, `?serif=1`, `?webgpu` |

### Add a test

- `npm test` (`web/tools/run_tests.mjs`) builds the site, then runs every `web/tools/test_*.mjs` in its own node
  process (in parallel, 120 s each by default), `web/tools/test_package.py` and every `bake/scripts/test_*.py`. A test
  passes by exiting 0. A new file with that name is picked up; nothing to register. Run a subset with
  `node tools/run_tests.mjs <name-filter>`; `--serial` and `--timeout=600` (CI's value) are the other options.
- Tests in `npm test` need no browser, GPU or network. Three patterns: bundle the modules under test with esbuild into a
  temp dir and import them (`test_batch_baked.mjs`); import a pure module through a data URL (`test_lighting_slots.mjs`);
  or build the real house headless with `buildRealScene` from `web/tools/harness/scene.mjs` (canvas, DOM and fetch
  shimmed, textures never load; about 6 s), or the baked house with `buildBakedScene` from
  `web/tools/harness/baked.mjs` (the shipped bake read from disk, pixels never decoded).
- Goldens live in `web/tools/golden/` ([its README](../web/tools/golden/README.md)); write them with `writeGolden`
  (`web/tools/harness/util.mjs`) so a diff shows one entry per line.
- Browser tests are UI smoke tests: an entry `{ name, timeoutS, run(ctx) }` in `TESTS` (`web/tools/smoke/tests.mjs`),
  run by `npm run smoke` ([web/tools/README.md](../web/tools/README.md)). Their browser-free helpers are unit-tested in
  `test_smoke_helpers.mjs`.
- `npm run lint` is eslint over `src` and `tools` with `--max-warnings 0`.

## 5. Invariants and gotchas

Most of these are checked by `web/tools/test_scene_invariants.mjs` (gate a), the shader tests or bake QA; the rest are
rules from the postmortem and code comments.

- **Glass casts no sun.** Glass and presentation materials have `castsSun: false`. In baked mode every lightmapped unit
  casts into the PCSS sun depth, and a mesh's sun casting is decided by its first material alone, so never put glass
  and an opaque frame in one multi-material mesh: split it (invariant `glass-casts-no-sun`). Otherwise the panes stop
  sunbeams and sun patches.
- **Stable lightmap ids.** `meshId` (`batch.js`) hashes a mesh's vertex count and up to 64 world-space vertices to the
  millimetre; a merged mesh hashes its members' ids. `applyLightmaps` matches by id and vertex count, then by vertex
  count and bounds (6 mm in all). Moving a static mesh, editing its geometry or changing what merges with what (the
  material split in `collectMaterials`, the keys and 8 m cells of `batchStatic`, `noBatch`) re-ids it, and it loses its
  lightmap until a rebake. Baked mode re-lays out matched vertices along chart seams, which is why the export runs in
  legacy mode. Invariant `lmid-unique`.
- **Never mutate merged sources.** `batchStatic` and `batchBaked` hide the sources (`userData.batched`,
  `userData.batch2Source`) and draw merged copies that share the source's material object; `stowSources` moves the
  hidden sources into hidden "merged sources" groups. After load, material property changes still show (shared
  material); reassigning `mesh.material`, editing geometry, or moving or showing a merged source does not, or desyncs.
  Static subtrees also stop updating their matrices. Only doors, interactive roots, animated roots, roots with
  `userData.toggle` or `userData.noBatch`, and objects added after batching may move
  ([agent_env.md](briefs/agent_env.md)).
- **Walkthrough-only draws.** The plant and rest clusters and room culling apply to the walkthrough camera only, through
  `layers.mainOnly`, `layers.mainOff` and `layers.test`; the sun shadow, mirrors, the puddle reflection, contact depth
  and photo mode draw the real meshes. A new camera or pass that walks the scene must skip `userData.mainOnly` meshes and
  hidden merge sources, as `hq.js`, `puddles.js` and `photo.js` do. Culling never changes `visible`: the sun-shadow
  cache reads that as motion.
- **Objects added after load** must be registered with the bake (`baked.register(root)`, as `main.js` does for the
  visitor's body and the pets) to get the probe-lit shader, and must move through tracked transforms to cast a correct
  sun shadow (`baked.sunShadow.track`).
- **TAA forces MSAA 0.** `createTAA` drops the composer's multisampling, disables SMAA and wraps `lighting.setQuality` so
  no quality change brings them back. Foliage alpha-to-coverage is off under TAA, but the alpha cutoff stays at 45%
  (`setFoliageAA`). The overlay layer draws after the composer with the unjittered projection.
- **Photo mode.** While `photo.active`, `frame()` returns at once: photo mode owns the canvas. `PhotoMode.buildScene` is
  also the scene the bake exports (`bake/export/export.mjs`): what it keeps or flattens changes the bake's input. It
  leaves out `presentation` roles and `mainOnly` meshes.
- **Shaders.** Nothing outside `web/src/shaders` edits a baked material's shader (an allow-list with reasons in
  `test_shader_invariants.mjs`). Apple GPUs give a fragment shader 16 texture units: `samplerPlan` drops optional
  features before generation, and `baked.auditSamplers()` must stay at 16 or below (gate c's report records it;
  REBAKE.md's validation step checks it).
- **Lights.** Never add, remove or hide a light after load; change its intensity. Changing the light count recompiles
  every shader.
- **Context loss.** Every GPU-built resource is valid or null (pending); start steps that are not essential go through
  `guard.soft`, and steps that need the GPU `await guard.waitForContext()` (postmortem row 20,
  `test_context_loss.mjs`).
- **Determinism.** Animations are pure functions of time, with no `Date.now` or `Math.random` at render time
  ([BRIEF.md](../BRIEF.md)); planting is seeded (`generatePlanting(7)`). Timing tools pass `?fps=0`.
- **One plan.** No room tables, inside rectangles or plan volumes outside the plan model (invariant
  `plan-is-single-source`); `plan.json` is generated, so edit `plan_overlay.json`.
- **Declared, not inferred.** No lighting decision keyed on a name, id or coordinate (`no-name-based-lighting`); every
  visible mesh resolves with a declared role (`lighting-manifest-complete`).
- **known_failures.json.** `web/tools/golden/known_failures.json` records accepted invariant violations; today its
  `invariants` is empty. The invariants test fails on any new offender and lists recorded ones that are fixed.
  `UPDATE_KNOWN=1 node web/tools/test_scene_invariants.mjs` rewrites it: only to shrink the list or record an
  accepted violation, with the reason in the commit. Bake QA's `bake/validate/qa_baseline.json` works the same way
  (shrink-only; `--approve`, and `--allow-new-failures` for a new expected failure).
- **Goldens and how to regenerate them.** Always review the diff and say why in the commit.

  | Golden | Regenerate |
  |---|---|
  | `objects.json`, `classify.json`, `spatial.json`, `manifest.json` | `UPDATE_GOLDEN=1 node web/tools/test_scene_golden.mjs` |
  | `shaders.json`, `shader_texts.json.gz` | `UPDATE_GOLDEN=1 node web/tools/test_shader_golden.mjs` |
  | `plan_vectors.json` | `UPDATE_VECTORS=1 node tools/test_plan.mjs` (from `web/`) |
  | `known_failures.json` | `UPDATE_KNOWN=1 node web/tools/test_scene_invariants.mjs` |
  | `white_balance_walls.json` | `web/tools/wb_walls.py` on a gate c visitor run with `&wb=0` ([white-balance.md](white-balance.md#checked-against-the-rendered-walls)) |
  | gate c baseline, `bake/validate/baseline.json` | `compare.py approve` ([RENDER_GATE.md](../bake/validate/RENDER_GATE.md)) |
  | bake QA baseline, `bake/validate/qa_baseline.json` | `python3 bake/validate/qa.py ... --approve` |

- **Legacy daylight.** `web/data/daylight.bin` carries a fingerprint of the walls, windows and fixed furniture; a stale
  file is caught and the page bakes live (0.5 to 2 s per visitor). Regenerate it after such changes.
- **UI.** `#hud` has `pointer-events:none`, so interactive children need `pointer-events:auto`; strings go in `DICT`
  (`ui.js`, zh first) and elements use `data-i18n`.
- **Owner rules** ([HANDOFF.md](../HANDOFF.md#conventions-and-constraints)): the front door stays hidden from the street
  by foliage; the landing page is a tribute, not a copy, and never says "AI".
- **The repository is public.** No home directories, cluster hosts or tokens in tracked files
  (`test_no_personal_paths.mjs`).

## 6. Rebake in one page

The full runbook is [bake/REBAKE.md](../bake/REBAKE.md); slot settings in [bake/SLOTS.md](../bake/SLOTS.md); the
pipeline table in [bake/README.md](../bake/README.md).

**When.** After anything that changes what Cycles sees: static geometry (walls, built-ins, fixed furniture) or the
lightmap ids; a fixture, its lumens or the lamp grouping; a slot's sun or sky; a door's `bakeOpen` / `probeClosed` or a
toggle's startup state; the plan's probe volume or reflection seeds. Not after exposure, white balance, volumetric
media, post-processing, tier or UI changes. A change of material only keeps the unwrap layout (`unwrap.py --reuse`),
but its colour reaches the bounce light only with a rebake.

**Steps** (REBAKE.md's numbering):

0. On a workstation: build, run every test, print the reflection layout, bundle the exporter, sync to the cluster.
1. Export four GLBs from the site in legacy mode (lightmap and probe poses, day and dusk) and the switch records
   (`bake/export/switch_groups.mjs`).
2. Unwrap (xatlas), compact the UVs, write the denoiser guides; the four exports must share one layout.
3. Make the Blender scenes with `setup.py` (one physical light per switch from `fixture_lights.py`) and the two
   lamp-group scenes.
4. Queue the tasks: lightmaps and probe chunks per slot (`make_tasks.py`), lamp groups (`lamp_groups_tasks.py`),
   reflections, skies, foliage.
5. Run the pool on scavenger GPUs (at most 30 at a time).
6. Post-process: composite, encode, chart-aware tiers, pack probes, foliage and lamp groups. Then gate b
   (`bake/validate/qa.py`, CPU only). Publish into a test site first, then into `web/assets/lightmaps/`.
7. Validate: gate c through the reference cameras on a GPU node, and the full UI smoke suite on a GPU.

**Cost.** The final rebake of 2026-10-18 took about 78 GPU-hours: roughly 50 minutes of preparation, 3 hours on the pool
with 25 GPUs and 45 minutes of post-processing.

**After publishing**, in the repository: `python3 bake/validate/qa.py` on the shipped assets must exit 0; `npm test`
checks the new bake (`test_lamp_levels.mjs`, `test_probe_plausible.mjs`, `test_white_balance_bake.mjs`, the shader
goldens, `encoding-matches-lamp-groups-order`, `reflection-probes-match-layout`); approve gate c's new baseline once the
sheets look right.

The cluster's hosts, folders and job wrappers are not in the repository: they live in the git-ignored `bake/cluster/`
folder and its env file. Keep it that way.

## 7. What is stale in HANDOFF.md

[HANDOFF.md](../HANDOFF.md) is the session handoff of 2026-10-12, before the baked lighting became the default. Still
right: the dev server, the build, frame pacing, room culling, the runtime merges, the interface and keys, the
conventions and the owner's constraints. Stale:

- **"Graphics pass" and "Look and antialiasing"**: the custom tone curve, `tune`, and the fitted exposures and grade
  values are legacy mode; baked mode uses Blender AgX, auto exposure with per-slot keys and ranges (`SLOTS`) and white balance,
  and sets the grade neutral (the film grain stays). hq runs TAA (`taa: 1`), so its composer has no MSAA and no SMAA;
  `?taa=0` gives MSAA 4 and SMAA back. "A real Blender lightmap bake is still the larger step" is done.
- **"Daylight bake is precomputed"** and **"Smooth entry"**: legacy mode only. Baked mode has four slots; N cycles
  sunrise, noon, golden hour and dusk, each loaded when asked for.
- **"Moving doors refresh the sun shadow at most 10x a second"**: legacy only; baked mode has the PCSS sun-shadow cache
  with partial redraws (`createSunPCSS`).
- **Missing**: the plan model, the lighting manifest, the composed shader, the gates, `npm test` and CI, the bake and
  rebake, TAA, volumetric light, white balance. This document and the docs index in the [README](../README.md) cover them.
- **"Still open"** and the unreviewed reports: not re-checked since; treat as unverified.
