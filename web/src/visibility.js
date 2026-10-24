// Room visibility: which parts of the scene the visitor could possibly see from where they stand, from the plan model
// (data/plan.json: spaces, openings with the two spaces they connect, walls to the ceiling). Each interior space is a
// cell, everything outdoors is one more cell, and the openings are portals between them: windows, glazed doors, open
// seams, louvred bifolds and the garage door always, hinged doors unless their leaf is shut. From the camera, a walk
// through the portals narrows a fan of plan directions (2D is enough: every wall reaches the ceiling, so whatever is seen
// through an opening lies in the directions through its centre line, at any height); a cell is visible within the union
// of the fans that reach it, the camera's own cell all round. A mesh is drawn when its plan footprint, grown by MARGIN
// (so a wall piece or a skin belongs to the spaces on both of its faces), touches a reached cell within that cell's fans.
// Conservative throughout: near a portal both sides count as the camera's own, a footprint in no space is always drawn,
// and there is no culling at or above the ceiling (aerial views look over the walls) or off the lot.
//
// Only the walkthrough camera's own render is culled: a registered mesh's layers.test answers false for that camera's
// layers alone, so the sun's shadow maps, mirrors, puddle reflections and contact depth still see every caster, and no
// visibility flag changes (the sun-shadow cache would read that as motion). main.js: ?cull=0 turns it off.
import { plan as PLAN, spaceAt } from './plan.js';
import { inPoly, bbox } from './plan_geom.js';

export const MARGIN = 0.2;     // footprint growth: thicker than any wall with its skin (0.114 + 0.15)
export const NEAR = 0.45;      // a camera this close to a portal's centre line sees both sides in full
const PORTAL_REACH = 0.3;      // an opening borders every space within this of its rect (walls are 0.11-0.27 thick)
const TAU = Math.PI * 2, OUT = 'outside';
const norm = a => { a %= TAU; return a < 0 ? a + TAU : a; };   // [0, 2pi)

// ---- the model: cells and portals -----------------------------------------------------------------------------------------
const HINGED = new Set(['door', 'front']);   // opening types with a swinging solid leaf (house.js buildDoor: a pivot)
export function buildModel(plan = PLAN) {
  const cells = [], index = new Map();
  const add = (id, poly, interior) => { index.set(id, cells.length); cells.push({ id, poly, box: poly ? bbox(poly) : null, interior, portals: [] }); };
  for (const s of plan.spaces) if (s.zone !== 'exterior') add(s.id, s.polygon, true);
  add(OUT, null, false);
  const zone = new Map(plan.spaces.map(s => [s.id, s.zone]));
  const cellOf = id => zone.get(id) === 'exterior' ? index.get(OUT) : index.get(id);
  // A portal joins the spaces its record names and every other space its opening borders: an opening can run past the
  // seam between two open-plan rooms (the office's French doors also front the dining room), and a line of sight through
  // it then starts in the room it does not name.
  const portals = [];
  for (const o of plan.openings) {
    const joined = new Set(o.connects.map(cellOf).filter(i => i !== undefined));
    const g = { x0: o.x0 - PORTAL_REACH, x1: o.x1 + PORTAL_REACH, y0: o.y0 - PORTAL_REACH, y1: o.y1 + PORTAL_REACH };
    cells.forEach((c, i) => { if (c.interior && rectTouchesPoly(g, c.poly)) joined.add(i); });
    if (joined.size < 2) continue;
    const seg = o.dir === 'H' ? [o.x0, (o.y0 + o.y1) / 2, o.x1, (o.y0 + o.y1) / 2] : [(o.x0 + o.x1) / 2, o.y0, (o.x0 + o.x1) / 2, o.y1];
    const p = { id: o.id, cells: [...joined], seg, hinged: o.kind === 'door' && HINGED.has(o.type) };
    portals.push(p); for (const i of p.cells) cells[i].portals.push(p);
  }
  return { cells, portals, index, outside: index.get(OUT), outline: plan.outline.polygon, lot: plan.lot, ceiling: plan.levels.ceiling };
}

// ---- footprints -----------------------------------------------------------------------------------------------------------
const edgeInRect = (r, P) => {
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [ax, ay] = P[j], [bx, by] = P[i];
    if (Math.max(ax, bx) >= r.x0 && Math.min(ax, bx) <= r.x1 && Math.max(ay, by) >= r.y0 && Math.min(ay, by) <= r.y1) return true;
  }
  return false;
};
// Does the axis-aligned rect touch the rectilinear polygon P (an edge inside the rect, or the rect wholly inside P)?
export const rectTouchesPoly = (r, P) => edgeInRect(r, P) || inPoly((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, P);
const rectInsidePoly = (r, P) => !edgeInRect(r, P) && inPoly((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, P);
// The cells a footprint (plan rect; grown by MARGIN here) belongs to; null when it touches none (always drawn). Outdoors
// is every footprint not wholly inside the outline.
export function cellsOf(model, rect) {
  const r = { x0: rect.x0 - MARGIN, x1: rect.x1 + MARGIN, y0: rect.y0 - MARGIN, y1: rect.y1 + MARGIN }, out = [];
  for (let i = 0; i < model.cells.length; i++) {
    const c = model.cells[i];
    if (c.interior) { if (r.x1 >= c.box.x0 && r.x0 <= c.box.x1 && r.y1 >= c.box.y0 && r.y0 <= c.box.y1 && rectTouchesPoly(r, c.poly)) out.push(i); }
    else if (!rectInsidePoly(r, model.outline)) out.push(i);
  }
  return out.length ? out : null;
}

// ---- arcs: lists of plan directions [start, length], angles from +x toward +y --------------------------------------------
export const FULL = [[0, TAU]];
export function intersectArc(a, b, out) {
  if (a[1] >= TAU) { out.push(b); return; }
  if (b[1] >= TAU) { out.push(a); return; }
  const d = norm(b[0] - a[0]);
  if (d < a[1]) { const l = Math.min(b[1], a[1] - d); if (l > 1e-9) out.push([b[0], l]); }
  if (d + b[1] > TAU) { const l = Math.min(a[1], d + b[1] - TAU); if (l > 1e-9) out.push([a[0], l]); }
}
export function intersectArcs(list, arc) { const out = []; for (const a of list) intersectArc(a, arc, out); return out; }
// The same directions as sorted disjoint arcs (a cell reached along many paths collects overlapping ones).
export function unionArcs(list) {
  if (list.some(a => a[1] >= TAU)) return FULL;
  const v = list.map(([s, l]) => [norm(s), l]).sort((a, b) => a[0] - b[0]), out = [];
  for (const [s, l] of v) { const last = out[out.length - 1]; if (last && s <= last[0] + last[1] + 1e-12) last[1] = Math.max(last[1], s + l - last[0]); else out.push([s, l]); }
  if (out.length > 1) { const last = out[out.length - 1], first = out[0]; if (last[0] + last[1] >= TAU + first[0] - 1e-12) { last[1] = Math.max(last[1], TAU + first[0] + first[1] - last[0]); out.shift(); } }
  return out.length === 1 && out[0][1] >= TAU - 1e-12 ? FULL : out;
}
// The directions from (x, y) through a segment [x0, y0, x1, y1], or the full circle within NEAR of it.
export function segmentArc(x, y, s) {
  const [x0, y0, x1, y1] = s, dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / L2)) : 0;
  if (Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)) < NEAR) return FULL[0];
  const a = Math.atan2(y0 - y, x0 - x), b = Math.atan2(y1 - y, x1 - x), d = norm(b - a);
  return d <= Math.PI ? [norm(a), d] : [norm(b), TAU - d];
}
// Does the rect lie (partly) within the arcs, seen from (x, y)?
export function rectInArcs(x, y, r, arcs) {
  if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return true;
  const base = Math.atan2((r.y0 + r.y1) / 2 - y, (r.x0 + r.x1) / 2 - x);
  let lo = 0, hi = 0;
  for (let k = 0; k < 4; k++) {
    let d = Math.atan2((k & 2 ? r.y1 : r.y0) - y, (k & 1 ? r.x1 : r.x0) - x) - base;
    if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
    if (d < lo) lo = d; if (d > hi) hi = d;
  }
  const s = norm(base + lo), span = hi - lo;
  for (const [a, l] of arcs) if (l >= TAU || norm(s - a) <= l || norm(a - s) <= span) return true;
  return false;
}

// ---- the walk through the portals ---------------------------------------------------------------------------------------
// reached[i]: the arcs cell i is seen within (FULL for the camera's own cells) or null. null overall: no culling here
// (at or above the ceiling, off the lot, nowhere, or a walk longer than MAX_STEPS): everything is drawn.
export const MAX_STEPS = 20000;
export function reach(model, x, y, z, isOpen = () => true) {
  if (!(z < model.ceiling - 0.02) || x < model.lot.x0 || x > model.lot.x1 || y < model.lot.y0 || y > model.lot.y1) return null;
  const n = model.cells.length, reached = new Array(n).fill(null), start = new Set(), arcs = new Map();
  const own = spaceAt(x, y) ?? spaceAt(x, y, NEAR);
  if (own) start.add(own.zone === 'exterior' ? model.outside : model.index.get(own.id));
  for (const p of model.portals) {
    const arc = segmentArc(x, y, p.seg); arcs.set(p, arc);
    if (arc[1] >= TAU) for (const c of p.cells) start.add(c);   // in or by the opening: both sides are the camera's own
  }
  if (!start.size) return null;
  let steps = 0;
  const onPath = new Set();
  const walk = (cell, fan) => {
    if (++steps > MAX_STEPS) return false;
    (reached[cell] ??= []).push(...fan);
    for (const p of model.cells[cell].portals) {
      if (onPath.has(p) || (p.hinged && !isOpen(p.id))) continue;
      const next = intersectArcs(fan, arcs.get(p));
      if (!next.length) continue;
      onPath.add(p);
      for (const other of p.cells) if (other !== cell && !walk(other, next)) return false;
      onPath.delete(p);
    }
    return true;
  };
  for (const c of start) if (!walk(c, FULL)) return null;
  for (let i = 0; i < n; i++) if (reached[i]) reached[i] = start.has(i) ? FULL : unionArcs(reached[i]);
  reached.steps = steps;
  return reached;
}
// Is a footprint (rect + its cells from cellsOf) visible, given reach()'s result from (x, y)?
export function visibleFrom(reached, x, y, rect, cells) {
  if (!reached || !cells) return true;
  for (const c of cells) {
    const arcs = reached[c]; if (!arcs) continue;
    if (arcs === FULL || rectInArcs(x, y, rect, arcs)) return true;
  }
  return false;
}

// ---- the scene side -------------------------------------------------------------------------------------------------------
// roots: the subtrees to cull (house, layout, garden, merged batches). moving: roots carried or dragged (movables, seats):
// their footprint is measured again whenever their world matrix changes. swinging: roots whose parts move in place (doors,
// within about a leaf of their frame; toggles and swaying plants within 0.5 m): a fixed footprint grown by that much.
// doors: house.js getDoors() (a hinged door shut blocks the view). Meshes added later (pets, the visitor, pins, overlays)
// are never culled.
export function createRoomCulling({ THREE, camera, roots, moving = [], swinging = [], doors = [], plan = PLAN, enabled = true }) {
  const model = buildModel(plan), main = camera.layers;
  const box = new THREE.Box3(), part = new THREE.Box3(), m4 = new THREE.Matrix4();
  // the walkthrough camera alone is refused a culled mesh
  function test(layers) { return (this.mask & layers.mask) !== 0 && !(this.culled === true && layers === main); }
  // plan rect of a subtree's world box; an instanced mesh over every instance slot (its count may grow later)
  // the world box of a subtree (into `into`), optionally in the frame of `space` (a matrix inverse)
  const boxOf = (root, into, space = null) => {
    into.makeEmpty();
    root.traverse(o => {
      const g = o.geometry; if (!g?.attributes?.position) return;
      if (!g.boundingBox) g.computeBoundingBox();
      const w = space ? m4b.multiplyMatrices(space, o.matrixWorld) : o.matrixWorld;
      if (o.isInstancedMesh) for (let i = 0, k = o.instanceMatrix.count; i < k; i++) { o.getMatrixAt(i, m4); into.union(part.copy(g.boundingBox).applyMatrix4(m4.premultiply(w))); }
      else into.union(part.copy(g.boundingBox).applyMatrix4(w));
    });
    return into;
  };
  const rectOf = b => b.isEmpty() ? null : { x0: b.min.x, x1: b.max.x, y0: -b.max.z, y1: -b.min.z };
  const footprint = root => rectOf(boxOf(root, box));
  const m4b = new THREE.Matrix4();
  const grow = (r, d) => r && { x0: r.x0 - d, x1: r.x1 + d, y0: r.y0 - d, y1: r.y1 + d };
  for (const root of roots) root?.updateMatrixWorld(true);
  const movingSet = new Set(moving), swingBy = new Map();
  for (const r of swinging) if (r) swingBy.set(r, r.userData?.door ? 1.0 : 0.5);
  // units: one footprint and the meshes that share it (a moving or swinging root's meshes share the root's)
  const units = [], movers = new Map(), swings = new Map(), seen = new Set();
  const unit = (rect, extra) => { const u = { rect, cells: rect ? cellsOf(model, rect) : null, layers: [], hidden: false, ...extra }; units.push(u); return u; };
  for (const root of roots) root?.traverse(o => {
    // merged originals never draw again (batch.js): nothing to cull
    if (!(o.isMesh || o.isLine || o.isPoints) || o.userData.batched || seen.has(o) || (o.layers.mask & 1) === 0) return;
    seen.add(o);
    let mover = null, swing = null;
    for (let p = o; p; p = p.parent) { if (movingSet.has(p)) mover = p; if (swingBy.has(p)) swing = p; }   // the outermost of each
    let u;
    if (mover) {
      // its box in its own frame, measured once; placed by the root's current world matrix in update()
      if (!movers.has(mover)) movers.set(mover, unit(null, { root: mover, matrix: null, local: boxOf(mover, new THREE.Box3(), m4.copy(mover.matrixWorld).invert().clone()) }));
      u = movers.get(mover);
    } else if (swing) {
      if (!swings.has(swing)) swings.set(swing, unit(grow(footprint(swing), swingBy.get(swing))));
      u = swings.get(swing);
    } else u = unit(footprint(o));
    o.layers.culled = false; o.layers.test = test;
    u.layers.push(o.layers);
  });
  const doorById = new Map(doors.filter(d => d.pivot).map(d => [d.id, d]));
  const isOpen = id => { const d = doorById.get(id); return !d || !(d.target === 0 && Math.abs(d.pivot.rotation.y) < 1e-3); };
  const meshes = units.reduce((n, u) => n + u.layers.length, 0);
  const stats = { meshes, units: units.length, moving: movers.size, culled: 0, reached: 0, off: false, steps: 0, ms: 0 };
  let on = enabled, lastKey = '';
  const show = (u, hidden) => { if (u.hidden === hidden) return; u.hidden = hidden; for (const l of u.layers) l.culled = hidden; };
  function clear() { for (const u of units) show(u, false); stats.culled = 0; lastKey = ''; }
  function update() {
    if (!on) return;
    const t0 = performance.now();
    camera.updateMatrixWorld();
    const p = camera.matrixWorld.elements, x = p[12], y = -p[14], z = p[13];
    let key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)},`;
    for (const d of doorById.values()) key += isOpen(d.id) ? '1' : '0';
    let moved = false;
    for (const m of movers.values()) {
      m.root.updateWorldMatrix(true, false);   // this frame's pose (the render updates matrices only later)
      const e = m.root.matrixWorld.elements;
      if (m.matrix && e.every((v, i) => v === m.matrix[i])) continue;
      m.matrix = e.slice(); m.rect = grow(rectOf(box.copy(m.local).applyMatrix4(m.root.matrixWorld)), 0.05); m.cells = m.rect ? cellsOf(model, m.rect) : null; moved = true;
    }
    if (key !== lastKey || moved) {
      lastKey = key;
      const reached = reach(model, x, y, z, isOpen);
      stats.off = !reached; stats.reached = reached ? reached.filter(Boolean).length : model.cells.length; stats.steps = reached?.steps ?? 0;
      let culled = 0;
      for (const u of units) { const hide = !!u.rect && !visibleFrom(reached, x, y, u.rect, u.cells); show(u, hide); if (hide) culled += u.layers.length; }
      stats.culled = culled;
    }
    stats.ms = performance.now() - t0;
  }
  return {
    model, stats, update, units,
    get enabled() { return on; },
    setEnabled(v) { on = !!v; if (!on) clear(); },
  };
}
