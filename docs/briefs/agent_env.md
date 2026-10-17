## Environment for agents working on the walkthrough
- Project: `web/` in the croton-house repo (Three.js r183 ES modules bundled by esbuild). Read `HANDOFF.md` at the
  repo root first. Commit only when asked; a push to `master` deploys the public site. The user is building an interactive photoreal walkthrough of a Zillow listing (2513 Croton Ave,
  Sarasota). They are picky and test in desktop Chrome with HQ mode on.
- Static server at http://127.0.0.1:8780 (start it from `web/` with `python3 tools/serve.py` if it is down; it disables caching).
- After changing walls, windows or fixed furniture, regenerate the daylight bake: `node tools/bake_daylight.mjs`.
  `node tools/build.mjs --watch` rebuilds `dist/app.js` on every save to `src/`; `node tools/build.mjs` shows compile errors.
  The app caps at 30 fps; add `&fps=0` to any URL used for frame timing. **Several agents share this bundle**: a syntax or runtime error breaks everyone's
  screenshots, so keep it compiling and loading, and fix any break immediately.
- Screenshot: `node tools/shot.mjs "index.html?x=<plan x>&y=<plan y>&h=<heading deg>&p=<pitch rad>&fast=1" out.png 1280 800`
  (headless Chrome, about 10 s; drop `&fast=1` for HQ; add `&dusk=1` for dusk). Heading 0 = north (+y), 90 = east, clockwise.
- Pick what's under a pixel: `node tools/pick.mjs "<same query>" 1280 800 640,400 ...`. Perf: `node tools/perf.mjs hq` prints draw
  calls, triangles and frame times at five poses (headless numbers are noisy; compare before/after in the same run).
  `window.__app` exposes scene, camera, player, layout, lighting, interact, applyTime, state, tourCtl, renderer.
- Plan metres, +x east, +y north. World: X = plan x, Y = up, Z = -plan y. Ceiling 2.44 m.
- **Draw-call batching (new, `src/batch.js`)**: after load, static leaf meshes are merged per material into hidden-original +
  merged-copy pairs; interactive roots (seats/movables) get their parts merged under the root; swaying plants/curtains beyond
  10 m show a frozen merged copy and stop animating. Consequences: never reassign `mesh.material` or move a sub-part after load
  unless its placed root has `userData.toggle` or `userData.noBatch = true` (those subtrees are left alone). Material property
  changes (color, emissiveIntensity, uniforms) do propagate. `?batch=0` disables batching for comparison.
- **Never toggle `light.visible` or add/remove lights after load**: changing the number of active lights recompiles every shader
  in three.js (multi-second stall). Keep lights present and change their intensity instead.
- Other agents are editing right now: `props_rooms.js` / `styling_rooms.js` (bedroom decor), `house.js` + `furniture/niche.js`
  (a wall alcove), `photo_spots.json`. Only edit the files listed as yours below; list anything else you need in your report.
