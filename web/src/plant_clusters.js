// Far plants, drawn per material and cell (baked walkthrough, main.js; ?plantmerge=0 turns it off). Beyond SWAY_R a
// plant shows its frozen copy (batch.js: its parts merged per material, one draw each), which left a garden view with
// ~200 frozen draws of 42 materials. Here the frozen copies of every plant in a CELL x CELL m square are merged once more
// per material into one mesh, which the walkthrough camera draws instead of them: its index lists the plants that show
// their frozen copy now (far, and shown), and is rewritten when one comes near or goes far again (update(), per frame).
// Only the walkthrough camera's draw changes: the frozen copies stay as they were for every other view (the sun's
// shadow maps, the puddle reflection, the mirrors, photo mode), refused only to that camera (layers.mainOff), and the
// merged meshes are drawn by that camera alone (layers.mainOnly; visibility.js honours both). The per-vertex foliage
// bake follows: the frozen copies' foliage attributes become views into the merged mesh's arrays, so the slot
// crossfade (foliage_bake.js stage) writes both, and a write to theirs marks the merged one for upload too.
import { THREE } from './kit.js';
import { inheritLighting } from './lighting_roles.js';

const CELL = 16;
const noRaycast = () => {};
const PROTO_BEFORE = THREE.Object3D.prototype.onBeforeRender;
const signature = g => {
  if (g.morphAttributes && Object.keys(g.morphAttributes).length) return null;
  if (g.drawRange.count !== Infinity || g.drawRange.start) return null;
  const parts = [];
  for (const [name, a] of Object.entries(g.attributes)) { if (a.isInterleavedBufferAttribute) return null; parts.push(`${name}:${a.itemSize}:${+a.normalized}:${a.array.constructor.name}`); }
  return parts.sort().join(',');
};
// the walkthrough camera's layers decide: a frozen copy it must not draw, a merged mesh only it draws
export function mainLayersTest(main) {
  return function (layers) { return (this.mask & layers.mask) !== 0 && (this.mainOnly === true ? layers === main : !(this.mainOff === true && layers === main)); };
}
const shownChain = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };

// lod: batch.js stats.lod ({ root, frozen, parts }); camera: the walkthrough camera; parent: where the merged meshes go
export function createPlantClusters({ lod, camera, parent }) {
  const t0 = performance.now(), test = mainLayersTest(camera.layers), groups = new Map();
  const c = new THREE.Vector3(), nm = new THREE.Matrix3(), v = new THREE.Vector3();
  for (const e of lod) {
    e.root.updateMatrixWorld(true);
    if (e.root.matrixWorld.determinant() <= 0) continue;
    for (const m of e.frozen.children) {
      if (!m.isMesh || Array.isArray(m.material) || m.material.transparent || m.onBeforeRender !== PROTO_BEFORE || m.children.length) continue;
      const sig = signature(m.geometry); if (!sig) continue;
      c.setFromMatrixPosition(e.root.matrixWorld);
      const key = `${m.material.uuid}|${sig}|${+!!m.geometry.index}|${+m.receiveShadow}|${m.renderOrder}|${+m.frustumCulled}|${m.layers.mask}|${Math.floor(c.x / CELL)},${Math.floor(c.z / CELL)}`;
      let g = groups.get(key); if (!g) groups.set(key, g = { material: m.material, members: [] });
      g.members.push({ e, mesh: m });
    }
  }
  const clusters = [];
  for (const g of groups.values()) {
    if (g.members.length < 2) continue;
    const first = g.members[0].mesh.geometry, names = Object.keys(first.attributes);
    let vertices = 0, indices = 0;
    for (const { mesh } of g.members) { vertices += mesh.geometry.attributes.position.count; indices += mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count; }
    const geometry = new THREE.BufferGeometry(), arrays = {};
    for (const name of names) { const a = first.attributes[name]; arrays[name] = new a.array.constructor(vertices * a.itemSize); }
    const segments = [];
    let base = 0;
    for (const { mesh } of g.members) {
      const src = mesh.geometry, n = src.attributes.position.count, w = mesh.matrixWorld;
      nm.getNormalMatrix(w);
      for (const name of names) {
        const a = src.attributes[name], size = a.itemSize, out = arrays[name];
        if (name === 'position' || name === 'normal') {
          for (let i = 0; i < n; i++) {
            v.fromBufferAttribute(a, i); if (name === 'position') v.applyMatrix4(w); else v.applyMatrix3(nm).normalize();
            out[(base + i) * 3] = v.x; out[(base + i) * 3 + 1] = v.y; out[(base + i) * 3 + 2] = v.z;
          }
        } else out.set(a.array.subarray(0, n * size), base * size);
      }
      const idx = src.index, seg = new Uint32Array(idx ? idx.count : n);
      for (let i = 0; i < seg.length; i++) seg[i] = base + (idx ? idx.getX(i) : i);
      segments.push(seg); base += n;
    }
    for (const name of names) { const a = first.attributes[name]; geometry.setAttribute(name, new THREE.BufferAttribute(arrays[name], a.itemSize, a.normalized)); }
    const index = new THREE.BufferAttribute(new (vertices > 65535 ? Uint32Array : Uint16Array)(indices), 1);
    geometry.setIndex(index); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const src = g.members[0].mesh, mesh = new THREE.Mesh(geometry, g.material);
    mesh.castShadow = false; mesh.receiveShadow = src.receiveShadow; mesh.renderOrder = src.renderOrder; mesh.frustumCulled = src.frustumCulled;
    mesh.layers.mask = src.layers.mask; mesh.layers.mainOnly = true; mesh.layers.test = test;
    mesh.raycast = noRaycast; mesh.name = 'plantCluster'; mesh.userData.batch = true; mesh.userData.mainOnly = true; mesh.matrixAutoUpdate = false;
    inheritLighting(mesh, src);
    clusters.push({ mesh, members: g.members, segments, state: new Uint8Array(g.members.length).fill(2) });
  }
  // attach: the frozen copies' foliage attributes as views into the merged arrays, the layer tests
  const views = [], tests = [];
  for (const cl of clusters) {
    let base = 0;
    for (const { mesh } of cl.members) {
      const n = mesh.geometry.attributes.position.count;
      for (const name of ['foliage', 'foliageNext']) {
        const a = mesh.geometry.attributes[name], merged = cl.mesh.geometry.attributes[name]; if (!a || !merged) continue;
        const view = merged.array.subarray(base * a.itemSize, (base + n) * a.itemSize);
        views.push({ a, array: a.array });
        a.array = view;
        Object.defineProperty(a, 'needsUpdate', { configurable: true, set(value) { if (value === true) { a.version++; merged.version++; } } });
      }
      tests.push({ layers: mesh.layers, test: mesh.layers.test, off: mesh.layers.mainOff });
      mesh.layers.mainOff = true; if (mesh.layers.test === THREE.Layers.prototype.test) mesh.layers.test = test;
      base += n;
    }
    parent.add(cl.mesh); cl.mesh.updateMatrixWorld(true);
  }
  // the members that show their frozen copy now: far (batch.js updateSwayLod) and shown (room fit-outs hide theirs)
  const update = () => {
    for (const cl of clusters) {
      let changed = false;
      for (let i = 0; i < cl.members.length; i++) { const s = shownChain(cl.members[i].e.frozen) ? 1 : 0; if (s !== cl.state[i]) { cl.state[i] = s; changed = true; } }
      if (!changed) continue;
      const index = cl.mesh.geometry.index, out = index.array; let at = 0;
      for (let i = 0; i < cl.members.length; i++) if (cl.state[i]) { out.set(cl.segments[i], at); at += cl.segments[i].length; }
      cl.mesh.geometry.setDrawRange(0, at); cl.mesh.visible = at > 0;
      index.clearUpdateRanges?.(); if (at) index.addUpdateRange(0, at); index.needsUpdate = true;
    }
  };
  update();
  const stats = { clusters: clusters.length, members: clusters.reduce((n, cl) => n + cl.members.length, 0), vertices: clusters.reduce((n, cl) => n + cl.mesh.geometry.attributes.position.count, 0), ms: Math.round(performance.now() - t0) };
  return {
    stats, clusters, update,
    dispose() {
      for (const cl of clusters) { cl.mesh.removeFromParent(); cl.mesh.geometry.dispose(); }
      for (const { a, array } of views) { delete a.needsUpdate; array.set(a.array); a.array = array; a.needsUpdate = true; }
      for (const { layers, test: t, off } of tests) { if (layers.test === test) layers.test = t; layers.mainOff = off; }   // (room culling may have put its own test there since)
      clusters.length = 0;
    },
  };
}
