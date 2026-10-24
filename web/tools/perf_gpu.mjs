// Frame profile of the walkthrough on a GPU node: CPU per frame (JS update vs render submission, per pass), GPU per pass
// (EXT_disjoint_timer_query_webgl2), draw calls, triangles and sun-shadow redraws, at fixed cameras and along a scripted
// walk, with the page's own uncapped loop running (?fps=0) as a visitor's would. Several builds or queries (variants) run
// in one job, one after the other, so before/after numbers come from the same node. Refuses a software rasteriser: run
// it in a scavenger GPU job (bake/validate/RENDER_GATE.md), never on a laptop.
//   node perf_gpu.mjs --site <dir> --out <file.json> [--variants 'name=<dist dir>?<query>,...'] [--query 'tier=hq&lmres=full']
//        [--size 2560x1440] [--cameras cameras.json] [--only id,id] [--dwell 4] [--settle 1.2] [--walk] [--profile] [--mix]
//   A variant serves <dist dir> (absolute, or relative to --site) as the site's dist/ and adds its query to --query, e.g.
//   --variants 'before=/x/dist_before,after=dist,after_nocull=dist?cull=0'. Default: one variant, the site's own dist/.
// Labels: update (JS outside any render), pass:<Pass> (composer passes, exclusive of what they nest), sunDepth (the PCSS
// caster depth), shadowMap (three's shadow map), render:<scene>/<camera> (other renders: mirrors, puddles, contact),
// composer (the composer's own copies), and the wrapped per-frame updates (lightingUpdate, bakedUpdate, pets, ...).
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile, writeFile, stat } from 'fs/promises';
import { extname, join, resolve, isAbsolute } from 'path';

const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const SITE = resolve(opt('--site', process.env.CROTON_SITE || new URL('..', import.meta.url).pathname));
const OUT = opt('--out', 'perf.json');
const BASEQ = opt('--query', 'tier=hq&lmres=full');
const [W, H] = opt('--size', '2560x1440').split('x').map(Number);
const DWELL = +opt('--dwell', 4), SETTLE = +opt('--settle', 1.2);
const variants = (opt('--variants', 'site=dist')).split(',').map(s => {
  const i = s.indexOf('='), name = s.slice(0, i), rest = s.slice(i + 1), j = rest.indexOf('?');
  const dist = j < 0 ? rest : rest.slice(0, j), query = j < 0 ? '' : rest.slice(j + 1);
  return { name, dist: isAbsolute(dist) ? dist : join(SITE, dist), query };
});
const DEFAULT_CAMS = ['living_1', 'living_2', 'kitchen_1', 'dining_1', 'primaryBedroom_1', 'bathB_1', 'patio_1', 'frontYard_1', 'backGarden_1', 'garage_1'];
const camFile = opt('--cameras', new URL('../../bake/validate/cameras.json', import.meta.url).pathname);
const only = (opt('--only') ?? DEFAULT_CAMS.join(',')).split(',');
const cams = JSON.parse(await readFile(camFile, 'utf8')).cameras.filter(c => only.includes(c.id)).sort((a, b) => only.indexOf(a.id) - only.indexOf(b.id));

// A walk through the house in plan metres (x east, y north): front walk, living, kitchen, office, dining, the patio, back
// in, the hall, both bedrooms on the east side, then across to the primary bedroom. Doorways at their centres.
const WALK = [[0, -9], [-0.06, -5.4], [-0.06, -4.66], [0, -3], [-2.3, -2], [-2.3, 0.5], [0, 0.5], [0.77, 1.76], [0, 3.6], [2.5, 3.6], [2.8, 5.41],
  [2.6, 7.6], [-0.8, 8.2], [-0.2, 5.41], [-0.2, 3.4], [1.2, 0.3], [3.97, 0.32], [4.55, 0.3], [4.53, 1.51], [5.6, 3.6], [4.53, 1.51], [4.55, -1],
  [4.5, -2.09], [5.2, -4], [4.5, -2.09], [4.55, 0], [2, -1], [-1.8, 1.19], [-3.45, 1.19], [-4.8, 3.2]];

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
// /v/<variant>/dist/... from the variant's dist folder, everything else of /v/<variant>/ from the site
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    const m = p.match(/^\/v\/([^/]+)\/(.*)$/), v = m && variants.find(x => x.name === m[1]);
    if (!v) throw new Error('no variant');
    p = m[2] || 'index.html';
    if (p.includes('..')) throw new Error('bad path');
    const file = p.startsWith('dist/') ? join(v.dist, p.slice(5)) : join(SITE, p);
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;
// --vsync: the browser's own 60 Hz frame clock and the page's own pacing (no ?fps=0): what the frame governor does
const VSYNC = argv.includes('--vsync');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-vulkan-surface',
  ...(VSYNC ? [] : ['--disable-gpu-vsync', '--disable-frame-rate-limit'])] });

// ---- in the page ------------------------------------------------------------------------------------------------------
function installProbe() {
  const A = window.__app, r = A.renderer, gl = r.getContext(), info = r.info;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  info.autoReset = false;
  const now = () => performance.now();
  const P = window.__probe = { gpuTimer: !!ext, on: false, frames: [], pending: [], frame: null, stack: [], t: 0, calls: 0, tris: 0, q: null, free: [], walk: null, wrapped: new Set() };
  const close = () => {
    const f = P.frame; if (!f) return;
    const label = P.stack[P.stack.length - 1], t = now(), c = info.render.calls, tr = info.render.triangles;
    const s = f.seg[label] ??= { cpu: 0, gpu: 0, calls: 0, tris: 0 };
    s.cpu += t - P.t; s.calls += c - P.calls; s.tris += tr - P.tris;
    if (P.q) { gl.endQuery(ext.TIME_ELAPSED_EXT); f.queries.push([label, P.q]); P.q = null; }
    P.t = t; P.calls = c; P.tris = tr;
  };
  const open = () => { if (ext && P.frame) { P.q = P.free.pop() ?? gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, P.q); } };
  const enter = label => { if (!P.frame) return false; close(); P.stack.push(label); open(); return true; };
  const exit = () => { close(); P.stack.pop(); open(); };
  const wrap = (obj, key, labelOf) => {
    if (!obj || typeof obj[key] !== 'function' || P.wrapped.has(obj[key])) return;
    const fn = obj[key];
    const w = function (...a) { const label = typeof labelOf === 'string' ? labelOf : labelOf.apply(this, a); if (!label || !enter(label)) return fn.apply(this, a); try { return fn.apply(this, a); } finally { exit(); } };
    P.wrapped.add(w); obj[key] = w;
  };
  const sun = A.lighting.sun;
  wrap(r, 'render', (scene, camera) => {
    if (scene?.isMesh) return null;   // a full-screen quad: part of its pass
    if (camera === sun.shadow.camera) return 'sunDepth';
    const top = P.stack[P.stack.length - 1] ?? '';
    if (scene === A.scene && camera === A.camera) return top.startsWith('pass:') ? null : 'scene';
    return `render:${scene?.name || scene?.type}/${camera?.name || camera?.type}`;
  });
  wrap(r.shadowMap, 'render', 'shadowMap');
  const wrapPasses = () => {
    const lists = [A.lighting.composer.passes, A.lighting.taa?.internal?.passes].filter(Boolean);
    for (const list of lists) for (const pass of list) wrap(pass, 'render', 'pass:' + (pass.constructor?.name || 'Pass'));
  };
  wrapPasses();
  wrap(A.lighting.composer, 'render', 'composer');
  wrap(A.lighting, 'update', 'lightingUpdate');
  if (A.baked) wrap(A.baked, 'updateMovables', 'bakedUpdate');
  wrap(A.layout, 'updateMirrors', 'mirrorsUpdate');
  wrap(A.layout, 'animate', 'animate');
  wrap(A.garden, 'update', 'garden');
  if (A.pets) wrap(A.pets, 'update', 'pets');
  wrap(A.interact, 'update', 'interact');
  wrap(A.markers, 'update', 'markers');
  wrap(A.minimap, 'draw', 'minimap');
  wrap(A.player, 'update', 'player');
  wrap(A.viewpoints, 'update', 'viewpoints');
  const ss = () => A.baked?.sunShadow?.stats ?? {};
  const poll = () => {
    if (!ext || !P.pending.length) { P.pending.length = 0; return; }
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    while (P.pending.length) {
      const f = P.pending[0], last = f.queries[f.queries.length - 1];
      if (last && !gl.getQueryParameter(last[1], gl.QUERY_RESULT_AVAILABLE)) break;
      P.pending.shift();
      let total = 0;
      for (const [label, q] of f.queries) { const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; f.seg[label].gpu += ms; total += ms; P.free.push(q); }
      f.gpu = disjoint ? null : total; f.queries = null;
    }
  };
  const stats = A.stats, begin = stats.begin.bind(stats), end = stats.end.bind(stats);
  stats.begin = () => {
    begin();
    poll();
    if (!P.on) return;
    if (P.walk) {   // the scripted walk: position along the polyline by elapsed time, looking 1.2 m ahead
      const w = P.walk, s = (now() - w.t0) / 1000 * w.speed;
      if (s >= w.total) { P.walk.done = true; } else {
        const at = d => { d = Math.min(d, w.total - 1e-6); let i = 0; while (w.cum[i + 1] < d) i++; const [x0, y0] = w.pts[i], [x1, y1] = w.pts[i + 1], u = (d - w.cum[i]) / (w.cum[i + 1] - w.cum[i]); return [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u]; };
        const [x, y] = at(s), [ax, ay] = at(s + 1.2);
        A.player.teleport(x, -y, Math.atan2(ax - x, ay - y) * 180 / Math.PI, -0.04);
      }
    }
    wrapPasses();
    const st = ss();
    P.frame = { t0: now(), seg: {}, queries: [], refresh: st.refreshes ?? 0, statics: st.staticRenders ?? 0 };
    P.stack = ['update']; P.t = P.frame.t0; P.calls = info.render.calls; P.tris = info.render.triangles; open();
  };
  stats.end = () => {
    const f = P.frame;
    if (f) {
      close(); P.stack = []; P.frame = null;
      const st = ss();
      f.cpu = now() - f.t0; f.refresh = (st.refreshes ?? 0) - f.refresh; f.statics = (st.staticRenders ?? 0) - f.statics;
      if (f.refresh) f.refreshMs = st.refreshMs; if (f.statics) f.staticMs = st.staticMs;
      const p = A.camera.position; f.pos = [+p.x.toFixed(2), +(-p.z).toFixed(2)];
      P.frames.push(f); if (ext) P.pending.push(f);
    }
    end();
  };
  A.player.move = () => {};   // cameras stand exactly where they are put (no collider push-out)
  // what the scene holds, once
  let meshes = 0, visible = 0, casters = 0, batched = 0, instanced = 0;
  A.scene.traverse(o => { if (!o.isMesh) return; meshes++; if (o.userData.batch) batched++; if (o.isInstancedMesh) instanced++; });
  A.scene.traverseVisible(o => { if (!o.isMesh) return; visible++; if (o.castShadow) casters++; });
  return { gpuTimer: !!ext, renderer: String(gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)), canvas: [r.domElement.width, r.domElement.height],
    meshes, visibleMeshes: visible, visibleCasters: casters, batchedMeshes: batched, instanced, programs: info.programs?.length ?? 0, sunShadow: { ...ss() }, fpsCap: A.state.fpsCap, quality: A.state.quality, build: globalThis.CROTON_BUILD ?? null };
}

// one window of frames: settle, then record for `seconds`, then wait for the GPU queries
async function record(page, seconds, settle) {
  await page.evaluate(s => new Promise(r => setTimeout(r, s * 1000)), settle);
  await page.evaluate(() => { window.__probe.frames = []; window.__probe.on = true; });
  await page.evaluate(s => new Promise(r => setTimeout(r, s * 1000)), seconds);
  return page.evaluate(async () => {
    const P = window.__probe; P.on = false;
    for (let i = 0; i < 40 && P.pending.length; i++) await new Promise(r => requestAnimationFrame(r));
    return P.frames.map(f => ({ t0: f.t0, cpu: f.cpu, gpu: f.gpu ?? null, seg: f.seg, refresh: f.refresh, statics: f.statics, refreshMs: f.refreshMs, staticMs: f.staticMs, pos: f.pos }));
  });
}
const median = a => { const v = a.filter(x => x != null && Number.isFinite(x)).sort((p, q) => p - q); return v.length ? v[Math.floor(v.length / 2)] : null; };
const pct = (a, q) => { const v = a.filter(x => x != null && Number.isFinite(x)).sort((p, q) => p - q); return v.length ? v[Math.min(v.length - 1, Math.floor(v.length * q))] : null; };
const mean = a => { const v = a.filter(x => x != null && Number.isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const r2 = v => v == null ? null : +v.toFixed(2);
function summarize(frames) {
  const iv = []; for (let i = 1; i < frames.length; i++) iv.push(frames[i].t0 - frames[i - 1].t0);
  const labels = new Set(); for (const f of frames) for (const k of Object.keys(f.seg)) labels.add(k);
  const seg = {};
  for (const k of labels) {
    const g = key => frames.map(f => f.seg[k]?.[key] ?? 0);
    seg[k] = { cpu: r2(mean(g('cpu'))), gpu: r2(mean(frames.filter(f => f.gpu != null).map(f => f.seg[k]?.gpu ?? 0))), calls: r2(mean(g('calls'))), tris: Math.round(mean(g('tris'))) };
  }
  const updateCpu = frames.map(f => f.seg.update?.cpu ?? 0), wrappedUpdate = ['lightingUpdate', 'bakedUpdate', 'mirrorsUpdate', 'animate', 'garden', 'pets', 'interact', 'markers', 'minimap', 'player', 'viewpoints'];
  const jsCpu = frames.map(f => (f.seg.update?.cpu ?? 0) + wrappedUpdate.reduce((s, k) => s + (f.seg[k]?.cpu ?? 0), 0));
  const seconds = frames.length > 1 ? (frames[frames.length - 1].t0 - frames[0].t0) / 1000 : 0;
  return {
    frames: frames.length, fps: r2(iv.length ? 1000 / mean(iv) : null), intervalMed: r2(median(iv)), intervalP90: r2(pct(iv, 0.9)), intervalP99: r2(pct(iv, 0.99)), even: r2(iv.length ? ((m) => iv.filter(x => Math.abs(x - m) <= 2).length / iv.length)(median(iv)) : null),
    cpuMed: r2(median(frames.map(f => f.cpu))), cpuP90: r2(pct(frames.map(f => f.cpu), 0.9)), jsMed: r2(median(jsCpu)), renderCpuMed: r2(median(frames.map((f, i) => f.cpu - jsCpu[i]))), updateOnlyMed: r2(median(updateCpu)),
    gpuMed: r2(median(frames.map(f => f.gpu))), gpuP90: r2(pct(frames.map(f => f.gpu), 0.9)),
    calls: r2(mean(frames.map(f => Object.values(f.seg).reduce((s, x) => s + x.calls, 0)))), tris: Math.round(mean(frames.map(f => Object.values(f.seg).reduce((s, x) => s + x.tris, 0)))),
    shadowRefreshPerS: r2(seconds ? frames.reduce((s, f) => s + f.refresh, 0) / seconds : null), shadowStaticPerS: r2(seconds ? frames.reduce((s, f) => s + f.statics, 0) / seconds : null),
    shadowRefreshMs: r2(median(frames.filter(f => f.refresh).map(f => f.refreshMs))), shadowStaticMs: r2(median(frames.filter(f => f.statics).map(f => f.staticMs))),
    seg,
  };
}
// CPU profile of the page's own loop: self time per function, inclusive time (each function counted once per sample,
// whatever its depth), and for the hottest native calls (no script location: getParameter, bufferData, ...) the
// script functions that call them.
async function profile(page, seconds) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  await page.evaluate(s => new Promise(r => setTimeout(r, s * 1000)), seconds);
  const { profile } = await cdp.send('Profiler.stop');
  const byId = new Map(profile.nodes.map(n => [n.id, n])), parent = new Map(), self = new Map(), incl = new Map(), callers = new Map(); let total = 0;
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const key = f => `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}:${f.columnNumber + 1}`;
  profile.samples.forEach((id, i) => {
    const d = profile.timeDeltas[i] || 0, n = byId.get(id), k = key(n.callFrame); total += d;
    self.set(k, (self.get(k) || 0) + d);
    const seen = new Set();
    for (let p = id; p != null; p = parent.get(p)) { const pk = key(byId.get(p).callFrame); if (!seen.has(pk)) { seen.add(pk); incl.set(pk, (incl.get(pk) || 0) + d); } }
    if (!n.callFrame.url) {   // a native call: who calls it
      let p = parent.get(id); while (p != null && !byId.get(p).callFrame.url) p = parent.get(p);
      const m = callers.get(k) ?? new Map(); callers.set(k, m); const ck = p == null ? '(root)' : key(byId.get(p).callFrame); m.set(ck, (m.get(ck) || 0) + d);
    }
  });
  await cdp.detach();
  const pctOf = v => +(v / total * 100).toFixed(1);
  const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => [k, pctOf(v)]);
  const natives = [...self].filter(([k]) => / :0:0$/.test(k) && !/^\((program|idle|garbage collector|root)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 8);
  return { totalMs: +(total / 1000).toFixed(0), top: top(self, 40), inclusive: top(incl, 60),
    callers: Object.fromEntries(natives.map(([k]) => [k, top(callers.get(k) ?? new Map(), 6)])) };
}
// --mix: one frame drawn with every draw call classified: per render (the composer pass, the scene's name, the camera)
// the draws by kind (batch.js: static merged cells, frozen far plants, near plant parts, toggle parts, movables, doors,
// instanced garden layers, skinned pets) and the largest kind / placement module / material groups; the nodes three's
// projectObject visits per render of the scene (visible nodes and their hidden children).
function mixFrame() {
  const A = window.__app, r = A.renderer, sun = A.lighting.sun;
  const anim = new Set(A.layout.animated), inter = new Set(A.layout.interactive), doors = new Set(A.getDoors().map(d => d.group));
  const info = o => {
    let frozen = false, door = false, animated = null, interactive = null, placed = null;
    for (let p = o; p; p = p.parent) {
      if (p.name === 'frozen' && p.userData.batch) frozen = true;
      if (doors.has(p)) door = true;
      if (anim.has(p)) animated = p;
      if (inter.has(p)) interactive = p;
      if (!placed && p.userData?.placement) placed = p;
    }
    const merged = o.userData.batch ? ' merged' : ' parts';
    const kind = o.isInstancedMesh ? 'instanced' : o.isSkinnedMesh ? 'skinned' : frozen ? 'frozen plant' : (animated ?? interactive)?.userData.toggle ? 'toggle' + merged
      : animated ? 'near plant' + merged : interactive ? 'movable' + merged : door ? 'door' + merged : o.userData.batch ? 'static merged' : 'single';
    return { kind, mod: placed?.userData.placement?.m ?? (o.name || o.parent?.name || '?') };
  };
  const passes = [A.lighting.composer.passes, A.lighting.taa?.internal?.passes].filter(Boolean).flat();
  let current = 'update';
  const undo = [];
  for (const pass of passes) { const fn = pass.render; pass.render = function (...a) { const was = current; current = pass.constructor?.name || 'Pass'; try { return fn.apply(this, a); } finally { current = was; } }; undo.push(() => { pass.render = fn; }); }
  const out = {}, seenRender = new WeakSet();
  let renderLabel = null;
  const render = r.render;
  r.render = function (scene, camera) {
    const was = renderLabel;
    const cam = camera === A.camera ? 'camera' : camera === sun.shadow.camera ? 'sun' : (camera?.name || camera?.type);
    renderLabel = `${current} ${scene?.isMesh ? 'quad' : scene?.name || scene?.type}/${cam}`;
    if (scene?.isScene && !seenRender.has(scene)) seenRender.add(scene);
    try { return render.apply(this, arguments); } finally { renderLabel = was; }
  };
  undo.push(() => { r.render = render; });
  const rbd = r.renderBufferDirect;
  r.renderBufferDirect = function (camera, scene, geometry, material, object) {
    const label = renderLabel ?? `${current} direct`, t = out[label] ??= { draws: 0, kinds: {}, detail: {} };
    const { kind, mod } = info(object), d = `${kind} | ${mod} | ${material?.name || material?.type}`;
    t.draws++; t.kinds[kind] = (t.kinds[kind] || 0) + 1; t.detail[d] = (t.detail[d] || 0) + 1;
    return rbd.apply(this, arguments);
  };
  undo.push(() => { r.renderBufferDirect = rbd; });
  try { window.renderAt(window.simTime() + 1 / 60); } finally { for (const u of undo.reverse()) u(); }
  let visible = 0, hiddenChildren = 0, hiddenBatched = 0;
  const walk = o => { if (!o.visible) { hiddenChildren++; if (o.userData.batched) hiddenBatched++; return; } visible++; for (const c of o.children) walk(c); };
  walk(A.scene);
  for (const t of Object.values(out)) t.detail = Object.fromEntries(Object.entries(t.detail).sort((a, b) => b[1] - a[1]).slice(0, 40));
  return { renders: out, projectVisits: { visible, hiddenChildren, hiddenBatched } };
}

// --rounds N: the variants N times over, interleaved (a, b, a, b): pages on a shared node drift by 20% between loads, so a
// before/after pair is only fair side by side. The summary per camera is the median of the rounds.
const ROUNDS = +opt('--rounds', 1);
const result = { size: [W, H], query: BASEQ, dwell: DWELL, rounds: ROUNDS, variants: {} };
const vfov = 62;
for (let round = 0; round < ROUNDS; round++) for (const v of variants) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) { errors.push(m.text().slice(0, 300)); console.log('[console]', m.text().slice(0, 300)); } });
  const missing = new Set(); page.on('response', r => { if (r.status() >= 400) missing.add(r.status() + ' ' + r.url().replace(/^https?:\/\/[^/]+/, '')); });
  const t0 = Date.now();
  const q = [VSYNC ? '' : 'fps=0', 'pins=0', BASEQ, v.query].filter(Boolean).join('&');
  await page.goto(`http://127.0.0.1:${port}/v/${v.name}/index.html?${q}&x=0&y=-6.9`, { waitUntil: 'load' });
  const gpu = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : gl.RENDERER); });
  if (/SwiftShader|llvmpipe|software/i.test(gpu)) { console.log('software rasteriser: refusing to measure'); process.exit(2); }
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
  const info = await page.evaluate(installProbe);
  console.log(`[${v.name}] loaded in ${((Date.now() - t0) / 1000).toFixed(0)} s on ${gpu}: ${JSON.stringify(info)}`);
  const all = result.variants[v.name] ??= { query: q, dist: v.dist, gpu, info, rounds: [] };
  const out = { loadSeconds: (Date.now() - t0) / 1000, cameras: {}, errors, missing: [] }; all.rounds.push(out);
  console.log(`[${v.name}] missing: ${[...missing].slice(0, 12).join(' ')}${missing.size > 12 ? ' ...' : ''}`); out.missing = [...missing];
  for (const c of cams) {
    await page.evaluate(([c, fov]) => { const A = window.__app; A.player.eyeHeight = c.z; A.player.eye = c.z; A.player.teleport(c.x, -c.y, c.h, c.p); A.camera.fov = fov; A.camera.updateProjectionMatrix(); }, [c, vfov]);
    const frames = await record(page, DWELL, SETTLE);
    const s = out.cameras[c.id] = summarize(frames);
    s.pacing = await page.evaluate(() => window.__app.state.pacing?.describe?.() ?? null);
    // the same view drawn frame by frame with the pipeline drained in between: submit time and the wait for the GPU
    s.serial = await page.evaluate(() => {
      const A = window.__app, gl = A.renderer.getContext(), cpu = [], wait = [];
      gl.finish();
      for (let i = 0; i < 30; i++) { const t0 = performance.now(); window.renderAt(window.simTime() + 1 / 60); const t1 = performance.now(); gl.finish(); cpu.push(t1 - t0); wait.push(performance.now() - t1); }
      const med = v => +v.sort((p, q) => p - q)[15].toFixed(2);
      return { cpu: med(cpu), finishWait: med(wait) };
    });
    if (argv.includes('--profile')) s.profile = await profile(page, 2);
    if (argv.includes('--mix')) {
      s.mix = await page.evaluate(mixFrame);
      const main = Object.entries(s.mix.renders).sort((a, b) => b[1].draws - a[1].draws).slice(0, 4);
      console.log(`[${v.name}] ${c.id.padEnd(18)} mix: ${main.map(([k, t]) => `${k} ${t.draws} ${JSON.stringify(t.kinds)}`).join(' || ')} | visits ${JSON.stringify(s.mix.projectVisits)}`);
    }
    await writeFile(OUT, JSON.stringify(result, null, 1));
    console.log(`[${v.name}] ${c.id.padEnd(18)} fps ${s.fps} | cpu ${s.cpuMed} (js ${s.jsMed}, render ${s.renderCpuMed}) | gpu ${s.gpuMed} | serial cpu ${s.serial.cpu} + wait ${s.serial.finishWait} | calls ${s.calls} tris ${s.tris} | shadow ${s.shadowRefreshPerS}/s`);
  }
  if (argv.includes('--walk')) {
    await page.evaluate(pts => { const A = window.__app; A.player.eyeHeight = 1.6; A.player.eye = 1.6; const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); window.__probe.walk = { pts, cum, total: cum[cum.length - 1], speed: 1.4, t0: 0 }; A.player.teleport(pts[0][0], -pts[0][1], 0, -0.04); }, WALK);
    await page.evaluate(s => new Promise(r => setTimeout(r, s * 1000)), SETTLE);
    await page.evaluate(() => { const P = window.__probe; P.frames = []; P.walk.t0 = performance.now(); P.walk.done = false; P.on = true; });
    await page.waitForFunction(() => window.__probe.walk.done, null, { timeout: 300000, polling: 500 });
    const frames = await page.evaluate(async () => {
      const P = window.__probe; P.on = false; P.walk = null;
      for (let i = 0; i < 40 && P.pending.length; i++) await new Promise(r => requestAnimationFrame(r));
      return P.frames.map(f => ({ t0: f.t0, cpu: f.cpu, gpu: f.gpu ?? null, seg: f.seg, refresh: f.refresh, statics: f.statics, refreshMs: f.refreshMs, staticMs: f.staticMs, pos: f.pos }));
    });
    const s = out.walk = summarize(frames);
    // per frame, compact: time, interval, cpu, gpu, calls, position
    out.walkFrames = frames.map((f, i) => [r2(f.t0 - frames[0].t0), i ? r2(f.t0 - frames[i - 1].t0) : null, r2(f.cpu), r2(f.gpu), Math.round(Object.values(f.seg).reduce((a, x) => a + x.calls, 0)), f.pos]);
    // the long frames, with where their CPU went
    out.walkLong = frames.map((f, i) => ({ f, i })).filter(({ f }) => f.cpu > 70).map(({ f, i }) => ({ t: r2(f.t0 - frames[0].t0), cpu: r2(f.cpu), pos: f.pos, refresh: f.refresh, statics: f.statics,
      seg: Object.fromEntries(Object.entries(f.seg).filter(([, s]) => s.cpu > 3).map(([k, s]) => [k, r2(s.cpu)])) }));
    console.log(`[${v.name}] walk ${frames.length} frames: fps ${s.fps} | interval p90 ${s.intervalP90} p99 ${s.intervalP99} | cpu ${s.cpuMed} | gpu ${s.gpuMed} | calls ${s.calls} | shadow ${s.shadowRefreshPerS}/s`);
  }
  await page.close();
}
// medians over the rounds, per camera and for the walk (the rounds stay in the file)
const medOf = (list, f) => median(list.map(f));
for (const all of Object.values(result.variants)) {
  all.cameras = {};
  for (const c of cams) {
    const rs = all.rounds.map(r => r.cameras[c.id]).filter(Boolean); if (!rs.length) continue;
    const m = all.cameras[c.id] = {};
    for (const k of ['fps', 'cpuMed', 'jsMed', 'renderCpuMed', 'gpuMed', 'calls', 'tris', 'intervalMed', 'intervalP90', 'intervalP99', 'even', 'shadowRefreshPerS', 'shadowStaticPerS']) m[k] = r2(medOf(rs, s => s[k]));
    m.seg = {}; for (const k of new Set(rs.flatMap(s => Object.keys(s.seg)))) m.seg[k] = { cpu: r2(medOf(rs, s => s.seg[k]?.cpu ?? 0)), gpu: r2(medOf(rs, s => s.seg[k]?.gpu ?? 0)), calls: r2(medOf(rs, s => s.seg[k]?.calls ?? 0)) };
  }
  const ws = all.rounds.map(r => r.walk).filter(Boolean);
  if (ws.length) { all.walk = {}; for (const k of ['fps', 'intervalMed', 'intervalP90', 'intervalP99', 'even', 'cpuMed', 'gpuMed', 'calls', 'shadowRefreshPerS', 'shadowStaticPerS']) all.walk[k] = r2(medOf(ws, s => s[k])); }
}
for (const [name, all] of Object.entries(result.variants)) {
  console.log(`\n== ${name} (median of ${all.rounds.length})`);
  for (const [id, s] of Object.entries(all.cameras)) console.log(`${id.padEnd(18)} fps ${s.fps} | cpu ${s.cpuMed} (js ${s.jsMed}) | gpu ${s.gpuMed} | calls ${s.calls} | interval ${s.intervalMed} p99 ${s.intervalP99} even ${s.even}`);
  if (all.walk) console.log(`walk               fps ${all.walk.fps} | interval median ${all.walk.intervalMed} p90 ${all.walk.intervalP90} p99 ${all.walk.intervalP99} even ${all.walk.even} | cpu ${all.walk.cpuMed} | calls ${all.walk.calls}`);
}
await writeFile(OUT, JSON.stringify(result, null, 1));
await browser.close(); server.close();
console.log('wrote', OUT);
