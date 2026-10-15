import { IrradianceNode, Material, NodeMaterial } from 'three/webgpu';
import { texture, uv, uniform, normalWorld, normalViewGeometry, faceDirection, positionWorld, mix, smoothstep } from 'three/tsl';

// The denominator floor is the existing 8-bit decoder's saturation guard.
export const decodeLight = (encoded, K) => {
  const squared = encoded.mul(encoded);
  return squared.mul(K).div(squared.oneMinus().max(1 / 255));
};

export function bakedMaterials(renderer, scene, matched, bake, volume, level) {
  const lampLevel = uniform(level);
  const irradiance = decodeLight(texture(bake.slot, uv(1)).rgb, bake.encoding.K.slot)
    .add(decodeLight(texture(bake.lamps, uv(1)).rgb, bake.encoding.K.lamps).mul(lampLevel)).mul(Math.PI);
  const cache = new Map(), omitted = new Set(), ignoredPatches = new Set();
  let lightmapped = 0, probeLit = 0;
  function convert(source, lightmap) {
    if (!source) return source;
    const key = `${source.uuid}:${lightmap}`;
    if (cache.has(key)) return cache.get(key);
    // r183's library maps Standard/Physical/Basic/etc. to their node material classes.
    // clone drops WebGL callbacks; explicitly retain the node cache-key implementation.
    const material = renderer.library.fromMaterial(source.clone());
    if (!material) { omitted.add(source.type); return null; }
    material.customProgramCacheKey = NodeMaterial.prototype.customProgramCacheKey;
    // Legacy foliage opts out of WebGL's normal override. WebGPU shadows use an
    // override too, and already retain alpha maps; that old opt-out must not survive.
    material.allowOverride = true;
    if (source.onBeforeCompile !== Material.prototype.onBeforeCompile) {
      ignoredPatches.add(`${source.name || source.type}: ${source.customProgramCacheKey()}`);
    }
    if (source.isMeshStandardMaterial) {
      // This replaces all indirect diffuse: no hemisphere/ambient lights or environment
      // are installed in this scene. Direct sun still uses the standard physical model.
      material.envMap = null;
      material.setupEnvironment = () => null;
      material.lightMap = null;
      let indirect = irradiance;
      if (!lightmap) {
        const garden = /^garden-/.test(source.name);
        if (garden) material.normalNode = normalViewGeometry; // grass's outward normals
        indirect = volume.irradiance(garden ? normalWorld.mul(faceDirection) : normalWorld);
        if (source.alphaTest > 0 || /^(garden-|plant)/.test(source.name)) {
          indirect = indirect.mul(mix(0.45, 1, smoothstep(0, 1.2, positionWorld.y)));
        }
      }
      // A Node-valued property is visited by NodeMaterial's cache-key traversal.
      material.bakedIrradianceNode = indirect;
      material.setupLightMap = () => new IrradianceNode(material.bakedIrradianceNode);
      if (lightmap) lightmapped++; else probeLit++;
    }
    cache.set(key, material);
    return material;
  }
  scene.traverse(mesh => {
    if (!mesh.isMesh) return;
    const originals = [].concat(mesh.material), materials = originals.map(m => convert(m, matched.has(mesh)));
    if (materials.some(m => !m)) { mesh.visible = false; return; }
    mesh.material = Array.isArray(mesh.material) ? materials : materials[0];
    // The old custom depth materials contain GLSL wind patches; node shadows derive
    // alpha and geometry from the converted material instead.
    mesh.customDepthMaterial = undefined; mesh.customDistanceMaterial = undefined;
    if (originals.some(m => m.transmission > 0 || m.userData?.daylightOpacity !== undefined || (m.transparent && m.opacity < 0.6))) mesh.castShadow = false;
  });
  return {
    stats: { lightmapped, probeLit, omittedTypes: [...omitted], ignoredGLSLPatches: [...ignoredPatches] },
    setLamps(value) {
      if (!Number.isFinite(value) || value < 0 || value > 4) throw new Error('Lamp level must be in [0, 4]');
      volume.fill(value); lampLevel.value = value;
    },
  };
}
