// Volumetric light in linear HDR: sunbeams through the windows (dust in the rooms), shafts through the palms, the ground
// mist of a morning after rain and the haze that gives the garden depth. Runs in the scene chain after GTAO and before
// OutputPass (inside TAA's internal chain when TAA is on), so auto exposure meters it and the tone curve maps it.
//
// Single scattering of the live sun through the readable PCSS sun depth (lightmap.js createSunPCSS: glass casts no sun
// shadow there, alpha-cut leaves do), one jittered tap per step, and of the sky outdoors. A reduced-resolution ray march
// (half resolution on hq) with a reprojected history (the walk stays clean: the history follows the camera, depth rejects
// what was hidden), then a depth-aware upsample over the frame. The media per time slot and their crossfade:
// volumetric_slots.js. Sky light indoors is left out on purpose (see there); outdoors it is the slot sky's mean.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { insideGLSL } from './plan.js';
import { ALBEDO, MEDIA_KEYS, PHASE, mediumFor, skyAmbient, historyWeight } from './volumetric_slots.js';
import { frameClock, staleSince } from './frame_clock.js';
import { SLOTS } from './lighting_slots.js';

// resolution: march size per frame axis (0.5 or 0.25); steps per ray (16-64); maxDistance in metres (the lot is ~45 m
// across); roof: the height under which a point inside the outline is in the house (ceiling 2.44 m); historyTime: time
// constant (s) of the reprojected history while the view moves or the medium changes, historyStillTime once it holds
// still (volumetric_slots.js historyWeight; 0.16 s and 0.41 s are the 0.9 and 0.96 a frame they replace, at 60 Hz);
// depthSigma: relative depth tolerance of the upsample and of the history (x2). sunStrength / skyStrength scale the two
// light sources (1 = physical).
export const VOLUME = { resolution: 0.5, steps: 32, maxDistance: 48, roof: 2.6, historyTime: 0.16, historyStillTime: 0.41,
  depthSigma: 0.025, sunStrength: 1, skyStrength: 1 };
const vertex = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const march = `
varying vec2 vUv;
layout(location = 0) out vec4 fog;
layout(location = 1) out vec4 guide;
uniform sampler2D tDepth, tSun, tHistory, tGuide;
uniform mat4 uInvProj, uWorld, uShadow, uPrevVP, uPrevView;
uniform vec3 uEye, uToSun, uSun, uSky;
uniform vec4 uOut;    // outdoor haze (1/m), ground mist (1/m), mist falloff (1/m), roof height (m)
uniform vec4 uDust;   // indoor dust (1/m), dust albedo, mist albedo
uniform vec3 uPhaseMist, uPhaseDust;   // forward lobe g, broad lobe g, forward weight
uniform vec2 uLowSize;
uniform float uNear, uFar, uMaxDistance, uFrame, uSunTexel, uBias, uHistory, uDepthSigma;
uniform int uSteps, uDebug;
${insideGLSL('outsideHouse')}
float hg(float mu, float g) { float gg = g * g; return (1.0 - gg) / (12.5663706 * pow(max(1.0 + gg - 2.0 * g * mu, 0.0001), 1.5)); }
float phase2(float mu, vec3 p) { return p.z * hg(mu, p.x) + (1.0 - p.z) * hg(mu, p.y); }
// sc: the sample in the sun's shadow clip space (orthographic: w = 1)
float sunLit(vec4 sc, vec2 offset) {
  vec3 c = sc.xyz / sc.w;
  if (any(lessThan(c, vec3(0.0))) || any(greaterThan(c, vec3(1.0)))) return 1.0;
  return step(c.z + uBias, texture(tSun, c.xy + offset).r);
}
void main() {
  float d = texture(tDepth, vUv).r;
  bool sky = d >= 0.999999;
  vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); vec3 pv = v.xyz / v.w;
  vec3 viewRay = normalize(pv), ray = normalize(mat3(uWorld) * viewRay);
  float start = uNear / max(-viewRay.z, 0.001), end = sky ? uMaxDistance : min(length(pv), uMaxDistance);
  float ds = max(0.0, end - start) / float(uSteps);
  // Interleaved gradient noise, a new pattern each frame: where on each step the sample sits, and the shadow tap's
  // rotation (turned by the golden angle every step). The history integrates both.
  float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy + uFrame * 5.588238, vec2(0.06711056, 0.00583715))));
  float angle = noise * 6.2831853; vec2 offset = vec2(cos(angle), sin(angle)) * uSunTexel;
  const mat2 turn = mat2(-0.7373688, 0.6754903, -0.6754903, -0.7373688);
  // The ray points eye -> sample, the sunlight travels the other way: their scattering angle's cosine is ray . toSun.
  float mu = dot(ray, uToSun);
  vec3 sunMist = uSun * (phase2(mu, uPhaseMist) * uDust.z), skyMist = uSky * uDust.z;
  vec3 sunDust = uSun * (phase2(mu, uPhaseDust) * uDust.y * uDust.x);
  vec3 scatter = vec3(0.0), debug = vec3(0.0); float T = 1.0;
  // the sample and its shadow coordinate advance linearly along the ray
  vec3 q = uEye + ray * (start + noise * ds), dq = ray * ds;
  vec4 sc = uShadow * vec4(q, 1.0), dsc = uShadow * vec4(dq, 0.0);
  for (int i = 0; i < 64; i++) {
    if (i >= uSteps) break;
    float inside = (1.0 - outsideHouse(vec2(q.x, -q.z))) * step(q.y, uOut.w);
    float lit = sunLit(sc, offset); offset = turn * offset;
    // outdoors: haze and ground mist dim what lies behind and scatter the sun and the sky toward the eye
    float sigma = (uOut.x + uOut.y * exp(-max(q.y, 0.0) * uOut.z)) * (1.0 - inside), stepT = exp(-sigma * ds);
    // indoors: dust adds the sunbeam only (its extinction and its share of the room light cancel at this density)
    scatter += T * ((1.0 - stepT) * (skyMist + sunMist * lit) + (inside * ds * lit) * sunDust);
    T *= stepT; q += dq; sc += dsc;
    debug += vec3(inside * lit, inside, lit);
  }
  // ?shafts debug view (params.debug = 1): the fraction of each ray's samples inside x sunlit (r), inside (g), sunlit (b)
  if (uDebug == 1) { fog = vec4(debug / float(uSteps), 0.0); guide = vec4(sky ? uFar : -pv.z, 0.0, 0.0, 1.0); return; }
  // History: where this ray's surface was on screen last frame (a direction for the sky), kept where the depth stored
  // there is the depth expected from the previous eye (disocclusions and moving silhouettes take this frame alone).
  // Moving sun shadows (a door, a pet) and slot fades blend in over a few frames; no colour clamp: it would keep the
  // per-frame noise of the single shadow tap alive.
  float z = sky ? uFar : -pv.z;
  if (uHistory > 0.0) {
    vec3 world = (uWorld * vec4(pv, 1.0)).xyz;
    vec4 pc = sky ? uPrevVP * vec4(ray, 0.0) : uPrevVP * vec4(world, 1.0);
    float pz = sky ? uFar : -(uPrevView * vec4(world, 1.0)).z;
    vec2 puv = pc.xy / max(pc.w, 0.000001) * 0.5 + 0.5;
    if (pc.w > 0.0 && all(greaterThan(puv, vec2(0.0))) && all(lessThan(puv, vec2(1.0)))) {
      vec2 cell = puv * uLowSize - 0.5, lo = floor(cell), f = fract(cell);
      vec4 sum = vec4(0.0); float weights = 0.0, tolerance = max(0.05, pz * uDepthSigma * 2.0);
      for (int k = 0; k < 4; k++) {
        vec2 o = vec2(float(k % 2), float(k / 2)), uv = (lo + o + 0.5) / uLowSize, w2 = mix(1.0 - f, f, o);
        float w = w2.x * w2.y * step(abs(texture(tGuide, uv).r - pz), tolerance);
        sum += texture(tHistory, uv) * w; weights += w;
      }
      if (weights > 0.05) {
        vec4 old = sum / weights; float a = uHistory * clamp(weights * 2.0, 0.0, 1.0);
        scatter = mix(scatter, old.rgb, a); T = mix(T, old.a, a);
      }
    }
  }
  fog = vec4(scatter, clamp(T, 0.0, 1.0)); guide = vec4(z, 0.0, 0.0, 1.0);
}`;
const upsample = `
varying vec2 vUv;
uniform sampler2D tColor, tDepth, tFog, tGuide;
uniform vec2 uLowSize;
uniform float uNear, uFar, uDepthSigma;
float viewDepth(float d) { return uNear * uFar / (uFar - d * (uFar - uNear)); }
void main() {
  float z = viewDepth(texture2D(tDepth, vUv).r);
  vec2 cell = vUv * uLowSize - 0.5, lo = floor(cell), f = fract(cell);
  vec4 sum = vec4(0.0), nearest = vec4(0.0); float weights = 0.0, best = 1e20, nearestZ = z;
  for (int i = 0; i < 4; i++) {
    vec2 o = vec2(float(i % 2), float(i / 2)), uv = (lo + o + 0.5) / uLowSize;
    float sampleZ = texture2D(tGuide, uv).r, dz = abs(sampleZ - z);
    vec4 fog = texture2D(tFog, uv);
    if (dz < best) { best = dz; nearest = fog; nearestZ = sampleZ; }
    vec2 w = mix(1.0 - f, f, o);
    float weight = w.x * w.y * exp(-dz / max(0.03, z * uDepthSigma));
    sum += fog * weight; weights += weight;
  }
  vec4 mist = weights > 0.00001 ? sum / weights : nearest;
  // Thin foreground geometry may miss all four low-res rays. Shorten the nearest optical depth rather than
  // putting its whole background column of mist over that leaf or window frame.
  if (weights <= 0.00001) {
    float T = pow(max(mist.a, 0.00001), clamp(z / max(nearestZ, 0.001), 0.0, 1.0));
    mist.rgb *= (1.0 - T) / max(1.0 - mist.a, 0.00001); mist.a = T;
  }
  #ifdef MIST_BLEND
  gl_FragColor = mist;
  #else
  vec4 base = texture2D(tColor, vUv);
  gl_FragColor = vec4(base.rgb * mist.a + mist.rgb, base.a);
  #endif
}`;

// Records the depth texture the scene pass draws into (its readBuffer), with no draw of its own: after GTAO's swap the
// composer's readBuffer carries another target's depth. Inserted right before the RenderPass.
export class SceneDepthTap extends Pass {
  constructor() { super(); this.needsSwap = false; this.depth = null; }
  render(renderer, writeBuffer, readBuffer) { this.depth = readBuffer.depthTexture ?? null; }
}

// Where the passes go: the tap right before the scene's RenderPass, the volume after everything that renders in linear
// HDR (SSR, GTAO, contact) and before the OutputPass, or last in a chain without one (TAA's internal composer).
export function volumePlacement(passes) {
  const scene = passes.findIndex(p => p.isRenderPass), output = passes.findIndex(p => p.isOutputPass);
  if (scene < 0) throw new Error('volumetric pass: no RenderPass in the chain');
  return { tap: scene, volume: output < 0 ? passes.length + 1 : output + 1 };   // volume index after the tap is inserted
}
export function installVolume(composer, pass) {
  const at = volumePlacement(composer.passes);
  composer.insertPass(pass.tap, at.tap); composer.insertPass(pass, at.volume);
  return () => { composer.removePass(pass); composer.removePass(pass.tap); };
}

const ambientCache = new WeakMap();
// state(): { current, next, t, sky, nextSky }: the slot names, the crossfade fraction (0 without a fade) and the two
// slots' skies (equirectangular textures with their CPU data, HDRLoader layout).
export class VolumetricPass extends Pass {
  constructor({ camera, sun, shadow, state = () => ({ current: 'sunrise' }), renderer = null, parameters = {} }) {
    super(); this.camera = camera; this.sun = sun; this.shadow = shadow; this.state = state;
    this.params = { ...VOLUME, ...parameters };
    this.tap = new SceneDepthTap(); this.medium = mediumFor('sunrise');
    this.frame = 0; this.stillTime = 0; this.fading = false; this.lastT = null; this.valid = false; this.paramKey = '';
    this.lastEye = new THREE.Vector3(); this.lastQuat = new THREE.Quaternion(); this.quat = new THREE.Quaternion();
    this.sunTarget = new THREE.Vector3(); this.sky = new THREE.Vector3();
    const uniforms = { tDepth: { value: null }, tSun: shadow.uniforms.uSunDepth, tHistory: { value: null }, tGuide: { value: null },
      uInvProj: { value: new THREE.Matrix4() }, uWorld: { value: new THREE.Matrix4() }, uShadow: { value: shadow.matrix },
      uPrevVP: { value: new THREE.Matrix4() }, uPrevView: { value: new THREE.Matrix4() },
      uEye: { value: new THREE.Vector3() }, uToSun: { value: new THREE.Vector3() }, uSun: { value: new THREE.Vector3() }, uSky: { value: new THREE.Vector3() },
      uOut: { value: new THREE.Vector4() }, uDust: { value: new THREE.Vector4() },
      uPhaseMist: { value: new THREE.Vector3(...PHASE.mist) }, uPhaseDust: { value: new THREE.Vector3(...PHASE.dust) },
      uLowSize: { value: new THREE.Vector2(1, 1) }, uNear: { value: 0.05 }, uFar: { value: 300 }, uMaxDistance: { value: 48 },
      uFrame: { value: 0 }, uSunTexel: shadow.uniforms.uSunTexel, uBias: { value: 0 }, uHistory: { value: 0 }, uDepthSigma: { value: 0.025 }, uSteps: { value: 32 }, uDebug: { value: 0 } };
    this.march = new THREE.ShaderMaterial({ name: 'Volumetric march', uniforms, vertexShader: vertex, fragmentShader: march, glslVersion: THREE.GLSL3,
      depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.NoBlending });
    this.composite = new THREE.ShaderMaterial({ name: 'Volumetric upsample', uniforms: { tColor: { value: null }, tDepth: { value: null }, tFog: { value: null }, tGuide: { value: null },
      uLowSize: uniforms.uLowSize, uNear: uniforms.uNear, uFar: uniforms.uFar, uDepthSigma: uniforms.uDepthSigma },
      vertexShader: vertex, fragmentShader: upsample, depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.NoBlending });
    this.blend = new THREE.ShaderMaterial({ name: 'Volumetric upsample blend', uniforms: this.composite.uniforms, defines: { MIST_BLEND: '' },
      vertexShader: vertex, fragmentShader: upsample, depthTest: false, depthWrite: false, toneMapped: false, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.SrcAlphaFactor,
      blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
    const target = () => new THREE.WebGLRenderTarget(1, 1, { count: 2, type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.current = target(); this.history = target(); this.quad = new FullScreenQuad(null);
    this.restore = () => { this.valid = false; };
    this.renderer = renderer; renderer?.domElement?.addEventListener?.('webglcontextrestored', this.restore);
  }
  // re-enabling starts a fresh history (the frames in between were not followed)
  get enabled() { return this._enabled; }
  set enabled(on) { if (on && !this._enabled) this.valid = false; this._enabled = !!on; }
  get scale() { return this.params.resolution >= 0.5 ? 0.5 : 0.25; }
  setSize(w, h) {
    this.width = w; this.height = h;
    const lw = Math.max(1, Math.ceil(w * this.scale)), lh = Math.max(1, Math.ceil(h * this.scale));
    this.current.setSize(lw, lh); this.history.setSize(lw, lh); this.march.uniforms.uLowSize.value.set(lw, lh); this.valid = false;
  }
  reset() { this.valid = false; }
  // the medium (slot crossfade, then any explicit parameter: ?shafts tuning, shoot_vol.mjs) and the sky's ambient light
  update() {
    const p = this.params, s = this.state() ?? {}, t = s.next ? s.t ?? 0 : 0;
    const m = mediumFor(s.current, s.next, t);
    this.fading = !!s.next;   // the medium changes every frame of a crossfade: the history follows at its moving rate
    for (const key of MEDIA_KEYS) if (Number.isFinite(p[key])) m[key] = p[key];
    this.medium = m;
    // per sky texture (its slot's sun lights the ground under the mist), computed once from the CPU copy
    const ambient = (sky, name) => {
      if (!sky?.image?.data) return null;
      let a = ambientCache.get(sky);
      if (!a) { a = skyAmbient(sky.image, SLOTS[name] ?? SLOTS.sunrise, sky.type === THREE.HalfFloatType ? THREE.DataUtils.fromHalfFloat : undefined); if (a) ambientCache.set(sky, a); }
      return a;
    };
    const a = ambient(s.sky, s.current), b = s.next ? ambient(s.nextSky, s.next) ?? a : a;
    if (a) this.sky.set(...a.map((x, i) => x + ((b ?? a)[i] - x) * t)); else this.sky.set(0, 0, 0);
    return m;
  }
  render(renderer, writeBuffer, readBuffer) {
    const p = this.params, u = this.march.uniforms, c = this.camera, sun = this.sun, m = this.update();
    if (this.width !== readBuffer.width || this.height !== readBuffer.height || this.current.width !== Math.ceil(readBuffer.width * this.scale)) this.setSize(readBuffer.width, readBuffer.height);
    u.tDepth.value = this.tap.depth ?? readBuffer.depthTexture;
    u.tHistory.value = this.history.textures[0]; u.tGuide.value = this.history.textures[1];
    u.uInvProj.value.copy(c.projectionMatrixInverse); u.uWorld.value.copy(c.matrixWorld); u.uEye.value.setFromMatrixPosition(c.matrixWorld);
    sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
    u.uToSun.value.setFromMatrixPosition(sun.matrixWorld).sub(this.sunTarget.setFromMatrixPosition(sun.target.matrixWorld)).normalize();
    u.uSun.value.set(sun.color.r, sun.color.g, sun.color.b).multiplyScalar(sun.visible ? sun.intensity * p.sunStrength : 0);
    u.uSky.value.copy(this.sky).multiplyScalar(p.skyStrength);
    u.uOut.value.set(Math.max(0, m.haze), Math.max(0, m.mist), 1 / Math.max(0.1, m.mistHeight), p.roof);
    u.uDust.value.set(Math.max(0, m.dust), ALBEDO.dust, ALBEDO.mist, 0);
    u.uNear.value = c.near; u.uFar.value = c.far; u.uMaxDistance.value = Math.max(c.near, p.maxDistance);
    u.uSteps.value = THREE.MathUtils.clamp(Math.round(p.steps), 8, 64); u.uDebug.value = p.debug | 0; u.uBias.value = sun.shadow.bias; u.uDepthSigma.value = Math.max(0.001, p.depthSigma);
    // History: dropped on a resize, a re-enable, a context restore, a parameter change, a jump (teleport, fly-to cut:
    // > 2 m or > 60 degrees in one frame) and a stale history (a long frame, or frames this pass did not draw, on the
    // frame clock); followed through ordinary walking and turning, and through a slot crossfade, at a weight from the
    // frame's time step (historyWeight).
    c.getWorldQuaternion(this.quat);
    const key = JSON.stringify(p), jump = u.uEye.value.distanceToSquared(this.lastEye) > 4 || Math.abs(this.quat.dot(this.lastQuat)) < 0.866;
    if (key !== this.paramKey || jump || staleSince(this.lastT)) this.valid = false;
    const still = this.valid && u.uEye.value.distanceToSquared(this.lastEye) < 1e-8 && Math.abs(this.quat.dot(this.lastQuat)) > 1 - 1e-9, dt = frameClock.dt;
    u.uHistory.value = historyWeight({ valid: this.valid, dt, still, stillTime: this.stillTime, changing: this.fading }, p);
    this.stillTime = still && !this.fading ? this.stillTime + dt : 0;
    u.uFrame.value = (this.frame = (this.frame + 1) % 64);
    const auto = renderer.autoClear; renderer.autoClear = false;
    try {
      if (!this.valid) renderer.initRenderTarget(this.history);
      this.quad.material = this.march; renderer.setRenderTarget(this.current); this.quad.render(renderer);
      const v = this.composite.uniforms;
      v.tColor.value = readBuffer.texture; v.tDepth.value = u.tDepth.value; v.tFog.value = this.current.textures[0]; v.tGuide.value = this.current.textures[1];
      // After GTAO swaps, the original scene depth is attached to writeBuffer. Blend C*T+scatter into readBuffer
      // instead: no colour read, no extra copy and no sampling a depth texture attached to the destination FBO.
      // With GTAO off, normal compositing swaps to writeBuffer; the scene depth is still attached to readBuffer.
      this.needsSwap = this.renderToScreen || u.tDepth.value !== writeBuffer.depthTexture;
      this.quad.material = this.needsSwap ? this.composite : this.blend;
      renderer.setRenderTarget(this.renderToScreen ? null : this.needsSwap ? writeBuffer : readBuffer); this.quad.render(renderer);
    } finally { renderer.autoClear = auto; }
    [this.current, this.history] = [this.history, this.current]; this.valid = true; this.paramKey = key; this.lastT = frameClock.t;
    u.uPrevVP.value.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse); u.uPrevView.value.copy(c.matrixWorldInverse);
    this.lastEye.copy(u.uEye.value); this.lastQuat.copy(this.quat);
  }
  dispose() {
    this.renderer?.domElement?.removeEventListener?.('webglcontextrestored', this.restore);
    this.march.dispose(); this.composite.dispose(); this.blend.dispose(); this.current.dispose(); this.history.dispose(); this.quad.dispose();
  }
}
