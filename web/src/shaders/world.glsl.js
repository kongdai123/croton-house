// GLSL chunk of the composed baked shader (shaders/compose.js). Text only: no three, no state.

// The pixel's world position, once per shader (the probe volume, wet ground, reflection probes, contact AO and the planar
// puddle all read it), with three's batching and instancing transforms.
export const WORLD_VARYING = 'varying vec3 vBakedWorld;\n';
export const WORLD_VERTEX = `
    vec4 bakedPosition = vec4( transformed, 1.0 );
    #ifdef USE_BATCHING
      bakedPosition = batchingMatrix * bakedPosition;
    #endif
    #ifdef USE_INSTANCING
      bakedPosition = instanceMatrix * bakedPosition;
    #endif
    vBakedWorld = ( modelMatrix * bakedPosition ).xyz;`;
