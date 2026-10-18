// Gate (c) camera set: 1-3 cameras per interior plan space and one or two per outdoor zone, placed from the plan model and
// the real house built headless (web/tools/harness/scene.mjs), plus the spots that broke before (docs/audit/postmortem.md).
// Writes bake/validate/cameras.json (committed; regenerate after a layout or plan change and approve a new baseline).
//
//   node bake/validate/make_cameras.mjs [--map out.ppm]      (needs web/node_modules; ~30 s on a laptop CPU, no GPU)
//
// Placement: every visible opaque mesh (glass and sheers left out: the camera sees through them) is rasterised into two
// 5 cm plan grids, a body band (0.3..2.0 m: the camera must stand clear of it) and a sight band (1.1..1.9 m: what a view
// ray at eye height runs into). A camera stands in its own space, clear of the body band and the space's edges, at eye
// height, and looks the way that sees the most of its space: the mean depth of 13 rays over the lens's horizontal field,
// each ray stopping at the first obstacle or where it leaves the space (a doorway does not count as depth). Further
// cameras of the same space must stand apart or look another way. Closets and spaces too small to stand in are seen
// from their doorway, door opened for the shot. Outdoor cameras look at the house.
// Cameras also keep out of the walk's colliders (the player is pushed out of them, which would move the camera).
// Coordinates: plan frame (x east, y north, z up, metres); heading h in degrees, 0 north, clockwise; pitch p in radians,
// + up; lens in mm on a 36 mm-wide sensor (the convention of bake/export/render.py and validate/shoot.mjs).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildRealScene } from '../../web/tools/harness/scene.mjs';

const OUT = fileURLToPath(new URL('./cameras.json', import.meta.url));
const args = process.argv.slice(2), mapPath = args.includes('--map') ? args[args.indexOf('--map') + 1] : null;
const EYE = 1.45, LENS = 22, CELL = 0.05, X0 = -14.5, Y0 = -14.2, NX = 580, NY = 674;   // the lot, 5 cm cells
const BODY = [0.3, 2.0], SIGHT = [1.1, 1.9];
const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;

const w = await buildRealScene();
const { T, plan } = w;
const body = new Uint8Array(NX * NY), sight = new Uint8Array(NX * NY);
const ci = (x, y) => { const i = Math.floor((x - X0) / CELL), j = Math.floor((y - Y0) / CELL); return i < 0 || j < 0 || i >= NX || j >= NY ? -1 : j * NX + i; };

// ---- rasterise the house ------------------------------------------------------------------------------------------------
const seeThrough = m => ['glass', 'sheer'].includes(w.roles.lightingOf(m)?.surface) || (m.transparent && m.opacity < 0.5) || m.visible === false;
const visible = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), p = new T.Vector3(), M = new T.Matrix4(), IM = new T.Matrix4();
function mark(x, y, z) {
  const k = ci(x, y); if (k < 0) return;
  if (z >= BODY[0] && z <= BODY[1]) body[k] = 1;
  if (z >= SIGHT[0] && z <= SIGHT[1]) sight[k] = 1;
}
function triangle(A, B, C) {   // A, B, C world (three) coordinates; samples every <= 4 cm
  const zmin = Math.min(A.y, B.y, C.y), zmax = Math.max(A.y, B.y, C.y);
  if (zmax < BODY[0] || zmin > BODY[1]) return;
  const n = Math.max(1, Math.ceil(Math.max(A.distanceTo(B), B.distanceTo(C), C.distanceTo(A)) / 0.04));
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
    const u = i / n, v = j / n, t = 1 - u - v;
    mark(A.x * t + B.x * u + C.x * v, -(A.z * t + B.z * u + C.z * v), A.y * t + B.y * u + C.y * v);
  }
}
let tris = 0;
w.scene.traverse(o => {
  if (!o.isMesh || !visible(o) || !o.geometry?.attributes?.position) return;
  const mats = [].concat(o.material ?? []);
  if (mats.length && mats.every(seeThrough)) return;
  const pos = o.geometry.attributes.position, idx = o.geometry.index, count = idx ? idx.count : pos.count;
  const instances = o.isInstancedMesh ? o.count : 1;
  if (instances * count > 3e6) return;   // grass and ground cover: below the body band anyway
  for (let k = 0; k < instances; k++) {
    if (o.isInstancedMesh) { o.getMatrixAt(k, IM); M.multiplyMatrices(o.matrixWorld, IM); } else M.copy(o.matrixWorld);
    for (let t = 0; t + 2 < count; t += 3) {
      const ia = idx ? idx.getX(t) : t, ib = idx ? idx.getX(t + 1) : t + 1, ic = idx ? idx.getX(t + 2) : t + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(M); b.fromBufferAttribute(pos, ib).applyMatrix4(M); c.fromBufferAttribute(pos, ic).applyMatrix4(M);
      triangle(a, b, c); tris++;
    }
  }
});

// clearance: distance (m) from each cell to the nearest body-band cell (two-pass chamfer, 1 / sqrt 2)
const clear = new Float32Array(NX * NY).fill(1e9);
for (let k = 0; k < NX * NY; k++) if (body[k]) clear[k] = 0;
const D = CELL, DD = CELL * Math.SQRT2;
for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
  const k = j * NX + i; let v = clear[k];
  if (i > 0) v = Math.min(v, clear[k - 1] + D); if (j > 0) v = Math.min(v, clear[k - NX] + D);
  if (i > 0 && j > 0) v = Math.min(v, clear[k - NX - 1] + DD); if (i < NX - 1 && j > 0) v = Math.min(v, clear[k - NX + 1] + DD);
  clear[k] = v;
}
for (let j = NY - 1; j >= 0; j--) for (let i = NX - 1; i >= 0; i--) {
  const k = j * NX + i; let v = clear[k];
  if (i < NX - 1) v = Math.min(v, clear[k + 1] + D); if (j < NY - 1) v = Math.min(v, clear[k + NX] + D);
  if (i < NX - 1 && j < NY - 1) v = Math.min(v, clear[k + NX + 1] + DD); if (i > 0 && j < NY - 1) v = Math.min(v, clear[k + NX - 1] + DD);
  clear[k] = v;
}
// the walk's colliders (house.js getColliders: walls, fixed furniture; layout.movableColliders): the player capsule
// (radius 0.17 m) is pushed out of them, so a camera there would not stand where it was placed
const blocked = new Uint8Array(NX * NY), R = 0.17 + 0.08;
for (const c of [...w.getColliders(), ...(w.layout.movableColliders?.() ?? [])]) {
  const box = c.circle ? { x0: c.x - c.r, x1: c.x + c.r, y0: -c.z - c.r, y1: -c.z + c.r } : { x0: c.x0, x1: c.x1, y0: -c.z1, y1: -c.z0 };
  for (let y = box.y0 - R; y <= box.y1 + R; y += CELL) for (let x = box.x0 - R; x <= box.x1 + R; x += CELL) {
    const k = ci(x, y); if (k < 0) continue;
    const dx = Math.max(box.x0 - x, 0, x - box.x1), dy = Math.max(box.y0 - y, 0, y - box.y1);
    if (Math.hypot(dx, dy) < R) blocked[k] = 1;
  }
}
const clearAt = (x, y) => { const k = ci(x, y); return k < 0 || blocked[k] ? 0 : clear[k]; };

// ---- views --------------------------------------------------------------------------------------------------------------
const hfov = lens => 2 * Math.atan(18 / lens);
const dirOf = h => [Math.sin(h * Math.PI / 180), Math.cos(h * Math.PI / 180)];
// the space of every cell (plan.spaceAt at the cell centre), so a ray march is table lookups
const SPACE_IDS = [null, ...plan.spaces.map(s => s.id)], ownerGrid = new Uint8Array(NX * NY);
for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const id = plan.spaceAt(X0 + (i + 0.5) * CELL, Y0 + (j + 0.5) * CELL)?.id ?? null; ownerGrid[j * NX + i] = SPACE_IDS.indexOf(id); }
const owner = (x, y) => { const k = ci(x, y); return k < 0 ? null : SPACE_IDS[ownerGrid[k]]; };
function march(x, y, h, { max = 8, within = null, until = null } = {}) {   // distance to the first sight-band cell (or leaving `within`)
  const [dx, dy] = dirOf(h);
  for (let d = 0.1; d < max; d += CELL) {
    const px = x + dx * d, py = y + dy * d, k = ci(px, py);
    if (k < 0 || sight[k]) return d;
    if (within) { const o = SPACE_IDS[ownerGrid[k]]; if (o !== within && o !== null) return d; }   // into another space (doorway seams are null)
    if (until && until(px, py, d)) return d;
  }
  return max;
}
function viewScore(x, y, h, lens, opts) {
  const f = hfov(lens) * 180 / Math.PI, n = 13; let s = 0;
  for (let i = 0; i < n; i++) s += march(x, y, h - f / 2 + f * i / (n - 1), opts);
  return s / n;
}
const area = P => { let s = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) s += (P[j][0] - P[i][0]) * (P[j][1] + P[i][1]); return Math.abs(s / 2); };
function edgeDist(x, y, P) {
  let best = Infinity;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [ax, ay] = P[j], [bx, by] = P[i], vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy;
    const t = L ? Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L)) : 0, ex = ax + vx * t - x, ey = ay + vy * t - y;
    best = Math.min(best, Math.hypot(ex, ey));
  }
  return best;
}
const LOT = plan.plan.lot;
function candidates(s, { inset, minClear, step = 0.15, region = null }) {
  const out = [], P = s.polygon;
  let x0 = Math.min(...P.map(q => q[0])), x1 = Math.max(...P.map(q => q[0])), y0 = Math.min(...P.map(q => q[1])), y1 = Math.max(...P.map(q => q[1]));
  if (region) { x0 = Math.max(x0, region.x0); x1 = Math.min(x1, region.x1); y0 = Math.max(y0, region.y0); y1 = Math.min(y1, region.y1); }
  for (let y = y0 + inset; y <= y1 - inset; y += step) for (let x = x0 + inset; x <= x1 - inset; x += step) {
    if (owner(x, y) !== s.id || edgeDist(x, y, P) < inset) continue;
    const cl = clearAt(x, y); if (cl < minClear) continue;
    out.push({ x, y, cl });
  }
  return out;
}
const HEADINGS = Array.from({ length: 24 }, (_, i) => i * 15);
const angDiff = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);

function placeInterior(s, n) {
  const cands = candidates(s, { inset: 0.3, minClear: 0.3 });
  const scored = [];
  for (const c of cands) for (const h of HEADINGS) scored.push({ ...c, h, s: viewScore(c.x, c.y, h, LENS, { within: s.id }) + 0.3 * Math.min(c.cl, 1) });
  scored.sort((a, b) => b.s - a.s);
  const chosen = [], sep = Math.max(1.2, 0.35 * Math.sqrt(area(s.polygon)));
  for (const v of scored) {
    if (chosen.length >= n) break;
    if (chosen.some(c => Math.hypot(c.x - v.x, c.y - v.y) < sep && angDiff(c.h, v.h) < 70)) continue;
    if (chosen.some(c => Math.hypot(c.x - v.x, c.y - v.y) < 0.6)) continue;
    if (chosen.length && v.s < 0.45 * chosen[0].s) break;
    chosen.push(v);
  }
  return chosen.map(v => ({ x: v.x, y: v.y, h: v.h, p: -0.06, score: v.s }));
}

// seen from a doorway: the camera stands in the neighbouring space on the opening's axis, looking in, the door opened
const DOOR_IDS = new Set(w.doors.map(d => d.id));
function placeFromDoorway(s, n = 1) {
  const out = [];
  for (const o of plan.openings) {
    if (o.type === 'window' || !o.connects?.includes(s.id)) continue;
    const other = o.connects.find(id => id !== s.id); if (!other) continue;
    const cx = (o.x0 + o.x1) / 2, cy = (o.y0 + o.y1) / 2;
    // the side of the opening the closet lies on
    const axis = o.dir === 'V' ? [1, 0] : [0, 1];
    const into = owner(cx + axis[0] * 0.3, cy + axis[1] * 0.3) === s.id ? 1 : owner(cx - axis[0] * 0.3, cy - axis[1] * 0.3) === s.id ? -1 : 0;
    if (!into) continue;
    let best = null;
    for (const d of [1.6, 1.4, 1.2, 1.0, 0.8]) for (const off of [0, 0.25, -0.25, 0.5, -0.5]) {
      const x = cx - axis[0] * into * d + (o.dir === 'V' ? 0 : off), y = cy - axis[1] * into * d + (o.dir === 'V' ? off : 0);
      if (owner(x, y) !== other || clearAt(x, y) < 0.2) continue;
      const h = Math.atan2(cx - x, cy - y) * 180 / Math.PI, sc = clearAt(x, y) + d * 0.5 - Math.abs(off);
      if (!best || sc > best.sc) best = { x, y, h: (h + 360) % 360, sc };
    }
    if (best) out.push({ x: best.x, y: best.y, h: best.h, p: -0.22, doors: DOOR_IDS.has(o.id) ? { [o.id]: 'open' } : undefined, from: other, score: best.sc });
    if (out.length >= n) break;
  }
  return out;
}

// outdoor: stand in the zone (within the lot, clear of plants and furniture) and look at the house
const outline = plan.plan.outline.polygon;
const houseHit = (px, py) => edgeDist(px, py, outline) < 0.6 || plan.isInside(px, py, 0);
function placeOutdoor(s, n) {
  const region = { x0: LOT.x0 + 1, x1: LOT.x1 - 1, y0: LOT.y0 + 1, y1: LOT.y1 - 1 };
  let cands = candidates(s, { inset: 0.4, minClear: 0.45, step: s.kind === 'yard' ? 0.5 : 0.2, region })
    .filter(c => { const d = edgeDist(c.x, c.y, outline); return d > 1.2 && d < 14; });
  // a zone against the house (the porch): stand closer, look along the facade
  if (!cands.length) cands = candidates(s, { inset: 0.25, minClear: 0.3, step: 0.1, region }).filter(c => edgeDist(c.x, c.y, outline) > 0.3);
  const scored = [];
  for (const c of cands) for (const h of HEADINGS) {
    const f = hfov(LENS) * 180 / Math.PI; let house = 0, depth = 0;
    for (let i = 0; i < 9; i++) {
      let hit = false; const d = march(c.x, c.y, h - f / 2 + f * i / 8, { max: 16, until: (px, py) => (hit = houseHit(px, py)) });
      if (hit && d > 2) house++; depth += Math.min(d, 16);
    }
    scored.push({ ...c, h, s: house / 9 + depth / 9 / 40 + 0.1 * Math.min(c.cl, 1.5) });
  }
  scored.sort((a, b) => b.s - a.s);
  const chosen = [];
  for (const v of scored) {
    if (chosen.length >= n) break;
    if (chosen.some(c => Math.hypot(c.x - v.x, c.y - v.y) < 3 && angDiff(c.h, v.h) < 60)) continue;
    chosen.push(v);
  }
  return chosen.map(v => ({ x: v.x, y: v.y, h: v.h, p: 0.02, score: v.s }));
}

// aim at a point (x, y, z) from inside `spaceId`, about `dist` away, with a clear line
function placeAt(target, spaceId, { dist = 2.2, lens = LENS, minClear = 0.2, headings = null } = {}) {
  let best = null;
  for (const d of [dist, dist * 0.85, dist * 1.15, dist * 0.7, dist * 1.3, dist * 0.55]) for (let a = 0; a < 360; a += 10) {
    if (headings && !headings.some(h => angDiff(h, (a + 180) % 360) < 50)) continue;
    const [ux, uy] = dirOf(a), x = target.x + ux * d, y = target.y + uy * d;
    if (owner(x, y) !== spaceId || clearAt(x, y) < minClear) continue;
    const h = (a + 180) % 360, los = march(x, y, h, { max: d });
    const sc = (los >= d - 0.45 ? 1 : 0) * 2 + Math.min(clearAt(x, y), 0.8) - Math.abs(d - dist) * 0.5;
    if (!best || sc > best.sc) best = { x, y, h, d, sc };
  }
  if (!best) throw new Error(`no camera position for ${JSON.stringify(target)} in ${spaceId}`);
  return { x: best.x, y: best.y, h: best.h, p: Math.atan2(target.z - EYE, best.d), lens };
}

// ---- the set ------------------------------------------------------------------------------------------------------------
const cameras = [], perSpace = {};
const add = (id, space, kind, v, note) => {
  cameras.push({ id, space, kind, x: r2(v.x), y: r2(v.y), z: EYE, h: Math.round(v.h), p: r3(v.p ?? 0), lens: v.lens ?? LENS,
    ...(v.doors ? { doors: v.doors } : {}), ...(v.from ? { from: v.from } : {}), ...(note ? { note } : {}) });
  perSpace[space] = (perSpace[space] ?? 0) + 1;
};
const OUTDOOR = { porch: 1, patio: 2, westCourt: 1, eastCourt: 1, frontWalk: 1, drive: 1, parkingPad: 1, frontYard: 2, backGarden: 2, westSide: 1, eastSide: 1 };
for (const s of plan.spaces) {
  if (s.zone === 'interior' || s.zone === 'annex') {
    const A = area(s.polygon), n = A < 3.5 ? 1 : A < 14 ? 2 : 3;
    let views = s.kind === 'closet' ? [] : placeInterior(s, n);
    if (!views.length) views = placeFromDoorway(s, 1);
    if (!views.length) throw new Error('no camera for ' + s.id);
    views.forEach((v, i) => add(`${s.id}_${i + 1}`, s.id, v.from ? 'doorway' : 'room', v));
  } else if (OUTDOOR[s.id]) {
    placeOutdoor(s, OUTDOOR[s.id]).forEach((v, i) => add(`${s.id}_${i + 1}`, s.id, 'outdoor', v));
  }
}

// the spots that broke (docs/audit/postmortem.md), aimed at the objects themselves
const box = new T.Box3(), centre = o => { box.setFromObject(o); const v = box.getCenter(new T.Vector3()); return { x: v.x, y: -v.z, z: v.y, top: box.max.y }; };
const placed = key => { const o = w.layout.placed.find(o => `${o.userData.placement.m}.${o.userData.placement.i}` === key); if (!o) throw new Error('no placement ' + key); return centre(o); };
const door = id => { const o = plan.opening(id); return { x: (o.x0 + o.x1) / 2, y: (o.y0 + o.y1) / 2, z: 1.03 }; };
const fd = door('ca2bb42b5a');
const fdSpace = plan.spaceAt(fd.x, fd.y + 1.5).id;
add('bad_frontDoor_open', fdSpace, 'known-bad', placeAt(fd, fdSpace, { dist: 2.6, headings: [180] }), 'postmortem 5: open front door at noon streaked black, red and yellow');
add('bad_frontDoor_closed', fdSpace, 'known-bad', { ...placeAt(fd, fdSpace, { dist: 2.6, headings: [180] }), doors: { ca2bb42b5a: 'closed' } }, 'postmortem 19: closed front door inside face dark, reddish bands at noon');
const mB = placed('bath.mirrorCabinet');
add('bad_bathB_mirror', 'bathB', 'known-bad', placeAt({ ...mB, z: 1.5 }, 'bathB', { dist: 1.3 }), 'postmortem 2, 3: bath B mirror white / black after a slot switch');
add('bad_bathB_door', 'bathB', 'known-bad', placeAt(door('57fafde9ea'), 'bathB', { dist: 1.3 }), 'postmortem 2: bath B door leaf lit through the wall (door shut, as the site starts)');
const mP = placed('bath.mirrorCabinetWide');
add('bad_primaryBath_mirror', 'primaryBath', 'known-bad', placeAt({ ...mP, z: 1.5 }, 'primaryBath', { dist: 1.6 }), 'postmortem 2, 3, 9: primary bath mirror');
const sh = placed('bedrooms.shelfWalnut');
add('bad_walnutShelf', 'primaryBedroom', 'known-bad', placeAt({ ...sh, z: sh.z }, 'primaryBedroom', { dist: 2.0, lens: 28 }), 'postmortem 6: walnut shelf orange, dark wood near black');
const so = placed('living.sofa');
add('bad_sofa', 'living', 'known-bad', placeAt({ ...so, z: 0.5 }, 'living', { dist: 2.6, lens: 28 }), 'sofa (vertex-coloured furniture, postmortem 6)');
const ws = placed('living.windowSeat');
add('bad_windowSeat', 'living', 'known-bad', placeAt({ ...ws, z: 0.65 }, 'living', { dist: 2.2, lens: 28 }), 'window-seat pillows');
const ct = placed('kitchen.counterDecor');
add('bad_kitchenCounter', 'kitchen', 'known-bad', placeAt({ ...ct, z: 0.95 }, 'kitchen', { dist: 2.0, lens: 28 }), 'kitchen counter');
const gd = door('2e2d4a125a');
add('bad_garage_kitchenDoor', 'garage', 'known-bad', placeAt(gd, 'garage', { dist: 3.0 }), 'garage (once only constants): the wall of the kitchen door, shut as the site starts');

const doc = {
  version: 1,
  note: 'Gate (c) render-regression cameras, generated by bake/validate/make_cameras.mjs from web/data/plan.json and the house built headless. Plan frame: x east, y north, z eye height (m); h heading in degrees (0 north, clockwise); p pitch in radians (+ up); lens mm on a 36 mm-wide sensor (16:9). doors: per-shot door states, restored after the shot.',
  eye: EYE, lens: LENS, count: cameras.length, perSpace, cameras,
};
const { cameras: list, ...head } = doc;   // one camera per line
writeFileSync(OUT, JSON.stringify(head, null, 1).replace(/\n}$/, ',\n "cameras": [\n') + list.map(c => '  ' + JSON.stringify(c)).join(',\n') + '\n ]\n}\n');
console.log(`${cameras.length} cameras (${tris} triangles rasterised) -> ${OUT}`);
for (const [k, v] of Object.entries(perSpace)) console.log(`  ${k.padEnd(18)} ${v}`);

if (mapPath) {   // top view: body band grey, sight band black, cameras red with a view line
  const img = Buffer.alloc(NX * NY * 3, 255);
  const put = (i, j, r, g, b) => { if (i < 0 || j < 0 || i >= NX || j >= NY) return; const k = ((NY - 1 - j) * NX + i) * 3; img[k] = r; img[k + 1] = g; img[k + 2] = b; };
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const k = j * NX + i; if (sight[k]) put(i, j, 0, 0, 0); else if (body[k]) put(i, j, 150, 150, 150); else if (!plan.spaceAt(X0 + (i + 0.5) * CELL, Y0 + (j + 0.5) * CELL)) put(i, j, 200, 220, 255); }
  for (const c of cameras) {
    const [dx, dy] = dirOf(c.h);
    for (let d = 0; d < 1.2; d += 0.02) put(Math.floor((c.x + dx * d - X0) / CELL), Math.floor((c.y + dy * d - Y0) / CELL), 0, 160, 0);
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) put(Math.floor((c.x - X0) / CELL) + a, Math.floor((c.y - Y0) / CELL) + b, c.kind === 'known-bad' ? 230 : 255, 0, c.kind === 'known-bad' ? 230 : 0);
  }
  writeFileSync(mapPath, Buffer.concat([Buffer.from(`P6 ${NX} ${NY} 255\n`), img]));
}
