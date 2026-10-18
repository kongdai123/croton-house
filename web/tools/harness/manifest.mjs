// The lighting manifest of the headless scene (web/src/lighting_roles.js), keyed like objects.json: every material's
// resolved record, every mesh's (defaults left out so the file stays small), and the validator's errors.
import { materialKey } from './objects.mjs';

const mats = o => [].concat(o.material ?? []).filter(Boolean);
// mesh fields at their most common value are left out
const MESH_DEFAULT = { role: 'furniture', motion: 'static', bake: 'lightmap', why: null, probeSide: 'none', weather: null, zone: 'interior', space: null, puddleMirror: true };
export function compactMesh(r) {
  const out = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === 'sun') { if (!v.cast) out.sunCast = false; if (v.track !== 'static') out.sunTrack = v.track; continue; }
    if (MESH_DEFAULT[k] !== v) out[k] = v;
  }
  return out;
}

export function captureManifest(w, ix) {
  const { roles } = w;
  const materials = {}, meshes = {}, seen = new Map();
  for (const { key, node: o } of ix.meshes) {
    for (const m of mats(o)) { if (seen.has(m)) continue; const k = materialKey(m); seen.set(m, k); materials[k] ??= roles.materialRecord(m); }
    meshes[key] = compactMesh(roles.meshRecord(o));
  }
  const errors = roles.validateLighting(w.scene);
  return { meta: { note: 'The lighting manifest (web/src/lighting_roles.js) of the headless scene: material records keyed like objects.json materials, mesh records like its meshes (fields at their default left out: ' + JSON.stringify(MESH_DEFAULT) + ', sun { cast: true, track: static }).', errors: errors.length }, errors: errors.slice(0, 200), materials, meshes };
}
