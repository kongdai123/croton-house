// Slot crossfades as the visitor sees them (auto exposure, local adaptation): from still cameras, every slot change in the
// order N walks (sunrise -> noon -> golden -> dusk -> sunrise), the frame's mean luma through the 1.5 s fade and 3 s after
// it, on a stepped clock (the page's own loop stopped, renderAt only: deterministic). Brightness must move monotonically
// from the settled start to the end, never past either by more than --tol luma levels. Runs on a GPU node (refuses a
// software rasteriser; bake/validate/RENDER_GATE.md). The first exposure-in-stops fade pumped the garden 75 -> 22 -> 90 at
// golden -> dusk (lighting_slots.js fadeExposure).
//   node fade_check.mjs --site <dir> --out <dir> [--cameras cameras.json] [--only patio_1,living_1] [--tier hq] [--size 960x540] [--tol 4]
//     [--query shafts=0] (more page parameters) [--trace] (per frame also the fade's weight, the exposure state and the meter)
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile, writeFile, mkdir, stat } from 'fs/promises';
import { extname, join, resolve } from 'path';

const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const SITE = resolve(opt('--site', process.env.CROTON_SITE || new URL('..', import.meta.url).pathname)), OUT = opt('--out', 'fade_check');
const [W, H] = opt('--size', '960x540').split('x').map(Number), tier = opt('--tier', 'hq'), tol = +opt('--tol', 4);
const extra = opt('--query') ? `&${opt('--query')}` : '', trace = argv.includes('--trace');
const only = (opt('--only') ?? 'patio_1,backGarden_2,frontYard_1,living_1,kitchen_1,primaryBedroom_1').split(',');
const cams = JSON.parse(await readFile(opt('--cameras', new URL('../../bake/validate/cameras.json', import.meta.url).pathname), 'utf8')).cameras.filter(c => only.includes(c.id));
const ORDER = ['sunrise', 'noon', 'golden', 'dusk'];
await mkdir(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html'; if (p.includes('..')) throw 0;
    const file = join(SITE, p); if (!(await stat(file)).isFile()) throw 0;
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-vulkan-surface'] });
const vfov = lens => 2 * Math.atan(18 / lens * 9 / 16) * 180 / Math.PI;
const report = { tier, size: [W, H], tol, cameras: {}, failures: [] };
for (const c of cams) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${port}/index.html?pins=0&pets=0&x=0&y=0&lightmap=${ORDER[0]}&${tier === 'hq' ? 'tier=hq&lmres=full' : `tier=${tier}`}${extra}`, { waitUntil: 'load' });
  const gpu = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : gl.RENDERER); });
  if (/SwiftShader|llvmpipe|software/i.test(gpu)) { console.log('software rasteriser: refusing'); process.exit(2); }
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
  // the page's own loop stopped: only renderAt moves time; each step draws, then the frame's mean luma (ITU-R 601 on the
  // displayed sRGB, as the gate measures) is read from the WebGL canvas in the same task
  await page.evaluate(([c, fov, trace]) => {
    window.requestAnimationFrame = () => 0;
    const A = window.__app; A.player.move = () => {};
    A.player.eyeHeight = c.z; A.player.eye = c.z; A.player.teleport(c.x, -c.y, c.h, c.p); A.camera.fov = fov; A.camera.updateProjectionMatrix();
    const small = document.createElement('canvas'); small.width = 96; small.height = 54; const ctx = small.getContext('2d', { willReadFrequently: true });
    // --trace: the exposure state (2^EV, drive, local reference, its drive) and the meter (raw, previous, filtered, held), 1x1
    const T = A.THREE, read = t => {
      const half = t.texture.type === T.HalfFloatType, b = half ? new Uint16Array(4) : new Float32Array(4);
      A.renderer.readRenderTargetPixels(t, 0, 0, 1, 1, b); return [...b].map(v => +(half ? T.DataUtils.fromHalfFloat(v) : v).toFixed(4));
    };
    window.__trace = [];
    // the frame is read in the task that drew it (the drawing buffer is not preserved): its luma, and the last one as a JPEG
    window.__shot = null;
    window.__luma = (n, shot = false) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        window.renderAt(window.simTime() + 1 / 30);
        ctx.drawImage(A.renderer.domElement, 0, 0, 96, 54); const d = ctx.getImageData(0, 0, 96, 54).data; let s = 0;
        for (let k = 0; k < d.length; k += 4) s += 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2];
        out.push(+(s / (d.length / 4)).toFixed(2));
        if (trace) {
          const ae = A.lighting.autoExposure?.debugTargets, f = A.baked.slots?.fading, p = A.baked.slots?.params;
          const e = ae ? read(ae.exposure) : null, m = ae ? read(ae.meter) : null;
          window.__trace.push({ luma: out.at(-1), w: f ? +f.t.toFixed(4) : null, s: f ? +f.progress.toFixed(4) : null, bases: f?.bases?.map(v => +v.toFixed(3)) ?? null,
            ev: e ? +Math.log2(Math.max(e[0], 1e-5)).toFixed(3) : null, drive: e?.[1], ref: e?.[2], lock: p ? +(p.ev + (p.autoExposure.outdoor ?? 0)).toFixed(3) : null,
            slotEv: p ? +p.ev.toFixed(3) : null, key: p ? +p.autoExposure.key.toFixed(3) : null, meter: m, indoor: +A.lighting.indoorWeight(A.camera.position).toFixed(3) });
        }
      }
      if (shot) window.__shot = A.renderer.domElement.toDataURL('image/jpeg', 0.9);
      return out;
    };
  }, [c, vfov(c.lens ?? 22), trace]);
  await page.evaluate(() => window.__luma(150));   // settled at the first slot
  const series = {};
  for (let k = 0; k < ORDER.length; k++) {
    const from = ORDER[k], to = ORDER[(k + 1) % ORDER.length];
    if (trace) await page.evaluate(() => { window.__trace = []; });   // the trace: the 10 frames before the fade, then the run
    const before = await page.evaluate(() => window.__luma(10));
    // the fade starts once the slot is staged (downloads, in real time); it then runs on the stepped clock
    const started = await page.evaluate(async n => {
      window.__fading = false; window.__app.baked.setSlot(n, (f, d) => { if (d?.phase === 'transition') window.__fading = true; });
      for (let i = 0; i < 2400 && !window.__fading; i++) await new Promise(r => setTimeout(r, 50));
      return window.__fading;
    }, to);
    if (!started) { report.failures.push(`${c.id} ${from} -> ${to}: the fade never started`); continue; }
    const shots = [];
    const run = [];
    for (const [n, tag] of [[1, 'start'], [22, 'mid'], [22, 'end'], [45, 'after'], [45, 'settled']]) {
      run.push(...await page.evaluate(n => window.__luma(n, true), n));
      const jpeg = await page.evaluate(() => window.__shot);
      shots.push(writeFile(join(OUT, `${c.id}_${from}-${to}_${tag}.jpg`), Buffer.from(jpeg.split(',')[1], 'base64')));
    }
    await Promise.all(shots);
    const s0 = before.at(-1), s1 = run.at(-1), lo = Math.min(s0, s1) - tol, hi = Math.max(s0, s1) + tol, dir = Math.sign(s1 - s0);
    let back = 0; for (let i = 1; i < run.length; i++) back = Math.max(back, dir * (run[i - 1] - run[i]));
    const min = Math.min(...run), max = Math.max(...run), ok = min >= lo && max <= hi && (dir === 0 || back <= tol) && Math.min(s0, s1) > 2;   // a black picture (a NaN in the exposure) fails too
    series[`${from}-${to}`] = { start: s0, end: s1, min, max, back: +back.toFixed(2), ok, luma: run, ...(trace ? { trace: await page.evaluate(() => window.__trace) } : {}) };
    console.log(`${c.id} ${from} -> ${to}: ${s0} -> ${s1}, min ${min} max ${max}, turns back ${back.toFixed(1)}: ${ok ? 'ok' : 'FAIL'}`);
    if (!ok) report.failures.push(`${c.id} ${from} -> ${to}: ${s0} -> ${s1}, min ${min} max ${max}, turns back ${back.toFixed(1)}`);
  }
  report.cameras[c.id] = series;
  await page.close();
}
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 1));
console.log(report.failures.length ? `${report.failures.length} fades fail` : 'every fade monotonic');
await browser.close(); server.close();
process.exitCode = report.failures.length ? 1 : 0;
