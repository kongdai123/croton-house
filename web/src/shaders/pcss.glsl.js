// GLSL chunk of the composed baked shader (shaders/compose.js). Text only: no three, no state.

const spiral = n => Array.from({ length: n }, (_, j) => { const r = Math.sqrt((j + 0.5) / n), a = j * 2.399963229728653; return `vec2(${(Math.cos(a) * r).toFixed(6)}, ${(Math.sin(a) * r).toFixed(6)})`; }).join(', ');
// Taps per quality tier, [blocker search, filter]: hq keeps the full set; laptop and mobile trade a little more grain in
// the penumbrae for fewer depth reads (PCSS was ~3.8 ms of a GPU-bound 4x-1440p living frame on the A6000 at 16/24).
// The tier is a uniform, so J switches without recompiling. No early-out when every search tap finds a blocker: in
// dappled light the sparse search misses the gaps the filter finds, and the pixel turned black.
export const PCSS_TAPS = { hq: [16, 24], laptop: [12, 16], mobile: [8, 12] };
const pcssTaps = (k, [s, f]) => `
const vec2 SUN_SEARCH${k}[${s}] = vec2[${s}](${spiral(s)});
const vec2 SUN_FILTER${k}[${f}] = vec2[${f}](${spiral(f)});
float sunPCSS${k}(vec3 c, mat2 R, float search) {
  float sum = 0.0, n = 0.0;
  for (int i = 0; i < ${s}; i++) { float d = texture2D(uSunDepth, c.xy + R * SUN_SEARCH${k}[i] * search).r; if (d < c.z) { sum += d; n += 1.0; } }
  if (n < 0.5) return 1.0;
  float pen = max((c.z - sum / n) * uSunDepthRange * uSunTan / uSunWidth, 1.5 * uSunTexel);
  float lit = 0.0;
  for (int i = 0; i < ${f}; i++) lit += step(c.z, texture2D(uSunDepth, c.xy + R * SUN_FILTER${k}[i] * pen).r);
  return lit / ${f}.0;
}`;
export const PCSS_GLSL = `
uniform sampler2D uSunDepth; uniform float uSunTexel; uniform float uSunDepthRange; uniform float uSunWidth; uniform float uSunTan; uniform float uSunFrame; uniform int uSunTaps;
${pcssTaps(0, PCSS_TAPS.hq)}${pcssTaps(1, PCSS_TAPS.laptop)}${pcssTaps(2, PCSS_TAPS.mobile)}
float sunPCSS(vec4 sc, float bias) {
  vec3 c = sc.xyz / sc.w; c.z += bias;
  if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
  // uSunFrame stays 0 unless TAA drives it (main.js): then the rotations change every frame and the noise integrates.
  float a = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy + 5.588238 * uSunFrame, vec2(0.06711056, 0.00583715))));
  mat2 R = mat2(cos(a), sin(a), -sin(a), cos(a));
  float search = max(30.0 * uSunTan / uSunWidth, 2.0 * uSunTexel);
  if (uSunTaps == 2) return sunPCSS2(c, R, search);
  if (uSunTaps == 1) return sunPCSS1(c, R, search);
  return sunPCSS0(c, R, search);
}
`;
// three's directional shadow lookup (lights_fragment_begin) and what replaces it
export const PCSS_LOOKUP = 'getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] )';
export const PCSS_CALL = 'sunPCSS( vDirectionalShadowCoord[ i ], directionalLightShadow.shadowBias )';
