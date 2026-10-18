// The baked shader's feature flags: what one material's composed shader (compose.js) contains, decided once from the
// lighting manifest (lighting_roles.js records) and the facts of the loaded bake, never from names, ids or positions.
// Pure: no three, no state. bakedFeatures() gives what a material asks for; samplerPlan() (sampler_plan.js) leaves out
// optional features a GPU has no texture units for; flagsKey() is the program cache key's part.
//
// Flags (every one always present, so equal flag sets compare equal):
//   path            'probe' (the probe volume: plants, glass, cloth, doors, movables, pets) | 'lightmap' (the atlas)
//   lmEncoding      lightmap: 'tone' (v2, sqrt(x / (x + K))) | 'rgbm'
//   lmFilter        lightmap: 0 decode-then-mix when magnified | 1 always decode | 2 hardware (?lmfilter)
//   lampGroups      lightmap: textures of the lamp-group array (switchable lamps); 0 = the shared lamps layer
//   sided           probe: lit from the side the face looks at (mesh probeSide 'face': doors, blinds, curtains)
//   leafSide        probe: the normal follows the face seen (material twoSided 'faceDirection': leaf cards)
//   groundOcclusion probe: the foliage's darkening near the ground (material foliage.groundOcclusion, not foliage-baked)
//   foliageBake     probe: the per-vertex foliage bake scales the probe light (foliage_bake.js covered the mesh)
//   sheer           probe: sheer cloth, lit from both faces (material sheer)
//   multi           several time slots loaded (the slot uniforms; the reflection probes' two halves)
//   slotFade        the next slot read during a slot fade (optional, see sampler_plan.js)
//   wet             per-pixel wet ground and puddles (outdoors, up-facing, near the ground)
//   planarPuddle    the planar puddle reflection on puddles (optional)
//   refl            reflection probes: { count, slots, lamps: { count, max } | null } | null
//   mirror          the room's probe at full strength, the tight box margin (material reflection 'mirror')
//   contactSun      moving-caster sun contact (optional)
//   contactAO       moving contact AO under the casters
//   contactSteps    the sun contact march's taps (?contactsteps)
//   contactMax      the AO's blob capacity
//   taa             TAA's texture LOD bias on the surface maps (taa.js)
//   surface         per-vertex roughness / metalness (attribute hqSurface: the mirrors' merged reflection geometry)
//   diffuse         diffuse only: no specular term, no SSR tag (the planar puddle reflection's copies)

export const FLAG_DEFAULTS = Object.freeze({
  path: 'probe', lmEncoding: 'tone', lmFilter: 0, lampGroups: 0,
  sided: false, leafSide: false, groundOcclusion: false, foliageBake: false, sheer: false,
  multi: false, slotFade: false, wet: false, planarPuddle: false, refl: null, mirror: false,
  contactSun: false, contactAO: false, contactSteps: 8, contactMax: 16, taa: false, surface: false, diffuse: false,
});

// material: lightingOf(m) (lighting_roles.js); mesh: the record of the mesh the material was made for (lightmap path: its
// weather class; probe path: { probeSide }), or null; env: the loaded bake and per-material facts:
//   { path, multi, wet (slot wetness), refl ({ count, slots, lamps } | null), contact ({ steps, max } | null),
//     lmEncoding, lmFilter, lampGroups, foliageBake, planarPuddle, taa, surface, diffuse }
export function bakedFeatures(material, mesh, env) {
  const L = material ?? {}, path = env.path === 'lightmap' ? 'lightmap' : 'probe', probe = path === 'probe';
  const wetSlots = !!env.multi || env.wet > 0;
  const leafSide = probe && L.twoSided === 'faceDirection', sheer = probe && !!L.sheer, foliageBake = probe && !!env.foliageBake;
  const f = {
    ...FLAG_DEFAULTS, path,
    multi: !!env.multi, slotFade: !!env.multi,
    // lightmapped: wet unless the mesh's after-rain class is a plant's; probe-lit: as the material declares
    wet: wetSlots && (probe ? L.wet === 'auto' : mesh?.weather !== 'plant'),
    refl: env.refl ? { count: env.refl.count, slots: !!env.refl.slots, lamps: env.refl.lamps ? { count: env.refl.lamps.count, max: env.refl.lamps.max } : null } : null,
    mirror: L.reflection === 'mirror',
    contactSun: !!env.contact, contactAO: !!env.contact,
    contactSteps: env.contact?.steps ?? FLAG_DEFAULTS.contactSteps, contactMax: env.contact?.max ?? FLAG_DEFAULTS.contactMax,
    taa: !!env.taa, surface: !!env.surface, diffuse: !!env.diffuse,
  };
  if (probe) {
    Object.assign(f, { leafSide, sheer, foliageBake,
      groundOcclusion: !!L.foliage?.groundOcclusion && !foliageBake,
      // doors and toggles are lit from the side they face; not sheer cloth, the foliage bake or leaf cards
      sided: mesh?.probeSide === 'face' && !sheer && !foliageBake && !leafSide });
  } else Object.assign(f, { lmEncoding: env.lmEncoding === 'rgbm' ? 'rgbm' : 'tone', lmFilter: env.lmFilter | 0, lampGroups: env.lampGroups | 0 });
  // a puddle needs the wet mask; the puddle reflection's own copies never show it (they draw into its target)
  f.planarPuddle = !!env.planarPuddle && f.wet && !f.diffuse;
  return f;
}

// The cache key's part: every flag, in a fixed order (a different flag set is a different key, by construction).
export function flagsKey(f) {
  const refl = f.refl ? `${f.refl.count}${f.refl.slots ? 's' : ''}${f.refl.lamps ? `l${f.refl.lamps.count}.${f.refl.lamps.max}` : ''}` : '-';
  const bits = ['multi', 'slotFade', 'wet', 'planarPuddle', 'mirror', 'contactSun', 'contactAO', 'taa', 'surface', 'diffuse',
    ...(f.path === 'probe' ? ['sided', 'leafSide', 'groundOcclusion', 'foliageBake', 'sheer'] : [])].map(k => f[k] ? 1 : 0).join('');
  const path = f.path === 'probe' ? 'p' : `l${f.lmEncoding[0]}${f.lmFilter}g${f.lampGroups}`;
  return `${path}:${bits}:r${refl}:c${f.contactSteps}.${f.contactMax}`;
}
