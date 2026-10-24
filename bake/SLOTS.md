# Baked time presets

All commands run from `bake/` on a **cluster compute worker**, never the login node or the Mac.
Use the current stable scene/layout version in place of `v2` if it differs; all four slots MUST share
`lightmap_uv.bin` and the exact exported geometry. `BLENDER` is the worker's Blender 4.5 executable.
No re-export or re-unwrap is needed. `scripts/slots.py` is the source of truth; `{"slot":"noon"}`
works in every light/probe/sky/foliage pass. The original sunrise config is unchanged.

| Slot | Sun az / el (degrees) | Sun strength / linear RGB | Sky / dust | Lamps | EV (auto exposure indoors: key; range) | Wet |
|---|---|---|---|---|---|---|
| sunrise | 58 / 8 | 20 / 1,.68,.45 | .45 / .8 | 1 | -.7 (.66; -.5 .. +7.1) | yes |
| noon | 180 / 57 | 36 / 1,.95,.88 | .55 / 1 | 0 | -.7 (.66; -.5 .. +6.6) | no |
| golden | 255 / 7 | 16 / 1,.56,.28 | .38 / 2 | 1 | -.55 (.66; -.5 .. +7.1) | no |
| dusk | 263 / -4 | 0 / 1,.42,.20 | .35 / .6 | 1 | 3.1 (.35; -.5 .. +4.7; garden +3.5) | no |

Mid-October Sarasota moods: high southern noon, warm low western golden hour, cool blue hour
with full warm house lamps. Sunrise retains the calibrated east-northeast after-rain art direction.
Dusk has no direct sun; its Nishita world is multiplied by RGB .36,.52,1, with cool cloud colours, at a strength (0.35,
bake v4; 3.0 before) that puts its light at a few per mille of noon's, so the lamp-lit rooms read 2-4x the garden's ambient
(the classic twilight: warm windows, deep blue exterior); the display EV (3.1; 0 before) keeps the exterior's look.
EV is a display exposure, never baked into linear EXRs/HDRs. Lamps are always 3000 K at their fixtures' physical output
(scripts/fixture_lights.py); the slot's lamp level is the share of them on by default (the shared lamps layer's level,
the site's fallback without lamp groups). With physical lamps the rooms are daylight-led at sunrise and golden hour and up to
~4.5 EV below the garden: the auto-exposure ranges leave that headroom.

Indoors the visitor's exposure meters the frame (a centre-weighted log mean, so windows barely move it) and shows that mean at
the slot's key: 0.66 by day, which the site's AgX shows at 191/255, the median of the listing photos' interiors
(web/tools/golden/listing_brightness.json: bright, airy, white walls near 220-240), and 0.35 at dusk (~160: lamp-lit rooms
that glow against the blue outside). The first key, 0.15, was a mid-grey meter and showed every room at ~100/255. Gate (c)
holds the visitor's rooms to the photos (bake/validate/thresholds.json brightness). Outdoors the visitor's exposure is the slot's EV
plus its garden offset (0 by day; +3.5 at dusk: with physical lamps the blue-hour garden at EV 3.1 read 4/255 against the
listing's twilight photos of the patio, 69-121); the EV alone stays the fixed exposure of the gate's fixed set and the
Cycles references.

Default switches (lamp groups): sunrise, golden hour, dusk every interior switch (a staged showing); noon only the spaces no
daylight reaches (closets, the hall, the laundry, the linen and walk-in closets) and the garage (declared); the porch at
dusk only (web/src/lighting_roles.js defaultSlots).

## Prepare one dry scene (compute worker)

```sh
"$BLENDER" -b --python-exit-code 1 -P export/setup.py -- scene/v2/croton_lm.glb scene/v2/switches.json scene/v2/scene_lm_dry.blend --dry
```

`switches.json`: export/switch_groups.mjs of the same site (the lamps, scripts/fixture_lights.py). This imports the SAME UV-bearing GLB,
with only the after-rain material treatment skipped; it does not alter the shipped sunrise scene.
For reflection probes use this dry scene too (movables are retained by setup, hidden only by layer bakes).

## Queue atlas and diffuse probes FIRST

Use the group's current count (example: 16) and 1024 atlas samples. Sunrise bakes all three layers;
new slots default to **sky + sunind**, including eight diffuse probe chunks per layer. Tasks contain
absolute slot settings, so workers need no special slot interpretation. `--scene PATH` overrides the defaults.

```sh
python3 scripts/make_tasks.py sunrise 16 1024 v2 probes
python3 scripts/make_tasks.py noon    16 1024 v2 probes
python3 scripts/make_tasks.py golden  16 1024 v2 probes
python3 scripts/make_tasks.py dusk    16 1024 v2 probes
```

Existing sunrise outputs/tasks are skipped. New slots reuse sunrise's unit **lamps** atlas and
probe chunks. `--layers sky,sunind,lamps` explicitly requests an independent lamps rebake.
The pool operator can start queued tasks immediately, before panoramas/foliage finish.

## Remaining passes per slot

Run the following for each `SLOT=sunrise`, `SLOT=noon`, `SLOT=golden`, `SLOT=dusk`:

```sh
SLOT=noon
SCENE=scene/v2/scene_lm_dry.blend
# For sunrise only: SCENE=scene/v2/scene_lm.blend
CFG=$(python3 scripts/slots.py "$SLOT")
mkdir -p "bakes/v2/$SLOT/refl" "bakes/v2/$SLOT/foliage"
"$BLENDER" -b --python-exit-code 1 "$SCENE" -P scripts/skypano.py -- "$CFG" "bakes/v2/$SLOT/sky_bg.hdr"
"$BLENDER" -b --python-exit-code 1 "$SCENE" -P scripts/reflprobe.py -- "$CFG" "bakes/v2/$SLOT/refl" 0 27 --plan scripts/plan.json --layout bakes/v2/refl_layout.json
# Reflection ranges [i0,i1) may be distributed across workers; daylight only (the lamps are the lamp groups' layers, REBAKE.md).
FOLCFG=$(python3 -c 'import json,sys; c=json.loads(sys.argv[1]); c.update(glb="scene/v2/croton_lm.glb",out="bakes/v2/"+sys.argv[2]+"/foliage/foliage.npz",samples=512); print(json.dumps(c))' "$CFG" "$SLOT")
"$BLENDER" -b --python-exit-code 1 "$SCENE" -P scripts/foliage_bake.py -- "$FOLCFG"
.venv/bin/python scripts/foliage_pack.py "bakes/v2/$SLOT/foliage/foliage.npz" "bakes/v2/$SLOT/foliage.bin.gz"
.venv/bin/python scripts/probe_pack.py "bakes/v2/$SLOT" --lamps-from bakes/v2/sunrise --refl "bakes/v2/$SLOT/refl"
```

Foliage includes sky, sunind, lamps and sunvis: its geometry-local lamps values remain in the
small per-slot sidecar; the large static lamps WebPs are shared. Dusk sunvis is zero, without division by zero.

## Composite, encode, publish (after sunrise lamps are composited)

```sh
# Sunrise, once (existing results can be retained):
"$BLENDER" -b --python-exit-code 1 -P scripts/composite_v2.py -- bakes/v2/sunrise
# Each of noon, golden, dusk:
"$BLENDER" -b --python-exit-code 1 -P scripts/composite_v2.py -- "bakes/v2/$SLOT" --lamps-from bakes/v2/sunrise
# Every slot:
.venv/bin/python scripts/encode_webp.py "bakes/v2/$SLOT" --split
"$BLENDER" -b --python-exit-code 1 -P scripts/downscale_atlas.py -- "bakes/v2/$SLOT" --mask "bakes/v2/$SLOT/coverage.npy"
```

Publish encoding.json, slot_0/1.webp, half/slot.webp, quarter/slot.webp, foliage.bin.gz under
`assets/lightmaps/v2/<slot>/`; probes.bin, sky_bg.hdr and refl/ under `assets/lightmaps/<slot>/`.
Publish lamps_0/1.webp, half/lamps.webp and quarter/lamps.webp **only under v2/sunrise/**.
The shared lamp K/rows come from sunrise encoding.json; each new encoding records lampsSlot=sunrise.
Keep scratch lamps EXRs/arrays in bakes/ for compositing; do not publish duplicate WebPs.
`web/tools/package.py` discovers encodings and hashes all available slot assets into manifest.json.

## GPU verifier handoff (not run on Mac)

Build locally, deploy a separate site copy, then on the GPU worker run `validate/check.sh` for each
`lightmap=<slot>&tier=hq&lmres=full`. Compare sunrise against the current release; check noon's south
shadows, golden's warm western shadows, dusk's blue exterior/warm lamp pools and non-glowing unlit cloth.
Cycle N repeatedly during loading and fading; interrupt a slot request with missing/corrupt data: the old
scene must remain complete. Check half/quarter tiers, context restore, mobile controls, English/Chinese,
wet sunrise -> dry noon -> dusk -> sunrise, tour dusk and return, fixture glow, foliage, glass/reflection
probe blends, and decoded irradiance at the fade midpoint. Inspect console for shader/fetch warnings.

Example verifier runs on the cluster (use a separate deployed site directory as the third argument):

```sh
validate/check.sh slots-sunrise 'lightmap=sunrise&tier=hq&lmres=full'
validate/check.sh slots-noon 'lightmap=noon&tier=hq&lmres=full'
validate/check.sh slots-golden 'lightmap=golden&tier=hq&lmres=full'
validate/check.sh slots-dusk 'lightmap=dusk&tier=hq&lmres=full'
```
