// CPU fixtures for the combined rebake: no browser, renderer or network.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const dir = await mkdtemp(join(tmpdir(), 'croton-rebake-'));
try {
  const internals = { name: 'pillow-fixture', setup(b) {
    b.onLoad({ filter: /\/furniture\/living\.js$/ }, async ({ path }) => ({ contents: (await readFile(path, 'utf8')).replace('normalMap: clothWeave(),', '') + '\nexport { pillowBody };', loader: 'js' }));
  } };
  const built = await build({ stdin: { contents: `export * as T from 'three'; export { PLACEMENTS } from './src/layout.js';
    export { items as decor } from './src/furniture/decor.js'; export { items as outdoor } from './src/furniture/outdoor.js';
    export { pillowBody } from './src/furniture/living.js'; export { puffGeo, ruffle } from './src/furniture/bedrooms_parts.js';
    export { collectLightSwitches } from './src/furniture/light_switch.js'; export { defaultOn, lampGroupGLSL, createLampGroups } from './src/lamp_groups.js';
    export { probeLit } from './src/lightmap.js';
    export { lightingOf } from './src/lighting_roles.js';`, resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent', plugins: [internals] });
  const file = join(dir, 'fixture.mjs'); await writeFile(file, built.outputFiles[0].contents);
  globalThis.location = { search: '' };
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null, setItem() {} }, configurable: true });
  const image = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4)) });
  const context = new Proxy({}, { get: (o, k) => o[k] ?? (k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} })
    : k === 'getImageData' || k === 'createImageData' ? (...a) => image(a.at(-2), a.at(-1)) : k === 'measureText' ? () => ({ width: 0 }) : () => {}) });
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  const { T, PLACEMENTS, decor, outdoor, pillowBody, puffGeo, ruffle, collectLightSwitches, defaultOn, lampGroupGLSL, createLampGroups, lightingOf, probeLit } = await import(pathToFileURL(file));
  // default slots are the groups' (lighting manifest); the always group is always on
  for (const slot of ['sunrise', 'noon', 'golden', 'dusk']) {
    assert.equal(defaultOn(slot, { always: true }), true); assert.equal(defaultOn(slot, { defaultOn: ['dusk'] }), slot === 'dusk');
  }
  const scene = new T.Scene(), fixtures = new T.Group();
  // The porch sconce and a baked bath can as placed (their placement rows declare the plates), and the garden lantern.
  const place = (make, row) => { const o = make(); o.userData.placement = row; o.position.set(row.x, row.h ?? 0, -row.y); o.rotation.y = row.ry ?? 0; scene.add(o); return o; };
  const sconce = place(decor.wallLightBlack, PLACEMENTS.find(p => p.i === 'wallLightBlack'));
  const canRow = PLACEMENTS.find(p => p.i === 'recessedLight' && p.bake && p.lamp?.plate); assert.equal(canRow.light, false);
  place(decor.recessedLight, canRow);
  const lantern = outdoor.frontLamp(); lantern.userData.placement = PLACEMENTS.find(p => p.i === 'frontLamp');
  assert.equal(lantern.userData.placement.bake, true); assert.equal(lantern.userData.placement.light, false);
  lantern.position.set(-3.25, 0.22, 10.1); scene.add(lantern);
  const switches = collectLightSwitches(scene, fixtures), plates = scene.children.filter(o => o.name.startsWith('wall-switch-'));
  assert.deepEqual(plates.map(p => p.name).sort(), ['wall-switch-' + switches.find(s => s.lighting.id === 'decor-recessed-light').lighting.group, 'wall-switch-porch'].sort());
  for (const plate of plates) {
    assert.equal(plate.position.y, 1.12); assert.ok(switches.some(s => s.toggle === plate.userData.lightSwitch));
    plate.userData.lightSwitch.set(false); plate.userData.lightSwitch.tick(0.25);
    assert.equal(plate.userData.lightSwitch.value, 0);
    assert.ok(plate.children.every(o => o.userData.noBatch));
  }
  const garden = switches.find(s => s.root === lantern); assert.ok(garden); assert.equal(lantern.userData.onTime, undefined);
  const porch = switches.find(s => s.root === sconce);
  assert.ok(porch.lighting.exterior && garden.lighting.exterior && porch.lighting.group === 'porch' && garden.lighting.group === 'porch');
  const members = [porch, garden].map(s => ({ id: s.root.userData.id, root: [s.root.position.x, -s.root.position.z, s.root.position.y], w: 0.5 }));
  const lamps = createLampGroups({ meta: { textures: 1, groups: [{ name: 'porch', index: 0, tex: 0, ch: 0, color: [1, 1, 1], K: 1, members }] }, switches: [porch, garden] });
  lamps.reset('dusk'); lamps.update(0, 'dusk'); lamps.applyGlow();
  for (const glow of garden.toggle.glows) assert.equal(glow.material.emissiveIntensity, glow.base * 1.8);
  porch.toggle.set(false); lamps.update(0.25, 'dusk'); lamps.applyGlow();
  for (const glow of garden.toggle.glows) assert.equal(glow.material.emissiveIntensity, 0);
  assert.equal(garden.toggle.on, false); lamps.dispose();
  for (const make of [decor.cellularShade, decor.cellularShadeNarrow]) {
    const shade = make(), materials = new Set(); shade.traverse(o => { if (o.material?.userData.sheer) materials.add(o.material); });
    assert.equal(materials.size, 1);
    for (const m of materials) {
      assert.deepEqual(m.userData.sheer, { reflect: 0.65, transmit: 0.35 }); assert.equal(!!lightingOf(m).emits, false); assert.equal(m.emissiveIntensity * m.emissive.getHex(), 0);
      // the composed probe shader reads the cloth from both faces, at the manifest's reflect / transmit split
      const sh = { uniforms: {}, vertexShader: T.ShaderLib.physical.vertexShader, fragmentShader: T.ShaderLib.physical.fragmentShader };
      probeLit(m, { uniforms: {}, wet: 0 }, { uniforms: {} }); m.onBeforeCompile(sh, {});
      assert.equal(sh.uniforms.uSheer.value.y, 0.35); assert.ok(sh.fragmentShader.includes('probeEval( bakedProbe, - sheerN )'));
    }
  }
  const pillow = pillowBody(0.4, 0.12, true), body = pillow.children[0].geometry.attributes.position;
  const flange = pillow.children[1].geometry.parameters.shapes, path = pillow.children[2].geometry.parameters.path;
  for (const point of path.points) assert.ok(flange.getPoints().some(p => Math.hypot(p.x - point.x, p.y - point.z) < 1e-6));
  let equator = 0;
  for (let i = 0; i < body.count; i++) if (Math.abs(body.getY(i)) < 1e-8) { equator++; assert.ok(path.points.some(p => Math.hypot(p.x / 1.06 - body.getX(i), p.z / 1.06 - body.getZ(i)) < 1e-5)); }
  assert.equal(equator, 64);
  const w = 0.64, d = 0.48, geo = puffGeo(w, d, 0.12), seam = ruffle(w, d, new T.MeshStandardMaterial()).geometry.parameters.path;
  // Check the seam against line segments of the actual deformed mesh's equator, including the 6% mid-span bow.
  const pos = geo.attributes.position, idx = geo.index, edges = [];
  for (let i = 0; i < idx.count; i += 3) for (let k = 0; k < 3; k++) {
    const a = new T.Vector3().fromBufferAttribute(pos, idx.getX(i + k)), b = new T.Vector3().fromBufferAttribute(pos, idx.getX(i + (k + 1) % 3));
    if (Math.abs(a.y) < 1e-8 && Math.abs(b.y) < 1e-8) edges.push(new T.Line3(a, b));
  }
  assert.ok(seam.points.some(p => p.x > w / 2 * 1.05));
  for (const p of seam.points) assert.ok(Math.min(...edges.map(e => e.closestPointToPoint(new T.Vector3(p.x, 0, p.z), true, new T.Vector3()).distanceTo(new T.Vector3(p.x, 0, p.z)))) < 0.001);
  const glsl = lampGroupGLSL(8);
  assert.equal((glsl.match(/sampler2DArray/g) ?? []).length, 1); assert.ok(glsl.includes('uLampK7')); assert.ok(!glsl.includes('uLampK8'));
  console.log('scene rebake: 8 group layers, slot defaults, declared wall plates, baked bath can, porch lantern switching, cellular transmission and pillow edge geometry OK');
} finally { await rm(dir, { recursive: true, force: true }); }
