// Every reachable flag set of the composed baked shader (web/src/shaders/features.js): the manifest records a material
// can have (probe-lit: plain, a door's face, a leaf card, foliage dry or wet with or without the per-vertex bake, sheer
// cloth, a mirror; lightmapped: by weather class, a mirror) under every bake the site can load (slots, wetness,
// reflection probes with and without lamp layers, lamp groups or the shared lamps layer, contact on or off, the atlas
// encodings and filters), with the options other modules set (planar puddle, TAA, the mirrors' surface, the puddle
// reflection's diffuse copies), then each through the sampler plan on a 16-unit and an 11-unit GPU. Used by test_shader_compose.mjs (all of them through
// compose()) and test_shader_invariants.mjs (the real house's flags are among them).
//   enumerateFlags({ bakedFeatures, samplerPlan, refl, lampGroups }) -> Map(the flags as JSON -> flags)
// (foliage: a plant's cut-out leaves stay dry, its stems and solid parts take the wet ground; both kinds with or without
// the per-vertex bake covering them)
const PROBE_RECORDS = [
  ['plain', { wet: 'auto', twoSided: false }, { probeSide: 'none' }],
  ['face', { wet: 'auto', twoSided: false }, { probeSide: 'face' }],
  ['leafCard', { wet: 'dry', twoSided: 'faceDirection', foliage: { groundOcclusion: true, bakedPerVertex: false } }, { probeSide: 'none' }],
  ...['dry', 'auto'].flatMap(wet => [
    ['foliage', { wet, twoSided: false, foliage: { groundOcclusion: true, bakedPerVertex: true } }, { probeSide: 'none' }],
    ['foliageBaked', { wet, twoSided: false, foliage: { groundOcclusion: true, bakedPerVertex: true } }, { probeSide: 'none' }, { foliageBake: true }]]),
  ['sheer', { wet: 'auto', sheer: { reflect: 0.3, transmit: 0.7 } }, { probeSide: 'face' }],
  ['mirror', { wet: 'auto', reflection: 'mirror' }, { probeSide: 'none' }],
];
const LIGHTMAP_RECORDS = [['plain', {}, { weather: null }], ['ground', {}, { weather: 'ground' }], ['plant', {}, { weather: 'plant' }], ['mirror', { reflection: 'mirror' }, { weather: null }]];
const OPTIONS = [{}, { taa: true }, { surface: true }, { diffuse: true }, { taa: true, surface: true }];

export function enumerateFlags({ bakedFeatures, samplerPlan, refl = [{ count: 27 }, { count: 27, lamps: { count: 40, max: 4 } }], lampGroups = [5] }) {
  const out = new Map(), key = f => JSON.stringify(f, Object.keys(f).sort());
  const add = f => {
    // the plan on a heavy material (five maps: 8 of three's samplers) at 16 and 11 units, and the request itself
    for (const units of [Infinity, 16, 11]) {
      const p = units === Infinity ? { flags: f } : samplerPlan({ ...f, threeSamplers: 8 }, units);
      const g = { ...p.flags }; delete g.threeSamplers;
      out.set(key(g), g);
    }
  };
  for (const multi of [false, true]) for (const wet of [0, 1]) for (const r of [null, ...refl]) for (const contact of [null, { steps: 8, max: 16 }]) for (const planarPuddle of [false, true]) for (const o of OPTIONS) {
    const reflOf = r ? { ...r, slots: multi } : null, base = { multi, wet, refl: reflOf, contact, planarPuddle, ...o };
    for (const [, material, mesh, extra] of PROBE_RECORDS) add(bakedFeatures(material, mesh, { path: 'probe', ...base, ...extra }));
    for (const [, material, mesh] of LIGHTMAP_RECORDS) for (const groups of [0, ...lampGroups]) for (const [lmEncoding, lmFilter] of [['tone', 0], ['tone', 1], ['tone', 2], ['rgbm', 0]])
      add(bakedFeatures(material, mesh, { path: 'lightmap', ...base, lampGroups: groups, lmEncoding, lmFilter }));
  }
  return out;
}
