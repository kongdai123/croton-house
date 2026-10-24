// ?lightmap=sunrise&puddlerefl: one clipped, half-resolution ground reflection, independent of the HQ SSR pass.
import * as THREE from 'three';
import { isInside } from './plan.js';
import { lightingOf, meshLighting } from './lighting_roles.js';
import { isBaked, materialOptions, setPlanarPuddle } from './shaders/baked_material.js';
import { warmPrograms } from './shader_warmup.js';

export const PUDDLE_PARAMS = { enabled: true, scale: 0.5, maxWidth: 1280, maxHeight: 720, hz: 30, visibilityHz: 10, ground: 0.012, terrace: 0.22, clip: 0.001, edge: 0.06, wind: 0.003, minRadius: 0.08, minPixels: 2, range: 60, maxDraws: 500, maxTriangles: 1200000 };
// house.js: concrete .012, front walk .014, porch .020; shell -.008..0, raised front terrace .220.
// Only one height is rendered per update; the other terrace falls back to probes, as do mismatched surfaces.
// The planar reflection's uniforms: one set (one reflection render per page), bound by every shader that shows it (the
// composed baked shader, shaders/compose.js), filled in by createPuddles.
export const PUDDLE_UNIFORMS = { uPuddleTex: { value: null }, uPuddleMatrix: { value: new THREE.Matrix4() }, uPuddleValid: { value: 0 }, uPuddleTime: { value: 0 },
  uPuddleY: { value: PUDDLE_PARAMS.ground }, uPuddleEdge: { value: PUDDLE_PARAMS.edge }, uPuddleWind: { value: PUDDLE_PARAMS.wind } };

// CPU copy of lightmap.js's mask, used only to gate the render from actual puddle samples in ground triangles.
const fract = x => x - Math.floor(x), mix = (a, b, t) => a + (b - a) * t;
function noise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = fract(x), fz = fract(z), u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const h = (a, b) => fract(Math.sin(a * 127.1 + b * 311.7) * 43758.5453);
  return mix(mix(h(ix, iz), h(ix + 1, iz), u), mix(h(ix, iz + 1), h(ix + 1, iz + 1), u), v);
}
const indoors = b => isInside(b.min.x + 0.25, -b.min.z - 0.25) && isInside(b.max.x - 0.25, -b.max.z + 0.25) && isInside(b.min.x + 0.25, -b.max.z + 0.25) && isInside(b.max.x - 0.25, -b.min.z - 0.25);
function isPuddle(x, z) {
  if (isInside(x, -z)) return false;
  x *= 0.35; z *= 0.35;
  return 0.55 * noise(x, z) + 0.3 * noise(x * 2.1 + 5.2, z * 2.1 + 5.2) + 0.15 * noise(x * 4.3 + 9.1, z * 4.3 + 9.1) > 0.565;
}
// wet: the manifest's (lighting_roles.js): leaf cards and cut-out leaves stay dry
const wetMaterial = m => m?.isMeshStandardMaterial && !m.isFogVolumeMaterial && lightingOf(m).wet === 'auto';
const outsideBox = b => !(isInside(b.min.x, -b.min.z) && isInside(b.max.x, -b.max.z) && isInside(b.min.x, -b.max.z) && isInside(b.max.x, -b.min.z));
// A ground triangle that reaches clearly outside the house: its centroid, or a point 15 cm in from a corner, with a
// 10 cm margin all round outside the plan. Floors and walls meeting the plan's outline (vertices on it) do not count.
const clearlyOutside = (x, z) => !isInside(x - 0.1, -z) && !isInside(x + 0.1, -z) && !isInside(x, -z - 0.1) && !isInside(x, -z + 0.1);
function outsideTriangle(a, b, c) {
  const gx = (a.x + b.x + c.x) / 3, gz = (a.z + b.z + c.z) / 3;
  if (clearlyOutside(gx, gz)) return true;
  for (const v of [a, b, c]) {
    const d = Math.hypot(gx - v.x, gz - v.z), t = d > 0.15 ? 0.15 / d : 1;
    if (clearlyOutside(v.x + (gx - v.x) * t, v.z + (gz - v.z) * t)) return true;
  }
  return false;
}
function visible(o) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }
function reflectionVisible(o) { for (let p = o; p; p = p.parent) if (!p.visible && !(p.name === 'frozen' && p.userData.batch)) return false; return true; }

// The puddle reflection's scene and ground, from the scene as it is (CPU only, no materials made): the meshes it mirrors
// (with their world bounds), the materials that can show a puddle (on a flat, up-facing triangle at a puddle plane's
// height outside the house: the wet mask is zero elsewhere; only these take the planar reflection, never indoor floors or
// furniture, whose shaders have no texture unit to spare on Apple GPUs) and the puddle samples that decide which plane
// to render. Run once when the baked lighting loads, so the ground's shaders are compiled with the planar puddle from the
// start (a later quality change only switches it on: no recompile at runtime). furniture: roots of movable and animated
// objects (lightmap.js movables, dynamic), never given the planar reflection.
export function scanPuddles(scene, furniture = [], params = {}) {
  const P = { ...PUDDLE_PARAMS, ...params }, samples = [], meshes = [];
  const ground = new Set(), roots = new Set(furniture);
  const isFurniture = o => { for (let p = o; p; p = p.parent) if (roots.has(p)) return true; return false; };
  const markGround = (o, i) => {
    if (isFurniture(o)) return;
    const ms = o.material;
    if (!Array.isArray(ms)) { if (wetMaterial(ms)) ground.add(ms); return; }
    const g = o.geometry.groups.find(g => i >= g.start && i < g.start + g.count);
    const m = g ? ms[g.materialIndex] : ms[0]; if (wetMaterial(m)) ground.add(m);
  };
  const box = new THREE.Box3(), sphere = new THREE.Sphere();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), ab = new THREE.Vector3(), ac = new THREE.Vector3(), point = new THREE.Vector3();
  // Ground samples come from real triangles, including merged batches, never the house's interior floor.
  function groundSamples(o, bounds) {
    if (bounds.min.y > P.terrace + 0.005 || bounds.max.y < -0.03 || ![].concat(o.material).some(wetMaterial)) return;
    if (o.isInstancedMesh) { if (outsideBox(bounds) && !isFurniture(o)) for (const m of [].concat(o.material)) if (wetMaterial(m)) ground.add(m); return; }
    const g = o.geometry, pos = g.attributes.position, idx = g.index, n = idx?.count ?? pos.count;
    for (let i = 0; i < n; i += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(o.matrixWorld);
      if (Math.max(a.y, b.y, c.y) - Math.min(a.y, b.y, c.y) > 0.002 || a.y < -0.03 || a.y > P.terrace + 0.005) continue;
      ab.subVectors(b, a); ac.subVectors(c, a);
      if (point.crossVectors(ab, ac).y <= 0) continue;
      // the reflection shows within 4 cm of a puddle plane (puddleRadiance): ground 0.012, terrace 0.22
      if ((Math.abs(a.y - P.ground) < 0.04 || Math.abs(a.y - P.terrace) < 0.04) && outsideTriangle(a, b, c)) markGround(o, i);
      const height = Math.abs(a.y - P.terrace) < 0.015 ? P.terrace : P.ground;
      const x0 = Math.max(-35, Math.min(a.x, b.x, c.x)), x1 = Math.min(35, Math.max(a.x, b.x, c.x));
      const z0 = Math.max(-35, Math.min(a.z, b.z, c.z)), z1 = Math.min(35, Math.max(a.z, b.z, c.z));
      const det = ab.x * ac.z - ab.z * ac.x; if (Math.abs(det) < 1e-7) continue;
      for (let x = Math.ceil(x0 / 0.65) * 0.65; x <= x1; x += 0.65) for (let z = Math.ceil(z0 / 0.65) * 0.65; z <= z1; z += 0.65) {
        const u = ((x - a.x) * ac.z - (z - a.z) * ac.x) / det, v = (ab.x * (z - a.z) - ab.z * (x - a.x)) / det;
        if (u >= 0 && v >= 0 && u + v <= 1 && isPuddle(x, z)) samples.push({ source: o, point: new THREE.Vector3(x, a.y + 0.004, z), height });
      }
    }
  }
  scene.updateMatrixWorld(true);
  scene.traverse(o => {
    if (!o.isMesh || o.isSkinnedMesh || o.isReflector || o.userData.batched || o.userData.lightHit || !meshLighting(o).puddleMirror || !o.layers.isEnabled(0)) return;
    // Use the existing merged plant LOD even up close: keep whole crowns without hundreds of tiny leaf draws.
    for (let p = o.parent; p && p !== scene; p = p.parent) {
      const frozen = p.children.find(c => c.name === 'frozen' && c.userData.batch);
      if (frozen) { let branch = o; while (branch.parent !== p) branch = branch.parent; if (branch !== frozen) return; }
    }
    const ms = [].concat(o.material);
    // see-through surfaces (manifest castsSun false: glass) stay out of the reflection, as shader and fog volumes
    if (ms.some(m => !m || m.isShaderMaterial || m.isFogVolumeMaterial || !lightingOf(m).castsSun)) return;
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    if (o.isInstancedMesh && !o.boundingSphere) o.computeBoundingSphere();
    sphere.copy(o.boundingSphere ?? o.geometry.boundingSphere).applyMatrix4(o.matrixWorld);
    if (sphere.radius < P.minRadius) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    if (o.isInstancedMesh) sphere.getBoundingBox(box); else box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    groundSamples(o, box);
    groundSamples(o, box);
    meshes.push({ o, ms, sphere: sphere.clone(), box: box.clone() });
  });
  return { ground, samples, meshes };
}
// Give the ground's baked materials the planar puddle (their composed shader's flag; its sampler plan may still leave it
// out on a GPU without a texture unit to spare). -> the materials newly marked.
export function markPuddleGround(scene, ground) {
  const marked = [];
  scene.traverse(o => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) if (wetMaterial(m) && ground.has(m) && isBaked(m) && !materialOptions(m).planarPuddle) { setPlanarPuddle(m, true); marked.push(m); }
  });
  return marked;
}

// furniture: roots of movable and animated objects (lightmap.js movables, dynamic), never given the planar reflection
// ground: the load-time scan's ground (lightmap.js), else this one's: the scene's meshes as they are now (the visitor
// and the pets came after the load) are what the reflection draws either way.
export function createPuddles({ scene, renderer, wet = 1, params = {}, furniture = [], ground = null }) {
  const scan = scanPuddles(scene, furniture, params);
  const P = { ...PUDDLE_PARAMS, ...params }, flat = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  flat.matrixWorldAutoUpdate = false; camera.userData.hqReflection = true; camera.userData.puddleReflection = true;
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: true, samples: 0 });
  rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
  const uniforms = PUDDLE_UNIFORMS;
  uniforms.uPuddleMatrix.value.identity(); uniforms.uPuddleTex.value = rt.texture; uniforms.uPuddleValid.value = 0; uniforms.uPuddleTime.value = 0;
  uniforms.uPuddleY.value = P.ground; uniforms.uPuddleEdge.value = P.edge; uniforms.uPuddleWind.value = P.wind;
  const sources = [], lights = [], samples = scan.samples, materials = new Map(), candidates = [];
  const stats = { renders: 0, draws: 0, triangles: 0, width: 0, height: 0, visible: false, plane: P.ground, visibilityMs: 0, samples: 0 };
  const size = new THREE.Vector2(), eye = new THREE.Vector3(), target = new THREE.Vector3(), up = new THREE.Vector3();
  const projection = new THREE.Matrix4(), frustum = new THREE.Frustum(), clip = new THREE.Plane(), cp = new THREE.Vector4(), q = new THREE.Vector4(), viewport = new THREE.Vector4();
  scene.updateMatrixWorld(true);
  // The reflection's copies: diffuse only (no normal map, shadow, probe specular, transmission, SSR tag or nested
  // reflection work in this scene; its environment exists only to enable SH code), still the baked atlas decoding, SH,
  // vertex colours, wind and alpha cut-outs: for a baked material the composed shader's diffuse flag.
  function simple(m) {
    if (materials.has(m)) return materials.get(m).material;
    const s = m.isMeshStandardMaterial ? new THREE.MeshStandardMaterial().copy(m) : m.clone();
    s.defines = { ...m.defines, ...s.defines }; s.onBeforeRender = m.onBeforeRender;
    s.onBeforeCompile = m.onBeforeCompile; s.customProgramCacheKey = m.customProgramCacheKey; if (m.ownShader) s.ownShader = m.ownShader;
    if (s.isMeshStandardMaterial) { s.normalMap = s.bumpMap = s.roughnessMap = s.metalnessMap = null; s.roughness = 1; s.metalness = 0; s.envMapIntensity = 0; }
    if (isBaked(m)) s.userData.bakedDiffuse = true;
    s.toneMapped = false;
    materials.set(m, { material: s, env: s.envMap }); return s;
  }
  scene.traverse(o => {
    if (!o.isDirectionalLight) return;
    const proxy = o.clone(false); proxy.target = o.target;
    // Share the live shadow (matrix and map; nothing is re-rendered here) so the reflection keeps the sun's PCSS shade.
    proxy.shadow = o.shadow; proxy.castShadow = o.castShadow;
    proxy.matrixAutoUpdate = proxy.matrixWorldAutoUpdate = false; flat.add(proxy); lights.push({ source: o, proxy });
  });
  for (const { o, ms, sphere, box } of scan.meshes) {
    const mat = Array.isArray(o.material) ? ms.map(simple) : simple(o.material);
    // Clone without allocating another instance buffer; matrices/colours/bounds are shared read-only with the source.
    const proxy = o.isInstancedMesh ? o.clone(false) : new THREE.Mesh(o.geometry, mat);
    proxy.material = mat; proxy.matrixAutoUpdate = proxy.matrixWorldAutoUpdate = false; proxy.castShadow = false; proxy.receiveShadow = o.receiveShadow;
    proxy.onBeforeRender = THREE.Object3D.prototype.onBeforeRender; proxy.renderOrder = o.renderOrder;
    if (o.isInstancedMesh) { proxy.instanceMatrix = o.instanceMatrix; proxy.instanceColor = o.instanceColor; }
    proxy.layers.set(0); flat.add(proxy);
    const e = { source: o, proxy, sphere: sphere.clone(), box: box.clone(), score: 0, triangles: (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3, draws: o.geometry.groups.length || 1,
      // budget order: 0 outside architecture, 1 plants, 2 anything wholly inside the house (seen only through windows)
      tier: o.isInstancedMesh || ms.some(m => lightingOf(m).foliage) ? 1 : indoors(box) ? 2 : 0 };
    sources.push(e);
  }
  // (marked when the baked lighting loaded; else now)
  const patches = markPuddleGround(scene, ground ?? scan.ground);
  let lastRender = -Infinity, lastVisibility = -Infinity, plane = null, busy = false;
  // World bounds follow doors and furniture; refreshed only for a reflection render.
  const refresh = list => { for (const e of list) {
    e.sphere.copy(e.source.boundingSphere ?? e.source.geometry.boundingSphere).applyMatrix4(e.source.matrixWorld);
    if (e.source.isInstancedMesh) e.sphere.getBoundingBox(e.box); else e.box.copy(e.source.geometry.boundingBox).applyMatrix4(e.source.matrixWorld);
  } };
  // Which plane to render: the one whose puddle samples in view weigh most (1 / distance^2, roughly their screen area).
  // Indoors nothing is rendered: puddles seen through the windows keep the probes. (Segment tests against the house
  // were tried here: plain Mesh raycasts through a merged batch cost 10-20 ms per ray, 20-100 ms per scan.)
  function visiblePlane(cam, now) {
    if (now - lastVisibility < 1000 / P.visibilityHz) return plane;
    lastVisibility = now; const t0 = performance.now();
    if (isInside(eye.x, -eye.z)) { stats.visibilityMs = performance.now() - t0; return null; }
    projection.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); frustum.setFromProjectionMatrix(projection);
    let ground = 0, terrace = 0;
    for (const s of samples) {
      if (eye.y <= s.height + 0.015 || !frustum.containsPoint(s.point)) continue;
      const d2 = eye.distanceToSquared(s.point); if (d2 > P.range * P.range || !visible(s.source)) continue;
      if (s.height === P.terrace) terrace += 1 / Math.max(d2, 0.25); else ground += 1 / Math.max(d2, 0.25);
    }
    stats.visibilityMs = performance.now() - t0;
    return ground + terrace <= 0 ? null : terrace > ground ? P.terrace : P.ground;
  }
  function update(cam) {
    if (busy || cam.userData.hqReflection || cam.userData.puddleReflection || !cam.isPerspectiveCamera || !cam.layers.isEnabled(0) || scene.overrideMaterial) return;
    uniforms.uPuddleValid.value = 0;
    if (!P.enabled || !(wet > 0)) return;
    const now = performance.now(); eye.setFromMatrixPosition(cam.matrixWorld);
    plane = visiblePlane(cam, now); stats.visible = plane !== null;
    if (plane === null || eye.y <= plane + 0.015) return;
    uniforms.uPuddleTime.value = now / 1000;   // the wind ripples move every frame, the mirror image at P.hz
    if (now - lastRender < 1000 / P.hz && uniforms.uPuddleY.value === plane) { uniforms.uPuddleValid.value = 1; return; }
    renderer.getDrawingBufferSize(size);
    const scale = Math.min(P.scale, P.maxWidth / size.x, P.maxHeight / size.y), w = Math.max(1, Math.floor(size.x * scale)), h = Math.max(1, Math.floor(size.y * scale));
    if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
    camera.position.copy(eye); camera.position.y = 2 * plane - eye.y;
    target.set(0, 0, -1).transformDirection(cam.matrixWorld).add(eye); target.y = 2 * plane - target.y;
    up.set(0, 1, 0).transformDirection(cam.matrixWorld); up.y = -up.y; camera.up.copy(up); camera.lookAt(target);
    camera.near = cam.near; camera.far = cam.far; camera.updateMatrixWorld(); camera.projectionMatrix.copy(cam.projectionMatrix);
    // World -> reflected UV before changing depth. Oblique near plane rejects everything below this water surface.
    uniforms.uPuddleMatrix.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse);
    clip.set(new THREE.Vector3(0, 1, 0), -plane - P.clip).applyMatrix4(camera.matrixWorldInverse);
    cp.set(clip.normal.x, clip.normal.y, clip.normal.z, clip.constant);
    const e = camera.projectionMatrix.elements;
    q.set((Math.sign(cp.x) + e[8]) / e[0], (Math.sign(cp.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    const denom = cp.dot(q); if (Math.abs(denom) < 1e-5) return;
    cp.multiplyScalar(2 / denom); e[2] = cp.x; e[6] = cp.y; e[10] = cp.z + 1; e[14] = cp.w;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(projection);
    candidates.length = 0; refresh(sources);
    for (const e of sources) {
      e.proxy.visible = false;
      // (not room culling's verdict, layers.culled: the reflection is looked up off its plane on raised terraces and under
      // the wind ripples, so it shows a little of what the walls hide from the camera; cull_check saw it at the doors)
      if (!reflectionVisible(e.source) || e.box.max.y <= plane + P.clip || !frustum.intersectsSphere(e.sphere)) continue;
      const d = Math.max(0.1, camera.position.distanceTo(e.sphere.center)), pixels = e.sphere.radius * h * Math.abs(camera.projectionMatrix.elements[5]) / d;
      if (d - e.sphere.radius > P.range || pixels < P.minPixels) continue;
      e.score = pixels; candidates.push(e);
    }
    // The outside of the house first (cheap, and a missing wall shows the rooms), then plants, then the interior.
    candidates.sort((a, b) => a.tier - b.tier || b.score - a.score);
    let draws = 0, triangles = 0;
    for (const e of candidates) {
      const n = e.triangles * (e.source.isInstancedMesh ? e.source.count : 1);
      if (draws + e.draws > P.maxDraws || triangles + n > P.maxTriangles) continue;
      e.proxy.visible = true; e.proxy.matrixWorld.copy(e.source.matrixWorld); e.proxy.geometry = e.source.geometry;
      if (e.source.isInstancedMesh) { e.proxy.count = e.source.count; e.proxy.boundingSphere = e.source.boundingSphere; }
      draws += e.draws; triangles += n;
    }
    for (const { source, proxy } of lights) { proxy.visible = visible(source); proxy.castShadow = source.castShadow; proxy.matrixWorld.copy(source.matrixWorld); proxy.color.copy(source.color); proxy.intensity = source.intensity; }
    for (const [source, entry] of materials) {
      const m = entry.material; m.color?.copy(source.color); m.emissive?.copy(source.emissive); m.opacity = source.opacity; m.emissiveIntensity = source.emissiveIntensity;
      if (m.isMeshStandardMaterial && entry.env !== source.envMap) { entry.env = m.envMap = source.envMap; m.needsUpdate = true; }
    }
    flat.background = scene.background; flat.backgroundIntensity = scene.backgroundIntensity; flat.backgroundBlurriness = 0; flat.backgroundRotation.copy(scene.backgroundRotation); flat.fog = scene.fog;
    const saved = { target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(), mip: renderer.getActiveMipmapLevel(), xr: renderer.xr.enabled, shadow: renderer.shadowMap.autoUpdate, needs: renderer.shadowMap.needsUpdate, auto: renderer.autoClear, tone: renderer.toneMapping, color: renderer.getClearColor(new THREE.Color()).clone(), alpha: renderer.getClearAlpha() };
    renderer.getCurrentViewport(viewport); busy = true;
    try {
      renderer.xr.enabled = false; renderer.shadowMap.autoUpdate = renderer.shadowMap.needsUpdate = false; renderer.autoClear = false; renderer.toneMapping = THREE.NoToneMapping;
      renderer.setRenderTarget(rt); renderer.setClearColor(0, 0); renderer.state.buffers.depth.setMask(true); renderer.clear(true, true, true); renderer.render(flat, camera);
      uniforms.uPuddleY.value = plane; uniforms.uPuddleValid.value = 1; lastRender = now;
      Object.assign(stats, { renders: stats.renders + 1, draws, triangles, width: w, height: h, plane });
    } finally {
      renderer.setClearColor(saved.color, saved.alpha); renderer.toneMapping = saved.tone; renderer.autoClear = saved.auto;
      renderer.xr.enabled = saved.xr; renderer.shadowMap.autoUpdate = saved.shadow; renderer.shadowMap.needsUpdate = saved.needs;
      renderer.setRenderTarget(saved.target, saved.face, saved.mip); renderer.state.viewport(viewport); busy = false;
    }
  }
  const before = scene.onBeforeRender;
  const hook = function (r, s, cam, ...args) { before?.call(this, r, s, cam, ...args); update(cam); };
  scene.onBeforeRender = hook;
  stats.samples = samples.length; stats.sources = sources.length; stats.materials = patches.length;
  // The copies' programs, compiled under the loading screen (main.js): the first puddle in view otherwise links them all
  // in one frame (0.3-1.2 s on the patio at hq). Environments and lights are synced first, as a render does.
  function warm() {
    for (const [source, entry] of materials) { const m = entry.material; if (m.isMeshStandardMaterial && entry.env !== source.envMap) { entry.env = m.envMap = source.envMap; m.needsUpdate = true; } }
    for (const { source, proxy } of lights) { proxy.visible = visible(source); proxy.castShadow = source.castShadow; }
    flat.background = scene.background; flat.fog = scene.fog;
    return warmPrograms(renderer, flat, camera, rt);
  }
  return { uniforms, stats, params: P, target: rt, samples, sources, candidates, update, warm, setEnabled(value) { P.enabled = !!value; if (!P.enabled) uniforms.uPuddleValid.value = 0; }, dispose() {
    if (scene.onBeforeRender === hook) scene.onBeforeRender = before;
    for (const m of patches) setPlanarPuddle(m, false);
    for (const { material } of materials.values()) material.dispose();
    rt.dispose(); uniforms.uPuddleValid.value = 0;
  } };
}
