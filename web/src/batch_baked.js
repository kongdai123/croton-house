// Runtime merges for the baked walkthrough (main.js, right after applyLightmaps; ?batch2=0 turns them off). batchStatic
// (batch.js) runs in every mode, the bake's export included, so it must keep the meshes the bake names; once the bake is
// applied the walkthrough is free to draw them merged: the lightmap identity stays on the originals, which stay in the
// graph (hidden) for raycasts, as batchStatic's do. What it leaves as separate draws and this merges, per parent (the
// merged mesh is the parent's child, so it moves, hides and culls with it exactly as its members did):
// - multi-material meshes split per material: a book is six faces in three materials, six draws (the living room's
//   window seat alone drew 444 of them, from every garden view through its window);
// - siblings with one material, one set of attributes and the same flags: the pleats of a cellular shade (one group
//   scales them), a toggle's hardware, the parts of a seat or a fit-out that batchStatic kept apart;
// - in a toggled or animated root (blinds, curtains, the garage door, the umbrella, the fire pit) only parts whose own
//   matrix, visibility and geometry never change when it is toggled and animated (posed as stillParts does).
// Never: plants (their per-vertex foliage bake and its slot crossfade are matched mesh by mesh), doors, pieces the
// visitor carries (contact shadows copy them), transparent or mirrored parts, light switches, reflectors, anything with
// its own render callback. Members keep their materials: a mesh drawn with the same material and geometry in the same
// frame draws the same pixels (A/B: cull_check-style frames with ?batch2=0, bake/validate).
import { THREE } from './kit.js';
import { inheritLighting, meshLighting, lightingOf } from './lighting_roles.js';

const noRaycast = () => {};
const PROTO_BEFORE = THREE.Object3D.prototype.onBeforeRender, PROTO_AFTER = THREE.Object3D.prototype.onAfterRender;

function signature(g) {
  if (g.morphAttributes && Object.keys(g.morphAttributes).length) return null;
  if (g.drawRange.count !== Infinity || g.drawRange.start) return null;
  const parts = [];
  for (const [name, a] of Object.entries(g.attributes)) {
    if (a.isInterleavedBufferAttribute || a.isInstancedBufferAttribute) return null;
    if (name === 'foliage' || name === 'foliageNext') return null;   // the foliage bake's units
    parts.push(`${name}:${a.itemSize}:${a.normalized ? 1 : 0}:${a.array.constructor.name}`);
  }
  return parts.sort().join(',');
}
const versionOf = g => { let v = 0; for (const a of Object.values(g.attributes)) v += a.version; return g.uuid + ':' + v + ':' + (g.index?.version ?? -1); };
const localOf = (o, m) => o.matrixAutoUpdate ? m.compose(o.position, o.quaternion, o.scale) : m.copy(o.matrix);

// The meshes of a toggled or animated root that never move against their parent: the toggle flipped and back, the
// animation at a few times, and every mesh's own matrix, visibility, parent and geometry compared. The toggle ends as it
// was and the animation at its rest pose (stillParts in batch.js does the same at load).
export function rigidParts(root) {
  const meshes = []; root.traverse(o => { if (o.isMesh) meshes.push(o); });
  const m = new THREE.Matrix4();
  const snap = () => meshes.map(o => [localOf(o, m).clone(), o.visible, o.parent, versionOf(o.geometry)]);
  const base = snap(), moved = new Set();
  const compare = () => snap().forEach(([l, v, p, g], i) => { const b = base[i]; if (!l.equals(b[0]) || v !== b[1] || p !== b[2] || g !== b[3]) moved.add(meshes[i]); });
  const t = root.userData.toggle, animate = root.userData.animate;
  if (t?.set) { const on = t.on; t.set(!on, true); animate?.(0.5); compare(); t.set(on, true); animate?.(1); compare(); }
  if (animate) { for (const time of [0.7, 2.3, 5.9, 11.3]) { animate(time); compare(); } animate(0); }
  root.updateMatrixWorld(true);
  return new Set(meshes.filter(o => !moved.has(o)));
}

// A mesh this pass may merge (per material when it has several), or null.
function candidate(o) {
  if (o.constructor !== THREE.Mesh || !o.visible || o.userData.batched || o.isReflector || o.children.length) return null;
  if (o.userData.noBatch || o.userData.lightHit || o.userData.lightSwitch || o.userData.batch2) return null;
  if (o.onBeforeRender !== PROTO_BEFORE || o.onAfterRender !== PROTO_AFTER) return null;
  if (o.parent?.name === 'frozen' && o.parent.userData.batch) return null;
  const sig = o.geometry && signature(o.geometry); if (!sig) return null;
  const ms = [].concat(o.material);
  if (!ms.length || ms.some(m => !m || m.transparent || m.foliageBake || lightingOf(m)?.foliage || m.isShaderMaterial)) return null;
  if (Array.isArray(o.material) && !o.geometry.groups.length) return null;
  if (localOf(o, new THREE.Matrix4()).determinant() <= 0) return null;
  return sig;
}
// what the merged mesh must share with its members besides the material
function flagsOf(o) {
  const L = meshLighting(o);
  return [+o.castShadow, +o.receiveShadow, o.renderOrder, +o.frustumCulled, o.layers.mask, o.customDepthMaterial?.uuid ?? '', o.customDistanceMaterial?.uuid ?? '',
    +!!o.userData.noHighlight, L.motion, L.why, L.probeSide, +L.sun.cast, L.sun.track, +L.puddleMirror, +L.fakeShadow, L.zone, L.weather].join('|');
}

// The triangles of `g` drawn with material index set `which` (null: all), as [index array, vertex remap].
function pieceOf(o, which) {
  const g = o.geometry, n = g.attributes.position.count, idx = g.index;
  const ranges = which ? g.groups.filter(gr => which.has(gr.materialIndex)) : [{ start: 0, count: idx ? idx.count : n }];
  const tris = [];
  for (const r of ranges) {
    const end = Math.min(r.start + r.count, idx ? idx.count : n);
    for (let i = r.start; i < end; i++) tris.push(idx ? idx.getX(i) : i);
  }
  return { o, tris };
}

// One geometry from pieces (each: the mesh, its triangles' vertex indices), in the parent's frame.
function mergePieces(pieces) {
  const first = pieces[0].o.geometry, names = Object.keys(first.attributes);
  const remaps = pieces.map(p => { const map = new Map(); for (const v of p.tris) if (!map.has(v)) map.set(v, map.size); return map; });
  const total = remaps.reduce((s, m) => s + m.size, 0), indexCount = pieces.reduce((s, p) => s + p.tris.length, 0);
  const out = new THREE.BufferGeometry(), m = new THREE.Matrix4(), nm = new THREE.Matrix3(), v = new THREE.Vector3();
  for (const name of names) {
    const a = first.attributes[name], size = a.itemSize, arr = new a.array.constructor(total * size);
    let base = 0;
    pieces.forEach((p, k) => {
      const src = p.o.geometry.attributes[name], sa = src.array, map = remaps[k];
      localOf(p.o, m);
      const identity = m.equals(IDENTITY), linear = isTranslation(m);
      if (name === 'normal') nm.getNormalMatrix(m);
      for (const [from, to] of map) {
        const o = (base + to) * size;
        if (identity || (name !== 'position' && name !== 'normal' && name !== 'tangent') || (name !== 'position' && linear)) { for (let c = 0; c < size; c++) arr[o + c] = sa[from * size + c]; continue; }
        v.fromBufferAttribute(src, from);
        if (name === 'position') v.applyMatrix4(m); else if (name === 'normal') v.applyMatrix3(nm).normalize(); else v.transformDirection(m);
        arr[o] = v.x; arr[o + 1] = v.y; arr[o + 2] = v.z; for (let c = 3; c < size; c++) arr[o + c] = sa[from * size + c];
      }
      base += map.size;
    });
    out.setAttribute(name, new THREE.BufferAttribute(arr, size, a.normalized));
  }
  const index = new (total > 65535 ? Uint32Array : Uint16Array)(indexCount);
  let at = 0, base = 0;
  pieces.forEach((p, k) => { const map = remaps[k]; for (const vtx of p.tris) index[at++] = base + map.get(vtx); base += map.size; });
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}
const IDENTITY = new THREE.Matrix4();
const isTranslation = m => { const e = m.elements; return e[0] === 1 && e[1] === 0 && e[2] === 0 && e[4] === 0 && e[5] === 1 && e[6] === 0 && e[8] === 0 && e[9] === 0 && e[10] === 1; };

// roots: the scene parts to look in (houseRoot, layout.root); skip: subtrees left alone (doors, carried pieces, plants);
// moving: toggled and animated roots (posed for their rigid parts). -> { stats, merged, undo }
export function batchBaked({ roots, skip = [], moving = [] }) {
  const t0 = performance.now(), skipSet = new Set(skip), movingSet = new Set(moving);
  const groups = new Map();   // parent -> key -> { material, pieces, multi }
  const stats = { meshes: 0, draws: 0, merged: 0, multi: 0, moving: 0, ms: 0 };   // hidden meshes, the draws they made, merged meshes made
  const add = (parent, key, material, piece, multi) => {
    let byKey = groups.get(parent); if (!byKey) groups.set(parent, byKey = new Map());
    let e = byKey.get(key); if (!e) byKey.set(key, e = { material, pieces: [], sources: new Set(), multi: false });
    e.pieces.push(piece); e.sources.add(piece.o); e.multi ||= multi;
  };
  const visit = (o, rigid) => {
    if (skipSet.has(o)) return;
    if (movingSet.has(o) || o.userData.toggle) { rigid = rigidParts(o); stats.moving++; }
    for (const c of o.children) {
      if (skipSet.has(c)) continue;
      const sig = c.isMesh && (!rigid || rigid.has(c)) ? candidate(c) : null;
      if (sig) {
        const flags = flagsOf(c);
        if (Array.isArray(c.material)) {
          const byMat = new Map(); c.material.forEach((m, i) => { if (!byMat.has(m)) byMat.set(m, new Set()); byMat.get(m).add(i); });
          for (const [m, which] of byMat) if (m.visible !== false) add(c.parent, `${m.uuid}|${sig}|${flags}|multi`, m, pieceOf(c, which), true);
          stats.multi++;
        } else add(c.parent, `${c.material.uuid}|${sig}|${flags}`, c.material, pieceOf(c, null), false);
      }
      if (c.children.length) visit(c, rigid);
    }
  };
  for (const r of roots) if (r) { r.updateMatrixWorld(true); visit(r, null); }
  // merged: every multi-material group (so all of a split mesh's materials draw merged, and it can hide) and every other
  // group of two or more; their sources hide
  const drawsOf = o => Array.isArray(o.material) ? o.geometry.groups.filter(g => o.material[g.materialIndex]?.visible !== false).length : 1;
  // (built first and attached together: a failure leaves the scene as it was)
  const made = [], merged = [], hidden = new Map();
  for (const [parent, byKey] of groups) for (const e of byKey.values()) {
    if (!e.multi && e.pieces.length < 2) continue;
    const mesh = new THREE.Mesh(mergePieces(e.pieces), e.material), src = e.pieces[0].o;
    mesh.castShadow = src.castShadow; mesh.receiveShadow = src.receiveShadow; mesh.renderOrder = src.renderOrder; mesh.frustumCulled = src.frustumCulled;
    mesh.layers.mask = src.layers.mask; mesh.customDepthMaterial = src.customDepthMaterial; mesh.customDistanceMaterial = src.customDistanceMaterial;
    mesh.raycast = noRaycast; mesh.name = 'batch2'; mesh.userData.batch = true; mesh.userData.batch2 = true;
    // a multi-material mesh never took the hover highlight (interact.js tints single materials only): its pieces neither
    if (e.multi || src.userData.noHighlight) mesh.userData.noHighlight = true;
    mesh.matrixAutoUpdate = false;
    made.push([parent, mesh, e.sources]);
  }
  for (const [parent, mesh, sources] of made) {
    inheritLighting(mesh, sources.values().next().value);
    parent.add(mesh); mesh.updateMatrixWorld(true); merged.push(mesh);
    for (const o of sources) if (!hidden.has(o)) { hidden.set(o, { visible: o.visible, batched: o.userData.batched }); stats.meshes++; stats.draws += drawsOf(o); }
  }
  stats.merged = merged.length;
  for (const [o] of hidden) { o.visible = false; o.userData.batched = true; o.userData.batch2Source = true; }
  stats.ms = Math.round(performance.now() - t0);
  return {
    stats, merged,
    undo() {
      for (const mesh of merged) { mesh.removeFromParent(); mesh.geometry.dispose(); }
      for (const [o, s] of hidden) { o.visible = s.visible; o.userData.batched = s.batched; delete o.userData.batch2Source; }
      merged.length = 0; hidden.clear();
    },
  };
}

// The merged meshes' sources (batch.js, hidden for good) moved, per parent, into one hidden group beside them: three's
// render walk visits that group instead of every source (~6900 in a garden view, ~1 ms per frame on a 2.1 GHz Xeon),
// while raycasts, which ignore visibility, still reach them through it (an identity transform: their world matrices
// stay). The runtime merges' own sources stay where they are (the puddle reflection draws them in their place).
export function stowSources(roots) {
  const parents = new Map();
  for (const r of roots) r?.traverse(o => {
    if (!o.userData.batched || o.visible || o.userData.batch2Source || !o.parent || o.parent.userData.stowed) return;
    if (!parents.has(o.parent)) parents.set(o.parent, []);
    parents.get(o.parent).push(o);
  });
  const groups = [];
  for (const [parent, list] of parents) {
    if (list.length < 2) continue;
    const g = new THREE.Group(); g.name = 'merged sources'; g.visible = false; g.userData.stowed = true;
    parent.add(g); g.updateMatrixWorld();
    for (const o of list) g.add(o);   // (Object3D.add takes it from its parent)
    groups.push([parent, g, list]);
  }
  return {
    groups: groups.length, sources: groups.reduce((n, [, , l]) => n + l.length, 0),
    undo() { for (const [parent, g, list] of groups) { for (const o of list) parent.add(o); g.removeFromParent(); } groups.length = 0; },
  };
}
