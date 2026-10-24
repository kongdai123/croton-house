// The camera's white balance (white_balance_policy.js, white_balance.js): the colour science, the clamps, the time glide,
// the probe lookup against a synthetic volume on the real grid and outline, and the output wiring (Blender AgX and three's
// OutputPass fallback) with a renderer that only records calls. No WebGL, network or GPU. The shipped bake's illuminants:
// test_white_balance_bake.mjs.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const dir = await mkdtemp(join(tmpdir(), 'croton-wb-'));
try {
  const built = await build({ stdin: { contents: `
    export * from './src/white_balance_policy.js'; export * from './src/white_balance.js';
    export { blenderAgX } from './src/agx.js'; export { createBakedAutoExposure } from './src/auto_exposure.js';
    export { SLOTS } from './src/lighting_slots.js'; export { plan, isInside } from './src/plan.js';
    export { PROBE_FETCH } from './src/shaders/probe.glsl.js';
    export { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'; export * as THREE from 'three';
  `, resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
  const file = join(dir, 'fixture.mjs'); await writeFile(file, built.outputFiles[0].contents);
  const W = await import(pathToFileURL(file)), T = W.THREE;
  const { WHITE_BALANCE: S, apply, luminance, IDENTITY } = W;
  const near = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} != ${b} (tolerance ${tol})`);
  const query = s => new URLSearchParams(s);

  // ---- gates: with the auto exposure (the visitor's frame) only, never on a fixed exposure (the Cycles-comparable set)
  assert.equal(W.whiteBalanceEnabled(query('')), true);
  assert.equal(W.whiteBalanceEnabled(query('lightmap=noon&tier=mobile&wb=1')), true);
  for (const s of ['wb=0', 'wb=off', 'autoexp=0', 'capture', 'fixedexposure', 'rawtone', 'capture&wb=1'])
    assert.equal(W.whiteBalanceEnabled(query(s)), false, s);
  assert.deepEqual(W.degreeOverride(query('wbd=0.9,0.3')), { indoorD: 0.9, outdoorD: 0.3 });
  assert.deepEqual(W.degreeOverride(query('wbd=2')), { indoorD: 1 });
  assert.deepEqual(W.degreeOverride(query('wbd=,0')), { outdoorD: 0 });
  assert.deepEqual(W.degreeOverride(query('')), {});

  // ---- colour: D65 is 6504 K, Duv +0.0032; the locus and tint round-trip
  const d65 = W.uvToTemperature(...W.rgbToUV([1, 1, 1]));
  near(d65.kelvin, 6504, 5, 'D65 CCT'); near(d65.duv, 0.0032, 0.0002, 'D65 Duv');
  for (const K of [2500, 2700, 3000, 4000, 5000, 6504, 8000, 10000]) for (const duv of [-0.01, 0, 0.01]) {
    const back = W.uvToTemperature(...W.rgbToUV(W.uvToRGB(...W.temperatureToUV(1e6 / K, duv))));
    near(back.mired, 1e6 / K, duv ? 0.1 : 0.01, `${K} K`); near(back.duv, duv, 2e-5, `${K} K Duv`);   // mired: ~ perceptually even
  }
  // a 3000 K lamp after a warm bounce (the lamp groups' mean chromaticity, encoding.json) reads about 2760 K
  near(W.uvToTemperature(...W.rgbToUV([1.91, 0.807, 0.237])).kelvin, 2763, 10, 'lamp group');

  // ---- the von Kries matrix: D 0 is the identity; D 1 makes the illuminant neutral; the illuminant's luminance is kept
  assert.deepEqual(W.adaptationMatrix([1.9, 0.8, 0.24], 0), IDENTITY);
  const illuminants = [];
  for (const K of [2500, 2800, 3500, 5000, 6504, 8000, 10000]) for (const duv of [-0.012, 0, 0.012]) for (const scale of [0.01, 1, 300])
    illuminants.push(W.uvToRGB(...W.temperatureToUV(1e6 / K, duv), scale));
  const uvDistance = (a, b) => { const p = W.rgbToUV(a), q = W.rgbToUV(b); return Math.hypot(p[0] - q[0], p[1] - q[1]); };
  for (const e of illuminants) {
    const Y = luminance(e), full = apply(W.adaptationMatrix(e, 1), e);
    for (const c of full) near(c, full[1], Y * 1e-9, 'D = 1 neutral');
    let previous = Infinity;
    for (const D of [0, 0.3, 0.6, 0.85, 1]) {
      const out = apply(W.adaptationMatrix(e, D), e);
      near(luminance(out), Y, Y * 1e-9, `luminance at D ${D}`);
      const d = uvDistance(out, [1, 1, 1]);
      assert.ok(d <= previous + 1e-12, `towards white monotonically in D (${D})`); previous = d;
    }
  }
  // the display white is already adapted to: the identity at any degree
  for (const D of [0.4, 0.85, 1]) W.adaptationMatrix([1, 1, 1], D).forEach((v, i) => near(v, IDENTITY[i], 1e-12, 'D65'));
  // a grey card under the lamp reads warm-white, not orange, at the indoor degree (linear R/B 8 -> under 1.6; through AgX a
  // white wall displays about 178/166/158 instead of 208/150/93)
  const lamp = [1.91, 0.807, 0.237], card = apply(W.adaptationMatrix(lamp, S.indoorD), lamp);
  assert.ok(card[0] > card[1] && card[1] > card[2] && card[0] / card[2] < 1.6, `grey card ${card}`);
  // temperatureMatrix agrees with adaptationMatrix of the same illuminant
  const tm = W.temperatureMatrix(1e6 / 3000, 0, 0.85), am = W.adaptationMatrix(W.uvToRGB(...W.temperatureToUV(1e6 / 3000, 0)), 0.85);
  tm.forEach((v, i) => near(v, am[i], 1e-12));

  // ---- the clamp: temperature to [minK, maxK], tint to +-maxDuv; too dark or not finite: no reading
  const within = c => c.kelvin >= S.minK - 1e-6 && c.kelvin <= S.maxK + 1e-6 && Math.abs(c.duv) <= S.maxDuv + 1e-12;
  for (const rgb of [[1, 0.2, 0.2], [0.3, 1, 0.3], [0.2, 0.3, 3], [1, 0.4, 1], [5, 1, 0.01], [1, 0, 0], [0, 0, 1], [1, 1, 1]]) {
    const c = W.clampIlluminant(rgb); assert.ok(c && within(c), `${rgb}: ${JSON.stringify(c)}`);
  }
  near(W.clampIlluminant([1, 0.2, 0.2]).kelvin, S.minK, 1e-6, 'red wall');
  near(W.clampIlluminant([0.2, 0.3, 3]).kelvin, S.maxK, 1e-6, 'blue sky');
  near(W.clampIlluminant([1, 0.2, 0.2]).duv, -S.maxDuv, 1e-12, 'red wall tint');
  near(W.clampIlluminant([0.3, 1, 0.3]).duv, S.maxDuv, 1e-12, 'green tint');
  near(W.clampIlluminant([1.91, 0.807, 0.237]).kelvin, 2763, 10, 'a lamp is not clamped');
  for (const rgb of [[0, 0, 0], [1e-6, 1e-6, 1e-6], [NaN, 1, 1], [Infinity, 1, 1]]) assert.equal(W.clampIlluminant(rgb), null, `${rgb}`);
  assert.ok(within(W.clampIlluminant([-0.1, 0.5, 0.5])), 'a negative channel (half-float noise) is clamped at 0');

  // ---- degree: outdoor .. indoor by the plan's indoor weight
  near(W.adaptationDegree(0), S.outdoorD, 1e-12); near(W.adaptationDegree(1), S.indoorD, 1e-12);
  near(W.adaptationDegree(0.5), (S.indoorD + S.outdoorD) / 2, 1e-12);
  near(W.adaptationDegree(-1), S.outdoorD, 1e-12); near(W.adaptationDegree(2), S.indoorD, 1e-12);
  assert.ok(S.indoorD > S.outdoorD && S.indoorD < 1 && S.outdoorD > 0);

  // ---- the glide: exponential, frame-rate independent; a snap or the first frame jumps; a dark reading holds the colour
  const goal = { mired: 1e6 / 2800, duv: -0.002, D: 0.85 }, start = { mired: 1e6 / 6000, duv: 0.005, D: 0.4 };
  const run = (fps, seconds) => { let s = start; for (let i = 0; i < Math.round(fps * seconds); i++) s = W.glideWhiteBalance(s, goal, 1 / fps); return s; };
  for (const k of ['mired', 'duv', 'D']) {
    near(run(30, 2)[k], run(144, 2)[k], 1e-9 * Math.abs(goal[k]) + 1e-12, `fps invariance ${k}`);
    near(run(60, S.tau)[k], goal[k] + (start[k] - goal[k]) / Math.E, 1e-9 * Math.abs(goal[k]) + 1e-12, `tau ${k}`);
  }
  assert.deepEqual(W.glideWhiteBalance(start, goal, 0.01, true), goal);
  assert.deepEqual(W.glideWhiteBalance(null, goal, 0.01), goal);
  assert.deepEqual(W.glideWhiteBalance(start, goal, 0), start);
  const held = W.glideWhiteBalance(start, { D: 0.85 }, 0.5);
  assert.equal(held.mired, start.mired); assert.equal(held.duv, start.duv); assert.ok(held.D > start.D);
  near(W.glideWhiteBalance(null, { D: 0.6 }, 0.1).mired, 1e6 / 6504, 1e-9, 'no reading yet: daylight');

  // ---- the probe lookup on the real grid and outline (plan.volumes.probe, plan.isInside), a synthetic volume
  const VOL = W.plan.volumes.probe, NX = Math.round((VOL.x1 - VOL.x0) / VOL.step) + 1, NZ = Math.round((VOL.y1 - VOL.y0) / VOL.step) + 1, NY = VOL.heights.length;
  const cells = NX * NZ * NY, toHalf = T.DataUtils.toHalfFloat;
  // as lightmap.js buildProbeVolume: three colours stacked in depth, 4 SH coefficients per texel (L0, then y, z, x)
  const volumeOf = (l0, l1 = () => [0, 0, 0]) => {
    const data = new Uint16Array(cells * 3 * 4);
    for (let y = 0; y < NY; y++) for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
      const c = (y * NZ + z) * NX + x, px = VOL.x0 + x * VOL.step, py = VOL.y0 + z * VOL.step;
      for (let ch = 0; ch < 3; ch++) { data[(ch * cells + c) * 4] = toHalf(l0(ch, px, py, y)); l1(ch).forEach((v, k) => { data[(ch * cells + c) * 4 + 1 + k] = toHalf(v); }); }
    }
    return { image: { data, width: NX, height: NZ, depth: NY * 3 } };
  };
  const uniformsOf = tex => ({ uProbeSH: { value: tex },
    uProbeOrigin: { value: new T.Vector3(VOL.x0, VOL.heights[0], -VOL.y0) }, uProbeScale: { value: new T.Vector3(1 / VOL.step, 1 / (VOL.heights[1] - VOL.heights[0]), -1 / VOL.step) },
    uProbeDims: { value: new T.Vector3(NX, NY, NZ) } });
  const at = (x, y, h) => new T.Vector3(x, h, -y);   // plan -> scene
  // a linear field is reproduced exactly by the filter (to half precision) where the four cells lie on one side
  const linear = (ch, px, py, y) => [1 + 0.05 * px, 2 + 0.04 * py, 3 + 0.5 * y][ch];
  const U = uniformsOf(volumeOf(linear, () => [9, -9, 9]));   // L1 terms never reach the L0 reading
  for (const [x, y, h] of [[1.3, -1.7, 1.2], [-2.2, -2.9, 0.6], [2.6, 3.4, 1.5], [6.1, -3.3, 1.0]]) {
    assert.ok(W.isInside(x, y) && [[0, 0], [1, 0], [0, 1], [1, 1]].every(([a, b]) => W.isInside(Math.floor((x - VOL.x0) / VOL.step + a) * VOL.step + VOL.x0, Math.floor((y - VOL.y0) / VOL.step + b) * VOL.step + VOL.y0)));
    const e = W.probeIlluminant(U, at(x, y, h)), hy = Math.min(Math.max((h - VOL.heights[0]) / (VOL.heights[1] - VOL.heights[0]), 0.01), NY - 1.01);
    near(e[0], 1 + 0.05 * x, 4e-3, 'x'); near(e[1], 2 + 0.04 * y, 4e-3, 'y'); near(e[2], 3 + 0.5 * hy, 8e-3, 'height');
  }
  // region-aware (probe.glsl.js probeFetch): next to the outline the cells across it never count, on either side
  const sides = big => (ch, px, py) => W.isInside(px, py) ? 0.5 : big;
  const outsideBig = uniformsOf(volumeOf(sides(500))), outsideSmall = uniformsOf(volumeOf(sides(5)));
  let tested = 0;
  for (let x = -7.6; x <= 7.6; x += 0.37) for (const y of [-4.42, -4.55, 5.2, 5.3]) {
    const p = at(x, y, 1.5), corner = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([a, b]) => W.isInside(Math.floor((x - VOL.x0) / VOL.step + a) * VOL.step + VOL.x0, Math.floor((y - VOL.y0) / VOL.step + b) * VOL.step + VOL.y0));
    if (!W.isInside(x, y) || corner.every(Boolean) || !corner.some(Boolean)) continue;
    near(W.probeIlluminant(outsideBig, p)[1], 0.5, 1e-3, `inside at ${x}, ${y}`); near(W.probeIlluminant(outsideSmall, p)[1], 0.5, 1e-3); tested++;
  }
  assert.ok(tested > 10, `${tested} points beside the outline`);
  // the slot crossfade: the next slot's volume mixes in by uProbeBlend; no CPU data: no reading
  const other = volumeOf(() => 4), fade = { ...uniformsOf(volumeOf(() => 2)), uProbeNextSH: { value: other }, uProbeBlend: { value: 0 } };
  for (const [blend, want] of [[0, 2], [0.25, 2.5], [1, 4]]) { fade.uProbeBlend.value = blend; near(W.probeIlluminant(fade, at(1.3, -1.7, 1.2))[0], want, 2e-3, `blend ${blend}`); }
  assert.equal(W.probeIlluminant({ ...U, uProbeSH: { value: { image: {} } } }, at(0, 0, 1)), null);
  // the SH lookup carries the L1 terms (y, z, x) through the same filter
  const sh = W.probeSH(uniformsOf(volumeOf(() => 1, ch => [0.1 * ch, 0.2, -0.3])), at(1.3, -1.7, 1.2));
  for (let ch = 0; ch < 3; ch++) [1, 0.1 * ch, 0.2, -0.3].forEach((v, k) => near(sh[ch * 4 + k], v, 2e-3, `SH ${ch} ${k}`));
  // the irradiance is the shader's (probe.glsl.js probeEvalL1, by its text), never negative, and the plain L0 + L1 where mild
  for (const token of ['float A = max( 0.886227 * c.x, 0.0 ), L = length( c.wyz ) * 1.023328;', 'float p = 1.0 + 2.0 * r, a = ( 1.0 - r ) / ( 1.0 + r );',
    'return A * ( a + ( 1.0 - a ) * ( p + 1.0 ) * pow( q, p ) );']) assert.ok(W.PROBE_FETCH.includes(token), `probeEvalL1 changed: ${token}`);
  for (const [c, n] of [[[1, 0, 0, 2], [-1, 0, 0]], [[1, 0.5, -0.2, 0.1], [0, 1, 0]], [[0.3, 0, 0, 0.6], [1, 0, 0]]]) assert.ok(W.probeEvalL1(...c, new T.Vector3(...n)) >= 0);
  near(W.probeEvalL1(1, 0, 0, 0, new T.Vector3(1, 0, 0)), 0.886227, 1e-9, 'uniform light');
  near(W.probeEvalL1(1, 0, 0, 0.1, new T.Vector3(1, 0, 0)) / W.probeEvalL1(1, 0, 0, 0.1, new T.Vector3(-1, 0, 0)), (0.886227 + 0.1023328) / (0.886227 - 0.1023328), 0.05, 'mild: ~ linear');
  // rays stop at the plan's wall pieces (boxes [x0, x1, height0, height1, z0, z1])
  const box = [[2, 3, 0, 2.5, -1, 1]], o = new T.Vector3(0, 1.4, 0);
  near(W.wallDistance(o, new T.Vector3(1, 0, 0), box, 8), 2, 1e-12); assert.equal(W.wallDistance(o, new T.Vector3(-1, 0, 0), box, 8), 8);
  assert.equal(W.wallDistance(new T.Vector3(0, 2.8, 0), new T.Vector3(1, 0, 0), box, 8), 8, 'over a sill or under a lintel: an opening');
  assert.equal(W.wallDistance(o, new T.Vector3(1, 0, 1).normalize(), box, 8), 8, 'passes beside it');
  near(W.wallDistance(o, new T.Vector3(1, 0, 1).normalize(), [[2, 3, 0, 2.5, -1, 3]], 8), Math.SQRT2 * 2, 1e-9);
  // indoors: the light on the surfaces in view. Warm light arrives from the west, cool from the east (the L1 x terms): looking
  // east the walls in view face west and are lit warm; looking west, cool. Outdoors the mean light at the eye: neutral.
  const split = uniformsOf(volumeOf(() => 1, ch => [0, 0, [-0.5, 0, 0.5][ch]])), camera = new T.PerspectiveCamera(), look = h => { camera.rotation.set(-0.06, -h * Math.PI / 180, 0, 'YXZ'); camera.updateMatrixWorld(); };
  camera.position.copy(at(1.3, -1.7, 1.45));
  look(90); let e = W.adaptingIlluminant(split, camera, [], 1); assert.ok(e[0] / e[2] > 2, `looking east: warm ${e}`);
  look(270); e = W.adaptingIlluminant(split, camera, [], 1); assert.ok(e[2] / e[0] > 2, `looking west: cool ${e}`);
  e = W.adaptingIlluminant(split, camera, [], 0); near(e[0] / e[2], 1, 1e-3, 'outdoors: the mean');
  const half1 = W.adaptingIlluminant(split, camera, [], 0.5), r1 = W.adaptingIlluminant(split, camera, [], 1).map(v => v / W.luminance(W.adaptingIlluminant(split, camera, [], 1)));
  half1.map(v => v / W.luminance(half1)).forEach((v, i) => near(v, (r1[i] + 1) / 2, 1e-6, 'a doorway: halfway at equal luminance'));
  // a wall right ahead: the light is read in front of it (the side facing the camera), not behind it
  look(90); const wall = [[camera.position.x + 1, camera.position.x + 1.15, 0, 2.5, camera.position.z - 3, camera.position.z + 3]];
  const behind = uniformsOf(volumeOf((ch, px) => px > 1.3 + 1.1 ? [0, 0, 50][ch] : 1));
  e = W.adaptingIlluminant(behind, camera, wall, 1); assert.ok(e[2] / e[0] < 1.2, `the room's side of a wall: ${e}`);
  e = W.adaptingIlluminant(behind, camera, [], 1); assert.ok(e[2] / e[0] > 3, `no wall: the far side counts ${e}`);
  assert.equal(W.adaptingIlluminant({ ...U, uProbeSH: { value: { image: {} } } }, camera, [], 1), null);

  // ---- the runtime: lifecycle, glide, teleport snap, context restore; the matrix reaches both output paths
  const outputPass = new W.OutputPass(), draws = [];
  let bound = null, indoor = 1;
  const renderer = {
    toneMapping: T.AgXToneMapping, toneMappingExposure: 0.5, outputColorSpace: T.SRGBColorSpace, extensions: { has: () => true },
    domElement: new T.EventDispatcher(), getRenderTarget: () => bound, setRenderTarget(t) { bound = t; },
    render(mesh) { draws.push({ material: mesh.material, uIn: mesh.material.uniforms.uIn?.value.clone(), uWB: mesh.material.uniforms.uWhiteBalance?.value.clone() }); },
  };
  const room = uniformsOf(volumeOf(ch => [1.91, 0.807, 0.237][ch]));
  const lighting = { camera, outputPass, indoorWeight: () => indoor };
  const agx = await W.blenderAgX(outputPass, undefined, [new T.Data3DTexture(), new T.Data3DTexture()]);
  assert.ok(agx.fragmentShader.includes('uniform mat3 uIn;') && agx.fragmentShader.includes('enc(uIn * (t.rgb * gain))') && !agx.fragmentShader.includes('const mat3 IN'));
  const read = new T.WebGLRenderTarget(64, 36), write = read.clone();
  // AgX's input matrix is the old GLSL literal (column-major) exactly
  draws.length = 0; outputPass.render(renderer, write, read);
  assert.deepEqual([...draws[0].uIn.elements].map(v => +v.toPrecision(9)), [0.559463047, 0.0762332609, 0.0655375095, 0.304775811, 0.787952395, 0.16454273, 0.135812941, 0.135774849, 0.769741528]);
  const IN = draws[0].uIn.clone();
  for (const s of ['capture', 'autoexp=0', 'wb=0', 'fixedexposure', 'rawtone']) {
    assert.equal(W.createWhiteBalance({ lighting, volume: room, renderer, query: query(s) }), null, s);
    assert.equal(outputPass.whiteBalance, undefined); assert.equal(lighting.whiteBalance, undefined);
  }
  const wb = W.createWhiteBalance({ lighting, volume: room, renderer, query: query('') });
  assert.equal(lighting.whiteBalance, wb); assert.equal(outputPass.whiteBalance, wb.matrix);
  wb.update(1 / 30);   // the first frame snaps
  let st = wb.state;
  near(st.applied.kelvin, 2763, 10, 'lamp-lit room'); near(st.applied.D, S.indoorD, 1e-9);
  const warm = apply(wb.matrix.clone().transpose().elements, [1.91, 0.807, 0.237]);
  assert.ok(warm[0] / warm[2] < 1.6 && warm[0] > warm[2], `adapted ${warm}`);
  assert.ok(st.ms >= 0 && st.matrix.length === 9);
  draws.length = 0; outputPass.render(renderer, write, read);
  assert.ok(draws[0].uIn.equals(new T.Matrix3().multiplyMatrices(IN, wb.matrix)), 'AgX: uIn = IN x white balance');
  // daylight comes in (a slot fade, a lamp switched off): the state glides with tau, then a teleport snaps
  room.uProbeSH.value = volumeOf(ch => [1, 1, 1][ch]);
  for (let i = 0; i < 45; i++) wb.update(1 / 30);
  st = wb.state;
  const k = 1e6 / (1e6 / 2763 + (1e6 / 6504 - 1e6 / 2763) * (1 - Math.exp(-1.5 / S.tau)));
  near(st.applied.kelvin, k, 25, 'glide'); near(st.target.kelvin, 6504, 5);
  camera.position.x += 0.5; wb.update(1 / 30); assert.ok(Math.abs(wb.state.applied.kelvin - 6504) > 100, 'a step is not a teleport');
  camera.position.x += S.teleport + 0.1; wb.update(1 / 30); near(wb.state.applied.kelvin, 6504, 5, 'teleport');
  // outdoors the degree falls (glides) to outdoorD; a restored context snaps
  indoor = 0; room.uProbeSH.value = volumeOf(ch => [1.91, 0.807, 0.237][ch]);
  wb.update(1 / 30); assert.ok(wb.state.applied.D > S.outdoorD + 0.3);
  renderer.domElement.dispatchEvent({ type: 'webglcontextrestored' }); wb.update(1 / 30);
  near(wb.state.applied.D, S.outdoorD, 1e-9); near(wb.state.applied.kelvin, 2763, 10);
  // no CPU data (never filled): the last state holds
  const before = wb.matrix.clone(); room.uProbeSH.value = { image: {} }; wb.update(1 / 30); assert.ok(wb.matrix.equals(before));
  // a broken volume never throws into the frame: reported once, the last matrix kept
  const errors = [], error = console.error; console.error = (...a) => errors.push(a);
  try { room.uProbeSH.value = volumeOf(() => 1); room.uProbeOrigin = null; wb.update(1 / 30); wb.update(1 / 30); } finally { console.error = error; }
  assert.equal(errors.length, 1); assert.ok(wb.matrix.equals(before));
  room.uProbeOrigin = uniformsOf(null).uProbeOrigin;
  // three's OutputPass fallback (?agx=three) through the auto exposure's patch: after the exposure, before tone mapping
  const exposure = W.createBakedAutoExposure({ renderer, lighting, getSlot: () => W.SLOTS.noon, query: query('localadapt=0') });
  const fallback = outputPass.material.fragmentShader;
  assert.ok(fallback.includes('uniform mat3 uWhiteBalance;'));
  const iExposure = fallback.indexOf('gl_FragColor.rgb *= texture2D(tAutoExposure'), iWB = fallback.indexOf('gl_FragColor.rgb = uWhiteBalance * gl_FragColor.rgb;'), iTone = fallback.indexOf('// tone mapping');
  assert.ok(iExposure > 0 && iExposure < iWB && iWB < iTone, 'scene-linear, after the exposure, before tone mapping');
  renderer.toneMapping = T.NeutralToneMapping; exposure.update(1 / 30);
  draws.length = 0; outputPass.render(renderer, write, read);
  assert.equal(draws.at(-1).material, outputPass.material); assert.ok(draws.at(-1).uWB.equals(wb.matrix));
  // disposal: both paths back to no white balance
  wb.dispose(); wb.dispose();
  assert.equal(outputPass.whiteBalance, undefined); assert.equal(lighting.whiteBalance, undefined);
  draws.length = 0; outputPass.render(renderer, write, read); assert.ok(draws.at(-1).uWB.equals(new T.Matrix3()));
  renderer.toneMapping = T.AgXToneMapping; draws.length = 0; outputPass.render(renderer, write, read); assert.ok(draws.at(-1).uIn.equals(IN));
  exposure.dispose();
  assert.equal(outputPass.uniforms.uWhiteBalance, undefined); assert.ok(!outputPass.material.fragmentShader.includes('uWhiteBalance'));
  console.log('white balance: gates, CCT/tint round trip, von Kries D 0/1/luminance/monotonic, clamps, degree, fps-invariant glide/snap/hold, region-aware/crossfade probe lookup, shader irradiance, walls in view/outdoor mean/doorway blend, lifecycle, AgX uIn and OutputPass fallback wiring OK');
} finally { await rm(dir, { recursive: true, force: true }); }
