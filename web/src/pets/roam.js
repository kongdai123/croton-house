// Roaming for the house pets: the cat (cat.js) and the dog (dog.js), both through the createPet() contract in cat.js's header.
// They wander the whole lot — every room whose door is open, the patio, courtyards, back garden, side yards and the front
// yard (never the street) — on the walkable grid from nav.js built with the real door states, the player's movable
// furniture, open door leaves and slider panels. Behaviour: wander → pause (idle / sit / lie, 3–20 s) → wander, playful hops,
// and for a pet with maxPerch, jumps up onto a sofa / bed / bench seat whose top was ray-cast flat, a rest, and a jump down.
// Pets keep 0.6 m apart, step aside when the player walks into them, and the dog sometimes trails the player.
// URL: ?pets=0 disables them (main.js), ?petseed=N makes their choices repeatable.
import * as THREE from 'three';
import { buildGrid, navPath, freeSpot, freeRun, NAV_R } from '../nav.js';
import * as HOUSE from '../house.js';
import { spaceAt, isInside } from '../plan.js';
import { t as tr } from '../ui.js';
import { createPet as createCat } from './cat.js';
import { createPet as createDog } from './dog.js';

const NX = 400, NZ = 440, CELL = 0.1, X0 = -20, Z0 = -24;   // nav.js grid layout
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapA = (a) => a - TAU * Math.round(a / TAU);
const now = () => performance.now();
function mulberry(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function inPoly(x, y, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c; } return c; }
const inRect = (r, x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

// ---- Ground: the slab the player walks on at (x, z), metres (plan y = -z). Mirrors house.js's buildGround levels.
let SURF = null;
function surfaces() {
  const H = HOUSE, rects = (list, y) => list.filter(Boolean).map(r => ({ r, y })), polys = (list, y) => list.filter(Boolean).map(p => ({ p, y }));
  return [...polys([H.EXT_FP], 0), ...rects([H.PORCH], 0.02), ...rects([H.FRONT_TERRACE], 0.22), ...polys([H.FRONT_WALK], 0.014),
    ...rects([H.PATIO, H.WALK, H.DRIVE, H.PAD, H.COURT_PAD], 0.012), ...rects([H.COURT_A, H.COURT_B], 0), ...polys([H.LOUNGE], -0.006),
    ...polys(H.SIDE_PATHS ?? [], -0.007), ...polys([H.FRONT_BED, H.WEST_SHELL], -0.008), ...polys(H.ISLAND_BEDS ?? [], -0.02), ...polys([H.GARDEN], -0.024)];
}
export function groundY(x, z) {
  const y = -z;
  for (const s of (SURF ??= surfaces())) if (s.r ? inRect(s.r, x, y) : inPoly(x, y, s.p)) return s.y;
  return -0.03;
}
// Area label (a plan space id: kitchen, hall, garage, patio, backGarden, ...) for the roaming stats tools; walls and
// doorways take the room they face, anything else under the roof is 'house'.
export function areaOf(x, z) { return spaceAt(x, -z, 0.3)?.id ?? 'house'; }
export const isIndoor = (x, z) => isInside(x, -z, 0);
// Hard edges of the pets' world: the lot sides, a strip back from the street curb, beyond the back fence.
const LOT_EDGE = { x0: -14.25, x1: 14.25, yStreet: -13.3, yBack: 19.25 };
const BOUNDS = [
  { x0: -40, x1: LOT_EDGE.x0, z0: -40, z1: 40, tag: 'pet-lot' }, { x0: LOT_EDGE.x1, x1: 40, z0: -40, z1: 40, tag: 'pet-lot' },
  { x0: -40, x1: 40, z0: -LOT_EDGE.yStreet, z1: 40, tag: 'pet-street' }, { x0: -40, x1: 40, z0: -40, z1: -LOT_EDGE.yBack, tag: 'pet-lot' },
];
// Places pets like (plan x, y): rugs, sofa front, sunny patio, courtyards, the lounge, side paths, front terrace and lawn.
const SPOTS = {
  indoor: [[1.3, -2.35], [3.1, -2.3], [2.17, -2.0], [2.17, -3.65], [-4.6, 3.3], [5.35, 3.4], [5.3, -3.9], [-2.1, -1.7], [1.85, 2.2], [-1.0, 4.5], [4.55, 0.3], [-5.0, -3.4]],
  outdoor: [[2.6, 6.6], [-0.8, 6.3], [3.5, 8.8], [-4.4, 7.0], [6.0, 8.0], [2.9, 12.9], [3.6, 14.2], [0.0, 14.4], [-10.5, 3.0], [10.5, 3.0], [0.2, -9.3], [8.5, -11.0], [-11.0, -10.0], [-6.5, -9.5]],
};
const PERCH_KINDS = { sofa: 0.04, bench: 0.0, bed: 0.36 };

export class Pets {
  constructor({ scene, player, layout, camera, seed, ui, lighting } = {}) {
    this.scene = scene; this.player = player; this.layout = layout; this.camera = camera ?? player?.camera; this.ui = ui; this.lighting = lighting;
    this.seed = seed ?? ((Math.random() * 1e9) | 0); this.rnd = mulberry(this.seed);
    this.t = 0; this.stats = { rebuilds: 0, plans: 0, planMs: 0, rebuildMs: 0, ms: 0, msMax: 0, frames: 0 };
    this.comp = new Int32Array(NX * NZ); this.queue = new Int32Array(NX * NZ);
    this.box = new THREE.Box3(); this.ray = new THREE.Raycaster(); this.v = new THREE.Vector3();
    this.sig = this.signature(); this.sigSeen = this.sig; this.sigTimer = 0; this.rebuild();
    this.perches = null; this.agents = [];
    // Cat starts in the study. Dog starts on the patio, just outside the centre back doors (opening 161782cdfa).
    this.add('cat', createCat, [-1.2, 4.45], { indoor: 0.6, perch: true, rest: 1.5, near: 5, modes: [['sit', 0.35], ['lie', 0.3], ['idle', 0.35]] });
    this.add('dog', createDog, [0.4, 6.35], { indoor: 0.38, follow: true, modes: [['idle', 0.4], ['sit', 0.35], ['lie', 0.25]] });
    for (const a of this.agents) a.other = this.agents.find(b => b !== a) ?? null;
    this.hearts = makeHearts(scene);
  }
  add(name, create, [px, py], prefs) {
    let pet; try { pet = create({ seed: this.seed + name.length }); } catch (e) { console.warn('pet failed to build:', name, e); return; }
    const spot = freeSpot(this.grid, px, -py, 0.3), walk = pet.walkSpeed ?? 0.35;
    const a = {
      name, pet, root: pet.root, prefs, r: pet.radius ?? 0.13, walk, trot: pet.trotSpeed ?? walk * 1.6, maxPerch: pet.maxPerch ?? 0,
      ta: pet.jumpTakeoff ?? 0.3, tl: pet.jumpLand ?? 0.8, x: spot.x, z: spot.z, y: groundY(spot.x, spot.z), yaw: this.rnd() * TAU, v: 0, turn: 0,
      state: 'pause', st: 0, dur: 1 + this.rnd() * 2, mode: 'idle', path: null, pi: 0, speedGoal: walk, onArrive: null, after: null, turnTo: 0,
      supports: new Set(pet.modes ?? ['idle', 'walk', 'sit', 'lie', 'jump']), pickBox: pet.pickBox ?? [-(pet.radius ?? 0.13), 0, -(pet.radius ?? 0.13) * 1.8, pet.radius ?? 0.13, (pet.radius ?? 0.13) * 2.4, (pet.radius ?? 0.13) * 2], excite: 0, call: null, petStart: 0, petUntil: 0, petN: 0,
      count: { pet: 0, call: 0, hop: 0, perch: 0, aside: 0, follow: 0, replan: 0, unstick: 0, walks: 0 }, jump: null, perch: null, stuck: 0, block: 0, fleeAt: -9, followUntil: 0, followAt: 0, legs: 0, wantIndoor: null, other: null, hold: null,
      s: { mode: 'idle', speed: 0, turn: 0, t: 0, jumpT: 0, lift: 0, jumpDy: 0, look: null, camDist: 5, petT: 0, petLeft: 0, petN: 0, hand: new THREE.Vector3(), attend: false, excite: 0 },
    };
    pet.root.position.set(a.x, a.y, a.z); this.scene.add(pet.root);
    a.mats = []; a.litAt = -1;
    if (this.lighting) pet.root.traverse(o => { if (o.isMesh && o.material?.isMeshStandardMaterial) { this.lighting.attachPet(o.material); a.mats.push(o.material); } });
    this.agents.push(a);
  }
  get(name) { return this.agents.find(a => a.name === name); }
  relight() { if (!this.lighting) return; for (const a of this.agents) { a.litAt = this.t; const inn = isIndoor(a.x, a.z); for (const m of a.mats) this.lighting.syncPet(m, inn); } }
  areaOf(x, z) { return areaOf(x, z); }
  groundY(x, z) { return groundY(x, z); }
  get lotEdge() { return LOT_EDGE; }
  colliders() { return HOUSE.getColliders().concat(this.extras()); }

  // ---- walkable grid: rebuilt (≈10 ms) only when a door, a slider or a movable piece changes
  signature() {
    let h = 7;
    for (const d of HOUSE.getDoors()) { const v = d.pivot ? d.pivot.rotation.y : d.kind === 'french' ? d.open : d.kind === 'slider' ? d.slide?.position.x ?? 0 : d.kind === 'bifold' ? d.fold : 0; h = (Math.imul(h, 31) + Math.round(v * 20)) | 0; }
    for (const m of this.layout?.movables ?? []) h = (Math.imul(h, 31) + Math.round(m.position.x * 10) * 977 + Math.round(m.position.z * 10)) | 0;
    return h;
  }
  extras() {
    const out = BOUNDS.concat(this.player?.extraColliders?.() ?? []), b = this.box;
    const leaf = (o) => { b.setFromObject(o); out.push({ x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z, tag: 'pet-leaf' }); };
    for (const d of HOUSE.getDoors()) {
      if (d.pivot) leaf(d.pivot);   // open: the leaf's footprint; closed: it fills the doorway (the front door has no collider of its own)
      else if (d.kind === 'french' && d.open > 0.03) for (const l of d.leaves) leaf(l.pivot);
      else if (d.kind === 'slider' && d.slide) leaf(d.slide);
    }
    return out;
  }
  rebuild() {
    const t0 = now();
    this.grid = buildGrid(this.extras(), { doors: true });
    const clr = this.grid.clr, comp = this.comp, q = this.queue; comp.fill(-1);
    if (clr.length === NX * NZ) {
      let label = 0;
      for (let s = 0; s < clr.length; s++) {
        if (comp[s] >= 0 || clr[s] < NAV_R) continue;
        let head = 0, tail = 0; q[tail++] = s; comp[s] = label;
        while (head < tail) {
          const k = q[head++], i = k % NX;
          if (i > 0 && comp[k - 1] < 0 && clr[k - 1] >= NAV_R) { comp[k - 1] = label; q[tail++] = k - 1; }
          if (i < NX - 1 && comp[k + 1] < 0 && clr[k + 1] >= NAV_R) { comp[k + 1] = label; q[tail++] = k + 1; }
          if (k >= NX && comp[k - NX] < 0 && clr[k - NX] >= NAV_R) { comp[k - NX] = label; q[tail++] = k - NX; }
          if (k < clr.length - NX && comp[k + NX] < 0 && clr[k + NX] >= NAV_R) { comp[k + NX] = label; q[tail++] = k + NX; }
        }
        label++;
      }
    }
    this.stats.rebuilds++; this.stats.rebuildMs = now() - t0;
  }
  compAt(x, z) { const i = Math.floor((x - X0) / CELL), j = Math.floor((z - Z0) / CELL); return i < 0 || j < 0 || i >= NX || j >= NZ ? -1 : this.comp[j * NX + i]; }
  // nearest grid component to a pet (it may stand inside the clearance margin of a wall)
  compNear(x, z) { let c = this.compAt(x, z); if (c >= 0) return c; for (let r = 0.1; r <= 0.6; r += 0.1) for (let k = 0; k < 8; k++) { c = this.compAt(x + Math.cos(k * TAU / 8) * r, z + Math.sin(k * TAU / 8) * r); if (c >= 0) return c; } return -1; }
  clear(x, z) { return this.grid.at(x, z); }
  los(ax, az, bx, bz, need) { const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 0.05)); for (let s = 0; s <= n; s++) { const t = s / n; if (this.grid.at(ax + (bx - ax) * t, az + (bz - az) * t) < need) return false; } return true; }

  // ---- perches: seat tops of sofas, beds and benches, ray-cast so only flat, clear ones count
  collectPerches() {
    this.perches = [];
    const maxPerch = Math.max(0, ...this.agents.map(a => a.maxPerch)); if (!maxPerch) return;
    const ray = this.ray, o = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0);
    for (const root of this.layout?.interactive ?? []) {
      if (root.userData.movable || !root.userData.seats) continue;
      root.updateMatrixWorld(true);
      for (const seat of root.userData.seats) {
        const inset = PERCH_KINDS[seat.kind]; if (inset === undefined) continue;
        const sw = new THREE.Vector3(seat.x, seat.y, seat.z).applyMatrix4(root.matrixWorld), face = root.rotation.y + seat.facing, fx = Math.sin(face), fz = Math.cos(face);
        const px = sw.x - fx * inset, pz = sw.z - fz * inset, along = face + Math.PI / 2, ax = Math.sin(along), az = Math.cos(along);
        const hs = [];
        for (const [u, w] of [[0, 0], [0.14, 0], [-0.14, 0], [0, 0.06], [0, -0.06]]) {
          ray.set(o.set(px + ax * u + fx * w, sw.y + 1.0, pz + az * u + fz * w), down); ray.far = 1.6;
          const hit = ray.intersectObject(root, true)[0]; hs.push(hit ? hit.point.y : -1);
        }
        const lo = Math.min(...hs), hi = Math.max(...hs);
        if (lo < 0.25 || hi > maxPerch + 0.04 || hi - lo > 0.05) continue;
        let app = null;
        for (let d = 0.32; d <= 0.8 && !app; d += 0.04) { const x = sw.x + fx * d, z = sw.z + fz * d; if (this.clear(x, z) >= 0.2 && this.compAt(x, z) >= 0) app = { x, z }; }
        if (!app || Math.hypot(app.x - px, app.z - pz) > 0.9) continue;
        if (this.perches.some(p => Math.hypot(p.x - px, p.z - pz) < 0.35)) continue;
        this.perches.push({ root, kind: seat.kind, x: px, z: pz, y: (lo + hi) / 2 + 0.003, yaw: along + (this.rnd() < 0.5 ? 0 : Math.PI), ax: app.x, az: app.z });
      }
    }
  }
  perchFree(p, self) { const s = this.player?.seat; return !(s && s.root === p.root && s.position && Math.hypot(s.position.x - p.x, s.position.z - p.z) < 0.7) && !this.agents.some(a => a !== self && (a.perch === p || a.goal === p)); }

  // ---- behaviour
  update(dt) {
    const t0 = now(); dt = Math.min(dt, 0.1); this.t += dt;
    if (!this.perches) this.collectPerches();
    if ((this.sigTimer -= dt) <= 0) {
      this.sigTimer = 0.3;
      const sig = this.signature(), moving = HOUSE.getDoors().some(d => d._t !== undefined && d._t < 1);
      if (sig !== this.sig && sig === this.sigSeen && !moving) { this.sig = sig; this.rebuild(); for (const a of this.agents) this.revalidate(a); }
      this.sigSeen = sig;
    }
    const cam = this.camera?.position;
    for (const a of this.agents) {
      this.think(a, dt);
      a.root.position.set(a.x, a.y, a.z); a.root.rotation.y = a.yaw;
      const s = a.s; s.t = this.t; s.camDist = cam ? Math.hypot(cam.x - a.x, cam.y - a.y, cam.z - a.z) : 5;
      a.pet.update(dt, s);
      if (this.lighting && this.t - a.litAt > 0.5) { a.litAt = this.t; const inn = isIndoor(a.x, a.z); for (const m of a.mats) this.lighting.syncPet(m, inn); }
    }
    this.hearts.tick(dt);
    const ms = now() - t0; this.stats.frames++; this.stats.ms += (ms - this.stats.ms) * 0.02; if (ms > this.stats.msMax) this.stats.msMax = ms;
  }
  think(a, dt) {
    const s = a.s; a.st += dt; s.lift = 0; s.jumpDy = 0; s.attend = false;
    a.excite = Math.max(a.state === 'pet' || (a.call && a.state === 'walk') ? 1 : 0, a.excite - dt * 0.2); s.excite = a.excite;
    if (a.hold) { const h = a.hold; a.x = h.x ?? a.x; a.z = h.z ?? a.z; a.y = h.y ?? groundY(a.x, a.z); a.yaw = h.yaw ?? a.yaw; s.mode = h.mode ?? 'idle'; s.speed = h.speed ?? 0; s.turn = h.turn ?? 0; s.jumpT = h.jumpT ?? 0; s.lift = h.lift ?? 0; s.jumpDy = h.jumpDy ?? 0; s.look = h.look ?? null; return; }
    const pl = this.player?.pos, dPl = pl ? Math.hypot(pl.x - a.x, pl.z - a.z) : 99;
    s.look = dPl < 3.2 && (a.state !== 'walk' || a.followUntil > this.t || a.call) ? this.camera.position : null;
    if (a.call?.pending && a.state !== 'jump' && !a.perch) { a.call = null; this.startCall(a); return; }
    // make room: the player walking into a pet, or the other pet too close
    if (a.state !== 'jump' && a.state !== 'flee' && a.state !== 'pet' && a.state !== 'attend') {
      if (a.perch) { if (a.state === 'perched' && (!this.perchFree(a.perch, a) || dPl < 0.45)) a.dur = 0; }
      else if (dPl < 0.55 && !a.call && this.t - a.fleeAt > 1.2) { a.fleeAt = this.t; if (this.stepAside(a, pl.x, pl.z)) return; }
      else if (a.other && !a.other.perch && Math.hypot(a.other.x - a.x, a.other.z - a.z) < 0.6 && this.yields(a) && this.t - a.fleeAt > 1.2) { a.fleeAt = this.t; if (this.stepAside(a, a.other.x, a.other.z)) return; }
    }
    switch (a.state) {
      case 'pause': case 'perched':
        s.mode = a.mode; s.speed = 0; s.turn = 0; a.v = 0;
        if (a.st >= a.dur) { if (a.mode === 'sit' || a.mode === 'lie') { a.state = 'rise'; a.st = 0; a.mode = 'idle'; } else if (a.state === 'perched') this.leavePerch(a); else this.decide(a); }
        break;
      case 'rise':
        s.mode = 'idle'; s.speed = 0; s.turn = 0;
        if (a.st >= 0.75) { if (a.perch) this.leavePerch(a); else if (a.path) a.state = 'walk'; else this.decide(a); }
        break;
      case 'turn': {
        const d = wrapA(a.turnTo - a.yaw), r = clamp(d * 3, -1.9, 1.9);
        a.turn += (r - a.turn) * (1 - Math.exp(-dt * 10)); a.yaw += a.turn * dt;
        s.mode = 'walk'; s.speed = 0; s.turn = a.turn;
        if (Math.abs(d) < 0.06 || a.st > 4) { a.turn = 0; s.turn = 0; const f = a.after; a.after = null; f ? f() : this.decide(a); }
        break;
      }
      case 'walk': case 'flee': this.walkStep(a, dt); break;
      case 'pet': {
        const pl = this.player.pos, d = wrapA(Math.atan2(pl.x - a.x, pl.z - a.z) - a.yaw);
        a.turn = Math.abs(d) > 0.04 ? clamp(d * 4, -2.4, 2.4) : 0; a.yaw += a.turn * dt; a.v = 0;
        s.mode = a.petPose === 'sit' ? 'sit' : a.supports.has('pet') ? 'pet' : 'sit'; s.attend = a.petPose === 'sit'; s.speed = 0; s.turn = a.turn; s.look = this.camera.position;
        s.petT = this.t - a.petStart; s.petLeft = Math.max(0, a.petUntil - this.t); s.petN = a.petN;
        { const c = this.camera.position, hx = c.x - a.x, hz = c.z - a.z, hl = Math.hypot(hx, hz) || 1, top = a.y + a.pickBox[4]; s.hand.set(a.x + hx / hl * 0.12, top + 0.06, a.z + hz / hl * 0.12); }
        if ((a.heartT -= dt) <= 0) { a.heartT = 0.85; this.hearts.spawn(a); }
        if (this.t >= a.petUntil) { a.petPose = null; if (a.perch) { a.state = 'perched'; a.mode = 'sit'; a.st = 0; a.dur = 4 + this.rnd() * 6; } else { a.state = 'pause'; a.mode = 'sit'; a.st = 0; a.dur = 2.5 + this.rnd() * 2.5; } }
        break;
      }
      case 'attend': {   // called: sit in front of the player and look up; follow if the player walks off
        s.mode = 'sit'; s.attend = true; s.speed = 0; s.turn = 0; s.look = this.camera.position; a.v = 0;
        const pl = this.player.pos, c = a.call;
        if (c && Math.hypot(pl.x - c.px, pl.z - c.pz) > 1.3 && this.t - c.at > 1) { a.state = 'pause'; a.mode = 'sit'; this.startCall(a, true); break; }
        if (a.st >= a.dur) { a.call = null; a.state = 'rise'; a.mode = 'idle'; a.st = 0; }
        break;
      }
      case 'jump': this.jumpStep(a, dt); break;
    }
    if (!a.perch && a.state !== 'jump') { const g = groundY(a.x, a.z); a.y += (g - a.y) * (1 - Math.exp(-dt * 16)); }
  }
  yields(a) { const o = a.other; if (!o) return false; if (a.call) return false; if (o.call) return true; if (o.state === 'walk' && a.state !== 'walk') return false; if (a.state === 'walk' && o.state !== 'walk') return true; return a.name === 'dog' || !o.pet; }
  decide(a) {
    a.mode = 'idle'; a.goal = null; a.call = null;
    if (a.followUntil > this.t && this.follow(a)) return;
    const r = this.rnd();
    if (a.maxPerch && r < 0.22) { const p = this.pickPerch(a); if (p && this.goPerch(a, p)) return; }
    if (r < 0.3) { this.hop(a); return; }
    const pl = this.player?.pos;
    if (a.prefs.follow && pl && r < 0.42 && Math.hypot(pl.x - a.x, pl.z - a.z) < 6 && this.compNear(pl.x, pl.z) === this.compNear(a.x, a.z)) { a.followUntil = this.t + 15 + this.rnd() * 20; if (this.follow(a)) return; }
    this.wander(a);
  }
  pause(a, mode, dur) {
    const turnTo = this.openYaw(a);
    const go = () => { a.state = a.perch ? 'perched' : 'pause'; a.st = 0; a.mode = mode; a.dur = dur; };
    if (mode !== 'idle' && turnTo !== null && Math.abs(wrapA(turnTo - a.yaw)) > 0.5) this.turn(a, turnTo, go); else go();
  }
  restPause(a) {
    let r = this.rnd(), mode = 'idle'; for (const [m, w] of a.prefs.modes) { if (r < w) { mode = m; break; } r -= w; }
    const k = a.prefs.rest ?? 1;
    this.pause(a, mode, k * (mode === 'lie' ? 9 + this.rnd() * 11 : mode === 'sit' ? 5 + this.rnd() * 10 : 3 + this.rnd() * 5));
  }
  // facing with the most room (so a sitting / lying pet does not put its head into a wall)
  openYaw(a) {
    let best = null, run = -1;
    for (let k = 0; k < 8; k++) { const yaw = a.yaw + (k - 3.5) * TAU / 8, f = freeRun(this.grid, a.x, a.z, Math.sin(yaw), Math.cos(yaw), 0.8, 0.12) - Math.abs(wrapA(yaw - a.yaw)) * 0.05; if (f > run) { run = f; best = yaw; } }
    return run >= 0.75 ? null : best;
  }
  turn(a, yaw, after) { a.state = 'turn'; a.st = 0; a.turnTo = a.yaw + wrapA(yaw - a.yaw); a.after = after; a.v = 0; }
  wander(a) {
    const comp = this.compNear(a.x, a.z), o = a.other, H = isIndoor(a.x, a.z);
    // keep the indoor/outdoor balance; a long trip every few legs keeps the whole property in play
    const wantIndoor = ++a.legs % 4 === 0 ? !H : this.rnd() < a.prefs.indoor;
    for (let k = 0; k < 40; k++) {
      let x, z;
      if (k < 8 && this.rnd() < (wantIndoor ? 0.4 : 0.65)) { const list = SPOTS[wantIndoor ? 'indoor' : 'outdoor'], p = list[Math.floor(this.rnd() * list.length)], f = freeSpot(this.grid, p[0] + (this.rnd() - 0.5) * 0.6, -p[1] + (this.rnd() - 0.5) * 0.6, 0.32); x = f.x; z = f.z; }
      else { x = LOT_EDGE.x0 + 0.3 + this.rnd() * (LOT_EDGE.x1 - LOT_EDGE.x0 - 0.6); z = -(LOT_EDGE.yStreet + 0.3 + this.rnd() * (LOT_EDGE.yBack - LOT_EDGE.yStreet - 0.6)); }
      if (this.clear(x, z) < 0.28 || this.compAt(x, z) !== comp) continue;
      if (!wantIndoor && z > 0 && k < 24 && this.rnd() < 0.6) continue;
      if (k < 30 && isIndoor(x, z) !== wantIndoor) continue;
      if (Math.hypot(x - a.x, z - a.z) < 1.5 || (a.prefs.near && a.legs % 4 && k < 25 && Math.hypot(x - a.x, z - a.z) > a.prefs.near)) continue;
      if (o && (Math.hypot(x - o.x, z - o.z) < 1.3 || (o.path && Math.hypot(x - o.goalX, z - o.goalZ) < 1.3))) continue;
      if (this.walkTo(a, x, z, () => this.restPause(a))) return;
    }
    this.pause(a, 'idle', 2 + this.rnd() * 2);
  }
  follow(a) {
    const pl = this.player?.pos; if (!pl) return false;
    const f = this.player.forward?.() ?? new THREE.Vector3(0, 0, -1), side = (this.rnd() - 0.5) * 1.2;
    const spot = freeSpot(this.grid, pl.x - f.x * 1.1 - f.z * side, pl.z - f.z * 1.1 + f.x * side, 0.25);
    if (Math.hypot(spot.x - a.x, spot.z - a.z) < 0.5) { this.pause(a, 'idle', 1.5); return true; }
    if (this.compAt(spot.x, spot.z) !== this.compNear(a.x, a.z) || Math.hypot(pl.x - a.x, pl.z - a.z) > 9) { a.followUntil = 0; return false; }
    a.followAt = this.t; a.count.follow++;
    return this.walkTo(a, spot.x, spot.z, () => this.pause(a, this.rnd() < 0.3 ? 'sit' : 'idle', 1.5 + this.rnd() * 2), a.walk * 1.25);
  }
  hop(a) {
    a.count.hop++;
    const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw), d = freeRun(this.grid, a.x, a.z, fx, fz, 0.5, 0.16) >= 0.45 && this.rnd() < 0.7 ? 0.32 : 0;
    this.jump(a, a.x + fx * d, a.z + fz * d, null, a.pet.jumpHeight ?? 0.25, a.pet.jumpDuration ?? 0.8, () => this.pause(a, 'idle', 1.5 + this.rnd() * 2.5));
  }
  pickPerch(a) {
    const comp = this.compNear(a.x, a.z), list = this.perches.filter(p => p.y <= a.maxPerch && this.perchFree(p, a) && this.compAt(p.ax, p.az) === comp && Math.hypot(p.ax - a.x, p.az - a.z) < 9);
    return list.length ? list[Math.floor(this.rnd() * list.length)] : null;
  }
  goPerch(a, p) {
    a.goal = p;
    return this.walkTo(a, p.ax, p.az, () => this.turn(a, Math.atan2(p.x - a.x, p.z - a.z), () => {
      if (!this.perchFree(p, a)) { a.goal = null; this.restPause(a); return; }
      this.jump(a, p.x, p.z, p.y, 0.14, (a.pet.jumpDuration ?? 0.9) * 1.2, () => {
        a.perch = p; a.goal = null; a.count.perch++;
        this.turn(a, p.yaw, () => { const r = this.rnd(); this.pause(a, r < 0.55 ? 'lie' : r < 0.85 ? 'sit' : 'idle', 8 + this.rnd() * 16); });
      });
    }));
  }
  leavePerch(a) {
    const p = a.perch; if (!p) { this.decide(a); return; }
    this.turn(a, Math.atan2(p.ax - a.x, p.az - a.z), () => this.jump(a, p.ax, p.az, null, 0.1, (a.pet.jumpDuration ?? 0.9) * 1.1, () => this.pause(a, 'idle', 1 + this.rnd() * 2), true));
  }
  jump(a, x1, z1, y1, h, dur, after, fromPerch = false) {
    const y0 = a.y, ye = y1 ?? groundY(x1, z1);
    a.jump = { x0: a.x, z0: a.z, y0, x1, z1, y1: ye, h, dur, after, fromPerch, t: 0 };
    a.state = 'jump'; a.st = 0; a.v = 0; a.turn = 0;
  }
  jumpStep(a, dt) {
    const J = a.jump, s = a.s; J.t = Math.min(1, J.t + dt / J.dur);
    const u = clamp((J.t - a.ta) / (a.tl - a.ta), 0, 1), e = u * u * (3 - 2 * u);
    a.x = J.x0 + (J.x1 - J.x0) * e; a.z = J.z0 + (J.z1 - J.z0) * e;
    const H = J.h + Math.max(0, J.y1 - J.y0) * 0.45; a.y = J.y0 + (J.y1 - J.y0) * u + 4 * H * u * (1 - u);
    s.mode = 'jump'; s.jumpT = J.t; s.speed = 0; s.turn = 0; s.jumpDy = J.y1 - J.y0; s.lift = Math.max(0, a.y - (u < 0.5 ? J.y0 : J.y1));
    if (J.t >= 1) { a.x = J.x1; a.z = J.z1; a.y = J.y1; if (J.fromPerch) a.perch = null; a.jump = null; s.jumpT = 0; s.lift = 0; a.state = 'pause'; a.st = 0; a.dur = 0.3; J.after?.(); }
  }
  stepAside(a, tx, tz) {
    let dx = a.x - tx, dz = a.z - tz; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const comp = this.compNear(a.x, a.z);
    for (const ang of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.5, -2.5]) for (const d of [1.0, 0.8, 1.3]) {
      const c = Math.cos(ang), sn = Math.sin(ang), x = a.x + (dx * c - dz * sn) * d, z = a.z + (dx * sn + dz * c) * d;
      if (this.clear(x, z) < 0.22 || this.compAt(x, z) !== comp || Math.hypot(x - tx, z - tz) < 0.95 || !this.los(a.x, a.z, x, z, 0.1)) continue;
      const pts = new Float32Array([a.x, a.z, (a.x + x) / 2, (a.z + z) / 2, x, z]); a.count.aside++;
      a.path = { pts, n: 3, len: d }; a.pi = 0; a.goalX = x; a.goalZ = z; a.speedGoal = a.trot; a.goal = null;
      a.onArrive = () => this.pause(a, 'idle', 1.5 + this.rnd() * 2.5);
      a.state = a.mode === 'sit' || a.mode === 'lie' ? 'rise' : 'flee'; a.mode = 'idle'; a.st = 0; a.stuck = 0;
      if (a.state === 'rise') a.st = 0.35;
      return true;
    }
    return false;
  }
  walkTo(a, x, z, onArrive, speed) {
    const t0 = now(); let pts = null;
    if (this.los(a.x, a.z, x, z, NAV_R)) {
      const L = Math.hypot(x - a.x, z - a.z), n = Math.max(2, Math.ceil(L / 0.1) + 1); pts = new Float32Array(n * 2);
      for (let k = 0; k < n; k++) { const t = k / (n - 1); pts[2 * k] = a.x + (x - a.x) * t; pts[2 * k + 1] = a.z + (z - a.z) * t; }
    } else {
      const p = navPath(this.grid, a.x, a.z, x, z);
      if (p) { const n = Math.max(2, Math.ceil(p.length / 0.1) + 1), sp = p.curve.getSpacedPoints(n - 1); pts = new Float32Array(n * 2); for (let k = 0; k < n; k++) { pts[2 * k] = sp[k].x; pts[2 * k + 1] = sp[k].z; } }
    }
    this.stats.plans++; this.stats.planMs += now() - t0;
    if (!pts) return false;
    let len = 0; for (let k = 1; k < pts.length / 2; k++) len += Math.hypot(pts[2 * k] - pts[2 * k - 2], pts[2 * k + 1] - pts[2 * k - 1]);
    a.count.walks++; a.path = { pts, n: pts.length / 2, len }; a.pi = 0; a.goalX = x; a.goalZ = z; a.onArrive = onArrive; a.speedGoal = speed ?? a.walk; a.stuck = 0; a.block = 0;
    const low = a.mode === 'sit' || a.mode === 'lie' || a.petPose === 'sit';
    if ((a.state === 'pause' || a.state === 'pet' || a.state === 'attend') && low) { a.state = 'rise'; a.mode = 'idle'; a.petPose = null; } else a.state = 'walk';
    a.st = 0;
    return true;
  }
  revalidate(a) {
    if (!a.perch && a.state !== 'jump' && this.clear(a.x, a.z) < 0.05) {   // a door or a dragged chair now overlaps the pet
      const f = freeSpot(this.grid, a.x, a.z, 0.2);
      a.path = { pts: new Float32Array([a.x, a.z, f.x, f.z]), n: 2, len: Math.hypot(f.x - a.x, f.z - a.z) }; a.pi = 0; a.goalX = f.x; a.goalZ = f.z;
      a.onArrive = () => this.restPause(a); a.state = 'flee'; a.unstick = true; a.speedGoal = a.trot; a.count.unstick++; return;
    }
    if (!a.path || (a.state !== 'walk' && a.state !== 'rise')) return;
    const P = a.path;
    for (let k = a.pi; k < P.n; k++) if (this.clear(P.pts[2 * k], P.pts[2 * k + 1]) < NAV_R * 0.8) {
      const cb = a.onArrive; a.count.replan++;
      if (this.compAt(a.goalX, a.goalZ) !== this.compNear(a.x, a.z) || !this.walkTo(a, a.goalX, a.goalZ, cb, a.speedGoal)) { a.path = null; a.goal = null; this.decide(a); }
      return;
    }
  }
  walkStep(a, dt) {
    const P = a.path, s = a.s;
    if (!P) { this.decide(a); return; }
    const pts = P.pts;
    let i = a.pi;
    while (i < P.n - 1) { const d0 = (pts[2 * i] - a.x) ** 2 + (pts[2 * i + 1] - a.z) ** 2, d1 = (pts[2 * i + 2] - a.x) ** 2 + (pts[2 * i + 3] - a.z) ** 2; if (d1 <= d0 + 1e-6) i++; else break; }
    a.pi = i;
    const ex = pts[2 * P.n - 2], ez = pts[2 * P.n - 1], dEnd = Math.hypot(ex - a.x, ez - a.z);
    if (dEnd < 0.08 || (i >= P.n - 1 && dEnd < 0.2)) { a.path = null; a.v = 0; a.unstick = false; s.speed = 0; s.turn = 0; s.mode = 'idle'; a.state = 'pause'; a.st = 0; a.dur = 0.5; const f = a.onArrive; a.onArrive = null; f ? f() : this.restPause(a); return; }
    const look = Math.min(P.n - 1, i + 3), cx = pts[2 * look], cz = pts[2 * look + 1];
    const want = Math.atan2(cx - a.x, cz - a.z), d = wrapA(want - a.yaw);
    a.turn += (clamp(d * 3.2, -2.2, 2.2) - a.turn) * (1 - Math.exp(-dt * 9)); a.yaw += a.turn * dt;
    let vt = a.speedGoal * (1 - 0.88 * clamp((Math.abs(d) - 0.45) / 0.9, 0, 1)) * clamp(dEnd / 0.45, 0.25, 1);
    // the other pet ahead: wait, then give up on this leg
    const o = a.other;
    if (o) { const ox = o.x - a.x, oz = o.z - a.z, od = Math.hypot(ox, oz); if (od < 1.0 && (ox * Math.sin(a.yaw) + oz * Math.cos(a.yaw)) / od > 0.3) vt *= clamp((od - 0.62) / 0.35, 0, 1); }
    a.v += clamp(vt - a.v, -1.6 * dt, 0.9 * dt);
    const nx = a.x + Math.sin(a.yaw) * a.v * dt, nz = a.z + Math.cos(a.yaw) * a.v * dt;
    const okWall = a.unstick || this.clear(nx, nz) >= Math.min(0.085, this.clear(a.x, a.z) + 0.002);
    const okPet = !o || Math.hypot(o.x - nx, o.z - nz) >= Math.min(0.6, Math.hypot(o.x - a.x, o.z - a.z) + 1e-4);
    if (okWall && okPet && a.v > 0.003) { a.x = nx; a.z = nz; a.stuck = 0; }
    else { a.stuck += dt; if (!okWall || !okPet) a.v *= 0.5; }
    if (a.unstick && this.clear(a.x, a.z) > 0.12) a.unstick = false;
    if (a.stuck > 1.6) { a.path = null; a.stuck = 0; a.goal = null; if (!okPet) this.stepAside(a, o.x, o.z) || this.wander(a); else this.wander(a); return; }
    if (a.call && this.t - a.call.at > 0.8) { const pl = this.player.pos; if (Math.hypot(pl.x - a.call.px, pl.z - a.call.pz) > 1.0) { this.startCall(a, true); return; } }
    if (a.followUntil > this.t && this.t - a.followAt > 1.6 && this.player) { const pl = this.player.pos; if (Math.hypot(pl.x - a.goalX, pl.z - a.goalZ) > 1.9) { this.follow(a); return; } }
    s.mode = 'walk'; s.speed = a.v; s.turn = a.turn;
  }
  // ---- the player: "Pet the …" (picked with a capsule round each pet, never the fur) and the HUD call buttons
  pick(ray, maxDist) {
    let best = null; const pl = this.player?.pos, o = ray.origin, d = ray.direction;
    for (const a of this.agents) {
      if (!pl || a.hold || Math.hypot(pl.x - a.x, pl.z - a.z) > 1.3) continue;
      const c = Math.cos(a.yaw), sn = Math.sin(a.yaw), b = a.pickBox, px = o.x - a.x, pz = o.z - a.z;
      const z0 = b[2] - (a.mode === 'lie' ? 0.16 : a.mode === 'sit' || a.state === 'attend' ? 0.1 : 0);
      const lo = this._lo ??= new Float64Array(3), ld = this._ld ??= new Float64Array(3);   // ray in root space (yaw only)
      lo[0] = px * c - pz * sn; lo[1] = o.y - a.y; lo[2] = px * sn + pz * c; ld[0] = d.x * c - d.z * sn; ld[1] = d.y; ld[2] = d.x * sn + d.z * c;
      let t0 = 0, t1 = maxDist;
      for (let k = 0; k < 3 && t0 <= t1; k++) {
        const pad = k === 1 ? 0.02 : 0.04, mn = (k === 2 ? z0 : b[k]) - pad, mx = b[k + 3] + pad;
        if (Math.abs(ld[k]) < 1e-9) { if (lo[k] < mn || lo[k] > mx) t0 = 1e9; continue; }
        let ta = (mn - lo[k]) / ld[k], tb = (mx - lo[k]) / ld[k]; if (ta > tb) { const sw = ta; ta = tb; tb = sw; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      }
      if (t0 <= t1 && (!best || t0 < best.dist)) best = { pet: a, dist: t0 };
    }
    return best;
  }
  label(a) { return tr(a.name === 'cat' ? 'petCat' : 'petDog'); }
  pet(a) {
    if (typeof a === 'string') a = this.get(a);
    if (!a || a.hold || a.state === 'jump') return false;
    if (a.state !== 'pet') {
      const seated = a.mode === 'sit' || a.mode === 'lie' || a.state === 'attend';
      a.path = null; a.onArrive = null; a.after = null; a.call = null; a.followUntil = 0; a.goal = null; a.state = 'pet'; a.v = 0; a.heartT = 0.35; a.petStart = this.t; a.petN++; a.petPose = seated ? 'sit' : null; this.hearts.spawn(a);
    }
    a.petUntil = this.t + 5; a.st = 0; a.excite = 1; a.count.pet++;
    return true;
  }
  call(name) {
    const a = this.get(name); if (!a || a.hold) return false;
    a.count.call++; a.followUntil = 0;
    if (a.state === 'jump' || a.perch) { a.call = { pending: true }; if (a.perch && a.state !== 'jump') this.leavePerch(a); return true; }
    return this.startCall(a);
  }
  startCall(a, again = false) {
    const sig = this.signature(); if (sig !== this.sig) { this.sig = this.sigSeen = sig; this.rebuild(); }
    const pl = this.player.pos, f = this.player.forward(), comp = this.compNear(a.x, a.z), reach = comp >= 0 && this.compNear(pl.x, pl.z) === comp;
    let spot = reach ? this.frontSpot(comp, pl.x, pl.z, Math.atan2(f.x, f.z)) : null;
    if (!spot) spot = this.nearestReachable(comp, pl.x + f.x * 0.8, pl.z + f.z * 0.8, pl.x, pl.z);
    if (!reach && !again) this.ui?.toast(tr(`${a.name}NoReach${this.blockedByDoor(a) ? 'Door' : ''}`), 3200);
    a.call = { px: pl.x, pz: pl.z, at: this.t, reach };
    if (!spot) { this.pause(a, 'idle', 2); return false; }
    const speed = a.pet.callSpeed ?? (a.name === 'dog' ? clamp(a.trot, 0.85, 1.0) : Math.max(0.5, a.walk * 1.5)), wasSit = a.mode === 'sit' || a.mode === 'lie';
    if (Math.hypot(spot.x - a.x, spot.z - a.z) < 0.25) { this.arriveCall(a); return true; }
    if (wasSit && a.state !== 'rise') { a.state = 'pause'; }
    if (!this.walkTo(a, spot.x, spot.z, () => this.arriveCall(a), speed)) { this.pause(a, 'idle', 2); return false; }
    return true;
  }
  arriveCall(a) {
    const pl = this.player.pos;
    this.turn(a, Math.atan2(pl.x - a.x, pl.z - a.z), () => { a.state = 'attend'; a.mode = 'sit'; a.st = 0; a.dur = 12 + this.rnd() * 8; if (a.call) { a.call.at = this.t; a.call.px = pl.x; a.call.pz = pl.z; } });
  }
  // A free spot ~0.8 m from the player, as near the view direction as possible and in plain sight of the player.
  frontSpot(comp, px, pz, yaw) {
    for (const d of [0.8, 1.0, 0.65, 1.3, 1.6]) for (const da of [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2.0, -2.0, 2.6, -2.6, Math.PI]) {
      const x = px + Math.sin(yaw + da) * d, z = pz + Math.cos(yaw + da) * d;
      if (this.clear(x, z) >= 0.2 && this.compAt(x, z) === comp && this.los(px, pz, x, z, 0.06)) return { x, z };
    }
    return null;
  }
  // Closest cell of the pet's own grid component to (x, z) (ties go to the one nearest the player).
  nearestReachable(comp, x, z, px, pz) {
    let best = null, bd = 1e18; const clr = this.grid.clr;
    for (let j = 0; j < NZ; j += 2) for (let i = 0; i < NX; i += 2) {
      const k = j * NX + i; if (this.comp[k] !== comp || clr[k] < 0.22) continue;
      const cx = X0 + (i + 0.5) * CELL, cz = Z0 + (j + 0.5) * CELL; if ((cx - px) ** 2 + (cz - pz) ** 2 < 0.3) continue;
      const dd = (cx - x) ** 2 + (cz - z) ** 2 + 0.2 * ((cx - px) ** 2 + (cz - pz) ** 2);
      if (dd < bd) { bd = dd; best = { x: cx, z: cz }; }
    }
    return best;
  }
  // Would the pet reach the player if every door were open? (a grid with passable leaves, flood-filled from the pet)
  blockedByDoor(a) {
    const g = buildGrid(BOUNDS.concat(this.player?.extraColliders?.() ?? []), { doors: false }), clr = g.clr, q = this.queue, seen = new Uint8Array(clr.length);
    const cell = (x, z) => clamp(Math.floor((z - Z0) / CELL), 0, NZ - 1) * NX + clamp(Math.floor((x - X0) / CELL), 0, NX - 1);
    const goal = cell(this.player.pos.x, this.player.pos.z); let head = 0, tail = 0; q[tail++] = cell(a.x, a.z); seen[q[0]] = 1;
    while (head < tail) {
      const k = q[head++]; if (Math.abs((k % NX) - (goal % NX)) <= 3 && Math.abs(((k / NX) | 0) - ((goal / NX) | 0)) <= 3) return true;
      for (const n of [k - 1, k + 1, k - NX, k + NX]) if (n >= 0 && n < clr.length && !seen[n] && clr[n] >= NAV_R) { seen[n] = 1; q[tail++] = n; }
    }
    return false;
  }
  // tests / screenshots: pin a pet (pose, place) or hand it back to the behaviour loop; what the pets avoid; area labels
  obstacles() { return HOUSE.getColliders().concat(this.extras()); }
  hold(name, h) { const a = this.get(name); if (a) a.hold = { ...h }; return a; }
  release(name) { const a = this.get(name); if (a) { a.hold = null; a.perch = null; a.path = null; this.pause(a, 'idle', 1); } }
  dispose() { for (const a of this.agents) a.pet.dispose?.(); this.agents.length = 0; }
}

// A few floating hearts over a petted pet: one Points draw call, only while some are alive.
function makeHearts(scene) {
  const N = 8, pos = new Float32Array(N * 3), col = new Float32Array(N * 4), life = new Float32Array(N).fill(-1), vel = new Float32Array(N * 3);
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  g.fillStyle = '#ff5f7e'; g.beginPath(); g.moveTo(32, 56); g.bezierCurveTo(4, 36, 6, 10, 22, 10); g.bezierCurveTo(28, 10, 32, 16, 32, 20); g.bezierCurveTo(32, 16, 36, 10, 42, 10); g.bezierCurveTo(58, 10, 60, 36, 32, 56); g.fill();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.075, map: tex, vertexColors: true, transparent: true, depthWrite: false, alphaTest: 0.02 }));
  pts.frustumCulled = false; pts.visible = false; pts.name = 'pet-hearts'; pts.renderOrder = 3; scene.add(pts);
  let next = 0;
  return {
    spawn(a) {
      const i = next, f = 0.16; next = (next + 1) % N;
      pos[3 * i] = a.x + Math.sin(a.yaw) * f + (Math.random() - 0.5) * 0.08; pos[3 * i + 1] = a.y + a.pickBox[4] + 0.02; pos[3 * i + 2] = a.z + Math.cos(a.yaw) * f + (Math.random() - 0.5) * 0.08;
      vel[3 * i] = (Math.random() - 0.5) * 0.06; vel[3 * i + 1] = 0.2 + Math.random() * 0.08; vel[3 * i + 2] = (Math.random() - 0.5) * 0.06; life[i] = 0; pts.visible = true;
    },
    tick(dt) {
      if (!pts.visible) return; let alive = 0;
      for (let i = 0; i < N; i++) {
        if (life[i] < 0) { col[4 * i + 3] = 0; continue; }
        life[i] += dt / 1.6; if (life[i] >= 1) { life[i] = -1; col[4 * i + 3] = 0; continue; }
        alive++; for (let k = 0; k < 3; k++) pos[3 * i + k] += vel[3 * i + k] * dt;
        col[4 * i] = col[4 * i + 1] = col[4 * i + 2] = 1; col[4 * i + 3] = Math.min(1, life[i] * 6) * (1 - life[i]) ** 0.7;
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; pts.visible = alive > 0;
    },
  };
}
