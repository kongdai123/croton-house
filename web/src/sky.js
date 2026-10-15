// Moods for photo mode: a physical sky with a sun that can stand anywhere, a cloud deck, and the words that ask for them.
//
// The sky is three's Preetham model (examples/jsm/objects/Sky.js), evaluated per pixel of an equirectangular map so
// the path tracer can light the scene with it. Two maps come out: the background (with the sun's disc, for rays that
// see the sky) and the lighting copy (without it). The sun itself is a directional light with the colour the
// atmosphere leaves it, so its shadows come from direct sampling instead of from luck.
//
// Directions: plan azimuth is a compass bearing (0 north, 90 east); world north is -z, east +x, up +y.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

// The installed tracer uses RGBA32F accumulation and linearly filtered float environment maps.
export function photoSupport(renderer) {
  const gl = renderer.getContext(), caps = renderer.capabilities;
  if (gl.isContextLost()) return 'Photo unavailable: WebGL context lost.';
  if (!gl.texStorage2D || !caps || caps.maxTextureSize < 1024) return 'Photo unavailable: WebGL 2 is required.';
  const missing = ['EXT_color_buffer_float', 'OES_texture_float_linear'].filter(e => !renderer.extensions.has(e));
  return missing.length ? `Photo unavailable: this GPU lacks ${missing.join(' and ')}.` : null;
}

export const DEFAULT_MOOD = {
  sun: { az: 215, el: 58 },   // compass degrees; elevation above the horizon
  turbidity: 2.5, rayleigh: 1.2,
  clouds: 0.25,               // cover 0..1
  cloudWarmth: 0.5,           // how much low sun tints the cloud bases
  sunBoost: 8,                // direct sun against sky, the model under-weights it
  mist: 0, wet: 0, puddles: 0,
  lamps: 0, lampK: 2900,      // interior fixtures 0..1 and colour temperature
  ev: 0,
};

// Metering should preserve the time of day, even in a frame full of unlit walls. EV is the photographer's
// compensation, applied after this policy; the gain ceiling is relative to that nominal exposure.
export function photoExposurePolicy(mood) {
  const el = mood?.sun?.el ?? DEFAULT_MOOD.sun.el;
  const nightToBlue = THREE.MathUtils.smoothstep(el, -12, -3);
  const blueToDay = THREE.MathUtils.smoothstep(el, -3, 6);
  const mix = THREE.MathUtils.lerp;
  return {
    key: mix(mix(0.025, 0.07, nightToBlue), 0.22, blueToDay),
    bias: mix(mix(-0.5, 0, nightToBlue), 0, blueToDay),
    maxGain: mix(mix(4, 8, nightToBlue), 400, blueToDay),
  };
}

export function sunDirection({ az, el }) {
  const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

// Black-body colour (Tanner Helland's fit), linear RGB normalised to its brightest channel.
export function kelvin(k) {
  const t = k / 100; let r, g, b;
  r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = new THREE.Color().setRGB(...[r, g, b].map(v => THREE.MathUtils.clamp(v, 0, 255) / 255), THREE.SRGBColorSpace);
  const m = Math.max(c.r, c.g, c.b); return c.multiplyScalar(1 / m);
}

const SKY_FRAG = /* glsl */`
  uniform vec3 uSun; uniform float uTurbidity; uniform float uRayleigh; uniform float uClouds; uniform float uWarmth;
  uniform float uDisc;
  varying vec2 vUv;
  const float pi = 3.141592653589793;
  const vec3 totalRayleigh = vec3(5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5);
  const vec3 MieConst = vec3(1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14);
  const float cutoffAngle = 1.6110731556870734; const float steepness = 1.5; const float EE = 1000.0;
  const vec3 up = vec3(0.0, 1.0, 0.0);
  float sunIntensity(float c) { c = clamp(c, -1.0, 1.0); return EE * max(0.0, 1.0 - exp(-((cutoffAngle - acos(c)) / steepness))); }
  vec3 totalMie(float T) { float c = (0.2 * T) * 10E-18; return 0.434 * c * MieConst; }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return v; }
  // the tracer's equirectangular convention (equirectUvToDirection)
  vec3 dirFromUv(vec2 uv) { float theta = (uv.x - 0.5) * 2.0 * pi, phi = (1.0 - uv.y) * pi; return vec3(sin(phi) * cos(theta), cos(phi), sin(phi) * sin(theta)); }
  void main() {
    vec3 direction = dirFromUv(vUv), sunDir = normalize(uSun);
    float sunE = sunIntensity(dot(sunDir, up));
    float sunfade = 1.0 - clamp(1.0 - exp(sunDir.y * 0.889), 0.0, 1.0);
    vec3 betaR = totalRayleigh * (uRayleigh - (1.0 - sunfade)), betaM = totalMie(uTurbidity) * 0.005;
    float zenithAngle = acos(max(0.0, dot(up, direction)));
    float inverse = 1.0 / (cos(zenithAngle) + 0.15 * pow(93.885 - ((zenithAngle * 180.0) / pi), -1.253));
    vec3 Fex = exp(-(betaR * 8.4E3 * inverse + betaM * 1.25E3 * inverse));
    float cosTheta = dot(direction, sunDir);
    float rPhase = 0.05968310365946075 * (1.0 + pow(cosTheta * 0.5 + 0.5, 2.0));
    float g = 0.8, g2 = g * g; float mPhase = 0.07957747154594767 * (1.0 - g2) / pow(1.0 - 2.0 * g * cosTheta + g2, 1.5);
    vec3 ratio = (betaR * rPhase + betaM * mPhase) / (betaR + betaM);
    vec3 Lin = pow(sunE * ratio * (1.0 - Fex), vec3(1.5));
    Lin *= mix(vec3(1.0), pow(sunE * ratio * Fex, vec3(0.5)), clamp(pow(1.0 - dot(up, sunDir), 5.0), 0.0, 1.0));
    vec3 L0 = vec3(0.1) * Fex;
    float disc = smoothstep(0.99995, 0.99997, cosTheta) * uDisc;
    L0 += sunE * 19000.0 * Fex * disc;
    vec3 sky = (Lin + L0) * 0.04 + vec3(0.0, 0.0003, 0.00075);
    // below the horizon: a dim, warm ground bounce instead of black
    if (direction.y < 0.0) sky = mix(sky, vec3(0.32, 0.29, 0.25) * (0.04 * pow(sunE * 0.02, 1.0) + 0.02), 1.0 - smoothstep(-0.08, 0.0, direction.y));
    // cloud deck: fbm on a plane overhead, thinning to the horizon; bases warm where they face a low sun
    if (direction.y > 0.0 && uClouds > 0.0) {
      vec2 cuv = direction.xz / (direction.y + 0.12) * 0.9;
      float n = fbm(cuv * 1.7) * 0.65 + fbm(cuv * 5.1 + 3.7) * 0.35;
      float mask = smoothstep(1.0 - uClouds, 1.0 - uClouds + 0.22, n) * smoothstep(0.0, 0.18, direction.y);
      float lit = pow(max(cosTheta, 0.0), 6.0), low = 1.0 - smoothstep(0.05, 0.5, sunDir.y);
      vec3 skyLum = vec3(dot(Lin * 0.04, vec3(0.2126, 0.7152, 0.0722)));
      vec3 base = mix(vec3(0.62, 0.66, 0.74), vec3(1.0), smoothstep(0.0, 0.6, sunDir.y));
      vec3 warm = mix(vec3(1.0), vec3(1.6, 0.95, 0.62), low * uWarmth);
      vec3 cloud = skyLum * 1.6 * base * mix(vec3(1.0), warm, 0.5 + 0.5 * lit) * (1.0 + 2.5 * lit * low) + (1.0 - n) * 0.0;
      // thicker cores are darker underneath
      cloud *= mix(1.0, 0.55, smoothstep(0.55, 0.95, n));
      sky = mix(sky, cloud, mask);
    }
    // Preetham is a daylight model: its residual extinction and warm ground term become beige when metered
    // at night. Below the horizon, fade to a dim blue sky and cool ground, including the cloud deck.
    float twilight = smoothstep(-0.208, -0.0523, sunDir.y);
    float night = 1.0 - smoothstep(-0.0523, 0.0349, sunDir.y);
    float horizon = pow(1.0 - abs(direction.y), 3.0);
    vec3 blue = mix(vec3(0.0006, 0.0015, 0.004), vec3(0.0015, 0.003, 0.006), horizon);
    blue *= mix(1.0, 5.0, twilight) * mix(1.0, 0.6, uClouds);
    if (direction.y < 0.0) blue *= 0.35;
    sky = mix(sky, blue, night);
    gl_FragColor = vec4(sky, 1.0);
  }`;

// Preetham's sun transmittance and irradiance, mirrored on the CPU so the light matches the sky.
function sunLight(dir, mood) {
  const c = THREE.MathUtils.clamp(dir.y, -1, 1);
  const sunE = 1000 * Math.max(0, 1 - Math.exp(-((1.6110731556870734 - Math.acos(c)) / 1.5)));
  const zen = Math.acos(Math.max(0, c));
  const inverse = 1 / (Math.cos(zen) + 0.15 * Math.pow(93.885 - (zen * 180) / Math.PI, -1.253));
  const R = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5].map(v => v * mood.rayleigh);
  const M = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14].map(v => 0.434 * (0.2 * mood.turbidity) * 10e-18 * v * 0.005);
  const Fex = R.map((r, i) => Math.exp(-(r * 8.4e3 * inverse + M[i] * 1.25e3 * inverse)));
  // disc radiance x solid angle of the disc, as the sky shader draws it
  const E = Fex.map(f => sunE * 19000 * 0.04 * f * 2 * Math.PI * (1 - 0.99996));
  const lum = 0.2126 * E[0] + 0.7152 * E[1] + 0.0722 * E[2];
  if (!(lum > 0)) return null;
  return { color: new THREE.Color(E[0] / lum, E[1] / lum, E[2] / lum), intensity: lum * mood.sunBoost };
}

// Render the sky into two float equirectangular maps (read back to the CPU: the tracer builds its importance
// sampling tables from the pixels) and return them with the matching sun.
export function makeSky(renderer, mood, width = 1024) {
  const error = photoSupport(renderer); if (error) throw new Error(error);
  const m = { ...DEFAULT_MOOD, ...mood, sun: { ...DEFAULT_MOOD.sun, ...(mood?.sun ?? {}) } };
  const dir = sunDirection(m.sun), w = width, h = width / 2;
  // The visible sun disc exceeds half-float range; keep sky radiance at full precision.
  const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
  const quad = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { uSun: { value: dir }, uTurbidity: { value: m.turbidity }, uRayleigh: { value: m.rayleigh }, uClouds: { value: m.clouds }, uWarmth: { value: m.cloudWarmth }, uDisc: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: SKY_FRAG, depthTest: false, depthWrite: false,
  }));
  const read = disc => {
    quad.material.uniforms.uDisc.value = disc;
    const prev = renderer.getRenderTarget();
    try { renderer.setRenderTarget(target); quad.render(renderer); } finally { renderer.setRenderTarget(prev); }
    const px = new Float32Array(w * h * 4); renderer.readRenderTargetPixels(target, 0, 0, w, h, px);
    const t = new THREE.DataTexture(px, w, h, THREE.RGBAFormat, THREE.FloatType);
    Object.assign(t, { mapping: THREE.EquirectangularReflectionMapping, colorSpace: THREE.LinearSRGBColorSpace, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, flipY: false });
    t.needsUpdate = true; return t;
  };
  let background, env;
  try {
    background = read(1); env = read(0);
    const sun = sunLight(dir, m);
    return { background, env, sun: sun && { dir, ...sun }, mood: m };
  } catch (err) { background?.dispose(); env?.dispose(); throw err; }
  finally { quad.material.dispose(); quad.dispose(); target.dispose(); }
}

// ---------------------------------------------------------------------------------------------------------------
// Words to moods. Each phrase sets the physical controls a photographer would name: where the sun is, how clear the
// air is, how much cloud, mist, wet ground, and whether the lamps are on. Phrases combine; later ones refine earlier
// ones ("sunrise, after rain, soft lamps inside"). Chinese and English.
const PHRASES = [
  // time of day: sun position
  { re: /日出|太阳刚升起|太阳升起|清晨|sunrise|dawn|first light/i, set: { sun: { az: 62, el: 9 }, turbidity: 3, cloudWarmth: 1, lamps: 0.5 } },
  { re: /早晨|早上|上午|morning/i, set: { sun: { az: 95, el: 18 } } },
  { re: /中午|正午|noon|midday/i, set: { sun: { az: 180, el: 72 } } },
  { re: /下午|afternoon/i, set: { sun: { az: 245, el: 35 } } },
  { re: /黄昏|傍晚|日落|夕阳|sunset|dusk|golden hour|golden/i, set: { sun: { az: 290, el: 4 }, turbidity: 4, cloudWarmth: 1, lamps: 0.7 } },
  { re: /蓝调|蓝色时刻|blue hour|twilight/i, set: { sun: { az: 295, el: -3 }, turbidity: 2, lamps: 1 } },
  { re: /夜|晚上|night/i, set: { sun: { az: 300, el: -12 }, lamps: 1, clouds: 0.1 } },
  // weather and air
  { re: /雨过天晴|雨后|after (the )?rain|clearing|post-?rain/i, set: { wet: 1, puddles: 0.7, clouds: 0.45, turbidity: 1.8, rayleigh: 1.6, mist: 0.35 } },
  { re: /下雨|雨天|raining|rainy/i, set: { wet: 1, puddles: 1, clouds: 0.95, sunBoost: 0.3, mist: 0.5 } },
  { re: /阴天|多云|overcast|cloudy/i, set: { clouds: 0.9, sunBoost: 0.6 } },
  { re: /晴朗|万里无云|大晴天|clear sky|sunny/i, set: { clouds: 0.08, turbidity: 2 } },
  { re: /雾|薄雾|晨雾|mist|fog|haze|hazy/i, set: { mist: 0.6, turbidity: 4 } },
  { re: /湿|wet|damp/i, set: { wet: 1 } },
  // light inside and out
  { re: /室内灯光柔和|灯光柔和|柔和的灯|soft (interior |indoor )?(light|lamp)s?|lamps? on|warm lamps?/i, set: { lamps: 0.55, lampK: 2900 } },
  { re: /灯光明亮|明亮的灯|bright lamps?|lights? on/i, set: { lamps: 1, lampK: 3200 } },
  { re: /关灯|lights? off|no lamps?/i, set: { lamps: 0 } },
  { re: /室外半明半暗|半明半暗|half[- ]lit|half light|chiaroscuro|low contrast light/i, set: { ev: -0.35, cloudWarmth: 1 } },
  // a bright, airy picture; not the lamps ("灯光明亮", "bright lamps" only set the lamps above)
  { re: /(?<!灯光)明亮(?!的灯)|bright(?!\s*(lamps?|lights?))|airy/i, set: { ev: 0.5 } },
  { re: /昏暗|阴暗|moody|dark/i, set: { ev: -0.5 } },
];

function merge(base, add) {
  const out = { ...base };
  for (const [k, v] of Object.entries(add)) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...(base[k] ?? {}), ...v } : v;
  return out;
}

// Turn a description into a mood. Returns the mood and the phrases it understood, so a page can show them.
export function parseMood(text, base = DEFAULT_MOOD) {
  let mood = { ...base, sun: { ...base.sun } }; const matched = [];
  // apply in the order the phrases appear in the text
  const hits = [];
  for (const p of PHRASES) { const m = String(text).match(p.re); if (m) hits.push({ at: m.index, word: m[0], set: p.set }); }
  hits.sort((a, b) => a.at - b.at);
  for (const h of hits) { mood = merge(mood, h.set); matched.push(h.word); }
  return { mood, matched };
}
