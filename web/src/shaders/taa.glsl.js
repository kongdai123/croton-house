// GLSL chunk of the composed baked shader (shaders/compose.js). Text only: no three, no state.

// TAA's texture LOD bias (taa.js): surface maps sampled with the bias of the reduced render resolution.
export const TAA_GLSL = `uniform float uTaaLodBias;
vec4 taaSample(sampler2D tex, vec2 uv) { return texture2D(tex, uv, uTaaLodBias); }
vec4 taaSample(sampler2D tex, vec2 uv, float bias) { return texture2D(tex, uv, bias + uTaaLodBias); }
`;
