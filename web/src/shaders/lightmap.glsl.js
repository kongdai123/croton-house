// GLSL chunk of the composed baked shader (shaders/compose.js). Text only: no three, no state.

// Lightmap atlas decoding: RGBM (legacy) or the v2 tone curve sqrt(x / (x + K)), and the filtered sample of lightmap.js
// (LM_FILTER: 0 decode-then-mix when magnified, hardware when minified; 1 always decode; 2 always hardware).
export const RGBM_DECODE = 'vec3 lmDecode( vec4 t, float K ) { vec3 c = t.rgb * t.a; return c * c * 8.0; }';
export const TONE_DECODE = `vec3 lmDecode( vec4 t, float K ) { vec3 y2 = t.rgb * t.rgb; return K * y2 / max( 1.0 - y2, vec3( 1.0 / 255.0 ) ); }`;
export const lmSampleGLSL = filter => `
#define LM_FILTER ${filter}
uniform vec2 uLmK;
vec3 lmSample( sampler2D tex, vec2 uv, float K ) {
  ivec2 size = textureSize( tex, 0 ), hi = size - 1;
  vec2 tc = uv * vec2( size ), dx = dFdx( tc ), dy = dFdy( tc );
#if LM_FILTER == 2
  return lmDecode( texture( tex, uv ), K );
#elif LM_FILTER == 0
  if ( max( dot( dx, dx ), dot( dy, dy ) ) > 1.0 ) return lmDecode( texture( tex, uv ), K );
#endif
  vec2 p = tc - 0.5, f = fract( p ); ivec2 i = ivec2( floor( p ) );
  vec3 a = lmDecode( texelFetch( tex, clamp( i, ivec2( 0 ), hi ), 0 ), K );
  vec3 b = lmDecode( texelFetch( tex, clamp( i + ivec2( 1, 0 ), ivec2( 0 ), hi ), 0 ), K );
  vec3 c = lmDecode( texelFetch( tex, clamp( i + ivec2( 0, 1 ), ivec2( 0 ), hi ), 0 ), K );
  vec3 d = lmDecode( texelFetch( tex, clamp( i + ivec2( 1 ), ivec2( 0 ), hi ), 0 ), K );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}
`;

// GLSL: lampGroups(uv) = sum over layers of colours * (levels * decoded luminances). Needs lmSampleGLSL's
// LM_FILTER define. A layer whose three groups are all off is skipped (uniform branch).
export function lampGroupGLSL(T) {
  let s = `uniform highp sampler2DArray uLampTex;
vec3 lmDecode3( vec4 t, vec3 K ) { vec3 y2 = t.rgb * t.rgb; return K * y2 / max( 1.0 - y2, vec3( 1.0 / 255.0 ) ); }
vec3 lmSample3( vec2 uv, int layer, vec3 K ) {
  ivec2 size = textureSize( uLampTex, 0 ).xy, hi = size - 1;
  vec2 tc = uv * vec2( size ), dx = dFdx( tc ), dy = dFdy( tc );
#if LM_FILTER == 2
  return lmDecode3( texture( uLampTex, vec3( uv, float( layer ) ) ), K );
#elif LM_FILTER == 0
  if ( max( dot( dx, dx ), dot( dy, dy ) ) > 1.0 ) return lmDecode3( texture( uLampTex, vec3( uv, float( layer ) ) ), K );
#endif
  vec2 p = tc - 0.5, f = fract( p ); ivec2 i = ivec2( floor( p ) );
  vec3 a = lmDecode3( texelFetch( uLampTex, ivec3( clamp( i, ivec2( 0 ), hi ), layer ), 0 ), K );
  vec3 b = lmDecode3( texelFetch( uLampTex, ivec3( clamp( i + ivec2( 1, 0 ), ivec2( 0 ), hi ), layer ), 0 ), K );
  vec3 c = lmDecode3( texelFetch( uLampTex, ivec3( clamp( i + ivec2( 0, 1 ), ivec2( 0 ), hi ), layer ), 0 ), K );
  vec3 d = lmDecode3( texelFetch( uLampTex, ivec3( clamp( i + ivec2( 1 ), ivec2( 0 ), hi ), layer ), 0 ), K );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}
`;
  for (let t = 0; t < T; t++) s += `uniform vec3 uLampK${t}; uniform vec3 uLampLv${t}; uniform mat3 uLampC${t};\n`;
  s += 'vec3 lampGroups( vec2 uv ) {\n  vec3 c = vec3( 0.0 );\n';
  for (let t = 0; t < T; t++) s += `  if ( uLampLv${t}.x + uLampLv${t}.y + uLampLv${t}.z > 0.0 ) c += uLampC${t} * ( uLampLv${t} * lmSample3( uv, ${t}, uLampK${t} ) );\n`;
  return s + '  return c;\n}\n';
}
