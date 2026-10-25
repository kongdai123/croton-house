// The live sun through a slot crossfade (src/sun_crossfade.js): a dissolve, never a sweep. Every ordered pair of slots
// is faded as lightmap_slots.js fades it (1.5 s, smoothstep blend), at 20 to 144 frames a second. The sun's direction
// may change once, from or to a frame on which it gives at most 1 % of its light: a lit sun never moves during a fade, so
// no shadow races across the garden (docs/audit/postmortem.md, row 34). The ends are the two slots' own suns.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const moduleOf = async name => import(`data:text/javascript;base64,${Buffer.from(await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')).toString('base64')}`);
const { SLOTS, blendSlot } = await moduleOf('lighting_slots.js'), { crossfadeSun, DARK } = await moduleOf('sun_crossfade.js');

const names = Object.keys(SLOTS), FADE = 1.5;
let fades = 0;
for (const a of names) for (const b of names) {
  if (a === b) continue;
  const from = SLOTS[a], to = SLOTS[b], peak = Math.max(from.strength, to.strength, 1e-9);
  for (const fps of [20, 24, 30, 60, 75, 144]) {
    const frames = [];
    for (let elapsed = 0; ; elapsed = Math.min(FADE, elapsed + 1 / fps)) {
      const u = elapsed / FADE, t = u * u * (3 - 2 * u), sun = crossfadeSun(blendSlot({ ...from }, to, t), from, to, t);
      frames.push({ t, elapsed, sun });
      if (elapsed >= FADE) break;
    }
    const first = frames[0].sun, last = frames.at(-1).sun;
    // (to float rounding: the fades with an unlit end take the blend's sun, whose colour is mixed)
    const same = (s, e) => [s.az, s.el, s.strength, ...s.color].every((x, k) => Math.abs(x - [e.az, e.el, e.strength, ...e.color][k]) < 1e-9);
    assert.ok(same(first, from), `${a}->${b} starts at ${a}'s sun`);
    assert.ok(same(last, to), `${a}->${b} ends at ${b}'s sun`);
    let turns = 0, dark = 0;
    for (let i = 1; i < frames.length; i++) {
      const p = frames[i - 1].sun, q = frames[i].sun;
      assert.equal(q.ev, blendSlot({ ...from }, to, frames[i].t).ev, 'the rest of the mood is the blend');
      if (p.az !== q.az || p.el !== q.el) {
        turns++;
        // (one side dark: the shadows fade out, or in, never jump from one lit frame to the next)
        assert.ok(Math.min(p.strength, q.strength) <= 0.01 * peak, `${a}->${b} at ${fps} fps: the sun turns between frames at ${(p.strength / peak * 100).toFixed(1)} % and ${(q.strength / peak * 100).toFixed(1)} % of its light`);
      }
      if (q.strength === 0 && peak > 0) dark += 1 / fps;
      // to or from a slot without sun: the blend's own sun (the lit slot's direction, faded by its share), never held darker
      if (!(from.strength > 0 && to.strength > 0)) assert.equal(q.strength, blendSlot({ ...from }, to, frames[i].t).strength, `${a}->${b}: the sun follows the blend`);
    }
    assert.ok(turns <= 1, `${a}->${b} at ${fps} fps: the sun turns ${turns} times`);
    // the dark moment is the same length in seconds at every frame rate (about DARK of the blend, ~0.05 s): a blink
    if (from.strength > 0 && to.strength > 0) assert.ok(dark <= 0.12, `${a}->${b} at ${fps} fps: ${dark.toFixed(3)} s without sun`);
    fades++;
  }
}
// outside a fade the mood passes through
const m = { az: 1, el: 2, strength: 3, color: [1, 1, 1], ev: 0 };
assert.equal(crossfadeSun(m, null, SLOTS.noon, 0.3), m);
assert.ok(DARK > 0 && DARK < 0.2);
console.log(`sun crossfade: ${fades} fades (every slot pair at 20-144 fps) turn the sun at most once, dark, and end on each slot's own sun OK`);
