// The plan model of the house (data/plan.json, built by tools/build_plan.mjs): the one place the site asks which room a
// point is in, whether it is inside the house, which walls stand where, and how rooms connect. Pure data + small
// functions, no THREE, so node tests, the WebGPU path and workers can import it. bake/scripts/plan.py is the same API in
// Python; both must reproduce web/tools/golden/plan_vectors.json.
// Plan frame: x east, y north, z up, metres. The three.js scene is [x, z, -y]: toScene / toPlan are the only flips.
import data from '../data/plan.json';
import { inPoly, dist, offset, rects, bbox, glslNum } from './plan_geom.js';

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
// (insideMarginEdges: the porch sides), as closed rects: one test for JS, GLSL and Python.
const RECTS = new Map(), OUTLINE = data.outline.polygon;
const sameEdge = (e, p, q) => (e[0][0] === p[0] && e[0][1] === p[1] && e[1][0] === q[0] && e[1][1] === q[1]) || (e[0][0] === q[0] && e[0][1] === q[1] && e[1][0] === p[0] && e[1][1] === p[1]);
export const edgeMargins = () => OUTLINE.map((p, i) => (data.outline.insideMarginEdges ?? []).find(x => sameEdge(x.edge, p, OUTLINE[(i + 1) % OUTLINE.length]))?.margin ?? data.outline.insideMargin);
export function insideRects(margin) {
  const key = margin ?? 'default';
  let r = RECTS.get(key);
  if (!r) RECTS.set(key, r = rects(margin === 0 ? OUTLINE : offset(OUTLINE, margin ?? edgeMargins())));
  return r;
}
export function isInside(x, y, margin) {
  for (const r of insideRects(margin)) if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return true;
  return false;
}
// GLSL of the same test: `float name(vec2 p)` returns 1.0 outside, 0.0 inside (p = plan x, y).
export function insideGLSL(name = 'outsideHouse', margin) {
  const n = glslNum, t = insideRects(margin).map(r => `(p.x >= ${n(r.x0)} && p.x <= ${n(r.x1)} && p.y >= ${n(r.y0)} && p.y <= ${n(r.y1)})`);
  return `float ${name}(vec2 p) { return (${t.join(' || ')}) ? 0.0 : 1.0; }`;
}

// ---- indoor weight --------------------------------------------------------------------------------------------------------
// 0 outdoors .. 1 well inside, from the distance to the outline (Chebyshev, signed: + inside), faded out above the
// ceiling. Runs every frame (exposure, lamp factors): edges and rects unpacked into flat arrays, no allocation.
const [RAMP0, RAMP1] = data.outline.indoorRamp, FADE = data.outline.indoorFade, CEIL = data.levels.ceiling;
const EDGES = new Float64Array(data.outline.polygon.flatMap((p, i, P) => { const q = P[(i + 1) % P.length]; return [Math.min(p[0], q[0]), Math.max(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[1], q[1])]; }));
const OUTR = new Float64Array(insideRects(0).flatMap(r => [r.x0, r.x1, r.y0, r.y1]));
const smoothstep = (v, a, b) => { if (v <= a) return 0; if (v >= b) return 1; const t = (v - a) / (b - a); return t * t * (3 - 2 * t); };
export function outlineDistance(x, y) {
  let d = Infinity, inside = false;
  for (let i = 0; i < EDGES.length; i += 4) {   // same as plan_geom chebyshev(x, y, outline)
    const a = EDGES[i] - x, b = x - EDGES[i + 1], c = EDGES[i + 2] - y, f = y - EDGES[i + 3];
    const dx = a > 0 ? a : b > 0 ? b : 0, dy = c > 0 ? c : f > 0 ? f : 0, e = dx > dy ? dx : dy;
    if (e < d) d = e;
  }
  for (let i = 0; i < OUTR.length && !inside; i += 4) inside = x >= OUTR[i] && x <= OUTR[i + 1] && y >= OUTR[i + 2] && y <= OUTR[i + 3];
  return inside ? d : -d;
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
