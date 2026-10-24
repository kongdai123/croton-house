# Gate (c): per-room render regression

The site rendered through fixed cameras in every room, per time slot and tier, against the last approved baseline (and
against Cycles where references exist), with absolute checks on every frame. Runs on a scavenger GPU node after a bake or
a lighting / shader change (docs/architecture-lighting.md, gate c). Never on a laptop: headless Chrome on the GPU.

Placeholders: `$HOST` the cluster login node, `$R` the croton folder there, `$NODEBIN` node's bin directory,
`$B` = `$R/tools/blender-4.5.14-linux-x64/blender -b --python-exit-code 1`, `$P` = `$R/.venv/bin/python`.

## Files

| File | What |
|---|---|
| `make_cameras.mjs` | Generates `cameras.json` from `web/data/plan.json` and the house built headless (`web/tools/harness/scene.mjs`): no GPU, ~15 s. |
| `cameras.json` | 57 cameras (committed): 1-3 per interior space (by area), closets seen from their doorway, 1-2 per outdoor zone looking at the house, and the postmortem's known-bad spots (`bad_*`: front door open and closed, bath B mirror and door, primary bath mirror, walnut shelf, sofa, window-seat pillows, kitchen counter, garage). |
| `shoot.mjs --cameras` | Renders every camera: one fresh page per slot (`?lightmap=<slot>`, default switches), `dusk_allon` = the dusk page with every switch on; per-camera door states (`doors`) set and restored. 960x540. Two sets per tier: **fixed** (`<tier>/`: `capture&autoexp=0`, the slot's exposure, 30 frames per camera; what Cycles renders) and **visitor** (`<tier>-visitor/`, `--visitor`: auto exposure and local adaptation on, as a visitor sees the house; the page's own loop is stopped so time moves only through `renderAt`, the camera arrives by teleport and is shot once the exposure state has settled: at least 2 s simulated, then until it moves < 0.01 EV per 1/3 s, at most 8 s). Writes `<run>/<set>/<state>/<camera>.png` and `report.json` (load / shot seconds, page and shader errors, programs that failed to link, `auditSamplers()`, per camera the settled EV). |
| `cycles_refs.py` | Cycles through the same cameras, one Blender session per state, cached per frame by a key over the scene file, `render.py`, the state, the camera and the render settings. Cameras with `doors` get no reference (the Cycles scene holds the bake's door poses). The lamps are the bake's own (setup.py: `scripts/fixture_lights.py`, one physical light per switch), on by the site's default switches for the slot (`dusk_allon`: every group), so the references and the site agree on which lamps are on and how bright. |
| `compare.py check` | Per frame: stops vs the reference (frame mean and the largest of 8 x 6 cells), the largest per-cell colour shift, new saturated / exact-black area per cell; absolute checks (magenta, saturated single-hue area; black frame and exact zeros on the visitor sets only: a closet is legitimately black at the slot's fixed exposure; a finding the baseline frame has too is a warning); page-level failures from `report.json`. Each set compares with its own baseline set; Cycles only with the fixed sets. Thresholds in `thresholds.json` (per-camera overrides under `cameras`). Contact sheets of the worst frames per comparison (`worst_baseline.jpg`, `worst_cycles.jpg`, `worst_pair.jpg`, `worst_absolute.jpg`) and `--overview` sheets of every frame (fixed | visitor side by side per camera). Exit 1 on an enforced failure. |
| `compare.py approve` | Copies a run into the baseline folder (the previous one kept as `<baseline>.prev-<time>`) and writes `baseline.json` (frame hashes). |
| `gate_c.sh` | Inside a GPU job: shoot one tier's states, then `compare.py check` against the baseline (and Cycles). |
| `thresholds.json` | Thresholds. Baseline comparisons are enforced; Cycles and hq-vs-mobile are reported (enforce false): the site approximates Cycles (baked bounce, probes, a raster sun), and the mobile tier's quarter atlas differs by design. |

## Run (cluster)

Copy the site to a site folder of its own and the gate scripts next to `$R/validate/node_modules` (playwright):
```sh
cd web && node tools/build.mjs && cd ..
rsync -a --exclude '*.map' web/index.html web/style.css web/dist web/data web/assets $HOST:$R/site_<name>/
rsync -a bake/validate/{shoot.mjs,compare.py,cameras.json,thresholds.json,gate_c.sh,cycles_refs.py} $HOST:$R/validate/gate_c/
```
One job per tier (fixed set ~9 min on an RTX 2080 Ti: ~40 s page load per slot, ~1.4 s per camera; visitor set
about twice that, the exposure settling):
```sh
for t in hq mobile; do
  sbatch --job-name=croton-render-$t scripts/run.sh bash -c "export NODEBIN=$NODEBIN PLAYWRIGHT_BROWSERS_PATH=$R/tools/pw \
    PY=$P CROTON_SITE=$R/site_<name>; validate/gate_c/gate_c.sh $R/gate_c/runs/<run> $t sunrise,noon,golden,dusk,dusk_allon \
    $R/gate_c/baseline $R/gate_c/cycles"
done
```
Then, on any machine with the PNGs (numpy + pillow), the cross-tier comparison and the sheets of both tiers:
```sh
$P -I validate/gate_c/compare.py check $R/gate_c/runs/<run> --baseline $R/gate_c/baseline --cycles $R/gate_c/cycles \
   --pair hq:mobile,hq-visitor:mobile-visitor --overview --out $R/gate_c/runs/<run>/compare
```
Look at the sheets. If every difference is intended (a rebake, a lighting change), approve:
```sh
$P -I validate/gate_c/compare.py approve $R/gate_c/runs/<run> $R/gate_c/baseline --note '<why>' --manifest bake/validate/baseline.json
```
`bake/validate/baseline.json` (committed) records which run is approved and its frame hashes.

Cycles references (only when the scene changes; ~25 s per camera at 960x540 and 256 samples on a 2080 Ti, so ~25 min
per slot on one GPU; cached, a rerun renders only what changed):
```sh
for s in sunrise noon golden dusk dusk_allon; do
  case $s in sunrise) SC=scene.blend;; dusk*) SC=scene_dusk.blend;; *) SC=scene_dry.blend;; esac
  sbatch --job-name=croton-render-cyc-$s scripts/run.sh $B scene/<V>/$SC -P validate/gate_c/cycles_refs.py -- \
    "{\"cameras\": \"$R/validate/gate_c/cameras.json\", \"state\": \"$s\", \"out\": \"$R/gate_c/cycles\", \"render_py\": \"$R/validate/gate_c/export/render.py\"}"
done
```
(`validate/gate_c/export/render.py` and `validate/gate_c/scripts/{slots,layer_lights,lighting}.py` are the repo's
`bake/export/render.py` and `bake/scripts/*`; render.py finds its scripts at `../scripts`.)

## After a layout or plan change
`node bake/validate/make_cameras.mjs` (add `--map top.ppm` for a top view of the cameras), commit `cameras.json`, then a
new run is compared camera by camera: moved cameras have no baseline frame (a warning) until the next approve.

## Since bake v4 (physical lamps, 2026-10-24)
- The Cycles scenes carry the bake's lamps (one light per switch at its fixture's lumens) and light the groups the site
  starts on in each slot; before v4 they held a separate light set (lights.json, every lamp at the slot's level, 30-70 W
  points), so the lamp comparisons below were meaningless (dusk all-on +1.3 stops median, bath B +6.5).
- With the new default switches (every interior switch at sunrise, golden hour and dusk, the porch at dusk) the site's
  `dusk` and `dusk_allon` states light the same lamps; both have references.

## What the first baseline showed (master 047d084, before the rebake)
- Two runs of the same build agree to 0.05 stop in every cell at fixed exposure and to 0.14 in the visitor set (0.003
  per frame; deterministic: stepped clock, the exposure read back until settled), so the baseline thresholds (0.15
  stop per frame, 0.4 per cell) leave a margin for driver noise.
- Visitor set: the darkest frames are bath B's mirror and the hall bath at dusk (mean 0.004-0.006 after the exposure
  reaches its +3 EV limit) and the primary bath mirror at sunrise and golden; none is all-black.
- Cycles differs wherever the switches differ: Cycles lights every lamp at the slot's level, the site starts with the
  slot's default switches (golden: bedrooms and the primary bath off, -3 to -4 stops; sunrise: kitchen and living on,
  +2), and at dusk with every switch on the site is about 1 stop brighter than Cycles (median; the group gains). Read
  Cycles per room with that in mind; the baseline comparison is the enforced one.
- Black at dusk with every switch on: bath B and the hall bath (no baked lamp group in the shipped bake).


## After every bake: the full UI smoke suite on a GPU

CI cannot run the smoke suite (web/tools/smoke): in software GL on GitHub's runners the house takes over 7 minutes to load
and every test times out. Run the whole suite on a scavenger GPU node after every bake and before pushing UI changes, from
the site copy used for this gate: `node tools/smoke/run.mjs --gpu --out=<dir>` (all 9 tests, about 5 minutes; on Linux `--gpu` uses ANGLE on Vulkan,
web/tools/smoke/session.mjs LINUX_GPU).

## After a wall, opening or culling change: the room-culling check on a GPU

Room culling (web/src/visibility.js) trusts the plan's walls; a wall built differently from the plan (a pass-through, a
lowered wall: house.js `LOW_WALLS`) makes it hide what is visible. `node web/tools/cull_check.mjs --site <site>
--out <dir> --slots sunrise,dusk` draws every gate camera, a door shut / opening / open, a carried chair, a called pet and
the visitor's walk with culling on and off, and checks the sun-shadow cache's partial redraws against a full one: every
pair must be pixel-identical (about 10 minutes on an RTX 2080 Ti; differing frames are written as PNGs).
