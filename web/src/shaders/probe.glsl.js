// GLSL chunk of the composed baked shader (shaders/compose.js). Text only: no three, no state.

// The probe volume (lightmap.js buildProbeVolume): first-order SH per colour in one 3D texture, R, G and B stacked
// along its depth.
export const PROBE_VOLUME = `
uniform highp sampler3D uProbeSH;
uniform vec3 uProbeOrigin; uniform vec3 uProbeScale; uniform vec3 uProbeDims;
// x and north as texture coordinates, height in slices clamped to the first and last slice centres (as clamp-to-edge
// did for the separate textures), kept a hair inside so filtering never reaches the next colour's slices
vec3 probeUVW( vec3 p ) {
  vec3 g = ( p - uProbeOrigin ) * uProbeScale;              // grid units: x, height, z (north)
  return vec3( ( g.x + 0.5 ) / uProbeDims.x, ( g.z + 0.5 ) / uProbeDims.z, clamp( g.y, 0.01, uProbeDims.y - 1.01 ) );
}
vec4 probeTex( highp sampler3D t, vec3 uvw, float ch ) { return texture( t, vec3( uvw.xy, ( uvw.z + ch * uProbeDims.y + 0.5 ) / ( 3.0 * uProbeDims.y ) ) ); }
`;
// colour ch (0 R, 1 G, 2 B) of the L1 SH; with the slot crossfade the next slot's volume blends in during a fade
export const probeSHGLSL = fade => fade ? `uniform float uProbeBlend; uniform highp sampler3D uProbeNextSH;
vec4 probeSH( vec3 uvw, float ch ) { return uProbeBlend > 0.0 ? mix( probeTex( uProbeSH, uvw, ch ), probeTex( uProbeNextSH, uvw, ch ), uProbeBlend ) : probeTex( uProbeSH, uvw, ch ); }
` : `vec4 probeSH( vec3 uvw, float ch ) { return probeTex( uProbeSH, uvw, ch ); }
`;
// Irradiance from one colour's L1 SH (three's order: L0, then the y, z, x terms), Geomerics' non-linear reconstruction
// (Hazel, "Reconstructing diffuse lighting from SH"): the sphere's mean A and the linear term B as the plain evaluation
// A + dot( B, n ) has them, shaped as A * ( a + ( 1 - a ) ( p + 1 ) q^p ), never negative. The plain evaluation goes below
// zero opposite a strong source once |B| > A (beside an open doorway at noon: the inside of the closed front door read
// -0.03 / -0.05 / -0.10, clamped black, the bluest light lost first, so dark red bands; the bake's own order-2 data said
// 0.17). Same mean, same direction; one pow per colour, no extra fetch.
const PROBE_EVAL = `float probeEvalL1( vec4 c, vec3 n ) {
  float A = max( 0.886227 * c.x, 0.0 ), L = length( c.wyz ) * 1.023328;
  float r = clamp( L / max( 2.0 * A, 1e-8 ), 0.0, 1.0 ), q = clamp( 0.5 + 0.5 * dot( c.wyz, n ) * 1.023328 / max( L, 1e-8 ), 0.0, 1.0 );
  float p = 1.0 + 2.0 * r, a = ( 1.0 - r ) / ( 1.0 + r );
  return A * ( a + ( 1.0 - a ) * ( p + 1.0 ) * pow( q, p ) );
}
vec3 probeEval( BakedProbe s, vec3 n ) { return vec3( probeEvalL1( s.r, n ), probeEvalL1( s.g, n ), probeEvalL1( s.b, n ) ); }
`;
// One fetch per pixel: the three colours' SH at a point, shared by the irradiance, the specular and reflection occlusion
// and the foliage bake's mean (probeFetch), evaluated per normal (probeEval).
// Region-aware: the hardware's filter blends the 2 x 2 cells around the point (and two heights), and across the house's
// outline that mixed a garden cell into a room (at noon ~100x brighter: a few percent of it streaked the open front door
// black, red and yellow) or a room into the garden. Each cell is inside or outside by the plan's outline at its centre
// (house.glsl.js: the same test as everything else that asks "inside the house"), and a lookup reads only the cells on
// its own side: where the four cells it blends agree (everywhere but within a cell of the outline) that is the
// hardware's filter, as before; next to the outline the cells across it are left out and the rest renormalised
// (bilinear in plan, the height still filtered by the hardware); a point whose four cells are all across (a thin spot of
// the plan) keeps the plain blend.
export const PROBE_FETCH = `struct BakedProbe { vec4 r; vec4 g; vec4 b; };
void probeAdd( inout BakedProbe s, float w, vec2 cell, float height ) {
  if ( w <= 0.0 ) return;
  vec3 q = vec3( ( cell + 0.5 ) / uProbeDims.xz, height );
  s.r += w * probeSH( q, 0.0 ); s.g += w * probeSH( q, 1.0 ); s.b += w * probeSH( q, 2.0 );
}
BakedProbe probeFetch( vec3 p ) {
  vec3 uvw = probeUVW( p ), g = ( p - uProbeOrigin ) * uProbeScale;     // grid units: x, height, z (north)
  vec2 cell = floor( g.xz ), f = g.xz - cell, hi = uProbeDims.xz - 1.0, plan0 = vec2( uProbeOrigin.x, - uProbeOrigin.z ), step = vec2( 1.0 / uProbeScale.x );
  vec2 c0 = clamp( cell, vec2( 0.0 ), hi ), c1 = clamp( cell + vec2( 1.0, 0.0 ), vec2( 0.0 ), hi ), c2 = clamp( cell + vec2( 0.0, 1.0 ), vec2( 0.0 ), hi ), c3 = clamp( cell + 1.0, vec2( 0.0 ), hi );
  float side = outsideHouse( vec2( p.x, - p.z ) );
  vec4 same = vec4( equal( vec4( outsideHouse( plan0 + c0 * step ), outsideHouse( plan0 + c1 * step ), outsideHouse( plan0 + c2 * step ), outsideHouse( plan0 + c3 * step ) ), vec4( side ) ) );
  vec4 w = vec4( ( 1.0 - f.x ) * ( 1.0 - f.y ), f.x * ( 1.0 - f.y ), ( 1.0 - f.x ) * f.y, f.x * f.y );
  if ( dot( w, 1.0 - same ) <= 0.0 || dot( w, same ) <= 0.0 ) return BakedProbe( probeSH( uvw, 0.0 ), probeSH( uvw, 1.0 ), probeSH( uvw, 2.0 ) );
  w *= same / dot( w, same );
  BakedProbe s = BakedProbe( vec4( 0.0 ), vec4( 0.0 ), vec4( 0.0 ) );
  probeAdd( s, w.x, c0, uvw.z ); probeAdd( s, w.y, c1, uvw.z ); probeAdd( s, w.z, c2, uvw.z ); probeAdd( s, w.w, c3, uvw.z );
  return s;
}
` + PROBE_EVAL;
// The volume's cells are 0.5 m: one at a door, blind or curtain mixes the rooms (closet, garden) on both sides of it.
// A face that moves there is lit from a little way out (side, m) on the side it looks at, half way towards the viewer:
// a panel's bevels and a leaf's edges face along the doorway, and only the viewer says which room they are seen from.
export const PROBE_SIDE_POINT = `vec3 probeSidePoint( vec3 p, vec3 n, float side ) { return p + normalize( n + normalize( cameraPosition - p ) + 1e-4 ) * side; }
`;
// the sided lookup's distance: a full cell (0.5 m) out, so both cells the lookup blends lie on the face's side of the
// doorway (at 0.3 m a bath door took 14% from the sunlit bedroom behind it)
export const PROBE_SIDE = '0.5';
