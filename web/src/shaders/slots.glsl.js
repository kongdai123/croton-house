// GLSL chunk of the composed baked shader (shaders/compose.js). Text only: no three, no state.

// The time-slot crossfade (lightmap_slots.js): the next slot's probe volume blended into probeSH, and the foliage bake's
// per-vertex level blended in the vertex stage.
export const SLOT_PROBE_TAP = 'return probeTex( uProbeSH, uvw, ch );';
export const SLOT_PROBE_PARS = 'uniform float uProbeBlend; uniform highp sampler3D uProbeNextSH;\n';
export const SLOT_PROBE_BLEND = 'return uProbeBlend > 0.0 ? mix( probeTex( uProbeSH, uvw, ch ), probeTex( uProbeNextSH, uvw, ch ), uProbeBlend ) : probeTex( uProbeSH, uvw, ch );';
export const SLOT_FOLIAGE_PARS = 'attribute vec3 foliageNext; uniform float uSlotBlend; uniform float uSlotLampA; uniform float uSlotLampB;\n';
export const SLOT_FOLIAGE_END = 'foliage.z ); }';
export const SLOT_FOLIAGE_BLEND = `foliage.z ); vFoliage = vec3( mix( vFoliage.x + uSlotLampA * vFoliage.y, foliageNext.x + uSlotLampB * foliageNext.y, uSlotBlend ), 0., mix( vFoliage.z, foliageNext.z, uSlotBlend ) ); }`;
