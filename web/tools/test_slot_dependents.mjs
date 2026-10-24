// A time-of-day switch starts what depends on it (onTime: the fire pit, the sheer curtains) when its crossfade begins, and
// settles it on the slot shown however the switch ends (slot_dependents.js; docs/audit/postmortem.md row 27). Driven
// through the real request queue (lighting_slots.js slotRequests: latest request wins while loading, a started fade
// finishes first) with a stub bake whose fades end when the test says. Also: main.js routes every switch through it.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = async name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
const moduleFrom = code => import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const { slotSwitch } = await moduleFrom(await source('slot_dependents.js'));
const { slotRequests } = await moduleFrom(await source('lighting_slots.js'));
const tick = () => new Promise(setImmediate);

// A bake as lightmap.js / lightmap_slots.js present it: setSlot(name, onProgress) resolves once the fade has ended; the
// 'transition' report comes when the destination is staged and its fade begins.
function stubBake(start, { failing = [] } = {}) {
  const listeners = new Set(), log = [];
  let shown = start, fade = null, disposed = false;
  const queue = slotRequests({ available: ['sunrise', 'noon', 'golden', 'dusk'], current: start, release() {},
    load: async name => { await tick(); log.push(`load ${name}`); if (failing.includes(name)) throw new Error(`load ${name}`); return { name }; },
    begin: data => new Promise(resolve => {
      log.push(`fade ${data.name}`); fade = { data, resolve };
      for (const cb of [...listeners]) cb(1, { phase: 'transition', name: data.name });
    }) });
  return {
    log, get shown() { return disposed ? null : shown; }, get fading() { return fade?.data.name ?? null; },
    setSlot(name, onProgress) {
      listeners.add(onProgress); onProgress(0, { phase: 'load', name });
      return queue.request(name).finally(() => listeners.delete(onProgress));
    },
    async endFade() { const f = fade; fade = null; shown = f.data.name; log.push(`shown ${shown}`); f.resolve(true); await tick(); await tick(); },
    async dispose() { disposed = true; queue.dispose(); const f = fade; fade = null; f?.resolve(false); await tick(); await tick(); },
  };
}
// The dependents as layout.js objects hold them: each apply sets the state (an animated toggle asked again does nothing).
function setup(start, opts) {
  const bake = stubBake(start, opts), applied = [];
  const dependents = { dusk: start === 'dusk', changes: 0 };
  const apply = slot => { applied.push(`${slot}${bake.fading ? ' (fading)' : ''}`); const dusk = slot === 'dusk'; if (dusk !== dependents.dusk) { dependents.dusk = dusk; dependents.changes++; } };
  const sw = slotSwitch({ setSlot: (n, p) => bake.setSlot(n, p), apply, shown: () => bake.shown });
  return { bake, applied, dependents, sw };
}

// 1. golden -> dusk: the fire and curtains start when the fade begins, while it runs; once it ends, nothing changes again
{
  const { bake, applied, dependents, sw } = setup('golden');
  const done = sw('dusk'); await tick(); await tick(); await tick();
  assert.equal(bake.fading, 'dusk', 'the fade is running');
  assert.deepEqual(applied, ['dusk (fading)'], 'dependents start with the crossfade, not after it');
  assert.equal(dependents.dusk, true);
  await bake.endFade(); assert.equal(await done, true);
  assert.deepEqual(applied, ['dusk (fading)', 'dusk'], 'settled on the slot shown');
  assert.equal(dependents.changes, 1, 'one change, at the start of the fade');
}
// 2. the load fails: no fade, the dependents stay with the slot shown
{
  const { applied, dependents, sw } = setup('golden', { failing: ['dusk'] });
  await assert.rejects(sw('dusk'), /load dusk/);
  assert.deepEqual(applied, ['golden']); assert.equal(dependents.dusk, false); assert.equal(dependents.changes, 0);
}
// 3. a second request during the fade (N pressed again): the fade finishes, then the next one starts its own dependents
{
  const { bake, applied, dependents, sw } = setup('golden');
  const first = sw('dusk'); await tick(); await tick(); await tick();
  const second = sw('sunrise'); await tick();
  assert.equal(bake.fading, 'dusk', 'a started fade finishes first');
  await bake.endFade(); await tick(); await tick(); await tick();
  assert.equal(bake.fading, 'sunrise', 'then the next one fades');
  assert.equal(dependents.dusk, false, 'the sunrise fade turned the fire off as it began');
  await bake.endFade(); await Promise.all([first, second]);
  assert.equal(bake.shown, 'sunrise'); assert.equal(dependents.dusk, false, 'ends by day');
  assert.ok(applied.indexOf('sunrise (fading)') > applied.indexOf('dusk (fading)'));
  assert.equal(applied.at(-1), 'sunrise');
}
// 4. superseded while loading (latest wins): only the destination that fades starts its dependents
{
  const { bake, applied, dependents, sw } = setup('noon');
  const a = sw('dusk'), b = sw('golden'); await tick(); await tick(); await tick(); await tick();
  assert.equal(bake.fading, 'golden'); assert.ok(!applied.some(x => x.startsWith('dusk')), 'dusk never faded: never applied');
  await bake.endFade(); await Promise.all([a, b]);
  assert.equal(dependents.dusk, false); assert.equal(dependents.changes, 0);
}
// 5. the bake disposed mid-fade (a context loss falls back to the raster lighting): the switch leaves the dependents to
// that fallback (main.js applyTime re-applies the time of day), and reports the switch as not made
{
  const { bake, applied, sw } = setup('golden');
  const done = sw('dusk'); await tick(); await tick(); await tick();
  await bake.dispose(); assert.equal(await done, false);
  assert.deepEqual(applied, ['dusk (fading)'], 'no stale re-apply after the bake is gone');
}

// main.js: every slot switch goes through slotSwitch; the onTime hooks are only reached through timeDependents
const main = await source('main.js');
assert.match(main, /const switched = await switchSlot\(name, loading\.progress\)/, 'setBakedSlot switches through slotSwitch');
assert.match(main, /slotSwitch\(\{ setSlot: \(name, progress\) => baked\.setSlot\(name, progress\)/);
assert.equal((main.match(/onTime\?\.\(/g) ?? []).length, 1, 'one place calls the onTime hooks (timeDependents)');
assert.doesNotMatch(main, /await baked\.setSlot\(/, 'no switch around slotSwitch');
console.log('slot dependents ok');
