// 2513 Croton Ave · interactive photoreal walkthrough. Entry point.
import * as THREE from 'three';
import { createLighting } from './lighting.js';
import { buildHouse, CEIL, getDoors } from './house.js';
import { buildGarden } from './grass.js';
import { Player } from './player.js';
import { Layout } from './layout.js';
import { Interact } from './interact.js';
import { Minimap } from './minimap.js';
import { Viewpoints } from './viewpoints.js';
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

// ---- Device tier first: it sets MSAA, pixel ratio, shadow map size, post passes and texture limits before any of them exist.
const Q = new URLSearchParams(location.search);
const detected = detectTier();
const preset = TIERS[detected.tier];
const texSet = detectTexSet(detected.tier);
setAnisotropy(Math.min(8, preset.anisotropy)); setTextureCap(preset.textureCap); setTextureSet(texSet);
const pixelRatio = p => Math.min(devicePixelRatio, p.pixelRatio);
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: detected.tier === 'hq', powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(pixelRatio(preset));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 300);
scene.add(camera);
// Size the drawing buffer from the canvas box (CSS keeps #gl covering the viewport; setSize(..., false) writes no inline size).
// Registered before any await so viewport changes during the loading screen still reach the canvas; composer joins once lighting exists.
let post = null;
function fitView() {
  const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h, false); post?.setSize(w, h);
}
fitView();
new ResizeObserver(fitView).observe(canvas);
addEventListener('resize', fitView);
visualViewport?.addEventListener('resize', fitView);

const state = { dusk: Q.has('dusk'), tier: detected.tier, texSet, gpu: detected.gpu, tierSource: detected.source, quality: detected.tier, qualityHigh: qualityPair(detected.tier).find(q => q !== 'mobile') ?? 'mobile', ready: false, loaded: 0, total: 1, mode: 'walk', onLock: null };
const ui = new UI(state);
const house = await (await fetch('data/house.json')).json();
const points = await (await fetch('data/floorplan_points.json')).json();
const tour = await (await fetch('data/tour.json')).json();
const posts = await (await fetch('data/rednote_posts.json')).json();
const photoSpots = await fetch('data/photo_spots.json').then(r => r.ok ? r.json() : []).catch(() => []);

// ---- Lighting: daylight openings, practical fixtures and separate room / sky reflections.
const lighting = createLighting(renderer, scene, camera, house, preset);
const { fixtures, composer, gtao } = lighting;
post = composer; fitView();
async function applyTime() {
  await lighting.applyTime(state.dusk);
  for (const o of layout.placed) o.userData.onTime?.(state.dusk, !state.ready);
  pets?.relight();
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
await layout.build((p, msg) => ui.progress(0.3 + p * 0.55, msg));
await step(0.86, 'materials');
lighting.collectMaterials(scene);
await step(0.9, 'finishing');
const batch = Q.get('batch') === '0' ? { lod: [] } : batchStatic([houseRoot, layout.root], { skip: getDoors().map(d => d.group), anchors: layout.interactive, animated: layout.animated });
await step(0.92, 'controls');

// ---- Player, interaction, UI systems ----
const player = new Player(camera, canvas, state);
player.teleport(+(Q.get('x') ?? 0.0), -(+(Q.get('y') ?? -6.9)), +(Q.get('h') ?? 0), +(Q.get('p') ?? 0));   // default: the front walk, looking at the house
const human = new Human(scene, player);
const interact = new Interact(scene, camera, player, layout, ui, human);
const pets = Q.get('pets') === '0' ? null : new Pets({ scene, player, layout, camera, ui, lighting, seed: Q.has('petseed') ? +Q.get('petseed') : undefined });
interact.pets = pets;
const minimap = new Minimap(player, layout, points, tour, posts, ui, (target) => goTo(target));
const viewpoints = new Viewpoints(scene, camera, player, points, tour, ui, renderer, photoSpots);
const rednote = new RedNote(posts, ui, viewpoints);
const tourCtl = new Tour(player, tour, points, ui, viewpoints);
const markers = new Markers(scene, camera, player, rednote, viewpoints, ui, houseRoot);
interact.markers = markers;
interact.viewRoots = viewpoints.viewRoots = [houseRoot, layout.root];
viewpoints.markers = markers;
if (Q.get('pins') === '0') Object.assign(markers.enabled, { rn: false, pano: false, photo: false });
minimap.markers = markers; minimap.targets = viewpoints.targets;
minimap.setExtra(rednote.blips());
function goTo(target) { const pin = markers.pins.find(p => p.kind === target.kind && p.target.id === target.id); if (pin) markers.activate({ pin }); else viewpoints.goTo(target); }
ui.bind({ player, viewpoints, rednote, markers, tour: tourCtl, minimap, pets, toggleDusk, toggleQuality });

// ---- Post-processing: GTAO (contact shadows/ambient occlusion) + SMAA, per tier preset. J toggles quality.
function toggleDusk() { state.dusk = !state.dusk; ui.syncLegends(); applyTime(); }
// Mirror reflections exist only in the hq preset; their proxy scenes are built the first time it is used.
let mirrorsReady = false;
const mirrorsOn = () => TIERS[state.quality].mirrors;
function setQuality(name) {
  const p = TIERS[name]; state.quality = name;
  garden.setQuality(p.grass); lighting.setQuality(p);
  renderer.setPixelRatio(pixelRatio(p)); composer.setPixelRatio(renderer.getPixelRatio()); fitView();
  if (p.mirrors && !mirrorsReady && state.ready) { layout.prepareMirrors(); mirrorsReady = true; }
  ui.syncLegends();
}
// The detected tier is the starting point; J switches to its pair (hq/laptop <-> mobile, mobile <-> laptop) and back.
function toggleQuality() { const [own, other] = qualityPair(state.tier); setQuality(state.quality === own ? other : own); }
ui.syncLegends();

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
// Enter cannot wait on compileAsync. Its compile() freezes the tab (the bar sits at 96%), and on some
// Windows drivers the ready-poll never resolves, so the scene is built and the button stays disabled.
state.ready = true; state.loadMs = performance.now(); ui.ready(); fitView();
await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
lapStart = lap('yield2', lapStart);
try {
  layout.updateMirrors(camera, mirrorsOn(), renderer);
  composer.render();
  if (mirrorsOn()) layout.warmMirrors(renderer);
} catch (err) {
  console.warn('warmup', err);
  try { renderer.render(scene, camera); } catch (_) {}
}
lapStart = lap('draw', lapStart);
state.lightingWarmupMs = performance.now() - warmupStart;
// The other time of day (HDR download, CPU tint, PMREM and room bounce) waits until the walkthrough is up.
// Both skies share the CubeUV environment layout and fixed light counts, so a dusk toggle reuses the compiled programs.
const idle = cb => (window.requestIdleCallback ? requestIdleCallback(cb, { timeout: 4000 }) : setTimeout(cb, 1500));
idle(() => { const other = !state.dusk, t0 = performance.now(); lighting.prepareTime(other).then(() => { state.otherSkyMs = performance.now() - t0; }); });
if (Q.has('x') || Q.has('auto')) { document.getElementById('title').classList.add('hidden'); fitView(); }
document.getElementById('enter').addEventListener('click', fitView);

// ---- Loop. Deterministic hooks for screenshots: window.renderAt(t) draws exactly time t.
const clock = new THREE.Clock(); let simT = 0;
// Animated toggles (the garage door's ~3 s run, gates, lids) move shadow casters too: the sun shadow is refreshed while one
// moves or snaps to a new value, on every tier; lighting.update adds the frame after it settles.
const toggled = layout.animated.filter(o => o.userData.toggle).map(o => ({ toggle: o.userData.toggle, value: o.userData.toggle.value }));
const togglesMoving = () => toggled.reduce((any, t) => { const v = t.toggle.value, changed = t.toggle.moving || v !== t.value; t.value = v; return any || changed; }, false);
function frame(dt) {
  simT += dt;
  tourCtl.update(dt);
  viewpoints.update(dt);
  player.update(dt);
  human.update(dt);
  pets?.update(dt);
  interact.update(dt);
  markers.update(dt);
  updateSwayLod(batch.lod, camera.position);
  updateRoomVisibility(batch.rooms, camera.position);
  layout.animate(simT); layout.updateMirrors(camera, mirrorsOn(), renderer);
  garden.update(simT);
  minimap.draw();
  lighting.update(dt, false, togglesMoving() || !!interact.grab || interact.returning.length > 0 || getDoors().some(d => d._t < 1));
  try {
    if (viewpoints.panoActive || state.composerFailed) renderer.render(scene, camera); else composer.render();
  } catch (err) {
    if (!state.composerFailed) { state.composerFailed = true; console.warn('composer', err); }
    try { renderer.render(scene, camera); } catch (_) {}
  }
}
window.renderAt = (t) => { const dt = Math.max(0, Math.min(0.1, t - simT)); frame(dt || 1 / 60); };
window.__app = { tier: state.tier, scene, camera, player, layout, garden, viewpoints, tourCtl, rednote, state, applyTime, setQuality, toggleQuality, toggleDusk, renderer, lighting, goTo, minimap, interact, THREE, nav: { buildGrid }, getDoors, markers, pets };
let readyFrames = 0;
const loop = () => { const dt = Math.min(0.1, clock.getDelta()); if (!document.hidden) frame(dt); if (++readyFrames === 12) window.__ready = true; requestAnimationFrame(loop); };
requestAnimationFrame(loop);
