// Demo film recorder: serves a built site folder, opens it in headless Chromium on a GPU, runs choreography.js through the
// site's demonstration and steps the app frame by frame with renderAt (30 fps), writing numbered JPEGs.
// The page is the visitor's page (no ?capture): auto exposure and local adaptation stay on; its own frame loop is stopped
// once it is ready, so the clock moves only through renderAt (bake/validate/shoot.mjs --visitor does the same).
//   node record.mjs --site <dir> --out <framesDir> [--lang zh|en] [--every N] [--size 1920x1080] [--query 'tier=hq&lmres=full']
// --every N keeps one frame in N (a quick preview of the whole film: compositions, timings, captions).
// Writes <out>/f00000.jpg ..., <out>/meta.json (fps, frames, step captions with their times, holds, errors).
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { extname, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const ROOT = opt('--site'), OUT = opt('--out'), LANG = opt('--lang', 'zh'), EVERY = +opt('--every', 1);
const [W, H] = opt('--size', '1920x1080').split('x').map(Number);
const QUERY = opt('--query', 'tier=hq&lmres=full');
const FPS = 30, MAX_SECONDS = +opt('--max', 400);
if (!ROOT || !OUT) { console.log('usage: node record.mjs --site <dir> --out <dir> [--lang zh|en] [--every N]'); process.exit(1); }
await mkdir(OUT, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.m4a': 'audio/mp4', '.woff2': 'font/woff2', '.hdr': 'application/octet-stream' };
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
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await ctx.addInitScript((lang) => {
  localStorage.setItem('croton-lang', lang); localStorage.setItem('croton-music', '0');
  Element.prototype.requestPointerLock = function () { return Promise.resolve(); };
}, LANG);
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
const info = await page.evaluate(() => { const A = window.__app; return { tier: A.state.tier, quality: A.state.quality, slot: A.state.bakedSlot, slots: A.state.bakedSlots, baked: A.state.baked, fallback: A.state.bakedFallback ?? null, autoExposure: !!A.lighting.autoExposure }; });
console.log('loaded in', ((Date.now() - t0) / 1000).toFixed(0), 's', JSON.stringify(info));
await page.addScriptTag({ path: join(dirname(fileURLToPath(import.meta.url)), 'choreography.js') });
// settle the exposure on the opening view before the first frame is kept
await page.evaluate(() => { const A = window.__app; A.player.teleport(4, 13.6, 340, -0.42); A.player.eye = 6; for (let i = 0; i < 90; i++) window.renderAt(window.simTime() + 1 / 30); });
await page.evaluate(() => window.__video.start());

const steps = [], holds = {};
let frame = 0, lastStep = '', tHold = 0;
const tStart = Date.now();
for (;;) {
  const s = await page.evaluate(() => {
    const V = window.__video, hold = V.hold();
    if (!hold) window.renderAt(window.simTime() + 1 / 30);
    const bar = document.getElementById('demobar');
    return { hold, done: V.done, error: V.error, step: bar.classList.contains('hidden') ? '' : bar.querySelector('.db-text').textContent };
  });
  if (s.error) { console.log('choreography error', s.error); errors.push(s.error); }
  if (s.hold) {
    holds[s.hold] = (holds[s.hold] ?? 0) + 1;
    if (!tHold) tHold = Date.now();
    if (Date.now() - tHold > 90000) { console.log('hold', s.hold, 'did not clear in 90 s; stepping on'); await page.evaluate(() => window.renderAt(window.simTime() + 1 / 30)); }
    else { await new Promise(r => setTimeout(r, 100)); continue; }
  }
  tHold = 0;
  if (s.done) break;
  if (s.step !== lastStep) { steps.push({ t: +(frame / FPS).toFixed(2), frame, text: s.step }); lastStep = s.step; console.log(`${(frame / FPS).toFixed(1)} s  ${s.step}`); }
  if (frame % EVERY === 0) await page.screenshot({ path: join(OUT, `f${String(frame).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 95 });
  frame++;
  if (frame % 300 === 0) console.log(`frame ${frame} (${(frame / FPS).toFixed(0)} s of film) in ${((Date.now() - tStart) / 1000).toFixed(0)} s`);
  if (frame > MAX_SECONDS * FPS) { console.log('film longer than', MAX_SECONDS, 's: stopping'); break; }
}
await writeFile(join(OUT, 'meta.json'), JSON.stringify({ fps: FPS, frames: frame, every: EVERY, size: [W, H], lang: LANG, query: QUERY, gpu, info, steps, holds, errors }, null, 1));
console.log('done', frame, 'frames', (frame / FPS).toFixed(1), 's of film in', ((Date.now() - tStart) / 1000).toFixed(0), 's; errors', errors.length);
await browser.close(); server.close();
