// shoot.mjs plus sun-facing views and a GPU timing mode, for the ?shafts mist (volumetric.js). Same server and cameras.
// usage (inside a GPU job): node shoot_vol.mjs <outDir> <query>
//   CROTON_VIEWS=extra  adds the sun-facing views; each view is shot with the shafts pass on and, if present, off (<view>_off.png)
//   CROTON_FLICKER=n  also saves n consecutive grain-free frames per view (<view>[_off]_f<k>.png)
//   CROTON_PERF=1       times frames with and without the shafts pass at CROTON_W x CROTON_H (default 2560x1440), prints JSON
//   CROTON_PARAMS=density=0.02,g=0.7 (or JSON)  overrides window.__app.baked.shafts.params before shooting; CROTON_ONLY=a,b keeps those views
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';
const [out, query = 'lightmap'] = process.argv.slice(2);
const ROOT = process.env.CROTON_SITE || new URL('../../web', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try { const p = decodeURIComponent(req.url.split('?')[0]); const data = await readFile(join(ROOT, p === '/' ? 'index.html' : p)); res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(data); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;
const PERF = !!process.env.CROTON_PERF;
const W = +(process.env.CROTON_W || (PERF ? 2560 : 1280)), H = +(process.env.CROTON_H || (PERF ? 1440 : 720));
// heading: plan degrees, 0 = north, clockwise; the sunrise sun is at 58 deg, 8 deg up. pitch in radians.
const VIEWS = [
  { name: 'garden', x: 5.6, y: 12.7, h: 198, p: 0.09 },
  { name: 'living', x: 0.3, y: -1.4, h: 0, p: 0 },
];
if (process.env.CROTON_VIEWS === 'extra') VIEWS.push(
  { name: 'garden_sun', x: 5.6, y: 12.7, h: 58, p: 0.12 },
  { name: 'garden_side', x: -4, y: 9.5, h: 100, p: 0.06 },
  { name: 'front_sun', x: 0, y: -9, h: 58, p: 0.12 },
  { name: 'bedroom_window', x: 5.4, y: 3.4, h: 75, p: 0.05 },
  { name: 'dining_out', x: 2.6, y: 3.3, h: 30, p: 0.06 },
);
if (process.env.CROTON_ONLY) { const keep = process.env.CROTON_ONLY.split(','); for (let i = VIEWS.length - 1; i >= 0; i--) if (!keep.includes(VIEWS[i].name)) VIEWS.splice(i, 1); }
const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-vulkan-surface',
  '--disable-gpu-vsync', '--disable-frame-rate-limit', '--enable-webgl-draft-extensions'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { const t = m.text(); if (/lightmaps|error|warn/i.test(m.type() + t) && !/deprecated|sigmaRadians|serialize/.test(t)) console.log('[console]', t.slice(0, 600)); });
await page.goto(`http://127.0.0.1:${port}/index.html?capture&pins=0&pets=0&eye=1.35&x=0&y=0&${query}`, { waitUntil: 'load' });
const gpu = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : gl.RENDERER); });
console.log('renderer', gpu);
if (/SwiftShader|llvmpipe|software/i.test(gpu)) { console.log('software rasteriser: refusing to render'); process.exit(2); }
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
await page.addStyleTag({ content: '#hud, #title, #minimap, #topbar, #crosshair, #label, #toast, #warming { display: none !important; }' });
console.log('baked', JSON.stringify(await page.evaluate(() => window.__app.baked?.stats ?? null)));
console.log('setup', JSON.stringify(await page.evaluate(() => { const A = window.__app, s = A.baked?.shafts, r = A.renderer, b = new A.THREE.Vector2(); r.getDrawingBufferSize(b);
  return { tier: A.state.quality, buffer: [b.x, b.y], msaa: A.lighting.composer.renderTarget1.samples, gtao: A.lighting.gtao.enabled, taa: !!A.lighting.taa, shafts: !!s, params: s?.params, low: s ? [s.current.width, s.current.height] : null }; })));
if (process.env.CROTON_PARAMS) await page.evaluate(p => Object.assign(window.__app.baked.shafts.params, p), process.env.CROTON_PARAMS.startsWith('{') ? JSON.parse(process.env.CROTON_PARAMS) : Object.fromEntries(process.env.CROTON_PARAMS.split(',').map(kv => [kv.split('=')[0], +kv.split('=')[1]])));
const hasShafts = await page.evaluate(() => !!window.__app.baked?.shafts);
const place = v => page.evaluate(v => {
  const A = window.__app; A.player.eyeHeight = 1.35; A.player.eye = 1.35; A.player.teleport(v.x, -v.y, v.h, v.p);
  A.camera.fov = 2 * Math.atan(Math.tan(Math.atan(18 / 22)) * 9 / 16) * 180 / Math.PI; A.camera.updateProjectionMatrix();
}, v);
const settle = (n = 30) => page.evaluate(n => { for (let i = 0; i < n; i++) window.renderAt(window.simTime() + 1 / 30); }, n);
if (!PERF) {
  for (const v of VIEWS) {
    await place(v);
    for (const on of hasShafts ? [true, false] : [true]) {
      await page.evaluate(on => { const s = window.__app.baked?.shafts; if (s) s.enabled = on; }, on);
      await settle();
      await page.screenshot({ path: `${out}/${v.name}${on ? '' : '_off'}.png` });
      // CROTON_FLICKER=n: n more consecutive frames without film grain, for frame-to-frame noise
      if (process.env.CROTON_FLICKER) {
        const g = await page.evaluate(() => { const u = window.__app.lighting.grade.grain, g = u.value; u.value = 0; return g; });
        for (let k = 0; k < +process.env.CROTON_FLICKER; k++) { await settle(1); await page.screenshot({ path: `${out}/${v.name}${on ? '' : '_off'}_f${k}.png` }); }
        await page.evaluate(g => { window.__app.lighting.grade.grain.value = g; }, g);
      }
      console.log('shot', v.name, on ? '' : 'off');
    }
  }
} else {
  // GPU time per frame: one TIME_ELAPSED query around each composer frame if the extension exists; otherwise
  // wall time per frame with a 1-pixel readPixels forcing completion. Interleaved off/on blocks, 150 frames each after 40 warm-up.
  for (const v of VIEWS.slice(0, 3)) {
    await place(v); await settle(10);
    const r = await page.evaluate(async () => {
      const A = window.__app, gl = A.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'), s = A.baked?.shafts;
      const px = new Uint8Array(4);
      const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const passOnly = [];
      // optional per-pass timing (cannot nest with the frame query): wrap the pass render
      const origRender = s ? s.render.bind(s) : null;
      const block = async (on, frames, mode) => {
        if (s) s.enabled = on;
        for (let i = 0; i < 40; i++) window.renderAt(window.simTime() + 1 / 60);
        sync();
        const gpu = [], wall = [], pending = [];
        if (s && mode === 'pass') s.render = (...a) => { const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); try { origRender(...a); } finally { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(q); } };
        for (let i = 0; i < frames; i++) {
          let q = null;
          if (ext && mode === 'frame') { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
          const t0 = performance.now();
          window.renderAt(window.simTime() + 1 / 60);
          if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(q); }
          sync(); wall.push(performance.now() - t0);
        }
        if (s && mode === 'pass') s.render = origRender;
        await new Promise(res => setTimeout(res, 200));
        let disjoint = ext ? gl.getParameter(ext.GPU_DISJOINT_EXT) : false;
        for (const q of pending) { for (let k = 0; k < 50 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await new Promise(res => setTimeout(res, 10));
          if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); }
        return { gpu, wall, disjoint };
      };
      const stat = a => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return { n: a.length, mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3), median: +b[b.length >> 1].toFixed(3), p10: +b[Math.floor(b.length * 0.1)].toFixed(3), p90: +b[Math.floor(b.length * 0.9)].toFixed(3) }; };
      const res = { ext: !!ext, off: { gpu: [], wall: [] }, on: { gpu: [], wall: [] }, pass: [] };
      for (let rep = 0; rep < 8; rep++) for (const on of [false, true]) {
        const b = await block(on, 40, 'frame'); const k = on ? 'on' : 'off'; res[k].gpu.push(...b.gpu); res[k].wall.push(...b.wall); if (b.disjoint) res.disjoint = true;
      }
      if (ext && s) { const b = await block(true, 150, 'pass'); res.pass = b.gpu; }
      // 20 back-to-back pass renders inside one query (the composer's buffers as left by the last frame), 40 times
      if (ext && s) {
        const C = A.lighting.composer, loop = [];
        for (let k = 0; k < 40; k++) {
          window.renderAt(window.simTime() + 1 / 60); sync();
          const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
          const g = A.lighting.gtao, wb = C.renderTarget1.depthTexture === g.depthTexture ? C.renderTarget1 : C.renderTarget2, rb = wb === C.renderTarget1 ? C.renderTarget2 : C.renderTarget1;
          for (let i = 0; i < 20; i++) { s.render(A.renderer, wb, rb); }
          gl.endQuery(ext.TIME_ELAPSED_EXT); sync();
          for (let t = 0; t < 50 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); t++) await new Promise(r => setTimeout(r, 5));
          if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) loop.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 / 20); gl.deleteQuery(q);
        }
        res.loop = loop;
      }
      if (s) s.enabled = true;
      return { ext: res.ext, disjoint: !!res.disjoint, offGpu: stat(res.off.gpu), onGpu: stat(res.on.gpu), offWall: stat(res.off.wall), onWall: stat(res.on.wall), passGpu: stat(res.pass), loopGpu: stat(res.loop ?? []), offMin: Math.min(...res.off.gpu).toFixed(3), onMin: Math.min(...res.on.gpu).toFixed(3) };
    });
    console.log('perf', v.name, JSON.stringify(r));
  }
}
await browser.close(); server.close();
