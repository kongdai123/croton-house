// Region-aware probe sampling (shaders/probe.glsl.js probeFetch), evaluated in node on the shipped noon probes: a JS
// transcription of the GLSL (the hardware's trilinear filter over the packed half-float volume, clamp to edge) next to
// the plain blend it replaces. Checks: where the four cells a lookup blends lie on its side of the house's outline the
// two agree exactly; elsewhere the region-aware one reads no cell across the outline; and how much the plain blend
// leaked through the open front door at noon (the streaks of postmortem row 5). No browser, no GPU.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url)), dir = await mkdtemp(join(tmpdir(), 'croton-probe-regions-'));
try {
  const stub = { name: 'stubs', setup(b) { b.onLoad({ filter: /\/pets\/roam\.js$/ }, () => ({ contents: 'export const groundY = () => 0;', loader: 'js' })); } };
  const built = await build({ stdin: { contents: "export * from './src/lightmap.js'; export { isInside, plan } from './src/plan.js'; export { PROBE_FETCH } from './src/shaders/probe.glsl.js'; export * as THREE from 'three';", resolveDir: root }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent', plugins: [stub] });
  const file = join(dir, 'fixture.mjs'); await writeFile(file, built.outputFiles[0].contents);
  globalThis.location = { search: '' };
  const data = await readFile(join(root, 'assets/lightmaps/noon/probes.bin'));
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) });
  const { loadProbes, buildProbeVolume, probeWalls, PROBE_WALL_PIECES, isInside, plan, PROBE_FETCH, THREE } = await import(pathToFileURL(file));
  // the shader under test is the one the walk compiles: its outline test, its 2 x 2 cells, its renormalisation
  for (const token of ['outsideHouse( vec2( p.x, - p.z ) )', 'plan0 + c0 * step', 'dot( w, 1.0 - same ) <= 0.0 || dot( w, same ) <= 0.0', 'w *= same / dot( w, same );']) assert.ok(PROBE_FETCH.includes(token), token);
  const P = await loadProbes('noon/probes.bin'), volume = buildProbeVolume(P, null, probeWalls(PROBE_WALL_PIECES));
  volume.fill(1);
  const tex = volume.uniforms.uProbeSH.value, { width: NX, height: NZ, depth } = tex.image, NY = depth / 3, D = tex.image.data;
  const half = THREE.DataUtils.fromHalfFloat, O = volume.uniforms.uProbeOrigin.value, S = volume.uniforms.uProbeScale.value;
  // texture( uProbeSH, uvw' ) in texel space: linear between texel centres, clamped to the edge
  const texel = (x, z, s, k) => half(D[((s * NZ + z) * NX + x) * 4 + k]);
  const lerp = (a, b, t) => a + (b - a) * t;
  const filtered = (tx, tz, ts, k) => {
    const c = (v, n) => Math.min(Math.max(v, 0), n - 1);
    const x0 = Math.floor(tx), z0 = Math.floor(tz), s0 = Math.floor(ts), fx = tx - x0, fz = tz - z0, fs = ts - s0;
    const at = (x, z, s) => texel(c(x, NX), c(z, NZ), c(s, depth), k);
    const plane = s => lerp(lerp(at(x0, z0, s), at(x0 + 1, z0, s), fx), lerp(at(x0, z0 + 1, s), at(x0 + 1, z0 + 1, s), fx), fz);
    return lerp(plane(s0), plane(s0 + 1), fs);
  };
  // probeUVW / probeTex in texel units: x, z at the cell index, the height in slices (clamped a hair inside each colour)
  const grid = p => [(p[0] - O.x) * S.x, (p[1] - O.y) * S.y, (p[2] - O.z) * S.z];
  const tap = (gx, gz, gy, ch) => [0, 1, 2, 3].map(k => filtered(gx, gz, Math.min(Math.max(gy, 0.01), NY - 1.01) + ch * NY, k));
  const fetchPlain = p => { const [gx, gy, gz] = grid(p); return [0, 1, 2].map(ch => tap(gx, gz, gy, ch)); };
  const outside = (x, y) => isInside(x, y) ? 0 : 1;
  function fetchRegion(p, used = []) {
    const [gx, gy, gz] = grid(p), cx = Math.floor(gx), cz = Math.floor(gz), fx = gx - cx, fz = gz - cz, step = 1 / S.x;
    const cells = [[cx, cz], [cx + 1, cz], [cx, cz + 1], [cx + 1, cz + 1]].map(([x, z]) => [Math.min(Math.max(x, 0), NX - 1), Math.min(Math.max(z, 0), NZ - 1)]);
    const side = outside(p[0], -p[2]);
    const same = cells.map(([x, z]) => +(outside(O.x + x * step, -O.z + z * step) === side));
    let w = [(1 - fx) * (1 - fz), fx * (1 - fz), (1 - fx) * fz, fx * fz];
    const across = w.reduce((a, v, i) => a + v * (1 - same[i]), 0), kept = w.reduce((a, v, i) => a + v * same[i], 0);
    if (across <= 0 || kept <= 0) { used.push(...cells.filter((_, i) => w[i] > 0)); return fetchPlain(p); }
    w = w.map((v, i) => v * same[i] / kept);
    const s = [0, 1, 2].map(() => [0, 0, 0, 0]);
    cells.forEach(([x, z], i) => { if (w[i] <= 0) return; used.push([x, z]); for (let ch = 0; ch < 3; ch++) tap(x, z, gy, ch).forEach((v, k) => { s[ch][k] += w[i] * v; }); });
    return s;
  }
  const lum = (sh, n) => { const b = [0.886227, 1.023328 * n[1], 1.023328 * n[2], 1.023328 * n[0]], e = sh.map(c => Math.max(0, c.reduce((a, v, k) => a + v * b[k], 0))); return 0.2126 * e[0] + 0.7152 * e[1] + 0.0722 * e[2]; };

  // 1. away from the outline, identical; 2. near it, no cell across
  let agree = 0, near = 0, crossed = 0;
  for (let i = 0; i < 20000; i++) {
    const x = -12 + 24 * ((i * 0.618034) % 1), y = -11 + 26 * ((i * 0.414214) % 1), h = 0.2 + 1.6 * ((i * 0.732051) % 1), p = [x, h, -y];
    const used = [], a = fetchRegion(p, used), b = fetchPlain(p), side = outside(x, y);
    if (used.every(([cx, cz]) => outside(O.x + cx / S.x, -O.z + cz / S.x) === side)) {
      const [gx, , gz] = grid(p), plainCells = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dz]) => [Math.min(Math.max(Math.floor(gx) + dx, 0), NX - 1), Math.min(Math.max(Math.floor(gz) + dz, 0), NZ - 1)]);
      if (plainCells.every(([cx, cz]) => outside(O.x + cx / S.x, -O.z + cz / S.x) === side)) { assert.deepEqual(a, b); agree++; } else near++;
    } else crossed++;
  }
  assert.equal(crossed, 0, 'a lookup read a cell across the outline');
  assert.ok(agree > 15000 && near > 100, `${agree} agree, ${near} near the outline`);
  // 3. the exterior doors (plan openings to an exterior space), seen from inside at noon: lookups 5..45 cm in from the
  // door line, facing into the room; the plain blend's excess over the region-aware one
  const exterior = new Set(plan.spaces.filter(sp => sp.zone === 'exterior').map(sp => sp.id)), report = [];
  for (const door of plan.openings.filter(o => o.kind !== 'window' && o.connects.some(c => exterior.has(c)))) {
    const ratios = [];
    for (let t = 0.05; t < 1; t += 0.1) for (let d = 0.05; d < 0.5; d += 0.1) for (const h of [0.5, 1.0, 1.5]) for (const sgn of [-1, 1]) {
      const x = door.dir === 'H' ? lerp(door.x0, door.x1, t) : (sgn < 0 ? door.x0 - d : door.x1 + d), y = door.dir === 'H' ? (sgn < 0 ? door.y0 - d : door.y1 + d) : lerp(door.y0, door.y1, t);
      if (!isInside(x, y)) continue;
      const n = door.dir === 'H' ? [0, 0, sgn < 0 ? 1 : -1] : [sgn < 0 ? -1 : 1, 0, 0], p = [x, h, -y];   // facing away from the door, into the room
      ratios.push(lum(fetchPlain(p), n) / Math.max(lum(fetchRegion(p), n), 1e-6));
    }
    if (!ratios.length) continue;
    ratios.sort((a, b) => a - b);
    report.push(`${door.type} ${ratios.at(-1).toFixed(2)}x`);
  }
  console.log(`probe regions: ${agree} lookups identical away from the outline, ${near} renormalised next to it, none across; exterior doors at noon, the plain blend's largest excess inside: ${report.join(', ')} OK`);
  tex.dispose();
} finally { await rm(dir, { recursive: true, force: true }); }
