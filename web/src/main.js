// 2513 Croton Ave · interactive photoreal walkthrough. Entry point.
import * as THREE from 'three';
import { warmPrograms } from './shader_warmup.js';
import { createLighting } from './lighting.js';
import { buildHouse, CEIL, getDoors } from './house.js';
import { buildGarden } from './grass.js';
import { Player } from './player.js';
import { Layout } from './layout.js';
import { Interact } from './interact.js';
import { Minimap } from './minimap.js';
import { Viewpoints, OVERLAY_LAYER } from './viewpoints.js';
import { RedNote } from './rednote.js';
import { Tour } from './tour.js';
import { buildGrid } from './nav.js';
import { Markers } from './markers.js';
import { UI, t, setLang, getLang } from './ui.js';
import { Human } from './human.js';
import { batchStatic, updateSwayLod, updateRoomVisibility } from './batch.js';
import { Pets } from './pets/roam.js';
import { setAnisotropy, setTextureCap, setTextureSet, texturesDecoded } from './materials.js';
import { TIERS, detectTier, detectTexSet, qualityPair } from './tier.js';
import { Stats } from './stats.js';
import { Demo } from './demo.js';
import { PhotoMode } from './photo.js';
import { PhotoUI } from './photo_ui.js';
import { applyLightmaps } from './lightmap.js';
import { createContact } from './contact.js';
import { bakedRequested, bakedCapabilityError } from './baked_mode.js';

// ---- Device tier first: it sets MSAA, pixel ratio, shadow map size, post passes and texture limits before any of them exist.
const Q = new URLSearchParams(location.search);
const detected = detectTier();
const preset = TIERS[detected.tier];
const texSet = detectTexSet(detected.tier);
setAnisotropy(Math.min(8, preset.anisotropy)); setTextureCap(preset.textureCap); setTextureSet(texSet);
// Render at most 1440p: the drawing buffer's short side stays within 1440 device pixels and its area within 2560 × 1440,
// so an ultrawide screen keeps its full height budget spread over the width. The canvas still covers the viewport and
// the browser upsamples the frame to the screen.
const MAX_SHORT = 1440, MAX_PIXELS = 2560 * 1440;
const pixelRatio = p => {
  const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
  return Math.min(devicePixelRatio, p.pixelRatio, MAX_SHORT / Math.min(w, h), Math.sqrt(MAX_PIXELS / (w * h)));
};
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: detected.tier === 'hq', powerPreference: 'high-performance', preserveDrawingBuffer: true });
const bakedWanted = bakedRequested(location.search);
let bakedUnavailable = bakedWanted ? bakedCapabilityError(renderer) : null;
renderer.setPixelRatio(pixelRatio(preset));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 300);
scene.add(camera);
// Size the drawing buffer from the canvas box (CSS keeps #gl covering the viewport; setSize(..., false) writes no inline size).
// Registered before any await so viewport changes during the loading screen still reach the canvas; composer joins once lighting exists.
let post = null, activePreset = preset, photoFit = null;
function fitView() {
  const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
  const pr = pixelRatio(activePreset);
  if (pr !== renderer.getPixelRatio()) { renderer.setPixelRatio(pr); post?.setPixelRatio(pr); }
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h, false); post?.setSize(w, h);
  photoFit?.();
}
fitView();
// Resizes arrive in bursts while a window edge is dragged, and each fitView reallocates the drawing buffer and every
// post-processing target. Apply at most one every 500 ms, plus a trailing one when the burst ends, so the final size is
// always exact; in between the browser stretches the last frame.
const FIT_EVERY_MS = 500;
let fitTimer = 0, fitLast = -Infinity;
function scheduleFit() {
  const wait = FIT_EVERY_MS - (performance.now() - fitLast);
  if (wait <= 0 && !fitTimer) { fitLast = performance.now(); fitView(); return; }
  if (!fitTimer) fitTimer = setTimeout(() => { fitTimer = 0; fitLast = performance.now(); fitView(); }, Math.max(wait, 0));
}
new ResizeObserver(scheduleFit).observe(canvas);
addEventListener('resize', scheduleFit);
visualViewport?.addEventListener('resize', scheduleFit);

const state = { dusk: Q.has('dusk'), tier: detected.tier, texSet, gpu: detected.gpu, tierSource: detected.source, quality: detected.tier, qualityHigh: qualityPair(detected.tier).find(q => q !== 'mobile') ?? 'mobile', ready: false, loaded: 0, total: 1, mode: 'walk', onLock: null };
const ui = new UI(state);
const house = await (await fetch('data/house.json')).json();
const points = await (await fetch('data/floorplan_points.json')).json();
const tour = await (await fetch('data/tour.json')).json();
const posts = await (await fetch('data/rednote_posts.json')).json();
// The precomputed daylight bake (see daylight.js); ?daylight=live ignores it, which tools/bake_daylight.mjs uses.
const daylightFile = Q.get('daylight') === 'live' ? Promise.resolve(null) : fetch('data/daylight.bin').then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
const photoSpots = await fetch('data/photo_spots.json').then(r => r.ok ? r.json() : []).catch(() => []);

// ---- Lighting: daylight openings, practical fixtures and separate room / sky reflections.
const lighting = createLighting(renderer, scene, camera, house, preset);
if (bakedWanted && !lighting.renderConfig.hdr) bakedUnavailable = 'HDR framebuffer unavailable';
const { fixtures, composer, gtao } = lighting;
post = composer; fitView();
async function applyTime() {
  if (baked) state.dusk = baked.slotName === 'dusk';
  await lighting.applyTime(baked ? false : state.dusk);   // baked slots own their sky, sun and physical lamp level
  for (const o of layout.placed) o.userData.onTime?.(state.dusk, !state.ready);
  pets?.relight();
  if (baked) { try { await baked.warmDepth(); baked.afterTime(); } catch (err) { await fallbackLegacy(err); } }
  ui.syncLegends();
}

// ---- Build ----
// Each step yields a painted frame so the bar and its percentage actually move.
const step = (p, msg) => { ui.progress(p, msg); return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0))); };
// Long awaits (texture downloads, shader compile) keep the percentage moving: it eases from `from` toward `to`, never past
// the real fraction done when one is reported, and lands on `to` once the work settles.
async function during(from, to, msg, work) {
  let shown = from, real = 0;
  ui.progress(from, msg);
  const timer = setInterval(() => { shown += (to - shown) * 0.04; ui.progress(Math.max(shown, from + (to - from) * real), msg); }, 250);
  try { return await work((f) => { real = Math.min(1, f); }); } finally { clearInterval(timer); ui.progress(to, msg); }
}
ui.progress(0.05, 'sky');
// Only the sky the scene opens in; the other one is convolved after the bar reaches 100%.
await lighting.loadSky(state.dusk);
ui.progress(0.15, 'house');
const houseRoot = buildHouse(house);
scene.add(houseRoot);
ui.progress(0.25, 'garden');
const garden = buildGarden({ quality: preset.grass, camera });
scene.add(garden.group);
ui.progress(0.3, 'furniture');
const layout = new Layout(scene, fixtures, house, points);
await layout.build((p, msg) => ui.progress(0.3 + p * 0.35, msg));
await step(0.66, 'materials');
lighting.collectMaterials(scene);
await step(0.68, 'finishing');
const batch = Q.get('batch') === '0' ? { lod: [] } : batchStatic([houseRoot, layout.root], { skip: getDoors().map(d => d.group), anchors: layout.interactive, animated: layout.animated });
// Baked sunrise is the default. Keep the complete legacy setup until staging succeeds.
let baked = null;
state.baked = false;
state.bakedFallback = bakedUnavailable;
if (bakedWanted && !state.bakedFallback) {
  await step(0.69, 'lighting');
  try {
    baked = await applyLightmaps({ scene, renderer, lighting, movables: layout.movables,
      dynamic: [...getDoors().map(d => d.group), ...layout.animated.filter(o => o.userData.toggle)],
      slot: Q.get('lightmap') || 'sunrise', tier: Q.has('fast') ? 'mobile' : state.quality,
      onProgress: p => ui.progress(0.69 + p * 0.22) });
    state.baked = true; state.dusk = false;
    state.bakedSlots = baked.availableSlots; state.bakedSlot = baked.slotName;
  } catch (err) { state.bakedFallback = err.message; }
}
await step(0.92, 'controls');

// ---- Player, interaction, UI systems ----
const player = new Player(camera, canvas, state);
player.teleport(+(Q.get('x') ?? 0.0), -(+(Q.get('y') ?? -6.9)), +(Q.get('h') ?? 0), +(Q.get('p') ?? 0));   // default: the front walk, looking at the house
const human = new Human(scene, player); baked?.register(human.root);
const interact = new Interact(scene, camera, player, layout, ui, human);
const pets = Q.get('pets') === '0' ? null : new Pets({ scene, player, layout, camera, ui, lighting, seed: Q.has('petseed') ? +Q.get('petseed') : undefined });
if (pets) for (const a of pets.agents) baked?.register(a.root);
interact.pets = pets;
function applyFeatures(p) {
  if (!baked) return;
  if (p.contact && !scene.userData.contact) createContact({ scene, camera, lighting, movables: layout.movables, pets, player, human });
  scene.userData.contact?.setEnabled(p.contact);
  baked.setFeatures(p.name);
}
applyFeatures(Q.has('fast') ? TIERS.mobile : preset);
const minimap = new Minimap(player, layout, points, tour, posts, ui, (target) => goTo(target));
const viewpoints = new Viewpoints(scene, camera, player, points, tour, ui, renderer, photoSpots);
const rednote = new RedNote(posts, ui, viewpoints);
const tourCtl = new Tour(player, tour, points, ui, viewpoints);
const markers = new Markers(scene, camera, player, rednote, viewpoints, ui, houseRoot);
interact.markers = markers;
interact.viewRoots = viewpoints.viewRoots = [houseRoot, layout.root];
viewpoints.markers = markers;
if (Q.get('pins') === '0') Object.assign(markers.enabled, { rn: false, pano: false, photo: false });
minimap.setPlan(house); minimap.markers = markers; minimap.targets = viewpoints.targets;
minimap.setExtra(rednote.blips());
function goTo(target) { const pin = markers.pins.find(p => p.kind === target.kind && p.target.id === target.id); if (pin) markers.activate({ pin }); else viewpoints.goTo(target); }
ui.bind({ player, viewpoints, rednote, markers, tour: tourCtl, minimap, pets, toggleDusk, toggleQuality });

// ---- Post-processing: GTAO (contact shadows/ambient occlusion) + SMAA, per tier preset. J toggles quality.
// Toggling dusk needs the other sky now, so it opens the background preparation's quiet-moment gate (see below).
let skyUrgent = false;
let slotRequestId = 0;
async function setBakedSlot(name, { quiet = false } = {}) {   // quiet: the tour names the time in its own caption
  if (!state.ready || !firstFrameDrawn || state.bakedSlotPending || !baked || !baked.availableSlots.includes(name)) return false;
  const requestId = ++slotRequestId;
  state.bakedSlotPending = name; ui.syncLegends();
  const loading = quiet ? { progress() {}, hide() {} } : ui.slotLoading(name);   // the tour switches without the loading screen
  try {
    const switched = await baked.setSlot(name, loading.progress);
    if (!switched || requestId !== slotRequestId || !baked) return false;
    state.bakedSlot = baked.slotName; state.dusk = baked.slotName === 'dusk';
    for (const o of layout.placed) o.userData.onTime?.(state.dusk, false);
    ui.syncLegends(); if (!quiet) ui.toast(t(`slot_${baked.slotName}`));
    return true;
  } catch (err) { console.warn('baked slot kept previous scene', err); loading.hide(); if (requestId === slotRequestId) ui.toast(t('slotFailed')); return false; }
  finally { loading.hide(); state.bakedSlotPending = null; ui.syncLegends(); }
}
function toggleDusk() {
  if (baked) {
    if (baked.availableSlots.length < 2) { ui.toast(t('sunriseOnly')); return; }
    return setBakedSlot(baked.nextSlot());
  }
  skyUrgent = true; state.dusk = !state.dusk; ui.syncLegends(); applyTime();
}
// Mirror reflections exist only in the hq preset; their proxy scenes are built the first time it is used.
// Foliage antialiasing. Leaves are alpha-tested cut-outs, which MSAA cannot smooth on its own; alpha-to-coverage lets the
// cut-out edge use the multisample coverage instead. Mipmaps average a leaf's alpha down at distance, which thins
// canopies under alpha-to-coverage, so the cutoff drops to 45% of its original while it is on. Without MSAA,
// alpha-to-coverage would draw whole leaf cards, so it follows the tier's sample count.
const foliageMaterials = new Set();
function collectFoliageMaterials() {
  foliageMaterials.clear();
  scene.traverse(o => { for (const m of [].concat(o.material ?? [])) if (m.alphaTest > 0 && !m.transparent) foliageMaterials.add(m); });
}
collectFoliageMaterials();
function setFoliageAA(on) {
  for (const m of foliageMaterials) {
    m.userData.cutoff ??= m.alphaTest;
    const cutoff = on || lighting.taa ? m.userData.cutoff * 0.45 : m.userData.cutoff;   // PCSS depth copies keep dense leaf shadows under TAA too
    if (m.alphaToCoverage !== on || m.alphaTest !== cutoff) { m.alphaToCoverage = on; m.alphaTest = cutoff; m.needsUpdate = true; }
  }
}
setFoliageAA(!lighting.taa && lighting.renderConfig.samples > 0);
let mirrorsReady = false;
const mirrorsOn = () => lighting.renderConfig.hdr && TIERS[state.quality].mirrors;
function setQuality(name) {
  const p = TIERS[name]; if (!p) return Promise.resolve(); state.quality = name;
  garden.setQuality(p.grass); lighting.setQuality(p);
  applyFeatures(p);
  const switching = baked?.setQuality(name).catch(fallbackLegacy);
  activePreset = p; setFoliageAA(!lighting.taa && lighting.renderConfig.samples > 0); fitView();
  if (mirrorsOn() && !mirrorsReady && state.ready) { layout.prepareMirrors(); mirrorsReady = true; }
  ui.syncLegends();
  return switching ?? Promise.resolve();
}
async function fallbackLegacy(err) {
  if (!baked) return;
  state.bakedFallback = err.message;
  baked.dispose(); baked = null; state.baked = false;
  if (window.__app) window.__app.baked = null;
  ui.renderHelp(); ui.syncLegends();
  const file = await daylightFile;
  if (!lighting.daylight?.load(file)) lighting.bakeDaylight();
  lighting.setQuality(TIERS[state.quality]);
  collectFoliageMaterials(); setFoliageAA(lighting.renderConfig.samples > 0);
  await applyTime();
  if (mirrorsReady) layout.prepareMirrors();
}
// The detected tier is the starting point; J switches to its pair (hq/laptop <-> mobile, mobile <-> laptop) and back.
function toggleQuality() { const [own, other] = qualityPair(state.tier); setQuality(state.quality === own ? other : own); }
ui.renderHelp(); ui.syncLegends();

if (Q.has('eye')) { player.eyeHeight = +Q.get('eye'); player.eye = player.eyeHeight; }
if (Q.has('fast')) setQuality('mobile');
if (mirrorsOn()) { layout.prepareMirrors(); mirrorsReady = true; }
await step(0.93, 'textures');
await during(0.93, 0.955, 'textures', texturesDecoded);
// One time of day under the loading screen. Enter turns on before the warm draw: a Windows shader compile must not leave the button disabled.
await step(0.955, 'lighting');
const warmupStart = performance.now(), warmup = state.warmupSteps = {};
const lap = (k, t) => { warmup[k] = Math.round(performance.now() - t); return performance.now(); };
let lapStart = warmupStart;
await applyTime(); lapStart = lap('time', lapStart);
await step(0.96, 'shaders'); lapStart = lap('yield1', lapStart);
// Enter turns on before the shaders exist, so a slow compile never leaves the button disabled. Entering before the
// first frame is drawn shows a loading screen over the empty canvas until the warm draw below has put a frame on it.
const warming = document.getElementById('warming');
let firstFrameDrawn = false;
document.getElementById('enter').addEventListener('click', () => { state.enteredAt ??= performance.now(); if (!firstFrameDrawn) ui.showLoading(); });
state.ready = true; state.loadMs = performance.now(); ui.ready(); fitView();
await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
lapStart = lap('yield2', lapStart);
// Link every program before the first draw. With KHR_parallel_shader_compile (ANGLE exposes it on D3D11, Vulkan and
// Metal) the GPU process compiles on all cores while this polls; drawing first instead links and waits for the ~100
// programs one at a time on a single core, which on Windows blocks the tab for minutes (measured on an RTX 3070
// laptop: 89 s blocked and Ready at 124 s on Vulkan, D3D11 never finished in 7 min; with this, 11 s and 46 s).
// The race guards drivers whose completion poll never flips: after the timeout the warm draw finishes the compile.
// Compile with the composer's buffer bound: three bakes "render target or screen" into each program (tone mapping,
// output colour space), so compiling for the screen here would compile every material twice.
const warmScene = () => warmPrograms(renderer, scene, camera, lighting.renderConfig.direct ? null : composer.readBuffer);
const compiling = warmScene().then(() => baked?.checkPatches()).catch(async err => {
  if (!baked) throw err;
  await fallbackLegacy(err); await warmScene();
}).catch(err => console.warn('shader warmup', err));   // never reject: the load awaits this below
// Real progress for the loading screen: KHR_parallel_shader_compile answers "is this program linked yet?" without
// blocking, so the bar counts finished programs out of all of them. Without the extension the bar stays indeterminate.
const stopCompileProgress = (() => {
  const gl = renderer.getContext(), ext = gl.getExtension('KHR_parallel_shader_compile'), programs = renderer.info.programs || [];
  const bar = document.getElementById('warmbar'), count = document.getElementById('warmcount');
  if (!ext || !programs.length || !bar) return () => {};
  const tick = () => {
    let done = 0; for (const p of programs) if (gl.getProgramParameter(p.program, ext.COMPLETION_STATUS_KHR)) done++;
    warming.dataset.known = ''; bar.style.width = `${Math.round(4 + 88 * done / programs.length)}%`;
    count.textContent = `${t('warmCount')} ${done} / ${programs.length}`;
  };
  tick(); const id = setInterval(tick, 120); return () => { clearInterval(id); tick(); };
})();
// compileAsync has queued every link, so the GPU process is busy on all cores: the daylight bake (~2 s of CPU ray
// tests) runs now, overlapping the compile instead of adding to the load. Its textures upload before the warm draw.
// Use the shipped bake when it matches this build's walls, furniture and windows; otherwise run the ray tests here.
if (!baked) { // The file was requested at startup and is normally long here; never let a stalled request hold the load.
  const file = await Promise.race([daylightFile, new Promise(resolve => setTimeout(() => resolve(null), 4000))]);
  if (!lighting.daylight?.load(file)) {
    lighting.bakeDaylight();
  }
  state.daylightSource = lighting.daylight?.source; }
lapStart = lap('bake', lapStart);
await Promise.race([compiling, new Promise(resolve => setTimeout(resolve, 120000))]);
stopCompileProgress(); document.getElementById('warmbar').style.width = '94%';
// The first draw below blocks the page for a moment (texture uploads, shadow maps, the last shader links). Name that step and
// let it paint first, so a visitor already on the loading screen sees "Lighting the rooms" rather than a stalled count.
if (!warming.classList.contains('hidden')) {
  document.getElementById('warmcount').textContent = t('warmDraw');
  await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
}
lapStart = lap('compile', lapStart);
try {
  layout.updateMirrors(camera, mirrorsOn(), renderer);
  composer.render();
  if (mirrorsOn()) layout.warmMirrors(renderer);
} catch (err) {
  console.warn('warmup', err);
  try { renderer.render(scene, camera); } catch (_) {}
}
lapStart = lap('draw', lapStart);
firstFrameDrawn = true;
document.getElementById('warmbar').style.width = '100%';
ui.hideLoading();
state.lightingWarmupMs = performance.now() - warmupStart;
// The other time of day (HDR download, CPU tint, PMREM and room bounce) waits until the walkthrough is up.
// Both skies share the CubeUV environment layout and fixed light counts, so a dusk toggle reuses the compiled programs.
// Its CPU and GPU steps cost a ~150 ms hitch, so they run while the visitor is still on the landing page, or, once they
// have entered, no sooner than 8 s after entering and only while they stand still: never on the reveal, never mid-walk.
const idle = cb => (window.requestIdleCallback ? requestIdleCallback(cb, { timeout: 4000 }) : setTimeout(cb, 1500));
const titleShown = () => !document.getElementById('title').classList.contains('hidden');
const quietMoment = () => titleShown() || (performance.now() - (state.enteredAt ?? 0) > 8000 && player.keys.size === 0 && !tourCtl.active && !viewpoints.fly);
// The download starts right away; each heavy step waits for whenQuiet() (or for a dusk toggle, which needs it now).
const whenQuiet = () => new Promise(resolve => { const check = () => (skyUrgent || quietMoment() ? idle(resolve) : setTimeout(check, 500)); check(); });
if (!baked) idle(() => { const other = !state.dusk, t0 = performance.now(); lighting.prepareTime(other, whenQuiet).then(() => { state.otherSkyMs = performance.now() - t0; }); });
if (Q.has('x') || Q.has('auto')) { document.getElementById('title').classList.add('hidden'); fitView(); }
document.getElementById('enter').addEventListener('click', fitView);

// ---- Loop. Deterministic hooks for screenshots: window.renderAt(t) draws exactly time t.
const clock = new THREE.Clock(); let simT = 0;
// Animated toggles (the garage door's ~3 s run, gates, lids) move shadow casters too: the sun shadow is refreshed while one
// moves or snaps to a new value, on every tier; lighting.update adds the frame after it settles.
const toggled = layout.animated.filter(o => o.userData.toggle).map(o => ({ toggle: o.userData.toggle, value: o.userData.toggle.value }));
const togglesMoving = () => toggled.reduce((any, t) => { const v = t.toggle.value, changed = t.toggle.moving || v !== t.value; t.value = v; return any || changed; }, false);
function frame(dt) {
  if (photo.active) return;   // photo mode owns the canvas while it shows a still
  stats.begin();
  simT += dt;
  tourCtl.update(dt);
  demo.update(dt);
  viewpoints.update(dt);
  player.update(dt);
  human.update(dt);
  pets?.update(dt);
  interact.update(dt);
  markers.update(dt);
  updateSwayLod(batch.lod, camera.position);
  updateRoomVisibility(batch.rooms, camera.position);
  layout.animate(simT); if (!viewpoints.panoOpaque) layout.updateMirrors(camera, mirrorsOn(), renderer);
  garden.update(simT);
  minimap.draw();
  lighting.update(dt, false, togglesMoving() || !!interact.grab || interact.returning.length > 0 || getDoors().some(d => d._t < 1));
  try { baked?.updateMovables(dt); } catch (err) { fallbackLegacy(err); }
  try {
    // An opaque panorama hides the whole house, so only its sphere is drawn. While it fades in, the house goes through the
    // composer as usual and the sphere is laid over it: drawing the house straight to the screen instead would compile a
    // second, screen-target variant of every material on the spot (a 0.1-0.4 s freeze on entering a panorama).
    if (!viewpoints.panoOpaque) { if (state.composerFailed) renderer.render(scene, camera); else composer.render(); }
    // Overlay pass: the panorama sphere and the floating photo cards, on top of the finished frame.
    if (viewpoints.panoActive || markers.overlayActive) {
      // The scene's sky background would otherwise be drawn again over the finished frame, so it is lifted for this pass.
      const mask = camera.layers.mask, autoClear = renderer.autoClear, background = scene.background;
      camera.layers.set(OVERLAY_LAYER); renderer.autoClear = viewpoints.panoOpaque; scene.background = null;
      renderer.render(scene, camera);
      camera.layers.mask = mask; renderer.autoClear = autoClear; scene.background = background;
    }
  } catch (err) {
    if (!state.composerFailed) { state.composerFailed = true; console.warn('composer', err); }
    try { renderer.render(scene, camera); } catch (_) {}
  }
  stats.end();
}
// The demonstration (X): a scripted promenade through the controls.
// Photo mode: a path-traced still of the current view (see photo.js).
const photo = new PhotoMode({ renderer, scene, camera, lighting, getTier: () => state.tier });
const photoUI = new PhotoUI({ photo, player, ui });
photoFit = () => photo.onResize?.();
const demo = new Demo({ player, viewpoints, markers, pets, ui, tour: tourCtl, interact, layout });
document.getElementById('btn-demo').onclick = () => demo.toggle();
// Stats for nerds (hidden): the right-click menu's last item, the ` key, or ?stats=1.
const stats = new Stats({ renderer, camera, player, state, lighting, pets, canvas });
addEventListener('crotonstats', () => stats.toggle());
addEventListener('keydown', (e) => { if (e.code === 'Backquote' && !e.repeat && e.target?.tagName !== 'INPUT') stats.toggle(); });
if (Q.has('stats')) stats.toggle(true);
window.simTime = () => simT;   // read-only clock for deterministic tools: step with renderAt(simTime() + dt)
window.renderAt = (t) => { const dt = Math.max(0, Math.min(0.1, t - simT)); frame(dt || 1 / 60); };
window.__app = { baked, photo, photoUI, demo, stats, tier: state.tier, scene, camera, player, layout, garden, viewpoints, tourCtl, rednote, state, applyTime, setQuality, toggleQuality, toggleDusk, setBakedSlot, renderer, lighting, goTo, minimap, interact, THREE, nav: { buildGrid }, getDoors, markers, pets };
// Frame cap: 30 fps by default to keep laptops cool and fans quiet; ?fps=60 picks another cap, ?fps=0 runs uncapped.
// Skipped display refreshes cost nothing. The schedule advances by whole frame periods so 120/144 Hz screens still average the
// cap, and it never runs more than one period behind, so a stall or a hidden tab does not cause a burst of catch-up frames.
const fpsParam = Q.get('fps'), fpsCap = fpsParam !== null && fpsParam !== '' && Number.isFinite(+fpsParam) ? Math.max(0, +fpsParam) : 30;
const framePeriod = fpsCap > 0 ? 1000 / fpsCap : 0;
state.fpsCap = fpsCap;
let readyFrames = 0, nextFrameAt = 0;
// ?capture: the app stops drawing on its own so a recorder can step it frame by frame with renderAt (tools/promo.mjs).
const CAPTURE = Q.has('capture');
const loop = (now) => {
  requestAnimationFrame(loop);
  if (CAPTURE && readyFrames >= 12) return;
  // The cap is lifted inside an opaque panorama: drawing one textured sphere is nearly free, and panning a photo at 30 fps judders.
  if (framePeriod && !viewpoints.panoOpaque) { if (now < nextFrameAt - 1) return; nextFrameAt = (now - nextFrameAt > framePeriod ? now : nextFrameAt) + framePeriod; }
  const dt = Math.min(0.1, clock.getDelta()); if (!document.hidden) frame(dt); if (++readyFrames === 12) window.__ready = true;
};
requestAnimationFrame(loop);
