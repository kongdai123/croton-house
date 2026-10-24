# Real-time at photo quality: plan

Goal: the live walkthrough looks like the Blender Cycles stills (sunrise after rain, soft lamps, wet garden,
mist) at 60 fps on an M-series Mac and 30 fps on an RTX laptop, in the browser.

## What we know

**The frame is fill-rate bound, and the expensive parts are the fakes.** Measured on an M3 Max at 2560 × 1440:

| View | GPU frame | Without GTAO | Without SSR | CPU submit |
|---|---|---|---|---|
| Living room | 33–35 ms | 29 ms | 34 ms | 8 ms |
| Front door | 32–38 ms | 23 ms | 33 ms | 10 ms |
| Kitchen | 29 ms | 19 ms | 29 ms | 5 ms |

Halving the pixel count halves the frame, so per-pixel work dominates: a forward pass against up to 23 lights
(12 rectangle lights), the daylight volume, the fake room bounce, and GTAO at 6–15 ms. All of that is there to
imitate global illumination, and it still reads as CG next to the path-traced stills.

**The browser has no ray-tracing hardware access.** WebGPU has no ray-tracing or ray-query feature. Experiments
exist (a Dawn fork, wgpu's experimental ray queries in native code), but nothing ships in browsers, and outside
estimates put it at 2027 at the earliest. Real-time ray tracing in the page means software BVH traversal in compute.

**The lighting that matters is small to store.** The exported scene, measured by surface area:

| Part | Area | Triangles | Lighting approach |
|---|---|---|---|
| House shell, built-ins, fixed furniture | about 3,000 m² | 1.1 M | lightmap |
| Garden hardscape near the house | 1,800 m² | 1.1 M | lightmap |
| Lawn and far ground plane | 26,600 m² | small | coarse lightmap (25 cm) |
| Plants and trees | 12,800 m² | 2.2 M | probes, no lightmap |
| Glass | 73 m² | small | none |

At 2 cm per texel indoors and 8–25 cm outdoors, one full lighting state fits in **about one 4096² atlas**.
Encoded as RGBM in a KTX2 texture, that is roughly 5–8 MB to download and 16 MB of GPU memory.

## The approach: bake what does not move, keep live what does

| Light | Changes when | Real-time form |
|---|---|---|
| Sky light and every bounce | time of day, weather | **Baked** lightmap per time slot, crossfaded |
| Lamps | switched, dimmed | **Baked** one single-channel layer per lamp group, four groups per texture, scaled live |
| Direct sun and its shadows | any sun angle | **Live**: one sun, soft shadows (PCSS) sized to the sun's 0.5° |
| Movable furniture, doors, pets, the visitor | always | **Live**, lit from a baked probe grid; contact shadows |
| Reflections | rarely | Baked reflection probes per room, SSR on floors and counters, planar reflection for puddles |
| Mist and light shafts | weather | **Live** froxel fog sampling the sun's shadow map (WebGPU compute) |
| Wet ground, puddles | weather | Live material parameters and a baked puddle mask (the same rule as photo mode) |

Why this is the right trade:
- **Quality.** Cycles computes the indirect light, the soft lamp shadows and the ambient occlusion, which is
  exactly where our renders and Blender's differ. The live sun keeps hard-edged detail and motion.
- **Speed.** The forward pass becomes one lightmap fetch plus one real-time light. Baked AO lets GTAO drop to a
  cheap contact-only pass. Together that removes most of the 33 ms. The estimate is 10–14 ms at 1440p on the
  M3 Max, before any upscaling.
- **Interactivity.** Lamps stay switchable because light adds linearly. The sun can move continuously: its direct
  light is exact, and only its bounce steps between baked slots, under a crossfade.
- **Reach.** Lightmaps work in the current WebGL 2 renderer and in three's WebGPU renderer, which also has
  light-probe nodes. Phone and older-browser visitors get the same look, which a WebGPU-only approach cannot give.

### Time of day
Five baked slots cover the moods: sunrise after rain, morning, noon, golden hour, and blue hour/night (sky dim,
lamps on). The opening slot loads with the page and the others on demand. A later upgrade can replace slots with
**precomputed radiance transfer**: bake each texel's response to a few spherical-harmonic sky basis lights, about
8 Cycles bakes with positive and negative lobes. Then any sky and any sun angle produce matching bounce light at
run time, from 4 textures. This is a well-proven games technique (Far Cry 3, Halo 3). Keep the data format ready
for it, and build it only if fixed slots feel limiting.

### What stays out of the lightmaps
- Plants and trees (2.2 M triangles of leaf cards): probe-lit, with the live sun and its shadows.
- Anything the visitor can move (the interact list) and the pets: they are left out of the bake entirely so they
  leave no ghost shadow when moved. GTAO supplies their contact shadows.
- Doors are baked in their default state.

## Pipeline

1. **Lightmap UVs at build time.** Run xatlas (`xatlas-web`, already a peer dependency of the tracer) on each
   static source mesh before `batchStatic` merges them, so the merged meshes keep a valid second UV set. Pack into
   one atlas, with padding against seams. The UVs ship with the site.
2. **Export** the static scene with those UVs and stable mesh IDs. The GLB exporter used for the Blender stills
   already exists.
3. **Bake on the 3070** with the existing Blender 4.5 setup (OptiX, OpenImageDenoise):
   - per slot: diffuse lighting only, no albedo, sky plus sun, glass open to light (as in `setup.py`);
   - per lamp group: that group alone at unit power;
   - a probe grid (L1 spherical harmonics; 0.5 m indoors, 2 m outdoors) and a reflection cubemap per room.
   Expected time: tens of minutes per slot at 4K. A full rebake is an evening, run on the Windows machine.
4. **Encode** to KTX2 (RGBM in UASTC for wide support; BC6H where available).
5. **Validate on the Windows machine, not the Mac.** Install a portable Node and Playwright there, render the same
   cameras live and in Cycles, and compare with an image metric (FLIP or SSIM) plus side-by-side sheets. The
   Blender stills from 2026-10-13 are the first reference set.

## Phases

**Phase 0: one-room proof (2–3 sessions)**
- UVs, a bake and the shader hookup for the living and dining room only, one time slot, lamps as one layer.
- Success means the live view of that room is visually close to the Blender still, at a frame time measured on
  the 3070 and the Mac.

**Phase 1: whole house on the current renderer (1–2 weeks of sessions)**
- All static meshes, five slots, lamp groups, probe grid, reflection probes, puddle mask.
- Remove the fakes: window fill lights, daylight volume, bounce environment, hemisphere light, the rectangle lamps.
- Soft sun shadows (PCSS), contact-only GTAO, AgX and the photo-mode look.

**Phase 2: WebGPU renderer (2–4 weeks)**
- three's `WebGPURenderer` with TSL node materials (needs three 0.185+). Port the custom shader patches.
- Temporal anti-aliasing with upscaling from about 0.7× resolution. This replaces 4× MSAA and SMAA, and is the
  same trick MetalFX plays for Cyberpunk on these Macs.
- Froxel volumetric fog, a physical sky shared with photo mode, and the WebGL 2 path kept as a fallback.

**Phase 3 (optional): fully dynamic bounce**
- Either the PRT upgrade above, or DDGI. **Speedball GI** (MIT, three.js WebGPU, BVH-traced probes, maintained
  through 2026-09) does DDGI and glossy probe reflections today. Its own README warns of light leaking and targets
  small-to-medium scenes, and it is WebGPU only. Worth a spike once Phase 2 lands, not a foundation.

## Risks

- **Seams and leaks** at wall–floor joins and thin walls. Mitigations: padding, dilation, and a texel-validity
  pass that ignores texels buried inside geometry.
- **Batching.** UVs must be generated before `batchStatic` merges meshes, or the merge must carry them through.
- **Layout changes** require a rebake. Script the full chain so it is one command on the 3070.
- **Download size.** About 6 MB per slot plus lamp layers. Lazy loading keeps the first visit close to today's.
- **Probe-lit objects** read a little flatter than lightmapped ones. Keep them few and give them GTAO.

## Frame cost with the bake, measured 2026-10-24

`web/tools/perf_gpu.mjs` on a GPU node (RTX 2080 Ti, Xeon Silver 4216 at 2.1 GHz, headless Chromium on ANGLE/Vulkan),
hq, 2560 × 1440, `?fps=0`, ten gate cameras and a 49 m walk, builds interleaved in one job:

- **The frame is bound by draw submission, not by pixels.** At 1280 × 720 it costs the same as at 1440p. The main pass
  takes 75-85% of it at 15-25 µs per draw (three's per-object bookkeeping, WebGL validation, ANGLE), so the draw count
  decides the frame: 600-3000 draws, 26-56 ms per frame on this CPU. The pixel work (GTAO ~5 ms, SSR, SMAA, output,
  the puddle reflection 3-10 ms) runs alongside it on the GPU.
- **Room culling** (`src/visibility.js`): the plan's spaces and openings as portals; outdoors the house hides the far
  garden. Only the walkthrough camera skips what is hidden, so shadows and reflections are unchanged. Draws fall by
  40-90% indoors and 15-35% outdoors; `tools/cull_check.mjs` proves frames identical with culling on and off.
- **Sun-shadow cache**: base redraws used to cost ~55 ms of CPU (every caster) and came with every hover highlight and
  door click. The highlight no longer counts as motion, and a caster leaving or rejoining base redraws only the texels
  around it (pixel-identical to a full redraw).
- **Frame pacing** (`src/frame_rate.js`): the display's rate when frames fit, else an even fraction of it.
- **Left**: merge the far plants' frozen copies across plants (300 draws in a garden view; the per-vertex foliage bake
  and its slot crossfade must follow the merge), keep the hidden merge originals out of the render traversal (three
  walks ~8000 nodes per render), the aim raycast (`interact.js`, 1.5-2.5 ms) and the sun-shadow cache's per-frame
  change scan (~2 ms). The WebGPU spike measured no gain at this draw count; draws have to go first either way.

## Photo mode, built 2026-10-13

Path traced in the browser: guided denoiser, AgX, physical sky with a placeable sun, mood words in Chinese and
English, mist, wet ground and puddles, a real camera (focal length on full frame, tripod height, level, aperture,
focus), lens finish, sizes to 4K, PNG export and a gentle 30% GPU option. It remains the stills tool. Its sky and
mood presets should drive the bake slots, so a mood looks the same in a still and in the live view.

## Sources

- WebGPU ray tracing status: [gpuweb roadmap notes](https://kaelan.fyi/research/webgpu-future-roadmap/),
  [wgpu ray tracing spec](https://github.com/gfx-rs/wgpu/blob/trunk/docs/api-specs/ray_tracing.md),
  [Dawn ray tracing fork](https://github.com/maierfelix/dawn-ray-tracing)
- [three.js WebGPURenderer manual](https://threejs.org/manual/en/webgpurenderer)
- [Speedball GI](https://www.jsdelivr.com/package/npm/speedball-gi)
- [Baking lighting for the web](https://www.svilenkovic.com/3d/how-to-bake-lighting-for-web)
