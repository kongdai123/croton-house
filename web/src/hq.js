import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const shadowTaps = Array.from({ length: 12 }, (_, j) => {
  const radius = Math.sqrt((j + 0.5) / 12), angle = j * 2.399963229728653;
  return `texture( shadowMap, vec3( shadowCoord.xy + hqRotation * vec2( ${(Math.cos(angle) * radius).toFixed(7)}, ${(Math.sin(angle) * radius).toFixed(7)} ) * radius * 1.75, shadowCoord.z ) )`;
}).join(' +\n');
const shadowChunk = THREE.ShaderChunk.shadowmap_pars_fragment.replace(/shadow = \([\s\S]*?\) \* 0\.2;/, original => `
  if ( uHQShadow > 0.5 ) {
    vec2 cs = vec2( cos( phi ), sin( phi ) );
    mat2 hqRotation = mat2( cs.x, cs.y, -cs.y, cs.x );
    shadow = ( ${shadowTaps} ) / 12.0;
  } else { ${original} }`);

export function createHQ(renderer, composer, gtao, preset) {
  const shadow = { value: +preset.hqShadow }, textures = new Set();
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  let anisotropy = Math.min(preset.anisotropy, maxAnisotropy);
  gtao.updateGtaoMaterial({ radius: 0.28, thickness: 0.35 });
  gtao.updatePdMaterial({ radius: 3.5 });
  gtao.blendIntensity = 1;
  function collect(material) {
    for (const v of Object.values(material)) if (v?.isTexture && !v.isRenderTargetTexture && !textures.has(v)) {
      textures.add(v); v.anisotropy = anisotropy;
    }
  }
  function patch(shader) {
    shader.uniforms.uHQShadow = shadow;
    shader.fragmentShader = 'uniform float uHQShadow;\n' + shader.fragmentShader.replace('#include <shadowmap_pars_fragment>', shadowChunk);
  }
  // A tier preset: the 12-tap sun shadow filter, GTAO sample counts (null = off) and texture anisotropy.
  function setQuality(next) {
    shadow.value = +next.hqShadow; gtao.enabled = !!next.gtao;
    if (next.gtao) { gtao.updateGtaoMaterial({ samples: next.gtao.samples }); gtao.updatePdMaterial({ samples: next.gtao.pd }); }
    anisotropy = Math.min(next.anisotropy, maxAnisotropy);
    for (const texture of textures) {
      if (texture.anisotropy !== anisotropy) { texture.anisotropy = anisotropy; texture.needsUpdate = true; }
    }
  }
  setQuality(preset);
  return { shadow, collect, patch, setQuality };
}

export function createMirror(geometry) {
  const r = new Reflector(geometry, { textureWidth: 256, textureHeight: 256, color: 0xbcbcbc, multisample: 0 });
  r.name = 'HQ mirror'; r.visible = false;
  r.material.fragmentShader = r.material.fragmentShader.replace('blendOverlay( base.rgb, color )', 'base.rgb * 0.96');
  const normal = new THREE.Vector3(), position = new THREE.Vector3(), view = new THREE.Vector3(), target = new THREE.Vector3(), point = new THREE.Vector3();
  const bounds = geometry.boundingBox ?? (geometry.computeBoundingBox(), geometry.boundingBox);
  const corners = [new THREE.Vector3(bounds.min.x, bounds.min.y, 0), new THREE.Vector3(bounds.max.x, bounds.min.y, 0), new THREE.Vector3(bounds.max.x, bounds.max.y, 0), new THREE.Vector3(bounds.min.x, bounds.max.y, 0)];
  r.userData.corners = corners;
  r.onBeforeRender = (renderer, scene, camera) => {
    if (camera.userData.hqReflection) return;
    position.setFromMatrixPosition(r.matrixWorld);
    normal.set(0, 0, 1).transformDirection(r.matrixWorld);
    view.subVectors(position, camera.position);
    if (view.dot(normal) > 0) return;
    const virtual = r.camera;
    virtual.userData.hqReflection = true;
    const distance = -view.dot(normal);
    virtual.position.copy(view.reflect(normal).negate().add(position));
    virtual.up.set(0, 1, 0).transformDirection(r.matrixWorld);
    target.copy(virtual.position).add(normal);
    // Face the mirror normal: its plane is the exact near plane, so far stays 8 m.
    virtual.lookAt(target); virtual.near = distance + 0.001; virtual.far = 8; virtual.updateMatrixWorld();
    let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
    for (const corner of corners) {
      point.copy(corner).applyMatrix4(r.matrixWorld).applyMatrix4(virtual.matrixWorldInverse);
      if (point.z >= -0.01) return;
      const scale = -virtual.near / point.z;
      left = Math.min(left, point.x * scale); right = Math.max(right, point.x * scale);
      bottom = Math.min(bottom, point.y * scale); top = Math.max(top, point.y * scale);
    }
    virtual.projectionMatrix.makePerspective(left, right, top, bottom, virtual.near, virtual.far);
    const textureMatrix = r.material.uniforms.textureMatrix.value;
    textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(virtual.projectionMatrix).multiply(virtual.matrixWorldInverse).multiply(r.matrixWorld);
    virtual.projectionMatrixInverse.copy(virtual.projectionMatrix).invert();
    const savedTarget = renderer.getRenderTarget(), savedXr = renderer.xr.enabled, savedShadow = renderer.shadowMap.autoUpdate, savedNeeds = renderer.shadowMap.needsUpdate;
    r.visible = false; renderer.xr.enabled = false; renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false;
    try {
      renderer.setRenderTarget(r.getRenderTarget()); renderer.state.buffers.depth.setMask(true);
      if (!renderer.autoClear) renderer.clear();
      const reflection = r.userData.reflection;
      if (reflection) {
        const flat = reflection.scene;
        flat.background = scene.background; flat.backgroundIntensity = scene.backgroundIntensity; flat.backgroundRotation.copy(scene.backgroundRotation);
        flat.environment = scene.environment; flat.environmentIntensity = scene.environmentIntensity; flat.environmentRotation.copy(scene.environmentRotation);
        for (const { source, proxy, parents } of reflection.meshes) {
          proxy.visible = source.visible;
          if (proxy.visible) for (const parent of parents) if (!parent.visible) { proxy.visible = false; break; }
          if (proxy.visible) proxy.matrixWorld.copy(source.matrixWorld);
        }
        for (const { source, proxy, occluded } of reflection.lights) {
          // hidden lights stay out of the reflection: baked lighting hides the live fixtures, window fills and sky light
          let shown = source.visible;
          for (let p = source.parent; shown && p; p = p.parent) shown = p.visible;
          proxy.visible = shown;
          proxy.color.copy(source.color); proxy.intensity = occluded ? 0 : source.intensity; proxy.matrixWorld.copy(source.matrixWorld);
          if (source.isHemisphereLight) proxy.groundColor.copy(source.groundColor);
        }
        for (const { source, material } of reflection.materials) {
          const previous = material.envMap;
          material.envMap = source.envMap; material.envMapIntensity = source.envMapIntensity; material.envMapRotation.copy(source.envMapRotation);
          if (previous?.mapping !== source.envMap?.mapping) material.needsUpdate = true;
        }
        renderer.render(flat, virtual);
      } else renderer.render(scene, virtual);
    } finally {
      r.visible = true; renderer.xr.enabled = savedXr; renderer.shadowMap.autoUpdate = savedShadow; renderer.shadowMap.needsUpdate = savedNeeds;
      renderer.setRenderTarget(savedTarget);
      if (camera.viewport) renderer.state.viewport(camera.viewport);
    }
  };
  return r;
}

const sightRay = new THREE.Ray(), sightHit = new THREE.Vector3(), sightDirection = new THREE.Vector3();
function blocked(start, end, wall) {
  sightDirection.subVectors(end, start);
  const length = sightDirection.length();
  sightRay.set(start, sightDirection.multiplyScalar(1 / length));
  return !!sightRay.intersectBox(wall, sightHit) && sightHit.distanceToSquared(start) < (length - 0.025) ** 2;
}

export function prepareMirrors(scene, mirrors, house) {
  if (!mirrors?.length) return;
  const start = performance.now();
  scene.updateMatrixWorld(true);
  const sources = [], lights = [], bounds = new THREE.Box3(), position = new THREE.Vector3();
  const walls = house.pieces.map(p => new THREE.Box3(new THREE.Vector3(p.x0, p.z0, -p.y1), new THREE.Vector3(p.x1, p.z1, -p.y0)));
  scene.traverse(source => {
    if (source.isLight) lights.push(source);
    if (!source.isMesh || source.isReflector || source.userData.batched || source.userData.lightHit) return;
    if (source.isInstancedMesh && !source.boundingBox) source.computeBoundingBox();
    if (!source.geometry.boundingBox) source.geometry.computeBoundingBox();
    sources.push({ source, bounds: (source.boundingBox ?? source.geometry.boundingBox).clone().applyMatrix4(source.matrixWorld) });
  });
  const fixed = () => {}, materialKeys = new Map();
  const ignored = new Set(['id', 'uuid', 'name', 'version', 'userData', '_listeners', 'color', 'roughness', 'metalness', 'vertexColors']);
  function materialKey(material) {
    if (!materialKeys.has(material)) materialKeys.set(material, material.customProgramCacheKey() + JSON.stringify(Object.entries(material).filter(([k, v]) => !ignored.has(k) && typeof v !== 'function').map(([k, v]) => [k, v?.isTexture ? v.uuid : v?.toArray ? v.toArray() : v])));
    return materialKeys.get(material);
  }
  for (const mirror of mirrors) {
    const flat = new THREE.Scene(), meshes = [], localLights = [], materials = [], groups = new Map();
    flat.matrixAutoUpdate = false;
    position.setFromMatrixPosition(mirror.matrixWorld);
    const origins = [position.clone(), ...mirror.userData.corners.map(c => c.clone().applyMatrix4(mirror.matrixWorld))];
    mirror.userData.walls = walls;
    bounds.setFromCenterAndSize(position, new THREE.Vector3(16, 16, 16));
    for (const { source, bounds: box } of sources) {
      const parents = [];
      for (let p = source.parent; p && p !== scene; p = p.parent) parents.push(p);
      const dynamic = source.matrixAutoUpdate || parents.some(p => p.userData.interactiveRoot || p.userData.animate || p.userData.toggle);
      const cullBox = dynamic ? box.clone().expandByScalar(0.3) : box;
      if (!bounds.intersectsBox(cullBox) && !parents.some(p => p.userData.movable || p.isCamera || (!p.name && p.parent === scene))) continue;
      const windOnly = parents.some(p => p.userData.animate) && !parents.some(p => p.userData.interactiveRoot || p.userData.toggle || p.userData.movable);
      if (!dynamic || windOnly) {
        const probes = [cullBox.getCenter(new THREE.Vector3())];
        for (const x of [cullBox.min.x, cullBox.max.x]) for (const y of [cullBox.min.y, cullBox.max.y]) for (const z of [cullBox.min.z, cullBox.max.z]) probes.push(new THREE.Vector3(x, y, z));
        if (walls.some(w => probes.every(p => origins.every(o => blocked(o, p, w))))) continue;
      }
      const material = source.material;
      if (!dynamic && !source.isInstancedMesh && source.matrixWorld.determinant() > 0 && source.geometry.drawRange.count === Infinity && source.geometry.drawRange.start === 0 && (!material.vertexColors || source.geometry.attributes.color?.itemSize !== 4) && material.isMeshStandardMaterial && !material.transparent && !material.userData.lightGlow && material.emissive.getHex() === 0 && source.onBeforeRender === THREE.Mesh.prototype.onBeforeRender && material.customProgramCacheKey().startsWith(THREE.Material.prototype.onBeforeCompile.toString())) {
        const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld), count = geometry.attributes.position.count;
        const colors = new Float32Array(count * 3), surface = new Float32Array(count * 2), original = material.vertexColors ? geometry.attributes.color : null;
        for (let i = 0; i < count; i++) {
          colors[i * 3] = material.color.r * (original?.getX(i) ?? 1); colors[i * 3 + 1] = material.color.g * (original?.getY(i) ?? 1); colors[i * 3 + 2] = material.color.b * (original?.getZ(i) ?? 1);
          surface[i * 2] = material.roughness; surface[i * 2 + 1] = material.metalness;
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geometry.setAttribute('hqSurface', new THREE.BufferAttribute(surface, 2));
        const signature = Object.entries(geometry.attributes).sort(([a], [b]) => a.localeCompare(b)).map(([k, a]) => `${k}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`).join('|');
        const key = `${materialKey(material)}|${signature}|${!!source.geometry.index}|${source.receiveShadow}|${source.renderOrder}|${source.layers.mask}`;
        if (!groups.has(key)) groups.set(key, { source, geometries: [] });
        groups.get(key).geometries.push(geometry);
        continue;
      }
      const proxy = source.isInstancedMesh ? new THREE.InstancedMesh(source.geometry, source.material, source.count) : new THREE.Mesh(source.geometry, source.material);
      proxy.matrixAutoUpdate = false; proxy.updateMatrixWorld = fixed; proxy.matrixWorld.copy(source.matrixWorld);
      proxy.renderOrder = source.renderOrder; proxy.frustumCulled = source.frustumCulled; proxy.receiveShadow = source.receiveShadow;
      proxy.layers.mask = source.layers.mask; proxy.userData = source.userData; proxy.onBeforeRender = source.onBeforeRender;
      if (source.isInstancedMesh) { proxy.instanceMatrix = source.instanceMatrix; proxy.instanceColor = source.instanceColor; }
      flat.add(proxy); meshes.push({ source, proxy, parents });
    }
    for (const { source, geometries } of groups.values()) {
      const geometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries);
      if (geometries.length > 1) geometries.forEach(g => g.dispose());
      const material = source.material.clone(), compile = source.material.onBeforeCompile, key = source.material.customProgramCacheKey();
      material.vertexColors = true; material.color.set(0xffffff);
      material.onBeforeCompile = function(shader, renderer) {
        compile.call(this, shader, renderer);
        shader.vertexShader = 'attribute vec2 hqSurface; varying vec2 vHQSurface;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvHQSurface = hqSurface;');
        shader.fragmentShader = 'varying vec2 vHQSurface;\n' + shader.fragmentShader.replace('float roughnessFactor = roughness;', 'float roughnessFactor = vHQSurface.x;').replace('float metalnessFactor = metalness;', 'float metalnessFactor = vHQSurface.y;');
      };
      material.customProgramCacheKey = () => key + '|reflection-surface';
      materials.push({ source: source.material, material });
      const proxy = new THREE.Mesh(geometry, material);
      proxy.receiveShadow = source.receiveShadow; proxy.renderOrder = source.renderOrder; proxy.layers.mask = source.layers.mask;
      proxy.matrixAutoUpdate = false; proxy.updateMatrixWorld = fixed; flat.add(proxy);
    }
    for (const source of lights) {
      const proxy = new source.constructor();
      for (const key of ['distance', 'decay', 'angle', 'penumbra', 'width', 'height', 'castShadow']) if (key in source) proxy[key] = source[key];
      proxy.matrixAutoUpdate = false; proxy.updateMatrixWorld = fixed; proxy.matrixWorld.copy(source.matrixWorld);
      if (source.target) proxy.target = source.target;
      if (source.shadow) proxy.shadow = source.shadow;
      const probes = [new THREE.Vector3().setFromMatrixPosition(source.matrixWorld)];
      if (source.isRectAreaLight) for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) probes.push(new THREE.Vector3(x * source.width, y * source.height, 0).applyMatrix4(source.matrixWorld));
      const occluded = (source.isPointLight || source.isSpotLight || source.isRectAreaLight) && walls.some(w => probes.every(p => origins.every(o => blocked(o, p, w))));
      flat.add(proxy); localLights.push({ source, proxy, occluded });
    }
    mirror.userData.reflection = { scene: flat, meshes, lights: localLights, materials };
  }
  for (const r of mirrors) r.userData.prepareMs = performance.now() - start;
}

const warmCamera = new THREE.PerspectiveCamera(62, 1, 0.05, 8), warmPosition = new THREE.Vector3(), warmNormal = new THREE.Vector3();
export function warmMirrors(renderer, scene, mirrors) {
  for (const r of mirrors ?? []) {
    warmPosition.setFromMatrixPosition(r.matrixWorld); warmNormal.set(0, 0, 1).transformDirection(r.matrixWorld);
    warmCamera.position.copy(warmPosition).addScaledVector(warmNormal, 1.5); warmCamera.lookAt(warmPosition); warmCamera.updateMatrixWorld();
    const visible = r.visible; r.visible = true;
    try { r.onBeforeRender(renderer, scene, warmCamera); } finally { r.visible = visible; }
  }
}

const frustum = new THREE.Frustum(), projection = new THREE.Matrix4(), sphere = new THREE.Sphere();
const mirrorPosition = new THREE.Vector3(), mirrorNormal = new THREE.Vector3(), toEye = new THREE.Vector3(), projected = new THREE.Vector3();
const candidates = [];
export function updateMirrors(mirrors, camera, hq, renderer) {
  if (!mirrors) return;
  candidates.length = 0;
  camera.updateMatrixWorld();
  frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  for (const r of mirrors) {
    r.visible = false;
    if (!hq || r.userData.disabled) continue;
    mirrorPosition.setFromMatrixPosition(r.matrixWorld);
    toEye.subVectors(camera.position, mirrorPosition);
    const distance = toEye.lengthSq();
    mirrorNormal.set(0, 0, 1).transformDirection(r.matrixWorld);
    if (distance > 4.5 * 4.5 || toEye.dot(mirrorNormal) < 0.05) continue;
    if (!r.geometry.boundingSphere) r.geometry.computeBoundingSphere();
    sphere.copy(r.geometry.boundingSphere).applyMatrix4(r.matrixWorld);
    if (!frustum.intersectsSphere(sphere)) continue;
    if (r.userData.walls) {
      let hidden = false;
      for (const wall of r.userData.walls) {
        if (!blocked(camera.position, mirrorPosition, wall)) continue;
        hidden = true;
        for (const corner of r.userData.corners) {
          projected.copy(corner).applyMatrix4(r.matrixWorld);
          if (!blocked(camera.position, projected, wall)) { hidden = false; break; }
        }
        if (hidden) break;
      }
      if (hidden) continue;
    }
    r.userData.distance = distance; candidates.push(r);
  }
  candidates.sort((a, b) => a.userData.distance - b.userData.distance);
  const canvas = renderer.domElement;
  for (let i = 0; i < Math.min(2, candidates.length); i++) {
    const r = candidates[i]; let minX = 1, maxX = -1, minY = 1, maxY = -1;
    for (const corner of r.userData.corners) {
      projected.copy(corner).applyMatrix4(r.matrixWorld).project(camera);
      minX = Math.min(minX, projected.x); maxX = Math.max(maxX, projected.x);
      minY = Math.min(minY, projected.y); maxY = Math.max(maxY, projected.y);
    }
    const w = Math.max(128, Math.min(1536, Math.ceil((Math.min(1, maxX) - Math.max(-1, minX)) * canvas.width / 2 / 64) * 64));
    const h = Math.max(128, Math.min(1536, Math.ceil((Math.min(1, maxY) - Math.max(-1, minY)) * canvas.height / 2 / 64) * 64));
    const rt = r.getRenderTarget();
    if (w > rt.width || w < rt.width * 0.7 || h > rt.height || h < rt.height * 0.7) rt.setSize(w, h);
    r.visible = true;
  }
}
