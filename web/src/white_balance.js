// The baked walkthrough's white balance (policy and the reasons: white_balance_policy.js; docs/white-balance.md).
// Per frame, on the CPU, from the probe volume's own CPU copy read exactly as the composed shader reads it (probe.glsl.js
// probeFetch: region-aware across the house's outline, the slot crossfade's next volume blended in): the light on the
// surfaces in view indoors, the mean light at the eye outdoors; clamped, eased in time, and turned into a 3 x 3 von Kries
// matrix that the output pass applies in scene-linear before exposure and AgX (agx.js; three's OutputPass fallback through
// auto_exposure.js). No GPU resource, no readback; a context loss leaves nothing to rebuild.
import * as THREE from 'three';
import { isInside } from './plan.js';
import { WHITE_BALANCE, whiteBalanceEnabled, degreeOverride, clampIlluminant, adaptationDegree, temperatureMatrix, glideWhiteBalance, luminance } from './white_balance_policy.js';

const half = THREE.DataUtils.fromHalfFloat;
const cellX = new Int32Array(4), cellZ = new Int32Array(4), weight = new Float64Array(4);   // scratch: no garbage per frame

// The probe volume's SH at scene point p (12 numbers: L0, then the y, z and x terms, for R, G and B; three's order), as
// probeFetch reads it: the four cells around p in plan, those across the house's outline from p left out and the rest
// renormalised (unless all or none are), filtered between two height slices clamped as the shader clamps them; during a
// slot fade (uProbeBlend > 0) the next slot's volume mixed in. u: the volume's uniforms (lightmap.js buildProbeVolume, as
// lightmap_slots.js rewires them; data [(ch * cells + c) * 4 + k], c = (y * NZ + z) * NX + x, half floats). Returns null
// without CPU data (a texture that never had any).
export function probeSH(u, p, out = new Float64Array(12)) {
  const cur = u.uProbeSH?.value?.image?.data, next = u.uProbeNextSH?.value?.image?.data, blend = u.uProbeBlend?.value ?? 0;
  if (!cur) return null;
  const O = u.uProbeOrigin.value, S = u.uProbeScale.value, dims = u.uProbeDims.value;   // dims: x, height slices, z
  const gx = (p.x - O.x) * S.x, gy = (p.y - O.y) * S.y, gz = (p.z - O.z) * S.z, cx = Math.floor(gx), cz = Math.floor(gz), fx = gx - cx, fz = gz - cz;
  const step = 1 / S.x, side = isInside(p.x, -p.z);
  let kept = 0;
  for (let i = 0; i < 4; i++) {
    const x = Math.min(Math.max(cx + (i & 1), 0), dims.x - 1), z = Math.min(Math.max(cz + (i >> 1), 0), dims.z - 1);
    cellX[i] = x; cellZ[i] = z; weight[i] = (i & 1 ? fx : 1 - fx) * (i >> 1 ? fz : 1 - fz);
    if (isInside(O.x + x * step, -O.z + z * step) === side) kept += weight[i]; else weight[i] = -weight[i];   // across: negative
  }
  // where the four cells straddle the outline only this side's count, renormalised; else the plain filter
  const split = kept > 0 && kept < 1 - 1e-9;
  for (let i = 0; i < 4; i++) weight[i] = split ? Math.max(weight[i], 0) / kept : Math.abs(weight[i]);
  const h = Math.min(Math.max(gy, 0.01), dims.y - 1.01), y0 = Math.floor(h), fy = h - y0, cells = dims.x * dims.y * dims.z;
  const mix = next && next !== cur && blend > 0 ? blend : 0;
  out.fill(0);
  for (let i = 0; i < 4; i++) {
    if (weight[i] <= 0) continue;
    const a = (y0 * dims.z + cellZ[i]) * dims.x + cellX[i], b = a + dims.z * dims.x;   // this cell in slices y0, y0 + 1
    for (let ch = 0; ch < 3; ch++) for (let k = 0; k < 4; k++) {
      const ia = (ch * cells + a) * 4 + k, ib = (ch * cells + b) * 4 + k;
      let v = (1 - fy) * half(cur[ia]) + fy * half(cur[ib]);
      if (mix) v += mix * ((1 - fy) * half(next[ia]) + fy * half(next[ib]) - v);
      out[ch * 4 + k] += weight[i] * v;
    }
  }
  return out;
}
const scratchSH = new Float64Array(12);
// The L0 colour alone (the SH's mean radiance, linear Rec.709, the volume's units)
export function probeIlluminant(u, p, out = [0, 0, 0]) {
  const s = probeSH(u, p, scratchSH);
  if (!s) return null;
  out[0] = s[0]; out[1] = s[4]; out[2] = s[8];
  return out;
}
// Irradiance on a surface of normal n from one colour's L1 SH (L0, y, z, x), as the shader lights a probe-lit surface:
// probe.glsl.js probeEvalL1, Geomerics' non-linear reconstruction (test_white_balance.mjs holds it to the shader's text).
export function probeEvalL1(c0, c1, c2, c3, n) {
  const A = Math.max(0.886227 * c0, 0), bx = 1.023328 * c3, by = 1.023328 * c1, bz = 1.023328 * c2, L = Math.hypot(bx, by, bz);
  const r = Math.min(Math.max(L / Math.max(2 * A, 1e-8), 0), 1), q = Math.min(Math.max(0.5 + 0.5 * (bx * n.x + by * n.y + bz * n.z) / Math.max(L, 1e-8), 0), 1);
  const p = 1 + 2 * r, a = (1 - r) / (1 + r);
  return A * (a + (1 - a) * (p + 1) * Math.pow(q, p));
}
// Distance along a ray (unit direction d) to the first wall box (lightmap.js probeWalls: [x0, x1, height0, height1, z0, z1]
// in scene coordinates, the plan's wall pieces: solid, sill and lintel, so openings let the ray through), at most max.
export function wallDistance(o, d, walls, max) {
  let best = max;
  for (const b of walls) {
    let lo = 0, hi = best;
    for (let a = 0; a < 3 && lo <= hi; a++) {
      const p = a === 0 ? o.x : a === 1 ? o.y : o.z, v = a === 0 ? d.x : a === 1 ? d.y : d.z;
      if (Math.abs(v) < 1e-12) { if (p < b[a * 2] || p > b[a * 2 + 1]) lo = Infinity; continue; }
      const t0 = (b[a * 2] - p) / v, t1 = (b[a * 2 + 1] - p) / v;
      lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
    }
    if (lo <= hi) best = lo;
  }
  return best;
}

// The adapting illuminant at the camera (linear RGB; only its colour is used), from the probe volume u, the plan's wall
// boxes and the camera's indoor weight (plan.js indoorWeight):
//  - indoors, the light on the surfaces in view: rays across the view (settings.rays, degrees about the horizontal view
//    direction, at eye height) run to the first wall piece or to where they leave the eye's side of the house's outline (a
//    window: the room keeps its own light), at most settings.reach; a little short of there (settings.back) the probe
//    irradiance facing back along the ray, as the shader would light a white wall there, summed over the rays (brighter
//    walls weigh more, as they do for the eye). Measured against the walls of gate (c)'s frames this is 3x closer than the
//    eye's own mean light, which takes in a lamp-lit doorway behind the camera (docs/white-balance.md);
//  - outdoors, the mean light at the eye and at settings.ahead along the view (the probe L0): the sky is much of the view;
//  - in between (a doorway), the two colours blended at equal luminance by the indoor weight.
// Returns null when the volume has no CPU data.
const view = new THREE.Vector3(), ray = new THREE.Vector3(), at = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
const more = [0, 0, 0], inside = [0, 0, 0], outside = [0, 0, 0];
export function adaptingIlluminant(u, camera, walls = [], indoor = 1, settings = WHITE_BALANCE, out = [0, 0, 0]) {
  if (!u.uProbeSH?.value?.image?.data) return null;
  const eye = camera.position;
  view.set(0, 0, -1).applyQuaternion(camera.quaternion).setY(0);
  if (view.lengthSq() < 1e-8) view.set(0, 1, 0).applyQuaternion(camera.quaternion).setY(0);   // straight down: the top of the frame
  if (view.lengthSq() < 1e-8) view.set(0, 0, -1);
  view.normalize();
  inside.fill(0); outside.fill(0);
  if (indoor > 0) {
    const side = isInside(eye.x, -eye.z);
    for (const deg of settings.rays) {
      ray.copy(view).applyAxisAngle(UP, -deg * Math.PI / 180);
      let t = wallDistance(eye, ray, walls, settings.reach);
      for (let s = 0.25; s < t; s += 0.25) if (isInside(eye.x + ray.x * s, -(eye.z + ray.z * s)) !== side) { t = s - 0.25; break; }
      at.copy(eye).addScaledVector(ray, Math.max(t - settings.back, Math.min(t, 0.25)));
      const s = probeSH(u, at, scratchSH);
      ray.negate();
      for (let ch = 0; ch < 3; ch++) inside[ch] += probeEvalL1(s[ch * 4], s[ch * 4 + 1], s[ch * 4 + 2], s[ch * 4 + 3], ray);
    }
  }
  if (indoor < 1) {
    probeIlluminant(u, eye, outside);
    for (const a of settings.ahead) {
      if (wallDistance(eye, view, walls, a) < a) break;
      probeIlluminant(u, at.copy(eye).addScaledVector(view, a), more);
      for (let i = 0; i < 3; i++) outside[i] += more[i];
    }
  }
  const yi = luminance(inside), yo = luminance(outside), w = yi > 0 && yo > 0 ? indoor : yi > 0 ? 1 : 0;
  // blended at equal luminance, at the brighter reading's level (clampIlluminant's darkness floor reads it)
  const level = Math.max(yi, yo);
  for (let i = 0; i < 3; i++) out[i] = level * (w * (yi > 0 ? inside[i] / yi : 0) + (1 - w) * (yo > 0 ? outside[i] / yo : 0));
  return out;
}

// lighting: camera, outputPass, indoorWeight; volume: the probe volume's uniforms; walls: the plan's wall boxes.
export function createWhiteBalance({ lighting, volume, walls = [], renderer = null, query = new URLSearchParams(location.search), settings = {} }) {
  if (!whiteBalanceEnabled(query) || !volume) return null;
  const { camera, outputPass, indoorWeight } = lighting;
  if (!camera || !outputPass) return null;
  const params = { ...WHITE_BALANCE, ...degreeOverride(query), ...settings };
  const matrix = new THREE.Matrix3(), last = new THREE.Vector3(), reading = [0, 0, 0];
  let state = null, target = null, illuminant = null, disposed = false, failed = false, ms = 0;
  const reset = () => { state = null; };
  const api = {
    settings: params, matrix,
    // Each frame, after the lamp groups refill the volume. Not essential to showing the house: a failure keeps the last
    // matrix and is reported once (console.error: a real bug, the gates see it), never thrown into the baked walk's frame.
    update(dt) {
      if (disposed) return;
      const t0 = performance.now();
      try {
        const snap = !state || last.distanceToSquared(camera.position) > params.teleport ** 2;
        last.copy(camera.position);
        const indoor = Math.min(1, Math.max(0, indoorWeight(camera.position)));
        illuminant = adaptingIlluminant(volume, camera, walls, indoor, params, reading);
        const clamped = illuminant && clampIlluminant(illuminant, params);
        target = { mired: clamped?.mired, duv: clamped?.duv, D: adaptationDegree(indoor, params), raw: clamped?.raw ?? null };
        state = glideWhiteBalance(state, target, Number.isFinite(dt) ? dt : 0, snap, params);
        matrix.set(...temperatureMatrix(state.mired, state.duv, state.D));
      } catch (err) { if (!failed) { failed = true; console.error('white balance: update failed, keeping the last matrix', err); } }
      ms = performance.now() - t0;
    },
    reset,
    // for debugging (window.__app.lighting.whiteBalance.state): the adapting illuminant (linear), its raw temperature and
    // tint, the target (clamped; degree) and the applied state, the matrix (row-major) and the CPU time of the last update
    get state() {
      const k = s => s && s.mired !== undefined ? { kelvin: Math.round(1e6 / s.mired), duv: +s.duv.toFixed(4), D: +s.D.toFixed(3) } : null;
      return { illuminant: illuminant?.map(v => +v.toPrecision(4)) ?? null, raw: target?.raw ? { kelvin: Math.round(target.raw.kelvin), duv: +target.raw.duv.toFixed(4) } : null,
        target: k(target), applied: k(state), matrix: matrix.clone().transpose().elements.map(v => +v.toFixed(4)), ms: +ms.toFixed(3) };
    },
    dispose() {
      if (disposed) return; disposed = true;
      renderer?.domElement?.removeEventListener('webglcontextrestored', reset);
      if (outputPass.whiteBalance === matrix) delete outputPass.whiteBalance;
      if (lighting.whiteBalance === api) delete lighting.whiteBalance;
    },
  };
  // The output pass (agx.js, auto_exposure.js) applies outputPass.whiteBalance while it is set.
  outputPass.whiteBalance = matrix;
  // A restored context starts its exposure afresh (auto_exposure.js); the white balance snaps with it.
  renderer?.domElement?.addEventListener('webglcontextrestored', reset);
  lighting.whiteBalance = api;
  return api;
}
