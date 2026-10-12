// Multi-view screenshot without UI, with per-view vertical fov.
// usage: node tools/kshot.mjs W H out1.png "x,y,h,p,eye,fov" [out2.png "x,y,h,p,eye,fov" ...]
import { chromium } from 'playwright';
const [w, h, ...rest] = process.argv.slice(2);
const views = []; for (let i = 0; i < rest.length; i += 2) views.push([rest[i], rest[i + 1].split(',').map(Number)]);
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 300)); });
const [x0, y0, h0, p0, e0] = views[0][1];
await page.goto(`http://127.0.0.1:8780/index.html?x=${x0}&y=${y0}&h=${h0}&p=${p0}&eye=${e0}&t=2&pins=0`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 }).catch(() => console.log('[warn] __ready timeout'));
await page.addStyleTag({ content: '#hud, #title, #minimap, #topbar, #crosshair, #label, #toast, .hud, .topbar, .minimap { display: none !important; }' });
for (const [out, [x, y, hd, p, eye, fov]] of views) {
  await page.evaluate(([x, y, hd, p, eye, fov]) => {
    const P = window.__app.player; P.eyeHeight = eye; P.eye = eye; P.teleport(x, -y, hd, p); P.viewEye = eye;
    if (fov) { const c = window.__app.camera; c.fov = fov; c.updateProjectionMatrix(); }
  }, [x, y, hd, p, eye, fov]);
  await page.waitForTimeout(900);
  const pos = await page.evaluate(() => { const c = window.__app.camera.position; return [c.x.toFixed(2), (-c.z).toFixed(2), c.y.toFixed(2)]; });
  await page.screenshot({ path: out });
  console.log('saved', out, 'cam', pos.join(','));
}
await browser.close();
