// Browser-free policy and transition fixtures. Fetch and renderer are local stubs; no network or GPU.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const policy = await readFile(new URL('../src/lighting_slots.js', import.meta.url), 'utf8');
const { SLOTS, SLOT_ORDER, discoverSlots, initialSlot, nextSlot, blendSlot, slotRequests } = await import(`data:text/javascript;base64,${Buffer.from(policy).toString('base64')}`);
const encoding = { K: { slot: 0.2, lamps: 0.1 } };
const requests = [];
const fetcher = async url => { requests.push(url); return { ok: url.includes('/sunrise/'), json: async () => encoding }; };
assert.deepEqual(await discoverSlots('assets/lightmaps', null, fetcher), ['sunrise']);
assert.equal(requests.length, 4);
assert.equal(initialSlot('dusk', ['sunrise']), 'sunrise');
assert.equal(nextSlot('sunrise', ['sunrise']), 'sunrise');
assert.equal(nextSlot('noon', ['dusk', 'sunrise', 'noon']), 'dusk');
const manifest = Object.fromEntries([...SLOT_ORDER].reverse().map(s => [`v2/${s}/encoding.json`, `v2/${s}/encoding.hash.json`]));
assert.deepEqual(await discoverSlots('assets/lightmaps', manifest, () => { throw Error('manifest must prevent probing'); }), SLOT_ORDER);
assert.deepEqual(await discoverSlots('assets/lightmaps', {}, fetcher), ['sunrise']);   // an empty manifest (dev checkout) probes like a missing one
assert.deepEqual(await discoverSlots('', null, async url => {
  if (url.includes('sunrise')) return { ok: true, json: async () => encoding };
  if (url.includes('noon')) return { ok: true, json: async () => ({ K: { slot: NaN, lamps: 1 } }) };
  if (url.includes('golden')) throw Error('offline');
  return { ok: true, json: async () => { throw Error('bad JSON'); } };
}), ['sunrise']);
const mid = blendSlot(SLOTS.sunrise, SLOTS.dusk, 0.5);
assert.equal(mid.lamps, 0.625); assert.equal(mid.wet, 0.5); assert.equal(mid.ev, -0.35);
for (const [k, v] of Object.entries(blendSlot(SLOTS.noon, SLOTS.golden, 1))) assert.deepEqual(v, SLOTS.golden[k]);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(setImmediate);
const loaded = [], begun = [], released = [];
let gate = deferred();
const queue = slotRequests({ available: SLOT_ORDER, current: 'sunrise', load: async name => { loaded.push(name); await gate.promise; return { name }; }, begin: async d => { begun.push(d.name); }, release: d => released.push(d.name) });
const first = queue.request('noon'); queue.request('golden'); gate.resolve(); await first;
assert.deepEqual(loaded, ['noon', 'golden']); assert.deepEqual(begun, ['golden']); assert.deepEqual(released, ['noon']);
const single = slotRequests({ available: ['sunrise'], current: 'sunrise', load() { throw Error('sunrise-only must not load'); }, begin() {}, release() {} });
assert.equal(await single.request('dusk'), false); assert.equal(await single.request('sunrise'), true);
const failed = slotRequests({ available: SLOT_ORDER, current: 'sunrise', load: async () => { throw Error('missing destination'); }, begin() { throw Error('must stay untouched'); }, release() {} });
await assert.rejects(failed.request('dusk'), /missing destination/);
// Bake/runtime values must agree, while the original sunrise calibration stays fixed.
const { execFileSync } = await import('node:child_process');
for (const name of SLOT_ORDER) {
  const cfg = JSON.parse(execFileSync('python3', [fileURLToPath(new URL('../../bake/scripts/slots.py', import.meta.url)), name], { encoding: 'utf8' }));
  for (const k of ['az', 'el', 'strength', 'color']) assert.deepEqual(cfg.sun[k], SLOTS[name][k]);
  for (const k of ['ev', 'wet', 'lamps']) assert.equal(cfg[k], SLOTS[name][k]);
  assert.deepEqual(cfg.autoExposure, SLOTS[name].autoExposure);
}
assert.deepEqual(SLOTS.sunrise, { az: 58, el: 8, strength: 20, color: [1, 0.68, 0.45], skyColor: [0.42, 0.52, 0.72], ev: -0.7, autoExposure: { minEV: -0.5, maxEV: 3.5 }, wet: 1, lamps: 0.25 });
const dir = await mkdtemp(join(tmpdir(), 'croton-slots-'));
try {
  const built = await build({ stdin: { contents: "export { createSlotRuntime } from './src/lightmap_slots.js'; export { bakeFoliage } from './src/foliage_bake.js'; export * as THREE from 'three';", resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
  const file = join(dir, 'fixture.mjs'); await writeFile(file, built.outputFiles[0].contents);
  const { createSlotRuntime, bakeFoliage, THREE: T } = await import(pathToFileURL(file));
  const disposed = [], restored = [], begunFoliage = [], finishedFoliage = [];
  const texture = (name, image = { width: 2, height: 1 }) => {
    const t = new T.Texture(image); t.name = name; t.addEventListener('dispose', () => disposed.push(name));
    t.userData.restore = () => restored.push(name); return t;
  };
  const data = name => ({ name, enc: structuredClone(encoding), resolution: 'half',
    layers: [texture(name + '/slot'), texture(name + '/lamps')], sky: texture(name + '/sky'),
    refl: { count: 1, uniforms: { uReflTex: { value: texture(name + '/refl') },
      uReflPos: { value: new Float32Array([0, 1, 0]) }, uReflMin: { value: new Float32Array([-1, 0, -1]) }, uReflMax: { value: new Float32Array([1, 2, 1]) }, uReflMips: { value: 1 } } },
    volume: { uniforms: { uProbeSH: { value: texture(name + '/probe') } }, fill() {} }, foliage: { name },
  });
  const initial = data('sunrise'), scene = new T.Scene(), commits = [], params = [], renders = [];
  let fail = '', pendingLoad = null;
  const renderer = { getRenderTarget: () => null, setRenderTarget(t) { renders.push(t); }, render() {} };
  const runtime = createSlotRuntime({ scene, renderer, initial, available: SLOT_ORDER,
    disposeAtlas: t => t.dispose(),
    foliage: { stage(f) { return { begin() { begunFoliage.push(f.name); }, finish() { finishedFoliage.push(f.name); } }; } },
    load: async (name, res) => { if (pendingLoad) await pendingLoad.promise; if (fail) throw Error(fail); return { ...data(name), resolution: res ?? 'half' }; },
    setParams: p => params.push(p), commit: d => commits.push(d.name),
  });
  const originalSky = scene.background, originalSlot = initial.layers[0];
  fail = 'missing slot'; await assert.rejects(runtime.request('noon'), /missing slot/);
  assert.equal(scene.background, originalSky); assert.equal(initial.layers[0], originalSlot); assert.deepEqual(begunFoliage, []);
  fail = ''; pendingLoad = deferred(); const noon = runtime.request('noon'); await tick();
  runtime.update(0.75); assert.equal(runtime.uniforms.uSlotBlend.value, 0); assert.deepEqual(commits, []);
  pendingLoad.resolve(); pendingLoad = null; await tick();
  assert.deepEqual(begunFoliage, ['noon']);
  runtime.update(0.75); assert.equal(runtime.uniforms.uSlotBlend.value, 0.5);
  assert.equal(params.at(-1).wet, 0.5); assert.equal(params.at(-1).lamps, 0.125); assert.equal(commits.length, 0);
  runtime.update(0.75); await noon;
  assert.equal(runtime.name, 'noon'); assert.equal(runtime.uniforms.uSlotBlend.value, 0);
  assert.deepEqual(commits, ['noon']); assert.equal(scene.background.name, 'noon/sky');
  assert.deepEqual(finishedFoliage, ['noon']); assert.equal(disposed.length, 0); // previous retained
  const dusk = runtime.request('dusk'); await tick(); runtime.update(1.5); await dusk;
  assert.equal(runtime.name, 'dusk'); assert.equal(runtime.params.lamps, 1); assert.equal(runtime.params.strength, 0);
  assert.ok(disposed.includes('sunrise/slot')); // only two slots retained
  // a quality change releases the snapshot at the old resolution as soon as the new one is current
  const noonDisposed = disposed.includes('noon/slot');
  const quality = runtime.setQuality('quarter'); await tick(); runtime.update(1.5); await quality;
  assert.equal(runtime.name, 'dusk'); assert.equal(disposed.filter(n => n === 'dusk/slot').length, 1); assert.equal(disposed.includes('noon/slot'), true);
  assert.equal(noonDisposed, false);
  const shader = { uniforms: {}, fragmentShader: 'vec4 probeSH( vec3 uvw, float ch ) { return probeTex( uProbeSH, uvw, ch ); }', vertexShader: 'vFoliage = vec3( decoded, foliage.z ); }' };
  runtime.patchProbe(shader); runtime.patchFoliage(shader);
  assert.equal(shader.uniforms.uProbeBlend, runtime.uniforms.uSlotBlend);
  assert.ok(shader.fragmentShader.includes('probeTex( uProbeNextSH, uvw, ch )')); assert.equal((shader.fragmentShader.match(/sampler3D/g) ?? []).length, 1); assert.ok(shader.vertexShader.includes('uSlotLampA * vFoliage.y'));
  runtime.combine(0.6); assert.equal(runtime.uniforms.uSlotLampA.value, 0.6);
  runtime.dispose(); assert.equal(new Set(disposed).size, 15);   // dusk's names twice: both resolutions
  assert.equal(disposed.length, 20); // 5 textures per slot snapshot (one packed probe volume): sunrise, noon, dusk at half and quarter
  // Match and stage actual foliage attributes without touching the active encoded layer until commit.
  globalThis.location = { search: '' };
  const plantScene = new T.Scene(), plantMaterial = new T.MeshStandardMaterial(); plantMaterial.name = 'plant-fixture';
  const plantGeometry = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute([10, 0, 0, 11, 0, 0, 10, 1, 0], 3));
  const plant = new T.Mesh(plantGeometry, plantMaterial); plant.userData.lmId = 'plant'; plantScene.add(plant);
  const header = value => ({ K: { slot: 0.2, lamps: 0.1 }, units: [{ id: 'plant', m: 'plant-fixture', vc: 3, min: [10, 0, 0], max: [11, 1, 0], slot: new Uint8Array(3).fill(value), lamps: new Uint8Array(3).fill(64), sun: new Uint8Array(3).fill(255) }] });
  const plantVolume = { multi: true, fill() {} };
  const fol = await bakeFoliage(plantScene, '', plantVolume, header(64));
  const activeAttribute = plantGeometry.getAttribute('foliage');
  const folStage = fol.stage(header(128)); assert.equal(activeAttribute.array[0], 64);
  const previousNext = plantGeometry.getAttribute('foliageNext').array[0];
  folStage.begin(); assert.equal(activeAttribute.array[0], 64); assert.ok(plantGeometry.getAttribute('foliageNext').array[0] > previousNext);
  folStage.finish(); assert.equal(activeAttribute.array[0], 128);
  assert.throws(() => fol.stage({ K: header(1).K, units: [] }), /coverage differs/);
  fol.dispose(); assert.equal(plant.material, plantMaterial); assert.equal(plantGeometry.getAttribute('foliage'), undefined); assert.equal(plantGeometry.getAttribute('foliageNext'), undefined);
  console.log('lighting slots: manifest/probe discovery, sunrise-only policy, bake parity, latest request, atomic failure, linear fade midpoint/endpoints, two-slot ownership, probe/foliage shader hooks OK');
} finally { await rm(dir, { recursive: true, force: true }); }
