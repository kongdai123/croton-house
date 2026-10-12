// Which roots produce the draw calls at a pose: node tools/calls.mjs x y h
import { chromium } from 'playwright';
const [x = 1, y = 13, h = 185] = process.argv.slice(2).map(Number);
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(`http://127.0.0.1:8780/index.html?x=${x}&y=${y}&h=${h}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
await page.waitForTimeout(1500);
console.log(JSON.stringify(await page.evaluate(() => {
  const a = window.__app, cam = a.camera, scene = a.scene;
  cam.updateMatrixWorld(); scene.updateMatrixWorld();
  const fr = new a.THREE.Frustum().setFromProjectionMatrix(new a.THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const by = {}, kinds = { batch: 0, frozen: 0, live: 0, instanced: 0 }; let nodes = 0, auto = 0, total = 0;
  const rootOf = (o) => { let r = o; while (r.parent && r.parent !== scene) { if (r.userData?.placement) return r.userData.placement.m + ':' + r.userData.placement.i; r = r.parent; } return 'top:' + (r.name || r.type); };
  scene.traverse(o => { nodes++; if (o.matrixAutoUpdate) auto++; });
  scene.traverseVisible(o => {
    if (!o.isMesh || o.material.visible === false) return;
    if (o.frustumCulled && !(o.geometry.boundingSphere || o.geometry.computeBoundingSphere(), fr.intersectsObject(o))) return;
    total++;
    const k = o.isInstancedMesh ? 'instanced' : o.userData.batch ? 'batch' : o.parent?.name === 'frozen' ? 'frozen' : 'live'; kinds[k]++;
    if (k === 'live') { const r = rootOf(o); by[r] = (by[r] || 0) + 1; }
  });
  return { nodes, matrixAutoUpdate: auto, meshesInFrustum: total, kinds, topLive: Object.entries(by).sort((p, q) => q[1] - p[1]).slice(0, 25) };
}), null, 1));
await browser.close();
