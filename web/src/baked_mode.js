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
  // Half-float render targets (planar puddles, local adaptation, auto exposure; full floats there only when renderable).
  // Every texture baked mode filters linearly is half float or 8-bit (probe volume, reflection probes, skies, atlases):
  // no OES_texture_float_linear, which iOS lacks (WebKit bug 264404).
  if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) return 'half-float render targets unavailable';
  // Supply decoded UV metadata for the size check; bake dimensions may change between exports.
  if (atlas.some(n => n > renderer.capabilities.maxTextureSize)) return 'lightmap atlas exceeds maxTextureSize';
  return null;
}
