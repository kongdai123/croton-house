// Modeling kit shared by every furniture module. Units: metres. Y is up. A module's local frame: origin on the
// floor at the piece's footprint centre, +Z is the piece's FRONT (the side a person faces when using it).
// Every helper returns a THREE.Object3D already set to cast/receive shadows.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { M } from './materials.js';
export { M };
export { THREE };

export function shadow(o) { o.traverse?.(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } }); if (o.isMesh) { o.castShadow = o.receiveShadow = true; } return o; }

// Box of size w (x) × h (y) × d (z); `r` rounds every edge. Positioned with its centre at (x,y,z) by default
// unless `bottom: true`, then y is the bottom face (handy for anything standing on something).
export function box(w, h, d, mat, { r = 0, seg = 3, x = 0, y = 0, z = 0, bottom = false, ry = 0, rx = 0, rz = 0 } = {}) {
  const g = r > 0 ? new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(g, mat); m.position.set(x, bottom ? y + h / 2 : y, z); m.rotation.set(rx, ry, rz); return shadow(m);
}
export function cyl(rTop, rBot, h, mat, { seg = 24, x = 0, y = 0, z = 0, bottom = false, rx = 0, ry = 0, rz = 0, open = false } = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open), mat); m.position.set(x, bottom ? y + h / 2 : y, z); m.rotation.set(rx, ry, rz); return shadow(m);
}
export function sphere(r, mat, { seg = 24, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.ceil(seg / 2)), mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); return shadow(m);
}
export function torus(R, r, mat, { seg = 24, tube = 12, arc = Math.PI * 2, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0 } = {}) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(R, r, tube, seg, arc), mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); return shadow(m);
}
// Lathe: profile points as [[radius, height], ...] from bottom to top.
export function lathe(profile, mat, { seg = 32, x = 0, y = 0, z = 0 } = {}) {
  const m = new THREE.Mesh(new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), seg), mat); m.position.set(x, y, z); return shadow(m);
}
// Extrude a 2-D outline (array of [x,y] in metres, drawn in the XY plane) by `depth` along +Z, optional bevel.
export function extrude(outline, depth, mat, { bevel = 0, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, holes = [] } = {}) {
  const s = new THREE.Shape(outline.map(p => new THREE.Vector2(p[0], p[1])));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(p[0], p[1]))));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 24 });
  const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); return shadow(m);
}
// Tube along a path of [x,y,z] points (CatmullRom) – rails, pipes, wire frames, chair rings.
export function tube(points, radius, mat, { seg = 48, radial = 10, closed = false } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), closed, 'catmullrom', 0.2);
  return shadow(new THREE.Mesh(new THREE.TubeGeometry(curve, seg, radius, radial, closed), mat));
}
// Flat plane facing +Z of size w × h (for cards, pictures, screens, leaf cards).
export function plane(w, h, mat, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, double = false } = {}) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); if (double) m.material = m.material.clone(), m.material.side = THREE.DoubleSide; return shadow(m);
}
export function group(...children) { const g = new THREE.Group(); for (const c of children) if (c) g.add(c); return g; }
export function at(obj, x, y, z, ry = 0) { obj.position.set(x, y, z); obj.rotation.y = ry; return obj; }

// Repeat a builder n times along an axis: slats, balusters, drawer pulls.
export function repeat(n, fn) { const g = new THREE.Group(); for (let i = 0; i < n; i++) g.add(fn(i, n)); return g; }
// Four legs at the corners of a w × d footprint; `leg(i)` builds one leg at the origin (its own bottom on y=0).
export function legs(w, d, inset, leg) { const g = new THREE.Group(); [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(([sx, sz], i) => { const l = leg(i); l.position.set(sx * (w / 2 - inset), 0, sz * (d / 2 - inset)); g.add(l); }); return g; }

// --- Soft shapes: cushions/pillows as rounded boxes with slight "puff" scaling, mattresses, throw blankets.
export function cushion(w, h, d, mat, opts = {}) { return box(w, h, d, mat, { r: Math.min(h / 2, 0.06), seg: 4, ...opts }); }
export function pillow(w, h, d, mat, opts = {}) { const p = box(w, h, d, mat, { r: Math.min(h / 2, 0.08), seg: 5, ...opts }); p.scale.set(1, 1, 1); return p; }

// --- Interaction metadata. These attach to the ROOT group a module returns.
// seat: a place a person can sit. local (x, y=seat top height, z), facing = yaw in radians (0 = +Z of the piece).
export function addSeat(root, { x = 0, y = 0.45, z = 0, facing = 0, kind = 'chair', back = 0 } = {}) { (root.userData.seats ??= []).push({ x, y, z, facing, kind, back }); return root; }
// movable: the user can grab and slide it on the floor (chairs, stools, ottomans). mass hints the drag feel.
export function setMovable(root, { mass = 8, radius = 0.3 } = {}) { root.userData.movable = { mass, radius }; return root; }
// collider: axis-aligned footprint box in local space the player cannot walk through; `auto` computes it from geometry.
export function setCollider(root, { w, d, x = 0, z = 0, h = 1 } = {}) { root.userData.collider = { w, d, x, z, h }; return root; }
export function autoCollider(root, shrink = 0.02) { root.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(root); const inv = root.matrixWorld.clone().invert(); b.applyMatrix4(inv); root.userData.collider = { w: Math.max(0.05, b.max.x - b.min.x - shrink * 2), d: Math.max(0.05, b.max.z - b.min.z - shrink * 2), x: (b.max.x + b.min.x) / 2, z: (b.max.z + b.min.z) / 2, h: b.max.y }; return root; }
export function describe(root, { id, name, zh, note } = {}) { Object.assign(root.userData, { id, name, zh, note }); root.name = id || name || root.name; return root; }

// Bounding size helper for self-checks in a module's test (metres).
export function sizeOf(obj) { obj.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(obj); const s = new THREE.Vector3(); b.getSize(s); return { w: +s.x.toFixed(3), h: +s.y.toFixed(3), d: +s.z.toFixed(3), minY: +b.min.y.toFixed(3) }; }
