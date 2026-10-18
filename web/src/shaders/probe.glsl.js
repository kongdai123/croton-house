// GLSL chunk of the composed baked shader (shaders/compose.js). Text only: no three, no state.

// The probe volume (lightmap.js buildProbeVolume): first-order SH per colour in one 3D texture, R, G and B stacked
// along its depth.
export const PROBE_GLSL = `
uniform highp sampler3D uProbeSH;
uniform vec3 uProbeOrigin; uniform vec3 uProbeScale; uniform vec3 uProbeDims;
varying vec3 vProbeWorld;
// x and north as texture coordinates, height in slices clamped to the first and last slice centres (as clamp-to-edge
// did for the separate textures), kept a hair inside so filtering never reaches the next colour's slices
vec3 probeUVW( vec3 p ) {
  vec3 g = ( p - uProbeOrigin ) * uProbeScale;              // grid units: x, height, z (north)
  return vec3( ( g.x + 0.5 ) / uProbeDims.x, ( g.z + 0.5 ) / uProbeDims.z, clamp( g.y, 0.01, uProbeDims.y - 1.01 ) );
}
vec4 probeTex( highp sampler3D t, vec3 uvw, float ch ) { return texture( t, vec3( uvw.xy, ( uvw.z + ch * uProbeDims.y + 0.5 ) / ( 3.0 * uProbeDims.y ) ) ); }
// colour ch (0 R, 1 G, 2 B) of the L1 SH; the slot runtime blends the next slot's volume in here
vec4 probeSH( vec3 uvw, float ch ) { return probeTex( uProbeSH, uvw, ch ); }
vec3 probeIrradiance( vec3 p, vec3 n ) {
  vec3 uvw = probeUVW( p );
  vec4 r = probeSH( uvw, 0.0 ), gg = probeSH( uvw, 1.0 ), b = probeSH( uvw, 2.0 );
  vec4 basis = vec4( 0.886227, 1.023328 * n.y, 1.023328 * n.z, 1.023328 * n.x );
  return max( vec3( dot( r, basis ), dot( gg, basis ), dot( b, basis ) ), 0.0 );
}
// The volume's cells are 0.5 m: one at a door, blind or curtain mixes the rooms (closet, garden) on both sides of it.
// A face that moves there is lit from a little way out (side, m) on the side it looks at, half way towards the viewer:
// a panel's bevels and a leaf's edges face along the doorway, and only the viewer says which room they are seen from.
vec3 probeIrradiance( vec3 p, vec3 n, float side ) { return probeIrradiance( p + normalize( n + normalize( cameraPosition - p ) + 1e-4 ) * side, n ); }
`;
// the side argument of the lookup above, for probeLit's sided materials: a full cell (0.5 m) out, so both cells the
// lookup blends lie on the face's side of the doorway (at 0.3 m a bath door took 14% from the sunlit bedroom behind it)
export const PROBE_SIDE = ', 0.5';
