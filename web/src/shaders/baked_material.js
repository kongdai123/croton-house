// One composed shader per baked material (compose.js): the material's own hook runs first (leaf, fur, wind, the SSR
// tag: edits of three's template that keep its includes), then the composition of the material's planned flags. One
// onBeforeCompile and one cache key per material, the key derived from the planned flags. Nothing else wraps a baked
// material's hook: what other modules add (contact casters, the planar puddle, the puddle reflection's diffuse copies,
// TAA, the mirrors' merged geometry) are flags and uniforms here.
import { ShaderLib, Material } from 'three';
import { shaderPatch, shaderReplace as rep } from './patch.js';
import { compose, applyComposed, TAA_MAPS } from './compose.js';
import { flagsKey } from './features.js';
import { samplerPlan, threeSamplers } from './sampler_plan.js';
import { fragmentSamplers, warnDropped } from '../sampler_budget.js';

// ---- the material's own shader ----------------------------------------------------------------------------------------
// Its own hook and key (leaf, fur, wind, the SSR tag), before the legacy raster lighting wrapped it (lighting.js records
// them there). Copies of a material carry it over (copyOwnShader).
export const ownShader = m => m.ownShader ?? { compile: m.onBeforeCompile, key: m.customProgramCacheKey() };
export function setOwnShader(m, compile, key) { m.ownShader = { compile, key }; return m; }
export function copyOwnShader(from, to) { if (from.ownShader) to.ownShader = from.ownShader; return to; }

// ---- options other modules set on baked materials ---------------------------------------------------------------------
// A baked material (or a copy carrying its hook): the composed hook is marked.
export const isBaked = m => !!m?.onBeforeCompile?.bakedComposed;
// Contact shadows (contact.js): a moving caster's own material skips the sun contact it casts (a uniform, no new program).
const CASTERS = new WeakMap();
const casterUniform = m => { let u = CASTERS.get(m); if (!u) CASTERS.set(m, u = { value: m.userData.contactCaster ? 1 : 0 }); return u; };
export function setContactCaster(m, caster) { m.userData.contactCaster = !!caster; casterUniform(m).value = caster ? 1 : 0; }
// TAA (taa.js): its texture LOD bias uniform while it runs (null: off); every baked material with a surface map reads
// through it (a flag: its programs are recompiled when TAA starts or stops).
const TAA = { bias: null };
export function setBakedTaa(bias) { TAA.bias = bias ?? null; }
export const bakedTaa = m => !!TAA.bias && TAA_MAPS.some(k => m[k]);
// Per-material options, read when the key and the shader are made:
//   userData.planarPuddle   the planar puddle reflection (puddles.js ground materials)
//   userData.bakedDiffuse   diffuse only: no specular, no SSR tag (the puddle reflection's copies, puddles.js)
//   userData.bakedSurface   per-vertex roughness / metalness (the mirrors' merged reflection geometry, hq.js)
export const materialOptions = m => ({ planarPuddle: !!m.userData.planarPuddle, diffuse: !!m.userData.bakedDiffuse, surface: !!m.userData.bakedSurface, taa: bakedTaa(m) });
// the uniforms a composition needs from here
export function bindOptions(s, f, m) {
  if (f.contactSun || f.contactAO) s.uniforms.uContactCaster = casterUniform(m);
  if (f.taa) s.uniforms.uTaaLodBias = TAA.bias;
}

// ---- the sampler plan -------------------------------------------------------------------------------------------------
// The plan of a material: its flags within the renderer's fragment texture units, less the cut the post-link audit adds
// to a material that failed to link anyway (lightmap.js audit). The diffuse copies read no environment map.
export function planOf(material, flags, renderer, ownSamplers = 0) {
  const units = renderer?.capabilities?.maxTextures ?? 16;
  return samplerPlan({ ...flags, threeSamplers: threeSamplers(material, { envMap: !flags.diffuse }) + ownSamplers }, units - (material.userData.samplerCut ?? 0));
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

// ---- install ----------------------------------------------------------------------------------------------------------
// spec: { name, tag (key part), own: { compile, key } (the material's own hook and key), features(material) -> flags,
//         bind(shader, flags, material) (the uniforms), renderer (for the key: the units three compiles for) }
export function installBaked(material, { name, tag, own, features, bind, renderer = null }) {
  const extra = ownSamplers(material, own);
  material.ownShader = own;
  const hook = function (sh, r) {
    const self = this ?? material;
    shaderPatch(sh, `${name} ${own.key}`, s => {
      own.compile?.call(this, s, r);
      const plan = planOf(self, features(self), r ?? renderer, extra);
      if (plan.start > plan.limit) warnDropped(self, plan.start, plan.limit, plan.dropped, plan.over);
      const c = compose(plan.flags);
      applyComposed(s, c);
      bind(s, plan.flags, self); bindOptions(s, plan.flags, self);
      s.samplerCount = plan.count; s.samplerDropped = plan.dropped; s.composed = c.key;
    });
  };
  hook.bakedComposed = true;
  material.onBeforeCompile = hook;
  material.customProgramCacheKey = function () { const self = this ?? material; return `${own.key}|${tag}:${flagsKey(planOf(self, features(self), renderer, extra).flags)}`; };
}

// ---- the sun's depth pass ---------------------------------------------------------------------------------------------
// A baked caster's depth material (lightmap.js createSunPCSS, a MeshDepthMaterial) runs the caster's own hook only (its
// deformation, alpha cut-outs, fur coverage; the raster GI wrapper is not in it). A deformation hook can use skinned
// normals, and leaf hooks emit normals during GTAO, so the depth variant gets the standard vertex stage and those
// chunks too, keeping its depth output and alpha / discard code. -> { compile, key } for the depth material.
export function sunDepthShader(m) {
  const { compile: hook, key } = ownShader(m);
  return { key: key + '|sun-depth-v2', compile(sh, r) { shaderPatch(sh, 'sun depth ' + key, s => {
    if (hook === Material.prototype.onBeforeCompile) return;
    s.vertexShader = 'varying vec2 vHighPrecisionZW;\n' + rep(ShaderLib.standard.vertexShader, '#include <clipping_planes_vertex>', '#include <clipping_planes_vertex>\n vHighPrecisionZW = gl_Position.zw;', 'depth clip');
    s.fragmentShader = 'varying vec3 vViewPosition;\n#include <normal_pars_fragment>\n#include <color_pars_fragment>\n' + s.fragmentShader;
    s.fragmentShader = rep(s.fragmentShader, 'vec4 diffuseColor = vec4( 1.0 );', 'vec4 diffuseColor = vec4( 1.0 );\n#include <normal_fragment_begin>', 'depth normal');
    s.fragmentShader = rep(s.fragmentShader, '#include <map_fragment>', '#include <map_fragment>\n#include <color_fragment>', 'depth alpha');
    hook.call(m, s, r);
  }); } };
}
