// Browser-free math and render-call fixtures: no WebGL context, network or GPU.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const dir = await mkdtemp(join(tmpdir(), 'croton-exposure-'));
try {
  const built = await build({ stdin: { contents: `
    export * from './src/auto_exposure_policy.js'; export * from './src/auto_exposure.js';
    export { SLOTS, blendSlot } from './src/lighting_slots.js'; export { blenderAgX } from './src/agx.js';
    export { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'; export * as THREE from 'three';
  `, resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
  const file = join(dir, 'fixture.mjs'); await writeFile(file, built.outputFiles[0].contents);
  const { METER, ADAPTATION, autoExposureEnabled, meterWeight, targetExposureEV, adaptExposureEV, glideExposureEV, filterMeterLog,
    SLOTS, blendSlot, createBakedAutoExposure, blenderAgX, OutputPass, THREE: T } = await import(pathToFileURL(file));
  const near = (a, b, tolerance = 1e-10) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
  // the maximum lift above each slot's ev before the key moved to the listing photos' level (key 0.15)
  const SLOT_NAMES = ['sunrise', 'noon', 'golden', 'dusk'], FIRST_MAX = { sunrise: 5, noon: 4.5, golden: 5, dusk: 3.5 };
  const query = s => new URLSearchParams(s);
  assert.equal(autoExposureEnabled(query('')), true);
  assert.equal(autoExposureEnabled(query('autoexp=1&lightmap=noon&tier=mobile')), true);
  for (const s of ['rawtone', 'fixedexposure', 'autoexp=0', 'capture', 'capture&autoexp=1', 'rawtone&autoexp=1'])
    assert.equal(autoExposureEnabled(query(s)), false, s);
  for (const slot of Object.values(SLOTS)) {
    near(targetExposureEV(1e-9, slot), slot.ev + slot.autoExposure.maxEV);
    near(targetExposureEV(1e9, slot), slot.ev + slot.autoExposure.minEV);
    near(targetExposureEV(slot.autoExposure.key / 2 ** slot.ev, slot), slot.ev);
    for (const lum of [0, 0.001, 0.1, 1, 10000]) near(targetExposureEV(lum, slot, 0), slot.ev + slot.autoExposure.outdoor);   // the garden's, fixed
  }
  assert.equal(targetExposureEV(0.001, SLOTS.dusk), SLOTS.dusk.ev + SLOTS.dusk.autoExposure.maxEV);
  // A noon room can reach 2 stops above base; a small strip of bright sky should not erase that lift.
  let logs = 0, weights = 0, arithmetic = 0;
  for (let y = 0; y < METER.height; y++) for (let x = 0; x < METER.width; x++) {
    const u = (x + 0.5) / METER.width, v = (y + 0.5) / METER.height;
    const w = meterWeight(u, v), lum = v > 0.85 ? 10 : 0.045;
    logs += Math.log2(lum) * w; weights += w; arithmetic += lum / (METER.width * METER.height);
  }
  const average = 2 ** (logs / weights), roomTarget = targetExposureEV(average, SLOTS.noon);
  assert.ok(roomTarget > SLOTS.noon.ev + 1.8);
  assert.ok(targetExposureEV(arithmetic, SLOTS.noon) < SLOTS.noon.ev);
  assert.ok(meterWeight(0.5, 0.99) < meterWeight(0.5, 0.01));
  assert.ok(meterWeight(0.5, 0.45) > meterWeight(0.01, 0.45) * 3);
  // Smoothing is exponential in stops, monotonic, frame-rate independent and slower when brightening.
  const settle = (start, end, seconds, fps) => {
    let ev = start;
    for (let i = 0; i < seconds * fps; i++) {
      const next = adaptExposureEV(ev, end, 1 / fps);
      assert.ok(next >= Math.min(ev, end) && next <= Math.max(ev, end)); ev = next;
    }
    return ev;
  };
  near(settle(-1, 1, 2, 30), settle(-1, 1, 2, 144));
  near(adaptExposureEV(-1, 1, 0.8), 1 - 2 / Math.E);
  near(adaptExposureEV(1, -1, 0.4), -1 + 2 / Math.E);
  assert.ok(adaptExposureEV(-1, 1, 0.4) + 1 < 1 - adaptExposureEV(1, -1, 0.4));
  assert.ok(adaptExposureEV(-1, 1, 0.6, true) > 0.9);
  assert.equal(adaptExposureEV(-1, 1, 0), -1);
  assert.ok(Math.abs(settle(1, -1, 4, 60) + 1) < 0.0001);
  const glide = (start, target, seconds, fps, fast = false, settings = ADAPTATION) => {
    let state = { ev: start, drive: start };
    for (let i = 0; i < Math.round(seconds * fps); i++) state = glideExposureEV(state, target, 1 / fps, fast, settings);
    return state;
  };
  for (const [start, target] of [[-1, 1], [1, -1]]) {
    for (const fps of [15, 30, 60, 144]) near(glide(start, target, 2, fps).ev, glideExposureEV({ ev: start, drive: start }, target, 2).ev);
  }
  assert.ok(glide(-1, 1, 0.4, 60).ev + 1 < 1 - glide(1, -1, 0.4, 60).ev);
  assert.ok(glide(-1, 1, 0.6, 60, true).ev > 0.7); // fast, still a glide
  const initial = { ev: 0, drive: 0 }, h = 1e-5;
  assert.deepEqual(glideExposureEV(initial, 2, 0), initial); // meter tick cannot assign applied EV
  assert.ok(glideExposureEV(initial, 2, h).ev / h < 0.001); // eased start, zero initial slope
  const moving = glideExposureEV(initial, 2, 0.3);
  const beforeSlope = (glideExposureEV(moving, 2, h).ev - moving.ev) / h;
  const afterSlope = (glideExposureEV(moving, -2, h).ev - moving.ev) / h;
  near(beforeSlope, afterSlope, 0.001); // reversed meter target does not kink output velocity
  near(glide(0, 1, 1, 60, false, { ...ADAPTATION, ease: 0.8 }).ev,
    glideExposureEV(initial, 1, 1, false, { ...ADAPTATION, ease: 0.8 }).ev); // equal taus
  // A target held for three frames still advances on EVERY frame between metering ticks.
  let state = initial;
  for (let frame = 0; frame < 60; frame++) {
    const target = Math.floor(frame / 3) % 2 ? 1.5 : 2;
    const next = glideExposureEV(state, target, 1 / 60);
    assert.ok(next.ev > state.ev); assert.ok(next.ev - state.ev < 0.04); state = next;
  }
  let filtered = filterMeterLog(null, -4, 0);
  for (let i = 0; i < 50; i++) filtered = filterMeterLog(filtered, -4 + (i % 2 ? 0.08 : -0.08), 0.05);
  near(filtered.held, -4); // small window flicker stays in the dead band
  filtered = filterMeterLog(null, -4, 0);
  filtered = filterMeterLog(filtered, 4, 0.05); near(filtered.held, -4);
  filtered = filterMeterLog(filtered, -4, 0.05); near(filtered.held, -4); // median rejects a one-tick flash
  filtered = filterMeterLog(filtered, -2, 0.05); filtered = filterMeterLog(filtered, -2, 0.05);
  assert.ok(filtered.held > -4 && filtered.held < -2); // sustained radiance change is filtered, not discarded
  // Blend the base and limits without resetting history, including the lower dusk ceiling.
  const half = blendSlot(SLOTS.noon, SLOTS.dusk, 0.5);
  const halfMax = (SLOTS.noon.autoExposure.maxEV + SLOTS.dusk.autoExposure.maxEV) / 2;
  near(half.autoExposure.maxEV, halfMax); near(targetExposureEV(0.001, half), (SLOTS.noon.ev + SLOTS.dusk.ev) / 2 + halfMax);
  near(targetExposureEV(0.001, SLOTS.noon, 0.5), SLOTS.noon.ev + SLOTS.noon.autoExposure.maxEV / 2);

  // Exercise the real output hooks and GPU scheduling with a renderer that only records calls.
  const camera = new T.PerspectiveCamera(), outputPass = new OutputPass(), draws = [];
  let bound = null, mood = SLOTS.noon, indoor = 1;
  const renderer = {
    toneMapping: T.AgXToneMapping, toneMappingExposure: 0.5, outputColorSpace: T.SRGBColorSpace,
    domElement: new T.EventDispatcher(), getRenderTarget: () => bound, setRenderTarget(t) { bound = t; },
    render(mesh) { draws.push({ target: bound, material: mesh.material, uniforms: Object.fromEntries(Object.entries(mesh.material.uniforms).map(([k, u]) => [k, u.value?.isVector3 ? u.value.clone() : u.value])) }); },
  };
  const lighting = { camera, outputPass, indoorWeight: () => indoor };
  const originalRender = outputPass.render, originalShader = outputPass.material.fragmentShader;
  const agx = await blenderAgX(outputPass, undefined, [new T.Data3DTexture(), new T.Data3DTexture()]);
  const agxRender = outputPass.render;
  for (const s of ['autoexp=0', 'capture', 'fixedexposure', 'rawtone']) {
    assert.equal(createBakedAutoExposure({ renderer, lighting, getSlot: () => mood, query: query(s) }), null);
    assert.equal(outputPass.render, agxRender); assert.equal(outputPass.material.fragmentShader, originalShader);
  }
  const adaptation = createBakedAutoExposure({ renderer, lighting, getSlot: () => mood, query: query('localadapt=0') });
  assert.equal((outputPass.material.fragmentShader.match(/precision highp sampler2D;/g) ?? []).length, 1);
  assert.equal(lighting.autoExposure, adaptation);
  const read = new T.WebGLRenderTarget(1280, 720), write = read.clone();
  const draw = () => { draws.length = 0; adaptation.update(1 / 60); outputPass.render(renderer, write, read); return draws; };
  draw(); assert.equal(draws.length, 5);
  assert.equal(draws[0].uniforms.tScene, read.texture); // pre-output scene HDR, never the exposure-adjusted image
  assert.deepEqual(draws.slice(0, 4).map(d => [d.target.width, d.target.height]), [[64, 36], [16, 9], [1, 1], [1, 1]]);
  assert.equal(draws[2].uniforms.uValid, 0); assert.equal(draws[3].uniforms.uIndoor, 1);
  assert.equal(agx.uniforms.autoExposure.value, true); assert.equal(agx.uniforms.tAutoExposure.value, adaptation.texture);
  const first = adaptation.texture;
  draw(); assert.equal(draws.length, 2); assert.notEqual(adaptation.texture, first);
  assert.equal(draws[0].uniforms.tPrevious, first); near(draws[0].uniforms.uDt, 1 / 60);
  draw(); assert.equal(draws.length, 2); draw(); assert.equal(draws.length, 5); // every third frame
  camera.position.x += 5; draw(); assert.equal(draws.length, 5); assert.equal(draws[3].uniforms.uFast, 1);
  assert.equal(draws[2].uniforms.uValid, 0); // a teleport restarts the meter history instead of easing the old view out
  mood = half; indoor = 0.5; draw();
  assert.equal(draws[0].uniforms.uValid, 1); assert.equal(draws[0].uniforms.uIndoor, 0.5);
  assert.deepEqual(draws[0].uniforms.uSlot.toArray().map(v => +v.toFixed(6)), [(SLOTS.noon.ev + SLOTS.dusk.ev) / 2, -0.5, (SLOTS.noon.autoExposure.maxEV + SLOTS.dusk.autoExposure.maxEV) / 2].map(v => +v.toFixed(6)));
  near(draws[0].uniforms.uKey, Math.sqrt(SLOTS.noon.autoExposure.key * SLOTS.dusk.autoExposure.key), 1e-12);   // the key fades in stops
  near(draws[0].uniforms.uOutdoor, SLOTS.dusk.autoExposure.outdoor / 2, 1e-12);
  camera.rotation.y += Math.PI / 2; draw();
  assert.equal(draws.length, 5); assert.equal(draws[3].uniforms.uValid, 1); assert.equal(draws[3].uniforms.uFast, 1); assert.equal(draws[2].uniforms.uValid, 0);
  renderer.domElement.dispatchEvent({ type: 'webglcontextrestored' });
  draw(); assert.equal(draws.length, 5); assert.equal(draws[3].uniforms.uValid, 0);
  // three's alternate output path uses the same texture and restores its source when disposed.
  renderer.toneMapping = T.NeutralToneMapping; draw();
  assert.equal(draws.at(-1).material, outputPass.material);
  assert.equal(outputPass.uniforms.tAutoExposure.value, adaptation.texture);
  assert.ok(outputPass.material.fragmentShader.includes('texture2D(tAutoExposure, vec2(0.5)).r / max(toneMappingExposure'));
  let released = 0;
  const targets = new Set(draws.map(d => d.target).filter(t => t !== write));
  for (const t of targets) t.addEventListener('dispose', () => released++);
  adaptation.dispose(); adaptation.dispose();
  assert.equal(outputPass.render, agxRender); assert.equal(outputPass.material.fragmentShader, originalShader);
  assert.equal(outputPass.autoExposureTexture, undefined); assert.equal(lighting.autoExposure, undefined);
  assert.equal(released, targets.size);
  draws.length = 0; renderer.toneMapping = T.AgXToneMapping; outputPass.render(renderer, write, read);
  assert.equal(agx.uniforms.autoExposure.value, false); assert.equal(agx.uniforms.exposure.value, 0.5);
  assert.notEqual(outputPass.render, originalRender); // Blender output wrapper is retained
  // ---- the key against the realism target. The meter's weighted log mean is shown at the slot's key; through the site's
  // AgX (agx.js: Blender AgX, Medium High Contrast) the daylight key must read as the listing photos' interior median
  // (tools/golden/listing_brightness.json, tools/listing_brightness.py), dusk lower (lamp-lit rooms, not day). The first key
  // (0.15, a mid-grey meter) read 101/255 against the photos' 191; the gate measured the visitor's rooms at 100-108.
  const { gunzipSync } = await import('node:zlib'), { readFileSync } = await import('node:fs');
  const WEBDIR = fileURLToPath(new URL('../', import.meta.url));
  const lutBytes = gunzipSync(readFileSync(join(WEBDIR, 'assets/agx/agx_lut.bin.gz'))), lut16 = new Uint16Array(lutBytes.buffer, lutBytes.byteOffset, lutBytes.byteLength / 2);
  let off = 0;
  const [lumLut, agxLut] = [37, 57].map(n => {   // as agx.js loadAgXLuts: red fastest, 16-bit deltas along red, / 64000
    const d = new Float64Array(n * n * n * 3);
    for (let row = 0; row < n * n; row++) for (let k = 0; k < 3; k++) {
      let v = 0; for (let r = 0; r < n; r++) { v = (v + lut16[off + (row * n + r) * 3 + k]) & 0xffff; d[(row * n + r) * 3 + k] = v / 64000; }
    }
    off += n * n * n * 3; return { n, d };
  });
  const tetra = ({ n, d }, c) => {   // agx.js tetra (OCIO's tetrahedral interpolation)
    const m = n - 1, x = c.map(v => Math.min(Math.max(v, 0), 1) * m), b = x.map(v => Math.min(Math.floor(v), m - 1)), f = x.map((v, i) => v - b[i]);
    const at = (i, j, k) => [0, 1, 2].map(ch => d[((k * n + j) * n + i) * 3 + ch]);
    const [r, g, bl] = f; let s1, s2, w;
    if (r >= g) { if (g >= bl) { s1 = [1, 0, 0]; s2 = [1, 1, 0]; w = [r, g, bl]; } else if (r >= bl) { s1 = [1, 0, 0]; s2 = [1, 0, 1]; w = [r, bl, g]; } else { s1 = [0, 0, 1]; s2 = [1, 0, 1]; w = [bl, r, g]; } }
    else if (g <= bl) { s1 = [0, 0, 1]; s2 = [0, 1, 1]; w = [bl, g, r]; } else if (r >= bl) { s1 = [0, 1, 0]; s2 = [1, 1, 0]; w = [g, r, bl]; } else { s1 = [0, 1, 0]; s2 = [0, 1, 1]; w = [g, bl, r]; }
    const p0 = at(...b), p1 = at(b[0] + s1[0], b[1] + s1[1], b[2] + s1[2]), p2 = at(b[0] + s2[0], b[1] + s2[1], b[2] + s2[2]), p3 = at(b[0] + 1, b[1] + 1, b[2] + 1);
    return [0, 1, 2].map(ch => (1 - w[0]) * p0[ch] + (w[0] - w[1]) * p1[ch] + (w[1] - w[2]) * p2[ch] + w[2] * p3[ch]);
  };
  const enc = c => c.map(v => (Math.log2(Math.max(v, 1e-10)) + 12.47393) / 25), dec = c => c.map(v => 2 ** (v * 25 - 12.47393));
  const mul = (M, c) => [0, 1, 2].map(i => M[i][0] * c[0] + M[i][1] * c[1] + M[i][2] * c[2]);
  const IN = [[0.559463047, 0.304775811, 0.135812941], [0.0762332609, 0.787952395, 0.135774849], [0.0655375095, 0.16454273, 0.769741528]];
  const LOOK = [[0.967977806, 0.117887618, -0.0858536371], [0.131809967, 0.916062285, -0.047868188], [0.0468677678, 0.0124191066, 0.940833412]];
  const VIEW = [[1.04730554, -0.135979098, 0.0886511001], [-0.153314683, 1.11078232, 0.0425245458], [-0.0501479231, -0.00788863052, 1.05790992]];
  const agxLuma = x => {   // grey x (scene linear, after exposure) -> 8-bit luma of the display sRGB
    let c = dec(tetra(lumLut, enc(mul(IN, [x, x, x]))));
    c = dec(enc(mul(LOOK, c)).map(v => (v - 0.4) * 1.2 + 0.4));
    c = tetra(agxLut, enc(mul(VIEW, c))).map(v => Math.max(v, 0) ** 2.4).map(v => v >= 0.00303993467 ? 1.055 * v ** (1 / 2.4) - 0.055 : v * 12.9232101);
    return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) * 255;
  };
  assert.ok(Math.abs(agxLuma(0.18) - 120) < 4, `AgX mid grey ${agxLuma(0.18)}`);   // Blender AgX MHC: 18% grey ~ 47%
  const photos = JSON.parse(readFileSync(join(WEBDIR, 'tools/golden/listing_brightness.json'), 'utf8')).interior;
  for (const name of ['sunrise', 'noon', 'golden']) {
    const shown = agxLuma(SLOTS[name].autoExposure.key);
    assert.ok(Math.abs(shown - photos.median) <= 4, `${name}: the key ${SLOTS[name].autoExposure.key} reads ${shown.toFixed(1)}, the listing photos ${photos.median}`);
  }
  const dusk = agxLuma(SLOTS.dusk.autoExposure.key);
  assert.ok(dusk > 145 && dusk < photos.p10 - 10, `dusk: the lamp-lit rooms below the daylight photos, still bright (${dusk.toFixed(1)})`);
  assert.ok(agxLuma(0.15) < 110, 'the first key read as a mid-grey room');
  // the garden: the fixed exposure (ev: the gate's fixed set, the Cycles references) by day; at dusk the visitor sees the
  // patio as the listing's twilight photos do (+3.5 EV: ~58/255, they 69-121; the garden at ev alone read 4)
  for (const name of ['sunrise', 'noon', 'golden']) assert.equal(SLOTS[name].autoExposure.outdoor, 0);
  assert.ok(SLOTS.dusk.autoExposure.outdoor >= 3 && SLOTS.dusk.autoExposure.outdoor <= 4.5);
  near(targetExposureEV(1, SLOTS.dusk, 0), SLOTS.dusk.ev + SLOTS.dusk.autoExposure.outdoor);
  // the maximum lift moved with the key: the same dark spaces meet it (laundry, hall closet), not the lit rooms
  for (const name of SLOT_NAMES) near(SLOTS[name].autoExposure.maxEV - Math.log2(SLOTS[name].autoExposure.key / 0.15), FIRST_MAX[name], 0.06);
  // gate (c)'s brightness band (bake/validate/thresholds.json) brackets the photos: the set band holds their median, the
  // frame band their spread; dusk below daylight
  const band = JSON.parse(readFileSync(join(WEBDIR, '../bake/validate/thresholds.json'), 'utf8')).brightness;
  for (const name of ['sunrise', 'noon', 'golden']) {
    const [lo, hi] = band.set[name], [flo, fhi] = band.frame[name];
    assert.ok(lo < photos.median && photos.median < hi && hi - lo <= 25 && flo < photos.p10 && fhi > photos.p90, `${name} band ${band.set[name]} / ${band.frame[name]}`);
  }
  assert.ok(band.set.dusk[1] < band.set.noon[0] + 5 && band.set.dusk[0] < dusk && dusk < band.set.dusk[1], `dusk band ${band.set.dusk} around ${dusk.toFixed(0)}`);
  // and the rooms' contrast: the shadow band holds the photos' darker tenth (local_adapt.js lifts no shadow)
  for (const name of ['sunrise', 'noon', 'golden']) {
    const [slo, shi] = band.shadows[name];
    assert.ok(slo < photos.p10Luma && photos.p10Luma < shi && shi < band.set[name][0], `${name} shadows band ${band.shadows[name]} around the photos' ${photos.p10Luma}`);
  }
  console.log('auto exposure: the key against the listing photos (AgX), the bounds with it and the gate band OK');
  console.log('auto exposure: weighted meter, median/temporal/dead band, eased per-frame glide, 15–144 fps invariance, asymmetry, no meter-tick step/kink, slot blending, garden lock, teleport, output transforms, capture toggles and lifecycle OK');
} finally { await rm(dir, { recursive: true, force: true }); }
