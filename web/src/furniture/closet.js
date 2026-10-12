// Front bedroom closet. Local +Z faces the room; static cloth and hardware share materials for batching.
import { THREE, M, box, cyl, sphere, torus, lathe, tube, group, shadow, describe, autoCollider } from '../kit.js';
import { FRONT_CLOSET_VIEW } from '../house.js';
const PI = Math.PI, once = fn => { let v; return () => v ??= fn(); };
const textile = once(() => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'); g.fillStyle = '#bbb9b3'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 256; i += 2) {
    g.fillStyle = i % 6 ? '#dedbd4' : '#aaa79f'; g.fillRect(i, 0, 1, 256);
    g.fillStyle = i % 4 ? '#c8c6bd' : '#a8a69e'; g.fillRect(0, i, 256, 1);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(5, 7); t.anisotropy = 4; return t;
});
const fabrics = once(() => [0xe8dfcd, 0x879786, 0x9dabb4, 0x4c667d, 0xb28b77, 0xc7b88d, 0x767b68].map((color, i) => {
  const m = M.linen().clone(); m.color.set(color); m.bumpMap = textile(); m.bumpScale = i === 6 ? 0.0022 : 0.0008;
  m.roughnessMap = textile(); m.roughness = i === 5 ? 0.7 : 0.94; m.side = THREE.DoubleSide; return m;
}));
function finish(root, id, name, zh) {
  root.userData.viewRoom = FRONT_CLOSET_VIEW;
  // A single attribute layout lets soft surfaces, hems, buttons and solids merge per material.
  root.traverse(o => { if (o.isMesh && o.geometry.index) { const old = o.geometry; o.geometry = old.toNonIndexed(); old.dispose(); } });
  return describe(root, { id: 'front-closet-' + id, name, zh });
}
const put = (root, obj, x, y, z, ry = 0) => { obj.position.set(x, y, z); obj.rotation.y = ry; root.add(obj); return obj; };
function surface(nu, nv, fn, mat) {
  const p = [], uv = [], ix = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { p.push(...fn(i / nu, j / nv)); uv.push(i / nu, j / nv); }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + nu + 1; ix.push(a, b, a + 1, a + 1, b, b + 1); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(ix); geo.computeVertexNormals();
  return shadow(new THREE.Mesh(geo, mat));
}
function hanger(root) {
  root.add(tube([[0, -0.05, 0], [0, -0.018, 0], [0.008, 0.008, 0], [0.022, 0.013, 0], [0.025, -0.008, 0]], 0.0025, M.steel(), { seg: 14, radial: 6 }));
  root.add(tube([[-0.205, -0.158, 0], [-0.16, -0.137, 0], [-0.075, -0.082, 0], [0, -0.063, 0], [0.075, -0.082, 0], [0.16, -0.137, 0], [0.205, -0.158, 0]], 0.008, M.oak(), { seg: 20, radial: 6 }));
  root.add(tube([[-0.205, -0.158, 0], [0, -0.168, 0], [0.205, -0.158, 0]], 0.005, M.oak(), { seg: 8, radial: 6 }));
}
// Closed front/back panels have softly puffed chests, gravity folds, curved shoulders and irregular hems.
function garment(kind, color, seed) {
  const root = new THREE.Group(), mat = fabrics()[color], dress = kind === 'dress', coat = kind === 'coat';
  const knit = kind === 'cardigan', jacket = kind === 'jacket', length = dress ? 1.19 : coat ? 1.04 : jacket ? 0.63 : 0.66 + seed % 3 * 0.045;
  const w = 0.37 + seed % 4 * 0.021; hanger(root);
  const at = (u, t, face) => {
    const a = u * 2 - 1, width = w * (dress ? 0.78 + 0.43 * t : 1 - 0.08 * Math.sin(t * PI));
    const shoulder = -0.095 - 0.058 * Math.pow(Math.abs(a), 0.8) - 0.060 * Math.exp(-a * a * 35);
    const y = shoulder - (length - 0.08) * t + 0.008 * Math.sin(a * 9 + seed) * t * t;
    const fold = (0.012 * Math.sin(a * 16 + seed + t * 1.3) + 0.007 * Math.sin(a * 29 - t * 4)) * (0.25 + t * 0.75);
    return [a * width / 2 + 0.007 * Math.sin(t * 8 + seed) * t, y,
      face * (0.013 + 0.026 * Math.pow(Math.max(0, 1 - a * a), 0.6) * Math.sin(PI * (0.12 + 0.7 * t)) + fold)];
  };
  for (const s of [-1, 1]) root.add(surface(24, 32, (u, t) => at(u, t, s), mat));
  for (const [lo, hi] of [[0, 0.38], [0.62, 1]]) root.add(surface(12, 3, (u, v) => {
    const a = at(lo + u * (hi - lo), 0, -1), b = at(lo + u * (hi - lo), 0, 1);
    return [a[0], a[1] + 0.004 * Math.sin(v * PI), a[2] * (1 - v) + b[2] * v];
  }, mat));
  for (const u of [0, 1]) root.add(surface(2, 32, (v, t) => { const a = at(u, t, -1), b = at(u, t, 1); return [a[0], a[1], a[2] * (1 - v) + b[2] * v]; }, mat));
  root.add(surface(24, 2, (u, v) => { const a = at(u, 1, -1), b = at(u, 1, 1); return [a[0], a[1], a[2] * (1 - v) + b[2] * v]; }, mat));
  for (const s of [-1, 1]) {
    const sleeveLen = dress ? 0.12 : coat || knit ? 0.48 : jacket ? 0.43 : 0.21;
    root.add(surface(18, 18, (u, t) => { const a = u * 2 * PI, rad = (0.069 - t * 0.028) * (1 + 0.04 * Math.sin(t * 18 + seed));
      return [s * (w / 2 - 0.02 + 0.095 * Math.sin(t * PI / 2)) + Math.cos(a) * rad,
        -0.19 - t * sleeveLen + 0.003 * Math.sin(a * 3 + t * 7), Math.sin(a) * rad * 0.67]; }, mat));
    root.add(surface(18, 6, (u, t) => { const a = u * 2 * PI, rad = 0.069 * t;
      return [s * (w / 2 - 0.02) + Math.cos(a) * rad, -0.19 + 0.045 * (1 - t * t) + 0.003 * Math.sin(a * 3) * t, Math.sin(a) * rad * 0.67]; }, mat));
    root.add(tube([[s * 0.058, -0.155, 0.044], [s * 0.077, -0.192, 0.045], [s * 0.038, -0.225, 0.046]], 0.013, mat, { seg: 9, radial: 4 }));
    const hem = []; for (let j = 0; j <= 20; j++) { const p = at(j / 20, 0.992, s); p[2] += s * 0.001; hem.push(p); }
    root.add(tube(hem, 0.0014, mat, { seg: 24, radial: 4 }));
  }
  if (!dress) {
    root.add(tube([[0, -0.21, 0.047], [0.007, -0.37, 0.052], [0.004, -length + 0.02, 0.028]], 0.0025, mat, { seg: 18, radial: 4 }));
    for (let j = 0; j < (coat ? 5 : 4); j++) root.add(sphere(0.004, M.oak(), { x: 0.005, y: -0.27 - j * 0.115, z: 0.054, seg: 8, sz: 0.45 }));
  }
  if (jacket || coat) for (const s of [-1, 1]) root.add(surface(8, 8, (u, v) => [s * 0.10 + (u - 0.5) * 0.10, -0.31 - v * 0.105, 0.052 + 0.005 * Math.sin(u * PI) * Math.sin(v * PI)], mat));
  return root;
}
function hanging() {
  const root = new THREE.Group();
  for (let i = 0; i < 18; i++) {
    const kind = i === 5 || i === 14 ? 'dress' : i === 9 ? 'jacket' : i === 12 ? 'coat' : i === 3 || i === 16 ? 'cardigan' : 'shirt';
    const color = kind === 'jacket' ? 3 : kind === 'coat' ? 5 : kind === 'cardigan' ? 6 : i % 5;
    put(root, garment(kind, color, i + 11), -1.14 + i * 0.134, 1.70, 0.027 + 0.01 * Math.sin(i * 3), PI / 2 - 0.18 + 0.16 * Math.sin(i * 2.7));
  }
  return finish(root, 'clothes', 'Guest wardrobe on wooden hangers', '木衣架上的客房衣物');
}
function fitout() {
  const root = group(box(2.78, 0.024, 0.46, M.trim(), { y: 1.78, z: 0.062, r: 0.004, seg: 1 }),
    cyl(0.013, 0.013, 2.74, M.steel(), { y: 1.70, z: 0.027, rz: PI / 2, seg: 16 }));
  for (const x of [-1.365, 0, 1.365]) {
    root.add(box(0.025, 0.035, 0.43, M.trim(), { x, y: 1.744, z: 0.045 }));
    root.add(tube([[x, 1.748, -0.145], [x, 1.55, -0.145], [x, 1.748, 0.22]], 0.006, M.trim(), { seg: 8, radial: 5 }));
  }
  // White liners on the three cavity faces. Existing ceiling already uses M.ceiling().
  root.add(box(2.80, 2.44, 0.004, M.wallPaint(), { y: 1.22, z: -0.309 }),
    box(0.004, 2.44, 0.63, M.wallPaint(), { x: -1.407, y: 1.22, z: 0.009 }),
    box(0.004, 2.44, 0.63, M.wallPaint(), { x: 1.403, y: 1.22, z: 0.009 }));
  return finish(root, 'shelf-rod', 'White closet shelf and chrome rail', '白色壁橱搁板与镀铬挂杆');
}
function fold(root, x, y, z, color, w = 0.30) {
  const mat = fabrics()[color], h = 0.046;
  const m = box(w, h, 0.27, mat, { x, y: y + h / 2, z, r: 0.018, seg: 3 });
  const p = m.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) { const a = p.getX(i), b = p.getZ(i); p.setY(i, p.getY(i) + 0.003 * Math.sin(a * 49 + color) * Math.cos(b * 23)); }
  m.geometry.computeVertexNormals(); root.add(m);
  root.add(tube([[x - w / 2 + 0.025, y + 0.015, z + 0.137], [x, y + 0.010, z + 0.139], [x + w / 2 - 0.025, y + 0.016, z + 0.137]], 0.0018, mat, { seg: 16, radial: 4 }));
}
function basket(w = 0.37, d = 0.29, h = 0.24) {
  const root = new THREE.Group(), mat = M.wicker();
  for (const s of [-1, 1]) {
    root.add(box(w, h, 0.015, mat, { y: h / 2, z: s * (d / 2 - 0.007), r: 0.006, seg: 2 }),
      box(0.015, h, d - 0.025, mat, { x: s * (w / 2 - 0.007), y: h / 2, r: 0.006, seg: 2 }));
    root.add(tube([[-w / 2, h, s * d / 2], [0, h + 0.003, s * d / 2], [w / 2, h, s * d / 2]], 0.008, mat, { seg: 12, radial: 6 }));
  }
  root.add(box(w - 0.024, 0.015, d - 0.024, mat, { y: 0.01 }));
  root.add(tube([[-0.042, h * 0.7, d / 2 + 0.009], [-0.03, h * 0.84, d / 2 + 0.012], [0.03, h * 0.84, d / 2 + 0.012], [0.042, h * 0.7, d / 2 + 0.009]], 0.008, mat, { seg: 12, radial: 6 }));
  return root;
}
function shelf() {
  const root = new THREE.Group();
  for (const [x, n, col] of [[-0.84, 3, 6], [-0.49, 4, 0], [0.28, 3, 2]]) for (let j = 0; j < n; j++) fold(root, x + 0.008 * Math.sin(j * 4), j * 0.048, 0.05, col);
  for (const x of [-1.18, 0.68]) { const b = put(root, basket(0.32, 0.29, 0.23), x, 0.002, 0.05); fold(b, 0, 0.14, 0, 0, 0.24); }
  root.add(box(0.35, 0.24, 0.29, fabrics()[1], { x: 1.10, y: 0.12, z: 0.05, r: 0.015, seg: 3 }),
    box(0.37, 0.034, 0.31, fabrics()[1], { x: 1.10, y: 0.252, z: 0.05, r: 0.01, seg: 2 }),
    box(0.071, 0.03, 0.002, M.trim(), { x: 1.10, y: 0.16, z: 0.197 }));
  const hat = group(lathe([[0, 0], [0.075, 0], [0.087, 0.015], [0.088, 0.048], [0.074, 0.09], [0.04, 0.105], [0, 0.11]], M.wicker(), { seg: 32 }),
    cyl(0.15, 0.15, 0.009, M.wicker(), { y: 0.004, seg: 40 }), torus(0.087, 0.005, fabrics()[4], { y: 0.025, rx: PI / 2, seg: 32, tube: 6 }));
  put(root, hat, -0.08, 0.003, 0.08);
  return finish(root, 'shelf-storage', 'Folded sweaters, towels and woven storage', '折叠毛衣、毛巾与编织收纳篮');
}
function hamper() {
  const root = new THREE.Group(), mat = fabrics()[0];
  root.add(surface(40, 24, (u, t) => { const a = u * PI * 2, r = 0.175 + 0.025 * t + 0.006 * Math.sin(a * 7 + t * 3);
    return [Math.cos(a) * r, t * 0.48 + 0.007 * t * Math.sin(a * 3), Math.sin(a) * r * 0.77]; }, mat));
  root.add(cyl(0.17, 0.17, 0.015, mat, { y: 0.013, seg: 32 }),
    torus(0.193, 0.008, mat, { y: 0.48, rx: PI / 2, seg: 40, tube: 6 }));
  root.children.at(-1).scale.y = 0.77;
  for (const s of [-1, 1]) root.add(tube([[s * 0.186, 0.40, -0.048], [s * 0.213, 0.52, 0], [s * 0.186, 0.40, 0.048]], 0.012, mat, { seg: 16, radial: 6 }));
  fold(root, 0.01, 0.34, 0, 2, 0.26); autoCollider(root, 0);
  return finish(root, 'hamper', 'Canvas laundry hamper', '帆布洗衣篮');
}
function shoes() {
  const root = new THREE.Group();
  for (let k = 0; k < 4; k++) for (const s of [-1, 1]) {
    const shoe = new THREE.Group(), mat = k === 1 ? fabrics()[3] : k === 2 ? M.leatherTan() : fabrics()[0];
    shoe.add(sphere(1, M.leatherTan(), { sx: 0.047, sy: 0.015, sz: 0.127, y: 0.017, seg: 20 }));
    if (k === 2) {
      for (const z of [-0.04, 0.025]) shoe.add(tube([[-0.044, 0.031, z], [-0.022, 0.060, z], [0.022, 0.060, z], [0.044, 0.031, z]], 0.011, mat, { seg: 12, radial: 6 }));
    } else {
      shoe.add(surface(24, 16, (u, t) => { const a = u * PI, z = -0.11 + t * 0.23, w = 0.044 * Math.pow(Math.sin(PI * (0.06 + t * 0.88)), 0.35);
        return [Math.cos(a) * w, 0.024 + Math.sin(a) * (0.026 + 0.045 * Math.pow(1 - t, 3)), z]; }, mat));
      shoe.add(torus(0.022, 0.005, mat, { y: 0.075, z: -0.075, rx: PI / 2, seg: 20, tube: 6 }));
      for (let j = 0; j < 4; j++) shoe.add(tube([[-0.017, 0.060 - j * 0.004, -0.04 + j * 0.015], [0, 0.065 - j * 0.004, -0.043 + j * 0.015], [0.017, 0.060 - j * 0.004, -0.04 + j * 0.015]], 0.0015, fabrics()[0], { seg: 6, radial: 4 }));
    }
    put(root, shoe, -0.49 + k * 0.30 + s * 0.055, 0, 0.018 * Math.sin(k * 3 + s), (k % 2 ? 0.1 : -0.06) + s * 0.025);
  }
  // Low shoes still block the player's feet (layout ignores colliders below .25 m).
  autoCollider(root, 0); root.userData.collider.h = 0.26;
  return finish(root, 'shoes', 'Four pairs of sneakers and sandals', '四双运动鞋与凉鞋');
}
function travel() {
  const root = group(box(0.36, 0.54, 0.21, fabrics()[6], { y: 0.31, r: 0.035, seg: 4 }));
  for (const x of [-0.115, 0.115]) {
    root.add(cyl(0.029, 0.029, 0.022, M.blackSteel(), { x, y: 0.033, z: -0.073, rz: PI / 2, seg: 16 }),
      box(0.012, 0.30, 0.012, M.steel(), { x, y: 0.66, z: -0.06, r: 0.003, seg: 1 }));
  }
  root.add(box(0.25, 0.018, 0.027, M.blackSteel(), { y: 0.81, z: -0.06, r: 0.008, seg: 2 }),
    tube([[-0.18, 0.075, 0.022], [-0.185, 0.54, 0.022], [0, 0.575, 0.022], [0.185, 0.54, 0.022], [0.18, 0.075, 0.022]], 0.0025, M.steel(), { seg: 28, radial: 4 }));
  autoCollider(root, 0); return finish(root, 'suitcase', 'Small sage weekend suitcase', '鼠尾草色周末行李箱');
}
function yoga() {
  const root = group(cyl(0.062, 0.062, 0.51, fabrics()[1], { y: 0.255, seg: 32 }));
  for (const y of [0.002, 0.512]) {
    const path = []; for (let i = 0; i <= 100; i++) { const a = i / 100 * PI * 12, r = 0.011 + 0.047 * i / 100; path.push([Math.cos(a) * r, y, Math.sin(a) * r]); }
    root.add(tube(path, 0.0016, fabrics()[6], { seg: 110, radial: 4 }));
  }
  root.add(torus(0.064, 0.007, fabrics()[0], { y: 0.20, rx: PI / 2, seg: 24, tube: 6 }));
  autoCollider(root, 0); return finish(root, 'yoga-mat', 'Rolled sage yoga mat', '卷起的鼠尾草色瑜伽垫');
}
export const items = { fitout, hanging, shelf, hamper, shoes, travel, yoga };
