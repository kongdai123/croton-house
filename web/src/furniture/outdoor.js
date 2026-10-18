// outdoor — back-yard fire-pit group, patio, fence and front-yard pieces of 2513 Croton Ave.
// Sources: refs/outdoor g40/g41/g42 (fire sphere, wicker egg chairs + poufs, the owner's lumber table and slatted
// cinder-block stools, navy market umbrella), g37/g38/g39/g44 (white moulded patio armchairs), g03/g05/g06 (front yard:
// low lumber platform bench, white pots, porch sconce), g43 (white rendered planters), rednote dusk shots (white urn).
import { THREE, M, box, cyl, tube, group, at, addSeat, setMovable, setCollider, autoCollider, describe, shadow, declare } from '../kit.js';
import { ss, rng, wickerResin, WEAVE_TILE, pitSteel, galvanized, powderBlack, lumberTop, soil, concreteGrey, cinder, vinylShade, ash, charEnd, lumberPT, barkDark, cushionCream, navyDeep, renderWhite,
  board, latheM, ringShell, strut, puffPillow, roundCushion, fireScreen, sconceAlpha, animatedToggle } from './outdoor_parts.js';

const PI = Math.PI;
const root = (...kids) => group(...kids);

// ---------------------------------------------------------------- fire sphere (g40 close-up)
// Black steel "fire globe": solid bowl, see-through spark-screen band + lift-off dome with birch-tree cut-outs,
// flat straps, equator flange with a side ring handle, top lift loop, four splayed square legs; logs inside.
function firePit() {
  const R = 0.32, cy = 0.48, g = root();
  const steel = pitSteel().clone(), screen = fireScreen().clone();
  steel.emissive.set(0xff4808); steel.side = THREE.DoubleSide; screen.emissive.set(0xff6514);
  steel.userData.emits = screen.userData.emits = 'fire';
  const part = (t0, t1, mat, r = R, seg = 64) => { const geo = new THREE.SphereGeometry(r, seg, 24, 0, 2 * PI, t0, t1 - t0);
    const uv = geo.attributes.uv, p = geo.attributes.position; for (let i = 0; i < p.count; i++) uv.setY(i, 1 - Math.acos(Math.max(-1, Math.min(1, p.getY(i) / r))) / PI);
    const m = new THREE.Mesh(geo, mat); m.position.y = cy; return shadow(m); };
  const tb = THREE.MathUtils.degToRad(123);
  g.add(part(tb, PI, steel));                                    // solid bowl
  const scrLow = part(PI / 2, tb, screen, R, 64), dome = part(0, PI / 2, screen, R + 0.004, 64);
  for (const s of [scrLow, dome]) { s.castShadow = false; g.add(s); }
  // flanges: bowl rim, equator (lid lip + band), small top collar
  const ring = (r, y, tube) => { const t = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 72), pitSteel()); t.rotation.x = PI / 2; t.position.y = y; return shadow(t); };
  g.add(ring(R * Math.sin(tb) + 0.002, cy + R * Math.cos(tb), 0.007));
  g.add(cyl(R + 0.012, R + 0.012, 0.03, pitSteel(), { y: cy + 0.004, open: true, seg: 72 }), ring(R + 0.012, cy - 0.011, 0.006), ring(R + 0.012, cy + 0.019, 0.006));
  // straps: 4 meridians over the dome, 8 short ones on the lower screen
  for (let k = 0; k < 2; k++) { const t = new THREE.Mesh(new THREE.TorusGeometry(R + 0.006, 0.0065, 6, 48, PI), pitSteel()); t.position.y = cy; t.rotation.y = k * PI / 2; g.add(shadow(t)); }
  for (let k = 0; k < 8; k++) { const t = new THREE.Mesh(new THREE.TorusGeometry(R + 0.004, 0.006, 6, 12, tb - PI / 2), pitSteel()); t.position.y = cy; t.rotation.set(0, k * PI / 4 + PI / 8, -(tb - PI / 2)); g.add(shadow(t)); }
  // top lift loop and side ring handle
  const loop = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.0045, 8, 24), pitSteel()); loop.position.y = cy + R + 0.024; g.add(shadow(loop));
  g.add(cyl(0.016, 0.02, 0.012, pitSteel(), { y: cy + R + 0.004 }));
  const hdl = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.0055, 8, 24), pitSteel()); hdl.rotation.x = PI / 2; hdl.position.set(-(R + 0.045), cy + 0.004, 0); g.add(shadow(hdl));
  // legs: square tube, welded under the bowl, splayed
  for (let k = 0; k < 4; k++) { const a = PI / 4 + k * PI / 2, s = Math.sin(a), c = Math.cos(a);
    g.add(strut([0.17 * s, cy - 0.27, 0.17 * c], [0.3 * s, 0.012, 0.3 * c], 0.026, 0.026, pitSteel()));
    g.add(box(0.05, 0.012, 0.05, pitSteel(), { x: 0.3 * s, z: 0.3 * c, bottom: true, r: 0.003, ry: a })); }
  // fuel: ash bed + three split logs (bark sides, sawn ends)
  const embers = ash().clone(), bark = barkDark().clone(), ends = charEnd().clone();
  for (const m of [embers, bark, ends]) { m.emissive.set(0xff3b04); m.userData.emits = 'fire'; }
  g.add(cyl(0.2, 0.2, 0.01, embers, { y: cy - R + 0.07 }));
  const logGeo = new THREE.CylinderGeometry(0.038, 0.042, 0.36, 10, 1); const mats = [bark, ends, ends];
  [[0, 0.24, 0, 0.3], [0.04, 0.27, 0.05, 1.5], [-0.05, 0.285, -0.02, 2.5]].forEach(([x, y, z, ry], i) => {
    const l = shadow(new THREE.Mesh(logGeo, mats)); l.rotation.set(0, ry, PI / 2 + (i - 1) * 0.12, 'YXZ'); l.position.set(x, y + (cy - 0.48), z); g.add(l); });
  // One permanent warm light; intensity fades to zero in daylight or when extinguished.
  const glow = new THREE.PointLight(0xff8b38, 0, 3.5, 2); glow.position.y = 0.55; g.add(glow);
  declare(glow, { emits: { kind: 'fire' }, bake: false });   // the fire's light: live (and in photo mode), not in the bake
  const flameMat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, strength: { value: 0 } }, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `attribute float seed; varying vec2 vUv; varying float vSeed; uniform float time;
      void main() { vUv = uv; vSeed = seed; vec3 p = position;
        p.x += sin(time * 4.7 + seed * 9.0 + uv.y * 5.0) * 0.014 * uv.y;
        p.y += sin(time * 6.0 + seed * 13.0) * 0.025 * uv.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
    fragmentShader: `varying vec2 vUv; varying float vSeed; uniform float time; uniform float strength;
      void main() { float y = vUv.y; float x = vUv.x - 0.5;
        x += sin(y * 9.0 - time * 5.5 + vSeed * 17.0) * (0.025 + y * 0.07);
        float noise = sin(y * 23.0 - time * 8.0 + vSeed * 11.0) * sin(y * 11.0 + time * 3.0);
        float width = (1.0 - y) * 0.40 + noise * 0.035;
        float a = (1.0 - smoothstep(width - 0.10, width, abs(x))) * smoothstep(0.0, 0.12, y) * (1.0 - y);
        vec3 col = mix(vec3(1.0, 0.72, 0.19), vec3(1.0, 0.12, 0.008), y);
        gl_FragColor = vec4(col * 2.2, a * strength * 0.8); }`,
  });
  // Several crossed tongues share one draw call, so flames read from every standing view.
  const pos = [], uv = [], seeds = [], indices = [];
  for (let k = 0; k < 5; k++) for (let cross = 0; cross < 2; cross++) {
    const a = k * 2.4 + cross * PI / 2, x = Math.sin(k * 2.4) * 0.095, z = Math.cos(k * 2.4) * 0.095;
    const w = 0.095 + (k % 2) * 0.02, h = 0.29 + (k % 3) * 0.055, base = pos.length / 3;
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      pos.push(x + (u - 0.5) * w * 2 * Math.cos(a), 0.27 + v * h, z + (u - 0.5) * w * 2 * Math.sin(a));
      uv.push(u, v); seeds.push(k / 5);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const flameGeo = new THREE.BufferGeometry();
  flameGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  flameGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  flameGeo.setAttribute('seed', new THREE.Float32BufferAttribute(seeds, 1)); flameGeo.setIndex(indices);
  const flames = new THREE.Mesh(flameGeo, flameMat); flames.userData.allowOverride = false; flames.raycast = () => {}; g.add(flames);
  // Radial amber wash on the gravel, without a hard disc edge or another light.
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d'), gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,155,58,0.5)'); gradient.addColorStop(0.35, 'rgba(255,101,20,0.25)'); gradient.addColorStop(1, 'rgba(255,68,0,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64);
  const washMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
  const wash = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 2.1), washMat); wash.rotation.x = -PI / 2; wash.position.y = 0.018;
  wash.userData.allowOverride = false; wash.raycast = () => {}; g.add(wash);
  const sparkPos = new Float32Array(12 * 3), sparkGeo = new THREE.BufferGeometry(); sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparkMat = new THREE.PointsMaterial({ color: 0xffb04c, size: 0.012, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const sparks = new THREE.Points(sparkGeo, sparkMat); sparks.userData.allowOverride = false; sparks.raycast = () => {}; g.add(sparks);
  // Collider belongs to the steel footprint, rather than the flame/glow effects.
  describe(g, { id: 'outdoor-fire-pit', name: 'fire sphere', zh: '球形火盆' });
  setCollider(g, { w: 0.7, d: 0.7, h: 0.83 });
  g.traverse(o => { if (o.material === steel || o.material === screen || o.material === embers || Array.isArray(o.material)) o.userData.noHighlight = true; });
  const toggle = animatedToggle(g, {
    label: { en: 'Light fire pit', zh: '点燃火盆' }, labelOn: { en: 'Extinguish fire pit', zh: '熄灭火盆' }, duration: 1.1,
    apply(on, t) {
      const flicker = 0.88 + 0.09 * Math.sin(t * 11.7) + 0.06 * Math.sin(t * 17.3 + 1.2) + 0.04 * Math.sin(t * 7.1);
      flameMat.uniforms.time.value = t; flameMat.uniforms.strength.value = on;
      glow.intensity = on * flicker * 2.3;
      steel.emissiveIntensity = on * flicker * 0.08; screen.emissiveIntensity = on * flicker * 0.12;
      embers.emissiveIntensity = on * flicker * 2.8; bark.emissiveIntensity = on * flicker * 0.45; ends.emissiveIntensity = on * flicker * 1.7;
      washMat.opacity = on * flicker * 0.65; sparkMat.opacity = on * 0.85;
      for (let i = 0; i < 12; i++) {
        const life = (t * (0.32 + i * 0.011) + i * 0.137) % 1;
        sparkPos[i * 3] = Math.sin(i * 13.7 + life * 3) * (0.035 + life * 0.12);
        sparkPos[i * 3 + 1] = 0.36 + life * 0.59;
        sparkPos[i * 3 + 2] = Math.cos(i * 8.3 + life * 4) * (0.03 + life * 0.1);
      }
      sparkGeo.attributes.position.needsUpdate = true;
    },
  });
  g.userData.onTime = (dusk, instant) => toggle.set(dusk, instant);
  return g;
}

// ---------------------------------------------------------------- wicker egg chair (g40/g42)
function wickerChair() {
  const g = root();
  const Rof = (y) => 0.40 * Math.sqrt(Math.max(0.02, 1 - ((y - 0.45) / 0.55) ** 2));
  const shell = ringShell({ outer: (phi, y) => { const r = Rof(y); return [r * Math.sin(phi), r * Math.cos(phi)]; },
    top: (phi) => 0.28 + 0.41 * ss(0.15, 0.75, Math.abs(phi) / PI), bottom: () => 0.02, t: 0.06, nU: 112, nV: 20 }, wickerResin());
  g.add(shell);
  g.add(cyl(0.34, 0.34, 0.02, wickerResin(), { y: 0.29, seg: 40 }), cyl(0.22, 0.22, 0.02, wickerResin(), { y: 0.02, seg: 32 }));
  g.add(at(roundCushion(0.33, 0.115, cushionCream()), 0, 0.30, 0));
  for (const s of [-1, 1]) { const ph = PI + s * 0.5, p = puffPillow(0.40, 0.34, 0.14, cushionCream()); p.rotation.order = 'YXZ'; p.rotation.set(-0.22, ph + PI + s * 0.08, s * 0.05);
    p.position.set(0.21 * Math.sin(ph), 0.57, 0.21 * Math.cos(ph)); g.add(p); }
  describe(g, { id: 'outdoor-wicker-chair', name: 'wicker egg chair', zh: '藤编蛋形椅' });
  setMovable(g, { mass: 12, radius: 0.42 }); addSeat(g, { y: 0.42, facing: 0, kind: 'armchair' });
  return autoCollider(g);
}

// ---------------------------------------------------------------- wicker pouf (g40/g41)
function wickerOttoman() {
  const g = root();
  g.add(latheM([[0, 0], [0.17, 0], [0.19, 0.012], [0.225, 0.07], [0.248, 0.16], [0.25, 0.2], [0.243, 0.26], [0.225, 0.31], [0.205, 0.335], [0.19, 0.34], [0, 0.34]], wickerResin(), { seg: 64, tile: WEAVE_TILE }));
  g.add(at(roundCushion(0.232, 0.072, cushionCream()), 0, 0.34, 0));
  describe(g, { id: 'outdoor-wicker-ottoman', name: 'wicker pouf', zh: '藤编坐墩' });
  setMovable(g, { mass: 5, radius: 0.26 }); addSeat(g, { y: 0.42, facing: 0, kind: 'stool' });
  return autoCollider(g);
}

// ---------------------------------------------------------------- the owner's lumber table (g40/g41 close-ups)
const boltGeo = new THREE.LatheGeometry([[0, 0], [0.0125, 0], [0.012, 0.002], [0.008, 0.0055], [0, 0.007]].map(([r, h]) => new THREE.Vector2(r, h)), 16);
function bolt(x, y, z, nx, nz) { const m = shadow(new THREE.Mesh(boltGeo, galvanized())); m.position.set(x, y, z); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, 0, nz)); return m; }
function benchTable() {
  const g = root(), H = 0.75, T = 0.045, L = 1.5, D = 0.5;
  // top: three weathered boards with 10 mm gaps, galvanized mending plates across the seams
  [-1, 0, 1].forEach((k, i) => g.add(board(L, T, 0.16, lumberTop(), { axis: 'x', r: 0.006, y: H - T / 2, z: k * 0.17, off: i * 0.31, tile: 0.8 })));
  for (const x of [-0.62, -0.2, 0.22, 0.6]) for (const z of [-0.085, 0.085]) g.add(box(0.05, 0.002, 0.035, galvanized(), { x, y: H, z, r: 0.0008, seg: 1 }));
  const lx = 0.682, lz = 0.1935, legH = H - T;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    for (const k of [-1, 1]) g.add(board(0.038, legH, 0.089, lumberPT(), { axis: 'y', y: legH / 2, x: sx * lx + k * 0.0192, z: sz * lz, off: (sx + 2 * sz + k) * 0.21 }));
    g.add(bolt(sx * lx + 0.0, 0.66, sz * (lz + 0.0445), 0, sz), bolt(sx * lx, 0.57, sz * (lz + 0.0445), 0, sz));
    g.add(bolt(sx * (lx + 0.038), 0.635, sz * lz, sx, 0), bolt(sx * (lx + 0.038), 0.17, sz * lz, sx, 0));
  }
  // long aprons (2x8) between the legs, end aprons and low stretchers (2x6) across each end
  for (const sz of [-1, 1]) g.add(board(2 * (lx - 0.038), 0.184, 0.038, lumberPT(), { axis: 'x', y: legH - 0.092, z: sz * 0.207, off: sz * 0.4 }));
  for (const sx of [-1, 1]) {
    g.add(board(0.038, 0.14, 2 * (lz - 0.0445), lumberPT(), { axis: 'z', x: sx * 0.689, y: legH - 0.07, off: sx * 0.6 }));
    g.add(board(0.038, 0.14, 2 * (lz - 0.0445), lumberPT(), { axis: 'z', x: sx * 0.689, y: 0.17, off: sx * 0.9 }));
  }
  describe(g, { id: 'outdoor-lumber-table', name: 'reclaimed lumber table', zh: '旧木料长桌', note: 'built by the owner; 2x lumber, carriage bolts' });
  return autoCollider(g);
}

// ---------------------------------------------------------------- slatted lumber stool on cinder blocks (g40/g41)
let cinderGeo;
function cinderBlock() {
  if (!cinderGeo) { const w = 0.39 - 0.008, d = 0.19 - 0.008, s = new THREE.Shape([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(p => new THREE.Vector2(...p)));
    for (const cx of [-0.095, 0.095]) s.holes.push(new THREE.Path([[cx - 0.065, -0.055], [cx + 0.065, -0.055], [cx + 0.065, 0.055], [cx - 0.065, 0.055]].map(p => new THREE.Vector2(...p))));
    cinderGeo = new THREE.ExtrudeGeometry(s, { depth: 0.194 - 0.008, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 }); cinderGeo.rotateX(-PI / 2); cinderGeo.translate(0, 0.004, 0); }
  return shadow(new THREE.Mesh(cinderGeo, cinder()));
}
function stoolLumber() {
  const g = root(), bh = 0.194;
  g.add(cinderBlock(), at(cinderBlock(), 0, bh + 0.002, 0));
  g.add(box(0.37, 0.004, 0.17, M.concrete(), { y: bh, bottom: true }));   // mortar-ish joint
  const y0 = 2 * bh + 0.002;
  for (const x of [-0.15, 0.15]) g.add(board(0.064, 0.038, 0.38, lumberPT(), { axis: 'z', x, y: y0 + 0.019, off: x }));
  const n = 8, sw = 0.042, gap = 0.008, top = y0 + 0.038;
  for (let i = 0; i < n; i++) { const z = (i - (n - 1) / 2) * (sw + gap);
    g.add(board(0.56, 0.025, sw, lumberPT(), { axis: 'x', r: 0.004, y: top + 0.0125, z, off: i * 0.23, tile: 0.6 }));
    for (const x of [-0.15, 0.15]) g.add(cyl(0.0045, 0.0045, 0.002, galvanized(), { x, y: top + 0.025, z, seg: 8 })); }
  describe(g, { id: 'outdoor-lumber-stool', name: 'slatted lumber stool on cinder blocks', zh: '木条凳（煤渣砖座）' });
  setMovable(g, { mass: 30, radius: 0.3 }); addSeat(g, { y: 0.45, facing: 0, kind: 'stool' });
  return autoCollider(g);
}

// ---------------------------------------------------------------- white moulded patio armchair (g37/g38/g39/g44)
// One-piece shell like the IKEA SKARPÖ seen on the patio: rounded-square tub, arms almost as high as the back,
// the front edge drops to the seat, legs are the shell's own corners with arches between them.
function lounger() {
  const g = root(), a = 0.38, b = 0.355, n = 3.2, e = 2 / n, sp = (v) => Math.sign(v) * Math.pow(Math.abs(v), e);
  const outer = (phi, y) => { let x = a * sp(Math.sin(phi)), z = b * sp(Math.cos(phi));
    const fl = 1 + 0.06 * Math.max(0, y - 0.35) + 0.08 * Math.max(0, 0.28 - y); x *= fl; z *= 1 + 0.08 * Math.max(0, 0.28 - y);
    z -= 0.13 * Math.max(0, y - 0.36) * Math.max(0, -Math.cos(phi)); return [x, z]; };
  const legMask = (psi) => Math.max(1 - ss(0, 0.24, Math.abs(psi - 0.80)), 1 - ss(0, 0.24, Math.abs(psi - 2.34)));
  g.add(ringShell({ outer, t: 0.045, nU: 160, nV: 22, nc: 6, botSquash: 0.3, tile: 1,
    top: (phi) => { const p = Math.abs(phi); return 0.355 + 0.255 * ss(0.56, 0.8, p) + 0.125 * ss(0.85, 2.9, p); },
    bottom: (phi) => 0.008 + 0.26 * (1 - legMask(Math.abs(phi))) }, M.plasticWhite()));
  // seat pan: the shell's own plan at seat height, inset by the wall, as a 30 mm slab tilted slightly back
  const pts = []; for (let i = 0; i < 64; i++) { const ph = -PI + (i / 64) * 2 * PI, [x, z] = outer(ph, 0.36), k = 1 - 0.04 / Math.hypot(x, z); pts.push(new THREE.Vector2(x * k, -z * k)); }
  const pan = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 0.022, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2 });
  pan.rotateX(-PI / 2); const seat = shadow(new THREE.Mesh(pan, M.plasticWhite())); seat.position.y = 0.346; seat.rotation.x = -0.05; g.add(seat);
  // drain slots in the seat
  for (let i = -2; i <= 2; i++) g.add(box(0.012, 0.002, 0.12, vinylShade(), { x: i * 0.09, y: 0.377 + 0.003 * i * 0, z: -0.12, r: 0.0009, seg: 1, rx: -0.07 }));
  const cush = puffPillow(0.52, 0.36, 0.13, cushionCream()); cush.rotation.order = 'YXZ'; cush.rotation.set(-0.28, 0, 0); cush.position.set(0, 0.56, -0.2); g.add(cush);
  describe(g, { id: 'outdoor-patio-chair', name: 'white moulded patio armchair', zh: '白色一体塑料扶手椅' });
  setMovable(g, { mass: 7, radius: 0.4 }); addSeat(g, { y: 0.40, z: 0.06, facing: 0, kind: 'armchair' });
  return autoCollider(g);
}

// ---------------------------------------------------------------- navy market umbrella, furled / open (g40/g42/g37)
function umbrella() {
  const g = root();
  g.add(latheM([[0, 0], [0.215, 0], [0.225, 0.008], [0.226, 0.06], [0.215, 0.076], [0.19, 0.08], [0.055, 0.082], [0.045, 0.1], [0.034, 0.13], [0.03, 0.14], [0.022, 0.14], [0, 0.14]], concreteGrey(), { seg: 48, tile: 0.6 }));
  g.add(cyl(0.008, 0.008, 0.05, powderBlack(), { x: 0.045, y: 0.115, rz: PI / 2 }), cyl(0.014, 0.014, 0.012, powderBlack(), { x: 0.072, y: 0.115, rz: PI / 2 }));
  g.add(cyl(0.02, 0.02, 2.26, powderBlack(), { y: 0.1, bottom: true, seg: 16 }));
  // crank housing just under the canopy hem
  g.add(box(0.05, 0.11, 0.05, powderBlack(), { y: 0.98, r: 0.01 }), cyl(0.005, 0.005, 0.09, powderBlack(), { x: 0.06, y: 0.98, rz: PI / 2, seg: 8 }));
  g.add(cyl(0.005, 0.005, 0.07, powderBlack(), { x: 0.105, y: 0.95, seg: 8 }), cyl(0.009, 0.009, 0.04, powderBlack(), { x: 0.105, y: 0.905, seg: 10 }));
  // Eight fabric gores unfold continuously. Interpolation between rib ends makes a true octagon,
  // with a small catenary dip between ribs and a separate rain vent above the crown.
  const canopy = (vent = false) => {
    const nA = 96, nR = vent ? 5 : 16, positions = [], uvs = [], idx = [];
    for (let j = 0; j <= nR; j++) for (let i = 0; i <= nA; i++) { positions.push(0, 0, 0); uvs.push(i / nA * 8, j / nR); }
    for (let j = 0; j < nR; j++) for (let i = 0; i < nA; i++) {
      const a = j * (nA + 1) + i, b = a + nA + 1; idx.push(a, b, b + 1, a, b + 1, a + 1);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geo.setIndex(idx);
    const mesh = shadow(new THREE.Mesh(geo, navyDeep())); g.add(mesh);
    // Fixed bounds avoid rebuilding them as the canopy unfolds.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.8, 0), 1.45);
    const update = open => {
      const p = geo.attributes.position;
      for (let j = 0; j <= nR; j++) for (let i = 0; i <= nA; i++) {
        const s = j / nR, phi = i / nA * 2 * PI, sector = i / nA * 8;
        const k = Math.min(7, Math.floor(sector)), u = sector - k, a = k * PI / 4, b = a + PI / 4;
        const radius = vent ? 0.29 : 1.22;
        const ox = radius * s * ((1 - u) * Math.sin(a) + u * Math.sin(b));
        const oz = radius * s * ((1 - u) * Math.cos(a) + u * Math.cos(b));
        const oy = (vent ? 2.37 : 2.345) - (vent ? 0.11 : 0.42) * s - (vent ? 0.016 : 0.065) * Math.sin(PI * u) * s - 0.025 * Math.sin(PI * s);
        const cr = (vent ? 0.012 + 0.106 * Math.sin(s * PI / 2) : 0.016 + 0.11 * Math.sin(s * PI / 2) + 0.039 * s ** 7) * (1 + 0.16 * Math.cos(phi * 8) * s);
        const cy = (vent ? 2.37 - 0.21 * s : 2.345 - 1.245 * s) - 0.035 * Math.sin(PI * u) * s ** 5;
        p.setXYZ(j * (nA + 1) + i, cr * Math.sin(phi) * (1 - open) + ox * open, cy * (1 - open) + oy * open, cr * Math.cos(phi) * (1 - open) + oz * open);
      }
      p.needsUpdate = true; geo.computeVertexNormals();
    };
    return update;
  };
  const mainCanopy = canopy(), ventCanopy = canopy(true);
  const runner = cyl(0.034, 0.034, 0.075, powderBlack(), { y: 1.2, seg: 16 }); g.add(runner);
  const ribs = [], braces = [], up = new THREE.Vector3(0, 1, 0), start = new THREE.Vector3(0, 2.33, 0);
  for (let k = 0; k < 8; k++) {
    const rib = cyl(0.005, 0.005, 1, powderBlack(), { seg: 6 }), brace = cyl(0.004, 0.004, 1, powderBlack(), { seg: 6 });
    g.add(rib, brace); ribs.push(rib); braces.push(brace);
  }
  const tie = cyl(0.122, 0.122, 0.03, navyDeep(), { y: 1.62, seg: 32, open: true }); g.add(tie);
  g.add(cyl(0.022, 0.03, 0.02, powderBlack(), { y: 2.375 }), latheM([[0, 0], [0.012, 0], [0.016, 0.01], [0.013, 0.018], [0, 0.02]], powderBlack(), { seg: 16, y: 2.38 }));
  describe(g, { id: 'outdoor-umbrella', name: 'Navy market umbrella', zh: '藏青色庭院伞' });
  // Keep the pole/base footprint as the walking collider when the canopy opens overhead.
  setCollider(g, { w: 0.45, d: 0.45, h: 2.4 });
  let lastOpen = -1;
  animatedToggle(g, {
    label: { en: 'Open umbrella', zh: '撑开庭院伞' }, labelOn: { en: 'Close umbrella', zh: '收起庭院伞' }, duration: 1.1,
    apply(open) {
      if (open === lastOpen) return; lastOpen = open;
      mainCanopy(open); ventCanopy(open);
      runner.position.y = 1.2 + open * 0.85;
      tie.scale.setScalar(Math.max(0.001, 1 - open * 8));
      const pose = (mesh, a, b) => { const d = b.clone().sub(a); mesh.position.copy(a).add(b).multiplyScalar(0.5); mesh.scale.y = d.length(); mesh.quaternion.setFromUnitVectors(up, d.normalize()); };
      for (let k = 0; k < 8; k++) {
        const phi = k * PI / 4, r = 0.15 + open * 1.07, y = 1.075 + open * 0.83;
        const tip = new THREE.Vector3(r * Math.sin(phi), y, r * Math.cos(phi));
        pose(ribs[k], start, tip);
        pose(braces[k], new THREE.Vector3(0, runner.position.y, 0), start.clone().lerp(tip, 0.56));
      }
    },
  });
  return g;
}

// ---------------------------------------------------------------- white vinyl privacy fence panel (g40/g42/g43)
let fenceCache;
function fencePanel() {
  const W = 2.44, P = 0.13, span = W - 2 * P - 0.02, g = root(), n = 12, pitch = span / n, bw = pitch - 0.003, y0 = 0.06, y1 = 1.7;
  if (!fenceCache) fenceCache = { board: new THREE.BoxGeometry(1, 1, 1) };
  for (const sx of [-1, 1]) { const x = sx * (W / 2 - 0.01 - P / 2);
    g.add(box(P, 1.8, P, M.fenceVinyl(), { x, bottom: true, r: 0.006 }), box(P + 0.02, 0.022, P + 0.02, M.fenceVinyl(), { x, y: 1.8, bottom: true, r: 0.006 }), box(P - 0.01, 0.008, P - 0.01, M.fenceVinyl(), { x, y: 1.822, bottom: true, r: 0.003 })); }
  const bGeo = box(bw, y1 - y0, 0.025, M.fenceVinyl(), { r: 0.0035 }).geometry, sGeo = new THREE.BoxGeometry(0.008, y1 - y0, 0.004);
  for (let i = 0; i < n; i++) { const x = -span / 2 + pitch * (i + 0.5);
    const b = shadow(new THREE.Mesh(bGeo, M.fenceVinyl())); b.position.set(x, (y0 + y1) / 2, 0); g.add(b);
    if (i) { const s = new THREE.Mesh(sGeo, vinylShade()); s.position.set(x - pitch / 2, (y0 + y1) / 2, -0.008); g.add(s); } }
  g.add(box(span, 0.1, 0.05, M.fenceVinyl(), { y: 1.66, bottom: true, r: 0.008 }), box(span, 0.09, 0.05, M.fenceVinyl(), { y: 0.03, bottom: true, r: 0.008 }), box(span, 0.09, 0.035, M.fenceVinyl(), { y: 0.82, bottom: true, z: -0.03, r: 0.006 }));
  describe(g, { id: 'outdoor-fence-panel', name: 'white vinyl privacy fence panel', zh: '白色乙烯基隐私围栏' });
  return setCollider(g, { w: 2.44, d: 0.15, h: 1.83 });
}

// ---------------------------------------------------------------- front-yard low lumber platform bench (g03)
function plantersBench() {
  const g = root(), L = 1.9, bw = 0.14, t = 0.038;
  for (const z of [-0.22, 0.22]) g.add(board(L, t, bw, lumberPT(), { axis: 'x', y: t / 2, z, off: z }));
  for (const x of [-0.86, 0, 0.86]) for (const z of [-0.22, 0.22]) g.add(board(0.12, 0.12, bw, lumberPT(), { axis: 'y', x, y: t + 0.06, z, off: x + z }));
  const y0 = t + 0.12;
  for (let i = 0; i < 4; i++) { const z = (i - 1.5) * (bw + 0.013); g.add(board(L, t, bw, lumberTop(), { axis: 'x', y: y0 + t / 2, z, off: i * 0.37, tile: 0.9 }));
    for (const x of [-0.86, 0, 0.86]) for (const dz of [-0.035, 0.035]) g.add(cyl(0.0045, 0.0045, 0.002, galvanized(), { x: x + (dz > 0 ? 0.02 : -0.02), y: y0 + t, z: z + dz, seg: 8 })); }
  describe(g, { id: 'outdoor-front-platform-bench', name: 'front-yard lumber platform bench', zh: '前院木平台长凳' });
  addSeat(g, { x: -0.45, y: y0 + t, facing: 0, kind: 'bench' }); addSeat(g, { x: 0.45, y: y0 + t, facing: 0, kind: 'bench' });
  return autoCollider(g);
}

// ---------------------------------------------------------------- white planters
const rib = (amp, pitch, lo, hi) => (r, y) => [y > lo && y < hi ? r + amp * Math.sin((y / pitch) * 2 * PI) * ss(lo, lo + 0.03, y) * ss(hi, hi - 0.03, y) : r, y];
function potWhiteLarge() {
  const g = root();
  g.add(latheM([[0, 0], [0.17, 0], [0.2, 0.02], [0.268, 0.11], [0.298, 0.24], [0.292, 0.34], [0.262, 0.44], [0.232, 0.5], [0.234, 0.522], [0.25, 0.535], [0.248, 0.55], [0.226, 0.55], [0.214, 0.532], [0.212, 0.49], [0.21, 0.46]], M.ceramicWhite(), { seg: 64, tile: 0.4, warp: rib(0.0028, 0.03, 0.04, 0.47) }));
  g.add(cyl(0.214, 0.214, 0.012, soil(), { y: 0.49, seg: 40 }));
  describe(g, { id: 'outdoor-pot-white-large', name: 'large white ceramic urn planter', zh: '大号白色陶瓷花盆' });
  return autoCollider(g);
}
function potWhiteSmall() {
  const g = root();
  g.add(latheM([[0, 0], [0.145, 0], [0.163, 0.008], [0.17, 0.03], [0.175, 0.29], [0.175, 0.31], [0.168, 0.32], [0.157, 0.32], [0.152, 0.31], [0.15, 0.27]], M.ceramicWhite(), { seg: 56, tile: 0.4, warp: rib(0.0016, 0.022, 0.03, 0.29) }));
  g.add(cyl(0.151, 0.151, 0.01, soil(), { y: 0.285, seg: 36 }));
  describe(g, { id: 'outdoor-pot-white-small', name: 'small white ceramic planter', zh: '小号白色陶瓷花盆' });
  return autoCollider(g);
}
function planterBox() {
  const g = root(), W = 1.2, D = 0.4, H = 0.4, bv = 0.006, w = 0.045;
  const rect = (hw, hd) => [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(p => new THREE.Vector2(...p));
  const s = new THREE.Shape(rect(W / 2 - bv, D / 2 - bv)); s.holes.push(new THREE.Path(rect(W / 2 - w, D / 2 - w).reverse()));
  const geo = new THREE.ExtrudeGeometry(s, { depth: H - 2 * bv, bevelEnabled: true, bevelThickness: bv, bevelSize: bv, bevelSegments: 2, curveSegments: 4 });
  geo.rotateX(-PI / 2); geo.translate(0, bv, 0); g.add(shadow(new THREE.Mesh(geo, renderWhite())));
  g.add(box(W - 2 * w + 0.01, 0.34, D - 2 * w + 0.01, soil(), { bottom: true, y: 0.01 }));
  describe(g, { id: 'outdoor-planter-box', name: 'white rendered planter box', zh: '白色抹灰种植箱' });
  return autoCollider(g);
}

// ---------------------------------------------------------------- loose cushions
function cushionsOutdoor() {
  const g = root();
  [[-0.26, 0.1], [0.27, -0.15]].forEach(([x, ry]) => { const p = puffPillow(0.48, 0.48, 0.15, cushionCream()); p.rotation.order = 'YXZ'; p.rotation.set(-PI / 2, ry, 0); p.position.set(x, 0.08, 0); g.add(p); });
  describe(g, { id: 'outdoor-cushions', name: 'two loose cream outdoor cushions', zh: '两个米色户外靠垫' });
  return g;
}

// ---------------------------------------------------------------- porch sconce (g05/g06): black box lantern with a
// perforated front, open top/bottom washing light up and down the wall. Back face sits on z = -0.045.
function porchLight() {
  const g = root(), W = 0.13, H = 0.3, D = 0.09, cy = 1.85, z0 = -D / 2;
  g.add(box(W, H, 0.012, powderBlack(), { y: cy, z: z0 + 0.006, r: 0.002 }));
  for (const sx of [-1, 1]) g.add(box(0.008, H, D, powderBlack(), { x: sx * (W / 2 - 0.004), y: cy, r: 0.002 }));
  for (const sy of [-1, 1]) g.add(box(W, 0.018, 0.008, powderBlack(), { y: cy + sy * (H / 2 - 0.009), z: D / 2 - 0.004, r: 0.002 }), box(W, 0.008, 0.012, powderBlack(), { y: cy + sy * (H / 2 - 0.004), z: z0 + 0.014, r: 0.002 }));
  g.add(box(W - 0.03, H - 0.05, 0.03, M.emissiveWarm(), { y: cy, z: -0.005 }));
  for (const sy of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.018, D - 0.03), M.emissiveWarm()); p.rotation.x = -sy * PI / 2; p.position.set(0, cy + sy * (H / 2 - 0.012), 0.004); g.add(p); }
  const face = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.016, H - 0.036), new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.5, metalness: 0.5, alphaMap: sconceAlpha(), alphaTest: 0.5, side: THREE.DoubleSide }));
  face.position.set(0, cy, D / 2 - 0.006); g.add(shadow(face));
  describe(g, { id: 'outdoor-porch-light', name: 'porch wall sconce', zh: '门廊壁灯' });
  g.userData.light = { type: 'point', y: cy, z: 0.08, intensity: 0.6, color: 0xffd9a0, distance: 4 };
  return g;
}

function frontPallet() {
  const g = root(), L = 2.6, D = .92, t = .035;
  for (const z of [-.36, .36]) g.add(board(L, t, .16, lumberPT(), { axis: 'x', y: t / 2, z }));
  for (const x of [-1.15, 0, 1.15]) {
    for (const z of [-.36, .36]) g.add(board(.16, .12, .16, lumberPT(), { axis: 'y', x, y: .095, z }));
    g.add(board(.16, t, D, lumberPT(), { axis: 'z', x, y: .172 }));
  }
  for (let i = 0; i < 17; i++) {
    const x = -L / 2 + .075 + i * .153;
    g.add(board(.14, t, D, lumberTop(), { axis: 'z', x, y: .208, off: i * .21 }));
    for (const z of [-.36, .36]) g.add(cyl(.003, .003, .002, galvanized(), { x, y: .227, z, seg: 6 }));
  }
  describe(g, { id: 'outdoor-front-pallet', name: 'Low lumber pallet platform', zh: '前院木平台' });
  setCollider(g, { w: L, d: D, h: .45 }); return g;
}
function frontRoundPot() {
  const g = root();
  g.add(latheM([[0, 0], [.16, 0], [.20, .025], [.27, .15], [.29, .35], [.285, .46], [.265, .46], [.25, .43], [.245, .39], [0, .39]], M.ceramicWhite(), { seg: 48 }));
  g.add(cyl(.245, .245, .01, soil(), { y: .405, seg: 32 }));
  return autoCollider(g);
}
function frontCube() {
  const g = root(), w = .5, h = .5, t = .035;
  for (const x of [-1, 1]) g.add(box(t, h, w, renderWhite(), { x: x * (w - t) / 2, y: h / 2 }));
  for (const z of [-1, 1]) g.add(box(w - 2 * t, h, t, renderWhite(), { z: z * (w - t) / 2, y: h / 2 }));
  g.add(box(w - t * 2, .02, w - t * 2, soil(), { y: h - .065 }));
  return autoCollider(g);
}
function frontCurb() {
  const g = root(box(1, .25, .16, renderWhite(), { y: .115 }), box(1.015, .025, .18, renderWhite(), { y: .245 }));
  setCollider(g, { w: 1, d: .16, h: .26 }); return g;
}
function frontLamp() {
  const g = root(), white = renderWhite();
  g.add(latheM([[0, 0], [.11, 0], [.11, .04], [.075, .12], [.055, .19], [.048, 1.43], [.075, 1.45], [.075, 1.49], [.105, 1.52]], white, { seg: 24 }));
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xe9f2ef, emissive: 0xffdf9f, emissiveIntensity: .18, transparent: true, opacity: .19, roughness: .12, depthWrite: false, userData: { emits: 'lamp' } });
  const globe = new THREE.Mesh(new THREE.SphereGeometry(.14, 24, 16), glass); globe.position.y = 1.70; globe.scale.y = 1.35; g.add(globe);
  for (let k = 0; k < 6; k++) {
    const a = k * PI / 3;
    g.add(tube([[.075 * Math.sin(a), 1.51, .075 * Math.cos(a)], [.14 * Math.sin(a), 1.63, .14 * Math.cos(a)], [.135 * Math.sin(a), 1.77, .135 * Math.cos(a)], [.065 * Math.sin(a), 1.87, .065 * Math.cos(a)]], .008, white, { seg: 12, radial: 6 }));
  }
  g.add(latheM([[0, 1.87], [.08, 1.87], [.1, 1.90], [.04, 1.94], [.025, 1.98], [0, 2.03]], white, { seg: 24 }));
  g.add(cyl(.017, .017, .2, white, { y: 1.65 }), cyl(.025, .025, .16, white, { x: .1, y: 1.0, rz: PI / 2 }));
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff4d9, emissive: 0xffdf9f, emissiveIntensity: 2.5, roughness: .3, userData: { emits: 'lamp' } });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(.036, 16, 12), bulbMat); bulb.position.y = 1.72; g.add(bulb);
  g.userData.light = { type: 'point', y: 1.72, intensity: 0.6, color: 0xffdf9f, distance: 4 };
  declare(g, { fixture: { kind: 'lantern' } });
  setCollider(g, { w: .16, d: .16, h: 2.03 });
  describe(g, { id: 'outdoor-front-lamp', name: 'White glass carriage lantern', zh: '白色花园灯柱' }); return g;
}

function frontFence() {
  const g = root(), w = 5.9, h = 1.8, mat = lumberPT().clone(); mat.color.set(0x6e4834);
  for (let i = 0; i < 40; i++) g.add(board(.145, h, .025, mat, { axis: 'y', x: -w / 2 + .075 + i * .1475, y: h / 2, off: i * .17 }));
  for (const x of [-2.95, -2.15, -.85, 2.95]) g.add(box(.1, h + .07, .1, mat, { x, y: (h + .07) / 2 }));
  for (const y of [.35, 1.4]) g.add(box(w, .07, .055, mat, { y, z: -.055 }));
  for (const y of [.4, 1.4]) g.add(box(.24, .045, .025, M.blackMatte(), { x: -2.02, y, z: .03 }));
  g.add(box(.025, .15, .04, M.blackMatte(), { x: -.99, y: .9, z: .04 }));
  setCollider(g, { w, d: .14, h }); return g;
}
function frontCondenser() {
  const g = root(), mat = concreteGrey();
  g.add(box(1.04, .06, 1.0, mat, { y: .03 }), box(.94, 1.0, .9, mat, { y: .56, r: .018 }));
  g.add(cyl(.35, .35, .02, powderBlack(), { y: 1.07, seg: 32 }));
  for (let i = 0; i < 21; i++) for (const z of [-.455, .455]) g.add(box(.88, .013, .012, powderBlack(), { y: .19 + i * .039, z }));
  setCollider(g, { w: 1.04, d: 1.0, h: 1.08 }); return g;
}

export const items = { frontFence, frontCondenser, frontPallet, frontRoundPot, frontCube, frontCurb, frontLamp, firePit, wickerChair, wickerOttoman, benchTable, stoolLumber, lounger, umbrella, fencePanel, plantersBench, potWhiteLarge, potWhiteSmall, planterBox, cushionsOutdoor, porchLight };
