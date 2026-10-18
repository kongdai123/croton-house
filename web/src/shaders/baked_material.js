// One composed shader per baked material (compose.js): the material's own hook runs first (leaf, fur, wind, the SSR
// tag: edits of three's template that keep its includes), then the composition of the material's planned flags. One
// onBeforeCompile and one cache key per material, the key derived from the planned flags.
import { shaderPatch } from './patch.js';
import { compose, applyComposed } from './compose.js';
import { flagsKey } from './features.js';
import { samplerPlan, threeSamplers } from './sampler_plan.js';
import { fragmentSamplers, warnDropped } from '../sampler_budget.js';
import { ShaderLib } from 'three';

// The sampler plan of a material: its flags within the renderer's fragment texture units, less the cut the post-link
// audit adds to a material that failed to link anyway (lightmap.js audit).
export function planOf(material, flags, renderer, ownSamplers = 0) {
  const units = renderer?.capabilities?.maxTextures ?? 16;
  return samplerPlan({ ...flags, threeSamplers: threeSamplers(material) + ownSamplers }, units - (material.userData.samplerCut ?? 0));
}
// The samplers a material's own hook adds to three's template (the turf's macro noise, the dog's strand texture): its
// edit of the stock text, counted once (sampler_budget.js counts declared-and-referenced custom samplers).
export function ownSamplers(material, own) {
  if (!own.compile) return 0;
  const lib = material.isMeshPhysicalMaterial ? ShaderLib.physical : ShaderLib.standard;
  const sh = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
  try { own.compile.call(material, sh, null); } catch { return 0; }
  return fragmentSamplers(sh);
}

// spec: { name, tag (key part), own: { compile, key } (the material's own hook and key), features(material) -> flags,
//         bind(shader, flags, material) (the uniforms), renderer (for the key: the units three compiles for) }
export function installBaked(material, { name, tag, own, features, bind, renderer = null }) {
  const extra = ownSamplers(material, own);
  material.onBeforeCompile = function (sh, r) {
    const self = this ?? material;
    shaderPatch(sh, `${name} ${own.key}`, s => {
      own.compile?.call(this, s, r);
      const plan = planOf(self, features(self), r ?? renderer, extra);
      if (plan.start > plan.limit) warnDropped(self, plan.start, plan.limit, plan.dropped, plan.over);
      const c = compose(plan.flags);
      applyComposed(s, c);
      bind(s, plan.flags, self);
      s.samplerCount = plan.count; s.composed = c.key;
    });
  };
  material.customProgramCacheKey = function () { const self = this ?? material; return `${own.key}|${tag}:${flagsKey(planOf(self, features(self), renderer, extra).flags)}`; };
}
