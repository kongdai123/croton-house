// Standalone stage for a furniture module: showcase.html?module=living&item=sofa&az=35&el=18&dist=4&t=0.5
// Renders one item (or every item of a module laid out in a row) under studio lighting on a neutral floor.
// window.renderAt(t) exists for deterministic screenshots; ?shot=1 freezes the orbit.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { setEnvironment, M } from './materials.js';
import { sizeOf } from './kit.js';
import { MODULES } from './furniture/index.js';

const q = new URLSearchParams(location.search);
const modName = q.get('module') || 'living', itemName = q.get('item');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xdcdad4);
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 100);
const floor = new THREE.Mesh(new THREE.CircleGeometry(12, 64), M.floorOak()); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const sun = new THREE.DirectionalLight(0xfff2e0, 3.0); sun.position.set(4, 7, 5); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.02;
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 25 }); scene.add(sun);
scene.add(new THREE.HemisphereLight(0xe8f0ff, 0xb9a48a, 0.6));
const fill = new THREE.DirectionalLight(0xdfe8ff, 0.8); fill.position.set(-5, 4, -3); scene.add(fill);
new RGBELoader().load('assets/hdr/drakensberg_solitary_mountain_puresky_2k.hdr', (hdr) => { const pm = new THREE.PMREMGenerator(renderer); const env = pm.fromEquirectangular(hdr).texture; scene.environment = env; scene.environmentIntensity = 0.7; setEnvironment(env); hdr.dispose(); });

const mod = await MODULES[modName]?.();
const hud = document.getElementById('hud');
if (!mod) { hud.textContent = `unknown module "${modName}". Known: ${Object.keys(MODULES).join(', ')}`; throw new Error('no module'); }
const items = itemName ? { [itemName]: mod.items[itemName] } : mod.items;
const roots = []; let x = 0, lines = [];
for (const [name, build] of Object.entries(items)) {
  if (!build) { lines.push(`! no item "${name}"; items: ${Object.keys(mod.items).join(', ')}`); continue; }
  const obj = build(); const s = sizeOf(obj);
  obj.position.x = x + s.w / 2; x += s.w + 0.6; scene.add(obj); roots.push(obj);
  lines.push(`${name}: ${s.w}×${s.h}×${s.d} m  minY=${s.minY}  seats=${obj.userData.seats?.length ?? 0} movable=${!!obj.userData.movable} collider=${obj.userData.collider ? 'yes' : 'no'}`);
  if (obj.userData.seats) for (const st of obj.userData.seats) { const mk = new THREE.Mesh(new THREE.SphereGeometry(0.04), new THREE.MeshBasicMaterial({ color: 0xff3366 })); mk.position.set(st.x, st.y, st.z); obj.add(mk); const dir = new THREE.ArrowHelper(new THREE.Vector3(Math.sin(st.facing), 0, Math.cos(st.facing)), new THREE.Vector3(st.x, st.y, st.z), 0.3, 0xff3366); obj.add(dir); }
  if (q.get('collider') && obj.userData.collider) { const c = obj.userData.collider; const h = new THREE.Mesh(new THREE.BoxGeometry(c.w, c.h, c.d), new THREE.MeshBasicMaterial({ color: 0x33aaff, wireframe: true })); h.position.set(c.x, c.h / 2, c.z); obj.add(h); }
}
hud.textContent = `${modName}${itemName ? '/' + itemName : ''}\n` + lines.join('\n');
const total = Math.max(x - 0.6, 1);
const center = new THREE.Vector3(total / 2, 0.5, 0);
const dist = +(q.get('dist') || Math.max(2.5, total * 0.9)), az = THREE.MathUtils.degToRad(+(q.get('az') || 30)), el = THREE.MathUtils.degToRad(+(q.get('el') || 18));
camera.position.set(center.x + Math.sin(az) * Math.cos(el) * dist, center.y + Math.sin(el) * dist, center.z + Math.cos(az) * Math.cos(el) * dist);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.copy(center); controls.update();
window.renderAt = (t) => { for (const r of roots) r.userData.animate?.(t); controls.update(); renderer.render(scene, camera); };
window.__ready = false;
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
if (!q.has('shot')) { const loop = (ms) => { window.renderAt(ms / 1000); requestAnimationFrame(loop); }; requestAnimationFrame(loop); }
setTimeout(() => { window.renderAt(+(q.get('t') || 0)); window.__ready = true; }, 1500);
