// One composed shader per baked material (compose.js): the material's own hook runs first (leaf, fur, wind, the SSR
// tag: edits of three's template that keep its includes), then the composition of the material's feature flags. One
// onBeforeCompile and one cache key per material, the key derived from the flags.
import { shaderPatch } from './patch.js';
import { compose, applyComposed } from './compose.js';
import { flagsKey } from './features.js';
import { fragmentSamplers, samplerLimit, warnDropped } from '../sampler_budget.js';

// spec: { name, tag (key part), own: { compile, key } (the material's own hook and key), features(material) -> flags,
//         bind(shader, flags, material) (the uniforms), fit(shader, renderer, material, flags) -> { flags, ...extra } }
export function installBaked(material, { name, tag, own, features, bind, fit }) {
  material.onBeforeCompile = function (sh, renderer) {
    const self = this ?? material;
    shaderPatch(sh, `${name} ${own.key}`, s => {
      own.compile?.call(this, s, renderer);
      const { flags, ...extra } = fit(s, renderer, self, features(self));
      applyComposed(s, compose(flags));
      bind(s, flags, self);
      Object.assign(s, extra);
    });
  };
  material.customProgramCacheKey = function () { const self = this ?? material; return `${own.key}|${tag}:${flagsKey(features(self))}:${self.userData.samplerCut ?? 0}`; };
}

// The fit after composing (count the composed text, leave optional features out in order, compose again): the planar
// puddle (added by puddles.js's wrapper), the contact sun, the slot crossfade. Warns once per material and outcome.
export function fitComposed(s, renderer, material, f) {
  const limit = samplerLimit(renderer, material);
  const count = flags => fragmentSamplers(applyComposed({ ...s }, compose(flags)));
  let flags = f, planar = material.userData.planarPuddle && f.wet ? 1 : 0, n = count(flags) + planar;
  const start = n, dropped = [];
  if (n > limit && planar) { dropped.push('planar puddle'); planar = 0; n--; }
  if (n > limit && flags.contactSun) { flags = { ...flags, contactSun: false }; n = count(flags) + planar; dropped.push('contact sun'); }
  if (n > limit && flags.slotFade) { flags = { ...flags, slotFade: false }; n = count(flags) + planar; dropped.push('slot crossfade'); }
  if (start > limit) warnDropped(material, start, limit, dropped, n > limit);
  return { flags, samplerCount: n, ...(dropped.includes('planar puddle') ? { noPlanarPuddle: true } : {}) };
}
