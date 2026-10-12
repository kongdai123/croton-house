# Modeling brief · 2513 Croton Ave walkthrough (shared by every furniture module)

You are modeling ONE area's furniture for a photoreal three.js (r0.183) first-person walkthrough of a real house
(2513 Croton Ave, Sarasota). The owner will recognise every piece, so proportions, materials and details must
match the reference photos in `refs/<area>/` (Zillow listing photos `gNN_*.jpg`, and the owner's own RedNote
build photos `rednote_*.jpg`). Photorealism is the priority; nothing may look like a plain untextured box.

## Where things live
- Project: `web/` in the croton-house repo (`/Users/masenov/Documents/GitHub/croton-house/web`). Run every command from there.
- You own exactly one file: `src/furniture/<area>.js` (you may add `src/furniture/<area>_parts.js` if it gets long).
  Do NOT edit `src/kit.js`, `src/materials.js`, `src/proc.js`, `src/showcase.js`, other modules, or anything else.
- Helpers: read `src/kit.js` (box/cyl/lathe/extrude/tube/plane/legs/repeat/cushion/pillow, addSeat, setMovable,
  setCollider/autoCollider, describe, sizeOf) and `src/materials.js` (`M.<name>()` shared materials: oak, pine,
  pineWhitewash, acacia, walnut, reclaimed, lumber, leatherTan/Cognac/Black, jute, linen, cushion, rattan, wicker,
  quartz, cabinetWhite, tileBlack/White/Mosaic, blackAppliance, steel, blackSteel, blackMatte, paper, ceramicWhite,
  glass, mirror, aluminum, ironBlack, sheer, louver, plywoodSlats, bookSpines, canvasRed, chalkboard, plant …).
  If you need a material that is not there, create it locally in your file with `new THREE.MeshStandardMaterial`
  or `MeshPhysicalMaterial` (import THREE from kit), optionally with a canvas texture from `src/proc.js`.

## Module contract
```js
import { THREE, M, box, cyl, lathe, extrude, tube, plane, group, at, repeat, legs, cushion, pillow,
         addSeat, setMovable, setCollider, autoCollider, describe, sizeOf } from '../kit.js';
export const items = { sofa: () => build(), coffeeTable: () => build2(), ... };   // every builder returns a THREE.Group
```
- Units are metres. Y is up. The group's origin is on the FLOOR at the centre of the footprint; local +Z is the
  piece's FRONT (the side a user faces when using it). Every item must stand on y = 0 (minY ≈ 0, never below).
- Wall-mounted or hanging items (mirror cabinet, pendant, curtains) still use a floor origin; put the geometry at
  its real height. A pendant hangs from y = 2.44 (ceiling height) and its cord must reach the ceiling.
- Metadata on the returned root (see kit.js): `describe(root, {id, name, zh})`; `addSeat(root, {x,y,z,facing,kind})`
  for every seat (y = seat-top height, facing = yaw, 0 means looking toward local +Z); `setMovable(root)` on chairs,
  stools, ottomans, loungers; `autoCollider(root)` (or `setCollider`) on everything a person cannot walk through.
- Optional `root.userData.animate = (t) => {}` for tiny idle motion (leaves swaying, cord swinging). Must be a
  pure function of t (seconds); no Date.now, no Math.random at render time.
- Build geometry once and `clone()` for repeats (chairs ×6, stools ×4, boards ×40). Budget: ≤ 40k triangles per
  item, ≤ 150k for the whole module. Use modest segment counts (cylinders 16-24, rounded boxes seg 3-4).
- Every visible edge should be eased: `box(..., {r: 0.004-0.02})`. Upholstery = separate cushion blocks with larger
  radii and a slight bulge (scale 1.02-1.05) so seams read. Wood pieces get real joinery proportions (aprons,
  stretchers, rails). Hardware (pulls, feet, glides, casters, screws) in the right metal.
- Faithfulness: measure proportions from the photos; use real product sizes (a CH24 Wishbone chair is 0.55 w ×
  0.51 d × 0.76 h, seat 0.45; a king mattress is 1.93 × 2.03; a counter stool seat is 0.66 high; a kitchen counter
  is 0.92 high and 0.62 deep, uppers 0.33 deep, 0.45 gap). When a dimension is given in the area notes, use it.

## Verify your work (required before you report)
1. `node tools/build.mjs` (bundles; fix every error it prints).
2. A static server should be serving the web folder at http://127.0.0.1:8780. If it is not, start it from `web/` with
   `python3 tools/serve.py` and leave it running. Screenshot with
   `node tools/shot.mjs "showcase.html?module=<area>&item=<name>&az=35&el=15&dist=3" /tmp/<area>_<name>.png`
   and LOOK at the png (Read tool). `az`/`el` in degrees, `dist` metres; omit `item` to see every item in a row;
   add `&collider=1` to draw colliders. The HUD line prints each item's size and metadata so you can check numbers.
   If `shot.mjs` fails because Chromium is still installing, wait 60 s and retry (do not install anything yourself).
3. Compare against the reference photos side by side and iterate until shape, proportion, colour and detail match.
   Check at least two angles, one close (dist 1.5) for detail.
4. Report back: item list with sizes, seats/movable/collider flags, triangle estimate, and anything you could not
   match from the photos (be honest; do not claim a match you did not verify with a screenshot).
