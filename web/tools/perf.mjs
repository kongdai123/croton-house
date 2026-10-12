// Render stats + frame time at a few poses: node tools/perf.mjs [hq]
import { chromium } from 'playwright';
const hq = process.argv[2] === 'hq', extra = process.argv[3] ?? '';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const poses = [['living', -0.6, -2.2, 75], ['kitchen', 0.2, -2.5, 300], ['garden', 1, 13, 185], ['front', 0, -11.5, 0], ['primary', -4, 2.4, 0]];
await page.goto(`http://127.0.0.1:8780/index.html?x=0&y=0&h=0${hq ? '' : '&fast=1'}${extra}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
await page.waitForTimeout(1500);
const glob = await page.evaluate(() => {
  const a = window.__app; let meshes = 0, inst = 0, tris = 0, lights = 0, shadowLights = 0; const geos = new Set(), mats = new Set();
  a.scene.traverse(o => { if (o.isLight) { lights++; if (o.castShadow) shadowLights++; } if (!o.isMesh) return; meshes++; if (o.isInstancedMesh) inst++; geos.add(o.geometry); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => mats.add(m)); });
  for (const g of geos) tris += (g.index ? g.index.count : g.attributes.position?.count || 0) / 3;
  const i = a.renderer.info; return { meshes, instanced: inst, uniqueGeos: geos.size, uniqueMats: mats.size, uniqueTris: Math.round(tris), lights, shadowLights, programs: i.programs?.length, textures: i.memory.textures, geometriesGPU: i.memory.geometries };
});
console.log(JSON.stringify(glob));
for (const [n, x, y, h] of poses) {
  const r = await page.evaluate(async ([x, y, h]) => {
    const a = window.__app; a.player.teleport(x, -y, h, 0);
    await new Promise(r => setTimeout(r, 600));
    const i = a.renderer.info; i.autoReset = false; i.reset();
    const t = []; let last = performance.now();
    await new Promise(res => { let k = 0; const f = () => { const now = performance.now(); t.push(now - last); last = now; if (++k < 60) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    const calls = i.render.calls / 60, tris = i.render.triangles / 60; i.autoReset = true;
    t.sort((p, q) => p - q);
    return { calls: Math.round(calls), tris: Math.round(tris), medMs: t[30].toFixed(1), p90: t[54].toFixed(1) };
  }, [x, y, h]);
  console.log(n.padEnd(8), JSON.stringify(r));
}
await browser.close();
