// Material library: scanned PBR sets from Poly Haven (CC0) in assets/tex/<set>, plus procedural canvas textures (proc.js).
// Every material is created once and shared. Units are metres; `repeat` = texture tiles per metre.
import * as THREE from 'three';
import { shaderReplace as rep } from './foliage_bake.js';
import * as proc from './proc.js';

const loader = new THREE.ImageLoader();
const cache = new Map();
export const MAX_ANISO = 8;
export let anisotropy = MAX_ANISO;
export function setAnisotropy(v) { anisotropy = v; }
// Scanned texture sets: 1k and 512 are WebP builds of the 2k JPEG library (tools/tex_sets.sh). Only the chosen set is requested.
// There is no 4k master: ?tex=4k loads assets/tex/4k/ when tools/build.mjs finds that directory, otherwise the 2k JPEGs.
const TEX_4K = globalThis.CROTON_TEX_4K;
const TEX_SETS = { 512: ['assets/tex/512/', 'webp'], '1k': ['assets/tex/1k/', 'webp'], '2k': ['assets/tex/', 'jpg'], '4k': TEX_4K ? ['assets/tex/4k/', TEX_4K] : ['assets/tex/', 'jpg'] };
let [texDir, texExt] = TEX_SETS['1k'];
export function setTextureSet(name) { [texDir, texExt] = TEX_SETS[name] ?? TEX_SETS['1k']; }
// Longest texture edge the device tier keeps (laptop: the 4k scans drop to 2k; mobile: everything to 1k).
let textureCap = Infinity;
export function setTextureCap(v) { textureCap = v; }
// Chromium decodes (and downsizes) the scans off the main thread, so the first draw only uploads pixels.
// Elsewhere the image is used as loaded and drawn into a smaller canvas only when it exceeds the cap.
const offThread = !!(navigator.userAgentData && window.createImageBitmap);
// Each scanned texture counts as pending until it has downloaded and decoded (or failed); the loading bar follows the count.
const pending = new Set();
let requested = 0, settled = 0;
export function texturesDecoded(onProgress, timeout = 30000) {
  const tick = setInterval(() => onProgress?.(requested ? settled / requested : 1), 200);
  return Promise.race([Promise.allSettled([...pending]), new Promise(r => setTimeout(r, timeout))]).finally(() => clearInterval(tick));
}
// Resolves to the image a texture should hold and whether it still needs flipping on upload.
function capImage(img) {
  const size = Math.max(img?.width || 0, img?.height || 0), k = Math.min(1, textureCap / size);
  if (!size) return { image: img, flipY: true };
  if (offThread) {
    const options = { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
    if (k < 1) Object.assign(options, { resizeWidth: Math.round(img.width * k), resizeHeight: Math.round(img.height * k), resizeQuality: 'high' });
    return createImageBitmap(img, options).then(bitmap => ({ image: bitmap, flipY: false }), () => ({ image: k < 1 ? shrink(img, k) : img, flipY: true }));
  }
  return { image: k < 1 ? shrink(img, k) : img, flipY: true };
}
// A bitmap decoded with imageOrientation 'flipY' only needs the size cap; it never flips again.
function capBitmap(bitmap) {
  const size = Math.max(bitmap.width, bitmap.height), k = Math.min(1, textureCap / size);
  if (k >= 1) return { image: bitmap, flipY: false };
  return createImageBitmap(bitmap, { resizeWidth: Math.round(bitmap.width * k), resizeHeight: Math.round(bitmap.height * k), resizeQuality: 'high' }).then(b => ({ image: b, flipY: false }));
}
function shrink(img, k) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// One request per file: textures that differ only in repeat / rotation share its Source (one download, one GPU upload).
const sources = new Map();
function source(url) {
  if (sources.has(url)) return sources.get(url);
  const s = { source: new THREE.Source(), users: [], flipY: true, loaded: false };
  sources.set(url, s);
  let done;
  const job = new Promise(r => { done = r; }).finally(() => { settled++; pending.delete(job); });
  pending.add(job); requested++;
  const apply = ({ image, flipY }) => {
    Object.assign(s, { flipY, loaded: true }); s.source.data = image; s.source.needsUpdate = true;
    for (const t of s.users) { t.flipY = flipY; t.needsUpdate = true; }
  };
  const viaImage = () => loader.load(url, img => Promise.resolve(capImage(img)).then(apply).finally(done), undefined, done);
  // Decode straight from the download: createImageBitmap(blob) decodes, flips and converts off the main thread, where
  // going through an <img> first cost ~40 ms of main-thread work per scan. Any failure falls back to the <img> path.
  if (offThread) fetch(url).then(r => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
    .then(blob => createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))
    .then(capBitmap).then(apply).then(done, viaImage);
  else viaImage();
  return s;
}

function tex(file, { srgb = false, repeat = 1, rotation = 0 } = {}) {
  const key = `${file}|${srgb}|${repeat}|${rotation}`;
  if (cache.has(key)) return cache.get(key);
  const s = source(`${texDir}${file}.${texExt}`), t = new THREE.Texture();
  t.source = s.source; t.flipY = s.flipY; s.users.push(t);
  if (s.loaded) t.needsUpdate = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.rotation = rotation;
  t.anisotropy = anisotropy;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

// Scanned set: <name>_diff / _nor / _rough / _ao, from the visit's texture set. `scale` = metres covered by one tile.
export function pbr(name, { scale = 1, color = 0xffffff, roughness = 1, normalScale = 1, rotation = 0, ao = true, ...rest } = {}) {
  const repeat = 1 / scale;
  const m = new THREE.MeshStandardMaterial({
    color, roughness, metalness: 0,
    map: tex(`${name}_diff`, { srgb: true, repeat, rotation }),
    normalMap: tex(`${name}_nor`, { repeat, rotation }),
    roughnessMap: tex(`${name}_rough`, { repeat, rotation }),
    aoMap: ao ? tex(`${name}_ao`, { repeat, rotation }) : null,
    normalScale: new THREE.Vector2(normalScale, normalScale),
    ...rest,
  });
  m.name = name;
  return m;
}

const once = (fn) => { let v; return () => (v ??= fn()); };

// ---- Architecture ----
export const M = {
  // engineered white-oak wide plank, 1.9 m planks across ~0.19 m boards; scan tile ~2 m
  floorOak: once(() => pbr('laminate_floor_02', { scale: 1.6, color: 0xf3e7d4, roughness: 0.7, normalScale: 0.5 })),
  // Daylight reflectance is ~0.8 linear; keep the photographed dusk finish.
  wallPaint: once(() => Object.assign(new THREE.MeshStandardMaterial({ color: 0xf7f5f1, roughness: 0.94 }), { userData: { daylightPaint: 0.86 } })),
  ceiling: once(() => Object.assign(new THREE.MeshStandardMaterial({ color: 0xfbfbf9, roughness: 0.96 }), { userData: { daylightPaint: 0.84 } })),
  stucco: once(() => pbr('white_stucco', { scale: 3.0, color: 0xf7f6f1, roughness: 0.88, normalScale: 0.3 })),
  trim: once(() => new THREE.MeshStandardMaterial({ color: 0xf6f6f4, roughness: 0.55 })),
  doorWhite: once(() => new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.5 })),
  doorBlackHardware: once(() => new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.4, metalness: 0.8 })),
  concrete: once(() => pbr('concrete_floor_01', { scale: 6, color: 0xeeebe4, roughness: 0.92, normalScale: 0.25 })),
  shell: once(() => pbr('shell_floor_01', { scale: 0.75, color: 0xfffdf7, roughness: 0.9, normalScale: 1.1 })),
  pebbles: once(() => pbr('clean_pebbles', { scale: 1.0, color: 0xf2efe8, roughness: 0.9, normalScale: 1 })),
  grass: once(() => pbr('leafy_grass', { scale: 1.5, color: 0xbfd48a, roughness: 1, normalScale: 0.8 })),
  roof: once(() => pbr('grey_roof_01', { scale: 2.5, color: 0xb9b9b6, roughness: 0.95, normalScale: 0.8 })),
  soffit: once(() => new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.8 })),
  bark: once(() => pbr('palm_tree_bark', { scale: 1.2, color: 0xcbbfae, roughness: 1 })),
  fenceVinyl: once(() => new THREE.MeshStandardMaterial({ color: 0xf5f5f2, roughness: 0.6 })),
  asphalt: once(() => new THREE.MeshStandardMaterial({ color: 0x5b5b5a, roughness: 0.95 })),
  mulch: once(() => pbr('palm_tree_bark', { scale: 1.1, color: 0x4a2f1f, roughness: 1, normalScale: 1.0 })),
  // Glass: thin transparent physical material; `transmission` would cost a lot with this many panes.
  glass: once(() => Object.assign(new THREE.MeshPhysicalMaterial({ color: 0xdfeaf0, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, envMapIntensity: 1.2, side: THREE.DoubleSide, depthWrite: false }), { userData: { daylightOpacity: 0.035 } })),
  mirror: once(() => Object.assign(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.02, metalness: 1.0 }), { name: 'mirror' })),
  aluminum: once(() => new THREE.MeshStandardMaterial({ color: 0xdedfe0, roughness: 0.35, metalness: 0.9 })),
  ironBlack: once(() => new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.55, metalness: 0.7 })),
  sheer: once(() => new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.9, transparent: true, opacity: 0.55, side: THREE.DoubleSide, sheen: 1, sheenColor: new THREE.Color(0xffffff), depthWrite: false })),

  // ---- Furniture ----
  oak: once(() => pbr('white_oak_veneer', { scale: 0.8, color: 0xe8d7bd, roughness: 0.55, normalScale: 0.5 })),      // ash / white oak furniture (tables, Wishbone chairs)
  oakEnd: once(() => pbr('white_oak_veneer', { scale: 0.8, color: 0xe8d7bd, roughness: 0.55, normalScale: 0.5, rotation: Math.PI / 2 })),
  pine: once(() => new THREE.MeshStandardMaterial({ map: proc.woodGrain({ base: '#e9d3a8', dark: '#c99f62', knots: true }), roughness: 0.6, color: 0xffffff })),
  pineWhitewash: once(() => new THREE.MeshStandardMaterial({ map: proc.woodGrain({ base: '#f1e7d6', dark: '#d9c4a3', knots: true, wash: 0.45 }), roughness: 0.7 })),
  acacia: once(() => new THREE.MeshStandardMaterial({ map: proc.woodGrain({ base: '#8a5a33', dark: '#4e2f16' }), roughness: 0.45 })),
  walnut: once(() => new THREE.MeshStandardMaterial({ map: proc.woodGrain({ base: '#6b4a2e', dark: '#3a2616' }), roughness: 0.5 })),
  reclaimed: once(() => new THREE.MeshStandardMaterial({ map: proc.woodGrain({ base: '#d8d2c6', dark: '#8d8577', wash: 0.6, planks: 0.09 }), roughness: 0.85 })),
  lumber: once(() => new THREE.MeshStandardMaterial({ map: proc.woodGrain({ base: '#d9a86a', dark: '#a9742f', knots: true }), roughness: 0.75 })),
  leatherTan: once(() => pbr('brown_leather', { scale: 0.6, color: 0xd09a5a, roughness: 0.55, normalScale: 0.7 })),
  leatherCognac: once(() => pbr('brown_leather', { scale: 0.6, color: 0xa65a2c, roughness: 0.5, normalScale: 0.7 })),
  leatherBlack: once(() => pbr('brown_leather', { scale: 0.6, color: 0x1a1612, roughness: 0.6, normalScale: 0.7 })),
  jute: once(() => pbr('hessian_380', { scale: 0.35, color: 0xd9c7a4, roughness: 1, normalScale: 1.2 })),
  rugGrey: once(() => new THREE.MeshStandardMaterial({ map: proc.rugCheck(), roughness: 1 })),
  linen: once(() => new THREE.MeshPhysicalMaterial({ color: 0xf6f3ec, roughness: 0.95, sheen: 0.6, sheenRoughness: 0.8, sheenColor: new THREE.Color(0xffffff) })),
  linenGrey: once(() => new THREE.MeshPhysicalMaterial({ color: 0x7c7f84, roughness: 0.95, sheen: 0.4, sheenColor: new THREE.Color(0xffffff) })),
  cushion: once(() => new THREE.MeshPhysicalMaterial({ color: 0xf2efe7, roughness: 0.9, sheen: 0.5, sheenColor: new THREE.Color(0xffffff) })),
  rattan: once(() => new THREE.MeshStandardMaterial({ map: proc.weave({ a: '#d9b476', b: '#b58b4a' }), roughness: 0.8 })),
  wicker: once(() => new THREE.MeshStandardMaterial({ map: proc.weave({ a: '#d8c7a4', b: '#bba67e', scale: 1.6 }), roughness: 0.85 })),
  quartz: once(() => new THREE.MeshPhysicalMaterial({ color: 0xf5f5f3, roughness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.2 })),
  cabinetWhite: once(() => new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.45 })),
  tileBlack: once(() => new THREE.MeshPhysicalMaterial({ map: proc.tileGrid({ tile: '#2a2d30', grout: '#c9c6bf', n: 6, gloss: true }), roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.15 })),
  tileWhite: once(() => new THREE.MeshPhysicalMaterial({ map: proc.tileGrid({ tile: '#f4f4f2', grout: '#d8d8d4', n: 4 }), roughness: 0.3, clearcoat: 0.6 })),
  tileMosaic: once(() => new THREE.MeshStandardMaterial({ map: proc.tileGrid({ tile: '#d8d2c6', grout: '#bdb6a9', n: 12 }), roughness: 0.6 })),
  blackAppliance: once(() => new THREE.MeshPhysicalMaterial({ color: 0x17181a, roughness: 0.35, metalness: 0.6, clearcoat: 0.3 })),
  steel: once(() => new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.35, metalness: 1 })),
  blackMatte: once(() => new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.7, metalness: 0.2 })),
  blackSteel: once(() => new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.4, metalness: 0.85 })),
  paper: once(() => new THREE.MeshPhysicalMaterial({ color: 0xfff6e6, roughness: 1, transparent: true, opacity: 0.92, side: THREE.DoubleSide, emissive: 0xffe9c4, emissiveIntensity: 0.0 })),
  ceramicWhite: once(() => new THREE.MeshPhysicalMaterial({ color: 0xf7f6f2, roughness: 0.35, clearcoat: 0.5 })),
  ceramicSpeckle: once(() => new THREE.MeshStandardMaterial({ map: proc.speckle({ base: '#ece6d8', dots: '#8d8577' }), roughness: 0.6 })),
  darkVanity: once(() => new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: 0.5 })),
  chalkboard: once(() => new THREE.MeshStandardMaterial({ map: proc.chalkboard(), roughness: 0.9 })),
  canvasRed: once(() => new THREE.MeshStandardMaterial({ map: proc.redPainting(), roughness: 0.8 })),
  bookSpines: once(() => new THREE.MeshStandardMaterial({ map: proc.books(), roughness: 0.7 })),
  louver: once(() => new THREE.MeshStandardMaterial({ map: proc.louver(), normalMap: proc.louverNormal(), roughness: 0.6 })),
  plywoodSlats: once(() => new THREE.MeshStandardMaterial({ map: proc.woodGrain({ base: '#f0e2c9', dark: '#d7bd92', wash: 0.25, planks: 0.07 }), roughness: 0.6 })),
  plant: once(() => new THREE.MeshStandardMaterial({ color: 0x4f7f3a, roughness: 0.8, side: THREE.DoubleSide })),
  umbrellaNavy: once(() => new THREE.MeshStandardMaterial({ color: 0x1d2a52, roughness: 0.9, side: THREE.DoubleSide })),
  plasticWhite: once(() => new THREE.MeshPhysicalMaterial({ color: 0xf6f6f4, roughness: 0.4, clearcoat: 0.3 })),
  terracottaWhite: once(() => new THREE.MeshStandardMaterial({ color: 0xf0ece4, roughness: 0.8 })),
  emissiveWarm: once(() => new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffd9a0, emissiveIntensity: 1.5, roughness: 1, userData: { emits: 'lamp' } })),
  screen: once(() => new THREE.MeshStandardMaterial({ map: proc.screen(), roughness: 0.3, emissive: 0xffffff, emissiveMap: proc.screen(), emissiveIntensity: 0.6, userData: { emits: 'screen' } })),
};

export function setEnvironment(envMap, intensity = 1, materials = null) {
  // An explicit set covers local furniture materials as well as shared M.* ones.
  // Exposure adaptation only changes uniforms; do not recompile every frame.
  const targets = materials ?? Object.values(M).map(create => create());
  for (const material of targets) {
    const changed = material.envMap !== envMap;
    material.envMap = envMap; material.envMapIntensity = intensity;
    if (changed) material.needsUpdate = true;
  }
}

// ---- Garden ground. The leafy_grass scan's albedo is mostly brown leaf litter, so turf gets a painted St. Augustine
//      canopy (broad blades, deep to bright greens) over the scan's normal map, plus a slow macro tint so big lawns
//      don't show the 1.1 m tile. Bed mulch is darker than M.mulch: it should only read as shade between plants.
function canvasTex(size, paint) {
  const c = document.createElement('canvas'); c.width = c.height = size; paint(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = anisotropy; return t;
}
function lcgRand(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function turfAlbedo() {
  const t = canvasTex(512, (g, S) => {
    const r = lcgRand(2513);
    g.fillStyle = '#2f4a1d'; g.fillRect(0, 0, S, S);
    const cols = ['#38561f', '#41622a', '#4b6f2c', '#557a30', '#618636', '#6d913b', '#4e7436', '#7e9c44', '#8fa64c'];
    g.lineCap = 'round';
    for (let i = 0; i < 9000; i++) {
      const x = r() * S, y = r() * S, a = r() * Math.PI * 2, L = 4 + r() * 9, w = 1.4 + r() * 2.0, k = Math.min(cols.length - 1, Math.floor(Math.pow(r(), 0.85) * cols.length));
      g.strokeStyle = cols[k]; g.lineWidth = w; g.globalAlpha = 0.6 + r() * 0.4;
      const dx = Math.cos(a) * L, dy = Math.sin(a) * L;
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        const px = x + ox, py = y + oy; if (px < -L || px > S + L || py < -L || py > S + L) continue;
        g.beginPath(); g.moveTo(px, py); g.lineTo(px + dx, py + dy); g.stroke();
      }
    }
  });
  t.colorSpace = THREE.SRGBColorSpace; return t;
}
function macroNoise() {   // smooth tileable value noise
  return canvasTex(64, (g, S) => {
    const r = lcgRand(77), N = 8, v = [...Array(N * N)].map(() => r()), at = (i, j) => v[(j % N) * N + (i % N)], img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const fx = x / S * N, fy = y / S * N, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const val = (at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx) * (1 - sy) + (at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx) * sy;
      const o = (y * S + x) * 4; img.data[o] = img.data[o + 1] = img.data[o + 2] = val * 255; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
}
Object.assign(M, {
  turf: once(() => {
    const rep = 1 / 1.1, map = turfAlbedo(); map.repeat.set(rep, rep);
    const m = new THREE.MeshStandardMaterial({ map, normalMap: tex('leafy_grass_nor', { repeat: rep }), normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.95, metalness: 0 });
    const uMacro = { value: macroNoise() };
    m.onBeforeCompile = (s) => {
      s.uniforms.uMacro = uMacro;
      s.fragmentShader = 'uniform sampler2D uMacro;\n' + s.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
  float macroV = texture2D(uMacro, vMapUv * 0.055).r * 0.65 + texture2D(uMacro, vMapUv * 0.17 + 0.37).r * 0.35;
  diffuseColor.rgb *= mix(vec3(0.78, 0.84, 0.74), vec3(1.12, 1.1, 0.92), macroV);`);
    };
    m.customProgramCacheKey = () => 'turf-macro';
    m.name = 'turf'; return m;
  }),
  bedMulch: once(() => pbr('palm_tree_bark', { scale: 0.8, color: 0x33241a, roughness: 1, normalScale: 1.2 })),
  // Crushed white shell (g37-g47 read ~#d6d3ce): the shell_floor scan is brown gravel, so keep its grain but remap its
  // luminance to white with grey specks.
  shellWhite: once(() => {
    const m = pbr('shell_floor_01', { scale: 0.75, roughness: 0.88, normalScale: 1.1 });
    m.onBeforeCompile = (s) => {
      s.fragmentShader = s.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
  float shellL = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
  diffuseColor.rgb = mix(vec3(0.70, 0.69, 0.665) * clamp(0.45 + 2.2 * shellL, 0.35, 1.25), diffuseColor.rgb * 2.4, 0.08);`);
    };
    m.customProgramCacheKey = () => 'shell-white';
    m.name = 'shellWhite'; return m;
  }),
});

// Real light sources: the lamp surfaces light_switch.js collects from the fixtures (userData.lightGlow) and materials
// marked where they are made with userData.emits ('lamp' for bulbs, shades and diffusers outside a switch, 'screen' and
// 'indicator' for displays and LEDs that are on, 'fire'). Any other emissive colour is a raster stand-in (lighting.js
// lifts every emissive material to a 0.12 glow by day, so cloth and paper read as backlit) and must not emit light in
// the path tracer (photo.js), the Blender export (bake/export/setup.py) or under the baked lighting (lightmap.js).
export const emitsLight = m => !!(m?.userData?.lightGlow || m?.userData?.emits);

// Sheer voile under the baked light (lightmap.js calls this from probeLit for materials with userData.sheer = { reflect,
// transmit }). Real voile shows two things: the room-side light its fibres reflect, and the window-side light they
// scatter through (diffuse transmission: soft, with no image of what is behind), so the cloth is read from the probe
// volume on both sides. The probes sample open air, but a ripplefold panel drawn back into its stack (or a narrow panel,
// whose 12 folds share less width) shades itself fold by fold: both terms carry that occlusion, from 0.3 for a tight
// stack to 1 for a panel drawn across, by how far the panel's folds are spread (its world x scale). The reflect /
// transmit split is decor.js's, shared with photo mode and Cycles (setup.py), where a bunched stack reads ~0.8x the wall
// above it.
// The walkthrough's daytime glow (lighting.js lifts every emissive material to 0.12) has no place here: the cloth only
// returns light it receives. The sun reaching the back of the cloth is transmitted by the same fraction, and the sheen
// is kept soft.
export function sheerProbePatch(sh, material) {
  const s = material.userData.sheer;
  material.sheerUniform ??= { value: new THREE.Vector2(s.reflect, s.transmit) };
  sh.uniforms.uSheer = material.sheerUniform;
  const probe = 'irradiance += probeIrradiance( vProbeWorld, inverseTransformDirection( geometryNormal, viewMatrix ) );';
  sh.vertexShader = 'varying float vSheerSpread;\n' + rep(sh.vertexShader, '#include <project_vertex>', '#include <project_vertex>\n\tvSheerSpread = length( modelMatrix[ 0 ].xyz );', 'sheer spread');
  const direct = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution );\n}';
  let f = rep(sh.fragmentShader, '#include <lights_physical_pars_fragment>', THREE.ShaderChunk.lights_physical_pars_fragment, 'sheer physical pars');
  f = rep(f, direct, 'vec2 sheerK = sheerResponse();\n\treflectedLight.directDiffuse += ( sheerK.x * irradiance + sheerK.y * saturate( - dot( geometryNormal, directLight.direction ) ) * directLight.color ) * BRDF_Lambert( material.diffuseContribution );\n}', 'sheer direct');
  f = rep(f, 'vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = vec3( 0.0 );', 'sheer emission');
  f = rep(f, '#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_SHEEN\n\tmaterial.sheenColor *= 0.3;\n#endif', 'sheer sheen');
  f = rep(f, probe, `{ vec3 sheerN = inverseTransformDirection( geometryNormal, viewMatrix ); vec2 sheerK = sheerResponse();
      irradiance += sheerK.x * probeIrradiance( vProbeWorld, sheerN ) + sheerK.y * probeIrradiance( vProbeWorld, - sheerN ); }`, 'sheer probe');
  // Fold overlap has optical depth: a narrow/bunched panel covers the background with many cloth layers. Apply after
  // the alpha map so even its weave holes close up in the stack. Same world spread drives the lighting occlusion.
  f = rep(f, '#include <alphamap_fragment>', '#include <alphamap_fragment>\n diffuseColor.a = 1.0 - pow( max( 1.0 - diffuseColor.a, 0.0 ), max( 1.0, 0.7 / max( vSheerSpread, 0.02 ) ) );', 'sheer coverage');
  sh.fragmentShader = 'uniform vec2 uSheer; varying float vSheerSpread;\nvec2 sheerResponse() { return uSheer * mix( 0.3, 1.0, smoothstep( 0.05, 0.7, vSheerSpread ) ); }\n' + f;
}
