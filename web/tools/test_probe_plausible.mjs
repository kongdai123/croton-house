// Probe-lit surfaces are plausible (postmortem row 19). Every face of every probe-lit mesh of the real house (door leaves
// shut and open, toggles, movables, the unmatched pieces, plants; up to 400 faces a mesh), at all four slots, lit as the
// composed shader lights it: the region-aware lookup (probe.glsl.js probeFetch over the packed half-float volume, the
// lamp groups at the slot's default levels), the sided point for 'face' meshes (seen head-on) and probeEval, transcribed
// to JS (picked by the shader's text: an unknown probeEval fails). The reference is the bake's own order-2 projection at
// the same taps (probes.bin holds 9 coefficients per colour; the volume ships the first 4). A face fails when its light
// collapses: a colour channel under a quarter of the reference's, and where the light is point-like (the order-2 data
// rings on the far side too) only if that channel's share of the colour also fell under a quarter. The plain L1
// evaluation failed 120 objects this way, the closed front door at noon among them (0.010 0.005 0.001 against 0.17 0.17
// 0.14). Also: no probe-lit front-side face is wound against its normal (the shader would light the side it faces away
// from) beyond the known list below. No browser, no GPU. REPORT=1 lists every failing object, DEBUG=1 adds the SH.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBakedScene } from './harness/baked.mjs';
import { WEB } from './harness/scene.mjs';

const t0 = performance.now();
const b = await buildBakedScene({ groups: true, slots: true });
const { world, baked } = b, { T, scene, doors, plan, roles } = world;
const report = !!process.env.REPORT;

// ---- the shader's evaluation, by its text: the transcription follows the GLSL, and an unknown probeEval fails
const { PROBE_FETCH, PROBE_SIDE } = world;
const EVALS = {
  // max( 0, L0 + L1 . n ) per colour
  linear: { token: 'return max( vec3( dot( s.r, basis ), dot( s.g, basis ), dot( s.b, basis ) ), 0.0 );',
    fn: (c, n) => Math.max(0, 0.886227 * c[0] + 1.023328 * (c[1] * n[1] + c[2] * n[2] + c[3] * n[0])) },
  // Geomerics' non-linear L1 (probeEvalL1)
  nonlinear: { token: 'return A * ( a + ( 1.0 - a ) * ( p + 1.0 ) * pow( q, p ) );',
    fn: (c, n) => {
      const A = Math.max(0.886227 * c[0], 0), B = [1.023328 * c[3], 1.023328 * c[1], 1.023328 * c[2]], L = Math.hypot(...B);
      const r = Math.min(Math.max(L / Math.max(2 * A, 1e-8), 0), 1), q = Math.min(Math.max(0.5 + 0.5 * (B[0] * n[0] + B[1] * n[1] + B[2] * n[2]) / Math.max(L, 1e-8), 0), 1);
      const p = 1 + 2 * r, a = (1 - r) / (1 + r);
      return A * (a + (1 - a) * (p + 1) * Math.pow(q, p));
    } },
};
const evalName = Object.keys(EVALS).find(k => PROBE_FETCH.includes(EVALS[k].token));
assert.ok(evalName, 'probeEval is neither transcription: update EVALS to the shader');
for (const token of ['outsideHouse( vec2( p.x, - p.z ) )', 'plan0 + c0 * step', 'w *= same / dot( w, same );']) assert.ok(PROBE_FETCH.includes(token), token);
assert.ok(world.PROBE_SIDE_POINT.includes('normalize( n + normalize( cameraPosition - p ) + 1e-4 ) * side'), 'probeSidePoint');
const shaderEval = EVALS[evalName].fn, SIDE = Number(PROBE_SIDE);
// the reference: order 2 (three's SphericalHarmonics3.getIrradianceAt), clamped
const evalL2 = (c, n) => { const [x, y, z] = n; return Math.max(0, 0.886227 * c[0] + 1.023328 * (y * c[1] + z * c[2] + x * c[3]) + 0.858086 * (x * y * c[4] + y * z * c[5] + x * z * c[7]) + (0.743125 * z * z - 0.247708) * c[6] + 0.429043 * (x * x - y * y) * c[8]); };

// ---- the probe-lit faces: [label, centre, normal, sided] per sampled triangle; doors in both poses
const exclude = new Set([b.human.root, ...b.pets.map(p => p.root)]);
const label = o => { for (let p = o; p; p = p.parent) { if (p.name?.startsWith('door-')) return p.name; if (p.userData.placement || p.userData.id) return p.userData.id || p.userData.placement?.id || p.name; } return o.name || o.uuid.slice(0, 8); };
const visible = o => { for (let p = o; p; p = p.parent) if (!p.visible || exclude.has(p)) return false; return true; };
const sidedMat = m => m && !m.transparent && !(m.transmission > 0);
const MAX_FACES = 400, woundBy = new Map();
function collectFaces(pose) {
  const faces = []; let wound = 0, frontFaces = 0;
  scene.updateMatrixWorld(true);
  scene.traverse(o => {
    if (!o.isMesh || !visible(o)) return;
    const mats = [].concat(o.material), lit = mats.filter(m => m?.userData.probeLit && !m.lightMap);
    if (!lit.length) return;
    const g = o.geometry, pos = g.attributes.position, nor = g.attributes.normal, idx = g.index; if (!nor) return;
    const sided = roles.meshLighting(o).probeSide === 'face' && lit.some(sidedMat), front = lit.every(m => m.side === T.FrontSide);
    const flip = o.matrixWorld.determinant() < 0 ? -1 : 1;   // three flips the front face of a mirrored object
    const key = `${label(o)} [${mats.map(m => m.name).join('/')}]`;
    const nm = new T.Matrix3().getNormalMatrix(o.matrixWorld), count = (idx ? idx.count : pos.count) / 3, stride = Math.max(1, Math.floor(count / MAX_FACES));
    const v = [0, 1, 2].map(() => new T.Vector3()), n = [0, 1, 2].map(() => new T.Vector3()), e1 = new T.Vector3(), e2 = new T.Vector3();
    for (let t = 0; t < count; t += stride) {
      for (let k = 0; k < 3; k++) { const i = idx ? idx.getX(t * 3 + k) : t * 3 + k; v[k].fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); n[k].fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); }
      const wind = e1.subVectors(v[1], v[0]).cross(e2.subVectors(v[2], v[0])); if (wind.lengthSq() < 1e-14) continue;
      const nn = n[0].clone().add(n[1]).add(n[2]).normalize();
      if (front) { frontFaces++; if (flip * wind.dot(nn) < 0) { wound++; woundBy.set(key, (woundBy.get(key) ?? 0) + 1); } }
      faces.push({ label: label(o), pose, c: v[0].clone().add(v[1]).add(v[2]).divideScalar(3), n: nn, sided });
    }
  });
  return { faces, wound, frontFaces };
}
const hinged = doors.filter(d => d.pivot), bifolds = doors.filter(d => d.kind === 'bifold');
const pose = open => { for (const d of hinged) d.pivot.rotation.y = open ? d.openAngle : 0; for (const d of bifolds) { d.target = open ? 1 : 0; d._goal = undefined; d.tick(1); } };
const site = new Map(hinged.map(d => [d, d.pivot.rotation.y])), siteFold = new Map(bifolds.map(d => [d, d.target]));
pose(false); const shut = collectFaces('shut');
pose(true); const open = collectFaces('open');
for (const [d, a] of site) d.pivot.rotation.y = a; for (const [d, t] of siteFold) { d.target = t; d._goal = undefined; d.tick(1); }
const doorFaces = f => f.label.startsWith('door-');
const faces = [...shut.faces, ...open.faces.filter(doorFaces)];
assert.ok(faces.length > 5000 && faces.some(f => f.label === 'door-ca2bb42b5a'), `${faces.length} probe-lit faces`);
// Known, outside the door class (a follow-up: plant bases and dried stems, a sheer; their geometry is wound inside out):
// listed by object and materials so that a new one fails and a fixed one is struck off (the list may only shrink).
const KNOWN_WOUND = new Set(['decor-curtain-sheer []', 'plants-bromeliad-green [plant-bromBase]', 'plants-bromeliad-red [plant-bromBase]',
  'props-vase-heather [plant-propsDriedStem]', 'props-kitchen-pitcher [plant-propsDriedStem]', 'batch [plant-flowers-stems]', 'batch [plant-propsDriedStem]']);
if (report && woundBy.size) console.log('wound against their normals:', [...woundBy].map(([k, n]) => `${k} ${n}`).join('; '));
assert.deepEqual([...woundBy.keys()].filter(k => !KNOWN_WOUND.has(k)), [], 'probe-lit faces wound against their normals');
assert.deepEqual([...KNOWN_WOUND].filter(k => !woundBy.has(k)), [], 'fixed: strike these off KNOWN_WOUND');
assert.ok(![...woundBy.keys()].some(k => k.startsWith('door-')), 'a door leaf wound against its normals');

// ---- per slot: the volume as the runtime fills it, the shader's lookup, the reference at the same taps
const outside = (x, y) => plan.isInside(x, y) ? 0 : 1;
const lg = baked.lampGroups, walls = world.probeWalls(world.probeWallPieces), half = T.DataUtils.fromHalfFloat;
const failures = new Map(), stats = [];
for (const slot of ['sunrise', 'noon', 'golden', 'dusk']) {
  const data = readFileSync(join(WEB, `assets/lightmaps/${slot}/probes.bin`)), saved = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) });
  const P = await world.loadProbes('probes.bin'); globalThis.fetch = saved;
  const volume = world.buildProbeVolume(P, lg, walls);
  lg.reset(slot); lg.update(0, slot); volume.fill();
  const tex = volume.uniforms.uProbeSH.value, { width: NX, height: NZ, depth } = tex.image, NY = depth / 3, D = tex.image.data, cells = NX * NZ * NY;
  const O = volume.uniforms.uProbeOrigin.value, S = volume.uniforms.uProbeScale.value, step = 1 / S.x;
  const gw = lg.probeWeights, GSH = lg.probeSH, G = lg.groups.length, near = volume.near, wts = volume.wts;
  // a cell's 9 coefficients per colour, float, as fill() but to order 2 (the reference)
  const order2 = new Map();
  const cell2 = c => { let s = order2.get(c); if (s) return s; s = [0, 1, 2].map(() => new Float64Array(9));
    for (let j = 0; j < 4; j++) { const i = near[c * 4 + j], w = wts[c * 4 + j]; if (!w) continue;
      for (let k = 0; k < 9; k++) for (let ch = 0; ch < 3; ch++) { let v = P.layers.sky[i * 27 + k * 3 + ch] + P.layers.sunind[i * 27 + k * 3 + ch]; for (let g = 0; g < G; g++) if (gw[g * 3 + ch]) v += gw[g * 3 + ch] * GSH[(g * P.N + i) * 9 + k]; s[ch][k] += w * v; } }
    order2.set(c, s); return s; };
  // probeFetch's taps: up to four cells (x, z) with their weights, filtered in height between two slices
  function taps(p) {
    const gx = (p[0] - O.x) * S.x, gy = (p[1] - O.y) * S.y, gz = (p[2] - O.z) * S.z, cx = Math.floor(gx), cz = Math.floor(gz), fx = gx - cx, fz = gz - cz;
    const cl = [[cx, cz], [cx + 1, cz], [cx, cz + 1], [cx + 1, cz + 1]].map(([x, z]) => [Math.min(Math.max(x, 0), NX - 1), Math.min(Math.max(z, 0), NZ - 1)]);
    const side = outside(p[0], -p[2]), same = cl.map(([x, z]) => +(outside(O.x + x * step, -O.z + z * step) === side));
    let w = [(1 - fx) * (1 - fz), fx * (1 - fz), (1 - fx) * fz, fx * fz];
    const kept = w.reduce((a, v, i) => a + v * same[i], 0), across = w.reduce((a, v, i) => a + v * (1 - same[i]), 0);
    if (across > 0 && kept > 0) w = w.map((v, i) => v * same[i] / kept);
    const h = Math.min(Math.max(gy, 0.01), NY - 1.01), y0 = Math.floor(h);
    return { cl, w, y0, fy: h - y0 };
  }
  const shaderAt = ({ cl, w, y0, fy }) => [0, 1, 2].map(ch => { const s = [0, 0, 0, 0];
    cl.forEach(([x, z], i) => { if (w[i] <= 0) return; for (const [y, wy] of [[y0, 1 - fy], [y0 + 1, fy]]) if (wy > 0) for (let k = 0; k < 4; k++) s[k] += w[i] * wy * half(D[((ch * cells) + (y * NZ + z) * NX + x) * 4 + k]); });
    return s; });
  const refAt = ({ cl, w, y0, fy }) => [0, 1, 2].map(ch => { const s = new Float64Array(9);
    cl.forEach(([x, z], i) => { if (w[i] <= 0) return; for (const [y, wy] of [[y0, 1 - fy], [y0 + 1, fy]]) if (wy > 0) { const c = cell2((y * NZ + z) * NX + x)[ch]; for (let k = 0; k < 9; k++) s[k] += w[i] * wy * c[k]; } });
    return s; });
  const lum = e => 0.2126 * e[0] + 0.7152 * e[1] + 0.0722 * e[2];
  let lit = 0, bad = 0;
  for (const f of faces) {
    const n = [f.n.x, f.n.y, f.n.z];
    // the sided point seen head-on: normalize( n + v ) = n
    const q = f.sided ? [f.c.x + n[0] * SIDE, f.c.y + n[1] * SIDE, f.c.z + n[2] * SIDE] : [f.c.x, f.c.y, f.c.z];
    const tp = taps(q), sh = shaderAt(tp), ref = refAt(tp);
    const E = sh.map(c => shaderEval(c, n)), R = ref.map(c => evalL2(c, n)), Rl = lum(R), El = lum(E);
    if (Rl < 0.02) continue;
    lit++;
    // how point-like the light is (Geomerics' r: 0 uniform, 1 a single direction); beyond 0.8 the order-2 projection of
    // such a source rings to a quarter of its mean on the far side, so it is no reference for the luminance there
    const lumSH = [0, 1, 2, 3].map(k => 0.2126 * sh[0][k] + 0.7152 * sh[1][k] + 0.0722 * sh[2][k]);
    const pointLike = 1.023328 * Math.hypot(lumSH[1], lumSH[2], lumSH[3]) / Math.max(2 * 0.886227 * lumSH[0], 1e-9);
    const collapsed = [0, 1, 2].some(c => R[c] / Rl > 0.05 && E[c] < R[c] / 4 && (pointLike <= 0.8 || E[c] / Math.max(El, 1e-9) < (R[c] / Rl) / 4));
    if (!collapsed) continue;
    bad++;
    const key = `${f.label} (${f.pose})`, r = failures.get(key) ?? { slots: new Set(), n: 0, worst: null };
    r.slots.add(slot); r.n++;
    if (!r.worst || El / Rl < r.worst.ratio) r.worst = { slot, ratio: El / Rl, E, R, at: [f.c.x, -f.c.z, f.c.y].map(v => +v.toFixed(2)), dbg: process.env.DEBUG ? ` n ${n.map(v => v.toFixed(2))} sided ${f.sided} lin ${sh.map(c => EVALS.linear.fn(c, n).toFixed(3))} A ${sh.map(c => (0.886227 * c[0]).toFixed(3))} |B| ${sh.map(c => (1.023328 * Math.hypot(c[1], c[2], c[3])).toFixed(3))}` : '' };
    failures.set(key, r);
  }
  stats.push(`${slot} ${bad}/${lit}`);
  tex.dispose();   // also leaves the lamp groups' refill list
}
const f3 = a => a.map(v => v.toFixed(3)).join(' ');
const lines = [...failures].sort((a, b) => b[1].n - a[1].n).map(([k, r]) => `${k}: ${r.n} faces at ${[...r.slots].join('/')}; worst ${r.worst.slot} at plan (${r.worst.at}) ${f3(r.worst.E)} vs ${f3(r.worst.R)}${r.worst.dbg}`);
if (report || lines.length) console.log(lines.slice(0, report ? 1000 : 40).join('\n'));
assert.equal(failures.size, 0, `${failures.size} probe-lit objects whose light collapses (probeEval ${evalName})`);
console.log(`probe-lit surfaces plausible: ${faces.length} faces (${shut.frontFaces + open.frontFaces} front-side; wound against their normals only the known ${KNOWN_WOUND.size}), probeEval ${evalName}, collapsed per slot ${stats.join(', ')} (${((performance.now() - t0) / 1000).toFixed(1)} s) OK`);
