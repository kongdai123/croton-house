// dining — dining room (ash table, CH24 Wishbone chairs ×6, paper ball pendant, built-in bookcase + reading bench) and
// the family room / office beyond it (whitewashed console with the red tree painting, cognac tub chair, black leather
// sling chair, small white desk). Reference photos: refs/dining/g19–g24.
import { THREE, M, box, cyl, lathe, extrude, tube, plane, group, at, sphere, torus, shadow,
  addSeat, setMovable, autoCollider, describe } from '../kit.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { once, rng, wood, boxUV, sweep, ell, rod, ground, MAT } from './dining_parts.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
// Soft pillow: subdivided box whose faces bulge in the middle and pinch to a seam at the edges.
function puffPillow(w, h, d, mat) {
  const g = new THREE.BoxGeometry(w, h, d, 14, 14, 2), p = g.attributes.position, hw = w / 2, hh = h / 2;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), fx = x / hw, fy = y / hh, k = (1 - fx ** 4) * (1 - fy ** 4);
    const wr = 0.006 * Math.sin(x * 31 + y * 17) * Math.sin(y * 23 - x * 9) * Math.sqrt(Math.max(0, k));
    p.setXYZ(i, x * (1 - 0.07 * fy * fy), y * (1 - 0.07 * fx * fx), p.getZ(i) * (0.18 + 0.82 * Math.sqrt(Math.max(0, k))) + Math.sign(p.getZ(i)) * wr); }
  g.computeVertexNormals(); return shadow(new THREE.Mesh(g, mat));
}
// Closed rounded-rectangle path (x half-width hw, z half-depth hd, corner radius c) at height y, for piping.
function roundRect(hw, hd, c, y, n = 5) {
  const pts = [];
  for (const [cx, cz, a0] of [[hw - c, hd - c, 0], [hw - c, -hd + c, -Math.PI / 2], [-hw + c, -hd + c, Math.PI], [-hw + c, hd - c, Math.PI / 2]])
    for (let i = 0; i <= n; i++) { const a = a0 - (i / n) * Math.PI / 2; pts.push([cx + c * Math.cos(a), y, cz + c * Math.sin(a)]); }
  return pts;
}

// =====================================================================================================================
// Dining table: solid ash, 2.20 × 0.95, top 0.04 with eased edges, chunky square legs set flush under the top corners
// (as in g20/g24), deep apron set back from the leg faces.
function buildTable() {
  const W = 2.20, D = 0.95, H = 0.75, T = 0.04, L = 0.075, ash = MAT.ash(), root = new THREE.Group();
  root.add(boxUV(box(W, T, D, MAT.ashTop(), { r: 0.008, seg: 3, y: H - T, bottom: true }), 'x'));
  const lx = W / 2 - 0.006 - L / 2, lz = D / 2 - 0.006 - L / 2;
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) root.add(wood(box(L, H - T, L, ash, { r: 0.005, x: sx * lx, z: sz * lz, bottom: true }), 'y'));
  const ah = 0.09, at_ = 0.022, ay = H - T - ah, set = 0.012;
  for (const s of [1, -1]) {
    root.add(wood(box(2 * lx - L, ah, at_, ash, { r: 0.003, y: ay, bottom: true, z: s * (lz + L / 2 - set - at_ / 2) }), 'x'));
    root.add(wood(box(at_, ah, 2 * lz - L, ash, { r: 0.003, y: ay, bottom: true, x: s * (lx + L / 2 - set - at_ / 2) }), 'z'));
  }
  return autoCollider(describe(root, { id: 'dining-table', name: 'Ash dining table', zh: '白蜡木餐桌' }));
}

// =====================================================================================================================
// CH24 Wishbone chair (Hans Wegner) in oiled ash with natural paper-cord seat. Built once, cloned.
const wishboneTemplate = once(() => {
  const wd = MAT.chairAsh(), root = new THREE.Group();
  // steam-bent top rail: U in plan, a flat oval band that is deepest behind the back and thins toward the arm tips
  const half = [[0.236, 0.688, 0.08], [0.258, 0.698, 0.0], [0.253, 0.71, -0.095], [0.208, 0.726, -0.18], [0.112, 0.737, -0.234], [0, 0.74, -0.249]];
  const railPts = [...half, ...half.slice(0, -1).reverse().map(([x, y, z]) => [-x, y, z])];
  const railCurve = new THREE.CatmullRomCurve3(railPts.map(p => new THREE.Vector3(...p)), false, 'centripetal');
  root.add(sweep(railCurve, (t) => {
    const e = Math.min(t, 1 - t), A = 0.0125 + 0.0125 * smooth(0.12, 0.5, e), Bw = 0.0115;
    const k = e < 0.014 ? Math.max(0.2, Math.sqrt(1 - ((0.014 - e) / 0.014) ** 2)) : 1;
    return ell(A * k, Bw * k, 14);
  }, wd, { seg: 120 }));
  // where the back legs meet the rail (side, just behind the seat)
  let best = null; for (let i = 0; i <= 200; i++) { const p = railCurve.getPointAt(i / 400); if (!best || Math.abs(p.z + 0.168) < Math.abs(best.z + 0.168)) best = p; }
  for (const s of [1, -1]) {
    // back leg: from the floor, up past the seat, bending back to carry the rail
    root.add(sweep([[s * 0.197, 0, -0.218], [s * 0.196, 0.2, -0.19], [s * 0.199, 0.425, -0.153], [s * 0.205, 0.56, -0.152], [s * (best.x + 0.205) / 2, 0.645, (best.z - 0.152) / 2 - 0.004], [s * best.x, best.y - 0.006, best.z]],
      (t) => { const r = t < 0.45 ? lerp(0.0125, 0.0168, t / 0.45) : lerp(0.0168, 0.0118, (t - 0.45) / 0.55); return ell(r, r, 12); }, wd, { seg: 40, up: [0, 0, 1] }));
    // front leg, tapered toward the floor
    root.add(rod([s * 0.215, 0, 0.225], [s * 0.215, 0.452, 0.225], 0.0125, 0.0158, wd, 16));
    // stretchers: sides low, front/back higher
    root.add(rod([s * 0.215, 0.165, 0.225], [s * 0.1965, 0.165, -0.195], 0.0105, 0.0105, wd, 10));
  }
  root.add(rod([-0.215, 0.21, 0.225], [0.215, 0.21, 0.225], 0.0105, 0.0105, wd, 10));
  root.add(rod([-0.1965, 0.21, -0.188], [0.1965, 0.21, -0.188], 0.0105, 0.0105, wd, 10));
  // Y splat: stem on the rear seat rail, fork into the top rail; bent to follow the rail's curve
  const Ls = 0.335, th = 0.013;
  const outline = [[-0.0275, 0], [0.0275, 0], [0.03, 0.1], [0.042, 0.155], [0.076, 0.245], [0.098, Ls], [0.054, Ls], [0.03, 0.245], [0, 0.17], [-0.03, 0.245], [-0.054, Ls], [-0.098, Ls], [-0.076, 0.245], [-0.042, 0.155], [-0.03, 0.1]];
  const splat = extrude(outline, th, wd, { bevel: 0.0025 });
  const sp = splat.geometry.attributes.position;
  for (let i = 0; i < sp.count; i++) { const x = sp.getX(i); sp.setZ(i, sp.getZ(i) - th / 2 + 1.6 * x * x); }
  splat.geometry.computeVertexNormals();
  splat.position.set(0, 0.408, -0.163); splat.rotation.x = -Math.atan2(0.085, 0.32); root.add(splat);
  // seat: cord-wrapped rails + dished woven top and flat woven underside
  const cr = MAT.cordWrap(), F = [0.215, 0.433, 0.225], Bk = [0.199, 0.423, -0.153];
  root.add(rod([-F[0], F[1], F[2]], [F[0], F[1], F[2]], 0.0145, 0.0145, cr, 14));
  root.add(rod([-Bk[0], Bk[1], Bk[2]], [Bk[0], Bk[1], Bk[2]], 0.0145, 0.0145, cr, 14));
  for (const s of [1, -1]) root.add(rod([s * F[0], F[1], F[2]], [s * Bk[0], Bk[1], Bk[2]], 0.0145, 0.0145, cr, 14));
  const seatSurf = (yF, yB, dish) => {
    const g = new THREE.PlaneGeometry(1, 1, 18, 18), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const s = p.getX(i) * 2, t = p.getY(i) + 0.5, xh = lerp(F[0], Bk[0], t);
      p.setXYZ(i, s * xh, lerp(yF, yB, t) - dish * (1 - s * s) * Math.pow(4 * t * (1 - t), 0.8), -lerp(-F[2], -Bk[2], t));
    }
    g.computeVertexNormals(); return shadow(new THREE.Mesh(g, MAT.cordSeat()));
  };
  root.add(seatSurf(0.4475, 0.4375, 0.011), seatSurf(0.42, 0.41, 0));
  setMovable(root, { mass: 6, radius: 0.3 });
  addSeat(root, { y: 0.45, z: 0.02, facing: 0, kind: 'chair', back: 1 });
  return autoCollider(describe(ground(root), { id: 'wishbone-chair', name: 'CH24 Wishbone chair', zh: 'Y 椅（叉骨椅）' }));
});

// =====================================================================================================================
// Paper ball pendant (g19–g24): slightly flattened sphere, meridian wire ribs showing through the paper with the paper
// sagging a little between ribs; open at the bottom with a white ring, short white stem to a ceiling canopy.
function buildLantern() {
  const root = new THREE.Group(), cy = 1.95, R = 0.275, Hh = 0.255, nRib = 36;
  const p0 = -Math.acos(0.075 / R), p1 = Math.acos(0.04 / R), prof = [];
  for (let i = 0; i <= 44; i++) { const f = lerp(p0, p1, i / 44); prof.push([R * Math.cos(f), Hh * Math.sin(f)]); }
  const shell = lathe(prof, MAT.lanternPaper(), { seg: nRib * 4, y: cy });
  const g = shell.geometry, pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) { const f = (uv.getX(i) * nRib) % 1, k = 1 - 0.007 * Math.sin(Math.PI * f) ** 2; pos.setX(i, pos.getX(i) * k); pos.setZ(i, pos.getZ(i) * k); }
  g.computeVertexNormals(); shell.castShadow = false; root.add(shell);
  const wm = MAT.whiteMetal(), yTop = cy + Hh * Math.sin(p1), yBot = cy + Hh * Math.sin(p0);
  root.add(torus(0.075, 0.004, wm, { y: yBot, rx: Math.PI / 2, seg: 40, tube: 8 }));
  root.add(torus(0.04, 0.0035, wm, { y: yTop, rx: Math.PI / 2, seg: 24, tube: 8 }));
  for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; root.add(rod([Math.cos(a) * 0.075, yBot, Math.sin(a) * 0.075], [0, cy - 0.06, 0], 0.0018, 0.0018, wm, 6)); }
  root.add(cyl(0.022, 0.022, 0.05, wm, { y: cy - 0.085, bottom: true, seg: 16 }));                       // socket
  const bulb = sphere(0.045, M.emissiveWarm(), { y: cy - 0.005, seg: 20 }); bulb.castShadow = false; root.add(bulb);
  root.add(cyl(0.032, 0.04, 0.025, wm, { y: yTop - 0.005, bottom: true, seg: 20 }));                    // top fitter cap
  root.add(cyl(0.0045, 0.0045, 2.42 - yTop - 0.015, wm, { y: yTop + 0.015, bottom: true, seg: 8 }));             // stem / cord
  root.add(lathe([[0, 2.415], [0.055, 2.415], [0.066, 2.421], [0.07, 2.432], [0.07, 2.44], [0, 2.44]], wm, { seg: 32 }));  // canopy
  root.userData.light = { type: 'point', y: cy, intensity: 4, color: 0xffe7c0, distance: 7 };
  return describe(root, { id: 'dining-pendant', name: 'Paper ball pendant', zh: '纸球吊灯', note: 'hangs from the 2.44 m ceiling; centre at 1.95 m' });
}

// =====================================================================================================================
// Books: one merged mesh, vertex colours per book, spine detail only on the spine face (+Z before placement).
const PAL = ['#1d1d1f', '#23324f', '#9b2a24', '#efe8da', '#f6f3ec', '#2f5b3e', '#c79b3b', '#6d6a64', '#b8462f', '#3a5f7a', '#d9cdb4', '#5a3b2e', '#e2d35a', '#8aa0ae'];
function bookGeo(t, h, d, col, r) {
  const g = new THREE.BoxGeometry(t, h, d), n = g.attributes.position.count, cols = new Float32Array(n * 3), uv = g.attributes.uv;
  const c = new THREE.Color(col), page = new THREE.Color('#ece4d0');
  for (let i = 0; i < n; i++) {
    const face = Math.floor(i / 4), cc = face === 2 || face === 3 || face === 5 ? page : c; cols.set([cc.r, cc.g, cc.b], i * 3);
    if (face !== 4) uv.setXY(i, 0.02, 0.99); else if (r() < 0.25) uv.setXY(i, 0.02, 0.99);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); return g;
}
function shelfBooks(geos, r, x0, x1, y, zFront, { tall = 0.27, pal = PAL } = {}) {
  let x = x0 + 0.005 + r() * 0.02; const m = new THREE.Matrix4();
  while (x < x1 - 0.03) {
    if (r() < 0.07 && x > x0 + 0.06) { x += 0.04 + r() * 0.05; continue; }           // gap
    const t = 0.014 + r() * 0.03, h = tall * (0.66 + r() * 0.34), d = 0.13 + r() * 0.08;
    if (x + t > x1) break;
    const g = bookGeo(t, h, d, pal[Math.floor(r() * pal.length)], r);
    g.applyMatrix4(m.makeTranslation(x + t / 2, y + h / 2, zFront - d / 2 - r() * 0.012)); geos.push(g); x += t + 0.0008;
  }
  return x;
}
function lyingStack(geos, r, x, y, z, n, { w = 0.26, d = 0.21, spine = 'z', rot = 0 } = {}) {
  const m = new THREE.Matrix4(); let yy = y;
  for (let i = 0; i < n; i++) {
    const t = 0.02 + r() * 0.025, ww = w * (0.85 + r() * 0.2), dd = d * (0.85 + r() * 0.2);
    const g = bookGeo(t, ww, dd, PAL[Math.floor(r() * PAL.length)], r);
    g.applyMatrix4(m.makeRotationZ(Math.PI / 2)); if (spine === '-x') g.applyMatrix4(m.makeRotationY(-Math.PI / 2));
    g.applyMatrix4(m.makeRotationY(rot + (r() - 0.5) * 0.08)); g.applyMatrix4(m.makeTranslation(x, yy + t / 2, z)); geos.push(g); yy += t;
  }
}

// Built-in bookcase + reading bench (g23/g24, niche at the window wall). Local frame: the bookcase stands against the
// window wall (local -Z) facing +Z; the bench runs in front of it along +Z inside the niche, its back to the niche wall
// (local +X) and its seat facing -X (into the dining room), with open cubbies of stacked books under the seat.
function buildBookcaseBench() {
  const pw = MAT.blonde(), root = new THREE.Group(), r = rng(7);
  const bx0 = -0.23, bx1 = 0.25, bz0 = -0.735, bz1 = -0.435, H = 2.20, tb = 0.03;     // bookcase
  const sx0 = -0.25, sx1 = 0.25, sz0 = bz1, sz1 = 0.735;                                // bench
  const bw = bx1 - bx0, bd = bz1 - bz0, bcx = (bx0 + bx1) / 2, bcz = (bz0 + bz1) / 2;
  for (const x of [bx0 + tb / 2, bx1 - tb / 2]) root.add(wood(box(tb, H, bd, pw, { r: 0.004, x, z: bcz, bottom: true }), 'y'));
  root.add(wood(box(bw - 2 * tb, 0.012, bd - 0.01, pw, { x: bcx, y: 0.012, z: bcz - 0.005, bottom: true }), 'x'));
  root.add(boxUV(box(bw - 2 * tb, H - 0.02, 0.012, pw, { x: bcx, y: 0.01, z: bz0 + 0.006, bottom: true }), 'y'));  // back
  root.add(wood(box(bw - 2 * tb, 0.06, 0.02, pw, { x: bcx, z: bz1 - 0.03, bottom: true }), 'x'));                  // kick
  const shelfY = [0.06, 0.30, 0.55, 0.96, 1.37, 1.78, H - tb];
  shelfY.forEach((y, i) => root.add(wood(box(bw - (i === 6 ? 0 : 2 * tb), i === 6 ? tb : 0.025, bd - (i === 6 ? 0 : 0.016), pw, { r: 0.003, x: bcx, y, z: bcz + (i === 6 ? 0 : -0.002), bottom: true }), 'x')));
  // books on the four visible shelves, a leaning book and a small vase like g23/g24
  const geos = [], ix0 = bx0 + tb, ix1 = bx1 - tb, zf = bz1 - 0.02;
  shelfBooks(geos, r, ix0, ix0 + 0.12, 1.805, zf, { tall: 0.3, pal: ['#151517', '#1d1d1f', '#2a2a2c'] });
  shelfBooks(geos, r, ix0 + 0.24, ix1, 1.805, zf, { tall: 0.25 });
  shelfBooks(geos, r, ix0, ix0 + 0.06, 1.395, zf);
  { const g = bookGeo(0.025, 0.22, 0.16, '#d9cdb4', r), m = new THREE.Matrix4(); g.applyMatrix4(m.makeRotationZ(-0.95)); g.applyMatrix4(m.makeTranslation(ix0 + 0.15, 1.395 + 0.09, zf - 0.09)); geos.push(g); }
  shelfBooks(geos, r, ix0 + 0.22, ix1, 1.395, zf);
  shelfBooks(geos, r, ix0, ix1 - 0.04, 0.985, zf);
  shelfBooks(geos, r, ix0, ix1 - 0.06, 0.575, zf);
  shelfBooks(geos, r, ix0, ix1 - 0.15, 0.325, zf, { tall: 0.22 });
  // bench: base box with cubbies open to -X, seat board, cushion with piping, linen pillow at the far end
  const seatTop = 0.38, st = 0.025;
  root.add(wood(box(sx1 - sx0, st, sz1 - sz0, pw, { r: 0.004, x: 0, y: seatTop - st, z: (sz0 + sz1) / 2, bottom: true }), 'z'));
  root.add(wood(box(sx1 - sx0, 0.025, sz1 - sz0, pw, { r: 0.003, y: 0.0, z: (sz0 + sz1) / 2, bottom: true }), 'z'));   // bottom board on the floor
  root.add(boxUV(box(0.012, seatTop - st - 0.025, sz1 - sz0 - 0.03, pw, { x: sx1 - 0.006, y: 0.025, z: (sz0 + sz1) / 2, bottom: true }), 'z'));
  for (const z of [sz0 + 0.0125, 0.16, sz1 - 0.0125]) root.add(wood(box(sx1 - sx0, seatTop - st, 0.025, pw, { r: 0.003, z, bottom: true }), 'y'));
  lyingStack(geos, r, -0.06, 0.025, -0.15, 4, { spine: '-x', w: 0.28, d: 0.22 });
  lyingStack(geos, r, -0.07, 0.025, 0.45, 5, { spine: '-x', w: 0.31, d: 0.24 });
  const books = shadow(new THREE.Mesh(mergeGeometries(geos), MAT.books())); root.add(books);
  const vase = lathe([[0, 0], [0.03, 0], [0.042, 0.03], [0.04, 0.08], [0.022, 0.11], [0.024, 0.13], [0.02, 0.13]], M.ceramicWhite(), { seg: 24, x: ix0 + 0.18, y: 1.805, z: zf - 0.08 }); root.add(vase);
  const lin = M.linen(), cw = sx1 - sx0 - 0.005, cd = sz1 - sz0 - 0.04, ccz = (sz0 + sz1) / 2;
  const cush = box(cw, 0.07, cd, lin, { r: 0.022, seg: 4, x: -0.0025, y: seatTop, z: ccz, bottom: true }); cush.scale.set(1, 1.03, 1); root.add(cush);
  for (const y of [seatTop + 0.003, seatTop + 0.067]) root.add(tube(roundRect(cw / 2 - 0.004, cd / 2 - 0.004, 0.02, y).map(([px, py, pz]) => [px - 0.0025, py, pz + ccz]), 0.0045, lin, { seg: 160, radial: 8, closed: true }));
  const pil = puffPillow(0.5, 0.48, 0.16, lin); pil.position.set(0.01, seatTop + 0.07 + 0.235, sz1 - 0.15); pil.rotation.set(0.13, 0.1, 0.04); pil.scale.set(1, 1, 1.15); root.add(pil);
  addSeat(root, { x: -0.04, y: 0.45, z: -0.15, facing: -Math.PI / 2, kind: 'bench' });
  addSeat(root, { x: -0.04, y: 0.45, z: 0.32, facing: -Math.PI / 2, kind: 'bench' });
  return autoCollider(describe(root, { id: 'dining-bookcase-bench', name: 'Built-in bookcase and reading bench', zh: '书柜与靠窗长凳',
    note: 'bookcase against window wall (local -Z); bench runs along +Z in the niche, back to local +X, seat faces -X' }));
}

// =====================================================================================================================
// Office console (g20/g22): long whitewashed reclaimed-wood console, three raised-panel drawers with iron ring pulls,
// square legs with side stretchers; the red tree painting leaning on the wall, a Bose music system, two clay vases
// (fern fronds, dried grass).
function buildConsole({ length = 2.4 } = {}) {
  const Lw = length, D = 0.45, H = 0.80, rw = MAT.limewash(), iron = M.ironBlack(), root = new THREE.Group(), r = rng(31);
  root.add(wood(box(Lw, 0.05, D, rw, { r: 0.008, y: H - 0.05, bottom: true }), 'x'));
  const lg = 0.075, lx = Lw / 2 - 0.03 - lg / 2, lz = D / 2 - 0.03 - lg / 2, zf = D / 2 - 0.03;
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) root.add(wood(box(lg, H - 0.05, lg, rw, { r: 0.006, x: sx * lx, z: sz * lz, bottom: true }), 'y'));
  // case: frieze rail, bottom rail with a bead moulding, sides, back
  root.add(wood(box(2 * lx - lg, 0.03, 0.03, rw, { r: 0.003, y: H - 0.08, z: zf - 0.015, bottom: true }), 'x'));
  root.add(wood(box(2 * lx + lg, 0.04, 0.035, rw, { r: 0.006, y: 0.505, z: zf - 0.012, bottom: true }), 'x'));
  root.add(wood(box(2 * lx + lg + 0.01, 0.014, 0.03, rw, { r: 0.006, y: 0.495, z: zf - 0.005, bottom: true }), 'x'));
  for (const s of [1, -1]) root.add(wood(box(0.02, 0.25, 2 * lz - lg, rw, { x: s * lx, y: 0.5, bottom: true }), 'z'));
  root.add(wood(box(2 * lx, 0.25, 0.02, rw, { y: 0.5, z: -lz, bottom: true }), 'x'));
  const nd = 3, stile = 0.06, dw = (2 * lx - lg - stile * (nd - 1)) / nd, dh = 0.165, dy = 0.548;
  for (let i = 0; i < nd; i++) {
    const cx = -lx + lg / 2 + dw / 2 + i * (dw + stile);
    root.add(wood(box(dw - 0.006, dh, 0.022, rw, { r: 0.004, x: cx, y: dy, z: zf - 0.011, bottom: true }), 'x'));
    root.add(wood(box(dw - 0.09, dh - 0.07, 0.02, rw, { r: 0.008, x: cx, y: dy + 0.035, z: zf + 0.002, bottom: true }), 'x'));   // raised panel
    root.add(cyl(0.014, 0.014, 0.006, iron, { x: cx, y: dy + dh / 2 + 0.012, z: zf + 0.014, rx: Math.PI / 2, seg: 16 }));
    root.add(torus(0.021, 0.0035, iron, { x: cx, y: dy + dh / 2 - 0.01, z: zf + 0.018, seg: 24, tube: 8 }));
    if (i < nd - 1) root.add(wood(box(stile, dh + 0.02, 0.03, rw, { r: 0.003, x: cx + dw / 2 + stile / 2, y: dy - 0.01, z: zf - 0.015, bottom: true }), 'y'));
  }
  for (const s of [1, -1]) root.add(wood(box(0.04, 0.045, 2 * lz, rw, { r: 0.004, x: s * lx, y: 0.12, bottom: true }), 'z'));
  root.add(wood(box(2 * lx, 0.045, 0.035, rw, { r: 0.004, y: 0.12, z: -lz, bottom: true }), 'x'));
  // painting: 0.70 × 0.55 canvas on its bottom edge on the top, leaning 4° back against the wall
  const tilt = THREE.MathUtils.degToRad(4), pW = 0.70, pH = 0.55, pT = 0.03, ed = MAT.canvasEdge();
  const pg = new THREE.Mesh(new THREE.BoxGeometry(pW, pH, pT), [ed, ed, ed, ed, MAT.painting(), ed]); shadow(pg);
  const pb = -D / 2 + 0.06; pg.rotation.x = -tilt; pg.position.set(-0.32, H + Math.cos(tilt) * pH / 2, pb - Math.sin(tilt) * pH / 2); root.add(pg);
  // Bose music system
  const bose = group(box(0.37, 0.105, 0.22, MAT.silverPlastic(), { r: 0.012, bottom: true }), box(0.2, 0.03, 0.004, MAT.darkGlass(), { y: 0.05, z: 0.111, x: -0.02 }), box(0.34, 0.02, 0.004, M.blackMatte(), { y: 0.016, z: 0.109 }));
  root.add(at(bose, -Lw / 2 + 0.42, H, -0.02, 0.05));
  // clay vases with fern fronds and dried grass
  const vm = MAT.clayVase();
  const urn = (h, rMax, neck) => lathe([[0, 0], [rMax * 0.5, 0], [rMax * 0.62, 0.01], [rMax * 0.92, h * 0.3], [rMax, h * 0.52], [rMax * 0.85, h * 0.75], [neck, h * 0.9], [neck * 0.95, h * 0.96], [neck * 1.12, h], [neck * 0.98, h], [neck * 0.85, h * 0.9]], vm, { seg: 40 });
  const v1 = urn(0.34, 0.15, 0.085), v2 = urn(0.42, 0.13, 0.06); root.add(at(v1, Lw / 2 - 0.62, H, -0.04), at(v2, Lw / 2 - 0.25, H, -0.06));
  const fern = MAT.fern();
  for (let k = 0; k < 4; k++) {
    const g = new THREE.PlaneGeometry(0.16, 0.5, 1, 8), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i) + 0.25; p.setZ(i, -0.35 * y * y); p.setY(i, y * 0.95); }
    g.computeVertexNormals(); const f = shadow(new THREE.Mesh(g, fern));
    f.position.set(Lw / 2 - 0.62, H + 0.3, -0.04); f.rotation.set(0, Math.PI + (k - 1.5) * 0.75, 0); f.rotateX(0.1 + (k % 2) * 0.12); root.add(f);
  }
  for (let k = 0; k < 9; k++) {
    const a = 0.2 + r() * (Math.PI - 0.4), len = 0.45 + r() * 0.3, lean = 0.12 + r() * 0.25, base = [Lw / 2 - 0.25, H + 0.38, -0.06];
    const tip = [base[0] + Math.cos(a) * lean * len, base[1] + len, base[2] + Math.sin(a) * lean * len];
    root.add(rod(base, tip, 0.0022, 0.0015, MAT.dried(), 5));
    if (k % 2 === 0) { const pl = sphere(0.018, MAT.plume(), { seg: 10, x: tip[0], y: tip[1] - 0.03, z: tip[2], sx: 0.7, sy: 3.2, sz: 0.7 }); root.add(pl); }
  }
  return autoCollider(describe(root, { id: 'office-console', name: 'Whitewashed reclaimed-wood console', zh: '做旧白洗实木长条桌',
    note: `length ${Lw} m (three ~0.70 m drawers, measured against the 0.70 m painting); pass {length} to change` }));
}

// =====================================================================================================================
// Cognac leather tub chair (g20/g22): one continuous arm/back shell, tall at the back sloping down to the arms, inner
// back reclined; loose seat cushion with piping; tapered light-oak legs.
function buildArmchairLeather() {
  const lea = MAT.cognac(), root = new THREE.Group(), yb = 0.16;
  const path = [[0.302, yb, 0.335], [0.308, yb, 0.2], [0.308, yb, 0.06]];
  for (let k = 1; k <= 11; k++) { const f = (k / 12) * Math.PI; path.push([0.308 * Math.cos(f), yb, 0.06 - 0.385 * Math.sin(f)]); }
  path.push([-0.308, yb, 0.06], [-0.308, yb, 0.2], [-0.302, yb, 0.335]);
  const sec = (t) => {
    const e = Math.min(t, 1 - t), back = smooth(0.1, 0.42, e), top = 0.585 + 0.125 * back - (e < 0.02 ? 0.03 * (1 - e / 0.02) ** 2 : 0), Hs = top - yb, nose = e < 0.04 ? Math.max(0.38, Math.sqrt(1 - ((0.04 - e) / 0.04) ** 2)) : 1, w = (0.115 + 0.03 * back) * nose, lean = (0.015 + 0.06 * back) * nose;
    const pts = [], m = 6, rt = (w - lean) / 2, ac = Hs - rt, bc = w / 2 - rt;
    pts.push([0, -w / 2 + 0.01], [0, w / 2 - 0.01]);
    for (let i = 0; i <= m; i++) { const a = (i / m) * ac; pts.push([a, w / 2 + 0.012 * Math.sin(Math.PI * a / ac)]); }
    for (let i = 1; i < 10; i++) { const th = (i / 10) * Math.PI; pts.push([ac + rt * Math.sin(th), bc + rt * Math.cos(th)]); }
    for (let i = m; i >= 1; i--) { const a = (i / m) * ac; pts.push([a, -w / 2 + lean * Math.pow(a / ac, 1.5)]); }
    return pts;
  };
  root.add(sweep(path, sec, lea, { seg: 110 }));
  // base deck + loose cushion (plan outline: straight front, round back), outline drawn as (x, -z)
  const outline = (hw, zf, zc, rz) => { const o = [[hw, -zf], [hw, -zc]]; for (let k = 1; k < 12; k++) { const f = (k / 12) * Math.PI; o.push([hw * Math.cos(f), -(zc - rz * Math.sin(f))]); } o.push([-hw, -zc], [-hw, -zf]); return o; };
  const deck = extrude(outline(0.27, 0.37, 0.06, 0.3), 0.16, lea, { bevel: 0.01, rx: -Math.PI / 2, y: yb }); root.add(deck);
  const cuShape = new THREE.Shape(outline(0.225, 0.345, 0.06, 0.26).map(([x, y]) => new THREE.Vector2(x, y)));
  const cu = shadow(new THREE.Mesh(new THREE.ExtrudeGeometry(cuShape, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.035, bevelSegments: 6, curveSegments: 24 }), lea));
  cu.rotation.x = -Math.PI / 2; cu.position.y = 0.32 + 0.035 + 0.002; root.add(cu);
  const pipe = outline(0.26, 0.38, 0.06, 0.295).map(([x, y]) => [x, 0.3995, -y]);
  root.add(tube(pipe, 0.005, lea, { seg: 120, radial: 8, closed: true }));
  const leg = MAT.oakLeg();
  for (const [sx, z0, z1] of [[1, 0.27, 0.3], [-1, 0.27, 0.3], [1, -0.22, -0.26], [-1, -0.22, -0.26]]) root.add(rod([sx * 0.3, 0, z1], [sx * 0.265, yb + 0.01, z0], 0.014, 0.021, leg, 16));
  setMovable(root, { mass: 18, radius: 0.42 });
  addSeat(root, { y: 0.42, z: 0.04, facing: 0, kind: 'armchair', back: 1 });
  return autoCollider(describe(ground(root), { id: 'office-armchair', name: 'Cognac leather tub chair', zh: '干邑色皮革圆桶扶手椅' }));
}

// =====================================================================================================================
// Black leather sling chair on a light oak frame (g20/g22): one leather piece wrapped over the top rail, hanging as the
// back and sagging into the seat before wrapping the front rail.
function buildSlingChair() {
  const oak = MAT.oakLeg(), root = new THREE.Group(), xs = 0.285, rr = 0.018;
  for (const s of [1, -1]) {
    const x = s * xs;
    root.add(rod([x, 0, 0.30], [x, 0.445, 0.30], 0.016, rr, oak, 14));                                         // front leg
    root.add(rod([x, 0, -0.2], [x, 0.765, -0.31], 0.016, rr, oak, 14));                                        // back leg
    root.add(rod([x, 0.42, 0.30], [x, 0.42, -0.26], 0.015, 0.015, oak, 12));                                  // seat side rail
    root.add(rod([x, 0.14, 0.30], [x, 0.14, -0.22], 0.0135, 0.0135, oak, 12));                                // low side stretcher
    root.add(sphere(rr, oak, { x, y: 0.765, z: -0.31, seg: 12 }));
  }
  root.add(rod([-xs - 0.015, 0.745, -0.306], [xs + 0.015, 0.745, -0.306], 0.016, 0.016, oak, 14));             // top rail
  root.add(rod([-xs, 0.42, 0.30], [xs, 0.42, 0.30], 0.016, 0.016, oak, 14));                                    // front rail
  root.add(rod([-xs, 0.12, 0.30], [xs, 0.12, 0.30], 0.0135, 0.0135, oak, 12));
  root.add(rod([-xs, 0.2, -0.229], [xs, 0.2, -0.229], 0.0135, 0.0135, oak, 12));
  const sling = [[0, 0.68, -0.33], [0, 0.735, -0.329], [0, 0.765, -0.313], [0, 0.755, -0.29], [0, 0.68, -0.272], [0, 0.58, -0.245], [0, 0.47, -0.19], [0, 0.41, -0.09], [0, 0.39, 0.02],
    [0, 0.405, 0.16], [0, 0.428, 0.275], [0, 0.442, 0.306], [0, 0.425, 0.323], [0, 0.39, 0.322]];
  const wS = 2 * xs - 2 * rr - 0.01;
  const slingSec = []; for (let i = 0; i <= 12; i++) slingSec.push([-0.0028, lerp(-wS / 2, wS / 2, i / 12)]); for (let i = 12; i >= 0; i--) slingSec.push([0.0028, lerp(-wS / 2, wS / 2, i / 12)]);
  root.add(sweep(sling, () => slingSec, M.leatherBlack(), { seg: 90, up: [0, 0, 1] }));
  setMovable(root, { mass: 7, radius: 0.36 });
  addSeat(root, { y: 0.40, z: 0.05, facing: 0, kind: 'chair', back: 1 });
  return autoCollider(describe(ground(root), { id: 'office-sling-chair', name: 'Black leather sling chair', zh: '黑色皮革吊带椅' }));
}

// =====================================================================================================================
// Small white desk with a 24" monitor on a black stand, slim keyboard and mouse.
function buildDeskWhite() {
  const wt = M.cabinetWhite(), root = new THREE.Group(), W = 1.0, D = 0.5, H = 0.75;
  root.add(box(W, 0.03, D, wt, { r: 0.004, y: H - 0.03, bottom: true }));
  const lg = 0.045;
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) root.add(box(lg, H - 0.03, lg, wt, { r: 0.003, x: sx * (W / 2 - 0.02 - lg / 2), z: sz * (D / 2 - 0.02 - lg / 2), bottom: true }));
  for (const s of [1, -1]) { root.add(box(W - 0.04 - 2 * lg, 0.07, 0.018, wt, { r: 0.002, y: H - 0.1, z: s * (D / 2 - 0.03), bottom: true })); root.add(box(0.018, 0.07, D - 0.04 - 2 * lg, wt, { r: 0.002, y: H - 0.1, x: s * (W / 2 - 0.03), bottom: true })); }
  const bk = M.blackMatte(), mz = -0.12;
  root.add(box(0.24, 0.012, 0.19, bk, { r: 0.004, y: H, z: mz, bottom: true }));
  root.add(box(0.05, 0.36, 0.025, bk, { r: 0.006, y: H + 0.01, z: mz - 0.05, bottom: true }));
  const panelY = H + 0.11 + 0.165;
  root.add(box(0.545, 0.325, 0.014, bk, { r: 0.004, y: panelY, z: mz - 0.025 }));
  root.add(box(0.36, 0.2, 0.03, bk, { r: 0.02, y: panelY, z: mz - 0.045 }));
  root.add(plane(0.528, 0.298, MAT.beach(), { y: panelY + 0.006, z: mz - 0.017 }));
  root.add(box(0.29, 0.008, 0.115, MAT.silverPlastic(), { r: 0.003, y: H, z: 0.09, bottom: true }));
  root.add(box(0.275, 0.004, 0.1, M.plasticWhite(), { r: 0.0015, y: H + 0.007, z: 0.09, bottom: true }));
  root.add(sphere(0.03, M.plasticWhite(), { x: 0.24, y: H + 0.006, z: 0.09, sx: 0.65, sy: 0.3, sz: 1.0, seg: 16 }));
  return autoCollider(describe(root, { id: 'office-desk', name: 'Small white desk with monitor', zh: '白色小书桌与显示器' }));
}

export const items = {
  table: () => buildTable(),
  wishboneChair: () => wishboneTemplate().clone(),
  bookcaseBench: () => buildBookcaseBench(),
  lantern: () => buildLantern(),
  console: (opts) => buildConsole(opts),
  armchairLeather: () => buildArmchairLeather(),
  slingChair: () => buildSlingChair(),
  deskWhite: () => buildDeskWhite(),
};
