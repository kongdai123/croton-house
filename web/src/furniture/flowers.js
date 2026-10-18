// Sarasota flowering layer. Photo anchors: crane flowers g38, bromeliads g05/g43,
// red/orange shrub flowers g06/g39. Other species are restrained Gulf-coast accents.
// Each seeded plant uses 2–4 merged meshes; leaves/petals and materials are shared.
import { THREE, M, lathe, cyl, describe, setCollider, declare } from '../kit.js';
import { TAU, GOLD, lcg, rr, tint, paint, leafMat, plainMat, texSprig,
  texStrap, orient, cardGeo, stemGeo, Batch } from './plants_parts.js';

const GEOMETRY = new Map(), SPECIMENS = new Map();
const geo = (key, make) => { if (!GEOMETRY.has(key)) GEOMETRY.set(key, make()); return GEOMETRY.get(key); };
const color = hex => new THREE.Color(hex).toArray();
const add = (a, b, s = 1) => a.map((v, i) => v + b[i] * s);
const stemMaterial = () => plainMat('flowers-stems', 0xffffff, { rough: .86 });
const petalMaterial = () => leafMat('flowers-petals', null, { alpha: false, rough: .67, env: .4 });
const stemColor = color('#63733d');

function leafTexture(broad = false) {
  return paint('flowers-leaf-' + broad, 128, 256, (g, W, H) => {
    g.beginPath(); g.moveTo(W / 2, H);
    g.bezierCurveTo(-W * .10, H * .70, W * .06, H * .22, W / 2, 3);
    g.bezierCurveTo(W * .94, H * .22, W * 1.10, H * .70, W / 2, H);
    const gr = g.createLinearGradient(0, 0, W, 0);
    gr.addColorStop(0, '#254b27'); gr.addColorStop(.48, broad ? '#638451' : '#457846');
    gr.addColorStop(.55, '#74945a'); gr.addColorStop(1, '#294d2a'); g.fillStyle = gr; g.fill();
    g.save(); g.clip(); g.strokeStyle = '#aec288'; g.globalAlpha = .45; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(W / 2, H); g.lineTo(W / 2, 6); g.stroke();
    g.lineWidth = .8;
    for (let y = 34; y < H - 20; y += broad ? 10 : 26) {
      g.beginPath(); g.moveTo(W / 2, y + 14); g.lineTo(4, y - 16);
      g.moveTo(W / 2, y + 14); g.lineTo(W - 4, y - 16); g.stroke();
    }
    g.restore();
  });
}
const leafMaterial = (broad = false) => leafMat('flowers-leaf-' + broad, leafTexture(broad), { rough: .58, env: .5 });
const leafGeometry = (broad = false) => geo('leaf-' + broad, () => cardGeo(broad ? .23 : .085, broad ? .59 : .17,
  { sx: 2, sy: broad ? 5 : 2, bend: broad ? .35 : .4, fold: .12 }));

// A cupped corolla with true scalloped/star silhouette (20 triangles). Local +Z is
// the flower face; yellow throats use their own small geometry in the same batch.
function corolla(lobes = 5, pointed = false) {
  return geo('corolla-' + lobes + '-' + pointed, () => {
    const p = [0, 0, -.13], uv = [.5, .5], idx = [], n = lobes * 4;
    for (let j = 0; j < n; j++) {
      const a = j / n * TAU, f = j % 4;
      const rad = pointed ? [1, .42, .25, .42][f] : [.9, 1, .9, .32][f];
      p.push(Math.cos(a) * rad, Math.sin(a) * rad, rad * rad * .15);
      uv.push(.5 + Math.cos(a) * rad * .5, .5 + Math.sin(a) * rad * .5);
      idx.push(0, j + 1, (j + 1) % n + 1);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
  });
}
const dot = () => geo('throat', () => new THREE.CircleGeometry(1, 5));
const facing = (yaw, tilt) => new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, yaw, 0, 'YXZ'));
function blossom(batch, pos, radius, hex, yaw, tilt, { lobes = 5, pointed = false, throat = true } = {}) {
  const q = facing(yaw, tilt), c = color(hex);
  batch.add(corolla(lobes, pointed), { pos, q, s: radius, tint: c });
  if (throat) batch.add(dot(), { pos: add(pos, new THREE.Vector3(0, 0, .002).applyQuaternion(q).toArray()), q, s: radius * .15, tint: color('#eac886') });
}
function twig(batch, points, radius = .005, hex = stemColor) {
  const g = stemGeo(points, [radius, radius * .4], { seg: 3, radial: 4 });
  batch.add(g, { tint: hex }); g.dispose();
}
function finish(root, name, zh, footprint, h) {
  describe(root, { id: 'flowers-' + name, name, zh, note: 'Seeded flowering plant; merged foliage and blossoms' }); declare(root, { role: 'plant' });
  if (h >= .3) setCollider(root, { w: footprint, d: footprint, h });
  return root;
}

// Cache eight visibly different specimens per species: geometry/materials are
// reused across the drifts, while placement yaw/scale add more variation.
function seeded(kind, seed, make) {
  const v = (seed >>> 0) % 8, key = kind + ':' + v;
  if (!SPECIMENS.has(key)) SPECIMENS.set(key, make(lcg(v * 139 + kind.length * 997 + 11)));
  return SPECIMENS.get(key).clone(true);
}

const SHRUBS = {
  ixora: { name: 'Coral ixora', zh: '珊瑚龙船花', h: .68, rad: .30, heads: 6, blooms: 10, size: .019, c: ['#e9542b', '#d83826'], lobes: 4 },
  firebush: { name: 'Firebush', zh: '醉娇花', h: .95, rad: .34, heads: 7, blooms: 8, size: .014, c: ['#eb642b', '#cc3824'], tubular: true },
  pentasRed: { name: 'Red pentas', zh: '红色繁星花', h: .44, rad: .25, heads: 5, blooms: 9, size: .017, c: ['#c93645', '#d84550'], pointed: true },
  pentasPink: { name: 'Pink pentas', zh: '粉色繁星花', h: .42, rad: .25, heads: 5, blooms: 9, size: .017, c: ['#db7892', '#c85b7b'], pointed: true },
  plumbago: { name: 'Blue plumbago', zh: '蓝雪花', h: .50, rad: .32, heads: 7, blooms: 6, size: .027, c: ['#769ed0', '#8eadd8'] },
  lantana: { name: 'Gold and coral lantana', zh: '金珊瑚五色梅', h: .38, rad: .27, heads: 6, blooms: 10, size: .016, c: ['#e1b43b', '#e79b36', '#d7674c'], lobes: 4 },
};
function floweringShrub(kind, seed) {
  return seeded(kind, seed, r => {
    const sp = SHRUBS[kind], root = new THREE.Group(), leaves = new Batch(), stems = new Batch(), flowers = new Batch();
    const H = sp.h * rr(r, .92, 1.07), R = sp.rad;
    const sprig = geo('sprig', () => cardGeo(.22, .26, { sy: 2, bend: .3, fold: .1 }));
    const foliage = leafMat('flowers-shrub', texSprig('flowers-shrub', { n: 20, len: [32, 48], wid: [13, 19], base: '#28552b', hi: '#648e48', dark: .72 }), { soft: true, rough: .68, env: .5 });
    // Dense inner and outer leafy sprays, rather than a coloured ball or bare stems.
    for (let k = 0; k < 38; k++) {
      const y = rr(r, .12, H * .89), a = k * GOLD, radius = R * Math.sqrt(r()) * (1 - .3 * y / H);
      leaves.add(sprig, { pos: [Math.sin(a) * radius, y - .11, Math.cos(a) * radius],
        q: orient(a, rr(r, .5, 1.55), rr(r, -.7, .7)), s: rr(r, .85, 1.2), tint: tint(r, .15),
        soft: { c: new THREE.Vector3(0, H * .4, 0), k: .45 } });
    }
    for (let k = 0; k < sp.heads; k++) {
      const a = k * GOLD + rr(r, -.3, .3), rad = R * rr(r, .45, .9), y = H * rr(r, .78, 1);
      const C = [Math.sin(a) * rad, y, Math.cos(a) * rad];
      twig(stems, [[0, 0, 0], [C[0] * .6, H * .45, C[2] * .6], C], kind === 'firebush' ? .009 : .005);
      for (let j = 0; j < sp.blooms; j++) {
        const ph = j * GOLD, rd = Math.sqrt(j / sp.blooms) * (kind === 'plumbago' ? .067 : .053);
        const P = add(C, [Math.cos(ph) * rd, rr(r, -.012, .018) + .035 * (1 - rd / .08), Math.sin(ph) * rd]);
        const hue = sp.c[Math.floor(r() * sp.c.length)], yaw = a + rr(r, -.9, .9), tilt = rr(r, -.9, -.35);
        if (sp.tubular) {
          const E = add(P, [Math.sin(yaw) * .035, .022, Math.cos(yaw) * .035]);
          twig(flowers, [P, add(P, [0, .015, 0]), E], .004, color(hue));
          blossom(flowers, E, sp.size, hue, yaw, tilt, { lobes: 4, throat: false });
        } else blossom(flowers, P, sp.size * rr(r, .85, 1.12), hue, yaw, tilt, { lobes: sp.lobes || 5, pointed: sp.pointed, throat: false });
      }
    }
    root.add(stems.mesh(stemMaterial()), leaves.mesh(foliage), flowers.mesh(petalMaterial()));
    return finish(root, sp.name, sp.zh, .16, H);
  });
}

function hibiscus(seed = 1, tone = 'coral') {
  return seeded('hibiscus-' + tone, seed, r => {
    const root = new THREE.Group(), leaves = new Batch(), stems = new Batch(), flowers = new Batch();
    const hues = { coral: '#e7735b', red: '#c63731', yellow: '#e6bf53' }, H = rr(r, .85, 1.10);
    for (let k = 0; k < 6; k++) {
      const a = k * GOLD, C = [Math.sin(a) * .25, H * rr(r, .68, 1), Math.cos(a) * .25];
      twig(stems, [[0, 0, 0], [C[0] * .7, H * .45, C[2] * .7], C], .012);
      for (let j = 0; j < 8; j++) {
        const f = .25 + j * .08, P = [C[0] * f, C[1] * f, C[2] * f];
        leaves.add(leafGeometry(), { pos: P, q: orient(a + j * GOLD, rr(r, .75, 1.8), rr(r, -.4, .4)), s: [1.4, 1.15, 1], tint: tint(r, .15) });
      }
      if (k < 4) {
        const yaw = a + .2, tilt = -.35, radius = rr(r, .075, .09), q = facing(yaw, tilt);
        blossom(flowers, C, radius, hues[tone], yaw, tilt);
        // Long protruding staminal column and five stigma tips identify hibiscus.
        const E = add(C, new THREE.Vector3(0, 0, .065).applyQuaternion(q).toArray());
        twig(flowers, [C, add(C, new THREE.Vector3(0, 0, .03).applyQuaternion(q).toArray()), E], .0025, color('#e7bd62'));
        for (let t = 0; t < 5; t++) flowers.add(dot(), { pos: add(E, [Math.sin(t * GOLD) * .004, Math.cos(t * GOLD) * .004, .002]), q, s: .003, tint: color('#bd3426') });
      }
    }
    root.add(stems.mesh(stemMaterial()), leaves.mesh(leafMaterial()), flowers.mesh(petalMaterial()));
    return finish(root, tone + ' hibiscus', '朱槿 · ' + ({coral:'珊瑚',red:'红',yellow:'黄'}[tone]), .22, H);
  });
}

function guzmania(seed = 1, tone = 'red') {
  return seeded('guzmania-' + tone, seed, r => {
    const root = new THREE.Group(), leaves = new Batch(), stems = new Batch(), bracts = new Batch();
    const strap = geo('guz-leaf', () => cardGeo(.07, .36, { sx: 2, sy: 5, bend: .8, fold: -.25 }));
    for (let k = 0; k < 17; k++) leaves.add(strap, { pos: [0, .015, 0], q: orient(k * GOLD, .3 + k / 17 * .85, rr(r, -.15, .15)), s: rr(r, .85, 1.12), tint: tint(r) });
    const H = rr(r, .43, .51);
    twig(stems, [[0, 0, 0], [.008, .24, 0], [0, H, 0]], .012);
    const b = geo('guz-bract', () => cardGeo(.042, .12, { sx: 2, sy: 3, bend: .25, taper: 1, fold: -.3 }));
    for (let k = 0; k < 15; k++) bracts.add(b, { pos: [0, H - .15 + k * .008, 0], q: orient(k * GOLD, .3 + (1 - k / 15) * .8, .1),
      s: 1 - k / 35, tint: color(tone === 'orange' ? (k > 10 ? '#eab943' : '#e56d29') : (k > 10 ? '#df6c32' : '#c93232')) });
    root.add(leaves.mesh(leafMat('flowers-guzmania', texStrap('flowers-guzmania', '#325c2d', '#5c843e', '#75934d'), { rough: .47 })), stems.mesh(stemMaterial()), bracts.mesh(petalMaterial()));
    return finish(root, tone + ' flowering bromeliad', '开花凤梨 · ' + (tone === 'red' ? '红' : '橙'), .13, H);
  });
}

function crane(seed = 1, heliconia = false) {
  return seeded(heliconia ? 'heliconia' : 'birdOfParadise', seed, r => {
    const root = new THREE.Group(), leaves = new Batch(), stems = new Batch(), flowers = new Batch();
    const H = heliconia ? 1.35 : 1.1;
    for (let k = 0; k < 11; k++) {
      const a = k * GOLD, rad = rr(r, .05, .15), P = [Math.sin(a) * rad, rr(r, .24, .65), Math.cos(a) * rad];
      twig(stems, [[P[0] * .3, 0, P[2] * .3], [P[0] * .6, P[1] * .55, P[2] * .6], P], .013);
      leaves.add(leafGeometry(true), { pos: P, q: orient(a, rr(r, .28, .95), rr(r, -.15, .15)), s: [rr(r, .75, 1), rr(r, .8, 1.15), 1], tint: tint(r, .13) });
    }
    const blade = geo('crane-sepal', () => cardGeo(.042, .19, { sx: 2, sy: 3, taper: 1, bend: -.13, fold: -.4 }));
    const spathe = geo('crane-spathe', () => cardGeo(.075, .26, { sx: 2, sy: 3, taper: .92, bend: .22, fold: -.4 }));
    for (let k = 0; k < 3; k++) {
      const a = k * 2.25 + .3, P = [Math.sin(a) * .17, H * rr(r, .87, 1.05), Math.cos(a) * .17];
      twig(stems, [[P[0] * .25, 0, P[2] * .25], [P[0] * .8, P[1] * .6, P[2] * .8], P], .009);
      if (heliconia) {
        for (let j = 0; j < 5; j++) {
          const A = add(P, [0, j * .10 - .1, 0]), yaw = a + (j % 2 ? Math.PI : 0);
          flowers.add(spathe, { pos: A, q: orient(yaw, 1.05, .2), s: [.9, .75, 1], tint: color(j > 3 ? '#e4993c' : '#d94c30') });
          flowers.add(blade, { pos: A, q: orient(yaw, .8, .1), s: [.65, .55, 1], tint: color('#d9b755') });
        }
      } else {
        flowers.add(spathe, { pos: P, q: orient(a, 1.55, 0), tint: color('#526c45') });
        for (let j = 0; j < 4; j++) flowers.add(blade, { pos: add(P, [Math.sin(a) * j * .027, .01, Math.cos(a) * j * .027]),
          q: orient(a + .25, .05 + j * .22, rr(r, -.1, .1)), s: [rr(r, .7, 1), rr(r, .9, 1.2), 1], tint: color(j === 3 ? '#ecac39' : '#e87b26') });
        flowers.add(blade, { pos: add(P, [0, .014, 0]), q: orient(a, 1.1, -.2), s: [.45, 1.1, 1], tint: color('#42549a') });
      }
    }
    root.add(stems.mesh(stemMaterial()), leaves.mesh(leafMaterial(true)), flowers.mesh(petalMaterial()));
    return finish(root, heliconia ? 'Heliconia lobster claw' : 'Bird of paradise', heliconia ? '赫蕉 · 龙虾爪' : '鹤望兰', .22, H);
  });
}

function firespike(seed = 1) {
  return seeded('firespike', seed, r => {
    const root = new THREE.Group(), leaves = new Batch(), stems = new Batch(), flowers = new Batch();
    for (let k = 0; k < 5; k++) {
      const a = k * GOLD, H = rr(r, .85, 1.15), C = [Math.sin(a) * .18, H, Math.cos(a) * .18];
      twig(stems, [[0, 0, 0], [C[0], H * .5, C[2]], C], .009);
      for (let j = 0; j < 5; j++) for (let side = 0; side < 2; side++) leaves.add(leafGeometry(), {
        pos: [C[0] * .8, .18 + j * .12, C[2] * .8], q: orient(a + j * 1.1 + side * Math.PI, 1.05, .1), s: [1.7, 1.35, 1], tint: tint(r) });
      for (let j = 0; j < 12; j++) {
        const yaw = j * GOLD, P = [C[0], H - .2 + j * .017, C[2]], E = add(P, [Math.sin(yaw) * .045, .015, Math.cos(yaw) * .045]);
        twig(flowers, [P, add(P, [0, .01, 0]), E], .003, color('#cb3940'));
        blossom(flowers, E, .010, '#d13b41', yaw, -.3, { throat: false });
      }
    }
    root.add(stems.mesh(stemMaterial()), leaves.mesh(leafMaterial()), flowers.mesh(petalMaterial()));
    return finish(root, 'Firespike', '红花珊瑚', .18, 1.15);
  });
}

function bougainvillea(seed = 1) {
  return seeded('bougainvillea', seed, r => {
    const root = new THREE.Group(), leaves = new Batch(), stems = new Batch(), flowers = new Batch();
    // Slender garden stakes and three ties actually support the trained canes.
    for (const x of [-.24,.24]) twig(stems, [[x,0,-.08],[x,.9,-.08],[x,1.75,-.08]], .009, color('#645947'));
    for (const y of [.7,1.15,1.6]) twig(stems, [[-.24,y,-.08],[0,y,-.08],[.24,y,-.08]], .002, color('#4a4c40'));
    for (let k = 0; k < 5; k++) {
      const E = [rr(r, -.35, .35), rr(r, 1.1, 1.8), rr(r, -.10, .10)];
      twig(stems, [[0, 0, 0], [E[0] * .5, E[1] * .55, E[2]], E], .014, color('#745a42'));
      for (let j = 0; j < 10; j++) {
        const f = .15 + j * .08, P = [E[0] * f, E[1] * f, E[2]], a = j * GOLD;
        leaves.add(leafGeometry(), { pos: P, q: orient(a, .9, .1), s: [.85, .7, 1], tint: tint(r) });
        if (j > 3) for (let b = 0; b < 3; b++) blossom(flowers, add(P, [Math.sin(a) * .075, .025 + b * .018, Math.cos(a) * .07]),
          .026, b === 0 ? '#b23c72' : '#c75787', a + b, -.2, { lobes: 3, pointed: true, throat: b === 0 });
      }
    }
    root.add(stems.mesh(stemMaterial()), leaves.mesh(leafMaterial()), flowers.mesh(petalMaterial()));
    return finish(root, 'Fence-trained bougainvillea', '围栏三角梅', .16, 1.8);
  });
}

// Two flowering containers for courtyard A; matte stoneware, hollow rim, real soil.
function floweringPot(seed = 1, kind = 'guzmania') {
  const root = new THREE.Group(), H = .27;
  const material = M.ceramicSpeckle();
  root.add(lathe([[.105,0],[.116,.014],[.139,.22],[.142,H],[.127,H],[.124,H-.027],[.110,.02]], material, { seg: 24 }));
  root.add(cyl(.124,.124,.008,plainMat('flowers-pot-soil',0x3c3023,{vertexColors:false,rough:1}),{y:H-.026,seg:24}));
  const plant = kind === 'guzmania' ? guzmania(seed, 'orange') : floweringShrub('pentasPink', seed);
  plant.position.y = H - .022; root.add(plant);
  return finish(root, kind === 'guzmania' ? 'Potted orange bromeliad' : 'Potted pink pentas', kind === 'guzmania' ? '盆栽橙凤梨' : '盆栽粉繁星花', .28, .75);
}

function frontGeranium(seed = 1) {
  return seeded('frontGeranium', seed, r => {
    const root = new THREE.Group(), leaves = new Batch(), stems = new Batch(), flowers = new Batch();
    for (let k = 0; k < 12; k++) {
      const a = k * GOLD, C = [Math.sin(a) * rr(r, .2, .35), rr(r, .25, .45), Math.cos(a) * rr(r, .2, .35)];
      twig(stems, [[0, 0, 0], [C[0] * .5, C[1] * .65, C[2] * .5], C], .004);
      for (let j = 0; j < 6; j++) leaves.add(leafGeometry(), { pos: add(C, [0, -.03 * j, 0]), q: orient(a + j * GOLD, rr(r, .6, 1.6), rr(r, -.3, .3)), s: [1.2, 1.15, 1], tint: color(j % 3 ? '#91aa6a' : '#b0b986') });
      if (k < 5) {
        const E = add(C, [Math.sin(a) * .12, rr(r, .15, .35), Math.cos(a) * .12]); twig(stems, [C, E], .003);
        for (let j = 0; j < 16; j++) { const ph = j * GOLD, rd = Math.sqrt(j / 16) * .055; blossom(flowers, add(E, [Math.sin(ph) * rd, rr(r, -.02, .02), Math.cos(ph) * rd]), .026, j % 3 ? '#d34439' : '#e2584a', a + ph, -.5, { throat: false }); }
      }
    }
    root.add(stems.mesh(stemMaterial()), leaves.mesh(leafMaterial()), flowers.mesh(petalMaterial()));
    return finish(root, 'Front terrace red geranium', '红色天竺葵', .2, .8);
  });
}

export const items = {
  frontGeranium,
  birdOfParadise: (seed = 1) => crane(seed), heliconia: (seed = 1) => crane(seed, true),
  guzmaniaRed: (seed = 1) => guzmania(seed), guzmaniaOrange: (seed = 1) => guzmania(seed, 'orange'),
  ...Object.fromEntries(Object.keys(SHRUBS).map(kind => [kind, (seed = 1) => floweringShrub(kind, seed)])),
  hibiscusCoral: (seed = 1) => hibiscus(seed), hibiscusRed: (seed = 1) => hibiscus(seed, 'red'),
  hibiscusYellow: (seed = 1) => hibiscus(seed, 'yellow'), firespike, bougainvillea,
  potBromeliad: (seed = 1) => floweringPot(seed), potPentas: (seed = 1) => floweringPot(seed, 'pentas'),
};
