// Baked walkthrough only. Meter the composer's resolved linear HDR immediately before output (also after TAA).
// Intermittent log meter -> median/temporal/dead-band target -> every-frame eased EV glide.
// No readback, fences or extra scene render. Local adaptation shares the existing output draw.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { METER, ADAPTATION, autoExposureEnabled } from './auto_exposure_policy.js';
import { createLocalAdaptation } from './local_adapt.js';

const IDENTITY = new THREE.Matrix3();
const vertexShader = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const material = (fragmentShader, uniforms) => new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.NoBlending });
const target = (w, h, type = THREE.HalfFloatType) => new THREE.WebGLRenderTarget(w, h, {
  type, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false,
});
const meterShader = `
uniform sampler2D tScene; varying vec2 vUv;
void main() {
  vec2 sum = vec2(0.0);
  // Take logs before spatial reduction, so a small bright window cannot outweigh the room.
  // 4x4 taps per meter texel (256x144 over the frame): sparse taps let small highlights make the exposure shimmer.
  for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) {
    vec2 uv = vUv + (vec2(float(x), float(y)) - 1.5) / vec2(${METER.width * 4}.0, ${METER.height * 4}.0);
    vec3 rgb = max(texture2D(tScene, uv).rgb, vec3(0.0));
    float lum = clamp(dot(rgb, vec3(0.2126, 0.7152, 0.0722)), ${METER.floor}, ${METER.ceiling}.0);
    vec2 d = (uv - vec2(0.5, 0.45)) * 2.0;
    float weight = (0.15 + 0.85 * exp(-2.0 * dot(d, d))) * (1.0 - 0.85 * smoothstep(0.7, 0.95, uv.y));
    sum += vec2(log2(lum) * weight, weight);
  }
  gl_FragColor = vec4(sum * 0.0625, 0.0, 1.0);
}`;
const reduceShader = `
uniform sampler2D tMeter; varying vec2 vUv;
void main() {
  vec2 sum = vec2(0.0);
  for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++)
    sum += texture2D(tMeter, vUv + (vec2(float(x), float(y)) - 1.5) / vec2(${METER.width}.0, ${METER.height}.0)).rg;
  gl_FragColor = vec4(sum / 16.0, 0.0, 1.0);
}`;
const filterShader = `
uniform sampler2D tMeter, tPrevious;
uniform float uDt, uValid, uFast, uTau, uDeadBand, uFade;
void main() {
  vec2 sum = vec2(0.0);
  for (int y = 0; y < ${METER.height / 4}; y++) for (int x = 0; x < ${METER.width / 4}; x++)
    sum += texture2D(tMeter, (vec2(float(x), float(y)) + 0.5) / vec2(${METER.width / 4}.0, ${METER.height / 4}.0)).rg;
  float raw = sum.x / max(sum.y, 0.0001);
  vec4 old = texture2D(tPrevious, vec2(0.5));
  float median = max(min(raw, old.r), min(max(raw, old.r), old.g));
  float filtered = mix(old.b, uFast > 0.5 ? raw : median, 1.0 - exp(-uDt / uTau));
  float error = filtered - old.a;
  float held = old.a + sign(error) * max(0.0, abs(error) - uDeadBand);
  // through a slot fade every frame's reading as it is: the fade, not the view, changes the light
  gl_FragColor = uValid > 0.5 && uFade < 0.5 ? vec4(raw, old.r, filtered, held) : vec4(raw);
}`;
const adaptShader = `
uniform sampler2D tMeter, tPrevious;
uniform vec3 uSlot; // base EV, minimum/maximum EV offsets
uniform vec4 uTimes; // brighten, darken, ease, teleport (seconds)
uniform float uDt, uValid, uFast, uIndoor, uKey, uOutdoor, uFade; // uOutdoor: the visitor's offset outdoors; uFade: a slot crossfade runs
void main() {
  float sceneLog = texture2D(tMeter, vec2(0.5)).a;
  float target = clamp(log2(uKey) - sceneLog, uSlot.x + uSlot.y, uSlot.x + uSlot.z);
  target = mix(uSlot.x + uOutdoor, target, uIndoor);
  vec4 old = texture2D(tPrevious, vec2(0.5));
  // Start at the art-directed slot exposure; a first meter reading must also glide into view.
  float start = uSlot.x + uOutdoor * (1.0 - uIndoor);
  float ev = uValid > 0.5 ? log2(max(old.r, 0.00001)) : start;
  float drive = uValid > 0.5 ? old.g : start;
  float tau = uFast > 0.5 ? uTimes.w : (target > drive ? uTimes.x : uTimes.y);
  float a = exp(-uDt / tau), b = exp(-uDt / uTimes.z);
  float coupling = abs(tau - uTimes.z) < 0.000001 ? a * uDt / tau : tau * (a - b) / (tau - uTimes.z);
  float next = target + (ev - target) * b + (drive - target) * coupling;
  // Local adaptation's global reference must glide too, rather than sampling a target that jumps on ticks.
  float reference = uValid > 0.5 ? old.b : sceneLog, referenceDrive = uValid > 0.5 ? old.a : sceneLog;
  float nextReference = sceneLog + (reference - sceneLog) * b + (referenceDrive - sceneLog) * coupling;
  gl_FragColor = vec4(exp2(next), target + (drive - target) * a, nextReference, sceneLog + (referenceDrive - sceneLog) * a);
  // A slot crossfade is the light changing on purpose, in the frame the meter reads (this frame's): the exposure is its
  // target every frame, with no glide behind it. The garden's target is the fade's own exposure (lighting_slots.js
  // fadeExposure, in exposed space); a room's is the meter's, so the picture's mean moves from one key to the other.
  // Glides lagging a fade pumped the picture (75 -> 22 -> 90 in the garden, 175 -> 130 -> 155 in the living room).
  if (uFade > 0.5) gl_FragColor = vec4(exp2(target), target, sceneLog, sceneLog);
}`;

// fading(): a slot crossfade steps this frame (lightmap_slots.js stepping, its last frame included): the meter reads every
// frame and the exposure is its target
export function createBakedAutoExposure({ renderer, lighting, getSlot, getTier = () => query.get('tier') ?? 'laptop', query = new URLSearchParams(location.search), settings = {}, fading = () => false }) {
  if (!autoExposureEnabled(query)) return null;
  const { outputPass, camera, indoorWeight } = lighting;
  if (!outputPass || !camera) return null;
  const meter = target(METER.width, METER.height), reduced = target(METER.width / 4, METER.height / 4);
  // The 1x1 states integrate tiny per-frame steps: in half floats (ulp 0.001 near EV 1) the glide stalled 0.02-0.06 EV
  // short of its target (more at high refresh rates), direction-dependent. Full floats where they are renderable.
  const stateType = renderer.extensions?.has?.('EXT_color_buffer_float') ? THREE.FloatType : THREE.HalfFloatType;
  const history = [target(1, 1, stateType), target(1, 1, stateType)], meterHistory = [target(1, 1, stateType), target(1, 1, stateType)];
  const params = { ...ADAPTATION, ...settings };
  const metering = material(meterShader, { tScene: { value: null } });
  const reduction = material(reduceShader, { tMeter: { value: meter.texture } });
  const filtering = material(filterShader, {
    tMeter: { value: reduced.texture }, tPrevious: { value: null }, uDt: { value: 0 }, uValid: { value: 0 },
    uFast: { value: 0 }, uTau: { value: params.meterTau }, uDeadBand: { value: params.deadBand }, uFade: { value: 0 },
  });
  const adaptation = material(adaptShader, {
    tMeter: { value: null }, tPrevious: { value: null }, uSlot: { value: new THREE.Vector3() },
    uDt: { value: 0 }, uValid: { value: 0 }, uFast: { value: 0 }, uIndoor: { value: 0 },
    uTimes: { value: new THREE.Vector4() }, uKey: { value: 1 }, uOutdoor: { value: 0 }, uFade: { value: 0 },
  });
  const quad = new FullScreenQuad(null), position = new THREE.Vector3(), rotation = new THREE.Quaternion();
  let valid = false, meterValid = false, meterIndex = 0, index = 0, frame = 0, elapsed = 0, meterElapsed = 0, fast = 0, disposed = false;
  // three's fallback (?agx=three) samples the same absolute exposure as Blender AgX. Its own exposure cancels here.
  // The camera's white balance (white_balance.js, outputPass.whiteBalance) follows in scene-linear, as in agx.js.
  const originalShader = outputPass.material.fragmentShader, originalRender = outputPass.render;
  const exposureUniform = { value: null }, whiteBalanceUniform = { value: IDENTITY };
  outputPass.uniforms.tAutoExposure = exposureUniform; outputPass.uniforms.uWhiteBalance = whiteBalanceUniform;
  outputPass.material.fragmentShader = (originalShader.includes('precision highp sampler2D;') ? originalShader : originalShader.replace('precision highp float;', 'precision highp float;\n\t\tprecision highp sampler2D;'))   // RawShaderMaterial: samplers default to lowp on mobile GPUs, which would quantise HDR and depth
    .replace('void main() {', 'uniform sampler2D tAutoExposure;\nuniform mat3 uWhiteBalance;\nvoid main() {')
    .replace('// tone mapping', 'gl_FragColor.rgb *= texture2D(tAutoExposure, vec2(0.5)).r / max(toneMappingExposure, 0.00001);\ngl_FragColor.rgb = uWhiteBalance * gl_FragColor.rgb;\n// tone mapping');
  outputPass.material.needsUpdate = true;
  const local = createLocalAdaptation({ renderer, lighting, query, getTier });
  const draw = (into, mat) => { quad.material = mat; renderer.setRenderTarget(into); quad.render(renderer); };
  const reset = () => { valid = meterValid = false; frame = 0; elapsed = meterElapsed = fast = 0; local?.reset(); };
  const render = function(r, writeBuffer, readBuffer, ...rest) {
    const moved = valid && (position.distanceToSquared(camera.position) > 1.5 ** 2 || Math.abs(rotation.dot(camera.quaternion)) < 0.95);
    if (moved) fast = params.fastDuration;
    position.copy(camera.position); rotation.copy(camera.quaternion);
    const dt = elapsed; elapsed = 0; meterElapsed += dt;
    const fade = +!!fading();
    const saved = renderer.getRenderTarget();
    try {
      if (!valid || moved || fade || frame % METER.interval === 0) {
        metering.uniforms.tScene.value = readBuffer.texture;
        draw(meter, metering); draw(reduced, reduction);
        const f = filtering.uniforms;
        f.tPrevious.value = meterValid ? meterHistory[meterIndex].texture : reduced.texture;
        // A teleport restarts the meter history at the new view. Easing the old view's reading out (tau 0.2 s) made
        // the fast exposure glide chase a stale target and overshoot (0.4 EV into the primary bath at dusk).
        f.uDt.value = meterElapsed; f.uValid.value = +(meterValid && !moved); f.uFast.value = +moved;
        f.uTau.value = moved ? params.teleport : params.meterTau; f.uDeadBand.value = params.deadBand; f.uFade.value = fade;
        meterIndex = 1 - meterIndex; draw(meterHistory[meterIndex], filtering);
        meterElapsed = 0; meterValid = true;
      }
      const mood = getSlot(), u = adaptation.uniforms;
      u.uSlot.value.set(mood.ev, mood.autoExposure.minEV, mood.autoExposure.maxEV);
      u.uIndoor.value = indoorWeight(camera.position);
      u.uDt.value = dt; u.uValid.value = +valid; u.uFast.value = +(fast > 0);
      u.uTimes.value.set(params.brighten, params.darken, params.ease, params.teleport); u.uKey.value = params.key ?? mood.autoExposure.key;   // settings.key: a test's override
      u.uOutdoor.value = mood.autoExposure.outdoor ?? 0; u.uFade.value = fade;
      u.tMeter.value = meterHistory[meterIndex].texture;
      u.tPrevious.value = valid ? history[index].texture : reduced.texture;
      index = 1 - index; draw(history[index], adaptation);
      outputPass.autoExposureTexture = exposureUniform.value = history[index].texture;
      whiteBalanceUniform.value = outputPass.whiteBalance ?? IDENTITY;
      local?.render(readBuffer, history[index].texture, dt, u.uIndoor.value, moved, outputPass.renderToScreen ? null : writeBuffer);
      valid = true; frame++; fast = Math.max(0, fast - dt);
    } finally { renderer.setRenderTarget(saved); }
    return originalRender.call(this, r, writeBuffer, readBuffer, ...rest);
  };
  outputPass.render = render;
  renderer.domElement.addEventListener('webglcontextrestored', reset);
  const api = {
    settings: params, local,
    update(dt) { if (Number.isFinite(dt)) elapsed += Math.max(0, dt); }, reset,
    get texture() { return outputPass.autoExposureTexture; },
    // Validation readback only (1x1 RGBA16F): exposure = (2^EV, drive EV, local reference log, its drive);
    // meter = (raw log, previous raw, filtered, dead-banded held).
    get debugTargets() { return { exposure: history[index], meter: meterHistory[meterIndex] }; },
    dispose() {
      if (disposed) return; disposed = true;
      renderer.domElement.removeEventListener('webglcontextrestored', reset);
      local?.dispose();
      outputPass.render = originalRender; outputPass.material.fragmentShader = originalShader; outputPass.material.needsUpdate = true;
      delete outputPass.autoExposureTexture; delete outputPass.uniforms.tAutoExposure; delete outputPass.uniforms.uWhiteBalance;
      for (const t of [meter, reduced, ...history, ...meterHistory]) t.dispose();
      for (const m of [metering, reduction, filtering, adaptation]) m.dispose();
      quad.dispose(); if (lighting.autoExposure === api) delete lighting.autoExposure;
    },
  };
  lighting.autoExposure = api;
  return api;
}
