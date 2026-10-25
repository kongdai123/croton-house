// The live cinematic lens without a GPU (lens_policy.js, lens.js): the thin lens's circle of confusion and its look at the
// walkthrough's focal length, the aperture kernel, the autofocus statistic and its focus pull, the switches, the shader's
// circle of confusion against the JS reference, and the pass's CPU side on a stub renderer (where it sits in the
// composer, when focus snaps, what it focuses on).
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const web = fileURLToPath(new URL('../', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'croton-lens-'));
const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
try {
  const built = await build({ stdin: { contents: `
    export * from './src/lens_policy.js'; export * from './src/lens_shift.js'; export { LensPass, createLens } from './src/lens.js'; export * from './src/frame_clock.js';
    export { TIERS } from './src/tier.js'; export * as THREE from 'three';
  `, resolveDir: web }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
  const file = join(dir, 'fixture.mjs'); await writeFile(file, built.outputFiles[0].contents);
  const L = await import(pathToFileURL(file)), { LENS, THREE: T } = L;

  // ---- the thin lens --------------------------------------------------------------------------------------------------------
  const f = L.focalLengthMm(62);
  close(L.SENSOR_HEIGHT_MM, 20.25, 1e-12, 'a 16:9 full-frame gate: 36 x 20.25 mm'); close(L.sensorHeightMm(3 / 4), 36, 1e-12, 'a portrait frame: 36 mm tall');
  close(f, 16.85, 0.01, 'the walkthrough\'s 62 degrees: a 16.9 mm lens');
  close(L.focalLengthMm(2 * Math.atan(10.125 / 28) * 180 / Math.PI), 28, 1e-9, 'the film\'s 39.8 degrees: 28 mm');
  assert.equal(L.cocRadius(3, f, 2.8, 3), 0, 'sharp in the focus plane');
  assert.ok(L.cocRadius(10, f, 2.8, 3) > 0 && L.cocRadius(1, f, 2.8, 3) < 0, 'far positive, near negative');
  assert.ok(Math.abs(L.cocRadius(10, f, 5.6, 3)) < Math.abs(L.cocRadius(10, f, 2.8, 3)), 'stopping down sharpens');
  const px = (r, height = 1440) => 2 * Math.abs(r) * height;   // the disc's diameter in pixels
  // the thin-lens formula itself: c = f^2 / (N (s - f)) * |d - s| / d
  close(L.cocRadius(8, 50, 2, 2) * 2 * L.SENSOR_HEIGHT_MM, 50 * 50 / (2 * (2000 - 50)) * 6 / 8, 1e-9, 'the thin-lens circle (mm)');
  // the spec's own check: 50 mm f/2.8 focused at 1.2 m, a background at 3.5 m blurs 1.4% of the frame width
  close(L.cocRadius(3.5, 50, 2.8, 1.2) * 2 * L.SENSOR_HEIGHT_MM / 36, 0.0142, 0.0002, '50 mm f/2.8 at 1.2 m');
  assert.equal(L.clampCoc(0.5), LENS.maxCoc); assert.equal(L.clampCoc(-0.5), -LENS.maxCoc); assert.equal(L.clampCoc(0.001), 0.001);
  const H = L.hyperfocal(f, LENS.fStopRooms);
  close(H, (f * f / (LENS.fStopRooms * 0.03) + f) / 1000, 1e-12, 'hyperfocal'); close(H, 1.20, 0.01, 'hyperfocal at 16.9 mm f/8');
  close(L.cocRadius(1e9, f, 2.8, L.hyperfocal(f, 2.8)) * 2 * L.SENSOR_HEIGHT_MM, LENS.acceptableCoc, 1e-6, 'focused at the hyperfocal distance, the horizon is just acceptably sharp');

  // ---- the look (lens_policy.js; the film's camera language): rooms deep, close subjects shallow ------------------------------
  close(L.apertureFor(0.8), LENS.fStop, 1e-12, 'a close subject: wide open'); close(L.apertureFor(LENS.subjectNear), LENS.fStop, 1e-12, 'up to subjectNear');
  close(L.apertureFor(LENS.subjectFar), LENS.fStopRooms, 1e-9, 'a room: stopped down'); close(L.apertureFor(30), LENS.fStopRooms, 1e-9, 'a view through the house');
  { let last = 0; for (let d = 0.3; d < 30; d *= 1.02) { const n = L.apertureFor(d); assert.ok(n >= last - 1e-12, `the aperture closes steadily: ${d.toFixed(2)} m`); last = n; } }
  assert.ok(LENS.fStop >= 2 && LENS.fStop <= 2.8, 'details and the dog: f/2-f/2.8'); assert.ok(LENS.fStopRooms >= 8 && LENS.fStopRooms <= 11, 'architecture: f/8-f/11');
  // the dog 0.8 m away, a wall 5 m behind it: an 11 px disc at 1440 px (0.4% of the width)
  close(px(L.cocRadius(5, f, L.apertureFor(0.8), L.focusFor(0.8, H))), 10.8, 0.15, 'focused on the dog, the wall behind');
  assert.ok(px(LENS.maxCoc) >= 1.5 * px(L.cocRadius(1e6, f, LENS.fStop, 0.8)), 'the clamp leaves the far field of a close focus alone');
  // a room, whatever the centre sees from 2.5 m out: focused at 2.5 m at f/8, sharp from 1 m to the horizon (architecture: at
  // most 0.1% of the frame width anywhere, 2.6 px of 2560)
  for (const d of [2.5, 3, 4, 6, 10, 40]) {
    const s = L.focusFor(d, H); close(s, Math.max(H, LENS.subjectFar), 1e-9, `a room seen at ${d} m: one focus`);
    for (const z of [1, 1.5, 3, 5, 20, 1e6]) assert.ok(px(L.cocRadius(z, f, L.apertureFor(s), s)) < 2, `a room focused for ${d} m reads sharp at ${z} m`);
  }

  // ---- the aperture kernel ------------------------------------------------------------------------------------------------------
  const k = L.bokehKernel();
  assert.equal(k.length, 2 * LENS.samples, '43 taps');
  assert.deepEqual([k[0], k[1]], [0, 0], 'the centre first');
  const radii = []; for (let i = 0; i < k.length; i += 2) radii.push(Math.hypot(k[i], k[i + 1]));
  assert.ok(radii.every(r => r <= 1 + 1e-9), 'within the unit disc');
  assert.ok(Math.max(...radii) > 0.99, 'the outer ring reaches the edge');
  // rounded hexagon: the outer ring's radius varies between the flats (cos 30 deg pulled 60% to the circle) and 1
  const outer = radii.slice(-21), flat = LENS.roundness + (1 - LENS.roundness) * Math.cos(Math.PI / 6);
  assert.ok(Math.min(...outer) >= flat - 1e-9 && Math.min(...outer) < 0.99, `polygonal: ${Math.min(...outer)}`);
  close(L.polygonRadius(LENS.bladeRotation), 1, 1e-9, 'a corner at the blade rotation');
  close(L.polygonRadius(LENS.bladeRotation + Math.PI / 6), Math.cos(Math.PI / 6), 1e-9, 'a flat between corners');
  assert.equal(L.polygonRadius(1.2, 0), 1, 'no blades: a circle');

  // ---- autofocus: the centre-weighted statistic --------------------------------------------------------------------------------
  const pattern = L.focusPattern();
  assert.equal(pattern.length, LENS.afGrid ** 2);
  const centre = pattern[(pattern.length - 1) / 2];
  assert.deepEqual([centre.x, centre.y], [0, 0]); assert.ok(pattern.every(p => p.weight <= centre.weight && p.weight > 0));
  close(Math.max(...pattern.map(p => p.x)), LENS.afRegion / 2, 1e-12, 'the area\'s half-width');
  const at = (depths) => L.focusTarget(pattern.map((p, i) => ({ depth: depths(i, p), weight: p.weight })));
  close(at(() => 2), 2, 1e-9, 'a flat target');
  // a pole through the corner of the area, a leaf at the edge: the median does not move
  close(at((i, p) => Math.abs(p.x) > 0.02 && p.y > 0 ? 0.3 : 2), 2, 1e-9, 'robust to a near edge');
  close(at((i, p) => p.y < -0.02 ? 50 : 2), 2, 1e-9, 'robust to a far view past an edge');
  // sky is ignored; all sky: no target (the shader rests on the hyperfocal distance)
  close(at((i, p) => p.y > 0 ? Infinity : 3), 3, 1e-9, 'sky ignored');
  close(at((i, p) => p.y > 0 ? 900 : 3), 3, 1e-9, 'beyond skyDepth is sky');
  assert.equal(at(() => Infinity), null);
  // the weighted median: the sample where the cumulative weight reaches half
  close(L.focusTarget([{ depth: 1, weight: 1 }, { depth: 4, weight: 1.5 }, { depth: 9, weight: 1 }]), 4, 1e-9, 'weighted median');
  close(L.focusTarget([{ depth: 1, weight: 3 }, { depth: 4, weight: 1 }, { depth: 9, weight: 1 }]), 1, 1e-9, 'a heavy near weight wins');

  // ---- autofocus: where to focus for what the area sees (a close subject exactly, a room at one deep focus) ---------------
  const roomFocus = Math.max(H, LENS.subjectFar);
  close(L.focusFor(0.8, H), 0.8, 1e-12, 'the dog: exactly'); close(L.focusFor(LENS.subjectNear, H), LENS.subjectNear, 1e-12, 'up to subjectNear: exactly');
  close(L.focusFor(LENS.subjectFar, H), roomFocus, 1e-9, 'a room: the farther of the hyperfocal distance and subjectFar'); close(L.focusFor(12, H), roomFocus, 1e-9, 'a view through the house: the same');
  close(L.focusFor(9, 10.4), 10.4, 1e-9, 'a long lens (50 mm f/8): its hyperfocal distance');
  { let last = 0; for (let d = 0.3; d < 30; d *= 1.02) { const v = L.focusFor(d, H); assert.ok(v >= last - 1e-12, `rising at ${d.toFixed(2)} m`); last = v; } }

  // ---- the shaders are the JS references (GLSL transliterated: the thin lens at the policy's aperture, the room focus, the
  // glow's source, one frame of autofocus) ---------------------------------------------------------------------------------------
  const src = await readFile(join(web, 'src/lens.js'), 'utf8');
  const fn = name => { const i = src.search(new RegExp(`float ${name}\\(`)); assert.ok(i >= 0, `GLSL ${name}`); let depth = 0;
    for (let k = src.indexOf('{', i); k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1); } };
  const toJS = code => code.replace(/\bfloat (\w+)\(([^)]*)\) \{/g, (m, name, args) => `function ${name}(${args.replace(/\bfloat /g, '')}) {`)
    .replace(/\b(float|bool) /g, 'let ').replace(/\bexp2\(/g, 'ex2(').replace(/\bexp\(/g, 'Math.exp(').replace(/\blog2\(/g, 'Math.log2(')
    .replace(/\babs\(/g, 'Math.abs(').replace(/\bmax\(/g, 'Math.max(').replace(/\bmin\(/g, 'Math.min(').replace(/\bclamp\(/g, 'cl(');
  const block = src.slice(src.indexOf('  float x = prev.r, v = prev.g'), src.indexOf('  gl_FragColor = vec4(x, v, m, lock);'));
  const shaders = u => new Function('u', `const { ${Object.keys(u).join(', ')} } = u; const cl = (v, a, b) => Math.min(b, Math.max(a, v)), ex2 = x => 2 ** x, mix = (a, b, t) => a + (b - a) * t;
    ${['roomShare', 'apertureFor', 'cocOf', 'rooms', 'glowExcess'].map(n => toJS(fn(n))).join('\n')}
    return { roomShare, apertureFor, cocOf, rooms, glowExcess, step(prev, target, fresh) { ${toJS(block)} return { x, v, m, lock }; } };`)(u);
  const U = { uFocal: f, uFStop: LENS.fStop, uFStopRooms: LENS.fStopRooms, uSubjectNear: LENS.subjectNear, uSubjectFar: LENS.subjectFar, uSensor: L.SENSOR_HEIGHT_MM, uMaxCoc: LENS.maxCoc,
    uFallback: H, uThreshold: LENS.bloomThreshold, uIsolation: LENS.bloomIsolation, uGlareMax: LENS.glareMax, uDt: 1 / 60, uDirect: 0, uLockCoc: LENS.lockCoc, uLockTime: LENS.lockTime, uOmega: 4.744 / LENS.focusTime };
  const G = shaders(U);
  for (const [z, s] of [[5, 0.8], [2, 4], [0.4, 3], [80, 1.2], [3, 3], [1, 2.5], [0.3, 1.8]]) {
    close(G.cocOf(z, s), L.clampCoc(L.cocRadius(z, f, L.apertureFor(s), s)), 1e-12, `shader CoC at ${z} m, focus ${s} m`);
    close(G.apertureFor(s), L.apertureFor(s), 1e-9, `shader aperture at ${s} m`);
  }
  for (const d of [0.5, 1.2, 1.6, 2, 2.5, 3.3, 9, 40]) close(2 ** G.rooms(Math.log2(d)), L.focusFor(d, H), 1e-9, `shader focus policy at ${d} m`);
  for (const [l, a] of [[3, 0], [5, 0.2], [7, 0.5], [40, 1], [40, 30], [500, 2], [9, 4.4]]) close(G.glowExcess(l, a), L.glowExcess(l, a), 1e-12, `shader glow at ${l}, around ${a}`);

  // ---- the glow's source: lamps, fire and sun glints, never a daylight window -----------------------------------------------
  assert.ok(LENS.bloomThreshold >= 4, 'at least 2 EV above diffuse white'); assert.ok(LENS.bloom >= 0.02 && LENS.bloom <= 0.04, 'intensity 0.02-0.04');
  { const reach = 2 ** (LENS.bloomLevels + 1) / 1440; assert.ok(reach >= 0.005 && reach <= 0.02, `a glow about 1% of the height: ${reach}`); }
  assert.equal(L.glowExcess(1, 0), 0, 'white does not glow'); assert.equal(L.glowExcess(4, 0), 0, 'nor 2 EV above it');
  assert.ok(L.glowExcess(20, 0.3) > 10, 'a lamp in a dim room'); assert.equal(L.glowExcess(1e5, 0.3), LENS.glareMax, 'the sun: capped');
  for (const window of [8, 30, 300]) {
    assert.equal(L.glowExcess(window, window), 0, `inside a daylight window (${window}x white)`);
    assert.equal(L.glowExcess(window, window / 2), 0, `along its edge, half the ring inside (${window}x)`);
  }
  { let last = 0; for (let l = 3.9; l < 6; l += 0.01) { const e = L.glowExcess(l, 0); assert.ok(e >= last && e - last < 0.02, 'a soft knee: no step'); last = e; } }

  // ---- autofocus: the focus pull ------------------------------------------------------------------------------------------------
  // from 1 m (log2 0) to 8 m (log2 3): no overshoot, 95% at focusTime, the same at 30, 60 and 144 frames a second
  for (const hz of [30, 60, 144]) {
    let s = { x: 0, v: 0 }, last = 0, t = 0, at95 = null;
    for (let i = 0; i < 2 * hz; i++) {
      s = L.glideFocus(s, 3, 1 / hz); t += 1 / hz;
      assert.ok(s.x >= last - 1e-12 && s.x <= 3 + 1e-9, `${hz} Hz: monotonic, no overshoot`); last = s.x;
      if (at95 === null && s.x >= 0.95 * 3) at95 = t;
    }
    close(at95, LENS.focusTime, 1.5 / hz + 0.005, `${hz} Hz: 95% of the pull`);
    close(s.x, 3, 1e-3, `${hz} Hz: settled`);
  }
  const one = L.glideFocus({ x: 0, v: 0 }, 3, 0.3), split = L.glideFocus(L.glideFocus({ x: 0, v: 0 }, 3, 0.1), 3, 0.2);
  close(one.x, split.x, 1e-12, 'exact integration: one 0.3 s step equals 0.1 s then 0.2 s'); close(one.v, split.v, 1e-12, 'and the velocity');
  assert.ok(LENS.focusTime >= 0.3 && LENS.focusTime <= 0.6, 'a natural focus pull: 0.3-0.6 s');

  // ---- autofocus locks: it neither hunts across an edge nor breathes ------------------------------------------------------------
  {
    const dt = 1 / 60, lg = Math.log2, run = (state, targets, o) => { const out = []; for (const t of targets) { state = L.afStep(state, t, dt, f, o); out.push(state); } return out; };
    const room = lg(L.focusFor(4, H)), dog = lg(0.8), frames = (n, v) => Array.from({ length: n }, (_, i) => typeof v === 'function' ? v(i) : v);
    let s = L.afStep(null, room, dt, f); assert.deepEqual([s.x, s.lock, s.m], [room, room, 0], 'starts focused');
    // walking through a room: what the centre sees changes from 2.5 m to the garden, the focus does not
    let seq = run(s, frames(240, i => lg(L.focusFor(2.5 + 20 * Math.abs(Math.sin(i / 9)), H))));
    assert.ok(seq.every(q => q.lock === room && q.x === room), 'a room: locked');
    // something close crosses the centre for 3 frames (a pole, the cat walking past): no pull
    seq = run(s, [...frames(3, dog), ...frames(60, room)]); assert.ok(seq.every(q => q.lock === room), 'a passing edge: no hunt');
    // the dog sits in the centre: the focus goes to it once it has held there for about lockTime
    seq = run(s, frames(120, dog)); const moved = seq.findIndex(q => q.lock === dog);
    assert.ok(moved >= 0 && (moved + 1) * dt > 0.04 && (moved + 1) * dt < 0.15, `pulls to the dog after ${((moved + 1) * dt).toFixed(3)} s`);
    close(seq.at(-1).x, dog, 1e-3, 'focused on the dog exactly');
    // the camera breathes around the dog (3% in distance, every frame): the focus stays put
    s = seq.at(-1); seq = run(s, frames(240, i => dog + lg(1 + 0.03 * Math.sin(i * 1.7))));
    assert.ok(seq.every(q => q.lock === dog), 'no breathing');
    // walking up to a vase from 1.1 m to 0.6 m: the lock follows in steps, the vase stays within the depth of field
    s = L.afStep(null, lg(1.1), dt, f); seq = run(s, frames(120, i => lg(1.1 - 0.5 * i / 119)));
    const steps = new Set(seq.map(q => q.lock)).size, worst = Math.max(...seq.map((q, i) => Math.abs(L.cocRadius(1.1 - 0.5 * i / 119, f, L.apertureFor(2 ** q.lock), 2 ** q.lock)) * 2 * L.SENSOR_HEIGHT_MM));
    assert.ok(steps >= 3, `follows a moving subject: ${steps} steps`); assert.ok(worst < 2.5 * LENS.lockCoc, `within the depth of field: ${worst.toFixed(4)} mm`);
    // tracking (the film, after its one pull): every frame
    seq = run(L.afStep(null, room, dt, f), frames(5, dog), { lockCoc: 0 }); assert.ok(seq.every(q => q.lock === dog), 'tracking follows at once');
    // the GPU's frame is this one
    let a = null, b = null;
    const targets = [...frames(30, room), ...frames(3, dog), ...frames(40, room), ...frames(90, dog), ...frames(60, i => dog + lg(1 + 0.03 * Math.sin(i))), ...frames(60, room)];
    for (const t of targets) {
      a = L.afStep(a, t, dt, f);
      b = b ? G.step({ r: b.x, g: b.v, b: b.m, a: b.lock }, t, false) : G.step({ r: 0, g: 0, b: 0, a: 0 }, t, true);
      for (const key of ['x', 'v', 'm', 'lock']) close(b[key], a[key], 1e-9, `shader autofocus ${key}`);
    }
  }

  // ---- switches -------------------------------------------------------------------------------------------------------------------
  const { TIERS } = L;
  assert.equal(L.lensWanted('', TIERS.hq), true, 'on by default on hq');
  assert.equal(L.lensWanted('', TIERS.laptop), false); assert.equal(L.lensWanted('', TIERS.mobile), false);
  assert.equal(L.lensWanted('?lens=0', TIERS.hq), false); assert.equal(L.lensWanted('?lens=1', TIERS.laptop), true);
  assert.equal(L.lensWanted('?capture', TIERS.hq), false, 'never in the fixed-exposure capture mode (compared with Cycles)');
  assert.equal(L.lensWanted('?capture&lens=1', TIERS.hq), true, 'unless asked');
  assert.equal(L.lensWanted('', TIERS.hq, '0'), false, "the visitor's choice"); assert.equal(L.lensWanted('', TIERS.laptop, '1'), true);
  assert.equal(L.lensWanted('?lens=1', TIERS.hq, '0'), true, 'the query wins');
  assert.deepEqual(L.lensParts('?dof=0'), { dof: false, bloom: true, vignette: true, ca: true });
  assert.deepEqual(L.lensParts('?bloom=0&ca=0'), { dof: true, bloom: false, vignette: true, ca: false });
  // the rest of the lens nearly invisible (the film's camera language): vignetting 0-0.15 EV in the corners, chromatic aberration
  // at most 0.3 px in the corners at 1080p
  assert.ok(LENS.vignette >= 0 && LENS.vignette <= 0.15, 'vignetting'); assert.ok(LENS.ca * 1080 <= 0.3, 'chromatic aberration');

  // ---- lens shift: a level camera keeps verticals parallel and still frames a ceiling ------------------------------------------
  {
    const cam = new T.PerspectiveCamera(40, 16 / 9, 0.05, 300); cam.updateMatrixWorld(true);
    const level = cam.projectionMatrix.clone();
    L.setLensShift(cam, 0.1); close(cam.projectionMatrix.elements[9], 0.2, 1e-12, 'the off-axis projection: elements[9] = 2 x shift');
    // nothing else changes: three's setViewOffset sets the aspect from its full frame (a 1 x 1 frame squeezed the view square)
    close(cam.aspect, 16 / 9, 1e-12, 'the aspect kept');
    cam.projectionMatrix.elements.forEach((v, i) => { if (i !== 9) close(v, level.elements[i], 1e-12, `projection element ${i} kept`); });
    cam.aspect = 4 / 3; cam.fov = 50; cam.updateProjectionMatrix(); close(cam.projectionMatrix.elements[9], 0.2, 1e-12, 'kept through a resize and a new field of view');
    assert.deepEqual(L.lensShift(cam), { x: 0, y: 0.1 });
    const ndc = (c, x, y, z) => new T.Vector3(x, y, z).project(c);
    close(ndc(cam, 0, 0, -5).y, -0.2, 1e-9, 'the horizon sits 0.1 of the frame below its centre');
    const verticalAt = (c, x) => [ndc(c, x, -1, -5).x, ndc(c, x, 3, -5).x];
    { const [lo, hi] = verticalAt(cam, 1.5); close(lo, hi, 1e-9, 'level and shifted: a vertical stays vertical'); }
    const pitched = new T.PerspectiveCamera(50, 4 / 3, 0.05, 300); pitched.rotation.x = 0.2; pitched.updateMatrixWorld(true);
    { const [lo, hi] = verticalAt(pitched, 1.5); assert.ok(Math.abs(lo - hi) > 0.02, 'pitched instead: it leans'); }
    L.setLensShift(cam, 0); assert.equal(cam.view?.enabled ?? false, false); assert.equal(cam.projectionMatrix.elements[9], 0, 'no shift: on axis again');
    close(cam.aspect, 4 / 3, 1e-12, 'and the aspect is still the screen\'s');
    L.setLensShift(cam, 0, 0.05); close(cam.projectionMatrix.elements[8], 0.1, 1e-12, 'a horizontal shift too'); close(L.lensShift(cam).x, 0.05, 1e-12);
    cam.aspect = 16 / 9; cam.updateProjectionMatrix(); close(L.lensShift(cam).x, 0.05, 1e-12, 'kept as a fraction of the width through a resize');
    close(cam.projectionMatrix.elements[8], 0.1, 1e-12); L.setLensShift(cam, 0);
  }

  // ---- the pass on a stub renderer --------------------------------------------------------------------------------------------------
  const camera = new T.PerspectiveCamera(62, 16 / 9, 0.05, 300); camera.position.set(2, 1.6, -1); camera.updateMatrixWorld(true);
  const drawn = [];
  const stub = { autoClear: true, extensions: { has: () => true }, getRenderTarget: () => null, setRenderTarget(t) { this.target = t; }, render(mesh) { drawn.push([mesh.material.name || mesh.material.fragmentShader.slice(0, 40), this.target]); }, domElement: null };
  const pass = (name, extra = {}) => ({ name, enabled: true, needsSwap: true, setSize() {}, ...extra });
  const output = pass('output', { isOutputPass: true });
  const composer = { passes: [pass('taa'), output, pass('grade')], insertPass(p, i) { this.passes.splice(i, 0, p); } };
  const depthTexture = { isDepthTexture: true };
  const lighting = { composer, outputPass: output, taa: { resolve: { uniforms: { tDepth: { value: depthTexture } } } } };
  let aimed = null;
  const lens = L.createLens({ lighting, renderer: stub, camera, aim: () => aimed, parts: {} });
  assert.deepEqual(composer.passes.map(p => p.name ?? 'lens'), ['taa', 'lens', 'output', 'grade'], 'after TAA, before the output pass');
  assert.equal(lens.enabled, false, 'off until the tier or the visitor turns it on');
  lens.enabled = true;
  const read = { width: 256, height: 144, texture: {} }, write = { width: 256, height: 144, texture: {} };
  const frame = () => { L.advanceFrameClock(1 / 60); drawn.length = 0; lens.render(stub, write, read); return lens.af.uniforms; };
  let u = frame();
  assert.equal(u.uSnap.value, 1, 'the first frame snaps the focus'); assert.equal(u.tDepth.value, depthTexture, "TAA's depth");
  assert.equal(drawn.at(-1)[1], write, 'the composite into the write buffer');
  assert.equal(drawn.length, 1 + 1 + 2 + 2 * (LENS.bloomLevels - 1) + 1, 'focus, prefilter, gather + tent, the bloom chain, composite');
  u = frame(); assert.equal(u.uSnap.value, 0, 'then it pulls');
  close(u.uFallback.value, L.hyperfocal(f, LENS.fStopRooms), 1e-9, 'sky: the hyperfocal distance at the room aperture');
  camera.position.x += 2; u = frame(); assert.equal(u.uSnap.value, 1, 'a 2 m jump (a teleport, a cut) snaps');
  camera.rotation.y += 1.0; camera.updateMatrixWorld(true); u = frame(); assert.equal(u.uSnap.value, 1, 'so does a 57 degree turn in a frame');
  u = frame(); assert.equal(u.uOverride.value, -1, 'nothing aimed at: the centre area');
  aimed = { distance: 0.8 }; u = frame(); assert.equal(u.uOverride.value, 0.8, 'aimed at a pet: focus on it');
  assert.match(src, /if \(uOverride > 0\.0\) target = uDirect > 0\.5 \? log2\(uOverride\) : rooms\(log2\(uOverride\)\);/, 'what is aimed at goes through the policy; a set focus does not');
  lens.enabled = false; lens.enabled = true; u = frame(); assert.equal(u.uSnap.value, 1, 'switched back on: focus afresh');
  lens.parts.dof = false; frame();
  assert.equal(drawn.length, 1 + 2 * (LENS.bloomLevels - 1) + 1, 'no depth of field: prefilter (bloom), the chain, composite');
  assert.equal(lens.out.uniforms.uDof.value, 0);
  lens.parts.dof = true; lighting.taa = null; frame();
  assert.equal(lens.out.uniforms.uDof.value, 0, 'no depth to read: no depth of field');
  lighting.taa = { resolve: { uniforms: { tDepth: { value: depthTexture } } } };
  // the film's control: a set aperture and focus (exactly, each frame), a held focus, tracking
  lens.control = { fStop: 2.8, focus: 1.2 }; u = frame();
  assert.deepEqual([u.uDirect.value, u.uOverride.value, u.uFStop.value, u.uFStopRooms.value], [1, 1.2, 2.8, 2.8], 'a set focus and aperture');
  assert.equal(lens.out.uniforms.uFStop.value, 2.8, 'the composite at the same aperture');
  lens.control = { hold: true }; u = frame(); assert.deepEqual([u.uHold.value, u.uDirect.value, u.uFStop.value], [1, 0, LENS.fStop], 'held');
  lens.control = { track: true, time: 1.2 }; u = frame(); assert.equal(u.uLockCoc.value, 0, 'tracking: no lock'); close(u.uOmega.value, 4.744 / 1.2, 1e-12, 'its pull time');
  lens.control = null; u = frame(); assert.deepEqual([u.uHold.value, u.uDirect.value, u.uLockCoc.value], [0, 0, LENS.lockCoc], 'back to the walkthrough');
  // exposure compensation (the film's low-key dusk): the composite and the glow's threshold both see it
  assert.equal(lens.out.uniforms.uGain.value, 1, 'none by default');
  lens.settings.exposure = -1.5; frame(); close(lens.out.uniforms.uGain.value, 2 ** -1.5, 1e-12); close(lens.pre.uniforms.uGain.value, 2 ** -1.5, 1e-12);
  lens.settings.exposure = 0;
  // a shifted lens moves the optical axis (vignetting's centre) with the frame
  L.setLensShift(camera, 0.08); frame(); close(lens.out.uniforms.uAxis.value.y, 0.42, 1e-12, 'the axis follows the shift'); L.setLensShift(camera, 0);
  frame(); close(lens.out.uniforms.uAxis.value.y, 0.5, 1e-12);
  lens.dispose();
} finally { await rm(dir, { recursive: true, force: true }); }
console.log('lens ok');
