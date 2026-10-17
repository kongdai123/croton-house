// In-app close-ups of a pet, pinned in place with pets.hold(): node tools/pets_shots.mjs [pet] [outDir] [prefix]
// Each shot: where (world x, z, yaw), pose (mode / speed / jumpT) and a camera orbit around the pet (az from its nose, el, dist, fov).
// Also writes <prefix>_vs_reference.png: the sunlit sitting shot beside the reference photo.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const pet = process.argv[2] ?? 'cat', outDir = process.argv[3] ?? '../compare/pets', prefix = process.argv[4] ?? pet;
const REF = process.env.REF_IMAGE;   // the reference photo to compare against (local file)
if (!REF) throw new Error('set REF_IMAGE to the reference photo');
fs.mkdirSync(outDir, { recursive: true });
const IN = { x: 0.9, z: 2.9 }, OUT = { x: 0.2, z: 9.3 };   // living room; sunlit front terrace (the sun is to the south)
const shots = [
  ['front', IN, 2.2, 'idle', {}, { az: 0, el: 8, dist: 0.95, fov: 30 }],
  ['34', IN, 2.2, 'idle', {}, { az: 38, el: 12, dist: 1.05, fov: 30 }],
  ['side', IN, 2.2, 'idle', {}, { az: 90, el: 6, dist: 1.25, fov: 30 }],
  ['walk', IN, 2.2, 'walk', { speed: 0.34 }, { az: 75, el: 10, dist: 1.3, fov: 30 }],
  ['sit', IN, 2.2, 'sit', {}, { az: 30, el: 5, dist: 1.0, fov: 30 }],
  ['lie', IN, 2.2, 'lie', {}, { az: 45, el: 20, dist: 1.1, fov: 30 }],
  ['jump_crouch', IN, 2.2, 'jump', { jumpT: 0.2 }, { az: 70, el: 10, dist: 1.2, fov: 30 }],
  ['jump_air', IN, 2.2, 'jump', { jumpT: 0.55, lift: 0.22 }, { az: 80, el: 8, dist: 1.4, fov: 30 }],
  ['face', IN, 2.2, 'idle', {}, { az: 14, el: 4, dist: 0.48, fov: 30, look: 0.27, fwd: 0.17 }],
  ['sun_sit', OUT, 0.3, 'sit', {}, { az: 28, el: -2, dist: 0.95, fov: 32, look: 0.17 }],
  ['sun_34', OUT, 0.3, 'idle', {}, { az: 40, el: 12, dist: 1.1, fov: 32 }],
];
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', e => errors.push('pageerror ' + e.message));
await page.goto(`http://127.0.0.1:8780/index.html?x=0&y=0&h=0&pins=0&petseed=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
await page.evaluate(() => { for (const id of ['hud', 'title']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; } });
for (const [name, at, yaw, mode, extra, cam] of shots) {
  await page.evaluate(({ pet, at, yaw, mode, extra, cam }) => {
    const a = window.__app, P = a.pets; P.hold(pet, { x: at.x, z: at.z, yaw, mode, speed: 0, ...extra });
    for (const o of P.agents) if (o.name !== pet) P.hold(o.name, { x: -9.5, z: -12.5, mode: 'lie' });
    a.player.driven = true; a.player.teleport(at.x + 3, at.z + 3, 0, 0); a.player.driven = true;
    for (let i = 0; i < 150; i++) P.update(1 / 60);
    const c = a.camera, ag = P.get(pet), yawC = yaw + cam.az * Math.PI / 180, e = cam.el * Math.PI / 180, ly = ag.y + (cam.look ?? 0.16);
    const lx = at.x + Math.sin(yaw) * (cam.fwd ?? -0.02), lz = at.z + Math.cos(yaw) * (cam.fwd ?? -0.02);
    c.fov = cam.fov; c.updateProjectionMatrix();
    const place = () => { c.position.set(lx + Math.sin(yawC) * Math.cos(e) * cam.dist, ly + Math.sin(e) * cam.dist, lz + Math.cos(yawC) * Math.cos(e) * cam.dist); c.lookAt(lx, ly, lz); };
    for (let i = 0; i < 4; i++) { place(); window.renderAt(performance.now() / 1000); }
    place(); window.renderAt(performance.now() / 1000);
  }, { pet, at, yaw, mode, extra, cam });
  await page.screenshot({ path: `${outDir}/${prefix}_${name}.png` });
  console.log('saved', `${outDir}/${prefix}_${name}.png`);
}
await page.evaluate((pet) => { const a = window.__app; a.pets.release(pet); a.camera.fov = 62; a.camera.updateProjectionMatrix(); a.player.driven = false; }, pet);
console.log(errors.length ? 'console errors:\n' + errors.join('\n') : 'no console errors');
await browser.close();
// side-by-side: the reference photo next to the sunlit sitting render, same height
execFileSync('/usr/bin/python3', ['-c', `
from PIL import Image
ref = Image.open(${JSON.stringify(REF)}).convert('RGB'); r = Image.open(${JSON.stringify(`${outDir}/${prefix}_sun_sit.png`)}).convert('RGB')
w, h = r.size; c = r.crop((int(w*0.18), int(h*0.04), int(w*0.82), int(h*0.96)))
H = ref.height; c = c.resize((int(c.width * H / c.height), H))
out = Image.new('RGB', (ref.width + c.width + 12, H), (255, 255, 255)); out.paste(ref, (0, 0)); out.paste(c, (ref.width + 12, 0))
out.save(${JSON.stringify(`${outDir}/${prefix}_vs_reference.png`)})
names = ['front','34','side','walk','sit','lie','jump_crouch','jump_air','face','sun_sit','sun_34']
ims = [Image.open(${JSON.stringify(`${outDir}/${prefix}_`)} + n + '.png').convert('RGB').resize((400, 400)) for n in names]
sheet = Image.new('RGB', (400 * 4, 400 * 3), (30, 30, 30))
for i, im in enumerate(ims): sheet.paste(im, ((i % 4) * 400, (i // 4) * 400))
sheet.save(${JSON.stringify(`${outDir}/${prefix}_sheet.png`)})
`]);
console.log('saved', `${outDir}/${prefix}_vs_reference.png`, `${outDir}/${prefix}_sheet.png`);
