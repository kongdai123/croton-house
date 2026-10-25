// Light sprites over the bake (lighting_roles.js sprite, bakedLiveLevel; lightmap.js the one place that applies them): on the
// real house with its baked lighting built headless (harness/baked.mjs), at dusk with the fire lit and the porch sconce on,
// every visible additive or untone-mapped sprite with light in it is the light's own form (flames, sparks: sprite 'source');
// the stand-ins (a sconce's wash on its wall, the fire's glow on the gravel: sprite 'standIn') are hidden; and a live light
// outside the bake (the fire's) draws its lumens in the bake's units. Two blowouts at dusk came from undeclared stand-ins
// at the raster look's levels: the porch sconce's cards (white cones) and the fire's card and light (70% of the gravel
// clipped, 2026-10-24). No browser, no GPU.
import assert from 'node:assert/strict';
import { buildBakedScene } from './harness/baked.mjs';

const t0 = performance.now();
const { world, baked } = await buildBakedScene({ groups: true, slots: false });
const { scene, layout, T } = world;
// the fire lit and every switch on, as at dusk (the toggles' own apply, at a mid-flicker time)
for (const o of layout.animated) if (o.userData.onTime) o.userData.onTime(true, true);
for (const r of baked.lampGroups?.records ?? []) if (r.toggle && !r.toggle.on) r.toggle.set(true, true);
const visible = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
const additive = m => m.blending === T.AdditiveBlending || m.toneMapped === false;
const offenders = [], standIns = [], sources = [];
scene.traverse(o => {
  if (!(o.isMesh || o.isPoints || o.isSprite) || !visible(o) || o.userData.reflection) return;   // a glass pane's reflection overlay: no light of its own
  for (const m of [].concat(o.material ?? [])) {
    if (!m || !additive(m)) continue;
    const sprite = world.roles.lightingOf(m)?.sprite;
    if (sprite === 'standIn') { standIns.push(m); if (m.visible) offenders.push(`${o.name || o.parent?.name}: a stand-in drawn over the bake`); }
    else if (sprite === 'source') sources.push(m);
    else if (m.visible) offenders.push(`${o.name || o.parent?.userData.id || o.parent?.name}: an additive or untone-mapped sprite with no sprite declaration (${m.type})`);
  }
});
assert.deepEqual(offenders, [], offenders.join('\n'));
assert.ok(standIns.length >= 2 && sources.length >= 2, `stand-ins ${standIns.length}, sources ${sources.length}`);   // the sconce wash, the fire's glow; flames, sparks
// the fire's light: its 2000 lm in the bake's units (lm / (4 pi lmPerW) cd), not the raster look's 2.3
const lights = []; scene.traverse(o => { if (o.isLight && o.userData.lighting?.bake === false) lights.push(o); });
assert.ok(lights.length >= 1);
for (const l of lights) {
  const want = world.roles.bakedLiveLevel(l, baked.lampGroups?.meta?.lmPerW ?? world.roles.LM_PER_BAKE_UNIT);
  assert.ok(want > 0 && Math.abs(l.userData.bakedLevel - want) < 1e-12, `${l.name}: baked level ${l.userData.bakedLevel} (want ${want})`);
  assert.ok(l.intensity <= want * 1.2 && l.intensity > 0, `${l.name}: intensity ${l.intensity} over the bake (its lumens: ${want.toFixed(5)})`);
}
// and back to the raster look: the stand-ins drawn again, the light at its own level
baked.dispose();
for (const m of standIns) assert.equal(m.visible, true);
for (const l of lights) assert.equal(l.userData.bakedLevel, undefined);
console.log(`light sprites over the bake: ${sources.length} sources drawn, ${standIns.length} stand-ins hidden, the fire's light at its lumens (${((performance.now() - t0) / 1000).toFixed(1)} s) OK`);
