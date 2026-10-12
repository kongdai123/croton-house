// Picks the most open view from a point, so automatic cameras (sitting down, fly-tos) never stare into a wall. Rays at eye
// height pass through glass and sheers; long views and views out of a window score higher, with a gentle pull toward the
// preferred direction. Yaws here use the seat convention: forward = (sin a, 0, cos a).
import { THREE } from './kit.js';

const ray = new THREE.Raycaster();
const seeThrough = (m) => m && m.transparent && m.opacity < 0.6;
let cache = null;
function meshesOf(roots) {
  if (cache && cache.roots === roots) return cache.list;
  const list = []; for (const r of roots) r.traverse(o => { if (o.isMesh && !o.isInstancedMesh && !o.isSprite && !o.userData.batch) list.push(o); });
  cache = { roots, list }; return list;
}
// Meshes a level ray from origin could hit within max: bounding sphere spans origin's height and is in range.
const sph = new THREE.Sphere();
function levelNear(roots, origin, max) {
  const out = [];
  for (const m of meshesOf(roots)) {
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    sph.copy(m.geometry.boundingSphere).applyMatrix4(m.matrixWorld);
    if (Math.abs(sph.center.y - origin.y) <= sph.radius && sph.center.distanceTo(origin) <= max + sph.radius) out.push(m);
  }
  return out;
}
// Distance to the first opaque surface along dir (and whether the ray went out through glass).
export function viewDepth(roots, origin, dir, { max = 18, skip, list } = {}) {
  ray.set(origin, dir); ray.far = max;
  let out = false;
  for (const h of ray.intersectObjects(list ?? meshesOf(roots), false)) {
    if (skip?.has(h.object) || (!h.object.visible && !h.object.userData.batched)) continue;
    const m = Array.isArray(h.object.material) ? h.object.material[0] : h.object.material;
    if (seeThrough(m)) { out = true; continue; }
    return { d: h.distance, out };
  }
  return { d: max, out };
}
export function scenicYaw(roots, origin, facing, range = Math.PI, opts = {}) { return scenicView(roots, origin, facing, range, opts).yaw; }
// Best yaw and its score (roughly: metres of open view, +3 for a view out through glass).
export function scenicView(roots, origin, facing, range = Math.PI, { exclude } = {}) {
  const skip = new Set(); exclude?.traverse(o => { if (o.isMesh) skip.add(o); });
  const steps = Math.max(1, Math.round(range / (Math.PI / 18)));
  const list = levelNear(roots, origin, 12);
  let best = facing, bestS = -Infinity;
  for (let k = -steps; k <= steps; k++) {
    if (range >= Math.PI && k === steps) continue;            // full circle: -π and +π are the same direction
    const a = facing + (k / steps) * range;
    let s = 0;
    for (const off of [-0.28, 0, 0.28]) {
      const r = viewDepth(roots, origin, new THREE.Vector3(Math.sin(a + off), 0, Math.cos(a + off)), { skip, list, max: 12 });
      s += Math.min(r.d, 12) + (r.out ? 3 : 0);
    }
    s = s / 3 - Math.abs(k / steps) * range * 0.8;
    if (s > bestS) { bestS = s; best = a; }
  }
  return { yaw: best, score: bestS };
}
export const SEAT_LOOK_RANGE = { bed: Math.PI, ledge: Math.PI / 2, bench: Math.PI / 2, plain: Math.PI / 2, sofa: Math.PI / 3, armchair: Math.PI / 3, chair: Math.PI / 3, stool: Math.PI / 2 };
