// The lighting manifest (web/src/lighting_roles.js) on the real house, built headless (tools/harness/scene.mjs):
//   1. the validator finds nothing (every visible mesh and material resolved, no contradictory declaration);
//   2. the deliberate fixes: each old rule against the manifest's, with the number of objects whose answer changed;
//   3. switches: every switch in one lamp group, one plate per group, members agreeing on their default slots.
//   node web/tools/test_lighting_manifest.mjs
import { buildRealScene } from './harness/scene.mjs';
import { indexScene, materialKey } from './harness/objects.mjs';

const t0 = performance.now();
const w = await buildRealScene(), ix = indexScene(w);
const { roles } = w;
const mats = o => [].concat(o.material ?? []).filter(Boolean);
let failed = 0;
const fail = msg => { failed++; console.log('FAIL ' + msg); };

// ---- 1. validator ----------------------------------------------------------------------------------------------------
const errors = roles.validateLighting(w.scene);
if (errors.length) fail(`validator: ${errors.length} errors\n  ${errors.slice(0, 12).join('\n  ')}`);
else console.log('ok   validator: every visible mesh and material resolved, every role declared');
{ // and it does catch what it is for: an undeclared mesh, an undeclared see-through material, a fixture in a fixture
  const T = w.T, probe = new T.Scene(), bare = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial());
  const jar = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial({ transparent: true, opacity: 0.3 })); jar.userData.lighting = { role: 'furniture' };
  const lamp = new T.Group(); lamp.userData.lighting = { role: 'fixture', fixture: { kind: 'lamp' } };
  const bulb = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial()); bulb.userData.lighting = { fixture: { kind: 'lamp' } }; lamp.add(bulb);
  probe.add(bare, jar, lamp); roles.classifyLighting(probe);
  const e = roles.validateLighting(probe), want = ['no declared role', 'see-through', 'inside two fixture declarations'];
  const missing = want.filter(k => !e.some(x => x.includes(k)));
  if (missing.length) fail(`validator misses: ${missing.join(', ')} (${e.join('; ')})`); else console.log('ok   validator: rejects an undeclared role, an undeclared see-through material, nested fixtures');
}

// ---- 2. deliberate fixes ------------------------------------------------------------------------------------------------
// Every decision a consumer reads from the manifest was first checked equal to the rule it replaced, for every material and
// mesh (see the commits); classify.json now records the manifest's answers. Where the manifest answers differently ON
// PURPOSE (an inconsistency of docs/audit/lighting-roles.md fixed), the old rule stays here with the number of materials /
// meshes whose answer changed and why: the count is checked, so a later change to either side shows up.
//   [kind, decision, old rule (material or mesh), manifest's rule, expected changes, why]
const faceShared = new Set();   // the old rule: the probe-lit materials of every face mesh, for every mesh using them
w.scene.traverse(o => { if (o.isMesh && roles.meshLighting(o).probeSide === 'face') for (const m of [].concat(o.material ?? [])) if (m && !m.lightMap && !m.transparent && !(m.transmission > 0)) faceShared.add(m); });
const L = roles.lightingOf, R = roles.meshLighting, plantSurface = m => ['foliage', 'leafCard'].includes(L(m).surface);
const FIXES = [
  // 1. an alpha mask is not a plant (audit section 3, item 1: alphaTest > 0 counted as foliage everywhere)
  ['material', 'foliage', m => m.alphaTest > 0 || plantSurface(m), m => !!L(m).foliage, 14, 'non-plant cut-outs lose the plant treatment'],
  ['material', 'wet', m => m.alphaTest > 0 || L(m).surface === 'leafCard' ? 'dry' : 'auto', m => L(m).wet, 14, 'non-plant cut-outs may take the wet-ground patch'],
  ['material', 'weather', m => m.alphaTest > 0 || L(m).surface === 'leafCard' ? 'plant' : 'auto', m => L(m).weather, 14, 'non-plant cut-outs take the outdoor / ground after-rain rule'],
  ['mesh', 'sunTrack', o => R(o).role === 'plant' || [].concat(o.material ?? []).some(m => m && (m.alphaTest > 0 || plantSurface(m))), o => R(o).sun.track === 'plant', 19, 'non-plant cut-outs may be promoted to the moving sun casters'],
  // 2. one glass definition (audit section 3, item 2: four tests in the site, three in the bake)
  ['material', 'castsSun', m => !(m.transmission > 0 || m.userData.daylightOpacity !== undefined || (m.transparent && m.opacity < 0.6)), m => L(m).castsSun, 2, 'glass blocks no sun: the declared glass (the kitchen oil bottle at opacity 0.6), and no presentation helper does (the flame)'],
  ['material', 'lightmap', m => !(m.alphaTest > 0 || ['foliage', 'leafCard'].includes(L(m).surface) || (!m.isShaderMaterial && (!!m.userData.sheer || m.userData.daylightOpacity !== undefined || m.transmission > 0))), m => L(m).bake === 'lightmap', 11, 'every glass is probe-lit, not only what the export made transmissive'],
  ['material', 'windowOverlay', m => m.userData.daylightOpacity !== undefined || m.transmission > 0, m => !!L(m).glass?.overlay, 0, 'only window panes take the overlay'],
  ['material', 'clearGlass', m => m.userData.daylightOpacity !== undefined, m => L(m).glass?.export === 'pane', 0, 'only window panes become clear glass in the bake'],
  // 3. the sided probe lookup is a mesh's (audit section 3, item 9: per material, a door leaf's material shared with a static
  // mesh switched both to the 0.5 m outward lookup)
  ['mesh', 'sided', o => [].concat(o.material ?? []).some(m => m && faceShared.has(m)), o => R(o).probeSide === 'face' && [].concat(o.material ?? []).some(m => m && !m.lightMap && !m.transparent && !(m.transmission > 0)), 932, 'only door leaves, blinds and curtains take the outward lookup: 932 meshes sharing their materials no longer do (frames, trim, baseboards, can rings in the shades\' white; most are lightmapped, where the flag never applied; 961 before the 29 baseboards under the stucco skin went)'],
];
const items = { material: [], mesh: ix.meshes.map(({ key, node }) => [key, node]) };
{ const seen = new Set(); for (const { node: o } of ix.meshes) for (const m of mats(o)) if (!seen.has(m)) { seen.add(m); items.material.push([materialKey(m), m]); } }
for (const [kind, name, old, now, expected, why] of FIXES) {
  const diffs = items[kind].filter(([, x]) => JSON.stringify(old(x)) !== JSON.stringify(now(x))).map(([k, x]) => `${k}: ${JSON.stringify(old(x))} -> ${JSON.stringify(now(x))}`);
  if (diffs.length === expected) console.log(`ok   fix ${kind}.${name}: ${diffs.length} changed (${why})`);
  else fail(`fix ${kind}.${name}: ${diffs.length} changed, expected ${expected}\n  ${diffs.slice(0, 8).join('\n  ')}`);
}

// ---- 3. switches: lamp groups and wall plates pass the manifest's checks ----------------------------------------------------
{
  const plates = w.scene.children.filter(c => c.name?.startsWith('wall-switch-') && c.userData.lightSwitch);
  const errs = roles.validateSwitches(w.switches, plates);
  if (errs.length) fail(`switches: ${errs.length} errors\n  ${errs.slice(0, 8).join('\n  ')}`); else console.log(`ok   switches: ${w.switches.length} switches, ${plates.length} plates, one group each`);
}

// ---- 4. emission levels: the one rule each path uses (lighting_roles.js) ----------------------------------------------------
{
  const { glowLevel, lightLevel, bakedEmission, standInEmission } = roles, g = { base: 2 }, wash = { base: 0.4, wash: true };
  const light = (exterior, day) => ({ userData: { exterior, day } });
  const table = [
    [glowLevel(g, { dusk: true }), 3.6], [glowLevel(g, { day: true }), 2], [glowLevel(g), 0.12], [glowLevel(wash, { dusk: true }), 0.4],
    [glowLevel(g, { baked: true, level: 0.5 }), 1.8], [glowLevel(wash, { baked: true, level: 0.5 }), 0.2],
    [lightLevel(light(true), { dusk: false }), 0], [lightLevel(light(true), { dusk: true }), 1], [lightLevel(light(true), { manual: true }), 1],
    [lightLevel(light(false), { dusk: true }), 5], [lightLevel(light(false, 2.5), { indoor: 1 }), 2.5], [lightLevel(light(false), { indoor: 0 }), 0], [lightLevel(light(false), { indoor: 0, manual: true }), 0.2],
    [standInEmission(1, true), 1.8], [standInEmission(1, false), 0.12],
    [bakedEmission({ emits: { kind: 'lamp', switched: false } }, { emissiveIntensity: 9 }, 2, 0.25), 0.5],
    [bakedEmission({ emits: { kind: 'lamp', switched: true } }, { emissiveIntensity: 9 }, 2, 0.25), 9],
    [bakedEmission({ emits: { kind: 'fire', switched: false } }, { emissiveIntensity: 1.3 }, 2, 0.25), 1.3],
  ];
  const bad = table.map(([a, b], i) => Math.abs(a - b) > 1e-9 ? `row ${i}: ${a} != ${b}` : null).filter(Boolean);
  if (bad.length) fail(`emission levels: ${bad.join('; ')}`); else console.log(`ok   emission levels: ${table.length} cases`);
}

console.log(`${failed ? 'FAILED' : 'lighting manifest OK'} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
