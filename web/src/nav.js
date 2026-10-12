// Walkable-space grid for camera flights: a clearance field from the colliders, A* that prefers the middle of rooms and
// doorways, then string-pulling + relaxation into a smooth curve. The camera body is tiny (R) so it slips through doors.
import { THREE } from './kit.js';
import { getColliders, getDoors } from './house.js';

const CELL = 0.1, X0 = -20, Z0 = -24, NX = 400, NZ = 440;   // world X -20..20, Z -24..20
export const NAV_R = 0.13;
const ix = (x) => Math.max(0, Math.min(NX - 1, Math.floor((x - X0) / CELL)));
const iz = (z) => Math.max(0, Math.min(NZ - 1, Math.floor((z - Z0) / CELL)));
const cx = (i) => X0 + (i + 0.5) * CELL, cz = (j) => Z0 + (j + 0.5) * CELL;

// Footprint of every swinging leaf in its open pose (hinged doors and each French leaf), so routes pass through the clear
// part of a doorway instead of where a leaf will stand.
const _box = new THREE.Box3();
function openLeafRects() {
  const out = [];
  for (const d of getDoors()) {
    const leaves = d.pivot ? [[d.pivot, d.openAngle ?? 1.35]] : d.kind === 'french' ? d.leaves.map(l => [l.pivot, (l.hingeLeft ? -1 : 1) * 1.65]) : [];
    for (const [p, a] of leaves) {
      const r0 = p.rotation.y; p.rotation.y = a; p.updateMatrixWorld(true); _box.setFromObject(p);
      p.rotation.y = r0; p.updateMatrixWorld(true);
      out.push({ x0: _box.min.x, x1: _box.max.x, z0: _box.min.z, z1: _box.max.z, tag: 'leaf-open' });
    }
  }
  return out;
}
// Door leaves are passable by default: flights open doors as they reach them (viewpoints.js), and the open-leaf footprints are
// obstacles instead. doors: true keeps closed leaves solid (the actual current state).
export function buildGrid(extra = [], { doors = false } = {}) {
  const clr = new Float32Array(NX * NZ).fill(1e6);
  for (const c of getColliders().concat(extra, doors ? [] : openLeafRects())) {
    if (!doors && /^(hinged|french|bifold)-/.test(c.tag)) continue;
    const [x0, x1, z0, z1] = c.circle ? [c.x - c.r, c.x + c.r, c.z - c.r, c.z + c.r] : [c.x0, c.x1, c.z0, c.z1];
    for (let j = iz(z0); j <= iz(z1); j++) for (let i = ix(x0); i <= ix(x1); i++) clr[j * NX + i] = 0;
  }
  // two-pass chamfer distance (cells), then metres
  const D = 1, DD = Math.SQRT2;
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i; let v = clr[k];
    if (i > 0) v = Math.min(v, clr[k - 1] + D);
    if (j > 0) { v = Math.min(v, clr[k - NX] + D); if (i > 0) v = Math.min(v, clr[k - NX - 1] + DD); if (i < NX - 1) v = Math.min(v, clr[k - NX + 1] + DD); }
    clr[k] = v;
  }
  for (let j = NZ - 1; j >= 0; j--) for (let i = NX - 1; i >= 0; i--) {
    const k = j * NX + i; let v = clr[k];
    if (i < NX - 1) v = Math.min(v, clr[k + 1] + D);
    if (j < NZ - 1) { v = Math.min(v, clr[k + NX] + D); if (i < NX - 1) v = Math.min(v, clr[k + NX + 1] + DD); if (i > 0) v = Math.min(v, clr[k + NX - 1] + DD); }
    clr[k] = v;
  }
  for (let k = 0; k < clr.length; k++) clr[k] *= CELL;
  const at = (x, z) => clr[iz(z) * NX + ix(x)];
  return { clr, at, free: (x, z, r = NAV_R) => at(x, z) >= r };
}

// Largest distance (<= max) the camera can travel from (x,z) along (dx,dz) without entering the clearance margin.
export function freeRun(grid, x, z, dx, dz, max, r = NAV_R + 0.05) {
  for (let s = 0.05; s <= max; s += 0.05) if (grid.at(x + dx * s, z + dz * s) < r) return Math.max(0, s - 0.1);
  return max;
}

// Nearest world point to (x,z) with at least r of clearance (ring search, 5 cm steps, up to 1.5 m away).
export function freeSpot(grid, x, z, r = 0.25) {
  if (grid.at(x, z) >= r) return { x, z };
  for (let rad = 0.05; rad <= 1.5; rad += 0.05) {
    const n = Math.max(8, Math.round(rad * 60));
    for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2, px = x + Math.cos(a) * rad, pz = z + Math.sin(a) * rad; if (grid.at(px, pz) >= r) return { x: px, z: pz }; }
  }
  return { x, z };
}

function nearestFree(grid, i, j) {
  if (grid.clr[j * NX + i] >= NAV_R) return [i, j];
  for (let rad = 1; rad < 20; rad++) {
    let best = null, bd = -1;
    for (let dj = -rad; dj <= rad; dj++) for (let di = -rad; di <= rad; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== rad) continue;
      const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= NX || b >= NZ) continue;
      const v = grid.clr[b * NX + a]; if (v >= NAV_R && v > bd) { bd = v; best = [a, b]; }
    }
    if (best) return best;
  }
  return null;
}

// A* over the grid; cost rises near obstacles so the route keeps to the middle of corridors and doorways.
function astar(grid, s, g) {
  const N = NX * NZ, G = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const heap = [], push = (k, f) => { heap.push([f, k]); let n = heap.length - 1; while (n > 0) { const p = (n - 1) >> 1; if (heap[p][0] <= heap[n][0]) break; [heap[p], heap[n]] = [heap[n], heap[p]]; n = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let n = 0; for (;;) { const l = 2 * n + 1, r = l + 1; let m = n; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === n) break; [heap[m], heap[n]] = [heap[n], heap[m]]; n = m; } } return top; };
  const [gi, gj] = g, h = (i, j) => { const dx = Math.abs(i - gi), dz = Math.abs(j - gj); return (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)); };
  const sk = s[1] * NX + s[0], gk = gj * NX + gi; G[sk] = 0; push(sk, h(...s));
  const nb = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  let n = 0;
  while (heap.length && n++ < 250000) {
    const [, k] = pop(); if (closed[k]) continue; closed[k] = 1;
    if (k === gk) break;
    const i = k % NX, j = (k / NX) | 0;
    for (const [di, dj, w] of nb) {
      const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= NX || b >= NZ) continue;
      const kk = b * NX + a, c = grid.clr[kk]; if (closed[kk] || c < NAV_R) continue;
      const cost = w * (1 + 3 * Math.max(0, 0.5 - c) / 0.5), ng = G[k] + cost;
      if (ng < G[kk]) { G[kk] = ng; from[kk] = k; push(kk, ng + h(a, b)); }
    }
  }
  if (from[gk] < 0 && gk !== sk) return null;
  const cells = []; for (let k = gk; k >= 0; k = from[k]) { cells.push(k); if (k === sk) break; }
  return cells.reverse();
}

const los = (grid, a, b, need) => { const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(L / (CELL * 0.5)); for (let s = 0; s <= n; s++) { const t = s / n; if (grid.at(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t) < need) return false; } return true; };

// Smooth route from (ax,az) to (bx,bz) in world XZ. Returns { curve, length } or null (fall back to a straight line).
export function navPath(grid, ax, az, bx, bz) {
  const s = nearestFree(grid, ix(ax), iz(az)), g = nearestFree(grid, ix(bx), iz(bz));
  if (!s || !g) return null;
  const cells = astar(grid, s, g); if (!cells) return null;
  const raw = cells.map(k => ({ x: cx(k % NX), z: cz((k / NX) | 0), c: grid.clr[k] }));
  raw[0] = { ...raw[0], x: ax, z: az }; raw[raw.length - 1] = { ...raw[raw.length - 1], x: bx, z: bz };
  // string-pull, never tighter than the A* route itself (capped at 0.35 m of clearance)
  const pts = [raw[0]];
  for (let i = 0; i < raw.length - 1;) {
    const inner = new Float32Array(raw.length); inner[i + 1] = Infinity;   // inner[j] = min clearance strictly between i and j
    for (let k = i + 2; k < raw.length; k++) inner[k] = Math.min(inner[k - 1], raw[k - 1].c);
    let j = raw.length - 1;
    for (; j > i + 1; j--) if (los(grid, raw[i], raw[j], Math.min(0.35, inner[j], Math.max(NAV_R, Math.min(raw[i].c, raw[j].c))))) break;
    pts.push(raw[j]); i = j;
  }
  // densify, then relax corners into arcs while staying in free space
  let dense = [];
  for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.25)); for (let k = 0; k < n; k++) dense.push({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n }); }
  dense.push({ x: bx, z: bz });
  for (let it = 0; it < 12; it++) for (let k = 1; k < dense.length - 1; k++) {
    const p = dense[k], nx = 0.5 * p.x + 0.25 * (dense[k - 1].x + dense[k + 1].x), nz = 0.5 * p.z + 0.25 * (dense[k - 1].z + dense[k + 1].z);
    if (grid.at(nx, nz) >= NAV_R + 0.02) { p.x = nx; p.z = nz; }
  }
  if (dense.length < 2) return null;
  const curve = new THREE.CatmullRomCurve3(dense.map(p => new THREE.Vector3(p.x, 0, p.z)), false, 'centripetal');
  return { curve, length: curve.getLength() };
}
