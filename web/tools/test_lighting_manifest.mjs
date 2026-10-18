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
else console.log('ok   validator: every visible mesh and material resolved');

// ---- 2. deliberate fixes ------------------------------------------------------------------------------------------------
// Every decision a consumer reads from the manifest was first checked equal to the rule it replaced, for every material and
// mesh (see the commits); classify.json now records the manifest's answers. Where the manifest answers differently ON
// PURPOSE (an inconsistency of docs/audit/lighting-roles.md fixed), the old rule stays here with the number of materials /
// meshes whose answer changed and why: the count is checked, so a later change to either side shows up.
//   [kind, decision, old rule (material or mesh), manifest's rule, expected changes, why]
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

console.log(`${failed ? 'FAILED' : 'lighting manifest OK'} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
