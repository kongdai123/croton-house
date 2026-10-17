# Lighting-role audit: where "how is this object lit?" is decided

Read-only audit of the croton-house repo (web/src, bake/export, bake/scripts, web/tools). Line numbers are from the tree at
commit 2fb3130. Goal: inventory for a refactor to one declared "lighting role" per object/material.

Conventions: "mech" = mechanism (FLAG = userData/extras data flag, REGEX = name regex, ID = id string, COORD = coordinate or
box, MATPROP = material property such as alphaTest/transmission/transparent, HIER = hierarchy/ancestor, TABLE = hand
table). "Per-mesh" vs "per-material" matters: many decisions that want to be per mesh are made per material.

---------------------------------------------------------------------------------------------------------------------

## 0. The pipeline in one paragraph (so the decision points make sense)

1. Scene build: furniture modules set `userData` flags (`movable`, `toggle`, `animate`, `light`, `lightFixture`, `placement`,
   `sheer`, `emits`, `daylightOpacity`...), materials get names (`garden-*`, `plant-*`, `mirror`).
2. `lighting.collectMaterials` (lighting.js:270) splits materials into interior/exterior copies by position (COORD) and
   collects switches (`collectLightSwitches`).
3. `batchStatic` (batch.js) merges meshes and stamps each still mesh with `userData.lmId` (hash of world vertices) or
   `lmSkip='movable'`; animated/toggled roots get ids only on their `stillParts`.
4. Bake export (`bake/export/export.mjs` -> `photo.js buildScene`) writes a GLB with ids as node extras and converts materials
   (`traceMaterial`). `unwrap.py` decides which ids get a lightmap unit; `setup.py` builds the Cycles scene (materials classified
   by name/position, emission by marker); `lamp_groups.py` assigns lamps to switch groups; `bake.py` bakes anything with 2 UV
   layers; `probe.py`, `reflprobe*.py`, `foliage_bake.py` bake the non-lightmapped lighting.
5. Runtime `applyLightmaps` (lightmap.js:523) matches units to meshes by id (then vertex count + bbox), swaps matched
   meshes to a lightmap clone material, and sends every other lit mesh through `probeLit`.

The decisions are spread over **JS (about 14 files) and Python (about 9 files)** with no shared definition. Facts that
must agree (plant vs not, glass vs not, exterior vs interior, lamp group of a fixture) are each re-derived 2 to 7 times.

---------------------------------------------------------------------------------------------------------------------

## 1. Decision points

### 1A. Lightmapped (baked) vs probe-lit vs unlit/skipped

| # | file:line | decides | mech | inputs |
|---|---|---|---|---|
| 1 | web/src/batch.js:49 `lmMesh` | a mesh may carry a lightmap id at all | object type | isMesh, not Instanced/Skinned, has `position` |
| 2 | batch.js:94-95 `label` | `lmId = meshId(o)` vs `lmSkip='movable'` | FLAG propagated through HIER | `movable` argument; set at batch.js:109 `movable = !!anchor.userData.movable` where anchors = `layout.interactive` (seats, movable, toggle roots, layout.js:426) |
| 3 | batch.js:101 | animated (`userData.animate`) or toggled (`userData.toggle`) roots: only `stillParts` get ids (the rest are "dynamic", probe-lit); skipped entirely if `userData.movable` | FLAG + runtime probing | `layout.animated`, `userData.toggle`, `stillParts()` (batch.js:55 poses the toggle/animate at several times and keeps meshes whose matrix/visibility/geometry never change) |
| 4 | batch.js:102 | `noBatch` roots are labelled but not merged | FLAG | `userData.noBatch` (set by light_switch.js:48,66,117) |
| 5 | batch.js:103-110 | `viewRoom` (closet fit-out, house.js:326 / closet.js:19) groups meshes per room and hides them outside; changes merged-mesh hash, so changes ids | FLAG | `userData.viewRoom` |
| 6 | batch.js:68 `mergeable` | merged vs left alone: plain Mesh, no children, visible, non-array material, `!transparent`, det>0 | MATPROP | transparent materials keep their own id, opaque get merged-id |
| 7 | batch.js:132 | merged mesh inherits `lmSkip` of its first member (mixed lists would silently follow member 0) | HIER | first of group |
| 8 | batch.js:150 | far-LOD frozen copy of animated roots excludes meshes with `lmId` | FLAG | `userData.lmId` |
| 9 | web/src/furniture/light_switch.js:51 | switch plate gets a manual `lmId`; rocker keeps probe | hard-coded | plate.children[0] |
| 10 | web/src/photo.js:17-21 `presentation` | which scene objects never reach the bake export | FLAG + REGEX + MATPROP | `userData.presentation`/`reflection` up the HIER; `/^(cat-blob\|dog-contact-shadow)$/` on name; additive blending; MeshBasic+transparent+!depthWrite+polygonOffset+black |
| 11 | photo.js:23 `lmTag` | copies `lmId`/`lmSkip` onto the exported mesh | FLAG | |
| 12 | photo.js:129-164 `traceMaterial` | export-time material conversion: ShaderMaterial exported only if `/flame/i` (name); `clearcoat>0` stripped; `userData.sheer` -> transmission=sheer.transmit; `daylightOpacity!==undefined` -> clear transmissive glass; every emissive not `emitsLight` zeroed | REGEX + FLAG + MATPROP | this is what makes `unwrap.py` see "glass" later (see 1.14) |
| 13 | bake/export/export.mjs:23,44-48 | `BAKE_OPEN=['d8425baf7a']`: one door id baked open; :56 force-show `viewRoom`/`batched` room groups; :60 drop DirectionalLights | ID | door id of the front-bedroom louvre closet |
| 14 | bake/scripts/unwrap.py:73-78 `material_skip` | unit skipped as `plant/glass`: `alphaMode=='MASK'` or name starts `garden-`/`plant`, or has `KHR_materials_transmission` | MATPROP + REGEX(prefix) | glTF material. Plain `BLEND` glass is *not* skipped here; it is skipped only because photo.js turned it into transmission glass |
| 15 | unwrap.py:99-107 | `lmSkip=='movable'` -> skipped 'movable'; no `lm` id -> 'dynamic' | FLAG | node extras |
| 16 | unwrap.py:30-40,114 | legacy fallback when no ids: `scene/movables.json` vertex-count + bbox match (tolerance 0.01 size, 0.6 m centre) | COORD | `bake/validate/movables.mjs` output |
| 17 | unwrap.py:118 | `ground/far`: area>300 m2, or `abs(cx)>14`, or `-cz>18` or `-cz<-14` | COORD | world centroid/area |
| 18 | unwrap.py:125-164 | texel class (`outdoor` if not inside_plan, `architecture` if size>3 or area>12, else `furniture`) and `MIN_TEXELS=16` -> `tiny` skip; scales 2.5/1.25/0.75, 64 texels/m | COORD + magic numbers | area, bbox, inside_plan polygon constants |
| 19 | bake/scripts/bake.py:20 | what is baked: every MESH with >=2 UV layers (the data decides here: good) | data | UV layer count |
| 20 | bake/scripts/layer_lights.py:57 | `name.startswith('movable')` hidden in every bake (names written by unwrap.py:104 `movable_{ni}`) | REGEX | node name |
| 21 | web/src/lightmap.js:646-653 | unit <-> mesh match: by `lmId` + vertex count, then leftovers by vertex count and bbox (<0.006 m total) | FLAG then COORD | skips `lmSkip` and `batched` |
| 22 | lightmap.js:660-668 `doorParts` | leaves of hinged/bifold doors lose their lightmap in every pose and go probe-lit (sided) | FLAG | `root.userData.door.kind` not in {`french`,`slider`}, `o.parent !== root`; roots = `dynamic` arg |
| 23 | lightmap.js:670-678 `sharedUV` | meshes sharing geometry+material demoted to probes unless sidecar says `ownPrimitives` | HIER/data | sidecar header |
| 24 | lightmap.js:680 | every lightmapped mesh `castShadow=true` | blanket | |
| 25 | lightmap.js:682-683,686 | lightmap clone only for `isMeshStandardMaterial`; other types stay raster | MATPROP | |
| 26 | lightmap.js:733 | glass does not cast sun shadow: `transmission>0 \|\| userData.daylightOpacity!==undefined \|\| (transparent && opacity<0.6)` (first material of the mesh only) | MATPROP + FLAG | duplicated verbatim at web/src/webgpu/materials.js:62 |
| 27 | lightmap.js:743-758 `register` | **everything else** that is MeshStandard, has no `lightMap`, is not a fog volume -> `probeLit`; emission zeroed unless `emitsLight` | MATPROP | per material, not per mesh |
| 28 | lightmap.js:743 `sided` | which probe-lit materials look up the probe 0.5 m "out" on the face side (doors, blinds, curtains, garage door) | HIER | materials of every mesh under `dynamic` roots that are not lightmapped/transparent/transmissive. **Per material**: a material shared with a static mesh gets sided for both |
| 29 | lightmap.js:773-784 | statistics-only "why unlit" classification: `transmission>0\|\|transparent`='glass'; `alphaTest>0 \|\| /^(garden-\|plant)/`='plant'; else door/sharedUV/lmSkip/dynamic/skipped[id]/unmatched/nobake | MATPROP + REGEX | **reporting only**: it is the only place that tries to name the role, and it is not used for behaviour |
| 30 | lightmap.js:640, main.js:136-137 | which subtrees track sun shadows (see 1F) | HIER | `movables` + `dynamic` (doors + animated-with-toggle) |
| 31 | web/src/foliage_bake.js:49 `isPlant` | which meshes get baked per-vertex foliage light: material name `/^plant/`, non-instanced, single material | REGEX | **not** `garden-`, **not** alphaTest |
| 32 | foliage_bake.js:92-114 | frozen LOD copies inherit data from their sources or vice versa | HIER (`name==='frozen' && userData.batch`) | |
| 33 | bake/scripts/foliage_bake.py:38,44,68 | plant units = material name startswith `plant`; `garden-*` "instanced at run time" left out (comment) | REGEX(prefix) | glTF material name |
| 34 | web/src/webgpu/assets.js:55-80, webgpu/materials.js:38-45 | WebGPU port re-implements matching and the plant test | duplicate | see 3.x |
| 35 | web/src/webgpu/scene.js:10-33 | copy of lighting.js interior/exterior material split "kept in sync" by comment | COORD duplicate | |
| 36 | web/src/lighting.js:285-291 | interior vs exterior copy of each material: inside plan polygon AND `center.y < ceiling+0.05` AND bbox <17 x <13 m; forced exterior for `{M.stucco, M.soffit, M.roof}` or `userData.exteriorFinish` (garage.js:205) | COORD + ID(material) + FLAG | affects batch keys, so affects ids |
| 37 | lighting.js:258-268 | `inside()` (plan polygon with porch notch) and `indoorWeight` (a *different* box: front -5.74/-4.66, x -7.9..7.91, y to 5.47) | COORD | |
| 38 | web/src/daylight.js:36-52 (legacy raster only) | which meshes are "walls" for the daylight volume: `m === wallPaint \|\| m === stucco \|\| (roughness===0.94 && !map)`; "contacts" exclude movable/toggle/`name==='house'`, centre outside x +-8, z -5.5..5.8, y>2.4, or thin | ID(material) + magic roughness + COORD | |

### 1B. How a probe-lit material is lit

All in `probeLit` (lightmap.js:1283-1324) unless noted. It runs once per *material*.

| # | file:line | decides | mech | inputs |
|---|---|---|---|---|
| 39 | lightmap.js:1286 `leafSide` | leaf normal times `faceDirection` (two-sided cards) | REGEX | `/^garden-/` on material name |
| 40 | :1287 `foliage` | foliage treatment on | MATPROP + REGEX | `alphaTest>0 \|\| /^(garden-\|plant)/` |
| 41 | :1288 `occl` | foliage ground occlusion `mix(0.45,1,smoothstep(0,1.2,y))` unless baked foliage | derived from 40 | `!material.foliageBake` |
| 42 | :1289 `wet` | wet patch + puddle shader | REGEX + MATPROP | volume.multi/wet>0 && not `^garden-` && not alphaTest>0 (note: `plant-*` opaque stems DO get wet; `garden-*` does not) |
| 43 | :1290 `sheer` | translucent cloth shading (`sheerProbePatch`, materials.js:279) | FLAG | `userData.sheer` (decor.js:115 only) |
| 44 | :1290 `fol` | baked per-vertex foliage | FLAG set at runtime | `material.foliageBake` (foliage_bake.js `loadFoliage` clones the material) |
| 45 | :1290,1143 `isMirror` | mirror reflection at full strength, tighter probe margin | REGEX/ID | `material.name === 'mirror'`; producers: materials.js:134, props_rooms.js:351 |
| 46 | :1291 `side` | sided lookup | derived | `sided && !sheer && !fol && !leafSide` |
| 47 | :1313 | specular occlusion for reflections: `1.0` for mirror else irradiance luminance | derived from 45 | |
| 48 | lightmap.js:1350 `addWindowReflections` | additive Fresnel sky overlay on a pane | FLAG + MATPROP | `userData.daylightOpacity!==undefined \|\| transmission>0` (a third glass test, differing from 26 and 29) |
| 49 | lightmap.js:1144-1163 `reflPatch` | every baked or probe-lit material gets box-projected reflection probes and clearcoat IBL replacement (no role switch: only `mirror` varies) | blanket | |
| 50 | lightmap.js:84-90 + 682 `weatherClass`, :87-93 | wet class `null` / `plant` / `ground` / `outdoor` per *mesh*: centroid outside plan or span>40 -> null; `^garden-` or alphaTest>0 -> plant; `max.y<0.35` -> ground; else outdoor | COORD + REGEX + MATPROP | bbox, `insidePlan` |
| 51 | lightmap.js:693 `puddles` | puddle shader on lightmapped materials: `(multi \|\| wet>0) && cls !== 'plant'` | derived | |
| 52 | lightmap.js:94-95 (GLSL) | per-pixel "outside the house" for wetness | COORD (GLSL copy of insidePlan) | |
| 53 | web/src/puddles.js:66-77,169-193 | planar puddle reflection: `wetMaterial` = Standard, not `^garden-`, no alphaTest; skipped for `^garden-turf` mesh name, hidden/batched/lightHit; budget tier 1 plants `alphaTest \|\| /^(garden-\|plant)/` , tier 2 "indoors(box)" | REGEX + COORD | own copy of `insidePlan` |
| 54 | web/src/contact.js:171-173 | contact AO depth pass: excludes transparent/transmissive/alphaTest/`^(garden-\|plant)`; :179 hides `cat-blob`/`dog-contact-shadow` by name | MATPROP + REGEX | |
| 55 | web/src/photo.js:174-181 + 183-190 `weatherClass`/`wetMaterial` | the path tracer's copy of 50 (plant = `^garden-` or alphaTest; ground roughness floor 0.07 vs 0.06; outdoor colour x0.88 vs x0.85) | REGEX + COORD | |
| 56 | bake/export/setup.py:16-53 | Cycles scene: `inside()` copy; per material: Transmission>0.5 and no `sheer` key -> `glass`; else if outdoors: `Alpha` linked or <0.99 **or** name startswith `garden-` -> `plants`; `zmax<0.35` -> `ground`; else `outdoor` (NOT `plant-*` by name; `alpha<0.99` also catches non-plant translucent props) | MATPROP + REGEX + COORD | |
| 57 | setup.py:121-161 | glass made transparent for shadow/diffuse rays; sheer cloth rebuilt as translucent: `'sheer' in m.keys()` or (sheen>0.2 and alpha<0.99 and transmission<=0.5) heuristic for old exports | FLAG + MATPROP | |
| 58 | web/src/main.js:209-216 | alphaToCoverage on `alphaTest>0 && !transparent` | MATPROP | |
| 59 | bake/scripts/reflprobe.py:44-58 | reflection-probe box rays pass through "see-through" surfaces: `name=='mist'`, hide_render, `'sheer'` key, transmission>0.5, alpha linked or <0.99 | MATPROP + FLAG + ID | third alpha/glass test |
| 60 | bake/scripts/reflprobe_layout.py:24-41 | probe grid, `POINT_FIX`, `EXTRA`, `ANNEX={'garage': (-7.903,-3.507,-5.735,0.156)}`, `room_of` by plan polygons/notes | COORD TABLE | `web/data/house.json` + hand constants |
| 61 | web/src/layout.js:466 `addMirrors` | which meshes get a planar mirror reflector (hq.js createMirror): any mesh with a material named `mirror` | REGEX/ID | |
| 62 | web/src/lighting.js:418, 467 | `userData.probeLit` marks materials excluded from raster env updates / pet sync | FLAG set by 27 | |

### 1C. Does it emit light, and how is emission driven

| # | file:line | decides | mech | inputs |
|---|---|---|---|---|
| 63 | materials.js:266 `emitsLight` | the single predicate: `userData.lightGlow \|\| userData.emits` | FLAG | used by lightmap.js (689,692,752), lighting.js:329, photo.js:157 |
| 64 | `emits:` producers | 16 `'lamp'`, 6 `'screen'`, 3 `'indicator'`, 2 `'fire'` (outdoor.js:19,44) at material creation sites (decor.js:21-51, house.js:159, kitchen_parts.js:134-143, garage_parts.js:193-201, props_rooms.js:55,111, props_living_parts.js:160-161, dining_parts.js:230,234, bedrooms_parts.js:232, outdoor.js:404,412, bath_parts.js:81, materials.js:180-181) | FLAG | |
| 65 | `bake/export/setup.py:188-207` | Cycles emission: `source(m)` = extras has `lightGlow` or `emits`; others zeroed; strength x2.5 (cap 4) only if colour>0.3 and (`lightGlow` or `emits=='lamp'`); screens/indicators/fire keep raw strength; fallback to "every warm emissive x2.5" when no markers | FLAG | glTF material extras |
| 66 | `layer_lights.py:59-63` | all emission zeroed unless layer is `lamps`; in a lamp-group bake only materials whose `lamp_group` custom prop == group stay lit (screens/indicators with no `lamp_group` are off in group bakes) | FLAG (`lamp_group`) | |
| 67 | `lamp_groups.py:112-135` | which surfaces belong to a group: any mesh with emissive slot; nearest switch glow centre within 0.3 m, else `always`; shared materials duplicated per group; surfaces within 0.3 m also stop casting shadows | COORD (0.3 m) | glow centres from switch_groups.mjs |
| 68 | light_switch.js:4 `glowing` | which meshes of a fixture are switched lamp surfaces: `emissive.getHex()!==0 && emissiveIntensity>0`, or additive blending (:149) | MATPROP | independent of `emits`: any emissive mesh inside a candidate fixture is captured, even a screen |
| 69 | light_switch.js:57-67 | clones the material, marks `lightGlow=true`, sets `noBatch/noHighlight` on mesh, `wash` (additive glow card) driven through `opacity` instead of emissive | FLAG | |
| 70 | light_switch.js:55,74-97 `switchLight` | glow level rule: `wash`/`always` -> base; dusk -> base*1.8; `day` -> base; else 0.12; lights: always/exterior ->1, dusk ->5, else `userData.day ?? 0.2`. `always` option is **never passed** and `light.userData.always` is **never set** anywhere (dead) | derived | `exterior` (REGEX), `day: spec.day!==undefined` |
| 71 | lamp_groups.js:161-163 `applyGlow` | in baked mode overrides 70: glow = `base*1.8*level` (wash: `base*level`) for every switch regardless of `exterior`/`day`/`always` | derived | |
| 72 | lightmap.js:637,689,692 | lightmapped clone of an emitting material follows the *slot lamp level* (`e.base*level`) unless its source is `lightGlow`; non-emitting clones zeroed | FLAG | `emissionCopies` |
| 73 | lightmap.js:750-753 | probe-lit emitting materials keep their raw `emissiveIntensity` (no slot lamp level); so a `lamp` surface that is lightmapped follows the slot level but one that is probe-lit does not | FLAG | |
| 74 | lighting.js:318,327-331,383 | raster: `emissives` = all emissive non-`lightGlow` materials, lifted to 0.12 by day / x1.8 at dusk; `physicalEmission()` removes the non-emitting ones | FLAG | |
| 75 | photo.js:153-160, 397-402 | tracer: non-`emitsLight` emissives zeroed; `lightGlow` materials re-tinted to lamp colour temp, level = `mood.lamps * toggle.value` | FLAG | |
| 76 | hq.js:168 | reflection-proxy merge excludes `userData.lightGlow` materials | FLAG | |
| 77 | the **niche can**: house.js:156-166 builds Group `name='niche-recessed-can'` (not a placed fixture: no `placement`, no `light` spec, no `id`) with `emits:'lamp'` lens and a SpotLight child; light_switch.js:125 (candidate by `o.name`), :130 (`niche`), :135 (collect lights by traversing the can), :151-152 (label), :11 (WALL_SWITCHES id string), lamp_groups.py:40 (`i == 'niche-recessed-can'` -> group `livingNiche`), lights.mjs / layout.js addLight never see it (its light is a child of the can, not in `fixtures`) | NAME x5 | |
| 78 | light_switch.js:125 | which objects are switchable fixtures: `userData.light \|\| userData.lightFixture \|\| /^props-rooms-(linen\|egg)-lamp$/.test(id) \|\| name==='niche-recessed-can'` | FLAG + REGEX + ID | |
| 79 | light_switch.js:131-139 | its live lights: those within 1 cm of `spec.y` point and unassigned; niche children; `id==='decor-wall-light-black'` also takes the `'Porch sconce source'` light by name; `id==='nightstandPine'` -> owner = child with `userData.bulbY` | ID + NAME | |
| 80 | light_switch.js:140-147 | track light: one switch per head child group; first head owns the light | ID | |
| 81 | layout.js:430,450 | live light created from `userData.light` unless `placement.light===false`, max 16 | FLAG + count cap | `placement.bake` marks bake-only lamps (lights.mjs:35) |
| 82 | lighting.js:272-275 | porch sconce source light is created by name `'Porch sconce source'`, `userData.exterior=true`; **only** this light carries `exterior` | NAME | |
| 83 | setup.py:165-186, lights.mjs:27-38 | which lights enter Cycles: skip if name contains `fire` or `sconce` (case-insens.); RectArea 35/60 W by intensity<100; Spot 70 W; Point 30/55 W; `bakeOnly` x0.17 | REGEX + magic numbers | `lights.json` |
| 84 | photo.js:333-360 | which Three lights are physical in the tracer: in `fixtures`, or `userData.lightSwitch`, or parent id `'outdoor-fire-pit'`; level `exterior`/`always`/`day` | HIER + ID | |

### 1D. Lamp group / switch membership

| # | file:line | decides | mech | inputs |
|---|---|---|---|---|
| 85 | light_switch.js:8-30 `WALL_SWITCHES` | 21 wall plates: (name, x, y, rotation, fixture id, target x, target y); plate reuses the fixture's toggle if a fixture with that id is within 0.06 m of the target (:36-40) | TABLE: ID + COORD | |
| 86 | light_switch.js:138 | exterior flag `/porch\|wall-light-black\|outdoor-front-lamp/` on fixture id | REGEX | duplicated verbatim in bake/export/switch_groups.mjs:40 |
| 87 | bake/export/switch_groups.mjs:30-45 | the switch -> bake record: key `id@x,y,z` (2 decimals), id, `exterior` (re-derived by regex, not read from the toggle), lights, spec, glows | ID + COORD | |
| 88 | lamp_groups.py:19-27 `ROOMS`/`room(p)` | 13 hand-copied room rectangles (comment: "web/src/pets/roam.js ROOMS"); first rectangle containing `where(s)` wins; gaps return `'outside'` | COORD TABLE | `where(s)` = first live light, else spec point, else mean glow, else root |
| 89 | lamp_groups.py:37-46 `group_of` | exterior -> `porch`; id `niche-recessed-can` -> `livingNiche`; living: `decor-track-light` with `abs(root.x-0.2)<0.3` -> `livingCenter`; kitchen: `kitchen-pendant` -> `kitchenPendant`, `'kitchen-west-run' in id` -> `kitchenCabinet`; closets: `-6.25<=x<=-4.93` -> `closet` else `primary`; primary: `'props-rooms' in id` -> `primaryLamps`; bedroomB/bedroom3: `nightstandPine` or `'props-rooms'` -> `<room>Lamps` | ID substring + COORD | |
| 90 | lamp_groups.py:47 `ORDER` | the closed list of 22 group names (index = texture channel) | TABLE | `room()` returning a name not in ORDER (e.g. `'outside'`) raises ValueError |
| 91 | lamp_groups.py:81 | `lit` (was it a lamp in the earlier bake): `track-light` at `|x-3.0|<0.3 and |y+2.35|<0.6` special coordinate | COORD | |
| 92 | lamp_groups.py:105-107 | fallback wattage by id substring (`kitchen-west-run` hood 10 W spot, `garage` opener 15 W, else 30 W) | ID substring | |
| 93 | lamp_groups.py:113-123 | surfaces to groups by nearest glow < 0.3 m else `always` | COORD | |
| 94 | lamp_groups.js:15-29 `DEFAULT_ON`, `ALWAYS_DEFAULT` | per-slot default switch states by group *name*: sunrise `['kitchenPendant']`, noon `[]`, golden `['living','livingNiche','kitchenPendant','dining']`, dusk `'*'`; garage always on; `group.always` always on | NAME TABLE | group names from lamp_groups.py ORDER |
| 95 | lamp_groups.js:87-101 | runtime switch -> group: fixture id + plan position within 0.05 m of `members[].root` | ID + COORD | members written by switch_groups.mjs / lamp_groups.py |
| 96 | lamp_groups.js:132-138 | a press changes all members of the group; `always` group not switchable | derived | |
| 97 | lightmap.js:1039-1057 | lamp reflection layers matched to groups by name | NAME | |
| 98 | bake/scripts/lamp_groups_pack.py:84 | `gains` by group name (CLI) | NAME | |
| 99 | web/src/pets/roam.js:38-46 | the original ROOMS table (pets) | COORD TABLE | |

### 1E. Sun shadow casting/receiving and PCSS tracking

| # | file:line | decides | mech | inputs |
|---|---|---|---|---|
| 100 | lightmap.js:680 | all lightmapped meshes cast | blanket | |
| 101 | lightmap.js:733 | glass-like meshes don't cast (first material only) | MATPROP + FLAG | duplicate of webgpu/materials.js:62 |
| 102 | kit.js:10 `shadow()`, house.js:80,165,361,487,489,633 | per-object `castShadow`/`receiveShadow` set at build (e.g. house.js:80 `castShadow=false`) | hand-set at build | then overridden by 100 |
| 103 | lightmap.js:640, main.js:136-137 | tracked (re-checked every frame) subtrees = `layout.movables` + doors' groups + `animated` roots that have `userData.toggle`; pets/human via `register` with `always` | HIER | `layout.js:427` movable list; `dynamic` computed in main.js |
| 104 | lightmap.js:193 `isPlantRoot` | plant caster that is never promoted: id `/^(plants\|garden\|flowers)-/` on any ancestor | REGEX ID | |
| 105 | lightmap.js:201 `e.plant` | `alphaTest>0 \|\| /^(garden-\|plant)/` on material name, OR `isPlantRoot` | REGEX + ID | |
| 106 | lightmap.js:200,204 | classification into dynamic/static: castShadow, skinned, in `roots`, promoted by the 4-second slow scan | runtime | |
| 107 | lighting.js:432 | raster path refresh flag `sun.userData.bakedShadow` | FLAG | |
| 108 | contact.js:162-180 | which movables (`movables` arg), pets, human get a contact proxy | HIER | |

### 1F. Reflection behaviour (summary)

Mirror: name `'mirror'` (45, 61). Glass: 3 tests (26, 29, 48). Reflection probes apply to everything (49); occlusion
differs only for mirror. `clearcoat`: handled by blanket replacement in reflPatch/probeLit (lightmap.js:1160,1310) and
stripped in the tracer (photo.js:138-140). Hard reflection data: reflprobe_layout.py (GRID, POINT_FIX, EXTRA, ANNEX).
Planar puddle reflection eligibility: 53. Window overlay: 48.

---------------------------------------------------------------------------------------------------------------------

## 2. Hard-coded names, ids and coordinates used for lighting decisions

### 2A. Name / id patterns

| pattern | where | meaning |
|---|---|---|
| `/^garden-/` (material name) | lightmap.js:43 (weatherClass),1286,1289; puddles.js:73; photo.js:178; webgpu/materials.js:39; setup.py:47; unwrap.py:76 | grass / leaf cards (grass.js:225 `'garden-'+opts.name`) |
| `/^(garden-\|plant)/` | lightmap.js:201,777,1287; puddles.js:193; contact.js:173; webgpu/materials.js:42; unwrap.py:76 | plant (22 regex sites for the plant family overall) |
| `/^plant/` | foliage_bake.js:49; foliage_bake.py:38,44,68 | baked-foliage plants (`plant-` from plants_parts.js:319,323) |
| `name.startswith('garden-')` only | setup.py:47 | Cycles "plants" wet class (no `plant`) |
| `/^garden-turf/` (mesh name) | puddles.js:169 | no planar reflection for turf |
| `/^(plants\|garden\|flowers)-/` (object id, ancestors) | lightmap.js:193 | PCSS: never promote |
| `/^(plants\|flowers)-\|garden-(blue\|black\|nursery)/`, `/^outdoor-/`, `/lamp\|umbrella/` | minimap.js:58-59 | minimap only (not lighting), same family of guesses |
| `'mirror'` (material name) | materials.js:134; props_rooms.js:351; lightmap.js:1143; layout.js:466 | mirror |
| `/flame/i` (material name) | photo.js:133 | fire shader exported as emitter |
| `/^(cat-blob\|dog-contact-shadow)$/` (object name) | photo.js:19; contact.js:179 | presentation-only meshes |
| `'frozen'` + `userData.batch` | foliage_bake.js:92; puddles.js:94,172; lightmap.js | far LOD copy |
| `'niche-recessed-can'` | house.js:156; light_switch.js:11,125,130; lamp_groups.py:40 | the alcove can |
| `/^props-rooms-(linen\|egg)-lamp$/` | light_switch.js:125 | bedside lamps as fixtures |
| `'nightstandPine'` | light_switch.js:22,26,139; lamp_groups.py:45 | owner lookup + Lamps group |
| `'decor-track-light'` | light_switch.js:9,10,13,16,140; lamp_groups.py:41,81,82 | head-per-switch + centre group + `lit` hack |
| `'decor-recessed-light'`, `'decor-wall-light-black'`, `'kitchen-pendant'`, `'dining-pendant'`, `'garage-shopLight'`, `'kitchen-west-run-b'`, `'props-rooms-egg-lamp'` | light_switch.js:8-30 | WALL_SWITCHES |
| `'Porch sconce source'` | lighting.js:273; light_switch.js:136 | the porch light |
| `/porch\|wall-light-black\|outdoor-front-lamp/` | light_switch.js:138; switch_groups.mjs:40 | exterior flag |
| `'kitchen-west-run' in id`, `'props-rooms' in id`, `'garage' in id` | lamp_groups.py:42,44,45,105,106 | group/wattage |
| `'fire'`, `'sconce'` (light name substrings) | setup.py:166 | lights skipped in Cycles |
| `'outdoor-fire-pit'` (parent id) | photo.js:349 | fire light |
| `'house'` (object name) | daylight.js:37,48 | legacy |
| `'d8425baf7a'` (door id) | export.mjs:23 | bake-open door |
| `^movable` (node/object name) | layer_lights.py:58 (names from unwrap.py:104,115) | hidden in bake |
| `lampgrp\d\d_*`, `lamp*` (Blender object names) | layer_lights.py:46,54; lamp_groups_render.py:12; reflprobe.py:130,141,143 | light naming protocol |
| `'sunrise'` | lightmap.js:560; make_tasks.py:16-17 | lamps layer lives only in this slot |
| `M.wallPaint, M.stucco, M.soffit, M.roof` | daylight.js:41; lighting.js:124 | material identity |
| `roughness === 0.94 && !map` | daylight.js:41 | "wall paint" by magic number |

### 2B. Coordinate ranges / boxes

| value | where | meaning |
|---|---|---|
| `x < -3.5 \|\| x > 3.97 ? -5.94 : -4.82`, `x -8.1..8.1`, `y ..5.62` ("insidePlan") | **9 copies**: lightmap.js:39 and :94 (GLSL), lighting.js:260, puddles.js:66, photo.js:168, volumetric.js:21 (GLSL), webgpu/scene.js:17, setup.py:17, unwrap.py:126, make_tasks.py:25, reflprobe_layout.py:25 | inside the house plan for wetness, texel class, probe grid, region split |
| `-8.1,-5.62, 16.2 x 2.44 x 11.56` | daylight.js:10,131 | volume extents |
| indoorWeight box `-5.74/-4.66, x ±7.9, y 5.47` | lighting.js:265 | exposure adaptation |
| `abs(cx)>14, -cz>18, -cz<-14, area>300` | unwrap.py:118 | ground/far |
| `width bbox<17, depth<13, y<ceiling+0.05` | lighting.js:285; webgpu/scene.js:18 | interior material copy |
| `max.y<0.35` | lightmap.js:44; photo.js:179; setup.py:49 | "ground" |
| `span>40` | lightmap.js:42; photo.js:177; setup.py:35 | huge plane = ground-like, no class |
| 13 room rectangles (kitchen, living, dining, family, primary, primaryBath, bedroomB, bathB, hallBath, bedroom3, hall, garage, closets) | lamp_groups.py:20-23; roam.js:38-41 (copy) | group by room |
| `-6.25<=x<=-4.93` | lamp_groups.py:43 | closet vs primary |
| `abs(root.x-0.2)<0.3` | lamp_groups.py:41 | livingCenter track |
| `abs(root.x-3.0)<0.3 and abs(root.y+2.35)<0.6` | lamp_groups.py:81 | track light that was lit in the old bake |
| plate positions (21 rows) | light_switch.js:8-30 | wall switches |
| match tolerances 0.06 m (plate), 0.05 m (lamp_groups.js:93), 0.3 m (surface), 0.01 (live light), 0.006 (unit bbox) | various | |
| `VOL = x -12.5..12.5, y -11.5..15.5, step 0.5, heights 0.35/0.95/1.55` | lightmap.js:1170 | probe volume; make_tasks.py:23-36 builds the points with different constants (0.5 grid -7.85.., outside 1 m grid -12..12 / -11..15) |
| probe grid / reflection grid constants | make_tasks.py:28-36; reflprobe_layout.py:29-41 | |
| `BAKE_OPEN`, `MIN_TEXELS=16`, `SCALE={...}`, `TPU=64` | export.mjs:23; unwrap.py:149-154 | |

---------------------------------------------------------------------------------------------------------------------

## 3. Inconsistencies and latent bugs

Ordered by how likely they are to cause the "new object falls through a different combination" class of bug.

1. **The plant family is defined at least six different ways.**
   - `^(garden-|plant)` OR alphaTest>0: probeLit foliage (lightmap.js:1287), PCSS `e.plant` (:201), contact (contact.js:173), puddle tier (puddles.js:193), unlit stats (:777), WebGPU (materials.js:42).
   - `^garden-` only: leafSide (:1286), wet exclusion (:1289, puddles.js:73), weatherClass (:43, photo.js:178), WebGPU leaf normal (materials.js:39).
   - `^plant` only: baked foliage (foliage_bake.js:49, foliage_bake.py:38,44,68).
   - Cycles wet class: Alpha<0.99 (any outdoor translucent prop) OR `garden-` (setup.py:47); `plant-*` opaque stems count as `outdoor`, translucent non-plants as `plants`.
   - unwrap.py skip: MASK OR `garden-`/`plant`.
   - PCSS: `isPlantRoot` by ancestor id (`plants-`, `garden-`, `flowers-`).
   Consequence: any alphaTest prop that is not a plant (bath `net` bath_parts.js:104, garage `net`, `rattanLattice`, `fern`, lantern/props_rooms alpha cards) is treated as a *plant*: gets the foliage ground-occlusion factor `mix(0.45,1,smoothstep(0,1.2,y))` indoors (lightmap.js:1288), "plant" wet class, no contact AO, and is excluded from the lightmap (unwrap.py MASK rule). `plant-*` stems/trunks without alpha are excluded from lightmap (name) but included in "wet" shader and not in the foliage factor if opaque and `foliageBake` absent: `foliage=true` by name (so they do get the occlusion factor).

2. **Three different glass tests** (and a fourth in the bake):
   - cast-shadow: `transmission>0 || daylightOpacity!==undefined || (transparent && opacity<0.6)` (lightmap.js:733, webgpu/materials.js:62);
   - window reflection overlay: `daylightOpacity!==undefined || transmission>0` (lightmap.js:1350);
   - stats 'glass': `transmission>0 || transparent` (lightmap.js:777; catches sheers, paper, translucent cards too);
   - unwrap.py: KHR transmission only (works only because photo.js:149 rewrites `daylightOpacity` panes into transmission glass and :141-148 rewrites `sheer` into transmission; plain `transparent` materials such as `M.paper` or the translucent `outdoor.js:404` lantern glass are *not* skipped and get a lightmap unit);
   - setup.py glass: Transmission>0.5 and not `sheer`; reflprobe.py see_through: transmission>0.5 or alpha<0.99 or `sheer`.
   A `transparent` lantern pane (outdoor.js:404, `emits:'lamp'`, opacity .19) is "glass" for the shadow test (opacity<0.6) but is not window-reflection glass, not unwrap glass, and carries an emission marker.

3. **Exterior regex and room boxes are copy-pasted, not shared.** `/porch|wall-light-black|outdoor-front-lamp/` is identical in light_switch.js:138 and switch_groups.mjs:40 today, but nothing enforces it; a new exterior fixture needs both edited (and `lamp_groups.js` has no notion of exterior: it only reads `group.exterior` written by Python for stats). The runtime sconce light is the only light carrying `userData.exterior` (lighting.js:274), so in the raster path (lighting.js:410) the layout-created lights of `outdoor-porch-light`/`outdoor-front-lamp` take the interior rule (dusk x5, day 0.2) while their *switch* uses the exterior rule: different multipliers for the same fixture.

4. **Room boxes vs house.json.** `ROOMS` in lamp_groups.py:20-23 (and a second copy in pets/roam.js:38-41) are hand rectangles. house.json has 11 room polygons with hashed ids and no names, and one big L-shaped polygon (`abee09795a`) covering kitchen+living+dining+family, so the box split (x=-0.8, x=0.42, y=1.6/1.7/1.95) cannot be derived from the data. Concrete gaps: polygon `f84658a5fa` (x 5.10..7.91, y -2.03..-1.39) lies in none of the boxes (bedroom3 ends y -2.14, hallBath starts y -1.27): `room()` returns `'outside'`, and `ORDER.index('outside')` would raise. Room tests key on the *light* position (or fixture spec point at ~2.3 m), not the fixture. The closet boundary `-6.25..-4.93` is a bare coordinate. reflprobe_layout.py's `ANNEX['garage']` (-7.903,-3.507,-5.735,0.156) and the lamp_groups `garage`/`closets` rectangles (-7.9,-3.507,-5.74,0.16 / 0.16..1.6) agree only by hand. lighting.js indoorWeight (-5.74/-4.66, 7.9, 5.47) is a fourth interior box.

5. **WALL_SWITCHES names vs `group_of`.** The plate table names (`living`, `kitchenCabinet`, `primaryLamps`...) *look* like group names but the plate only uses the name for the object label; the real group is recomputed in Python from rooms and id substrings. They can silently diverge (e.g. adding a plate named `hall` for a fixture that `group_of` places in `bathB`). `DEFAULT_ON`/`ALWAYS_DEFAULT` in lamp_groups.js name groups by string; a typo or rename in `ORDER` changes defaults with no error (and `livingCenter`, `kitchen`, `family`, `primary`... are not in `DEFAULT_ON['golden']` by design but nothing documents it).

6. **Porch group has no bake lamp (probable).** setup.py:166 skips lights whose name contains `sconce` (the `Porch sconce source`), but switch_groups/light_switch.js:136 attach exactly that light to the porch switch (`s['lights']`). In lamp_groups.py:89-94 a switch with live lights never reaches the `spec`/`glows` fallbacks, `old_at(L['p'])` finds nothing, and prints "no bake lamp": the `porch` group gets zero Cycles lights (surfaces only). Worth verifying in the lamp group json.

7. **Emission level is driven in four places and they disagree.**
   - light_switch.js `apply` (0.12 / base / 1.8x / `day`), lamp_groups `applyGlow` (always 1.8x), lighting.js applyTime (0.12/1.8x for non-`lightGlow` emissives), lightmap `emissionCopies` (base*slot lamp level), probe-lit emitting materials (raw intensity).
   - So an `emits:'lamp'` material not under a switch (dining lantern paper, garden lantern, props_living glow, bedside lamps not in the 3 whitelisted ids) glows at raster level in probe-lit objects, at `base*lampLevel` on lightmapped meshes, and is in group `always` in Cycles (lamp_groups.py:122) but is NOT in any runtime switch group.
   - `glowing()` (light_switch.js:4) takes any emissive mesh in a candidate fixture, whether or not it is `emits`; `emitsLight` takes any marked material whether or not it is in a fixture. The two sets are not the same.
   - `always`/`light.userData.always` are dead code (light_switch.js:55,67,88,93; lighting.js:410; photo.js:343).

8. **The niche can is special-cased by name in five places** (house.js:156, light_switch.js:11,125,130, lamp_groups.py:40) because it is not a placed fixture (no `userData.id`, `placement`, or `light` spec, light is a child, not in `fixtures`). Its Cycles light comes from the spot child through lights.json (lights.mjs reads every non-window light), while switch_groups.mjs has `spec: null` for it.

9. **`sided` is per material, not per mesh** (lightmap.js:743): a material used by both a door leaf and a static probe-lit mesh (shared `M.trim`, `M.doorWhite`) switches both to the 0.5 m outward lookup. `probeLit` is `once per material` (`material.userData.probeLit`), so `isMirror`, `sheer`, `wet`, `leafSide` are all frozen per material. The batch step splits materials by region (lighting.js:291) but not by role.

10. **`weatherClass` for lightmapped meshes reads only the first material** (`[].concat(o.material)[0]`, lightmap.js:682), and the glass test (733) and the unlit stats (777) do the same; multi-material meshes use mixed rules.

11. **insidePlan has nine copies** (list in 2B) including two GLSL copies and four Python copies. Tolerances differ in use: puddles' `indoors()` insets 0.25 m, outside-triangle logic 0.1/0.15 m, wetness mask is per pixel in GLSL but per mesh centroid in `weatherClass` and in setup.py (a mesh whose centroid is inside but extends out is entirely dry in Cycles/lightmap, per-pixel wet in probe-lit materials).

12. **Wetness constants differ between the three implementations** (lightmap.js:84-90: ground rough floor 0.06 / outdoor colour x0.85; photo.js:187-189: 0.07 / 0.88; setup.py:107-119: floor 0.06 / 0.85, plant roughness floor 0.12 vs 0.12/0.15).

13. **Lightmap eligibility is decided in three places that must agree and don't share code:** batch.js (which meshes get ids), unwrap.py (which ids get units, using glTF material features that photo.js manufactured), lightmap.js (which units attach). A new object falls through if it is: transparent+opaque-looking (not skipped by unwrap, has no transmission), or mixed (one MASK material in a multi-material mesh: `all(material_skip(...))` only skips when *all* parts qualify, while JS checks only `[0]`).

14. **Door/leaf demotion is hierarchy-driven and partly duplicated:** `doorParts` demotes any mesh whose parent is not the door root; `BAKE_OPEN` bakes one door open by id. French/slider keep the bake. A new door `kind` falls into the demotion rule silently.

15. **Wet patch eligibility** (lightmap.js:1289) allows `plant-*` stems and `mirror`, glass-free probe-lit materials, but `puddles` (puddles.js:73 `wetMaterial`) excludes only `garden-`/alphaTest: the planar puddle patch and per-pixel wet patch can disagree on what is wet. `wetPatch` is not applied when `cls === 'plant'` but is applied to every other outdoor material by position in the shader.

16. **Duplicated code paths for WebGPU** (webgpu/assets.js `matchUnits`, webgpu/materials.js plant/glass tests, webgpu/scene.js region split) have already drifted: glass test identical, plant test same as lightmap.js:1287, but the region split carries a "keep in sync" comment and the interior rule lacks nothing today.

17. **`unwrap.py` `ground/far` coordinate box** (`|cx|>14`, `-cz>18`, `-cz<-14`) vs the probe volume (`x ±12.5`, `y -11.5..15.5`) vs `make_tasks.py` outside grid (`x -12..12`): an object between the three limits is not lightmapped and also outside probe coverage (probes clamp at the volume edge).

18. **Legacy fallbacks that cause surprises:** `scene/movables.json` matching (unwrap.py:30,114) only when ids are absent; `emissive` markers fallback "every warm emissive x2.5" (setup.py:192-196); `is_sheer` heuristic for old exports (setup.py:137-139).

---------------------------------------------------------------------------------------------------------------------

## 4. Proposed single "lighting role" schema

One declaration, set where the object/material is built, stored in `userData.lighting` (runtime) and written to glTF
extras (node extras for object-level, material extras for material-level) by the exporter. Everything else (JS runtime,
unwrap.py, setup.py, lamp_groups.py, foliage_bake.py, reflprobe.py, photo.js) reads these fields instead of re-deriving
them. Defaults come from a small set of **presets** so objects rarely write more than `role`.

### 4A. Object level (`mesh.userData.lighting` or inherited from the nearest ancestor that declares it)

```
lighting: {
  role:   'architecture' | 'furniture' | 'plant' | 'ground' | 'glass' | 'cloth' | 'mirror' |
          'emitter' | 'door' | 'presentation' | 'movable',
  bake:   'lightmap' | 'probe' | 'none',          // default from role; 'lightmap' only for still geometry
  motion: 'static' | 'toggle' | 'animated' | 'movable' | 'pet',   // replaces userData.toggle/animate/movable sniffing and stillParts for pieces that declare their still parts
  stillParts: 'auto' | [names],                   // which parts of a moving root hold still (replaces stillParts() probing)
  probeSide: 'none' | 'face',                     // 'face' for doors/blinds/curtains (replaces `sided`)
  sun: { cast: bool, receive: bool, track: 'static' | 'hot' | 'plant' },  // replaces blanket castShadow=true, glass rule, isPlantRoot, movables/dynamic arrays
  weather: 'none' | 'ground' | 'plant' | 'outdoor' | 'auto',  // 'auto' = today's centroid/height rule, computed once in one function
  group:  'living' | 'kitchenPendant' | ... | null,           // lamp group of every emitter/fixture beneath (see 4C)
  zone:   'interior' | 'exterior',               // replaces plan-polygon splits in lighting.js, webgpu/scene.js, setup.py, unwrap.py
}
```

### 4B. Material level (`material.userData.lighting`)

```
lighting: {
  surface: 'opaque' | 'foliage' | 'leafCard' | 'sheer' | 'glass' | 'mirror' | 'screen' | 'lamp' | 'indicator' | 'fire',
  alphaCutout: bool,                // distinct from "is a plant" (nets, lattices, ferns are cutouts, not foliage)
  twoSided: 'faceDirection' | false,// replaces ^garden- leafSide
  foliage: { groundOcclusion: bool, bakedPerVertex: bool },   // replaces the name regexes and ^plant
  wet:  'dry' | 'ground' | 'plant' | 'outdoor' | 'auto',
  sheer: { reflect, transmit },     // exists today, keep
  glass: { daylightOpacity, castsSun: false, windowOverlay: bool },   // replaces 3 glass tests
  emits: { kind: 'lamp'|'screen'|'indicator'|'fire', strength, switched: true|false, group: name|null },
  reflection: 'probe' | 'mirror' | 'none',
  clearcoat: 'probe' | 'strip',     // photo.js strips; shader replaces
}
```

### 4C. Lamp fixtures (replaces the string/coordinate tables)

On the *fixture root* (the placed object, and the niche can via a real `placement`/id):

```
lamp: {
  id: 'dining-pendant',             // already exists as userData.id
  switch: 'dining',                 // switch/group name, authored once (replaces WALL_SWITCHES name col, group_of, DEFAULT_ON keys)
  room:  'dining',                  // authored, or looked up from a single rooms.json with names
  exterior: false,                  // replaces both porch regexes
  defaultOn: { sunrise:false, noon:false, golden:true, dusk:true },   // replaces DEFAULT_ON/ALWAYS_DEFAULT
  light: { ... existing userData.light spec ... , bake: bool, live: bool },   // replaces placement.light/bake
  plate: { x, y, ry },              // replaces WALL_SWITCHES position cols; the target fixture is the owner, not an id+coordinate match
  heads: 'auto' | n,                // track light heads
}
```

Single sources of truth to add:
- `web/data/rooms.json` with named rectangles/polygons for `rooms` and `zones` (interior/exterior/annex). Replaces the 9 `insidePlan` copies, `ROOMS` x2, `ANNEX`, `indoorWeight` box and `lamp_groups.py` `room()`.
- A `describeLighting(root|material)` JS module returning the resolved role (with presets), and a Python mirror that reads only extras. Presets keep authoring cheap:

| preset | role | bake | notes |
|---|---|---|---|
| wall/floor/ceiling/cabinet | architecture/furniture | lightmap | static |
| door leaf | door | probe | probeSide 'face'; french/slider `bake:'lightmap'` explicit |
| curtain/blind/sheer | cloth | probe | surface 'sheer' + probeSide 'face' |
| chair/stool/ottoman | movable | probe | sun.track 'hot' |
| tree/shrub/grass | plant | probe (+foliage bake) | weather 'plant' |
| window pane | glass | none | sun.cast false, windowOverlay true |
| bulb/shade/diffuser | emitter | lightmap (still) | emits.kind 'lamp', switched |

### 4D. What each decision point would be replaced by

| existing decision (section 1 #) | replaced by |
|---|---|
| batch.js `label`/`movable`/`stillParts`/`noBatch` (2-8) | `motion`, `stillParts`, `bake` (batch only merges; ids assigned from `bake`) |
| unwrap.py `material_skip`, `lmSkip`, `ground/far`, `tiny` (14-18) | `bake` extra (`none`/`probe` skipped with reason = role); keep `tiny` as a size rule on top |
| photo.js `presentation`, `traceMaterial` conversions (10-12) | `role:'presentation'`, `surface` conversions table keyed on `surface` |
| lightmap.js doorParts/sharedUV/register/sided (22,23,27,28) | `bake` + `probeSide` |
| lightmap.js `leafSide`/`foliage`/`occl`/`wet`/`sheer`/`mirror` (39-47) | material `lighting` fields |
| addWindowReflections, glass casts, WebGPU glass (26,48) | `surface:'glass'` -> `glass.castsSun`, `windowOverlay` |
| weatherClass x3, wetPatch exclusions, puddles `wetMaterial` (50-55) | `wet` (resolved once, `auto` computed by one shared function using `zone`) |
| foliage_bake.js `^plant`, foliage_bake.py (31-33) | `foliage.bakedPerVertex` |
| contact.js plant exclusion (54) | `surface in {foliage,leafCard,alphaCutout}` |
| PCSS `isPlantRoot`, `e.plant`, movables/dynamic arrays (103-105) | `sun.track`, `motion` |
| `emitsLight`, `glowing`, `lightGlow`, `switchLight` rules, `emissionCopies`, `applyGlow`, setup.py `source()` and 2.5x, layer_lights, lamp_groups.py surface assignment (63-76) | `emits` on the material (`kind`, `switched`, `group`); one level function `emissionLevel(kind, group, slot, switchState)` used by raster, baked and tracer |
| `collectLightSwitches` special cases incl. niche, nightstand owner, porch sconce light, regexes (77-82, 86) | `lamp` declaration on the fixture root |
| `WALL_SWITCHES` (85) | `lamp.plate`, generated at collect time |
| `switch_groups.mjs` exterior regex, `group_of`, `ROOMS`, `ORDER`, `lit` hack, wattage substrings (87-93) | `lamp.switch`, `lamp.room`, `lamp.exterior`, fixture `light` spec wattage |
| `DEFAULT_ON`, `ALWAYS_DEFAULT` (94) | `lamp.defaultOn` exported into `lampgroups/encoding.json` |
| `insidePlan` x9, `lighting.js inside()`, region split, WebGPU scene.js (36,37,52) | `zone` from rooms.json |
| `isMirror`, `Layout.addMirrors` (45,61) | `surface:'mirror'` |

### 4E. Migration order that keeps risk low

1. Add `describeLighting` that *derives* today's answers from the existing regex/flag rules and log differences between its
   result and each legacy decision (tests exist: web/tools/test_baked_shaders.mjs, test_scene_rebake.mjs, test_still_parts.mjs).
2. Introduce `rooms.json` and replace the nine `insidePlan` copies and `ROOMS`; fix the `'outside'` gap.
3. Move the plant/glass/mirror predicates (items 1-3 in section 3) onto material `lighting` fields; drop regexes.
4. Move emission and lamp-group membership onto `lamp`/`emits`; delete the exterior regex copies, `WALL_SWITCHES` coordinates and the niche/nightstand special cases.
5. Export the resolved role as glTF extras and make `unwrap.py`, `setup.py`, `foliage_bake.py`, `lamp_groups.py` consume only extras.

---------------------------------------------------------------------------------------------------------------------

## 5. Counts

- Distinct decision points listed in section 1: 108 rows (about 75 are separate mechanisms; the rest are duplicates of the same rule).
- Files containing lighting-role decisions: JS 21 (batch, lightmap, materials, lighting, lamp_groups, light_switch, photo, puddles, contact, foliage_bake, daylight, layout, main, house, hq, minimap, webgpu/{assets,materials,scene}, kit, closet) plus furniture material creators (13 files set `emits`); Python/other 12 (unwrap, setup, lamp_groups, layer_lights, bake, foliage_bake, reflprobe, reflprobe_layout, make_tasks, lamp_groups_pack, lamp_groups_render, switch_groups.mjs/export.mjs/lights.mjs).
- Plant-family regex sites: 22. `insidePlan` copies: 9 (+ the `indoorWeight` and bounding-box variants). Glass tests: 4 JS + 3 Python variants. Mirror-by-name: 4 sites. Niche-can name sites: 5. Exterior regex: 2. Room tables: 2 (+ ANNEX, + 4 interior boxes).
- Emission markers: 27 `emits` assignments (16 lamp, 6 screen, 3 indicator, 2 fire) + runtime `lightGlow`.
