// Audit every viewpoint (Zillow photos, panoramas, RedNote spots): which room the camera stands in, its clearance from
// colliders, and how far the view runs before hitting a surface (a wall right in front = a bad viewpoint).
// usage: node tools/vpaudit.mjs [--json out.json]
import { chromium } from 'playwright';
import fs from 'node:fs';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:8780/index.html?x=0&y=-11.5&h=0&fast=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
const rows = await page.evaluate(async () => {
  const a = window.__app, T = a.THREE, house = await (await fetch('data/house.json')).json();
  const label = (r) => house.notes.filter(n => n.room === r.id).map(n => n.label).join('/') || r.id.slice(0, 6);
  const inPoly = (x, y, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  const roomAt = (x, y) => { const r = house.rooms.find(r => inPoly(x, y, r.pts)); return r ? label(r) : 'outside'; };
  const grid = a.nav.buildGrid([], { doors: true });
  const ray = new T.Raycaster(); ray.far = 30;
  const targets = [...a.viewpoints.targets, ...a.rednote.blips().map(b => ({ ...b, kind: 'rn', eye: 1.6 }))];
  const meshes = []; a.scene.traverse(o => { if (o.isMesh && o.visible && !o.userData.noPick && o !== a.viewpoints.sphere) meshes.push(o); });
  const out = [];
  for (const v of targets) {
    const x = v.x, y = v.y, h = v.heading ?? 0, eye = v.eye ?? 1.5;
    const yaw = -h * Math.PI / 180, pitch = v.pitch ?? 0;
    const fwd = new T.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const origin = new T.Vector3(x, eye, -y);
    // forward distance: median of a small cone of rays (centre ± 15° yaw)
    const ds = [];
    for (const dy of [-15, 0, 15]) { const d = fwd.clone().applyAxisAngle(new T.Vector3(0, 1, 0), dy * Math.PI / 180); ray.set(origin, d); const hit = ray.intersectObjects(meshes, false)[0]; ds.push(hit ? +hit.distance.toFixed(2) : 30); }
    ray.set(origin, fwd); const hit0 = ray.intersectObjects(meshes, false)[0];
    let hitName = ''; if (hit0) { let o = hit0.object; while (o && !o.name && o.parent) o = o.parent; hitName = (o?.name || hit0.object.name || '').slice(0, 28); }
    out.push({ kind: v.kind, id: v.id, title: (v.title || v.zh || '').toString().slice(0, 24), x: +x.toFixed(2), y: +y.toFixed(2), h: Math.round(h), room: roomAt(x, y), clr: +grid.at(x, -y).toFixed(2), front: ds, hit: hitName });
  }
  return out;
});
const bad = (r) => r.clr < 0.12 || Math.min(...r.front) < 0.7;
for (const r of rows) console.log(`${bad(r) ? '!!' : '  '} ${r.kind.padEnd(6)} ${String(r.id).padEnd(12)} ${r.title.padEnd(24)} (${r.x}, ${r.y}) h${r.h}  room=${r.room.padEnd(18)} clr=${r.clr}  front=${r.front.join('/')}  ${r.hit}`);
const i = process.argv.indexOf('--json'); if (i > 0) fs.writeFileSync(process.argv[i + 1], JSON.stringify(rows, null, 1));
await browser.close();
