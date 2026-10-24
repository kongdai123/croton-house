// Volumetric light and TAA through cameras, on a GPU node (never a laptop). Serves CROTON_SITE, loads one page per
// (slot, page variant), shoots cameras (optionally with the volumetric pass switched off inside the same page), moving
// sequences and GPU timings. Used for the 2026-10-24 volumetrics / TAA evaluation (docs/realtime-plan.md).
//   node shoot_volumetric.mjs --out DIR --states sunrise,golden,noon --cams id,id [--extra cameras_volumetric.json]
//     --pages 'name=query;name=query'   one page per variant; '||' separates pages whose page JS (after '@@') has ';'
//     [--modes on,off]   'off': baked.shafts.enabled = false in the same page (only pages that have the pass)
//     [--visitor]        auto exposure and local adaptation on, the page's own loop stopped (as gate c --visitor)
//     [--size 1280x720] [--frames 40] [--pets] [--eval JS] [--params JSON: baked.shafts.params, e.g. {"debug":1}]
//     [--walk JSON | @file]  one walk or a list: { name, x, y, z, h, p, speed m/s, turn deg/s, frames, every, wait ms,
//                            action: page JS run first, track: pet to keep in view, petPath: { name, x0, y0, x1, y1,
//                            speed } a pet walked by hand across the view, noMove: leave the camera alone }
//     [--perf] [--perfsize 2560x1440]  per camera: GPU time per frame (EXT_disjoint_timer_query_webgl2) with the pass
//                                      off / on, interleaved, and the pass alone; fps=0
// Cameras: x, y plan metres (y north), z eye height, h heading (deg clockwise from north), p pitch (rad), lens (mm).
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { extname, join } from 'path';
const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const ROOT = process.env.CROTON_SITE;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try { const p = decodeURIComponent(req.url.split('?')[0]); const data = await readFile(join(ROOT, p === '/' ? 'index.html' : p)); res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(data); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-vulkan-surface',
  '--disable-gpu-vsync', '--disable-frame-rate-limit', '--enable-webgl-draft-extensions'] });
const HIDE = '#hud, #title, #minimap, #topbar, #crosshair, #label, #toast, #warming, #firststeps, #controls { display: none !important; }';
const vfov = lens => 2 * Math.atan(18 / lens * 9 / 16) * 180 / Math.PI;
const out = opt('--out'), states = opt('--states', 'sunrise').split(','), visitor = argv.includes('--visitor');
const [W, H] = opt('--size', '1280x720').split('x').map(Number), frames = +opt('--frames', 40);
// pages: 'name=query[@@js]' separated by ';', or by '||' when a page's js has semicolons (js runs after load)
const pagesArg = opt('--pages', 'on=shafts&taa=0'), pages = pagesArg.split(pagesArg.includes('||') ? '||' : ';').map(s => { const i = s.indexOf('='), [q, js] = s.slice(i + 1).split('@@'); return [s.slice(0, i), q, js]; });
const modes = opt('--modes', 'on').split(',');
const allCams = [...JSON.parse(await readFile(new URL('./cameras.json', import.meta.url), 'utf8')).cameras];
if (opt('--extra')) allCams.push(...JSON.parse(await readFile(opt('--extra'), 'utf8')));
const camIds = opt('--cams', '')?.split(',').filter(Boolean) ?? [];
const cams = camIds.map(id => allCams.find(c => c.id === id) ?? (console.log('no camera', id), null)).filter(Boolean);
const report = { size: [W, H], pages: {}, perf: {} };

async function open(query, viewport) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  let missing = 0; page.on('response', r => { if (r.status() >= 400 && missing++ < 12) console.log('[http]', r.status(), r.url().replace(/^https?:\/\/[^/]+/, '')); });
  page.on('console', m => { const t = m.text(); if (/Failed to load resource/.test(t)) return; if ((m.type() === 'error' || m.type() === 'warning') && !/deprecated|sigmaRadians|serialize|KHR_parallel|GPU stall/.test(t)) console.log('[console]', m.type(), t.slice(0, 400)); });
  const pets = argv.includes('--pets') ? '' : '&pets=0';
  const base = (visitor ? 'pins=0' : 'capture&pins=0&autoexp=0') + pets;
  await page.goto(`http://127.0.0.1:${port}/index.html?${base}&x=0&y=0&tier=hq&lmres=full&${query}`, { waitUntil: 'load' });
  const gpu = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : gl.RENDERER); });
  if (/SwiftShader|llvmpipe|software/i.test(gpu)) { console.log('software rasteriser: refusing', gpu); process.exit(2); }
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
  await page.addStyleTag({ content: HIDE });
  if (visitor) await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
  await page.evaluate(() => { window.__app.player.move = () => {}; });
  if (opt('--eval')) console.log('eval', await page.evaluate(opt('--eval')));
  if (opt('--params')) await page.evaluate(p => { const s = window.__app.baked?.shafts; if (s) Object.assign(s.params, p); }, JSON.parse(opt('--params')));
  const info = await page.evaluate(() => { const A = window.__app, s = A.baked?.shafts;
    return { gpu: null, slot: A.baked?.slotName, fallback: A.state.bakedFallback ?? null, taa: !!A.lighting.taa, taaScale: A.lighting.taa?.scale ?? null, shafts: !!s && s.enabled,
      passes: (A.lighting.taa?.internal ?? A.lighting.composer).passes.map(p => p.constructor.name), msaa: A.lighting.composer.renderTarget1.samples, low: s ? [s.current.width, s.current.height] : null, params: s?.params ?? null }; });
  info.gpu = gpu;
  return { page, info };
}
const place = (page, c) => page.evaluate(([c, fov]) => {
  const A = window.__app; A.player.eyeHeight = c.z ?? 1.45; A.player.eye = c.z ?? 1.45; A.player.teleport(c.x, -c.y, c.h, c.p ?? 0);
  A.camera.fov = fov; A.camera.updateProjectionMatrix();
}, [c, vfov(c.lens ?? 22)]);
const step = (page, n) => page.evaluate(n => { for (let i = 0; i < n; i++) window.renderAt(window.simTime() + 1 / 30); }, n);

for (const slot of states) for (const [name, query, js] of pages) {
  const t0 = Date.now(), { page, info } = await open(`lightmap=${slot}&${query}`, { width: W, height: H });
  if (js) console.log('page js', await page.evaluate(js));
  console.log(`[${slot} ${name}] loaded ${((Date.now() - t0) / 1000).toFixed(0)} s`, JSON.stringify(info));
  report.pages[`${slot}/${name}`] = info;
  for (const mode of modes) {
    if (mode === 'off' && !info.shafts) continue;
    await page.evaluate(on => { const s = window.__app.baked?.shafts; if (s) s.enabled = on; }, mode !== 'off');
    const dir = join(out, slot, modes.length > 1 ? `${name}_${mode}` : name); await mkdir(dir, { recursive: true });
    for (const c of cams) {
      await place(page, c); await step(page, visitor ? 120 : frames);
      await page.screenshot({ path: join(dir, c.id + '.png') });
    }
    console.log(`[${slot} ${name} ${mode}] ${cams.length} cameras`);
  }
  // a walking sequence: the camera moves along a straight path at 1.3 m/s, turning slowly; frames saved every `every`
  const walkArg = opt('--walk'), walkOpt = walkArg?.startsWith('@') ? await readFile(walkArg.slice(1), 'utf8') : walkArg;   // JSON, or @file
  // one walk object or an array of them; each: x, y, z, h, p, speed (m/s), turn (deg/s), frames, every, track (pet name),
  // action (page JS run once before the frames), name (folder suffix)
  for (const [wi, w] of (walkOpt ? [].concat(JSON.parse(walkOpt)) : []).entries()) {
    const dir = join(out, slot, `${name}_${w.name ?? (wi ? 'walk' + wi : 'walk')}`); await mkdir(dir, { recursive: true });
    await place(page, w); await step(page, 60);
    if (w.action) console.log('action', await page.evaluate(w.action));
    for (let k = 0; k < w.frames; k++) {
      await page.evaluate(([w, k]) => {
        const A = window.__app, t = k / 30;
        const x = w.x + Math.sin(w.h * Math.PI / 180) * (w.speed ?? 1.3) * t, y = w.y + Math.cos(w.h * Math.PI / 180) * (w.speed ?? 1.3) * t;
        let h = w.h + (w.turn ?? 0) * t;
        // track: keep a pet in view (heading from the eye to it, plan degrees clockwise from north)
        const pet = w.track && A.pets?.get(w.track);
        if (pet) { const dx = pet.x - x, dy = -pet.z - y; h = Math.atan2(dx, dy) * 180 / Math.PI; }
        // petPath: a pet walked by hand across the view ({ name, x0, y0, x1, y1, speed } in plan metres), for ghosting
        const pp = w.petPath;
        if (pp && A.pets) {
          const L = Math.hypot(pp.x1 - pp.x0, pp.y1 - pp.y0), f = Math.min(1, (pp.speed ?? 1.2) * t / L), yaw = Math.atan2(pp.x1 - pp.x0, -(pp.y1 - pp.y0));
          A.pets.hold(pp.name, { x: pp.x0 + (pp.x1 - pp.x0) * f, z: -(pp.y0 + (pp.y1 - pp.y0) * f), yaw, mode: f < 1 ? 'walk' : 'idle', speed: f < 1 ? pp.speed ?? 1.2 : 0 });
        }
        if (!w.noMove) A.player.teleport(x, -y, h, w.p ?? 0);
        window.renderAt(window.simTime() + 1 / 30);
      }, [w, k]);
      if (w.wait) await new Promise(r => setTimeout(r, w.wait));   // real time for async work (a slot download)
      if (k % (w.every ?? 1) === 0 || k === w.frames - 1) await page.screenshot({ path: join(dir, `f${String(k).padStart(3, '0')}.png`) });
    }
    console.log(`[${slot} ${name}] walk ${dir} ${w.frames} frames`);
  }
  await page.close();
}

// GPU timings: per view, frames with the shafts pass off / on interleaved (TIME_ELAPSED around the whole frame), and the
// pass alone (TIME_ELAPSED around its render). fps=0, no cap; 2560x1440 by default.
if (argv.includes('--perf')) {
  const [PW, PH] = opt('--perfsize', '2560x1440').split('x').map(Number);
  for (const [name, query, js] of pages) {
    const { page, info } = await open(`lightmap=${states[0]}&fps=0&${query}`, { width: PW, height: PH });
    if (js) await page.evaluate(js);
    const buffer = await page.evaluate(() => { const b = new window.__app.THREE.Vector2(); window.__app.renderer.getDrawingBufferSize(b); return [b.x, b.y]; });
    console.log(`[perf ${name}] buffer ${buffer}`, JSON.stringify(info));
    report.perf[name] = { buffer, info, views: {} };
    for (const c of cams) {
      await place(page, c); await step(page, 30);
      const r = await page.evaluate(async () => {
        const A = window.__app, gl = A.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'), s = A.baked?.shafts;
        if (!ext) return { ext: false };
        const px = new Uint8Array(4), sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const collect = async pending => { const out = []; await new Promise(r => setTimeout(r, 100));
          for (const q of pending) { for (let k = 0; k < 50 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await new Promise(r => setTimeout(r, 5));
            if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) out.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); } return out; };
        const frame = async (on, n) => {
          if (s) s.enabled = on;
          for (let i = 0; i < 20; i++) window.renderAt(window.simTime() + 1 / 60); sync();
          const pending = [], wall = [];
          for (let i = 0; i < n; i++) { const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); const t0 = performance.now();
            window.renderAt(window.simTime() + 1 / 60); gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(q); sync(); wall.push(performance.now() - t0); }
          return { gpu: await collect(pending), wall };
        };
        const res = { on: [], off: [], pass: [], wallOn: [], wallOff: [] };
        for (let rep = 0; rep < 6; rep++) for (const on of s ? [false, true] : [true]) { const b = await frame(on, 30); res[on ? 'on' : 'off'].push(...b.gpu); res[on ? 'wallOn' : 'wallOff'].push(...b.wall); }
        if (s) {
          s.enabled = true; const orig = s.render, pending = [];
          s.render = function (...a) { const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); try { return orig.apply(this, a); } finally { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(q); } };
          for (let i = 0; i < 120; i++) { window.renderAt(window.simTime() + 1 / 60); sync(); }
          s.render = orig; res.pass = await collect(pending);
        }
        const stat = a => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return { n: a.length, median: +b[b.length >> 1].toFixed(3), p10: +b[Math.floor(b.length * 0.1)].toFixed(3), p90: +b[Math.floor(b.length * 0.9)].toFixed(3) }; };
        return { ext: true, disjoint: !!gl.getParameter(ext.GPU_DISJOINT_EXT), off: stat(res.off), on: stat(res.on), pass: stat(res.pass), wallOff: stat(res.wallOff), wallOn: stat(res.wallOn) };
      });
      console.log(`perf ${name} ${c.id}`, JSON.stringify(r)); report.perf[name].views[c.id] = r;
    }
    await page.close();
  }
}
await writeFile(join(out, `report_${Date.now()}.json`), JSON.stringify(report, null, 1));
await browser.close(); server.close();
