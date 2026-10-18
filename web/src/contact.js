// Moving-caster sun contact and moving AO in baked/probe irradiance. Enabled by the quality preset.
import * as THREE from 'three';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { groundY } from './pets/roam.js';
import { lightingOf, meshLighting } from './lighting_roles.js';
import { contactSunGLSL, contactAOGLSL } from './shaders/contact.glsl.js';

const Q = new URLSearchParams(globalThis.location?.search ?? '');
export const CONTACT = true; // Compiled once; the pass and its uniforms follow the quality preset.
const param = (k, d, lo, hi) => { const v = Q.has(k) ? Number(Q.get(k)) : d; return Number.isFinite(v) ? THREE.MathUtils.clamp(v, lo, hi) : d; };
const MAX = 16, STEPS = Math.round(param('contactsteps', 8, 4, 16)), SCALE = param('contactscale', 0.5, 0.25, 1);
const RESOLUTION = Math.round(param('contactres', 1024, 256, 2048)), CELL = 16;
const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); white.needsUpdate = true;
const U = { uContactDepth: { value: white }, uContactCoverage: { value: white }, uContactSize: { value: new THREE.Vector2(1, 1) }, uContactView: { value: new THREE.Matrix4() }, uContactProjection: { value: new THREE.Matrix4() }, uContactInvProjection: { value: new THREE.Matrix4() }, uContactDirection: { value: new THREE.Vector3() },
  uContactLength: { value: param('contactlength', 0.3, 0.03, 0.3) }, uContactBias: { value: param('contactbias', 0.006, 0.001, 0.03) }, uContactThickness: { value: param('contactthickness', 0.05, 0.005, 0.12) }, uContactFrame: { value: 0 },
  uContactReady: { value: 0 }, uContactSun: { value: param('contactsun', 1, 0, 1) }, uContactAO: { value: param('contactao', 1, 0, 2) },
  uContactCount: { value: 0 }, uContactPos: { value: Array.from({ length: MAX }, () => new THREE.Vector4()) },
  uContactShape: { value: Array.from({ length: MAX }, () => new THREE.Vector4()) } };
// The shaders read flat copies of the two arrays: three re-uploads a material's uniforms on every material switch and
// copies an array of vectors element by element each time, while a typed array goes to WebGL as it is.
const FLAT = { uContactPos: { value: new Float32Array(MAX * 4) }, uContactShape: { value: new Float32Array(MAX * 4) } };
const SUN_GLSL = contactSunGLSL(STEPS), AO_GLSL = contactAOGLSL(MAX);

// Called last, after PCSS/probes/wetness/reflections. Only the directional light matching the sun gets contact.
// sun = false leaves out the contact sun shadow (its two samplers) and keeps the moving AO: the baked hooks do this
// when a material would exceed the GPU's fragment texture units (sampler_budget.js). Either way the material counts
// as patched, so a later wrapper (createContact's) does not add the sun back.
export function contactPatch(sh, baked = true, sun = true) {
  if (!CONTACT || sh.uniforms.uContactDepth) return;
  Object.assign(sh.uniforms, U, FLAT);
  sh.uniforms.uContactCaster = { value: 0 };
  if (sun) {
    sh.fragmentShader = SUN_GLSL + sh.fragmentShader;
    const begin = sh.fragmentShader.includes('#include <lights_fragment_begin>') ? THREE.ShaderChunk.lights_fragment_begin : null;
    if (begin) sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_begin>', begin);
    sh.fragmentShader = sh.fragmentShader.replace('getDirectionalLightInfo( directionalLight, directLight );',
      'getDirectionalLightInfo( directionalLight, directLight );\n if ( dot( directionalLight.direction, uContactDirection ) > 0.999 ) directLight.color *= contactSun( geometryPosition, geometryNormal );');
  }
  if (!baked) {
    // probe-lit surfaces (the unbaked garden ground and lawn, plants): the same moving AO on the probe irradiance, so a
    // pet or a carried chair stays grounded off the lightmapped floors too (its blob shadow is hidden in every case)
    const hook = 'irradiance += probeIrradiance( vProbeWorld,';
    if (sh.fragmentShader.includes(hook)) sh.fragmentShader = AO_GLSL + sh.fragmentShader.replace(hook,
      'irradiance += contactAO( vProbeWorld, inverseTransformDirection( geometryNormal, viewMatrix ) ) * probeIrradiance( vProbeWorld,');
    return;
  }
  sh.vertexShader = 'varying vec3 vContactWorld;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
    vec4 contactPosition = vec4( transformed, 1.0 );
    #ifdef USE_BATCHING
      contactPosition = batchingMatrix * contactPosition;
    #endif
    #ifdef USE_INSTANCING
      contactPosition = instanceMatrix * contactPosition;
    #endif
    vContactWorld = ( modelMatrix * contactPosition ).xyz;`);
  sh.fragmentShader = 'varying vec3 vContactWorld;\n' + AO_GLSL + sh.fragmentShader.replace('irradiance += lightMapIrradiance;',
    'lightMapIrradiance *= contactAO( vContactWorld, inverseTransformDirection( geometryNormal, viewMatrix ) );\n irradiance += lightMapIrradiance;');
}

// Cache rigid bounds in root space; sample the skin (96 vertices) each frame, not hundreds of thousands of fur vertices.
function proxy(root, strength, skinned = false) {
  const box = new THREE.Box3(), inv = new THREE.Matrix4(), mat = new THREE.Matrix4(), p = new THREE.Vector3(), skins = [];
  const fit = () => {
    root.updateWorldMatrix(true, false); root.updateMatrixWorld(true); inv.copy(root.matrixWorld).invert(); box.makeEmpty();
    root.traverse(o => {
      if (!o.isMesh || !o.geometry?.attributes.position || [].concat(o.material).every(m => m?.transparent || !m?.depthWrite)) return;
      mat.multiplyMatrices(inv, o.matrixWorld);
      if (o.isSkinnedMesh && skinned) {
        if (!skins.some(s => s.o === o)) {
          const n = o.geometry.attributes.position.count, ids = [], fur = o.geometry.attributes.aFur;
          for (let j = 0; j < n; j += Math.max(1, Math.floor(n / 96))) {
            if (fur && (fur.itemSize === 1 ? fur.getX(j) < 0 : fur.getZ(j) > 0.5)) continue;
            ids.push(j);
          }
          skins.push({ o, ids });
        }
        for (const j of skins.find(s => s.o === o).ids) box.expandByPoint(o.getVertexPosition(j, p).applyMatrix4(mat));
      } else { o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox.clone().applyMatrix4(mat)); }
    });
    // Pet root.y is its feet/support height, including a jump; keep fur/tail fitting from sinking the AO below it.
    if (skinned && !box.isEmpty()) { box.min.x -= 0.025; box.min.z -= 0.025; box.max.x += 0.025; box.max.z += 0.025; box.min.y = 0; }
  };
  fit(); const center = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion(), pos = new THREE.Vector3();
  const out = { root, strength, box, center, rx: 0, rz: 0, yaw: 0, distance: 0,
    update(camera) {
      if (skinned) fit(); else root.updateWorldMatrix(true, false);
      if (box.isEmpty()) return false;
      root.matrixWorld.decompose(pos, rotation, scale); box.getCenter(center); center.y = box.min.y; center.applyMatrix4(root.matrixWorld);
      // rotation.y = yaw: the local +Z axis (column 2) is (sin yaw, 0, cos yaw); contactAO rotates world offsets back by it
      const e = root.matrixWorld.elements; out.yaw = Math.atan2(e[8], e[10]);
      out.rx = Math.max(0.07, (box.max.x - box.min.x) * Math.abs(scale.x) * 0.55); out.rz = Math.max(0.07, (box.max.z - box.min.z) * Math.abs(scale.z) * 0.55);
      out.distance = Math.hypot(center.x - camera.position.x, center.z - camera.position.z); return true;
    } };
  return out;
}

// Depth-only copies share rigid geometry and skeletons, never the live scene's material/visibility state.
// Fur uses an ordinary BufferGeometry with a skin-only index: one skin draw, no shells or discarded hair-card work.
function skinGeometry(source) {
  const fur = source.attributes.aFur, geometry = new THREE.BufferGeometry(), indices = [], index = source.index;
  for (const [name, attr] of Object.entries(source.attributes)) if (!attr.isInstancedBufferAttribute) geometry.setAttribute(name, attr);
  const card = i => fur.itemSize === 1 ? fur.getX(i) < 0 : fur.getZ(i) > 0.5 && fur.getZ(i) < 1.5;
  const count = index?.count ?? source.attributes.position.count;
  for (let j = 0; j < count; j += 3) {
    const a = index ? index.getX(j) : j, b = index ? index.getX(j + 1) : j + 1, c = index ? index.getX(j + 2) : j + 2;
    if (!card(a) && !card(b) && !card(c)) indices.push(a, b, c);
  }
  geometry.setIndex(indices); return geometry;
}
const shown = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
const sameMatrix = (a, b) => { for (let i = 0; i < 16; i++) if (Math.abs(a.elements[i] - b.elements[i]) > 1e-10) return false; return true; };

export function createContact({ scene, camera, lighting, movables = [], pets = null, player, human }) {
  if (!CONTACT) return null;
  const blobs = [], rigid = movables.map(r => proxy(r, 0.32)), animals = (pets?.agents ?? []).map(a => proxy(a.root, 0.42, true)), person = proxy(human.root, 0.3);
  const proxies = [...rigid, ...animals, person], ao = [], casterObjects = new Set(), casterMaterials = new Set();
  const entries = [], cache = new Map(), geometries = [], clones = [], materialSwaps = [];
  const depthScene = new THREE.Scene(), depthCamera = new THREE.PerspectiveCamera();
  depthScene.matrixWorldAutoUpdate = depthCamera.matrixWorldAutoUpdate = false;
  const hiddenDepth = new THREE.MeshDepthMaterial(); hiddenDepth.visible = false;
  const depthOf = (m, skin) => {
    // The manifest's contact flag (lighting_roles.js) keeps out see-through and shader surfaces, and plants: their wind
    // shaders would disagree with the depth, and PCSS already handles them.
    if (!m || !m.visible || !m.depthWrite || !lightingOf(m).contact) return null;
    const key = m.uuid + ':' + skin; if (cache.has(key)) return cache.get(key);
    const d = new THREE.MeshDepthMaterial({ side: m.side, displacementMap: m.displacementMap ?? null,
      displacementScale: m.displacementScale ?? 1, displacementBias: m.displacementBias ?? 0 });
    d.colorWrite = false; cache.set(key, d); return d;
  };
  for (const a of pets?.agents ?? []) a.root.traverse(o => { if (o.isMesh && meshLighting(o).fakeShadow) { blobs.push([o, o.visible]); o.visible = false; } });
  for (const p of proxies) {
    p.worldBox = new THREE.Box3(); p.screenBox = new THREE.Box3(); p.onScreen = false;
    p.root.traverse(o => {
      if (!o.isMesh || casterObjects.has(o)) return;
      casterObjects.add(o);
      for (const m of [].concat(o.material)) casterMaterials.add(m);
      const skin = !!(o.isSkinnedMesh && o.geometry.attributes.aFur), mats = [].concat(o.material).map(m => depthOf(m, skin));
      if (mats.every(m => !m)) return;
      const geometry = skin ? skinGeometry(o.geometry) : o.geometry;
      if (skin) geometries.push(geometry);
      const material = Array.isArray(o.material) ? mats.map(m => m ?? hiddenDepth) : mats[0];
      const copy = o.isSkinnedMesh ? new THREE.SkinnedMesh(geometry, material)
        : o.isInstancedMesh ? new THREE.InstancedMesh(geometry, material, o.count) : new THREE.Mesh(geometry, material);
      if (o.isSkinnedMesh) { copy.skeleton = o.skeleton; copy.bindMode = o.bindMode; }
      copy.name = 'contact:' + o.name;
      // The source's custom depth shader may deform rigid geometry. Its lifetime stays with its owner.
      if (!skin && o.customDepthMaterial) copy.material = Array.isArray(o.material) ? mats.map(m => m ? o.customDepthMaterial : hiddenDepth) : o.customDepthMaterial;
      copy.matrixAutoUpdate = copy.matrixWorldAutoUpdate = false; copy.frustumCulled = false;
      copy.onBeforeRender = () => {}; copy.onAfterRender = () => {}; copy.castShadow = false;
      depthScene.add(copy);
      const bones = o.isSkinnedMesh ? o.skeleton.bones : [];
      entries.push({ source: o, copy, proxy: p, lastMatrix: new THREE.Matrix4(), lastVisible: false,
        bones, lastBones: new Float64Array(bones.length * 16), lastMorph: o.morphTargetInfluences ? new Float64Array(o.morphTargetInfluences.length) : null,
        lastInstances: o.isInstancedMesh ? new Float32Array(o.instanceMatrix.array.length) : null, lastCount: 0 });
    });
  }
  // Give the few materials shared by static receivers and moving casters a caster-only copy. Keep shader callbacks
  // and userData references (pet/environment uniforms) intact; exclusive pet materials keep their original identity.
  const shared = new Set();
  scene.traverse(o => { if (o.isMesh && !casterObjects.has(o)) for (const m of [].concat(o.material)) if (casterMaterials.has(m)) shared.add(m); });
  const casterCopies = new Map();
  for (const o of casterObjects) {
    const replace = m => {
      if (!shared.has(m)) return m;
      if (!casterCopies.has(m)) {
        const c = m.clone(); c.onBeforeCompile = m.onBeforeCompile; c.customProgramCacheKey = m.customProgramCacheKey; c.userData = { ...m.userData }; c.bakedHooks = m.bakedHooks;   // the sun-depth copy skips baked patches
        casterCopies.set(m, c); clones.push(c); casterMaterials.add(c);
      }
      return casterCopies.get(m);
    };
    if ([].concat(o.material).some(m => shared.has(m))) {
      const original = o.material; o.material = Array.isArray(original) ? original.map(replace) : replace(original); materialSwaps.push([o, original, o.material]);
    }
  }
  for (const m of shared) casterMaterials.delete(m);
  const patched = new Set(), hooks = [];
  scene.traverse(o => { for (const m of [].concat(o.material ?? [])) {
    if (!m?.isMeshStandardMaterial || patched.has(m) || m.isFogVolumeMaterial) continue;
    // Baked static materials already call contactPatch in lightmap.js. Only wrap their moving counterparts here.
    const caster = casterMaterials.has(m); if (m.lightMap && !caster) continue;
    patched.add(m); const prev = m.onBeforeCompile, key = m.customProgramCacheKey;
    const hook = function(sh, renderer) { prev?.call(this, sh, renderer); contactPatch(sh, !!m.lightMap); if (sh.uniforms.uContactCaster) sh.uniforms.uContactCaster.value = +caster; };
    const programKey = function() { return (key?.call(this) ?? '') + '|contact-camera-depth-v2-' + +caster; };
    m.onBeforeCompile = hook; m.customProgramCacheKey = programKey; m.needsUpdate = true; hooks.push({ m, prev, key, hook, programKey });
  } });
  const depth = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  depth.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType); depth.texture.name = 'Moving contact casters';
  const coverage = new THREE.DataTexture(new Float32Array(2), 1, 1, THREE.RGFormat, THREE.FloatType);
  coverage.minFilter = coverage.magFilter = THREE.NearestFilter; coverage.needsUpdate = true;
  U.uContactDepth.value = depth.depthTexture; U.uContactCoverage.value = coverage;
  const sunPos = new THREE.Vector3(), targetPos = new THREE.Vector3(), feet = new THREE.Vector3(), corner = new THREE.Vector3(), clip = new THREE.Vector4();
  const standing = { center: feet, rx: 0.2, rz: 0.24, yaw: 0, strength: 0.26 };
  const vp = new THREE.Matrix4(), frustum = new THREE.Frustum(), eye = new THREE.Vector3(), aoBox = new THREE.Box3();
  let invalid = true, enabled = true, sunEnabled = true, lastPadding = -1, observedRenderer = null;
  const invalidate = () => { invalid = true; U.uContactReady.value = 0; };
  const stats = { design: 'cached moving-caster camera depth', steps: STEPS, scale: SCALE, capacity: MAX, movables: rigid.length, pets: animals.length,
    casterMeshes: entries.length, active: 0, omitted: 0, visible: 0, size: [1, 1], depthPasses: 0, depthDraws: 0, depthTriangles: 0, coverage: 0, cpuMs: 0, skipped: '' };
  const update = () => {
    ao.length = 0; camera.updateWorldMatrix(true, false); camera.getWorldPosition(eye);
    vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(vp);
    for (const p of proxies) {
      if (!shown(p.root) || !p.update(camera)) continue;
      aoBox.copy(p.box).applyMatrix4(p.root.matrixWorld);
      if (!frustum.intersectsBox(aoBox)) continue;
      p.distance = p.center.distanceToSquared(eye); ao.push(p);
    }
    if (!shown(human.root) && !player.driven && player.enabled) {
      feet.copy(player.pos); feet.y += groundY(feet.x, feet.z); standing.yaw = player.yaw;
      aoBox.min.set(feet.x - 2 * standing.rx, feet.y - 0.45, feet.z - 2 * standing.rz);
      aoBox.max.set(feet.x + 2 * standing.rx, feet.y + 0.03, feet.z + 2 * standing.rz);
      if (frustum.intersectsBox(aoBox)) { standing.distance = feet.distanceToSquared(eye); ao.push(standing); }
    }
    ao.sort((a, b) => a.distance - b.distance);
    const n = Math.min(MAX, ao.length); stats.omitted = Math.max(0, ao.length - MAX);
    for (let i = 0; i < n; i++) { const p = ao[i], c = p.center; U.uContactPos.value[i].set(c.x, c.y, c.z, p.strength); U.uContactShape.value[i].set(1 / p.rx, 1 / p.rz, Math.cos(p.yaw), Math.sin(p.yaw)); U.uContactPos.value[i].toArray(FLAT.uContactPos.value, i * 4); U.uContactShape.value[i].toArray(FLAT.uContactShape.value, i * 4); }
    U.uContactCount.value = stats.active = enabled ? n : 0;
  };
  const snapshot = e => {
    e.lastMatrix.copy(e.source.matrixWorld); e.lastVisible = e.copy.visible;
    for (let j = 0; j < e.bones.length; j++) e.lastBones.set(e.bones[j].matrixWorld.elements, j * 16);
    if (e.lastMorph) e.lastMorph.set(e.source.morphTargetInfluences);
    if (e.lastInstances) { e.lastInstances.set(e.source.instanceMatrix.array); e.lastCount = e.source.count; }
  };
  const changed = e => {
    if (e.copy.visible !== e.lastVisible) return true;
    if (!e.copy.visible) return false;
    if (!sameMatrix(e.source.matrixWorld, e.lastMatrix)) return true;
    for (let j = 0; j < e.bones.length; j++) for (let k = 0; k < 16; k++) if (e.bones[j].matrixWorld.elements[k] !== e.lastBones[j * 16 + k]) return true;
    if (e.lastMorph) for (let j = 0; j < e.lastMorph.length; j++) if (e.lastMorph[j] !== e.source.morphTargetInfluences[j]) return true;
    if (e.lastInstances) {
      if (e.lastCount !== e.source.count) return true;
      for (let j = 0; j < e.lastInstances.length; j++) if (e.lastInstances[j] !== e.source.instanceMatrix.array[j]) return true;
    }
    return false;
  };
  const fillCoverage = () => {
    const { width: w, height: h, data } = coverage.image; data.fill(0); let filled = 0;
    for (const p of proxies) {
      if (!p.onScreen) continue;
      const min = p.worldBox.min, max = p.worldBox.max, b = p.screenBox; b.makeEmpty(); let crossing = false;
      // Expanded world bounds include every potential receiver within the march length plus the depth thickness.
      for (let i = 0; i < 8; i++) {
        corner.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).applyMatrix4(depthCamera.matrixWorldInverse);
        clip.set(corner.x, corner.y, corner.z, 1).applyMatrix4(depthCamera.projectionMatrix);
        if (clip.w <= depthCamera.near) crossing = true;
        b.expandByPoint(targetPos.set(clip.x / clip.w * 0.5 + 0.5, clip.y / clip.w * 0.5 + 0.5, -corner.z));
      }
      const x0 = crossing ? 0 : Math.max(0, Math.floor(b.min.x * w) - 1), x1 = crossing ? w - 1 : Math.min(w - 1, Math.floor(b.max.x * w) + 1);
      const y0 = crossing ? 0 : Math.max(0, Math.floor(b.min.y * h) - 1), y1 = crossing ? h - 1 : Math.min(h - 1, Math.floor(b.max.y * h) + 1);
      const z0 = Math.max(0, b.min.z), z1 = Math.max(0, b.max.z);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const j = (y * w + x) * 2;
        if (!data[j + 1]) { data[j] = z0; filled++; } else data[j] = Math.min(data[j], z0);
        data[j + 1] = Math.max(data[j + 1], z1);
      }
    }
    stats.coverage = filled / (w * h); coverage.needsUpdate = true;
  };
  class ContactPass extends Pass {
    constructor() { super(); this.needsSwap = false; }
    setSize(w, h) {
      const scale = Math.min(SCALE, RESOLUTION / Math.max(w, h)), x = Math.max(1, Math.round(w * scale)), y = Math.max(1, Math.round(h * scale));
      depth.setSize(x, y); U.uContactSize.value.set(x, y); stats.size = [x, y];
      const cw = Math.ceil(x / CELL), ch = Math.ceil(y / CELL);
      if (coverage.image.width !== cw || coverage.image.height !== ch) { coverage.dispose(); coverage.image = { data: new Float32Array(cw * ch * 2), width: cw, height: ch }; coverage.needsUpdate = true; }
      invalid = true; U.uContactReady.value = 0;
    }
    render(renderer) {
      const start = performance.now(); stats.depthDraws = stats.depthTriangles = 0; stats.skipped = ''; U.uContactReady.value = 0;
      if (observedRenderer !== renderer) {
        observedRenderer?.domElement?.removeEventListener('webglcontextrestored', invalidate);
        observedRenderer = renderer; renderer.domElement?.addEventListener('webglcontextrestored', invalidate); invalid = true;
      }
      if (!enabled) { stats.skipped = 'disabled'; stats.cpuMs = performance.now() - start; return; }
      update();
      if (lighting.taa) U.uContactFrame.value = (U.uContactFrame.value + 1) % 64;
      camera.updateWorldMatrix(true, false);
      lighting.sun.getWorldPosition(sunPos); lighting.sun.target.getWorldPosition(targetPos);
      U.uContactDirection.value.copy(sunPos).sub(targetPos).normalize().transformDirection(camera.matrixWorldInverse);
      if (!sunEnabled || U.uContactSun.value <= 0 || lighting.sun.intensity <= 0) { stats.skipped = 'sun disabled'; stats.cpuMs = performance.now() - start; return; }
      depthCamera.near = camera.near; depthCamera.far = camera.far; depthCamera.layers.mask = camera.layers.mask;
      depthCamera.matrixWorld.copy(camera.matrixWorld); depthCamera.matrixWorldInverse.copy(camera.matrixWorldInverse); depthCamera.projectionMatrix.copy(camera.projectionMatrix);
      // Contact runs inside TAA's jittered chain. Undo only its clip offset; camera view offsets still work normally.
      const jitter = lighting.taa?.resolve.uniforms.uJitter.value;
      if (jitter) { const e = depthCamera.projectionMatrix.elements; for (let k = 0; k < 4; k++) { e[k * 4] -= 2 * jitter.x * e[k * 4 + 3]; e[k * 4 + 1] -= 2 * jitter.y * e[k * 4 + 3]; } }
      depthCamera.projectionMatrixInverse.copy(depthCamera.projectionMatrix).invert();
      vp.multiplyMatrices(depthCamera.projectionMatrix, depthCamera.matrixWorldInverse); frustum.setFromProjectionMatrix(vp);
      const padding = U.uContactLength.value + U.uContactThickness.value + U.uContactBias.value * 2 + 0.08;
      let dirty = invalid || padding !== lastPadding || !sameMatrix(depthCamera.matrixWorldInverse, U.uContactView.value) || !sameMatrix(depthCamera.projectionMatrix, U.uContactProjection.value), visible = 0;
      for (const p of proxies) {
        // AO already updated the visible roots; refresh descendants here for animation and bone motion detection.
        if (shown(p.root)) p.root.updateWorldMatrix(true, true);
        p.worldBox.copy(p.box).applyMatrix4(p.root.matrixWorld).expandByScalar(padding);
        p.onScreen = !p.box.isEmpty() && shown(p.root) && frustum.intersectsBox(p.worldBox);
      }
      for (const e of entries) {
        const o = e.source, copy = e.copy;
        copy.visible = e.proxy.onScreen && shown(o) && o.layers.test(depthCamera.layers);
        if (copy.visible) {
          visible++; copy.matrixWorld.copy(o.matrixWorld); copy.layers.mask = o.layers.mask;
          if (o.isSkinnedMesh) { copy.bindMatrix.copy(o.bindMatrix); copy.bindMatrixInverse.copy(o.bindMatrixInverse); }
          if (o.morphTargetInfluences) copy.morphTargetInfluences = o.morphTargetInfluences;
          if (o.isInstancedMesh) { copy.instanceMatrix = o.instanceMatrix; copy.count = o.count; copy.morphTexture = o.morphTexture; }
        }
        dirty = changed(e) || dirty;
      }
      stats.visible = visible;
      if (!visible) { invalid = true; stats.coverage = 0; stats.skipped = 'off screen'; stats.cpuMs = performance.now() - start; return; }
      if (!dirty) { U.uContactReady.value = 1; stats.skipped = 'cached'; stats.cpuMs = performance.now() - start; return; }
      const prev = renderer.getRenderTarget(), auto = renderer.autoClear, shadow = renderer.shadowMap.enabled;
      const face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel(), calls = renderer.info.render.calls, triangles = renderer.info.render.triangles;
      try {
        renderer.shadowMap.enabled = false; renderer.autoClear = true; renderer.setRenderTarget(depth);
        renderer.render(depthScene, depthCamera);
        stats.depthDraws = renderer.info.render.calls - (renderer.info.autoReset ? 0 : calls);
        stats.depthTriangles = renderer.info.render.triangles - (renderer.info.autoReset ? 0 : triangles);
        fillCoverage();
        U.uContactView.value.copy(depthCamera.matrixWorldInverse); U.uContactProjection.value.copy(depthCamera.projectionMatrix); U.uContactInvProjection.value.copy(depthCamera.projectionMatrixInverse);
        for (const e of entries) snapshot(e);
        invalid = false; lastPadding = padding; stats.depthPasses++; U.uContactReady.value = 1;
      } finally {
        renderer.shadowMap.enabled = shadow; renderer.autoClear = auto;
        // setRenderTarget restores the target's viewport/scissor without corrupting the renderer's global viewport.
        renderer.setRenderTarget(prev, face, mip);
        stats.cpuMs = performance.now() - start;
      }
    }
    dispose() {
      observedRenderer?.domElement?.removeEventListener('webglcontextrestored', invalidate);
      U.uContactReady.value = U.uContactCount.value = 0; U.uContactDepth.value = U.uContactCoverage.value = white;
      depth.dispose(); coverage.dispose(); hiddenDepth.dispose(); for (const d of cache.values()) d.dispose(); for (const g of geometries) g.dispose();
      for (const { m, prev, key, hook, programKey } of hooks) { if (m.onBeforeCompile === hook) m.onBeforeCompile = prev; if (m.customProgramCacheKey === programKey) m.customProgramCacheKey = key; m.needsUpdate = true; }
      for (const [o, original, replacement] of materialSwaps) if (o.material === replacement) o.material = original;
      for (const m of clones) m.dispose(); for (const [o, v] of blobs) o.visible = v;
    }
  }
  // TAA owns the scene chain when enabled: run after its projection jitter, before its internal RenderPass.
  const composer = lighting.taa?.internal ?? lighting.composer, pass = new ContactPass(); composer.insertPass(pass, 0); update();
  const api = { pass, stats, uniforms: U, depthScene, depthCamera, update,
    // Retain the verifier's tuning handles from the old fullscreen march.
    march: { uLength: U.uContactLength, uBias: U.uContactBias, uThickness: U.uContactThickness, uFrame: U.uContactFrame },
    // In-page A/B switches keep shader programs compiled. Sun-only isolates the new cost from the unchanged AO.
    setEnabled(value) {
      enabled = pass.enabled = !!value; U.uContactReady.value = 0; U.uContactCount.value = 0;
      for (const [o, visible] of blobs) o.visible = enabled ? false : visible;
      if (enabled) invalidate();
    },
    setSunEnabled(value) { sunEnabled = !!value; U.uContactReady.value = 0; },
    invalidate,
    dispose() { composer.removePass(pass); pass.dispose(); delete scene.userData.contact; } };
  scene.userData.contact = api; return api;
}
