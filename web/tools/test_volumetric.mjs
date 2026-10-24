// Volumetric light (volumetric.js, volumetric_slots.js) without a GPU: the per-slot media and their crossfade, the phase
// functions, the sky's ambient light, the feature flags, where the passes go in the composer (with and without TAA), the
// pass's CPU state.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const dir = await mkdtemp(join(tmpdir(), 'croton-volumetric-'));
try {
  const built = await build({ stdin: { contents: `
    export * from './src/volumetric_slots.js'; export { VolumetricPass, SceneDepthTap, volumePlacement, installVolume, VOLUME } from './src/volumetric.js';
    export { SLOTS } from './src/lighting_slots.js'; export { TIERS } from './src/tier.js'; export * as THREE from 'three';
  `, resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
  const file = join(dir, 'fixture.mjs'); await writeFile(file, built.outputFiles[0].contents);
  const V = await import(pathToFileURL(file)), { MEDIA, MEDIA_KEYS, PHASE, SLOTS, TIERS, THREE: T } = V;
  const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

  // ---- media per slot: every slot declared, physically plausible, beams strongest at the low sun ------------------------
  assert.deepEqual(Object.keys(MEDIA).sort(), Object.keys(SLOTS).sort());
  for (const [name, m] of Object.entries(MEDIA)) {
    for (const k of MEDIA_KEYS) assert.ok(Number.isFinite(m[k]) && m[k] >= 0, `${name}.${k}`);
    assert.ok(m.mistHeight > 0.5, `${name}: mist height`);
    // dust a beam can show in, short of a smoke machine (volumetric_slots.js: ~55% over the wall at 0.03 / m)
    assert.ok(m.dust >= 0.002 && m.dust <= 0.025, `${name}: dust ${m.dust}`);
    // ground visibility (Koschmieder, 2% contrast): mist after rain >= 150 m, otherwise a clear-air haze >= 800 m
    const visibility = 3.912 / (m.haze + m.mist);
    assert.ok(visibility >= (name === 'sunrise' ? 150 : 800), `${name}: visibility ${visibility.toFixed(0)} m`);
  }
  assert.ok(MEDIA.sunrise.mist > 4 * Math.max(MEDIA.noon.mist, MEDIA.golden.mist, MEDIA.dusk.mist), 'mist belongs to the morning after rain');
  assert.ok(MEDIA.noon.dust < MEDIA.sunrise.dust && MEDIA.noon.dust < MEDIA.golden.dust, 'beams subtle at noon');
  assert.equal(SLOTS.dusk.strength, 0, 'dusk has no sun: the sun term (and every beam) is zero there');
  for (const k of ['mist', 'dust']) assert.ok(V.ALBEDO[k] > 0.8 && V.ALBEDO[k] <= 1, `${k} albedo`);

  // ---- crossfade: endpoints, midpoint, clamping, no mutation ---------------------------------------------------------------
  assert.deepEqual(V.mediumFor('golden'), MEDIA.golden);
  assert.notEqual(V.mediumFor('golden'), MEDIA.golden, 'a copy, never the table');
  assert.deepEqual(V.mediumFor('nowhere'), MEDIA.sunrise);
  for (const [a, b] of [['sunrise', 'noon'], ['golden', 'dusk'], ['dusk', 'sunrise']]) {
    for (const k of MEDIA_KEYS) {
      close(V.mediumFor(a, b, 0)[k], MEDIA[a][k], 1e-12, `${a}->${b} t=0 ${k}`);
      close(V.mediumFor(a, b, 1)[k], MEDIA[b][k], 1e-12, `${a}->${b} t=1 ${k}`);
      close(V.mediumFor(a, b, 0.5)[k], (MEDIA[a][k] + MEDIA[b][k]) / 2, 1e-12, `${a}->${b} t=0.5 ${k}`);
      close(V.mediumFor(a, b, 7)[k], MEDIA[b][k], 1e-12, `${a}->${b} clamped ${k}`);
    }
  }
  const before = JSON.stringify(MEDIA); V.blendMedia(MEDIA.sunrise, MEDIA.noon, 0.3); assert.equal(JSON.stringify(MEDIA), before);

  // ---- phase functions: normalised over the sphere, forward-peaked, a beam seen from the side still shows ---------------
  const integrate = p => { let s = 0; const n = 20000; for (let i = 0; i < n; i++) { const mu = -1 + (i + 0.5) * 2 / n; s += V.phase(mu, p) * 2 * Math.PI * (2 / n); } return s; };
  for (const [k, p] of Object.entries(PHASE)) {
    close(integrate(p), 1, 0.01, `${k} phase integral`);
    const forward = V.phase(Math.cos(20 * Math.PI / 180), p), side = V.phase(0, p);
    assert.ok(forward / side > 5 && forward / side < 40, `${k}: forward/side ${(forward / side).toFixed(1)}`);
  }
  close(V.hg(0.3, 0), 1 / (4 * Math.PI), 1e-12, 'g = 0 is isotropic');

  // ---- outdoor ambient from the sky -----------------------------------------------------------------------------------------
  const sky = (w, h, f) => { const data = new Float32Array(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = f(x, y); data.set([v, v, v, 1], (y * w + x) * 4); } return { width: w, height: h, data }; };
  // uniform radiance 1 above: the sphere's mean is 1/2 from the sky + 1/2 x ground (albedo x pi x 1 / pi)
  const uniform = V.skyAmbient(sky(256, 128, () => 1));
  for (const c of uniform) close(c, 0.5 + 0.5 * V.GROUND_ALBEDO, 0.01, 'uniform sky ambient');
  // a sun disc in the panorama is clipped (the live sun is added on its own)
  const disc = V.skyAmbient(sky(256, 128, (x, y) => (x === 40 && y === 50 ? 1e6 : 1)));
  for (const c of disc) close(c, 0.5 + 0.5 * V.GROUND_ALBEDO, 0.02, 'sun disc clipped');
  // the sun lights the ground the mist sits over
  const sunny = V.skyAmbient(sky(256, 128, () => 1), { el: 30, strength: 10, color: [1, 1, 1] });
  close(sunny[0] - uniform[0], 0.5 * V.GROUND_ALBEDO * 10 * 0.5 / Math.PI, 0.01, 'ground lit by the sun');
  // half floats as HDRLoader stores them
  const half = { width: 64, height: 32, data: new Uint16Array(64 * 32 * 4).fill(T.DataUtils.toHalfFloat(2)) };
  for (const c of V.skyAmbient(half, undefined, T.DataUtils.fromHalfFloat)) close(c, 2 * (0.5 + 0.5 * V.GROUND_ALBEDO), 0.02, 'half-float sky');
  assert.equal(V.skyAmbient(null), null); assert.equal(V.skyAmbient({ width: 2, height: 1 }), null);

  // ---- feature flags: the query wins over the tier ------------------------------------------------------------------------
  assert.equal(V.featureWanted('?shafts', 'shafts', TIERS.mobile), true);
  assert.equal(V.featureWanted('?shafts=0', 'shafts', TIERS.hq), false);
  assert.equal(V.featureWanted('?taa=0.75', 'taa', TIERS.mobile), true);
  assert.equal(V.featureWanted('?taa=0', 'taa', TIERS.hq), false);
  for (const [name, t] of Object.entries(TIERS)) {
    assert.equal(V.featureWanted('', 'shafts', t), name === 'hq', `${name}: volumetric light on hq only`);
    assert.equal(V.featureWanted('', 'taa', t), name === 'hq' && !!TIERS.hq.taa, `${name}: TAA`);
  }

  // ---- placement in the composer, with and without TAA ----------------------------------------------------------------------
  const pass = name => ({ name, ...(name === 'render' ? { isRenderPass: true } : name === 'output' ? { isOutputPass: true } : {}) });
  const composer = names => ({ passes: names.map(pass), insertPass(p, i) { this.passes.splice(i, 0, p); }, removePass(p) { const i = this.passes.indexOf(p); if (i >= 0) this.passes.splice(i, 1); } });
  const names = c => c.passes.map(p => p.name);
  const volume = { name: 'volume', tap: { name: 'tap' } };
  const main = composer(['render', 'ssr', 'gtao', 'output', 'grade', 'smaa']);
  const remove = V.installVolume(main, volume);
  assert.deepEqual(names(main), ['tap', 'render', 'ssr', 'gtao', 'volume', 'output', 'grade', 'smaa']);
  remove(); assert.deepEqual(names(main), ['render', 'ssr', 'gtao', 'output', 'grade', 'smaa']);
  // TAA's internal chain (taa.js createTAA: everything before the OutputPass), contact shadows already at its head
  const internal = composer(['contact', 'render', 'ssr', 'gtao']);
  V.installVolume(internal, volume);
  assert.deepEqual(names(internal), ['contact', 'tap', 'render', 'ssr', 'gtao', 'volume']);
  // TAA created after the volume: its splice of the linear chain carries both passes along, in order
  const late = composer(['render', 'ssr', 'gtao', 'output']); V.installVolume(late, volume);
  const moved = late.passes.splice(0, late.passes.findIndex(p => p.isOutputPass));
  assert.deepEqual(moved.map(p => p.name), ['tap', 'render', 'ssr', 'gtao', 'volume']);
  assert.throws(() => V.volumePlacement([pass('output')]), /RenderPass/);

  // ---- the pass on the CPU: slot media, crossfade, overrides, history resets ------------------------------------------------
  const shadow = { uniforms: { uSunDepth: { value: null }, uSunTexel: { value: 1 / 4096 } }, matrix: new T.Matrix4(), version: 0 };
  const sun = new T.DirectionalLight(0xffffff, 20); sun.target.position.set(0, 0, 0); sun.position.set(30, 10, -20);
  const camera = new T.PerspectiveCamera(62, 16 / 9, 0.05, 300);
  let state = { current: 'sunrise' };
  const vol = new V.VolumetricPass({ camera, sun, shadow, state: () => state });
  assert.equal(vol.enabled, true); assert.equal(vol.needsSwap, true);
  assert.deepEqual(vol.update(), MEDIA.sunrise);
  state = { current: 'sunrise', next: 'noon', t: 0.25 };
  close(vol.update().mist, MEDIA.sunrise.mist * 0.75 + MEDIA.noon.mist * 0.25, 1e-12, 'crossfade in the pass');
  state = { current: 'golden', next: null, t: 0.8 };   // a stale t without a fade is ignored
  assert.deepEqual(vol.update(), MEDIA.golden);
  vol.params.dust = 0.01; assert.equal(vol.update().dust, 0.01, 'explicit parameter wins'); delete vol.params.dust;
  // the sky's ambient follows the slot's sky texture, blended through the fade
  const skyA = { image: sky(64, 32, () => 1) }, skyB = { image: sky(64, 32, () => 3) };
  state = { current: 'sunrise', sky: skyA }; vol.update(); const a = vol.sky.x;
  state = { current: 'sunrise', next: 'noon', t: 0.5, sky: skyA, nextSky: skyB }; vol.update(); const mid = vol.sky.x;
  state = { current: 'noon', sky: skyB }; vol.update(); const b = vol.sky.x;
  assert.ok(a > 0 && b > a && mid > a && mid < b, `sky ambient ${a} ${mid} ${b}`);
  state = { current: 'dusk' }; vol.update(); assert.equal(vol.sky.length(), 0, 'no sky texture: no ambient');
  vol.valid = true; vol.enabled = false; vol.enabled = true; assert.equal(vol.valid, false, 're-enabling drops the history');
  vol.valid = true; vol.setSize(100, 50); assert.equal(vol.valid, false, 'a resize drops the history');
  assert.deepEqual([vol.current.width, vol.current.height], [50, 25], 'half resolution by default');
  vol.params.resolution = 0.25; vol.setSize(100, 50); assert.deepEqual([vol.current.width, vol.current.height], [25, 13]);
  assert.ok(vol.tap instanceof V.SceneDepthTap && vol.tap.needsSwap === false);
  vol.tap.render(null, null, { depthTexture: 'scene depth' }); assert.equal(vol.tap.depth, 'scene depth');
  vol.dispose();
  assert.ok(V.VOLUME.steps >= 16 && V.VOLUME.steps <= 64 && V.VOLUME.history < 1 && V.VOLUME.historyStill < 1);
} finally { await rm(dir, { recursive: true, force: true }); }

// Glass and the sun depth on the real house: test_scene_invariants.mjs, invariant glass-casts-no-sun.
console.log('volumetric ok');
