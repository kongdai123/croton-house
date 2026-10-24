// Draw-call reduction. After the scene is built, leaf meshes are merged per material so the scene draws a few hundred meshes
// instead of thousands:
// - world-static geometry into 8 m cells (frustum culling still works);
// - each interactive root (seats, movables) under itself, so it still moves and highlights as one piece;
// - each animated root (swaying plants, curtains) gets a frozen merged copy shown beyond SWAY_R, where it stops animating;
//   up close the original animated meshes are shown.
// - door subtrees (`skip`) merge siblings under the group that swings or slides them.
// Originals stay in the graph (hidden), so raycasts still hit the real objects; merged meshes never take raycasts.
// Roots flagged userData.noBatch and roots with userData.toggle (parts move on click) are left alone.
// Static subtrees stop recomposing their matrices every frame, and far plants skip the matrix walk entirely: anything that
// moves must be a door, an anchor, an animated root or a toggle (or be added to the scene after batching).
// Lightmap identity (baked mode, lightmap.js): every mesh that holds still gets userData.lmId, a hash of its vertex count
// and world-space vertices, so the bake's export and a later session name a mesh the same way whatever the scene order; a
// merged mesh hashes its parts' ids. What holds still is the lighting manifest's motion (lighting_roles.js): meshes of
// pieces the visitor carries (motion 'movable') get userData.lmSkip = 'movable'; in animated and toggled subtrees only
// the parts that never move (motion 'still', found by stillParts below: a plant's pot, the fire pit's bowl, the
// umbrella's base, a shade's head rail, the garage door's tracks) get an id; what moves gets none and takes the probe
// volume.
import { THREE } from './kit.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { classifyLighting, inheritLighting, isResolved, meshLighting } from './lighting_roles.js';

const CELL = 8, SWAY_R = 10;
const noRaycast = () => {};
const UMW = THREE.Object3D.prototype.updateMatrixWorld;
function staticUMW(force) { if (force || this.matrixWorldNeedsUpdate) UMW.call(this, force); }
function swayUMW(force) { if (force || this.matrixWorldNeedsUpdate || !this.userData.swayFar) UMW.call(this, force); }

function signature(g) {
  if (g.morphAttributes && Object.keys(g.morphAttributes).length) return null;
  if (g.drawRange.count !== Infinity || g.drawRange.start) return null;
  const parts = [];
  for (const [name, a] of Object.entries(g.attributes)) {
    if (a.isInterleavedBufferAttribute) return null;
    parts.push(`${name}:${a.itemSize}:${a.normalized ? 1 : 0}:${a.array.constructor.name}`);
  }
  return parts.sort().join(',') + (g.index ? '|i' : '|n');
}
// millimetre grid (far coarser than float noise between browsers), up to 64 vertices sampled evenly
const fnv = (h, q) => Math.imul(h ^ q, 16777619), mur = (h, q) => { h = Math.imul(h ^ q, 0x5bd1e995); return h ^ (h >>> 13); };
const hex = (a, b) => (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
export function meshId(o) {
  const p = o.geometry.attributes.position, e = o.matrixWorld.elements, n = p.count, step = Math.max(1, Math.floor(n / 64));
  let a = fnv(0x811c9dc5, n), b = mur(0x9e3779b9, o.geometry.index ? o.geometry.index.count : n);
  for (let i = 0; i < n; i += step) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    for (let k = 0; k < 3; k++) { const q = Math.round((e[k] * x + e[k + 4] * y + e[k + 8] * z + e[k + 12]) * 1000); a = fnv(a, q); b = mur(b, q); }
  }
  return hex(a, b);
}
const strId = s => { let a = 0x811c9dc5, b = 0x9e3779b9; for (let i = 0; i < s.length; i++) { a = fnv(a, s.charCodeAt(i)); b = mur(b, s.charCodeAt(i)); } return hex(a, b); };
const lmMesh = o => o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && o.geometry?.attributes.position;

const versionOf = g => { let v = 0; for (const a of Object.values(g.attributes)) v += a.version; return g.uuid + ':' + v; };
const shownIn = (o, root) => { for (let p = o; p && p !== root.parent; p = p.parent) if (!p.visible) return false; return true; };
// The meshes of an animated or toggled root that hold still: pose it (the toggle flipped and back, the animation at a few
// times) and keep the meshes whose world matrix, visibility and vertex data never change. The toggle ends as it was.
export function stillParts(root) {
  const meshes = []; root.traverse(o => { if (lmMesh(o)) meshes.push(o); });
  if (!meshes.length) return [];
  const snap = () => { root.updateMatrixWorld(true); return meshes.map(o => [o.matrixWorld.clone(), shownIn(o, root), versionOf(o.geometry)]); };
  const base = snap(), moved = new Set();
  const compare = () => snap().forEach(([m, v, g], i) => { const b = base[i]; if (!m.equals(b[0]) || v !== b[1] || g !== b[2]) moved.add(meshes[i]); });
  const t = root.userData.toggle, animate = root.userData.animate;
  if (t?.set) { const on = t.on; t.set(!on, true); animate?.(0.5); compare(); t.set(on, true); animate?.(1); compare(); }
  if (animate) { for (const time of [0.7, 2.3, 5.9, 11.3]) { animate(time); compare(); } animate(0); }
  root.updateMatrixWorld(true);
  return meshes.filter(o => !moved.has(o));
}

const mergeable = (o) => o.constructor === THREE.Mesh && !o.children.length && o.visible && o.material && !Array.isArray(o.material)
  && !o.material.transparent && o.matrixWorld.determinant() > 0 && signature(o.geometry);

// Merge `list` (same material and attributes) into one mesh in `space`'s local frame (world if null).
function merge(list, space) {
  const inv = space ? new THREE.Matrix4().copy(space.matrixWorld).invert() : null, rel = new THREE.Matrix4();
  const geos = list.map(o => o.geometry.clone().applyMatrix4(inv ? rel.multiplyMatrices(inv, o.matrixWorld) : o.matrixWorld));
  const g = mergeGeometries(geos, false); geos.forEach(x => x.dispose());
  if (!g) return null;
  const src = list[0], mesh = new THREE.Mesh(g, src.material);
  mesh.castShadow = src.castShadow; mesh.receiveShadow = src.receiveShadow; mesh.renderOrder = src.renderOrder; mesh.frustumCulled = src.frustumCulled;
  if (src.onBeforeRender !== THREE.Mesh.prototype.onBeforeRender) mesh.onBeforeRender = src.onBeforeRender;
  mesh.raycast = noRaycast; mesh.name = 'batch'; mesh.userData.batch = true;
  inheritLighting(mesh, src);   // the members' manifest record (lighting_roles.js)
  return mesh;
}
function keyOf(o, cbIds) {
  let k = `${o.material.uuid}|${signature(o.geometry)}|${+o.castShadow}${+o.receiveShadow}|${o.renderOrder}|${o.frustumCulled}`;
  const cb = o.onBeforeRender; if (cb !== THREE.Mesh.prototype.onBeforeRender) { if (!cbIds.has(cb)) cbIds.set(cb, cbIds.size); k += '|cb' + cbIds.get(cb); }
  return k;
}

export function batchStatic(roots, { skip = [], anchors = [], animated = [] } = {}) {
  const skipSet = new Set(skip), anchorSet = new Set(anchors), animSet = new Set(animated);
  for (const r of roots) r.updateMatrixWorld(true);
  const cbIds = new Map(), c = new THREE.Vector3(), stats = { before: 0, after: 0 };
  // identical meshes in the same place (rare) are told apart by their order: .1, .2
  const seen = new Map(), tag = (o, id) => { const k = seen.get(id) ?? 0; seen.set(id, k + 1); o.userData.lmId = k ? `${id}.${k}` : id; };
  const label = o => { if (!lmMesh(o)) return; if (meshLighting(o).motion === 'movable') o.userData.lmSkip = 'movable'; else tag(o, meshId(o)); };
  // a moving root classified before its last meshes were added (a light switch's hit proxy) is classified again here
  const classified = root => { let all = true; root.traverse(x => { if (x.isMesh && !isResolved(x)) all = false; }); return all; };

  // world-static, interactive roots and doors; returns whether the whole subtree is static
  const groups = new Map(), rooms = new Map();
  const visit = (o, anchor, door, room) => {
    if (!o.visible) return false;
    if (animSet.has(o) || o.userData.toggle) {
      if (!classified(o)) classifyLighting(o, { stillParts, force: true });
      o.traverse(m => { if (lmMesh(m) && meshLighting(m).motion === 'still') label(m); });
      return false;
    }
    if (o.userData.noBatch) { o.traverse(label); return false; }
    if (o.userData.viewRoom) {
      const bounds = o.userData.viewRoom;
      if (!rooms.has(bounds.key)) { const group = new THREE.Group(); group.name = bounds.key; rooms.set(bounds.key, { bounds, group, roots: [] }); }
      room = rooms.get(bounds.key); room.roots.push(o);
    }
    if (skipSet.has(o)) door = true;
    if (anchorSet.has(o)) anchor = o;
    label(o);
    if (mergeable(o)) {
      const space = door ? o.parent : anchor;
      let key = (door ? 'p' + space.id : anchor ? anchor.id : 'w') + '|' + keyOf(o, cbIds);
      if (room) key += '|room:' + room.bounds.key;
      if (!space) { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); o.geometry.boundingBox.getCenter(c).applyMatrix4(o.matrixWorld); key += `|${Math.floor(c.x / CELL)},${Math.floor(c.z / CELL)}`; }
      let e = groups.get(key); if (!e) groups.set(key, e = { space, room, list: [] });
      e.list.push(o);
    }
    const fixed = !anchor && !door;
    let still = fixed;
    for (const ch of o.children) still = visit(ch, anchor, door, room) && still;
    if (fixed) o.matrixAutoUpdate = false;
    if (still) o.updateMatrixWorld = staticUMW;
    return still;
  };
  for (const r of roots) visit(r, null, false, null);
  const world = new THREE.Group(); world.name = 'batched';
  for (const room of rooms.values()) world.add(room.group);
  for (const { space, room, list } of groups.values()) {
    if (list.length < 2) continue;
    const mesh = merge(list, space); if (!mesh) continue;
    if (list[0].userData.lmSkip) mesh.userData.lmSkip = list[0].userData.lmSkip; else tag(mesh, strId(list.map(o => o.userData.lmId).join()));
    (space ?? room?.group ?? world).add(mesh);
    for (const o of list) { o.visible = false; o.userData.batched = true; }
    stats.before += list.length; stats.after++;
  }
  const scene = roots[0].parent;
  if (scene) {
    scene.add(world); scene.updateMatrixWorld(true);
    world.traverse(o => { o.matrixAutoUpdate = false; o.updateMatrixWorld = staticUMW; });
    scene.matrixAutoUpdate = false;
  }

  // animated roots: frozen far copy
  const lod = [];
  for (const root of animated) {
    if (root.userData.noBatch || root.userData.toggle) continue;
    root.userData.animate(0); root.updateMatrixWorld(true);
    const by = new Map(), parts = [];
    root.traverse(o => { if (o !== root && mergeable(o) && !o.userData.lmId) { const k = keyOf(o, cbIds); if (!by.has(k)) by.set(k, []); by.get(k).push(o); parts.push(o); } });
    if (parts.length < 2) continue;
    const frozen = new THREE.Group(); frozen.name = 'frozen'; frozen.visible = false; frozen.userData.batch = true;
    for (const list of by.values()) { const m = merge(list, root); if (m) frozen.add(m); }
    root.add(frozen);
    if (!anchorSet.has(root)) root.updateMatrixWorld = swayUMW;
    lod.push({ root, frozen, parts, far: false });
    stats.before += parts.length; stats.after += frozen.children.length;
  }
  stats.lod = lod; stats.lmIds = seen.size;
  stats.rooms = [...rooms.values()];
  stats.world = world;   // the world-static merged meshes (room culling registers them, visibility.js)
  return stats;
}

// Small enclosed fit-outs should not draw through walls from the garden or other rooms.
export function updateRoomVisibility(rooms, p) {
  for (const { bounds: b, group, roots } of rooms ?? []) {
    const visible = p.x >= b.x0 && p.x <= b.x1 && p.z >= b.z0 && p.z <= b.z1;
    group.visible = visible; for (const root of roots) root.visible = visible;
  }
}

// Per frame: plants beyond SWAY_R show their frozen copy and stop animating (layout.animate skips userData.swayFar roots).
const wp = new THREE.Vector3();
export function updateSwayLod(lod, camPos) {
  for (const e of lod) {
    wp.setFromMatrixPosition(e.root.matrixWorld);   // getWorldPosition would recompose and flag the whole plant dirty
    const d = Math.hypot(wp.x - camPos.x, wp.z - camPos.z);
    const far = e.far ? d > SWAY_R - 1 : d > SWAY_R + 1;
    if (far === e.far) continue;
    e.far = far; e.root.userData.swayFar = far;
    if (far) e.root.userData.animate(0);
    e.frozen.visible = far;
    for (const o of e.parts) o.visible = !far;
    if (far) e.root.updateMatrixWorld(true);
  }
}
