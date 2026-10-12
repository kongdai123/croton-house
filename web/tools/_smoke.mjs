import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => console.log('[pageerror]', e.message)); page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)); });
const t0 = Date.now();
await page.goto('http://127.0.0.1:8780/index.html?x=1&y=13&h=185', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
console.log('ready in', Date.now() - t0, 'ms');
console.log(await page.evaluate(async () => {
  const a = window.__app; let vis = 0; a.scene.traverseVisible(o => { if (o.isMesh) vis++; });
  const t = performance.now(); a.state.dusk = true; await a.applyTime(); const dusk = performance.now() - t;
  const t2 = performance.now(); a.state.dusk = false; await a.applyTime(); const day = performance.now() - t2;
  return `visible meshes ${vis}; day->dusk ${dusk.toFixed(0)} ms; dusk->day ${day.toFixed(0)} ms`;
}));
await page.screenshot({ path: '/tmp/ch/smoke_garden.png' });
await browser.close();
