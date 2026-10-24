// Node-only fixtures; fetch, image decode and renderer are stubs. No browser, network or GPU.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const dir = await mkdtemp(join(tmpdir(), 'croton-tiers-'));
const log = console.info, warn = console.warn;
try {
  const contact = { name: 'contact-stub', setup(b) { b.onResolve({ filter: /\/contact\.js$/ }, () => ({ path: 'contact', namespace: 'fixture' })); b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const CONTACT = false; export const CONTACT_SHADER = { uniforms: {}, steps: 8, max: 16 };' })); } };
  const lifecycle = { name: 'lifecycle-stubs', setup(b) {
    b.onLoad({ filter: /\/HDRLoader\.js$/ }, () => ({ contents: `import { Texture } from 'three';
      export class HDRLoader { setDataType() { return this; } async loadAsync(url) { return new Texture({ width: 2, height: 1, data: new Uint16Array(8) }); } }`, loader: 'js' }));
    b.onResolve({ filter: /^three$/ }, () => ({ path: 'three-lifecycle', namespace: 'lifecycle' }));
    b.onLoad({ filter: /.*/, namespace: 'lifecycle' }, () => {
      const real = JSON.stringify(fileURLToPath(new URL('../node_modules/three/build/three.module.js', import.meta.url)));
      return { resolveDir: fileURLToPath(new URL('../', import.meta.url)), contents: `export * from ${real}; import { WebGLRenderTarget } from ${real};
        export class PMREMGenerator { fromEquirectangular() { const t = new WebGLRenderTarget(2, 1); globalThis.fixturePmrem.targets.push(t); return t; } dispose() { globalThis.fixturePmrem.generators++; } }`, loader: 'js' };
    });
  } };
  const result = await build({ stdin: { contents: "export { applyLightmaps, applyBakedSun } from './src/lightmap.js'; export { SLOTS } from './src/lighting_slots.js'; export * as THREE from 'three';", resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', plugins: [contact, lifecycle] });
  const file = join(dir, 'fixture.mjs'); await writeFile(file, result.outputFiles[0].contents);
  globalThis.location = { search: '?agx=three&foliagebake=0' };
  const { applyLightmaps, applyBakedSun, SLOTS, THREE } = await import(pathToFileURL(file));
  console.info = console.warn = () => {};
  const requests = [], closed = [], base = 'https://fixture.invalid/lightmaps';
  let shipped = ['sunrise'], groupMeta = null;
  let fail = '', release = null, gate = null, probeData = null, toneK = 0.2;
  const ph = Buffer.from(JSON.stringify({ count: 4, points: [[0, 1, 0], [1, 1, 0], [0, 1, 1], [1, 1, 1]], layers: ['sky', 'sunind', 'lamps'] }));
  const po = (4 + ph.length + 4 + 3) & ~3;
  probeData = new ArrayBuffer(po + 4 * 27 * 4 * 3); new DataView(probeData).setUint32(0, ph.length, true);
  new Uint8Array(probeData, 4, ph.length).set(ph); new Uint8Array(probeData, 4 + ph.length, 4).fill(1); new Float32Array(probeData, po).fill(0.2);
  const fh = Buffer.from(JSON.stringify({ K: { slot: 1, lamps: 1 }, units: [] })), foliage = Buffer.alloc(4 + fh.length); foliage.writeUInt32LE(fh.length); fh.copy(foliage, 4);
  const sizes = { full: [5900, 5901], half: [2950, 2951], quarter: [1475, 1476] };
  const header = { atlas: sizes.full, units: [{ id: 'fixture', vc: 3, nv: 3, ni: 3, off: 0 }], skipped: {} };
  const json = Buffer.from(JSON.stringify(header)), bin = Buffer.alloc(4 + json.length + 36);
  bin.writeUInt32LE(json.length); json.copy(bin, 4);
  [0, 1, 2, 0, 1, 2].forEach((v, i) => bin.writeUInt32LE(v, 4 + json.length + i * 4));
  globalThis.fetch = async (input, opts) => {
    const url = typeof input === 'string' ? input : input.url; requests.push(url);
    if (url.endsWith('/lampgroups/encoding.json') && groupMeta) return { ok: true, json: async () => groupMeta };
    if (url.endsWith('/probes.bin') && probeData) return { ok: true, arrayBuffer: async () => probeData };
    if (url.endsWith('/refl/meta.json')) return { ok: true, json: async () => [{ i: 0, p: [0, 1, 0], min: [-1, 0, -1], max: [1, 2, 1] }] };
    if (url.endsWith('/foliage.bin.gz')) return { ok: true, arrayBuffer: async () => foliage.buffer.slice(foliage.byteOffset, foliage.byteOffset + foliage.length) };
    if (url.endsWith('/encoding.json') && !shipped.some(s => url.includes(`/v2/${s}/`))) return { ok: false, status: 404 };
    if (url.endsWith('/encoding.json')) return { ok: true, json: async () => ({ curve: 'sqrt(x/(x+K))', K: { slot: toneK, lamps: 0.1 } }) };
    if (url.endsWith('/lightmap_uv2.bin.gz')) return { ok: true, arrayBuffer: async () => bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.length) };
    if (url.endsWith('.webp')) {
      if (gate) await gate;
      return { ok: !fail || !url.includes(fail), status: 404, blob: async () => url };
    }
    return { ok: false, status: 404, json: async () => null, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  globalThis.createImageBitmap = async url => {
    const res = url.includes('/quarter/') ? 'quarter' : url.includes('/half/') ? 'half' : 'full';
    return { width: sizes[res][0], height: sizes[res][1], close() { closed.push(url); } };
  };
  const renderer = { capabilities: { maxTextureSize: 16384 }, getRenderTarget() { return null; }, setRenderTarget() {}, render() {} };
  const scene = new THREE.Scene(), sun = new THREE.DirectionalLight(); scene.add(sun, sun.target);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial()); mesh.userData.lmId = 'fixture'; scene.add(mesh);
  const lighting = { sun, windowLights: [], fixtures: new THREE.Group() };
  const baked = await applyLightmaps({ scene, renderer, lighting, base, tier: 'mobile' });
  assert.equal(baked.stats.matched, 1); assert.equal(baked.stats.resolution, 'quarter'); assert.equal(baked.stats.shadowSize, 1024);
  assert.equal(requests.filter(u => u.endsWith('.webp')).length, 2); assert.ok(requests.filter(u => u.endsWith('.webp')).every(u => u.includes('/quarter/')));
  const compile = material => { const sh = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader }; material.onBeforeCompile(sh, renderer); return sh; };
  const firstShader = compile(mesh.material), firstKey = mesh.material.customProgramCacheKey();
  assert.ok(firstShader.fragmentShader.includes('lmSample( lightMap')); assert.deepEqual(firstShader.uniforms.uLmK.value.toArray(), [0.2, 0.1]);
  assert.ok(!firstShader.fragmentShader.includes('vec4 lightMapTexel = texture2D'));
  const old = baked.target.texture; let disposed = false; old.addEventListener('dispose', () => { disposed = true; });
  await baked.setQuality('laptop');
  assert.equal(baked.stats.resolution, 'half'); assert.equal(baked.stats.shadowSize, 2048); assert.equal(baked.sunShadow.uniforms.uSunTexel.value, 1 / 2048);
  assert.equal(mesh.material.lightMap, baked.target.texture); assert.notEqual(old, baked.target.texture); assert.ok(disposed); assert.equal(closed.length, 2);
  applyBakedSun(lighting, renderer, baked.slot); assert.equal(sun.shadow.mapSize.x, 2048);
  gate = new Promise(r => { release = r; });
  const pending = baked.setQuality('hq'); baked.setQuality('mobile'); release(); await pending; gate = null;
  assert.equal(baked.stats.resolution, 'quarter'); assert.equal(baked.stats.shadowSize, 1024); assert.equal(closed.length, 6);
  globalThis.location.search = '?lmres=full&agx=three'; await baked.setQuality('mobile');
  assert.equal(baked.stats.resolution, 'full'); assert.equal(baked.stats.shadowSize, 1024);
  globalThis.location.search = '?lmres=half&agx=three'; fail = '/half/lamps.webp';
  // Missing tiers preserve the active pair until the caller switches to legacy; retry can succeed.
  const current = baked.target.texture; await assert.rejects(baked.setQuality('laptop'), /404/);
  assert.equal(baked.target.texture, current); assert.equal(baked.stats.resolution, 'full'); assert.equal(closed.length, 9);
  fail = ''; globalThis.location.search = '?lmres=quarter'; await baked.setQuality('laptop'); assert.equal(baked.stats.resolution, 'quarter');
  globalThis.location.search = '?lmres=half'; await baked.setQuality('laptop'); assert.equal(baked.stats.resolution, 'half');
  globalThis.location.search = ''; fail = '/half/';
  const scene2 = new THREE.Scene(), sun2 = new THREE.DirectionalLight(); scene2.add(sun2, sun2.target);
  const mesh2 = new THREE.Mesh(g.clone(), new THREE.MeshStandardMaterial()); mesh2.userData.lmId = 'fixture'; scene2.add(mesh2);
  const original2 = mesh2.material, geometry2 = mesh2.geometry;
  const options2 = { scene: scene2, renderer, lighting: { sun: sun2, windowLights: [], fixtures: new THREE.Group() }, base, tier: 'laptop' };
  await assert.rejects(applyLightmaps(options2), /404/);
  assert.equal(mesh2.material, original2); assert.equal(mesh2.geometry, geometry2); assert.equal(sun2.userData.bakedShadow, undefined);
  fail = ''; toneK = 0.7; globalThis.location.search = '?agx=three';
  const baked2 = await applyLightmaps(options2);
  assert.equal(baked2.stats.resolution, 'half'); assert.equal(baked2.stats.matched, 1); assert.deepEqual(baked2.stats.atlas, sizes.half);
  const secondShader = compile(mesh2.material);
  assert.equal(firstKey, mesh2.material.customProgramCacheKey()); assert.equal(firstShader.fragmentShader, secondShader.fragmentShader); assert.equal(secondShader.uniforms.uLmK.value.x, 0.7);
  assert.ok(Math.abs(baked2.stats.atlasMiB - sizes.half[0] * sizes.half[1] * 8 / 1048576 * 4 / 3) < 0.01);
  // Exercise real registration/teardown and event wiring with CPU probe data and stubbed PMREM/HDR decoding.
  const probeHeader = Buffer.from(JSON.stringify({ count: 4, points: [[0, 1, 0], [1, 1, 0], [0, 1, 1], [1, 1, 1]], layers: ['sky', 'sunind', 'lamps'] }));
  const offset = (4 + probeHeader.length + 4 + 3) & ~3;
  probeData = new ArrayBuffer(offset + 4 * 27 * 4 * 3); new DataView(probeData).setUint32(0, probeHeader.length, true);
  new Uint8Array(probeData, 4, probeHeader.length).set(probeHeader); new Uint8Array(probeData, 4 + probeHeader.length, 4).fill(1); new Float32Array(probeData, offset).fill(0.2);
  globalThis.fixtureSky = true; globalThis.fixturePmrem = { targets: [], generators: 0 }; globalThis.location.search = '?agx=three&rawtone&foliagebake=0';
  renderer.domElement = new THREE.EventDispatcher();
  const scene3 = new THREE.Scene(), sun3 = new THREE.DirectionalLight(); scene3.add(sun3, sun3.target);
  const originalMaterial = new THREE.MeshStandardMaterial(), mesh3 = new THREE.Mesh(g, originalMaterial); mesh3.userData.lmId = 'fixture'; scene3.add(mesh3);
  const grade = Object.fromEntries(['lift', 'contrast', 'saturation', 'grain'].map(k => [k, { value: 1 }]));
  const lighting3 = { sun: sun3, windowLights: [], fixtures: new THREE.Group(), tune: {}, grade,
    update() { renderer.toneMappingExposure = this.tune.dayOutdoor; } };
  const baked3 = await applyLightmaps({ scene: scene3, renderer, lighting: lighting3, base });
  const late = new THREE.Mesh(g, new THREE.MeshStandardMaterial()), previousHook = late.material.onBeforeCompile; scene3.add(late);
  baked3.register(late); assert.equal(late.material.userData.probeLit, true); assert.equal(baked3.stats.probeLit, 1); assert.ok(compile(late.material).fragmentShader.includes('sunPCSS'));
  baked3.afterTime(); const env = late.material.envMap, pmrem = globalThis.fixturePmrem;
  assert.equal(pmrem.generators, 1); assert.equal(renderer.toneMappingExposure, 1); assert.equal(renderer.toneMapping, THREE.NoToneMapping);
  baked3.afterTime(); assert.equal(late.material.envMap, env); assert.equal(pmrem.generators, 1);
  const later = new THREE.Mesh(g, new THREE.MeshStandardMaterial()); baked3.register(later); assert.equal(later.material.envMap, env); assert.equal(baked3.stats.probeLit, 2);
  let oldEnvDisposed = 0; pmrem.targets[0].addEventListener('dispose', () => { oldEnvDisposed++; });
  renderer.domElement.dispatchEvent({ type: 'webglcontextrestored' }); assert.equal(oldEnvDisposed, 1); assert.equal(pmrem.generators, 2); assert.notEqual(late.material.envMap, env);
  let currentEnvDisposed = 0; pmrem.targets[1].addEventListener('dispose', () => { currentEnvDisposed++; });
  baked3.dispose(); baked3.dispose(); assert.equal(currentEnvDisposed, 1); assert.equal(mesh3.material, originalMaterial); assert.equal(mesh3.geometry, g); assert.equal(late.material.onBeforeCompile, previousHook); assert.equal(late.material.envMap, null); assert.equal(late.material.userData.probeLit, undefined);
  renderer.domElement.dispatchEvent({ type: 'webglcontextrestored' }); assert.equal(pmrem.generators, 2);
  // Real multi-slot integration against the same CPU-only texture/PMREM/renderer fixtures.
  shipped = ['sunrise', 'noon', 'golden', 'dusk'];
  globalThis.location.search = '?agx=three&foliagebake=0';
  const scene4 = new THREE.Scene(), sun4 = new THREE.DirectionalLight(); scene4.add(sun4, sun4.target);
  const mesh4 = new THREE.Mesh(g.clone(), new THREE.MeshStandardMaterial()); mesh4.userData.lmId = 'fixture'; scene4.add(mesh4);
  const source4 = mesh4.material; source4.userData = { emits: 'lamp', lightGlow: true }; source4.emissiveIntensity = 0;
  // a switch as light_switch.js makes it, with its lighting manifest record (on at dusk, the default)
  const toggle4 = { on: true, manual: false, glows: [], lighting: { group: 'bedB', defaultOn: ['dusk'] }, set(on) { this.on = on; this.manual = true; } };
  mesh4.userData.id = 'fixture';
  groupMeta = { version: 1, curve: 'sqrt(x/(x+K))', textures: 1, groups: [{ index: 0, tex: 0, ch: 0, name: 'bedB', K: 1, color: [1, 1, 1], members: [{ id: 'fixture', root: [0, 0, 0], w: 1 }] }] };
  renderer.initTexture = () => {}; renderer.copyTextureToTexture = () => {};
  const lighting4 = { sun: sun4, windowLights: [], fixtures: new THREE.Group(), tune: {}, grade,
    lightSwitches: [{ root: mesh4, toggle: toggle4 }],
    update() { renderer.toneMappingExposure = this.tune.dayOutdoor; } };
  const baked4 = await applyLightmaps({ scene: scene4, renderer, lighting: lighting4, base, tier: 'mobile' });
  baked4.afterTime();
  assert.equal(baked4.lampGroups.matched, 1); assert.equal(toggle4.on, false);
  toggle4.set(true); source4.emissiveIntensity = 2.5; baked4.updateMovables(0.25);
  assert.equal(mesh4.material.emissiveIntensity, 2.5); assert.equal(baked4.lampGroups.levels[0], 1);
  assert.deepEqual(baked4.availableSlots, shipped);
  const multiShader = compile(mesh4.material);
  assert.ok(multiShader.fragmentShader.includes('mix( lmSample( lightMap'));
  assert.ok(multiShader.fragmentShader.includes('uniform float uReflNext;') && !multiShader.fragmentShader.includes('uReflNextTex'));
  assert.equal((multiShader.fragmentShader.match(/sampler2DArray/g) ?? []).length, 2);   // reflection slots + lamp groups
  const late4 = new THREE.Mesh(g, new THREE.MeshStandardMaterial()); scene4.add(late4); baked4.register(late4);
  const probeShader = compile(late4.material);
  assert.ok(probeShader.fragmentShader.includes('probeTex( uProbeNextSH, uvw, ch )'));
  assert.equal((probeShader.fragmentShader.match(/uniform highp sampler3D/g) ?? []).length, 2);   // packed R/G/B: current + next
  // sampler budget (Apple GPUs: 16 per fragment shader): too few units leave out optional features in order (here, with
  // contact.js stubbed, the slot crossfade of the probe volume), with one warning naming the material
  // the plan's count: uSunDepth, uReflTex (both slots), uProbeSH + uProbeNextSH, and three's dfgLUT, environment and
  // the sun's shadow map (every baked program has them)
  assert.equal(probeShader.samplerCount, 7);
  const tight = { ...renderer, capabilities: { ...renderer.capabilities, maxTextures: 6 } }, warnings = [], warn = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  const fitted = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  try { late4.material.onBeforeCompile(fitted, tight); } finally { console.warn = warn; }
  assert.ok(!fitted.fragmentShader.includes('uProbeNextSH') && fitted.fragmentShader.includes('probeEval( bakedProbe,'));
  assert.equal(fitted.samplerCount, 6); assert.equal(warnings.length, 1); assert.match(warnings[0], /7 fragment samplers > 6 texture units; dropped slot crossfade$/);
  assert.equal(multiShader.uniforms.uSlotBlend, probeShader.uniforms.uProbeBlend);
  const pump = async promise => { let done = false; promise.finally(() => { done = true; }); for (let i = 0; i < 40 && !done; i++) { await new Promise(setImmediate); baked4.updateMovables(0.25); } assert.ok(done, 'transition must complete'); await promise; };
  const dawnAtlas = baked4.target.texture, dawnBackground = scene4.background;
  fail = '/dusk/quarter/slot.webp'; await assert.rejects(baked4.setSlot('dusk'), /404/);
  assert.equal(baked4.target.texture, dawnAtlas); assert.equal(scene4.background, dawnBackground); assert.equal(baked4.slotName, 'sunrise');
  const slotProgress = [];
  fail = ''; await pump(baked4.setSlot('dusk', (fraction, detail) => slotProgress.push({ fraction, ...detail })));
  const stagedSlot = slotProgress.find(p => p.phase === 'staged');
  assert.equal(stagedSlot.loaded, 7); assert.equal(stagedSlot.total, 7); assert.equal(stagedSlot.fraction, 1);
  assert.equal(slotProgress.at(-1).phase, 'transition'); assert.equal(slotProgress.at(-1).name, 'dusk');
  assert.equal(baked4.slotName, 'dusk'); assert.equal(sun4.intensity, 0); assert.ok(Math.abs(renderer.toneMappingExposure - 2 ** SLOTS.dusk.ev) < 1e-9);
  assert.equal(toggle4.manual, false); assert.equal(toggle4.on, true);
  assert.equal(multiShader.uniforms.uSlotBlend.value, 0); assert.equal(multiShader.uniforms.uWet.value, 0);
  assert.equal(mesh4.material.lightMap, baked4.target.texture);
  const previousProgressCount = slotProgress.length, cachedProgress = [];
  await pump(baked4.setSlot('sunrise', (_, d) => cachedProgress.push(d.phase))); assert.equal(baked4.target.texture, dawnAtlas);
  assert.equal(toggle4.manual, false); assert.equal(toggle4.on, false);
  assert.deepEqual(cachedProgress, ['transition']); assert.equal(slotProgress.length, previousProgressCount);
  toggle4.set(true); baked4.updateMovables(0.25);
  await pump(baked4.setQuality('laptop')); assert.equal(baked4.stats.resolution, 'half');
  assert.equal(toggle4.manual, true); assert.equal(toggle4.on, true); assert.equal(baked4.lampGroups.levels[0], 1);
  renderer.domElement.dispatchEvent({ type: 'webglcontextrestored' });
  assert.equal(toggle4.manual, true); assert.equal(toggle4.on, true);
  await pump(baked4.setSlot('golden')); assert.equal(baked4.slotName, 'golden');
  assert.equal(toggle4.manual, false); assert.equal(toggle4.on, false);
  renderer.domElement.dispatchEvent({ type: 'webglcontextrestored' });
  baked4.dispose();
  log('multi-slot integration: shared blend uniforms, atomic failed load, dusk sun/exposure/dryness, cached return, quality, context restore, disposal OK');
  baked.dispose(); baked2.dispose();
  log('lightmap lifecycle: K uniforms, late registration, rawtone exposure, PMREM ownership, restore, idempotent disposal OK');
  log('lightmap tiers: initial URLs, swaps, disposal, rapid toggles, override, shadow sizes, failed-load recovery OK');
} finally { console.info = log; console.warn = warn; await rm(dir, { recursive: true, force: true }); }
