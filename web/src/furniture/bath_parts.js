// bath_parts — shared local materials/textures for the bath module, plus the garage / laundry pieces
// (washer-dryer tower, water heater, wire shelving, ping-pong table, rustic wine console, electrical panel).
// Refs: refs/bath/g48, g49 (garage). Units metres, origin on the floor at the footprint centre, +Z = front.
import { THREE, M, box, cyl, lathe, extrude, tube, plane, group, at, repeat, legs, autoCollider, describe, sphere, torus } from '../kit.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const once = (fn) => { let v; return () => (v ??= fn()); };
export const PI = Math.PI;

// ---------- small canvas textures (deterministic) ----------
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
export function canvasTex(w, h, draw, { srgb = true, repeat = [1, 1] } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.repeat.set(repeat[0], repeat[1]);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}
// one texture, different tiling per mesh (shares the image / GPU source)
export function retile(mat, rx, ry, { ox = 0, oy = 0, rot = 0 } = {}) {
  const m = mat.clone();
  for (const k of ['map', 'roughnessMap', 'bumpMap', 'normalMap', 'aoMap']) if (mat[k]) { const t = mat[k].clone(); t.repeat.set(rx, ry); t.offset.set(ox, oy); t.rotation = rot; if (rot) t.center.set(0.5, 0.5); t.needsUpdate = true; m[k] = t; }
  return m;
}
// a wood material whose grain runs horizontally (grainTex streaks run along texture v)
function rotated(mat) { return retile(mat, 1, 1, { rot: PI / 2 }); }

// large-format gloss wall tile: ONE tile per texture, 0.60 w × 0.30 h, ~3 mm grout. Map with UV in metres → repeat (1/0.6, 1/0.3).
function tileCanvas(kind) {
  return canvasTex(512, 256, (g, W, H) => {
    const r = rng(9);
    if (kind === 'color') {
      g.fillStyle = '#d6d6d2'; g.fillRect(0, 0, W, H);
      const grd = g.createLinearGradient(0, 0, W, H); grd.addColorStop(0, '#f7f7f5'); grd.addColorStop(0.55, '#f2f2f0'); grd.addColorStop(1, '#eeeeec');
      g.fillStyle = grd; g.fillRect(1.5, 1.5, W - 3, H - 3);
      g.globalAlpha = 0.035; for (let i = 0; i < 900; i++) { g.fillStyle = r() > 0.5 ? '#ffffff' : '#9a9a96'; g.fillRect(r() * W, r() * H, 2, 2); }
    } else if (kind === 'rough') { g.fillStyle = '#d0d0d0'; g.fillRect(0, 0, W, H); g.fillStyle = '#202020'; g.fillRect(1.5, 1.5, W - 3, H - 3); }
    else { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; g.fillRect(2.5, 2.5, W - 5, H - 5); }
  }, { srgb: kind === 'color' });
}

// straight-ish wood grain (streaks along v), gentle drift, fine pores; `saw` adds rough-sawn cross marks,
// `planks` draws board joints every 1/planks of the width.
export function grainTex({ base = '#4a3328', dark = '#2a1b13', light = null, seed = 1, lines = 140, saw = 0, planks = 0, wash = 0 } = {}) {
  return canvasTex(512, 1024, (g, W, H) => {
    const r = rng(seed); g.fillStyle = base; g.fillRect(0, 0, W, H);
    for (let i = 0; i < lines; i++) {
      const x0 = r() * W, amp = 2 + r() * 10, ph = r() * 6, f = 0.002 + r() * 0.004, w = 0.6 + r() * 2.8;
      g.strokeStyle = r() < 0.75 ? dark : (light || base); g.globalAlpha = 0.12 + r() * 0.35; g.lineWidth = w; g.beginPath();
      for (let y = -10; y <= H + 10; y += 16) { const x = x0 + Math.sin(y * f + ph) * amp; y < 0 ? g.moveTo(x, y) : g.lineTo(x, y); }
      g.stroke();
    }
    g.globalAlpha = 0.18; for (let i = 0; i < 6000; i++) { g.fillStyle = r() > 0.5 ? dark : (light || '#ffffff'); g.fillRect(r() * W, r() * H, 1, 2 + r() * 5); }
    if (saw) { g.globalAlpha = saw; g.strokeStyle = dark; for (let y = 0; y < H; y += 7 + r() * 9) { g.lineWidth = 1 + r() * 2; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y + (r() - 0.5) * 30); g.stroke(); } }
    if (wash) { g.globalAlpha = wash; g.fillStyle = '#f2ede6'; for (let i = 0; i < 400; i++) g.fillRect(r() * W, r() * H, 4 + r() * 40, 20 + r() * 120); }
    if (planks) { g.globalAlpha = 0.6; g.fillStyle = '#140c08'; const n = Math.round(1 / planks); for (let i = 1; i < n; i++) g.fillRect((i / n) * W - 1, 0, 2.5, H); }
    g.globalAlpha = 1;
  });
}

// ---------- local materials ----------
export const L = {
  chrome: once(() => new THREE.MeshStandardMaterial({ color: 0xf0f2f4, roughness: 0.07, metalness: 1 })),
  shadowGap: once(() => new THREE.MeshStandardMaterial({ color: 0x0b0908, roughness: 0.95 })),
  // dark walnut-stained vanity (photos show visible grain; M.darkVanity's colour with a grain map)
  vanityWood: once(() => { const t = grainTex({ base: '#4b3429', dark: '#24170f', light: '#6a4c3b', seed: 21 }); t.repeat.set(2, 1); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, color: 0xd8d0cc }); }),
  vanityWoodH: once(() => retile(L.vanityWood(), 1, 4, { rot: PI / 2 })),
  mirrorEdge: once(() => new THREE.MeshStandardMaterial({ color: 0xc9d0cf, roughness: 0.25, metalness: 0.4 })),
  terry: once(() => new THREE.MeshPhysicalMaterial({ color: 0xf8f8f5, roughness: 1, sheen: 1, sheenRoughness: 0.9, sheenColor: new THREE.Color(0xffffff),
    bumpMap: canvasTex(256, 256, (g, W, H) => { const r = rng(4); g.fillStyle = '#808080'; g.fillRect(0, 0, W, H); for (let i = 0; i < 9000; i++) { g.fillStyle = r() > 0.5 ? '#b0b0b0' : '#505050'; g.fillRect(r() * W, r() * H, 2, 2); } }, { srgb: false, repeat: [4, 4] }), bumpScale: 0.6 })),
  ladderPaint: once(() => { const t = grainTex({ base: '#e9e3d8', dark: '#857460', light: '#ffffff', seed: 33, lines: 170, saw: 0.14, wash: 0.12 }); return new THREE.MeshStandardMaterial({ map: t, bumpMap: t, bumpScale: 1, roughness: 0.8, color: 0xe4ddd0 }); }),
  tileLarge: once(() => new THREE.MeshPhysicalMaterial({ map: tileCanvas('color'), roughnessMap: tileCanvas('rough'), bumpMap: tileCanvas('bump'), bumpScale: 0.8, roughness: 1, clearcoat: 0.7, clearcoatRoughness: 0.08 })),
  // M.tileMosaic re-tinted toward the grey-white marble of the photos
  mosaic: once(() => { const m = M.tileMosaic().clone(); m.color = new THREE.Color(0xf0f4fa); m.roughness = 0.45; return m; }),
  slate: once(() => new THREE.MeshPhysicalMaterial({ color: 0x66738a, roughness: 0.38, metalness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.25 })),
  bezel: once(() => new THREE.MeshPhysicalMaterial({ color: 0x2a2d32, roughness: 0.3, metalness: 0.1, clearcoat: 0.6 })),
  doorGlass: once(() => new THREE.MeshPhysicalMaterial({ color: 0x9aa6b4, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.32, depthWrite: false, clearcoat: 1, envMapIntensity: 1.5 })),
  rubber: once(() => new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.85 })),
  blackGlass: once(() => new THREE.MeshPhysicalMaterial({ color: 0x0d0e10, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 })),
  steelDark: once(() => { const m = M.steel().clone(); m.color = new THREE.Color(0x6a6e73); m.roughness = 0.4; return m; }),
  drum: once(() => { const m = M.steel().clone(); m.color = new THREE.Color(0xd5d8db); m.roughness = 0.3; m.side = THREE.DoubleSide;
    m.map = canvasTex(64, 64, (g, W, H) => { g.fillStyle = '#c8cbce'; g.fillRect(0, 0, W, H); g.fillStyle = '#2c2f33'; for (const [x, y] of [[16, 16], [48, 48]]) { g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); } }, { repeat: [40, 10] }); return m; }),
  display: once(() => new THREE.MeshStandardMaterial({ color: 0x0a1418, emissive: 0x7fd6ff, emissiveIntensity: 0.25, roughness: 0.3,
    emissiveMap: canvasTex(128, 32, (g) => { g.fillStyle = '#000'; g.fillRect(0, 0, 128, 32); g.fillStyle = '#fff'; g.font = 'bold 20px monospace'; g.fillText('0:48', 34, 24); }) })),
  heaterGrey: once(() => new THREE.MeshPhysicalMaterial({ color: 0x8f959c, roughness: 0.42, metalness: 0.25, clearcoat: 0.35 })),
  plasticWhite: once(() => M.plasticWhite()),
  copper: once(() => new THREE.MeshStandardMaterial({ color: 0xc27a4e, roughness: 0.35, metalness: 1 })),
  brass: once(() => new THREE.MeshStandardMaterial({ color: 0xc8a659, roughness: 0.3, metalness: 1 })),
  redHandle: once(() => new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.45 })),
  blueHandle: once(() => new THREE.MeshStandardMaterial({ color: 0x1f4fa3, roughness: 0.45 })),
  label: once(() => new THREE.MeshStandardMaterial({ roughness: 0.7, map: canvasTex(128, 160, (g) => { g.fillStyle = '#f4d23a'; g.fillRect(0, 0, 128, 160); g.fillStyle = '#222'; g.fillRect(8, 8, 112, 18); g.fillRect(8, 34, 70, 6); g.fillRect(8, 46, 90, 6); g.fillStyle = '#2c6fb3'; g.fillRect(8, 64, 112, 26); g.fillStyle = '#222'; for (let i = 0; i < 6; i++) g.fillRect(8, 100 + i * 9, 40 + ((i * 37) % 70), 4); }) })),
  hose: once(() => new THREE.MeshStandardMaterial({ color: 0x9c9fa3, roughness: 0.55, metalness: 0.6 })),
  tote: once(() => new THREE.MeshPhysicalMaterial({ color: 0xc4c8cc, roughness: 0.35, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, clearcoat: 0.3 })),
  toteLid: once(() => new THREE.MeshStandardMaterial({ color: 0x5e6266, roughness: 0.5 })),
  kraft: once(() => new THREE.MeshStandardMaterial({ roughness: 0.92, map: canvasTex(256, 256, (g, W, H) => { const r = rng(17); g.fillStyle = '#b48a5a'; g.fillRect(0, 0, W, H); g.globalAlpha = 0.12; for (let i = 0; i < 3000; i++) { g.fillStyle = r() > 0.5 ? '#d8b282' : '#7d5a34'; g.fillRect(r() * W, r() * H, 1 + r() * 3, 1); } g.globalAlpha = 0.5; g.fillStyle = '#2a2a2a'; g.font = 'bold 22px sans-serif'; g.fillText('THIS SIDE UP ↑', 40, 200); }) })),
  tape: once(() => new THREE.MeshStandardMaterial({ color: 0xc9a46c, roughness: 0.35, transparent: true, opacity: 0.85 })),
  frameGrey: once(() => new THREE.MeshStandardMaterial({ color: 0x55595e, roughness: 0.45, metalness: 0.6 })),
  tableBlue: once(() => new THREE.MeshStandardMaterial({ color: 0x2b4a6e, roughness: 0.55 })),
  tableTop: once(() => new THREE.MeshStandardMaterial({ roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    map: canvasTex(2048, 1140, (g, W, H) => {
      const r = rng(23); g.fillStyle = '#2b4a6e'; g.fillRect(0, 0, W, H);
      g.globalAlpha = 0.05; for (let i = 0; i < 20000; i++) { g.fillStyle = r() > 0.5 ? '#ffffff' : '#000000'; g.fillRect(r() * W, r() * H, 2, 2); }
      g.globalAlpha = 1; g.fillStyle = '#f4f4f0'; const px = W / 2.74, e = 0.02 * px;
      g.fillRect(0, 0, W, e); g.fillRect(0, H - e, W, e); g.fillRect(0, 0, e, H); g.fillRect(W - e, 0, e, H); g.fillRect(0, H / 2 - 0.0015 * px, W, Math.max(3, 0.003 * px));
    }) })),
  net: once(() => new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9, side: THREE.DoubleSide, alphaTest: 0.4, transparent: false,
    alphaMap: canvasTex(32, 32, (g) => { g.fillStyle = '#000'; g.fillRect(0, 0, 32, 32); g.fillStyle = '#fff'; g.fillRect(0, 0, 32, 4); g.fillRect(0, 0, 4, 32); }, { srgb: false, repeat: [122, 10] }) })),
  wheel: once(() => new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 })),
  // rough-sawn two-tone reclaimed wood from g48/g49 (dark stained top & drawers, weathered pinkish carcass)
  woodDark: once(() => { const t = grainTex({ base: '#53301f', dark: '#1e100a', light: '#7a4a33', seed: 41, saw: 0.25, planks: 0.25 }); return new THREE.MeshStandardMaterial({ map: t, bumpMap: t, bumpScale: 1.5, roughness: 0.82 }); }),
  woodDarkH: once(() => rotated(L.woodDark())),
  woodLight: once(() => { const t = grainTex({ base: '#b07b63', dark: '#6a3f30', light: '#d7ab94', seed: 43, saw: 0.22, wash: 0.06 }); return new THREE.MeshStandardMaterial({ map: t, bumpMap: t, bumpScale: 1.5, roughness: 0.88 }); }),
  woodLightH: once(() => rotated(L.woodLight())),
  bottle: once(() => new THREE.MeshPhysicalMaterial({ color: 0x1c2a1c, roughness: 0.1, clearcoat: 1, metalness: 0.1 })),
  foil: once(() => new THREE.MeshStandardMaterial({ color: 0x5a1420, roughness: 0.35, metalness: 0.6 })),
  panelGrey: once(() => new THREE.MeshStandardMaterial({ color: 0x8b9892, roughness: 0.55, metalness: 0.35 })),
  stem: once(() => new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 0.9 })),
  blossomPink: once(() => new THREE.MeshStandardMaterial({ color: 0xd9a6b4, roughness: 0.9 })),
  blossomWhite: once(() => new THREE.MeshStandardMaterial({ color: 0xf1ece4, roughness: 0.9 })),
};

// merge a list of meshes (same material) into one mesh — keeps draw calls low for wire grids, slats, etc.
export function merged(meshes, mat) {
  const geos = meshes.map(m => { m.updateMatrix(); const g = m.geometry.index ? m.geometry : m.geometry; return g.clone().applyMatrix4(m.matrix); });
  const mesh = new THREE.Mesh(mergeGeometries(geos), mat); mesh.castShadow = mesh.receiveShadow = true; return mesh;
}
// a cylinder between two points (pipes, struts, wires)
export function rod(a, b, r, mat, seg = 12, open = false) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), len = A.distanceTo(B);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg, 1, open), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  m.castShadow = m.receiveShadow = true; return m;
}
// lathe rotated so its axis points along +Z (door rings, knobs, discs facing the viewer)
function latheZ(profile, mat, opts = {}) { const m = lathe(profile, mat, opts); m.rotation.x = PI / 2; return m; }

// =====================================================================================================
// Stacked washer + dryer — Electrolux-style slate-blue laundry tower (g48/g49): dryer on top, washer below,
// a black control strip between them, dark bezels with chrome rings and glass, perforated steel drums.
export function washerDryer() {
  const W = 0.68, H = 1.95, D = 0.75, zf = 0.305; // front panel face at zf, door rings to +0.375
  const root = new THREE.Group(), S = L.slate();
  const zb = -D / 2, bodyD = zf - zb;
  root.add(box(0.022, H - 0.012, bodyD, S, { r: 0.008, x: -W / 2 + 0.011, y: 0.012, z: zb + bodyD / 2, bottom: true }));
  root.add(box(0.022, H - 0.012, bodyD, S, { r: 0.008, x: W / 2 - 0.011, y: 0.012, z: zb + bodyD / 2, bottom: true }));
  root.add(box(W, 0.025, bodyD, S, { r: 0.008, y: H - 0.025, z: zb + bodyD / 2, bottom: true }));
  root.add(box(W - 0.04, H - 0.04, 0.02, S, { y: 0.012, z: zb + 0.01, bottom: true }));
  root.add(box(W - 0.04, 0.02, bodyD, S, { y: 0.012, z: zb + bodyD / 2, bottom: true }));
  // front panel with two porthole cut-outs
  const wy = 0.50, dy = 1.52, hr = 0.205, bv = 0.004;
  const circle = (cy) => Array.from({ length: 40 }, (_, i) => { const a = -i / 40 * PI * 2; return [Math.cos(a) * hr, cy + Math.sin(a) * hr]; });
  const fp = extrude([[-W / 2 + bv, 0.012 + bv], [W / 2 - bv, 0.012 + bv], [W / 2 - bv, H - bv], [-W / 2 + bv, H - bv]], 0.018 - 2 * bv, S, { bevel: bv, z: zf - 0.018 + bv, holes: [circle(wy), circle(dy)] });
  root.add(fp);
  // a fine seam where the dryer cabinet sits on the washer, and the kick plate
  root.add(box(W + 0.002, 0.004, D - 0.06, L.shadowGap(), { y: 0.915, z: -0.02 }));
  root.add(box(W - 0.06, 0.05, 0.004, L.bezel(), { y: 0.04, z: zf + 0.002, bottom: true }));
  // control strip (black glass) with displays, dials and buttons
  root.add(box(W - 0.03, 0.17, 0.014, L.blackGlass(), { r: 0.004, y: 0.935, z: zf + 0.006, bottom: true }));
  for (const [y, k] of [[1.06, 0], [0.985, 1]]) {
    root.add(box(0.12, 0.034, 0.004, L.display(), { x: -0.02, y, z: zf + 0.014 }));
    root.add(cyl(0.024, 0.026, 0.02, L.steelDark(), { x: -0.22, y, z: zf + 0.022, rx: PI / 2, seg: 24 }));
    root.add(cyl(0.004, 0.004, 0.022, L.chrome(), { x: -0.22, y: y + 0.014, z: zf + 0.024, rx: PI / 2, seg: 6 }));
    root.add(repeat(4, (i) => box(0.026, 0.012, 0.006, L.steelDark(), { r: 0.002, x: 0.08 + i * 0.045, y, z: zf + 0.015 })));
    root.add(cyl(0.012, 0.012, 0.008, k ? L.steelDark() : L.chrome(), { x: 0.29, y, z: zf + 0.016, rx: PI / 2, seg: 16 }));
  }
  // portholes: perforated drum, (washer) rubber boot, dark bezel ring, chrome trim, domed glass, hinge
  for (const [cy, washer] of [[wy, true], [dy, false]]) {
    const d = new THREE.Group(); d.position.set(0, cy, 0);
    const drum = cyl(hr, hr, 0.32, L.drum(), { z: zf - 0.16, rx: PI / 2, seg: 32, open: true }); d.add(drum);
    d.add(cyl(hr, hr, 0.004, L.drum(), { z: zf - 0.32, rx: PI / 2, seg: 32 }));
    d.add(repeat(3, (i) => { const a = i / 3 * PI * 2; const b = box(0.03, 0.06, 0.26, L.drum(), { r: 0.01, x: Math.cos(a) * (hr - 0.02), y: Math.sin(a) * (hr - 0.02), z: zf - 0.17 }); b.rotation.z = a + PI / 2; return b; }));
    if (washer) d.add(torus(hr - 0.008, 0.02, L.rubber(), { z: zf - 0.01, seg: 40, tube: 10 }));
    d.add(latheZ([[0.198, 0], [0.215, 0.004], [0.25, 0.022], [0.258, 0.04], [0.25, 0.058], [0.232, 0.066], [0.2, 0.06], [0.19, 0.05]], L.bezel(), { seg: 48, z: zf + 0.002 }));
    d.add(torus(0.212, 0.0055, L.chrome(), { z: zf + 0.064, seg: 48, tube: 8 }));
    d.add(latheZ([[0.2, 0], [0.19, 0.012], [0.15, 0.028], [0.08, 0.038], [0, 0.041]], L.doorGlass(), { seg: 40, z: zf + 0.03 }));
    d.add(box(0.03, 0.09, 0.03, L.bezel(), { r: 0.006, x: -0.245, z: zf + 0.02 }));
    root.add(d);
  }
  // leveling feet
  root.add(legs(W - 0.06, D - 0.1, 0, () => group(cyl(0.022, 0.025, 0.012, L.wheel(), { bottom: true, seg: 12 }))));
  return autoCollider(describe(root, { id: 'bath-washerDryer', name: 'Stacked washer & dryer', zh: '叠放洗衣烘干机' }));
}

// =====================================================================================================
// Electric water heater (g49): light grey jacket Ø0.55, white top cap, element covers, yellow energy label,
// copper supply lines with ball valves, T&P relief valve and discharge pipe, on a black stand + drain pan.
export function waterHeater() {
  const root = new THREE.Group(), R = 0.275, G = L.heaterGrey(), WP = L.plasticWhite();
  // stand + drain pan
  root.add(legs(0.5, 0.5, 0.02, () => group(box(0.03, 0.07, 0.03, M.blackSteel(), { r: 0.004, bottom: true }))));
  root.add(box(0.56, 0.015, 0.56, M.blackSteel(), { r: 0.004, y: 0.07, bottom: true }));
  root.add(lathe([[0.30, 0], [0.31, 0.005], [0.31, 0.045], [0.302, 0.045], [0.296, 0.008], [0, 0.008]], WP, { y: 0.085, seg: 40 }));
  // jacket and caps
  const y0 = 0.10;
  root.add(lathe([[0, 0], [0.24, 0], [0.268, 0.01], [0.274, 0.04], [0.276, 0.06]], M.blackMatte(), { y: y0, seg: 40 }));
  root.add(lathe([[0.276, 0], [R, 1.1]], G, { y: y0 + 0.06, seg: 48 }));
  root.add(lathe([[0.279, 0], [0.28, 0.02], [0.272, 0.06], [0.24, 0.1], [0.12, 0.13], [0, 0.135]], WP, { y: y0 + 1.14, seg: 48 }));
  // element access covers, thermostat plate, labels (all on the front, +Z)
  const onJacket = (o, y, a = 0, out = 0) => { o.position.set(Math.sin(a) * (R + out), y, Math.cos(a) * (R + out)); o.rotation.y = a; return o; };
  root.add(onJacket(box(0.12, 0.15, 0.012, G, { r: 0.004 }), 0.42));
  root.add(onJacket(box(0.12, 0.15, 0.012, G, { r: 0.004 }), 0.98));
  root.add(onJacket(box(0.03, 0.02, 0.01, M.blackMatte(), { r: 0.003 }), 0.98, 0, 0.01));
  root.add(onJacket(plane(0.13, 0.16, L.label()), 0.82, -0.5, 0.003));
  root.add(onJacket(plane(0.09, 0.05, M.aluminum()), 1.12, 0.35, 0.003));
  root.add(onJacket(box(0.10, 0.09, 0.012, M.blackMatte(), { r: 0.003 }), 1.15, 0.0, 0.004));
  // drain valve
  root.add(onJacket(cyl(0.012, 0.012, 0.05, WP, { rx: PI / 2, seg: 12 }), 0.24, 0.3, 0.02));
  root.add(onJacket(cyl(0.02, 0.02, 0.012, WP, { rx: PI / 2, seg: 6 }), 0.24, 0.3, 0.05));
  // top: cold (blue) and hot (red) copper lines with ball valves, bending back toward the wall (-Z)
  const yt = y0 + 1.275;
  for (const [x, h] of [[-0.12, L.blueHandle()], [0.12, L.redHandle()]]) {
    root.add(cyl(0.022, 0.022, 0.02, L.brass(), { x, y: yt - 0.012, z: 0.02, seg: 12, bottom: true }));
    root.add(tube([[x, yt, 0.02], [x, yt + 0.05, 0.02], [x, yt + 0.09, 0.0], [x, yt + 0.11, -0.12], [x, yt + 0.11, -0.29]], 0.011, L.copper(), { seg: 24, radial: 10 }));
    root.add(box(0.035, 0.04, 0.035, L.brass(), { r: 0.006, x, y: yt + 0.05, z: 0.02 }));
    root.add(box(0.07, 0.008, 0.016, h, { r: 0.003, x: x + 0.03, y: yt + 0.075, z: 0.02 }));
  }
  // electrical junction box and flexible conduit
  root.add(box(0.07, 0.04, 0.07, G, { r: 0.004, x: 0, y: yt - 0.01, z: -0.15, bottom: true }));
  root.add(tube([[0, yt + 0.03, -0.15], [0, yt + 0.1, -0.18], [0.02, yt + 0.11, -0.29]], 0.009, L.hose(), { seg: 16, radial: 8 }));
  // T&P relief valve on the side and its discharge pipe to near the floor
  root.add(box(0.05, 0.05, 0.04, L.brass(), { r: 0.006, x: R + 0.02, y: 1.17 }));
  root.add(box(0.012, 0.05, 0.006, L.brass(), { x: R + 0.02, y: 1.21 }));
  root.add(tube([[R + 0.045, 1.17, 0], [R + 0.075, 1.15, 0], [R + 0.075, 1.02, 0], [R + 0.075, 0.18, 0]], 0.011, L.copper(), { seg: 24, radial: 10 }));
  return autoCollider(describe(root, { id: 'bath-waterHeater', name: 'Electric water heater', zh: '电热水器' }));
}

// =====================================================================================================
// Black wire shelving 1.20 × 0.45 × 1.80 (5 wire-grid shelves on Ø25 mm posts) with storage totes and boxes.
export function wireShelving() {
  const W = 1.2, D = 0.45, H = 1.8, root = new THREE.Group(), K = M.blackSteel();
  const pr = 0.0127, px = W / 2 - pr, pz = D / 2 - pr;
  const levels = [0.14, 0.55, 0.96, 1.37, 1.77];
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    root.add(cyl(pr, pr, H - 0.03, K, { x: sx * px, z: sz * pz, y: 0.02, bottom: true, seg: 16 }));
    root.add(cyl(0.016, 0.02, 0.02, K, { x: sx * px, z: sz * pz, bottom: true, seg: 12 }));
    root.add(cyl(pr + 0.001, pr + 0.001, 0.008, K, { x: sx * px, z: sz * pz, y: H - 0.008, bottom: true, seg: 16 }));
  }
  // one shelf mat, merged, then cloned per level
  const parts = [], wr = 0.0022, inner = W - 0.05, sd = D - 0.03;
  const nW = Math.round(inner / 0.025);
  for (let i = 0; i <= nW; i++) parts.push(rod([-inner / 2 + i * inner / nW, 0, -sd / 2], [-inner / 2 + i * inner / nW, 0, sd / 2], wr, K, 6, true));
  for (const z of [-0.12, 0, 0.12]) parts.push(rod([-inner / 2, -0.004, z], [inner / 2, -0.004, z], 0.0028, K, 6, true));
  for (const sz of [1, -1]) {
    const z = sz * sd / 2;
    parts.push(rod([-W / 2 + 0.012, 0, z], [W / 2 - 0.012, 0, z], 0.0035, K, 8, true));
    parts.push(rod([-W / 2 + 0.012, -0.03, z], [W / 2 - 0.012, -0.03, z], 0.003, K, 8, true));
    const n = 30; for (let i = 0; i < n; i++) { const xa = -inner / 2 + i * inner / n, xb = xa + inner / n; parts.push(rod([xa, i % 2 ? -0.03 : 0, z], [xb, i % 2 ? 0 : -0.03, z], 0.0022, K, 6, true)); }
  }
  for (const sx of [1, -1]) { parts.push(rod([sx * (W / 2 - 0.015), 0, -sd / 2], [sx * (W / 2 - 0.015), 0, sd / 2], 0.0035, K, 8, true)); parts.push(rod([sx * (W / 2 - 0.015), -0.03, -sd / 2], [sx * (W / 2 - 0.015), -0.03, sd / 2], 0.003, K, 8, true)); }
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.017, 0.04, 12, 1, true), K); c.position.set(sx * px, -0.018, sz * pz); parts.push(c); }
  const mat = merged(parts, K);
  for (const y of levels) { const s = mat.clone(); s.position.y = y; root.add(s); }
  // storage: two big totes on the floor shelf, one on the middle shelf, two cardboard boxes
  const tote = (w, h, d) => {
    const g = new THREE.Group();
    g.add(box(w - 0.02, h - 0.025, d - 0.02, L.tote(), { r: 0.02, bottom: true }));
    g.add(box(w - 0.08, (h - 0.06) * 0.7, d - 0.1, M.linenGrey(), { r: 0.03, y: 0.01, bottom: true }));
    g.add(box(w, 0.03, d, L.toteLid(), { r: 0.01, y: h - 0.03, bottom: true }));
    g.add(box(w * 0.5, 0.012, d * 0.5, L.toteLid(), { r: 0.005, y: h, bottom: true }));
    return g;
  };
  const carton = (w, h, d) => group(box(w, h, d, L.kraft(), { r: 0.004, bottom: true }), box(0.05, 0.002, d + 0.004, L.tape(), { y: h, }), box(0.002, h * 0.25, 0.002, L.shadowGap(), { y: h * 0.86, z: d / 2 + 0.001 }));
  root.add(at(tote(0.54, 0.32, 0.40), -0.29, levels[0], 0.01));
  root.add(at(tote(0.54, 0.32, 0.40), 0.29, levels[0], 0.01));
  root.add(at(tote(0.42, 0.26, 0.36), -0.33, levels[2], 0.0));
  root.add(at(carton(0.40, 0.28, 0.34), 0.30, levels[2], 0.0, 0.05));
  root.add(at(carton(0.46, 0.22, 0.38), -0.2, levels[3], 0.0, -0.04));
  root.add(at(group(cyl(0.085, 0.085, 0.19, M.steel(), { bottom: true, seg: 20 }), cyl(0.087, 0.087, 0.012, M.steel(), { y: 0.19, bottom: true, seg: 20 })), 0.32, levels[1], 0.05));
  return autoCollider(describe(root, { id: 'bath-wireShelving', name: 'Black wire shelving unit', zh: '黑色金属网架' }));
}

// =====================================================================================================
// Ping-pong table, regulation 2.74 × 1.525 × 0.76: two blue halves with white lines, grey steel rollaway
// undercarriage (folding legs, casters), black net with white tape on clamp posts. Long axis = X.
export function pingPongTable() {
  const root = new THREE.Group(), Lx = 2.74, Wz = 1.525, H = 0.76, t = 0.019, F = L.frameGrey();
  for (const s of [-1, 1]) root.add(box(Lx / 2 - 0.003, t, Wz, L.tableBlue(), { r: 0.003, x: s * (Lx / 4 + 0.0015), y: H - t, bottom: true }));
  root.add(plane(Lx - 0.006, Wz - 0.006, L.tableTop(), { y: H + 0.0004, rx: -PI / 2 }));
  // apron frame under each half
  const yA = H - t - 0.045;
  for (const s of [-1, 1]) {
    const cx = s * Lx / 4;
    for (const sz of [-1, 1]) root.add(box(Lx / 2 - 0.16, 0.045, 0.025, F, { r: 0.003, x: cx, y: yA, z: sz * (Wz / 2 - 0.07), bottom: true }));
    root.add(box(0.025, 0.045, Wz - 0.14, F, { r: 0.003, x: s * (Lx / 2 - 0.08), y: yA, bottom: true }));
    root.add(box(0.025, 0.045, Wz - 0.14, F, { r: 0.003, x: s * 0.08, y: yA, bottom: true }));
    // outer folding leg frame with casters
    const lx = s * (Lx / 2 - 0.25);
    for (const sz of [-1, 1]) {
      root.add(box(0.032, yA - 0.07, 0.032, F, { r: 0.004, x: lx, y: 0.07, z: sz * (Wz / 2 - 0.12), bottom: true }));
      root.add(cyl(0.025, 0.025, 0.02, L.wheel(), { x: lx, y: 0.028, z: sz * (Wz / 2 - 0.12), rx: PI / 2, seg: 16 }));
      root.add(box(0.03, 0.03, 0.03, F, { x: lx, y: 0.055, z: sz * (Wz / 2 - 0.12) }));
      root.add(rod([lx, 0.45, sz * (Wz / 2 - 0.12)], [s * 0.2, yA, sz * (Wz / 2 - 0.12)], 0.011, F, 10));
    }
    root.add(box(0.025, 0.025, Wz - 0.24, F, { x: lx, y: 0.16, bottom: true }));
    root.add(box(0.025, 0.025, Wz - 0.24, F, { x: lx, y: 0.6, bottom: true }));
  }
  // central rollaway chassis with big wheels
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * 0.12, z = sz * (Wz / 2 - 0.2);
    root.add(rod([x, 0.11, z], [sx * 0.08, yA, z * 0.92], 0.014, F, 12));
    root.add(cyl(0.0625, 0.0625, 0.035, L.wheel(), { x, y: 0.0625, z, rx: PI / 2, seg: 24 }));
    root.add(cyl(0.03, 0.03, 0.04, F, { x, y: 0.0625, z, rx: PI / 2, seg: 16 }));
  }
  for (const sz of [-1, 1]) root.add(rod([-0.12, 0.11, sz * (Wz / 2 - 0.2)], [0.12, 0.11, sz * (Wz / 2 - 0.2)], 0.012, F, 10));
  // net: 1.83 long, 0.1525 high, overhanging each side by 0.1525
  const NL = Wz + 0.305, NH = 0.1525;
  root.add(plane(NL, NH - 0.015, L.net(), { y: H + (NH - 0.015) / 2, rx: 0, ry: PI / 2 }));
  root.add(box(0.006, 0.016, NL, M.linen(), { y: H + NH - 0.008 }));
  root.add(box(0.004, 0.004, NL, M.blackMatte(), { y: H + 0.004 }));
  for (const sz of [-1, 1]) {
    root.add(cyl(0.008, 0.008, NH + 0.004, F, { y: H, z: sz * NL / 2, bottom: true, seg: 12 }));
    root.add(box(0.05, 0.05, 0.02, F, { r: 0.004, y: H - 0.03, z: sz * (Wz / 2 + 0.01) }));
    root.add(box(0.03, 0.015, 0.16, F, { r: 0.003, y: H - t - 0.012, z: sz * (Wz / 2 + 0.01 - 0.07) }));
  }
  return autoCollider(describe(root, { id: 'bath-pingPongTable', name: 'Ping-pong table', zh: '乒乓球台' }));
}

// =====================================================================================================
// Rustic reclaimed-wood console with wine cubbies (g48/g49): thick dark rough-sawn top, two drawers with
// bar pulls, cubby grid of lighter weathered wood below, slatted sides; white double-handled jug with dried flowers.
export function consoleRustic() {
  const W = 1.2, D = 0.4, H = 0.8, root = new THREE.Group();
  const dk = L.woodDark(), dkH = L.woodDarkH(), lt = L.woodLight(), ltH = L.woodLightH();
  const topT = 0.045, legW = 0.06;
  root.add(box(W, topT, D, dkH, { r: 0.008, y: H - topT, bottom: true }));
  root.add(legs(W - 0.02, D - 0.02, legW / 2, () => group(box(legW, H - topT, legW, lt, { r: 0.006, bottom: true }))));
  // drawer rail band and two drawers
  const dTop = H - topT, dH = 0.15, dBot = dTop - dH;
  root.add(box(W - 0.05, dH, D - 0.06, lt, { y: dBot, z: -0.0, bottom: true }));
  const drw = (W - 2 * legW - 0.03) / 2;
  for (const s of [-1, 1]) {
    root.add(box(drw - 0.008, dH - 0.03, 0.02, dkH, { r: 0.004, x: s * (drw / 2 + 0.005), y: dBot + 0.015, z: D / 2 - 0.02, bottom: true }));
    const p = new THREE.Group(); p.position.set(s * (drw / 2 + 0.005), dBot + dH / 2, D / 2 - 0.0);
    p.add(box(0.13, 0.012, 0.008, M.aluminum(), { r: 0.004, z: 0.018 }));
    for (const sx of [-1, 1]) p.add(cyl(0.006, 0.006, 0.02, M.aluminum(), { x: sx * 0.05, z: 0.008, rx: PI / 2, seg: 8 }));
    root.add(p);
  }
  root.add(box(0.03, dH - 0.02, 0.02, lt, { y: dBot + 0.01, z: D / 2 - 0.02, bottom: true }));
  // bottom shelf and back
  const yb = 0.09;
  root.add(box(W - 0.06, 0.03, D - 0.04, ltH, { y: yb, bottom: true }));
  root.add(box(W - 0.06, dBot - yb, 0.015, lt, { y: yb, z: -D / 2 + 0.03, bottom: true }));
  // wine cubby grid (cells ≈ 0.11 × 0.14, sized for bottles)
  const cols = 9, rows = 3, gx0 = -W / 2 + legW, gx1 = W / 2 - legW, gy0 = yb + 0.03, gy1 = dBot - 0.012;
  const cw = (gx1 - gx0) / cols, ch = (gy1 - gy0) / rows, dz = D - 0.08;
  const slats = [];
  for (let i = 1; i < cols; i++) slats.push(box(0.016, gy1 - gy0, dz, lt, { x: gx0 + i * cw, y: gy0, z: 0.005, bottom: true }));
  for (let j = 1; j < rows; j++) slats.push(box(gx1 - gx0, 0.014, dz, ltH, { y: gy0 + j * ch - 0.007, z: 0.005, bottom: true }));
  root.add(group(...slats));
  // a few bottles lying in the cubbies, punts facing out
  const bottle = lathe([[0, 0], [0.037, 0.002], [0.038, 0.2], [0.03, 0.235], [0.014, 0.26], [0.014, 0.3], [0, 0.3]], L.bottle(), { seg: 16 });
  const neck = cyl(0.0145, 0.0145, 0.04, L.foil(), { y: 0.275, seg: 12 });
  const proto = group(bottle, neck);
  [[1, 0], [2, 0], [4, 1], [6, 0], [7, 2], [3, 2], [8, 1]].forEach(([c, r], k) => {
    const b = proto.clone(); b.rotation.x = -PI / 2; b.rotation.y = k * 0.7; b.position.set(gx0 + (c + 0.5) * cw, gy0 + r * ch + 0.045, 0.165); root.add(b);
  });
  // slatted sides (vertical slats between the legs)
  for (const s of [-1, 1]) {
    const x = s * (W / 2 - 0.015);
    root.add(box(0.03, 0.05, D - 2 * legW, lt, { x, y: dBot - 0.05, bottom: true }));
    root.add(box(0.03, 0.04, D - 2 * legW, lt, { x, y: yb - 0.02, bottom: true }));
    root.add(box(0.025, dH - 0.01, D - 2 * legW, ltH, { x, y: dBot, bottom: true }));
    root.add(repeat(5, (i) => box(0.022, dBot - 0.05 - yb - 0.02, 0.032, lt, { r: 0.003, x, y: yb + 0.02, z: -D / 2 + legW + 0.028 + i * 0.058, bottom: true })));
  }
  // vase with dried flowers, on the left of the top
  const vase = new THREE.Group(); vase.position.set(-0.38, H, -0.02);
  vase.add(lathe([[0, 0], [0.065, 0], [0.075, 0.01], [0.105, 0.06], [0.112, 0.12], [0.1, 0.18], [0.07, 0.22], [0.045, 0.245], [0.043, 0.27], [0.05, 0.285], [0.046, 0.29], [0.036, 0.275], [0.036, 0.24], [0, 0.23]], M.terracottaWhite(), { seg: 32 }));
  for (const s of [-1, 1]) { const h = torus(0.03, 0.008, M.terracottaWhite(), { arc: PI * 1.1, seg: 16, tube: 8, x: s * 0.075, y: 0.215, rz: s > 0 ? -0.7 : PI + 0.7 }); vase.add(h); }
  const r = rng(77), stems = [], blooms = [], bloomsW = [];
  for (let i = 0; i < 16; i++) {
    const a = r() * PI * 2, lean = 0.15 + r() * 0.35, len = 0.28 + r() * 0.18;
    const top = [Math.cos(a) * Math.sin(lean) * len, 0.24 + Math.cos(lean) * len, Math.sin(a) * Math.sin(lean) * len];
    stems.push(rod([0, 0.24, 0], top, 0.0018, L.stem(), 5, true));
    for (let k = 0; k < 5; k++) { const sp = sphere(0.012 + r() * 0.01, L.blossomPink(), { seg: 6, x: top[0] + (r() - 0.5) * 0.06, y: top[1] + (r() - 0.5) * 0.05, z: top[2] + (r() - 0.5) * 0.06 }); (k % 2 ? bloomsW : blooms).push(sp); }
  }
  vase.add(merged(stems, L.stem()), merged(blooms, L.blossomPink()), merged(bloomsW, L.blossomWhite()));
  root.add(vase);
  return autoCollider(describe(root, { id: 'bath-consoleRustic', name: 'Reclaimed-wood wine console', zh: '复古酒格边柜' }));
}

// =====================================================================================================
// Electrical panel (g48): grey-green steel load-centre cover 0.37 × 0.75 × 0.10 at 1.20–1.95, inner door with latch.
export function electricalPanel() {
  const root = new THREE.Group(), P = L.panelGrey(), y0 = 1.2, H = 0.75, W = 0.37, D = 0.1;
  root.add(box(W, H, D - 0.006, P, { r: 0.006, y: y0, z: -0.003, bottom: true }));
  root.add(box(W - 0.02, H - 0.02, 0.006, P, { r: 0.003, y: y0 + 0.01, z: D / 2 - 0.006, bottom: true }));
  const dw = 0.2, dh = 0.46, dy = y0 + 0.17;
  for (const [w, h, x, y] of [[dw + 0.006, 0.004, 0, dy], [dw + 0.006, 0.004, 0, dy + dh], [0.004, dh, -dw / 2, dy + dh / 2], [0.004, dh, dw / 2, dy + dh / 2]])
    root.add(box(w, h, 0.004, L.shadowGap(), { x, y: w > 0.01 ? y : y, z: D / 2 - 0.001 }));
  root.add(box(dw - 0.006, dh - 0.006, 0.004, P, { r: 0.002, y: dy + dh / 2, z: D / 2 + 0.001 }));
  root.add(box(0.012, 0.03, 0.008, M.steel(), { r: 0.002, x: dw / 2 - 0.02, y: dy + dh / 2, z: D / 2 + 0.004 }));
  for (const [x, y] of [[-1, 0], [1, 0], [-1, 1], [1, 1]]) root.add(cyl(0.006, 0.006, 0.004, M.steel(), { x: x * (W / 2 - 0.03), y: y0 + 0.04 + y * (H - 0.08), z: D / 2 + 0.001, rx: PI / 2, seg: 10 }));
  root.add(plane(0.12, 0.05, M.paper(), { x: 0.0, y: y0 + 0.1, z: D / 2 + 0.0005 }));
  root.add(cyl(0.012, 0.012, 0.05, M.blackMatte(), { x: 0.1, y: y0 + H, z: -0.02, bottom: true, seg: 12 }));
  return describe(root, { id: 'bath-electricalPanel', name: 'Electrical panel', zh: '配电箱' });
}
