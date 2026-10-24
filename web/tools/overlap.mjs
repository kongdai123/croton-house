// Report furniture pieces whose world boxes intersect each other (clipping check).
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
await page.goto('http://127.0.0.1:8780/index.html?x=0&y=-3.5&h=0&fast=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
// world boxes from the objects' own methods (no THREE handle needed)
const res = await page.evaluate(() => {
  const app = window.__app; const placed = app.layout.placed;
  const vol = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0) * Math.max(0, b.z1 - b.z0);
  const bb = (o) => { let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9; o.updateMatrixWorld(true); o.traverse(m => { if (!m.isMesh || !m.geometry) return; if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox; const corners = [[b.min.x, b.min.y, b.min.z], [b.max.x, b.min.y, b.min.z], [b.min.x, b.max.y, b.min.z], [b.min.x, b.min.y, b.max.z], [b.max.x, b.max.y, b.min.z], [b.max.x, b.min.y, b.max.z], [b.min.x, b.max.y, b.max.z], [b.max.x, b.max.y, b.max.z]]; for (const c of corners) { const v = m.localToWorld(m.position.clone().set(c[0], c[1], c[2])); x0 = Math.min(x0, v.x); y0 = Math.min(y0, v.y); z0 = Math.min(z0, v.z); x1 = Math.max(x1, v.x); y1 = Math.max(y1, v.y); z1 = Math.max(z1, v.z); } }); return { x0, y0, z0, x1, y1, z1 }; };
  const info = placed.map(o => ({ name: `${o.userData.placement.m}/${o.userData.placement.i}@(${o.userData.placement.x},${o.userData.placement.y})`, b: bb(o), kind: o.userData.placement.i }));
  const skip = /rug|Light|Shade|curtain|thermostat|pillow|bowl|book|tray|vase|Decor|pot|cushions|pampas|coleus|bromeliad|grass|shrub|croton|banana|palm|tree|cactus|edging/i;
  const out = [];
  for (let i = 0; i < info.length; i++) for (let j = i + 1; j < info.length; j++) {
    const a = info[i], b = info[j]; if (skip.test(a.kind) || skip.test(b.kind)) continue;
    const ib = { x0: Math.max(a.b.x0, b.b.x0), y0: Math.max(a.b.y0, b.b.y0), z0: Math.max(a.b.z0, b.b.z0), x1: Math.min(a.b.x1, b.b.x1), y1: Math.min(a.b.y1, b.b.y1), z1: Math.min(a.b.z1, b.b.z1) };
    const v = vol(ib); if (v > 0.004 && ib.x1 > ib.x0 + 0.03 && ib.z1 > ib.z0 + 0.03 && ib.y1 > ib.y0 + 0.03) out.push(`${a.name} × ${b.name}: ${(ib.x1 - ib.x0).toFixed(2)}×${(ib.y1 - ib.y0).toFixed(2)}×${(ib.z1 - ib.z0).toFixed(2)} m`);
  }
  return out;
});
console.log(res.join('\n') || 'no furniture overlaps');
await browser.close();
