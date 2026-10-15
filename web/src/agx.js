// Blender 4.5's AgX view (display sRGB) with the look "AgX - Medium High Contrast", as its OCIO 2.4 config builds it, so
// the live frame and the Cycles references share one display transform. The chain (scene linear Rec.709, after exposure):
//   Rec.709 -> E-Gamut, log2 over [-12.47393, +12.52607] stops, luminance_compensation_bt2020.cube (37^3, tetrahedral),
//   back to linear, -> Rec.2020 with AgX's inset/rotation (the "AgX Log" space), log2 again, the look: contrast 1.2 about
//   0.4 (18% grey), back to linear, -> E-Gamut, log2, AgX_Base_sRGB.cube (57^3, tetrahedral), ^2.4, sRGB encoding.
// On a GPU it matches Blender's own (16-bit PNG) output to 0.05/255 at most over grey ramps and saturated colours.
// Installed over the composer's OutputPass while the renderer asks for AgX; anything else falls through to three.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const GLSL = `uniform sampler2D tDiffuse, tAutoExposure; uniform bool autoExposure; uniform highp sampler3D lumLut, agxLut; uniform float exposure; varying vec2 vUv;
const mat3 IN = mat3(0.559463047, 0.0762332609, 0.0655375095, 0.304775811, 0.787952395, 0.16454273, 0.135812941, 0.135774849, 0.769741528);
const mat3 LOOK = mat3(0.967977806, 0.131809967, 0.0468677678, 0.117887618, 0.916062285, 0.0124191066, -0.0858536371, -0.047868188, 0.940833412);
const mat3 VIEW = mat3(1.04730554, -0.153314683, -0.0501479231, -0.135979098, 1.11078232, -0.00788863052, 0.0886511001, 0.0425245458, 1.05790992);
vec3 enc(vec3 x) { return (log2(max(x, 1e-10)) + 12.47393) / 25.; }
vec3 dec(vec3 y) { return exp2(y * 25. - 12.47393); }
// OCIO's CPU tetrahedral interpolation (input clamped to the cube); texel (r, g, b) = .cube order
vec3 tetra(highp sampler3D t, vec3 c) {
  float n = float(textureSize(t, 0).x) - 1.;
  c = clamp(c, 0., 1.) * n; vec3 b = min(floor(c), n - 1.), f = c - b; ivec3 i = ivec3(b), s1, s2; vec3 w;
  if (f.r >= f.g) {
    if (f.g >= f.b) { s1 = ivec3(1, 0, 0); s2 = ivec3(1, 1, 0); w = f.rgb; }
    else if (f.r >= f.b) { s1 = ivec3(1, 0, 0); s2 = ivec3(1, 0, 1); w = f.rbg; }
    else { s1 = ivec3(0, 0, 1); s2 = ivec3(1, 0, 1); w = f.brg; }
  } else {
    if (f.g <= f.b) { s1 = ivec3(0, 0, 1); s2 = ivec3(0, 1, 1); w = f.bgr; }
    else if (f.r >= f.b) { s1 = ivec3(0, 1, 0); s2 = ivec3(1, 1, 0); w = f.grb; }
    else { s1 = ivec3(0, 1, 0); s2 = ivec3(0, 1, 1); w = f.gbr; }
  }
  return (1. - w.x) * texelFetch(t, i, 0).rgb + (w.x - w.y) * texelFetch(t, i + s1, 0).rgb + (w.y - w.z) * texelFetch(t, i + s2, 0).rgb + w.z * texelFetch(t, i + 1, 0).rgb;
}
void main() {
  vec4 t = texture2D(tDiffuse, vUv);
  float gain = autoExposure ? texture2D(tAutoExposure, vec2(0.5)).r : exposure;
  vec3 c = dec(tetra(lumLut, enc(IN * (t.rgb * gain))));
  c = dec((enc(LOOK * c) - 0.4) * 1.2 + 0.4);
  c = pow(max(tetra(agxLut, enc(VIEW * c)), 0.), vec3(2.4));
  // OCIO's sRGB encoding (its exact break point, not 0.0031308)
  gl_FragColor = vec4(mix(c * 12.9232101, 1.055 * pow(c, vec3(1. / 2.4)) - 0.055, step(0.00303993467, c)), t.a);
}`;

// assets/agx/agx_lut.bin.gz (tools/agx_lut.py): both cubes, red fastest, 16-bit deltas along red, value * 64000
export async function loadAgXLuts(url = 'assets/agx/agx_lut.bin.gz') {
  const response = await fetch(url); if (!response.ok) throw new Error(`AgX ${response.status}: ${url}`);
  let buf = await response.arrayBuffer();
  const b = new Uint8Array(buf, 0, 2);
  if (b[0] === 0x1f && b[1] === 0x8b) buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  if (buf.byteLength !== (37 ** 3 + 57 ** 3) * 3 * 2) throw new Error('Invalid AgX LUT length');
  const u = new Uint16Array(buf);
  let o = 0;
  return [37, 57].map(n => {
    const d = new Float32Array(n * n * n * 4);
    for (let row = 0; row < n * n; row++) for (let k = 0; k < 3; k++) {
      let v = 0;
      for (let r = 0; r < n; r++) { v = (v + u[o + (row * n + r) * 3 + k]) & 0xffff; d[(row * n + r) * 4 + k] = v / 64000; }
    }
    o += n * n * n * 3;
    const t = new THREE.Data3DTexture(d, n, n, n);
    Object.assign(t, { format: THREE.RGBAFormat, type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, unpackAlignment: 1, needsUpdate: true });
    return t;
  });
}

// Once the LUTs are in, the output pass draws Blender's AgX whenever renderer.toneMapping is AgX (exposure =
// renderer.toneMappingExposure, as three's). Idempotent.
export function blenderAgX(outputPass, url = 'assets/agx/agx_lut.bin.gz', staged = null) {
  return outputPass.blenderAgX ??= Promise.resolve(staged ?? loadAgXLuts(url)).then(([lumLut, agxLut]) => {
    const material = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, lumLut: { value: lumLut }, agxLut: { value: agxLut }, exposure: { value: 1 }, tAutoExposure: { value: null }, autoExposure: { value: false } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: GLSL, depthTest: false, depthWrite: false,
    });
    const quad = new FullScreenQuad(material), render = outputPass.render.bind(outputPass);
    outputPass.render = (renderer, writeBuffer, readBuffer, ...rest) => {
      if (renderer.toneMapping !== THREE.AgXToneMapping) return render(renderer, writeBuffer, readBuffer, ...rest);
      material.uniforms.tDiffuse.value = readBuffer.texture; material.uniforms.exposure.value = renderer.toneMappingExposure;
      material.uniforms.tAutoExposure.value = outputPass.autoExposureTexture ?? null;
      material.uniforms.autoExposure.value = !!outputPass.autoExposureTexture;
      renderer.setRenderTarget(outputPass.renderToScreen ? null : writeBuffer); quad.render(renderer);
    };
    return material;
  });
}
