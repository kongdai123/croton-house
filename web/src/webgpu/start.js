import * as THREE from 'three/webgpu';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { buildHouse, getDoors } from '../house.js';
import { buildGarden } from '../grass.js';
import { Layout } from '../layout.js';
import { Player } from '../player.js';
import { batchStatic, updateSwayLod, updateRoomVisibility } from '../batch.js';
import { setAnisotropy, setTextureCap, setTextureSet, texturesDecoded } from '../materials.js';
import { TIERS, detectTexSet } from '../tier.js';
import { checkedFetch, loadBake, matchUnits } from './assets.js';
import { parseProbes, buildProbeVolume } from './probes.js';
import { bakedMaterials } from './materials.js';
import { createPost } from './post.js';
import { prepareBatchMaterials } from './scene.js';

const query = new URLSearchParams(location.search);
const diagnostics = window.__webgpu = { ready: false, error: null, backend: null, frames: 0 };
const panel = document.createElement('div');
panel.style.cssText = 'position:fixed;top:12px;left:12px;z-index:10000;background:#182025;color:white;padding:12px;font:13px system-ui;max-width:440px';
// The production UI assumes main.js owns its controls. This entry supplies its own.
for (const child of document.body.children) if (child.id !== 'gl' && child.tagName !== 'SCRIPT') child.style.display = 'none';
document.body.append(panel);
const status = document.createElement('div'); panel.append(status);
const progress = message => { status.textContent = `WebGPU spike · ${message}`; };
function fail(error) {
  diagnostics.error = String(error?.stack || error); diagnostics.ready = false;
  progress(`failed: ${error.message || error}`); console.error('[webgpu]', error);
  diagnostics.renderer?.setAnimationLoop(null);
}

async function start() {
  const started = performance.now();
  if (query.has('lightmap') && !['', 'sunrise'].includes(query.get('lightmap'))) throw new Error('This spike supports only the sunrise bake');
  const tier = query.get('tier') || 'laptop', preset = TIERS[tier];
  if (!preset) throw new Error('tier must be hq, laptop or mobile');
  const resolution = query.get('lmres') || (tier === 'hq' ? 'full' : tier === 'mobile' ? 'quarter' : 'half');
  if (!['full', 'half', 'quarter'].includes(resolution)) throw new Error('lmres must be full, half or quarter');
  const lamps = Number(query.get('lamps') ?? 0.25);
  if (!Number.isFinite(lamps) || lamps < 0 || lamps > 4) throw new Error('lamps must be in [0, 4]');
  setAnisotropy(preset.anisotropy); setTextureCap(preset.textureCap); setTextureSet(detectTexSet(tier));
  const canvas = document.getElementById('gl');
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL: query.get('webgpu') === 'webgl', trackTimestamp: true });
  diagnostics.renderer = renderer;
  progress('initializing renderer');
  await renderer.init();
  diagnostics.backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : renderer.backend.isWebGLBackend ? 'WebGL2 fallback' : 'unknown';
  console.info('[webgpu] backend:', diagnostics.backend);
  if (renderer.backend.isWebGPUBackend) {
    renderer.backend.device.addEventListener('uncapturederror', event => fail(event.error));
    renderer.backend.device.lost.then(info => fail(new Error(`GPU device lost: ${info.message}`)));
  }
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(62, 1, 0.05, 300);
  scene.add(camera);
  function resize() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setPixelRatio(Math.min(devicePixelRatio, preset.pixelRatio, 1440 / Math.min(w, h), Math.sqrt(2560 * 1440 / (w * h))));
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  resize(); addEventListener('resize', resize);
  const [house, points] = await Promise.all(['house', 'floorplan_points'].map(async name => (await checkedFetch(`data/${name}.json`)).json()));
  progress('building house and garden');
  const houseRoot = buildHouse(house); scene.add(houseRoot);
  const garden = buildGarden({ quality: preset.grass, camera }); scene.add(garden.group);
  // Layout only requires a Group to hold fixture lights. It stays outside the
  // rendered scene because the lamps are already included in the bake.
  const fixtures = new THREE.Group(), layout = new Layout(scene, fixtures, house, points);
  await layout.build((fraction, name) => progress(`furniture ${Math.round(fraction * 100)}% · ${name}`));
  const switches = prepareBatchMaterials(scene, fixtures, house);
  const batch = batchStatic([houseRoot, layout.root], { skip: getDoors().map(d => d.group), anchors: layout.interactive, animated: layout.animated });
  progress('loading baked lighting');
  const bake = await loadBake(renderer, resolution);
  const matching = matchUnits(scene, bake.header, query.get('lmflip') !== '0');
  for (const object of layout.placed) object.userData.onTime?.(false, true);
  for (const { toggle } of switches) toggle.onTime(false);
  scene.traverse(object => { if (object.isLight) object.visible = false; });
  const volume = buildProbeVolume(parseProbes(bake.probes), lamps);
  const materials = bakedMaterials(renderer, scene, matching.meshes, bake, volume, lamps);
  // Same sunrise direction, irradiance, colour and camera bounds as applyBakedSun.
  const sun = new THREE.DirectionalLight(new THREE.Color().setRGB(1, 0.68, 0.45), 20);
  const azimuth = 58 * Math.PI / 180, elevation = 8 * Math.PI / 180;
  sun.position.set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), -Math.cos(azimuth) * Math.cos(elevation)).multiplyScalar(90);
  sun.target.position.set(0, 0, -2.65); sun.position.add(sun.target.position);
  sun.castShadow = true; sun.shadow.mapSize.set(preset.shadowMap, preset.shadowMap);
  if (query.has('sunoff')) sun.intensity = 0;
  sun.shadow.bias = -0.00006; sun.shadow.normalBias = 0.018;
  // As lighting.js: the sun map is redrawn only while shadow casters move. r183 re-derives the shared
  // shadow override material's cache key for every caster on each redraw (~200 ms of CPU per frame here).
  sun.shadow.autoUpdate = false; sun.shadow.needsUpdate = true;
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 140 });
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun, sun.target); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  const sky = await new HDRLoader().setDataType(THREE.HalfFloatType).loadAsync(bake.asset('assets/lightmaps/sunrise/sky_bg.hdr'));
  sky.mapping = THREE.EquirectangularReflectionMapping; scene.background = sky;
  // No scene.environment: it would add diffuse sky on top of baked irradiance.
  progress('textures and output graph'); await texturesDecoded();
  const post = await createPost(renderer, scene, camera, query);
  const player = new Player(camera, canvas, { mode: 'walk', onLock: null });
  player.extraColliders = () => layout.movableColliders();
  player.teleport(Number(query.get('x') ?? 0), -Number(query.get('y') ?? -6.9), Number(query.get('h') ?? 0), Number(query.get('p') ?? 0));
  player.update(0);
  canvas.addEventListener('click', () => player.lock());
  const label = document.createElement('label'); label.textContent = ' Lamps ';
  const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = '4'; slider.step = '0.01'; slider.value = String(lamps);
  slider.addEventListener('input', () => materials.setLamps(Number(slider.value))); label.append(slider); panel.append(label);
  const samples = [], gpuSamples = [];
  const summarize = values => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return { count: sorted.length, median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] };
  };
  Object.assign(diagnostics, {
    scene, camera, player, layout, sun, post, setLamps: materials.setLamps,
    stats: { ...matching.stats, ...materials.stats, probes: volume.count, tier, resolution, atlas: [bake.slot.image.width, bake.slot.image.height] },
    // Rolling last 240 samples; CPU submission and frame intervals are not GPU time.
    metrics: () => ({ backend: diagnostics.backend, frames: diagnostics.frames, startupMs: diagnostics.startupMs,
      buffer: [canvas.width, canvas.height], cpuSubmitMs: summarize(samples.map(s => s.cpu)), frameIntervalMs: summarize(samples.map(s => s.frame)),
      gpuResolveMs: summarize(gpuSamples), timestampSupported: renderer.backend.trackTimestamp,
      render: { ...renderer.info.render }, memory: { ...renderer.info.memory } }),
  });
  console.info('[webgpu] bake/material coverage', diagnostics.stats);
  // Animated toggles (garage door, gates, lids) and doors move casters: refresh at most every 0.1 s while they
  // move and once after they settle, like lighting.update's shadowClock.
  const toggled = layout.animated.filter(o => o.userData.toggle).map(o => ({ toggle: o.userData.toggle, value: o.userData.toggle.value }));
  let shadowClock = 1, wasMoving = false;
  const refreshShadow = dt => {
    let moving = getDoors().some(d => d._t < 1);
    for (const t of toggled) { const v = t.toggle.value; if (t.toggle.moving || v !== t.value) moving = true; t.value = v; }
    shadowClock += dt;
    if ((moving && shadowClock >= 0.1) || (!moving && wasMoving)) { sun.shadow.needsUpdate = true; shadowClock = 0; }
    wasMoving = moving;
  };
  diagnostics.refreshShadow = () => { sun.shadow.needsUpdate = true; };
  let last = performance.now(), resolving = false;
  renderer.setAnimationLoop(time => {
    try {
      const dt = Math.min((time - last) / 1000, 0.1), interval = time - last; last = time;
      player.update(dt); updateSwayLod(batch.lod, camera.position); updateRoomVisibility(batch.rooms, camera.position);
      layout.animate(time / 1000); garden.update(time / 1000); refreshShadow(dt);
      const before = performance.now(); post.pipeline.render();
      samples.push({ cpu: performance.now() - before, frame: interval }); if (samples.length > 240) samples.shift();
      diagnostics.frames++;
      if (!diagnostics.ready && !diagnostics.error) {
        diagnostics.ready = true; diagnostics.startupMs = performance.now() - started;
        progress(`${diagnostics.backend} · click scene, WASD to walk · Esc releases mouse`);
      }
      // r183 resolves asynchronously; never wait on readback in the animation loop.
      // A resolve can span multiple frames, so these are labelled resolve durations.
      if (renderer.backend.trackTimestamp && !resolving) {
        resolving = true;
        renderer.resolveTimestampsAsync().then(ms => {
          if (Number.isFinite(ms) && ms > 0) { gpuSamples.push(ms); if (gpuSamples.length > 240) gpuSamples.shift(); }
        }).catch(error => { console.warn('[webgpu] timestamps unavailable', error); renderer.backend.trackTimestamp = false; })
          .finally(() => { resolving = false; });
      }
    } catch (error) { fail(error); }
  });
}

start().catch(fail);
