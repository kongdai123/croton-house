import { THREE, box } from '../kit.js';
import { meshId } from '../batch.js';
import { declare, fixtureOf, fixturesIn, glowLevel, lampGroupAt, lightLevel, ownedLights } from '../lighting_roles.js';

// a fixture's lamp surfaces: whatever glows inside it (the switch turns them into switched emitters)
const glowing = o => o.isMesh && o.material?.emissive?.getHex() && o.material.emissiveIntensity > 0;
const hitMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });

// Wall plates: a fixture whose declaration (or placement row) has plate: [x, y, ry] gets one, on its switch nearest the
// placement's origin; the plate reuses that switch's toggle, so pressing it moves the lamp group. Named after the group.
function wallPlate(scene, entry, [x, y, ry], white) {
  const plate = new THREE.Group(); plate.name = 'wall-switch-' + entry.lighting.group;
  plate.position.set(x, 1.12, -y); plate.rotation.y = ry;
  plate.userData.lightSwitch = entry.toggle;
  plate.add(box(0.075, 0.12, 0.008, white, { r: 0.004 }));
  const rocker = box(0.032, 0.064, 0.008, white, { z: 0.007, r: 0.002 }); plate.add(rocker);
  rocker.onBeforeRender = () => { rocker.rotation.x = (entry.toggle.value - 0.5) * 0.22; };
  // the rocker tilts with the switch: lighting manifest motion 'moving' (probe-lit)
  declare(rocker, { motion: 'moving' });
  plate.traverse(o => { o.userData.noBatch = o.userData.noHighlight = true; }); scene.add(plate);
  // the face plate never moves: a lightmap id like every static mesh (batch.js), so the bake lights it
  plate.updateMatrixWorld(true); plate.children[0].userData.lmId = meshId(plate.children[0]);
  return plate;
}

function switchLight(root, meshes, lights, { name, zh, exterior = false, day = false } = {}) {
  const materials = new Map(), glows = [];
  for (const mesh of meshes) {
    const original = mesh.material;
    let material = materials.get(original);
    if (!material) {
      material = original.clone(); material.onBeforeCompile = original.onBeforeCompile;
      material.customProgramCacheKey = original.customProgramCacheKey;
      material.userData.lightGlow = true; declare(material, {}); materials.set(original, material);   // re-resolved as a switched lamp surface
      glows.push({ material, base: original.emissiveIntensity ?? original.opacity, wash: !original.emissive });
    }
    mesh.material = material; mesh.userData.noBatch = mesh.userData.noHighlight = true;
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
      for (const glow of glows) {
        const power = glowLevel(glow, { dusk: this.dusk, day });   // lighting_roles.js: the raster glow rule
        glow.material[glow.wash ? 'opacity' : 'emissiveIntensity'] = this.manual ? THREE.MathUtils.lerp(glow.from, power * +this.on, e) : power * this.value;
      }
      for (const light of lights) {
        const base = light.userData.base ?? light.userData.switchBase;
        const factor = lightLevel(light, { dusk: this.dusk, manual: true });
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

// Every declared fixture (lighting_roles.js fixtureOf) becomes a switch, or one per head for a track: its lamp surfaces
// (any emissive or additive surface inside it), its live lights (the ones it owns: layout.js made them from its light
// spec, lighting.js its extra lights; or the lights inside it), and its lamp group (lampGroupAt: the plan space at its
// lamp surfaces and its circuit; exterior spaces are the porch's). entry.lighting / toggle.lighting carry that record.
export function collectLightSwitches(scene, fixtures) {
  const entries = [], assigned = new Set(), plates = new Map();
  scene.updateMatrixWorld(true);
  const practicals = new Set(fixtures.children.filter(o => o.isLight));
  const centre = meshes => {
    const c = new THREE.Vector3(), b = new THREE.Box3(), v = new THREE.Vector3();
    for (const m of meshes) c.add(b.setFromObject(m).getCenter(v));
    return c.divideScalar(Math.max(1, meshes.length));
  };
  const add = (f, root, meshes, lights, label, required = true) => {
    if (required && !meshes.length) return null;
    const at = meshes.length ? centre(meshes) : root.getWorldPosition(new THREE.Vector3());
    const record = { id: f.id, kind: f.kind, circuit: f.circuit, defaultOn: f.defaultOn, ...lampGroupAt(f, at.x, -at.z) };
    const entry = switchLight(root, meshes, lights, { ...label, exterior: record.exterior, day: f.spec?.day !== undefined });
    entry.lighting = entry.toggle.lighting = record;
    entries.push(entry); return entry;
  };
  for (const node of fixturesIn(scene)) {
    const f = fixtureOf(node);
    const own = f.lights === 'children' ? [] : f.holder ? ownedLights(f.holder) : [];
    const lights = [...own.filter(l => practicals.has(l) && !assigned.has(l))];
    if (f.lights === 'children') node.traverse(o => { if (o.isLight) lights.push(o); });
    lights.forEach(l => assigned.add(l));
    let made;
    if (f.heads) {
      made = node.children.filter(o => o.isGroup).map((head, i) => {
        const meshes = []; head.traverse(o => { if (glowing(o)) meshes.push(o); });
        return add(f, head, meshes, i ? [] : lights, { name: `${f.label.en} ${i + 1}`, zh: `${f.label.zh} ${i + 1}` }, false);
      });
    } else {
      const meshes = [];
      node.traverse(o => { if (glowing(o) || o.material?.blending === THREE.AdditiveBlending) meshes.push(o); });
      made = [add(f, node, meshes, lights, { name: f.label?.en, zh: f.label?.zh })];
    }
    // a placement row's plate serves every switch made under it (the range wall's two hood lamps), a fixture's own its own
    if (f.plate) {
      const owner = f.placed?.userData.placement.lamp?.plate ? f.placed : node;
      if (!plates.has(owner)) plates.set(owner, { plate: f.plate, entries: [] });
      plates.get(owner).entries.push(...made.filter(Boolean));
    }
  }
  // the switch nearest the owner's origin carries the plate
  const white = new THREE.MeshStandardMaterial({ color: 0xeeeae2, roughness: 0.45 }), p = new THREE.Vector3();
  for (const [owner, { plate, entries: made }] of plates) {
    if (!made.length) continue;
    const origin = owner.getWorldPosition(new THREE.Vector3()), d = e => e.root.getWorldPosition(p).distanceTo(origin);
    wallPlate(scene, made.reduce((a, b) => d(b) < d(a) - 1e-9 ? b : a), plate, white);
  }
  return entries;
}
