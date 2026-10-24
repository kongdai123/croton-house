# White balance of the baked walkthrough

Status: on by default with the auto exposure (2026-10-24). Code: `web/src/white_balance_policy.js` (pure policy),
`web/src/white_balance.js` (runtime), applied in `web/src/agx.js` and in `web/src/auto_exposure.js`'s patch of three's
OutputPass, created in `web/src/lightmap.js` next to the auto exposure. Tests: `web/tools/test_white_balance.mjs` (policy,
lookup, wiring), `web/tools/test_white_balance_bake.mjs` (the shipped bake, and the rendered walls below).

## Why

The virtual camera never white-balanced. The frame went from scene-linear light to Blender's AgX with only an exposure,
so its colour was the light's colour: the 3000 K lamps (after their bounce about 2750 K, linear Rec.709 about
1 : 0.42 : 0.12) made every lamp-lit interior uniformly orange at sunrise, golden hour and dusk (a white wall displayed
as 208/150/93), and daylight-only rooms took the sky's and the garden's tint. The listing photos are white-balanced:
white walls read white or warm-white, never orange. A camera does this with a white-balance setting and an eye with
chromatic adaptation; neither is a grade.

## What it does

1. **The adapting illuminant comes from the bake**: the probe volume (`lightmap.js` `buildProbeVolume`), per 0.5 m cell
   the first-order SH per colour of the baked incident light (sky, the sun's bounce and every lamp group at its live
   level and colour; a switch refills it). Each frame the runtime reads the volume's CPU copy exactly as the composed
   shader does (`probe.glsl.js` `probeFetch`: trilinear, the cells across the house's outline left out, the slot
   crossfade's next volume blended in).
   - **Indoors: the light on the surfaces in view.** Five rays across the view (-30..+30 degrees about the horizontal
     view direction, at eye height) run to the first plan wall piece (openings let them through) or to where they leave
     the room's side of the house's outline (a window), at most 8 m. 0.4 m short of there the probe irradiance facing
     back along the ray, evaluated as the shader lights a probe-lit surface (`probeEvalL1`), is the light on a white wall
     there; the five are summed, so brighter walls weigh more.
   - **Outdoors: the mean light at the eye** (the probe's L0 at the eye and 1 m and 2 m ahead): the sky is much of the
     view.
   - In a doorway the two colours blend at equal luminance by the plan's indoor weight (`plan.indoorWeight`).
   The first version used the eye's mean light indoors too. Measured against the walls of rendered frames (below) it
   missed by up to 165 mired: a camera beside a lamp-lit doorway (the primary bedroom next to the kitchen at golden hour)
   took the warm light behind it, and the daylight room in front turned teal. The walls in view miss by 9.6 mired on
   average.
   The live direct sun is left out. Indoors it lights patches, and the light that fills a room is its bounce, which the
   probes hold. Outdoors at golden hour and sunrise the sun is the golden part of the light; the eye's adaptation there
   is anchored by the sky (a sunlit wall reads golden against blue shadows), and an illuminant with the sun in it would
   neutralise exactly the colour the slot is about.
2. **Clamped to a plausible illuminant**: a colour temperature and a tint (CIE 1960 uv, Krystek's Planckian locus),
   2500-10000 K and Duv within +-0.012, so light off one coloured surface (the orange sofa, the oak floor) can pull the
   reading only that far. The tint range covers the garden-green daylight of the noon rooms (+0.007..+0.013). Below a
   luminance of 1e-4 (a closet in the dark) the previous colour is held.
3. **Partial von Kries adaptation in CAT16 cone space** towards the display white (D65), per cone
   `gain = D * white / illuminant + 1 - D` at equal luminance. D = 0 is the identity, D = 1 makes the illuminant neutral;
   at any D the illuminant keeps its luminance, so the auto exposure's meter is unaffected. The degree is `0.8` indoors
   (an interior photographer's white balance: under the lamps a white wall displays warm-white, about 178/166/158,
   instead of 208/150/93; 0.75 read cream, 0.85 almost daylight-neutral) and `0.4` outdoors (golden hour stays golden,
   blue hour stays blue), blended by the indoor weight.
4. **Eased in time**: temperature (in mired), tint and degree glide with a time constant of 1.5 s, frame-rate
   independent; a jump of more than 1.5 m in one frame (a teleport, a tour cut) snaps, as do the first frame and a
   restored WebGL context.
5. **Applied in scene-linear, before exposure and AgX**, as one 3 x 3 matrix: folded into AgX's input matrix
   (`uIn = IN x white balance`: no extra work per pixel, and exactly IN without one), and after the exposure in three's
   OutputPass fallback (`?agx=three`). Local adaptation scales luminance per pixel and commutes with it.

## When

On with the auto exposure, i.e. what a visitor sees. Off with `?wb=0`, and never with a fixed exposure (`?capture`,
`?fixedexposure`, `?rawtone`, `autoexp=0`): gate (c)'s fixed set stays comparable with Cycles (AgX's input matrix is
then exactly IN; fixed frames of this build and of master differ only by the gate's run-to-run noise, 0.08/255 mean).
`?wbd=<indoor>,<outdoor>` overrides the degrees (calibration). `window.__app.lighting.whiteBalance.state` shows the
illuminant, its raw and clamped temperature and tint, the degree, the matrix and the CPU time of the last update.

## Cost

CPU only, about 0.01 ms a frame (node on the shipped bake: median 0.009 ms, p99 0.023 ms): five wall-ray tests against
the plan's 120 wall pieces and up to eight probe lookups. No GPU pass, no readback, no texture; nothing to rebuild after
a context loss.

## Checked against the rendered walls

`web/tools/golden/white_balance_walls.json` holds the light on the white walls of eight rooms' gate (c) visitor frames
at sunrise, noon, golden hour and dusk, rendered with `&wb=0`, as shipped and with every lamp group's gain / 64 (the lamp
recalibration's balance): Blender AgX inverted on hand-picked wall boxes, over the wall paint's albedo
(`web/tools/wb_walls.py`). `test_white_balance_bake.mjs` holds the adapting illuminant to them (mean under 12 mired, the
worst under 80: the office at golden hour with the recalibrated lamps, -69, where the dining pendant lights the measured
wall more than the walls in view) while the bake is the one measured; after a rebake it prints the error and how to
re-measure instead (the frames: a gate (c) visitor run of those cameras with `&wb=0` appended to the page query).

## Lamp surfaces glow in their light's colour (fixed in 9c4dfe2)

The lamp surfaces' emissive colours used to be cooler (about 5500-3300 K) than the light the bake gives their lamps
(3000 K, about 2750 K after the bounce), so white-balanced to the room a lantern read light blue. Now there is one rule:
the site glows each lamp surface in its group's baked colour (encoding.json, lamp_groups.js), and the bake uses 3000 K
(bake/scripts/fixture_lights.py); `web/tools/test_runtime_fixes.mjs` checks it.
