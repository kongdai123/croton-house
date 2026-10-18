// The lighting manifest: how every object and material is lit, declared where it is made and resolved once here.
//
// Declarations live in userData.lighting (objects: the mesh or any ancestor; materials: the material itself). Most
// placements declare only a role ({ role: 'plant' }) and most materials nothing (an opaque surface); presets fill the
// rest. classifyLighting(root) resolves every mesh and material below root into a full record in the same
// userData.lighting, validateLighting(root) lists what is undeclared or contradictory, and every consumer (batching,
// baked and probe lighting, the bake export, unwrap, the Cycles scene, the tracer, puddles, contact shadows, lamp
// groups) reads these records instead of deciding from names, ids or coordinates. bake/scripts/lighting.py reads the
// same records from the GLB's extras (exportLighting writes them).
//
// Records (all fields always present once resolved; `resolved: 1` marks a resolved record):
//   material: { surface, alphaCutout, twoSided, foliage, wet, weather, glass, sheer, emits, reflection, clearcoat,
//               castsSun, bake, contact, zone }
//   mesh:     { role, motion, bake, why, probeSide, sun: { cast, track }, weather, zone, space, puddleMirror }
// See SCHEMA below for every field's values and meaning.
import { isInside, spaceAt, levels } from './plan.js';

// ---- vocabulary -----------------------------------------------------------------------------------------------------
export const SCHEMA = {
  material: {
    surface: ['opaque', 'foliage', 'leafCard', 'glass', 'sheer', 'mirror', 'lamp', 'screen', 'indicator', 'fire', 'presentation'],
    alphaCutout: 'alpha-tested cut-out (alphaTest > 0): a property of the texture, not of being a plant',
    twoSided: [false, 'faceDirection'],            // leaf cards: the normal follows the face seen
    foliage: 'null, or { groundOcclusion, bakedPerVertex }: the plant treatment (probe occlusion near the ground, per-vertex foliage bake)',
    wet: ['auto', 'dry'],                          // auto: per-pixel wet ground / puddles where the mask says (outdoors, low, facing up)
    weather: ['auto', 'plant'],                    // the after-rain class of meshes using it: plant forces the leaf rule
    glass: 'null, or { overlay, export }: overlay = Fresnel sky overlay of window panes; export = pane (clear transmissive glass for the bake) or keep',
    sheer: 'null, or { reflect, transmit } (decor.js voile, cellular shades)',
    emits: "null, or { kind: 'lamp' | 'screen' | 'indicator' | 'fire', switched }: a real light source",
    reflection: ['probe', 'mirror'],
    clearcoat: [null, 'probe'],                    // the clear-coat layer reflects the room's probe (the tracer strips it)
    castsSun: 'blocks the live sun (glass does not)',
    bake: ['lightmap', 'probe'],                   // probe: meshes whose every material says so get no lightmap unit
    contact: 'enters the contact-shadow depth pass',
    zone: [null, 'exterior'],                      // exterior: the street faces of the shell, always the exterior copy
  },
  mesh: {
    role: ['architecture', 'furniture', 'plant', 'ground', 'glass', 'cloth', 'mirror', 'emitter', 'fixture', 'door', 'movable', 'pet', 'presentation'],
    motion: ['static', 'still', 'moving', 'movable', 'door'],   // still: holds still inside a moving root; door: a door's leaf
    bake: ['lightmap', 'probe', 'none'],           // none: never lit by the bake (presentation helpers)
    why: [null, 'instanced', 'movable', 'dynamic', 'plant/glass', 'door', 'presentation', 'hidden'],   // unwrap.py adds ground/far (the plan's lightmap volume)
    probeSide: ['none', 'face'],                   // face: lit from the side it looks at (doors, blinds, curtains)
    sun: "{ cast, track: 'static' | 'plant' }: casts the live sun; plants are never promoted to the moving casters",
    weather: [null, 'ground', 'plant', 'outdoor'],
    zone: ['interior', 'exterior'],
    space: 'plan space id (plan.js spaceAt) or null',
    puddleMirror: 'appears in the planar puddle reflection',
  },
};
export const ROLES = SCHEMA.mesh.role;
export const SURFACES = SCHEMA.material.surface;
export const EMIT_KINDS = ['lamp', 'screen', 'indicator', 'fire'];

// Presets: what a role or surface implies unless declared otherwise.
export const ROLE_PRESETS = {
  architecture: {}, furniture: {}, ground: {}, glass: {}, cloth: {}, mirror: {}, emitter: {}, fixture: {}, pet: {},
  plant: { sunTrack: 'plant' },
  door: { probeSide: 'face' },
  movable: { motion: 'movable' },
  presentation: { bake: 'none' },
};
export const SURFACE_PRESETS = {
  opaque: {},
  foliage: { foliage: { groundOcclusion: true, bakedPerVertex: true }, bake: 'probe', contact: false },
  leafCard: { foliage: { groundOcclusion: true, bakedPerVertex: false }, twoSided: 'faceDirection', wet: 'dry', weather: 'plant', bake: 'probe', contact: false },
  glass: { castsSun: false, contact: false },
  sheer: { bake: 'probe', contact: false },
  mirror: { reflection: 'mirror' },
  lamp: {}, screen: {}, indicator: {}, fire: {},
  presentation: { contact: false },
};

// ---- declaring -------------------------------------------------------------------------------------------------------
// declare(target, { role: 'plant' }) / declare(material, { surface: 'leafCard' }): merges into userData.lighting and drops
// a resolved record (it is resolved again from the declarations).
export function declare(target, decl) {
  const prev = target.userData.lighting, own = prev?.resolved ? prev.declared ?? {} : prev ?? {};
  target.userData.lighting = { ...own, ...decl };
  return target;
}
const declared = t => { const l = t?.userData?.lighting; return l ? (l.resolved ? l.declared ?? {} : l) : {}; };

// ---- legacy inference --------------------------------------------------------------------------------------------------
// Today's rules for what is not declared yet. Each entry moves to a declaration where the thing is made, and is deleted
// here when it does (docs/architecture-lighting.md step 3).
const LEGACY = {
  surfaceByName(m) {
    const n = m.name || '';
    if (/^garden-/.test(n)) return 'leafCard';
    if (/^plant/.test(n)) return 'foliage';
    if (n === 'mirror') return 'mirror';
    return null;
  },
  presentationName: o => /^(cat-blob|dog-contact-shadow)$/.test(o.name || ''),
  plantRoot: o => /^(plants|garden|flowers)-/.test(o.userData.id || ''),
  noPuddleMirror: o => /^garden-turf/.test(o.name || ''),
};

// ---- materials ---------------------------------------------------------------------------------------------------------
const glassLike = m => m.transmission > 0 || m.userData?.daylightOpacity !== undefined || (!!m.transparent && m.opacity < 0.6);
const presentationLike = m => !!m.userData?.presentation || m.blending === 2 /* AdditiveBlending */ ||
  (!!m.isMeshBasicMaterial && !!m.transparent && !m.depthWrite && !!m.polygonOffset && m.color?.getHex?.() === 0);

export function resolveMaterial(m) {
  if (!m) return null;
  const cur = m.userData.lighting;
  if (cur?.resolved) return cur;
  const d = declared(m), u = m.userData;
  const emits = d.emits !== undefined ? d.emits : u.emits ? { kind: u.emits, switched: !!u.lightGlow } : u.lightGlow ? { kind: 'lamp', switched: true } : null;
  let surface = d.surface ?? LEGACY.surfaceByName(m);
  if (!surface) surface = u.sheer ? 'sheer' : presentationLike(m) ? 'presentation' : glassLike(m) ? 'glass' : emits ? emits.kind : 'opaque';
  const alphaCutout = m.alphaTest > 0, preset = SURFACE_PRESETS[surface] ?? {};
  const pick = (k, dflt) => d[k] !== undefined ? d[k] : preset[k] !== undefined ? preset[k] : dflt;
  // an alpha-tested card is treated as foliage, whatever it shows (today's rule)
  let foliage = pick('foliage', null);
  if (!foliage && alphaCutout) foliage = { groundOcclusion: true, bakedPerVertex: false };
  const glass = surface === 'glass' ? { overlay: u.daylightOpacity !== undefined || m.transmission > 0, export: u.daylightOpacity !== undefined ? 'pane' : 'keep', ...(d.glass ?? {}) } : null;
  const sheer = u.sheer ?? d.sheer ?? null;
  // what unwrap.py leaves out of the atlas (plant, glass): alpha masks, plants, and what the export turns into transmission
  const unwrapGlass = !m.isShaderMaterial && (!!sheer || u.daylightOpacity !== undefined || m.transmission > 0);
  const r = {
    surface, alphaCutout,
    twoSided: pick('twoSided', false),
    foliage,
    wet: d.wet ?? (preset.wet === 'dry' || alphaCutout ? 'dry' : 'auto'),
    weather: d.weather ?? (preset.weather === 'plant' || alphaCutout ? 'plant' : 'auto'),
    glass, sheer, emits,
    reflection: pick('reflection', 'probe'),
    clearcoat: m.clearcoat > 0 ? 'probe' : null,
    castsSun: d.castsSun ?? !glassLike(m),
    bake: d.bake ?? (alphaCutout || preset.bake === 'probe' && surface !== 'sheer' || unwrapGlass ? 'probe' : 'lightmap'),
    contact: d.contact ?? !(foliage || m.transparent || m.transmission > 0 || m.isShaderMaterial),
    zone: d.zone ?? (u.exteriorFinish ? 'exterior' : null),
  };
  m.userData.lighting = Object.assign({ resolved: 1, declared: d }, r);
  return m.userData.lighting;
}
// The resolved record of a material (resolving it on first use: pets, the visitor and helpers made after classify).
export const lightingOf = m => m ? (m.userData.lighting?.resolved ? m.userData.lighting : resolveMaterial(m)) : null;

// ---- meshes ------------------------------------------------------------------------------------------------------------
const mats = o => [].concat(o.material ?? []).filter(Boolean);
const lmMesh = o => o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && !!o.geometry?.attributes.position;
// the nearest ancestor (or self) whose declaration has `key`
function inherited(o, key) { for (let p = o; p; p = p.parent) { const d = declared(p); if (d[key] !== undefined) return { node: p, value: d[key] }; } return null; }
const movingRoot = p => !!(p.userData.animate || p.userData.toggle);

// Today's weather rule (lightmap.js): by the mesh's tight world box and its first material.
export function weatherOf(box, m) {
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  if (isInside(cx, -cz) || box.max.x - box.min.x > 40 || box.max.z - box.min.z > 40) return null;
  if (lightingOf(m)?.weather === 'plant') return 'plant';
  return box.max.y < 0.35 ? 'ground' : 'outdoor';
}

// Merged copies (batch.js: static cells, a moving root's frozen far copy) stand for their members: they take the first
// member's record and recompute what depends on where their geometry is.
const MEMBERS = new WeakMap();
export function inheritLighting(merged, member) { MEMBERS.set(merged, member); }

// One mesh's record. ctx: { box3, still: Set of still meshes of moving roots, ceiling }.
function resolveMesh(o, ctx) {
  const member = MEMBERS.get(o);
  if (member) {
    const from = member.userData.lighting?.resolved ? member.userData.lighting : resolveMesh(member, ctx), own = placeOf(o, ctx);
    const plant = from.role === 'plant' || mats(o).some(m => lightingOf(m).foliage);
    return { ...from, ...own, sun: { cast: from.sun.cast, track: plant ? 'plant' : 'static' } };
  }
  const ms = mats(o), m0 = ms[0];
  const roleDecl = inherited(o, 'role');
  let role = roleDecl?.value ?? null, door = null, moving = null, movable = null, presentation = false, hidden = false;
  for (let p = o; p; p = p.parent) {
    if (!p.visible) hidden = true;
    if (p.userData.presentation || p.userData.reflection) presentation = true;
    if (!door && p.userData.door) door = p;
    if (!moving && movingRoot(p)) moving = p;
    if (!movable && p.userData.movable) movable = p;
    if (!role && LEGACY.plantRoot(p)) role = 'plant';
  }
  if (o.isReflector || LEGACY.presentationName(o) || ms.some(m => lightingOf(m).surface === 'presentation')) presentation = true;
  if (presentation) role = 'presentation';
  else if (!role || role === 'furniture' || role === 'architecture') {
    if (door) role = 'door';
    else if (movable) role = 'movable';
  }
  role ??= 'furniture';
  // motion: a carried root, a moving root's parts (still ones keep their place), a door's leaves, else static
  let motion = 'static';
  if (moving) motion = moving.userData.movable ? 'moving' : ctx.still.has(o) ? 'still' : 'moving';
  else if (movable) motion = 'movable';
  else if (door) motion = o.parent === door ? 'still' : 'door';
  // bake: the lightmap for what holds still; the probe volume for the rest, with the reason unwrap.py and the site report
  const leaves = door?.userData.door.kind === 'french' || door?.userData.door.kind === 'slider' ? 'lightmap' : 'probe';
  let why = null;
  if (presentation) why = 'presentation';
  else if (!lmMesh(o)) why = 'instanced';
  else if (motion === 'movable') why = 'movable';
  else if (motion === 'moving') why = 'dynamic';
  else if (motion === 'door' && leaves === 'probe') why = 'door';
  else if (ms.length && ms.every(m => lightingOf(m).bake === 'probe')) why = 'plant/glass';
  const bake = presentation ? 'none' : why ? 'probe' : 'lightmap';
  // dynamic roots (doors, toggled moving roots) are lit from the side each face looks at
  let probeSide = 'none';
  for (let p = o; p; p = p.parent) if (p.userData.door || (p.userData.animate && p.userData.toggle)) { probeSide = 'face'; break; }
  const plant = role === 'plant' || ms.some(m => lightingOf(m).foliage);
  const own = declared(o);
  return { resolved: 1, declared: own, role, motion, bake, why: hidden && !why ? 'hidden' : why, probeSide,
    sun: { cast: m0 ? lightingOf(m0).castsSun : true, track: plant ? 'plant' : 'static' },
    ...placeOf(o, ctx), puddleMirror: own.puddleMirror ?? !LEGACY.noPuddleMirror(o) };
}
// What follows from where the mesh is: its after-rain class (tight world box, lightmap.js), its zone (the interior /
// exterior material split of lighting.js: the geometry box's centre inside the house, under the ceiling, not a site-wide
// plane) and its plan space.
function placeOf(o, ctx) {
  const box = ctx.box3?.(o), m0 = mats(o)[0];
  if (!box) return { weather: null, zone: 'exterior', space: null };
  const g = box.geometry, cx = (g.min.x + g.max.x) / 2, cy = (g.min.y + g.max.y) / 2, cz = (g.min.z + g.max.z) / 2;
  return {
    weather: m0 ? weatherOf(box.tight, m0) : null,
    zone: isInside(cx, -cz) && cy < ctx.ceiling + 0.05 && g.max.x - g.min.x < 17 && g.max.z - g.min.z < 13 ? 'interior' : 'exterior',
    space: spaceAt(cx, -cz, 0.3)?.id ?? null,
  };
}

// ---- classify ----------------------------------------------------------------------------------------------------------
// Resolve every material and mesh below root. Idempotent: resolved records are kept (pass `force` to redo meshes, as
// after batching moved meshes into merged copies). Needs world matrices; poses moving roots once to find their still
// parts (batch.js stillParts).
export function classifyLighting(root, { stillParts = null, force = false } = {}) {
  root.updateMatrixWorld(true);
  const still = new Set();
  if (stillParts) root.traverse(o => { if (movingRoot(o) && !o.userData.movable) for (const m of stillParts(o)) still.add(m); });
  const box = new Box();
  const ctx = { still, ceiling: levels.ceiling, box3: o => box.of(o) };
  let meshes = 0;
  root.traverse(o => {
    if (!o.isMesh) return;
    for (const m of mats(o)) resolveMaterial(m);
    if (!force && o.userData.lighting?.resolved) return;
    o.userData.lighting = resolveMesh(o, ctx); meshes++;
  });
  return { meshes };
}
// tight (from vertices) and geometry-box (lighting.js) world boxes, without THREE: plain min/max objects
class Box {
  of(o) {
    const g = o.geometry, p = g?.attributes?.position; if (!p || !p.count) return null;
    const e = o.matrixWorld.elements, t = { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } };
    const add = (b, x, y, z) => { if (x < b.min.x) b.min.x = x; if (y < b.min.y) b.min.y = y; if (z < b.min.z) b.min.z = z; if (x > b.max.x) b.max.x = x; if (y > b.max.y) b.max.y = y; if (z > b.max.z) b.max.z = z; };
    const w = (x, y, z, b) => add(b, e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
    if (o.isInstancedMesh) {
      // instanced: the world box of every instance's local bounds
      if (!g.boundingBox) g.computeBoundingBox();
      const lb = g.boundingBox, im = o.instanceMatrix.array, n = o.count;
      for (let i = 0; i < n; i++) {
        const f = im.subarray(i * 16, i * 16 + 16);
        for (const x of [lb.min.x, lb.max.x]) for (const y of [lb.min.y, lb.max.y]) for (const z of [lb.min.z, lb.max.z]) {
          const ix = f[0] * x + f[4] * y + f[8] * z + f[12], iy = f[1] * x + f[5] * y + f[9] * z + f[13], iz = f[2] * x + f[6] * y + f[10] * z + f[14];
          w(ix, iy, iz, t);
        }
      }
      const gb = { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } };
      for (const x of [lb.min.x, lb.max.x]) for (const y of [lb.min.y, lb.max.y]) for (const z of [lb.min.z, lb.max.z]) w(x, y, z, gb);
      return { tight: t, geometry: gb };
    }
    for (let i = 0; i < p.count; i++) w(p.getX(i), p.getY(i), p.getZ(i), t);
    if (!g.boundingBox) g.computeBoundingBox();
    const lb = g.boundingBox, gb = { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } };
    for (const x of [lb.min.x, lb.max.x]) for (const y of [lb.min.y, lb.max.y]) for (const z of [lb.min.z, lb.max.z]) w(x, y, z, gb);
    return { tight: t, geometry: gb };
  }
}
// The record of a mesh (classified, or resolved on the spot for meshes made after classify: pets, mirror proxies).
export function meshLighting(o) {
  const l = o?.userData?.lighting;
  if (l?.resolved && l.role) return l;
  return resolveMesh(o, { still: new Set(), ceiling: levels.ceiling, box3: o2 => new Box().of(o2) });
}

// ---- validate ----------------------------------------------------------------------------------------------------------
// Every visible mesh resolved with a known role; declarations that contradict themselves or the material are errors.
export function validateLighting(root) {
  const errors = [];
  const visible = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  const name = o => { const parts = []; for (let p = o; p && parts.length < 4; p = p.parent) parts.unshift(p.userData.id || p.name || p.type); return parts.join('/'); };
  root.traverse(o => {
    const d = declared(o);
    if (d.role !== undefined && !ROLES.includes(d.role)) errors.push(`${name(o)}: unknown role ${d.role}`);
    if (!o.isMesh || !visible(o)) return;
    const l = o.userData.lighting;
    if (!l?.resolved) { errors.push(`${name(o)}: not classified`); return; }
    if (!ROLES.includes(l.role)) errors.push(`${name(o)}: unknown role ${l.role}`);
    for (const m of mats(o)) {
      const ml = m.userData.lighting, md = declared(m);
      if (!ml?.resolved) { errors.push(`${name(o)} [${m.name || m.type}]: material not classified`); continue; }
      if (!SURFACES.includes(ml.surface)) errors.push(`${name(o)} [${m.name || m.type}]: unknown surface ${ml.surface}`);
      if (md.alphaCutout !== undefined && md.alphaCutout !== m.alphaTest > 0) errors.push(`${name(o)} [${m.name || m.type}]: alphaCutout declared ${md.alphaCutout} but alphaTest ${m.alphaTest}`);
      if (ml.emits && !EMIT_KINDS.includes(ml.emits.kind)) errors.push(`${name(o)} [${m.name || m.type}]: unknown emitter kind ${ml.emits.kind}`);
    }
  });
  return errors;
}

// ---- export --------------------------------------------------------------------------------------------------------------
// The records as the bake reads them (glTF extras "lighting", a JSON string: Blender's importer keeps strings as they are).
const MESH_KEYS = ['role', 'motion', 'bake', 'why', 'probeSide', 'sun', 'weather', 'zone', 'space', 'puddleMirror'];
const MATERIAL_KEYS = ['surface', 'alphaCutout', 'twoSided', 'foliage', 'wet', 'weather', 'glass', 'sheer', 'emits', 'reflection', 'clearcoat', 'castsSun', 'bake', 'contact', 'zone'];
const pickKeys = (r, keys) => Object.fromEntries(keys.map(k => [k, r[k] ?? null]));
export const meshRecord = o => pickKeys(meshLighting(o), MESH_KEYS);
export const materialRecord = m => pickKeys(lightingOf(m), MATERIAL_KEYS);
export const exportLighting = r => JSON.stringify(r);
export { MESH_KEYS, MATERIAL_KEYS };
