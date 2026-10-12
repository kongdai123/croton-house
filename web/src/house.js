// House shell built from data/house.json (Zillow floor plan, metres, +y north).
// World frame: X = plan x (east), Y up, Z = -plan y (north is -Z). Ceiling 2.44 m.
import { THREE, M, box, cyl, plane, group, shadow, tube } from './kit.js';

export const CEIL = 2.44;
export const P = (x, y) => new THREE.Vector3(x, 0, -y);              // plan -> world (on the floor)
export const planToWorld = (x, y, h = 0) => new THREE.Vector3(x, h, -y);
export const headingToYaw = (deg) => THREE.MathUtils.degToRad(-deg);  // plan heading (0 = north, clockwise) -> yaw about +Y where yaw 0 looks -Z (north)

// Regions outside the Zillow interior plan (hand-drawn plan + photos), plan coordinates.
export const GARAGE = { x0: -8.02, x1: -3.507, y0: -4.72, y1: 0.656 };        // 15' × 19.5' garage, laundry closet inside at x>-4.93, y>-1.53
export const LAUNDRY = { x0: -4.93, x1: -3.507, y0: -1.53, y1: 0.656 };
export const LOT = { x0: -14.5, x1: 14.5, y0: -14.2, y1: 19.5 };               // 95' × 110' lot
export const PATIO = { x0: -2.4, x1: 4.2, y0: 5.47, y1: 10.2 };
export const COURT_A = { x0: -6.2, x1: -2.4, y0: 5.47, y1: 8.6 };
export const COURT_B = { x0: 4.2, x1: 8.3, y0: 5.47, y1: 8.6 };
export const PORCH = { x0: -1.7, x1: 1.75, y0: -6.25, y1: -4.72 };
export const WALK = { x0: -0.65, x1: 0.65, y0: -14.2, y1: -6.25 };
export const DRIVE = { x0: -7.9, x1: -3.9, y0: -14.2, y1: -4.72 };
export const PAD = { x0: -11.2, x1: -8.3, y0: -9.0, y1: -3.6 };

const colliders = [];   // {x0,x1,z0,z1} world AABBs the player cannot cross
export const getColliders = () => colliders;
export function addAABB(x0, x1, z0, z1, tag = '') { colliders.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), tag }); }
const doors = [];       // interactive doors {group, pivot, open, angle, kind}
export const getDoors = () => doors;

function shapeFromPoly(pts) { return new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1]))); }
// Horizontal slab from a plan polygon at height y (faces up when `up`), UV = metres so textures tile correctly.
function slab(pts, y, mat, { up = true, holes = [] } = {}) {
  const s = shapeFromPoly(pts); for (const h of holes) s.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(p[0], p[1]))));
  const g = new THREE.ShapeGeometry(s, 8);
  g.rotateX(up ? -Math.PI / 2 : Math.PI / 2);      // XY plane -> XZ; plan y becomes -z for up (good), +z for down -> flip below
  if (!up) g.scale(1, 1, -1);
  const m = new THREE.Mesh(g, mat); m.position.y = y; m.receiveShadow = true; m.castShadow = false; return m;
}
function rectPts(r) { return [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]]; }

// A wall box from a plan rect (x0..x1, y0..y1) and height range (z0..z1 in metres up).
function wallBox(x0, x1, y0, y1, h0, h1, mat, collide = true) {
  const w = x1 - x0, d = y1 - y0, h = h1 - h0;
  const m = box(w, h, d, mat, { x: (x0 + x1) / 2, y: h0 + h / 2, z: -(y0 + y1) / 2 });
  if (collide && h0 < 1.2) addAABB(x0, x1, -y1, -y0, 'wall');
  return m;
}

export function buildHouse(house, mods, opts = {}) {
  const root = new THREE.Group(); root.name = 'house';
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
  // garage + laundry: concrete floor, dark grey walls, flat ceiling
  const garagePts = [[GARAGE.x0, GARAGE.y0], [GARAGE.x1, GARAGE.y0], [GARAGE.x1, GARAGE.y1], [GARAGE.x0, GARAGE.y1]];
  interior.add(slab(garagePts, -0.004, M.concrete()));
  interior.add(slab(garagePts, CEIL, M.ceiling(), { up: false }));

  // ---- Walls from pieces ----
  const wallMat = M.wallPaint();
  const outside = (p) => isExteriorPiece(p, fp);
  for (const p of house.pieces) {
    const mat = wallMat;
    if (p.wall === 'null-88b2e5c46a') { interior.add(wallBox(p.x0, p.x1, p.y0, p.y1, 0, 1.02, wallMat, true)); interior.add(box(p.x1 - p.x0 + 0.04, 0.03, 0.30, M.quartz(), { x: (p.x0 + p.x1) / 2, y: 1.035, z: -(p.y0 + p.y1) / 2 })); continue; }
    interior.add(wallBox(p.x0, p.x1, p.y0, p.y1, p.z0, p.z1, mat, p.kind === 'solid' || p.kind === 'sill'));
    if (outside(p)) {
      // exterior skin: stucco, 0.15 thick, flush with the openings
      const s = skinRect(p, fp, 0.15);
      if (s) interior.add(wallBox(s.x0, s.x1, s.y0, s.y1, p.z0, p.z1 + (p.z1 >= CEIL - 1e-3 ? 0.12 : 0), M.stucco(), p.kind === 'solid' || p.kind === 'sill'));
    }
  }
  // garage walls (outside the Zillow plan): south (garage door), west, north, plus laundry partition
  const gm = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.9 });   // the garage is painted dark grey (photos)
  const GW = 0.26;
  // south wall with garage door opening 2.75 w
  const gd0 = -6.9, gd1 = -4.15;
  interior.add(wallBox(GARAGE.x0 - GW, gd0, GARAGE.y0 - GW, GARAGE.y0, 0, CEIL + 0.12, M.stucco()));
  interior.add(wallBox(gd1, GARAGE.x1, GARAGE.y0 - GW, GARAGE.y0, 0, CEIL + 0.12, M.stucco()));
  interior.add(wallBox(gd0, gd1, GARAGE.y0 - GW, GARAGE.y0, 2.15, CEIL + 0.12, M.stucco(), false));
  interior.add(wallBox(GARAGE.x0 - GW, GARAGE.x0, GARAGE.y0 - GW, GARAGE.y1 + 0.0, 0, CEIL + 0.12, M.stucco()));
  // north wall of garage up to the house wall (-8.02..-4.93 at y=0.656) is interior to the laundry; exterior skin from -8.02..-4.93 at y=1.48 handled by plan walls (null-a3ab... are plan walls at y 1.48 - those are exterior of the primary bath). Laundry: x -8.02..-4.93, y 0.656..1.48 -> its south wall:
  interior.add(wallBox(GARAGE.x0, LAUNDRY.x0, GARAGE.y1, GARAGE.y1 + 0.114, 0, CEIL, gm));
  // inside faces of garage: dark paint panels on the stucco walls
  const paintInset = 0.002;
  interior.add(wallBox(GARAGE.x0, GARAGE.x0 + 0.01, GARAGE.y0, GARAGE.y1, 0, CEIL, gm, false));
  interior.add(wallBox(GARAGE.x0, gd0, GARAGE.y0, GARAGE.y0 + 0.01, 0, CEIL, gm, false));
  interior.add(wallBox(gd1, GARAGE.x1, GARAGE.y0, GARAGE.y0 + 0.01, 0, CEIL, gm, false));
  interior.add(wallBox(GARAGE.x1 - 0.01, GARAGE.x1, GARAGE.y0, LAUNDRY.y0, 0, CEIL, gm, false));
  // laundry closet partition walls (plan "closet": x -4.93..-3.507, y -1.53..0.656), door to kitchen already in plan wall; make west & south walls
  interior.add(wallBox(LAUNDRY.x0 - 0.114, LAUNDRY.x0, LAUNDRY.y0, LAUNDRY.y1, 0, CEIL, wallMat));
  interior.add(wallBox(LAUNDRY.x0 - 0.114, LAUNDRY.x1, LAUNDRY.y0 - 0.114, LAUNDRY.y0, 0, CEIL, wallMat));
  // garage door (white sectional, closed) and its frame
  const gdoor = group();
  for (let i = 0; i < 4; i++) gdoor.add(box(gd1 - gd0 - 0.1, 0.5, 0.045, M.doorWhite(), { r: 0.006, x: (gd0 + gd1) / 2, y: 0.27 + i * 0.52, z: -(GARAGE.y0 - 0.13) }));
  interior.add(gdoor); addAABB(gd0, gd1, -(GARAGE.y0), -(GARAGE.y0 - 0.2), 'garagedoor');

  // ---- Baseboards (interior faces) ----
  for (const p of house.pieces) if (p.kind === 'solid') {
    const t = 0.012, h = 0.09;
    if (p.dir === 'H') { interior.add(box(p.x1 - p.x0, h, t, M.trim(), { x: (p.x0 + p.x1) / 2, y: h / 2, z: -(p.y1 + t / 2) })); interior.add(box(p.x1 - p.x0, h, t, M.trim(), { x: (p.x0 + p.x1) / 2, y: h / 2, z: -(p.y0 - t / 2) })); }
    else { interior.add(box(t, h, p.y1 - p.y0, M.trim(), { x: p.x1 + t / 2, y: h / 2, z: -(p.y0 + p.y1) / 2 })); interior.add(box(t, h, p.y1 - p.y0, M.trim(), { x: p.x0 - t / 2, y: h / 2, z: -(p.y0 + p.y1) / 2 })); }
  }

  // ---- Header beam at the living -> dining/office opening (dropped soffit, as in the photos) ----
  interior.add(box(3.35 - 0.42, CEIL - 2.13, 0.32, wallMat, { x: (0.42 + 3.35) / 2, y: (CEIL + 2.13) / 2, z: -1.765 }));
  interior.add(box(0.12, CEIL, 0.3, wallMat, { x: 0.42 + 0.0, y: CEIL / 2, z: -1.765 }));   // the column at the wall's end

  // ---- Openings ----
  for (const o of house.openings) {
    if (o.kind === 'door') interior.add(buildDoor(o, house)); else interior.add(buildWindow(o, house, mods));
  }
  // primary bath window (not on the Zillow plan but visible in g34): small awning window on the north wall
  interior.add(buildWindow({ id: 'pbath', kind: 'window', dir: 'H', x0: -7.5, x1: -6.9, y0: 5.357, y1: 5.471, width: 0.6, sillOverride: 1.5, headOverride: 2.06 }, house, mods));

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

// ---- Doors ----
const DOOR_TYPES = {
  ca2bb42b5a: 'front', '161782cdfa': 'french4', bf8cb9f37a: 'french2', e5f2f69eea: 'slider', '9f018d7dea': 'slider',
  '0f9916c91a': 'louver', d8425baf7a: 'louverWhite', '3809b9067a': 'opening', '2e2d4a125a': 'door', '40c340903a': 'door',
};
function buildDoor(o, house) {
  const g = new THREE.Group(); g.name = 'door-' + o.id;
  const type = DOOR_TYPES[o.id] || 'door';
  const H = house.doorHeight, w = o.width, isH = o.dir === 'H';
  const cx = (o.x0 + o.x1) / 2, cy = (o.y0 + o.y1) / 2, thick = isH ? o.y1 - o.y0 : o.x1 - o.x0;
  g.position.set(cx, 0, -cy); g.rotation.y = isH ? 0 : Math.PI / 2;   // local x runs along the opening, local z through the wall
  const jamb = 0.016, trimW = 0.07;
  if (type !== 'opening') {
    // jambs + casing both sides
    g.add(box(jamb, H, thick + 0.02, M.trim(), { x: -w / 2 + jamb / 2, y: H / 2 })); g.add(box(jamb, H, thick + 0.02, M.trim(), { x: w / 2 - jamb / 2, y: H / 2 })); g.add(box(w, jamb, thick + 0.02, M.trim(), { y: H - jamb / 2 }));
    for (const s of [-1, 1]) { g.add(box(w + trimW * 2, trimW, 0.014, M.trim(), { y: H + trimW / 2, z: s * (thick / 2 + 0.007) })); g.add(box(trimW, H + trimW, 0.014, M.trim(), { x: -w / 2 - trimW / 2, y: (H + trimW) / 2, z: s * (thick / 2 + 0.007) })); g.add(box(trimW, H + trimW, 0.014, M.trim(), { x: w / 2 + trimW / 2, y: (H + trimW) / 2, z: s * (thick / 2 + 0.007) })); }
  } else {
    for (const s of [-1, 1]) g.add(box(w + trimW * 2, trimW, 0.014, M.trim(), { y: H + trimW / 2, z: s * (thick / 2 + 0.007) }));
  }
  const leafW = w - jamb * 2, leafT = 0.04;
  if (type === 'door' || type === 'front') {
    const pivot = new THREE.Group(); pivot.position.set(-leafW / 2, 0, 0); g.add(pivot);
    const leaf = box(leafW, H - 0.02, leafT, M.doorWhite(), { r: 0.003, x: leafW / 2, y: (H - 0.02) / 2 + 0.01 });
    pivot.add(leaf);
    // flat panel door with a shallow recessed rectangle, black lever handle
    pivot.add(box(leafW - 0.16, H - 0.4, 0.004, M.doorWhite(), { x: leafW / 2, y: H / 2, z: leafT / 2 + 0.002 }));
    for (const s of [-1, 1]) { pivot.add(cyl(0.028, 0.028, 0.012, M.doorBlackHardware(), { x: leafW - 0.08, y: 1.0, z: s * (leafT / 2 + 0.006), rx: Math.PI / 2 })); pivot.add(box(0.12, 0.016, 0.016, M.doorBlackHardware(), { x: leafW - 0.08 - 0.05, y: 1.0, z: s * (leafT / 2 + 0.03), r: 0.005 })); }
    const open = type === 'front' ? 0 : (o.id === '2e2d4a125a' ? 0 : 1.35);
    pivot.rotation.y = open;
    doors.push({ id: o.id, group: g, pivot, angle: pivot.rotation.y, target: pivot.rotation.y, kind: type, w: leafW, plan: { cx, cy, isH } });
    g.userData.door = doors[doors.length - 1];
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
    doors.push({ id: o.id, group: g, slide: sl, kind: 'slider', open: 0.6, w: pw, plan: { cx, cy, isH } });
    const half = isH ? [w / 2, thick / 2] : [thick / 2, w / 2];
    // collider only on the fixed half
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
  return g;
}
// French doors: t in 0..1 swings every leaf outward (toward +local z = plan north side for H walls on the north).
export function setFrench(d, t) {
  d.open = t;
  for (const l of d.leaves) { const a = t * (l.hingeLeft ? -1 : 1) * 1.65; l.pivot.rotation.y = a; }
  // collider: closed = full width block; open = free
  const i = getColliders().findIndex(c => c.tag === 'french-' + d.id);
  if (i >= 0) getColliders().splice(i, 1);
  if (t < 0.5) { const { cx, cy, isH } = d.plan; if (isH) addAABB(cx - d.w / 2, cx + d.w / 2, -(cy + d.thick / 2), -(cy - d.thick / 2), 'french-' + d.id); else addAABB(cx - d.thick / 2, cx + d.thick / 2, -(cy + d.w / 2), -(cy - d.w / 2), 'french-' + d.id); }
}
export function setHinged(d, open) {
  d.target = open ? (d.kind === 'front' ? -1.5 : 1.35) : 0;
  const i = getColliders().findIndex(c => c.tag === 'hinged-' + d.id); if (i >= 0) getColliders().splice(i, 1);
  if (!open) { const { cx, cy, isH } = d.plan; if (isH) addAABB(cx - d.w / 2, cx + d.w / 2, -(cy + 0.06), -(cy - 0.06), 'hinged-' + d.id); else addAABB(cx - 0.06, cx + 0.06, -(cy + d.w / 2), -(cy - d.w / 2), 'hinged-' + d.id); }
}

// ---- Windows ----
function buildWindow(o, house, mods) {
  const g = new THREE.Group(); g.name = 'window-' + o.id;
  const isH = o.dir === 'H', w = o.width, sill = o.sillOverride ?? house.windowSill, head = o.headOverride ?? house.windowHead, h = head - sill;
  const cx = (o.x0 + o.x1) / 2, cy = (o.y0 + o.y1) / 2, thick = isH ? o.y1 - o.y0 : o.x1 - o.x0;
  g.position.set(cx, 0, -cy); g.rotation.y = isH ? 0 : Math.PI / 2;
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
  g.add(box(w + 0.12, 0.03, 0.09, fr, { y: sill - 0.015, z: thick / 2 + 0.03 }));
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
  // porch roof extension across the front door (deeper overhang carried on the two iron columns)
  const px0 = PORCH.x0 - 0.3, px1 = PORCH.x1 + 0.3, pd = 1.45;
  g.add(box(px1 - px0, 0.22, pd, M.roof(), { x: (px0 + px1) / 2, y: eave + 0.11 - 0.02, z: -(y0 - pd / 2 + 0.02) }));
  g.add(box(px1 - px0, 0.02, pd, M.soffit(), { x: (px0 + px1) / 2, y: eave - 0.01, z: -(y0 - pd / 2 + 0.02) }));
  g.add(box(px1 - px0, fasciaH, 0.03, fas, { x: (px0 + px1) / 2, y: eave - fasciaH / 2 + 0.1, z: -(y0 - pd + 0.02) }));
  g.userData.eave = { x0, x1, y0, y1, eave };
  return g;
}

function buildPorch(mods) {
  const g = new THREE.Group();
  // porch slab
  g.add(box(PORCH.x1 - PORCH.x0, 0.12, PORCH.y1 - PORCH.y0, M.concrete(), { x: (PORCH.x0 + PORCH.x1) / 2, y: -0.06 + 0.02, z: -(PORCH.y0 + PORCH.y1) / 2 }));
  // front step
  g.add(box(PORCH.x1 - PORCH.x0 - 0.4, 0.14, 0.4, M.concrete(), { x: (PORCH.x0 + PORCH.x1) / 2, y: -0.14 / 2 - 0.02, z: -(PORCH.y0 - 0.2) }));
  return g;
}

// ---- Ground surfaces (lot), composed from the aerial photo (g50): dark mulch beds, a white shell-gravel lounge with
//      lumber edging behind the terrace, concrete terrace/walk/drive, white pebble courtyards with low rendered walls.
export const LOUNGE = [[-2.6, 9.3], [5.2, 9.3], [5.6, 11.0], [5.3, 14.6], [2.0, 15.2], [-1.8, 14.4], [-2.9, 12.0]];
export const FRONT_BED = [[-3.6, -4.9], [8.3, -4.9], [8.3, -9.4], [3.2, -11.2], [-1.0, -11.4], [-3.6, -9.0]];
function buildGround() {
  const g = new THREE.Group();
  // base: mulch inside the fence; lawn verge toward the street; neighbours' lawns beyond
  g.add(slab([[-80, -80], [80, -80], [80, 80], [-80, 80]], -0.09, M.grass()));
  g.add(slab(rectPts(LOT), -0.03, M.mulch()));
  g.add(slab([[LOT.x0, -14.2], [LOT.x1, -14.2], [LOT.x1, -11.8], [LOT.x0, -11.8]], -0.02, M.grass()));      // street verge lawn
  g.add(slab([[8.6, -11.8], [LOT.x1, -11.8], [LOT.x1, -2.0], [8.6, -2.0]], -0.022, M.grass()));            // east side lawn (aerial)
  // shell gravel: front beds and the back lounge (slightly proud of the mulch, with lumber edging)
  g.add(slab(FRONT_BED, -0.008, M.shell()));
  g.add(slab(LOUNGE, -0.006, M.shell()));
  edging(g, LOUNGE); 
  // concrete: terrace, walk, drive, parking pad, courtyard B pad
  for (const r of [PATIO, WALK, DRIVE, PAD, { x0: 4.3, x1: 6.4, y0: 5.47, y1: 7.3 }]) g.add(slab(rectPts(r), 0.012, M.concrete()));
  // courtyards: white pebbles with low rendered walls
  for (const r of [COURT_A, COURT_B]) g.add(slab(rectPts(r), 0.0, M.pebbles()));
  const lowWall = (x0, x1, y0, y1) => { g.add(box(x1 - x0, 0.42, y1 - y0, M.stucco(), { x: (x0 + x1) / 2, y: 0.21, z: -(y0 + y1) / 2 })); g.add(box(x1 - x0 + 0.04, 0.03, y1 - y0 + 0.04, M.trim(), { x: (x0 + x1) / 2, y: 0.435, z: -(y0 + y1) / 2 })); addAABB(x0, x1, -y1, -y0, 'lowwall'); };
  lowWall(COURT_A.x0, COURT_A.x1 - 1.2, COURT_A.y1 - 0.16, COURT_A.y1); lowWall(COURT_A.x0, COURT_A.x0 + 0.16, 5.6, COURT_A.y1);
  lowWall(COURT_B.x0 + 1.2, COURT_B.x1, COURT_B.y1 - 0.16, COURT_B.y1); lowWall(COURT_B.x1 - 0.16, COURT_B.x1, 5.6, COURT_B.y1);
  // street + sidewalk
  g.add(slab([[-60, -22], [60, -22], [60, -14.2], [-60, -14.2]], -0.025, M.asphalt()));
  g.add(slab([[-60, -14.2], [60, -14.2], [60, -13.0], [-60, -13.0]], -0.012, M.concrete()));
  // curb line
  g.add(box(120, 0.12, 0.2, M.concrete(), { x: 0, y: -0.06, z: 14.2 }));
  // house slab edge: a stem wall around the footprint + garage
  const stem = new THREE.MeshStandardMaterial({ color: 0xe6e3dc, roughness: 0.9 });
  g.add(box(16.65, 0.2, 11.9, stem, { x: 0.0, y: -0.115, z: 0.19 }));   // top at -0.015: never coplanar with the floor slab
  // AC condensers on the west side yard
  const ac = new THREE.MeshStandardMaterial({ color: 0x8e9398, roughness: 0.6, metalness: 0.3 });
  for (const y of [-0.6, 0.6]) { g.add(box(0.8, 0.85, 0.8, ac, { r: 0.02, x: -8.75, y: 0.45, z: -y })); g.add(cyl(0.3, 0.3, 0.02, M.blackMatte(), { x: -8.75, y: 0.88, z: -y })); addAABB(-9.2, -8.3, y - 0.45, y + 0.45, 'ac'); }
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
  run(LOT.x0 + 0.3, -1.0, LOT.x0 + 0.3, 19.2);          // west side
  run(LOT.x0 + 0.3, -1.0, -8.3, -1.0);                  // west return to the garage
  const runWood = (x0, y0, x1, y1) => { const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.round(len / 2.44)), ang = Math.atan2(-(y1 - y0), x1 - x0); for (let i = 0; i < n; i++) { const t0 = i / n, t1 = (i + 1) / n, cx = x0 + (x1 - x0) * (t0 + t1) / 2, cy = y0 + (y1 - y0) * (t0 + t1) / 2, pl = len / n; const panel = woodFencePanel(pl, 1.83); panel.position.set(cx, 0, -cy); panel.rotation.y = -ang; g.add(panel); } addAABB(Math.min(x0, x1) - 0.1, Math.max(x0, x1) + 0.1, -Math.max(y0, y1) - 0.1, -Math.min(y0, y1) + 0.1, 'fence'); };
  run(8.3, -1.0, LOT.x1 - 0.3, -1.0);                   // east return to the house
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
