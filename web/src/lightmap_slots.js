// GPU-facing slot transitions. Fetch/decode/validate every destination before changing shared uniforms.
import * as THREE from 'three';
import { SLOTS, fadeExposure, slotRequests } from './lighting_slots.js';

const copyUniforms = uniforms => Object.fromEntries(Object.entries(uniforms).map(([k, u]) => [k, { value: u.value }]));
// Reflection probes of the current and the next slot share ONE array texture (one sampler instead of two: Apple GPUs
// allow 16 per fragment shader): two halves of `count` layers, picked by uReflBase / uReflNext. A slot's own probe
// texture is CPU-side staging only; it is copied into the half the current slot does not use when its fade begins.
// The lamp groups' reflection layers (lightmap.js attachLampReflections; the same for every slot) follow both halves.
export function reflArray(src, count, lamps = null) {
  const { width = 1, height = 1, data = null } = src.image ?? {};
  const extra = lamps?.count ?? 0;
  const t = new THREE.DataArrayTexture(data ? new data.constructor(data.length * 2 + (extra ? lamps.data.length : 0)) : null, width, height, count * 2 + extra);
  // three uploads only the listed layers once any are listed (place() lists a half's): list the lamp layers for the
  // first upload too, or they stay black on the GPU
  if (data && extra) { t.image.data.set(lamps.data, data.length * 2); for (let l = 0; l < extra; l++) t.addLayerUpdate(count * 2 + l); }
  for (const k of ['format', 'type', 'generateMipmaps', 'minFilter', 'magFilter', 'wrapS', 'wrapT']) t[k] = src[k];
  t.name = 'reflection probes (current + next slot)';
  t.needsUpdate = true;
  return t;
}
// exposureBases(a, b): the two slots' exposures for the current view, [a's, b's] (only their difference counts; lightmap.js:
// the fixed exposure's ev, the visitor's garden or metered room). The fade blends radiance in exposed space with them
// (lighting_slots.js fadeExposure); the exposure moves by `shift`. exposureShift sums every fade's shift so far (EV): a
// history that carries radiance from frame to frame (the volumetric light's) rescales it by the change since it last
// looked, so a fade that drops the radiance 7 stops in a second is not shown 7 stops too bright through it. The visitor's
// exposure needs no history through a fade: it is its target in every frame `stepping` (auto_exposure.js uFade).
export function createSlotRuntime({ scene, renderer, initial, available, load, disposeAtlas, setParams, commit, foliage, exposureBases = (a, b) => [a.ev, b.ev] }) {
  const blend = { value: 0 }, wet = { value: SLOTS[initial.name].wet };
  let exposureShift = 0, stepped = false;
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
  const reflCount = initial.refl.count, refl = reflArray(current.reflTex, reflCount, initial.refl.lamps), halves = [null, null];
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
      fading = { data, elapsed: 0, resolve, shift: 0 };
      report(data.name, 1, { phase: 'transition' });
    }),
  });
  const runtime = {
    uniforms, wet, available, resolution: initial.resolution,
    get params() { return params; }, get desired() { return queue.desired; }, get name() { return current.name; },
    // the fade in progress, read-only (the volumetric pass blends its media and sky light with it), or null
    get fading() { return fading ? { name: fading.data.name, sky: fading.data.sky, t: blend.value, progress: fading.progress ?? 0, shift: fading.shift, bases: fading.bases ?? null } : null; },
    request(name, onProgress) {
      if (onProgress) progressListeners.add(onProgress);
      return queue.request(name).finally(() => progressListeners.delete(onProgress));
    },
    setEnvironment(env) { current.env = env; },
    get exposureShift() { return exposureShift; },
    setQuality(resolution) { if (resolution === runtime.resolution && resolution === current.resolution) return Promise.resolve(true); runtime.resolution = resolution; return queue.request(queue.desired, true); },
    combine(level) {
      current.lamps = level; params = { ...params, lamps: level }; lampA.value = level; current.volume.fill(level);
      if (!fading) lampB.value = level;
    },
    // true from the frame a fade begins through the frame it ends in (the visitor's exposure follows its target in them)
    get stepping() { return stepped; },
    update(dt) {
      stepped = false;
      if (disposed || !fading) return;
      stepped = true;
      const f = fading; f.elapsed = Math.min(1.5, f.elapsed + Math.max(0, dt));
      const t = f.elapsed / 1.5, s = t * t * (3 - 2 * t);
      const a = { ...SLOTS[current.name], lamps: lampA.value }, b = SLOTS[f.data.name], bases = exposureBases(a, b), fade = fadeExposure(a, b, s, ...bases);
      f.progress = s; f.bases = bases;
      blend.value = fade.weight; params = fade.mood;   // every radiance blend reads blend (lightmaps, probes, reflections, sky, lamps, media)
      exposureShift += fade.shift - f.shift; f.shift = fade.shift;
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
        // Build the new environment before dropping the old one: a failure (lost again) leaves the old one in place and the
        // next restore rebuilds it, never a disposed target that later code samples.
        let env = null;
        const pmrem = new THREE.PMREMGenerator(renderer);
        try { env = pmrem.fromEquirectangular(data.sky); } catch (err) { console.warn('slot environment deferred', err?.message ?? err); } finally { pmrem.dispose(); }
        if (env) { data.env?.dispose(); data.env = env; }
      }
      refl.clearLayerUpdates(); refl.needsUpdate = true;   // both halves, from the CPU copy
      commit(current);
    },
    dispose() { disposed = true; queue.dispose(); if (fading) { release(fading.data); fading.resolve(false); } release(current); release(previous); refl.dispose(); skyBox.removeFromParent(); skyBox.geometry.dispose(); skyMaterial.dispose(); },
  };
  bind(current, current);
  return runtime;
}
