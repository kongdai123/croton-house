import { Data3DTexture, DataUtils, HalfFloatType, RGBAFormat, LinearFilter } from 'three/webgpu';
import { texture3D, float, vec3, positionWorld, normalWorld } from 'three/tsl';
import { plan } from '../plan.js';

export function parseProbes(buffer) {
  const size = new DataView(buffer).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, size)));
  const count = header.count;
  if (!Number.isInteger(count) || count < 1 || header.points.length !== count) throw new Error('Invalid probe count');
  let offset = 4 + size;
  const valid = new Uint8Array(buffer.slice(offset, offset + count));
  offset = (offset + count + 3) & ~3;
  const layers = {};
  for (const name of header.layers) {
    layers[name] = new Float32Array(buffer.slice(offset, offset + count * 27 * 4));
    offset += count * 27 * 4;
  }
  for (const name of ['sky', 'sunind', 'lamps']) {
    if (layers[name]?.length !== count * 27 || !layers[name].every(Number.isFinite)) throw new Error(`Invalid probe layer: ${name}`);
  }
  const points = header.points.flat();
  if (points.length !== count * 3 || !points.every(Number.isFinite) || !valid.some(Boolean)) throw new Error('Invalid probe positions/validity');
  return { count, valid, layers, points };
}

// Texture axes are x, plan-north, height: 51 × 55 × 3 over plan.volumes.probe, matching lightmap.js buildProbeVolume.
const V = plan.volumes.probe, STEP = V.step, DH = Math.round((V.heights[1] - V.heights[0]) * 1e4) / 1e4;
const NX = Math.round((V.x1 - V.x0) / STEP) + 1, NZ = Math.round((V.y1 - V.y0) / STEP) + 1, NY = V.heights.length;
// Irradiance from one colour's L1 SH (three's order: L0, y, z, x), Geomerics' non-linear reconstruction: never negative
// opposite a strong source, as the WebGL probe shader (shaders/probe.glsl.js probeEvalL1; postmortem row 19).
function evalL1(c, n) {
  const A = c.x.mul(0.886227).max(0), B = vec3(c.w, c.y, c.z).mul(1.023328), L = B.length();
  const r = L.div(A.mul(2).max(1e-8)).clamp(0, 1), q = B.dot(n).div(L.max(1e-8)).mul(0.5).add(0.5).clamp(0, 1);
  const p = r.mul(2).add(1), a = float(1).sub(r).div(r.add(1));
  return A.mul(a.add(float(1).sub(a).mul(p.add(1)).mul(q.pow(p))));
}
export function buildProbeVolume(probes, initialLamps) {
  const valid = Array.from({ length: probes.count }, (_, i) => i).filter(i => probes.valid[i]);
  const near = new Int32Array(NX * NZ * NY * 4), weights = new Float32Array(near.length);
  for (let y = 0; y < NY; y++) for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
    const px = V.x0 + x * STEP, py = V.heights[0] + y * DH, pz = -V.y0 - z * STEP, best = [];
    for (const i of valid) {
      const dx = probes.points[i * 3] - px, dy = (probes.points[i * 3 + 1] - py) * 2, dz = probes.points[i * 3 + 2] - pz;
      const distance = dx * dx + dy * dy + dz * dz;
      if (best.length < 4 || distance < best[best.length - 1][0]) {
        best.push([distance, i]); best.sort((a, b) => a[0] - b[0]); best.length = Math.min(4, best.length);
      }
    }
    const cell = ((y * NZ + z) * NX + x) * 4;
    const sum = best.reduce((total, [d]) => total + 1 / (d + 0.02), 0);
    best.forEach(([d, i], k) => { near[cell + k] = i; weights[cell + k] = 1 / (d + 0.02) / sum; });
  }
  // Filterable half float avoids depending on WebGPU's optional float32-filterable feature.
  const textures = Array.from({ length: 3 }, () => Object.assign(
    new Data3DTexture(new Uint16Array(NX * NZ * NY * 4), NX, NZ, NY),
    { type: HalfFloatType, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter, unpackAlignment: 1 },
  ));
  function fill(lampLevel) {
    for (let cell = 0; cell < NX * NZ * NY; cell++) for (let channel = 0; channel < 3; channel++) for (let k = 0; k < 4; k++) {
      let value = 0;
      for (let j = 0; j < 4; j++) {
        const index = near[cell * 4 + j] * 27 + k * 3 + channel;
        value += weights[cell * 4 + j] * (probes.layers.sky[index] + probes.layers.sunind[index] + lampLevel * probes.layers.lamps[index]);
      }
      if (!Number.isFinite(value) || Math.abs(value) > 65504) throw new Error('Probe coefficient exceeds half float range');
      textures[channel].image.data[cell * 4 + k] = DataUtils.toHalfFloat(value);
    }
    for (const texture of textures) texture.needsUpdate = true;
  }
  fill(initialLamps);
  function irradiance(normal = normalWorld) {
    const grid = positionWorld.sub(vec3(V.x0, V.heights[0], -V.y0)).mul(vec3(1 / STEP, 1 / DH, -1 / STEP));
    const uvw = grid.xzy.add(0.5).div(vec3(NX, NZ, NY));
    return vec3(...textures.map(t => evalL1(texture3D(t, uvw), normal)));
  }
  return { textures, fill, irradiance, count: valid.length };
}
