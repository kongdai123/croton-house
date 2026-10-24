// Roaming test: simulate minutes of pet behaviour in the live app and check coverage, collisions, lot bounds and ground height.
// usage: node tools/pets_roam.mjs [minutes=8] [seed=1] [doors=open|default]
// Steps window.__app.pets.update(1/30) synchronously (no rendering), so it is deterministic for a seed.
import { chromium } from 'playwright';
const minutes = +(process.argv[2] ?? 8), seed = +(process.argv[3] ?? 1), doors = process.argv[4] ?? 'open';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
let errs = 0;
page.on('pageerror', e => { errs++; console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error') { errs++; console.log('[console.error]', m.text().slice(0, 300)); } });
await page.goto(`http://127.0.0.1:8780/index.html?x=-12&y=-12.5&h=0&pins=0&fast=1&petseed=${seed}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
if (doors === 'open') {
  await page.evaluate(() => {
    const A = window.__app;
    for (const d of A.getDoors()) {
      const open = d.kind === 'french' || d.kind === 'bifold' ? d.target > 0.5 : d.kind === 'slider' ? d.open > 0.3 : Math.abs(d.target ?? 0) > 0.1;
      if (!open) A.interact.toggleDoor(d);
    }
  });
  await page.waitForTimeout(2500);   // doors ease open in the frame loop; the pets' grid rebuilds once they settle
}
const res = await page.evaluate(({ minutes }) => {
  const A = window.__app, P = A.pets;
  // colliders as the pets see them (walls, furniture, closed doors, movables, open leaves) minus the pets' own lot fences
  P.rebuild();
  const rects = P.colliders().filter(c => !/^pet-(lot|street)/.test(c.tag)).map(c => c.circle ? { x0: c.x - c.r * 0.7, x1: c.x + c.r * 0.7, z0: c.z - c.r * 0.7, z1: c.z + c.r * 0.7, tag: c.tag } : c);
  const E = P.lotEdge, dt = 1 / 30, steps = Math.round(minutes * 60 / dt);
  const stats = {};
  for (const a of P.agents) stats[a.name] = { areas: {}, indoorS: 0, outdoorS: 0, modes: {}, states: {}, minClr: 9, hits: 0, deepHits: 0, outLot: 0, maxY: -9, perched: 0, jumps: 0, dist: 0, worst: null, groundErr: [], stuckMax: 0, samples: 0 };
  const last = {};
  for (const a of P.agents) last[a.name] = { x: a.x, z: a.z, state: a.state };
  const t0 = performance.now();
  for (let k = 0; k < steps; k++) {
    P.update(dt);
    for (const a of P.agents) {
      const S = stats[a.name], L = last[a.name];
      S.dist += Math.hypot(a.x - L.x, a.z - L.z);
      if (a.state === 'jump' && L.state !== 'jump') S.jumps++;
      L.x = a.x; L.z = a.z; L.state = a.state;
      if (k % 6) continue;
      S.samples++;
      const ar = P.areaOf(a.x, a.z); S.areas[ar] = (S.areas[ar] ?? 0) + 0.2;
      if (['patio', 'courtyard', 'garden', 'front'].includes(ar)) S.outdoorS += 0.2; else S.indoorS += 0.2;
      S.modes[a.s.mode] = (S.modes[a.s.mode] ?? 0) + 0.2; S.states[a.state] = (S.states[a.state] ?? 0) + 0.2;
      if (a.perch) { S.perched += 0.2; continue; }
      const plan = -a.z;
      if (a.x < E.x0 || a.x > E.x1 || plan < E.yStreet || plan > E.yBack) S.outLot++;
      if (a.state === 'jump') continue;
      // clearance of the body centre to the nearest collider rect (exact, not the grid)
      let m = 9;
      let tag = '';
      for (const c of rects) { const dx = Math.max(c.x0 - a.x, 0, a.x - c.x1), dz = Math.max(c.z0 - a.z, 0, a.z - c.z1); const d = Math.hypot(dx, dz); if (d < m) { m = d; tag = c.tag; } }
      if (m < S.minClr) { S.minClr = m; S.worst = { x: +a.x.toFixed(2), planY: +(-a.z).toFixed(2), clr: +m.toFixed(3), state: a.state, area: ar, tag }; }
      if (m < a.r * 0.5) S.hits++;
      if (m < 0.02) S.deepHits++;
      if (S.samples % 10 === 0) S.groundErr.push(+(a.y - P.groundY(a.x, a.z)).toFixed(3));
    }
  }
  const ms = performance.now() - t0;
  // ground truth: raycast the scene straight down at sampled positions of each pet's track
  const out = { steps, simMin: minutes, wallMs: Math.round(ms), perStepMs: +(ms / steps).toFixed(3), stats: P.stats };
  for (const [n, S] of Object.entries(stats)) {
    const ge = S.groundErr.map(Math.abs).sort((a, b) => a - b);
    out[n] = { dist_m: +S.dist.toFixed(0), indoor_s: +S.indoorS.toFixed(0), outdoor_s: +S.outdoorS.toFixed(0), perched_s: +S.perched.toFixed(0), jumps: S.jumps,
      areas: Object.fromEntries(Object.entries(S.areas).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +v.toFixed(0)])),
      modes: Object.fromEntries(Object.entries(S.modes).map(([k, v]) => [k, +v.toFixed(0)])), states: Object.fromEntries(Object.entries(S.states).map(([k, v]) => [k, +v.toFixed(0)])),
      minClearance: +S.minClr.toFixed(3), worst: S.worst, samplesBelowHalfRadius: S.hits, samplesInside: S.deepHits, samplesOutsideLot: S.outLot, groundErrMax: ge.at(-1) ?? 0, samples: S.samples };
  }
  return out;
}, { minutes });
// surface-height check against the real geometry at a few final positions
const ground = await page.evaluate(() => {
  const A = window.__app, P = A.pets, THREE = A.THREE, rc = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), o = new THREE.Vector3();
  const petRoots = new Set(P.agents.map(a => a.root)); const out = [];
  const pts = [[2.2, -2.0], [1.3, 2.4], [0.5, 8.5], [-11, 12], [0.2, -9.3], [2.9, -12.4], [-10.5, 3.0], [5.3, 3.4]];
  // batch.js hides the original static meshes (they stay raycastable) and draws merged copies, so test against everything
  const meshes = []; A.scene.traverse(m => { if (m.isMesh && !m.isSkinnedMesh) { let p = m, pet = false; while (p) { if (petRoots.has(p)) { pet = true; break; } p = p.parent; } if (!pet) meshes.push(m); } });
  const veg = /plant|palm|garden-|grass|leaf|flower|shrub|fern|tree/i;
  for (const [x, py] of pts) {
    rc.set(o.set(x, 0.6, -py), down); rc.far = 1.0;
    const hits = rc.intersectObjects(meshes, false).filter(h => h.point.y < 0.4 && !veg.test(h.object.name + ' ' + (h.object.material?.name ?? '')));
    const colNear = P.colliders().filter(c => !c.circle && x >= c.x0 - 0.3 && x <= c.x1 + 0.3 && -py >= c.z0 - 0.3 && -py <= c.z1 + 0.3).map(c => c.tag);
    out.push({ x, planY: py, area: P.areaOf(x, -py), pets: +P.groundY(x, -py).toFixed(3), scene: hits[0] ? +hits[0].point.y.toFixed(3) : null, what: hits[0]?.object.name || hits[0]?.object.material?.name || '', colNear });
  }
  return out;
});
console.log(JSON.stringify(res, null, 1));
console.log('ground (pets groundY vs first surface hit):'); for (const g of ground) console.log(' ', JSON.stringify(g));
console.log('errors', errs);
await browser.close();
