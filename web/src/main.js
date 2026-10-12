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

const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
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

const state = { dusk: false, quality: 'hq', ready: false, loaded: 0, total: 1, mode: 'walk', onLock: null };
const ui = new UI(state);
const house = await (await fetch('data/house.json')).json();
const points = await (await fetch('data/floorplan_points.json')).json();
const tour = await (await fetch('data/tour.json')).json();
const posts = await (await fetch('data/rednote_posts.json')).json();
const photoSpots = await fetch('data/photo_spots.json').then(r => r.ok ? r.json() : []).catch(() => []);

// ---- Lighting: daylight openings, practical fixtures and separate room / sky reflections.
const lighting = createLighting(renderer, scene, camera, house);
const { fixtures, composer, gtao } = lighting;
post = composer; fitView();
async function applyTime() {
  await lighting.applyTime(state.dusk);
  for (const o of layout.placed) o.userData.onTime?.(state.dusk, !state.ready);
  pets?.relight();
  ui.syncLegends();
}

// ---- Build ----
ui.progress(0.05, 'sky');
await lighting.loadSky();
ui.progress(0.15, 'house');
const houseRoot = buildHouse(house);
scene.add(houseRoot);
ui.progress(0.25, 'garden');
const garden = buildGarden({ quality: state.quality, camera });
scene.add(garden.group);
ui.progress(0.3, 'furniture');
const layout = new Layout(scene, fixtures, house, points);
await layout.build((p, msg) => ui.progress(0.3 + p * 0.55, msg));
lighting.collectMaterials(scene);
// Prepare both HDRs/PMREMs while the loading screen still covers the scene.
const lightingPreload = Promise.all([lighting.loadSky(false), lighting.loadSky(true)]);
ui.progress(0.9, 'finishing');
const Q0 = new URLSearchParams(location.search);
const batch = Q0.get('batch') === '0' ? { lod: [] } : batchStatic([houseRoot, layout.root], { skip: getDoors().map(d => d.group), anchors: layout.interactive, animated: layout.animated });

// ---- Player, interaction, UI systems ----
const player = new Player(camera, canvas, state);
const Q = new URLSearchParams(location.search);
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

// ---- Post-processing: GTAO (contact shadows/ambient occlusion) + SMAA. H toggles quality.
function toggleDusk() { state.dusk = !state.dusk; ui.syncLegends(); applyTime(); }
function toggleQuality() { state.quality = state.quality === 'hq' ? 'fast' : 'hq'; garden.setQuality(state.quality); lighting.setQuality(state.quality === 'hq'); renderer.setPixelRatio(state.quality === 'hq' ? Math.min(devicePixelRatio, 2) : 1); composer.setPixelRatio(renderer.getPixelRatio()); fitView(); ui.syncLegends(); }
ui.syncLegends();
// phones/tablets start in fast mode; desktops always start in HQ (H toggles)
if (matchMedia('(pointer:coarse)').matches) toggleQuality();

if (Q.has('dusk')) state.dusk = true;
if (Q.has('eye')) { player.eyeHeight = +Q.get('eye'); player.eye = player.eyeHeight; }
if (Q.has('fast')) toggleQuality();
await lightingPreload;
layout.prepareMirrors();
const initialDusk = state.dusk;
const warmupStart = performance.now();
for (const warmDusk of [!initialDusk, initialDusk]) {
  state.dusk = warmDusk;
  await applyTime();
  await renderer.compileAsync(scene, camera);
  // Include background conversion, shadow materials, mirrors and HQ post passes.
  // The loading screen covers these frames; the final frame restores the start time.
  layout.updateMirrors(camera, state.quality === 'hq', renderer);
  composer.render();
  layout.warmMirrors(renderer);
  await new Promise(resolve => requestAnimationFrame(resolve));
}
state.lightingWarmupMs = performance.now() - warmupStart;
ui.progress(1, 'ready');
state.ready = true; ui.ready(); fitView();
if (Q.has('x') || Q.has('auto')) { document.getElementById('title').classList.add('hidden'); fitView(); }
document.getElementById('enter').addEventListener('click', fitView);

// ---- Loop. Deterministic hooks for screenshots: window.renderAt(t) draws exactly time t.
const clock = new THREE.Clock(); let simT = 0;
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
  layout.animate(simT); layout.updateMirrors(camera, state.quality === 'hq', renderer);
  garden.update(simT);
  minimap.draw();
  lighting.update(dt, false, !!interact.grab || interact.returning.length > 0 || getDoors().some(d => d._t < 1));
  if (viewpoints.panoActive) renderer.render(scene, camera); else composer.render();
}
window.renderAt = (t) => { const dt = Math.max(0, Math.min(0.1, t - simT)); frame(dt || 1 / 60); };
window.__app = { scene, camera, player, layout, garden, viewpoints, tourCtl, rednote, state, applyTime, renderer, lighting, goTo, minimap, interact, THREE, nav: { buildGrid }, getDoors, markers, pets };
let readyFrames = 0;
const loop = () => { const dt = Math.min(0.1, clock.getDelta()); if (!document.hidden) frame(dt); if (++readyFrames === 12) window.__ready = true; requestAnimationFrame(loop); };
requestAnimationFrame(loop);
