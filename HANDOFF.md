# Handoff: Croton House walkthrough (Oct 12, 2026, evening)

Three.js (r183) walkthrough of 2513 Croton Ave in `web/`.

## Status and workflow
- **Git:** work is committed on `master`. Every push to `master` builds and deploys to GitHub Pages (`.github/workflows/pages.yml`). Check `git status` for anything in progress before you start.
- **Dev server:** http://127.0.0.1:8780 serves `web/`. If it is not running, start it from `web/` with `python3 tools/serve.py` (it sends `Cache-Control: no-store`, so a plain reload picks up a new build; the stock `http.server` lets Chrome keep stale CSS and JS). Leave it running when you finish.
- **Build:** `cd web && node tools/build.mjs` (add `--watch` to rebuild on save, `--min` for the deploy build).
- **Frame rate:** without `?fps` the loop runs at the display's refresh rate when frames fit and otherwise at an even fraction of it (`src/frame_rate.js`; phones keep a 30 fps cap). `?fps=60` sets a cap and `?fps=0` runs uncapped. `tools/perf.mjs`, `tools/pets_perf.mjs` and `tools/perf_gpu.mjs` pass `fps=0` so their frame times stay meaningful; any new timing tool should too.
- **Room culling:** `src/visibility.js` skips, for the walkthrough camera only, what the plan's walls hide (portals through openings; outdoors the house hides the far garden). `?cull=0` turns it off. A wall built lower than the plan says must be listed in `house.js` `LOW_WALLS`; `tools/cull_check.mjs` (GPU node) proves frames identical with culling on and off.
- **Runtime merges (baked walkthrough only):** once the bake is applied, `src/batch_baked.js` merges what `batch.js` keeps apart for the bake (multi-material meshes, same-material siblings, toggles' rigid parts) and stows the merged sources in hidden groups; `src/plant_clusters.js` and `src/rest_clusters.js` draw far plants and doors / toggles / carried pieces at rest merged per material and 16 m cell for the walkthrough camera only (`layers.mainOnly` / `mainOff`: shadows, puddles, mirrors and photo mode keep the meshes). `?batch2=0`, `?plantmerge=0`, `?restmerge=0`, `?stow=0`, `?taascan=1` turn each off; `tools/ab_check.mjs` (GPU node) compares two variants frame by frame. Anything that moves a part of a door, toggle or carried piece must go through its own transform (the rest clusters watch world matrices, materials and visibility).
- **Daylight bake is precomputed:** `data/daylight.bin` holds the window-light and bounce grid. **After changing walls, windows or fixed furniture, run `cd web && node tools/bake_daylight.mjs`** (dev server running). A stale file is caught by its fingerprint and the app bakes live instead, so nothing breaks, but every visitor pays ~0.5–2 s again. Movable furniture and toggles never enter the bake. `?daylight=live` ignores the file.
- **Sizing:** `--u` in `style.css` is 1px up to a 1440 × 900 window and grows with the window beyond that; the landing, loading screen, intro, top bar, minimap, aim label, tour caption and tutorial all use it. Rendering is capped at 1440p (`MAX_SHORT`/`MAX_PIXELS` in `main.js`), and resizes apply at most every 500 ms.
- **Interface (Swiss):** the house UI is set in Liter (`assets/fonts/Liter-Regular.ttf`, SIL OFL); the landing and loading screens too, with `?serif=1` restoring the original Michelangelus versions. The top bar is equal 84-unit modules of pictogram + key square: Media U (R/P/O inside), pins H (vermilion while any pins show), tour T, demonstration X, dog G, cat K, day/dusk N, music B, tutorial ?, language L, hide-interface Z (top right; the restore eye sits in the same box; crosshair, aim label and tour caption stay). Text boxes are ~40% paper with blur. The tutorial is a Swiss sheet (`HELP` in `ui.js`).
- **Keys:** the bar opens compact with no key squares; Z cycles keys shown → everything hidden (crosshair, aim label and tour caption stay) → back. Enter opens the introduction. R / P / O each toggle a document list together with its pins (closing the list by any means hides them; pins always start off). M is also a small badge above the minimap.
- **Demonstration (X, `src/demo.js`):** a scripted living-room scene on the frame clock: walk, look, sit on the sofa, call/pet dog and cat (staged with `pets.hold`, released on call), drag a Wishbone chair and return it, pins, fly into a panorama and out. Any real input stops it and restores state.
- **Maps (`minimap.js`):** both draw the same Swiss plan from house.json (even 15 cm walls, glazing lines) plus the layout's `BEDS` / `FRONT_BED` as flat green with `SHELL` and `PAVED` cut out. The radar is north-up and zooms 7.5 m indoors → 15 m in the gardens; M is the full sheet with room names (one size, a few placed by hand in `AT`).
- **Look and antialiasing:** exposure targets and the grade live in `lighting.js` (`tune`, and the grade pass's `saturation` / `contrast` / `lift` / `balance` uniforms, both on `__app.lighting`). Day indoor exposure 1.7 and lift 0.04 were fitted against the g10 / g14 / g20 photo spots; dusk indoors drops exposure and cools the white balance. Composer buffers multisample per tier (`msaa` in `tier.js`: hq 4, laptop 2, mobile 0), and foliage switches to alpha-to-coverage with a 45% cutoff whenever MSAA is on (`setFoliageAA` in `main.js`).
- **Graphics pass (cybercity-inspired):** film grain in the grade pass (`grain`, mid-tones, fresh each frame) against banding; a custom tone curve (`CustomToneMapping` patched in `lighting.js`) that is Neutral by day and hue-preserving at dusk (`uHuePreserve`), so lamps stay warm; screen-space reflections on the oak floor and quartz only (`src/reflections.js`, high tier, ~0.3 ms) — the materials tag their pixels via colour alpha and the pass writes back in place so GTAO keeps its depth; a floor-bounce term in the daylight patch (`daylight.floorBounce`, 0.4) lifting ceilings and undersides, fitted with indoor exposure 1.5. A real Blender lightmap bake is still the larger step if more is wanted.
- **Smooth entry:** the other time of day downloads at once but its CPU/GPU steps wait for a quiet moment (landing page, or ≥ 8 s after entering while standing still; a dusk toggle skips the wait). Moving doors refresh the sun shadow at most 10× a second.
- **Overlay layer:** `OVERLAY_LAYER` (`viewpoints.js`) holds the panorama sphere and the floating photo cards; `main.js` draws it after post-processing so ambient occlusion and the tone curve never touch them. An opaque panorama draws only that layer, uncapped. Panoramas decode off the main thread and preload when you arrive at their viewpoint; their list thumbnails come from `assets/pano_thumbs/` (`python3 -I tools/pano_thumbs.py`).
- **Stats for nerds:** right-click the scene, the ` key, or `?stats=1`. Draw calls, triangles, programs, render size, load and warm-up timings, daylight source, build commit.
- **Where notes live:** see the *Docs* section at the end. Nothing important should live only in `/tmp`.

## Loading, intro and scaling (this session)
- After Enter, a *Preparing the rooms* screen in the landing's style (ribbon photo, colour planes, breathing measure bars) covers the shader compile and counts linked programs.
- Then an introduction pop-up over the first view: the house in four lines with the architect's photos, and the four essential controls. **I** or clicking *2513 Croton Ave* in the top left reopens it. The tutorial no longer opens by itself; **?** still shows it.
- The architect is credited as *Studio Hu* (from the landing page); no name or bio exists in the repo yet.

## Earlier (committed)
- Background music: the copyright-free Tuscany track, then AIR's acoustic Mike Mills; the commercial Brush recording stays off the public site.
- Map pins start hidden. **H** toggles all three legends together; quality moved to **J**.
- The front door opens on arrival. Textures default to 1K (phones 512, `?tex=2k` for the full library); Enter turns on only when the bar is full, and before shader compile so Windows drivers can leave the landing.
- The garage is lit from the shop bars, shades start raised, and foliage and the kitchen wall no longer show through.

## HUD and sitting pets (done this session)

The Codex `hud2` / `pets2` windows were stopped before they wrote reports. The work was finished here and checked in the app.

- Aim label is 18px, tour caption 26px. During the tour the crosshair and the label are hidden (`body.touring`).
- **G** calls the dog, **K** calls the cat. The chips show the key.
- **地图图例 / Map legends** replaces the three pin chips: 小红书, 全景, 照片, plus 全部显示 / 全部隐藏. Dusk and HQ chips are gone (**N** dusk, **J** quality; **H** toggles the legends). On a touch screen those two sit at the bottom of the dropdown.
- Buttons: 小红书 / RedNote, 全景 / Pano, 教程 / Tutorial.
- You can pet a dog while you are sitting, if you look at it. Petting a sitting or lying dog keeps it seated (hearts, head up) instead of standing it up. Calling a sitting dog makes it get up and come.
- Front door: closed hinged doors, including the front door, get a collider (`house.js`, `if (!open0) setHinged(d, false)`). Not re-checked with a walk-through after the last build.

## Finished this session (verified)
- **Front planting:**
  - The palm band is continuous across the centre, so the front door is hidden from the street.
  - The south curb is a single piece, and the `frontBounds` clause that shoved centre plants east was removed.
  - Code is in `web/src/layout.js`; screenshot `docs/evidence/gap_sheet.jpg`.
- **Tour (`web/src/tour.js`):**
  - Stops 1 and 2 are aerial (`eye` set).
  - The foyer stop has a `via` terrace waypoint. The camera holds height over the planting, drops onto the terrace, then follows the nav path through the front door.
  - Straight (direct) flights now hold height and drop late (`viewpoints.js`).
  - Screenshot `docs/evidence/desc_sheet.jpg`.
- **Closet (Codex `closet`):** the front-bedroom closet has white louvered bifolds that open with a click and a furnished interior. Screenshots `docs/evidence/closet_closed.png`, `closet_open.png`, `closet_inside.png`.
- **Pets (Cursor subagent, done):**
  - Tabby cat (`src/pets/cat.js`, `assets/pets/cat.glb`) and shared roaming (`src/pets/roam.js`).
  - Petting: within 1.3 m and facing the pet, click.
  - Call chips for the dog and the cat.
  - Cost: +5 draw calls and about 0.02 ms CPU per frame.
  - Known issues: occasional 30–45 ms re-plan spikes, and the dog's fur shells cost about 2–5 ms GPU.
- **Earlier:**
  - French doors open outward onto the patio.
  - The panorama and photo-compare views have a Q exit box and button.
  - The landing page's ochre decoration block is now obviously decorative.

## Still open
- **Unreviewed reports:** `docs/reports/codex_livingroom2_report.md`, `codex_hud_report.md`, `codex_frontyard2_report.md`. The `hqlook` and `daylight` Codex windows never wrote reports; treat that work as unfinished.
- **Foliage clipping:** the closet agent noticed it in the bedroom tour view.
- **Regression check:** `node tools/chairtest.mjs`.
- **Older backlog:**
  - Remove the kitchen cupboard that isn't in the listing photos.
  - Redo the camera viewpoints for all three bedrooms.
  - Fix the chair conflict: click should sit, drag should move.
  - Right-click menu to put moved objects back (one or all).
  - More styling in the side bedrooms, with less clumsy doors.
  - Plants clipping into the bottom-right bathroom.
  - Camera shake: the player should yield the camera during tour and fly-to flights.

## Conventions and constraints
- **Coordinates:** plan uses +x east and +y north; world z = −plan y. Camera vertical FOV is 62°.
- **Screenshot helpers (run from `web/`):** `node tools/shot.mjs "index.html?x=..&y=..&h=..&p=..&fast=1" out.png 1280 800` for one view with the HUD; `node tools/kshot.mjs W H out.png "x,y,headingDeg,pitchRAD,eye,vfovDeg"` for several clean views. Write outputs to `docs/evidence/` if they should outlive the session.
- **Headless tests:** use playwright with `channel: 'chrome'` and `--use-angle=metal --ignore-gpu-blocklist`, wait for `window.__ready`, and use `window.__app` as the app handle.
- **HUD clicks:** `#hud` has `pointer-events:none`, so interactive children need `pointer-events:auto`. i18n lives in `DICT` in `src/ui.js` (zh first) and elements use `data-i18n`.
- **Front yard:**
  - The front door must stay hidden from the street by foliage; never open a sightline.
  - Front-yard shots are aerial.
- **Landing page:**
  - It is a Le Corbusier tribute, not a copy, with no RedNote mention.
  - The credit reads "made by Tianfu Wang and friends" (zh 由王天夫和朋友们制作). Never say "AI".
- **Pet agents on Cursor:** old pet subagents used an explicit Claude slug billed to the Anthropic key. New Cursor subagents should omit the model so they inherit the Cursor quota.
- **Batching and lights:** see `docs/briefs/agent_env.md`. After load, never reassign `mesh.material` or move a sub-part unless its root has `userData.toggle` or `userData.noBatch`, and never add, remove or hide lights (change intensity instead), or every shader recompiles.

## Docs
- `BRIEF.md`: the furniture module contract every `src/furniture/*.js` follows.
- `docs/briefs/`: the shared agent environment notes and the finished packaging/mobile brief.
- `docs/reports/`: every Codex agent report; `docs/reports/notes/` holds the longer reports, test results and test scripts they link to.
- `docs/evidence/`: screenshots and comparison sheets the reports link to. It is git-ignored (about 140 MB), so it exists only on this machine.
