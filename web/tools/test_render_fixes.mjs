// Node fixtures only: no browser, fetch, renderer or GPU.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../', import.meta.url)), dir = await mkdtemp(join(tmpdir(), 'croton-render-fixes-'));
const info = console.info, warn = console.warn, location = globalThis.location;
try {
  const entry = await readFile(join(root, 'src/webgpu/entry.js'), 'utf8'), warnings = [];
  console.warn = (...args) => warnings.push(args); console.info = () => {};
  for (const mode of ['ordinary', 'missing', 'loaded', 'rejected', 'legacy', 'lightmap0', 'webgpu0']) {
    const base = join(dir, mode); await mkdir(join(base, 'src/webgpu'), { recursive: true });
    await writeFile(join(base, 'package.json'), '{"type":"module"}');
    await writeFile(join(base, 'src/webgpu/entry.js'), entry);
    await writeFile(join(base, 'src/main.js'), 'globalThis.fixtureGL++;');
    if (mode === 'loaded') await writeFile(join(base, 'src/webgpu/webgpu.js'), 'globalThis.fixtureGPU++;');
    if (mode === 'rejected') await writeFile(join(base, 'src/webgpu/webgpu.js'), 'throw new Error("fixture load failure");');
    globalThis.location = { search: { ordinary: '', legacy: '?webgpu&legacy', lightmap0: '?webgpu&lightmap=0', webgpu0: '?webgpu=0' }[mode] ?? '?webgpu&lightmap=sunrise' };
    globalThis.fixtureGL = globalThis.fixtureGPU = 0; const n = warnings.length;
    await import(pathToFileURL(join(base, 'src/webgpu/entry.js')));
    assert.equal(globalThis.fixtureGL, +(mode !== 'loaded')); assert.equal(globalThis.fixtureGPU, +(mode === 'loaded'));
    assert.equal(warnings.length - n, +['missing', 'rejected'].includes(mode));
    if (warnings.length > n) assert.match(warnings[n][0], /using WebGL/);
  }
  const roam = { name: 'ground-stub', setup(b) {
    b.onResolve({ filter: /\/pets\/roam\.js$/ }, () => ({ path: 'ground', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const groundY = () => 0;' }));
  } };
  const built = await build({ stdin: { contents: "export * as THREE from 'three'; export { createTAA } from './src/taa.js'; export { createContact } from './src/contact.js';", resolveDir: root }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', plugins: [roam] });
  const file = join(dir, 'fixture.mjs'); await writeFile(file, built.outputFiles[0].contents);
  globalThis.location = { search: '?contact&lightmap=sunrise' };
  const { THREE, createTAA, createContact } = await import(pathToFileURL(file));
  const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 100), scene = new THREE.Scene();
  const renderer = { getPixelRatio: () => 1, domElement: { addEventListener() {}, removeEventListener() {} } };
  const composer = { passes: [], renderTarget1: new THREE.WebGLRenderTarget(1, 1), renderTarget2: new THREE.WebGLRenderTarget(1, 1),
    insertPass(p, i) { this.passes.splice(i, 0, p); p.setSize(1280, 720); }, removePass(p) { this.passes.splice(this.passes.indexOf(p), 1); }, dispose() {} };
  composer.passes.push({ scene, isRenderPass: true, setSize() {} }, { isOutputPass: true });
  const lighting = { composer, setQuality() {}, applyTime: async () => {} };
  const mat = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), normalMap: new THREE.Texture() });
  let chained = 0; mat.onBeforeCompile = sh => { chained++; sh.fragmentShader += '\nvec4 prior = texture2D(map, vMapUv);'; };
  mat.customProgramCacheKey = () => 'prior'; const original = mat.onBeforeCompile;
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), mat));
  const taa = createTAA(renderer, camera, lighting); taa.patchTextures();
  const shader = { uniforms: {}, fragmentShader: '#include <map_fragment>\n#include <alphamap_fragment>\n#include <normal_fragment_maps>\n#include <bumpmap_pars_fragment>\nvec4 shadow = texture2D(uSunDepth, uv); vec4 post = texture2D(tCurrent, uv);' };
  mat.onBeforeCompile(shader, renderer);
  assert.equal(chained, 1); assert.equal(shader.uniforms.uTaaLodBias, taa.lodBias); assert.equal(taa.lodBias.value, Math.log2(0.75) + taa.settings.mipBias); assert.equal(taa.settings.mipBias, -0.5);
  for (const name of ['map', 'alphaMap', 'normalMap', 'bumpMap']) assert.match(shader.fragmentShader, new RegExp('taaSample\\(\\s*' + name + ','));
  assert.match(shader.fragmentShader, /texture2D\(uSunDepth, uv\)/); assert.match(shader.fragmentShader, /texture2D\(tCurrent, uv\)/);
  assert.equal(mat.customProgramCacheKey(), 'prior|taa-lod-bias-v1'); assert.equal(taa.settings.sharpen, 0.55);
  const hook = mat.onBeforeCompile; taa.patchTextures(); assert.equal(mat.onBeforeCompile, hook);
  taa.valid = true; taa.setScale(0.5); assert.equal(shader.uniforms.uTaaLodBias.value, -1.5); assert.equal(taa.valid, false);
  taa.setScale(1); assert.equal(shader.uniforms.uTaaLodBias.value, -0.5);
  const late = mat.clone(); late.onBeforeCompile = mat.onBeforeCompile; late.customProgramCacheKey = mat.customProgramCacheKey;
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), late)); taa.patchTextures(); assert.equal(taa.materials.size, 2);
  const clonedShader = { uniforms: {}, fragmentShader: '#include <map_fragment>' }; late.onBeforeCompile(clonedShader, renderer);
  assert.equal(clonedShader.fragmentShader.match(/uniform float uTaaLodBias/g).length, 1);
  // per frame: the whole scene once (and after invalidateTextures), then a slice per frame; a drawn material at once
  {
    const s = new THREE.Scene(), cam = new THREE.PerspectiveCamera(), calls = [];
    const r = { getPixelRatio: () => 1, domElement: { addEventListener() {}, removeEventListener() {} }, renderBufferDirect(...a) { calls.push(a); } };
    const c = { passes: [], renderTarget1: new THREE.WebGLRenderTarget(1, 1), renderTarget2: new THREE.WebGLRenderTarget(1, 1),
      insertPass(p, i) { this.passes.splice(i, 0, p); p.setSize(64, 64); }, removePass() {}, dispose() {} };
    c.passes.push({ scene: s, isRenderPass: true, setSize() {} }, { isOutputPass: true });
    const p = createTAA(r, cam, { composer: c, setQuality() {}, applyTime: async () => {} });
    const textured = () => new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
    const group = new THREE.Group(); s.add(group);
    for (let i = 0; i < 1000; i++) group.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    const first = textured(); group.add(new THREE.Mesh(new THREE.BoxGeometry(), first));
    p.updateTextures(); assert.ok(p.materials.has(first), 'the first frame visits the whole scene');
    const late = textured(); group.add(new THREE.Mesh(new THREE.BoxGeometry(), late));
    p.updateTextures(); assert.ok(!p.materials.has(late), 'later frames visit a slice, not the whole scene');
    let frames = 1; while (!p.materials.has(late) && frames < 10) { p.updateTextures(); frames++; }
    assert.ok(p.materials.has(late) && frames <= Math.ceil(1003 / 400) + 1, `the slices reach every node (${frames} frames)`);
    // a material the scene draws inside the pass is patched before its program is chosen, and only once per version
    const drawnLate = textured(), mesh = new THREE.Mesh(new THREE.BoxGeometry(), drawnLate); group.add(mesh);
    p.drawing = true; r.renderBufferDirect(cam, s, mesh.geometry, drawnLate, mesh, null); p.drawing = false;
    assert.ok(p.materials.has(drawnLate) && calls.length === 1, 'a drawn material is patched before its draw');
    const other = textured(); r.renderBufferDirect(cam, new THREE.Scene(), mesh.geometry, other, mesh, null);
    assert.ok(!p.materials.has(other), 'draws of other scenes (puddle copies, depth scenes) are left alone');
    const hook = drawnLate.onBeforeCompile; p.drawing = true; r.renderBufferDirect(cam, s, mesh.geometry, drawnLate, mesh, null); p.drawing = false;
    assert.equal(drawnLate.onBeforeCompile, hook);
    const gained = new THREE.MeshStandardMaterial(), m2 = new THREE.Mesh(new THREE.BoxGeometry(), gained); group.add(m2);
    p.drawing = true; r.renderBufferDirect(cam, s, m2.geometry, gained, m2, null); assert.ok(!p.materials.has(gained));
    gained.map = new THREE.Texture(); gained.needsUpdate = true; r.renderBufferDirect(cam, s, m2.geometry, gained, m2, null); p.drawing = false;
    assert.ok(p.materials.has(gained), 'a map that arrives later (a new material version) is patched at its next draw');
    const inv = textured(); group.add(new THREE.Mesh(new THREE.BoxGeometry(), inv)); p.invalidateTextures(); p.updateTextures();
    assert.ok(p.materials.has(inv), 'invalidateTextures: the whole scene at the next frame');
    c.dispose();
  }
  taa.dispose(); assert.equal(mat.onBeforeCompile, original); assert.equal(mat.customProgramCacheKey(), 'prior');

  const movables = [], contactScene = new THREE.Scene(), human = { root: new THREE.Group() }, player = { enabled: false };
  human.root.visible = false; contactScene.add(human.root);
  function movable(x, z, parent = contactScene) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.2), new THREE.MeshStandardMaterial());
    m.position.set(x, 0, z); parent.add(m); movables.push(m); return m;
  }
  for (let i = 24; i >= 1; i--) movable(0, -i);
  movable(100, -1); movable(0, 2);
  const hidden = new THREE.Group(); hidden.visible = false; contactScene.add(hidden); movable(0, -0.5, hidden);
  const pet = movable(0, -30); movables.pop();
  // a pet's stand-in shadow, declared as cat.js does (lighting manifest: fakeShadow)
  const petBlob = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial()); petBlob.userData.lighting = { role: 'presentation', fakeShadow: true }; pet.add(petBlob);
  const contactLighting = { composer: { insertPass() {}, removePass() {} } };
  const contact = createContact({ scene: contactScene, camera, lighting: contactLighting, movables, pets: { agents: [{ root: pet }] }, human, player });
  assert.equal(petBlob.visible, false);
  assert.equal(contact.stats.capacity, 16); assert.equal(contact.uniforms.uContactPos.value.length, 16);
  assert.equal(contact.stats.active, 16); assert.equal(contact.stats.omitted, 9);
  assert.deepEqual(contact.uniforms.uContactPos.value.map(v => v.z), Array.from({ length: 16 }, (_, i) => -i - 1));
  pet.position.z = -0.75; contact.update(); assert.equal(contact.uniforms.uContactPos.value[0].z, -0.75);
  camera.rotation.y = Math.PI; contact.update(); assert.equal(contact.stats.active, 1); assert.equal(contact.uniforms.uContactPos.value[0].z, 2);
  contact.setEnabled(false); contact.update(); assert.equal(contact.uniforms.uContactCount.value, 0);
  assert.equal(contact.pass.enabled, false); assert.equal(petBlob.visible, true);
  contact.setEnabled(true); assert.equal(contact.pass.enabled, true); assert.equal(petBlob.visible, false);
  contact.dispose(); assert.equal(petBlob.visible, true);

  // Exercise the owned foliage function without importing the walkthrough or its DOM startup.
  const main = await readFile(join(root, 'src/main.js'), 'utf8'), fn = main.match(/function setFoliageAA\(on\) \{[\s\S]*?\n\}/)[0];
  const foliage = new THREE.MeshStandardMaterial({ alphaTest: 0.5 });
  const setAA = new Function('foliageMaterials', 'lighting', fn + '; return setFoliageAA;')(new Set([foliage]), lighting);
  lighting.taa = {}; setAA(false); assert.equal(foliage.alphaTest, 0.225); assert.equal(foliage.alphaToCoverage, false);
  setAA(false); assert.equal(foliage.alphaTest, 0.225);
  lighting.taa = null; setAA(true); assert.equal(foliage.alphaTest, 0.225); assert.equal(foliage.alphaToCoverage, true);
  setAA(false); assert.equal(foliage.alphaTest, 0.5);
  info('render fixes: WebGPU fallback, TAA shader bias/scale/hooks, foliage cutoff, nearest 16 visible AO proxies OK');
} finally {
  console.info = info; console.warn = warn; globalThis.location = location; delete globalThis.fixtureGL; delete globalThis.fixtureGPU;
  await rm(dir, { recursive: true, force: true });
}
