// GLSL chunk of the composed baked shader (shaders/compose.js). Text only: no three, no state.

// Reflection probes (lightmap.js loadReflections): per pixel the probe whose box holds the point, the reflected ray
// intersected with that box (parallax correction), sampled at a blur level set by roughness.
// With slots, the current and the next slot are two halves of one array (lightmap_slots.js): one sampler, the layer
// offsets uReflBase / uReflNext pick the halves, and the second read happens only during a fade.
// Mirrors need a small edge allowance without reaching through a bedroom partition.
export const reflGLSL = (n, slots = false, mirror = false, lamps = null) => `
#define REFL_COUNT ${n}
${slots ? 'uniform float uReflBlend; uniform float uReflBase; uniform float uReflNext;' : ''}
${lamps ? `uniform vec2 uReflLamp[ REFL_COUNT ]; uniform vec4 uReflLampW[ ${Math.ceil(lamps.count / 4)} ]; uniform float uReflLampBase;` : ''}
uniform highp sampler2DArray uReflTex; uniform vec3 uReflPos[ REFL_COUNT ]; uniform vec3 uReflMin[ REFL_COUNT ]; uniform vec3 uReflMax[ REFL_COUNT ]; uniform float uReflMips;
vec3 reflProbe( vec3 P, vec3 R, float rough ) {
  // the probe whose box holds the point (a small allowance for surfaces on its faces), then one whose box holds it with
  // a wider margin, then the nearest: a margin alone let a probe reach through a partition into the next room
  int best = 0; float bestScore = 1e9;
  for ( int i = 0; i < REFL_COUNT; i ++ ) {
    vec3 size = uReflMax[ i ] - uReflMin[ i ];
    if ( min( size.x, size.z ) < 0.3 ) continue;   // wall slivers contain mostly black reflections
    bool inBox = all( greaterThanEqual( P, uReflMin[ i ] - 0.03 ) ) && all( lessThanEqual( P, uReflMax[ i ] + 0.03 ) );
    bool nearBox = all( greaterThanEqual( P, uReflMin[ i ] - ${mirror ? '0.03' : '0.25'} ) ) && all( lessThanEqual( P, uReflMax[ i ] + ${mirror ? '0.03' : '0.25'} ) );
    float score = distance( P, uReflPos[ i ] ) + ( inBox ? 0.0 : nearBox ? 100.0 : 1000.0 );
    if ( score < bestScore ) { bestScore = score; best = i; }
  }
  vec3 dir = R;
  if ( bestScore < 1000.0 ) {
    float nearT = -1e20, farT = 1e20; bool hit = true;
    for ( int axis = 0; axis < 3; axis ++ ) {
      float lo = uReflMin[ best ][ axis ], hi = uReflMax[ best ][ axis ];
      if ( abs( R[ axis ] ) < 1e-7 ) {
        if ( P[ axis ] < lo || P[ axis ] > hi ) hit = false;
      } else {
        float a = ( lo - P[ axis ] ) / R[ axis ], b = ( hi - P[ axis ] ) / R[ axis ];
        nearT = max( nearT, min( a, b ) ); farT = min( farT, max( a, b ) );
      }
    }
    if ( hit && farT >= max( nearT, 0.0 ) ) {
      vec3 projected = P + R * farT - uReflPos[ best ];
      if ( dot( projected, projected ) > 1e-12 ) dir = normalize( projected );
    }
  }
  vec2 uv = vec2( atan( dir.z, dir.x ) * 0.15915494 + 0.5, asin( clamp( dir.y, -1.0, 1.0 ) ) * 0.31830989 + 0.5 );
  float reflLod = clamp( rough, 0.0, 1.0 ) * uReflMips;
  ${slots ? `vec3 refl = textureLod( uReflTex, vec3( uv, float( best ) + uReflBase ), reflLod ).rgb;
  if ( uReflBlend > 0.0 ) refl = mix( refl, textureLod( uReflTex, vec3( uv, float( best ) + uReflNext ), reflLod ).rgb, uReflBlend );` : 'vec3 refl = textureLod( uReflTex, vec3( uv, float( best ) ), reflLod ).rgb;'}
  ${lamps ? `// the probe's lamp layers, each at its groups' switch levels (skipped while they are off)
  vec2 lampRange = uReflLamp[ best ];
  for ( int k = 0; k < ${lamps.max}; k ++ ) {
    if ( float( k ) >= lampRange.y ) break;
    int l = int( lampRange.x ) + k; float w = uReflLampW[ l >> 2 ][ l & 3 ];
    if ( w > 0.0 ) refl += w * textureLod( uReflTex, vec3( uv, uReflLampBase + float( l ) ), reflLod ).rgb;
  }` : ''}
  return refl;
}
`;
// the reflection term for a patched material: world position varying + the lookup in place of three's sky map
// three's clearcoat image-based light (lights_fragment_maps): unpatched, it adds the open sunrise sky to every clearcoated
// surface indoors (the quartz counters read 0.57 linear with the lamps off, Cycles 0.009)
export const CLEARCOAT_IBL = 'clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );';
