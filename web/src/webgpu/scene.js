import { collectLightSwitches } from '../furniture/light_switch.js';
import { classifyLighting, lightingOf, meshLighting } from '../lighting_roles.js';
import { stillParts } from '../batch.js';

// collectMaterials() in lighting.js changes the batch partitions before the bake
// IDs are assigned. Reproduce just that CPU preparation, without its WebGL passes,
// PMREM or daylight ray tests: the lighting manifest first (as main.js), then the
// split by the manifest's zone, as in lighting.js.
export function prepareBatchMaterials(scene, fixtures) {
  classifyLighting(scene, { stillParts });
  const switches = collectLightSwitches(scene, fixtures);
  const groups = new Map();
  scene.traverse(mesh => {
    if (!mesh.isMesh || mesh.isReflector) return;
    const inside = meshLighting(mesh).zone === 'interior';
    function split(material) {
      if (!material?.isMeshStandardMaterial) return material;
      const region = inside && lightingOf(material).zone !== 'exterior' ? 'inside' : 'outside';
      if (!groups.has(material)) groups.set(material, new Map());
      const uses = groups.get(material);
      if (!uses.has(region)) {
        const local = uses.size ? material.clone() : material;
        local.onBeforeCompile = material.onBeforeCompile; local.customProgramCacheKey = material.customProgramCacheKey;
        local.onBeforeRender = material.onBeforeRender; uses.set(region, local);
      }
      return uses.get(region);
    }
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(split) : split(mesh.material);
  });
  return switches;
}
