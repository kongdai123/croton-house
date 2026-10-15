// Baked foliage light (bake/scripts/foliage_bake.py and foliage_pack.py): the plants have no lightmap, and the probe
// volume samples open air every 0.5 m, so leaves deep in a shrub took the light of the sky outside it. Cycles baked, per
// plant vertex, the mean irradiance over a leaf's two faces with the plant's own (alpha-masked) leaves and its
// neighbours in the way. Here that level replaces the probes' level, and the probes keep only the colour and the
// direction: E(n) = baked * probe(n) / probe mean. The bake's sun visibility caps the live sun's soft shadow, which is
// too coarse for a canopy shading itself. Meshes the sidecar does not cover keep the probes alone.
//
// The sidecar's units are the exported scene's plant meshes, matched to live meshes by their stable id where they have
// one (batch.js), else by material, vertex count and world bounds. The export is the photo-mode copy: a swaying plant
// near its camera came out as its separate moving parts, one farther away as its frozen merged copy (batch.js), and the
// live scene has both. A frozen copy is its sources' geometry back to back, so whichever side matched gives the other
// its slices. Bounds are compared at the rest pose (animate(0)), with a few centimetres of slack for the pose the export
// caught.
import * as THREE from 'three';

// Baked shader edits are transactional: a three chunk changing must never leave half a patch installed.
const warned = new Set();
export function shaderReplace(src, from, to, name, count = 1) {
  const n = typeof from === 'string' ? src.split(from).length - 1 : [...src.matchAll(new RegExp(from.source, from.flags.includes('g') ? from.flags : from.flags + 'g'))].length;
  if (n !== count) throw new Error(`${name}: expected ${count} matches, got ${n}`);
  return typeof from === 'string' ? src.replaceAll(from, to) : src.replace(new RegExp(from.source, from.flags.includes('g') ? from.flags : from.flags + 'g'), to);
}
export function shaderPatch(sh, name, patch) {
  const next = { ...sh, uniforms: { ...sh.uniforms } };
  try { patch(next); Object.assign(sh, next); return true; }
  catch (err) { if (!warned.has(name)) { warned.add(name); console.warn(`baked shader ${name}: left unpatched`, err.message); } return false; }
}
// Freeze before wrapping: three's default key reads this.onBeforeCompile, which would otherwise read the new hook.
export const shaderKey = m => m.customProgramCacheKey();

export async function loadFoliage(url) {
  const res = await fetch(url); if (!res.ok) throw new Error(`foliage ${res.status}: ${url}`);
  let buf = await res.arrayBuffer(); const b = new Uint8Array(buf, 0, 2);
  if (b[0] === 0x1f && b[1] === 0x8b) buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const hl = new DataView(buf).getUint32(0, true), header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl)));
  let o = 4 + hl;
  for (const u of header.units) { u.slot = new Uint8Array(buf, o, u.vc); u.sun = new Uint8Array(buf, o + u.vc, u.vc); o += u.vc * 2; if (u.l) { u.lamps = new Uint8Array(buf, o, u.vc); o += u.vc; } }
  if (o !== buf.byteLength || !['slot', 'lamps'].every(k => Number.isFinite(header.K?.[k]) && header.K[k] > 0)) throw new Error('Invalid foliage sidecar');
  return header;
}

const isPlant = o => o.isMesh && !o.isInstancedMesh && !Array.isArray(o.material) && /^plant/.test(o.material?.name || '') && o.geometry?.attributes.position;
const box = new THREE.Box3(), v = new THREE.Vector3();
function bounds(o) {
  box.makeEmpty(); const p = o.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) box.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld));
  return box.clone();
}
// the closest unit of the same material and vertex count, if its bounds agree within `tol` metres
function find(units, o, tol = 0.08) {
  const list = units.get(o.material.name + '|' + o.geometry.attributes.position.count); if (!list) return null;
  const b = bounds(o); let best = null, bd = tol;
  for (const u of list) {
    const d = Math.max(Math.abs(b.min.x - u.min[0]), Math.abs(b.min.y - u.min[1]), Math.abs(b.min.z - u.min[2]), Math.abs(b.max.x - u.max[0]), Math.abs(b.max.y - u.max[1]), Math.abs(b.max.z - u.max[2]));
    if (d < bd) { bd = d; best = u; }
  }
  return best;
}

const uniforms = { uFolK: { value: new THREE.Vector2(1, 1) }, uFolLamps: { value: 0.25 } };
// probeLit (lightmap.js) calls this last on a covered material: every probe lookup in main() is scaled to the baked
// level (irradiance, specular occlusion, reflection occlusion)
const FOLIAGE = {
  patch(sh, reflections) {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = 'attribute vec3 foliage; varying vec3 vFoliage; uniform vec2 uFolK;\n' + shaderReplace(sh.vertexShader, '#include <begin_vertex>', `#include <begin_vertex>
      { vec2 y2 = foliage.xy * foliage.xy; vFoliage = vec3( uFolK * y2 / max( 1.0 - y2, vec2( 1.0 / 255.0 ) ), foliage.z ); }`, 'foliage vertex');
    const marker = 'void main() {';
    sh.fragmentShader = shaderReplace(sh.fragmentShader, marker, `varying vec3 vFoliage; uniform float uFolLamps;
float foliageScale( vec3 p ) {
  vec3 g = ( p - uProbeOrigin ) * uProbeScale, uvw = ( vec3( g.x, g.z, g.y ) + 0.5 ) / uProbeDims.xzy;
  float mean = 0.886227 * dot( vec3( texture( uProbeR, uvw ).x, texture( uProbeG, uvw ).x, texture( uProbeB, uvw ).x ), vec3( 0.2126, 0.7152, 0.0722 ) );
  return min( PI * ( vFoliage.x + uFolLamps * vFoliage.y ) / max( mean, 1e-5 ), 8.0 );
}
void main() {`, 'foliage main');
    sh.fragmentShader = shaderReplace(sh.fragmentShader, 'probeIrradiance( vProbeWorld, ', 'foliageScale( vProbeWorld ) * probeIrradiance( vProbeWorld, ', 'foliage irradiance', 3);
    if (reflections) sh.fragmentShader = shaderReplace(sh.fragmentShader, 'vec3( 0.2126, 0.7152, 0.0722 ) ) / 0.95 + 0.25,', 'vec3( 0.2126, 0.7152, 0.0722 ) ) / 0.95,', 'foliage reflection', 2);
    sh.fragmentShader = shaderReplace(sh.fragmentShader, 'sunPCSS( vDirectionalShadowCoord[ i ], directionalLightShadow.shadowBias )', 'min( sunPCSS( vDirectionalShadowCoord[ i ], directionalLightShadow.shadowBias ), vFoliage.z )', 'foliage sun');
  },
};

function matchFoliage(scene, header) {
  const units = new Map(); for (const u of header.units) { const k = u.m + '|' + u.vc; if (!units.has(k)) units.set(k, []); units.get(k).push(u); }
  // the rest pose, as the frozen copies hold it
  const frozen = []; scene.traverse(o => { if (o.name === 'frozen' && o.userData.batch) frozen.push(o); });
  for (const f of frozen) { f.parent.userData.animate?.(0); f.parent.updateMatrixWorld(true); }
  const data = new Map();   // mesh -> Uint8Array(vc * 3): slot, lamps, sun
  const set = (o, u) => { const a = new Uint8Array(u.vc * 3); for (let i = 0; i < u.vc; i++) { a[i * 3] = u.slot[i]; a[i * 3 + 1] = u.lamps ? u.lamps[i] : 0; a[i * 3 + 2] = u.sun[i]; } data.set(o, a); };
  // a plant that holds still carries the export's stable id (batch.js); swaying parts and frozen copies go by bounds
  const byId = new Map(header.units.filter(u => u.id).map(u => [u.id, u])); let byIdCount = 0;
  scene.traverse(o => {
    if (!isPlant(o)) return;
    let u = byId.get(o.userData.lmId); if (u?.vc === o.geometry.attributes.position.count) byIdCount++; else u = find(units, o);
    if (u) set(o, u);
  });
  // frozen copies and their sources: whichever side matched fills the other
  for (const f of frozen) {
    const parts = []; f.parent.traverse(o => { if (isPlant(o) && !o.userData.batch) parts.push(o); });
    for (const c of f.children) {
      if (!isPlant(c)) continue;
      const src = c.userData.sources ?? parts.filter(p => p.material === c.material), n = c.geometry.attributes.position.count;
      if (src.reduce((s, p) => s + p.geometry.attributes.position.count, 0) !== n) continue;
      if (data.has(c)) { let o = 0; for (const p of src) { const k = p.geometry.attributes.position.count * 3; if (!data.has(p)) data.set(p, data.get(c).slice(o, o + k)); o += k; } }
      else if (src.every(p => data.has(p))) { const a = new Uint8Array(n * 3); let o = 0; for (const p of src) { a.set(data.get(p), o); o += data.get(p).length; } data.set(c, a); }
    }
  }
  return { data, byIdCount };
}

const decodeFoliage = (a, K) => {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i += 3) {
    for (let c = 0; c < 2; c++) { const y = a[i + c] / 255, y2 = y * y; out[i + c] = K[c ? 'lamps' : 'slot'] * y2 / Math.max(1 - y2, 1 / 255); }
    out[i + 2] = a[i + 2] / 255;
  }
  return out;
};

// Load the sidecar and give every covered plant mesh its baked light (a `foliage` attribute and a material copy that
// probeLit draws with it). `volume` is the probe volume: its lamp level drives the lamps term too.
export async function bakeFoliage(scene, url, volume, staged = undefined) {
  if (new URLSearchParams(location.search).get('foliagebake') === '0') return null;   // ?foliagebake=0: the probes alone
  const t0 = performance.now(), header = staged ?? await loadFoliage(url);
  if (!header) return null;
  uniforms.uFolK.value.set(header.K.slot, header.K.lamps);
  const fill = volume.fill; volume.fill = level => { uniforms.uFolLamps.value = level; fill(level); };
  const { data, byIdCount } = matchFoliage(scene, header);
  const mats = new Map(), originals = new Map(), attributes = new Map(), nextAttributes = new Map(); let vertices = 0;
  for (const [o, a] of data) {
    originals.set(o, o.material);
    if (!attributes.has(o.geometry)) attributes.set(o.geometry, o.geometry.getAttribute('foliage'));
    o.geometry.setAttribute('foliage', new THREE.BufferAttribute(a, 3, true));
    if (volume.multi) {
      if (!nextAttributes.has(o.geometry)) nextAttributes.set(o.geometry, o.geometry.getAttribute('foliageNext'));
      o.geometry.setAttribute('foliageNext', new THREE.BufferAttribute(decodeFoliage(a, header.K), 3));
    }
    const m = o.material;
    if (!mats.has(m)) { const key = shaderKey(m), c = m.clone(); c.onBeforeCompile = m.onBeforeCompile; c.onBeforeRender = m.onBeforeRender; c.customProgramCacheKey = () => key + '|foliage'; c.bakedHooks = m.bakedHooks; c.foliageBake = FOLIAGE; mats.set(m, c); }
    o.material = mats.get(m); vertices += a.length / 3;
  }
  const stats = { units: header.units.length, meshes: data.size, byId: byIdCount, vertices, materials: mats.size, ms: Math.round(performance.now() - t0) };
  Object.defineProperty(stats, 'stage', { value(next) {
    const matched = matchFoliage(scene, next).data, prepared = new Map();
    for (const [o] of data) {
      const a = matched.get(o);
      if (!a || a.length !== o.geometry.getAttribute('foliage').array.length) throw Error('Destination foliage coverage differs');
      prepared.set(o.geometry, { encoded: a, decoded: decodeFoliage(a, next.K) });
    }
    return {
      begin() { for (const [g, a] of prepared) { const attr = g.getAttribute('foliageNext'); attr.array.set(a.decoded); attr.needsUpdate = true; } },
      finish() { uniforms.uFolK.value.set(next.K.slot, next.K.lamps); for (const [g, a] of prepared) { const attr = g.getAttribute('foliage'); attr.array.set(a.encoded); attr.needsUpdate = true; } },
    };
  } });
  Object.defineProperty(stats, 'dispose', { value() {
    volume.fill = fill;
    for (const [o, m] of originals) o.material = m;
    for (const [g, a] of attributes) { g.dispose(); if (a) g.setAttribute('foliage', a); else g.deleteAttribute('foliage'); }
    for (const [g, a] of nextAttributes) { if (a) g.setAttribute('foliageNext', a); else g.deleteAttribute('foliageNext'); }
    for (const m of mats.values()) m.dispose();
  } });
  return stats;
}
