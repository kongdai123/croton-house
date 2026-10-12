// bedrooms — shared helpers: wood boards with real grain direction, soft pillows, draped throws, local canvas textures.
import { THREE, M, box, lathe, tube, shadow } from '../kit.js';
import * as proc from '../proc.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const once = (fn) => { let v; return () => (v ??= fn()); };
export function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// ---------- UV re-projection so the grain runs along a board's long axis and the texture keeps real-world scale.
// along: 0 = x, 1 = y, 2 = z. tile = metres per texture repeat. Works for BoxGeometry / RoundedBoxGeometry (face groups).
const FACE_AXIS = [0, 0, 1, 1, 2, 2];
export function projectUV(geo, along = 0, tile = 1, off = [0, 0], across = tile) {
  const pos = geo.attributes.position, uv = geo.attributes.uv, idx = geo.index;
  const axisOf = new Int8Array(pos.count).fill(-1);
  if (geo.groups.length && idx) for (const g of geo.groups) for (let i = g.start; i < g.start + g.count; i++) axisOf[idx.getX(i)] = FACE_AXIS[g.materialIndex] ?? 1;
  const nrm = geo.attributes.normal, p = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    let N = axisOf[i];
    if (N < 0) { const n = [Math.abs(nrm.getX(i)), Math.abs(nrm.getY(i)), Math.abs(nrm.getZ(i))]; N = n[0] > n[1] ? (n[0] > n[2] ? 0 : 2) : (n[1] > n[2] ? 1 : 2); }
    p[0] = pos.getX(i); p[1] = pos.getY(i); p[2] = pos.getZ(i);
    let u, v;
    if (N !== along) { const B = 3 - along - N; u = p[B]; v = p[along]; } else { u = p[(along + 1) % 3]; v = p[(along + 2) % 3]; }
    uv.setXY(i, u / across + off[0], v / tile + off[1]);
  }
  uv.needsUpdate = true; return geo;
}
// A wooden board / block: kit.box + grain along `along`, random texture offset from `seed` so neighbouring boards differ.
// tile = metres per texture repeat along the grain, across = across the grain (the canvas grain is ~4 rings per tile).
// tone = per-board brightness (written as vertex colour by merge(); only used by vertex-colour materials).
export function wood(w, h, d, mat, { along, tile = 1.8, across = 0.32, seed = 1, r = 0.004, seg = 2, tone, ...o } = {}) {
  if (along === undefined) along = w >= h && w >= d ? 0 : (h >= d ? 1 : 2);
  const m = box(w, h, d, mat, { r, seg, ...o }); const R = rng(seed * 7919 + 13); R();
  projectUV(m.geometry, along, tile, [R() * 3, R() * 3], across); m.userData.tone = tone ?? 0.9 + R() * 0.14; return m;
}
// Vertex-colour twin of a shared material (cached) so merged boards can carry per-board tone without touching M.*.
const vcCache = new Map();
export function vc(mat) { if (mat.vertexColors) return mat; if (!vcCache.has(mat)) { const m = mat.clone(); m.vertexColors = true; vcCache.set(mat, m); } return vcCache.get(mat); }
// Merge many meshes (sharing one material) into a single mesh to save draw calls. Keeps each mesh's transform.
export function merge(meshes, mat) {
  const geos = [];
  for (const m of meshes) {
    m.updateMatrix(); const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone(); g.applyMatrix4(m.matrix);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    const t = m.userData.tone ?? 1, n = g.attributes.position.count, col = new Float32Array(n * 3).fill(t);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); geos.push(g);
  }
  return shadow(new THREE.Mesh(mergeGeometries(geos, false), vc(mat)));
}

// ---------- Soft goods
// Puffy pillow lying in the XZ plane (w along x, d along z, t thick); thin pinched edges, full centre.
export function puffGeo(w, d, t, { wob = 0.004, seed = 3 } = {}) {
  const g = new THREE.BoxGeometry(w, t, d, 16, 2, 12); const p = g.attributes.position, R = rng(seed); const a = R() * 6, b = R() * 6;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const nx = Math.min(1, Math.abs(x) / (w / 2)), nz = Math.min(1, Math.abs(z) / (d / 2));
    const f = Math.max(0, (1 - Math.pow(nx, 2.2)) * (1 - Math.pow(nz, 2.2)));
    const k = 0.08 + 0.92 * Math.pow(f, 0.4);
    // edges bow outward mid-span, corners stay put -> soft pillow outline with "ears"
    const bx = 1 + 0.06 * (1 - nz * nz), bz = 1 + 0.06 * (1 - nx * nx);
    p.setXYZ(i, x * bx, y * k + (y > 0 ? 1 : -1) * wob * Math.sin(x * 9 + a) * Math.sin(z * 11 + b) * f, z * bz);
  }
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  const m = mergeVertices(g, 1e-5); m.computeVertexNormals(); return m;
}
export function pillowMesh(w, d, t, mat, o = {}) { return shadow(new THREE.Mesh(puffGeo(w, d, t, o), mat)); }
// Ruffled piped edge (the black-trimmed shams in g26): a wavy tube just outside the pillow outline, in pillow space.
export function ruffle(w, d, mat, { amp = 0.012, waves = 46, r = 0.0035 } = {}) {
  const pts = [], N = 220, per = 2 * (w + d);
  for (let i = 0; i < N; i++) {
    const s = (i / N) * per; let x, z, ox = 0, oz = 0;
    if (s < w) { x = -w / 2 + s; z = d / 2; oz = 1; } else if (s < w + d) { x = w / 2; z = d / 2 - (s - w); ox = 1; } else if (s < 2 * w + d) { x = w / 2 - (s - w - d); z = -d / 2; oz = -1; } else { x = -w / 2; z = -d / 2 + (s - 2 * w - d); ox = -1; }
    const o = 0.012 + amp * (0.5 + 0.5 * Math.sin((s / per) * waves * Math.PI * 2));
    pts.push([x + ox * o, 0.004 * Math.sin((s / per) * waves * Math.PI * 4), z + oz * o]);
  }
  return tube(pts, r, mat, { seg: 300, radial: 4, closed: true });
}

// Cloth draped over a rectangular top (x0..x1, z0..z1 at height `top`) that falls over the edges. Optional second
// level `ledge` = {x0,x1,z0,z1,y}: a wider platform (the bed deck) the cloth lands on before falling to `floor`.
// The cloth is w × l, centred at (cx, cz), rotated by `angle` in plan. Pure geometry, deterministic.
export function drape({ w, l, cx, cz, angle = 0, x0, x1, z0, z1, top, floor = 0.01, ledge = null, R = 0.035, ripple = 0.018, seg = [44, 56], seed = 5 }, mat) {
  const g = new THREE.PlaneGeometry(w, l, seg[0], seg[1]); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, c = Math.cos(angle), s = Math.sin(angle), r = rng(seed); const ph = [r() * 6, r() * 6, r() * 6];
  // one fall: given distance `o` travelled past an edge at height y0 onto a level yb, return [outward offset, y, rest]
  const fall = (o, y0, yb) => { const arc = R * Math.PI / 2, drop = y0 - yb; if (o < arc) { const th = o / R; return [R * Math.sin(th), y0 - R * (1 - Math.cos(th)), 0]; } if (o - arc < drop - R) return [R, y0 - R - (o - arc), 0]; return [R, yb, o - arc - (drop - R)]; };
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i), v = p.getZ(i);
    let x = cx + u * c - v * s, z = cz + u * s + v * c;
    const wr = Math.sin(u * 7.3 + v * 3.1 + ph[0]) * 0.6 + Math.sin(u * 2.2 - v * 8.7 + ph[1]) * 0.4;
    const ox = x < x0 ? x0 - x : (x > x1 ? x - x1 : 0), oz = z < z0 ? z0 - z : (z > z1 ? z - z1 : 0);
    const o = Math.hypot(ox, oz); let y = top + 0.012 + ripple * 0.5 * (1 + wr);
    if (o > 0) {
      const dx = ox ? (x < x0 ? -1 : 1) * ox / o : 0, dz = oz ? (z < z0 ? -1 : 1) * oz / o : 0;
      const ex = x - dx * o, ez = z - dz * o; // point on the top's edge
      let out, yy, rest;
      if (ledge) {
        // horizontal room on the ledge along this direction
        const gx = dx ? (dx > 0 ? ledge.x1 - x1 : x0 - ledge.x0) / Math.abs(dx) : 1e9, gz = dz ? (dz > 0 ? ledge.z1 - z1 : z0 - ledge.z0) / Math.abs(dz) : 1e9;
        const gap = Math.max(0, Math.min(gx, gz));
        [out, yy, rest] = fall(o, top, ledge.y);
        if (rest > 0) { const along = out + rest; if (along <= gap - 0.004) { out = along; } else { const [o2, y2, r2] = fall(along - (gap - 0.004), ledge.y, floor); out = gap - 0.004 + o2 + r2; yy = y2; } }
      } else { [out, yy, rest] = fall(o, top, floor); out += rest; }
      const fold = ripple * 1.4 * Math.sin(u * 11 + v * 5 + ph[2]) * Math.min(1, o / 0.15);
      x = ex + dx * (out + 0.006 + fold); z = ez + dz * (out + 0.006 + fold); y = yy + 0.003;
    }
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return shadow(new THREE.Mesh(g, mat));
}

// ---------- Small props
const coverMats = new Map();
export function book(w, t, d, color, { x = 0, y = 0, z = 0, ry = 0 } = {}) {
  if (!coverMats.has(color)) coverMats.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.75 }));
  const g = new THREE.Group();
  g.add(box(w, t, d, coverMats.get(color), { r: 0.002, seg: 1, bottom: true }));
  g.add(box(w - 0.004, t - 0.006, d - 0.008, mats.pages(), { bottom: true, y: 0.003, x: 0.003 }));
  g.position.set(x, y, z); g.rotation.y = ry; return g;
}
export function cup(mat, { x = 0, y = 0, z = 0, r = 0.04, h = 0.075 } = {}) {
  const prof = [[0, 0], [r * 0.62, 0], [r * 0.7, 0.006], [r * 0.92, h * 0.35], [r, h * 0.85], [r * 1.02, h], [r * 0.94, h], [r * 0.9, h * 0.85], [r * 0.82, h * 0.35], [0.001, h * 0.1]];
  return lathe(prof, mat, { seg: 28, x, y, z });
}

// ---------- Local canvas textures (deterministic)
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tx(c, { repeat = [1, 1], srgb = true } = {}) { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; }

// Flat-sawn board grain: long, nearly straight growth rings (u = across, v = along the board), occasional cathedral
// arches, knots, optional whitewash that settles into the earlywood. Canvas 512 (across) × 2048 (along).
function boardGrain({ base = '#e8d2a8', late = '#b98c55', wash = 0, washCol = '#f3eee6', knots = 6, seed = 3, ring = 15 } = {}) {
  const W = 512, H = 2048, [c, g] = canvas(W, H), r = rng(seed), img = g.createImageData(W, H), d = img.data;
  const B = hexc(base), L = hexc(late), Wc = hexc(washCol);
  const arches = []; for (let k = 0; k < 3; k++) arches.push({ x: r() * W, y: r() * H, a: 0.00006 + r() * 0.00008 });
  const ph = r() * 100, rowJ = new Float32Array(W); for (let x = 0; x < W; x++) rowJ[x] = (r() - 0.5) * 0.08;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let xe = x + 18 * Math.sin(y * 0.0021 + ph) + 5 * Math.sin(y * 0.013 + x * 0.01);
    for (const A of arches) { const dy = y - A.y; xe += Math.sign(x - A.x) * 0 + A.a * dy * dy * (Math.abs(x - A.x) < 120 ? (1 - Math.abs(x - A.x) / 120) : 0) * 60; }
    const t = xe / ring; const f = t - Math.floor(t);
    let lw = f < 0.18 ? 1 - f / 0.18 : (f > 0.9 ? (f - 0.9) / 0.1 * 0.5 : 0); lw = Math.pow(lw, 1.4) * (0.75 + 0.25 * Math.sin(t * 1.7 + ph));
    let col = mixc(B, L, Math.min(1, lw * 0.85 + rowJ[x] + 0.04 * Math.sin(y * 0.05 + x)));
    if (wash > 0) col = mixc(col, Wc, wash * (1 - lw * 0.55));
    const i = (y * W + x) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  for (let k = 0; k < knots; k++) { const x = r() * W, y = r() * H, rad = 6 + r() * 12; for (let q = 4; q >= 0; q--) { g.fillStyle = `rgba(${L[0] * 0.55 | 0},${L[1] * 0.45 | 0},${L[2] * 0.35 | 0},${0.12 + (4 - q) * 0.1})`; g.beginPath(); g.ellipse(x, y, rad * (0.5 + q * 0.25) * 0.8, rad * (0.5 + q * 0.4), 0, 0, 7); g.fill(); } }
  return tx(c);
}
function hexc(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mixc(a, b, t) { t = Math.max(0, Math.min(1, t)); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

// Open diamond lattice of flat rattan strips (IKEA BÖJA-style egg lamp in g27/g33/g35). Alpha holes between strips.
function latticeTex() {
  const S = 256, [c, g] = canvas(S, S); g.clearRect(0, 0, S, S);
  const strip = (dir) => { for (let k = -2; k <= 2; k++) { g.save(); g.translate(S / 2 + k * S / 2, S / 2); g.rotate(dir * Math.PI / 4); const grd = g.createLinearGradient(0, -14, 0, 14); grd.addColorStop(0, '#9c7440'); grd.addColorStop(0.35, '#e0bd84'); grd.addColorStop(0.65, '#d7b276'); grd.addColorStop(1, '#8e6634'); g.fillStyle = grd; g.fillRect(-S, -13, 2 * S, 26); g.restore(); } };
  strip(1); strip(-1);
  return tx(c, { repeat: [10, 6] });
}
function knitTex() {
  // charcoal knit with thin light diagonal ribs of tiny stitches (the g26 throw)
  const S = 256, [c, g] = canvas(S, S), r = rng(17); g.fillStyle = '#45474b'; g.fillRect(0, 0, S, S);
  g.lineWidth = 1.6; g.lineCap = 'round';
  for (let y = 0; y < S; y += 6) for (let x = 0; x < S; x += 6) {
    const k = ((x / 6) + (y / 6)) % 6; const light = k === 0 || k === 1;
    g.strokeStyle = light ? `rgba(226,225,220,${0.8 + r() * 0.2})` : `rgba(${r() > 0.5 ? '30,31,34' : '92,94,99'},0.7)`;
    g.beginPath(); g.moveTo(x + 0.8, y + 1); g.lineTo(x + 3, y + 5); g.lineTo(x + 5.2, y + 1); g.stroke();
  }
  return tx(c, { repeat: [3.5, 5] });
}
function creamKnitTex() {
  const S = 256, [c, g] = canvas(S, S), r = rng(23); g.fillStyle = '#e8e0cf'; g.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 6) for (let x = 0; x < S; x += 6) { g.fillStyle = r() > 0.5 ? '#f5efe2' : '#d6ccb7'; g.globalAlpha = 0.7; g.beginPath(); g.ellipse(x + 3, y + 3, 2.4, 2.9, (x / 6) % 2 ? 0.5 : -0.5, 0, 7); g.fill(); }
  g.globalAlpha = 1; return tx(c, { repeat: [7, 8] });
}
// Quilted / waffle coverlet relief (bump only)
function quiltBump() {
  const S = 512, [c, g] = canvas(S, S); g.fillStyle = '#808080'; g.fillRect(0, 0, S, S); g.strokeStyle = '#4a4a4a'; g.lineWidth = 3;
  for (let k = 0; k < 16; k++) { g.beginPath(); for (let x = 0; x <= S; x += 4) { const y = k * 32 + 9 * Math.sin((x / S) * Math.PI * 8 + k * 0.3); x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
  const r = rng(9); g.fillStyle = '#9a9a9a'; for (let i = 0; i < 6000; i++) { g.globalAlpha = 0.25; g.fillRect(r() * S, r() * S, 2, 2); }
  return tx(c, { srgb: false });
}
function noiseBump(seed = 31, n = 22000, size = 2) { const S = 512, [c, g] = canvas(S, S), r = rng(seed); g.fillStyle = '#7f7f7f'; g.fillRect(0, 0, S, S); for (let i = 0; i < n; i++) { g.fillStyle = r() > 0.5 ? '#ffffff' : '#000000'; g.globalAlpha = 0.18; g.fillRect(r() * S, r() * S, size, size + r() * 3); } return tx(c, { srgb: false }); }
// Off-white shag rug with a faint grey diamond / crosshatch pattern (bedroom B, g33). 1 texture tile = 1 m.
function rugWhiteTex() {
  const S = 1024, [c, g] = canvas(S, S), r = rng(41); g.fillStyle = '#ebe7df'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 26000; i++) { g.globalAlpha = 0.12 + r() * 0.12; g.fillStyle = r() > 0.55 ? '#ffffff' : '#cfc9bd'; g.fillRect(r() * S, r() * S, 1.5 + r() * 2, 1.5 + r() * 4); }
  g.globalAlpha = 0.6; g.strokeStyle = '#8f8b84'; g.lineWidth = 7;
  const n = 4, s = S / n; // diamonds 0.25 m across, wobbly hand-loomed lines
  for (let d = -n; d <= 2 * n; d++) for (const dir of [1, -1]) { g.beginPath(); for (let t = 0; t <= S; t += 16) { const x = dir > 0 ? d * s + t : d * s - t + S, y = t; const j = (r() - 0.5) * 5; t ? g.lineTo(x + j, y + j) : g.moveTo(x, y); } g.stroke(); }
  g.globalAlpha = 0.35; g.lineWidth = 4; for (let i = 0; i < 90; i++) { const x = r() * S, y = r() * S; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 120, y + (r() - 0.5) * 20); g.stroke(); }
  g.globalAlpha = 1; return tx(c);
}
// Edge-glued acacia: strips of varying tone with grain along the board (texture v).
function acaciaTex() {
  const W = 512, H = 1024, [c, g] = canvas(W, H), r = rng(77); let x = 0;
  const tones = ['#6e3d1f', '#8a4f28', '#4f2a14', '#7a4524', '#9a5e33', '#5c3118', '#83502b', '#a4693a'];
  while (x < W) {
    const sw = 22 + r() * 46; let y = 0;
    while (y < H) { const sh = 180 + r() * 520; g.fillStyle = tones[Math.floor(r() * tones.length)]; g.fillRect(x, y, sw, sh); y += sh; g.fillStyle = 'rgba(30,15,5,0.35)'; g.fillRect(x, y - 1, sw, 1.5); }
    for (let k = 0; k < sw / 3; k++) { g.strokeStyle = `rgba(${r() > 0.5 ? '40,20,8' : '200,150,100'},${0.12 + r() * 0.18})`; g.lineWidth = 0.6 + r() * 1.4; const xx = x + r() * sw; g.beginPath(); g.moveTo(xx, 0); for (let y2 = 0; y2 <= H; y2 += 32) g.lineTo(xx + Math.sin(y2 * 0.01 + k) * 2.5, y2); g.stroke(); }
    g.fillStyle = 'rgba(30,15,5,0.4)'; g.fillRect(x + sw - 1, 0, 1, H); x += sw;
  }
  return tx(c);
}

export const mats = {
  whitewash: once(() => new THREE.MeshStandardMaterial({ map: boardGrain({ base: '#d6cab5', late: '#6e5a44', wash: 0.12, washCol: '#efebe3', seed: 19, ring: 30 }), roughness: 0.8 })),
  pineBoard: once(() => new THREE.MeshStandardMaterial({ map: boardGrain({ base: '#d8ac6c', late: '#9c6529', seed: 29, ring: 24, knots: 9 }), roughness: 0.6 })),
  pages: once(() => new THREE.MeshStandardMaterial({ color: 0xf3eee2, roughness: 0.95 })),
  rattanLattice: once(() => new THREE.MeshStandardMaterial({ map: latticeTex(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 })),
  throwKnit: once(() => new THREE.MeshPhysicalMaterial({ map: knitTex(), roughness: 0.95, sheen: 0.5, sheenRoughness: 0.8, sheenColor: new THREE.Color(0xffffff), side: THREE.DoubleSide, bumpMap: noiseBump(5, 18000, 2), bumpScale: 1.2 })),
  throwCream: once(() => new THREE.MeshPhysicalMaterial({ map: creamKnitTex(), roughness: 0.95, sheen: 0.6, sheenColor: new THREE.Color(0xffffff), side: THREE.DoubleSide })),
  quilt: once(() => { const b = quiltBump(); b.repeat.set(1, 1); return new THREE.MeshPhysicalMaterial({ color: 0xf7f5f0, roughness: 0.95, sheen: 0.6, sheenRoughness: 0.8, sheenColor: new THREE.Color(0xffffff), bumpMap: b, bumpScale: 2.5 }); }),
  sheet: once(() => new THREE.MeshPhysicalMaterial({ color: 0xf8f8f6, roughness: 0.9, sheen: 0.5, sheenColor: new THREE.Color(0xffffff), bumpMap: noiseBump(11, 9000, 3), bumpScale: 0.6 })),
  pillow: once(() => new THREE.MeshPhysicalMaterial({ color: 0xfbfaf7, roughness: 0.92, sheen: 0.6, sheenRoughness: 0.7, sheenColor: new THREE.Color(0xffffff) })),
  piping: once(() => new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.8 })),
  rugWhite: once(() => new THREE.MeshPhysicalMaterial({ map: rugWhiteTex(), roughness: 1, sheen: 0.8, sheenRoughness: 0.9, sheenColor: new THREE.Color(0xffffff), bumpMap: noiseBump(41, 40000, 2), bumpScale: 3 })),
  acacia: once(() => new THREE.MeshStandardMaterial({ map: acaciaTex(), roughness: 0.42 })),
  charcoal: once(() => new THREE.MeshStandardMaterial({ map: boardGrain({ base: '#5e5c58', late: '#2f2d2a', wash: 0.12, washCol: '#8a8782', seed: 21, ring: 22, knots: 0 }), roughness: 0.78 })),
  espresso: once(() => new THREE.MeshStandardMaterial({ map: boardGrain({ base: '#412619', late: '#1e110b', seed: 33, ring: 18 }), roughness: 0.42 })),
  walnut: once(() => new THREE.MeshStandardMaterial({ map: boardGrain({ base: '#6f4229', late: '#341c0d', seed: 37, ring: 20, knots: 2 }), roughness: 0.5 })),
  cedarBack: once(() => new THREE.MeshStandardMaterial({ map: boardGrain({ base: '#c9a07c', late: '#8c5a3a', seed: 12, ring: 11, knots: 8 }), roughness: 0.75 })),
  limewash: once(() => { const t = boardGrain({ base: '#58595b', late: '#1c1e22', wash: 0.3, washCol: '#dddcd8', seed: 44, ring: 10, knots: 0 }); t.repeat.set(5, 1.5); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.88 }); }),
  outletWhite: once(() => new THREE.MeshStandardMaterial({ color: 0xf2f1ec, roughness: 0.4 })),
  vase: once(() => new THREE.MeshStandardMaterial({ map: proc.speckle({ base: '#8f8d88', dots: '#e5e2da' }), roughness: 0.45, metalness: 0.45 })),
  driedGrass: once(() => new THREE.MeshStandardMaterial({ color: 0xd9c49b, roughness: 0.9 })),
  brass: once(() => new THREE.MeshStandardMaterial({ color: 0xb08d57, roughness: 0.35, metalness: 0.9 })),
  chrome: once(() => new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.15, metalness: 1 })),
  bulb: once(() => new THREE.MeshStandardMaterial({ color: 0xfff4dc, emissive: 0xffd9a0, emissiveIntensity: 2.2, roughness: 0.3 })),
};
export { M, proc };
