// The frame clock (frame_clock.js) and the class it closes: time in the render path comes from the frame clock, never the
// wall clock (docs/audit/postmortem.md rows 28-29).
// - advanceFrameClock / staleSince: renderAt stepping at any rate keeps a history; one long gap or frames a consumer did
//   not draw drop it;
// - the volumetric light's history weight (volumetric_slots.js historyWeight) is a time constant: a change of the medium
//   settles in the same time at 30, 60 and 144 frames a second, and a slot crossfade is followed at the moving rate;
// - the pass itself (VolumetricPass on a stub renderer) takes that weight and its staleness from the frame clock;
// - every wall-clock read left in src/ is listed below with its reason: a new one fails here until it is reviewed.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const web = fileURLToPath(new URL('../', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'croton-frame-clock-'));
try {
  const built = await build({ stdin: { contents: `
    export * from './src/frame_clock.js'; export { historyWeight, MEDIA } from './src/volumetric_slots.js';
    export { VolumetricPass, VOLUME } from './src/volumetric.js'; export * as THREE from 'three';
  `, resolveDir: web }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
  const file = join(dir, 'fixture.mjs'); await writeFile(file, built.outputFiles[0].contents);
  const F = await import(pathToFileURL(file)), { frameClock, advanceFrameClock, staleSince, STALE_AFTER, historyWeight, VOLUME, THREE: T } = F;
  const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

  // ---- the clock: renderAt / ?simdt steps at any rate never go stale; one long gap or skipped frames do ---------------------
  for (const hz of [30, 60, 144]) {
    const c = { t: 0, dt: 0, gap: 0, frame: 0 }; let last = null;
    for (let i = 0; i < 2 * hz; i++) {
      advanceFrameClock(1 / hz, 1 / hz, c);
      if (i > 0) assert.equal(staleSince(last, c), false, `${hz} Hz frame ${i}`);
      last = c.t;
    }
    close(c.t, 2, 1e-9, `${hz} Hz: two seconds`);
  }
  const c = { t: 0, dt: 0, gap: 0, frame: 0 };
  advanceFrameClock(1 / 60, 1 / 60, c); assert.equal(staleSince(null, c), true, 'never drawn: stale');
  let last = c.t; advanceFrameClock(0.1, 0.5, c);   // a real 0.5 s hitch: dt clamped to 0.1, the gap kept
  assert.equal(c.dt, 0.1); assert.equal(staleSince(last, c), true, 'a long gap drops the history');
  last = c.t; for (let i = 0; i < 15; i++) advanceFrameClock(1 / 60, 1 / 60, c);   // 0.25 s of frames this consumer skipped
  assert.equal(staleSince(last, c), true, 'frames the consumer did not draw (an opaque panorama) drop it');
  last = c.t; advanceFrameClock(0, 0, c); assert.equal(staleSince(last, c), false, 'a repaint (dt 0) keeps it');
  assert.equal(STALE_AFTER, 0.2);

  // ---- the volumetric history's weight: a time constant, the same response at any frame rate ------------------------------
  const P = { historyTime: VOLUME.historyTime, historyStillTime: VOLUME.historyStillTime };
  close(historyWeight({ dt: 1 / 60 }, P), 0.9, 0.002, 'moving at 60 Hz: the 0.9 a frame it replaces');
  close(historyWeight({ dt: 1 / 60, still: true, stillTime: 10 }, P), 0.96, 0.002, 'held still at 60 Hz: the 0.96 it replaces');
  assert.equal(historyWeight({ valid: false, dt: 1 / 60 }, P), 0, 'no history: this frame alone');
  // held still through a slot crossfade: the medium changes every frame, so the moving rate
  assert.equal(historyWeight({ dt: 1 / 60, still: true, stillTime: 10, changing: true }, P), historyWeight({ dt: 1 / 60 }, P));
  // the still ramp averages the frames since the camera stopped evenly (n / (n + 1)) once that passes the moving rate, up
  // to the still rate
  close(historyWeight({ dt: 1 / 60, still: true, stillTime: 3 / 60 }, P), historyWeight({ dt: 1 / 60 }, P), 1e-12, 'three frames held: the moving rate');
  close(historyWeight({ dt: 1 / 60, still: true, stillTime: 20 / 60 }, P), 20 / 21, 1e-9, 'twenty frames held: 20 / 21');
  // what is left of an old value after one second (a slot change's old mist): the same at 30, 60 and 144 Hz
  const residual = (hz, w) => { let r = 1; for (let i = 0; i < hz; i++) r *= w(1 / hz); return r; };
  for (const [name, w, tau] of [
    ['moving', dt => historyWeight({ dt }, P), P.historyTime],
    ['held still', dt => historyWeight({ dt, still: true, stillTime: 10 }, P), P.historyStillTime],
    ['held still in a crossfade', dt => historyWeight({ dt, still: true, stillTime: 10, changing: true }, P), P.historyTime],
  ]) {
    const r = [30, 60, 144].map(hz => residual(hz, w));
    for (const x of r) close(x, Math.exp(-1 / tau), 1e-9, `${name}: residual after 1 s`);
  }
  // the old per-frame weights would not pass: 0.96 a frame leaves 29% after a second at 30 Hz and 0.3% at 144
  assert.ok(Math.abs(0.96 ** 30 - 0.96 ** 144) > 0.25);

  // ---- the pass on a stub renderer: weight and staleness from the frame clock -------------------------------------------------
  const shadow = { uniforms: { uSunDepth: { value: null }, uSunTexel: { value: 1 / 4096 } }, matrix: new T.Matrix4(), version: 0 };
  const sun = new T.DirectionalLight(0xffffff, 20); sun.position.set(30, 10, -20);
  const camera = new T.PerspectiveCamera(62, 16 / 9, 0.05, 300); camera.position.set(2, 1.5, -14); camera.updateMatrixWorld(true);
  let state = { current: 'golden' };
  const vol = new F.VolumetricPass({ camera, sun, shadow, state: () => state });
  const stub = { autoClear: true, setRenderTarget() {}, render() {}, initRenderTarget() {}, getRenderTarget: () => null };
  const read = { width: 64, height: 36, texture: {}, depthTexture: {} }, write = { width: 64, height: 36, texture: {}, depthTexture: {} };
  const draw = () => { vol.render(stub, write, read); return vol.march.uniforms.uHistory.value; };
  const run = (hz, seconds) => { const ws = []; for (let i = 0; i < Math.round(seconds * hz); i++) { advanceFrameClock(1 / hz, 1 / hz); ws.push(draw()); } return ws; };
  for (const hz of [30, 144]) {
    vol.reset(); const ws = run(hz, 2);
    assert.equal(ws[0], 0, `${hz} Hz: the first frame starts the history`);
    close(ws.at(-1), Math.exp(-1 / hz / VOLUME.historyStillTime), 1e-9, `${hz} Hz: held still, the still rate`);
    state = { current: 'golden', next: 'dusk', t: 0.5 };   // a crossfade: followed at the moving rate, held still or not
    close(run(hz, 0.2).at(-1), Math.exp(-1 / hz / VOLUME.historyTime), 1e-9, `${hz} Hz: during a crossfade`);
    state = { current: 'dusk' };
    const after = run(hz, 0.05);
    assert.ok(after[0] < Math.exp(-1 / hz / VOLUME.historyTime) + 1e-9, `${hz} Hz: the still ramp restarts after the fade`);
  }
  advanceFrameClock(0.1, 0.6); assert.equal(draw(), 0, 'a 0.6 s hitch drops the history');
  run(60, 0.1); advanceFrameClock(1 / 60, 1 / 60); advanceFrameClock(0.1); advanceFrameClock(0.1);   // 0.2 s the pass did not draw
  assert.equal(draw(), 0, 'frames the pass skipped drop the history');
  assert.ok(frameClock.frame > 0);
  vol.dispose();
} finally { await rm(dir, { recursive: true, force: true }); }

// ---- the class: wall-clock reads in src/, each with its reason ----------------------------------------------------------------
// Everything that draws, animates or integrates over frames takes time from the frame clock. What is left measures how long
// something took (stats, loading laps), paces real time on purpose (the frame-rate governor, the loading screen's yields,
// a click's press time, photo mode's sample budget), or runs outside the walkthrough's frame loop (the WebGPU preview).
const WALL_CLOCK = {
  'batch_baked.js': [2, 'batching time (stats.ms)'],
  'contact.js': [6, 'contact-shadow CPU time (stats.cpuMs)'],
  'daylight.js': [4, 'daylight bake and collect time'],
  'foliage_bake.js': [2, 'foliage staging time (stats.ms)'],
  'hq.js': [2, 'mirror preparation time'],
  'interact.js': [2, 'a click on a toggle: press time against a drag (real input time)'],
  'lamp_groups.js': [2, 'lamp-group mip build time'],
  'lightmap.js': [7, 'load, patch and static-shadow refresh times (stats)'],
  'main.js': [15, 'resize throttle, warm-up laps, load and enter times, the quiet-moment gate for background loading, frame cost for the start-quality probe'],
  'pets/roam.js': [1, 'pet planning and update time (stats)'],
  'photo.js': [40, 'photo mode: preparation stats, yields, deadlines and the sample budget of a path-traced still'],
  'photo_ui.js': [4, "photo mode's elapsed-time display"],
  'plant_clusters.js': [2, 'cluster build time (stats.ms)'],
  'puddles.js': [3, 'visibility scan time (stats.visibilityMs); the ripples and throttles run on the frame clock'],
  'rest_clusters.js': [2, 'cluster build time (stats.ms)'],
  'shader_warmup.js': [2, 'yields to the browser every 8 ms of shader warm-up'],
  'start_quality.js': [1, "the start probe's default clock (frame cost in real time)"],
  'stats.js': [4, 'stats for nerds: real frame and CPU time'],
  'visibility.js': [2, 'room culling build time (stats.ms)'],
  'webgpu/start.js': [5, "the WebGPU preview's own animation loop and diagnostics (not the walkthrough's renderAt path)"],
  'white_balance.js': [2, 'white-balance CPU time (ms)'],
};
const src = join(web, 'src'), found = {};
const walk = async d => { for (const e of await readdir(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) await walk(p); else if (e.name.endsWith('.js')) { const n = ((await readFile(p, 'utf8')).match(/performance\.now\(|Date\.now\(/g) ?? []).length; if (n) found[relative(src, p).split('\\').join('/')] = n; } } };
await walk(src);
const problems = [];
for (const [f, n] of Object.entries(found)) if (!WALL_CLOCK[f] || WALL_CLOCK[f][0] !== n) problems.push(`${f}: ${n} wall-clock read(s), listed ${WALL_CLOCK[f]?.[0] ?? 0}`);
for (const [f, [n]] of Object.entries(WALL_CLOCK)) if (!found[f]) problems.push(`${f}: listed ${n}, found none (drop it from the list)`);
assert.deepEqual(problems, [], 'Time in the render path comes from the frame clock (src/frame_clock.js). A wall-clock read that only measures or ' +
  'paces real time on purpose goes in WALL_CLOCK in tools/test_frame_clock.mjs with its reason:\n  ' + problems.join('\n  '));
// the consumers fixed for row 29 read the frame clock
for (const f of ['taa.js', 'puddles.js', 'volumetric.js', 'minimap.js']) assert.match(await readFile(join(src, f), 'utf8'), /from '\.\/frame_clock\.js'/, `${f} reads the frame clock`);
const main = await readFile(join(src, 'main.js'), 'utf8');
assert.match(main, /advanceFrameClock\(dt, gap\)/, 'main.js advances the frame clock once per frame');
assert.match(main, /composer\.render\(dt\)/, "the composer gets the frame's dt (its own clock is the wall clock)");
assert.match(main, /window\.renderAt = [^\n]*frame\(dt \|\| 1 \/ 60, step\)/, 'renderAt hands the whole step to the frame as its gap');
console.log('frame clock ok');
