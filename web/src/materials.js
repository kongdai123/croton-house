// Material library: scanned PBR sets from Poly Haven (CC0) in assets/tex, plus procedural canvas textures (proc.js).
// Every material is created once and shared. Units are metres; `repeat` = texture tiles per metre.
import * as THREE from 'three';
import * as proc from './proc.js';

const loader = new THREE.TextureLoader();
const cache = new Map();
export const MAX_ANISO = 8;
export let anisotropy = MAX_ANISO;
export function setAnisotropy(v) { anisotropy = v; }

function tex(file, { srgb = false, repeat = 1, rotation = 0 } = {}) {
  const key = `${file}|${srgb}|${repeat}|${rotation}`;
  if (cache.has(key)) return cache.get(key);
  const t = loader.load(`assets/tex/${file}`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.rotation = rotation;
  t.anisotropy = anisotropy;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

// Scanned set: <name>_diff / _nor / _rough / _ao (2k jpg). `scale` = metres covered by one tile.
export function pbr(name, { scale = 1, color = 0xffffff, roughness = 1, normalScale = 1, rotation = 0, ao = true, ...rest } = {}) {
  const repeat = 1 / scale;
  const m = new THREE.MeshStandardMaterial({
    color, roughness, metalness: 0,
    map: tex(`${name}_diff.jpg`, { srgb: true, repeat, rotation }),
    normalMap: tex(`${name}_nor.jpg`, { repeat, rotation }),
    roughnessMap: tex(`${name}_rough.jpg`, { repeat, rotation }),
    aoMap: ao ? tex(`${name}_ao.jpg`, { repeat, rotation }) : null,
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
  wallPaint: once(() => new THREE.MeshStandardMaterial({ color: 0xf7f5f1, roughness: 0.94 })),   // flat painted drywall
  ceiling: once(() => new THREE.MeshStandardMaterial({ color: 0xfbfbf9, roughness: 0.96 })),
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
  glass: once(() => new THREE.MeshPhysicalMaterial({ color: 0xdfeaf0, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, envMapIntensity: 1.2, side: THREE.DoubleSide, depthWrite: false })),
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
  emissiveWarm: once(() => new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffd9a0, emissiveIntensity: 1.5, roughness: 1 })),
  screen: once(() => new THREE.MeshStandardMaterial({ map: proc.screen(), roughness: 0.3, emissive: 0xffffff, emissiveMap: proc.screen(), emissiveIntensity: 0.6 })),
};

export function setEnvironment(envMap, intensity = 1) {
  for (const k of Object.keys(M)) { const m = M[k](); m.envMap = envMap; m.envMapIntensity = intensity; m.needsUpdate = true; }
}
