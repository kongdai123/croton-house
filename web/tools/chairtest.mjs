// Click vs drag vs right-click put-back on a dining chair (headless, pointer unlocked).
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const url = 'http://127.0.0.1:8780/index.html?x=1.85&y=1.2&h=-20&p=-0.45&fast=1';
const chairPx = () => page.evaluate(() => {
  const a = window.__app; window.__chair ??= a.layout.movables.find(o => Math.abs(o.position.x - 1.12) < 0.3 && Math.abs(-o.position.z - 2.78) < 0.3); const c = window.__chair;
  const v = c.position.clone(); v.y = 0.42; v.project(a.camera);
  return { px: (v.x + 1) / 2 * innerWidth, py: (1 - v.y) / 2 * innerHeight, pos: [c.position.x.toFixed(3), (-c.position.z).toFixed(3)], seat: !!a.player.seat };
});
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
await page.evaluate(() => { window.__app.player.lock = () => {}; }); // this harness uses unlocked pointer coordinates
await page.waitForTimeout(500);
let c = await chairPx(); console.log('chair', c);
// 1) plain click -> sit
await page.mouse.move(c.px, c.py); await page.waitForTimeout(200);
await page.mouse.down(); await page.waitForTimeout(120); await page.mouse.up(); await page.waitForTimeout(400);
let s = await page.evaluate(() => ({ seat: !!window.__app.player.seat, kind: window.__app.player.seat?.kind }));
console.log('after click: seated =', s.seat, s.kind, '| chair', (await chairPx()).pos);
assert(s.seat, 'plain click must sit');
// stand up
await page.keyboard.down('KeyS'); await page.waitForTimeout(300); await page.keyboard.up('KeyS'); await page.waitForTimeout(800);
await page.goto(url, { waitUntil: 'load' }); await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 }); await page.waitForTimeout(500);
await page.evaluate(() => { window.__app.player.lock = () => {}; });
c = await chairPx();
// 2) press + drag -> move
await page.mouse.move(c.px, c.py); await page.waitForTimeout(200);
await page.mouse.down();
for (let k = 1; k <= 20; k++) { await page.mouse.move(c.px + k * 6, c.py - k * 3); await page.waitForTimeout(40); }
await page.waitForTimeout(600); await page.mouse.up(); await page.waitForTimeout(200);
s = await page.evaluate(() => ({ seat: !!window.__app.player.seat }));
const moved = await chairPx(); console.log('after drag: seated =', s.seat, '| chair', moved.pos);
assert(!s.seat && Math.hypot(...moved.pos.map((p, i) => +p - +c.pos[i])) > .05, 'drag must move without sitting');
await page.screenshot({ path: '/tmp/ch/chair_dragged.png' });
// 3) right-click the moved chair -> menu -> put back
await page.mouse.move(moved.px, moved.py); await page.waitForTimeout(200);
await page.mouse.click(moved.px, moved.py, { button: 'right' }); await page.waitForTimeout(300);
const menu = await page.evaluate(() => [...document.querySelectorAll('#ctxmenu button')].map(b => b.textContent + (b.disabled ? ' (disabled)' : '')));
console.log('menu:', menu);
await page.screenshot({ path: '/tmp/ch/chair_menu.png' });
await page.click('#ctxmenu button'); await page.waitForTimeout(1000);
console.log('after put back: chair', (await chairPx()).pos);
assert.deepEqual((await chairPx()).pos, c.pos, 'put-back must restore placement');
await page.mouse.click(300, 300, { button: 'right' }); await page.waitForTimeout(300);
console.log('menu on empty floor:', await page.evaluate(() => [...document.querySelectorAll('#ctxmenu button')].map(b => b.textContent + (b.disabled ? ' (disabled)' : ''))));
await browser.close();
assert.deepEqual(errors, []); console.log('PASS chair sit, drag, right-click return; no console errors');
