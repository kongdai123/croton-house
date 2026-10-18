// GLSL chunk of the composed baked shader (shaders/compose.js). Text only: no three, no state.

// Baked foliage light (foliage_bake.js): the per-vertex level from Cycles replaces the probes' level, the probes keep
// the colour and direction; the bake's sun visibility caps the live sun's soft shadow.
// The probe's mean comes from the pixel's one probe fetch; the slot crossfade blends the per-vertex level (current ->
// next slot) in the vertex stage.
export const foliageVertexPars = fade => 'attribute vec3 foliage; varying vec3 vFoliage; uniform vec2 uFolK;\n' +
  (fade ? 'attribute vec3 foliageNext; uniform float uSlotBlend; uniform float uSlotLampA; uniform float uSlotLampB;\n' : '');
export const foliageVertexGLSL = fade => `
      { vec2 y2 = foliage.xy * foliage.xy; vFoliage = vec3( uFolK * y2 / max( 1.0 - y2, vec2( 1.0 / 255.0 ) ), foliage.z );${fade ? ' vFoliage = vec3( mix( vFoliage.x + uSlotLampA * vFoliage.y, foliageNext.x + uSlotLampB * foliageNext.y, uSlotBlend ), 0., mix( vFoliage.z, foliageNext.z, uSlotBlend ) );' : ''} }`;
// needs probe.glsl.js's BakedProbe and three's PI
export const FOLIAGE_PARS = `varying vec3 vFoliage; uniform float uFolLamps;
float foliageScale( BakedProbe s ) {
  float mean = 0.886227 * dot( vec3( s.r.x, s.g.x, s.b.x ), vec3( 0.2126, 0.7152, 0.0722 ) );
  return min( PI * ( vFoliage.x + uFolLamps * vFoliage.y ) / max( mean, 1e-5 ), 8.0 );
}
`;
