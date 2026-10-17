// The plan model: data/plan.json is what tools/build_plan.mjs builds from house.json + plan_overlay.json, it validates, and
// the validator catches broken plans.
//   node tools/test_plan.mjs
import { readFileSync } from 'node:fs';
import { generate, validate, PLAN_PATH } from './build_plan.mjs';

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

console.log(failed ? `FAILED (${failed})` : `plan OK: ${plan.spaces.length} spaces, ${plan.walls.length} walls, ${plan.openings.length} openings`);
process.exit(failed ? 1 : 0);
