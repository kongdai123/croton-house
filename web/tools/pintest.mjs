// Click a RedNote pin (headless, pointer unlocked), let the flight finish, screenshot the floating card.
// usage: node tools/pintest.mjs <slug> "<start query>" out.png
import { chromium } from 'playwright';
const [slug = '6ab7b98000', start = 'x=1.6&y=-0.6&h=200&p=-0.05', out = '/tmp/ch/pin_card.png'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => { if (!/pointer lock/.test(e.message)) console.log('[pageerror]', e.message); });
await page.goto(`http://127.0.0.1:8780/index.html?${start}&fast=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
await page.waitForTimeout(800);
const px = await page.evaluate((slug) => {
  const a = window.__app, pin = a.markers.pins.find(p => p.post.slug === slug); if (!pin) return null;
  const v = pin.head.getWorldPosition(new a.THREE.Vector3()).project(a.camera);
  return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, onScreen: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z < 1 };
}, slug);
console.log('pin on screen:', px);
await page.mouse.move(px.x, px.y); await page.waitForTimeout(300);
console.log('hover label:', await page.evaluate(() => document.getElementById('label').textContent));
await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up();
await page.waitForFunction(() => !window.__app.viewpoints.fly && window.__app.markers.card?.ready, null, { timeout: 20000 }).catch(() => console.log('no card'));
await page.waitForTimeout(900);
console.log('camera:', await page.evaluate(() => { const p = window.__app.player; return [p.pos.x.toFixed(2), (-p.pos.z).toFixed(2), p.heading.toFixed(0)]; }));
await page.screenshot({ path: out }); console.log('saved', out);
await browser.close();
