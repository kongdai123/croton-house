// GLSL chunk of the composed baked shader (shaders/compose.js). Text only: no three, no state.
import { insideGLSL } from '../plan.js';

// Per-pixel wet ground and puddles after rain (world position, up-facing, low, outside the house): the mask and the
// puddle noise.
export const WET_GLSL = `
varying vec3 vWetWorld;
uniform float uWet;
${insideGLSL('outsideHouse')}
float wetGround( vec3 nWorld ) { return uWet * outsideHouse( vec2( vWetWorld.x, -vWetWorld.z ) ) * smoothstep( 0.8, 0.95, nWorld.y ) * ( 1.0 - smoothstep( 0.3, 0.6, vWetWorld.y ) ); }
float wetHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float wetNoise( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( wetHash( i ), wetHash( i + vec2( 1, 0 ) ), f.x ), mix( wetHash( i + vec2( 0, 1 ) ), wetHash( i + vec2( 1, 1 ) ), f.x ), f.y ); }
float puddle() { vec2 p = vWetWorld.xz * 0.35; float n = 0.55 * wetNoise( p ) + 0.3 * wetNoise( p * 2.1 + 5.2 ) + 0.15 * wetNoise( p * 4.3 + 9.1 );
  return smoothstep( 0.56, 0.6, n ); }
`;
