// GLSL chunk of the composed baked shader (shaders/compose.js). Text only: no three, no state.

// The planar puddle reflection (puddles.js): one mirrored half-resolution render of the street-side ground plane,
// read where the wet mask holds a puddle, with small travelling wind ripples.
export const PLANAR_PUDDLE_GLSL = `
uniform sampler2D uPuddleTex;
uniform mat4 uPuddleMatrix;
uniform float uPuddleValid, uPuddleTime, uPuddleY, uPuddleEdge, uPuddleWind;
vec3 puddleNormal( vec3 p ) {
  vec2 a = vec2( 0.94, 0.34 ), b = vec2( -0.28, 0.96 );
  vec2 slope = uPuddleWind * ( a * cos( dot( p.xz, a ) * 3.1 - uPuddleTime * 0.65 ) + 0.45 * b * cos( dot( p.xz, b ) * 5.3 - uPuddleTime * 0.43 ) );
  return normalize( vec3( -slope.x, 1.0, -slope.y ) );
}
vec3 puddleRadiance( vec3 fallback, vec3 p, vec3 n ) {
  if ( uPuddleValid < 0.5 ) return fallback;
  float height = 1.0 - smoothstep( 0.012, 0.04, abs( p.y - uPuddleY ) );
  // Small travelling wind slopes only; no raindrop rings. Flatten the receiving point onto the mirror plane.
  vec3 q = vec3( p.x, uPuddleY, p.z );
  q.xz += n.xz * min( distance( cameraPosition, p ), 20.0 ) * 2.0;
  vec4 sc = uPuddleMatrix * vec4( q, 1.0 );
  if ( sc.w <= 0.0 || height <= 0.0 ) return fallback;
  vec2 uv = sc.xy / sc.w;
  vec2 e = min( uv, 1.0 - uv );
  float edge = smoothstep( 0.0, uPuddleEdge, min( e.x, e.y ) );
  if ( edge <= 0.0 ) return fallback;
  vec4 planar = texture2D( uPuddleTex, uv );
  return mix( fallback, planar.rgb, height * edge * clamp( planar.a, 0.0, 1.0 ) );
}
`;
