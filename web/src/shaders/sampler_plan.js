// The baked shader's fragment sampler plan: which optional features a material keeps within the GPU's fragment texture
// units (16 on Apple GPUs, 32 on NVIDIA), decided from its flags BEFORE its shader is generated, so the generated text
// never needs a drop afterwards. Pure: no three, no state.
//
// Costs (fragment samplers) of what the composed shader adds to three's own (threeSamplers, flags.threeSamplers):
//   probe path      uProbeSH 1; slotFade + uProbeNextSH 1
//   lightmap path   the atlas is three's lightMap; uLampTex 1 with lamp groups, else uLmLamps 1;
//                   slotFade + uSlotNext 1, + uSlotNextLamps 1 without lamp groups
//   refl            uReflTex 1 (every probe, both slots and the lamp layers in one array)
//   PCSS            uSunDepth 1 (always)
//   contactSun      uContactDepth + uContactCoverage 2
//   planarPuddle    uPuddleTex 1
// Optional features, in the order they are left out while over the limit (each leaves out its samplers):
//   1. planarPuddle  (the puddles keep the probe / sky reflection)
//   2. contactSun    (the moving casters' sun contact; their AO stays, it costs no sampler)
//   3. slotFade      (the next slot's light during a fade: the fade then jumps at its end)
// Nothing else is optional: a material still over the limit is warned about (sampler_budget.js), and the post-link
// audit (auditPrograms, lightmap.js) lowers that material's limit and recompiles it if it fails to link anyway.
export const DROP_ORDER = ['planarPuddle', 'contactSun', 'slotFade'];
export const DROP_NAMES = { planarPuddle: 'planar puddle', contactSun: 'contact sun', slotFade: 'slot crossfade' };

// what the flags add to three's samplers
export function bakedSamplers(f) {
  let n = 1;   // uSunDepth
  if (f.path === 'probe') n += 1 + (f.slotFade ? 1 : 0);
  else n += 1 + (f.slotFade ? (f.lampGroups > 0 ? 1 : 2) : 0);
  if (f.refl) n += 1;
  if (f.contactSun) n += 2;
  if (f.planarPuddle) n += 1;
  return n;
}

// -> { flags (the plan's), count, start (before leaving anything out), limit, dropped: [names], over }
export function samplerPlan(flags, maxTextures = 16) {
  let f = flags, count = (flags.threeSamplers | 0) + bakedSamplers(flags);
  const start = count, dropped = [];
  for (const k of DROP_ORDER) {
    if (count <= maxTextures) break;
    if (!f[k]) continue;
    f = { ...f, [k]: false };
    count = (f.threeSamplers | 0) + bakedSamplers(f);
    dropped.push(DROP_NAMES[k]);
  }
  return { flags: f, count, start, limit: maxTextures, dropped, over: count > maxTextures };
}

// three's own fragment samplers for a baked material, as its program declares them (sampler_budget.js
// fragmentSamplers counts the same from the program parameters): each map it has (the lightmap atlas included), dfgLUT
// (every Standard / Physical program), the environment map (every baked material gets the bake's sky), transmission's
// buffer and the sun's shadow map.
export const MAPS = ['map', 'matcap', 'alphaMap', 'aoMap', 'bumpMap', 'normalMap', 'emissiveMap', 'metalnessMap', 'roughnessMap',
  'anisotropyMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'iridescenceMap', 'iridescenceThicknessMap',
  'sheenColorMap', 'sheenRoughnessMap', 'specularMap', 'specularColorMap', 'specularIntensityMap', 'transmissionMap',
  'thicknessMap', 'gradientMap', 'lightMap'];
export function threeSamplers(material, { envMap = true, shadows = 1 } = {}) {
  let n = 1 + shadows + (envMap ? 1 : 0) + (material.transmission > 0 ? 1 : 0);
  for (const k of MAPS) if (material[k]) n++;
  return n;
}
