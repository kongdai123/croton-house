// The camera's white balance on the shipped bake (white_balance.js; policy and colour science: test_white_balance.mjs).
// The real house and lamp groups built headless (harness/baked.mjs), each slot's probe volume filled as the runtime fills
// it (the slot's default switches), and the adapting illuminant read at gate (c)'s cameras (bake/validate/cameras.json)
// as the runtime reads it each frame: the lamp-lit living room at dusk is warm and adapts to warm-white, the noon garden
// is near neutral daylight, daylight rooms read as daylight, blue hour outside stays blue, and with the lamps at physical
// levels (bake v4's lumen model) a sunrise living room is mostly daylight. No browser, no GPU.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildBakedScene } from './harness/baked.mjs';
import { WEB } from './harness/scene.mjs';

const t0 = performance.now();
{
  const b = await buildBakedScene({ groups: true, slots: true });
  const { world, baked } = b, { T } = world, W = { ...world.whiteBalancePolicy, ...world.whiteBalance };   // as lightmap.js wires them
  const lg = baked.lampGroups, walls = world.probeWalls(world.probeWallPieces), S = W.WHITE_BALANCE;
  const cams = JSON.parse(readFileSync(join(WEB, '../bake/validate/cameras.json'), 'utf8')).cameras;
  const camera = id => {
    const c = cams.find(c => c.id === id); assert.ok(c, id);
    const cam = new T.PerspectiveCamera(); cam.position.set(c.x, c.z, -c.y); cam.rotation.set(c.p, -c.h * Math.PI / 180, 0, 'YXZ'); cam.updateMatrixWorld();
    return { cam, indoor: world.plan.indoorWeight(c.x, c.y, c.z) };
  };
  const probes = new Map();
  const volumeFor = async slot => {
    if (!probes.has(slot)) {
      const data = readFileSync(join(WEB, `assets/lightmaps/${slot}/probes.bin`)), saved = globalThis.fetch;
      globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) });
      try { probes.set(slot, await world.loadProbes('probes.bin')); } finally { globalThis.fetch = saved; }
    }
    const volume = world.buildProbeVolume(probes.get(slot), lg, walls);
    lg.reset(slot); lg.update(0, slot); volume.fill();
    return volume;
  };
  // what the runtime does on the first frame at a camera (a teleport snaps): the illuminant, its clamp, the matrix
  const reading = (volume, id) => {
    const { cam, indoor } = camera(id), e = W.adaptingIlluminant(volume.uniforms, cam, walls, indoor), c = W.clampIlluminant(e);
    assert.ok(e && c, `${id}: a reading`);
    const D = W.adaptationDegree(indoor), M = W.temperatureMatrix(c.mired, c.duv, D), out = W.apply(M, e);
    return { e, c, D, out, rel: v => v.map(x => x / v[1]) };
  };
  const report = [];
  const note = (label, r) => report.push(`${label}: ${Math.round(r.c.raw.kelvin)} K ${r.c.raw.duv.toFixed(4)} -> ${Math.round(r.c.kelvin)} K D ${r.D.toFixed(2)}, adapted ${r.rel(r.out).map(v => v.toFixed(2)).join('/')}`);

  // ---- dusk (every switch on by default at dusk): lamp-lit rooms are warm and adapt to warm-white, not orange. The 3000 K
  // fixtures at physical levels mix with the blue hour through the windows: 3200-4000 K on bake v4, well below the noon
  // daylight rooms (5100-7200 K). The old lamps, 10-70x too bright, drowned the window light (2700-3100 K).
  let v = await volumeFor('dusk');
  for (const id of ['living_1', 'kitchen_1', 'dining_1', 'primaryBedroom_1', 'bedroom3_1', 'bathB_1']) {
    const r = reading(v, id); note(`dusk ${id}`, r);
    assert.ok(r.e[0] > r.e[1] && r.e[1] > r.e[2] && r.c.raw.kelvin < 4300, `${id} at dusk: warm (${Math.round(r.c.raw.kelvin)} K, ${r.e})`);
    const [R, , B] = r.rel(r.out);
    assert.ok(R >= 1 && B <= 1 && R / B < 1.6, `${id} at dusk: adapted warm-white, R/B ${(R / B).toFixed(2)} (was ${(r.e[0] / r.e[2]).toFixed(1)})`);
  }
  // blue hour outside stays blue: the sky is past the clamp and the outdoor degree is low
  for (const id of ['backGarden_1', 'frontYard_1']) {
    const r = reading(v, id); note(`dusk ${id}`, r);
    assert.ok(r.c.raw.kelvin > 9000 && r.D < 0.5, `${id} at dusk: blue sky light (${Math.round(r.c.raw.kelvin)} K)`);
    const [R, G, B] = r.rel(r.out); assert.ok(B > G && B / R > 1.2, `${id} at dusk stays blue (B/R ${(B / R).toFixed(2)})`);
  }
  v.uniforms.uProbeSH.value.dispose();

  // ---- noon: the garden near neutral daylight; daylight rooms read as daylight (the garden's green tint within the clamp)
  v = await volumeFor('noon');
  for (const id of ['backGarden_1', 'patio_1']) {
    const r = reading(v, id); note(`noon ${id}`, r);
    assert.ok(r.c.raw.kelvin > 5800 && r.c.raw.kelvin < 8000 && Math.abs(r.c.raw.duv) < 0.006, `${id} at noon: near neutral (${Math.round(r.c.raw.kelvin)} K ${r.c.raw.duv.toFixed(4)})`);
    r.rel(r.out).forEach(x => assert.ok(Math.abs(x - 1) < 0.08, `${id} at noon adapted ${r.rel(r.out)}`));
  }
  for (const id of ['living_1', 'kitchen_1', 'primaryBedroom_1', 'bedroom3_1', 'bathB_1']) {
    const r = reading(v, id); note(`noon ${id}`, r);
    assert.ok(r.c.raw.kelvin > 5000 && r.c.raw.kelvin < 8000 && Math.abs(r.c.raw.duv) < 0.02, `${id} at noon: daylight (${Math.round(r.c.raw.kelvin)} K)`);
    r.rel(r.out).forEach(x => assert.ok(Math.abs(x - 1) < 0.1, `${id} at noon adapted ${r.rel(r.out)}`));
  }
  v.uniforms.uProbeSH.value.dispose();

  // ---- a switch refills the volume and the reading follows: bedroom 3 at golden hour (its lamps on by default), off then on
  v = await volumeFor('golden');
  const bedroom3 = on => { for (const r of lg.records) if (r.group?.name.startsWith('bedroom3')) { r.toggle.manual = true; r.toggle.on = on; } lg.update(1, 'golden'); lg.update(1, 'golden'); };
  bedroom3(false); const off = reading(v, 'bedroom3_1');
  bedroom3(true); const on = reading(v, 'bedroom3_1'); note('golden bedroom3_1 lamps off', off); note('golden bedroom3_1 lamps on', on);
  // two 3000 K lamps at physical levels against the low golden sun through the window: 4400 -> 4200 K on bake v4 (11 mired)
  const warmer = 1e6 / on.c.raw.kelvin - 1e6 / off.c.raw.kelvin;
  assert.ok(warmer > 5 && W.luminance(on.e) > W.luminance(off.e), `switching the lamps on warms the illuminant (${warmer.toFixed(1)} mired)`);
  // the slot crossfade (lightmap_slots.js: uProbeNextSH, uProbeBlend): the reading is the blend of the two volumes'
  const noon = await volumeFor('noon'), { cam } = camera('living_1');
  const a = W.probeIlluminant(v.uniforms, cam.position), z = W.probeIlluminant(noon.uniforms, cam.position);
  const fade = { ...v.uniforms, uProbeNextSH: { value: noon.uniforms.uProbeSH.value }, uProbeBlend: { value: 0.5 } }, m = W.probeIlluminant(fade, cam.position);
  m.forEach((x, i) => assert.ok(Math.abs(x - (a[i] + z[i]) / 2) < 1e-6 + 1e-6 * x, 'crossfade'));
  v.uniforms.uProbeSH.value.dispose(); noon.uniforms.uProbeSH.value.dispose();
  lg.reset('golden');

  // ---- every gate camera at every slot: a reading within the clamp, a finite matrix that keeps the illuminant's luminance
  let n = 0;
  for (const slot of ['sunrise', 'noon', 'golden', 'dusk']) {
    v = await volumeFor(slot);
    for (const c of cams) {
      const { cam, indoor } = camera(c.id), e = W.adaptingIlluminant(v.uniforms, cam, walls, indoor), r = e && W.clampIlluminant(e);
      if (!r) continue;   // a pitch-black closet: the state holds
      assert.ok(r.kelvin >= S.minK - 1e-6 && r.kelvin <= S.maxK + 1e-6 && Math.abs(r.duv) <= S.maxDuv + 1e-12, `${slot} ${c.id}`);
      const M = W.temperatureMatrix(r.mired, r.duv, W.adaptationDegree(indoor)), u = W.uvToRGB(...W.temperatureToUV(r.mired, r.duv));
      assert.ok(M.every(Number.isFinite) && Math.abs(W.luminance(W.apply(M, u)) - W.luminance(u)) < 1e-9, `${slot} ${c.id} matrix`);
      n++;
    }
    v.uniforms.uProbeSH.value.dispose();
  }
  assert.ok(n > 200, `${n} readings`);

  // ---- against the light on the walls of the rendered frames (tools/golden/white_balance_walls.json, tools/wb_walls.py):
  // the adapting illuminant must be the light on what the camera sees. The eye's own mean light missed it by up to 165
  // mired (a lamp-lit doorway behind the camera; the first version, which turned daylight rooms teal at golden hour).
  // Enforced while the shipped bake is the one measured; after a rebake, re-measure (the fixture says how).
  const fixture = JSON.parse(readFileSync(join(WEB, 'tools/golden/white_balance_walls.json'), 'utf8'));
  const hash = p => createHash('sha256').update(readFileSync(join(WEB, p))).digest('hex').slice(0, 16);
  const stale = Object.entries(fixture.bake).filter(([p, h]) => hash(p) !== h).map(([p]) => p);
  const errors = [];
  for (const label of ['shipped']) {
    for (const [slot, walls0] of Object.entries(fixture.walls[label])) {
      v = await volumeFor(slot);
      for (const [id, K] of Object.entries(walls0)) {
        const r = reading(v, id), d = 1e6 / r.c.raw.kelvin - 1e6 / K;
        errors.push(Math.abs(d)); note(`${label} ${slot} ${id} walls ${K} K, estimate ${Math.round(r.c.raw.kelvin)} K (${d > 0 ? '+' : ''}${Math.round(d)} mired)`, r);
      }
      v.uniforms.uProbeSH.value.dispose();
    }
  }
  const meanError = errors.reduce((a, b) => a + b, 0) / errors.length, maxError = Math.max(...errors);
  if (stale.length) console.log(`white balance: the wall fixture was measured on another bake (${stale.join(', ')}): not enforced; mean ${meanError.toFixed(1)}, max ${maxError.toFixed(0)} mired. Re-measure: ${fixture.measure}`);
  else assert.ok(errors.length >= 60 && meanError < 12 && maxError < 80, `the adapting illuminant against the rendered walls: mean ${meanError.toFixed(1)}, max ${maxError.toFixed(0)} mired over ${errors.length}`);

  // ---- the lamps at physical levels: the island pendant (on at sunrise) no longer outshines the daylight, so the sunrise
  // living room reads mostly daylight (2800 K on the old bake, its walls 4100 K with the lamps at a 64th) and adapts near white
  v = await volumeFor('sunrise');
  { const r = reading(v, 'living_1'); note('sunrise living_1', r);
    assert.ok(r.c.raw.kelvin > 3500, `sunrise living room: mostly daylight (${Math.round(r.c.raw.kelvin)} K)`);
    const [R, , B] = r.rel(r.out); assert.ok(R / B < 1.3 && B / R < 1.1, `sunrise living room adapted near white: ${r.rel(r.out)}`); }
  v.uniforms.uProbeSH.value.dispose(); lg.reset('sunrise');
  if (process.env.REPORT) console.log(report.join('\n'));
  console.log(`white balance on the shipped bake: dusk rooms warm -> warm-white, blue hour stays blue, noon daylight near neutral, switches and crossfade followed, ${n} camera readings within the clamp, against ${errors.length} rendered walls mean ${meanError.toFixed(1)} max ${maxError.toFixed(0)} mired${stale.length ? ' (not enforced: another bake)' : ''}, sunrise mostly daylight (${((performance.now() - t0) / 1000).toFixed(1)} s) OK`);
}
