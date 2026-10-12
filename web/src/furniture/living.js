// living — 2513 Croton Ave living room: caramel leather sofa, round white-oak coffee table, the owner's hand-built
// window seat (towers + slatted alcove + cubby bench), jute rug, small pine side bench, spare pillows.
// Frame per kit.js: origin on the floor at the footprint centre, +Z = front.
import { THREE, M, cyl, lathe, extrude, group, addSeat, setMovable, setCollider, autoCollider, describe, shadow } from '../kit.js';
import { rng, metricUV, pineTexture, PINE_TILE, bake, weaveMaps, wbox, wspan, blob, blobEquator, pipe, rrect, rrectXZ, bookRow, bookStack } from './living_parts.js';

const once = (fn) => { let v; return () => (v ??= fn()); };
const tint = (base, k, props = {}) => { const m = base.clone(); m.color.multiplyScalar(k); Object.assign(m, props); return m; };

// local materials (derived from the shared library)
// Caramel aniline leather: M.leatherTan's scan albedo is a dark oxblood, so keep its normal/roughness/AO and set
// the colour to the photos' caramel; seat cushions 6% darker.
const leatherCaramel = once(() => { const m = M.leatherTan().clone(); m.map = null; m.color.set(0xb06c32); m.normalScale = new THREE.Vector2(0.35, 0.35); m.roughness = 0.62; return m; });
const leatherSeat = once(() => tint(leatherCaramel(), 0.94));
const brushedSteel = once(() => new THREE.MeshStandardMaterial({ color: 0xd6d2cc, roughness: 0.4, metalness: 1 }));
const juteBind = once(() => tint(M.jute(), 0.8));
const linenWelt = once(() => new THREE.MeshPhysicalMaterial({ color: 0xd8d1c3, roughness: 0.95, sheen: 0.4, sheenColor: new THREE.Color(0xffffff) }));
const clothWeave = once(() => { const w = weaveMaps({ kind: 'plain', cells: 48, strength: 2 }); w.normal.repeat.set(12, 12); return w.normal; });   // ~1.7 mm threads
const pillowWhite = once(() => new THREE.MeshPhysicalMaterial({ color: 0xfbfaf7, roughness: 0.92, sheen: 0.7, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffffff), normalMap: clothWeave(), normalScale: new THREE.Vector2(0.5, 0.5) }));
const linenCushion = once(() => { const m = M.linen().clone(); m.normalMap = clothWeave(); m.normalScale = new THREE.Vector2(0.45, 0.45); return m; });
// Chunky jute: M.jute's fibre scan plus a basket-weave relief (blocks ~2.5 cm) for the photos' chunky weave.
const juteChunky = once(() => { const m = M.jute().clone(), w = weaveMaps({ kind: 'basket', cells: 12, strength: 4 }); for (const t of [w.normal, w.ao]) t.repeat.set(5.5, 5.5); m.normalMap = w.normal; m.aoMap = w.ao; m.aoMapIntensity = 0.8; m.normalScale = new THREE.Vector2(1.1, 1.1); m.color.set(0xe4d4b4); return m; });
const ruffleBlack = once(() => new THREE.MeshStandardMaterial({ color: 0x161514, roughness: 0.8 }));
// Pine for the owner's built-ins: pale blond (towers/bench), warmer slats, honey solid-wood sill and side bench.
// (The shared M.pineWhitewash / M.plywoodSlats read as chalk-white with blotchy waves next to the photos.)
const pineBlond = once(() => new THREE.MeshStandardMaterial({ map: pineTexture({ base: '#e8c995', late: '#c08b4c', seed: 3, contrast: 1.1 }), roughness: 0.62 }));
const slatVariants = once(() => [['#e6c28a', '#b98142', 8], ['#eac897', '#c08c4d', 9], ['#e2bb80', '#b27a3a', 10]].map(([base, late, seed]) => new THREE.MeshStandardMaterial({ map: pineTexture({ base, late, seed, contrast: 1.1 }), roughness: 0.6 })));
const pineSlat = (i = 0) => slatVariants()[((i % 3) + 3) % 3];
const pineHoney = once(() => new THREE.MeshStandardMaterial({ map: pineTexture({ base: '#e6bd80', late: '#b07434', seed: 5, contrast: 1.2, rings: 40 }), roughness: 0.5 }));
const dryGrass = once(() => new THREE.MeshStandardMaterial({ color: 0xb7b591, roughness: 0.9, side: THREE.DoubleSide }));

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
    g.add(blob(bw / 2, bt, bh / 2, L, { e1: 0.5, e2: 0.16, puff: 0.12, thin: 0.25, uvTile: 0.55 }));
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
// COFFEE TABLE: round white oak Ø1.00 × 0.36, 45 mm top with soft rounded edge, 3 splayed legs Ø50 + Y stretcher.
function coffeeTable() {
  const R = 0.5, H = 0.36, T = 0.045, root = new THREE.Group(), oak = M.oak();
  const y0 = H - T, prof = [[0, y0], [R - 0.014, y0], [R - 0.005, y0 + 0.002], [R - 0.0012, y0 + 0.009], [R, y0 + T * 0.5], [R - 0.0012, H - 0.009], [R - 0.005, H - 0.002], [R - 0.014, H], [0, H]];
  const top = lathe(prof, oak, { seg: 72 });
  { const p = top.geometry.attributes.position, uv = top.geometry.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) + 0.13, p.getZ(i) + 0.4); }
  root.add(top);
  const legR = 0.025, a0 = Math.PI / 2, rTop = 0.26, rBot = 0.33, hub = 0.11;
  const tilt = Math.atan2(rBot - rTop, y0), lift = legR * 0.82 * Math.sin(tilt) + 0.0003, legLen = Math.hypot(rBot - rTop, y0 - lift);
  const legGeo = new THREE.CylinderGeometry(legR, legR * 0.82, legLen, 20);
  { const p = legGeo.attributes.position, uv = legGeo.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, uv.getX(i) * 0.15, p.getY(i)); }
  for (let k = 0; k < 3; k++) {
    const a = a0 + k * (2 * Math.PI / 3), cx = Math.cos(a), cz = Math.sin(a);
    const leg = shadow(new THREE.Mesh(legGeo, oak));
    const top3 = new THREE.Vector3(cx * rTop, y0, cz * rTop), bot3 = new THREE.Vector3(cx * rBot, lift, cz * rBot);
    leg.position.copy(top3).add(bot3).multiplyScalar(0.5);
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top3.clone().sub(bot3).normalize()); root.add(leg);
    // mounting cleat under the top
    const cl = wbox(0.12, 0.022, 0.07, oak, { r: 0.004, x: cx * rTop, y: y0 - 0.011, z: cz * rTop, ry: -a, tile: 0.8 }); root.add(cl);
    // Y stretcher arm from hub to leg
    const rAt = rBot - (rBot - rTop) * (hub / y0);
    const arm = cyl(0.0145, 0.0145, rAt - 0.03, oak, { seg: 14 }); arm.rotation.z = Math.PI / 2; arm.rotation.y = -a;
    arm.position.set(cx * (0.03 + rAt) / 2, hub, cz * (0.03 + rAt) / 2); root.add(arm);
  }
  root.add(cyl(0.032, 0.032, 0.045, oak, { y: hub, seg: 20 }));
  return autoCollider(describe(bake(root), { id: 'living-coffee-table', name: 'Round white-oak coffee table', zh: '白橡木圆茶几' }));
}

// ---------------------------------------------------------------------------------------------------------------
// WINDOW SEAT (hero): 3.30 × 0.62 × 2.30. Wall plane at z = -0.31, faces +Z.
// Towers 0.32 × 0.40 at both ends (solid front, 6 cubbies open to the OUTER side as in the owner's photos),
// bench 2.66 × 0.60 with open cubbies below a 0.46 seat, linen cushion + 4 pillows, horizontal pine slats from the
// seat to the top on the back wall and on the tower sides facing the bench, a 1.84 × 1.22 window hole (sill 0.95)
// with 0.03 pine reveal boards and a 0.04 solid-wood sill overhanging 0.03.
const WS = { W: 3.30, H: 2.30, zWall: -0.31, TW: 0.32, TD: 0.40, P: 0.03, seatTop: 0.46, BAYS: 4,
  win: { w: 1.84, h: 1.22, sill: 0.95 }, slatH: 0.09, slatGap: 0.004, slatT: 0.02, capY: 2.27 };

function tower(side, seedBase) {
  // side = -1 (left, open to -X) or +1 (right, open to +X). Built in absolute window-seat coordinates.
  const { W, H, zWall, TW, TD, P } = WS, g = new THREE.Group(), wood = pineBlond();
  const xo = side * W / 2, xi = side * (W / 2 - TW);         // outer edge (open side), inner edge (bench side)
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
  const xIn = W / 2 - TW;                                         // 1.33: inner faces of the towers
  root.add(tower(-1, 100), tower(1, 200));
  // ---- bench: recessed plinth, bottom, top, ends, back, dividers (BAYS open cubbies)
  const zb0 = zWall + slatT, zb1 = zb0 + 0.60;
  let s = 300;
  root.add(wspan([-xIn + 0.07, 0, zb0 + 0.02], [xIn - 0.07, 0.06, zb1 - 0.07], wood, { seed: s++, r: 0.003 }));
  root.add(wspan([-xIn, 0.06, zb0], [xIn, 0.06 + P, zb1], wood, { seed: s++ }));
  root.add(wspan([-xIn, seatTop - P, zb0], [xIn, seatTop, zb1], wood, { seed: s++, r: 0.005 }));
  root.add(wspan([-xIn, 0.06 + P, zb0], [xIn, seatTop - P, zb0 + P], wood, { seed: s++ }));
  const bay = (2 * xIn - (BAYS + 1) * P) / BAYS, xs = [];
  for (let k = 0; k <= BAYS; k++) { const x = -xIn + k * (bay + P); xs.push(x); root.add(wspan([x, 0.06 + P, k === 0 || k === BAYS ? zb0 : zb0 + P], [x + P, seatTop - P, zb1], wood, { seed: s++, grain: 1, r: 0.003 })); }
  // books in the bench bays (as in the listing photo: upright black sets, mixed stacks, magazines)
  const yb = 0.06 + P, zFront = zb1 - 0.035;
  const addAt = (o, x, z = zFront) => { o.position.set(x, yb, z); root.add(o); };
  addAt(bookRow(0.32, 11, ['black', 'black', 'black', 'grey'], { hMin: 0.24, hMax: 0.28, dMin: 0.17, dMax: 0.2 }), xs[0] + P + 0.05);
  addAt(bookRow(0.2, 12, ['black', 'black', 'navy'], { hMin: 0.23, hMax: 0.27, lean: 0.3 }), xs[1] + P + 0.03);
  addAt(bookStack(4, 13, ['white', 'black', 'cream', 'tan']), xs[1] + P + 0.4);
  addAt(bookStack(6, 14, ['white', 'cream', 'red', 'white']), xs[2] + P + 0.18);
  addAt(bookStack(3, 15, ['red', 'white', 'cream']), xs[2] + P + 0.45);
  if (BAYS > 3) { addAt(bookStack(9, 16, ['navy', 'black', 'grey', 'white'], { wMin: 0.2, wMax: 0.26 }), xs[3] + P + 0.42); addAt(bookStack(2, 17, ['cream', 'tan']), xs[3] + P + 0.15); }
  // ---- slat cladding on the back wall between the towers (cut around the window)
  const wx = win.w / 2, sill0 = win.sill - 0.04, sill1 = win.sill, head = win.sill + win.h, rev = 0.03, headTop = head + rev;
  const n = Math.round((capY - seatTop) / (slatH + slatGap)), pitch = (capY - seatTop) / n, bh = pitch - slatGap;
  const holeX0 = -wx - rev, holeX1 = wx + rev, holeY0 = sill0, holeY1 = headTop;
                     // plank lines of the texture land in the gaps
  for (let i = 0; i < n; i++) {
    const y0 = seatTop + i * pitch + slatGap / 2, y1 = y0 + bh;
    const piece = (x0, x1, a = y0, b = y1) => { if (x1 - x0 > 0.01 && b - a > 0.008) root.add(wspan([x0, a, zWall], [x1, b, zWall + slatT], pineSlat(i * 7 + Math.round(x0 * 3)), { seed: i * 7 + x0 * 10, grain: 0, r: 0.003, seg: 1 })); };
    const overl = y1 > holeY0 && y0 < holeY1;
    if (!overl) { piece(-xIn, xIn); continue; }
    piece(-xIn, holeX0); piece(holeX1, xIn);
    if (y0 < holeY0) piece(holeX0, holeX1, y0, Math.min(y1, holeY0 - 0.002));
    if (y1 > holeY1) piece(holeX0, holeX1, Math.max(y0, holeY1 + 0.002), y1);
  }
  // slats on the tower faces toward the bench (run front-to-back)
  for (const side of [-1, 1]) for (let i = 0; i < n; i++) {
    const y0 = seatTop + i * pitch + slatGap / 2, x = side * (xIn + slatT / 2);
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
  root.add(wspan([-xIn, capY, zWall], [xIn, H, zWall + TD], wood, { seed: 980 }));
  root.add(wspan([-xIn, capY - 0.075, zWall + TD - P], [xIn, capY, zWall + TD], wood, { seed: 981, r: 0.003 }));
  root.add(wspan([-xIn, capY - 0.045, zWall + TD - 2 * P], [xIn, capY, zWall + TD - P], wood, { seed: 982, r: 0.003 }));
  // ---- cushion (cream linen box cushion with welts) and pillows
  const cw = 2 * xIn - 0.012, cd = zb1 - zb0 - 0.02, cz = (zb0 + zb1) / 2 + 0.003, ct = 0.08, rC = 0.02;
  const cush = wbox(cw, ct, cd, linenCushion(), { r: rC, seg: 3, x: 0, y: seatTop + ct / 2, z: cz }); cush.scale.y = 1.0; root.add(cush);
  for (const y of [seatTop + 0.012, seatTop + ct - 0.012]) { const w = pipe(rrectXZ(cw + 0.001, cd + 0.001, rC, y, 4), 0.004, linenWelt(), { seg: 150, radial: 5 }); w.position.z = cz; root.add(w); }
  const st = seatTop + ct - 0.005, zBackP = zWall + slatT;
  const P1 = pillowLeaning(0.56, 0.17, 0.22, false); place(P1, -xIn + 0.34, st, zBackP, 0.22, 0.12); root.add(P1);
  const P2 = pillowLeaning(0.46, 0.15, 0.3, false); place(P2, -xIn + 0.6, st, zBackP + 0.1, 0.3, -0.18); root.add(P2);
  const P3 = pillowLeaning(0.6, 0.18, 0.2, true); place(P3, -0.32, st, zBackP, 0.2, 0.05); root.add(P3);
  const P4 = pillowLeaning(0.56, 0.17, 0.42, true); place(P4, xIn - 0.3, st, zBackP + 0.05, 0.42, -0.5); root.add(P4);
  addSeat(root, { x: -0.6, y: 0.54, z: 0.05, facing: 0, kind: 'bench' });
  addSeat(root, { x: 0.6, y: 0.54, z: 0.05, facing: 0, kind: 'bench' });
  return autoCollider(describe(bake(root), { id: 'living-window-seat', name: 'Hand-built window seat with shelf towers', zh: '自制窗台座椅与书架', note: 'house supplies the window; opening 1.84 × 1.22, sill top 0.95' }));
}

// Pillow body (superellipsoid, pinched edges) + optional ruffled flange with black edging; built facing +Z.
function pillowBody(size, thick, ruffle) {
  const g = new THREE.Group(), A = size / 2;
  g.add(blob(A, thick / 2 / 1.15, A, pillowWhite(), { e1: 0.7, e2: 0.25, puff: 0.12, thin: 0.4, ws: 36, hs: 20, uvTile: 1 }));
  if (ruffle) {
    const R = rng(Math.round(size * 1000)), n = 160, pts = [];
    for (let i = 0; i < n; i++) { const om = (i / n) * Math.PI * 2, wave = Math.sin(om * 38 + R() * 0.3) * 0.006; pts.push([(A + 0.03) * Math.sign(Math.cos(om)) * Math.pow(Math.abs(Math.cos(om)), 0.22), wave, (A + 0.03) * Math.sign(Math.sin(om)) * Math.pow(Math.abs(Math.sin(om)), 0.22)]); }
    const flangeShape = rrect(size + 0.06, size + 0.06, 0.05).map(([x, z]) => [x, z]);
    const hole = rrect(size - 0.06, size - 0.06, 0.05).map(([x, z]) => [x, z]).reverse();
    const fl = extrude(flangeShape, 0.003, pillowWhite(), { holes: [hole] }); fl.rotation.x = -Math.PI / 2; fl.position.y = -0.0015; g.add(fl);
    g.add(pipe(pts, 0.0026, ruffleBlack(), { seg: 240, radial: 4 }));
  }
  return g;
}
function pillowLeaning(size, thick, lean, ruffle) { const outer = new THREE.Group(), b = pillowBody(size, thick, ruffle); b.rotation.x = Math.PI / 2 - lean; outer.add(b); outer.userData.dims = { size, thick, lean }; return outer; }
// stand a leaning pillow on the cushion top (y) with its back against zBack; yaw turns it a little
function place(p, x, y, zBack, lean, yaw) {
  const { size, thick } = p.userData.dims, h = size / 2 * Math.cos(lean) + thick * 0.3 * Math.sin(lean);
  p.position.set(x, y + h, zBack + thick * 0.45 + size / 2 * Math.sin(lean)); p.rotation.y = yaw;
}

// ---------------------------------------------------------------------------------------------------------------
// RUG: jute 2.40 × 3.20, 12 mm, corners r 0.05, 30 mm bound edge slightly darker.
function rug() {
  const W = 2.4, D = 3.2, T = 0.012, B = 0.03, root = new THREE.Group();
  const outer = rrect(W - 0.004, D - 0.004, 0.048, 6), inner = rrect(W - 2 * B, D - 2 * B, 0.03, 6);
  const field = extrude(inner, T - 0.001, juteChunky(), {}); field.rotation.x = -Math.PI / 2; root.add(field);
  const bind = extrude(outer, T - 0.004, juteBind(), { holes: [inner.slice().reverse()], bevel: 0.002 }); bind.rotation.x = -Math.PI / 2; bind.position.y = 0.002; root.add(bind);
  for (const m of [field, bind]) { const uv = m.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.4, uv.getY(i) * 0.4); m.receiveShadow = true; m.castShadow = false; }
  return describe(root, { id: 'living-rug', name: 'Jute rug 8×10', zh: '黄麻地毯' });
}

// ---------------------------------------------------------------------------------------------------------------
// SIDE BENCH: small natural pine slab bench 0.45 × 0.30 × 0.40 with a white ceramic vase of dried grass.
function sideBench() {
  const root = new THREE.Group(), pine = pineHoney(), W = 0.45, D = 0.30, H = 0.40, T = 0.035;
  root.add(wbox(W, T, D, pine, { r: 0.005, y: H - T / 2, seed: 41 }));
  for (const s of [-1, 1]) root.add(wbox(T, H - T, D - 0.04, pine, { r: 0.004, x: s * (W / 2 - 0.06), y: (H - T) / 2, seed: 42 + s, grain: 1 }));
  for (const s of [-1, 1]) root.add(wbox(W - 0.12 - T, 0.045, 0.02, pine, { r: 0.003, y: H - T - 0.0225, z: s * (D / 2 - 0.045), seed: 45 + s }));
  const v = vase(0.085, 0.24); v.position.set(0.07, H, 0); root.add(v);
  // dried grass stems fanning out of the vase
  const R = rng(5);
  for (let i = 0; i < 18; i++) {
    const a = R() * Math.PI * 2, out = 0.08 + R() * 0.16, up = 0.3 + R() * 0.28, droop = 0.05 + R() * 0.12, bx = 0.07, by = H + 0.19, pts = [];
    for (let k = 0; k <= 6; k++) { const t = k / 6; pts.push([bx + Math.cos(a) * out * Math.pow(t, 1.6), by + up * t - droop * Math.pow(t, 3), Math.sin(a) * out * Math.pow(t, 1.6)]); }
    root.add(pipe(pts, 0.0013 + R() * 0.0006, dryGrass(), { closed: false, seg: 18, radial: 4 }));
  }
  setMovable(root, { mass: 6, radius: 0.28 });
  setCollider(root, { w: W, d: D, x: 0, z: 0, h: H });              // the bench itself; grass does not block
  return (describe(bake(root), { id: 'living-side-bench', name: 'Pine side bench with vase', zh: '松木小凳与花瓶' }));
}

// ---------------------------------------------------------------------------------------------------------------
function throwPillows() {
  const root = new THREE.Group();
  [-0.27, 0.27].forEach((x, i) => { const p = pillowBody(0.5, 0.14, false); p.position.set(x, 0.068, 0); p.rotation.y = (i ? -1 : 1) * 0.08; root.add(p); });
  return describe(bake(root), { id: 'living-throw-pillows', name: 'Spare white pillows ×2', zh: '备用白靠枕' });
}

export const items = { sofa, coffeeTable, windowSeat, rug, sideBench, throwPillows };
void metricUV; void group;
