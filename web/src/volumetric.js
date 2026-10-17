// Morning mist in linear HDR, after contact AO and before OutputPass. Quarter-res single scattering; the sun's
// readable PCSS depth is reused (one jittered lookup per step, not the surface shader's 40-tap PCSS filter).
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { insideGLSL } from './plan.js';

// Distances in metres, extinction in m^-1; indoor is a fraction of outdoor density, skyColor is linear radiance.
// Nominal 1440p: 640x360x24 = 5.53 M shadow reads + a four-tap full-res resolve, about 1.2-1.6 ms on M3 (unmeasured).
export const MIST = { resolution: 0.25, steps: 24, maxDistance: 40, density: 0.012, heightFalloff: 0.6, indoor: 0.03,
  albedo: 0.9, g: 0.68, sunStrength: 1, skyStrength: 0.5, skyColor: [0.42, 0.52, 0.72], temporal: 0.9, depthSigma: 0.025 };
const vertex = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const march = `
varying vec2 vUv;
layout(location = 0) out vec4 fog;
layout(location = 1) out vec4 guide;
uniform sampler2D tDepth, tSun, tHistory, tGuide;
uniform mat4 uInvProj, uWorld, uShadow;
uniform vec3 uEye, uToSun, uSun, uSky;
uniform vec4 uDensity; // extinction at ground, height falloff, indoor fraction, scattering albedo
uniform float uNear, uFar, uMaxDistance, uG, uFrame, uSunTexel, uBias, uTemporal, uDepthSigma;
uniform int uSteps;
${insideGLSL('outsideHouse')}
float sunLit(vec3 p, vec2 offset) {
  vec4 sc = uShadow * vec4(p, 1.0); vec3 c = sc.xyz / sc.w;
  if (any(lessThan(c, vec3(0.0))) || any(greaterThan(c, vec3(1.0)))) return 1.0;
  return step(c.z + uBias, texture(tSun, c.xy + offset).r);
}
void main() {
  float d = texture(tDepth, vUv).r;
  vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); vec3 p = v.xyz / v.w;
  vec3 viewRay = normalize(p), ray = normalize(mat3(uWorld) * viewRay);
  float start = uNear / max(-viewRay.z, 0.001), end = min(length(p), uMaxDistance);
  float ds = max(0.0, end - start) / float(uSteps);
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy + uFrame * 5.588238, vec2(0.06711056, 0.00583715))));
  float angle = jitter * 6.2831853; vec2 offset = vec2(cos(angle), sin(angle)) * uSunTexel;
  // ray points eye -> sample; incoming sun travels the opposite way. Their scattering angle is ray dot toSun.
  float mu = dot(ray, uToSun), gg = uG * uG;
  float phase = (1.0 - gg) / (12.5663706 * pow(max(1.0 + gg - 2.0 * uG * mu, 0.001), 1.5));
  vec3 scatter = vec3(0.0); float T = 1.0;
  for (int i = 0; i < 32; i++) {
    if (i >= uSteps) break;
    vec3 q = uEye + ray * (start + (float(i) + jitter) * ds);
    float rho = uDensity.x * exp(-max(q.y, 0.0) * uDensity.y) * mix(uDensity.z, 1.0, outsideHouse(vec2(q.x, -q.z)));
    float stepT = exp(-rho * ds);
    scatter += T * (1.0 - stepT) * uDensity.w * (uSky + uSun * (phase * sunLit(q, offset)));
    T *= stepT;
  }
  // A stationary-camera history: no reprojection or moving-camera trails. The CPU drops it whenever the camera, sun,
  // PCSS map or parameters change, and depth rejects moving silhouettes, so nothing else can make it stale. While the
  // view holds still the history weight ramps up (1/2, 2/3, ... up to params.temporal) and the per-frame jitter of the
  // single shadow tap per step averages out; a per-pixel colour clamp here would keep that noise flickering.
  float z = d > 0.999999 ? uFar : -p.z;
  if (uTemporal > 0.0) {
    float oldZ = texture(tGuide, vUv).r;
    if (abs(z - oldZ) < max(0.03, z * uDepthSigma)) {
      vec4 old = texture(tHistory, vUv);
      scatter = mix(scatter, old.rgb, uTemporal);
      T = mix(T, old.a, uTemporal);
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

export class VolumetricPass extends Pass {
  constructor({ camera, sun, shadow, slot, depth, parameters = {} }) {
    super(); this.camera = camera; this.sun = sun; this.shadow = shadow; this.depth = depth;
    this.params = { ...MIST, skyColor: slot?.skyColor ?? MIST.skyColor, ...parameters };
    this.frame = 0; this.still = 0; this.valid = false; this.lastWorld = new THREE.Matrix4(); this.lastProj = new THREE.Matrix4();
    this.lastSun = new THREE.Vector3(); this.lastLight = new THREE.Vector3(); this.sunTarget = new THREE.Vector3(); this.paramKey = ''; this.shadowVersion = -1;
    const uniforms = { tDepth: { value: null }, tSun: shadow.uniforms.uSunDepth, tHistory: { value: null }, tGuide: { value: null },
      uInvProj: { value: new THREE.Matrix4() }, uWorld: { value: new THREE.Matrix4() }, uShadow: { value: shadow.matrix },
      uEye: { value: new THREE.Vector3() }, uToSun: { value: new THREE.Vector3() }, uSun: { value: new THREE.Vector3() }, uSky: { value: new THREE.Vector3() },
      uDensity: { value: new THREE.Vector4() }, uNear: { value: 0.05 }, uFar: { value: 300 }, uMaxDistance: { value: 40 }, uG: { value: 0.68 },
      uFrame: { value: 0 }, uSunTexel: shadow.uniforms.uSunTexel, uBias: { value: 0 }, uTemporal: { value: 0 }, uDepthSigma: { value: 0.025 }, uSteps: { value: 24 } };
    this.march = new THREE.ShaderMaterial({ name: 'Mist march', uniforms, vertexShader: vertex, fragmentShader: march, glslVersion: THREE.GLSL3,
      depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.NoBlending });
    this.composite = new THREE.ShaderMaterial({ name: 'Mist bilateral', uniforms: { tColor: { value: null }, tDepth: { value: null }, tFog: { value: null }, tGuide: { value: null },
      uLowSize: { value: new THREE.Vector2() }, uNear: uniforms.uNear, uFar: uniforms.uFar, uDepthSigma: uniforms.uDepthSigma },
      vertexShader: vertex, fragmentShader: upsample, depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.NoBlending });
    this.blend = new THREE.ShaderMaterial({ name: 'Mist bilateral blend', uniforms: this.composite.uniforms, defines: { MIST_BLEND: '' },
      vertexShader: vertex, fragmentShader: upsample, depthTest: false, depthWrite: false, toneMapped: false, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.SrcAlphaFactor,
      blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
    const target = () => new THREE.WebGLRenderTarget(1, 1, { count: 2, type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.current = target(); this.history = target(); this.quad = new FullScreenQuad(null);
  }
  setSize(w, h) {
    this.width = w; this.height = h;
    const scale = this.params.resolution >= 0.5 ? 0.5 : 0.25, lw = Math.max(1, Math.ceil(w * scale)), lh = Math.max(1, Math.ceil(h * scale));
    this.current.setSize(lw, lh); this.history.setSize(lw, lh); this.composite.uniforms.uLowSize.value.set(lw, lh); this.valid = false;
  }
  reset() { this.valid = false; }
  render(renderer, writeBuffer, readBuffer) {
    const p = this.params, u = this.march.uniforms, c = this.camera, sun = this.sun;
    const scale = p.resolution >= 0.5 ? 0.5 : 0.25;
    if (this.width !== readBuffer.width || this.height !== readBuffer.height || this.current.width !== Math.ceil(readBuffer.width * scale) || this.current.height !== Math.ceil(readBuffer.height * scale)) this.setSize(readBuffer.width, readBuffer.height);
    u.tDepth.value = this.depth ? this.depth(readBuffer) : readBuffer.depthTexture;
    u.tHistory.value = this.history.textures[0]; u.tGuide.value = this.history.textures[1];
    u.uInvProj.value.copy(c.projectionMatrixInverse); u.uWorld.value.copy(c.matrixWorld); u.uEye.value.setFromMatrixPosition(c.matrixWorld);
    sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
    u.uToSun.value.setFromMatrixPosition(sun.matrixWorld).sub(this.sunTarget.setFromMatrixPosition(sun.target.matrixWorld)).normalize();
    u.uSun.value.set(sun.color.r, sun.color.g, sun.color.b).multiplyScalar(sun.visible ? sun.intensity * p.sunStrength : 0);
    u.uSky.value.fromArray(p.skyColor).multiplyScalar(p.skyStrength);
    u.uDensity.value.set(Math.max(0, p.density), Math.max(0, p.heightFalloff), THREE.MathUtils.clamp(p.indoor, 0, 1), THREE.MathUtils.clamp(p.albedo, 0, 1));
    u.uNear.value = c.near; u.uFar.value = c.far; u.uMaxDistance.value = Math.max(c.near, p.maxDistance); u.uG.value = THREE.MathUtils.clamp(p.g, -0.9, 0.9);
    u.uSteps.value = THREE.MathUtils.clamp(Math.round(p.steps), 16, 32); u.uBias.value = sun.shadow.bias; u.uDepthSigma.value = Math.max(0.001, p.depthSigma);
    const key = JSON.stringify(p), stable = this.valid && this.lastWorld.equals(c.matrixWorld) && this.lastProj.equals(c.projectionMatrix)
      && this.lastSun.equals(u.uToSun.value) && this.lastLight.equals(u.uSun.value) && this.shadowVersion === this.shadow.version && this.paramKey === key;
    this.still = stable ? this.still + 1 : 0;
    u.uTemporal.value = Math.min(THREE.MathUtils.clamp(p.temporal, 0, 0.95), this.still / (this.still + 1)); u.uFrame.value = (this.frame = (this.frame + 1) % 64);
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
    [this.current, this.history] = [this.history, this.current]; this.valid = true;
    this.lastWorld.copy(c.matrixWorld); this.lastProj.copy(c.projectionMatrix); this.lastSun.copy(u.uToSun.value); this.lastLight.copy(u.uSun.value);
    this.shadowVersion = this.shadow.version; this.paramKey = key;
  }
  dispose() { this.march.dispose(); this.composite.dispose(); this.blend.dispose(); this.current.dispose(); this.history.dispose(); this.quad.dispose(); }
}
