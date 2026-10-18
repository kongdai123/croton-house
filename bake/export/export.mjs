// The page runs in legacy mode: baked mode (the default) re-lays out every matched mesh for the old atlas (vertices split
// at its chart seams), which would change the units' vertex counts and their lightmap identity.
// Export the walkthrough's static scene (the photo-mode copy: instances flattened, poses baked) as a GLB for Blender.
// usage: node export.mjs <out.glb> <bundle.js> [site dir] [--dusk]
//   bundle.js: export_entry.js bundled (NODE_PATH=web/node_modules npx esbuild bake/export/export_entry.js --bundle)
//   site dir: a built site to serve (on a GPU node); without it the dev server on :8780
//   --dusk: the sheers drawn as the site draws them in the dusk slot (main.js onTime); same units as the day export, so
//           unwrap.py --reuse keeps the layout (for the dusk slot's sky / sun-bounce bake)
// Toggle states: the site's startup (daytime) states, except doors whose bakePose is open; every door and toggle is listed in
// <out.glb>.state.json and the log, so the bake's states can be checked against the site's (bake/REBAKE.md).
// Every mesh carries its lightmap identity (batch.js) as node extras: {lm: id} or {lmSkip: 'movable'}; unwrap.py keys
// the lightmap units by it. Every node and material also carries its lighting manifest record (web/src/lighting_roles.js)
// as extras "lighting", a JSON string (bake/scripts/lighting.py reads it in unwrap.py, setup.py and the bake scripts).
// Doors are posed as their manifest says (bakePose 'open': baked open although the site starts them shut).
import { createRequire } from 'module';
import { createServer } from 'http';
import { readFile, writeFile } from 'fs/promises';
import { extname, join } from 'path';
const { chromium } = await import('playwright').catch(() => createRequire(new URL('../../web/package.json', import.meta.url))('playwright'));
const args = process.argv.slice(2).filter(a => !a.startsWith('--')), DUSK = process.argv.includes('--dusk');
const [out, bundle, site] = args;
let origin = 'http://127.0.0.1:8780', server = null;
if (site) {
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
  server = createServer(async (req, res) => {
    try { const p = decodeURIComponent(req.url.split('?')[0]); const data = await readFile(join(site, p === '/' ? 'index.html' : p)); res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(data); }
    catch { res.writeHead(404); res.end(); }
  }).listen(0);
  origin = `http://127.0.0.1:${server.address().port}`;
}
const gpu = process.platform === 'darwin' ? { channel: 'chrome', args: ['--use-angle=metal'] } : { args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--disable-vulkan-surface'] };
const browser = await chromium.launch({ ...gpu, headless: true, args: [...gpu.args, '--js-flags=--max-old-space-size=16000'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 }, acceptDownloads: true });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 200)); });
await page.goto(`${origin}/index.html?capture&legacy&pins=0&pets=0&tex=2k&x=0.3&y=-1&h=0`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
await page.addScriptTag({ path: bundle });
const dl = page.waitForEvent('download', { timeout: 900000 });
const info = await page.evaluate(async ({ DUSK }) => {
  const A = window.__app, P = A.photo;
  // doors baked open although the site starts them shut (their leaves take the probe volume in every pose, so the bake
  // only decides how much light reaches what is behind them)
  for (const d of A.getDoors()) {
    if (d.group.userData.lighting?.bakePose !== 'open') continue;
    if (d.kind === 'bifold') { d.target = 1; d.tick(10); }
    else if (d.pivot) { d.target = d.openAngle ?? 1.35; d.pivot.rotation.y = d.target; }
  }
  if (DUSK) for (const o of A.layout.placed) if (o.userData.toggle?.label?.en === 'Open curtain') o.userData.onTime?.(true, true);
  const isOpen = d => d.kind === 'bifold' ? d.fold > 0.5 : d.kind === 'french' ? d.open > 0.5 : d.kind === 'slider' ? d.open > 0.3 : Math.abs(d.pivot?.rotation.y ?? 0) > 0.1;
  const state = {
    doors: A.getDoors().map(d => ({ id: d.id, kind: d.kind, open: isOpen(d), siteDefault: d.openDefault ?? null, at: d.plan && [+d.plan.cx.toFixed(2), +d.plan.cy.toFixed(2)] })),
    toggles: A.layout.placed.filter(o => o.userData.toggle).map(o => { const p = o.getWorldPosition(new A.THREE.Vector3()); return { id: o.userData.id || o.name, label: o.userData.toggle.label?.en, on: o.userData.toggle.on, value: +o.userData.toggle.value.toFixed(3), at: [+p.x.toFixed(2), +(-p.z).toFixed(2)] }; }),
  };
  // enclosed fit-outs (batch.js rooms) are hidden while the camera is outside them; the bake needs them all
  A.scene.traverse(o => { if (o.userData.viewRoom) o.visible = true; });
  for (const g of A.scene.getObjectByName('batched')?.children ?? []) if (g.isGroup) g.visible = true;
  const scene = await P.buildScene();
  scene.background = null; scene.environment = null;
  for (const o of [...scene.children]) if (o.isDirectionalLight) { scene.remove(o); scene.remove(o.target); }
  // JPEG for every texture of an opaque material, PNG only where alpha matters
  const seen = new Set();
  scene.traverse(o => { if (!o.isMesh) return; for (const m of [].concat(o.material)) {
    const alpha = m.alphaTest > 0 || m.transparent || m.alphaMap;
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'bumpMap']) { const t = m[k]; if (t && !seen.has(t)) { seen.add(t); t.userData.mimeType = (k === 'map' && alpha) ? 'image/png' : 'image/jpeg'; } }
  } });
  let tris = 0, ids = 0, skips = 0, meshes = 0;
  scene.traverse(o => { if (o.isMesh) { const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; meshes++; if (o.userData.lm) ids++; else if (o.userData.lmSkip) skips++; } });
  // the manifest records as JSON strings (Blender's importer keeps a string extra as it is)
  const exporter = new window.__GLTFExporter(); exporter.register(A.roles.gltfLightingPlugin());
  const glb = await exporter.parseAsync(scene, { binary: true, onlyVisible: true, maxTextureSize: 2048 });
  const url = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
  const a = document.createElement('a'); a.href = url; a.download = 'croton.glb'; document.body.appendChild(a); a.click();
  return { bytes: glb.byteLength, textures: seen.size, tris: Math.round(tris), meshes, lmIds: ids, lmSkip: skips, stats: P.buildStats, state };
}, { DUSK });
console.log(JSON.stringify({ ...info, state: undefined }));
for (const d of info.state.doors) console.log(`door ${d.id} ${d.kind} ${d.open ? 'open' : 'shut'}${d.siteDefault !== null && d.siteDefault !== d.open ? ' (site starts it ' + (d.siteDefault ? 'open' : 'shut') + ')' : ''} at ${d.at}`);
for (const t of info.state.toggles) console.log(`toggle ${t.id} "${t.label}" ${t.on ? 'on' : 'off'} (${t.value}) at ${t.at}`);
await writeFile(out + '.state.json', JSON.stringify(info.state, null, 1));
await (await dl).saveAs(out);
await browser.close(); server?.close();
