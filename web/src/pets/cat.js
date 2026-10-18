// Pet module contract (canonical; shared by cat.js and dog.js, driven by roam.js). Metres, seconds, radians.
// export function createPet(opts?) → {
//   root,        THREE.Object3D: origin on the ground under the body centre, facing +Z. roam.js owns root.position / rotation.y.
//   radius,      body radius for navigation/avoidance (m)
//   walkSpeed,   natural slow-walk ground speed (m/s); jumpHeight (m, apex of a playful hop), jumpDuration (s, crouch → settled)
//   update(dt, s)  s = { mode: 'idle' | 'walk' | 'sit' | 'lie' | 'jump', speed, turn, t, jumpT } — animate the rig only
//                  speed: ground speed (m/s), stride frequency follows it; turn: yaw rate (rad/s, + = turning left);
//                  t: running time (s); jumpT: 0..1 through the jump while mode === 'jump'.
//   dispose()
// }
// Optional extensions — roam.js treats every one as optional, so a pet with only the fields above works:
//   jumpTakeoff, jumpLand   jumpT at which the paws leave / touch the ground (default 0.3 / 0.8). roam.js moves the root
//                           along the arc only in between, so crouch and landing poses stay planted.
//   maxPerch                highest surface (m above the floor) the pet will jump up onto; 0 / undefined = never perches.
//   trotSpeed               quicker gait for stepping out of the way (m/s; default 1.6 × walkSpeed).
//   s.look                  world-space THREE.Vector3 worth looking at (the player's head when near), or null.
//   s.lift                  height of the root above the surface under it (m; > 0 while airborne): keep the blob shadow down.
//   s.jumpDy                height change of the current jump (m; + = up onto something, − = down).
//   s.camDist               camera → root distance (m), for level of detail.
// Player interaction (roam.js decides when; the pet only animates):
//   s.attend                true while it sits in front of the player after being called (mode 'sit', s.look = the player's
//                           head): tip the head up to meet it.
//   s.excite                0..1 eagerness: 1 while hurrying to a call or being petted, decaying afterwards (the dog wags harder).
//   callSpeed               gait when the player calls the pet (m/s; default trotSpeed): dog trots ≈ 0.9, cat walks briskly
//                           ≈ 0.5. Arrives as mode 'walk' at that speed (stride follows s.speed), then 'sit' with s.look = the
//                           player's head, so the head tracks it (looking up at the player).
//   pickBox                 [x0, y0, z0, x1, y1, z1] root-space box the player's crosshair is tested against (default from
//                           radius). Hover + click on it pets the pet; nothing ever raycasts the fur.
//   mode 'pet'              being petted by the player (roam.js holds the pet still and faces it toward the player; ≈ 5 s,
//                           extended by petting again). Fields while petting: s.petT seconds since this petting began (keeps
//                           counting when extended), s.petLeft seconds still to go (wind the reaction down to a neutral
//                           stand as it nears 0), s.petN petting count (vary the reaction with it), s.hand world-space
//                           THREE.Vector3 where the player's hand is (above the head, toward the player), s.look = player's
//                           head. Cat: tail up, head-bump / lean into the hand, eyes half closed, kneading. Dog: excited tail
//                           wag, head tilt, a little hop or a roll onto its back for a belly rub. roam.js adds floating hearts.
//                           A pet without a 'pet' animation falls back to 'sit' with s.look.
//   modes                   list of the modes the pet animates (roam.js uses it to detect 'pet' support).
// Pets never cast sun shadows (the shadow map only refreshes when something moves); each carries its own blob shadow.
import * as THREE from 'three';
import { declare } from '../lighting_roles.js';

// ---------------------------------------------------------------- helpers
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mix = (a, b, t) => a + (b - a) * t;
const sst = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function mulberry(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hash3(x, y, z) { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1440662683)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const a = hash3(ix, iy, iz), b = hash3(ix + 1, iy, iz), c = hash3(ix, iy + 1, iz), d = hash3(ix + 1, iy + 1, iz);
  const e = hash3(ix, iy, iz + 1), f = hash3(ix + 1, iy, iz + 1), g = hash3(ix, iy + 1, iz + 1), h = hash3(ix + 1, iy + 1, iz + 1);
  const k0 = a + (b - a) * ux, k1 = c + (d - c) * ux, k2 = e + (f - e) * ux, k3 = g + (h - g) * ux;
  const l0 = k0 + (k1 - k0) * uy, l1 = k2 + (k3 - k2) * uy;
  return l0 + (l1 - l0) * uz;
}
const fbm = (x, y, z) => vnoise(x, y, z) * 0.55 + vnoise(x * 2.07 + 5.3, y * 2.07 + 1.7, z * 2.07 + 9.1) * 0.3 + vnoise(x * 4.3 + 2.2, y * 4.3 + 7.7, z * 4.3 + 3.4) * 0.15;

// ---------------------------------------------------------------- skeleton (rest = standing; every bone's rest orientation is identity)
// European shorthair, adult: head+body 46 cm, withers 25 cm, tail 28 cm. +X is the cat's left.
const BONES = [
  ['root', null, 0, 0, 0],
  ['hips', 'root', 0, 0.205, -0.125],
  ['spine1', 'hips', 0, 0.212, -0.055],
  ['spine2', 'spine1', 0, 0.208, 0.015],
  ['chest', 'spine2', 0, 0.198, 0.080],
  ['neck', 'chest', 0, 0.222, 0.128],
  ['head', 'neck', 0, 0.270, 0.178],
  ['earL', 'head', 0.023, 0.300, 0.184], ['earR', 'head', -0.023, 0.300, 0.184],
];
const TAILJ = []; for (let i = 0; i <= 6; i++) TAILJ.push([0, 0.226 - 0.004 * i, -0.188 - 0.0465 * i]);
for (let i = 0; i < 6; i++) BONES.push(['tail' + i, i ? 'tail' + (i - 1) : 'hips', ...TAILJ[i]]);
for (const [s, x] of [['L', 1], ['R', -1]]) BONES.push(
  ['scap' + s, 'chest', 0.024 * x, 0.222, 0.098], ['upper' + s, 'scap' + s, 0.031 * x, 0.170, 0.130], ['fore' + s, 'upper' + s, 0.028 * x, 0.114, 0.102], ['paw' + s, 'fore' + s, 0.025 * x, 0.032, 0.114],
  ['thigh' + s, 'hips', 0.034 * x, 0.196, -0.128], ['shin' + s, 'thigh' + s, 0.040 * x, 0.126, -0.082], ['foot' + s, 'shin' + s, 0.036 * x, 0.068, -0.166], ['toe' + s, 'foot' + s, 0.033 * x, 0.014, -0.150]);
const NB = BONES.length;
const BI = Object.fromEntries(BONES.map((b, i) => [b[0], i]));
const PARENT = BONES.map(b => (b[1] ? BI[b[1]] : -1));
const OFF = BONES.map((b, i) => (PARENT[i] < 0 ? [b[2], b[3], b[4]] : [b[2] - BONES[PARENT[i]][2], b[3] - BONES[PARENT[i]][3], b[4] - BONES[PARENT[i]][4]]));
const SLEN = OFF.map(o => Math.hypot(o[1], o[2])), SANG = OFF.map(o => Math.atan2(o[1], o[2]));   // sagittal length / angle of each bone's offset
const TIP = { paw: [0, 0.010 - 0.032, 0.138 - 0.114], toe: [0, 0.010 - 0.014, -0.126 + 0.150] };      // leaf bone → tip of the paw
const TIPLEN = { paw: Math.hypot(TIP.paw[1], TIP.paw[2]), toe: Math.hypot(TIP.toe[1], TIP.toe[2]) };
const TIPANG = { paw: Math.atan2(TIP.paw[1], TIP.paw[2]), toe: Math.atan2(TIP.toe[1], TIP.toe[2]) };
const FRONT_TIP_Z = 0.138, HIND_BALL_Z = -0.150;

// ---------------------------------------------------------------- body as a smooth signed distance field
function sdEll(x, y, z, rx, ry, rz) {
  const a = x / rx, b = y / ry, c = z / rz, k0 = Math.sqrt(a * a + b * b + c * c);
  const d = a / rx, e = b / ry, f = c / rz, k1 = Math.sqrt(d * d + e * e + f * f);
  return k1 < 1e-9 ? -Math.min(rx, ry, rz) : k0 * (k0 - 1) / k1;
}
function sdCone(p, x, y, z) {   // iq's round cone between spheres (a, r1) and (b, r2)
  const pax = x - p.a[0], pay = y - p.a[1], paz = z - p.a[2];
  const yy = pax * p.ba[0] + pay * p.ba[1] + paz * p.ba[2], zz = yy - p.l2;
  const xvx = pax * p.l2 - p.ba[0] * yy, xvy = pay * p.l2 - p.ba[1] * yy, xvz = paz * p.l2 - p.ba[2] * yy;
  const x2 = xvx * xvx + xvy * xvy + xvz * xvz, y2 = yy * yy * p.l2, z2 = zz * zz * p.l2, k = Math.sign(p.rr) * p.rr * p.rr * x2;
  if (Math.sign(zz) * p.a2 * z2 > k) return Math.sqrt(x2 + z2) * p.il2 - p.r2;
  if (Math.sign(yy) * p.a2 * y2 < k) return Math.sqrt(x2 + y2) * p.il2 - p.r1;
  return (Math.sqrt(x2 * p.a2 * p.il2) + yy * p.rr) * p.il2 - p.r1;
}
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

function buildPrims() {
  const P = [];
  const E = (c, r, o) => { const p = { t: 0, c, r, bs: [...c, Math.max(...r)], ...o }; if (o.rot) p.m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...o.rot)).elements.slice(); P.push(p); };
  const C = (a, r1, b, r2, o) => {
    const ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l2 = ba[0] ** 2 + ba[1] ** 2 + ba[2] ** 2, rr = r1 - r2;
    P.push({ t: 1, a, b, r1, r2, ba, l2, rr, a2: l2 - rr * rr, il2: 1 / l2, bs: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, Math.sqrt(l2) / 2 + Math.max(r1, r2)], ...o });
  };
  const TZ = [['hips', -0.125], ['spine1', -0.055], ['spine2', 0.015], ['chest', 0.08]];
  const cb = [0, -0.25, -1], cl = [0, -1, 0.05];
  // torso: deep, laterally narrow rib cage; tuck-up toward the loin; rounded rump
  E([0, 0.186, 0.070], [0.045, 0.066, 0.070], { k: 0.03, wz: TZ, reg: 0, fur: 1.0, comb: cb });
  E([0, 0.190, 0.000], [0.051, 0.061, 0.085], { k: 0.03, wz: TZ, reg: 0, fur: 1.05, comb: cb });
  E([0, 0.198, -0.078], [0.047, 0.053, 0.070], { k: 0.03, wz: TZ, reg: 0, fur: 1.1, comb: cb });
  E([0, 0.198, -0.138], [0.046, 0.049, 0.056], { k: 0.03, wz: TZ, reg: 0, fur: 1.05, comb: cb });
  E([0, 0.150, 0.060], [0.028, 0.035, 0.045], { k: 0.03, wz: TZ, reg: 0, fur: 1.1, comb: [0, -0.6, -1] });
  C([0, 0.205, 0.095], 0.046, [0, 0.252, 0.163], 0.036, { k: 0.025, wz: [['chest', 0.09], ['neck', 0.13], ['head', 0.172]], reg: 0, fur: 1.15, comb: [0, -0.5, -1] });
  // head: round cranium, wide cheeks, short muzzle with whisker pads, small chin, nose bridge, brows; eye sockets carved out
  const ch = [0, -0.1, -1];
  E([0, 0.283, 0.193], [0.038, 0.034, 0.040], { k: 0.02, wb: 'head', reg: 1, fur: 0.6, comb: ch });
  E([0.020, 0.266, 0.206], [0.024, 0.021, 0.026], { k: 0.012, sym: 1, wb: 'head', reg: 1, fur: 0.75, comb: [0.6, -0.3, -1] });
  E([0, 0.262, 0.226], [0.021, 0.017, 0.018], { k: 0.01, wb: 'head', reg: 1, fur: 0.45, comb: [0, -0.4, -1] });
  E([0.0095, 0.2585, 0.2375], [0.0115, 0.0095, 0.0105], { k: 0.006, sym: 1, wb: 'head', reg: 1, fur: 0.4, comb: [1, -0.3, -0.5] });
  E([0, 0.2485, 0.229], [0.0095, 0.0075, 0.0115], { k: 0.006, wb: 'head', reg: 1, fur: 0.5, comb: [0, -1, -0.5] });
  C([0, 0.293, 0.226], 0.0122, [0, 0.2765, 0.2472], 0.0076, { k: 0.008, wb: 'head', reg: 1, fur: 0.35, comb: [0, 1, -1] });
  E([0.0165, 0.2958, 0.2215], [0.0138, 0.0078, 0.0118], { k: 0.008, sym: 1, wb: 'head', reg: 1, fur: 0.5, comb: [0.3, 0.4, -1] });
  E([0.0182, 0.2852, 0.2312], [0.0112, 0.0063, 0.0085], { k: 0.003, sym: 1, sub: 1, rot: [0.05, -0.3, 0.24], wb: 'head', reg: 1 });
  // forelegs: shoulder mass, humerus, slim forearm, round paw with toe bumps
  E([0.027, 0.19, 0.106], [0.016, 0.038, 0.028], { k: 0.022, sym: 1, wb: 'scap*', reg: 0, fur: 0.95, comb: [0, -1, -0.4] });
  C([0.030, 0.168, 0.124], 0.0185, [0.028, 0.114, 0.102], 0.0135, { k: 0.02, sym: 1, ws: ['scap*', 'upper*', 'fore*'], reg: 'F', fur: 0.8, comb: cl });
  C([0.028, 0.114, 0.102], 0.0135, [0.025, 0.032, 0.114], 0.0088, { k: 0.008, sym: 1, ws: ['upper*', 'fore*', 'paw*'], reg: 'F', fur: 0.55, comb: cl });
  C([0.025, 0.032, 0.114], 0.0088, [0.025, 0.016, 0.124], 0.011, { k: 0.006, sym: 1, ws: ['fore*', 'paw*', null], reg: 'F', fur: 0.45, comb: cl });
  E([0.025, 0.0105, 0.127], [0.0135, 0.0102, 0.0172], { k: 0.006, sym: 1, wb: 'paw*', reg: 'F', fur: 0.4, comb: [0, -0.3, 1] });
  for (const [dx, dz] of [[-0.0095, 0], [-0.0032, 0.0035], [0.0032, 0.0035], [0.0095, 0]]) E([0.025 + dx * 0.95, 0.0078, 0.136 + dz], [0.0053, 0.0066, 0.006], { k: 0.004, sym: 1, wb: 'paw*', reg: 'F', fur: 0.35, comb: [0, -0.3, 1] });
  // hind legs: muscular thigh, calf, long metatarsus with the hock point, oval paw
  E([0.037, 0.163, -0.108], [0.025, 0.058, 0.044], { k: 0.025, sym: 1, rot: [-0.45, 0, 0], wb: 'thigh*', reg: 'H', fur: 1.0, comb: [0, -0.7, -1] });
  C([0.034, 0.196, -0.128], 0.028, [0.040, 0.126, -0.082], 0.019, { k: 0.015, sym: 1, ws: ['hips', 'thigh*', 'shin*'], reg: 'H', fur: 0.95, comb: [0, -0.7, -1] });
  C([0.040, 0.126, -0.082], 0.018, [0.036, 0.068, -0.166], 0.0105, { k: 0.008, sym: 1, ws: ['thigh*', 'shin*', 'foot*'], reg: 'H', fur: 0.7, comb: [0, -1, -0.6] });
  E([0.039, 0.108, -0.112], [0.0155, 0.022, 0.019], { k: 0.008, sym: 1, rot: [0.8, 0, 0], wb: 'shin*', reg: 'H', fur: 0.75, comb: [0, -1, -0.6] });
  C([0.036, 0.068, -0.166], 0.0105, [0.033, 0.016, -0.150], 0.0102, { k: 0.006, sym: 1, ws: ['shin*', 'foot*', 'toe*'], reg: 'H', fur: 0.45, comb: cl });
  E([0.036, 0.070, -0.172], [0.008, 0.009, 0.008], { k: 0.005, sym: 1, wb: 'foot*', reg: 'H', fur: 0.45, comb: cl });
  E([0.033, 0.0105, -0.140], [0.0135, 0.0105, 0.019], { k: 0.006, sym: 1, wb: 'toe*', reg: 'H', fur: 0.4, comb: [0, -0.3, 1] });
  for (const [dx, dz] of [[-0.0088, 0], [-0.003, 0.0032], [0.003, 0.0032], [0.0088, 0]]) E([0.033 + dx, 0.0078, -0.1275 + dz], [0.0054, 0.0068, 0.006], { k: 0.004, sym: 1, wb: 'toe*', reg: 'H', fur: 0.35, comb: [0, -0.3, 1] });
  // tail: tapering chain
  const TR = [0.0165, 0.0135, 0.0125, 0.012, 0.0115, 0.0105, 0.0085];
  for (let i = 0; i < 6; i++) C(TAILJ[i], TR[i], TAILJ[i + 1], TR[i + 1], { k: i ? 0.003 : 0.02, ws: [i ? 'tail' + (i - 1) : 'hips', 'tail' + i, i < 5 ? 'tail' + (i + 1) : null], reg: 6, fur: 1.15, comb: [0, -0.1, -1] });
  return P;
}
function evalPrim(p, x, y, z) {
  if (p.sym && x < 0) x = -x;
  if (p.t === 1) return sdCone(p, x, y, z);
  let dx = x - p.c[0], dy = y - p.c[1], dz = z - p.c[2];
  if (p.m) { const m = p.m, lx = m[0] * dx + m[1] * dy + m[2] * dz, ly = m[4] * dx + m[5] * dy + m[6] * dz, lz = m[8] * dx + m[9] * dy + m[10] * dz; dx = lx; dy = ly; dz = lz; }
  return sdEll(dx, dy, dz, p.r[0], p.r[1], p.r[2]);
}
function sdf(list, x, y, z) {
  let d = 1e9;
  for (let i = 0; i < list.length; i++) { const p = list[i]; if (!p.sub) d = smin(d, evalPrim(p, x, y, z), p.k); }
  for (let i = 0; i < list.length; i++) { const p = list[i]; if (p.sub) d = -smin(-d, evalPrim(p, x, y, z), p.k); }
  return d;
}

// Naive surface nets over a block-culled grid; vertices are Newton-projected onto the field, normals from its gradient.
function polygonize(prims, h) {
  const lo = [-0.074, -0.004, -0.488], hi = [0.074, 0.332, 0.264];
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 1, ny = Math.ceil((hi[1] - lo[1]) / h) + 1, nz = Math.ceil((hi[2] - lo[2]) / h) + 1;
  const F = new Float32Array(nx * ny * nz).fill(0.02), id = (i, j, k) => i + nx * (j + ny * k);
  const BS = 6, nbx = Math.ceil(nx / BS), nby = Math.ceil(ny / BS), nbz = Math.ceil(nz / BS), cand = new Array(nbx * nby * nbz);
  const reach = 2.5 * h + 0.03;
  for (let bk = 0; bk < nbz; bk++) for (let bj = 0; bj < nby; bj++) for (let bi = 0; bi < nbx; bi++) {
    const i0 = bi * BS, j0 = bj * BS, k0 = bk * BS, i1 = Math.min(nx, i0 + BS), j1 = Math.min(ny, j0 + BS), k1 = Math.min(nz, k0 + BS);
    const cx = lo[0] + (i0 + i1 - 1) / 2 * h, cy = lo[1] + (j0 + j1 - 1) / 2 * h, cz = lo[2] + (k0 + k1 - 1) / 2 * h, R = h * Math.hypot(i1 - i0, j1 - j0, k1 - k0) / 2;
    const list = prims.filter(p => { const px = p.sym ? Math.abs(cx) : cx; return Math.hypot(px - p.bs[0], cy - p.bs[1], cz - p.bs[2]) - p.bs[3] < R + reach; });
    const b = bi + nbx * (bj + nby * bk); cand[b] = list;
    if (!list.some(p => !p.sub)) continue;
    for (let k = k0; k < k1; k++) for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) F[id(i, j, k)] = sdf(list, lo[0] + i * h, lo[1] + j * h, lo[2] + k * h);
  }
  const cnx = nx - 1, cny = ny - 1, cell = new Int32Array(cnx * cny * (nz - 1)).fill(-1);
  const pos = [], vb = [];
  const v = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) { v[c] = F[id(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))]; if (v[c] < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const bit of [1, 2, 4]) for (let a = 0; a < 8; a++) {
      if (a & bit) continue; const b = a | bit; if ((v[a] < 0) === (v[b] < 0)) continue;
      const t = v[a] / (v[a] - v[b]);
      sx += (a & 1) + ((b & 1) - (a & 1)) * t; sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t; sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t; n++;
    }
    cell[i + cnx * (j + cny * k)] = pos.length / 3;
    pos.push(lo[0] + (i + sx / n) * h, lo[1] + (j + sy / n) * h, lo[2] + (k + sz / n) * h);
    vb.push(cand[Math.floor(i / BS) + nbx * (Math.floor(j / BS) + nby * Math.floor(k / BS))]);
  }
  const tris = [], C = (i, j, k) => cell[i + cnx * (j + cny * k)];
  const quad = (a, b, c, d) => { tris.push(a, b, c, a, c, d); };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const s0 = F[id(i, j, k)] < 0;
    if (i < nx - 1 && j > 0 && k > 0 && j < ny - 1 && k < nz - 1 && s0 !== (F[id(i + 1, j, k)] < 0)) quad(C(i, j - 1, k - 1), C(i, j, k - 1), C(i, j, k), C(i, j - 1, k));
    if (j < ny - 1 && i > 0 && k > 0 && i < nx - 1 && k < nz - 1 && s0 !== (F[id(i, j + 1, k)] < 0)) quad(C(i - 1, j, k - 1), C(i - 1, j, k), C(i, j, k), C(i, j, k - 1));
    if (k < nz - 1 && i > 0 && j > 0 && i < nx - 1 && j < ny - 1 && s0 !== (F[id(i, j, k + 1)] < 0)) quad(C(i - 1, j - 1, k), C(i, j - 1, k), C(i, j, k), C(i - 1, j, k));
  }
  // project onto the surface + gradient normals
  const nv = pos.length / 3, P = new Float32Array(pos), N = new Float32Array(nv * 3), e = h * 0.2;
  const K = [[1, -1, -1], [-1, -1, 1], [-1, 1, -1], [1, 1, 1]];
  for (let q = 0; q < nv; q++) {
    const list = vb[q]; let x = P[3 * q], y = P[3 * q + 1], z = P[3 * q + 2], gx = 0, gy = 0, gz = 0;
    for (let it = 0; it < 3; it++) {
      gx = gy = gz = 0; let d = 0;
      for (const [a, b, c] of K) { const f = sdf(list, x + a * e, y + b * e, z + c * e); d += f / 4; gx += a * f; gy += b * f; gz += c * f; }
      gx /= 4 * e; gy /= 4 * e; gz /= 4 * e;
      if (it === 2) break;
      const g2 = gx * gx + gy * gy + gz * gz; if (g2 < 1e-8) break;
      let sx = d * gx / g2, sy = d * gy / g2, sz = d * gz / g2; const sl = Math.hypot(sx, sy, sz); if (sl > h * 0.7) { sx *= h * 0.7 / sl; sy *= h * 0.7 / sl; sz *= h * 0.7 / sl; }
      x -= sx; y -= sy; z -= sz;
    }
    P[3 * q] = x; P[3 * q + 1] = y; P[3 * q + 2] = z;
    const gl = Math.hypot(gx, gy, gz) || 1; N[3 * q] = gx / gl; N[3 * q + 1] = gy / gl; N[3 * q + 2] = gz / gl;
  }
  const T = new Uint32Array(tris);
  for (let t = 0; t < T.length; t += 3) {   // outward winding
    const a = T[t], b = T[t + 1], c = T[t + 2];
    const ux = P[3 * b] - P[3 * a], uy = P[3 * b + 1] - P[3 * a + 1], uz = P[3 * b + 2] - P[3 * a + 2], wx = P[3 * c] - P[3 * a], wy = P[3 * c + 1] - P[3 * a + 1], wz = P[3 * c + 2] - P[3 * a + 2];
    const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
    if (fx * (N[3 * a] + N[3 * b] + N[3 * c]) + fy * (N[3 * a + 1] + N[3 * b + 1] + N[3 * c + 1]) + fz * (N[3 * a + 2] + N[3 * b + 2] + N[3 * c + 2]) < 0) { T[t + 1] = c; T[t + 2] = b; }
  }
  return { P, N, T };
}

// Per-vertex skin weights / region / fur length / comb direction from the primitives' blend weights.
const TAU_W = 0.006;
function skinVertex(prims, x, y, z, acc) {
  let dmin = 1e9; const ds = acc.ds;
  for (let i = 0; i < prims.length; i++) { const p = prims[i]; ds[i] = p.sub ? 1e9 : evalPrim(p, x, y, z); if (ds[i] < dmin) dmin = ds[i]; }
  acc.w.fill(0); acc.reg.fill(0); let fur = 0, cx = 0, cy = 0, cz = 0, tot = 0;
  const side = x >= 0 ? 'L' : 'R', bone = (n) => BI[n.endsWith('*') ? n.slice(0, -1) + side : n];
  for (let i = 0; i < prims.length; i++) {
    const p = prims[i]; if (p.sub) continue;
    const e = Math.exp(-(ds[i] - dmin) / TAU_W); if (e < 0.004) continue;
    if (p.wb) acc.w[bone(p.wb)] += e;
    else if (p.wz) { const c = p.wz; if (z <= c[0][1]) acc.w[bone(c[0][0])] += e; else if (z >= c[c.length - 1][1]) acc.w[bone(c[c.length - 1][0])] += e; else for (let k = 0; k < c.length - 1; k++) if (z < c[k + 1][1]) { const t = sst(c[k][1], c[k + 1][1], z); acc.w[bone(c[k][0])] += e * (1 - t); acc.w[bone(c[k + 1][0])] += e * t; break; } }
    else if (p.ws) {
      const px = p.sym ? Math.abs(x) : x, t = clamp(((px - p.a[0]) * p.ba[0] + (y - p.a[1]) * p.ba[1] + (z - p.a[2]) * p.ba[2]) / p.l2, 0, 1);
      const wp = p.ws[0] ? 0.5 * (1 - sst(0, 0.5, t)) : 0, wn = p.ws[2] ? 0.5 * sst(0.5, 1, t) : 0;
      if (wp) acc.w[bone(p.ws[0])] += e * wp; if (wn) acc.w[bone(p.ws[2])] += e * wn; acc.w[bone(p.ws[1])] += e * (1 - wp - wn);
    }
    const r = p.reg === 'F' ? (x >= 0 ? 2 : 3) : p.reg === 'H' ? (x >= 0 ? 4 : 5) : p.reg; acc.reg[r] += e;
    fur += e * p.fur; const sx = p.sym && x < 0 ? -1 : 1; cx += e * p.comb[0] * sx; cy += e * p.comb[1]; cz += e * p.comb[2]; tot += e;
  }
  acc.fur = fur / tot; acc.cx = cx / tot; acc.cy = cy / tot; acc.cz = cz / tot;
}

// ---------------------------------------------------------------- ears (thin cups: own parametric geometry)
function buildEar(side, out) {
  const base = [0.0225 * side, 0.297, 0.184], U = new THREE.Vector3(0.30 * side, 1, 0.03).normalize();
  const F = new THREE.Vector3(0.45 * side, 0, 1).normalize(); F.addScaledVector(U, -F.dot(U)).normalize();
  const S = new THREE.Vector3().crossVectors(U, F).normalize();
  const H = 0.052, R0 = 0.0272, NH = 10, NP = 14, PM = 1.9, v0 = out.P.length / 3;
  const rows = [];
  for (const layer of [0, 1]) for (let ih = 0; ih <= NH; ih++) for (let ip = 0; ip <= NP; ip++) {
    const hn = ih / NH, ps = -PM + 2 * PM * ip / NP, rad = R0 * Math.pow(1 - hn, 0.8) * (1 - 0.12 * Math.sin(Math.PI * hn)) + 0.0011;
    const th = layer ? Math.max(0.0008, 0.0026 * (1 - hn) + 0.0009) : 0;
    const d = new THREE.Vector3().addScaledVector(F, -Math.cos(ps) * 0.55).addScaledVector(S, Math.sin(ps));
    const p = new THREE.Vector3(...base).addScaledVector(U, H * hn - (1 - hn) * 0.004).addScaledVector(d, rad - th).addScaledVector(F, layer ? 0.0012 : 0);
    const nn = d.clone().addScaledVector(U, R0 / H * 0.8).normalize().multiplyScalar(layer ? -1 : 1);
    out.P.push(p.x, p.y, p.z); out.N.push(nn.x, nn.y, nn.z);
    const w = sst(0.0, 0.35, hn); out.skin.push([[BI[side > 0 ? 'earL' : 'earR'], w], [BI.head, 1 - w]]);
    out.reg.push(side > 0 ? (layer ? 8 : 7) : (layer ? 10 : 9)); out.fur.push(layer ? 0.75 : 0.35);
    const c = layer ? F.clone().multiplyScalar(0.6).add(U) : U; out.comb.push(c.x, c.y, c.z); rows.push(hn);
  }
  const at = (l, ih, ip) => v0 + l * (NH + 1) * (NP + 1) + ih * (NP + 1) + ip;
  for (let ih = 0; ih < NH; ih++) for (let ip = 0; ip < NP; ip++) {
    const a = at(0, ih, ip), b = at(0, ih, ip + 1), c = at(0, ih + 1, ip + 1), d = at(0, ih + 1, ip);
    out.T.push(a, c, b, a, d, c);
    const A = at(1, ih, ip), B = at(1, ih, ip + 1), Cc = at(1, ih + 1, ip + 1), D = at(1, ih + 1, ip);
    out.T.push(A, B, Cc, A, Cc, D);
  }
  for (let ih = 0; ih < NH; ih++) for (const ip of [0, NP]) {   // rims join the two layers
    const a = at(0, ih, ip), b = at(0, ih + 1, ip), c = at(1, ih + 1, ip), d = at(1, ih, ip);
    if (ip === 0) out.T.push(a, c, b, a, d, c); else out.T.push(a, b, c, a, c, d);
  }
  return v0;
}

// ---------------------------------------------------------------- tabby pattern (rest-pose space, sRGB 0..255; alpha = fur height)
const COL = {
  dark: [30, 20, 12], ground: [164, 131, 92], grey: [126, 108, 86], light: [208, 178, 138], white: [234, 222, 202], ginger: [188, 130, 72],
  nose: [150, 88, 66], noseRim: [62, 40, 33], pad: [60, 44, 42], earIn: [212, 172, 154], eyeRing: [196, 172, 136], paw: [204, 172, 128],
};
const PC = new Float64Array(3);
const paint = (c, t) => { if (t <= 0) return; PC[0] += (c[0] - PC[0]) * t; PC[1] += (c[1] - PC[1]) * t; PC[2] += (c[2] - PC[2]) * t; };
function segDist(px, py, pz, L) {
  let best = 1e9;
  for (let i = 0; i < L.length - 1; i++) {
    const a = L[i], b = L[i + 1], bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
    const t = clamp(((px - a[0]) * bx + (py - a[1]) * by + (pz - a[2]) * bz) / (bx * bx + by * by + bz * bz), 0, 1);
    best = Math.min(best, Math.hypot(px - a[0] - bx * t, py - a[1] - by * t, pz - a[2] - bz * t));
  }
  return best;
}
const CHEEK1 = [[0.0262, 0.2858, 0.2228], [0.0325, 0.2850, 0.2125], [0.0375, 0.2822, 0.1990], [0.0392, 0.2765, 0.1870]];
const CHEEK2 = [[0.0232, 0.2768, 0.2238], [0.0305, 0.2728, 0.2142], [0.0362, 0.2680, 0.2035], [0.0372, 0.2610, 0.1935]];
const EYE_C = [0.0178, 0.2852, 0.2222], EYE_R = 0.0092;
function catPattern(x, y, z, nx, ny, nz, reg, out) {
  const ax = Math.abs(x), sx = x >= 0 ? 1 : -1;
  const n1 = fbm(x * 70, y * 70, z * 70), grain = vnoise(x * 900 + 3.1, y * 900, z * 900);
  PC[0] = mix(COL.grey[0], COL.ground[0], n1); PC[1] = mix(COL.grey[1], COL.ground[1], n1); PC[2] = mix(COL.grey[2], COL.ground[2], n1);
  let dark = 0, fur = 1, grainK = 1;
  if (reg === 0) {
    const yc = 0.19 + Math.max(0, z - 0.085) * 0.75, th = Math.abs(Math.atan2(x, y - yc));
    paint(COL.light, sst(1.55, 2.55, th) * 0.85);
    paint(COL.ginger, sst(1.9, 2.8, th) * sst(0.04, -0.06, z) * 0.6);
    paint(COL.ginger, sst(-0.07, -0.15, z) * sst(0.6, 1.6, th) * 0.5);
    paint(COL.light, sst(0.06, 0.11, z) * sst(1.5, 2.3, th) * 0.6);
    const wob = (fbm(x * 40 + 7, y * 40, z * 40) - 0.5) * 0.032 + (vnoise(x * 130, y * 130 + 2, z * 130) - 0.5) * 0.006;
    const q = (z + 0.018 * Math.sin(th * 1.7) + wob) / 0.019, dq = Math.abs(q - Math.round(q));
    const st = (1 - sst(0.12, 0.22, dq + th * 0.03)) * (1 - sst(1.9, 2.4, th)) * sst(0.2, 0.34, vnoise(x * 85 + 11, y * 85, z * 85)) * (1 - sst(0.09, 0.115, z));
    const dl = (1 - sst(0.12, 0.2, th + (n1 - 0.5) * 0.1)) * sst(-0.2, -0.17, z) * (1 - sst(0.10, 0.125, z));
    let nl = 0; if (z > 0.08) { const d0 = Math.min(th, Math.abs(th - 0.3), Math.abs(th - 0.6)); nl = (1 - sst(0.05, 0.085, d0)) * sst(0.09, 0.115, z) * (1 - sst(0.75, 0.95, th)); }
    let nk = 0; if (z > 0.08 && th > 1.2) { const rc = 0.57 * (y - 0.205) + 0.82 * (z - 0.095) + (n1 - 0.5) * 0.006, dn = Math.min(Math.abs(rc + 0.008), Math.abs(rc - 0.006), Math.abs(rc - 0.02)); nk = (1 - sst(0.0016, 0.003, dn)) * sst(1.3, 1.9, th) * sst(0.25, 0.45, vnoise(x * 120, y * 120 + 4, z * 120)); }
    dark = Math.max(st, dl, nl, nk); fur = 1;
  } else if (reg === 1) {
    paint(COL.light, sst(0.276, 0.256, y) * 0.45 + sst(0.012, 0.03, ax) * 0.15);
    const padN = Math.hypot((ax - 0.0095) / 0.0115, (y - 0.2585) / 0.0095, (z - 0.2375) / 0.0105), chinN = Math.hypot(x / 0.0095, (y - 0.2485) / 0.0075, (z - 0.229) / 0.0115);
    const muz = Math.max(1 - sst(0.85, 1.35, padN), 1 - sst(0.85, 1.4, chinN), sst(0.257, 0.247, y) * sst(0.185, 0.205, z));
    paint(COL.light, muz * 0.85); paint(COL.white, muz * (0.25 + 0.7 * sst(0.256, 0.249, y))); fur = mix(0.55, 0.42, muz);
    paint(COL.ginger, (1 - sst(0.005, 0.009, ax)) * sst(0.274, 0.28, y) * (1 - sst(0.293, 0.3, y)) * sst(0.228, 0.236, z) * 0.25);
    const de = Math.hypot(ax - EYE_C[0], y - EYE_C[1], z - EYE_C[2]) - EYE_R;
    paint(COL.eyeRing, (1 - sst(0.0025, 0.0052, de)) * 0.85); fur *= mix(0.25, 1, sst(0.001, 0.0045, de));
    dark = 1 - sst(0.0011, 0.0021, de);
    if (y > 0.289 && z < 0.242) {
      const xo = 0.0122 + 0.0055 * sst(0.2995, 0.2925, y), xm = 0.0079 + 0.002 * sst(0.2995, 0.2925, y), xi = 0.0036 - 0.0024 * sst(0.302, 0.2935, y), dl = Math.min(Math.abs(ax - xo), Math.abs(ax - xi), Math.abs(ax - xm) + 0.0003);
      let fl = (1 - sst(0.0008, 0.0015, dl)) * sst(0.2915, 0.2945, y) * sst(0.14, 0.16, z);
      fl = Math.max(fl, (1 - sst(0.0009, 0.0016, ax)) * sst(0.305, 0.31, y) * (1 - sst(0.215, 0.225, z)));
      dark = Math.max(dark, fl * sst(0.2, 0.35, vnoise(x * 300, y * 300, z * 300 + 7)));
    }
    dark = Math.max(dark, (1 - sst(0.0012, 0.0021, segDist(ax, y, z, CHEEK1))) * 0.95, (1 - sst(0.0011, 0.0019, segDist(ax, y, z, CHEEK2))) * 0.85);
    if (z > 0.236 && y < 0.2645) for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) if (Math.hypot(ax - (0.0065 + c * 0.0034 + r * 0.0008), y - (0.2622 - r * 0.0029)) < 0.00062) dark = Math.max(dark, 0.75);
    if (z > 0.222 && ax < 0.017) { const yl = 0.2512 + 9 * ax * ax; dark = Math.max(dark, (1 - sst(0.0005, 0.0009, Math.abs(y - yl))) * sst(0.017, 0.012, ax)); }
    if (z > 0.245 && ax < 0.0008 && y > 0.252 && y < 0.271) dark = Math.max(dark, 0.8);
    if (z > 0.2468 && nz > 0.25 && y > 0.2695 && y < 0.2805) {
      const hw = 0.0016 + 0.0046 * clamp((y - 0.2695) / 0.011, 0, 1);
      if (ax < hw + 0.0007) { const rim = ax > hw - 0.0005 || y < 0.2702 || y > 0.2798; PC[0] = (rim ? COL.noseRim : COL.nose)[0]; PC[1] = (rim ? COL.noseRim : COL.nose)[1]; PC[2] = (rim ? COL.noseRim : COL.nose)[2]; dark = 0; fur = 0; grainK = 0.3; }
    }
    paint(COL.dark, sst(0.302, 0.315, y) * sst(0.012, 0.02, ax) * 0.25);
  } else if (reg === 2 || reg === 3) {
    paint(COL.light, 0.15 + 0.3 * sst(0.11, 0.035, y) + 0.25 * sst(0.2, 0.8, nz));
    paint(COL.light, sst(0.0, 0.6, -nx * sx) * 0.3);
    const qb = (y + (fbm(x * 60, y * 60, z * 60) - 0.5) * 0.006) / 0.0165, db = Math.abs(qb - Math.round(qb));
    const front = sst(-0.6, 0.1, nz + 0.5 * sx * nx);
    dark = (1 - sst(0.1, 0.2, db)) * sst(0.035, 0.05, y) * (1 - sst(0.15, 0.172, y)) * mix(0.3, 0.85, front);
    paint(COL.paw, sst(0.036, 0.02, y) * 0.75);
    fur = mix(0.45, 0.75, sst(0.03, 0.12, y));
    if (ny < -0.5 && y < 0.007) { PC[0] = COL.pad[0]; PC[1] = COL.pad[1]; PC[2] = COL.pad[2]; dark = 0; fur = 0; }
  } else if (reg === 4 || reg === 5) {
    const outer = sst(-0.2, 0.6, nx * sx);
    const wob = (fbm(x * 40 + 7, y * 40, z * 40) - 0.5) * 0.02, q = (z * 0.85 - (y - 0.15) * 0.55 + wob) / 0.02, dq = Math.abs(q - Math.round(q));
    const ts = (1 - sst(0.14, 0.24, dq)) * sst(0.1, 0.125, y) * mix(0.45, 1, outer) * sst(0.25, 0.4, vnoise(x * 85, y * 85 + 3, z * 85));
    const qb = y / 0.016, db = Math.abs(qb - Math.round(qb)), sb = (1 - sst(0.15, 0.25, db)) * sst(0.07, 0.08, y) * (1 - sst(0.11, 0.125, y)) * mix(0.4, 1, outer);
    paint(COL.ginger, sst(0.1, -0.6, nz) * sst(0.06, 0.12, y) * 0.5);
    const boot = sst(-0.1, -0.5, nz) * (1 - sst(0.065, 0.082, y)) * sst(0.012, 0.022, y);
    paint(COL.light, (1 - sst(0.03, 0.07, y)) * 0.5 * (1 - boot));
    paint(COL.paw, sst(0.032, 0.018, y) * 0.7 * (1 - boot));
    dark = Math.max(ts, sb, boot * 0.92); fur = mix(0.45, 1.0, sst(0.03, 0.12, y));
    if (ny < -0.5 && y < 0.007) { PC[0] = COL.pad[0]; PC[1] = COL.pad[1]; PC[2] = COL.pad[2]; dark = 0; fur = 0; }
  } else if (reg === 6) {
    const uy = -0.024 / 0.281, uz = -0.279 / 0.281, t = (y - 0.226) * uy + (z + 0.188) * uz, under = sst(-0.2, -0.7, ny);
    paint(COL.light, under * 0.35);
    const ph = t / 0.031 + t * t * 9, dq = Math.abs(ph - Math.round(ph));
    const ring = (1 - sst(0.17, 0.27, dq)) * sst(0.02, 0.045, t) * mix(1, 0.55, under);
    const dor = (1 - sst(0.25, 0.4, Math.abs(Math.atan2(x, y - (0.226 + uy * t))))) * (1 - sst(0.03, 0.06, t));
    dark = Math.max(ring, dor, sst(0.236, 0.25, t)); fur = 1;
  } else if (reg === 7 || reg === 9) {
    paint(COL.dark, 0.3 + 0.4 * sst(0.322, 0.342, y)); fur = 0;
  } else if (reg === 8 || reg === 10) {
    paint(COL.earIn, 0.85);
    const tuft = sst(0.336, 0.304, y) * sst(0.35, 0.65, vnoise(x * 1500, y * 500, z * 1500));
    paint(COL.white, tuft * 0.6); fur = 0.8 * tuft * sst(0.0, 0.3, vnoise(x * 400, y * 400, z * 400)); grainK = 0.4;
  } else { PC[0] = COL.white[0]; PC[1] = COL.white[1]; PC[2] = COL.white[2]; fur = 0; grainK = 0; }
  paint(COL.dark, dark * 0.93);
  const gk = 1 + (grain - 0.5) * 0.22 * grainK;
  out[0] = clamp(PC[0] * gk, 0, 255); out[1] = clamp(PC[1] * gk, 0, 255); out[2] = clamp(PC[2] * gk, 0, 255); out[3] = clamp(fur, 0, 1) * 255;
}

// ---------------------------------------------------------------- UV atlas: box-projected charts per region, baked from the 3-D pattern
const REG_DENSITY = [1, 1.9, 0.9, 0.9, 0.9, 0.9, 0.85, 1.4, 1.4, 1.4, 1.4];
function bakeAtlas(M, W) {
  const { P, N, T, reg } = M, nt = T.length / 3;
  const treg = new Uint8Array(nt), tdir = new Uint8Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = T[3 * t], b = T[3 * t + 1], c = T[3 * t + 2];
    const nx = N[3 * a] + N[3 * b] + N[3 * c], ny = N[3 * a + 1] + N[3 * b + 1] + N[3 * c + 1], nz = N[3 * a + 2] + N[3 * b + 2] + N[3 * c + 2];
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    tdir[t] = ax >= ay && ax >= az ? (nx > 0 ? 0 : 1) : ay >= az ? (ny > 0 ? 2 : 3) : (nz > 0 ? 4 : 5);
    treg[t] = reg[a] === reg[b] || reg[a] === reg[c] ? reg[a] : reg[b];
  }
  const par = new Int32Array(nt); for (let i = 0; i < nt; i++) par[i] = i;
  const find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  const first = new Map();
  for (let t = 0; t < nt; t++) { const g = treg[t] * 6 + tdir[t]; for (let c = 0; c < 3; c++) { const key = T[3 * t + c] * 128 + g, f = first.get(key); if (f === undefined) first.set(key, t); else { const ra = find(t), rb = find(f); if (ra !== rb) par[ra] = rb; } } }
  const chartOf = new Int32Array(nt), roots = new Map(), charts = [];
  for (let t = 0; t < nt; t++) { const r = find(t); let c = roots.get(r); if (c === undefined) { c = charts.length; roots.set(r, c); charts.push({ dir: tdir[t], reg: treg[t], u0: 1e9, u1: -1e9, v0: 1e9, v1: -1e9 }); } chartOf[t] = c; }
  const proj = (dir, i) => (dir < 2 ? [P[3 * i + 2], P[3 * i + 1]] : dir < 4 ? [P[3 * i], P[3 * i + 2]] : [P[3 * i], P[3 * i + 1]]);
  for (let t = 0; t < nt; t++) { const ch = charts[chartOf[t]]; for (let c = 0; c < 3; c++) { const [u, v] = proj(ch.dir, T[3 * t + c]); ch.u0 = Math.min(ch.u0, u); ch.u1 = Math.max(ch.u1, u); ch.v0 = Math.min(ch.v0, v); ch.v1 = Math.max(ch.v1, v); } }
  const pad = 3, white = { white: true, u0: 0, u1: 0, v0: 0, v1: 0, reg: 0 }; charts.push(white);
  let area = 0; for (const ch of charts) area += (ch.u1 - ch.u0) * (ch.v1 - ch.v0) * (REG_DENSITY[ch.reg] ?? 1) ** 2;
  let D = Math.sqrt(0.6 * W * W / area), packed = false;
  for (let tries = 0; tries < 30 && !packed; tries++, D *= 0.95) {
    for (const ch of charts) { const s = D * (REG_DENSITY[ch.reg] ?? 1); ch.s = s; ch.w = ch.white ? 6 : Math.ceil((ch.u1 - ch.u0) * s) + 2 * pad; ch.h = ch.white ? 6 : Math.ceil((ch.v1 - ch.v0) * s) + 2 * pad; }
    const order = charts.slice().sort((a, b) => b.h - a.h); let x = 0, y = 0, rowH = 0; packed = true;
    for (const ch of order) { if (x + ch.w > W) { x = 0; y += rowH; rowH = 0; } if (y + ch.h > W) { packed = false; break; } ch.x = x; ch.y = y; x += ch.w; rowH = Math.max(rowH, ch.h); }
  }
  // split vertices per chart
  const remap = new Map(), src = [], uv = [], NT = new Uint32Array(T.length);
  for (let t = 0; t < nt; t++) {
    const ci = chartOf[t], ch = charts[ci];
    for (let c = 0; c < 3; c++) {
      const v = T[3 * t + c], key = v * charts.length + ci; let n = remap.get(key);
      if (n === undefined) { n = src.length; remap.set(key, n); src.push(v); const [u, w] = proj(ch.dir, v); uv.push((ch.x + pad + (u - ch.u0) * ch.s) / W, (ch.y + pad + (w - ch.v0) * ch.s) / W); }
      NT[3 * t + c] = n;
    }
  }
  // rasterise every triangle in texel space, evaluating the pattern at the interpolated rest position
  const data = new Uint8Array(W * W * 4), mask = new Uint8Array(W * W), o = new Float64Array(4);
  for (let t = 0; t < nt; t++) {
    const ia = NT[3 * t], ib = NT[3 * t + 1], ic = NT[3 * t + 2], A = src[ia], B = src[ib], Cv = src[ic], rg = treg[t];
    const ax = uv[2 * ia] * W, ay = uv[2 * ia + 1] * W, bx = uv[2 * ib] * W, by = uv[2 * ib + 1] * W, cx = uv[2 * ic] * W, cy = uv[2 * ic + 1] * W;
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(den) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 1)), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx) + 1)), y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - 1)), y1 = Math.min(W - 1, Math.ceil(Math.max(ay, by, cy) + 1));
    for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
      const qx = px + 0.5, qy = py + 0.5;
      let w0 = ((by - cy) * (qx - cx) + (cx - bx) * (qy - cy)) / den, w1 = ((cy - ay) * (qx - cx) + (ax - cx) * (qy - cy)) / den, w2 = 1 - w0 - w1;
      if (w0 < -0.06 || w1 < -0.06 || w2 < -0.06) continue;
      const k = py * W + px; if (mask[k] === 2) continue;
      const inside = w0 >= 0 && w1 >= 0 && w2 >= 0;
      if (!inside && mask[k]) continue;
      w0 = clamp(w0, 0, 1); w1 = clamp(w1, 0, 1); w2 = clamp(w2, 0, 1); const ws = w0 + w1 + w2; w0 /= ws; w1 /= ws; w2 /= ws;
      const X = P[3 * A] * w0 + P[3 * B] * w1 + P[3 * Cv] * w2, Y = P[3 * A + 1] * w0 + P[3 * B + 1] * w1 + P[3 * Cv + 1] * w2, Z = P[3 * A + 2] * w0 + P[3 * B + 2] * w1 + P[3 * Cv + 2] * w2;
      const nX = N[3 * A] * w0 + N[3 * B] * w1 + N[3 * Cv] * w2, nY = N[3 * A + 1] * w0 + N[3 * B + 1] * w1 + N[3 * Cv + 1] * w2, nZ = N[3 * A + 2] * w0 + N[3 * B + 2] * w1 + N[3 * Cv + 2] * w2, nl = Math.hypot(nX, nY, nZ) || 1;
      catPattern(X, Y, Z, nX / nl, nY / nl, nZ / nl, rg, o);
      data[4 * k] = o[0]; data[4 * k + 1] = o[1]; data[4 * k + 2] = o[2]; data[4 * k + 3] = o[3]; mask[k] = inside ? 2 : 1;
    }
  }
  for (let py = white.y; py < white.y + 6; py++) for (let px = white.x; px < white.x + 6; px++) { const k = py * W + px; data.set([238, 232, 222, 0], 4 * k); mask[k] = 2; }
  dilate(data, mask, W, 6);
  return { data, src, uv: new Float32Array(uv), T: NT, whiteUV: [(white.x + 3) / W, (white.y + 3) / W], D };
}
function dilate(data, mask, W, passes) {
  const nm = new Uint8Array(mask.length);
  for (let it = 0; it < passes; it++) {
    nm.set(mask);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const k = y * W + x; if (mask[k]) continue;
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= W) continue; const q = yy * W + xx; if (!mask[q]) continue;
        r += data[4 * q]; g += data[4 * q + 1]; b += data[4 * q + 2]; a += data[4 * q + 3]; n++;
      }
      if (n) { data[4 * k] = r / n; data[4 * k + 1] = g / n; data[4 * k + 2] = b / n; data[4 * k + 3] = a / n; nm[k] = 1; }
    }
    mask.set(nm);
  }
}

// ---------------------------------------------------------------- eyes (glossy, yellow-green iris, vertical slit pupil)
function irisTexture() {
  // Front view of the eyeball. Outside an almond (outer corner up) the "lid" is fur-coloured, matte and without clearcoat.
  const S = 128, d = new Uint8Array(S * S * 4), m = new Uint8Array(S * S * 4);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const x = (i + 0.5) / S * 2 - 1, y = (j + 0.5) / S * 2 - 1, r = Math.hypot(x, y), a = Math.atan2(y, x);
    const fib = 0.5 + 0.5 * Math.sin(a * 37 + Math.sin(a * 11) * 2) * (0.6 + 0.4 * vnoise(a * 8, r * 6, 1.7));
    let c = [mix(186, 120, sst(0.1, 0.9, r)), mix(180, 136, sst(0.1, 0.9, r)), mix(112, 82, sst(0.1, 0.9, r))];
    const k = 0.84 + 0.28 * fib; c = c.map(v => v * k);
    c = c.map((v, n) => mix(v, [62, 60, 34][n], sst(0.7, 0.93, r)));
    if (Math.abs(x) < 0.085 * Math.sqrt(Math.max(0, 1 - (y / 0.6) ** 2)) + 0.012) c = [8, 7, 6];
    const yc = y - 0.14 * x, hw = 0.6 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(x + 0.04) / 0.98, 2.2)), 0.75), lid = Math.abs(yc) - hw;
    if (lid > 0.075) c = [150, 118, 82]; else if (lid > -0.005) c = [28, 20, 14];
    d.set([clamp(c[0], 0, 255), clamp(c[1], 0, 255), clamp(c[2], 0, 255), 255], 4 * (j * S + i));
    const eye = lid > -0.005 ? 0 : 1; m.set([eye * 255, eye ? 50 : 235, 0, 255], 4 * (j * S + i));
  }
  const tex = (data, srgb) => { const t = new THREE.DataTexture(data, S, S); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t; };
  return { map: tex(d, true), mask: tex(m, false) };
}
function buildEyes() {
  const pos = [], nrm = [], uv = [], idx = [], NI = 14, NJ = 24;
  for (const side of [1, -1]) {
    const c = new THREE.Vector3(EYE_C[0] * side, EYE_C[1], EYE_C[2]), f = new THREE.Vector3(0.2 * side, -0.03, 1).normalize();
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(f, -f.y).normalize(), rt = new THREE.Vector3().crossVectors(up, f), v0 = pos.length / 3;
    for (let i = 0; i <= NI; i++) for (let j = 0; j <= NJ; j++) {
      const th = Math.PI * i / NI, ph = TAU * j / NJ, sx = Math.sin(th) * Math.cos(ph), sy = Math.sin(th) * Math.sin(ph), sz = Math.cos(th);
      const n = new THREE.Vector3().addScaledVector(rt, sx).addScaledVector(up, sy).addScaledVector(f, sz);
      pos.push(c.x + n.x * EYE_R, c.y + n.y * EYE_R, c.z + n.z * EYE_R); nrm.push(n.x, n.y, n.z); uv.push(0.5 + 0.5 * sx * side, 0.5 + 0.5 * sy);
    }
    for (let i = 0; i < NI; i++) for (let j = 0; j < NJ; j++) { const a = v0 + i * (NJ + 1) + j, b = a + 1, cc = a + NJ + 1, d = cc + 1; idx.push(a, cc, b, b, cc, d); }
  }
  const g = new THREE.BufferGeometry(), n = pos.length / 3;
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('skinIndex', new THREE.Uint8BufferAttribute(new Uint8Array(n * 4).map((_, i) => (i % 4 === 0 ? BI.head : 0)), 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------------- whiskers (crossed tapered ribbons, white, no fur)
function buildWhiskers(out, whiteUV) {
  const rnd = mulberry(77), up = new THREE.Vector3(0, 1, 0);
  const add = (root, dir, L, droop, w0) => {
    const pts = []; for (let k = 0; k <= 5; k++) { const t = k / 5; pts.push(new THREE.Vector3(...root).addScaledVector(dir, L * t).add(new THREE.Vector3(0, -droop * t * t, -0.35 * droop * t * t))); }
    const s1 = new THREE.Vector3().crossVectors(dir, up).normalize(), s2 = new THREE.Vector3().crossVectors(dir, s1).normalize();
    for (const s of [s1, s2]) {
      const v0 = out.P.length / 3;
      for (let k = 0; k <= 5; k++) { const w = w0 * (1 - k / 5) + 0.00012; for (const sg of [-1, 1]) { const p = pts[k].clone().addScaledVector(s, sg * w); out.P.push(p.x, p.y, p.z); out.N.push(0, 0.8, 0.6); out.uv.push(whiteUV[0], whiteUV[1]); } }
      for (let k = 0; k < 5; k++) { const a = v0 + 2 * k; out.T.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    }
  };
  for (const side of [1, -1]) {
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
      const x = 0.0055 + c * 0.0036 + r * 0.0006, y = 0.2622 - r * 0.0026, zz = 0.2375 + 0.0105 * Math.sqrt(Math.max(0, 1 - ((x - 0.0095) / 0.0115) ** 2 - ((y - 0.2585) / 0.0095) ** 2)) - 0.0008;
      const dir = new THREE.Vector3(side * 1.0, 0.22 - r * 0.16 + (rnd() - 0.5) * 0.08, 0.5 - c * 0.18 + (rnd() - 0.5) * 0.1).normalize();
      add([x * side, y, zz], dir, 0.042 + 0.016 * rnd() - c * 0.004, 0.006 + r * 0.003, 0.00026);
    }
    for (let k = 0; k < 2; k++) add([0.0125 * side, 0.2985 + k * 0.002, 0.226 - k * 0.002], new THREE.Vector3(side * 0.55, 1, 0.45 - k * 0.2).normalize(), 0.028 + k * 0.005, 0.002, 0.0002);
    add([0.036 * side, 0.272, 0.205], new THREE.Vector3(side, 0.35, -0.2).normalize(), 0.026, 0.003, 0.0002);
  }
}

// ---------------------------------------------------------------- fur material (shells are instances of the same skinned geometry)
function furMaterial(map, uStrand) {
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.9, metalness: 0 });
  m.userData.uniforms = { uFurLen: { value: 0.0068 }, uStrand: { value: uStrand }, uBase: { value: 0.55 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, m.userData.uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aShell; attribute float aFur; attribute vec3 aComb; uniform float uFurLen; varying float vShell; varying float vWhisk;')
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>
        vShell = aShell; vWhisk = aFur < 0.0 ? 1.0 : 0.0;
        { vec3 cb = aComb;
          #ifdef USE_SKINNING
          cb = (skinMatrix * vec4(aComb, 0.0)).xyz;
          #endif
          float hh = aShell * max(aFur, 0.0) * uFurLen;
          transformed += normalize(objectNormal) * hh + cb * hh * 0.85 * aShell;
          transformed.y -= hh * aShell * 0.3; }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        uniform float uStrand; uniform float uBase; varying float vShell; varying float vWhisk;
        float furHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }`)
      .replace('#include <map_fragment>', `
        vec4 furTex = texture2D(map, vMapUv);
        diffuseColor.rgb *= furTex.rgb;
        if (vShell > 0.001) {
          if (vWhisk > 0.5) discard;
          vec2 sc = vMapUv * uStrand, cell = floor(sc), f = fract(sc) - 0.5;
          float r1 = furHash(cell), r2 = furHash(cell + 19.19), r3 = furHash(cell + 47.31);
          float hgt = furTex.a * (0.5 + 0.5 * r1);
          float rad = length(f - (vec2(r2, r3) - 0.5) * 0.45);
          if (vShell > hgt || rad > 0.62 * (1.0 - vShell / max(hgt, 0.001))) discard;
          diffuseColor.rgb *= mix(0.62, 1.08, vShell) * mix(0.84, 1.14, r1);
        } else if (vWhisk < 0.5) {
          diffuseColor.rgb *= mix(1.0, uBase, furTex.a);
        }`);
  };
  m.customProgramCacheKey = () => 'croton-cat-fur-1';
  return m;
}
function blobTexture() {
  const S = 64, d = new Uint8Array(S * S * 4);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const x = (i + 0.5) / S * 2 - 1, y = (j + 0.5) / S * 2 - 1, r = Math.min(1, Math.hypot(x, y)), a = (1 - r * r) ** 2 * (1 - 0.35 * r); d.set([255, 255, 255, a * 255], 4 * (j * S + i)); }
  const t = new THREE.DataTexture(d, S, S); t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
}

// ---------------------------------------------------------------- build
function buildCat(opts = {}) {
  const t0 = (globalThis.performance ?? Date).now();
  const prims = buildPrims();
  const { P, N, T } = polygonize(prims, opts.cell ?? 0.0042);
  const nv = P.length / 3;
  const M = { P: Array.from(P), N: Array.from(N), T: Array.from(T), skin: [], reg: [], fur: [], comb: [] };
  const acc = { ds: new Float64Array(prims.length), w: new Float64Array(NB), reg: new Float64Array(12) };
  for (let q = 0; q < nv; q++) {
    skinVertex(prims, P[3 * q], P[3 * q + 1], P[3 * q + 2], acc);
    const ws = []; for (let b = 0; b < NB; b++) if (acc.w[b] > 0) ws.push([b, acc.w[b]]);
    ws.sort((a, b) => b[1] - a[1]); M.skin.push(ws.slice(0, 4));
    let r = 0; for (let k = 1; k < 12; k++) if (acc.reg[k] > acc.reg[r]) r = k; M.reg.push(r);
    M.fur.push(acc.fur); M.comb.push(acc.cx, acc.cy, acc.cz);
  }
  const t1 = (globalThis.performance ?? Date).now();
  for (const side of [1, -1]) {   // ears with smooth per-ear normals
    const v0 = buildEar(side, M), t0e = M.T.length;
    const n = new Float64Array(M.P.length - v0 * 3);
    for (let t = 0; t < M.T.length; t += 3) {
      const a = M.T[t], b = M.T[t + 1], c = M.T[t + 2]; if (a < v0) continue;
      const ux = M.P[3 * b] - M.P[3 * a], uy = M.P[3 * b + 1] - M.P[3 * a + 1], uz = M.P[3 * b + 2] - M.P[3 * a + 2], wx = M.P[3 * c] - M.P[3 * a], wy = M.P[3 * c + 1] - M.P[3 * a + 1], wz = M.P[3 * c + 2] - M.P[3 * a + 2];
      const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
      for (const v of [a, b, c]) { n[3 * (v - v0)] += fx; n[3 * (v - v0) + 1] += fy; n[3 * (v - v0) + 2] += fz; }
    }
    for (let v = v0; v < M.P.length / 3; v++) { const k = 3 * (v - v0), l = Math.hypot(n[k], n[k + 1], n[k + 2]) || 1; M.N[3 * v] = n[k] / l; M.N[3 * v + 1] = n[k + 1] / l; M.N[3 * v + 2] = n[k + 2] / l; }
    void t0e;
  }
  const W = opts.atlas ?? 1024;
  const A = bakeAtlas({ P: M.P, N: M.N, T: M.T, reg: M.reg }, W);
  const t2 = (globalThis.performance ?? Date).now();
  // assemble the base vertex arrays (split by chart), then whiskers
  const src = A.src, nb = src.length;
  const out = { P: [], N: [], uv: Array.from(A.uv), T: Array.from(A.T) };
  const skinI = [], skinW = [], aFur = [], aComb = [];
  const comb = new THREE.Vector3(), nrm = new THREE.Vector3();
  for (let i = 0; i < nb; i++) {
    const v = src[i]; out.P.push(M.P[3 * v], M.P[3 * v + 1], M.P[3 * v + 2]); out.N.push(M.N[3 * v], M.N[3 * v + 1], M.N[3 * v + 2]);
    const ws = M.skin[v], tot = ws.reduce((s, w) => s + w[1], 0);
    for (let k = 0; k < 4; k++) { skinI.push(ws[k] ? ws[k][0] : 0); skinW.push(ws[k] ? ws[k][1] / tot : 0); }
    aFur.push(M.fur[v]);
    nrm.set(M.N[3 * v], M.N[3 * v + 1], M.N[3 * v + 2]); comb.set(M.comb[3 * v], M.comb[3 * v + 1], M.comb[3 * v + 2]); comb.addScaledVector(nrm, -comb.dot(nrm));
    if (comb.lengthSq() < 1e-8) comb.set(0, 0, 0); else comb.normalize(); aComb.push(comb.x, comb.y, comb.z);
  }
  const baseTris = out.T.length;
  const exportGeo = new THREE.BufferGeometry();   // clean body (no shells / whiskers) for GLB export
  exportGeo.setAttribute('position', new THREE.Float32BufferAttribute(out.P.slice(), 3)); exportGeo.setAttribute('normal', new THREE.Float32BufferAttribute(out.N.slice(), 3));
  exportGeo.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv.slice(), 2)); exportGeo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinI.slice(), 4));
  exportGeo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinW.slice(), 4)); exportGeo.setIndex(out.T.slice(0, baseTris));
  buildWhiskers(out, A.whiteUV);
  for (let i = nb; i < out.P.length / 3; i++) { skinI.push(BI.head, 0, 0, 0); skinW.push(1, 0, 0, 0); aFur.push(-1); aComb.push(0, 0, 0); }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out.P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(out.N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2)); g.setAttribute('skinIndex', new THREE.Uint8BufferAttribute(skinI, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinW, 4)); g.setAttribute('aFur', new THREE.Float32BufferAttribute(aFur, 1));
  g.setAttribute('aComb', new THREE.Float32BufferAttribute(aComb, 3)); g.setIndex(out.T);
  const SHELLS = opts.shells ?? 12, shell = new Float32Array(SHELLS + 1); for (let k = 0; k <= SHELLS; k++) shell[k] = k / SHELLS;
  g.setAttribute('aShell', new THREE.InstancedBufferAttribute(shell, 1)); g.instanceCount = SHELLS + 1;
  const tex = new THREE.DataTexture(A.data, W, W); tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.anisotropy = 4; tex.needsUpdate = true;
  const uStrand = (W / A.D) / 0.00048;
  const stats = { verts: nb, tris: baseTris / 3, shells: SHELLS, msMesh: Math.round(t1 - t0), msAtlas: Math.round(t2 - t1), msTotal: Math.round((globalThis.performance ?? Date).now() - t0) };
  return { geometry: g, exportGeo, texture: tex, atlas: A, uStrand, shells: SHELLS, stats };
}

// ---------------------------------------------------------------- procedural rig: pose generators blended per bone (YXZ euler offsets)
const HY = NB * 3, HZ = NB * 3 + 1, BSX = NB * 3 + 2, BSZ = NB * 3 + 3, BOZ = NB * 3 + 4, NPOSE = NB * 3 + 5;
const I = BI;
const LEGS = [
  { front: true, side: 1, scap: I.scapL, a: I.upperL, b: I.foreL, c: I.pawL, ph: 0.27 }, { front: true, side: -1, scap: I.scapR, a: I.upperR, b: I.foreR, c: I.pawR, ph: 0.77 },
  { front: false, side: 1, a: I.thighL, b: I.shinL, c: I.footL, d: I.toeL, ph: 0.0 }, { front: false, side: -1, a: I.thighR, b: I.shinR, c: I.footR, d: I.toeR, ph: 0.5 },
];
const set = (P, i, x, y, z) => { P[3 * i] = x; P[3 * i + 1] = y; P[3 * i + 2] = z; };
const add = (P, i, x, y, z) => { P[3 * i] += x; P[3 * i + 1] += y; P[3 * i + 2] += z; };
const TAIL = [I.tail0, I.tail1, I.tail2, I.tail3, I.tail4, I.tail5];
const DUTY = 0.64;
// Resting poses (root frame). Tail curves: tail base, then one vertex per tail bone — lying on the ground round the right side.
const TUNE = {
  sit: { hy: -0.15, hz: 0.035, hips: -0.95, s1: 0.3, s2: 0.18, chest: 0.0, neck: -0.08, head: 0.56, scap: 0.05, fz: 0.085, bz: -0.03, abd: 0.18 },
  lie: { hy: -0.125, hz: 0, hips: -0.07, s1: 0.05, s2: 0.03, chest: 0.0, neck: -0.2, head: 0.24, fz: 0.128, bz: -0.022, abd: 0.28, curl: 2.1 },
  sitTail: [[0, 0.016, -0.144], [-0.02, 0.012, -0.185], [-0.06, 0.012, -0.175], [-0.088, 0.012, -0.14], [-0.098, 0.012, -0.095], [-0.092, 0.012, -0.05], [-0.075, 0.012, -0.007]],
  lieTail: [[0, 0.12, -0.19], [-0.01, 0.06, -0.22], [-0.04, 0.015, -0.25], [-0.08, 0.012, -0.235], [-0.1, 0.012, -0.195], [-0.105, 0.012, -0.15], [-0.1, 0.012, -0.105]],
};

class CatRig {
  constructor(bones, seed = 1) {
    this.bones = bones; this.rnd = mulberry(seed);
    this.pose = { stand: new Float32Array(NPOSE), sit: new Float32Array(NPOSE), lie: new Float32Array(NPOSE), jump: new Float32Array(NPOSE), pet: new Float32Array(NPOSE) };
    this.air = new Float32Array(NPOSE); this.out = new Float32Array(NPOSE);
    this.w = { stand: 1, sit: 0, lie: 0, jump: 0, pet: 0 };
    this.lid = 0; this.lidOut = 0; this.blink = { t: 9, next: 3, dur: 0.18 };
    this.wy = new Float32Array(NB); this.wz = new Float32Array(NB); this.wa = new Float32Array(NB);
    this.phase = 0; this.g = 0; this.time = 0; this.stride = 0.25;
    this.look = { yaw: 0, pitch: 0, tilt: 0, ty: 0, tp: 0, tt: 0, next: 1 };
    this.ear = { t: 0, next: 2, side: 0, dur: 0.25 };
    this.tailMood = 0; this.e = new THREE.Euler(0, 0, 0, 'YXZ'); this.v = new THREE.Vector3();
    this.rest = bones.map(b => b.position.clone());
  }
  snap(mode) { for (const k in this.w) this.w[k] = 0; this.w[mode === 'idle' || mode === 'walk' ? 'stand' : mode] = 1; }
  fk(P) {
    const wy = this.wy, wz = this.wz, wa = this.wa;
    for (let i = 0; i < NB; i++) {
      const p = PARENT[i];
      if (p < 0) { wy[i] = 0; wz[i] = 0; wa[i] = P[3 * i]; continue; }
      let oy = OFF[i][1], oz = OFF[i][2]; if (i === I.hips) { oy += P[HY]; oz += P[HZ]; }
      const a = wa[p], c = Math.cos(a), s = Math.sin(a);
      wy[i] = wy[p] + oy * c - oz * s; wz[i] = wz[p] + oy * s + oz * c; wa[i] = a + P[3 * i];
    }
  }
  ik2(P, iA, iB, iC, tz, ty, bend) {
    const wy = this.wy, wz = this.wz, wa = this.wa, aP = wa[PARENT[iA]], Az = wz[iA], Ay = wy[iA], L1 = SLEN[iB], L2 = SLEN[iC];
    const dz = tz - Az, dy = ty - Ay, d = clamp(Math.hypot(dz, dy), Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4);
    const al = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1)), ph1 = Math.atan2(dy, dz) + bend * al;
    const Ez = Az + L1 * Math.cos(ph1), Ey = Ay + L1 * Math.sin(ph1), ph2 = Math.atan2(ty - Ey, tz - Ez);
    const WA = SANG[iB] - ph1, WB = SANG[iC] - ph2;
    P[3 * iA] = WA - aP; P[3 * iB] = WB - WA;
    wa[iA] = WA; wa[iB] = WB; wz[iB] = Ez; wy[iB] = Ey; wz[iC] = Ez + L2 * Math.cos(ph2); wy[iC] = Ey + L2 * Math.sin(ph2);
  }
  seg(P, i, phi, rest) { const W = rest - phi; P[3 * i] = W - this.wa[PARENT[i]]; this.wa[i] = W; const c = this.wa; void c; }
  // Planted / swinging legs from paw targets in the root frame (z forward, y up). zo: fore-aft offset; lift; flex 0..1.
  frontLeg(P, L, tipZ, tipY, flex, curl = 0) {
    const phi3 = TIPANG.paw - flex * 1.5 - curl, wz = tipZ - TIPLEN.paw * Math.cos(phi3), wy = tipY - TIPLEN.paw * Math.sin(phi3);
    this.ik2(P, L.a, L.b, L.c, wz, wy, -1); this.seg(P, L.c, phi3, TIPANG.paw);
  }
  hindLeg(P, L, ballZ, ballY, metaPhi, toePhi) {
    const hz = ballZ - SLEN[L.d] * Math.cos(metaPhi), hy = ballY - SLEN[L.d] * Math.sin(metaPhi);
    this.ik2(P, L.a, L.b, L.c, hz, hy, 1); this.seg(P, L.c, metaPhi, SANG[L.d]); this.seg(P, L.d, toePhi, TIPANG.toe);
  }
  tail(P, pitch, sway, swayF, lag) {
    const t = this.time;
    for (let k = 0; k < 6; k++) set(P, TAIL[k], pitch[k], sway * (0.25 + 0.2 * k) * Math.sin(t * swayF * TAU - k * lag), 0);
  }
  ears(P, alert) {
    const e = this.ear, t = e.t < e.dur ? Math.sin(Math.PI * e.t / e.dur) : 0;
    for (const [i, s] of [[I.earL, 1], [I.earR, -1]]) {
      const tw = (e.side === 0 || e.side === s) ? t : 0;
      set(P, i, -0.08 + 0.12 * alert - 0.55 * tw, s * (0.15 - 0.3 * tw), s * (0.05 + 0.25 * tw));
    }
  }
  headLook(P, k) {
    const L = this.look; add(P, I.neck, L.pitch * 0.35 * k, L.yaw * 0.35 * k, 0); add(P, I.head, L.pitch * 0.65 * k, L.yaw * 0.65 * k, L.tilt * k);
  }
  genStand(P, s) {
    P.fill(0);
    const g = this.g, ph = this.phase, t = this.time, s1 = Math.sin(ph * TAU), c2 = Math.cos(ph * TAU * 2);
    P[HY] = -0.003 * g + 0.0022 * c2 * g;
    set(P, I.hips, 0.015 * g, 0.045 * s1 * g, 0.03 * s1 * g);
    const sc = Math.sin((ph - 0.27) * TAU);
    set(P, I.chest, 0, -0.05 * sc * g, -0.025 * sc * g);
    const br = Math.sin(t * TAU * 0.33) * (1 - 0.7 * g); add(P, I.spine2, 0.012 * br, 0, 0); add(P, I.chest, -0.01 * br, 0, 0);
    const tb = clamp(s.turn || 0, -2.5, 2.5);
    add(P, I.spine1, 0, tb * 0.05, 0); add(P, I.spine2, 0, tb * 0.06, 0); add(P, I.chest, 0, tb * 0.06, 0); add(P, I.neck, 0, tb * 0.08, 0); add(P, I.head, 0, tb * 0.1, -tb * 0.03);
    add(P, I.neck, 0.13 * g + 0.02, 0, 0); add(P, I.head, -0.08 * g + 0.025 * c2 * g, 0, 0);
    this.headLook(P, 1 - 0.65 * g);
    const up = g, idleT = [-0.3, -0.18, 0.05, 0.22, 0.3, 0.3], walkT = [1.25, 0.18, -0.08, -0.22, -0.32, -0.38], pt = this._pt ??= new Float32Array(6);
    for (let k = 0; k < 6; k++) pt[k] = mix(idleT[k], walkT[k], up) + this.tailMood * 0.08 * k * (1 - up);
    this.tail(P, pt, mix(0.28, 0.12, up), mix(0.22, 0.9 * Math.max(0.6, this.stride > 0 ? 1 : 1), up), 0.7);
    this.ears(P, 0.3 + 0.3 * g);
    // legs
    const d = DUTY * this.stride * g, ft = this._ft ??= new Float32Array(12);
    for (let n = 0; n < 4; n++) {
      const L = LEGS[n], fp = ((ph - L.ph) % 1 + 1) % 1;
      let zo, lift, flex;
      if (fp < DUTY) { zo = 0.5 - fp / DUTY; lift = 0; flex = 0; }
      else { const u = (fp - DUTY) / (1 - DUTY), e = u * u * (3 - 2 * u); zo = -0.5 + e; lift = Math.sin(Math.PI * u); flex = Math.sin(Math.PI * Math.min(1, u * 1.15)); }
      ft[3 * n] = zo * d; ft[3 * n + 1] = lift * g; ft[3 * n + 2] = flex * g;
      if (L.front) set(P, L.scap, -1.3 * zo * d, 0, 0);
    }
    this.fk(P);
    for (let n = 0; n < 4; n++) {
      const L = LEGS[n], zo = ft[3 * n], lift = ft[3 * n + 1], flex = ft[3 * n + 2];
      if (L.front) this.frontLeg(P, L, FRONT_TIP_Z + zo, 0.010 + lift * 0.032, flex);
      else this.hindLeg(P, L, HIND_BALL_Z + zo, 0.014 + lift * 0.028, SANG[L.d] + 2.4 * Math.max(0, -zo) - 0.5 * flex, TIPANG.toe - 0.9 * flex);
    }
    P[BSX] = 0.075; P[BSZ] = 0.22; P[BOZ] = -0.02;
  }
  // Point each tail bone at the next vertex of a curve given in the root frame (3-D FK from the hips' pose in P).
  aimTail(P, curve, wave) {
    const q = this._q ??= [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()], v = this._av ??= [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const [Q, ql, qi] = q, [O, d, r] = v, e = this.e, h = I.hips;
    e.set(P[3 * h], P[3 * h + 1], P[3 * h + 2], 'YXZ'); Q.setFromEuler(e);
    O.set(0, this.wy[h], this.wz[h]).add(d.set(...OFF[I.tail0]).applyQuaternion(Q));
    for (let k = 0; k < 6; k++) {
      const c = curve[k + 1];
      d.set(c[0] + (wave ? wave[k] : 0), c[1], c[2]).sub(O).normalize().applyQuaternion(qi.copy(Q).invert());
      r.set(...OFF[k < 5 ? TAIL[k + 1] : TAIL[5]]).normalize();
      ql.setFromUnitVectors(r, d); e.setFromQuaternion(ql, 'YXZ'); set(P, TAIL[k], e.x, e.y, e.z);
      Q.multiply(ql); O.add(d.set(...OFF[k < 5 ? TAIL[k + 1] : TAIL[5]]).applyQuaternion(Q));
    }
  }
  genSit(P) {
    P.fill(0);
    const T = TUNE.sit, t = this.time, br = Math.sin(t * TAU * 0.3);
    P[HY] = T.hy; P[HZ] = T.hz;
    set(P, I.hips, T.hips, 0, 0); set(P, I.spine1, T.s1 + 0.006 * br, 0, 0); set(P, I.spine2, T.s2, 0, 0); set(P, I.chest, T.chest - 0.006 * br, 0, 0);
    set(P, I.neck, T.neck, 0, 0); set(P, I.head, T.head, 0, 0);
    this.headLook(P, 1);
    this.ears(P, 0.6);
    set(P, I.scapL, T.scap, 0, 0); set(P, I.scapR, T.scap, 0, 0);
    this.fk(P);
    const flick = Math.sin(t * 1.3) * Math.max(0, Math.sin(t * 0.37)), wave = this._wv ??= new Float32Array(6);
    for (let k = 0; k < 6; k++) wave[k] = k > 3 ? flick * 0.015 * (k - 3) : 0;
    this.aimTail(P, TUNE.sitTail, wave);
    for (const L of LEGS) {
      if (L.front) this.frontLeg(P, L, T.fz, 0.010, 0);
      else { this.hindLeg(P, L, T.bz, 0.013, 0.0, TIPANG.toe); P[3 * L.a + 2] = L.side * T.abd; }
    }
    P[BSX] = 0.085; P[BSZ] = 0.15; P[BOZ] = -0.035;
  }
  genLie(P) {
    P.fill(0);
    const T = TUNE.lie, t = this.time, br = Math.sin(t * TAU * 0.25);
    P[HY] = T.hy; P[HZ] = T.hz;
    set(P, I.hips, T.hips, 0, 0); set(P, I.spine1, T.s1 + 0.008 * br, 0, 0); set(P, I.spine2, T.s2, 0, 0); set(P, I.chest, T.chest, 0, 0);
    set(P, I.neck, T.neck, 0, 0); set(P, I.head, T.head, 0, 0);
    this.headLook(P, 0.7);
    this.ears(P, 0.4);
    this.fk(P);
    const flick = Math.sin(t * 1.1) * Math.max(0, Math.sin(t * 0.29)), wave = this._wv ??= new Float32Array(6);
    for (let k = 0; k < 6; k++) wave[k] = k > 3 ? flick * 0.02 * (k - 3) : 0;
    this.aimTail(P, TUNE.lieTail, wave);
    for (const L of LEGS) {
      if (L.front) this.frontLeg(P, L, T.fz, 0.016, 0, T.curl);
      else { this.hindLeg(P, L, T.bz, 0.013, 0.0, TIPANG.toe); P[3 * L.a + 2] = L.side * T.abd; }
    }
    P[BSX] = 0.095; P[BSZ] = 0.23; P[BOZ] = -0.025;
  }
  // Being petted: up on its toes, tail straight up with a quivering hooked tip, head pushed up and rubbed against the hand
  // (cheek bumps), eyes half closed with slow blinks, front paws kneading.
  genPet(P, s) {
    P.fill(0);
    const t = this.time, pt = s.petT ?? t, rub = Math.sin(pt * TAU * 0.42), rub2 = Math.sin(pt * TAU * 0.84 + 0.6), br = Math.sin(t * TAU * 0.33), rise = sst(0, 0.7, pt);
    P[HY] = 0.007 * rise; P[HZ] = 0.01 * rise;
    set(P, I.hips, -0.04 * rise, 0.04 * rub, 0); add(P, I.spine2, 0.012 * br, 0, 0);
    set(P, I.chest, 0.03, -0.05 * rub, 0.04 * rub);
    set(P, I.neck, -0.3 * rise, 0.1 * rub, 0); set(P, I.head, (-0.2 - 0.07 * rub2) * rise, 0.14 * rub, 0.34 * rub * rise);
    this.headLook(P, 0.45);
    const q = 0.06 * Math.sin(t * TAU * 6.5), tp = this._tpp ??= new Float32Array(6), up = [1.25, 0.18, 0.04, 0.05, 0.4, 0.7];
    for (let k = 0; k < 6; k++) tp[k] = up[k] * rise + (k > 3 ? q * (k - 3) : 0);
    this.tail(P, tp, 0.04, 0.3, 0.6);
    this.ears(P, 0.05);
    this.fk(P);
    for (const L of LEGS) {
      if (L.front) { const kn = Math.max(0, Math.sin(pt * TAU * 1.05 + (L.side > 0 ? 0 : Math.PI))) * rise; this.frontLeg(P, L, FRONT_TIP_Z + 0.006, 0.010 + 0.022 * kn, 0.55 * kn); }
      else this.hindLeg(P, L, HIND_BALL_Z, 0.014, SANG[L.d], TIPANG.toe);
    }
    this._petLid = 0.5 + 0.45 * Math.pow(Math.max(0, Math.sin(pt * TAU * 0.17 - 1.2)), 6);
    P[BSX] = 0.075; P[BSZ] = 0.22; P[BOZ] = -0.02;
  }
  genJump(P, s) {
    P.fill(0);
    const jt = clamp(s.jumpT || 0, 0, 1), ta = CAT.jumpTakeoff, tl = CAT.jumpLand, dy = clamp(s.jumpDy || 0, -0.7, 0.7);
    const c = sst(0.0, 0.16, jt) * (1 - sst(ta - 0.05, ta + 0.01, jt)), wig = sst(0.05, 0.1, jt) * (1 - sst(ta - 0.1, ta - 0.04, jt));
    const a = clamp((jt - ta) / (tl - ta), 0, 1), air = sst(ta - 0.03, ta + 0.02, jt) * (1 - sst(tl - 0.02, tl + 0.04, jt));
    const land = jt > tl ? Math.sin(Math.PI * clamp((jt - tl) / (1 - tl), 0, 1)) : 0;
    const w = Math.sin(jt * CAT.jumpDuration * TAU * 5.5);
    P[HY] = -0.05 * c - 0.03 * land;
    set(P, I.hips, 0.1 * c, 0.15 * w * wig, 0.08 * w * wig);
    add(P, I.chest, 0.05 * c, 0, 0); set(P, I.neck, -0.12 * c, 0, 0); set(P, I.head, -0.12 * c, 0, 0);
    const pitch = air * (-0.25 - 0.45 * Math.max(0, dy)) * Math.cos(Math.PI * a) + air * Math.min(0, dy) * -0.4 * (1 - a);
    add(P, I.hips, pitch, 0, 0); add(P, I.neck, -0.6 * pitch, 0, 0); add(P, I.head, -0.3 * pitch, 0, 0);
    for (let k = 0; k < 6; k++) set(P, TAIL[k], mix(-0.15, 0.25, air) - 0.04 * k * (1 - air), (k > 3 ? 0.35 * Math.sin(jt * 30) * c : 0), 0);
    this.ears(P, 0.9);
    this.fk(P);
    for (const L of LEGS) {
      if (L.front) this.frontLeg(P, L, FRONT_TIP_Z, 0.010, 0); else this.hindLeg(P, L, HIND_BALL_Z, 0.014, SANG[L.d], TIPANG.toe);
    }
    if (air > 0.001) {
      const A = this.air, k = sst(0.2, 0.75, a);
      A.fill(0);
      for (const L of LEGS) {
        if (L.front) { set(A, L.a, mix(-1.05, -0.55, k), 0, 0); set(A, L.b, mix(-0.25, 0.15, k), 0, 0); set(A, L.c, mix(-0.4, 0.3, k), 0, 0); }
        else { set(A, L.a, mix(1.0, -0.45, k), 0, 0); set(A, L.b, mix(0.45, 0.75, k), 0, 0); set(A, L.c, mix(0.45, -0.55, k), 0, 0); set(A, L.d, mix(0.3, 0.1, k), 0, 0); }
        for (const i of [L.a, L.b, L.c, L.d]) if (i !== undefined) P[3 * i] = mix(P[3 * i], A[3 * i], air);
      }
    }
    P[BSX] = 0.075; P[BSZ] = 0.22; P[BOZ] = -0.02;
  }
  update(dt, s) {
    this.time = s.t ?? (this.time + dt);
    const mode = s.mode || 'idle', speed = Math.max(0, s.speed || 0), turn = s.turn || 0;
    // gait
    const v = Math.max(speed, Math.abs(turn) * 0.07);
    this.stride = clamp(0.12 + 0.48 * v, 0.12, 0.42);
    const gTarget = (mode === 'walk' || mode === 'idle') ? sst(0.012, 0.1, v) : 0;
    this.g += (gTarget - this.g) * (1 - Math.exp(-dt * 8));
    if (v > 0.002) this.phase = (this.phase + v / this.stride * dt) % 1;
    // attention
    const L = this.look, rnd = this.rnd;
    if ((L.next -= dt) <= 0) { L.next = 1.2 + rnd() * 4; L.ty = (rnd() - 0.5) * 1.6; L.tp = (rnd() - 0.6) * 0.45; L.tt = (rnd() - 0.5) * 0.3; if (rnd() < 0.3) { L.ty = 0; L.tp = 0; } }
    let ty = L.ty, tp = L.tp;
    if (s.look && this.root) {
      const p = this.v.copy(s.look); this.root.worldToLocal(p);
      const dx = p.x, dz = p.z - 0.2, dyy = p.y - 0.28, yaw = Math.atan2(dx, dz);
      if (Math.abs(yaw) < 1.7 && dx * dx + dz * dz < 36) { ty = clamp(yaw, -1.1, 1.1); tp = clamp(-Math.atan2(dyy, Math.hypot(dx, dz)), s.attend || mode === 'pet' ? -0.95 : -0.7, 0.35); }
    }
    const kl = 1 - Math.exp(-dt * 3.5); L.yaw += (ty - L.yaw) * kl; L.pitch += (tp - L.pitch) * kl; L.tilt += (L.tt - L.tilt) * kl;
    const E = this.ear; E.t += dt; if ((E.next -= dt) <= 0) { E.next = 1.5 + rnd() * 6; E.t = 0; E.side = [0, 1, -1][Math.floor(rnd() * 3)]; E.dur = 0.18 + rnd() * 0.15; }
    this.tailMood += ((Math.sin(this.time * 0.13) > 0.3 ? 1 : 0) - this.tailMood) * (1 - Math.exp(-dt));
    // family weights
    const fam = mode === 'sit' ? 'sit' : mode === 'lie' ? 'lie' : mode === 'jump' ? 'jump' : mode === 'pet' ? 'pet' : 'stand';
    const rate = fam === 'jump' ? 14 : this.w.jump > 0.05 ? 7 : fam === 'stand' ? 3.2 : 2.4, k = 1 - Math.exp(-dt * rate);
    let tot = 0; for (const f in this.w) { this.w[f] += ((f === fam ? 1 : 0) - this.w[f]) * k; if (this.w[f] < 0.002) this.w[f] = 0; tot += this.w[f]; }
    const B = this.blink; B.t += dt; if ((B.next -= dt) <= 0) { B.t = 0; B.next = mode === 'pet' ? 1.6 + rnd() * 1.5 : 2.5 + rnd() * 5; B.dur = mode === 'pet' ? 0.7 : 0.18; }
    const lidGoal = mode === 'pet' ? (this._petLid ?? 0.55) * sst(0, 0.8, s.petLeft ?? 1) : mode === 'lie' && this.time % 23 > 14 ? 0.8 : 0;
    this.lid += (lidGoal - this.lid) * (1 - Math.exp(-dt * 3)); this.lidOut = Math.max(this.lid, B.t < (B.dur ?? 0.18) ? Math.sin(Math.PI * B.t / (B.dur ?? 0.18)) : 0);
    const out = this.out; out.fill(0);
    for (const f in this.w) {
      const wf = this.w[f] / tot; if (!wf) continue;
      const P = this.pose[f];
      if (f === 'stand') this.genStand(P, s); else if (f === 'sit') this.genSit(P); else if (f === 'lie') this.genLie(P); else if (f === 'pet') this.genPet(P, s); else this.genJump(P, s);
      for (let i = 0; i < NPOSE; i++) out[i] += P[i] * wf;
    }
    const e = this.e;
    for (let i = 1; i < NB; i++) { e.set(out[3 * i], out[3 * i + 1], out[3 * i + 2], 'YXZ'); this.bones[i].quaternion.setFromEuler(e); }
    this.bones[I.hips].position.set(this.rest[I.hips].x, this.rest[I.hips].y + out[HY], this.rest[I.hips].z + out[HZ]);
    return out;
  }
}

// ---------------------------------------------------------------- the pet
const CAT = { radius: 0.12, walkSpeed: 0.34, trotSpeed: 0.62, jumpHeight: 0.3, jumpDuration: 1.0, jumpTakeoff: 0.34, jumpLand: 0.78, maxPerch: 0.62, callSpeed: 0.5 };
let cached = null;
export function createPet(opts = {}) {
  const built = opts.fresh || !cached ? buildCat(opts) : cached;
  if (!opts.fresh) cached = built;
  const root = new THREE.Group(); root.name = 'pet-cat'; declare(root, { role: 'pet' });
  const bones = BONES.map(([name]) => { const b = new THREE.Bone(); b.name = 'cat_' + name; return b; });
  BONES.forEach((b, i) => { bones[i].position.set(...OFF[i]); if (PARENT[i] >= 0) bones[PARENT[i]].add(bones[i]); });
  root.add(bones[0]); root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const fur = furMaterial(built.texture, built.uStrand);
  const body = new THREE.SkinnedMesh(built.geometry, fur); body.name = 'cat-fur';
  const iris = irisTexture(), eyeMat = new THREE.MeshPhysicalMaterial({ map: iris.map, roughnessMap: iris.mask, clearcoatMap: iris.mask, roughness: 1, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.2 });
  const eyeUni = { uLid: { value: 0 } };
  eyeMat.onBeforeCompile = (sh) => {   // the upper lid (fur-coloured, matte) comes down over the almond opening as uLid → 1
    sh.uniforms.uLid = eyeUni.uLid;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uLid; float eyeLid = 0.0;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        { float ex = vMapUv.x * 2.0 - 1.0, ey = vMapUv.y * 2.0 - 1.0, yc = ey - 0.14 * ex;
          float hw = 0.6 * pow(max(0.0, 1.0 - pow(abs(ex + 0.04) / 0.98, 2.2)), 0.75), top = hw - uLid * 1.25 * hw;
          if (uLid > 0.01 && yc > top - 0.005 && yc < hw + 0.075) { eyeLid = 1.0; diffuseColor.rgb = yc > top + 0.06 ? vec3(0.30, 0.18, 0.09) : vec3(0.012, 0.007, 0.004); } }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n if (eyeLid > 0.5) roughnessFactor = 0.95;')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n if (eyeLid > 0.5) material.clearcoat = 0.0;');
  };
  eyeMat.customProgramCacheKey = () => 'croton-cat-eye-1';
  const eyes = new THREE.SkinnedMesh(buildEyes(), eyeMat); eyes.name = 'cat-eyes';
  for (const m of [body, eyes]) { m.castShadow = false; m.receiveShadow = true; m.bind(skeleton, new THREE.Matrix4()); m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.2, -0.08), 0.62); root.add(m); }
  const blobMat = new THREE.MeshBasicMaterial({ map: blobTexture(), color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), blobMat); blob.name = 'cat-blob'; blob.renderOrder = 2; blob.castShadow = blob.receiveShadow = false; root.add(blob);
  declare(blob, { role: 'presentation', fakeShadow: true });   // a stand-in contact shadow: never traced, hidden under contact AO
  const rig = new CatRig(bones, opts.seed ?? 7); rig.root = root;
  const uni = fur.userData.uniforms;
  const pet = {
    root, ...CAT, modes: ['idle', 'walk', 'sit', 'lie', 'jump', 'pet'], pickBox: [-0.1, 0, -0.24, 0.1, 0.4, 0.29],
    update(dt, s) {
      const out = rig.update(dt, s); eyeUni.uLid.value = rig.lidOut;
      const lift = Math.max(0, s.lift || 0), k = 1 + lift * 1.2;
      blob.position.set(0, 0.004 - lift, out[BOZ]); blob.scale.set(out[BSX] * k, 1, out[BSZ] * k); blobMat.opacity = 0.42 * (1 - Math.min(0.75, lift * 1.4));
      const cd = s.camDist ?? 3, n = cd < 2.5 ? built.shells : cd < 6 ? Math.ceil(built.shells / 2) : cd < 14 ? 3 : 0;
      built.geometry.instanceCount = 1 + n; uni.uBase.value = n === 0 ? 0.92 : n < built.shells ? 0.7 : 0.55;
    },
    dispose() { root.removeFromParent(); fur.dispose(); iris.map.dispose(); iris.mask.dispose(); eyeMat.dispose(); blobMat.map.dispose(); blobMat.dispose(); blob.geometry.dispose(); eyes.geometry.dispose(); if (opts.fresh) { built.geometry.dispose(); built.texture.dispose(); } },
    _internal: { rig, bones, skeleton, built, body, eyes, blob, BONES, BI, NB },
  };
  return pet;
}
export { buildCat, CatRig, TUNE as CAT_TUNE, BONES as CAT_BONES, BI as CAT_BI };
