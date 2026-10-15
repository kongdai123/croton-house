// Browser-free progress, delayed overlay and switch fixtures. All fetches/timers are local stubs.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const source = async name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
const moduleFrom = code => import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const { createSlotProgress } = await moduleFrom(await source('slot_progress.js'));
const { lightmapBitmap } = await moduleFrom(await source('lightmap_assets.js'));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(setImmediate);
const events = [], progress = createSlotProgress((p, d) => events.push({ p, ...d }));
const body = deferred();
globalThis.fetch = async url => ({ ok: true, blob: async () => { await body.promise; return url; } });
globalThis.createImageBitmap = async () => ({ width: 2, height: 1, close() {} });
const parts = lightmapBitmap(['top', 'bottom'], [1, 1], work => progress.track(work));
await tick(); assert.equal(events.at(-1).loaded, 0); assert.equal(events.at(-1).total, 2);
body.resolve(); await parts;
assert.equal(events.at(-1).loaded, 2); assert.ok(events.at(-1).p < 1);
await assert.rejects(progress.track(() => Promise.reject(Error('offline'))), /offline/);
assert.equal(events.at(-1).loaded, 3); // settled requests include failed fallback attempts
progress.finish(); assert.deepEqual(events.at(-1), { p: 1, loaded: 3, total: 3, phase: 'staged' });

const dir = await mkdtemp(join(tmpdir(), 'croton-slot-progress-'));
try {
  const internals = { name: 'progress-fixture', setup(b) {
    b.onLoad({ filter: /\/pets\/roam\.js$/ }, () => ({ contents: 'export const groundY = () => 0;' }));
    b.onLoad({ filter: /\/lightmap\.js$/ }, async ({ path }) => ({ contents: await readFile(path, 'utf8') + '\nexport { loadProbes, loadReflections };' }));
  } };
  const built = await build({ stdin: { contents: "export { loadProbes, loadReflections } from './src/lightmap.js'; export { loadFoliage } from './src/foliage_bake.js'; export { createSlotRuntime } from './src/lightmap_slots.js'; export { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'; export * as T from 'three';", resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, plugins: [internals], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
  const file = join(dir, 'fixture.mjs'); await writeFile(file, built.outputFiles[0].contents);
  globalThis.location = { search: '' };
  const { loadProbes, loadReflections, loadFoliage, createSlotRuntime, HDRLoader, T } = await import(pathToFileURL(file));
  const counts = [], real = createSlotProgress((p, d) => counts.push({ p, ...d })), track = work => real.track(work);
  const hdrGate = deferred(); let hdrRequests = 0;
  HDRLoader.prototype.loadAsync = async () => { hdrRequests++; await hdrGate.promise; return new T.DataTexture(new Uint16Array(8), 2, 1); };
  globalThis.fetch = async () => ({ ok: true, json: async () => Array.from({ length: 27 }, (_, i) => ({ i, p: [0, 0, 0], min: [-1, -1, -1], max: [1, 1, 1] })) });
  const reflPromise = loadReflections('fixture', u => u, track);
  await tick(); assert.equal(hdrRequests, 27); assert.equal(counts.at(-1).total, 28); assert.equal(counts.at(-1).loaded, 1);
  hdrGate.resolve(); const refl = await reflPromise;
  assert.equal(counts.at(-1).loaded, 28); refl.uniforms.uReflTex.value.dispose();
  // These readers count the completed body, even if later sidecar validation fails.
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
  await assert.rejects(loadProbes('fixture', track)); await assert.rejects(loadFoliage('fixture', track));
  assert.equal(counts.at(-1).total, 30); assert.equal(counts.at(-1).loaded, 30);

  const data = name => ({ name, resolution: 'half', enc: { K: { slot: 1, lamps: 1 } }, layers: [new T.Texture(), new T.Texture()], sky: new T.Texture({ width: 2, height: 1 }),
    volume: { uniforms: { uProbeSH: { value: new T.Texture() } } },
    refl: { count: 1, uniforms: Object.fromEntries(['uReflTex', 'uReflPos', 'uReflMin', 'uReflMax', 'uReflMips'].map(k => [k, { value: k === 'uReflTex' ? new T.Texture() : k === 'uReflMips' ? 1 : new Float32Array(3) }])) } });
  let loads = 0;
  const runtime = createSlotRuntime({ scene: new T.Scene(), renderer: {}, initial: data('sunrise'), available: ['sunrise', 'noon'], disposeAtlas: t => t.dispose(), setParams() {}, commit() {},
    async load(name, res, onProgress) { loads++; onProgress(0.5, { loaded: 1, total: 2, phase: 'loading' }); return data(name); } });
  const signals = [], switched = runtime.request('noon', (p, d) => signals.push({ p, ...d }));
  await tick(); assert.deepEqual(signals.map(s => s.phase), ['loading', 'transition']); assert.equal(signals[0].name, 'noon');
  assert.equal(runtime.name, 'sunrise'); // transition signal precedes commit by the full crossfade
  runtime.update(1.5); await switched;
  const cached = [], back = runtime.request('sunrise', (p, d) => cached.push(d.phase));
  await tick(); assert.deepEqual(cached, ['transition']); assert.equal(loads, 1);
  runtime.update(1.5); await back; runtime.dispose();
} finally { await rm(dir, { recursive: true, force: true }); }

// Exercise the same overlay methods startup calls, without constructing the rest of the HUD.
globalThis.localStorage = { getItem() { return 'en'; }, setItem() {} };
const { UI, setLang } = await moduleFrom(await source('ui.js'));
const element = () => {
  const classes = new Set();
  return { dataset: {}, style: {}, textContent: '', classList: { add: (...s) => s.forEach(x => classes.add(x)), remove: (...s) => s.forEach(x => classes.delete(x)), contains: s => classes.has(s), toggle(s, on) { if (on) classes.add(s); else classes.delete(s); } } };
};
const screen = element(), title = element(), sub = element(), bar = element(), count = element();
screen.classList.add('hidden'); screen.querySelector = q => q === '.wm-title' ? title : sub;
globalThis.document = { documentElement: {}, querySelector: () => title, querySelectorAll: () => [], getElementById: id => ({ warming: screen, warmbar: bar, warmcount: count })[id] };
globalThis.dispatchEvent = () => {};
const ui = Object.create(UI.prototype); ui.state = { ready: true }; ui.firstStepsShown = true;
const timers = new Map(), nativeSet = globalThis.setTimeout, nativeClear = globalThis.clearTimeout;
let timerId = 0;
globalThis.setTimeout = (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; };
globalThis.clearTimeout = id => timers.delete(id);
const advance = delay => { for (const [id, t] of [...timers]) if (t.delay === delay) { timers.delete(id); t.fn(); } };
try {
  const cached = ui.slotLoading('noon'); cached.progress(1, { phase: 'transition' }); advance(250);
  assert.ok(screen.classList.contains('hidden')); assert.equal(timers.size, 0);
  const slow = ui.slotLoading('noon'); slow.progress(0.5, { loaded: 12, total: 24 }); advance(250);
  assert.equal(title.textContent, 'Loading Noon lighting'); assert.equal(bar.style.width, '50%'); assert.equal(count.textContent, '12 / 24');
  assert.ok(!screen.classList.contains('hidden')); assert.ok(sub.classList.contains('hidden'));
  setLang('zh'); ui.loadingMessage(); assert.equal(title.textContent, '正在加载正午光照');
  slow.progress(1, { phase: 'transition' }); assert.ok(screen.classList.contains('done'));
  // A new show cancels the previous fade's hide timer.
  const next = ui.slotLoading('dusk'); advance(250); advance(450);
  assert.ok(!screen.classList.contains('hidden')); next.hide(); advance(450); assert.ok(screen.classList.contains('hidden'));
  const earlyFailure = ui.slotLoading('noon'); earlyFailure.hide(); advance(250); assert.ok(screen.classList.contains('hidden'));
  assert.deepEqual(ui.state, { ready: true }); assert.equal(ui.firstStepsShown, true);
  ui.showLoading(); assert.equal(title.dataset.i18n, 'warming'); assert.ok(!sub.classList.contains('hidden')); ui.hideLoading(); advance(450);
} finally { globalThis.setTimeout = nativeSet; globalThis.clearTimeout = nativeClear; }
console.log('slot progress: split requests, completed bodies, 27 HDRs, sidecars, runtime/cached transition signals, delayed shared overlay, localization and fade cleanup OK');
