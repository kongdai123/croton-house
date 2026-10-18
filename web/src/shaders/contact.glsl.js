// GLSL chunk of the composed baked shader (shaders/compose.js). Text only: no three, no state.

// Moving-caster sun contact (contact.js): a short screen-space march towards the sun through the casters' depth, only
// where the CPU's coverage grid says a caster is near. steps: the march length in taps (?contactsteps).
export const contactSunGLSL = steps => `
uniform sampler2D uContactDepth; uniform sampler2D uContactCoverage; uniform vec2 uContactSize;
uniform mat4 uContactView; uniform mat4 uContactProjection; uniform mat4 uContactInvProjection; uniform vec3 uContactDirection;
uniform float uContactReady; uniform float uContactSun; uniform float uContactCaster;
uniform float uContactLength; uniform float uContactBias; uniform float uContactThickness; uniform float uContactFrame;
float contactSun( vec3 P, vec3 N ) {
  // Mirrors use another camera. Movables retain their existing PCSS self-shadowing.
  if ( uContactReady < 0.5 || uContactSun <= 0.0 || uContactCaster > 0.5 || dot( N, uContactDirection ) <= 0.0
    || length( viewMatrix[3] - uContactView[3] ) + length( viewMatrix[2] - uContactView[2] ) > 0.001 ) return 1.0;
  vec4 clip = uContactProjection * vec4( P, 1.0 ); vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
  if ( clip.w <= 0.0 || min( uv.x, uv.y ) <= 0.0 || max( uv.x, uv.y ) >= 1.0 ) return 1.0;
  // CPU projects expanded caster bounds into a tiny grid. Most fragments stop after this one nearest fetch.
  vec2 range = texture2D( uContactCoverage, uv ).rg;
  if ( range.y <= 0.0 || -P.z < range.x || -P.z > range.y ) return 1.0;
  // Interleaved gradient noise changes only under TAA; the depth map itself stays unjittered and cacheable.
  float noise = fract( 52.9829189 * fract( dot( gl_FragCoord.xy + 5.588238 * uContactFrame, vec2( 0.06711056, 0.00583715 ) ) ) ), occ = 0.0;
  for ( int i = 0; i < ${steps}; i ++ ) {
    float dist = mix( 0.02, uContactLength, ( float( i ) + noise * 0.5 ) / float( ${steps} ) );
    vec3 ray = P + N * uContactBias + uContactDirection * dist; vec4 q = uContactProjection * vec4( ray, 1.0 );
    if ( q.w <= 0.0 ) break;
    vec2 sampleUv = q.xy / q.w * 0.5 + 0.5;
    if ( min( sampleUv.x, sampleUv.y ) <= 0.0 || max( sampleUv.x, sampleUv.y ) >= 1.0 ) break;
    if ( length( ( sampleUv - uv ) * uContactSize ) < 1.25 ) continue;
    float depth = texture2D( uContactDepth, sampleUv ).r;
    if ( depth >= 0.999999 ) continue;
    vec4 hitPosition = uContactInvProjection * vec4( sampleUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0 );
    float delta = hitPosition.z / hitPosition.w - ray.z, thick = uContactThickness + dist * 0.05;
    float hit = smoothstep( uContactBias, uContactBias * 2.0, delta ) * ( 1.0 - smoothstep( thick * 0.7, thick, delta ) );
    float edge = smoothstep( 0.0, 3.0, min( min( sampleUv.x, 1.0 - sampleUv.x ) * uContactSize.x, min( sampleUv.y, 1.0 - sampleUv.y ) * uContactSize.y ) );
    occ = max( occ, hit * edge * ( 1.0 - smoothstep( uContactLength * 0.8, uContactLength, dist ) ) );
  }
  return 1.0 - occ * uContactSun;
}
`;
// Moving AO under the casters (contact.js proxies): up to `max` oriented blobs, on up-facing receivers.
export const contactAOGLSL = max => `
uniform int uContactCount; uniform vec4 uContactPos[${max}]; uniform vec4 uContactShape[${max}]; uniform float uContactAO;
float contactAO( vec3 P, vec3 N ) {
  float facing = smoothstep( 0.7, 0.95, N.y ); if ( facing <= 0.0 || uContactAO <= 0.0 ) return 1.0;
  float occ = 0.0;
  for ( int i = 0; i < ${max}; i ++ ) {
    if ( i >= uContactCount ) break;
    vec4 c = uContactPos[i], s = uContactShape[i]; float gap = c.y - P.y;
    if ( gap < -0.03 || gap > 0.45 ) continue;
    vec2 d = P.xz - c.xz, q = vec2( s.z * d.x - s.w * d.y, s.w * d.x + s.z * d.y ) * s.xy;
    float r2 = dot( q, q ); if ( r2 >= 4.0 ) continue;
    float blob = pow( max( 0.0, 1.0 - r2 * 0.25 ), 3.0 );
    float height = ( 1.0 - smoothstep( 0.0, 0.45, max( gap, 0.0 ) ) ) / ( 1.0 + max( gap, 0.0 ) * 8.0 );
    occ += c.w * blob * height * smoothstep( -0.03, 0.0, gap );
  }
  return 1.0 - min( 0.6, occ * facing * uContactAO );
}
`;
