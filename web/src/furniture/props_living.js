// Small styling props for the living room, dining room, office and family room (listing photos g08–g11, g19–g25, g51).
// Frame per kit.js: origin at the centre of the footprint on the surface the prop rests on, +Z = front. Wall pieces keep
// their back face on z = 0 and carry their own hanging height. Seeded builders are placed with { seed } in styling_living.js.
import { THREE, M, box, cyl, torus, tube, extrude, plane, at, setCollider, setMovable, describe, shadow } from '../kit.js';
import { MAT as DMAT } from './dining_parts.js';
import { wbox, rrect, bookStack } from './living_parts.js';
import { leafMat, orient, dirOf, GOLD, texHeart } from './plants_parts.js';
import {
  lcg, rr, L, hollow, smoothProfile, lathe, latheMetric, drape, waveBowlGeo, driedSpray, texFiddle, texSansevieria, texPilea,
  cardGeo, stemGeo, Batch, plainMat,
} from './props_living_parts.js';

const add3 = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const recentre = (g) => { g.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(g); const o = new THREE.Group(); g.position.x -= (b.min.x + b.max.x) / 2; g.position.z -= (b.min.z + b.max.z) / 2; o.add(g); return o; };

// ================================================================ LIVING ROOM
// Coffee table (g08/g10/g51): egg-shaped matte white jar Ø0.23 × 0.25 with a small rolled mouth, a cloud of dried
// baby's breath on fine stems.
function vaseGypsophila() {
  const root = new THREE.Group();
  const outer = [[0.06, 0], [0.09, 0.012], [0.11, 0.05], [0.117, 0.11], [0.11, 0.17], [0.086, 0.215], [0.055, 0.242], [0.042, 0.25], [0.043, 0.257]];
  root.add(lathe(hollow(outer, 0.006, 0.02), L.matteWhite(), { seg: 44 }));
  root.add(driedSpray(11, { mouth: [0, 0.255, 0], rMouth: 0.04, spread: 0.15, height: 0.14, stems: 16, branches: 7, florets: 10 }));
  return describe(root, { id: 'props-vase-gypsophila', name: "Matte white jar with dried baby's breath", zh: '白陶罐 · 满天星干花' });
}

// Folding wooden chess box (g08/g51): two 21 mm halves, maple/walnut squares on top, brass hinges and catches.
function chessBox() {
  const root = new THREE.Group(), W = 0.3, D = 0.15, h = 0.0215, gap = 0.0015;
  for (const y of [h / 2, h * 1.5 + gap]) root.add(wbox(W, h, D, M.oak(), { r: 0.0025, seg: 2, y, tile: 1, grain: 0 }));
  root.add(box(W - 0.005, gap + 0.0004, D - 0.005, L.chessSeam(), { y: h + gap / 2 }));
  const top = shadow(new THREE.Mesh(new THREE.PlaneGeometry(W - 0.006, D - 0.006), L.chessTop())); top.rotation.x = -Math.PI / 2; top.position.y = 2 * h + gap + 0.0004; root.add(top);
  for (const s of [-1, 1]) {
    root.add(box(0.028, 0.012, 0.0015, L.brass(), { x: s * 0.088, y: h + gap / 2, z: -D / 2 - 0.0006 }));
    root.add(box(0.014, 0.017, 0.002, L.brass(), { r: 0.0008, x: s * 0.088, y: h + gap / 2, z: D / 2 + 0.0008 }));
    root.add(cyl(0.0034, 0.0034, 0.0022, L.brass(), { seg: 12, x: s * 0.088, y: h - 0.002, z: D / 2 + 0.002, rx: Math.PI / 2 }));
  }
  return describe(root, { id: 'props-chess-box', name: 'Folding wooden chess box', zh: '折叠木棋盘' });
}

// Window-seat cushion (g08/g10): white-washed ash riser slab on a recessed plinth, a small pewter-glazed jug and cup.
function seatTray() {
  const root = new THREE.Group(), A = L.whiteAsh(), top = 0.048;
  root.add(wbox(0.3, 0.016, 0.18, A, { r: 0.002, y: 0.008, tile: 0.5, grain: 0, seed: 3 }));
  root.add(wbox(0.4, 0.032, 0.27, A, { r: 0.003, seg: 2, y: 0.032, tile: 0.5, grain: 0, seed: 4 }));
  const jug = new THREE.Group(), G = L.pewterGlaze();
  jug.add(lathe(hollow([[0.024, 0], [0.031, 0.008], [0.033, 0.03], [0.029, 0.052], [0.02, 0.074], [0.018, 0.086], [0.021, 0.098]], 0.003, 0.006), G, { seg: 28 }));
  jug.add(tube([[-0.03, 0.03, 0], [-0.046, 0.038, 0], [-0.05, 0.058, 0], [-0.04, 0.078, 0], [-0.018, 0.084, 0]], 0.0035, G, { seg: 20, radial: 6 }));
  jug.add(cyl(0.004, 0.009, 0.016, G, { seg: 10, x: 0.021, y: 0.093, rz: -0.95 }));
  jug.position.set(0.12, top, -0.055); jug.rotation.y = 0.5; root.add(jug);
  const cup = lathe(hollow([[0.016, 0], [0.022, 0.005], [0.026, 0.03], [0.027, 0.038]], 0.0025, 0.004), L.greyGlaze(), { seg: 24 }); cup.position.set(0.058, top, -0.03); root.add(cup);
  return describe(root, { id: 'props-seat-tray', name: 'White-washed ash riser with jug and cup', zh: '白洗木托盘 · 小壶与杯' });
}

// Alcove beside the hall opening (g19/g51): antique carved side table, distressed limewash, fish-scale apron, books on
// the low shelf.
function sideTableCarved() {
  const root = new THREE.Group(), lw = DMAT.limewash(), W = 0.42, D = 0.32, H = 0.56, t = 0.035, lg = 0.05, inX = W / 2 - 0.03 - lg / 2, inZ = D / 2 - 0.03 - lg / 2;
  root.add(wbox(W, t, D, lw, { r: 0.005, y: H - t / 2, tile: 1, seed: 7 }));
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) root.add(wbox(lg, H - t, lg, lw, { r: 0.004, x: sx * inX, z: sz * inZ, y: (H - t) / 2, tile: 1, seed: 8 + sx + sz * 3 }));
  const ah = 0.1, ay = H - t - ah / 2;
  for (const s of [-1, 1]) {
    root.add(box(2 * inX - lg, ah, 0.02, L.scallop(), { y: ay, z: s * (inZ + lg / 2 - 0.012) }));
    root.add(box(0.02, ah, 2 * inZ - lg, L.scallop(), { x: s * (inX + lg / 2 - 0.012), y: ay }));
    root.add(box(2 * inX - lg, 0.045, 0.016, L.scallop(), { y: 0.075, z: s * (inZ + lg / 2 - 0.01) }));
  }
  root.add(wbox(2 * inX + lg - 0.004, 0.02, 2 * inZ + lg - 0.004, lw, { r: 0.003, y: 0.108, tile: 1, seed: 12 }));
  const bk = recentre(bookStack(2, 41, ['cream', 'black'], { wMin: 0.2, wMax: 0.24, dMin: 0.16, dMax: 0.19 })); bk.position.set(0.02, 0.118, 0.0); bk.rotation.y = 0.08; root.add(bk);
  setCollider(root, { w: W, d: D, h: H });
  return describe(root, { id: 'props-side-table-carved', name: 'Antique carved side table', zh: '雕花旧木边几' });
}

// White cylinder on the carved table (g19): an aroma diffuser with a small LED display.
function diffuserWhite() {
  const root = new THREE.Group(), P = M.plasticWhite();
  root.add(lathe(smoothProfile([[0.001, 0], [0.066, 0], [0.071, 0.006], [0.072, 0.03], [0.072, 0.168], [0.067, 0.186], [0.05, 0.193], [0.001, 0.195]], 26), P, { seg: 44 }));
  root.add(cyl(0.012, 0.012, 0.002, L.darkGlass(), { y: 0.195, seg: 20 }));
  root.add(box(0.032, 0.013, 0.003, L.darkGlass(), { r: 0.001, y: 0.112, z: 0.0712 }));
  for (const x of [-0.006, 0.004]) root.add(box(0.006, 0.006, 0.001, L.led(), { x, y: 0.112, z: 0.0735 }));
  return describe(root, { id: 'props-diffuser', name: 'White aroma diffuser', zh: '白色香薰机' });
}

// Oatmeal linen throw folded lengthwise and hung over the sofa arm (arm 0.12 wide, top at the origin; −X = seat side).
function throwDraped() {
  const a = 0.06 + 0.0045 + 0.003, rc = 0.028, T = 0.007, c = T / 2 + 0.0015, ax = a + c, ex = a - rc, R = rc + c;
  const pts = [[-ax - 0.055, -0.150], [-ax - 0.02, -0.152], [-ax - 0.003, -0.138], [-ax, -0.11], [-ax, -0.06], [-ax, -rc]];
  for (let i = 1; i < 6; i++) { const t = Math.PI - (i / 6) * Math.PI / 2; pts.push([-ex + Math.cos(t) * R, -rc + Math.sin(t) * R]); }
  pts.push([-ex, c], [0, c], [ex, c]);
  for (let i = 1; i < 6; i++) { const t = Math.PI / 2 - (i / 6) * Math.PI / 2; pts.push([ex + Math.cos(t) * R, -rc + Math.sin(t) * R]); }
  pts.push([ax, -rc], [ax, -0.08], [ax, -0.18], [ax, -0.28], [ax + 0.004, -0.34], [ax + 0.014, -0.375]);
  const fold = (u, z, x, y) => {
    const hang = Math.min(1, Math.max(0, (-y - 0.03) / 0.3)), side = x > 0 ? 1 : 0.35;
    return hang * side * (0.016 * (0.5 + 0.5 * Math.sin(z * 31 + 0.7 + y * 4)) + 0.007 * (0.5 + 0.5 * Math.sin(z * 67 + 2.1))) + 0.004 * Math.max(0, Math.sin(z * 9 + 1.3)) * hang;
  };
  const root = new THREE.Group();
  root.add(drape(pts, 0.48, T, L.linenOat(), { fold, nu: 90, nz: 48, tileU: 1, tileV: 1 }));
  return describe(root, { id: 'props-throw-draped', name: 'Linen throw over the sofa arm', zh: '沙发扶手上的亚麻毯' });
}

// Window-seat corner shelf (g08): two brass tealight cups and a tiny brass bud vase.
function brassMiniatures() {
  const root = new THREE.Group(), B = L.brass();
  const tl = (x, z) => { const g = new THREE.Group(); g.add(lathe(hollow([[0.016, 0], [0.02, 0.003], [0.021, 0.022], [0.022, 0.025]], 0.0015, 0.002), B, { seg: 24 })); g.add(cyl(0.018, 0.018, 0.013, L.wax(), { seg: 20, y: 0.0085 })); g.add(cyl(0.0008, 0.0008, 0.006, L.coffee(), { seg: 4, y: 0.018 })); g.position.set(x, 0, z); return g; };
  root.add(tl(-0.055, 0.008), tl(0.0, -0.01));
  root.add(at(lathe(hollow([[0.011, 0], [0.017, 0.018], [0.012, 0.042], [0.006, 0.058], [0.008, 0.064]], 0.0015, 0.004), B, { seg: 20 }), 0.052, 0, 0.004));
  return describe(root, { id: 'props-brass-miniatures', name: 'Brass tealights and bud vase', zh: '黄铜小烛台与小花瓶' });
}

// Trailing golden pothos in a small white pot (west tower cubby, facing the front door); vines spill toward +Z.
function trailingPothos(seed = 1) {
  const r = lcg(seed * 71 + 3), root = new THREE.Group();
  root.add(lathe(hollow([[0.045, 0], [0.05, 0.004], [0.06, 0.085], [0.062, 0.09]], 0.004, 0.01), L.matteWhite(), { seg: 32 }));
  const soil = shadow(new THREE.Mesh(new THREE.CircleGeometry(0.056, 24), L.soil())); soil.rotation.x = -Math.PI / 2; soil.position.y = 0.08; root.add(soil);
  const vines = new Batch(), leaves = new Batch(), leaf = cardGeo(0.055, 0.065, { sx: 2, sy: 3, bend: 0.35, fold: 0.1 });
  const n = 7;
  for (let i = 0; i < n; i++) {
    const yaw = (i / n - 0.5) * 2.2 + rr(r, -0.15, 0.15), drop = i % 3 === 0 ? rr(r, 0.05, 0.12) : rr(r, 0.18, 0.34), reach = rr(r, 0.12, 0.2);
    const p0 = [Math.sin(yaw) * 0.03, 0.082, Math.cos(yaw) * 0.03], p1 = [Math.sin(yaw) * 0.08, 0.1, Math.cos(yaw) * 0.08 + 0.02];
    const p2 = [Math.sin(yaw) * reach * 0.7, 0.07, reach], p3 = [Math.sin(yaw) * reach * 0.8 + rr(r, -0.02, 0.02), 0.07 - drop, reach + 0.03];
    const sg = stemGeo([p0, p1, p2, p3], [0.0022, 0.0015], { seg: 14, radial: 4 }), cv = sg.userData.curve;
    vines.add(sg, { tint: new THREE.Color('#6f9a45').toArray() });
    const m = 6 + Math.floor(r() * 4);
    for (let j = 0; j < m; j++) {
      const t = 0.12 + 0.86 * j / (m - 1), P = cv.getPointAt(t).toArray(), side = j % 2 ? 1 : -1, ly = yaw + side * rr(r, 0.9, 1.6);
      leaves.add(leaf, { pos: P, q: orient(ly, rr(r, 1.1, 1.7), rr(r, -0.4, 0.4)), s: rr(r, 0.75, 1.15) * (1 - 0.25 * t), tint: [rr(r, 0.9, 1.08), rr(r, 0.92, 1.06), rr(r, 0.9, 1.04)] });
    }
  }
  for (let k = 0; k < 6; k++) { const yaw = k * GOLD * 2; leaves.add(leaf, { pos: [Math.sin(yaw) * 0.02, 0.085, Math.cos(yaw) * 0.02], q: orient(yaw, rr(r, 0.4, 0.9), 0), s: rr(r, 0.9, 1.2) }); }
  root.add(vines.mesh(plainMat('propsVine', 0xffffff, { rough: 0.6 })), leaves.mesh(leafMat('propsPothos', texHeart(), { rough: 0.4 })));
  return describe(root, { id: 'props-trailing-pothos', name: 'Trailing pothos in a white pot', zh: '垂吊绿萝' });
}

// A pair of small vessels for an open cubby: matte white bottle vase with two dried stems, a low stoneware bowl.
function vesselsPair() {
  const root = new THREE.Group();
  const bottle = lathe(hollow([[0.03, 0], [0.042, 0.012], [0.046, 0.06], [0.036, 0.1], [0.014, 0.13], [0.011, 0.15], [0.013, 0.156]], 0.004, 0.012), L.matteWhite(), { seg: 32 });
  bottle.position.set(-0.04, 0, -0.02); root.add(bottle);
  const st = new Batch(); for (const [dx, dz, h] of [[0.03, 0.01, 0.17], [-0.035, 0.02, 0.13]]) st.add(stemGeo([[0, 0.12, 0], [dx * 0.4, 0.2, dz * 0.4], [dx, 0.12 + h, dz]], [0.0016, 0.0008], { seg: 6, radial: 3 }), { tint: new THREE.Color('#a08f6a').toArray() });
  const stems = st.mesh(plainMat('propsDriedStem', 0xffffff, { rough: 0.85 })); stems.position.set(-0.04, 0, -0.02); root.add(stems);
  const bowl = latheMetric(hollow([[0.03, 0], [0.055, 0.012], [0.072, 0.035], [0.076, 0.05]], 0.006, 0.008), L.stoneware(), { seg: 36, tile: 0.18, circ: 0.48 });
  bowl.position.set(0.06, 0, 0.02); root.add(bowl);
  return describe(root, { id: 'props-vessels-pair', name: 'White bottle vase and stoneware bowl', zh: '白瓶与粗陶碗' });
}

// ================================================================ HALLWAY
// Framed print in a thin oak frame with a wide white mat (seed 1 palm-leaf drawing, 2 arch and sun, 3 large clay field).
function printFramed(seed = 1) {
  const big = seed % 3 === 0, w = big ? 0.6 : 0.4, h = big ? 0.8 : 0.5, fw = 0.022, fd = 0.024, cy = big ? 1.45 : 1.5, mb = big ? 0.085 : 0.06;
  const root = new THREE.Group();
  root.add(extrude(rrect(w, h, 0.002, 2), fd, L.frameOak(), { bevel: 0.0012, holes: [rrect(w - 2 * fw, h - 2 * fw, 0.001, 2).reverse()], y: cy, z: 0.0015 }));
  root.add(box(w - 2 * fw + 0.002, h - 2 * fw + 0.002, 0.003, L.matBoard(), { y: cy, z: fd - 0.006 }));
  root.add(plane(w - 2 * fw - 2 * mb, h - 2 * fw - 2 * mb, L.print(seed), { y: cy + (big ? 0.0 : 0.004), z: fd - 0.0044 }));
  root.add(box(w - 0.01, h - 0.01, 0.004, L.darkGlass(), { y: cy, z: 0.004 }));
  return describe(root, { id: 'props-print-' + seed, name: 'Framed print', zh: '装框版画', note: 'back on z = 0 (wall face)' });
}

// Flat-woven cotton runner 0.66 × 2.6 with charcoal pin stripes and short fringes.
function runnerRug() {
  const root = new THREE.Group(), w = 0.66, d = 2.6, t = 0.006, r = lcg(77);
  const m = box(w, t, d, L.runner(), { r: 0.002, y: t / 2 }); m.castShadow = false; root.add(m);
  const fr = new Batch(), g = new THREE.BoxGeometry(0.0035, 0.002, 0.038);
  for (const s of [-1, 1]) for (let i = 0; i < 48; i++) fr.add(g, { pos: [-w / 2 + 0.012 + i * (w - 0.024) / 47, 0.0012, s * (d / 2 + 0.017)], q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rr(r, -0.25, 0.25)) });
  const fm = fr.mesh(plainMat('propsFringe', 0xe6e0d3, { rough: 0.95 })); fm.castShadow = false; root.add(fm);
  return describe(root, { id: 'props-runner', name: 'Striped cotton runner', zh: '走廊条纹地毯' });
}

// ================================================================ DINING
// Centrepiece (g20/g23/g24): round, pitted sandy stoneware jar Ø0.22 × 0.2 with a dense bunch of dried pink limonium.
function vaseHeather() {
  const root = new THREE.Group();
  const outer = [[0.062, 0], [0.086, 0.01], [0.105, 0.045], [0.112, 0.09], [0.104, 0.135], [0.08, 0.168], [0.057, 0.186], [0.05, 0.195], [0.053, 0.203]];
  root.add(latheMetric(hollow(outer, 0.007, 0.02), L.stoneware(), { seg: 44, tile: 0.18, circ: 0.7 }));
  root.add(driedSpray(23, { mouth: [0, 0.2, 0], rMouth: 0.045, spread: 0.12, height: 0.12, stems: 15, branches: 7, florets: 8, fSize: [0.0032, 0.005],
    fCols: ['#b98593', '#a46f7d', '#c99ba6', '#93606d', '#d0aab1'], stemCol: '#5e4b3c' }));
  return describe(root, { id: 'props-vase-heather', name: 'Stoneware jar with dried pink limonium', zh: '粗陶罐 · 粉色干花' });
}

// Long hand-carved walnut tray 0.56 × 0.14 (g23), laid in front of the centrepiece.
function boardWalnut() {
  const root = new THREE.Group(), W = M.walnut(), w = 0.56, d = 0.14, h = 0.02, lip = 0.011, bv = 0.0015;
  const base = extrude(rrect(w, d, 0.014), 0.006, W, { bevel: bv, rx: -Math.PI / 2, y: bv });
  const rim = extrude(rrect(w, d, 0.014), h - 2 * bv, W, { bevel: bv, rx: -Math.PI / 2, y: bv, holes: [rrect(w - 2 * lip, d - 2 * lip, 0.008).reverse()] });
  for (const m of [base, rim]) { const uv = m.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + 0.37, uv.getY(i) + 0.21); root.add(m); }
  return describe(root, { id: 'props-walnut-tray', name: 'Long walnut tray', zh: '胡桃木长托盘' });
}

// Fiddle-leaf fig in a seagrass belly basket (dining corner by the closet wall). Canopy kept within 0.30 m of the trunk.
function fiddleFig(seed = 1) {
  const r = lcg(seed * 131 + 9), root = new THREE.Group();
  root.add(...seagrassBasket(0.21, 0.36));
  const soil = shadow(new THREE.Mesh(new THREE.CircleGeometry(0.176, 32), L.soil())); soil.rotation.x = -Math.PI / 2; soil.position.y = 0.325; root.add(soil);
  const soilY = 0.325, Ht = rr(r, 1.5, 1.62), lx = rr(r, -0.03, 0.03), lz = rr(r, -0.03, 0.03);
  const tp = (t) => [lx * t * 2 + 0.015 * Math.sin(t * 5 + seed), soilY + t * (Ht - soilY), lz * t * 2 + 0.015 * Math.cos(t * 4 + seed)];
  root.add(shadow(new THREE.Mesh(stemGeo([0, 0.2, 0.45, 0.7, 0.88, 1].map(tp), [0.017, 0.006], { seg: 14, radial: 8 }), L.bark())));
  const pet = new Batch(), lb = new Batch(), n = 34, Rmax = 0.3;
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1), t = 0.3 + 0.7 * Math.pow(f, 0.8), P = tp(t), yaw = i * GOLD + rr(r, -0.2, 0.2);
    let Ls = rr(r, 0.24, 0.31) * (t > 0.92 ? 0.62 : t > 0.82 ? 0.82 : 1), tilt = 1.25 - 0.75 * f + rr(r, -0.1, 0.1);
    const bend = rr(r, 0.25, 0.45), base = Math.hypot(P[0], P[2]) + 0.035 * Math.sin(tilt);
    const reach = () => base + Ls * Math.sin(Math.min(Math.PI / 2, tilt + bend * 0.6));
    while (reach() > Rmax && Ls > 0.16) Ls *= 0.94;
    while (reach() > Rmax && tilt > 0.2) tilt -= 0.05;
    const d = dirOf(yaw, Math.min(1.4, tilt + 0.25)), E = add3(P, d, 0.035);
    pet.add(stemGeo([P, add3(P, d, 0.018), E], [0.0035, 0.0028], { seg: 3, radial: 4 }), { tint: new THREE.Color('#5d6b3a').toArray() });
    lb.add(cardGeo(Ls * 0.74, Ls, { sx: 3, sy: 5, bend, pow: 1.4, fold: -0.08, twist: rr(r, -0.2, 0.2) }), { pos: E, q: orient(yaw, tilt, rr(r, -0.25, 0.25)), tint: [rr(r, 0.88, 1.05), rr(r, 0.9, 1.06), rr(r, 0.88, 1.02)] });
  }
  root.add(pet.mesh(plainMat('propsPetiole', 0xffffff, { rough: 0.7 })), lb.mesh(leafMat('propsFiddle', texFiddle(), { rough: 0.32, env: 0.9 })));
  setCollider(root, { w: 0.42, d: 0.42, h: 1.6 });
  return describe(root, { id: 'props-fiddle-fig', name: 'Fiddle-leaf fig in a seagrass basket', zh: '琴叶榕 · 海草编篮' });
}
// Belly basket of plaited seagrass: outer skin, inner skin, rolled rim, two rope handles. rB = belly radius, H = height.
function seagrassBasket(rB, H) {
  const prof = smoothProfile([[rB * 0.74, 0], [rB * 0.92, H * 0.17], [rB, H * 0.45], [rB * 0.98, H * 0.72], [rB * 0.9, H * 0.92], [rB * 0.88, H]], 24);
  const out = latheMetric([[0.001, 0.001], ...prof], L.seagrass(), { seg: 48, tile: 0.14, circ: 2 * Math.PI * rB });
  const inn = latheMetric(prof.map(([q, y]) => [q - 0.01, Math.max(0.012, y)]), L.seagrassIn(), { seg: 48, tile: 0.14, circ: 2 * Math.PI * rB });
  const rim = torus(rB * 0.88 - 0.004, 0.011, L.seagrass(), { seg: 56, tube: 8, y: H, rx: Math.PI / 2 });
  const floor = shadow(new THREE.Mesh(new THREE.CircleGeometry(rB * 0.74 - 0.008, 32), L.seagrass())); floor.rotation.x = -Math.PI / 2; floor.position.y = 0.012;
  const parts = [out, inn, rim, floor];
  for (const s of [-1, 1]) parts.push(torus(0.028, 0.0055, L.rope(), { seg: 16, tube: 6, arc: Math.PI, x: s * (rB * 0.93 + 0.004), y: H * 0.8, ry: Math.PI / 2 }));
  return parts;
}

// ================================================================ DINING NICHE BENCH
// Folded taupe linen throw: four layers with a soft roll on the front fold.
function throwFolded() {
  const root = new THREE.Group(), C = L.linenTaupe(), n = 4, t = 0.012, w = 0.44, d = 0.3;
  for (let i = 0; i < n; i++) root.add(box(w - i * 0.004, t + 0.002, d - i * 0.004, C, { r: t / 2, seg: 3, y: t / 2 + 0.001 + i * t, x: i % 2 ? 0.003 : -0.002, z: i % 2 ? -0.003 : 0.001 }));
  root.add(cyl(n * t / 2, n * t / 2, w - 0.012, C, { seg: 18, rz: Math.PI / 2, y: n * t / 2 + 0.001, z: d / 2 - n * t / 2 + 0.002 }));
  return describe(root, { id: 'props-throw-folded', name: 'Folded linen throw', zh: '叠好的亚麻毯' });
}
// A short stack of hardcovers (seeded colours and sizes), centred on its footprint.
function books(seed = 1) {
  const pal = [['cream', 'black', 'tan'], ['white', 'navy', 'grey', 'cream'], ['black', 'olive', 'cream'], ['tan', 'white', 'red']][seed % 4];
  const root = recentre(bookStack(2 + (seed % 3), 300 + seed, pal, { wMin: 0.17, wMax: 0.24, dMin: 0.22, dMax: 0.28 }));
  return describe(root, { id: 'props-books-' + seed, name: 'Stack of books', zh: '一摞书' });
}

// ================================================================ OFFICE / FAMILY ROOM
// White glazed wave bowl (g19/g21/g22): oval 0.34 × 0.2 with an undulating rim on a small oval foot.
function waveBowl() {
  const root = new THREE.Group(), a = 0.17, b = 0.1;
  root.add(shadow(new THREE.Mesh(waveBowlGeo(a, b, 0.085), L.glazeWhite())));
  const foot = cyl(1, 1, 0.012, L.glazeWhite(), { seg: 32, y: 0.006 }); foot.scale.set(a * 0.3, 1, b * 0.3); root.add(foot);
  return describe(root, { id: 'props-wave-bowl', name: 'White wave bowl', zh: '白瓷波浪碗' });
}

// Open coffee-table book (g20/g21): cloth boards flat, page blocks crowning toward the gutter, a printed spread.
function openBook() {
  const root = new THREE.Group(), W = 0.16, D = 0.23, T = 0.009, cov = 0.003;
  root.add(box(2 * W + 0.012, cov, D + 0.008, L.bookCloth(), { r: 0.001, y: cov / 2 }));
  const prof = (x) => cov + T * (1 - Math.exp(-x / 0.01)) * (1 + 0.35 * (1 - x / W));
  for (const s of [-1, 1]) {
    const o = []; for (let i = 0; i <= 24; i++) { const x = 0.0015 + (W - 0.003) * i / 24; o.push([s * x, prof(x)]); }
    o.push([s * (W - 0.0015), cov], [s * 0.0015, cov]);
    const blk = extrude(o, D, L.pages(), {}); blk.position.z = -D / 2; root.add(blk);
    const g = new THREE.PlaneGeometry(W - 0.008, D - 0.014, 24, 1), p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) { const u = p.getX(i) / (W - 0.008) + 0.5, x = 0.004 + u * (W - 0.008); p.setXYZ(i, s * x, prof(x) + 0.0004, -p.getY(i)); uv.setX(i, 0.5 + s * 0.5 * u); }
    if (s < 0) { const ix = g.index.array; for (let k = 0; k < ix.length; k += 3) { const tmp = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = tmp; } }
    g.computeVertexNormals(); root.add(shadow(new THREE.Mesh(g, L.paper())));
  }
  return describe(root, { id: 'props-open-book', name: 'Open coffee-table book', zh: '摊开的画册' });
}

// Pilea in a speckled pot on a saucer (desk).
function pileaPot(seed = 1) {
  const r = lcg(seed * 97 + 5), root = new THREE.Group(), C = M.ceramicSpeckle();
  root.add(lathe([[0.001, 0], [0.058, 0], [0.062, 0.004], [0.062, 0.011], [0.057, 0.011], [0.055, 0.006], [0.001, 0.006]], C, { seg: 32 }));
  const pot = lathe(hollow([[0.04, 0], [0.047, 0.02], [0.053, 0.068], [0.055, 0.074]], 0.004, 0.008), C, { seg: 32 }); pot.position.y = 0.006; root.add(pot);
  const soil = shadow(new THREE.Mesh(new THREE.CircleGeometry(0.05, 24), L.soil())); soil.rotation.x = -Math.PI / 2; soil.position.y = 0.072; root.add(soil);
  const stem = [[0, 0.07, 0], [0.004, 0.11, 0.002], [0.002, 0.15, -0.003]], st = new Batch(), lb = new Batch();
  st.add(stemGeo(stem, [0.004, 0.0025], { seg: 6, radial: 5 }), { tint: new THREE.Color('#6d8a46').toArray() });
  const cv = new THREE.CatmullRomCurve3(stem.map(q => new THREE.Vector3(...q))), n = 15;
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1), P = cv.getPointAt(0.15 + 0.85 * f).toArray(), yaw = i * GOLD * 1.6 + rr(r, -0.2, 0.2), Lp = rr(r, 0.05, 0.09) * (1 - 0.45 * f), d = dirOf(yaw, 1.15 - 0.7 * f + rr(r, -0.1, 0.1));
    const E = add3(add3(P, d, Lp), [0, 0.01, 0]);
    st.add(stemGeo([P, add3(add3(P, d, Lp * 0.5), [0, 0.012, 0]), E], [0.0013, 0.001], { seg: 4, radial: 3 }), { tint: new THREE.Color('#7aa04a').toArray() });
    const s = rr(r, 0.045, 0.062) * (1 - 0.3 * f);
    lb.add(cardGeo(s, s, { sx: 2, sy: 2, bend: 0.25, fold: -0.06 }), { pos: E, q: orient(yaw, rr(r, 1.2, 1.5) - 0.4 * f, rr(r, -0.3, 0.3)), tint: [rr(r, 0.9, 1.08), rr(r, 0.92, 1.06), rr(r, 0.9, 1.04)] });
  }
  root.add(st.mesh(plainMat('propsPileaStem', 0xffffff, { rough: 0.6 })), lb.mesh(leafMat('propsPilea', texPilea(), { rough: 0.42 })));
  return describe(root, { id: 'props-pilea', name: 'Pilea in a speckled pot', zh: '镜面草小盆栽' });
}

// Speckled stoneware mug with the last of a coffee.
function mug() {
  const root = new THREE.Group(), C = M.ceramicSpeckle();
  root.add(lathe(hollow([[0.034, 0], [0.039, 0.006], [0.041, 0.05], [0.041, 0.09]], 0.0035, 0.008), C, { seg: 32 }));
  const h = shadow(new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.0055, 8, 18, Math.PI * 1.15), C)); h.rotation.z = -Math.PI * 0.575; h.position.set(0.044, 0.048, 0); root.add(h);
  const cof = shadow(new THREE.Mesh(new THREE.CircleGeometry(0.0372, 28), L.coffee())); cof.rotation.x = -Math.PI / 2; cof.position.y = 0.03; root.add(cof);
  return describe(root, { id: 'props-mug', name: 'Stoneware mug', zh: '粗陶马克杯' });
}

// Snake plant in a matte white cylinder (office corner): upright banded swords, reach kept within ~0.19 m.
function snakePlant(seed = 1) {
  const r = lcg(seed * 151 + 3), root = new THREE.Group();
  root.add(lathe(hollow([[0.11, 0], [0.115, 0.004], [0.123, 0.27], [0.124, 0.28]], 0.007, 0.02), L.matteWhite(), { seg: 44 }));
  const soil = shadow(new THREE.Mesh(new THREE.CircleGeometry(0.117, 32), L.soil())); soil.rotation.x = -Math.PI / 2; soil.position.y = 0.255; root.add(soil);
  const lb = new Batch(), n = 10 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const yaw = i * GOLD + rr(r, -0.3, 0.3), rad = 0.015 + 0.045 * Math.sqrt(r()), Ls = rr(r, 0.42, 0.62) * (rad < 0.035 ? 1.2 : 1), bend = rr(r, 0.04, 0.12);
    const tilt = Math.max(0.02, Math.min(rr(r, 0.06, 0.3), Math.asin(Math.min(1, 0.13 / Ls)) - bend * 0.5));
    lb.add(cardGeo(rr(r, 0.055, 0.075), Ls, { sx: 2, sy: 8, bend, pow: 2, fold: -0.32, twist: rr(r, -0.5, 0.5) }), { pos: [Math.sin(yaw) * rad, 0.25, Math.cos(yaw) * rad], q: orient(yaw, tilt, rr(r, -0.6, 0.6)), tint: [rr(r, 0.9, 1.06), rr(r, 0.92, 1.06), rr(r, 0.9, 1.04)] });
  }
  root.add(lb.mesh(leafMat('propsSansev', texSansevieria(), { rough: 0.48 })));
  setCollider(root, { w: 0.26, d: 0.26, h: 0.9 });
  return describe(root, { id: 'props-snake-plant', name: 'Snake plant in a white planter', zh: '虎尾兰' });
}

// Small seagrass basket under the desk with a rolled linen throw.
function basketSmall() {
  const root = new THREE.Group();
  root.add(...seagrassBasket(0.13, 0.24));
  const roll = new THREE.Group(), C = L.linenOat();
  roll.add(cyl(0.05, 0.05, 0.3, C, { seg: 24 }));
  const sp = torus(0.03, 0.02, C, { seg: 20, tube: 8, y: 0.15, rx: Math.PI / 2 }); roll.add(sp);
  roll.position.set(0.0, 0.2, -0.01); roll.rotation.set(0.0, 0, 0.62); root.add(roll);
  setMovable(root, { mass: 2, radius: 0.15 });
  return describe(root, { id: 'props-basket-small', name: 'Seagrass basket with a rolled throw', zh: '海草收纳篮' });
}

export const items = {
  vaseGypsophila, chessBox, seatTray, sideTableCarved, diffuserWhite, throwDraped, brassMiniatures, trailingPothos, vesselsPair,
  printFramed: (seed = 1) => printFramed(seed), runnerRug,
  vaseHeather, boardWalnut, fiddleFig: (seed = 1) => fiddleFig(seed), throwFolded, books: (seed = 1) => books(seed),
  waveBowl, openBook, pileaPot: (seed = 1) => pileaPot(seed), mug, snakePlant: (seed = 1) => snakePlant(seed), basketSmall,
};
