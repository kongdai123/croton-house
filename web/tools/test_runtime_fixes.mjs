// Runtime regressions without a browser or GPU; real switches, flights and shared navigation colliders.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const dir = await mkdtemp(join(tmpdir(), 'croton-runtime-'));
try {
  const internals = { name: 'runtime-fixtures', setup(b) {
    b.onLoad({ filter: /\/contact\.js$/ }, () => ({ contents: 'export const CONTACT = false; export function contactPatch() {}', loader: 'js' }));
    b.onLoad({ filter: /\/pets\/roam\.js$/ }, () => ({ contents: 'export const groundY = () => 0;', loader: 'js' }));
  } };
  const built = await build({ stdin: { contents: `export * as THREE from 'three'; export * from './src/tour.js';
    export { Viewpoints } from './src/viewpoints.js'; export { Interact } from './src/interact.js';
    export { getColliders, addAABB } from './src/house.js'; export { buildGrid } from './src/nav.js';
    export { createLampGroups } from './src/lamp_groups.js'; export { collectLightSwitches } from './src/furniture/light_switch.js';
    export { setLang } from './src/ui.js'; export { probeLit, reflGLSL } from './src/lightmap.js';`, resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', plugins: [internals] });
  const file = join(dir, 'fixture.mjs'); await writeFile(file, built.outputFiles[0].contents);
  const classList = { add() {}, remove() {} };
  globalThis.localStorage = { getItem: () => 'en', setItem() {} };
  globalThis.document = { body: { classList }, documentElement: {}, getElementById: () => ({ classList }), querySelectorAll: () => [] };
  globalThis.addEventListener = globalThis.dispatchEvent = () => {};
  globalThis.location = { search: '?agx=three' };
  globalThis.window = { __app: { state: { baked: true }, baked: { slotName: 'sunrise' } } };
  const { THREE: T, Tour, STOPS, Viewpoints, Interact, getColliders, addAABB, buildGrid, createLampGroups, collectLightSwitches, setLang, probeLit, reflGLSL } = await import(pathToFileURL(file));
  let caption = '';
  const ui = { setCaption(s) { caption = s; }, setLabel() {}, toast() {}, toggleLegends() {} };
  const player = { pos: new T.Vector3(), camera: new T.PerspectiveCamera(), yaw: 0, pitch: 0, eye: 1.58, keys: new Set(), resetJump() {}, forward() { return new T.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); } };
  const vp = Object.assign(Object.create(Viewpoints.prototype), { player, targets: [], ui, exitPano() {}, closeCompare() {} });
  const tour = new Tour(player, null, null, ui, vp);
  tour.start(); assert.ok(vp.fly.keepDriven); vp.update(0.001); tour.stop();
  assert.equal(vp.fly, null); vp.update(10); assert.equal(player.enabled, true); assert.equal(player.driven, false); assert.equal(tour.phase, 'idle');
  tour.start(); vp.update(1); assert.equal(tour.phase, 'hold'); assert.equal(player.driven, true);
  tour.update(6); assert.ok(vp.fly); player.keys.add('KeyW'); tour.update(0.01); vp.update(10);
  assert.equal(vp.fly, null); assert.equal(player.driven, false); player.keys.clear();
  tour.start();
  for (let i = 0; i < 100 && tour.active; i++) { vp.update(20); tour.update(10); }
  assert.equal(tour.active, false); assert.equal(tour.i, STOPS.length); assert.equal(player.enabled, true); assert.equal(player.driven, false);
  const backyard = STOPS.find(s => s.dusk);
  for (const lang of ['en', 'zh']) {
    setLang(lang);
    for (const slot of ['sunrise', 'noon', 'golden', 'dusk']) {
      window.__app.baked.slotName = slot; tour.showCaption(backyard);
      const expected = slot === 'sunrise' ? backyard[lang === 'zh' ? 'bakedZh' : 'bakedEn'] : slot === 'dusk' ? backyard[lang] : lang === 'zh' ? '后院 · 露台与花园' : 'The backyard · the patio and garden';
      assert.ok(caption.startsWith(expected));
    }
    window.__app.baked = null; tour.showCaption(backyard); assert.ok(caption.startsWith(backyard[lang]));
    window.__app.baked = { slotName: 'sunrise' };
  }
  // A closed moving half blocks both walking's list and the default flight grid, in either wall orientation.
  for (const isH of [true, false]) {
    getColliders().length = 0;
    const d = { id: 'bedroom', kind: 'slider', open: 0.6, w: 1, thick: 0.12, plan: { cx: 0, cy: 0, isH } };
    addAABB(isH ? -1 : -0.06, isH ? 0 : 0.06, isH ? -0.06 : 0, isH ? 0.06 : 1, 'slider');
    const point = isH ? [0.5, 0] : [0, -0.5], fixed = isH ? [-0.5, 0] : [0, 0.5];
    const press = () => Interact.prototype.toggleDoor.call({ ui, doorLabel: () => '' }, d);
    assert.ok(buildGrid().free(...point)); press();
    assert.equal(d.open, 0.02); assert.equal(getColliders().filter(c => c.tag === 'slider-bedroom').length, 1);
    assert.ok(!buildGrid().free(...point)); assert.ok(!buildGrid([], { doors: true }).free(...point)); press();
    assert.equal(d.open, 0.6); assert.ok(buildGrid().free(...point)); assert.ok(!buildGrid().free(...fixed));
  }
  getColliders().length = 0;
  // Five real fixture toggles share one pool, even with uneven energy weights; another group is independent.
  const scene = new T.Scene(), fixtures = new T.Group(), members = [];
  for (let i = 0; i < 6; i++) {
    const root = new T.Group(); root.userData = { id: 'lamp' + i, placement: {}, lighting: { fixture: { kind: 'lamp', label: { en: 'Lamp', zh: '灯' } } } };
    root.position.x = i; root.add(new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity: 1 })));
    scene.add(root); members.push({ id: root.userData.id, root: [i, 0, 0], w: (i + 1) / 15 });
  }
  const switches = collectLightSwitches(scene, fixtures), groups = [
    { index: 0, tex: 0, ch: 0, name: 'bedB', K: 1, color: [1, 1, 1], members: members.slice(0, 5) },
    { index: 1, tex: 0, ch: 1, name: 'garage', K: 1, color: [1, 1, 1], members: members.slice(5) },
    { index: 2, tex: 0, ch: 2, name: 'always', always: true, K: 1, color: [1, 1, 1], members: [] },
  ];
  const lamps = createLampGroups({ meta: { groups, textures: 1 }, switches });
  const tick = dt => { for (const s of switches) s.toggle.tick(dt); lamps.update(dt, 'dusk'); lamps.applyGlow(); };
  lamps.reset('dusk'); tick(0); assert.equal(lamps.matched, 6);
  switches[2].toggle.set(false); tick(0.125);
  assert.ok(switches.slice(0, 5).every(s => s.toggle.manual && !s.toggle.on)); assert.equal(lamps.levels[0], 0.5);
  assert.ok(switches.slice(0, 5).every(s => s.toggle.value === 0.5 && s.toggle.moving));
  for (const s of switches.slice(0, 5)) assert.equal(s.toggle.glows[0].material.emissiveIntensity, 0.9);
  tick(0.125); assert.equal(lamps.levels[0], 0); assert.equal(lamps.levels[1], 1); assert.equal(lamps.levels[2], 1);
  assert.ok(switches.slice(0, 5).every(s => s.toggle.value === 0 && !s.toggle.moving));
  switches[4].toggle.set(true); tick(0.25); assert.equal(lamps.levels[0], 1); assert.ok(switches.slice(0, 5).every(s => s.toggle.on));
  for (const slot of ['sunrise', 'noon', 'golden']) { lamps.reset(slot); lamps.update(0, slot); assert.equal(lamps.levels[0], 0); assert.equal(lamps.levels[1], 1); assert.equal(lamps.levels[2], 1); }
  lamps.dispose();
  // Generated mirror shaders keep 3 cm for box-edge bathroom mirrors; ordinary materials keep 25 cm.
  for (const mirror of [false, true]) {
    const mat = new T.MeshStandardMaterial(); if (mirror) mat.name = 'mirror';
    probeLit(mat, { uniforms: {}, refl: { count: 27, uniforms: {} } }, { patch() {} });
    const sh = { uniforms: {}, vertexShader: T.ShaderLib.standard.vertexShader, fragmentShader: T.ShaderLib.standard.fragmentShader };
    mat.onBeforeCompile(sh, { capabilities: { maxTextures: 16 } });
    assert.ok(sh.fragmentShader.includes('uReflMin[ i ] - ' + (mirror ? '0.03' : '0.25')));
    assert.ok(sh.fragmentShader.includes('if ( min( size.x, size.z ) < 0.3 ) continue;'));
    assert.ok(sh.fragmentShader.includes('#define REFL_COUNT 27'));
  }
  const meta = JSON.parse(await readFile(new URL('../assets/lightmaps/sunrise/refl/meta.json', import.meta.url), 'utf8'));
  const select = (P, margin, skip = true) => meta.filter(m => !skip || Math.min(m.max[0] - m.min[0], m.max[2] - m.min[2]) >= 0.3).map(m => ({ id: m.i, score: Math.hypot(...P.map((v, a) => v - m.p[a])) + (P.every((v, a) => v >= m.min[a] - margin && v <= m.max[a] + margin) ? 0 : 1000) })).sort((a, b) => a.score - b.score)[0].id;
  assert.equal(select([-5.873, 1.59, -3.04], 0.25), 2); assert.equal(select([-5.873, 1.59, -3.04], 0.03), 5);
  const bath = meta.find(m => m.i === 26); assert.equal(select([bath.min[0] - 0.02, 1.59, -1.07], 0.03), 26);
  const sliver = meta.find(m => m.i === 9); assert.ok(sliver.max[0] - sliver.min[0] < 0.3);
  assert.equal(select(sliver.p, 0.25, false), 9); assert.ok([6, 12].includes(select(sliver.p, 0.25)));
  assert.ok(reflGLSL(27, true, true).includes('float( best ) + uReflNext'));
  console.log('runtime fixes: tour stop/restart/completion, bilingual slot captions, slider collision/nav, grouped switches/defaults/glow, mirror margins and degenerate probe fallback OK');
} finally { await rm(dir, { recursive: true, force: true }); }
