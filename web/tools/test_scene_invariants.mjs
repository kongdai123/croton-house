// Invariants on the REAL house, built headless (tools/harness/scene.mjs): no browser, no GPU. Each is reported pass / fail with its
// offenders. Today some fail (known debt, docs/audit/*): their offenders are recorded in tools/golden/known_failures.json, so
// the test passes now but fails on any NEW violation, and lists the recorded entries that are fixed so the list can shrink.
//   node web/tools/test_scene_invariants.mjs                 check
//   UPDATE_KNOWN=1 node web/tools/test_scene_invariants.mjs  rewrite known_failures.json from the current offenders
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildRealScene } from './harness/scene.mjs';
import { indexScene } from './harness/objects.mjs';

const WEB = fileURLToPath(new URL('../', import.meta.url)), REPO = join(WEB, '..'), KNOWN = join(WEB, 'tools/golden/known_failures.json');
const t0 = performance.now();
const w = await buildRealScene(), ix = indexScene(w);
const { T, scene, switches, doors } = w;
const plan = v => [v.x, -v.z, v.y];
const visible = o => { for (let p = o; p; p = p.parent) if (p.visible === false) return false; return true; };
const mats = o => [].concat(o.material ?? []).filter(Boolean);
const fixtureOf = n => { for (let p = n; p; p = p.parent) if (p.userData.placement) return p; return null; };
const plates = scene.children.filter(c => c.name?.startsWith('wall-switch-') && c.userData.lightSwitch);

const results = [];   // { id, title, offenders: string[] }
const invariant = (id, title, offenders) => results.push({ id, title, offenders: [...new Set(offenders)].sort() });

// ---- 1. every interior space has an emitting fixture with a switch ---------------------------------------------------
// The spaces are the plan model's (data/plan.json: rooms, baths, closets, the hall, the annex); a fixture belongs to the
// space at its root (a root in a wall takes the room it faces).
{
  const lit = new Set(switches.filter(s => s.toggle.glows.length && plates.some(p => p.userData.lightSwitch === s.toggle))
    .map(s => { const p = plan(s.root.getWorldPosition(new T.Vector3())); return w.plan.spaceAt(p[0], p[1], 0.3)?.id; }));
  invariant('rooms-have-switched-light', 'every interior space of the plan has at least one emitting fixture with a wall switch',
    w.plan.spaces.filter(sp => sp.zone !== 'exterior' && !lit.has(sp.id)).map(sp => `${sp.id} (${sp.label.en})`));
}

// ---- 1b. closet rule: each closet / laundry can over the clear part of its space -----------------------------------------
// Owner decision 2026-10-17: the centre of the largest clear part of the space, never above furniture taller than ~1.9 m
// (layout.js closetSpot: the laundry can sat on the washer-dryer stack). Checked from the scene: the can's centre is in its
// space and its footprint over no mesh standing in that space (footprint centre inside) that reaches above 1.9 m.
{
  const off = [], box = new T.Box3(), tall = [];
  scene.updateMatrixWorld(true);
  // the pieces as placed: batched originals (hidden, userData.batched) count, the merged cells (userData.batch) do not
  scene.traverse(o => { if (!o.isMesh || o.userData.batch || (!visible(o) && !o.userData.batched)) return; box.setFromObject(o);
    if (box.isEmpty() || box.max.y <= 1.9 || box.min.y >= 2.32) return;
    tall.push({ x0: box.min.x, x1: box.max.x, y0: -box.max.z, y1: -box.min.z, o }); });
  const cans = w.layout.placed.filter(o => o.userData.placement?.rule === 'closet');
  for (const c of cans) {
    const p = c.userData.placement, sp = w.plan.spaces.find(s => s.id === p.space), x = c.position.x, y = -c.position.z;
    if (!sp || w.plan.spaceAt(x, y)?.id !== sp.id) { off.push(`${p.space}: can at (${x.toFixed(2)}, ${y.toFixed(2)}) outside its space`); continue; }
    const cb = new T.Box3().setFromObject(c), e = 0.005, f = { x0: cb.min.x + e, x1: cb.max.x - e, y0: -cb.max.z + e, y1: -cb.min.z - e };   // the can's own footprint
    for (const q of tall) if (w.plan.spaceAt((q.x0 + q.x1) / 2, (q.y0 + q.y1) / 2)?.id === sp.id && f.x1 > q.x0 && f.x0 < q.x1 && f.y1 > q.y0 && f.y0 < q.y1)
      off.push(`${p.space}: can at (${x.toFixed(2)}, ${y.toFixed(2)}) above ${fixtureOf(q.o)?.userData.placement?.i ?? q.o.name ?? 'a mesh'} (top ${box.setFromObject(q.o).max.y.toFixed(2)} m)`);
  }
  if (!cans.length) off.push('no closet-rule cans placed');
  invariant('closet-lights-clear', 'every closet-rule can is in its space and not above a piece standing there that is taller than 1.9 m', off);
}

// ---- 1c. door poses of the bake: the lightmaps' (bakePose) and the probes' (probePose) -------------------------------------
// bakePose 'open' exactly where the plan says bakeOpen (house.js once read them from house.json's scan record, which has
// none: the front-bedroom closet was going to bake shut again); probePose 'closed' wherever the site starts the door shut
// and where the plan says probeClosed (the front door), 'site' elsewhere (bake/export/export.mjs --probe-pose).
{
  const off = [];
  for (const d of doors) {
    const L = d.group.userData.lighting ?? {}, po = w.plan.openings.find(o => o.id === d.id) ?? {};
    const siteShut = d.kind === 'french' ? !d.open : d.kind === 'slider' ? false : !d.openDefault;
    const bake = po.bakeOpen ? 'open' : 'site', probe = siteShut || po.probeClosed ? 'closed' : 'site';
    if (L.bakePose !== bake) off.push(`${d.id} (${d.kind}): bakePose ${L.bakePose}, plan says ${bake}`);
    if (L.probePose !== probe) off.push(`${d.id} (${d.kind}): probePose ${L.probePose}, expected ${probe} (site ${siteShut ? 'shut' : 'open'}${po.probeClosed ? ', probeClosed' : ''})`);
  }
  if (!doors.some(d => d.group.userData.lighting?.bakePose === 'open')) off.push('no door bakes open (the plan has bakeOpen doors)');
  invariant('door-bake-poses', 'every door declares the lightmaps\' pose (plan bakeOpen) and the probes\' pose (shut where the site starts it shut, or plan probeClosed)', off);
}

// ---- 2. wall plates: every plate drives a fixture, every declared plate was made, one plate per lamp group, on wall ----------
// Plates are declared with their fixtures (layout.js placement rows lamp.plate, the niche can in house.js); a plate takes
// the toggle of its fixture's switch and is named after the switch's lamp group (lighting_roles.js lampGroupAt).
{
  const off = [], declaredPlates = new Set(), groups = new Map();
  scene.traverse(o => { const f = w.roles.fixtureOf(o); if (f?.plate) declaredPlates.add(f.placed?.userData.placement.lamp?.plate ? f.placed : o); });
  for (const p of plates) {
    const e = switches.find(s => s.toggle === p.userData.lightSwitch);
    if (!e || !(e.toggle.glows.length || e.toggle.lights.length)) { off.push(`plate ${p.name}: no fixture`); continue; }
    if (p.name !== 'wall-switch-' + e.lighting.group) off.push(`plate ${p.name}: drives a switch of group ${e.lighting.group}`);
    groups.set(e.lighting.group, (groups.get(e.lighting.group) ?? 0) + 1);
  }
  if (plates.length !== declaredPlates.size) off.push(`${declaredPlates.size} plates declared, ${plates.length} made`);
  for (const [g, n] of groups) if (n > 1) off.push(`group ${g}: ${n} plates`);
  // on solid wall (the plan's walls, annex included), clear of every opening and its casing on that wall
  for (const p of plates) {
    // behind it: a plan wall 2 cm back, or an exterior wall behind its 0.15 m stucco skin (the porch plate)
    const ry = p.rotation.y, x = p.position.x, y = -p.position.z, at = b => [-Math.sin(ry) * b, Math.cos(ry) * b];
    const backed = (b, ext) => { const [dx, dy] = at(b); return w.plan.walls.find(q => (!ext || q.exterior) && x + dx >= q.x0 && x + dx <= q.x1 && y + dy >= q.y0 && y + dy <= q.y1); };
    const wall = backed(0.02, false) ?? backed(0.17, true);
    if (!wall) { off.push(`plate ${p.name}: no wall behind it`); continue; }
    if (w.plan.openings.some(o => o.wall === wall.id && (o.dir === 'V' ? y > o.y0 - 0.065 && y < o.y1 + 0.065 : x > o.x0 - 0.065 && x < o.x1 + 0.065))) off.push(`plate ${p.name}: in a door or its casing`);
  }
  invariant('switch-plates-map-to-fixtures', 'every wall plate drives a fixture of its own lamp group, every declared plate was made (one per group), on solid wall clear of doors', off);
}

// ---- 2b. every wall plate is pickable: in front of every collider that stops a pick (interact.js wallDist) --------------------
// The porch plate was typed against the plan wall's face and sat 1.2 cm inside the exterior stucco skin's collider: no
// standing spot could pick it (smoke test switches). Its face (the 8 mm plate's front) is >= 1 cm in front of every wall /
// closet / slider collider along its normal, at its centre and edges; and a pick ray from eye height, up to 0.8 m in front
// (short of the next collider), reaches the face before any such collider.
{
  const off = [], cols = w.getColliders().filter(c => (c.tag === 'wall' || c.tag === 'closet' || c.tag === 'slider'));
  const ray = new T.Ray(), hit = new T.Vector3(), bx = new T.Box3();
  for (const p of plates) {
    const n = new T.Vector3(Math.sin(p.rotation.y), 0, Math.cos(p.rotation.y)), t = new T.Vector3(n.z, 0, -n.x);
    const face = p.position.clone().addScaledVector(n, 0.004), y = p.position.y;
    const inside = c => q => q.x > c.x0 && q.x < c.x1 && q.z > c.z0 && q.z < c.z1 && q.y < c.top;
    for (const c of cols) {
      let bad = false;
      for (const l of [-0.035, 0, 0.035]) for (let s = -0.01; s <= 0.3 + 1e-9 && !bad; s += 0.005) if (inside(c)(face.clone().addScaledVector(t, l).addScaledVector(n, s))) bad = true;
      if (bad) off.push(`${p.name} at (${p.position.x.toFixed(3)}, ${y.toFixed(2)}, ${p.position.z.toFixed(3)}): a ${c.tag} collider (x ${c.x0.toFixed(3)}..${c.x1.toFixed(3)}, z ${c.z0.toFixed(3)}..${c.z1.toFixed(3)}) within 1 cm behind or 30 cm in front of its face`);
    }
    // the visitor's eye: up to 0.8 m straight out, short of the first collider in front (a closet is 0.5..0.6 m across)
    let room = 0.8; for (let s = 0.01; s <= 0.85; s += 0.01) if (cols.some(c => inside(c)(face.clone().addScaledVector(n, s)))) { room = s - 0.1; break; }
    if (room < 0.3) { off.push(`${p.name}: only ${room.toFixed(2)} m to stand in front of it`); continue; }
    const eye = face.clone().addScaledVector(n, room); eye.y = 1.6; ray.set(eye, face.clone().sub(eye).normalize());
    const dist = eye.distanceTo(face); let wall = Infinity;
    for (const c of cols) { bx.min.set(c.x0, 0, c.z0); bx.max.set(c.x1, c.top, c.z1); if (ray.intersectBox(bx, hit)) wall = Math.min(wall, hit.distanceTo(eye)); }
    if (wall < dist - 1e-3) off.push(`${p.name}: a pick from ${room.toFixed(2)} m in front stops at a collider ${wall.toFixed(2)} m out, before the plate (${dist.toFixed(2)} m)`);
  }
  invariant('switch-plates-pickable', 'every wall plate\'s face stands >= 1 cm in front of every pick-blocking collider and a pick from in front reaches it', off);
}

// ---- 2c. nothing is built under an exterior wall's stucco skin ------------------------------------------------------------------
// house.js put a baseboard on both faces of every wall piece, also on the outer face of exterior walls, where the 0.15 m
// stucco skin covers it: 26 hidden meshes, black in the bake (bake QA units-black, e.g. 33178fb767b50d2f). A mesh whose box
// lies inside the skin of an exterior plan piece (1 mm slack; the skin is outside the outline, house.js skinRect) and is
// not the skin itself.
{
  const off = [], box = new T.Box3(), skins = [];
  for (const p of w.plan.pieces) {
    if (!p.exterior) continue;
    const cx = (p.x0 + p.x1) / 2, cy = (p.y0 + p.y1) / 2;
    if (p.dir === 'H') skins.push(w.plan.isInside(cx, cy + 0.2, 0) ? { x0: p.x0, x1: p.x1, y0: p.y0 - 0.15, y1: p.y0, z1: p.z1 } : { x0: p.x0, x1: p.x1, y0: p.y1, y1: p.y1 + 0.15, z1: p.z1 });
    else skins.push(w.plan.isInside(cx + 0.2, cy, 0) ? { x0: p.x0 - 0.15, x1: p.x0, y0: p.y0, y1: p.y1, z1: p.z1 } : { x0: p.x1, x1: p.x1 + 0.15, y0: p.y0, y1: p.y1, z1: p.z1 });
  }
  scene.updateMatrixWorld(true);
  scene.traverse(o => {
    if (!o.isMesh || o.userData.batch || (!visible(o) && !o.userData.batched)) return;
    box.setFromObject(o); if (box.isEmpty()) return;
    const x0 = box.min.x, x1 = box.max.x, y0 = -box.max.z, y1 = -box.min.z, e = 1e-3;
    for (const k of skins) {
      if (x0 < k.x0 - e || x1 > k.x1 + e || y0 < k.y0 - e || y1 > k.y1 + e || box.max.y > k.z1 + 0.13) continue;
      if ((x1 - x0) * (y1 - y0) > 0.5 * (k.x1 - k.x0) * (k.y1 - k.y0)) continue;   // the skin (or a skin piece) itself
      const a = []; for (let q = o; q && a.length < 3; q = q.parent) a.push(q.name || q.type);
      off.push(`${fixtureOf(o)?.userData.placement?.i ?? a.join('<')} at x ${x0.toFixed(2)}..${x1.toFixed(2)}, y ${y0.toFixed(2)}..${y1.toFixed(2)}, h ${box.min.y.toFixed(2)}..${box.max.y.toFixed(2)}`); break;
    }
  });
  invariant('nothing-under-the-skin', 'no mesh lies wholly inside an exterior wall\'s stucco skin', off);
}

// ---- 3. no static mesh is probe-lit without a reason ------------------------------------------------------------------------------
// The lighting manifest says why a mesh takes the probe volume (lighting_roles.js why: instanced, movable, dynamic, door,
// plant/glass, presentation, hidden); a visible lit mesh the manifest calls lightmapped must carry a lightmap id.
{
  const off = [];
  for (const { node: o } of ix.meshes) {
    const ms = mats(o); if (!visible(o) || !ms.some(m => m.isMeshStandardMaterial)) continue;
    const r = w.roles.meshLighting(o);
    if (r.bake === 'lightmap' && !o.userData.lmId) off.push(ix.pathOf(o) + ' [' + (ms[0].name || ms[0].type) + ']');
  }
  invariant('probe-lit-has-reason', 'every visible lit mesh the manifest lightmaps has a lightmap id (the others have a manifest reason)', off);
}

// ---- 4. lmIds unique ---------------------------------------------------------------------------------------------------------
{
  const seen = new Map(), off = [];
  for (const { node: o } of ix.meshes) { const id = o.userData.lmId; if (!id) continue; if (seen.has(id)) off.push(`${id} (${ix.pathOf(seen.get(id))} and ${ix.pathOf(o)})`); else seen.set(id, o); }
  invariant('lmid-unique', 'every lmId is unique', off);
}

// ---- 5. emitting materials belong to a fixture or are an allowed kind -------------------------------------------------------------
{
  const ALLOWED = new Set(['screen', 'indicator', 'fire']);
  const owned = new Set(); for (const s of switches) for (const m of s.meshes) owned.add(m);
  const off = [];
  for (const { node: o } of ix.meshes) for (const m of mats(o)) {
    const emits = w.roles.lightingOf(m).emits;
    if (!emits || ALLOWED.has(emits.kind)) continue;
    if (owned.has(o)) continue;
    const f = fixtureOf(o);
    // under a declared fixture (lighting_roles.js fixtureOf) that has a switch
    let fixture = null; for (let p = o; p && !fixture; p = p.parent) if (w.roles.fixtureOf(p)) fixture = p;
    if (fixture && switches.some(s => { for (let p = s.root; p; p = p.parent) if (p === fixture) return true; for (let p = fixture; p; p = p.parent) if (p === s.root) return true; return false; })) continue;
    off.push(`${ix.placedKey.get(f) ?? ix.regionOf(o)} [${m.name || m.type}, emits ${emits.kind}]`);
  }
  invariant('emitters-belong-to-fixture', 'every lamp-kind emitting material is on a switched fixture (screens, indicators and fire are allowed anywhere)', off);
}

// ---- 6. interior fixtures' light specs lie inside the plan outline --------------------------------------------------------------
{
  const off = [];
  for (const { node: o, key } of ix.placed) {
    const spec = o.userData.light; if (!spec || switches.some(s => s.lighting.exterior && fixtureOf(s.root) === o)) continue;
    const p = new T.Vector3(...w.roles.lightLocal(spec)).applyMatrix4(o.matrixWorld);
    if (!w.plan.isInside(p.x, -p.z, 0)) off.push(`${key} light at plan (${p.x.toFixed(2)}, ${(-p.z).toFixed(2)})`);
  }
  invariant('interior-light-in-outline', 'light specs of interior fixtures lie inside the plan outline', off);
}

// ---- 6b. every fixture that should have a live light got one (layout.js caps live lights at 16) ----------------------------
{
  const off = [];
  for (const { key, node: o } of ix.placed) if (o.userData.light && o.userData.placement?.light !== false && !w.roles.ownedLights(o).length) off.push(`${key}: no live light (light budget exhausted?)`);
  invariant('fixtures-have-live-lights', 'every fixture with a live light spec owns its live light', off);
}

// ---- 7. committed lamp-group encoding == the manifest's lamp groups (lighting_roles.js lampGroupOrder) ------------------------
{
  const order = w.roles.lampGroupOrder(switches.map(s => s.lighting));
  const enc = JSON.parse(readFileSync(join(WEB, 'assets/lightmaps/v2/lampgroups/encoding.json'), 'utf8')).groups.map(g => g.name);
  const off = [];
  for (const n of order) if (!enc.includes(n)) off.push(`missing from encoding.json: ${n}`);
  for (const n of enc) if (!order.includes(n)) off.push(`not a lamp group of the manifest: ${n}`);
  if (!off.length && order.join() !== enc.join()) off.push('same groups, different order');
  invariant('encoding-matches-lamp-groups-order', `committed lampgroups/encoding.json groups (${enc.length}) equal the manifest's lamp groups (${order.length})`, off);
}

// ---- 7b. switches and lamp groups: every switch in exactly one group, every group with members and one wall plate (unless
// always), members agreeing on their default slots (lighting_roles.js validateSwitches) ----------------------------------------
invariant('switches-map-to-groups', 'every switch in one lamp group, every group with members and one wall plate, members agree on default slots', w.roles.validateSwitches(switches, plates));

// ---- 7c. default switches per slot (a staged showing): every interior switch on at sunrise, golden hour and dusk; at noon
// only where no window or door opens to the outside (closets, the hall, the laundry), or where the fixture declares it (the
// garage); the exterior switch at dusk only. From the plan's openings, not from names.
{
  const off = [], outdoors = new Set(w.plan.spaces.filter(s => s.zone === 'exterior').map(s => s.id));
  const daylit = id => w.plan.openings.some(o => o.connects?.includes(id) && o.connects.some(c => outdoors.has(c)));
  for (const s of switches) {
    const r = s.lighting, declared = w.roles.fixtureOf(s.root)?.defaultOn ?? (() => { for (let p = s.root; p; p = p.parent) { const f = w.roles.fixtureOf(p); if (f) return f.defaultOn; } return null; })();
    const want = r.exterior ? ['dusk'] : declared ?? ['sunrise', 'golden', 'dusk', ...(daylit(r.space) ? [] : ['noon'])];
    if (JSON.stringify([...r.defaultOn].sort()) !== JSON.stringify([...want].sort())) off.push(`${r.id} (${r.space}): ${r.defaultOn.join(',')} not ${want.join(',')}`);
    if (!r.exterior && !['sunrise', 'golden', 'dusk'].every(x => r.defaultOn.includes(x))) off.push(`${r.id} (${r.space}): an interior switch off at ${['sunrise', 'golden', 'dusk'].filter(x => !r.defaultOn.includes(x))}`);
  }
  invariant('default-switches', 'interior switches on at sunrise, golden hour and dusk, at noon only without daylight (or declared); the exterior one at dusk only', off);
}

// ---- 8. committed reflection probe meta == reflprobe_layout.py ------------------------------------------------------------------------
{
  const layout = JSON.parse(execFileSync('python3', ['-I', join(REPO, 'bake/scripts/capture_spatial.py'), '--reflection-layout'], { encoding: 'utf8' }));
  const off = [];
  for (const slot of ['sunrise', 'noon', 'golden', 'dusk']) {
    const file = join(WEB, `assets/lightmaps/${slot}/refl/meta.json`); if (!existsSync(file)) { off.push(`${slot}: no refl/meta.json`); continue; }
    const meta = JSON.parse(readFileSync(file, 'utf8'));
    if (meta.length !== layout.length) off.push(`${slot}: ${meta.length} probes, layout has ${layout.length}`);
    layout.forEach((l, i) => {
      const m = meta[i]; if (!m) return;
      const dp = Math.max(...l.p.map((v, k) => Math.abs(v - m.p[k])));
      const db = l.min ? Math.max(...l.min.map((v, k) => Math.abs(v - m.min[k])), ...l.max.map((v, k) => Math.abs(v - m.max[k]))) : 0;
      if (dp > 0.01 || db > 0.05) off.push(`${slot} probe ${i}: point off ${dp.toFixed(2)} m${l.min ? `, box off ${db.toFixed(2)} m` : ' (outdoor box not checked)'}`);
    });
  }
  invariant('reflection-probes-match-layout', 'committed refl/meta.json (every slot) equals what reflprobe_layout.py lays out now (points 1 cm, boxes 5 cm)', off);
}

// ---- 8b. reflection probes inside the house stand in free air, not inside furniture ----------------------------------------------
// reflprobe_layout.py clears the plan's walls only; probe 4 stood inside the kitchen's pantry tower (81% of its panorama black).
// From each layout point under the roof: 8 level rays and one up and down through the real scene (every mesh both sides,
// see-through surfaces passed, as reflprobe.py's scene check): inside something when 2 or more first hits are back faces, or
// a level ray hits within 0.15 m. (reflprobe.py stops the layout on the same test in the Cycles scene.)
{
  const layout = JSON.parse(execFileSync('python3', ['-I', join(REPO, 'bake/scripts/capture_spatial.py'), '--reflection-layout'], { encoding: 'utf8' }));
  const off = [], meshes = [], sides = new Map();
  scene.traverse(o => { if (o.isMesh && !o.userData.batch && o.geometry?.attributes?.position) meshes.push(o); });
  for (const o of meshes) for (const m of mats(o)) if (!sides.has(m)) { sides.set(m, m.side); m.side = T.DoubleSide; }
  const seeThrough = (o, hit) => { const ms = [].concat(o.material); const m = ms[hit.face?.materialIndex ?? 0] ?? ms[0];
    const r = m && w.roles.resolveMaterial(m); return !!r && (r.surface === 'glass' || r.sheer != null || !!r.alphaCutout); };
  const rc = new T.Raycaster(); rc.firstHitOnly = false;
  const cast = (p, d) => { rc.set(p, d); rc.far = 3; for (const h of rc.intersectObjects(meshes, false)) {
    if (seeThrough(h.object, h)) continue; const n = h.face.normal.clone().transformDirection(h.object.matrixWorld); return { t: h.distance, back: n.dot(d) > 0, o: h.object }; } return null; };
  layout.forEach((l, i) => {
    const [x, h, z] = l.p; if (!w.plan.isInside(x, -z, 0)) return;
    const p = new T.Vector3(x, h, z); let back = 0, near = Infinity, what = null;
    for (let k = 0; k < 10; k++) {
      const d = k < 8 ? new T.Vector3(Math.cos(k * Math.PI / 4), 0, -Math.sin(k * Math.PI / 4)) : new T.Vector3(0, k === 8 ? 1 : -1, 0);
      const hit = cast(p, d); if (!hit) continue;
      if (hit.back) { back++; what = hit.o; }
      if (k < 8 && hit.t < near) { near = hit.t; if (!what) what = hit.o; }
    }
    if (back >= 2 || near < 0.15) off.push(`probe ${i} at (${x.toFixed(2)}, ${(-z).toFixed(2)}): ${back} back faces, nearest ${near.toFixed(2)} m (${fixtureOf(what)?.userData.placement?.i ?? what?.name ?? '?'})`);
  });
  for (const [m, side] of sides) m.side = side;
  invariant('reflection-probes-in-free-air', 'every reflection probe under the roof stands in free air (fewer than 2 back faces around it, 0.15 m clear level)', off);
}

// ---- 9. the plan model is the single source of room / inside / annex geometry --------------------------------------------
// Grep the tracked sources for the shapes the old hand-typed copies had. Only the plan's builder and readers (and the
// data, the docs, the goldens and the harness's quotes of the old classifiers) may hold them.
{
  const FORBIDDEN = [
    ['inside-rectangle porch test', String.raw`<\s*-3\.5\s*(\|\||or)\s*[\w.]+\s*>\s*3\.97`],
    ['inside-rectangle bounds', String.raw`-8\.1\s*<=|>=\s*-8\.1(?![0-9])`],
    ['room rect row with a label', String.raw`(?<![\w$])\[-?\d+\.\d+, -?\d+\.\d+, -?\d+\.\d+, -?\d+\.\d+, '[A-Z]`],
    ['room rect row named by id', String.raw`(?<![\w$])[\[(]'[a-z][A-Za-z]*', -?\d+\.\d+, -?\d+\.\d+, -?\d+\.\d+, -?\d+\.\d+[)\]]`],
    ['typed garage / annex rect', String.raw`\{\s*x0:\s*-7\.903|ANNEX\s*=\s*\{|\{ x0: -4\.816|\{ x0: -6\.25, x1: -4\.93`],
    ['hand-copied garage wall rects', String.raw`x0: -8\.018, x1: -7\.903|x1: -6\.92\b`],
    ['typed outline', String.raw`\[\[-8\.0176, 5\.471\]`],
    ['typed probe-volume grid', String.raw`x0: -12\.5, x1: 12\.5|-12\.5 \+ x \* 0\.5`],
    ['typed daylight box', String.raw`Vector3\(-8\.1, 0, -5\.62\)|vec3\(-8\.1, 0\.0, -5\.62\)`],
  ];
  const ALLOW = ['web/src/plan.js', 'web/src/plan_geom.js', 'bake/scripts/plan.py', 'web/tools/build_plan.mjs', 'web/tools/test_scene_invariants.mjs'];
  const ALLOW_DIRS = ['web/data/', 'docs/', 'web/tools/golden/', 'web/tools/harness/'];
  const off = [];
  for (const [name, re] of FORBIDDEN) {
    let out = '';
    try { out = execFileSync('git', ['grep', '-nIP', '--', re, '--', ':!*.min.js', ':!web/assets'], { cwd: REPO, encoding: 'utf8' }); }
    catch (e) { if (e.status !== 1) throw e; }   // 1: no match
    for (const line of out.split('\n').filter(Boolean)) {
      const file = line.slice(0, line.indexOf(':'));
      if (ALLOW.includes(file) || ALLOW_DIRS.some(d => file.startsWith(d))) continue;
      off.push(`${file}: ${name}`);
    }
  }
  invariant('plan-is-single-source', 'no hand-typed room tables, inside rectangles, annex rects or plan volumes outside the plan model (web/data/plan.json)', off);
}

// ---- 10. every visible mesh and material has a lighting manifest record, with a declared role -------------------------------
// lighting_roles.js validateLighting: resolved, a role declared where the object is made (or structural: reflectors,
// presentation surfaces), known vocabulary, no see-through material left undeclared, no fixture inside a fixture.
invariant('lighting-manifest-complete', 'every visible mesh has a lighting manifest record with a declared role; no contradictory declaration', w.roles.validateLighting(scene));

// ---- 11. no consumer decides lighting by name, id or coordinate --------------------------------------------------------------
// The old rules of docs/audit/lighting-roles.md, by pattern: material / mesh name prefixes, the mirror name, the pets'
// blob names, the niche can's name, fixture ids and id substrings, the exterior regex, light names, the bake-open door id,
// the old flags and tables. Declarations (where objects are made) carry ids and names as identity, not as rules.
{
  const FORBIDDEN = [
    ['plant / leaf-card name regex', String.raw`/\^\(garden-\|plant\)/|/\^garden-/|/\^plant/|startswith\('(plant|garden-)`],
    ['turf mesh name', String.raw`/\^garden-turf/`],
    ['mirror by name', String.raw`name === 'mirror'|name == 'mirror'`],
    ['pet blob names', String.raw`/\^\(cat-blob|=== 'cat-blob'|=== 'dog-contact-shadow'`],
    ['niche can by name', String.raw`=== 'niche-recessed-can'|== 'niche-recessed-can'`],
    ['fixture by id', String.raw`userData\.id === '|\['id'\] == '|s\['id'\] in \(|'kitchen-west-run' in|'props-rooms' in|'garage' in s\[`],
    ['exterior regex', String.raw`porch\|wall-light-black`],
    ['light by name', String.raw`'Porch sconce source'|'sconce' in|'fire' in \(L`],
    ['bake-open door id', String.raw`BAKE_OPEN`],
    ['old lighting tables / flags', String.raw`WALL_SWITCHES|ALWAYS_DEFAULT|DEFAULT_ON = \{|isPlantRoot|exteriorFinish|lightFixture|startswith\('movable|/flame/i`],
  ];
  const ALLOW_DIRS = ['docs/', 'web/tools/golden/', 'web/tools/harness/'];
  const ALLOW = ['web/tools/test_scene_invariants.mjs'];
  const off = [];
  for (const [name, re] of FORBIDDEN) {
    let out = '';
    try { out = execFileSync('git', ['grep', '-nIP', '--', re, '--', 'web/src', 'web/tools', 'bake', ':!*.min.js', ':!*.bundle.js', ':!*.md'], { cwd: REPO, encoding: 'utf8' }); }
    catch (e) { if (e.status !== 1) throw e; }
    for (const line of out.split('\n').filter(Boolean)) {
      const file = line.slice(0, line.indexOf(':'));
      if (ALLOW.includes(file) || ALLOW_DIRS.some(d => file.startsWith(d))) continue;
      off.push(`${line.slice(0, line.indexOf(':', file.length + 1))}: ${name}`);
    }
  }
  invariant('no-name-based-lighting', 'no lighting decision keyed on a name, id or coordinate outside the declarations (lighting_roles.js manifest)', off);
}

// ---- 12. glass never blocks the sun --------------------------------------------------------------------------------------------
// Baked mode (lightmap.js) makes every lightmapped unit cast and clears castShadow where the manifest's sun.cast is false.
// The sun depth draws every material group of a casting mesh, so a mesh mixing glass with an opaque frame would stop the
// sunbeams (volumetric.js) and the sun patches at its panes; sun.cast is decided by the first material alone.
{
  const off = [];
  for (const { node: o } of ix.meshes) {
    const ms = mats(o); if (!visible(o)) continue;
    const r = w.roles.meshLighting(o), casts = r.bake === 'lightmap' || (r.sun.cast !== false && o.castShadow);
    if (casts && ms.some(m => w.roles.lightingOf(m)?.castsSun === false)) off.push(ix.pathOf(o) + ' [' + ms.map(m => m.name || m.type).join(', ') + ']');
  }
  invariant('glass-casts-no-sun', 'no mesh drawn into the sun depth in baked mode carries a material that lets the sun through (glass, presentation)', off);
}

// ---- report ---------------------------------------------------------------------------------------------------------------------------
const known = existsSync(KNOWN) ? JSON.parse(readFileSync(KNOWN, 'utf8')) : { invariants: {} };
if (process.env.UPDATE_KNOWN) {
  const doc = { note: 'Known invariant violations (docs/audit). The invariants test fails on any offender not listed here and lists entries that disappeared. Regenerate with UPDATE_KNOWN=1 only to shrink the list or when a violation is accepted.', invariants: {} };
  for (const r of results) if (r.offenders.length) doc.invariants[r.id] = { title: r.title, count: r.offenders.length, offenders: r.offenders };
  writeFileSync(KNOWN, JSON.stringify(doc, null, 1) + '\n');
  console.log(`known_failures.json written: ${Object.entries(doc.invariants).map(([k, v]) => `${k} ${v.count}`).join(', ') || 'none'}`);
}
const fresh = existsSync(KNOWN) ? JSON.parse(readFileSync(KNOWN, 'utf8')) : { invariants: {} };
let newCount = 0, fixedCount = 0;
for (const r of results) {
  const recorded = new Set(fresh.invariants[r.id]?.offenders ?? []);
  const news = r.offenders.filter(o => !recorded.has(o)), fixed = [...recorded].filter(o => !r.offenders.includes(o));
  const status = !r.offenders.length ? 'PASS' : news.length ? 'FAIL' : 'known';
  console.log(`${status.padEnd(5)} ${r.id}: ${r.title}${r.offenders.length ? ` (${r.offenders.length} offender${r.offenders.length === 1 ? '' : 's'}, ${r.offenders.length - news.length} known)` : ''}`);
  for (const o of news.slice(0, 15)) console.log(`        NEW  ${o}`);
  if (news.length > 15) console.log(`        ... ${news.length - 15} more new`);
  if (fixed.length) console.log(`        FIXED (remove from known_failures.json, UPDATE_KNOWN=1): ${fixed.slice(0, 8).join('; ')}${fixed.length > 8 ? ` ... ${fixed.length - 8} more` : ''}`);
  newCount += news.length; fixedCount += fixed.length;
}
for (const id of Object.keys(fresh.invariants)) if (!results.some(r => r.id === id)) console.log(`note: known_failures.json lists unknown invariant ${id}`);
console.log(`${newCount ? 'FAILED' : 'scene invariants OK'}: ${newCount} new violation${newCount === 1 ? '' : 's'}, ${fixedCount} recorded entr${fixedCount === 1 ? 'y' : 'ies'} now fixed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(newCount ? 1 : 0);
