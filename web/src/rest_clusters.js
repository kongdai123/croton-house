// Doors, toggles (blinds, the garage door, the umbrella) and pieces the visitor carries, drawn per material and cell
// while they rest (baked walkthrough, main.js; ?restmerge=0 turns it off). Each keeps its own meshes, merged per parent at
// best (batch.js), and the house shows dozens of them from any garden view: 16 doors, 26 carried pieces, the garage
// door's sections. Here every such mesh is also copied, in its world pose, into a mesh per material and CELL x CELL m
// square that the walkthrough camera draws instead (mainOnly / mainOff, as plant_clusters.js: every other view, the sun's
// shadow above all, keeps drawing the meshes themselves). A member drops out of its merged mesh, and its own mesh draws
// again, from the frame it moves, hides, changes material (the hover tint) or changes shape (its vertices edited in place:
// the umbrella's canopy unfolds that way; its position attribute's version says so), and returns once it has held still
// for REST_FRAMES frames, re-copied in its new pose and shape. A member whose geometry is replaced draws itself for good. update() runs after the frame's motion and the sun-shadow cache's scan
// (which brings the tracked roots' world matrices up to date: main.js).
import { THREE } from './kit.js';
import { inheritLighting } from './lighting_roles.js';
import { mainLayersTest } from './plant_clusters.js';

const CELL = 16, REST_FRAMES = 20;
const noRaycast = () => {};
const PROTO_BEFORE = THREE.Object3D.prototype.onBeforeRender;
const signature = g => {
  if (g.morphAttributes && Object.keys(g.morphAttributes).length) return null;
  if (g.drawRange.count !== Infinity || g.drawRange.start) return null;
  const parts = [];
  for (const [name, a] of Object.entries(g.attributes)) { if (a.isInterleavedBufferAttribute || a.isInstancedBufferAttribute) return null; parts.push(`${name}:${a.itemSize}:${+a.normalized}:${a.array.constructor.name}`); }
  return parts.sort().join(',');
};
const shownChain = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
const shapeOf = m => m.geometry.attributes.position.version;
// a root whose animation moves something with the toggle held (the sheer curtains' billow): never at rest
function continuous(root) {
  const animate = root.userData.animate; if (!animate) return false;
  const meshes = []; root.traverse(o => { if (o.isMesh) meshes.push(o); });
  const snap = () => { root.updateMatrixWorld(true); return meshes.map(o => o.matrixWorld.clone()); };
  animate(0); const a = snap(); animate(1.3); const b = snap(); animate(4.1); const c = snap(); animate(0); root.updateMatrixWorld(true);
  return meshes.some((o, i) => !a[i].equals(b[i]) || !a[i].equals(c[i]));
}

// roots: doors' groups, toggles, carried pieces; camera: the walkthrough camera; parent: where the merged meshes go
export function createRestClusters({ roots, camera, parent }) {
  const t0 = performance.now(), test = mainLayersTest(camera.layers), groups = new Map(), c = new THREE.Vector3(), box = new THREE.Box3();
  for (const root of roots) {
    if (!root?.parent || continuous(root)) continue;
    root.updateMatrixWorld(true);
    root.traverse(m => {
      // (lightmapped parts hold still for good: a door's frame, a blind's head rail. They stay as they are: flush with the
      // walls around them, a copy rounded on the CPU would z-fight there differently)
      if (m.constructor !== THREE.Mesh || !shownChain(m) || Array.isArray(m.material) || !m.material || m.material.transparent || m.material.isShaderMaterial || m.material.lightMap) return;
      if (m.onBeforeRender !== PROTO_BEFORE || m.userData.mainOnly || m.userData.lightHit || m.userData.lightSwitch || m.matrixWorld.determinant() <= 0) return;
      const sig = signature(m.geometry); if (!sig) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      box.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld).getCenter(c);
      const key = `${m.material.uuid}|${sig}|${+!!m.geometry.index}|${+m.receiveShadow}|${m.renderOrder}|${+m.frustumCulled}|${m.layers.mask}|${Math.floor(c.x / CELL)},${Math.floor(c.z / CELL)}`;
      let g = groups.get(key); if (!g) groups.set(key, g = { material: m.material, members: [] });
      g.members.push(m);
    });
  }
  const clusters = [], nm = new THREE.Matrix3(), v = new THREE.Vector3();
  // world positions and normals of a member into the merged arrays at its base
  const place = (arrays, m, base) => {
    const g = m.geometry, n = g.attributes.position.count, w = m.matrixWorld; nm.getNormalMatrix(w);
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(g.attributes.position, i).applyMatrix4(w); arrays.position[(base + i) * 3] = v.x; arrays.position[(base + i) * 3 + 1] = v.y; arrays.position[(base + i) * 3 + 2] = v.z;
      if (arrays.normal) { v.fromBufferAttribute(g.attributes.normal, i).applyMatrix3(nm).normalize(); arrays.normal[(base + i) * 3] = v.x; arrays.normal[(base + i) * 3 + 1] = v.y; arrays.normal[(base + i) * 3 + 2] = v.z; }
    }
  };
  for (const g of groups.values()) {
    if (g.members.length < 2) continue;
    const first = g.members[0].geometry, names = Object.keys(first.attributes);
    if (names.includes('tangent')) continue;
    let vertices = 0, indices = 0;
    for (const m of g.members) { vertices += m.geometry.attributes.position.count; indices += m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count; }
    const arrays = {}; for (const name of names) { const a = first.attributes[name]; arrays[name] = new a.array.constructor(vertices * a.itemSize); }
    const members = []; let base = 0;
    for (const m of g.members) {
      const src = m.geometry, n = src.attributes.position.count;
      for (const name of names) if (name !== 'position' && name !== 'normal') { const a = src.attributes[name]; arrays[name].set(a.array.subarray(0, n * a.itemSize), base * a.itemSize); }
      place(arrays, m, base);
      const idx = src.index, seg = new Uint32Array(idx ? idx.count : n);
      for (let i = 0; i < seg.length; i++) seg[i] = base + (idx ? idx.getX(i) : i);
      members.push({ mesh: m, base, count: n, seg, matrix: m.matrixWorld.clone(), material: m.material, geometry: src, shape: shapeOf(m), lastShape: shapeOf(m), rest: true, still: 0, last: m.matrixWorld.clone() });
      base += n;
    }
    const geometry = new THREE.BufferGeometry();
    for (const name of names) { const a = first.attributes[name]; geometry.setAttribute(name, new THREE.BufferAttribute(arrays[name], a.itemSize, a.normalized)); }
    geometry.setIndex(new THREE.BufferAttribute(new (vertices > 65535 ? Uint32Array : Uint16Array)(indices), 1));
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const src = g.members[0], mesh = new THREE.Mesh(geometry, g.material);
    mesh.castShadow = false; mesh.receiveShadow = src.receiveShadow; mesh.renderOrder = src.renderOrder; mesh.frustumCulled = src.frustumCulled;
    mesh.layers.mask = src.layers.mask; mesh.layers.mainOnly = true; mesh.layers.test = test;
    mesh.raycast = noRaycast; mesh.name = 'restCluster'; mesh.userData.batch = true; mesh.userData.mainOnly = true; mesh.matrixAutoUpdate = false;
    inheritLighting(mesh, src);
    // (its bounds stay those it was made with: room culling measured the merged mesh's footprint once)
    clusters.push({ mesh, arrays, members, dirty: true, bounds: geometry.boundingBox.clone().expandByScalar(1e-4) });
  }
  const tests = [];
  for (const cl of clusters) {
    for (const mb of cl.members) {
      const l = mb.mesh.layers; tests.push({ layers: l, test: l.test, off: l.mainOff });
      if (l.test === THREE.Layers.prototype.test) l.test = test;
      l.mainOff = true;
    }
    parent.add(cl.mesh); cl.mesh.updateMatrixWorld(true);
  }
  const rebuild = cl => {
    const index = cl.mesh.geometry.index, out = index.array; let at = 0;
    for (const mb of cl.members) if (mb.rest) { out.set(mb.seg, at); at += mb.seg.length; }
    cl.mesh.geometry.setDrawRange(0, at); cl.mesh.visible = at > 0;
    index.clearUpdateRanges?.(); if (at) index.addUpdateRange(0, at); index.needsUpdate = true; cl.dirty = false;
  };
  const stats = { clusters: clusters.length, members: clusters.reduce((n, cl) => n + cl.members.length, 0), vertices: clusters.reduce((n, cl) => n + cl.mesh.geometry.attributes.position.count, 0), live: 0, recaptures: 0, ms: 0 };
  // per frame: a member that moved, hid, took another material or changed shape draws itself; one that held still
  // REST_FRAMES frames (in a new pose or shape: re-copied) comes back
  const update = () => {
    let live = 0;
    for (const cl of clusters) {
      for (const mb of cl.members) {
        const m = mb.mesh, w = m.matrixWorld, shape = shapeOf(m), posed = w.equals(mb.matrix) && shape === mb.shape;
        const same = m.material === mb.material && m.geometry === mb.geometry && shownChain(m);
        if (mb.rest) {
          if (posed && same) continue;
          mb.rest = false; mb.still = 0; mb.last.copy(w); mb.lastShape = shape; m.layers.mainOff = false; cl.dirty = true; live++;
          continue;
        }
        live++;
        if (!same) { mb.still = 0; continue; }
        if (!w.equals(mb.last) || shape !== mb.lastShape) { mb.last.copy(w); mb.lastShape = shape; mb.still = 0; continue; }
        if (++mb.still < REST_FRAMES) continue;
        if (!posed) {   // at rest in a new pose or shape: its world copy follows, if it stays within the merged mesh's bounds
          if (!m.geometry.boundingBox || shape !== mb.shape) m.geometry.computeBoundingBox();
          if (!cl.bounds.containsBox(box.copy(m.geometry.boundingBox).applyMatrix4(w))) { mb.still = -Infinity; continue; }   // carried away: draws itself until it moves again
          place(cl.arrays, m, mb.base); mb.matrix.copy(w); mb.shape = shape; stats.recaptures++;
          for (const name of ['position', 'normal']) { const a = cl.mesh.geometry.attributes[name]; if (!a) continue; a.addUpdateRange(mb.base * 3, mb.count * 3); a.needsUpdate = true; }
        }
        mb.rest = true; m.layers.mainOff = true; cl.dirty = true; live--;
      }
      if (cl.dirty) rebuild(cl);
    }
    stats.live = live;
  };
  update();
  stats.ms = Math.round(performance.now() - t0);
  return {
    stats, clusters, update,
    dispose() {
      for (const cl of clusters) { cl.mesh.removeFromParent(); cl.mesh.geometry.dispose(); }
      for (const { layers, test: t, off } of tests) { if (layers.test === test) layers.test = t; layers.mainOff = off; }   // (room culling may have put its own test there since)
      clusters.length = 0;
    },
  };
}
