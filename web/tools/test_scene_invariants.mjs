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
    const ry = p.rotation.y, x = p.position.x, y = -p.position.z, dx = -Math.sin(ry) * 0.02, dy = Math.cos(ry) * 0.02;
    const wall = w.plan.walls.find(q => x + dx >= q.x0 && x + dx <= q.x1 && y + dy >= q.y0 && y + dy <= q.y1);
    if (!wall) { off.push(`plate ${p.name}: no wall behind it`); continue; }
    if (w.plan.openings.some(o => o.wall === wall.id && (o.dir === 'V' ? y > o.y0 - 0.065 && y < o.y1 + 0.065 : x > o.x0 - 0.065 && x < o.x1 + 0.065))) off.push(`plate ${p.name}: in a door or its casing`);
  }
  invariant('switch-plates-map-to-fixtures', 'every wall plate drives a fixture of its own lamp group, every declared plate was made (one per group), on solid wall clear of doors', off);
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
    if (f && (f.userData.light || f.userData.lightFixture) && [...switches].some(s => { for (let p = s.root; p; p = p.parent) if (p === f) return true; return false; })) continue;
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
