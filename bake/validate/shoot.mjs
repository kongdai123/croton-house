// Render the live site through fixed cameras on a GPU node. Refuses to run on a software rasteriser. Serves the site
// folder itself on a free port (CROTON_SITE, default web/).
//
// Reference views (Blender's garden and living cameras, 1280x720; validate/check.sh, metrics.py):
//   node shoot.mjs <outDir> <query>
// Gate (c), per-room render regression (cameras.json; compare.py reads the result):
//   node shoot.mjs --cameras cameras.json --out <runDir> --tier hq|mobile [--states sunrise,noon,golden,dusk,dusk_allon]
//                  [--only id,id] [--size 960x540] [--frames 30] [--query 'k=v&...' (extra site parameters)]
//   One fresh page per slot (?lightmap=<slot>, the slot's default switches; hq adds &lmres=full, mobile takes its own
//   quarter atlas); dusk_allon is the dusk page again after every switch is turned on (<slot>_alloff: every switch off). Writes
//   <runDir>/<tier>/<state>/<camera>.png and <runDir>/<tier>/<state>/report.json (load and shot times, page errors,
//   shader errors, link failures, sampler maximum, baked stats).
//   Two sets: fixed exposure (default; ?capture, the slot's exposure, what Cycles renders) and --visitor (what a visitor
//   sees: auto exposure and local adaptation on, written to <tier>-visitor/). The visitor page is loaded without
//   ?capture, then its own frame loop is stopped so the clock still moves only through renderAt; each camera arrives by
//   teleport (the adaptation's fast path) and is shot once the exposure has settled (at least 2 s of simulated time,
//   then until it moves less than 0.01 EV per 1/3 s, at most 8 s).
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { extname, join } from 'path';
const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const ROOT = process.env.CROTON_SITE || new URL('../../web', import.meta.url).pathname;   // the site folder to serve
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try { const p = decodeURIComponent(req.url.split('?')[0]); const data = await readFile(join(ROOT, p === '/' ? 'index.html' : p)); res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(data); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-vulkan-surface'] });
const HIDE = '#hud, #title, #minimap, #topbar, #crosshair, #label, #toast, #warming, #firststeps, #controls { display: none !important; }';
// Blender's camera: lens mm on a 36 mm-wide sensor, 16:9
const vfov = lens => 2 * Math.atan(18 / lens * 9 / 16) * 180 / Math.PI;

async function open(query, viewport, log, base = 'capture&pins=0&pets=0&autoexp=0') {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', e => { log.pageerrors.push(e.message); console.log('[pageerror]', e.message); });
  page.on('console', m => {
    const t = m.text();
    if (m.type() === 'error' && /Shader Error|Program Info Log|VALIDATE_STATUS|link/i.test(t)) log.shaderErrors.push(t.slice(0, 600));
    if ((m.type() === 'error' || m.type() === 'warning') && !/deprecated|sigmaRadians|serialize|KHR_parallel_shader_compile|GPU stall due to ReadPixels/.test(t)) { log.console.push(m.type() + ': ' + t.slice(0, 300)); console.log('[console]', t.slice(0, 300)); }
  });
  page.on('response', r => { if (r.status() >= 400 && !/manifest\.json|favicon/.test(r.url())) log.http.push(r.status() + ' ' + r.url().replace(/^https?:\/\/[^/]+/, '')); });
  await page.goto(`http://127.0.0.1:${port}/index.html?${base}&x=0&y=0&${query}`, { waitUntil: 'load' });
  const gpu = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : gl.RENDERER); });
  console.log('renderer', gpu);
  if (/SwiftShader|llvmpipe|software/i.test(gpu)) { console.log('software rasteriser: refusing to render'); process.exit(2); }
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
  await page.addStyleTag({ content: HIDE });
  return { page, gpu };
}

if (!argv.includes('--cameras')) {
  // ---- the two reference views ----------------------------------------------------------------------------------------
  const [out, query = 'lightmap'] = argv;
  const log = { pageerrors: [], shaderErrors: [], console: [], http: [] };
  const { page } = await open('eye=1.35&' + query, { width: 1280, height: 720 }, log);
  console.log('baked', JSON.stringify(await page.evaluate(() => window.__app.baked?.stats ?? null)));
  const VIEWS = [
    { name: 'garden', x: 5.6, y: 12.7, h: 198, p: 0.09 },
    { name: 'living', x: 0.3, y: -1.4, h: 0, p: 0 },
  ];
  for (const v of VIEWS) {
    await page.evaluate(([v, fov]) => {
      const A = window.__app; A.player.eyeHeight = 1.35; A.player.eye = 1.35; A.player.teleport(v.x, -v.y, v.h, v.p);
      A.camera.fov = fov; A.camera.updateProjectionMatrix();
      for (let i = 0; i < 30; i++) window.renderAt(window.simTime() + 1 / 30);
    }, [v, vfov(22)]);
    await page.screenshot({ path: `${out}/${v.name}.png` });
    console.log('shot', v.name);
  }
} else {
  // ---- gate (c): every camera of cameras.json, per slot ---------------------------------------------------------------
  const cams = JSON.parse(await readFile(opt('--cameras'), 'utf8')).cameras;
  const out = opt('--out'), tier = opt('--tier', 'hq'), frames = +opt('--frames', 30), visitor = argv.includes('--visitor');
  const set = visitor ? tier + '-visitor' : tier;
  const [W, H] = opt('--size', '960x540').split('x').map(Number);
  const only = opt('--only')?.split(',');
  const list = only ? cams.filter(c => only.includes(c.id)) : cams;
  const states = opt('--states', 'sunrise,noon,golden,dusk,dusk_allon').split(',');
  const slots = [...new Set(states.map(s => s.split('_')[0]))];
  const tierQuery = (tier === 'hq' ? 'tier=hq&lmres=full' : `tier=${tier}`) + (opt('--query') ? '&' + opt('--query') : '');   // --query: extra site parameters
  let failed = false;
  for (const slot of slots) {
    const log = { pageerrors: [], shaderErrors: [], console: [], http: [] }, t0 = Date.now();
    const { page, gpu } = await open(`lightmap=${slot}&${tierQuery}`, { width: W, height: H }, log, visitor ? 'pins=0&pets=0' : undefined);
    // visitor: stop the app's own frame loop (its next requestAnimationFrame is the last), so only renderAt moves time
    if (visitor) await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
    const info = await page.evaluate(() => { const A = window.__app, ae = A.lighting.autoExposure; return { stats: A.baked?.stats ?? null, slot: A.baked?.slotName ?? null, fallback: A.state.bakedFallback ?? null, quality: A.state.quality ?? null, autoExposure: !!ae, localAdaptation: !!ae?.local }; });
    const loadSeconds = (Date.now() - t0) / 1000;
    console.log(`[${set} ${slot}] loaded in ${loadSeconds.toFixed(0)} s, slot ${info.slot}, auto exposure ${info.autoExposure}, local adaptation ${info.localAdaptation}`);
    if (visitor && !info.autoExposure) { console.log('visitor set without auto exposure'); failed = true; }
    if (!info.stats || info.slot !== slot) { console.log('baked lighting did not load:', JSON.stringify(info)); failed = true; await page.close(); continue; }
    // the camera stands exactly where cameras.json puts it: no collider push-out (make_cameras.mjs keeps cameras clear)
    await page.evaluate(() => { window.__app.player.move = () => {}; });
    for (const state of states.filter(s => s.split('_')[0] === slot)) {
      const dir = join(out, set, state); await mkdir(dir, { recursive: true });
      const t1 = Date.now(), shots = {};
      if (state.endsWith('_allon') || state.endsWith('_alloff')) await page.evaluate(([n, on]) => {   // every switch on (off), then let the lamp levels fade
        const G = window.__app.baked.lampGroups; for (const r of G.records) if (r.toggle.on !== on) r.toggle.set(on);
        for (let i = 0; i < n; i++) window.renderAt(window.simTime() + 1 / 30);
      }, [45, state.endsWith('_allon')]);
      for (const c of list) {
        const t2 = Date.now();
        const r = await page.evaluate(([c, fov, n, visitor]) => {
          const A = window.__app, doors = A.getDoors?.() ?? [];
          const isOpen = d => d.kind === 'french' || d.kind === 'bifold' ? d.target > 0.5 : d.kind === 'slider' ? d.open > 0.3 : Math.abs(d.target) >= 0.1;
          const changed = [];
          for (const [id, want] of Object.entries(c.doors ?? {})) {
            const d = doors.find(d => d.id === id); if (!d) return { error: 'no door ' + id };
            if (isOpen(d) !== (want === 'open')) { A.interact.toggleDoor(d); changed.push(d); }
          }
          A.player.eyeHeight = c.z; A.player.eye = c.z; A.player.teleport(c.x, -c.y, c.h, c.p);
          A.camera.fov = fov; A.camera.updateProjectionMatrix();
          const step = k => { for (let i = 0; i < k; i++) window.renderAt(window.simTime() + 1 / 30); };
          step(n + (changed.length ? 15 : 0));
          let ev = null, settled = null;
          if (visitor) {   // the exposure state (1x1, 2^EV in red), read back until it stops moving
            const t = A.lighting.autoExposure?.debugTargets.exposure, half = t?.texture.type === A.THREE.HalfFloatType;
            const read = () => { const b = half ? new Uint16Array(4) : new Float32Array(4); A.renderer.readRenderTargetPixels(t, 0, 0, 1, 1, b); return Math.log2(half ? A.THREE.DataUtils.fromHalfFloat(b[0]) : b[0]); };
            let k = n + (changed.length ? 15 : 0); step(Math.max(0, 60 - k)); k = Math.max(k, 60); ev = read();
            for (let calm = 0; k < 240 && calm < 2; k += 10) { step(10); const e = read(); calm = Math.abs(e - ev) < 0.01 ? calm + 1 : 0; ev = e; }
            settled = k; ev = +ev.toFixed(3);
          }
          window.__restoreDoors = changed;
          const p = A.camera.position; return { cam: [p.x, -p.z, p.y].map(v => +v.toFixed(3)), doors: changed.map(d => d.id), ...(visitor ? { ev, frames: settled } : {}) };
        }, [c, vfov(c.lens ?? 22), frames, visitor]);
        if (r.error) { console.log(c.id, r.error); failed = true; }
        if (!r.error && Math.hypot(r.cam[0] - c.x, r.cam[1] - c.y) > 0.05) { console.log(c.id, 'camera moved to', r.cam); log.console.push(`${c.id}: camera at ${r.cam}, not ${[c.x, c.y]}`); }
        await page.screenshot({ path: join(dir, c.id + '.png') });
        await page.evaluate(n => {   // doors back to where they were, settled before the next camera's frames
          const A = window.__app; for (const d of window.__restoreDoors ?? []) A.interact.toggleDoor(d);
          if (window.__restoreDoors?.length) for (let i = 0; i < n; i++) window.renderAt(window.simTime() + 1 / 30);
          window.__restoreDoors = [];
        }, 40);
        shots[c.id] = { seconds: +((Date.now() - t2) / 1000).toFixed(2), ...r };
      }
      const audit = await page.evaluate(() => {
        const A = window.__app, r = A.renderer, gl = r.getContext(), failed = [];
        for (const p of r.info.programs ?? []) if (!gl.getProgramParameter(p.program, gl.LINK_STATUS)) failed.push(p.name);
        let samplers = null; try { samplers = A.baked.auditSamplers?.() ?? null; } catch (e) { samplers = { error: String(e) }; }
        return { programs: r.info.programs?.length ?? 0, linkFailed: failed, samplers };
      });
      const seconds = (Date.now() - t1) / 1000;
      const report = { tier, set, state, slot, gpu, size: [W, H], frames, loadSeconds, seconds, cameras: list.length, ...info, ...audit, ...log, shots };
      await writeFile(join(dir, 'report.json'), JSON.stringify(report, null, 1));
      console.log(`[${set} ${state}] ${list.length} cameras in ${seconds.toFixed(0)} s; ${audit.programs} programs, ${audit.linkFailed.length} link failures, ${log.pageerrors.length} page errors, ${log.shaderErrors.length} shader errors`);
    }
    await page.close();
  }
  if (failed) process.exitCode = 3;
}
await browser.close(); server.close();
