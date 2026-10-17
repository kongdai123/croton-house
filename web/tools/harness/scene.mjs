// Headless build of the real house: no WebGL renderer, no browser. Mirrors main.js: buildHouse(house.json), Layout
// with every placement, lighting.collectMaterials (interior/exterior material split + light switches + wall plates),
// batchStatic (lmId / lmSkip / still parts). Deterministic: planting is seeded, ids hash world vertices.
//
//   import { buildRealScene } from './harness/scene.mjs';
//   const world = await buildRealScene();   // { T, scene, houseRoot, layout, doors, switches, lighting, house, ... }
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

export const WEB = fileURLToPath(new URL('../../', import.meta.url));
let cached;

// Module-private pure helpers that the lighting audit lists are exposed by appending an export to the module source at
// bundle time (nothing in web/src changes): the harness then calls the real function instead of a copy.
const INTERNALS = {
  'src/lightmap.js': 'weatherClass as __weatherClass, isMirror as __isMirror',
  'src/photo.js': 'presentation as __presentation, weatherClass as __weatherClass',
  'src/foliage_bake.js': 'isPlant as __isPlant',
  'src/puddles.js': 'wetMaterial as __wetMaterial, indoors as __indoors',
  'src/furniture/light_switch.js': 'glowing as __glowing',
};
const internals = { name: 'harness-internals', setup(b) {
  b.onLoad({ filter: /\/src\/.*\.js$/ }, async ({ path }) => {
    const rel = Object.keys(INTERNALS).find(k => path.endsWith('/' + k));
    if (!rel) return null;
    return { contents: (await readFile(path, 'utf8')) + `\nexport { ${INTERNALS[rel]} };\n`, loader: 'js' };
  });
} };

// Shims shared with the other node tests (test_still_parts / test_scene_rebake): a deep Proxy stands in for canvas 2D
// contexts, element creation and any WebGL-ish object that is only touched, never read back.
function installShims() {
  globalThis.location = { search: '' };
  globalThis.window ??= globalThis;
  try { Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node-harness' }, configurable: true }); } catch { /* node already defines it */ }
  const store = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) } });
  globalThis.devicePixelRatio = 1; globalThis.innerWidth = 1280; globalThis.innerHeight = 720;
  const deep = new Proxy(function () {}, { get: (t, k) => k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : deep, set: () => true, apply: () => deep });
  // canvas 2D: drawing calls are no-ops, pixel reads return a zeroed buffer of the requested size (plants read back their sprites)
  const image = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4)) });
  const ctx2d = new Proxy({}, { get: (o, k) => k in o ? o[k] : k === 'getImageData' ? (x, y, w, h) => image(w, h) : k === 'createImageData' ? (w, h) => image(w, h)
    : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : k === 'measureText' ? () => ({ width: 0 }) : k === 'canvas' ? {} : () => deep, set: (o, k, v) => { o[k] = v; return true; } });
  const element = () => ({ getContext: () => ctx2d, addEventListener() {}, removeEventListener() {}, setAttribute() {}, style: {}, width: 0, height: 0 });
  globalThis.document = { createElement: element, createElementNS: element, getElementById: () => null, addEventListener() {} };
  globalThis.Image = class { addEventListener() {} removeEventListener() {} set src(v) {} };
  // Image textures never load (no network): the fetch shim answers 404 so nothing hangs.
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}), blob: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) });
  return deep;
}

export async function buildRealScene() {
  if (cached) return cached;
  const dir = await mkdtemp(join(tmpdir(), 'croton-harness-'));
  try {
    const built = await build({ stdin: { contents: `
      export * as T from 'three';
      export { buildHouse, getDoors, getColliders, CEIL, EXT_FP, pointInPoly } from './src/house.js';
      export * as houseConsts from './src/house.js';
      export { Layout, PLACEMENTS } from './src/layout.js';
      export { collectLightSwitches, WALL_SWITCHES } from './src/furniture/light_switch.js';
      export { batchStatic, meshId, stillParts } from './src/batch.js';
      export { emitsLight } from './src/materials.js';
      export { createLighting } from './src/lighting.js';
      export { buildGarden } from './src/grass.js';
      export { areaOf, isIndoor } from './src/pets/roam.js';
      export * as plan from './src/plan.js';
      export { __weatherClass as lightmapWeatherClass, __isMirror as lightmapIsMirror, PROBE_WALL_PIECES as probeWallPieces, probeWalls } from './src/lightmap.js';
      export { __presentation as photoPresentation, __weatherClass as photoWeatherClass } from './src/photo.js';
      export { __isPlant as foliageIsPlant } from './src/foliage_bake.js';
      export { __wetMaterial as puddlesWetMaterial, __indoors as puddlesIndoors } from './src/puddles.js';
      export { __glowing as switchGlowing } from './src/furniture/light_switch.js';`, resolveDir: WEB },
      bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent', sourcemap: false, plugins: [internals] });
    const file = join(dir, 'harness-bundle.mjs'); await writeFile(file, built.outputFiles[0].contents);
    const deep = installShims();
    const lib = await import(pathToFileURL(file));
    const { T } = lib;
    const house = JSON.parse(await readFile(join(WEB, 'data/house.json'), 'utf8'));
    const points = JSON.parse(await readFile(join(WEB, 'data/floorplan_points.json'), 'utf8'));
    const scene = new T.Scene();
    // lighting: createLighting needs a renderer only to size post targets and PMREM; a deep stub is enough for
    // fixtures + collectMaterials, which is all main.js uses before batching.
    const renderer = deep;
    const lighting = lib.createLighting(renderer, scene, new T.PerspectiveCamera(), house, { name: 'laptop', hq: false });
    const houseRoot = lib.buildHouse(house); scene.add(houseRoot);
    const garden = lib.buildGarden({ quality: 'laptop', camera: new T.PerspectiveCamera() }); scene.add(garden.group);
    const layout = new lib.Layout(scene, lighting.fixtures, house, points);
    await layout.build(() => {});
    lighting.collectMaterials(scene);
    const doors = lib.getDoors();
    const batch = lib.batchStatic([houseRoot, layout.root], { skip: doors.map(d => d.group), anchors: layout.interactive, animated: layout.animated });
    scene.updateMatrixWorld(true);
    cached = { ...lib, scene, houseRoot, garden, layout, lighting, house, points, doors, batch, switches: lighting.lightSwitches, fixtures: lighting.fixtures };
    return cached;
  } finally { await rm(dir, { recursive: true, force: true }); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const t0 = performance.now();
  const w = await buildRealScene();
  let meshes = 0; w.scene.traverse(o => { if (o.isMesh) meshes++; });
  console.log(`scene built in ${((performance.now() - t0) / 1000).toFixed(1)} s: ${meshes} meshes, ${w.layout.placed.length} placed, ${w.doors.length} doors, ${w.switches.length} switches`);
}
