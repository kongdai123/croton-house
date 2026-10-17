/* global T -- defined on window by the page.evaluate setup below */
// Pet interaction checks in the real app: node tools/pets_interact.mjs [outDir]
// 1. "Pet the …" label only when close + facing + not through a wall; click pets (reaction, extension, then roams again).
// 2. HUD call buttons bring the right pet from another room / the garden to ~0.8 m in front of the player, sitting and
//    looking up; a closed door gives the "can't reach you" toast. Renders go to compare/pets/.
import { chromium } from 'playwright';
const outDir = process.argv[2] ?? '../compare/pets';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || /pet failed/.test(m.text())) errors.push(m.text().slice(0, 300)); });
page.on('pageerror', e => errors.push('pageerror ' + e.message));
await page.goto('http://127.0.0.1:8780/index.html?x=1&y=-2&h=180&pins=0&petseed=5', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
await page.evaluate(() => {
  const app = window.__app, P = app.pets, pl = app.player;
  window.T = {
    park(name, x, z, yaw = 0) { const a = P.get(name); a.hold = null; a.perch = null; a.path = null; a.call = null; a.x = x; a.z = z; a.yaw = yaw; a.state = 'pause'; a.mode = 'idle'; a.st = 0; a.dur = 999; a.followUntil = 0; return a; },
    stash(name) { if (P.get(name)) P.hold(name, { x: -9.5, z: -12.5, mode: 'lie' }); },
    view(px, pz, tx, tz, ty = 0.18) { pl.pos.set(px, 0, pz); pl.yaw = Math.atan2(-(tx - px), -(tz - pz)); pl.pitch = Math.atan2(ty - 1.62, Math.hypot(tx - px, tz - pz)); pl.update(1 / 60); app.camera.updateMatrixWorld(); },
    label() { app.interact.update(1 / 60); const l = document.getElementById('label'); return l.classList.contains('show') ? l.textContent : ''; },
    step(sec, render = false) { const n = Math.round(sec * 30); for (let i = 0; i < n; i++) { P.update(1 / 30); pl.update(1 / 30); if (render && i === n - 1) window.renderAt(performance.now() / 1000); } },
    state(name) { const a = P.get(name); return { state: a.state, mode: a.s.mode, x: +a.x.toFixed(2), z: +a.z.toFixed(2), yaw: +a.yaw.toFixed(2), attend: a.s.attend, petLeft: +(a.s.petLeft ?? 0).toFixed(2) }; },
  };
});
const ev = (fn, arg) => page.evaluate(fn, arg);
const shot = async (name) => { await ev(() => window.renderAt(performance.now() / 1000)); await page.screenshot({ path: `${outDir}/${name}.png` }); console.log('saved', `${outDir}/${name}.png`); };
const report = {};
const PETS = await page.evaluate(() => window.__app.pets.agents.map(a => a.name));
console.log('pets present:', PETS.join(', '));
for (const pet of PETS) {
  const other = pet === 'cat' ? 'dog' : 'cat';
  const r = await ev(({ pet, other }) => {
    const out = {}; T.stash(other);
    T.park(pet, 1.0, 3.0, 0); T.step(0.6);
    T.view(1.0, 2.0, 1.0, 3.0); out.closeFacing = T.label();
    T.view(1.0, 1.0, 1.0, 3.0); out.far2m = T.label();
    T.view(1.0, 2.0, 1.0, 3.0); window.__app.player.yaw += 1.2; window.__app.player.update(1 / 60); window.__app.camera.updateMatrixWorld(); out.closeLookingAway = T.label();
    T.park(pet, 4.6, 3.3, -1.57); T.step(0.4);
    T.view(3.72, 3.3, 4.6, 3.3); out.throughWall = T.label();
    T.park(pet, 1.0, 3.0, 2.5); T.step(0.4); T.view(1.0, 2.0, 1.0, 3.0); T.label();
    window.__app.interact.press(); window.__app.interact.release();
    out.afterClick = T.state(pet); T.step(1.2); out.after1s = T.state(pet);
    return out;
  }, { pet, other });
  await shot(`${pet}_petting`);
  const r2 = await ev(({ pet }) => {
    const out = {}; T.step(2.5); out.at3_7s = T.state(pet);
    T.view(1.0, 2.0, 1.0, 3.0); T.label(); window.__app.interact.press(); window.__app.interact.release();   // pet again: extends
    T.step(3.0); out.at6_7s_extended = T.state(pet);
    T.step(6.5); out.at13s = T.state(pet);
    return out;
  }, { pet });
  report[pet] = { ...r, ...r2 };
}
// close-ups of the petting reaction (narrow lens from where the player stands, hearts included)
for (const pet of PETS) {
  await ev(({ pet }) => {
    const app = window.__app, P = app.pets, pl = app.player; for (const a of P.agents) T.stash(a.name);
    const a = T.park(pet, 1.0, 3.0, 2.6); T.step(0.5); T.view(1.0, 2.15, 1.0, 3.0); P.pet(a); T.step(1.9);
    pl.driven = true; const c = app.camera; c.fov = 30; c.updateProjectionMatrix();
    c.position.set(a.x + Math.sin(a.yaw) * 0.85 + 0.2, 0.42, a.z + Math.cos(a.yaw) * 0.85); c.lookAt(a.x, 0.2, a.z);
    for (const id of ['hud']) document.getElementById(id).style.visibility = 'hidden';
  }, { pet });
  await shot(`${pet}_petting_close`);
  await ev(() => { const app = window.__app; app.camera.fov = 62; app.camera.updateProjectionMatrix(); app.player.driven = false; document.getElementById('hud').style.visibility = ''; });
}
// HUD label render (cat close + facing)
await ev(() => { T.stash('dog'); T.park('cat', 1.0, 3.0, 2.8); T.step(0.8); T.view(1.0, 2.05, 1.0, 3.0); T.label(); });
await shot('cat_pet_label');
// call buttons: the cat from bedroom B, the dog from the back-garden lounge, the player in the living room
const calls = {};
for (const [pet, from, btn] of [['cat', [5.4, -3.4], '#btn-callcat'], ['dog', [2.9, -12.9], '#btn-calldog']].filter(c => PETS.includes(c[0]))) {
  await ev(({ pet, from }) => { for (const a of window.__app.pets.agents) T.stash(a.name); T.park(pet, from[0], from[1], 0); T.view(1.3, 2.6, 1.3, 1.6, 0.5); }, { pet, from });
  await page.click(btn);
  calls[pet] = await ev(({ pet }) => {
    const P = window.__app.pets, a = P.get(pet), pl = window.__app.player, out = { start: T.state(pet) }; let t = 0, dist = 0, last = [a.x, a.z];
    while (t < 60 && a.state !== 'attend') { T.step(0.2); t += 0.2; dist += Math.hypot(a.x - last[0], a.z - last[1]); last = [a.x, a.z]; }
    const f = pl.forward(), dx = a.x - pl.pos.x, dz = a.z - pl.pos.z, d = Math.hypot(dx, dz);
    out.arrivedAfter = +t.toFixed(1); out.travelled = +dist.toFixed(1); out.avgSpeed = +(dist / Math.max(0.1, t)).toFixed(2); out.end = T.state(pet);
    out.distToPlayer = +d.toFixed(2); out.inFront = +((dx * f.x + dz * f.z) / d).toFixed(2); out.looksAtPlayer = !!a.s.look;
    return out;
  }, { pet });
  await ev(({ pet }) => { const a = window.__app.pets.get(pet), pl = window.__app.player; T.step(1.2); pl.yaw = Math.atan2(-(a.x - pl.pos.x), -(a.z - pl.pos.z)); pl.pitch = -0.85; pl.update(1 / 60); }, { pet });
  await shot(`${pet}_called`);
  // the player walks off: the pet re-plans and follows
  calls[pet].replan = await ev(({ pet }) => { const a = window.__app.pets.get(pet), pl = window.__app.player; pl.pos.set(2.6, 0, 2.2); T.step(1.6); let t = 1.6; while (t < 20 && !(a.state === 'attend' && window.__app.pets.t - a.call?.at > 0.5)) { T.step(0.2); t += 0.2; } return { after: +t.toFixed(1), distToPlayer: +Math.hypot(a.x - pl.pos.x, a.z - pl.pos.z).toFixed(2), state: a.state }; }, { pet });
}
// unreachable: player shut in bedroom 3, the cat outside
calls.unreachable = await ev(async () => {
  const app = window.__app, d = app.getDoors().find(x => x.id === '60bf34160a');
  app.interact.toggleDoor(d); for (let i = 0; i < 45; i++) app.interact.update(1 / 30);
  for (let i = 0; i < 30; i++) app.pets.update(1 / 30);
  T.stash('dog'); T.park('cat', 1.3, 2.4, 0); T.view(4.75, 3.0, 4.75, 4.0, 0.5);
  document.getElementById('btn-callcat').click();
  const toast = document.getElementById('toast').textContent;
  const a = app.pets.get('cat'); let t = 0; while (t < 40 && a.state !== 'attend') { T.step(0.2); t += 0.2; }
  const out = { toast, arrivedAfter: +t.toFixed(1), end: T.state('cat'), distToPlayer: +Math.hypot(a.x - app.player.pos.x, a.z - app.player.pos.z).toFixed(2) };
  app.interact.toggleDoor(d); for (let i = 0; i < 45; i++) app.interact.update(1 / 30);
  return out;
});
console.log(JSON.stringify({ petting: report, calls }, null, 1));
const fails = [];
for (const [n, r] of Object.entries(report)) {
  if (!r.closeFacing) fails.push(`${n}: no label when close + facing`);
  if (r.far2m || r.closeLookingAway || r.throughWall) fails.push(`${n}: label shown when it should not be (${r.far2m}|${r.closeLookingAway}|${r.throughWall})`);
  if (r.after1s.state !== 'pet' || r.at3_7s.state !== 'pet' || r.at6_7s_extended.state !== 'pet') fails.push(`${n}: petting did not hold / extend`);
  if (Math.hypot(r.at3_7s.x - r.afterClick.x, r.at3_7s.z - r.afterClick.z) > 0.02) fails.push(`${n}: walked away while petted`);
  if (r.at13s.state === 'pet') fails.push(`${n}: never resumed`);
}
for (const n of PETS) { const c = calls[n]; if (c.end.state !== 'attend' || c.distToPlayer > 1.2 || c.inFront < 0.5) fails.push(`${n}: call did not end sitting in front (${c.end.state}, ${c.distToPlayer} m, front ${c.inFront})`); if (c.replan.distToPlayer > 1.3) fails.push(`${n}: did not follow the moved player`); }
if (!/door|门/.test(calls.unreachable.toast)) fails.push('no closed-door toast: ' + calls.unreachable.toast);
console.log(errors.length ? 'console errors:\n' + errors.join('\n') : 'no console errors');
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : 'PASS');
await browser.close();
