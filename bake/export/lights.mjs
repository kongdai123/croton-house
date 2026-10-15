import { createRequire } from 'module';
const { chromium } = await import('playwright').catch(() => createRequire(new URL('../../web/package.json', import.meta.url))('playwright'));
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';
// usage: node lights.mjs [site dir] > lights.json   (site dir: a built site to serve, on a GPU node; without it the dev
// server on :8780)
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
  const A = window.__app, lights = [], emissive = {};
  A.scene.updateMatrixWorld(true);
  A.scene.traverse(o => {
    if (o.isLight && !o.isHemisphereLight && !o.isDirectionalLight && o.intensity > 0 && !A.lighting.windowLights.includes(o)) {
      const p = o.getWorldPosition(new A.THREE.Vector3()), t = o.target ? o.target.getWorldPosition(new A.THREE.Vector3()) : null;
      // plan coordinates: x east, y north (= -z), z up
      lights.push({ type: o.type, name: o.name || o.parent?.name, p: [p.x, -p.z, p.y], t: t && [t.x, -t.z, t.y], color: '#' + o.color.getHexString(), intensity: o.intensity, w: o.width, h: o.height, angle: o.angle, penumbra: o.penumbra, distance: o.distance });
    }
    // fixtures without a live light (placement light: false) that are lamps in the bake (placement bake: true): the light
    // layout.js addLight would make, at the fixture's light height
    const pl = o.userData.placement, spec = o.userData.light;
    if (spec && pl?.bake && pl.light === false) {
      const p = new A.THREE.Vector3(0, spec.y ?? 2.3, 0).applyMatrix4(o.matrixWorld), t = spec.type === 'spot' ? [p.x, -p.z, 0] : null;
      const type = { spot: 'SpotLight', rect: 'RectAreaLight' }[spec.type] || 'PointLight';
      lights.push({ type, name: 'bake-only ' + (o.userData.id || o.name), p: [p.x, -p.z, p.y], t, color: '#' + new A.THREE.Color(spec.color ?? 0xfff1dc).getHexString(), intensity: spec.intensity ?? 1, w: spec.w, h: spec.h, angle: spec.angle, penumbra: 0.5, distance: spec.distance, bakeOnly: true });
    }
    if (o.isMesh) for (const m of [].concat(o.material)) if (m.emissive && m.emissiveIntensity > 0 && m.emissive.getHex() !== 0) emissive[m.name || m.uuid] = { color: '#' + m.emissive.getHexString(), intensity: m.emissiveIntensity };
  });
  return { lights, emissive };
});
console.log(JSON.stringify(out));
await browser.close(); server?.close();
