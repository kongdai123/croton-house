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
import { indexScene, fixtureExterior } from './harness/objects.mjs';

const WEB = fileURLToPath(new URL('../', import.meta.url)), REPO = join(WEB, '..'), KNOWN = join(WEB, 'tools/golden/known_failures.json');
const t0 = performance.now();
const w = await buildRealScene(), ix = indexScene(w);
const { T, scene, house, switches, doors } = w;
const plan = v => [v.x, -v.z, v.y];
const visible = o => { for (let p = o; p; p = p.parent) if (p.visible === false) return false; return true; };
const mats = o => [].concat(o.material ?? []).filter(Boolean);
const fixtureOf = n => { for (let p = n; p; p = p.parent) if (p.userData.placement) return p; return null; };
const plates = scene.children.filter(c => c.name?.startsWith('wall-switch-') && c.userData.lightSwitch);

const results = [];   // { id, title, offenders: string[] }
const invariant = (id, title, offenders) => results.push({ id, title, offenders: [...new Set(offenders)].sort() });

// ---- 1. every interior space has an emitting fixture with a switch ---------------------------------------------------
{
  const H = w.houseConsts, inRect = (r, x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
  const spaces = [];
  const noteAreas = house.notes.filter(n => n.area);
  for (const n of house.notes) {
    const poly = n.area ?? house.rooms.find(r => r.id === n.room).pts;
    spaces.push({ name: `${n.label} (${n.id})`, has: (x, y) => w.pointInPoly([x, y], poly) });
  }
  for (const r of house.rooms) if (!house.notes.some(n => n.room === r.id)) spaces.push({ name: `room ${r.id}`, has: (x, y) => w.pointInPoly([x, y], r.pts) });
  // the hall has no note: it is the great-room polygon minus the four note areas
  const great = house.rooms.reduce((a, r) => (r.pts.length > a.pts.length ? r : a));
  spaces.push({ name: 'Hall (great room minus its note areas)', has: (x, y) => w.pointInPoly([x, y], great.pts) && !noteAreas.filter(n => n.room === great.id).some(n => w.pointInPoly([x, y], n.area)) });
  for (const [name, r] of [['Garage', H.GARAGE], ['Laundry nook', H.LAUNDRY], ['Walk-in closet', H.WALKIN], ['Linen closet (louvered, off the vestibule)', H.LINEN]]) spaces.push({ name, has: (x, y) => inRect(r, x, y) });
  const lit = switches.filter(s => s.toggle.glows.length && plates.some(p => p.userData.lightSwitch === s.toggle)).map(s => { const p = plan(s.root.getWorldPosition(new T.Vector3())); return { x: p[0], y: p[1] }; });
  invariant('rooms-have-switched-light', 'every interior space has at least one emitting fixture with a wall switch', spaces.filter(sp => !lit.some(f => sp.has(f.x, f.y))).map(sp => sp.name));
}

// ---- 2. every switch plate maps to a fixture; every WALL_SWITCHES row got a plate ---------------------------------------------
{
  const off = [];
  for (const p of plates) { const e = switches.find(s => s.toggle === p.userData.lightSwitch); if (!e || !(e.toggle.glows.length || e.toggle.lights.length)) off.push(`plate ${p.name}: no fixture`); }
  for (const [name] of w.WALL_SWITCHES) if (!plates.some(p => p.name === 'wall-switch-' + name)) off.push(`row ${name}: no plate (no fixture within 0.06 m of its target)`);
  invariant('switch-plates-map-to-fixtures', 'every wall switch plate maps to a fixture, and every WALL_SWITCHES row found its fixture', off);
}

// ---- 3. no static mesh is probe-lit without a reason category ----------------------------------------------------------------
{
  // lightmap.js:773-778 ladder (glass, plant, door, movable, dynamic) with the explained 'dynamic' cases made explicit
  const doorParts = new Set();
  for (const d of doors) { if (d.kind === 'french' || d.kind === 'slider') continue; d.group.traverse(o => { if (o.isMesh && o.parent !== d.group) doorParts.add(o); }); }
  const off = [];
  for (const { node: o } of ix.meshes) {
    const ms = mats(o); if (!visible(o) || !ms.some(m => m.isMeshStandardMaterial)) continue;
    if (o.userData.lmId || o.userData.lmSkip || doorParts.has(o) || o.isInstancedMesh || o.isSkinnedMesh) continue;
    const m = ms[0]; if (m.transmission > 0 || m.transparent || m.alphaTest > 0 || /^(garden-|plant)/.test(m.name || '')) continue;
    let dyn = false; for (let p = o; p && !dyn; p = p.parent) dyn = ix.anchors.has(p) || ix.animated.has(p) || ix.dynamicRoots.has(p) || !!p.userData.toggle || !!p.userData.movable;
    if (dyn) continue;
    off.push(ix.pathOf(o) + ' [' + (m.name || m.type) + ']');
  }
  invariant('probe-lit-has-reason', 'no visible static mesh is left without a lightmap id unless glass, plant, door, movable, moving part, instanced', off);
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
    if (!w.emitsLight(m) || ALLOWED.has(m.userData.emits)) continue;
    if (owned.has(o)) continue;
    const f = fixtureOf(o);
    if (f && (f.userData.light || f.userData.lightFixture) && [...switches].some(s => { for (let p = s.root; p; p = p.parent) if (p === f) return true; return false; })) continue;
    off.push(`${ix.placedKey.get(f) ?? ix.regionOf(o)} [${m.name || m.type}, emits ${m.userData.emits ?? (m.userData.lightGlow ? 'lightGlow' : '?')}]`);
  }
  invariant('emitters-belong-to-fixture', 'every lamp-kind emitting material is on a switched fixture (screens, indicators and fire are allowed anywhere)', off);
}

// ---- 6. interior fixtures' light specs lie inside the plan outline --------------------------------------------------------------
{
  const off = [];
  for (const { node: o, key } of ix.placed) {
    const spec = o.userData.light; if (!spec || fixtureExterior(o.userData.id)) continue;
    const p = new T.Vector3(0, spec.y ?? 2.3, 0).applyMatrix4(o.matrixWorld);
    if (!w.pointInPoly([p.x, -p.z], w.EXT_FP)) off.push(`${key} light at plan (${p.x.toFixed(2)}, ${(-p.z).toFixed(2)})`);
  }
  invariant('interior-light-in-outline', 'light specs of interior fixtures lie inside the plan outline (EXT_FP)', off);
}

// ---- 7. committed lamp-group encoding == lamp_groups.py ORDER ---------------------------------------------------------------------
{
  const py = readFileSync(join(REPO, 'bake/scripts/lamp_groups.py'), 'utf8');
  const order = [...py.match(/ORDER = (\[[\s\S]*?\])/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  const enc = JSON.parse(readFileSync(join(WEB, 'assets/lightmaps/v2/lampgroups/encoding.json'), 'utf8')).groups.map(g => g.name);
  const off = [];
  for (const n of order) if (!enc.includes(n)) off.push(`missing from encoding.json: ${n}`);
  for (const n of enc) if (!order.includes(n)) off.push(`not in ORDER: ${n}`);
  if (!off.length && order.join() !== enc.join()) off.push('same groups, different order');
  invariant('encoding-matches-lamp-groups-order', `committed lampgroups/encoding.json groups (${enc.length}) equal lamp_groups.py ORDER (${order.length})`, off);
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
