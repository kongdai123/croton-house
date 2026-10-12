// bedrooms — primary suite A (owner-built whitewashed pine platform bed), bedroom B (acacia bed), bedroom 3 (pine bed),
// closet louvered bifolds, walnut bar/shelf cabinet, rugs, side tables. Refs: refs/bedrooms/ (g26-g35, rednote build photos).
// Local frame: origin on the floor at the footprint centre, +Z = front (a bed's foot points to +Z, headboard at -Z).
import { THREE, M, box, cyl, lathe, extrude, tube, group, at, repeat, legs, addSeat, setMovable, autoCollider, setCollider, describe, sphere } from '../kit.js';
import { wood, wood as woodBase, merge, vc, pillowMesh, ruffle, drape, book, cup, mats, rng, projectUV } from './bedrooms_parts.js';

const PI = Math.PI;

// Pillow helper: puffy pillow, tilted back by `lean` (radians) so it leans on the headboard, yawed by `yaw`.
function leaningPillow(w, d, t, mat, { x = 0, y = 0, z = 0, lean = 1.05, yaw = 0, roll = 0, seed = 1, trim = null } = {}) {
  const inner = new THREE.Group(); inner.add(pillowMesh(w, d, t, mat, { seed }));
  if (trim) inner.add(ruffle(w, d, trim));
  inner.rotation.x = lean; const g = new THREE.Group(); g.add(inner); g.position.set(x, y, z); g.rotation.set(0, yaw, roll); return g;
}

// =====================================================================================================================
// bedWhitewash — the owner's hand-built floating platform (rednote 69d2af8a00 + g26/g27).
// Measured from the build photos: a floating deck of ~0.19 m (1×8) boards running side to side, wrapped by a thick
// fascia and set on a deep recessed plinth; a full-width headboard of HORIZONTAL whitewashed boards (3 rows, staggered
// butt joints, two outlet cut-outs) ≈0.64 m above the deck; open cubbies at both head corners whose tops sit flush
// with the deck (the bedside "tables"); the left (-X) cubby is wider than the right one, as in the photos.
function bedWhitewash() {
  const P = mats.whitewash(); const root = new THREE.Group(); // M.pineWhitewash reads flat white here; local variant keeps the grain
  const W = 2.70, zBack = -1.15, zHB = -1.10, zFront = 1.15, top = 0.28, bt = 0.04;
  const dx0 = -0.75, dx1 = 0.97;              // deck (under the mattress) x-range: 1.72 m
  const cubbyD = 0.45;                        // head-corner cubbies, 0.45 deep
  const parts = [];
  // --- deck boards (side to side, along x), 12 × 0.1875 across 2.25 m, 4 mm joints, two butt joints
  const nB = 12, bw = (zFront - zHB) / nB, joins = { 3: 0.33, 8: -0.21, 10: 0.58 };
  for (let i = 0; i < nB; i++) {
    const zc = zHB + bw * (i + 0.5), cut = joins[i];
    const segs = cut === undefined ? [[dx0, dx1]] : [[dx0, cut], [cut, dx1]];
    segs.forEach(([a, b], k) => parts.push(wood(b - a - 0.004, bt, bw - 0.004, P, { x: (a + b) / 2, y: top - bt, z: zc, bottom: true, along: 0, seed: 100 + i * 3 + k, r: 0.005 })));
  }
  // --- fascia: one tall board each side + foot (floats 0.06 above the floor on the recessed plinth)
  const fh = top - bt - 0.06;
  parts.push(wood(dx1 - dx0, fh, 0.04, P, { x: (dx0 + dx1) / 2, y: 0.06, z: zFront - 0.02, bottom: true, along: 0, seed: 7, r: 0.006 }));
  parts.push(wood(0.04, fh, zFront - zHB - 0.04, P, { x: dx0 + 0.02, y: 0.06, z: (zHB + zFront - 0.04) / 2, bottom: true, along: 2, seed: 8, r: 0.006 }));
  parts.push(wood(0.04, fh, zFront - zHB - 0.04, P, { x: dx1 - 0.02, y: 0.06, z: (zHB + zFront - 0.04) / 2, bottom: true, along: 2, seed: 9, r: 0.006 }));
  // --- head-corner cubbies: top board flush with the deck, raised bottom shelf, outer end panel, open to the front
  const cubby = (x0, x1, seed) => {
    const w = x1 - x0, xc = (x0 + x1) / 2, zc = zHB + cubbyD / 2, outer = x0 < 0 ? x0 : x1, dir = x0 < 0 ? -1 : 1;
    parts.push(wood(w, bt, cubbyD, P, { x: xc, y: top - bt, z: zc, bottom: true, along: 0, seed, r: 0.005 }));
    parts.push(wood(0.04, top - bt - 0.06, cubbyD, P, { x: outer - dir * 0.02, y: 0.06, z: zc, bottom: true, along: 2, seed: seed + 1 }));
    parts.push(wood(w - 0.04, 0.03, cubbyD - 0.01, P, { x: xc - dir * 0.02, y: 0.06, z: zc - 0.005, bottom: true, along: 0, seed: seed + 2 }));
    parts.push(wood(w - 0.16, 0.06, cubbyD - 0.12, P, { x: xc, y: 0, z: zc - 0.04, bottom: true, along: 0, seed: seed + 3, r: 0.003 })); // plinth
  };
  cubby(-W / 2, dx0, 30); cubby(dx1, W / 2, 40);
  // --- recessed plinth under the deck (set back 0.15) + cross members
  parts.push(wood(dx1 - dx0 - 0.30, 0.06, zFront - zHB - 0.30, P, { x: (dx0 + dx1) / 2, y: 0, z: (zHB + zFront) / 2, bottom: true, along: 0, seed: 50, r: 0.003 }));
  // --- headboard: backer from the floor, then 3 rows of horizontal boards (bottom→top 0.20, 0.21, 0.23) with
  // staggered joints measured from the finished build photo; outlet cut-outs in the bottom row.
  parts.push(wood(W, 0.92, 0.025, P, { x: 0, y: 0, z: zBack + 0.0125, bottom: true, along: 0, seed: 60, r: 0.003 }));
  const rows = [
    { h: 0.20, segs: [[0, 0.235], [0.265, 0.86], [0.89, 1]] },
    { h: 0.21, segs: [[0, 0.41], [0.41, 1]] },
    { h: 0.23, segs: [[0, 0.80], [0.80, 1]] },
  ];
  let y0 = top; let sd = 70;
  for (const row of rows) {
    for (const [a, b] of row.segs) {
      const xa = -W / 2 + a * W + (a > 0 ? 0.002 : 0), xb = -W / 2 + b * W - (b < 1 ? 0.002 : 0);
      parts.push(wood(xb - xa, row.h - 0.004, 0.025, P, { x: (xa + xb) / 2, y: y0 + 0.002, z: zHB - 0.0125, bottom: true, along: 0, seed: sd++, r: 0.004 }));
    }
    y0 += row.h;
  }
  root.add(merge(parts, P));
  // outlets in the two cut-outs (white duplex receptacles)
  for (const fx of [0.25, 0.875]) {
    const x = -W / 2 + fx * W, y = top + 0.10;
    root.add(box(0.045, 0.075, 0.01, mats.outletWhite(), { x, y, z: zHB - 0.02, r: 0.003, seg: 1 }));
    for (const dy of [-0.017, 0.017]) for (const dx of [-0.006, 0.006]) root.add(box(0.003, 0.009, 0.004, M.blackMatte(), { x: x + dx, y: y + dy, z: zHB - 0.014 }));
  }

  // --- mattress (queen; the deck measures ≈1.72 between fascias in the build photos), sheet, coverlet, pillows
  const mw = 1.52, mdp = 2.03, mh = 0.22, mx = (dx0 + dx1) / 2, mz0 = zHB, mzc = mz0 + mdp / 2, mTop = top + mh;
  root.add(box(mw, mh, mdp, mats.sheet(), { r: 0.05, seg: 4, x: mx, y: top, z: mzc, bottom: true }));
  const cov = box(mw + 0.05, mh + 0.02, 1.48, mats.quilt(), { r: 0.05, seg: 4, x: mx, y: top + 0.025, z: mz0 + mdp - 1.48 / 2 + 0.03, bottom: true });
  projectUV(cov.geometry, 2, 0.32); root.add(cov);
  const cuff = box(mw + 0.06, 0.05, 0.24, mats.quilt(), { r: 0.024, seg: 3, x: mx, y: mTop + 0.012, z: mz0 + mdp - 1.48 + 0.10, bottom: true });
  projectUV(cuff.geometry, 0, 0.32); root.add(cuff);
  // two big plain pillows against the headboard, two black-piped ruffled shams in front (g26)
  root.add(leaningPillow(0.70, 0.60, 0.20, mats.pillow(), { x: mx - 0.38, y: mTop + 0.17, z: zHB + 0.20, lean: 0.95, yaw: 0.04, seed: 2 }));
  root.add(leaningPillow(0.70, 0.60, 0.20, mats.pillow(), { x: mx + 0.38, y: mTop + 0.17, z: zHB + 0.20, lean: 0.95, yaw: -0.05, seed: 3 }));
  root.add(leaningPillow(0.62, 0.46, 0.16, mats.pillow(), { x: mx - 0.33, y: mTop + 0.15, z: zHB + 0.45, lean: 0.8, yaw: 0.10, roll: 0.03, seed: 4, trim: mats.piping() }));
  root.add(leaningPillow(0.62, 0.46, 0.16, mats.pillow(), { x: mx + 0.35, y: mTop + 0.15, z: zHB + 0.46, lean: 0.8, yaw: -0.12, roll: -0.03, seed: 5, trim: mats.piping() }));
  // grey knit throw, diagonally across the foot-left corner and over the foot edge
  root.add(drape({ w: 1.25, l: 1.75, cx: mx - 0.30, cz: 0.45, angle: 0.55, x0: mx - mw / 2 - 0.025, x1: mx + mw / 2 + 0.025, z0: -0.70, z1: mz0 + mdp + 0.03, top: mTop + 0.045, floor: 0.004, ledge: { x0: dx0, x1: dx1, z0: zHB, z1: zFront, y: top }, R: 0.055, ripple: 0.03, seed: 8 }, mats.throwKnit()));
  // bedside props: on the wide (-X) cubby top a book + stoneware cup; books stacked inside the +X cubby (g26)
  root.add(book(0.16, 0.025, 0.23, 0x2f4a5c, { x: -1.08, y: top, z: zHB + 0.20, ry: 0.15 }));
  root.add(cup(M.ceramicSpeckle(), { x: -0.90, y: top, z: zHB + 0.30 }));
  root.add(book(0.17, 0.03, 0.24, 0x1d1d1f, { x: 1.16, y: 0.09, z: zHB + 0.25, ry: 0.05 }));
  root.add(book(0.15, 0.025, 0.21, 0xc9b23a, { x: 1.16, y: 0.12, z: zHB + 0.25, ry: -0.06 }));
  root.add(book(0.16, 0.02, 0.22, 0xe9e4d8, { x: 1.16, y: 0.145, z: zHB + 0.26, ry: 0.1 }));

  addSeat(root, { x: dx1 - 0.03, y: top, z: 0.3, facing: PI / 2, kind: 'ledge' });
  addSeat(root, { x: mx + mw / 2 - 0.06, y: mTop, z: 0, facing: PI / 2, kind: 'bed' });
  describe(root, { id: 'bedWhitewash', name: 'Whitewashed pine platform bed (owner-built)', zh: '主卧 · 房主手作白洗松木平台床', note: 'queen mattress on a floating 1.72 m deck; full-width 2.70 m headboard with flush corner cubbies' });
  return autoCollider(root);
}

// =====================================================================================================================
// Shared bedding for framed beds: mattress (with fitted sheet), top sheet / duvet with fold, pillows, throw.
function bedding(root, { mw, mdp, mh, y, z0, mx = 0, duvetLen = 1.55, duvet = true, throwMat, throwSide = -1, seed = 1, ledge = null }) {
  const mTop = y + mh;
  root.add(box(mw, mh, mdp, mats.sheet(), { r: 0.05, seg: 4, x: mx, y, z: z0 + mdp / 2, bottom: true }));
  const dz = z0 + mdp - duvetLen / 2 + 0.03;
  if (duvet) {
    root.add(box(mw + 0.05, 0.14, duvetLen, mats.sheet(), { r: 0.045, seg: 4, x: mx, y: mTop - 0.11, z: dz, bottom: true }));
    root.add(box(mw + 0.06, 0.045, 0.2, mats.sheet(), { r: 0.02, seg: 3, x: mx, y: mTop + 0.01, z: z0 + mdp - duvetLen + 0.09, bottom: true }));
  }
  const dTop = duvet ? mTop + 0.03 : mTop;
  const pw = Math.min(0.74, mw / 2 - 0.02);
  root.add(leaningPillow(pw, 0.50, 0.18, mats.pillow(), { x: mx - pw / 2 - 0.01, y: mTop + 0.2, z: z0 + 0.13, lean: 1.15, yaw: 0.03, seed: seed + 1 }));
  root.add(leaningPillow(pw, 0.50, 0.18, mats.pillow(), { x: mx + pw / 2 + 0.01, y: mTop + 0.2, z: z0 + 0.13, lean: 1.15, yaw: -0.04, seed: seed + 2 }));
  root.add(leaningPillow(0.55, 0.50, 0.15, mats.pillow(), { x: mx - 0.27, y: mTop + 0.19, z: z0 + 0.36, lean: 0.95, yaw: 0.12, roll: 0.04, seed: seed + 3 }));
  root.add(leaningPillow(0.55, 0.50, 0.15, mats.pillow(), { x: mx + 0.30, y: mTop + 0.19, z: z0 + 0.38, lean: 0.95, yaw: -0.15, roll: -0.04, seed: seed + 4 }));
  if (throwMat) root.add(drape({ w: 0.75, l: 1.45, cx: mx + throwSide * (mw / 2 - 0.15), cz: z0 + mdp - 0.55, angle: throwSide * 0.35, x0: mx - mw / 2 - 0.025, x1: mx + mw / 2 + 0.025, z0, z1: z0 + mdp + 0.025, top: dTop + 0.005, floor: 0.012, ledge, R: 0.05, ripple: 0.025, seed: seed + 9 }, throwMat));
  return mTop;
}

// =====================================================================================================================
// bedAcacia — bedroom B (g33/g32): edge-glued acacia queen frame, square posts, top rail + slot + 4-board panel.
function bedAcacia() {
  const A = mats.acacia(), root = new THREE.Group(), parts = [];
  const wood = (w, h, d, m, o) => woodBase(w, h, d, m, { across: 0.6, tile: 2.4, ...o });
  const W = 1.70, D = 2.15, z0 = -D / 2, z1 = D / 2, post = 0.075;
  // head posts and headboard
  for (const s of [-1, 1]) parts.push(wood(post, 1.05, post, A, { x: s * (W / 2 - post / 2), y: 0, z: z0 + post / 2, bottom: true, along: 1, seed: 3 + s, r: 0.006 }));
  const hw = W - 2 * post + 0.02;
  parts.push(wood(hw, 0.13, 0.032, A, { x: 0, y: 0.92, z: z0 + post / 2, bottom: true, along: 0, seed: 11, r: 0.006 }));
  for (let i = 0; i < 4; i++) parts.push(wood(hw, 0.112, 0.028, A, { x: 0, y: 0.42 + i * 0.116, z: z0 + post / 2, bottom: true, along: 0, seed: 12 + i, r: 0.004 }));
  // foot legs: square, tapered, splayed slightly forward
  for (const s of [-1, 1]) {
    const l = wood(post, 0.43, post, A, { y: -0.215, along: 1, seed: 20 + s, r: 0.006 });
    const pos = l.geometry.attributes.position; for (let i = 0; i < pos.count; i++) { const t = (pos.getY(i) + 0.215) / 0.43; pos.setX(i, pos.getX(i) * (0.72 + 0.28 * t)); pos.setZ(i, pos.getZ(i) * (0.72 + 0.28 * t)); }
    l.geometry.computeVertexNormals();
    const g = new THREE.Group(); g.add(l); g.position.set(s * (W / 2 - post / 2), 0.43, z1 - post / 2 - 0.02); g.rotation.x = -0.09; g.updateMatrixWorld(true);
    l.applyMatrix4(g.matrix); parts.push(l);
  }
  // rails (0.22 tall, centred at 0.30) with a slat ledge inside
  for (const s of [-1, 1]) parts.push(wood(0.032, 0.22, D - post - 0.07, A, { x: s * (W / 2 - 0.022), y: 0.19, z: 0.005, bottom: true, along: 2, seed: 30 + s, r: 0.006 }));
  parts.push(wood(W - 0.06, 0.22, 0.032, A, { x: 0, y: 0.19, z: z1 - post / 2 - 0.03, bottom: true, along: 0, seed: 33, r: 0.006 }));
  root.add(merge(parts, A));
  root.add(box(W - 0.10, 0.02, D - 0.2, M.lumber(), { x: 0, y: 0.33, z: 0, bottom: true })); // slat deck (hidden)
  bedding(root, { mw: 1.52, mdp: 2.03, mh: 0.25, y: 0.35, z0: z0 + post + 0.005, duvetLen: 1.5, throwMat: mats.throwCream(), throwSide: -1, seed: 20, ledge: { x0: -W / 2, x1: W / 2, z0: z0, z1: z1, y: 0.41 } });
  addSeat(root, { x: 0.70, y: 0.60, z: 0.1, facing: PI / 2, kind: 'bed' });
  describe(root, { id: 'bedAcacia', name: 'Acacia queen bed', zh: '次卧B · 相思木床' });
  return autoCollider(root);
}

// =====================================================================================================================
// bedPine — bedroom 3 (g35/g32): solid natural pine queen frame (TARVA-like) — square posts, slatted headboard with a
// centre spacer under the top rail, wide side rails with bolt heads, low footboard posts.
function bedPine() {
  const P = mats.pineBoard(), root = new THREE.Group(), parts = [];
  const W = 1.62, D = 2.10, z0 = -D / 2, z1 = D / 2, post = 0.068;
  const hz = z0 + post / 2, inner = W - 2 * post;
  for (const s of [-1, 1]) parts.push(wood(post, 1.00, post, P, { x: s * (W / 2 - post / 2), y: 0, z: hz, bottom: true, along: 1, seed: 1 + s, r: 0.005 }));
  for (const s of [-1, 1]) parts.push(wood(post, 0.44, post, P, { x: s * (W / 2 - post / 2), y: 0, z: z1 - post / 2, bottom: true, along: 1, seed: 4 + s, r: 0.005 }));
  // headboard rails: top rail + three slats, a short centre spacer in the top gap
  const railY = [[0.93, 0.07], [0.80, 0.06], [0.665, 0.06], [0.53, 0.06]];
  railY.forEach(([y, h], i) => parts.push(wood(inner + 0.02, h, 0.022, P, { x: 0, y, z: hz, bottom: true, along: 0, seed: 10 + i, r: 0.004 })));
  parts.push(wood(0.06, 0.07, 0.022, P, { x: 0, y: 0.86, z: hz, bottom: true, along: 1, seed: 15 }));
  // side rails + foot rail (wide boards)
  for (const s of [-1, 1]) parts.push(wood(0.024, 0.15, D - 2 * post + 0.01, P, { x: s * (W / 2 - 0.016), y: 0.20, z: 0, bottom: true, along: 2, seed: 20 + s, r: 0.004 }));
  parts.push(wood(inner + 0.01, 0.15, 0.024, P, { x: 0, y: 0.20, z: z1 - post / 2, bottom: true, along: 0, seed: 24, r: 0.004 }));
  root.add(merge(parts, P));
  for (const s of [-1, 1]) for (const zz of [z0 + post + 0.02, z1 - post - 0.02]) root.add(cyl(0.008, 0.008, 0.004, M.blackSteel(), { seg: 12, rz: PI / 2, x: s * (W / 2 + 0.002), y: 0.275, z: zz }));
  root.add(box(W - 0.08, 0.02, D - 0.15, M.lumber(), { y: 0.30, bottom: true })); // slats (hidden)
  bedding(root, { mw: 1.52, mdp: 2.0, mh: 0.22, y: 0.32, z0: z0 + post + 0.005, duvet: false, throwMat: mats.throwCream(), throwSide: 1, seed: 40, ledge: { x0: -W / 2, x1: W / 2, z0: z0, z1: z1 - 0.001, y: 0.35 } });
  addSeat(root, { x: 0.68, y: 0.54, z: 0.1, facing: PI / 2, kind: 'bed' });
  describe(root, { id: 'bedPine', name: 'Natural pine queen bed', zh: '次卧3 · 松木床' });
  return autoCollider(root);
}

// =====================================================================================================================
// Rattan egg lamp (open diamond weave) — g27/g33/g35.
function eggLamp({ y = 0, h = 0.30, r = 0.11 } = {}) {
  const g = new THREE.Group();
  g.add(cyl(0.045, 0.05, 0.018, mats.chrome(), { seg: 24, y, bottom: true }));
  g.add(cyl(0.006, 0.006, 0.06, mats.chrome(), { seg: 8, y: y + 0.018, bottom: true }));
  const prof = []; for (let i = 0; i <= 18; i++) { const t = i / 18; const rr = r * Math.pow(Math.sin(PI * (0.06 + 0.88 * t)), 0.85) * (1 - 0.18 * (t - 0.42)); prof.push([Math.max(0.02, rr), y + 0.03 + t * h]); }
  g.add(lathe(prof, mats.rattanLattice(), { seg: 40 }));
  const bulbY = y + 0.03 + h * 0.42;
  g.add(sphere(0.028, mats.bulb(), { seg: 16, y: bulbY }));
  g.userData.bulbY = bulbY; return g;
}

// nightstandPine — 0.50 × 0.40 × 0.58: square legs, top, drawer with wooden knob, slatted lower shelf; egg lamp.
function nightstandPine() {
  const P = mats.pineBoard(), root = new THREE.Group(), parts = [];
  const W = 0.50, D = 0.40, H = 0.58, l = 0.035;
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) parts.push(wood(l, H - 0.02, l, P, { x: sx * (W / 2 - l / 2 - 0.01), z: sz * (D / 2 - l / 2 - 0.01), y: 0, bottom: true, along: 1, seed: 3 + sx + 2 * sz }));
  parts.push(wood(W, 0.022, D, P, { y: H - 0.022, bottom: true, along: 0, seed: 9, r: 0.004 }));
  // drawer box: bottom board + side panels + back
  parts.push(wood(W - 0.03, 0.015, D - 0.03, P, { y: 0.30, bottom: true, along: 0, seed: 11 }));
  parts.push(wood(W - 0.03, 0.015, D - 0.03, P, { y: 0.44, bottom: true, along: 0, seed: 12 }));
  for (const s of [-1, 1]) parts.push(wood(0.012, 0.125, D - 0.07, P, { x: s * (W / 2 - 0.021), y: 0.315, bottom: true, along: 2, seed: 13 + s }));
  parts.push(wood(W - 0.07, 0.125, 0.012, P, { y: 0.315, z: -(D / 2 - 0.021), bottom: true, along: 0, seed: 16 }));
  parts.push(wood(W - 0.085, 0.118, 0.018, P, { y: 0.3185, z: D / 2 - 0.02, bottom: true, along: 0, seed: 17, r: 0.003 })); // drawer front
  // slatted bottom shelf on two rails
  for (const s of [-1, 1]) parts.push(wood(0.015, 0.03, D - 0.06, P, { x: s * (W / 2 - 0.035), y: 0.07, bottom: true, along: 2, seed: 18 + s }));
  for (let i = 0; i < 6; i++) parts.push(wood(W - 0.07, 0.012, 0.042, P, { y: 0.1, z: -D / 2 + 0.06 + i * ((D - 0.12) / 5), bottom: true, along: 0, seed: 22 + i, r: 0.002, seg: 1 }));
  // side stretchers
  for (const s of [-1, 1]) parts.push(wood(0.015, 0.03, D - 0.06, P, { x: s * (W / 2 - 0.028), y: 0.52, bottom: true, along: 2, seed: 30 + s }));
  root.add(merge(parts, P));
  const knob = lathe([[0, 0], [0.013, 0], [0.016, 0.006], [0.011, 0.014], [0.009, 0.02], [0.0005, 0.022]], P, { seg: 16 });
  knob.rotation.x = PI / 2; knob.position.set(0, 0.378, D / 2 - 0.011); root.add(knob);
  const lamp = eggLamp({ y: H, h: 0.30, r: 0.11 }); lamp.position.set(0.04, 0, -0.02); root.add(lamp);
  root.userData.light = { type: 'point', x: 0.04, y: lamp.userData.bulbY, z: -0.02, intensity: 0.8, color: 0xffd9a0, distance: 3 };
  describe(root, { id: 'nightstandPine', name: 'Pine nightstand with rattan egg lamp', zh: '松木床头柜 + 藤编台灯' });
  return autoCollider(root);
}

// =====================================================================================================================
// dresserDark — bedroom 3 (g35): weathered charcoal 5-drawer chest, square black knobs set on the diagonal, slim legs.
function dresserDark() {
  const C = mats.charcoal(), root = new THREE.Group(), parts = [];
  const W = 0.80, D = 0.45, H = 1.20, legH = 0.11;
  parts.push(wood(W, 0.03, D, C, { y: H - 0.03, bottom: true, along: 0, seed: 1, r: 0.008 }));
  for (const s of [-1, 1]) parts.push(wood(0.025, H - legH - 0.03, D - 0.02, C, { x: s * (W / 2 - 0.0125 - 0.005), y: legH, z: -0.005, bottom: true, along: 1, seed: 2 + s }));
  parts.push(wood(W - 0.02, 0.025, D - 0.02, C, { y: legH, z: -0.005, bottom: true, along: 0, seed: 5 }));
  parts.push(wood(W - 0.04, H - legH - 0.03, 0.012, C, { y: legH, z: -D / 2 + 0.006, bottom: true, along: 1, seed: 6 }));
  const n = 5, y0 = legH + 0.025, span = H - 0.03 - y0, dh = span / n;
  for (let i = 0; i < n; i++) {
    parts.push(wood(W - 0.058, dh - 0.008, 0.022, C, { y: y0 + i * dh + 0.004, z: D / 2 - 0.016, bottom: true, along: 0, seed: 10 + i, r: 0.008, seg: 3 }));
    root.add(box(0.03, 0.03, 0.016, M.blackSteel(), { x: 0, y: y0 + i * dh + dh / 2, z: D / 2 - 0.0, rz: PI / 4, r: 0.003, seg: 1 }));
  }
  root.add(merge(parts, C));
  // slim tapered legs, dark, splayed a touch
  const legMat = M.blackMatte();
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { const l = cyl(0.014, 0.009, legH, legMat, { seg: 4, y: legH / 2, ry: PI / 4 }); l.scale.set(1.4, 1, 1.4); const g = new THREE.Group(); g.add(l); g.position.set(sx * (W / 2 - 0.035), 0.0015, sz * (D / 2 - 0.04)); g.rotation.set(sz * 0.05, 0, -sx * 0.05); root.add(g); }
  describe(root, { id: 'dresserDark', name: 'Charcoal 5-drawer dresser', zh: '炭灰五斗柜' });
  return autoCollider(root);
}

// =====================================================================================================================
// shelfWalnut — primary suite (g27/g28): solid walnut bar/shelf cabinet with cedar plank back; left column has a
// glass-rack cubby over four sloped slatted shelves, right column a cubby, a drawer with a finger notch, two cubbies;
// deep base ledge on chunky block feet. Dried-grass vase on top, magazines on a shelf.
function shelfWalnut() {
  const Wd = mats.walnut(), root = new THREE.Group(), parts = [], back = [];
  const W = 0.80, D = 0.35, H = 1.10, cD = 0.30, side = 0.045, zc = -(D - cD) / 2, baseY = 0.10;
  // feet + base ledge (deeper than the case)
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) parts.push(wood(0.075, baseY, 0.075, Wd, { x: sx * (W / 2 - 0.06), z: sz * (D / 2 - 0.05), bottom: true, along: 1, seed: 2 + sx + sz * 2, r: 0.008 }));
  parts.push(wood(W, 0.045, D, Wd, { y: baseY, bottom: true, along: 0, seed: 7, r: 0.006 }));
  const cy0 = baseY + 0.045;
  for (const s of [-1, 1]) parts.push(wood(side, H - cy0 - 0.03, cD, Wd, { x: s * (W / 2 - side / 2), y: cy0, z: zc, bottom: true, along: 1, seed: 9 + s, r: 0.005 }));
  parts.push(wood(W + 0.01, 0.03, cD + 0.01, Wd, { y: H - 0.03, z: zc, bottom: true, along: 0, seed: 12, r: 0.006 }));
  // centre divider
  const inW = W - 2 * side, xDiv = -W / 2 + side + inW * 0.55;
  parts.push(wood(0.022, H - cy0 - 0.03, cD - 0.02, Wd, { x: xDiv, y: cy0, z: zc + 0.01, bottom: true, along: 1, seed: 13 }));
  // cedar plank back (vertical planks)
  for (let i = 0; i < 5; i++) { const pw = (W - 2 * side) / 5; back.push(wood(pw - 0.003, H - cy0 - 0.03, 0.012, mats.cedarBack(), { x: -W / 2 + side + pw * (i + 0.5), y: cy0, z: -D / 2 + 0.006 + 0.0, bottom: true, along: 1, seed: 40 + i, r: 0.002, seg: 1 })); }
  root.add(merge(back, mats.cedarBack()));
  // left column: flat shelf with lip under the glass-rack cubby, then four sloped slatted shelves
  const lx0 = -W / 2 + side, lx1 = xDiv - 0.011, lw = lx1 - lx0, lxc = (lx0 + lx1) / 2;
  parts.push(wood(lw, 0.02, cD - 0.02, Wd, { x: lxc, y: 0.80, z: zc + 0.01, bottom: true, along: 0, seed: 14 }));
  parts.push(wood(lw, 0.035, 0.018, Wd, { x: lxc, y: 0.80, z: zc + cD / 2 - 0.01, bottom: true, along: 0, seed: 15 }));
  [0.68, 0.54, 0.40, 0.26].forEach((yy, k) => {
    const sh = new THREE.Group();
    for (let i = 0; i < 4; i++) sh.add(wood(lw - 0.004, 0.015, 0.05, Wd, { y: 0, z: -cD / 2 + 0.05 + i * 0.065, along: 0, seed: 60 + k * 5 + i, r: 0.002, seg: 1 }));
    sh.add(wood(lw - 0.004, 0.03, 0.016, Wd, { y: 0.008, z: cD / 2 - 0.035, along: 0, seed: 80 + k })); // front stop
    sh.position.set(lxc, yy, zc); sh.rotation.x = -0.12; sh.updateMatrixWorld(true);
    for (const c of [...sh.children]) { c.applyMatrix4(sh.matrix); parts.push(c); }
  });
  // right column: shelves + drawer
  const rx0 = xDiv + 0.011, rx1 = W / 2 - side, rw = rx1 - rx0, rxc = (rx0 + rx1) / 2;
  for (const [yy, s] of [[0.84, 90], [0.70, 91], [0.47, 92]]) parts.push(wood(rw, 0.02, cD - 0.02, Wd, { x: rxc, y: yy, z: zc + 0.01, bottom: true, along: 0, seed: s }));
  const dr = wood(rw - 0.01, 0.115, 0.02, Wd, { x: rxc, y: 0.722, z: zc + cD / 2 - 0.015, bottom: true, along: 0, seed: 95, r: 0.004 });
  parts.push(dr);
  root.add(merge(parts, Wd));
  // finger notch on the drawer (dark half-disc)
  root.add(cyl(0.017, 0.017, 0.004, M.blackMatte(), { seg: 16, rx: PI / 2, x: rxc, y: 0.837, z: zc + cD / 2 - 0.004 }));
  // glass-rack rails under the top (black steel) in both columns
  for (const [x0, x1] of [[lx0, lx1], [rx0, rx1]]) for (const dz of [-0.09, 0.0, 0.09]) root.add(box(x1 - x0 - 0.01, 0.008, 0.012, M.blackSteel(), { x: (x0 + x1) / 2, y: H - 0.045, z: zc + dz }));
  // magazines on the second slatted shelf, a book in the right cubby
  root.add(book(0.24, 0.02, 0.30, 0x3f6f8a, { x: lxc - 0.02, y: 0.425, z: zc + 0.01, ry: 0.02 }).rotateX(-0.12));
  root.add(book(0.22, 0.03, 0.17, 0x6b5a45, { x: rxc, y: 0.49, z: zc + 0.02, ry: -0.05 }));
  // vase with dried grasses on top
  const vy = H; const vase = lathe([[0, 0], [0.045, 0], [0.065, 0.06], [0.072, 0.13], [0.06, 0.2], [0.04, 0.245], [0.035, 0.255], [0.042, 0.27], [0.036, 0.27], [0.03, 0.25]], mats.vase(), { seg: 32, x: 0.18, y: vy, z: zc + 0.01 });
  root.add(vase);
  const R = rng(5);
  for (let i = 0; i < 14; i++) {
    const a = R() * PI * 2, lean = 0.12 + R() * 0.38, L = 0.2 + R() * 0.14, bx = 0.18, by = vy + 0.24, bz = zc + 0.01;
    const tx = bx + Math.cos(a) * Math.sin(lean) * L, ty = by + Math.cos(lean) * L, tz = bz + Math.sin(a) * Math.sin(lean) * L;
    root.add(tube([[bx, by, bz], [(bx + tx) / 2 + 0.01, (by + ty) / 2, (bz + tz) / 2], [tx, ty, tz]], 0.0018, mats.driedGrass(), { seg: 8, radial: 4 }));
    const plume = sphere(0.018, mats.driedGrass(), { seg: 8, x: tx, y: ty, z: tz, sx: 0.7, sy: 2.4, sz: 0.7 }); plume.rotation.set(Math.sin(a) * lean, 0, -Math.cos(a) * lean); root.add(plume);
  }
  describe(root, { id: 'shelfWalnut', name: 'Walnut shelf / bar cabinet', zh: '胡桃木格子柜' });
  return autoCollider(root);
}

// =====================================================================================================================
// consoleDark — bedroom B (g33): espresso console/desk: three-part lift top, two drawers + centre flap with small
// knobs, moulded skirt, block capitals over gently flared legs, long low stretcher.
function consoleDark() {
  const E = mats.espresso(), root = new THREE.Group(), parts = [];
  const W = 1.20, D = 0.42, H = 0.80;
  // case + lids
  parts.push(wood(W - 0.05, 0.13, D - 0.05, E, { y: H - 0.15, bottom: true, along: 0, seed: 1, r: 0.006 }));
  const lids = [[-0.6 + 0.025, -0.33], [-0.325, 0.325], [0.33, 0.6 - 0.025]];
  lids.forEach(([a, b], i) => parts.push(wood(b - a - 0.004, 0.022, D - 0.03, E, { x: (a + b) / 2, y: H - 0.022, bottom: true, along: 0, seed: 3 + i, r: 0.006 })));
  lids.forEach(([a, b], i) => parts.push(wood(b - a - 0.02, 0.095, 0.016, E, { x: (a + b) / 2, y: H - 0.135, z: D / 2 - 0.022, bottom: true, along: 0, seed: 7 + i, r: 0.004 })));
  // moulded skirt (two stepped rounded boards)
  parts.push(wood(W - 0.02, 0.022, D - 0.01, E, { y: H - 0.175, bottom: true, along: 0, seed: 11, r: 0.01 }));
  parts.push(wood(W - 0.06, 0.03, D - 0.05, E, { y: H - 0.205, bottom: true, along: 0, seed: 12, r: 0.008 }));
  // legs: capital block + flared leg (extruded side profile)
  const legH = H - 0.205, prof = [[-0.022, 0], [0.012, 0], [0.018, 0.04], [0.02, 0.2], [0.022, legH - 0.10], [0.024, legH - 0.10], [0.024, legH], [-0.024, legH], [-0.024, legH - 0.10], [-0.022, legH - 0.10], [-0.02, 0.2], [-0.028, 0.06], [-0.04, 0.0]];
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const l = extrude(prof.map(([x, y]) => [-x * sx, y]), 0.045, E, { bevel: 0.003 });
    l.position.set(sx * (W / 2 - 0.06), 0.003, sz * (D / 2 - 0.06) - 0.0225); l.updateMatrix();
    projectUV2(l.geometry); parts.push(l);
    parts.push(wood(0.065, 0.11, 0.065, E, { x: sx * (W / 2 - 0.06), y: legH - 0.11, z: sz * (D / 2 - 0.06), bottom: true, along: 1, seed: 20 + sx + sz, r: 0.006 }));
  }
  // stretchers
  for (const s of [-1, 1]) parts.push(wood(0.03, 0.035, D - 0.15, E, { x: s * (W / 2 - 0.06), y: 0.22, bottom: true, along: 2, seed: 30 + s }));
  parts.push(wood(W - 0.15, 0.035, 0.03, E, { y: 0.22, z: 0, bottom: true, along: 0, seed: 33 }));
  root.add(merge(parts, E));
  for (const x of [-0.46, 0.46]) root.add(box(0.022, 0.022, 0.014, mats.brass(), { x, y: H - 0.087, z: D / 2 - 0.006, rz: PI / 4, r: 0.004, seg: 1 }));
  describe(root, { id: 'consoleDark', name: 'Dark wood console desk', zh: '深色木书桌/玄关桌' });
  return autoCollider(root);
}
// ExtrudeGeometry UVs are shape coordinates in metres; rotate so grain runs up the leg.
function projectUV2(geo) { const uv = geo.attributes.uv, p = geo.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) + p.getZ(i), p.getY(i) / 1.1); uv.needsUpdate = true; }

// =====================================================================================================================
// louverDoors — primary closet (g27/g28): two natural-pine louvered bifold doors (four 0.30 m leaves), real slats.
// Origin at the floor centre of the opening; door face toward +Z. userData.setOpen(f) folds them (0 closed … 1 open).
function louverDoors() {
  const P = mats.pineBoard(), root = new THREE.Group();
  const W = 1.20, H = 2.10, T = 0.035, lw = 0.30, stile = 0.042, topR = 0.07, midR = 0.09, botR = 0.11, midY = 0.92;
  // one leaf in its own local frame: x from 0 to lw, hinge at x = 0
  const leafGeo = (() => {
    const fr = [], sl = [];
    fr.push(wood(stile, H - 0.006, T, P, { x: stile / 2, y: 0.003, bottom: true, along: 1, seed: 1, r: 0.003 }));
    fr.push(wood(stile, H - 0.006, T, P, { x: lw - stile / 2 - 0.003, y: 0.003, bottom: true, along: 1, seed: 2, r: 0.003 }));
    const rw = lw - 2 * stile - 0.003, rx = stile + rw / 2;
    fr.push(wood(rw, topR, T, P, { x: rx, y: H - topR - 0.003, bottom: true, along: 0, seed: 3, r: 0.002 }));
    fr.push(wood(rw, midR, T, P, { x: rx, y: midY, bottom: true, along: 0, seed: 4, r: 0.002 }));
    fr.push(wood(rw, botR, T, P, { x: rx, y: 0.003, bottom: true, along: 0, seed: 5, r: 0.002 }));
    const pitch = 0.02, sw = 0.03, tilt = 35 * PI / 180; // 0.03 wide so neighbouring slats overlap (no see-through)
    for (const [ya, yb] of [[0.003 + botR, midY], [midY + midR, H - topR - 0.003]]) {
      const n = Math.floor((yb - ya - 0.006) / pitch);
      for (let i = 0; i < n; i++) { const s = wood(rw + 0.01, 0.0045, sw, P, { x: rx, y: ya + 0.006 + (i + 0.5) * ((yb - ya - 0.006) / n), z: 0, along: 0, seed: 10 + (i % 7), r: 0, seg: 1 }); s.rotation.x = tilt; sl.push(s); }
    }
    return { frame: merge(fr, P).geometry, slats: merge(sl, P).geometry };
  })();
  const knobGeo = new THREE.LatheGeometry([[0, 0], [0.008, 0], [0.01, 0.01], [0.016, 0.018], [0.014, 0.026], [0.0005, 0.028]].map(([r, h]) => new THREE.Vector2(r, h)), 16);
  const leaves = [];
  const mkLeaf = (knob) => { const g = new THREE.Group(); const f = new THREE.Mesh(leafGeo.frame, vc(P)), s = new THREE.Mesh(leafGeo.slats, vc(P)); for (const m of [f, s]) { m.castShadow = m.receiveShadow = true; g.add(m); } if (knob) { const k = new THREE.Mesh(knobGeo, P); k.rotation.x = PI / 2; k.position.set(knob, 1.0, T / 2); k.castShadow = true; g.add(k); } return g; };
  // door = jamb leaf (pivot at the jamb) + lead leaf (hinged to it). side -1 = left door, +1 = right door
  for (const side of [-1, 1]) {
    const jamb = new THREE.Group(); jamb.position.set(side * W / 2, 0, 0);
    const l1 = mkLeaf(null); if (side > 0) { l1.scale.x = -1; } jamb.add(l1);
    const hinge = new THREE.Group(); hinge.position.set(-side * lw, 0, 0); jamb.add(hinge);
    const l2 = mkLeaf(lw - 0.05); if (side > 0) l2.scale.x = -1; l2.position.x = 0; hinge.add(l2);
    if (side < 0) { l1.position.x = 0; } // leaf geometry extends +x from its hinge for the left door
    root.add(jamb); leaves.push({ jamb, hinge, side });
  }
  // frame/jamb trim in pine (as in g28)
  const trim = [wood(0.05, H + 0.05, 0.02, P, { x: -W / 2 - 0.025, y: 0, z: -0.01, bottom: true, along: 1, seed: 50 }), wood(0.05, H + 0.05, 0.02, P, { x: W / 2 + 0.025, y: 0, z: -0.01, bottom: true, along: 1, seed: 51 }), wood(W + 0.10, 0.05, 0.02, P, { y: H + 0.005, z: -0.01, bottom: true, along: 0, seed: 52 })];
  root.add(merge(trim, P));
  root.userData.setOpen = (f) => { for (const { jamb, hinge, side } of leaves) { const a = f * PI * 0.48; jamb.rotation.y = side * a; hinge.rotation.y = -side * 2 * a; } };
  root.userData.setOpen(0);
  describe(root, { id: 'louverDoors', name: 'Pine louvered bifold closet doors', zh: '松木百叶折叠衣柜门' });
  return setCollider(root, { w: W, d: 0.06, x: 0, z: 0, h: H });
}

// =====================================================================================================================
// Rugs: rounded-rectangle extrusions; cap UVs are metres, so 1 texture tile = 1 m.
function rrect(w, d, r) { const pts = []; const q = 6; for (const [cx, cy, a0] of [[w / 2 - r, d / 2 - r, 0], [-w / 2 + r, d / 2 - r, PI / 2], [-w / 2 + r, -d / 2 + r, PI], [w / 2 - r, -d / 2 + r, 1.5 * PI]]) for (let i = 0; i <= q; i++) { const a = a0 + (i / q) * PI / 2; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return pts; }
function rug(w, d, t, mat, uvScale) {
  const m = extrude(rrect(w, d, 0.05), t - 0.004, mat, { bevel: 0.002, rx: -PI / 2, y: 0.002 });
  const uv = m.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvScale, uv.getY(i) * uvScale); uv.needsUpdate = true;
  m.castShadow = false; return m;
}
function rugWhite() { const root = group(rug(2.0, 3.0, 0.02, mats.rugWhite(), 1)); describe(root, { id: 'rugWhite', name: 'Off-white rug with grey diamond pattern', zh: '米白菱格地毯' }); return root; }
function rugCheck() { const root = group(rug(2.0, 2.6, 0.015, M.rugGrey(), 0.5)); describe(root, { id: 'rugCheck', name: 'Grey/white checked rug', zh: '灰白格纹地毯' }); return root; }

// =====================================================================================================================
// sideTableCarved — primary suite (g27): round limewashed table, tray-rim top, beaded apron, four turned fluted legs.
function sideTableCarved() {
  const L = mats.limewash(), root = new THREE.Group(), H = 0.55, R = 0.225;
  const topP = [[0, H - 0.035], [R - 0.01, H - 0.035], [R, H - 0.03], [R + 0.004, H - 0.018], [R, H - 0.006], [R - 0.008, H], [R - 0.03, H], [R - 0.038, H - 0.006], [R - 0.045, H - 0.014], [0, H - 0.014]];
  root.add(lathe(topP, L, { seg: 48 }));
  const apron = [[R - 0.03, H - 0.035], [R - 0.022, H - 0.04], [R - 0.022, H - 0.07], [R - 0.016, H - 0.075], [R - 0.022, H - 0.082], [R - 0.03, H - 0.09], [R - 0.045, H - 0.09], [R - 0.045, H - 0.035]];
  root.add(lathe(apron, L, { seg: 48 }));
  const legP = [[0, 0], [0.017, 0], [0.021, 0.014], [0.015, 0.035], [0.016, 0.06], [0.019, 0.2], [0.022, 0.3], [0.027, 0.33], [0.022, 0.345], [0.026, 0.365], [0.029, 0.39], [0.029, 0.42], [0.033, 0.435], [0.029, 0.45], [0.028, H - 0.05], [0, H - 0.05]];
  const lg = new THREE.LatheGeometry(legP.map(([r, h]) => new THREE.Vector2(r, h)), 16);
  // flutes: pinch every other radial column on the shaft so grooves read
  const p = lg.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y > 0.06 && y < 0.32) { const a = Math.atan2(p.getZ(i), p.getX(i)); const k = 1 - 0.14 * (0.5 + 0.5 * Math.cos(a * 8)); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); } }
  lg.computeVertexNormals();
  for (let i = 0; i < 4; i++) { const a = PI / 4 + i * PI / 2; const m = new THREE.Mesh(lg, L); m.position.set(Math.cos(a) * (R - 0.05), 0, Math.sin(a) * (R - 0.05)); m.castShadow = m.receiveShadow = true; root.add(m); }
  describe(root, { id: 'sideTableCarved', name: 'Limewashed carved round side table', zh: '白洗雕花圆边几' });
  return autoCollider(root);
}

export const items = {
  bedWhitewash, bedAcacia, bedPine, nightstandPine, dresserDark, shelfWalnut, consoleDark, louverDoors, rugWhite, rugCheck, sideTableCarved,
};
