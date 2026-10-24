// Low-resolution, joint bilateral local adaptation, fused into the pre-AgX output shader.
// Three tiny draws/frame; four nearest guided taps at output, no full-resolution HDR intermediate or readback.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { autoExposureEnabled } from './auto_exposure_policy.js';

// What it corrects, as a real-estate photo's exposure blend: only what is far brighter than the room (a window, the garden
// through a door, a sun patch): `strength` of how far a region's log lies above the frame's log mean past `knee` stops, at
// most maxEV. The room itself (within knee of its mean) and its shadows are left as lit (`lift` 0). The first version
// worked both ways (strength 0.5 of every difference): it lifted every dark region and halved the room's contrast, the
// visitor's rooms spanning 1.8 stops from p10 to p90 against the listing photos' 3.3 (2026-10-24; gate (c) brightness p10).
export const LOCAL_ADAPTATION = { scale: 16, maxWidth: 192, strength: 0.5, maxEV: 1.5, knee: 1.5, lift: 0, temporal: 0.16, gateTau: 0.25, lumaSigma: 1.5, depthRelative: 0.03, depthAbsolute: 0.04, mesopic: 0 };
export const localAdaptationEnabled = (query, tier = 'laptop') => autoExposureEnabled(query) && query.get('localadapt') !== '0' && !query.has('fast') && tier !== 'mobile';
export function localMapSize(width, height, settings = LOCAL_ADAPTATION) {
  const scale = Math.max(settings.scale, width / settings.maxWidth);
  return [Math.max(1, Math.ceil(width / scale)), Math.max(1, Math.ceil(height / scale))];
}
export function localExposureEV(globalLog, localLog, strength = LOCAL_ADAPTATION.strength, maxEV = LOCAL_ADAPTATION.maxEV, knee = LOCAL_ADAPTATION.knee, lift = LOCAL_ADAPTATION.lift) {
  const d = localLog - globalLog;
  return -Math.min(maxEV, Math.max(0, strength * (d - knee))) + Math.min(maxEV, Math.max(0, lift * (-d - knee)));
}
// The same compact support in the low-res blur and full-res upsample: samples across an edge get zero weight.
export function localGuideWeight(log, depth, otherLog, otherDepth, settings = LOCAL_ADAPTATION) {
  const l = Math.abs(log - otherLog) / settings.lumaSigma;
  const z = Math.abs(depth - otherDepth) / (settings.depthAbsolute + settings.depthRelative * Math.min(depth, otherDepth));
  return l >= 2 || z >= 2 ? 0 : Math.max(0, 1 - l * l / 4) ** 2 * Math.max(0, 1 - z * z / 4) ** 2;
}

const vertexShader = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const target = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
const material = (fragmentShader, uniforms) => new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.NoBlending });
const guideGLSL = `
uniform vec2 uLocalNearFar, uLocalDepthTolerance;
uniform float uLocalLumaSigma;
float localLog(vec3 c) { return log2(clamp(dot(max(c, vec3(0.0)), vec3(0.2126, 0.7152, 0.0722)), 0.00001, 60000.0)); }
float localDepth(float d) { return uLocalNearFar.x * uLocalNearFar.y / max(uLocalNearFar.y - d * (uLocalNearFar.y - uLocalNearFar.x), 0.000001); }
float localGuide(float l, float z, float otherL, float otherZ) {
  vec2 distance = vec2(abs(l - otherL) / uLocalLumaSigma, abs(z - otherZ) / (uLocalDepthTolerance.x + uLocalDepthTolerance.y * min(z, otherZ)));
  vec2 w = max(vec2(0.0), 1.0 - distance * distance * 0.25);
  return w.x * w.x * w.y * w.y;
}`;
const sampleShader = `
uniform sampler2D tScene, tLocalDepth; uniform vec2 uLocalJitter, uLocalSize; varying vec2 vUv;
${guideGLSL}
void main() {
  // Log-average a 4x4 grid across the whole map cell: one point per cell flickers as a frame or highlight crosses it.
  float l = 0.0;
  for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++)
    l += localLog(texture2D(tScene, vUv + (vec2(float(x), float(y)) - 1.5) * 0.25 / uLocalSize).rgb);
  l *= 0.0625;
  float d = texture2D(tLocalDepth, vUv + uLocalJitter).r;
  // RGBA: adaptation log, linear view depth, unfiltered luminance guide, unused.
  gl_FragColor = vec4(l, localDepth(d), l, 1.0);
}`;
const blurShader = `
uniform sampler2D tLocalInput, tLocalRaw, tLocalPrevious;
uniform vec2 uLocalSize, uDirection, uLocalJitter;
uniform mat4 uLocalInvProjection, uLocalWorld, uLocalPrevVP, uLocalPrevView;
uniform float uLocalDt, uLocalTau, uLocalValid, uTemporal;
varying vec2 vUv;
${guideGLSL}
void main() {
  vec4 center = texture2D(tLocalRaw, vUv);
  float sum = 0.0, weight = 0.0;
  for (int i = -2; i <= 2; i++) {
    vec2 uv = vUv + uDirection * float(i) / uLocalSize;
    vec4 guide = texture2D(tLocalRaw, uv);
    float w = (3.0 - abs(float(i))) * localGuide(center.b, center.g, guide.b, guide.g);
    sum += texture2D(tLocalInput, uv).r * w; weight += w;
  }
  float adapted = sum / max(weight, 0.00001);
  if (uTemporal > 0.5 && uLocalValid > 0.5) {
    vec4 ray = uLocalInvProjection * vec4((vUv + uLocalJitter) * 2.0 - 1.0, 1.0, 1.0);
    vec4 world = uLocalWorld * vec4(ray.xyz * (center.g / -ray.z), 1.0);
    vec4 clip = uLocalPrevVP * world;
    vec2 uv = clip.xy / max(clip.w, 0.000001) * 0.5 + 0.5;
    vec4 old = texture2D(tLocalPrevious, uv);
    float expected = -(uLocalPrevView * world).z;
    // Nearest history with explicit depth/luminance rejection; never drag an old window across a wall.
    bool inside = clip.w > 0.0 && all(greaterThanEqual(uv, 0.5 / uLocalSize)) && all(lessThanEqual(uv, 1.0 - 0.5 / uLocalSize));
    // A stationary lamp/slot change must adapt over time even when luminance changes by several stops.
    // Under motion, restore the luminance guard as the reprojected footprint moves across map cells.
    float motion = smoothstep(0.1, 1.0, length((vUv - uv) * uLocalSize));
    float accept = inside ? localGuide(center.b, expected, mix(center.b, old.b, motion), old.g) : 0.0;
    adapted = mix(adapted, old.r, exp(-uLocalDt / uLocalTau) * accept);
  }
  gl_FragColor = vec4(adapted, center.gba);
}`;
const outputGLSL = `
uniform sampler2D tLocalMap, tLocalDepth, tLocalGlobal;
uniform vec2 uLocalSize, uLocalJitter;
uniform float uLocalStrength, uLocalMaxEV, uLocalKnee, uLocalLift, uLocalMesopic;
${guideGLSL}
vec3 localAdapt(vec3 c, vec2 uv) {
  if (uLocalStrength <= 0.00001) return c;
  float l = localLog(c), z = localDepth(texture2D(tLocalDepth, uv + uLocalJitter).r);
  vec2 p = uv * uLocalSize - 0.5, base = floor(p), f = fract(p);
  float sum = 0.0, weight = 0.0;
  // Joint bilateral upsample, using the FULL-res pixel as guide. Linear sampling would halo thin frames.
  for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++) {
    vec2 offset = vec2(float(x), float(y));
    vec4 s = texture2D(tLocalMap, (base + offset + 0.5) / uLocalSize);
    vec2 wxy = mix(1.0 - f, f, offset);
    float w = wxy.x * wxy.y * localGuide(l, z, s.b, s.g);
    sum += s.r * w; weight += w;
  }
  // A frame narrower than one map cell may have no matching sample. Its own log is halo-free fallback.
  float adapted = (sum + l * 0.0001) / (weight + 0.0001);
  float globalLog = texture2D(tLocalGlobal, vec2(0.5)).b;
  // localExposureEV: only what lies past the knee above the room is pulled down; shadows lift only with uLocalLift
  float d = adapted - globalLog;
  float ev = -clamp(uLocalStrength * (d - uLocalKnee), 0.0, uLocalMaxEV) + clamp(uLocalLift * (-d - uLocalKnee), 0.0, uLocalMaxEV);
  vec3 result = c * exp2(ev);
  // Optional mesopic hint in very dim scene-linear regions; disabled by default.
  float dusk = uLocalMesopic * (1.0 - smoothstep(-9.0, -5.0, adapted));
  float lum = dot(result, vec3(0.2126, 0.7152, 0.0722));
  return mix(result, vec3(lum), 0.12 * dusk) * mix(vec3(1.0), vec3(0.97, 1.0, 1.04), dusk);
}`;

export function createLocalAdaptation({ renderer, lighting, query, getTier = () => 'laptop', settings = {} }) {
  // Keep the object on the mobile tier so J can enable it later, but allocate/draw nothing while disabled.
  if (!autoExposureEnabled(query) || query.get('localadapt') === '0') return null;
  const { camera, outputPass } = lighting, params = { ...LOCAL_ADAPTATION, ...settings };
  const shared = {
    tLocalMap: { value: null }, tLocalDepth: { value: null }, tLocalGlobal: { value: null },
    uLocalSize: { value: new THREE.Vector2(1, 1) }, uLocalJitter: { value: new THREE.Vector2() },
    uLocalNearFar: { value: new THREE.Vector2(camera.near, camera.far) },
    uLocalDepthTolerance: { value: new THREE.Vector2(params.depthAbsolute, params.depthRelative) },
    uLocalLumaSigma: { value: params.lumaSigma }, uLocalStrength: { value: 0 }, uLocalMaxEV: { value: params.maxEV },
    uLocalKnee: { value: params.knee }, uLocalLift: { value: 0 }, uLocalMesopic: { value: params.mesopic },
  };
  let resources = null, depthCopy = null, valid = false, index = 0, disposed = false, gate = 0, sceneDepth = null;
  const previousVP = new THREE.Matrix4(), previousView = new THREE.Matrix4(), inverseProjection = new THREE.Matrix4(), zeroJitter = new THREE.Vector2();
  // OutputPass's readBuffer depth can be a post-process attachment. Capture RenderPass's actual scene depth
  // before ping-pong swaps (also works when TAA moves that same pass into its internal composer).
  const scenePass = (lighting.taa?.internal ?? lighting.composer)?.passes.find(p => p.isRenderPass);
  const sceneRender = scenePass?.render;
  const captureDepth = function(r, write, read, ...rest) {
    sceneDepth = read.depthTexture;
    return sceneRender.call(this, r, write, read, ...rest);
  };
  if (scenePass) scenePass.render = captureDepth;
  const patches = [];
  const patch = (mat, blender = false) => {
    if (disposed) return;
    const source = mat.fragmentShader;
    const anchor = blender ? 'vec4 t = texture2D(tDiffuse, vUv);' : 'gl_FragColor.rgb *= texture2D(tAutoExposure';
    if (!source.includes(anchor)) throw new Error('Local adaptation: output shader anchor changed');
    // Insert after precision declarations in RawShaderMaterial, via the main anchor in both paths.
    mat.fragmentShader = source.replace('void main() {', outputGLSL + '\nvoid main() {')
      .replace(anchor, blender ? anchor + '\n  t.rgb = localAdapt(t.rgb, vUv);' : 'gl_FragColor.rgb = localAdapt(gl_FragColor.rgb, vUv);\n' + anchor);
    Object.assign(mat.uniforms, shared); mat.needsUpdate = true; patches.push({ mat, source });
  };
  patch(outputPass.material);
  // The promise may resolve later; disposal prevents a stale callback from modifying a replacement output.
  outputPass.blenderAgX?.then(mat => patch(mat, true));
  const allocate = () => {
    const raw = target(), horizontal = target(), history = [target(), target()];
    const sample = material(sampleShader, { ...shared, tScene: { value: null } });
    const blur = material(blurShader, {
      ...shared, tLocalInput: { value: null }, tLocalRaw: { value: raw.texture }, tLocalPrevious: { value: null },
      uDirection: { value: new THREE.Vector2() }, uLocalInvProjection: { value: inverseProjection }, uLocalWorld: { value: camera.matrixWorld }, uLocalPrevVP: { value: previousVP }, uLocalPrevView: { value: previousView },
      uLocalDt: { value: 0 }, uLocalTau: { value: params.temporal }, uLocalValid: { value: 0 }, uTemporal: { value: 0 },
    });
    return { raw, horizontal, history, sample, blur, quad: new FullScreenQuad(null) };
  };
  return {
    settings: params,
    reset() { valid = false; },
    render(read, global, dt, indoor, moved = false, outputTarget = null) {
      const taa = lighting.taa;
      let depth = taa?.resolve.uniforms.tDepth.value ?? sceneDepth;
      const enabled = localAdaptationEnabled(query, getTier()) && depth;
      if (!enabled) { shared.uLocalStrength.value = 0; gate = 0; valid = false; return; }
      // Outdoors the correction is exactly zero, while the indoor boundary and initial appearance ease in.
      gate += (indoor - gate) * -Math.expm1(-dt / params.gateTau);
      shared.uLocalStrength.value = indoor === 0 && gate < 0.0001 ? 0 : params.strength * gate; shared.uLocalLift.value = params.lift * gate;
      if (shared.uLocalStrength.value <= 0.00001) { valid = false; return; }
      // After GTAO's swap the output may draw into the original scene target. Sampling an attached depth
      // texture there is a WebGL feedback loop even with depth writes off. Blit resolved depth only in that
      // case; no colour copy or scene draw. TAA/onscreen output normally needs no copy.
      if (outputTarget?.depthTexture === depth) {
        if (!depthCopy) {
          depthCopy = new THREE.WebGLRenderTarget(1, 1, { format: THREE.RedFormat, type: THREE.UnsignedByteType,
            minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
          depthCopy.depthTexture = new THREE.DepthTexture(1, 1, depth.type);
        }
        if (depthCopy.depthTexture.type !== depth.type || depthCopy.depthTexture.format !== depth.format) {
          depthCopy.dispose(); depthCopy.depthTexture.type = depth.type; depthCopy.depthTexture.format = depth.format;
        }
        depthCopy.setSize(depth.image.width, depth.image.height);
        renderer.initRenderTarget(depthCopy);
        renderer.copyTextureToTexture(depth, depthCopy.depthTexture);
        depth = depthCopy.depthTexture;
      }
      resources ??= allocate();
      const { raw, horizontal, history, sample, blur, quad } = resources;
      const [w, h] = localMapSize(read.width, read.height, params);
      if (raw.width !== w || raw.height !== h) {
        for (const rt of [raw, horizontal, ...history]) rt.setSize(w, h);
        shared.uLocalSize.value.set(w, h); valid = false;
      }
      shared.tLocalDepth.value = depth; shared.tLocalGlobal.value = global;
      shared.uLocalNearFar.value.set(camera.near, camera.far);
      shared.uLocalDepthTolerance.value.set(params.depthAbsolute, params.depthRelative);
      shared.uLocalLumaSigma.value = params.lumaSigma; shared.uLocalMaxEV.value = params.maxEV; shared.uLocalKnee.value = params.knee;
      shared.uLocalMesopic.value = params.mesopic;
      shared.uLocalJitter.value.copy(taa?.resolve.uniforms.uJitter.value ?? zeroJitter);
      if (taa) inverseProjection.multiplyMatrices(camera.matrixWorldInverse, taa.resolve.uniforms.uInvVP.value);
      else inverseProjection.copy(camera.projectionMatrixInverse);
      const draw = (into, mat) => { quad.material = mat; renderer.setRenderTarget(into); quad.render(renderer); };
      sample.uniforms.tScene.value = read.texture; draw(raw, sample);
      const u = blur.uniforms;
      u.tLocalPrevious.value = valid ? history[index].texture : raw.texture;
      u.uLocalDt.value = dt; u.uLocalTau.value = params.temporal; u.uLocalValid.value = +(valid && !moved);
      u.tLocalInput.value = raw.texture; u.uDirection.value.set(1, 0); u.uTemporal.value = 0;
      draw(horizontal, blur);
      u.tLocalInput.value = horizontal.texture; u.uDirection.value.set(0, 1); u.uTemporal.value = 1;
      index = 1 - index; draw(history[index], blur); shared.tLocalMap.value = history[index].texture;
      previousVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); previousView.copy(camera.matrixWorldInverse);
      valid = true;
    },
    dispose() {
      if (disposed) return; disposed = true;
      if (scenePass?.render === captureDepth) scenePass.render = sceneRender;
      for (const { mat, source } of patches) {
        mat.fragmentShader = source; for (const key of Object.keys(shared)) delete mat.uniforms[key]; mat.needsUpdate = true;
      }
      if (resources) {
        const { raw, horizontal, history, sample, blur, quad } = resources;
        for (const rt of [raw, horizontal, ...history]) rt.dispose();
        sample.dispose(); blur.dispose(); quad.dispose();
      }
      depthCopy?.dispose();
    },
  };
}
