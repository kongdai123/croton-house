// GLSL chunk of the composed baked shader (shaders/compose.js). Text only: no three, no state.

// Baked foliage light (foliage_bake.js): the per-vertex level from Cycles replaces the probes' level, the probes keep
// the colour and direction; the bake's sun visibility caps the live sun's soft shadow.
export const FOLIAGE_VERTEX_PARS = 'attribute vec3 foliage; varying vec3 vFoliage; uniform vec2 uFolK;\n';
export const FOLIAGE_VERTEX = `#include <begin_vertex>
      { vec2 y2 = foliage.xy * foliage.xy; vFoliage = vec3( uFolK * y2 / max( 1.0 - y2, vec2( 1.0 / 255.0 ) ), foliage.z ); }`;
// before main(): needs probeUVW / probeSH (probe.glsl.js) and three's PI
export const FOLIAGE_MAIN = `varying vec3 vFoliage; uniform float uFolLamps;
float foliageScale( vec3 p ) {
  vec3 uvw = probeUVW( p );
  float mean = 0.886227 * dot( vec3( probeSH( uvw, 0.0 ).x, probeSH( uvw, 1.0 ).x, probeSH( uvw, 2.0 ).x ), vec3( 0.2126, 0.7152, 0.0722 ) );
  return min( PI * ( vFoliage.x + uFolLamps * vFoliage.y ) / max( mean, 1e-5 ), 8.0 );
}
void main() {`;
