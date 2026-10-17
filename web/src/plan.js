// The plan model of the house (data/plan.json, built by tools/build_plan.mjs): the one place the site asks which room a
// point is in, whether it is inside the house, which walls stand where, and how rooms connect. Pure data + small
// functions, no THREE, so node tests, the WebGPU path and workers can import it. bake/scripts/plan.py is the same API in
// Python; both must reproduce web/tools/golden/plan_vectors.json.
// Plan frame: x east, y north, z up, metres. The three.js scene is [x, z, -y]: toScene / toPlan are the only flips.
import data from '../data/plan.json';
import { inPoly, dist, chebyshev, offset, boxHoles, bbox, glslNum } from './plan_geom.js';

export const plan = data;
export const levels = data.levels;
export const toScene = (x, y, z = 0) => [x, z, -y];
export const toPlan = (sx, sy, sz) => [sx, -sz, sy];

// ---- spaces ---------------------------------------------------------------------------------------------------------------
// Lookup order: rooms, closets, annex, outdoor zones (the plan's order), then the yards, which lie under the zones.
const SPACES = data.spaces.map(s => ({ s, b: bbox(s.polygon), yard: s.kind === 'yard' }));
const ORDERED = [...SPACES.filter(e => !e.yard), ...SPACES.filter(e => e.yard)];
const BY_ID = new Map(data.spaces.map(s => [s.id, s]));
export const spaces = data.spaces;
export const space = id => BY_ID.get(id) ?? null;
const hit = (e, x, y) => x >= e.b.x0 && x <= e.b.x1 && y >= e.b.y0 && y <= e.b.y1 && inPoly(x, y, e.s.polygon);
// The space containing (x, y) (boundary inclusive), or null in a wall, a doorway or a seam. near > 0: else the closest
// space within that distance on the same side of the outline (walls are 0.114 thick, so 0.3 gives a point in a wall
// the room it faces, never the courtyard behind it).
export function spaceAt(x, y, near = 0) {
  for (const e of ORDERED) if (hit(e, x, y)) return e.s;
  if (!(near > 0)) return null;
  const outdoors = !isInside(x, y, 0);
  let best = null, bd = near;
  for (const e of SPACES) {
    if (e.yard || (e.s.zone === 'exterior') !== outdoors || x < e.b.x0 - bd || x > e.b.x1 + bd || y < e.b.y0 - bd || y > e.b.y1 + bd) continue;
    const d = dist(x, y, e.s.polygon); if (d <= bd && (!best || d < bd)) { best = e.s; bd = d; }
  }
  return best;
}
// Bilingual label of the space at a point; walls and doorways inside the house take the room they face.
export function roomName(x, y) {
  const s = spaceAt(x, y, isInside(x, y, 0) ? 0.3 : 0);
  return s ? { id: s.id, en: s.label.en, zh: s.label.zh, outside: s.zone === 'exterior' } : { id: null, en: 'Outside', zh: '室外', outside: true };
}
// Axis-aligned bbox of a space, the shape the old constants (GARAGE, PORCH, ...) had.
export const rectOf = id => { const s = space(id); return s ? bbox(s.polygon) : null; };

// ---- inside the house -----------------------------------------------------------------------------------------------------
// The outline grown by `margin` metres on every edge, or by default by insideMargin with the per-edge exceptions
// (insideMarginEdges: the porch sides), as its closed bbox minus open holes (the porch notch): one test for JS, GLSL and
// Python, four comparisons plus four per hole.
const SHAPES = new Map(), OUTLINE = data.outline.polygon;
const sameEdge = (e, p, q) => (e[0][0] === p[0] && e[0][1] === p[1] && e[1][0] === q[0] && e[1][1] === q[1]) || (e[0][0] === q[0] && e[0][1] === q[1] && e[1][0] === p[0] && e[1][1] === p[1]);
export const edgeMargins = () => OUTLINE.map((p, i) => (data.outline.insideMarginEdges ?? []).find(x => sameEdge(x.edge, p, OUTLINE[(i + 1) % OUTLINE.length]))?.margin ?? data.outline.insideMargin);
export function insideShape(margin) {
  const key = margin ?? 'default';
  let r = SHAPES.get(key);
  if (!r) SHAPES.set(key, r = boxHoles(margin === 0 ? OUTLINE : offset(OUTLINE, margin ?? edgeMargins())));
  return r;
}
// Default and outline shapes are kept unpacked: isInside runs per mesh at load and per frame (indoor weight, puddles).
const flat = sh => ({ b: [sh.box.x0, sh.box.x1, sh.box.y0, sh.box.y1], h: new Float64Array(sh.holes.flatMap(h => [h.x0, h.x1, h.y0, h.y1])) });
const FAST = new Map(), DEFAULT = flat(insideShape()), OUTLINE0 = flat(insideShape(0));
export function isInside(x, y, margin) {
  let f = margin === undefined ? DEFAULT : margin === 0 ? OUTLINE0 : FAST.get(margin);
  if (!f) FAST.set(margin, f = flat(insideShape(margin)));
  const b = f.b, h = f.h;
  if (x < b[0] || x > b[1] || y < b[2] || y > b[3]) return false;
  for (let i = 0; i < h.length; i += 4) if (x > h[i] && x < h[i + 1] && y > h[i + 2] && y < h[i + 3]) return false;
  return true;
}
// GLSL of the same test: `float name(vec2 p)` returns 1.0 outside, 0.0 inside (p = plan x, y).
export function insideGLSL(name = 'outsideHouse', margin) {
  const n = glslNum, { box: b, holes } = insideShape(margin), v = (x, y) => `vec2(${n(x)}, ${n(y)})`;
  const hole = holes.map(h => ` && !(all(greaterThan(p, ${v(h.x0, h.y0)})) && all(lessThan(p, ${v(h.x1, h.y1)})))`).join('');
  return `float ${name}(vec2 p) { return (all(greaterThanEqual(p, ${v(b.x0, b.y0)})) && all(lessThanEqual(p, ${v(b.x1, b.y1)}))${hole}) ? 0.0 : 1.0; }`;
}

// ---- indoor weight --------------------------------------------------------------------------------------------------------
// 0 outdoors .. 1 well inside, from the distance to the outline (Chebyshev, signed: + inside), faded out above the
// ceiling. Runs every frame (exposure, lamp factors): edges unpacked into a flat array, no allocation.
const [RAMP0, RAMP1] = data.outline.indoorRamp, FADE = data.outline.indoorFade, CEIL = data.levels.ceiling;
const smoothstep = (v, a, b) => { if (v <= a) return 0; if (v >= b) return 1; const t = (v - a) / (b - a); return t * t * (3 - 2 * t); };
// Signed Chebyshev distance to the outline (+ inside), the value of plan_geom chebyshev(x, y, outline). The outline is
// its bbox minus the porch notch (a hole on the south side): inside, the distance is the nearest of the bbox's four
// edges and the notch; in the notch, the nearest of its three walls; outside the bbox, the distance to the bbox, or to
// the notch's walls and corners below it. Four to nine subtractions per call, like the typed rectangle it replaces;
// tools/test_plan.mjs checks it against the general edge loop. Any other outline shape takes that loop.
const O0 = insideShape(0), OB = O0.box, ON = O0.holes.length === 1 ? O0.holes[0] : null;
const notchSouth = ON && ON.y0 < OB.y0 && ON.x0 > OB.x0 && ON.x1 < OB.x1 && ON.y1 < OB.y1;
const NX0 = ON?.x0, NX1 = ON?.x1, NY1 = ON?.y1, X0 = OB.x0, X1 = OB.x1, Y0 = OB.y0, Y1 = OB.y1;
export function outlineDistance(x, y) {
  if (!notchSouth) { const d = chebyshev(x, y, data.outline.polygon); return isInside(x, y, 0) ? d : -d; }
  if (x >= X0 && x <= X1 && y >= Y0 && y <= Y1) {
    if (x > NX0 && x < NX1 && y < NY1) { const a = x - NX0, b = NX1 - x, c = NY1 - y; return -(a < b ? (a < c ? a : c) : (b < c ? b : c)); }
    let d = x - X0; const e = X1 - x, f = y - Y0, g = Y1 - y; if (e < d) d = e; if (f < d) d = f; if (g < d) d = g;
    const hx = x < NX0 ? NX0 - x : x > NX1 ? x - NX1 : 0, hy = y > NY1 ? y - NY1 : 0, h = hx > hy ? hx : hy;
    return h < d ? h : d;
  }
  const dx = x < X0 ? X0 - x : x > X1 ? x - X1 : 0, dy = y < Y0 ? Y0 - y : y > Y1 ? y - Y1 : 0;
  if (y < Y0 && x > NX0 && x < NX1) {   // under the notch: its back wall, or the walls' south ends
    const c = NY1 - y, a = x - NX0 > dy ? x - NX0 : dy, b = NX1 - x > dy ? NX1 - x : dy;
    return -(a < b ? (a < c ? a : c) : (b < c ? b : c));
  }
  return -(dx > dy ? dx : dy);
}
// One-entry memo: a frame asks for the camera's weight three times (lighting exposure + target, auto exposure).
let mx = NaN, my = NaN, mh = NaN, mw = 0;
export function indoorWeight(x, y, h) {
  if (x === mx && y === my && h === mh) return mw;
  mx = x; my = y; mh = h;
  return (mw = smoothstep(outlineDistance(x, y), RAMP0, RAMP1) * (1 - smoothstep(h, CEIL, CEIL + FADE)));
}

// ---- walls ----------------------------------------------------------------------------------------------------------------
// Wall pieces (solid / sill / lintel, with heights), the niche and window patches applied and the annex included.
export const pieces = data.pieces;
export const walls = data.walls;
export const wallsAt = z => data.pieces.filter(p => p.z0 <= z && z <= p.z1);

// ---- openings and connectivity --------------------------------------------------------------------------------------------
const OPENINGS = new Map(data.openings.map(o => [o.id, o]));
export const openings = data.openings;
export const opening = id => OPENINGS.get(id) ?? null;
// [{ space, opening }] reachable from a space through one door, opening or open-plan seam (windows excluded).
export function neighbors(id) {
  const out = [];
  for (const o of data.openings) if (o.kind !== 'window' && o.connects.includes(id)) out.push({ space: o.connects[0] === id ? o.connects[1] : o.connects[0], opening: o.id });
  return out;
}
// The space on the far side of an opening as seen from (x, y): connects is [south / west side, north / east side].
export function otherSide(openingId, x, y) {
  const o = opening(openingId); if (!o) return null;
  const c = o.dir === 'H' ? (o.y0 + o.y1) / 2 : (o.x0 + o.x1) / 2, v = o.dir === 'H' ? y : x;
  return space(o.connects[v < c ? 1 : 0]);
}
