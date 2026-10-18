// GLSL chunk of the composed baked shader (shaders/compose.js). Text only: no three, no state.

// Sheer voile under the baked light (the composed probe shader's sheer flag: materials with userData.sheer = { reflect,
// transmit }). Real voile shows two things: the room-side light its fibres reflect, and the window-side light they
// scatter through (diffuse transmission: soft, with no image of what is behind), so the cloth is read from the probe
// volume on both sides. The probes sample open air, but a ripplefold panel drawn back into its stack (or a narrow panel,
// whose 12 folds share less width) shades itself fold by fold: both terms carry that occlusion, from 0.3 for a tight
// stack to 1 for a panel drawn across, by how far the panel's folds are spread (its world x scale). The reflect /
// transmit split is decor.js's, shared with photo mode and Cycles (setup.py), where a bunched stack reads ~0.8x the wall
// above it.
// The walkthrough's daytime glow (lighting.js lifts every emissive material to 0.12) has no place here: the cloth only
// returns light it receives. The sun reaching the back of the cloth is transmitted by the same fraction, and the sheen
// is kept soft.
export const SHEER_VERTEX_PARS = 'varying float vSheerSpread;\n';
export const SHEER_SPREAD_LINE = '\n\tvSheerSpread = length( modelMatrix[ 0 ].xyz );';
// declared ahead of three's physical BRDF, whose direct diffuse term it replaces
export const SHEER_PARS = 'uniform vec2 uSheer; varying float vSheerSpread;\nvec2 sheerResponse() { return uSheer * mix( 0.3, 1.0, smoothstep( 0.05, 0.7, vSheerSpread ) ); }\n';
export const SHEER_DIRECT_LINE = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution );\n}';
export const SHEER_DIRECT = 'vec2 sheerK = sheerResponse();\n\treflectedLight.directDiffuse += ( sheerK.x * irradiance + sheerK.y * saturate( - dot( geometryNormal, directLight.direction ) ) * directLight.color ) * BRDF_Lambert( material.diffuseContribution );\n}';
export const SHEER_EMISSION = 'vec3 totalEmissiveRadiance = vec3( 0.0 );';
export const SHEER_SHEEN_TAIL = '\n#ifdef USE_SHEEN\n\tmaterial.sheenColor *= 0.3;\n#endif';
// Fold overlap has optical depth: a narrow/bunched panel covers the background with many cloth layers. After the alpha
// map, so even its weave holes close up in the stack. The same world spread drives the lighting occlusion.
export const SHEER_COVERAGE_LINE = '\n diffuseColor.a = 1.0 - pow( max( 1.0 - diffuseColor.a, 0.0 ), max( 1.0, 0.7 / max( vSheerSpread, 0.02 ) ) );';
// both faces from the pixel's probe fetch: the room side reflected, the window side transmitted; ao: the contact AO factor
export const sheerIrradiance = (probe, ao = '') => `{ vec3 sheerN = inverseTransformDirection( geometryNormal, viewMatrix ); vec2 sheerK = sheerResponse();
      irradiance += ${ao ? ao + '( ' : ''}sheerK.x * probeEval( ${probe}, sheerN ) + sheerK.y * probeEval( ${probe}, - sheerN )${ao ? ' )' : ''}; }`;
