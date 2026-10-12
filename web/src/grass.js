// Garden vegetation: GPU-instanced St. Augustine turf on the lawns outside the fences, a dense ground-cover carpet in
// the planted beds (purple heart, green and lime mounds as in g41/g42) and ornamental-grass / strap-leaf tufts planted
// in drifts along the shell paths (g37, g47). Instances are bucketed into tiles so frustum culling works. Every
// instance carries a rank in [0, 1): the vertex shader collapses instances ranked above the wanted density (quality,
// times a distance falloff for turf) and each tile's draw count is cut to the same curve on the CPU, so distant lawn
// and 'fast' mode draw fewer blades. Wind sways everything in the vertex shader (onBeforeCompile, uTime).
import * as THREE from 'three';
import { LOT, FRONT_BED, WEST_SHELL, FRONT_WALK, ISLAND_BEDS, GARDEN, WEST_FENCE_Y, pointInPoly } from './house.js';
import { BEDS, PAVED, SHELL, PLACEMENTS, FOOT, edgeDist, plantClear, generatePlanting } from './layout.js';

const QUALITY = { hq: { turf: 1, cover: 1, tuft: 1, shadow: true }, fast: { turf: 0.3, cover: 0.6, tuft: 0.7, shadow: false } };
const TAU = Math.PI * 2;
const TILE = { turf: 4, bed: 7 };

// ---------- random, noise, small vector helpers ----------
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function hash(ix, iy, s) { let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 982451653)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
const fbm = (x, y, s) => vnoise(x, y, s) * 0.6 + vnoise(x * 2.03 + 7.1, y * 2.03 + 3.3, s + 1) * 0.3 + vnoise(x * 4.1 + 1.9, y * 4.1 + 8.4, s + 2) * 0.1;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = ([a, b], t) => a + (b - a) * t;
const col = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };   // sRGB hex -> linear
const mixC = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mulC = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const rectDist = (x, y, b) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1));
const inRect = (x, y, b, m = 0) => x > b.x0 - m && x < b.x1 + m && y > b.y0 - m && y < b.y1 + m;
function polyBox(pts) { const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); return { pts, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; }
const inPolyM = (P, x, y, m = 0) => inRect(x, y, P, m) && (pointInPoly([x, y], P.pts) || (m > 0 && edgeDist(x, y, P.pts) < m));

// ---------- geometry ----------
class Geo {
  constructor() { this.p = []; this.n = []; this.c = []; this.i = []; }
  vert(p, n, c) { this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.c.push(c[0], c[1], c[2]); return this.p.length / 3 - 1; }
  // Ribbon through centre points P with half widths W (0 = a single tip vertex) across side vectors S. `fold` lifts the
  // edges along the normal so leaves cup.
  ribbon(P, W, S, C, N, fold = 0) {
    let prev = null;
    for (let k = 0; k < P.length; k++) {
      const n = N[k];
      if (W[k] <= 1e-6) { const a = this.vert(P[k], n, C[k]); if (prev && prev.length === 2) this.i.push(prev[0], prev[1], a); prev = [a]; continue; }
      const at = (s) => add(add(P[k], scl(S[k], W[k] * s)), scl(n, fold * W[k]));
      const a = this.vert(at(-1), n, C[k]), b = this.vert(at(1), n, C[k]);
      if (prev) { if (prev.length === 2) this.i.push(prev[0], prev[1], b, prev[0], b, a); else this.i.push(prev[0], b, a); }
      prev = [a, b];
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i); g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}
// Points + tangents along an arching stem from `base`: heading `yaw`, starting `e0` rad above horizontal, drooping by
// `bend` rad toward the tip; sampled at fractions `ts` of its length.
function arc(base, yaw, e0, bend, len, ts, pow = 1.5) {
  const dirAt = (t) => { const e = e0 - bend * Math.pow(t, pow); return [Math.sin(yaw) * Math.cos(e), Math.sin(e), Math.cos(yaw) * Math.cos(e)]; };
  const P = [], T = []; let p = base.slice(), t0 = 0;
  for (const t of ts) {
    const n = Math.max(1, Math.round((t - t0) * 24));
    for (let i = 0; i < n; i++) { const d = dirAt(t0 + (t - t0) * (i + 0.5) / n), ds = len * (t - t0) / n; p = add(p, scl(d, ds)); }
    P.push(p.slice()); T.push(dirAt(t)); t0 = t;
  }
  return { P, T };
}
// Normal blended between the ribbon face and the clump's dome so a clump shades as one soft volume (both faces share it).
function softNormal(T, S, p, dome, soft, up = 0) {
  let F = norm(cross(T, S)); const D = norm(sub(p, dome)); if (dot(F, D) < 0) F = scl(F, -1);
  return norm([F[0] * (1 - soft) + D[0] * soft, F[1] * (1 - soft) + D[1] * soft + up, F[2] * (1 - soft) + D[2] * soft]);
}

// Turf blade, normalised: 1 wide at the root (instance x scale = width in m), 1 tall (y and z scale = height), curving to +z.
function turfBladeGeo() {
  const g = new Geo(), ts = [0, 0.3, 0.55, 0.78, 1];
  const P = ts.map(t => [0, t - 0.06 * t * t * t, 0.3 * t * t]);
  const W = ts.map(t => 0.5 * Math.pow(Math.min(1, (1 - t) * 2.4), 0.7));
  const n = norm([0, 1, 0.45]);
  const C = ts.map(t => { const a = 0.3 + 0.7 * Math.pow(t, 0.75); return [a * (1 + 0.04 * t), a, a * (1 - 0.1 * t)]; });
  g.ribbon(P, W, ts.map(() => [1, 0, 0]), C, ts.map(() => n));
  return g.build();
}

// One leaf (lance/ovate) as a 4-level ribbon; vertex colour = height AO x leaf tint (the species hue comes per instance).
function leaf(g, base, yaw, pitch, len, wid, curl, shape, fold, tint, hue, dome, H) {
  const ts = [0, 0.38, 0.72, 1], { P, T } = arc(base, yaw, pitch, curl, len, ts, 1.3), S0 = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const N = [], C = [];
  for (let k = 0; k < ts.length; k++) {
    N.push(softNormal(T[k], S0, P[k], dome, 0.55, 0.15));
    const ao = 0.4 + 0.6 * Math.pow(Math.min(1, Math.max(0, P[k][1] / H)), 0.6), v = ao * tint * (0.86 + 0.14 * ts[k]);
    C.push([v * (1 + hue), v, v * (1 - hue)]);
  }
  g.ribbon(P, shape.map(s => s * wid / 2), ts.map(() => S0), C, N, fold);
}
const COVER = {
  // Tradescantia pallida: lance leaves up to 14 cm on sprawling stems, ~0.25 m mat
  purple: { n: 26, len: [0.09, 0.14], wid: [0.034, 0.046], pitch: [0.15, 0.75], curl: [0.4, 0.95], rad: [0.02, 0.17], hgt: [0.02, 0.16], shape: [0.28, 1, 0.78, 0], fold: 0.3 },
  // mounding ground covers, small leaves spiralled over a dome: dark green (jasmine / peperomia) and golden lime
  green: { n: 34, rx: 0.17, ry: 0.15, len: [0.055, 0.08], wid: [0.03, 0.042], H: 0.22 },
  lime: { n: 28, rx: 0.16, ry: 0.2, len: [0.045, 0.065], wid: [0.026, 0.036], H: 0.26 },
};
function coverGeo(kind, seed) {
  const r = lcg(seed), g = new Geo(), S = COVER[kind];
  if (kind !== 'purple') {
    const dome = [0, -0.02, 0];
    for (let k = 0; k < S.n; k++) {
      const yk = 1 - (k + 0.5) / S.n, rk = Math.sqrt(1 - yk * yk), ph = k * 2.39996 + (r() - 0.5) * 0.3;
      const d = [rk * Math.sin(ph), yk, rk * Math.cos(ph)], base = [d[0] * S.rx * 0.7, 0.015 + d[1] * S.ry * 0.75, d[2] * S.rx * 0.7];
      leaf(g, base, Math.atan2(d[0], d[2]) + (r() - 0.5) * 0.4, Math.asin(yk) * 0.85 + 0.12, lerp(S.len, r()), lerp(S.wid, r()), lerp([0.2, 0.45], r()), [0.25, 1, 0.8, 0], 0.2, 0.82 + r() * 0.3, (r() - 0.5) * 0.1, dome, S.H);
    }
    return g.build();
  }
  const dome = [0, -0.06, 0];
  for (let k = 0; k < S.n; k++) {
    const yaw = k * 2.39996 + (r() - 0.5) * 0.5, f = Math.sqrt(r()), rad = lerp(S.rad, f), h = lerp(S.hgt, r()) * (1 - 0.5 * f);
    const base = [Math.sin(yaw) * rad, h, Math.cos(yaw) * rad], pitch = lerp(S.pitch, r()) + (1 - f) * 0.3;
    leaf(g, base, yaw + (r() - 0.5) * 0.6, pitch, lerp(S.len, r()), lerp(S.wid, r()), lerp(S.curl, r()), S.shape, S.fold, 0.8 + r() * 0.32, (r() - 0.5) * 0.12, dome, 0.22);
  }
  return g.build();
}

const TUFT = {
  // Pennisetum (fountain grass): fine arching mound with buff foxtail plumes
  fountain: { n: 40, len: [0.7, 1.05], wid: [0.012, 0.018], tilt: [0.08, 1.0], bend: [0.5, 1.5], base: '#3a5126', mid: '#6f8e44', tipA: '#aab86a', tipB: '#c8bd8a', plumes: 10 },
  // muhly / green fountain grass: finer, greener, more upright
  muhly: { n: 52, len: [0.55, 0.9], wid: [0.008, 0.013], tilt: [0.05, 0.75], bend: [0.3, 1.0], base: '#35502a', mid: '#5f8b45', tipA: '#8db463', tipB: '#a3ba6e', plumes: 0 },
  // strap-leaf clump (African iris / dianella / lomandra)
  strap: { n: 22, len: [0.45, 0.75], wid: [0.022, 0.032], tilt: [0.15, 0.9], bend: [0.5, 1.3], base: '#2a4722', mid: '#4b7834', tipA: '#6d9a47', tipB: '#7aa04e', plumes: 0, strap: true },
};
function tuftGeo(kind, seed) {
  const r = lcg(seed), g = new Geo(), S = TUFT[kind], dome = [0, -0.3, 0];
  const cb = col(S.base), cm = col(S.mid), ca = col(S.tipA), ct = col(S.tipB);
  const ts = [0, 0.25, 0.5, 0.75, 1];
  for (let k = 0; k < S.n; k++) {
    const yaw = r() * TAU, tf = Math.pow(r(), 0.7), tilt = lerp(S.tilt, tf), L = lerp(S.len, r()) * (1 - 0.25 * tf), bend = lerp(S.bend, r()) * (0.4 + 0.6 * tf);
    const rad = Math.sqrt(r()) * 0.06, { P, T } = arc([Math.sin(yaw) * rad, 0, Math.cos(yaw) * rad], yaw, Math.PI / 2 - tilt, bend, L, ts, 1.6);
    const S0 = [Math.cos(yaw), 0, -Math.sin(yaw)], roll = (r() - 0.5) * 0.9;
    const Sd = T.map(t => norm(add(scl(S0, Math.cos(roll)), scl(cross(t, S0), Math.sin(roll)))));
    const w = lerp(S.wid, r()) / 2, tip = mixC(ca, ct, r()), shade = 0.8 + 0.25 * tf;
    const W = ts.map(t => S.strap ? w * (t < 0.72 ? 1 - 0.15 * t : (1 - t) * 3.2) : w * Math.pow(1 - t, 0.8));
    const C = ts.map((t, i) => mulC(t < 0.45 ? mixC(cb, cm, t / 0.45) : mixC(cm, tip, (t - 0.45) / 0.55), shade * (0.55 + 0.45 * Math.min(1, P[i][1] / 0.5))));
    g.ribbon(P, W, Sd, C, ts.map((t, i) => softNormal(T[i], Sd[i], P[i], dome, 0.6, 0.2)));
  }
  const stalkC = col('#8f9160'), plumeA = col('#b9a184'), plumeB = col('#a98d84'), plumeTip = col('#d2c3a6');
  const pts = [0, 0.25, 0.5, 0.7, 0.78, 0.84, 0.9, 0.95, 1];
  for (let k = 0; k < S.plumes; k++) {
    const yaw = r() * TAU, { P, T } = arc([Math.sin(yaw) * 0.02, 0, Math.cos(yaw) * 0.02], yaw, Math.PI / 2 - lerp([0.2, 0.75], r()), lerp([0.35, 0.9], r()), lerp([0.95, 1.15], r()), pts, 1.5);
    const S0 = [Math.cos(yaw), 0, -Math.sin(yaw)], up = [0, 1, 0];
    g.ribbon(P.slice(0, 5), [0.0022, 0.002, 0.0018, 0.0016, 0.0015], P.slice(0, 5).map(() => S0), P.slice(0, 5).map(() => stalkC), P.slice(0, 5).map(() => up));
    const pc = mixC(plumeA, plumeB, r()), PP = P.slice(4), TT = T.slice(4), PW = [0.003, 0.011, 0.013, 0.009, 0];
    for (let j = 0; j < 4; j++) {   // four crossed ribbons read as a fuzzy foxtail
      const a = j * Math.PI / 4, Sj = TT.map(t => norm(add(scl(S0, Math.cos(a)), scl(cross(t, S0), Math.sin(a)))));
      g.ribbon(PP, PW, Sj, PP.map((_, i) => mixC(pc, plumeTip, i / 4)), PP.map((p) => norm(add(norm(sub(p, dome)), [0, 0.6, 0]))));
    }
  }
  return g.build();
}

// ---------- materials: wind + density thinning in the vertex shader, GTAO-compatible normal pass ----------
const VERT_HEAD = 'uniform float uTime;\nuniform vec2 uWind;\nuniform float uDensity;\nattribute vec2 aSeed;\n';
const VERT = /* glsl */`#include <begin_vertex>
#ifdef USE_INSTANCING
{
  vec3 gO = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
  float gD = distance(gO, cameraPosition);
  float gKeep = uDensity;
#ifdef G_LOD
  gKeep *= clamp(1.0 - (gD - G_NEAR) / (G_FAR - G_NEAR), 0.0, 1.0);
#endif
  float gK = clamp((gKeep - aSeed.x) * 16.0, 0.0, 1.0);
#ifdef G_BLADE
  transformed.x *= (1.0 + gD * G_WIDEN) * (1.0 + (1.0 - uDensity) * G_COMP);
#else
  transformed.xz *= 1.0 + (1.0 - uDensity) * G_COMP;
#endif
  mat3 gM = mat3(instanceMatrix);
  float gTall = length(gM[1]) * G_HEIGHT;
  float gH = clamp(position.y / G_HEIGHT, 0.0, 1.0);
  float gPh = aSeed.y * 6.2832;
  float gGust = 0.5 + 0.5 * sin(dot(gO.xz, uWind) * 0.45 - uTime * 1.35);
  float gSw = (0.25 + 0.75 * gGust * gGust) * (0.8 + 0.2 * sin(uTime * 2.3 + gPh));
  float gFl = sin(uTime * 6.3 + gPh * 3.0 + gO.x * 1.7 + gO.z * 1.3) * G_FLUTTER;
  vec2 gOff = (uWind * gSw * G_SWAY + vec2(-uWind.y, uWind.x) * gFl) * gTall * gH * gH;
  vec3 gW = vec3(gOff.x, -0.5 * dot(gOff, gOff) / max(gTall * gH, 0.02), gOff.y);
  // instance matrices are rotation x scale, so their inverse is transpose / squared column lengths
  transformed = (transformed + (transpose(gM) * gW) / vec3(dot(gM[0], gM[0]), dot(gM[1], gM[1]), dot(gM[2], gM[2]))) * gK;
}
#endif
`;
const f5 = (v) => v.toFixed(5);
function patch(m, U, density, opts, depthOnly) {
  m.defines = { ...(m.defines || {}), G_SWAY: f5(opts.sway), G_FLUTTER: f5(opts.flutter), G_HEIGHT: f5(opts.height), G_COMP: f5(opts.comp ?? 0) };
  if (opts.lod) Object.assign(m.defines, { G_LOD: '', G_NEAR: f5(opts.lod[0]), G_FAR: f5(opts.lod[1]) });
  if (opts.blade) Object.assign(m.defines, { G_BLADE: '', G_WIDEN: f5(opts.widen ?? 0) });
  const uNormalPass = { value: 0 };
  if (!depthOnly) {
    // GTAO renders its normal/depth pre-pass with scene.overrideMaterial; opt out so wind and thinning match, and emit
    // view-space normals ourselves while that pass is running (same trick as the plant leaf materials).
    m.allowOverride = false;
    m.onBeforeRender = (renderer, scene) => { uNormalPass.value = scene?.overrideMaterial?.isMeshNormalMaterial ? 1 : 0; };
  }
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, { uTime: U.time, uWind: U.wind, uDensity: density, uNormalPass });
    s.vertexShader = VERT_HEAD + s.vertexShader.replace('#include <begin_vertex>', VERT);
    if (depthOnly) return;
    s.fragmentShader = s.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
    s.fragmentShader = 'uniform float uNormalPass;\n' + s.fragmentShader.replace(/}\s*$/, '  if (uNormalPass > 0.5) gl_FragColor = vec4(normalize(normal) * 0.5 + 0.5, 1.0);\n}\n');
  };
  m.customProgramCacheKey = () => 'garden|' + (depthOnly ? 'depth' : 'std');
  return m;
}
function vegMat(U, density, opts) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: opts.rough ?? 0.8, metalness: 0, vertexColors: true, side: THREE.DoubleSide, envMapIntensity: 0.6 });
  m.name = 'garden-' + opts.name;
  return patch(m, U, density, opts, false);
}

// ---------- instance bags and tiles ----------
const STRIDE = 11;   // x, base height, z, yaw, tilt, sx, sy, sz, r, g, b
class Bag {
  constructor() { this.a = []; }
  push(x, h, y, yaw, tilt, sx, sy, sz, c) { this.a.push(x, h, -y, yaw, tilt, sx, sy, sz, c[0], c[1], c[2]); }
  get n() { return this.a.length / STRIDE; }
}
function buildLayer(group, tiles, bag, geo, mat, { tile, lod = null, density, cast = false, depthMat = null, rnd, name }) {
  const a = bag.a, n = bag.n, buckets = new Map(), geoH = geo.boundingBox.max.y;
  for (let i = 0; i < n; i++) { const key = Math.floor(a[i * STRIDE] / tile) + ',' + Math.floor(a[i * STRIDE + 2] / tile); let b = buckets.get(key); if (!b) buckets.set(key, b = []); b.push(i); }
  for (const idx of buckets.values()) {
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }   // any prefix is spatially uniform
    const m = idx.length, tg = new THREE.BufferGeometry();
    for (const k in geo.attributes) tg.setAttribute(k, geo.attributes[k]);
    tg.setIndex(geo.index); tg.boundingBox = geo.boundingBox; tg.boundingSphere = geo.boundingSphere;
    const mesh = new THREE.InstancedMesh(tg, mat, m), E = mesh.instanceMatrix.array, C = new Float32Array(m * 3), seed = new Float32Array(m * 2);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, hMin = Infinity, hMax = -Infinity;
    for (let j = 0; j < m; j++) {
      const o = idx[j] * STRIDE, x = a[o], h = a[o + 1], z = a[o + 2], yaw = a[o + 3], tilt = a[o + 4], sx = a[o + 5], sy = a[o + 6], sz = a[o + 7];
      const c = Math.cos(yaw), s = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt), e = j * 16;
      E[e] = c * sx; E[e + 1] = 0; E[e + 2] = -s * sx; E[e + 3] = 0;                     // T(x,h,z) * Ry(yaw) * Rx(tilt) * S(sx,sy,sz)
      E[e + 4] = s * st * sy; E[e + 5] = ct * sy; E[e + 6] = c * st * sy; E[e + 7] = 0;
      E[e + 8] = s * ct * sz; E[e + 9] = -st * sz; E[e + 10] = c * ct * sz; E[e + 11] = 0;
      E[e + 12] = x; E[e + 13] = h; E[e + 14] = z; E[e + 15] = 1;
      C[j * 3] = a[o + 8]; C[j * 3 + 1] = a[o + 9]; C[j * 3 + 2] = a[o + 10];
      seed[j * 2] = (j + 0.5) / m; seed[j * 2 + 1] = rnd();
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); hMin = Math.min(hMin, h); hMax = Math.max(hMax, h + sy * geoH);
    }
    mesh.instanceColor = new THREE.InstancedBufferAttribute(C, 3);
    tg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 2));
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3((x0 + x1) / 2, (hMin + hMax) / 2, (z0 + z1) / 2), Math.hypot(x1 - x0, z1 - z0, hMax - hMin) / 2 + 0.7);
    mesh.receiveShadow = true; mesh.castShadow = cast; if (depthMat) mesh.customDepthMaterial = depthMat;
    mesh.matrixAutoUpdate = false; mesh.name = 'garden-' + name;
    group.add(mesh);
    tiles.push({ mesh, n: m, x0, x1, z0, z1, y: hMin, lod, density, cast });
  }
}

// ---------- where things grow ----------
const FRONT = polyBox(FRONT_BED), ISL = ISLAND_BEDS.map(polyBox), GARD = polyBox(GARDEN);
// Lawn on our lot: outside the fences, off paving, the shell front bed and the mulched islands, north of the sidewalk.
function lawnLot(x, y) {
  if (y < -14.1) return false;
  if ((x > 8.2 && y > -1.12) || (x < -8.1 && y > WEST_FENCE_Y - 0.1)) return false;
  for (const b of PAVED) if (inRect(x, y, b, 0.03)) return false;
  if (inPolyM(FRONT, x, y, 0.04)) return false;
  if (pointInPoly([x, y], WEST_SHELL) || pointInPoly([x, y], FRONT_WALK)) return false;
  for (const b of ISL) if (inPolyM(b, x, y, 0.04)) return false;
  return true;
}
const LAWNS = [   // turf blade regions: our lot (dense) and the neighbours' street-side yards (lighter, LOD-thinned anyway)
  { x0: LOT.x0 + 0.03, x1: LOT.x1 - 0.03, y0: -14.1, y1: 0.1, h: -0.034, dens: 1000, ok: lawnLot, tone: 0 },
  { x0: -27, x1: LOT.x0 - 0.04, y0: -12.95, y1: -4.2, h: -0.094, dens: 420, tone: 1 },
  { x0: -16.8, x1: LOT.x0 - 0.04, y0: -4.2, y1: 2.6, h: -0.094, dens: 420, tone: 1 },
  { x0: LOT.x1 + 0.04, x1: 27, y0: -12.95, y1: -5.7, h: -0.094, dens: 420, tone: 1 },
  { x0: LOT.x1 + 0.04, x1: 17.2, y0: -5.7, y1: -1.3, h: -0.094, dens: 420, tone: 1 },
];
const TURF_C = { deep: col('#3b5a22'), mid: col('#527b2d'), bright: col('#6f9637'), yellow: col('#93a845'), blue: col('#406f3b') };
function genTurf(rnd) {
  const bag = new Bag();
  for (const R of LAWNS) {
    const cell = 1 / Math.sqrt(R.dens);
    for (let gy = R.y0; gy < R.y1; gy += cell) for (let gx = R.x0; gx < R.x1; gx += cell) {
      const x = gx + rnd() * cell, y = gy + rnd() * cell;
      if (x > R.x1 || y > R.y1 || (R.ok && !R.ok(x, y))) continue;
      const n1 = fbm(x * 0.35, y * 0.35, 3), n2 = vnoise(x * 1.7 + 11, y * 1.7, 5);
      let c = mixC(TURF_C.deep, TURF_C.mid, smooth(0.25, 0.75, n1));
      c = mixC(c, TURF_C.bright, Math.pow(rnd(), 2.2) * 0.7);
      if (n2 > 0.62) c = mixC(c, TURF_C.yellow, Math.min(1, (n2 - 0.62) * (R.tone ? 2.2 : 1.4)));
      if (n1 < 0.35) c = mixC(c, TURF_C.blue, (0.35 - n1) * 1.5);
      const h = (0.075 + 0.055 * rnd() + 0.03 * n1) * (R.tone ? 0.9 : 1);
      bag.push(x, R.h, y, rnd() * TAU, 0.12 + 0.6 * Math.pow(rnd(), 1.3), 0.0075 + 0.004 * rnd(), h, h, mulC(c, 0.86 + rnd() * 0.26));
    }
  }
  return bag;
}
// Distance to the nearest walkable edge (shell paths/lounge and paving), measured from outside them.
function walkEdge(x, y) {
  let d = Infinity;
  for (const p of SHELL) d = Math.min(d, edgeDist(x, y, p));
  for (const b of PAVED) d = Math.min(d, rectDist(x, y, b));
  return d;
}
const groundH = (x, y, bed) => bed.cover === 'shell' ? -0.012 : (pointInPoly([x, y], GARDEN) ? -0.028 : -0.024);
// Ground cover may tuck under paving edges a little and spill 10 cm onto the shell, but never sits on it or the house.
function coverClear(x, y) {
  for (const b of PAVED) if (inRect(x, y, b, 0.06)) return false;
  for (const p of SHELL) if (pointInPoly([x, y], p) && edgeDist(x, y, p) > 0.1) return false;
  if (pointInPoly([x, y], GARDEN) && edgeDist(x, y, GARDEN) < 0.1) return false;
  return true;
}
const COVER_PAL = {
  purple: ['#5e3366', '#4f2a58', '#6b3b72', '#573060', '#644064'].map(col),
  green: ['#36622a', '#427031', '#2f5826', '#4f8036', '#3c6a36'].map(col),
  lime: ['#9ab83c', '#a9c446', '#b6c94f', '#8cab36', '#a0bd48'].map(col),
};
function genCover(rnd, plants) {
  const bags = { purple: new Bag(), green: new Bag(), lime: new Bag() }, step = 0.3;
  for (const bed of BEDS) {
    if (bed.cover !== 'dense') continue;   // white shell beds stay crisp: their edge planting is the tuft drifts
    const B = polyBox(bed.poly);
    for (let gy = B.y0; gy < B.y1; gy += step) for (let gx = B.x0; gx < B.x1; gx += step) {
      const x = gx + step * (0.5 + (rnd() - 0.5) * 0.95), y = gy + step * (0.5 + (rnd() - 0.5) * 0.95);
      if (!pointInPoly([x, y], bed.poly) || !coverClear(x, y)) continue;
      if (plants.some(p => p.solid && (p.x - x) ** 2 + (p.y - y) ** 2 < p.r * p.r)) continue;
      const edge = walkEdge(x, y);
      const v = fbm(x * 0.3 + 3.7, y * 0.3 - 1.3, 21) + (edge < 1.4 ? -0.2 : 0.05) + (rnd() - 0.5) * 0.14;
      const kind = v < 0.42 ? 'purple' : v < 0.63 ? 'green' : 'lime';
      const s = (kind === 'lime' ? 0.85 + rnd() * 0.55 : kind === 'purple' ? 1.0 + rnd() * 0.45 : 0.85 + rnd() * 0.45) * (edge < 0.8 ? 0.9 : 1.08);
      const pal = COVER_PAL[kind], c = mulC(pal[Math.floor(rnd() * pal.length)], 0.9 + rnd() * 0.2);
      bags[kind].push(x, groundH(x, y, bed), y, rnd() * TAU, (rnd() - 0.5) * 0.15, s, s * (0.85 + rnd() * 0.3), s, c);
    }
  }
  return bags;
}
const TUFT_SIZE = { fountain: [0.8, 1.12], muhly: [0.75, 1.05], strap: [0.75, 1.0] }, TUFT_R = { fountain: 0.42, muhly: 0.36, strap: 0.3 };
const TUFT_TINT = { fountain: [col('#ffffff'), col('#ead6ab')], muhly: [col('#ffffff'), col('#e2ecc8')], strap: [col('#ffffff'), col('#dfe8d0')] };
function genTufts(rnd, plants) {
  const bags = { fountain: new Bag(), muhly: new Bag(), strap: new Bag() }, placed = [];
  const bedAt = (x, y) => BEDS.find(b => pointInPoly([x, y], b.poly));
  const free = (x, y, r) => placed.every(p => (p.x - x) ** 2 + (p.y - y) ** 2 > ((p.r + r) * 0.72) ** 2) && plants.every(p => (p.x - x) ** 2 + (p.y - y) ** 2 > (p.r * 0.8 + r * 0.35) ** 2);
  // drift seeds: first along the shell edges (fountain grass lining the paths is the photos' strongest motif), then through the beds
  const seeds = [];
  for (const p of SHELL) for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), tx = (b[0] - a[0]) / L, ty = (b[1] - a[1]) / L;
    for (let s = rnd() * 1.4; s < L; s += 1.4 + rnd() * 0.6) {
      let x = a[0] + tx * s - ty * 0.6, y = a[1] + ty * s + tx * 0.6;
      if (pointInPoly([x, y], p)) { x = a[0] + tx * s + ty * 0.6; y = a[1] + ty * s - tx * 0.6; }
      seeds.push({ x, y, ang: Math.atan2(ty, tx), edge: true });
    }
  }
  for (const bed of BEDS) {
    const B = polyBox(bed.poly), nS = Math.round((B.x1 - B.x0) * (B.y1 - B.y0) * (bed.cover === 'dense' ? 0.12 : 0.12));
    for (let i = 0; i < nS; i++) seeds.push({ x: B.x0 + rnd() * (B.x1 - B.x0), y: B.y0 + rnd() * (B.y1 - B.y0), ang: rnd() * TAU, edge: false });
  }
  for (const sd of seeds) {
    const bed = bedAt(sd.x, sd.y); if (!bed) continue;
    const e = walkEdge(sd.x, sd.y);
    if (!sd.edge && e > 3.0 && rnd() > 0.4) continue;
    const u = rnd(), kind = bed.cover === 'shell' ? (u < 0.25 ? 'fountain' : u < 0.5 ? 'muhly' : 'strap') : (u < 0.47 ? 'fountain' : u < 0.75 ? 'muhly' : 'strap');
    const nM = kind === 'strap' ? 3 + Math.floor(rnd() * 3) : 4 + Math.floor(rnd() * 5);
    for (let m = 0, tries = 0; m < nM && tries < nM * 8; tries++) {
      const du = (rnd() - 0.5) * 3.0, dv = (rnd() - 0.5) * 1.0, x = sd.x + du * Math.cos(sd.ang) - dv * Math.sin(sd.ang), y = sd.y + du * Math.sin(sd.ang) + dv * Math.cos(sd.ang);
      const s = lerp(TUFT_SIZE[kind], rnd()), r = TUFT_R[kind] * s;
      if (bedAt(x, y) !== bed || !plantClear(x, y, r * 0.6) || !free(x, y, r)) continue;
      placed.push({ x, y, r });
      const t = TUFT_TINT[kind], c = mulC(mixC(t[0], t[1], Math.pow(rnd(), 2.5)), 0.9 + rnd() * 0.14), w = s * (0.9 + rnd() * 0.35);
      bags[kind].push(x, groundH(x, y, bed), y, rnd() * TAU, (rnd() - 0.5) * 0.12, w, s, w, c);
      m++;
    }
  }
  return bags;
}

// ---------- public ----------
export function buildGarden({ quality = 'hq', camera = null } = {}) {
  const group = new THREE.Group(); group.name = 'garden';
  const tiles = [], rnd = lcg(2513);
  const U = { time: { value: 0 }, wind: { value: new THREE.Vector2(-0.55, -0.83).normalize() }, turf: { value: 1 }, cover: { value: 1 }, tuft: { value: 1 } };
  // modelled plants and outdoor furniture the instanced layers keep clear of
  const outdoor = (p) => !(Math.abs(p.x) < 8.4 && p.y > -6.2 && p.y < 5.8);
  const plants = PLACEMENTS.concat(generatePlanting(7)).filter(p => (p.m === 'plants' || p.m === 'outdoor') && outdoor(p))
    .map(p => ({ x: p.x, y: p.y, r: p.m === 'plants' ? (FOOT[p.i] ?? 0.35) * (p.scale ?? 1) : (p.i === 'plantersBench' ? 0.9 : 0.4), solid: p.m === 'outdoor' }));

  const turfMat = vegMat(U, U.turf, { name: 'turf', rough: 0.82, sway: 0.12, flutter: 0.04, height: 1.0, comp: 1.2, lod: [7, 30], blade: true, widen: 0.05 });
  buildLayer(group, tiles, genTurf(rnd), turfBladeGeo(), turfMat, { tile: TILE.turf, lod: [7, 30], density: U.turf, rnd, name: 'turf' });

  const cover = genCover(rnd, plants);
  for (const [kind, seed, rough] of [['purple', 3, 0.55], ['green', 5, 0.72], ['lime', 7, 0.7]]) {
    const geo = coverGeo(kind, seed);
    const mat = vegMat(U, U.cover, { name: kind, rough, sway: 0.06, flutter: 0.025, height: geo.boundingBox.max.y, comp: 0.45 });
    buildLayer(group, tiles, cover[kind], geo, mat, { tile: TILE.bed, density: U.cover, rnd, name: kind });
  }
  const tufts = genTufts(rnd, plants);
  for (const [kind, seed] of [['fountain', 11], ['muhly', 13], ['strap', 17]]) {
    const geo = tuftGeo(kind, seed), opts = { name: kind, rough: 0.75, sway: kind === 'strap' ? 0.05 : 0.09, flutter: 0.03, height: geo.boundingBox.max.y };
    const mat = vegMat(U, U.tuft, opts), depthMat = patch(new THREE.MeshDepthMaterial(), U, U.tuft, opts, true);
    buildLayer(group, tiles, tufts[kind], geo, mat, { tile: TILE.bed, density: U.tuft, cast: true, depthMat, rnd, name: kind });
  }
  const stats = {};
  for (const t of tiles) { const k = t.mesh.name.slice(7); stats[k] = (stats[k] || 0) + t.n; }

  function setQuality(q) {
    const Q = QUALITY[q] || QUALITY.hq;
    U.turf.value = Q.turf; U.cover.value = Q.cover; U.tuft.value = Q.tuft;
    for (const t of tiles) t.mesh.castShadow = t.cast && Q.shadow;
  }
  function update(t) {
    U.time.value = t;
    const cp = camera?.position;
    for (const tl of tiles) {
      let keep = tl.density.value;
      if (tl.lod && cp) {
        const dx = Math.max(tl.x0 - cp.x, 0, cp.x - tl.x1), dz = Math.max(tl.z0 - cp.z, 0, cp.z - tl.z1), d = Math.hypot(dx, cp.y - tl.y, dz);
        keep *= Math.min(1, Math.max(0, 1 - (d - tl.lod[0]) / (tl.lod[1] - tl.lod[0])));
      }
      tl.mesh.count = Math.min(tl.n, Math.ceil(keep * tl.n));
      tl.mesh.visible = tl.mesh.count > 0;
    }
  }
  setQuality(quality);
  return { group, update, setQuality, stats };
}
