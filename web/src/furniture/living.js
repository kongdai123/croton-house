// living — 2513 Croton Ave living room: caramel leather sofa, round white-oak coffee table, the owner's hand-built
// window seat (towers + slatted alcove + cubby bench), jute rug, small pine side bench, spare pillows.
// Frame per kit.js: origin on the floor at the footprint centre, +Z = front.
import { THREE, M, cyl, lathe, extrude, group, addSeat, setMovable, setCollider, autoCollider, describe, shadow } from '../kit.js';
import { rng, metricUV, pineTexture, bake, weaveMaps, wbox, wspan, blob, blobEquator, pipe, rrect, rrectXZ, bookRow, bookStack } from './living_parts.js';

const once = (fn) => { let v; return () => (v ??= fn()); };
const tint = (base, k, props = {}) => { const m = base.clone(); m.color.multiplyScalar(k); Object.assign(m, props); return m; };

// local materials (derived from the shared library)
// Caramel aniline leather: M.leatherTan's scan albedo is a dark oxblood, so keep its normal/roughness/AO and set
// the colour to the photos' caramel; seat cushions 6% darker.
const leatherCaramel = once(() => { const m = M.leatherTan().clone(); m.map = null; m.color.set(0x9c642f); m.normalScale = new THREE.Vector2(0.35, 0.35); m.roughness = 0.62; return m; });
const leatherSeat = once(() => tint(leatherCaramel(), 0.94));
const brushedSteel = once(() => new THREE.MeshStandardMaterial({ color: 0xd6d2cc, roughness: 0.4, metalness: 1 }));
const juteBind = once(() => tint(juteChunky(), 0.94));
const linenWelt = once(() => new THREE.MeshPhysicalMaterial({ color: 0xd8d1c3, roughness: 0.95, sheen: 0.4, sheenColor: new THREE.Color(0xffffff) }));
const clothWeave = once(() => { const w = weaveMaps({ kind: 'plain', cells: 48, strength: 2 }); w.normal.repeat.set(12, 12); return w.normal; });   // ~1.7 mm threads
const pillowWhite = once(() => new THREE.MeshPhysicalMaterial({ color: 0xfbfaf7, roughness: 0.92, sheen: 0.7, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffffff), normalMap: clothWeave(), normalScale: new THREE.Vector2(0.5, 0.5) }));
const linenCushion = once(() => { const m = M.linen().clone(); m.normalMap = clothWeave(); m.normalScale = new THREE.Vector2(0.45, 0.45); return m; });
// Chunky jute: M.jute's fibre scan plus a basket-weave relief (blocks ~2.5 cm) for the photos' chunky weave.
const juteChunky = once(() => { const m = M.jute().clone(), w = weaveMaps({ kind: 'basket', cells: 12, strength: 4 }); for (const t of [w.normal, w.ao, w.color]) t.repeat.set(5.5, 5.5); m.normalMap = w.normal; m.aoMap = w.ao; m.aoMapIntensity = 0.65; m.normalScale = new THREE.Vector2(1.1, 1.1); m.map = w.color; m.color.set(0xe1d5b7); return m; });
const ruffleBlack = once(() => new THREE.MeshStandardMaterial({ color: 0x161514, roughness: 0.8 }));
// Pine for the owner's built-ins: pale blond (towers/bench), warmer slats, honey solid-wood sill and side bench.
// (The shared M.pineWhitewash / M.plywoodSlats read as chalk-white with blotchy waves next to the photos.)
const pineBlond = once(() => new THREE.MeshStandardMaterial({ map: pineTexture({ base: '#ebdbc1', late: '#cdab82', seed: 3, contrast: 0.95 }), roughness: 0.62 }));
// Pale natural pine, as in g08–g10 (the earlier golden tones read as mustard once the room was exposed like the photos).
const slatVariants = once(() => [['#ecdcc3', '#cfae86', 8], ['#efe0c9', '#d3b48e', 9], ['#e9d8bd', '#caa880', 10]].map(([base, late, seed]) => new THREE.MeshStandardMaterial({ map: pineTexture({ base, late, seed, contrast: 0.95 }), roughness: 0.6 })));
const pineSlat = (i = 0) => slatVariants()[((i % 3) + 3) % 3];
const pineHoney = once(() => new THREE.MeshStandardMaterial({ map: pineTexture({ base: '#e6bd80', late: '#b07434', seed: 5, contrast: 1.2, rings: 40 }), roughness: 0.5 }));
const dryGrass = once(() => new THREE.MeshStandardMaterial({ color: 0x72765c, roughness: 0.9, side: THREE.DoubleSide }));

// ---------------------------------------------------------------------------------------------------------------
// SOFA 2.15 × 0.92 × 0.80. Slim square arms (0.12 w, 0.60 h), base rail, deck, 3 seat + 3 back cushions, piping,
// tapered brushed-steel legs 0.14.
function sofa() {
  const W = 2.15, D = 0.92, LEG = 0.14, ARM = 0.12, zF = D / 2, zB = -D / 2, BACK_T = 0.16;
  const L = leatherCaramel(), LS = leatherSeat(), root = new THREE.Group();
  const lbox = (w, h, d, x, y, z, r = 0.022, mat = L) => { const m = wbox(w, h, d, mat, { r, seg: 3, x, y, z, tile: 0.55, grain: 0, off: [x, y] }); return m; };
  const inner = W - 2 * ARM, zBackFront = zB + BACK_T;
  // back frame (full width, square top) with vertical panel seams on the rear
  root.add(lbox(W, 0.62 - LEG, BACK_T, 0, (LEG + 0.62) / 2, zB + BACK_T / 2, 0.025));
  root.add(pipe(rrectXZ(W - 0.02, BACK_T - 0.02, 0.012, 0.62 - 0.012).map(([x, y, z]) => [x, y, z + zB + BACK_T / 2]), 0.0045, L, { seg: 120 }));
  for (const sx of [-0.36, 0.36]) root.add(pipe([[sx, LEG + 0.03, zB + 0.0015], [sx, 0.6, zB + 0.0015]], 0.0028, L, { closed: false, seg: 4, radial: 5 }));
  // arms
  for (const s of [-1, 1]) {
    const ax = s * (W / 2 - ARM / 2), ad = zF - zBackFront;
    root.add(lbox(ARM, 0.60 - LEG, ad, ax, (LEG + 0.60) / 2, zBackFront + ad / 2, 0.025));
    const loop = rrectXZ(ARM - 0.016, ad - 0.016, 0.01, 0.60 - 0.01).map(([x, y, z]) => [x + ax, y, z + zBackFront + ad / 2]);
    root.add(pipe(loop, 0.0045, L, { seg: 110 }));
  }
  // base rail + seat deck between the arms
  root.add(lbox(inner, 0.10, zF - zBackFront, 0, LEG + 0.05, (zF + zBackFront) / 2, 0.018));
  root.add(lbox(inner - 0.004, 0.08, zF - zBackFront - 0.02, 0, LEG + 0.10 + 0.04, (zF + zBackFront) / 2 - 0.01, 0.02, LS));
  // seat cushions (top 0.45, 0.13 thick, puffed, welt at the equator)
  const cw = (inner - 0.012) / 3, cd = zF - 0.006 - (zBackFront + 0.01), cz = (zF - 0.006 + zBackFront + 0.01) / 2;
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * (cw + 0.004), c = blob(cw / 2, 0.062, cd / 2, LS, { e1: 0.42, e2: 0.14, puff: 0.07, uvTile: 0.55 });
    c.position.set(x, 0.45 - 0.066, cz); root.add(c);
    const w = pipe(blobEquator(cw / 2, cd / 2, { e2: 0.14, grow: 0.001 }), 0.0042, LS, { seg: 140 }); w.position.copy(c.position); root.add(w);
    addSeat(root, { x: (i - 1) * 0.7, y: 0.45, z: 0.1, facing: 0, kind: 'sofa' });
  }
  // loose back cushions, leaning ~10° against the back frame
  const lean = 0.17, bw = (inner - 0.03) / 3, bh = 0.355, bt = 0.085;
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    g.add(creased(blob(bw / 2, bt, bh / 2, L, { e1: 0.65, e2: 0.24, puff: 0.18, thin: 0.25, ws: 64, hs: 32, uvTile: 0.55 }), i + 3));
    g.add(pipe(blobEquator(bw / 2, bh / 2, { e2: 0.16, grow: 0.001 }), 0.0042, L, { seg: 130 }));
    g.rotation.x = Math.PI / 2 - lean;
    g.position.set((i - 1) * (bw + 0.012), 0.435 + bh / 2 * Math.cos(lean) + 0.01, zBackFront + bt + 0.02);
    root.add(g);
  }
  // tapered brushed-steel legs, splayed slightly outward
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    // geometry baked in place so its bounds are exact: top plate under the frame, leg splayed ~6° each way
    const rot = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-sz * 0.1, 0, sx * 0.1));
    const g = new THREE.CylinderGeometry(0.017, 0.0085, LEG, 20).translate(0, -LEG / 2, 0).applyMatrix4(rot);
    g.computeBoundingBox(); g.translate(sx * (W / 2 - 0.07), LEG - (LEG + g.boundingBox.min.y), sz * (D / 2 - 0.07));
    root.add(shadow(new THREE.Mesh(g, brushedSteel())));
    root.add(cyl(0.024, 0.024, 0.006, brushedSteel(), { x: sx * (W / 2 - 0.07), y: LEG - 0.003, z: sz * (D / 2 - 0.07), seg: 20 }));
  }
  // hidden centre support glide
  root.add(cyl(0.02, 0.016, LEG, M.blackMatte(), { bottom: true, z: -0.1, seg: 12 }));
  return autoCollider(describe(bake(root), { id: 'living-sofa', name: 'Caramel leather sofa', zh: '焦糖色皮沙发' }));
}

// ---------------------------------------------------------------------------------------------------------------
// COFFEE TABLE: low white oak Ø1.15 × 0.30, thin round top on a three-fin pedestal.
function coffeeTable() {
  const R = 0.575, H = 0.30, T = 0.028, root = new THREE.Group(), oak = M.oak().clone(); oak.color.set(0xfff5df);
  const y0 = H - T, prof = [[0, y0], [R - 0.009, y0], [R - 0.002, y0 + 0.003], [R, y0 + T / 2], [R - 0.002, H - 0.003], [R - 0.009, H], [0, H]];
  const top = lathe(prof, oak, { seg: 72 });
  { const p = top.geometry.attributes.position, uv = top.geometry.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) + 0.13, p.getZ(i) + 0.4); }
  root.add(top);
  for (let k = 0; k < 3; k++) {
    const a = Math.PI / 2 + k * Math.PI * 2 / 3;
    root.add(wbox(0.32, y0, 0.045, oak, { r: 0.004, x: Math.cos(a) * 0.16, y: y0 / 2, z: Math.sin(a) * 0.16, ry: -a, grain: 1 }));
  }
  return autoCollider(describe(bake(root), { id: 'living-coffee-table', name: 'Low round oak coffee table', zh: '低矮橡木圆茶几' }));
}

// ---------------------------------------------------------------------------------------------------------------
// WINDOW SEAT (hero): asymmetric 2.95 × 0.62 × 2.23. Wall plane at z = -0.31, faces +Z.
// Towers 0.32 × 0.40 at both ends (solid front, 6 cubbies open to the OUTER side as in the owner's photos),
// bench 2.31 × 0.60 with open cubbies below a 0.46 seat, linen cushion + 3 pillows, horizontal pine slats from the
// seat to the top on the back wall and on the tower sides facing the bench, a 1.84 × 1.22 window hole (sill 0.95)
// with 0.03 pine reveal boards and a 0.04 solid-wood sill overhanging 0.03.
const WS = { W: 3.30, right: 1.30, H: 2.23, zWall: -0.31, TW: 0.32, TD: 0.40, P: 0.03, seatTop: 0.46, BAYS: 4,
  win: { w: 1.84, h: 1.22, sill: 0.95 }, slatH: 0.09, slatGap: 0.004, slatT: 0.02, capY: 2.20 };

function tower(side, seedBase) {
  // side = -1 (left, open to -X) or +1 (right, open to +X). Built in absolute window-seat coordinates.
  const { W, H, zWall, TW, TD, P } = WS, g = new THREE.Group(), wood = pineBlond();
  const extent = side < 0 ? W / 2 : WS.right, xo = side * extent, xi = side * (extent - TW);         // outer edge (open side), inner edge (bench side)
  const zF = zWall + TD, lo = Math.min(xo, xi), hi = Math.max(xo, xi);
  const xPanelIn = xi + side * WS.slatT;                       // inner structural panel sits behind the slat cladding
  let s = seedBase;
  g.add(wspan([lo, 0, zF - P], [hi, H, zF], wood, { seed: s++, grain: 1 }));                       // solid front
  g.add(wspan([Math.min(xPanelIn, xPanelIn + side * P), 0, zWall], [Math.max(xPanelIn, xPanelIn + side * P), H, zF - P], wood, { seed: s++, grain: 1 })); // inner panel
  g.add(wspan([Math.min(xPanelIn + side * P, xo), 0, zWall], [Math.max(xPanelIn + side * P, xo), H, zWall + P], wood, { seed: s++, grain: 1 })); // back
  const sx0 = Math.min(xPanelIn + side * P, xo), sx1 = Math.max(xPanelIn + side * P, xo);
  const lev = []; for (let k = 0; k <= 6; k++) lev.push(k * (H - P) / 6);
  for (const y of lev) g.add(wspan([sx0, y, zWall + P], [sx1, y + P, zF - P], wood, { seed: s++, grain: 2, r: 0.003 }));
  // filler under the seat between bench end and tower panel
  g.add(wspan([Math.min(xi, xPanelIn), 0, zWall], [Math.max(xi, xPanelIn), WS.seatTop, zF - P], wood, { seed: s++, grain: 1, r: 0.002 }));
  // contents of the cubbies (books with spines facing out of the open side, a vase, a bowl)
  const cub = (k) => lev[k] + P;                                 // floor of cubby k (0 = bottom)
  const cubX = (sx0 + sx1) / 2, depth = sx1 - sx0, opening = side;  // spines point toward the open side
  const put = (obj, k, zc, dx = 0) => { obj.rotation.y = opening * Math.PI / 2; obj.position.set(xo - side * (0.012 + dx), cub(k), zc); g.add(obj); };
  const rowStart = side > 0 ? zF - P - 0.03 : zWall + P + 0.03;
  const fill = side < 0 ? [0, 1, 3, 4] : [0, 2, 3, 5];
  put(bookStack(5, seedBase + 1, ['black', 'cream', 'white', 'navy']), fill[0], zWall + 0.2);
  { const r = bookRow(0.24, seedBase + 2, ['cream', 'white', 'red', 'navy', 'black'], { hMax: 0.26, dMax: 0.2 }); put(r, fill[1], rowStart); }
  { const r = bookRow(0.17, seedBase + 3, ['black', 'grey', 'white'], { hMin: 0.2, hMax: 0.25, lean: 0.25 }); put(r, fill[2], rowStart); }
  { const v = vase(seedBase % 2 ? 0.075 : 0.065, seedBase % 2 ? 0.2 : 0.17); v.position.set(cubX + side * 0.02, cub(fill[3]), zWall + 0.2); g.add(v); }
  void depth;
  return g;
}

function vase(rMax = 0.07, h = 0.18, mat = M.ceramicSpeckle()) {
  const p = [[0, 0], [rMax * 0.55, 0], [rMax * 0.62, 0.006], [rMax * 0.9, h * 0.25], [rMax, h * 0.5], [rMax * 0.88, h * 0.72], [rMax * 0.52, h * 0.88], [rMax * 0.42, h * 0.95], [rMax * 0.46, h], [rMax * 0.4, h], [rMax * 0.35, h * 0.9]];
  return lathe(p, mat, { seg: 28 });
}

function windowSeat() {
  const { W, H, zWall, TW, TD, P, seatTop, BAYS, win, slatH, slatGap, slatT, capY } = WS;
  const root = new THREE.Group(), wood = pineBlond(), pine = pineHoney();
  const xIn = W / 2 - TW, xR = WS.right - TW, mid = (xR - xIn) / 2;                                         // 1.33: inner faces of the towers
  root.add(tower(-1, 100), tower(1, 200));
  // ---- bench: recessed plinth, bottom, top, ends, back, dividers (BAYS open cubbies)
  const zb0 = zWall + slatT, zb1 = zb0 + 0.60;
  let s = 300;
  root.add(wspan([-xIn + 0.07, 0, zb0 + 0.02], [xR - 0.07, 0.06, zb1 - 0.07], wood, { seed: s++, r: 0.003 }));
  root.add(wspan([-xIn, 0.06, zb0], [xR, 0.06 + P, zb1], wood, { seed: s++ }));
  root.add(wspan([-xIn, seatTop - P, zb0], [xR, seatTop, zb1], wood, { seed: s++, r: 0.005 }));
  root.add(wspan([-xIn, 0.06 + P, zb0], [xR, seatTop - P, zb0 + P], wood, { seed: s++ }));
  const bay = (xIn + xR - (BAYS + 1) * P) / BAYS, xs = [];
  for (let k = 0; k <= BAYS; k++) { const x = -xIn + k * (bay + P); xs.push(x); root.add(wspan([x, 0.06 + P, k === 0 || k === BAYS ? zb0 : zb0 + P], [x + P, seatTop - P, zb1], wood, { seed: s++, grain: 1, r: 0.003 })); }
  // books in the bench bays (as in the listing photo: upright black sets, mixed stacks, magazines)
  const yb = 0.06 + P, zFront = zb1 - 0.035;
  const addAt = (o, x, z = zFront) => { o.position.set(x, yb, z); root.add(o); };
  addAt(bookRow(0.32, 11, ['black', 'black', 'black', 'grey'], { hMin: 0.24, hMax: 0.28, dMin: 0.17, dMax: 0.2 }), xs[0] + P + 0.05);
  addAt(bookRow(0.2, 12, ['black', 'black', 'navy'], { hMin: 0.23, hMax: 0.27, lean: 0.3 }), xs[1] + P + 0.03);
  addAt(bookStack(4, 13, ['white', 'black', 'cream', 'tan']), xs[1] + P + 0.37);
  addAt(bookStack(6, 14, ['white', 'cream', 'red', 'white']), xs[2] + P + 0.18);
  addAt(bookStack(3, 15, ['red', 'white', 'cream']), xs[2] + P + 0.37);
  if (BAYS > 3) { addAt(bookStack(9, 16, ['navy', 'black', 'grey', 'white'], { wMin: 0.2, wMax: 0.26 }), xs[3] + P + 0.38); addAt(bookStack(2, 17, ['cream', 'tan']), xs[3] + P + 0.15); }
  // ---- slat cladding on the back wall between the towers (cut around the window)
  const wx = win.w / 2 + 0.005, sill0 = win.sill - 0.04, sill1 = win.sill, head = win.sill + win.h, rev = 0.03, headTop = head + rev;
  const n = Math.round((capY - seatTop) / (slatH + slatGap)), pitch = (capY - seatTop) / n, bh = pitch - slatGap;
  const holeX0 = -wx - rev, holeX1 = wx + rev, holeY0 = sill0, holeY1 = headTop;
                     // plank lines of the texture land in the gaps
  for (let i = 0; i < n; i++) {
    const y0 = seatTop + i * pitch + slatGap / 2, y1 = y0 + bh;
    const piece = (x0, x1, a = y0, b = y1) => { if (x1 - x0 > 0.01 && b - a > 0.008) root.add(wspan([x0, a, zWall], [x1, b, zWall + slatT], pineSlat(i * 7 + Math.round(x0 * 3)), { seed: i * 7 + x0 * 10, grain: 0, r: 0.003, seg: 1 })); };
    const overl = y1 > holeY0 && y0 < holeY1;
    if (!overl) { piece(-xIn, xR); continue; }
    piece(-xIn, holeX0); piece(holeX1, xR);
    if (y0 < holeY0) piece(holeX0, holeX1, y0, Math.min(y1, holeY0 - 0.002));
    if (y1 > holeY1) piece(holeX0, holeX1, Math.max(y0, holeY1 + 0.002), y1);
  }
  // slats on the tower faces toward the bench (run front-to-back)
  for (const side of [-1, 1]) for (let i = 0; i < n; i++) {
    const y0 = seatTop + i * pitch + slatGap / 2, x = side * ((side < 0 ? xIn : xR) + slatT / 2);
    root.add(wspan([x - slatT / 2, y0, zWall + 0.003], [x + slatT / 2, y0 + bh, zWall + TD - P], pineSlat(i * 5 + side), { seed: 900 + i + side * 50, grain: 2, r: 0.003, seg: 1 }));
  }
  // small corner shelves on the left alcove side (cups, carved driftwood), as in the photos
  const shelfY = [1.27, 1.52, 1.77, 2.0];
  shelfY.forEach((y, k) => {
    root.add(wspan([-xIn, y, zWall + slatT], [-xIn + 0.2, y + 0.022, zWall + 0.27], pine, { seed: 950 + k, grain: 2, r: 0.003 }));
    if (k > 0) for (let c = 0; c < (k === 3 ? 2 : 3); c++) { const cup = lathe([[0, 0], [0.026, 0], [0.028, 0.004], [0.032, 0.085], [0.029, 0.085], [0.025, 0.006], [0, 0.006]], M.glass(), { seg: 16 }); cup.position.set(-xIn + 0.05 + (c % 2) * 0.09, y + 0.022, zWall + 0.07 + c * 0.065); root.add(cup); }
  });
  { const drift = pipe([[0, 0.01, 0], [0.04, 0.05, 0.01], [0.07, 0.03, -0.01], [0.11, 0.07, 0.01]], 0.009, M.walnut(), { closed: false, seg: 16, radial: 6 }); drift.position.set(-xIn + 0.04, 1.27 + 0.022, zWall + 0.12); root.add(drift); }
  // ---- window reveal (0.03 pine jambs + head) and solid-wood sill (0.04, overhang 0.03)
  const zRev0 = zWall, zRev1 = zWall + slatT + 0.03;
  root.add(wspan([-wx - rev, win.sill, zRev0], [-wx, head, zRev1], pine, { seed: 960, grain: 1, r: 0.003 }));
  root.add(wspan([wx, win.sill, zRev0], [wx + rev, head, zRev1], pine, { seed: 961, grain: 1, r: 0.003 }));
  root.add(wspan([-wx - rev, head, zRev0], [wx + rev, headTop, zRev1], pine, { seed: 962, grain: 0, r: 0.003 }));
  for (let k = 0; k < 2; k++) {                                   // two glued solid strips, end grain visible at the horns
    const za = zWall + k * 0.045, zbb = Math.min(zWall + (k + 1) * 0.045, zRev1 + 0.03);
    root.add(wspan([-wx - rev - 0.03, sill0, za], [wx + rev + 0.03, sill1, zbb - 0.0005], pine, { seed: 970 + k, grain: 0, r: 0.004 }));
  }
  // ---- top cap between the towers + stepped fascia (frames the alcove, hides the shade)
  root.add(wspan([-xIn, capY, zWall], [xR, H, zWall + TD], wood, { seed: 980 }));
  root.add(wspan([-xIn, capY - 0.075, zWall + TD - P], [xR, capY, zWall + TD], wood, { seed: 981, r: 0.003 }));
  root.add(wspan([-xIn, capY - 0.045, zWall + TD - 2 * P], [xR, capY, zWall + TD - P], wood, { seed: 982, r: 0.003 }));
  // ---- cushion (cream linen box cushion with welts) and pillows
  const cw = xIn + xR - 0.012, cd = zb1 - zb0 - 0.02, cz = (zb0 + zb1) / 2 + 0.003, ct = 0.08, rC = 0.02;
  const cush = wbox(cw, ct, cd, linenCushion(), { r: rC, seg: 3, x: mid, y: seatTop + ct / 2, z: cz }); cush.scale.y = 1.0; root.add(cush);
  for (const y of [seatTop + 0.012, seatTop + ct - 0.012]) { const w = pipe(rrectXZ(cw + 0.001, cd + 0.001, rC, y, 4), 0.004, linenWelt(), { seg: 150, radial: 5 }); w.position.set(mid, 0, cz); root.add(w); }
  const st = seatTop + ct, zBackP = zWall + slatT + 0.10; // clear the projecting window sill
  const P1 = pillowLeaning(0.43, 0.15, 0.48, false); place(P1, -1.02, st, zBackP, 0.48, 0.12); tag(P1, 'pillow1'); root.add(P1);
  const P2 = pillowLeaning(0.56, 0.18, 0.20, true); place(P2, -0.43, st, zBackP, 0.20, 0.04); tag(P2, 'pillow2'); root.add(P2);
  const P3 = pillowLeaning(0.50, 0.17, 0.78, true); P3.rotation.z = 0.28; place(P3, 0.60, st, zBackP, 0.78, 0.65); tag(P3, 'pillow3'); root.add(P3);
  addSeat(root, { x: -0.6, y: 0.54, z: 0.05, facing: 0, kind: 'bench' });
  addSeat(root, { x: 0.6, y: 0.54, z: 0.05, facing: 0, kind: 'bench' });
  return autoCollider(describe(bake(root), { id: 'living-window-seat', name: 'Hand-built window seat with shelf towers', zh: '自制窗台座椅与书架', note: 'house supplies the window; opening 1.84 × 1.22, sill top 0.95' }));
}

// Pillow body (superellipsoid, pinched edges) + optional ruffled flange with black edging; built facing +Z.
function creased(m, seed) {
  const p = m.geometry.attributes.position; m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox, A = b.max.x, C = b.max.z;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / A, z = p.getZ(i) / C, y = p.getY(i), edge = Math.max(0, 1 - x * x) * Math.max(0, 1 - z * z);
    // Sphere equators carry tiny float residue; keep the pinched seam in its plane.
    p.setY(i, y + (Math.abs(y) < 1e-8 ? 0 : Math.sign(y)) * 0.012 * edge * (Math.sin(z * 17 + x * 7 + seed) + 0.4 * Math.sin(x * 24 - z * 5)));
  }
  m.geometry.computeVertexNormals(); return m;
}
function pillowBody(size, thick, ruffle) {
  const g = new THREE.Group(), A = size / 2;
  g.add(creased(blob(A, thick / 2 / 1.15, A, pillowWhite(), { e1: 0.8, e2: 0.38, puff: 0.15, thin: 0.35, ws: 64, hs: 32, uvTile: 1 }), size * 31));
  if (ruffle) {
    // The flange and its welt share the body's superellipse exponent and the same sampled outline.
    const edge = blobEquator(A, A, { e2: 0.38, n: 64 }), pts = edge.map(([x, y, z]) => [x * 1.06, y, z * 1.06]);
    const flangeShape = pts.map(([x, y, z]) => [x, z]);
    const hole = edge.map(([x, y, z]) => [x * 0.96, z * 0.96]).reverse();
    const fl = extrude(flangeShape, 0.003, pillowWhite(), { holes: [hole] }); fl.rotation.x = -Math.PI / 2; fl.position.y = -0.0015; g.add(fl);
    g.add(pipe(pts, 0.0026, ruffleBlack(), { seg: 240, radial: 4 }));
  }
  return g;
}
function pillowLeaning(size, thick, lean, ruffle) { const outer = new THREE.Group(), b = pillowBody(size, thick, ruffle); b.rotation.x = Math.PI / 2 - lean; outer.add(b); outer.userData.dims = { size, thick, lean }; return outer; }
// stand a leaning pillow on the cushion top (y) with its back against zBack; yaw turns it a little
function place(p, x, y, zBack, lean, yaw) {
  p.rotation.y = yaw; p.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(p);
  p.position.set(x, y - b.min.y + 0.001, zBack - b.min.z + 0.003);
}
function tag(root, part) { root.traverse(m => { if (m.isMesh) m.userData.clipPart = part; }); }

// ---------------------------------------------------------------------------------------------------------------
// RUG: jute 2.90 × 3.20, 3 mm, corners r 0.05, 30 mm bound edge slightly darker.
function rug() {
  const W = 2.9, D = 3.2, T = 0.003, B = 0.03, root = new THREE.Group();
  const outer = rrect(W - 0.004, D - 0.004, 0.048, 6), inner = rrect(W - 2 * B, D - 2 * B, 0.03, 6);
  const field = extrude(inner, T - 0.001, juteChunky(), {}); field.rotation.x = -Math.PI / 2; field.position.y = 0.0005; root.add(field);
  const bind = extrude(outer, T - 0.002, juteBind(), { holes: [inner.slice().reverse()], bevel: 0.0005 }); bind.rotation.x = -Math.PI / 2; bind.position.y = 0.001; root.add(bind);
  for (const m of [field, bind]) { const uv = m.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.4, uv.getY(i) * 0.4); m.receiveShadow = true; m.castShadow = false; }
  return describe(root, { id: 'living-rug', name: 'Jute rug 8×10', zh: '黄麻地毯' });
}

// ---------------------------------------------------------------------------------------------------------------
// SIDE BENCH: long narrow pine console, leaning red canvas left and crackle vase right (g09/g10/g51).
function sideBench() {
  const root = new THREE.Group(), pine = pineHoney(), W = 1.80, D = 0.27, H = 0.49, T = 0.025;
  root.add(wbox(W, T, D, pine, { r: 0.004, y: H - T / 2, seed: 41 }));
  for (const s of [-1, 1]) root.add(wbox(T, H - T, D - 0.025, pine, { r: 0.003, x: s * (W / 2 - 0.055), y: (H - T) / 2, seed: 42 + s, grain: 1 }));
  root.add(wbox(W - 0.11, 0.055, 0.02, pine, { r: 0.003, y: H - T - 0.0275, z: -D / 2 + 0.025, seed: 45 }));
  const c = document.createElement('canvas'); c.width = c.height = 256; const ctx = c.getContext('2d'), R = rng(5);
  ctx.fillStyle = '#b62316'; ctx.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 5000; k++) { ctx.fillStyle = R() < 0.5 ? 'rgba(255,125,40,.15)' : 'rgba(90,0,0,.12)'; ctx.fillRect(R() * 256, R() * 256, 1 + R() * 5, 1 + R() * 3); }
  ctx.fillStyle = '#e9e5d8'; ctx.beginPath(); ctx.ellipse(80, 91, 12, 23, -.1, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#77776b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(80, 79, 6, 4, 0, 0, Math.PI * 2); ctx.stroke();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const art = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.40, 0.024), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }))); art.position.set(-0.59, H + 0.20, -0.06); art.rotation.x = -0.08; root.add(art);
  const v = vase(0.105, 0.29, M.ceramicSpeckle()); v.position.set(0.73, H, 0); root.add(v);
  // Fine bare stems, swept left rather than feathery pampas plumes.
  for (let i = 0; i < 26; i++) {
    const out = 0.10 + R() * 0.44, up = 0.30 + R() * 0.44, bx = 0.73, by = H + 0.26, depth = (i % 5 - 2) * 0.025, pts = [];
    for (let k = 0; k <= 8; k++) { const t = k / 8; pts.push([bx - out * t * t, by + up * t - 0.12 * t * t, depth * t * t]); }
    root.add(pipe(pts, 0.0012, dryGrass(), { closed: false, seg: 24, radial: 4 }));
  }
  setMovable(root, { mass: 10, radius: 0.32 });
  setCollider(root, { w: W, d: D, x: 0, z: 0, h: H });
  return describe(bake(root), { id: 'living-side-bench', name: 'Pine console with red painting and dried grass', zh: '松木长凳 · 红画与干草' });
}

// ---------------------------------------------------------------------------------------------------------------
function throwPillows() {
  const root = new THREE.Group();
  [-0.23, 0.23].forEach((x, i) => { const p = pillowBody(0.4, 0.12, false); p.rotation.y = (i ? -1 : 1) * 0.08; p.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(p); p.position.set(x, -b.min.y + 0.001, 0); tag(p, `pillow${i + 1}`); root.add(p); });
  return describe(bake(root), { id: 'living-throw-pillows', name: 'Spare white pillows ×2', zh: '备用白靠枕' });
}

export const items = { sofa, coffeeTable, windowSeat, rug, sideBench, throwPillows };
void metricUV; void group;
