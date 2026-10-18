// The lighting manifest: how every object and material is lit, declared where it is made and resolved once here.
//
// Declarations live in userData.lighting (objects: the mesh or any ancestor; materials: the material itself). Most
// placements declare only a role ({ role: 'plant' }) and most materials nothing (an opaque surface); presets fill the
// rest. classifyLighting(root) resolves every mesh and material below root into a full record (kept beside the object,
// never in userData: a clone resolves its own, from its own properties and the declarations it copied; lightingOf and
// meshLighting read them), validateLighting(root) lists what is undeclared or contradictory, and every consumer (batching,
// baked and probe lighting, the bake export, unwrap, the Cycles scene, the tracer, puddles, contact shadows, lamp
// groups) reads these records instead of deciding from names, ids or coordinates. bake/scripts/lighting.py reads the
// same records from the GLB's extras (exportLighting writes them).
//
// Records (all fields always present; `declared` holds what was declared):
//   material: { surface, alphaCutout, twoSided, foliage, wet, weather, glass, sheer, emits, reflection, clearcoat,
//               castsSun, bake, contact, zone }
//   mesh:     { role, motion, bake, why, probeSide, sun: { cast, track }, weather, zone, space, puddleMirror }
// See SCHEMA below for every field's values and meaning.
import { isInside, spaceAt, spaces, levels } from './plan.js';

// ---- vocabulary -----------------------------------------------------------------------------------------------------
export const SCHEMA = {
  material: {
    surface: ['opaque', 'foliage', 'leafCard', 'glass', 'sheer', 'mirror', 'lamp', 'screen', 'indicator', 'fire', 'presentation'],
    alphaCutout: 'alpha-tested cut-out (alphaTest > 0): a property of the texture, not of being a plant',
    twoSided: [false, 'faceDirection'],            // leaf cards: the normal follows the face seen
    foliage: 'null, or { groundOcclusion, bakedPerVertex }: the plant treatment (probe occlusion near the ground, per-vertex foliage bake)',
    wet: ['auto', 'dry'],                          // auto: per-pixel wet ground / puddles where the mask says (outdoors, low, facing up)
    weather: ['auto', 'plant'],                    // the after-rain class of meshes using it: plant forces the leaf rule
    glass: 'null, or { pane, overlay, export, daylightOpacity }: one glass definition (declared surface glass: no sun shadow, no lightmap); a window pane also takes the Fresnel sky overlay, becomes clear transmissive glass in the bake (export pane) and swaps to its day opacity',
    sheer: 'null, or { reflect, transmit } (decor.js voile, cellular shades)',
    // Real light sources: the lamp surfaces light_switch.js collects from the fixtures (switched) and materials marked where
    // they are made ('lamp' for bulbs, shades and diffusers outside a switch, 'screen' and 'indicator' for displays and
    // LEDs that are on, 'fire'). Any other emissive colour is a raster stand-in (lighting.js lifts every emissive material
    // to a 0.12 glow by day, so cloth and paper read as backlit) and must not emit light in the path tracer (photo.js),
    // the Blender export (bake/export/setup.py) or under the baked lighting (lightmap.js).
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
    fakeShadow: 'a stand-in contact shadow (the pets\' blobs): hidden while the contact-shadow pass runs',
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
// its resolved record (it is resolved again from the declarations).
const RECORDS = new WeakMap();
export function declare(target, decl) {
  target.userData.lighting = { ...(target.userData.lighting ?? {}), ...decl };
  RECORDS.delete(target);
  return target;
}
const declared = t => t?.userData?.lighting ?? {};
export const isResolved = t => RECORDS.has(t);

// ---- materials ---------------------------------------------------------------------------------------------------------
// what an undeclared see-through material looks like (validateLighting: it must declare glass, sheer or presentation)
const seeThroughLike = m => m.transmission > 0 || (!!m.transparent && m.opacity < 0.6);
const presentationLike = m => !!m.userData?.presentation || m.blending === 2 /* AdditiveBlending */ ||
  (!!m.isMeshBasicMaterial && !!m.transparent && !m.depthWrite && !!m.polygonOffset && m.color?.getHex?.() === 0);

export function resolveMaterial(m) {
  if (!m) return null;
  const cur = RECORDS.get(m);
  if (cur) return cur;
  const d = declared(m), u = m.userData;
  const emits = d.emits !== undefined ? d.emits : u.emits ? { kind: u.emits, switched: !!u.lightGlow } : u.lightGlow ? { kind: 'lamp', switched: true } : null;
  let surface = d.surface;
  if (!surface) surface = u.sheer ? 'sheer' : presentationLike(m) ? 'presentation' : emits ? emits.kind : 'opaque';
  const alphaCutout = m.alphaTest > 0, preset = SURFACE_PRESETS[surface] ?? {};
  const pick = (k, dflt) => d[k] !== undefined ? d[k] : preset[k] !== undefined ? preset[k] : dflt;
  // the plant treatment is a plant's (foliage, leaf cards), not an alpha mask's: a net, a lattice or a perforated panel
  // is a cut-out surface lit like any other
  const foliage = pick('foliage', null), leaf = surface === 'leafCard' || (!!foliage && alphaCutout);
  // glass: one definition (declared surface 'glass'); a window pane also takes the Fresnel sky overlay, becomes clear
  // transmissive glass in the bake, and swaps to its day opacity in the raster path
  const pane = surface === 'glass' && !!d.glass?.pane;
  const glass = surface === 'glass' ? { pane, overlay: d.glass?.overlay ?? pane, export: d.glass?.export ?? (pane ? 'pane' : 'keep'), daylightOpacity: pane ? u.daylightOpacity ?? null : null } : null;
  const sheer = u.sheer ?? d.sheer ?? null;
  // what unwrap.py leaves out of the atlas (plant, glass): alpha masks, plants, and what the export turns into transmission
  const unwrapGlass = !m.isShaderMaterial && (!!sheer || surface === 'glass' || m.transmission > 0);
  const r = {
    declared: d, surface, alphaCutout,
    twoSided: pick('twoSided', false),
    foliage,
    // leaves (leaf cards, a plant's cut-out leaves) stay dry and take the plant's after-rain sheen
    wet: d.wet ?? (leaf ? 'dry' : 'auto'),
    weather: d.weather ?? (leaf ? 'plant' : 'auto'),
    glass, sheer, emits,
    reflection: pick('reflection', 'probe'),
    clearcoat: d.clearcoat !== undefined ? d.clearcoat : m.clearcoat > 0 ? 'probe' : null,
    castsSun: d.castsSun ?? !(surface === 'glass' || surface === 'presentation' || m.transmission > 0),   // light passes
    // no lightmap for plants, leaf cards, glass and cloth, nor for cut-outs (a hole has no surface to bake)
    bake: d.bake ?? (alphaCutout || preset.bake === 'probe' && surface !== 'sheer' || unwrapGlass ? 'probe' : 'lightmap'),
    // the contact-shadow depth pass draws solid depth: no plants (wind), nothing see-through, no cut-outs (no alpha there)
    contact: d.contact ?? !(foliage || alphaCutout || m.transparent || m.transmission > 0 || m.isShaderMaterial),
    zone: d.zone !== undefined ? d.zone : null,
  };
  RECORDS.set(m, r);
  return r;
}
// The resolved record of a material (resolving it on first use: pets, the visitor and helpers made after classify).
export const lightingOf = m => m ? RECORDS.get(m) ?? resolveMaterial(m) : null;

// ---- meshes ------------------------------------------------------------------------------------------------------------
const mats = o => [].concat(o.material ?? []).filter(Boolean);
const lmMesh = o => o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && !!o.geometry?.attributes.position;
// the nearest ancestor (or self) whose declaration has `key`
function inherited(o, key) { for (let p = o; p; p = p.parent) { const d = declared(p); if (d[key] !== undefined) return { node: p, value: d[key] }; } return null; }
const movingRoot = p => !!(p.userData.animate || p.userData.toggle);
// The role an object declares, or inherits from the nearest ancestor that declares one.
export function roleOf(o) { for (let p = o; p; p = p.parent) { const d = declared(p); if (d.role !== undefined) return d.role; } return null; }

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
    const from = RECORDS.get(member) ?? resolveMesh(member, ctx), own = placeOf(o, ctx);
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
  }
  if (o.isReflector || ms.some(m => lightingOf(m).surface === 'presentation')) presentation = true;
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
  const leaves = door ? declared(door).leaves ?? 'probe' : null;   // the door declares how its leaves are lit (house.js)
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
  return { declared: own, role, motion, bake, why: hidden && !why ? 'hidden' : why, probeSide,
    sun: { cast: m0 ? lightingOf(m0).castsSun : true, track: plant ? 'plant' : 'static' },
    ...placeOf(o, ctx), puddleMirror: own.puddleMirror ?? true, fakeShadow: !!own.fakeShadow };
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
    if (!force && RECORDS.has(o)) return;
    RECORDS.set(o, resolveMesh(o, ctx)); meshes++;
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
  return RECORDS.get(o) ?? resolveMesh(o, { still: new Set(), ceiling: levels.ceiling, box3: o2 => new Box().of(o2) });
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
    const l = RECORDS.get(o);
    if (!l) { errors.push(`${name(o)}: not classified`); return; }
    if (!ROLES.includes(l.role)) errors.push(`${name(o)}: unknown role ${l.role}`);
    for (const m of mats(o)) {
      const ml = RECORDS.get(m), md = declared(m);
      if (!ml) { errors.push(`${name(o)} [${m.name || m.type}]: material not classified`); continue; }
      if (!SURFACES.includes(ml.surface)) errors.push(`${name(o)} [${m.name || m.type}]: unknown surface ${ml.surface}`);
      if (md.alphaCutout !== undefined && md.alphaCutout !== m.alphaTest > 0) errors.push(`${name(o)} [${m.name || m.type}]: alphaCutout declared ${md.alphaCutout} but alphaTest ${m.alphaTest}`);
      if (ml.emits && !EMIT_KINDS.includes(ml.emits.kind)) errors.push(`${name(o)} [${m.name || m.type}]: unknown emitter kind ${ml.emits.kind}`);
      if (seeThroughLike(m) && !m.isShaderMaterial && !['glass', 'sheer', 'presentation'].includes(ml.surface)) errors.push(`${name(o)} [${m.name || m.type}]: see-through (opacity ${m.opacity}) but declared ${ml.surface}: declare glass, sheer or presentation`);
    }
  });
  return errors;
}

// ---- fixtures ------------------------------------------------------------------------------------------------------------
// A fixture is what a light switch controls: declared on the object as { fixture: { kind, ... } } where it is made, and
// refined by its placement row (layout.js { lamp: { circuit, defaultOn, plate } }). Its lamp group follows from where
// it hangs: the plan space at its lamp surfaces (plan.js spaceAt) gives the room part (the space's lampGroup, else its
// id), the circuit the rest; every fixture in an exterior space is on the porch switch.
//   kind:      what it is; sets the default circuit (FIXTURE_KINDS)
//   circuit:   which switch of the room: main (the room's lights), lamps (table and bedside lamps), or a named one
//   heads:     one switch per child group (track heads); owner: 'bulb' (the switch is the child holding userData.bulbY)
//   label:     { en, zh } the switch's name (else the placement's name)
//   defaultOn: the time slots the switch starts on (lighting_slots.js names; dusk: every lamp)
//   plate:     [x, y, ry] the wall plate (plan metres, facing), on the switch nearest the placement's origin
//   lights:    'spec' (the live light layout.js made from the fixture's light spec) or 'children' (lights inside it)
export const SLOTS = ['sunrise', 'noon', 'golden', 'dusk'];
export const CIRCUITS = { main: '', lamps: 'Lamps', pendant: 'Pendant', cabinet: 'Cabinet', niche: 'Niche', center: 'Center' };
export const FIXTURE_KINDS = { ceiling: 'main', track: 'main', pendant: 'main', wall: 'main', lantern: 'main', opener: 'main', strip: 'main', lamp: 'lamps', cabinet: 'cabinet', niche: 'niche' };
export const EXTERIOR_GROUP = 'porch', ALWAYS_GROUP = 'always';
const DEFAULT_ON = ['dusk'];

export function fixtureOf(o) {
  const d = declared(o).fixture; if (!d) return null;
  let placed = null; for (let p = o; p; p = p.parent) if (p.userData.placement) { placed = p; break; }
  const row = placed?.userData.placement.lamp ?? {}, kind = d.kind ?? 'ceiling';
  const holder = o.userData.light ? o : placed?.userData.light ? placed : null;
  return {
    node: o, placed, kind, id: placed?.userData.id || o.userData.id || o.name,
    circuit: row.circuit ?? d.circuit ?? FIXTURE_KINDS[kind] ?? 'main',
    heads: !!d.heads, owner: d.owner ?? null, label: d.label ?? null,
    defaultOn: row.defaultOn ?? d.defaultOn ?? DEFAULT_ON,
    plate: row.plate ?? d.plate ?? null,
    lights: d.lights ?? 'spec',
    spec: holder?.userData.light ?? null, holder,
    live: holder ? holder.userData.placement?.light !== false : false, bake: !!holder?.userData.placement?.bake,
  };
}
// Every declared fixture below root, in scene order (the order of the light switches).
export function fixturesIn(root) { const out = []; root.traverse(o => { if (declared(o).fixture) out.push(o); }); return out; }
// The lamp group of a switch whose lamp surfaces centre on plan (x, y): { group, space, exterior }.
export function lampGroupAt(fixture, x, y) {
  const space = spaceAt(x, y, 0.3);
  if (!space) return { group: null, space: null, exterior: false };
  const exterior = space.zone === 'exterior';
  return { group: exterior ? EXTERIOR_GROUP : (space.lampGroup ?? space.id) + (CIRCUITS[fixture.circuit] ?? ''), space: space.id, exterior };
}
// The lamp groups of a set of switch records in their canonical order (the bake's texture channels): rooms in the plan's
// order, each room's circuits in CIRCUITS order, then the porch, then 'always' (lamp surfaces no switch controls).
export function lampGroupOrder(records) {
  const order = new Map(), rank = new Map(spaces.map((s, i) => [s.id, i])), circuits = Object.keys(CIRCUITS);
  for (const r of records) if (r.group && !order.has(r.group)) order.set(r.group, [r.exterior ? 1 : 0, rank.get(r.space) ?? 1e3, circuits.indexOf(r.circuit)]);
  const cmp = (a, b) => { for (let i = 0; i < 3; i++) if (a[1][i] !== b[1][i]) return a[1][i] - b[1][i]; return a[0] < b[0] ? -1 : 1; };
  return [...[...order].sort(cmp).map(e => e[0]), ALWAYS_GROUP];
}
// The checks a switch set must pass: every switch in exactly one group, every group with members and a wall plate (unless
// it is 'always'), members agreeing on the default slots, slots by name. plates: the wall plates (userData.lightSwitch).
export function validateSwitches(entries, plates = []) {
  const errors = [], byGroup = new Map();
  for (const e of entries) {
    const r = e.lighting;
    if (!r?.group) { errors.push(`switch ${r?.id ?? e.root.name}: no lamp group (no plan space at its lamp surfaces)`); continue; }
    if (!byGroup.has(r.group)) byGroup.set(r.group, []);
    byGroup.get(r.group).push(e);
    for (const s of r.defaultOn) if (!SLOTS.includes(s)) errors.push(`switch ${r.id} (${r.group}): unknown default slot ${s}`);
  }
  for (const [g, list] of byGroup) {
    const d = JSON.stringify([...list[0].lighting.defaultOn].sort());
    if (list.some(e => JSON.stringify([...e.lighting.defaultOn].sort()) !== d)) errors.push(`group ${g}: members disagree on their default slots`);
    const n = plates.filter(p => list.some(e => e.toggle === p.userData.lightSwitch)).length;
    if (n !== 1) errors.push(`group ${g}: ${n} wall plates`);
  }
  for (const p of plates) if (!entries.some(e => e.toggle === p.userData.lightSwitch)) errors.push(`plate ${p.name}: drives no switch`);
  return errors;
}
// A light spec's point in its fixture's frame (layout.js addLight, the bake export): x, y (default 2.3 m), z.
export const lightLocal = spec => [spec.x ?? 0, spec.y ?? 2.3, spec.z ?? 0];
// Is a light at plan (x, y) an exterior one (on at dusk only): the plan space it is in (a light in a wall takes the space it
// faces), as the switches' lamp groups.
export const exteriorAt = (x, y) => spaceAt(x, y, 0.3)?.zone === 'exterior';
// Live lights a fixture owns (layout.js addLight, lighting.js extra lights): registered here, not matched by position.
const LIGHTS = new WeakMap();
export function ownLight(holder, light) { if (!LIGHTS.has(holder)) LIGHTS.set(holder, []); LIGHTS.get(holder).push(light); }
export const ownedLights = holder => LIGHTS.get(holder) ?? [];

// ---- emission levels -------------------------------------------------------------------------------------------------------
// How bright an emitter or a live light is, one rule per path (the raster walkthrough, the baked lighting), read by every
// consumer that drives them: light_switch.js, lamp_groups.js, lighting.js and lightmap.js.
// A lamp surface of a switch (glow: { base, wash }: wash, an additive glow card driven through its opacity). Raster: x1.8
// at dusk, its own base by day for fixtures meant to be on by day (spec.day), else the faint 0.12 off-level; baked: x1.8
// at the lamp level (its lamp group's, or the slot's); a wash card at its base times the level.
export function glowLevel(glow, { baked = false, dusk = false, day = false, level = 1 } = {}) {
  if (glow.wash) return glow.base * (baked ? level : 1);
  if (baked) return glow.base * 1.8 * level;
  return dusk ? glow.base * 1.8 : day ? glow.base : 0.12;
}
// A live light's factor on its base in the raster look: an exterior light is on at dusk (or when switched on by hand);
// an interior one x5 at dusk, by day its spec's day factor (else 0.2) when switched by hand or while the eye is indoors.
export function lightLevel(light, { dusk = false, indoor = 1, manual = false } = {}) {
  if (light.userData.exterior) return dusk || manual ? 1 : 0;
  return dusk ? 5 : manual || indoor > 0.01 ? light.userData.day ?? 0.2 : 0;
}
// A raster stand-in emissive (not a real light source: cloth, paper): faint by day, x1.8 at dusk.
export const standInEmission = (base, dusk) => dusk ? base * 1.8 : 0.12;
// An emitter's intensity under the baked lighting on a material standing in for its source (a lightmapped copy, or the
// probe-lit material itself): a lamp no switch drives at the slot's lamp level; a switched lamp surface, a screen, an
// indicator or a fire as its source shows it now (its switch, its own level, the fire's flicker).
export const bakedEmission = (record, source, base, slotLamps) => record.emits?.kind === 'lamp' && !record.emits.switched ? base * slotLamps : source.emissiveIntensity;

// ---- export --------------------------------------------------------------------------------------------------------------
// The records as the bake reads them (glTF extras "lighting", a JSON string: Blender's importer keeps strings as they are).
const MESH_KEYS = ['role', 'motion', 'bake', 'why', 'probeSide', 'sun', 'weather', 'zone', 'space', 'puddleMirror', 'fakeShadow'];
const MATERIAL_KEYS = ['surface', 'alphaCutout', 'twoSided', 'foliage', 'wet', 'weather', 'glass', 'sheer', 'emits', 'reflection', 'clearcoat', 'castsSun', 'bake', 'contact', 'zone'];
const pickKeys = (r, keys) => Object.fromEntries(keys.map(k => [k, r[k] ?? null]));
export const meshRecord = o => pickKeys(meshLighting(o), MESH_KEYS);
export const materialRecord = m => pickKeys(lightingOf(m), MATERIAL_KEYS);
export const exportLighting = r => JSON.stringify(r);
// GLTFExporter plugin (exporter.register(gltfLightingPlugin())): every node's record (photo.js puts it on the exported
// meshes) and every material's, as the extras string "lighting". Runs after the exporter's own userData extras.
export const gltfLightingPlugin = () => () => ({
  writeNode(o, def) { if (o.userData.lightingRecord) { (def.extras ??= {}).lighting = exportLighting(o.userData.lightingRecord); delete def.extras.lightingRecord; } },
  async writeMaterialAsync(m, def) { (def.extras ??= {}).lighting = exportLighting(materialRecord(m)); },
});
export { MESH_KEYS, MATERIAL_KEYS };
// The questions the bake scripts ask of the records (bake/scripts/lighting.py PREDICATES: the same answers, checked by
// web/tools/test_lighting_roundtrip.mjs).
export function bakeAnswers(kind, r) {
  if (kind === 'mesh') return { movable: r.motion === 'movable', weather: r.weather ?? null, lightmap: r.bake === 'lightmap' };
  return { clearGlass: r.glass?.export === 'pane', sheer: r.sheer != null, seeThrough: r.surface === 'glass' || r.sheer != null || !!r.alphaCutout, emitter: r.emits?.kind ?? null,
    lampSurface: !!r.emits && (r.emits.kind === 'lamp' || !!r.emits.switched), bakedFoliage: !!r.foliage?.bakedPerVertex };
}
