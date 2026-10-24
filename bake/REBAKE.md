# Combined rebake runbook

One rebake of everything baked: the four time slots (sunrise, noon, golden, dusk: lightmaps, light probes, foliage,
sky), the lamp groups (lightmaps + probes), the daylight reflection probes per slot and the lamp groups' reflection
layers. The lamps are physical (since v4): every light switch is one light of its fixture's declared output in lumens
(web/src/lighting_roles.js FIXTURE_OUTPUT, refined per fixture and placement row), made by `scripts/fixture_lights.py`
for every Blender scene from the site's switch records (switches.json), converted by ONE constant, `LM_PER_W` (lumens per
Blender watt, 6400: the open-plan rooms' lamps at dusk give their desks ~0.2x their noon daylight). No hand gains: every
group packs at 1 (`lamp_groups_pack.py pack` without `--gains`). Placeholders: `$HOST` the cluster login node, `$R` the croton folder on the cluster, `$V` the bake version
(a new folder name, e.g. `v3`), `$B` = `$R/tools/blender-4.5.14-linux-x64/blender -b --python-exit-code 1`,
`$P` = `$R/.venv/bin/python`. The cluster wrappers (`job.sh`, `run.sh`, `worker.sh`, `submit_pool.sh`,
`requeue_stale.sh`) live in the git-ignored `bake/cluster/` and in `$R/scripts/`.

## Rules (cluster)
- The login node runs only file operations, rsync/scp, `sbatch`/`squeue`/`scancel`. Every Blender, Python, node or
  Chrome step below runs in a scavenger GPU job: `sbatch --job-name=<name> scripts/run.sh bash -c '...'` (one GPU, exits
  when done) or as a task of the pool. Never the CPU queue, never anyone else's job.
- At most 30 GPUs across all croton scavenger jobs. `scancel` only jobs you submitted.
- One shared ssh connection: start long work detached (`sbatch`) and poll with one short ssh at most every 60 s.
- Steps that need Blender with numpy: `export CROTON_SITE_PACKAGES=$R/.venv/lib/python3.11/site-packages`.
- Node + Chrome: `export PATH=<node bin dir>:$PATH PLAYWRIGHT_BROWSERS_PATH=$R/tools/pw` (bake/cluster/env.sh NODEBIN).

## Current folders (2026-10-16)
| Folder | What |
|---|---|
| `scene/v4/`, `bakes/v4/`, `site_v4/` | the physical-lamp rebake of 2026-10-24 (lumen model, dusk sky 0.35, scene debt fixes), run from its own root `agents/lamps/root` (its `scripts/`, `validate/` exporters, probe grid, task queue `tasks/`, logs; `scene/v4` and `bakes/v4` link to these folders) with the steps in `agents/lamps/v4/` |
| `scene/bathfix/` | last full export, unwrap and Blender scenes (`scene_lm.blend` wet, `scene_lm_dry.blend`, `scene.blend`, `scene_dry.blend`) |
| `bakes/bathfix/` | its `lightmap_uv.bin`, `guides.npz` and the four slots' raw bakes (`<slot>/*_gNN.exr`, probe chunks, `refl/`, `foliage/`) |
| `bakes/bathfix_fill/` | the shipped composites (world fill of holes and skipped texels) of `bakes/bathfix` |
| `lampgroups/` | the shipped 15 lamp groups: `scene_lm_lampgroups2.blend`, `groups2.json`, `bakes_final/` (raw), `bakes_sofa/` + `out_sofa/` (merged, shipped) |
| `site_sofa/` | the newest complete site copy (four slots, lamp groups): the base for test sites |
| `final/` | the final rebake of 2026-10-18 (its own `scripts/`, `validate/`, `site/`, `scene/f1`, `bakes/f1`, task queue and logs): shipped in `web/assets/lightmaps` |
| `site/`, `bakes/v2`, `scene/v2`, `scene/clean`, `scene/stableid`, other `site_*` | older; not used by the rebake |
| `tasks/` | the pool's queue (`pending/ running/ done/ failed/`), `logs/tasks/` the task logs |

Everything of the rebake goes to `scene/$V/`, `bakes/$V/`, `site_$V/`; nothing older is overwritten, except the shared
`$R/scripts/` and the exporters in `$R/validate/`, which become the repo's versions (step 0).

## 0. Before (Mac)
```sh
git status   # scene and bake branches merged; then:
cd web && node tools/build.mjs && for t in tools/test_*.mjs; do node $t || break; done && python3 tools/test_package.py && cd ..
python3 bake/scripts/test_lamp_groups.py && python3 bake/scripts/test_reflprobe_layout.py && python3 bake/scripts/test_plan.py && python3 bake/scripts/test_lighting.py
python3 bake/scripts/reflprobe_layout.py web/data/plan.json           # the reflection probe table: every point in a room
NODE_PATH=web/node_modules web/node_modules/.bin/esbuild bake/export/export_entry.js --bundle --outfile=/tmp/export_bundle.js
```
Sync to the cluster (one rsync per folder):
```sh
ssh $HOST "cd $R && mkdir -p fixbake/prev && cp -a scripts fixbake/prev/scripts && cp -a validate/export.mjs validate/lights.mjs validate/switch_groups.mjs fixbake/prev/"   # backup
rsync -a --exclude __pycache__ bake/scripts/ $HOST:$R/scripts/                     # the canonical pipeline copy
rsync -a web/data/plan.json $HOST:$R/scripts/                                      # the plan model, next to plan.py
rsync -a bake/export/setup.py bake/export/render.py web/data/house.json web/data/plan.json /tmp/export_bundle.js $HOST:$R/scene/$V/   # setup.py reads switches.json
rsync -a bake/export/export.mjs bake/export/lights.mjs bake/export/switch_groups.mjs $HOST:$R/validate/
ssh $HOST "cd $R && cp -rs $R/site_sofa site_$V && rm -rf site_$V/dist site_$V/data site_$V/index.html site_$V/style.css"
rsync -a web/dist web/data web/index.html web/style.css $HOST:$R/site_$V/
```
(The export runs the site in legacy mode, so the site copy's lightmaps do not matter; its code and data must be the
merged build.)

## 1. Export (GPU jobs, Chrome; ~5 min each, in parallel)
```sh
cd $R/validate
node export.mjs ../scene/$V/croton.glb ../scene/$V/export_bundle.js ../site_$V            # day state (lightmap pose)
node export.mjs ../scene/$V/croton_dusk.glb ../scene/$V/export_bundle.js ../site_$V --dusk # sheers drawn, as the site at dusk
node export.mjs ../scene/$V/croton_probe.glb ../scene/$V/export_bundle.js ../site_$V --probe-pose             # probe pose
node export.mjs ../scene/$V/croton_probe_dusk.glb ../scene/$V/export_bundle.js ../site_$V --dusk --probe-pose
node switch_groups.mjs ../site_$V > ../scene/$V/switches.json   # every switch: lamp group, default slots, output (lumens), aim, lamp surfaces
```
Check the door/toggle lines of the logs (also `<glb>.state.json`, whose `pose` says which) against the table in "Door and
toggle states" below.

## 2. Unwrap, UVs, denoiser guides (one GPU job; ~5 min)
```sh
$P scripts/unwrap.py scene/$V/croton.glb scene/$V/croton_lm.glb bakes/$V/lightmap_uv.bin 0 32
for x in dusk probe probe_dusk; do   # the same units: the same layout, or stop
  $P scripts/unwrap.py scene/$V/croton_$x.glb scene/$V/croton_lm_$x.glb bakes/$V/lightmap_uv_$x.bin 0 32 --reuse bakes/$V/lightmap_uv.bin
  cmp bakes/$V/lightmap_uv.bin bakes/$V/lightmap_uv_$x.bin && rm bakes/$V/lightmap_uv_$x.bin
done
$P scripts/compact_uv.py bakes/$V/lightmap_uv.bin bakes/$V/lightmap_uv2.bin.gz
$P scripts/denoise.py guides scene/$V/croton_lm.glb bakes/$V/lightmap_uv.bin bakes/$V/guides.npz
```
The unwrap log must show `ownPrimitives` units (every node its own primitives: the bifold leaves no longer share one
chart) and `N units under 16 texels left to the probes` (~120; they are probe-lit at run time). The merged build of
2026-10-16 gives ~950 units in a ~5920 x 5925 atlas at 32 texels/m (the still parts of animated and toggled furniture,
batch.js stillParts, and the wall switch plates added ~380 meshes and +1.5% texels over the earlier 5883 x 5877).

## 3. Blender scenes (one GPU job each, in parallel; ~10 min) and the two lamp-group scenes
```sh
S=scene/$V
$B -P $S/setup.py -- $S/croton_lm.glb $S/switches.json $S/scene_lm.blend                     # sunrise lightmaps (wet)
$B -P $S/setup.py -- $S/croton_lm.glb $S/switches.json $S/scene_lm_dry.blend --dry           # noon, golden lightmaps
$B -P $S/setup.py -- $S/croton_lm_dusk.glb $S/switches.json $S/scene_lm_dusk.blend --dry     # dusk lightmaps
$B -P $S/setup.py -- $S/croton_lm_probe.glb $S/switches.json $S/scene_lmp.blend              # sunrise light probes (probe pose)
$B -P $S/setup.py -- $S/croton_lm_probe.glb $S/switches.json $S/scene_lmp_dry.blend --dry    # noon, golden light probes
$B -P $S/setup.py -- $S/croton_lm_probe_dusk.glb $S/switches.json $S/scene_lmp_dusk.blend --dry   # dusk light probes
$B -P $S/setup.py -- $S/croton_probe.glb $S/switches.json $S/scene_p.blend                   # sunrise reflections, sky
$B -P $S/setup.py -- $S/croton_probe.glb $S/switches.json $S/scene_p_dry.blend --dry         # noon, golden reflections
$B -P $S/setup.py -- $S/croton_probe_dusk.glb $S/switches.json $S/scene_p_dusk.blend --dry   # dusk reflections
$B -P $S/setup.py -- $S/croton.glb $S/switches.json $S/scene.blend                           # Cycles references (site pose)
$B -P $S/setup.py -- $S/croton.glb $S/switches.json $S/scene_dry.blend --dry
$B -P $S/setup.py -- $S/croton_dusk.glb $S/switches.json $S/scene_dusk.blend --dry
$B $S/scene_lm.blend -P scripts/lamp_groups.py -- $S/switches.json $S/scene_lm_lampgroups.blend $S/groups.json      # lamp lightmaps
$B $S/scene_lmp.blend -P scripts/lamp_groups.py -- $S/switches.json $S/scene_lmp_lampgroups.blend $S/groups_p.json  # lamp probes, reflections
cmp $S/groups.json $S/groups_p.json   # the same groups, lights and surfaces in both poses, or stop
```
Every scene gets the same lamps (setup.py prints them per group: lights, lumens, watts): `fixture_lights.py` makes one
light per switch (downlights: soft-edged spots whose half-intensity cone is the declared beam; track heads: spots;
bulbs: points; linear fixtures: rectangles facing down) and gives the lamp surfaces their physical luminance, for
camera and glossy rays only (`fixture_calibrate.py`, one GPU minute, measures every emitter model against its lumens).
`lamp_groups.py` rebuilds them from switches.json and prints one line per group (27 in the manifest's order, `always`
last): every group needs lights or surfaces.

## 4. Queue (one short GPU job; it writes task files only)
```sh
export BLENDER=$R/tools/blender-4.5.14-linux-x64/blender; cd $R; S=scene/$V
$P scripts/make_tasks.py sunrise 8 16384 $V probes --scene $S/scene_lm.blend --probe-scene $S/scene_lmp.blend
$P scripts/make_tasks.py noon    8 4096  $V probes --scene $S/scene_lm_dry.blend --probe-scene $S/scene_lmp_dry.blend
$P scripts/make_tasks.py golden  8 4096  $V probes --scene $S/scene_lm_dry.blend --probe-scene $S/scene_lmp_dry.blend
$P scripts/make_tasks.py dusk    8 4096  $V probes --scene $S/scene_lm_dusk.blend --probe-scene $S/scene_lmp_dusk.blend
$P scripts/lamp_groups_tasks.py $S/groups.json $S/scene_lm_lampgroups.blend bakes/$V/lampgroups tasks bakes/$V/lightmap_uv.bin \
   --samples 4096 --objgroups 8 --probe-samples 128 --chunks 4 --probe-scene $S/scene_lmp_lampgroups.blend
```
`make_tasks.py` writes the probe grid (`scene/probes.json`, probe_grid.py): points inside a plan wall or the exterior skin
are flagged solid and written invalid without a render. Then, as task files in `tasks/pending/` (shell lines that
`worker.sh` runs from `$R`):
```sh
O="--plan scripts/plan.json --layout bakes/$V/refl_layout.json"
# first, in a short GPU job, the layout alone (no renders); it stops on a probe under the roof that stands inside or
# against furniture (add a reflProbe seed to its space in plan_overlay.json); every reflection task reuses the layout
$B $S/scene_p_dry.blend -P scripts/reflprobe.py -- '{"slot": "noon"}' bakes/$V/refl_scratch 0 0 $O
for SLOT in sunrise noon golden dusk; do
  case $SLOT in sunrise) SC=scene_p.blend;; dusk) SC=scene_p_dusk.blend;; *) SC=scene_p_dry.blend;; esac
  for r in "0 7" "7 14" "14 21" "21 27"; do set -- $r
    echo "$B $S/$SC -P scripts/reflprobe.py -- '{\"slot\": \"$SLOT\"}' bakes/$V/$SLOT/refl $1 $2 $O" > tasks/pending/${V}_e_${SLOT}_refl_$1
  done
  echo "$B $S/$SC -P scripts/skypano.py -- '{\"slot\": \"$SLOT\"}' bakes/$V/$SLOT/sky_bg.hdr" > tasks/pending/${V}_e_${SLOT}_sky
done
for r in "0 7" "7 14" "14 21" "21 27"; do set -- $r
  echo "$B $S/scene_lmp_lampgroups.blend -P scripts/reflprobe.py -- '{\"slot\": \"dusk\"}' bakes/$V/lampgroups/refl $1 $2 $O --lamps $S/groups.json --max-layers 3" > tasks/pending/${V}_d_lamprefl_$1
done
# foliage per slot, on the slot's lightmap scene (sunrise scene_lm, noon/golden scene_lm_dry, dusk scene_lm_dusk):
#   export CROTON_SITE_PACKAGES=...; $B scene/$V/<scene> -P scripts/foliage_bake.py -- '{"slot": "<slot>", "glb": "scene/$V/croton_lm.glb", "out": "bakes/$V/<slot>/foliage/foliage.npz", "samples": 512}'
# Cycles references: $B scene/$V/scene.blend -P scene/$V/render.py -- <view json>; with lamp groups
#   $B scene/$V/scene_lm_lampgroups.blend -P scripts/lamp_groups_render.py -P scene/$V/render.py -- '<json with lampsOn>'
```
Rename for order (the pool takes names in sort order, longest first): sunrise lightmaps `${V}_a_*`, every light-probe
chunk (slots and lamp groups) `${V}_b_*`, the other lightmaps (slots and lamp groups) `${V}_c_*`, lamp reflections
`${V}_d_*`, the rest `${V}_e_*`.
Before the full run, a targeted test: `bake.py` with `"only": [lightmap ids]` bakes those units alone (e.g. the last
bake's QA offenders), then composite, encode and tiers as below, and qa.py on that folder.

## 5. Bake on the pool
`scripts/submit_pool.sh` (two 8-GPU, one 6-GPU, one 1-GPU worker job: 23 GPUs; up to 7 more single-GPU
`sbatch scripts/worker.sh` while the total stays <= 30; check `squeue -u $USER` first). Every few minutes:
`ls tasks/pending | wc -l; ls tasks/running; ls tasks/failed`; after a preemption `scripts/requeue_stale.sh`. A failed
task: read `logs/tasks/<name>.log`, fix, move it back to `pending/`.

## 6. Post-processing (one GPU job, sequential; ~2 h)
```sh
export CROTON_SITE_PACKAGES=$R/.venv/lib/python3.11/site-packages; V=bakes/$V
$B -P scripts/composite_v2.py -- $V/sunrise                                   # also writes holes.npy, coverage.npy
for s in noon golden dusk; do $B -P scripts/composite_v2.py -- $V/$s --lamps-from $V/sunrise; done
for s in sunrise noon golden dusk; do
  $P scripts/encode_webp.py $V/$s --split
  $B -P scripts/downscale_atlas.py -- $V/$s --mask $V/$s/coverage.npy --units $V/lightmap_uv2.bin.gz   # chart-aware tiers
  L=""; [ $s = sunrise ] || L="--lamps-from $V/sunrise"
  $P scripts/probe_pack.py $V/$s scene/probes.json $L --refl $V/$s/refl
  $P scripts/foliage_pack.py $V/$s/foliage/foliage.npz $V/$s/foliage.bin.gz
done
export CROTON_GUIDES=$R/$V/guides.npz CROTON_HOLES=$R/$V/sunrise/holes.npy
for g in $V/lampgroups/g*; do $B -P scripts/lamp_groups_pack.py -- merge $g; done
$P scripts/lamp_groups_pack.py pack scene/$V/groups.json $V/lampgroups $V/sunrise/coverage.npy $V/lampgroups/out \
   --probes scene/probes.json --units $V/lightmap_uv2.bin.gz
$P scripts/lamp_groups_pack.py refl scene/$V/groups.json $V/lampgroups/refl $V/lampgroups/out
```
No gains: the fixtures' declared lumens set every group's light (encoding.json carries each group's lumens, plan
spaces and `lmPerW`; its members their lamp surfaces' luminance, which the site draws when the switch is on).
`web/tools/test_lamp_levels.mjs` checks the result per plan space (lux from the probes against the lumen method; the open
plan's lamps 0.15-0.25x its noon daylight).

**QA (gate b), straight after packing: CPU only, numpy + Pillow, ~20 s for the four slots; no GPU, so on the Mac or any node.**
```sh
python3 bake/validate/qa.py bakes/$V --switches scene/$V/switches.json --plan web/data/plan.json --out bakes/$V/qa.json
```
It reads the bake folder as it stands (`<slot>/` with the layers, `half/`, `quarter/`, `probes.bin`, `refl/`; `lightmap_uv2.bin.gz`;
`lampgroups/out`) and prints one line per check: files and encodings, per-unit coverage / black units on a non-black material
(the vertex-colour bug) / no-texel units, tier bleed, lamp-group list, energy and footprint, probes in walls and SH sanity,
reflection layout and black panoramas (thresholds: `bake/validate/qa_thresholds.json`). It exits non-zero on any failure
that is not in `bake/validate/qa_baseline.json` (known violations of the shipped bake, shrink-only) and on any metric that
moved beyond its tolerance. Fix the cause and rebake the affected part, or, once the owner has accepted the change,
`--approve` (new expected failures also need `--allow-new-failures`) and commit the new baseline. The result must be clean
(or approved) before the publish below; the same run on `web/assets/lightmaps` after publishing must exit 0.

Publish into a test site (`site_$V/assets/lightmaps/`), then, after validation, into `web/assets/lightmaps/`:
| From | To |
|---|---|
| `$V/lightmap_uv2.bin.gz` | `v2/lightmap_uv2.bin.gz` |
| `$V/<slot>/{encoding.json, slot_0.webp, slot_1.webp, foliage.bin.gz}`, `half/` and `quarter/` `{encoding.json, slot.webp}` | `v2/<slot>/` |
| `$V/sunrise/{lamps_0.webp, lamps_1.webp}`, `half/lamps.webp`, `quarter/lamps.webp` | `v2/sunrise/` (shared lamps layer: the fallback without lamp groups) |
| `$V/<slot>/{probes.bin, sky_bg.hdr}`, `refl/{meta.json, probe_NN.hdr}` | `<slot>/` |
| `$V/lampgroups/out/*` (encoding.json, lampgroups_T_0/1.webp (full size, the hq tier's), half/, quarter/, probes.bin, refl/) | `v2/lampgroups/` |

## 7. Validate
Shots through the site in a scavenger GPU job (the old tron debug job is gone; `validate/check.sh` still expects it,
so run `validate/shoot.mjs` or a shots script in `sbatch scripts/run.sh`, then `validate/metrics.py` on the Mac):
the reference cameras per slot (`lightmap=<slot>&tier=hq&lmres=full`), the bathroom mirrors with switches on and off,
the front-bedroom closet opened, the kitchen counters, bedroom 3's floor along its west wall; console free of shader
errors; `baked.auditSamplers()` max <= 16.

## Door and toggle states of the bake (export.mjs)
Two poses. **Lightmaps** (`croton.glb`, `croton_dusk.glb`): the site's startup state in daytime (`?legacy`, not dusk),
except the doors whose plan door spec says `bakeOpen` (web/data/plan_overlay.json; manifest bakePose 'open').
**Probes** (`--probe-pose`: `croton_probe.glb`, `croton_probe_dusk.glb`; the light probes, the lamp groups' probes, the
daylight and lamp reflection probes): every door shut where the site starts it shut, and where the plan says
`probeClosed` (manifest probePose 'closed'); the rest as the site has them. The probes next to a doorway hold the light
of the pose they were rendered in, and a door's leaves take the probe volume in every pose.
| Door | Site default | Lightmaps | Probes | Why |
|---|---|---|---|---|
| Front door (ca2bb42b5a, porch / living) | open | open | **shut** (probeClosed) | open, its leaf swings out onto the porch (outdoor probes), so the probes just inside light only its shut leaf and hardware; rendered open they held the sunlit porch (postmortem row 19); no probe-lit piece stands within 1.5 m inside |
| Front-bedroom reach-in bifold, white louvers (d8425baf7a, bedroom 3 / closet) | shut | **open** (bakeOpen) | shut | lightmaps: the closet's inside has light when opened (baked shut it stayed black); probes: the room as the site shows it |
| Primary closet bifold (0f9916c91a) | open | open | open | |
| Vestibule -> kitchen (40c340903a), bedroom 3 (60bf34160a), bedroom B (498f1f300a) | open | open | open | |
| Kitchen -> garage (2e2d4a125a), primary bath (143ab6b9ba), primary-bath closet (029f0013aa), hall bath (054ac1818a), bath B (57fafde9ea), garage side door (gside) | shut | shut | shut | |
| Sliders (e5f2f69eea, 9f018d7dea) | open 0.6 m | open 0.6 m | open 0.6 m | glazed, lightmapped leaves |
| French doors (161782cdfa, bf8cb9f37a) | shut | shut | shut | glazed, lightmapped leaves |

The invariant `door-bake-poses` (web/tools/test_scene_invariants.mjs) checks both declarations against the plan.
| Toggle | Site default | Bake |
|---|---|---|
| Garage sectional door | raised | raised |
| Cellular shades | raised | raised |
| Sheer curtains | gathered by day, drawn at dusk | gathered (day scenes); drawn in the `--dusk` exports (dusk lightmaps, probes, reflections) |
| Patio umbrella | closed | closed |
| Fire pit | off by day, lit at dusk | off (setup.py skips it as a light) |
The lamp groups bake once, from the day scenes (sheers gathered), for every slot: lightmaps in the lightmap pose,
probes and reflections in the probe pose.

## Cost
Measured on the final rebake (2026-10-18, RTX A4000, 27 lamp groups, 496 tasks): 78 GPU-h in all (the pool 75), about
20 min per sunrise lightmap task; prep (four exports, unwrap, 14 scenes, queue) about 50 min of wall time, the pool
3 h on 25 GPUs, post-processing about 45 min with the composites and merges in parallel jobs.

Earlier estimate (RTX 2080 Ti, from the 2026-10-15 logs; 22 lamp groups):
| Pass | Tasks x time | GPU-h |
|---|---|---|
| Sunrise lightmaps, 16384 spp: sky, sun bounce, shared lamps | 3 x 8 x ~21 min | 8.1 |
| Noon, golden, dusk lightmaps, 4096 spp: sky, sun bounce | 3 x 2 x 8 x ~4.5 min | 3.5 |
| Light probes, 256 spp: sunrise 3 layers, other slots 2 | (3 + 3 x 2) layers x 8 chunks = 72 x ~13 min | 15.8 |
| Lamp groups: lightmaps 4096 spp (8 per group) + probes 128 spp (4 per group) | 22 x (8 x 4 min + 4 x 13 min) | 30 |
| Reflections: daylight 4 slots x 27 (~5 s each), lamps 27 x (22 quick + <= 5 panoramas, ~2 min each) | 16 + 4 tasks | 1 |
| Foliage (4), skies (4), Cycles references | | 1 |
| Export, unwrap, guides, 6 scenes + lamp-group scene, tasks | serial | ~1.5 |
| Composites, encodes, tiers, 22 group merges, packs | serial | ~2 |
| **Total** | | **~63** |
Wall time with 30 GPUs: ~1.5 h preparation (serial), ~2.5-3 h on the pool (63 GPU-h / 30 plus the 21-minute sunrise
tasks and the 13-minute probe chunks at the tail), ~2 h post-processing: **~6-7 h** without preemption. Lowering the
sunrise lightmaps to 8192 spp saves ~4 GPU-h; dropping the shared lamps layer (only the `lmgroups=0` fallback) saves
~4.7 GPU-h (lightmaps + probe chunks).
