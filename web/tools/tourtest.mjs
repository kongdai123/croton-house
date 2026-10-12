// Step the guided tour headlessly (logic only, no rendering) and report how close the camera gets to any collider,
// plus frame-to-frame camera jitter. Saves a few mid-flight screenshots. usage: node tools/tourtest.mjs [outDir]
import { chromium } from 'playwright';
const out = process.argv[2] || '/tmp/ch/tour';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:8780/index.html?x=0&y=-11.5&h=0&fast=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
const res = await page.evaluate(async () => {
  const a = window.__app, dt = 1 / 30, log = [], snaps = [];
  a.tourCtl.start();
  let worst = { c: 9 }, jitter = 0, prev = null, steps = 0, stop = -1;
  let grid = a.nav.buildGrid(a.player.extraColliders?.() ?? []);
  // every swinging leaf as (pivot, local x range); a camera inside a leaf's slab is a clip
  const T = a.THREE, leaves = [];
  const doors = a.getDoors();
  for (const d of doors) {
    if (d.pivot) { d.pivot.updateMatrixWorld(true); const c = new T.Box3().setFromObject(d.pivot).getCenter(new T.Vector3()); const side = d.pivot.worldToLocal(c.clone()).x >= 0 ? 1 : -1; leaves.push({ d, p: d.pivot, x0: side > 0 ? 0 : -d.w, x1: side > 0 ? d.w : 0 }); }
    if (d.kind === 'french') for (const l of d.leaves) { const lw = d.w / d.leaves.length, s = l.hingeLeft ? 1 : -1; leaves.push({ d, p: l.pivot, x0: Math.min(0, s * lw), x1: Math.max(0, s * lw) }); }
  }
  const doorLog = []; const wasOpen = new Map();
  const leafHit = (cam) => { for (const L of leaves) { L.p.updateMatrixWorld(true); const q = L.p.worldToLocal(cam.clone()); if (q.y > 0 && q.y < 2.1 && Math.abs(q.z) < 0.1 && q.x > L.x0 - 0.05 && q.x < L.x1 + 0.05) return L.d.id; } return null; };
  while (a.tourCtl.active && steps < 30 * 400) {
    a.tourCtl.update(dt); a.viewpoints.update(dt); a.player.update(dt); a.interact.update(dt); steps++;
    const c = a.camera.position, clr = c.y > 2.6 ? 9 : grid.at(c.x, c.z);   // aerial stops fly above walls and planting
    if (clr < worst.c) worst = { c: clr, x: c.x, y: -c.z, stop: a.tourCtl.i, phase: a.tourCtl.phase };
    const lh = leafHit(c); if (lh) log.push(`stop ${a.tourCtl.i} ${a.tourCtl.phase}: camera inside door leaf ${lh} at (${c.x.toFixed(2)}, ${(-c.z).toFixed(2)})`);
    for (const d of doors) { const o = d.kind === 'french' ? d.target > 0.5 : Math.abs(d.target ?? 0) > 0.1; if (wasOpen.has(d) && wasOpen.get(d) !== o) doorLog.push(`stop ${a.tourCtl.i}: ${d.id} ${o ? 'opens' : 'closes'}`); wasOpen.set(d, o); }
    if (clr < 0.08) log.push(`stop ${a.tourCtl.i} ${a.tourCtl.phase}: clearance ${clr.toFixed(2)} at plan (${c.x.toFixed(2)}, ${(-c.z).toFixed(2)})`);
    if (prev && c.y < 2 && prev.y < 2) { const dy = Math.abs(c.y - prev.y); jitter = Math.max(jitter, dy); }
    prev = c.clone();
    if (a.tourCtl.i !== stop) { stop = a.tourCtl.i; grid = a.nav.buildGrid(a.player.extraColliders?.() ?? []); }
    if (a.viewpoints.fly && Math.abs(a.viewpoints.fly.t - 0.5) < dt / a.viewpoints.fly.dur / 2 + 1e-6) snaps.push({ i: a.tourCtl.i, x: c.x, y: -c.z, h: a.player.heading });
  }
  return { worst, jitter, log: log.slice(0, 40), nlog: log.length, steps, snaps, doorLog };
});
console.log(JSON.stringify({ ...res, snaps: undefined, doorLog: undefined }, null, 1));
console.log('doors:', res.doorLog.join(' | '));
console.log('mid-flight samples:', res.snaps.map(s => `#${s.i} (${s.x.toFixed(2)}, ${s.y.toFixed(2)}) h${s.h.toFixed(0)}`).join(' | '));
await browser.close();
