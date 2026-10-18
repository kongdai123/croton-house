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
| `shoot.mjs --cameras` | Renders every camera: one fresh page per slot (`?lightmap=<slot>`, default switches), `dusk_allon` = the dusk page with every switch on; per-camera door states (`doors`) set and restored. 960x540, 30 frames per camera, fixed exposure (`capture&autoexp=0`). Writes `<run>/<tier>/<state>/<camera>.png` and `report.json` (load / shot seconds, page and shader errors, programs that failed to link, `auditSamplers()`). |
| `cycles_refs.py` | Cycles through the same cameras, one Blender session per slot, cached per frame by a key over the scene file, `render.py`, the slot config, the camera and the render settings. |
| `compare.py check` | Per frame: stops vs the reference (frame mean and the largest of 8 x 6 cells), the largest per-cell colour shift, new saturated / exact-black area per cell; absolute checks (black frame, exact zeros, magenta, saturated single-hue area); page-level failures from `report.json`. Thresholds in `thresholds.json` (per-camera overrides under `cameras`). Contact sheets of the worst frames per comparison (`worst_baseline.jpg`, `worst_cycles.jpg`, `worst_pair.jpg`, `worst_absolute.jpg`) and `--overview` sheets of every frame. Exit 1 on an enforced failure. |
| `compare.py approve` | Copies a run into the baseline folder (the previous one kept as `<baseline>.prev-<time>`) and writes `baseline.json` (frame hashes). |
| `gate_c.sh` | Inside a GPU job: shoot one tier's states, then `compare.py check` against the baseline (and Cycles). |
| `thresholds.json` | Thresholds. Baseline comparisons are enforced; Cycles and hq-vs-mobile are reported (enforce false): the site's per-slot default switches differ from Cycles' all-lamps-at-the-slot-level scene, and the mobile tier's quarter atlas differs by design. |

## Run (cluster)

Copy the site to a site folder of its own and the gate scripts next to `$R/validate/node_modules` (playwright):
```sh
cd web && node tools/build.mjs && cd ..
rsync -a --exclude '*.map' web/index.html web/style.css web/dist web/data web/assets $HOST:$R/site_<name>/
rsync -a bake/validate/{shoot.mjs,compare.py,cameras.json,thresholds.json,gate_c.sh,cycles_refs.py} $HOST:$R/validate/gate_c/
```
One job per tier (each ~25 min on an RTX 2080 Ti: ~1 min page load per slot, ~4 s per camera):
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
   --pair hq:mobile --overview --out $R/gate_c/runs/<run>/compare
```
Look at the sheets. If every difference is intended (a rebake, a lighting change), approve:
```sh
$P -I validate/gate_c/compare.py approve $R/gate_c/runs/<run> $R/gate_c/baseline --note '<why>' --manifest bake/validate/baseline.json
```
`bake/validate/baseline.json` (committed) records which run is approved and its frame hashes.

Cycles references (only when the scene changes; ~25 s per camera at 960x540 and 256 samples on a 2080 Ti, so ~25 min
per slot on one GPU; cached, a rerun renders only what changed):
```sh
for s in sunrise noon golden dusk_allon; do
  case $s in sunrise) SC=scene.blend;; dusk_allon) SC=scene_dusk.blend;; *) SC=scene_dry.blend;; esac
  sbatch --job-name=croton-render-cyc-$s scripts/run.sh $B scene/<V>/$SC -P validate/gate_c/cycles_refs.py -- \
    "{\"cameras\": \"$R/validate/gate_c/cameras.json\", \"state\": \"$s\", \"out\": \"$R/gate_c/cycles\", \"render_py\": \"$R/validate/gate_c/export/render.py\"}"
done
```
(`validate/gate_c/export/render.py` and `validate/gate_c/scripts/{slots,layer_lights,lighting}.py` are the repo's
`bake/export/render.py` and `bake/scripts/*`; render.py finds its scripts at `../scripts`.)

## After a layout or plan change
`node bake/validate/make_cameras.mjs` (add `--map top.ppm` for a top view of the cameras), commit `cameras.json`, then a
new run is compared camera by camera: moved cameras have no baseline frame (a warning) until the next approve.
