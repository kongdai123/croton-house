// Node-only probe selection fixtures; the probe functions are named exports of lightmap.js.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../', import.meta.url)), dir = await mkdtemp(join(tmpdir(), 'croton-probe-walls-')), location = globalThis.location;
try {
  const internals = { name: 'probe-fixtures', setup(b) {
    b.onLoad({ filter: /\/pets\/roam\.js$/ }, () => ({ contents: 'export const groundY = () => 0;', loader: 'js' }));
  } };
  const built = await build({ stdin: { contents: "export * from './src/lightmap.js';", resolveDir: root }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent', plugins: [internals] });
  const file = join(dir, 'fixture.mjs'); await writeFile(file, built.outputFiles[0].contents);
  globalThis.location = { search: '' };
  const { probeWalls, probeBlocked, buildProbeVolume, VOL } = await import(pathToFileURL(file));
  const wall = { x0: 0.2, x1: 0.3, y0: -2, y1: 2, z0: 0, z1: 2.44 }, walls = probeWalls([wall]);
  assert.ok(walls[0].every((v, i) => Math.abs(v - [0.21, 0.29, 0.01, 2.43, -1.99, 1.99][i]) < 1e-12));
  const blocked = (p, q, boxes = walls) => probeBlocked(...p, ...q, boxes);
  assert.ok(blocked([0, 0.95, 0], [1, 0.95, 0]));
  assert.ok(blocked([1, 0.95, 0], [0, 0.95, 0]));
  assert.ok(!blocked([0, 0.95, 0], [0.1, 0.95, 0])); // segment ends before wall
  assert.ok(!blocked([0.2, 0.95, 0], [0.2, 1.55, 0])); // parallel on physical face, inside the inset margin
  assert.ok(!blocked([0, 0.95, 2], [1, 0.95, 2])); // parallel outside a slab
  assert.ok(blocked([0.25, 0.95, 0], [0.25, 0.95, 0])); // cell inside wall
  assert.ok(!blocked([0, 0.95, 0.1], [0.4, 0.95, 0.6], probeWalls([{ ...wall, y0: -0.3, y1: -0.2 }]))); // overlapping bounds, missed slab
  assert.equal(probeWalls([{ ...wall, x1: 0.21 }]).length, 0); // inset must not invert thin pieces
  const doorway = probeWalls([{ ...wall, y1: -0.4 }, { ...wall, y0: 0.4 }, { ...wall, y0: -0.4, y1: 0.4, z0: 2.06 }]);
  assert.ok(!blocked([0, 0.95, 0], [1, 0.95, 0], doorway));
  assert.ok(blocked([0, 2.2, 0], [1, 2.2, 0], doorway));
  assert.ok(blocked([0, 0.95, 1], [1, 0.95, 1], doorway));
  const NX = Math.round((VOL.x1 - VOL.x0) / VOL.step) + 1, NZ = Math.round((VOL.y1 - VOL.y0) / VOL.step) + 1;
  const cell = ((NZ + Math.round(-VOL.y0 / VOL.step)) * NX + Math.round(-VOL.x0 / VOL.step)) * 4;
  const fixture = visible => {
    const points = [[-0.01, 0.95, 0], ...Array.from({ length: 12 }, (_, i) => [0.4 + i * 0.01, 0.95, 0]), ...Array.from({ length: visible }, (_, i) => [-1 - i * 0.1, 0.95, 0])];
    const N = points.length, valid = new Uint8Array(N).fill(1); valid[0] = 0;
    return { N, points: new Float32Array(points.flat()), valid, layers: Object.fromEntries(['sky', 'sunind', 'lamps'].map(l => [l, new Float32Array(N * 27).fill(1)])) };
  };
  for (const count of [1, 2, 3, 4]) {
    const P = fixture(count), v = buildProbeVolume(P, null, walls), ids = Array.from(v.near.slice(cell, cell + 4)), wts = Array.from(v.wts.slice(cell, cell + 4));
    assert.deepEqual(ids.slice(0, count), Array.from({ length: count }, (_, i) => 13 + i));
    assert.ok(ids.every(i => i >= 13)); assert.ok(wts.slice(count).every(w => w === 0));
    assert.ok(Math.abs(wts.reduce((a, b) => a + b, 0) - 1) < 1e-6);
    v.fill(0.25); assert.equal(v.uniforms.uProbeSH.value.image.data[cell], 0x4080); // sky + sunind + 0.25 lamps = 2.25 in half float
    v.uniforms.uProbeSH.value.dispose();
  }
  const P = fixture(0), fallback = buildProbeVolume(P, null, walls), distance = buildProbeVolume(P);
  assert.deepEqual(fallback.near.slice(cell, cell + 4), distance.near.slice(cell, cell + 4));
  assert.deepEqual(fallback.wts.slice(cell, cell + 4), distance.wts.slice(cell, cell + 4));
  fallback.uniforms.uProbeSH.value.dispose(); distance.uniforms.uProbeSH.value.dispose();
  // The x pruning must preserve the exact nearest four, including height weighting and equal-distance ties.
  const random = fixture(4);
  random.points = Float32Array.from(random.points, (_, i) => Math.sin(i * 7) * 6);
  random.points.set([1, 0.95, 0, -1, 0.95, 0], 3);
  const v = buildProbeVolume(random);
  for (const c of [0, 400, cell / 4, 5000, NX * NZ * 3 - 1]) {
    const px = VOL.x0 + c % NX * VOL.step, py = VOL.heights[Math.floor(c / (NX * NZ))], pz = -(VOL.y0 + Math.floor(c / NX) % NZ * VOL.step);
    const expected = Array.from({ length: random.N }, (_, i) => i).filter(i => random.valid[i]).map(i => {
      const d = (random.points[i * 3] - px) ** 2 + ((random.points[i * 3 + 1] - py) * 2) ** 2 + (random.points[i * 3 + 2] - pz) ** 2;
      return [d, i];
    }).sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, 4).map(e => e[1]);
    assert.deepEqual(Array.from(v.near.slice(c * 4, c * 4 + 4)), expected);
  }
  v.uniforms.uProbeSH.value.dispose();
  console.log('probe walls: slabs, face margin, openings, invalid probes, 1–4 visible probes and distance fallback OK');
} finally { globalThis.location = location; await rm(dir, { recursive: true, force: true }); }
