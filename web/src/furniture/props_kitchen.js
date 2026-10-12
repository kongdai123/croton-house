// Counter styling from g12–g18. Origins rest on the stone; +Z is front.
import { THREE, M, box, cyl, torus, tube, lathe, describe } from '../kit.js';
import { driedSpray } from './props_living_parts.js';
import { paint } from './plants_parts.js';

const ceramic = new THREE.MeshPhysicalMaterial({ color: 0xf8f7f1, roughness: 0.22, clearcoat: 0.65, clearcoatRoughness: 0.18 });
const glass = new THREE.MeshPhysicalMaterial({ color: 0xf0f5f1, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.19, depthWrite: false, transmission: 0, clearcoat: 0.7 });
const black = M.blackMatte(), wire = new THREE.MeshStandardMaterial({ color: 0xa7aaa3, roughness: 0.3, metalness: 0.8 });
const bamboo = M.oak().clone(); bamboo.color.set(0xd8b778); bamboo.roughness = 0.55;
const wood = M.acacia(), label = new THREE.MeshStandardMaterial({ color: 0x292c27, roughness: 0.85 });
const paper = new THREE.MeshStandardMaterial({ color: 0xe8e4d9, roughness: 0.85 });
const foods = ['oats', 'seeds', 'herbs', 'pepper', 'paprika'].map((kind, i) => new THREE.MeshStandardMaterial({
  roughness: 0.95, map: paint(`kitchen-${kind}`, 256, 256, (g, W, H, r) => {
    const cols = [['#d8cba6', '#eee2bd', '#ad9367'], ['#c6b792', '#eee1bd', '#352e23'], ['#6d7350', '#959165', '#444832'], ['#5b4935', '#897454', '#30291e'], ['#9e6039', '#bf8650', '#774126']][i];
    g.fillStyle = cols[0]; g.fillRect(0, 0, W, H);
    for (let j = 0; j < 3400; j++) { g.fillStyle = cols[Math.floor(r() * cols.length)]; g.beginPath(); g.ellipse(r() * W, r() * H, 0.6 + r() * 1.8, 0.8 + r() * 3.1, r() * 3, 0, 7); g.fill(); }
  }, { opaque: true, repeat: true }),
}));
const finish = (g, id, name) => describe(g, { id: `props-kitchen-${id}`, name });
const vessel = (outer, wall = 0.004, floor = 0.008) => [[0, 0], ...outer, ...outer.slice().reverse().filter(([, h]) => h >= floor).map(([r, h]) => [r - wall, h]), [0, floor]];

function flowerPitcher() {
  const g = new THREE.Group();
  g.add(lathe(vessel([[0.055, 0], [0.066, 0.006], [0.068, 0.04], [0.061, 0.13], [0.053, 0.19], [0.054, 0.218], [0.06, 0.228]]), ceramic, { seg: 28 }));
  g.add(tube([[-0.057, 0.175, 0], [-0.091, 0.171, 0], [-0.103, 0.135, 0], [-0.09, 0.092, 0], [-0.061, 0.08, 0]], 0.009, ceramic, { seg: 18, radial: 7 }));
  for (const y of [0.166, 0.178, 0.19]) g.add(torus(0.054, 0.002, ceramic, { y, rx: Math.PI / 2, seg: 28, tube: 4 }));
  g.add(tube([[0.035, 0.226, -0.045], [0.059, 0.237, -0.031], [0.069, 0.241, 0], [0.059, 0.237, 0.031], [0.035, 0.226, 0.045]], 0.003, ceramic, { seg: 12, radial: 5 }));
  g.add(driedSpray(18, { mouth: [0, 0.226, 0], rMouth: 0.045, spread: 0.12, height: 0.16, stems: 11, branches: 6, florets: 6, fSize: [0.002, 0.0037], fCols: ['#e7ddbe', '#f4ecdc', '#d4c699'], stemCol: '#9c8958' }));
  return finish(g, 'pitcher', 'White ceramic pitcher with dried flowers');
}

function whiteCrock() {
  const g = new THREE.Group();
  g.add(lathe([[0, 0], [0.066, 0], [0.072, 0.007], [0.072, 0.184], [0.071, 0.196], [0.067, 0.2], [0, 0.2]], ceramic, { seg: 28 }));
  g.add(cyl(0.074, 0.074, 0.01, ceramic, { y: 0.205, seg: 28 }));
  for (const y of [0.189, 0.197]) g.add(torus(0.072, 0.0015, ceramic, { y, rx: Math.PI / 2, seg: 28, tube: 4 }));
  return finish(g, 'crock', 'Lidded white ceramic counter crock');
}

function spiceCarousel() {
  const g = new THREE.Group();
  g.add(cyl(0.073, 0.073, 0.004, black, { seg: 16, y: 0.002 }));
  for (const y of [0.014, 0.284]) g.add(box(0.22, 0.017, 0.22, bamboo, { r: 0.008, seg: 1, y }));
  g.add(box(0.067, 0.256, 0.067, black, { y: 0.149 }));
  for (let side = 0; side < 4; side++) {
    const rack = new THREE.Group();
    for (const x of [-0.057, 0.057]) rack.add(box(0.008, 0.25, 0.012, black, { x, y: 0.149, z: 0.063 }));
    for (let row = 0; row < 5; row++) {
      const jar = new THREE.Group(), y = 0.046 + row * 0.048;
      jar.add(cyl(0.021, 0.021, 0.073, glass, { y: 0.0365, seg: 16 }));
      jar.add(cyl(0.0175, 0.0175, 0.06, foods[(side + row) % foods.length], { y: 0.034, seg: 12 }));
      jar.add(cyl(0.0215, 0.0215, 0.019, paper, { y: 0.055, seg: 8, open: true }));
      jar.add(cyl(0.0235, 0.0235, 0.011, black, { y: 0.0785, seg: 16 }));
      jar.add(cyl(0.019, 0.019, 0.001, label, { y: 0.0845, seg: 16 }));
      for (const x of [-0.009, 0, 0.009]) jar.add(box(0.0012, 0.0006, 0.012 - Math.abs(x) * 0.4, ceramic, { x, y: 0.0852 }));
      jar.rotation.x = Math.PI / 2; jar.position.set(0, y, 0.033); rack.add(jar);
      rack.add(box(0.101, 0.006, 0.015, black, { y: y - 0.022, z: 0.056 }));
    }
    rack.rotation.y = side * Math.PI / 2; g.add(rack);
  }
  g.add(tube([[-0.023, 0.292, 0], [-0.023, 0.329, 0], [0, 0.346, 0], [0.023, 0.329, 0], [0.023, 0.292, 0]], 0.0028, wire, { seg: 16, radial: 5 }));
  return finish(g, 'spices', 'Bamboo rotating carousel with twenty glass spice jars');
}

function canister(H, R, food) {
  const g = new THREE.Group(), neck = H - 0.034;
  g.add(lathe([[0, 0], [R * 0.87, 0], [R, 0.012], [R, H * 0.67], [R * 0.94, H * 0.79], [R * 0.72, neck - 0.018], [R * 0.72, neck], [R * 0.68, neck], [R * 0.68, neck - 0.018], [R * 0.90, H * 0.78], [R - 0.003, H * 0.66], [R - 0.003, 0.012], [0, 0.008]], glass, { seg: 28 }));
  g.add(cyl(R - 0.006, R - 0.007, H * 0.36, foods[food], { y: 0.01, bottom: true, seg: 28 }));
  g.add(cyl(R * 0.77, R * 0.77, 0.012, bamboo, { y: neck, bottom: true, seg: 28 }));
  g.add(torus(R * 0.79, 0.0022, wire, { y: neck + 0.004, rx: Math.PI / 2, seg: 28, tube: 4 }));
  g.add(torus(R * 0.74, 0.003, glass, { y: neck - 0.008, rx: Math.PI / 2, seg: 28, tube: 4 }));
  for (const s of [-1, 1]) g.add(tube([[s * R * 0.66, neck + 0.006, 0], [s * R * 0.82, neck - 0.007, 0], [s * R * 0.84, neck - 0.023, 0]], 0.0018, wire, { seg: 5, radial: 4 }));
  g.add(tube([[-0.019, neck, R * 0.54], [-0.024, neck - 0.03, R * 0.73], [0, neck - 0.045, R * 0.79], [0.024, neck - 0.03, R * 0.73], [0.019, neck, R * 0.54]], 0.002, wire, { seg: 12, radial: 4 }));
  // Raised glass botanical relief on the jar face.
  for (const s of [-1, 1]) {
    g.add(tube([[s * 0.014, 0.04, R], [s * 0.042, 0.095, R * 0.93], [s * 0.018, 0.15, R]], 0.0018, glass, { seg: 10, radial: 4 }));
    for (let j = 0; j < 3; j++) g.add(torus(0.01, 0.0016, glass, { x: s * (0.022 + j % 2 * 0.01), y: 0.068 + j * 0.027, z: R * 0.98, seg: 12, tube: 4 }));
  }
  return g;
}

function oilBottle() {
  const g = new THREE.Group();
  g.add(lathe([[0, 0], [0.029, 0], [0.034, 0.007], [0.034, 0.172], [0.032, 0.188], [0.022, 0.205], [0.016, 0.214], [0.016, 0.252], [0.012, 0.254], [0, 0.254]], ceramic, { seg: 24 }));
  g.add(cyl(0.013, 0.013, 0.01, black, { y: 0.255, seg: 16 }));
  g.add(cyl(0.004, 0.005, 0.033, wire, { y: 0.275, seg: 10 }));
  g.add(tube([[0, 0.275, 0], [0, 0.296, 0.003], [0, 0.299, 0.012], [0, 0.29, 0.018]], 0.0038, wire, { seg: 10, radial: 5 }));
  g.add(box(0.003, 0.018, 0.008, black, { y: 0.295, z: -0.003, rx: -0.3 }));
  return finish(g, 'oil', 'White ceramic oil bottle with metal pour spout');
}

function woodTray() {
  const g = new THREE.Group();
  g.add(box(0.32, 0.008, 0.13, wood, { r: 0.003, seg: 1, bottom: true }));
  for (const s of [-1, 1]) {
    g.add(box(0.32, 0.009, 0.009, wood, { r: 0.002, seg: 1, y: 0.0125, z: s * 0.061 }));
    g.add(box(0.009, 0.009, 0.112, wood, { r: 0.002, seg: 1, y: 0.0125, x: s * 0.155 }));
  }
  return finish(g, 'tray', 'Shallow rectangular wooden tray beside the range');
}

export const items = {
  flowerPitcher, whiteCrock, spiceCarousel,
  oatsCanister: () => finish(canister(0.28, 0.081, 0), 'oats', 'Tall clamp-top glass oat canister'),
  seedsCanister: () => finish(canister(0.225, 0.078, 1), 'seeds', 'Short clamp-top glass seed canister'),
  oilBottle, woodTray,
};
