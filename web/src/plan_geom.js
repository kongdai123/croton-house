// Rectilinear polygon helpers in plan metres (x east, y north), shared by the plan reader (plan.js) and its builder
// (tools/build_plan.mjs). bake/scripts/plan.py mirrors every function with the same arithmetic, so the two readers give
// bit-identical answers on web/tools/golden/plan_vectors.json. Polygons are [[x, y], ...], implicitly closed.

// Plan data is 0.1 mm: offsets and decompositions are snapped to it (integer maths, so JS and Python round the same).
export const q4 = v => Math.round(v * 1e4) / 1e4;

export function bbox(P) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of P) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, x1, y0, y1 };
}
export function signedArea(P) { let a = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) a += (P[j][0] - P[i][0]) * (P[j][1] + P[i][1]); return a / 2; }

// Drop repeated and collinear vertices, wind counter-clockwise.
export function clean(P) {
  let pts = P.map(([x, y]) => [q4(x), q4(y)]).filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
  while (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop();
  for (let changed = true; changed && pts.length > 3;) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) { pts.splice(i, 1); changed = true; break; }
    }
  }
  return signedArea(pts) < 0 ? pts.reverse() : pts;
}
export const rectilinear = P => P.every((p, i) => { const q = P[(i + 1) % P.length]; return p[0] === q[0] || p[1] === q[1]; });

// Point on the boundary or inside (crossing test). Inclusive, so a lattice point on a shared edge belongs to the first
// space in plan order, and a rect space keeps the closed x0 <= x <= x1 test the old rect tables used.
export function onBoundary(x, y, P) {
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [ax, ay] = P[j], [bx, by] = P[i];
    if (ax === bx ? x === ax && y >= Math.min(ay, by) && y <= Math.max(ay, by) : y === ay && x >= Math.min(ax, bx) && x <= Math.max(ax, bx)) return true;
  }
  return false;
}
export function inPoly(x, y, P) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const xi = P[i][0], yi = P[i][1], xj = P[j][0], yj = P[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c || onBoundary(x, y, P);
}

// Chebyshev (L-infinity) distance to the boundary: on a rectangle this is exactly min(x - x0, x1 - x, y - y0, y1 - y)
// inside, which is what lighting.js's indoor ramp used. Euclidean distance (dist) is for "nearest space" lookups.
export function chebyshev(x, y, P) {
  let best = Infinity;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [ax, ay] = P[j], [bx, by] = P[i];
    const dx = Math.max(Math.min(ax, bx) - x, 0, x - Math.max(ax, bx)), dy = Math.max(Math.min(ay, by) - y, 0, y - Math.max(ay, by));
    const d = Math.max(dx, dy); if (d < best) best = d;
  }
  return best;
}
export function dist(x, y, P) {
  if (inPoly(x, y, P)) return 0;
  let best = Infinity;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [ax, ay] = P[j], [bx, by] = P[i];
    const dx = Math.max(Math.min(ax, bx) - x, 0, x - Math.max(ax, bx)), dy = Math.max(Math.min(ay, by) - y, 0, y - Math.max(ay, by));
    const d = Math.sqrt(dx * dx + dy * dy); if (d < best) best = d;
  }
  return best;
}

// Outward offset of a counter-clockwise rectilinear polygon by m (the Minkowski sum with a 2m square, i.e. the outline
// "dilated by a margin"), in 0.1 mm integers. Each vertex joins one horizontal and one vertical edge: move each edge
// along its outward normal and take the corner of the two moved lines.
export function offset(P, m) {
  const n = P.length, k = Math.round(m * 1e4), I = P.map(([x, y]) => [Math.round(x * 1e4), Math.round(y * 1e4)]), out = [];
  for (let i = 0; i < n; i++) {
    const a = I[(i + n - 1) % n], b = I[i], c = I[(i + 1) % n];
    // CCW: outward normal of edge p->q is (dy, -dx) normalised
    const shift = (p, q) => [Math.sign(q[1] - p[1]) * k, -Math.sign(q[0] - p[0]) * k];
    const s1 = shift(a, b), s2 = shift(b, c);
    const x = a[0] === b[0] ? b[0] + s1[0] : b[0] + s2[0], y = a[1] === b[1] ? b[1] + s1[1] : b[1] + s2[1];
    out.push([x / 1e4, y / 1e4]);
  }
  return out;
}

// Vertical-slab decomposition into closed rects {x0, x1, y0, y1}; neighbouring slabs with the same spans are merged.
export function rects(P) {
  const xs = [...new Set(P.map(p => p[0]))].sort((a, b) => a - b), out = [];
  let prev = [];
  for (let s = 0; s + 1 < xs.length; s++) {
    const xm = (xs[s] + xs[s + 1]) / 2, ys = [];
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) if (P[i][1] === P[j][1] && Math.min(P[i][0], P[j][0]) < xm && Math.max(P[i][0], P[j][0]) > xm) ys.push(P[i][1]);
    ys.sort((a, b) => a - b);
    const spans = []; for (let k = 0; k + 1 < ys.length; k += 2) spans.push([ys[k], ys[k + 1]]);
    const same = spans.length === prev.length && spans.every((sp, k) => sp[0] === prev[k].y0 && sp[1] === prev[k].y1);
    if (same) for (const r of prev) r.x1 = xs[s + 1];
    else { prev = spans.map(([y0, y1]) => ({ x0: xs[s], x1: xs[s + 1], y0, y1 })); out.push(...prev); }
  }
  return out;
}
const rectOverlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
export const overlapArea = (A, B) => { let s = 0; for (const a of rects(A)) for (const b of rects(B)) s += rectOverlap(a, b); return s; };
export const area = P => Math.abs(signedArea(P));

// Number formatting for generated GLSL: shortest round-trip of the 0.1 mm value, always with a decimal point.
export const glslNum = v => { const s = String(q4(v)); return /[.e]/.test(s) ? s : s + '.0'; };
