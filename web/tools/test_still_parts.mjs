// Animated and toggled furniture: the parts that never move get lightmap ids (batch.js stillParts / batchStatic), the
// moving ones keep the probe volume; wall switch face plates get ids. CPU only (no WebGL, browser or GPU).
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const dir = await mkdtemp(join(tmpdir(), 'croton-still-'));
try {
  const built = await build({ stdin: { contents: `export * as T from 'three'; export { stillParts, batchStatic } from './src/batch.js';
    export { items as decor } from './src/furniture/decor.js'; export { items as outdoor } from './src/furniture/outdoor.js';
    export { items as garage } from './src/furniture/garage.js'; export { items as plants } from './src/furniture/plants.js';`,
    resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
  const file = join(dir, 'fixture.mjs'); await writeFile(file, built.outputFiles[0].contents);
  globalThis.location = { search: '' };
  const deep = new Proxy(function () {}, { get: (t, k) => k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : deep, set: () => true, apply: () => deep });
  const context = deep;
  const element = () => ({ getContext: () => context, addEventListener() {}, removeEventListener() {}, setAttribute() {}, style: {} });
  globalThis.document = { createElement: element, createElementNS: element };
  const { T, stillParts, batchStatic, decor, outdoor, garage, plants } = await import(pathToFileURL(file));
  const meshes = r => { const out = []; r.traverse(o => { if (o.isMesh) out.push(o); }); return out; };
  const cases = { cellularShade: decor.cellularShade, curtainSheer: decor.curtainSheer, umbrella: outdoor.umbrella, firePit: outdoor.firePit, garageDoorOpen: garage.garageDoorOpen };   // plants paint canvases this mock cannot hold: checked in the browser
  const report = {};
  for (const [name, make] of Object.entries(cases)) {
    if (!make) continue;
    const scene = new T.Scene(), root = make(); scene.add(root);
    const before = root.userData.toggle ? [root.userData.toggle.on, root.userData.toggle.value] : null;
    const still = stillParts(root), all = meshes(root);
    if (before) assert.deepEqual([root.userData.toggle.on, root.userData.toggle.value], before, `${name}: toggle restored`);
    report[name] = `${still.length}/${all.length} still`;
    if (name !== 'firePit') assert.ok(still.length < all.length, `${name}: something moves`);   // the fire's flames are a shader, its glow a material: no mesh moves
    if (['cellularShade', 'umbrella', 'firePit', 'garageDoorOpen'].includes(name)) assert.ok(still.length > 0, `${name}: a still part`);
    // a still part holds still through a whole toggle cycle and animation
    const m0 = still.map(o => o.matrixWorld.clone());
    root.userData.toggle?.set(!root.userData.toggle.on, true); root.userData.animate?.(3.3); scene.updateMatrixWorld(true);
    still.forEach((o, i) => assert.ok(o.matrixWorld.equals(m0[i]), `${name}: still part moved`));
  }
  // batchStatic: still parts of a toggled root get ids and stay unmerged and visible; the moving parts get none
  const scene = new T.Scene(), houseRoot = new T.Group(), layoutRoot = new T.Group(); scene.add(houseRoot, layoutRoot);
  const shade = decor.cellularShade(); layoutRoot.add(shade);
  batchStatic([houseRoot, layoutRoot], { anchors: [shade], animated: [shade] });
  const ids = meshes(shade).filter(o => o.userData.lmId), none = meshes(shade).filter(o => !o.userData.lmId);
  assert.ok(ids.length > 0 && none.length > 0); assert.ok(ids.every(o => o.visible && !o.userData.batched));
  console.log('still parts:', JSON.stringify(report), '; batchStatic ids on still parts only OK');
} finally { await rm(dir, { recursive: true, force: true }); }
