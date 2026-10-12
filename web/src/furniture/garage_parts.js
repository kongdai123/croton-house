// garage_parts — local materials, canvas textures and small sub-assemblies for the garage module (garage.js).
// Refs: source/zillow/gallery g48, g49 (garage interior), g04 (front elevation, door open). Units metres.
import { THREE, box as kitBox, cyl, lathe, tube, sphere, extrude } from '../kit.js';
import { pbr } from '../materials.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvasTex, grainTex, retile, rod, once, PI } from './bath_parts.js';

export { PI, rod, retile, once };
// kit box with a one-segment eased edge by default (small hardware); pass seg: 3 where the rounding is large enough to see
export const box = (w, h, d, mat, o = {}) => kitBox(w, h, d, mat, { seg: 1, ...o });
// merge meshes (one material) into a single mesh; rounded boxes are non-indexed, so everything is de-indexed first
export function merged(meshes, mat) {
  const geos = meshes.map(m => { m.updateMatrix(); const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone(); return g.applyMatrix4(m.matrix); });
  const mesh = new THREE.Mesh(mergeGeometries(geos), mat); mesh.castShadow = mesh.receiveShadow = true; return mesh;
}
export function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// collapse every mesh under root into one mesh per material (hardware-heavy items: fewer draw calls)
export function bake(root) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert(), groups = new Map(), meshes = [];
  root.traverse(m => { if (m.isMesh) meshes.push(m); });
  for (const m of meshes) {
    const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!groups.has(m.material)) groups.set(m.material, []);
    groups.get(m.material).push(g);
  }
  root.clear();
  for (const [mat, geos] of groups) { const mesh = new THREE.Mesh(mergeGeometries(geos), mat); mesh.castShadow = mesh.receiveShadow = true; root.add(mesh); }
  return root;
}

// rounded rectangle outline [[x,y]...] (counter-clockwise), `n` points per corner, `sub` extra points per straight edge
export function rrect(x0, y0, x1, y1, r, n = 6, sub = 0) {
  const pts = [], c = [[x1 - r, y0 + r, -PI / 2], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, PI / 2], [x0 + r, y0 + r, PI]];
  const next = [[x1, y1 - r], [x0 + r, y1], [x0, y0 + r], [x1 - r, y0]];
  c.forEach(([cx, cy, a0], k) => {
    for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * PI / 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    const last = pts[pts.length - 1], end = next[k];
    for (let i = 1; i <= sub; i++) { const t = i / (sub + 1); pts.push([last[0] + (end[0] - last[0]) * t, last[1] + (end[1] - last[1]) * t]); }
  });
  return pts;
}
// outline offset outward by d (counter-clockwise polygon)
export function offsetPoly(pts, d) {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const n1 = [p[1] - a[1], -(p[0] - a[0])], n2 = [b[1] - p[1], -(b[0] - p[0])];
    const l1 = Math.hypot(...n1) || 1, l2 = Math.hypot(...n2) || 1, nx = n1[0] / l1 + n2[0] / l2, ny = n1[1] / l1 + n2[1] / l2, l = Math.hypot(nx, ny) || 1;
    return [p[0] + nx / l * d, p[1] + ny / l * d];
  });
}

// copy a material and give its alpha map its own tiling (keyhole slots, perforations)
export function withAlpha(mat, alpha, rx, ry) {
  const m = mat.clone(); const t = alpha.clone(); t.repeat.set(rx, ry); t.needsUpdate = true;
  m.alphaMap = t; m.alphaTest = 0.5; m.side = THREE.DoubleSide; return m;
}

// flat-shaded ribbon: a 2-D profile [[y,z],...] swept straight along X from x0 to x1 (sheet-metal skins)
export function sweepX(pts, x0, x1, mat) {
  const pos = [], uv = []; let v = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ya, za] = pts[i], [yb, zb] = pts[i + 1], l = Math.hypot(yb - ya, zb - za);
    pos.push(x0, ya, za, x1, ya, za, x1, yb, zb, x0, ya, za, x1, yb, zb, x0, yb, zb);
    uv.push(0, v, 1, v, 1, v + l, 0, v, 1, v + l, 0, v + l); v += l;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; return m;
}

// ---------- canvas textures ----------
const noise = (seed, { base = 128, amp = 50, n = 9000, size = 256, blob = 2, rep = 1 } = {}) => canvasTex(size, size, (g, W, H) => {
  const r = rng(seed); g.fillStyle = `rgb(${base},${base},${base})`; g.fillRect(0, 0, W, H);
  for (let i = 0; i < n; i++) { const v = Math.round(base + (r() - 0.5) * 2 * amp); g.fillStyle = `rgba(${v},${v},${v},0.5)`; const s = blob * (0.5 + r()); g.fillRect(r() * W, r() * H, s, s); }
}, { srgb: false, repeat: [rep, rep] });

// keyhole slot (boltless rivet shelving) — white = metal, black = hole; one slot per tile
const keyholeAlpha = once(() => canvasTex(64, 64, (g) => { g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#000'; g.beginPath(); g.arc(32, 42, 6.5, 0, 7); g.fill(); g.fillRect(29.5, 18, 5, 24); g.beginPath(); g.arc(32, 18, 2.5, 0, 7); g.fill(); }, { srgb: false }));
// perforated angle (opener hangers, track hangers): round + slotted holes
const perfAlpha = once(() => canvasTex(64, 64, (g) => { g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#000'; g.beginPath(); g.arc(32, 18, 9, 0, 7); g.fill(); g.fillRect(24, 38, 16, 18); g.beginPath(); g.arc(32, 38, 8, 0, 7); g.arc(32, 56, 8, 0, 7); g.fill(); }, { srgb: false }));
// hot-dip galvanised spangle
const spangle = once(() => canvasTex(256, 256, (g, W, H) => {
  const r = rng(12); g.fillStyle = '#bfc2c4'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 260; i++) { const v = 170 + Math.round(r() * 60); g.fillStyle = `rgba(${v},${v + 2},${v + 4},0.55)`; g.beginPath(); const cx = r() * W, cy = r() * H, s = 6 + r() * 22; g.moveTo(cx + s, cy); for (let k = 1; k < 6; k++) { const a = k / 6 * PI * 2 + r() * 0.4; g.lineTo(cx + Math.cos(a) * s * (0.6 + r() * 0.5), cy + Math.sin(a) * s * (0.6 + r() * 0.5)); } g.fill(); }
}, { repeat: [4, 4] }));
// tightly wound torsion-spring coils (bump stripes along v)
const coilBump = once(() => canvasTex(8, 64, (g) => { for (let y = 0; y < 64; y++) { const v = Math.round(128 + 127 * Math.cos(y / 64 * PI * 2)); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, y, 8, 1); } }, { srgb: false, repeat: [1, 110] }));
// roller chain on the opener rail
const chainTex = once(() => canvasTex(16, 64, (g) => { g.fillStyle = '#2a2a2a'; g.fillRect(0, 0, 16, 64); for (let i = 0; i < 4; i++) { g.fillStyle = '#6d6f72'; g.fillRect(3, i * 16 + 1, 10, 14); g.fillStyle = '#1a1a1a'; g.fillRect(5, i * 16 + 6, 6, 4); } }, { repeat: [1, 190] }));
// a black tennis-ball can label (gold rings, gold W mark, white side stripe)
const canLabel = once(() => canvasTex(256, 256, (g, W, H) => {
  g.fillStyle = '#0d0d0e'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#b8954a'; g.fillRect(0, 20, W, 6); g.fillRect(0, 168, W, 4); g.fillRect(0, 232, W, 5);
  g.fillStyle = '#c9a85c'; g.font = 'bold 54px Georgia, serif'; g.fillText('W', 14, 222); g.fillText('W', 142, 222);
  g.fillStyle = '#e8e6e0'; g.fillRect(96, 40, 10, 180); g.fillRect(224, 40, 10, 180);
  g.font = 'bold 15px sans-serif'; g.fillStyle = '#d9d6cf'; g.save(); g.translate(60, 150); g.rotate(-PI / 2); g.fillText('CHAMPIONSHIP', 0, 0); g.restore();
  g.save(); g.translate(188, 150); g.rotate(-PI / 2); g.fillText('CHAMPIONSHIP', 0, 0); g.restore();
}));
// slate-blue-grey ping-pong top with white 20 mm edge lines and a 3 mm centre line (whole table on one map)
const slateTopTex = once(() => canvasTex(2048, 1140, (g, W, H) => {
  const r = rng(29); g.fillStyle = '#56636e'; g.fillRect(0, 0, W, H);
  g.globalAlpha = 0.045; for (let i = 0; i < 26000; i++) { g.fillStyle = r() > 0.5 ? '#ffffff' : '#000000'; g.fillRect(r() * W, r() * H, 2, 2); }
  g.globalAlpha = 0.05; for (let i = 0; i < 60; i++) { g.fillStyle = r() > 0.5 ? '#7d8a95' : '#3e4852'; g.beginPath(); g.ellipse(r() * W, r() * H, 60 + r() * 200, 30 + r() * 90, r() * 3, 0, 7); g.fill(); }
  g.globalAlpha = 1; g.fillStyle = '#f2f2ee'; const px = W / 2.74, e = 0.02 * px;
  g.fillRect(0, 0, W, e); g.fillRect(0, H - e, W, e); g.fillRect(0, 0, e, H); g.fillRect(W - e, 0, e, H); g.fillRect(0, H / 2 - 0.0015 * px, W, Math.max(3, 0.003 * px));
}));
// fine square net mesh (alpha) with the white top band handled by geometry
const netAlpha = once(() => canvasTex(32, 32, (g) => { g.fillStyle = '#000'; g.fillRect(0, 0, 32, 32); g.fillStyle = '#fff'; g.fillRect(0, 0, 32, 5); g.fillRect(0, 0, 5, 32); }, { srgb: false, repeat: [150, 11] }));
// matte crackle glaze bump for the jug vase
const glazeBump = once(() => canvasTex(512, 512, (g, W, H) => {
  const r = rng(61); g.fillStyle = '#808080'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) { const v = 128 + Math.round((r() - 0.5) * 120); g.fillStyle = `rgba(${v},${v},${v},0.35)`; g.beginPath(); g.arc(r() * W, r() * H, 2 + r() * 9, 0, 7); g.fill(); }
  g.globalAlpha = 0.25; for (let i = 0; i < 14000; i++) { g.fillStyle = r() > 0.5 ? '#ffffff' : '#000000'; g.fillRect(r() * W, r() * H, 1.5, 1.5); }
}, { srgb: false, repeat: [3, 2] }));

// black steel with keyhole slots every 38 mm along a post (ry = number of slots along the face)
export const slotted = (ry) => withAlpha(G.steel(), keyholeAlpha(), 1, ry);
// perforated galvanised angle / strap
export const perforated = (ry) => withAlpha(G.galv(), perfAlpha(), 1, ry);

// light grey cast concrete, one face per tile: soft mottling, pinholes, faint trowel arcs, and chipped paler arrises
// plus grime along every border (each box face maps 0..1, so the border wear lands on the edges)
const castConcrete = once(() => canvasTex(1024, 1024, (g, W, H) => {
  const r = rng(44); g.fillStyle = '#bdbbb5'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 70; i++) {
    const x = r() * W, y = r() * H, s = 60 + r() * 260, dark = r() < 0.55, gr = g.createRadialGradient(x, y, 0, x, y, s);
    gr.addColorStop(0, dark ? 'rgba(120,117,110,0.16)' : 'rgba(225,223,217,0.14)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - s, y - s, 2 * s, 2 * s);
  }
  g.globalAlpha = 0.07; for (let i = 0; i < 40000; i++) { g.fillStyle = r() > 0.5 ? '#ffffff' : '#55524c'; g.fillRect(r() * W, r() * H, 1.5, 1.5); }
  g.globalAlpha = 0.05; g.strokeStyle = '#efede8'; g.lineWidth = 6;
  for (let i = 0; i < 14; i++) { g.beginPath(); g.arc(r() * W, r() * H, 120 + r() * 300, r() * 6, r() * 6 + 1.2); g.stroke(); }
  g.globalAlpha = 0.55; g.fillStyle = '#5d5a55'; for (let i = 0; i < 700; i++) { g.beginPath(); g.arc(r() * W, r() * H, 0.6 + r() * 1.6, 0, 7); g.fill(); }
  // edge grime then chips
  for (const [x0, y0, w, h] of [[0, 0, W, 26], [0, H - 26, W, 26], [0, 0, 26, H], [W - 26, 0, 26, H]]) {
    const gr = g.createLinearGradient(x0 + (w < 100 ? (x0 ? w : 0) : 0), y0 + (h < 100 ? (y0 ? h : 0) : 0), x0 + (w < 100 ? (x0 ? 0 : w) : 0), y0 + (h < 100 ? (y0 ? 0 : h) : 0));
    gr.addColorStop(0, 'rgba(90,86,80,0.35)'); gr.addColorStop(1, 'rgba(90,86,80,0)'); g.globalAlpha = 1; g.fillStyle = gr; g.fillRect(x0, y0, w, h);
  }
  for (let c = 0; c < 16; c++) {   // chipped stretches of arris, a few chips each
    const side = Math.floor(r() * 4), t0 = 40 + r() * (W - 80), n = 3 + Math.floor(r() * 6);
    for (let i = 0; i < n; i++) {
      const t = t0 + (r() - 0.5) * 70, d = r() * 5, s = 3 + r() * 9;
      const [cx, cy] = [[t, d], [t, H - d], [d, t], [W - d, t]][side];
      g.globalAlpha = 0.35 + r() * 0.35; g.fillStyle = r() < 0.75 ? '#d2cfc9' : '#8f8c86'; g.beginPath(); g.moveTo(cx + s, cy);
      for (let k = 1; k < 7; k++) { const a = k / 7 * PI * 2; g.lineTo(cx + Math.cos(a) * s * (0.4 + r() * 0.7), cy + Math.sin(a) * s * (0.4 + r() * 0.7)); }
      g.fill();
    }
  }
  g.globalAlpha = 1;
}));

// ---------- materials ----------
const std = (o) => new THREE.MeshStandardMaterial(o);
const phys = (o) => new THREE.MeshPhysicalMaterial(o);
export const G = {
  // powder-coated black steel (shelving, sink stand): reads charcoal where light grazes it, as in g49
  steel: once(() => std({ color: 0x1d1e20, roughness: 0.5, metalness: 0.35, roughnessMap: noise(3, { amp: 30, rep: 2 }) })),
  deck: once(() => std({ color: 0x18191a, roughness: 0.62, metalness: 0.25, roughnessMap: noise(5, { amp: 40, rep: 3 }) })),
  // black painted steel laundry tub — dark charcoal, faintly worn
  sink: once(() => phys({ color: 0x323436, roughness: 0.58, metalness: 0.2, clearcoat: 0.2, clearcoatRoughness: 0.55, roughnessMap: noise(7, { amp: 45, rep: 2, blob: 3 }) })),
  chrome: once(() => std({ color: 0xf2f4f6, roughness: 0.06, metalness: 1 })),
  pvc: once(() => phys({ color: 0xf1f1ec, roughness: 0.34, clearcoat: 0.35, clearcoatRoughness: 0.4 })),
  rubber: once(() => std({ color: 0x141414, roughness: 0.85 })),
  // weathered pine crates (g49): tan-grey faces, lighter planed front edges
  crate: once(() => { const t = grainTex({ base: '#a3825c', dark: '#6a4f33', light: '#c9ab82', seed: 71, lines: 120 }); return std({ map: t, bumpMap: t, bumpScale: 0.6, roughness: 0.82, color: 0xe8dccb }); }),
  crateH: once(() => retile(G.crate(), 1, 1, { rot: PI / 2 })),
  crateEdge: once(() => { const t = grainTex({ base: '#dcc7a3', dark: '#b39874', seed: 72, lines: 60 }); return std({ map: t, roughness: 0.7 }); }),
  // reddish reclaimed board with copper screws (g48)
  railWood: once(() => { const t = grainTex({ base: '#93553a', dark: '#4d2617', light: '#c07f58', seed: 81, lines: 160, saw: 0.1 }); return retile(std({ map: t, bumpMap: t, bumpScale: 1.2, roughness: 0.72 }), 1.4, 0.12, { rot: PI / 2 }); }),
  copper: once(() => std({ color: 0xc47a4c, roughness: 0.32, metalness: 1 })),
  // whitewashed louvered shutter: brighter painted stiles, louvers where the wood shows through
  washFrame: once(() => { const t = grainTex({ base: '#efebe2', dark: '#a39478', light: '#ffffff', seed: 91, lines: 130, wash: 0.25 }); return std({ map: t, bumpMap: t, bumpScale: 0.8, roughness: 0.82 }); }),
  washLouver: once(() => { const t = grainTex({ base: '#bfa682', dark: '#7a6142', light: '#e6d9c2', seed: 93, lines: 150, wash: 0.1 }); return retile(std({ map: t, bumpMap: t, bumpScale: 0.8, roughness: 0.85, color: 0xf0e8dc }), 1, 0.15, { rot: PI / 2 }); }),
  ceramic: once(() => std({ color: 0xf2f0ea, roughness: 0.9, bumpMap: glazeBump(), bumpScale: 1.6 })),
  stem: once(() => std({ color: 0x8c8462, roughness: 0.95 })),
  floretW: once(() => std({ color: 0xf3efe6, roughness: 0.95 })),
  floretCream: once(() => std({ color: 0xe6dccb, roughness: 0.95 })),
  floretPink: once(() => std({ color: 0xdc9db2, roughness: 0.95 })),
  // garage door: white painted steel (double-sided sheet skins), galvanised hardware
  doorWhite: once(() => std({ color: 0xf3f3f0, roughness: 0.42, metalness: 0.12, side: THREE.DoubleSide })),
  doorWhiteS: once(() => std({ color: 0xf0f0ed, roughness: 0.45, metalness: 0.12 })),
  galv: once(() => std({ color: 0xffffff, map: spangle(), roughness: 0.36, metalness: 0.85 })),
  galvD: once(() => { const m = G.galv().clone(); m.side = THREE.DoubleSide; return m; }),
  nylon: once(() => std({ color: 0xe9e7e0, roughness: 0.4 })),
  spring: once(() => std({ color: 0x1c1c1d, roughness: 0.35, metalness: 0.8, bumpMap: coilBump(), bumpScale: 2 })),
  castAlu: once(() => std({ color: 0xa9adb0, roughness: 0.5, metalness: 0.7 })),
  openerBody: once(() => phys({ color: 0xe8e8e4, roughness: 0.45, clearcoat: 0.25, clearcoatRoughness: 0.4 })),
  openerGrey: once(() => phys({ color: 0x8d9094, roughness: 0.5, clearcoat: 0.2 })),
  openerLens: once(() => phys({ color: 0xf7f5ef, roughness: 0.55, transmission: 0, transparent: true, opacity: 0.9, emissive: 0xfff3dc, emissiveIntensity: 0.05 })),
  chain: once(() => std({ map: chainTex(), roughness: 0.5, metalness: 0.8 })),
  releaseRed: once(() => std({ color: 0xc0261e, roughness: 0.5 })),
  sensor: once(() => std({ color: 0x2a2c2e, roughness: 0.5 })),
  ledGreen: once(() => std({ color: 0x1a4a22, emissive: 0x33ff55, emissiveIntensity: 1.2 })),
  // LED shop light
  ledHousing: once(() => std({ color: 0xf4f4f1, roughness: 0.32, metalness: 0.35 })),
  ledCap: once(() => phys({ color: 0xefefec, roughness: 0.4, clearcoat: 0.2 })),
  ledDiffuser: once(() => std({ color: 0xffffff, emissive: 0xfff4e6, emissiveIntensity: 2.2, roughness: 0.6 })),
  // ping-pong (g49 / g04): slate top, white steel frame, black net
  slateTop: once(() => phys({ map: slateTopTex(), roughness: 0.5, clearcoat: 0.22, clearcoatRoughness: 0.45, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
  slateBoard: once(() => phys({ color: 0x55626d, roughness: 0.55, clearcoat: 0.15 })),
  frameWhite: once(() => std({ color: 0xeeeeeb, roughness: 0.4, metalness: 0.3 })),
  frameGrey: once(() => std({ color: 0xc9cbcc, roughness: 0.4, metalness: 0.5 })),
  net: once(() => std({ color: 0x1b1d1f, roughness: 0.9, side: THREE.DoubleSide, alphaMap: netAlpha(), alphaTest: 0.4 })),
  tape: once(() => phys({ color: 0xf4f4f0, roughness: 0.75, sheen: 0.4, sheenColor: new THREE.Color(0xffffff) })),
  wheel: once(() => std({ color: 0x171717, roughness: 0.8 })),
  // raw concrete plinth
  concrete: once(() => { const m = pbr('concrete_floor_01', { scale: 1, roughness: 0.94, normalScale: 0.45, ao: false }); m.map = castConcrete(); m.roughnessMap = null; m.vertexColors = true; return m; }),
  // shelf dressing
  can: once(() => phys({ map: canLabel(), roughness: 0.28, clearcoat: 0.9, clearcoatRoughness: 0.15, metalness: 0.2 })),
  canLid: once(() => phys({ color: 0x0e0e0f, roughness: 0.35, clearcoat: 0.5 })),
  canBase: once(() => std({ color: 0x9a9da0, roughness: 0.3, metalness: 1 })),
  band: once(() => std({ color: 0x1f47c9, roughness: 0.5 })),
  bandDark: once(() => std({ color: 0x1a2f7a, roughness: 0.55 })),
  cord: once(() => std({ color: 0x111111, roughness: 0.6 })),
  caseBlack: once(() => phys({ color: 0x171718, roughness: 0.85, sheen: 0.5, sheenRoughness: 0.6, sheenColor: new THREE.Color(0x777777) })),
  zip: once(() => std({ color: 0x9fa2a6, roughness: 0.35, metalness: 0.8 })),
  rubberRed: once(() => std({ color: 0xa8121c, roughness: 0.62 })),
  rubberBlk: once(() => std({ color: 0x131313, roughness: 0.62 })),
  paddleWood: once(() => { const t = grainTex({ base: '#c9955c', dark: '#8a5a2c', light: '#e2b77e', seed: 101, lines: 90 }); return std({ map: t, roughness: 0.55 }); }),
  towel: once(() => phys({ color: 0xf4f4f1, roughness: 1, sheen: 0.8, sheenRoughness: 0.9, sheenColor: new THREE.Color(0xffffff) })),
  ball: once(() => phys({ color: 0xf2782a, roughness: 0.42, clearcoat: 0.3 })),
  ballW: once(() => phys({ color: 0xf6f4ee, roughness: 0.42, clearcoat: 0.3 })),
};

// =====================================================================================================
// Shelf dressing (metalShelving)

// table-tennis bat: flared wooden handle, 6 mm blade, red rubber on one side and black on the other; lies flat
function batOutline() {
  const pts = [], n = 36, bw = 0.076, bh = 0.079, cy = 0.1;
  for (let i = 0; i <= n; i++) { const a = -PI / 2 + 0.42 + (i / n) * (PI * 2 - 0.84); pts.push([Math.cos(a) * bw, cy + Math.sin(a) * bh]); }
  pts.push([-0.016, 0.012], [-0.0135, -0.075], [0.0135, -0.075], [0.016, 0.012]);
  return pts;
}
// blade toward local -Z, handle toward +Z, lying flat on y = 0
export function bat(redUp = true) {
  const g = new THREE.Group(); g.add(extrude(batOutline(), 0.006, G.paddleWood(), { bevel: 0.0008 }));
  const rub = [], n = 40; for (let i = 0; i < n; i++) { const a = (i / n) * PI * 2; rub.push([Math.cos(a) * 0.0755, 0.1 + Math.sin(a) * 0.0785]); }
  g.add(extrude(rub, 0.0022, redUp ? G.rubberRed() : G.rubberBlk(), { bevel: 0.0004, z: 0.0068 }));
  g.add(extrude(rub, 0.0022, redUp ? G.rubberBlk() : G.rubberRed(), { bevel: 0.0004, z: -0.003 }));
  for (const z of [0.0089, -0.0029]) g.add(box(0.029, 0.095, 0.0042, G.paddleWood(), { r: 0.0018, y: -0.0275, z }));
  g.rotation.x = -PI / 2; g.position.y = 0.0055;
  const w = new THREE.Group(); w.add(g); return w;
}
// soft zip case for two bats (paddle-shaped, black nylon, grey zipper); blade end toward -Z
export function batCase() {
  const g = new THREE.Group(), out = [], n = 40;
  for (let i = 0; i <= n; i++) { const a = -PI / 2 + 0.5 + (i / n) * (PI * 2 - 1.0); out.push([Math.cos(a) * 0.098, 0.12 + Math.sin(a) * 0.1]); }
  out.push([-0.03, 0.03], [-0.028, -0.06], [0.028, -0.06], [0.03, 0.03]);
  const body = extrude(out, 0.026, G.caseBlack(), { bevel: 0.012 }); body.rotation.x = -PI / 2; body.position.y = 0.012; g.add(body);
  const zp = offsetPoly(out, 0.0118).map(([x, y]) => [x, 0.025, -y]);
  g.add(tube(zp, 0.0022, G.zip(), { seg: 140, radial: 5, closed: true }));
  const tab = zp[8]; g.add(box(0.012, 0.004, 0.024, G.zip(), { r: 0.0015, x: tab[0] + 0.008, y: 0.027, z: tab[2] }));
  return g;
}
// tennis-ball can (black, gold rings) with a black plastic lid and pressed steel base
export function can() {
  const g = new THREE.Group();
  g.add(cyl(0.0365, 0.0365, 0.226, G.can(), { y: 0.006, bottom: true, seg: 24 }));
  g.add(cyl(0.035, 0.0365, 0.006, G.canBase(), { bottom: true, seg: 24 }));
  g.add(lathe([[0.0375, 0], [0.039, 0.003], [0.039, 0.014], [0.036, 0.017], [0, 0.018]], G.canLid(), { y: 0.226, seg: 24 }));
  return g;
}
// two blue resistance tubes with foam handles + a coiled black skipping rope, lying on a shelf
export function bandsPile() {
  const g = new THREE.Group(), r = rng(15);
  const loop = (cx, cz, rx, rz, rot, n = 3) => {
    const pts = []; for (let i = 0; i < n * 14; i++) { const a = i / 14 * PI * 2; const s = 1 + 0.12 * Math.sin(a * 2.3 + rot); pts.push([cx + Math.cos(a + rot) * rx * s, 0.006 + i * 0.0045 / n + 0.003 * Math.sin(a * 3), cz + Math.sin(a + rot) * rz * s]); }
    return pts;
  };
  g.add(tube(loop(-0.02, 0.0, 0.1, 0.055, 0.3, 2), 0.0055, G.band(), { seg: 110, radial: 6 }));
  g.add(tube(loop(0.06, 0.03, 0.085, 0.05, 1.7, 2), 0.0055, G.bandDark(), { seg: 110, radial: 6 }));
  for (const [x, z, ry] of [[-0.12, 0.05, 0.4], [-0.07, 0.085, -0.2], [0.13, -0.03, 1.2], [0.155, 0.04, 0.9]]) {
    const h = cyl(0.014, 0.014, 0.11, G.band(), { seg: 14, x, y: 0.014, z, rz: PI / 2 }); h.rotation.y = ry; g.add(h);
  }
  const rope = []; for (let i = 0; i < 70; i++) { const a = i / 12 * PI * 2; rope.push([0.26 + Math.cos(a) * (0.045 + 0.01 * r()), 0.004 + i * 0.0004, 0.0 + Math.sin(a) * (0.05 + 0.01 * r())]); }
  g.add(tube(rope, 0.0026, G.cord(), { seg: 150, radial: 4 }));
  g.add(cyl(0.011, 0.011, 0.1, G.cord(), { seg: 12, x: 0.25, y: 0.012, z: 0.07, rz: PI / 2 }));
  return g;
}
// open pine crate lying on its side (open face toward +Z), board ends showing; origin at the bottom centre
export function crate(w = 0.31, h = 0.29, d = 0.3, t = 0.013) {
  const g = new THREE.Group(), F = G.crate(), FH = G.crateH(), E = G.crateEdge();
  g.add(box(w, t, d, FH, { r: 0.002, bottom: true }));
  g.add(box(w, t, d, FH, { r: 0.002, y: h - t, bottom: true }));
  for (const s of [-1, 1]) g.add(box(t, h - 2 * t, d, F, { r: 0.002, x: s * (w / 2 - t / 2), y: t, bottom: true }));
  g.add(box(w - 2 * t, h - 2 * t, t, F, { x: 0, y: t, z: -d / 2 + t / 2, bottom: true }));
  // planed light front edges (the bright frame in the photo)
  for (const y of [0, h - t]) g.add(box(w + 0.001, t + 0.001, 0.003, E, { y: y - 0.0005, z: d / 2 - 0.0012, bottom: true }));
  for (const s of [-1, 1]) g.add(box(t + 0.001, h - 2 * t, 0.003, E, { x: s * (w / 2 - t / 2), y: t, z: d / 2 - 0.0012, bottom: true }));
  return g;
}
// a heap of orange (and a few white) 40 mm balls settled in the front of a crate
export function ballHeap(w, d, seed = 3) {
  const r = rng(seed), o = [], wt = [], R = 0.02;
  const cols = Math.floor(w / (2 * R)), rows = 4;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    if (r() < 0.12) continue;
    const x = -w / 2 + R + i * 2 * R + (r() - 0.5) * 0.006, z = d / 2 - R - j * 2 * R * 0.95 + (r() - 0.5) * 0.006;
    (r() < 0.08 ? wt : o).push(sphere(R, G.ball(), { seg: 10, x, y: R, z }));
  }
  for (let k = 0; k < 9; k++) { const x = -w / 2 + 2 * R + r() * (w - 4 * R), z = d / 2 - 1.5 * R - r() * 0.1; o.push(sphere(R, G.ball(), { seg: 10, x, y: R * 2.6, z })); }
  const g = new THREE.Group(); g.add(merged(o, G.ball())); if (wt.length) g.add(merged(wt, G.ballW())); return g;
}

// =====================================================================================================
// Dried gypsophila spray: stems fan out of the jug mouth, branch twice, and end in domed clouds of tiny florets.
// Pink-dyed sprigs sit on one side (right/back, as in g48). Origin = centre of the jug mouth.
export function gypsophila({ stems = 15, seed = 5, spread = 1 } = {}) {
  const r = rng(seed), twigs = [], fW = [], fC = [], fP = [];
  const flor = new THREE.OctahedronGeometry(0.0034, 0);
  const put = (list, x, y, z, s) => { const m = new THREE.Mesh(flor, null); m.position.set(x, y, z); m.scale.setScalar(s); m.rotation.set(r() * 3, r() * 3, 0); list.push(m); };
  for (let i = 0; i < stems; i++) {
    const az = (i / stems) * PI * 2 + r() * 0.5, lean = (0.35 + r() * 0.6) * spread, len = 0.2 + r() * 0.12;
    const dir = new THREE.Vector3(Math.cos(az) * Math.sin(lean), Math.cos(lean), Math.sin(az) * Math.sin(lean) * 0.6);
    const base = new THREE.Vector3((r() - 0.5) * 0.03, -0.06, (r() - 0.5) * 0.03);
    const top = base.clone().addScaledVector(dir, len);
    const mid = base.clone().lerp(top, 0.5).add(new THREE.Vector3((r() - 0.5) * 0.02, 0.01, (r() - 0.5) * 0.02));
    twigs.push(rod(base.toArray(), mid.toArray(), 0.0016, G.stem(), 4, true), rod(mid.toArray(), top.toArray(), 0.0014, G.stem(), 4, true));
    const pinkSide = Math.cos(az - 0.3) > 0.25 && r() < 0.8;
    const nb = 3 + Math.floor(r() * 3);
    for (let b = 0; b < nb; b++) {
      const t0 = 0.55 + r() * 0.45, p0 = mid.clone().lerp(top, (t0 - 0.5) * 2);
      const bd = dir.clone().add(new THREE.Vector3((r() - 0.5) * 1.2, (r() - 0.2) * 0.6, (r() - 0.5) * 1.2)).normalize();
      const p1 = p0.clone().addScaledVector(bd, 0.03 + r() * 0.06);
      twigs.push(rod(p0.toArray(), p1.toArray(), 0.001, G.stem(), 3, true));
      // cyme: a dome of floret clumps on short twigs
      const nc = 8 + Math.floor(r() * 6), cr = 0.022 + r() * 0.022;
      for (let c = 0; c < nc; c++) {
        const u = r() * PI * 2, v = r() * 1.1, q = new THREE.Vector3(Math.cos(u) * Math.sin(v), Math.cos(v), Math.sin(u) * Math.sin(v));
        const qd = q.clone().applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), bd));
        const p2 = p1.clone().addScaledVector(qd, cr * (0.6 + r() * 0.4));
        twigs.push(rod(p1.toArray(), p2.toArray(), 0.0006, G.stem(), 3, true));
        const list = pinkSide ? (r() < 0.75 ? fP : fC) : (r() < 0.7 ? fW : fC);
        const nf = 3 + Math.floor(r() * 4);
        for (let f = 0; f < nf; f++) put(list, p2.x + (r() - 0.5) * 0.012, p2.y + (r() - 0.3) * 0.01, p2.z + (r() - 0.5) * 0.012, 0.7 + r() * 0.6);
      }
    }
  }
  const g = new THREE.Group();
  g.add(merged(twigs, G.stem()));
  for (const [list, mat] of [[fW, G.floretW()], [fC, G.floretCream()], [fP, G.floretPink()]]) if (list.length) g.add(merged(list, mat));
  return g;
}
