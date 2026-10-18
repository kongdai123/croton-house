// Today's answer of every lighting classifier the audit lists (docs/audit/lighting-roles.md), per material, per mesh and per
// placed root. Where the decision is a module-level function it is CALLED from the real source (scene.mjs INTERNALS
// appends an export at bundle time). Where it is an inline expression inside a closure it is RE-IMPLEMENTED here, quoted
// with a file:line, and listed in QUOTED so the README can mark it "to be replaced": the golden then documents today's
// behaviour and a refactor that replaces the expression must reproduce it.
import { r3 } from './util.mjs';
import { materialKey, fixtureExterior } from './objects.mjs';

const mats = o => [].concat(o.material ?? []).filter(Boolean);

// Quoted classifiers: [name, where the original lives, the original expression]
export const QUOTED = [
  ['plant.foliage', 'web/src/lightmap.js:1287 (also :201 PCSS e.plant, :777 stats, contact.js:173, puddles.js:193)', "m.alphaTest > 0 || /^(garden-|plant)/.test(m.name || '')"],
  ['plant.leafSide', 'web/src/lightmap.js:1286', "/^garden-/.test(m.name || '')"],
  ['plant.wetEligible', 'web/src/lightmap.js:1289 (volume.wet > 0 assumed)', "!/^garden-/.test(m.name || '') && !(m.alphaTest > 0)"],
  ['plant.unwrapSkip', 'bake/scripts/unwrap.py:73-78 material_skip (alphaMode MASK = alphaTest > 0; glTF transmission = glass.unwrap)', "alphaTest > 0 || name.startswith('garden-') || name.startswith('plant') || glass.unwrap"],
  ['glass.shadow', 'web/src/lightmap.js:733 (duplicated web/src/webgpu/materials.js:62), first material only', 'm.transmission > 0 || m.userData?.daylightOpacity !== undefined || (m.transparent && m.opacity < 0.6)'],
  ['glass.windowOverlay', 'web/src/lightmap.js:1350 addWindowReflections, any material', 'm.userData?.daylightOpacity !== undefined || m.transmission > 0'],
  ['glass.stats', 'web/src/lightmap.js:777 "why unlit", first material only', 'm.transmission > 0 || m.transparent'],
  ['glass.unwrap', 'web/src/photo.js:141-149 traceMaterial + bake/scripts/unwrap.py:77 (KHR_materials_transmission)', '!isShaderMaterial && (userData.sheer || userData.daylightOpacity !== undefined || transmission > 0)'],
  ['glass.cycles', 'bake/export/setup.py:42 (Transmission Weight > 0.5 and no sheer key; glass exported by photo.js:149 has transmission 1)', '(daylightOpacity !== undefined || transmission > 0.5) && !sheer'],
  ['mirror.layout', 'web/src/layout.js:466 addMirrors (same test as lightmap.js:1143 isMirror, which is called for mirror.lightmap)', "mat?.name === 'mirror'"],
  ['mesh.sided', 'web/src/lightmap.js applyLightmaps sided (manifest probeSide face)', '!m.lightMap && !m.transparent && !(m.transmission > 0), per MATERIAL over every mesh whose record says probeSide face'],
  ['mesh.interior', 'web/src/lighting.js collectMaterials region (plan.isInside)', 'plan.isInside(cx, -cz) && cy < ceiling + 0.05 && bboxX < 17 && bboxZ < 13 (exteriorFinish materials forced exterior)'],
  ['mesh.isPlantRoot', 'web/src/lightmap.js:193', "any ancestor userData.id matches /^(plants|garden|flowers)-/"],
  ['mesh.contactExcluded', 'web/src/contact.js:171-173 depthOf', 'm.transparent || m.transmission > 0 || m.isShaderMaterial || m.alphaTest > 0 || /^(garden-|plant)/.test(m.name) (first of the mesh materials that triggers)'],
  ['mesh.puddleTier', 'web/src/puddles.js:193 (indoors() is called from the real module)', 'instanced || any material foliage ? 1 : indoors(box) ? 2 : 0'],
  ['mesh.lit', 'web/src/lightmap.js applyLightmaps stats ladder, minus the sidecar-dependent branches (sharedUV, skipped[id], unmatched)', "manifest why ('plant/glass' split by the first material's foliage) ?? (!lmId ? 'dynamic' : 'lightmap')"],
  ['mesh.unwrapGroundFar', 'bake/scripts/unwrap.py:118', 'area > 300 || abs(cx) > 14 || -cz > 18 || -cz < -14, centroid = mean of world vertices, glTF frame (x, y, z) = scene frame'],
  ['mesh.unwrapSkip', 'bake/scripts/unwrap.py:73-78 over all materials', 'every material plant.unwrapSkip'],
  ['mesh.batchable', 'web/src/batch.js:49 lmMesh / :68 mergeable', 'isMesh && !instanced && !skinned && position'],
  ['placed.exterior', 'web/src/furniture/light_switch.js:138 (duplicated bake/export/switch_groups.mjs:40)', '/porch|wall-light-black|outdoor-front-lamp/.test(fixture.userData.id)'],
  ['placed.isPlantRoot', 'web/src/lightmap.js:193', "/^(plants|garden|flowers)-/ on the id of the root or an ancestor"],
];
// Called from the real source (see scene.mjs INTERNALS): lightmap.js weatherClass / isMirror, plan.js isInside, photo.js presentation /
// weatherClass, foliage_bake.js isPlant, puddles.js wetMaterial / indoors, light_switch.js glowing,
// materials.js emitsLight, pets/roam.js areaOf / isIndoor, plan.js roomName, lighting.indoorWeight.
export const CALLED = ['emitsLight', 'roles.lightingOf (mirror, probe, occl)', 'roles.meshLighting (weather, doorPart, pcssPlant)', 'plan.isInside', 'photoPresentation', 'photoWeatherClass', 'foliageIsPlant',
  'puddlesWetMaterial', 'puddlesIndoors', 'switchGlowing', 'areaOf', 'isIndoor', 'plan.roomName', 'lighting.indoorWeight'];

const FOLIAGE = m => m.alphaTest > 0 || /^(garden-|plant)/.test(m.name || '');
const LEAF = m => /^garden-/.test(m.name || '');
const GLASS_UNWRAP = m => !m.isShaderMaterial && (!!m.userData?.sheer || m.userData?.daylightOpacity !== undefined || m.transmission > 0);
const GLASS_CYCLES = m => (m.userData?.daylightOpacity !== undefined || m.transmission > 0.5) && !m.userData?.sheer;
const UNWRAP_SKIP = m => m.alphaTest > 0 || (m.name || '').startsWith('garden-') || (m.name || '').startsWith('plant') || GLASS_UNWRAP(m);
const prune = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== false && v !== null && v !== undefined));

export function materialClassify(w, m, fakeMesh) {
  const L = w.roles.lightingOf;
  return prune({
    foliage: FOLIAGE(m), leafSide: LEAF(m), wetEligible: !LEAF(m) && !(m.alphaTest > 0), wetPuddles: !!w.puddlesWetMaterial(m), unwrapSkip: UNWRAP_SKIP(m),
    glassShadow: !!(m.transmission > 0 || m.userData?.daylightOpacity !== undefined || (m.transparent && m.opacity < 0.6)),
    glassOverlay: m.userData?.daylightOpacity !== undefined || m.transmission > 0, glassStats: !!(m.transmission > 0 || m.transparent), glassUnwrap: GLASS_UNWRAP(m), glassCycles: GLASS_CYCLES(m),
    emitsLight: w.emitsLight(m), emitsKind: m.userData?.emits, glowing: !!w.switchGlowing(fakeMesh(m)), mirror: L(m).reflection === 'mirror', mirrorLayout: m?.name === 'mirror',
    sheer: !!m.userData?.sheer, occl: !!L(m).foliage?.groundOcclusion && !m.foliageBake,
    // what probeLit(material) puts in the shader (lightmap.js, from the manifest record), without `sided` (mesh level)
    probe: m.isMeshStandardMaterial ? [L(m).twoSided === 'faceDirection' ? 'leafSide' : '', L(m).foliage ? 'foliage' : '', L(m).wet === 'auto' ? 'wet' : '', L(m).sheer ? 'sheer' : '', L(m).reflection === 'mirror' ? 'mirror' : ''].filter(Boolean).join(',') || undefined : undefined,
  });
}

export function captureClassify(w, ix) {
  const { T, scene, layout, house } = w;
  const fake = m => ({ isMesh: true, material: m });
  // the set `sided` is built from (lightmap.js applyLightmaps)
  const R = w.roles.meshLighting, sided = new Set();
  scene.traverse(o => { if (o.isMesh && R(o).probeSide === 'face') for (const m of mats(o)) if (!m.lightMap && !m.transparent && !(m.transmission > 0)) sided.add(m); });
  const isPlantRoot = o => { for (let p = o; p; p = p.parent) if (/^(plants|garden|flowers)-/.test(p.userData.id || '')) return true; return false; };

  const materials = {}, seen = new Map();
  const matKey = m => { let k = seen.get(m); if (!k) { k = materialKey(m); seen.set(m, k); materials[k] ??= materialClassify(w, m, fake); } return k; };

  const box = new T.Box3(), c = new T.Vector3(), a = new T.Vector3(), b = new T.Vector3(), d = new T.Vector3();
  const meshes = {};
  for (const { key, node: o } of ix.meshes) {
    const ms = mats(o); ms.forEach(matKey);
    box.makeEmpty(); box.expandByObject(o, true); const empty = box.isEmpty();
    const first = ms[0] ?? {};
    const foliage = ms.some(FOLIAGE);
    const o2 = {};
    if (!empty) {
      o2.weather = R(o).weather;
      // photo.js weatherClass reads the mesh's geometry box through its world matrix
      o2.weatherPhoto = w.photoWeatherClass(o, first);
      box.getCenter(c);
      o2.insidePlan = w.plan.isInside(c.x, -c.z);
      // lighting.js:285 uses the GEOMETRY box transformed by matrixWorld; for the unrotated common case this equals the tight box
      o.geometry.computeBoundingBox(); const gb = new T.Box3().copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld), gc = gb.getCenter(new T.Vector3());
      const inside = (x, y) => w.plan.isInside(x, y);   // lighting.js collectMaterials
      const exteriorFinish = ms.some(m => m.userData?.exteriorFinish);
      o2.interior = !exteriorFinish && inside(gc.x, -gc.z) && gc.y < house.ceiling + 0.05 && gb.max.x - gb.min.x < 17 && gb.max.z - gb.min.z < 13;
      o2.puddleTier = o.isInstancedMesh || foliage ? 1 : w.puddlesIndoors(box) ? 2 : 0;
    }
    o2.presentation = !!w.photoPresentation(o);
    o2.bakedFoliagePlant = !!w.foliageIsPlant(o);
    o2.sided = ms.some(m => sided.has(m));
    o2.doorPart = R(o).why === 'door';
    o2.plantRoot = isPlantRoot(o);
    o2.pcssPlant = R(o).sun.track === 'plant';
    o2.emits = ms.some(m => w.emitsLight(m));
    o2.glowing = !!w.switchGlowing(o);
    o2.mirrorFace = ms.some(m => m?.name === 'mirror');
    o2.batchable = !!(o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && o.geometry?.attributes.position);
    o2.unwrapSkip = ms.length > 0 && ms.every(UNWRAP_SKIP);
    // unwrap.py:118 ground/far
    if (o2.batchable) {
      const pos = o.geometry.attributes.position, idx = o.geometry.index, e = o.matrixWorld.elements; let sx = 0, sy = 0, sz = 0, area = 0;
      const n = pos.count, W = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); const wx = e[0] * x + e[4] * y + e[8] * z + e[12], wy = e[1] * x + e[5] * y + e[9] * z + e[13], wz = e[2] * x + e[6] * y + e[10] * z + e[14]; W[3 * i] = wx; W[3 * i + 1] = wy; W[3 * i + 2] = wz; sx += wx; sy += wy; sz += wz; }
      const tri = idx ? idx.count / 3 : n / 3;
      for (let t = 0; t < tri; t++) {
        const i0 = idx ? idx.getX(3 * t) : 3 * t, i1 = idx ? idx.getX(3 * t + 1) : 3 * t + 1, i2 = idx ? idx.getX(3 * t + 2) : 3 * t + 2;
        a.set(W[3 * i1] - W[3 * i0], W[3 * i1 + 1] - W[3 * i0 + 1], W[3 * i1 + 2] - W[3 * i0 + 2]); b.set(W[3 * i2] - W[3 * i0], W[3 * i2 + 1] - W[3 * i0 + 1], W[3 * i2 + 2] - W[3 * i0 + 2]);
        area += 0.5 * d.crossVectors(a, b).length();
      }
      const cx = sx / n, cz = sz / n;
      o2.groundFar = area > 300 || Math.abs(cx) > 14 || -cz > 18 || -cz < -14;
    }
    // lightmap.js:773-778, without the sidecar branches
    const why = R(o).why;
    o2.lit = why === 'plant/glass' ? (first.userData && w.roles.lightingOf(first).foliage ? 'plant' : 'glass') : why ?? (!o.userData.lmId ? 'dynamic' : 'lightmap');
    // contact.js:171-173
    const m0 = ms.find(m => m.transparent || m.transmission > 0 || m.isShaderMaterial || m.alphaTest > 0 || /^(garden-|plant)/.test(m.name || ''));
    o2.contactExcluded = !!m0;
    meshes[key] = prune(o2);
  }

  const placed = {};
  const wp = new T.Vector3();
  for (const { key, node: o } of ix.placed) {
    o.getWorldPosition(wp);
    placed[key] = prune({ area: w.areaOf(wp.x, wp.z), room: w.plan.roomName(wp.x, -wp.z).en, roomOutside: w.plan.roomName(wp.x, -wp.z).outside, isIndoor: w.isIndoor(wp.x, wp.z),
      indoorWeight: r3(w.lighting.indoorWeight(wp.clone().setY(1.0))), exterior: o.userData.light || o.userData.lightFixture ? fixtureExterior(o.userData.id) : false, plantRoot: isPlantRoot(o),
      mirror: o.children.some(ch => ch.isReflector) });
  }
  return { meta: { note: 'Today\'s classifier answers. materials.* is keyed like objects.json materials; meshes.* and placed.* like its meshes / placed. Quoted (not callable) classifiers are listed in README.md.', quoted: QUOTED.map(q => q[0]), called: CALLED }, materials, meshes, placed };
}
