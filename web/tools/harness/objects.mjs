// Indexes the built scene with stable keys and captures what each object is (objects.json).
import { r3, r4, hash8 } from './util.mjs';

const mats = o => [].concat(o.material ?? []).filter(Boolean);

// ---- stable keys ---------------------------------------------------------------------------------------------------
// A mesh with a lightmap id is keyed by it (`lm:<id>`, unique by construction). Anything else by a path of names from its
// placed root (`<module>.<item>@x,y#n` placement id) or from the scene, so reordering unrelated objects does not
// renumber it. Same-named siblings get an index.
export function indexScene(world) {
  const { T, scene, layout } = world;
  scene.updateMatrixWorld(true);
  const placedKey = new Map(), placedSeen = new Map();
  for (const o of layout.placed) {
    const p = o.userData.placement;
    let k = `${p.m}.${p.i}@${r3(o.position.x)},${r3(-o.position.z)}`;
    const n = placedSeen.get(k) ?? 0; placedSeen.set(k, n + 1); if (n) k += `#${n}`;
    placedKey.set(o, k);
  }
  const labelOf = n => n.userData.id || n.name || n.type;
  const siblingIndex = new WeakMap();
  const indexChildren = parent => {
    const seen = new Map(), count = new Map();
    for (const c of parent.children) count.set(labelOf(c), (count.get(labelOf(c)) ?? 0) + 1);
    for (const c of parent.children) { const l = labelOf(c), i = seen.get(l) ?? 0; seen.set(l, i + 1); siblingIndex.set(c, count.get(l) > 1 ? `${l}[${i}]` : l); }
  };
  const segment = n => { if (!siblingIndex.has(n) && n.parent) indexChildren(n.parent); return siblingIndex.get(n) ?? labelOf(n); };
  const pathOf = n => {
    const parts = []; let root = null;
    for (let p = n; p; p = p.parent) { if (placedKey.has(p)) { root = placedKey.get(p); break; } if (p === scene) break; parts.push(segment(p)); }
    return (root ? root + '/' : '') + parts.reverse().join('/');
  };
  const regionOf = n => {
    for (let p = n; p; p = p.parent) {
      if (p === world.houseRoot) return 'house'; if (p === world.garden.group) return 'garden'; if (p === layout.root) return 'furniture';
      if (p.name === 'batched') return 'batched'; if (p.name?.startsWith('wall-switch-')) return 'plate'; if (p === world.fixtures) return 'lights';
    }
    return 'scene';
  };
  const ownerOf = n => { for (let p = n; p; p = p.parent) if (placedKey.has(p)) return p; return null; };

  const meshes = [], keys = new Set();
  scene.traverse(o => {
    if (!o.isMesh) return;
    let key = o.userData.lmId ? 'lm:' + o.userData.lmId : (o.userData.batch ? 'frozen:' : 'path:') + pathOf(o);
    for (let n = 1; keys.has(key); n++) key = key.replace(/#\d+$/, '') + '#' + n;
    keys.add(key); meshes.push({ key, node: o });
  });
  const placed = layout.placed.map(o => ({ key: placedKey.get(o), node: o }));
  const keyOf = new Map([...meshes, ...placed].map(e => [e.node, e.key]));
  // dynamic roots, as main.js passes them to applyLightmaps, plus every anchor / animated root batchStatic saw
  const dynamicRoots = new Set([...world.doors.map(d => d.group), ...layout.animated.filter(o => o.userData.toggle)]);
  const anchors = new Set(layout.interactive), animated = new Set(layout.animated);
  return { meshes, placed, keyOf, placedKey, pathOf, regionOf, ownerOf, dynamicRoots, anchors, animated, T };
}

// ---- materials -----------------------------------------------------------------------------------------------------
const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'alphaMap', 'aoMap', 'emissiveMap', 'lightMap', 'bumpMap', 'envMap'];
const num = v => typeof v === 'number' ? r4(v) : v;
const userSlice = u => {
  const out = {};
  for (const k of ['emits', 'lightGlow', 'daylightOpacity', 'exteriorFinish', 'daylightPaint', 'presentation', 'reflection', 'noHighlight']) if (u[k] !== undefined) out[k] = typeof u[k] === 'number' ? r4(u[k]) : u[k];
  if (u.sheer !== undefined) out.sheer = typeof u.sheer === 'object' ? Object.fromEntries(Object.entries(u.sheer).map(([a, b]) => [a, num(b)])) : u.sheer;
  return out;
};
export function materialProps(m) {
  const p = { type: m.type, name: m.name || '', transparent: !!m.transparent, opacity: r4(m.opacity ?? 1), alphaTest: r4(m.alphaTest ?? 0), side: m.side, blending: m.blending,
    depthWrite: m.depthWrite !== false, transmission: r4(m.transmission ?? 0), emissive: m.emissive ? m.emissive.getHexString() : null, emissiveIntensity: r4(m.emissiveIntensity ?? 0),
    clearcoat: r4(m.clearcoat ?? 0), roughness: num(m.roughness), metalness: num(m.metalness), color: m.color ? m.color.getHexString() : null,
    maps: MAPS.filter(k => m[k]).join(','), user: userSlice(m.userData ?? {}) };
  if (m.isShaderMaterial) { p.shader = true; }
  return p;
}
export const materialKey = m => { const p = materialProps(m); return `${p.name || p.type}#${hash8(JSON.stringify(p))}`; };

// ---- objects.json ----------------------------------------------------------------------------------------------------
const EXTERIOR_RE = /porch|wall-light-black|outdoor-front-lamp/;   // light_switch.js:138, duplicated in bake/export/switch_groups.mjs:40
export const fixtureExterior = id => EXTERIOR_RE.test(id || '');

export function captureObjects(world, ix) {
  const { T, layout, doors, scene } = world;
  const box = new T.Box3();
  const bbox = o => { box.makeEmpty(); box.expandByObject(o, true); return box.isEmpty() ? null : [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].map(r3); };
  const materials = {}, matKey = new Map();
  const matRef = m => { let k = matKey.get(m); if (!k) { k = materialKey(m); matKey.set(m, k); materials[k] ??= materialProps(m); } return k; };
  const visibleChain = o => { for (let p = o; p; p = p.parent) if (p.visible === false) return false; return true; };
  const inherited = (o, f) => { for (let p = o; p; p = p.parent) { const v = f(p); if (v) return v; } return null; };

  const meshes = {};
  for (const { key, node: o } of ix.meshes) {
    const u = o.userData;
    // moving / still: the nearest root that moves (animated, toggled, movable, a door) decides; its meshes with a lightmap id are its still parts
    const dyn = inherited(o, p => (ix.anchors.has(p) || ix.animated.has(p) || ix.dynamicRoots.has(p) || p.userData.toggle || p.userData.movable || p.userData.door) ? p : null);
    const motion = !dyn ? 'static' : dyn.userData.movable ? 'movable' : dyn.userData.door ? (u.lmId ? 'still' : 'moving') : (u.lmId ? 'still' : 'moving');
    const flags = {};
    const set = (n, v) => { if (v) flags[n] = v; };
    set('movable', !!inherited(o, p => p.userData.movable)); set('toggle', !!inherited(o, p => p.userData.toggle)); set('animate', !!inherited(o, p => p.userData.animate));
    set('noBatch', !!inherited(o, p => p.userData.noBatch)); set('door', inherited(o, p => p.userData.door?.kind) || false); set('viewRoom', inherited(o, p => p.userData.viewRoom?.key) || false);
    set('lightHit', !!u.lightHit); set('noHighlight', !!u.noHighlight); set('batched', !!u.batched); set('batch', !!u.batch); set('window', !!inherited(o, p => p.userData.window));
    const owner = ix.ownerOf(o);
    meshes[key] = { region: ix.regionOf(o), placed: owner ? ix.placedKey.get(owner) : undefined, name: o.name || undefined, inst: o.isInstancedMesh ? o.count : undefined,
      bbox: bbox(o), lmSkip: u.lmSkip, motion, visible: visibleChain(o) ? undefined : false, shadow: (o.castShadow ? 'c' : '') + (o.receiveShadow ? 'r' : '') || undefined, flags: Object.keys(flags).length ? flags : undefined,
      materials: mats(o).map(matRef) };
  }

  // switches by their root, plates by toggle
  const plates = new Map();
  for (const c of scene.children) if (c.name?.startsWith('wall-switch-') && c.userData.lightSwitch) { const l = plates.get(c.userData.lightSwitch) ?? []; l.push(c.name); plates.set(c.userData.lightSwitch, l); }
  const switchOf = new Map();
  for (const s of world.switches) {
    const fixture = (() => { for (let p = s.root; p; p = p.parent) if (p.userData.placement) return p; return s.root; })();
    const lights = s.toggle.lights.map(l => ({ type: l.type, name: l.name || undefined, pos: [l.position.x, l.position.y, l.position.z].map(r3), intensity: r4(l.intensity), base: l.userData.base !== undefined ? r4(l.userData.base) : undefined, switchBase: l.userData.switchBase !== undefined ? r4(l.userData.switchBase) : undefined }));
    const rec = { fixture: ix.placedKey.get(fixture) ?? ix.pathOf(fixture), fixtureId: fixture.userData.id || fixture.name, root: s.root === fixture ? '.' : ix.pathOf(s.root),
      label: s.toggle.label.en, labelOn: s.toggle.labelOn.en, exterior: fixtureExterior(fixture.userData.id), plates: (plates.get(s.toggle) ?? []).sort(), lights,
      glows: s.toggle.glows.map(g => ({ base: r4(g.base), wash: !!g.wash, material: matRef(g.material) })), meshes: s.meshes.length };
    switchOf.set(s.root, rec);
  }

  const placed = {};
  for (const { key, node: o } of ix.placed) {
    const u = o.userData, p = u.placement, door = u.door;
    const flags = {};
    for (const f of ['movable', 'toggle', 'animate', 'noBatch', 'collider', 'seats', 'interactiveRoot', 'viewRoom', 'lightFixture']) if (u[f]) flags[f] = f === 'seats' ? u.seats.length : f === 'movable' ? (typeof u.movable === 'object' ? { radius: r3(u.movable.radius ?? 0) } : true) : f === 'lightFixture' ? { name: u.lightFixture.name } : f === 'viewRoom' ? u.viewRoom.key : typeof u[f] === 'object' ? (f === 'collider' ? 1 : true) : true;
    let meshCount = 0, lmCount = 0; o.traverse(m => { if (m.isMesh) { meshCount++; if (m.userData.lmId) lmCount++; } });
    placed[key] = { module: p.m, item: p.i, id: u.id, name: u.name, zh: u.zh, plan: { x: r3(o.position.x), y: r3(-o.position.z), h: r3(o.position.y), ry: r3(o.rotation.y) }, placement: Object.fromEntries(Object.entries(p).filter(([k, v]) => typeof v !== 'object' && !['x', 'y', 'h', 'ry', 'm', 'i'].includes(k)).map(([k, v]) => [k, typeof v === 'number' ? r4(v) : v])),
      bbox: bbox(o), flags, light: u.light ? Object.fromEntries(Object.entries(u.light).map(([k, v]) => [k, typeof v === 'number' ? r4(v) : v])) : undefined,
      meshes: meshCount, lightmapped: lmCount, mirrors: o.children.filter(c => c.isReflector).length || undefined, door: door ? { kind: door.kind } : undefined };
  }
  // switch records hang off the object that owns the fixture; heads / owners below the fixture get their own entry
  const switches = {};
  let n = 0;
  for (const [root, rec] of switchOf) { let k = `${rec.fixture}|${rec.root}|${rec.label}`; if (switches[k]) k += `#${++n}`; switches[k] = rec; }

  const lights = {};
  scene.traverse(o => {
    if (!o.isLight || o.isRectAreaLight && o.name.startsWith('Sky fill') && false) return;
    const wp = new T.Vector3(); o.getWorldPosition(wp);
    let k = `${o.type}:${o.name || ''}`; for (let i = 1; lights[k]; i++) k = `${o.type}:${o.name || ''}#${i}`;
    lights[k] = { type: o.type, pos: [wp.x, wp.y, wp.z].map(r3), intensity: r4(o.intensity), color: o.color?.getHexString(), distance: o.distance !== undefined ? r4(o.distance) : undefined,
      user: Object.fromEntries(['base', 'day', 'exterior', 'switchBase', 'always', 'north'].filter(f => o.userData[f] !== undefined).map(f => [f, typeof o.userData[f] === 'number' ? r4(o.userData[f]) : o.userData[f]])),
      switched: !!o.userData.lightSwitch, parent: o.parent?.name || o.parent?.type };
  });

  const doorTable = {};
  for (const d of doors) {
    const g = d.group; let k = g.name || ix.pathOf(g);
    doorTable[k] = { kind: d.kind, open: typeof d.open === 'number' ? r4(d.open) : d.open, bbox: bbox(g), plan: d.plan ? Object.fromEntries(Object.entries(d.plan).map(([a, b]) => [a, typeof b === 'number' ? r3(b) : b])) : undefined };
  }

  // The records bake/export/switch_groups.mjs:32-52 writes for scripts/lamp_groups.py (quoted: that script runs in a browser page).
  const plan = v => [+v.x.toFixed(3), +(-v.z).toFixed(3), +v.y.toFixed(3)];
  const bakeSwitches = {};
  world.switches.forEach(({ root, toggle, meshes }, i) => {
    let fixture = root; while (fixture && !fixture.userData.placement) fixture = fixture.parent;
    const spec = (fixture ?? root).userData.light, pl = fixture?.userData.placement;
    const id = fixture?.userData.id || root.userData.id || root.name;
    const glows = meshes.map(m => { const b = new T.Box3().setFromObject(m), c = b.getCenter(new T.Vector3()), sz = b.getSize(new T.Vector3()); return { c: plan(c), size: [+sz.x.toFixed(3), +sz.z.toFixed(3), +sz.y.toFixed(3)], mat: m.material.name || '', emissive: !!m.material.emissive }; });
    const wpos = root.getWorldPosition(new T.Vector3());
    let key = `${id}@${plan(wpos).map(v => v.toFixed(2)).join(',')}`; for (let n = 1; bakeSwitches[key]; n++) key = key.replace(/#\d+$/, '') + '#' + n;
    bakeSwitches[key] = { i, key, id, name: toggle.label.en.replace(/^Turn on · /, ''), root: plan(wpos), exterior: fixtureExterior(id), on: toggle.on,
      lights: toggle.lights.map(l => ({ type: l.type, p: plan(l.getWorldPosition(new T.Vector3())), intensity: l.userData.base !== undefined ? r4(l.userData.base) : l.userData.switchBase !== undefined ? r4(l.userData.switchBase) : undefined })),
      spec: spec ? { ...Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, typeof v === 'number' ? r4(v) : v])), p: plan(new T.Vector3(0, spec.y ?? 2.3, 0).applyMatrix4(fixture.matrixWorld)), liveLight: pl?.light !== false, bake: !!pl?.bake } : null, glows };
  });

  const counts = { meshes: ix.meshes.length, placed: ix.placed.length, withLmId: ix.meshes.filter(e => e.node.userData.lmId).length, lmSkip: ix.meshes.filter(e => e.node.userData.lmSkip).length };
  return { meta: { note: 'Golden snapshot of the headless scene (web/tools/harness/scene.mjs). Regenerate with UPDATE_GOLDEN=1 node web/tools/test_scene_golden.mjs.', counts, batch: { before: world.batch.before, after: world.batch.after, lmIds: world.batch.lmIds } },
    materials, placed, meshes, switches, bakeSwitches, lights, doors: doorTable };
}
