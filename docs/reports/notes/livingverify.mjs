import { chromium } from '/Users/masenov/Documents/GitHub/croton-house/web/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
const errors = [], results = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://127.0.0.1:8780/index.html?fast=1&pins=0&x=0.8&y=-1.4&h=90&p=-0.55', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
await page.evaluate(() => { window.__app.player.lock = () => {}; window.__app.markers.visible = false; });
async function pose(x, y, h, p) {
  await page.evaluate(([x, y, h, p]) => { const a = window.__app; a.player.stand(); a.player.teleport(x, -y, h, p); }, [x, y, h, p]);
  await page.waitForTimeout(400);
}
async function target(id) {
  return page.evaluate(id => {
    const a = window.__app, root = a.layout.placed.find(o => o.userData.id === id);
    if (!root) throw new Error('missing ' + id);
    window.__target = root; root.updateMatrixWorld(true);
    const probes = [];
    root.traverse(o => { if (!o.isMesh || !o.visible) return;
      const b = new a.THREE.Box3().setFromObject(o), c = b.getCenter(new a.THREE.Vector3()); probes.push(c);
      for (const t of [.2, .5, .8]) for (const u of [.2, .5, .8]) probes.push(new a.THREE.Vector3(b.min.x + (b.max.x - b.min.x) * t, b.min.y + (b.max.y - b.min.y) * u, c.z));
    });
    for (const v of probes) {
      v.project(a.camera); if (v.z < 0 || v.z > 1 || Math.abs(v.x) > .92 || Math.abs(v.y) > .65) continue;
      if (document.elementFromPoint((v.x+1)/2*innerWidth,(1-v.y)/2*innerHeight)?.id !== 'gl') continue; a.interact.pointer.set(v.x, v.y); if (a.interact.pick()?.root === root) return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
    }
    throw new Error('unreachable ' + id);
  }, id);
}
try {
  for (const [id, pos] of [['living-sofa', [.8, -1.4, 90, -.55]], ['living-window-seat', [.8, -3.4, 125, -.6]]]) {
    await pose(...pos); const px = await target(id); await page.mouse.move(px.x, px.y); await page.waitForTimeout(180); console.log('sit target',id,px,await page.evaluate(()=>({pick:window.__app.interact.pick()?.root?.userData.id,label:document.getElementById('label').textContent}))); await page.mouse.down(); await page.waitForTimeout(90); await page.mouse.up(); await page.waitForTimeout(1100);
    assert.equal(await page.evaluate(() => window.__app.player.seat?.root === window.__target), true);
    const seated = await page.evaluate(() => ({ root: window.__app.player.seat.root.userData.id, kind: window.__app.player.seat.kind, facing: window.__app.player.seat.facing }));
    await page.keyboard.press('KeyW'); await page.waitForTimeout(300); assert.equal(await page.evaluate(() => !!window.__app.player.seat), false);
    results.push({ check: 'sit and stand', ...seated }); console.log('PASS sit and stand', seated);
  }
  await pose(2.7, -3.8, 45, -.7); let px = await target('living-side-bench');
  const home = await page.evaluate(() => window.__target.position.toArray());
  await page.mouse.move(px.x, px.y); await page.waitForTimeout(180); console.log('bench target',px,await page.evaluate(()=>({pick:window.__app.interact.pick()?.root?.userData.id,element:document.elementFromPoint((window.__app.interact.pointer.x+1)/2*innerWidth,(1-window.__app.interact.pointer.y)/2*innerHeight)?.id}))); await page.mouse.down();
  for (let k = 1; k <= 20; k++) { await page.mouse.move(px.x - 4 * k, px.y + 3 * k); await page.waitForTimeout(40); }
  await page.waitForTimeout(400); await page.mouse.up();
  console.log('grab',await page.evaluate(()=>({grab:window.__app.interact.grab?.root?.userData.id,pos:window.__target.position.toArray()}))); const moved = await page.evaluate(home => window.__target.position.distanceTo(new window.__app.THREE.Vector3(...home)), home); assert(moved > .05);
  px = await target('living-side-bench'); await page.mouse.click(px.x, px.y, { button: 'right' });
  const menu = await page.locator('#ctxmenu button').allTextContents(); await page.locator('#ctxmenu button').first().click();
  await page.waitForFunction(home => window.__target.position.distanceTo(new window.__app.THREE.Vector3(...home)) < .005, home);
  assert.deepEqual(home, [3.78, 0, 2.78]);
  results.push({ check: 'console drag and right-click return', home, moved, menu }); console.log('PASS console drag and right-click return', { home, moved, menu });
  const paths = await page.evaluate(() => {
    const a = window.__app, P = a.player, T = a.THREE;
    const d = a.getDoors().find(d => d.id === 'ca2bb42b5a');
    if (!d) throw new Error('front door missing');
    if (Math.abs(d.target ?? 0) < .1) a.interact.toggleDoor(d);
    for (let k = 0; k < 60; k++) a.interact.update(1 / 30);
    const paths = [
      { name: 'front door to dining', points: [[0, -5.5], [0, -3.6], [.65, -3.4], [.65, .3], [1.85, 1.9]] },
      { name: 'living to kitchen aisle', points: [[.65, -.1], [.55, .8], [-2.6, .8], [-2.6, -.5]] },
      { name: 'living to hall', points: [[.65, .3], [3.2, .3], [4.52, .3], [4.52, -1.6]] }
    ];
    return paths.map(path => {
      P.stand(); P.teleport(path.points[0][0], -path.points[0][1]); P.viewEye = null;
      let maxDeviation = 0, blocked = null;
      for (let i = 1; i < path.points.length; i++) {
        const [x0, y0] = path.points[i - 1], [x1, y1] = path.points[i], n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / .025);
        for (let j = 1; j <= n; j++) {
          P.move(new T.Vector3((x1 - x0) / n, 0, -(y1 - y0) / n));
          const x = x0 + (x1 - x0) * j / n, y = y0 + (y1 - y0) * j / n, deviation = Math.hypot(P.pos.x - x, -P.pos.z - y);
          maxDeviation = Math.max(maxDeviation, deviation); if (deviation > .05 && !blocked) blocked = { x, y, actual: [P.pos.x, -P.pos.z] };
        }
      }
      return { name: path.name, maxDeviation, blocked, end: [P.pos.x, -P.pos.z] };
    });
  });
  console.log('capsule paths', JSON.stringify(paths)); paths.forEach(p => assert(!p.blocked, p.name + ' blocked')); results.push(...paths);
  assert.deepEqual(errors, []); console.log('PASS living checks; no console errors');
  await writeFile('living_verify.json', JSON.stringify({ results, errors }, null, 2));
} finally { await browser.close(); }
