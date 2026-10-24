// A/B frames: two variants of the site (a query each, optionally a build each) draw the same shots, pixel for pixel. Runs
// on a GPU node (refuses a software rasteriser; bake/validate/RENDER_GATE.md).
//   node ab_check.mjs --site <dir> --out <dir> [--a 'query'] [--b 'batch2=0'] [--dist-a <dir>] [--dist-b <dir>]
//        [--cameras cameras.json] [--slots sunrise,dusk] [--size 1280x720] [--only id,id] [--sheets 24]
// Both pages load with ?capture&simdt (their own frames advance the clock by a fixed step) and are stepped alike with
// renderAt, so the scene is the same in both. Each shot is drawn after its temporal state is reset in both (TAA and
// volumetric history and their noise frames, the SSR and contact-shadow frames, the film grain, the puddle wind; the
// sun-shadow cache redrawn whole), and Math.random is seeded alike, so a frame depends only on the scene. Page A draws
// every shot twice: what differs between those two is noise, and a shot differing between A and B by more than that
// fails. Shots: every gate camera per slot (with its door states); then in the first slot a door
// shut / opening / open, a chair carried into the kitchen, the dog called, a cellular shade halfway down, the hover
// highlight on the living room's window seat, and a slot crossfade halfway. Failing shots are written as a | b | diff
// PNGs (--sheets of them). Exit 1 on any differing pixel (any channel > 2 of 255) beyond the noise.
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile, writeFile, mkdir, stat } from 'fs/promises';
import { extname, join, resolve, isAbsolute } from 'path';

const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const SITE = resolve(opt('--site', process.env.CROTON_SITE || new URL('..', import.meta.url).pathname)), OUT = opt('--out', 'ab_check');
const [W, H] = opt('--size', '1280x720').split('x').map(Number);
const slots = opt('--slots', 'sunrise,dusk').split(',');
const only = opt('--only')?.split(',') ?? null;
const cams = JSON.parse(await readFile(opt('--cameras', new URL('../../bake/validate/cameras.json', import.meta.url).pathname), 'utf8')).cameras.filter(c => !only || only.includes(c.id));
const variants = { a: { query: opt('--a', ''), dist: opt('--dist-a') }, b: { query: opt('--b', 'batch2=0'), dist: opt('--dist-b') } };
for (const v of Object.values(variants)) if (v.dist && !isAbsolute(v.dist)) v.dist = join(SITE, v.dist);
await mkdir(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
// /a/... and /b/...: the site, with dist/ from the variant's build when it has one
const server = createServer(async (req, res) => {
  try {
    const m = decodeURIComponent(req.url.split('?')[0]).match(/^\/(a|b)\/(.*)$/); if (!m) throw 0;
    const v = variants[m[1]], p = m[2] || 'index.html'; if (p.includes('..')) throw 0;
    const file = v.dist && p.startsWith('dist/') ? join(v.dist, p.slice(5)) : join(SITE, p);
    if (!(await stat(file)).isFile()) throw 0;
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-vulkan-surface'] });
const vfov = lens => 2 * Math.atan(18 / lens * 9 / 16) * 180 / Math.PI;

// in the page: one frame with the temporal state reset, as RGBA bytes (base64, GL rows bottom up)
async function drawInPage() {
  const A = window.__app, r = A.renderer, gl = r.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const ssr = A.lighting.reflections, wind = A.baked?.puddleRefl?.uniforms.uPuddleWind, windWas = wind?.value;
  if (wind) wind.value = 0;
  try {
    A.baked?.sunShadow?.render();
    await new Promise(res => setTimeout(res, 60));   // the puddle reflection (at most 30 Hz) draws afresh
    if (ssr) ssr.frame = 0;
    const shafts = A.baked?.shafts; if (shafts) { shafts.reset(); shafts.frame = 0; }   // its march noise follows a frame counter
    const contact = A.scene.userData.contact?.march?.uFrame; if (contact) contact.value = 63;   // its ray noise: frame 0 at the draw
    if (A.lighting.grade?.seed) A.lighting.grade.seed.value = 0;   // the film grain's pattern
    A.lighting.taa?.reset();
    A.lighting.composer.render();
    r.setRenderTarget(null);
    const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let s = ''; for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode.apply(null, px.subarray(i, i + 0x8000));
    return { w, h, data: btoa(s), calls: r.info.render.calls };
  } finally { if (wind) wind.value = windWas; }
}
function diff(a, b) {
  let n = 0, max = 0;
  for (let i = 0; i < a.length; i += 4) { let d = 0; for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(a[i + k] - b[i + k])); if (d > 2) n++; if (d > max) max = d; }
  return { n, max };
}
// a | b | diff (x8) as one PNG, drawn in page A's browser (no image library in the job's node)
async function sheet(page, name, a, b, w, h) {
  const url = await page.evaluate(([a, b, w, h]) => {
    const dec = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
    const A = dec(a), B = dec(b), cv = document.createElement('canvas'); cv.width = w * 3; cv.height = h;
    const x = cv.getContext('2d'), img = x.createImageData(w * 3, h);
    for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) {
      const s = ((h - 1 - y) * w + i) * 4;
      for (let k = 0; k < 3; k++) {
        img.data[(y * w * 3 + i) * 4 + k] = A[s + k]; img.data[(y * w * 3 + w + i) * 4 + k] = B[s + k];
        img.data[(y * w * 3 + 2 * w + i) * 4 + k] = Math.min(255, Math.abs(A[s + k] - B[s + k]) * 8);
      }
      for (const o of [0, w, 2 * w]) img.data[(y * w * 3 + o + i) * 4 + 3] = 255;
    }
    x.putImageData(img, 0, 0); return cv.toDataURL('image/png');
  }, [a, b, w, h]);
  await writeFile(join(OUT, `${name.replace(/[/()]/g, '_')}.png`), Buffer.from(url.split(',')[1], 'base64'));
}

// sheets of failing shots only, at most MAX_SHEETS (each ~4 MB)
const results = [], MAX_SHEETS = +opt('--sheets', 24); let sheets = 0;
async function shot(pages, name) {
  const [a, b] = await Promise.all(pages.map(p => p.evaluate(drawInPage)));
  const a2 = await pages[0].evaluate(drawInPage);
  const A = Buffer.from(a.data, 'base64'), B = Buffer.from(b.data, 'base64'), A2 = Buffer.from(a2.data, 'base64');
  const d = diff(A, B), noise = diff(A, A2), bad = d.n > noise.n;
  if (bad && sheets++ < MAX_SHEETS) await sheet(pages[0], name, a.data, b.data, a.w, a.h);
  results.push({ name, diff: d.n, max: d.max, noise: noise.n, bad });
  console.log(`${bad ? 'DIFF' : d.n ? 'NOISE' : 'ok  '} ${name.padEnd(44)}${d.n ? `  ${d.n} px, max ${d.max}` : ''}${noise.n ? `  (A redrawn differs by ${noise.n} px)` : ''}`);
}
const both = (pages, fn, arg) => Promise.all(pages.map(p => p.evaluate(fn, arg)));
const step = (pages, n) => both(pages, n => { for (let i = 0; i < n; i++) window.renderAt(window.simTime() + 1 / 30); }, n);
const place = (pages, c, fov = 62) => both(pages, ([c, fov]) => { const A = window.__app; A.player.eyeHeight = c.z ?? 1.6; A.player.eye = c.z ?? 1.6; A.player.teleport(c.x, -c.y, c.h, c.p ?? 0); A.camera.fov = fov; A.camera.updateProjectionMatrix(); }, [c, fov]);

for (const slot of slots) {
  const pages = [];
  for (const [k, v] of Object.entries(variants)) {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    // the same random numbers in both pages (a procedural texture or two draw them)
    await page.addInitScript(() => { let s = 0x2513; Math.random = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); });
    page.on('pageerror', e => console.log(`[${k} pageerror]`, e.message));
    const q = ['capture', 'simdt=0.0333', 'pins=0', 'autoexp=0', 'tier=hq', 'lmres=full', `lightmap=${slot}`, 'petseed=3', 'x=0', 'y=0', v.query].filter(Boolean).join('&');
    await page.goto(`http://127.0.0.1:${port}/${k}/index.html?${q}`, { waitUntil: 'load' });
    pages.push(page);
  }
  const gpu = await pages[0].evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : gl.RENDERER); });
  if (/SwiftShader|llvmpipe|software/i.test(gpu)) { console.log('software rasteriser: refusing'); process.exit(2); }
  await Promise.all(pages.map(p => p.waitForFunction(() => window.__ready === true, null, { timeout: 600000 })));
  const info = await both(pages, () => ({ simT: window.simTime(), batch2: window.__app.state.batch2 ?? null, baked: window.__app.state.baked }));
  console.log(`[${slot}] a: ${JSON.stringify(info[0])}  b: ${JSON.stringify(info[1])}`);
  await both(pages, () => { window.__app.player.move = () => {}; });
  for (const c of cams) {
    await both(pages, c => {
      const A = window.__app, doors = A.getDoors();
      const isOpen = d => d.kind === 'french' || d.kind === 'bifold' ? d.target > 0.5 : d.kind === 'slider' ? d.open > 0.3 : Math.abs(d.target) >= 0.1;
      window.__restore = [];
      for (const [id, want] of Object.entries(c.doors ?? {})) { const d = doors.find(d => d.id === id); if (d && isOpen(d) !== (want === 'open')) { A.interact.toggleDoor(d); window.__restore.push(d); } }
    }, c);
    await place(pages, c, vfov(c.lens ?? 22)); await step(pages, c.doors ? 45 : 8);
    await shot(pages, `${slot}/${c.id}`);
    await both(pages, () => { for (const d of window.__restore) window.__app.interact.toggleDoor(d); }); await step(pages, 40);
  }
  if (slot === slots[0]) {
    const hall = { x: 4.55, y: 0.6, z: 1.6, h: 180, p: -0.05 }, door = '60bf34160a';
    const set = open => both(pages, ([id, open]) => { const A = window.__app, d = A.getDoors().find(d => d.id === id); if ((Math.abs(d.target) >= 0.1) !== open) A.interact.toggleDoor(d); }, [door, open]);
    await place(pages, hall);
    await set(false); await step(pages, 60); await shot(pages, `${slot}/door_shut`);
    await set(true); await step(pages, 6); await shot(pages, `${slot}/door_opening`);
    await step(pages, 60); await shot(pages, `${slot}/door_open`);
    await set(false); await step(pages, 60);
    // a living-room chair carried into the kitchen, seen from the kitchen, then put back
    await both(pages, () => {
      const A = window.__app, m = A.layout.movables.find(o => /chair/i.test(o.userData.placement?.m + o.name)) ?? A.layout.movables[0];
      window.__chair = { o: m, p: m.position.clone() }; m.position.set(-2.3, m.position.y, 0.4); m.updateMatrixWorld(true);
    });
    await place(pages, { x: -2.3, y: -3.4, z: 1.6, h: 0, p: -0.25 }); await step(pages, 4); await shot(pages, `${slot}/chair_in_kitchen`);
    await both(pages, () => { const c = window.__chair; c.o.position.copy(c.p); c.o.updateMatrixWorld(true); }); await step(pages, 4);
    // the dog called to the visitor in the hall
    await place(pages, hall); await both(pages, () => window.__app.pets?.call?.('dog')); await step(pages, 90); await shot(pages, `${slot}/pet_called`);
    // a cellular shade lowering, halfway (a toggle mid-move: its rigid parts merged, its moving ones live)
    const shade = await both(pages, () => {
      const A = window.__app, s = A.layout.placed.find(o => o.userData.toggle && /cellular-shade/.test(o.userData.id ?? ''));
      if (!s) return null;
      const p = s.getWorldPosition(new A.THREE.Vector3()), q = s.getWorldQuaternion(new A.THREE.Quaternion()), f = new A.THREE.Vector3(0, 0, 1).applyQuaternion(q);
      s.userData.toggle.set(!s.userData.toggle.on); window.__shade = s;
      return { x: p.x + f.x * 2.2, y: -(p.z + f.z * 2.2), z: 1.6, h: Math.atan2(-f.x, f.z) * 180 / Math.PI, p: 0.15 };
    });
    if (shade[0]) {
      await place(pages, shade[0]); await step(pages, 13); await shot(pages, `${slot}/shade_moving`);
      await step(pages, 40); await shot(pages, `${slot}/shade_moved`);
      await both(pages, () => window.__shade.userData.toggle.set(!window.__shade.userData.toggle.on, true)); await step(pages, 4);
    }
    // the hover highlight on the living room's window seat (the seat with the most multi-material parts: its books, never
    // tinted)
    const seatCam = cams.find(c => c.id === 'living_2'); if (seatCam) await place(pages, seatCam, vfov(seatCam.lens ?? 22)); await step(pages, 4);
    await both(pages, () => { const A = window.__app, multi = o => { let n = 0; o.traverse(x => { if (Array.isArray(x.material)) n++; }); return n; }, seat = A.layout.interactive.filter(o => o.userData.seats?.length).sort((a, b) => multi(b) - multi(a))[0]; if (seat) A.interact.setHighlight(seat, true); window.__seat = seat; });
    await shot(pages, `${slot}/seat_highlight`);
    await both(pages, () => { if (window.__seat) window.__app.interact.setHighlight(window.__seat, false); });
    // a slot crossfade halfway (1.5 s fade: 23 steps of 1/30 s)
    const next = await both(pages, () => window.__app.baked?.nextSlot?.() ?? null);
    if (next[0]) {
      await place(pages, cams.find(c => c.id === 'living_1') ?? hall);
      // the fade starts once the slot is staged (downloads, in real time); then it runs on the stepped clock
      const started = await both(pages, async n => {
        window.__fade = window.__app.baked.setSlot(n, (f, d) => { if (d?.phase === 'transition') window.__fading = true; });
        for (let i = 0; i < 1200 && !window.__fading; i++) await new Promise(r => setTimeout(r, 50));
        return !!window.__fading;
      }, next[0]);
      if (started.every(Boolean)) { await step(pages, 23); await shot(pages, `${slot}/crossfade_half`); }
      else console.log('crossfade did not start in both pages', started);
    }
  }
  for (const p of pages) await p.close();
}
const bad = results.filter(r => r.bad), noisy = results.filter(r => r.diff && !r.bad);
await writeFile(join(OUT, 'report.json'), JSON.stringify({ size: [W, H], variants, slots, shots: results.length, differing: bad.length, results }, null, 1));
console.log(`\n${results.length} shots, ${bad.length} differing, ${noisy.length} within page A's own noise`);
await browser.close(); server.close();
process.exit(bad.length ? 1 : 0);
