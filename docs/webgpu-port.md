WebGPU walkthrough spike — three 0.183.2
======================================

This is an isolated implementation of the baked diffuse path. It was written without a GPU; a later review ran it on a Linux GPU node (see **GPU verification** below), fixed three bugs and measured it. Diffuse lighting matches the WebGL baked path; specular, wetness, PCSS and other effects are not ported, and there is no measured speedup.

**GPU verification (2026-10-14).** Headless Chromium 145 (Playwright headless shell) on an NVIDIA RTX A6000 (Linux, driver 595, ANGLE/Vulkan). The shared deployed bake was used, with `tier=hq&lmres=full` on both paths (5900 × 5901 atlas, 4096 shadow map), at 1280 × 720 through the two Blender reference cameras.

- Backend: `WebGPU` on an `nvidia/ampere` adapter (not a fallback adapter), with `timestamp-query` and `float32-filterable`. `?webgpu=webgl` reports `WebGL2 fallback`. The default URL still loads the production WebGL walkthrough.
- Bake matching is identical to the production path: 1143 of 1199 units matched (0 by id and 1143 by bounds in this deployment, the same as WebGL); 449 lightmapped and 363 probe-lit node materials. The only omitted type is `ShaderMaterial`.
- Images, as the median |Δstops| against WebGL `?lightmap=sunrise` from the same build: living 0.067 (left wall −0.02, island −0.02, dining −0.08); garden 0.58 (wall −0.13, foreground plants −0.38, wet patio −0.72). The garden gap comes from missing PCSS (the WebGPU leaf shadows on the wall are sharp), missing wet ground/puddles and environment specular. Against Blender: WebGPU living 0.46 and garden 0.72; WebGL living 0.42 and garden 0.69. The WebGL2 fallback is within noise of WebGPU (its median Δ is the same).
- AgX: on 4096 test colours (grey ramp 2^-16..2^12, scaled primaries, cube edges, random values), the TSL LUT transform is bit-identical (max error 0/255 in float readback) to the GLSL `agx.js` on both backends.
- Frame time is CPU-bound on this node. Medians over 200 uncapped rAF frames after warm-up (garden / living): WebGPU 62 / 33 ms with GPU timestamps 2.8 / 2.2 ms; production WebGL 60 / 42 ms with GPU timer 5.5 / 11.7 ms (other runs ranged 60–193 / 42–59 ms because other jobs shared the GPU); WebGL2 fallback 107 / 83 ms. The production frame does much more work (MSAA, SMAA, GTAO, SSR, PCSS, reflection probes, puddles, pets off), so this is **not** a like-for-like speedup.

Bugs found and fixed during verification:

1. **WebGL2 fallback did not compile.** The AgX loads passed an explicit level `0`. r183 builds texture levels as float, so the GLSL backend emitted `texelFetch(…, 0.0)` and the output shader failed (blank frame). It now omits the level.
2. **Shadow map redrawn every frame.** Each redraw cost about 200 ms of CPU, because r183 re-derives the cache key of the shared shadow override material for every caster (about 1100 casters). The spike now redraws only while casters move, as `lighting.js` does: WebGPU CPU went from ~320 ms to 31–59 ms per frame. This remains a risk for a port: any frame that redraws the sun map (doors, garage, carried furniture) costs ~200 ms until the casters are merged or three fixes it.
3. **Decoded atlas bitmaps were never released.** For unsplit atlases they are now closed after upload, freeing about 140 MB of CPU memory per layer at full resolution.

**What is implemented.** `?webgpu` selects a separate bundle before `main.js` executes. The normal walkthrough still starts through `main.js`, but `dist/app.js` now comes from `src/webgpu/entry.js`. esbuild therefore wraps the `main.js` module graph in lazy initializers, which adds about 6 KB minified (about 2.4 KB gzipped). A WebGL render from the original entry and one from the new entry, built from the same source, give the same metrics (median Δ 0.000 stops; the remaining pixel differences are time-based foliage motion). The only edit outside the new folder and this document is the build entry line in `web/tools/build.mjs`. If `dist/webgpu.js` is not deployed, `?webgpu` fails with a module 404 and does not fall back. Both bundles include the shared scene builders; only one runs. No existing scene, lighting, material or UI module was edited.

The spike builds the actual house, procedural garden and furnished `Layout`, then calls the existing `batchStatic`, with the same doors, anchors and animated roots. It uses the existing `Player` for desktop walking/collision, updates plant LOD and room visibility, and supplies a lamp slider. It does not instantiate pets, the visitor avatar, interactions, tours, photo mode or the production UI. Unsupported ShaderMaterial meshes are hidden and their material types reported; original mirror overlays are already hidden by their constructor. These omissions must be included in any performance comparison.

Implemented rendering paths:

| Path | Implementation | Validation status |
|---|---|---|
| Renderer | `WebGPURenderer`, `await init()`, backend log; automatic fallback; `?webgpu=webgl` forces the same node graph through WebGL2 | Both backends run on the A6000 (after the AgX level fix); automatic fallback on a browser without WebGPU not tested |
| Atlas | v2 tone-curved WebP, manifest paths, compact/wide UV sidecars, stable IDs then tight bounds matching, normalized `uv1`; full/split, half, quarter atlases | Matches the production path exactly on the deployed bake (1143/1199); full unsplit atlas tested. The split-row and half/quarter tiers were not tested on GPU |
| Irradiance | `(Kslot*y²/max(1-y²,1/255) + lampLevel*Klamps*y²/max(1-y²,1/255))*PI`; K from `encoding.json`; both layers sample `uv(1)` | Compiles on both backends; living-room diffuse is within 0.07 stops of WebGL (median) |
| Materials | r183 node library maps Standard to `MeshStandardNodeMaterial`, Physical to its physical counterpart; `setupLightMap()` returns `IrradianceNode` | No emissive shortcut; standard direct-light BRDF remains |
| Probe volume | Same four-nearest weighting, doubled vertical distance, 0.5 m grid, three heights; RGB textures pack four L1 coefficients each; basis `(0.886227, 1.023328*ny, 1.023328*nz, 1.023328*nx)` | CPU sparse/signed-coefficient and lamp-update tests pass |
| Probe texture format | 51 × 55 × 3 RGBA16F textures, linear filtering, x/north/height axes; coefficients sum sky + sunind + lamps on CPU | Half-float quantization differs from existing float32; avoids optional `float32-filterable` dependency |
| Live sun | Same sunrise direction, target, intensity, RGB and orthographic coverage; native PCF shadows, glass excluded | No PCSS: penumbrae are visibly sharper than WebGL/Blender. The map is redrawn only while casters move (each redraw costs ~200 ms of CPU in r183) |
| Output | `RenderPipeline` + `pass(scene,camera)` HDR target; TSL port of both Blender AgX LUTs, matrices, log ranges, medium-high look, tetrahedral interpolation, exact OCIO sRGB branch | Bit-identical to GLSL `agx.js` on 4096 test colours, on both backends |
| GTAO | `?ao=1`: r183 addon `ao(depth, null, camera)`, depth-derived normals, half resolution, radius 0.25 m, eight samples | Optional experiment; multiplies scene RGB, including direct/specular light, so not a physically selective contact-only solution |

No environment diffuse or fake fill lights are installed: the atlas/probe irradiance is the entire indirect diffuse contribution. Original PBR base/normal/roughness/metalness/AO maps are retained by material conversion. Environment specular is also deliberately absent in this first graph, so metals, glass and glossy surfaces will differ substantially. Reflection probes, window reflection overlays, SSR, wetness/puddle material modifications and per-vertex foliage-bake corrections are not ported. Plants use the older probe height-occlusion term. Existing custom GLSL vertex deformation, including grass wind/thinning/widening, does not run; CPU instance counts and layout animation still update. The lamp slider changes atlas and probe lighting together, but does not synchronize every fixture's emissive appearance.

**Scene reuse and the needed refactor.** Importing `main.js` to obtain a scene is not viable: it constructs a `WebGLRenderer` immediately, creates `createLighting()`/EffectComposer passes before the house, calls WebGL-specific shader warming (`getContext`, KHR program queries), and owns the global UI/animation/photo lifecycle. `createLighting()` also constructs WebGL targets, PMREM and fake daylight lighting. The builders themselves do not require that renderer.

There is one less obvious dependency: `lighting.collectMaterials()` calls `collectLightSwitches()` (which marks emissive meshes as non-batchable and adds invisible pick proxies), then splits shared materials into interior/exterior uses. Those partitions affect `batchStatic` output and therefore exported bake IDs. `webgpu/scene.js` repeats only that CPU partition rule, including the stucco/soffit/roof exemptions. It intentionally does not run daylight ray tests or install shader patches. This copied rule must be extracted before a maintained port. ID/count diagnostics are mandatory: a successful image with mostly probe-lit static meshes is a failed lightmap proof. At least one match is required; partial matches are reported, not silently treated as parity.

Recommended shared boundaries after review: a renderer-free `buildWalkthroughScene()` returning roots/layout/fixtures/batch; a shared CPU material-partition step; pure sidecar parsing/relayout/matching/probe resampling; and renderer-specific material, shadow and output factories. Stable mesh/batch identity should ultimately be independent of shader material partitioning. Keep UI, renderer creation, render loop and texture disposal outside the scene builder. This spike copies the data logic instead of modifying files owned by concurrent workers.

**Exact r183 API findings.** These were read in the installed package, not inferred from a newer online example:

| Installed source under `web/node_modules/three/` | Consequence |
|---|---|
| `package.json`, `src/Three.WebGPU.js`, `build/three.tsl.js` | Version 0.183.2 exposes `three/webgpu`, `three/tsl`, node materials, `RenderPipeline`, `pass`, `texture3D` |
| `src/renderers/webgpu/WebGPURenderer.js` | Default WebGPU backend installs a WebGL2 fallback; `forceWebGL` is available; inspect backend after `init()` |
| `src/renderers/common/PostProcessing.js`, `RenderPipeline.js` | `PostProcessing` is already deprecated in r183 and aliases `RenderPipeline`; use the latter, with synchronous `render()` after initialization |
| `src/materials/nodes/NodeMaterial.js`, `MeshStandardNodeMaterial.js`, `src/nodes/lighting/IrradianceNode.js` | Override `setupLightMap`; it adds irradiance to the standard lighting context. `setupEnvironment` must not supply additional diffuse sky. There is no assumed `material.irradianceNode` shortcut in this implementation |
| `src/renderers/common/nodes/NodeLibrary.js` | `renderer.library.fromMaterial()` creates the corresponding node class and transfers material properties; it does not translate custom GLSL |
| `src/nodes/accessors/Texture3DNode.js` versus `build/three.tsl.js` | The source has a `texture3DLoad` helper, but it is **not publicly exported** in the installed build. Use exported `texture3D(tex, ivec3).setSampler(false)` **without a level argument**: an explicit level becomes a float and breaks `texelFetch` on the WebGL2 backend |
| `src/renderers/common/Textures.js`; both backends' `copyTextureToTexture` | `source.dataReady=false` allocates texture storage without a CPU upload; split ImageBitmaps can be copied into a single atlas. GPU validation must cover odd-height split rows and mip generation |
| `examples/jsm/tsl/display/GTAONode.js` | `ao` is an addon import, not a core TSL export; null normal input reconstructs normals from depth |
| `src/nodes/lighting/ShadowNode.js`, `src/lights/LightShadow.js` | Native shadow filtering has a `shadow.filterNode` hook. A PCSS port can use it, but blocker depth access, coordinate conventions and bias need testing |
| `src/renderers/common/Backend.js`, `webgpu/utils/WebGPUTimestampQueryPool.js` | `trackTimestamp`/`resolveTimestampsAsync()` are available, gated by device support. Resolution is asynchronous and can return a previous valid result |

The Phase 2 plan's “needs three 0.185+” is not a requirement for this subset: r183 already provides the necessary nodes. This does not establish that its temporal upscaling, fog or every desired production effect is ready.

**Custom GLSL migration inventory.** This covers every assignment/wrapper of `onBeforeCompile` found in `web/src` during this spike, plus helpers those wrappers invoke. (Since then the baked WebGL patches below, `probeLit`, `PROBE_GLSL`, `wetPatch`, `reflPatch`, `pcss.patch`, `contactPatch`, `patchPuddleReflection`, the foliage and slot patches, are flags of one composed shader, `web/src/shaders/compose.js`; the rows still describe what each feature does.) Files are concurrently edited; regenerate the inventory with `rg -n 'onBeforeCompile' web/src` before implementation. Difficulty is port plus validation, not a claim that the equivalent is already implemented. Low is roughly 0.5–1 engineer-day, medium 1–3, high 3–7, and very high at least a week; shared work overlaps.

| File / patch | TSL equivalent or disposition | Difficulty / spike status |
|---|---|---|
| `lightmap.js`: matched-material callback | `uv(1)` samples, tone decode, shared lamp uniform, `IrradianceNode`; omit environment diffuse | Medium; diffuse implemented |
| Same callback: baked specular occlusion and horizon gate | Separate specular environment lighting node, luminance-derived occlusion and world reflection direction mask; avoid scaling diffuse twice | Medium; deferred |
| `lightmap.js`: `probeLit` callback / `PROBE_GLSL` | `positionWorld`, `normalWorld`, `texture3D`, SH dot products in irradiance; retain instancing, normal maps and sidedness | Medium; implemented, half-float texture change |
| Same callback: foliage sidedness and height occlusion | Normal node/face direction plus height mask; per-vertex bake supersedes the height approximation | Medium; garden normals and height approximation only |
| Both callbacks: `wetPatch` / `wetten` | World-position noise and outside-house/up-facing mask into `colorNode`, `roughnessNode`, then water normal/specular nodes | Medium; deferred |
| Both callbacks: `reflPatch` | Box intersection to parallax-correct reflection direction; atlas/cube samples with roughness LOD; a specular-only lighting node (an `envNode` alone also supplies diffuse) | High; deferred stretch goal |
| Both callbacks: `pcss.patch` | `sun.shadow.filterNode` TSL blocker search + penumbra PCF; sampled non-comparison depth and correct WebGPU/WebGL depth range | High; native PCF only |
| Matched callback + `contact.js`: receiver wrapper / `contactPatch` | Contact masks from depth pass into `receivedShadowNode` for sun attenuation and a separate indirect diffuse AO term, preserving term separation | High; deferred; optional GTAO is not equivalent |
| `contact.js`: `depthOf` fur/card rejection | Node depth/shadow material with the same attribute-based `Discard` and vertex deformation; keep surface-only contact depth | Medium; deferred |
| `foliage_bake.js`: material wrapper and `.patch` called by `probeLit` | Decode `attribute('foliage','vec2')` in vertex stage, interpolate decoded values; scale probe irradiance/specular occlusion using mean SH; debug output node | Medium; deferred |
| `materials.js`: turf macro modulation | `materialColor`/map sample with additional low-frequency texture samples and `colorNode` multiplication | Low; deferred |
| `materials.js`: white-shell luminance remap | `colorNode` luminance and mix with original sampled albedo | Low; deferred |
| `grass.js`: `patch`, both regular and depth-only materials | `positionNode` with instance seed/rank, distance/density, wind and widening; common vertex graph in visible/depth/shadow paths; normal node for outward leaf normals | High; CPU density and garden normal treatment only |
| `furniture/plants_parts.js`: `leafShader` | `normalNode` for soft two-sided normals; alpha cutouts retained in scene depth/MRT; old normal-override output branch becomes unnecessary. Reset legacy `allowOverride=false` so native shadow override materials run | Medium; standard alpha maps retained and override flag reset, soft-normal parity deferred |
| `furniture/garage.js`: opening-plane skin lighting | World plane distance and front-facing node scale indirect diffuse/specular, or retire the fake fill factor with proper probe lighting | Low/medium; replaced by probes, needs visual review |
| `lighting.js`: `collectMaterials` callback | Retire daylight/fake bounce/window light rejection for baked mode. For unbaked mode: custom lighting model and volume samples, paint in color node | High if retained; CPU partition preserved, fake lighting omitted |
| Same callback: `hqEffects.patch` from `hq.js` | Native filter node for custom sun shadow kernel | Medium; replaced by native PCF in spike |
| Same callback: `daylight.patch` | 3D daylight texture sampling, selective rectangle/hemi attenuation and floor bounce in lighting nodes; do not put this back atop baked GI | High; intentionally omitted |
| `lighting.js`: `attachPet` | Probe irradiance replaces room/sky split and indoor sun fudge; physical direct sun remains shadowed | Medium; pets not instantiated |
| `hq.js`: reflection proxy `hqSurface` callback | `attribute('hqSurface','vec2')` to `roughnessNode` and `metalnessNode`, with shared vertex colours | Low for attributes, high for mirror scene parity; deferred |
| `reflections.js`: `markReflective` alpha tag | Prefer a named MRT reflection-mask output via `mrtNode`; retain true alpha for transparency. SSR consumes colour, mask, normal and depth passes | Medium; deferred |
| `puddles.js`: simplified reflection material callback | Explicit node variant for baked diffuse, omitting specular/normal/shadow/transmission work; no source-string removals | Medium; deferred |
| `puddles.js`: receiver wrapper / `patchPuddleReflection` | Projected planar texture, ripple normal node, validity mask and water Fresnel into indirect specular via a lighting-model extension | High; deferred |
| `pets/dog.js`: fur material | Skinned/instanced shell and card deformation from `aFur`/`aDir`, instance index, lag uniforms; strand discard/colour/roughness nodes; matching shadows | Very high; deferred |
| `pets/cat.js`: fur material | Skinned shell/comb deformation with `aShell`/`aFur`/`aComb`; strand discard, fur colour/occlusion and normals | High; deferred |
| `pets/cat.js`: eye lid callback | Shared lid mask drives `colorNode`, `roughnessNode`, `clearcoatNode` | Medium; deferred |
| `interact.js`: highlight callback copy | Clone the node material while retaining node graphs; modify colour/emissive uniforms without losing baked lighting | Low; interactions deferred |
| `furniture/light_switch.js`: callback copy | Clone/reuse node graph and emissive parameters, share baked lamp uniform/group controls | Low; CPU batch preparation reused, interactive switch port deferred |
| `webgpu/scene.js`: callback copies | Preserve existing CPU batch identity before conversion; no GLSL executes on WebGPU | Temporary compatibility code |

References to callback cache keys, saved callbacks and restoration (`hq.js`, `puddles.js`, etc.) do not introduce additional shader algorithms. Node graphs must enter node-material cache keys: the spike explicitly retains `NodeMaterial.customProgramCacheKey` and stores its irradiance graph as a node-valued material property.

Other custom GLSL is outside `onBeforeCompile` and still costs work: `agx.js` fullscreen output (ported here); `lightmap.js` v1 layer-combine fullscreen shader (not needed for v2), window Fresnel overlays and extra PCSS depth render; `reflections.js` SSR; `hq.js` Reflector material mutation; `contact.js` depth marching; `puddles.js` planar render management; `sky.js` atmosphere; `volumetric.js` march/bilateral composite; `taa.js` reprojection/history/resolve; and `photo.js` path-tracer/denoiser/exposure/output passes. A WebGL EffectComposer pass cannot simply be added to RenderPipeline. Photo mode should keep its own WebGL canvas/renderer initially; this spike does not promise a WebGPU port of the path tracer.

**What r183 does not give us automatically.** GLSL ShaderMaterial/RawShaderMaterial and shader-chunk substitutions do not migrate through its node library. Automatic WebGL2 fallback supports the new node graph; it does not recover old WebGL-only effects. `envNode` is not a specular-only replacement for our box probes. Native PCF is not our PCSS. The installed AO node is not a direct substitute for the custom movable-contact masks. There is no drop-in adapter for our composer, Reflector proxies, fur pipeline, temporal history or ray-marched fog. WebGPU compute features cannot be assumed to run on the WebGL2 backend. Device texture/buffer limits, optional timer/float-filter features and memory budgets must be checked on target hardware. No hardware ray-tracing API is used or needed for this spike.

**Browser support remains a planning assumption.** The one verified data point is Linux headless Chromium 145 (Playwright headless shell) with an NVIDIA Ampere GPU and the flags below: WebGPU worked with timestamp queries. `navigator.gpu` exists only in a secure context (an `http://127.0.0.1` page, not `about:blank`). Playwright's full (non-shell) Chromium build did not launch on that node, which is unrelated to WebGPU. There was explicitly no network verification, so this document does not assert current release/version or OS coverage for October 2026. Test `navigator.gpu`, adapter/device creation and the actual backend log, not just the user agent.

| Browser family | Planning assumption and required verification |
|---|---|
| Chrome / Chromium / Edge | Primary target for the Linux GPU proof. WebGPU availability depends on OS, GPU/driver and browser policy; Linux headless often needs explicit Vulkan/WebGPU flags. Reject SwiftShader/llvmpipe timings. Desktop success does not establish Android support |
| Safari / iOS WebKit | Treat WebGPU availability as OS/WebKit-version dependent and unverified here. Test a current physical Mac and iPhone/iPad separately, including memory pressure, alpha foliage and 3D textures. Do not infer iOS support from desktop Safari. Retain the WebGL2 fallback and the original walkthrough |
| Firefox | Treat enabled-by-default status and platform coverage as unverified. Test a supported release/OS and its default configuration separately from experimental preferences. Expect fallback wherever device creation is unavailable |

Use HTTPS or localhost for a secure context. Both backends can still fail if no usable device/context exists; initialization errors are shown in the spike panel. Device loss is recorded and stops the loop; recovery is not implemented. Touch walking UI is outside this spike, independent of rendering support.

**Run and verify.** Build from `web/` with `node tools/build.mjs`; CPU checks are `node src/webgpu/check.mjs`. Build outputs `dist/app.js`, `dist/webgpu.js` and `dist/showcase.js` plus maps. The existing package tool currently copies only `dist/app.js`: a verifier must explicitly deploy `dist/webgpu.js` too, or copy the built `dist/` directory to an isolated test site. Do not modify the shared deployment. The existing dev server is left untouched.

Open `http://localhost:8780/?webgpu&lightmap=sunrise` on a machine allowed to render, with the actual bake assets installed at the normal paths. Default tier is explicitly laptop, avoiding an extra WebGL device-detection context. `?webgpu=webgl&lightmap=sunrise` forces fallback for comparison. Options: `tier=hq|laptop|mobile`, `lmres=full|half|quarter`, `lamps=0..4`, `ao=1`, `agx=three`, `sunoff`, and the existing camera `x,y,h,p` conventions. There is no atlas-resolution fallback: a missing tier is an explicit error; use `lmres=full` on older bake deployments. Only sunrise and tone-curved v2 assets are supported. The old `batch=0`, `rawtone`, `taa`, `shafts`, `puddlerefl` switches have no effect in this entry.

The diagnostic object is `window.__webgpu`, not `window.__app`. It exposes `ready`, `error`, `backend`, `frames`, `stats`, `metrics()`, `setLamps(value)`, `scene`, `camera`, `player`, `layout`, `sun` and `post`. `ready` means a first frame was submitted, not that asynchronous GPU validation has passed. Wait for further frames and fail on any `error`. Camera motion from a verifier can use `player.teleport(...)`; for reference-camera matrices set `player.driven=true` before setting camera position/quaternion/projection. The existing screenshot harness assumes the production app and needs this adaptation.

On an authorized Linux GPU compute node, use headless Chrome with `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan` as starting flags (driver/browser dependent; verified on the A6000 node together with `--ignore-gpu-blocklist --disable-vulkan-surface`; add `--disable-gpu-vsync --disable-frame-rate-limit` for timings). Do not run this on the Mac or a cluster login node. A minimal Playwright gate, run from a location with its installed package and an already-served isolated site:

```js
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: [
  '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan',
] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://127.0.0.1:8780/?webgpu&lightmap=sunrise&lmres=half', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__webgpu?.error || window.__webgpu?.frames >= 300, { }, { timeout: 180000 });
const report = await page.evaluate(() => ({
  error: __webgpu.error, backend: __webgpu.backend, stats: __webgpu.stats, metrics: __webgpu.metrics?.(),
}));
if (report.error || errors.length || report.backend !== 'WebGPU') throw new Error(JSON.stringify({ report, errors }));
console.log(JSON.stringify(report, null, 2));
await page.screenshot({ path: 'webgpu-garden.png' });
await browser.close();
```

Required verification, before calling the bake port successful:

1. Record browser/driver/GPU, adapter details, backend, flags, build revision, atlas tier, texture tier, drawing-buffer dimensions and all errors/warnings. Confirm actual hardware acceleration. A fallback frame is useful compatibility evidence, not WebGPU evidence.
2. Compare matched/byId/byBox/unused counts against the production `?lightmap=sunrise` run using the same assets/layout. Audit unmatched static surfaces and omitted material types. Look for missing geometry, shifted doors, mirrored UV charts, seams and wrong atlas half ordering. Repeat at full split atlas and quarter tier; inspect the odd middle row and distant mip levels.
3. Render garden and living reference cameras, plus a close leaf/metal/glass view. Capture no-sun/no-AO diffuse comparisons to isolate the irradiance port. Compare raw HDR irradiance at known texels when possible: do not compensate a PI, colour-space or UV error by changing exposure. Move a probe-lit object through the garden/doorway/interior and across grid-cell and height boundaries; test signed SH lobes and both leaf faces.
4. Set lamps to 0, 0.25 and 1 with `__webgpu.setLamps(...)`; verify both lightmapped and probe-lit meshes respond without recompilation. Confirm double counting is absent with `sunoff`. Audit normal-mapped surfaces as well as flat normals.
5. Compare the TSL AgX LUT transform to `agx.js` on grey ramps, saturated primaries, black, extreme highlights and cube-boundary values. Target the reference implementation's quantization tolerance; require at most roughly one display code value before scene comparisons. Verify exposure and output conversion happen exactly once on both backends. `agx=three` is a diagnostic, not Blender parity.
6. Confirm sun shadow camera alignment, wall/roof occlusion, alpha-cut leaf shadows, moving casters, glass exclusion, and bias at grazing incidence. Expect sharper/less physical penumbrae than PCSS. Test AO off/on for halos and excess darkness on baked surfaces. Validate resize and device-loss reporting.
7. After warmup, hold each camera for at least 300 frames and record `metrics()`. Repeat AO off/on, LUT/three AgX, and both backends at identical pixel counts and object populations. `cpuSubmitMs` is the wall time around pipeline submission; `frameIntervalMs` includes scheduling/vsync. `gpuResolveMs` comes from r183's latest resolved render-frame timestamp sum and may be sparse/stale; verify full scene/shadow/post coverage with a GPU trace before calling it total frame time. If timestamps are unsupported report unavailable, never substitute CPU time. Keep separate cold-start and steady-state results.
8. Compare to the production WebGL path with pets/mirrors/SSR/PCSS and other missing work accounted for. A faster incomplete scene is not proof that the full port will be faster. Re-test an ordinary URL without `webgpu` as a regression gate.

**Phased cost and recommendation.** Estimates assume one engineer familiar with this code, access to a GPU verifier and stable baked assets; they include debugging and comparisons. They are not additive per-patch estimates.

| Stage | Deliverable / exit gate | Estimate |
|---|---|---|
| A: verify this spike | Compile both backends, repair any backend issues, validate IDs/UV/PI/SH/AgX, measure matched workload | 2–4 engineer-days; mostly done (2026-10-14). Remaining: split/half/quarter atlases, lamp slider, probe-lit movables, non-NVIDIA/Mac/iOS devices |
| B: shared scene/data boundary | Extract CPU construction/partitions/loaders, remove duplicate rules, preserve bake IDs; explicit lifecycle and separate photo renderer | 2–4 days |
| C: baked visual parity | Wetness, foliage corrections/wind, specular occlusion, box probes/windows, sun PCSS; per-camera comparisons | 5–9 days |
| D: walkthrough parity | Interaction/highlight/lamp state, pet fur/depth/shadows, mirror/SSR/contact decisions, fallback and device coverage | 5–10 days |
| E: Phase 2 additions | Temporal AA/upscaling/history rejection, froxel fog, sky unification, profiling and device tuning | 7–12 days |

A minimal maintained baked walkthrough is plausibly 3–5 working weeks after the GPU proof; full visual/interaction parity plus temporal/fog work is closer to 5–8 weeks with cross-device QA. The original 2–4 week Phase 2 estimate is plausible only if scope excludes substantial fur/reflection/temporal work or those efforts already exist. The spike does not show a speedup, and none is claimed. Measured on the A6000, both paths are CPU-bound, and r183's per-object render bookkeeping is no cheaper than WebGL's for this scene's 650–1900 draws (see **GPU verification**). Any performance case would have to come from merging draws or from the post stack, not from the API switch itself. These estimates still look plausible to optimistic. Pet fur and SSR/reflection parity are the most likely to overrun, and the shadow-redraw CPU cost above adds work to Stage C.

Primary risks are shader/material cache correctness across shared instances, CPU partition drift invalidating bake matches, texture orientation and colour conversion, 3D filtering precision, full-atlas memory (two 5900 × 5901 RGBA8 atlases with mips are approximately 354 MiB, before decoded bitmaps/source copies), loss of glass/metal/reflection fidelity, shadow refresh cost, temporal ghosting on animated foliage/fur, device feature gaps, duplicate bundles and the existing WebGL-only photo stack. Full resolution should be a measured opt-in on mobile. Half/quarter tiers reduce atlas memory quadratically.

Recommendation: keep `?webgpu` experimental and retain the current baked WebGL walkthrough. Stage A on the Linux GPU node passed for diffuse and AgX parity, but showed no performance advantage. Extract the shared CPU scene/data boundary (Stage B) only if WebGPU remains a goal for reasons other than speed, such as compute-based fog or TAA. Before broad effect ports, measure on the target devices (Mac, iPhone) and port PCSS and specular, because those are the visible gaps. Do not upgrade three solely because the plan said 0.185+, and do not promise WebGPU performance or browser reach until those measurements exist.
