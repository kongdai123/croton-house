import { THREE } from '../kit.js';

const glowing = o => o.isMesh && o.material?.emissive?.getHex() && o.material.emissiveIntensity > 0;
const hitMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });

function switchLight(root, meshes, lights, { name, zh, exterior = false, always = false } = {}) {
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
        const power = wash ? base : always ? base : this.dusk ? base * 1.8 : 0.12;
        material[wash ? 'opacity' : 'emissiveIntensity'] = this.manual ? THREE.MathUtils.lerp(from, power * +this.on, e) : power * this.value;
      }
      for (const light of lights) {
        const base = light.userData.base ?? light.userData.switchBase;
        const factor = always || exterior || light.userData.always ? 1 : this.dusk ? 5 : 0.2;
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
    if (fixture.userData.id === 'garage-shopLight') {
      const p = fixture.getWorldPosition(new THREE.Vector3());
      lights.push(...practicals.filter(l => l.userData.always && Math.abs(l.position.z - p.z) < 0.3));
    }
    if (fixture.userData.id === 'decor-wall-light-black') lights.push(...practicals.filter(l => l.name === 'Porch sconce source'));
    lights.forEach(l => assigned.add(l));
    const exterior = /porch|wall-light-black/.test(fixture.userData.id || '');
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
      zh: niche ? '壁龛筒灯' : owner !== fixture ? '藤编床头灯' : fixture.userData.lightFixture?.zh, exterior, always: niche,
    }));
  }
  return entries;
}
