// Builds web/data/plan.json, the one plan model of the house, from the Zillow import (data/house.json, parse_plan.mjs)
// and the hand-authored overlay (data/plan_overlay.json: annex, closets, outdoor zones, labels, door specs, patches).
// Everything that asks "which room", "inside the house" or "which walls" reads plan.json through web/src/plan.js or
// bake/scripts/plan.py; nothing else types room or wall coordinates.
//   node tools/build_plan.mjs           write data/plan.json (fails if the result does not validate)
//   node tools/build_plan.mjs --check   exit 1 if data/plan.json is not what this script would write
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { importSrc } from './harness/util.mjs';

const { q4, clean, bbox, inPoly, rectilinear, overlapArea, area, onBoundary } = await importSrc('src/plan_geom.js');

const DATA = fileURLToPath(new URL('../data/', import.meta.url));
export const PLAN_PATH = join(DATA, 'plan.json');
const r4 = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? q4(v) : v]));

// ---- wall pieces: house.js's build-time patches applied once, here, so every reader sees the same walls --------------
// Kitchen window resize (house.js resizeWindows): the opening and the sill / lintel / neighbouring solids follow it.
function resizeWindows(house, sizes) {
  for (const o of house.openings) {
    const s = sizes[o.id]; if (!s) continue;
    const [a0, a1, b0, b1] = o.dir === 'H' ? ['x0', 'x1', 'y0', 'y1'] : ['y0', 'y1', 'x0', 'x1'];
    const old0 = o[a0], old1 = o[a1], lo = s[a0] ?? old0, hi = s[a1] ?? old1;
    for (const p of house.pieces) if (p.wall === o.wall && p[b0] === o[b0] && p[b1] === o[b1]) {
      if (p[a0] === old0 && p[a1] === old1 && (p.kind === 'sill' || p.kind === 'lintel')) { p[a0] = lo; p[a1] = hi; if (p.kind === 'sill') p.z1 = s.sill; else p.z0 = s.head; }
      else if (p.kind === 'solid') { if (p[a1] === old0) p[a1] = lo; if (p[a0] === old1) p[a0] = hi; }
    }
    o[a0] = lo; o[a1] = hi; o.width = hi - lo; o.sill = s.sill; o.head = s.head;
  }
}
// Split solid pieces around windows the scan missed into wall | sill | lintel | wall (house.js cutOpenings).
function cutOpenings(pieces, extra, ceiling) {
  const out = [];
  for (const p of pieces) {
    const o = p.kind === 'solid' && extra.find(e => e.dir === p.dir && (p.dir === 'V'
      ? Math.abs((p.x0 + p.x1) / 2 - (e.x0 + e.x1) / 2) < 0.06 && p.y0 < e.y0 && p.y1 > e.y1
      : Math.abs((p.y0 + p.y1) / 2 - (e.y0 + e.y1) / 2) < 0.06 && p.x0 < e.x0 && p.x1 > e.x1));
    if (!o) { out.push(p); continue; }
    const [a0, a1, k0, k1] = p.dir === 'V' ? ['y0', 'y1', o.y0, o.y1] : ['x0', 'x1', o.x0, o.x1];
    out.push({ ...p, [a1]: k0 }, { ...p, [a0]: k1 }, { ...p, [a0]: k0, [a1]: k1, kind: 'sill', z0: 0, z1: o.sill }, { ...p, [a0]: k0, [a1]: k1, kind: 'lintel', z0: o.head, z1: ceiling });
  }
  return out;
}
// Pieces of an authored wall: solids between its openings, a lintel over each door, sill + lintel at each window.
function wallPieces(w, openings, ceiling) {
  const [a0, a1] = w.dir === 'V' ? ['y0', 'y1'] : ['x0', 'x1'], out = [], base = { wall: w.id, dir: w.dir, x0: w.x0, x1: w.x1, y0: w.y0, y1: w.y1 };
  let at = w[a0];
  for (const o of openings.filter(o => o.wall === w.id).sort((a, b) => a[a0] - b[a0])) {
    if (o[a0] > at) out.push({ ...base, kind: 'solid', [a0]: at, [a1]: o[a0], z0: 0, z1: ceiling });
    if (o.kind === 'window') out.push({ ...base, kind: 'sill', [a0]: o[a0], [a1]: o[a1], z0: 0, z1: o.sill });
    out.push({ ...base, kind: 'lintel', [a0]: o[a0], [a1]: o[a1], z0: o.head, z1: ceiling });
    at = o[a1];
  }
  if (at < w[a1]) out.push({ ...base, kind: 'solid', [a0]: at, [a1]: w[a1], z0: 0, z1: ceiling });
  return out;
}
// A wall on the outline (centre within 0.08 m of an outline edge, running along it; house.js isExteriorPiece).
function onOutline(p, fp) {
  const cx = (p.x0 + p.x1) / 2, cy = (p.y0 + p.y1) / 2;
  for (let i = 0; i < fp.length; i++) {
    const a = fp[i], b = fp[(i + 1) % fp.length];
    if (a[0] === b[0] && p.dir === 'V' && Math.abs(cx - a[0]) < 0.08 && cy > Math.min(a[1], b[1]) - 0.1 && cy < Math.max(a[1], b[1]) + 0.1) return true;
    if (a[1] === b[1] && p.dir === 'H' && Math.abs(cy - a[1]) < 0.08 && cx > Math.min(a[0], b[0]) - 0.1 && cx < Math.max(a[0], b[0]) + 0.1) return true;
  }
  return false;
}

export function buildPlan(house, overlay) {
  house = structuredClone(house);
  const levels = { ceiling: house.ceiling, doorHeight: house.doorHeight, windowSill: house.windowSill, windowHead: house.windowHead };
  const outline = { ...overlay.outline, polygon: clean(overlay.outline.polygon) };
  const P = overlay.patches, removed = new Set(P.niche.remove);

  // spaces: polygons on interior faces, CCW, in lookup order (rooms, closets, annex, outdoor zones, yards last)
  const notes = new Map(house.notes.map(n => [n.id, n])), rooms = new Map(house.rooms.map(r => [r.id, r]));
  const spaces = overlay.spaces.map(s => {
    const note = s.from?.note && notes.get(s.from.note), room = s.from?.room ? rooms.get(s.from.room) : note && rooms.get(note.room);
    if (s.from?.note && !note) throw new Error(`space ${s.id}: no house.json note ${s.from.note}`);
    let poly = s.polygon ?? (s.rect ? [[s.rect.x0, s.rect.y0], [s.rect.x1, s.rect.y0], [s.rect.x1, s.rect.y1], [s.rect.x0, s.rect.y1]] : note?.area ?? room?.pts);
    if (!poly) throw new Error(`space ${s.id}: no polygon`);
    if (s.snapX0 !== undefined) { const x0 = Math.min(...poly.map(p => p[0])); poly = poly.map(([x, y]) => [x === x0 ? s.snapX0 : x, y]); }
    const out = { id: s.id, kind: s.kind, zone: s.zone, label: s.label, polygon: clean(poly), ceiling: s.zone === 'exterior' ? null : levels.ceiling, indoor: s.zone === 'exterior' ? 0 : 1 };
    if (s.lampGroup) out.lampGroup = s.lampGroup;
    for (const k of ['reflBox', 'reflProbe', 'view']) if (s[k]) out[k] = s[k];
    if (room || note) out.source = { ...(room && { room: room.id }), ...(note && { note: note.id }) };
    return out;
  });
  const spaceAt = (x, y) => spaces.find(s => s.kind !== 'yard' && inPoly(x, y, s.polygon)) ?? spaces.find(s => s.kind === 'yard' && inPoly(x, y, s.polygon)) ?? null;

  // openings: Zillow's (kitchen window resized) + the annex doors, the missed window and the open-plan connections
  resizeWindows(house, Object.fromEntries(Object.entries(P.windows).filter(([k]) => k !== 'why')));
  const spec = overlay.openings.spec;
  const openings = [...house.openings, ...overlay.openings.add].map(o => {
    const sp = spec[o.id] ?? {}, kind = o.kind;
    const out = r4({ id: o.id, kind, type: o.type ?? sp.type ?? (kind === 'window' ? 'window' : 'door'), dir: o.dir, x0: o.x0, x1: o.x1, y0: o.y0, y1: o.y1, width: q4(o.dir === 'H' ? o.x1 - o.x0 : o.y1 - o.y0) });
    if (o.wall) out.wall = o.wall;
    if (kind === 'window') { out.sill = o.sill ?? levels.windowSill; out.head = o.head ?? levels.windowHead; }
    else if (kind === 'door') { out.sill = 0; out.head = o.head ?? levels.doorHeight; }
    for (const k of ['hinge', 'swing', 'open', 'white']) { const v = o[k] ?? sp[k]; if (v !== undefined) out[k] = v; }
    if (o.connects) out.connects = o.connects;
    else {   // the spaces 0.25 m beyond each face, low side (south / west) first
      const cx = (o.x0 + o.x1) / 2, cy = (o.y0 + o.y1) / 2, h = (o.dir === 'H' ? o.y1 - o.y0 : o.x1 - o.x0) / 2 + 0.25;
      const side = s => (o.dir === 'H' ? spaceAt(cx, cy + s * h) : spaceAt(cx + s * h, cy))?.id ?? null;
      out.connects = [side(-1), side(1)];
    }
    return out;
  });

  // walls and pieces: Zillow's minus the niche walls, plus the niche and the annex, each flagged when on the outline
  const fp = outline.polygon, annexIds = new Set(overlay.walls.map(w => w.id));
  const wall = (w, source) => { const out = r4({ id: w.id, dir: w.dir, x0: w.x0, x1: w.x1, y0: w.y0, y1: w.y1, thick: w.dir === 'V' ? w.x1 - w.x0 : w.y1 - w.y0 }); out.source = source; if (onOutline(out, fp)) out.exterior = true; return out; };
  const walls = [...house.walls.filter(w => !removed.has(w.id)).map(w => wall(w, 'zillow')), ...P.niche.add.map(w => wall(w, 'niche')), ...overlay.walls.map(w => wall(w, 'annex'))];
  const extra = openings.filter(o => o.kind === 'window' && !o.wall);
  let pieces = cutOpenings(house.pieces.filter(p => !removed.has(p.wall)), extra, levels.ceiling);
  pieces.push(...P.niche.add.map(w => ({ wall: w.id, dir: w.dir, kind: 'solid', x0: w.x0, x1: w.x1, y0: w.y0, y1: w.y1, z0: 0, z1: levels.ceiling })));
  for (const w of overlay.walls) pieces.push(...wallPieces(w, openings.filter(o => annexIds.has(o.wall)), levels.ceiling));
  pieces = pieces.map(p => { const out = { wall: p.wall, dir: p.dir, kind: p.kind, ...r4({ x0: p.x0, x1: p.x1, y0: p.y0, y1: p.y1, z0: p.z0, z1: p.z1 }) }; if (onOutline(out, fp)) out.exterior = true; return out; });

  return {
    version: 1,
    note: 'Generated by web/tools/build_plan.mjs from web/data/house.json + web/data/plan_overlay.json: do not edit. Read it through web/src/plan.js or bake/scripts/plan.py.',
    frame: { plan: 'x east, y north, z up, metres (= Blender world)', scene: 'three.js world [x, z, -y]: north is -Z', toScene: [[1, 0, 0], [0, 0, 1], [0, -1, 0]] },
    viewBox: house.viewBox, levels, outline, lot: overlay.lot, site: overlay.site, volumes: overlay.volumes,
    spaces, walls, openings, pieces,
    patches: { niche: { remove: P.niche.remove, add: P.niche.add.map(w => w.id), why: P.niche.why }, windows: { resized: Object.keys(P.windows).filter(k => k !== 'why'), added: extra.map(o => o.id), why: P.windows.why } },
  };
}

// ---- validation: run on every build and by tools/test_plan.mjs ----------------------------------------------------------
export function validate(plan) {
  const err = [], ids = new Set(), byId = new Map(plan.spaces.map(s => [s.id, s]));
  const fp = plan.outline.polygon;
  for (const { edge } of plan.outline.insideMarginEdges ?? []) if (!fp.some((p, i) => { const q = fp[(i + 1) % fp.length]; return JSON.stringify([p, q]) === JSON.stringify(edge) || JSON.stringify([q, p]) === JSON.stringify(edge); })) err.push(`insideMarginEdges: ${JSON.stringify(edge)} is not an outline edge`);
  for (const s of plan.spaces) {
    if (ids.has(s.id)) err.push(`space ${s.id}: duplicate id`); ids.add(s.id);
    const P = s.polygon;
    if (!Array.isArray(P) || P.length < 4) { err.push(`space ${s.id}: polygon needs at least 4 corners`); continue; }
    if (P.some((p, i) => { const q = P[(i + 1) % P.length]; return p[0] === q[0] && p[1] === q[1]; })) err.push(`space ${s.id}: repeated vertex (polygon not closed cleanly)`);
    if (!rectilinear(P)) err.push(`space ${s.id}: an edge is not axis-aligned`);
    if (!(area(P) > 0)) err.push(`space ${s.id}: zero area`);
    if (!s.label?.en || !s.label?.zh) err.push(`space ${s.id}: needs en and zh labels`);
    if (!['interior', 'annex', 'exterior'].includes(s.zone)) err.push(`space ${s.id}: zone ${s.zone}`);
    if (s.zone !== 'exterior' && Math.abs(area(P) - overlapArea(P, fp)) > 1e-6) err.push(`space ${s.id}: not inside the outline (${(area(P) - overlapArea(P, fp)).toFixed(4)} m2 outside)`);
    if (s.kind === 'yard' && overlapArea(P, fp) > 1e-6) err.push(`yard ${s.id}: overlaps the outline`);
  }
  // spaces may touch, not overlap; yards are the ground under the outdoor zones, so they only must not overlap each other
  const layer = s => s.kind === 'yard' ? 'yard' : 'zone';
  for (let i = 0; i < plan.spaces.length; i++) for (let j = i + 1; j < plan.spaces.length; j++) {
    const a = plan.spaces[i], b = plan.spaces[j]; if (layer(a) !== layer(b)) continue;
    const o = overlapArea(a.polygon, b.polygon); if (o > 1e-6) err.push(`spaces ${a.id} and ${b.id} overlap (${o.toFixed(4)} m2)`);
  }
  const oids = new Set();
  for (const o of plan.openings) {
    if (oids.has(o.id)) err.push(`opening ${o.id}: duplicate id`); oids.add(o.id);
    const [a, b] = o.connects ?? [];
    if (!byId.has(a) || !byId.has(b)) err.push(`opening ${o.id}: connects ${JSON.stringify(o.connects)}: not two spaces`);
    else if (a === b) err.push(`opening ${o.id}: connects ${a} to itself`);
    if (o.wall && !plan.walls.some(w => w.id === o.wall)) err.push(`opening ${o.id}: wall ${o.wall} is not in the plan`);
  }
  for (const s of plan.spaces) if (s.zone !== 'exterior' && !plan.openings.some(o => o.kind !== 'window' && o.connects?.includes(s.id))) err.push(`space ${s.id}: no door or opening reaches it`);
  for (const w of plan.walls) if (!(w.x1 > w.x0 && w.y1 > w.y0)) err.push(`wall ${w.id}: empty`);
  for (const p of plan.pieces) if (!(p.x1 > p.x0 && p.y1 > p.y0 && p.z1 > p.z0)) err.push(`piece of ${p.wall}: empty`);
  // every point of the outline's interior is a space or a wall: sample a 5 cm lattice
  const b = bbox(fp);
  for (let i = Math.ceil(b.x0 * 20); i <= b.x1 * 20; i++) for (let j = Math.ceil(b.y0 * 20); j <= b.y1 * 20; j++) {
    const x = i * 50 / 1000, y = j * 50 / 1000;
    if (!inPoly(x, y, fp) || onBoundary(x, y, fp)) continue;
    if (plan.spaces.some(s => s.kind !== 'yard' && inPoly(x, y, s.polygon))) continue;
    if (plan.walls.some(w => x >= w.x0 - 0.06 && x <= w.x1 + 0.06 && y >= w.y0 - 0.06 && y <= w.y1 + 0.06)) continue;   // walls, door and seam strips
    if (plan.openings.some(o => o.kind !== 'window' && x >= o.x0 - 0.06 && x <= o.x1 + 0.06 && y >= o.y0 - 0.06 && y <= o.y1 + 0.06)) continue;
    err.push(`plan point (${x.toFixed(2)}, ${y.toFixed(2)}) is in no space and no wall`); if (err.length > 40) return err;
  }
  return err;
}

// ---- output: one record per line, so a git diff shows exactly which space, wall or opening changed --------------------
export function format(plan) {
  const lines = ['{'], keys = Object.keys(plan);
  keys.forEach((k, i) => {
    const v = plan[k], comma = i < keys.length - 1 ? ',' : '';
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') { lines.push(` ${JSON.stringify(k)}: [`); v.forEach((e, j) => lines.push(`  ${JSON.stringify(e)}${j < v.length - 1 ? ',' : ''}`)); lines.push(` ]${comma}`); }
    else lines.push(` ${JSON.stringify(k)}: ${JSON.stringify(v)}${comma}`);
  });
  return lines.join('\n') + '\n}\n';
}
export function generate() {
  const house = JSON.parse(readFileSync(join(DATA, 'house.json'), 'utf8')), overlay = JSON.parse(readFileSync(join(DATA, 'plan_overlay.json'), 'utf8'));
  const plan = buildPlan(house, overlay);
  return { plan, text: format(plan), errors: validate(plan) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { plan, text, errors } = generate();
  if (errors.length) { console.error('plan.json does not validate:\n  ' + errors.join('\n  ')); process.exit(1); }
  if (process.argv.includes('--check')) {
    let old = ''; try { old = readFileSync(PLAN_PATH, 'utf8'); } catch { /* missing */ }
    if (old !== text) { console.error('data/plan.json is stale: run node tools/build_plan.mjs'); process.exit(1); }
    console.log('plan.json up to date'); process.exit(0);
  }
  writeFileSync(PLAN_PATH, text);
  console.log(`plan.json: ${plan.spaces.length} spaces, ${plan.walls.length} walls, ${plan.openings.length} openings, ${plan.pieces.length} pieces`);
}
