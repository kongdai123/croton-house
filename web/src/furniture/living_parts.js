// Helpers for the living-room module: metric wood UVs with grain direction, superellipsoid cushions/pillows,
// piping tubes, rounded-rect outlines and procedural books. Only used by living.js.
import { THREE, M, shadow } from '../kit.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function rng(seed) { let s = (seed * 2654435761) >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// Re-project UVs in metres (divided by `tile`) per face so wood grain (texture v) runs along `grain` axis
// (0 = x, 1 = y, 2 = z) on every face; end-grain faces get the grain across. `off` shifts the pattern.
export function metricUV(geo, { grain = 0, tile = 1, off = [0, 0], pos = [0, 0, 0] } = {}) {
  const [tu, tv] = Array.isArray(tile) ? tile : [tile, tile];
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const c = [p.getX(i) + pos[0], p.getY(i) + pos[1], p.getZ(i) + pos[2]];
    const a0 = Math.abs(n.getX(i)), a1 = Math.abs(n.getY(i)), a2 = Math.abs(n.getZ(i));
    const a = a0 >= a1 && a0 >= a2 ? 0 : a1 >= a2 ? 1 : 2;
    let v, u; if (a !== grain) { v = grain; u = 3 - a - grain; } else { v = (a + 1) % 3; u = (a + 2) % 3; }
    uv.setXY(i, c[u] / tu + off[0], c[v] / tv + off[1]);
  }
  uv.needsUpdate = true; return geo;
}

// Wood board: rounded box with grain along its longest side (or `grain`), metric UVs, per-board offset by seed.
export function wbox(w, h, d, mat, o = {}) {
  const { r = 0.004, seg = 1, x = 0, y = 0, z = 0, bottom = false, tile = PINE_TILE, seed = 1, rx = 0, ry = 0, rz = 0 } = o;
  const dims = [w, h, d], grain = o.grain ?? dims.indexOf(Math.max(...dims));
  const g = r > 0 ? new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)) : new THREE.BoxGeometry(w, h, d);
  const R = rng(seed + 17); metricUV(g, { grain, tile, off: o.off ?? [R() * 3, R() * 3], pos: o.uvPos ?? [0, 0, 0] });
  const m = new THREE.Mesh(g, mat); m.position.set(x, bottom ? y + h / 2 : y, z); m.rotation.set(rx, ry, rz); return shadow(m);
}
// Box from min/max corners (handy for joinery laid out in absolute coordinates).
export function wspan([x0, y0, z0], [x1, y1, z1], mat, o = {}) {
  return wbox(x1 - x0, y1 - y0, z1 - z0, mat, { ...o, x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 });
}

// Superellipsoid "blob": half sizes A (x), B (y), C (z). e2 = plan squareness (small = boxy), e1 = profile
// roundness. puff > 0 domes the faces; thin > 0 pinches the edges (pillow). Returns geometry.
const sp = (c, e) => Math.sign(c) * Math.pow(Math.abs(c), e);
export function blobGeo(A, B, C, { e1 = 0.4, e2 = 0.15, puff = 0, thin = 0, ws = 40, hs = 22, uvTile = 1 } = {}) {
  let g = new THREE.SphereGeometry(1, ws, hs); g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-5); const p = g.attributes.position;      // welded seam + poles: no shading lines
  for (let i = 0; i < p.count; i++) {
    const nx = p.getX(i), ny = Math.max(-1, Math.min(1, p.getY(i))), nz = p.getZ(i);
    const eta = Math.asin(ny), om = Math.atan2(nz, nx);
    const ce = sp(Math.cos(eta), e1);
    let x = A * ce * sp(Math.cos(om), e2), y = B * sp(Math.sin(eta), e1), z = C * ce * sp(Math.sin(om), e2);
    const m = Math.min(1, Math.pow(Math.pow(Math.abs(x) / A, 4) + Math.pow(Math.abs(z) / C, 4), 0.25));
    y *= (1 + puff * (1 - m * m)) * (1 - thin * Math.pow(m, 3));
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals(); g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.count * 2), 2));
  metricUV(g, { grain: 0, tile: uvTile }); return g;
}
export function blob(A, B, C, mat, opts = {}) { return shadow(new THREE.Mesh(blobGeo(A, B, C, opts), mat)); }
// Equator outline of a blob (piping / welt line), as [x, y, z] points.
export function blobEquator(A, C, { e2 = 0.15, n = 96, grow = 0, y = 0 } = {}) {
  const pts = []; for (let i = 0; i < n; i++) { const om = (i / n) * Math.PI * 2; pts.push([(A + grow) * sp(Math.cos(om), e2), y, (C + grow) * sp(Math.sin(om), e2)]); } return pts;
}
// Closed or open tube through points (centripetal Catmull-Rom so corners do not overshoot).
export function pipe(points, radius, mat, { closed = true, seg = 96, radial = 6 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map(q => new THREE.Vector3(...q)), closed, 'centripetal');
  return shadow(new THREE.Mesh(new THREE.TubeGeometry(curve, seg, radius, radial, closed), mat));
}
// Rounded-rectangle outline [[x, y], ...] (w × h, corner radius r), counter-clockwise.
export function rrect(w, h, r, n = 6) {
  const pts = [], cx = w / 2 - r, cy = h / 2 - r;
  for (const [sx, sy, a0] of [[1, 1, 0], [-1, 1, 0.5], [-1, -1, 1], [1, -1, 1.5]]) for (let i = 0; i <= n; i++) { const a = (a0 + (i / n) * 0.5) * Math.PI; pts.push([sx * cx + Math.cos(a) * r, sy * cy + Math.sin(a) * r]); }
  return pts;
}
// Same outline as 3-D points in the XZ plane at height y (for piping loops on box tops).
export const rrectXZ = (w, d, r, y, n = 6) => densify(rrect(w, d, r, n).map(([x, z]) => [x, y, z]), 0.06);
// Insert points on long straight runs so Catmull-Rom tubes stay straight (no bulge between sparse corners).
export function densify(pts, step = 0.06, closed = true) {
  const out = [], N = pts.length;
  for (let i = 0; i < (closed ? N : N - 1); i++) {
    const a = pts[i], b = pts[(i + 1) % N], L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), k = Math.max(1, Math.ceil(L / step));
    for (let j = 0; j < k; j++) out.push(a.map((v, c) => v + (b[c] - v) * j / k));
  }
  if (!closed) out.push(pts[N - 1]); return out;
}

// ---- Books: individual boxes; spine (+Z face) samples a slice of M.bookSpines, covers coloured, pages cream.
const COVERS = { black: 0x1d1c1b, white: 0xeeebe4, cream: 0xe2d6bd, red: 0xa63a2c, navy: 0x27384f, grey: 0x6d6a66, olive: 0x7b7c55, tan: 0xb89a6c };
const coverMats = {}; let pagesMat;
function coverMat(name) { return (coverMats[name] ??= new THREE.MeshStandardMaterial({ color: COVERS[name], roughness: 0.6 })); }
function pages() { return (pagesMat ??= new THREE.MeshStandardMaterial({ color: 0xf1ead9, roughness: 0.9 })); }
export function book(w, h, d, color, seed, { lying = false } = {}) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, R = rng(seed);
  const u0 = R() * 0.95, du = lying ? 0.012 : 0.022, v1 = 0.5;
  // BoxGeometry face order px, nx, py, ny, pz, nz – 4 verts each; pz = spine (verts 16..19: TL, TR, BL, BR).
  const S = lying ? [[u0, v1], [u0, 0.02], [u0 + du, v1], [u0 + du, 0.02]] : [[u0, v1], [u0 + du, v1], [u0, 0.02], [u0 + du, 0.02]];
  S.forEach(([a, b], k) => uv.setXY(16 + k, a, b));
  const cm = coverMat(color), pm = pages();
  const mats = lying ? [pm, pm, cm, cm, M.bookSpines(), pm] : [cm, cm, pm, pm, M.bookSpines(), pm];
  return shadow(new THREE.Mesh(g, mats));
}
// Row of upright books starting at x = 0 going +x, bottoms on y = 0, spines flush at z = 0 (facing +Z).
export function bookRow(width, seed, colors = ['black', 'navy', 'cream', 'red', 'white', 'grey'], { hMin = 0.19, hMax = 0.27, dMin = 0.15, dMax = 0.21, lean = 0 } = {}) {
  const g = new THREE.Group(), R = rng(seed); let x = 0;
  while (true) {
    const t = 0.018 + R() * 0.03; if (x + t > width) break;
    const h = hMin + R() * (hMax - hMin), d = dMin + R() * (dMax - dMin);
    const b = book(t, h, d, colors[Math.floor(R() * colors.length)], seed * 31 + Math.floor(x * 1000));
    b.position.set(x + t / 2, h / 2, -d / 2); g.add(b); x += t + 0.001;
  }
  if (lean) { const last = g.children[g.children.length - 1]; if (last) { last.rotation.z = -lean; last.position.x += Math.sin(lean) * last.geometry.parameters.height / 2; last.position.y -= 0.004; } }
  return g;
}
// Stack of books lying flat, centred on x = 0, spines at z = 0.
export function bookStack(n, seed, colors = ['white', 'cream', 'red', 'black', 'navy'], { wMin = 0.15, wMax = 0.24, dMin = 0.2, dMax = 0.27 } = {}) {
  const g = new THREE.Group(), R = rng(seed); let y = 0;
  for (let i = 0; i < n; i++) {
    const t = 0.016 + R() * 0.026, w = wMin + R() * (wMax - wMin), d = dMin + R() * (dMax - dMin);
    const b = book(w, t, d, colors[Math.floor(R() * colors.length)], seed * 17 + i, { lying: true });
    b.position.set((R() - 0.5) * 0.02, y + t / 2, -d / 2); b.rotation.y = (R() - 0.5) * 0.06; g.add(b); y += t + 0.0005;
  }
  return g;
}

// ---- Flat-sawn pine texture (local, seamless): cathedral arches in the middle of the tile, straight grain at the
// sides, thin late-wood lines, fine pores. Tile = PINE_TILE metres (u across the board, v along the grain).
export const PINE_TILE = [0.32, 1.1];
export function pineTexture({ base = '#f0dcb8', late = '#d6b07a', seed = 3, contrast = 1, rings = 46 } = {}) {
  const W = 512, H = 1024, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data, R = rng(seed);
  const hx = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const B = hx(base), L = hx(late), TAU = Math.PI * 2, ph = [R() * TAU, R() * TAU, R() * TAU, R() * TAU];
  const rowN = new Float32Array(H); for (let y = 0; y < H; y++) rowN[y] = Math.sin(y / H * TAU * 3 + ph[2]) * 0.02;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const cx = W * 0.5 + Math.sin(y / H * TAU + ph[0]) * W * 0.06;
    const sx = Math.sin((x - cx) / W * Math.PI);                  // periodic "distance" from the pith line
    const wob = Math.sin(x / W * TAU * 2 + y / H * TAU * 2 + ph[1]) * 0.015 + Math.sin(y / H * TAU * 7 + x / W * TAU + ph[3]) * 0.006;
    const f = sx * sx * 0.9 + y / H * 1.0 + wob + rowN[y];
    const r = (f * rings) % 1, ring = r < 0 ? r + 1 : r;
    let t = Math.pow(Math.max(0, 1 - Math.abs(ring - 0.82) / 0.16), 1.6) * 0.85;      // late-wood band
    t += 0.12 * (0.5 + 0.5 * Math.sin(f * rings * TAU * 0.5));                         // early-wood shading
    t = Math.min(1, t * contrast + (R() - 0.5) * 0.05 + (Math.sin(x * 1.7 + y * 0.05) > 0.97 ? 0.08 : 0));
    const i = (y * W + x) * 4; d[i] = B[0] + (L[0] - B[0]) * t; d[i + 1] = B[1] + (L[1] - B[1]) * t; d[i + 2] = B[2] + (L[2] - B[2]) * t; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = 8; tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

// Bake every mesh's transform (relative to root) into its own geometry copy and re-parent it to root, so bounding
// boxes (sizeOf / autoCollider / HUD) are exact even for rotated parts.
export function bake(root) {
  root.updateMatrixWorld(true); const inv = root.matrixWorld.clone().invert(), list = [];
  root.traverse(n => { if (n.isMesh) list.push(n); });
  for (const m of list) {
    const mat = inv.clone().multiply(m.matrixWorld), g = m.geometry.clone().applyMatrix4(mat);
    if (mat.determinant() < 0) { const idx = g.index; if (idx) for (let i = 0; i < idx.count; i += 3) { const a = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, a); } }
    m.geometry = g; m.position.set(0, 0, 0); m.rotation.set(0, 0, 0); m.scale.set(1, 1, 1); m.updateMatrix(); m.removeFromParent(); root.add(m);
  }
  for (const c of [...root.children]) if (!c.isMesh) root.remove(c);
  return root;
}

// ---- Procedural weave normal / AO maps (non-colour data). kind 'basket' = chunky jute basket weave (3 strands per
// block, blocks alternate direction), 'plain' = fine plain-weave cloth. `cells` = blocks per texture edge.
export function weaveMaps({ kind = 'plain', cells = 16, size = 512, strength = 3 } = {}) {
  const N = size, hgt = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N * cells, v = y / N * cells, iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
    let h;
    if (kind === 'basket') {
      const horiz = (iu + iv) % 2 === 0, k = 3, s = horiz ? fv : fu, along = horiz ? fu : fv;
      const strand = Math.sin(Math.PI * ((s * k) % 1)), twist = 0.85 + 0.15 * Math.sin((along * 4 + Math.floor(s * k) * 0.5) * Math.PI * 2);
      h = Math.pow(strand, 0.7) * twist * (0.75 + 0.25 * Math.sin(Math.PI * along));
    } else {
      const over = (iu + iv) % 2 === 0, s = over ? fv : fu, along = over ? fu : fv;
      h = Math.pow(Math.sin(Math.PI * s), 0.8) * (0.6 + 0.4 * Math.sin(Math.PI * along));
    }
    hgt[y * N + x] = h;
  }
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = N; return c; };
  const cn = mk(), ca = mk(), cc = kind === 'basket' ? mk() : null, gn = cn.getContext('2d'), ga = ca.getContext('2d'), gc = cc?.getContext('2d'), In = gn.createImageData(N, N), Ia = ga.createImageData(N, N), Ic = gc?.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const H = (a, b) => hgt[((b + N) % N) * N + ((a + N) % N)];
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * N + x) * 4;
    In.data[i] = (-dx / l * 0.5 + 0.5) * 255; In.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; In.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; In.data[i + 3] = 255;
    const ao = 255 * (0.45 + 0.55 * Math.min(1, H(x, y) * 1.3)); Ia.data[i] = Ia.data[i + 1] = Ia.data[i + 2] = ao; Ia.data[i + 3] = 255;
    if (Ic) { const c = 205 + 48 * H(x, y) + 2 * Math.sin(x * 1.7 + y * 2.3); Ic.data[i] = Ic.data[i + 1] = Ic.data[i + 2] = c; Ic.data[i + 3] = 255; }
  }
  gn.putImageData(In, 0, 0); ga.putImageData(Ia, 0, 0);
  const t = (c) => { const tx = new THREE.CanvasTexture(c); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.anisotropy = 8; return tx; };
  let color = null; if (gc) { gc.putImageData(Ic, 0, 0); color = t(cc); color.colorSpace = THREE.SRGBColorSpace; }
  return { normal: t(cn), ao: t(ca), color };
}
