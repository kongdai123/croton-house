// The aim ray against heavy meshes (wicker shells, cushions, the fire pit: 1-36k triangles each) runs through a bounding
// volume hierarchy, built the first time the ray reaches the mesh's bounds; three's own bounding-sphere test (with the
// ray's far limit) still comes first. Same triangles, same hits: the pick reads only their distance, point and mesh.
// (On the patio the aim cost ~5 ms per frame on a 2.1 GHz Xeon, nearly all of it brute-force triangle tests.)
import { THREE } from './kit.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

const HEAVY = 1000, SPHERE = new THREE.Sphere(), LOCAL = new THREE.Ray(), AT = new THREE.Vector3();
export function heavyRaycast(raycaster, intersects) {
  const g = this.geometry;
  if (g.boundingSphere === null) g.computeBoundingSphere();
  SPHERE.copy(g.boundingSphere).applyMatrix4(this.matrixWorld);
  LOCAL.copy(raycaster.ray).recast(raycaster.near);
  if (!SPHERE.containsPoint(LOCAL.origin)) {
    if (LOCAL.intersectSphere(SPHERE, AT) === null) return;
    if (LOCAL.origin.distanceToSquared(AT) > (raycaster.far - raycaster.near) ** 2) return;
  }
  g.boundsTree ??= new MeshBVH(g, { indirect: true });   // indirect: the geometry's own index is left as it is
  acceleratedRaycast.call(this, raycaster, intersects);
}
export function fastPicks(roots) {
  let n = 0;
  for (const r of roots) r.traverse(o => {
    if (o.constructor !== THREE.Mesh || o.raycast !== THREE.Mesh.prototype.raycast || !o.geometry?.attributes.position) return;
    const g = o.geometry, tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    if (tris < HEAVY || g.drawRange.start !== 0 || g.drawRange.count !== Infinity || Object.keys(g.morphAttributes ?? {}).length) return;
    o.raycast = heavyRaycast; n++;
  });
  return n;
}
