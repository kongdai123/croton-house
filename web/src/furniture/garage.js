// garage — garage / laundry pieces for 2513 Croton Ave. Refs: source/zillow/gallery g49 (laundry nook, sink, black shelving,
// leaning shutter, ping-pong table), g48 (wall rail, jug of dried flowers, concrete plinth under the washer), g04 (door open).
// Units metres; origin on the floor at the footprint centre; +Z = front. Materials and small sub-assemblies: garage_parts.js.
import { THREE, M, cyl, lathe, extrude, tube, plane, at, autoCollider, describe, sphere, torus, group } from '../kit.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { animatedToggle, ss } from './outdoor_parts.js';
import { addAABB, getColliders } from '../house.js';
import { declare } from '../lighting_roles.js';
import { G, PI, box, bake, rod, merged, retile, rng, rrect, sweepX, slotted, perforated, bat, batCase, can, bandsPile, crate, ballHeap, gypsophila } from './garage_parts.js';

// ribbed PVC slip nut around a vertical pipe
function slipNut(r, h, mat, opts = {}) {
  const p = [[r * 0.8, 0]]; const n = 5;
  for (let i = 0; i <= n; i++) { const y = (i / n) * h; p.push([r * (i % 2 ? 1.0 : 0.94), y]); }
  p.push([r * 0.8, h]);
  return lathe(p, mat, { seg: 24, ...opts });
}

// =====================================================================================================
// Freestanding black utility sink (g49): 0.56 × 0.50 square steel tub with a rolled rim and a rear faucet ledge, top at 0.88,
// four square legs with a slatted lower shelf, chrome two-handle gooseneck faucet, white PVC tailpiece + J-trap to the wall.
function utilitySink() {
  const root = new THREE.Group(), K = G.sink(), S = G.steel(), W = 0.56, D = 0.5, yT = 0.88, yB = 0.59, t = 0.012, ledge = 0.08, b = 0.002;
  const bz0 = -D / 2 + ledge, bz1 = D / 2 - t, zc = (bz0 + bz1) / 2;
  // tub walls + rear ledge: one rounded-rect ring extruded upward (shape y = -z)
  const hole = rrect(-W / 2 + t, -bz1, W / 2 - t, -bz0, 0.008).reverse();
  root.add(extrude(rrect(-W / 2 + b, -D / 2 + b, W / 2 - b, D / 2 - b, 0.01), yT - yB - 2 * b, K, { bevel: b, rx: -PI / 2, y: yB + b, holes: [hole] }));
  // rolled rim round the outside of the top edge
  const rim = rrect(-W / 2 - 0.0005, -D / 2 - 0.0005, W / 2 + 0.0005, D / 2 + 0.0005, 0.012, 6, 8).map(([x, y]) => [x, yT - 0.0055, -y]);
  root.add(tube(rim, 0.0062, K, { seg: 160, radial: 7, closed: true }));
  // basin floor, chrome strainer
  const yF = yB + 0.016;
  root.add(box(W - 2 * t, 0.012, bz1 - bz0, K, { y: yB + 0.004, z: zc, bottom: true }));
  root.add(torus(0.031, 0.0035, G.chrome(), { x: 0, y: yF + 0.001, z: zc, rx: PI / 2, seg: 28, tube: 8 }));
  root.add(cyl(0.029, 0.029, 0.002, M.blackMatte(), { y: yF + 0.0005, z: zc, seg: 28 }));
  for (const a of [0, PI / 2]) root.add(box(0.056, 0.002, 0.005, G.chrome(), { y: yF + 0.0015, z: zc, ry: a }));
  // legs (outer faces flush with the tub), glides, slatted lower shelf
  const lw = 0.032, ys = 0.11;
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    root.add(box(lw, yB - 0.008, lw, S, { r: 0.003, x: sx * (W / 2 - lw / 2), y: 0.008, z: sz * (D / 2 - lw / 2), bottom: true }));
    root.add(cyl(0.012, 0.014, 0.008, G.rubber(), { x: sx * (W / 2 - lw / 2), z: sz * (D / 2 - lw / 2), bottom: true, seg: 12 }));
    root.add(box(lw - 0.004, 0.003, lw - 0.004, S, { x: sx * (W / 2 - lw / 2), y: yB - 0.002, z: sz * (D / 2 - lw / 2) }));
  }
  for (const s of [-1, 1]) root.add(box(0.02, 0.025, D - 2 * lw, S, { r: 0.002, x: s * (W / 2 - lw / 2), y: ys, bottom: true }));
  for (const s of [-1, 1]) root.add(box(W - 2 * lw, 0.025, 0.02, S, { r: 0.002, y: ys, z: s * (D / 2 - lw / 2), bottom: true }));
  const nS = 7, span = D - 2 * lw - 0.012, pitch = span / nS, slats = [];
  for (let i = 0; i < nS; i++) slats.push(box(W - 2 * lw + 0.012, 0.01, pitch * 0.64, S, { r: 0.003, y: ys + 0.02, z: -span / 2 + pitch * (i + 0.5), bottom: true }));
  root.add(merged(slats, S));
  // top frame under the tub
  for (const s of [-1, 1]) root.add(box(W - 2 * lw, 0.022, 0.018, S, { r: 0.002, y: yB - 0.024, z: s * (D / 2 - lw / 2), bottom: true }));
  // faucet: deck plate on the rear ledge, two lever valves on 4" centres, tall gooseneck spout
  const CH = G.chrome(), F = new THREE.Group(); F.position.set(0, yT, -D / 2 + ledge / 2 + 0.002);
  F.add(box(0.17, 0.012, 0.048, CH, { r: 0.0055, bottom: true }));
  for (const s of [-1, 1]) {
    F.add(cyl(0.015, 0.018, 0.032, CH, { x: s * 0.0508, y: 0.012, bottom: true, seg: 20 }));
    F.add(sphere(0.015, CH, { x: s * 0.0508, y: 0.046, seg: 16, sy: 0.6 }));
    const lv = box(0.058, 0.009, 0.014, CH, { r: 0.0042, x: s * (0.0508 + 0.026), y: 0.052, z: 0.01 }); lv.rotation.set(0, s * 0.45, s * 0.12); F.add(lv);
    F.add(cyl(0.0055, 0.0055, 0.002, s < 0 ? G.releaseRed() : G.band(), { x: s * 0.0508, y: 0.055, seg: 12 }));
  }
  F.add(cyl(0.0165, 0.018, 0.05, CH, { y: 0.012, bottom: true, seg: 20 }));
  F.add(tube([[0, 0.055, 0], [0, 0.17, 0], [0, 0.265, 0.02], [0, 0.305, 0.08], [0, 0.29, 0.15], [0, 0.24, 0.2], [0, 0.2, 0.208]], 0.0105, CH, { seg: 56, radial: 14 }));
  F.add(cyl(0.0122, 0.0118, 0.024, CH, { y: 0.19, z: 0.208, seg: 16 }));
  F.add(cyl(0.0095, 0.0095, 0.002, G.rubber(), { y: 0.1775, z: 0.208, seg: 12 }));
  root.add(F);
  // drain: PVC locknut, tailpiece, J-bend, trap arm into the wall
  const P = G.pvc();
  root.add(slipNut(0.03, 0.022, P, { y: yB - 0.022, z: zc }));
  root.add(cyl(0.0195, 0.0195, yB - 0.022 - 0.455, P, { y: 0.455, z: zc, bottom: true, seg: 20 }));
  root.add(slipNut(0.027, 0.026, P, { y: 0.455, z: zc }));
  root.add(tube([[0, 0.47, zc], [0, 0.41, zc], [0.008, 0.372, zc], [0.045, 0.352, zc], [0.082, 0.372, zc], [0.09, 0.41, zc], [0.09, 0.445, zc]], 0.0195, P, { seg: 40, radial: 16 }));
  root.add(slipNut(0.027, 0.026, P, { x: 0.09, y: 0.432, z: zc }));
  root.add(tube([[0.09, 0.45, zc], [0.09, 0.468, zc - 0.012], [0.09, 0.476, zc - 0.05], [0.09, 0.481, -0.15], [0.09, 0.485, -D / 2 + 0.006]], 0.0195, P, { seg: 40, radial: 16 }));
  const armNut = slipNut(0.027, 0.024, P); armNut.position.set(0.09, 0.478, zc - 0.05); armNut.rotation.x = -PI / 2; root.add(armNut);
  root.add(cyl(0.036, 0.036, 0.006, P, { x: 0.09, y: 0.485, z: -D / 2 + 0.003, rx: PI / 2, seg: 24 }));
  return autoCollider(describe(bake(root), { id: 'garage-utilitySink', name: 'Black freestanding utility sink', zh: '黑色落地洗衣水槽' }));
}

// =====================================================================================================
// Black boltless steel shelving 1.22 × 0.46 × 1.85 (g49): slotted angle posts, Z-beams riveted into the keyholes, solid steel
// decks at 0.10 / 0.55 / 0.98 / 1.42 / 1.85 (four tiers show above the ping-pong table in g49; the floor tier is hidden there).
// Dressed as photographed: bats + case + towel up top, four black cans and blue bands in the middle, two open pine crates.
function metalShelving() {
  const root = new THREE.Group(), W = 1.22, D = 0.46, H = 1.85, a = 0.038, th = 0.002, S = G.steel(), DK = G.deck();
  const Pm = slotted((H - 0.006) / 0.0381);
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const x = sx * W / 2, z = sz * D / 2;
    root.add(box(a, H - 0.006, th, Pm, { x: x - sx * a / 2, y: 0.006, z: z - sz * th / 2, bottom: true }));
    root.add(box(th, H - 0.006, a, Pm, { x: x - sx * th / 2, y: 0.006, z: z - sz * a / 2, bottom: true }));
    root.add(box(a + 0.004, 0.006, a + 0.004, S, { r: 0.0015, x: x - sx * (a + 0.004) / 2, z: z - sz * (a + 0.004) / 2, bottom: true }));
  }
  const levels = [0.1, 0.55, 0.98, 1.42, 1.846], parts = [], decks = [];
  for (const y of levels) {
    for (const sz of [-1, 1]) parts.push(box(W - 2 * th - 0.002, 0.038, 0.014, S, { r: 0.0015, y: y - 0.034, z: sz * (D / 2 - th - 0.007), bottom: true }));
    for (const sx of [-1, 1]) parts.push(box(0.014, 0.03, D - 2 * th - 0.03, S, { r: 0.0015, x: sx * (W / 2 - th - 0.007), y: y - 0.028, bottom: true }));
    for (const x of [-0.3, 0.3]) parts.push(box(0.03, 0.012, D - 0.05, S, { x, y: y - 0.02, bottom: true }));
    decks.push(box(W - 2 * th - 0.028, 0.008, D - 2 * th - 0.028, DK, { r: 0.002, y: y - 0.008, bottom: true }));
    // rivet heads showing in the keyholes
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) for (const dy of [-0.01, -0.026]) {
      parts.push(cyl(0.0042, 0.0042, 0.003, S, { x: sx * (W / 2 - a / 2), y: y + dy, z: sz * (D / 2 + 0.0005), rx: PI / 2, seg: 6 }));
      parts.push(cyl(0.0042, 0.0042, 0.003, S, { x: sx * (W / 2 + 0.0005), y: y + dy, z: sz * (D / 2 - a / 2), rz: PI / 2, seg: 6 }));
    }
  }
  root.add(merged(parts, S), merged(decks, DK));
  // ---- dressing ----
  const L3 = levels[3], L2 = levels[2], L1 = levels[1];
  root.add(at(batCase(), -0.2, L3, 0.0, PI / 2 + 0.06));
  root.add(at(bat(true), 0.15, L3, 0.02, PI / 2 + 0.05));
  root.add(at(bat(false), 0.42, L3, -0.04, PI / 2 - 0.18));
  root.add(box(0.17, 0.034, 0.2, G.towel(), { r: 0.012, seg: 3, x: -0.48, y: L3, z: 0.04, bottom: true }));
  root.add(box(0.168, 0.004, 0.19, G.towel(), { r: 0.002, x: -0.48, y: L3 + 0.017, z: 0.045 }));
  for (const [x, z] of [[-0.5, 0.02], [-0.395, 0.0], [-0.318, 0.01], [-0.241, 0.0]]) { const c = can(); c.position.set(x, L2, z); c.rotation.y = x * 7; root.add(c); }
  root.add(at(bandsPile(), -0.06, L2, 0.03));
  const cA = crate(); root.add(at(cA, 0.42, L2, -0.02));
  for (const [x, z, ry] of [[0.38, 0.05, 0.5], [0.43, 0.08, 0.2], [0.46, 0.03, 0.75]]) {
    const st = cyl(0.0065, 0.0065, 0.15, M.plasticWhite(), { seg: 10, x, y: L2 + 0.013 + 0.0065, z }); st.rotation.set(PI / 2, ry, 0, 'YXZ'); root.add(st);
  }
  const cB = crate(); root.add(at(cB, 0.37, L1, -0.02));
  const balls = ballHeap(0.31 - 0.03, 0.3 - 0.02); root.add(at(balls, 0.37, L1 + 0.013, -0.02));
  return autoCollider(describe(bake(root), { id: 'garage-metalShelving', name: 'Black steel shelving with sports gear', zh: '黑色钢制置物架（运动器材）' }));
}

// =====================================================================================================
// Reclaimed wood wall rail 0.65 × 0.04 × 0.02 at 1.62 with three copper screw heads (g48). Wall item: back at z = 0.
function wallRail() {
  const root = new THREE.Group(), Lr = 0.65, h = 0.04, d = 0.02, y = 1.62, r = rng(8);
  root.add(box(Lr, h, d, G.railWood(), { r: 0.003, y, z: d / 2 }));
  for (const x of [-0.278, 0.006, 0.29]) {
    const s = lathe([[0, 0], [0.0058, 0], [0.0057, 0.0007], [0.0047, 0.0017], [0.0027, 0.0024], [0, 0.0026]], G.copper(), { seg: 16, x, y, z: d - 0.0003 });
    s.rotation.x = PI / 2; root.add(s);
    const a = r() * PI;
    for (const k of [0, PI / 2]) root.add(box(0.0072, 0.0011, 0.0012, M.blackMatte(), { x, y, z: d + 0.002, rz: a + k }));
  }
  return describe(root, { id: 'garage-wallRail', name: 'Reclaimed wood wall rail', zh: '旧木挂条' });
}

// =====================================================================================================
// Tall slim whitewashed louvered shutter 0.32 × 1.75 leaning on the wall at 8° (g49 left edge — the photo shows louvers,
// not glass). Back top edge touches z = 0; the back bottom edge rests on the floor 0.24 out from the wall.
function leaningFrame() {
  const root = new THREE.Group(), fr = new THREE.Group(), W = 0.32, Hh = 1.75, T = 0.028, tilt = 8 * PI / 180;
  const Ls = (Hh - T * Math.sin(tilt)) / Math.cos(tilt), sw = 0.048, rt = 0.075, rb = 0.095;
  const F = G.washFrame(), FH = retile(F, 1, 1, { rot: PI / 2 }), LV = G.washLouver();
  for (const s of [-1, 1]) fr.add(box(sw, Ls, T, F, { r: 0.004, x: s * (W / 2 - sw / 2), z: T / 2, bottom: true }));
  fr.add(box(W - 2 * sw + 0.004, rb, T * 0.9, FH, { r: 0.003, y: 0.002, z: T / 2, bottom: true }));
  fr.add(box(W - 2 * sw + 0.004, rt, T * 0.9, FH, { r: 0.003, y: Ls - rt - 0.002, z: T / 2, bottom: true }));
  const y0 = rb + 0.01, y1 = Ls - rt - 0.01, n = Math.round((y1 - y0) / 0.031), lv = [];
  for (let i = 0; i < n; i++) { const m = box(W - 2 * sw + 0.006, 0.0065, 0.035, LV, { r: 0.0025, y: y0 + (i + 0.5) * (y1 - y0) / n, z: T / 2 }); m.rotation.x = 0.78; lv.push(m); }
  fr.add(merged(lv, LV));
  // a dark cavity behind the slats so the gaps read as depth
  fr.add(box(W - 2 * sw, y1 - y0, 0.002, G.rubber(), { y: y0, z: 0.003, bottom: true }));
  // old painted-over butt hinges on one stile (it is a salvaged shutter)
  for (const yy of [0.25, Ls - 0.25]) fr.add(box(0.003, 0.05, 0.018, G.castAlu(), { x: W / 2 + 0.0005, y: yy, z: T / 2 }));
  fr.rotation.x = -tilt; fr.position.z = Ls * Math.sin(tilt);
  root.add(fr);
  return autoCollider(describe(root, { id: 'garage-leaningFrame', name: 'Leaning whitewashed louvered shutter', zh: '倚墙白洗木百叶框' }), 0.01);
}

// =====================================================================================================
// White matte ceramic jug vase 0.26 h, Ø0.23 belly, two loop handles, with a loose spray of dried white/pink gypsophila (g48).
// Origin at the vase base so it can sit on the console top.
function dryFlowersVase() {
  const root = new THREE.Group(), C = G.ceramic();
  root.add(lathe([[0, 0.003], [0.06, 0], [0.074, 0.004], [0.089, 0.017], [0.103, 0.041], [0.112, 0.071], [0.115, 0.1], [0.113, 0.13], [0.105, 0.158],
    [0.09, 0.182], [0.07, 0.198], [0.056, 0.208], [0.05, 0.219], [0.049, 0.245], [0.053, 0.255], [0.052, 0.26], [0.045, 0.26], [0.043, 0.25], [0.043, 0.215], [0.035, 0.205], [0, 0.2]], C, { seg: 40 }));
  for (const s of [-1, 1]) root.add(tube([[0.047, 0.243], [0.07, 0.251], [0.091, 0.243], [0.1, 0.223], [0.096, 0.201], [0.083, 0.187]].map(([r, y]) => [s * r, y, 0]), 0.0075, C, { seg: 28, radial: 10 }));
  const fl = gypsophila({ stems: 17, seed: 5 }); fl.position.y = 0.255; root.add(fl);
  return describe(root, { id: 'garage-dryFlowersVase', name: 'White jug vase with dried gypsophila', zh: '白陶双耳罐插干花' });
}

// =====================================================================================================
// 8' × 7' white steel sectional garage door, built OPEN as in g04; a click runs it closed and back. Frame: origin on the floor
// at the centre of the opening, +Z = out to the street, the garage is −Z. Four ribbed pan sections ride 2" rollers in galvanised tracks: vertical tracks on the jambs,
// 12" radius curves, horizontal tracks under the ceiling with rear hangers. Torsion shaft with two springs + cable drums above
// the opening; chain-drive opener rail to a motor at z ≈ −3.3 hung from the ceiling (2.44) on two perforated angles.
// Toggle value 1 = open (rest pose), 0 = closed; while the bottom edge still blocks the opening a collider spans it.
function garageDoorOpen() {
  const root = new THREE.Group(), GV = G.galv(), GD = G.galvD(), WH = G.doorWhite(), WS = G.doorWhiteS();
  const W = 2.46, H = 2.13, NS = 4, SH = H / NS, T = 0.035, off = 0.024, CEIL = 2.44;
  const zt = -0.05, R = 0.305, yh = 2.2 - off, zc = zt - R, yc = yh - R, Lv = yc, La = PI * R / 2, zEnd = -2.62, zTop = -2.33;
  const path = (s) => { if (s <= Lv) return [s, zt]; if (s <= Lv + La) { const q = (s - Lv) / R; return [yc + R * Math.sin(q), zc + R * Math.cos(q)]; } return [yh, zc - (s - Lv - La)]; };
  // roller stations: top edge on the horizontal track at zTop, then one section-height chord at a time toward the opening
  const Sv = [Lv + La + (zc - zTop)];
  for (let k = 0; k < NS; k++) {
    const p = path(Sv[k]); let lo = Sv[k] - SH * 1.7, hi = Sv[k];
    for (let it = 0; it < 48; it++) { const m = (lo + hi) / 2, q = path(m); if (Math.hypot(q[0] - p[0], q[1] - p[1]) > SH) lo = m; else hi = m; }
    Sv.push((lo + hi) / 2);
  }
  // ---- one section in its closed frame: x across, y up 0..SH, exterior face z = 0, interior z = −T ----
  const groove = (g) => [[g - 0.01, 0], [g - 0.004, -0.0055], [g + 0.004, -0.0055], [g + 0.01, 0]];
  const prof = [[0.014, -T], [0.002, -T], [0, -T + 0.003], [0, -0.011], [0.004, -0.004], [0.009, 0], ...groove(SH * 0.25), ...groove(SH * 0.5), ...groove(SH * 0.75),
    [SH - 0.007, 0], [SH, -0.007], [SH, -T + 0.003], [SH - 0.002, -T], [SH - 0.014, -T]];
  const roller = (s, y) => {
    const g = new THREE.Group(), zr = -T - off;
    g.add(cyl(0.0085, 0.0085, 0.05, GV, { x: s * (W / 2 - 0.03), y, z: zr, rz: PI / 2, seg: 12 }));
    g.add(rod([s * (W / 2 - 0.05), y, zr], [s * 1.257, y, zr], 0.0055, M.steel(), 10));
    g.add(cyl(0.024, 0.024, 0.012, G.nylon(), { x: s * 1.263, y, z: zr, rz: PI / 2, seg: 20 }));
    g.add(cyl(0.009, 0.009, 0.014, M.steel(), { x: s * 1.263, y, z: zr, rz: PI / 2, seg: 12 }));
    return g;
  };
  const leaf = (x, y) => box(0.05, 0.075, 0.0025, GV, { r: 0.001, x, y, z: -T - 0.0013 });
  // Street skin (bevel to bevel) is an exterior finish: sky and full bounce, like the stucco round the opening. The sections
  // are built open under the ceiling, so the region test alone would light it as a room. Its indirect light eases to garage
  // level with the skin's depth behind the opening plane (uOpening = root +Z in world), so a rolling section never swaps shader.
  // The pans are hollow: the back of the skin (sweep back faces) is the inside face and keeps garage-level fill.
  const opening = { value: new THREE.Vector4(0, 0, 1, 0) }, skin = WH.clone();
  declare(skin, { zone: 'exterior' });   // a street face: the exterior copy (lighting.js material split)
  skin.onBeforeCompile = (shader) => {
    shader.uniforms.uOpening = opening;
    shader.vertexShader = 'varying vec3 vSkinWorld;\n' + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n\tvSkinWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = 'uniform vec4 uOpening;\nvarying vec3 vSkinWorld;\n' + shader.fragmentShader.replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
      float skinOut = gl_FrontFacing ? mix(0.3, 1.0, smoothstep(-0.6, -0.05, dot(uOpening.xyz, vSkinWorld) + uOpening.w)) : 0.3;
      irradiance *= skinOut; iblIrradiance *= skinOut;
      #if defined( RE_IndirectSpecular )
        radiance *= skinOut;
      #endif`);
  };
  skin.customProgramCacheKey = () => 'garage-door-skin';
  function section(k) {
    const g = new THREE.Group();
    g.add(sweepX(prof.slice(3, 20), -W / 2 + 0.0015, W / 2 - 0.0015, skin));
    for (const part of [prof.slice(0, 4), prof.slice(19)]) g.add(sweepX(part, -W / 2 + 0.0015, W / 2 - 0.0015, WH));
    for (const s of [-1, 1]) {
      g.add(box(0.075, SH - 0.004, T - 0.007, WS, { x: s * (W / 2 - 0.0375), y: 0.002, z: -(T + 0.007) / 2, bottom: true }));
      g.add(box(0.0015, SH - 0.002, T, WS, { x: s * (W / 2 - 0.00075), y: 0.001, z: -T / 2, bottom: true }));
    }
    g.add(box(0.05, SH - 0.004, T - 0.007, WS, { y: 0.002, z: -(T + 0.007) / 2, bottom: true }));
    const hx = [-(W / 2 - 0.045), 0, W / 2 - 0.045];
    if (k < NS - 1) {   // hinge leaves + knuckles on this section's bottom edge, end hinges carry rollers
      for (const x of hx) { g.add(leaf(x, 0.0375)); g.add(cyl(0.0055, 0.0055, 0.045, GV, { x, y: 0, z: -T - 0.006, rz: PI / 2, seg: 10 })); }
      for (const s of [-1, 1]) g.add(roller(s, 0));
    }
    if (k > 0) for (const x of hx) g.add(leaf(x, SH - 0.0375));
    if (k === 0) {      // top section: top roller brackets (rollers kept apart: they slide in slotted fixtures), strut, opener bracket
      g.userData.top = new THREE.Group();
      for (const s of [-1, 1]) { g.add(box(0.06, 0.11, 0.003, GV, { r: 0.001, x: s * (W / 2 - 0.04), y: SH - 0.055, z: -T - 0.0015 })); g.userData.top.add(roller(s, SH)); }
      const ys = SH * 0.58;
      g.add(box(W - 0.24, 0.075, 0.0016, GV, { y: ys, z: -T - 0.032 }));
      for (const dy of [-0.0375, 0.0375]) g.add(box(W - 0.24, 0.0016, 0.032, GV, { y: ys + dy, z: -T - 0.016 }));
      g.add(box(0.07, 0.1, 0.004, GV, { r: 0.001, y: SH - 0.07, z: -T - 0.034 }));
      for (const s of [-1, 1]) g.add(box(0.004, 0.045, 0.035, GV, { x: s * 0.013, y: SH - 0.07, z: -T - 0.052 }));
    }
    if (k === NS - 1) { // bottom section: bottom brackets, astragal seal, inside lift handle
      for (const s of [-1, 1]) { g.add(box(0.07, 0.11, 0.003, GV, { r: 0.001, x: s * (W / 2 - 0.04), y: 0.06, z: -T - 0.0015 })); g.add(roller(s, 0)); }
      g.add(box(W - 0.004, 0.006, 0.03, G.castAlu(), { y: 0.003, z: -0.017 }));
      g.add(cyl(0.009, 0.009, W - 0.01, G.rubber(), { y: -0.004, z: -0.016, rz: PI / 2, seg: 10 }));
      g.add(box(0.14, 0.035, 0.018, M.blackMatte(), { r: 0.005, x: 0.75, y: 0.17, z: -T - 0.009 }));
    }
    return g;
  }
  // each section is baked on its own so it can move; the top rollers and their slotted fixture plates stay separate again
  const secs = [], slides = [];
  for (let k = 0; k < NS; k++) { const sec = bake(section(k)); root.add(sec); secs.push(sec); }
  const top = bake(secs[0].userData.top); delete secs[0].userData.top; secs[0].add(top);
  for (const s of [-1, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.04, 1), GV); m.position.x = s * (W / 2 - 0.03); m.castShadow = m.receiveShadow = true; secs[0].add(m); slides.push(m); }
  // ---- tracks, flag brackets, hangers (both sides) ----
  const gap = 0.028, fw = 0.038;
  for (const s of [-1, 1]) {
    const xw = s * 1.282, xf = s * 1.263, xl = s * 1.245;
    // vertical track (C opening toward the door) + jamb angle lagged to the wall
    root.add(box(0.0025, Lv, 2 * gap + 0.004, GV, { x: xw, z: zt, bottom: true }));
    for (const dz of [-gap, gap]) { root.add(box(fw, Lv, 0.0025, GV, { x: xf, z: zt + dz, bottom: true })); root.add(cyl(0.0028, 0.0028, Lv, GV, { x: xl, y: Lv / 2, z: zt + dz * 0.93, seg: 6 })); }
    root.add(box(0.003, Lv, 0.078, GV, { x: s * 1.2849, z: -0.039, bottom: true }));
    root.add(box(0.05, Lv, 0.003, GV, { x: s * 1.31, z: -0.0015, bottom: true }));
    for (let y = 0.3; y < Lv; y += 0.55) root.add(box(0.012, 0.012, 0.006, M.steel(), { r: 0.002, x: s * 1.318, y, z: -0.006 }));
    // 12" radius curve
    const arc = new THREE.Group(); arc.position.set(0, yc, zc);
    const web = new THREE.Mesh(new THREE.RingGeometry(R - gap - 0.002, R + gap + 0.002, 18, 1, 0, PI / 2), GD); web.rotation.y = -PI / 2; web.position.x = xw; arc.add(web);
    for (const rr of [R - gap, R + gap]) { const f = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, fw, 20, 1, true, 0, PI / 2), GD); f.rotation.z = PI / 2; f.position.x = xf; arc.add(f); }
    for (const rr of [R - gap * 0.93, R + gap * 0.93]) { const l = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.0028, 6, 20, PI / 2), GV); l.rotation.y = -PI / 2; l.position.x = xl; arc.add(l); }
    arc.traverse(m => { if (m.isMesh) m.castShadow = m.receiveShadow = true; });
    root.add(arc);
    // horizontal track + outside reinforcing angle
    const Lh = zc - zEnd, zm = (zc + zEnd) / 2;
    root.add(box(0.0025, 2 * gap + 0.004, Lh, GV, { x: xw, y: yh, z: zm }));
    for (const dy of [-gap, gap]) { root.add(box(fw, 0.0025, Lh, GV, { x: xf, y: yh + dy, z: zm })); root.add(cyl(0.0028, 0.0028, Lh, GV, { x: xl, y: yh + dy * 0.93, z: zm, rx: PI / 2, seg: 6 })); }
    root.add(box(0.003, 0.05, Lh + 0.3, GV, { x: s * 1.2849, y: yh + 0.004, z: zm + 0.15 }));
    root.add(box(0.04, 0.003, Lh + 0.3, GV, { x: s * 1.305, y: yh + 0.0275, z: zm + 0.15 }));
    root.add(box(0.012, 0.03, 0.02, G.rubber(), { x: xf, y: yh, z: zEnd + 0.01 }));   // track end stop
    // flag bracket joining vertical track, curve and horizontal angle, lagged to the jamb
    root.add(box(0.003, yh + 0.04 - (Lv - 0.25), 0.09, GV, { x: s * 1.2862, y: Lv - 0.25, z: -0.045, bottom: true }));
    // rear hanger: perforated angle up to the ceiling + diagonal brace
    const hy = yh + 0.03, hl = CEIL - hy, hz = zEnd + 0.06;
    root.add(box(0.003, hl, 0.035, perforated(hl / 0.025), { x: s * 1.3235, y: hy, z: hz, bottom: true }));
    root.add(box(0.035, hl, 0.003, perforated(hl / 0.025), { x: s * 1.305, y: hy, z: hz - 0.0175, bottom: true }));
    const bz = hz + 0.38, bl = Math.hypot(hl, bz - hz) - 0.05, br = box(0.003, bl, 0.03, perforated(bl / 0.025), { x: s * 1.3235, y: hy + hl / 2, z: (hz + bz) / 2 });
    br.rotation.x = -Math.atan2(bz - hz, hl); root.add(br);
    for (const z of [hz, bz]) root.add(box(0.05, 0.004, 0.05, GV, { x: s * 1.31, y: CEIL - 0.002, z }));
    // photo-eye safety sensor on the track, wire running up the jamb
    root.add(box(0.06, 0.012, 0.03, GV, { x: s * 1.24, y: 0.15, z: zt - 0.04 }));
    root.add(box(0.032, 0.05, 0.055, G.sensor(), { r: 0.006, x: s * 1.215, y: 0.15, z: zt - 0.065 }));
    root.add(cyl(0.006, 0.006, 0.004, G.ledGreen(), { x: s * 1.199, y: 0.165, z: zt - 0.065, rz: PI / 2, seg: 10 }));
    root.add(rod([s * 1.29, 0.17, zt - 0.03], [s * 1.29, Lv - 0.3, zt - 0.03], 0.002, M.plasticWhite(), 4));
  }
  // ---- torsion assembly above the opening ----
  const ys = 2.3, zs = -0.085, cables = [];
  root.add(cyl(0.0127, 0.0127, 2.7, GV, { y: ys, z: zs, rz: PI / 2, seg: 14 }));
  for (const s of [-1, 1]) {
    root.add(box(0.003, 0.15, 0.12, GV, { x: s * 1.335, y: ys, z: -0.06 }));
    root.add(box(0.05, 0.15, 0.003, GV, { x: s * 1.31, y: ys, z: -0.0015 }));
    root.add(cyl(0.021, 0.021, 0.014, M.steel(), { x: s * 1.335, y: ys, z: zs, rz: PI / 2, seg: 16 }));
    const drum = lathe([[0.016, 0], [0.056, 0], [0.056, 0.004], [0.051, 0.006], [0.047, 0.03], [0.044, 0.034], [0.016, 0.036]], G.castAlu(), { seg: 24 });
    drum.rotation.z = s * PI / 2; drum.position.set(s * 1.315, ys, zs); root.add(drum);
    const sp = cyl(0.028, 0.028, 0.665, G.spring(), { x: s * (0.035 + 0.3325), y: ys, z: zs, rz: PI / 2, seg: 20, open: true }); root.add(sp);
    const wc = lathe([[0.0135, 0], [0.031, 0], [0.031, 0.012], [0.027, 0.034], [0.0135, 0.042]], G.castAlu(), { seg: 20 }); wc.rotation.z = -s * PI / 2; wc.position.set(s * 0.7, ys, zs); root.add(wc);
    const sc = lathe([[0.0135, 0], [0.031, 0], [0.031, 0.01], [0.022, 0.02], [0.0135, 0.022]], G.castAlu(), { seg: 20 }); sc.rotation.z = s * PI / 2; sc.position.set(s * 0.035, ys, zs); root.add(sc);
    // lift cable from the drum to the bottom bracket (stretched in pose)
    const c = cyl(0.0018, 0.0018, 1, M.steel(), { seg: 5 }); c.userData.s = s; root.add(c); cables.push(c);
  }
  root.add(box(0.004, 0.11, 0.1, GV, { y: ys, z: -0.05 }));
  root.add(box(0.13, 0.11, 0.004, GV, { y: ys, z: -0.002 }));
  // ---- opener: header bracket, chain rail, trolley + curved door arm, motor unit on two hangers ----
  const yr = 2.37, mz = -3.3, ml = 0.46, mw = 0.36, mh = 0.17, my0 = 2.215, zr0 = -0.03, zr1 = mz + ml / 2 + 0.02;
  root.add(box(0.1, 0.07, 0.004, GV, { y: yr, z: -0.002 }));
  for (const s of [-1, 1]) root.add(box(0.004, 0.04, 0.045, GV, { x: s * 0.024, y: yr, z: -0.024 }));
  root.add(box(0.04, 0.03, zr0 - zr1, GV, { r: 0.002, y: yr, z: (zr0 + zr1) / 2 }));
  root.add(box(0.012, 0.004, zr0 - zr1 - 0.1, G.chain(), { y: yr + 0.017, z: (zr0 + zr1) / 2 - 0.02 }));
  root.add(box(0.008, 0.002, zr0 - zr1 - 0.02, G.rubber(), { y: yr - 0.0151, z: (zr0 + zr1) / 2 }));
  // trolley (its frame origin rides the rail) + door arm: a rigid curved link LA long from the trolley pin to the door bracket
  const yp = yr - 0.03, LA = 0.4, trolley = new THREE.Group(), arm = new THREE.Group();
  trolley.add(box(0.058, 0.05, 0.13, G.castAlu(), { r: 0.006, y: yr - 0.006 }));
  trolley.add(box(0.012, 0.03, 0.06, G.releaseRed(), { r: 0.004, y: yr - 0.04, z: 0.03 }));
  trolley.add(rod([0, yr - 0.05, 0.05], [0, 1.86, 0.05], 0.0022, G.releaseRed(), 5));
  trolley.add(cyl(0.012, 0.012, 0.09, G.releaseRed(), { y: 1.85, z: 0.05, rz: PI / 2, seg: 12 }));
  arm.add(tube([[0, 0, 0], [0, -0.03, 0.06], [0, -0.055, 0.17], [0, -0.052, 0.29], [0, -0.025, LA - 0.03], [0, 0, LA]], 0.0065, GV, { seg: 32, radial: 8 }));
  arm.add(cyl(0.006, 0.006, 0.04, M.steel(), { z: LA, rz: PI / 2, seg: 10 }));
  root.add(bake(trolley), bake(arm));
  // motor unit
  root.add(box(mw, mh, ml, G.openerBody(), { r: 0.025, seg: 4, y: my0, z: mz, bottom: true }));
  root.add(box(mw - 0.03, 0.022, ml - 0.05, G.openerGrey(), { r: 0.01, y: my0 + mh - 0.008, z: mz, bottom: true }));
  const lamp = group(
    box(mw - 0.07, 0.09, 0.02, G.openerLens(), { r: 0.008, y: my0 + 0.06, z: mz - ml / 2 - 0.004 }),
    box(mw - 0.09, 0.008, 0.15, G.openerLens(), { r: 0.003, y: my0 - 0.002, z: mz - ml / 2 + 0.1 }),
  );
  lamp.userData.lightFixture = { name: 'Garage opener lamp', zh: '车库开门机灯' }; root.add(lamp);
  root.add(box(0.12, 0.07, 0.06, G.openerGrey(), { r: 0.012, y: yr - 0.012, z: mz + ml / 2 + 0.015 }));
  for (const s of [-1, 1]) for (let i = 0; i < 6; i++) root.add(box(0.003, 0.01, 0.13, G.rubber(), { x: s * (mw / 2 + 0.0005), y: my0 + 0.04 + i * 0.016, z: mz + 0.06 }));
  root.add(rod([0.12, my0, mz - 0.17], [0.125, my0 - 0.17, mz - 0.17], 0.0012, M.plasticWhite(), 4));
  // two perforated angle hangers from the ceiling to the motor's side tabs
  const hl2 = CEIL - (my0 + 0.03);
  for (const s of [-1, 1]) {
    const x = s * (mw / 2 + 0.006);
    root.add(box(0.003, hl2, 0.035, perforated(hl2 / 0.025), { x: x + s * 0.0015, y: my0 + 0.03, z: mz, bottom: true }));
    root.add(box(0.035, hl2, 0.003, perforated(hl2 / 0.025), { x: x + s * 0.0175, y: my0 + 0.03, z: mz - 0.0175, bottom: true }));
    root.add(box(0.06, 0.004, 0.06, GV, { x: x + s * 0.015, y: CEIL - 0.002, z: mz }));
    root.add(cyl(0.007, 0.007, 0.01, M.steel(), { x: x + s * 0.006, y: my0 + 0.06, z: mz, rz: PI / 2, seg: 6 }));
  }
  // power cord up to a ceiling outlet box
  root.add(cyl(0.05, 0.05, 0.012, M.plasticWhite(), { x: 0.12, y: CEIL - 0.006, z: mz - 0.36, seg: 24 }));
  root.add(tube([[0.1, my0 + mh - 0.01, mz - 0.18], [0.11, my0 + mh + 0.03, mz - 0.25], [0.12, CEIL - 0.06, mz - 0.33], [0.12, CEIL - 0.014, mz - 0.36]], 0.003, G.cord(), { seg: 24, radial: 5 }));
  const live = [...secs, ...cables, trolley, arm, lamp];
  root.remove(...live); bake(root); root.add(...live);

  // ---- motion: the sections are a chain on the track. The bottom roller sits at station v·Sv[NS] and every hinge roller
  // above it is one section-height chord further along, so the top section leads onto the curve and the bottom one
  // arrives last. Closed, the top section stands plumb with its top rollers set back on the curve in their slotted
  // fixtures; it settles onto the chord within the first 0.35 m of lift (value 1 reproduces the open pose above).
  const chord = (s0) => {
    const p = path(s0); let lo = s0, hi = s0 + SH * 1.7;
    for (let it = 0; it < 48; it++) { const m = (lo + hi) / 2, q = path(m); if (Math.hypot(q[0] - p[0], q[1] - p[1]) < SH) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  const sOpen = Sv[NS], up = new THREE.Vector3(0, 1, 0), va = new THREE.Vector3(), vb = new THREE.Vector3();
  function pose(v) {
    const S = [v * sOpen]; for (let k = 0; k < NS; k++) S.push(chord(S[k]));
    const Q = S.reverse().map(path);
    for (let k = 0; k < NS; k++) {
      const [ya, za] = Q[k + 1], [yb, zb] = Q[k]; let uy = (yb - ya) / SH, uz = (zb - za) / SH;
      if (k === 0) { const a = ss(0, 0.35, S[NS]); uy = 1 + (uy - 1) * a; uz *= a; const n = Math.hypot(uy, uz); uy /= n; uz /= n; }
      secs[k].rotation.x = Math.atan2(uz, uy); secs[k].position.set(0, ya - uz * (T + off), za + uy * (T + off)); secs[k].updateMatrix();
    }
    // top rollers onto their track point, in the top section's frame; the fixture plate spans section back → roller
    const s0 = secs[0], c = Math.cos(s0.rotation.x), sn = Math.sin(s0.rotation.x), dy = Q[0][0] - s0.position.y, dz = Q[0][1] - s0.position.z;
    const oy = dy * c + dz * sn - SH, oz = -dy * sn + dz * c + T + off;
    top.position.set(0, oy, oz);
    for (const m of slides) { m.position.y = SH + oy; m.position.z = (-T - T - off + oz) / 2; m.scale.z = Math.max(0.01, off - oz); }
    // lift cables, drum → bottom bracket
    for (const m of cables) {
      va.set(m.userData.s * 1.3, ys - 0.01, zs - 0.05); vb.set(m.userData.s * (W / 2 - 0.015), 0.03, -T - 0.004).applyMatrix4(secs[NS - 1].matrix);
      m.position.copy(va).add(vb).multiplyScalar(0.5); m.scale.y = va.distanceTo(vb); m.quaternion.setFromUnitVectors(up, vb.sub(va).normalize());
    }
    // opener: the trolley sits where the arm just reaches the door bracket
    const B = va.set(0, SH - 0.07, -T - 0.052).applyMatrix4(s0.matrix), h = B.y - yp, zp = B.z - Math.sqrt(Math.max(0, LA * LA - h * h));
    trolley.position.z = zp; arm.position.set(0, yp, zp); arm.rotation.x = Math.atan2(-h, B.z - zp);
  }
  // collider across the opening while the door blocks it (bottom edge below ~1.1 m); none on the overhead tracks
  let blocked = null, posed = null;
  function syncCollider(v) {
    if (!root.parent || (v < 0.5) === blocked) return;
    blocked = v < 0.5;
    const cols = getColliders(), i = cols.findIndex(c => c.tag === 'garagedoor'); if (i >= 0) cols.splice(i, 1);
    if (!blocked) return;
    root.updateWorldMatrix(true, false); const b = new THREE.Box3();
    for (const [x, z] of [[-1.24, -0.075], [1.24, -0.075], [-1.24, 0.05], [1.24, 0.05]]) b.expandByPoint(va.set(x, 0, z).applyMatrix4(root.matrixWorld));
    addAABB(b.min.x, b.max.x, b.min.z, b.max.z, 'garagedoor');
  }
  const toggle = animatedToggle(root, {
    label: { en: 'Garage door · Open', zh: '车库门 · 打开' }, labelOn: { en: 'Garage door · Close', zh: '车库门 · 关上' }, duration: 3,
    apply(v) {
      if (v !== posed) { posed = v; pose(v); }
      syncCollider(v);
      if (root.parent) { const e = root.matrixWorld.elements, n = va.set(e[8], e[9], e[10]).normalize(); opening.value.set(n.x, n.y, n.z, -(n.x * e[12] + n.y * e[13] + n.z * e[14])); }
    },
  });
  toggle.set(true, true);
  return describe(root, { id: 'garage-garageDoorOpen', name: 'Sectional garage door with opener', zh: '分节式车库门及开门机' });
}

// =====================================================================================================
// 1.2 m LED linear shop light: white aluminium housing flush to the ceiling, frosted emissive lens, white end caps.
function shopLight() {
  const root = new THREE.Group(), Lf = 1.22, top = 2.438, w = 0.075, Hs = G.ledHousing();
  const prof = [[-w / 2, 0], [w / 2, 0], [w / 2 - 0.006, -0.03], [-w / 2 + 0.006, -0.03]];
  const body = extrude(prof, Lf - 0.03, Hs, { bevel: 0.002, ry: PI / 2, x: -(Lf - 0.03) / 2, y: top - 0.002 }); root.add(body);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.029, Lf - 0.04, 24, 1, true, PI, PI), G.ledDiffuser());
  lens.rotation.z = PI / 2; lens.scale.set(0.5, 1, 1); lens.position.set(0, top - 0.032, 0); root.add(lens);
  root.add(box(Lf - 0.04, 0.003, 0.058, G.ledDiffuser(), { y: top - 0.0335 }));
  for (const s of [-1, 1]) {
    root.add(box(0.016, 0.046, w + 0.004, G.ledCap(), { r: 0.005, x: s * (Lf / 2 - 0.008), y: top - 0.025 }));
    root.add(cyl(0.0035, 0.0035, 0.002, M.steel(), { x: s * (Lf / 2 + 0.0005), y: top - 0.025, rz: PI / 2, seg: 10 }));
  }
  root.userData.light = { type: 'rect', w: 1.1, h: 0.08, intensity: 120, y: 2.4, color: 0xfff4e6, day: 2.5 };
  return describe(root, { id: 'garage-shopLight', name: 'LED linear shop light 1.2 m', zh: 'LED 条形吸顶灯' });
}

// =====================================================================================================
// Ping-pong table recoloured to g49 / g04: slate blue-grey top (2.74 × 1.525, top at 0.76) with white lines, white steel edge
// apron and undercarriage, black wheels, black mesh net with white tape on grey clamp posts. Long axis = X.
function pingPongSlate() {
  const root = new THREE.Group(), Lx = 2.74, Wz = 1.525, H = 0.76, t = 0.019, F = G.frameWhite(), FG = G.frameGrey();
  for (const s of [-1, 1]) root.add(box(Lx / 2 - 0.003, t, Wz, G.slateBoard(), { r: 0.002, x: s * (Lx / 4 + 0.0015), y: H - t, bottom: true }));
  root.add(plane(Lx - 0.004, Wz - 0.004, G.slateTop(), { y: H + 0.0004, rx: -PI / 2 }));
  // flush white steel apron round each half (covers the board edge, its top just under the playing surface)
  const ha = 0.064, ya = H - 0.001 - ha;
  for (const s of [-1, 1]) {
    const cx = s * (Lx / 4 + 0.0015);
    for (const sz of [-1, 1]) root.add(box(Lx / 2 - 0.004, ha, 0.016, F, { r: 0.003, x: cx, y: ya, z: sz * (Wz / 2 - 0.004), bottom: true }));
    root.add(box(0.016, ha, Wz + 0.008, F, { r: 0.003, x: s * (Lx / 2 - 0.004), y: ya, bottom: true }));
    root.add(box(0.016, 0.05, Wz - 0.03, F, { r: 0.003, x: s * 0.014, y: H - t - 0.05, bottom: true }));
    // under-frame rails
    const yA = H - t - 0.045;
    for (const sz of [-1, 1]) root.add(box(Lx / 2 - 0.2, 0.04, 0.03, F, { r: 0.003, x: cx, y: yA, z: sz * (Wz / 2 - 0.22), bottom: true }));
    root.add(box(0.03, 0.04, Wz - 0.06, F, { r: 0.003, x: s * (Lx / 2 - 0.2), y: yA, bottom: true }));
    // end legs, levelling feet, low stretcher (g04 shows the white legs + bar), braces to the chassis
    const lx = s * (Lx / 2 - 0.2);
    for (const sz of [-1, 1]) {
      const z = sz * (Wz / 2 - 0.12);
      root.add(box(0.042, yA - 0.03, 0.042, F, { r: 0.004, x: lx, y: 0.03, z, bottom: true }));
      root.add(cyl(0.02, 0.024, 0.03, G.wheel(), { x: lx, z, bottom: true, seg: 14 }));
      root.add(rod([lx, 0.42, z], [s * 0.2, yA, z * 0.9], 0.012, F, 10));
    }
    root.add(box(0.036, 0.036, Wz - 0.24, F, { r: 0.004, x: lx, y: 0.2, bottom: true }));
    root.add(box(0.026, 0.026, Wz - 0.24, F, { r: 0.003, x: lx, y: yA - 0.06, bottom: true }));
  }
  // central rollaway chassis with Ø125 wheels
  const yA = H - t - 0.045;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * 0.12, z = sz * (Wz / 2 - 0.2);
    root.add(rod([x, 0.11, z], [sx * 0.08, yA, z * 0.92], 0.014, F, 12));
    root.add(cyl(0.0625, 0.0625, 0.035, G.wheel(), { x, y: 0.0625, z, rx: PI / 2, seg: 24 }));
    root.add(cyl(0.032, 0.032, 0.04, FG, { x, y: 0.0625, z, rx: PI / 2, seg: 16 }));
  }
  for (const sz of [-1, 1]) root.add(rod([-0.12, 0.11, sz * (Wz / 2 - 0.2)], [0.12, 0.11, sz * (Wz / 2 - 0.2)], 0.012, F, 10));
  root.add(rod([0, 0.11, -(Wz / 2 - 0.2)], [0, 0.11, Wz / 2 - 0.2], 0.012, F, 10));
  // net 1.83 × 0.1525: dark mesh, white top tape and end bindings, grey posts with clamps and black knobs
  const NL = Wz + 0.305, NH = 0.1525;
  root.add(plane(NL - 0.02, NH - 0.02, G.net(), { y: H + 0.004 + (NH - 0.02) / 2, ry: PI / 2 }));
  root.add(box(0.006, 0.018, NL - 0.02, G.tape(), { r: 0.002, y: H + NH - 0.009 }));
  for (const sz of [-1, 1]) root.add(box(0.005, NH - 0.01, 0.014, G.tape(), { y: H + 0.004 + (NH - 0.01) / 2, z: sz * (NL / 2 - 0.017) }));
  root.add(rod([0, H + 0.006, -NL / 2 + 0.02], [0, H + 0.006, NL / 2 - 0.02], 0.0015, M.blackMatte(), 4));
  for (const sz of [-1, 1]) {
    const z = sz * (NL / 2 - 0.002);
    root.add(cyl(0.0095, 0.0095, NH + 0.006, M.blackMatte(), { y: H + 0.004, z, bottom: true, seg: 14 }));
    root.add(cyl(0.011, 0.011, 0.006, M.blackMatte(), { y: H + NH + 0.01, z, seg: 14 }));
    root.add(box(0.045, 0.007, 0.2, FG, { r: 0.002, y: H + 0.0035, z: sz * (Wz / 2 + 0.07) }));
    root.add(box(0.045, 0.1, 0.008, FG, { r: 0.002, y: H - 0.095, z: sz * (Wz / 2 + 0.01), bottom: true }));
    root.add(box(0.045, 0.008, 0.06, FG, { r: 0.002, y: H - 0.095, z: sz * (Wz / 2 - 0.02), bottom: true }));
    root.add(cyl(0.004, 0.004, 0.03, M.steel(), { y: H - 0.11, z: sz * (Wz / 2 - 0.035), seg: 8 }));
    root.add(cyl(0.019, 0.019, 0.012, M.blackMatte(), { y: H - 0.126, z: sz * (Wz / 2 - 0.035), seg: 16 }));
  }
  return autoCollider(describe(bake(root), { id: 'garage-pingPongSlate', name: 'Ping-pong table (slate grey, white frame)', zh: '乒乓球台（石板灰）' }));
}

// =====================================================================================================
// Raw concrete plinth 0.75 × 0.80 × 0.10 under the washer tower (g49/g48): light grey, mottled, chipped and worn arrises,
// grime toward the base. Vertex jitter is keyed to position so shared corners stay welded.
function laundryPlinth() {
  const root = new THREE.Group(), W = 0.75, D = 0.8, H = 0.1;
  const geo = new RoundedBoxGeometry(W, H, D, 4, 0.012), pos = geo.attributes.position, col = [];
  const hash = (x, y, z) => { const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return v - Math.floor(v); };
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ex = Math.abs(x) > W / 2 - 0.013, ey = Math.abs(y) > H / 2 - 0.013, ez = Math.abs(z) > D / 2 - 0.013;
    const kx = Math.round(x * 400) / 400, ky = Math.round(y * 400) / 400, kz = Math.round(z * 400) / 400;
    const n1 = hash(kx, ky, kz), n2 = hash(kx * 0.3 + 1, ky * 0.3, kz * 0.3 + 2);
    if ((ex && ey) || (ey && ez) || (ex && ez)) {
      const d = 0.0025 + 0.0045 * n1 * (0.4 + n2);
      if (ex) x -= Math.sign(x) * d; if (ez) z -= Math.sign(z) * d; if (ey && y > 0) y -= d * 0.8;
      pos.setXYZ(i, x, y, z);
    }
    const base = 0.78 + 0.22 * ((y + H / 2) / H), stain = 0.9 + 0.1 * Math.sin(x * 23 + z * 17) * Math.sin(z * 31 - x * 9);
    const c = Math.min(1, base * stain * ((ex || ez) && ey && y > 0 ? 1.08 : 1));
    col.push(c, c * 0.995, c * 0.985);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, G.concrete()); m.position.y = H / 2; m.castShadow = m.receiveShadow = true; root.add(m);
  return autoCollider(describe(root, { id: 'garage-laundryPlinth', name: 'Concrete laundry plinth', zh: '洗衣机水泥底座' }));
}

export const items = { utilitySink, metalShelving, wallRail, leaningFrame, dryFlowersVase, garageDoorOpen, shopLight, pingPongSlate, laundryPlinth };
