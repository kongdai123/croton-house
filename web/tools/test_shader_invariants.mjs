// Invariants of the composed baked shader on the real house (tools/harness/baked.mjs), no GPU:
//   - nothing wraps a baked material: every Standard / Physical material the walk draws (scene, mirrors' reflected
//     scenes, the puddle reflection) has the composed hook itself;
//   - dispose (the legacy fallback) gives every material its hook, key and own-shader record back.
import assert from 'node:assert/strict';
import { buildBakedScene } from './harness/baked.mjs';

const pre = new Map();
const b = await buildBakedScene({ tier: 'hq', name: 'invariants', before: w => w.scene.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) if (m && !pre.has(m)) pre.set(m, { hook: m.onBeforeCompile, key: m.customProgramCacheKey, own: m.ownShader }); }) });
const { world: w, baked } = b;
const drawn = () => {
  const all = new Set();
  w.scene.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) if (m?.isMeshStandardMaterial && !m.isFogVolumeMaterial) all.add(m); });
  for (const r of b.mirrors) r.userData.reflection?.scene.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) if (m?.isMeshStandardMaterial) all.add(m); });
  for (const e of baked.puddleRefl?.sources ?? []) for (const m of [].concat(e.proxy.material)) if (m?.isMeshStandardMaterial) all.add(m);
  return all;
};
const unwrapped = () => [...drawn()].filter(m => !m.onBeforeCompile?.bakedComposed).map(m => m.name || m.type);

// every material composed, none wrapped
assert.deepEqual(unwrapped(), []);
const keys = drawn(), warn = console.warn;

// dispose: the pre-bake hooks, keys and own-shader records are back, on every material that was in the scene
console.warn = () => {};
try { baked.dispose(); } finally { console.warn = warn; }
const wrong = [];
w.scene.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) {
  const p = pre.get(m); if (!p) continue;
  if (m.onBeforeCompile !== p.hook || m.customProgramCacheKey !== p.key || m.ownShader !== p.own || m.onBeforeCompile?.bakedComposed) wrong.push(m.name || m.type);
} });
assert.deepEqual([...new Set(wrong)], []);
console.log(`shader invariants: ${keys.size} composed materials, no wrappers; dispose restored ${pre.size} materials OK`);
