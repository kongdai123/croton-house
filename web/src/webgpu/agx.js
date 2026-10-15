import { Data3DTexture, RGBAFormat, FloatType, NearestFilter } from 'three/webgpu';
import { Fn, If, vec3, vec4, ivec3, mat3, texture3D, mix, step } from 'three/tsl';
import { binary } from './assets.js';

// Column vectors exactly as in agx.js's GLSL mat3 constructors.
const IN = mat3(vec3(0.559463047, 0.0762332609, 0.0655375095), vec3(0.304775811, 0.787952395, 0.16454273), vec3(0.135812941, 0.135774849, 0.769741528));
const LOOK = mat3(vec3(0.967977806, 0.131809967, 0.0468677678), vec3(0.117887618, 0.916062285, 0.0124191066), vec3(-0.0858536371, -0.047868188, 0.940833412));
const VIEW = mat3(vec3(1.04730554, -0.153314683, -0.0501479231), vec3(-0.135979098, 1.11078232, -0.00788863052), vec3(0.0886511001, 0.0425245458, 1.05790992));
const enc = x => x.max(1e-10).log2().add(12.47393).div(25);
const dec = x => x.mul(25).sub(12.47393).exp2();

export function unpackLuts(buffer) {
  if (buffer.byteLength !== (37 ** 3 + 57 ** 3) * 3 * 2) throw new Error('Unexpected AgX LUT size');
  const words = new DataView(buffer);
  let offset = 0;
  return [37, 57].map(size => {
    const data = new Float32Array(size ** 3 * 4);
    for (let row = 0; row < size * size; row++) for (let channel = 0; channel < 3; channel++) {
      let value = 0;
      for (let red = 0; red < size; red++) {
        value = (value + words.getUint16(2 * (offset + (row * size + red) * 3 + channel), true)) & 0xffff;
        data[(row * size + red) * 4 + channel] = value / 64000;
      }
    }
    offset += size ** 3 * 3;
    return Object.assign(new Data3DTexture(data, size, size, size), {
      format: RGBAFormat, type: FloatType, minFilter: NearestFilter, magFilter: NearestFilter,
      unpackAlignment: 1, needsUpdate: true,
    });
  });
}

// OCIO tetrahedral interpolation, including the last cube face. setSampler(false)
// uses integer texel coordinates and no sampler, so float32 filtering is unnecessary.
// No explicit level: r183's TextureNode builds a level as float, and the GLSL fallback
// then emits texelFetch(..., 0.0), which does not compile. A null level gives 0 / 0u.
export const tetra = (texture, input) => Fn(() => {
  const last = texture.image.width - 1;
  const c = input.clamp(0, 1).mul(last).toVar();
  const b = c.floor().min(last - 1).toVar(), f = c.sub(b).toVar();
  const i = ivec3(b), s1 = ivec3().toVar(), s2 = ivec3().toVar(), w = vec3().toVar();
  If(f.r.greaterThanEqual(f.g), () => {
    If(f.g.greaterThanEqual(f.b), () => { s1.assign(ivec3(1, 0, 0)); s2.assign(ivec3(1, 1, 0)); w.assign(f.rgb); })
      .ElseIf(f.r.greaterThanEqual(f.b), () => { s1.assign(ivec3(1, 0, 0)); s2.assign(ivec3(1, 0, 1)); w.assign(f.rbg); })
      .Else(() => { s1.assign(ivec3(0, 0, 1)); s2.assign(ivec3(1, 0, 1)); w.assign(f.brg); });
  }).Else(() => {
    If(f.g.lessThanEqual(f.b), () => { s1.assign(ivec3(0, 0, 1)); s2.assign(ivec3(0, 1, 1)); w.assign(f.bgr); })
      .ElseIf(f.r.greaterThanEqual(f.b), () => { s1.assign(ivec3(0, 1, 0)); s2.assign(ivec3(1, 1, 0)); w.assign(f.grb); })
      .Else(() => { s1.assign(ivec3(0, 1, 0)); s2.assign(ivec3(0, 1, 1)); w.assign(f.gbr); });
  });
  const fetch = index => texture3D(texture, index).setSampler(false).rgb;
  return fetch(i).mul(w.x.oneMinus()).add(fetch(i.add(s1)).mul(w.x.sub(w.y)))
    .add(fetch(i.add(s2)).mul(w.y.sub(w.z))).add(fetch(i.add(ivec3(1))).mul(w.z));
})();

export async function blenderAgX(input, exposure) {
  const [luminance, view] = unpackLuts(await binary('assets/agx/agx_lut.bin.gz'));
  return Fn(() => {
    let c = dec(tetra(luminance, enc(IN.mul(input.rgb.mul(exposure)))));
    c = dec(enc(LOOK.mul(c)).sub(0.4).mul(1.2).add(0.4));
    c = tetra(view, enc(VIEW.mul(c))).max(0).pow(2.4).toVar();
    const encoded = mix(c.mul(12.9232101), c.pow(1 / 2.4).mul(1.055).sub(0.055), step(0.00303993467, c));
    return vec4(encoded, input.a);
  })();
}
