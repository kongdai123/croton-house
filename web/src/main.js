// 2513 Croton Ave · interactive photoreal walkthrough. Entry point.
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { setEnvironment, M } from './materials.js';
import { buildHouse, CEIL } from './house.js';
import { Player } from './player.js';
import { Layout } from './layout.js';
import { Interact } from './interact.js';
import { Minimap } from './minimap.js';
import { Viewpoints } from './viewpoints.js';
import { RedNote } from './rednote.js';
import { Tour } from './tour.js';
import { UI, t, setLang, getLang } from './ui.js';
import { Human } from './human.js';

const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 300);
scene.add(camera);

const state = { dusk: false, quality: 'hq', ready: false, loaded: 0, total: 1, mode: 'walk', onLock: null };
const ui = new UI(state);
const house = await (await fetch('data/house.json')).json();
const points = await (await fetch('data/floorplan_points.json')).json();
const tour = await (await fetch('data/tour.json')).json();
const posts = await (await fetch('data/rednote_posts.json')).json();

// ---- Lighting rig: HDRI sky (day / dusk) for ambient+reflections, a sun directional light with a large soft shadow map,
//      and interior fixtures from the furniture modules (point/spot/rect lights, on at dusk).
const pmrem = new THREE.PMREMGenerator(renderer); pmrem.compileEquirectangularShader();
const skies = {};
async function loadSky(name) { if (skies[name]) return skies[name]; const hdr = await new RGBELoader().loadAsync(`assets/hdr/${name}_2k.hdr`); const env = pmrem.fromEquirectangular(hdr).texture; hdr.mapping = THREE.EquirectangularReflectionMapping; skies[name] = { env, bg: hdr }; return skies[name]; }
const DAY = 'drakensberg_solitary_mountain_puresky', DUSK = 'belfast_sunset_puresky';
const roomEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const sun = new THREE.DirectionalLight(0xfff1dc, 3.2); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.00015; sun.shadow.normalBias = 0.03; sun.shadow.radius = 2;
Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 80 }); scene.add(sun); scene.add(sun.target);
const hemi = new THREE.HemisphereLight(0xfff6ea, 0xd9c4a8, 0.55); scene.add(hemi);
const fixtures = new THREE.Group(); scene.add(fixtures);   // interior lights (added by layout)
for (const [gx, gz] of [[-6.0, 1.5], [-6.0, 3.8]]) { const gl = new THREE.PointLight(0xfff2dc, 2.2, 7, 1.5); gl.position.set(gx, 2.35, gz); gl.userData.base = 2.2; gl.userData.always = true; fixtures.add(gl); }

function applyTime() {
  const sky = skies[state.dusk ? DUSK : DAY]; if (!sky) return;
  scene.environment = roomEnv; scene.background = sky.bg; scene.backgroundBlurriness = 0.0;
  setEnvironment(roomEnv, state.dusk ? 0.18 : 0.8);
  if (state.dusk) {
    sun.color.set(0xffa36a); sun.intensity = 0.9; sun.position.set(-30, 7, 18); scene.environmentIntensity = 0.18; scene.backgroundIntensity = 0.45; hemi.intensity = 0.25; hemi.color.set(0x8a9cc8); hemi.groundColor.set(0x3a2f26);
    renderer.toneMappingExposure = 1.0;
  } else {
    sun.color.set(0xfff3e2); sun.intensity = 3.4; sun.position.set(-14, 24, 10); scene.environmentIntensity = 0.8; scene.backgroundIntensity = 1.0; hemi.intensity = 0.55; hemi.color.set(0xfff6ea); hemi.groundColor.set(0xd9c4a8);
    renderer.toneMappingExposure = 1.12;
  }
  fixtures.visible = true; for (const l of fixtures.children) if (l.isLight) l.intensity = l.userData.always ? l.userData.base : (state.dusk ? l.userData.base * 3.2 : l.userData.base * 0.08);
  for (const e of emissives) e.emissiveIntensity = state.dusk ? e.userData.base * 1.5 : 0.12;
  document.getElementById('btn-dusk').classList.toggle('on', state.dusk);
}
const emissives = [];
function collectEmissives(root) { root.traverse(o => { if (o.isMesh && o.material?.emissive && o.material.emissiveIntensity > 0 && !emissives.includes(o.material)) { o.material.userData.base = o.material.emissiveIntensity; emissives.push(o.material); } }); }

// ---- Build ----
ui.progress(0.05, 'sky');
await loadSky(DAY);
ui.progress(0.15, 'house');
const houseRoot = buildHouse(house);
scene.add(houseRoot);
ui.progress(0.3, 'furniture');
const layout = new Layout(scene, fixtures, house, points);
await layout.build((p, msg) => ui.progress(0.3 + p * 0.55, msg));
collectEmissives(scene);
ui.progress(0.9, 'finishing');

// ---- Player, interaction, UI systems ----
const player = new Player(camera, canvas, state);
const Q = new URLSearchParams(location.search);
player.teleport(+(Q.get('x') ?? 0.0), -(+(Q.get('y') ?? -6.9)), +(Q.get('h') ?? 0), +(Q.get('p') ?? 0));   // default: the front walk, looking at the house
const human = new Human(scene, player);
const interact = new Interact(scene, camera, player, layout, ui, human);
const minimap = new Minimap(player, layout, points, tour, posts, ui, (target) => goTo(target));
const viewpoints = new Viewpoints(scene, camera, player, points, tour, ui, renderer);
const rednote = new RedNote(posts, ui, viewpoints);
const tourCtl = new Tour(player, tour, points, ui, viewpoints);
minimap.setExtra(viewpoints.extraBlips().concat(rednote.blips()));
function goTo(target) { viewpoints.goTo(target); }
ui.bind({ player, viewpoints, rednote, tour: tourCtl, minimap, toggleDusk: () => { state.dusk = !state.dusk; loadSky(DUSK).then(applyTime); }, toggleQuality });

// ---- Post-processing: GTAO (contact shadows/ambient occlusion) + SMAA. Toggle with the HQ chip.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, innerWidth, innerHeight); gtao.output = GTAOPass.OUTPUT.Default;
Object.assign(gtao.gtaoMaterial.defines ?? {}, {});
gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1, thickness: 1, distanceFallOff: 1, scale: 1.2, samples: 12, screenSpaceRadius: false });
gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 16 });
gtao.blendIntensity = 0.85;
composer.addPass(gtao);
const smaa = new SMAAPass(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio()); composer.addPass(smaa);
composer.addPass(new OutputPass());
function toggleQuality() { state.quality = state.quality === 'hq' ? 'fast' : 'hq'; gtao.enabled = state.quality === 'hq'; renderer.setPixelRatio(state.quality === 'hq' ? Math.min(devicePixelRatio, 2) : 1); composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(innerWidth, innerHeight); document.getElementById('btn-quality').classList.toggle('on', state.quality === 'hq'); }
document.getElementById('btn-quality').classList.add('on');
// mobile: start in fast mode
if (matchMedia('(pointer:coarse)').matches || innerWidth < 900) toggleQuality();

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); gtao.setSize(innerWidth, innerHeight); });

if (Q.has('dusk')) { state.dusk = true; await loadSky(DUSK); }
if (Q.has('eye')) { player.eyeHeight = +Q.get('eye'); player.eye = player.eyeHeight; }
if (Q.has('fast')) toggleQuality();
applyTime();
ui.progress(1, 'ready');
state.ready = true; ui.ready();
if (Q.has('x') || Q.has('auto')) { document.getElementById('title').classList.add('hidden'); }

// ---- Loop. Deterministic hooks for screenshots: window.renderAt(t) draws exactly time t.
const clock = new THREE.Clock(); let simT = 0; let fpsN = 0, fpsT = 0, fpsChecked = Q.has('fast') || Q.has('hq');
function frame(dt) {
  simT += dt;
  tourCtl.update(dt);
  viewpoints.update(dt);
  player.update(dt);
  human.update(dt);
  interact.update(dt);
  layout.animate(simT); layout.updateMirrors(camera.position);
  minimap.draw();
  sun.target.position.set(player.pos.x, 0, player.pos.z); sun.position.set(player.pos.x + (state.dusk ? -30 : -14), state.dusk ? 7 : 24, player.pos.z + (state.dusk ? 18 : 10));
  if (viewpoints.panoActive) renderer.render(scene, camera); else composer.render();
}
window.renderAt = (t) => { const dt = Math.max(0, Math.min(0.1, t - simT)); frame(dt || 1 / 60); };
window.__app = { scene, camera, player, layout, viewpoints, tourCtl, rednote, state, applyTime, renderer, goTo, minimap, interact, THREE };
let readyFrames = 0;
const loop = () => { const dt = Math.min(0.1, clock.getDelta()); if (!document.hidden) frame(dt); if (++readyFrames === 12) window.__ready = true; if (!fpsChecked && state.ready && document.getElementById('title').classList.contains('hidden')) { fpsN++; fpsT += dt; if (fpsT > 3) { fpsChecked = true; const fps = fpsN / fpsT; if (fps < 40 && state.quality === 'hq') { toggleQuality(); ui.toast(getLang() === 'zh' ? '已切到流畅模式（按 H 切回高画质）' : 'Switched to smooth mode (H for high quality)', 3000); } } } requestAnimationFrame(loop); };
requestAnimationFrame(loop);
