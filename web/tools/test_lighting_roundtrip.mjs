// The lighting manifest crosses into the bake intact: every mesh and material record of the real house (headless,
// tools/harness/scene.mjs) goes through the glTF exporter with the export's plugin (lighting_roles.js gltfLightingPlugin,
// as bake/export/export.mjs registers it), and bake/scripts/lighting.py reads the glTF back: same records, same answers to
// the predicates the bake scripts share, same vocabulary.
//   node web/tools/test_lighting_roundtrip.mjs
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRealScene } from './harness/scene.mjs';

const t0 = performance.now(), REPO = fileURLToPath(new URL('../../', import.meta.url));
const w = await buildRealScene(), { T, roles, GLTFExporter } = w;
// the exporter's data URIs (node has no FileReader)
globalThis.FileReader ??= class { readAsDataURL(b) { b.arrayBuffer().then(a => { this.result = 'data:application/octet-stream;base64,' + Buffer.from(a).toString('base64'); this.onloadend?.(); }); } readAsArrayBuffer(b) { b.arrayBuffer().then(a => { this.result = a; this.onloadend?.(); }); } };

// what photo.js buildScene hands the exporter: a plain mesh per visible lit mesh carrying meshRecord, its material (here a
// copy without textures: they never load headless) carrying the source's record
const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'alphaMap', 'aoMap', 'emissiveMap', 'lightMap', 'bumpMap', 'envMap', 'displacementMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'sheenColorMap', 'sheenRoughnessMap', 'specularIntensityMap', 'specularColorMap', 'transmissionMap', 'thicknessMap', 'iridescenceMap', 'iridescenceThicknessMap', 'anisotropyMap'];
const shown = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
const out = new T.Scene(), box = new T.BoxGeometry(), copies = new Map(), meshes = [], materials = [];
w.scene.traverse(o => {
  if (!o.isMesh || !shown(o) || o.isReflector || roles.meshLighting(o).role === 'presentation') return;
  const src = [].concat(o.material)[0]; if (!src || src.isShaderMaterial) return;
  let m = copies.get(src);
  if (!m) { m = new T.MeshStandardMaterial({ name: src.name }); m.userData.lighting = roles.materialRecord(src); copies.set(src, m); materials.push(m); }
  for (const k of MAPS) if (m[k]) m[k] = null;
  const e = new T.Mesh(box, m); e.name = o.userData.lmId || o.name; e.userData.lighting = roles.meshRecord(o); out.add(e); meshes.push(e);
});
const exporter = new GLTFExporter(); exporter.register(roles.gltfLightingPlugin());
const gltf = await exporter.parseAsync(out, { binary: false });
delete gltf.buffers;   // geometry is not under test
const canonical = r => JSON.stringify(sortKeys(r));
function sortKeys(v) { if (Array.isArray(v)) return v.map(sortKeys); if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])); return v; }
const answers = (kind, r) => roles.bakeAnswers(kind, r);
const doc = {
  schema: { meshKeys: roles.MESH_KEYS, materialKeys: roles.MATERIAL_KEYS, roles: roles.ROLES, surfaces: roles.SURFACES, emitKinds: roles.EMIT_KINDS, motions: roles.SCHEMA.mesh.motion, bakes: roles.SCHEMA.mesh.bake },
  gltf,
  expect: {
    mesh: meshes.map(e => ({ record: canonical(e.userData.lighting), answers: answers('mesh', e.userData.lighting) })),
    material: materials.map(m => ({ record: canonical(roles.materialRecord(m)), answers: answers('material', roles.materialRecord(m)) })),
  },
};
const file = join(tmpdir(), `croton-lighting-roundtrip-${process.pid}.json`);
writeFileSync(file, JSON.stringify(doc));
let ok = true;
try { console.log(execFileSync('python3', ['-I', join(REPO, 'bake/scripts/lighting.py'), '--check', file], { encoding: 'utf8' }).trim()); }
catch (e) { ok = false; console.log(String(e.stdout ?? e).trim()); }
finally { rmSync(file, { force: true }); }
console.log(`${ok ? 'lighting round trip OK' : 'FAILED'}: ${meshes.length} mesh and ${materials.length} material records through the glTF exporter and lighting.py (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(ok ? 0 : 1);
