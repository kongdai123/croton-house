// Identify what is under given screen pixels: node tools/pick.mjs "index.html?x=..&y=..&h=..&p=.." W H px,py [px,py ...]
import { chromium } from 'playwright';
const [path, w = '1100', h = '700', ...pts] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:8780/${path}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
await page.waitForTimeout(400);
const out = await page.evaluate((pts) => {
  const { scene, camera, THREE } = window.__app, ray = new THREE.Raycaster();
  return pts.map(s => {
    const [px, py] = s.split(',').map(Number);
    ray.setFromCamera(new THREE.Vector2(px / innerWidth * 2 - 1, -(py / innerHeight) * 2 + 1), camera);
    const hit = ray.intersectObjects(scene.children, true).find(h => (h.object.visible || h.object.userData.batched) && h.object.material && !h.object.material.transparent);
    if (!hit) return `${s}: nothing`;
    const chain = []; let o = hit.object; while (o && chain.length < 8) { const u = o.userData || {}; chain.push(u.id || u.name || o.name || o.type); o = o.parent; }
    const p = hit.point; return `${s}: d=${hit.distance.toFixed(2)} plan(${p.x.toFixed(2)}, ${(-p.z).toFixed(2)}, h ${p.y.toFixed(2)}) :: ${chain.join(' < ')}`;
  });
}, pts);
console.log(out.join('\n'));
await browser.close();
