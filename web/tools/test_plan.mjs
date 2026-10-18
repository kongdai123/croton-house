// The plan model: data/plan.json is what tools/build_plan.mjs builds from house.json + plan_overlay.json, it validates, the
// validator catches broken plans, and web/src/plan.js reproduces the shared test vectors (golden/plan_vectors.json) that
// bake/scripts/test_plan.py runs against plan.py.
//   node tools/test_plan.mjs                    check
//   UPDATE_VECTORS=1 node tools/test_plan.mjs   rewrite golden/plan_vectors.json from plan.js (review the diff)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generate, validate, PLAN_PATH } from './build_plan.mjs';
import { importSrc } from './harness/util.mjs';

const VECTORS = fileURLToPath(new URL('./golden/plan_vectors.json', import.meta.url));
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed++; console.log('FAIL ' + msg); } };

// 1. fresh and valid
const { plan, text, errors } = generate();
check(!errors.length, 'plan does not validate:\n  ' + errors.join('\n  '));
check(readFileSync(PLAN_PATH, 'utf8') === text, 'data/plan.json is stale: run node tools/build_plan.mjs');

// 2. the validator catches what it claims to
const broken = (fn) => { const p = structuredClone(plan); fn(p); return validate(p); };
const has = (errs, re) => errs.some(e => re.test(e));
check(has(broken(p => { p.spaces.find(s => s.id === 'office').polygon[0][0] += 0.5; }), /overlap|axis-aligned/), 'validator misses an overlapping / skewed space');
check(has(broken(p => { const s = p.spaces.find(s => s.id === 'hallCloset'); s.polygon = s.polygon.map(([x, y]) => [x + 0.3, y]); }), /not inside the outline/), 'validator misses a space outside the outline');
check(has(broken(p => { p.openings[0].connects = ['kitchen', 'nowhere']; }), /not two spaces/), 'validator misses a dangling opening');
check(has(broken(p => { p.spaces.find(s => s.id === 'kitchen').polygon.push([-0.7872, -4.606]); }), /repeated vertex|axis-aligned/), 'validator misses an unclosed polygon');
check(has(broken(p => { p.spaces = p.spaces.filter(s => s.id !== 'hallCloset'); p.openings = p.openings.filter(o => !o.connects.includes('hallCloset')); }), /in no space and no wall/), 'validator misses a hole in the plan');

// 3. the reader against the shared vectors
const P = await importSrc('src/plan.js');
const r9 = v => Math.round(v * 1e9) / 1e9;
function vectors() {
  const pts = [];
  for (let i = -32; i <= 32; i++) for (let j = -30; j <= 40; j++) pts.push([i / 2, j / 2]);
  // boundaries and decided edges: office / dining, the vestibule nub, bedroom B's nub, the hall strip, garage notch, porch
  pts.push([1.1185, 3], [1.12, 3], [1.1, 3], [0.42, 3], [-4.5, 1.2], [-4.5, 0.7], [4.5, 1.5], [4.5, 1.6], [4.03, 0.2], [4.03, 0.75], [-4.93, -0.714], [-4.9, -0.65], [-4.2, -0.3],
    [-3.5, -5.2], [-3.45, -5.2], [3.95, -5.2], [4.0, -5.2], [8.1, 0], [8.15, 0], [-8.1, 0], [0, 5.55], [0, -4.8], [-6.5, 0.2], [-6.3, 1.0], [6.0, -1.7], [3.7, 2.8], [-6.3, 2.0], [0, 0], [-100, -100], [200, 0]);
  const margins = [0, null, plan.outline.insideMargin, 0.15];   // null: the default (insideMargin with its per-edge exceptions)
  return {
    note: 'Shared test vectors for web/src/plan.js and bake/scripts/plan.py (generated from plan.js by UPDATE_VECTORS=1 node web/tools/test_plan.mjs).',
    margins,
    points: pts.map(([x, y]) => [x, y, P.spaceAt(x, y)?.id ?? null, P.spaceAt(x, y, 0.3)?.id ?? null, P.roomName(x, y).en, P.roomName(x, y).zh, P.roomName(x, y).outside,
      ...margins.map(m => P.isInside(x, y, m)), r9(P.outlineDistance(x, y)), r9(P.indoorWeight(x, y, 1.0)), r9(P.indoorWeight(x, y, 2.8))]),
    columns: ['x', 'y', 'spaceAt', 'spaceAt near 0.3', 'roomName.en', 'roomName.zh', 'roomName.outside', ...margins.map(m => `isInside margin ${m}`), 'outlineDistance', 'indoorWeight h 1.0', 'indoorWeight h 2.8'],
    wallsAt: Object.fromEntries([0.35, 0.95, 1.3, 1.55, 2.2, 2.44].map(z => [z, P.wallsAt(z).map(p => P.pieces.indexOf(p))])),
    neighbors: Object.fromEntries(P.spaces.map(s => [s.id, P.neighbors(s.id)])),
    otherSide: Object.fromEntries(P.openings.map(o => { const cx = (o.x0 + o.x1) / 2, cy = (o.y0 + o.y1) / 2, d = o.dir === 'H' ? [0, 1] : [1, 0]; return [o.id, [P.otherSide(o.id, cx - d[0], cy - d[1])?.id, P.otherSide(o.id, cx + d[0], cy + d[1])?.id]]; })),
    rectOf: Object.fromEntries(['garage', 'laundry', 'walkin', 'linen', 'porch', 'patio'].map(id => [id, P.rectOf(id)])),
    insideShape: Object.fromEntries(margins.map(m => [m, P.insideShape(m)])),
    insideGLSL: Object.fromEntries(margins.map(m => [m, P.insideGLSL('outsideHouse', m)])),
    toScene: [P.toScene(1, 2, 3), P.toPlan(1, 3, -2)],
  };
}
const fresh = JSON.parse(JSON.stringify(vectors()));
if (process.env.UPDATE_VECTORS) {
  writeFileSync(VECTORS, JSON.stringify(fresh, null, 0).replace(/\],\[/g, '],\n[') + '\n');
  console.log(`plan_vectors.json written: ${fresh.points.length} points`);
} else {
  const golden = JSON.parse(readFileSync(VECTORS, 'utf8'));
  for (const k of Object.keys(golden)) {
    if (k === 'points') {
      let bad = 0;
      golden.points.forEach((g, i) => { if (JSON.stringify(g) !== JSON.stringify(fresh.points[i])) { if (bad++ < 5) console.log(`  point ${i}: golden ${JSON.stringify(g)} plan.js ${JSON.stringify(fresh.points[i])}`); } });
      check(!bad && golden.points.length === fresh.points.length, `plan.js differs from plan_vectors.json at ${bad} points`);
    } else check(JSON.stringify(golden[k]) === JSON.stringify(fresh[k]), `plan.js differs from plan_vectors.json in ${k}`);
  }
}
// 3b. the specialised outline distance equals the general edge loop everywhere (random points, edges and corners)
{
  const { chebyshev, inPoly } = await importSrc('src/plan_geom.js');
  const O = plan.outline.polygon, xs = [...new Set(O.map(p => p[0]))], ys = [...new Set(O.map(p => p[1]))];
  let bad = 0, seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const probe = (x, y) => { const d = chebyshev(x, y, O), want = inPoly(x, y, O) ? d : -d; if (P.outlineDistance(x, y) !== want && bad++ < 3) console.log(`  outlineDistance(${x}, ${y}) = ${P.outlineDistance(x, y)}, edge loop ${want}`); };
  for (let k = 0; k < 200000; k++) probe(rnd() * 24 - 12, rnd() * 24 - 12);
  for (const x of xs) for (const y of ys) for (const dx of [-0.2, -1e-9, 0, 1e-9, 0.2]) for (const dy of [-0.2, -1e-9, 0, 1e-9, 0.2]) probe(x + dx, y + dy);
  check(!bad, `outlineDistance differs from the edge loop at ${bad} points`);
}
// 4. the hot path stays cheap: indoorWeight (every frame) under 0.5 us per distinct call. Best of five runs: the suite runs
// tests in parallel, and load only ever adds time, so the fastest run measures the code, not the machine.
{
  let s = 0, best = Infinity;
  for (let run = 0; run < 5; run++) {
    const t0 = performance.now();
    for (let k = 0; k < 200000; k++) s += P.indoorWeight((k % 160) / 10 - 8, (k % 110) / 10 - 5.5, 1.2);
    best = Math.min(best, (performance.now() - t0) / 200000 * 1000);
  }
  check(best < 0.5 && s > 0, `indoorWeight ${best.toFixed(3)} us per call (best of 5)`);
}
console.log(failed ? `FAILED (${failed})` : `plan OK: ${plan.spaces.length} spaces, ${plan.walls.length} walls, ${plan.openings.length} openings, vectors ${fresh.points.length} points`);
process.exit(failed ? 1 : 0);
