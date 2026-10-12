Vetted all 13 RedNote posts. Image indices are zero-based. Pose columns are plan metres x/y, clockwise heading degrees (0=north), pitch radians (positive=up), and eye height metres.

9 approximate comparisons; 4 cannot be aligned with the current model. No pose is labelled tight. “Not possible” rows retain a nearby, usable subject view and explicitly identify the missing or different model geometry.

| Slug | Title | Image | Final pose (x, y, heading, pitch, eye) | Alignment quality / reason |
| --- | --- | ---: | --- | --- |
| [68f9b07600](../../evidence/vet_68f9b07600.jpg) | 2513佛州住宅 | 1 | (1.7, -3.25, 180, -0.3, 0.8) | **not possible** — Construction-stage bare sill differs from the finished cushioned bench; a low view 0.75 m from its front is the closest useful comparison. Image 1 gives more spatial context than the end-grain macro. |
| [6ab9bb8a00](../../evidence/vet_6ab9bb8a00.jpg) | 60厘米悬挑 为了点儿树影照进来 | 0 | (1.5, -3.72, 235, 0.05, 0.8) | **not possible** — Interior cantilever detail, not an exterior eave. The photographed white hanging cabinet and exposed pine top are replaced by full-height pine towers and cushions in the model. |
| [68ac5a3b00](../../evidence/vet_68ac5a3b00.jpg) | (untitled) | 0 | (6.1, -0.95, 90, -0.2, 1.4) | **not possible** — The only photo is a tiled bathtub recess. No tub exists in the model; this is a safe view of the hall-bath shower as a substitute, not a recovered original camera location. |
| [69e6b9b100](../../evidence/vet_69e6b9b100.jpg) | 佛州2513 后花园的贝壳和植物 | 0 | (4.4, 9.25, 0, -0.72, 1.6) | **approximate** — South edge of the shell lounge, looking north and down. Plant species, exact bed edges, and later lounge furniture differ; individual leaves cannot align. |
| [6acbf22b00](../../evidence/vet_6acbf22b00.jpg) | 佛州2513- 有深度的空腔 | 1 | (3.05, 0.35, 22, 0.03, 1.5) | **not possible** — The recessed white-and-pine cabinet is missing and this area is closed by model walls. This is an inferred nearby viewing location, not a verified original cabinet position. |
| [6ab7b98000](../../evidence/vet_6ab7b98000.jpg) | 佛州2513-—窗前框出一处悠哉。 | 0 | (2.75, -2.6, 180, -0.04, 1.2) | **approximate** — South living-room window seat, near frontal view. Model window proportions, tower depth, cushion positions and sill height differ, preventing simultaneous alignment of all edges. |
| [69ec158300](../../evidence/vet_69ec158300.jpg) | 佛州2513-微波炉上的黑板 | 0 | (-2.3, 1.25, 190, -0.06, 1.6) | **approximate** — Architecture and aisle view matched to the updated north microwave/pantry tower; cabinet dimensions and appliance details still differ slightly. |
| [6a4b314b00](../../evidence/vet_6a4b314b00.jpg) | 佛州2513_无界的庭院 | 0 | (3.08, 3.05, 7, -0.16, 1.35) | **approximate** — Cover is a close view of the eastern north-wall door and bookcase, not a centred view of all three doors. Video frames at roughly 3, 9, 15 and 21 seconds confirm the wall. Doors are closed in the default model and the leather chair has moved. |
| [69fd344f00](../../evidence/vet_69fd344f00.jpg) | 佛州2513—-无界的后花园 | 0 | (3.08, 3.05, 7, -0.16, 1.35) | **approximate** — Same interior doorway and bookcase as the video cover, at a wider aspect ratio. Open door leaves, chair placement, curtains and the outdoor planting differ. |
| [69d2af8a00](../../evidence/vet_69d2af8a00.jpg) | 佛州2513——white wash bedfame | 3 | (-5.25, 4.35, 114, -0.15, 1) | **approximate** — Image 3 is the completed bare whitewashed frame. Headboard wall and south-side doorway are the anchors; model bed width, side shelves, soffit extent, mattress and textiles differ. |
| [6a02916b00](../../evidence/vet_6a02916b00.jpg) | 佛州2513—后院灯火 | 0 | (2.15, 14.3, 183, 0.2, 1.4; dusk) | **approximate** — Dusk view south from the shell lounge. Rear facade and door groups frame the same subject; the model roof, closed doors, umbrella and later garden furniture prevent a tight blend. |
| [69ef572200](../../evidence/vet_69ef572200.jpg) | 佛州2513—对着花园的床 | 0 | (-5, 2.15, 23, -0.15, 1) | **approximate** — Low view from the southwest foot-side aisle toward the north slider, with the bed on the right. Slider jamb is the anchor; the wall gap, curtains, throw pillows and bed proportions differ. |
| [6ac5704700](../../evidence/vet_6ac5704700.jpg) | 佛州2513｜花园住宅 | 0 | (2.15, 14.3, 183, 0.2, 1.4; dusk) | **approximate** — Cover reuses the dusk rear-facade photograph. Frames sampled throughout the 138-second tour confirm the rear garden; cover text, roof profile, doors and garden furniture differ. |

All media were inspected, including all four bed construction photos and sampled frames from both videos. Candidates were compared at the selected photo’s aspect ratio, using 50% blends and red/cyan edge overlays. Searches included 0.25 m position and 3° heading variations, plus pitch and eye changes. The kitchen was re-vetted after the concurrently edited layout moved the microwave tower north.

Comparison sheets: `vet_<slug>.jpg` (photo, final render, 50% blend). [Overview](../../evidence/vet_all.jpg). Additional edge-overlay comparisons: `compare_final_<slug>.jpg`. Video contact sheet: [sampled frames](../../evidence/video_frames.jpg). Exact collision clearances: [audit JSON](clearance.json).

Changed only the `SPOTS` block in `src/rednote.js`; preserved the rest of that file byte-for-byte. `node tools/build.mjs` passed. No commit or push.

The world-pin path in `src/markers.js` reads `spot.eye` and `spot.img`, but the fly-to only sets `player.eye`: `src/player.js` then eases it back toward the unchanged `player.eyeHeight` once driving ends. The selected low heights therefore do not persist after clicking a pin. The separate RedNote panel’s `targetFor()` also drops `eye`. Both routes need to preserve the selected height; those fixes are outside the authorized `SPOTS` edit. The renders use the explicit `eye` query, which sets both fields. Default north doors remain closed in the renders; reproducing the photographed open-door states also requires work outside this block.

The four impossible subjects should be used as modelling references, not presented as accurately recovered camera locations. The niche’s location is inferred and the bath row is a substitute shower view.

All 13 final poses remained at their requested coordinates after settling. Exact collider clearance passes the 0.15 m threshold for every pose; minimum measured clearance is 0.180 m.


Runtime height check: requesting an eye of 0.8 m through `viewpoints.goTo()` settled at 1.62 m after 1.5 seconds. [Observed values](eye_check.json). Persisting `eyeHeight` during arrival and forwarding `eye` through `RedNote.targetFor()` are necessary for the in-app comparisons to reproduce the saved low-camera renders.
