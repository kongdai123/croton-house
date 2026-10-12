// Window visibility and low-frequency room bounce, baked once before batching.
// World-space sampling keeps the fill stable while walking, in mirrors and in fast mode.
import * as THREE from 'three';
import { M } from './materials.js';

const NX = 57, NZ = 41, NY = 9;
const UNIT = { value: 1 };
const MIN = new THREE.Vector3(-8.1, 0, -5.62), SIZE = new THREE.Vector3(16.2, 2.44, 11.56);
function texture(data, depth) {
  const t = new THREE.Data3DTexture(data, NX, NZ, depth);
  t.format = THREE.RedFormat; t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter; t.unpackAlignment = 1; t.needsUpdate = true;
  return t;
}

// Segment/AABB test, without allocations in the bake's inner loop.
function blocked(x, y, z, dx, dy, dz, boxes) {
  for (const b of boxes) {
    let lo = 0.001, hi = 0.995;
    for (let a = 0; a < 3 && lo <= hi; a++) {
      const p = a === 0 ? x : a === 1 ? y : z, d = a === 0 ? dx : a === 1 ? dy : dz;
      if (Math.abs(d) < 1e-6) { if (p < b[a] || p > b[a + 3]) hi = -1; }
      else {
        const t0 = (b[a] - p) / d, t1 = (b[a + 3] - p) / d;
        lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
      }
    }
    if (lo <= hi) return true;
  }
  return false;
}

export function bakeDaylight(root, lights) {
  const start = performance.now(), walls = [], contacts = [], bounds = new THREE.Box3();
  root.getObjectByName('house').traverse(o => {
    if (!o.isMesh || !o.material?.isMeshStandardMaterial) return;
    const m = o.material;
    if (m !== M.wallPaint() && m !== M.stucco() && !(m.roughness === 0.94 && !m.map)) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    bounds.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    if (bounds.min.y > 2.44 || bounds.max.y < 0) return;
    walls.push([...bounds.min.toArray(), ...bounds.max.toArray()]);
  });
  root.traverse(o => {
    if (!o.isMesh || !o.visible || !o.material?.isMeshStandardMaterial || o.material.transparent || o.isInstancedMesh) return;
    for (let p = o; p; p = p.parent) if (p.userData.movable || p.userData.toggle || p.name === 'house') return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    bounds.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    const s = bounds.getSize(new THREE.Vector3()), c = bounds.getCenter(new THREE.Vector3());
    if (c.x < -8 || c.x > 8 || c.z < -5.5 || c.z > 5.8 || c.y > 2.4 || Math.min(s.x, s.y, s.z) < 0.12 || Math.max(s.x, s.z) < 0.65) return;
    contacts.push([...bounds.min.toArray(), ...bounds.max.toArray()]);
  });
  const windows = lights.map(light => {
    const samples = [], center = light.position.clone(), inward = light.userData.inward;
    const horizontal = new THREE.Vector3(inward.z, 0, -inward.x);
    for (const u of [-0.35, 0, 0.35]) for (const v of [-0.35, 0, 0.35]) {
      samples.push(center.clone().addScaledVector(horizontal, light.width * u).add(new THREE.Vector3(0, light.height * v, 0)).toArray());
    }
    return { center, inward, samples, area: light.width * light.height };
  });
  const count = NX * NZ * NY, visibility = new Uint8Array(count * windows.length), bounce = new Uint8Array(count);
  const directions = Array.from({ length: 12 }, (_, i) => {
    const y = 1 - 2 * (i + 0.5) / 12, r = Math.sqrt(1 - y * y), a = i * 2.399963;
    return [0.65 * r * Math.cos(a), 0.65 * y, 0.65 * r * Math.sin(a)];
  });
  const obstacles = walls.concat(contacts);
  const ambientTexture = texture(bounce, NY), windowTexture = texture(visibility, NY * windows.length);
  let bakeMs = 0, baked = false;
  // The ~2 s of ray tests run in bake(), which main.js calls while the GPU process compiles the shaders, so the bake
  // overlaps the compile instead of adding to the load. The textures start as zeros and upload again once filled.
  function bake() {
    if (baked) return; baked = true;
    const t0 = performance.now();
    for (let iy = 0; iy < NY; iy++) for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) {
    const x = MIN.x + SIZE.x * ix / (NX - 1), y = SIZE.y * iy / (NY - 1), z = MIN.z + SIZE.z * iz / (NZ - 1);
    const index = (iy * NZ + iz) * NX + ix;
    let sky = 0;
    for (let w = 0; w < windows.length; w++) {
      const { center, inward, samples, area } = windows[w];
      let seen = 0;
      for (const s of samples) if (!blocked(x, y, z, s[0] - x, s[1] - y, s[2] - z, walls)) seen++;
      const v = seen / samples.length; visibility[w * count + index] = Math.round(v * 255);
      const dx = x - center.x, dy = y - center.y, dz = z - center.z, d2 = dx * dx + dy * dy + dz * dz;
      const facing = Math.max(0, (dx * inward.x + dz * inward.z) / Math.sqrt(d2 + 0.01));
      sky += v * facing * area / (d2 + area);
    }
    let open = 0;
    for (const d of directions) if (!blocked(x, y, z, ...d, obstacles)) open++;
    const contact = 0.68 + 0.32 * open / directions.length;
    bounce[index] = Math.round(255 * (0.3 + 0.62 * (1 - Math.exp(-sky * 1.25))) * contact);
    }
    ambientTexture.needsUpdate = true; windowTexture.needsUpdate = true;
    bakeMs = performance.now() - t0;
  }
  const day = { value: 1 }, ambient = { value: ambientTexture }, window = { value: windowTexture };
  const lookup = windows.map(({ center }, i) => `if ( distance( worldLight, vec3(${center.toArray().map(n => n.toFixed(5)).join(',')}) ) < 0.08 ) return texture( uDaylightWindows, vec3( uv.xy, (${i}.0 * ${NY}.0 + uv.z * ${NY - 1}.0 + 0.5) / ${NY * windows.length}.0 ) ).r;`).join('\n');
  const declarations = `uniform float uInteriorDay; uniform highp sampler3D uDaylightAmbient; uniform highp sampler3D uDaylightWindows; varying vec3 vDaylightPosition;
    vec3 daylightWorldDirection(vec3 v) { return vec3(dot(viewMatrix[0].xyz, v), dot(viewMatrix[1].xyz, v), dot(viewMatrix[2].xyz, v)); }
    vec3 daylightUv(vec3 normal) {
      vec3 p = vDaylightPosition + daylightWorldDirection(normal) * 0.18;
      return clamp((p - vec3(-8.1, 0.0, -5.62)) / vec3(16.2, 2.44, 11.56), 0.0, 1.0).xzy;
    }
    float daylightWindow(vec3 lightPosition, vec3 uv) {
      if (uInteriorDay < 0.5) return 1.0;
      vec3 worldLight = cameraPosition + daylightWorldDirection(lightPosition);
      ${lookup}
      return 1.0;
    }`;
  // `paint` and the options are uniform objects ({ value }) so one compiled program serves every paint tint and both the
  // interior (day = the shared day flag) and exterior (day = 0, bounce = pavement bounce) regions. A number is accepted too.
  function patch(shader, paint = 1, { day: dayFlag = day, bounce = UNIT } = {}) {
    shader.uniforms.uInteriorDay = dayFlag; shader.uniforms.uDaylightAmbient = ambient; shader.uniforms.uDaylightWindows = window;
    shader.uniforms.uDaylightPaint = typeof paint === 'number' ? { value: paint } : paint;
    shader.uniforms.uExteriorBounce = bounce;
    shader.vertexShader = 'varying vec3 vDaylightPosition;\n' + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 daylightPosition = vec4(transformed, 1.0);
      #ifdef USE_BATCHING
        daylightPosition = batchingMatrix * daylightPosition;
      #endif
      #ifdef USE_INSTANCING
        daylightPosition = instanceMatrix * daylightPosition;
      #endif
      vDaylightPosition = (modelMatrix * daylightPosition).xyz;`);
    shader.fragmentShader = 'uniform float uDaylightPaint; uniform float uExteriorBounce;\n' + declarations + '\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(1.0, uDaylightPaint, uInteriorDay);');
    shader.fragmentShader = shader.fragmentShader.replace('vec3 geometryPosition = - vViewPosition;', `vec3 geometryPosition = - vViewPosition;
      vec3 daylightCoords = daylightUv(normal);
      vec3 ambientCoords = (daylightCoords * vec3(${NX - 1}.0, ${NZ - 1}.0, ${NY - 1}.0) + 0.5) / vec3(${NX}.0, ${NZ}.0, ${NY}.0);
      float daylightFill = mix(1.0, texture(uDaylightAmbient, ambientCoords).r, uInteriorDay);`);
    shader.fragmentShader = shader.fragmentShader.replace('rectAreaLight = rectAreaLights[ i ];', 'rectAreaLight = rectAreaLights[ i ];\nrectAreaLight.color *= daylightWindow(rectAreaLight.position, daylightCoords);');
    shader.fragmentShader = shader.fragmentShader.replace('getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal )', 'uExteriorBounce * mix(1.0, 0.28, uInteriorDay) * getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal )');
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\niblIrradiance *= daylightFill; radiance *= mix(1.0, sqrt(daylightFill), uInteriorDay);');
  }
  return { day, patch, bake, get bakeMs() { return bakeMs; }, collectMs: performance.now() - start, wallCount: walls.length, contactCount: contacts.length };
}
