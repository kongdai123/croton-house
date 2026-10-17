import { THREE, box } from '../kit.js';

const glowing = o => o.isMesh && o.material?.emissive?.getHex() && o.material.emissiveIntensity > 0;
const hitMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });

// Plan position + facing, then a fixture id and plan target. Plates reuse fixture toggles so export membership stays physical.
export const WALL_SWITCHES = [
  ['living', 0.62, -4.594, Math.PI, 'decor-track-light', 3, -2.35],
  ['livingCenter', 0.73, -4.594, Math.PI, 'decor-track-light', 0.2, -0.2],
  ['livingNiche', 3.958, 1.12, -Math.PI / 2, 'niche-recessed-can', 0, 0],
  ['kitchenPendant', -0.75, -4.594, Math.PI, 'kitchen-pendant', -1.33, -1.28],
  ['kitchen', -0.86, -4.594, Math.PI, 'decor-track-light', -1.33, -3],
  ['kitchenCabinet', -0.97, -4.594, Math.PI, 'kitchen-west-run-b', -2.933, -3.022],
  ['dining', 3.337, 2.02, -Math.PI / 2, 'dining-pendant', 1.85, 3.5],
  ['family', -2.158, 2.02, Math.PI / 2, 'decor-track-light', -0.9, 3.2],
  ['primary', -3.10, 1.834, Math.PI, 'decor-recessed-light', -4.3, 2.6],
  ['primaryLamps', -3.21, 1.834, Math.PI, 'props-rooms-egg-lamp', -5.55, 2.95],
  ['primaryBath', -6.021, 4.18, -Math.PI / 2, 'decor-recessed-light', -6.95, 4.4],
  ['closet', -4.942, 0.72, -Math.PI / 2, 'decor-recessed-light', -5.59, 0.8755],
  ['bedroomB', 4.096, 1.73, Math.PI / 2, 'decor-recessed-light', 6, 3.6],
  ['bedroomBLamps', 4.096, 1.85, Math.PI / 2, 'nightstandPine', 7.64, 4.51],
  ['bathB', 6.12, 1.825, 0, 'decor-recessed-light', 6.15, 1.12],
  ['hallBath', 5.113, -0.40, Math.PI / 2, 'decor-recessed-light', 6.15, -0.72],
  ['bedroom3', 5.25, -2.154, 0, 'decor-recessed-light', 6, -3.95],
  ['bedroom3Lamps', 5.36, -2.154, 0, 'nightstandPine', 7.64, -2.88],
  ['hall', 4.096, -1.65, Math.PI / 2, 'decor-recessed-light', 4.55, -0.2],
  ['garage', -3.519, -0.45, -Math.PI / 2, 'garage-shopLight', -5.7, -1.6],
  ['porch', 0.62, -4.732, 0, 'decor-wall-light-black', 0.8, -4.912],
];

function wallSwitches(scene, entries) {
  const white = new THREE.MeshStandardMaterial({ color: 0xeeeae2, roughness: 0.45 });
  const p = new THREE.Vector3();
  for (const [name, x, y, ry, id, tx, ty] of WALL_SWITCHES) {
    const entry = entries.find(({ root }) => {
      let fixture = root; while (fixture && !fixture.userData.placement) fixture = fixture.parent;
      root.getWorldPosition(p);
      return (fixture?.userData.id || root.userData.id || root.name) === id && Math.hypot(p.x - tx, -p.z - ty) < 0.06;
    });
    if (!entry) continue;
    const plate = new THREE.Group(); plate.name = 'wall-switch-' + name;
    plate.position.set(x, 1.12, -y); plate.rotation.y = ry;
    plate.userData.lightSwitch = entry.toggle;
    plate.add(box(0.075, 0.12, 0.008, white, { r: 0.004 }));
    const rocker = box(0.032, 0.064, 0.008, white, { z: 0.007, r: 0.002 }); plate.add(rocker);
    rocker.onBeforeRender = () => { rocker.rotation.x = (entry.toggle.value - 0.5) * 0.22; };
    plate.traverse(o => { o.userData.noBatch = o.userData.noHighlight = true; }); scene.add(plate);
  }
}

function switchLight(root, meshes, lights, { name, zh, exterior = false, always = false, day = false } = {}) {
  const materials = new Map(), glows = [];
  for (const mesh of meshes) {
    const original = mesh.material;
    let material = materials.get(original);
    if (!material) {
      material = original.clone(); material.onBeforeCompile = original.onBeforeCompile;
      material.customProgramCacheKey = original.customProgramCacheKey;
      material.userData.lightGlow = true; materials.set(original, material);
      glows.push({ material, base: original.emissiveIntensity ?? original.opacity, wash: !original.emissive });
    }
    mesh.material = material; mesh.userData.noBatch = mesh.userData.noHighlight = true;
    if (always) mesh.onBeforeRender = THREE.Mesh.prototype.onBeforeRender;
  }
  name ??= root.userData.name || root.name; zh ??= root.userData.zh || name;
  const toggle = {
    on: true, value: 1, manual: false, moving: false, dusk: false, glows, lights,
    label: { zh: `开灯 · ${zh}`, en: `Turn on · ${name}` },
    labelOn: { zh: `关灯 · ${zh}`, en: `Turn off · ${name}` },
    set(on) {
      this.manual = true; this.on = !!on; this.from = this.value; this.t = 0; this.moving = true;
      for (const g of glows) g.from = g.material[g.wash ? 'opacity' : 'emissiveIntensity'];
      for (const light of lights) light.userData.switchFrom = light.intensity;
    },
    // Manual state wins until the next actual day/night change, which restores the automatic state immediately.
    onTime(dusk) {
      if (this.initialized && dusk === this.dusk) return;
      this.initialized = true; this.dusk = dusk; this.manual = false;
      this.on = !exterior || dusk; this.value = +this.on; this.moving = false; this.apply();
    },
    apply() {
      const e = this.manual ? this.t * this.t * (3 - 2 * this.t) : 1;
      for (const { material, base, wash, from } of glows) {
        const power = wash ? base : always ? base : this.dusk ? base * 1.8 : day ? base : 0.12;
        material[wash ? 'opacity' : 'emissiveIntensity'] = this.manual ? THREE.MathUtils.lerp(from, power * +this.on, e) : power * this.value;
      }
      for (const light of lights) {
        const base = light.userData.base ?? light.userData.switchBase;
        const factor = always || exterior || light.userData.always ? 1 : this.dusk ? 5 : light.userData.day ?? 0.2;
        if (this.manual) light.intensity = THREE.MathUtils.lerp(light.userData.switchFrom, base * factor * +this.on, e);
        else if (light.userData.base === undefined) light.intensity = base * this.value;
      }
    },
    tick(dt) {
      if (this.moving) {
        this.t = Math.min(1, this.t + dt / 0.25);
        const e = this.t * this.t * (3 - 2 * this.t);
        this.value = this.from + (+this.on - this.from) * e; this.moving = this.t < 1;
      }
      this.apply();
    },
  };
  root.userData.lightSwitch = toggle;
  for (const light of lights) { light.userData.lightSwitch = toggle; light.userData.switchBase = light.intensity; }
  // Invisible originals still raycast after batching; this gives tiny ceiling lenses a forgiving target.
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  for (const mesh of meshes.filter(m => m.material.emissive)) bounds.union(new THREE.Box3().setFromObject(mesh));
  bounds.applyMatrix4(root.matrixWorld.clone().invert());
  const size = bounds.getSize(new THREE.Vector3()).max(new THREE.Vector3(0.14, 0.10, 0.14));
  const proxy = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), hitMaterial);
  proxy.position.copy(bounds.getCenter(new THREE.Vector3())); proxy.visible = false;
  proxy.userData.noBatch = proxy.userData.lightHit = true; root.add(proxy);
  return { root, toggle, meshes, proxy };
}

export function collectLightSwitches(scene, fixtures) {
  const entries = [], candidates = [], assigned = new Set();
  scene.updateMatrixWorld(true);
  scene.traverse(o => {
    if (o.userData.light || o.userData.lightFixture || /^props-rooms-(linen|egg)-lamp$/.test(o.userData.id || '') || o.name === 'niche-recessed-can') candidates.push(o);
  });
  const practicals = fixtures.children.filter(o => o.isLight);
  for (const fixture of candidates) {
    let owner = fixture, lights = [];
    const spec = fixture.userData.light, niche = fixture.name === 'niche-recessed-can';
    if (spec && fixture.userData.placement?.light !== false) {
      const p = new THREE.Vector3(0, spec.y ?? 2.3, 0).applyMatrix4(fixture.matrixWorld);
      lights = practicals.filter(l => !assigned.has(l) && l.position.distanceTo(p) < 0.01);
    }
    if (niche) fixture.traverse(o => { if (o.isLight) lights.push(o); });
    if (fixture.userData.id === 'decor-wall-light-black') lights.push(...practicals.filter(l => l.name === 'Porch sconce source'));
    lights.forEach(l => assigned.add(l));
    const exterior = /porch|wall-light-black|outdoor-front-lamp/.test(fixture.userData.id || '');
    if (fixture.userData.id === 'nightstandPine') owner = fixture.children.find(o => o.userData.bulbY !== undefined);
    if (fixture.userData.id === 'decor-track-light') {
      const heads = fixture.children.filter(o => o.isGroup);
      heads.forEach((head, i) => {
        const meshes = []; head.traverse(o => { if (glowing(o)) meshes.push(o); });
        entries.push(switchLight(head, meshes, i ? [] : lights, { name: `Track light ${i + 1}`, zh: `轨道射灯 ${i + 1}` }));
      });
      continue;
    }
    const meshes = [];
    owner.traverse(o => { if (glowing(o) || o.material?.blending === THREE.AdditiveBlending) meshes.push(o); });
    if (meshes.length) entries.push(switchLight(owner, meshes, lights, {
      name: niche ? 'Alcove recessed can' : owner !== fixture ? 'Rattan bedside lamp' : fixture.userData.lightFixture?.name,
      zh: niche ? '壁龛筒灯' : owner !== fixture ? '藤编床头灯' : fixture.userData.lightFixture?.zh, exterior, day: spec?.day !== undefined,
    }));
  }
  wallSwitches(scene, entries);
  return entries;
}
