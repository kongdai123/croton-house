// Helpers for props_living.js: local materials (matte/glazed ceramics, rough stoneware, white-washed ash, seagrass,
// linen), small canvas textures (≤512 px), hollow lathe profiles, a draped-cloth sheet, an organic wave bowl, dried
// flower sprays and an open-book spread. Shared leaf/stem/batch machinery comes from plants_parts.js.
import { THREE, M, shadow } from '../kit.js';
import { paint, lcg, rr, cardGeo, stemGeo, Batch, plainMat } from './plants_parts.js';
import { weaveMaps } from './living_parts.js';

export const once = (fn) => { let v; return () => (v ??= fn()); };
export { lcg, rr };
export function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
export function ctex(c, { srgb = true, repeat = [1, 1] } = {}) {
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------------------------------------------------------------- textures
// Hand-thrown ceramic: slow throwing rings plus fine grog grain (bump only).
const throwBump = once(() => {
  const [c, g] = canvas(256, 256), r = lcg(901); g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 2) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.03 + 0.05 * Math.abs(Math.sin(y * 0.11))})`; g.fillRect(0, y, 256, 2); }
  for (let i = 0; i < 2600; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.16)'; g.fillRect(r() * 256, r() * 256, 1 + r(), 1 + r()); }
  return ctex(c, { srgb: false, repeat: [3, 2] });
});
// Rough sandy stoneware (dining vase, g23): beige body, pitted darker craters, lighter mineral flecks.
const stoneTex = once(() => {
  const W = 512, [c, g] = canvas(W, W), [cb, gb] = canvas(W, W), r = lcg(907);
  g.fillStyle = '#d3c9b8'; g.fillRect(0, 0, W, W); gb.fillStyle = '#9a9a9a'; gb.fillRect(0, 0, W, W);
  for (let i = 0; i < 900; i++) { const x = r() * W, y = r() * W, s = 4 + r() * 22; g.globalAlpha = 0.08 + r() * 0.12; g.fillStyle = r() < 0.5 ? '#e4dccd' : '#bfb3a0'; g.beginPath(); g.ellipse(x, y, s, s * (0.6 + r() * 0.5), r() * 3, 0, 7); g.fill(); }
  for (let i = 0; i < 3800; i++) {
    const x = r() * W, y = r() * W, s = 0.8 + Math.pow(r(), 2.5) * 6;
    g.globalAlpha = 0.35 + r() * 0.4; g.fillStyle = r() < 0.75 ? '#8f826d' : '#6f6453'; g.beginPath(); g.arc(x, y, s, 0, 7); g.fill();
    gb.globalAlpha = 0.6; gb.fillStyle = '#2a2a2a'; gb.beginPath(); gb.arc(x, y, s, 0, 7); gb.fill();
    gb.globalAlpha = 0.35; gb.fillStyle = '#e0e0e0'; gb.beginPath(); gb.arc(x - s * 0.6, y - s * 0.6, s * 0.7, 0, 7); gb.fill();
  }
  for (let i = 0; i < 1500; i++) { g.globalAlpha = 0.5 + r() * 0.5; g.fillStyle = r() < 0.5 ? '#f2ede2' : '#ece4d4'; g.fillRect(r() * W, r() * W, 1 + r() * 2, 1 + r() * 2); }
  g.globalAlpha = gb.globalAlpha = 1;
  return { map: ctex(c, { repeat: [2, 1] }), bump: ctex(cb, { srgb: false, repeat: [2, 1] }) };
});
// White-washed ash (the window-seat riser tray, g08): chalky white with soft grey grain and a few cathedral arches.
const whiteAshTex = once(() => {
  const W = 512, [c, g] = canvas(W, W), r = lcg(911); g.fillStyle = '#f1efea'; g.fillRect(0, 0, W, W);
  g.lineCap = 'round';
  for (let i = 0; i < 70; i++) { const y0 = r() * W, a = 6 + r() * 20, f = 0.004 + r() * 0.01, ph = r() * 7; g.strokeStyle = `rgba(150,145,135,${0.08 + r() * 0.14})`; g.lineWidth = 0.6 + r() * 1.8; g.beginPath(); for (let x = 0; x <= W; x += 8) g.lineTo(x, y0 + a * Math.sin(x * f + ph)); g.stroke(); }
  for (let k = 0; k < 4; k++) { const cx = r() * W, cy = r() * W; for (let j = 1; j < 9; j++) { g.strokeStyle = `rgba(150,145,135,${0.1 + r() * 0.08})`; g.lineWidth = 1; g.beginPath(); g.ellipse(cx, cy, j * 14, j * 5, 0, Math.PI, 2 * Math.PI); g.stroke(); } }
  return ctex(c);
});
// Folding chess box top: 8 × 4 squares (maple / walnut) inside a walnut band, faint grain, satin lacquer.
const chessTex = once(() => {
  const W = 512, H = 256, [c, g] = canvas(W, H), r = lcg(913), b = 18, s = (W - 2 * b) / 8;
  g.fillStyle = '#7a4f2e'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 4; j++) {
    const dark = (i + j) % 2 === 1; g.fillStyle = dark ? '#8b5a33' : '#e2c595'; g.fillRect(b + i * s, b + j * s * ((H - 2 * b) / (4 * s)), s, (H - 2 * b) / 4);
  }
  for (let i = 0; i < 400; i++) { const y = r() * H; g.strokeStyle = `rgba(${r() < 0.5 ? '60,35,15' : '255,240,210'},${0.06 + r() * 0.08})`; g.lineWidth = 0.6 + r(); g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(W * 0.3, y + rr(r, -3, 3), W * 0.6, y + rr(r, -3, 3), W, y + rr(r, -2, 2)); g.stroke(); }
  g.strokeStyle = 'rgba(40,22,10,0.5)'; g.lineWidth = 2; g.strokeRect(b, b, W - 2 * b, H - 2 * b);
  const t = ctex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
});
// Seagrass plait: rows of twisted strands (colour + bump). u around the basket, v up.
const seagrassTex = once(() => {
  const W = 512, [c, g] = canvas(W, W), [cb, gb] = canvas(W, W), r = lcg(917), rows = 16, rh = W / rows;
  g.fillStyle = '#7d7350'; g.fillRect(0, 0, W, W); gb.fillStyle = '#202020'; gb.fillRect(0, 0, W, W);
  const cols = ['#b4a77a', '#a39663', '#c2b68b', '#9a8f62', '#b9ae83', '#8f875c'];
  for (let j = 0; j < rows; j++) {
    const y0 = j * rh, dir = j % 2 ? 1 : -1, n = 40;
    for (let i = -1; i <= n; i++) {
      const x0 = (i + (j % 2) * 0.5) * (W / n), col = cols[Math.floor(r() * cols.length)];
      const pts = [[x0, y0 + 1], [x0 + dir * W / n * 0.9, y0 + 1], [x0 + dir * W / n * 0.4, y0 + rh - 1], [x0 - dir * W / n * 0.5, y0 + rh - 1]];
      g.fillStyle = col; g.beginPath(); pts.forEach(([x, y], k) => k ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(60,50,30,0.35)'; g.lineWidth = 1; g.stroke();
      const grd = gb.createLinearGradient(x0, y0, x0 + dir * W / n * 0.3, y0 + rh); grd.addColorStop(0, '#606060'); grd.addColorStop(0.5, '#f0f0f0'); grd.addColorStop(1, '#606060');
      gb.fillStyle = grd; gb.beginPath(); pts.forEach(([x, y], k) => k ? gb.lineTo(x, y) : gb.moveTo(x, y)); gb.closePath(); gb.fill();
    }
    g.fillStyle = 'rgba(40,32,18,0.55)'; g.fillRect(0, y0, W, 1.2); gb.fillStyle = '#000'; gb.fillRect(0, y0, W, 1.5);
  }
  return { map: ctex(c), bump: ctex(cb, { srgb: false }) };
});
// Carved fish-scale apron band (antique side table, g19): white arches over black recesses, worn paint.
const scallopTex = once(() => {
  const W = 512, H = 128, [c, g] = canvas(W, H), [cb, gb] = canvas(W, H), r = lcg(919);
  g.fillStyle = '#e9e3d6'; g.fillRect(0, 0, W, H); gb.fillStyle = '#c0c0c0'; gb.fillRect(0, 0, W, H);
  const n = 10, w = W / n;
  for (const [ctx, dark, light] of [[g, '#1f1b17', '#efe9dd'], [gb, '#202020', '#f4f4f4']]) {
    ctx.fillStyle = dark; ctx.fillRect(0, H * 0.28, W, H * 0.5);
    for (let i = 0; i < n; i++) { const cx = i * w + w / 2; ctx.fillStyle = light; ctx.beginPath(); ctx.arc(cx, H * 0.8, w * 0.48, Math.PI, 0); ctx.lineTo(cx + w * 0.34, H * 0.8); ctx.arc(cx, H * 0.8, w * 0.34, 0, Math.PI, true); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.arc(cx, H * 0.8, w * 0.18, Math.PI, 0); ctx.fill(); }
    ctx.fillStyle = light; ctx.fillRect(0, 0, W, H * 0.2); ctx.fillRect(0, H * 0.84, W, H * 0.16);
  }
  for (let i = 0; i < 260; i++) { g.globalAlpha = 0.25 + r() * 0.5; g.fillStyle = r() < 0.6 ? '#8a7a64' : '#f6f2ea'; g.fillRect(r() * W, r() * H, 1 + r() * 6, 1 + r() * 2); }
  g.globalAlpha = 1;
  return { map: ctex(c), bump: ctex(cb, { srgb: false }) };
});
// Flat-woven cotton runner: cream field, charcoal pin stripes near the ends, slubby weft.
const runnerTex = once(() => {
  const W = 128, H = 512, [c, g] = canvas(W, H), r = lcg(923); g.fillStyle = '#e6e0d3'; g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 2) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,250' : '150,140,120'},${0.08 + r() * 0.12})`; g.fillRect(0, y, W, 1.2); }
  for (const y0 of [26, 486]) for (const [o, h] of [[0, 3], [8, 7], [20, 3]]) { g.fillStyle = '#2e2b27'; g.fillRect(0, y0 + (y0 > 256 ? -o - h : o), W, h); }
  for (let x = 6; x < W; x += 12) { g.fillStyle = 'rgba(120,110,95,0.25)'; g.fillRect(x, 0, 1, H); }
  return ctex(c);
});
// Open-book spread (g21/g22): text column + small plate on the left page, a black-and-white architecture photo right.
const spreadTex = once(() => {
  const W = 512, H = 256, [c, g] = canvas(W, H), r = lcg(929); g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#3a3835'; g.font = 'bold 13px Georgia'; g.fillText('Dwelling in Light', 26, 34);
  for (let i = 0; i < 15; i++) { const w = 150 + r() * 50; g.fillStyle = 'rgba(70,68,64,0.55)'; g.fillRect(26, 48 + i * 9, i === 14 ? w * 0.5 : w, 3); }
  g.fillStyle = '#bdb7ab'; g.fillRect(26, 190, 90, 46); g.fillStyle = '#8e877b'; g.fillRect(26, 214, 90, 22);
  const gx = g.createLinearGradient(270, 0, 490, 0); gx.addColorStop(0, '#2c2c2c'); gx.addColorStop(1, '#6a6a6a'); g.fillStyle = gx; g.fillRect(268, 18, 222, 220);
  g.fillStyle = '#d8d8d6'; g.beginPath(); g.moveTo(268, 150); g.lineTo(420, 96); g.lineTo(490, 112); g.lineTo(490, 238); g.lineTo(268, 238); g.fill();
  g.fillStyle = '#9b9b99'; g.beginPath(); g.moveTo(268, 150); g.lineTo(420, 96); g.lineTo(420, 238); g.lineTo(268, 238); g.fill();
  g.fillStyle = '#1b1b1b'; for (let i = 0; i < 6; i++) g.fillRect(292 + i * 21, 168 - i * 7, 10, 36);
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(250, 0, 12, H);
  return ctex(c);
});
// Abstract prints for the framed pieces (seeded): 1 palm-leaf line drawing, 2 arch + sun, 3 clay colour field.
export function printTex(seed) {
  return (printTex.cache ??= {})[seed] ??= (() => {
    const W = 400, H = 500, [c, g] = canvas(W, H), r = lcg(931 + seed); g.fillStyle = '#f2eee6'; g.fillRect(0, 0, W, H);
    g.lineCap = 'round'; g.lineJoin = 'round';
    if (seed % 3 === 1) {
      g.strokeStyle = '#2b2925'; g.lineWidth = 3.2; g.beginPath(); g.moveTo(200, 470); g.bezierCurveTo(205, 360, 190, 250, 212, 90); g.stroke();
      for (let i = 0; i < 13; i++) { const t = 0.15 + i * 0.065, y = 470 - t * 380, x = 200 + 8 * Math.sin(t * 3); for (const sd of [-1, 1]) { const L = 120 * Math.sin(Math.PI * Math.min(1, t * 1.05)) + 20; g.lineWidth = 2.2; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + sd * L * 0.5, y - 40, x + sd * L, y - 20 + sd * 4); g.stroke(); } }
    } else if (seed % 3 === 2) {
      g.fillStyle = '#d9c6a6'; g.beginPath(); g.moveTo(80, 440); g.lineTo(80, 250); g.arc(180, 250, 100, Math.PI, 0); g.lineTo(280, 440); g.closePath(); g.fill();
      g.fillStyle = '#b8643f'; g.beginPath(); g.arc(285, 150, 44, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#2b2925'; g.lineWidth = 2; g.beginPath(); g.moveTo(50, 440); g.lineTo(350, 440); g.stroke();
      g.fillStyle = '#8f9a84'; g.fillRect(150, 330, 160, 110);
    } else {
      g.fillStyle = '#c9a27c'; g.fillRect(40, 50, 320, 230); g.fillStyle = '#e3d5c0'; g.fillRect(40, 280, 320, 170);
      g.fillStyle = '#8a5a3e'; g.globalAlpha = 0.85; g.fillRect(40, 268, 320, 18); g.globalAlpha = 1;
      g.strokeStyle = '#2b2925'; g.lineWidth = 4; g.beginPath(); g.moveTo(70, 380); g.bezierCurveTo(150, 330, 240, 420, 330, 360); g.stroke();
    }
    g.globalAlpha = 0.05; for (let i = 0; i < 3000; i++) { g.fillStyle = r() > 0.5 ? '#000' : '#fff'; g.fillRect(r() * W, r() * H, 1, 1); } g.globalAlpha = 1;
    return ctex(c);
  })();
}

// ---------------------------------------------------------------- materials
export const L = {
  matteWhite: once(() => new THREE.MeshStandardMaterial({ color: 0xf0eee8, roughness: 0.86, bumpMap: throwBump(), bumpScale: 0.5 })),
  glazeWhite: once(() => new THREE.MeshPhysicalMaterial({ color: 0xf6f5f1, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.2, bumpMap: throwBump(), bumpScale: 0.2 })),
  stoneware: once(() => { const t = stoneTex(); return new THREE.MeshStandardMaterial({ map: t.map, bumpMap: t.bump, bumpScale: 2.2, roughness: 0.96 }); }),
  stoneInside: once(() => new THREE.MeshStandardMaterial({ color: 0x8f8574, roughness: 1 })),
  pewterGlaze: once(() => new THREE.MeshStandardMaterial({ color: 0x9b9893, roughness: 0.42, metalness: 0.45 })),
  greyGlaze: once(() => new THREE.MeshPhysicalMaterial({ color: 0xa9a7a1, roughness: 0.45, clearcoat: 0.3 })),
  brass: once(() => new THREE.MeshStandardMaterial({ color: 0xc29b57, roughness: 0.32, metalness: 1 })),
  whiteAsh: once(() => new THREE.MeshStandardMaterial({ map: whiteAshTex(), roughness: 0.62 })),
  chessTop: once(() => new THREE.MeshStandardMaterial({ map: chessTex(), roughness: 0.36 })),
  chessSeam: once(() => new THREE.MeshStandardMaterial({ color: 0x3a2516, roughness: 0.8 })),
  seagrass: once(() => { const t = seagrassTex(); return new THREE.MeshStandardMaterial({ map: t.map, bumpMap: t.bump, bumpScale: 2.5, roughness: 0.92 }); }),
  seagrassIn: once(() => { const t = seagrassTex(); return new THREE.MeshStandardMaterial({ map: t.map, color: 0x9a927e, bumpMap: t.bump, bumpScale: 2, roughness: 0.95, side: THREE.BackSide }); }),
  rope: once(() => new THREE.MeshStandardMaterial({ color: 0xa79a72, roughness: 0.9 })),
  soil: once(() => new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: 1 })),
  nursery: once(() => new THREE.MeshStandardMaterial({ color: 0x262422, roughness: 0.7 })),
  scallop: once(() => { const t = scallopTex(); return new THREE.MeshStandardMaterial({ map: t.map, bumpMap: t.bump, bumpScale: 2.5, roughness: 0.9 }); }),
  // stonewashed linen: oatmeal throw, cream folded throw; ~1.5 mm plain weave in the normal map
  linenOat: once(() => new THREE.MeshPhysicalMaterial({ color: 0xcfc2ac, roughness: 0.95, sheen: 0.7, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xfff4e4), normalMap: linenWeave(), normalScale: new THREE.Vector2(0.6, 0.6), side: THREE.DoubleSide })),
  linenTaupe: once(() => new THREE.MeshPhysicalMaterial({ color: 0xa99a86, roughness: 0.95, sheen: 0.6, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xf4ece0), normalMap: linenWeave(), normalScale: new THREE.Vector2(0.7, 0.7) })),
  runner: once(() => new THREE.MeshStandardMaterial({ map: runnerTex(), roughness: 0.95, normalMap: linenWeave(), normalScale: new THREE.Vector2(0.8, 0.8) })),
  paper: once(() => new THREE.MeshStandardMaterial({ map: spreadTex(), roughness: 0.75 })),
  pages: once(() => new THREE.MeshStandardMaterial({ color: 0xefeadf, roughness: 0.9 })),
  bookCloth: once(() => new THREE.MeshStandardMaterial({ color: 0x34312e, roughness: 0.75 })),
  glow: once(() => new THREE.MeshStandardMaterial({ color: 0xfff2dc, emissive: 0xffdcaa, emissiveIntensity: 1.2, roughness: 0.6, side: THREE.DoubleSide })),
  led: once(() => new THREE.MeshStandardMaterial({ color: 0xdfeaff, emissive: 0xcfe0ff, emissiveIntensity: 1.4 })),
  darkGlass: once(() => new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.2, metalness: 0.4 })),
  coffee: once(() => new THREE.MeshStandardMaterial({ color: 0x2a170c, roughness: 0.15 })),
  wax: once(() => new THREE.MeshStandardMaterial({ color: 0xf7f3ea, roughness: 0.6 })),
  frameOak: once(() => { const m = M.oak().clone(); m.color = new THREE.Color(0xf4e6cc); return m; }),
  matBoard: once(() => new THREE.MeshStandardMaterial({ color: 0xfbfaf6, roughness: 0.95 })),
  print: (seed) => (L.print.cache ??= {})[seed] ??= new THREE.MeshStandardMaterial({ map: printTex(seed), roughness: 0.85 }),
  bark: once(() => new THREE.MeshStandardMaterial({ color: 0x6d5d4b, roughness: 0.9 })),
};
const linenWeave = once(() => { const w = weaveMaps({ kind: 'plain', cells: 48, strength: 2 }); w.normal.repeat.set(14, 14); return w.normal; });

// ---------------------------------------------------------------- profiles
// Catmull-Rom smoothed [r, h] profile so lathed bellies don't facet.
export function smoothProfile(pts, n = 32) { const c = new THREE.SplineCurve(pts.map(([r, h]) => new THREE.Vector2(r, h))); return c.getSpacedPoints(n).map(v => [v.x, v.y]); }
// Hollow vessel for lathe(): outer profile bottom→lip, a rounded lip, then the inner wall back down to the floor.
export function hollow(outer, wall, floor, n = 32) {
  const o = smoothProfile(outer, n), top = o.at(-1);
  const inner = o.slice().reverse().map(([r, h]) => [Math.max(0.0015, r - wall), h]).filter(([, h]) => h >= floor && h <= top[1] - wall * 0.5);
  return [[0, 0], ...o, [top[0] - wall * 0.5, top[1] + wall * 0.25], ...inner, [0, floor]];
}
export function lathe(profile, mat, { seg = 32, x = 0, y = 0, z = 0 } = {}) {
  const m = new THREE.Mesh(new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), seg), mat); m.position.set(x, y, z); return shadow(m);
}
// Lathe with UVs in metres (u around a circumference `circ`, v up the height) so tiling textures keep their scale.
export function latheMetric(profile, mat, { seg = 32, tile = 0.25, circ = 1 } = {}) {
  const m = lathe(profile, mat, { seg }), p = m.geometry.attributes.position, uv = m.geometry.attributes.uv;
  const k = Math.max(1, Math.round(circ / tile));
  for (let i = 0; i < p.count; i++) uv.setXY(i, uv.getX(i) * k, p.getY(i) / tile);
  return m;
}

// ---------------------------------------------------------------- cloth
// A cloth band draped over a cross-section path: `path` [[x, y], ...] in the XY plane (centre line of the cloth), the
// band runs along Z for `width`. `fold(u, z, x, y)` ≥ 0 pushes the cloth outward (along the path's left normal) to
// make soft folds; (x, y) is the path point. Returns a closed thin solid (both faces + edges).
export function drape(path, width, thick, mat, { fold = () => 0, nu = 60, nz = 34, tileU = 1, tileV = 1 } = {}) {
  const curve = new THREE.SplineCurve(path.map(([x, y]) => new THREE.Vector2(x, y))), P = curve.getSpacedPoints(nu), len = curve.getLength();
  const Nrm = P.map((p, i) => { const a = P[Math.max(0, i - 1)], b = P[Math.min(nu, i + 1)], dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l]; });
  const pos = [], uv = [], idx = [], stride = nz + 1, layer = (nu + 1) * stride;
  for (const side of [1, -1]) for (let i = 0; i <= nu; i++) for (let j = 0; j <= nz; j++) {
    const u = i / nu, z = (j / nz - 0.5) * width, d = fold(u, z, P[i].x, P[i].y), off = d + side * thick / 2;
    pos.push(P[i].x + Nrm[i][0] * off, P[i].y + Nrm[i][1] * off, z); uv.push(u * len / tileU, z / tileV);
  }
  const q = (a, b, c, d, flip) => flip ? idx.push(a, c, b, b, c, d) : idx.push(a, b, c, b, d, c);
  for (let i = 0; i < nu; i++) for (let j = 0; j < nz; j++) { const a = i * stride + j; q(a, a + 1, a + stride, a + stride + 1, false); q(a + layer, a + layer + 1, a + layer + stride, a + layer + stride + 1, true); }
  for (let i = 0; i < nu; i++) { for (const [j, f] of [[0, true], [nz, false]]) { const a = i * stride + j, b = (i + 1) * stride + j; q(a, b, a + layer, b + layer, f); } }
  for (let j = 0; j < nz; j++) { for (const [i, f] of [[0, false], [nu, true]]) { const a = i * stride + j; q(a, a + 1, a + layer, a + 1 + layer, f); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return shadow(new THREE.Mesh(g, mat));
}

// ---------------------------------------------------------------- wave bowl
// Organic oval bowl with an undulating rim (g21): outer skin from a small oval foot to the rim, inner skin offset by
// the wall, joined over the rim. a × b = rim half-axes, H = mean rim height.
export function waveBowlGeo(a, b, H, { wall = 0.005, waves = (t) => 0.022 * Math.sin(2 * t + 0.6) + 0.01 * Math.sin(3 * t + 1.9), nt = 72, nr = 16 } = {}) {
  const pos = [], idx = [], ring = nt + 1, foot = 0.32, yF = 0.012;
  const surf = (k, s, inner) => {
    const t = (k / nt) * Math.PI * 2, rimY = H + waves(t), r = foot + (1 - foot) * Math.pow(Math.sin(s * Math.PI / 2), 0.85), y = yF + (rimY - yF) * Math.pow(s, 1.7);
    const shrink = inner ? 1 - wall / Math.min(a, b) * 1.3 : 1, yy = inner ? Math.max(yF + wall, y + wall * (1 - s)) : y;
    return [a * r * shrink * Math.cos(t), s === 0 && inner ? yF + wall : yy, b * r * shrink * Math.sin(t)];
  };
  for (const inner of [false, true]) for (let i = 0; i <= nr; i++) for (let k = 0; k <= nt; k++) pos.push(...surf(k, i / nr, inner));
  const L2 = (nr + 1) * ring;
  for (let i = 0; i < nr; i++) for (let k = 0; k < nt; k++) { const a0 = i * ring + k, b0 = a0 + ring; idx.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1); idx.push(L2 + a0, L2 + a0 + 1, L2 + b0, L2 + b0, L2 + a0 + 1, L2 + b0 + 1); }
  for (let k = 0; k < nt; k++) { const o = nr * ring + k, n = L2 + nr * ring + k; idx.push(o, n, o + 1, n, n + 1, o + 1); }
  // foot disc (outer bottom) and inner floor are closed by the s = 0 rings converging on a small oval: cap them
  const cO = pos.length / 3; pos.push(0, yF, 0); const cI = cO + 1; pos.push(0, yF + wall, 0);
  for (let k = 0; k < nt; k++) { idx.push(cO, k + 1, k); idx.push(cI, L2 + k, L2 + k + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2).map((_, i) => (i % 2 ? pos[(i >> 1) * 3 + 1] : pos[(i >> 1) * 3]) * 4), 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- dried flower spray
// Fine branching dried stems out of a vase mouth with clusters of tiny florets (baby's breath, limonium).
// mouth = [x, y, z] of the neck centre, rMouth its radius; the cloud fills a dome of `spread` × `height` above it.
export function driedSpray(seed, { mouth = [0, 0, 0], rMouth = 0.03, spread = 0.16, height = 0.16, stems = 14, branches = 6, florets = 9,
  fSize = [0.0035, 0.0055], fCols = ['#f2eee4', '#e9e3d4', '#f7f4ec'], stemCol = '#9a8d68', lean = 0 } = {}) {
  const r = lcg(seed), sb = new Batch(), fb = new Batch(), fg = new THREE.IcosahedronGeometry(1, 0);
  const col = (h) => new THREE.Color(h).toArray();
  for (let s = 0; s < stems; s++) {
    const a = r() * Math.PI * 2, out = Math.sqrt(r()), base = [mouth[0] + Math.cos(a) * rMouth * 0.5 * r(), mouth[1] - 0.05, mouth[2] + Math.sin(a) * rMouth * 0.5 * r()];
    const top = [mouth[0] + Math.cos(a) * spread * out + lean, mouth[1] + height * (0.55 + 0.45 * (1 - out * out)) * rr(r, 0.85, 1.05), mouth[2] + Math.sin(a) * spread * out];
    const mid = [base[0] + (top[0] - base[0]) * 0.35, base[1] + (top[1] - base[1]) * 0.55, base[2] + (top[2] - base[2]) * 0.35];
    sb.add(stemGeo([base, mid, top], [0.0016, 0.0009], { seg: 5, radial: 3 }), { tint: col(stemCol) });
    for (let b = 0; b < branches; b++) {
      const t = rr(r, 0.45, 1), p0 = [mid[0] + (top[0] - mid[0]) * t, mid[1] + (top[1] - mid[1]) * t, mid[2] + (top[2] - mid[2]) * t];
      const ba = a + rr(r, -1.3, 1.3), bl = rr(r, 0.025, 0.06), p1 = [p0[0] + Math.cos(ba) * bl, p0[1] + rr(r, 0.01, 0.04), p0[2] + Math.sin(ba) * bl];
      sb.add(stemGeo([p0, p1], 0.0007, { seg: 1, radial: 3 }), { tint: col(stemCol) });
      for (let f = 0; f < florets; f++) {
        const s0 = rr(r, ...fSize), q = [p1[0] + rr(r, -0.012, 0.012), p1[1] + rr(r, -0.006, 0.012), p1[2] + rr(r, -0.012, 0.012)];
        fb.add(fg, { pos: q, s: [s0, s0 * 0.85, s0], tint: col(fCols[Math.floor(r() * fCols.length)]).map(v => v * rr(r, 0.92, 1.05)) });
      }
    }
  }
  const g = new THREE.Group();
  g.add(sb.mesh(plainMat('propsDriedStem', 0xffffff, { rough: 0.85 })), fb.mesh(plainMat('propsFloret', 0xffffff, { rough: 0.95 })));
  return g;
}

// ---------------------------------------------------------------- leaves
// Fiddle-leaf fig: violin-waisted, wavy margin, glossy dark green, pale midrib and laterals.
export function texFiddle() {
  return paint('props-fiddle', 256, 256, (g, W, H, r) => {
    const hw = (t) => (W / 2 - 6) * (0.18 + 0.82 * Math.sin(Math.min(1, t / 0.14) * Math.PI / 2)) * (0.6 + 0.4 * (t < 0.35 ? 0 : Math.min(1, (t - 0.35) / 0.4) ** 0.8)) * (t > 0.84 ? Math.sqrt(Math.max(0, 1 - ((t - 0.84) / 0.16) ** 2)) : 1) * (1 + 0.025 * Math.sin(t * 40));
    const path = () => { g.beginPath(); for (let i = 0; i <= 90; i++) { const t = i / 90; g.lineTo(W / 2 - hw(t), H - (H - 4) * t); } for (let i = 90; i >= 0; i--) { const t = i / 90; g.lineTo(W / 2 + hw(t) * 0.96, H - (H - 4) * t); } g.closePath(); };
    path(); const rg = g.createRadialGradient(W * 0.5, H * 0.45, 8, W * 0.5, H * 0.5, W * 0.62); rg.addColorStop(0, '#3f6d2c'); rg.addColorStop(1, '#22451c'); g.fillStyle = rg; g.fill();
    g.save(); path(); g.clip();
    for (let i = 0; i < 160; i++) { g.fillStyle = r() < 0.5 ? 'rgba(200,230,150,0.04)' : 'rgba(0,20,0,0.06)'; g.beginPath(); g.ellipse(r() * W, r() * H, 4 + r() * 14, 3 + r() * 9, r() * 3, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(190,215,140,0.55)'; g.lineCap = 'round';
    for (let j = 1; j < 9; j++) { const t = 0.08 + j * 0.095, y = H - (H - 4) * t; g.lineWidth = 1.6; for (const sd of [-1, 1]) { g.beginPath(); g.moveTo(W / 2, y + 6); g.quadraticCurveTo(W / 2 + sd * hw(t) * 0.5, y - 4, W / 2 + sd * hw(Math.min(1, t + 0.06)) * 0.92, y - 20); g.stroke(); } }
    g.lineWidth = 4; g.strokeStyle = 'rgba(205,225,160,0.7)'; g.beginPath(); g.moveTo(W / 2, H); g.lineTo(W / 2, 14); g.stroke();
    g.lineWidth = 3; g.strokeStyle = 'rgba(20,40,10,0.45)'; path(); g.stroke();
    g.restore();
  });
}
// Snake plant (Sansevieria laurentii): sword leaf, grey-green cross bands on dark green, yellow margins.
export function texSansevieria() {
  return paint('props-sansev', 64, 512, (g, W, H, r) => {
    const hw = (t) => (W / 2 - 2) * (0.55 + 0.45 * Math.sin(Math.min(1, t / 0.3) * Math.PI / 2)) * (t > 0.55 ? Math.pow(Math.max(0, (1 - t) / 0.45), 0.75) : 1);
    const path = () => { g.beginPath(); for (let i = 0; i <= 80; i++) { const t = i / 80; g.lineTo(W / 2 - hw(t), H - H * t); } for (let i = 80; i >= 0; i--) { const t = i / 80; g.lineTo(W / 2 + hw(t), H - H * t); } g.closePath(); };
    path(); g.fillStyle = '#d4c24a'; g.fill();
    g.save(); path(); g.clip();
    g.beginPath(); for (let i = 0; i <= 80; i++) { const t = i / 80; g.lineTo(W / 2 - hw(t) * 0.78, H - H * t); } for (let i = 80; i >= 0; i--) { const t = i / 80; g.lineTo(W / 2 + hw(t) * 0.78, H - H * t); } g.closePath(); g.fillStyle = '#2b4a26'; g.fill();
    for (let y = 0; y < H; y += 9 + r() * 10) { g.strokeStyle = `rgba(160,185,140,${0.35 + r() * 0.3})`; g.lineWidth = 2 + r() * 3; g.beginPath(); for (let x = 0; x <= W; x += 4) g.lineTo(x, y + 4 * Math.sin(x * 0.25 + y)); g.stroke(); }
    g.restore();
  });
}
// Pilea peperomioides: round coin leaf, mid green, faint radiating veins.
export function texPilea() {
  return paint('props-pilea', 128, 128, (g, W, H, r) => {
    g.beginPath(); g.ellipse(W / 2, H * 0.5, W * 0.46, H * 0.46, 0, 0, 7); const rg = g.createRadialGradient(W * 0.5, H * 0.5, 4, W * 0.5, H * 0.5, W * 0.5); rg.addColorStop(0, '#6aa046'); rg.addColorStop(1, '#3f7a2c'); g.fillStyle = rg; g.fill();
    g.strokeStyle = 'rgba(200,230,160,0.35)'; g.lineWidth = 1.2; for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2; g.beginPath(); g.moveTo(W / 2, H * 0.5); g.lineTo(W / 2 + Math.cos(a) * W * 0.4, H * 0.5 + Math.sin(a) * H * 0.4); g.stroke(); }
    g.fillStyle = 'rgba(220,240,180,0.6)'; g.beginPath(); g.arc(W / 2, H * 0.5, 3, 0, 7); g.fill();
  });
}
export { cardGeo, stemGeo, Batch, plainMat };
