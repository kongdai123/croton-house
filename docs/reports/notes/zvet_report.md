# Zillow photo viewpoint vetting

50 photos; tight: 0, approx: 29, poor: 21. g07 and g50 skipped as requested.

Only data/photo_spots.json was written in the repository. No commit or push. The JSON retains poor candidates for review; only approx entries are suitable for provisional pins. No view is claimed to have coincident architectural lines.

Every photo was reviewed with a same-aspect render and 50% blend. Red/green edge overlays are zvet_edge_gNN.jpg (red = photo, green = render). Actual assets are mostly 1536×1152 / 4:3; renders are 960 px wide with each source aspect ratio. The saved headings were derived from photo features, room geometry and fresh renders, without using floor-plan photo dots or TRIM. Tripod heights are 1.2–1.6 m. All pitches are 0 except g04 (-0.04) and the poor g02 candidate (+0.20).

Saved coordinates are checked against where the player actually settles, including its 0.17 m capsule collision. Sheets hide UI/pins and use fast rendering, so mirror-reflection fidelity and materials are not quality claims. Rendering helper, refinement inputs and landing logs are under zvet_*.

## Model changes that would improve usable views

- g08–g11, g51: living-window sill is too high relative to the seat; window-seat/shelving proportions differ. Sofa should reproduce the listing back/front views, and rug/coffee-table/bench positions need correction.
- g12–g18: sink window/raised shade, west upper-cabinet/hood dimensions, oven-column/flush-door division and island/stool spacing need correction. g15 needs a clear tripod position where the model coffee table currently stands.
- g19–g24, g46: verify dining table/lantern against the north door axis, curtain openings and the bookcase/desk/chair layout. g21/g22 foreground seating is different.
- g26–g29, g52: bed/cubby and cabinet proportions differ; closet hanging bay and cubby/back-corner arrangement need rebuilding for g29. The full-width bed collider makes some apparent bedside floor positions unusable.
- g30/g31: mirror/vanity/shower proportions, linen-door detailing and ladder position differ. g34/g36 need shallow windows and the correct shower/curtain arrangement.
- g32/g33/g35: verify bedroom-window sill/head/shade proportions. The refined g35 pose brings the dark dresser into the correct edge of the frame; furniture/bedding details still differ.
- g48/g49: move console/panel/rack to reproduce the laundry wall arrangement; revise table orientation/spacing.
- g01–g06: check porch/roof silhouette and side/front window proportions. Move oversized/incorrectly placed banana/cactus foliage off the listing sightlines (g03/g05).
- g25, g37–g47: patio/overhang/courtyard paving and clear paths differ. Umbrella should sit behind the fire pit in the north-facing lounge views (g40/g42), not toward the house. Revise bench, pouf, chair/lounger, planter and tree placements. g47 also lacks the neighbor/hoop scene.

## Door state needed for comparisons

- Close bifold 0f9916c91a for g27/g28/g52 (model starts open).
- Open bedroom-bath door 57fafde9ea and bedroom-entry door 498f1f300a for g32.
- g25 uses bf8cb9f37a 70% open; g44 uses both rear French groups 80% open; g45 uses 161782cdfa 80% open; g46 uses bf8cb9f37a 70% open. Door state is not added to the requested pin schema; sheets demonstrate the comparison state. The app needs to apply these states or the user must open/close the doors before comparison.

## Per-photo result

| Photo | Quality | Architectural anchor / reason |
|---|---|---|
| g01 | poor | East-side façade candidate: window shapes/spacing and the clear path differ; model foliage obstructs the listing sightline. |
| g02 | poor | Façade bearings can be matched, but the sky-heavy crop requires +0.20 rad pitch at the fixed FOV. This loses the level-camera constraint; patio/lounge spacing also differs. |
| g03 | poor | Front porch/eave profile, paving and planter/bench layout do not coincide; the model banana obstructs this approach. |
| g04 | poor | Front roof/hip profile is too shallow and the front massing/paving differ. A standing camera cannot reproduce the photo silhouette. |
| g05 | poor | The architectural fit lands near the model banana. The nearest clear pose is still obstructed by the columnar cactus at (-2.3, -7.6), across the living-window sightline. |
| g06 | approx | Front door/window/iron-column frontal bearings; porch roof, window proportions and planting differ. |
| g08 | approx | Window-seat tower/window bearings; window sill is too high and shelving/pillows differ. |
| g09 | approx | East/south wall view and window seat; sofa is on the wrong wall/orientation relative to the photo. |
| g10 | approx | Front-facing window/entry jambs; window sill/seat proportions and lowered shade differ. |
| g11 | approx | Entry/window/kitchen bearings; sofa and kitchen cabinet details differ. |
| g12 | poor | Range/hood and upper-cabinet proportions and the doorway/tall-column division differ; island and back-wall lines cannot be aligned together. |
| g13 | approx | South window and aisle with west oven column; island vase position and window proportions differ. |
| g14 | approx | Island/oven-column diagonal; west-run cabinet and flush-door detailing differ. |
| g15 | poor | The coffee-table collider occupies the likely tripod position. Clear alternatives change the island framing substantially; island/stool spacing also differs. |
| g16 | poor | Sink-window sill/height and raised shade do not match. The west-run cabinets/hood and sink corner cannot coincide together. |
| g17 | approx | Aisle/oven-column/sink-window bearings; window sill/height and island décor differ. |
| g18 | poor | Sink window is much taller than the listing window, and the blind is lowered over the upper pane. No level camera matches the window and countertop together. |
| g19 | approx | Living-to-dining opening/column; sofa and dining table framing differ. |
| g20 | approx | Portal column and north glass wall; furniture/curtain positions differ. |
| g21 | approx | Portal posts/beam and living window; armchair/sling-chair foreground arrangement differs. |
| g22 | approx | Desk opening/beam and west console wall; lantern/table and chair positions differ. |
| g23 | approx | North-east bookcase/curtain corner; lantern and table do not occupy the photo positions. |
| g24 | approx | Dining portal posts/header and north wall; table size/framing and curtains differ. |
| g25 | poor | French-door candidate is clear, but the listing overhang/patio boundary and garden placement are different. The default doors are closed; the sheet uses 70% open doors. |
| g26 | approx | North slider and east headboard soffit; bed/rug/slider proportions and exterior planting differ. |
| g27 | approx | South vestibule/closet opening; cupboard styling and bed proportions differ. Bifold closed for sheet. |
| g28 | approx | South closet jambs/wall and walnut cabinet; cupboard height/offset differ. Bifold closed for sheet. |
| g29 | poor | Hanging bay/cubby geometry and the back-corner arrangement differ. From a clear threshold the model presents a large timber back/side panel where the photo shows a white corner. |
| g30 | approx | Partition/vanity wall and shower opening; mirror dimensions and basin/cabinet shape differ. |
| g31 | approx | Linen-door jambs and shower opening; ladder belongs elsewhere and shower/window details differ. |
| g32 | approx | East window, south bath and hall jambs; window size/bed proportions differ. Bath and entry doors open for sheet. |
| g33 | approx | North slider/east-window corner; bed/bedding and outside planting differ. |
| g34 | poor | Generic tall window replaces the shallow bath window; shower glass/partition layout and vanity/mirror heights differ. |
| g35 | approx | East/south window corner; window height/shade, bedding and nightstand proportions differ. |
| g36 | poor | Generic tall window and glass shower differ from the shallow window and curtain/shower layout in the listing; mirror/vanity proportions also differ. |
| g37 | poor | The listing soffit edge and patio/planting/lounger layout cannot coincide. The umbrella is too far toward the house. |
| g38 | approx | Rear wall/door row/roof perspective; patio paving, loungers and planting differ. |
| g39 | approx | French-door and primary-slider jamb bearings, independently triangulated; umbrella, bench and planted islands differ. |
| g40 | poor | Umbrella is south of the fire pit in the model, whereas it appears behind it in this north-facing photo; bench, chairs and poufs are spaced/oriented differently. |
| g41 | approx | Bedroom-slider/main-door façade bearings; bench/poufs/fire pit and tree positions differ. |
| g42 | poor | Umbrella is much nearer the camera than in the listing. Matching its bearing loses the fire-pit/bench alignment; planting and furniture layout differ. |
| g43 | poor | Banana/palm foliage fills the slider/planter sightline. The white planter and courtyard planting/paving arrangement differ. |
| g44 | approx | Rear façade/roof perspective; opened French doors, curtains, patio/loungers and trees differ. |
| g45 | approx | Rear main-opening/roof perspective; opened office French doors, curtains and lounge/patio positions differ. |
| g46 | poor | Dining table/lantern are offset from the door axis; open-leaf, interior-window and desk framing cannot coincide at the fixed lens. Sheet uses 70% open dining doors. |
| g47 | poor | East-side path view: neighboring roof/building gap, basketball hoop and paving/planting are absent or different. The model fills the clear walkway with foliage. |
| g48 | poor | Rustic console is at the garage front instead of beside the laundry view; electrical panel and wire rack positions differ. |
| g49 | poor | Wire shelving is on the west wall rather than to the right of the washer/heater in the reference; console and ping-pong placement/orientation differ. |
| g51 | approx | East wall/hall opening; sofa/bench/rug placement and styling differ. |
| g52 | approx | East soffit/headboard and south vestibule; bed/cubby proportions differ. Bifold closed for sheet. |

## Artifacts

- data/photo_spots.json: 50 records, bilingual labels.
- ../../evidence/zvet_gNN.jpg: photo | render | 50% blend for all 50.
- ../../evidence/zvet_all.jpg: overview.
- ../../evidence/zvet_edge_gNN.jpg and ../../evidence/zvet_edges_all.jpg: edge checks.
- zvet_all_jobs.json.actual.json: final rendered camera landings.


Validation: all 50 unique IDs and image filenames checked; all 50 comparison/edge/render artifacts exist. Final saved coordinates reproduce collision-settled landings within 0.000001 m. See zvet_validation.json.
