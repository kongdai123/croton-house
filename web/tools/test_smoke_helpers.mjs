// The browser-free parts of the UI smoke suite (tools/smoke): argument parsing, console classification, pixel statistics,
// stance geometry for switches and sliders, the static server, and that every test is well formed. The browser run itself is
// `node tools/smoke/run.mjs` (CI job "smoke").
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, classifyConsole, parseColor, sampleStats, isBlank, switchStance, forwardOf, sliderRun, sliderSide } from './smoke/helpers.mjs';
import { startServer, resolvePath } from './smoke/server.mjs';
import { TESTS, installInPage } from './smoke/tests.mjs';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

// ---- args
assert.deepEqual(parseArgs([]).only, []);
{
  const o = parseArgs(['--headed', '--url=http://x:1/', '--only=load,tour', '--out', 'o', '--timeout=9', '--gpu', '--no-build']);
  assert.equal(o.headed, true); assert.equal(o.url, 'http://x:1'); assert.deepEqual(o.only, ['load', 'tour']); assert.equal(o.out, 'o');
  assert.equal(o.timeoutS, 9); assert.equal(o.gpu, true); assert.equal(o.build, false);
  assert.equal(parseArgs(['--url', 'http://y']).url, 'http://y');
}
assert.throws(() => parseArgs(['--nope']), /unknown argument/);
assert.throws(() => parseArgs(['--url']), /needs a value/);
assert.throws(() => parseArgs(['--timeout=0']), /positive/);

// ---- console classification
assert.equal(classifyConsole({ type: 'warning', text: 'baked shader foo: left unpatched bar' }), 'patch');
assert.equal(classifyConsole({ type: 'error', text: 'Baked shader patch failed: x' }), 'patch');
assert.equal(classifyConsole({ type: 'log', text: 'hello' }), 'ignore');
assert.equal(classifyConsole({ type: 'warning', text: 'something' }), 'ignore');
assert.equal(classifyConsole({ type: 'error', text: 'Uncaught TypeError' }), 'error');
assert.equal(classifyConsole({ type: 'error', text: 'Failed to load resource: the server responded with a status of 404 (Not Found)', url: 'http://h/assets/photos/a.jpg' }), 'ignore');
assert.equal(classifyConsole({ type: 'error', text: 'Failed to load resource: the server responded with a status of 404 (Not Found)', url: 'http://h/data/plan.json' }), 'error');
assert.equal(classifyConsole({ type: 'error', text: 'GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels' }), 'ignore');

// ---- pixels
assert.deepEqual(parseColor('rgb(13, 12, 11)'), [13, 12, 11]);
assert.deepEqual(parseColor('rgba(13, 12, 11, 1)'), [13, 12, 11]);
assert.deepEqual(parseColor('#0d0c0b'), [13, 12, 11]);
assert.throws(() => parseColor('red'), /cannot parse/);
{
  const blank = new Array(8 * 8 * 4).fill(0), scene = Array.from({ length: 64 }, () => [120, 110, 100, 255]).flat(), dark = Array.from({ length: 64 }, () => [12, 12, 11, 255]).flat();
  assert.equal(isBlank(sampleStats(blank), 12), true);
  assert.equal(isBlank(sampleStats(dark), 12), true);      // opaque but only as bright as the page background
  assert.equal(isBlank(sampleStats(scene), 12), false);
  near(sampleStats(scene).mean, 110); near(sampleStats(scene).alpha, 255);
}

// ---- geometry: standing in front of a plate looks at it
for (const ry of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7]) {
  const plate = { x: 3, y: 1.12, z: -4, ry }, s = switchStance(plate), f = forwardOf(s.yaw);
  near(Math.hypot(s.x - plate.x, s.z - plate.z), 0.7);
  // the view direction points from the stance to the plate
  near(f.x, (plate.x - s.x) / 0.7); near(f.z, (plate.z - s.z) / 0.7);
  assert.ok(s.pitch < 0 && s.pitch > -1, 'looks down at a plate below eye height');
}
for (const isH of [true, false]) for (const side of [-1, 1]) {
  const d = { cx: 2, cy: 5, isH, w: 0.9 }, run = sliderRun(d, side), f = forwardOf(run.yaw);
  near(Math.abs(run.axis === 'z' ? run.start.z - run.plane : run.start.x - run.plane), 0.6);
  near(sliderSide(run, run.start), 0.6);
  // walking forward moves toward the wall plane
  const step = { x: run.start.x + f.x * 0.1, z: run.start.z + f.z * 0.1 };
  assert.ok(sliderSide(run, step) < sliderSide(run, run.start), `slider isH=${isH} side=${side} walks toward the wall`);
  if (isH) near(run.start.x, d.cx + d.w / 2); else near(run.start.z, -(d.cy + d.w / 2));
}

// ---- static server
const root = mkdtempSync(join(tmpdir(), 'smoke-srv-'));
try {
  mkdirSync(join(root, 'dist')); mkdirSync(join(root, 'dir'));
  writeFileSync(join(root, 'index.html'), '<!doctype html>ok'); writeFileSync(join(root, 'dist/app.js'), 'x=1'); writeFileSync(join(root, 'dir/index.html'), 'dir');
  writeFileSync(join(root, 'a b.json'), '{}'); writeFileSync(join(root, '..', 'smoke-outside.txt'), 'secret');
  assert.equal(resolvePath(root, '/../smoke-outside.txt'), null);
  assert.equal(resolvePath(root, '/%2e%2e/smoke-outside.txt'), null);
  assert.equal(resolvePath(root, '/%zz'), null);
  assert.equal(resolvePath(root, '/dist/app.js?x=1'), join(root, 'dist/app.js'));
  const s = await startServer({ root });
  try {
    const get = (p, init) => fetch(s.url + p, init);
    let r = await get('/index.html?tier=mobile'); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/html/); assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal(await r.text(), '<!doctype html>ok');
    r = await get('/'); assert.equal(r.status, 200); assert.equal(await r.text(), '<!doctype html>ok');
    r = await get('/dir'); assert.equal(await r.text(), 'dir');
    r = await get('/dist/app.js'); assert.match(r.headers.get('content-type'), /javascript/);
    r = await get('/a%20b.json'); assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'application/json');
    r = await get('/nope.js'); assert.equal(r.status, 404);
    r = await get('/..%2fsmoke-outside.txt'); assert.ok([403, 404].includes(r.status)); assert.notEqual(await r.text(), 'secret');
    r = await get('/index.html', { method: 'HEAD' }); assert.equal(r.status, 200); assert.equal(await r.text(), '');
    r = await get('/index.html', { method: 'POST' }); assert.equal(r.status, 405);
    // many parallel requests (the page opens ~70 at once)
    const rs = await Promise.all(Array.from({ length: 120 }, () => get('/dist/app.js'))); assert.ok(rs.every(x => x.status === 200));
  } finally { await s.close(); }
} finally { rmSync(root, { recursive: true, force: true }); rmSync(join(root, '..', 'smoke-outside.txt'), { force: true }); }

// ---- the tests themselves are well formed
assert.deepEqual(TESTS.map(t => t.name), ['load', 'tour', 'switches', 'doors', 'quality-and-slots', 'resize', 'keyboard', 'legacy']);
for (const t of TESTS) assert.ok(typeof t.run === 'function' && (t.timeoutS === undefined || t.timeoutS > 0), t.name);
assert.equal(typeof installInPage, 'function');
console.log('smoke helpers OK');
