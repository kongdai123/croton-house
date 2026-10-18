// Bedroom/bath styling. Surface-relative origins, metres, front +Z. No added lights.
// Exact listing details: shelf books (g26–28), egg lamp (g27/g52), folded towels (g30/g36).
// Other objects extend the same quiet wood/linen/stoneware palette into the sparsely staged side rooms.
import { THREE, M, box, cyl, sphere, torus, lathe, tube, plane, group, describe,
  setCollider, setMovable, shadow , declare } from '../kit.js';
import { weave, speckle, leaf } from '../proc.js';
import { BED_CORNERS, BOOK_CONTACT } from './props_rooms_parts.js';

const PI = Math.PI;
const once = fn => { let value; return () => value ??= fn(); };
const rng = seed => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
const solid = (color, roughness = 0.8, more = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...more });
function tex(draw, w = 256, h = w) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const fabricMap = once(() => tex((g, w, h) => {
  const r = rng(36); g.fillStyle = '#ede8de'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < w; i += 2) {
    g.fillStyle = `rgba(95,82,62,${0.06 + r() * 0.1})`; g.fillRect(i, 0, 1, h);
    g.fillStyle = `rgba(255,255,255,${0.12 + r() * 0.16})`; g.fillRect(0, i, w, 1);
  }
}));
const linen = once(() => new THREE.MeshPhysicalMaterial({ map: fabricMap(), color: 0xf7f2e8,
  roughness: 0.94, sheen: 0.5, sheenRoughness: 0.9, side: THREE.DoubleSide }));
const sage = once(() => new THREE.MeshPhysicalMaterial({ map: fabricMap(), color: 0xa2aa98,
  roughness: 0.96, sheen: 0.4, side: THREE.DoubleSide }));
const terry = once(() => {
  const map = tex((g, w, h) => { const r = rng(11); g.fillStyle = '#f4f1e9'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 12000; i++) { g.strokeStyle = r() < 0.5 ? '#e0dcd4' : '#ffffff'; g.beginPath();
      const x = r() * w, y = r() * h; g.arc(x, y, 0.6 + r(), 0, PI); g.stroke(); }
  });
  return new THREE.MeshPhysicalMaterial({ map, bumpMap: map, bumpScale: 0.0015, roughness: 1,
    sheen: 0.5, color: 0xffffff, side: THREE.DoubleSide });
});
const L = {
  ceramic: once(() => solid(0xe9e2d5, 0.6, { map: speckle({ base: '#f0eadd', dots: '#938672' }) })),
  glaze: once(() => new THREE.MeshPhysicalMaterial({ color: 0xb2b7a0, roughness: 0.43, clearcoat: 0.15 })),
  soil: once(() => solid(0x3a2e23, 1)), dark: once(() => solid(0x35352d, 0.65)),
  branch: once(() => solid(0x78664b, 0.95)), brass: once(() => solid(0xa68b50, 0.36, { metalness: 0.7 })),
  paper: once(() => solid(0xf3eddf, 0.95, { map: tex((g, w, h) => {
    g.fillStyle = '#f3eddf'; g.fillRect(0, 0, w, h); g.strokeStyle = '#d5cbbb'; g.lineWidth = 0.6;
    for (let y = 1; y < h; y += 3) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  }, 128) })),
  basket: once(() => { const map = weave({ a: '#c5ab7d', b: '#a38b63', scale: 0.5 });
    map.repeat.set(3, 2); return solid(0xf1e5ca, 0.94, { map, bumpMap: map, bumpScale: 0.0015 }); }),
  rope: once(() => solid(0xb39b71, 0.97)), wax: once(() => solid(0xf2e9d8, 0.75)),
  amber: once(() => new THREE.MeshPhysicalMaterial({ color: 0x85522e, roughness: 0.23, metalness: 0.08,
    transparent: true, opacity: 0.84, depthWrite: false })),
  glass: once(() => new THREE.MeshPhysicalMaterial({ color: 0xe7eeea, roughness: 0.13, metalness: 0.02,
    transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide })),
  glassEdge: once(() => solid(0xcdd9d3, 0.16, { transparent: true, opacity: 0.5, depthWrite: false })),
  water: once(() => solid(0xc1d3cd, 0.08, { transparent: true, opacity: 0.14, depthWrite: false })),
  shade: once(() => new THREE.MeshPhysicalMaterial({ map: fabricMap(), color: 0xfff4df, roughness: 0.95,
    emissive: 0xffe1af, emissiveIntensity: 0.20, sheen: 0.6, side: THREE.DoubleSide, userData: { emits: 'lamp' } })),
  // cut-out leaves of the decor greenery: plant foliage (lighting manifest), not baked per vertex like the modelled plants
  leaf: once(() => { const m = solid(0xffffff, 0.68, { map: leaf({ color: '#65794e', vein: '#9aa67a', w: 128, h: 256 }),
    alphaTest: 0.5, side: THREE.DoubleSide }); m.allowOverride = false; return declare(m, { surface: 'foliage', foliage: { groundOcclusion: true, bakedPerVertex: false } }); }),
  book: once(() => [0x74796d, 0xbcb29d, 0x46525a, 0xa28570, 0xddd6c5, 0x565548].map(c => solid(c, 0.9))),
};
function finish(root, id, name, zh, note) { return describe(root, { id: 'props-rooms-' + id, name, zh, note }); }

// Books have separate covers, endpapers and page blocks. Spines face local +Z.
function oneBook(w, d, h, color, title = 'DWELLING') {
  const root = group(box(w - 0.01, h - 0.004, d - 0.009, L.paper(), { y: h / 2, z: -0.003 }));
  for (const y of [0.001, h - 0.001]) root.add(box(w, 0.002, d, color, { y, r: 0.0008, seg: 1 }));
  root.add(box(w, h, 0.003, color, { y: h / 2, z: d / 2 - 0.0015, r: 0.001, seg: 1 }));
  const titleMap = tex((g, W, H) => { g.clearRect(0, 0, W, H); g.fillStyle = '#ece6d5';
    g.textAlign = 'center'; g.font = '10px Georgia'; g.fillText(title, W / 2, H * 0.63); }, 256, 32);
  const label = new THREE.MeshStandardMaterial({ map: titleMap, transparent: true, depthWrite: false, roughness: 1 });
  root.add(plane(w * 0.72, h * 0.65, label, { y: h / 2, z: d / 2 + 0.0002 }));
  return root;
}
function books(seed = 1) {
  const r = rng(seed * 23), root = new THREE.Group(); let y = 0;
  for (let i = 0; i < 2; i++) { const h = 0.017 + r() * 0.012;
    const b = oneBook(0.15 + r() * 0.01, 0.105 + r() * 0.01, h, L.book()[(seed + i) % 6], ['SPACES', 'GARDEN'][i]);
    b.position.set((r() - 0.5) * 0.007, y, 0); b.rotation.y = (r() - 0.5) * 0.09; root.add(b); y += h;
  }
  return finish(root, 'books', 'Bedside reading books', '床头书册', 'g26/g27 books; muted variants for the side bedrooms');
}
function shelfBooks(seed = 2) {
  const r = rng(seed), root = new THREE.Group(); let x = -0.11;
  for (let i = 0; i < 6; i++) {
    const t = 0.02 + r() * 0.019, h = 0.16 + r() * 0.033;
    const b = oneBook(h, 0.15 + r() * 0.013, t, L.book()[(seed + i) % 6], ['HOME', 'FORM', 'GARDEN'][i % 3]);
    b.rotation.z = PI / 2; b.position.set(x + t, h / 2, 0); root.add(b); x += t + 0.002;
  }
  return finish(root, 'shelf-books', 'Small shelf library', '格子柜书册', 'g27/g28 cabinet library');
}
function bowl() {
  const root = group(lathe([[0, 0], [0.037, 0], [0.045, 0.007], [0.065, 0.021], [0.068, 0.026],
    [0.066, 0.03], [0.062, 0.03], [0.058, 0.023], [0.042, 0.012], [0, 0.008]], L.ceramic(), { seg: 28 }));
  root.add(torus(0.015, 0.0015, L.brass(), { x: 0.013, y: 0.012, rx: PI / 2, seg: 16, tube: 6 }));
  return finish(root, 'bowl', 'Stoneware catchall and brass ring', '陶碟与黄铜戒指');
}
function linenLamp() {
  const root = group(lathe([[0, 0], [0.047, 0], [0.068, 0.02], [0.074, 0.075], [0.065, 0.14],
    [0.04, 0.19], [0.027, 0.20], [0.025, 0.21], [0, 0.21]], L.ceramic(), { seg: 28 }));
  root.add(cyl(0.005, 0.005, 0.065, L.brass(), { y: 0.231, seg: 12 }));
  root.add(lathe([[0.114, 0.238], [0.115, 0.241], [0.086, 0.398], [0.083, 0.40]], L.shade(), { seg: 32 }));
  for (const [R, y] of [[0.114, 0.241], [0.084, 0.399]]) root.add(torus(R, 0.002, linen(), { y, rx: PI / 2, seg: 32, tube: 6 }));
  root.add(tube([[0.03, 0.011, -0.025], [0.07, 0.005, -0.04], [0.085, 0.003, -0.06]], 0.0018, L.dark(), { seg: 8, radial: 4 }));
  declare(root, { fixture: { kind: 'lamp' } });
  return finish(root, 'linen-lamp', 'Stoneware lamp with glowing linen shade', '陶瓷亚麻台灯', 'Additional console styling, no scene light');
}
const lattice = once(() => {
  const map = tex((g, W, H) => { g.clearRect(0, 0, W, H); g.strokeStyle = '#ccb991'; g.lineWidth = 3.5;
    for (let k = -H; k < W + H; k += 18) for (const s of [-1, 1]) {
      g.beginPath(); g.moveTo(k, 0); g.lineTo(k + s * H * 0.55, H); g.stroke(); }
  });
  const m = solid(0xf5e7cb, 0.9, { map, alphaTest: 0.45, side: THREE.DoubleSide,
    emissive: 0xc6a26a, emissiveIntensity: 0.1, userData: { emits: 'lamp' } }); m.allowOverride = false; return m;
});
function eggLamp() {
  const root = group(cyl(0.045, 0.05, 0.018, L.brass(), { y: 0.009, seg: 24 }));
  root.add(cyl(0.008, 0.008, 0.05, L.brass(), { y: 0.04, seg: 12 }));
  const profile = [];
  for (let i = 0; i <= 20; i++) { const t = i / 20; profile.push([0.115 * Math.pow(Math.sin(PI * (0.07 + 0.86 * t)), 0.8), 0.027 + 0.32 * t]); }
  root.add(lathe(profile, lattice(), { seg: 32 }));
  root.add(sphere(0.03, L.shade(), { y: 0.15, seg: 16 }));
  declare(root, { fixture: { kind: 'lamp' } });
  return finish(root, 'egg-lamp', 'Woven rattan egg lamp', '藤编蛋形台灯', 'g27/g52 carved side-table lamp');
}

function tumbler() {
  const root = group(lathe([[0, 0], [0.028, 0], [0.032, 0.006], [0.034, 0.095], [0.031, 0.095],
    [0.029, 0.009], [0, 0.008]], L.glass(), { seg: 24 }));
  root.add(torus(0.0325, 0.0013, L.glassEdge(), { y: 0.095, rx: PI / 2, seg: 24, tube: 6 }));
  root.add(cyl(0.03, 0.028, 0.049, L.water(), { y: 0.034, seg: 24 })); return root;
}
function waterSet() {
  const root = new THREE.Group();
  const bottle = lathe([[0, 0], [0.038, 0], [0.044, 0.007], [0.045, 0.12], [0.04, 0.15],
    [0.025, 0.18], [0.023, 0.218], [0.02, 0.218], [0.02, 0.183], [0.041, 0.12], [0.04, 0.009], [0, 0.009]], L.glass(), { seg: 28, x: -0.033 });
  root.add(bottle, cyl(0.037, 0.038, 0.10, L.water(), { x: -0.033, y: 0.06, seg: 24 }));
  root.add(torus(0.0215, 0.0015, L.glassEdge(), { x: -0.033, y: 0.218, rx: PI / 2, seg: 24, tube: 6 }));
  const glass = tumbler(); glass.position.x = 0.063; root.add(glass);
  return finish(root, 'water-set', 'Bedside water carafe and glass', '床头水瓶与玻璃杯');
}

function plant(seed = 3, floor = false) {
  const root = new THREE.Group(), r = rng(seed * 17), H = floor ? 0.26 : 0.13, R = floor ? 0.12 : 0.057;
  root.add(lathe([[0, 0], [R * 0.78, 0], [R * 0.82, 0.006], [R, H - 0.015], [R, H],
    [R * 0.91, H], [R * 0.88, H - 0.019], [0, H - 0.022]], floor ? L.ceramic() : L.glaze(), { seg: 28 }));
  root.add(cyl(R * 0.87, R * 0.87, 0.006, L.soil(), { y: H - 0.019, seg: 24 }));
  for (let j = 0; j < (floor ? 7 : 5); j++) {
    const a = j * 2.4 + r(), height = (floor ? 0.48 : 0.18) * (0.65 + r() * 0.35);
    const reach = (floor ? 0.12 : 0.046) * (0.6 + r() * 0.4);
    const X = Math.cos(a) * reach, Z = Math.sin(a) * reach;
    root.add(tube([[0, H - 0.02, 0], [X * 0.6, H + height * 0.55, Z * 0.6], [X, H + height, Z]],
      floor ? 0.0035 : 0.0017, L.branch(), { seg: 8, radial: 5 }));
    for (let k = 0; k < 4; k++) {
      const t = 0.3 + k * 0.2, side = k % 2 ? 1 : -1, angle = a + side * 1.2;
      const len = floor ? 0.16 : 0.075, wid = len * 0.48;
      const g = new THREE.PlaneGeometry(wid, len, 2, 5), pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) { const u = (pos.getY(i) + len / 2) / len;
        pos.setZ(i, len * 0.1 * Math.sin(u * PI) - len * 0.12 * u * u); }
      g.computeVertexNormals(); const m = shadow(new THREE.Mesh(g, L.leaf())); m.castShadow = false;
      m.rotation.set(-0.65 - r() * 0.4, angle, side * 0.25);
      m.position.set(X * t + Math.sin(angle) * len * 0.35, H + height * t + len * 0.18, Z * t + Math.cos(angle) * len * 0.35);
      root.add(m);
    }
  }
  if (floor) setCollider(root, { w: R * 2, d: R * 2, h: 0.85 });
  return finish(root, floor ? 'floor-plant' : 'plant', floor ? 'Olive sprig in floor pot' : 'Small glazed pot with greenery',
    floor ? '陶盆橄榄枝' : '釉陶小盆栽');
}
const artMaps = once(() => [0, 1].map(seed => tex((g, W, H) => {
  g.fillStyle = '#f2eddf'; g.fillRect(0, 0, W, H); g.fillStyle = seed ? '#d2c1a4' : '#d1d6c3';
  g.beginPath(); g.ellipse(W * 0.52, H * 0.54, W * 0.27, H * 0.34, -0.25, 0, PI * 2); g.fill();
  g.strokeStyle = '#6f7862'; g.lineWidth = 2; g.beginPath(); g.moveTo(W * 0.45, H * 0.85);
  g.bezierCurveTo(W * 0.4, H * 0.57, W * 0.63, H * 0.44, W * 0.55, H * 0.16); g.stroke();
  for (let j = 0; j < 7; j++) { const x = W * (0.44 + 0.12 * Math.sin(j * 0.37)), y = H * (0.23 + j * 0.076);
    g.fillStyle = j % 2 ? '#81886d' : '#9aa087'; g.beginPath(); g.ellipse(x + (j % 2 ? -18 : 18), y, 21, 7, j % 2 ? 0.6 : -0.6, 0, PI * 2); g.fill(); }
}, 384, 512)));
function framedArt(seed = 1) {
  const root = new THREE.Group(), W = 0.285, H = 0.375, frame = M.oak(), pic = new THREE.Group();
  pic.add(box(W, H, 0.016, frame, { y: H / 2, r: 0.003, seg: 1 }));
  pic.add(plane(W - 0.025, H - 0.025, L.paper(), { y: H / 2, z: 0.0082 }));
  pic.add(plane(W - 0.075, H - 0.075, solid(0xffffff, 0.94, { map: artMaps()[seed % 2] }), { y: H / 2, z: 0.0085 }));
  pic.rotation.x = -0.10; pic.position.set(0, 0.0008, 0.021); root.add(pic);
  // A folding easel back supports the frame, keeping the bottom resting on the dresser.
  root.add(box(0.065, H * 0.69, 0.005, L.dark(), { y: H * 0.34, z: -0.028, rx: 0.24, r: 0.001, seg: 1 }));
  return finish(root, 'art', 'Oak framed botanical print', '橡木框植物画');
}

// Soft cloth folds are meshes rather than flat rectangles. These start exactly at the supporting surface.
function cloth(w, d, mat, amplitude = 0.004, seed = 1) {
  const geo = new THREE.PlaneGeometry(w, d, 24, 12); geo.rotateX(-PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i);
    p.setY(i, 0.002 + amplitude * (1 + Math.sin(x * 38 + seed) * Math.cos(z * 13)) / 2); }
  geo.computeVertexNormals(); return shadow(new THREE.Mesh(geo, mat));
}
function foldedLinen(seed = 1) {
  const root = new THREE.Group(), material = seed % 2 ? linen() : sage();
  for (let j = 0; j < 3; j++) root.add(box(0.265 - j * 0.01, 0.018, 0.235, material,
    { r: 0.008, seg: 2, y: 0.009 + j * 0.018, z: j * 0.003 }));
  const top = cloth(0.24, 0.21, material, 0.004, seed); top.position.y = 0.054; root.add(top);
  return finish(root, 'folded-linen', 'Folded linen on closet shelf', '衣柜折叠亚麻织物', 'Tasteful addition to the pine cubbies of g29');
}
function basket(seed = 1) {
  const root = new THREE.Group(), R = 0.185, H = 0.31;
  root.add(lathe([[0, 0], [R * 0.8, 0], [R * 0.86, 0.012], [R, H - 0.018], [R, H],
    [R - 0.012, H], [R - 0.015, H - 0.015], [R * 0.8, 0.022], [0, 0.022]], L.basket(), { seg: 32 }));
  root.add(torus(R - 0.005, 0.007, L.rope(), { y: H, rx: PI / 2, seg: 32, tube: 6 }));
  for (const s of [-1, 1]) root.add(tube([[s * 0.15, 0.28, -0.038], [s * 0.195, 0.37, 0],
    [s * 0.15, 0.28, 0.038]], 0.009, L.rope(), { seg: 12, radial: 6 }));
  const rolled = group(cyl(0.085, 0.083, 0.19, linen(), { seg: 24 }));
  const spiral = [];
  for (let i = 0; i <= 60; i++) { const t = i / 60, a = t * PI * 6, radius = 0.009 + t * 0.07;
    spiral.push([Math.cos(a) * radius, 0.0955, Math.sin(a) * radius]); }
  rolled.add(tube(spiral, 0.0015, L.rope(), { seg: 60, radial: 4 }));
  rolled.position.y = 0.25; rolled.rotation.set(0.2, 0, -0.15); root.add(rolled);
  // Blanket drapes over the front rim, continuing into the basket.
  const geo = new THREE.PlaneGeometry(0.20, 0.31, 12, 20), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), t = (p.getY(i) + 0.155) / 0.31;
    p.setXYZ(i, x, 0.14 + 0.18 * Math.sin(t * PI / 2), 0.195 - 0.14 * t * t + 0.005 * Math.sin(x * 75)); }
  geo.computeVertexNormals(); root.add(shadow(new THREE.Mesh(geo, linen())));
  for (let i = 0; i < 12; i++) { const x = -0.092 + i * 0.0167;
    root.add(tube([[x, 0.143, 0.195], [x + 0.002, 0.122, 0.201]], 0.0012, linen(), { seg: 3, radial: 4 })); }
  setMovable(root, { mass: 2.5, radius: 0.21 });
  return finish(root, 'basket', 'Seagrass basket with a linen throw', '海草编篮与亚麻毯');
}
function accentPillow(seed = 1) {
  const root = new THREE.Group(), mat = seed % 2 ? sage() : linen();
  root.add(box(0.44, 0.23, 0.17, mat, { y: 0.115, r: 0.074, seg: 4 }));
  root.add(tube([[-0.20, 0.023, 0.047], [0, 0.015, 0.07], [0.20, 0.023, 0.047], [0.213, 0.125, 0.047],
    [0.20, 0.232, 0.047], [0, 0.240, 0.07], [-0.20, 0.232, 0.047], [-0.213, 0.125, 0.047]],
  0.0016, mat, { seg: 48, radial: 4, closed: true }));
  // The lower seam rests on the mattress.
  return finish(root, 'accent-pillow', 'Sage linen lumbar cushion', '鼠尾草色亚麻腰枕');
}
function slippers() {
  const root = new THREE.Group();
  for (const s of [-1, 1]) {
    const shoe = group(box(0.085, 0.012, 0.245, L.rope(), { y: 0.006, r: 0.035, seg: 3 }));
    shoe.add(box(0.087, 0.040, 0.12, linen(), { y: 0.025, z: -0.05, r: 0.025, seg: 3 }));
    shoe.add(box(0.052, 0.010, 0.095, sage(), { y: 0.017, z: 0.048, r: 0.020, seg: 2 }));
    shoe.position.set(s * 0.059, 0, s * 0.025); shoe.rotation.y = s * 0.10; root.add(shoe);
  }
  return finish(root, 'slippers', 'Pair of linen house slippers', '亚麻家居拖鞋');
}
function candle() {
  const root = group(lathe([[0, 0], [0.036, 0], [0.041, 0.005], [0.042, 0.083], [0.037, 0.083],
    [0.034, 0.01], [0, 0.01]], L.ceramic(), { seg: 28 }));
  root.add(cyl(0.036, 0.036, 0.005, L.wax(), { y: 0.071, seg: 24 }));
  root.add(cyl(0.0015, 0.0015, 0.011, L.dark(), { y: 0.080, seg: 6 }));
  return finish(root, 'candle', 'Stoneware candle', '陶杯蜡烛');
}

function soapTray() {
  const root = group(box(0.145, 0.012, 0.095, L.ceramic(), { y: 0.006, r: 0.018, seg: 2 }));
  root.add(lathe([[0, 0], [0.025, 0], [0.029, 0.005], [0.029, 0.105], [0.019, 0.117], [0.014, 0.125], [0, 0.125]],
    L.amber(), { x: -0.032, y: 0.012, seg: 28 }));
  root.add(cyl(0.015, 0.015, 0.015, L.dark(), { x: -0.032, y: 0.144, seg: 16 }));
  root.add(cyl(0.003, 0.003, 0.016, L.brass(), { x: -0.032, y: 0.159, seg: 8 }));
  root.add(box(0.032, 0.008, 0.012, L.dark(), { x: -0.022, y: 0.170, r: 0.003, seg: 1 }));
  root.add(box(0.006, 0.006, 0.011, L.dark(), { x: -0.007, y: 0.167, r: 0.002, seg: 1 }));
  root.add(box(0.038, 0.018, 0.055, L.glaze(), { x: 0.042, y: 0.021, r: 0.006, seg: 2 }));
  return finish(root, 'soap-tray', 'Amber soap pump on stoneware tray', '琥珀皂液瓶与陶盘');
}
function towels(seed = 1) {
  const root = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    root.add(box(0.18 - i * 0.007, 0.025, 0.09, terry(), { y: 0.0125 + i * 0.025, z: i * 0.003, r: 0.011, seg: 2 }));
    root.add(box(0.16, 0.004, 0.005, linen(), { y: 0.015 + i * 0.025, z: 0.043 + i * 0.003, r: 0.001, seg: 1 }));
  }
  return finish(root, 'towels', 'Two neatly folded hand towels', '折叠手巾', 'g30/g36 vanity towels');
}
// Wall items use z=0 as the wall contact plane; mounting height supplied by placement.h.
function hangingTowel(w = 0.30, length = 0.49) {
  const geo = new THREE.PlaneGeometry(w, 1, 16, 32), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), t = p.getY(i) + 0.5, a = PI * t;
    // U-fold over the rail; front and shorter back half continue down from the top arc.
    let y, z;
    if (t < 0.43) { y = -length + t / 0.43 * length; z = 0.114; }
    else if (t < 0.57) { const angle = (t - 0.43) / 0.14 * PI; y = Math.sin(angle) * 0.018; z = 0.096 + Math.cos(angle) * 0.018; }
    else { y = -(t - 0.57) / 0.43 * (length - 0.07); z = 0.078; }
    p.setXYZ(i, x, y + 0.003 * Math.sin(x * 48), z + 0.003 * Math.cos(x * 52) * Math.sin(a));
  }
  geo.computeVertexNormals(); return shadow(new THREE.Mesh(geo, terry()));
}
function towelBar() {
  const root = new THREE.Group(), metal = M.steel();
  for (const s of [-1, 1]) {
    root.add(cyl(0.021, 0.021, 0.006, metal, { x: s * 0.265, z: 0.003, rx: PI / 2, seg: 16 }));
    root.add(box(0.016, 0.016, 0.088, metal, { x: s * 0.265, z: 0.048, r: 0.004, seg: 1 }));
  }
  root.add(cyl(0.008, 0.008, 0.546, metal, { z: 0.096, rz: PI / 2, seg: 16 }));
  root.add(hangingTowel());
  for (const y of [-0.415, -0.395]) root.add(box(0.298, 0.009, 0.003, linen(), { y, z: 0.116, r: 0.001, seg: 1 }));
  return finish(root, 'towel-bar', 'Brushed nickel towel bar with white towel', '镍色毛巾杆与白毛巾');
}
function towelRing() {
  const root = group(cyl(0.021, 0.021, 0.006, M.steel(), { z: 0.003, rx: PI / 2, seg: 16 }));
  root.add(box(0.015, 0.014, 0.05, M.steel(), { z: 0.03, r: 0.004, seg: 1 }));
  root.add(torus(0.078, 0.0045, M.steel(), { y: -0.075, z: 0.055, seg: 28, tube: 8 }));
  const towel = hangingTowel(0.13, 0.32); towel.position.set(0, -0.15, -0.04); root.add(towel);
  return finish(root, 'towel-ring', 'Hand towel on nickel ring', '圆环手巾架');
}
function bathMat(seed = 1) {
  const root = group(cloth(0.66, 0.44, terry(), 0.003, seed));
  for (const z of [-0.186, 0.186]) root.add(box(0.63, 0.004, 0.013, linen(), { y: 0.002, z, r: 0.001, seg: 1 }));
  return finish(root, 'bath-mat', 'Warm white cotton bath mat', '米白棉浴垫');
}
function paperRoll() {
  const root = new THREE.Group(), metal = M.steel();
  root.add(cyl(0.024, 0.024, 0.007, metal, { x: -0.087, z: 0.0035, rx: PI / 2, seg: 16 }));
  root.add(tube([[-0.087, 0, 0.004], [-0.087, 0, 0.10], [0.09, 0, 0.10]], 0.007, metal, { seg: 12, radial: 8 }));
  const roll = lathe([[0.017, -0.055], [0.052, -0.055], [0.055, -0.05], [0.055, 0.05],
    [0.052, 0.055], [0.017, 0.055], [0.017, -0.055]], L.paper(), { seg: 28 });
  roll.rotation.z = PI / 2; roll.position.z = 0.10; root.add(roll);
  root.add(box(0.10, 0.072, 0.001, L.paper(), { y: -0.071, z: 0.153 }));
  return finish(root, 'paper-roll', 'Toilet paper on nickel holder', '厕纸与镍色纸架');
}
function robeHook() {
  const root = group(cyl(0.02, 0.02, 0.007, M.steel(), { z: 0.0035, rx: PI / 2, seg: 16 }));
  root.add(tube([[0, 0, 0.004], [0, 0, 0.047], [0, 0.021, 0.053]], 0.006, M.steel(), { seg: 8, radial: 6 }));
  // A linen robe gathers at the hook, spreads at the shoulder, and hangs clear of the floor.
  const geo = new THREE.PlaneGeometry(1, 1, 24, 28), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const u = p.getX(i) * 2, t = 0.5 - p.getY(i);
    const w = t < 0.19 ? 0.05 + t * 1.1 : 0.26 - (t - 0.19) * 0.1;
    p.setXYZ(i, u * w, -t * 1.02, 0.062 + 0.018 * Math.sin(u * PI * 4) * Math.sin(t * PI)); }
  geo.computeVertexNormals(); root.add(shadow(new THREE.Mesh(geo, linen())));
  root.add(tube([[-0.17, -0.50, 0.07], [0, -0.51, 0.09], [0.17, -0.50, 0.07]], 0.011, linen(), { seg: 16, radial: 6 }));
  for (const s of [-1, 1]) root.add(tube([[s * 0.19, -0.17, 0.07], [s * 0.28, -0.29, 0.07], [s * 0.22, -0.55, 0.07]],
    0.046, linen(), { seg: 14, radial: 8 }));
  return finish(root, 'robe', 'Linen robe on a wall hook', '挂钩亚麻浴袍');
}

// Second pass: larger silhouettes at eye level. Wall origin is its back contact plane;
// mounting placements are 3 mm into the room from the measured interior wall face.
const printMats = once(() => [0, 1, 2].map(seed => solid(0xffffff, 0.95, { map: tex((g, W, H) => {
  const r = rng(72 + seed); g.fillStyle = '#efe7d7'; g.fillRect(0, 0, W, H);
  const palettes = [['#b0b59a', '#627364', '#c5ac87'], ['#c69270', '#aab19a', '#625e4f'], ['#b5a584', '#727d70', '#d4c8b0']];
  const c = palettes[seed];
  g.fillStyle = c[0]; g.beginPath(); g.arc(W * .64, H * .30, W * .18, 0, 2 * PI); g.fill();
  for (let j = 0; j < 3; j++) { g.fillStyle = c[j]; g.beginPath(); g.moveTo(0, H);
    g.lineTo(0, H * (.58 + j * .12));
    g.bezierCurveTo(W * .3, H * (.35 + j * .18), W * .62, H * (.86 - j * .14), W, H * (.55 + j * .14));
    g.lineTo(W, H); g.closePath(); g.fill(); }
  g.globalAlpha = .06; for (let i = 0; i < 4000; i++) { g.fillStyle = r() < .5 ? '#fff' : '#453e32'; g.fillRect(r() * W, r() * H, 1, 1); }
}, 384, 512) })));
function wallPrint(seed = 0, wide = false) {
  const root = new THREE.Group(), w = wide ? .88 : .60, h = wide ? .56 : .74;
  root.add(box(w, h, .026, M.oak(), { y: h / 2, z: .013, r: .004, seg: 1 }));
  root.add(plane(w - .032, h - .032, L.paper(), { y: h / 2, z: .0262 }));
  root.add(plane(w - .11, h - .11, printMats()[seed % 3], { y: h / 2, z: .0266 }));
  return finish(root, 'wall-print', 'Oak framed landscape study', '橡木框风景画', 'Complementary art in the g26–35 natural palette');
}
const mirrorMat = once(() => declare(Object.assign(solid(0xd6dfd8, .12, { metalness: 1 }), { name: 'mirror' }), { surface: 'mirror' }));
function roundMirror() {
  const root = group(cyl(.31, .31, .018, mirrorMat(), { y: .33, z: .019, rx: PI / 2, seg: 48 }));
  root.add(torus(.318, .017, M.oak(), { y: .33, z: .021, seg: 48, tube: 8 }));
  return finish(root, 'round-mirror', 'Round oak framed mirror', '圆形橡木镜');
}
function wovenHanging() {
  const root = group(cyl(.012, .012, .59, M.oak(), { y: .70, z: .028, rz: PI / 2, seg: 12 }));
  root.add(box(.49, .49, .012, L.basket(), { y: .432, z: .025 }));
  for (let j = 0; j < 19; j++) { const x = -.225 + j * .025, len = .09 + .07 * (1 - Math.abs(x) / .225);
    root.add(tube([[x, .20, .031], [x + .003, .15, .033], [x, .20 - len, .031]], .004, linen(), { seg: 5, radial: 4 })); }
  for (const s of [-1, 1]) root.add(tube([[s * .19, .69, .025], [0, .795, .018]], .002, L.rope(), { seg: 5, radial: 4 }));
  return finish(root, 'woven-hanging', 'Handwoven flax wall hanging', '手织亚麻壁挂');
}
function budVase(seed = 1) {
  const root = group(lathe([[0, 0], [.032, 0], [.046, .035], [.043, .10], [.025, .145], [.019, .16], [.019, .175], [.014, .175], [.014, .15]], L.glaze(), { seg: 28 }));
  const r = rng(seed);
  for (let j = 0; j < 5; j++) { const a = j * 2.4, x = Math.sin(a) * .06, z = Math.cos(a) * .035, y = .31 + r() * .10;
    root.add(tube([[0, .145, 0], [x * .5, .25, z * .5], [x, y, z]], .0015, L.branch(), { seg: 8, radial: 4 }));
    root.add(sphere(.013, L.rope(), { x, y, z, sy: 2.6, sx: .6, sz: .6, seg: 8 })); }
  return finish(root, 'bud-vase', 'Sage bud vase with dried stems', '鼠尾草绿花瓶与干枝', 'Dried stems echo g27/g28 cabinet vase');
}
function bookends(seed = 1) {
  const root = new THREE.Group(); let x = -.13;
  for (let j = 0; j < 5; j++) { const t = .026 + (j % 3) * .006, h = .21 + (j % 3) * .018;
    const b = oneBook(h, .15, t, L.book()[(seed + j) % 6], ['DWELL', 'FORM', 'GARDEN', 'LINEN', 'HOMES'][j]);
    b.rotation.z = PI / 2; b.position.set(x + t, h / 2, 0); root.add(b); x += t + .003; }
  const lean = oneBook(.23, .15, .023, L.book()[(seed + 3) % 6], 'STUDIO');
  lean.rotation.z = PI / 2 - .12; lean.position.set(x + .045, .116, 0); root.add(lean);
  for (const s of [-1, 1]) { root.add(box(.075, .008, .17, L.brass(), { x: s * .17, y: .004, r: .003, seg: 1 }));
    root.add(box(.007, .16, .17, L.brass(), { x: s * .197, y: .08, r: .003, seg: 1 })); }
  return finish(root, 'bookends', 'Design books with brass bookends', '设计书与黄铜书挡', 'Library extends g26–28 books');
}
function floatingShelf(seed = 1) {
  const root = group(box(.76, .034, .18, M.oak(), { y: .017, z: .09, r: .006, seg: 1 }));
  const library = bookends(seed); library.scale.setScalar(.72); library.position.set(-.13, .034, .098); root.add(library);
  const vase = budVase(seed); vase.position.set(.26, .034, .095); root.add(vase);
  return finish(root, 'floating-shelf', 'Oak shelf with books and dried stems', '橡木浮架、书册与干枝');
}
function pegTote() {
  const root = group(box(.54, .068, .024, M.oak(), { y: .70, z: .012, r: .008, seg: 1 }));
  for (const x of [-.19, 0, .19]) root.add(cyl(.012, .012, .053, M.oak(), { x, y: .70, z: .046, rx: PI / 2, seg: 12 }));
  root.add(box(.30, .32, .08, linen(), { x: -.09, y: .28, z: .067, r: .038, seg: 3 }));
  for (const z of [.073, .103]) root.add(tube([[-.20, .42, z], [-.13, .68, z], [-.02, .68, z], [.025, .43, z]], .009, linen(), { seg: 14, radial: 5 }));
  root.add(box(.11, .11, .003, sage(), { x: -.09, y: .28, z: .109, r: .003, seg: 1 }));
  const hat = group(cyl(.143, .143, .008, L.basket(), { rx: PI / 2, seg: 32 }), sphere(.094, L.basket(), { z: .027, sz: .65, seg: 16 }));
  hat.position.set(.16, .60, .067); root.add(hat);
  return finish(root, 'peg-tote', 'Oak pegs with linen tote and straw hat', '橡木挂钩、帆布袋与草帽');
}
const figLeaf = once(() => {
  const map = tex((g, W, H) => {
    g.clearRect(0, 0, W, H); g.fillStyle = '#597344'; g.beginPath(); g.moveTo(W * .5, H * .96);
    g.bezierCurveTo(W * .31, H * .86, W * .10, H * .87, W * .12, H * .55);
    g.bezierCurveTo(W * .23, H * .30, W * .06, H * .20, W * .5, H * .035);
    g.bezierCurveTo(W * .94, H * .20, W * .77, H * .30, W * .88, H * .55);
    g.bezierCurveTo(W * .90, H * .87, W * .69, H * .86, W * .5, H * .96); g.fill();
    g.strokeStyle = '#9ca878'; g.lineWidth = 2; g.beginPath(); g.moveTo(W * .5, H * .93); g.lineTo(W * .5, H * .08); g.stroke();
    g.lineWidth = 1; for (let j = 0; j < 8; j++) for (const s of [-1, 1]) { const y = H * (.21 + j * .08);
      g.beginPath(); g.moveTo(W * .5, y + H * .08); g.quadraticCurveTo(W * (.5 + s * .14), y, W * (.5 + s * .29), y - H * .03); g.stroke(); }
  });
  const m = solid(0xffffff, .76, { map, alphaTest: .5, side: THREE.DoubleSide }); m.allowOverride = false; return declare(m, { surface: 'foliage', foliage: { groundOcclusion: true, bakedPerVertex: false } });   // a fig leaf: plant foliage
});
function fiddleFig(seed = 1) {
  const root = group(lathe([[0, 0], [.155, 0], [.169, .015], [.198, .31], [.20, .35], [.182, .35], [.18, .32], [0, .32]], L.ceramic(), { seg: 32 }));
  root.add(cyl(.178, .178, .008, L.soil(), { y: .325, seg: 24 }));
  root.add(tube([[0, .32, 0], [.025, .80, .012], [-.015, 1.37, 0]], .009, L.branch(), { seg: 12, radial: 7 }));
  const r = rng(seed);
  for (let j = 0; j < 12; j++) { const a = j * 2.4 + r() * .2, h = .65 + j * .067, reach = .12 + r() * .025;
    const x = Math.sin(a) * reach, z = Math.cos(a) * reach;
    root.add(tube([[.01, h - .09, 0], [x * .6, h - .015, z * .6], [x, h, z]], .003, L.branch(), { seg: 5, radial: 4 }));
    const geo = new THREE.PlaneGeometry(.18, .30, 4, 6), p = geo.attributes.position;
    for (let k = 0; k < p.count; k++) { const u = (p.getY(k) + .15) / .30; p.setZ(k, .035 * Math.sin(u * PI) + .025 * Math.pow(p.getX(k) / .09, 2)); }
    geo.computeVertexNormals(); const m = new THREE.Mesh(geo, figLeaf()); m.position.set(x, h + .08, z); m.rotation.set(-.45, a, .12 * Math.sin(a)); m.receiveShadow = true; root.add(m);
  }
  setCollider(root, { w: .40, d: .40, h: 1.55 });
  return finish(root, 'fiddle-fig', 'Fiddle leaf fig in warm ceramic pot', '暖陶盆琴叶榕');
}
function pouf() {
  const root = group(sphere(.265, sage(), { y: .175, sy: .66, seg: 24 }));
  for (const y of [.095, .24]) root.add(torus(.23, .002, linen(), { y, rx: PI / 2, seg: 32, tube: 4 }));
  setMovable(root, { mass: 3.5, radius: .27 });
  return finish(root, 'pouf', 'Soft sage linen floor pouf', '鼠尾草绿亚麻脚凳');
}
function magazineStool(seed = 1) {
  const root = group(cyl(.17, .17, .034, M.oak(), { y: .425, seg: 32 }));
  for (let j = 0; j < 3; j++) { const a = j * PI * 2 / 3;
    root.add(tube([[Math.sin(a) * .128, .006, Math.cos(a) * .128], [Math.sin(a) * .10, .408, Math.cos(a) * .10]], .017, M.oak(), { seg: 3, radial: 8 })); }
  const b = books(seed); b.scale.set(1.5, 1, 1.5); b.position.y = .442; root.add(b);
  setCollider(root, { w: .34, d: .34, h: .49 });
  return finish(root, 'magazine-stool', 'Oak stool with architecture magazines', '橡木小凳与建筑杂志');
}
const knitMat = once(() => { const map = tex((g, w, h) => {
  g.fillStyle = '#b9a17e'; g.fillRect(0, 0, w, h); g.lineWidth = 2;
  for (let x = 0; x < w; x += 12) for (let y = -12; y < h; y += 14) {
    g.strokeStyle = '#ded0b3'; g.beginPath(); g.moveTo(x + 1, y); g.lineTo(x + 6, y + 10); g.lineTo(x + 11, y); g.stroke(); }
}); return new THREE.MeshPhysicalMaterial({ map, bumpMap: map, bumpScale: .0015, roughness: .96, sheen: .6, side: THREE.DoubleSide }); });
function cornerThrow(seed = 0) {
  const mesh = cloth(.42, .56, knitMat(), .003, 2), grid = BED_CORNERS[seed];
  const contact = (x, z) => {
    if (!grid) return 0;
    const ix = Math.max(0, Math.min(24, Math.round((x / .42 + .5) * 24)));
    const iz = Math.max(0, Math.min(12, Math.round((z / .56 + .5) * 12)));
    return grid[iz][ix];
  };
  const pos = mesh.geometry.attributes.position;
  if (grid) { for (let j = 0; j < pos.count; j++) pos.setY(j, contact(pos.getX(j), pos.getZ(j)) + .0015); mesh.geometry.computeVertexNormals(); }
  const root = group(mesh);
  for (let j = 0; j < 18; j++) { const x = -.20 + j * .023;
    const y = contact(x, .28);
    root.add(tube([[x, y + .0015, .28], [x + .003, y, .31]], .0018, L.rope(), { seg: 3, radial: 4 })); }
  return finish(root, 'corner-throw', 'Oatmeal knit throw folded at a bed corner', '床角燕麦色针织毯', 'Small corner fold keeps mattress edge centres free');
}
const pagePrint = once(() => solid(0xffffff, .96, { map: tex((g, W, H) => {
  g.fillStyle = '#f5eedf'; g.fillRect(0, 0, W, H); g.fillStyle = '#74836d'; g.fillRect(20, 25, W - 40, H * .34);
  g.fillStyle = '#ada38f'; for (let j = 0; j < 13; j++) g.fillRect(22, H * .49 + j * 6, W - 44 - (j % 4) * 8, 1);
}, 128, 256) }));
function openBook(seed = 0) {
  const cover = shadow(new THREE.Mesh(new THREE.BoxGeometry(.31, .006, .205, 24, 1, 12), L.book()[2]));
  cover.position.y = .003;
  const root = group(cover);
  for (const s of [-1, 1]) {
    const geo = new THREE.PlaneGeometry(.15, .194, 12, 12); geo.rotateX(-PI / 2); const p = geo.attributes.position;
    for (let j = 0; j < p.count; j++) { const u = (p.getX(j) + .075) / .15; p.setX(j, s * (.003 + u * .15)); p.setY(j, .0146 + .009 * Math.sin(u * PI)); }
    if (s < 0) { const ix = geo.index.array; for (let j = 0; j < ix.length; j += 3) [ix[j], ix[j + 2]] = [ix[j + 2], ix[j]]; }
    geo.computeVertexNormals(); root.add(shadow(new THREE.Mesh(geo, pagePrint())));
    const pages = shadow(new THREE.Mesh(new THREE.BoxGeometry(.15, .009, .194, 12, 1, 12), L.paper()));
    pages.position.set(s * .077, .010, 0); root.add(pages);
  }
  if (seed === 1) root.traverse(m => {
    if (!m.isMesh) return;
    const p = m.geometry.attributes.position;
    for (let j = 0; j < p.count; j++) {
      const u = Math.max(0, Math.min(24, ((p.getX(j) + m.position.x) / .31 + .5) * 24));
      const v = Math.max(0, Math.min(12, ((p.getZ(j) + m.position.z) / .205 + .5) * 12));
      const x = Math.min(23, Math.floor(u)), z = Math.min(11, Math.floor(v)), a = u - x, b = v - z;
      const h = (1 - b) * ((1 - a) * BOOK_CONTACT[z][x] + a * BOOK_CONTACT[z][x + 1]) +
        b * ((1 - a) * BOOK_CONTACT[z + 1][x] + a * BOOK_CONTACT[z + 1][x + 1]);
      p.setY(j, p.getY(j) + h + .0015);
    }
    m.geometry.computeVertexNormals();
  });
  return finish(root, 'open-book', 'Open architecture book on the duvet', '被褥上的建筑书');
}
function readingGlasses(seed = 1) {
  const root = books(seed); root.scale.set(1.35, 1, 1.35); root.updateMatrixWorld(true);
  const top = new THREE.Box3().setFromObject(root).max.y;
  const glasses = new THREE.Group();
  for (const s of [-1, 1]) { const ring = torus(.021, .0012, L.brass(), { x: s * .024, y: .006, rx: PI / 2, seg: 20, tube: 5 }); ring.scale.z = .76; glasses.add(ring);
    glasses.add(tube([[s * .044, .008, 0], [s * .045, .011, -.06], [s * .04, .008, -.073]], .0012, L.brass(), { seg: 8, radial: 4 })); }
  glasses.add(tube([[-.004, .006, 0], [0, .009, .003], [.004, .006, 0]], .0012, L.brass(), { seg: 4, radial: 4 }));
  glasses.position.set(0, top, .015); root.add(glasses);
  return finish(root, 'reading-glasses', 'Reading glasses on design books', '设计书与阅读眼镜');
}
function candleTray() {
  const root = group(box(.24, .014, .145, M.oak(), { y: .007, r: .024, seg: 2 }));
  const c = candle(); c.position.set(-.054, .014, 0); root.add(c);
  root.add(box(.052, .016, .035, L.book()[3], { x: .055, y: .022, z: .023, r: .002, seg: 1 }));
  root.add(box(.044, .002, .027, L.paper(), { x: .055, y: .031, z: .023 }));
  return finish(root, 'candle-tray', 'Oak tray with candle and matchbox', '橡木托盘、蜡烛与火柴');
}
function diffuser() {
  const root = group(lathe([[0, 0], [.036, 0], [.041, .014], [.040, .09], [.023, .112], [.022, .126], [.016, .126]], L.amber(), { seg: 24 }));
  for (let j = 0; j < 7; j++) { const a = j * 2.4;
    root.add(tube([[Math.sin(a) * .01, .085, Math.cos(a) * .01], [Math.sin(a) * .043, .285 + (j % 3) * .018, Math.cos(a) * .043]], .0015, L.rope(), { seg: 3, radial: 4 })); }
  return finish(root, 'diffuser', 'Amber glass reed diffuser', '琥珀玻璃藤条香薰');
}
function clockRadio() {
  const root = group(box(.17, .095, .072, M.oak(), { y: .048, r: .014, seg: 2 }));
  root.add(box(.148, .071, .004, L.dark(), { y: .048, z: .038, r: .009, seg: 1 }));
  for (let j = 0; j < 6; j++) root.add(box(.065, .0015, .001, L.rope(), { x: -.033, y: .025 + j * .009, z: .0405 }));
  root.add(cyl(.014, .014, .008, L.brass(), { x: .044, y: .047, z: .043, rx: PI / 2, seg: 16 }));
  return finish(root, 'clock-radio', 'Small oak bedside radio', '橡木床头收音机');
}
function towelBasket() {
  const root = group(box(.25, .11, .17, L.basket(), { y: .055, r: .035, seg: 2 }));
  for (const x of [-.07, .015, .085]) { root.add(cyl(.039, .039, .15, terry(), { x, y: .115, rx: PI / 2, seg: 20 }));
    root.add(torus(.028, .0015, linen(), { x, y: .115, z: .076, seg: 20, tube: 4 })); }
  return finish(root, 'towel-basket', 'Woven vanity basket with rolled towels', '编织篮与卷毛巾', 'g30/g36 towel palette, complementary basket');
}

export const items = {
  wallArt: seed => wallPrint(seed ?? 0), wideArt: seed => wallPrint(seed ?? 0, true),
  roundMirror, wovenHanging, budVase, bookends, floatingShelf, pegTote, fiddleFig,
  pouf, magazineStool, cornerThrow, openBook, readingGlasses, candleTray, diffuser, clockRadio, towelBasket,
  books, shelfBooks, bowl, linenLamp, eggLamp, waterSet, framedArt, foldedLinen, basket, accentPillow,
  slippers, candle, soapTray, towels, towelBar, towelRing, bathMat, paperRoll, robeHook,
  plant: (seed = 3) => plant(seed), floorPlant: (seed = 7) => plant(seed, true),
};
