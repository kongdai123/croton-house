// outdoor — back-yard fire-pit group, patio, fence and front-yard pieces of 2513 Croton Ave.
// Sources: refs/outdoor g40/g41/g42 (fire sphere, wicker egg chairs + poufs, the owner's lumber table and slatted
// cinder-block stools, navy market umbrella), g37/g38/g39/g44 (white moulded patio armchairs), g03/g05/g06 (front yard:
// low lumber platform bench, white pots, porch sconce), g43 (white rendered planters), rednote dusk shots (white urn).
import { THREE, M, box, cyl, group, at, addSeat, setMovable, setCollider, autoCollider, describe, shadow } from '../kit.js';
import { ss, rng, wickerResin, WEAVE_TILE, pitSteel, galvanized, powderBlack, lumberTop, soil, concreteGrey, cinder, vinylShade, ash, charEnd, lumberPT, barkDark, cushionCream, navyDeep, renderWhite,
  board, latheM, ringShell, strut, puffPillow, roundCushion, fireScreen, sconceAlpha } from './outdoor_parts.js';

const PI = Math.PI;
const root = (...kids) => group(...kids);

// ---------------------------------------------------------------- fire sphere (g40 close-up)
// Black steel "fire globe": solid bowl, see-through spark-screen band + lift-off dome with birch-tree cut-outs,
// flat straps, equator flange with a side ring handle, top lift loop, four splayed square legs; logs inside.
function firePit() {
  const R = 0.32, cy = 0.48, g = root();
  const part = (t0, t1, mat, r = R, seg = 64) => { const geo = new THREE.SphereGeometry(r, seg, 24, 0, 2 * PI, t0, t1 - t0);
    const uv = geo.attributes.uv, p = geo.attributes.position; for (let i = 0; i < p.count; i++) uv.setY(i, 1 - Math.acos(Math.max(-1, Math.min(1, p.getY(i) / r))) / PI);
    const m = new THREE.Mesh(geo, mat); m.position.y = cy; return shadow(m); };
  const tb = THREE.MathUtils.degToRad(123);
  g.add(part(tb, PI, pitSteel()));                                    // solid bowl
  const scrLow = part(PI / 2, tb, fireScreen(), R, 64), dome = part(0, PI / 2, fireScreen(), R + 0.004, 64);
  for (const s of [scrLow, dome]) { s.castShadow = false; g.add(s); }
  // flanges: bowl rim, equator (lid lip + band), small top collar
  const ring = (r, y, tube) => { const t = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 72), pitSteel()); t.rotation.x = PI / 2; t.position.y = y; return shadow(t); };
  g.add(ring(R * Math.sin(tb) + 0.002, cy + R * Math.cos(tb), 0.007));
  g.add(cyl(R + 0.012, R + 0.012, 0.03, pitSteel(), { y: cy + 0.004, open: true, seg: 72 }), ring(R + 0.012, cy - 0.011, 0.006), ring(R + 0.012, cy + 0.019, 0.006));
  // straps: 4 meridians over the dome, 8 short ones on the lower screen
  for (let k = 0; k < 2; k++) { const t = new THREE.Mesh(new THREE.TorusGeometry(R + 0.006, 0.0065, 6, 48, PI), pitSteel()); t.position.y = cy; t.rotation.y = k * PI / 2; g.add(shadow(t)); }
  for (let k = 0; k < 8; k++) { const t = new THREE.Mesh(new THREE.TorusGeometry(R + 0.004, 0.006, 6, 12, tb - PI / 2), pitSteel()); t.position.y = cy; t.rotation.set(0, k * PI / 4 + PI / 8, -(tb - PI / 2)); g.add(shadow(t)); }
  // top lift loop and side ring handle
  const loop = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.0045, 8, 24), pitSteel()); loop.position.y = cy + R + 0.024; g.add(shadow(loop));
  g.add(cyl(0.016, 0.02, 0.012, pitSteel(), { y: cy + R + 0.004 }));
  const hdl = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.0055, 8, 24), pitSteel()); hdl.rotation.x = PI / 2; hdl.position.set(-(R + 0.045), cy + 0.004, 0); g.add(shadow(hdl));
  // legs: square tube, welded under the bowl, splayed
  for (let k = 0; k < 4; k++) { const a = PI / 4 + k * PI / 2, s = Math.sin(a), c = Math.cos(a);
    g.add(strut([0.17 * s, cy - 0.27, 0.17 * c], [0.3 * s, 0.012, 0.3 * c], 0.026, 0.026, pitSteel()));
    g.add(box(0.05, 0.012, 0.05, pitSteel(), { x: 0.3 * s, z: 0.3 * c, bottom: true, r: 0.003, ry: a })); }
  // fuel: ash bed + three split logs (bark sides, sawn ends)
  g.add(cyl(0.2, 0.2, 0.01, ash(), { y: cy - R + 0.07 }));
  const logGeo = new THREE.CylinderGeometry(0.038, 0.042, 0.36, 10, 1); const mats = [barkDark(), charEnd(), charEnd()];
  [[0, 0.24, 0, 0.3], [0.04, 0.27, 0.05, 1.5], [-0.05, 0.285, -0.02, 2.5]].forEach(([x, y, z, ry], i) => {
    const l = shadow(new THREE.Mesh(logGeo, mats)); l.rotation.set(0, ry, PI / 2 + (i - 1) * 0.12, 'YXZ'); l.position.set(x, y + (cy - 0.48), z); g.add(l); });
  describe(g, { id: 'outdoor-fire-pit', name: 'fire sphere', zh: '球形火盆' });
  return autoCollider(g);
}

// ---------------------------------------------------------------- wicker egg chair (g40/g42)
function wickerChair() {
  const g = root();
  const Rof = (y) => 0.40 * Math.sqrt(Math.max(0.02, 1 - ((y - 0.45) / 0.55) ** 2));
  const shell = ringShell({ outer: (phi, y) => { const r = Rof(y); return [r * Math.sin(phi), r * Math.cos(phi)]; },
    top: (phi) => 0.28 + 0.41 * ss(0.15, 0.75, Math.abs(phi) / PI), bottom: () => 0.02, t: 0.06, nU: 112, nV: 20 }, wickerResin());
  g.add(shell);
  g.add(cyl(0.34, 0.34, 0.02, wickerResin(), { y: 0.29, seg: 40 }), cyl(0.22, 0.22, 0.02, wickerResin(), { y: 0.02, seg: 32 }));
  g.add(at(roundCushion(0.33, 0.115, cushionCream()), 0, 0.30, 0));
  for (const s of [-1, 1]) { const ph = PI + s * 0.5, p = puffPillow(0.40, 0.34, 0.14, cushionCream()); p.rotation.order = 'YXZ'; p.rotation.set(-0.22, ph + PI + s * 0.08, s * 0.05);
    p.position.set(0.21 * Math.sin(ph), 0.57, 0.21 * Math.cos(ph)); g.add(p); }
  describe(g, { id: 'outdoor-wicker-chair', name: 'wicker egg chair', zh: '藤编蛋形椅' });
  setMovable(g, { mass: 12, radius: 0.42 }); addSeat(g, { y: 0.42, facing: 0, kind: 'armchair' });
  return autoCollider(g);
}

// ---------------------------------------------------------------- wicker pouf (g40/g41)
function wickerOttoman() {
  const g = root();
  g.add(latheM([[0, 0], [0.17, 0], [0.19, 0.012], [0.225, 0.07], [0.248, 0.16], [0.25, 0.2], [0.243, 0.26], [0.225, 0.31], [0.205, 0.335], [0.19, 0.34], [0, 0.34]], wickerResin(), { seg: 64, tile: WEAVE_TILE }));
  g.add(at(roundCushion(0.232, 0.072, cushionCream()), 0, 0.34, 0));
  describe(g, { id: 'outdoor-wicker-ottoman', name: 'wicker pouf', zh: '藤编坐墩' });
  setMovable(g, { mass: 5, radius: 0.26 }); addSeat(g, { y: 0.42, facing: 0, kind: 'stool' });
  return autoCollider(g);
}

// ---------------------------------------------------------------- the owner's lumber table (g40/g41 close-ups)
const boltGeo = new THREE.LatheGeometry([[0, 0], [0.0125, 0], [0.012, 0.002], [0.008, 0.0055], [0, 0.007]].map(([r, h]) => new THREE.Vector2(r, h)), 16);
function bolt(x, y, z, nx, nz) { const m = shadow(new THREE.Mesh(boltGeo, galvanized())); m.position.set(x, y, z); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, 0, nz)); return m; }
function benchTable() {
  const g = root(), H = 0.75, T = 0.045, L = 1.5, D = 0.5;
  // top: three weathered boards with 10 mm gaps, galvanized mending plates across the seams
  [-1, 0, 1].forEach((k, i) => g.add(board(L, T, 0.16, lumberTop(), { axis: 'x', r: 0.006, y: H - T / 2, z: k * 0.17, off: i * 0.31, tile: 0.8 })));
  for (const x of [-0.62, -0.2, 0.22, 0.6]) for (const z of [-0.085, 0.085]) g.add(box(0.05, 0.002, 0.035, galvanized(), { x, y: H, z, r: 0.0008, seg: 1 }));
  const lx = 0.682, lz = 0.1935, legH = H - T;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    for (const k of [-1, 1]) g.add(board(0.038, legH, 0.089, lumberPT(), { axis: 'y', y: legH / 2, x: sx * lx + k * 0.0192, z: sz * lz, off: (sx + 2 * sz + k) * 0.21 }));
    g.add(bolt(sx * lx + 0.0, 0.66, sz * (lz + 0.0445), 0, sz), bolt(sx * lx, 0.57, sz * (lz + 0.0445), 0, sz));
    g.add(bolt(sx * (lx + 0.038), 0.635, sz * lz, sx, 0), bolt(sx * (lx + 0.038), 0.17, sz * lz, sx, 0));
  }
  // long aprons (2x8) between the legs, end aprons and low stretchers (2x6) across each end
  for (const sz of [-1, 1]) g.add(board(2 * (lx - 0.038), 0.184, 0.038, lumberPT(), { axis: 'x', y: legH - 0.092, z: sz * 0.207, off: sz * 0.4 }));
  for (const sx of [-1, 1]) {
    g.add(board(0.038, 0.14, 2 * (lz - 0.0445), lumberPT(), { axis: 'z', x: sx * 0.689, y: legH - 0.07, off: sx * 0.6 }));
    g.add(board(0.038, 0.14, 2 * (lz - 0.0445), lumberPT(), { axis: 'z', x: sx * 0.689, y: 0.17, off: sx * 0.9 }));
  }
  describe(g, { id: 'outdoor-lumber-table', name: 'reclaimed lumber table', zh: '旧木料长桌', note: 'built by the owner; 2x lumber, carriage bolts' });
  return autoCollider(g);
}

// ---------------------------------------------------------------- slatted lumber stool on cinder blocks (g40/g41)
let cinderGeo;
function cinderBlock() {
  if (!cinderGeo) { const w = 0.39 - 0.008, d = 0.19 - 0.008, s = new THREE.Shape([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(p => new THREE.Vector2(...p)));
    for (const cx of [-0.095, 0.095]) s.holes.push(new THREE.Path([[cx - 0.065, -0.055], [cx + 0.065, -0.055], [cx + 0.065, 0.055], [cx - 0.065, 0.055]].map(p => new THREE.Vector2(...p))));
    cinderGeo = new THREE.ExtrudeGeometry(s, { depth: 0.194 - 0.008, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 }); cinderGeo.rotateX(-PI / 2); cinderGeo.translate(0, 0.004, 0); }
  return shadow(new THREE.Mesh(cinderGeo, cinder()));
}
function stoolLumber() {
  const g = root(), bh = 0.194;
  g.add(cinderBlock(), at(cinderBlock(), 0, bh + 0.002, 0));
  g.add(box(0.37, 0.004, 0.17, M.concrete(), { y: bh, bottom: true }));   // mortar-ish joint
  const y0 = 2 * bh + 0.002;
  for (const x of [-0.15, 0.15]) g.add(board(0.064, 0.038, 0.38, lumberPT(), { axis: 'z', x, y: y0 + 0.019, off: x }));
  const n = 8, sw = 0.042, gap = 0.008, top = y0 + 0.038;
  for (let i = 0; i < n; i++) { const z = (i - (n - 1) / 2) * (sw + gap);
    g.add(board(0.56, 0.025, sw, lumberPT(), { axis: 'x', r: 0.004, y: top + 0.0125, z, off: i * 0.23, tile: 0.6 }));
    for (const x of [-0.15, 0.15]) g.add(cyl(0.0045, 0.0045, 0.002, galvanized(), { x, y: top + 0.025, z, seg: 8 })); }
  describe(g, { id: 'outdoor-lumber-stool', name: 'slatted lumber stool on cinder blocks', zh: '木条凳（煤渣砖座）' });
  setMovable(g, { mass: 30, radius: 0.3 }); addSeat(g, { y: 0.45, facing: 0, kind: 'stool' });
  return autoCollider(g);
}

// ---------------------------------------------------------------- white moulded patio armchair (g37/g38/g39/g44)
// One-piece shell like the IKEA SKARPÖ seen on the patio: rounded-square tub, arms almost as high as the back,
// the front edge drops to the seat, legs are the shell's own corners with arches between them.
function lounger() {
  const g = root(), a = 0.38, b = 0.355, n = 3.2, e = 2 / n, sp = (v) => Math.sign(v) * Math.pow(Math.abs(v), e);
  const outer = (phi, y) => { let x = a * sp(Math.sin(phi)), z = b * sp(Math.cos(phi));
    const fl = 1 + 0.06 * Math.max(0, y - 0.35) + 0.08 * Math.max(0, 0.28 - y); x *= fl; z *= 1 + 0.08 * Math.max(0, 0.28 - y);
    z -= 0.13 * Math.max(0, y - 0.36) * Math.max(0, -Math.cos(phi)); return [x, z]; };
  const legMask = (psi) => Math.max(1 - ss(0, 0.24, Math.abs(psi - 0.80)), 1 - ss(0, 0.24, Math.abs(psi - 2.34)));
  g.add(ringShell({ outer, t: 0.045, nU: 160, nV: 22, nc: 6, botSquash: 0.3, tile: 1,
    top: (phi) => { const p = Math.abs(phi); return 0.355 + 0.255 * ss(0.56, 0.8, p) + 0.125 * ss(0.85, 2.9, p); },
    bottom: (phi) => 0.008 + 0.26 * (1 - legMask(Math.abs(phi))) }, M.plasticWhite()));
  // seat pan: the shell's own plan at seat height, inset by the wall, as a 30 mm slab tilted slightly back
  const pts = []; for (let i = 0; i < 64; i++) { const ph = -PI + (i / 64) * 2 * PI, [x, z] = outer(ph, 0.36), k = 1 - 0.04 / Math.hypot(x, z); pts.push(new THREE.Vector2(x * k, -z * k)); }
  const pan = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 0.022, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2 });
  pan.rotateX(-PI / 2); const seat = shadow(new THREE.Mesh(pan, M.plasticWhite())); seat.position.y = 0.346; seat.rotation.x = -0.05; g.add(seat);
  // drain slots in the seat
  for (let i = -2; i <= 2; i++) g.add(box(0.012, 0.002, 0.12, vinylShade(), { x: i * 0.09, y: 0.377 + 0.003 * i * 0, z: -0.12, r: 0.0009, seg: 1, rx: -0.07 }));
  const cush = puffPillow(0.52, 0.36, 0.13, cushionCream()); cush.rotation.order = 'YXZ'; cush.rotation.set(-0.28, 0, 0); cush.position.set(0, 0.56, -0.2); g.add(cush);
  describe(g, { id: 'outdoor-patio-chair', name: 'white moulded patio armchair', zh: '白色一体塑料扶手椅' });
  setMovable(g, { mass: 7, radius: 0.4 }); addSeat(g, { y: 0.40, z: 0.06, facing: 0, kind: 'armchair' });
  return autoCollider(g);
}

// ---------------------------------------------------------------- navy market umbrella, furled (g40/g42/g37)
function umbrella() {
  const g = root();
  g.add(latheM([[0, 0], [0.215, 0], [0.225, 0.008], [0.226, 0.06], [0.215, 0.076], [0.19, 0.08], [0.055, 0.082], [0.045, 0.1], [0.034, 0.13], [0.03, 0.14], [0.022, 0.14], [0, 0.14]], concreteGrey(), { seg: 48, tile: 0.6 }));
  g.add(cyl(0.008, 0.008, 0.05, powderBlack(), { x: 0.045, y: 0.115, rz: PI / 2 }), cyl(0.014, 0.014, 0.012, powderBlack(), { x: 0.072, y: 0.115, rz: PI / 2 }));
  g.add(cyl(0.02, 0.02, 2.26, powderBlack(), { y: 0.1, bottom: true, seg: 16 }));
  // crank housing just under the canopy hem
  g.add(box(0.05, 0.11, 0.05, powderBlack(), { y: 0.98, r: 0.01 }), cyl(0.005, 0.005, 0.09, powderBlack(), { x: 0.06, y: 0.98, rz: PI / 2, seg: 8 }));
  g.add(cyl(0.005, 0.005, 0.07, powderBlack(), { x: 0.105, y: 0.95, seg: 8 }), cyl(0.009, 0.009, 0.04, powderBlack(), { x: 0.105, y: 0.905, seg: 10 }));
  // canopy: furled bundle with 8 soft folds and a scalloped hem; separate vent tier on top
  const fold = (phi) => { const c = Math.cos(8 * phi); return Math.sign(c) * Math.pow(Math.abs(c), 0.7); };
  const warpMain = (r, y, phi) => { const amp = 0.17 * ss(2.32, 2.1, y) + 0.06; let y2 = y; if (y < 1.16) y2 = y - 0.05 * (1 + Math.cos(8 * phi + PI)) * 0.5 * ss(1.16, 1.1, y); return [r * (1 + amp * fold(phi)), y2]; };
  g.add(latheM([[0.165, 1.1], [0.15, 1.13], [0.118, 1.24], [0.1, 1.42], [0.108, 1.66], [0.122, 1.88], [0.124, 2.02], [0.108, 2.16], [0.075, 2.26], [0.04, 2.32], [0.016, 2.345]], navyDeep(), { seg: 96, tile: 0.5, warp: warpMain }));
  const warpVent = (r, y, phi) => [r * (1 + 0.14 * fold(phi + PI / 8)), y < 2.18 ? y - 0.025 * (1 + Math.cos(8 * phi)) * 0.5 : y];
  g.add(latheM([[0.118, 2.16], [0.11, 2.19], [0.085, 2.27], [0.05, 2.33], [0.025, 2.365], [0.012, 2.37]], navyDeep(), { seg: 96, tile: 0.5, warp: warpVent }));
  // rib tips peeking under the hem, tie strap, finial
  for (let k = 0; k < 8; k++) { const ph = (k + 0.5) * PI / 4; g.add(cyl(0.006, 0.004, 0.03, powderBlack(), { x: 0.15 * Math.sin(ph), z: 0.15 * Math.cos(ph), y: 1.07, seg: 6 })); }
  g.add(cyl(0.122, 0.122, 0.03, navyDeep(), { y: 1.62, seg: 32, open: true }));
  g.add(cyl(0.022, 0.03, 0.02, powderBlack(), { y: 2.375 }), latheM([[0, 0], [0.012, 0], [0.016, 0.01], [0.013, 0.018], [0, 0.02]], powderBlack(), { seg: 16, y: 2.38 }));
  describe(g, { id: 'outdoor-umbrella', name: 'navy market umbrella (closed)', zh: '藏青色庭院伞（收起）' });
  autoCollider(g, 0.07); return g;
}

// ---------------------------------------------------------------- white vinyl privacy fence panel (g40/g42/g43)
let fenceCache;
function fencePanel() {
  const W = 2.44, P = 0.13, span = W - 2 * P - 0.02, g = root(), n = 12, pitch = span / n, bw = pitch - 0.003, y0 = 0.06, y1 = 1.7;
  if (!fenceCache) fenceCache = { board: new THREE.BoxGeometry(1, 1, 1) };
  for (const sx of [-1, 1]) { const x = sx * (W / 2 - 0.01 - P / 2);
    g.add(box(P, 1.8, P, M.fenceVinyl(), { x, bottom: true, r: 0.006 }), box(P + 0.02, 0.022, P + 0.02, M.fenceVinyl(), { x, y: 1.8, bottom: true, r: 0.006 }), box(P - 0.01, 0.008, P - 0.01, M.fenceVinyl(), { x, y: 1.822, bottom: true, r: 0.003 })); }
  const bGeo = box(bw, y1 - y0, 0.025, M.fenceVinyl(), { r: 0.0035 }).geometry, sGeo = new THREE.BoxGeometry(0.008, y1 - y0, 0.004);
  for (let i = 0; i < n; i++) { const x = -span / 2 + pitch * (i + 0.5);
    const b = shadow(new THREE.Mesh(bGeo, M.fenceVinyl())); b.position.set(x, (y0 + y1) / 2, 0); g.add(b);
    if (i) { const s = new THREE.Mesh(sGeo, vinylShade()); s.position.set(x - pitch / 2, (y0 + y1) / 2, -0.008); g.add(s); } }
  g.add(box(span, 0.1, 0.05, M.fenceVinyl(), { y: 1.66, bottom: true, r: 0.008 }), box(span, 0.09, 0.05, M.fenceVinyl(), { y: 0.03, bottom: true, r: 0.008 }), box(span, 0.09, 0.035, M.fenceVinyl(), { y: 0.82, bottom: true, z: -0.03, r: 0.006 }));
  describe(g, { id: 'outdoor-fence-panel', name: 'white vinyl privacy fence panel', zh: '白色乙烯基隐私围栏' });
  return setCollider(g, { w: 2.44, d: 0.15, h: 1.83 });
}

// ---------------------------------------------------------------- front-yard low lumber platform bench (g03)
function plantersBench() {
  const g = root(), L = 1.9, bw = 0.14, t = 0.038;
  for (const z of [-0.22, 0.22]) g.add(board(L, t, bw, lumberPT(), { axis: 'x', y: t / 2, z, off: z }));
  for (const x of [-0.86, 0, 0.86]) for (const z of [-0.22, 0.22]) g.add(board(0.12, 0.12, bw, lumberPT(), { axis: 'y', x, y: t + 0.06, z, off: x + z }));
  const y0 = t + 0.12;
  for (let i = 0; i < 4; i++) { const z = (i - 1.5) * (bw + 0.013); g.add(board(L, t, bw, lumberTop(), { axis: 'x', y: y0 + t / 2, z, off: i * 0.37, tile: 0.9 }));
    for (const x of [-0.86, 0, 0.86]) for (const dz of [-0.035, 0.035]) g.add(cyl(0.0045, 0.0045, 0.002, galvanized(), { x: x + (dz > 0 ? 0.02 : -0.02), y: y0 + t, z: z + dz, seg: 8 })); }
  describe(g, { id: 'outdoor-front-platform-bench', name: 'front-yard lumber platform bench', zh: '前院木平台长凳' });
  addSeat(g, { x: -0.45, y: y0 + t, facing: 0, kind: 'bench' }); addSeat(g, { x: 0.45, y: y0 + t, facing: 0, kind: 'bench' });
  return autoCollider(g);
}

// ---------------------------------------------------------------- white planters
const rib = (amp, pitch, lo, hi) => (r, y) => [y > lo && y < hi ? r + amp * Math.sin((y / pitch) * 2 * PI) * ss(lo, lo + 0.03, y) * ss(hi, hi - 0.03, y) : r, y];
function potWhiteLarge() {
  const g = root();
  g.add(latheM([[0, 0], [0.17, 0], [0.2, 0.02], [0.268, 0.11], [0.298, 0.24], [0.292, 0.34], [0.262, 0.44], [0.232, 0.5], [0.234, 0.522], [0.25, 0.535], [0.248, 0.55], [0.226, 0.55], [0.214, 0.532], [0.212, 0.49], [0.21, 0.46]], M.ceramicWhite(), { seg: 64, tile: 0.4, warp: rib(0.0028, 0.03, 0.04, 0.47) }));
  g.add(cyl(0.214, 0.214, 0.012, soil(), { y: 0.49, seg: 40 }));
  describe(g, { id: 'outdoor-pot-white-large', name: 'large white ceramic urn planter', zh: '大号白色陶瓷花盆' });
  return autoCollider(g);
}
function potWhiteSmall() {
  const g = root();
  g.add(latheM([[0, 0], [0.145, 0], [0.163, 0.008], [0.17, 0.03], [0.175, 0.29], [0.175, 0.31], [0.168, 0.32], [0.157, 0.32], [0.152, 0.31], [0.15, 0.27]], M.ceramicWhite(), { seg: 56, tile: 0.4, warp: rib(0.0016, 0.022, 0.03, 0.29) }));
  g.add(cyl(0.151, 0.151, 0.01, soil(), { y: 0.285, seg: 36 }));
  describe(g, { id: 'outdoor-pot-white-small', name: 'small white ceramic planter', zh: '小号白色陶瓷花盆' });
  return autoCollider(g);
}
function planterBox() {
  const g = root(), W = 1.2, D = 0.4, H = 0.4, bv = 0.006, w = 0.045;
  const rect = (hw, hd) => [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(p => new THREE.Vector2(...p));
  const s = new THREE.Shape(rect(W / 2 - bv, D / 2 - bv)); s.holes.push(new THREE.Path(rect(W / 2 - w, D / 2 - w).reverse()));
  const geo = new THREE.ExtrudeGeometry(s, { depth: H - 2 * bv, bevelEnabled: true, bevelThickness: bv, bevelSize: bv, bevelSegments: 2, curveSegments: 4 });
  geo.rotateX(-PI / 2); geo.translate(0, bv, 0); g.add(shadow(new THREE.Mesh(geo, renderWhite())));
  g.add(box(W - 2 * w + 0.01, 0.34, D - 2 * w + 0.01, soil(), { bottom: true, y: 0.01 }));
  describe(g, { id: 'outdoor-planter-box', name: 'white rendered planter box', zh: '白色抹灰种植箱' });
  return autoCollider(g);
}

// ---------------------------------------------------------------- loose cushions
function cushionsOutdoor() {
  const g = root();
  [[-0.26, 0.1], [0.27, -0.15]].forEach(([x, ry]) => { const p = puffPillow(0.48, 0.48, 0.15, cushionCream()); p.rotation.order = 'YXZ'; p.rotation.set(-PI / 2, ry, 0); p.position.set(x, 0.08, 0); g.add(p); });
  describe(g, { id: 'outdoor-cushions', name: 'two loose cream outdoor cushions', zh: '两个米色户外靠垫' });
  return g;
}

// ---------------------------------------------------------------- porch sconce (g05/g06): black box lantern with a
// perforated front, open top/bottom washing light up and down the wall. Back face sits on z = -0.045.
function porchLight() {
  const g = root(), W = 0.13, H = 0.3, D = 0.09, cy = 1.85, z0 = -D / 2;
  g.add(box(W, H, 0.012, powderBlack(), { y: cy, z: z0 + 0.006, r: 0.002 }));
  for (const sx of [-1, 1]) g.add(box(0.008, H, D, powderBlack(), { x: sx * (W / 2 - 0.004), y: cy, r: 0.002 }));
  for (const sy of [-1, 1]) g.add(box(W, 0.018, 0.008, powderBlack(), { y: cy + sy * (H / 2 - 0.009), z: D / 2 - 0.004, r: 0.002 }), box(W, 0.008, 0.012, powderBlack(), { y: cy + sy * (H / 2 - 0.004), z: z0 + 0.014, r: 0.002 }));
  g.add(box(W - 0.03, H - 0.05, 0.03, M.emissiveWarm(), { y: cy, z: -0.005 }));
  for (const sy of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.018, D - 0.03), M.emissiveWarm()); p.rotation.x = -sy * PI / 2; p.position.set(0, cy + sy * (H / 2 - 0.012), 0.004); g.add(p); }
  const face = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.016, H - 0.036), new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.5, metalness: 0.5, alphaMap: sconceAlpha(), alphaTest: 0.5, side: THREE.DoubleSide }));
  face.position.set(0, cy, D / 2 - 0.006); g.add(shadow(face));
  describe(g, { id: 'outdoor-porch-light', name: 'porch wall sconce', zh: '门廊壁灯' });
  g.userData.light = { type: 'point', y: cy, z: 0.08, intensity: 0.6, color: 0xffd9a0, distance: 4 };
  return g;
}

export const items = { firePit, wickerChair, wickerOttoman, benchTable, stoolLumber, lounger, umbrella, fencePanel, plantersBench, potWhiteLarge, potWhiteSmall, planterBox, cushionsOutdoor, porchLight };
