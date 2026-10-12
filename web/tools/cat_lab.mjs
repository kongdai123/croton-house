// Studio renders of the cat alone (fast look-dev loop): node tools/cat_lab.mjs [outDir] [shots...]
// Bundles a tiny page around src/pets/cat.js into dist/cat_lab.js, opens it on the preview server and saves PNGs.
// shots: name=mode:az:el:dist[:t[:jumpT]]  (az/el in degrees around the cat, dist in metres). Default set below.
import { chromium } from 'playwright';
import * as esbuild from 'esbuild';
import fs from 'node:fs';

const outDir = process.argv[2] ?? '../compare/pets';
fs.mkdirSync(outDir, { recursive: true });
const entry = `
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createPet } from '../src/pets/cat.js';
const W = 900, H = 900;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H); renderer.setPixelRatio(1); renderer.toneMapping = THREE.NeutralToneMapping; renderer.shadowMap.enabled = true;
document.body.style.margin = 0; document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xc9d3dc);
const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.55;
const sun = new THREE.DirectionalLight(0xfff4e6, 2.6); sun.position.set(-1.5, 3, 2); scene.add(sun);
const fill = new THREE.HemisphereLight(0xdfe8f5, 0x8a7a66, 0.6); scene.add(fill);
const ground = new THREE.Mesh(new THREE.CircleGeometry(3, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xb9b2a6, roughness: 0.95 })); scene.add(ground);
const pet = createPet(); scene.add(pet.root);
const cam = new THREE.PerspectiveCamera(30, W / H, 0.01, 20);
window.lab = {
  stats: pet._internal.built.stats,
  pose(mode, t = 2, jumpT = 0.5, speed = null) {
    const r = pet._internal.rig; r.snap(mode);
    const sp = speed ?? (mode === 'walk' ? pet.walkSpeed : 0);
    for (let i = 0; i <= 120; i++) pet.update(1 / 60, { mode, speed: sp, turn: 0, t: t - (120 - i) / 60, jumpT, camDist: 1 });
  },
  shot(az, el, dist, look = [0, 0.17, -0.05]) {
    const a = az * Math.PI / 180, e = el * Math.PI / 180;
    cam.position.set(look[0] + Math.sin(a) * Math.cos(e) * dist, look[1] + Math.sin(e) * dist, look[2] + Math.cos(a) * Math.cos(e) * dist);
    cam.lookAt(...look); renderer.render(scene, cam);
  },
};
window.__ready = true;
`;
fs.writeFileSync('tools/.cat_lab_entry.js', entry);
await esbuild.build({ entryPoints: ['tools/.cat_lab_entry.js'], bundle: true, format: 'esm', outfile: 'dist/cat_lab.js', logLevel: 'warning' });
fs.unlinkSync('tools/.cat_lab_entry.js');

const shots = process.argv.slice(3).length ? process.argv.slice(3) : [
  'cat_lab_front=idle:0:8:0.95', 'cat_lab_34=idle:35:10:1.0', 'cat_lab_side=idle:90:5:1.1', 'cat_lab_back=idle:180:20:1.1',
  'cat_lab_walk=walk:70:10:1.1:1.3', 'cat_lab_sit=sit:28:4:0.95', 'cat_lab_lie=lie:40:18:1.0', 'cat_lab_jump_crouch=jump:70:10:1.1:2:0.2', 'cat_lab_jump_air=jump:80:8:1.2:2:0.55',
  'cat_lab_face=idle:12:6:0.42:2:0:0,0.27,0.18',
];
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 });
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.text().slice(0, 300)); });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:8780/tools/', { waitUntil: 'load' });
await page.evaluate(() => { document.body.innerHTML = ''; });
await page.addScriptTag({ type: 'module', url: '/dist/cat_lab.js?' + Date.now() });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
console.log('stats', JSON.stringify(await page.evaluate(() => window.lab.stats)));
for (const s of shots) {
  const [name, spec] = s.split('='); const [mode, az, el, dist, t = '2', jt = '0.5', look] = spec.split(':');
  await page.evaluate(([mode, az, el, dist, t, jt, look]) => { window.lab.pose(mode, +t, +jt); window.lab.shot(+az, +el, +dist, look ? look.split(',').map(Number) : undefined); }, [mode, az, el, dist, t, jt, look]);
  await page.locator('canvas').screenshot({ path: `${outDir}/${name}.png` });
  console.log('saved', `${outDir}/${name}.png`);
}
await browser.close();
