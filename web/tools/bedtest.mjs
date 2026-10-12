// Sit on every bed (clicking at its original seat) and screenshot what the eyes see: node tools/bedtest.mjs
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:8780/index.html?x=0&y=0&h=0&fast=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
await page.waitForTimeout(500);
const n = await page.evaluate(() => {
  const a = window.__app; window.__beds = [];
  a.scene.traverse(o => { if (o.userData.seats?.some(s => s.kind === 'bed')) window.__beds.push(o); });
  return window.__beds.length;
});
for (let i = 0; i < n; i++) {
  const r = await page.evaluate((i) => {
    const a = window.__app, root = window.__beds[i], s = root.userData.seats.find(s => s.kind === 'bed');
    if (a.player.seat) a.player.stand?.();
    root.updateMatrixWorld(true);
    const click = new a.THREE.Vector3(s.x, s.y, s.z).applyMatrix4(root.matrixWorld);
    const t0 = performance.now(); a.interact.sitOn(root, click); const ms = performance.now() - t0;
    const st = a.player.seat;
    return { id: root.userData.id || root.userData.name, ms: Math.round(ms), click: [click.x.toFixed(2), (-click.z).toFixed(2)],
      seat: st && [st.position.x.toFixed(2), (-st.position.z).toFixed(2)], facingDeg: st && Math.round(st.facing * 180 / Math.PI), lookDeg: st && Math.round(st.look * 180 / Math.PI) };
  }, i);
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `/tmp/ch/bed_${i}.png` });
  console.log(JSON.stringify(r));
}
await browser.close();
