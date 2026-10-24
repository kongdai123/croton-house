import { createRequire } from 'module';
const { chromium } = await import('playwright').catch(() => createRequire(new URL('../../web/package.json', import.meta.url))('playwright'));
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';
// The house's light switches (web/src/furniture/light_switch.js) and what each one controls, for the bake's lamps
// (scripts/fixture_lights.py, every Blender scene; scripts/lamp_groups.py, the per-switch lamp bakes): its lamp group,
// plan space, exterior flag, default slots and photometric output (the lighting manifest, web/src/lighting_roles.js
// bakeSwitchRecord), its live lights, its fixture's light spec (also where the layout's 16-light budget or placement
// light: false left it without a live light), and its glowing lamp surfaces, all in plan coordinates (x east, y north,
// z up). The runtime matches switches to groups by fixture id and position (lamp_groups.js).
// usage: node switch_groups.mjs [site dir] > switches.json   (as lights.mjs: on a GPU node, or the dev server on :8780)
const site = process.argv[2];
let origin = 'http://127.0.0.1:8780', server = null;
if (site) {
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
  server = createServer(async (req, res) => {
    try { const p = decodeURIComponent(req.url.split('?')[0]); const data = await readFile(join(site, p === '/' ? 'index.html' : p)); res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(data); }
    catch { res.writeHead(404); res.end(); }
  }).listen(0);
  origin = `http://127.0.0.1:${server.address().port}`;
}
const gpu = process.platform === 'darwin' ? { channel: 'chrome', args: ['--use-angle=metal'] } : { args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--disable-vulkan-surface'] };
const browser = await chromium.launch({ ...gpu, headless: true });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
await page.goto(`${origin}/index.html?capture&legacy&pins=0&pets=0&dusk`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
const out = await page.evaluate(() => {
  const A = window.__app;
  A.scene.updateMatrixWorld(true);
  // one record per switch (lighting_roles.js bakeSwitchRecord: the headless golden scene writes the same)
  const switches = A.lighting.lightSwitches.map((entry, i) => A.roles.bakeSwitchRecord(entry, i, A.THREE));
  // the lamp groups in their canonical order (lighting_roles.js lampGroupOrder): the bake's texture channels
  return { switches, groups: A.roles.lampGroupOrder(switches) };
});
console.log(JSON.stringify(out));
await browser.close(); server?.close();
