// CPU-only startup/failure fixtures. No browser, GPU or network.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'croton-default-'));
globalThis.location = { search: '' };
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => 'en', setItem() {} }, configurable: true, writable: true });
try {
  const hdr = { name: 'hdr-fixture', setup(b) {
    b.onLoad({ filter: /\/HDRLoader\.js$/ }, () => ({ contents: `import { Texture } from 'three';
      export class HDRLoader { setDataType() { return this; } async loadAsync(url) {
        globalThis.fixtureRequests.push(url);
        if (url.includes(globalThis.fixtureFail) && globalThis.fixtureFail) throw Error('fixture HDR failure');
        return new Texture({ width: 2, height: 1, data: new Uint16Array(8) });
      } }`, loader: 'js' }));
  } };
  const built = await build({ stdin: { contents: "export { applyLightmaps } from './src/lightmap.js'; export * from './src/baked_mode.js'; export { TIERS, qualityPair } from './src/tier.js'; export * as THREE from 'three';", resolveDir: root }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent', plugins: [hdr] });
  const file = join(dir, 'fixture.mjs'); await writeFile(file, built.outputFiles[0].contents);
  const { applyLightmaps, bakedRequested, bakedResolution, bakedCapabilityError, TIERS, qualityPair, THREE: T } = await import(pathToFileURL(file));
  for (const query of ['', '?lightmap', '?lightmap=sunrise', '?lightmap=unshipped', '?taa=0&shafts=0']) assert.equal(bakedRequested(query), true);
  for (const query of ['?legacy', '?legacy=0&lightmap=sunrise', '?lightmap=0']) assert.equal(bakedRequested(query), false);
  const ext = new Set(['EXT_color_buffer_float', 'OES_texture_float_linear']);
  const gl = { texImage3D() {}, getExtension: name => ext.has(name) ? {} : null };
  const caps = { getContext: () => gl, capabilities: { maxTextureSize: 4096 } };
  assert.equal(bakedCapabilityError(caps, [2952, 2950]), null);
  assert.match(bakedCapabilityError(caps, [5903, 5900]), /maxTextureSize/);
  // iOS: no OES_texture_float_linear (every linearly filtered baked texture is half float); half-float targets suffice
  ext.delete('OES_texture_float_linear'); assert.equal(bakedCapabilityError(caps), null);
  ext.delete('EXT_color_buffer_float'); assert.match(bakedCapabilityError(caps), /half-float render targets/);
  ext.add('EXT_color_buffer_half_float'); assert.equal(bakedCapabilityError(caps), null);
  ext.delete('EXT_color_buffer_half_float'); ext.add('EXT_color_buffer_float'); ext.add('OES_texture_float_linear');
  assert.match(bakedCapabilityError({ getContext: () => ({}) }), /WebGL2/);
  for (const name of ['hq', 'laptop', 'mobile']) {
    assert.equal(TIERS[name].contact, name !== 'mobile'); assert.equal(TIERS[name].puddles, name === 'hq');
    assert.equal(TIERS[name].shafts, false); assert.equal(TIERS[name].taa, false);
    assert.equal(bakedResolution(name, ''), { hq: 'full', laptop: 'half', mobile: 'quarter' }[name]);
    const pair = qualityPair(name); assert.equal(pair[0], name); assert.equal(pair[1], name === 'mobile' ? 'laptop' : 'mobile');
  }
  const binary = (header, bytes = 0) => { const h = Buffer.from(JSON.stringify(header)), b = Buffer.alloc(4 + h.length + bytes); b.writeUInt32LE(h.length); h.copy(b, 4); return b; };
  const uv = binary({ atlas: [8, 8], units: [{ id: 'fixture', vc: 3, nv: 3, ni: 3, off: 0 }] }, 36);
  const uvOffset = 4 + uv.readUInt32LE(); [0, 1, 2, 0, 1, 2].forEach((n, i) => uv.writeUInt32LE(n, uvOffset + 4 * i));
  const ph = { count: 4, points: [[0, 1, 0], [1, 1, 0], [0, 1, 1], [1, 1, 1]], layers: ['sky', 'sunind', 'lamps'] };
  const po = (4 + Buffer.byteLength(JSON.stringify(ph)) + 4 + 3) & ~3;
  const pb = binary(ph, po + 4 * 27 * 4 * 3 - 4 - Buffer.byteLength(JSON.stringify(ph)));
  pb.fill(1, 4 + pb.readUInt32LE(), 8 + pb.readUInt32LE());
  const foliage = binary({ K: { slot: 1, lamps: 1 }, units: [] });
  const buffer = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  globalThis.fetch = async url => {
    globalThis.fixtureRequests.push(url);
    if (globalThis.fixtureFail && url.includes(globalThis.fixtureFail)) throw Error('fixture asset failure');
    if (/v2\/(noon|golden|dusk)\/encoding\.json$/.test(url)) return { ok: false, status: 404 };
    if (url.endsWith('encoding.json')) return { ok: true, json: async () => ({ K: { slot: 1, lamps: 1 } }) };
    if (url.endsWith('meta.json')) return { ok: true, json: async () => [{ i: 0, p: [0, 1, 0], min: [-1, 0, -1], max: [1, 2, 1] }] };
    if (url.endsWith('manifest.json')) return { ok: false };
    const bytes = url.endsWith('probes.bin') ? pb : url.endsWith('foliage.bin.gz') ? foliage : url.includes('agx_lut') ? Buffer.alloc((37 ** 3 + 57 ** 3) * 3 * 2) : uv;
    return { ok: true, arrayBuffer: async () => buffer(bytes), blob: async () => url };
  };
  const closed = [];
  globalThis.createImageBitmap = async url => ({ width: url.includes('/quarter/') ? 2 : url.includes('/half/') ? 4 : 8, height: url.includes('/quarter/') ? 2 : url.includes('/half/') ? 4 : 8, close() { closed.push(url); } });
  const fixture = () => {
    const scene = new T.Scene(), sun = new T.DirectionalLight(), fixtureLight = new T.PointLight(); scene.add(sun, sun.target, fixtureLight);
    const geometry = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    const material = new T.MeshStandardMaterial(), mesh = new T.Mesh(geometry, material); mesh.userData.lmId = 'fixture'; scene.add(mesh);
    const renderer = { capabilities: { maxTextureSize: 4096 }, getRenderTarget() { return null; }, setRenderTarget() {}, render() {} };
    const lighting = { sun, windowLights: [fixtureLight], fixtures: new T.Group(), outputPass: { render() {} } };
    return { scene, renderer, lighting, mesh, geometry, material, fixtureLight };
  };
  for (const fail of ['encoding.json', 'lightmap_uv2.bin.gz', '/probes.bin', '/sky_bg.hdr', '/refl/meta.json', '/refl/probe_00.hdr', '/slot.webp', '/lamps.webp', '/foliage.bin.gz', 'agx_lut']) {
    globalThis.fixtureFail = fail; globalThis.fixtureRequests = [];
    const f = fixture(); await assert.rejects(applyLightmaps({ ...f, tier: 'mobile' }));
    assert.equal(f.mesh.material, f.material, fail); assert.equal(f.mesh.geometry, f.geometry, fail);
    assert.equal(f.fixtureLight.visible, true, fail); assert.equal(f.lighting.sun.userData.bakedShadow, undefined, fail);
    assert.equal(f.lighting.outputPass.blenderAgX, undefined, fail);
  }
  globalThis.fixtureFail = ''; globalThis.fixtureRequests = [];
  const f = fixture(), progress = [];
  const baked = await applyLightmaps({ ...f, tier: 'mobile', onProgress: p => progress.push(p) });
  assert.deepEqual(progress, Array.from({ length: 9 }, (_, i) => (i + 1) / 9));
  assert.equal(baked.stats.resolution, 'quarter'); assert.equal(f.fixtureLight.visible, false); assert.equal(baked.stats.matched, 1);
  assert.ok(f.lighting.outputPass.blenderAgX);
  baked.setFeatures('hq'); const puddles = baked.puddleRefl; assert.equal(puddles.params.enabled, true);
  puddles.uniforms.uPuddleValid.value = 1; baked.setFeatures('mobile');
  assert.equal(puddles.params.enabled, false); assert.equal(puddles.uniforms.uPuddleValid.value, 0);
  baked.setFeatures('hq'); assert.equal(baked.puddleRefl, puddles); assert.equal(puddles.params.enabled, true);
  baked.setFeatures('laptop'); assert.equal(puddles.params.enabled, false);
  baked.dispose();
  assert.equal(f.mesh.geometry, f.geometry); assert.equal(f.mesh.material, f.material); assert.equal(f.fixtureLight.visible, true);
  // Replacement failures must restore the whole legacy path before activation escapes.
  for (const kind of ['lightmap', 'probe', 'depth']) {
    const broken = fixture();
    const m = kind === 'probe' ? new T.MeshStandardMaterial() : broken.material;
    if (kind === 'probe') broken.scene.add(new T.Mesh(broken.geometry, m));
    m.ownShader = { key: 'fixture ' + kind, compile(sh) {
      if (kind !== 'depth' || sh.vertexShader.includes('vHighPrecisionZW')) throw Error('fixture ' + kind + ' patch failure');
    } };
    const warn = console.warn; console.warn = () => {};
    try { await assert.rejects(applyLightmaps({ ...broken, tier: 'mobile' }), /Baked shader patch failed/); }
    finally { console.warn = warn; }
    assert.equal(broken.mesh.material, broken.material); assert.equal(broken.mesh.geometry, broken.geometry);
    assert.equal(broken.fixtureLight.visible, true); assert.equal(broken.lighting.sun.userData.bakedShadow, undefined);
    if (kind === 'probe') assert.equal(m.userData.probeLit, undefined);
  }
  // Oversize rejection precedes atlas download/decoding, and releases no scene resources.
  globalThis.fixtureRequests = []; const small = fixture(); small.renderer.capabilities.maxTextureSize = 1;
  await assert.rejects(applyLightmaps({ ...small, tier: 'mobile' }), /maxTextureSize/);
  assert.ok(!globalThis.fixtureRequests.some(u => u.endsWith('.webp')));
  // UI methods can run against a tiny DOM fixture without a browser.
  const uiCode = await readFile(join(root, 'src/ui.js'), 'utf8');
  globalThis.localStorage = { getItem: () => 'en', setItem() {} };
  const { UI, setLang, t } = await import(`data:text/javascript;base64,${Buffer.from(uiCode).toString('base64')}`);
  class El {
    constructor(tag) { this.tag = tag; this.children = []; this.textContent = ''; this.dataset = {}; this.attrs = {}; this.classes = new Set(); this.classList = { toggle: (k, on) => on ? this.classes.add(k) : this.classes.delete(k) }; }
    append(...xs) { this.children.push(...xs); } appendChild(x) { this.children.push(x); } replaceChildren() { this.children = []; }
    querySelector() { return this.label ??= new El('span'); }
    setAttribute(k, v) { this.attrs[k] = v; } removeAttribute(k) { delete this.attrs[k]; }
  }
  const els = Object.fromEntries(['btn-dusk', 'legend-dusk', 'controlsBody'].map(k => [k, new El('div')]));
  globalThis.document = { documentElement: {}, querySelectorAll: () => [], getElementById: id => els[id], createElement: tag => new El(tag) };
  globalThis.dispatchEvent = () => {};
  const ui = Object.create(UI.prototype); ui.state = { baked: true };
  const flatten = e => [e.textContent, ...e.children.map(x => typeof x === 'string' ? x : flatten(x))].join(' ');
  for (const language of ['en', 'zh']) for (const coarse of [false, true]) {
    setLang(language); globalThis.matchMedia = () => ({ matches: coarse });
    ui.state.baked = true; ui.renderHelp(); ui.syncLegends();
    assert.ok(!flatten(els.controlsBody).includes('Day · dusk')); assert.ok(!flatten(els.controlsBody).includes('白天 · 黄昏'));
    assert.ok(!flatten(els.controlsBody).includes('pins, dusk')); assert.ok(!flatten(els.controlsBody).includes('标记、黄昏'));
    assert.ok(els['btn-dusk'].disabled); assert.ok(els['btn-dusk'].classes.has('hidden')); assert.ok(t('sunriseOnly').length > 10);
    ui.state.bakedSlots = ['sunrise', 'noon', 'golden', 'dusk']; ui.state.bakedSlot = 'dusk';
    ui.renderHelp(); ui.syncLegends();
    assert.equal(els['btn-dusk'].disabled, false); assert.equal(els['btn-dusk'].classes.has('hidden'), false);
    assert.equal(els['btn-dusk'].attrs['aria-keyshortcuts'], 'N');
    assert.equal(els['btn-dusk'].attrs['aria-label'], t('slot_dusk'));
    assert.ok(flatten(els.controlsBody).includes(coarse ? t('touchMenuSlotsHelp') : t('slotHelp')));
    delete ui.state.bakedSlots;
    ui.state.baked = false; ui.renderHelp(); ui.syncLegends();
    assert.equal(els['btn-dusk'].disabled, false); assert.equal(els['btn-dusk'].classes.has('hidden'), false);
    assert.equal(els['btn-dusk'].attrs['aria-keyshortcuts'], 'N');
    if (!coarse) assert.ok(flatten(els.controlsBody).includes(language === 'en' ? 'Day · dusk' : '白天 · 黄昏'));
  }
  console.log('baked default: opt-outs, capabilities, tier policy, 10 atomic asset failures, strict success/progress/disposal, atlas size, bilingual desktop/mobile UI OK');
} finally { await rm(dir, { recursive: true, force: true }); }
