// Temporal flicker check (shimmer and pops): shots of the Twitter cut (twitter.js) stepped on the frame clock as record.mjs
// steps them (60 fps, renderAt, the page's own loop stopped, performance.now() on the frame clock), each kept frame read
// back in the page and measured there; no screenshots, so a variant costs about its page load plus one draw per frame.
// Deterministic: two runs of a build agree exactly. (Variants whose frames take different wall-clock time can still see
// the pets take other paths: work the page does in idle time lands on other frames.)
// The metric is scratch flicker.py's on the film: per pixel of a 480 x 270 luma image (area mean of the canvas, 8-bit
// levels, rounded), the alternating change sqrt(max(0, -d_t * d_t+1)) between consecutive frames (up then down, or down
// then up; smooth camera motion does not alternate), changes under 2 levels ignored; per frame its mean and 99.5th
// percentile. Also per shot the full-resolution detail (mean |Laplacian| of the luma), so a setting that buys calm with
// blur shows. The film's levels were limited-range video luma after compression: the same moves read ~15 % higher here.
//   node flicker_check.mjs --site <dir> --out <dir> [--shots aerial,enter,dog] [--variants 'base=;nosharp=taaset=sharpen:0']
//        [--size 1920x1080] [--query 'tier=hq&lmres=full'] [--limit aerial=0.5,dog=0.6] [--png dog:60,aerial:120]
// --variants: name=extra query, ';'-separated; each variant gets a fresh page (the same seed, the same steps).
// --limit shot=mean,...: the largest mean flicker allowed per shot (any variant); exit 1 above it, or on a TAA reset
//   inside a shot. The regression check: bake/validate/RENDER_GATE.md (the flicker check) has the shots and limits.
// --png shot:frame: that kept frame of the shot as a lossless PNG, for crops.
// Pops (a region that changes for one frame and changes back: a shadow that drops out, a mesh that blinks): per frame the
// largest mean of the alternating change over a 30 x 30 block of the 480 x 270 image; a frame above --pop levels (default
// 12) is listed with its block. --pops-limit shot=n,...: exit 1 with more than n pop frames in the shot (a bare n: every
// shot). Fine detail strobing under a fast camera reaches it too (the aerial's ferns): a limit is for shots without that.
// --shutter n: a 180-degree shutter: each 1/60 s frame drawn as 2n steps of the clock, the second n averaged (motion blur
//   as a film camera records it; what the strobing of fine detail under camera motion owes to the frame rate).
//   --angle 360: the shutter open the whole frame (n steps, all averaged).
// A variant's freeze=shot:frame stops the shot's clock after that kept frame (the choreography and the slot crossfade hold;
//   the page keeps drawing, so TAA settles) and writes <variant>_<shot>_<frame>_moving.png and _frozen.png (45 frames on),
//   then ends the variant: the moving frame against a still of the same state. Reported: the share of pixels whose luma
//   differs by more than 32 levels (a caster missing from one of them, or a stale shadow map, shows as a region;
//   TAA's settling and the exposure stay well under that).
// A variant's still=1 holds every shot's camera at its middle pose (time, wind and pets go on: what flickers without camera
//   motion); calm=1 stops the scene's own animation (plant sway, the garden wind; the camera moves as in the film).
// --trace 'js expression': evaluated in the page after every kept frame's draw, kept per frame (e.g. the sun-shadow
// cache's counters: 'JSON.stringify(__app.baked.sunShadow.stats)').
// Writes <out>/flicker.json (per variant and shot: frames, mean, p99.5, worst frame, detail, per-frame scores, TAA resets
// on kept frames) and <out>/<variant>_<shot>_heat.png (the shot's middle frame | the mean flicker over the shot in red,
// 8 levels = full red, the same scale in every image).
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { extname, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const ROOT = opt('--site'), OUT = opt('--out');
const [W, H] = opt('--size', '1920x1080').split('x').map(Number);
const QUERY = opt('--query', 'tier=hq&lmres=full'), FPS = 60;
const SHOTS = opt('--shots', 'aerial,enter,dog').split(',');
// a variant's query may carry shutter=n (this tool's --shutter for that variant; not passed to the page)
const SHUTTER = +opt('--shutter', 0), ANGLE = +opt('--angle', 180);
const VARIANTS = opt('--variants', 'base=').split(';').filter(Boolean).map(v => {
  const i = v.indexOf('='), name = i < 0 ? v : v.slice(0, i), q = new URLSearchParams(i < 0 ? '' : v.slice(i + 1));
  const shutter = q.has('shutter') ? +q.get('shutter') : null, angle = q.has('angle') ? +q.get('angle') : null; q.delete('shutter'); q.delete('angle');
  const freeze = q.has('freeze') ? { shot: q.get('freeze').split(':')[0], frame: +q.get('freeze').split(':')[1] } : null; q.delete('freeze');
  const still = q.get('still') === '1', calm = q.get('calm') === '1'; q.delete('still'); q.delete('calm');
  return { name, query: q.toString().replace(/%3A/gi, ':').replace(/%2C/gi, ','), shutter, angle, freeze, still, calm };
});
const LIMIT = Object.fromEntries((opt('--limit') || '').split(',').filter(Boolean).map(kv => kv.split('=')).map(([k, v]) => [k, +v]));
// --trace shadow: the sun-shadow cache's map version and counters, and the sun's position
const TRACES = { shadow: 'JSON.stringify((({ sunShadow: c }, sun) => [c.version, c.stats.refreshes, c.stats.staticRenders, c.stats.partialRenders, c.stats.hot, c.stats.tracked, sun.position.toArray().map(v => +v.toFixed(3))])(__app.baked, __app.lighting.sun))' };
const POP = +opt('--pop', 12), TRACE = TRACES[opt('--trace')] ?? opt('--trace');
const POPS_LIMIT = (opt('--pops-limit') ?? '').split(',').filter(Boolean).reduce((m, kv) => { const [k, v] = kv.includes('=') ? kv.split('=') : ['*', kv]; m[k] = +v; return m; }, {});
const PNGS = (opt('--png') || '').split(',').filter(Boolean).map(s => s.split(':')).map(([shot, f]) => `${shot}:${+f}`);
if (!ROOT || !OUT) { console.log('usage: node flicker_check.mjs --site <dir> --out <dir> [--shots a,b] [--variants name=query;...] [--limit shot=mean,...]'); process.exit(1); }
await mkdir(OUT, { recursive: true });
const HERE = dirname(fileURLToPath(import.meta.url));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.m4a': 'audio/mp4', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.hdr': 'application/octet-stream' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const data = await readFile(join(ROOT, p === '/' ? 'index.html' : p));
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream', 'Content-Length': data.length }); res.end(data);
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;

// in the page: the measurement of one kept frame (window.__flicker)
function install() {
  const SW = 480, SH = 270, BINS = 1024, BIN = 0.25, BLOCK = 30, BX = SW / BLOCK, BY = SH / BLOCK;
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
  let shot = null, acc = null, accN = 0;
  const F = window.__flicker = {
    done: [], sub: 0, subShot: null,
    // one step of a shutter's open half: the canvas added to the average
    grab() {
      const gl = window.__app.renderer.domElement, w = gl.width, h = gl.height;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      ctx.drawImage(gl, 0, 0);
      const px = ctx.getImageData(0, 0, w, h).data;
      if (!acc || acc.length !== px.length) { acc = new Float32Array(px.length); accN = 0; }
      for (let i = 0; i < px.length; i++) acc[i] += px[i];
      accN++;
    },
    close() { if (shot) F.done.push(F.end()); shot = null; },
    frame(name, frames, reset, pngs, trace) {
      if (shot?.name !== name) {
        F.close();
        shot = { name, frames, n: 0, prev: null, prevD: null, heat: new Float32Array(SW * SH), heatN: 0, scores: [], p995: [], regional: [], trace: [], detail: 0, mid: null, resets: [], pngs: [] };
      }
      if (reset && shot.n > 0) shot.resets.push(shot.n);
      const gl = window.__app.renderer.domElement, w = gl.width, h = gl.height;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      let px;
      if (accN) {
        const img = ctx.createImageData(w, h); px = img.data;
        for (let i = 0; i < px.length; i++) px[i] = Math.round(acc[i] / accN);
        ctx.putImageData(img, 0, 0); acc.fill(0); accN = 0;
      } else { ctx.drawImage(gl, 0, 0); px = ctx.getImageData(0, 0, w, h).data; }
      const luma = new Float32Array(w * h);
      for (let i = 0, j = 0; i < luma.length; i++, j += 4) luma[i] = 0.2126 * px[j] + 0.7152 * px[j + 1] + 0.0722 * px[j + 2];
      let lap = 0;
      for (let y = 1; y < h - 1; y++) for (let x = 1, i = y * w + 1; x < w - 1; x++, i++) lap += Math.abs(4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - w] - luma[i + w]);
      shot.detail += lap / ((w - 2) * (h - 2));
      const small = new Float32Array(SW * SH);
      for (let sy = 0; sy < SH; sy++) {
        const y0 = Math.floor(sy * h / SH), y1 = Math.max(y0 + 1, Math.floor((sy + 1) * h / SH));
        for (let sx = 0; sx < SW; sx++) {
          const x0 = Math.floor(sx * w / SW), x1 = Math.max(x0 + 1, Math.floor((sx + 1) * w / SW));
          let s = 0; for (let y = y0; y < y1; y++) for (let x = x0, i = y * w + x0; x < x1; x++, i++) s += luma[i];
          small[sy * SW + sx] = Math.round(s / ((y1 - y0) * (x1 - x0)));
        }
      }
      if (shot.n === Math.floor(shot.frames / 2)) shot.mid = small;
      if (shot.prev) {
        const d = new Float32Array(SW * SH); for (let i = 0; i < d.length; i++) d[i] = small[i] - shot.prev[i];
        if (shot.prevD) {
          const hist = new Uint32Array(BINS), blocks = new Float32Array(BX * BY); let sum = 0;
          for (let i = 0; i < d.length; i++) {
            let a = -d[i] * shot.prevD[i]; a = a > 0 ? Math.sqrt(a) : 0; if (a < 2) a = 0;
            sum += a; shot.heat[i] += a; hist[Math.min(BINS - 1, Math.floor(a / BIN))]++;
            blocks[Math.floor(Math.floor(i / SW) / BLOCK) * BX + Math.floor((i % SW) / BLOCK)] += a;
          }
          // the alternation at frame n - 1 (up into it, down out of it): the pop is the previous frame
          let top = 0; for (let b = 1; b < blocks.length; b++) if (blocks[b] > blocks[top]) top = b;
          shot.regional.push([+(blocks[top] / (BLOCK * BLOCK)).toFixed(2), (top % BX) * BLOCK, Math.floor(top / BX) * BLOCK]);
          shot.heatN++; shot.scores.push(sum / d.length);
          let k = 0, c = 0; const target = 0.995 * d.length; while (k < BINS - 1 && c + hist[k] < target) c += hist[k++];
          shot.p995.push((k + 0.5) * BIN);
        }
        shot.prevD = d;
      }
      if (pngs.includes(`${name}:${shot.n}`)) shot.pngs.push([shot.n, canvas.toDataURL('image/png')]);
      if (trace) { try { shot.trace.push((0, eval)(trace)); } catch (e) { shot.trace.push(String(e)); } }
      shot.prev = small; shot.n++;
    },
    end() {
      const s = shot, mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
      // the heat image: the middle frame | the mean flicker in red (8 levels = full)
      const img = document.createElement('canvas'); img.width = 2 * SW; img.height = SH;
      const c2 = img.getContext('2d'), out = c2.createImageData(2 * SW, SH), mid = s.mid ?? s.prev;
      for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
        const i = y * SW + x, g = mid[i], hv = Math.min(1, s.heat[i] / Math.max(1, s.heatN) / 8);
        for (const [o, r, gg, b] of [[0, g, g, g], [SW, Math.max(0.6 * g, 255 * hv), 0.6 * g, 0.6 * g]]) {
          const j = 4 * (y * 2 * SW + x + o); out.data[j] = r; out.data[j + 1] = gg; out.data[j + 2] = b; out.data[j + 3] = 255;
        }
      }
      c2.putImageData(out, 0, 0);
      return { shot: s.name, frames: s.n, mean: mean(s.scores), p995: mean(s.p995), worst: Math.max(0, ...s.scores), detail: s.detail / Math.max(1, s.n),
        scores: s.scores.map(v => +v.toFixed(4)), regional: s.regional, trace: s.trace, taaResetsKept: s.resets, pngs: s.pngs, heat: img.toDataURL('image/png') };
    },
  };
}

const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--disable-vulkan-surface', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const results = { size: [W, H], query: QUERY, shots: SHOTS, variants: {} };
let failed = false;
for (const v of VARIANTS) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await ctx.addInitScript(({ options }) => {
    localStorage.setItem('croton-lang', 'en'); localStorage.setItem('croton-music', '0');
    Element.prototype.requestPointerLock = function () { return Promise.resolve(); };
    window.__videoOptions = options;
    const realNow = performance.now.bind(performance); let virtualNow = null;
    performance.now = () => virtualNow ?? realNow();
    window.__filmClock = (ms) => { virtualNow = ms; };
    // seeded, and seeded again before every step (__reseed): three's uuids take random numbers, so a variant that creates
    // objects while it draws (motion.js proxies, say) would otherwise hand the pets other numbers from then on
    let s = 0x2513; Math.random = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    window.__reseed = k => { s = (0x2513 + Math.imul(k, 2654435761)) >>> 0; };
  }, { options: { fps: FPS, shots: SHOTS, hearts: false } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => { errors.push(String(e.message)); console.log('[pageerror]', e.message); });
  page.on('console', m => { if (m.type() === 'error') console.log('[error]', m.text().slice(0, 300)); });
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/index.html?auto=1&petseed=3&${QUERY}${v.query ? '&' + v.query : ''}`, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
  await new Promise(r => setTimeout(r, 1500));
  const info = await page.evaluate(() => { const A = window.__app; return { tier: A.state.tier, taa: !!A.lighting.taa, settings: A.lighting.taa?.settings ?? null, pixelRatio: A.renderer.getPixelRatio() }; });
  console.log(`[${v.name}] loaded in ${((Date.now() - t0) / 1000).toFixed(0)} s`, JSON.stringify(info));
  await page.evaluate(() => {
    const base = performance.now() - window.simTime() * 1000, renderAt = window.renderAt;
    window.renderAt = (t) => { window.__filmClock(base + t * 1000); renderAt(t); };
    const taa = window.__app.lighting.taa; window.__taaResets = 0;
    if (taa) { const reset = taa.reset.bind(taa); taa.reset = () => { window.__taaResets++; reset(); }; }
  });
  await page.evaluate(install);
  await page.addScriptTag({ path: join(HERE, 'twitter.js') });
  const durs = Object.fromEntries((await page.evaluate(() => window.__video.shots)).map(s => [s.name, s.dur]));
  await page.evaluate(({ still, calm }) => {
    const V = window.__video, A = window.__app;
    if (still) { const pose = V.pose.bind(V); V.pose = (s, t, dt) => pose(s, s.dur / 2, dt); }
    if (calm) { A.layout.animate = () => {}; A.garden.update = () => {}; }
    V.start();
  }, v);
  const shots = {}; let tHold = 0, keptShot = null, kept = 0;
  const collect = async () => {
    for (const r of await page.evaluate(() => window.__flicker.done.splice(0))) {
      await writeFile(join(OUT, `${v.name}_${r.shot}_heat.png`), Buffer.from(r.heat.split(',')[1], 'base64'));
      for (const [f, url] of r.pngs) await writeFile(join(OUT, `${v.name}_${r.shot}_${String(f).padStart(4, '0')}.png`), Buffer.from(url.split(',')[1], 'base64'));
      delete r.heat; delete r.pngs; shots[r.shot] = r;
      // regional[i] is the alternation at kept frame i + 1: the frame that popped
      r.pops = r.regional.map(([level, x, y], i) => ({ frame: i + 1, level, x, y })).filter(p => p.level > POP);
      console.log(`[${v.name}] ${r.shot.padEnd(9)} frames ${r.frames}  mean ${r.mean.toFixed(3)}  p99.5 ${r.p995.toFixed(2)}  worst ${r.worst.toFixed(3)}  detail ${r.detail.toFixed(3)}  resets ${r.taaResetsKept.length}  pops ${r.pops.length}`);
      for (const p of r.pops.slice(0, 12)) console.log(`    pop at kept frame ${p.frame}: ${p.level} levels in the block at (${p.x}, ${p.y}) of 480 x 270${TRACE ? '  trace ' + String(r.trace[p.frame]).slice(0, 400) : ''}`);
    }
  };
  // one call per frame: the choreography's step, the draw, and on a kept frame its measurement
  for (let force = false; ;) {
    const s = await page.evaluate(({ dt, force, durs, pngs, trace, shutter, angle }) => {
      const V = window.__video, F = window.__flicker, hold = force ? '' : V.hold();
      if (hold) return { hold };
      window.__reseed(F.steps = (F.steps ?? 0) + 1);
      const steps = shutter ? Math.round(shutter * 360 / angle) : 1, r = V.step(dt / steps);
      if (r.done) { F.close(); return r; }
      const before = window.__taaResets;
      window.renderAt(window.simTime() + dt / steps);
      if (r.save && shutter) {
        if (F.subShot !== r.shot) { F.subShot = r.shot; F.sub = 0; }
        if (++F.sub > steps - shutter) F.grab();
        if (F.sub < steps) return { save: false };
        F.sub = 0;
      }
      if (r.save) F.frame(r.shot, Math.round(durs[r.shot] * 60), window.__taaResets > before, pngs, trace);
      return { save: r.save, shot: r.shot, error: r.error };
    }, { dt: 1 / FPS, force, durs, pngs: PNGS, trace: TRACE, shutter: v.shutter ?? SHUTTER, angle: v.angle ?? ANGLE });
    force = false;
    if (s.hold) {
      if (!tHold) tHold = Date.now();
      if (Date.now() - tHold > 90000) { errors.push(`hold ${s.hold} timed out`); force = true; tHold = 0; }
      await new Promise(r => setTimeout(r, 100)); continue;
    }
    tHold = 0;
    if (s.error) errors.push(s.error);
    if (s.done) break;
    if (s.save) {
      if (s.shot !== keptShot) { keptShot = s.shot; kept = 0; } else kept++;
      if (v.freeze && v.freeze.shot === s.shot && v.freeze.frame === kept) {
        const r = await page.evaluate(() => {
          const gl = window.__app.renderer.domElement, c = document.createElement('canvas'); c.width = gl.width; c.height = gl.height;
          const x = c.getContext('2d', { willReadFrequently: true }), grab = () => { x.drawImage(gl, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
          const moving = grab(), movingUrl = gl.toDataURL('image/png');
          const b = window.__app.baked, step = b.updateMovables;
          b.updateMovables = () => step(0);   // the slot crossfade, exposure and shadow cache hold where they are
          for (let i = 0; i < 45; i++) window.renderAt(window.simTime() + 1 / 60);
          const still = grab(); let far = 0, sum = 0;
          for (let i = 0; i < moving.length; i += 4) {
            const d = Math.abs(0.2126 * (moving[i] - still[i]) + 0.7152 * (moving[i + 1] - still[i + 1]) + 0.0722 * (moving[i + 2] - still[i + 2]));
            sum += d; if (d > 32) far++;
          }
          return { movingUrl, stillUrl: gl.toDataURL('image/png'), mean: sum / (moving.length / 4), far: far / (moving.length / 4) };
        });
        const stem = join(OUT, `${v.name}_${s.shot}_${String(kept).padStart(4, '0')}`);
        await writeFile(`${stem}_moving.png`, Buffer.from(r.movingUrl.split(',')[1], 'base64')); await writeFile(`${stem}_frozen.png`, Buffer.from(r.stillUrl.split(',')[1], 'base64'));
        results.frozen ??= {}; results.frozen[v.name] = { shot: s.shot, frame: kept, mean: r.mean, far: r.far };
        console.log(`[${v.name}] ${s.shot} kept frame ${kept} against a still of it: mean luma difference ${r.mean.toFixed(2)}, ${(r.far * 100).toFixed(2)} % of pixels over 32 levels`);
        break;
      }
      await collect();
    }
  }
  await collect();
  const checking = Object.keys(LIMIT).length + Object.keys(POPS_LIMIT).length > 0;
  for (const [shot, r] of Object.entries(shots)) {
    const limit = LIMIT[shot], popsLimit = POPS_LIMIT[shot] ?? POPS_LIMIT['*'];
    if (limit !== undefined && r.mean > limit) { failed = true; console.log(`FAIL [${v.name}] ${shot}: mean flicker ${r.mean.toFixed(3)} > ${limit}`); }
    if (popsLimit !== undefined && r.pops.length > popsLimit) { failed = true; console.log(`FAIL [${v.name}] ${shot}: ${r.pops.length} pop frames (${r.pops.map(p => p.frame).join(' ')})`); }
    if (checking && r.taaResetsKept.length) { failed = true; console.log(`FAIL [${v.name}] ${shot}: TAA history reset inside the shot (kept frames ${r.taaResetsKept.join(' ')})`); }
  }
  if (errors.length) { failed ||= checking; console.log(`[${v.name}] errors`, errors.slice(0, 6)); }
  results.variants[v.name] = { query: v.query, info, shots, errors };
  await ctx.close();
}
await writeFile(join(OUT, 'flicker.json'), JSON.stringify(results));
console.log('variant     ' + SHOTS.map(s => s.padStart(18)).join(''));
for (const [name, r] of Object.entries(results.variants)) console.log(name.padEnd(12) + SHOTS.map(s => r.shots[s] ? `${r.shots[s].mean.toFixed(3)}/${r.shots[s].p995.toFixed(1)}/${r.shots[s].detail.toFixed(2)}`.padStart(18) : ''.padStart(18)).join(''));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
