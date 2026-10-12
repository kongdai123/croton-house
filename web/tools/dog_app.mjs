// In-app dog check: loads the real walkthrough and puts the dog on the floor in front of the camera — through roam.js
// (window.__app.pets.get('dog').hold) when it is wired, otherwise injected via tools/dog_inject.bundle.js. Measures draw
// calls / frame time with and without the dog and the cost of pet.update(), screenshots compare/pets/dog_app_<spot>.png
// and reports console errors. usage: cd web && node tools/dog_build.mjs && node tools/dog_app.mjs [fast]
import { chromium } from 'playwright';
const OUT = new URL('../../compare/pets/', import.meta.url).pathname;
const fast = process.argv[2] === 'fast';
const SPOTS = [['living', -0.6, -2.2, 75, 'idle', 1.9], ['garden', 1, 13, 185, 'walk', 1.9], ['closeup', 0.4, -2.6, 75, 'sit', 1.15], ['family', -1.0, 2.6, 0, 'lie', 1.9]];
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text().slice(0, 240)}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const [, x0, y0, h0] = SPOTS[0];
await page.goto(`http://127.0.0.1:8780/index.html?x=${x0}&y=${y0}&h=${h0}&p=-0.42&pins=0&petseed=3${fast ? '&fast=1' : ''}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 150000 });
await page.waitForTimeout(1500);
const viaRoam = await page.evaluate(() => !!window.__app.pets?.get?.('dog'));
if (!viaRoam) await page.addScriptTag({ url: '/tools/dog_inject.bundle.js' });
console.log(viaRoam ? 'dog driven by roam.js (window.__app.pets)' : 'no window.__app.pets yet: injecting the dog into __app.scene');
const stats = () => page.evaluate(async () => {
  const a = window.__app, i = a.renderer.info; await new Promise((r) => setTimeout(r, 400));
  i.autoReset = false; i.reset(); const t = []; let last = performance.now();
  await new Promise((res) => { let k = 0; const f = () => { const now = performance.now(); t.push(now - last); last = now; if (++k < 60) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  const calls = i.render.calls / 60, tris = i.render.triangles / 60; i.autoReset = true; t.sort((p, q) => p - q);
  return { calls: Math.round(calls), tris: Math.round(tris), medMs: +t[30].toFixed(1) };
});
for (const [name, x, y, h, mode, dist] of SPOTS) {
  await page.evaluate(([x, y, h]) => window.__app.player.teleport(x, -y, h, -0.42), [x, y, h]);
  await page.evaluate(() => { const d = window.__dog; if (d) d.pet.root.visible = false; });
  const base = await stats();
  const info = await page.evaluate(([mode, dist]) => {
    const a = window.__app, T = a.THREE, cam = a.camera;
    let d = window.__dog;
    if (!d) {
      const agent = a.pets?.get?.('dog'), pet = agent ? agent.pet : window.__dogInject.createPet();
      if (!pet.root.parent) a.scene.add(pet.root);
      d = window.__dog = { pet, agent, mode, t: 0, cpu: 0, n: 0 };
      const upd = pet.update.bind(pet);
      pet.update = (dt, s) => { const t0 = performance.now(); upd(dt, s); d.cpu += performance.now() - t0; d.n++; };
      let last = performance.now();
      const tick = () => {   // walking: advance the held position along a gentle left turn
        const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now; d.t += dt;
        const walk = d.mode === 'walk', sp = walk ? pet.walkSpeed : 0, tu = walk ? 0.9 : 0, H = d.hold;
        H.yaw += tu * dt; H.x += Math.sin(H.yaw) * sp * dt; H.z += Math.cos(H.yaw) * sp * dt; Object.assign(H, { speed: sp, turn: tu, mode: d.mode, look: cam.position });
        if (!d.agent) { pet.root.position.set(H.x, H.y, H.z); pet.root.rotation.y = H.yaw; pet.update(dt, { ...H, t: d.t, jumpT: 0, camDist: cam.position.distanceTo(pet.root.position) }); }
        requestAnimationFrame(tick);
      };
      d.hold = { x: 0, y: 0, z: 0, yaw: 0 }; if (agent) agent.hold = d.hold;
      requestAnimationFrame(tick);
    }
    d.mode = mode; d.pet.root.visible = true;
    // floor `dist` ahead of the camera: first upward face of a big surface near foot level (not a plant, pebble or counter)
    cam.updateMatrixWorld(); const f = new T.Vector3(); cam.getWorldDirection(f); f.y = 0; f.normalize();
    const at = cam.position.clone().addScaledVector(f, dist), ray = new T.Raycaster(new T.Vector3(at.x, cam.position.y, at.z), new T.Vector3(0, -1, 0), 0, 3);
    ray.camera = cam; d.pet.root.visible = false; const hits = ray.intersectObjects(a.scene.children, true); d.pet.root.visible = true;
    const big = (o) => { const g = o.geometry; if (!g) return false; if (!g.boundingSphere) g.computeBoundingSphere(); return g.boundingSphere.radius * o.matrixWorld.getMaxScaleOnAxis() > 0.8; };
    const hit = hits.find((h) => h.face && h.point.y < a.player.pos.y + 0.3 && h.face.normal.clone().transformDirection(h.object.matrixWorld).y > 0.8 && big(h.object));
    Object.assign(d.hold, { x: at.x, y: hit ? hit.point.y : 0, z: at.z, yaw: Math.atan2(cam.position.x - at.x, cam.position.z - at.z) + (mode === 'walk' ? 1.2 : 0.5) });
    d.cpu = 0; d.n = 0;
    return { floor: hit ? +hit.point.y.toFixed(3) : null };
  }, [mode, dist]);
  await page.waitForTimeout(mode === 'sit' || mode === 'lie' ? 2500 : 1000);
  const withDog = await stats();
  await page.screenshot({ path: `${OUT}dog_app_${name}.png` });
  const cpu = await page.evaluate(() => +(window.__dog.cpu / Math.max(1, window.__dog.n)).toFixed(4));
  console.log(name.padEnd(8), mode.padEnd(5), JSON.stringify({ floor: info.floor, callsWithout: base.calls, callsWith: withDog.calls, dogCalls: withDog.calls - base.calls, msWithout: base.medMs, msWith: withDog.medMs, updateMs: cpu }));
}
console.log(errors.length ? `console errors/warnings (${new Set(errors).size} distinct):\n  ` + [...new Set(errors)].join('\n  ') : 'no console errors or warnings');
await browser.close();
