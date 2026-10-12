# Living room comparison and verification

Final placement coordinates are plan metres, +y north. The original placements below come from `living_backup` saved before the interrupted run.

| Item | Before (x, y) | After (x, y) | Result |
| --- | --- | --- | --- |
| Sofa | 3.47, -0.95; faces west | 2.65, -1.15; faces south | Floats with its back toward dining, facing the window seat |
| Coffee table | 2.35, -1.50 | 2.52, -2.85 | Between sofa and window seat, with white vase and chess box |
| Rug | 2.32, -1.45; rotated 90° | 2.17, -2.40; unrotated | 2.90 × 3.20 m, beneath the table and sofa front legs |
| Pine console | 3.75, -2.90 | 3.78, -2.78 | Against the east wall, with red painting and dried grass |
| Window seat | 2.17, -4.29 | 2.17, -4.28 | Same front-wall location; narrower asymmetric built-in with three pillows |
| Living track rail | 2.10, -2.00; east–west | 3.00, -2.35; north–south | Placement changed; shared fixture builder retained |

Builder changes: coffee table changed from Ø1.00 × 0.36 m with splayed legs to Ø1.15 × 0.30 m with a thin top and three-fin pedestal. Window seat width reduced from 3.30 to 2.95 m and height from 2.30 to 2.23 m; four pillows replaced with two left and one right, with mesh audit tags. Sofa loose cushions gained creases. Console is now long and narrow with integrated art and vase. Jute has aligned basket-weave colour, normal, and AO maps. Duplicate/obsolete living-room décor was removed and tabletop props moved to the new 0.30 m surface. Removed stale carved-table/diffuser relocation clauses while keeping the fig clear of the alcove mouth.

Checks completed:

- `node tools/build.mjs`: PASS.
- `git diff --check`: PASS.
- Five captures at the supplied `photo_spots.json` positions, headings, pitch, and eye, with 60° vertical FOV: reviewed. Capture tool uses `player.viewEye` to hold the photographic pose without collision displacement.
- `node tools/chairtest.mjs`: PASS for click-to-sit, drag without sitting, and right-click put-back. Test harness now disables automatic pointer lock to preserve its intended unlocked-pointer mode, asserts the behavior, and checks console errors.
- `node tools/tourtest.mjs`: complete, 4,877 simulated steps; zero obstruction/door-clip log entries. Global minimum sampled clearance is 0.10 m at the garage route; maximum vertical change is 0.016 m.
- `node interacttest.mjs`: PASS, including shade toggle, chair sit/drag/return, other toggle controls, and door click; zero console errors.
- `node tools/cliptest.mjs --filter=living --json=living_clip_final.json`: zero overlaps above 3 mm, zero floating props, zero console errors. Includes window-seat pillows and all props_living placements.
- `node livingverify.mjs`: PASS for sofa/window-seat sit and stand, console drag and right-click return to its new home, and actual player-capsule movement from the front door to dining, into the kitchen aisle, and from living into the hall. No blocking or console errors.

Comparison sheets: `../../evidence/living_g08.jpg`, `../../evidence/living_g09.jpg`, `../../evidence/living_g10.jpg`, `../../evidence/living_g11.jpg`, `../../evidence/living_g51.jpg`, and `../../evidence/living_before_after.jpg`.

Remaining differences: the supplied photo poses are marked approximate in the data, and frame alignment still differs across angles, notably the missing foreground sofa crop in g10 and the lower/larger table projection in g51. Pillows, leather creases, pine grain, vase surface, and rug edges remain stylized. The shared track fixture still has three heads rather than the listing's five; fixture builders were explicitly outside this task's edit scope. Existing shell proportions and lighting also differ from the photos.

No commits or pushes.
