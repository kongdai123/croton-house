// Room culling never removes a visible pixel: the same frame drawn with culling on and off must be identical. Runs on a
// GPU node (refuses a software rasteriser; bake/validate/RENDER_GATE.md), serving the site folder itself.
//   node cull_check.mjs --site <dir> --out <dir> [--cameras cameras.json] [--slots sunrise,dusk] [--size 1280x720]
// Shots: every gate camera per slot (each with its own door states), bedroom 3 from the hall with its door shut, opening
// and open, a living-room chair carried into the kitchen, the visitor's walk through the house (every 2 m), and a pet
// called into view. Per shot: culled meshes, draws on / off, differing pixels (any channel > 2 of 255) and the largest
// difference; differing shots are written as on / off / diff PNGs. Exit 1 on any differing pixel.
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { extname, join, resolve } from 'path';

const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const SITE = resolve(opt('--site', process.env.CROTON_SITE || new URL('..', import.meta.url).pathname)), OUT = opt('--out', 'cull_check');
const [W, H] = opt('--size', '1280x720').split('x').map(Number);
const slots = opt('--slots', 'sunrise,dusk').split(',');
const cams = JSON.parse(await readFile(opt('--cameras', new URL('../../bake/validate/cameras.json', import.meta.url).pathname), 'utf8')).cameras;
await mkdir(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try { const p = decodeURIComponent(req.url.split('?')[0]); if (p.includes('..')) throw 0; const data = await readFile(join(SITE, p === '/' ? 'index.html' : p)); res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(data); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-vulkan-surface'] });
const vfov = lens => 2 * Math.atan(18 / lens * 9 / 16) * 180 / Math.PI;

// in the page: draw the current state with culling on, then off twice (no simulation step between), compare the canvases;
// the two draws without culling show what differs between draws anyway (noise: then the shot says so). The draws are
// 60 ms apart so the puddle reflection (redrawn at most 30 times a second) is drawn afresh by each, with its wind ripples
// held still, and the SSR pass's frame counter pinned (the clock- and frame-driven shading in a draw).
async function compareInPage(name) {
  const A = window.__app, r = A.renderer, gl = r.getContext(), c = A.culling, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const grab = () => { r.setRenderTarget(null); const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
  // the SSR pass jitters its rays by a frame counter: every draw here gets the same one
  const ssr = A.lighting.reflections, f0 = ssr?.frame ?? 0;
  const draw = () => { if (ssr) ssr.frame = f0; const calls = r.info.render.calls; r.info.autoReset = false; A.lighting.composer.render(); const n = r.info.render.calls - calls; r.info.autoReset = true; return n; };
  const wind = A.baked?.puddleRefl?.uniforms.uPuddleWind, windWas = wind?.value; if (wind) wind.value = 0;
  try {
    c.setEnabled(true); c.update(); const culled = c.stats.culled, off = c.stats.off;
    const wait = () => new Promise(r => setTimeout(r, 60));
    await wait(); const callsOn = draw(), on = grab();
    c.setEnabled(false); await wait(); const callsOff = draw(), offPx = grab();
    await wait(); draw(); const again = grab();
    c.setEnabled(true); c.update();
    const noise = diffImages(offPx, again, w, h);
    return { name, culled, cullingOff: off, callsOn, callsOff, noise: noise.diff, ...diffImages(on, offPx, w, h) };
  } finally { if (wind) wind.value = windWas; }
}
// pixel difference of two RGBA readbacks (GL rows bottom up), with PNGs of both and of the difference when they differ
function diffImages(a, b, w, h) {
  let diff = 0, max = 0;
  for (let i = 0; i < a.length; i += 4) { let d = 0; for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(a[i + k] - b[i + k])); if (d > 2) diff++; if (d > max) max = d; }
  if (!diff) return { diff, max };
  const png = f => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const x = cv.getContext('2d'), img = x.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let i = 0; i < w * 4; i++) img.data[y * w * 4 + i] = f(((h - 1 - y) * w * 4) + i, i % 4);
    x.putImageData(img, 0, 0); return cv.toDataURL('image/png'); };
  return { diff, max, images: { on: png(j => a[j]), off: png(j => b[j]), diff: png((j, ch) => ch === 3 ? 255 : Math.min(255, Math.abs(a[j] - b[j]) * 8)) } };
}

const results = [];
async function shot(page, name) {
  const r = await page.evaluate(compareInPage, name);
  if (r.images) { for (const [k, v] of Object.entries(r.images)) await writeFile(join(OUT, `${name.replace('/', '_')}.${k}.png`), Buffer.from(v.split(',')[1], 'base64')); delete r.images; }
  results.push(r);
  console.log(`${r.diff ? (r.noise ? 'NOISE' : 'DIFF') : 'ok  '} ${name.padEnd(40)} culled ${String(r.culled).padStart(5)} draws ${r.callsOn} / ${r.callsOff}${r.cullingOff ? ' (no culling here)' : ''}${r.diff ? `  ${r.diff} px, max ${r.max}` : ''}${r.noise ? `  (two draws without culling differ by ${r.noise} px)` : ''}`);
}
const step = (page, n) => page.evaluate(n => { for (let i = 0; i < n; i++) window.renderAt(window.simTime() + 1 / 30); }, n);
const place = (page, c, fov = 62) => page.evaluate(([c, fov]) => { const A = window.__app; A.player.eyeHeight = c.z ?? 1.6; A.player.eye = c.z ?? 1.6; A.player.teleport(c.x, -c.y, c.h, c.p ?? 0); A.camera.fov = fov; A.camera.updateProjectionMatrix(); }, [c, fov]);

for (const slot of slots) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${port}/index.html?capture&pins=0&autoexp=0&tier=hq&lmres=full&lightmap=${slot}&petseed=3&x=0&y=0`, { waitUntil: 'load' });
  const gpu = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : gl.RENDERER); });
  if (/SwiftShader|llvmpipe|software/i.test(gpu)) { console.log('software rasteriser: refusing'); process.exit(2); }
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
  if (!(await page.evaluate(() => !!window.__app.culling))) { console.log('no room culling in this build'); process.exit(2); }
  await page.evaluate(`window.diffImages = ${diffImages.toString()}`);
  await page.evaluate(() => { window.__app.player.move = () => {}; });
  // gate cameras, with their door states
  for (const c of cams) {
    await page.evaluate(c => {
      const A = window.__app, doors = A.getDoors();
      const isOpen = d => d.kind === 'french' || d.kind === 'bifold' ? d.target > 0.5 : d.kind === 'slider' ? d.open > 0.3 : Math.abs(d.target) >= 0.1;
      window.__restore = [];
      for (const [id, want] of Object.entries(c.doors ?? {})) { const d = doors.find(d => d.id === id); if (d && isOpen(d) !== (want === 'open')) { A.interact.toggleDoor(d); window.__restore.push(d); } }
    }, c);
    await place(page, c, vfov(c.lens ?? 22)); await step(page, c.doors ? 45 : 8);
    await shot(page, `${slot}/${c.id}`);
    await page.evaluate(() => { for (const d of window.__restore) window.__app.interact.toggleDoor(d); }); await step(page, 40);
  }
  if (slot === slots[0]) {
    // bedroom 3 from the hall: door shut, mid-swing, open
    const hall = { x: 4.55, y: 0.6, z: 1.6, h: 180, p: -0.05 };
    await place(page, hall);
    const door = '60bf34160a';
    const set = open => page.evaluate(([id, open]) => { const A = window.__app, d = A.getDoors().find(d => d.id === id); if ((Math.abs(d.target) >= 0.1) !== open) A.interact.toggleDoor(d); }, [door, open]);
    await set(false); await step(page, 60); await shot(page, `${slot}/door_shut`);
    await set(true); await step(page, 6); await shot(page, `${slot}/door_opening`);
    await step(page, 60); await shot(page, `${slot}/door_open`);
    await set(false); await step(page, 6); await shot(page, `${slot}/door_closing`);
    await step(page, 60); await shot(page, `${slot}/door_shut_again`);
    // a living-room chair carried to the kitchen, seen from the kitchen, then put back
    const moved = await page.evaluate(() => {
      const A = window.__app, m = A.layout.movables.find(o => /chair/i.test(o.userData.placement?.m + o.name)) ?? A.layout.movables[0];
      window.__chair = { o: m, p: m.position.clone() }; m.position.set(-2.3, m.position.y, 0.4); m.updateMatrixWorld(true); return m.name || m.userData.placement?.m;
    });
    await place(page, { x: -2.3, y: -3.4, z: 1.6, h: 0, p: -0.25 }); await step(page, 4); await shot(page, `${slot}/movable_in_kitchen(${moved})`);
    await place(page, { x: 0.3, y: -3.6, z: 1.6, h: 300, p: -0.15 }); await step(page, 4); await shot(page, `${slot}/movable_from_living`);
    await page.evaluate(() => { const c = window.__chair; c.o.position.copy(c.p); c.o.updateMatrixWorld(true); }); await step(page, 4);
    // the dog called to the visitor in the hall (pets are never culled; this checks nothing near them is)
    await place(page, hall); await page.evaluate(() => window.__app.pets?.call?.('dog')); await step(page, 90); await shot(page, `${slot}/pet_called`);
    // the sun-shadow cache's partial redraws (lightmap.js REGION_LAYER) against a full redraw. The scene's clock stands
    // still (wind in the depth shaders is a snapshot either way): a full redraw, frame A; then a door swings open and back
    // driven through the cache's own update (leaving base and folding back in are partial redraws), frame B: A = B.
    for (const [id, at] of [['60bf34160a', { x: 4.55, y: 0.6, z: 1.6, h: 180, p: -0.15 }], ['bf8cb9f37a', { x: 2.8, y: 3.4, z: 1.6, h: 0, p: -0.2 }],
      ['ca2bb42b5a', { x: 0.2, y: -3.2, z: 1.6, h: 180, p: -0.2 }], ['161782cdfa', { x: -0.2, y: 3.0, z: 1.6, h: 0, p: -0.2 }]]) {
      await place(page, at); await step(page, 4);
      const r = await page.evaluate(async ([name, id]) => {
        const A = window.__app, r = A.renderer, gl = r.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, pc = A.baked.sunShadow;
        const grab = () => { r.setRenderTarget(null); const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
        const ssr = A.lighting.reflections, f0 = ssr?.frame ?? 0, draw = () => { if (ssr) ssr.frame = f0; A.lighting.composer.render(); };
        const d = A.getDoors().find(d => d.id === id), leaves = d.pivot ? [d.pivot] : d.leaves.map(l => l.pivot), rest = leaves.map(p => p.rotation.y);
        pc.render(); await new Promise(res => setTimeout(res, 60)); draw(); const a = grab();
        const partials = pc.stats.partialRenders, full = pc.stats.staticRenders - partials;
        leaves.forEach(p => { p.rotation.y += 0.8; p.updateMatrixWorld(true); }); for (let i = 0; i < 5; i++) pc.update(0.1);
        leaves.forEach((p, i) => { p.rotation.y = rest[i]; p.updateMatrixWorld(true); }); for (let i = 0; i < 50; i++) pc.update(0.1);
        const used = pc.stats.partialRenders - partials, fulls = pc.stats.staticRenders - pc.stats.partialRenders - full;
        await new Promise(res => setTimeout(res, 60)); draw(); const b = grab();
        return { name, partials: used, fulls, ...window.diffImages(a, b, w, h) };
      }, [`${slot}/shadow_partial_${id}`, id]);
      if (r.images) { for (const [k, v] of Object.entries(r.images)) await writeFile(join(OUT, `${r.name.replace('/', '_')}.${k}.png`), Buffer.from(v.split(',')[1], 'base64')); delete r.images; }
      const fail = r.diff || !r.partials;
      results.push({ name: r.name, culled: 0, callsOn: 0, callsOff: 0, diff: fail ? Math.max(1, r.diff) : 0, max: r.max, shadow: true, partials: r.partials, fulls: r.fulls });
      console.log(`${fail ? 'DIFF' : 'ok  '} ${r.name.padEnd(40)} ${r.partials} partial and ${r.fulls} full redraws${r.diff ? `  ${r.diff} px, max ${r.max}` : ''}`);
    }
    // the walk, every 2 m
    const WALK = [[0, -9], [-0.06, -5.4], [-0.06, -4.66], [0, -3], [-2.3, -2], [-2.3, 0.5], [0, 0.5], [0.77, 1.76], [0, 3.6], [2.5, 3.6], [2.8, 5.41],
      [2.6, 7.6], [-0.8, 8.2], [-0.2, 5.41], [-0.2, 3.4], [1.2, 0.3], [3.97, 0.32], [4.55, 0.3], [4.53, 1.51], [5.6, 3.6], [4.53, 1.51], [4.55, -1],
      [4.5, -2.09], [5.2, -4], [4.5, -2.09], [4.55, 0], [2, -1], [-1.8, 1.19], [-3.45, 1.19], [-4.8, 3.2]];
    let k = 0;
    for (let i = 1; i < WALK.length; i++) {
      const [x0, y0] = WALK[i - 1], [x1, y1] = WALK[i], L = Math.hypot(x1 - x0, y1 - y0), h = Math.atan2(x1 - x0, y1 - y0) * 180 / Math.PI;
      for (let s = 0; s < L; s += 2) { await place(page, { x: x0 + (x1 - x0) * s / L, y: y0 + (y1 - y0) * s / L, z: 1.6, h, p: -0.04 }); await step(page, 2); await shot(page, `${slot}/walk_${String(k++).padStart(2, '0')}`); }
    }
  }
  await page.close();
}
const bad = results.filter(r => r.diff && !r.noise), noisy = results.filter(r => r.noise);
await writeFile(join(OUT, 'report.json'), JSON.stringify({ size: [W, H], slots, shots: results.length, differing: bad.length, results }, null, 1));
const culled = results.filter(r => !r.cullingOff);
console.log(`\n${results.length} shots, ${bad.length} differing, ${noisy.length} with draw-to-draw noise; draws with culling ${culled.reduce((s, r) => s + r.callsOn, 0)} vs ${culled.reduce((s, r) => s + r.callsOff, 0)} without`);
await browser.close(); server.close();
process.exit(bad.length ? 1 : 0);
