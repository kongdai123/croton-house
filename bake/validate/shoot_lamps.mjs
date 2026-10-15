// Switchable baked lamps on the live site, through the lamp-check cameras (the same views as the Cycles references made
// with scripts/lamp_groups_render.py): each view with its slot's default switches, then with its room's switches on.
// Also: the switch-to-light response (frames until the group reaches its level) and console errors.
// usage (inside a GPU job): CROTON_SITE=<site dir> node validate/shoot_lamps.mjs <outDir> <views.json> [query]
//   views.json: {"name": {"cam": {"x","y","z","h","p","lens"}, "groups": ["primaryBath", ...]}, ...}
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile, writeFile } from 'fs/promises';
import { extname, join } from 'path';
const [out, viewsPath, query = 'lightmap=sunrise&tier=hq&lmres=full'] = process.argv.slice(2);
const views = JSON.parse(await readFile(viewsPath, 'utf8'));
const ROOT = process.env.CROTON_SITE || new URL('../../web', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try { const p = decodeURIComponent(req.url.split('?')[0]); const data = await readFile(join(ROOT, p === '/' ? 'index.html' : p)); res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(data); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-vulkan-surface'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('response', r => { if (r.status() >= 400 && !/manifest\.json|\/(noon|golden|dusk)\//.test(r.url())) console.log('[http]', r.status(), r.url()); });
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', m => { const t = m.text(); if (m.type() === 'error' || m.type() === 'warning') { if (!/deprecated|sigmaRadians|serialize/.test(t)) { errors.push(m.type() + ': ' + t.slice(0, 300)); console.log('[console]', m.type(), t.slice(0, 300)); } } });
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?capture&pins=0&pets=0&eye=1.45&x=0&y=0&${query}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
await page.addStyleTag({ content: '#hud, #title, #minimap, #topbar, #crosshair, #label, #toast, #warming { display: none !important; }' });
const stats = await page.evaluate(() => window.__app.baked?.stats ?? null);
console.log('baked', JSON.stringify(stats));
// active samplers per linked program (Apple GPUs allow 16 per fragment shader)
const samplerCount = () => page.evaluate(() => {
  const r = window.__app.renderer, gl = r.getContext(), S = new Set([gl.SAMPLER_2D, gl.SAMPLER_3D, gl.SAMPLER_CUBE, gl.SAMPLER_2D_SHADOW, gl.SAMPLER_2D_ARRAY, gl.SAMPLER_2D_ARRAY_SHADOW, gl.SAMPLER_CUBE_SHADOW, gl.INT_SAMPLER_2D, gl.UNSIGNED_INT_SAMPLER_2D]);
  const out = [];
  for (const p of r.info.programs ?? []) {
    const prog = p.program, n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS); let count = 0; const names = [];
    for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(prog, i); if (S.has(u.type)) { count += u.size; names.push(u.name); } }
    out.push({ name: p.name, count, lamp: names.some(x => /uLampTex|uLmLamps|uSlotNextLamps/.test(x)), names });
  }
  out.sort((a, b) => b.count - a.count);
  return { programs: out.length, max: out[0]?.count, top: out.slice(0, 3), lampPrograms: out.filter(o => o.lamp).map(o => o.count) };
});
if (!stats) { console.log('fallback', await page.evaluate(() => window.__app.state.bakedFallback)); process.exit(3); }
const report = { stats, views: {}, errors };
for (const [name, v] of Object.entries(views)) {
  for (const state of ['default', 'on']) {
    const info = await page.evaluate(([v, state]) => {
      const A = window.__app, G = A.baked.lampGroups, k = v.cam;
      if (state === 'default') G.reset(A.baked.slotName);
      A.player.eyeHeight = k.z ?? 1.45; A.player.eye = k.z ?? 1.45; A.player.teleport(k.x, -k.y, k.h, k.p ?? 0);
      A.camera.fov = 2 * Math.atan(18 / (k.lens ?? 22) * 9 / 16) * 180 / Math.PI; A.camera.updateProjectionMatrix();
      for (let i = 0; i < 20; i++) window.renderAt(window.simTime() + 1 / 30);
      let frames = null;
      if (state === 'on') {
        const mine = G.records.filter(r => r.group && v.groups.includes(r.group.name));
        for (const r of mine) if (!r.toggle.on || !r.toggle.manual) r.toggle.set(true);
        // frames (30 fps) until every switched group sits at its full level
        const want = g => (g.gain ?? 1) * mine.filter(r => r.group === g).reduce((s, r) => s + r.w, 0);
        const gs = [...new Set(mine.map(r => r.group))];
        for (let i = 1; i <= 30; i++) { window.renderAt(window.simTime() + 1 / 30); if (frames === null && gs.every(g => Math.abs(G.levels[g.index] - want(g)) < 1e-3)) frames = i; }
      }
      return { frames, levels: Array.from(G.levels).map(x => +x.toFixed(3)), on: G.records.filter(r => r.toggle.on).length };
    }, [v, state]);
    await page.screenshot({ path: `${out}/${name}_${state}.png` });
    report.views[`${name}_${state}`] = info; console.log('shot', name, state, JSON.stringify(info));
  }
}
// SLOTS=1: every available slot in turn from the last view: its default switch levels after the fade
if (process.env.SLOTS) for (const name of await page.evaluate(() => window.__app.baked.availableSlots)) {
  const info = await page.evaluate(async name => {
    const A = window.__app, G = A.baked.lampGroups, done = A.setBakedSlot(name);
    let ok = false; done.then(v => { ok = v; });
    for (let i = 0; i < 600 && !ok; i++) { window.renderAt(window.simTime() + 1 / 30); await new Promise(r => setTimeout(r, 20)); }
    for (let i = 0; i < 10; i++) window.renderAt(window.simTime() + 1 / 30);
    return { slot: A.baked.slotName, ok, levels: Array.from(G.levels).map(x => +x.toFixed(3)), on: G.records.filter(r => r.toggle.on).length };
  }, name);
  await page.screenshot({ path: `${out}/slot_${name}.png` });
  report.views[`slot_${name}`] = info; console.log('slot', name, JSON.stringify(info));
}
report.samplers = await samplerCount(); console.log('samplers', JSON.stringify({ max: report.samplers.max, programs: report.samplers.programs, lampMax: Math.max(...report.samplers.lampPrograms), top: report.samplers.top[0] }));
await writeFile(`${out}/report.json`, JSON.stringify(report, null, 1));
await browser.close(); server.close();
