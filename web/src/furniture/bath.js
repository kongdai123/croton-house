// bath — three bathrooms (refs/bath g30 primary, g31/g34 hall, g36 guest) + garage / laundry (g48, g49).
// Bathroom pieces live here; shared local materials and the garage pieces are in bath_parts.js.
// Units metres; origin on the floor at the footprint centre; +Z = front; wall-mounted pieces have their back at -Z.
import { THREE, M, box, cyl, lathe, extrude, tube, at, repeat, setCollider, autoCollider, describe, sphere, declare } from '../kit.js';
import { L, PI, retile, rod, washerDryer, waterHeater, wireShelving, pingPongTable, consoleRustic, electricalPanel } from './bath_parts.js';

const rrect = (x0, y0, x1, y1, r, n = 6) => {
  const pts = [], c = [[x1 - r, y0 + r, -PI / 2], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, PI / 2], [x0 + r, y0 + r, PI]];
  for (const [cx, cy, a0] of c) for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * PI / 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return pts;
};

// =====================================================================================================
// Wall-hung vanity: dark walnut cabinet with two push-open drawers + shadow gaps, a 12 cm one-piece white
// solid-surface top with a long integrated trough basin sloping to a slot drain, and a tall brushed-nickel
// single-lever faucet (Moen Eva-like, as in every bathroom photo). Bottom at 0.45, deck at 0.90.
function faucet() {
  const f = new THREE.Group(), N = M.steel();
  f.add(cyl(0.03, 0.031, 0.006, N, { bottom: true, seg: 24 }));
  f.add(lathe([[0.03, 0], [0.028, 0.02], [0.024, 0.07], [0.0225, 0.13], [0.023, 0.165], [0.024, 0.18], [0.021, 0.195], [0.011, 0.203], [0, 0.205]], N, { y: 0.006, seg: 24 }));
  f.add(tube([[0, 0.16, 0.008], [0, 0.178, 0.05], [0, 0.17, 0.095], [0, 0.148, 0.12], [0, 0.132, 0.126]], 0.0095, N, { seg: 24, radial: 12 }));
  f.add(cyl(0.0105, 0.0105, 0.012, N, { y: 0.128, z: 0.126, seg: 16 }));
  f.add(cyl(0.0075, 0.0075, 0.002, L.shadowGap(), { y: 0.1215, z: 0.126, seg: 12 }));
  const lever = box(0.014, 0.07, 0.02, N, { r: 0.006, seg: 3, y: 0.218, z: -0.03 }); lever.rotation.x = -0.95; f.add(lever);
  return f;
}
function vanity(W, id, name, zh, sinks = 1) {
  const root = new THREE.Group(), D = 0.5, y0 = 0.45, cabH = 0.325, topH = 0.12, yT = 0.78, wood = L.vanityWood(), woodH = L.vanityWoodH();
  const zb = -D / 2, cabD = 0.44;
  root.add(box(W - 0.012, cabH, cabD, wood, { r: 0.004, y: y0, z: zb + cabD / 2, bottom: true }));
  // two stacked drawer fronts, 4 mm shadow gaps, no handles (push-open)
  const fz = zb + cabD + 0.0095, fh = (cabH - 0.006) / 2;
  for (let i = 0; i < 2; i++) root.add(box(W - 0.016, fh - 0.002, 0.019, woodH, { r: 0.003, y: y0 + 0.001 + i * (fh + 0.004), z: fz, bottom: true }));
  root.add(box(W - 0.03, 0.005, 0.01, L.shadowGap(), { y: y0 + fh + 0.0015, z: fz - 0.006, bottom: true }));
  // reveal under the top
  root.add(box(W - 0.04, 0.006, 0.03, L.shadowGap(), { y: y0 + cabH - 0.001, z: fz - 0.02, bottom: true }));
  // solid-surface top with the trough cut-out
  // one trough per sink (the primary bath's 1.50 top has two side by side, g30)
  const b = 0.006, hw = W / 2 - b, hd = D / 2 - b, by0 = -0.15, by1 = 0.13;
  const bw = sinks > 1 ? W / sinks - 0.16 : W - 0.4, cxs = Array.from({ length: sinks }, (_, i) => -W / 2 + (W / sinks) * (i + 0.5));
  const holes = cxs.map(cx => rrect(cx - bw / 2, by0, cx + bw / 2, by1, 0.055).reverse());
  root.add(extrude([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]], topH - 2 * b, M.ceramicWhite(), { bevel: b, rx: -PI / 2, y: yT + b, holes }));
  for (const cx of cxs) {
    // basin floor sloping 4° toward the back, slot drain with a brushed cover
    root.add(extrude(rrect(cx - bw / 2 - 0.004, by0 - 0.004, cx + bw / 2 + 0.004, by1 + 0.004, 0.055), 0.01, M.ceramicWhite(), { rx: -PI / 2 - 0.07, y: 0.797 }));
    root.add(box(bw * 0.5, 0.004, 0.03, L.shadowGap(), { x: cx, y: 0.8055 - 0.07 * 0.115, z: -0.115, rx: -0.07 }));
    root.add(box(bw * 0.48, 0.003, 0.022, L.steelDark(), { r: 0.001, x: cx, y: 0.808 - 0.07 * 0.115, z: -0.115, rx: -0.07 }));
    root.add(at(faucet(), cx, yT + topH, -0.185));
  }
  return autoCollider(describe(root, { id, name, zh }));
}

// =====================================================================================================
// Mirrored medicine cabinet: white body 0.14 deep, mirror doors with fine seams, 1.05–1.75 high (g30, g34, g36).
function mirrorCabinet(W, doors, id, name, zh) {
  const root = new THREE.Group(), H = 0.7, y0 = 1.05, D = 0.14, dt = 0.02;
  root.add(box(W, H, D - dt, M.cabinetWhite(), { r: 0.004, y: y0, z: -D / 2 + (D - dt) / 2, bottom: true }));
  const edge = L.mirrorEdge(), mats = [edge, edge, edge, edge, M.mirror(), edge];
  const gap = 0.003, dw = (W - gap * (doors - 1)) / doors;
  for (let i = 0; i < doors; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(dw, H - 0.002, dt), mats); m.castShadow = m.receiveShadow = true;
    m.position.set(-W / 2 + dw / 2 + i * (dw + gap), y0 + H / 2, D / 2 - dt / 2); root.add(m);
  }
  for (let i = 1; i < doors; i++) root.add(box(gap, H - 0.004, 0.004, L.shadowGap(), { x: -W / 2 + i * (dw + gap) - gap / 2, y: y0 + H / 2, z: D / 2 - dt - 0.001 }));
  // finger notches on the bottom edge of each door
  for (let i = 0; i < doors; i++) root.add(box(0.05, 0.004, 0.012, L.shadowGap(), { r: 0.0015, x: -W / 2 + dw / 2 + i * (dw + gap) + (i % 2 ? -1 : 1) * (dw / 2 - 0.05), y: y0 + 0.001, z: D / 2 - 0.009 }));
  return describe(root, { id, name, zh });
}

// =====================================================================================================
// One-piece elongated toilet with skirted-back tank, soft-close seat + lid, chrome trip lever, angle stop.
function egg(rx, front, back, n = 40, dy = 0) {
  return Array.from({ length: n }, (_, i) => { const t = (i / n) * PI * 2, s = Math.sin(t); return [Math.cos(t) * rx, dy + s * (s < 0 ? front : back)]; });
}
function toilet() {
  const root = new THREE.Group(), P = M.ceramicWhite(), bz = 0.115, ez = 1.24;
  const bowl = lathe([[0.122, 0], [0.128, 0.012], [0.114, 0.05], [0.103, 0.13], [0.112, 0.2], [0.142, 0.27], [0.172, 0.33], [0.188, 0.368], [0.186, 0.384], [0.17, 0.39], [0.14, 0.37], [0.07, 0.29], [0, 0.27]], P, { seg: 40 });
  bowl.scale.set(1, 1, ez); bowl.position.z = bz; root.add(bowl);
  // trapway / skirt joining bowl and tank
  root.add(box(0.24, 0.38, 0.3, P, { r: 0.07, seg: 4, y: 0, z: -0.17, bottom: true }));
  // tank and lid
  root.add(box(0.4, 0.36, 0.19, P, { r: 0.04, seg: 4, y: 0.375, z: -0.265, bottom: true }));
  root.add(box(0.42, 0.024, 0.205, P, { r: 0.011, seg: 3, y: 0.726, z: -0.262, bottom: true }));
  // seat ring + closed lid (soft-close), hinges
  const seatShape = egg(0.183, 0.236, 0.19), holeShape = egg(0.108, 0.16, 0.1, 40, -0.01).reverse();
  root.add(extrude(seatShape, 0.008, M.plasticWhite(), { bevel: 0.005, rx: -PI / 2, y: 0.395, z: bz, holes: [holeShape] }));
  root.add(extrude(egg(0.178, 0.232, 0.188), 0.006, M.plasticWhite(), { bevel: 0.008, rx: -PI / 2, y: 0.418, z: bz }));
  for (const s of [-1, 1]) root.add(box(0.035, 0.026, 0.05, M.plasticWhite(), { r: 0.008, x: s * 0.085, y: 0.392, z: -0.1, bottom: true }));
  root.add(box(0.2, 0.012, 0.035, M.plasticWhite(), { r: 0.005, y: 0.41, z: -0.105 }));
  // chrome trip lever on the tank front-left
  root.add(cyl(0.018, 0.018, 0.008, L.chrome(), { x: -0.14, y: 0.66, z: -0.168, rx: PI / 2, seg: 20 }));
  const lv = box(0.075, 0.012, 0.01, L.chrome(), { r: 0.004, x: -0.11, y: 0.655, z: -0.162 }); lv.rotation.z = -0.12; root.add(lv);
  // angle stop + braided supply
  root.add(cyl(0.022, 0.022, 0.006, L.chrome(), { x: -0.13, y: 0.17, z: -0.357, rx: PI / 2, seg: 16 }));
  root.add(box(0.03, 0.03, 0.05, L.chrome(), { r: 0.008, x: -0.13, y: 0.17, z: -0.33 }));
  root.add(box(0.02, 0.012, 0.03, L.chrome(), { r: 0.004, x: -0.13, y: 0.17, z: -0.295 }));
  root.add(tube([[-0.13, 0.185, -0.33], [-0.13, 0.28, -0.33], [-0.12, 0.37, -0.31]], 0.0055, L.hose(), { seg: 16, radial: 8 }));
  // bolt caps at the base
  for (const s of [-1, 1]) root.add(sphere(0.018, P, { seg: 12, x: s * 0.118, y: 0.03, z: 0.115, sy: 0.9 }));
  return autoCollider(describe(root, { id: 'bath-toilet', name: 'One-piece toilet', zh: '连体马桶' }));
}

// =====================================================================================================
// Walk-in corner shower 1.00 × 1.00 × 2.30: back (-Z) and left (-X) walls in 0.60 × 0.30 gloss white tile
// laid horizontally (as photographed), recessed niche, 2" grey-white marble mosaic pan, 0.10 white curb on
// the front and right, fixed clear glass panel 0.60 × 2.00 on the front (+Z) clamped to the left wall,
// chrome rain arm with a Ø0.20 head at 2.10, hand shower on a slide bar, single-lever valve trim.
// `win` [x0, x1, y0, y1]: a house window behind the back wall (shower-local x, heights), cut out of the tile with a tiled
// reveal `reveal` deep back to the window frame and a quartz stool (g34, g36: the east baths' windows are in the shower).
// The niche moves to the other side of the window or, without room for it, the bottles stand on the stool.
function shower({ win = null, reveal = 0.14 } = {}) {
  const root = new THREE.Group(), S = 1.0, H = 2.3, bt = 0.08, lt = 0.06, pan = 0.045, curb = 0.1;
  const T = retile(L.tileLarge(), 1 / 0.6, 1 / 0.3, { oy: -pan / 0.3 });
  // back wall with the niche (and the window) cut through it (extrude UVs are in metres)
  let nx0 = 0.06, nx1 = 0.36, niche = true;
  const ny0 = 1.08, ny1 = 1.38, xl = -S / 2 + lt;
  if (win && !(win[1] <= nx0 || win[0] >= nx1)) {
    if (win[0] - 0.06 - (xl + 0.04) >= nx1 - nx0) { nx1 = win[0] - 0.06; nx0 = nx1 - 0.3; }
    else if (S / 2 - 0.04 - (win[1] + 0.06) >= nx1 - nx0) { nx0 = win[1] + 0.06; nx1 = nx0 + 0.3; }
    else niche = false;
  }
  const outline = [[-S / 2, 0], [S / 2, 0], [S / 2, H], [-S / 2, H]], holes = [];
  if (niche) holes.push([[nx0, ny0], [nx0, ny1], [nx1, ny1], [nx1, ny0]]);
  if (win) {
    const [wx0, wx1, wy0, wy1] = [Math.max(win[0], -S / 2), Math.min(win[1], S / 2), win[2], Math.min(win[3], H - 0.02)];
    // a window reaching the wall's edge is a notch in the outline, else a hole
    if (wx1 >= S / 2) outline.splice(2, 0, [S / 2, wy0], [wx0, wy0], [wx0, wy1], [S / 2, wy1]);
    else if (wx0 <= -S / 2) outline.push([-S / 2, wy1], [wx1, wy1], [wx1, wy0], [-S / 2, wy0]);
    else holes.push([[wx0, wy0], [wx0, wy1], [wx1, wy1], [wx1, wy0]]);
    const w = wx1 - wx0, h = wy1 - wy0, zr = -S / 2 - reveal / 2 + 0.002, t = 0.012;
    root.add(box(w, t, reveal + bt, M.quartz(), { x: (wx0 + wx1) / 2, y: wy0 - t / 2 + 0.002, z: zr + bt / 2 }));   // stool
    root.add(box(w, t, reveal, T, { x: (wx0 + wx1) / 2, y: wy1 + t / 2, z: zr }));                                   // head
    if (wx0 > -S / 2) root.add(box(t, h, reveal, T, { x: wx0 - t / 2, y: wy0 + h / 2, z: zr }));
    if (wx1 < S / 2) root.add(box(t, h, reveal, T, { x: wx1 + t / 2, y: wy0 + h / 2, z: zr }));
  }
  root.add(extrude(outline, bt, T, { z: -S / 2, holes }));
  if (niche) {
    root.add(extrude([[nx0, ny0], [nx1, ny0], [nx1, ny1], [nx0, ny1]], 0.012, T, { z: -S / 2 + 0.004 }));
    root.add(box(nx1 - nx0, 0.012, bt - 0.012, M.quartz(), { r: 0.003, x: (nx0 + nx1) / 2, y: ny0 + 0.006, z: -S / 2 + 0.016 + (bt - 0.012) / 2 }));
  }
  // left wall: shape x → world -z after the 90° turn
  root.add(extrude([[-S / 2, 0], [S / 2 - bt, 0], [S / 2 - bt, H], [-S / 2, H]], lt, T, { x: -S / 2, ry: PI / 2 }));
  // mosaic pan and L-shaped curb
  const pm = retile(L.mosaic(), (S - lt) / 0.6, (S - bt - curb) / 0.6);
  const pw = S - lt - curb, pd = S - bt - curb;
  root.add(box(pw, pan, pd, pm, { x: -S / 2 + lt + pw / 2, z: -S / 2 + bt + pd / 2, bottom: true }));
  root.add(box(S - lt, curb, curb, M.quartz(), { r: 0.008, x: -S / 2 + lt + (S - lt) / 2, z: S / 2 - curb / 2, bottom: true }));
  root.add(box(curb, curb, S - bt - curb, M.quartz(), { r: 0.008, x: S / 2 - curb / 2, z: -S / 2 + bt + (S - bt - curb) / 2, bottom: true }));
  // square drain
  const dx = -S / 2 + lt + pw / 2, dz = -S / 2 + bt + pd / 2;
  root.add(box(0.1, 0.004, 0.1, M.steel(), { r: 0.001, x: dx, y: pan + 0.001, z: dz }));
  root.add(repeat(6, (i) => box(0.07, 0.004, 0.006, L.shadowGap(), { x: dx, y: pan + 0.0015, z: dz - 0.035 + i * 0.014 })));
  // glass panel on the front curb, clamped to the left wall, in a floor channel
  const gx0 = -S / 2 + lt + 0.004, gw = 0.6, gz = S / 2 - curb / 2;
  root.add(box(gw, 2.0, 0.008, M.glass(), { x: gx0 + gw / 2, y: curb, z: gz, bottom: true }));
  root.add(box(gw, 0.02, 0.02, L.chrome(), { r: 0.002, x: gx0 + gw / 2, y: curb, z: gz, bottom: true }));
  const edgeMat = declare(new THREE.MeshPhysicalMaterial({ color: 0xa8c8bc, roughness: 0.1, transparent: true, opacity: 0.55, depthWrite: false }), { surface: 'glass' });   // the glass panel's edge
  root.add(box(0.009, 2.0, 0.0085, edgeMat, { x: gx0 + gw - 0.0045, y: curb, z: gz, bottom: true }));
  root.add(box(gw, 0.009, 0.0085, edgeMat, { x: gx0 + gw / 2, y: curb + 2.0 - 0.009, z: gz, bottom: true }));
  for (const y of [0.45, 1.75]) root.add(box(0.04, 0.06, 0.03, L.chrome(), { r: 0.005, x: gx0 + 0.016, y, z: gz }));
  // rain shower: wall flange, arm, elbow, Ø0.20 head at 2.10
  const wz = -S / 2 + bt, CH = L.chrome();
  root.add(cyl(0.03, 0.03, 0.012, CH, { x: -0.05, y: 2.22, z: wz + 0.006, rx: PI / 2, seg: 20 }));
  root.add(tube([[-0.05, 2.22, wz], [-0.05, 2.22, wz + 0.2], [-0.05, 2.2, wz + 0.33], [-0.05, 2.14, wz + 0.36]], 0.011, CH, { seg: 24, radial: 10 }));
  root.add(cyl(0.1, 0.1, 0.012, CH, { x: -0.05, y: 2.1, z: wz + 0.36, seg: 40 }));
  root.add(cyl(0.022, 0.03, 0.03, CH, { x: -0.05, y: 2.12, z: wz + 0.36, seg: 20 }));
  root.add(cyl(0.088, 0.088, 0.002, M.blackMatte(), { x: -0.05, y: 2.0935, z: wz + 0.36, seg: 40 }));
  // valve trim and hand shower on the left wall (+X face at x = -S/2 + lt)
  const wx = -S / 2 + lt;
  root.add(cyl(0.085, 0.085, 0.01, CH, { x: wx + 0.005, y: 1.1, z: -0.1, rz: PI / 2, seg: 32 }));
  root.add(cyl(0.025, 0.03, 0.05, CH, { x: wx + 0.035, y: 1.1, z: -0.1, rz: PI / 2, seg: 16 }));
  const vl = box(0.018, 0.09, 0.016, CH, { r: 0.006, x: wx + 0.06, y: 1.13, z: -0.1 }); vl.rotation.x = 0.25; root.add(vl);
  root.add(rod([wx + 0.03, 1.0, 0.12], [wx + 0.03, 1.8, 0.12], 0.011, CH, 16));
  for (const y of [1.0, 1.8]) root.add(box(0.035, 0.03, 0.03, CH, { r: 0.008, x: wx + 0.015, y, z: 0.12 }));
  root.add(box(0.04, 0.04, 0.035, CH, { r: 0.008, x: wx + 0.045, y: 1.6, z: 0.12 }));
  const hs = new THREE.Group(); hs.position.set(wx + 0.07, 1.6, 0.12); hs.rotation.z = -0.25;
  hs.add(cyl(0.014, 0.012, 0.2, CH, { y: -0.08, seg: 16 }));
  hs.add(cyl(0.055, 0.055, 0.025, CH, { y: 0.04, x: 0.012, rz: PI / 2 - 0.25, seg: 28 }));
  root.add(hs);
  root.add(cyl(0.02, 0.02, 0.03, CH, { x: wx + 0.015, y: 0.95, z: -0.1, rz: PI / 2, seg: 16 }));
  root.add(tube([[wx + 0.03, 0.95, -0.1], [wx + 0.09, 0.85, -0.05], [wx + 0.12, 0.8, 0.05], [wx + 0.1, 1.1, 0.13], [wx + 0.08, 1.47, 0.12]], 0.007, L.hose(), { seg: 48, radial: 8 }));
  // a couple of bottles in the niche, or on the window stool
  const [bx, by, bz] = niche ? [nx0 + 0.08, ny0 + 0.012, -S / 2 + 0.05] : [Math.max(win[0], -S / 2 + lt) + 0.08, win[2] + 0.002, -S / 2 + 0.04];
  root.add(lathe([[0, 0], [0.03, 0], [0.032, 0.02], [0.032, 0.15], [0.02, 0.18], [0.012, 0.19], [0.012, 0.21], [0, 0.21]], M.plasticWhite(), { x: bx, y: by, z: bz, seg: 16 }));
  root.add(lathe([[0, 0], [0.025, 0], [0.027, 0.02], [0.027, 0.16], [0.018, 0.18], [0, 0.18]], new THREE.MeshPhysicalMaterial({ color: 0xc9d97a, roughness: 0.3, clearcoat: 0.6 }), { x: bx + 0.1, y: by, z: bz, seg: 16 }));
  describe(root, { id: 'bath-shower', name: 'Walk-in corner shower', zh: '步入式淋浴间', note: 'collider = back wall; userData.colliders lists back + left walls; the shower floor stays walkable' });
  setCollider(root, { w: S, d: bt, x: 0, z: -S / 2 + bt / 2, h: H });
  root.userData.colliders = [{ w: S, d: bt, x: 0, z: -S / 2 + bt / 2, h: H }, { w: lt, d: S - bt, x: -S / 2 + lt / 2, z: bt / 2, h: H }];
  return root;
}

// =====================================================================================================
// Distressed white-painted wooden towel ladder, 0.45 × 1.80, 5 rungs, leaning 8° toward the wall (-Z),
// black screw heads, a folded white terry towel over the third rung (g36 right edge).
function ladderRack() {
  const root = new THREE.Group(), lad = new THREE.Group(), W = 0.45, H = 1.8, tilt = 8 * PI / 180, len = H / Math.cos(tilt) - 0.02;
  const P = L.ladderPaint();
  for (const s of [-1, 1]) lad.add(box(0.035, len, 0.06, P, { r: 0.005, x: s * (W / 2 - 0.0175), bottom: true }));
  const rungY = [0.32, 0.62, 0.92, 1.22, 1.52];
  for (const y of rungY) {
    lad.add(box(W - 0.07, 0.03, 0.03, retile(P, 1, 1, { rot: PI / 2 }), { r: 0.004, y }));
    for (const s of [-1, 1]) lad.add(cyl(0.006, 0.006, 0.003, M.blackMatte(), { x: s * (W / 2 + 0.001), y, rz: PI / 2, seg: 10 }));
  }
  // folded towel hanging over rung 3 (U-shaped extrusion across the rung)
  const ro = 0.032, ri = 0.016, L1 = 0.42, L2 = 0.36, pts = [];
  pts.push([-ro, -L1]);
  for (let i = 0; i <= 12; i++) { const a = PI - (i / 12) * PI; pts.push([Math.cos(a) * ro, Math.sin(a) * ro]); }
  pts.push([ro, -L2], [ri, -L2]);
  for (let i = 0; i <= 12; i++) { const a = (i / 12) * PI; pts.push([Math.cos(a) * ri, Math.sin(a) * ri]); }
  pts.push([-ri, -L1]);
  const towel = extrude(pts, 0.3, L.terry(), { bevel: 0.006, ry: PI / 2, x: -0.15, y: rungY[2] + 0.002 });
  towel.scale.set(1, 1, 1.04); lad.add(towel);
  // woven dobby borders across both hanging legs
  const band = new THREE.MeshPhysicalMaterial({ color: 0xeeeeea, roughness: 0.9, sheen: 0.6, sheenColor: new THREE.Color(0xffffff) });
  for (const [z, y] of [[ro + 0.006, -L1 + 0.07], [-(ro + 0.006), -L2 + 0.07]]) lad.add(box(0.31, 0.035, 0.006, band, { r: 0.0025, y: rungY[2] + y, z }));
  lad.rotation.x = -tilt; lad.position.set(0, 0.005, len * Math.sin(tilt) / 2);
  root.add(lad);
  return autoCollider(describe(root, { id: 'bath-ladderRack', name: 'Towel ladder', zh: '毛巾梯' }), 0.01);
}

export const items = {
  vanity: () => vanity(1.2, 'bath-vanity', 'Wall-hung vanity 1.20', '壁挂浴室柜'),
  vanitySmall: () => vanity(0.9, 'bath-vanitySmall', 'Wall-hung vanity 0.90 (hall bath)', '壁挂浴室柜（小）'),
  vanityDouble: () => vanity(1.5, 'bath-vanityDouble', 'Double wall-hung vanity 1.50', '双盆壁挂浴室柜', 2),
  mirrorCabinet: () => mirrorCabinet(1.2, 3, 'bath-mirrorCabinet', 'Mirrored medicine cabinet 1.20', '镜柜'),
  mirrorCabinetWide: () => mirrorCabinet(1.5, 3, 'bath-mirrorCabinetWide', 'Mirrored medicine cabinet 1.50', '三门镜柜'),
  mirrorCabinetSmall: () => mirrorCabinet(0.9, 2, 'bath-mirrorCabinetSmall', 'Mirrored medicine cabinet 0.90', '镜柜（小）'),
  toilet,
  shower,
  // the east baths' showers: their back walls stand in front of the house windows (bath B 647cb4d0fa, hall bath
  // fde2f2f0ba; sill 0.95, head 2.06), which open through the tile as in g34 and g36. Shower-local x = shower centre y - plan y.
  showerWindowB: () => shower({ win: [1.34 - 1.3609, 1.34 - 0.7605, 0.95, 2.06] }),
  showerWindowHall: () => shower({ win: [-0.77 + 0.1546, -0.77 + 1.0719, 0.95, 2.06] }),
  ladderRack,
  washerDryer,
  waterHeater,
  wireShelving,
  pingPongTable,
  consoleRustic,
  electricalPanel,
};
