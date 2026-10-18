import { createRequire } from 'module';
const { chromium } = await import('playwright').catch(() => createRequire(new URL('../../web/package.json', import.meta.url))('playwright'));
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';
// The house's light switches (web/src/furniture/light_switch.js) and what each one controls, for the per-switch lamp
// bakes (scripts/lamp_groups.py): its lamp group, plan space, exterior flag and default slots (the lighting manifest,
// web/src/lighting_roles.js), its live lights, its fixture's light spec (also where the layout's 16-light budget or
// placement light: false left it without a live light), and its glowing lamp surfaces, all in plan coordinates
// (x east, y north, z up). The runtime matches switches to groups by `key` (lamp_groups.js switchKey).
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
  const A = window.__app, V = A.THREE.Vector3;
  A.scene.updateMatrixWorld(true);
  const plan = v => [+v.x.toFixed(3), +(-v.z).toFixed(3), +v.y.toFixed(3)];
  const switches = A.lighting.lightSwitches.map(({ root, toggle, meshes }, i) => {
    let fixture = root; while (fixture && !fixture.userData.placement) fixture = fixture.parent;
    const spec = (fixture ?? root).userData.light, pl = fixture?.userData.placement;
    const id = fixture?.userData.id || root.userData.id || root.name;
    const glows = meshes.map(m => {
      const b = new A.THREE.Box3().setFromObject(m), c = b.getCenter(new V()), s = b.getSize(new V());
      return { c: plan(c), size: [+s.x.toFixed(3), +s.z.toFixed(3), +s.y.toFixed(3)], mat: m.material.name || '', emissive: !!m.material.emissive };
    });
    return {
      i, key: `${id}@${plan(root.getWorldPosition(new V())).map(v => v.toFixed(2)).join(',')}`, id, name: toggle.label.en.replace(/^Turn on · /, ''),
      root: plan(root.getWorldPosition(new V())), group: toggle.lighting.group, space: toggle.lighting.space, exterior: toggle.lighting.exterior,
      kind: toggle.lighting.kind, circuit: toggle.lighting.circuit, defaultOn: toggle.lighting.defaultOn, on: toggle.on,
      lights: toggle.lights.map(l => ({ type: l.type, p: plan(l.getWorldPosition(new V())), intensity: l.userData.base ?? l.userData.switchBase })),
      spec: spec ? { ...spec, p: plan(new V(...A.roles.lightLocal(spec)).applyMatrix4(fixture.matrixWorld)), liveLight: pl?.light !== false, bake: !!pl?.bake } : null,
      glows,
    };
  });
  // the lamp groups in their canonical order (lighting_roles.js lampGroupOrder): the bake's texture channels
  return { switches, groups: A.roles.lampGroupOrder(switches) };
});
console.log(JSON.stringify(out));
await browser.close(); server?.close();
