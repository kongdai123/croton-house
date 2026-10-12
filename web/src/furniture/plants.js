// plants — the tropical Sarasota garden of 2513 Croton Ave (front & back yard, refs/outdoor) plus indoor plant décor.
// Leaves are alpha-tested painted cards (bent, folded, tinted per leaf); trunks, stems, petioles are real tubes.
// Every builder takes an optional seed (deterministic LCG, never Math.random) and sways its leaf groups in
// root.userData.animate(t). Helpers live in plants_parts.js.
import { THREE, M, lathe, describe, setCollider, autoCollider, shadow } from '../kit.js';
import {
  TAU, GOLD, lcg, rr, tint, texBanana, texFan, texStrap, texCroton, CROTON_CELLS, texSprig, texPine, texColeus, texHeart,
  texPlume, texBananaStem, texCactus, texBoot, paint, leafMat, plainMat, orient, dirOf, cardGeo, fanGeo, stemGeo, Batch,
  pivotAt, addSway, swayAnimate,
} from './plants_parts.js';

const lin = (hex) => new THREE.Color(hex).toArray();             // sRGB hex → linear rgb for vertex colours
const lerp3 = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const add3 = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const yawTilt = (d) => { const l = Math.hypot(...d); return [Math.atan2(d[0], d[2]), Math.acos(Math.max(-1, Math.min(1, d[1] / l)))]; };
const meshOf = (geo, mat) => shadow(new THREE.Mesh(geo, mat));
function finish(root, sw, meta) { describe(root, meta); return swayAnimate(root, sw); }

// ------------------------------------------------------------------ banana
function banana(seed = 1) {
  const r = lcg(seed * 101 + 7), root = new THREE.Group(), sw = [];
  const H = rr(r, 1.2, 1.38), lean = rr(r, 0.04, 0.08), ly = r() * TAU, lx = Math.sin(ly) * lean, lz = Math.cos(ly) * lean;
  const sp = (y) => [lx * y * (1 + 0.15 * y), y, lz * y * (1 + 0.15 * y)];
  const stemR = (t) => 0.09 * (1 - 0.3 * t) + 0.02 * Math.exp(-t * 12);
  root.add(new Batch().add(stemGeo([0, 0.3, 0.6, 0.85, 1].map(f => sp(f * H)), stemR, { seg: 8, radial: 16, norm: true })).mesh(plainMat('bananaStem', 0xd8e6c0, { rough: 0.6, map: texBananaStem() })));
  const T = sp(H);
  const petMat = plainMat('bananaPetiole', 0xffffff, { rough: 0.55 }), petCol = lin('#9fb36a');
  const blade = leafMat('banana', texBanana(false), { rough: 0.5 }), bladeOld = leafMat('bananaOld', texBanana(true), { rough: 0.8 });
  // unfurling "cigar" leaf in the centre
  root.add(new Batch().add(stemGeo([T, add3(T, [lx * 0.5, 0.3, lz * 0.5]), add3(T, [lx * 0.9 + 0.03, 0.55, lz * 0.9])], [0.035, 0.004], { seg: 6, radial: 8 }), { tint: lin('#a8c46e') }).mesh(petMat));
  const leaf = (i, A, yaw, tilt, { lp = 0.4, sc = 1, bend = 1, old = false, amp = 0.03, fold = 0.22, twist = 0 } = {}) => {
    const d = dirOf(yaw, tilt * 0.75), E = add3(A, d, lp);
    const [pv, inner] = pivotAt(root, A);
    const mid = add3(add3(A, d, lp * 0.5), [0, 0.02, 0]);
    inner.add(new Batch().add(stemGeo([A, mid, E], [0.028 * sc, 0.018 * sc], { seg: 6, radial: 6 }), { tint: [petCol[0], petCol[1], petCol[2]].map(v => v * rr(r, 0.92, 1.08)) }).mesh(petMat));
    const g = cardGeo(0.55 * sc, 1.8 * sc, { sx: 4, sy: 12, bend, pow: 1.3, fold, twist });
    inner.add(new Batch().add(g, { pos: E, q: orient(yaw, tilt, rr(r, -0.12, 0.12)), tint: tint(r) }).mesh(old ? bladeOld : blade));
    addSway(sw, pv, i, amp, 0.75);
  };
  const n = 7 + Math.floor(r() * 3), y0 = r() * TAU;
  for (let i = 0; i < n; i++) {
    const a = i / (n - 1), yaw = y0 + i * 2.4 + rr(r, -0.25, 0.25), tilt = 0.32 + a * 0.95 + rr(r, -0.08, 0.08);
    const A = add3(T, [Math.sin(yaw) * 0.03, -0.04 - a * 0.2, Math.cos(yaw) * 0.03]);
    leaf(i, A, yaw, tilt, { lp: 0.32 + 0.18 * a, sc: rr(r, 0.88, 1.03) * (i === 0 ? 0.85 : 1), bend: 0.7 + a * 1.05, amp: 0.02 + 0.025 * a, twist: rr(r, -0.25, 0.25) });
  }
  for (let k = 0; k < 2; k++) {   // old, torn, browning leaves hanging along the stem
    const yaw = y0 + 1.1 + k * 2.9 + rr(r, -0.3, 0.3), A = add3(sp(H - 0.06 - k * 0.08), [Math.sin(yaw) * 0.06, 0, Math.cos(yaw) * 0.06]);
    leaf(n + k, A, yaw, rr(r, 2.3, 2.45), { lp: 0.3, sc: 0.6, bend: -0.15, old: true, amp: 0.012, fold: 0.25, twist: rr(r, 0.6, 1.1) });
  }
  // a sucker pup at the foot
  const py = r() * TAU, P = [Math.sin(py) * 0.32, 0, Math.cos(py) * 0.32], ph = rr(r, 0.35, 0.5);
  root.add(new Batch().add(stemGeo([P, add3(P, [0, ph * 0.5, 0]), add3(P, [0.02, ph, 0.01])], [0.04, 0.026], { seg: 4, radial: 10, norm: true })).mesh(plainMat('bananaStem', 0xffffff)));
  for (let k = 0; k < 4; k++) { const yaw = py + k * 2.3, A = add3(P, [0, ph - 0.02, 0]); leaf(n + 2 + k, A, yaw, 0.25 + k * 0.28, { lp: 0.1, sc: 0.33, bend: 0.4 + k * 0.25, amp: 0.03 }); }
  setCollider(root, { w: 0.3, d: 0.3, h: 2.8 });
  return finish(root, sw, { id: 'plants-banana', name: 'Banana plant', zh: '香蕉树', note: 'Musa, 2.4–3 m; pale pseudostem, paddle leaves, two old torn leaves, a pup' });
}

// ------------------------------------------------------------------ fan palm (sabal / palmetto)
function palmFan(seed = 1) {
  const r = lcg(seed * 131 + 3), root = new THREE.Group(), sw = [];
  const H = rr(r, 1.05, 1.2), ly = r() * TAU, lean = rr(r, 0.03, 0.07);
  const sp = (y) => [Math.sin(ly) * lean * y * (1 + 0.3 * y), y, Math.cos(ly) * lean * y * (1 + 0.3 * y)];
  root.add(new Batch().add(stemGeo([0, 0.3, 0.6, 1].map(f => sp(f * H)), (t) => 0.125 + 0.03 * Math.exp(-t * 14) - 0.01 * t, { seg: 8, radial: 16 })).mesh(M.bark()));
  const C = sp(H);
  // old leaf bases ("boots") criss-crossing the top of the trunk
  const boots = new Batch(), bootG = cardGeo(0.12, 0.3, { sy: 2, bend: 0.15 });
  for (let k = 0; k < 16; k++) { const yaw = k * GOLD * 2, y = H - 0.5 + (k / 16) * 0.42; boots.add(bootG, { pos: add3(sp(y), [Math.sin(yaw) * 0.1, 0, Math.cos(yaw) * 0.1]), q: orient(yaw, rr(r, 0.3, 0.55), rr(r, -0.3, 0.3)), tint: tint(r, 0.12) }); }
  root.add(boots.mesh(leafMat('boot', texBoot(), { rough: 0.95 })));
  const petMat = plainMat('palmPetiole', 0xffffff, { rough: 0.7 }), fan = leafMat('fan', texFan(false), { rough: 0.6 }), fanDead = leafMat('fanDead', texFan(true), { rough: 0.9 });
  const frond = (i, yaw, tilt, { dead = false, len = 0.8, amp = 0.03 } = {}) => {
    const A = add3(C, [Math.sin(yaw) * 0.06, -0.02, Math.cos(yaw) * 0.06]), d = dirOf(yaw, tilt), E = add3(add3(A, d, len), [0, -0.04 * Math.sin(tilt), 0]);
    const [pv, inner] = pivotAt(root, A);
    inner.add(new Batch().add(stemGeo([A, add3(add3(A, d, len * 0.5), [0, 0.02, 0]), E], [0.02, 0.011], { seg: 6, radial: 6 }), { tint: lin(dead ? '#9c8456' : '#8c9a5a') }).mesh(petMat));
    const bt = dead ? tilt + 0.15 : Math.max(0.05, tilt * 1.15 - 0.3 + rr(r, -0.1, 0.1));
    const fg = dead ? fanGeo(0.6, 0.75, { droop: 0.04, fold: 0.5 }) : fanGeo(1.2, 1.0, { droop: 0.22 + 0.12 * tilt, fold: 0.22 });
    inner.add(new Batch().add(fg, { pos: E, q: orient(yaw, bt, rr(r, -0.25, 0.25)), tint: tint(r) }).mesh(dead ? fanDead : fan));
    addSway(sw, pv, i, amp, 0.6);
  };
  const n = 10 + Math.floor(r() * 5), y0 = r() * TAU;
  for (let i = 0; i < n; i++) { const a = i / (n - 1); frond(i, y0 + i * GOLD * 1.0 + rr(r, -0.15, 0.15), 0.5 + a * 1.05 + rr(r, -0.08, 0.08), { len: rr(r, 0.72, 0.88), amp: 0.02 + 0.02 * a }); }
  for (let k = 0; k < 2; k++) frond(n + k, y0 + 0.7 + k * 3.1, rr(r, 2.55, 2.75), { dead: true, len: 0.25, amp: 0.012 });
  setCollider(root, { w: 0.32, d: 0.32, h: 2.5 });
  return finish(root, sw, { id: 'plants-palmFan', name: 'Fan palm', zh: '箬棕', note: 'Sabal palmetto, 2.5 m, bark trunk with boots, 10–14 costapalmate fans' });
}

// ------------------------------------------------------------------ bromeliad
function bromeliad(seed = 1, variant = 'red') {
  const r = lcg(seed * 151 + (variant === 'red' ? 1 : 2)), root = new THREE.Group(), sw = [];
  const red = variant === 'red';
  const leafT = red ? texStrap('bromRed2', '#b0605a', '#7e3a34', '#4f6e2e') : texStrap('bromGreen2', '#b8cc88', '#4f8434', '#3f6e28');
  const ctrT = red ? texStrap('bromCtrR2', '#e83a48', '#b8202f', '#7e3a34') : texStrap('bromCtrG2', '#e85070', '#c43452', '#4f8434');
  const mOut = leafMat(red ? 'bromRed' : 'bromGreen', leafT, { rough: 0.45 }), mIn = leafMat(red ? 'bromCtrR' : 'bromCtrG', ctrT, { rough: 0.4 });
  const n = 16 + Math.floor(r() * 5), rot = r() * TAU;
  const outer = new Batch(), inner = new Batch(), ctr = new Batch();
  for (let i = 0; i < n; i++) {
    const a = 1 - i / (n - 1), yaw = rot + i * GOLD, tilt = 0.22 + 0.85 * a + rr(r, -0.06, 0.06), L = 0.36 + 0.08 * a + rr(r, -0.02, 0.02);
    const c = i > n - 4, g = cardGeo(rr(r, 0.085, 0.1), c ? L * 0.55 : L, { sx: 2, sy: 7, bend: 0.25 + 1.0 * a, pow: 2, fold: -0.25 });
    (c ? ctr : a > 0.5 ? outer : inner).add(g, { pos: [Math.sin(yaw) * (0.01 + 0.025 * a), 0.03, Math.cos(yaw) * (0.01 + 0.025 * a)], q: orient(yaw, c ? tilt + 0.35 : tilt, rr(r, -0.15, 0.15)), tint: tint(r) });
  }
  for (let k = 0; k < 6; k++) { const yaw = k * GOLD; ctr.add(cardGeo(0.035, 0.1, { sy: 2, bend: 0.2, fold: -0.2 }), { pos: [Math.sin(yaw) * 0.01, 0.05, Math.cos(yaw) * 0.01], q: orient(yaw, 0.5, 0), tint: tint(r, 0.1) }); }
  root.add(new Batch().add(stemGeo([[0, 0, 0], [0, 0.04, 0]], [0.035, 0.03], { seg: 1, radial: 10 }), { tint: lin(red ? '#5a3a2a' : '#5a6a3a') }).mesh(plainMat('bromBase', 0xffffff, { rough: 0.8 })));
  [[outer, mOut, 0.012], [inner, mOut, 0.008], [ctr, mIn, 0.006]].forEach(([b, m, a], i) => { const [pv, inn] = pivotAt(root, [0, 0, 0]); inn.add(b.mesh(m)); addSway(sw, pv, i, a, 1.0); });
  setCollider(root, { w: 0.5, d: 0.5, h: 0.45 });
  return finish(root, sw, { id: 'plants-bromeliad-' + variant, name: `Bromeliad (${variant})`, zh: '凤梨', note: '0.45 m stiff rosette, colourful centre' });
}

// ------------------------------------------------------------------ fountain / muhly grass
function grassClump(seed = 1) {
  const r = lcg(seed * 171 + 5), root = new THREE.Group(), sw = [];
  const gm = plainMat('grassBlade', 0xffffff, { rough: 0.75, side: THREE.DoubleSide });
  const plumeM = leafMat('fountainPlume', texPlume('fountain', { cols: ['#d8c3a0', '#c9a796', '#e6d6b8', '#b99a86'] }), { rough: 0.9 });
  const baseC = lin('#4d6634'), midC = lin('#7f9a52'), tipA = lin('#a9b878'), tipB = lin('#cdbf86');
  const S = 4, blades = [...Array(S)].map(() => new Batch()), plumes = [...Array(S)].map(() => new Batch());
  const n = 240 + Math.floor(r() * 40);
  for (let i = 0; i < n; i++) {
    const yaw = r() * TAU, tilt = 0.04 + 0.75 * Math.pow(r(), 0.6), h = rr(r, 0.62, 1.0) * (1 - 0.2 * tilt), bend = 0.25 + tilt * 1.5 + rr(r, 0, 0.45);
    const tip = lerp3(tipA, tipB, r()), k = rr(r, 0.85, 1.12);
    const g = cardGeo(rr(r, 0.014, 0.024), h, { sx: 1, sy: 6, bend, pow: 1.6, taper: 0.92, twist: rr(r, -0.8, 0.8) });
    const rad = Math.sqrt(r()) * 0.1;
    blades[Math.floor(((yaw / TAU) * S)) % S].add(g, { pos: [Math.sin(yaw) * rad, 0.006, Math.cos(yaw) * rad], q: orient(yaw, tilt, rr(r, -1, 1)), tint: [k, k, k], grad: (v) => v < 0.5 ? lerp3(baseC, midC, v / 0.5) : lerp3(midC, tip, Math.pow((v - 0.5) / 0.5, 1.5)) });
  }
  const stalkC = lin('#b8a57c');
  for (let i = 0; i < 8; i++) {
    const yaw = r() * TAU, tilt = rr(r, 0.2, 0.55), L = rr(r, 1.0, 1.18), d = dirOf(yaw, tilt), s = Math.floor((yaw / TAU) * S) % S;
    const P0 = [Math.sin(yaw) * 0.03, 0.02, Math.cos(yaw) * 0.03], P1 = add3(P0, d, L * 0.55), P2 = add3(add3(P0, d, L), [0, -0.12 * tilt, 0]);
    const sg = stemGeo([P0, P1, P2], [0.003, 0.002], { seg: 10, radial: 4 }), cv = sg.userData.curve;
    blades[s].add(sg, { tint: stalkC });
    const E = cv.getPointAt(0.8).toArray(), [yd, td] = yawTilt(cv.getTangentAt(0.8).toArray());
    for (let m = 0; m < 3; m++) plumes[s].add(cardGeo(0.05, 0.22, { sy: 3, bend: 0.25 }), { pos: E, q: orient(yd, td, (m * Math.PI) / 3), tint: tint(r, 0.06) });
  }
  for (let s = 0; s < S; s++) { const [pv, inn] = pivotAt(root, [0, 0, 0]); inn.add(blades[s].mesh(gm)); if (plumes[s].size) inn.add(plumes[s].mesh(plumeM)); addSway(sw, pv, s, 0.035, 1.1); }
  setCollider(root, { w: 0.5, d: 0.5, h: 0.9 });
  return finish(root, sw, { id: 'plants-grassClump', name: 'Fountain / muhly grass', zh: '狼尾草', note: '0.9 m clump, ~110 arching blades, foxtail plumes' });
}

// ------------------------------------------------------------------ rounded shrub (green or golden duranta)
function shrubGreen(seed = 1, tone = 'green') {
  const r = lcg(seed * 191 + (tone === 'gold' ? 9 : 0)), root = new THREE.Group(), sw = [];
  const gold = tone === 'gold';
  const sp = { n: 38, len: [44, 64], wid: [18, 26], rx: 0.33, ry: 0.36, dark: 0.65 };
  const tex = gold ? texSprig('shrubGold2', { ...sp, base: '#8c9a26', hi: '#e6e46c', twig: '#6a5a3a' }) : texSprig('shrub2', { ...sp, base: '#2d5c25', hi: '#78aa50' });
  const mat = leafMat(gold ? 'shrubGold' : 'shrub', tex, { rough: 0.7, soft: true });
  const C = [0, 0.44, 0], RX = 0.42, RY = 0.34, S = 3, b = [...Array(S)].map(() => new Batch());
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 8), plainMat(gold ? 'shrubCoreGold' : 'shrubCore', gold ? 0x4d5518 : 0x1a3216, { rough: 1, vertexColors: false }));
  core.position.set(...C); core.scale.set(1.05, 0.85, 1.05); root.add(shadow(core));
  const N = 210, g = cardGeo(0.2, 0.3, { sy: 2, bend: 0.25 });
  for (let k = 0; k < N; k++) {
    const yk = 1 - 2 * (k + 0.5) / N; if (yk < -0.55) continue;
    const ph = k * GOLD + rr(r, -0.2, 0.2), rk = Math.sqrt(1 - yk * yk), j = k % 3 === 0 ? rr(r, 0.55, 0.8) : rr(r, 0.85, 1.05);
    const nrm = [rk * Math.cos(ph) / RX, yk / RY, rk * Math.sin(ph) / RX], p = [C[0] + RX * rk * Math.cos(ph) * j, C[1] + RY * yk * j, C[2] + RX * rk * Math.sin(ph) * j];
    const [yaw, tilt] = yawTilt(nrm), base = add3(p, yawTiltDir(yaw, tilt), -0.12);
    b[Math.floor(((ph % TAU) + TAU) % TAU / TAU * S) % S].add(g, { pos: base, q: orient(yaw + rr(r, -0.4, 0.4), tilt + rr(r, -0.45, 0.3), r() * TAU), s: rr(r, 0.85, 1.2), tint: tint(r), soft: { c: new THREE.Vector3(...C), k: 0.6 } });
  }
  const tw = new Batch(); for (let k = 0; k < 5; k++) { const yaw = k * 1.3; tw.add(stemGeo([[0, 0, 0], [Math.sin(yaw) * 0.08, 0.15, Math.cos(yaw) * 0.08], [Math.sin(yaw) * 0.2, 0.32, Math.cos(yaw) * 0.2]], [0.014, 0.006], { seg: 4, radial: 5 }), { tint: lin('#5d4a36') }); }
  root.add(tw.mesh(plainMat('twig', 0xffffff, { rough: 0.9 })));
  b.forEach((bb, i) => { const [pv, inn] = pivotAt(root, [0, 0, 0]); inn.add(bb.mesh(mat)); addSway(sw, pv, i, 0.012, 0.9); });
  autoCollider(root, 0.08);
  return finish(root, sw, { id: 'plants-shrub-' + tone, name: gold ? 'Golden shrub' : 'Green shrub', zh: '灌木', note: '0.9 m rounded mass of leafy sprig cards' });
}
const yawTiltDir = (yaw, tilt) => dirOf(yaw, tilt);

// ------------------------------------------------------------------ coleus / purple ground cover patch
function coleus(seed = 1) {
  const r = lcg(seed * 211 + 1), root = new THREE.Group(), sw = [];
  const mat = leafMat('coleus', texColeus(), { rough: 0.7, soft: true, env: 0.45, color: 0xd0c0c8 }), stemM = plainMat('coleusStem', 0xffffff, { rough: 0.8 });
  const mound = new THREE.Mesh(new THREE.SphereGeometry(0.5, 18, 5, 0, TAU, 0, Math.PI / 2), plainMat('coleusMound', 0x26131c, { rough: 1, vertexColors: false }));
  mound.scale.set(0.85, 0.09, 0.52); root.add(shadow(mound));
  const S = 3, b = [...Array(S)].map(() => new Batch()), st = new Batch(), n = 22, stC = lin('#4a2232');
  for (let k = 0; k < n; k++) {
    const rad = Math.sqrt((k + 0.5) / n), ang = k * GOLD + rr(r, -0.2, 0.2), x = 0.55 * rad * Math.cos(ang), z = 0.36 * rad * Math.sin(ang);
    const hs = rr(r, 0.2, 0.3) * (1 - 0.35 * rad), m = 4, y0 = r() * TAU, s = Math.floor(((ang % TAU) + TAU) % TAU / TAU * S) % S;
    st.add(stemGeo([[x, 0, z], [x, hs * 0.6, z], [x + 0.01, hs, z]], [0.005, 0.003], { seg: 3, radial: 4 }), { tint: stC });
    for (let j = 0; j < m; j++) {
      const f = j / (m - 1), y = hs * (0.35 + 0.65 * f), L = 0.13 * rr(r, 0.85, 1.15) * (1 - 0.3 * f);
      for (const side of [0, Math.PI]) {
        const yaw = y0 + j * Math.PI / 2 + side + rr(r, -0.25, 0.25);
        b[s].add(cardGeo(L * 0.85, L, { sx: 2, sy: 3, bend: 0.45, fold: 0.15 }), { pos: [x, y, z], q: orient(yaw, 1.3 - 0.45 * f + rr(r, -0.15, 0.15), rr(r, -0.3, 0.3)), tint: tint(r, 0.1), soft: { c: new THREE.Vector3(0, -0.25, 0), k: 0.35 } });
      }
    }
  }
  root.add(st.mesh(stemM));
  b.forEach((bb, i) => { const [pv, inn] = pivotAt(root, [0, 0, 0]); inn.add(bb.mesh(mat)); addSway(sw, pv, i, 0.012, 1.2); });
  setCollider(root, { w: 1.1, d: 0.7, h: 0.35 });
  return finish(root, sw, { id: 'plants-coleus', name: 'Coleus patch', zh: '彩叶草', note: '1.2 × 0.8 m, 0.35 m high purple-burgundy ground cover' });
}

// ------------------------------------------------------------------ croton
function croton(seed = 1) {
  const r = lcg(seed * 223 + 3), root = new THREE.Group(), sw = [];
  const mat = leafMat('croton', texCroton(), { rough: 0.42, env: 0.7 }), stemM = plainMat('crotonStem', 0xffffff, { rough: 0.8 });
  const k = 9, y0 = r() * TAU;
  for (let s = 0; s < k; s++) {
    const yaw = y0 + s * TAU / k + rr(r, -0.3, 0.3), tilt = s === 0 ? 0.05 : rr(r, 0.25, 0.65), h = s === 0 ? 0.95 : rr(r, 0.4, 0.85), d = dirOf(yaw, tilt);
    const P0 = [Math.sin(yaw) * 0.04, 0, Math.cos(yaw) * 0.04], P1 = add3(P0, d, h * 0.5), P2 = add3(add3(P0, d, h), [0, 0.02, 0]);
    const sg = stemGeo([P0, P1, P2], [0.013, 0.006], { seg: 6, radial: 6 }), cv = sg.userData.curve;
    const [pv, inn] = pivotAt(root, P0);
    inn.add(new Batch().add(sg, { tint: lin('#5d5a3c') }).mesh(stemM));
    const lb = new Batch(), m = Math.round(8 + h * 12);
    for (let j = 0; j < m; j++) {
      const f = Math.pow(j / (m - 1), 0.7), t = 0.12 + 0.88 * f, P = cv.getPointAt(t).toArray();
      const L = rr(r, 0.2, 0.29), cell = f < 0.45 ? (r() < 0.7 ? 1 + Math.floor(r() * 2) : 3) : (r() < 0.65 ? (r() < 0.6 ? 0 : 3) : 2);
      lb.add(cardGeo(L * 0.42, L, { sx: 2, sy: 4, bend: rr(r, 0.4, 1.0), pow: 1.5, fold: rr(r, -0.08, 0.14), twist: rr(r, -0.5, 0.5), u0: cell / CROTON_CELLS, u1: (cell + 1) / CROTON_CELLS }),
        { pos: P, q: orient(j * GOLD * 1.3 + s, Math.min(P[1] < 0.12 ? 0.85 : P[1] < 0.25 ? 1.25 : 1.9, 1.75 - 1.05 * f + rr(r, -0.25, 0.25)), rr(r, -0.4, 0.4)), tint: tint(r) });
    }
    inn.add(lb.mesh(mat)); addSway(sw, pv, s, 0.018, 0.9);
  }
  autoCollider(root, 0.1);
  return finish(root, sw, { id: 'plants-croton', name: 'Croton', zh: '变叶木', note: '1.2 m, glossy variegated leaves (green/yellow, red/orange)' });
}

// ------------------------------------------------------------------ big broadleaf tree (live oak)
function treeLarge(seed = 1) {
  const r = lcg(seed * 241 + 11), root = new THREE.Group(), sw = [];
  const bark = M.bark().clone(); bark.color.multiplyScalar(0.55);
  const leafM = leafMat('oak', texSprig('oak', { W: 256, H: 320, n: 150, len: [18, 28], wid: [7, 11], base: '#2f5f2a', hi: '#4f8a3c', twig: '#4a3a2a', rx: 0.42, ry: 0.42, dark: 0.6 }), { rough: 0.7, soft: true });
  const F = [rr(r, 0.1, 0.2), rr(r, 2.0, 2.3), rr(r, 0.0, 0.1)];
  root.add(new Batch().add(stemGeo([[0, 0, 0], [0.04, 1.0, 0.01], [F[0] * 0.8, F[1] * 0.85, F[2] * 0.7], F], (t) => 0.25 * (1 - 0.2 * t) + 0.17 * Math.exp(-t * 10), { seg: 10, radial: 16, swap: true })).mesh(bark));
  const canopyC = new THREE.Vector3(0, 4.6, 0), card = cardGeo(0.5, 0.6, { sy: 2, bend: 0.3 });
  const cluster = (lb, cb, c, rc) => {
    const N = Math.round(34 * rc * rc), cc = new THREE.Vector3(...c).lerp(canopyC, 0.3);
    for (let k = 0; k < N; k++) {
      const yk = 1 - 2 * (k + 0.5) / N; if (yk < -0.6 && r() < 0.6) continue;
      const ph = k * GOLD, rk = Math.sqrt(1 - yk * yk), j = rr(r, 0.8, 1.05);
      const nrm = [rk * Math.cos(ph), yk * 1.3, rk * Math.sin(ph)], p = [c[0] + rc * rk * Math.cos(ph) * j, c[1] + rc * 0.72 * yk * j, c[2] + rc * rk * Math.sin(ph) * j];
      const [yaw, tilt] = yawTilt(nrm);
      const shade = 0.72 + 0.28 * (yk + 1) / 2;   // underside of each clump darker
      lb.add(card, { pos: add3(p, dirOf(yaw, tilt), -0.15), q: orient(yaw + rr(r, -0.5, 0.5), tilt + rr(r, -0.5, 0.4), r() * TAU), s: rr(r, 0.85, 1.2), tint: tint(r, 0.1).map(v => v * shade), soft: { c: cc, k: 0.55 } });
    }
    // interior layer: smaller, darker, randomly turned cards fill the clump so the sky only shows through gaps
    for (let k = 0; k < Math.round(N * 0.6); k++) {
      const a = r() * TAU, e = rr(r, -0.6, 0.9), d = rr(r, 0.25, 0.7) * rc, p = [c[0] + Math.cos(a) * Math.cos(e) * d, c[1] + Math.sin(e) * d * 0.72, c[2] + Math.sin(a) * Math.cos(e) * d];
      const f = rr(r, 0.42, 0.62);
      lb.add(card, { pos: p, q: orient(r() * TAU, rr(r, 0.3, 2.2), r() * TAU), s: rr(r, 0.8, 1.1), tint: tint(r, 0.08).map(v => v * f), soft: { c: cc, k: 0.4 } });
    }
  };
  const k = 4 + Math.floor(r() * 3), y0 = r() * TAU;
  for (let b = 0; b < k; b++) {
    const yaw = y0 + b * TAU / k + rr(r, -0.3, 0.3), R = rr(r, 2.3, 3.0), yE = rr(r, 4.2, 5.6), dx = Math.sin(yaw), dz = Math.cos(yaw);
    const pts = [F, [F[0] + dx * R * 0.25, F[1] + (yE - F[1]) * 0.45, F[2] + dz * R * 0.25], [F[0] + dx * R * 0.65 + rr(r, -0.3, 0.3), F[1] + (yE - F[1]) * 0.8, F[2] + dz * R * 0.65 + rr(r, -0.3, 0.3)], [F[0] + dx * R, yE, F[2] + dz * R]];
    const [pv, inn] = pivotAt(root, F);
    const wood = new Batch(), lb = new Batch(), cb = null;
    const mg = stemGeo(pts, [0.15, 0.045], { seg: 9, radial: 10, swap: true }), cv = mg.userData.curve; wood.add(mg);
    cluster(lb, cb, pts[3], rr(r, 1.15, 1.45));
    for (let s = 0; s < 3; s++) {
      const t = rr(r, 0.45, 0.85), P = cv.getPointAt(t).toArray(), sy = yaw + rr(r, -1.1, 1.1), el = rr(r, 0.35, 0.8), L = rr(r, 1.0, 1.5);
      const d = [Math.sin(sy) * Math.cos(el), Math.sin(el), Math.cos(sy) * Math.cos(el)], E = add3(P, d, L);
      wood.add(stemGeo([P, add3(add3(P, d, L * 0.5), [0, 0.1, 0]), E], [0.05, 0.015], { seg: 5, radial: 6, swap: true }));
      cluster(lb, cb, E, rr(r, 0.95, 1.3));
    }
    if (b < 3) cluster(lb, cb, [F[0] + dx * 0.9, rr(r, 5.4, 6.0), F[2] + dz * 0.9], rr(r, 1.2, 1.5));
    inn.add(wood.mesh(bark), lb.mesh(leafM)); addSway(sw, pv, b, 0.008, 0.45);
  }
  setCollider(root, { w: 0.6, d: 0.6, h: 7 });
  return finish(root, sw, { id: 'plants-treeLarge', name: 'Large broadleaf tree', zh: '大橡树', note: '7 m live-oak type, 7 m canopy of clumped leaf-sprig cards' });
}

// ------------------------------------------------------------------ Norfolk Island pine
function treePine(seed = 1) {
  const r = lcg(seed * 263 + 13), root = new THREE.Group(), sw = [];
  const bark = M.bark().clone(); bark.color.multiplyScalar(0.5); bark.color.r *= 1.08;
  const leafM = leafMat('pine', texPine(), { rough: 0.8, soft: true, color: 0xa9b8a4 });
  const Ht = 12, wob = (y) => [Math.sin(y * 0.7 + seed) * 0.03, y, Math.cos(y * 0.5 + seed) * 0.03];
  root.add(new Batch().add(stemGeo([0, 2, 4, 6, 8, 10, 12].map(wob), (t) => 0.175 * Math.pow(1 - t, 0.9) + 0.012 + 0.04 * Math.exp(-t * 30), { seg: 14, radial: 12 })).mesh(bark));
  const tiers = 12, card = cardGeo(0.22, 0.55, { sy: 3, bend: 0.5 });
  for (let k = 0; k < tiers; k++) {
    const f = k / (tiers - 1), y = 2.2 + f * 9.1, L = 0.35 + 2.0 * Math.pow(1 - f, 0.85), rt = 0.175 * (1 - y / Ht) + 0.015, C = wob(y);
    const [pv, inn] = pivotAt(root, C); const wood = new Batch(), lb = new Batch(), sc0 = 0.55 + 0.45 * (L / 2.35);
    for (let b = 0; b < 5; b++) {
      const yaw = k * 0.63 + b * TAU / 5 + rr(r, -0.15, 0.15), dx = Math.sin(yaw), dz = Math.cos(yaw), yy = y + rr(r, -0.08, 0.08);
      const pts = [[C[0] + dx * rt * 0.5, yy, C[2] + dz * rt * 0.5], [C[0] + dx * L * 0.5, yy - 0.06 * L, C[2] + dz * L * 0.5], [C[0] + dx * L, yy + 0.06 * L, C[2] + dz * L]];
      const sg = stemGeo(pts, [0.012 + 0.014 * L, 0.005], { seg: 5, radial: 5 }), cv = sg.userData.curve; wood.add(sg);
      const m = Math.max(4, Math.round(4 + L * 4));
      for (let j = 0; j < m; j++) {
        const t = 0.12 + 0.88 * j / (m - 1), P = cv.getPointAt(t).toArray(), s = sc0 * (1 - 0.3 * t) * rr(r, 0.9, 1.1);
        for (const sd of [-1, 1]) lb.add(card, { pos: P, q: orient(yaw + sd * rr(r, 0.75, 1.15), Math.PI / 2 + rr(r, 0.05, 0.35), sd * rr(r, 0.2, 0.6)), s, tint: tint(r), soft: { c: new THREE.Vector3(C[0], y - 0.8, C[2]), k: 0.35 } });
      }
      lb.add(card, { pos: pts[2], q: orient(yaw, Math.PI / 2 - 0.25, 0), s: sc0 * 0.75, tint: tint(r), soft: { c: new THREE.Vector3(C[0], y - 0.8, C[2]), k: 0.35 } });
    }
    inn.add(wood.mesh(bark), lb.mesh(leafM)); addSway(sw, pv, k, 0.006 + 0.012 * f, 0.5);
  }
  const top = new Batch(), T = wob(11.4);
  for (let j = 0; j < 6; j++) top.add(card, { pos: add3(T, [0, j * 0.08, 0]), q: orient(j * 2.1, 0.25 + 0.1 * j, 0), s: 0.6, tint: tint(r) });
  const [pv, inn] = pivotAt(root, T); inn.add(top.mesh(leafM)); addSway(sw, pv, tiers, 0.02, 0.5);
  setCollider(root, { w: 0.4, d: 0.4, h: 12 });
  return finish(root, sw, { id: 'plants-treePine', name: 'Norfolk Island pine', zh: '南洋杉', note: '12 m, 12 tiers × 5 horizontal branches with branchlet cards' });
}

// ------------------------------------------------------------------ columnar euphorbia / cactus
function ribbedColumn(h, R, r, { lean = [0, 0], bow = [0, 0] } = {}) {
  const radial = 48, ys = [], cap = R * 1.3, body = h - cap;
  for (let y = 0; y < body; y += 0.08) ys.push(y);
  for (let i = 0; i <= 6; i++) ys.push(body + cap * Math.sin((i / 6) * Math.PI / 2));
  const cons = [rr(r, 0.4, 0.8) * h, rr(r, 0.55, 0.95) * h].map(c => Math.min(c, body - 0.05));
  const pos = [], uv = [], col = [], idx = [], cork = lin('#8a7a52'), green = [1, 1, 1];
  ys.forEach((y, i) => {
    const capF = y > body ? Math.sqrt(Math.max(0, 1 - ((y - body) / cap) ** 2)) : 1;
    const baseF = 0.82 + 0.18 * Math.min(1, y / 0.18), cons_ = cons.reduce((a, c) => a * (1 - 0.07 * Math.exp(-(((y - c) / 0.035) ** 2))), 1);
    const ox = lean[0] * y + bow[0] * y * y, oz = lean[1] * y + bow[1] * y * y, c = lerp3(cork, green, Math.min(1, Math.max(0, (y - 0.06) / 0.2)));
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * TAU, rib = 0.78 + 0.22 * Math.pow(0.5 + 0.5 * Math.cos(8 * th), 0.6), rad = R * rib * baseF * cons_ * capF;
      pos.push(ox + Math.cos(th) * rad, y, oz + Math.sin(th) * rad); uv.push(j / radial, y / 0.5); col.push(...c);
    }
  });
  for (let i = 0; i < ys.length - 1; i++) for (let j = 0; j < radial; j++) { const a = i * (radial + 1) + j, b = a + radial + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function cactusColumnar(seed = 1) {
  const r = lcg(seed * 281 + 17), root = new THREE.Group(), sw = [];
  const mat = plainMat('cactus', 0xffffff, { rough: 0.5, map: texCactus() });
  [[2.2, 0.08, [0.03, -0.02]], [rr(r, 1.6, 1.85), 0.07, [-0.12, 0.05]], [rr(r, 1.2, 1.4), 0.062, [0.08, 0.12]]].forEach(([h, R, [x, z]], i) => {
    const a = Math.atan2(x, z), l = i === 0 ? 0.01 : rr(r, 0.03, 0.06);
    const m = meshOf(ribbedColumn(h, R, r, { lean: [Math.sin(a) * l, Math.cos(a) * l], bow: [Math.sin(a) * 0.01, Math.cos(a) * 0.01] }), mat);
    m.position.set(x, 0, z); m.rotation.y = r() * TAU;
    const [pv, inn] = pivotAt(root, [x, 0, z]); inn.add(m); addSway(sw, pv, i, 0.002, 0.5);
  });
  autoCollider(root, 0.02);
  return finish(root, sw, { id: 'plants-cactusColumnar', name: 'Columnar euphorbia', zh: '柱状大戟', note: '2.2 m, three 8-ribbed columns Ø0.12–0.16' });
}

// ------------------------------------------------------------------ indoor: pampas in a white vase, small pot plant
function pampasVase(seed = 1) {
  const r = lcg(seed * 307 + 19), root = new THREE.Group(), sw = [];
  root.add(lathe([[0.001, 0], [0.055, 0], [0.062, 0.006], [0.078, 0.05], [0.09, 0.13], [0.09, 0.2], [0.08, 0.28], [0.062, 0.35], [0.048, 0.4], [0.045, 0.43], [0.05, 0.446], [0.047, 0.452], [0.04, 0.446], [0.038, 0.42], [0.042, 0.38], [0.001, 0.36]], M.ceramicWhite(), { seg: 40 }));
  const plumeM = leafMat('pampas', texPlume('pampas2', { W: 128, H: 512, hairs: 4200, len: [20, 58], cols: ['#ece0c6', '#d9c7a0', '#cdb68c', '#e3d3b0'], angle: [0.25, 0.9], env: 0.7 }), { rough: 0.95 });
  const stalkM = plainMat('pampasStalk', 0xffffff, { rough: 0.7 }), sC = lin('#c9b28a');
  const n = 5 + Math.floor(r() * 3), y0 = r() * TAU;
  for (let i = 0; i < n; i++) {
    const yaw = y0 + i * TAU / n + rr(r, -0.3, 0.3), tilt = rr(r, 0.06, 0.32), top = rr(r, 1.12, 1.3), d = dirOf(yaw, tilt);
    const P0 = [Math.sin(yaw) * 0.015, 0.38, Math.cos(yaw) * 0.015], Lst = (top - 0.38 - 0.3) / d[1];
    const P2 = add3(add3(P0, d, Lst), [0, 0, 0]), P1 = add3(add3(P0, d, Lst * 0.5), [d[0] * -0.03, 0, d[2] * -0.03]);
    const sg = stemGeo([P0, P1, P2], [0.0035, 0.0025], { seg: 10, radial: 4 }), cv = sg.userData.curve, [yd, td] = yawTilt(cv.getTangentAt(1).toArray());
    const [pv, inn] = pivotAt(root, P0), pb = new Batch();
    inn.add(new Batch().add(sg, { tint: sC.map(v => v * rr(r, 0.9, 1.1)) }).mesh(stalkM));
    for (let m = 0; m < 4; m++) pb.add(cardGeo(0.17, 0.4, { sy: 4, bend: rr(r, 0.05, 0.3) }), { pos: add3(P2, dirOf(yd, td), -0.06), q: orient(yd, td, (m * Math.PI) / 4 + yaw), tint: tint(r, 0.06) });
    inn.add(pb.mesh(plumeM)); addSway(sw, pv, i, 0.004, 0.6);
  }
  setCollider(root, { w: 0.2, d: 0.2, h: 0.45 });
  return finish(root, sw, { id: 'plants-pampasVase', name: 'Pampas grass in white vase', zh: '花瓶蒲苇', note: 'Ø0.18 × 0.45 ceramic vase, dried plumes to 1.3 m' });
}
function potPlant(seed = 1) {
  const r = lcg(seed * 331 + 23), root = new THREE.Group(), sw = [];
  root.add(lathe([[0.001, 0], [0.055, 0], [0.06, 0.004], [0.075, 0.13], [0.08, 0.14], [0.08, 0.146], [0.074, 0.146], [0.071, 0.135], [0.001, 0.125]], M.ceramicWhite(), { seg: 36 }));
  const soil = new THREE.Mesh(new THREE.CircleGeometry(0.071, 24), plainMat('soil', 0x3a2a1e, { rough: 1, vertexColors: false })); soil.rotation.x = -Math.PI / 2; soil.position.y = 0.128; root.add(shadow(soil));
  const leafM = leafMat('heart', texHeart(), { rough: 0.38 }), petM = plainMat('pothosPet', 0xffffff, { rough: 0.6 }), pC = lin('#7aa04a');
  const n = 16, y0 = r() * TAU, S = 2, lb = [new Batch(), new Batch()], pb = [new Batch(), new Batch()];
  for (let i = 0; i < n; i++) {
    const yaw = y0 + i * GOLD + rr(r, -0.2, 0.2), tilt = 0.15 + 1.1 * (i / n) + rr(r, -0.1, 0.1), L = rr(r, 0.07, 0.13) * (1 - 0.3 * tilt / 1.25), d = dirOf(yaw, tilt);
    const P0 = [Math.sin(yaw) * 0.02, 0.128, Math.cos(yaw) * 0.02], E = add3(add3(P0, d, L), [0, 0.01, 0]);
    pb[i % S].add(stemGeo([P0, add3(add3(P0, d, L * 0.5), [0, 0.015, 0]), E], [0.0025, 0.002], { seg: 5, radial: 4 }), { tint: pC });
    lb[i % S].add(cardGeo(0.085, 0.1, { sx: 2, sy: 3, bend: 0.3, fold: 0.12 }), { pos: E, q: orient(yaw, Math.min(1.5, tilt + 0.45), rr(r, -0.3, 0.3)), s: rr(r, 0.85, 1.2), tint: tint(r) });
  }
  for (let s = 0; s < S; s++) { const [pv, inn] = pivotAt(root, [0, 0.13, 0]); inn.add(pb[s].mesh(petM), lb[s].mesh(leafM)); addSway(sw, pv, s, 0.006, 0.7); }
  setCollider(root, { w: 0.17, d: 0.17, h: 0.35 });
  return finish(root, sw, { id: 'plants-potPlant', name: 'Pothos in white pot', zh: '小盆栽', note: '0.35 m houseplant, Ø0.16 white ceramic pot' });
}

// Front terrace specimens, kept separate from the back garden's established species.
function birdPaddle(seed = 1) {
  const r = lcg(seed * 127 + 9), root = new THREE.Group(), sw = [], stems = new Batch(), leaves = new Batch();
  for (let i = 0; i < 15; i++) {
    const yaw = i * GOLD + rr(r, -.15, .15), h = rr(r, .65, 1.35), rad = rr(r, .12, .35), A = [Math.sin(yaw) * rad, .02, Math.cos(yaw) * rad];
    const E = [A[0] + Math.sin(yaw) * .32, h, A[2] + Math.cos(yaw) * .32];
    stems.add(stemGeo([A, add3(A, [Math.sin(yaw) * .12, h * .55, Math.cos(yaw) * .12]), E], [.025, .013], { seg: 6, radial: 6 }), { tint: lin('#79964f') });
    leaves.add(cardGeo(rr(r, .38, .58), rr(r, 1.1, 1.55), { sx: 4, sy: 12, bend: .24 + (i % 4) * .18, fold: .16, twist: rr(r, -.2, .2) }), { pos: E, q: orient(yaw, rr(r, .15, .9), 0), tint: tint(r, .14) });
  }
  root.add(stems.mesh(plainMat('frontPetiole', 0xffffff, { rough: .62 })));
  const [pv, inn] = pivotAt(root, [0, .3, 0]); inn.add(leaves.mesh(leafMat('frontPaddle', texBanana(false), { rough: .52 }))); addSway(sw, pv, seed, .015, .65);
  setCollider(root, { w: .45, d: .45, h: 2.5 });
  return finish(root, sw, { id: 'plants-bird-paddle', name: 'Giant bird of paradise', zh: '天堂鸟' });
}
function cordyline(seed = 1) {
  const r = lcg(seed * 173 + 8), root = new THREE.Group(), sw = [], stems = new Batch(), leaves = new Batch();
  for (let j = 0; j < 4; j++) {
    const a = j * GOLD, h = .3 + j * .28, C = [Math.sin(a) * .15, h, Math.cos(a) * .15];
    stems.add(stemGeo([[C[0], 0, C[2]], [C[0] * 1.1, h * .6, C[2]], C], [.021, .014], { seg: 4, radial: 6 }), { tint: lin('#745944') });
    for (let i = 0; i < 14; i++) {
      const yaw = i * GOLD + a, t = i / 13;
      leaves.add(cardGeo(rr(r, .11, .17), rr(r, .55, .82), { sx: 2, sy: 8, bend: .3 + t * .9, fold: -.18, twist: rr(r, -.4, .4) }), { pos: add3(C, [0, -.13 * t, 0]), q: orient(yaw, .15 + t * 1.35, 0), tint: tint(r, .2) });
    }
  }
  root.add(stems.mesh(plainMat('frontTiStem', 0xffffff, { rough: .9 })));
  const [pv, inn] = pivotAt(root, [0, .2, 0]); inn.add(leaves.mesh(leafMat('frontTi', texStrap('frontTi', '#6c293e', '#39212e', '#995655'), { rough: .42 }))); addSway(sw, pv, seed, .017, .8);
  setCollider(root, { w: .35, d: .35, h: 1.8 });
  return finish(root, sw, { id: 'plants-cordyline', name: 'Burgundy cordyline', zh: '朱蕉' });
}
function arecaClump(seed = 1, dense = false) {
  const r = lcg(seed * 197 + 3), root = new THREE.Group(), sw = [], stems = new Batch(), leaves = new Batch();
  const pinna = cardGeo(dense ? .085 : .055, dense ? .64 : .47, { sx: 1, sy: 5, bend: .5, fold: .12 });
  // Street-band clumps: cane count, spread, frond length, pinna count and colour vary per seed so neighbours aren't clones.
  const canes = dense ? 5 + Math.floor(r() * 4) : 5, spread = dense ? rr(r, .14, .3) : .22;
  const greens = ['#5d8a3a', '#67913f', '#739a44', '#7f9f45'], olds = ['#8da94b', '#9cab52', '#a7ad5a'];
  for (let j = 0; j < (dense ? canes : 5); j++) {
    const a = j * GOLD + (dense ? rr(r, -.35, .35) : 0), h = rr(r, dense ? .55 : .45, dense ? 1.35 : 1.1), cr = dense ? spread * rr(r, .5, 1.25) : .22, C = [Math.sin(a) * cr, h, Math.cos(a) * cr];
    stems.add(stemGeo([[C[0] * .6, 0, C[2] * .6], [C[0], h * .55, C[2]], C], [.022, .014], { seg: 5, radial: 6 }), { tint: lin(dense ? (j % 2 ? '#5f6b30' : '#6e7435') : '#a19f46') });
    const fronds = dense ? 6 + Math.floor(r() * 3) : 6;
    for (let f = 0; f < (dense ? fronds : 6); f++) {
      const yaw = a + f * GOLD + (dense ? rr(r, -.3, .3) : 0), L = rr(r, f < 2 ? .65 : 1.05, f < 2 ? .95 : 1.48) * (dense ? rr(r, .8, 1.05) : 1), rise = rr(r, f < 2 ? 1.3 : .6, f < 2 ? 1.6 : 1.0);
      const arch = dense ? rr(r, .62, .85) : .72, nk = dense ? 17 + Math.floor(r() * 7) : 21, droop = dense ? rr(r, -.15, .3) : 0;
      const green = dense && lin(greens[Math.floor(r() * 4) % 4]), old = dense && lin(olds[Math.floor(r() * 3) % 3]), yellow = dense && f >= 5 && r() < .5;
      const F = f === 5 ? [C[0], .16, C[2]] : C;
      const at = t => add3(F, [Math.sin(yaw) * L * t, rise * Math.sin(t * Math.PI * arch), Math.cos(yaw) * L * t]);
      stems.add(stemGeo([0, .25, .5, .75, 1].map(at), [.009, .002], { seg: 12, radial: 4 }), { tint: lin(dense ? '#6d7a36' : '#9d9d43') });
      for (let k = 1; k <= nk; k++) for (const side of [-1, 1]) {
        const t = k / (nk + 1), len = (.45 + .5 * Math.sin(t * Math.PI)) * rr(r, .9, 1.1);
        const col = dense ? (yellow || r() < .18 ? old : green) : lin(k % 4 ? '#95a64c' : '#b0b459');
        leaves.add(pinna, { pos: at(t), q: orient(yaw + side * 1.12, 1.0 + t * .65 + droop, side * .2), s: [1, len, 1], tint: col });
      }
    }
  }
  const [pv, inn] = pivotAt(root, [0, .1, 0]); inn.add(stems.mesh(plainMat('frontPalmStem', 0xffffff, { rough: .78 })), leaves.mesh(leafMat('frontPalmPinna', texStrap('frontPalmPinna', '#769641', '#b3bc63', '#6a8e36'), { rough: .65 }))); addSway(sw, pv, seed, .012, .6);
  if (dense) { const w = rr(r, .68, .86); root.scale.set(w, 1, w); }
  setCollider(root, { w: .45, d: .45, h: 2.2 });
  return finish(root, sw, { id: 'plants-areca', name: 'Clumping feathery palm', zh: '散尾葵' });
}
function muhlyFront(seed = 1) {
  const root = grassClump(seed), r = lcg(seed * 137 + 2), b = new Batch();
  for (let i = 0; i < 110; i++) {
    const a = r() * TAU, rad = Math.sqrt(r()) * .65;
    b.add(cardGeo(.16, rr(r, .28, .46), { sy: 3, bend: .2 }), { pos: [Math.sin(a) * rad, rr(r, .6, .85), Math.cos(a) * rad], q: orient(a, rr(r, .1, .55), r() * TAU), tint: tint(r, .15) });
  }
  const cloud = paint('frontMuhlyCloudFine', 256, 256, (g, W, H, rnd) => {
    g.lineWidth = .55;
    for (let i = 0; i < 95; i++) {
      const a = rnd() * TAU, rad = Math.sqrt(rnd()), x = W * (.5 + Math.sin(a) * rad * .44), y = H * (.45 + Math.cos(a) * rad * .4);
      g.strokeStyle = i % 3 ? '#cbb3a2' : '#dbc4bc';
      g.beginPath(); g.moveTo(W * .5, H * .96); g.quadraticCurveTo(W * .5 + (x - W * .5) * .4, y + 15, x, y); g.stroke();
      g.fillStyle = '#dfc8be'; g.fillRect(x, y, 1, 1);
    }
  });
  root.children[0].add(b.mesh(leafMat('frontMuhly', cloud, { rough: .9 })));
  root.scale.set(1.3, 1.2, 1.3); return root;
}

// Low spreading sprigs close the gaps under the front specimens, sharing the hedge material.
function frontCover(seed = 1) {
  const r = lcg(seed * 233 + 4), root = new THREE.Group(), b = new Batch();
  const tex = texSprig('shrub2', { n: 38, len: [44, 64], wid: [18, 26], rx: .33, ry: .36, dark: .65, base: '#2d5c25', hi: '#78aa50' });
  const geo = cardGeo(.24, .34, { sy: 2, bend: .65 });
  for (let k = 0; k < 86; k++) {
    const a = k * GOLD, rad = Math.sqrt(r()) * .62;
    b.add(geo, { pos: [Math.sin(a) * rad, rr(r, .015, .11), Math.cos(a) * rad * .7], q: orient(a, rr(r, .45, 1.4), rr(r, -.4, .4)), s: rr(r, .65, 1.1), tint: tint(r, .23) });
  }
  root.add(b.mesh(leafMat('shrub', tex, { rough: .7, soft: true })));
  describe(root, { id: 'plants-front-cover', name: 'Tropical groundcover', zh: '地被植物' }); return root;
}
function frontQueen(seed = 1) {
  const r = lcg(seed * 239 + 3), root = new THREE.Group(), stems = new Batch(), leaves = new Batch(), H = rr(r, 3.8, 4.5);
  root.add(new Batch().add(stemGeo([[0, 0, 0], [.06, H * .4, 0], [.12, H * .8, -.04], [.14, H, -.08]], [.14, .095], { seg: 16, radial: 10 }), { tint: lin('#a9a18a') }).mesh(M.bark()));
  const pinna = cardGeo(.075, .7, { sy: 5, bend: .65, fold: .12 });
  for (let f = 0; f < 15; f++) {
    const yaw = f * GOLD, L = rr(r, 1.55, 2.15), rise = f < 4 ? 1.65 : rr(r, .65, 1.1), drop = f < 4 ? .3 : .95;
    const at = t => [.14 + Math.sin(yaw) * L * t, H + rise * Math.sin(t * Math.PI * .8) - drop * t * t, -.08 + Math.cos(yaw) * L * t];
    stems.add(stemGeo([0, .25, .5, .75, 1].map(at), [.024, .003], { seg: 12, radial: 5 }), { tint: lin('#8a9456') });
    for (let k = 1; k < 26; k++) for (const side of [-1, 1]) {
      const t = k / 26;
      leaves.add(pinna, { pos: at(t), q: orient(yaw + side * 1.1, 1.1 + t * .9, side * .2), s: [1, .5 + .55 * Math.sin(t * Math.PI), 1], tint: lin(k % 4 ? '#82a45e' : '#a5b47c') });
    }
  }
  root.add(stems.mesh(plainMat('frontPalmStem', 0xffffff, { rough: .78 })), leaves.mesh(leafMat('frontPalmPinna', texStrap('frontPalmPinna', '#769641', '#b3bc63', '#6a8e36'), { rough: .65 })));
  setCollider(root, { w: .3, d: .3, h: H }); describe(root, { id: 'plants-front-queen', name: 'Queen palm', zh: '皇后葵' }); return root;
}

export const items = {
  frontCover, frontQueen, frontAreca: (seed = 1) => arecaClump(seed, true),
  birdPaddle, cordyline, arecaClump, muhlyFront,
  banana: (seed = 1) => banana(seed),
  palmFan: (seed = 1) => palmFan(seed),
  bromeliad: (seed = 1, variant = 'red') => bromeliad(seed, variant),
  bromeliadGreen: (seed = 1) => bromeliad(seed, 'green'),
  grassClump: (seed = 1) => grassClump(seed),
  shrubGreen: (seed = 1, tone = 'green') => shrubGreen(seed, tone),
  shrubGold: (seed = 1) => shrubGreen(seed, 'gold'),
  coleus: (seed = 1) => coleus(seed),
  croton: (seed = 1) => croton(seed),
  treeLarge: (seed = 1) => treeLarge(seed),
  treePine: (seed = 1) => treePine(seed),
  cactusColumnar: (seed = 1) => cactusColumnar(seed),
  pampasVase: (seed = 1) => pampasVase(seed),
  potPlant: (seed = 1) => potPlant(seed),
};
