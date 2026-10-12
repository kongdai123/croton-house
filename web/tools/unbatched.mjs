// Why visible meshes were left out of batching: node tools/unbatched.mjs
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
await page.goto('http://127.0.0.1:8780/index.html?x=0&y=0&h=0', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
console.log(JSON.stringify(await page.evaluate(() => {
  const a = window.__app, scene = a.scene, doors = new Set(a.getDoors().map(d => d.group));
  const why = {}, mats = new Set(), sig = new Map(); let live = 0;
  const reason = (o) => {
    for (let p = o; p; p = p.parent) {
      if (doors.has(p)) return 'door';
      if (p.userData.toggle) return 'toggle:' + (p.userData.placement?.i ?? p.name);
      if (p.userData.noBatch) return 'noBatch:' + (p.userData.placement?.i ?? p.name);
      if (p.name === 'rednote-pins' || p.name === 'markers') return 'pins';
    }
    if (o.isInstancedMesh) return null;
    if (Array.isArray(o.material)) return 'multiMaterial';
    if (o.material.transparent) return 'transparent';
    if (o.matrixWorld.determinant() <= 0) return 'mirrored';
    if (o.children.length) return 'hasChildren';
    if (o.constructor.name !== 'Mesh') return 'type:' + o.constructor.name;
    return 'singleton';
  };
  scene.traverseVisible(o => {
    if (!o.isMesh || o.userData.batch || o.parent?.name === 'frozen') return;
    const r = reason(o); if (!r) return; live++;
    why[r] = (why[r] || 0) + 1;
  });
  scene.traverse(o => { if (!o.isMesh) return; const m = Array.isArray(o.material) ? o.material : [o.material]; m.forEach(x => { mats.add(x); const k = x.type + JSON.stringify([x.color?.getHex(), x.roughness, x.metalness, x.map?.uuid, x.normalMap?.uuid, x.roughnessMap?.uuid, x.transparent, x.opacity, x.side, x.emissive?.getHex(), x.emissiveIntensity, x.envMapIntensity, x.alphaTest, x.vertexColors, x.flatShading]); sig.set(k, (sig.get(k) || 0) + 1); }); });
  return { live, why: Object.entries(why).sort((p, q) => q[1] - p[1]).slice(0, 30), materials: mats.size, distinctByParams: sig.size };
}), null, 1));
await browser.close();
