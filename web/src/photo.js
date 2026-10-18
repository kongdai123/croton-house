// Photo mode: an offline, path-traced still of the current view, in the spirit of a Blender Cycles render.
// The walkthrough's real-time lighting is a set of tricks (window fill lights, a hemisphere light, a baked daylight
// volume, a fake room bounce). None of them come here. The tracer sees the plain geometry, the real sky HDR, the sun,
// and the house's own lamps, and works out every bounce itself. Lens effects are applied afterwards to the
// accumulated linear image, so the still can be re-developed without tracing again.
import * as THREE from 'three';
import { WebGLPathTracer, PhysicalCamera, FogVolumeMaterial } from 'three-gpu-pathtracer';
import { MeshBVH, SAH, acceleratedRaycast } from 'three-mesh-bvh';
import { GenerateMeshBVHWorker } from 'three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js';
import { photoSize } from './photo_budget.js';
import { makeSky, photoSupport, photoExposurePolicy, parseMood, kelvin, DEFAULT_MOOD } from './sky.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OVERLAY_LAYER } from './viewpoints.js';
import { isInside } from './plan.js';
import { lightingOf, meshLighting } from './lighting_roles.js';

const visible = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
// Helpers that only exist for the walkthrough's look (the manifest's role 'presentation': overlays, glow cards, decals,
// the pets' stand-in shadows) never reach the tracer or the bake export.
const presentation = o => {
  if (o.isMesh) return meshLighting(o).role === 'presentation';
  for (let p = o; p; p = p.parent) if (p.userData.presentation || p.userData.reflection) return true;
  return false;
};
// the lightmap identity (batch.js) rides along into the bake's GLB export as node extras
const lmTag = (o, m) => { if (o.userData.lmId) m.userData.lm = o.userData.lmId; else if (o.userData.lmSkip) m.userData.lmSkip = o.userData.lmSkip; return m; };

// One world-space geometry holding every instance of an InstancedMesh (the tracer only understands plain meshes).
async function expandInstanced(mesh, own, pause) {
  const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  if (src !== mesh.geometry) own(src);
  const pos = src.attributes.position, nor = src.attributes.normal, uv = src.attributes.uv, vc = src.attributes.color;
  const n = mesh.count, v = pos.count, ic = mesh.instanceColor;
  const P = new Float32Array(n * v * 3), N = nor ? new Float32Array(n * v * 3) : null, U = uv ? new Float32Array(n * v * 2) : null;
  const C = ic || vc ? new Float32Array(n * v * 3) : null;
  const m = new THREE.Matrix4(), nm = new THREE.Matrix3(), p = new THREE.Vector3(), c = new THREE.Color(1, 1, 1);
  for (let i = 0; i < n; i++) {
    mesh.getMatrixAt(i, m); m.premultiply(mesh.matrixWorld); nm.getNormalMatrix(m);
    if (ic) mesh.getColorAt(i, c);
    for (let j = 0; j < v; j++) {
      const k = (i * v + j);
      p.fromBufferAttribute(pos, j).applyMatrix4(m); P[k * 3] = p.x; P[k * 3 + 1] = p.y; P[k * 3 + 2] = p.z;
      if (N) { p.fromBufferAttribute(nor, j).applyMatrix3(nm).normalize(); N[k * 3] = p.x; N[k * 3 + 1] = p.y; N[k * 3 + 2] = p.z; }
      if (U) { U[k * 2] = uv.getX(j); U[k * 2 + 1] = uv.getY(j); }
      if (C) { const r = vc ? vc.getX(j) : 1, g = vc ? vc.getY(j) : 1, b = vc ? vc.getZ(j) : 1; C[k * 3] = r * c.r; C[k * 3 + 1] = g * c.g; C[k * 3 + 2] = b * c.b; }
      if ((k + 1) % 8192 === 0) await pause();
    }
  }
  const g = own(new THREE.BufferGeometry());
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  if (N) g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); else g.computeVertexNormals();
  if (U) g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  if (C) g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  return rgba(g);
}

// The tracer fills a missing vertex colour with four channels; every colour must have four too, or the merge
// misaligns them (the garden came out black). Only called on photograph-owned geometry.
function rgba(geometry) {
  const c = geometry.attributes.color;
  if (!c || c.itemSize === 4) return geometry;
  const out = new Float32Array(c.count * 4);
  for (let i = 0; i < c.count; i++) { out[i * 4] = c.getX(i); out[i * 4 + 1] = c.getY(i); out[i * 4 + 2] = c.getZ(i); out[i * 4 + 3] = 1; }
  geometry.setAttribute('color', new THREE.BufferAttribute(out, 4));
  return geometry;
}

// A skinned mesh (the dog, the cat, the visitor) frozen in its current pose, in world space.
async function bakeSkinned(mesh, own, pause) {
  const src = mesh.geometry, pos = src.attributes.position, P = new Float32Array(pos.count * 3), p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { p.fromBufferAttribute(pos, i); mesh.applyBoneTransform(i, p); p.applyMatrix4(mesh.matrixWorld); P[i * 3] = p.x; P[i * 3 + 1] = p.y; P[i * 3 + 2] = p.z; if ((i + 1) % 8192 === 0) await pause(); }
  const g = own(new THREE.BufferGeometry());
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  for (const k of ['uv', 'color']) if (src.attributes[k]) g.setAttribute(k, src.attributes[k].clone());
  if (src.index) g.setIndex(src.index.clone());
  for (const grp of src.groups) g.addGroup(grp.start, grp.count, grp.materialIndex);
  g.computeVertexNormals();
  return rgba(g);
}

// The sky HDR holds the sun as a few pixels thousands of times brighter than the rest. A path tracer finds such a
// tiny source mostly by luck, which shows as sparkles. So the sun is cut out of the lighting copy of the sky
// (clamped to a ceiling, hue kept) and added back as a directional light carrying exactly the energy removed:
// irradiance = sum of the excess radiance times each pixel's solid angle. Direction is the energy-weighted centroid.
async function splitSun(hdr, own, pause) {
  const { width: w, height: h, data } = hdr.image, half = data instanceof Uint16Array;
  const get = half ? i => THREE.DataUtils.fromHalfFloat(data[i]) : i => data[i];
  const lum = new Float32Array(w * h); let mean = 0;
  for (let i = 0; i < w * h; i++) { lum[i] = 0.2126 * get(i * 4) + 0.7152 * get(i * 4 + 1) + 0.0722 * get(i * 4 + 2); mean += lum[i]; if ((i + 1) % 65536 === 0) await pause(); }
  mean /= w * h;
  const cap = mean * 12, out = new data.constructor(data.length), E = [0, 0, 0], dir = new THREE.Vector3(), d = new THREE.Vector3();
  out.set(data);
  for (let y = 0; y < h; y++) {
    if (y % 32 === 0) await pause();
    const lat = (0.5 - (y + 0.5) / h) * Math.PI, dOmega = (2 * Math.PI / w) * (Math.PI / h) * Math.cos(lat);
    for (let x = 0; x < w; x++) {
      const i = y * w + x, l = lum[i];
      if (l <= cap) continue;
      const keep = cap / l, phi = ((x + 0.5) / w - 0.5) * 2 * Math.PI;
      for (let c = 0; c < 3; c++) {
        const v = get(i * 4 + c); E[c] += v * (1 - keep) * dOmega;
        out[i * 4 + c] = half ? THREE.DataUtils.toHalfFloat(v * keep) : v * keep;
      }
      d.set(Math.cos(phi) * Math.cos(lat), Math.sin(lat), Math.sin(phi) * Math.cos(lat));
      dir.addScaledVector(d, (l - cap) * dOmega);
    }
  }
  const env = own(new THREE.DataTexture(out, w, h, hdr.format, hdr.type));
  Object.assign(env, { mapping: hdr.mapping, flipY: hdr.flipY, colorSpace: hdr.colorSpace, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
  env.needsUpdate = true;
  const El = 0.2126 * E[0] + 0.7152 * E[1] + 0.0722 * E[2];
  const result = { env, sun: El > 0 ? { dir: dir.normalize(), color: new THREE.Color(E[0] / El, E[1] / El, E[2] / El), intensity: El } : null };
  return result;
}

// The tracer's merge gives each mesh one material slot, so a mesh with a material per group would shift every index
// after it. Such meshes are split into one mesh per group with photograph-owned attributes.
function splitGroups(geometry, own) {
  const index = geometry.index;
  return geometry.groups.map(group => {
    const g = own(new THREE.BufferGeometry());
    for (const [k, a] of Object.entries(geometry.attributes)) g.setAttribute(k, a);
    const end = Math.min(group.start + group.count, index ? index.count : geometry.attributes.position.count);
    const ids = new Uint32Array(Math.max(0, end - group.start));
    for (let i = 0; i < ids.length; i++) ids[i] = index ? index.getX(group.start + i) : group.start + i;
    g.setIndex(new THREE.BufferAttribute(ids, 1));
    return { geometry: g, materialIndex: group.materialIndex };
  });
}

// Convert known raster materials; unsupported shaders have no physical surface to trace.
function traceMaterial(material, cache, own) {
  if (cache.has(material)) return cache.get(material);
  let out = material;
  const L = lightingOf(material);
  if (material.isShaderMaterial) {
    // a shader effect (the fire pit's flames) has no physical surface; the fire's light is the pit's live light
    cache.set(material, null); return null;
  } else if (material.isMeshBasicMaterial) {
    out = new THREE.MeshStandardMaterial({ color: material.color, map: material.map, transparent: material.transparent, opacity: material.opacity, alphaTest: material.alphaTest, side: material.side, roughness: 1, emissive: 0xffffff, emissiveMap: material.map, emissiveIntensity: 0.35 });
  } else if (L.clearcoat) {
    // the tracer's clear-coat layer turns white quartz and white plastic black here; a plain glossy base reads the same
    out = material.clone(); out.clearcoat = 0; out.roughness = Math.min(out.roughness, 0.25 + 0.5 * material.clearcoatRoughness);
  } else if (L.sheer) {
    // sheer voile: no glow (the walkthrough lifts emissives to 0.12 by day, which made the bunched sheers the brightest
    // thing in the room and lit it), a soft sheen, and thin rough transmission for the light its fibres scatter through
    // from the window side. The tracer's transmission lobe is a blurred refraction; at roughness 1 through a thin sheet
    // it reads as a diffuse glow. The opacity / alpha map stay as the gaps between threads. Exported to Blender as
    // KHR_materials_transmission (weight below setup.py's glass threshold).
    out = material.clone(); out.emissive.setHex(0); out.emissiveIntensity = 0; out.sheen = 0.3;
    out.transmission = L.sheer.transmit; out.roughness = 1; out.ior = 1.5; out.thickness = 0;
  } else if (L.glass?.export === 'pane') {
    // window glass: clear, thin, transmissive instead of the real-time look's faded opacity
    out = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, metalness: 0, transmission: 1, ior: 1.5, thickness: 0, side: THREE.DoubleSide });
  }
  // Only real light sources emit (the manifest's emits: lamp surfaces, screens that are on, fire). The walkthrough's daytime glow on everything else (lighting.js lifts every other emissive material to 0.12,
  // so cloth reads as backlit) became light of its own here and in the Blender export: the cellular shades and sheers
  // lit the rooms. Their light now comes only from what reaches them.
  if (out.emissive && out.emissiveIntensity > 0 && out.emissive.getHex() !== 0 && !material.isShaderMaterial && !L.emits) {
    if (out === material) out = material.clone();
    out.emissive.setHex(0); out.emissiveIntensity = 0; out.emissiveMap = null;
  }
  if (out !== material) own(out);
  cache.set(material, out);
  return out;
}

// Where a mesh sits decides how wet it gets: the manifest's weather (lighting_roles.js weatherOf, as the baked lighting
// has it): 'ground' (paving, gravel, soil: darker, glossy, puddles), 'plant' (leaves: a little sheen), 'outdoor'
// (furniture, planters: slightly darker and smoother), or null (indoors, walls).

function wetMaterial(material, cls, wet, cache, own) {
  if (!cls || !(wet > 0) || !material.isMeshStandardMaterial || material.transmission > 0) return material;
  const key = material.uuid + cls; if (cache.has(key)) return cache.get(key);
  const m = own(material.clone()), mix = THREE.MathUtils.lerp;
  if (cls === 'ground') { m.color.multiplyScalar(mix(1, 0.62, wet)); m.roughness = mix(m.roughness, Math.max(0.07, m.roughness * 0.3), wet); m.roughnessMap = wet > 0.5 ? null : m.roughnessMap; }
  else if (cls === 'plant') { m.roughness = mix(m.roughness, Math.max(0.15, m.roughness * 0.45), wet); }
  else { m.color.multiplyScalar(mix(1, 0.88, wet)); m.roughness = mix(m.roughness, Math.max(0.1, m.roughness * 0.6), wet); }
  cache.set(key, m); return m;
}

// Puddles after rain: flat water films on level outdoor ground where a world-space noise field dips. The field is
// sampled on an 8 cm grid, each corner dropped onto the real ground by a ray, and the outline traced by marching
// squares, so edges are smooth curves rather than steps.
function hash2(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm2 = (x, y) => 0.55 * vnoise(x, y) + 0.3 * vnoise(x * 2.1 + 5.2, y * 2.1 + 1.3) + 0.15 * vnoise(x * 4.3 + 9.1, y * 4.3 + 7.7);

async function makePuddles(grounds, blockers, amount, own, pause) {
  const targets = [...grounds, ...blockers];
  const restore = targets.map(m => [m, m.raycast, m.geometry.boundsTree]);
  try {
    for (const m of targets) { await pause(); if (!m.geometry.boundsTree) m.geometry.boundsTree = new MeshBVH(m.geometry); m.raycast = acceleratedRaycast; }
    const ray = new THREE.Raycaster(); ray.firstHitOnly = true; ray.far = 6;
    const groundSet = new Set(grounds), cell = 0.08, x0 = -13, x1 = 13, y0 = -12, y1 = 16;
    const nx = Math.round((x1 - x0) / cell) + 1, ny = Math.round((y1 - y0) / cell) + 1;
    const F = new Float32Array(nx * ny).fill(-1), H = new Float32Array(nx * ny).fill(NaN), threshold = 0.72 - 0.16 * amount;
    const down = new THREE.Vector3(0, -1, 0), o = new THREE.Vector3();
    for (let j = 0; j < ny; j++) {
      if (j % 4 === 0) await pause();
      for (let i = 0; i < nx; i++) {
        const x = x0 + i * cell, y = y0 + j * cell;
        if (isInside(x, y)) continue;
        const f = fbm2(x * 0.55, y * 0.55) - threshold; if (f < -0.05) continue;
        o.set(x, 3, -y); ray.set(o, down);
        const hit = ray.intersectObjects(targets, false)[0];
        if (!hit || !groundSet.has(hit.object)) continue;
        const n = hit.face?.normal.clone().transformDirection(hit.object.matrixWorld);
        if (!n || Math.abs(n.y) < 0.97) continue;
        F[j * nx + i] = f; H[j * nx + i] = hit.point.y;
      }
    }
    const pos = [];
    const corner = (i, j) => [x0 + i * cell, y0 + j * cell, F[j * nx + i], H[j * nx + i]];
    for (let j = 0; j < ny - 1; j++) {
      if (j % 8 === 0) await pause();
      for (let i = 0; i < nx - 1; i++) {
        const c = [corner(i, j), corner(i + 1, j), corner(i + 1, j + 1), corner(i, j + 1)];
        if (c.some(k => Number.isNaN(k[3]))) continue;
        if (!c.some(k => k[2] > 0)) continue;
        const hs = c.map(k => k[3]); if (Math.max(...hs) - Math.min(...hs) > 0.03) continue;
        const poly = [];
        for (let k = 0; k < 4; k++) {
          const a = c[k], b = c[(k + 1) % 4];
          if (a[2] > 0) poly.push(a);
          if ((a[2] > 0) !== (b[2] > 0)) { const t = a[2] / (a[2] - b[2]); poly.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0, a[3] + (b[3] - a[3]) * t]); }
        }
        for (let k = 1; k < poly.length - 1; k++) for (const p of [poly[0], poly[k + 1], poly[k]]) pos.push(p[0], p[3] + 0.004, -p[1]);
      }
    }
    if (!pos.length) return null;
    const g = own(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    const water = own(new THREE.MeshPhysicalMaterial({ color: 0x1d1e20, roughness: 0.03, metalness: 0, ior: 1.33, specularIntensity: 1 }));
    water.name = 'puddle';
    return new THREE.Mesh(g, water);
  } finally { for (const [m, raycast, tree] of restore) { m.raycast = raycast; m.geometry.boundsTree = tree; } }
}

// A path tracer occasionally returns a NaN sample, and the developing passes spread one bad pixel far: the bloom mip
// chain turned it into a black square hundreds of pixels wide. Every pass that reads the traced image filters it.
const FINITE = 'vec3 finite(vec3 c) { return all(greaterThanEqual(c, vec3(0.0))) && all(lessThan(c, vec3(1e30))) ? c : vec3(0.0); }';

export class PhotoMode {
  constructor({ renderer, scene, camera, lighting, getTier = () => 'mobile' }) {
    Object.assign(this, { renderer, scene, camera, lighting, getTier });
    this.active = false; this.traceScene = null; this.tracer = null;
    this.resources = new Set(); this.ready = false; this.rendering = false;
    this.cam = new PhysicalCamera(camera.fov, camera.aspect, camera.near, camera.far);
    this.mood = null;   // null: the walkthrough's own sky and time of day
  }

  supportError() { return photoSupport(this.renderer); }
  own(r) { this.resources.add(r); return r; }
  check(cancel = true) {
    if (this.renderer.getContext().isContextLost()) throw new Error('Photo stopped: WebGL context lost.');
    if (cancel && this.stopping) throw new DOMException('Photo stopped.', 'AbortError');
  }
  async pause(ms = 0, cancel = true) {
    this.check(cancel);
    const end = performance.now() + ms;
    do { await new Promise(r => setTimeout(r, Math.min(25, Math.max(0, end - performance.now())))); this.check(cancel); }
    while (performance.now() < end && !this.stopping);
  }
  disposeTrace() {
    this.cancelPreparation?.();
    this.ready = false; this.hasStill = false; this.gValid = false;
    for (const r of this.resources) r.dispose(); this.resources.clear(); this.traceScene = null;
    // The installed tracer drops intermediate geometries without disposing them when meshes change.
    const g = this.tracer?._generator;
    if (g) { for (const r of g.staticGeometryGenerator._intermediateGeometry.values()) r.dispose(); g.staticGeometryGenerator._intermediateGeometry.clear(); g.geometry.dispose(); g.bvh = null; }
  }
  dispose() {
    this.stop(); this.active = false; this.disposeTrace();
    const t = this.tracer;
    if (t) {
      const owned = new Set();
      for (const p of [t._pathTracer, t._lowResPathTracer]) {
        const m = p.material;
        for (const k of ['bvh', 'attributesArray', 'materialIndexAttribute', 'materials', 'textures', 'lights', 'iesProfiles', 'envMapInfo', 'stratifiedTexture', 'stratifiedOffsetTexture']) {
          const v = m[k], r = v?.renderTarget ?? v;
          if (r?.dispose) owned.add(r);
          if (r?.fsQuad?.material) owned.add(r.fsQuad.material);
          if (v?.tex?.dispose) owned.add(v.tex);
        }
        owned.add(m); if (p._blendQuad?.material) owned.add(p._blendQuad.material);
      }
      t.dispose(); t._lowResPathTracer.dispose(); t._internalBackground?.dispose(); t._colorBackground?.dispose();
      for (const r of owned) r.dispose(); this.tracer = null;
    }
    for (const k of ['meterTarget', 'gAlbedo', 'gNormal', 'bloomTarget']) { this[k]?.dispose(); this[k] = null; }
    this.atrous?.forEach(t => t.dispose()); this.atrous = null;
    for (const k of ['meterQuad', 'demodQuad', 'atrousQuad', 'brightQuad', 'quad']) { this[k]?.material.dispose(); this[k]?.dispose(); this[k] = null; }
  }

  resize() { if (this.active && this.ready && this.hasStill && !this.renderer.getContext().isContextLost()) this.present(); }

  // A mood from words ("雨过天晴 早晨太阳刚升起 室内灯光柔和") or an object of controls; null returns to the live sky.
  setMood(m) {
    if (m == null) { this.mood = null; return { mood: null, matched: [] }; }
    const r = typeof m === 'string' ? parseMood(m) : { mood: { ...DEFAULT_MOOD, ...m, sun: { ...DEFAULT_MOOD.sun, ...(m.sun ?? {}) } }, matched: [] };
    this.mood = r.mood; return r;
  }

  // A static copy of physical surfaces: geometry is owned here, instances are flattened, poses are frozen.
  async buildScene() {
    const t0 = performance.now(), out = new THREE.Scene(), cache = new Map(), stats = { meshes: 0, instanced: 0, lights: 0 }, mood = this.mood;
    const wetCache = new Map(), geometryCache = new Map(), colorCache = new Map(), grounds = [], blockers = [];
    const own = r => this.own(r), pause = () => this.pause();
    const geometry = g => { if (!geometryCache.has(g)) geometryCache.set(g, rgba(own(g.clone()))); return geometryCache.get(g); };
    this.traceScene = out;
    this.scene.updateMatrixWorld(true);
    const overlay = new THREE.Layers(); overlay.set(OVERLAY_LAYER);
    const objects = []; this.scene.traverse(o => objects.push(o));
    let yielded = performance.now();
    for (const o of objects) {
      if (performance.now() - yielded > 12) { await pause(); yielded = performance.now(); }
      if (presentation(o)) continue;
      if (o.isLight) {
        let fixture = false; for (let p = o.parent; p; p = p.parent) if (p === this.lighting.fixtures) fixture = true;
        if (!fixture && !visible(o)) continue;
        let intensity = o.intensity, color = o.color;
        const base = o.userData.base ?? o.userData.switchBase;
        if ((fixture || o.userData.lightSwitch) && base !== undefined) {
          // Base is the real fixture's unit output. day=2.5 and dusk=5 are raster fill/adaptation boosts,
          // notably on the two garage-shopLight RectAreaLights (base 120); neither belongs in the tracer.
          const dusk = mood ? mood.sun.el < 2 : this.lighting.lightSwitches?.dusk ?? o.userData.lightSwitch?.dusk ?? false;
          const outside = o.userData.exterior, lamps = mood?.lamps ?? 1;
          const level = outside ? (dusk ? lamps : 0) : mood ? lamps : dusk || o.userData.always ? 1 : Math.min(1, o.userData.day ?? 0.2);
          const toggle = o.userData.lightSwitch, switched = mood && !toggle?.manual ? 1 : (toggle?.value ?? 1);
          intensity = base * level * switched;
          if (mood) color = kelvin(mood.lampK).multiply(o.color.clone().multiplyScalar(1 / Math.max(o.color.r, o.color.g, o.color.b, 1e-3))).lerp(kelvin(mood.lampK), 0.6);
        }
        if (o.isHemisphereLight || o.isAmbientLight || !(intensity > 0)) continue;
        const fire = o.parent?.userData.id === 'outdoor-fire-pit';
        if (!fixture && !o.userData.lightSwitch && !fire) continue; // identified physical sources; sky/sun are rebuilt below
        if (o === this.lighting.sun) continue;
        if (this.lighting.windowLights.includes(o)) continue;   // real-time fill standing in for daylight through glass
        // rebuilt rather than cloned: clone() would deep-copy userData, which links back into the scene
        const l = new o.constructor();
        for (const k of ['distance', 'decay', 'angle', 'penumbra', 'width', 'height']) if (k in o) l[k] = o[k];
        l.intensity = intensity; l.color.copy(color); l.name = o.name || o.userData.lightSwitch?.labelOn?.en || 'Practical light';
        l.matrixAutoUpdate = false; l.matrix.copy(o.matrixWorld); l.matrixWorld.copy(o.matrixWorld);
        if (o.target) { l.target.position.setFromMatrixPosition(o.target.matrixWorld); out.add(l.target); }
        out.add(l); stats.lights++;
        continue;
      }
      if (!visible(o) || !o.isMesh || o.isReflector || o.isSprite) continue;
      if (o.layers.test(overlay) && !o.layers.isEnabled(0)) continue;
      const materials = [].concat(o.material).map(m => traceMaterial(m, cache, own));
      if (!materials.some(Boolean)) continue;
      let mesh;
      if (o.isInstancedMesh) {
        if (!o.count) continue;
        mesh = new THREE.Mesh(await expandInstanced(o, own, pause), materials[0]);
        if (!materials[0]) continue;
        if (mesh.geometry.attributes.color) {
          if (!colorCache.has(materials[0])) { const m = own(materials[0].clone()); m.vertexColors = true; colorCache.set(materials[0], m); }
          mesh.material = colorCache.get(materials[0]);
        }
        stats.instanced++;
      } else if (o.isSkinnedMesh) {
        mesh = new THREE.Mesh(await bakeSkinned(o, own, pause), materials[0]);
      } else if (Array.isArray(o.material) && o.geometry.groups.length) {
        for (const part of splitGroups(geometry(o.geometry), own)) {
          if (!materials[part.materialIndex]) continue;
          const m = new THREE.Mesh(part.geometry, materials[part.materialIndex]);
          m.matrixAutoUpdate = false; m.matrix.copy(o.matrixWorld); out.add(lmTag(o, m));
        }
        stats.meshes++;
        continue;
      } else {
        mesh = new THREE.Mesh(geometry(o.geometry), materials[0]);
        mesh.matrixAutoUpdate = false; mesh.matrix.copy(o.matrixWorld);
      }
      if (!mesh.material) continue;
      if (mood?.wet > 0 || mood?.puddles > 0) {
        mesh.updateMatrixWorld(true);
        const cls = meshLighting(o).weather;
        if (cls) mesh.material = wetMaterial(mesh.material, cls, mood.wet, wetCache, own);
        if (cls === 'ground') grounds.push(mesh); else if (cls) blockers.push(mesh);
      }
      if (mood && mesh.material.userData.lightGlow && mesh.material.emissive) {
        let toggle; for (let p = o; p && !toggle; p = p.parent) toggle = p.userData.lightSwitch;
        const source = toggle?.glows?.find(g => g.material === o.material);
        const level = mood.lamps * (toggle?.manual ? toggle.value : 1);
        const key = mesh.material.uuid + 'lamp'; if (!wetCache.has(key)) { const m = own(mesh.material.clone()); m.emissiveIntensity = (source?.base ?? 2.5) * level; m.emissive.copy(kelvin(mood.lampK)); wetCache.set(key, m); }
        mesh.material = wetCache.get(key);
      }
      out.add(lmTag(o, mesh)); stats.meshes++;
    }
    await pause();
    if (mood?.puddles > 0 && grounds.length) {
      const t = performance.now(), p = await makePuddles(grounds, blockers, mood.puddles, own, pause);
      if (p) { out.add(p); stats.puddleTris = p.geometry.attributes.position.count / 3; }
      stats.puddleMs = Math.round(performance.now() - t);
    }
    await pause();
    const sky = this.scene.background;
    if (mood) {
      const s = makeSky(this.renderer, mood); own(s.background); own(s.env);
      out.background = s.background; out.environment = s.env; out.backgroundIntensity = 1; out.environmentIntensity = 1;
      if (s.sun && mood.sun.el > -1) {
        const light = new THREE.DirectionalLight(s.sun.color, s.sun.intensity);
        light.position.copy(s.sun.dir).multiplyScalar(60); light.name = 'sun'; out.add(light, light.target); stats.sun = +s.sun.intensity.toFixed(2);
      }
      if (mood.mist > 0) {
        // morning mist: a thin scattering volume over the lot; low sun through it draws the shafts
        const fog = new THREE.Mesh(own(new THREE.BoxGeometry(70, 24, 70)), own(Object.assign(new FogVolumeMaterial(), { density: 0.012 * mood.mist })));
        fog.position.set(0, 11.6, -3); fog.updateMatrixWorld(true); out.add(fog); stats.mist = 0.012 * mood.mist;
      }
    } else if (sky?.isTexture && sky.image?.data) {
      const { env, sun } = await splitSun(sky, own, pause);
      out.background = sky; out.environment = env;
      out.backgroundRotation.copy(this.scene.backgroundRotation); out.environmentRotation.copy(this.scene.backgroundRotation);
      out.backgroundIntensity = 1; out.environmentIntensity = 1;
      if (sun) {
        const light = new THREE.DirectionalLight(sun.color, sun.intensity);
        light.position.copy(sun.dir).applyEuler(this.scene.environmentRotation).multiplyScalar(60);
        light.name = 'sun from the sky'; out.add(light, light.target); stats.sun = +sun.intensity.toFixed(2);
      }
    }
    out.updateMatrixWorld(true);
    stats.ms = Math.round(performance.now() - t0);
    this.buildStats = stats;
    return out;
  }

  // The photo camera: where the visitor stands and looks, through a real lens. camera settings (this.camera_):
  //   focal: focal length in mm on a full-frame body (36 x 24 mm; the frame's long side is 36 mm). null keeps the
  //          walkthrough's field of view.
  //   height: lens height above the ground in metres (a tripod); null keeps the eye height.
  //   level: true keeps the camera level (no tilt), so verticals stay vertical, as architectural photographers do.
  syncCamera() {
    const c = this.cam, s = this.camera, k = this.camera_ ?? {};
    c.near = s.near; c.far = s.far; c.filmGauge = 36;
    c.aspect = this.size ? this.size[0] / this.size[1] : s.aspect;
    c.position.copy(s.getWorldPosition(new THREE.Vector3())); c.quaternion.copy(s.getWorldQuaternion(new THREE.Quaternion()));
    if (k.height != null) c.position.y = k.height;
    if (k.level) { const e = new THREE.Euler().setFromQuaternion(c.quaternion, 'YXZ'); e.x = 0; e.z = 0; c.quaternion.setFromEuler(e); }
    if (k.focal) c.setFocalLength(k.focal);   // three: the film's long side is filmGauge, so this is full-frame
    else {
      c.fov = s.fov;
      // a wider frame than the screen keeps the screen's vertical field; a taller one keeps its horizontal field
      if (c.aspect < s.aspect) c.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(s.fov) / 2) * s.aspect / c.aspect));
    }
    c.updateProjectionMatrix(); c.updateMatrixWorld();
  }

  // Lens settings as a camera body would report them.
  cameraInfo() {
    const c = this.cam;
    return { focal: +c.getFocalLength().toFixed(1), fStop: c.fStop >= 1e5 ? Infinity : c.fStop, focus: +c.focusDistance.toFixed(2), height: +c.position.y.toFixed(2), hfov: +(2 * THREE.MathUtils.radToDeg(Math.atan(18 / c.getFocalLength() * Math.min(1, c.aspect) ))).toFixed(1) };
  }

  // Output size in pixels; null follows the canvas (at 3/4 of its drawing buffer, enough for a preview).
  outputSize() {
    const v = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    return photoSize(this.size ?? [Math.round(v.x * 0.75), Math.round(v.y * 0.75)], this.renderer.capabilities, this.getTier(), globalThis.navigator?.deviceMemory);
  }

  preparing(stage, progress = null) {
    this.prepareStage = stage;
    this.onPrepare?.({ stage, progress, elapsedMs: performance.now() - this.prepareStarted });
  }

  // Copies are made in bounded chunks: transferred buffers must never detach the photo's raster guides or
  // the walkthrough's geometry. Yield by elapsed time, rather than once per tiny attribute/mesh.
  async copyArray(array) {
    const out = new array.constructor(array.length); let yielded = performance.now();
    for (let i = 0; i < array.length; i += 262144) {
      out.set(array.subarray(i, i + 262144), i);
      if (performance.now() - yielded > 12) { await this.pause(); yielded = performance.now(); }
    }
    return out;
  }

  // WorkerBase.dispose() terminates the worker but does not settle its pending promise. Race it with an
  // explicit rejection so Stop both terminates CPU work immediately and releases the UI's render lock.
  async awaitWorker(wrapper, start) {
    let rejectCancel;
    const cancelled = new Promise((resolve, reject) => { rejectCancel = reject; });
    const abort = () => { if (wrapper.worker) wrapper.dispose(); rejectCancel(new DOMException('Photo stopped.', 'AbortError')); };
    this.cancelPreparation = abort;
    try { this.check(); return await Promise.race([start(), cancelled]); }
    finally { if (this.cancelPreparation === abort) this.cancelPreparation = null; if (wrapper.worker) wrapper.dispose(); }
  }

  async mergeScene() {
    const meshes = []; this.traceScene.traverseVisible(o => { if (o.isMesh) meshes.push(o); });
    meshes.sort((a, b) => a.uuid > b.uuid ? 1 : a.uuid < b.uuid ? -1 : 0);
    const packed = [], geometries = new Map(), transfer = [], t0 = performance.now(); let yielded = t0;
    for (const mesh of meshes) {
      const g = mesh.geometry;
      if (geometries.has(g)) continue;
      const attributes = {};
      for (const key of this.tracer._generator.attributes) {
        const a = g.getAttribute(key); if (!a) continue;
        let array;
        if (a.isInterleavedBufferAttribute) {
          array = new Float32Array(a.count * a.itemSize);
          for (let i = 0; i < a.count; i++) {
            for (let c = 0; c < a.itemSize; c++) array[i * a.itemSize + c] = a.getComponent(i, c);
            if ((i + 1) % 8192 === 0) await this.pause();
          }
        } else array = await this.copyArray(a.array);
        attributes[key] = { array, itemSize: a.itemSize, normalized: !a.isInterleavedBufferAttribute && a.normalized };
        transfer.push(array.buffer);
      }
      const index = g.index ? await this.copyArray(g.index.array) : null;
      if (index) transfer.push(index.buffer);
      geometries.set(g, packed.length); packed.push({ uuid: g.uuid, attributes, index, groups: g.groups });
      if (performance.now() - yielded > 12) { await this.pause(); yielded = performance.now(); }
    }
    const data = { geometries: packed, meshes: meshes.map(m => ({ uuid: m.uuid, geometry: geometries.get(m.geometry), material: m.material.uuid, matrix: m.matrixWorld.toArray() })) };
    this.preparationStats.packMs = Math.round(performance.now() - t0);
    const wrapper = { worker: new Worker(new URL('./photo-merge-worker.js', import.meta.url), { type: 'module' }), dispose() { this.worker.terminate(); this.worker = null; } };
    const merged = await this.awaitWorker(wrapper, () => new Promise((resolve, reject) => {
      const w = wrapper.worker;
      w.onerror = e => { e.preventDefault(); reject(new Error(e.message || 'Photo geometry worker unavailable.')); };
      w.onmessageerror = () => reject(new Error('Photo geometry worker message failed.'));
      w.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data);
      w.postMessage(data, transfer);
    }));
    this.check();
    const geometry = new THREE.BufferGeometry();
    for (const [key, a] of Object.entries(merged.attributes)) geometry.setAttribute(key, new THREE.BufferAttribute(a.array, a.itemSize, a.normalized));
    if (merged.index) geometry.setIndex(new THREE.BufferAttribute(merged.index, 1));
    geometry.groups = merged.groups;
    const g = this.tracer._generator; g.geometry.dispose(); g.geometry = geometry;
    return { geometry, materials: meshes.map(m => m.material), needsMaterialIndexUpdate: true, bvhChanged: true };
  }

  async buildBVH(geometry, options) {
    // GenerateMeshBVHWorker transfers position/index and cannot restore them after a load error. Work on
    // disposable copies so a failed worker can still fall back to the synchronous builder safely.
    const copy = new THREE.BufferGeometry();
    copy.setAttribute('position', new THREE.BufferAttribute(await this.copyArray(geometry.attributes.position.array), 3));
    if (geometry.index) copy.setIndex(new THREE.BufferAttribute(await this.copyArray(geometry.index.array), 1));
    copy.groups = geometry.groups.map(g => ({ ...g }));
    const wrapper = new GenerateMeshBVHWorker();
    try {
      // 0.9.4's generate() creates an unhandled rejected promise via promise.finally(). runTask is the same
      // public worker implementation, without that detached promise; awaitWorker owns its one-task lifetime.
      const bvh = await this.awaitWorker(wrapper, () => wrapper.runTask(wrapper.worker, copy, options));
      this.check();
      geometry.setAttribute('position', copy.attributes.position); geometry.setIndex(copy.index);
      bvh.geometry = geometry; geometry.boundingBox = copy.boundingBox;
      return bvh;
    } finally { copy.dispose(); }
  }

  // Geometry conversion/merge and SAH construction run in separate workers; only GPU upload stays here.
  async prepareScene() {
    const g = this.tracer._generator; g.setObjects(this.traceScene);
    this.preparing('merge'); const t0 = performance.now();
    let result;
    if (typeof Worker !== 'undefined') {
      try { result = await this.mergeScene(); this.preparationStats.mergeWorker = true; }
      catch (err) { this.check(); this.preparationStats.mergeWorkerError = String(err.message); console.warn('Photo geometry worker failed; using synchronous fallback.', err); }
    }
    if (!result) {
      await this.pause(); g.generateBVH = false;
      // 0.0.24 references an undefined `length` on an unchanged repeat merge; rebuilding the material table
      // also makes a fallback safe after a previous worker-generated scene.
      g._materialUuids = null;
      try { result = g.generate(); } finally { g.generateBVH = true; }
    }
    this.preparationStats.mergeMs = Math.round(performance.now() - t0);
    await this.pause();
    this.preparing('bvh'); const t1 = performance.now();
    result.bvh = null;
    const options = { strategy: SAH, maxLeafTris: 1, indirect: true, ...g.bvhOptions,
      onProgress: progress => this.preparing('bvh', progress) };
    if (typeof Worker !== 'undefined') {
      try { result.bvh = await this.buildBVH(result.geometry, options); this.preparationStats.bvhWorker = true; }
      catch (err) { this.check(); this.preparationStats.bvhWorkerError = String(err.message); console.warn('Photo BVH worker failed; using synchronous fallback.', err); }
    }
    if (!result.bvh) { await this.pause(); result.bvh = new MeshBVH(result.geometry, options); }
    g.bvh = result.bvh;
    result.bvhChanged = true;
    this.preparationStats.bvhMs = Math.round(performance.now() - t1);
    await this.pause();
    this.preparing('upload'); const t2 = performance.now();
    this.tracer._updateFromResults(this.traceScene, this.cam, result);
    this.preparationStats.uploadMs = Math.round(performance.now() - t2);
  }

  async prepare() {
    const t0 = performance.now();
    this.prepareStarted = t0; this.prepareMs = null;
    this.preparationStats = { mergeWorker: false, bvhWorker: false };
    try {
      const error = this.supportError(); if (error) throw new Error(error);
      this.disposeTrace();
      await this.pause();
      this.preparing('snapshot');
      this.traceScene = await this.buildScene();
      this.preparationStats.snapshotMs = Math.round(performance.now() - t0);
      await this.pause();
      if (!this.tracer) {
        this.tracer = new WebGLPathTracer(this.renderer);
        Object.assign(this.tracer, { renderToCanvas: false, rasterizeScene: false, synchronizeRenderSize: false, renderDelay: 0, minSamples: 1, fadeDuration: 0, bounces: 4, transmissiveBounces: 24, filterGlossyFactor: 0.5 });
        this.tracer.tiles.set(2, 2);
        // Firefly clamp, like Cycles' "clamp indirect": no single sample may be brighter than uClamp. Rare paths that
        // find a lamp or a sunlit patch by luck would otherwise take thousands of samples to average out.
        const m = this.tracer._pathTracer.material;
        m.uniforms.uClamp = { value: 1e9 };
        m.fragmentShader = 'uniform float uClamp;\n' + m.fragmentShader.replace('gl_FragColor.a *= opacity;',
          'gl_FragColor.a *= opacity;\n{ float peak = max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b)); if (!(all(greaterThanEqual(gl_FragColor.rgb, vec3(0.0))) && all(lessThan(gl_FragColor.rgb, vec3(1e30))))) gl_FragColor.rgb = vec3(0.0); else if (peak > uClamp) gl_FragColor.rgb *= uClamp / peak; }');
        m.needsUpdate = true;
      }
      const [w, h] = this.outputSize();
      this.tracer._pathTracer.setSize(w, h); this.tracer._lowResPathTracer.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
      this.syncCamera();
      this.tracer._pathTracer.material.uniforms.uClamp.value = 1e9;
      await this.pause();
      await this.prepareScene();
      await this.pause();
      this.gValid = false;
      // the tracing program compiles in parallel; samples taken before it is linked are skipped
      this.preparing('compile');
      this.tracer.renderSample();
      const deadline = performance.now() + 60000;
      while (this.tracer.isCompiling) { if (performance.now() > deadline) throw new Error('Photo shader compilation timed out.'); await this.pause(50); }
      this.ready = true;
      this.prepareMs = Math.round(performance.now() - t0);
      this.preparing('ready');
    } catch (err) { this.dispose(); throw err; }
  }

  sample() { this.tracer.renderSample(); return this.tracer.samples; }

  // Focus where the centre of the frame lands, like a camera's centre AF point.
  focus() {
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(0, 0), this.cam);
    const hits = ray.intersectObjects(this.traceScene.children.filter(o => o.isMesh && !o.material.isFogVolumeMaterial && o.material.transmission !== 1), false);
    return hits[0]?.distance ?? 8;
  }

  // Lens settings: f-stop (Infinity for a pinhole) and focus distance (null focuses on the frame centre).
  setLens({ fStop = 8, focus = null, blades = 6 } = {}) {
    const c = this.cam;
    c.fStop = Number.isFinite(fStop) ? fStop : 1e6;
    c.apertureBlades = blades; c.apertureRotation = 0.3;
    c.focusDistance = focus ?? this.focus();
    this.tracer?.updateCamera();
  }

  // Average scene brightness (log-average luminance of the accumulated image), measured on a small copy.
  meter() {
    const r = this.renderer, T = this.tracer.target.texture;
    this.meterTarget ??= new THREE.WebGLRenderTarget(64, 36, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    this.meterQuad ??= new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tMap: { value: null } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D tMap; varying vec2 vUv; void main() { vec3 c = vec3(0.0); for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) c += texture2D(tMap, vUv + (vec2(i, j) - 1.5) / vec2(256.0, 144.0)).rgb; gl_FragColor = vec4(c / 16.0, 1.0); }',
      depthTest: false, depthWrite: false,
    }));
    this.meterQuad.material.uniforms.tMap.value = T;
    r.setRenderTarget(this.meterTarget); this.meterQuad.render(r); r.setRenderTarget(null);
    const px = new Float32Array(64 * 36 * 4); r.readRenderTargetPixels(this.meterTarget, 0, 0, 64, 36, px);
    let sum = 0, n = 0;
    for (let i = 0; i < px.length; i += 4) { const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; if (Number.isFinite(l)) { sum += Math.log(1e-4 + l); n++; } }
    return Math.exp(sum / Math.max(1, n));
  }

  // Exposure from the meter, like a camera's matrix metering, plus a compensation in stops.
  autoExpose(ev = 0) {
    const avg = this.meter();
    const mood = this.mood ?? (this.lighting.lightSwitches?.dusk ? { sun: { el: -3 } } : null);
    const policy = photoExposurePolicy(mood);
    this.exposure = THREE.MathUtils.clamp(policy.key / avg, 0.05, policy.maxGain) * Math.pow(2, ev + policy.bias);
    this.meterStats = { average: avg, ...policy, ev, exposure: this.exposure };
    return this.exposure;
  }

  // Guide buffers for the denoiser, drawn by the rasteriser at the tracer's resolution from the same camera:
  // albedo (base colour x texture x vertex colour) and view-space normal with linear depth. Glass is left out, so
  // pixels seen through a window are guided by what lies behind it, as the traced colour is.
  gbuffers(w, h) {
    const r = this.renderer;
    if (!this.gAlbedo || this.gAlbedo.width !== w || this.gAlbedo.height !== h) {
      this.gAlbedo?.dispose(); this.gNormal?.dispose();
      this.gAlbedo = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      this.gNormal = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    }
    const mode = { value: 0 }, cache = new Map(), restore = [];
    const gmat = m => {
      if (cache.has(m)) return cache.get(m);
      if (m.map) { m.map.updateMatrix(); }
      const g = new THREE.ShaderMaterial({
        uniforms: { uMap: { value: m.map ?? null }, uUvT: { value: m.map ? m.map.matrix : new THREE.Matrix3() }, uColor: { value: m.color ? m.color.clone() : new THREE.Color(1, 1, 1) },
          uAlphaTest: { value: m.alphaTest > 0 ? m.alphaTest : (m.transparent && m.opacity < 0.5 ? 0.5 : 0) }, uMode: mode },
        defines: { HAS_MAP: m.map ? 1 : 0 }, vertexColors: !!m.vertexColors, side: m.side,
        vertexShader: `uniform mat3 uUvT; varying vec2 vUv; varying vec3 vN; varying float vZ; varying vec4 vC;
          void main() {
            vUv = (uUvT * vec3(uv, 1.0)).xy;
            #if defined( USE_COLOR_ALPHA )
            vC = color;
            #elif defined( USE_COLOR )
            vC = vec4(color, 1.0);
            #else
            vC = vec4(1.0);
            #endif
            vec4 mv = modelViewMatrix * vec4(position, 1.0); vZ = -mv.z; vN = normalMatrix * normal;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `uniform sampler2D uMap; uniform vec3 uColor; uniform float uAlphaTest; uniform int uMode;
          varying vec2 vUv; varying vec3 vN; varying float vZ; varying vec4 vC;
          void main() {
            vec4 a = vec4(uColor, 1.0) * vC;
            #if HAS_MAP
            a *= texture2D(uMap, vUv);
            #endif
            if (a.a < uAlphaTest) discard;
            if (uMode == 0) gl_FragColor = vec4(a.rgb, 1.0);
            else gl_FragColor = vec4(normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0), vZ);
          }`,
      });
      g.toneMapped = false;
      cache.set(m, g); return g;
    };
    const bg = this.traceScene.background, prev = r.getRenderTarget();
    const clear = r.getClearColor(new THREE.Color()), clearAlpha = r.getClearAlpha();
    try {
      this.traceScene.traverse(o => {
        if (!o.isMesh) return;
        restore.push([o, o.material, o.visible]);
        if (o.material.transmission >= 0.5) o.visible = false; else o.material = gmat(o.material);
      });
      this.traceScene.background = null;
      r.setClearColor(0x000000, 0);
      mode.value = 0; r.setRenderTarget(this.gAlbedo); r.clear(); r.render(this.traceScene, this.cam);
      mode.value = 1; r.setRenderTarget(this.gNormal); r.clear(); r.render(this.traceScene, this.cam);
    } finally {
      r.setRenderTarget(prev); r.setClearColor(clear, clearAlpha); this.traceScene.background = bg;
      for (const [o, m, v] of restore) { o.material = m; o.visible = v; }
      for (const g of cache.values()) g.dispose();
    }
  }

  // Denoiser guided by albedo, normals and depth (an edge-avoiding a-trous wavelet filter, as in SVGF). The lighting
  // is divided by albedo first, so only light is smoothed and every texture comes back sharp; the filter stops at
  // changes of surface, depth or brightness. Pixels showing the sky pass through untouched.
  guidedDenoise(T, w, h, L) {
    const r = this.renderer, vs = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    if (!this.gValid || this.gAlbedo?.width !== w || this.gAlbedo?.height !== h) { this.gbuffers(w, h); this.gValid = true; }
    if (!this.atrous || this.atrous[0].width !== w || this.atrous[0].height !== h) {
      this.atrous?.forEach(t => t.dispose());
      this.atrous = [0, 1, 2].map(() => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false }));
    }
    const [A, B, C] = this.atrous;
    this.demodQuad ??= new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tMap: { value: null }, tAlb: { value: null }, uRemod: { value: 0 }, tOrig: { value: null }, tND: { value: null } }, vertexShader: vs, depthTest: false, depthWrite: false,
      fragmentShader: `uniform sampler2D tMap; uniform sampler2D tAlb; uniform sampler2D tOrig; uniform sampler2D tND; uniform float uRemod; varying vec2 vUv;
        ${FINITE}
        void main() {
          vec3 alb = max(texture2D(tAlb, vUv).rgb, vec3(0.03)); vec3 c = finite(texture2D(tMap, vUv).rgb);
          if (uRemod > 0.5) gl_FragColor = vec4(c * alb, 1.0);
          else gl_FragColor = vec4(min(c / alb, vec3(6e4)), 1.0);   // the filter targets are half float
        }`,
    }));
    this.atrousQuad ??= new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tMap: { value: null }, tND: { value: null }, uTexel: { value: new THREE.Vector2() }, uStep: { value: 1 }, uExposure: { value: 1 }, uSigmaL: { value: 0.2 } },
      vertexShader: vs, depthTest: false, depthWrite: false,
      fragmentShader: `uniform sampler2D tMap; uniform sampler2D tND; uniform vec2 uTexel; uniform float uStep; uniform float uExposure; uniform float uSigmaL; varying vec2 vUv;
        float squash(vec3 c) { float l = dot(c, vec3(0.2126, 0.7152, 0.0722)) * uExposure; return l / (1.0 + l); }
        void main() {
          vec4 nd = texture2D(tND, vUv); vec3 c0 = texture2D(tMap, vUv).rgb;
          bool sky = nd.a <= 0.0;   // sky pixels (noisy only through mist) are smoothed among themselves
          float l0 = squash(c0); vec3 acc = vec3(0.0); float wsum = 0.0;
          float k[3]; k[0] = 0.375; k[1] = 0.25; k[2] = 0.0625;
          for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
            vec2 uv = vUv + vec2(float(i), float(j)) * uStep * uTexel;
            vec4 nd1 = texture2D(tND, uv); if ((nd1.a <= 0.0) != sky) continue;
            vec3 c1 = texture2D(tMap, uv).rgb;
            float wN = sky ? 1.0 : pow(max(dot(nd.xyz, nd1.xyz), 0.0), 64.0);
            float wZ = sky ? 1.0 : exp(-abs(nd.a - nd1.a) / (0.015 * nd.a * uStep + 0.002));
            float dl = squash(c1) - l0; float wL = exp(-dl * dl / (2.0 * uSigmaL * uSigmaL));
            float wgt = k[abs(i)] * k[abs(j)] * wN * wZ * wL;
            acc += c1 * wgt; wsum += wgt;
          }
          gl_FragColor = vec4(wsum > 0.0 ? acc / wsum : c0, 1.0);
        }`,
    }));
    const d = this.demodQuad.material.uniforms;
    d.tMap.value = T; d.tAlb.value = this.gAlbedo.texture; d.uRemod.value = 0;
    r.setRenderTarget(A); this.demodQuad.render(r);
    const a = this.atrousQuad.material.uniforms;
    a.tND.value = this.gNormal.texture; a.uTexel.value.set(1 / w, 1 / h); a.uExposure.value = this.exposure ?? 1; a.uSigmaL.value = L.edge ?? 0.2;
    let src = A, dst = B;
    for (let i = 0; i < (L.passes ?? 5); i++) {
      a.tMap.value = src.texture; a.uStep.value = 1 << i;
      r.setRenderTarget(dst); this.atrousQuad.render(r); [src, dst] = [dst, src];
    }
    d.tMap.value = src.texture; d.uRemod.value = 1; d.tOrig.value = T; d.tND.value = this.gNormal.texture;
    r.setRenderTarget(C); this.demodQuad.render(r); r.setRenderTarget(null);
    return C.texture;
  }

  // Develop the accumulated linear image: guided denoise, bloom, chromatic aberration, vignette, exposure, AgX (the
  // same tone curve as Blender's), a contrast look, film grain. Draws into `target` at its size, or onto the canvas
  // letterboxed to the output's shape. Tone mapping and sRGB encoding happen in this shader, so a saved file matches
  // the screen exactly.
  present(lens = this.lens, target = null) {
    const r = this.renderer, L = { bloom: 0.06, ca: 0.0018, vignette: 0.35, grain: 0.02, guided: true, contrast: 1.12, saturation: 1.08, ...lens };
    const clear = r.getClearColor(new THREE.Color()), alpha = r.getClearAlpha(), prev = r.getRenderTarget(), vp = r.getViewport(new THREE.Vector4());
    try {
      let T = this.tracer.target.texture;
      const w = T.image.width, h = T.image.height;
      if (L.guided) T = this.guidedDenoise(T, w, h, L);
      if (!this.bloomTarget || this.bloomTarget.width !== (w >> 1) || this.bloomTarget.height !== (h >> 1)) {
        this.bloomTarget?.dispose();
        this.bloomTarget = new THREE.WebGLRenderTarget(w >> 1, h >> 1, { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
      }
      const vs = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
      // bright pass: only light well above white contributes to the glow
      this.brightQuad ??= new FullScreenQuad(new THREE.ShaderMaterial({
        uniforms: { tMap: { value: null }, uExposure: { value: 1 } }, vertexShader: vs, depthTest: false, depthWrite: false,
        fragmentShader: 'uniform sampler2D tMap; uniform float uExposure; varying vec2 vUv; ' + FINITE + ' void main() { vec3 c = finite(texture2D(tMap, vUv).rgb) * uExposure; float l = max(c.r, max(c.g, c.b)); gl_FragColor = vec4(c * smoothstep(1.0, 4.0, l), 1.0); }',
      }));
      this.brightQuad.material.uniforms.tMap.value = T; this.brightQuad.material.uniforms.uExposure.value = this.exposure ?? 1;
      r.setRenderTarget(this.bloomTarget); this.brightQuad.render(r);
      this.quad ??= new FullScreenQuad(new THREE.ShaderMaterial({
        uniforms: { tMap: { value: null }, tBloom: { value: null }, uBloom: { value: 0 }, uCA: { value: 0 }, uVignette: { value: 0 }, uGrain: { value: 0 }, uAspect: { value: 1 },
          uExposure: { value: 1 }, uContrast: { value: 1 }, uSaturation: { value: 1 } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: `uniform sampler2D tMap; uniform sampler2D tBloom; uniform float uBloom; uniform float uCA; uniform float uVignette; uniform float uGrain;
          uniform float uAspect; uniform float uExposure; uniform float uContrast; uniform float uSaturation;
          varying vec2 vUv;
          float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
          ${FINITE}
          // AgX (Troy Sobotka; three's implementation, without its exposure uniform)
          vec3 agxContrast(vec3 x) { vec3 x2 = x * x, x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
          vec3 agx(vec3 c) {
            const mat3 toRec2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
            const mat3 fromRec2020 = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
            const mat3 inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
            const mat3 outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
            c = inset * (toRec2020 * c);
            c = clamp((log2(max(c, 1e-10)) + 12.47393) / (4.026069 + 12.47393), 0.0, 1.0);
            c = outset * agxContrast(c);
            return clamp(fromRec2020 * pow(max(vec3(0.0), c), vec3(2.2)), 0.0, 1.0);
          }
          vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
          void main() {
            vec2 d = vUv - 0.5, o = d * uCA * 2.0;
            vec3 c = finite(vec3(texture2D(tMap, vUv - o).r, texture2D(tMap, vUv).g, texture2D(tMap, vUv + o).b));
            vec3 b = vec3(0.0); float wsum = 0.0;
            for (int i = 1; i <= 6; i++) { float w = 1.0 / float(i); b += textureLod(tBloom, vUv, float(i)).rgb * w; wsum += w; }
            c += uBloom * b / wsum / uExposure;
            float r = length(d * vec2(uAspect, 1.0)) / length(vec2(uAspect, 1.0) * 0.5);
            c *= 1.0 - uVignette * smoothstep(0.35, 1.05, r);
            vec3 g = srgb(agx(c * uExposure));
            g = clamp(mix(vec3(0.5), g, uContrast), 0.0, 1.0);
            float y = dot(g, vec3(0.2126, 0.7152, 0.0722)); g = mix(vec3(y), g, uSaturation);
            gl_FragColor = vec4(g + (hash(gl_FragCoord.xy) + hash(gl_FragCoord.yx + 7.1) - 1.0) * uGrain, 1.0);
          }`,
        depthTest: false, depthWrite: false,
      }));
      this.quad.material.toneMapped = false;
      const u = this.quad.material.uniforms;
      u.tMap.value = T; u.tBloom.value = this.bloomTarget.texture; u.uBloom.value = L.bloom * 8; u.uCA.value = L.ca; u.uVignette.value = L.vignette; u.uGrain.value = L.grain;
      u.uAspect.value = w / h; u.uExposure.value = this.exposure ?? 1; u.uContrast.value = L.contrast; u.uSaturation.value = L.saturation;
      if (target) { r.setRenderTarget(target); this.quad.render(r); r.setRenderTarget(null); return; }
      // letterbox onto the canvas, in the area left of the photo panel (viewInset, CSS pixels)
      const css = r.getSize(new THREE.Vector2()), aw = Math.max(1, css.x - (this.viewInset ?? 0)), screen = aw / css.y, image = w / h;
      // the letterbox is a viewport: the full-screen quad is one oversized triangle, so scaling it would smear edge texels
      const vw = image > screen ? aw : css.y * image, vh = image > screen ? aw / image : css.y;
      r.setRenderTarget(null); r.setClearColor(0x0d0c0b, 1); r.setViewport(0, 0, css.x, css.y); r.clear();
      r.setViewport((aw - vw) / 2, (css.y - vh) / 2, vw, vh); this.quad.render(r);
      this.hasStill = true;
    } finally { r.setRenderTarget(prev); r.setViewport(vp); r.setClearColor(clear, alpha); }
  }

  // The developed still as a PNG blob, at the output size.
  async toBlob() {
    if (!this.tracer) return this.stillBlob ?? null;
    const w = this.tracer.target.width, h = this.tracer.target.height;
    const t = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false });
    const px = new Uint8Array(w * h * 4);
    try { this.present(this.lens, t); this.renderer.readRenderTargetPixels(t, 0, 0, w, h, px); } finally { t.dispose(); }
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d'), img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    ctx.putImageData(img, 0, 0);
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  }

  close() {
    // Read the developed pixels before freeing GPU storage; encoding finishes on the CPU.
    const still = this.hasStill ? this.toBlob().catch(err => { console.warn('photo still', err); return null; }) : this.stillBlob;
    this.dispose(); this.stillBlob = still;
  }

  stop() { this.stopping = true; this.cancelPreparation?.(); }

  async waitFence(gl) {
    let fence;
    try {
      this.check(false); fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (!fence) throw new Error('Photo GPU fence failed.');
      gl.flush(); const deadline = performance.now() + 30000;
      while (!this.stopping) {
        this.check(false);
        const status = gl.clientWaitSync(fence, 0, 0);
        if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) return;
        if (status === gl.WAIT_FAILED) throw new Error('Photo GPU wait failed.');
        if (performance.now() > deadline) throw new Error('Photo GPU wait timed out.');
        await this.pause(2, false);
      }
    } finally { if (fence) gl.deleteSync(fence); }
  }

  // A whole still: build, trace `samples` passes (yielding to the page between batches), meter, develop. Shows
  // progress on the canvas every `previewMs`. duty < 1 shares the GPU (see below).
  async render({ samples = 512, maxMs = Infinity, duty = 1, fStop = 8, focus = null, ev = 0, lens = {}, onProgress = null, onPrepare = null, previewMs = 1500 } = {}) {
    if (this.rendering) throw new Error('A photo is already rendering.');
    this.rendering = true;
    this.stopping = false; this.busyMs = 0;
    this.onPrepare = onPrepare;
    try {
      await this.prepare();
      ev += this.mood?.ev ?? 0;
      this.lens = lens; this.setLens({ fStop, focus });
      const t0 = performance.now(); let metered = false, shown = t0;
      // duty < 1 shares the GPU: the frame is traced in 16 small tiles, and after each one the page waits until the
      // GPU has finished it, then stays idle so tracing takes only that fraction of the GPU's time.
      const gl = this.renderer.getContext();
      this.tracer.tiles.set(duty < 1 ? 4 : 2, duty < 1 ? 4 : 2);
      // Full speed also waits for each batch of tiles: issuing a whole still at once queues tens of seconds of GPU work,
      // and the browser's GPU process then misses its watchdog and the context is lost. Batches aim at about 150 ms.
      let batch = 2;
      while (this.tracer.samples < samples && performance.now() - t0 < maxMs && !this.stopping) {
        if (duty < 1) {
          const start = performance.now(); this.sample();
          await this.waitFence(gl);
          const busy = performance.now() - start; this.busyMs += busy;
          await this.pause(busy * (1 / duty - 1), false);
        } else {
          const start = performance.now();
          for (let i = 0; i < batch; i++) { this.check(false); if (this.stopping) break; this.sample(); }
          await this.waitFence(gl);
          const busy = performance.now() - start; this.busyMs += busy;
          batch = THREE.MathUtils.clamp(Math.round(batch * THREE.MathUtils.clamp(150 / Math.max(busy, 1), 0.5, 2)), 1, 32);
        }
        if (this.stopping) break;
        // meter on a few unclamped samples, then clamp at 6x white for that exposure and start the accumulation again
        if (!metered && this.tracer.samples >= 6) { this.autoExpose(ev); this.tracer._pathTracer.material.uniforms.uClamp.value = 6 / this.exposure; this.tracer.reset(); metered = true; }
        if (metered && previewMs && performance.now() - shown > previewMs && this.tracer.samples >= 1) { this.present(); shown = performance.now(); }
        onProgress?.(this.tracer.samples / samples, this.tracer.samples);
        await this.pause(0, false);
      }
      this.check(false);
      // Stop must not enqueue a synchronous meter readback behind an unsignalled GPU fence.
      if (this.tracer.samples > 0 && !this.stopping) { this.autoExpose(ev); this.present(); }
      this.renderMs = Math.round(performance.now() - t0);
      return { samples: this.tracer.samples, ms: this.renderMs, gpuBusyMs: Math.round(this.busyMs), exposure: this.exposure, stopped: this.stopping, presented: !!this.hasStill };
    } catch (err) {
      this.dispose(); this.renderer.setRenderTarget(null);
      if (err.name === 'AbortError') return { samples: 0, ms: 0, gpuBusyMs: 0, stopped: true };
      throw err;
    } finally { this.rendering = false; this.onPrepare = null; }
  }
}
