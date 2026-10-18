// The lighting manifest (web/src/lighting_roles.js) on the real house, built headless (tools/harness/scene.mjs):
//   1. the validator finds nothing (every visible mesh and material resolved, no contradictory declaration);
//   2. characterisation: every decision a consumer reads from the manifest gives the answer today's rule gives
//      (golden/classify.json documents those rules), for every material and mesh. A decision whose answer was changed on
//      purpose is listed in CHANGED with the number of objects it changed and why.
//   node web/tools/test_lighting_manifest.mjs
import { buildRealScene } from './harness/scene.mjs';
import { indexScene, materialKey } from './harness/objects.mjs';
import { captureClassify } from './harness/classify.mjs';

const t0 = performance.now();
const w = await buildRealScene(), ix = indexScene(w), today = captureClassify(w, ix);
const { roles } = w, L = roles.lightingOf;
const mats = o => [].concat(o.material ?? []).filter(Boolean);
let failed = 0;
const fail = msg => { failed++; console.log('FAIL ' + msg); };

// ---- 1. validator ----------------------------------------------------------------------------------------------------
const errors = roles.validateLighting(w.scene);
if (errors.length) fail(`validator: ${errors.length} errors\n  ${errors.slice(0, 12).join('\n  ')}`);
else console.log('ok   validator: every visible mesh and material resolved');

// ---- 2. characterisation -------------------------------------------------------------------------------------------------
// [decision, today's answer from classify.json (undefined = false), the manifest's answer]
const MATERIAL = [
  ['unwrapSkip', c => !!c.unwrapSkip, m => L(m).bake === 'probe'],
  ['glassCycles', c => !!c.glassCycles, m => L(m).glass?.export === 'pane'],
  ['sheer', c => !!c.sheer, m => !!L(m).sheer],
];
const MESH = [
  ['mirrorFace', c => !!c.mirrorFace, o => mats(o).some(m => L(m).reflection === 'mirror')],
  ['unwrapSkip', c => !!c.unwrapSkip, o => mats(o).length > 0 && mats(o).every(m => L(m).bake === 'probe')],
];
// A decision leaves these tables when its consumer reads the manifest: classify.json then records the manifest's answer.
// Decisions changed on purpose: [decision, count of materials / meshes whose answer changed, why].
const CHANGED = {
};


const check = (kind, table, items) => {
  for (const [name, old, now] of table) {
    const diffs = [];
    for (const [key, node, c] of items) {
      const a = old(c, node), b = now(node, c);
      if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`${key}: today ${JSON.stringify(a)}, manifest ${JSON.stringify(b)}`);
    }
    const expect = CHANGED[`${kind}.${name}`];
    if (expect && diffs.length === expect[0]) { console.log(`ok   ${kind}.${name}: ${diffs.length} changed on purpose (${expect[1]})`); continue; }
    if (!diffs.length && !expect) { console.log(`ok   ${kind}.${name}`); continue; }
    fail(`${kind}.${name}: ${diffs.length} differ${expect ? ` (expected ${expect[0]})` : ''}\n  ${diffs.slice(0, 8).join('\n  ')}`);
  }
};
const matItems = [], seenMat = new Map();
for (const { node: o } of ix.meshes) for (const m of mats(o)) if (!seenMat.has(m)) { const k = materialKey(m); seenMat.set(m, k); matItems.push([k, m, today.materials[k]]); }
check('material', MATERIAL, matItems);
check('mesh', MESH, ix.meshes.map(({ key, node }) => [key, node, today.meshes[key]]));

// ---- 3. switches: lamp groups and wall plates pass the manifest's checks ----------------------------------------------------
{
  const plates = w.scene.children.filter(c => c.name?.startsWith('wall-switch-') && c.userData.lightSwitch);
  const errs = roles.validateSwitches(w.switches, plates);
  if (errs.length) fail(`switches: ${errs.length} errors\n  ${errs.slice(0, 8).join('\n  ')}`); else console.log(`ok   switches: ${w.switches.length} switches, ${plates.length} plates, one group each`);
}

console.log(`${failed ? 'FAILED' : 'lighting manifest OK'} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
