(() => {
  // app-three:kit
  var THREE = window.__app.THREE;

  // src/pets/dog.js
  var SHELLS = 32;
  var CARD_SEG = 5;
  var TAU = Math.PI * 2;
  var clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  var sstep = (a, b, v) => {
    const t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  var mix = (a, b, t) => a + (b - a) * t;
  var wrap = (a) => a - TAU * Math.round(a / TAU);
  var frac = (x) => x - Math.floor(x);
  function rng(seed) {
    return () => {
      seed = seed + 1831565813 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hash3(x, y, z) {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177) | 0;
    h = Math.imul(h ^ h >>> 13, 1274126177);
    return ((h ^ h >>> 16) >>> 0) / 4294967296;
  }
  function vnoise(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let fx = x - xi, fy = y - yi, fz = z - zi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    fz = fz * fz * (3 - 2 * fz);
    const h = (i, j, k) => hash3(xi + i, yi + j, zi + k);
    return mix(mix(mix(h(0, 0, 0), h(1, 0, 0), fx), mix(h(0, 1, 0), h(1, 1, 0), fx), fy), mix(mix(h(0, 0, 1), h(1, 0, 1), fx), mix(h(0, 1, 1), h(1, 1, 1), fx), fy), fz);
  }
  var BONE_DEFS = [
    ["root", null, 0, 0, 0],
    ["hips", "root", 0, 0.165, -0.072],
    ["spine", "hips", 0, 0.172, -8e-3],
    ["chest", "spine", 0, 0.17, 0.05],
    ["neck", "chest", 0, 0.19, 0.1],
    ["head", "neck", 0, 0.234, 0.128],
    ["ear1_L", "head", 0.04, 0.274, 0.15],
    ["ear2_L", "ear1_L", 0.048, 0.248, 0.152],
    ["ear1_R", "head", -0.04, 0.274, 0.15],
    ["ear2_R", "ear1_R", -0.048, 0.248, 0.152]
  ];
  var TAIL = [[0, 0.18, -0.124], [0, 0.205, -0.138], [0, 0.23, -0.14], [0, 0.251, -0.128], [0, 0.263, -0.107], [0, 0.266, -0.084]];
  TAIL.slice(0, 5).forEach((p, i) => BONE_DEFS.push([`tail${i + 1}`, i ? `tail${i}` : "hips", ...p]));
  var LEG = {
    f: [[0.036, 0.135, 0.078], [0.04, 0.09, 0.064], [0.04, 0.036, 0.071], [0.04, 0.013, 0.076], [0.04, 0.01, 0.097]],
    h: [[0.032, 0.146, -0.085], [0.04, 0.1, -0.06], [0.042, 0.043, -0.098], [0.042, 0.013, -0.088], [0.042, 0.01, -0.067]]
  };
  for (const k of ["f", "h"]) for (const [s, n] of [[1, "L"], [-1, "R"]]) LEG[k].slice(0, 4).forEach(([x, y, z], i) => BONE_DEFS.push([`${k}${i + 1}_${n}`, i ? `${k}${i}_${n}` : k === "f" ? "chest" : "hips", s * x, y, z]));
  var NB = BONE_DEFS.length;
  var NP = NB * 3 + 3;
  var IDX = Object.fromEntries(BONE_DEFS.map((b, i) => [b[0], i]));
  var GRP = BONE_DEFS.map(([n]) => n.startsWith("ear") ? "ear" : n === "head" ? "head" : n === "neck" ? "neck" : n.startsWith("tail") ? "tail" : /^[fh]\d/.test(n) ? "leg" : "body");
  var LEGS = [];
  for (const k of ["f", "h"]) for (const [s, n] of [[1, "L"], [-1, "R"]]) {
    const J = LEG[k], seg = [0, 1, 2, 3].map((i) => [J[i + 1][1] - J[i][1], J[i + 1][2] - J[i][2]]);
    LEGS.push({ k, s, b: [1, 2, 3, 4].map((i) => IDX[`${k}${i}_${n}`]), len: seg.map(([a, b]) => Math.hypot(a, b)), rest: seg.map(([a, b]) => Math.atan2(b, a)), J1: [J[0][1], J[0][2]], foot: [J[3][1], J[3][2]], bend: k === "f" ? 1 : -1 });
  }
  var PR = [];
  var E = (bone, c, r, k) => PR.push({ t: 0, b: IDX[bone], c, r, k, lo: c.map((v, i) => v - r[i]), hi: c.map((v, i) => v + r[i]) });
  var C = (bone, a, b, ra, rb, k) => {
    const ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l2 = ba[0] ** 2 + ba[1] ** 2 + ba[2] ** 2, rr = ra - rb;
    PR.push({ t: 1, b: IDX[bone], a, ba, l2, rr, a2: l2 - rr * rr, il2: 1 / l2, ra, rb, k, lo: a.map((v, i) => Math.min(v - ra, b[i] - rb)), hi: a.map((v, i) => Math.max(v + ra, b[i] + rb)) });
  };
  E("hips", [0, 0.152, -0.085], [0.049, 0.046, 0.05], 0.02);
  E("spine", [0, 0.15, -0.015], [0.046, 0.045, 0.055], 0.03);
  E("chest", [0, 0.146, 0.048], [0.05, 0.051, 0.054], 0.03);
  E("chest", [0, 0.132, 0.084], [0.035, 0.037, 0.03], 0.02);
  C("neck", [0, 0.176, 0.085], [0, 0.238, 0.138], 0.037, 0.032, 0.02);
  E("head", [0, 0.258, 0.155], [0.041, 0.039, 0.041], 0.016);
  E("head", [0, 0.242, 0.17], [0.039, 0.029, 0.03], 0.012);
  E("head", [0, 0.237, 0.19], [0.02, 0.016, 0.016], 8e-3);
  E("head", [0, 0.224, 0.18], [0.016, 0.012, 0.014], 8e-3);
  for (const [s, n] of [[1, "L"], [-1, "R"]]) {
    E(`ear1_${n}`, [s * 0.044, 0.259, 0.151], [8e-3, 0.018, 0.02], 5e-3);
    E(`ear2_${n}`, [s * 0.05, 0.234, 0.153], [7e-3, 0.017, 0.019], 4e-3);
    for (const k of ["f", "h"]) {
      const J = LEG[k].map(([x, y, z]) => [s * x, y, z]), r = k === "f" ? [0.02, 0.015, 0.013, 0.011, 0.01, 0.011] : [0.02, 0.016, 0.014, 0.01, 9e-3, 0.01];
      C(`${k}1_${n}`, J[0], J[1], r[0], r[1], 0.016);
      C(`${k}2_${n}`, J[1], J[2], r[2], r[3], 0.01);
      C(`${k}3_${n}`, J[2], J[3], r[4], r[5], 8e-3);
      E(`${k}4_${n}`, [J[3][0], 0.011, J[3][2] + 8e-3], [0.013, 9e-3, 0.017], 8e-3);
    }
  }
  [0.011, 0.01, 9e-3, 8e-3, 7e-3, 55e-4].slice(0, 5).forEach((r, i, a) => C(`tail${i + 1}`, TAIL[i], TAIL[i + 1], r, a[i + 1] ?? 55e-4, 8e-3));
  for (const P of PR) {
    P.bc = P.lo.map((v, i) => (v + P.hi[i]) / 2);
    P.br = Math.hypot(...P.hi.map((v, i) => (v - P.lo[i]) / 2));
  }
  function primDist(P, x, y, z) {
    if (P.t === 0) {
      const r = P.r, px = (x - P.c[0]) / r[0], py = (y - P.c[1]) / r[1], pz = (z - P.c[2]) / r[2];
      const k0 = Math.sqrt(px * px + py * py + pz * pz), qx = px / r[0], qy = py / r[1], qz = pz / r[2], k1 = Math.sqrt(qx * qx + qy * qy + qz * qz);
      return k1 < 1e-9 ? -Math.min(r[0], r[1], r[2]) : k0 * (k0 - 1) / k1;
    }
    const { a, ba, l2, rr, a2, il2 } = P, pax = x - a[0], pay = y - a[1], paz = z - a[2];
    const yy = pax * ba[0] + pay * ba[1] + paz * ba[2], zz = yy - l2;
    const xx = pax * l2 - ba[0] * yy, xy = pay * l2 - ba[1] * yy, xz = paz * l2 - ba[2] * yy, x2 = xx * xx + xy * xy + xz * xz;
    const y2 = yy * yy * l2, z2 = zz * zz * l2, k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - P.rb;
    if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - P.ra;
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - P.ra;
  }
  var smin = (a, b, k) => {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
  };
  function sdf(x, y, z) {
    let d = 0.05;
    for (const P of PR) {
      const dx = x - P.bc[0], dy = y - P.bc[1], dz = z - P.bc[2];
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) - P.br > d + P.k) continue;
      d = smin(d, primDist(P, x, y, z), P.k);
    }
    return d;
  }
  function surfaceNets(hs) {
    const o = [-0.072, -6e-3, -0.178], nx = Math.ceil(0.144 / hs) + 1, ny = Math.ceil(0.316 / hs) + 1, nz = Math.ceil(0.41 / hs) + 1;
    const F = new Float32Array(nx * ny * nz).fill(0.05);
    for (const P of PR) {
      const m = P.k + 2 * hs, r = (v2, i, lo) => clamp(Math[lo ? "floor" : "ceil"]((v2 - o[i]) / hs), 0, [nx, ny, nz][i] - 1);
      const i0 = r(P.lo[0] - m, 0, 1), i1 = r(P.hi[0] + m, 0), j0 = r(P.lo[1] - m, 1, 1), j1 = r(P.hi[1] + m, 1), k0 = r(P.lo[2] - m, 2, 1), k1 = r(P.hi[2] + m, 2);
      for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const id = i + nx * (j + ny * k);
        F[id] = smin(F[id], primDist(P, o[0] + i * hs, o[1] + j * hs, o[2] + k * hs), P.k);
      }
    }
    const CO = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
    const ED = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    const cx = nx - 1, cy = ny - 1, cell = new Int32Array(cx * cy * (nz - 1)).fill(-1), pos = [], v = new Float32Array(8);
    for (let k = 0; k < nz - 1; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
      let mask = 0;
      for (let c = 0; c < 8; c++) {
        v[c] = F[i + CO[c][0] + nx * (j + CO[c][1] + ny * (k + CO[c][2]))];
        if (v[c] < 0) mask |= 1 << c;
      }
      if (mask === 0 || mask === 255) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const [a, b] of ED) if (v[a] < 0 !== v[b] < 0) {
        const t = v[a] / (v[a] - v[b]);
        sx += CO[a][0] + t * (CO[b][0] - CO[a][0]);
        sy += CO[a][1] + t * (CO[b][1] - CO[a][1]);
        sz += CO[a][2] + t * (CO[b][2] - CO[a][2]);
        n++;
      }
      cell[i + cx * (j + cy * k)] = pos.length / 3;
      pos.push(o[0] + (i + sx / n) * hs, o[1] + (j + sy / n) * hs, o[2] + (k + sz / n) * hs);
    }
    const quads = [], Ci = (i, j, k) => cell[i + cx * (j + cy * k)];
    for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const id = i + nx * (j + ny * k), f0 = F[id] < 0;
      if (f0 !== F[id + 1] < 0) quads.push(Ci(i, j - 1, k - 1), Ci(i, j, k - 1), Ci(i, j, k), Ci(i, j - 1, k));
      if (f0 !== F[id + nx] < 0) quads.push(Ci(i - 1, j, k - 1), Ci(i - 1, j, k), Ci(i, j, k), Ci(i, j, k - 1));
      if (f0 !== F[id + nx * ny] < 0) quads.push(Ci(i - 1, j - 1, k), Ci(i, j - 1, k), Ci(i, j, k), Ci(i - 1, j, k));
    }
    return { pos, quads };
  }
  var EYE = [0.021, 0.263, 0.186];
  var NOSE = [0, 0.2465, 0.2035];
  var MUZ = [0, 0.237, 0.19];
  var COL = { white: new THREE.Color(15460577), cream: new THREE.Color(13810584), black: new THREE.Color(1380365), brown: new THREE.Color(3483164) };
  function coat(p, n, bi, o) {
    const [x, y, z] = p, ax = Math.abs(x), g = GRP[bi];
    const nz = vnoise(x * 70 + 5.3, y * 70, z * 70) - 0.5, nf = vnoise(x * 190, y * 190 + 2.1, z * 190) - 0.5;
    const dist = (a) => Math.hypot(ax - a[0], y - a[1], z - a[2]);
    let black = 0, cream = 0, len = 0.034, droop = 0.4, cs = 0.35, cx = 0, cy = -0.35, cz = -1;
    if (g === "head" || g === "ear" || g === "neck" && y > 0.228 + 0.01 * nz) {
      black = 1;
      if (g === "ear") {
        len = 0.045;
        droop = 0.9;
        cs = 0.4;
        cx = 0;
        cy = -1;
        cz = 0;
      } else {
        const half = 7e-3 + 0.022 * sstep(0.262, 0.294, y) + 7e-3 * nz;
        black *= 1 - sstep(-3e-3, 3e-3, half - ax) * sstep(0.247, 0.255, y) * sstep(0.105, 0.125, z);
        const muz = 1 - sstep(0.017, 0.024, dist(MUZ) + 5e-3 * nz);
        black *= 1 - muz;
        cream = muz * (0.45 + 0.55 * sstep(0.228, 0.248, y));
        black *= 1 - sstep(0.232, 0.222, y) * sstep(0.152, 0.168, z);
        len = 0.038;
        droop = 0.35;
        cs = 0.45;
        cx = x;
        cy = y - NOSE[1];
        cz = z - NOSE[2] + 0.02;
        if (y > 0.272) {
          len = 0.04;
          droop = 0.45;
          cx = x * 0.8;
          cy = 0.55;
          cz = 0.8;
        }
        len *= mix(0.1, 1, sstep(0.012, 0.024, dist(EYE)));
        const dn = sstep(8e-3, 0.016, dist(NOSE));
        len *= mix(0.08, 1, dn);
        if (muz > 0.5) {
          len = Math.max(len, 0.024 * dn);
          droop = 0.5;
        }
      }
    } else if (g === "tail") {
      const i = bi - IDX.tail1;
      black = i === 0 ? 0.85 : i === 1 ? 0.3 : 0;
      len = 0.052;
      droop = 0.5;
      cs = 0.4;
      cx = TAIL[i + 1][0] - TAIL[i][0];
      cy = TAIL[i + 1][1] - TAIL[i][1];
      cz = TAIL[i + 1][2] - TAIL[i][2];
    } else if (g === "leg") {
      len = y < 0.03 ? 0.029 : 0.033;
      droop = 0.35;
      cs = 0.35;
      cx = 0;
      cy = -1;
      cz = 0.1;
      if (n[1] < -0.5 && y < 0.02) len = 2e-3;
    } else {
      const top = 0.153 + 0.014 * nz;
      black = sstep(top - 5e-3, top + 5e-3, y) * sstep(-0.132, -0.11, z) * (1 - sstep(-0.012, 0.012, z + 0.02 * nz));
      len = 0.035 + 0.018 * sstep(0.2, -0.8, n[1]);
      if (g === "neck") {
        len = 0.038;
        cy = -0.6;
        cz = -0.5;
      }
      if (n[2] > 0.55 && y < 0.17) {
        cy = -1;
        cz = 0.2;
      }
    }
    const dark = COL.black.clone().lerp(COL.brown, clamp(0.25 + 0.5 * nz + (g === "ear" ? 0.25 : 0), 0, 1));
    o.col.copy(COL.white).lerp(COL.cream, cream).lerp(dark, black).multiplyScalar(1 + 0.08 * nf);
    const d = cx * n[0] + cy * n[1] + cz * n[2], tx = cx - n[0] * d, ty = cy - n[1] * d, tz = cz - n[2] * d, tl = Math.hypot(tx, ty, tz) || 1;
    o.comb[0] = tx / tl * cs;
    o.comb[1] = ty / tl * cs;
    o.comb[2] = tz / tl * cs;
    o.len = len;
    o.droop = droop;
    o.group = g;
  }
  function strandTexture() {
    const N = 256, G = 20, S = 32, rnd = rng(11), data = new Uint8Array(N * N * 4);
    const cl = [], st = [];
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) cl.push([(i + 0.15 + 0.7 * rnd()) / G, (j + 0.15 + 0.7 * rnd()) / G, (0.65 + 0.5 * rnd()) / G, 0.6 + 0.4 * rnd(), rnd()]);
    for (let i = 0; i < S; i++) st.push([(i + 0.5) / S, (0.34 + 0.2 * rnd()) / S, 0.55 + 0.45 * rnd(), rnd() * TAU, 0.5 + rnd()]);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N, v = (y + 0.5) / N, ci = Math.floor(u * G), cj = Math.floor(v * G);
      let best = 0, id = 0, prof = 0, len = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const c = cl[(ci + di + G) % G + (cj + dj + G) % G * G];
        let dx = u - c[0], dy = v - c[1];
        dx -= Math.round(dx);
        dy -= Math.round(dy);
        const d = Math.sqrt(dx * dx + dy * dy) / c[2], hgt = c[3] * (1 - d * Math.sqrt(d));
        if (d < 1 && hgt > best) {
          best = hgt;
          id = c[4];
        }
      }
      for (const s of st) {
        let du = u - (s[0] + 7e-3 * Math.sin(TAU * v * s[4] + s[3]));
        du -= Math.round(du);
        const p = 1 - Math.abs(du) / s[1];
        if (p > prof) {
          prof = p;
          len = s[2];
        }
      }
      const q = (x + y * N) * 4;
      data[q] = best * 255;
      data[q + 1] = id * 255;
      data[q + 2] = prof * 255;
      data[q + 3] = len * 255;
    }
    const mips = [{ data, width: N, height: N }];
    for (let w = N / 2; w >= 1; w /= 2) {
      const src = mips[mips.length - 1].data, sw = w * 2, out = new Uint8Array(w * w * 4);
      for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
        const a = src[(2 * y * sw + 2 * x) * 4 + c], b = src[(2 * y * sw + 2 * x + 1) * 4 + c], e = src[((2 * y + 1) * sw + 2 * x) * 4 + c], f = src[((2 * y + 1) * sw + 2 * x + 1) * 4 + c];
        const avg = (a + b + e + f) / 4;
        out[(y * w + x) * 4 + c] = c === 0 || c === 2 ? (avg + Math.max(a, b, e, f)) / 2 : avg;
      }
      mips.push({ data: out, width: w, height: w });
    }
    const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    tex.mipmaps = mips;
    tex.generateMipmaps = false;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
  }
  var CARDS = [
    // topknot: long white strands rising out of the crown coat, arching forward and falling over the brow and eyes
    {
      n: 110,
      len: [0.055, 0.095],
      w: [4e-3, 8e-3],
      droop: 1,
      where: (p, n, g) => g === "head" && p[1] > 0.278 && p[2] > 0.128 && Math.abs(p[0]) < 0.02 && n[1] > 0.3,
      dir: (p, n, r) => [p[0] * 14 + (r() - 0.5) * 0.7, 0.85 + (r() - 0.5) * 0.3, 0.5 + (r() - 0.5) * 0.4]
    },
    // a looser tuft standing up out of the crown
    {
      n: 28,
      len: [0.04, 0.065],
      w: [4e-3, 7e-3],
      droop: 0.45,
      where: (p, n, g) => g === "head" && p[1] > 0.286 && p[2] > 0.13 && p[2] < 0.168 && Math.abs(p[0]) < 0.016,
      dir: (p, n, r) => [p[0] * 20 + (r() - 0.5) * 0.9, 1, (r() - 0.3) * 0.8]
    },
    // forehead fall: wisps from the brow hanging forward over both eyes
    {
      n: 36,
      len: [0.035, 0.055],
      w: [5e-3, 8e-3],
      droop: 1,
      where: (p, n, g) => g === "head" && p[1] > 0.266 && p[1] < 0.29 && p[2] > 0.165 && Math.abs(p[0]) < 0.019 && n[2] > 0.3,
      dir: (p, n, r) => [p[0] * 10 + (r() - 0.5) * 0.4, 0.3, 1]
    },
    {
      n: 50,
      len: [0.032, 0.05],
      w: [8e-3, 0.012],
      droop: 1,
      where: (p, n, g) => g === "ear" && n[0] * Math.sign(p[0]) > -0.2,
      dir: (p, n, r) => [n[0] * 0.5 + (r() - 0.5) * 0.3, -1, n[2] * 0.4 + (r() - 0.5) * 0.3]
    },
    {
      n: 36,
      len: [0.03, 0.045],
      w: [7e-3, 0.01],
      droop: 0.9,
      where: (p, n, g) => g === "head" && Math.abs(p[0]) > 0.026 && p[1] < 0.266 && p[1] > 0.226 && p[2] > 0.138 && p[2] < 0.176,
      dir: (p, n, r) => [n[0] + (r() - 0.5) * 0.3, -0.3, n[2] * 0.5]
    },
    {
      n: 50,
      len: [0.02, 0.034],
      w: [5e-3, 8e-3],
      droop: 0.55,
      where: (p, n, g) => g === "head" && Math.hypot(p[0] - MUZ[0], p[1] - MUZ[1], p[2] - MUZ[2]) < 0.028 && p[2] > 0.18 && p[1] < 0.252 && Math.hypot(p[0], p[1] - NOSE[1], p[2] - NOSE[2]) > 0.011,
      dir: (p, n, r) => [(p[0] - NOSE[0]) * 20 + n[0] * 0.6, (p[1] - NOSE[1]) * 20 + n[1] * 0.6 - 0.25, (p[2] - NOSE[2] + 0.02) * 20 + n[2] * 0.6]
    },
    {
      n: 70,
      len: [0.045, 0.07],
      w: [7e-3, 0.011],
      droop: 0.6,
      where: (p, n, g, bi) => g === "tail" && bi > IDX.tail1,
      dir: (p, n, r, bi) => {
        const i = bi - IDX.tail1, t = TAIL;
        return [n[0] * 0.8 + (t[i + 1][0] - t[i][0]) * 25 + (r() - 0.5) * 0.3, n[1] * 0.8 + (t[i + 1][1] - t[i][1]) * 25, n[2] * 0.8 + (t[i + 1][2] - t[i][2]) * 25];
      }
    }
  ];
  function buildGeometry() {
    const hs = 4e-3, { pos, quads } = surfaceNets(hs), nv = pos.length / 3;
    const nrm = new Float32Array(nv * 3), e = 4e-4;
    const grad = (x, y, z, out) => {
      out[0] = sdf(x + e, y, z) - sdf(x - e, y, z);
      out[1] = sdf(x, y + e, z) - sdf(x, y - e, z);
      out[2] = sdf(x, y, z + e) - sdf(x, y, z - e);
      const l = Math.hypot(out[0], out[1], out[2]) || 1;
      out[0] /= l;
      out[1] /= l;
      out[2] /= l;
    };
    const gv = [0, 0, 0];
    for (let i = 0; i < nv; i++) {
      let x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      grad(x, y, z, gv);
      const d = sdf(x, y, z);
      x -= d * gv[0];
      y -= d * gv[1];
      z -= d * gv[2];
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      grad(x, y, z, gv);
      nrm.set(gv, i * 3);
    }
    const tris = [], P = (i, c) => pos[i * 3 + c];
    for (let q = 0; q < quads.length; q += 4) {
      const [a, b, c, d] = [quads[q], quads[q + 1], quads[q + 2], quads[q + 3]];
      const dac = (P(a, 0) - P(c, 0)) ** 2 + (P(a, 1) - P(c, 1)) ** 2 + (P(a, 2) - P(c, 2)) ** 2, dbd = (P(b, 0) - P(d, 0)) ** 2 + (P(b, 1) - P(d, 1)) ** 2 + (P(b, 2) - P(d, 2)) ** 2;
      const t = dac < dbd ? [a, b, c, a, c, d] : [a, b, d, b, c, d];
      const ux = P(b, 0) - P(a, 0), uy = P(b, 1) - P(a, 1), uz = P(b, 2) - P(a, 2), vx = P(c, 0) - P(a, 0), vy = P(c, 1) - P(a, 1), vz = P(c, 2) - P(a, 2);
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      const nx = nrm[a * 3] + nrm[b * 3] + nrm[c * 3], ny = nrm[a * 3 + 1] + nrm[b * 3 + 1] + nrm[c * 3 + 1], nz = nrm[a * 3 + 2] + nrm[b * 3 + 2] + nrm[c * 3 + 2];
      if (fx * nx + fy * ny + fz * nz < 0) {
        [t[1], t[2]] = [t[2], t[1]];
        [t[4], t[5]] = [t[5], t[4]];
      }
      tris.push(...t);
    }
    const A = { position: [], normal: [], color: [], skinIndex: [], skinWeight: [], aFur: [], aDir: [], uv: [] }, owner = new Int16Array(nv), group = [], bw = new Float32Array(NB);
    const co = { col: new THREE.Color(), comb: [0, 0, 0] }, p3 = [0, 0, 0], n3 = [0, 0, 0];
    for (let i = 0; i < nv; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      bw.fill(0);
      let dmin = Infinity;
      const ds = PR.map((P2) => {
        const d = primDist(P2, x, y, z);
        dmin = Math.min(dmin, d);
        return d;
      });
      PR.forEach((P2, j) => {
        bw[P2.b] += Math.exp(-(ds[j] - dmin) / 55e-4);
      });
      const top = [...bw.keys()].sort((u, v) => bw[v] - bw[u]).slice(0, 4), sum = top.reduce((s, j) => s + bw[j], 0);
      owner[i] = top[0];
      p3[0] = x;
      p3[1] = y;
      p3[2] = z;
      n3[0] = nrm[i * 3];
      n3[1] = nrm[i * 3 + 1];
      n3[2] = nrm[i * 3 + 2];
      coat(p3, n3, top[0], co);
      A.position.push(x, y, z);
      A.normal.push(...n3);
      A.color.push(co.col.r, co.col.g, co.col.b);
      A.skinIndex.push(...top);
      A.skinWeight.push(...top.map((j) => bw[j] / sum));
      A.aFur.push(0, co.len, 0, co.droop);
      A.aDir.push(...co.comb);
      A.uv.push(0, 0);
      group.push(co.group);
    }
    const idx = [...tris], counts = { bodyVerts: nv, bodyIndex: tris.length };
    const solid = (geo2, hex, gloss) => {
      const base = A.position.length / 3, c = new THREE.Color(hex), gp = geo2.attributes.position, gn = geo2.attributes.normal;
      for (let i = 0; i < gp.count; i++) {
        A.position.push(gp.getX(i), gp.getY(i), gp.getZ(i));
        A.normal.push(gn.getX(i), gn.getY(i), gn.getZ(i));
        A.color.push(c.r, c.g, c.b);
        A.skinIndex.push(IDX.head, 0, 0, 0);
        A.skinWeight.push(1, 0, 0, 0);
        A.aFur.push(0, 0, 2, gloss);
        A.aDir.push(0, 0, 0);
        A.uv.push(0, 0);
      }
      for (const j of geo2.index.array) idx.push(base + j);
      geo2.dispose();
    };
    for (const s of [1, -1]) solid(new THREE.SphereGeometry(88e-4, 14, 10).translate(s * EYE[0], EYE[1], EYE[2]), 1838856, 1);
    solid(new THREE.SphereGeometry(1, 14, 10).scale(98e-4, 62e-4, 42e-4).translate(NOSE[0], NOSE[1], NOSE[2] - 1e-3), 920331, 0.3);
    counts.solidVerts = A.position.length / 3 - nv;
    counts.solidIndex = idx.length - tris.length;
    const rnd = rng(3);
    for (const set of CARDS) {
      const cand = [];
      for (let i = 0; i < nv; i++) if (set.where([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]], group[i], owner[i])) cand.push(i);
      for (let c = 0; c < set.n && cand.length; c++) {
        const vi = cand[Math.floor(rnd() * cand.length)], p = [pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]], n = [nrm[vi * 3], nrm[vi * 3 + 1], nrm[vi * 3 + 2]];
        const d = new THREE.Vector3(...set.dir(p, n, rnd, owner[vi])).normalize().multiplyScalar(Math.max(0.05, set.droop * (0.8 + 0.4 * rnd())));
        const L = mix(set.len[0], set.len[1], rnd()), W = mix(set.w[0], set.w[1], rnd()), u0 = rnd(), shade = 0.9 + 0.16 * rnd(), base = A.position.length / 3;
        for (let j = 0; j <= CARD_SEG; j++) for (const sd of [-1, 1]) {
          A.position.push(p[0] - n[0] * 3e-3, p[1] - n[1] * 3e-3, p[2] - n[2] * 3e-3);
          A.normal.push(...n);
          A.color.push(A.color[vi * 3] * shade, A.color[vi * 3 + 1] * shade, A.color[vi * 3 + 2] * shade);
          A.skinIndex.push(...A.skinIndex.slice(vi * 4, vi * 4 + 4));
          A.skinWeight.push(...A.skinWeight.slice(vi * 4, vi * 4 + 4));
          A.aFur.push(j / CARD_SEG, L, 1, sd * W);
          A.aDir.push(d.x, d.y, d.z);
          A.uv.push(u0 + (sd + 1) * W * 11, j / CARD_SEG);
        }
        for (let j = 0; j < CARD_SEG; j++) {
          const a = base + j * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(idx);
    geo.setAttribute("position", new THREE.Float32BufferAttribute(A.position, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(A.normal, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(A.color, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(A.uv, 2));
    geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(A.skinIndex, 4));
    geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(A.skinWeight, 4));
    geo.setAttribute("aFur", new THREE.Float32BufferAttribute(A.aFur, 4));
    geo.setAttribute("aDir", new THREE.Float32BufferAttribute(A.aDir, 3));
    geo.instanceCount = SHELLS;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.16, 0), 0.36);
    counts.verts = A.position.length / 3;
    counts.index = idx.length;
    return { geo, counts };
  }
  function furMaterial(strand) {
    const U = { uStrand: { value: strand }, uLag: { value: new THREE.Vector3() }, uShells: { value: SHELLS }, uTile: { value: 26 } };
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace("#include <common>", `#include <common>
attribute vec4 aFur; attribute vec3 aDir; uniform vec3 uLag; uniform float uShells;
varying vec4 vFur; varying vec3 vRest; varying vec3 vRestN; varying vec2 vCuv;`).replace("#include <skinning_vertex>", `#include <skinning_vertex>
{
  // outermost shell first, skin last: inner layers then fail the depth test wherever a strand already covered the pixel,
  // so the expensive lit fragments are ~1 per pixel instead of one per surviving layer
  float kind = aFur.z, h = 1.0 - float(gl_InstanceID) / (uShells - 1.0);
  vRest = position; vRestN = normal; vCuv = uv; vFur = vec4(h, kind, aFur.w, 0.0);
#ifdef USE_SKINNING
  vec3 dir = (skinMatrix * vec4(aDir, 0.0)).xyz;
#else
  vec3 dir = aDir;
#endif
  vec3 n = normalize(objectNormal);
  if (kind < 0.5) {
    // shell: grow along the normal, bend with the comb and gravity towards the tip, never sink into the skin
    float L = aFur.y;
    vec3 off = L * (n * h + (dir + vec3(0.0, -aFur.w, 0.0) + uLag) * (h * h * 0.65));
    off += n * max(0.0, 0.35 * L * h - dot(off, n));
    transformed += off;
  } else if (gl_InstanceID > 0) {
    transformed = vec3(0.0);
  } else if (kind < 1.5) {
    // hair card: a drooping ribbon from the root, turned to face the camera around its own axis
    float s = aFur.x, L = aFur.y;
    vec3 d = normalize(dir), g = vec3(0.0, -length(dir), 0.0) + uLag;
    vec3 p = transformed + L * (d * s + g * (s * s * 0.75));
    vec3 tang = normalize(d + g * (1.5 * s));
    vec3 pv = (modelViewMatrix * vec4(p, 1.0)).xyz;
    vec3 sv = cross(normalize(mat3(modelViewMatrix) * tang), normalize(-pv));
    sv = length(sv) > 1e-5 ? normalize(sv) : vec3(1.0, 0.0, 0.0);
    transformed = p + (sv * mat3(modelViewMatrix)) * (aFur.w * (1.0 - 0.45 * s));
    vFur.x = s;
  }
}`);
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
uniform sampler2D uStrand; uniform float uTile;
varying vec4 vFur; varying vec3 vRest; varying vec3 vRestN; varying vec2 vCuv;`).replace("#include <color_fragment>", `#include <color_fragment>
{
  float ao = 1.0;
  if (vFur.y < 0.5) {
    vec3 an = abs(vRestN);
    vec2 suv = an.x > max(an.y, an.z) ? vRest.zy : (an.y > an.z ? vRest.xz : vRest.xy);
    float h = vFur.x, ph = dot(vRest, vec3(173.0, 131.0, 97.0));
    suv += vec2(sin(h * 9.0 + ph), cos(h * 7.0 + ph * 1.3)) * (0.0011 * h);   // crimp: strands wander as they grow
    vec4 st = texture2D(uStrand, suv * uTile);
    if (h > 0.0 && st.r < h + 0.03) discard;
    ao = mix(0.32, 1.0, sqrt(h)) * (0.86 + 0.28 * st.g);
  } else if (vFur.y < 1.5) {
    vec4 cs = texture2D(uStrand, vCuv);
    float s = vFur.x;
    if (s > cs.a || cs.b < 0.25 + 0.6 * s / max(cs.a, 0.01)) discard;
    ao = mix(0.62, 1.0, s) * (0.88 + 0.24 * cs.g);
  }
  diffuseColor.rgb *= ao;
}`).replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
if (vFur.y > 1.5) roughnessFactor = mix(0.6, 0.14, vFur.z);`);
    };
    m.customProgramCacheKey = () => "pet-dog-fur-1";
    m.userData.uniforms = U;
    return m;
  }
  function blobTexture() {
    const N = 64, d = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const r = Math.hypot((x + 0.5) / N * 2 - 1, (y + 0.5) / N * 2 - 1), a = Math.pow(1 - sstep(0.15, 1, r), 1.6) * 255;
      d.set([a, a, a, 255], (y * N + x) * 4);
    }
    const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }
  var Spring = class {
    constructor(hz, zeta) {
      this.w = TAU * hz;
      this.z = zeta;
      this.x = 0;
      this.v = 0;
    }
    step(target, dt, force = 0) {
      const n = Math.ceil(dt / 8e-3), h = dt / n;
      for (let i = 0; i < n; i++) {
        this.v += (this.w * this.w * (target - this.x) - 2 * this.z * this.w * this.v + force) * h;
        this.x += this.v * h;
      }
      return this.x;
    }
  };
  var MODES = ["idle", "walk", "sit", "lie", "jump", "pet"];
  var H0 = [0.165, -0.072];
  var S0 = [0.172, -8e-3];
  var C0 = [0.17, 0.05];
  var DOG = { radius: 0.15, walkSpeed: 0.35, trotSpeed: 0.62, callSpeed: 0.9, jumpHeight: 0.2, jumpDuration: 0.8, jumpTakeoff: 0.28, jumpLand: 0.78, maxPerch: 0, pickBox: [-0.13, 0, -0.2, 0.13, 0.36, 0.27] };
  var cached = null;
  function createPet(opts = {}) {
    const root = new THREE.Group();
    root.name = "pet-dog";
    const built = opts.fresh || !cached ? { ...buildGeometry(), strand: strandTexture() } : cached;
    if (!opts.fresh) cached = built;
    const { counts, strand } = built, mat = furMaterial(strand), geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(built.geo.index);
    for (const k in built.geo.attributes) geo.setAttribute(k, built.geo.attributes[k]);
    geo.instanceCount = SHELLS;
    geo.boundingSphere = built.geo.boundingSphere.clone();
    const bones = BONE_DEFS.map(([name]) => Object.assign(new THREE.Bone(), { name: `dog_${name}` }));
    BONE_DEFS.forEach(([, parent, x, y, z], i) => {
      if (parent) {
        const pd = BONE_DEFS[IDX[parent]];
        bones[IDX[parent]].add(bones[i]);
        bones[i].position.set(x - pd[2], y - pd[3], z - pd[4]);
      } else bones[i].position.set(x, y, z);
    });
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.name = "dog-fur";
    mesh.add(bones[0]);
    mesh.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(bones);
    mesh.bind(skeleton);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.16, 0), 0.36);
    mesh.boundingBox = new THREE.Box3(new THREE.Vector3(-0.16, 0, -0.26), new THREE.Vector3(0.16, 0.38, 0.3));
    mesh.raycast = () => {
    };
    root.add(mesh);
    const blob = blobTexture();
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0, alphaMap: blob, transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    shadow.name = "dog-contact-shadow";
    shadow.castShadow = false;
    shadow.receiveShadow = false;
    shadow.raycast = () => {
    };
    shadow.renderOrder = 1;
    root.add(shadow);
    const W = Object.fromEntries(MODES.map((m) => [m, m === "idle" ? 1 : 0])), clk = Object.fromEntries(MODES.map((m) => [m, 0]));
    const poses = Object.fromEntries(MODES.map((m) => [m, new Float32Array(NP)])), out = new Float32Array(NP), Q = new Float32Array(NP);
    let T = 0, phase = 0, wagPh = 0, wt = 0, lastMode = "idle", landT = 9, baseY = 0, haveBase = false, petKind = 0, petSide = 1, belly = 0, lookTarget = null;
    const brain = { next: 1.2, rnd: rng(opts.seed ?? 5), ty: 0, tp: 0, tr: 0, ts: 0, ta: 0, tw: 0.35, yaw: new Spring(0.9, 1), pitch: new Spring(0.9, 1), roll: new Spring(0.7, 1), sniff: new Spring(0.8, 1), alert: new Spring(0.5, 1), wag: new Spring(0.5, 1) };
    brain.wag.x = 0.35;
    const sp = { e1x: [new Spring(2.4, 0.2), new Spring(2.4, 0.2)], e1z: [new Spring(2.4, 0.2), new Spring(2.4, 0.2)], e2x: [new Spring(3.4, 0.25), new Spring(3.4, 0.25)], e2z: [new Spring(3.4, 0.25), new Spring(3.4, 0.25)], lag: [new Spring(2.8, 0.3), new Spring(2.8, 0.3), new Spring(2.8, 0.3)] };
    const mot = { px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, ax: 0, ay: 0, az: 0, hy: 0, hv: 0, init: false };
    const ctx = { speed: 0, turn: 0, freq: 2, jumpT: 0, jumpDy: 0, petT: 0, petLeft: 5, excite: 0, attend: 0 };
    const b = (name) => IDX[name] * 3;
    const J = { hips: b("hips"), spine: b("spine"), chest: b("chest"), neck: b("neck"), head: b("head"), off: NB * 3 };
    function think(dt, mode, lk) {
      if (lk) {
        brain.ty = lk.yaw;
        brain.tp = lk.pitch;
        brain.ts = 0;
        brain.ta = 1;
        if (T > brain.next) {
          const r = brain.rnd;
          brain.tr = r() < 0.45 ? (r() < 0.5 ? -1 : 1) * (0.2 + 0.15 * r()) : 0;
          brain.tw = 0.25 + 0.3 * r();
          brain.next = T + 1.2 + 2 * r();
        }
      } else if (T > brain.next) {
        const r = brain.rnd, sniffy = mode === "idle" && r() < 0.3 || mode === "walk" && r() < 0.15;
        brain.ts = sniffy ? 1 : 0;
        brain.ty = sniffy ? (r() - 0.5) * 0.4 : (r() - 0.5) * (mode === "walk" ? 0.5 : 1.3);
        brain.tp = sniffy ? 0 : (r() - 0.6) * 0.35;
        brain.tr = !sniffy && r() < 0.35 ? (r() < 0.5 ? -1 : 1) * (0.22 + 0.15 * r()) : 0;
        brain.ta = r() < 0.35 ? 1 : 0;
        brain.tw = 0.12 + 0.4 * r();
        brain.next = T + (sniffy ? 1.3 + 1.2 * r() : 1.4 + 3.2 * r());
      }
      brain.yaw.step(brain.ty, dt);
      brain.pitch.step(brain.tp, dt);
      brain.roll.step(brain.tr, dt);
      brain.sniff.step(brain.ts, dt);
      brain.alert.step(brain.ta, dt);
      brain.wag.step(brain.tw, dt);
    }
    const look = (P, yaw, pitch, roll) => {
      P[J.neck] += pitch * 0.45;
      P[J.neck + 1] += yaw * 0.45;
      P[J.head] += pitch * 0.55;
      P[J.head + 1] += yaw * 0.55;
      P[J.head + 2] += roll;
    };
    const tail = (P, amp, ph, curl, side) => {
      for (let i = 0; i < 5; i++) {
        const j = b(`tail${i + 1}`);
        P[j] += curl * (i ? 0.22 : 0.4);
        P[j + 1] += amp * Math.sin(TAU * ph - i * 0.55) * (i ? 0.45 : 1) + side * (i ? 0.12 : 0.3);
      }
    };
    const lr = [0, 0, 0];
    function legRoot(P, L) {
      const ph = P[J.hips], hy = H0[0] + P[J.off + 1], hz = H0[1] + P[J.off + 2];
      const rot = (y, z, a, oy, oz) => {
        const c = Math.cos(a), s = Math.sin(a);
        lr[0] = oy + y * c - z * s;
        lr[1] = oz + y * s + z * c;
      };
      if (L.k === "h") {
        rot(L.J1[0] - H0[0], L.J1[1] - H0[1], ph, hy, hz);
        lr[2] = ph;
        return lr;
      }
      const ps = ph + P[J.spine], pc = ps + P[J.chest];
      rot(S0[0] - H0[0], S0[1] - H0[1], ph, hy, hz);
      rot(C0[0] - S0[0], C0[1] - S0[1], ps, lr[0], lr[1]);
      rot(L.J1[0] - C0[0], L.J1[1] - C0[1], pc, lr[0], lr[1]);
      lr[2] = pc;
      return lr;
    }
    function legIK(P, L, ty, tz, a3, a4) {
      const [jy, jz, pp] = legRoot(P, L), [l1, l2, l3] = L.len;
      const wy = ty - l3 * Math.cos(a3), wz = tz - l3 * Math.sin(a3), dy = wy - jy, dz = wz - jz;
      const d = clamp(Math.hypot(dy, dz), Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
      const a1 = Math.atan2(dz, dy) + L.bend * Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
      const a2 = Math.atan2(wz - (jz + l1 * Math.sin(a1)), wy - (jy + l1 * Math.cos(a1))), r = L.rest, B = L.b;
      P[B[0] * 3] += wrap(a1 - r[0] - pp);
      P[B[1] * 3] += wrap(a2 - r[1] - (a1 - r[0]));
      P[B[2] * 3] += wrap(a3 - r[2] - (a2 - r[1]));
      P[B[3] * 3] += wrap(a4 - r[3] - (a3 - r[2]));
      const roll = P[J.hips + 2], shift = roll * (H0[0] - L.J1[0]) + P[J.hips + 1] * (L.J1[1] - H0[1]) + (L.k === "h" ? 0 : P[J.spine + 1] * (L.J1[1] - S0[1]) + P[J.chest + 1] * (L.J1[1] - C0[1]));
      P[B[0] * 3 + 2] -= roll + shift / Math.max(0.04, jy - ty);
    }
    const stand = (P) => {
      for (const L of LEGS) legIK(P, L, L.foot[0], L.foot[1], L.rest[2], L.rest[3]);
    };
    const POSE = {
      idle(P) {
        const br = Math.sin(TAU * 0.55 * T), sn = brain.sniff.x;
        P[J.off + 1] = -3e-3 + 8e-4 * br - 0.022 * sn;
        P[J.hips + 2] = 0.015 * Math.sin(TAU * 0.13 * T);
        P[J.hips] = -0.06 * sn;
        P[J.spine] = -5e-3 * br + 0.1 * sn;
        P[J.chest] = 0.01 * br + 0.12 * sn;
        look(P, brain.yaw.x, brain.pitch.x - 0.04 + 0.85 * sn + 0.03 * Math.sin(TAU * 7 * T) * sn, brain.roll.x * (1 - sn));
        stand(P);
        tail(P, brain.wag.x + 0.35 * ctx.excite, 3.2 * wt, 0.15 * ctx.excite, 0);
      },
      walk(P) {
        const v = Math.max(ctx.speed, 0.02), f = ctx.freq, tm = clamp((v - 0.35) / 0.5, 0, 1), duty = 0.62 - 0.12 * tm, stride = v * duty / f, bob = Math.cos(TAU * 2 * phase);
        P[J.off + 1] = -0.012 + (3e-3 + 4e-3 * tm) * bob;
        P[J.hips] = 0.012 * Math.sin(TAU * 2 * phase + 0.6);
        P[J.hips + 2] = 0.012 * Math.sin(TAU * phase);
        const tn = clamp(ctx.turn, -2, 2) * 0.1;
        P[J.spine + 1] = tn;
        P[J.chest + 1] = tn;
        look(P, tn * 2.5 + brain.yaw.x * 0.5, -0.06 - 0.1 * tm + 0.02 * bob + brain.pitch.x * 0.4 + 0.6 * brain.sniff.x * (1 - tm), 0);
        for (const L of LEGS) {
          const off = L.k === "h" ? L.s > 0 ? 0 : 0.5 : L.s > 0 ? mix(0.25, 0.5, tm) : mix(0.75, 1, tm), u0 = frac(phase + off), zc = L.foot[1] + 0.12 * stride, r = L.rest, front = L.k === "f";
          if (u0 < duty) {
            const u = u0 / duty;
            legIK(P, L, L.foot[0], zc + stride * (0.5 - u), r[2] + (front ? -0.3 + 0.8 * u : -0.15 + 0.35 * u), r[3]);
          } else {
            const u = (u0 - duty) / (1 - duty), e = u * u * (3 - 2 * u), m = -(1 - duty) / duty * (u * (1 - u) * (1 - u) + u * u * (u - 1)), sw = Math.sin(Math.PI * u);
            legIK(P, L, L.foot[0] + (0.016 + 0.018 * Math.min(v, 1)) * sw * sw * (front ? 1.15 : 1), zc + stride * (-0.5 + e + m), r[2] + (front ? 0.5 - 0.8 * e + 0.9 * sw : 0.2 - 0.35 * e + 0.4 * sw), r[3] + 0.7 * sw);
          }
        }
        tail(P, 0.12 + brain.wag.x * 0.4 + 0.3 * tm + 0.15 * ctx.excite, wagPh, 0.05 + 0.25 * Math.max(tm, ctx.excite), 0);
      },
      sit(P) {
        const br = Math.sin(TAU * 0.5 * T), up = brain.alert.x, at = ctx.attend;
        P[J.off + 1] = -0.094;
        P[J.off + 2] = 0.012;
        P[J.hips] = -0.75;
        P[J.spine] = 0.2 + 6e-3 * br - 0.03 * at;
        P[J.chest] = 0.1 + 0.01 * br - 0.05 * at;
        look(P, brain.yaw.x * 0.85, 0.42 + brain.pitch.x * 0.95 - 0.06 * up - 0.05 * at, brain.roll.x);
        for (const L of LEGS) {
          if (L.k === "f") {
            legIK(P, L, L.foot[0], L.foot[1] - 8e-3, L.rest[2] - 0.05, L.rest[3]);
            continue;
          }
          const [, jz] = legRoot(P, L);
          legIK(P, L, L.foot[0], jz + 0.045, Math.PI / 2, L.rest[3]);
          P[L.b[0] * 3 + 2] += L.s * 0.28;
        }
        tail(P, brain.wag.x * 0.6 + 0.3 * ctx.excite, 2.4 * wt, 0.25, 0);
      },
      lie(P) {
        const br = Math.sin(TAU * 0.4 * T), up = brain.alert.x;
        P[J.off + 1] = -0.086;
        P[J.off + 2] = -4e-3;
        P[J.hips] = -0.02;
        P[J.chest] = 0.05 + 0.01 * br;
        P[J.spine] = -4e-3 * br;
        P[J.neck] += 0.85 * (1 - up) + 0.1 * up;
        P[J.head] += -0.42 * (1 - up) - 0.05 * up;
        look(P, brain.yaw.x * 0.6 * up, brain.pitch.x * 0.4 * up, brain.roll.x * up * 0.6);
        for (const L of LEGS) {
          const [, jz] = legRoot(P, L);
          if (L.k === "f") legIK(P, L, L.foot[0], jz + 0.112, Math.PI / 2 + 0.05, Math.PI / 2 + 0.12);
          else {
            legIK(P, L, L.foot[0], jz + 0.06, Math.PI / 2, L.rest[3]);
            P[L.b[0] * 3 + 2] += L.s * 0.3;
          }
        }
        tail(P, brain.wag.x * 0.25, 1.6 * T, -0.1, 0.5);
      },
      jump(P) {
        const p = ctx.jumpT, ta = DOG.jumpTakeoff, tl = DOG.jumpLand, up = clamp(ctx.jumpDy, -0.6, 0.6);
        const crouch = sstep(0, ta - 0.1, p) * (1 - sstep(ta - 0.08, ta - 0.01, p)), push = sstep(ta - 0.1, ta - 0.02, p) * (1 - sstep(ta, ta + 0.1, p));
        const air = sstep(ta - 0.02, ta + 0.03, p) * (1 - sstep(tl - 0.03, tl + 5e-3, p)), a = clamp((p - ta) / (tl - ta), 0, 1);
        const u = clamp((p - tl) / (1 - tl), 0, 1), land = p > tl ? Math.sin(Math.PI * Math.min(1, u * 1.6)) * (1 - u) : 0;
        P[J.off + 1] = -0.026 * crouch + 8e-3 * push - 0.022 * land;
        P[J.off + 2] = -0.01 * crouch;
        const pitch = 0.16 * crouch - 0.22 * push + air * (mix(-0.2, 0.22, sstep(0.1, 0.9, a)) - 0.3 * Math.max(0, up) * (1 - a) + 0.3 * Math.min(0, up) * a) + 0.1 * land;
        P[J.hips] = pitch;
        P[J.chest] = 0.08 * crouch + 0.04 * land;
        look(P, 0, -0.25 * crouch - 0.1 * push - 0.6 * pitch * air + 0.12 * land, 0);
        const ext = sstep(0.55, 0.9, a), trail = 1 - sstep(0.05, 0.35, a);
        for (const L of LEGS) {
          const [jy, jz] = legRoot(P, L), r = L.rest, f = L.k === "f";
          let ty = L.foot[0], tz = L.foot[1], a3 = r[2] + (f ? -0.25 * crouch : 0.2 * crouch), a4 = r[3];
          if (air > 0) {
            const fy = f ? mix(jy - 0.065, jy - 0.118, ext) : mix(mix(jy - 0.072, jy - 0.12, ext), jy - 0.122, trail);
            const fz = f ? jz + mix(0.022, 0.035, ext) : jz + mix(mix(0.016, 0, ext), -0.05, trail);
            const f3 = f ? r[2] + mix(1.2, -0.05, ext) : r[2] + mix(mix(0.5, 0.05, ext), -0.5, trail), f4 = r[3] + mix(0.8, 0.15, ext);
            ty = mix(ty, fy, air);
            tz = mix(tz, fz, air);
            a3 = mix(a3, f3, air);
            a4 = mix(a4, f4, air);
          }
          legIK(P, L, ty, tz, a3, a4);
        }
        tail(P, 0.35 * crouch, 4 * T, 0.15 + 0.2 * air, 0);
      },
      pet(P) {
        const t = ctx.petT, k = sstep(0, 1.1, ctx.petLeft), wig = Math.sin(TAU * 5.5 * T);
        const hop = (t0) => {
          const u = (t - t0) / 0.36;
          return u > 0 && u < 1 ? Math.sin(Math.PI * u) : 0;
        };
        const hp = (petKind === 0 ? hop(0.3) + hop(2.4) : petKind === 1 ? hop(2.4) : 0) * k;
        const bow = petKind === 1 ? sstep(0.4, 0.9, t) * (1 - sstep(1.7, 2.2, t)) * k : 0;
        P[J.off + 1] = -4e-3 + 0.016 * hp - 0.02 * bow;
        P[J.off + 2] = -0.012 * bow;
        P[J.hips] = -0.16 * hp + 0.3 * bow;
        P[J.chest] = 0.06 * bow;
        P[J.hips + 1] = 0.07 * wig * k;
        P[J.spine + 1] = -0.035 * wig * k;
        const tilt = 0.3 * Math.tanh(3 * Math.sin(TAU * 0.3 * t + 0.4)) * k;
        look(P, brain.yaw.x, brain.pitch.x - 0.08 * k - 0.5 * bow, tilt + 0.3 * brain.roll.x);
        for (const L of LEGS) {
          const f = L.k === "f", r = L.rest;
          legIK(P, L, L.foot[0] + (f ? 0.04 * hp : 0), L.foot[1] + (f ? 0.035 * bow + 0.01 * hp : 0), f ? mix(r[2] + 0.6 * hp, Math.PI / 2 + 0.25, bow) : r[2], f ? mix(r[3] + 0.5 * hp, Math.PI / 2 + 0.1, bow) : r[3]);
        }
        tail(P, 0.15 + 0.5 * k, 6.2 * T, 0.3 * k, 0);
        for (const e of ["ear1_L", "ear1_R"]) P[b(e)] += 0.3 * k;
        belly = petKind === 2 ? sstep(0.45, 1.6, t) * sstep(0.35, 1.7, ctx.petLeft) : 0;
        if (belly > 0) {
          const lower = sstep(0, 0.45, belly), roll = sstep(0.3, 1, belly), lg = sstep(0.15, 0.75, belly), sd = petSide, set = (i, v, w) => {
            P[i] = mix(P[i], v, w);
          };
          set(J.off + 1, -0.108, lower);
          set(J.off + 2, -0.01, lower);
          set(J.hips, 0.04, lower);
          set(J.hips + 2, sd * 2.55, roll);
          set(J.hips + 1, 0.06 * Math.sin(TAU * 1.3 * T), roll);
          set(J.spine + 1, 0.12 * Math.sin(TAU * 1.3 * T + 1), roll);
          set(J.spine + 2, sd * 0.12, roll);
          set(J.chest + 2, sd * 0.1, roll);
          set(J.neck, 0.45, roll);
          set(J.neck + 1, 0, roll);
          set(J.neck + 2, -sd * 0.95, roll);
          set(J.head, 0.05, roll);
          const kick = sstep(2, 2.3, t) * (1 - sstep(3.2, 3.5, t)) * Math.sin(TAU * 8 * T);
          for (const L of LEGS) {
            const B = L.b, pad = 0.15 * Math.sin(TAU * 1.8 * T + (L.s > 0 ? 0 : Math.PI) + (L.k === "h" ? 1.5 : 0));
            const A = L.k === "f" ? [-0.75 + pad, 1, 0.9, 0.4] : [-0.95 + pad + (L.s === sd ? 0.3 * kick : 0), 0.9, -0.6, 0.3];
            for (let i = 0; i < 4; i++) {
              set(B[i] * 3, A[i], lg);
              set(B[i] * 3 + 1, 0, lg);
              set(B[i] * 3 + 2, i ? 0 : L.s * (L.k === "f" ? 0.25 : 0.5), lg);
            }
          }
          for (let i = 0; i < 5; i++) {
            const j = b(`tail${i + 1}`);
            set(j, i ? -0.1 : -0.5, roll);
            set(j + 1, 0.45 * Math.sin(TAU * 4 * T - i * 0.5) * (i ? 0.5 : 1), roll);
          }
          set(b("ear1_L") + 2, 1, roll);
          set(b("ear1_R") + 2, -1, roll);
        }
      }
    };
    const S = { mode: "idle", speed: 0, turn: 0, t: 0, jumpT: 0 }, lv = new THREE.Vector3(), LOOK = { yaw: 0, pitch: 0 };
    const pet = {
      root,
      ...DOG,
      modes: MODES,
      // optional extras (not part of the contract): rig handles for tools/tests and a rough height for camera framing
      name: "dog",
      height: 0.33,
      mesh,
      skeleton,
      shadow,
      bones: Object.fromEntries(bones.map((bn, i) => [BONE_DEFS[i][0], bn])),
      counts,
      shells: SHELLS,
      // head tracking target used when s.look is not given (world THREE.Vector3, kept by reference; null clears)
      lookAt(p) {
        lookTarget = p?.isVector3 ? p : null;
      },
      update(dt, s = S) {
        dt = clamp(+dt || 0, 0, 0.1);
        T += dt;
        const mode = MODES.includes(s.mode) ? s.mode : "idle";
        if (mode !== lastMode) {
          if (lastMode === "jump") landT = 0;
          if (W[mode] < 0.05) clk[mode] = 0;
          if (mode === "pet") {
            const n2 = Math.max(0, Math.floor(+s.petN || 0));
            petKind = n2 % 3;
            petSide = (n2 / 3 | 0) % 2 ? -1 : 1;
          }
          lastMode = mode;
        }
        const v = Math.max(0, +s.speed || 0);
        ctx.speed = mode === "walk" ? v : ctx.speed * Math.exp(-5 * dt);
        ctx.turn = +s.turn || 0;
        ctx.jumpDy = +s.jumpDy || 0;
        ctx.petT = Number.isFinite(s.petT) ? s.petT : clk.pet;
        ctx.petLeft = Number.isFinite(s.petLeft) ? s.petLeft : Math.max(0, 5 - ctx.petT);
        ctx.freq = 1.6 + 3 * Math.max(ctx.speed, 0.05);
        phase = frac(phase + dt * ctx.freq);
        ctx.excite = clamp(+s.excite || 0, 0, 1);
        ctx.attend += ((s.attend ? 1 : 0) - ctx.attend) * (1 - Math.exp(-4 * dt));
        wagPh = frac(wagPh + dt * (2.6 + 2.6 * clamp((ctx.speed - 0.35) / 0.5, 0, 1)) * (1 + 0.5 * ctx.excite));
        wt = (wt + dt * (1 + 0.9 * ctx.excite)) % 1e4;
        ctx.jumpT = clamp(Number.isFinite(s.jumpT) ? s.jumpT : clk.jump / DOG.jumpDuration, 0, 1);
        if (mode !== "jump" || !haveBase) {
          baseY = root.position.y;
          haveBase = true;
        }
        for (const m of MODES) {
          const rate = m === "jump" || mode === "jump" ? 18 : m === "lie" || mode === "lie" ? 3 : 5;
          W[m] += ((m === mode ? 1 : 0) - W[m]) * (1 - Math.exp(-rate * dt));
          if (W[m] > 2e-3 || m === mode) clk[m] += dt;
        }
        let lk = null;
        const tgt = s.look?.isVector3 ? s.look : lookTarget;
        if (tgt) {
          lv.copy(tgt);
          if (root.parent) root.parent.worldToLocal(lv);
          const dx = lv.x - root.position.x, dz = lv.z - root.position.z, ry = root.rotation.y, c = Math.cos(ry), sn = Math.sin(ry);
          const x = dx * c - dz * sn, z = dx * sn + dz * c - 0.16, y = lv.y - root.position.y - (0.26 + 0.05 * W.sit - 0.13 * W.lie), yaw = Math.atan2(x, z);
          if (Math.abs(yaw) < 1.7 && x * x + z * z < 36) {
            LOOK.yaw = clamp(yaw, -1.1, 1.1);
            LOOK.pitch = clamp(-Math.atan2(y, Math.hypot(x, z)), -0.95, 0.45);
            lk = LOOK;
          }
        }
        think(dt, mode, lk);
        out.fill(0);
        let wsum = 0;
        for (const m of MODES) {
          const w = W[m];
          if (w < 2e-3) continue;
          const P = poses[m];
          P.fill(0);
          POSE[m](P);
          for (let i = 0; i < NP; i++) out[i] += w * P[i];
          wsum += w;
        }
        for (let i = 0; i < NP; i++) out[i] /= wsum;
        landT += dt;
        if (landT < 0.3) {
          const k = Math.sin(landT / 0.3 * Math.PI) * (1 - landT / 0.3);
          out[J.off + 1] -= 8e-3 * k;
          out[J.neck] += 0.08 * k;
        }
        if (dt > 1e-4) {
          const rp = root.position, hy = out[J.off + 1];
          if (!mot.init) Object.assign(mot, { px: rp.x, py: rp.y, pz: rp.z, hy, init: true });
          const vx = (rp.x - mot.px) / dt, vy = (rp.y - mot.py) / dt + (hy - mot.hy) / dt, vz = (rp.z - mot.pz) / dt;
          const k = 1 - Math.exp(-dt * 25), cy = Math.cos(root.rotation.y), sy = Math.sin(root.rotation.y);
          const ax = clamp((vx - mot.vx) / dt, -40, 40), ay = clamp((vy - mot.vy) / dt, -40, 40), az = clamp((vz - mot.vz) / dt, -40, 40);
          mot.ax += (ax * cy - az * sy - mot.ax) * k;
          mot.ay += (ay - mot.ay) * k;
          mot.az += (ax * sy + az * cy - mot.az) * k;
          Object.assign(mot, { px: rp.x, py: rp.y, pz: rp.z, hy, vx, vy, vz });
        }
        for (let e = 0; e < 2; e++) {
          const side = e ? -1 : 1, i1 = b(e ? "ear1_R" : "ear1_L"), i2 = b(e ? "ear2_R" : "ear2_L");
          const ex = sp.e1x[e].step(0, dt, mot.az * 12), ez = sp.e1z[e].step(0, dt, -side * mot.ay * 16 - mot.ax * 10);
          sp.e1z[e].x = side > 0 ? clamp(ez, -0.12, 1.1) : clamp(ez, -1.1, 0.12);
          out[i1] += clamp(ex, -0.6, 0.6);
          out[i1 + 2] += sp.e1z[e].x;
          out[i2] += sp.e2x[e].step(sp.e1x[e].x * 0.5, dt);
          out[i2 + 2] += sp.e2z[e].step(sp.e1z[e].x * 0.6, dt);
        }
        const lg = mat.userData.uniforms.uLag.value, g = 0.03;
        lg.set(clamp(sp.lag[0].step(-mot.ax * g, dt), -0.6, 0.6), clamp(sp.lag[1].step(-mot.ay * g, dt), -0.6, 0.8), clamp(sp.lag[2].step(-mot.az * g, dt), -0.6, 0.6));
        for (let i = 0; i < NB; i++) bones[i].rotation.set(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]);
        bones[IDX.hips].position.set(out[J.off], H0[0] + out[J.off + 1], H0[1] + out[J.off + 2]);
        const h = Number.isFinite(s.lift) ? Math.max(0, s.lift) : Math.max(0, root.position.y - baseY);
        const flat = clamp(W.lie + W.pet * belly, 0, 1);
        shadow.position.set(0, 3e-3 - h, mix(0, -0.035, W.sit) + mix(0, 0.02, flat));
        shadow.scale.set(mix(0.25, 0.3, flat) * (1 + h), 1, (mix(0.38, 0.46, flat) - 0.06 * W.sit) * (1 + h));
        shadow.material.opacity = (0.38 + 0.12 * flat) * (1 - clamp(h / 0.3, 0, 0.8));
        const cd = s.camDist ?? 2, n = cd < 3.5 ? SHELLS : cd < 7 ? 20 : cd < 14 ? 12 : 6;
        geo.instanceCount = n;
        mat.userData.uniforms.uShells.value = n;
      },
      dispose() {
        root.removeFromParent();
        geo.dispose();
        mat.dispose();
        blob.dispose();
        shadow.geometry.dispose();
        shadow.material.dispose();
        skeleton.dispose();
        if (opts.fresh) {
          built.geo.dispose();
          strand.dispose();
        }
      }
    };
    pet.update(0, S);
    return pet;
  }

  // <stdin>
  window.__dogInject = { createPet };
})();
