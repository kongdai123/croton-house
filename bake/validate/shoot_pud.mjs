// shoot.mjs plus low puddle views and a timing mode for ?puddlerefl (puddles.js). Same server and camera.
// usage (inside a GPU job): node shoot_pud.mjs <outDir> <query>
//   CROTON_VIEWS='[{"name":..,"x":..,"y":..,"h":..,"p":..,"e":1.6}]'  replaces the extra views (garden/living always shot)
//   CROTON_MODE=discover  prints puddle sample clusters instead of shooting
//   CROTON_PERF=1  GPU frame time over 200 frames after warm-up at CROTON_W x CROTON_H (2560x1440), per view
//   CROTON_HZ=n    overrides the reflection update rate
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
const PERF = !!process.env.CROTON_PERF, MODE = process.env.CROTON_MODE || 'shoot';
const W = +(process.env.CROTON_W || (PERF ? 2560 : 1280)), H = +(process.env.CROTON_H || (PERF ? 1440 : 720));
const VIEWS = PERF ? [] : [{ name: 'garden', x: 5.6, y: 12.7, h: 198, p: 0.09 }, { name: 'living', x: 0.3, y: -1.4, h: 0, p: 0 }];
if (process.env.CROTON_VIEWS) VIEWS.push(...JSON.parse(process.env.CROTON_VIEWS));
const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-vulkan-surface',
  '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
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
if (process.env.CROTON_PARAMS) await page.evaluate(o => { const p = window.__app.baked?.puddleRefl; if (p) Object.assign(p.params, o); }, JSON.parse(process.env.CROTON_PARAMS));
if (process.env.CROTON_BUDGET) { const [t, d] = process.env.CROTON_BUDGET.split('x').map(Number); await page.evaluate(([t, d]) => Object.assign(window.__app.baked.puddleRefl.params, { maxTriangles: t, maxDraws: d }), [t, d]); }
if (process.env.CROTON_HZ) await page.evaluate(hz => { const p = window.__app.baked?.puddleRefl; if (p) p.params.hz = hz; }, +process.env.CROTON_HZ);
const place = v => page.evaluate(v => {
  const A = window.__app, e = v.e ?? 1.35; A.player.eyeHeight = e; A.player.eye = e; A.player.teleport(v.x, -v.y, v.h, v.p);
  A.camera.fov = 2 * Math.atan(Math.tan(Math.atan(18 / 22)) * 9 / 16) * 180 / Math.PI; A.camera.updateProjectionMatrix();
}, v);
const settle = (n = 30) => page.evaluate(n => { for (let i = 0; i < n; i++) window.renderAt(window.simTime() + 1 / 30); }, n);
const pstats = () => page.evaluate(() => { const p = window.__app.baked?.puddleRefl; return p ? { ...p.stats } : null; });
if (MODE === 'discover') {
  const r = await page.evaluate(() => {
    const p = window.__app.baked?.puddleRefl; if (!p) return null;
    const cells = new Map();
    for (const s of p.samples) { const k = `${Math.round(s.point.x)},${Math.round(-s.point.z)},${s.height}`; const c = cells.get(k) ?? { n: 0, names: new Set() }; c.n++; c.names.add(s.source.name || s.source.parent?.name || '?'); cells.set(k, c); }
    return [...cells].map(([k, c]) => `${k} n=${c.n} ${[...c.names].slice(0, 3).join('|')}`);
  });
  console.log('samples', r?.length); for (const l of r ?? []) console.log(l);
} else if (!PERF) {
  for (const v of VIEWS) {
    await place(v); await settle(); await page.screenshot({ path: `${out}/${v.name}.png` }); console.log('shot', v.name, JSON.stringify(await pstats()));
    if (process.env.CROTON_AUDIT) console.log('audit', v.name, JSON.stringify(await page.evaluate(() => {
      const A = window.__app, p = A.baked?.puddleRefl; if (!p) return null;
      const T = A.THREE, src = new Set(p.sources.map(e => e.source)), s = new T.Sphere(), out = { excluded: [], chosen: [], dropped: [] };
      const vis = o => { for (let q = o; q; q = q.parent) if (!q.visible && !(q.name === 'frozen' && q.userData.batch)) return false; return true; };
      A.scene.traverse(o => { if (!o.isMesh || src.has(o) || !vis(o)) return; if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); s.copy(o.boundingSphere ?? o.geometry.boundingSphere).applyMatrix4(o.matrixWorld);
        if (s.radius < 1.5) return; const ms = [].concat(o.material);
        out.excluded.push([o.name || o.parent?.name, +s.radius.toFixed(1), ms.map(m => (m?.name || '') + (m?.transparent ? ':T' + m.opacity : '') + (m?.transmission ? ':X' : '') + (m?.isShaderMaterial ? ':S' : '')).slice(0, 4).join(','), o.userData.batched ? 'batched' : '', (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 | 0]); });
      for (const e of p.candidates) (e.proxy.visible ? out.chosen : out.dropped).push([e.source.name || e.source.parent?.name, Math.round(e.score), e.triangles * (e.source.isInstancedMesh ? e.source.count : 1), +e.sphere.radius.toFixed(1), 'AP I'[e.tier]]);
      out.total = p.candidates.reduce((t, e) => t + e.triangles * (e.source.isInstancedMesh ? e.source.count : 1), 0); out.n = p.candidates.length; out.tiers = [0, 1, 2].map(t => { const c = p.candidates.filter(e => e.tier === t), tri = e => e.triangles * (e.source.isInstancedMesh ? e.source.count : 1); return { n: c.length, tris: c.reduce((s, e) => s + tri(e), 0), chosen: c.filter(e => e.proxy.visible).length, chosenTris: c.filter(e => e.proxy.visible).reduce((s, e) => s + tri(e), 0) }; }); out.excluded.sort((a, b) => b[1] - a[1]); out.excluded = out.excluded.slice(0, 40); out.chosen = out.chosen.slice(0, 40); out.dropped = out.dropped.slice(0, 40); return out; })));
    if (process.env.CROTON_RT && await page.evaluate(() => !!window.__app.baked?.puddleRefl)) {
      // the reflection target itself, x/(1+x) and sRGB, drawn over the canvas (alpha 0 = magenta)
      await page.evaluate(() => {
        const A = window.__app, T = A.THREE, r = A.renderer, p = A.baked.puddleRefl;
        const m = new T.ShaderMaterial({ uniforms: { t: { value: p.target.texture } }, depthTest: false, depthWrite: false,
          vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
          fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main() { vec4 c = texture2D( t, vUv ); vec3 x = c.rgb / ( 1.0 + c.rgb ); x = pow( x, vec3( 1.0 / 2.2 ) ); gl_FragColor = vec4( c.a < 0.5 ? vec3( 1.0, 0.0, 1.0 ) : x, 1.0 ); }' });
        const s = new T.Scene(), q = new T.Mesh(new T.PlaneGeometry(2, 2), m); q.frustumCulled = false; s.add(q);
        const tone = r.toneMapping; r.toneMapping = T.NoToneMapping; r.setRenderTarget(null); r.render(s, new T.OrthographicCamera()); r.toneMapping = tone;
      });
      await page.screenshot({ path: `${out}/${v.name}_rt.png` });
    }
  }
} else {
  const views = JSON.parse(process.env.CROTON_VIEWS);
  for (const v of views) {
    await place(v); await settle(10);
    const r = await page.evaluate(async () => {
      const A = window.__app, gl = A.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'), px = new Uint8Array(4), p = A.baked?.puddleRefl;
      const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const step = () => window.renderAt(window.simTime() + 1 / 60);
      const collect = async pending => { await new Promise(res => setTimeout(res, 300)); const out = [];
        for (const q of pending) { for (let k = 0; k < 50 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await new Promise(res => setTimeout(res, 10));
          if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) out.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); } return out; };
      // CPU time in the scene hook (visibility + culling + submitting the reflection), wall clock
      let cpu = 0; const hook = A.scene.onBeforeRender; A.scene.onBeforeRender = function (...a) { const t = performance.now(); hook.apply(this, a); cpu += performance.now() - t; };
      const frames = async (on, n) => { if (p) p.params.enabled = on; for (let i = 0; i < 20; i++) step(); sync(); cpu = 0;
        const pending = []; for (let i = 0; i < n; i++) { const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); step(); gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(q); sync(); }
        return { gpu: await collect(pending), cpu: cpu / n }; };
      for (let i = 0; i < 60; i++) step(); sync();
      const res = { off: [], on: [], cpuOff: 0, cpuOn: 0 };
      for (let rep = 0; rep < 2; rep++) for (const on of [false, true]) { const b = await frames(on, 100); res[on ? 'on' : 'off'].push(...b.gpu); res[on ? 'cpuOn' : 'cpuOff'] += b.cpu / 2; }
      // the reflection render alone (no frame query open), every frame
      let pass = [], passCpu = 0;
      if (p) { p.params.enabled = true; const orig = A.renderer.render, pending = [];
        A.renderer.render = function (s, c) { if (!c.userData.puddleReflection) return orig.call(this, s, c); const q = gl.createQuery(), t = performance.now(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); try { return orig.call(this, s, c); } finally { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(q); passCpu += performance.now() - t; } };
        for (let i = 0; i < 100; i++) { step(); sync(); }
        A.renderer.render = orig; pass = await collect(pending); passCpu /= 100; }
      A.scene.onBeforeRender = hook;
      const stat = a => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return { n: a.length, mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3), median: +b[b.length >> 1].toFixed(3), p90: +b[Math.floor(b.length * 0.9)].toFixed(3) }; };
      const b = new A.THREE.Vector2(); A.renderer.getDrawingBufferSize(b);
      return { buffer: [b.x, b.y], disjoint: gl.getParameter(ext.GPU_DISJOINT_EXT), off: stat(res.off), on: stat(res.on), pass: stat(pass), cpuOffMs: +res.cpuOff.toFixed(3), cpuOnMs: +res.cpuOn.toFixed(3), passCpuMs: +passCpu.toFixed(3), puddle: p ? { ...p.stats } : null };
    });
    console.log('perf', v.name, JSON.stringify(r));
  }
}
await browser.close(); server.close();
