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
const { roles } = w, L = roles.lightingOf, R = roles.meshLighting;
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
  ['foliage', c => !!c.foliage, m => !!L(m).foliage],
  ['leafSide', c => !!c.leafSide, m => L(m).twoSided === 'faceDirection'],
  ['wetEligible', c => !!c.wetEligible, m => L(m).wet === 'auto'],
  ['wetPuddles', c => !!c.wetPuddles, m => !!m.isMeshStandardMaterial && !m.isFogVolumeMaterial && L(m).wet === 'auto'],
  ['unwrapSkip', c => !!c.unwrapSkip, m => L(m).bake === 'probe'],
  ['glassShadow', c => !!c.glassShadow, m => !L(m).castsSun],
  ['glassOverlay', c => !!c.glassOverlay, m => !!L(m).glass?.overlay],
  ['glassCycles', c => !!c.glassCycles, m => L(m).glass?.export === 'pane'],
  ['emitsLight', c => !!c.emitsLight, m => !!L(m).emits],
  ['mirror', c => !!c.mirror, m => L(m).reflection === 'mirror'],
  ['sheer', c => !!c.sheer, m => !!L(m).sheer],
  ['occl', c => !!c.occl, m => !!L(m).foliage?.groundOcclusion],
];
const MESH = [
  ['weather', c => c.weather ?? null, o => R(o).weather],
  ['interior', c => !!c.interior, o => R(o).zone === 'interior' && !mats(o).some(m => L(m).zone === 'exterior')],
  ['puddleTier', c => c.puddleTier ?? 0, (o, c) => c.puddleTier === undefined ? 0 : o.isInstancedMesh || mats(o).some(m => L(m).foliage) ? 1 : w.puddlesIndoors(boxOf(o)) ? 2 : 0],
  ['presentation', (c, o) => !!c.presentation || !!o.isReflector, o => R(o).role === 'presentation'],
  ['bakedFoliagePlant', c => !!c.bakedFoliagePlant, o => o.isMesh && !o.isInstancedMesh && !Array.isArray(o.material) && !!o.geometry?.attributes.position && !!L(o.material)?.foliage?.bakedPerVertex],
  ['sided', c => !!c.sided, o => mats(o).some(m => sided.has(m))],
  ['doorPart', c => !!c.doorPart, o => R(o).why === 'door'],
  ['pcssPlant', c => !!c.pcssPlant, o => R(o).sun.track === 'plant'],
  ['mirrorFace', c => !!c.mirrorFace, o => mats(o).some(m => L(m).reflection === 'mirror')],
  ['unwrapSkip', c => !!c.unwrapSkip, o => mats(o).length > 0 && mats(o).every(m => L(m).bake === 'probe')],
  ['contactExcluded', c => !!c.contactExcluded, o => mats(o).some(m => !L(m).contact)],
  ['lmSkip movable', (c, o) => o.userData.lmSkip === 'movable', o => R(o).motion === 'movable' && labelled(o)],
  // invisible helpers (switch hit proxies) are never exported: only what is drawn
  ['lmId', (c, o) => !!o.userData.lmId && shown(o), o => !!o.userData.lmId && shown(o) && ['static', 'still', 'door'].includes(R(o).motion)],
];
// Decisions changed on purpose: [decision, count of materials / meshes whose answer changed, why].
const CHANGED = {
  'mesh.pcssPlant': [1, "a cell's merged mesh of potted-plant parts reads its members' role (plant); it holds still, so the PCSS promotion it guards never applies"],
};

const T = w.T, box = new T.Box3();
const boxOf = o => { box.makeEmpty(); box.expandByObject(o, true); return box; };
const sided = new Set();
for (const { node: o } of ix.meshes) if (R(o).probeSide === 'face') for (const m of mats(o)) if (!m.lightMap && !m.transparent && !(m.transmission > 0)) sided.add(m);
const shown = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
const labelled = o => o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && !!o.geometry?.attributes.position;

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

console.log(`${failed ? 'FAILED' : 'lighting manifest OK'} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
