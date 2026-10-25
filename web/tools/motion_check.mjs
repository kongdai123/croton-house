// TAA motion vectors against the CPU (src/motion.js), on a GPU node (refuses a software rasteriser; RENDER_GATE.md).
// A bedroom door swings open in front of the camera and the dog walks up to it. On frames of the swing the velocity
// target is read back where the TAA pass drew it; for every 7th texel of the door leaf the CPU casts the same ray (the
// jittered camera of that frame), takes the hit point back to the leaf's own space, through the leaf's world matrix of
// the frame before and the camera before, and compares (uv now - uv before) and the previous view depth. Texels on
// still walls (a sparse grid) must carry no velocity; the dog's texels must carry it. Rays go to the door's and the dog's
// screen boxes every 4 texels and every 40 elsewhere.
//   node motion_check.mjs --site <dir> --out <dir> [--size 1280x720]
// Exit 1 if a door texel is off by more than 0.05 px or 1 cm, a wall texel moves, or the dog shows no motion.
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { extname, join, resolve } from 'path';

const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const SITE = resolve(opt('--site', new URL('..', import.meta.url).pathname)), OUT = opt('--out', 'motion_check');
const [W, H] = opt('--size', '1280x720').split('x').map(Number);
await mkdir(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try { const p = decodeURIComponent(req.url.split('?')[0]); if (p.includes('..')) throw 0; const data = await readFile(join(SITE, p === '/' ? 'index.html' : p)); res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(data); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-vulkan-surface'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.log('[error]', m.text().slice(0, 300)); } });
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?capture&pins=0&autoexp=0&tier=hq&lmres=full&lightmap=sunrise&petseed=3&x=0&y=0`, { waitUntil: 'load' });
const gpu = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : gl.RENDERER); });
if (/SwiftShader|llvmpipe|software/i.test(gpu)) { console.log('software rasteriser: refusing'); process.exit(2); }
await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
console.log('renderer', gpu);

const result = await page.evaluate(async () => {
  const A = window.__app, T = A.THREE, taa = A.lighting.taa, motion = taa?.motion, r = A.renderer;
  if (!motion) return { error: 'no TAA motion vectors in this build' };
  const step = n => { for (let i = 0; i < n; i++) window.renderAt(window.simTime() + 1 / 60); };
  A.player.move = () => {};
  A.player.eye = 1.6; A.player.teleport(4.55, -0.6, 180, -0.08); A.camera.fov = 62; A.camera.updateProjectionMatrix();
  step(60);
  const door = A.getDoors().find(d => d.id === '60bf34160a'), leaf = [];
  (door.pivot ?? door.leaves[0].pivot).traverse(o => { if (o.isMesh) leaf.push(o); });
  if (Math.abs(door.target) >= 0.1) { A.interact.toggleDoor(door); step(90); }
  // the dog called to the camera, walking in from wherever it is
  A.pets?.call?.('dog'); step(30);
  const dog = []; A.pets?.get?.('dog')?.root?.traverse(o => { if (o.isMesh) dog.push(o); });
  const iw = motion.target.width, ih = motion.target.height, half = new Uint16Array(iw * ih * 4), ray = new T.Raycaster(), v = new T.Vector3();
  const before = new Map(), prevView = new T.Matrix4(), prevProj = new T.Matrix4();
  const keep = () => { for (const o of [...leaf, ...dog]) before.set(o, o.matrixWorld.clone()); prevView.copy(A.camera.matrixWorldInverse); prevProj.copy(taa.projection); };
  const uvOf = (p, view, proj) => { const c = new T.Vector4(p.x, p.y, p.z, 1).applyMatrix4(view).applyMatrix4(proj); return { x: c.x / c.w * 0.5 + 0.5, y: c.y / c.w * 0.5 + 0.5, w: c.w }; };
  const checks = { door: [], wall: 0, wallMoving: 0, dogTexels: 0, dogMoving: 0, frames: 0, movers: [] };
  // inside the TAA pass, right after the velocity draw: the same camera (jittered), the same matrices
  const render = motion.render.bind(motion);
  motion.render = (renderer, cam, depth, previous, jitter, dt) => {
    const n = render(renderer, cam, depth, previous, jitter, dt);
    if (!window.__check) return n;
    checks.frames++; checks.movers.push({ ...motion.stats });
    r.readRenderTargetPixels(motion.target, 0, 0, iw, ih, half);
    const unjittered = taa.projection, view = cam.matrixWorldInverse;
    const boxOf = list => {
      const b = new T.Box3(); for (const o of list) b.expandByObject(o);
      if (b.isEmpty()) return null;
      let x0 = iw, x1 = 0, y0 = ih, y1 = 0;
      for (let k = 0; k < 8; k++) {
        v.set(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : b.min.y, k & 4 ? b.max.z : b.min.z).project(cam);
        x0 = Math.min(x0, (v.x * 0.5 + 0.5) * iw); x1 = Math.max(x1, (v.x * 0.5 + 0.5) * iw); y0 = Math.min(y0, (v.y * 0.5 + 0.5) * ih); y1 = Math.max(y1, (v.y * 0.5 + 0.5) * ih);
      }
      return [Math.max(0, x0 | 0), Math.min(iw - 1, x1 | 0), Math.max(0, y0 | 0), Math.min(ih - 1, y1 | 0)];
    };
    const near = [boxOf(leaf), boxOf(dog)].filter(Boolean), inside = (x, y) => near.some(([a, b, c, d]) => x >= a && x <= b && y >= c && y <= d);
    const shown = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
    for (let y = 2; y < ih; y += 2) for (let x = 2; x < iw; x += 2) {
      if (inside(x, y) ? (x % 4 || y % 4) : (x % 40 || y % 40)) continue;
      ray.setFromCamera(new T.Vector2((x + 0.5) / iw * 2 - 1, (y + 0.5) / ih * 2 - 1), cam);
      const hit = ray.intersectObjects(A.scene.children, true).find(h => shown(h.object) && h.object.material && ![].concat(h.object.material).some(m => m.transparent || m.depthWrite === false));
      if (!hit) continue;
      const i = (y * iw + x) * 4, gpu = [T.DataUtils.fromHalfFloat(half[i]), T.DataUtils.fromHalfFloat(half[i + 1]), T.DataUtils.fromHalfFloat(half[i + 2]), T.DataUtils.fromHalfFloat(half[i + 3])];
      if (leaf.includes(hit.object) && before.has(hit.object)) {
        // the hit point a frame earlier: in the leaf's own space, through its previous world matrix
        v.copy(hit.point).applyMatrix4(hit.object.matrixWorld.clone().invert()).applyMatrix4(before.get(hit.object));
        const now = uvOf(hit.point, view, unjittered), was = uvOf(v, prevView, prevProj);
        const ex = now.x - was.x, ey = now.y - was.y;
        checks.door.push({ x, y, alpha: gpu[3], dx: (gpu[0] - ex) * iw, dy: (gpu[1] - ey) * ih, dz: gpu[2] - was.w, speed: Math.hypot(ex * iw, ey * ih) });
      } else if (dog.includes(hit.object)) { checks.dogTexels++; if (gpu[3] > 0.5 && Math.hypot(gpu[0] * iw, gpu[1] * ih) > 0.05) checks.dogMoving++; }
      else if (!hit.object.isSkinnedMesh && !hit.object.isInstancedMesh && hit.object.matrixWorld.equals(before.get(hit.object) ?? hit.object.matrixWorld)) { checks.wall++; if (gpu[3] > 0.5) checks.wallMoving++; }
    }
    return n;
  };
  A.interact.toggleDoor(door);   // swing open
  for (let f = 0; f < 24; f++) { keep(); window.__check = f >= 6 && f % 6 === 0; window.renderAt(window.simTime() + 1 / 60); }
  window.__check = false; motion.render = render;
  return checks;
});
await writeFile(join(OUT, 'report.json'), JSON.stringify({ gpu, errors, ...result }, null, 1));
if (result.error) { console.log(result.error); process.exit(1); }
const door = result.door.filter(d => d.speed > 0.05), missing = door.filter(d => d.alpha < 0.5), wrong = door.filter(d => d.alpha >= 0.5 && (Math.hypot(d.dx, d.dy) > 0.05 || Math.abs(d.dz) > 0.01));
const err = door.filter(d => d.alpha >= 0.5).map(d => Math.hypot(d.dx, d.dy));
console.log(`frames checked ${result.frames}; movers per frame ${result.movers.map(m => `${m.movers} (rigid ${m.rigid}, skinned ${m.skinned}, shader ${m.shader})`).join(', ')}`);
console.log(`door texels ${door.length} (moving > 0.05 px): without velocity ${missing.length}, off by > 0.05 px or 1 cm ${wrong.length}; largest error ${Math.max(0, ...err).toFixed(4)} px, fastest ${Math.max(0, ...door.map(d => d.speed)).toFixed(2)} px/frame`);
console.log(`still wall texels ${result.wall}, with velocity ${result.wallMoving}; dog texels ${result.dogTexels}, moving ${result.dogMoving}`);
const fail = !door.length || missing.length > 0.02 * door.length || wrong.length || result.wallMoving || (result.dogTexels > 20 && !result.dogMoving) || errors.length;
console.log(fail ? 'FAIL' : 'OK');
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
