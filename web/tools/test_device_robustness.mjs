// CPU fixtures only: framebuffer outcomes, linking/yields, budgets and photo ownership. No GL/browser/network.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../', import.meta.url)), dir = await mkdtemp(join(tmpdir(), 'croton-device-'));
try {
  const built = await build({ stdin: { contents: `export * as T from 'three'; export * from './src/render_targets.js';
    export * from './src/shader_warmup.js'; export * from './src/photo_budget.js'; export { PhotoMode } from './src/photo.js'; export { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';`, resolveDir: root },
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
  const file = join(dir, 'fixture.mjs'); await writeFile(file, built.outputFiles[0].contents);
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => 'en' }, configurable: true });
  globalThis.location = { search: '' };
  const { T, composerConfig, warmPrograms, photoSize, PhotoMode, OutputPass } = await import(pathToFileURL(file));
  for (const tier of ['mobile', 'laptop', 'hq']) for (const memory of [1, 4, 16]) {
    const [w, h] = photoSize([3840, 2160], { maxTextureSize: 4096 }, tier, memory);
    assert.ok(w * h * 120 <= Math.min({ mobile: 160, laptop: 512, hq: 1024 }[tier], Math.max(64, memory * 128)) * 1024 ** 2);
    assert.ok(Math.abs(w / h - 16 / 9) < 0.01);
  }
  assert.deepEqual(photoSize([3840, 2160], { maxTextureSize: 512 }, 'hq', 16), [512, 288]);
  assert.deepEqual(photoSize([3840, 2160], { maxTextureSize: 4096, maxRenderbufferSize: 256 }, 'hq', 16), [256, 144]);
  assert.deepEqual(photoSize([320, 180], { maxTextureSize: 4096 }, 'mobile'), [320, 180]);
  function rendererFor(accept, extension = true, counts = [4, 2]) {
    let binding, current = null, released = 0;
    const attempts = [], queries = [], gl = {
      FRAMEBUFFER: 1, FRAMEBUFFER_COMPLETE: 2, RENDERBUFFER: 3, RGBA16F: 4, RGBA8: 5, SAMPLES: 6,
      getExtension: () => extension ? {} : null,
      getInternalformatParameter(...args) { queries.push(args); return counts; },
      bindFramebuffer(_, fb) { binding = fb; },
      checkFramebufferStatus() { return accept(binding) ? 2 : 0; },
    };
    const renderer = { capabilities: { maxSamples: 8 }, properties: { get: target => ({ __webglFramebuffer: { target, resolved: true } }) },
      getContext: () => gl, getRenderTarget: () => current, resetState() {},
      setRenderTarget(target) { current = target; binding = { target, resolved: false }; if (target && !attempts.includes(target)) { attempts.push(target); target.addEventListener('dispose', () => released++); } },
    };
    return { renderer, gl, attempts, queries, get released() { return released; } };
  }
  let f = rendererFor(({ target, resolved }) => target.texture.type !== T.HalfFloatType || target.samples < 4 || !resolved);
  assert.deepEqual(composerConfig(f.renderer, 4), { type: T.HalfFloatType, samples: 2, hdr: true, direct: false });
  assert.deepEqual(f.queries[0], [f.gl.RENDERBUFFER, f.gl.RGBA16F, f.gl.SAMPLES]);
  assert.equal(f.released, f.attempts.length); assert.equal(f.renderer.getRenderTarget(), null);
  f = rendererFor(({ target }) => target.texture.type === T.UnsignedByteType && target.samples === 0);
  assert.deepEqual(composerConfig(f.renderer, 4), { type: T.UnsignedByteType, samples: 0, hdr: false, direct: false });
  f = rendererFor(() => false); assert.equal(composerConfig(f.renderer, 4).direct, true);
  f = rendererFor(() => true, false); assert.equal(composerConfig(f.renderer, 2).type, T.UnsignedByteType);
  f = rendererFor(() => true, true, [4]); assert.equal(composerConfig(f.renderer, 2).samples, 2);   // GL rounds 2 up to the format's 4
  f = rendererFor(({ target }) => target.samples !== 2, true, [4]); assert.equal(composerConfig(f.renderer, 2).samples, 0);
  assert.equal(f.released, f.attempts.length);
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(), mat = new T.MeshStandardMaterial(), geometry = new T.BoxGeometry();
  const a = new T.Mesh(geometry, mat), b = new T.Mesh(geometry, mat), instance = new T.InstancedMesh(geometry, mat, 1); scene.add(a, b, instance);
  const calls = [], props = new Map(), target = {}, saved = {}; let bound = saved, linked = 0, yielded = false;
  const program = { getUniforms() { linked++; } };
  const renderer = { shadowMap: { enabled: true }, getContext: () => ({ getExtension: () => null }), getRenderTarget: () => bound, setRenderTarget(t) { bound = t; },
    properties: { get: m => props.get(m) }, compile(proxy, cam, targetScene) {
      assert.equal(yielded, true); assert.equal(bound, target); assert.equal(targetScene, scene); assert.equal(cam, camera);
      let count = 0; proxy.traverse(() => count++); assert.equal(count, 1);
      calls.push(proxy); props.set(proxy.material, { programs: new Map([['program', program]]) }); return new Set([proxy.material]);
    },
  };
  setTimeout(() => { yielded = true; }, 0); await warmPrograms(renderer, scene, camera, target);
  assert.equal(calls.length, 2); assert.equal(linked, 1); assert.equal(bound, saved); assert.equal(a.material, mat); assert.equal(a.parent, scene);
  const compile = renderer.compile; renderer.compile = (...args) => { assert.equal(renderer.shadowMap.enabled, false); return compile(...args); };
  await warmPrograms(renderer, scene, camera, target, [{ object: a, material: mat }], false); assert.equal(renderer.shadowMap.enabled, true);
  renderer.compile = () => { throw Error('fixture compile failure'); };
  await assert.rejects(warmPrograms(renderer, scene, camera, target), /fixture compile failure/); assert.equal(bound, saved);
  const photo = new PhotoMode({ renderer: {}, scene, camera, lighting: {} }); let disposed = 0;
  photo.hasStill = true; photo.toBlob = async () => 'encoded still'; photo.dispose = () => { disposed++; photo.tracer = null; photo.hasStill = false; };
  photo.close(); assert.equal(disposed, 1); assert.equal(await photo.stillBlob, 'encoded still');
  assert.equal(await PhotoMode.prototype.toBlob.call(photo), 'encoded still'); photo.close(); assert.equal(await photo.stillBlob, 'encoded still');
  let metered = false;
  const meterRenderer = { setRenderTarget() {}, render() {}, readRenderTargetPixels(t, x, y, w, h, data) {
    assert.equal(t.texture.type, T.FloatType); assert.ok(data instanceof Float32Array); data.fill(0.5); metered = true;
  } };
  const meter = new PhotoMode({ renderer: meterRenderer, scene, camera, lighting: {} }); meter.tracer = { target: { texture: {} } };
  assert.ok(Math.abs(meter.meter() - 0.5001) < 1e-6); assert.ok(metered);
  meter.tracer = null; meter.dispose();
  // Quantised linear depth keeps distant reprojection accurate at the walkthrough's 0.05–300 m clip range.
  camera.near = 0.05; camera.far = 300; camera.updateProjectionMatrix(); camera.position.set(2, 1, 3); camera.updateMatrixWorld();
  for (const z of [20, 50]) {
    const point = new T.Vector3(0.2 * z, -0.1 * z, -z), ndc = point.clone().applyMatrix4(camera.projectionMatrix);
    const ray = new T.Vector4(ndc.x, ndc.y, 1, 1).applyMatrix4(camera.projectionMatrixInverse);
    const linear = T.DataUtils.fromHalfFloat(T.DataUtils.toHalfFloat(z));
    const reconstructed = new T.Vector3(ray.x, ray.y, ray.z).multiplyScalar(linear / -ray.z).applyMatrix4(camera.matrixWorld);
    assert.ok(reconstructed.distanceTo(point.applyMatrix4(camera.matrixWorld)) < 0.03);
  }
  const localSource = await readFile(join(root, 'src/local_adapt.js'), 'utf8');
  assert.ok(localSource.includes('center.g / -ray.z')); assert.ok(!localSource.includes('center.a * 2.0'));
  // Execute the real restoration callback with CPU PMREM/environment doubles.
  const lightingSource = await readFile(join(root, 'src/lighting.js'), 'utf8');
  const outputPass = new OutputPass();
  new Function('outputPass', lightingSource.match(/outputPass\.material\.fragmentShader = [^\n]+/)[0])(outputPass);
  assert.equal((outputPass.material.fragmentShader.match(/precision highp sampler2D;/g) ?? []).length, 1);
  const restoreBody = lightingSource.match(/renderer\.domElement\.addEventListener\('webglcontextrestored', \(\) => \{([\s\S]*?)\n  \}\);/)[1];
  let freed = 0, generated = 0, rebound = [], redraws = 0;
  const envTarget = () => ({ texture: {}, depthBuffer: true, dispose() { freed++; }, clone() { return envTarget(); } });
  const skies = new Map([['day', { background: {}, target: envTarget() }], ['dusk', { background: {}, target: envTarget() }]]);
  const roomCache = new Map([[false, envTarget()], [true, envTarget()]]), restoreScene = {}, restoreSun = { shadow: {} };
  const makeRestore = new Function('THREE', 'renderer', 'readySkies', 'rooms', 'scene', 'sun', 'roomFor', 'setLightingEnvironment', 'update', `
    let pmrem = { dispose() { globalThis.fixturePMREMDisposed++; } }, blendTarget = { dispose() { globalThis.fixtureBlendDisposed++; } }, lastSkyMix = 0.5;
    const renderConfig = { hdr: true }, dusk = false, DAY = 'day', DUSK = 'dusk';
    const blendMaterial = { uniforms: { room: {}, sky: {} } }, interiorMaterials = 'inside', exteriorMaterials = 'outside';
    return () => { ${restoreBody}; return { lastSkyMix, blendMaterial, blendTarget }; };`);
  globalThis.fixturePMREMDisposed = globalThis.fixtureBlendDisposed = 0;
  const restore = makeRestore({ PMREMGenerator: class { fromEquirectangular() { generated++; return envTarget(); } } }, {}, skies, roomCache, restoreScene, restoreSun,
    () => { assert.equal(roomCache.size, 0); return envTarget(); }, (...args) => rebound.push(args), () => { redraws++; });
  const restored = restore();
  assert.equal(generated, 2); assert.equal(freed, 4); assert.equal(globalThis.fixturePMREMDisposed, 1); assert.equal(globalThis.fixtureBlendDisposed, 1);
  assert.equal(restored.lastSkyMix, -1); assert.equal(redraws, 1); assert.equal(restoreSun.shadow.needsUpdate, true);
  assert.equal(restoreScene.environment, skies.get('day').target.texture); assert.equal(rebound[0][0], restored.blendTarget.texture); assert.equal(rebound[1][0], restoreScene.environment);
  delete globalThis.fixturePMREMDisposed; delete globalThis.fixtureBlendDisposed;
  console.log('device robustness: photo budgets/limits/close/save/float meter, RGBA16F samples/resolved validation/LDR/direct fallback, bounded unique warmup/yields/linking/state, linear-depth reprojection OK');
} finally { await rm(dir, { recursive: true, force: true }); }
