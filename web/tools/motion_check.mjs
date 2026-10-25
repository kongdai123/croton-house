// TAA motion vectors against the CPU (src/motion.js), on a GPU node (refuses a software rasteriser; RENDER_GATE.md).
// A bedroom door swings open in front of the camera and the dog walks up to it. On frames of the swing the velocity
// target is read back where the TAA pass drew it, with the scene's depth; every 3rd texel is taken back to the world
// (the jittered camera of that frame). On the door's leaf (the drawn leaf meshes' own bounds hold the point) the CPU
// takes the point into the leaf's space, through the leaf's world matrix of the frame before and the camera before, and
// compares (uv now - uv before) and the previous view depth. Points away from the door and the dog must carry no
// velocity; the dog's must carry it.
//   node motion_check.mjs --site <dir> --out <dir> [--size 1280x720]
// Exit 1 if more than 0.5 % of the door's texels have no velocity or one off by more than 0.05 px or 1 cm, any is off by
// more than 0.25 px, a still point carries velocity, or the dog (when in view) shows none. (The few that miss are on
// the leaf's edges, where a texel of the frame beside it lies within the leaf's bounds.)
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
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) { errors.push(m.text()); console.log('[error]', m.text().slice(0, 300)); } });
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
  A.player.eyeHeight = 0.8; A.player.eye = 0.8; A.player.teleport(4.55, -0.6, 180, -0.2);   // crouched in the hall, facing bedroom 3's door A.camera.fov = 62; A.camera.updateProjectionMatrix();
  step(60);
  const door = A.getDoors().find(d => d.id === '60bf34160a');
  if (Math.abs(door.target) >= 0.1) { A.interact.toggleDoor(door); step(90); }
  // the dog held walking on the spot to the right of the door, facing the camera (its bones move, its root does not)
  const dogAgent = A.pets?.get?.('dog');
  if (dogAgent) {
    const x = 5.0, z = 1.7, yaw = Math.atan2(4.55 - x, 0.6 - z);
    Object.assign(dogAgent, { perch: null, path: null, call: null, goal: null, x, z, yaw, state: 'pause', st: 0 });
    A.pets.hold('dog', { x, z, yaw, mode: 'walk', speed: 0.4 });
  }
  step(30);
  // the meshes the frame's scene pass drew (motion.seen gets every one)
  const frameDrawn = new Set(), seen = motion.seen;
  motion.seen = o => { frameDrawn.add(o); seen(o); };
  const under = (root, o) => { for (let p = o; p; p = p.parent) if (p === root) return true; return false; };
  const pivot = door.pivot ?? door.leaves[0].pivot, dogRoot = A.pets?.get?.('dog')?.root;
  const iw = motion.target.width, ih = motion.target.height, half = new Uint16Array(iw * ih * 4), depth = new Float32Array(iw * ih * 4);
  // the scene's depth, as drawn, into a float target to read back
  const depthTarget = new T.WebGLRenderTarget(iw, ih, { type: T.FloatType, depthBuffer: false, minFilter: T.NearestFilter, magFilter: T.NearestFilter });
  const quad = new T.Mesh(new T.PlaneGeometry(2, 2), new T.ShaderMaterial({ uniforms: { tDepth: { value: null } }, depthTest: false, depthWrite: false,
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform highp sampler2D tDepth; void main() { gl_FragColor = vec4(texelFetch(tDepth, ivec2(gl_FragCoord.xy), 0).r, 0.0, 0.0, 1.0); }' }));
  const quadScene = new T.Scene(); quadScene.add(quad); quad.frustumCulled = false; const quadCam = new T.OrthographicCamera();
  const before = new Map(), prevView = new T.Matrix4(), prevProj = new T.Matrix4();
  const keep = () => { before.clear(); for (const o of frameDrawn) before.set(o, o.matrixWorld.clone()); prevView.copy(A.camera.matrixWorldInverse); prevProj.copy(taa.projection); };
  const uvOf = (p, view, proj) => { const c = new T.Vector4(p.x, p.y, p.z, 1).applyMatrix4(view).applyMatrix4(proj); return { x: c.x / c.w * 0.5 + 0.5, y: c.y / c.w * 0.5 + 0.5, w: c.w }; };
  const checks = { door: [], wall: 0, wallMoving: 0, dogTexels: 0, dogMoving: 0, frames: 0, movers: [], covered: [], wallSamples: [] };
  const render = motion.render.bind(motion);
  motion.render = (renderer, cam, depthTex, previous, jitter, dt) => {
    const n = render(renderer, cam, depthTex, previous, jitter, dt);
    if (!window.__check) return n;
    checks.frames++; checks.movers.push({ ...motion.stats });
    const saved = r.getRenderTarget();
    quad.material.uniforms.tDepth.value = depthTex; r.setRenderTarget(depthTarget); r.render(quadScene, quadCam); r.setRenderTarget(saved);
    r.readRenderTargetPixels(depthTarget, 0, 0, iw, ih, depth);
    r.readRenderTargetPixels(motion.target, 0, 0, iw, ih, half);
    let set = 0; for (let i = 3; i < half.length; i += 4) if (T.DataUtils.fromHalfFloat(half[i]) > 0.5) set++;
    checks.covered.push(+(set / (iw * ih)).toFixed(4));
    const invVP = new T.Matrix4().multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse), unjittered = taa.projection, view = cam.matrixWorldInverse;
    // what each point is: the drawn meshes whose local bounds hold it (the door's leaf meshes, the dog's), else still
    const leafMeshes = [...frameDrawn].filter(o => under(pivot, o)), dogMeshes = dogRoot ? [...frameDrawn].filter(o => under(dogRoot, o)) : [];
    for (const o of leafMeshes) o.geometry.boundingBox ?? o.geometry.computeBoundingBox();
    const dogBox = new T.Box3(); for (const o of dogMeshes) dogBox.expandByObject(o); dogBox.expandByScalar(0.05);
    const leafBoxes = leafMeshes.map(o => new T.Box3().setFromObject(o).expandByScalar(0.3));
    const p = new T.Vector3(), local = new T.Vector3(), inv = new T.Matrix4();
    for (let y = 1; y < ih; y += 3) for (let x = 1; x < iw; x += 3) {
      const i = (y * iw + x) * 4, d = depth[i];
      if (d >= 1) continue;   // sky
      p.set((x + 0.5) / iw * 2 - 1, (y + 0.5) / ih * 2 - 1, d * 2 - 1).applyMatrix4(invVP);
      const gpu = [T.DataUtils.fromHalfFloat(half[i]), T.DataUtils.fromHalfFloat(half[i + 1]), T.DataUtils.fromHalfFloat(half[i + 2]), T.DataUtils.fromHalfFloat(half[i + 3])];
      let leaf = null;
      for (let k = 0; k < leafMeshes.length && !leaf; k++) {
        if (!leafBoxes[k].containsPoint(p)) continue;
        local.copy(p).applyMatrix4(inv.copy(leafMeshes[k].matrixWorld).invert());
        if (leafMeshes[k].geometry.boundingBox.clone().expandByScalar(0.003).containsPoint(local)) leaf = leafMeshes[k];
      }
      if (leaf && before.has(leaf)) {
        // the point a frame earlier: in the leaf's own space, through its previous world matrix and the camera before
        const was = uvOf(local.applyMatrix4(before.get(leaf)), prevView, prevProj), now = uvOf(p, view, unjittered);
        const ex = now.x - was.x, ey = now.y - was.y;
        checks.door.push({ x, y, alpha: gpu[3], dx: (gpu[0] - ex) * iw, dy: (gpu[1] - ey) * ih, dz: gpu[2] - was.w, speed: Math.hypot(ex * iw, ey * ih) });
      } else if (dogBox.containsPoint(p)) { checks.dogTexels++; if (gpu[3] > 0.5 && Math.hypot(gpu[0] * iw, gpu[1] * ih) > 0.02) checks.dogMoving++; }
      else if (!leafBoxes.some(b => b.containsPoint(p))) {
        checks.wall++;
        if (gpu[3] > 0.5) { checks.wallMoving++; if (checks.wallSamples.length < 12) checks.wallSamples.push({ x, y, at: p.toArray().map(v => +v.toFixed(3)), gpu: gpu.map(v => +v.toFixed(4)) }); }
      }
    }
    return n;
  };
  const advance = motion.advance.bind(motion);
  motion.advance = () => { advance(); keep(); frameDrawn.clear(); };
  A.interact.toggleDoor(door);   // swing open
  for (let f = 0; f < 30; f++) { window.__check = f >= 8 && f % 7 === 1; window.renderAt(window.simTime() + 1 / 60); }
  window.__check = false; motion.render = render; motion.advance = advance; motion.seen = seen;
  depthTarget.dispose();
  return checks;
});
await writeFile(join(OUT, 'report.json'), JSON.stringify({ gpu, errors, ...result }, null, 1));
if (result.error) { console.log(result.error); process.exit(1); }
const door = result.door.filter(d => d.speed > 0.05), missing = door.filter(d => d.alpha < 0.5), wrong = door.filter(d => d.alpha >= 0.5 && (Math.hypot(d.dx, d.dy) > 0.05 || Math.abs(d.dz) > 0.01));
const err = door.filter(d => d.alpha >= 0.5).map(d => Math.hypot(d.dx, d.dy));
console.log(`frames checked ${result.frames}; movers per frame ${result.movers.map(m => `${m.movers} (rigid ${m.rigid}, skinned ${m.skinned}, shader ${m.shader})`).join(', ')}`);
err.sort((a, b) => a - b);
console.log(`door texels ${door.length} (moving > 0.05 px): without velocity ${missing.length}, off by > 0.05 px or 1 cm ${wrong.length}; error median ${(err[err.length >> 1] ?? 0).toFixed(4)} px, 99.9th ${(err[Math.floor(err.length * 0.999)] ?? 0).toFixed(4)}, largest ${(err.at(-1) ?? 0).toFixed(4)}; fastest ${Math.max(0, ...door.map(d => d.speed)).toFixed(2)} px/frame`);
console.log(`still wall texels ${result.wall}, with velocity ${result.wallMoving}; dog texels ${result.dogTexels}, moving ${result.dogMoving}`);
console.log('velocity target covered', result.covered.join(' '), '\nstill points with velocity', JSON.stringify(result.wallSamples.slice(0, 6)));
const fail = !door.length || missing.length + wrong.length > 0.005 * door.length || (err.at(-1) ?? 0) > 0.25 || result.wallMoving || (result.dogTexels > 20 && !result.dogMoving) || errors.length;
console.log(fail ? 'FAIL' : 'OK');
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
