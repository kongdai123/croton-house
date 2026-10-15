// The page runs in legacy mode: baked mode (the default) re-lays out every matched mesh for the old atlas (vertices split
// at its chart seams), which would change the units' vertex counts and their lightmap identity.
// Export the walkthrough's static scene (the photo-mode copy: instances flattened, poses baked) as a GLB for Blender.
// usage: node export.mjs <out.glb> <bundle.js> [site dir]
//   bundle.js: export_entry.js bundled (NODE_PATH=web/node_modules npx esbuild bake/export/export_entry.js --bundle)
//   site dir: a built site to serve (on a GPU node); without it the dev server on :8780
// Every mesh carries its lightmap identity (batch.js) as node extras: {lm: id} or {lmSkip: 'movable'}; unwrap.py keys
// the lightmap units by it.
import { createRequire } from 'module';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';
const { chromium } = await import('playwright').catch(() => createRequire(new URL('../../web/package.json', import.meta.url))('playwright'));
const [out, bundle, site] = process.argv.slice(2);
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
const browser = await chromium.launch({ ...gpu, headless: true, args: [...gpu.args, '--js-flags=--max-old-space-size=16000'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 }, acceptDownloads: true });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 200)); });
await page.goto(`${origin}/index.html?capture&legacy&pins=0&pets=0&tex=2k&x=0.3&y=-1&h=0`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
await page.addScriptTag({ path: bundle });
const dl = page.waitForEvent('download', { timeout: 900000 });
const info = await page.evaluate(async () => {
  const A = window.__app, P = A.photo;
  // enclosed fit-outs (batch.js rooms) are hidden while the camera is outside them; the bake needs them all
  A.scene.traverse(o => { if (o.userData.viewRoom) o.visible = true; });
  for (const g of A.scene.getObjectByName('batched')?.children ?? []) if (g.isGroup) g.visible = true;
  const scene = await P.buildScene();
  scene.background = null; scene.environment = null;
  for (const o of [...scene.children]) if (o.isDirectionalLight) { scene.remove(o); scene.remove(o.target); }
  // JPEG for every texture of an opaque material, PNG only where alpha matters
  const seen = new Set();
  scene.traverse(o => { if (!o.isMesh) return; for (const m of [].concat(o.material)) {
    const alpha = m.alphaTest > 0 || m.transparent || m.alphaMap;
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'bumpMap']) { const t = m[k]; if (t && !seen.has(t)) { seen.add(t); t.userData.mimeType = (k === 'map' && alpha) ? 'image/png' : 'image/jpeg'; } }
  } });
  let tris = 0, ids = 0, skips = 0, meshes = 0;
  scene.traverse(o => { if (o.isMesh) { const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; meshes++; if (o.userData.lm) ids++; else if (o.userData.lmSkip) skips++; } });
  const glb = await new window.__GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: true, maxTextureSize: 2048 });
  const url = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
  const a = document.createElement('a'); a.href = url; a.download = 'croton.glb'; document.body.appendChild(a); a.click();
  return { bytes: glb.byteLength, textures: seen.size, tris: Math.round(tris), meshes, lmIds: ids, lmSkip: skips, stats: P.buildStats };
});
console.log(JSON.stringify(info));
await (await dl).saveAs(out);
await browser.close(); server?.close();
