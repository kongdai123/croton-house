// outdoor_parts — helpers and local materials for outdoor.js (wicker shell generator, resin weave, fire-pit mesh,
// wood box-UVs, struts). Everything is deterministic (seeded rng), built once and shared.
import { THREE, M, shadow } from '../kit.js';
import * as proc from '../proc.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export const once = (fn) => { let v; return () => (v ??= fn()); };
export function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
export const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function texOf(c, { srgb = true, aniso = 8 } = {}) { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; }

// ---------- Resin wicker: horizontal flat strands woven over vertical stakes (map + bump). One tile = 0.12 m.
export const WEAVE_TILE = 0.12;
function resinWeaveTextures({ a = '#dcc39c', b = '#bfa27a', gap = '#9a8462', seed = 3 } = {}) {
  const W = 512, rows = 12, segs = 6, rh = W / rows, sw = W / segs, r = rng(seed);
  const [c, g] = canvas(W, W), [ch, gh] = canvas(W, W);
  g.fillStyle = gap; g.fillRect(0, 0, W, W); gh.fillStyle = '#000'; gh.fillRect(0, 0, W, W);
  const A = a.match(/\w\w/g).map(h => parseInt(h, 16)), B = b.match(/\w\w/g).map(h => parseInt(h, 16));
  const col = (t, k) => `rgb(${A.map((v, i) => Math.round((v + (B[i] - v) * t) * k)).join(',')})`;
  for (let row = 0; row < rows; row++) {
    const y = row * rh, off = (row % 2) * sw / 2;
    for (let s = -1; s < segs + 1; s++) {
      const x = s * sw + off + 3, w = sw - 6, k = 0.9 + r() * 0.16, tone = r() * 0.35;
      for (const [ctx, isH] of [[g, false], [gh, true]]) {
        const grd = ctx.createLinearGradient(0, y + 1, 0, y + rh - 1);
        if (isH) { grd.addColorStop(0, '#202020'); grd.addColorStop(0.5, '#ffffff'); grd.addColorStop(1, '#202020'); }
        else { grd.addColorStop(0, col(1, 0.62 * k)); grd.addColorStop(0.35, col(tone, 1.04 * k)); grd.addColorStop(0.65, col(tone + 0.15, 0.98 * k)); grd.addColorStop(1, col(1, 0.55 * k)); }
        ctx.fillStyle = grd; ctx.beginPath(); ctx.roundRect(x, y + 1.5, w, rh - 3, rh * 0.45); ctx.fill();
        // strand dives under the stake at both ends
        const e = ctx.createLinearGradient(x, 0, x + w, 0);
        e.addColorStop(0, 'rgba(0,0,0,0.55)'); e.addColorStop(0.18, 'rgba(0,0,0,0)'); e.addColorStop(0.82, 'rgba(0,0,0,0)'); e.addColorStop(1, 'rgba(0,0,0,0.55)');
        ctx.fillStyle = e; ctx.beginPath(); ctx.roundRect(x, y + 1.5, w, rh - 3, rh * 0.45); ctx.fill();
      }
      // fine fibre streaks on the colour map
      g.globalAlpha = 0.18; g.strokeStyle = '#6b5436'; g.lineWidth = 1;
      for (let f = 0; f < 3; f++) { const fy = y + 6 + r() * (rh - 12); g.beginPath(); g.moveTo(x + 6, fy); g.lineTo(x + w - 6, fy + (r() - 0.5) * 2); g.stroke(); }
      g.globalAlpha = 1;
    }
  }
  return { map: texOf(c), bump: texOf(ch, { srgb: false }) };
}
export const wickerResin = once(() => { const t = resinWeaveTextures(); return new THREE.MeshStandardMaterial({ map: t.map, bumpMap: t.bump, bumpScale: 1.2, roughness: 0.8, color: 0xffffff }); });

// ---------- Other local materials
export const pitSteel = once(() => new THREE.MeshStandardMaterial({ color: 0x232323, roughness: 0.62, metalness: 0.45, side: THREE.DoubleSide }));
export const galvanized = once(() => new THREE.MeshStandardMaterial({ color: 0x5f6266, roughness: 0.55, metalness: 0.9 }));
export const powderBlack = once(() => new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.45, metalness: 0.55 }));
export const lumberTop = once(() => new THREE.MeshStandardMaterial({ map: proc.woodGrain({ base: '#a87d4e', dark: '#4f321a', knots: true, seed: 19 }), roughness: 0.82 }));
// pressure-treated pine as photographed (warmer, more saturated than M.lumber under the walkthrough's lighting)
export const lumberPT = once(() => new THREE.MeshStandardMaterial({ map: proc.woodGrain({ base: '#d79c55', dark: '#a8682a', knots: true, seed: 23 }), roughness: 0.72 }));
export const barkDark = once(() => { const m = M.bark().clone(); m.color = new THREE.Color(0x6e5c4a); return m; });
export const lumberEnd = once(() => new THREE.MeshStandardMaterial({ map: proc.woodGrain({ base: '#d2a066', dark: '#9c6a2c', knots: true, seed: 29 }), roughness: 0.78 }));
export const soil = once(() => new THREE.MeshStandardMaterial({ map: proc.speckle({ base: '#3a2a1e', dots: '#1a120b' }), roughness: 1 }));
export const gravelWhite = once(() => { const m = M.shell().clone(); return m; });
export const concreteGrey = once(() => { const t = proc.speckle({ base: '#9d9b96', dots: '#5d5b57' }); t.repeat.set(3, 3); return new THREE.MeshStandardMaterial({ map: t, bumpMap: t, bumpScale: 0.5, roughness: 0.92 }); });
export const navyDeep = once(() => new THREE.MeshStandardMaterial({ color: 0x141b33, roughness: 0.92, side: THREE.DoubleSide }));
export const renderWhite = once(() => { const t = proc.speckle({ base: '#efebe3', dots: '#cfc9bd' }); t.repeat.set(2, 2); return new THREE.MeshStandardMaterial({ color: 0xffffff, map: t, bumpMap: t, bumpScale: 0.4, roughness: 0.85 }); });
export const cinder = once(() => { const t = proc.speckle({ base: '#bab7b0', dots: '#6f6c66' }); t.repeat.set(4, 4); return new THREE.MeshStandardMaterial({ map: t, bumpMap: t, bumpScale: 0.6, roughness: 0.97 }); });
export const cushionCream = once(() => new THREE.MeshPhysicalMaterial({ color: 0xe8dfcc, roughness: 0.92, sheen: 0.5, sheenColor: new THREE.Color(0xffffff) }));
export const vinylShade = once(() => new THREE.MeshStandardMaterial({ color: 0xbdbdb8, roughness: 0.7 }));
export const ash = once(() => new THREE.MeshStandardMaterial({ map: proc.speckle({ base: '#6d6a66', dots: '#2a2826' }), roughness: 1 }));
export const charEnd = once(() => new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.9 }));

// ---------- Geometry helpers
// Recompute box-projected UVs (metres / tile) so wood grain runs along `axis` ('x'|'y'|'z'); off shifts the pattern.
export function woodUV(geo, axis = 'x', tile = 0.9, off = 0, across = 0.13) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv, P = {};
  for (let i = 0; i < p.count; i++) {
    P.x = p.getX(i); P.y = p.getY(i); P.z = p.getZ(i);
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const face = ax >= ay && ax >= az ? 'x' : ay >= az ? 'y' : 'z';
    let u, v;
    if (face === axis) { const [a, b] = ['x', 'y', 'z'].filter(k => k !== axis); u = P[a] * 0.4; v = P[b] * 6; }
    else { const o = ['x', 'y', 'z'].find(k => k !== axis && k !== face); u = P[o]; v = P[axis]; }
    uv.setXY(i, u / across + off * 3.1, v / tile + off * 0.37);
  }
  uv.needsUpdate = true; return geo;
}
// Board: rounded box with grain along `axis`.
export function board(w, h, d, mat, { axis = 'x', r = 0.004, off = 0, tile = 1.6, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0 } = {}) {
  const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2));
  woodUV(g, axis, tile, off); const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); return shadow(m);
}

// Lathe with metric UVs (u around, v along the profile) and a seam-averaged normal.
export function latheM(profile, mat, { seg = 48, tile = 0.3, x = 0, y = 0, z = 0, warp = null } = {}) {
  const pts = profile.map(([r, h]) => new THREE.Vector2(r, h));
  const g = new THREE.LatheGeometry(pts, seg);
  const np = pts.length, uv = g.attributes.uv, pos = g.attributes.position;
  let rmax = 0; for (const p of pts) rmax = Math.max(rmax, p.x);
  const U = Math.max(1, Math.round((2 * Math.PI * rmax) / tile));
  const cum = [0]; for (let j = 1; j < np; j++) cum.push(cum[j - 1] + pts[j].distanceTo(pts[j - 1]));
  for (let i = 0; i <= seg; i++) for (let j = 0; j < np; j++) uv.setXY(i * np + j, (i / seg) * U, cum[j] / tile);
  if (warp) { for (let k = 0; k < pos.count; k++) { const px = pos.getX(k), py = pos.getY(k), pz = pos.getZ(k); const r = Math.hypot(px, pz), phi = Math.atan2(px, pz); const [r2, y2] = warp(r, py, phi); const s = r > 1e-6 ? r2 / r : 1; pos.setXYZ(k, px * s, y2, pz * s); } g.computeVertexNormals(); }
  seamNormals(g, seg + 1, np);
  const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); return shadow(m);
}
// Average the normals of the duplicated first/last column of a (cols × rows) grid geometry (column-major).
function seamNormals(g, cols, rows, rowsWrap = false) {
  const n = g.attributes.normal, v = new THREE.Vector3(), w = new THREE.Vector3();
  for (let j = 0; j < rows; j++) { const a = j, b = (cols - 1) * rows + j; v.fromBufferAttribute(n, a); w.fromBufferAttribute(n, b); v.add(w).normalize(); n.setXYZ(a, v.x, v.y, v.z); n.setXYZ(b, v.x, v.y, v.z); }
  if (rowsWrap) for (let i = 0; i < cols; i++) { const a = i * rows, b = i * rows + rows - 1; v.fromBufferAttribute(n, a); w.fromBufferAttribute(n, b); v.add(w).normalize(); n.setXYZ(a, v.x, v.y, v.z); n.setXYZ(b, v.x, v.y, v.z); }
  n.needsUpdate = true;
}

// Ring shell: a closed wall of thickness t running all the way round, outer surface at outer(phi, y) -> [x, z]
// (phi = 0 is the front, +Z), with a rim height top(phi) and foot height bottom(phi); both rim and foot are rounded.
// Used for the wicker barrel chair (rim sweeps down at the front) and the moulded patio armchair (legs at corners).
export function ringShell({ outer, top, bottom, t = 0.05, nU = 96, nV = 18, nc = 6, botSquash = 0.4, tile = WEAVE_TILE }, mat) {
  const cols = nU + 1, sec = [];
  const nrm = (phi, y) => { const e = 1e-3, [x1, z1] = outer(phi - e, y), [x2, z2] = outer(phi + e, y); const tx = x2 - x1, tz = z2 - z1, l = Math.hypot(tx, tz) || 1; return [-tz / l, tx / l]; };
  const pos = [], uvs = [];
  let circ = 0; { const ym = (top(Math.PI) + bottom(Math.PI)) / 2; let [px, pz] = outer(-Math.PI, ym); for (let i = 1; i <= 64; i++) { const [x, z] = outer(-Math.PI + (i / 64) * 2 * Math.PI, ym); circ += Math.hypot(x - px, z - pz); px = x; pz = z; } }
  const U = Math.max(1, Math.round(circ / tile));
  let rows = 0;
  for (let i = 0; i < cols; i++) {
    const phi = -Math.PI + (i / nU) * 2 * Math.PI, b = bottom(phi), tp = top(phi), s = [];
    for (let j = 0; j <= nV; j++) s.push([0, b + (tp - b) * j / nV]);
    for (let k = 1; k < nc; k++) { const th = Math.PI * k / nc; s.push([t / 2 - (t / 2) * Math.cos(th), tp + (t / 2) * Math.sin(th)]); }
    for (let j = nV; j >= 0; j--) s.push([t, b + (tp - b) * j / nV]);
    for (let k = 1; k < nc; k++) { const th = Math.PI * k / nc; s.push([t / 2 + (t / 2) * Math.cos(th), b - (t / 2) * Math.sin(th) * botSquash]); }
    s.push(s[0]); rows = s.length;
    let cum = 0, prev = null;
    for (const [d, y] of s) {
      const [x, z] = outer(phi, y), [nx, nz] = nrm(phi, y), P = [x - d * nx, y, z - d * nz];
      if (prev) cum += Math.hypot(P[0] - prev[0], P[1] - prev[1], P[2] - prev[2]);
      pos.push(...P); uvs.push((i / nU) * U, cum / tile); prev = P;
    }
  }
  const idx = [];
  for (let i = 0; i < nU; i++) for (let j = 0; j < rows - 1; j++) { const a = i * rows + j, b2 = (i + 1) * rows + j, c = b2 + 1, d = a + 1; idx.push(a, b2, c, a, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(idx);
  g.computeVertexNormals(); seamNormals(g, cols, rows, true);
  return shadow(new THREE.Mesh(g, mat));
}

// A box strut between two points (legs, braces); w across x, d across z of the strut's own frame.
export function strut(a, b, w, d, mat, r = 0.003) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), dir = B.clone().sub(A), len = dir.length();
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, len, d, 2, r), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()); return shadow(m);
}

// Puffy throw pillow (superellipsoid; thin pinched edges, full centre). Lies in the XY plane, thickness along Z.
export function puffPillow(w, h, d, mat, { p = 0.28, seg = 28 } = {}) {
  const g = new THREE.SphereGeometry(1, seg, Math.round(seg * 0.75)); const pos = g.attributes.position;
  const f = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
  for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); pos.setXYZ(i, (w / 2) * f(x, p), (d / 2) * f(y, 0.85), (h / 2) * f(z, p)); }
  // sphere poles are on Y: we built thickness on Y, now rotate so thickness is along Z and height along Y.
  g.rotateX(Math.PI / 2); g.computeVertexNormals(); return shadow(new THREE.Mesh(g, mat));
}

// Round box cushion with a sewn welt: lathe profile (radius R, thickness h, slight domed top).
export function roundCushion(R, h, mat, { dome = 0.008, seg = 48 } = {}) {
  const e = Math.min(0.03, h * 0.3);
  const prof = [[0, 0], [R - e, 0], [R - e * 0.35, e * 0.12], [R, e * 0.7], [R + 0.004, h * 0.5], [R, h - e * 0.7], [R - e * 0.35, h - e * 0.12], [R - e, h], [R * 0.6, h + dome * 0.7], [0, h + dome]];
  const g = new THREE.Group();
  g.add(latheM(prof, mat, { seg, tile: 0.4 }));
  // welt cords at the top and bottom seams
  const t1 = new THREE.Mesh(new THREE.TorusGeometry(R - e * 0.35, 0.005, 6, seg), mat); t1.rotation.x = Math.PI / 2; t1.position.y = h - e * 0.12; g.add(shadow(t1));
  const t2 = t1.clone(); t2.position.y = e * 0.12; g.add(t2);
  return g;
}

// Alpha map for the fire sphere's spark screen: fine square wire mesh + birch-tree silhouettes (white = solid).
// u runs round the sphere, v = 1 - theta/pi (top of canvas = north pole).
export const fireScreenAlpha = once(() => {
  const W = 2048, H = 1024, [c, g] = canvas(W, H), r = rng(41);
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#fff'; g.lineWidth = 1.6; g.beginPath();
  for (let x = 0; x < W; x += 5) { g.moveTo(x, 0); g.lineTo(x, H); }
  for (let y = 0; y < H; y += 5) { g.moveTo(0, y); g.lineTo(W, y); }
  g.stroke();
  // trees: trunks from the bowl rim (theta ~ 122 deg) up towards the pole, slight lean, forked branches
  g.strokeStyle = '#fff'; g.lineCap = 'round';
  const yBot = (122 / 180) * H, n = 14;
  for (let k = 0; k < n; k++) {
    const x0 = (k + 0.2 + r() * 0.6) * (W / n), top = (14 + r() * 22) / 180 * H, lean = (r() - 0.5) * 60;
    g.lineWidth = 9 + r() * 7; g.beginPath(); g.moveTo(x0, yBot); g.bezierCurveTo(x0 + lean * 0.2, yBot - (yBot - top) * 0.4, x0 + lean, yBot - (yBot - top) * 0.7, x0 + lean * 1.2, top); g.stroke();
    for (let b = 0; b < 4; b++) {
      const t = 0.35 + r() * 0.5, by = yBot - (yBot - top) * t, bx = x0 + lean * t, side = r() > 0.5 ? 1 : -1, len = 40 + r() * 70;
      g.lineWidth = 3 + r() * 3; g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo(bx + side * len * 0.5, by - len * 0.2, bx + side * len, by - len * 0.9); g.stroke();
    }
  }
  // solid strip along the upper rim of the bowl and around the equator flange
  g.fillStyle = '#fff'; g.fillRect(0, yBot - 4, W, 14); g.fillRect(0, H / 2 - 10, W, 20);
  return texOf(c, { srgb: false });
});
export const fireScreen = once(() => new THREE.MeshStandardMaterial({ color: 0x1f1f1f, roughness: 0.6, metalness: 0.45, alphaMap: fireScreenAlpha(), transparent: true, side: THREE.DoubleSide, depthWrite: false }));

// Perforated sconce face (terrazzo-like random cut-outs; white = metal).
export const sconceAlpha = once(() => {
  const W = 128, H = 296, [c, g] = canvas(W, H), r = rng(77); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.fillStyle = '#000';
  for (let i = 0; i < 260; i++) { const x = 8 + r() * (W - 16), y = 10 + r() * (H - 20), a = 2 + r() * 4.5, b = 1.5 + r() * 3; g.beginPath(); g.ellipse(x, y, a, b, r() * Math.PI, 0, Math.PI * 2); g.fill(); }
  return texOf(c, { srgb: false });
});
