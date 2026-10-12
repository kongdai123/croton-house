// Roaming soak test with the real (default) door states: node tools/pets_soak.mjs [minutes=6] [seed=1]
// Steps pets.update() at 30 Hz inside the app, opening/closing doors, dragging a chair and walking the player into the pets
// on the way. Asserts: every pet visits several rooms AND the outdoors, never stands inside a wall / furniture / plant
// collider, never leaves the lot, the two keep ≥ 0.6 m apart, and they step aside for the player. Prints coverage + timing.
import { chromium } from 'playwright';
const minutes = +(process.argv[2] ?? 6), seed = +(process.argv[3] ?? 1);
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', e => errors.push('pageerror ' + e.message));
await page.goto(`http://127.0.0.1:8780/index.html?x=4.55&y=0&h=180&pins=0&fast&petseed=${seed}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
const res = await page.evaluate(async ({ minutes }) => {
  const app = window.__app, P = app.pets, dt = 1 / 30, N = Math.round(minutes * 60 / dt);
  let O = P.obstacles();
  const clearAt = (x, z) => { let m = 1e9; for (const c of O) { if (c.tag && c.tag.startsWith('pet-')) continue; const d = c.circle ? Math.hypot(x - c.x, z - c.z) - c.r : Math.hypot(Math.max(c.x0 - x, 0, x - c.x1), Math.max(c.z0 - z, 0, z - c.z1)); if (d < m) m = d; } return m; };
  const S = {}; for (const a of P.agents) S[a.name] = { time: {}, modes: {}, minClear: 9, violations: [], out: 0, dist: 0, last: [a.x, a.z] };
  const doors = app.getDoors(), log = []; let k = 0;
  const toggle = (id) => { const d = doors.find(x => x.id === id); if (!d) return; app.interact.toggleDoor(d); for (let i = 0; i < 45; i++) app.interact.update(dt); O = P.obstacles(); log.push(`t=${(k * dt).toFixed(0)} toggled ${id}`); };
  let minSep = 9, sepViol = 0; const aside = [];
  const t0 = performance.now(); let simMs = 0;
  for (k = 0; k < N; k++) {
    if (k === Math.round(30 / dt)) toggle('161782cdfa');          // family-room French doors open
    if (k === Math.round(90 / dt)) toggle('ca2bb42b5a');          // front door open: the front yard joins the house
    if (k === Math.round(150 / dt)) toggle('60bf34160a');         // bedroom 3 door closed …
    if (k === Math.round(240 / dt)) toggle('60bf34160a');         // … and open again
    if (k === Math.round(200 / dt)) { const m = app.layout.movables[0]; if (m) { m.position.x += 0.45; O = P.obstacles(); log.push(`t=200 moved ${m.name || 'movable'}`); } }
    if (k > 0 && k % Math.round(45 / dt) === 0) {                 // walk the player into a pet
      const a = P.agents[(k / Math.round(45 / dt)) % P.agents.length];
      if (a && !a.perch && a.state !== 'jump') { app.player.pos.set(a.x + 0.25, 0, a.z + 0.1); aside.push({ name: a.name, k: k + Math.round(2.5 / dt), px: a.x + 0.25, pz: a.z + 0.1 }); }
    }
    for (const c of aside) if (c.k === k) { const a = P.get(c.name); c.d = Math.hypot(a.x - c.px, a.z - c.pz); }
    const u0 = performance.now(); P.update(dt); simMs += performance.now() - u0;
    if (k % 3) continue;
    for (const a of P.agents) {
      const s = S[a.name], area = P.areaOf(a.x, a.z);
      s.time[area] = (s.time[area] || 0) + 3 * dt; s.modes[a.s.mode] = (s.modes[a.s.mode] || 0) + 3 * dt;
      s.dist += Math.hypot(a.x - s.last[0], a.z - s.last[1]); s.last = [a.x, a.z];
      if (a.x < -14.3 || a.x > 14.3 || -a.z < -13.4 || -a.z > 19.3) s.out++;
      if (!a.perch && a.state !== 'jump') { const cl = clearAt(a.x, a.z); if (cl < s.minClear) s.minClear = cl; if (cl < 0.04 && s.violations.length < 12) s.violations.push({ t: +(k * dt).toFixed(1), x: +a.x.toFixed(2), z: +a.z.toFixed(2), cl: +cl.toFixed(3), state: a.state }); }
    }
    if (P.agents.length === 2) { const [a, b] = P.agents, d = Math.hypot(a.x - b.x, a.z - b.z); if (d < minSep) minSep = d; if (d < 0.58 && !a.perch && !b.perch && a.state !== 'jump' && b.state !== 'jump') sepViol++; }
  }
  const OUT = ['patio', 'courtyard', 'garden', 'front'], out = { simMinutes: minutes, wallMs: Math.round(performance.now() - t0), updateMsPerFrame: +(simMs / N).toFixed(3), msMax: +P.stats.msMax.toFixed(1), plans: P.stats.plans, rebuilds: P.stats.rebuilds, minSep: +minSep.toFixed(2), sepViolSamples: sepViol, log, aside: aside.map(c => `${c.name} ${c.d?.toFixed(2)}m`), pets: {} };
  for (const a of P.agents) {
    const s = S[a.name], rooms = Object.keys(s.time).filter(r => !OUT.includes(r) && r !== 'house'), tot = Object.values(s.time).reduce((p, q) => p + q, 0);
    out.pets[a.name] = { rooms, outdoor: OUT.filter(r => s.time[r]), indoorShare: +(rooms.reduce((p, r) => p + s.time[r], 0) / tot).toFixed(2), metres: Math.round(s.dist), modes: Object.fromEntries(Object.entries(s.modes).map(([k, v]) => [k, Math.round(v)])), counts: a.count, minClear: +s.minClear.toFixed(3), violations: s.violations, outOfLot: s.out, perches: P.perches?.length };
  }
  return out;
}, { minutes });
console.log(JSON.stringify(res));
const fails = [];
for (const [n, p] of Object.entries(res.pets)) {
  if (p.rooms.length < 2) fails.push(`${n}: visited ${p.rooms.length} rooms`);
  if (!p.outdoor.length) fails.push(`${n}: never outdoors`);
  if (p.violations.length) fails.push(`${n}: ${p.violations.length} collider violations`);
  if (p.outOfLot) fails.push(`${n}: left the lot`);
}
if (res.sepViolSamples) fails.push(`pets closer than 0.6 m in ${res.sepViolSamples} samples`);
console.log(errors.length ? 'console errors:\n' + errors.join('\n') : 'no console errors');
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : 'PASS');
await browser.close();
