import { Box3, Vector3 } from 'three/webgpu';
import { M } from '../materials.js';
import { collectLightSwitches } from '../furniture/light_switch.js';

// collectMaterials() in lighting.js changes the batch partitions before the bake
// IDs are assigned. Reproduce just that CPU preparation, without its WebGL passes,
// PMREM or daylight ray tests. Keep this region rule in sync until it is extracted.
export function prepareBatchMaterials(scene, fixtures, house) {
  const switches = collectLightSwitches(scene, fixtures);
  const exteriorFinishes = new Set([M.stucco(), M.soffit(), M.roof()]);
  const groups = new Map(), box = new Box3(), center = new Vector3();
  scene.updateMatrixWorld(true);
  scene.traverse(mesh => {
    if (!mesh.isMesh || mesh.isReflector) return;
    mesh.geometry.computeBoundingBox();
    box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld); box.getCenter(center);
    const x = center.x, y = -center.z, front = x < -3.5 || x > 3.97 ? -5.94 : -4.82;
    const inside = x >= -8.1 && x <= 8.1 && y >= front && y <= 5.62 && center.y < house.ceiling + 0.05 &&
      box.max.x - box.min.x < 17 && box.max.z - box.min.z < 13;
    function split(material) {
      if (!material?.isMeshStandardMaterial) return material;
      const region = inside && !exteriorFinishes.has(material) && !material.userData.exteriorFinish ? 'inside' : 'outside';
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
