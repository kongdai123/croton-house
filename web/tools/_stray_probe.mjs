import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:8780/index.html?auto=1&pets=0&dusk&x=-6.3&y=-4.2&h=10&p=0.55&eye=1.6`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
await page.waitForTimeout(600);
const r = await page.evaluate(() => {
  const { scene } = window.__app, out = [];
  scene.traverse(o => {
    if (o.isLight && !o.isDirectionalLight && !o.isHemisphereLight && !o.isAmbientLight) {
      const p = o.getWorldPosition(new o.position.constructor());
      if (p.x < -2.5 && p.z > 0.5) out.push({ type: o.type, name: o.name, p: [p.x, p.y, p.z].map(v => +v.toFixed(2)), I: +o.intensity.toFixed(2), vis: o.visible, sw: o.userData.lightSwitch ? (o.userData.lightSwitch.label.en) : null, parent: o.parent?.name });
    }
  });
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
