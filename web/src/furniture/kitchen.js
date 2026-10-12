// kitchen — 2513 Croton Ave, 2025 remodel (refs/kitchen g12-g18, rednote_69ec158300_*).
// White shaker cabinets (0.07 frame, 0.012 recessed panel) with 0.16 m matte-black bar pulls, 30 mm white quartz,
// matte-black 0.10 m square tile + vertical finger tile behind the range, black appliances, waterfall island with an
// oak V-groove board seating side, rush-seat teak counter stools, oak LED linear pendant.
// Wall runs: BACK at local -Z against the wall, FRONT at +Z. Origins on the floor at the footprint centre.
import { THREE, M, box, cyl, lathe, extrude, tube, sphere, torus, addSeat, setMovable, autoCollider, describe } from '../kit.js';
import { TOP, CT, KICK, DT, UP_D, UP_Y0, UP_Y1, L, wuv, bake, rrect, fronts, tile, quartz, range, hood, dishwasher, barPull, shaker } from './kitchen_parts.js';

const RUN_D = 0.62, BACK = -RUN_D / 2, FACE = BACK + 0.58;   // carcass 0.58 deep, fronts 0.019, quartz to +0.31
const white = () => M.cabinetWhite();

// Base carcass + recessed toe kick between x0..x1.
function baseBox(g, x0, x1, { y1 = TOP - CT, face = FACE } = {}) {
  const w = x1 - x0, cx = (x0 + x1) / 2;
  g.add(box(w, y1 - KICK, face - BACK, white(), { x: cx, y: KICK, z: (BACK + face) / 2, bottom: true }));
  g.add(box(w, KICK, face - BACK - 0.06, white(), { x: cx, y: 0, z: (BACK + face - 0.06) / 2, bottom: true }));
}
// Wall (upper) cabinet x0..x1, y0..y1 with doors.
function upper(g, x0, x1, y0, y1, rows) {
  const face = BACK + UP_D - DT;
  g.add(box(x1 - x0, y1 - y0, face - BACK, white(), { x: (x0 + x1) / 2, y: y0, z: (BACK + face) / 2, bottom: true }));
  fronts(g, x0, x1, y0, y1, face, rows, { base: false });
}

// ------------------------------------------------------------------ south run (front wall, sink + range)
// 2.60 m wall to wall. The listed module widths (0.60 corner + 0.76 range + 0.60 drawers + 0.70 sink + 0.60 DW) add to
// 3.26 m, so the run keeps the 2.60 footprint with the photo proportions: 0.30 corner base, 0.76 range, 0.30 drawer
// stack (5 small drawers, g18), 0.64 sink base, 0.60 dishwasher.
// southRunNarrow: 1.97 m (the fridge takes the east 0.91 of the wall), no dishwasher, 0.27 drawer stack, sink at +X end.
function layout(widths) {   // widths: [[name, w], ...] laid out from -X, centred on x = 0
  const total = widths.reduce((s, [, w]) => s + w, 0), S = { x0: -total / 2, x1: total / 2 }; let x = -total / 2;
  for (const [k, w] of widths) { S[k] = [+x.toFixed(4), +(x + w).toFixed(4)]; x += w; }
  S.sinkX = (S.sink[0] + S.sink[1]) / 2; S.win = [S.sinkX - 0.405, S.sinkX + 0.405];   // window 0.81 w, 0.95-2.06 h
  return S;
}
const SOUTH = layout([['corner', 0.30], ['range', 0.76], ['drawers', 0.30], ['sink', 0.64], ['dw', 0.60]]);
const SOUTH_NARROW = layout([['corner', 0.30], ['range', 0.76], ['drawers', 0.27], ['sink', 0.64]]);
// southRunB (real layout from the Zillow pano): corner 0.45, dishwasher 0.60, sink 0.75, drawer stack 0.20; no range.
const SOUTH_B = layout([['corner', 0.45], ['dw', 0.60], ['sink', 0.75], ['drawers', 0.20]]);

function buildSouthRun(S) {
  const g = new THREE.Group(), SINK_X = S.sinkX, WIN = S.win, end = S.x1;
  // corner base: drawer over a single door
  baseBox(g, ...S.corner);
  fronts(g, ...S.corner, KICK, TOP - CT, FACE, [{ h: 0.15, kind: 'drawer' }, { kind: 'door', hinge: 'l' }]);
  // slide-in range + hood + short cabinet above the hood
  if (S.range) {
    g.add(range((S.range[0] + S.range[1]) / 2, FACE + 0.03, BACK + 0.01));
    g.add(hood((S.range[0] + S.range[1]) / 2, BACK));
    upper(g, ...S.range, 1.90, UP_Y1, [{ kind: 'doors' }]);
  }
  // drawer stack (5 drawers)
  baseBox(g, ...S.drawers);
  fronts(g, ...S.drawers, KICK, TOP - CT, FACE, Array.from({ length: 5 }, () => ({ kind: 'drawer' })));
  // sink base: open-topped carcass so the basin shows through the quartz cut-out; false front + two doors
  const bz = 0.04, hole = { x0: SINK_X - 0.26, x1: SINK_X + 0.26, z0: bz - 0.195, z1: bz + 0.195 };
  {
    const [x0, x1] = S.sink, w = x1 - x0, cx = SINK_X;
    g.add(box(w, 0.66 - KICK, FACE - BACK, white(), { x: cx, y: KICK, z: (BACK + FACE) / 2, bottom: true }));
    g.add(box(w, KICK, FACE - BACK - 0.06, white(), { x: cx, y: 0, z: (BACK + FACE - 0.06) / 2, bottom: true }));
    for (const s of [-1, 1]) g.add(box(0.018, TOP - CT - 0.66, FACE - BACK, white(), { x: cx + s * (w / 2 - 0.009), y: 0.66, z: (BACK + FACE) / 2, bottom: true }));
    g.add(box(w, TOP - CT - 0.66, 0.018, white(), { x: cx, y: 0.66, z: BACK + 0.009, bottom: true }));
    fronts(g, x0, x1, KICK, TOP - CT, FACE, [{ h: 0.16, kind: 'false' }, { kind: 'doors' }]);
    // undermount charcoal composite basin 0.55 × 0.42 × 0.20 (outer), centred under the cut-out (g16/g18)
    const by = TOP - CT - 0.2, bw = 0.55, bd = 0.42, t = 0.01, cm = L.sinkComposite();
    g.add(box(bw, 0.2, t, cm, { x: cx, y: by, z: bz - bd / 2 + t / 2, bottom: true }));
    g.add(box(bw, 0.2, t, cm, { x: cx, y: by, z: bz + bd / 2 - t / 2, bottom: true }));
    for (const s of [-1, 1]) g.add(box(t, 0.2, bd - 2 * t, cm, { x: cx + s * (bw / 2 - t / 2), y: by, z: bz, bottom: true }));
    g.add(box(bw - 2 * t, t, bd - 2 * t, cm, { x: cx, y: by, z: bz, bottom: true }));
    g.add(cyl(0.045, 0.045, 0.004, M.blackSteel(), { seg: 24, x: cx + 0.12, y: by + t, z: bz + 0.06, bottom: true }));
    g.add(cyl(0.03, 0.03, 0.002, L.innerDark(), { seg: 20, x: cx + 0.12, y: by + t + 0.003, z: bz + 0.06, bottom: true }));
    g.add(faucet(cx, BACK + 0.09));
  }
  if (S.dw) g.add(dishwasher((S.dw[0] + S.dw[1]) / 2, FACE + DT, BACK + 0.02));
  // quartz: one slab per stretch not interrupted by the range; the stretch holding the sink gets the cut-out
  const stretches = S.range ? [[S.x0, S.range[0]], [S.range[1], end]] : [[S.x0, end]];
  for (const [a, b] of stretches) if (b - a > 0.01) g.add(quartz(a, b, BACK, -BACK, TOP - CT, SINK_X > a && SINK_X < b ? hole : null));
  // backsplash: finger tile behind the range up to the hood; square tile 0.92-1.50 elsewhere, finger strip under the
  // window sill; the wall above the sink stays clear 0.95-2.06 for the window. Gaps too narrow for an upper cabinet
  // between the window and a cabinet get square tile up to the cabinet line (as left of the window in g18).
  const o = [S.x0, TOP], wl = Math.max(WIN[0], S.x0), wr = Math.min(WIN[1], end);
  const walls = [];   // spans that get square tile + uppers
  for (const [a, b] of stretches) { if (b <= a) continue; if (wr <= a || wl >= b) walls.push([a, b]); else { if (wl > a) walls.push([a, wl]); if (wr < b) walls.push([wr, b]); } }
  if (S.range) g.add(tile(...S.range, TOP, 1.65, BACK, 'fg', [S.range[0], TOP]));
  g.add(tile(wl, wr, TOP, 0.95, BACK, 'fg', [WIN[0], TOP]));
  for (const [a, b] of walls) {
    const w = b - a; if (w < 0.01) continue;
    if (w < 0.25) { g.add(tile(a, b, TOP, UP_Y1, BACK, 'sq', o)); continue; }
    g.add(tile(a, b, TOP, UP_Y0, BACK, 'sq', o));
    const hingeR = Math.abs(b - wl) < 1e-3;   // door opens away from the window
    upper(g, a, b, UP_Y0, UP_Y1, [w >= 0.6 ? { kind: 'doors' } : { kind: 'door', hinge: hingeR ? 'r' : 'l' }]);
  }
  return g;
}
// Tall black gooseneck pull-down faucet with a side lever, 0.30 high.
function faucet(x, z) {
  const g = new THREE.Group(), m = M.blackMatte();
  g.add(cyl(0.028, 0.03, 0.012, m, { seg: 24, y: 0, bottom: true }));
  g.add(cyl(0.017, 0.019, 0.13, m, { seg: 20, y: 0.012, bottom: true }));
  g.add(tube([[0, 0.13, 0], [0, 0.23, 0], [0, 0.285, 0.03], [0, 0.30, 0.09], [0, 0.28, 0.15], [0, 0.235, 0.175]], 0.0125, m, { seg: 40, radial: 14 }));
  g.add(cyl(0.017, 0.016, 0.075, m, { seg: 20, y: 0.17, z: 0.178, bottom: true }));
  g.add(cyl(0.012, 0.012, 0.004, L.innerDark(), { seg: 16, y: 0.168, z: 0.178, bottom: true }));
  g.add(cyl(0.013, 0.013, 0.035, m, { seg: 16, x: 0.03, y: 0.085, rz: Math.PI / 2 }));
  g.add(box(0.008, 0.075, 0.012, m, { r: 0.003, seg: 1, x: 0.05, y: 0.11, rz: -0.25 }));
  g.position.set(x, TOP, z); return g;
}

// ------------------------------------------------------------------ fridge
function buildFridge() {
  const g = new THREE.Group(), W = 0.91, Hh = 1.768, bm = M.blackAppliance(), sb = L.stainlessBlack();
  const back = -0.39 + 0.03, caseFront = 0.27, doorT = 0.055, gap = 0.006;   // 0.03 air gap to the wall behind
  g.add(box(W, Hh - 0.005, caseFront - back, bm, { r: 0.01, seg: 2, x: 0, y: 0, z: (back + caseFront) / 2, bottom: true }));
  // bottom freezer drawer
  const fy0 = 0.045, fy1 = 0.78, dz = caseFront + doorT / 2;
  g.add(box(W - 0.004, fy1 - fy0, doorT, bm, { r: 0.016, seg: 3, y: fy0, z: dz, bottom: true }));
  // French doors
  const dy0 = fy1 + gap, dy1 = Hh, dw = (W - gap) / 2;
  for (const s of [-1, 1]) g.add(box(dw - 0.002, dy1 - dy0, doorT, bm, { r: 0.016, seg: 3, x: s * (dw / 2 + gap / 2), y: dy0, z: dz, bottom: true }));
  // handles: stainless-black bars on stand-offs at the meeting edges, long bar on the freezer
  const hz = caseFront + doorT, hl = 0.72, hy = dy0 + 0.16;
  for (const s of [-1, 1]) {
    const x = s * 0.045;
    g.add(box(0.02, hl, 0.024, sb, { r: 0.008, seg: 2, x, y: hy, z: hz + 0.05, bottom: true }));
    for (const yy of [hy + 0.03, hy + hl - 0.03]) g.add(box(0.016, 0.03, 0.045, sb, { r: 0.004, seg: 1, x, y: yy, z: hz + 0.022 }));
  }
  g.add(box(0.72, 0.022, 0.024, sb, { r: 0.008, seg: 2, y: fy1 - 0.075, z: hz + 0.05 }));
  for (const s of [-1, 1]) g.add(box(0.03, 0.016, 0.045, sb, { r: 0.004, seg: 1, x: s * 0.33, y: fy1 - 0.075, z: hz + 0.022 }));
  // water / ice dispenser on the left door
  const dx = -dw / 2 - gap / 2 - 0.02, dyc = 1.21;
  g.add(box(0.19, 0.33, 0.004, sb, { r: 0.002, seg: 1, x: dx, y: dyc, z: hz + 0.002 }));
  g.add(box(0.165, 0.24, 0.006, L.innerDark(), { x: dx, y: dyc - 0.03, z: hz + 0.004 }));
  g.add(box(0.165, 0.055, 0.006, L.glassBlack(), { x: dx, y: dyc + 0.13, z: hz + 0.005 }));
  g.add(box(0.05, 0.012, 0.004, L.display(), { x: dx, y: dyc + 0.13, z: hz + 0.008 }));
  g.add(box(0.06, 0.09, 0.02, sb, { r: 0.006, seg: 1, x: dx, y: dyc + 0.02, z: hz + 0.012 }));
  g.add(box(0.15, 0.012, 0.05, M.blackSteel(), { r: 0.004, seg: 1, x: dx, y: dyc - 0.155, z: hz + 0.025 }));
  // logo, hinge caps, toe grille
  g.add(cyl(0.018, 0.018, 0.002, sb, { seg: 24, x: dw / 2 + gap / 2 + 0.15, y: dy1 - 0.09, z: hz + 0.001, rx: Math.PI / 2 }));
  for (const s of [-1, 1]) g.add(box(0.06, 0.012, 0.05, M.blackMatte(), { r: 0.003, seg: 1, x: s * (W / 2 - 0.05), y: Hh, z: dz - 0.01, bottom: true }));
  g.add(box(W - 0.04, 0.04, 0.012, L.grille(), { y: 0.0, z: caseFront - 0.01, bottom: true }));
  for (let i = 0; i < 14; i++) g.add(box(0.03, 0.022, 0.004, L.innerDark(), { x: -0.39 + i * 0.06, y: 0.02, z: caseFront - 0.003 }));
  return g;
}

// ------------------------------------------------------------------ west run (side wall: oven / microwave tower)
// westRunB (real layout): finished end panel + 0.76 slide-in range (hood, cabinet above, finger tile), the 0.76 oven
// tower, then base + uppers; 2.52 total, so the end panel's 0.018 comes out of the last base cabinet (0.982).
function buildWestRun({ P = [-0.85, -0.09], B = [-0.09, 0.85], R = null, end = null } = {}) {
  const g = new THREE.Group(), pf = BACK + 0.60, pcx = (P[0] + P[1]) / 2;
  if (R) {
    const rcx = (R[0] + R[1]) / 2;
    g.add(range(rcx, FACE + 0.03, BACK + 0.01));
    g.add(hood(rcx, BACK));
    upper(g, ...R, 1.90, UP_Y1, [{ kind: 'doors' }]);
    g.add(tile(...R, TOP, 1.65, BACK, 'fg', [R[0], TOP]));
  }
  if (end) g.add(box(end[1] - end[0], TOP - 0.006, -2 * BACK, white(), { r: 0.002, seg: 1, x: (end[0] + end[1]) / 2, y: 0, z: 0, bottom: true }));
  // pantry column 0.76 × 0.62 × 2.30
  g.add(box(P[1] - P[0], 2.30 - KICK, pf - BACK, white(), { x: pcx, y: KICK, z: (BACK + pf) / 2, bottom: true }));
  g.add(box(P[1] - P[0], KICK, pf - BACK - 0.06, white(), { x: pcx, y: 0, z: (BACK + pf - 0.06) / 2, bottom: true }));
  fronts(g, ...P, KICK, 0.745, pf, [{ kind: 'drawer' }, { kind: 'drawer' }]);
  g.add(box(P[1] - P[0] - 0.004, 2.30 - 0.745, DT, white(), { r: 0.002, seg: 1, x: pcx, y: 0.745, z: pf + DT / 2, bottom: true }));
  const az = pf + DT, bm = M.blackAppliance();
  // wall oven 0.60 w, 0.75-1.35
  g.add(box(0.6, 0.6, 0.026, bm, { r: 0.004, seg: 1, x: pcx, y: 0.75, z: az + 0.013, bottom: true }));
  g.add(box(0.58, 0.072, 0.004, L.glassBlack(), { x: pcx, y: 1.272, z: az + 0.028, bottom: true }));
  g.add(box(0.32, 0.026, 0.002, L.keypad(), { x: pcx, y: 1.295, z: az + 0.031, bottom: true }));
  g.add(box(0.58, 0.46, 0.004, L.glassBlack(), { x: pcx, y: 0.765, z: az + 0.028, bottom: true }));
  g.add(box(0.42, 0.25, 0.002, L.innerDark(), { x: pcx, y: 0.84, z: az + 0.031, bottom: true }));
  g.add(cyl(0.009, 0.009, 0.5, L.stainlessBlack(), { seg: 16, x: pcx, y: 1.205, z: az + 0.07, rz: Math.PI / 2 }));
  for (const s of [-1, 1]) g.add(cyl(0.007, 0.007, 0.045, L.stainlessBlack(), { seg: 12, x: pcx + s * 0.22, y: 1.205, z: az + 0.048, rx: Math.PI / 2 }));
  // microwave 1.40-1.80: black glass door, brand strip on top, keypad at the bottom of the glass
  g.add(box(0.6, 0.4, 0.026, bm, { r: 0.004, seg: 1, x: pcx, y: 1.40, z: az + 0.013, bottom: true }));
  g.add(box(0.594, 0.05, 0.004, L.stainlessBlack(), { x: pcx, y: 1.745, z: az + 0.028, bottom: true }));
  g.add(box(0.594, 0.335, 0.004, L.glassBlack(), { x: pcx, y: 1.405, z: az + 0.028, bottom: true }));
  g.add(box(0.44, 0.22, 0.002, L.innerDark(), { x: pcx, y: 1.50, z: az + 0.031, bottom: true }));
  g.add(box(0.4, 0.05, 0.002, L.keypad(), { x: pcx, y: 1.42, z: az + 0.031, bottom: true }));
  // the owner's chalkboard above the microwave (0.70 × 0.35)
  g.add(box(0.70, 0.35, 0.012, M.chalkboard(), { r: 0.002, seg: 1, x: pcx, y: 1.86, z: az + 0.006, bottom: true }));
  // base cabinet with drawers over doors, quartz, tile, uppers
  baseBox(g, ...B);
  const mid = (B[0] + B[1]) / 2;
  fronts(g, B[0], mid, KICK, TOP - CT, FACE, [{ h: 0.16, kind: 'drawer' }, { kind: 'door', hinge: 'l' }]);
  fronts(g, mid, B[1], KICK, TOP - CT, FACE, [{ h: 0.16, kind: 'drawer' }, { kind: 'door', hinge: 'r' }]);
  g.add(quartz(...B, BACK, -BACK));
  g.add(tile(...B, TOP, UP_Y0, BACK, 'sq', [B[0], TOP]));
  upper(g, ...B, UP_Y0, UP_Y1, [{ kind: 'doors' }]);
  return g;
}

// ------------------------------------------------------------------ island
const ISL = { w: 3.2, d: 1.0, kick: 0.08, setback: 0.30 };
function buildIsland() {
  const g = new THREE.Group(), q = M.quartz(), inner = ISL.w / 2 - CT, zb = -ISL.d / 2 + 0.02, zs = ISL.d / 2 - ISL.setback;
  g.add(quartz(-ISL.w / 2, ISL.w / 2, -ISL.d / 2, ISL.d / 2, TOP - CT));
  for (const s of [-1, 1]) g.add(box(CT, TOP - CT, ISL.d, q, { r: 0.002, seg: 1, x: s * (ISL.w / 2 - CT / 2), y: 0, bottom: true }));
  // cabinet body between the waterfalls: drawer side faces -Z
  const backZ = zs - 0.03;
  g.add(box(2 * inner, TOP - CT - ISL.kick, backZ - zb, white(), { y: ISL.kick, z: (zb + backZ) / 2, bottom: true }));
  g.add(box(2 * inner, ISL.kick, backZ - zb - 0.06, white(), { y: 0, z: (zb + 0.06 + backZ) / 2, bottom: true }));
  const fr = new THREE.Group(), bay = (2 * inner) / 4;
  for (let i = 0; i < 4; i++) fronts(fr, -inner + i * bay, -inner + (i + 1) * bay, ISL.kick, TOP - CT, -zb, [{ h: 0.2, kind: 'drawer' }, { kind: 'drawer' }, { kind: 'drawer' }]);
  fr.rotation.y = Math.PI; g.add(fr);
  // seating side: dark backing, wide V-grooved oak boards (0.12-0.15 w, as in g14/g15), oak plinth at the floor
  g.add(box(2 * inner, TOP - CT - 0.06, 0.012, L.slatBack(), { y: 0.06, z: backZ + 0.006, bottom: true }));
  const sh = TOP - CT - 0.065, seq = [0.14, 0.12, 0.15, 0.13, 0.145, 0.125, 0.135], widths = [];
  for (let i = 0, sum = 0; sum < 2 * inner - 0.001; i++) { let w = seq[i % seq.length]; if (2 * inner - sum - w < 0.1) w = 2 * inner - sum; widths.push(w); sum += w; }
  let bx = -inner;
  widths.forEach((w, i) => {
    const m = box(w - 0.005, sh, 0.019, M.oak(), { r: 0.005, seg: 1, x: bx + w / 2, y: 0.06 + sh / 2, z: backZ + 0.012 + 0.0095 });
    g.add(wuv(m, 1, 'y', [bx + w / 2 + i * 0.41, 0.06 + sh / 2 + i * 0.29, 0])); bx += w;
  });
  g.add(wuv(box(2 * inner, 0.062, 0.05, M.oak(), { r: 0.004, seg: 1, y: 0, z: zs + 0.01, bottom: true }), 1, 'x'));
  return g;
}

// ------------------------------------------------------------------ counter stool (teak frame, rush seat + back)
function strut(p0, p1, r0, r1, mat, seg = 14) {
  const a = new THREE.Vector3(...p0), b = new THREE.Vector3(...p1), d = b.clone().sub(a), len = d.length();
  const m = cyl(r1, r0, len, mat, { seg }); m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); return m;
}
function buildStool() {
  const g = new THREE.Group(), tk = L.teak(), SY = 0.66;
  const FL = (s) => [[s * 0.215, 0.003, 0.198], [s * 0.2, SY - 0.03, 0.185]];          // front legs, slight splay
  const RL = (s) => [[s * 0.215, 0.003, -0.2], [s * 0.205, 0.94, -0.222]];          // rear legs run up into the back posts
  const lerp = ([p, q], y) => { const t = (y - p[1]) / (q[1] - p[1]); return [p[0] + (q[0] - p[0]) * t, y, p[2] + (q[2] - p[2]) * t]; };
  for (const s of [-1, 1]) {
    g.add(strut(...FL(s), 0.017, 0.02, tk)); g.add(strut(...RL(s), 0.017, 0.02, tk));
    g.add(sphere(0.02, tk, { seg: 14, x: RL(s)[1][0], y: 0.94, z: RL(s)[1][2], sy: 0.5 }));
    // side stretchers
    g.add(strut(lerp(FL(s), 0.34), lerp(RL(s), 0.34), 0.011, 0.011, tk, 10));
  }
  // front foot rest and back stretcher
  g.add(strut(lerp(FL(-1), 0.25), lerp(FL(1), 0.25), 0.012, 0.012, tk, 10));
  g.add(strut(lerp(RL(-1), 0.25), lerp(RL(1), 0.25), 0.011, 0.011, tk, 10));
  // seat rails (rounded) and rush seat slab
  const ry = SY - 0.045;
  g.add(box(0.40, 0.034, 0.03, tk, { r: 0.012, seg: 2, y: ry, z: 0.185 }));
  g.add(box(0.40, 0.034, 0.03, tk, { r: 0.012, seg: 2, y: ry, z: -0.205 }));
  for (const s of [-1, 1]) g.add(box(0.03, 0.034, 0.40, tk, { r: 0.012, seg: 2, x: s * 0.205, y: ry, z: -0.01 }));
  g.add(box(0.44, 0.04, 0.43, L.rushSeat(), { r: 0.017, seg: 3, y: SY - 0.04, z: -0.01, bottom: true }));
  // curved back: rush band between two curved rails, concave toward the sitter
  const R = 1.08, zc = -0.232 + R, th = Math.asin(0.205 / R), N = 16, arc = (rr, y) => Array.from({ length: N + 1 }, (_, i) => { const a = -th + (2 * th * i) / N; return [Math.sin(a) * rr, y, zc - Math.cos(a) * rr]; });
  const out = [];
  for (let i = 0; i <= N; i++) { const a = -th + (2 * th * i) / N; out.push([Math.sin(a) * R, -(zc - Math.cos(a) * R)]); }
  for (let i = N; i >= 0; i--) { const a = -th + (2 * th * i) / N; out.push([Math.sin(a) * (R + 0.022), -(zc - Math.cos(a) * (R + 0.022))]); }
  const band = extrude(out, 0.165, L.rushBack(), { rx: -Math.PI / 2, y: 0.735 });
  { const p = band.geometry.attributes.position, uv = band.geometry.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + 0.205) / 0.41, p.getZ(i) / 0.165); uv.needsUpdate = true; }
  g.add(band);
  g.add(tube(arc(R + 0.011, 0.912), 0.013, tk, { seg: 24, radial: 10 }));
  g.add(tube(arc(R + 0.011, 0.732), 0.010, tk, { seg: 24, radial: 10 }));
  return g;
}

// ------------------------------------------------------------------ pendant
function buildPendant() {
  const g = new THREE.Group(), oak = M.oak(), Lb = 1.5, y0 = 1.95;
  g.add(wuv(box(Lb, 0.06, 0.08, oak, { r: 0.003, seg: 1, y: y0, bottom: true }), 1, 'x'));
  g.add(box(Lb - 0.04, 0.003, 0.032, L.led(), { y: y0 - 0.0015 }));
  // oak ceiling rail (as in g14/g15) with thin steel cables and black cable grips
  const cx = 0.57;
  g.add(wuv(box(1.2, 0.025, 0.04, oak, { r: 0.003, seg: 1, y: 2.44 - 0.025, bottom: true }), 1, 'x'));
  for (const s of [-1, 1]) {
    g.add(cyl(0.0012, 0.0012, 2.415 - (y0 + 0.06), M.steel(), { seg: 6, x: s * cx, y: y0 + 0.06, bottom: true }));
    g.add(cyl(0.0045, 0.0045, 0.02, M.blackSteel(), { seg: 10, x: s * cx, y: 2.395, bottom: true }));
    g.add(cyl(0.0045, 0.0045, 0.016, M.blackSteel(), { seg: 10, x: s * cx, y: y0 + 0.06, bottom: true }));
  }
  return g;
}

// ------------------------------------------------------------------ counter decor (stands on y=0; place on the island top)
function buildDecor() {
  const g = new THREE.Group(), r = mulberry(4);
  // tall speckled stoneware bottle vase with dried grasses + plumes
  const vx = -0.32;
  g.add(lathe([[0, 0], [0.078, 0], [0.087, 0.015], [0.09, 0.1], [0.096, 0.24], [0.092, 0.3], [0.074, 0.355], [0.048, 0.4], [0.032, 0.43], [0.028, 0.465], [0.031, 0.47], [0.022, 0.472]], L.stoneware(), { seg: 28, x: vx }));
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + r() * 0.5, lean = 0.05 + r() * 0.16, top = 0.85 + r() * 0.35;
    const pts = [[vx, 0.40, 0], [vx + Math.cos(a) * lean * 0.3, 0.6, Math.sin(a) * lean * 0.3], [vx + Math.cos(a) * lean, top, Math.sin(a) * lean]];
    g.add(tube(pts, 0.0022, L.stem(), { seg: 12, radial: 5 }));
    if (i % 3 === 0) g.add(sphere(0.014, L.plume(), { seg: 10, x: pts[2][0], y: top + 0.05, z: pts[2][2], sy: 5 }));
  }
  // wooden tray with rim
  const tx = 0.06;
  g.add(extrude(rrect(0.40, 0.16, 0.03), 0.008, M.acacia(), { rx: -Math.PI / 2, x: tx, y: 0.002, bevel: 0.002 }));
  g.add(extrude(rrect(0.40, 0.16, 0.03), 0.012, M.acacia(), { rx: -Math.PI / 2, x: tx, y: 0.008, holes: [rrect(0.37, 0.13, 0.02).reverse()] }));
  // two glass bottles (oil + vinegar) on the tray
  for (const [bx, h, rr, liquid] of [[tx - 0.08, 0.27, 0.034, true], [tx + 0.03, 0.21, 0.03, false]]) {
    g.add(lathe([[0, 0], [rr, 0], [rr, h * 0.62], [rr * 0.45, h * 0.8], [rr * 0.33, h * 0.95], [rr * 0.36, h]], L.bottleGlass(), { seg: 24, x: bx, y: 0.012 }));
    if (liquid) g.add(lathe([[0, 0], [rr - 0.003, 0], [rr - 0.003, h * 0.5], [0, h * 0.5]], L.oil(), { seg: 20, x: bx, y: 0.014 }));
    g.add(cyl(rr * 0.33, rr * 0.3, 0.025, L.cork(), { seg: 12, x: bx, y: 0.012 + h - 0.005, bottom: true }));
  }
  // matte-black kettle with oak handle
  const kx = 0.4, km = M.blackMatte(), kh = new THREE.Group();
  kh.add(lathe([[0, 0], [0.085, 0], [0.095, 0.03], [0.092, 0.11], [0.07, 0.165], [0.045, 0.18], [0, 0.18]], km, { seg: 28 }));
  kh.add(cyl(0.012, 0.016, 0.02, M.oak(), { seg: 12, y: 0.18, bottom: true }));
  kh.add(tube([[0.075, 0.05, 0], [0.12, 0.09, 0], [0.155, 0.15, 0], [0.17, 0.17, 0]], 0.011, km, { seg: 16, radial: 10 }));
  kh.add(tube([[-0.06, 0.15, 0], [-0.05, 0.25, 0], [0.04, 0.26, 0], [0.05, 0.17, 0]], 0.009, km, { seg: 20, radial: 8 }));
  kh.add(cyl(0.013, 0.013, 0.07, M.oak(), { seg: 12, x: -0.005, y: 0.258, rz: Math.PI / 2 }));
  kh.position.set(kx, 0, 0); kh.rotation.y = -0.5; g.add(kh);
  return g;
}
function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ------------------------------------------------------------------ exports
const done = (g, meta, collide = true) => { bake(g); describe(g, meta); if (collide) autoCollider(g); return g; };
export const items = {
  southRun: () => done(buildSouthRun(SOUTH), { id: 'kitchen-south-run', name: 'Sink & range run', zh: '水槽灶台橱柜' }),
  southRunB: () => { const g = done(buildSouthRun(SOUTH_B), { id: 'kitchen-south-run-b', name: 'Sink run (real layout)', zh: '水槽橱柜（实景布局）', note: `sink centre local x = ${SOUTH_B.sinkX.toFixed(3)}` }); g.userData.sinkX = SOUTH_B.sinkX; g.userData.window = { x0: SOUTH_B.win[0], x1: SOUTH_B.win[1], y0: 0.95, y1: 2.06 }; return g; },
  southRunNarrow: () => { const g = done(buildSouthRun(SOUTH_NARROW), { id: 'kitchen-south-run-narrow', name: 'Sink & range run (1.97 m)', zh: '水槽灶台橱柜（窄）', note: `sink centre local x = ${SOUTH_NARROW.sinkX.toFixed(3)}` }); g.userData.sinkX = SOUTH_NARROW.sinkX; g.userData.window = { x0: SOUTH_NARROW.win[0], x1: SOUTH_NARROW.win[1], y0: 0.95, y1: 2.06 }; return g; },
  fridge: () => done(buildFridge(), { id: 'kitchen-fridge', name: 'French-door refrigerator', zh: '法式对开门冰箱' }),
  westRunB: () => done(buildWestRun({ end: [-1.26, -1.242], R: [-1.242, -0.482], P: [-0.482, 0.278], B: [0.278, 1.26] }), { id: 'kitchen-west-run-b', name: 'Range, oven tower & counter', zh: '灶台烤箱高柜与台面' }),
  westRun: () => done(buildWestRun(), { id: 'kitchen-west-run', name: 'Oven tower & counter', zh: '烤箱高柜与台面' }),
  island: () => done(buildIsland(), { id: 'kitchen-island', name: 'Waterfall island', zh: '瀑布岛台' }),
  stool: () => { const g = buildStool(); bake(g); describe(g, { id: 'kitchen-stool', name: 'Rush counter stool', zh: '藤编吧凳' }); setMovable(g, { mass: 6, radius: 0.26 }); addSeat(g, { y: 0.66, facing: 0, kind: 'stool', back: 0.9 }); return autoCollider(g); },
  pendant: () => { const g = done(buildPendant(), { id: 'kitchen-pendant', name: 'Oak LED linear pendant', zh: '橡木线形吊灯' }, false); g.userData.light = { type: 'rect', w: 1.4, h: 0.06, y: 1.94, intensity: 6, color: 0xfff1dc }; return g; },
  counterDecor: () => { const g = done(buildDecor(), { id: 'kitchen-counter-decor', name: 'Island decor', zh: '岛台摆件', note: 'stands on y=0; place on the island top (y=0.92)' }, false); g.userData.placeOn = { surface: 'island', y: TOP }; return g; },
};
