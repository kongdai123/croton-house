# Handoff: Croton House walkthrough (Oct 12, 2026, 04:10)

Three.js (r183) walkthrough of 2513 Croton Ave in `web/`. The dev server at http://127.0.0.1:8780 is already running; don't start or kill it. Build with `cd web && node tools/build.mjs`. Nothing is committed: all work is uncommitted in the working tree.

## HUD and sitting pets (done this session)

The Codex `hud2` / `pets2` windows were stopped before they wrote reports. The work was finished here and checked in the app.

- Aim label is 18px, tour caption 26px. During the tour the crosshair and the label are hidden (`body.touring`).
- **G** calls the dog, **K** calls the cat. The chips show the key.
- **地图图例 / Map legends** replaces the three pin chips: 小红书, 全景, 照片, plus 全部显示 / 全部隐藏. Dusk and HQ chips are gone (**N** dusk, **H** quality). On a touch screen those two sit at the bottom of the dropdown.
- Buttons: 小红书 / RedNote, 全景 / Pano, 教程 / Tutorial.
- You can pet a dog while you are sitting, if you look at it. Petting a sitting or lying dog keeps it seated (hearts, head up) instead of standing it up. Calling a sitting dog makes it get up and come.
- Front door: closed hinged doors, including the front door, get a collider (`house.js`, `if (!open0) setHinged(d, false)`). Not re-checked with a walk-through after the last build.

## Finished this session (verified)
- **Front planting:**
  - The palm band is continuous across the centre, so the front door is hidden from the street.
  - The south curb is a single piece, and the `frontBounds` clause that shoved centre plants east was removed.
  - Code is in `web/src/layout.js`; screenshot `/tmp/ch/gap_sheet.jpg`.
- **Tour (`web/src/tour.js`):**
  - Stops 1 and 2 are aerial (`eye` set).
  - The foyer stop has a `via` terrace waypoint. The camera holds height over the planting, drops onto the terrace, then follows the nav path through the front door.
  - Straight (direct) flights now hold height and drop late (`viewpoints.js`).
  - Screenshot `/tmp/ch/desc_sheet.jpg`.
- **Closet (Codex `closet`):** the front-bedroom closet has white louvered bifolds that open with a click and a furnished interior. Screenshots `/tmp/ch/closet_closed.png`, `closet_open.png`, `closet_inside.png`.
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
- **Unreviewed reports:** `/tmp/ch/codex_livingroom2_report.md`, `/tmp/ch/codex_hud_report.md`, `/tmp/ch/codex_frontyard2_report.md`. The status of the `hqlook` and `daylight` Codex windows is unknown.
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
- **Screenshot helper:** `node /tmp/ch/kshot.mjs W H out.png "x,y,headingDeg,pitchRAD,eye,vfovDeg"`.
- **Headless tests:** use playwright with `channel: 'chrome'` and `--use-angle=metal --ignore-gpu-blocklist`, wait for `window.__ready`, and use `window.__app` as the app handle.
- **HUD clicks:** `#hud` has `pointer-events:none`, so interactive children need `pointer-events:auto`. i18n lives in `DICT` in `src/ui.js` (zh first) and elements use `data-i18n`.
- **Front yard:**
  - The front door must stay hidden from the street by foliage; never open a sightline.
  - Front-yard shots are aerial.
- **Landing page:**
  - It is a Le Corbusier tribute, not a copy, with no RedNote mention.
  - The credit reads "made by Tianfu Wang and friends" (zh 由王天夫和朋友们制作). Never say "AI".
- **Pet agents on Cursor:** old pet subagents used an explicit Claude slug billed to the Anthropic key. New Cursor subagents should omit the model so they inherit the Cursor quota.
