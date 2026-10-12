// kitchen_parts — helpers, local materials and canvas textures for kitchen.js (2513 Croton Ave, 2025 remodel).
// Shaker fronts, bar pulls, tile panels, world-scaled UVs, per-material mesh merging, appliance builders.
import { THREE, M, box, cyl, lathe, extrude, tube, plane, group } from '../kit.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ---------- shared dimensions (metres) ----------
export const TOP = 0.92;        // counter top height
export const CT = 0.03;         // quartz thickness
export const KICK = 0.10;       // toe-kick height (wall runs)
export const DT = 0.019;        // door / drawer front thickness
export const REV = 0.0035;      // reveal between fronts
export const FRAME = 0.07;      // shaker frame width
export const RECESS = 0.012;    // shaker centre-panel recess
export const PULL = 0.16;       // bar-pull length
export const UP_D = 0.33, UP_Y0 = 1.50, UP_Y1 = 2.40;

// ---------- deterministic helpers ----------
export function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const once = (fn) => { let v; return () => (v ??= fn()); };
function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function ctex(c, { srgb = true, repeat = 1 } = {}) {
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------- canvas textures ----------
// Height map for the square tile grid of M.tileBlack (proc.tileGrid n=6 on 512 px): grout low, tile faces high
// with a soft wavy (handmade/zellige) surface so reflections break up like the real glossy tiles.
function tileHeight(n = 6, seed = 5) {
  const W = 512, [c, g] = cv(W, W), r = rng(seed), s = W / n, gap = Math.max(2, s * 0.045);
  g.fillStyle = '#000'; g.fillRect(0, 0, W, W);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const x0 = x * s + gap / 2, y0 = y * s + gap / 2, w = s - gap;
    g.fillStyle = '#c8c8c8'; g.fillRect(x0, y0, w, w);
    g.fillStyle = '#ffffff'; g.fillRect(x0 + 3, y0 + 3, w - 6, w - 6);
    for (let k = 0; k < 5; k++) { // soft undulations
      const cx = x0 + r() * w, cy = y0 + r() * w, rad = w * (0.2 + r() * 0.35);
      const grd = g.createRadialGradient(cx, cy, 1, cx, cy, rad); const a = 0.10 + r() * 0.12;
      grd.addColorStop(0, `rgba(${r() > 0.5 ? '0,0,0' : '255,255,255'},${a})`); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.save(); g.beginPath(); g.rect(x0 + 3, y0 + 3, w - 6, w - 6); g.clip(); g.fillStyle = grd; g.fillRect(x0, y0, w, w); g.restore();
    }
  }
  return ctex(c, { srgb: false });
}
// Vertical stacked finger tile (behind the range and around the window): 32 cols × 6 rows per texture (≈0.028 × 0.152).
function fingerTile(height = false) {
  const W = 1024, [c, g] = cv(W, W), r = rng(height ? 17 : 17), cols = 32, rows = 6, sw = W / cols, sh = W / rows, gap = 4;
  g.fillStyle = height ? '#000' : '#cfcbc3'; g.fillRect(0, 0, W, W);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const x0 = x * sw + gap / 2, y0 = y * sh + gap / 2, w = sw - gap, h = sh - gap, v = (r() - 0.5);
    if (height) {
      const grd = g.createLinearGradient(x0, 0, x0 + w, 0); grd.addColorStop(0, '#9a9a9a'); grd.addColorStop(0.18, '#ffffff'); grd.addColorStop(0.82, '#ffffff'); grd.addColorStop(1, '#9a9a9a');
      g.fillStyle = grd; g.fillRect(x0, y0, w, h);
    } else {
      const base = 30 + v * 14; g.fillStyle = `rgb(${base},${base + 2},${base + 6})`; g.fillRect(x0, y0, w, h);
      const grd = g.createLinearGradient(0, y0, 0, y0 + h); grd.addColorStop(0, 'rgba(255,255,255,0.10)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.0)'); grd.addColorStop(1, 'rgba(0,0,0,0.12)');
      g.fillStyle = grd; g.fillRect(x0, y0, w, h);
    }
  }
  return ctex(c, { srgb: !height });
}
// Rush / seagrass cord weave as on the stools: concentric rings of twisted cord meeting on the diagonals.
// aspect = width/height of the woven area (1 for the seat, ~2.7 for the back band).
function rushTex(aspect = 1, height = false, seed = 9, rope = 19) {
  const H = 384, W = Math.round(H * aspect), [c, g] = cv(W, H), img = g.createImageData(W, H), d = img.data, r = rng(seed);
  const hw = W / 2, hh = H / 2, period = rope, shade = [];
  for (let i = 0; i < 200; i++) shade.push(0.8 + r() * 0.32);
  const A = [222, 176, 108], B = [163, 116, 60], D = [72, 47, 22];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x + 0.5 - hw, dy = y + 0.5 - hh, a = Math.abs(dx) - (hw - hh), b = Math.abs(dy);
    const vert = a > b, coord = Math.max(0, vert ? a : b), along = vert ? y : x;
    const ring = Math.floor(coord / period), f = (coord % period) / period;
    const across = Math.pow(Math.sin(f * Math.PI), 0.7);                    // round cord profile
    // three twisted plies: bright diagonal bands repeating ~1 cord width along the cord
    const twist = 0.5 + 0.5 * Math.cos(((along + f * period * (vert ? 1 : -1)) / period) * Math.PI * 2 * 1.5 + ring * 1.3);
    let t = across * (0.5 + 0.5 * twist);
    const seam = Math.max(0, 1 - Math.abs(a - b) / 3);                     // diagonal seam where the rings turn
    t *= 1 - seam * 0.5;
    const i = (y * W + x) * 4;
    if (height) { const v = Math.round(255 * t); d[i] = d[i + 1] = d[i + 2] = v; }
    else {
      const k = shade[ring % shade.length];
      const col = t > 0.45 ? B.map((v, j) => v + (A[j] - v) * (t - 0.45) / 0.55) : D.map((v, j) => v + (B[j] - v) * t / 0.45);
      d[i] = Math.min(255, col[0] * k); d[i + 1] = Math.min(255, col[1] * k); d[i + 2] = Math.min(255, col[2] * k);
    }
    d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return ctex(c, { srgb: !height });
}
// Black glass ceramic cooktop 0.78 × 0.56: four burner rings (two large, two small) and faint printing.
function cooktopTex() {
  const W = 780, H = 560, [c, g] = cv(W, H); g.fillStyle = '#060708'; g.fillRect(0, 0, W, H);
  const ring = (x, y, R) => { g.strokeStyle = 'rgba(190,190,190,0.55)'; g.lineWidth = 2.2; g.beginPath(); g.arc(x, y, R, 0, 7); g.stroke(); g.lineWidth = 1.2; g.strokeStyle = 'rgba(190,190,190,0.35)'; g.beginPath(); g.arc(x, y, R * 0.62, 0, 7); g.stroke(); g.beginPath(); g.moveTo(x - 6, y); g.lineTo(x + 6, y); g.moveTo(x, y - 6); g.lineTo(x, y + 6); g.stroke(); };
  ring(195, 395, 125); ring(205, 130, 85); ring(585, 140, 110); ring(580, 400, 85);
  g.fillStyle = 'rgba(200,200,200,0.4)'; g.font = '16px sans-serif'; g.fillText('HOT SURFACE', 345, 545); g.strokeStyle = 'rgba(200,200,200,0.3)'; g.strokeRect(12, 12, W - 24, H - 24);
  return ctex(c);
}
// Matte black chalk-paint panel above the microwave (owner's "chalkboard"): blank, with faint erased-chalk haze.
function chalkPanelTex() {
  const W = 512, H = 256, [c, g] = cv(W, H), r = rng(31); g.fillStyle = '#1d1f21'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 9; i++) {
    const x = r() * W, y = r() * H, rad = 40 + r() * 110, grd = g.createRadialGradient(x, y, 2, x, y, rad);
    grd.addColorStop(0, `rgba(235,235,230,${0.025 + r() * 0.03})`); grd.addColorStop(1, 'rgba(235,235,230,0)'); g.fillStyle = grd; g.fillRect(0, 0, W, H);
  }
  g.strokeStyle = 'rgba(230,230,225,0.035)'; g.lineWidth = 14; g.lineCap = 'round';
  for (let i = 0; i < 6; i++) { g.beginPath(); const y = 40 + r() * 180; g.moveTo(30 + r() * 80, y); g.quadraticCurveTo(250, y + (r() - 0.5) * 60, 400 + r() * 90, y + (r() - 0.5) * 40); g.stroke(); }
  return ctex(c);
}
// Small blue/white LED display (range clock, microwave, oven).
function displayTex(text = '10:43') {
  const [c, g] = cv(256, 64); g.fillStyle = '#020203'; g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#e8f4ff'; g.font = 'bold 40px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 34);
  g.fillStyle = 'rgba(200,220,255,0.5)'; g.font = '10px sans-serif'; for (let i = 0; i < 4; i++) g.fillText('•', 20 + i * 8, 54);
  return ctex(c);
}
// Touch-pad printing for the microwave / wall oven strip: two rows of tiny white glyphs.
function keypadTex() {
  const [c, g] = cv(512, 64); g.fillStyle = '#050506'; g.fillRect(0, 0, 512, 64); g.fillStyle = 'rgba(235,235,235,0.75)'; g.font = '11px sans-serif'; g.textAlign = 'center';
  const labels = ['START', 'STOP', 'TIMER', 'COOK', 'BAKE', 'BROIL', 'LIGHT', 'POP', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
  labels.forEach((t, i) => g.fillText(t, 30 + (i % 9) * 56, i < 9 ? 24 : 50));
  g.fillStyle = '#8fd0ff'; g.font = 'bold 18px monospace'; g.fillText('21:06', 256, 40);
  return ctex(c);
}

// ---------- local materials (created once, shared) ----------
export const L = {
  tileSq: once(() => { const m = M.tileBlack().clone(); m.bumpMap = tileHeight(); m.bumpScale = 1.2; m.roughness = 0.42; m.clearcoat = 0.35; m.clearcoatRoughness = 0.3; m.color.set(0xb8b8b8); return m; }),   // matte-black finish
  tileFinger: once(() => new THREE.MeshPhysicalMaterial({ map: fingerTile(), bumpMap: fingerTile(true), bumpScale: 1.2, roughness: 0.38, clearcoat: 0.4, clearcoatRoughness: 0.25 })),
  glassBlack: once(() => new THREE.MeshPhysicalMaterial({ color: 0x07080a, roughness: 0.06, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.04 })),
  cooktop: once(() => new THREE.MeshPhysicalMaterial({ map: cooktopTex(), roughness: 0.08, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03 })),
  stainlessBlack: once(() => new THREE.MeshStandardMaterial({ color: 0x3c3d40, roughness: 0.3, metalness: 0.9 })),
  innerDark: once(() => new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.6, metalness: 0.3 })),
  display: once(() => { const t = displayTex('10:43'); return new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.9, roughness: 0.2 }); }),
  keypad: once(() => { const t = keypadTex(); return new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.35, roughness: 0.15 }); }),
  sinkComposite: once(() => new THREE.MeshStandardMaterial({ color: 0x2b2c2e, roughness: 0.55, metalness: 0.05 })),   // charcoal granite composite
  slatBack: once(() => new THREE.MeshStandardMaterial({ color: 0x3e3123, roughness: 0.9 })),
  teak: once(() => { const m = M.oak().clone(); m.color.set(0xf3b878); m.roughness = 0.6; return m; }),
  rushSeat: once(() => new THREE.MeshStandardMaterial({ map: rushTex(1), bumpMap: rushTex(1, true), bumpScale: 4, roughness: 0.92 })),
  rushBack: once(() => new THREE.MeshStandardMaterial({ map: rushTex(2.5, false, 13, 44), bumpMap: rushTex(2.5, true, 13, 44), bumpScale: 4, roughness: 0.92 })),
  stoneware: once(() => { const m = M.ceramicSpeckle().clone(); m.color.set(0xbcb5a8); m.bumpMap = m.map; m.bumpScale = 1.5; m.roughness = 0.85; return m; }),
  led: once(() => new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0d8, emissiveIntensity: 2, roughness: 0.5 })),
  ledSmall: once(() => new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 1.2, roughness: 0.5 })),
  stem: once(() => new THREE.MeshStandardMaterial({ color: 0x9c946a, roughness: 0.9 })),
  plume: once(() => new THREE.MeshStandardMaterial({ color: 0xd8c7a2, roughness: 1 })),
  cork: once(() => new THREE.MeshStandardMaterial({ color: 0xb48a5a, roughness: 0.95 })),
  oil: once(() => new THREE.MeshPhysicalMaterial({ color: 0xb08a1e, roughness: 0.1, transparent: true, opacity: 0.6, depthWrite: false })),
  bottleGlass: once(() => new THREE.MeshPhysicalMaterial({ color: 0xe6efe9, roughness: 0.04, transparent: true, opacity: 0.28, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide })),
  grille: once(() => new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.8 })),
  hoodSteel: once(() => new THREE.MeshStandardMaterial({ color: 0x6a6d71, roughness: 0.3, metalness: 0.9 })),   // stainless hood, reads dark against the finger tile (g12)
  fridgeSlate: once(() => new THREE.MeshPhysicalMaterial({ color: 0x55585d, roughness: 0.34, metalness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.3 })),   // slate / black-stainless fridge (g13, g18)
  chalk: once(() => new THREE.MeshStandardMaterial({ map: chalkPanelTex(), roughness: 0.95 })),
  ventWhite: once(() => new THREE.MeshStandardMaterial({ color: 0xe9e9e6, roughness: 0.5, metalness: 0.3 })),
};

// ---------- geometry utilities ----------
// Replace a mesh's UVs with world-scaled box-projected coordinates (metres × k), so wood grain and tile grids keep
// their real size on any part. `grain` = the axis texture-v follows where possible (wood grain is along v).
export function wuv(m, k = 1, grain = 'y', off = null) {
  const g = m.geometry, p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  const o = off ?? [m.position.x, m.position.y, m.position.z], gi = 'xyz'.indexOf(grain);
  for (let i = 0; i < p.count; i++) {
    const P = [p.getX(i) + o[0], p.getY(i) + o[1], p.getZ(i) + o[2]], N = [Math.abs(n.getX(i)), Math.abs(n.getY(i)), Math.abs(n.getZ(i))];
    const a = N[0] >= N[1] && N[0] >= N[2] ? 0 : N[1] >= N[2] ? 1 : 2, others = [0, 1, 2].filter(j => j !== a);
    let ui, vi; if (others.includes(gi)) { vi = gi; ui = others.find(j => j !== gi); } else [ui, vi] = others;
    uv[i * 2] = P[ui] * k; uv[i * 2 + 1] = P[vi] * k;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return m;
}
// Merge all meshes under root into one mesh per material (fewer draw calls; identical look). Objects flagged
// userData.keep stay separate.
export function bake(root) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert(), byMat = new Map(), keep = [];
  root.traverse(o => {
    if (o.userData.keep && o !== root) { keep.push(o); return; }
    if (!o.isMesh || keep.some(k => isAncestor(k, o))) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.clearGroups(); g.morphAttributes = {};
    if (!byMat.has(o.material)) byMat.set(o.material, []); byMat.get(o.material).push(g);
  });
  for (const k of keep) root.attach(k);
  for (const ch of [...root.children]) if (!keep.includes(ch)) root.remove(ch);
  for (const [mat, gs] of byMat) { const m = new THREE.Mesh(mergeGeometries(gs, false), mat); m.castShadow = m.receiveShadow = true; m.name = mat.name || 'part'; root.add(m); }
  return root;
}
function isAncestor(a, o) { for (let p = o.parent; p; p = p.parent) if (p === a) return true; return false; }
// Rounded-rectangle outline (for extrude) centred on (cx, cy).
export function rrect(w, h, r, cx = 0, cy = 0, n = 4) {
  const pts = [], cs = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, Math.PI / 2], [-w / 2 + r, -h / 2 + r, Math.PI], [w / 2 - r, -h / 2 + r, Math.PI * 1.5]];
  for (const [x, y, a0] of cs) for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * Math.PI / 2; pts.push([cx + x + Math.cos(a) * r, cy + y + Math.sin(a) * r]); }
  return pts;
}
// Frustum (flat-shaded) from a bottom rectangle to a top rectangle; rects = {x0,x1,z0,z1}.
export function frustum(b, t, y0, y1, mat) {
  const v = [[b.x0, y0, b.z0], [b.x1, y0, b.z0], [b.x1, y0, b.z1], [b.x0, y0, b.z1], [t.x0, y1, t.z0], [t.x1, y1, t.z0], [t.x1, y1, t.z1], [t.x0, y1, t.z1]];
  const f = [[0, 1, 2, 3], [7, 6, 5, 4], [3, 2, 6, 7], [1, 0, 4, 5], [0, 3, 7, 4], [2, 1, 5, 6]], pos = [];
  for (const [a, b2, c, d] of f) pos.push(...v[a], ...v[b2], ...v[c], ...v[a], ...v[c], ...v[d]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
  const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; return m;
}

// ---------- cabinetry ----------
// Square-section matte-black bar pull (0.16 m) on two posts; built at origin standing off +Z from the front face.
export function barPull(dir = 'h', len = PULL) {
  const mat = M.blackMatte(), g = new THREE.Group(), bar = 0.012, post = 0.03;
  if (dir === 'h') {
    g.add(box(len, bar, bar, mat, { r: 0.002, seg: 1, z: post + bar / 2 }));
    for (const s of [-1, 1]) g.add(box(0.01, 0.01, post, mat, { x: s * (len / 2 - 0.008), z: post / 2 }));
  } else {
    g.add(box(bar, len, bar, mat, { r: 0.002, seg: 1, z: post + bar / 2 }));
    for (const s of [-1, 1]) g.add(box(0.01, 0.01, post, mat, { y: s * (len / 2 - 0.008), z: post / 2 }));
  }
  return g;
}
// Shaker front w × h: 0.07 frame (narrower on small drawers), centre panel recessed 0.012. Back face on z = 0.
// pull: {dir:'h'|'v', x, y} relative to the front centre, or null.
export function shaker(w, h, pull = null, mat = M.cabinetWhite()) {
  const g = new THREE.Group(), f = Math.min(FRAME, w * 0.22, h * 0.24), r = 0.0022;
  g.add(box(f, h, DT, mat, { r, seg: 1, x: -w / 2 + f / 2, z: DT / 2 }));
  g.add(box(f, h, DT, mat, { r, seg: 1, x: w / 2 - f / 2, z: DT / 2 }));
  g.add(box(w - 2 * f + 0.002, f, DT, mat, { r, seg: 1, y: h / 2 - f / 2, z: DT / 2 }));
  g.add(box(w - 2 * f + 0.002, f, DT, mat, { r, seg: 1, y: -h / 2 + f / 2, z: DT / 2 }));
  g.add(box(w - 2 * f + 0.004, h - 2 * f + 0.004, DT - RECESS, mat, { z: (DT - RECESS) / 2 }));
  if (pull) { const p = barPull(pull.dir, pull.len ?? PULL); p.position.set(pull.x ?? 0, pull.y ?? 0, DT); g.add(p); }
  return g;
}
// Slab (flat) front, used for false fronts above sinks is still shaker in this kitchen; kept for panels.
export function slab(w, h, mat = M.cabinetWhite()) { return box(w, h, DT, mat, { r: 0.002, seg: 1, z: DT / 2 }); }

// A bank of fronts filling x0..x1, y0..y1 on the plane z = face, facing +Z.
// rows (top → bottom): { h, kind: 'drawer'|'false'|'doors'|'door', hinge: 'l'|'r' } — a row without h takes the rest.
// base = true: door pulls near the top; false (uppers): near the bottom.
export function fronts(parent, x0, x1, y0, y1, face, rows, { base = true } = {}) {
  const fixed = rows.reduce((s, r) => s + (r.h ?? 0), 0), flex = rows.filter(r => !r.h).length;
  const restH = (y1 - y0 - fixed) / Math.max(1, flex);
  let y = y1;
  for (const row of rows) {
    const h = row.h ?? restH, ya = y - h, w = x1 - x0, cy = (y + ya) / 2;
    const fh = h - REV;
    if (row.kind === 'drawer' || row.kind === 'false') {
      const fr = shaker(w - REV, fh, row.kind === 'drawer' ? { dir: 'h', y: row.pullY ?? 0, len: Math.min(PULL, Math.round(w * 0.6 / 0.01) * 0.01) } : null);
      fr.position.set((x0 + x1) / 2, cy, face); parent.add(fr);
    } else {
      const n = row.kind === 'doors' ? 2 : 1, dw = w / n;
      for (let i = 0; i < n; i++) {
        const xa = x0 + i * dw, hingeLeft = n === 2 ? i === 0 : (row.hinge ?? 'l') === 'l';
        const px = (hingeLeft ? 1 : -1) * (dw / 2 - Math.min(FRAME, dw * 0.22) / 2);
        const py = base ? fh / 2 - 0.05 - PULL / 2 : -fh / 2 + 0.05 + PULL / 2;
        const fr = shaker(dw - REV, fh, { dir: 'v', x: px, y: py }); fr.position.set(xa + dw / 2, cy, face); parent.add(fr);
      }
    }
    y = ya;
  }
}
// Tile panel on a wall plane (back face at zWall), world-scaled grid aligned to (ux, vy).
export function tile(x0, x1, y0, y1, zWall, kind = 'sq', origin = [0, TOP]) {
  const mat = kind === 'sq' ? L.tileSq() : L.tileFinger(), k = 1 / 0.912;   // 6" (0.152) squares and 0.152-tall fingers on one grid (g12)
  const m = box(x1 - x0, y1 - y0, 0.008, mat, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: zWall + 0.004 });
  return wuv(m, k, 'y', [(x0 + x1) / 2 - origin[0], (y0 + y1) / 2 - origin[1], 0]);
}
// Quartz slab between x0..x1 / z0..z1 with an optional rounded hole {x0,x1,z0,z1}; square edge, eased 2 mm.
export function quartz(x0, x1, z0, z1, y0 = TOP - CT, hole = null) {
  const b = 0.002;
  const outline = [[x0 + b, -z1 + b], [x1 - b, -z1 + b], [x1 - b, -z0 - b], [x0 + b, -z0 - b]];
  const holes = hole ? [rrect(hole.x1 - hole.x0 + 2 * b, hole.z1 - hole.z0 + 2 * b, 0.02, (hole.x0 + hole.x1) / 2, -(hole.z0 + hole.z1) / 2).reverse()] : [];
  return extrude(outline, CT - 2 * b, M.quartz(), { bevel: b, rx: -Math.PI / 2, y: y0 + b, holes });
}

// ---------- appliances ----------
// Slide-in electric range 0.76 w: glass cooktop, front controls (4 knobs + display), black oven door, drawer.
export function range(cx, frontZ, backZ) {
  const g = new THREE.Group(), w = 0.76, bm = M.blackAppliance(), d = frontZ - backZ;
  g.add(box(w - 0.004, 0.86, d - 0.03, bm, { x: cx, y: 0.03, z: backZ + (d - 0.03) / 2, bottom: true }));
  // cooktop glass sits slightly proud of the counters and overlaps them by 8 mm
  const top = box(w + 0.016, 0.012, d - 0.03, L.cooktop(), { r: 0.003, seg: 1, x: cx, y: TOP - 0.004, z: backZ + (d - 0.03) / 2, bottom: true });
  // cooktop texture covers the top face once
  g.add(top);
  // front control fascia (slightly angled), knobs left/right, clock in the middle
  const fas = box(w - 0.004, 0.075, 0.045, L.stainlessBlack(), { r: 0.006, seg: 2, x: cx, y: TOP - 0.045, z: frontZ - 0.025, rx: -0.18 }); g.add(fas);
  for (const sx of [-0.31, -0.25, 0.25, 0.31]) {
    g.add(cyl(0.019, 0.021, 0.026, L.stainlessBlack(), { seg: 20, x: cx + sx, y: TOP - 0.048, z: frontZ + 0.006, rx: Math.PI / 2 }));
    g.add(box(0.004, 0.022, 0.006, M.blackMatte(), { x: cx + sx, y: TOP - 0.048, z: frontZ + 0.02 }));
  }
  g.add(plane(0.07, 0.022, L.display(), { x: cx - 0.08, y: TOP - 0.042, z: frontZ + 0.0, rx: -0.18 }));
  g.add(plane(0.16, 0.03, L.keypad(), { x: cx + 0.07, y: TOP - 0.045, z: frontZ - 0.001, rx: -0.18 }));
  // oven door: black glass front with darker window, stainless-black handle on stand-offs
  const doorY0 = 0.17, doorY1 = TOP - 0.09;
  g.add(box(w - 0.01, doorY1 - doorY0, 0.03, bm, { r: 0.006, seg: 2, x: cx, y: doorY0, z: frontZ - 0.035, bottom: true }));
  g.add(box(w - 0.05, doorY1 - doorY0 - 0.12, 0.004, L.glassBlack(), { x: cx, y: doorY0 + 0.04, z: frontZ - 0.018, bottom: true }));
  g.add(box(0.46, 0.25, 0.002, L.innerDark(), { x: cx, y: doorY0 + 0.16, z: frontZ - 0.0155, bottom: true }));
  g.add(cyl(0.011, 0.011, w - 0.12, L.stainlessBlack(), { seg: 16, x: cx, y: doorY1 - 0.045, z: frontZ + 0.03, rz: Math.PI / 2 }));
  for (const s of [-1, 1]) g.add(cyl(0.008, 0.008, 0.05, L.stainlessBlack(), { seg: 12, x: cx + s * (w / 2 - 0.09), y: doorY1 - 0.045, z: frontZ + 0.005, rx: Math.PI / 2 }));
  // storage drawer + kick
  g.add(box(w - 0.01, 0.12, 0.025, bm, { r: 0.004, seg: 1, x: cx, y: 0.035, z: frontZ - 0.035, bottom: true }));
  g.add(box(w - 0.1, 0.012, 0.012, L.stainlessBlack(), { r: 0.003, seg: 1, x: cx, y: 0.135, z: frontZ - 0.012 }));
  g.add(box(w - 0.02, 0.035, 0.02, L.grille(), { x: cx, y: 0, z: frontZ - 0.07, bottom: true }));
  return g;
}
// Under-cabinet black range hood 0.76 × 0.50 deep at 1.65-1.90: flat canopy lip + sloped pyramid body.
export function hood(cx, backZ, bm = M.blackAppliance()) {
  const g = new THREE.Group(), w = 0.76, d = 0.5;
  g.add(box(w, 0.06, d, bm, { r: 0.004, seg: 1, x: cx, y: 1.65, z: backZ + d / 2, bottom: true }));
  g.add(frustum({ x0: cx - w / 2 + 0.005, x1: cx + w / 2 - 0.005, z0: backZ, z1: backZ + d - 0.01 }, { x0: cx - w / 2 + 0.04, x1: cx + w / 2 - 0.04, z0: backZ, z1: backZ + 0.3 }, 1.71, 1.90, bm));
  // underside baffle filters + two LED lamps; front button strip
  for (const s of [-1, 1]) g.add(box(0.3, 0.004, 0.36, M.steel(), { x: cx + s * 0.17, y: 1.648, z: backZ + 0.25 }));
  for (const s of [-1, 1]) {
    const lamp = cyl(0.022, 0.022, 0.004, L.ledSmall(), { seg: 16, x: cx + s * 0.25, y: 1.646, z: backZ + 0.45 });
    lamp.userData.lightFixture = { name: `Range hood lamp ${s < 0 ? 1 : 2}`, zh: `抽油烟机灯 ${s < 0 ? 1 : 2}` }; g.add(lamp);
    lamp.userData.keep = true;
  }
  g.add(box(0.12, 0.016, 0.003, L.stainlessBlack(), { x: cx, y: 1.68, z: backZ + d + 0.0015 }));
  for (let i = 0; i < 4; i++) g.add(cyl(0.0035, 0.0035, 0.003, L.ledSmall(), { seg: 8, x: cx - 0.045 + i * 0.03, y: 1.68, z: backZ + d + 0.003, rx: Math.PI / 2 }));
  return g;
}
// Built-in dishwasher, black front 0.60 w: control lip on top, pocket handle, kick plate.
export function dishwasher(cx, frontZ, backZ) {
  const g = new THREE.Group(), w = 0.6, bm = M.blackAppliance();
  g.add(box(w - 0.01, 0.78, frontZ - backZ - 0.04, L.innerDark(), { x: cx, y: KICK, z: backZ + (frontZ - backZ - 0.04) / 2, bottom: true }));
  g.add(box(w - 0.006, 0.72, 0.03, bm, { r: 0.004, seg: 2, x: cx, y: KICK + 0.003, z: frontZ - 0.015, bottom: true }));
  g.add(box(w - 0.006, 0.055, 0.03, bm, { r: 0.004, seg: 2, x: cx, y: KICK + 0.728, z: frontZ - 0.016, bottom: true }));
  g.add(box(0.24, 0.022, 0.012, L.innerDark(), { x: cx, y: KICK + 0.735, z: frontZ + 0.002, bottom: true }));
  g.add(box(0.2, 0.006, 0.004, L.stainlessBlack(), { x: cx, y: KICK + 0.745, z: frontZ + 0.009 }));
  g.add(plane(0.12, 0.016, L.keypad(), { x: cx + 0.19, y: KICK + 0.755, z: frontZ + 0.0005 }));
  g.add(box(w - 0.02, KICK - 0.01, 0.015, L.grille(), { x: cx, y: 0.005, z: frontZ - 0.06, bottom: true }));
  return g;
}
export { group };
