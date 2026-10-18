// GLSL chunk of the composed baked shader (shaders/compose.js). Text only: no three, no state.

// Sheer voile under the baked light (materials.js): the room-side light its fibres reflect and the window-side light they
// scatter through, both read from the probe volume, with the fold overlap's occlusion and optical depth.
export const SHEER_SPREAD = '#include <project_vertex>\n\tvSheerSpread = length( modelMatrix[ 0 ].xyz );';
export const SHEER_DIRECT = 'vec2 sheerK = sheerResponse();\n\treflectedLight.directDiffuse += ( sheerK.x * irradiance + sheerK.y * saturate( - dot( geometryNormal, directLight.direction ) ) * directLight.color ) * BRDF_Lambert( material.diffuseContribution );\n}';
export const SHEER_EMISSION = 'vec3 totalEmissiveRadiance = vec3( 0.0 );';
export const SHEER_SHEEN = '#include <lights_physical_fragment>\n#ifdef USE_SHEEN\n\tmaterial.sheenColor *= 0.3;\n#endif';
export const SHEER_PROBE = `{ vec3 sheerN = inverseTransformDirection( geometryNormal, viewMatrix ); vec2 sheerK = sheerResponse();
      irradiance += sheerK.x * probeIrradiance( vProbeWorld, sheerN ) + sheerK.y * probeIrradiance( vProbeWorld, - sheerN ); }`;
export const SHEER_COVERAGE = '#include <alphamap_fragment>\n diffuseColor.a = 1.0 - pow( max( 1.0 - diffuseColor.a, 0.0 ), max( 1.0, 0.7 / max( vSheerSpread, 0.02 ) ) );';
export const SHEER_PARS = 'uniform vec2 uSheer; varying float vSheerSpread;\nvec2 sheerResponse() { return uSheer * mix( 0.3, 1.0, smoothstep( 0.05, 0.7, vSheerSpread ) ); }\n';
export const SHEER_VERTEX_PARS = 'varying float vSheerSpread;\n';
export const SHEER_PROBE_LINE = 'irradiance += probeIrradiance( vProbeWorld, inverseTransformDirection( geometryNormal, viewMatrix ) );';
export const SHEER_DIRECT_LINE = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution );\n}';
