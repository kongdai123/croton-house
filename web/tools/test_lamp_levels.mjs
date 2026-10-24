// The shipped lamp groups light every space as its fixtures' declared lumens can (CPU only, the shipped assets): desk-height
// illuminance (light probes 0.5-1.6 m up, facing up, three's SH irradiance) per plan space, in lux by the bake's lumen
// constant (encoding.json lmPerW: bake/scripts/fixture_lights.py LM_PER_W).
//   1. every interior space's own lamp groups give it within [1/3, 3]x of the lumen method's average (the groups' lumens
//      x a utilisation of 0.5 / the floor area): a 30 W point lamp in a 0.4 m2 closet (14x the living room) cannot ship
//   2. the open plan (living, kitchen, dining, office), every lamp on, reads 0.15-0.25x its noon daylight there: the
//      calibration of LM_PER_W (lamps ~100-300 lux against ~500-2000 of noon daylight indoors)
//   3. no interior space with every lamp on is under 30 or over 800 lux
//   node tools/test_lamp_levels.mjs [lightmaps dir]   prints the per-space table
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('../', import.meta.url));
const DIR = process.argv[2] ?? WEB + 'assets/lightmaps';
const plan = JSON.parse(readFileSync(WEB + 'data/plan.json', 'utf8'));
const pip = (poly, x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
const spaceAt = (x, y) => plan.spaces.find(s => pip(s.polygon, x, y)) ?? null;
const area = poly => Math.abs(poly.reduce((a, [x, y], i) => { const [u, v] = poly[(i + 1) % poly.length]; return a + x * v - u * y; }, 0) / 2);
const buf = path => { const b = readFileSync(path); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const header = ab => { const n = new DataView(ab).getUint32(0, true); return [JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 4, n))), 4 + n]; };
// three's SphericalHarmonics3.getIrradianceAt toward (0, 1, 0): basis 1, y, z, x, xy, yz, 3z2-1, xz, x2-y2
const up = (sh, o, s = 1) => 0.886227 * sh[o] + 2 * 0.511664 * sh[o + s] - 0.247708 * sh[o + 6 * s] - 0.429043 * sh[o + 8 * s];
const LUM = [0.2126, 0.7152, 0.0722];

const enc = JSON.parse(readFileSync(`${DIR}/v2/lampgroups/encoding.json`, 'utf8'));
assert.ok(enc.lmPerW > 0, 'lamp groups without lmPerW: a bake older than the lumen model (bake/scripts/fixture_lights.py)');
for (const g of enc.groups) if (!g.always) assert.ok(g.lm > 0 && Array.isArray(g.spaces), `group ${g.name}: no lumens or spaces`);
const G = enc.groups.length;
const gb = buf(`${DIR}/v2/lampgroups/probes.bin`), [gh, go] = header(gb), N = gh.count;
const gsh = new Float32Array(gb, (go + 3) & ~3, G * N * 9);
const noon = buf(`${DIR}/noon/probes.bin`), [nh, no] = header(noon);
assert.equal(nh.count, N, 'slot and lamp-group probes differ');
let o = no; const valid = new Uint8Array(noon, o, N); o = (o + N + 3) & ~3;
const layers = {}; for (const l of nh.layers) { layers[l] = new Float32Array(noon, o, N * 27); o += N * 27 * 4; }

const per = new Map();
for (let i = 0; i < N; i++) {
  const [x, h, z] = nh.points[i];
  if (!valid[i] || h < 0.5 || h > 1.6) continue;
  const s = spaceAt(x, -z); if (!s || s.zone === 'exterior') continue;
  const r = per.get(s.id) ?? { s, n: 0, day: 0, g: new Float64Array(G) }; per.set(s.id, r); r.n++;
  for (let c = 0; c < 3; c++) r.day += LUM[c] * (up(layers.sky, i * 27 + c, 3) + up(layers.sunind, i * 27 + c, 3));
  for (let g = 0; g < G; g++) r.g[g] += up(gsh, (g * N + i) * 9) * LUM.reduce((a, w, c) => a + w * enc.groups[g].color[c], 0);
}
const lux = v => v * enc.lmPerW, fails = [], rows = [];
for (const [id, r] of per) {
  const own = enc.groups.filter(g => g.spaces?.includes(id));
  const ownE = own.reduce((a, g) => a + r.g[g.index], 0) / r.n, allE = r.g.reduce((a, v) => a + v, 0) / r.n;
  const A = area(r.s.polygon), expect = own.reduce((a, g) => a + g.lm, 0) * 0.5 / A;
  rows.push([id, r.n, A, r.day / r.n, lux(ownE), expect, lux(allE)]);
  if (own.length && !(lux(ownE) >= expect / 3 && lux(ownE) <= expect * 3)) fails.push(`${id}: own lamps ${lux(ownE).toFixed(0)} lux, lumen method ${expect.toFixed(0)} (outside 1/3..3x)`);
  if (!(lux(allE) >= 30 && lux(allE) <= 800)) fails.push(`${id}: every lamp on ${lux(allE).toFixed(0)} lux (outside 30..800)`);
}
const OPEN = ['living', 'kitchen', 'dining', 'office'].map(id => per.get(id));
const openDay = OPEN.reduce((a, r) => a + r.day, 0), openLamps = OPEN.reduce((a, r) => a + r.g.reduce((x, v) => x + v, 0), 0), ratio = openLamps / openDay;
if (!(ratio >= 0.15 && ratio <= 0.25)) fails.push(`open plan: every lamp on is ${ratio.toFixed(3)}x its noon daylight (0.15..0.25)`);
console.log(`lamp levels (${DIR}): lmPerW ${enc.lmPerW}; open plan lamps / noon daylight ${ratio.toFixed(3)}`);
console.log('space'.padEnd(18), 'probes', 'm2'.padStart(5), 'noon'.padStart(7), 'own lux'.padStart(8), 'lumen m.'.padStart(9), 'all on'.padStart(7));
for (const [id, n, A, d, own, ex, all] of rows.sort((a, b) => b[2] - a[2]))
  console.log(id.padEnd(18), String(n).padStart(6), A.toFixed(1).padStart(5), d.toFixed(4).padStart(7), own.toFixed(0).padStart(8), ex.toFixed(0).padStart(9), all.toFixed(0).padStart(7));
assert.deepEqual(fails, [], fails.join('\n'));
console.log('ok');
