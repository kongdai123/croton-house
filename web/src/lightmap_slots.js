// GPU-facing slot transitions. Fetch/decode/validate every destination before changing shared uniforms.
import * as THREE from 'three';
import { SLOTS, blendSlot, slotRequests } from './lighting_slots.js';

const copyUniforms = uniforms => Object.fromEntries(Object.entries(uniforms).map(([k, u]) => [k, { value: u.value }]));
// Reflection probes of the current and the next slot share ONE array texture (one sampler instead of two: Apple GPUs
// allow 16 per fragment shader): two halves of `count` layers, picked by uReflBase / uReflNext. A slot's own probe
// texture is CPU-side staging only; it is copied into the half the current slot does not use when its fade begins.
function reflArray(src, count) {
  const { width = 1, height = 1, data = null } = src.image ?? {};
  const t = new THREE.DataArrayTexture(data ? new data.constructor(data.length * 2) : null, width, height, count * 2);
  for (const k of ['format', 'type', 'generateMipmaps', 'minFilter', 'magFilter', 'wrapS', 'wrapT']) t[k] = src[k];
  t.name = 'reflection probes (current + next slot)';
  t.needsUpdate = true;
  return t;
}
export function createSlotRuntime({ scene, renderer, initial, available, load, disposeAtlas, setParams, commit, foliage }) {
  const blend = { value: 0 }, wet = { value: SLOTS[initial.name].wet };
  const lampA = { value: SLOTS[initial.name].lamps }, lampB = { value: lampA.value };
  // Snapshots own their textures; the scene's shared uniform objects only point into these snapshots.
  let current = { ...initial, layers: initial.layers.slice(), volume: { ...initial.volume, uniforms: copyUniforms(initial.volume.uniforms) } };
  let previous = null, fading = null, disposed = false, params = SLOTS[current.name];
  const primary = { volume: initial.volume.uniforms, refl: initial.refl.uniforms };
  const uniforms = {
    uSlotBlend: blend, uSlotNext: { value: current.layers[0] }, uSlotNextLamps: { value: current.layers[1] },
    uSlotNextK: { value: new THREE.Vector2(current.enc.K.slot, current.enc.K.lamps) },
    uSlotLampA: lampA, uSlotLampB: lampB,
  };
  Object.assign(primary.volume, { uProbeBlend: blend, uProbeNextSH: { value: current.volume.uniforms.uProbeSH.value } });
  // Own stable reflection pointers, independent of the shared uniforms rewired during a transition.
  current.reflTex = current.refl.uniforms.uReflTex.value;
  const reflCount = initial.refl.count, refl = reflArray(current.reflTex, reflCount), halves = [null, null];
  // the half holding this slot's probes (copied in, into the half `keep` does not use, when it holds none)
  const place = (tex, keep) => {
    let i = halves.indexOf(tex);
    if (i < 0) {
      i = halves[0] === keep ? 1 : 0; halves[i] = tex;
      const data = tex.image?.data;
      if (data && refl.image.data) { refl.image.data.set(data, i * data.length); for (let l = 0; l < reflCount; l++) refl.addLayerUpdate(i * reflCount + l); }
      refl.needsUpdate = true;
    }
    return i * reflCount;
  };
  Object.assign(primary.refl, { uReflBlend: blend, uReflBase: { value: 0 }, uReflNext: { value: 0 } });
  primary.refl.uReflTex.value = refl;
  // three caches equirectangular background -> cube conversions. Draw a camera-centred sky box
  // during the fade so every frame reads both HDRs directly, without regenerating a cube/PMREM.
  const skyMaterial = new THREE.ShaderMaterial({
    uniforms: { a: { value: current.sky }, b: { value: current.sky }, t: blend },
    vertexShader: `varying vec3 vDirection;
      void main() { vDirection = mat3(modelMatrix) * position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position.z = gl_Position.w; }`,
    fragmentShader: `uniform sampler2D a; uniform sampler2D b; uniform float t; varying vec3 vDirection;
      void main() { vec3 d = normalize(vDirection); vec2 uv = vec2(atan(d.z, d.x) * 0.1591549431 + 0.5, asin(clamp(d.y, -1., 1.)) * 0.3183098862 + 0.5);
        gl_FragColor = mix(texture2D(a, uv), texture2D(b, uv), t);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false,
  });
  const skyBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), skyMaterial);
  skyBox.visible = false; skyBox.frustumCulled = false; skyBox.renderOrder = -Infinity;
  skyBox.onBeforeRender = function (_, __, camera) { this.matrixWorld.copyPosition(camera.matrixWorld); };
  skyBox.raycast = () => {}; scene.add(skyBox);
  const release = data => {
    if (!data || data.released) return; data.released = true;
    data.layers.forEach(disposeAtlas); data.sky.dispose(); data.reflTex?.dispose(); data.env?.dispose();
    data.volume.uniforms.uProbeSH.value.dispose();
    for (let i = 0; i < 2; i++) if (halves[i] === data.reflTex) halves[i] = null;
  };
  const bind = (a, b) => {
    uniforms.uSlotNext.value = b.layers[0]; uniforms.uSlotNextLamps.value = b.layers[1];
    uniforms.uSlotNextK.value.set(b.enc.K.slot, b.enc.K.lamps);
    lampA.value = a.lamps ?? SLOTS[a.name].lamps; lampB.value = b.lamps ?? SLOTS[b.name].lamps;
    primary.volume.uProbeSH.value = a.volume.uniforms.uProbeSH.value;
    primary.volume.uProbeNextSH.value = b.volume.uniforms.uProbeSH.value;
    primary.refl.uReflBase.value = place(a.reflTex, b.reflTex); primary.refl.uReflNext.value = place(b.reflTex, a.reflTex);
    skyMaterial.uniforms.a.value = a.sky; skyMaterial.uniforms.b.value = b.sky;
  };
  const compatible = data => {
    if (data.refl.count !== initial.refl.count) throw Error('Slot reflection layout differs');
    for (const k of ['uReflPos', 'uReflMin', 'uReflMax']) {
      const a = initial.refl.uniforms[k].value, b = data.refl.uniforms[k].value;
      if (a.length !== b.length || a.some((v, i) => Math.abs(v - b[i]) > 0.01)) throw Error('Slot reflection boxes differ');
    }
    if (data.refl.uniforms.uReflMips.value !== initial.refl.uniforms.uReflMips.value) throw Error('Slot reflection resolution differs');
    if (data.sky.image.width !== initial.sky.image.width || data.sky.image.height !== initial.sky.image.height) throw Error('Slot sky resolution differs');
  };
  const progressListeners = new Set();
  const report = (name, fraction, detail) => { for (const cb of progressListeners) cb(fraction, { ...detail, name }); };
  const queue = slotRequests({ available, current: current.name, release,
    load: async name => {
      // Keep at most the current and destination GPU data. Revisiting the previous slot needs no download.
      if (previous?.name === name && previous.resolution === runtime.resolution) { const d = previous; previous = null; return d; }
      release(previous); previous = null;
      const data = await load(name, runtime.resolution, (p, detail) => report(name, p, detail));
      data.reflTex = data.refl.uniforms.uReflTex.value;
      try { compatible(data); data.foliageStage = foliage?.stage(data.foliage); return data; }
      catch (err) { release(data); throw err; }
    },
    begin: data => new Promise(resolve => {
      // All resources (including foliage matching and PMREM) are staged. Only now publish uniform pointers.
      data.foliageStage ??= foliage?.stage(data.foliage);
      data.foliageStage?.begin(); bind(current, data); blend.value = 0;
      fading = { data, elapsed: 0, resolve };
      report(data.name, 1, { phase: 'transition' });
    }),
  });
  const runtime = {
    uniforms, wet, available, resolution: initial.resolution,
    get params() { return params; }, get desired() { return queue.desired; }, get name() { return current.name; },
    request(name, onProgress) {
      if (onProgress) progressListeners.add(onProgress);
      return queue.request(name).finally(() => progressListeners.delete(onProgress));
    },
    setEnvironment(env) { current.env = env; },
    setQuality(resolution) { if (resolution === runtime.resolution && resolution === current.resolution) return Promise.resolve(true); runtime.resolution = resolution; return queue.request(queue.desired, true); },
    combine(level) {
      current.lamps = level; params = { ...params, lamps: level }; lampA.value = level; current.volume.fill(level);
      if (!fading) lampB.value = level;
    },
    patchProbe(sh) {
      Object.assign(sh.uniforms, primary.volume);
      const tap = 'return probeTex( uProbeSH, uvw, ch );';
      if (!sh.fragmentShader.includes(tap)) throw Error('Probe slot shader marker changed');
      sh.fragmentShader = 'uniform float uProbeBlend; uniform highp sampler3D uProbeNextSH;\n' + sh.fragmentShader.replace(tap,
        'return uProbeBlend > 0.0 ? mix( probeTex( uProbeSH, uvw, ch ), probeTex( uProbeNextSH, uvw, ch ), uProbeBlend ) : probeTex( uProbeSH, uvw, ch );');
    },
    patchFoliage(sh) {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = 'attribute vec3 foliageNext; uniform float uSlotBlend; uniform float uSlotLampA; uniform float uSlotLampB;\n' + sh.vertexShader;
      const end = 'foliage.z ); }';
      if (!sh.vertexShader.includes(end)) throw Error('Foliage slot shader marker changed');
      sh.vertexShader = sh.vertexShader.replace(end, `foliage.z ); vFoliage = vec3( mix( vFoliage.x + uSlotLampA * vFoliage.y, foliageNext.x + uSlotLampB * foliageNext.y, uSlotBlend ), 0., mix( vFoliage.z, foliageNext.z, uSlotBlend ) ); }`);
    },
    update(dt) {
      if (disposed || !fading) return;
      const f = fading; f.elapsed = Math.min(1.5, f.elapsed + Math.max(0, dt));
      const t = f.elapsed / 1.5; blend.value = t * t * (3 - 2 * t);
      params = blendSlot({ ...SLOTS[current.name], lamps: lampA.value }, SLOTS[f.data.name], blend.value);
      wet.value = params.wet; setParams(params);
      skyBox.visible = true; scene.background = null;
      if (t === 1) {
        f.data.foliageStage?.finish(); delete f.data.foliageStage;
        release(previous);
        // keep the slot left behind for a quick return, unless a quality change replaced it with another resolution
        // (hq -> mobile otherwise held the full-size atlases, ~354 MiB, until the next slot load)
        if (current.resolution === f.data.resolution) previous = current; else { release(current); previous = null; }
        current = f.data;
        params = SLOTS[current.name]; blend.value = 0; bind(current, current);
        commit(current); skyBox.visible = false; scene.background = current.sky;
        fading = null; f.resolve(true);
      }
    },
    restore() {
      for (const data of [current, previous, fading?.data].filter(Boolean)) {
        data.layers.forEach(t => t.userData.restore?.()); data.remip?.();
        data.volume.uniforms.uProbeSH.value.needsUpdate = true;
        data.env?.dispose();
        const pmrem = new THREE.PMREMGenerator(renderer); try { data.env = pmrem.fromEquirectangular(data.sky); } finally { pmrem.dispose(); }
      }
      refl.clearLayerUpdates(); refl.needsUpdate = true;   // both halves, from the CPU copy
      commit(current);
    },
    dispose() { disposed = true; queue.dispose(); if (fading) { release(fading.data); fading.resolve(false); } release(current); release(previous); refl.dispose(); skyBox.removeFromParent(); skyBox.geometry.dispose(); skyMaterial.dispose(); },
  };
  bind(current, current);
  return runtime;
}
