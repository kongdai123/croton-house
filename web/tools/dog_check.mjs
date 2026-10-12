// Dog verification: foot sliding at several speeds, update() CPU cost, draw calls, GLB export + re-import.
// usage: cd web && node tools/dog_build.mjs && node tools/dog_check.mjs [noexport]
import { chromium } from 'playwright';
import fs from 'node:fs';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) console.log('[console]', m.text().slice(0, 300)); });
await page.goto('http://127.0.0.1:8780/tools/dog_viewer.html?auto=1&w=640&h=480', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true);
const draw = await page.evaluate(() => window.show({ view: 'q34' }));
console.log('draw calls (incl. 1 ground):', draw.calls, ' triangles:', draw.tris, ' counts:', JSON.stringify(draw.counts));
const bones = await page.evaluate(() => { const p = window.show({}); return null; });
console.log('foot slide (m/s of a planted paw, world space):');
for (const v of [0.2, 0.35, 0.6, 0.8, 0.9, 1.0]) {
  const r = await page.evaluate((v) => window.slide(v), v);
  console.log(`  speed ${v.toFixed(2)}: ` + r.paws.map((p) => `${p.paw.slice(4)} mean ${p.meanSlide} (x ${p.meanX} z ${p.meanZ}) max ${p.maxSlide} [${p.stanceFrames}f]`).join(' | '));
}
console.log('cpu ms per update():', JSON.stringify(await page.evaluate(() => window.cpu(3000))));
console.log('continuity (max per-frame change at 60 fps):');
for (const r of await page.evaluate(() => window.pops())) console.log('  ' + JSON.stringify(r));
if (process.argv[2] !== 'noexport') {
  const r = await page.evaluate(() => window.exportGLB());
  const out = new URL('../assets/pets/dog.glb', import.meta.url).pathname; fs.mkdirSync(new URL('../assets/pets/', import.meta.url).pathname, { recursive: true });
  fs.writeFileSync(out, Buffer.from(r.b64, 'base64'));
  console.log('glb', out, (r.size / 1024).toFixed(0) + ' KB', JSON.stringify(r.reimport));
}
await browser.close();
