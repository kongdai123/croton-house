// Room visibility (src/visibility.js): the arc arithmetic, then the claim that matters, conservativeness: from sample
// points in every space (and around the house, and in doorways), nothing a straight line of sight in plan can reach past
// the walls is culled, with every door open and with every hinged door shut; a shut door hides what is behind it; and on
// the real house (built headless) the walkthrough camera alone is refused culled meshes, at every gate camera.
//   node tools/test_visibility.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importSrc } from './harness/util.mjs';
import { buildRealScene } from './harness/scene.mjs';

const V = await importSrc('src/visibility.js');
const plan = JSON.parse(readFileSync(fileURLToPath(new URL('../data/plan.json', import.meta.url)), 'utf8'));
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed++; console.log('FAIL ' + msg); } };
const TAU = Math.PI * 2, close = (a, b) => Math.abs(a - b) < 1e-9;

// ---- 1. arcs ----------------------------------------------------------------------------------------------------------
{
  const i = V.intersectArcs([[0, Math.PI]], [Math.PI / 2, Math.PI]);
  check(i.length === 1 && close(i[0][0], Math.PI / 2) && close(i[0][1], Math.PI / 2), 'overlapping arcs intersect to their common part');
  const wrap = V.intersectArcs([[TAU - 0.5, 1]], [0.25, 1]);
  check(wrap.length === 1 && close(wrap[0][0], 0.25) && close(wrap[0][1], 0.25), 'an arc across 0 intersects past the wrap');
  const two = V.intersectArcs([[0, 4]], [3.5, 3.5]);   // b runs from inside a past 2pi and back into a's start
  check(two.length === 2, 'an arc can cut another in two pieces');
  check(V.intersectArcs([[0, 1]], [2, 1]).length === 0, 'disjoint arcs have no intersection');
  check(V.intersectArcs(V.FULL, [1, 0.5])[0][1] === 0.5, 'the full circle is the identity');
  const u = V.unionArcs([[0.1, 0.2], [0.25, 0.2], [TAU - 0.1, 0.25], [3, 0.1]]);   // the last but one wraps to 0.15, into the first
  check(u.length === 2 && close(u[0][0], 3) && close(u[1][0], TAU - 0.1) && close(u[1][1], 0.55), 'union merges overlaps, across the wrap too: ' + JSON.stringify(u));
  check(V.unionArcs([[0.1, 0.2], [TAU - 0.1, 0.15]]).length === 2, 'union keeps arcs that do not meet');
  const s = V.segmentArc(0, 0, [1, -1, 1, 1]);
  check(close(s[0], TAU - Math.PI / 4) && close(s[1], Math.PI / 2), 'a segment spans the directions to its ends');
  check(V.segmentArc(0.1, 0, [0, -1, 0, 1])[1] >= TAU, 'within NEAR of a segment: all directions');
  check(V.rectInArcs(0, 0, { x0: 2, x1: 3, y0: -0.2, y1: 0.2 }, [[TAU - 0.1, 0.2]]), 'a rect straight ahead lies in a narrow arc');
  check(!V.rectInArcs(0, 0, { x0: -3, x1: -2, y0: -0.2, y1: 0.2 }, [[TAU - 0.1, 0.2]]), 'a rect behind does not');
  check(V.rectInArcs(0, 0, { x0: -1, x1: 1, y0: -1, y1: 1 }, [[1, 0.01]]), 'a rect around the point is always in');
}

// ---- 2. conservative against plan lines of sight ------------------------------------------------------------------------
const model = V.buildModel(plan);
check(model.portals.length === plan.openings.length, `every opening is a portal (${model.portals.length} of ${plan.openings.length})`);
const hinged = model.portals.filter(p => p.hinged).map(p => p.id).sort();
check(hinged.length === plan.openings.filter(o => o.kind === 'door' && ['door', 'front'].includes(o.type)).length, 'hinged doors are the door and front types');
// blockers: full-height wall pieces, plus the openings of shut hinged doors
const solid = plan.pieces.filter(p => p.kind === 'solid' && p.z0 <= 0.01 && p.z1 >= plan.levels.ceiling - 0.01);
check(solid.length > 50, 'the plan has its wall pieces');
const doorRect = id => { const o = plan.openings.find(q => q.id === id); return { x0: o.x0, x1: o.x1, y0: o.y0, y1: o.y1 }; };
// first parameter t in [0, 1] at which the segment p->q is inside rect r (Liang-Barsky), or Infinity
function enter(px, py, qx, qy, r) {
  let t0 = 0, t1 = 1; const dx = qx - px, dy = qy - py;
  for (const [p, q] of [[-dx, px - r.x0], [dx, r.x1 - px], [-dy, py - r.y0], [dy, r.y1 - py]]) {
    if (p === 0) { if (q < 0) return Infinity; continue; }
    const t = q / p; if (p < 0) { if (t > t1) return Infinity; if (t > t0) t0 = t; } else { if (t < t0) return Infinity; if (t < t1) t1 = t; }
  }
  return t0;
}
// can a straight line from (x, y) reach some point of r before any blocker? (rays to a grid over r)
// inView(px, py): optional, whether that plan point is in the camera's view (some height of it inside the frustum)
function sees(x, y, r, blockers, inView = null) {
  const nx = Math.min(6, Math.max(2, Math.ceil((r.x1 - r.x0) / 0.25))), ny = Math.min(6, Math.max(2, Math.ceil((r.y1 - r.y0) / 0.25)));
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) {
    const qx = r.x0 + (r.x1 - r.x0) * i / nx, qy = r.y0 + (r.y1 - r.y0) * j / ny, te = enter(x, y, qx, qy, r);
    if (te === Infinity) continue;
    if (inView && !inView(x + (qx - x) * te, y + (qy - y) * te)) continue;   // where the line meets the rect is out of view
    let blocked = false;
    for (const b of blockers) { const tb = enter(x, y, qx, qy, b); if (tb < te - 1e-9) { blocked = true; break; } }
    if (!blocked) return true;
  }
  return false;
}
// sample points: a 0.5 m grid in every interior space kept 0.2 m from its walls (the visitor's radius), points around the
// house, and both sides of every doorway
const inPolyPt = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
const clearOf = (x, y, d) => !solid.some(b => x > b.x0 - d && x < b.x1 + d && y > b.y0 - d && y < b.y1 + d);
const points = [];
for (const s of plan.spaces.filter(s => s.zone !== 'exterior')) {
  const xs = s.polygon.map(p => p[0]), ys = s.polygon.map(p => p[1]);
  for (let x = Math.min(...xs) + 0.2; x <= Math.max(...xs) - 0.2; x += 0.5) for (let y = Math.min(...ys) + 0.2; y <= Math.max(...ys) - 0.2; y += 0.5)
    if (inPolyPt(x, y, s.polygon) && clearOf(x, y, 0.2)) points.push([x, y, s.id]);
}
for (let x = -11; x <= 11; x += 1.5) for (const y of [-9, -7, -6.2, 6, 7.5, 10, 13]) if (clearOf(x, y, 0.2)) points.push([x, y, 'out']);
for (let y = -5; y <= 5; y += 1.5) for (const x of [-11, -8.6, 8.6, 11]) points.push([x, y, 'out']);
for (const p of model.portals) { const [x0, y0, x1, y1] = p.seg, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, n = x0 === x1 ? [1, 0] : [0, 1]; for (const d of [-0.3, 0, 0.3]) points.push([cx + n[0] * d, cy + n[1] * d, 'door ' + p.id]); }
// target rects: 1 m squares over the house and garden, and the wall pieces themselves
const rects = [];
for (let x = -11.5; x < 11.5; x += 1) for (let y = -9.5; y < 13; y += 1) rects.push({ x0: x, x1: x + 1, y0: y, y1: y + 1 });
for (const b of solid) rects.push({ x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1 });
const cells = rects.map(r => V.cellsOf(model, r));
// top: the targets' height. Below the walls' top (the camera at 1.5 m is too) a straight line of sight stays below them
// everywhere, so plan lines are the truth outdoors as well, where the house itself hides the far side of the garden;
// taller targets may show over the roof and are only culled by the portals.
function audit(label, isOpen, blockers, { top = Infinity, where: only = () => true, least = 0.25 } = {}) {
  let pairs = 0, culled = 0; const bad = [], pts = points.filter(p => only(p[2]));
  for (const [x, y, where] of pts) {
    const reached = V.reach(model, x, y, 1.5, isOpen);
    if (!reached) { bad.push(`${where} (${x.toFixed(2)}, ${y.toFixed(2)}): culling off on the ground floor`); continue; }
    for (let k = 0; k < rects.length; k++) {
      pairs++;
      if (V.visibleFrom(reached, x, y, rects[k], cells[k], top)) continue;
      culled++;
      if (sees(x, y, rects[k], blockers)) bad.push(`${where} (${x.toFixed(2)}, ${y.toFixed(2)}) -> rect ${JSON.stringify(rects[k])}`);
    }
  }
  check(!bad.length, `${label}: ${bad.length} visible rects culled, e.g.\n  ${bad.slice(0, 8).join('\n  ')}`);
  check(culled / pairs > least, `${label}: culls something (${(100 * culled / pairs).toFixed(0)}% of ${pairs} point-rect pairs)`);
  console.log(`${label}: ${pts.length} points x ${rects.length} rects, ${(100 * culled / pairs).toFixed(0)}% culled, ${bad.length} of them visible`);
  return culled / pairs;
}
const t0 = performance.now();
audit('every door open', () => true, solid);
audit('hinged doors shut', () => false, solid.concat(hinged.map(doorRect)));
const outdoors = w => w === 'out' || w.startsWith('door ');
const low = audit('outdoors, low targets, doors open', () => true, solid, { top: 1, where: outdoors, least: 0.1 });
audit('outdoors, low targets, hinged doors shut', () => false, solid.concat(hinged.map(doorRect)), { top: 1, where: outdoors, least: 0.1 });
const tall = audit('outdoors, tall targets', () => true, solid, { top: 6, where: outdoors, least: 0 });
check(low > tall + 0.05, `the house hides low targets outdoors (${(100 * low).toFixed(0)}% culled, ${(100 * tall).toFixed(0)}% when tall)`);
{ // the shadow of one box, exactly
  const b = { x0: 0, x1: 2, y0: 0, y1: 2 };
  check(V.inShadow(1, -3, { x0: 0.8, x1: 1.2, y0: 4, y1: 4.5 }, b), 'a rect straight behind a box is in its shadow');
  check(!V.inShadow(1, -3, { x0: 3, x1: 3.5, y0: 4, y1: 4.5 }, b), 'one off to the side is not');
  check(V.inShadow(-3, -3, { x0: 3, x1: 3.4, y0: 3, y1: 3.4 }, b), 'from a corner: a rect across the diagonal behind it');
  check(V.inShadow(-3, -3, { x0: 1.5, x1: 6, y0: 2.6, y1: 2.8 }, b) && !V.inShadow(-3, -3, { x0: 1.5, x1: 9, y0: 2.6, y1: 2.8 }, b), 'from a corner: a long rect behind both faces, and one reaching past the shadow edge');
  check(!V.inShadow(1, 1, { x0: 5, x1: 6, y0: 5, y1: 6 }, b), 'nothing is behind a box from inside it');
  check(V.occludersOf(plan.outline.polygon).length >= 1, 'the outline gives at least one solid block');
}
console.log(`line-of-sight audit ${((performance.now() - t0) / 1000).toFixed(1)} s`);
// a shut door hides the room behind it: bedroom 3 from the hall, the hall closet doors aside (bifolds stay open)
{
  const inBed3 = { x0: 4.6, x1: 5.0, y0: -4.6, y1: -4.2 }, c = V.cellsOf(model, inBed3), at = [4.55, 0.3];
  check(c.length === 1 && model.cells[c[0]].id === 'bedroom3', 'a rect in bedroom 3 belongs to it alone');
  const open = V.reach(model, ...at, 1.5, () => true), shut = V.reach(model, ...at, 1.5, id => id !== '60bf34160a');
  check(V.visibleFrom(open, ...at, inBed3, c), 'bedroom 3 seen from the hall through its open door');
  check(!V.visibleFrom(shut, ...at, inBed3, c), 'bedroom 3 hidden from the hall behind its shut door');
}
check(V.reach(model, 0, 0, plan.levels.ceiling + 0.5) === null, 'no culling above the ceiling');
check(V.reach(model, 0, 40, 1.5) === null, 'no culling off the lot');

// ---- 3. the real house ------------------------------------------------------------------------------------------------
{
  const w = await buildRealScene({ extra: "export * as vis from './src/visibility.js';", variant: 'visibility' });
  const { T, scene, vis, layout, doors } = w;
  const camera = new T.PerspectiveCamera(62, 16 / 9, 0.05, 300), sunCam = new T.OrthographicCamera(), other = new T.PerspectiveCamera();
  scene.add(camera);
  const cull = vis.createRoomCulling({ THREE: T, camera, roots: [w.houseRoot, layout.root, w.garden.group, w.batch.world], moving: layout.interactive.filter(o => !o.userData.toggle),
    swinging: [...doors.map(d => d.group), ...layout.animated], doors });
  check(cull.stats.meshes > 1000 && cull.stats.units > 500, `registers the house (${cull.stats.meshes} meshes in ${cull.stats.units} footprints)`);
  let lights = 0; scene.traverse(o => { if (o.isLight && o.layers.test !== T.Layers.prototype.test) lights++; });
  check(lights === 0, 'no light is ever culled (a light-count change recompiles every shader)');
  const cams = JSON.parse(readFileSync(fileURLToPath(new URL('../../bake/validate/cameras.json', import.meta.url)), 'utf8')).cameras;
  const blockers = solid.concat(hinged.filter(id => { const d = doors.find(x => x.id === id); return d?.pivot && d.target === 0; }).map(doorRect));
  let culledTotal = 0, worst = 0, inView = 0; const bad = [], leak = [], frustum = new T.Frustum(), m4 = new T.Matrix4(), box3 = new T.Box3(), v3 = new T.Vector3();
  for (const c of cams) {
    for (const d of doors) if (c.doors?.[d.id] && d.pivot) d.pivot.rotation.y = c.doors[d.id] === 'open' ? d.openAngle : 0;
    camera.position.set(c.x, c.z, -c.y); camera.rotation.set(c.p, -c.h * Math.PI / 180, 0, 'YXZ');
    const t = performance.now(); cull.update(); worst = Math.max(worst, performance.now() - t);
    culledTotal += cull.stats.culled;
    camera.updateMatrixWorld(); frustum.setFromProjectionMatrix(m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (const u of cull.units) {
      if (!u.hidden) continue;
      for (const l of u.layers) if (!l.test(sunCam.layers) || !l.test(other.layers)) leak.push(c.id);
      // outside the frustum the renderer drops it anyway (culling also skips what lies outside the view's plan directions):
      // a line of sight counts where it meets the footprint inside the frustum, at some height up to the footprint's top
      if (!frustum.intersectsBox(box3.set(new T.Vector3(u.rect.x0, -1, -u.rect.y1), new T.Vector3(u.rect.x1, u.rect.top, -u.rect.y0)))) continue;
      inView++;
      const tops = [0.02, 0.5, 1, 1.5, 2, 3, 5, 9].filter(h => h <= Math.max(0.02, u.rect.top + 0.01));
      if (sees(c.x, c.y, u.rect, blockers, (px, py) => tops.some(h => frustum.containsPoint(v3.set(px, h, -py))))) bad.push(`${c.id}: ${JSON.stringify(u.rect)}`);
    }
    for (const d of doors) if (c.doors?.[d.id] && d.pivot) d.pivot.rotation.y = d.target;
  }
  check(!bad.length, `gate cameras: ${bad.length} culled footprints in plain sight, e.g.\n  ${bad.slice(0, 8).join('\n  ')}`);
  check(!leak.length, 'a culled mesh is hidden from other cameras too (shadows, mirrors): ' + [...new Set(leak)].join(', '));
  check(culledTotal > cams.length * 300, `gate cameras cull something (${Math.round(culledTotal / cams.length)} meshes per camera)`);
  check(inView > cams.length * 100, `... much of it inside the frustum, behind walls (${Math.round(inView / cams.length)} footprints per camera)`);
  camera.position.set(0, plan.levels.ceiling + 3, 0); cull.update();
  check(cull.stats.culled === 0 && cull.stats.off, 'above the roof nothing is culled');
  cull.setEnabled(false);
  check(cull.units.every(u => !u.hidden && u.layers.every(l => l.test(camera.layers))), 'switched off, everything draws');
  console.log(`real house: ${cull.stats.meshes} meshes, ${Math.round(culledTotal / cams.length)} culled per gate camera, worst update ${worst.toFixed(1)} ms`);
}

console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
