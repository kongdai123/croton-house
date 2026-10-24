// Demo film recorder: serves a built site folder, opens it in headless Chromium on a GPU, runs a choreography in the page
// and steps the app frame by frame with renderAt, writing numbered JPEGs.
// The page is the visitor's page (no ?capture): auto exposure and local adaptation stay on; its own frame loop is stopped
// once it is ready, so the clock moves only through renderAt (bake/validate/shoot.mjs --visitor does the same).
//   node record.mjs --site <dir> --out <framesDir> [--script choreography.js|twitter.js] [--lang zh|en] [--fps 30]
//                   [--every N] [--size 1920x1080] [--dsf 1] [--clean] [--shots a,b] [--stills poses.json]
//                   [--query 'tier=hq&lmres=full'] [--max seconds] [--tour-slot noon|sunrise|golden] [--no-hearts]
//                   [--png-frames n,n] [--wall-clock]
// --every N keeps one frame in N (a quick preview of the whole film: compositions, timings).
// --clean hides the site's interface (top bar, plan, crosshair, labels, captions, cursor) with film-only CSS.
// --dsf 2 renders the page at a device scale factor of 2 (the site caps its drawing buffer at 2560 x 1440) and keeps
//   CSS-pixel screenshots, so every frame is supersampled.
// --png-frames 30,1290 also writes those kept frames as lossless PNG (p00030.png ...), for posters.
// The page's performance.now() follows the frame clock once it is ready (each renderAt(t) draws at the base time + t):
// render-path code that reads the wall clock (TAA's stall reset, the puddles' ripples) would otherwise see the
// recorder's own pace, 100-300 ms a frame with a screenshot, and drop TAA's history on every kept frame. --wall-clock
// turns this off.
// Two choreography protocols:
//   - choreography.js (the 2:50 demo film): an async script on the demonstration's frame clock; the recorder steps
//     renderAt until it is done.
//   - twitter.js (window.__video.timeline): the recorder calls __video.step(dt) once per frame; a step returns whether the
//     frame is kept (pre-roll frames are drawn, not kept). --shots a,b records only those shots; --stills poses.json
//     renders one kept frame per pose ({name, slot, x, y, eye, h, pitch, fov, doors, pets}).
// Writes <out>/f00000.jpg ..., <out>/meta.json (fps, frames, steps or shots with their times, holds, errors).
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { extname, join, dirname, isAbsolute } from 'path';
import { fileURLToPath } from 'url';

const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const flag = (k) => argv.includes(k);
const ROOT = opt('--site'), OUT = opt('--out'), LANG = opt('--lang', 'zh'), EVERY = +opt('--every', 1);
const [W, H] = opt('--size', '1920x1080').split('x').map(Number);
const QUERY = opt('--query', 'tier=hq&lmres=full');
const FPS = +opt('--fps', 30), MAX_SECONDS = +opt('--max', 400), DSF = +opt('--dsf', 1), CLEAN = flag('--clean');
const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = opt('--script', 'choreography.js'), SCRIPT_PATH = isAbsolute(SCRIPT) ? SCRIPT : join(HERE, SCRIPT);
const SHOTS = opt('--shots') ? opt('--shots').split(',') : null;
const STILLS = opt('--stills') ? JSON.parse(await readFile(opt('--stills'), 'utf8')) : null;
const PNG_FRAMES = new Set((opt('--png-frames') || '').split(',').filter(Boolean).map(Number));
if (!ROOT || !OUT) { console.log('usage: node record.mjs --site <dir> --out <dir> [--script twitter.js] [--fps 60] [--every N] [--clean]'); process.exit(1); }
await mkdir(OUT, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.m4a': 'audio/mp4', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.hdr': 'application/octet-stream' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const data = await readFile(join(ROOT, p === '/' ? 'index.html' : p));
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream', 'Content-Length': data.length }); res.end(data);
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;

// Linux headless GPU: ANGLE on Vulkan (web/tools/smoke/session.mjs LINUX_GPU)
const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--disable-vulkan-surface', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF });
await ctx.addInitScript(({ lang, options }) => {
  localStorage.setItem('croton-lang', lang); localStorage.setItem('croton-music', '0');
  Element.prototype.requestPointerLock = function () { return Promise.resolve(); };
  window.__videoOptions = options;
  // the frame clock as performance.now() (see the header); the real clock until the recorder sets a time
  const realNow = performance.now.bind(performance); let virtualNow = null;
  performance.now = () => virtualNow ?? realNow();
  window.__filmClock = (ms) => { virtualNow = ms; };
}, { lang: LANG, options: { fps: FPS, shots: SHOTS, stills: STILLS, hearts: !flag('--no-hearts'), tourSlot: opt('--tour-slot') } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(String(e.message)); console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error' || (m.type() === 'warning' && /demo|video/i.test(m.text()))) console.log(`[${m.type()}]`, m.text().slice(0, 300)); });
page.on('response', r => { if (r.status() >= 400) console.log('[http]', r.status(), r.url().replace(/^https?:\/\/[^/]+/, '')); });
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${port}/index.html?auto=1&petseed=3&${QUERY}`, { waitUntil: 'load', timeout: 300000 });
const gpu = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : gl.RENDERER); });
console.log('renderer', gpu);
if (/SwiftShader|llvmpipe|software/i.test(gpu)) { console.log('software rasteriser: refusing to record'); process.exit(2); }
await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
await page.evaluate(() => document.fonts.ready);
// stop the app's own frame loop: its next requestAnimationFrame is its last
await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
await new Promise(r => setTimeout(r, 1500));
const info = await page.evaluate(() => { const A = window.__app; return { tier: A.state.tier, quality: A.state.quality, slot: A.state.bakedSlot, slots: A.state.bakedSlots, baked: A.state.baked, fallback: A.state.bakedFallback ?? null, autoExposure: !!A.lighting.autoExposure, taa: !!A.lighting.taa, pixelRatio: A.renderer.getPixelRatio() }; });
console.log('loaded in', ((Date.now() - t0) / 1000).toFixed(0), 's', JSON.stringify(info));
if (!flag('--wall-clock')) await page.evaluate(() => {
  const base = performance.now() - window.simTime() * 1000, renderAt = window.renderAt;
  window.renderAt = (t) => { window.__filmClock(base + t * 1000); renderAt(t); };
});
// QA: count TAA history resets (a reset frame is a single jittered sample, aliased); a kept frame should only have one
// at a cut, never inside a shot
await page.evaluate(() => {
  const taa = window.__app.lighting.taa; window.__taaResets = 0;
  if (taa) { const reset = taa.reset.bind(taa); taa.reset = () => { window.__taaResets++; reset(); }; }
});
// film-only: no interface on screen (the site's HUD, landing and warm-up screens, the cursor); the choreography's own
// title layer (#film) stays
if (CLEAN) await page.addStyleTag({ content: 'body > :not(#gl):not(#film) { display:none !important } *, *::before, *::after { cursor:none !important }' });
await page.addScriptTag({ path: SCRIPT_PATH });
const timeline = await page.evaluate(() => !!window.__video?.timeline);
const shot = async (frame) => {
  await page.screenshot({ path: join(OUT, `f${String(frame).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 95, scale: 'css' });
  if (PNG_FRAMES.has(frame)) await page.screenshot({ path: join(OUT, `p${String(frame).padStart(5, '0')}.png`), type: 'png', scale: 'css' });
};

const steps = [], holds = {}, taaResetsKept = [];
let frame = 0, tHold = 0, drawn = 0;
const tStart = Date.now();
const waitHold = async (hold) => {
  holds[hold] = (holds[hold] ?? 0) + 1;
  if (!tHold) tHold = Date.now();
  if (Date.now() - tHold > 90000) { console.log('hold', hold, 'did not clear in 90 s; stepping on'); errors.push(`hold ${hold} timed out`); tHold = 0; return false; }
  await new Promise(r => setTimeout(r, 100)); return true;
};

if (timeline) {
  // ---- twitter.js: the choreography decides per frame whether the frame is kept ----
  await page.evaluate(() => window.__video.start());
  let lastShot = '', force = false;
  for (;;) {
    const s = await page.evaluate(({ dt, force }) => {
      const V = window.__video, hold = force ? '' : V.hold();
      if (hold) return { hold };
      const r = V.step(dt);
      if (r.done) return r;
      const before = window.__taaResets;
      window.renderAt(window.simTime() + dt);
      return { ...r, taaReset: window.__taaResets > before };
    }, { dt: 1 / FPS, force });
    force = false;
    if (s.hold) { if (!(await waitHold(s.hold))) force = true; continue; }
    tHold = 0;
    if (s.error) { console.log('choreography error', s.error); errors.push(s.error); }
    if (s.done) break;
    drawn++;
    if (!s.save) continue;
    if (s.shot !== lastShot) { steps.push({ t: +(frame / FPS).toFixed(3), frame, shot: s.shot }); lastShot = s.shot; console.log(`${(frame / FPS).toFixed(2)} s  shot ${s.shot}`); }
    if (s.taaReset) taaResetsKept.push(frame);
    if (frame % EVERY === 0) await shot(frame);
    frame++;
    if (frame % (10 * FPS) === 0) console.log(`frame ${frame} (${(frame / FPS).toFixed(0)} s of film, ${drawn} drawn) in ${((Date.now() - tStart) / 1000).toFixed(0)} s`);
    if (frame > MAX_SECONDS * FPS) { console.log('film longer than', MAX_SECONDS, 's: stopping'); break; }
  }
  const { log, warn } = await page.evaluate(() => ({ log: window.__video.log, warn: window.__video.warn }));
  if (log.length) console.log('choreography log', log);
  if (warn.length) { console.log('choreography warnings', warn); errors.push(...warn); }
} else {
  // ---- choreography.js: the demonstration's async script on the frame clock ----
  // settle the exposure on the opening view before the first frame is kept
  await page.evaluate((fps) => { const A = window.__app; A.player.teleport(4, 13.6, 340, -0.42); A.player.eye = 6; for (let i = 0; i < 3 * fps; i++) window.renderAt(window.simTime() + 1 / fps); }, FPS);
  await page.evaluate(() => window.__video.start());
  let lastStep = '';
  for (;;) {
    const s = await page.evaluate((dt) => {
      const V = window.__video, hold = V.hold();
      if (!hold) window.renderAt(window.simTime() + dt);
      const bar = document.getElementById('demobar');
      return { hold, done: V.done, error: V.error, step: bar.classList.contains('hidden') ? '' : bar.querySelector('.db-text').textContent };
    }, 1 / FPS);
    if (s.error) { console.log('choreography error', s.error); errors.push(s.error); }
    if (s.hold) {
      if (await waitHold(s.hold)) continue;
      await page.evaluate((dt) => window.renderAt(window.simTime() + dt), 1 / FPS);   // timed out: step on
    }
    tHold = 0;
    if (s.done) break;
    if (s.step !== lastStep) { steps.push({ t: +(frame / FPS).toFixed(2), frame, text: s.step }); lastStep = s.step; console.log(`${(frame / FPS).toFixed(1)} s  ${s.step}`); }
    if (frame % EVERY === 0) await shot(frame);
    frame++;
    if (frame % 300 === 0) console.log(`frame ${frame} (${(frame / FPS).toFixed(0)} s of film) in ${((Date.now() - tStart) / 1000).toFixed(0)} s`);
    if (frame > MAX_SECONDS * FPS) { console.log('film longer than', MAX_SECONDS, 's: stopping'); break; }
  }
}
await writeFile(join(OUT, 'meta.json'), JSON.stringify({ fps: FPS, frames: frame, every: EVERY, size: [W, H], dsf: DSF, lang: LANG, query: QUERY, script: SCRIPT, shots: SHOTS, stills: STILLS?.map(s => s.name), gpu, info, steps, holds, taaResetsKept, errors }, null, 1));
if (taaResetsKept.length) console.log('TAA history reset on kept frames', taaResetsKept.slice(0, 40).join(' '), taaResetsKept.length > 40 ? '...' : '');
console.log('done', frame, 'frames', (frame / FPS).toFixed(1), 's of film in', ((Date.now() - tStart) / 1000).toFixed(0), 's; errors', errors.length);
await browser.close(); server.close();
