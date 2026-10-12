# 2513 Croton Ave · photoreal walkthrough — HANDOFF

> A surprise for the owner (Studio Hu Dwelling on RedNote, architect + landscape designer) of 2513 Croton Ave, Sarasota FL:
> a first-person photoreal three.js walkthrough built from the Zillow listing (vector floor plan, 52 photos, 16 panoramas) and his
> RedNote posts. Standalone local git repo (no remote). Nothing published yet. Last session: Claude (Fable 5.1), 2026-10-12.
> 用户要求：照片级、家具与照片一致、花园有设计感、可坐/可拖椅/开门、GTA 小地图、Zillow 取景点与全景对照、小红书取景点、中文优先双语、最后发私密链接。

## 1. Start here
1. Serve `web/` on 8780: in the Yireeb Claude session `preview_start name=croton-house` (its `.claude/launch.json` points here);
   elsewhere `python3 -m http.server 8780 --bind 127.0.0.1 --directory web`. Open `http://localhost:8780/index.html`.
2. Build after edits: `cd web && node tools/build.mjs`. New machine: `cd web && npm i && python3 -I tools/fetch_assets.py` (textures/skies are gitignored).
3. Headless look: `node tools/shot.mjs "index.html?x=<plan x>&y=<plan y>&h=<heading°>&p=<pitch>&eye=1.5&fast=1[&dusk=1]" out.png`.
   One furniture item: `showcase.html?module=<m>&item=<i>&az=30&el=15&dist=3`.
4. Fidelity loop: `python3 -I web/tools/compare.py [panoId…]` → `compare/<id>_<title>.jpg` (left real panorama, right our render, same camera).
5. Regression: `node web/tools/playtest.mjs /tmp/pt` (walk/sit/drag/doors/panels/pano/dusk/tour screenshots); `node web/tools/overlap.mjs` (clipping).
6. Coordinates: plan metres, +y north, x east; world X=x, Z=−y. Heading 0 = north, clockwise. Placement `ry`: 0 south, π north, π/2 east, −π/2 west (module front = local +Z).

## 2. Map
`source/zillow/` raw data (floor_shape.svg, gallery/, panos/, floorplan_points.json, tour.json) · `refs/<area>/` reference photos ·
`compare/` latest side-by-sides · `BRIEF.md` modeler brief · `CODEX_BRIEF.md` packaging+mobile brief (Codex only wrote `tools/package.py`, untested).
`web/src`: `main.js` scene/lights/post/adaptive quality/query start · `house.js` shell from plan + yard · `layout.js` PLACEMENTS table,
`generatePlanting()`, lights, mirrors · `furniture/*.js` eight modeled areas (`decor_plus.js` wraps decor) · `kit.js`/`materials.js`/`proc.js`
shared modeling API · `player.js` · `interact.js` · `minimap.js` · `viewpoints.js` (TRIM = per-pano heading fixes) · `rednote.js` · `tour.js` ·
`human.js` · `ui.js` (zh/en).

## 3. State (2026-10-12)
Verified working: walk, sit, drag chairs/stools/poufs, French doors and sliders, minimap + big-map teleport, viewpoints panel, photo wipe,
panorama mode (Space), RedNote panel with go-to, tour (T), dusk (N) with real fixtures, EN/中文. Rooms matching the panoramas: foyer,
living, kitchen, dining, family room, hallway, patio, backyard. Yard follows the aerial and is densely planted.
Fixed from user feedback: white flickering floor, janky controls, bare garden, garage/laundry modeled, pony wall, dusk lights, seated body size.

## 4. Next (priority)
1. **Primary bedroom is a mess (user).** A shot from (−4.3, 3.3) heading 90 saw through to the family room: check wall x = −2.28
   (`79c7b50eda-aa3b5b3fca`) in `house.js`, `bedWhitewash` placement (−3.43, 3.55, ry −π/2), shelf/side table; rerun `compare.py 60243e1740 b9a18422cd`.
2. Verify unchecked edits: bedroom B trim +35° (`03fae42bc1`), primary bath vanity on the west wall (real one is a double vanity → add `vanityDouble`).
3. Full `compare.py`, fix bedroom 3, hall baths; soften the ash-table grain (dining module).
4. Photoreal polish: exterior window sills/frames, vents, more décor from photos, door hardware, better window glass.
5. Mobile pass (CODEX_BRIEF job 2): look pad blocks panel close button; phone sheets; bigger slider thumb. Nothing edited yet.
6. Package + publish: test `web/tools/package.py` (≤240 MB, ≤15 MB/file, one 36 MB video must be re-encoded), then publish `build/` as a
   private claude.ai artifact (several publishes ≤64 MB to the same URL), test on phone + laptop, send link.
7. Nice-to-have: exploded "how he built it" animation of the window seat / bed (Yireeb-style), RedNote video on the monitor.

## 5. Gotchas
- Shared materials own their envMap → day/dusk must set `envMapIntensity` (`setEnvironment(env, intensity)`).
- Leaf cards need `allowOverride=false` or GTAO draws squares (done in `plants_parts.js`).
- `shot.mjs` uses system Chrome (`channel:'chrome'`); Playwright's Chromium install is broken here.
- Photos/panos are symlinks into `source/zillow`; 2k textures ignored by git, `fetch_assets.py` restores them.
- Modelers' local materials ignore `M.*` tweaks; per-piece colour lives in its module. Never push anywhere without the user.
