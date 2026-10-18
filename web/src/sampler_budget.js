// Fragment sampler budget of the baked shaders. Apple GPUs (Mac, iPhone) give a fragment shader 16 texture units, NVIDIA
// 32: a material over the limit fails to link and its mesh vanishes (the kitchen stools' teak frames, 18 samplers
// before the probe volume and reflection arrays were packed). The composed shader plans its optional features from its
// flags before it is generated (shaders/sampler_plan.js); this counts what a generated shader uses (the check of that
// plan), warns once per material and outcome, and audits what actually linked (auditPrograms).
const MAPS = ['map', 'matcap', 'alphaMap', 'aoMap', 'bumpMap', 'normalMap', 'emissiveMap', 'metalnessMap', 'roughnessMap',
  'anisotropyMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'iridescenceMap', 'iridescenceThicknessMap',
  'sheenColorMap', 'sheenRoughnessMap', 'specularMap', 'specularColorMap', 'specularIntensityMap', 'transmissionMap',
  'thicknessMap', 'gradientMap', 'lightMap'];
// three's own sampler uniforms: counted from the program parameters, not from declarations in the template text
const BUILTIN = new Set([...MAPS, 'envMap', 'dfgLUT', 'ltc_1', 'ltc_2', 'transmissionSamplerMap', 'directionalShadowMap',
  'spotShadowMap', 'pointShadowMap', 'spotLightMap']);
// samplers that only the vertex stage reads (they do not count against the fragment limit)
const VERTEX_ONLY = /^(boneTexture|batchingTexture|batchingIdTexture|batchingColorTexture|morphTargetsTexture|displacementMap)\b/;
const DECL = /uniform\s+(?:(?:highp|mediump|lowp)\s+)?[iu]?sampler\w*\s+(\w+)\s*(?:\[\s*(\w+)\s*\])?\s*;/g;

// Upper bound of the fragment samplers a program built from these onBeforeCompile parameters will use. Custom samplers
// count when declared and referenced; three's from the parameters (envMap only while an IBL call remains).
export function fragmentSamplers(sh) {
  const src = sh.fragmentShader;
  let n = 0;
  for (const k of MAPS) if (sh[k]) n++;
  if (sh.envMap && /getIBL\w*\(|#include <(lights_fragment_maps|envmap_fragment)>/.test(src)) n++;
  if (sh.transmission) n++;
  if (sh.shaderID === 'physical') n++;   // dfgLUT
  if (sh.numRectAreaLights > 0) n += 2;
  if (sh.shadowMapEnabled) n += (sh.numDirLightShadows | 0) + (sh.numSpotLightShadows | 0) + (sh.numPointLightShadows | 0);
  n += sh.numSpotLightMaps | 0;
  const seen = new Set();
  for (const [, name, size] of src.matchAll(DECL)) {
    if (BUILTIN.has(name) || seen.has(name)) continue;
    seen.add(name);
    if ((src.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length < 2) continue;   // declared only: inactive
    n += /^\d+$/.test(size ?? '') ? Number(size) : 1;
  }
  return n;
}

const warned = new Set();
export function warnDropped(material, count, limit, dropped, over = false) {
  const name = material?.name || material?.type || 'material';
  const key = name + '|' + dropped.join(',') + '|' + over;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`baked shader "${name}": ${count} fragment samplers > ${limit} texture units;` +
    (dropped.length ? ` dropped ${dropped.join(', ')}` : '') + (over ? ' and still over the limit' : ''));
}

// Linked baked programs: the most fragment samplers any of them uses, and any that failed to link (with the log).
const SAMPLER_TYPES = new Set([0x8B5E, 0x8B5F, 0x8B60, 0x8B62, 0x8DC1, 0x8DC4, 0x8DC5, 0x8DCA, 0x8DCB, 0x8DCC, 0x8DCF, 0x8DD2, 0x8DD3, 0x8DD4, 0x8DD7]);
const audited = new WeakMap();
export function auditPrograms(renderer, match = s => /\|(baked|probe)-v\d+:/.test(s)) {
  const gl = renderer.getContext(), out = { max: 0, limit: renderer.capabilities.maxTextures, worst: '', programs: 0, failed: [] };
  for (const p of renderer.info.programs ?? []) {
    if (!p.program || !match(p.cacheKey ?? '')) continue;
    let r = audited.get(p);
    if (!r) {
      if (p.isReady && !p.isReady()) continue;   // still compiling in parallel: never stall for it
      const linked = !!gl.getProgramParameter(p.program, gl.LINK_STATUS);
      let count = 0;
      if (linked) for (let i = 0, n = gl.getProgramParameter(p.program, gl.ACTIVE_UNIFORMS); i < n; i++) {
        const u = gl.getActiveUniform(p.program, i);
        if (u && SAMPLER_TYPES.has(u.type) && !VERTEX_ONLY.test(u.name)) count += u.size;
      }
      r = { linked, count, name: p.name, program: p, log: linked ? '' : (gl.getProgramInfoLog(p.program) || '').trim() };
      audited.set(p, r);
    }
    out.programs++;
    if (r.linked && r.count > out.max) { out.max = r.count; out.worst = r.name; }
    if (!r.linked) out.failed.push(r);
  }
  return out;
}
