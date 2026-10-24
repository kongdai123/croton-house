// Every room / "inside the house" classifier the spatial audit lists, sampled on a 5 cm plan lattice over the lot, as
// run-length label grids. The Python ones come from bake/scripts/capture_spatial.py in the same format.
//
// Sample points are integer millimetres divided by 1000, so JS and Python build bit-identical doubles; lattice points that
// fall exactly on a rule's boundary (-3.5, 3.97, 0.42, ...) therefore exercise the <= / < choice too.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const GRID = { x0: -16000, y0: -15000, step: 50, nx: 641, ny: 701 };   // mm; x -16..16 m, y -15..20 m, plan frame (+y north)
const REPO = fileURLToPath(new URL('../../../', import.meta.url));

export function encode(label) {   // label(x, y) -> string | boolean | number
  const rows = [], dict = new Map(), values = [];
  const raw = [];
  for (let j = 0; j < GRID.ny; j++) {
    const y = (GRID.y0 + j * GRID.step) / 1000, row = new Array(GRID.nx);
    for (let i = 0; i < GRID.nx; i++) { const v = String(label((GRID.x0 + i * GRID.step) / 1000, y)); row[i] = v; if (!dict.has(v)) { dict.set(v, 0); values.push(v); } }
    raw.push(row);
  }
  const labels = values.sort();
  const index = new Map(labels.map((v, i) => [v, i]));
  for (const row of raw) {
    const out = []; let prev = -1, run = 0;
    for (const v of row) { const k = index.get(v); if (k === prev) run++; else { if (run) out.push(prev, run); prev = k; run = 1; } }
    out.push(prev, run); rows.push(out);
  }
  return { labels, rows };
}
export function decode(c) {   // -> Uint16Array ny*nx of label indices
  const out = new Uint16Array(GRID.nx * GRID.ny);
  c.rows.forEach((r, j) => { let p = j * GRID.nx; for (let k = 0; k < r.length; k += 2) { out.fill(r[k], p, p + r[k + 1]); p += r[k + 1]; } });
  return out;
}

const inPoly = (x, y, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };

// Evaluate generated GLSL `float f(vec2 p) { return (<bool expr over p, vec2 and the vector comparisons>) ? 0.0 : 1.0; }`
// as JS, so the golden proves the shader text and plan.isInside agree on every lattice point.
function glslOutside(src) {
  const body = src.match(/return \((.*)\) \? 0\.0 : 1\.0;/)[1];
  if (/[^-\w\s.,()&|<>=!]/.test(body)) throw new Error('unexpected GLSL: ' + body);
  const lib = 'const vec2 = (x, y) => [x, y], all = a => a[0] && a[1], P = [x, y], cmp = f => (p, v) => [f(P[0], v[0]), f(P[1], v[1])];'
    + ' const greaterThan = cmp((a, b) => a > b), lessThan = cmp((a, b) => a < b), greaterThanEqual = cmp((a, b) => a >= b), lessThanEqual = cmp((a, b) => a <= b), p = P;';
  return new Function('x', 'y', `${lib} return (${body}) ? 0 : 1;`);
}

export function jsClassifiers(w) {
  const H = w.house;
  // the wall boxes the light-probe volume tests visibility against (lightmap.js probeWalls, scene frame), at 0.95 m
  const probeWalls = w.probeWalls(w.probeWallPieces).filter(b => b[2] <= 0.95 && 0.95 <= b[3]);
  const rect = (r, x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
  const hx = w.houseConsts;
  const label = (n) => H.notes.filter(m => m.room === n.id).map(m => m.label).join('/') || n.id.slice(0, 6);
  const zones = [['garage', hx.GARAGE], ['laundry', hx.LAUNDRY], ['walkin', hx.WALKIN], ['linen', hx.LINEN], ['porch', hx.PORCH], ['patio', hx.PATIO], ['courtA', hx.COURT_A], ['courtB', hx.COURT_B], ['drive', hx.DRIVE], ['pad', hx.PAD], ['walk', hx.WALK]];
  const garagePts = [[hx.GARAGE.x0, hx.GARAGE.y0], [hx.GARAGE.x1, hx.GARAGE.y0], [hx.GARAGE.x1, hx.LINEN.y0 - 0.114], [-4.93, hx.LINEN.y0 - 0.114], [-4.93, hx.GARAGE.y1], [hx.LAUNDRY.x1, hx.GARAGE.y1], [hx.LAUNDRY.x1, hx.LAUNDRY.y1], [hx.LAUNDRY.x0, hx.LAUNDRY.y1]];   // house.js:109 (a local of buildHouse: quoted)
  const C = [
    // [name, source, quoted?, fn(x, y)]
    ['js:roam.areaOf', 'web/src/pets/roam.js:44 (scene z = -y)', false, (x, y) => w.areaOf(x, -y)],
    ['js:roam.isIndoor', 'web/src/pets/roam.js:52', false, (x, y) => w.isIndoor(x, -y)],
    ['js:daylight.volume', 'web/src/daylight.js MIN/SIZE = plan.volumes.daylight (plan y -5.94..5.62)', false, (x, y) => { const V = w.plan.plan.volumes.daylight; return x >= V.x0 && x <= V.x1 && y >= V.y0 && y <= V.y1; }],
    ['js:grass.outdoor', 'web/src/grass.js:389 (the house test is !outdoor)', true, (x, y) => !(Math.abs(x) < 8.4 && y > -6.2 && y < 5.8)],
    ['js:house.EXT_FP', 'web/src/house.js:31 pointInPoly (minimap, pets, house.js:188)', false, (x, y) => w.pointInPoly([x, y], w.EXT_FP)],
    ['js:house.garagePts', 'web/src/house.js:109', true, (x, y) => inPoly(x, y, garagePts)],
    ['js:house.zones', 'web/src/house.js:13-28 exported rects, first match', false, (x, y) => zones.find(([, r]) => rect(r, x, y))?.[0] ?? ''],
    ['js:plan.houseRooms', 'web/tools/vpaudit.mjs:15 roomAt over house.json rooms + notes', true, (x, y) => { const r = H.rooms.find(r => inPoly(x, y, r.pts)); return r ? label(r) : 'outside'; }],
    ['js:lightmap.probeWalls@0.95m', 'web/src/lightmap.js probeWalls(PROBE_WALL_PIECES): in a wall box the probe volume treats as blocking, h 0.95', false, (x, y) => probeWalls.some(b => x >= b[0] && x <= b[1] && -y >= b[4] && -y <= b[5])],
    // the plan model (web/src/plan.js over data/plan.json): what the classifiers above are replaced by
    ['js:plan.spaceAt', 'web/src/plan.js spaceAt (exact, empty in walls)', false, (x, y) => w.plan.spaceAt(x, y)?.id ?? ''],
    ['js:plan.roomName', 'web/src/plan.js roomName (walls take the room they face)', false, (x, y) => { const r = w.plan.roomName(x, y); return r.outside ? 'outside:' + r.en : r.en; }],
    ['js:plan.isInside', 'web/src/plan.js isInside, default margin (outline + insideMargin)', false, (x, y) => w.plan.isInside(x, y)],
    ['js:plan.isInside@0', 'web/src/plan.js isInside margin 0 (the outline)', false, (x, y) => w.plan.isInside(x, y, 0)],
    ['js:plan.insideGLSL', 'web/src/plan.js insideGLSL() text, evaluated (1 = outside)', false, glslOutside(w.plan.insideGLSL())],
    ['js:plan.indoorWeight@1m', 'web/src/plan.js indoorWeight, h = 1.0', false, (x, y) => Math.round(w.plan.indoorWeight(x, y, 1.0) * 1000)],
  ];
  return C;
}

export function captureSpatialJS(w) {
  const classifiers = {};
  for (const [name, source, quoted, fn] of jsClassifiers(w)) classifiers[name] = { source, quoted: quoted || undefined, ...encode(fn) };
  return classifiers;
}

// Python side: bake/scripts/capture_spatial.py prints {classifiers, lampGroups}. `switches` = the switch records the bake exporter
// would write (bakeSwitches in objects.json) so group_of is run on the real fixtures.
export function captureSpatialPython(switches, groups) {
  const tmp = join(tmpdir(), `croton-switches-${process.pid}.json`);
  writeFileSync(tmp, JSON.stringify({ switches, groups }));
  try {
    const out = execFileSync('python3', ['-I', join(REPO, 'bake/scripts/capture_spatial.py'), '--switches', tmp], { maxBuffer: 1 << 28, encoding: 'utf8' });
    return JSON.parse(out);
  } finally { try { writeFileSync(tmp, ''); } catch { /* ignore */ } }
}

// Readable diff of two spatial documents: per classifier, how many lattice points changed, where, and what to what.
export function diffSpatial(a, b) {
  const lines = [];
  for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!a[name]) { lines.push(`classifiers: added ${name}`); continue; }
    if (!b[name]) { lines.push(`classifiers: removed ${name}`); continue; }
    const x = decode(a[name]), y = decode(b[name]);
    let n = 0; const first = [];
    for (let k = 0; k < x.length; k++) {
      const la = a[name].labels[x[k]], lb = b[name].labels[y[k]];
      if (la !== lb) { n++; if (first.length < 3) first.push(`(${(GRID.x0 + (k % GRID.nx) * GRID.step) / 1000}, ${(GRID.y0 + Math.floor(k / GRID.nx) * GRID.step) / 1000}) ${la} -> ${lb}`); }
    }
    if (n) lines.push(`classifiers: changed ${name}: ${n} of ${x.length} lattice points differ, first ${first.join('; ')}`);
  }
  return lines;
}
