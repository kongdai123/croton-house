# Croton House

A photoreal walkthrough of a real house, 2513 Croton Ave in Sarasota, Florida, in the browser (three.js r183, WebGL2).
Live: https://kongdai123.github.io/croton-house/

The lighting is baked offline in Blender Cycles (pipeline in `bake/`): a lightmap atlas per time slot (sunrise, noon,
golden hour, dusk), one layer per lamp group so every light switch works, a light-probe volume and reflection probes.
The sun stays live, with soft shadows. On top run Blender's AgX view, auto exposure, a camera white balance, volumetric
light shafts and TAA; room culling and runtime batching keep the draw count down. Desktop is the priority; phones get
the lower tiers of `web/src/tier.js`.

| Folder | What |
|---|---|
| `web/` | the site: `src/` (ES modules, bundled by esbuild into `dist/`), `data/` (plan model, tour, posts), `assets/` (the bake, textures, media), `tools/` (tests, the headless harness, screenshot and perf tools) |
| `bake/` | the Blender bake pipeline (`export/`, `scripts/`) and its validation (`validate/`) |
| `docs/` | architecture, audits, plans and agent reports |
| `source/zillow/`, `refs/` | the listing photos, panoramas and floor plan the house is built from; reference photos per area |

## Run it locally

Node 22 (as in CI), and Python 3 with numpy and Pillow for the Python tests.

    cd web
    npm ci
    node tools/build.mjs       # bundles src/ into dist/; --watch rebuilds on save, --min is the deploy build
    python3 tools/serve.py     # serves web/ at http://127.0.0.1:8780 with caching off

Open http://127.0.0.1:8780/. `?tier=hq`, `?tier=laptop` or `?tier=mobile` forces a quality tier, `?legacy` the
older raster lighting, `?stats=1` the stats overlay. The screenshot and perf tools are described in
[web/tools/README.md](web/tools/README.md).

## Test and lint

    cd web
    npm test        # builds, then every tools/test_*.mjs, tools/test_package.py and bake/scripts/test_*.py (45 tests)
    npm run lint    # eslint over src and tools; any warning fails (--max-warnings 0)
    npm run smoke   # the UI smoke tests in a browser (gate d); on a GPU machine, not on a laptop you work on

CI ([pages.yml](.github/workflows/pages.yml)) runs lint and tests on every push and pull request, and deploys `master`
to GitHub Pages when they pass. `web/tools/pre-push.sh` runs the same checks locally.

## Gates

Nothing reaches the owner before these pass ([architecture-lighting.md](docs/architecture-lighting.md#4-gates)):

- **a. Scene invariants**: the real house built headless in node, every rule checked
  (`web/tools/test_scene_invariants.mjs`, part of `npm test`).
- **b. Bake QA**: coverage, black units, tier bleed, lamp groups, probes and reflections of a new bake
  (`bake/validate/qa.py`, [REBAKE.md](bake/REBAKE.md#6-post-processing-one-gpu-job-sequential-2-h)).
- **c. Render regression**: cameras in every room per slot and tier against the approved baseline and Cycles, on a GPU
  node ([RENDER_GATE.md](bake/validate/RENDER_GATE.md)).
- **d. UI smoke**: tour, switches, doors, quality, slots, resize, keys, context loss; on a GPU after every bake and
  before UI pushes, not in CI ([web/tools/README.md](web/tools/README.md#ui-smoke-tests-gate-d)).

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): module map, data flow, frame loop, extension recipes, invariants.
  Start here.
- [HANDOFF.md](HANDOFF.md): the session handoff of 2026-10-12, partly stale
  ([what is stale](docs/ARCHITECTURE.md#7-what-is-stale-in-handoffmd)).
- [BRIEF.md](BRIEF.md): the contract every furniture module follows.
- [docs/audit/postmortem.md](docs/audit/postmortem.md): the bug history and the project rules (a root cause, a class
  fix and a check for every bug).
- [docs/architecture-lighting.md](docs/architecture-lighting.md): the plan model, the lighting manifest, the composed
  shader, the gates.
- [docs/realtime-plan.md](docs/realtime-plan.md): why the lighting is baked, frame-cost measurements, volumetric light
  and TAA.
- [docs/white-balance.md](docs/white-balance.md), [docs/webgpu-port.md](docs/webgpu-port.md).
- [docs/audit/](docs/audit/): the audits behind the refactor (lighting roles, spatial data, shader stack,
  verification); their line numbers predate it.
- [bake/README.md](bake/README.md) (the pipeline), [bake/REBAKE.md](bake/REBAKE.md) (the rebake runbook),
  [bake/SLOTS.md](bake/SLOTS.md) (time slots), [bake/validate/RENDER_GATE.md](bake/validate/RENDER_GATE.md) (gate c),
  [bake/validate/DEPLOYMENT.md](bake/validate/DEPLOYMENT.md) (packaging).
- [web/tools/README.md](web/tools/README.md) (tests, the plan model, the composed shader),
  [web/tools/golden/README.md](web/tools/golden/README.md) (goldens).
- [docs/briefs/](docs/briefs/), [docs/reports/](docs/reports/), [docs/handoff/demo-film.md](docs/handoff/demo-film.md):
  agent briefs and reports, the demo film.

## Media and licences

| What | Where | Licence |
|---|---|---|
| Listing photos, 3D Home panoramas and floor plan (Zillow listing) | `source/zillow/`, served as `web/assets/photos` and `web/assets/panos`; also in `refs/` | to be confirmed |
| The owner's RedNote (Xiaohongshu) build photos and videos | `web/assets/rednote/`, `web/data/rednote_posts.json`, `refs/` | to be confirmed |
| Texture scans and HDR skies | `web/assets/tex/`, `web/assets/hdr/` (`web/tools/fetch_assets.py`) | Poly Haven, CC0 |
| Blender's AgX LUTs | `web/assets/agx/` | GNU GPL, see `web/assets/agx/NOTICE` |
| Liter, the interface typeface | `web/assets/fonts/Liter-Regular.ttf` | SIL OFL 1.1, see `web/assets/fonts/Liter-OFL.txt` |
| Michelangelus, the `?serif=1` landing typeface | `web/assets/fonts/Michelangelus-*.ttf` | to be confirmed |
| Noto Serif SC, subset by `web/tools/subset_fonts.py` | `web/assets/fonts/NotoSerifSC-*.sub.woff2` | to be confirmed (no licence file in the repository) |
| "Tuscany" by Oak Studios | `web/assets/audio/tuscany.m4a` | CC BY-ND 4.0, credited in the help sheet (`web/src/ui.js`); Oak Studios asks for permission outside YouTube, Instagram and Facebook ([HANDOFF.md](HANDOFF.md#earlier-committed)): use on this site to be confirmed |
| An acoustic cover of AIR's "Mike Mills" | `web/assets/audio/mike-mills.m4a` | shared for use by its performer and credited in the help sheet; the composition itself is not licensed: to be confirmed |
| The cat and the dog | `web/assets/pets/` | made in this repository from procedural rigs (`web/tools/cat_glb.mjs`, `web/tools/dog_check.mjs`) |

A commercial album track, `web/assets/audio/brush-i.m4a`, is git-ignored and never published. The repository has no
LICENSE file, and the "ISC" in `web/package.json` is npm's default value: the project's own licence is to be confirmed.
npm dependencies carry their own licences.
