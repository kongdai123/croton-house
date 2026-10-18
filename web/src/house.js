// House shell built from data/house.json (Zillow floor plan, metres, +y north).
// World frame: X = plan x (east), Y up, Z = -plan y (north is -Z). Ceiling 2.44 m.
import { THREE, M, box, cyl, plane, group, shadow, tube } from './kit.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { plan, rectOf, opening } from './plan.js';
import { declare } from './lighting_roles.js';

export const CEIL = plan.levels.ceiling;
export const P = (x, y) => new THREE.Vector3(x, 0, -y);              // plan -> world (on the floor)
export const planToWorld = (x, y, h = 0) => new THREE.Vector3(x, h, -y);
export const headingToYaw = (deg) => THREE.MathUtils.degToRad(-deg);  // plan heading (0 = north, clockwise) -> yaw about +Y where yaw 0 looks -Z (north)

// Regions outside the Zillow interior scan (owner's full floor plan g07, garage photos g04, g48, g49) and the site
// zones, as the plan model (data/plan.json, plan_overlay.json) has them: interior faces unless noted. Rects are the
// spaces' bboxes; the garage itself notches out the closet bay (garagePts below).
export const GARAGE = rectOf('garage');          // 15' × 19.5', dark-painted; front flush with bedroom 3
export const LAUNDRY = rectOf('laundry');        // open nook in the garage's NW corner: stacked W/D, heater, sink
export const WALKIN = rectOf('walkin');          // primary walk-in closet (pine shelves, g29), door c1bf892aaa
export const LINEN = rectOf('linen');            // louvered bifold closet off the vestibule (g27/g28), door 0f9916c91a
const V = plan.spaces.find(s => s.id === 'bedroom3').view;   // bedroom 3, its doorway and the reach-in cavity, in scene z
export const FRONT_CLOSET_VIEW = { key: V.key, x0: V.x0, x1: V.x1, z0: -V.y1, z1: -V.y0 };
const GD = opening('garageDoor'), SD = opening('gside');
export const GARAGE_DOOR = { x0: GD.x0, x1: GD.x1, h: GD.head };   // 8' × 7' sectional, open (g04)
export const SIDE_DOOR = { y0: SD.y0, y1: SD.y1 };                 // west wall, to the parking pad
export const LOT = { x0: plan.lot.x0, x1: plan.lot.x1, y0: plan.lot.y0, y1: plan.lot.y1 };   // 95' × 110' lot
export const PATIO = rectOf('patio');
export const COURT_A = rectOf('westCourt');
export const COURT_B = rectOf('eastCourt');
export const PORCH = rectOf('porch');            // recessed between the garage and bedroom 3, under the main roof
const GARAGE_XE = plan.site.garageXE;            // outer face of the garage's porch-side block wall
export const WALK = rectOf('frontWalk');
export const DRIVE = rectOf('drive');
export const PAD = rectOf('parkingPad');         // parking pad along the garage's west wall (g07)
export const WEST_FENCE_Y = plan.site.westFenceY;
// Outer face of the whole building (Zillow footprint + the garage annex): pieces on this outline get a stucco skin.
export const EXT_FP = plan.outline.polygon;
// Openings the Zillow scan missed (the primary-bath window over the toilet, g31): the plan's windows on no Zillow wall.
const EXTRA_WINDOWS = plan.openings.filter(o => o.kind === 'window' && !o.wall).map(o => ({ ...o, sillOverride: o.sill, headOverride: o.head }));
// g18: sink window spans ~7.2 six-inch tiles, with a tile column beside the fridge panel (plan.patches.windows).
const KW = opening('26cd997f2a');
export const KITCHEN_WINDOW = { x0: KW.x0, x1: KW.x1, sill: KW.sill, head: KW.head };
const WINDOW_SIZE = { '26cd997f2a': KITCHEN_WINDOW };
// Annex walls by id (plan.walls), for the literals buildAnnex shares with them.
const wallOf = id => plan.walls.find(w => w.id === id);
function resizeWindows(house) {
  for (const o of house.openings) {
    const s = WINDOW_SIZE[o.id]; if (!s) continue;
    const [a0, a1, b0, b1] = o.dir === 'H' ? ['x0', 'x1', 'y0', 'y1'] : ['y0', 'y1', 'x0', 'x1'];
    const old0 = o[a0], old1 = o[a1], lo = s[a0] ?? old0, hi = s[a1] ?? old1;
    for (const p of house.pieces) if (p.wall === o.wall && p[b0] === o[b0] && p[b1] === o[b1]) {
      if (p[a0] === old0 && p[a1] === old1 && (p.kind === 'sill' || p.kind === 'lintel')) {
        p[a0] = lo; p[a1] = hi;
        if (p.kind === 'sill') p.z1 = s.sill; else p.z0 = s.head;
      } else if (p.kind === 'solid') {
        if (p[a1] === old0) p[a1] = lo;
        if (p[a0] === old1) p[a0] = hi;
      }
    }
    o[a0] = lo; o[a1] = hi; o.width = hi - lo;
    o.sillOverride = s.sill; o.headOverride = s.head;
  }
}
const once = (fn) => { let v; return () => (v ??= fn()); };
// Garage finishes (g48/g49): chocolate-charcoal paint over block, near-black sealed slab, unpainted drywall header over the laundry nook.
const GM = {
  // the garage's dark wall paint, cut from the stucco but an inside finish: its zone follows the mesh (lighting manifest)
  wall: once(() => { const m = declare(M.stucco().clone(), { zone: null }); m.color.set(0x4a3e36); m.roughness = 0.9; m.normalScale.set(0.18, 0.18); return m; }),
  floor: once(() => { const m = M.concrete().clone(); m.color.set(0x3b3937); m.roughness = 0.55; m.normalScale.set(0.15, 0.15); return m; }),
  ceiling: once(() => new THREE.MeshStandardMaterial({ color: 0x3e3833, roughness: 0.95 })),
  drywall: once(() => new THREE.MeshStandardMaterial({ color: 0xcdbfae, roughness: 0.92 })),
};

const colliders = [];   // {x0,x1,z0,z1} world AABBs the player cannot cross; `top` = height for walls under windows
export const getColliders = () => colliders;
export function addAABB(x0, x1, z0, z1, tag = '', top = CEIL) { colliders.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), tag, top }); }
const doors = [];       // interactive doors {group, pivot, open, angle, kind}
export const getDoors = () => doors;

function shapeFromPoly(pts) { return new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1]))); }
// Horizontal slab from a plan polygon at height y (faces up when `up`), UV = metres so textures tile correctly.
function slab(pts, y, mat, { up = true, holes = [] } = {}) {
  const s = shapeFromPoly(pts); for (const h of holes) s.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(p[0], p[1]))));
  const g = new THREE.ShapeGeometry(s, 8);
  g.rotateX(-Math.PI / 2);                          // XY plane -> XZ, plan y -> -z
  if (!up) {                                        // ceilings: reverse the winding so the front face looks down
    const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    const n = g.attributes.normal.array; for (let i = 1; i < n.length; i += 3) n[i] = -n[i];
  }
  const m = new THREE.Mesh(g, mat); m.position.y = y; m.receiveShadow = true; m.castShadow = false; return m;
}
function rectPts(r) { return [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]]; }

// A wall box from a plan rect (x0..x1, y0..y1) and height range (z0..z1 in metres up).
function wallBox(x0, x1, y0, y1, h0, h1, mat, collide = true) {
  const w = x1 - x0, d = y1 - y0, h = h1 - h0;
  const m = box(w, h, d, mat, { x: (x0 + x1) / 2, y: h0 + h / 2, z: -(y0 + y1) / 2 });
  if (collide && h0 < 1.2) addAABB(x0, x1, -y1, -y0, 'wall', h1);
  return m;
}

export function buildHouse(house, mods, opts = {}) {
  resizeWindows(house);
  const root = new THREE.Group(); root.name = 'house';
  declare(root, { role: 'architecture' });   // lighting manifest: the shell (doors declare their own role)
  const interior = new THREE.Group(), exterior = new THREE.Group(); root.add(interior, exterior);
  const fp = house.footprint;

  // ---- Floors & ceilings ----
  const floorMat = M.floorOak();
  interior.add(slab(fp, 0.0, floorMat));
  // bathrooms get large white tile over the oak
  for (const r of house.rooms) {
    const note = house.notes.find(n => n.room === r.id);
    if (note && /Bathroom/.test(note.label)) { const t = slab(r.pts, 0.004, M.tileWhite()); interior.add(t); }
  }
  interior.add(slab(fp, CEIL, M.ceiling(), { up: false }));
  // annex: the two closets are part of the house (oak, white ceiling); garage + laundry nook get the dark slab and ceiling
  for (const r of [WALKIN, LINEN]) { interior.add(slab(rectPts(r), 0.0, floorMat)); interior.add(slab(rectPts(r), CEIL, M.ceiling(), { up: false })); }
  // garage + laundry nook floor: the garage space's polygon (closet bay notched out at the linen closet's walls) run on
  // round the nook
  const lw = wallOf('annex-linen-w'), ls = wallOf('annex-linen-s');
  const garagePts = [[GARAGE.x0, GARAGE.y0], [GARAGE.x1, GARAGE.y0], [GARAGE.x1, ls.y0], [lw.x0, ls.y0], [lw.x0, GARAGE.y1], [LAUNDRY.x1, GARAGE.y1], [LAUNDRY.x1, LAUNDRY.y1], [LAUNDRY.x0, LAUNDRY.y1]];
  interior.add(slab(garagePts, -0.004, GM.floor()));
  interior.add(slab(garagePts, CEIL, GM.ceiling(), { up: false }));

  // ---- Walls from pieces ----
  const wallMat = M.wallPaint();
  const nichePaint = wallMat.clone(); nichePaint.color.set(0xe6e2d9);
  // RedNote 6acbf22b00: west-facing cavity below Bedroom B's closet. Replace the
  // scanned narrow south return and back with a 0.908 m opening, 0.621 m deep.
  // These pieces drive both the visible walls/baseboards and the collision list.
  const nicheWalls = new Set(plan.patches.niche.remove);   // plan.patches.niche: the scanned walls out, the niche's pieces in
  const pieces = cutOpenings(house.pieces.filter(p => !nicheWalls.has(p.wall)), EXTRA_WINDOWS);
  pieces.push(...plan.pieces.filter(p => plan.patches.niche.add.includes(p.wall)));
  const outside = (p) => isExteriorPiece(p, EXT_FP);
  for (const p of pieces) {
    const mat = p.wall.startsWith('niche-') ? nichePaint : wallMat;
    if (p.wall === 'null-88b2e5c46a') { interior.add(wallBox(p.x0, p.x1, p.y0, p.y1, 0, 1.02, wallMat, true)); interior.add(box(p.x1 - p.x0 + 0.04, 0.03, 0.30, M.quartz(), { x: (p.x0 + p.x1) / 2, y: 1.035, z: -(p.y0 + p.y1) / 2 })); continue; }
    interior.add(wallBox(p.x0, p.x1, p.y0, p.y1, p.z0, p.z1, mat, p.kind === 'solid' || p.kind === 'sill'));
    if (outside(p)) {
      // exterior skin: stucco, 0.15 thick, flush with the openings
      const s = skinRect(p, EXT_FP, 0.15);
      // the kitchen's porch wall skin starts at the garage block wall, not inside it: its end cap would show on the garage face
      if (s && p.dir === 'H' && s.x0 < GARAGE_XE && s.x1 > GARAGE_XE && s.y1 <= PORCH.y1 + 1e-3) s.x0 = GARAGE_XE;
      if (s) interior.add(wallBox(s.x0, s.x1, s.y0, s.y1, p.z0, p.z1 + (p.z1 >= CEIL - 1e-3 ? 0.12 : 0), M.stucco(), p.kind === 'solid' || p.kind === 'sill'));
    }
  }
  buildAnnex(interior, house);

  // ---- Primary bedroom: dropped soffit along the headboard wall (g26, panos 60243e1740 / b9a18422cd) ----
  interior.add(box(1.14, CEIL - 2.21, 5.357 - 1.822, M.ceiling(), { x: -2.284 - 0.57, y: (CEIL + 2.21) / 2, z: -(1.822 + 5.357) / 2 }));

  // ---- Baseboards (interior faces) ----
  for (const p of pieces) if (p.kind === 'solid') {
    const t = 0.012, h = 0.09;
    if (p.dir === 'H') { interior.add(box(p.x1 - p.x0, h, t, M.trim(), { x: (p.x0 + p.x1) / 2, y: h / 2, z: -(p.y1 + t / 2) })); interior.add(box(p.x1 - p.x0, h, t, M.trim(), { x: (p.x0 + p.x1) / 2, y: h / 2, z: -(p.y0 - t / 2) })); }
    else { interior.add(box(t, h, p.y1 - p.y0, M.trim(), { x: p.x1 + t / 2, y: h / 2, z: -(p.y0 + p.y1) / 2 })); interior.add(box(t, h, p.y1 - p.y0, M.trim(), { x: p.x0 - t / 2, y: h / 2, z: -(p.y0 + p.y1) / 2 })); }
  }

  // Alcove end-grain baseboard on the pier face; the back/side returns come from
  // the wall pieces above. The existing continuous ceiling closes the cavity.
  interior.add(box(0.012, 0.09, 0.134, M.trim(), { x: 3.3429, y: 0.045, z: -0.745 }));
  // Oak transition strip runs along the dining opening, ending at the cavity's north jamb.
  interior.add(box(2.929, 0.018, 0.105, floorMat, { x: 1.8845, y: 0.009, z: -1.70, r: 0.003, seg: 1 }));
  // Flush recessed can: opaque baffle hides the ceiling behind the glowing lens.
  const can = group(); can.name = 'niche-recessed-can';
  can.add(cyl(0.087, 0.087, 0.006, M.trim(), { x: 3.65, y: CEIL - 0.005, z: -1.254, seg: 32 }));
  const baffle = new THREE.MeshStandardMaterial({ color: 0xbcb5a5, roughness: 0.85 });
  const lens = new THREE.MeshStandardMaterial({ color: 0xffeed1, emissive: 0xffd49a, emissiveIntensity: 2.2, roughness: 0.5, userData: { emits: 'lamp' } });
  can.add(cyl(0.071, 0.071, 0.009, baffle, { x: 3.65, y: CEIL - 0.009, z: -1.254, seg: 32 }));
  const canLens = cyl(0.057, 0.057, 0.003, lens, { x: 3.65, y: CEIL - 0.015, z: -1.254, seg: 32 });
  can.add(canLens);
  const wash = new THREE.SpotLight(0xffd7aa, 3.5, 2.8, 0.85, 0.85, 2);
  wash.name = 'niche-warm-wash'; wash.position.set(3.65, CEIL - 0.03, -1.254);
  wash.target.position.set(3.94, 1.72, -1.254); wash.castShadow = false;
  can.add(wash, wash.target); interior.add(can);
  // lighting manifest: the alcove's own switch (plate on the alcove's south pier), its light the wash inside the can
  declare(can, { fixture: { kind: 'niche', lights: 'children', label: { en: 'Alcove recessed can', zh: '壁龛筒灯' }, defaultOn: ['golden', 'dusk'], plate: [3.958, 1.12, -Math.PI / 2] } });

  // ---- Header beam at the living -> dining/office opening (dropped soffit, as in the photos) ----
  interior.add(box(3.35 - 0.42, CEIL - 2.13, 0.32, wallMat, { x: (0.42 + 3.35) / 2, y: (CEIL + 2.13) / 2, z: -1.765 }));
  interior.add(box(0.12, CEIL, 0.3, wallMat, { x: 0.42 + 0.0, y: CEIL / 2, z: -1.765 }));   // the column at the wall's end

  // ---- Openings ----
  for (const o of house.openings) {
    if (o.kind === 'door') interior.add(buildDoor(o, house)); else interior.add(buildWindow(o, house, mods));
  }
  for (const o of EXTRA_WINDOWS) interior.add(buildWindow(o, house, mods));

  // ---- Exterior ----
  exterior.add(buildRoof());
  exterior.add(buildPorch(mods));
  exterior.add(buildGround());
  exterior.add(buildFence());
  exterior.add(buildNeighbourhood());
  return root;
}

// Is this wall piece on the footprint boundary? (centre line within 0.08 m of a footprint edge, running along it)
function isExteriorPiece(p, fp) {
  const cx = (p.x0 + p.x1) / 2, cy = (p.y0 + p.y1) / 2;
  for (let i = 0; i < fp.length; i++) {
    const a = fp[i], b = fp[(i + 1) % fp.length];
    if (Math.abs(a[0] - b[0]) < 1e-6 && p.dir === 'V' && Math.abs(cx - a[0]) < 0.08 && cy > Math.min(a[1], b[1]) - 0.1 && cy < Math.max(a[1], b[1]) + 0.1) return { axis: 'V', x: a[0] };
    if (Math.abs(a[1] - b[1]) < 1e-6 && p.dir === 'H' && Math.abs(cy - a[1]) < 0.08 && cx > Math.min(a[0], b[0]) - 0.1 && cx < Math.max(a[0], b[0]) + 0.1) return { axis: 'H', y: a[1] };
  }
  return null;
}
// Rect of the outer stucco skin for an exterior piece: on the side of the wall that faces away from the footprint interior.
function skinRect(p, fp, t) {
  const cx = (p.x0 + p.x1) / 2, cy = (p.y0 + p.y1) / 2;
  const inside = (x, y) => pointInPoly([x, y], fp);
  if (p.dir === 'H') { const out = inside(cx, cy + 0.2) ? -1 : 1; return out > 0 ? { x0: p.x0, x1: p.x1, y0: p.y1, y1: p.y1 + t } : { x0: p.x0, x1: p.x1, y0: p.y0 - t, y1: p.y0 }; }
  const out = inside(cx + 0.2, cy) ? -1 : 1; return out > 0 ? { x0: p.x1, x1: p.x1 + t, y0: p.y0, y1: p.y1 } : { x0: p.x0 - t, x1: p.x0, y0: p.y0, y1: p.y1 };
}
export function pointInPoly(pt, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1]; if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) c = !c; } return c; }
// Split solid pieces around extra windows into wall | sill | lintel | wall, the way the scan's own pieces come.
function cutOpenings(pieces, extra) {
  const out = [];
  for (const p of pieces) {
    const o = p.kind === 'solid' && extra.find(e => e.dir === p.dir && (p.dir === 'V'
      ? Math.abs((p.x0 + p.x1) / 2 - (e.x0 + e.x1) / 2) < 0.06 && p.y0 < e.y0 && p.y1 > e.y1
      : Math.abs((p.y0 + p.y1) / 2 - (e.y0 + e.y1) / 2) < 0.06 && p.x0 < e.x0 && p.x1 > e.x1));
    if (!o) { out.push(p); continue; }
    const [a0, a1, k0, k1] = p.dir === 'V' ? ['y0', 'y1', o.y0, o.y1] : ['x0', 'x1', o.x0, o.x1];
    out.push({ ...p, [a1]: k0 }, { ...p, [a0]: k1 }, { ...p, [a0]: k0, [a1]: k1, kind: 'sill', z0: 0, z1: o.sillOverride }, { ...p, [a0]: k0, [a1]: k1, kind: 'lintel', z0: o.headOverride, z1: CEIL });
  }
  return out;
}

// ---- Garage annex (owner's plan g07; photos g04, g27–g29, g48, g49) ----
// Block walls with a stucco skin outside and chocolate paint inside; the walk-in and linen closets are white with
// pine fit-outs; the laundry nook stays open to the garage under a drywall bulkhead.
function buildAnnex(g, house) {
  const st = M.stucco(), dark = GM.wall(), white = M.wallPaint(), pine = M.pine(), SK = 0.15, HX = CEIL + 0.12;
  const W = (x0, x1, y0, y1, h0, h1, m, c = true) => g.add(wallBox(x0, x1, y0, y1, h0, h1, m, c));
  const xo = wallOf('annex-west').x0, yo = wallOf('annex-front').y0, xe = GARAGE_XE;   // outer faces of the west, front and porch-side block walls
  const { y0: sd0, y1: sd1 } = SIDE_DOOR, { x0: gd0, x1: gd1, h: gdh } = GARAGE_DOOR;
  // west wall + skin, side door to the parking pad
  for (const [a, b] of [[yo, sd0], [sd1, LAUNDRY.y1]]) { W(xo, GARAGE.x0, a, b, 0, CEIL, dark); W(xo - SK, xo, a, b, 0, HX, st); }
  W(xo, GARAGE.x0, sd0, sd1, house.doorHeight, CEIL, dark, false); W(xo - SK, xo, sd0, sd1, house.doorHeight, HX, st, false);
  g.add(buildDoor({ id: 'gside', kind: 'door', dir: 'V', x0: xo, x1: GARAGE.x0, y0: sd0, y1: sd1, width: sd1 - sd0 }, house));
  // front wall + skin around the 8' × 7' garage door opening
  for (const [a, b] of [[GARAGE.x0, gd0], [gd1, GARAGE.x1]]) W(a, b, yo, GARAGE.y0, 0, CEIL, dark);
  for (const [a, b] of [[xo - SK, gd0], [gd1, xe + SK]]) W(a, b, yo - SK, yo, 0, HX, st);
  W(gd0, gd1, yo - SK, GARAGE.y0, gdh, HX, st, false);
  W(gd0, gd1, GARAGE.y0, GARAGE.y0 + 0.004, gdh, CEIL, dark, false);
  // white door jamb liners + exterior casing (g04)
  const trim = M.trim(), jz = -(yo - SK + GARAGE.y0) / 2, jd = GARAGE.y0 - (yo - SK);
  for (const x of [gd0 + 0.01, gd1 - 0.01]) g.add(box(0.02, gdh, jd, trim, { x, y: gdh / 2, z: jz }));
  g.add(box(gd1 - gd0, 0.02, jd, trim, { x: (gd0 + gd1) / 2, y: gdh - 0.01, z: jz }));
  for (const x of [gd0 - 0.045, gd1 + 0.045]) g.add(box(0.09, gdh + 0.09, 0.025, trim, { x, y: (gdh + 0.09) / 2, z: -(yo - SK - 0.012) }));
  g.add(box(gd1 - gd0 + 0.18, 0.09, 0.025, trim, { x: (gd0 + gd1) / 2, y: gdh + 0.045, z: -(yo - SK - 0.012) }));
  // porch-side wall (the garage's east face, under the main roof) + skin
  W(GARAGE.x1, xe, yo, PORCH.y1, 0, CEIL, dark); W(xe, xe + SK, yo, PORCH.y1, 0, HX, st);
  // chocolate paint over the kitchen wall's garage face, from the front wall to the door casing (the porch-side stretch
  // too: that wall's centre is under the porch, so on its own it would take the exterior lighting)
  W(GARAGE.x1 - 0.016, GARAGE.x1, GARAGE.y0, -1.423, 0, CEIL, dark, false);
  // ...and over the header above the casing, up to the linen closet's south wall
  W(GARAGE.x1 - 0.016, GARAGE.x1, -1.423, LINEN.y0 - 0.118, house.doorHeight + 0.07, CEIL, dark, false);

  // linen closet (louvered bifold off the vestibule): west + south walls, pine shelving at the back
  const lw = wallOf('annex-linen-w'), ls = wallOf('annex-linen-s'), lx = lw.x0, ls0 = ls.y0;
  W(lx, lw.x1, ls0, lw.y1, 0, CEIL, white); W(ls.x0, ls.x1, ls0, ls.y1, 0, CEIL, white);
  W(-4.934, lx, ls0, GARAGE.y1, 0, CEIL, dark, false); W(lx, GARAGE.x1, ls0 - 0.004, ls0, 0, CEIL, dark, false);
  for (let i = 0; i < 5; i++) {
    const y = 0.42 + i * 0.4;
    g.add(box(LINEN.x1 - LINEN.x0, 0.022, 0.4, pine, { x: (LINEN.x0 + LINEN.x1) / 2, y, z: -(LINEN.y0 + 0.2) }));
    for (const x of [LINEN.x0 + 0.01, LINEN.x1 - 0.01]) g.add(box(0.02, 0.03, 0.4, pine, { x, y: y - 0.026, z: -(LINEN.y0 + 0.2) }));
  }

  // walk-in closet: south wall to the garage, partition to the laundry nook; pine hanging bay + cubbies (g29)
  const ws = wallOf('annex-walkin-s'), ww = wallOf('annex-walkin-w');
  W(ws.x0, ws.x1, ws.y0, ws.y1, 0, CEIL, white); W(ww.x0, ww.x1, ww.y0, ww.y1, 0, CEIL, white);
  W(LAUNDRY.x1 - 0.004, -4.934, GARAGE.y1 - 0.004, GARAGE.y1, 0, CEIL, dark, false);
  W(LAUNDRY.x1 - 0.004, LAUNDRY.x1, GARAGE.y1, LAUNDRY.y1 - 0.016, 0, CEIL, dark, false);
  const hx0 = WALKIN.x0, hx1 = -5.08, hd = 0.5, hz = -(WALKIN.y0 + hd / 2);
  for (const x of [hx0 + 0.009, hx1 - 0.009]) g.add(box(0.018, 2.05, hd, pine, { x, y: 1.025, z: hz }));
  for (const y of [1.74, 2.04]) g.add(box(hx1 - hx0, 0.02, hd, pine, { x: (hx0 + hx1) / 2, y, z: hz }));
  g.add(cyl(0.012, 0.012, hx1 - hx0 - 0.036, M.steel(), { x: (hx0 + hx1) / 2, y: 1.66, z: -(WALKIN.y0 + 0.27), rz: Math.PI / 2, seg: 12 }));
  for (let i = 0; i < 9; i++) {
    const hg = new THREE.Group(); hg.position.set(hx0 + 0.12 + i * 0.105, 1.66, -(WALKIN.y0 + 0.27)); hg.rotation.y = Math.PI / 2 + (i % 3 - 1) * 0.06;
    hg.add(box(0.42, 0.014, 0.012, pine, { y: -0.075 })); hg.add(tube([[0, -0.07, 0], [0, -0.02, 0], [0, 0.012, 0.01], [0, 0.012, -0.012]], 0.0025, M.steel(), { seg: 8, radial: 5 }));
    for (const s of [-1, 1]) { const arm = box(0.2, 0.012, 0.012, pine, { x: s * 0.1, y: -0.045 }); arm.rotation.z = s * 0.3; hg.add(arm); }
    g.add(hg);
  }
  const cx0 = WALKIN.x0, cx1 = -5.5, cd = 0.32, cz = -(WALKIN.y1 - cd / 2);
  for (const x of [cx0 + 0.009, (cx0 + cx1) / 2, cx1 - 0.009]) g.add(box(0.018, 2.1, cd, pine, { x, y: 1.05, z: cz }));
  for (let i = 0; i < 7; i++) g.add(box(cx1 - cx0, 0.018, cd, pine, { x: (cx0 + cx1) / 2, y: 0.06 + i * 0.34, z: cz }));

  // laundry nook: bulkhead across its mouth (g48), chocolate paint on the bath wall above the machines
  W(LAUNDRY.x0, LAUNDRY.x1, GARAGE.y1 - 0.12, WALKIN.y0, 2.08, CEIL, GM.drywall(), false);
  W(LAUNDRY.x0, LAUNDRY.x1 - 0.004, LAUNDRY.y1 - 0.016, LAUNDRY.y1 - 0.012, 0, CEIL, dark, false);
}

// ---- Doors ----
// Door type, hinge jamb + swing side (plan compass) and resting state from the plan's openings (plan_overlay.json
// openings.spec says why each is set); doors without a spec keep the scan default.
const DOOR_TYPES = Object.fromEntries(plan.openings.filter(o => o.kind === 'door').map(o => [o.id, o.type]));
const DOOR_SPEC = Object.fromEntries(plan.openings.filter(o => o.kind === 'door' && ['hinge', 'swing', 'open', 'white'].some(k => k in o))
  .map(o => [o.id, Object.fromEntries(['hinge', 'swing', 'open', 'white'].filter(k => k in o).map(k => [k, o[k]]))]));
// Six-panel leaf (the interior doors in g26/g31): raised panels both faces, 0.11 stiles.
function sixPanel(leafW, H, leafT, mat, x0) {
  const g = new THREE.Group();
  g.add(box(leafW, H - 0.02, leafT, mat, { r: 0.003, x: x0 + leafW / 2, y: (H - 0.02) / 2 + 0.01 }));
  const st = 0.11, mull = 0.1, pw = (leafW - 2 * st - mull) / 2;
  const rows = [[0.22, 0.78], [0.98, 1.62], [1.72, H - 0.12]];
  for (const [a, b] of rows) for (const i of [0, 1]) for (const s of [-1, 1]) {
    const px = x0 + st + pw / 2 + i * (pw + mull);
    g.add(box(pw - 0.02, b - a - 0.02, 0.008, mat, { r: 0.0035, seg: 2, x: px, y: (a + b) / 2, z: s * (leafT / 2 + 0.001) }));
    g.add(box(pw, b - a, 0.002, M.doorWhite(), { x: px, y: (a + b) / 2, z: s * (leafT / 2 - 0.0004) }));
  }
  return g;
}
// One louvered leaf as a single geometry (stiles, rails, 45° slats in two fields), origin at its bottom centre.
function louverLeafGeo(w, h, t, slatDepth = t * 0.95) {
  const parts = [], st = 0.042, rt = 0.07, rb = 0.11, rm = 0.07, mid = h * 0.47;
  const add = (bw, bh, bd, x, y, z = 0, rx = 0) => { const b = new THREE.BoxGeometry(bw, bh, bd); if (rx) b.rotateX(rx); b.translate(x, y, z); parts.push(b); };
  for (const s of [-1, 1]) add(st, h, t, s * (w / 2 - st / 2), h / 2);
  add(w - 2 * st, rb, t, 0, rb / 2); add(w - 2 * st, rt, t, 0, h - rt / 2); add(w - 2 * st, rm, t, 0, mid);
  for (const [a, b] of [[rb, mid - rm / 2], [mid + rm / 2, h - rt]]) for (let y = a + 0.022; y < b - 0.012; y += 0.036) add(w - 2 * st, 0.006, slatDepth, 0, y, 0, -0.75);
  const g = mergeGeometries(parts, false); for (const p of parts) p.dispose(); return g;
}
function buildDoor(o, house) {
  const g = new THREE.Group(); g.name = 'door-' + o.id;
  if (o.id === 'd8425baf7a') g.userData.viewRoom = FRONT_CLOSET_VIEW;
  const type = DOOR_TYPES[o.id] || 'door';
  const H = house.doorHeight, w = o.width, isH = o.dir === 'H';
  const cx = (o.x0 + o.x1) / 2, cy = (o.y0 + o.y1) / 2, thick = isH ? o.y1 - o.y0 : o.x1 - o.x0;
  g.position.set(cx, 0, -cy); g.rotation.y = isH ? 0 : Math.PI / 2;   // local x runs along the opening, local z through the wall
  const jamb = 0.016, trimW = 0.07, tm = type === 'pineOpening' || type === 'bifold' && !DOOR_SPEC[o.id]?.white ? M.pine() : M.trim();
  if (type !== 'opening') {
    // jambs + casing both sides
    g.add(box(jamb, H, thick + 0.02, tm, { x: -w / 2 + jamb / 2, y: H / 2 })); g.add(box(jamb, H, thick + 0.02, tm, { x: w / 2 - jamb / 2, y: H / 2 })); g.add(box(w, jamb, thick + 0.02, tm, { y: H - jamb / 2 }));
    for (const s of [-1, 1]) { g.add(box(w + trimW * 2, trimW, 0.014, tm, { y: H + trimW / 2, z: s * (thick / 2 + 0.007) })); g.add(box(trimW, H + trimW, 0.014, tm, { x: -w / 2 - trimW / 2, y: (H + trimW) / 2, z: s * (thick / 2 + 0.007) })); g.add(box(trimW, H + trimW, 0.014, tm, { x: w / 2 + trimW / 2, y: (H + trimW) / 2, z: s * (thick / 2 + 0.007) })); }
  } else {
    for (const s of [-1, 1]) g.add(box(w + trimW * 2, trimW, 0.014, M.trim(), { y: H + trimW / 2, z: s * (thick / 2 + 0.007) }));
  }
  const leafW = w - jamb * 2, leafT = 0.04;
  if (type === 'door' || type === 'front') {
    const sp = DOOR_SPEC[o.id], hs = sp && (sp.hinge === 'N' || sp.hinge === 'E') ? -1 : 1;   // +1: hinges on the low-x / low-y jamb
    const pivot = new THREE.Group(); pivot.position.set(-hs * leafW / 2, 0, 0); g.add(pivot);
    pivot.add(sixPanel(leafW, H, leafT, M.doorWhite(), hs > 0 ? 0 : -leafW));
    for (const s of [-1, 1]) { pivot.add(cyl(0.028, 0.028, 0.012, M.doorBlackHardware(), { x: hs * (leafW - 0.065), y: 1.0, z: s * (leafT / 2 + 0.006), rx: Math.PI / 2 })); pivot.add(box(0.12, 0.016, 0.016, M.doorBlackHardware(), { x: hs * (leafW - 0.065 - 0.05), y: 1.0, z: s * (leafT / 2 + 0.03), r: 0.005 })); }
    // rotating +θ swings a low-end-hinged leaf toward -local z (north on H walls, west on V walls)
    const openAngle = sp ? 1.45 * hs * ((isH ? sp.swing === 'N' : sp.swing === 'W') ? 1 : -1) : (type === 'front' ? -1.5 : 1.35);
    const open0 = sp ? (sp.open ? openAngle : 0) : (type === 'front' || o.id === '2e2d4a125a' ? 0 : 1.35);
    pivot.rotation.y = open0;
    const d = { id: o.id, group: g, pivot, angle: open0, target: open0, openAngle, kind: type, w: leafW, plan: { cx, cy, isH }, openDefault: open0 !== 0 };
    doors.push(d); g.userData.door = d;
    if (!open0) setHinged(d, false);
  } else if (type === 'bifold') {
    // Two pairs fold to their jambs; pine opens into the vestibule, white into the bedroom.
    const sp = DOOR_SPEC[o.id], swing = sp?.swing === 'S' ? -1 : 1;
    const n = 4, lw = leafW / n - 0.003, lt = 0.03, P = sp?.white ? M.doorWhite() : M.pine();
    const leafGeo = louverLeafGeo(lw, H - 0.03, lt, sp?.white ? 0.054 : lt * 0.95);
    const pairs = [];
    for (const s of [1, -1]) {
      const p1 = new THREE.Group(); p1.position.set(-s * leafW / 2, 0, -swing * lt / 2); g.add(p1);
      const p2 = new THREE.Group(); p2.position.set(s * (lw + 0.003), 0, 0); p1.add(p2);
      for (const p of [p1, p2]) { const m = new THREE.Mesh(leafGeo, P); m.castShadow = m.receiveShadow = true; m.position.set(s * lw / 2, 0.01, 0); p.add(m); }
      p2.add(cyl(0.012, 0.012, 0.03, M.blackSteel(), { x: s * (lw - 0.04), y: 1.0, z: -swing * (lt / 2 + 0.012), rx: Math.PI / 2, seg: 12 }));
      pairs.push({ p1, p2, s });
    }
    if (!sp?.white) for (const sz of [-1, 1]) g.add(box(w + trimW * 2, CEIL - H - trimW, 0.014, P, { y: H + trimW + (CEIL - H - trimW) / 2, z: sz * (thick / 2 + 0.007) }));
    const open0 = sp?.open === false ? 0 : 1;
    const d = { id: o.id, group: g, kind: 'bifold', target: open0, fold: open0, w, thick, plan: { cx, cy, isH }, openDefault: !!open0 };
    const pose = (t) => { const a = swing * t * 1.35; for (const { p1, p2, s } of pairs) { p1.rotation.y = s * a; p2.rotation.y = -s * 2 * a; } };
    d.tick = (dt) => {
      if (d._goal !== d.target) { d._goal = d.target; d._from = d.fold; d._t = 0; }
      if (d._t < 1) { d._t = Math.min(1, d._t + dt / 0.9); d.fold = d._from + (d.target - d._from) * doorEase(d._t); pose(d.fold); }
    };
    pose(open0); doors.push(d); g.userData.door = d; setBifold(d, open0);
  } else if (type === 'louver' || type === 'louverWhite') {
    const mat = type === 'louver' ? M.louver() : M.doorWhite();
    const n = w > 1.0 ? 4 : 2, lw = leafW / n;
    for (let i = 0; i < n; i++) { const l = box(lw - 0.006, H - 0.03, 0.03, mat, { x: -leafW / 2 + lw * (i + 0.5), y: (H - 0.03) / 2 + 0.01 }); g.add(l); if (type === 'louverWhite') for (let k = 0; k < 28; k++) g.add(box(lw - 0.08, 0.02, 0.025, M.doorWhite(), { x: -leafW / 2 + lw * (i + 0.5), y: 0.35 + k * 0.058, z: 0.0, rx: 0.6 })); }
    addAABB(cx - (isH ? w / 2 : thick / 2), cx + (isH ? w / 2 : thick / 2), -(cy + (isH ? thick / 2 : w / 2)), -(cy - (isH ? thick / 2 : w / 2)), 'closet');
  } else if (type === 'slider') {
    // aluminium sliding glass door: fixed panel + sliding panel (open 0.6 m so you can walk out)
    const fr = M.aluminum(), pw = leafW / 2;
    g.add(box(leafW, 0.05, 0.08, fr, { y: H - 0.025 })); g.add(box(leafW, 0.03, 0.08, fr, { y: 0.015 }));
    const panel = (x, z, offset) => { const pg = new THREE.Group(); pg.position.set(x, 0, z); const f = 0.045; pg.add(box(pw, f, 0.035, fr, { y: H - 0.05 - f / 2 })); pg.add(box(pw, 0.09, 0.035, fr, { y: 0.03 + 0.045 })); pg.add(box(f, H - 0.06, 0.035, fr, { x: -pw / 2 + f / 2, y: H / 2 })); pg.add(box(f, H - 0.06, 0.035, fr, { x: pw / 2 - f / 2, y: H / 2 })); pg.add(plane(pw - f * 2, H - 0.2, M.glass(), { y: H / 2 + 0.02, double: true })); if (offset) pg.add(box(0.025, 0.25, 0.02, M.blackSteel(), { x: pw / 2 - 0.06, y: 1.0, z: 0.03, r: 0.006 })); return pg; };
    g.add(panel(-pw / 2, -0.02, false)); const sl = panel(pw / 2 - 0.6, 0.02, true); g.add(sl);
    doors.push({ id: o.id, group: g, slide: sl, kind: 'slider', open: 0.6, w: pw, thick, plan: { cx, cy, isH } });
    // The fixed half stays solid; setSlider handles the moving half.
    if (isH) addAABB(cx - w / 2, cx, -(cy + thick / 2), -(cy - thick / 2), 'slider'); else addAABB(cx - thick / 2, cx + thick / 2, -(cy + 0), -(cy - w / 2), 'slider');
    g.userData.door = doors[doors.length - 1];
  } else if (type === 'french4' || type === 'french2') {
    const n = type === 'french4' ? 4 : 2, lw = leafW / n;
    const leafMat = M.doorWhite();
    const leaves = [];
    for (let i = 0; i < n; i++) {
      const hingeLeft = i < n / 2;                       // outer leaves hinge at the jambs, inner leaves fold back onto them
      const pivot = new THREE.Group(); const px = -leafW / 2 + lw * (hingeLeft ? i : i + 1); pivot.position.set(px, 0, 0); g.add(pivot);
      const sgn = hingeLeft ? 1 : -1;
      const lg = new THREE.Group(); pivot.add(lg);
      const f = 0.09;
      lg.add(box(lw - 0.006, f, leafT, leafMat, { x: sgn * lw / 2, y: f / 2 + 0.01 })); lg.add(box(lw - 0.006, f, leafT, leafMat, { x: sgn * lw / 2, y: H - f / 2 - 0.01 }));
      lg.add(box(f, H - 0.02, leafT, leafMat, { x: sgn * (f / 2 + 0.003), y: H / 2 })); lg.add(box(f, H - 0.02, leafT, leafMat, { x: sgn * (lw - f / 2 - 0.003), y: H / 2 }));
      lg.add(plane(lw - f * 2, H - f * 2 - 0.02, M.glass(), { x: sgn * lw / 2, y: H / 2, double: true }));
      lg.add(cyl(0.012, 0.012, 0.11, M.blackSteel(), { x: sgn * (lw - 0.12), y: 1.0, z: leafT / 2 + 0.03, rz: Math.PI / 2 }));
      leaves.push({ pivot, sgn, hingeLeft });
    }
    const d = { id: o.id, group: g, leaves, kind: 'french', open: 0, target: 0, plan: { cx, cy, isH }, w, thick };
    doors.push(d); g.userData.door = d; setFrench(d, 0);
  }
  // Lighting manifest: hinged and bifold leaves take the probe volume in every pose (the bake fits only the pose it saw);
  // the glazed garden doors (french, sliders) keep the bake. bakePose: the pose the bake export sets (plan bakeOpen).
  if (g.userData.door) declare(g, { role: 'door', leaves: ['french', 'slider'].includes(g.userData.door.kind) ? 'lightmap' : 'probe', bakePose: o.bakeOpen ? 'open' : 'site' });
  return g;
}
// Door motion profile (smootherstep): leaves start and stop gently.
export const doorEase = (t) => t * t * t * (t * (6 * t - 15) + 10);
// French doors: target t in 0..1 swings every leaf outward onto the patio (-local z = plan north for H walls);
// the leaves ease there in poseFrench (driven from interact.js).
export function poseFrench(d, v) {
  d.open = v;
  for (const l of d.leaves) l.pivot.rotation.y = v * (l.hingeLeft ? 1 : -1) * 1.65;
}
export function setFrench(d, t) {
  d.target = t;
  // collider: closed = full width block; open = free
  const i = getColliders().findIndex(c => c.tag === 'french-' + d.id);
  if (i >= 0) getColliders().splice(i, 1);
  if (t < 0.5) { const { cx, cy, isH } = d.plan; if (isH) addAABB(cx - d.w / 2, cx + d.w / 2, -(cy + d.thick / 2), -(cy - d.thick / 2), 'french-' + d.id); else addAABB(cx - d.thick / 2, cx + d.thick / 2, -(cy + d.w / 2), -(cy - d.w / 2), 'french-' + d.id); }
}
export function setBifold(d, t) {
  d.target = t;
  const i = getColliders().findIndex(c => c.tag === 'bifold-' + d.id); if (i >= 0) getColliders().splice(i, 1);
  if (t < 0.5) { const { cx, cy, isH } = d.plan; if (isH) addAABB(cx - d.w / 2, cx + d.w / 2, -(cy + d.thick / 2), -(cy - d.thick / 2), 'bifold-' + d.id); else addAABB(cx - d.thick / 2, cx + d.thick / 2, -(cy + d.w / 2), -(cy - d.w / 2), 'bifold-' + d.id); }
}
export function setSlider(d, open) {
  d.open = open ? 0.6 : 0.02;
  const i = getColliders().findIndex(c => c.tag === 'slider-' + d.id); if (i >= 0) getColliders().splice(i, 1);
  if (!open) { const { cx, cy, isH } = d.plan; if (isH) addAABB(cx, cx + d.w, -(cy + d.thick / 2), -(cy - d.thick / 2), 'slider-' + d.id); else addAABB(cx - d.thick / 2, cx + d.thick / 2, -(cy + d.w), -cy, 'slider-' + d.id); }
}
export function setHinged(d, open) {
  d.target = open ? (d.openAngle ?? (d.kind === 'front' ? -1.5 : 1.35)) : 0;
  const i = getColliders().findIndex(c => c.tag === 'hinged-' + d.id); if (i >= 0) getColliders().splice(i, 1);
  if (!open) { const { cx, cy, isH } = d.plan; if (isH) addAABB(cx - d.w / 2, cx + d.w / 2, -(cy + 0.06), -(cy - 0.06), 'hinged-' + d.id); else addAABB(cx - 0.06, cx + 0.06, -(cy + d.w / 2), -(cy - d.w / 2), 'hinged-' + d.id); }
}

// ---- Windows ----
function buildWindow(o, house, mods) {
  const g = new THREE.Group(); g.name = 'window-' + o.id;
  const isH = o.dir === 'H', w = o.width, sill = o.sillOverride ?? house.windowSill, head = o.headOverride ?? house.windowHead, h = head - sill;
  const cx = (o.x0 + o.x1) / 2, cy = (o.y0 + o.y1) / 2, thick = isH ? o.y1 - o.y0 : o.x1 - o.x0;
  // +Z faces the interior: south/east windows need the opposite sill orientation.
  const south = isH && cy < -4, east = !isH && cx > 0;
  g.position.set(cx, 0, -cy); g.rotation.y = isH ? (south ? Math.PI : 0) : (east ? -Math.PI / 2 : Math.PI / 2);
  const fr = M.trim(), f = 0.05, T = thick + 0.15 + 0.02;   // frame spans interior wall + stucco skin
  // outer frame
  g.add(box(w, f, T, fr, { y: sill + f / 2 })); g.add(box(w, f, T, fr, { y: head - f / 2 })); g.add(box(f, h, T, fr, { x: -w / 2 + f / 2, y: sill + h / 2 })); g.add(box(f, h, T, fr, { x: w / 2 - f / 2, y: sill + h / 2 }));
  // sashes: windows wider than 1.5 m are two side-by-side double-hung units, else one
  const units = w > 1.5 ? 2 : 1, uw = (w - 2 * f) / units;
  for (let u = 0; u < units; u++) {
    const ux = -w / 2 + f + uw * (u + 0.5);
    if (u > 0) g.add(box(0.06, h, T, fr, { x: -w / 2 + f + uw * u, y: sill + h / 2 }));
    const sw = uw - (units > 1 ? 0.06 : 0), sf = 0.035;
    for (const [y0, y1, z] of [[sill + f, sill + f + (h - 2 * f) / 2, 0.012], [sill + f + (h - 2 * f) / 2, head - f, -0.012]]) {
      const sh = y1 - y0; g.add(box(sw, sf, 0.04, fr, { x: ux, y: y0 + sf / 2, z })); g.add(box(sw, sf, 0.04, fr, { x: ux, y: y1 - sf / 2, z })); g.add(box(sf, sh, 0.04, fr, { x: ux - sw / 2 + sf / 2, y: (y0 + y1) / 2, z })); g.add(box(sf, sh, 0.04, fr, { x: ux + sw / 2 - sf / 2, y: (y0 + y1) / 2, z }));
      g.add(plane(sw - 2 * sf, sh - 2 * sf, M.glass(), { x: ux, y: (y0 + y1) / 2, z, double: true }));
    }
  }
  // interior stool (sill shelf) + exterior sill
  // The living-room builder supplies its own solid pine sill.
  if (o.id !== '92767b980a') g.add(box(w + 0.12, 0.03, 0.09, fr, { y: sill - 0.015, z: thick / 2 + 0.03 }));
  g.add(box(w + 0.06, 0.04, 0.08, M.stucco(), { y: sill - 0.02, z: -(thick / 2 + 0.15 + 0.02), rx: 0.15 }));
  g.userData.window = { w, h, sill, head };
  return g;
}

// ---- Roof: low hip over the whole house+garage rectangle, 0.6 m overhang, 3:12 pitch ----
function buildRoof() {
  const g = new THREE.Group();
  const OH = 0.62, x0 = -8.02 - 0.15 - OH, x1 = 8.03 + 0.15 + OH, y0 = -5.85 - 0.15 - OH, y1 = 5.47 + 0.15 + OH;   // plan rect incl. stucco skin and overhang
  const eave = CEIL + 0.12, pitch = 0.25, W = x1 - x0, D = y1 - y0, rise = (D / 2) * pitch, ridgeY = eave + rise;
  const rx0 = x0 + D / 2, rx1 = x1 - D / 2, cy = (y0 + y1) / 2;
  const v = (x, y, h) => [x, h, -y];
  const quads = [
    [v(x0, y0, eave), v(x1, y0, eave), v(rx1, cy, ridgeY), v(rx0, cy, ridgeY)],   // south face
    [v(x1, y1, eave), v(x0, y1, eave), v(rx0, cy, ridgeY), v(rx1, cy, ridgeY)],   // north face
    [v(x1, y0, eave), v(x1, y1, eave), v(rx1, cy, ridgeY)],                       // east hip
    [v(x0, y1, eave), v(x0, y0, eave), v(rx0, cy, ridgeY)],                       // west hip
  ];
  const pos = [], uv = [];
  for (const q of quads) { const tri = q.length === 4 ? [q[0], q[1], q[2], q[0], q[2], q[3]] : q; for (const p of tri) { pos.push(...p); uv.push(p[0] / 2.5, p[2] / 2.5); } }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.computeVertexNormals();
  const roof = new THREE.Mesh(geo, M.roof()); roof.castShadow = true; roof.receiveShadow = true; g.add(roof);
  // thicken: a second slightly lower copy for the underside edge, soffit plane, fascia
  const soffit = new THREE.Mesh(new THREE.BoxGeometry(W, 0.02, D), M.soffit()); soffit.position.set((x0 + x1) / 2, eave - 0.01, -cy); soffit.receiveShadow = true; g.add(soffit);
  const fasciaH = 0.2;
  const fas = M.soffit();
  g.add(box(W, fasciaH, 0.03, fas, { x: (x0 + x1) / 2, y: eave - fasciaH / 2 + 0.1, z: -y0 + 0.0 })); g.add(box(W, fasciaH, 0.03, fas, { x: (x0 + x1) / 2, y: eave - fasciaH / 2 + 0.1, z: -y1 }));
  g.add(box(0.03, fasciaH, D, fas, { x: x0, y: eave - fasciaH / 2 + 0.1, z: -cy })); g.add(box(0.03, fasciaH, D, fas, { x: x1, y: eave - fasciaH / 2 + 0.1, z: -cy }));
  // gutters (half round) along the front and back eaves
  for (const yy of [y0, y1]) g.add(cyl(0.06, 0.06, W, M.aluminum(), { x: (x0 + x1) / 2, y: eave + 0.05, z: -yy, rz: Math.PI / 2, seg: 12 }));
  g.userData.eave = { x0, x1, y0, y1, eave };
  return g;
}

function buildPorch(mods) {
  const g = new THREE.Group();
  // porch slab, from the garage block wall's outer face (its 2 cm lip would show on the garage face)
  g.add(box(PORCH.x1 - GARAGE_XE, 0.12, PORCH.y1 - PORCH.y0, M.concrete(), { x: (GARAGE_XE + PORCH.x1) / 2, y: -0.06 + 0.02, z: -(PORCH.y0 + PORCH.y1) / 2 }));
  // front step
  g.add(box(WALK.x1 - WALK.x0 + 0.5, 0.14, 0.4, M.concrete(), { x: (WALK.x0 + WALK.x1) / 2, y: -0.14 / 2 - 0.02, z: -(PORCH.y0 - 0.2) }));
  return g;
}

// ---- Ground surfaces (lot), composed from the aerial photo (g50): dark mulch beds, a white shell-gravel lounge with
//      lumber edging behind the terrace, concrete terrace/walk/drive, white pebble courtyards with low rendered walls.
export const LOUNGE = [[-2.6, 9.3], [5.2, 9.3], [5.6, 11.0], [5.3, 14.6], [2.0, 15.2], [-1.8, 14.4], [-2.9, 12.0]];
export const FRONT_BED = [[-4.9, -5.85], [8.3, -5.85], [8.3, -8.1], [7.5, -11.8], [6.4, -14.2], [-4.9, -14.2]];
export const WEST_SHELL = [[-14.5, -14.2], [-8.17, -14.2], [-8.17, -7.2], [-11.5, -7.2], [-11.5, 0.17], [-14.5, 0.17]];
export const FRONT_TERRACE = { x0: -4.05, x1: 4.45, y0: -10.8, y1: -7.85 };
export const FRONT_WALK = ribbonPoly([[-4.95, -7.05], [-3.0, -7.05], [-1.3, -7.25], [0, -6.55]], 1.15);
export const COURT_PAD = { x0: 4.3, x1: 6.4, y0: 5.47, y1: 7.3 };          // concrete pad in courtyard B
export const AC_UNITS = { x0: -9.2, x1: -8.3, y0: 0.55, y1: 2.45 };        // two condensers against the garage's west wall
// Everything inside the fences that isn't paved or shell is planted bed over dark mulch (ground cover from grass.js).
export const GARDEN = [[LOT.x0 + 0.3, WEST_FENCE_Y], [-8.17, WEST_FENCE_Y], [-8.17, -1.0], [LOT.x1 - 0.3, -1.0], [LOT.x1 - 0.3, 19.2], [LOT.x0 + 0.3, 19.2]];
// Shell side paths (g47): west from the fence return past the AC units, round courtyard A into the lounge; east up the side yard.
function ribbonPoly(pts, w) {
  const c = new THREE.SplineCurve(pts.map(p => new THREE.Vector2(p[0], p[1]))).getSpacedPoints(Math.max(8, Math.round(c0len(pts) / 0.4)));
  const L = [], R = [];
  for (let i = 0; i < c.length; i++) { const a = c[Math.max(0, i - 1)], b = c[Math.min(c.length - 1, i + 1)], dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1, nx = -dy / l * w / 2, ny = dx / l * w / 2; L.push([c[i].x + nx, c[i].y + ny]); R.push([c[i].x - nx, c[i].y - ny]); }
  return L.concat(R.reverse());
}
function c0len(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; }
export const SIDE_PATHS = [
  ribbonPoly([[-10.6, 0.1], [-10.55, 3.4], [-10.1, 6.6], [-8.4, 8.75], [-6.6, 9.3], [-5.0, 9.75], [-2.3, 11.55]], 1.3),
  ribbonPoly([[10.6, -1.05], [10.55, 2.6], [10.35, 6.0], [10.0, 8.3]], 1.2),
];
// The front lawn has no mulched islands in the drone orbit.
export const ISLAND_BEDS = [];
function buildGround() {
  const g = new THREE.Group();
  // base: St. Augustine turf outside the fences (lot front, street verge, east side lawn, neighbours' yards); blades in grass.js
  g.add(slab([[-80, -80], [80, -80], [80, 80], [-80, 80]], -0.09, M.turf()));
  g.add(slab(rectPts(LOT), -0.03, M.turf()));
  // dark mulch only under the dense beds: the fenced garden and the front-lawn islands
  g.add(slab(GARDEN, -0.024, M.bedMulch()));
  for (const b of ISLAND_BEDS) g.add(slab(b, -0.02, M.bedMulch()));
  // shell gravel: front beds, the back lounge (slightly proud of the mulch, with lumber edging) and the side paths
  g.add(slab(FRONT_BED, -0.008, M.shellWhite()));
  g.add(slab(WEST_SHELL, -0.008, M.shellWhite()));
  g.add(slab(rectPts(FRONT_TERRACE), 0.22, M.shellWhite()));
  g.add(slab(LOUNGE, -0.006, M.shellWhite()));
  for (const p of SIDE_PATHS) g.add(slab(p, -0.007, M.shellWhite()));
  edging(g, LOUNGE); 
  // concrete: terrace, walk, drive, parking pad, courtyard B pad
  for (const r of [PATIO, COURT_PAD]) g.add(slab(rectPts(r), 0.012, M.concrete()));
  const frontConcrete = new THREE.MeshStandardMaterial({ color: 0xc3c1b8, roughness: 0.95 });
  for (const r of [WALK, DRIVE, PAD]) g.add(slab(rectPts(r), 0.012, frontConcrete));
  g.add(slab(FRONT_WALK, 0.014, frontConcrete));
  for (const y of [-9.9, -12.0]) g.add(box(DRIVE.x1 - DRIVE.x0, 0.003, 0.009, M.blackMatte(), { x: (DRIVE.x0 + DRIVE.x1) / 2, y: 0.013, z: -y }));
  // courtyards: white pebbles with low rendered walls
  for (const r of [COURT_A, COURT_B]) g.add(slab(rectPts(r), 0.0, M.pebbles()));
  const lowWall = (x0, x1, y0, y1) => { g.add(box(x1 - x0, 0.42, y1 - y0, M.stucco(), { x: (x0 + x1) / 2, y: 0.21, z: -(y0 + y1) / 2 })); g.add(box(x1 - x0 + 0.04, 0.03, y1 - y0 + 0.04, M.trim(), { x: (x0 + x1) / 2, y: 0.435, z: -(y0 + y1) / 2 })); addAABB(x0, x1, -y1, -y0, 'lowwall'); };
  lowWall(COURT_A.x0, COURT_A.x1 - 1.2, COURT_A.y1 - 0.16, COURT_A.y1); lowWall(COURT_A.x0, COURT_A.x0 + 0.16, 5.6, COURT_A.y1);
  lowWall(COURT_B.x0 + 1.2, COURT_B.x1, COURT_B.y1 - 0.16, COURT_B.y1); lowWall(COURT_B.x1 - 0.16, COURT_B.x1, 5.6, COURT_B.y1);
  // The drone orbit shows shell and lawn meeting the road, with no public sidewalk across this lot.
  g.add(slab([[-60, -22], [60, -22], [60, -14.2], [-60, -14.2]], -0.025, M.asphalt()));
  for (const [x0, x1] of [[-60, LOT.x0], [LOT.x1, 60]]) g.add(slab([[x0, -14.2], [x1, -14.2], [x1, -13], [x0, -13]], -0.012, M.concrete()));
  // curb line
  g.add(box(120, 0.12, 0.2, M.concrete(), { x: 0, y: -0.06, z: 14.2 }));
  // house slab edge: a stem wall around the footprint + garage
  const stem = new THREE.MeshStandardMaterial({ color: 0xe6e3dc, roughness: 0.9 });
  g.add(box(16.65, 0.2, 11.9, stem, { x: 0.0, y: -0.115, z: 0.19 }));   // top at -0.015: never coplanar with the floor slab
  // AC condensers on the west side yard
  const ac = new THREE.MeshStandardMaterial({ color: 0x8e9398, roughness: 0.6, metalness: 0.3 });
  for (const y of [1.0, 2.0]) { g.add(box(0.8, 0.85, 0.8, ac, { r: 0.02, x: -8.75, y: 0.45, z: -y })); g.add(cyl(0.3, 0.3, 0.02, M.blackMatte(), { x: -8.75, y: 0.88, z: -y })); addAABB(-9.2, -8.3, -y - 0.45, -y + 0.45, 'ac'); }
  return g;
}
// 2x6 pressure-treated edging boards laid along a polygon (the lounge and bed borders in the aerial)
function edging(g, poly) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]; const len = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
    const m = box(len, 0.14, 0.04, M.lumber(), { x: (a[0] + b[0]) / 2, y: 0.03, z: -(a[1] + b[1]) / 2 }); m.rotation.y = -ang; g.add(m);
  }
}

// ---- White vinyl privacy fence around the back and sides (panels from the outdoor module when available) ----
function buildFence() {
  const g = new THREE.Group();
  const H = 1.83, mat = M.fenceVinyl();
  const run = (x0, y0, x1, y1) => {
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.round(len / 2.44)), ang = Math.atan2(-(y1 - y0), x1 - x0);
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n, cx = x0 + (x1 - x0) * (t0 + t1) / 2, cy = y0 + (y1 - y0) * (t0 + t1) / 2, pl = len / n;
      const panel = fencePanel(pl, H, mat); panel.position.set(cx, 0, -cy); panel.rotation.y = -ang; g.add(panel);
    }
    addAABB(Math.min(x0, x1) - 0.1, Math.max(x0, x1) + 0.1, -Math.max(y0, y1) - 0.1, -Math.min(y0, y1) + 0.1, 'fence');
  };
  run(LOT.x0 + 0.3, 19.2, LOT.x1 - 0.3, 19.2);        // back
  run(LOT.x0 + 0.3, WEST_FENCE_Y, LOT.x0 + 0.3, 19.2);  // west side
  run(LOT.x0 + 0.3, WEST_FENCE_Y, -8.17, WEST_FENCE_Y); // west return to the garage, behind the parking pad
  const runWood = (x0, y0, x1, y1) => { const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.round(len / 2.44)), ang = Math.atan2(-(y1 - y0), x1 - x0); for (let i = 0; i < n; i++) { const t0 = i / n, t1 = (i + 1) / n, cx = x0 + (x1 - x0) * (t0 + t1) / 2, cy = y0 + (y1 - y0) * (t0 + t1) / 2, pl = len / n; const panel = woodFencePanel(pl, 1.83); panel.position.set(cx, 0, -cy); panel.rotation.y = -ang; g.add(panel); } addAABB(Math.min(x0, x1) - 0.1, Math.max(x0, x1) + 0.1, -Math.max(y0, y1) - 0.1, -Math.min(y0, y1) + 0.1, 'fence'); };
  // Brown board return and its gate are placed with the front-yard furniture.
  runWood(LOT.x1 - 0.3, -1.0, LOT.x1 - 0.3, 19.2);      // east side: neighbour's horizontal wood fence (aerial)
  return g;
}
function woodFencePanel(w, h) {
  const g = new THREE.Group(), mat = M.lumber(), post = new THREE.MeshStandardMaterial({ color: 0x6b5a46, roughness: 0.9 });
  g.add(box(0.1, h, 0.1, post, { x: -w / 2, y: h / 2 }));
  const n = 11, bh = (h - 0.15) / n;
  for (let i = 0; i < n; i++) g.add(box(w - 0.1, bh - 0.012, 0.02, mat, { y: 0.1 + bh * (i + 0.5), z: 0.04 }));
  return g;
}
function fencePanel(w, h, mat) {
  const g = new THREE.Group();
  g.add(box(0.13, h + 0.1, 0.13, mat, { x: -w / 2, y: (h + 0.1) / 2 })); g.add(box(0.16, 0.04, 0.16, mat, { x: -w / 2, y: h + 0.12 }));
  const n = Math.round((w - 0.13) / 0.18), bw = (w - 0.13) / n;
  for (let i = 0; i < n; i++) g.add(box(bw - 0.004, h - 0.08, 0.022, mat, { x: -w / 2 + 0.065 + bw * (i + 0.5), y: (h - 0.08) / 2 + 0.05 }));
  for (const y of [0.12, h / 2, h - 0.1]) g.add(box(w - 0.13, 0.08, 0.05, mat, { y, z: 0.03 }));
  return g;
}

// ---- Neighbours: simple white block houses with low roofs and some trees, so the horizon isn't empty ----
function buildNeighbourhood() {
  const g = new THREE.Group();
  const white = M.stucco(), roof = M.roof();
  const house = (x, y, w, d, ry = 0, col = 0xf2efe8, roofCol = null) => { const h = new THREE.Group(); const wm = new THREE.MeshStandardMaterial({ color: col, roughness: 0.9 }); h.add(box(w, 2.7, d, wm, { y: 1.35 })); const rm = roofCol ? new THREE.MeshStandardMaterial({ color: roofCol, roughness: 0.8 }) : roof; h.add(hipRoof(w + 1.2, d + 1.2, 2.72, 1.3, rm)); for (const [wx, wz] of [[-w / 4, d / 2], [w / 4, d / 2]]) h.add(box(1.2, 1.1, 0.06, M.glass(), { x: wx, y: 1.4, z: wz + 0.01 })); h.position.set(x, 0, -y); h.rotation.y = ry; return h; };
  g.add(house(-24, 2, 14, 11, 0, 0xe6ddd0)); g.add(house(24, 1, 13, 12, 0, 0xf5f2ea, 0x6d6a66)); g.add(house(-22, 30, 14, 11)); g.add(house(4, 31, 15, 11)); g.add(house(26, 30, 13, 12));
  g.add(house(-20, -32, 13, 11, 0, 0xf3e4d6, 0x9b3b2e)); g.add(house(3, -33, 15, 11, 0, 0xe9e2d6, 0x8a6a52)); g.add(house(25, -32, 13, 11));
  return g;
}

function hipRoof(W, D, eave, rise, mat) {
  const x0 = -W / 2, x1 = W / 2, y0 = -D / 2, y1 = D / 2, rx0 = x0 + D / 2, rx1 = x1 - D / 2, ridgeY = eave + rise;
  const v = (x, y, h) => [x, h, -y];
  const quads = [[v(x0, y0, eave), v(x1, y0, eave), v(rx1, 0, ridgeY), v(rx0, 0, ridgeY)], [v(x1, y1, eave), v(x0, y1, eave), v(rx0, 0, ridgeY), v(rx1, 0, ridgeY)], [v(x1, y0, eave), v(x1, y1, eave), v(rx1, 0, ridgeY)], [v(x0, y1, eave), v(x0, y0, eave), v(rx0, 0, ridgeY)]];
  const pos = [], uv = []; for (const q of quads) { const tri = q.length === 4 ? [q[0], q[1], q[2], q[0], q[2], q[3]] : q; for (const p of tri) { pos.push(...p); uv.push(p[0] / 2.5, p[2] / 2.5); } }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; const g = new THREE.Group(); g.add(m); g.add(box(W, 0.02, D, M.soffit(), { y: eave - 0.01 })); return g;
}
