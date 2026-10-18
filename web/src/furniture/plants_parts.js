// plants_parts — helpers for plants.js: seeded RNG, painted leaf textures (alpha cards with colour bleed so
// mipmaps do not darken the edges), bent leaf-card geometry, tapered stem tubes, a merge batch that tints every
// card through vertex colours (one draw call per material, ±8 % colour per leaf), and a wind-sway animator.
import { THREE, shadow, declare } from '../kit.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const TAU = Math.PI * 2, GOLD = Math.PI * (3 - Math.sqrt(5));

// ---------- deterministic randomness (LCG) ----------
export function lcg(seed) {
  let s = (Math.imul((seed | 0) + 0x9e37, 2654435761) ^ 0x5bd1e995) >>> 0;
  const r = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; r(); r(); return r;
}
export const rr = (r, a, b) => a + (b - a) * r();
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

// ---------- colour helpers ----------
export const H2 = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const mixc = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
export const scl = (a, f) => a.map(v => Math.max(0, Math.min(255, v * f)));
export const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
// Per-leaf multiplicative tint (vertex colour): brightness ±amt, small hue drift.
export function tint(r, amt = 0.08, hue = 0.04) { const l = 1 + rr(r, -amt, amt); return [l * (1 + rr(r, -hue, hue)), l, l * (1 + rr(r, -hue, hue))]; }

// ---------- painted textures ----------
const TEX = new Map();
function bleed(d, W, H) {
  const N = W * H, known = new Uint8Array(N); let sr = 0, sg = 0, sb = 0, n = 0;
  for (let i = 0; i < N; i++) { if (d[i * 4 + 3] > 8) { known[i] = 1; if (d[i * 4 + 3] > 200) { sr += d[i * 4]; sg += d[i * 4 + 1]; sb += d[i * 4 + 2]; n++; } } }
  for (let pass = 0; pass < 3; pass++) {   // grow opaque colours 3 px into the transparent area (bilinear edge texels)
    const add = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (known[i]) continue; let r = 0, g = 0, b = 0, c = 0, j;
      if (x > 0 && known[j = i - 1]) { r += d[j * 4]; g += d[j * 4 + 1]; b += d[j * 4 + 2]; c++; }
      if (x < W - 1 && known[j = i + 1]) { r += d[j * 4]; g += d[j * 4 + 1]; b += d[j * 4 + 2]; c++; }
      if (y > 0 && known[j = i - W]) { r += d[j * 4]; g += d[j * 4 + 1]; b += d[j * 4 + 2]; c++; }
      if (y < H - 1 && known[j = i + W]) { r += d[j * 4]; g += d[j * 4 + 1]; b += d[j * 4 + 2]; c++; }
      if (c) add.push(i, r / c, g / c, b / c);
    }
    for (let k = 0; k < add.length; k += 4) { const i = add[k]; d[i * 4] = add[k + 1]; d[i * 4 + 1] = add[k + 2]; d[i * 4 + 2] = add[k + 3]; known[i] = 1; }
  }
  if (n) for (let i = 0; i < N; i++) if (!known[i]) { d[i * 4] = sr / n; d[i * 4 + 1] = sg / n; d[i * 4 + 2] = sb / n; }
}
// Mip chain whose alpha keeps the same alpha-test coverage as the full-size level, so thin leaves, blades and
// plume hairs do not dissolve into nothing at a distance (the classic alpha-tested-foliage problem).
function mipChain(d0, W, H) {
  const cover = (d, n, s) => { let c = 0; for (let i = 0; i < n; i++) if (d[i * 4 + 3] * s >= 127.5) c++; return c / n; };
  const c0 = cover(d0, W * H, 1), out = [{ data: d0, width: W, height: H }];
  let d = d0, w = W, h = H;
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1), nd = new Uint8Array(nw * nh * 4), af = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      let r = 0, g = 0, b = 0, a = 0, ws = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const sx = Math.min(w - 1, x * 2 + dx), sy = Math.min(h - 1, y * 2 + dy), i = (sy * w + sx) * 4, wa = d[i + 3] / 255 + 0.02;
        r += d[i] * wa; g += d[i + 1] * wa; b += d[i + 2] * wa; ws += wa; a += d[i + 3];
      }
      const o = (y * nw + x) * 4; nd[o] = r / ws; nd[o + 1] = g / ws; nd[o + 2] = b / ws; af[y * nw + x] = a / 4;
    }
    let lo = 0.5, hi = 8;
    for (let it = 0; it < 14; it++) { const m = (lo + hi) / 2; let c = 0; for (let i = 0; i < af.length; i++) if (af[i] * m >= 127.5) c++; if (c / af.length < c0) lo = m; else hi = m; }
    for (let i = 0; i < af.length; i++) nd[i * 4 + 3] = Math.min(255, af[i] * hi);
    out.push({ data: nd, width: nw, height: nh }); d = nd; w = nw; h = nh;
  }
  return out;
}
export function paint(key, W, H, draw, { opaque = false, repeat = false } = {}) {
  if (TEX.has(key)) return TEX.get(key);
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true });
  draw(g, W, H, lcg(hashStr(key)));
  const src = g.getImageData(0, 0, W, H).data, d = new Uint8Array(src.length);
  for (let y = 0; y < H; y++) d.set(src.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);   // flip: row 0 = v 0
  if (!opaque) bleed(d, W, H);
  const t = new THREE.DataTexture(d, W, H, THREE.RGBAFormat);
  t.mipmaps = opaque ? [] : mipChain(d, W, H); t.generateMipmaps = opaque; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.needsUpdate = true; TEX.set(key, t); return t;
}
// outline of a leaf described by its half-width hw(t), t: 0 base (canvas bottom) → 1 tip (canvas top)
function leafPath(g, cx, H, hw, asym = 1, steps = 80, top = 0) {
  g.beginPath();
  for (let i = 0; i <= steps; i++) { const t = i / steps; g.lineTo(cx - hw(t), H - (H - top) * t); }
  for (let i = steps; i >= 0; i--) { const t = i / steps; g.lineTo(cx + hw(t) * asym, H - (H - top) * t); }
  g.closePath();
}
function vgrad(g, H, stops) { const gr = g.createLinearGradient(0, H, 0, 0); for (const [o, c] of stops) gr.addColorStop(o, c); return gr; }

// Banana paddle: pale midrib, dense parallel lateral veins, wind tears; `old` = yellowing, browned, shredded.
export function texBanana(old = false) {
  return paint(old ? 'banana-old' : 'banana', 256, 1024, (g, W, H, r) => {
    const hw = (t) => { const b = t < 0.12 ? 0.3 + 0.7 * Math.sin((t / 0.12) * Math.PI / 2) : 1; const tp = t > 0.8 ? Math.sqrt(Math.max(0, 1 - ((t - 0.8) / 0.2) ** 2)) : 1; return (W / 2 - 3) * b * tp * (1 - 0.08 * t); };
    const mid = H2(old ? '#a59a4a' : '#558f34'), edge = H2(old ? '#8c7a3c' : '#3f7527');
    leafPath(g, W / 2, H, hw, 0.9);
    const gx = g.createLinearGradient(0, 0, W, 0); gx.addColorStop(0, css(edge)); gx.addColorStop(0.4, css(mid)); gx.addColorStop(0.5, css(scl(mid, 1.1))); gx.addColorStop(0.6, css(mid)); gx.addColorStop(1, css(edge));
    g.fillStyle = gx; g.fill();
    g.save(); leafPath(g, W / 2, H, hw, 0.9); g.clip();
    g.fillStyle = vgrad(g, H, [[0, 'rgba(200,220,140,0.3)'], [0.15, 'rgba(200,220,140,0)'], [1, 'rgba(10,30,5,0.2)']]); g.fillRect(0, 0, W, H);
    for (let i = 0; i < 260; i++) { g.fillStyle = r() < 0.5 ? `rgba(240,255,200,${0.03 + r() * 0.05})` : `rgba(0,25,0,${0.03 + r() * 0.07})`; g.beginPath(); g.ellipse(r() * W, r() * H, 3 + r() * 10, 10 + r() * 40, 0, 0, TAU); g.fill(); }
    g.lineWidth = 1;
    for (let y = 2; y < H + 80; y += 3) { g.strokeStyle = (y % 12 === 2) ? 'rgba(20,50,10,0.2)' : 'rgba(235,250,200,0.08)'; g.beginPath(); g.moveTo(0, y - 64); g.quadraticCurveTo(W * 0.3, y - 8, W / 2, y); g.quadraticCurveTo(W * 0.7, y - 8, W, y - 64); g.stroke(); }
    if (old) {
      for (const [lw, c] of [[46, 'rgba(120,85,35,0.55)'], [20, 'rgba(95,62,28,0.85)'], [6, 'rgba(60,40,20,0.9)']]) { g.lineWidth = lw; g.strokeStyle = c; leafPath(g, W / 2, H, hw, 0.9); g.stroke(); }
      for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(${90 + r() * 40},${60 + r() * 30},30,${0.15 + r() * 0.3})`; const y = r() * H, x = r() < 0.5 ? r() * W * 0.3 : W - r() * W * 0.3; g.beginPath(); g.moveTo(W / 2, y + 30); g.quadraticCurveTo(x * 0.5 + W / 4, y + 8, x, y - 50); g.lineWidth = 3 + r() * 8; g.strokeStyle = g.fillStyle; g.stroke(); }
    } else { g.lineWidth = 3; g.strokeStyle = 'rgba(140,130,60,0.45)'; leafPath(g, W / 2, H, hw, 0.9); g.stroke(); }
    g.restore();
    g.fillStyle = old ? '#c9b46e' : '#cddc95'; g.beginPath(); g.moveTo(W / 2 - 7, H); g.lineTo(W / 2 - 1.5, H * 0.05); g.lineTo(W / 2 + 1.5, H * 0.05); g.lineTo(W / 2 + 7, H); g.fill();
    g.strokeStyle = 'rgba(40,70,20,0.35)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(W / 2 + 7, H); g.lineTo(W / 2 + 2, H * 0.05); g.stroke();
    // wind tears along the veins, edge → midrib
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000';
    const tears = old ? 34 : 10;
    for (let i = 0; i < tears; i++) {
      const t = 0.14 + r() * 0.74, side = r() < 0.5 ? -1 : 1, y = H * (1 - t), w = hw(t);
      const depth = old ? 0.45 + r() * 0.55 : 0.2 + r() * 0.6, wd = old ? 1.5 + r() * 6 : 1 + r() * 2.5;
      const ex = W / 2 + side * (w + 8), ey = y - 64 * Math.min(1, (w + 8) / (W / 2)), ix = W / 2 + side * w * (1 - depth), iy = y - 64 * (w * (1 - depth) / (W / 2)) ** 1.6;
      g.beginPath(); g.moveTo(ex, ey - wd); g.lineTo(ix, iy); g.lineTo(ex, ey + wd); g.closePath(); g.fill();
    }
    if (old) for (let i = 0; i < 6; i++) { const t = 0.5 + r() * 0.5, side = r() < 0.5 ? -1 : 1; g.beginPath(); g.ellipse(W / 2 + side * hw(t), H * (1 - t), 20 + r() * 40, 30 + r() * 60, 0, 0, TAU); g.fill(); }
    g.globalCompositeOperation = 'source-over';
  });
}

// Sabal / palmetto fan: ~36 pleated segments radiating from the hastula, split tips, solid centre.
export function texFan(dead = false) {
  return paint(dead ? 'fan-dead' : 'fan', 512, 512, (g, W, H, r) => {
    const bx = W / 2, by = H * 0.97, n = 38, a0 = 0.08, a1 = Math.PI - 0.08, da = (a1 - a0) / n / 2;
    const Rx = W * 0.49, Ry = H * 0.94;
    const cIn = H2(dead ? '#a88c5c' : '#93a95c'), cMid = H2(dead ? '#9a7a48' : '#557d3d'), cTip = H2(dead ? '#7a5c34' : '#5f8644');
    const order = [...Array(n).keys()].sort(() => 0); // deterministic order
    for (const i of order) {
      const a = a0 + (a1 - a0) * (i + 0.5) / n + rr(r, -0.01, 0.01);
      const R = 1 / Math.sqrt((Math.cos(a) / Rx) ** 2 + (Math.sin(a) / Ry) ** 2) * rr(r, 0.86, 1.0);
      const P = (rad, ang) => [bx + Math.cos(ang) * rad, by - Math.sin(ang) * rad];
      const half = (f) => da * (f < 0.42 ? 1.15 : 1.15 - (f - 0.42) / 0.58 * 0.75);
      g.beginPath(); g.moveTo(bx, by);
      for (let k = 1; k <= 12; k++) { const f = k / 12; g.lineTo(...P(R * f, a + half(f))); }
      g.lineTo(...P(R * 0.86, a)); // bifid tip notch
      for (let k = 12; k >= 1; k--) { const f = k / 12; g.lineTo(...P(R * f, a - half(f))); }
      g.closePath();
      const lk = rr(r, 0.88, 1.1), gr = g.createRadialGradient(bx, by, 0, bx, by, R);
      gr.addColorStop(0, css(scl(cIn, lk))); gr.addColorStop(0.35, css(scl(cMid, lk))); gr.addColorStop(1, css(scl(cTip, lk * rr(r, 0.9, 1.05))));
      g.fillStyle = gr; g.fill(); g.lineWidth = 1; g.strokeStyle = 'rgba(20,35,10,0.35)'; g.stroke();
      g.strokeStyle = dead ? 'rgba(230,210,160,0.35)' : 'rgba(225,240,180,0.4)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(...P(R * 0.08, a)); g.lineTo(...P(R * 0.86, a)); g.stroke();
      if (r() < 0.4) { g.strokeStyle = dead ? 'rgba(200,170,120,0.8)' : 'rgba(170,150,90,0.7)'; g.lineWidth = 1; g.beginPath(); g.moveTo(...P(R * 0.9, a + da)); g.quadraticCurveTo(...P(R * 1.02, a + da * 1.4), ...P(R * 1.05, a + da * 0.6)); g.stroke(); }
    }
    g.fillStyle = dead ? '#7a6038' : '#7d8f4a'; g.beginPath(); g.ellipse(bx, by - 6, 16, 22, 0, 0, TAU); g.fill();
    if (dead) for (let i = 0; i < 30; i++) { g.globalCompositeOperation = 'destination-out'; const a = rr(r, 0.1, 3.0), R = rr(r, 120, 250); g.beginPath(); g.ellipse(bx + Math.cos(a) * R, by - Math.sin(a) * R, 6 + r() * 14, 6 + r() * 14, 0, 0, TAU); g.fill(); g.globalCompositeOperation = 'source-over'; }
  });
}

// Strap leaf (bromeliad): parallel fine lines, faint cross banding, colour from sheath (base) to tip.
export function texStrap(key, base, mid, tip) {
  return paint('strap-' + key, 128, 512, (g, W, H, r) => {
    const hw = (t) => (W / 2 - 4) * (t < 0.62 ? 0.8 + 0.2 * Math.sin(Math.min(1, t / 0.35) * Math.PI / 2) : Math.pow(Math.max(0, (1 - t) / 0.38), 0.8));
    leafPath(g, W / 2, H, hw);
    g.fillStyle = vgrad(g, H, [[0, base], [0.28, mid], [0.7, mid], [1, tip]]); g.fill();
    g.save(); leafPath(g, W / 2, H, hw); g.clip();
    for (let x = 0; x < W; x += 3) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'; g.fillRect(x, 0, 1.5, H); }
    for (let y = 0; y < H; y += 6 + r() * 6) { g.fillStyle = `rgba(255,255,240,${0.03 + r() * 0.05})`; g.fillRect(0, y, W, 2); }
    g.fillStyle = 'rgba(255,255,230,0.12)'; g.fillRect(W / 2 - 2, 0, 4, H);
    g.lineWidth = 5; g.strokeStyle = 'rgba(20,10,10,0.35)'; leafPath(g, W / 2, H, hw); g.stroke();
    g.restore();
  });
}

// Croton atlas: 4 variegated, glossy leaf cells side by side (u = k/4 … (k+1)/4).
export const CROTON_CELLS = 4;
export function texCroton() {
  return paint('croton', 512, 512, (g, W, H, r) => {
    const cells = [['#1d3d1a', '#e9c63c', '#e2b830'], ['#7a2215', '#f39a36', '#25361a'], ['#c06a1c', '#ffd44c', '#5a2414'], ['#294a1f', '#d83c27', '#e6b532']];
    cells.forEach(([b, v, s], k) => {
      const cw = 128, cx = k * cw + cw / 2;
      const hw = (t) => (cw / 2 - 6) * Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(t, 0.72))), 0.85);
      leafPath(g, cx, H, hw, 1, 60, 6); g.fillStyle = b; g.fill();
      g.save(); leafPath(g, cx, H, hw, 1, 60, 6); g.clip();
      const rg = g.createRadialGradient(cx, H * 0.55, 4, cx, H * 0.55, cw * 0.8); rg.addColorStop(0, 'rgba(255,255,255,0.08)'); rg.addColorStop(1, 'rgba(0,0,0,0.25)'); g.fillStyle = rg; g.fillRect(k * cw, 0, cw, H);
      for (let i = 0; i < 26; i++) { const t = rr(r, 0.05, 0.95), y = H - (H - 6) * t, x = cx + rr(r, -1, 1) * hw(t) * 0.9; g.fillStyle = css(H2(s), 0.45 + r() * 0.45); g.beginPath(); g.ellipse(x, y, 2 + r() * 9, 3 + r() * 14, rr(r, -0.6, 0.6), 0, TAU); g.fill(); }
      g.strokeStyle = v; g.lineCap = 'round';
      for (let j = 1; j < 10; j++) { const t = j / 10.5, y = H - (H - 6) * t; g.lineWidth = 2.4; for (const sd of [-1, 1]) { g.beginPath(); g.moveTo(cx, y); g.quadraticCurveTo(cx + sd * hw(t) * 0.55, y - 12, cx + sd * hw(Math.min(1, t + 0.07)) * 0.95, y - 34); g.stroke(); } }
      g.lineWidth = 6; g.beginPath(); g.moveTo(cx, H); g.lineTo(cx, 10); g.stroke();
      g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.3)'; leafPath(g, cx, H, hw, 1, 60, 6); g.stroke();
      g.restore();
    });
  });
}

// Sprig: a twig carrying many small leaves (shrubs, tree canopy). Card reads as a leafy clump, not one leaf.
export function texSprig(key, { W = 256, H = 256, n = 16, len = [40, 56], wid = [14, 20], base = '#3d7531', hi = '#7fb158', twig = '#5d4a35', rx = 0.34, ry = 0.36, dark = 0.7 } = {}) {
  return paint('sprig-' + key, W, H, (g, W, H, r) => {
    const B = H2(base), Hc = H2(hi), cx = W / 2;
    g.lineCap = 'round'; g.strokeStyle = twig;
    const topY = H * 0.12, midX = cx + rr(r, -W * 0.05, W * 0.05);
    g.lineWidth = Math.max(2, W * 0.016); g.beginPath(); g.moveTo(cx, H); g.quadraticCurveTo(midX, H * 0.55, cx + rr(r, -W * 0.06, W * 0.06), topY); g.stroke();
    const pts = []; for (let i = 0; i < n; i++) { const a = r() * TAU, d = Math.sqrt(r()); pts.push([cx + Math.cos(a) * d * W * rx, H * 0.5 + Math.sin(a) * d * H * ry]); }
    g.lineWidth = Math.max(1, W * 0.006);
    for (const [x, y] of pts) { const sy = Math.min(H * 0.95, y + H * 0.12); g.beginPath(); g.moveTo(midX + (cx - midX) * 0.3, sy); g.quadraticCurveTo((x + cx) / 2, (y + sy) / 2, x, y); g.stroke(); }
    pts.sort((p, q) => q[1] - p[1]);
    for (const [x, y] of pts) {
      const ang = Math.atan2(y - H * 0.62, x - cx) + rr(r, -0.7, 0.7), L = rr(r, ...len), Wd = rr(r, ...wid);
      const lk = rr(r, dark, 1.15), c0 = scl(mixc(B, Hc, rr(r, 0, 0.35)), lk * 0.85), c1 = scl(mixc(B, Hc, rr(r, 0.3, 0.8)), lk);
      g.save(); g.translate(x, y); g.rotate(ang);
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(L * 0.42, -Wd, L, 0); g.quadraticCurveTo(L * 0.42, Wd, 0, 0);
      const lg = g.createLinearGradient(0, 0, L, 0); lg.addColorStop(0, css(c0)); lg.addColorStop(1, css(c1)); g.fillStyle = lg; g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 0.8; g.stroke();
      g.strokeStyle = 'rgba(255,255,215,0.3)'; g.lineWidth = Math.max(0.8, Wd * 0.08); g.beginPath(); g.moveTo(0, 0); g.lineTo(L * 0.92, 0); g.stroke();
      g.restore();
    }
  });
}

// Norfolk Island pine branch segment: an axis with pinnate rope-like branchlets of tiny curved needles.
export function texPine() {
  return paint('pine', 128, 512, (g, W, H, r) => {
    const cx = W / 2; g.lineCap = 'round';
    const needle = (x, y, ang, len) => { g.strokeStyle = css(scl(H2(r() < 0.3 ? '#4f7d3b' : '#2c5225'), rr(r, 0.75, 1.2))); g.lineWidth = 2.6; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); g.stroke(); };
    const rope = (x0, y0, ang, L) => { for (let s = 0; s < L; s += 1.8) { const x = x0 + Math.cos(ang) * s, y = y0 + Math.sin(ang) * s, k = 1 - 0.45 * (s / L); for (const sd of [-1, 1]) needle(x, y, ang + sd * rr(r, 0.6, 1.1), 10 * k); } };
    for (let y = H - 24; y > 24; y -= 20) {
      const t = 1 - y / H, L = (W * 0.46) * (1 - 0.45 * t) * rr(r, 0.85, 1.05);
      for (const sd of [-1, 1]) rope(cx, y + rr(r, -4, 4), -Math.PI / 2 + sd * rr(r, 0.85, 1.05), L);
    }
    rope(cx, H - 2, -Math.PI / 2, H - 8);
    g.strokeStyle = '#4a3a24'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(cx, H); g.lineTo(cx, 40); g.stroke();
  });
}

// Coleus leaf: ovate, crenate margin, burgundy with pink veins and a darker heart.
export function texColeus() {
  return paint('coleus', 256, 256, (g, W, H, r) => {
    const hw = (t) => (W / 2 - 8) * Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(t, 0.62))), 0.8) * (1 + 0.07 * Math.abs(Math.sin(t * Math.PI * 11)));
    leafPath(g, W / 2, H, hw, 1, 120, 6);
    const rg = g.createRadialGradient(W / 2, H * 0.65, 4, W / 2, H * 0.6, W * 0.6); rg.addColorStop(0, '#24081a'); rg.addColorStop(0.55, '#4a1e30'); rg.addColorStop(0.9, '#5b2a3c'); rg.addColorStop(1, '#4a4a24');
    g.fillStyle = rg; g.fill();
    g.save(); leafPath(g, W / 2, H, hw, 1, 120, 6); g.clip();
    for (let i = 0; i < 300; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,200,220,0.05)' : 'rgba(0,0,0,0.08)'; g.beginPath(); g.arc(r() * W, r() * H, 1 + r() * 4, 0, TAU); g.fill(); }
    g.strokeStyle = 'rgba(208,96,138,0.75)'; g.lineCap = 'round';
    for (let j = 1; j < 7; j++) { const t = j / 7.5, y = H - (H - 6) * t; g.lineWidth = 1.6; for (const sd of [-1, 1]) { g.beginPath(); g.moveTo(W / 2, y); g.quadraticCurveTo(W / 2 + sd * hw(t) * 0.5, y - 10, W / 2 + sd * hw(Math.min(1, t + 0.1)) * 0.85, y - 40); g.stroke(); } }
    g.lineWidth = 3; g.beginPath(); g.moveTo(W / 2, H); g.lineTo(W / 2, 14); g.stroke();
    g.restore();
  });
}

// Golden-pothos heart leaf with yellow streaks.
export function texHeart() {
  return paint('heart', 256, 256, (g, W, H, r) => {
    const path = () => { g.beginPath(); g.moveTo(W / 2, H * 0.84); g.bezierCurveTo(W * 0.3, H * 1.02, W * 0.0, H * 0.8, W * 0.08, H * 0.5); g.bezierCurveTo(W * 0.16, H * 0.24, W * 0.4, H * 0.12, W / 2, H * 0.02); g.bezierCurveTo(W * 0.6, H * 0.12, W * 0.84, H * 0.24, W * 0.92, H * 0.5); g.bezierCurveTo(W * 1.0, H * 0.8, W * 0.7, H * 1.02, W / 2, H * 0.84); g.closePath(); };
    path(); const rg = g.createRadialGradient(W * 0.45, H * 0.5, 6, W / 2, H * 0.5, W * 0.6); rg.addColorStop(0, '#5aa543'); rg.addColorStop(1, '#2f6e27'); g.fillStyle = rg; g.fill();
    g.save(); path(); g.clip();
    for (let i = 0; i < 18; i++) { g.strokeStyle = `rgba(230,220,120,${0.25 + r() * 0.35})`; g.lineWidth = 2 + r() * 5; const x = W / 2 + rr(r, -80, 80); g.beginPath(); g.moveTo(W / 2, H * 0.84); g.quadraticCurveTo(x, H * 0.5, x * 0.6 + W * 0.2, H * 0.08); g.stroke(); }
    g.strokeStyle = 'rgba(200,230,150,0.6)'; g.lineWidth = 3; g.beginPath(); g.moveTo(W / 2, H * 0.84); g.lineTo(W / 2, H * 0.06); g.stroke();
    g.restore();
  });
}

// Fountain-grass foxtail plume / pampas plume: many fine hairs off an axis.
export function texPlume(key, { W = 64, H = 256, hairs = 700, len = [6, 20], cols = ['#d8c3a0', '#c9a796', '#e8d9bd'], angle = [0.4, 1.1], env = 0.6 } = {}) {
  return paint('plume-' + key, W, H, (g, W, H, r) => {
    const cx = W / 2; g.lineCap = 'round';
    for (let i = 0; i < hairs; i++) {
      const t = Math.pow(r(), 0.85) * 0.94 + 0.03, y = H - t * H, e = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), env), sd = r() < 0.5 ? -1 : 1, a = rr(r, ...angle), L = rr(r, ...len) * e;
      g.strokeStyle = css(H2(cols[(r() * cols.length) | 0]), 0.75 + r() * 0.25); g.lineWidth = rr(r, 0.8, 1.6);
      g.beginPath(); g.moveTo(cx, y); g.quadraticCurveTo(cx + sd * Math.sin(a) * L * 0.6, y - Math.cos(a) * L * 0.5, cx + sd * Math.sin(a) * L, y - Math.cos(a) * L * 1.1); g.stroke();
    }
    g.strokeStyle = 'rgba(150,120,80,0.8)'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, H); g.lineTo(cx, H * 0.06); g.stroke();
  });
}

// Banana pseudostem: pale green streaks, maroon blotches, dried brown sheaths at the bottom. (u around, v up)
export function texBananaStem() {
  return paint('banana-stem', 256, 512, (g, W, H, r) => {
    g.fillStyle = '#a3b373'; g.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 2) { g.fillStyle = r() < 0.5 ? `rgba(220,235,170,${r() * 0.25})` : `rgba(60,80,30,${r() * 0.2})`; g.fillRect(x, 0, 2, H); }
    for (let i = 0; i < 14; i++) { const x = r() * W; g.strokeStyle = 'rgba(70,90,40,0.35)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, H); g.bezierCurveTo(x + 30, H * 0.6, x - 20, H * 0.3, x + 40, 0); g.stroke(); }
    for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(${70 + r() * 40},${30 + r() * 20},${25 + r() * 15},${0.3 + r() * 0.4})`; g.beginPath(); g.ellipse(r() * W, r() * H * 0.85 + H * 0.1, 2 + r() * 6, 4 + r() * 14, 0, 0, TAU); g.fill(); }
    const top = H * 0.62; g.fillStyle = '#7a6040'; g.beginPath(); g.moveTo(0, H); for (let x = 0; x <= W; x += 8) g.lineTo(x, top + Math.sin(x * 0.05) * 20 + r() * 30); g.lineTo(W, H); g.closePath(); g.fill();
    for (let x = 0; x < W; x += 2) { g.fillStyle = `rgba(${r() < 0.5 ? '170,140,95' : '60,40,25'},${0.2 + r() * 0.3})`; g.fillRect(x, top + 20 + r() * 30, 1.5, H); }
  }, { opaque: true });
}

// Ribbed columnar euphorbia skin: ridges at u = k/8 lighter, grooves darker, areoles with short spines on ridges.
export function texCactus() {
  return paint('cactus', 256, 256, (g, W, H, r) => {
    for (let x = 0; x < W; x++) { const f = (x / W) * 8, d = Math.abs(f - Math.round(f)); const c = mixc(H2('#6e9a4c'), H2('#2f5528'), Math.pow(d * 2, 0.8)); g.fillStyle = css(c); g.fillRect(x, 0, 1, H); }
    for (let i = 0; i < 900; i++) { g.fillStyle = r() < 0.6 ? `rgba(220,235,190,${0.05 + r() * 0.08})` : `rgba(10,30,10,${0.05 + r() * 0.08})`; g.fillRect(r() * W, r() * H, 1 + r() * 2, 4 + r() * 18); }
    for (let k = 0; k <= 8; k++) { const x = k * W / 8; for (let y = 8; y < H; y += 16) { g.fillStyle = '#5a4630'; g.beginPath(); g.arc(x, y, 2.2, 0, TAU); g.fill(); g.strokeStyle = 'rgba(235,225,200,0.9)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 4, y - 5); g.moveTo(x, y); g.lineTo(x + 4, y - 5); g.stroke(); } }
  }, { opaque: true, repeat: true });
}

// Old palm leaf base ("boot"): brown fibrous wedge with a split top.
export function texBoot() {
  return paint('boot', 64, 256, (g, W, H, r) => {
    g.beginPath(); g.moveTo(W * 0.35, H); g.lineTo(W * 0.05, H * 0.15); g.lineTo(W * 0.3, 0); g.lineTo(W * 0.5, H * 0.12); g.lineTo(W * 0.7, 0); g.lineTo(W * 0.95, H * 0.15); g.lineTo(W * 0.65, H); g.closePath();
    g.fillStyle = vgrad(g, H, [[0, '#5a452c'], [0.6, '#7d6440'], [1, '#9a8058']]); g.fill();
    g.save(); g.clip(); for (let x = 0; x < W; x += 2) { g.fillStyle = `rgba(${r() < 0.5 ? '200,170,120' : '40,25,10'},${0.2 + r() * 0.3})`; g.fillRect(x, 0, 1, H); } g.restore();
  });
}

// ---------- materials ----------
const MAT = new Map();
// Alpha-tested cards must not be drawn with a scene.overrideMaterial (the main app's GTAO normal/depth pre-pass
// uses a MeshNormalMaterial, which ignores the alpha map and turns every card into an opaque square of fake
// occlusion). So leaf materials opt out of the override (allowOverride = false) and, while an override
// MeshNormalMaterial is active, output view-space normals themselves — with the alpha test still discarding.
// `soft`: both faces share one outward normal instead of flipping per side, so clumps shade as volumes.
function leafShader(m, soft) {
  const uNormalPass = { value: 0 };
  m.allowOverride = false;
  m.onBeforeRender = (renderer, scene) => { uNormalPass.value = scene?.overrideMaterial?.isMeshNormalMaterial ? 1 : 0; };
  m.onBeforeCompile = (s) => {
    s.uniforms.uNormalPass = uNormalPass;
    if (soft) s.fragmentShader = s.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
    s.fragmentShader = 'uniform float uNormalPass;\n' + s.fragmentShader.replace(/}\s*$/, '  if (uNormalPass > 0.5) gl_FragColor = vec4(normalize(normal) * 0.5 + 0.5, 1.0);\n}\n');
  };
  m.customProgramCacheKey = () => 'plants-leaf-' + (soft ? 'soft' : 'hard');
}
export function leafMat(key, map, { rough = 0.62, soft = false, alpha = true, color = 0xffffff, env = 0.8 } = {}) {
  const k = `${key}|${soft}`;
  if (MAT.has(k)) return MAT.get(k);
  const m = new THREE.MeshStandardMaterial({ map, color, alphaTest: alpha && map ? 0.5 : 0, side: THREE.DoubleSide, vertexColors: true, roughness: rough, metalness: 0, envMapIntensity: env });
  leafShader(m, soft);
  m.name = 'plant-' + key; declare(m, { surface: 'foliage' }); MAT.set(k, m); return m;   // lighting manifest: a plant's leaves
}
export function plainMat(key, color, { rough = 0.8, map = null, side = THREE.FrontSide, vertexColors = true } = {}) {
  if (MAT.has(key)) return MAT.get(key);
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, map, side, vertexColors }); m.name = 'plant-' + key;
  declare(m, { surface: 'foliage' }); MAT.set(key, m); return m;   // lighting manifest: a plant's stems, trunk, flowers
}

// ---------- geometry ----------
const _Y = new THREE.Vector3(0, 1, 0), _X = new THREE.Vector3(1, 0, 0);
// Orientation of a card/stem: lean `tilt` from vertical toward azimuth `yaw`, then `roll` about its own length axis.
export function orient(yaw, tilt, roll = 0) {
  return new THREE.Quaternion().setFromAxisAngle(_Y, yaw).multiply(new THREE.Quaternion().setFromAxisAngle(_X, tilt)).multiply(new THREE.Quaternion().setFromAxisAngle(_Y, roll));
}
export const dirOf = (yaw, tilt) => [Math.sin(yaw) * Math.sin(tilt), Math.cos(tilt), Math.cos(yaw) * Math.sin(tilt)];

// Leaf card in leaf space: base at origin, grows along +Y, face normal +Z. `bend` = total droop angle (rad) of the
// centreline toward +Z (outward/down once tilted); `pow` puts the bend toward the tip; `fold` moves the halves
// along the normal (+ droop, − cupped); `taper` narrows to the tip; `twist` rolls the blade along its length.
export function cardGeo(w, h, { sx = 1, sy = 4, bend = 0, pow = 1.6, fold = 0, taper = 0, twist = 0, u0 = 0, u1 = 1 } = {}) {
  const g = new THREE.PlaneGeometry(w, h, sx, sy), p = g.attributes.position, uv = g.attributes.uv, N = 24;
  const cy = [0], cz = [0];
  for (let i = 1; i <= N; i++) { const a = bend * Math.pow((i - 0.5) / N, pow), ds = h / N; cy.push(cy[i - 1] + Math.cos(a) * ds); cz.push(cz[i - 1] + Math.sin(a) * ds); }
  for (let i = 0; i < p.count; i++) {
    const x0 = p.getX(i), t = Math.min(1, Math.max(0, p.getY(i) / h + 0.5)), f = t * N, k = Math.min(N - 1, Math.floor(f)), fr = f - k;
    const y = cy[k] + (cy[k + 1] - cy[k]) * fr, z = cz[k] + (cz[k + 1] - cz[k]) * fr, a = bend * Math.pow(t, pow);
    const x = x0 * (1 - taper * t), xn = x0 / (w / 2), off = fold * xn * xn * (w / 2);
    const tw = twist * t, X = x * Math.cos(tw) - off * Math.sin(tw), Nn = x * Math.sin(tw) + off * Math.cos(tw);
    p.setXYZ(i, X, y - Math.sin(a) * Nn, z + Math.cos(a) * Nn);
    uv.setX(i, u0 + uv.getX(i) * (u1 - u0));
  }
  g.computeVertexNormals(); return g;
}
// Fan (palmate) card: base at origin, spreads in +Y/±X; tips droop radially, halves fold down along the costa.
export function fanGeo(w, h, { seg = 10, droop = 0.3, fold = 0.15 } = {}) {
  const g = new THREE.PlaneGeometry(w, h, seg, seg), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i) + h / 2, rn = Math.hypot(x / (w / 2), y / h);
    p.setXYZ(i, x * (1 - 0.08 * rn * rn), y * (1 - 0.1 * rn * rn), droop * h * rn * rn + fold * Math.abs(x) * (0.4 + rn));
  }
  g.computeVertexNormals(); return g;
}
// Tapered tube along a Catmull-Rom path. rad(t) gives the radius (t 0 → 1). UVs in metres: u around, v along.
export function stemGeo(pts, rad, { seg = 8, radial = 8, uvScale = 1, swap = false, norm = false } = {}) {
  const R = typeof rad === 'function' ? rad : Array.isArray(rad) ? (t) => rad[0] + (rad[1] - rad[0]) * t : () => rad;
  const curve = new THREE.CatmullRomCurve3(pts.map(q => new THREE.Vector3(...q)), false, 'catmullrom', 0.5);
  const fr = curve.computeFrenetFrames(seg, false), L = curve.getLength();
  const pos = [], nor = [], uv = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, P = curve.getPointAt(t), Nn = fr.normals[i], B = fr.binormals[i], r = R(t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU, c = -Math.cos(a), s = Math.sin(a);
      const n = [c * Nn.x + s * B.x, c * Nn.y + s * B.y, c * Nn.z + s * B.z];
      pos.push(P.x + r * n[0], i === 0 && P.y <= 0.001 ? P.y : P.y + r * n[1], P.z + r * n[2]); nor.push(...n);
      const U = norm ? j / radial : (j / radial) * TAU * R(0.5) * uvScale, V = norm ? t : t * L * uvScale; uv.push(swap ? V : U, swap ? U : V);
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < radial; j++) { const a = i * (radial + 1) + j, b = a + radial + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.userData.curve = curve; return g;
}

// Merge many transformed copies into one geometry with per-copy vertex tint (and optional gradient along v).
export class Batch {
  constructor() { this.parts = []; }
  add(geo, { pos = [0, 0, 0], q = null, s = 1, tint: tn = [1, 1, 1], grad = null, soft = null } = {}) {
    const g = geo.clone(); const sc = Array.isArray(s) ? s : [s, s, s];
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...pos), q || new THREE.Quaternion(), new THREE.Vector3(...sc)));
    const n = g.attributes.position.count, col = new Float32Array(n * 3), uv = g.attributes.uv;
    for (let i = 0; i < n; i++) { const c = grad ? grad(uv.getY(i)) : [1, 1, 1]; col[i * 3] = c[0] * tn[0]; col[i * 3 + 1] = c[1] * tn[1]; col[i * 3 + 2] = c[2] * tn[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (soft) {
      const P = g.attributes.position, Nm = g.attributes.normal, v = new THREE.Vector3(), d = new THREE.Vector3();
      for (let i = 0; i < n; i++) { v.fromBufferAttribute(Nm, i); d.fromBufferAttribute(P, i).sub(soft.c); if (soft.flat) d.y *= soft.flat; d.normalize(); if (v.dot(d) < 0) v.negate(); v.lerp(d, soft.k).normalize(); Nm.setXYZ(i, v.x, v.y, v.z); }
    }
    this.parts.push(g); return this;
  }
  get size() { return this.parts.length; }
  mesh(mat) { const g = mergeGeometries(this.parts, false); for (const p of this.parts) p.dispose(); this.parts = []; g.computeBoundingSphere(); return shadow(new THREE.Mesh(g, mat)); }
}

// ---------- wind ----------
// A pivot group at point `at`; children are added in plant coordinates (offset back by −at) so it sways about `at`.
export function pivotAt(parent, at) { const pv = new THREE.Group(); pv.position.set(...at); const inner = new THREE.Group(); inner.position.set(-at[0], -at[1], -at[2]); pv.add(inner); parent.add(pv); return [pv, inner]; }
export function addSway(list, o, i, a = 0.03, f = 0.8) { list.push({ o, x: o.rotation.x, z: o.rotation.z, a, f: f * (0.8 + 0.4 * ((i * 0.618034) % 1)), p: i * 2.39996 }); }
export function swayAnimate(root, list) {
  root.userData.animate = (t) => {
    const gust = 0.75 + 0.25 * Math.sin(t * 0.21) * Math.sin(t * 0.13 + 1.3);
    for (const s of list) { s.o.rotation.x = s.x + s.a * gust * Math.sin(t * s.f + s.p); s.o.rotation.z = s.z + s.a * 0.7 * gust * Math.sin(t * s.f * 0.71 + s.p * 1.7 + 1.1); }
  };
  return root;
}
