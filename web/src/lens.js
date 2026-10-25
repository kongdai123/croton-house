// The live cinematic lens: depth of field with autofocus, a minimal bloom, natural vignetting and lateral chromatic
// aberration, on the linear HDR image after TAA's resolve and before the output pass (auto exposure, white balance, AgX),
// so exposure meters what the lens shows and the tone curve maps it. The parameters, the look and the JS references of
// every equation here: lens_policy.js (tools/test_lens.mjs). Photo mode has its own path-traced lens (photo.js); lens
// shift (an off-axis projection, the camera's): lens_shift.js.
//
// Depth of field: a half-resolution gather with separate near and far fields (Jimenez, "Next-generation post-processing
// in Call of Duty", 2014; the form of Unity's post-processing stack): the circle of confusion per pixel from the thin
// lens and TAA's depth, a prefilter that weights colour by blur (in-focus colour cannot bleed into the blur), a 43-tap
// gather over a rounded six-bladed aperture where a background sample counts only as far as the smaller of its own and
// the centre's blur reaches (no halo of a sharp foreground over the blur behind it) and a foreground sample spreads by its
// own blur over whatever lies behind, a small tent, and a full-resolution composite that keeps in-focus pixels sharp.
// Bright highlights keep their energy, so out of focus they open into discs of the aperture's shape. The aperture follows
// the focus distance (lens_policy.js apertureFor): rooms stay in deep focus.
// Autofocus: a weighted median of log depth over a small centre-weighted area (sky ignored), or the distance of what the
// visitor aims at (a pet, a door, an interactive piece), each through the policy (lens_policy.js focusFor: close subjects
// exactly, rooms deep), locked until the subject would be visibly soft, then pulled with
// a critically damped spring, all on the GPU (a 1 x 1 state, no readback); a camera jump snaps it. lens.control lets the
// film set the aperture and the focus itself, hold it, or track.
// Bloom: only the excess of what is far brighter than white and brighter than its surround (lamps, fire, sun glints; not a
// window) glows, through a short mip chain (13-tap downsample, tent upsample) about 1% of the frame height wide; a small
// share of the light it spreads past the source is added around it.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { LENS, SENSOR_HEIGHT_MM, sensorHeightMm, focalLengthMm, hyperfocal, apertureFor, bokehKernel, focusPattern } from './lens_policy.js';
import { lensShift } from './lens_shift.js';
import { frameClock } from './frame_clock.js';

const VERTEX = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const material = (fragment, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: fragment, uniforms, depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.NoBlending, ...extra });
const half = (w, h, opts = {}) => new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, ...opts });

// The thin lens in GLSL (lens_policy.js roomShare, apertureFor, cocRadius, clampCoc): signed blur radius as a fraction of
// the image height, at the aperture the focus distance s asks for.
const COMMON = `
precision highp sampler2D;
uniform float uNear, uFar, uFocal, uFStop, uFStopRooms, uSubjectNear, uSubjectFar, uSensor, uMaxCoc;
float linearDepth(float d) { return uNear * uFar / (uFar - d * (uFar - uNear)); }
float roomShare(float x) {
  float u = clamp((x - log2(uSubjectNear)) / (log2(uSubjectFar) - log2(uSubjectNear)), 0.0, 1.0);
  return u * u * (3.0 - 2.0 * u);
}
float apertureFor(float s) { return exp2(mix(log2(uFStop), log2(uFStopRooms), roomShare(log2(s)))); }
float cocOf(float z, float s) {
  float f = uFocal * 0.001, n = apertureFor(s); s = max(s, f * 1.01);
  float c = f * f / (n * (s - f)) * (z - s) / max(z, 1e-4);
  return clamp(c * 0.5 / (uSensor * 0.001), -uMaxCoc, uMaxCoc);
}
vec3 finite(vec3 c) { return all(greaterThanEqual(c, vec3(0.0))) && all(lessThan(c, vec3(60000.0))) ? c : vec3(0.0); }
`;
// Autofocus (lens_policy.js focusTarget, focusFor, afStep): state r = log2 focus distance (m), g = its velocity, b = how
// long the target has looked soft (0-1), a = the locked target (log2 m).
const autofocus = `${COMMON}
#define N ${LENS.afGrid * LENS.afGrid}
uniform sampler2D tDepth, tPrev;
uniform vec3 uPattern[N];   // x, y offsets from the centre (image heights), weight
uniform float uAspect, uDt, uSnap, uValid, uOverride, uDirect, uHold, uFallback, uSky, uOmega, uLockCoc, uLockTime;
// lens_policy.js focusFor: a close subject exactly, a room at the hyperfocal distance of the room aperture (uFallback)
float rooms(float x) { return x + (max(log2(uFallback), log2(uSubjectFar)) - x) * roomShare(x); }
varying vec2 vUv;
void main() {
  vec4 prev = texture2D(tPrev, vec2(0.5));
  bool fresh = uValid < 0.5 || uSnap > 0.5 || !(abs(prev.r) < 64.0) || !(abs(prev.a) < 64.0);
  if (uHold > 0.5 && !fresh) { gl_FragColor = prev; return; }
  float xs[N]; float ws[N]; float total = 0.0;
  for (int i = 0; i < N; i++) {
    vec2 uv = 0.5 + vec2(uPattern[i].x / uAspect, uPattern[i].y);
    float d = texture2D(tDepth, uv).r, z = linearDepth(d);
    xs[i] = log2(max(z, 1e-3)); ws[i] = d >= 0.99999 || z > uSky ? 0.0 : uPattern[i].z; total += ws[i];
  }
  float target = log2(uFallback);
  // what the visitor aims at, through the same policy (exactly when close, a room's focus when far); the film's set focus exactly
  if (uOverride > 0.0) target = uDirect > 0.5 ? log2(uOverride) : rooms(log2(uOverride));
  else if (total > 0.0) {
    // weighted median: the sample at which the weight below it first reaches half the total (ties broken by order)
    for (int i = 0; i < N; i++) {
      if (ws[i] <= 0.0) continue;
      float below = 0.0;
      for (int j = 0; j < N; j++) if (xs[j] < xs[i] || (xs[j] == xs[i] && j < i)) below += ws[j];
      if (below < total * 0.5 && below + ws[i] >= total * 0.5) { target = rooms(xs[i]); break; }
    }
  }
  float x = prev.r, v = prev.g, m = prev.b, lock = prev.a;
  if (fresh || uDirect > 0.5) { x = target; v = 0.0; m = 0.0; lock = target; }
  else {
    // the lock: it moves once a subject at the target would be visibly soft at the lock (blur diameter in mm), for a moment
    if (uLockCoc <= 0.0) lock = target;
    else {
      float soft = abs(cocOf(exp2(target), exp2(lock))) * 2.0 * uSensor > uLockCoc ? 1.0 : 0.0;
      m = soft + (m - soft) * exp(-uDt / uLockTime);
      if (m > 0.5) { lock = target; m = 0.0; }
    }
    float c1 = x - lock, c2 = v + uOmega * c1, e = exp(-uOmega * uDt);
    x = lock + (c1 + c2 * uDt) * e; v = (c2 - uOmega * (c1 + c2 * uDt)) * e;
  }
  gl_FragColor = vec4(x, v, m, lock);
}`;
// Prefilter: 2 x 2 full-resolution texels into one half-resolution texel: the blur layer's colour (weighted by blur, then
// faded out where in focus) with its signed blur, and the bloom's source: the excess over the threshold of what is also
// brighter than its surround (8 taps on a ring), capped (lens_policy.js bloomThreshold, bloomIsolation, bloomRing, glareMax).
const prefilter = `${COMMON}
uniform sampler2D tColor, tDepth, tFocus, tExposure;
uniform vec2 uTexel;        // full-resolution texel
uniform float uHalfTexel;   // half-resolution texel height
uniform float uDofOn, uBloomOn, uExposureOn, uExposure, uThreshold, uIsolation, uRing, uGlareMax, uAspect;
in vec2 vUv;
layout(location = 0) out vec4 dof;
layout(location = 1) out vec4 bloom;
float peak(vec3 c) { return max(c.r, max(c.g, c.b)); }
// lens_policy.js glowExcess
float glowExcess(float l, float around) {
  float t = max(uThreshold, uIsolation * around), knee = 0.5 * t, e = l - t;
  if (e <= 0.0) return 0.0;
  return min(e < knee ? e * e / (2.0 * knee) : e - 0.5 * knee, uGlareMax);
}
void main() {
  float s = uDofOn > 0.5 ? exp2(texture(tFocus, vec2(0.5)).r) : 1.0;
  vec2 o = uTexel * 0.5;
  vec2 uv0 = vUv + vec2(-o.x, -o.y), uv1 = vUv + vec2(o.x, -o.y), uv2 = vUv + vec2(-o.x, o.y), uv3 = vUv + vec2(o.x, o.y);
  vec3 c0 = finite(texture(tColor, uv0).rgb), c1 = finite(texture(tColor, uv1).rgb), c2 = finite(texture(tColor, uv2).rgb), c3 = finite(texture(tColor, uv3).rgb);
  bloom = vec4(0.0);
  if (uBloomOn > 0.5) {
    // exposed as the output pass will (the auto exposure's state from the last frame: 2^EV in red)
    float ex = uExposureOn > 0.5 ? texture(tExposure, vec2(0.5)).r : uExposure;
    vec3 b = (c0 + c1 + c2 + c3) * 0.25; float l = peak(b) * ex;
    if (l > uThreshold) {
      float around = 0.0;
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.785398 + 0.3927;
        around += peak(finite(texture(tColor, vUv + vec2(cos(a) / uAspect, sin(a)) * uRing).rgb));
      }
      bloom = vec4(b * (glowExcess(l, around * 0.125 * ex) / l), 1.0);
    }
  }
  if (uDofOn < 0.5) { dof = vec4(0.0); return; }
  float k0 = cocOf(linearDepth(texture(tDepth, uv0).r), s), k1 = cocOf(linearDepth(texture(tDepth, uv1).r), s);
  float k2 = cocOf(linearDepth(texture(tDepth, uv2).r), s), k3 = cocOf(linearDepth(texture(tDepth, uv3).r), s);
  float w0 = abs(k0) + 1e-6, w1 = abs(k1) + 1e-6, w2 = abs(k2) + 1e-6, w3 = abs(k3) + 1e-6;
  vec3 avg = (c0 * w0 + c1 * w1 + c2 * w2 + c3 * w3) / (w0 + w1 + w2 + w3);
  float lo = min(min(k0, k1), min(k2, k3)), hi = max(max(k0, k1), max(k2, k3)), coc = -lo > hi ? lo : hi;
  dof = vec4(avg * smoothstep(0.0, uHalfTexel * 2.0, abs(coc)), coc);
}`;
// Gather: the near and far fields over the aperture's kernel.
const gather = `
precision highp sampler2D;
#define SAMPLES ${LENS.samples}
uniform sampler2D tDof;
uniform vec2 uKernel[SAMPLES];
uniform float uMaxCoc, uAspect, uHalfTexel;
varying vec2 vUv;
void main() {
  vec4 s0 = texture2D(tDof, vUv);
  vec4 bg = vec4(0.0), fg = vec4(0.0);
  float margin = uHalfTexel;   // one texel of soft coverage: a wider margin blurred small circles past their size
  for (int i = 0; i < SAMPLES; i++) {
    vec2 disp = uKernel[i] * uMaxCoc; float dist = length(disp);
    vec4 s = texture2D(tDof, vUv + vec2(disp.x / uAspect, disp.y));
    // far: as far as the smaller of the two blurs reaches (a sharp foreground sample does not spread over the blur behind)
    float bw = clamp((max(min(s0.a, s.a), 0.0) - dist + margin) / margin, 0.0, 1.0);
    // near: by its own blur, over whatever is behind it
    float fw = clamp((-s.a - dist + margin) / margin, 0.0, 1.0) * step(uHalfTexel, -s.a);
    bg += vec4(s.rgb, 1.0) * bw; fg += vec4(s.rgb, 1.0) * fw;
  }
  bg.rgb /= bg.a + (bg.a == 0.0 ? 1.0 : 0.0); fg.rgb /= fg.a + (fg.a == 0.0 ? 1.0 : 0.0);
  float alpha = clamp(fg.a * 3.14159265 / float(SAMPLES), 0.0, 1.0);
  gl_FragColor = vec4(mix(bg.rgb, fg.rgb, alpha), alpha);
}`;
// A 4-tap tent (3 x 3 texels through bilinear taps): smooths the gather's sampling pattern.
const tent = `
uniform sampler2D tMap; uniform vec2 uTexel; varying vec2 vUv;
void main() {
  vec4 d = vec4(uTexel * 0.5, -uTexel.x * 0.5, 0.0);
  gl_FragColor = (texture2D(tMap, vUv - d.xy) + texture2D(tMap, vUv - d.zy) + texture2D(tMap, vUv + d.zy) + texture2D(tMap, vUv + d.xy)) * 0.25;
}`;
// Bloom chain: 13-tap downsample (Jimenez 2014), tent upsample mixing in the wider levels (scatter): the result stays a
// weighted mean of the levels, the same light spread wider.
const down = `
uniform sampler2D tMap; uniform vec2 uTexel; varying vec2 vUv;
vec3 t(vec2 o) { return texture2D(tMap, vUv + o * uTexel).rgb; }
void main() {
  vec3 a = t(vec2(-2.0, 2.0)), b = t(vec2(0.0, 2.0)), c = t(vec2(2.0, 2.0)), d = t(vec2(-2.0, 0.0)), e = t(vec2(0.0)), f = t(vec2(2.0, 0.0));
  vec3 g = t(vec2(-2.0, -2.0)), h = t(vec2(0.0, -2.0)), i = t(vec2(2.0, -2.0)), j = t(vec2(-1.0, 1.0)), k = t(vec2(1.0, 1.0)), l = t(vec2(-1.0, -1.0)), m = t(vec2(1.0, -1.0));
  gl_FragColor = vec4(e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125, 1.0);
}`;
const up = `
uniform sampler2D tMap, tLevel; uniform vec2 uTexel; uniform float uScatter; varying vec2 vUv;
vec3 t(vec2 o) { return texture2D(tMap, vUv + o * uTexel).rgb; }
void main() {
  vec3 s = t(vec2(-1.0, 1.0)) + t(vec2(1.0, 1.0)) + t(vec2(-1.0, -1.0)) + t(vec2(1.0, -1.0));
  s += 2.0 * (t(vec2(0.0, 1.0)) + t(vec2(-1.0, 0.0)) + t(vec2(1.0, 0.0)) + t(vec2(0.0, -1.0))) + 4.0 * t(vec2(0.0));
  gl_FragColor = vec4(mix(texture2D(tLevel, vUv).rgb, s / 16.0, uScatter), 1.0);
}`;
// Composite at full resolution: depth of field (the blur layer where this pixel's own blur reaches past ~2 px, and the
// near field over everything), the glow (a share of the light the chain spread beyond the source: c + share x (spread -
// source), where positive), lateral chromatic aberration (red and blue sampled a little outward and inward, growing with the cube of the
// distance from the optical axis), natural vignetting (cos^4 in shape, uVignette EV at the corners). The optical axis:
// uAxis, the frame's centre unless the camera's lens is shifted (lens_shift.js).
const composite = `${COMMON}
uniform sampler2D tColor, tDepth, tFocus, tDof, tBloom, tSource;
uniform float uDof, uBloom, uVignette, uCA, uAspect, uTexelH;
uniform vec2 uAxis;
varying vec2 vUv;
vec3 lens(vec2 uv, float s) {
  vec3 c = finite(texture2D(tColor, uv).rgb);
  if (uDof > 0.5) {
    float coc = cocOf(linearDepth(texture2D(tDepth, uv).r), s);
    vec4 dof = texture2D(tDof, uv);
    float far = smoothstep(uTexelH * 2.0, uTexelH * 4.0, coc);
    c = mix(c, dof.rgb, far + dof.a - far * dof.a);
  }
  // only the spread: subtracting the half-resolution source from a sharp full-resolution glint would ring it in black
  if (uBloom > 0.0) c += uBloom * max(texture2D(tBloom, uv).rgb - texture2D(tSource, uv).rgb, vec3(0.0));
  return c;
}
void main() {
  float s = exp2(texture2D(tFocus, vec2(0.5)).r);
  vec2 d = vUv - uAxis, p = d * vec2(uAspect, 1.0);   // p: image heights from the optical axis
  float r2 = dot(p, p), corner2 = 0.25 * (uAspect * uAspect + 1.0);
  vec3 c;
  if (uCA > 0.0) {
    vec2 o = d * uCA * r2 / pow(corner2, 1.5);        // |o| = uCA image heights at the corner
    if (length(o) > 0.25 * uTexelH) c = vec3(lens(vUv + o, s).r, lens(vUv, s).g, lens(vUv - o, s).b);
    else c = lens(vUv, s);
  } else c = lens(vUv, s);
  if (uVignette > 0.0) {
    // cos^4 of the field angle in shape (tan^2 = r^2 (sensor / focal)^2), scaled to uVignette EV at the frame's corners
    float k = (uSensor / uFocal) * (uSensor / uFocal);
    c *= exp2(-uVignette * log2(1.0 + r2 * k) / log2(1.0 + corner2 * k));
  }
  gl_FragColor = vec4(c, 1.0);
}`;

export class LensPass extends Pass {
  // camera: the walkthrough's; depth(): the scene depth of the frame just drawn (TAA's, else the composer's); aim(): what
  // the visitor aims at, { distance along the view axis in m } or null; exposure(): the auto exposure's 1 x 1 state
  // (2^EV in red) or null (then the renderer's tone-mapping exposure); parts: lens_policy.js lensParts.
  // control (the film, tools): null for the walkthrough's autofocus and aperture, or { fStop: a fixed aperture, focus: m,
  // set exactly each frame (a pull is the caller's curve), hold: keep the focus where it is (a locked shot), track: follow
  // the centre every frame (no lock), time: the pull's settling time (s) }.
  constructor({ camera, renderer, depth = () => null, aim = () => null, exposure = () => null, parts = {}, settings = {} }) {
    super();
    this.camera = camera; this.depth = depth; this.aim = aim; this.exposure = exposure; this.renderer = renderer;
    this.settings = { ...LENS, ...settings }; this.parts = { dof: true, bloom: true, vignette: true, ca: true, ...parts }; this.control = null;
    this.valid = false; this.index = 0; this.lastPosition = new THREE.Vector3(); this.lastQuaternion = new THREE.Quaternion(); this.quat = new THREE.Quaternion();
    const floatOk = renderer?.extensions?.has?.('EXT_color_buffer_float');
    const state = () => new THREE.WebGLRenderTarget(1, 1, { type: floatOk ? THREE.FloatType : THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.focus = [state(), state()];
    const lensUniforms = () => ({ uNear: { value: 0.05 }, uFar: { value: 300 }, uFocal: { value: 20 }, uFStop: { value: this.settings.fStop }, uFStopRooms: { value: this.settings.fStopRooms },
      uSubjectNear: { value: this.settings.subjectNear }, uSubjectFar: { value: this.settings.subjectFar }, uSensor: { value: SENSOR_HEIGHT_MM }, uMaxCoc: { value: this.settings.maxCoc } });
    const pattern = focusPattern(this.settings.afGrid, this.settings.afRegion).map(s => new THREE.Vector3(s.x, s.y, s.weight));
    this.af = material(autofocus, { ...lensUniforms(), tDepth: { value: null }, tPrev: { value: null }, uPattern: { value: pattern }, uAspect: { value: 1 },
      uDt: { value: 0 }, uSnap: { value: 1 }, uValid: { value: 0 }, uOverride: { value: -1 }, uDirect: { value: 0 }, uHold: { value: 0 }, uFallback: { value: 5 }, uSky: { value: this.settings.skyDepth },
      uOmega: { value: 4.744 / this.settings.focusTime }, uLockCoc: { value: this.settings.lockCoc }, uLockTime: { value: this.settings.lockTime } });
    this.pre = material(prefilter, { ...lensUniforms(), tColor: { value: null }, tDepth: { value: null }, tFocus: { value: null }, uTexel: { value: new THREE.Vector2() }, uHalfTexel: { value: 0 }, uDofOn: { value: 1 },
      uBloomOn: { value: 1 }, tExposure: { value: null }, uExposureOn: { value: 0 }, uExposure: { value: 1 }, uThreshold: { value: this.settings.bloomThreshold }, uIsolation: { value: this.settings.bloomIsolation },
      uRing: { value: this.settings.bloomRing }, uGlareMax: { value: this.settings.glareMax }, uAspect: { value: 1 } }, { glslVersion: THREE.GLSL3 });
    const k = bokehKernel(this.settings.samples, this.settings.blades, this.settings.bladeRotation, this.settings.roundness), kernel = [];
    for (let i = 0; i < k.length; i += 2) kernel.push(new THREE.Vector2(k[i], k[i + 1]));
    this.gather = material(gather, { tDof: { value: null }, uKernel: { value: kernel }, uMaxCoc: { value: this.settings.maxCoc }, uAspect: { value: 1 }, uHalfTexel: { value: 0 } });
    this.tent = material(tent, { tMap: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.down = material(down, { tMap: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.up = material(up, { tMap: { value: null }, tLevel: { value: null }, uTexel: { value: new THREE.Vector2() }, uScatter: { value: this.settings.bloomScatter } });
    this.out = material(composite, { ...lensUniforms(), tColor: { value: null }, tDepth: { value: null }, tFocus: { value: null }, tDof: { value: null }, tBloom: { value: null }, tSource: { value: null },
      uDof: { value: 1 }, uBloom: { value: this.settings.bloom }, uVignette: { value: this.settings.vignette }, uCA: { value: this.settings.ca }, uAspect: { value: 1 }, uTexelH: { value: 0 }, uAxis: { value: new THREE.Vector2(0.5, 0.5) } });
    this.quad = new FullScreenQuad(null);
    this.half = null; this.blur = null; this.smooth = null; this.downs = []; this.ups = [];
    this.probeNext = false; this.probed = null;   // tools: probe the next frame (probe())
    this.restore = () => { this.valid = false; };
    renderer?.domElement?.addEventListener?.('webglcontextrestored', this.restore);
  }
  setSize(w, h) {
    if (this.width === w && this.height === h) return;
    this.width = w; this.height = h;
    for (const t of [this.half, this.blur, this.smooth, ...this.downs, ...this.ups]) t?.dispose();
    const hw = Math.ceil(w / 2), hh = Math.ceil(h / 2);
    this.half = half(hw, hh, { count: 2 }); this.blur = half(hw, hh); this.smooth = half(hw, hh);
    this.downs = []; this.ups = [];
    for (let i = 1, lw = hw, lh = hh; i < this.settings.bloomLevels; i++) {
      lw = Math.max(1, Math.ceil(lw / 2)); lh = Math.max(1, Math.ceil(lh / 2));
      this.downs.push(half(lw, lh)); this.ups.push(half(lw, lh));
    }
    this.ups.unshift(half(hw, hh));   // ups[0]: the half-resolution glow the composite reads
  }
  reset() { this.valid = false; }
  // switching on starts the focus afresh (it was not followed while off)
  get enabled() { return this._enabled; }
  set enabled(on) { if (on && !this._enabled) this.valid = false; this._enabled = !!on; }
  // the uniforms every lens shader shares, from the camera, the settings and the film's control
  lensUniforms(u) {
    const c = this.camera, s = this.settings, k = this.control ?? {};
    const sensor = sensorHeightMm(c.aspect);
    u.uNear.value = c.near; u.uFar.value = c.far; u.uFocal.value = focalLengthMm(c.fov, sensor); u.uSensor.value = sensor; u.uMaxCoc.value = s.maxCoc;
    u.uFStop.value = k.fStop ?? s.fStop; u.uFStopRooms.value = k.fStop ?? s.fStopRooms; u.uSubjectNear.value = s.subjectNear; u.uSubjectFar.value = s.subjectFar;
  }
  draw(renderer, mat, target) { this.quad.material = mat; renderer.setRenderTarget(target); this.quad.render(renderer); }
  render(renderer, writeBuffer, readBuffer) {
    const c = this.camera, s = this.settings, k = this.control ?? {}, w = readBuffer.width, h = readBuffer.height, aspect = w / h;
    this.setSize(w, h);
    const depth = this.depth() ?? readBuffer.depthTexture ?? null, dof = !!(this.parts.dof && depth), bloom = !!this.parts.bloom && s.bloom > 0;
    const saved = renderer.getRenderTarget(), autoClear = renderer.autoClear; renderer.autoClear = false;
    try {
      // ---- autofocus: snapped on a jump of the camera, else locked or pulled
      c.getWorldQuaternion(this.quat);
      const jump = this.lastPosition.distanceTo(c.position) > s.snapDistance || Math.abs(this.quat.dot(this.lastQuaternion)) < Math.cos(THREE.MathUtils.degToRad(s.snapAngle) / 2);
      this.lastPosition.copy(c.position); this.lastQuaternion.copy(this.quat);
      const focal = focalLengthMm(c.fov, sensorHeightMm(c.aspect)), prev = this.focus[this.index], next = this.focus[1 - this.index];
      if (dof) {
        const a = this.af.uniforms; this.lensUniforms(a);
        const aimed = this.aim(), direct = k.focus > 0;
        a.tDepth.value = depth; a.tPrev.value = prev.texture; a.uAspect.value = aspect; a.uDt.value = frameClock.dt;
        a.uSnap.value = +(jump || !this.valid); a.uValid.value = +this.valid; a.uOverride.value = direct ? k.focus : aimed?.distance > 0 ? aimed.distance : -1;
        a.uDirect.value = +direct; a.uHold.value = +!!k.hold; a.uLockCoc.value = k.track ? 0 : s.lockCoc; a.uLockTime.value = s.lockTime;
        a.uFallback.value = hyperfocal(focal, k.fStop ?? s.fStopRooms); a.uSky.value = s.skyDepth; a.uOmega.value = 4.744 / Math.max(1e-3, k.time ?? s.focusTime);
        this.draw(renderer, this.af, next); this.index = 1 - this.index; this.valid = true;
      }
      const focus = this.focus[this.index].texture, hw = this.half.width, hh = this.half.height;
      // ---- prefilter: the blur layer and the glow's source, both at half resolution
      if (dof || bloom) {
        const u = this.pre.uniforms; this.lensUniforms(u);
        u.tColor.value = readBuffer.texture; u.tDepth.value = depth; u.tFocus.value = focus;
        u.uTexel.value.set(1 / w, 1 / h); u.uHalfTexel.value = 1 / hh; u.uDofOn.value = +dof; u.uBloomOn.value = +bloom; u.uAspect.value = aspect;
        const exposure = this.exposure(); u.tExposure.value = exposure; u.uExposureOn.value = +!!exposure; u.uExposure.value = renderer.toneMappingExposure ?? 1;
        u.uThreshold.value = s.bloomThreshold; u.uIsolation.value = s.bloomIsolation; u.uRing.value = s.bloomRing; u.uGlareMax.value = s.glareMax;
        this.draw(renderer, this.pre, this.half);
      }
      // ---- depth of field
      if (dof) {
        const g = this.gather.uniforms; g.tDof.value = this.half.textures[0]; g.uMaxCoc.value = s.maxCoc; g.uAspect.value = aspect; g.uHalfTexel.value = 1 / hh;
        this.draw(renderer, this.gather, this.blur);
        const t = this.tent.uniforms; t.tMap.value = this.blur.texture; t.uTexel.value.set(1 / hw, 1 / hh);
        this.draw(renderer, this.tent, this.smooth);
      }
      // ---- bloom: down the chain from the half-resolution source, then back up adding each level
      if (bloom) {
        let src = this.half.textures[1], sw = hw, sh = hh;
        for (const t of this.downs) { const u = this.down.uniforms; u.tMap.value = src; u.uTexel.value.set(1 / sw, 1 / sh); this.draw(renderer, this.down, t); src = t.texture; sw = t.width; sh = t.height; }
        for (let i = this.downs.length - 1; i >= 0; i--) {
          const below = i === this.downs.length - 1 ? this.downs[i] : this.ups[i + 1], level = i === 0 ? this.half.textures[1] : this.downs[i - 1].texture;
          const u = this.up.uniforms; u.tMap.value = below.texture; u.tLevel.value = level; u.uTexel.value.set(1 / below.width, 1 / below.height); u.uScatter.value = s.bloomScatter;
          this.draw(renderer, this.up, this.ups[i]);
        }
      }
      // ---- composite
      const o = this.out.uniforms, shift = lensShift(c); this.lensUniforms(o);
      o.tColor.value = readBuffer.texture; o.tDepth.value = depth; o.tFocus.value = focus; o.tDof.value = this.smooth.texture;
      o.tBloom.value = bloom && this.downs.length ? this.ups[0].texture : this.half.textures[1]; o.tSource.value = this.half.textures[1];
      o.uDof.value = +dof; o.uBloom.value = bloom ? s.bloom : 0; o.uAxis.value.set(0.5 - shift.x, 0.5 - shift.y);
      o.uVignette.value = this.parts.vignette ? s.vignette : 0; o.uCA.value = this.parts.ca ? s.ca : 0; o.uAspect.value = aspect; o.uTexelH.value = 1 / h;
      this.draw(renderer, this.out, this.renderToScreen ? null : writeBuffer);
      // tools: the input is overwritten by the passes after this one, so it is read here
      if (this.probeNext) { this.probeNext = false; this.probed = this.probe(readBuffer, this.exposureGain?.() ?? renderer.toneMappingExposure ?? 1, renderer); }
    } finally { renderer.autoClear = autoClear; renderer.setRenderTarget(saved); }
  }
  // diagnostics (tools, never per frame): the focus distance now, its target and the aperture there (a 1 x 1 readback)
  focusDistance(renderer = this.renderer) {
    const px = new Float32Array(4), t = this.focus[this.index];
    if (t.texture.type !== THREE.FloatType) return null;
    renderer.readRenderTargetPixels(t, 0, 0, 1, 1, px);
    const s = this.settings, k = this.control ?? {}, focus = 2 ** px[0];
    return { focus, lock: 2 ** px[3], fStop: apertureFor(focus, k.fStop ?? s.fStop, k.fStop ?? s.fStopRooms, s.subjectNear, s.subjectFar) };
  }
  // diagnostics (tools; set probeNext, read probed after the frame): the frame's input as the output pass exposes it
  // (gain: 2^EV), and how much of it glows. Readbacks of the full frame; never per frame.
  probe(t, gain, renderer = this.renderer) {
    if (!t || t.texture.type !== THREE.HalfFloatType) return null;
    const { width: w, height: h } = t, buf = new Uint16Array(w * h * 4), table = new Float32Array(65536);
    for (let i = 0; i < 65536; i++) table[i] = THREE.DataUtils.fromHalfFloat(i);
    renderer.readRenderTargetPixels(t, 0, 0, w, h, buf);
    const vals = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) vals[i] = Math.max(table[buf[4 * i]], table[buf[4 * i + 1]], table[buf[4 * i + 2]]) * gain;
    const sorted = vals.slice().sort(), q = p => +sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))].toPrecision(3);
    const above = v => +(vals.reduce((n, x) => n + (x > v), 0) / vals.length).toPrecision(3);
    const hw = this.half.width, hh = this.half.height, src = new Uint16Array(hw * hh * 4);
    renderer.readRenderTargetPixels(this.half, 0, 0, hw, hh, src, undefined, 1);
    let glowing = 0, energy = 0, total = 0;
    for (let i = 0; i < hw * hh; i++) { const e = Math.max(table[src[4 * i]], table[src[4 * i + 1]], table[src[4 * i + 2]]) * gain; if (e > 0) { glowing++; energy += e; } }
    for (const v of vals) total += v;
    return { gain: +gain.toPrecision(4), p50: q(0.5), p90: q(0.9), p99: q(0.99), p999: q(0.999), max: q(1 - 1e-9), above4: above(4), above32: above(32),
      glowing: +(glowing / (hw * hh)).toPrecision(3), glowShare: +(energy / Math.max(1e-9, total / 4)).toPrecision(3) };
  }
  dispose() {
    this.renderer?.domElement?.removeEventListener?.('webglcontextrestored', this.restore);
    for (const t of [...this.focus, this.half, this.blur, this.smooth, ...this.downs, ...this.ups]) t?.dispose();
    for (const m of [this.af, this.pre, this.gather, this.tent, this.down, this.up, this.out]) m.dispose();
    this.quad.dispose();
  }
}

// Installs the lens in the walkthrough's composer, just before its output pass (after TAA's resolve), off until enabled.
// depth: the scene depth TAA resolved against (its internal composer's), else the composer's own.
export function createLens({ lighting, renderer, camera, aim, parts }) {
  const composer = lighting.composer, at = composer.passes.indexOf(lighting.outputPass);
  if (at < 0) throw new Error('the lens needs the composer\'s output pass');
  const depth = () => lighting.taa?.resolve?.uniforms?.tDepth?.value ?? null, exposure = () => lighting.autoExposure?.texture ?? null;
  const pass = new LensPass({ camera, renderer, depth, aim, exposure, parts });
  pass.needsSwap = true; pass.enabled = false;
  // tools: the exposure the output pass applies (the auto exposure's 1 x 1 state, else the renderer's), a readback
  pass.exposureGain = () => {
    const t = lighting.autoExposure?.debugTargets?.exposure; if (!t) return renderer.toneMappingExposure ?? 1;
    const half = t.texture.type === THREE.HalfFloatType, px = half ? new Uint16Array(4) : new Float32Array(4);
    renderer.readRenderTargetPixels(t, 0, 0, 1, 1, px); return half ? THREE.DataUtils.fromHalfFloat(px[0]) : px[0];
  };
  composer.insertPass(pass, at);
  return pass;
}
