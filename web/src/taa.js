// ?taa[=0.75]: jittered linear-HDR scene/SSR/GTAO at reduced resolution, temporal reconstruction before output/grade.
// Camera-only motion: depth reprojection plus YCoCg variance clipping/reactivity for pets, movables and leaf sway.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { taaBias, TAA_MAPS } from './shaders/compose.js';
import { isBaked, setBakedTaa } from './shaders/baked_material.js';

const vertex = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const color = `
vec3 compress(vec3 c) { c = max(c, vec3(0.0)); return c / (1.0 + max(c.r, max(c.g, c.b))); }
vec3 expand(vec3 c) { c = max(c, vec3(0.0)); return min(c / max(1.0 - max(c.r, max(c.g, c.b)), 0.0000167), vec3(60000.0)); }
vec3 ycocg(vec3 c) { return vec3(dot(c, vec3(0.25, 0.5, 0.25)), (c.r - c.b) * 0.5, (-c.r + 2.0 * c.g - c.b) * 0.25); }
vec3 rgb(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
`;
const resolve = `
uniform sampler2D tCurrent, tDepth, tHistory;
uniform mat4 uInvVP, uView, uPrevVP, uPrevView;
uniform vec3 uEye; uniform vec2 uSize, uFullSize, uJitter;
uniform float uValid, uFeedback, uGamma, uDepthAbsolute, uDepthRelative, uReactive;
varying vec2 vUv;
${color}
// Catmull-Rom weights for a texel-centre grid at p (in texels).
void catmull(vec2 p, out vec2 b, out vec2 w0, out vec2 w12, out vec2 w3, out vec2 o12) {
  b = floor(p - 0.5) + 0.5; vec2 f = p - b;
  w0 = f * (-0.5 + f * (1.0 - 0.5 * f)); vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f)); w3 = f * f * (-0.5 + 0.5 * f); w12 = w1 + w2; o12 = w2 / w12;
}
// Upsampling of the current frame: the middle two taps on each axis merge into one bilinear fetch (9 rather than 16).
vec3 reconstruct(vec2 uv) {
  vec2 b, w0, w12, w3, o12; catmull(uv * uSize, b, w0, w12, w3, o12);
  vec2 p0 = (b - 1.0) / uSize, p12 = (b + o12) / uSize, p3 = (b + 2.0) / uSize;
  return texture2D(tCurrent, p0).rgb * w0.x * w0.y + texture2D(tCurrent, vec2(p12.x, p0.y)).rgb * w12.x * w0.y
    + texture2D(tCurrent, vec2(p3.x, p0.y)).rgb * w3.x * w0.y + texture2D(tCurrent, vec2(p0.x, p12.y)).rgb * w0.x * w12.y
    + texture2D(tCurrent, p12).rgb * w12.x * w12.y + texture2D(tCurrent, vec2(p3.x, p12.y)).rgb * w3.x * w12.y
    + texture2D(tCurrent, vec2(p0.x, p3.y)).rgb * w0.x * w3.y + texture2D(tCurrent, vec2(p12.x, p3.y)).rgb * w12.x * w3.y
    + texture2D(tCurrent, p3).rgb * w3.x * w3.y;
}
// History resampling: 5-tap Catmull-Rom (corners dropped, renormalised). Bilinear here blurs a little more every moving frame.
vec3 historyAt(vec2 uv) {
  vec2 b, w0, w12, w3, o12; catmull(uv * uFullSize, b, w0, w12, w3, o12);
  vec2 p0 = (b - 1.0) / uFullSize, p12 = (b + o12) / uFullSize, p3 = (b + 2.0) / uFullSize;
  vec3 c = texture2D(tHistory, vec2(p12.x, p0.y)).rgb * (w12.x * w0.y) + texture2D(tHistory, vec2(p0.x, p12.y)).rgb * (w0.x * w12.y)
    + texture2D(tHistory, p12).rgb * (w12.x * w12.y) + texture2D(tHistory, vec2(p3.x, p12.y)).rgb * (w3.x * w12.y)
    + texture2D(tHistory, vec2(p12.x, p3.y)).rgb * (w12.x * w3.y);
  return max(c / (w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y), vec3(0.0));
}
vec4 worldAt(vec2 uv, float d) { vec4 p = uInvVP * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return p / p.w; }
const float SKY = 1e9;
void main() {
  vec2 uv = clamp(vUv + uJitter, 0.5 / uSize, 1.0 - 0.5 / uSize), texel = 1.0 / uSize;
  vec2 center = (floor(uv * uSize) + 0.5) / uSize;
  vec3 lo = vec3(1e10), hi = vec3(-1e10), mean = vec3(0.0), moment = vec3(0.0), rgbLo = vec3(1e10), rgbHi = vec3(0.0);
  // One 3x3 pass: colour statistics, plus the nearest depth (camera velocity is dilated from it) and the farthest.
  float near = 1.0, far = 0.0; vec2 nearUv = center, farUv = center;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 q = clamp(center + vec2(float(x), float(y)) * texel, 0.5 * texel, 1.0 - 0.5 * texel);
    vec3 r = compress(texture2D(tCurrent, q).rgb), c = ycocg(r);
    rgbLo = min(rgbLo, r); rgbHi = max(rgbHi, r);
    lo = min(lo, c); hi = max(hi, c); mean += c; moment += c * c;
    float z = texture2D(tDepth, q).r;
    if (z < near) { near = z; nearUv = q; }
    if (z > far) { far = z; farUv = q; }
  }
  mean /= 9.0; vec3 sigma = sqrt(max(moment / 9.0 - mean * mean, vec3(0.0)));
  vec3 current = clamp(ycocg(compress(reconstruct(uv))), lo, hi);
  float centerDepth = texture2D(tDepth, center).r;
  bool sky = near >= 0.9999999, skyFar = far >= 0.9999999; vec4 world = worldAt(nearUv, near);
  vec4 old = uPrevVP * (sky ? vec4(world.xyz - uEye, 0.0) : world);
  vec2 oldUv = old.xy / max(old.w, 0.000001) * 0.5 + 0.5;
  vec2 velocity = nearUv - uJitter - oldUv, historyUv = vUv - velocity;
  // Expected previous view depth of the nearest and farthest surfaces around this pixel (the sky counts as SKY metres).
  float expected = sky ? SKY : -(uPrevView * world).z;
  float expectedFar = skyFar ? SKY : -(uPrevView * worldAt(farUv, far)).z;
  float depth = centerDepth >= 0.9999999 ? 0.0 : -(uView * worldAt(center, centerDepth)).z;
  // History alpha is the view depth in metres of the pixel's own centre (0 = sky), fetched nearest: no interpolation across
  // edges. With the jitter the centre moves inside the neighbourhood from frame to frame, so a still pixel on a silhouette
  // stores the near surface one frame and the far one the next. History is therefore kept when the stored depth lies
  // anywhere within the neighbourhood's depth range; outside it the surface was disoccluded.
  vec3 history = historyAt(historyUv);
  float previousDepth = texture2D(tHistory, (floor(historyUv * uFullSize) + 0.5) / uFullSize).a;
  previousDepth = previousDepth > 0.0 ? previousDepth : SKY;
  float slope = sky ? 0.0 : min(2.0 * max(abs(dFdx(expected)), abs(dFdy(expected))), 0.05 * expected);
  float tolerance = uDepthAbsolute + uDepthRelative * expected + slope, toleranceFar = uDepthAbsolute + uDepthRelative * expectedFar;
  bool inside = all(greaterThanEqual(historyUv, 0.5 / uFullSize)) && all(lessThanEqual(historyUv, 1.0 - 0.5 / uFullSize));
  bool accepted = uValid > 0.5 && old.w > 0.0 && inside && (sky || (old.z >= -old.w && old.z <= old.w))
    && previousDepth >= expected - tolerance && previousDepth <= expectedFar + toleranceFar;
  vec3 h = ycocg(compress(history));
  lo = max(lo, mean - uGamma * sigma); hi = min(hi, mean + uGamma * sigma);
  vec3 mid = (lo + hi) * 0.5, extent = max((hi - lo) * 0.5, vec3(0.0001)), delta = h - mid;
  vec3 distance = abs(delta / extent); float outside = max(distance.x, max(distance.y, distance.z));
  h = mid + delta / max(1.0, outside);
  float weight = mix(uFeedback, 0.72, clamp(length(velocity * uFullSize) / 32.0, 0.0, 1.0));
  // Reactivity for things without motion vectors (pets, movables, leaf sway): history far outside the clip box is stale,
  // so it also loses weight. Aliasing and noise keep the history inside the box and are left to accumulate.
  weight *= 1.0 - uReactive * smoothstep(2.0, 6.0, outside);
  gl_FragColor = vec4(expand(clamp(rgb(mix(current, h, accepted ? weight : 0.0)), rgbLo, rgbHi)), depth);
}`;
const sharpen = `
uniform sampler2D tResolved; uniform vec2 uTexel; uniform float uSharpen; varying vec2 vUv;
${color}
void main() {
  vec3 c = compress(texture2D(tResolved, vUv).rgb);
  vec3 n = compress(texture2D(tResolved, vUv + vec2(0.0, uTexel.y)).rgb), s = compress(texture2D(tResolved, vUv - vec2(0.0, uTexel.y)).rgb);
  vec3 e = compress(texture2D(tResolved, vUv + vec2(uTexel.x, 0.0)).rgb), w = compress(texture2D(tResolved, vUv - vec2(uTexel.x, 0.0)).rgb);
  vec3 lo = min(c, min(min(n, s), min(e, w))), hi = max(c, max(max(n, s), max(e, w)));
  // CAS-like contrast-adaptive negative cross weight; compressed radiance keeps HDR highlights finite.
  vec3 amp = sqrt(clamp(min(lo, 1.0 - hi) / max(hi, vec3(0.0001)), 0.0, 1.0));
  vec3 k = -amp * clamp(uSharpen, 0.0, 1.0) * 0.125;
  vec3 result = (c + k * (n + s + e + w)) / (1.0 + 4.0 * k);
  gl_FragColor = vec4(expand(clamp(result, lo, hi)), 1.0);
}`;

const halton = (i, base) => { let f = 1, r = 0; for (; i > 0; i = Math.floor(i / base)) { f /= base; r += f * (i % base); } return r; };
const scaleOf = value => Number.isFinite(+value) && +value > 0 ? THREE.MathUtils.clamp(+value, 0.5, 1) : 0.75;
// the legacy raster materials' wrapper: the composed shader's own pass (shaders/compose.js taaBias)
function textureBias(sh, bias) {
  if (sh.uniforms.uTaaLodBias) return;   // a material clone may already carry this hook
  sh.fragmentShader = taaBias(sh.fragmentShader); sh.uniforms.uTaaLodBias = bias;
}
const material = (fragmentShader, uniforms) => new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader, uniforms, depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.NoBlending });
const target = (name, depth = false) => {
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: depth }); rt.texture.name = name;
  if (depth) rt.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  return rt;
};
// nodes of the scene visited per frame for the TAA texture bias (updateTextures); the scene has ~16k
const TAA_SLICE = 400;
// ?taascan=1: the whole scene every frame, as before (A/B: tools/ab_check.mjs)
const FULL_SCAN = new URLSearchParams(globalThis.location?.search ?? '').get('taascan') === '1';
export const taaQuality = (preset, query) => query.has('taa') ? { ...preset, msaa: 0, smaa: false } : preset;

class TAAPass extends Pass {
  constructor(renderer, camera, passes, value, options) {
    super(); this.camera = camera; this.scale = scaleOf(value); this.frame = 0; this.valid = false; this.lastTime = 0;
    this.noise = { value: 0 };   // frame index (0-15) for screen-space noise that should integrate under TAA (main.js hands in the PCSS uniform)
    // mipBias: added to the internal scale's bias (log2 scale) on every surface map: the accumulated jittered frames
    // resolve finer texture detail than one frame's mip selection assumes. With sharpen 0.55, TAA at full scale keeps
    // MSAA's texture detail (wood grain, cane weave) without its foliage dither and shadow speckle (gate-c stills, 2026-10-24).
    this.settings = { feedback: 0.92, gamma: 1.25, sharpen: 0.55, depthAbsolute: 0.02, depthRelative: 0.01, reactive: 0.5, mipBias: -0.5, ...options };
    this.scene = passes[0].scene; this.lodBias = { value: Math.log2(this.scale) + this.settings.mipBias }; this.materials = new Map(); this.seen = new WeakMap(); this.drawing = false;
    this.internal = new EffectComposer(renderer, target('TAA scene', true)); this.internal.setPixelRatio(1); this.internal.renderToScreen = false;
    for (const pass of passes) this.internal.addPass(pass);
    this.history = [target('TAA history 0'), target('TAA history 1')]; this.index = 0;
    this.projection = new THREE.Matrix4(); this.inverseProjection = new THREE.Matrix4(); this.previousProjection = new THREE.Matrix4();
    this.position = new THREE.Vector3(); this.previousPosition = new THREE.Vector3(); this.rotation = new THREE.Quaternion(); this.previousRotation = new THREE.Quaternion();
    const uniforms = { tCurrent: { value: null }, tDepth: { value: null }, tHistory: { value: null }, uInvVP: { value: new THREE.Matrix4() }, uView: { value: new THREE.Matrix4() },
      uPrevVP: { value: new THREE.Matrix4() }, uPrevView: { value: new THREE.Matrix4() }, uEye: { value: this.position }, uSize: { value: new THREE.Vector2() }, uFullSize: { value: new THREE.Vector2() },
      uJitter: { value: new THREE.Vector2() }, uValid: { value: 0 }, uFeedback: { value: 0 }, uGamma: { value: 0 }, uDepthAbsolute: { value: 0 }, uDepthRelative: { value: 0 }, uReactive: { value: 0 } };
    this.resolve = material(resolve, uniforms);
    this.sharpen = material(sharpen, { tResolved: { value: null }, uTexel: { value: new THREE.Vector2() }, uSharpen: { value: 0 } }); this.quad = new FullScreenQuad(null);
  }
  reset() { this.valid = false; this.frame = 0; }
  setScale(value) { this.scale = scaleOf(value); this.lodBias.value = Math.log2(this.scale) + this.settings.mipBias; this.setSize(this.width, this.height); this.reset(); }
  // The LOD bias on every surface map: a flag of the composed baked shader (shaders/baked_material.js setBakedTaa),
  // and for the legacy raster materials (no baked shader: the fallback) a wrapper of their hook.
  patchMaterial(m) {
    const e = this.materials.get(m);
    if (e) { if (!e.baked || isBaked(m)) return; this.materials.delete(m); }   // its baked shader went (the legacy fallback)
    let maps = false; for (let i = 0; i < TAA_MAPS.length && !maps; i++) maps = !!m[TAA_MAPS[i]];
    if (!maps) return;
    if (isBaked(m)) { this.materials.set(m, { baked: true }); m.needsUpdate = true; return; }
    const prev = m.onBeforeCompile, key = m.customProgramCacheKey, sourceKey = key?.call(m) ?? '', bias = this.lodBias;
    const hook = function(sh, renderer) { prev?.call(this, sh, renderer); textureBias(sh, bias); };
    const programKey = () => sourceKey + '|taa-lod-bias-v1';
    this.materials.set(m, { prev, key, hook, programKey }); m.onBeforeCompile = hook; m.customProgramCacheKey = programKey; m.needsUpdate = true;
  }
  visitMaterials(o) {
    const m = o.material; if (!m) return;
    if (Array.isArray(m)) { for (const x of m) if (x) this.patchMaterial(x); } else this.patchMaterial(m);
  }
  // Every material of the scene, now.
  patchTextures() {
    setBakedTaa(this.lodBias);
    this.scene.traverse(o => this.visitMaterials(o));
    this.walk = null;
  }
  // Per frame. Visiting the whole scene (~16k nodes) cost ~10 ms of CPU per frame on a 2.1 GHz Xeon, so it runs whole only
  // on the first frame and after invalidateTextures() (quality and time changes, the legacy fallback). Every draw of the
  // scene inside this pass checks its material first (drawn(): a new material, or one whose version moved, e.g. a map
  // that arrived late), so whatever the camera sees is patched before its first draw as before; and a slice of the scene
  // per frame (TAA_SLICE nodes, all of it within about a second) reaches what only other views draw (the mirrors).
  updateTextures() {
    if (this.texturesDirty !== false || FULL_SCAN) { this.texturesDirty = false; this.patchTextures(); return; }
    setBakedTaa(this.lodBias);
    const walk = this.walk ??= [this.scene];
    for (let n = 0; n < TAA_SLICE; n++) {
      const o = walk.pop();
      if (!o) { walk.push(this.scene); break; }
      this.visitMaterials(o);
      const c = o.children; for (let i = c.length - 1; i >= 0; i--) walk.push(c[i]);
    }
  }
  invalidateTextures() { this.texturesDirty = true; }
  // renderBufferDirect of the scene while this pass draws it (createTAA): the material, before its program is chosen
  drawn(material) {
    if (this.seen.get(material) === material.version) return;
    this.patchMaterial(material); this.seen.set(material, material.version);
  }
  setSize(w, h) {
    this.width = Math.max(1, Math.round(w)); this.height = Math.max(1, Math.round(h));
    const iw = Math.max(1, Math.round(this.width * this.scale)), ih = Math.max(1, Math.round(this.height * this.scale));
    const changed = this.history[0].width !== this.width || this.history[0].height !== this.height || this.internal.renderTarget1.width !== iw || this.internal.renderTarget1.height !== ih;
    for (const rt of this.history) rt.setSize(this.width, this.height);
    this.internal.setSize(iw, ih); this.resolve.uniforms.uSize.value.set(iw, ih); this.resolve.uniforms.uFullSize.value.set(this.width, this.height);
    this.sharpen.uniforms.uTexel.value.set(1 / this.width, 1 / this.height); if (changed) this.reset();
  }
  render(renderer, writeBuffer) {
    const cam = this.camera, u = this.resolve.uniforms, savedTarget = renderer.getRenderTarget(), autoClear = renderer.autoClear, now = performance.now();
    cam.updateWorldMatrix(true, false); cam.getWorldPosition(this.position); cam.getWorldQuaternion(this.rotation);
    this.projection.copy(cam.projectionMatrix); this.inverseProjection.copy(cam.projectionMatrixInverse);
    if (now - this.lastTime > 200 || this.position.distanceToSquared(this.previousPosition) > 1 || Math.abs(this.rotation.dot(this.previousRotation)) < 0.9763
      || this.projection.elements.some((v, i) => Math.abs(v - this.previousProjection.elements[i]) > 0.000001)) this.reset();
    const iw = this.internal.renderTarget1.width, ih = this.internal.renderTarget1.height, j = this.frame % 16 + 1;
    u.uJitter.value.set((halton(j, 2) - 0.5) / iw, (halton(j, 3) - 0.5) / ih);
    try {
      // Offset clip XY by +jitter * clip W, without touching camera.view or accumulating projection offsets.
      const e = cam.projectionMatrix.elements;
      for (let k = 0; k < 4; k++) { e[k * 4] += 2 * u.uJitter.value.x * e[k * 4 + 3]; e[k * 4 + 1] += 2 * u.uJitter.value.y * e[k * 4 + 3]; }
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      u.uInvVP.value.multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse); u.uView.value.copy(cam.matrixWorldInverse);
      this.noise.value = this.frame % 16;
      this.updateTextures();   // baked clones, quality swaps and late pets join (updateTextures and drawn say when)
      // GTAO swaps colour; the scene's depth remains on the buffer that RenderPass started with.
      u.tDepth.value = this.internal.readBuffer.depthTexture;
      this.drawing = true; try { this.internal.render(); } finally { this.drawing = false; }
      u.tCurrent.value = this.internal.readBuffer.texture;
      const next = this.history[this.index], previous = this.history[1 - this.index]; u.tHistory.value = previous.texture; u.uValid.value = +this.valid;
      if (!this.valid) renderer.initRenderTarget(previous);
      for (const key of ['feedback', 'gamma', 'depthAbsolute', 'depthRelative', 'reactive']) u['u' + key[0].toUpperCase() + key.slice(1)].value = this.settings[key];
      this.quad.material = this.resolve; renderer.setRenderTarget(next); this.quad.render(renderer);
      this.sharpen.uniforms.tResolved.value = next.texture; this.sharpen.uniforms.uSharpen.value = this.settings.sharpen;
      this.quad.material = this.sharpen; renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.quad.render(renderer);
      u.uPrevVP.value.multiplyMatrices(this.projection, cam.matrixWorldInverse); u.uPrevView.value.copy(cam.matrixWorldInverse);
      this.previousProjection.copy(this.projection); this.previousPosition.copy(this.position); this.previousRotation.copy(this.rotation);
      this.valid = true; this.index = 1 - this.index; this.frame++; this.lastTime = now;
    } catch (err) { this.reset(); throw err; }
    finally { cam.projectionMatrix.copy(this.projection); cam.projectionMatrixInverse.copy(this.inverseProjection); renderer.autoClear = autoClear; renderer.setRenderTarget(savedTarget); }
  }
  dispose() {
    this.lodBias.value = 0;
    setBakedTaa(null);
    for (const [m, { baked, prev, key, hook, programKey }] of this.materials) {
      if (baked) { m.needsUpdate = true; continue; }
      if (m.onBeforeCompile === hook) m.onBeforeCompile = prev;
      if (m.customProgramCacheKey === programKey) m.customProgramCacheKey = key;
      m.needsUpdate = true;
    }
    this.materials.clear(); this.internal.dispose(); for (const rt of this.history) rt.dispose(); this.resolve.dispose(); this.sharpen.dispose(); this.quad.dispose();
  }
}

export function createTAA(renderer, camera, lighting, value = '', options = {}) {
  const composer = lighting.composer, output = composer.passes.findIndex(p => p.isOutputPass);
  if (output < 1 || !composer.passes[0].isRenderPass) throw new Error('TAA needs a linear HDR chain ending in OutputPass');
  const pass = new TAAPass(renderer, camera, composer.passes.splice(0, output), value, options); composer.insertPass(pass, 0);
  // Quality switches keep SSR/GTAO presets but never restore multisampling or SMAA. Full-resolution buffers stay single-sample.
  const quality = lighting.setQuality.bind(lighting), time = lighting.applyTime.bind(lighting);
  lighting.setQuality = next => { quality({ ...next, msaa: 0, smaa: false }); pass.reset(); pass.invalidateTextures(); };
  lighting.applyTime = async (...args) => { pass.reset(); pass.invalidateTextures(); try { return await time(...args); } finally { pass.reset(); pass.invalidateTextures(); } };
  // the scene's own draws inside the pass: each material is checked for the texture bias before its program is chosen
  const direct = renderer.renderBufferDirect;
  if (direct) renderer.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    if (pass.drawing && scene === pass.scene && material) pass.drawn(material);
    return direct.call(this, camera, scene, geometry, material, object, group);
  };
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) { if (rt.samples) { rt.samples = 0; rt.dispose(); } }
  for (const p of composer.passes) if (p instanceof SMAAPass) p.enabled = false;
  const reset = () => pass.reset(), dispose = composer.dispose.bind(composer);
  renderer.domElement.addEventListener('webglcontextrestored', reset);
  composer.dispose = () => { renderer.domElement.removeEventListener('webglcontextrestored', reset); if (direct) renderer.renderBufferDirect = direct; pass.dispose(); dispose(); };
  return pass;
}
