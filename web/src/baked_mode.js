// Pure startup policy, shared with the CPU-only checks. The shipped bake has one time slot.
export const bakedRequested = search => {
  const q = new URLSearchParams(search);
  return !q.has('legacy') && q.get('lightmap') !== '0';
};
export const bakedResolution = (tier, search = location.search) => {
  const forced = new URLSearchParams(search).get('lmres');
  return ['full', 'half', 'quarter'].includes(forced) ? forced : tier === 'mobile' ? 'quarter' : tier === 'hq' ? 'full' : 'half';
};
export function bakedCapabilityError(renderer, atlas = []) {
  const gl = renderer.getContext();
  if (!gl || typeof gl.texImage3D !== 'function') return 'WebGL2 unavailable';
  if (!gl.getExtension('EXT_color_buffer_float')) return 'EXT_color_buffer_float unavailable';
  // The SH volume uses linearly filtered FloatType textures; it has no half-float conversion path.
  if (!gl.getExtension('OES_texture_float_linear')) return 'OES_texture_float_linear unavailable';
  // Supply decoded UV metadata for the size check; bake dimensions may change between exports.
  if (atlas.some(n => n > renderer.capabilities.maxTextureSize)) return 'lightmap atlas exceeds maxTextureSize';
  return null;
}
