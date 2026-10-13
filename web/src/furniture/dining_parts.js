// dining — shared helpers and local procedural textures (ash grain, Danish paper cord, lantern ribs, painting, books,
// beach screen, fern frond). Everything is deterministic (seeded) and built once.
import { THREE, M, shadow } from '../kit.js';

export const once = (fn) => { let v; return () => (v ??= fn()); };
export function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mixc = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function texOf(c, { srgb = true, wrap = true } = {}) {
  const t = new THREE.CanvasTexture(c); if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------------------------------------------------------------- geometry helpers
// Re-map a box-like geometry's UVs to metres (planar per dominant normal) so textures keep real scale; wood grain
// (texture v) follows `grain` axis. `off` shifts the pattern so repeated parts do not look identical.
export function boxUV(mesh, grain = 'y', off = [0, 0], scale = 1) {
  const g = mesh.geometry, pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  const ax = { x: 0, y: 1, z: 2 }[grain];
  for (let i = 0; i < pos.count; i++) {
    const p = [pos.getX(i), pos.getY(i), pos.getZ(i)], n = [Math.abs(nor.getX(i)), Math.abs(nor.getY(i)), Math.abs(nor.getZ(i))];
    const d = n[0] >= n[1] && n[0] >= n[2] ? 0 : (n[1] >= n[2] ? 1 : 2);
    let u, v;
    if (d !== ax) { const o = [0, 1, 2].find(k => k !== d && k !== ax); u = p[o]; v = p[ax]; } else { const [a, b] = [0, 1, 2].filter(k => k !== d); u = p[a]; v = p[b]; }
    uv.setXY(i, (u + off[0]) * scale, (v + off[1]) * scale);
  }
  uv.needsUpdate = true; return mesh;
}
let woodSeed = 1; const wr = rng(99);
// Lift a root so its lowest point sits on y = 0 (tilted round feet dip a few mm below otherwise).
export function ground(root) { root.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(root); if (b.min.y < 0) for (const c of root.children) c.position.y -= b.min.y; return root; }
export function wood(mesh, grain = 'y') { woodSeed++; return boxUV(mesh, grain, [wr() * 3, wr() * 3]); }

// Sweep a closed 2-D section along a 3-D path with parallel-transport frames. sectionAt(t) -> [[a,b],...] where a is
// along the frame normal (starts as `up`), b along the binormal; points go counter-clockwise in the (b,a) plane.
// UVs: u = perimeter (m), v = length (m) so grain textures run along the path.
export function sweep(points, sectionAt, mat, { seg = 64, up = [0, 1, 0], caps = true, curve = 'centripetal' } = {}) {
  const c = points instanceof THREE.Curve ? points : new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), false, curve);
  const P = [], T = [], N = [], B = [], L = [0];
  for (let i = 0; i <= seg; i++) { P.push(c.getPointAt(i / seg)); T.push(c.getTangentAt(i / seg).normalize()); }
  let n = new THREE.Vector3(...up); n.addScaledVector(T[0], -n.dot(T[0])).normalize();
  for (let i = 0; i <= seg; i++) {
    if (i > 0) { n.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(T[i - 1], T[i])); n.addScaledVector(T[i], -n.dot(T[i])).normalize(); L.push(L[i - 1] + P[i].distanceTo(P[i - 1])); }
    N.push(n.clone()); B.push(new THREE.Vector3().crossVectors(T[i], n).normalize());
  }
  const pos = [], uv = [], idx = [];
  const K = sectionAt(0).length;
  for (let i = 0; i <= seg; i++) {
    const s = sectionAt(i / seg); let per = 0;
    for (let k = 0; k <= K; k++) {
      const [a, b] = s[k % K]; if (k > 0) { const [a0, b0] = s[k - 1]; per += Math.hypot(a - a0, b - b0); }
      const q = P[i].clone().addScaledVector(N[i], a).addScaledVector(B[i], b); pos.push(q.x, q.y, q.z); uv.push(per, L[i]);
    }
  }
  const row = K + 1;
  for (let i = 0; i < seg; i++) for (let k = 0; k < K; k++) { const a = i * row + k, b = (i + 1) * row + k; idx.push(a, b, b + 1, a, b + 1, a + 1); }
  if (caps) for (const [i, flip] of [[0, false], [seg, true]]) {
    const s = sectionAt(i / seg); let ca = 0, cb = 0; s.forEach(([a, b]) => { ca += a / K; cb += b / K; });
    const ci = pos.length / 3, q = P[i].clone().addScaledVector(N[i], ca).addScaledVector(B[i], cb); pos.push(q.x, q.y, q.z); uv.push(0, L[i]);
    const base = pos.length / 3;
    for (let k = 0; k < K; k++) { const [a, b] = s[k]; const r = P[i].clone().addScaledVector(N[i], a).addScaledVector(B[i], b); pos.push(r.x, r.y, r.z); uv.push(b, a); }
    for (let k = 0; k < K; k++) { const k1 = (k + 1) % K; flip ? idx.push(ci, base + k1, base + k) : idx.push(ci, base + k, base + k1); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return shadow(new THREE.Mesh(g, mat));
}
// Ellipse / rounded-rectangle sections for sweep().
export const ell = (A, Bb, n = 12) => Array.from({ length: n }, (_, k) => { const t = (k / n) * Math.PI * 2; return [A * Math.sin(t), Bb * Math.cos(t)]; });
export function rrect(h0, h1, w, rt, rb, n = 6) {   // a from h0..h1, b from -w/2..w/2, top radius rt, bottom radius rb; CCW in (b,a)
  const pts = [], hw = w / 2, arc = (cb, ca, r, a0) => { for (let i = 0; i <= n; i++) { const t = a0 + (i / n) * Math.PI / 2; pts.push([ca + r * Math.sin(t), cb + r * Math.cos(t)]); } };
  arc(hw - rb, h0 + rb, rb, -Math.PI / 2); arc(hw - rt, h1 - rt, rt, 0); arc(-hw + rt, h1 - rt, rt, Math.PI / 2); arc(-hw + rb, h0 + rb, rb, Math.PI);
  return pts;
}
// Round rod between two points.
export function rod(p, q, r0, r1, mat, seg = 14) {
  const a = new THREE.Vector3(...p), b = new THREE.Vector3(...q), d = b.clone().sub(a), len = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1 ?? r0, r0, len, seg, 1), mat);
  m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  const uv = m.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * Math.PI * r0 + wr(), uv.getY(i) * len);
  return shadow(m);
}

// ---------------------------------------------------------------- textures
// Ash / oak grain: growth rings of a slightly tapered log cut by the board plane (cathedral arches), glued boards.
// Canvas u (x) runs across the grain over `mu` metres, v (y) along the grain over `mv` metres.
export function grainTex({ W = 1024, H = 1024, mu = 1, mv = 1, boards = 6, seed = 3, base = '#ead2a8', late = '#b98d5c', rings = 110, contrast = 1 } = {}) {
  const [c, g] = canvas(W, H), r = rng(seed), img = g.createImageData(W, H), d = img.data;
  const Bc = hex(base), Lc = hex(late), bw = mu / boards;
  const G = 64, grid = Float32Array.from({ length: G * G }, () => r());
  const noise = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const at_ = (i, j) => grid[((j % G + G) % G) * G + ((i % G + G) % G)];
    return lerp(lerp(at_(xi, yi), at_(xi + 1, yi), sx), lerp(at_(xi, yi + 1), at_(xi + 1, yi + 1), sx), sy); };
  const bp = Array.from({ length: boards }, () => ({ u0: (r() - 0.5) * bw * 1.1, h: 0.03 + r() * 0.12, k: (r() - 0.5) * 0.28, f: rings * (0.8 + r() * 0.4), ph: r() * 10, tint: (r() - 0.5) * 0.1, w1: r() * 6, w2: r() * 6 }));
  const pore = Float32Array.from({ length: W * 8 }, () => r());
  for (let y = 0; y < H; y++) {
    const vm = (y / H) * mv;
    for (let x = 0; x < W; x++) {
      const um = (x / W) * mu, bi = Math.min(boards - 1, Math.floor(um / bw)), b = bp[bi];
      const du = um - (bi + 0.5) * bw - b.u0 + 0.008 * Math.sin(vm * 2.1 + b.w1) + 0.006 * (noise(um * 14 + bi * 7, vm * 3) - 0.5);
      const R = Math.sqrt(du * du + b.h * b.h) + b.k * vm + 0.012 * (noise(um * 6 + bi * 13, vm * 1.5) - 0.5);
      const t = ((R * b.f + b.ph) % 1 + 1) % 1;
      // ring-porous: soft dark earlywood band after each boundary, crisp boundary line, light latewood
      const band = smooth01(t / 0.12) * (1 - smooth01((t - 0.12) / 0.3)) * 0.42, line = Math.exp(-((t - 0.02) ** 2) / 0.0006) * (0.25 + 0.5 * noise(R * b.f * 0.7, vm * 2));
      const pr = pore[(x * 8 + ((y >> 5) & 7))] < 0.18 ? 0.12 : 0;
      const v = Math.min(1, (band + line + pr * band * 2) * contrast + b.tint + (noise(um * 40, vm * 4) - 0.5) * 0.08);
      const col = mixc(Bc, Lc, Math.max(0, v));
      const i = (y * W + x) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0); return texOf(c);
}
const lerp = (a, b, t) => a + (b - a) * t;
const smooth01 = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

// Danish paper cord seat (envelope weave): front/back triangles have front-back cords, side triangles side-side cords.
export const cordSeatTex = once(() => {
  const W = 1024, [c, g] = canvas(W, W), img = g.createImageData(W, W), d = img.data;
  const L = hex('#dcc79f'), D = hex('#8f7449'), pitch = W / 104;
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / W, m = Math.min(u, 1 - u, v, 1 - v);
    const fb = (m === v || m === 1 - v);                         // front/back sector
    const across = fb ? x : y, along = fb ? y : x;
    const f = (across / pitch) % 1, prof = Math.pow(Math.sin(Math.PI * f), 0.7);
    const twist = 0.5 + 0.5 * Math.sin(((across / pitch) + along / (pitch * 1.6)) * Math.PI * 2);
    const seam = Math.abs(Math.abs(u - 0.5) - Math.abs(v - 0.5)) < 0.004 ? 0.35 : 0;
    const t = Math.min(1, (1 - prof) * 0.85 + twist * 0.12 + seam);
    const col = mixc(L, D, t); const i = (y * W + x) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); return texOf(c);
});
// Cord wrapped around a rail: rings across v (64 cords per texture height).
export const cordWrapTex = once(() => {
  const W = 64, H = 512, [c, g] = canvas(W, H), img = g.createImageData(W, H), d = img.data, L = hex('#dcc79f'), D = hex('#8f7449');
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const f = ((y + x * 0.12) / (H / 64)) % 1, t = (1 - Math.pow(Math.sin(Math.PI * f), 0.7)) * 0.85; const col = mixc(L, D, t); const i = (y * W + x) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255; }
  g.putImageData(img, 0, 0); return texOf(c);
});

// Paper lantern: meridian wire ribs show through the paper as soft grey lines; fibrous paper between them.
export const ribTex = once(() => {
  const W = 2048, H = 256, n = 36, [c, g] = canvas(W, H), r = rng(17), img = g.createImageData(W, H), d = img.data;
  const P = hex('#fffaf1'), Rb = hex('#b3a893');
  const fib = Float32Array.from({ length: W * H }, () => r());
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const f = (x / W) * n % 1, dist = Math.min(f, 1 - f) * (W / n);            // px from nearest rib
    const rib = Math.exp(-(dist * dist) / 3.2) * 0.85 + Math.exp(-(dist * dist) / 80) * 0.16;
    const t = Math.min(1, rib + (fib[y * W + x] - 0.5) * 0.05 + (fib[((y >> 2) * W + x) % (W * H)] - 0.5) * 0.04);
    const col = mixc(P, Rb, t); const i = (y * W + x) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); return texOf(c);
});

// The owner's red abstract painting (g20/g22): vermilion field with mottled paint, a charcoal tree whose trunk rises
// from the bottom edge and forks into a few thick limbs reaching the top edge.
export const paintingTex = once(() => {
  const W = 700, H = 550, [c, g] = canvas(W, H), r = rng(41);
  g.fillStyle = '#e04a2c'; g.fillRect(0, 0, W, H);
  const cols = ['#ec6a3c', '#c9381f', '#e85a33', '#d4432a', '#f2804c', '#b8301d', '#f19a6a'];
  for (let i = 0; i < 1400; i++) { const x = r() * W, y = r() * H, rad = 4 + r() * 26; g.globalAlpha = 0.06 + r() * 0.12; g.fillStyle = cols[Math.floor(r() * cols.length)]; g.beginPath(); g.ellipse(x, y, rad * (1 + r()), rad * 0.5, r() * 3, 0, Math.PI * 2); g.fill(); }
  g.globalAlpha = 0.18; g.fillStyle = '#f7c2a0'; for (let i = 0; i < 40; i++) { g.beginPath(); g.ellipse(r() * W * 0.5, r() * H * 0.5, 10 + r() * 30, 4 + r() * 10, r() * 3, 0, 7); g.fill(); }
  g.globalAlpha = 1; g.lineCap = 'round'; g.lineJoin = 'round';
  const limb = (x, y, ang, len, w, depth) => {
    const x2 = x + Math.cos(ang) * len, y2 = y - Math.sin(ang) * len, mx = (x + x2) / 2 + (r() - 0.5) * len * 0.25, my = (y + y2) / 2;
    for (let k = 0; k < 6; k++) { const ww = w * (1 - k * 0.12), t = k / 5; g.strokeStyle = k < 3 ? '#1f1b1a' : ['#3b3532', '#5a524c', '#8c847b'][k - 3]; g.lineWidth = ww; g.beginPath(); g.moveTo(x + (t - 0.3) * w * 0.3, y); g.quadraticCurveTo(mx + (t - 0.3) * w * 0.3, my, x2 + (t - 0.3) * w * 0.2, y2); g.stroke(); }
    g.strokeStyle = 'rgba(235,230,222,0.7)'; g.lineWidth = Math.max(1.5, w * 0.08); g.beginPath(); g.moveTo(x - w * 0.36, y); g.quadraticCurveTo(mx - w * 0.36, my, x2 - w * 0.25, y2); g.stroke();
    if (depth > 0) { const n = depth === 3 ? 3 : 2; for (let j = 0; j < n; j++) limb(x2, y2, ang + (j - (n - 1) / 2) * (0.62 + r() * 0.2), len * (0.7 + r() * 0.12), w * 0.6, depth - 1); }
  };
  limb(W * 0.58, H + 20, Math.PI / 2 + 0.06, H * 0.5, 64, 3);
  g.globalAlpha = 0.1; for (let i = 0; i < 4000; i++) { g.fillStyle = r() > 0.5 ? '#fff' : '#000'; g.fillRect(r() * W, r() * H, 1 + r() * 3, 1); }
  return texOf(c, { wrap: false });
});

// Limewashed reclaimed wood (office console, g22): weathered grey-tan grain with white wash caught in the grain,
// thin dark checks and paler worn patches.
export const limewashTex = once(() => {
  const t = grainTex({ mu: 1, mv: 1, boards: 8, seed: 61, base: '#a38f74', late: '#584634', rings: 60, contrast: 1.3 }), c = t.image, g = c.getContext('2d'), r = rng(62);
  for (let i = 0; i < 70; i++) { g.globalAlpha = 0.12 + r() * 0.2; g.fillStyle = '#efeae1'; g.beginPath(); g.ellipse(r() * 1024, r() * 1024, 20 + r() * 60, 80 + r() * 260, 0, 0, 7); g.fill(); }
  g.lineCap = 'round';
  for (let i = 0; i < 1500; i++) { const x = r() * 1024, y = r() * 1024, l = 30 + r() * 260; g.globalAlpha = 0.2 + r() * 0.55; g.strokeStyle = r() < 0.85 ? '#f2eee6' : '#d9d2c4'; g.lineWidth = 1 + r() * 5; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 8, y + l); g.stroke(); }
  for (let i = 0; i < 90; i++) { const x = r() * 1024, y = r() * 1024, l = 20 + r() * 140; g.globalAlpha = 0.35 + r() * 0.3; g.strokeStyle = '#3d3127'; g.lineWidth = 1 + r() * 1.5; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 4, y + l); g.stroke(); }
  g.globalAlpha = 1; t.needsUpdate = true; return t;
});

// Aged cognac leather colour (patina, lighter scuffs); the scanned leather supplies normal/roughness.
export const patinaTex = once(() => {
  const W = 512, [c, g] = canvas(W, W), r = rng(73); g.fillStyle = '#56210c'; g.fillRect(0, 0, W, W);
  for (let i = 0; i < 400; i++) { g.globalAlpha = 0.05 + r() * 0.12; g.fillStyle = ['#73311a', '#40170a', '#662913', '#82391b'][Math.floor(r() * 4)]; g.beginPath(); g.ellipse(r() * W, r() * W, 10 + r() * 50, 6 + r() * 30, r() * 3, 0, 7); g.fill(); }
  g.strokeStyle = '#b06a40'; for (let i = 0; i < 120; i++) { g.globalAlpha = 0.15 + r() * 0.25; g.lineWidth = 0.6 + r(); const x = r() * W, y = r() * W; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 40, y + (r() - 0.5) * 12); g.stroke(); }
  g.globalAlpha = 1; return texOf(c);
});

// Monitor wallpaper seen in g22: tropical beach, blue sky with cumulus, turquoise sea, white surf on sand.
export const beachTex = once(() => {
  const W = 640, H = 360, [c, g] = canvas(W, H), r = rng(5);
  let grd = g.createLinearGradient(0, 0, 0, H * 0.52); grd.addColorStop(0, '#2f7fd0'); grd.addColorStop(1, '#9fd0f2'); g.fillStyle = grd; g.fillRect(0, 0, W, H * 0.52);
  for (let i = 0; i < 60; i++) { const x = r() * W, y = H * (0.12 + r() * 0.32), s = 10 + r() * 30; g.globalAlpha = 0.5 + r() * 0.4; g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(x, y, s * 1.6, s * 0.7, 0, 0, 7); g.fill(); }
  g.globalAlpha = 1; grd = g.createLinearGradient(0, H * 0.5, 0, H * 0.72); grd.addColorStop(0, '#1a8fb8'); grd.addColorStop(1, '#40d0d0'); g.fillStyle = grd; g.fillRect(0, H * 0.5, W, H * 0.22);
  grd = g.createLinearGradient(0, H * 0.7, 0, H); grd.addColorStop(0, '#9fe6dc'); grd.addColorStop(0.25, '#f4f1e8'); grd.addColorStop(1, '#efe2c8'); g.fillStyle = grd; g.fillRect(0, H * 0.7, W, H * 0.3);
  g.fillStyle = 'rgba(255,255,255,0.85)'; for (let i = 0; i < 40; i++) { g.beginPath(); g.ellipse(r() * W, H * (0.69 + r() * 0.05), 30 + r() * 60, 3 + r() * 4, 0, 0, 7); g.fill(); }
  return texOf(c, { wrap: false });
});

// Book spine detail: plain cloth with a title block and two thin bands; lower-left corner stays plain for non-spine faces.
export const spineTex = once(() => {
  const W = 64, H = 256, [c, g] = canvas(W, H); g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(8, 30, 48, 3); g.fillRect(8, 222, 48, 3);
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.globalCompositeOperation = 'source-over';
  g.fillStyle = 'rgba(250,245,230,0.55)'; for (let i = 0; i < 9; i++) g.fillRect(24, 70 + i * 13, 16, 7);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 6, 6);
  return texOf(c, { wrap: false });
});

// Fern frond with alpha (pinnate, tapering).
export const fernTex = once(() => {
  const W = 256, H = 512, [c, g] = canvas(W, H); g.clearRect(0, 0, W, H); g.strokeStyle = '#3f6b2a'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(W / 2, H); g.quadraticCurveTo(W * 0.52, H * 0.5, W / 2, 6); g.stroke();
  for (let i = 0; i < 26; i++) { const y = H * 0.94 - i * (H * 0.86 / 26), len = (W * 0.46) * Math.sin(Math.PI * (0.15 + 0.85 * (1 - i / 26)) * 0.62 + 0.25); for (const s of [-1, 1]) { g.fillStyle = i % 2 ? '#4d8436' : '#447a30'; g.beginPath(); g.moveTo(W / 2, y); g.quadraticCurveTo(W / 2 + s * len * 0.5, y - 10, W / 2 + s * len, y - 22); g.quadraticCurveTo(W / 2 + s * len * 0.5, y + 2, W / 2, y + 6); g.fill(); } }
  return texOf(c, { wrap: false });
});

// ---------------------------------------------------------------- local materials
export const MAT = {
  // Light honey oak with soft grain (g19–g21); the earlier orange base and dark late-wood read as loud once exposed like the photos.
  ashTop: once(() => { const t = grainTex({ W: 1024, H: 2048, mu: 0.95, mv: 2.2, boards: 6, seed: 11, base: '#d8b78a', late: '#a27a4f', rings: 52, contrast: 0.95 }); t.repeat.set(1 / 0.95, 1 / 2.2); t.offset.set(0.5, 0.5); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, bumpMap: t, bumpScale: 0.6 }); }),
  ash: once(() => { const t = grainTex({ mu: 1, mv: 1, boards: 7, seed: 5, base: '#d4b083', late: '#9a7048', rings: 100, contrast: 1.0 }); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.52, bumpMap: t, bumpScale: 0.4 }); }),
  chairAsh: once(() => { const t = grainTex({ mu: 1, mv: 1, boards: 9, seed: 8, base: '#c3925a', late: '#6b4522', rings: 120, contrast: 0.9 }); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.48, bumpMap: t, bumpScale: 0.3 }); }),
  oakLeg: once(() => { const t = grainTex({ mu: 1, mv: 1, boards: 8, seed: 23, base: '#d7b07a', late: '#9c6e3c', rings: 140 }); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 }); }),
  cordSeat: once(() => new THREE.MeshStandardMaterial({ map: cordSeatTex(), bumpMap: cordSeatTex(), bumpScale: 2, roughness: 0.9, side: THREE.DoubleSide })),
  cordWrap: once(() => { const t = cordWrapTex(); t.repeat.set(1, 1 / (64 * 0.0042)); return new THREE.MeshStandardMaterial({ map: t, bumpMap: t, bumpScale: 2, roughness: 0.9 }); }),
  lanternPaper: once(() => { const m = M.paper().clone(); Object.assign(m, { map: ribTex(), emissiveMap: ribTex(), emissive: new THREE.Color(0xffe6bf), emissiveIntensity: 0.55, transparent: false, opacity: 1, side: THREE.DoubleSide, roughness: 1 }); m.color = new THREE.Color(0xffffff); return m; }),
  whiteMetal: once(() => new THREE.MeshStandardMaterial({ color: 0xf2f1ee, roughness: 0.35, metalness: 0.3 })),
  painting: once(() => new THREE.MeshStandardMaterial({ map: paintingTex(), roughness: 0.85 })),
  canvasEdge: once(() => new THREE.MeshStandardMaterial({ color: 0xd94a2a, roughness: 0.85 })),
  beach: once(() => new THREE.MeshStandardMaterial({ map: beachTex(), emissive: 0xffffff, emissiveMap: beachTex(), emissiveIntensity: 0.75, roughness: 0.25 })),
  books: once(() => new THREE.MeshStandardMaterial({ map: spineTex(), vertexColors: true, roughness: 0.75 })),
  fern: once(() => new THREE.MeshStandardMaterial({ map: fernTex(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 })),
  dried: once(() => new THREE.MeshStandardMaterial({ color: 0xc9b48e, roughness: 1 })),
  plume: once(() => new THREE.MeshPhysicalMaterial({ color: 0xe9dcc4, roughness: 1, sheen: 1, sheenColor: new THREE.Color(0xfff6e6) })),
  silverPlastic: once(() => new THREE.MeshStandardMaterial({ color: 0xdcdcd8, roughness: 0.35, metalness: 0.4 })),
  darkGlass: once(() => new THREE.MeshStandardMaterial({ color: 0x111316, roughness: 0.15, metalness: 0.2 })),
  blonde: once(() => { const t = grainTex({ mu: 1, mv: 1, boards: 6, seed: 47, base: '#dcc39b', late: '#a37d50', rings: 80, contrast: 0.85 }); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.62 }); }),
  limewash: once(() => new THREE.MeshStandardMaterial({ map: limewashTex(), bumpMap: limewashTex(), bumpScale: 1.2, roughness: 0.9 })),
  cognac: once(() => { const n = M.leatherCognac(); const p = patinaTex(); p.repeat.set(1.3, 1.3); return new THREE.MeshPhysicalMaterial({ map: p, normalMap: n.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughnessMap: n.roughnessMap, roughness: 0.62, clearcoat: 0.25, clearcoatRoughness: 0.45, sheen: 0.3, sheenColor: new THREE.Color(0xffd2b0) }); }),
  clayVase: once(() => { const m = M.ceramicSpeckle().clone(); m.color = new THREE.Color(0xd3cec4); m.roughness = 0.95; return m; }),
};
