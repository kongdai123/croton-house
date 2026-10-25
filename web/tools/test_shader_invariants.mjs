// Invariants of the composed baked shader. No GPU.
//   - static: no file outside web/src/shaders hooks a material's compile or edits shader text, except the allow-list
//     below (every entry is a material's own shader, the legacy raster lighting, or a program that is not a baked
//     material), with the number of such sites in it: a new site fails until it is listed with its reason;
//   on the real house (tools/harness/baked.mjs):
//   - nothing wraps a baked material: every Standard / Physical material the walk draws (scene, mirrors' reflected
//     scenes, the puddle reflection) has the composed hook itself;
//   - every flag set the house compiles is one of the enumerated ones (harness/flag_space.mjs, all of which
//     test_shader_compose.mjs composes and checks);
//   - a quality change recompiles nothing: starting on laptop and switching to hq (the puddle reflection appears)
//     leaves every material's cache key and version as they were (the planar puddle's ground is decided at load);
//   - dispose (the legacy fallback) gives every material its hook, key and own-shader record back.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBakedScene } from './harness/baked.mjs';
import { enumerateFlags } from './harness/flag_space.mjs';

// ---- static: who may touch shader text -------------------------------------------------------------------------------
// Sites: an onBeforeCompile read or write, a ShaderChunk read, an assignment to / replace on / append to a vertex or
// fragment shader, a shaderReplace. A plain copy of a hook to a material's copy (`c.onBeforeCompile = m.onBeforeCompile`)
// is not a site: copies carry the composed hook (baked_material.js isBaked) and never wrap it.
const ALLOWED = {
  'auto_exposure.js': [3, 'the OutputPass (a post-processing pass, not a material): exposure from the meter texture'],
  'local_adapt.js': [3, 'the OutputPass and the Blender AgX material (post-processing): local adaptation'],
  'photo.js': [2, 'the path tracer\'s own material (photo mode): its firefly clamp'],
  'lighting.js': [16, 'the legacy raster lighting (the fallback when the bake cannot load): the tone-mapping chunk, its lights chunk, the per-material raster wrapper (HQ shadow, lights, daylight) and the pets\' raster light; it records each material\'s own hook as its ownShader, which the baked shader starts from'],
  'daylight.js': [13, 'the legacy raster lighting\'s daylight volume (called from lighting.js\'s raster wrapper only)'],
  'hq.js': [9, 'the legacy raster HQ shadow chunk; the mirror\'s Reflector (its own ShaderMaterial); the mirrors\' merged material, which keeps a baked source\'s composed hook with the surface option, or (legacy fallback) wraps the raster hook with compose.js surfacePatch'],
  'taa.js': [5, 'TAA\'s texture LOD bias for the legacy raster materials (baked ones: the taa flag)'],
  'motion.js': [2, 'TAA\'s motion vectors: their own velocity material (a ShaderMaterial, not drawn in the scene) runs a moving material\'s vertex hook on three\'s chunks, twice (this frame, the previous one)'],
  'lightmap.js': [1, 'the sun-depth material takes its hook from baked_material.js sunDepthShader'],
  'materials.js': [6, 'own shader hooks: the turf\'s macro noise, the shell white (they run first inside the composed shader)'],
  'reflections.js': [4, 'own shader hook: the SSR tag in the alpha (it runs first inside the composed shader)'],
  'grass.js': [8, 'own shader hook: the garden blades\' wind, normals and normal pass'],
  'furniture/plants_parts.js': [6, 'own shader hook: the leaves\' soft normals and normal pass'],
  'furniture/garage.js': [5, 'own shader hook: the garage door skin\'s indirect light behind the opening'],
  'pets/cat.js': [8, 'own shader hooks: the cat\'s fur shells and eye lids'],
  'pets/dog.js': [5, 'own shader hook: the dog\'s fur shells'],
};
const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const SITE = /onBeforeCompile|ShaderChunk|(?:fragment|vertex)Shader\s*(?:=(?!=)|\.replace|\+=)|shaderReplace\(|\brep\(/g;
const COPY = /\b[\w.]+\.onBeforeCompile = [\w.]+\.onBeforeCompile\b/g;
const files = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]);
const found = {};
for (const f of files(SRC).filter(f => f.endsWith('.js'))) {
  const rel = relative(SRC, f).split('\\').join('/');
  if (rel.startsWith('shaders/') || rel.startsWith('webgpu/')) continue;   // the composer; the WebGPU path ignores hooks
  const n = readFileSync(f, 'utf8').split('\n').reduce((a, l) => a + (l.replace(/\/\/.*$/, '').replace(COPY, '').match(SITE) ?? []).length, 0);
  if (n) found[rel] = n;
}
const unlisted = Object.entries(found).filter(([f, n]) => ALLOWED[f]?.[0] !== n).map(([f, n]) => `${f}: ${n} sites (allowed ${ALLOWED[f]?.[0] ?? 0})`);
const gone = Object.keys(ALLOWED).filter(f => !found[f]).map(f => `${f}: listed, no sites left`);
assert.deepEqual([...unlisted, ...gone], [], 'shader text edited outside web/src/shaders (list the site with its reason, or move it into the composer)');


const pre = new Map();
const b = await buildBakedScene({ tier: 'laptop', name: 'invariants', before: w => w.scene.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) if (m && !pre.has(m)) pre.set(m, { hook: m.onBeforeCompile, key: m.customProgramCacheKey, own: m.ownShader }); }) });
const { world: w, baked } = b;
const drawn = () => {
  const all = new Set();
  w.scene.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) if (m?.isMeshStandardMaterial && !m.isFogVolumeMaterial) all.add(m); });
  for (const r of b.mirrors) r.userData.reflection?.scene.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) if (m?.isMeshStandardMaterial) all.add(m); });
  for (const e of baked.puddleRefl?.sources ?? []) for (const m of [].concat(e.proxy.material)) if (m?.isMeshStandardMaterial) all.add(m);
  return all;
};
const unwrapped = () => [...drawn()].filter(m => !m.onBeforeCompile?.bakedComposed).map(m => m.name || m.type);

// laptop: no puddle reflection yet; every material composed, none wrapped
assert.equal(baked.puddleRefl, null);
assert.deepEqual(unwrapped(), []);
// the house's flag sets are enumerated ones (with its reflection probes and lamp groups)
const flagKeys = new Set([...drawn()].map(m => /\|(?:probe|baked)-v4:(.*)$/.exec(m.customProgramCacheKey())?.[1]).filter(Boolean));
const reflOf = k => { const r = /:r(\d+)s?(?:l(\d+)\.(\d+))?:/.exec(k); return r ? { count: +r[1], ...(r[2] ? { lamps: { count: +r[2], max: +r[3] } } : {}) } : null; };
const refl = [...new Map([...flagKeys].map(reflOf).filter(Boolean).map(r => [JSON.stringify(r), r])).values()];
const lampGroups = [...new Set([...flagKeys].map(k => +(/^l\w\dg(\d+):/.exec(k)?.[1] ?? 0)).filter(Boolean))];
const space = new Set([...enumerateFlags({ bakedFeatures: w.bakedFeatures, samplerPlan: w.samplerPlan, refl, lampGroups }).values()].map(f => w.flagsKey(f)));
const outside = [...flagKeys].filter(k => !space.has(k));
assert.deepEqual(outside, [], 'flag sets the house compiles that the enumeration (and so test_shader_compose.mjs) misses');
const keys = new Map([...drawn()].map(m => [m, { key: m.customProgramCacheKey(), version: m.version }]));
// to hq: the reflection is built (its own copies are new materials) and the scene's materials are left as they were
const warn = console.warn; console.warn = () => {};
try { baked.setFeatures('hq'); } finally { console.warn = warn; }
assert.ok(baked.puddleRefl && baked.puddleRefl.sources.length > 0);
const changed = [...keys].filter(([m, k]) => m.customProgramCacheKey() !== k.key || m.version !== k.version).map(([m]) => m.name || m.type);
assert.deepEqual(changed, [], 'a quality change recompiled ' + changed.length + ' materials');
assert.ok([...keys.keys()].some(m => w.materialOptions(m).planarPuddle), 'the ground shows the planar puddle from the start');
assert.deepEqual(unwrapped(), []);

// dispose: the pre-bake hooks, keys and own-shader records are back, on every material that was in the scene
console.warn = () => {};
try { baked.dispose(); } finally { console.warn = warn; }
const wrong = [];
w.scene.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) {
  const p = pre.get(m); if (!p) continue;
  if (m.onBeforeCompile !== p.hook || m.customProgramCacheKey !== p.key || m.ownShader !== p.own || m.onBeforeCompile?.bakedComposed) wrong.push(m.name || m.type);
} });
assert.deepEqual([...new Set(wrong)], []);
console.log(`shader invariants: no shader text outside the composer beyond ${Object.keys(ALLOWED).length} listed files; ${keys.size} composed materials, no wrappers, ${flagKeys.size} flag sets all enumerated; laptop -> hq recompiled none; dispose restored ${pre.size} materials OK`);
