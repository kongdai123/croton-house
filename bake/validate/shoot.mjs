// Render the live site through Blender's cameras on a GPU node. Refuses to run on a software rasteriser.
// usage (inside a GPU job): node validate/shoot.mjs <outDir> <query> ; serves site/ itself on a free port
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';
const [out, query = 'lightmap'] = process.argv.slice(2);
const ROOT = process.env.CROTON_SITE || new URL('../../web', import.meta.url).pathname;   // the site folder to serve
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try { const p = decodeURIComponent(req.url.split('?')[0]); const data = await readFile(join(ROOT, p === '/' ? 'index.html' : p)); res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(data); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;
const VIEWS = [
  { name: 'garden', x: 5.6, y: 12.7, h: 198, p: 0.09 },
  { name: 'living', x: 0.3, y: -1.4, h: 0, p: 0 },
];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-vulkan-surface'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { const t = m.text(); if (/lightmaps|error|warn/i.test(m.type() + t) && !/deprecated|sigmaRadians|serialize/.test(t)) console.log('[console]', t.slice(0, 300)); });
await page.goto(`http://127.0.0.1:${port}/index.html?capture&pins=0&pets=0&eye=1.35&x=0&y=0&${query}&autoexp=0`, { waitUntil: 'load' });
const gpu = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : gl.RENDERER); });
console.log('renderer', gpu);
if (/SwiftShader|llvmpipe|software/i.test(gpu)) { console.log('software rasteriser: refusing to render'); process.exit(2); }
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
await page.addStyleTag({ content: '#hud, #title, #minimap, #topbar, #crosshair, #label, #toast, #warming { display: none !important; }' });
console.log('baked', JSON.stringify(await page.evaluate(() => window.__app.baked?.stats ?? null)));
for (const v of VIEWS) {
  await page.evaluate(v => {
    const A = window.__app; A.player.eyeHeight = 1.35; A.player.eye = 1.35; A.player.teleport(v.x, -v.y, v.h, v.p);
    // Blender's camera: 22 mm on a 36 mm-wide sensor, 16:9 -> 49.4 degrees vertical
    A.camera.fov = 2 * Math.atan(Math.tan(Math.atan(18 / 22)) * 9 / 16) * 180 / Math.PI; A.camera.updateProjectionMatrix();
    for (let i = 0; i < 30; i++) window.renderAt(window.simTime() + 1 / 30);
  }, v);
  await page.screenshot({ path: `${out}/${v.name}.png` });
  console.log('shot', v.name);
}
await browser.close(); server.close();
