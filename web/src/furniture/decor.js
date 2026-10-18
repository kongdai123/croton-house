// decor — fixtures and soft furnishings that appear in every room of 2513 Croton Ave:
// ceiling track + recessed lights, ripplefold sheer curtains, cellular shades, thermostat, the porch's wrought-iron
// scroll columns, the perforated porch sconce, house number, and table-top accessories (vases, tray, bottles, books…).
// Frame: origin on the floor at the footprint centre, +Z = front. Wall items keep their back face at -Z.
import { THREE, M, box, cyl, lathe, extrude, tube, plane, group, at, repeat, cushion,
         autoCollider, describe, shadow , declare } from '../kit.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { animatedToggle } from './outdoor_parts.js';

const CEIL = 2.44;
const once = (fn) => { let v; return () => (v ??= fn()); };
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function ctex(c, { srgb = true, repeat = [1, 1] } = {}) { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; }

// ---------------------------------------------------------------- local materials
const L = {
  white: once(() => new THREE.MeshStandardMaterial({ color: 0xf4f4f1, roughness: 0.42, metalness: 0.05 })),       // powder-coated fixture white
  inner: once(() => new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.55, metalness: 0.3 })),        // black baffle
  baffle: once(() => new THREE.MeshStandardMaterial({ color: 0x1d1d1d, roughness: 0.35, metalness: 0.6, side: THREE.DoubleSide })),
  lens: once(() => new THREE.MeshStandardMaterial({ color: 0xfff2e0, emissive: 0xfff2e0, emissiveIntensity: 1.5, roughness: 0.3, userData: { emits: 'lamp' } })),
  canDisc: once(() => new THREE.MeshStandardMaterial({ color: 0xfff0d8, emissive: 0xfff0d8, emissiveIntensity: 1.6, roughness: 0.4, userData: { emits: 'lamp' } })),
  warm: once(() => new THREE.MeshStandardMaterial({ color: 0xffe2b4, emissive: 0xffd9a0, emissiveIntensity: 2.0, roughness: 0.6, userData: { emits: 'lamp' } })),
  // sheer cloth as a closed 4 mm solid (FrontSide: one face per crossing is drawn); opacity tuned to the bright voile of g24;
  // a slubby linen-voile texture drives colour + alpha so it reads as cloth, not glass.
  voile: once(() => {
    const W = 256, [c, g] = canvas(W, W), r = rng(17); g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, W, W);
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '205,205,205'},${0.25 + r() * 0.35})`; g.fillRect(r() * W, 0, 0.6 + r() * 1.6, W); }
    for (let i = 0; i < 180; i++) { g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '215,215,215'},${0.2 + r() * 0.3})`; g.fillRect(0, r() * W, W, 0.5 + r() * 1.2); }
    return { map: ctex(c, { repeat: [3, 3] }), alpha: ctex(c, { repeat: [3, 3], srgb: false }) };
  }),
  sheerCloth: once(() => sheerMat(0.86)),
  sheerHem: once(() => sheerMat(0.92)),
  sheerTape: once(() => sheerMat(0.88)),
  shade: once(() => {
    const [c, g] = canvas(256, 256), r = rng(41); g.fillStyle = '#f7f6f2'; g.fillRect(0, 0, 256, 256);
    g.globalAlpha = 0.18; for (let i = 0; i < 1400; i++) { g.fillStyle = r() > 0.5 ? '#ffffff' : '#d9d6cf'; g.fillRect(r() * 256, r() * 256, 1, 2 + r() * 6); }
    // Diffuse transmission, denser than voile; the same extras drive the probe shader and Cycles cloth.
    return new THREE.MeshPhysicalMaterial({ map: ctex(c, { repeat: [6, 1] }), color: 0xffffff, roughness: 0.92, sheen: 0.6, sheenColor: new THREE.Color(0xffffff), userData: { sheer: { reflect: 0.65, transmit: 0.35 } } });
  }),
  lcd: once(() => {
    const [c, g] = canvas(128, 80); g.fillStyle = '#3e4440'; g.fillRect(0, 0, 128, 80);
    g.fillStyle = '#c9d6c2'; g.font = 'bold 44px sans-serif'; g.fillText('72', 30, 56); g.font = '14px sans-serif'; g.fillText('°', 84, 30); g.fillText('COOL', 8, 74); g.fillText('AUTO', 86, 74);
    const t = ctex(c); return new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.25, userData: { emits: 'screen' } });
  }),
  perforated: once(() => {
    // irregular "coral" cut-out pattern of the porch sconce (g06): warm light through organic holes
    const [c, g] = canvas(128, 256), r = rng(9); g.fillStyle = '#000'; g.fillRect(0, 0, 128, 256); g.fillStyle = '#fff';
    for (let i = 0; i < 700; i++) { const x = 4 + r() * 120, y = 4 + r() * 248, a = 1.2 + r() * 3, b = 0.8 + r() * 1.6; g.beginPath(); g.ellipse(x, y, a, b, r() * Math.PI, 0, Math.PI * 2); g.fill(); }
    const t = ctex(c);
    return new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.6, metalness: 0.3, emissive: 0xffc98a, emissiveMap: t, emissiveIntensity: 2.2, userData: { emits: 'lamp' } });
  }),
  wash: once(() => {
    // soft up-light fan on the wall: a blurred wedge widening away from the fixture, fading with distance
    const [c, g] = canvas(128, 256); g.filter = 'blur(10px)';
    const grd = g.createLinearGradient(0, 256, 0, 0); grd.addColorStop(0, 'rgba(255,214,150,0.9)'); grd.addColorStop(0.35, 'rgba(255,214,150,0.35)'); grd.addColorStop(1, 'rgba(255,214,150,0)');
    g.fillStyle = grd; g.beginPath(); g.moveTo(52, 250); g.lineTo(76, 250); g.lineTo(118, 10); g.lineTo(10, 10); g.closePath(); g.fill();
    const t = ctex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.4, toneMapped: false });
  }),
  plateWhite: once(() => new THREE.MeshStandardMaterial({ color: 0xf2f1ec, roughness: 0.5, metalness: 0.2 })),
  dried: once(() => new THREE.MeshStandardMaterial({ color: 0xc8b28a, roughness: 0.9 })),
  driedHead: once(() => new THREE.MeshStandardMaterial({ color: 0xe6d8bd, roughness: 1 })),
  driedPink: once(() => new THREE.MeshStandardMaterial({ color: 0xc9a7a4, roughness: 1 })),
  cork: once(() => new THREE.MeshStandardMaterial({ color: 0xb48a5c, roughness: 0.9 })),
  // bottles cut from the window glass: glass, but not panes (no window overlay, kept as they look in the bake)
  glassClear: once(() => { const m = declare(M.glass().clone(), { glass: { pane: false } }); m.opacity = 0.3; return m; }),
  glassGreen: once(() => { const m = declare(M.glass().clone(), { glass: { pane: false } }); m.color = new THREE.Color(0x3f6b42); m.opacity = 0.55; return m; }),
  glassAmber: once(() => { const m = declare(M.glass().clone(), { glass: { pane: false } }); m.color = new THREE.Color(0x8a531a); m.opacity = 0.6; return m; }),
  oil: once(() => declare(new THREE.MeshStandardMaterial({ color: 0xb08a2a, roughness: 0.2, transparent: true, opacity: 0.55, depthWrite: false }), { surface: 'glass' })),
  pages: once(() => {
    const [c, g] = canvas(64, 64); g.fillStyle = '#f1eadb'; g.fillRect(0, 0, 64, 64); g.strokeStyle = 'rgba(150,135,110,0.35)';
    for (let y = 0; y < 64; y += 2) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(64, y + 0.5); g.stroke(); }
    return new THREE.MeshStandardMaterial({ map: ctex(c, { repeat: [1, 6] }), roughness: 0.95 });
  }),
  cloth: (hex) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.85 }),
  foil: once(() => new THREE.MeshStandardMaterial({ color: 0xd8c08a, roughness: 0.35, metalness: 0.8 })),
  wax: once(() => new THREE.MeshPhysicalMaterial({ color: 0xf8f5ee, roughness: 0.6, sheen: 0.3, emissive: 0xfff3e0, emissiveIntensity: 0.04 })),
  wick: once(() => new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 1 })),
  knit: once(() => {
    // chunky rib knit: columns of V stitches
    const W = 256, [c, g] = canvas(W, W); g.fillStyle = '#6f7277'; g.fillRect(0, 0, W, W);
    const cw = 32, ch = 22;
    for (let x = 0; x < W; x += cw) for (let y = -ch; y < W + ch; y += ch) {
      for (const side of [-1, 1]) {
        const grd = g.createLinearGradient(x + cw / 2, y, x + cw / 2 + side * cw / 2, y + ch);
        grd.addColorStop(0, '#9a9da2'); grd.addColorStop(1, '#5c5f63'); g.fillStyle = grd;
        g.beginPath(); g.moveTo(x + cw / 2, y + ch); g.lineTo(x + cw / 2 + side * (cw / 2 - 2), y + 2); g.lineTo(x + cw / 2 + side * (cw / 2 - 9), y); g.lineTo(x + cw / 2, y + ch * 0.62); g.closePath(); g.fill();
      }
    }
    const t = ctex(c, { repeat: [5, 5] });
    return new THREE.MeshPhysicalMaterial({ map: t, color: 0x9a9da2, bumpMap: t, bumpScale: 2.5, roughness: 0.95, sheen: 0.4, sheenColor: new THREE.Color(0xffffff) });
  }),
  print: once(() => {
    // light abstract print: warm off-white paper, a sand arch, a terracotta sun, a charcoal brush line
    const W = 400, H = 500, [c, g] = canvas(W, H); g.fillStyle = '#f3efe7'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ddcdb4'; g.beginPath(); g.moveTo(70, 420); g.lineTo(70, 230); g.arc(170, 230, 100, Math.PI, 0); g.lineTo(270, 420); g.closePath(); g.fill();
    g.fillStyle = '#c98a64'; g.beginPath(); g.arc(270, 160, 52, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#a9b3a3'; g.fillRect(150, 300, 190, 120);
    g.strokeStyle = '#2d2b28'; g.lineWidth = 7; g.lineCap = 'round'; g.beginPath(); g.moveTo(60, 120); g.bezierCurveTo(140, 60, 200, 200, 330, 110); g.stroke();
    const r = rng(77); g.globalAlpha = 0.06; for (let i = 0; i < 3000; i++) { g.fillStyle = r() > 0.5 ? '#000' : '#fff'; g.fillRect(r() * W, r() * H, 1, 1); }
    return new THREE.MeshStandardMaterial({ map: ctex(c), roughness: 0.9 });
  }),
  mat: once(() => new THREE.MeshStandardMaterial({ color: 0xfbfaf6, roughness: 0.95 })),
};

function sheerMat(opacity) {
  const m = M.sheer().clone(); m.side = THREE.FrontSide; m.opacity = opacity; m.color = new THREE.Color(0xffffff);
  m.map = L.voile().map; m.alphaMap = L.voile().alpha; m.roughness = 0.95; m.sheen = 1; m.sheenRoughness = 0.5; m.sheenColor = new THREE.Color(0xffffff);
  m.emissive = new THREE.Color(0xffffff); m.emissiveIntensity = 0.03;
  // Physical voile for the baked view (the composed shader's sheer flag, src/shaders/sheer.glsl.js), photo mode and the Blender export (photo.js,
  // bake/export/setup.py): the fibres reflect ~30% and scatter ~70% of the light from behind through to the viewer.
  // Tuned in Cycles with nothing else glowing: a bunched stack at a window reads ~0.8x the wall above it, as in the
  // listing photos (g19, g20, g23, g24); 0.4 gave ~0.7x, and more transmission barely helps (~0.79x at 0.85).
  // The raster walkthrough keeps the look above (the 0.03 emissive, lifted to 0.12 by day: not a light source).
  m.userData.sheer = { reflect: 0.3, transmit: 0.7 };
  m.customProgramCacheKey = () => 'sheer-voile';
  return m;
}

// ---------------------------------------------------------------- helpers
// Rounded-rectangle outline (for extrude) centred on the origin.
function rrect(w, h, r, n = 4) {
  const pts = [], cs = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 90], [-w / 2 + r, -h / 2 + r, 180], [w / 2 - r, -h / 2 + r, 270]];
  for (const [cx, cy, a0] of cs) for (let i = 0; i <= n; i++) { const a = THREE.MathUtils.degToRad(a0 + (90 * i) / n); pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return pts;
}
// Stroke a 2-D polyline (points [x,y]) into a closed outline of width w (mitred joints, clamped).
function strokeOutline(pts, w) {
  const L = [], R = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const d1 = i > 0 ? norm2([p[0] - a[0], p[1] - a[1]]) : null, d2 = i < pts.length - 1 ? norm2([b[0] - p[0], b[1] - p[1]]) : null;
    const t = d1 && d2 ? norm2([d1[0] + d2[0], d1[1] + d2[1]]) : (d1 || d2);
    const n = [-t[1], t[0]]; let k = 1;
    if (d1 && d2) { const nn = [-d1[1], d1[0]]; k = 1 / Math.max(0.35, n[0] * nn[0] + n[1] * nn[1]); }
    L.push([p[0] + n[0] * w / 2 * k, p[1] + n[1] * w / 2 * k]); R.push([p[0] - n[0] * w / 2 * k, p[1] - n[1] * w / 2 * k]);
  }
  return [...L, ...R.reverse()];
}
function norm2(v) { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }
function arcPts(cx, cy, r, a0, a1, n = 14) { const out = []; for (let i = 0; i <= n; i++) { const a = THREE.MathUtils.degToRad(a0 + (a1 - a0) * i / n); out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return out; }
// Involute-like scroll: starts at radius r0 at angle a0 (rad), turns `turns` revolutions in direction dir (+1 = ccw),
// radius shrinking to r1 with easing exponent `ex`. Returns [x,y] points around centre (cx,cy).
function scrollPts(cx, cy, r0, r1, a0, turns, dir, ex = 1.8, n = 40) {
  const out = [];
  for (let i = 0; i <= n; i++) { const u = i / n, a = a0 + dir * u * turns * Math.PI * 2, r = r1 + (r0 - r1) * Math.pow(1 - u, ex); out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return out;
}
const v3 = (pts, z = 0) => pts.map(([x, y]) => [x, y, z]);
function finish(root, meta, collider = true) { describe(root, meta); if (collider) autoCollider(root); return root; }

// ================================================================ CEILING LIGHTS
// Track head (g08/g09): white cylinder with a finned heat-sink collar at the back, recessed warm lens, hung from a
// track adapter by a short stem and a side knuckle. Built pointing straight down from the knuckle; tilt via the group.
const trackHeadParts = once(() => {
  const h = new THREE.Group(), W = L.white();
  const body = cyl(0.03, 0.03, 0.11, W, { seg: 24, y: -0.055, open: true }); h.add(body);
  for (let i = 0; i < 6; i++) h.add(cyl(0.0315, 0.0315, 0.0035, W, { seg: 24, y: -0.012 - i * 0.0065 }));  // fins
  h.add(cyl(0.03, 0.028, 0.004, W, { seg: 24, y: 0.001 }));                                                // back cap
  h.add(cyl(0.022, 0.0295, 0.016, L.baffle(), { seg: 24, y: -0.101, open: true }));                        // black reflector cone
  h.add(lathe([[0.0295, -0.11], [0.03, -0.11]], W, { seg: 24 }));                                           // rim
  const lens = cyl(0.022, 0.022, 0.002, L.lens(), { seg: 24, y: -0.092 }); h.add(lens);
  return h;
});
function trackHead(tiltX, tiltZ, yaw) {
  const W = L.white(), g = new THREE.Group();
  g.add(box(0.026, 0.03, 0.05, W, { r: 0.004, y: -0.015 }));                       // adapter in the track
  g.add(cyl(0.005, 0.005, 0.045, W, { seg: 12, y: -0.052 }));                        // stem
  const knuckle = cyl(0.009, 0.009, 0.016, W, { seg: 16, y: -0.078, rz: Math.PI / 2 }); g.add(knuckle);
  const pivot = new THREE.Group(); pivot.position.set(0, -0.078, 0); pivot.rotation.set(tiltX, yaw, tiltZ, 'YXZ');
  const head = trackHeadParts().clone(); head.position.set(0.038, 0.03, 0); pivot.add(head);
  pivot.add(cyl(0.006, 0.006, 0.024, W, { seg: 10, x: 0.019, rz: Math.PI / 2 }));   // knuckle arm to the head side
  g.add(pivot); return g;
}
function trackLight() {
  const W = L.white(), root = new THREE.Group(), len = 1.2;
  root.add(box(len, 0.035, 0.03, W, { r: 0.004, y: CEIL - 0.0175 }));
  root.add(box(len - 0.01, 0.004, 0.012, L.inner(), { y: CEIL - 0.0352 }));            // slot in the underside
  for (const s of [-1, 1]) root.add(box(0.006, 0.033, 0.03, W, { r: 0.002, x: s * len / 2, y: CEIL - 0.0175 }));
  // live-end feed with the round canopy (g08 right end)
  root.add(cyl(0.06, 0.062, 0.022, W, { seg: 32, x: len / 2 + 0.07, y: CEIL - 0.011 }));
  root.add(box(0.08, 0.025, 0.03, W, { r: 0.004, x: len / 2 + 0.02, y: CEIL - 0.017 }));
  const heads = [[-0.42, 0.55, 0.2, 0.4], [0.0, 0.42, -0.25, -0.2], [0.42, 0.62, 0.15, Math.PI - 0.5]];
  for (const [x, tx, tz, yaw] of heads) { const h = trackHead(tx, tz, yaw); h.position.set(x, CEIL - 0.035, 0); root.add(h); }
  root.userData.light = { type: 'spot', y: 2.38, intensity: 2.5, angle: 0.6, color: 0xfff1dc, distance: 6 };
  // lighting manifest: one switch per head ("Track light 1".."3"), the track's spot on the first
  declare(root, { fixture: { kind: 'track', heads: true, label: { en: 'Track light', zh: '轨道射灯' } } });
  return finish(root, { id: 'decor-track-light', name: 'Track light (3 heads)', zh: '轨道射灯' }, false);
}

function recessedLight() {
  const root = new THREE.Group();
  root.add(lathe([[0.05, CEIL], [0.05, CEIL - 0.003], [0.047, CEIL - 0.0055], [0.038, CEIL - 0.006], [0.036, CEIL - 0.004], [0.036, CEIL]], L.white(), { seg: 40 }));
  root.add(lathe([[0.036, CEIL - 0.004], [0.031, CEIL - 0.0015]], L.white(), { seg: 40 }));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.032, 40), L.canDisc()); disc.rotation.x = Math.PI / 2; disc.position.y = CEIL - 0.0015; root.add(disc);
  root.userData.light = { type: 'point', y: 2.40, intensity: 0.9, color: 0xfff0d8, distance: 4 };
  declare(root, { fixture: { kind: 'ceiling' } });
  return finish(root, { id: 'decor-recessed-light', name: 'Recessed can light', zh: '筒灯' }, false);
}

// ================================================================ SHEER CURTAIN
// Ripplefold sheer (g24): 12 folds across 1.50 m, 0.06 amplitude, 4 mm cloth. The wave outline is extruded up the
// height (20 steps) and then softly deformed: folds open and flare toward the hem, slow irregular billows.
const CURT_W = 1.5, CURT_TOP = 2.41, FOLDS = 12, AMP = 0.06;
function waveBand(width, thick, ptsPerFold = 14) {
  const n = FOLDS * ptsPerFold, c = [], nr = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, x = (u - 0.5) * width, ph = u * FOLDS * Math.PI * 2;
    const z = AMP * Math.sin(ph), dz = AMP * Math.cos(ph) * FOLDS * Math.PI * 2 / width;
    const l = Math.hypot(1, dz); c.push([x, z]); nr.push([-dz / l, 1 / l]);
  }
  const front = c.map(([x, z], i) => [x + nr[i][0] * thick / 2, z + nr[i][1] * thick / 2]);
  const back = c.map(([x, z], i) => [x - nr[i][0] * thick / 2, z - nr[i][1] * thick / 2]).reverse();
  return [...front, ...back];
}
function clothDeform(x, y, z) {
  const h = THREE.MathUtils.clamp(y / CURT_TOP, 0, 1), lo = 1 - h;
  const amp = 0.86 + 0.26 * lo;                                                 // tighter at the header, open at the hem
  const bil = 0.03 * lo * Math.sin(x * 4.1 + 1.3) + 0.015 * lo * lo * Math.sin(x * 9.3 + 0.4);   // slow billows
  const fold = 1 + (0.12 + 0.2 * lo) * Math.sin(x * 13.7 + 2.1) * Math.cos(x * 5.1);               // folds of uneven depth
  return [x * (1 + 0.035 * lo * lo) + 0.008 * lo * Math.sin(y * 2.3 + x * 5) + 0.01 * Math.sin(x * 7.3 + 0.5), y, z * amp * fold + bil + 0.015 * Math.pow(lo, 6)];
}
function clothBand(y0, y1, thick, mat, steps) {
  const outline = waveBand(CURT_W, thick).map(([x, z]) => new THREE.Vector2(x, -z));
  let g = new THREE.ExtrudeGeometry(new THREE.Shape(outline), { depth: y1 - y0, steps, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); g.translate(0, y0, 0);
  g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g, 1e-5);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const [x, y, z] = clothDeform(p.getX(i), p.getY(i), p.getZ(i)); p.setXYZ(i, x, y, z); }
  g.computeVertexNormals();
  const uv = new Float32Array(p.count * 2); for (let i = 0; i < p.count; i++) { uv[2 * i] = p.getX(i) * 2 + p.getZ(i) * 2; uv[2 * i + 1] = p.getY(i) * 2; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const m = new THREE.Mesh(g, mat); m.castShadow = false; m.receiveShadow = true; return m;
}
const curtainGeo = once(() => ({
  cloth: clothBand(0.065, CURT_TOP - 0.075, 0.004, L.sheerCloth(), 20),
  hem: clothBand(0.004, 0.065, 0.006, L.sheerHem(), 2),
  tape: clothBand(CURT_TOP - 0.075, CURT_TOP, 0.006, L.sheerTape(), 2),
}));
function curtainSheer() {
  const root = new THREE.Group(), W = L.white(), cg = curtainGeo();
  // ceiling track + carriers
  root.add(box(CURT_W + 0.06, 0.022, 0.032, W, { r: 0.004, y: CEIL - 0.011 }));
  for (const s of [-1, 1]) root.add(box(0.012, 0.024, 0.034, W, { r: 0.003, x: s * (CURT_W / 2 + 0.03), y: CEIL - 0.012 }));
  const sway = new THREE.Group(); sway.position.y = CURT_TOP; root.add(sway);
  const inner = new THREE.Group(); inner.position.y = -CURT_TOP; sway.add(inner);
  inner.add(cg.cloth.clone(), cg.hem.clone(), cg.tape.clone());
  const carriers = new THREE.Group(); root.add(carriers);
  // snap carriers at the back of every fold (where the ripplefold tape clips to the track)
  for (let i = 0; i <= FOLDS * 2; i++) {
    const u = i / (FOLDS * 2), x = (u - 0.5) * CURT_W, z = AMP * 0.86 * Math.sin(u * FOLDS * Math.PI * 2);
    if (i % 2) continue;
    carriers.add(cyl(0.006, 0.006, CEIL - 0.022 - CURT_TOP + 0.012, W, { seg: 8, x, y: (CEIL - 0.022 + CURT_TOP - 0.012) / 2, z: 0 }));
  }
  root.userData.animate = (t) => {
    sway.scale.z = 1 + 0.02 * Math.sin(t * 0.55) + 0.006 * Math.sin(t * 1.37 + 0.8);
    sway.rotation.x = 0.0035 * Math.sin(t * 0.41 + 1.1);
    sway.rotation.z = 0.0015 * Math.sin(t * 0.29);
  };
  const toggle = animatedToggle(root, {
    label: { en: 'Open curtain', zh: '拉开窗帘' }, labelOn: { en: 'Close curtain', zh: '合上窗帘' },
    apply(open) {
      // Narrow placed panels are on the right jamb; full-width panels stack to the left.
      const side = root.userData.stackSide ?? (root.scale.x < 0.9 ? 1 : -1);
      const width = 1 - open * 0.82, offset = side * CURT_W * (1 - width) / 2;
      sway.scale.x = carriers.scale.x = width;
      sway.position.x = carriers.position.x = offset;
    },
  });
  root.userData.onTime = (dusk, instant) => toggle.set(!dusk, instant);
  return finish(root, { id: 'decor-curtain-sheer', name: 'Sheer ripplefold curtain panel', zh: '落地纱帘', note: '1.50 w, plane = local X, faces ±Z; place one per side of each glass door' }, false);
}

// ================================================================ CELLULAR SHADE
// Top-down cellular shade (g08/g09): head rail inside the window head, honeycomb pleats lowered `drop` m, bottom rail.
function cellularShade(w = 1.84, id = 'decor-cellular-shade', name = 'Cellular shade 1.84 m', drop = 0.45) {
  const root = new THREE.Group(), W = L.white(), S = L.shade();
  const railTop = 2.08, railBot = 2.03, n = Math.round(drop / 0.03), ph = drop / n;
  root.add(box(w, railTop - railBot, 0.05, W, { r: 0.006, y: (railTop + railBot) / 2 }));
  for (const s of [-1, 1]) root.add(box(0.008, 0.048, 0.052, L.plateWhite(), { r: 0.002, x: s * (w / 2 - 0.004), y: (railTop + railBot) / 2 }));
  const cell = box(w - 0.012, ph + 0.006, 0.03, S, { r: 0.007, seg: 2 });
  const pleats = new THREE.Group(); pleats.position.y = railBot; root.add(pleats);
  for (let i = 0; i < n; i++) {
    const c = cell.clone(); c.position.set(0, -ph * (i + 0.5), (i % 2 ? 0.0008 : -0.0008)); pleats.add(c);
  }
  const yb = railBot - drop;
  const bottom = new THREE.Group(); root.add(bottom);
  bottom.add(box(w - 0.004, 0.022, 0.04, W, { r: 0.007, y: yb - 0.011 }));
  bottom.add(box(0.06, 0.016, 0.012, W, { r: 0.004, y: yb - 0.014, z: 0.025 }));     // finger pull on the room side
  const toggle = animatedToggle(root, {
    label: { en: 'Raise shade', zh: '升起蜂巢帘' }, labelOn: { en: 'Lower shade', zh: '放下蜂巢帘' },
    apply(raised) { pleats.scale.y = 1 - raised * 0.86; bottom.position.y = drop * raised * 0.86; },
  });
  toggle.set(true, true);
  return finish(root, { id, name, zh: '蜂巢帘', note: 'inside-mount; window head 2.06, rail 2.03-2.08, glass at -Z' }, false);
}

// ================================================================ THERMOSTAT
// g09: Honeywell-style landscape body with the LCD left and buttons right/below.
function thermostat() {
  const root = new THREE.Group(), y = 1.5, d = 0.024;
  const body = extrude(rrect(0.125, 0.085, 0.012), d - 0.004, L.white(), { bevel: 0.002, z: -d / 2 + 0.002, y }); root.add(body);
  root.add(box(0.058, 0.036, 0.002, L.inner(), { r: 0.002, x: -0.017, y: y + 0.008, z: d / 2 + 0.0005 }));
  root.add(plane(0.052, 0.031, L.lcd(), { x: -0.017, y: y + 0.008, z: d / 2 + 0.0017 }));
  for (const [bx, by] of [[0.04, 0.019], [0.04, -0.003], [-0.03, -0.028], [-0.004, -0.028]]) root.add(cyl(0.0055, 0.0055, 0.004, L.plateWhite(), { seg: 16, x: bx, y: y + by, z: d / 2 + 0.001, rx: Math.PI / 2 }));
  return finish(root, { id: 'decor-thermostat', name: 'Thermostat', zh: '温控器' }, false);
}

// ================================================================ WROUGHT-IRON PORCH COLUMN
// g05/g06: two vertical bars framing a continuous S-vine. The vine touches each bar at its apex and crosses the
// centre at a banded collar; a big C-scroll grows from every apex and curls into the opposite side, and two small
// volutes sprout from every collar into the free triangles beside the diagonal. Mirror = the second porch column.
function ironColumn(mirror = false) {
  const I = M.ironBlack(), root = new THREE.Group();
  const H = 2.4, BX = 0.124, BAR = 0.022, inner = BX - BAR / 2;  // strap bars, inner face at ±0.113
  const yBot = 0.12, yTop = 2.366, A = 0.104, Lu = 0.5, apexTop = 2.21, k = 1.3;
  const top = mirror ? -1 : 1;                                          // side of the top apex (+x = right)
  // frame
  for (const s of [-1, 1]) {
    root.add(box(BAR, H - 0.04 - 0.012, 0.016, I, { r: 0.002, x: s * BX, y: 0.04, bottom: true }));
    root.add(box(0.032, 0.04, 0.05, I, { r: 0.004, x: s * BX, bottom: true }));             // anchor shoe / plinth
    for (const sz of [-1, 1]) root.add(cyl(0.004, 0.004, 0.004, I, { seg: 8, x: s * BX, y: 0.042, z: sz * 0.016 }));
  }
  root.add(box(0.28, 0.012, 0.05, I, { r: 0.002, y: H - 0.012, bottom: true }));               // top plate
  root.add(box(2 * inner, 0.016, 0.016, I, { r: 0.002, y: yTop + 0.008 }));                     // top rail
  root.add(box(2 * inner, 0.016, 0.016, I, { r: 0.002, y: yBot - 0.008 }));                     // bottom rail
  // vine
  // near-straight diagonals (rounded triangle wave) that soft-clip into a vertical run hugging the bar at each apex
  const tri = (c) => Math.asin(0.96 * c) / Math.asin(0.96), sc = (u) => u / Math.pow(1 + Math.pow(Math.abs(u), 6), 1 / 6);
  const vx = (y) => top * A * sc(k * tri(Math.cos(Math.PI * (y - apexTop) / Lu))) / sc(k);
  const vine = []; for (let y = yTop; y >= yBot - 1e-6; y -= 0.01) vine.push([vx(y), y, 0]);
  root.add(tube(vine, 0.0055, I, { seg: 260, radial: 6 }));
  const R = 0.0052;
  // big scrolls at each apex
  for (let j = 0; ; j++) {
    const ya = apexTop - j * Lu; if (ya < yBot + 0.05) break;
    const s = top * (j % 2 ? -1 : 1), cx = -s * 0.026, cy = ya + 0.02, r0 = A + 0.026;
    const pts = scrollPts(cx, cy, r0, 0.009, s > 0 ? 0 : Math.PI, 1.85, s, 1.8, 70);
    pts.unshift([s * A, cy - 0.05]);                                  // leave the vine tangentially
    root.add(tube(v3(pts), R, I, { seg: 90, radial: 6 }));
    root.add(shadow(new THREE.Mesh(new THREE.SphereGeometry(0.0075, 10, 6), I)).translateX(pts.at(-1)[0]).translateY(pts.at(-1)[1]));  // forged knob
  }
  // collars with two small volutes + leaf accents
  const leafShape = [[0, 0], [0.007, 0.008], [0.007, 0.018], [0, 0.03], [-0.007, 0.018], [-0.007, 0.008]];
  for (let j = 0; ; j++) {
    const yc = apexTop - (j + 0.5) * Lu; if (yc < yBot + 0.03) break;
    const a = top * (j % 2 ? -1 : 1);                                  // the diagonal runs from upper-a to lower-(-a)
    const slope = (vx(yc + 0.001) - vx(yc - 0.001)) / 0.002, rz = -Math.atan(slope);
    root.add(box(0.02, 0.03, 0.016, I, { r: 0.003, y: yc, rz }));
    for (const up of [1, -1]) {
      const sig = up > 0 ? -a : a, cx = sig * 0.064, cy = yc + up * 0.036;
      const a0 = Math.atan2(yc - cy, -cx);
      const pts = scrollPts(cx, cy, Math.hypot(cx, yc - cy), 0.006, a0, 1.5, -a, 1.7, 50);
      root.add(tube(v3(pts), 0.0045, I, { seg: 60, radial: 6 }));
      root.add(shadow(new THREE.Mesh(new THREE.SphereGeometry(0.0055, 8, 6), I)).translateX(pts.at(-1)[0]).translateY(pts.at(-1)[1]));
      // leaf accent: a small forged leaf sprouting from the collar along the vine
      const lf = extrude(leafShape, 0.003, I, { bevel: 0.001, z: -0.0025 });
      lf.position.set(0, yc, 0); lf.rotation.z = rz + (up > 0 ? 0 : Math.PI) + sig * 0.55; lf.translateY(0.01);
      root.add(lf);
    }
  }
  return finish(root, { id: mirror ? 'decor-iron-column-mirror' : 'decor-iron-column', name: 'Wrought-iron porch column', zh: '门廊铁艺柱' });
}

// ================================================================ PORCH SCONCE
// g06: black rectangular up/down sconce with an organic perforated front panel (warm light through the holes).
function wallLightBlack() {
  const B = M.blackMatte(), root = new THREE.Group(), y = 2.05, w = 0.10, h = 0.22, d = 0.085, zb = -d / 2;
  root.add(box(w, h, 0.008, B, { r: 0.002, y, z: zb + 0.004 }));                                // back plate
  for (const s of [-1, 1]) root.add(box(0.006, h, d - 0.008, B, { r: 0.002, x: s * (w / 2 - 0.003), y, z: zb + 0.008 + (d - 0.008) / 2 }));
  root.add(box(w - 0.012, h - 0.03, 0.004, L.perforated(), { y, z: d / 2 - 0.002 }));            // perforated front
  for (const s of [-1, 1]) {
    root.add(box(w - 0.004, 0.012, 0.006, B, { r: 0.002, y: y + s * (h / 2 - 0.006), z: d / 2 - 0.003 }));   // top/bottom lips
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.014, d - 0.02), L.warm()); glow.rotation.x = s > 0 ? -Math.PI / 2 : Math.PI / 2; glow.position.set(0, y + s * (h / 2 - 0.02), 0.002); root.add(glow);
    const wash = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.55), L.wash()); wash.position.set(0, y + s * (h / 2 + 0.26), zb + 0.0015); if (s < 0) wash.rotation.z = Math.PI; root.add(wash);
  }
  // its one light, just in front of the perforated panel (an exterior light: on at dusk, off by day)
  root.userData.light = { type: 'point', y: 2.05, z: 0.088, intensity: 3, color: 0xffd29b, distance: 3.5, decay: 2 };
  declare(root, { fixture: { kind: 'wall' } });
  return finish(root, { id: 'decor-wall-light-black', name: 'Porch wall sconce (black, perforated)', zh: '门廊壁灯' }, false);
}

// ================================================================ HOUSE NUMBER
const DIGITS = {
  '1': [[[0.019, 0.093], [0.044, 0.1135]], [[0.044, 0.1135], [0.044, 0]]],
  '2': [[...arcPts(0.0375, 0.0835, 0.03, 165, -32, 16), [0.007, 0.0065], [0.072, 0.0065]]],
  '3': [arcPts(0.036, 0.087, 0.0265, 155, -90, 14), arcPts(0.036, 0.0375, 0.031, 90, -152, 16), [[0.024, 0.064], [0.037, 0.064]]],
  '5': [[[0.068, 0.1135], [0.012, 0.1135], [0.009, 0.066], ...arcPts(0.036, 0.04, 0.0335, 128, -148, 18)]],
};
function houseNumber() {
  const root = new THREE.Group(), y = 1.6, pd = 0.012, B = M.blackMatte(), sw = 0.0135, adv = 0.088;
  root.add(extrude(rrect(0.40, 0.18, 0.01), pd - 0.002, L.plateWhite(), { bevel: 0.001, y, z: -pd / 2 + 0.001 }));
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) root.add(cyl(0.004, 0.004, 0.002, M.steel(), { seg: 12, x: sx * 0.18, y: y + sy * 0.07, z: pd / 2 + 0.001, rx: Math.PI / 2 }));
  [...'2513'].forEach((ch, i) => {
    const ox = -2 * adv + i * adv + (adv - 0.075) / 2 + 0.0, oy = y - 0.06;
    for (const stroke of DIGITS[ch]) root.add(extrude(strokeOutline(stroke, sw).map(([px, py]) => [px + ox, py + oy]), 0.005, B, { bevel: 0.0006, z: pd / 2 }));
  });
  return finish(root, { id: 'decor-house-number', name: 'House number 2513', zh: '门牌号' }, false);
}

// ================================================================ TABLE-TOP ACCESSORIES
// Smooth a coarse [r,h] profile with a Catmull-Rom spline so lathed bellies don't facet.
function smoothProfile(pts, n = 30) { const c = new THREE.SplineCurve(pts.map(([r, h]) => new THREE.Vector2(r, h))); return c.getSpacedPoints(n).map(v => [v.x, v.y]); }
function hollow(outer, wall, floor) {
  outer = smoothProfile(outer);
  // outer profile [[r,h]...] bottom→top lip; returns outer + lip + inner wall down to the floor (for lathe)
  const top = outer.at(-1), inner = outer.slice().reverse().map(([r, h]) => [Math.max(0.001, r - wall), h]).filter(([, h]) => h >= floor);
  return [[0, 0], ...outer, [top[0] - wall * 0.5, top[1] + 0.002], ...inner, [0, floor]];
}
function driedStem(seed, pts, head = L.driedHead()) {
  const r = rng(seed), g = new THREE.Group();
  g.add(tube(pts, 0.0016, L.dried(), { seg: 20, radial: 5 }));
  const tip = pts.at(-1), sg = new THREE.SphereGeometry(1, 6, 4);
  for (let i = 0; i < 14; i++) {     // airy seed-head cluster (dried gypsophila / limonium)
    const m = new THREE.Mesh(sg, head); const s = 0.006 + r() * 0.006;
    m.scale.set(s, s * 0.8, s); m.position.set(tip[0] + (r() - 0.5) * 0.06, tip[1] + (r() - 0.3) * 0.05, tip[2] + (r() - 0.5) * 0.06); g.add(shadow(m));
    if (i % 3 === 0) g.add(tube([[tip[0], tip[1] - 0.04, tip[2]], [m.position.x, m.position.y, m.position.z]], 0.0008, L.dried(), { seg: 4, radial: 3 }));
  }
  return g;
}
function vaseWhite() {
  const root = new THREE.Group();
  const outer = [[0.045, 0], [0.07, 0.03], [0.088, 0.09], [0.09, 0.14], [0.08, 0.2], [0.055, 0.255], [0.028, 0.29], [0.024, 0.305], [0.028, 0.318]];
  root.add(lathe(hollow(outer, 0.006, 0.02), M.ceramicWhite(), { seg: 32 }));
  root.add(driedStem(3, [[0, 0.2, 0], [0.01, 0.42, 0.01], [0.06, 0.62, 0.02]]));
  root.add(driedStem(5, [[0, 0.2, 0], [-0.01, 0.45, 0], [-0.05, 0.7, -0.03]], L.driedPink()));
  root.add(driedStem(8, [[0, 0.2, 0], [0.0, 0.4, -0.01], [0.015, 0.55, -0.07]]));
  return finish(root, { id: 'decor-vase-white', name: 'White ceramic vase with dried stems', zh: '白瓷花瓶' }, false);
}
function vaseStone() {
  const root = new THREE.Group();
  const outer = [[0.06, 0], [0.085, 0.03], [0.105, 0.1], [0.11, 0.17], [0.1, 0.25], [0.072, 0.32], [0.045, 0.37], [0.04, 0.4], [0.045, 0.42]];
  root.add(lathe(hollow(outer, 0.008, 0.03), M.ceramicSpeckle(), { seg: 32 }));
  return finish(root, { id: 'decor-vase-stone', name: 'Speckled stoneware vase', zh: '粗陶花瓶' }, false);
}
function bowlWood() {
  const root = new THREE.Group();
  const outer = [[0.07, 0], [0.075, 0.006], [0.11, 0.025], [0.138, 0.055], [0.15, 0.08]];
  root.add(lathe(hollow(outer, 0.008, 0.012), M.oak(), { seg: 36 }));
  return finish(root, { id: 'decor-bowl-wood', name: 'Turned wood bowl', zh: '木碗' }, false);
}
// shift a mesh's UVs off the origin so a non-tiling procedural texture shows no wrap seam across the piece
function uvShift(m, du = 0.31, dv = 0.17) { const uv = m.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + du, uv.getY(i) + dv); return m; }
function trayWood() {
  const root = new THREE.Group(), W = M.walnut(), w = 0.4, d = 0.28, h = 0.03, lip = 0.012;
  root.add(uvShift(extrude(rrect(w, d, 0.03), 0.01, W, { bevel: 0.002, rx: -Math.PI / 2, y: 0.002 })));
  root.add(uvShift(extrude(rrect(w, d, 0.03), h - 0.004, W, { bevel: 0.002, rx: -Math.PI / 2, y: 0.002, holes: [rrect(w - 2 * lip, d - 2 * lip, 0.02).reverse()] })));
  return finish(root, { id: 'decor-tray-wood', name: 'Walnut tray', zh: '胡桃木托盘' }, false);
}
function bottle(r, h, neck, mat, { cork = false, liquid = 0 } = {}) {
  const g = new THREE.Group(), sh = h * 0.62;
  const prof = [[0, 0.003], [r - 0.004, 0], [r, 0.006], [r, sh], [r * 0.85, sh + h * 0.07], [neck * 1.1, sh + h * 0.17], [neck, h - 0.02], [neck * 1.18, h - 0.016], [neck * 1.18, h - 0.006], [neck, h]];
  g.add(lathe(prof, mat, { seg: 28 }));
  if (cork) g.add(cyl(neck * 0.92, neck * 0.85, 0.025, L.cork(), { seg: 16, y: h - 0.008 }));
  if (liquid) g.add(cyl(r - 0.003, r - 0.003, liquid, L.oil(), { seg: 24, y: 0.004, bottom: true }));
  return g;
}
function bottles() {
  const root = new THREE.Group();
  root.add(at(bottle(0.045, 0.32, 0.012, L.glassGreen(), { cork: true }), -0.075, 0, -0.01));
  root.add(at(bottle(0.035, 0.28, 0.011, L.glassClear(), { cork: true, liquid: 0.12 }), 0.02, 0, 0.02));
  root.add(at(bottle(0.03, 0.25, 0.01, L.glassAmber()), 0.09, 0, -0.02));
  return finish(root, { id: 'decor-bottles', name: 'Three glass bottles', zh: '玻璃瓶组' }, false);
}
function book(w, d, t, cloth, seed) {
  const g = new THREE.Group(), r = rng(seed), C = L.cloth(cloth), bt = 0.003;
  g.add(box(w, bt, d, C, { r: 0.0012, y: bt / 2 }));
  g.add(box(w, bt, d, C, { r: 0.0012, y: t - bt / 2 }));
  g.add(box(w - 0.008, t - 2 * bt, d - 0.006, L.pages(), { y: t / 2, z: 0.003 - 0.003 + 0.001, x: 0.004 }));
  g.add(cyl(t / 2, t / 2, d, C, { seg: 12, x: -w / 2 + t / 2 - 0.002, y: t / 2, rx: Math.PI / 2 }));  // rounded spine
  g.children.at(-1).scale.set(0.45, 1, 1);
  g.add(box(0.002, t * 0.35, d * 0.5, L.foil(), { x: -w / 2 - 0.0005 + (t / 2) * 0.55 * 0 - 0.0, y: t / 2, z: (r() - 0.5) * 0.02 }));
  return g;
}
function bookStack() {
  const root = new THREE.Group(); let y = 0;
  [[0.032, 0x5d6b58, 0.04, 1], [0.026, 0xa3553a, -0.06, 2], [0.022, 0x2e3a52, 0.1, 3]].forEach(([t, col, ry, s], i) => {
    const b = book(0.22 - i * 0.012, 0.15 - i * 0.008, t, col, s); b.position.set((i - 1) * 0.006, y, (i - 1) * -0.004); b.rotation.y = ry; root.add(b); y += t;
  });
  return finish(root, { id: 'decor-book-stack', name: 'Stack of three hardcovers', zh: '书堆' }, false);
}
function candle() {
  const root = new THREE.Group();
  root.add(lathe([[0, 0], [0.043, 0], [0.045, 0.004], [0.045, 0.12], [0.0415, 0.12], [0.0415, 0.014], [0, 0.014]], M.glass(), { seg: 40 }));
  root.add(lathe([[0, 0.014], [0.034, 0.014], [0.034, 0.088], [0.03, 0.091], [0.008, 0.086], [0, 0.086]], L.wax(), { seg: 32 }));
  root.add(tube([[0, 0.085, 0], [0, 0.096, 0], [0.002, 0.101, 0]], 0.0011, L.wick(), { seg: 6, radial: 4 }));
  return finish(root, { id: 'decor-candle', name: 'Pillar candle in glass', zh: '玻璃杯蜡烛' }, false);
}
function throwBlanketGrey() {
  // folded knit throw: four stacked folded layers, the fold edge rounded and slightly proud on the front
  const root = new THREE.Group(), K = L.knit(), n = 4, t = 0.08 / n;
  for (let i = 0; i < n; i++) {
    const l = cushion(0.5 - i * 0.006, t + 0.003, 0.35 - i * 0.004, K, { r: t / 2, seg: 4, y: t / 2 + 0.002 + i * t, x: (i % 2 ? 0.004 : -0.003), z: (i % 2 ? -0.003 : 0.003) });
    l.scale.set(1, 0.96, 1); root.add(l);
  }
  // soft fold roll along the front edge
  root.add(cyl(0.038, 0.038, 0.49, K, { seg: 20, rz: Math.PI / 2, y: 0.04, z: 0.175 - 0.03 }));
  root.children.at(-1).scale.set(1, 1, 0.75);
  return finish(root, { id: 'decor-throw-grey', name: 'Folded grey knit throw', zh: '灰色针织毯' }, false);
}
function artFrameSmall() {
  const root = new THREE.Group(), lean = new THREE.Group(), w = 0.4, h = 0.5, fw = 0.016, fd = 0.022, B = M.blackMatte();
  lean.add(extrude(rrect(w, h, 0.002), fd, B, { bevel: 0.001, holes: [rrect(w - 2 * fw, h - 2 * fw, 0.001).reverse()], y: h / 2, z: -fd / 2 }));
  lean.add(box(w - 2 * fw + 0.002, h - 2 * fw + 0.002, 0.004, L.mat(), { y: h / 2, z: fd / 2 - 0.012 }));
  lean.add(plane(w - 0.12, h - 0.14, L.print(), { y: h / 2 + 0.01, z: fd / 2 - 0.0095 }));
  lean.add(box(w - 2 * fw, h - 2 * fw, 0.002, L.inner(), { y: h / 2, z: -fd / 2 + 0.002 }));
  lean.rotation.x = -0.14; root.add(lean);
  root.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(lean); lean.position.y -= bb.min.y; lean.position.z -= (bb.min.z + bb.max.z) / 2;
  return finish(root, { id: 'decor-art-frame-small', name: 'Small framed abstract print (leaning)', zh: '小幅装饰画' });
}

export const items = {
  trackLight,
  recessedLight,
  curtainSheer,
  cellularShade: () => cellularShade(1.84),
  // Front bedroom window: fills the 1.20 m jamb opening and drops to the stool (placed at h -0.08).
  cellularShadeNarrow: () => cellularShade(1.19, 'decor-cellular-shade-narrow', 'Cellular shade 1.19 m', 0.97),
  thermostat,
  ironColumn: () => ironColumn(false),
  ironColumnMirror: () => ironColumn(true),
  wallLightBlack,
  houseNumber,
  vaseWhite,
  vaseStone,
  bowlWood,
  trayWood,
  bottles,
  bookStack,
  candle,
  throwBlanketGrey,
  artFrameSmall,
};
