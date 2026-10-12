// Procedural canvas textures (seeded, deterministic) for materials we have no scan for.
import * as THREE from 'three';

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function finish(c, { srgb = true, repeat = 1 } = {}) { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; }
function hex(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mix(a, b, t) { return a.map((v, i) => Math.round(v + (b[i] - v) * t)); }
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

// Wood grain: long wavy streaks along +y (planks run vertically in texture space), optional knots, optional whitewash.
export function woodGrain({ base = '#e5cfa5', dark = '#b98a4c', knots = false, wash = 0, planks = 0, seed = 7 } = {}) {
  const W = 1024, H = 1024, [c, g] = canvas(W, H), r = rng(seed);
  const B = hex(base), D = hex(dark);
  const img = g.createImageData(W, H), d = img.data;
  const freq = 0.018 + r() * 0.01, phase = r() * 100;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const wave = Math.sin(x * freq + Math.sin(y * 0.004 + phase) * 6 + Math.sin(y * 0.021) * 1.2);
    let t = 0.5 + 0.5 * wave;
    t = Math.pow(t, 3.2) * 0.9 + (r() * 0.08);
    let col = mix(B, D, t);
    if (wash > 0) col = mix(col, [245, 240, 232], wash);
    const i = (y * W + x) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  if (knots) for (let k = 0; k < 5; k++) { const x = r() * W, y = r() * H, rad = 12 + r() * 22; const grd = g.createRadialGradient(x, y, 2, x, y, rad); grd.addColorStop(0, rgb(mix(D, [40, 25, 10], 0.5))); grd.addColorStop(0.6, rgb(mix(B, D, 0.7))); grd.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grd; g.beginPath(); g.ellipse(x, y, rad * 0.7, rad, 0, 0, Math.PI * 2); g.fill(); }
  if (planks > 0) { g.strokeStyle = 'rgba(60,40,20,0.35)'; g.lineWidth = 2; const n = Math.max(1, Math.round(1 / planks)); for (let i = 1; i < n; i++) { const x = (i / n) * W + (r() - 0.5) * 4; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); } }
  return finish(c);
}

// Rattan / wicker weave: alternating over-under strands.
export function weave({ a = '#d9b476', b = '#b58b4a', scale = 1 } = {}) {
  const W = 512, H = 512, [c, g] = canvas(W, H), A = hex(a), Bc = hex(b);
  const cell = 32 * scale;
  g.fillStyle = rgb(mix(A, Bc, 0.7)); g.fillRect(0, 0, W, H);
  for (let y = 0; y < H / cell; y++) for (let x = 0; x < W / cell; x++) {
    const over = (x + y) % 2 === 0;
    const grd = over ? g.createLinearGradient(x * cell, 0, (x + 1) * cell, 0) : g.createLinearGradient(0, y * cell, 0, (y + 1) * cell);
    grd.addColorStop(0, rgb(Bc)); grd.addColorStop(0.5, rgb(A)); grd.addColorStop(1, rgb(Bc));
    g.fillStyle = grd; g.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2);
  }
  return finish(c, { repeat: 1 });
}

// Square tile grid with grout; n tiles per texture edge.
export function tileGrid({ tile = '#2a2d30', grout = '#c9c6bf', n = 6, gloss = false } = {}) {
  const W = 512, [c, g] = canvas(W, W); g.fillStyle = grout; g.fillRect(0, 0, W, W);
  const s = W / n, gap = Math.max(2, s * 0.045), r = rng(3), T = hex(tile);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = (r() - 0.5) * 12; g.fillStyle = rgb(T.map(k => Math.max(0, Math.min(255, k + v))));
    g.fillRect(x * s + gap / 2, y * s + gap / 2, s - gap, s - gap);
    if (gloss) { const grd = g.createLinearGradient(x * s, y * s, x * s + s, y * s + s); grd.addColorStop(0, 'rgba(255,255,255,0.10)'); grd.addColorStop(1, 'rgba(0,0,0,0.08)'); g.fillStyle = grd; g.fillRect(x * s + gap / 2, y * s + gap / 2, s - gap, s - gap); }
  }
  return finish(c);
}

export function speckle({ base = '#ece6d8', dots = '#8d8577' } = {}) {
  const W = 512, [c, g] = canvas(W, W), r = rng(11); g.fillStyle = base; g.fillRect(0, 0, W, W); g.fillStyle = dots;
  for (let i = 0; i < 2600; i++) { g.globalAlpha = 0.2 + r() * 0.5; g.beginPath(); g.arc(r() * W, r() * W, 0.6 + r() * 1.6, 0, 7); g.fill(); }
  return finish(c);
}

export function rugCheck() {
  const W = 512, [c, g] = canvas(W, W), r = rng(5); g.fillStyle = '#e4e0d8'; g.fillRect(0, 0, W, W);
  const n = 8, s = W / n; for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { if ((x + y) % 2) continue; g.fillStyle = `rgba(90,88,84,${0.35 + r() * 0.3})`; g.fillRect(x * s, y * s, s, s); }
  g.globalAlpha = 0.25; for (let i = 0; i < 4000; i++) { g.fillStyle = r() > 0.5 ? '#fff' : '#000'; g.fillRect(r() * W, r() * W, 2, 2); }
  return finish(c, { repeat: 1 });
}

export function chalkboard() {
  const W = 512, H = 256, [c, g] = canvas(W, H); g.fillStyle = '#23262a'; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 3; g.lineCap = 'round'; g.font = 'italic 34px Georgia'; g.fillStyle = 'rgba(255,255,255,0.9)';
  g.fillText('2513 Croton Ave', 40, 90); g.font = '28px Georgia'; g.fillText('welcome home ☼', 60, 150);
  g.beginPath(); g.moveTo(40, 110); g.lineTo(300, 112); g.stroke(); g.globalAlpha = 0.08; g.fillStyle = '#fff'; for (let i = 0; i < 400; i++) g.fillRect(Math.random() * W, Math.random() * H, 3, 1);
  return finish(c);
}

export function redPainting() {
  const W = 512, H = 400, [c, g] = canvas(W, H); g.fillStyle = '#f3efe6'; g.fillRect(0, 0, W, H);
  const grd = g.createRadialGradient(256, 200, 20, 256, 200, 220); grd.addColorStop(0, '#e63b2a'); grd.addColorStop(0.7, '#c4281c'); grd.addColorStop(1, '#f3efe6');
  g.fillStyle = grd; g.fillRect(20, 20, W - 40, H - 40); g.strokeStyle = '#3a1a12'; g.lineWidth = 6; g.beginPath(); g.moveTo(140, 300); g.quadraticCurveTo(250, 80, 380, 260); g.stroke();
  return finish(c);
}

export function books() {
  const W = 1024, H = 256, [c, g] = canvas(W, H), r = rng(21), pal = ['#9d3b2f', '#2f4a6b', '#e2d6c2', '#3b3a36', '#7f8f5c', '#c7a24a', '#f0ebe1', '#5a3b2e', '#8aa5b5', '#2c2c2c'];
  g.fillStyle = '#efe9dd'; g.fillRect(0, 0, W, H); let x = 0;
  while (x < W) { const w = 14 + r() * 26, h = 150 + r() * 95; g.fillStyle = pal[Math.floor(r() * pal.length)]; g.fillRect(x, H - h, w - 2, h); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x + 3, H - h + 10, w - 8, 3); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + w - 4, H - h, 2, h); x += w; }
  return finish(c);
}

export function louver() {
  const W = 256, H = 1024, [c, g] = canvas(W, H); g.fillStyle = '#e9d6b0'; g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 18) { const grd = g.createLinearGradient(0, y, 0, y + 18); grd.addColorStop(0, '#f2e4c6'); grd.addColorStop(0.55, '#d9bf90'); grd.addColorStop(1, '#a9875a'); g.fillStyle = grd; g.fillRect(20, y, W - 40, 18); }
  g.fillStyle = '#e6d2aa'; g.fillRect(0, 0, 20, H); g.fillRect(W - 20, 0, 20, H);
  return finish(c);
}
export function louverNormal() {
  const W = 256, H = 1024, [c, g] = canvas(W, H); g.fillStyle = 'rgb(128,128,255)'; g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 18) { const grd = g.createLinearGradient(0, y, 0, y + 18); grd.addColorStop(0, 'rgb(128,80,235)'); grd.addColorStop(0.5, 'rgb(128,128,255)'); grd.addColorStop(1, 'rgb(128,175,235)'); g.fillStyle = grd; g.fillRect(20, y, W - 40, 18); }
  return finish(c, { srgb: false });
}

export function screen() {
  const W = 512, H = 320, [c, g] = canvas(W, H); const grd = g.createLinearGradient(0, 0, W, H); grd.addColorStop(0, '#c9d8e8'); grd.addColorStop(1, '#eef2f5'); g.fillStyle = grd; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(40, 40, 200, 140); g.fillRect(270, 40, 200, 60); g.fillRect(270, 120, 200, 60); g.fillStyle = '#5a6b7c'; g.font = '20px sans-serif'; g.fillText('Studio Hu Dwelling', 50, 70);
  return finish(c);
}

// Soft leaf card with alpha: a single lanceolate leaf (used by plants.js).
export function leaf({ color = '#4f8a3c', vein = '#9ad17a', w = 256, h = 512, shape = 'lanceolate' } = {}) {
  const [c, g] = canvas(w, h); g.clearRect(0, 0, w, h);
  g.fillStyle = color; g.beginPath();
  if (shape === 'banana') { g.moveTo(w / 2, h); g.bezierCurveTo(w * 0.05, h * 0.8, w * 0.02, h * 0.2, w / 2, 0); g.bezierCurveTo(w * 0.98, h * 0.2, w * 0.95, h * 0.8, w / 2, h); }
  else if (shape === 'fan') { g.moveTo(w / 2, h); for (let i = 0; i <= 9; i++) { const a = Math.PI + (i / 9) * Math.PI; g.lineTo(w / 2 + Math.cos(a) * w * 0.48, h * 0.55 + Math.sin(a) * h * 0.55); } }
  else { g.moveTo(w / 2, h); g.quadraticCurveTo(w * 0.1, h * 0.55, w / 2, 0); g.quadraticCurveTo(w * 0.9, h * 0.55, w / 2, h); }
  g.closePath(); g.fill();
  g.strokeStyle = vein; g.globalAlpha = 0.5; g.lineWidth = 3; g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, h * 0.05); g.stroke(); g.lineWidth = 1.5;
  for (let i = 1; i < 14; i++) { const y = h * (0.1 + i * 0.062); g.beginPath(); g.moveTo(w / 2, y + 10); g.lineTo(w * 0.12, y - h * 0.05); g.moveTo(w / 2, y + 10); g.lineTo(w * 0.88, y - h * 0.05); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
