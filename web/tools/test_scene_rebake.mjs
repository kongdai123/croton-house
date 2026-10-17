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
    export { collectLightSwitches, WALL_SWITCHES } from './src/furniture/light_switch.js'; export { defaultOn, lampGroupGLSL, createLampGroups } from './src/lamp_groups.js';
    export { emitsLight, sheerProbePatch } from './src/materials.js';`, resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent', plugins: [internals] });
  const file = join(dir, 'fixture.mjs'); await writeFile(file, built.outputFiles[0].contents);
  globalThis.location = { search: '' };
  const context = new Proxy({}, { get: (o, k) => o[k] ?? (() => {}) });
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  const { T, PLACEMENTS, decor, outdoor, pillowBody, puffGeo, ruffle, collectLightSwitches, WALL_SWITCHES, defaultOn, lampGroupGLSL, createLampGroups, emitsLight, sheerProbePatch } = await import(pathToFileURL(file));
    const routing = await readFile(new URL('../../bake/scripts/lamp_groups.py', import.meta.url), 'utf8');
  const names = [...routing.match(/ORDER = (\[[\s\S]*?\])/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  assert.deepEqual(new Set(WALL_SWITCHES.map(s => s[0])), new Set(names.filter(n => n !== 'always')));
  assert.equal(names.length, 22);
  for (const name of names) for (const slot of ['sunrise', 'noon', 'golden', 'dusk']) {
    const expected = ['garage', 'always'].includes(name) || slot === 'dusk' || name === 'kitchenPendant' && slot === 'sunrise' || slot === 'golden' && ['living', 'livingNiche', 'kitchenPendant', 'dining'].includes(name);
    assert.equal(defaultOn(slot, { name, always: name === 'always' }), expected, `${slot}/${name}`);
  }
  const scene = new T.Scene(), fixtures = new T.Group();
  // Real cans and lantern plus the existing fixture identities exercise every plate's target matching.
  for (const [name, x, y, ry, id, tx, ty] of WALL_SWITCHES) {
    let root;
    const pl = PLACEMENTS.find(p => p.x === tx && p.y === ty && p.bake);
    if (pl) { assert.equal(pl.light, false); root = decor.recessedLight(); }
    else { root = new T.Group(); root.userData.lightFixture = { name }; const head = new T.Group(); head.userData.bulbY = 1; head.add(new T.Mesh(new T.BoxGeometry(0.1, 0.1, 0.1), new T.MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity: 1 }))); root.add(head); }
    root.userData.id = id; root.userData.placement = pl ?? {}; root.position.set(tx, 0, -ty); scene.add(root);
  }
  const lantern = outdoor.frontLamp(); lantern.userData.placement = PLACEMENTS.find(p => p.i === 'frontLamp');
  assert.equal(lantern.userData.placement.bake, true); assert.equal(lantern.userData.placement.light, false);
  lantern.position.set(-3.25, 0.22, 10.1); scene.add(lantern);
  const switches = collectLightSwitches(scene, fixtures), plates = scene.children.filter(o => o.name.startsWith('wall-switch-'));
  assert.equal(plates.length, WALL_SWITCHES.length);
  for (const plate of plates) {
    assert.equal(plate.position.y, 1.12); assert.ok(switches.some(s => s.toggle === plate.userData.lightSwitch));
    plate.userData.lightSwitch.set(false); plate.userData.lightSwitch.tick(0.25);
    assert.equal(plate.userData.lightSwitch.value, 0);
    assert.ok(plate.children.every(o => o.userData.noBatch));
  }
  const garden = switches.find(s => s.root === lantern); assert.ok(garden); assert.equal(lantern.userData.onTime, undefined);
  const porch = switches.find(s => s.root.userData.id === 'decor-wall-light-black');
  const members = [porch, garden].map(s => ({ id: s.root.userData.id, root: [s.root.position.x, -s.root.position.z, s.root.position.y], w: 0.5 }));
  const lamps = createLampGroups({ meta: { textures: 1, groups: [{ name: 'porch', index: 0, tex: 0, ch: 0, color: [1, 1, 1], K: 1, members }] }, switches: [porch, garden] });
  lamps.reset('dusk'); lamps.update(0, 'dusk'); lamps.applyGlow();
  for (const glow of garden.toggle.glows) assert.equal(glow.material.emissiveIntensity, glow.base * 1.8);
  porch.toggle.set(false); lamps.update(0.25, 'dusk'); lamps.applyGlow();
  for (const glow of garden.toggle.glows) assert.equal(glow.material.emissiveIntensity, 0);
  assert.equal(garden.toggle.on, false); lamps.dispose();
  // Door faces and room boundaries: plates sit on solid wall, outside the door/casing interval.
  const house = JSON.parse(await readFile(new URL('../data/house.json', import.meta.url)));
  for (const [name, x, y, ry] of WALL_SWITCHES) {
    const dx = -Math.sin(ry) * 0.02, dy = Math.cos(ry) * 0.02;
    const wall = house.walls.find(w => x + dx >= w.x0 && x + dx <= w.x1 && y + dy >= w.y0 && y + dy <= w.y1);
    assert.ok(wall, `${name}: plate needs wall backing`);
    assert.ok(!house.openings.some(o => o.wall === wall.id && (o.dir === 'V' ? y > o.y0 - 0.065 && y < o.y1 + 0.065 : x > o.x0 - 0.065 && x < o.x1 + 0.065)), `${name}: door/casing clearance`);
  }
  for (const make of [decor.cellularShade, decor.cellularShadeNarrow]) {
    const shade = make(), materials = new Set(); shade.traverse(o => { if (o.material?.userData.sheer) materials.add(o.material); });
    assert.equal(materials.size, 1);
    for (const m of materials) {
      assert.deepEqual(m.userData.sheer, { reflect: 0.65, transmit: 0.35 }); assert.equal(emitsLight(m), false); assert.equal(m.emissiveIntensity * m.emissive.getHex(), 0);
      const sh = { uniforms: {}, vertexShader: T.ShaderLib.physical.vertexShader, fragmentShader: T.ShaderLib.physical.fragmentShader.replace('#include <lights_fragment_maps>', 'irradiance += probeIrradiance( vProbeWorld, inverseTransformDirection( geometryNormal, viewMatrix ) );') };
      sheerProbePatch(sh, m); assert.equal(sh.uniforms.uSheer.value.y, 0.35); assert.ok(sh.fragmentShader.includes('- sheerN'));
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
  const glsl = lampGroupGLSL(Math.ceil(names.length / 3));
  assert.equal((glsl.match(/sampler2DArray/g) ?? []).length, 1); assert.ok(glsl.includes('uLampK7')); assert.ok(!glsl.includes('uLampK8'));
  console.log('scene rebake: 22 groups/8 layers, all slot defaults, 21 backed wall plates, baked bath/closet cans, porch lantern switching, cellular transmission and pillow edge geometry OK');
} finally { await rm(dir, { recursive: true, force: true }); }
