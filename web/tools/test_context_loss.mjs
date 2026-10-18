// A WebGL context lost and restored at any point of the start must neither crash it nor leave a null for later code to
// dereference (postmortem row 20). Node only: the real createLighting, the real Pets on the real house, the real startup
// guard; the GPU is a fake whose context can be lost between any two calls, PMREM and the HDR loader are stubs that obey it.
//   - stages: loss at each step of main.js's start (lighting created, sky loaded, time applied, pets relit, warm-up, first
//     draw, the other sky) and after it, restored at once / while the start waits / long after it finished;
//   - class checks: no HDR path at all (the old syncPet read sky.target.texture on null), a failed HDR download, a
//     restore that finds the context lost again, a restore after a context created lost (renderConfig re-read);
//   - main.js still routes the non-essential steps through the guard.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildRealScene } from './harness/scene.mjs';

const WEB = fileURLToPath(new URL('../', import.meta.url));
const tick = (ms = 2) => new Promise(r => setTimeout(r, ms));

// ---- the fake GPU: one flag decides whether anything works --------------------------------------------------------------
const fx = { lost: false, hdr: true, hdrFails: 0, loseOnLoad: false, loseOnConvolve: 0, convolves: 0, rooms: 0, canvas: null };
const lose = () => { fx.lost = true; fx.canvas.dispatchEvent(new Event('webglcontextlost')); };
const restore = () => { fx.lost = false; fx.canvas.dispatchEvent(new Event('webglcontextrestored')); };

const stubs = { name: 'context-fakes', setup(b) {
  b.onLoad({ filter: /\/RGBELoader\.js$/ }, () => ({ loader: 'js', contents: `import { Texture } from 'three';
    export class RGBELoader { setDataType() { return this; } async loadAsync(url) {
      const fx = globalThis.__ctxFx; await Promise.resolve();
      if (fx.hdrFails > 0) { fx.hdrFails--; throw new Error('HDR download failed'); }
      if (fx.loseOnLoad) { fx.loseOnLoad = false; globalThis.__ctxLose(); }
      return new Texture({ width: 4, height: 2, data: new Uint16Array(32) }); } }` }));
  b.onResolve({ filter: /^three$/ }, () => ({ path: 'three-fake-pmrem', namespace: 'ctxfake' }));
  b.onLoad({ filter: /.*/, namespace: 'ctxfake' }, () => {
    const real = JSON.stringify(fileURLToPath(new URL('../node_modules/three/build/three.module.js', import.meta.url)));
    return { resolveDir: WEB, loader: 'js', contents: `export * from ${real}; import { WebGLRenderTarget } from ${real};
      // like three's: nothing throws on a lost context, the result is just empty; ?throw makes it throw instead.
      const make = kind => { const fx = globalThis.__ctxFx; if (fx.lost && fx.throwOnLost) throw new Error('context lost'); const t = new WebGLRenderTarget(2, 1); t.texture.userData.kind = kind; t.texture.userData.lostWhenMade = fx.lost; return t; };
      export class PMREMGenerator {
        compileEquirectangularShader() {}
        fromEquirectangular() { const fx = globalThis.__ctxFx; fx.convolves++; const t = make('sky'); if (fx.loseOnConvolve > 0) { fx.loseOnConvolve--; globalThis.__ctxLose(); } return t; }
        fromScene() { const fx = globalThis.__ctxFx; fx.rooms++; return make('room'); }
        dispose() {} }` };
  });
} };

function fakeRenderer() {
  const canvas = new EventTarget(); fx.canvas = canvas;
  const gl = {
    FRAMEBUFFER: 1, FRAMEBUFFER_COMPLETE: 2, RENDERBUFFER: 3, RGBA16F: 4, RGBA8: 5, SAMPLES: 6,
    isContextLost: () => fx.lost, getExtension: () => (fx.lost || !fx.hdr ? null : {}), getInternalformatParameter: () => [4, 2],
    checkFramebufferStatus: () => (fx.lost ? 0 : 2), bindFramebuffer() {},
  };
  const own = { domElement: canvas, getContext: () => gl, getRenderTarget: () => null, setRenderTarget() {}, resetState() {}, properties: { get: () => ({}) }, capabilities: { maxSamples: 4, maxTextureSize: 4096, getMaxAnisotropy: () => 8 } };
  return { renderer: new Proxy(own, { get: (o, k) => (k in o ? o[k] : k === 'then' ? undefined : deep), set: (o, k, v) => { o[k] = v; return true; } }), canvas, gl };
}
const deep = new Proxy(function () {}, { get: (t, k) => k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : deep, set: () => true, apply: () => deep });

globalThis.__ctxFx = fx; globalThis.__ctxLose = () => lose();
const world = await buildRealScene({ variant: 'ctx', plugins: [stubs], extra: "export { Pets } from './src/pets/roam.js'; export { createGuard } from './src/startup_guard.js';" });
const { T, Pets, house, layout, createGuard } = world;

// What main.js does with the GPU, in its order, through the same guard; `at(stage)` is where the test may cut the context.
async function start({ stage = null, lossKind = 'wait', hdr = true, throwOnLost = false } = {}) {
  Object.assign(fx, { lost: false, hdr, hdrFails: 0, loseOnLoad: false, loseOnConvolve: 0, convolves: 0, rooms: 0, throwOnLost });
  const { renderer, canvas, gl } = fakeRenderer();
  const logs = [], scene = new T.Scene(), camera = new T.PerspectiveCamera();
  const guard = createGuard({ canvas, isLost: () => gl.isContextLost(), log: (...a) => logs.push(a.join(' ')), defer: fn => setTimeout(fn, 0) });
  const soft = guard.soft;
  // lossKind: 'wait' = restored while a waitForContext holds the start; 'late' = after the whole start; 'never-waited' = at the
  // moment the loss happens a restore is already queued behind the current step
  const at = name => { if (name === stage) { if (name === 'sky') fx.loseOnConvolve = 1; else lose(); if (lossKind === 'queued') setTimeout(restore, 1); } };
  const wait = async () => { if (fx.lost && lossKind === 'wait') setTimeout(restore, 1); return guard.waitForContext(lossKind === 'late' ? 20 : 2000); };
  const state = { dusk: false, ready: false };
  let drew = 0, pets = null;
  await wait();
  at('create');
  const lighting = world.createLighting(renderer, scene, camera, house, { name: 'laptop', hq: false });
  let petsRef = null;
  const applyTime = async () => {
    await soft('lighting.applyTime', () => lighting.applyTime(state.dusk));
    soft('pets relight', () => petsRef?.relight());
  };
  at('sky');
  await soft('sky', () => lighting.loadSky(state.dusk));
  at('applyTime');
  await applyTime();
  at('pets');
  pets = petsRef = new Pets({ scene: world.scene, player: { camera, pos: new T.Vector3() }, layout, camera, lighting, seed: 3 });
  soft('pets relight', () => pets.relight());
  state.ready = true;
  at('warm');
  await wait();
  at('draw');
  await wait();
  soft('frame', () => { lighting.update(0.016); drew++; });
  at('other');
  soft('other sky', () => lighting.prepareTime(!state.dusk, async () => {}));
  await tick(5);
  at('frames');
  for (let i = 0; i < 12; i++) { soft('frame', () => { lighting.update(0.016); soft('pets', () => pets.relight()); drew++; }); await tick(1); }
  at('toggle');
  state.dusk = !state.dusk; await applyTime();
  // the loss/restore may come last: after everything
  if (fx.lost) { restore(); }
  await tick(15);
  // restored for good: every consumer is valid again and the pets can be lit indoors and out
  state.dusk = false; await applyTime(); await tick(5);
  const mat = pets.agents[0].mats[0];
  const label = `stage ${stage}/${lossKind}/${hdr ? 'hdr' : 'ldr'}`;
  assert.deepEqual(logs, [], `${label}: a step failed (would have aborted the start): ${logs.join(' | ')}`);
  assert.ok(state.ready && drew > 0, `${label}: the start did not finish`);
  for (const indoor of [true, false]) {
    lighting.syncPet(mat, indoor);
    if (hdr) assert.ok(mat.envMap, `${label}: a pet lit ${indoor ? 'inside' : 'outside'} has no environment after the restore`);
  }
  assert.equal(lighting.renderConfig.hdr, hdr, `${label}: renderConfig not re-read after the restore`);
  if (hdr) {
    assert.ok(scene.environment, `${label}: no scene environment after the restore`);
    assert.ok(!scene.environment.userData?.lostWhenMade, `${label}: environment is from the lost context`);
  }
  for (const a of pets.agents) world.scene.remove(a.root);
  return { lighting, scene, logs, fx: { ...fx } };
}

// ---- 1. every stage, three kinds of restore ----------------------------------------------------------------------------
const STAGES = ['create', 'sky', 'applyTime', 'pets', 'warm', 'draw', 'other', 'frames', 'toggle'];
let runs = 0;
for (const stage of STAGES) for (const lossKind of ['wait', 'late', 'queued']) { await start({ stage, lossKind }); runs++; }
await start({ stage: null }); runs++;
// the same with a PMREM that throws on a lost context instead of returning an empty target
for (const stage of ['create', 'sky', 'applyTime']) { await start({ stage, lossKind: 'wait', throwOnLost: true }); runs++; }

// ---- 2. the class ---------------------------------------------------------------------------------------------------------
{ // no HDR path (no float colour buffers): sky.target and every room are null forever. syncPet used to read sky.target.texture.
  const { lighting } = await start({ hdr: false }); runs++;
  assert.equal(lighting.renderConfig.hdr, false);
}
{ // a context created lost reports no float buffers; the restore must re-read it and rebuild the composer path
  const { lighting } = await start({ stage: 'create', lossKind: 'wait' }); runs++;
  assert.equal(lighting.renderConfig.hdr, true, 'config stayed on the byte path after the restore');
}
{ // the restore itself finds the context lost again: stays pending, no throw, the next restore completes
  const { renderer, canvas } = fakeRenderer(); Object.assign(fx, { lost: false, hdr: true, hdrFails: 0, loseOnLoad: false, loseOnConvolve: 0, throwOnLost: false });
  const scene = new T.Scene(), camera = new T.PerspectiveCamera();
  const lighting = world.createLighting(renderer, scene, camera, house, { name: 'laptop', hq: false });
  await lighting.applyTime(false);
  const before = scene.environment; assert.ok(before);
  lose(); canvas.dispatchEvent(new Event('webglcontextrestored'));   // restore event while gl still reports lost
  assert.doesNotThrow(() => lighting.update(0.016, true));
  assert.equal(scene.environment, null, 'a sky convolved on a lost context must stay pending (null), not bound');
  await lighting.applyTime(false);
  const mat = new T.MeshStandardMaterial(); lighting.attachPet(mat);
  assert.doesNotThrow(() => { lighting.syncPet(mat, true); lighting.syncPet(mat, false); });
  restore(); assert.ok(scene.environment, 'the second restore did not rebuild the environment'); assert.notEqual(scene.environment, before, 'the restore kept the environment of the lost context');
  lighting.syncPet(mat, true); assert.ok(mat.envMap);
  runs++;
}
{ // a failed HDR download is not cached: the next applyTime loads it again
  const { renderer } = fakeRenderer(); Object.assign(fx, { lost: false, hdr: true, hdrFails: 1 });
  const scene = new T.Scene(), lighting = world.createLighting(renderer, scene, new T.PerspectiveCamera(), house, { name: 'laptop', hq: false });
  await assert.rejects(lighting.loadSky(false), /HDR download failed/);
  await lighting.applyTime(false); assert.ok(scene.environment, 'the sky was not retried after a failed download');
  runs++;
}

// ---- 3. the guard itself ---------------------------------------------------------------------------------------------------
{
  const canvas = new EventTarget(); let lostNow = false; const logs = [];
  const g = createGuard({ canvas, isLost: () => lostNow, log: (...a) => logs.push(a.join(' ')), defer: fn => setTimeout(fn, 0) });
  assert.equal(g.soft('x', () => { throw new Error('boom'); }), undefined);
  g.soft('x', () => { throw new Error('boom'); });
  assert.equal(logs.length, 1, 'logged once per label');
  await g.soft('y', async () => { throw new Error('async boom'); }); assert.equal(logs.length, 2);
  assert.deepEqual(g.queued, [], 'a failure with a live context is not retried');
  let runsAfter = 0; lostNow = true; canvas.dispatchEvent(new Event('webglcontextlost'));
  g.soft('z', () => { runsAfter++; if (lostNow) throw new Error('lost'); });
  assert.deepEqual(g.queued, ['z']);
  lostNow = false; canvas.dispatchEvent(new Event('webglcontextrestored')); await tick(5);
  assert.equal(runsAfter, 2, 'retried once after the restore'); assert.deepEqual(g.queued, []);
  lostNow = true; const p = g.waitForContext(20); assert.equal(await p, false, 'a context that never returns does not hold the load');
  const q = g.waitForContext(1000); lostNow = false; canvas.dispatchEvent(new Event('webglcontextrestored')); assert.equal(await q, true);
}

// ---- 4. main.js keeps its non-essential steps behind the guard --------------------------------------------------------------
{
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  for (const must of [
    "soft('lighting.applyTime'", "soft('pets relight'", "soft('onTime'", "soft('other sky'", "soft('frame'", "soft('pets.update'", "soft('mirrors'",
    "soft('contact shadows'", "soft('baked features'", "soft('sky'",
  ]) assert.ok(main.includes(must), `main.js no longer guards ${must}`);
  assert.ok((main.match(/guard\.waitForContext\(\)/g) ?? []).length >= 4, 'main.js waits for the context before the capability probe, lighting, warm-up and first draw');
  assert.ok(!/^\s*pets\?\.relight\(\);/m.test(main), 'pets.relight is called bare again');
  assert.ok(!/^\s*await lighting\.loadSky\(/m.test(main), 'loadSky is awaited bare again');
}
console.log(`context loss: ${runs} simulated starts (loss at ${STAGES.join(', ')}; restored while waiting / late / queued; throwing PMREM; no HDR path), restore re-reads the composer config, failed HDR retried, guard retries once, main.js guarded OK`);
