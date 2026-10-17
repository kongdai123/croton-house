# Shader stack audit (read-only)

Scope: three.js r183 walkthrough, `web/src`. Goal: an inventory for replacing the stacked, string-patched shaders with one
composed baked-material shader. Nothing was edited. Sampler numbers below come from running the repo's own
`fragmentSamplers()` (sampler_budget.js:19) over the real `probeLit` output in node (script kept in the session scratchpad,
not in the repo); the lightmapped-static numbers are summed by hand from the same rules, because `lm()` is a closure
inside `applyLightmaps` and cannot be called from node. Both are estimates of what the budget code sees, not
`auditPrograms()` measurements from a linked program.

Existing tests that already exercise part of this: `web/tools/test_baked_shaders.mjs` (16 probeLit variants, atomic patch
failure, sheer, PCSS) and `web/tools/test_sampler_budget.mjs`. Both pass in node today. `docs/audit/postmortem.md` is the
bug history; row 16 (stool legs invisible on Apple GPUs) and class I ("shader built by stacked string patches") are this task.

Findings worth reading first (details in section 2):

1. **hq.js:196 mirror "reflection-surface" patch is a silent no-op today.** It does `.replace('float roughnessFactor = roughness;', ...)`
   on the unexpanded template, where only `#include <roughnessmap_fragment>` exists (verified: the string is absent from
   `ShaderLib.physical.fragmentShader`). It only works if an earlier hook expanded that chunk (taa.js does, but TAA is not
   wired in). So merged mirror-reflection geometry ignores its baked per-vertex roughness/metalness.
2. **taa.js is dead code in the app** (`createTAA` is imported only by `tools/test_render_fixes.mjs`; `lighting.taa` is never assigned).
   Its hazards below are latent, but it would break the sampler-cut recovery if enabled.
3. **Contact AO is silently skipped on sheer cloth** because sheerProbePatch consumes the marker contact.js hooks.
4. Reflection-probe occlusion, foliage scaling and contact AO all hook the *text* of the probe irradiance lines, in a fixed order.

---

## 1. Inventory

### 1.0 How a material gets its hook chain (the machinery)

All of this runs inside `onBeforeCompile(shader, renderer)`; three has already assembled `shader.fragmentShader` as the
*template* with `#include <chunk>` lines unexpanded. A patch that wants chunk-body text must expand the include itself
(`THREE.ShaderChunk.x`) or it matches nothing.

| piece | file:line | what it does |
|---|---|---|
| `shaderReplace` (`rep`) | foliage_bake.js:22 | exact-count replace; throws unless `from` occurs exactly `count` times (default 1). String or regex. |
| `shaderPatch` | foliage_bake.js:27 | transactional wrapper: copies the shader object, runs the patch, `Object.assign`s back only on success; on a throw it records the failure, warns once, leaves the material stock. |
| `assertShaderPatches(since)` / `shaderPatchCount` | foliage_bake.js:19,18 | startup gate: `checkPatches()` (lightmap.js:798) throws after warm compile, main.js:98/277 then calls `fallbackLegacy`. After startup a failure only warns. |
| `shaderKey(m)` | foliage_bake.js:33 | freezes `m.customProgramCacheKey()` before a wrapper replaces it. |
| `bakedHooks = { compile, key }` | set at lighting.js:307, lighting.js:453, lightmap.js:698, lightmap.js:1293, foliage_bake.js:145, contact.js:215, interact.js:282 | the material's own pre-lighting hook and key. Baked and probe hooks start from `bakedHooks ?? onBeforeCompile`, which is how the legacy wrapper (HQ shadow, lightingChunk, daylight, pet-light) is bypassed. |
| `hooks` Map | lightmap.js:751 | per-material snapshot for `dispose()` (lightmap.js:898) to restore `onBeforeCompile`, key, emission, `bakedHooks`. Restoring is unconditional, so it discards any wrapper layered later. |

Order the chain is built in (innermost first), for a typical probe-lit movable. Everything after step 2 is skipped for
lightmapped static copies except where noted:

1. **Material's own hook**: leaf/fur/wind/skin (see 1.7). Runs first inside every later hook (`prev.call`).
2. lighting.js:307 (`collectMaterials`) legacy wrapper: `hqEffects.patch`, `lightingChunk`, `daylight.patch`. Stored aside as `bakedHooks.compile` = step 1; the wrapper itself is *replaced* by step 3 in baked mode.
3. `probeLit` (lightmap.js:1283) or the `lm` lightmapped copy (lightmap.js:698). Pets/visitor register later (main.js:149-152) and take the same path; `attachPet` (lighting.js:452) is dropped by `bakedHooks`.
4. `createContact` wrapper (contact.js:230), only for materials with no `lightMap` or that are caster copies. Calls `contactPatch`, which returns at once because step 3 already set `uContactDepth`; sets `uContactCaster` and the key suffix `|contact-camera-depth-v2-<0|1>`.
5. `createPuddles` wrapper (puddles.js:123), ground materials only, created lazily by `setFeatures` (lightmap.js:844). Key `|planar-puddle`.
6. taa.js `patchTextures` wrapper (taa.js:157), dormant.
7. hq.js mirror copies (hq.js:192) wrap whatever is there at `prepareMirrors` time, outermost.

Startup order (main.js): `collectMaterials` (126) -> `applyLightmaps` (136; internally foliage -> `register(scene)` probeLit -> lm copies) -> human/pets register (149-152) -> `createContact` + `setFeatures` (156-158) -> mirrors prepared (228/251) -> warm compile (276).

### 1.1 Baked lightmapped copy `lm` (lightmap.js:681-728)

- **Applies to**: every mesh matched to a lightmap unit (`pairs`, lightmap.js:644-675), per material, `m.isMeshStandardMaterial`. Excluded and left to probeLit: door parts except french/slider (lightmap.js:621-626), meshes sharing one geometry+material when the sidecar lacks `ownPrimitives` (lightmap.js:636-641), `lmSkip`, `batched`, instanced/skinned.
- **Clone**: `m.clone()` (clean copy, no hooks); `c.lightMap = atlas`, emission zeroed unless `emitsLight` (materials.js:266), `wetten()` for outdoor classes, `weather` map when multi-slot.
- **Chunk replaced**: `#include <lights_fragment_maps>` replaced by an expanded, edited copy of the chunk (lightmap.js:717). Inside the copy (all `rep`, count 1, asserted):
  - `vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );` removed (707)
  - `vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;` -> decoded `lmSample` forms (708): 4 variants: {lamp groups, shared lamps layer} x {multi-slot crossfade, single}
  - `iblIrradiance += getIBLIrradiance( geometryNormal );` removed (713)
  - `radiance += getIBLRadiance(...)` -> scaled by baked luminance and `smoothstep` of reflection-up (714)
  - `CLEARCOAT_IBL` line -> scaled by baked luminance (716)
- **Order inside the hook**: `prev` (own hook) -> uniforms -> v2 GLSL prepend (decoders, `LM_SAMPLE`, optional `lampGroupGLSL`) -> maps (717) -> `wetPatch` (if `puddles`) -> `reflPatch` (if `refl`) -> `pcss.patch` -> `fitBaked` + crossfade drop (`.replace`, **not asserted**, lightmap.js:737-739) -> `checkedContact(.., baked=true)`.
- **Adds**:
  - uniforms: `uLmK`, `uLmLamps`, `uLampLevel` (lmUniforms, lightmap.js:559), slot set `uSlotBlend uSlotNext uSlotNextLamps uSlotNextK uSlotLampA uSlotLampB` (lightmap_slots.js:30-35), lamp group set `uLampTex uLampK{t} uLampLv{t} uLampC{t}` (lamp_groups.js:79-86)
  - samplers: `lightMap` (three's), `uLmLamps`, `uSlotNext`, `uSlotNextLamps`, `uLampTex` (sampler2DArray)
  - varyings: `vLightMapUv` (three's, from `lightMap`), plus those of wetPatch/reflPatch/contact
  - defines: `#define LM_FILTER n` baked into the GLSL text (lightmap.js:419)
- **Cache key** (lightmap.js:727): `prevKey|baked-v3:` + `[v2, !!enc, puddles, refl.key ?? refl.count, CONTACT, LM_FILTER, multi, mirror, 'lg'+textures, samplerCut]`.
- **Match count asserted**: yes for all `rep` calls; the crossfade-drop `.replace` and `fitBaked` outcome are not.

### 1.2 Probe-lit `probeLit` (lightmap.js:1283-1323)

- **Applies to**: every `isMeshStandardMaterial` in the scene that has no `lightMap`, is not `isFogVolumeMaterial`, when a probe volume exists (lightmap.js:758-774, `register`): plants, glass, sheer, movable furniture, door/toggle parts, pets, the visitor, ground, unmatched meshes. Decided purely by "has no lightmap"; the role is then refined by flags computed at the top of `probeLit` from material name, alphaTest and userData:
  - `leafSide`: name `^garden-` -> `* faceDirection` on the normal
  - `foliage` (alphaTest>0 or name `^(garden-|plant)`) -> `occl` height ramp unless `material.foliageBake`
  - `wet`: `(volume.multi || volume.wet>0)` and not garden and not alphaTest
  - `sheer`: `userData.sheer`; `fol`: `material.foliageBake`; `mirror`: `name === 'mirror'`
  - `side`: `PROBE_SIDE` (", 0.5") only if the material is in `sided` (found under door/toggle roots, not transparent, not transmission; lightmap.js:753) and not sheer, foliage, leafSide
- **Chunk replaced**: `#include <lights_fragment_maps>` with an edited copy (lightmap.js:1306-1311): `iblIrradiance += getIBLIrradiance(...)` -> `irradiance += probeIrradiance( vProbeWorld, n[, side] )[occl]`; the `radiance +=` line and the `CLEARCOAT_IBL` line get a probe-luminance occlusion factor (all `rep`, asserted). Vertex: `#include <project_vertex>` plus the world-position varying.
- **Order inside**: `prev` -> volume uniforms -> vertex varying -> maps (1311, prepends `PROBE_GLSL`) -> `wetPatch` -> `reflPatch` (regex-replaces the line just written) -> `pcss.patch` -> `sheerProbePatch` -> `fitBaked` (crossfade pending) -> `checkedContact(.., baked=false)` -> `fol.patch` -> `slots.patchFoliage` (if fol) -> `slots.patchProbe` (unless dropped).
- **Adds**: uniforms `uProbeSH uProbeOrigin uProbeScale uProbeDims` (+ `uProbeBlend uProbeNextSH` from the slot runtime, lightmap_slots.js:41); sampler `uProbeSH` (sampler3D), `uProbeNextSH` when crossfading; varying `vProbeWorld` (vertex handles USE_BATCHING and USE_INSTANCING).
- **Cache key** (lightmap.js:1322): `prevKey|probe-v3:` + `[leafSide, occl, wet, refl.key ?? refl.count, CONTACT, sheer, !!fol, !!multi, mirror, side, samplerCut]`.
- **Match counts asserted**: all `rep`s yes; `checkedContact` only checks the probe-irradiance marker when the text is present (see 2.5).
- **Duplicate-application guard**: `userData.probeLit` (copied into clones by `Material.clone`'s userData JSON copy, so clones made after registration are never re-hooked and rely on the copied hook).

### 1.3 `PROBE_GLSL` (lightmap.js:1256-1281), `reflGLSL` / `reflPatch` (lightmap.js:1089, 1144), `wetPatch` (47)

- `PROBE_GLSL`: `probeUVW`, `probeTex`, `probeSH` (the one function the slot crossfade rewrites), `probeIrradiance(p,n)` and `probeIrradiance(p,n,side)`. Prepended to the fragment shader by probeLit.
- `reflPatch(sh, refl, occlusion, mirror)`:
  - applies to every baked material when `volume.refl` exists (so lightmapped and probe-lit alike; `mirror` changes only the nearBox margin 0.03 vs 0.25 and sets occlusion to 1.0)
  - replaces by regex the `radiance += getIBLRadiance(...)[^;]*;` statement and, if present, the clearcoat one. In probeLit this regex consumes the line probeLit wrote a moment earlier.
  - adds varying `vReflWorld` (vertex guarded by `includes`, fragment not), uniforms `uReflTex(sampler2DArray) uReflPos uReflMin uReflMax uReflMips`, slots: `uReflBlend uReflBase uReflNext`, lamps: `uReflLamp uReflLampW uReflLampBase`
  - key contribution: `refl.key` (`count`, or `count:lampLayers:max` when lamp reflections attached, lightmap.js:1050) in both baked and probe keys
- `wetPatch(sh, wet)` (47-61): `uniform uWet`, varying `vWetWorld`, helper GLSL `PUDDLE_GLSL` (91); replaces (kept-include pattern) `#include <normal_fragment_begin>` or `vec3 nonPerturbedNormal = normal;` and `#include <lights_physical_fragment>` (asserted). `uWet` is rebound to `slots.wet` (lightmap.js:733, 1313) after creation. Key contribution: boolean `puddles` / `wet`.

### 1.4 Sun PCSS (lightmap.js:329-334, uniforms 149-)

- `pcss.patch` on every baked material (both paths): prepends `PCSS_GLSL` before `void main() {` (asserted count 1), expands `#include <lights_fragment_begin>` to the stock chunk, replaces the `getShadow( directionalShadowMap[ i ], ...)` lookup with `sunPCSS(...)` (asserted).
- Adds: sampler `uSunDepth` (depth texture), uniforms `uSunTexel uSunDepthRange uSunWidth uSunTan uSunFrame uSunTaps`; three taps variants compiled in; tier selected by uniform. No key contribution (always on).
- **Sun-depth variant** (`depthOf`, lightmap.js:157-181): a MeshDepthMaterial per caster running only the material's `bakedHooks.compile`, with the standard vertex/fragment shell re-supplied when a hook exists; key `<bakedKey>|sun-depth-v2`. `d.defines = m.defines`.

### 1.5 Slot crossfade (lightmap_slots.js)

- `patchProbe` (126-132): rewrites the single line `return probeTex( uProbeSH, uvw, ch );` inside `probeSH` into `uProbeBlend > 0 ? mix(two taps) : one tap`; throws if absent. Adds `uProbeBlend`, `uProbeNextSH`; sampler +1. Runs **last**, after `fol.patch`. Skipped (silently, aside from the warning) when `fitBaked` dropped `slot crossfade`.
- `patchFoliage` (133-140): adds vertex attribute `foliageNext` and uniforms, and rewrites the tail of foliage's vertex block (`foliage.z ); }` marker, throws if absent) so `vFoliage` blends current/next slot. Runs for every foliage material regardless of the crossfade drop.
- Baked path: the crossfade lives inside the `lightMapIrradiance` replacement text (1.1), with a fallback to single-slot atlases through the unasserted `.replace` pair when dropped.
- Reflection blend (`uReflBlend/Base/Next`) costs no sampler (one array) and is never dropped.

### 1.6 Foliage bake (foliage_bake.js:70-86, 145)

- Applies to plant meshes the sidecar covers (`isPlant`: material name `^plant`), matched by id or bounds (matchFoliage). The mesh gets a cloned material `c` with `c.foliageBake = FOLIAGE`, key `key|foliage`, `bakedHooks` copied, so probeLit later treats it as `fol`.
- `FOLIAGE.patch` runs from probeLit after contact and before the slot patches:
  - vertex: prepends `attribute vec3 foliage; varying vec3 vFoliage; uniform vec2 uFolK;`, replaces (kept) `#include <begin_vertex>`
  - fragment: `void main() {` -> helper `foliageScale()` (uses `probeUVW`, `probeSH`) + main (asserted 1)
  - `probeIrradiance( vProbeWorld, ` -> `foliageScale( vProbeWorld ) * probeIrradiance( vProbeWorld, ` (**asserted count 3**: irradiance, specular-or-occlusion, clearcoat-or-occlusion)
  - if reflections: `... / 0.95 + 0.25,` -> `... / 0.95,` (**asserted count 2**: the two occlusion factors written by reflPatch)
  - sun: `sunPCSS( vDirectionalShadowCoord[ i ], directionalLightShadow.shadowBias )` -> `min( ..., vFoliage.z )` (asserted 1)
- Uniforms `uFolK uFolLamps` (module level, shared); varying `vFoliage`; attributes `foliage`, `foliageNext` (multi-slot). No sampler.
- Key: only through `!!fol` in the probe key, and `|foliage` in the clone's (overwritten) key.

### 1.7 Lamp groups (lamp_groups.js:50-73)

`lampGroupGLSL(T)` text prepended in the lightmapped hook only: `uLampTex` (sampler2DArray), `lmDecode3`, `lmSample3`, per-texture `uLampK{t} uLampLv{t} uLampC{t}`, and `lampGroups(uv)`. Needs `LM_FILTER` already defined (it is, via `LM_SAMPLE` prepended just before). Key: `'lg' + groupMeta.textures` in the baked key. Probe-lit materials get lamp groups through the volume fill (buildProbeVolume, lightmap.js:1222-1240), not shader code. Lamp reflections are an extra array layer range inside `uReflTex` (attachLampReflections, lightmap.js:1044).

### 1.8 Contact (contact.js)

- `contactPatch(sh, baked, sun)` (contact.js:77) is called from `checkedContact` (lightmap.js:63) in both baked hooks, and again from `createContact`'s wrapper (contact.js:230) which no-ops when `uContactDepth` is already in `sh.uniforms`.
- Sun part (skipped when the sampler budget drops it): prepends `SUN_GLSL`, expands `lights_fragment_begin` if still an include, replaces `getDirectionalLightInfo( directionalLight, directLight );` with itself plus `directLight.color *= contactSun(...)`. Samplers `uContactDepth`, `uContactCoverage` (+2).
- AO part, lightmapped: vertex `vContactWorld` varying; fragment replaces `irradiance += lightMapIrradiance;` by `lightMapIrradiance *= contactAO(...)` + same. Probe-lit: replaces the text `irradiance += probeIrradiance( vProbeWorld,` with `irradiance += contactAO( vProbeWorld, ... ) * probeIrradiance( vProbeWorld,` (`.replace`, unasserted, and guarded by `includes`).
- Uniforms: `U` (uContactDepth/Coverage/Size/View/Projection/InvProjection/Direction/Length/Bias/Thickness/Frame/Ready/Sun/AO/Count/Pos/Shape) and `FLAT` flat typed arrays, plus per-compile `uContactCaster`.
- Cache: baked/probe keys carry `CONTACT` (a module constant `true`); the wrapper adds `|contact-camera-depth-v2-<caster>`.
- Asserted: `checkedContact` asserts `getDirectionalLightInfo...`, and for baked the vertex marker and `irradiance += lightMapIrradiance;`. Not asserted for the probe AO marker.

### 1.9 Sheer cloth (materials.js:279-296 `sheerProbePatch`)

Applies to probe-lit materials with `userData.sheer` (decor.js:115, voile map at 39). After `pcss.patch`, before the sampler fit. All `rep`, asserted:
vertex `project_vertex` (+`vSheerSpread`); expands `lights_physical_pars_fragment`; replaces the direct-diffuse line, `vec3 totalEmissiveRadiance = emissive;`, `lights_physical_fragment` (sheen scale), the **probe irradiance line** (see 2.5), and `alphamap_fragment`. Uniform `uSheer` (`material.sheerUniform`), varying `vSheerSpread`. No sampler. Key: boolean `sheer`.
Also: photo.js:145-149 treats `userData.sheer` for the path tracer; `side` is not applied to sheer.

### 1.10 Emission (materials.js:266 `emitsLight`, lighting.js `physicalEmission`, lightmap.js `emissionCopies`)

Not a shader patch: JS-side `emissiveIntensity` zeroing for materials that are not real light sources (`userData.lightGlow || userData.emits`), restored on dispose; baked copies follow their sources (`syncEmissionCopies`, lightmap.js:597). Sheer additionally hard-zeroes `totalEmissiveRadiance` in GLSL (1.9).

### 1.11 Mirrors and window glass

- `isMirror(m)` = `m.name === 'mirror'` (lightmap.js:1143). Effect inside shaders: occlusion 1.0 and tight probe margin in `reflPatch`; key flag `mirror`. The mirror *surface* is hq.js `createMirror` (Reflector, hq.js:52-) with its own RT; `r.material.fragmentShader.replace('blendOverlay( base.rgb, color )', 'base.rgb * 0.96')` (hq.js:55, unasserted `.replace`).
- `prepareMirrors` (hq.js:116-) builds a reflected scene of material **clones that keep the source's hook chain**, merging static geometry per `materialKey` and adding `attribute vec2 hqSurface; varying vec2 vHQSurface` plus the two `.replace` calls from finding 1 (hq.js:192-199, key `|reflection-surface`). `lightMap`/`envMap` are re-synced into the clones each reflection render (hq.js:100-106).
- Window glass: `addWindowReflections` (lightmap.js:1330): an additive `ShaderMaterial` overlay (own program, `reflGLSL` reused, `tSky` or `uReflTex`) on every pane with `daylightOpacity` or transmission. The pane itself is an ordinary probe-lit material.

### 1.12 Legacy fake GI (also active as fallback)

- lighting.js:22 patches `ShaderChunk.tonemapping_pars_fragment` once at module load (`uHuePreserve`, Neutral tone curve; unasserted `.replace`).
- lighting.js:54 `lightingChunk`: stock `lights_fragment_begin` with point/spot/rect loops de-unrolled and zero-colour guards.
- lighting.js:307-314 (per material region, interior/exterior): `hqEffects.patch` (hq.js:40, `uHQShadow`, 12-tap `shadowmap_pars_fragment` replacement at hq.js:9), `lightingChunk`, `daylight.patch` (daylight.js:141: `vDaylightPosition`, samplers `uDaylightAmbient`, `uDaylightWindows`, paint tint at `color_fragment`, window light scaling in the rect-area loop, hemisphere scaling, floor bounce after `lights_fragment_maps`). Key `prev|hq-shadow|skip-dark-lights|daylight`.
- lighting.js:452 `attachPet`: lightingChunk + daylight + sun darkening for pets; key `|pet-light`.
- reflections.js:12 `markReflective` (SSR tag in `gl_FragColor.a`, key `|refl<a>`): lives in the material's own chain, so it survives into baked mode via `bakedHooks`.
- In baked mode all of these are bypassed through `bakedHooks` and the legacy lights are hidden (lightmap.js:677-679).

### 1.13 Output and post

| file:line | what | marker | assert |
|---|---|---|---|
| auto_exposure.js:100-106 | OutputPass: adds `tAutoExposure`, `precision highp sampler2D`, multiplies exposure before `// tone mapping` | `void main() {`, `// tone mapping` | no (plain `.replace`) |
| local_adapt.js:135-147 | OutputPass and the Blender AgX material: `outputGLSL` + `localAdapt()` call | anchors `gl_FragColor.rgb *= texture2D(tAutoExposure` / `vec4 t = texture2D(tDiffuse, vUv);` | yes (throws if the anchor changed) |
| agx.js `blenderAgX` | a separate ShaderMaterial used when AgX is selected; auto exposure fed by uniform, not patch | n/a | n/a |
| taa.js:114-123,157-163 | `textureBias`: expands every chunk that samples a surface map and rewrites `texture2D( map,` to `taaSample(`; wraps every material with a map; key `sourceKey|taa-lod-bias-v1` with `sourceKey` **frozen** at wrap | regex | no. **Dormant** |
| photo.js:623 | path tracer material: `uClamp` firefly clamp at `gl_FragColor.a *= opacity;` | one string | no |
| photo.js:671-843 | own ShaderMaterials (blur, denoise, composite) | none | n/a |

### 1.14 Other material-specific hooks and keys (all innermost, step 1 of the chain)

| file:line | material | marker | key |
|---|---|---|---|
| materials.js:237 | turf macro noise (`uMacro` sampler) | `#include <map_fragment>` | `turf-macro` |
| materials.js:251 | shell white | `#include <map_fragment>` | `shell-white` |
| plants_parts.js:307 | leaf: normal-pass output, optional soft normal | `#include <normal_fragment_begin>`, tail `}` regex | `plants-leaf-soft|hard` |
| grass.js:213 | garden blades: wind (`uTime uWind uDensity`), normal-pass | `begin_vertex`, `normal_fragment_begin`, tail `}`; `defines` G_SWAY/FLUTTER/HEIGHT/COMP/LOD/BLADE | `garden|depth|std` |
| garage.js:206 | garage door skin: `uOpening` irradiance dim after `lights_fragment_maps` | `#include <lights_fragment_maps>` | `garage-door-skin` |
| cat.js:532,905; dog.js:317 | fur shells, eye lid | `common`, `skinning_vertex`, `map_fragment`, `color_fragment`, `roughnessmap_fragment`, `lights_physical_fragment` | `croton-cat-fur-1`, `croton-cat-eye-1`, `pet-dog-fur-1` |
| decor.js:116 | sheer voile key only | n/a | `sheer-voile` |
| light_switch.js:61 | switchLight clone keeps hook and key (but **not** `bakedHooks`; fine because it runs before `collectMaterials`) | n/a | copied |
| interact.js:282 | hover highlight clone copies hook, key, `bakedHooks` | n/a | copied |
| puddles.js:123-135,201 | planar puddle wrapper; `simple()` diffuse-only copy strips `radiance +=` statements by regex; `s.defines` merged | `void main() {`, `lights_physical_fragment`, `lights_fragment_end` (`.replace`, guarded by `float wetPuddle =`) | `key()|planar-puddle`, `key()|puddle-diffuse` |
| webgpu/materials.js:24-29 | ignores every WebGL hook, logs them | n/a | n/a |

### 1.15 Sampler budget (sampler_budget.js)

- `fragmentSamplers(sh)` (19): three's maps from parameters (the `MAPS` list incl. `lightMap`), `envMap` only if an IBL call remains in the source, +1 transmission, **+1 `dfgLUT` when `shaderID==='physical'`** (true for Standard too, since r183's `lights_physical_pars_fragment` declares it), +2 rect-area LTC, +1 per shadow-casting dir/spot/point light, `spotLightMap`, plus declared-and-referenced custom samplers (arrays by size).
- `fitSamplers(sh, renderer, material, features)` (55): `limit = maxTextures - userData.samplerCut`. Counts pending features, then drops in list order while over. The list is built in lightmap.js:78 `fitBaked`: **planar puddle (1), contact sun (2), slot crossfade (1 with lamp groups, 2 without; `pending:false` so it is subtracted not added)**. Probe path passes crossfade cost 1, pending. No drop order exists for anything else (reflection array, PCSS, lamp groups, maps).
- Drops are communicated by side channel: `s.noPlanarPuddle` (read by puddles.js:38), the `sun=false` argument to contactPatch, `drop.has('slot crossfade')`.
- `auditPrograms` (69) every second (lightmap.js:788): matches keys containing `|baked-v3` or `|probe-v3`, reads real `ACTIVE_UNIFORMS`; on a link failure whose log mentions samplers, bumps `userData.samplerCut` by 2 (max 8) and sets `needsUpdate`.

---

## 2. Hazards

Severity: **H** known/likely live bug, **M** order or marker dependence that works today but breaks on a plausible edit, **L** latent or cosmetic.

### 2.1 Order dependence and markers consumed by earlier patches

| # | sev | hazard | evidence |
|---|---|---|---|
| 1 | H | **hq mirror surface roughness/metalness no-op.** `.replace('float roughnessFactor = roughness;'...)` runs on the template, where the chunk is not expanded. Works only if a previous hook expanded `roughnessmap_fragment`/`metalnessmap_fragment` (taa.js would). Result: reflected scene uses the first merged material's roughness. | hq.js:196-197; `ShaderLib.physical.fragmentShader.includes('float roughnessFactor = roughness;')` is false, `#include <roughnessmap_fragment>` true. Not asserted. |
| 2 | M | `reflPatch` regex-replaces the `radiance +=` statement that probeLit wrote just before, so probe-specular occlusion text is created and then destroyed when `refl` exists (it then re-creates a `probeIrradiance( vProbeWorld, nW...` inside the occlusion). Foliage's count-3 assertion is satisfied only by this exact balance (irradiance + 2 occlusions with refl, irradiance + specular + clearcoat without). Any new `probeIrradiance(` call site or a change in which statements get occlusion breaks foliage with a throw (caught: the whole probe patch is left unpatched, startup falls to legacy). | lightmap.js:1308,1155; foliage_bake.js:83,84 (count 3, count 2) |
| 3 | M | Foliage reflection tweak depends on the literal `/ 0.95 + 0.25,` produced by probeLit's occlusion string; mirror materials use `'1.0'` instead, so foliage+mirror would throw. | foliage_bake.js:84; lightmap.js:1319 |
| 4 | M | `sheerProbePatch` needs the exact text `irradiance += probeIrradiance( vProbeWorld, inverseTransformDirection( geometryNormal, viewMatrix ) );` which exists only without `leafSide`, `occl`, `side`. It holds today because `side` is excluded for sheer (lightmap.js:1292) and sheer is never foliage. Adding `occl` or `side` to a sheer material would throw. | materials.js:280; lightmap.js:1292 |
| 5 | M | Fixed run order encoded only by call sequence: wet -> refl -> pcss -> sheer -> fit -> contact -> foliage -> slot probe -> slot foliage. `patchProbe` must come after `fol.patch` only because both touch `probeSH`; it must come after `fitBaked` because the drop decision is made there; contact AO must precede foliage because foliage inserts text in front of the contact hook's `probeIrradiance(`. Nothing enforces it. | lightmap.js:1313-1320 |
| 6 | M | Two kinds of patch coexist: *kept-include* edits (`#include <x>` -> `#include <x>\n...`), which compose in any order, and *consumed-text* edits (replace a statement written by another patch), which do not. All the real hazards are the second kind. | table 1.1-1.9 |
| 7 | M | Patches expand stock chunks in three places (`pcss.patch` expands `lights_fragment_begin`, `contactPatch` conditionally expands it, lighting.js uses its own modified copy). If lighting's chunk ever runs together with PCSS the `getShadow(...)` lookup is still present only because lighting leaves it alone; contact's `includes('#include <lights_fragment_begin>')` guard hides which one expanded. | lightmap.js:331-333; contact.js:83; lighting.js:54 |
| 8 | L | The `lm` crossfade-drop uses unasserted `.replace(next[0]...)`/`.replace(next[1]...)` on strings it just wrote; fine today. | lightmap.js:739 |
| 9 | L | `daylight.patch`, `hqEffects.patch`, `attachPet`, `markReflective`, TAA, photo, auto_exposure use plain `.replace` with no count check; a three upgrade changing a marker fails silently there (legacy path only, except markReflective which is also in baked mode: SSR tag lost). | daylight.js:155-167; hq.js:41; lighting.js:464; reflections.js:17 |

### 2.2 Cache keys missing a source-changing input

Checked against "does every JS input that changes the generated text appear in the key?"

| # | sev | gap |
|---|---|---|
| 10 | M | **taa.js freezes `sourceKey` at wrap time** (taa.js:159). Baked/probe keys read `userData.samplerCut` live and the audit relies on `needsUpdate` + a changed key to recompile smaller (lightmap.js:788-798). Under TAA the key does not change, three reuses the cached failed program, and the mesh stays invisible. Latent (TAA unwired). |
| 11 | L | Probe key has no `LM_FILTER` (not used), no lamp-group texture count (not used), no `enc` (not used): correct. But it also omits `volume.slots` separately from `multi` (same thing) and the **foliage `K`/lamps flag** (uniform). OK. |
| 12 | L | `fitBaked` outcomes (`planar puddle`, `contact sun`, `slot crossfade`) change the source but are not in any key; they are a deterministic function of three's own program parameters, `renderer.capabilities.maxTextures` (constant per device), `samplerCut` (in key) and `userData.planarPuddle` (flipped by createPuddles, which also changes the key via `|planar-puddle`). Consistent today, but only by that chain of coincidences. A new shadow-casting light changes the dir-shadow count and so the parameters part of three's key, which is fine. |
| 13 | L | Keys freeze the *previous* key at hook-install time (`prevKey`, lighting.js:293 `uses.key`, `shaderKey`). Any material whose own key depends on mutable state (none found: all custom keys are constants) would not update. |
| 14 | L | Probe key's `wet`/`occl`/`leafSide` are computed once at registration from name and `alphaTest`. A later change of `alphaTest` or name (none found) is invisible to the key. |
| 15 | L | Highlight clone (`interact.js:282`) and contact caster copies copy the key function; the baked key reads `c.userData.samplerCut` from the closure `c`, not the clone, so a cut applied to the clone is ignored (probe key uses `this ?? material`, baked key does not). |

### 2.3 Duplicate or overlapping declarations

| # | sev | hazard |
|---|---|---|
| 16 | M | **Four copies of "world position" varying**, each with its own USE_BATCHING/USE_INSTANCING block: `vProbeWorld` (lightmap.js:1297), `vWetWorld` (49), `vReflWorld` (1146), `vContactWorld` (contact.js:96), plus `vDaylightPosition` in legacy. A baked static material with wet+refl+contact carries three identical vec3 varyings; probe-lit foliage carries vProbeWorld, vWetWorld (if wet), vReflWorld, vFoliage, vSheerSpread. This is varying and interpolator pressure, and a mistake risk (the batching block has been copied four times). |
| 17 | L | `uWet` is created with a local `{value}` by `wetPatch` and then replaced by `slots.wet` or `volume.slots.wet` by the caller; harmless, but two sources of truth. lightmap.js:48,733,1313. |
| 18 | L | `uSlotBlend`/`uSlotLampA/B` are declared in the *vertex* shader by `patchFoliage` and in the *fragment* shader by the lightmapped decode; `uProbeBlend` and `uReflBlend` are further aliases of the same `blend` object. Works because uniforms are matched by name across stages; a rename in one place silently disconnects. |
| 19 | L | `reflPatch` guards the vertex varying with `includes` but prepends the fragment declaration unguarded; double application would produce a compile error rather than the guard's intent. |
| 20 | L | GLSL helper names are global and unscoped: `lmDecode`, `lmDecode3`, `lmSample`, `lmSample3`, `probeIrradiance` (overloaded), `foliageScale`, `contactAO`, `contactSun`, `sunPCSS0/1/2`, `puddle`, `puddleNormal`, `reflProbe`, `wetHash`, `wetNoise`, `outsideHouse`. No collisions today. |

### 2.4 Sampler budget

| # | sev | hazard |
|---|---|---|
| 21 | M | Drop order covers only three features (puddle, contact sun, next-slot atlases). The cost drivers that remain (maps, `dfgLUT`, `envMap`, the reflection array, PCSS depth, directional shadow, lamp array) have no fallback, so a heavily textured physical material (clearcoat plus roughness/metalness/AO/normal maps) can still exceed 16 after all drops. The fallback is the post-link audit with a per-material cut that only re-runs the same drop list with a lower limit. |
| 22 | M | The estimate is conservative about `envMap` (counted while any IBL call remains, including the anisotropy one) and does not see samplers added by patches applied *outside* the fit: the planar puddle wrapper (re-checks itself, puddles.js:41), TAA (none), contact wrapper (none). OK today; any new outer patch that adds a sampler needs its own check. |
| 23 | M | Mixed policies: crossfade drop is decided per material but the foliage vertex-side crossfade (`patchFoliage`) is applied regardless, so a foliage material that dropped its probe crossfade still blends `vFoliage` between slots while `foliageScale` reads only the current slot's mean. A brightness mismatch during the 1.5 s fade, then a jump at its end. |
| 24 | L | `dfgLUT` is counted only when `sh.shaderID==='physical'`, which three assigns to Standard as well; any hand-built test shader must set it (test_sampler_budget does). |

### 2.5 Slot crossfade vs probeSH, contact vs probeIrradiance

| # | sev | hazard |
|---|---|---|
| 25 | M | `patchProbe` edits the body of `probeSH` by one literal line (lightmap_slots.js:129). `probeSH` is called from `probeIrradiance` (1 per call, 3 lookups of 1 or 2 taps) and from `foliageScale` (3 lookups each, called 3 times). With the crossfade active that is up to 6 taps per `probeIrradiance` call and 3 `probeIrradiance` calls per foliage pixel, plus 3 `foliageScale` calls: dozens of fetches per pixel unless the compiler merges them. Not a correctness bug, a cost one; also the reason one composed shader should compute the SH once. |
| 26 | M | **contact.js hooks the text `irradiance += probeIrradiance( vProbeWorld,`** (contact.js:104). `checkedContact` only verifies it when it is present (lightmap.js:67). Two consequences: (a) sheer consumes it first, so sheer cloth gets the contact sun but **silently no moving AO**; (b) any edit to that line breaks AO with no warning. |
| 27 | L | Contact AO uses `inverseTransformDirection( geometryNormal, viewMatrix )` without `leafSide`, so double-sided garden leaves get AO from the unflipped normal. Cosmetic. |
| 28 | L | The sun-contact `getDirectionalLightInfo...` marker is checked (asserted) in baked mode but the non-baked branch of `createContact`'s wrapper (materials that are not baked at all) uses unchecked `.replace`. |

### 2.6 Lifecycle and wrappers

| # | sev | hazard |
|---|---|---|
| 29 | M | `dispose()` restores `m.onBeforeCompile = h.compile` unconditionally (lightmap.js:898) while contact, puddles and TAA restore only if `m.onBeforeCompile === theirHook`. After the baked layer is torn down (fallbackLegacy), those later wrappers are orphaned: they skip restoration, are not reinstalled (TAA keeps the map entry), and their keys are gone. |
| 30 | M | Wrapper stacking order is an accident of when each feature initialises: puddles wrap lazily when the tier first enables them (`setFeatures`), so crossing to a tier with puddles changes the key of every ground material and recompiles it at runtime, not under the loading screen. |
| 31 | L | `Material.clone()` JSON-copies `userData`, including `probeLit` and `samplerCut`, and drops hooks/keys/`bakedHooks`. Each clone site (lighting.js:298, hq.js:192, contact.js:215, interact.js:282, light_switch.js:61, foliage_bake.js:145, puddles.js:121) re-copies a different subset. `light_switch.js:61` omits `bakedHooks`, which only works because it runs before `collectMaterials`. |
| 32 | L | `Object.assign(sh, next)` in `shaderPatch` copies new properties (`samplerCount`, `noPlanarPuddle`) onto three's parameters object; later hooks and the outer puddle wrapper read them there. A convention, undocumented. |

---

## 3. Matrix: feature x material class

Classes: **LS** lightmapped static (`lm` copy); **PM** probe-lit movable (furniture, pets, visitor, unbaked ground and unmatched meshes); **PD** probe-lit sided door/toggle (PM plus `side`); **FO** foliage; **SH** sheer cloth; **MI** mirror; **GL** glass/window; **LG** legacy (baked layer absent or failed).
Entries: Y applies, n does not, c conditional (condition given). MI is shown as it is built: the mirror pane material is name `mirror`, lightmapped if it matched a unit, else probe-lit; both flags are in the keys.

| feature | LS | PM | PD | FO | SH | MI | GL | LG |
|---|---|---|---|---|---|---|---|---|
| Material's own hook (leaf, fur, wind, skin, SSR tag) | c (if the material has one) | c | c | Y (leaf/garden) | n | n | n | c |
| lighting.js legacy wrapper (HQ shadow, lightingChunk, daylight, pet-light) | n (bypassed) | n | n | n | n | n | n | Y |
| Lightmap atlas decode (`lmSample`, v2 tone decode) | Y | n | n | n | n | c (if lightmapped) | n | n |
| Lamp groups array `uLampTex` | c (groups present) | n (volume fill) | n | n | n | c | n | n |
| Slot crossfade, atlas side | c (multi-slot, not dropped) | n | n | n | n | c | n | n |
| Probe volume irradiance (`vProbeWorld`) | n | Y | Y | Y | Y | c (if not lightmapped) | Y | n |
| Sided lookup (`PROBE_SIDE`) | n | n | Y | n | n (excluded) | n | n (excluded) | n |
| Slot crossfade, probe side (`patchProbe`) | n | c (multi, not dropped) | c | c | c | c | c | n |
| Foliage bake scaling | n | n | n | c (covered plants) | n | n | n | n |
| Foliage slot blend (`patchFoliage`) | n | n | n | c (multi) | n | n | n | n |
| Occlusion height ramp `occl` | n | n | n | c (foliage not baked) | n | n | n | n |
| Face-direction normal `leafSide` | n | n | n | c (`garden-*`) | n | n | n | n |
| Sheer reflect/transmit (`sheerProbePatch`) | n | n | n | n | Y | n | n | n |
| Wet ground/puddle noise (`wetPatch`) | c (`puddles`: not plant class, wet>0 or multi) | c (`wet`, not garden/alphaTest) | c | n | c | c | c | n |
| Reflection-probe box lookup (`reflPatch`) | c (refl loaded) | c | c | c | c | Y (mirror margin, occlusion 1) | c | n |
| Lamp reflection layers in `uReflTex` | c | c | c | c | c | c | c | n |
| Sun PCSS (`pcss.patch`) | Y | Y | Y | Y | Y | Y | Y | n (stock shadows) |
| Sun-depth caster variant | Y (casters) | Y | Y | Y (cut-out depth) | n | n | n (glass not a caster) | n |
| Contact sun (2 samplers) | c (not dropped) | c | c | c | c (sun only; AO skipped, 2.5 #26) | c | c | n |
| Contact AO | Y | Y | Y | Y | n (marker consumed) | Y | Y | n |
| `createContact` wrapper (caster flag in key) | c (caster copies) | Y | Y | Y | Y | n | Y | n |
| Planar puddle reflection (wrapper) | c (ground materials only) | c (ground only) | n | n | n | n | n | n |
| `window overlay` ShaderMaterial on the pane | n | n | n | n | n | n | Y (panes) | n |
| hq mirror reflected-scene clone | c (in view of a mirror) | c | c | c | c | n | c | n |
| Emission handling (zeroing, copies following switch) | c | c | c | c | Y (GLSL zero) | c | c | legacy glow |
| TAA texture-bias wrapper (dormant) | c | c | c | c | c | c | c | c |
| Output pass (auto exposure, local adapt, AgX) | global | global | global | global | global | global | global | global |

---

## 4. Fragment sampler count per class

Rules from `fragmentSamplers()`; limits: Apple GPUs 16, NVIDIA 32. "Base" = `dfgLUT` (1) for every Standard/Physical material. `E` = `envMap` (+1, counted whenever the program has an env map and an IBL call survives; the baked envMap is the sunrise PMREM). Probe-lit rows were produced by running `probeLit` with the real fragment template; "-slots" adds the next-slot probe volume.

Probe-lit, measured (shadow map on, one directional shadow, contact + wet + 27 reflection probes + lamp reflection layers, `envMap` off / on):

| class (representative maps) | one slot | multi-slot (crossfade) | with `envMap` |
|---|---|---|---|
| PM: Standard, map + normal | 9 | 10 | 10 / 11 |
| PM: Physical, map + normal + roughness + metalness | 11 | 12 | 12 / 13 |
| PD: Standard, map + normal (sided) | 9 | 10 | 10 / 11 |
| FO: alphaTest, map (covered, foliage bake) | 8 | 9 | 9 / 10 |
| FO: no foliage bake | 8 | 9 | 9 / 10 |
| SH: Physical, map | 8 | 9 | 9 / 10 |
| MI: Standard, no maps (probe-lit) | 7 | 8 | 8 / 9 |
| GL: Physical, transmission | 8 | 9 | 9 / 10 |
| pet fur: Standard, map | 8 | 9 | 9 / 10 |

Breakdown of the PM row (9): `uProbeSH` 1, `uReflTex` 1, `uSunDepth` 1, directional shadow 1, `uContactDepth` + `uContactCoverage` 2, map 1, normal 1, `dfgLUT` 1; crossfade adds `uProbeNextSH`. Add **+1 for a planar puddle** on ground materials (PM only; the other rows never get it).

Lightmapped static (`lm`), by hand from the same rules, Standard with map + normal:

| config | count |
|---|---|
| lamp groups, multi-slot (shipped default): `lightMap` 1, `uSlotNext` 1, `uLampTex` 1, refl 1, PCSS 1, dir shadow 1, contact 2, map+normal 2, `dfgLUT` 1 | 11 |
| same, ground with planar puddle | 12 |
| no lamp groups, multi-slot: `uLmLamps` 1 + `uSlotNextLamps` 1 instead of `uLampTex` 1 | 12 |
| single slot, lamp groups | 10 |
| +roughness, metalness, AO maps | +3 |
| +`envMap` still counted | +1 |
| Physical with clearcoat maps | +up to 3 |

So a textured physical material (roughness, metalness, AO, normal, map) in the shipped config is 11 + 3 = 14 before `envMap` and puddle (15-16), which is where the stool teak frames overflowed (18 before the probe volume and reflection arrays were packed). The drop list recovers 4 samplers (puddle 1, contact sun 2, crossfade 1) and nothing else.
Mirror, lightmapped: `dfgLUT`, `lightMap`, `uSlotNext`, `uLampTex`, refl, PCSS, shadow, contact 2 = 9.
Legacy: `dfgLUT`, dir shadow, `uDaylightAmbient`, `uDaylightWindows`, `envMap`, rect-area LTC 2 when rect lights are visible, plus maps: 6 to 9 for bare materials, 10 to 13 textured. Legacy has no PCSS, contact, probe or reflection array.
GL window overlay (ShaderMaterial): `uReflTex` plus `tSky` or just `uReflTex`: 1 to 2.

---

## 5. Proposed design: one composed baked-material shader

### 5.1 Principles

1. **Roles, not patches.** A material gets a `bakeRole` once (a lighting manifest entry, see postmortem class A) instead of the role being inferred in five places from names (`^garden-`, `^plant`, `mirror`), `alphaTest`, userData and traversal.
2. **Generate once.** A pure function `composeBakedShader(role, features, params) -> { vertex, fragment, uniforms, samplers, key }` produces the text from declarative GLSL fragments. No code modifies text another module produced. The only external text injector left is the material's *own* hook (leaf, fur, wind, skin, SSR tag), which runs first on the stock template and is constrained to kept-include inserts (enforced by a test that diffs its output against the template).
3. **Features are flags decided before generation.** Sampler fitting is a pure function over the flags (`samplerPlan(flags, programParams) -> flags`), so the generated text never needs a post-hoc "drop". The same function feeds the key, so keys cover everything that changes source by construction: `key = hash(role, normalizedFlags, glslVersionOfFragments)`.
4. **One world-position varying, one probe fetch.** `vWorld` computed once (with the batching/instancing block once); the SH taps (incl. the crossfade blend) computed once per pixel and reused for irradiance, specular occlusion, clearcoat occlusion, foliage mean and the reflection occlusion.
5. **One place per cross-cutting term.** Wet, reflection probes, PCSS, contact, foliage, sheer, crossfade are `#ifdef`-style sections of one template with explicit insertion points, so ordering is a property of the template, not of call order.

### 5.2 Feature flags per role (declared, not computed ad hoc)

```
role            lightmap  probe  sided  foliage  sheer  mirror  wet  refl  pcss  contact{sun,ao}  slotFade  lampGroups
static          Y         -      -      -        -      -       c    c     Y     Y                c         c
static-mirror   Y         -      -      -        -      Y       c    c     Y     Y                c         c
movable         -         Y      -      -        -      -       c    c     Y     Y                c         -
door/toggle     -         Y      Y      -        -      -       c    c     Y     Y                c         -
foliage         -         Y      -      Y(bake?) -      -       -    c     Y     Y                c         -
sheer           -         Y      -      -        Y      -       c    c     Y     ao off by design c         -
glass           -         Y      -      -        -      -       c    c     Y     Y                c         -
pet/visitor     -         Y      -      -        -      -       c    c     Y     Y                c         -
legacy          (kept as is, behind a separate entry; fallback only)
```
Runtime-dependent flags (`wet`, `refl`, `slotFade`, `lampGroups`, `puddle`, `contactSun`) are resolved once per (material, device) from scene facts and passed in; `samplerPlan` removes optional ones in a **declared priority list** (extend today's list: planar puddle, contact sun, slot crossfade, then lamp-group array to the shared layer, then clearcoat/IBL occlusion).

### 5.3 Structure

- `web/src/baked/chunks/*.glsl.js`: each feature is `{ id, requires, vertexPars, vertexMain, fragPars, fragMain: {afterNormal, beforePhysical, irradiance, specularOcclusion, afterLightsBegin...}, uniforms(), samplers: n }`. The composer inserts them into **named slots of one generated `lights_fragment_maps` replacement and a handful of kept-include sites** (`project_vertex`, `normal_fragment_begin`, `lights_physical_fragment`, `lights_fragment_begin` for PCSS and contact sun, `alphamap_fragment`).
- `web/src/baked/compose.js`: `compose(role, flags)`; memoized by key; applies exactly one `onBeforeCompile` per material: `own.call(this, s)`, then `Object.assign(s, composed)`; asserts every marker the composition needs exists exactly once in the incoming template, with the same `shaderPatch` transactional behaviour and the `assertShaderPatches` startup gate.
- Everything shared between roles is data: `uniforms` live in one registry so the slot runtime, contact, puddles, lamp groups write to named objects, not to uniforms they hope the shader declared.
- `customProgramCacheKey` is derived: `ownKey + '|baked:' + composed.key`. `samplerCut` is a flag input, not an afterthought.
- Outer wrappers go away: contact's caster flag becomes a uniform (it already has no source effect besides the key), planar puddle becomes a flag with its own uniforms, TAA bias becomes a flag if TAA is ever wired. Material copies keep the manifest role in `userData`, so clone sites stop having to copy five fields.
- The sun-depth caster variant and the Reflector mirror surfaces stay separate programs; hq's reflection-surface patch becomes a role with a vertex-attribute roughness path written against expanded chunks (fixes finding 1).
- The OutputPass patches (auto exposure, local adapt, AgX) are a different problem: leave as they are for now, but fold the two plain `.replace`s in auto_exposure.js into asserted ones.

### 5.4 Test that compiles every combination

- **Enumerate**: product of role x {wet, refl, refl lamps, slotFade, lampGroups, contactSun, puddle, foliageBake} x {map sets: none, map, map+normal, map+normal+rough+metal+ao, clearcoat set, transmission} x {Standard, Physical} x {sided}; prune impossible pairs by the role table (about a few hundred). Seeded from the real scene: assert the set of roles/flag tuples actually present after `applyLightmaps` is a subset of the enumerated set.
- **Node level (no GPU, extends test_baked_shaders.mjs)**: for each combination, `compose`, expand three's include chunks exactly as three does (a 30-line `resolveIncludes`), then assert: every declared uniform/varying/function name is unique; every referenced uniform is either declared or built in; `fragmentSamplers()` <= 16 at the plan's final flags; key unique per distinct source (the test already exists for 16 variants, scale it); round-trip determinism (same flags -> identical text); and that the material's own hook output only differs from the template by kept-include inserts. Optionally run `glslangValidator` on the resolved source when present, with three's prelude, as a free syntax check.
- **Browser level (SwiftShader headless is enough, no GPU)**: the repo has playwright. A one-page script builds a `WebGLRenderer`, creates one mesh per combination and calls `renderer.compile()`, checking `getProgramParameter(LINK_STATUS)` and `auditPrograms()` counts against the plan. Add it to the packaging gate; it is the only thing that catches driver-specific failures (the Apple 16-unit case needs `MAX_TEXTURE_IMAGE_UNITS` forced to 16, which SwiftShader can emulate by lowering `renderer.capabilities.maxTextures` in the plan, and a real Mac run as the final check).
- Golden snapshot of the generated source per role during migration, so each step is a reviewable diff.

### 5.5 Migration order (each step ships, tests green, visual compare against the Cycles refs)

1. **Characterise.** Export the `lm` factory and `applyLightmaps` pieces needed to run it in node (as `probeLit` already is), and snapshot the current generated vertex+fragment for every role in the matrix (section 3) as goldens. Fix finding 1 (hq reflection-surface) first as a standalone bug with its own test, and add the "contact AO skipped on sheer" case to the goldens as the current behaviour.
2. **Extract the GLSL fragments without changing text**: `PROBE_GLSL`, `reflGLSL`, `wetPatch` text, `PCSS_GLSL`, `LM_SAMPLE`, `lampGroupGLSL`, `SUN_GLSL`, `AO_GLSL`, foliage and sheer blocks into `baked/chunks`. Pure move, goldens identical.
3. **Introduce `compose()` for the probe path** (PM, PD, FO, SH, GL, pets): fewest variants, and where the stacked-patch hazards (2.1 #2-#5, 2.5 #25-#26) live. Merge the world-position varyings and compute SH once here; goldens change deliberately, reviewed. Keep `bakedHooks` for the own-hook.
4. **Fold in the sampler plan**: replace `fitBaked`/`noPlanarPuddle`/`drop` side channels with `samplerPlan`; key derives from flags (removes 2.2 #12). Keep `auditPrograms` and `samplerCut` as a flag input.
5. **Lightmapped static path** onto `compose()` (LS, MI): atlas decode, lamp groups, slot crossfade as flags. Deletes the four-variant `lightMapIrradiance` string table.
6. **Planar puddle and contact caster** become flags/uniforms; remove the `createPuddles` and `createContact` wrappers and their key suffixes; puddles' `ground` set feeds the manifest instead of wrapping. This also removes lifecycle hazards 29-30.
7. **Manifest roles** (postmortem class A): replace name/alphaTest/traversal inference with `userData.bakeRole`, set where materials are made (decor.js, plants_parts.js, door/toggle roots). Add the "every mesh has a role; every role is in the enumerated set" check.
8. **Retire** `shaderReplace` callers outside the composer, `bakedHooks` (own hook becomes `userData.ownHook/ownKey`), `taa.js` wrapper (or port it as a flag if TAA is wanted), and the legacy wrapper only when legacy fallback is removed.
9. Perf pass last: with one SH fetch and one world position the probe path should be measurably cheaper (check with tools/perf.mjs on the living and garden views).

Open points I did not resolve: whether `envMap` really counts as an active sampler for every baked program (the audit would tell; the estimator is conservative); the fur/eye and garage-skin hooks assume the stock template, which the composer must keep presenting to them; `photo.js` builds its own materials for the path tracer and is outside this refactor.
