// Fingerprints (vertex count, world bounds) of every mesh the visitor can move, from the live site on a GPU node.
// usage (inside a GPU job): node validate/movables.mjs ../scene/movables.json
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile, writeFile } from 'fs/promises';
import { extname, join } from 'path';
const ROOT = process.env.CROTON_SITE || new URL('../../web', import.meta.url).pathname;   // the site folder to serve
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try { const p = decodeURIComponent(req.url.split('?')[0]); const data = await readFile(join(ROOT, p === '/' ? 'index.html' : p)); res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(data); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
// the same state the GLB was exported in: capture, no pins, no pets, standing at (0.3, -1)
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?capture&pins=0&pets=0&x=0.3&y=-1&h=0`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
const out = await page.evaluate(() => {
  const A = window.__app, T = A.THREE, list = [], box = new T.Box3();
  A.scene.updateMatrixWorld(true);
  for (const root of A.layout.movables) root.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || !o.geometry?.attributes.position) return;
    // batching keeps the merged pieces visible and hides the originals; only what is drawn was exported
    for (let p = o; p; p = p.parent) if (!p.visible) return;
    // tight world bounds from the vertices (a transformed local box is too wide for rotated pieces)
    box.makeEmpty(); const v = new T.Vector3(), pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
    list.push({ root: root.name || root.userData.name || '', vc: o.geometry.attributes.position.count, min: box.min.toArray(), max: box.max.toArray() });
  });
  return { roots: A.layout.movables.length, meshes: list };
});
await writeFile(process.argv[2], JSON.stringify(out));
console.log('movable roots', out.roots, 'meshes', out.meshes.length);
await browser.close(); server.close();
